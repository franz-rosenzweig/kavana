// Kavana's living cats: the painted pictures bent live, so they breathe, blink, flick an ear, swish a
// tail, tilt their head, look at your finger and hop when you tap them. No new art: every picture gets a
// rig (rig.json: eyes, head, neck, ears, tail, ground line, in the picture's 512 px) and a mesh that
// moves. Every motion is a damped spring (damping ratio + settle time) or a fixed curve, so Android
// (Canvas.drawBitmapMesh) can use the same numbers.
//
//   const r = KavanaWarp.renderer();               // one WebGL context for every cat on the page
//   const cat = new KavanaWarp.Cat(canvas, 'miso', 'portrait', { rig, base: 'cats/' });
//   KavanaWarp.start();                            // one animation loop for all of them
(function (root) {
'use strict';

const G = 36; // mesh cells per side
const FRAME = { x0: -48, y0: -80, w: 608, h: 608 }; // the canvas around the 512 px picture: room to hop and swish
const N = 512;

// ---------- the numbers (shared with Android) ----------
const M = {
  breath: { period: 3.6, inhale: 0.42, tall: 0.03, belly: 0.05 },
  nap: { period: 5.2, inhale: 0.45, tall: 0.05, belly: 0.03 },
  blink: { every: [2.2, 5.5], close: 0.07, hold: 0.04, open: 0.12, double: 0.2, depth: 0.94 },
  head: { drift: 0.044, damping: 0.55, settle: 0.8, tilt: 0.12, tiltEvery: [7, 14], tiltFor: 1.4 },
  look: { max: 16, damping: 0.8, settle: 0.35 },
  ears: { kick: 5.5, damping: 0.28, settle: 0.45, every: [4, 9] },
  tail: { swing: 0.14, period: 2.8, damping: 0.35, settle: 0.6 },
  sway: { lean: 0.006, period: 5.3 },
  squash: { damping: 0.42, settle: 0.55 },
  hop: { height: 28, time: 0.34, crouch: 0.09, land: -3.2, takeoff: 2.2 },
  morph: { down: 0.13, depth: -0.2, pop: 2.8 },
  purr: { hz: 24, px: 0.7, squint: 0.85 },
};

// ---------- small helpers ----------
const ss = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
function rng(seed) { let s = seed >>> 0 || 1; return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return ((s >>> 0) % 100000) / 100000; }; }
function hash(str) { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
const between = (r, [a, b]) => a + (b - a) * r();

// A damped spring toward `to`. damping 1 = no overshoot; settle = seconds to come within ~2%.
class Spring {
  constructor(damping, settle, x = 0) { this.z = damping; this.w = 4 / (damping * settle); this.x = x; this.v = 0; this.to = x; }
  step(dt) {
    const n = Math.max(1, Math.ceil(dt * 240)), h = dt / n;
    for (let i = 0; i < n; i++) { this.v += (-2 * this.z * this.w * this.v - this.w * this.w * (this.x - this.to)) * h; this.x += this.v * h; }
    return this.x;
  }
}

// ---------- the rig's weights: how much each mesh point follows each part ----------
const weightCache = new Map();
function weights(key, r) {
  if (weightCache.has(key)) return weightCache.get(key);
  const n = (G + 1) * (G + 1), W = { x0: new Float32Array(n), y0: new Float32Array(n), bell: new Float32Array(n), nap: new Float32Array(n) };
  const g = r.ground, H = g - r.top;
  if (r.head) { W.head = new Float32Array(n); W.pivot = [r.neck[0], r.head[1] + 0.6 * (r.neck[1] - r.head[1])]; } // the head turns about its chin
  if (r.ears) W.ears = r.ears.map((e) => e && { w: new Float32Array(n), base: [e[0] + (r.head[0] - e[0]) * 0.42, e[1] + (r.head[1] - e[1]) * 0.42] });
  if (r.tail) W.tail = new Float32Array(n);
  if (r.eyes) W.eyes = r.eyes.map(() => ({ w: new Float32Array(n), dy: new Float32Array(n) }));
  for (let i = 0; i < n; i++) {
    const x = (i % (G + 1)) / G * N, y = Math.floor(i / (G + 1)) / G * N;
    W.x0[i] = x; W.y0[i] = y;
    const up = (g - y) / H;
    W.bell[i] = Math.exp(-(((up - 0.36) / 0.2) ** 2));
    W.nap[i] = Math.exp(-(((up - 0.5) / 0.35) ** 2));
    if (r.head) {
      // The head turns as one piece: everything above the neck within reach of the head (ears, whiskers,
      // a hat), blending into the body only across the neck. A tail that reaches up beside it stays put.
      const [hx, , rx, ry] = r.head;
      let w = (1 - ss(r.neck[1] - 0.15 * ry, r.neck[1] + 0.3 * ry, y)) * (1 - ss(1.25, 1.8, Math.abs(x - hx) / rx));
      if (r.tail) {
        const [bx, by, tx, ty] = r.tail, dx = tx - bx, dy = ty - by, L2 = dx * dx + dy * dy, L = Math.sqrt(L2);
        const s = ((x - bx) * dx + (y - by) * dy) / L2, off = Math.hypot(x - (bx + dx * clamp(s, 0, 1)), y - (by + dy * clamp(s, 0, 1)));
        w *= ss(Math.max(0.3 * L, 24), Math.max(0.75 * L, 90), off); // a short tail still gets a wide band
      }
      W.head[i] = w;
    }
    if (W.ears) W.ears.forEach((E, k) => {
      if (!E) return;
      // an ear turns nearly stiff about its base; only the last bit near the head bends
      const t = r.ears[k], L = Math.hypot(t[0] - E.base[0], t[1] - E.base[1]);
      E.w[i] = (1 - ss(0.65 * L, 1.25 * L, Math.hypot(x - t[0], y - t[1]))) * (1 - ss(E.base[1] - 0.1 * L, E.base[1] + 0.3 * L, y));
    });
    if (r.tail) {
      const [bx, by, tx, ty] = r.tail, dx = tx - bx, dy = ty - by, L2 = dx * dx + dy * dy, L = Math.sqrt(L2);
      const s = ((x - bx) * dx + (y - by) * dy) / L2;
      const cx = bx + dx * clamp(s, 0, 1), cy = by + dy * clamp(s, 0, 1), off = Math.hypot(x - cx, y - cy);
      W.tail[i] = s <= 0 ? 0 : ss(0, 1.1, Math.min(s, 1.1)) * (1 - ss(0.3 * L, 0.85 * L, off));
    }
    if (W.eyes) r.eyes.forEach(([ex, ey, rx, ry], k) => {
      const w = (1 - ss(1.0, 1.6, Math.abs(x - ex) / rx)) * (1 - ss(1.05, 2.2, Math.abs(y - ey) / ry));
      W.eyes[k].w[i] = w; W.eyes[k].dy[i] = ey + 0.22 * ry - y; // the lids meet a little below the middle
    });
  }
  weightCache.set(key, W);
  return W;
}

// Moves every mesh point for one frame. P: k (blink 0..1), ears [a, a], tail a, th (head turn),
// hx/hy (head shift), bv/bx (breath tall/belly), S (squash/stretch), lean, jx (purr), hop (px up), nap.
function deform(out, r, W, P) {
  const g = r.ground, m = r.mid, n = W.x0.length;
  const ct = Math.cos(P.tail), st = Math.sin(P.tail);
  for (let i = 0; i < n; i++) {
    let x = W.x0[i], y = W.y0[i];
    if (W.eyes && P.k > 0.001) for (const e of W.eyes) y += e.dy[i] * P.k * e.w[i];
    if (W.ears) for (let k = 0; k < 2; k++) {
      const E = W.ears[k]; if (!E || !P.ears[k]) continue;
      const a = P.ears[k] * E.w[i]; if (!a) continue;
      const c = Math.cos(a), s = Math.sin(a), dx = x - E.base[0], dy = y - E.base[1];
      x = E.base[0] + dx * c - dy * s; y = E.base[1] + dx * s + dy * c;
    }
    if (W.tail && P.tail) {
      const w = W.tail[i];
      if (w) {
        const a = P.tail * w, c = w === 1 ? ct : Math.cos(a), s = w === 1 ? st : Math.sin(a);
        const dx = x - r.tail[0], dy = y - r.tail[1];
        x = r.tail[0] + dx * c - dy * s; y = r.tail[1] + dx * s + dy * c;
      }
    }
    if (W.head) {
      const w = W.head[i];
      if (w) {
        const a = P.th * w, c = Math.cos(a), s = Math.sin(a), dx = x - W.pivot[0], dy = y - W.pivot[1];
        x = W.pivot[0] + dx * c - dy * s + P.hx * w; y = W.pivot[1] + dx * s + dy * c + P.hy * w;
      }
    }
    const bell = P.nap ? W.nap[i] : W.bell[i];
    y = g - (g - y) * (1 + P.bv);
    x = m + (x - m) * (1 + P.bx * bell);
    y = g - (g - y) * (1 + P.S);
    x = m + (x - m) * (1 - 0.5 * P.S);
    x += P.lean * (g - y) + P.jx;
    y -= P.hop;
    out[i * 2] = (x - FRAME.x0) / FRAME.w * 2 - 1;
    out[i * 2 + 1] = 1 - (y - FRAME.y0) / FRAME.h * 2;
  }
}

// ---------- one WebGL context draws every cat, then each cat copies its pixels to its own canvas ----------
let R = null;
function renderer() {
  if (R) return R;
  const c = document.createElement('canvas'); c.width = c.height = 1024;
  const gl = c.getContext('webgl', { premultipliedAlpha: true, preserveDrawingBuffer: true, antialias: true });
  if (!gl) return (R = { gl: null });
  const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); return s; };
  const p = gl.createProgram();
  gl.attachShader(p, sh(gl.VERTEX_SHADER, 'attribute vec2 p;attribute vec2 uv;varying vec2 v;void main(){gl_Position=vec4(p,0.,1.);v=uv;}'));
  gl.attachShader(p, sh(gl.FRAGMENT_SHADER, 'precision mediump float;uniform sampler2D t;uniform float a,sat;varying vec2 v;void main(){vec4 c=texture2D(t,v);float l=dot(c.rgb,vec3(.299,.587,.114));c.rgb=mix(vec3(l),c.rgb,sat);gl_FragColor=c*a;}'));
  gl.linkProgram(p); gl.useProgram(p);
  const n = (G + 1) * (G + 1), uv = new Float32Array(n * 2), idx = new Uint16Array(G * G * 6);
  for (let i = 0; i < n; i++) { uv[i * 2] = (i % (G + 1)) / G; uv[i * 2 + 1] = Math.floor(i / (G + 1)) / G; }
  let k = 0;
  for (let y = 0; y < G; y++) for (let x = 0; x < G; x++) { const a = y * (G + 1) + x, b = a + 1, d = a + G + 1, e = d + 1; idx.set([a, b, d, b, e, d], k); k += 6; }
  const ub = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, ub); gl.bufferData(gl.ARRAY_BUFFER, uv, gl.STATIC_DRAW);
  const uvLoc = gl.getAttribLocation(p, 'uv'); gl.enableVertexAttribArray(uvLoc); gl.vertexAttribPointer(uvLoc, 2, gl.FLOAT, false, 0, 0);
  const pb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, pb);
  const pLoc = gl.getAttribLocation(p, 'p'); gl.enableVertexAttribArray(pLoc); gl.vertexAttribPointer(pLoc, 2, gl.FLOAT, false, 0, 0);
  const ib = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);
  gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA); gl.enable(gl.SCISSOR_TEST);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
  R = { gl, c, pb, count: idx.length, uA: gl.getUniformLocation(p, 'a'), uSat: gl.getUniformLocation(p, 'sat'), tex: new Map(), pos: new Float32Array(n * 2) };
  return R;
}

function texture(src) {
  const r = renderer();
  if (r.tex.has(src)) return r.tex.get(src);
  const t = { ready: false, img: new Image() };
  r.tex.set(src, t);
  t.img.decoding = 'async';
  t.img.onload = () => {
    if (!r.gl) { t.ready = true; return; }
    const gl = r.gl; t.tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t.tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, t.img);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    t.ready = true;
  };
  t.img.src = src;
  return t;
}

// ---------- a cat ----------
const all = new Set();
// Visibility is tracked per scope (the nearest [data-cat-scope], else the canvas): a cat that slides in by a
// transform inside a phone or a sheet never tells the observer, so the whole scope decides.
const io = typeof IntersectionObserver !== 'undefined' ? new IntersectionObserver((es) => es.forEach((e) => { for (const c of e.target.__cats || []) c.visible = e.isIntersecting; }), { rootMargin: '60px' }) : null;
const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver((es) => es.forEach((e) => e.target.__cat && e.target.__cat.fit())) : null;
const reduce = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const FILES = { portrait: '-1', kitten: '-kitten-1', nap: '-nap-1' };

class Cat {
  constructor(canvas, id, pose, o = {}) {
    this.c = canvas; this.ctx = canvas.getContext('2d'); canvas.__cat = this;
    this.o = o; this.rigs = o.rig; this.base = o.base || 'cats/';
    this.r = rng(o.seed ?? hash(id + pose + Math.random()));
    this.old = Boolean(o.old); this.sat = o.sat ?? 1; this.alpha = o.alpha ?? 1; this.shadow = o.shadow !== false;
    this.t = 0; this.ph = this.r() * 10; this.visible = !io; this.live = !reduce || o.interactive;
    this.S = new Spring(M.squash.damping, M.squash.settle);
    this.head = new Spring(M.head.damping, M.head.settle);
    this.lx = new Spring(M.look.damping, M.look.settle); this.ly = new Spring(M.look.damping, M.look.settle);
    this.ear = [new Spring(M.ears.damping, M.ears.settle), new Spring(M.ears.damping, M.ears.settle)];
    this.tailS = new Spring(M.tail.damping, M.tail.settle);
    this.squint = new Spring(1, 0.18);
    this.blinkAt = between(this.r, [0.8, 3.5]); this.blinkT = -1; this.blinkTwice = false;
    this.earAt = between(this.r, M.ears.every); this.tiltAt = between(this.r, M.head.tiltEvery); this.tiltUntil = 0; this.tiltTo = 0;
    this.hopT = -1; this.hops = 0; this.morphT = -1; this.next = null; this.purring = false; this.lookAt = null; this.happyUntil = 0;
    this.fx = []; this.zAt = 1 + this.r() * 1.5;
    this.set(id, pose);
    this.fit();
    this.scope = o.scope || canvas.closest('[data-cat-scope]') || canvas;
    (this.scope.__cats = this.scope.__cats || []).push(this);
    // observe() on a scope that's already watched sends nothing, so a second cat in the same sheet would
    // never hear it's on screen: start watching afresh, which reports again for every cat in the scope
    if (io) { io.unobserve(this.scope); io.observe(this.scope); }
    ro && ro.observe(canvas);
    if (o.interactive) this.bind();
    all.add(this);
  }
  set(id, pose) {
    this.id = id; this.pose = pose; this.key = id + FILES[pose];
    this.rig = this.rigs[this.key]; this.W = weights(this.key, this.rig);
    this.tex = texture(this.base + this.key + '.webp');
  }
  fit() {
    const b = this.c.getBoundingClientRect(), d = Math.min(2.5, root.devicePixelRatio || 1);
    const w = Math.min(1024, Math.round(b.width * d)), h = Math.min(1024, Math.round(b.height * d));
    if (w && h && (this.c.width !== w || this.c.height !== h)) { this.c.width = w; this.c.height = h; }
  }
  destroy() { all.delete(this); this.scope.__cats = this.scope.__cats.filter((c) => c !== this); ro && ro.unobserve(this.c); }

  // ----- things a cat does -----
  hop(times = 1) { if (this.pose === 'nap') { this.S.v -= 1.6; this.heart(); return; } this.hopT = this.t; this.hops = times; }
  happy(sec = 0.7) { this.happyUntil = this.t + sec; this.flick(0); this.flick(1); this.tailS.v += 3; }
  flick(k) { this.ear[k].v += (k ? 1 : -1) * M.ears.kick * (0.8 + 0.4 * this.r()); }
  tilt(a, sec = M.head.tiltFor) { this.tiltTo = a; this.tiltUntil = this.t + sec; }
  blink() { this.blinkT = this.t; this.blinkTwice = false; }
  heart() { this.fx.push({ kind: 'heart', t: 0, x: this.rig.mid + (this.r() - 0.5) * 120, y: this.rig.top + 40, vx: (this.r() - 0.5) * 30 }); }
  sparkle(n = 7) {
    const cx = this.rig.mid, cy = (this.rig.top + this.rig.ground) / 2;
    const R = 0.42 * this.rig.w; // a ring around the cat, flying outward, never over the face
    for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2 + this.r(); this.fx.push({ kind: 'spark', t: 0, x: cx + Math.cos(a) * R, y: cy + Math.sin(a) * R * 0.9, vx: Math.cos(a) * 220, vy: Math.sin(a) * 200 - 80 }); }
  }
  poke() { this.hop(1); this.happy(); this.heart(); }
  // Change picture (nap -> kitten -> grown) as one squash-and-pop, never a cross-fade.
  morph(id, pose) { if (id === this.id && pose === this.pose) return; this.next = [id, pose]; this.morphT = this.t; texture(this.base + id + FILES[pose] + '.webp'); }

  bind() {
    const c = this.c; let downAt = 0, timer = 0;
    const toPic = (e) => { const b = c.getBoundingClientRect(); return [FRAME.x0 + (e.clientX - b.left) / b.width * FRAME.w, FRAME.y0 + (e.clientY - b.top) / b.height * FRAME.h]; };
    c.addEventListener('pointerdown', (e) => { downAt = performance.now(); this.lookAt = toPic(e); timer = setTimeout(() => { this.purring = true; }, 420); c.setPointerCapture && c.setPointerCapture(e.pointerId); });
    c.addEventListener('pointermove', (e) => { this.lookAt = toPic(e); });
    const up = () => { clearTimeout(timer); if (!this.purring && performance.now() - downAt < 420) this.poke(); this.purring = false; };
    c.addEventListener('pointerup', up);
    c.addEventListener('pointercancel', () => { clearTimeout(timer); this.purring = false; });
    c.addEventListener('pointerleave', () => { if (!this.purring) this.lookAt = null; });
    c.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this.poke(); } });
  }

  update(dt) {
    this.t += dt; const t = this.t, r = this.rig, live = this.live;
    // morph: squash down, swap the picture at the bottom, pop up
    let Sover = null;
    if (this.morphT >= 0) {
      const u = (t - this.morphT) / M.morph.down;
      if (u < 1 && this.tex.ready) Sover = M.morph.depth * u * u;
      else if (texture(this.base + this.next[0] + FILES[this.next[1]] + '.webp').ready) {
        this.set(...this.next); this.next = null; this.morphT = -1;
        this.S.x = M.morph.depth; this.S.v = M.morph.pop; this.sparkle(); this.blinkAt = t + 0.6;
      }
    }
    // hop: crouch, fly, land with a squash
    let hop = 0;
    if (this.hopT >= 0) {
      const u = t - this.hopT, c = M.hop.crouch, T = M.hop.time;
      if (u < c) Sover = -0.1 * Math.sin((u / c) * Math.PI / 2);
      else if (u < c + T) { const f = (u - c) / T; hop = 4 * M.hop.height * f * (1 - f); if (this.S.v < 1 && f < 0.2) this.S.v = M.hop.takeoff; }
      else { this.S.v += M.hop.land; this.hops--; this.hopT = this.hops > 0 ? t + 0.05 : -1; }
    }
    if (Sover !== null) { this.S.x = Sover; this.S.v = 0; } else this.S.step(dt);
    // blinks (and a squint while happy or purring)
    let k = 0;
    if (r.eyes && live) {
      if (t >= this.blinkAt && this.blinkT < 0) { this.blinkT = t; this.blinkTwice = this.r() < M.blink.double; }
      if (this.blinkT >= 0 && t >= this.blinkT) {
        const B = M.blink, u = t - this.blinkT, total = B.close + B.hold + B.open;
        k = u < B.close ? (u / B.close) ** 2 : u < B.close + B.hold ? 1 : u < total ? 1 - ss(0, 1, (u - B.close - B.hold) / B.open) : 0;
        k *= B.depth;
        if (u >= total) { this.blinkT = this.blinkTwice ? t + 0.06 : -1; this.blinkTwice = false; this.blinkAt = t + between(this.r, B.every); }
      }
      this.squint.to = this.purring ? M.purr.squint : t < this.happyUntil ? 0.72 : 0;
      k = Math.max(k, this.squint.step(dt));
    }
    // ears, head, tail
    if (live && r.ears && t >= this.earAt) { this.flick(this.r() < 0.5 ? 0 : 1); this.earAt = t + between(this.r, M.ears.every); }
    this.ear.forEach((s) => s.step(dt));
    if (live && t >= this.tiltAt && r.head) { this.tilt((this.r() < 0.5 ? -1 : 1) * M.head.tilt); this.tiltAt = t + between(this.r, M.head.tiltEvery); }
    let th = live ? M.head.drift * (0.6 * Math.sin(t * 2 * Math.PI / 6.1 + this.ph) + 0.4 * Math.sin(t * 2 * Math.PI / 3.7 + 2 * this.ph)) : 0;
    let lx = 0, ly = 0;
    if (this.lookAt && r.head) {
      const dx = this.lookAt[0] - r.head[0], dy = this.lookAt[1] - r.head[1], d = Math.hypot(dx, dy) || 1, m = Math.min(M.look.max, d * 0.08);
      lx = dx / d * m; ly = dy / d * m * 0.6; th += clamp(dx / 512, -1, 1) * 0.08;
    }
    if (this.purring) th += 0.1;
    this.head.to = th + (t < this.tiltUntil ? this.tiltTo : 0);
    this.head.step(dt); this.lx.to = lx; this.ly.to = ly; this.lx.step(dt); this.ly.step(dt);
    this.tailS.step(dt);
    const tail = live ? M.tail.swing * Math.sin(t * 2 * Math.PI / M.tail.period + this.ph) * (0.65 + 0.35 * Math.sin(t * 2 * Math.PI / 7.3)) + this.tailS.x * 0.4 : 0;
    // breathing: a quicker breath in, a slower breath out
    const B = this.pose === 'nap' ? M.nap : M.breath, p = ((t + this.ph) / B.period) % 1;
    const br = (p < B.inhale ? ss(0, 1, p / B.inhale) : 1 - ss(0, 1, (p - B.inhale) / (1 - B.inhale))) - 0.5;
    const amp = reduce ? 0.4 : 1;
    this.P = {
      k, ears: [this.ear[0].x, this.ear[1].x], tail, th: this.head.x, hx: this.lx.x, hy: this.ly.x,
      bv: B.tall * br * amp, bx: B.belly * br * amp, S: this.S.x, nap: this.pose === 'nap',
      lean: live ? M.sway.lean * Math.sin(t * 2 * Math.PI / M.sway.period + this.ph) : 0,
      jx: this.purring ? M.purr.px * Math.sin(t * 2 * Math.PI * M.purr.hz) : 0, hop,
    };
    if (this.old) { // the picture as the app shows it today: the web's catbob, nothing else
      const s = (1 - Math.cos(t * 2 * Math.PI / 4)) / 2;
      this.P = { k: 0, ears: [0, 0], tail: 0, th: 0, hx: 0, hy: 0, bv: -0.015 * s, bx: 0, S: 0, nap: false, lean: 0, jx: 0, hop: 0, oldX: 0.015 * s };
    }
    if (root.__kvPose) Object.assign(this.P, root.__kvPose); // for checking frames: freeze a pose on every cat
    if (this.purring && (this.purrHeart = (this.purrHeart || 0) - dt) < 0) { this.heart(); this.purrHeart = 0.55; }
    if (this.pose === 'nap' && live && (this.zAt -= dt) < 0) { this.fx.push({ kind: 'z', t: 0, x: r.mid + 70, y: r.top + 30 }); this.zAt = 1.7; }
    for (const f of this.fx) { f.t += dt; if (f.vx !== undefined) { f.x += f.vx * dt; f.y += (f.vy ?? -90) * dt; if (f.vy !== undefined) f.vy += 300 * dt; } }
    this.fx = this.fx.filter((f) => f.t < (f.kind === 'z' ? 2.2 : f.kind === 'spark' ? 0.6 : 1.3));
  }

  render() {
    const R = renderer(), w = this.c.width, h = this.c.height, ctx = this.ctx;
    if (!w || !h || !this.tex.ready) return;
    ctx.clearRect(0, 0, w, h);
    const sx = w / FRAME.w, sy = h / FRAME.h, X = (x) => (x - FRAME.x0) * sx, Y = (y) => (y - FRAME.y0) * sy, r = this.rig;
    if (this.shadow) {
      const lift = clamp(1 - this.P.hop / 90, 0.4, 1), rx = 0.36 * r.w * lift * sx, ry = 0.05 * r.w * lift * sy;
      ctx.save(); ctx.translate(X(r.mid), Y(r.ground - 4)); ctx.scale(1, ry / rx);
      const gr = ctx.createRadialGradient(0, 0, 0, 0, 0, rx); gr.addColorStop(0, `rgba(40,30,20,${0.2 * lift * this.alpha})`); gr.addColorStop(1, 'rgba(40,30,20,0)');
      ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(0, 0, rx, 0, Math.PI * 2); ctx.fill(); ctx.restore();
    }
    if (R.gl) {
      const gl = R.gl;
      if (this.P.oldX !== undefined) oldMesh(R.pos, r, this.W, this.P); else deform(R.pos, r, this.W, this.P);
      gl.viewport(0, 1024 - h, w, h); gl.scissor(0, 1024 - h, w, h);
      gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
      gl.bindBuffer(gl.ARRAY_BUFFER, R.pb); gl.bufferData(gl.ARRAY_BUFFER, R.pos, gl.DYNAMIC_DRAW);
      gl.bindTexture(gl.TEXTURE_2D, this.tex.tex);
      gl.uniform1f(R.uA, this.alpha); gl.uniform1f(R.uSat, this.sat);
      gl.drawElements(gl.TRIANGLES, R.count, gl.UNSIGNED_SHORT, 0);
      ctx.drawImage(R.c, 0, 0, w, h, 0, 0, w, h);
    } else {
      ctx.globalAlpha = this.alpha; ctx.drawImage(this.tex.img, X(0), Y(0), N * sx, N * sy); ctx.globalAlpha = 1;
    }
    for (const f of this.fx) drawFx(ctx, f, X, Y, sx);
  }
}

function oldMesh(out, r, W, P) {
  const g = r.ground, m = r.mid;
  for (let i = 0; i < W.x0.length; i++) {
    const x = m + (W.x0[i] - m) * (1 + P.oldX), y = g - (g - W.y0[i]) * (1 + P.bv);
    out[i * 2] = (x - FRAME.x0) / FRAME.w * 2 - 1; out[i * 2 + 1] = 1 - (y - FRAME.y0) / FRAME.h * 2;
  }
}

function drawFx(ctx, f, X, Y, s) {
  const x = X(f.x), y = Y(f.y);
  if (f.kind === 'heart') {
    const a = 1 - ss(0.7, 1.3, f.t), k = (14 + 8 * ss(0, 0.25, f.t)) * s;
    ctx.save(); ctx.globalAlpha = a; ctx.translate(x, y); ctx.scale(k / 10, k / 10); ctx.fillStyle = '#f0607a';
    ctx.beginPath(); ctx.moveTo(0, 3); ctx.bezierCurveTo(-9, -4, -5, -11, 0, -6); ctx.bezierCurveTo(5, -11, 9, -4, 0, 3); ctx.fill(); ctx.restore();
  } else if (f.kind === 'spark') {
    const a = 1 - f.t / 0.6, k = 9 * s * (1 - f.t);
    ctx.save(); ctx.globalAlpha = a; ctx.translate(x, y); ctx.fillStyle = '#ffc94d';
    ctx.beginPath(); for (let i = 0; i < 8; i++) { const rr = i % 2 ? k * 0.35 : k, an = i * Math.PI / 4; ctx.lineTo(Math.cos(an) * rr, Math.sin(an) * rr); } ctx.fill(); ctx.restore();
  } else if (f.kind === 'z') {
    const a = ss(0, 0.3, f.t) * (1 - ss(1.4, 2.2, f.t));
    ctx.save(); ctx.globalAlpha = a * 0.8; ctx.fillStyle = '#7d8fa8'; ctx.font = `600 ${Math.round((20 + f.t * 14) * s)}px system-ui, sans-serif`;
    ctx.fillText('z', x + f.t * 26 * s, y - f.t * 60 * s); ctx.restore();
  }
}

// ---------- one loop ----------
let running = false, last = 0;
const tickers = new Set();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000 || 0.016); last = now;
  if (!document.hidden) {
    for (const f of tickers) f(dt);
    for (const c of all) { if (c.off) continue; c.update(dt); if (c.visible) c.render(); }
  }
  requestAnimationFrame(frame);
}
function start() { if (!running) { running = true; renderer(); requestAnimationFrame((t) => { last = t; frame(t); }); } }

root.KavanaWarp = { Cat, Spring, renderer, texture, start, tickers, M, FRAME, G, deform, weights, reduce, cats: all };
})(typeof window !== 'undefined' ? window : globalThis);
