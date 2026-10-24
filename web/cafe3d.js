// The Cat Café in 3D: a floating room you can spin, with the cats that came home in it, on the things
// you bought. One canvas, the real paintings, no libraries. The camera is orthographic, looking down 60°
// (the floor squashes by K, one tile of height rises by KZ), and spins in 90° steps when you let go.
//
//   const cafe = KavanaCafe3D.create(box);   // a canvas and a label inside box
//   cafe.show({ size: 'week', theme, light, things: ['rug', 'cushion'], cats: [...], residents, gone });
//   cafe.arrive(cat, '+25 🐟');               // a block came home: the cat drops in
(function (root) {
'use strict';
const reduce = typeof matchMedia !== 'undefined' ? matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };
const K = 0.5;          // floor squash: a 60° look down
const KZ = 0.866;       // how much one tile of height rises on screen
const Q = Math.PI / 2;
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const lerp = (a, b, t) => a + (b - a) * t;
const backOut = (t) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2; };
function rng(seed) { let s = (seed >>> 0) || 1; return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return (s >>> 0) / 4294967296; }; }
const FONT = 'ui-rounded, "SF Pro Rounded", -apple-system, BlinkMacSystemFont, system-ui, sans-serif';

// ---------- the paintings, trimmed to their painted part ----------
const ART = new Map();
const VIEWS = new Set();
function art(src) {
  let a = ART.get(src);
  if (a) return a;
  a = { img: new Image(), ok: false, bad: false, bx: 0, by: 0, bw: 1, bh: 1 };
  a.img.decoding = 'async';
  a.img.onload = () => {
    const w = a.img.naturalWidth, h = a.img.naturalHeight;
    a.bw = w; a.bh = h;
    try {
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      const g = c.getContext('2d', { willReadFrequently: true });
      g.drawImage(a.img, 0, 0);
      const d = g.getImageData(0, 0, w, h).data;
      let x0 = w, y0 = h, x1 = 0, y1 = 0;
      for (let y = 0; y < h; y += 2) for (let x = 0; x < w; x += 2) {
        if (d[(y * w + x) * 4 + 3] > 30) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
      }
      if (x1 > x0) { a.bx = x0; a.by = y0; a.bw = Math.min(w - x0, x1 - x0 + 2); a.bh = Math.min(h - y0, y1 - y0 + 2); }
    } catch { /* keep the whole picture */ }
    a.ok = true;
    for (const v of VIEWS) v.kick();
  };
  a.img.onerror = () => { a.bad = true; };
  a.img.src = src;
  ART.set(src, a);
  return a;
}

// Café themes, the same colors as the flat room had (style.css .theme-*), plus the base the room floats on.
const THEMES = {
  classic: { wall: ['#fdf5e8', '#f5e4cb'], dots: 'rgba(196,150,104,.32)', skirt: '#ecd2ae', skirtLine: '#d9b386', floor: ['#e8bd85', '#dba56b'], board: 'rgba(124,74,34,.17)', slab: '#b9845a', trim: '#f6dcb6' },
  mint: { wall: ['#e8f6ee', '#d3ebde'], dots: 'rgba(60,140,100,.24)', skirt: '#cfe3d6', skirtLine: '#a9c9b5', floor: ['#ead4ab', '#dcc191'], board: 'rgba(120,85,40,.15)', slab: '#a48a66', trim: '#f1e5c9' },
  sakura: { wall: ['#fde9f0', '#f8d5e2'], dots: 'rgba(225,120,155,.36)', skirt: '#f3c9d6', skirtLine: '#e3a2b7', floor: ['#f2ddc9', '#e5c9b0'], board: 'rgba(150,90,70,.13)', slab: '#c99c88', trim: '#fbe8dd' },
  library: { wall: ['#31604c', '#284f3e'], dots: 'rgba(255,230,180,.16)', skirt: '#5b3b26', skirtLine: '#462c1c', floor: ['#7c5438', '#684430'], board: 'rgba(0,0,0,.22)', slab: '#4d3322', trim: '#8c6748' },
  garden: { wall: ['#eaf7ff', '#cfe9fb'], dots: 'rgba(255,255,255,.85)', skirt: '#8fcf7a', skirtLine: '#76b862', floor: ['#9fd480', '#86c266'], board: 'rgba(60,120,40,.16)', slab: '#7b9a5a', trim: '#d8efc6' },
  night: { wall: ['#232849', '#2d3257'], dots: 'rgba(255,240,180,.6)', skirt: '#3a3550', skirtLine: '#4c4568', floor: ['#4f3d2e', '#403126'], board: 'rgba(0,0,0,.28)', slab: '#2e2622', trim: '#5d4f43' },
};
// The light: a tint over the whole room, and at evening and night a warm glow around the lamps.
const LIGHTS = {
  morning: { tint: 'rgba(160,200,255,.12)' },
  day: {},
  evening: { tint: 'rgba(255,120,40,.16)', glow: 'rgba(255,214,150,.28)', r: 1.9 },
  night: { tint: 'rgba(18,22,66,.3)', glow: 'rgba(255,200,120,.34)', r: 2.0 },
};
const lightAt = (t = Date.now()) => { const h = new Date(t).getHours(); return h >= 5 && h < 10 ? 'morning' : h < 17 && h >= 10 ? 'day' : h >= 17 && h < 21 ? 'evening' : 'night'; };

// Where each thing goes: u, v as a share of the room (the back walls are at u = 0 and v = 0 when the
// café first faces you), w its width in tiles, fp what it covers on the floor, perch the share of its
// height a cat sits at, light how high its glow is. Lower `pri` gets placed first, so in a small room
// the things to sit on win.
const PLACE = {
  cattree: { u: 0.12, v: 0.12, w: 1.05, perch: 0.93, pri: 1 },
  cushion: { u: 0.47, v: 0.5, w: 0.95, perch: 0.2, pri: 1 },
  box: { u: 0.8, v: 0.8, w: 1.0, perch: 0.48, pri: 1 },
  armchair: { u: 0.15, v: 0.8, w: 1.3, fp: [1.05, 1.2], perch: 0.42, pri: 1 },
  counter: { u: 0.6, v: 0.12, w: 2.05, fp: [2.1, 1.1], perch: 0.6, pri: 2 },
  fireplace: { u: 0.1, v: 0.48, w: 1.35, fp: [0.9, 1.45], light: 0.35, pri: 2 },
  bookshelf: { u: 0.9, v: 0.1, w: 0.95, perch: 0.97, pri: 3 },
  lamp: { u: 0.09, v: 0.3, w: 0.72, light: 0.9, pri: 4 },
  plant: { u: 0.9, v: 0.48, w: 0.84, pri: 5 },
  fishbowl: { u: 0.9, v: 0.3, w: 0.64, pri: 6 },
  yarnbasket: { u: 0.43, v: 0.88, w: 0.72, pri: 6 },
  jackolantern: { u: 0.64, v: 0.34, w: 0.82, light: 0.6, pri: 7 },
  cauldron: { u: 0.3, v: 0.66, w: 0.8, light: 0.5, pri: 7 },
  snowman: { u: 0.72, v: 0.56, w: 0.85, pri: 7 },
  candles: { u: 0.88, v: 0.66, w: 0.42, light: 0.7, pri: 8 },
  sled: { u: 0.56, v: 0.9, w: 1.1, fp: [1.15, 0.8], pri: 8 },
  snowglobe: { u: 0.32, v: 0.3, w: 0.5, pri: 9 },
};
// On the walls: which back wall, how far along (a share of it), how far down from the top, how wide.
const WALL = {
  window: { edge: 'N', u: 0.33, v: 0.3, w: 1.5 },
  clock: { edge: 'W', u: 0.68, v: 0.42, w: 0.62 },
};
const SOFT = new Set(['cushion', 'box', 'armchair']);
const EDGES = { N: [[0, 0], [1, 0]], W: [[0, 0], [0, 1]], E: [[1, 0], [1, 1]], S: [[0, 1], [1, 1]] };
// Room sizes: the side in tiles, and how many cats fit before it gets crowded.
const SIZES = { day: { n: 4, fits: 8 }, week: { n: 6, fits: 22 }, month: { n: 8, fits: 38 }, big: { n: 10, fits: 60 } };
const ORDER = ['day', 'week', 'month', 'big'];
const POSE_W = { walk: 0.98, loaf: 0.82, stretch: 1.05, wash: 0.8, back: 0.78 };

// ---------- one view: a canvas, a camera that spins, and a scene ----------
class View {
  constructor(canvas, scene, opts = {}) {
    this.cv = canvas; this.g = canvas.getContext('2d');
    this.scene = scene; scene.view = this;
    this.angle = Math.PI / 4; this.goal = this.angle; this.spinV = 0;
    this.S = 0; this.ox = 0; this.oy = 0; this.t = Math.random() * 10; this.last = 0;
    this.on = true; this.fx = []; this.tipFor = null; this.opts = opts;
    this.tip = opts.tip || null;
    VIEWS.add(this);
    this.resize();
    if (typeof ResizeObserver !== 'undefined') new ResizeObserver(() => this.resize()).observe(canvas);
    if (typeof IntersectionObserver !== 'undefined') new IntersectionObserver((e) => { this.on = e[e.length - 1].isIntersecting; if (this.on) this.kick(); }).observe(canvas);
    this.wire();
    this.kick();
  }
  resize() {
    const r = this.cv.getBoundingClientRect();
    if (!r.width || !r.height) return;
    this.dpr = Math.min(2, root.devicePixelRatio || 1);
    this.W = r.width; this.H = r.height;
    this.cv.width = Math.round(r.width * this.dpr); this.cv.height = Math.round(r.height * this.dpr);
    this.S = 0; this.fit(0);
    this.kick();
  }
  kick() { if (!this.raf && this.W && this.cv.isConnected) this.raf = requestAnimationFrame((t) => this.frame(t)); }
  spin(by) { this.goal += by; this.kick(); }
  // Fit the room to the canvas. dt = 0 jumps; otherwise it eases (a bigger room zooms out).
  fit(dt) {
    const e = this.scene.extent(this);
    const m = this.opts.margin ?? 14;
    const S = Math.min((this.W - 2 * m) / (e.x1 - e.x0), (this.H - 2 * m) / (e.y1 - e.y0));
    const k = dt && !reduce.matches ? 1 - Math.exp(-dt * 7) : 1;
    this.S = this.S ? lerp(this.S, S, k) : S;
    const cx = this.W / 2 - ((e.x0 + e.x1) / 2) * this.S;
    const cy = this.H / 2 - ((e.y0 + e.y1) / 2) * this.S;
    this.ox = this.ox && k < 1 ? lerp(this.ox, cx, k) : cx;
    this.oy = this.oy && k < 1 ? lerp(this.oy, cy, k) : cy;
  }
  // Tiles (x, y on the floor, z up) to the screen. d is the depth: bigger is nearer.
  P(x, y, z = 0) {
    const [cx, cy] = this.scene.center;
    const dx = x - cx, dy = y - cy;
    const rx = dx * this.ca - dy * this.sa, ry = dx * this.sa + dy * this.ca;
    return { x: this.ox + rx * this.S, y: this.oy + ry * this.S * K - z * this.S * KZ, d: ry };
  }
  unit(x, y, z = 0) {
    const [cx, cy] = this.scene.center;
    const ca = Math.cos(this.angle), sa = Math.sin(this.angle);
    const dx = x - cx, dy = y - cy;
    return { x: dx * ca - dy * sa, y: (dx * sa + dy * ca) * K - z * KZ };
  }
  // Which way the room faces now, in quarter turns from the start (0 to 3).
  quarter() { return (((Math.round((this.angle - Math.PI / 4) / Q)) % 4) + 4) % 4; }
  frame(now) {
    this.raf = 0;
    if (!this.cv.isConnected) return;
    const dt = Math.min(0.05, (now - (this.last || now)) / 1000);
    this.last = now; this.t += dt;
    if (!this.drag) {
      const d = this.goal - this.angle;
      if (reduce.matches) { this.angle = this.goal; this.spinV = 0; } else {
        this.spinV += (d * 70 - this.spinV * 14) * dt;
        this.angle += this.spinV * dt;
        if (Math.abs(d) < 1e-4 && Math.abs(this.spinV) < 1e-3) { this.angle = this.goal; this.spinV = 0; }
      }
    }
    this.ca = Math.cos(this.angle); this.sa = Math.sin(this.angle);
    this.fit(dt);
    this.scene.update(this, dt);
    this.updateFx(dt);
    this.draw();
    const moving = this.angle !== this.goal || this.fx.length || this.drag || this.scene.busy();
    if (this.on && document.visibilityState === 'visible' && (moving || !reduce.matches)) this.kick();
  }
  draw() {
    const g = this.g;
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.clearRect(0, 0, this.W, this.H);
    this.scene.draw(this, g);
    this.drawFx(g);
    this.placeTip();
  }
  // Draw on a plane: o is a screen point, u and v are screen vectors for one tile.
  plane(g, o, u, v) { g.setTransform(this.dpr * u.x, this.dpr * u.y, this.dpr * v.x, this.dpr * v.y, this.dpr * o.x, this.dpr * o.y); }
  reset(g) { g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0); }

  // ---- sparkles and a floating "+25 🐟" ----
  sparkle(x, y, z, n = 10, color = '#ffd45a') {
    if (reduce.matches) return;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + Math.random() * 0.5;
      this.fx.push({ kind: 'star', x, y, z, a, r: 0, sp: 0.9 + Math.random() * 0.9, life: 0, max: 0.7 + Math.random() * 0.4, size: 4 + Math.random() * 4, color });
    }
  }
  float(x, y, z, text) { this.fx.push({ kind: 'text', x, y, z, text, life: 0, max: 1.6 }); this.kick(); }
  updateFx(dt) { for (const f of this.fx) { f.life += dt; f.r += (f.sp || 0) * dt; } this.fx = this.fx.filter((f) => f.life < f.max); }
  drawFx(g) {
    for (const f of this.fx) {
      const p = this.P(f.x, f.y, f.z);
      const t = f.life / f.max;
      if (f.kind === 'star') {
        const r = f.r * this.S * 0.9;
        const x = p.x + Math.cos(f.a) * r, y = p.y + Math.sin(f.a) * r * 0.7 - t * 10;
        const s = f.size * (1 - t) * 1.4;
        g.save(); g.translate(x, y); g.globalAlpha = 1 - t; g.fillStyle = f.color;
        g.beginPath();
        for (let i = 0; i < 4; i++) { const an = i * Q; g.lineTo(Math.cos(an) * s, Math.sin(an) * s); g.lineTo(Math.cos(an + Q / 2) * s * 0.32, Math.sin(an + Q / 2) * s * 0.32); }
        g.closePath(); g.fill(); g.restore();
      } else {
        g.save(); g.globalAlpha = t < 0.75 ? 1 : 1 - (t - 0.75) / 0.25;
        g.font = `800 ${Math.round(clamp(this.S * 0.32, 14, 22))}px ${FONT}`; g.textAlign = 'center';
        g.lineWidth = 4; g.strokeStyle = 'rgba(255,255,255,.95)'; g.fillStyle = '#1e2627';
        const y = p.y - 8 - (reduce.matches ? 12 : t * 34);
        g.strokeText(f.text, p.x, y); g.fillText(f.text, p.x, y); g.restore();
      }
    }
  }

  // ---- a label that follows a cat or a thing ----
  showTip(target, title, sub) {
    if (!this.tip) return;
    this.tipFor = target;
    this.tip.replaceChildren();
    const b = document.createElement('b'); b.textContent = title;
    const s = document.createElement('span'); s.textContent = sub || '';
    this.tip.append(b, s);
    this.tip.hidden = false;
    clearTimeout(this.tipTimer);
    this.tipTimer = setTimeout(() => { this.tip.hidden = true; this.tipFor = null; }, 3200);
    this.placeTip();
  }
  hideTip() { if (this.tip) this.tip.hidden = true; this.tipFor = null; }
  placeTip() {
    if (!this.tip || this.tip.hidden || !this.tipFor || !this.tipFor.rect) return;
    const r = this.tipFor.rect;
    this.tip.style.left = `${clamp(r.x + r.w / 2, 80, this.W - 80)}px`;
    this.tip.style.top = `${Math.max(8, r.y - 6)}px`;
  }

  // ---- drag to spin, tap a cat or a thing ----
  wire() {
    const cv = this.cv;
    cv.addEventListener('pointerdown', (e) => {
      this.drag = { x: e.clientX, a: this.angle, moved: false, id: e.pointerId };
      this.spinV = 0;
    });
    cv.addEventListener('pointermove', (e) => {
      if (!this.drag) return;
      const dx = e.clientX - this.drag.x;
      if (!this.drag.moved && Math.abs(dx) > 6) { this.drag.moved = true; try { cv.setPointerCapture(this.drag.id); } catch { /* fine */ } }
      if (this.drag.moved) { this.angle = this.drag.a + dx * 0.012; this.goal = this.angle; this.kick(); }
    });
    const up = (e) => {
      if (!this.drag) return;
      const d = this.drag; this.drag = null;
      if (d.moved) {
        this.goal = Math.round((this.angle - Math.PI / 4) / Q) * Q + Math.PI / 4;
        this.kick();
      } else if (e.type === 'pointerup') {
        const r = this.cv.getBoundingClientRect();
        this.scene.tap(this, e.clientX - r.left, e.clientY - r.top);
        this.kick();
      }
    };
    cv.addEventListener('pointerup', up);
    cv.addEventListener('pointercancel', up);
    cv.tabIndex = 0;
    cv.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowLeft') { this.spin(-Q); e.preventDefault(); }
      if (e.key === 'ArrowRight') { this.spin(Q); e.preventDefault(); }
    });
  }
}

// ---------- drawing ----------
function poly(g, pts, fill, stroke, lw = 1) {
  g.beginPath(); g.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) g.lineTo(pts[i].x, pts[i].y);
  g.closePath();
  if (fill) { g.fillStyle = fill; g.fill(); }
  if (stroke) { g.strokeStyle = stroke; g.lineWidth = lw; g.stroke(); }
}
function hex(c) { const m = /^#?([0-9a-f]{6})$/i.exec(String(c).trim()); if (!m) return [128, 128, 128]; const n = parseInt(m[1], 16); return [n >> 16, (n >> 8) & 255, n & 255]; }
function shade(c, f) { const [r, g, b] = hex(c); const s = (x) => Math.round(f < 0 ? x * (1 + f) : x + (255 - x) * f); return `rgb(${s(r)},${s(g)},${s(b)})`; }
function sprite(v, g, s) {
  const a = art(s.src);
  if (!a.ok) return null;
  const pop = s.pop === undefined ? 1 : s.pop <= 0 ? 0 : backOut(clamp(s.pop, 0, 1));
  if (pop <= 0.01) { s.rect = null; return null; }
  const p = v.P(s.x, s.y, s.z + (s.hop || 0));
  let w = s.w * v.S * pop, h = w * a.bh / a.bw;
  if (s.cat && !reduce.matches) { // breathing: a little taller, a little narrower
    const b = Math.sin((v.t + s.phase) * Math.PI * 2 / (s.nap ? 5.2 : 3.6));
    h *= 1 + 0.024 * b; w *= 1 - 0.008 * b;
  }
  if (s.squash) { h *= 1 - s.squash; w *= 1 + s.squash * 0.6; }
  if (s.shadow !== false) {
    const sp = v.P(s.x, s.y, s.seat ? s.z : 0);
    g.fillStyle = s.cat ? 'rgba(70,40,15,.18)' : 'rgba(70,40,15,.14)';
    g.beginPath(); g.ellipse(sp.x, sp.y, w * 0.4, w * 0.4 * K, 0, 0, Math.PI * 2); g.fill();
  }
  g.save();
  g.translate(p.x, p.y);
  if (s.flip) g.scale(-1, 1);
  if (s.lean) g.rotate(s.lean);
  if (s.wiggle) g.rotate(Math.sin(s.wiggle * 30) * 0.18 * s.wiggle);
  g.globalAlpha = s.alpha ?? 1;
  if (s.ghost) g.globalAlpha *= 0.85;
  g.drawImage(a.img, a.bx, a.by, a.bw, a.bh, -w / 2, -h, w, h);
  g.restore();
  s.rect = { x: p.x - w / 2, y: p.y - h, w, h };
  return s.rect;
}
const heightZ = (s) => { const a = art(s.src); return a.ok ? (s.w * a.bh / a.bw) / KZ : s.w / KZ; };

// ---------- the café ----------
class Cafe {
  constructor() {
    this.n = 6; this.center = [3, 3];
    this.theme = 'classic'; this.light = 'day'; this.dim = false;
    this.wallH = 2.25; this.depth = 0.5; this.rim = 0.14;
    this.things = []; this.walls = []; this.cats = []; this.prints = []; this.rug = null; this.views = {};
    this.sig = '';
  }
  // What to draw: data = { size, theme, light, dim, things: [ids], views: { id: { side, back } },
  // cats: [{ key, id, src, kitten, nap, poses, title, sub, ghost }], residents: [...the same], gone: [keys], seed, quiet }
  show(data) {
    const sig = JSON.stringify([data.size, data.things, data.cats.map((c) => [c.key, c.src]), (data.residents || []).map((c) => c.key), data.gone, data.seed]);
    this.theme = THEMES[data.theme] ? data.theme : 'classic';
    this.light = LIGHTS[data.light] ? data.light : 'day';
    this.dim = Boolean(data.dim);
    this.views = data.views || {};
    if (sig === this.sig) { this.view?.kick(); return; } // the same café: let the cats keep doing what they're doing
    const fresh = !this.sig || data.quiet === false;
    this.sig = sig;
    const total = data.cats.length + (data.residents || []).length;
    let i = Math.max(0, ORDER.indexOf(data.size)); // the period's room, or a bigger one when it's crowded
    while (i < ORDER.length - 1 && total > SIZES[ORDER[i]].fits) i++;
    const size = ORDER[i];
    this.size = size;
    this.n = SIZES[size].n; this.center = [this.n / 2, this.n / 2];
    const r = rng(data.seed || 7);
    this.layout(data.things);
    this.cats = []; this.prints = [];
    const seats = this.things.filter((t) => t.perch).sort((a, b) => a.pri - b.pri);
    let walkers = 0, posers = 0;
    data.cats.forEach((c, i) => {
      const seat = seats[i];
      if (seat) { this.addCat(c, { seat, nap: c.nap ?? (SOFT.has(seat.id) && r() < 0.55) }); return; }
      const spot = this.freeSpot(r); if (!spot) return;
      const pose = c.poses && posers < 3 && !reduce.matches;
      const walker = !pose && walkers < 3 && !c.kitten && !reduce.matches && r() < 0.3;
      const m = this.addCat(c, { x: spot[0], y: spot[1], walker, nap: c.nap ?? (!walker && !pose && r() < 0.3) });
      if (pose) { posers++; m.poses = c.poses; m.wait = 1 + r() * 3; m.nap = false; m.src = c.src; }
      if (walker) walkers++;
    });
    for (const c of data.residents || []) { const spot = this.freeSpot(r, 'back'); if (spot) this.addCat(c, { x: spot[0], y: spot[1] }); }
    // The kittens that wandered off left paw prints.
    for (const key of (data.gone || []).slice(0, 6)) {
      const pr = rng(hash(key));
      const s = this.freeSpot(pr);
      if (s) { const a = pr() * Math.PI * 2; this.trail(s[0], s[1], clamp(s[0] + Math.cos(a) * 1.3, 0.3, this.n - 0.3), clamp(s[1] + Math.sin(a) * 1.3, 0.3, this.n - 0.3)); }
    }
    if (fresh && !reduce.matches) { // pop in, back to front
      const all = [...this.things, ...this.cats].sort((a, b) => (a.x + a.y) - (b.x + b.y));
      all.forEach((s, k) => { s.pop = -k * Math.min(0.045, 1.2 / all.length); });
    }
    this.view?.kick();
  }
  layout(ids) {
    const n = this.n;
    this.things = []; this.walls = []; this.rug = null;
    const own = new Set(ids);
    if (own.has('rug')) { const w = n * 0.42, h = n * 0.32; this.rug = [n / 2 - w / 2 + n * 0.04, n / 2 - h / 2 + n * 0.06, w, h]; }
    for (const [id, w] of Object.entries(WALL)) if (own.has(id)) this.walls.push({ id, edge: w.edge, u: w.u * n, v: w.v, w: w.w });
    if (own.has('batgarland')) for (const edge of ['N', 'W']) this.walls.push({ id: 'batgarland', edge, u: n / 2, v: 0.05, w: Math.min(n - 0.6, 4.2) });
    this.walls.push({ edge: 'E', door: true, u: n * 0.55 });
    // The snow globe sits on the window sill when there's a window.
    const sill = own.has('snowglobe') && own.has('window');
    if (sill) { const win = this.walls.find((x) => x.id === 'window'); this.walls.push({ id: 'snowglobe', edge: 'N', u: win.u - 0.42, v: win.v + 0.98, w: 0.36 }); }
    const list = Object.entries(PLACE).filter(([id]) => own.has(id) && !(id === 'snowglobe' && sill)).sort((a, b) => a[1].pri - b[1].pri);
    const big = n >= 6 ? 1 : 0.86; // a little smaller in the smallest room
    for (const [id, p] of list) {
      const t = { id, src: `cafe/${id}-1.webp`, w: p.w * big, fp: p.fp && p.fp.map((x) => x * big), perch: p.perch, light: p.light, pri: p.pri, z: 0, pop: 1 };
      const spot = this.spotNear(p.u * n, p.v * n, t);
      if (!spot) continue; // no room for it in a room this size
      [t.x, t.y] = spot;
      this.things.push(t);
    }
  }
  foot(t) { return t.fp || [t.w * 0.9, t.w * 0.9]; }
  // The free floor nearest to (x, y), for a thing of this size, searching outwards.
  spotNear(x, y, t) {
    const n = this.n, [fw, fd] = this.foot(t);
    const ok = (px, py) => px - fw / 2 >= 0.08 && px + fw / 2 <= n - 0.08 && py - fd / 2 >= 0.08 && py + fd / 2 <= n - 0.08
      && !this.things.some((o) => { const [ow, od] = this.foot(o); return Math.abs(px - o.x) < (fw + ow) / 2 + 0.05 && Math.abs(py - o.y) < (fd + od) / 2 + 0.05; })
      && !(this.rug && t.id !== 'rug' && px > this.rug[0] + 0.3 && px < this.rug[0] + this.rug[2] - 0.3 && py > this.rug[1] + 0.3 && py < this.rug[1] + this.rug[3] - 0.3 && !SOFT.has(t.id) && t.id !== 'yarnbasket');
    const cx = clamp(x, fw / 2 + 0.08, n - fw / 2 - 0.08), cy = clamp(y, fd / 2 + 0.08, n - fd / 2 - 0.08);
    if (ok(cx, cy)) return [cx, cy];
    for (let rad = 0.25; rad < n * 0.6; rad += 0.25) {
      for (let k = 0; k < 16; k++) {
        const a = (k / 16) * Math.PI * 2;
        const px = cx + Math.cos(a) * rad, py = cy + Math.sin(a) * rad;
        if (ok(px, py)) return [px, py];
      }
    }
    return null;
  }
  occupied(x, y, pad = 0.55, self = null) {
    for (const t of this.things) {
      const [fw, fd] = this.foot(t);
      if (Math.abs(x - t.x) < fw / 2 + pad * 0.6 && Math.abs(y - t.y) < fd / 2 + pad * 0.6) return true;
    }
    for (const c of this.cats) if (c !== self && !c.seat && !c.leaving && Math.hypot(c.x - x, c.y - y) < pad * 1.3) return true;
    return false;
  }
  freeSpot(r, where) {
    for (let k = 0; k < 120; k++) {
      const x = 0.6 + r() * (this.n - 1.2), y = 0.6 + r() * (this.n - 1.2);
      if (where === 'back' && k < 80 && x + y > this.n * 0.9) continue;
      if (where === 'front' && k < 80 && x + y < this.n * 1.05) continue;
      if (!this.occupied(x, y, k > 90 ? 0.4 : 0.55)) return [x, y];
    }
    return null;
  }
  addCat(d, { seat, x, y, walker, nap } = {}) {
    const asleep = Boolean(nap && d.napSrc && !d.kitten);
    const c = {
      cat: true, key: d.key, id: d.id, title: d.title, sub: d.sub, ghost: d.ghost,
      base: d.src, napSrc: d.napSrc, src: asleep ? d.napSrc : d.src, w: d.kitten ? 0.66 : asleep ? 0.9 : 0.8, nap: asleep, kitten: Boolean(d.kitten),
      x: seat ? seat.x + 0.04 : x, y: seat ? seat.y + 0.06 : y, z: 0, seat, walker: Boolean(walker) && !seat,
      phase: (hash(d.key) % 600) / 100, pop: 1, wait: 1 + (hash(d.key) % 50) / 10, flip: hash(d.key) % 2 === 1,
    };
    if (seat) c.w = Math.min(c.w, seat.w * (asleep ? 0.86 : 0.76));
    this.cats.push(c);
    return c;
  }
  trail(x0, y0, x1, y1) {
    const n = Math.max(3, Math.round(Math.hypot(x1 - x0, y1 - y0) / 0.32));
    const ang = Math.atan2(y1 - y0, x1 - x0);
    for (let i = 0; i <= n; i++) this.prints.push({ x: lerp(x0, x1, i / n), y: lerp(y0, y1, i / n), a: ang, side: i % 2 });
  }
  count() { return this.cats.filter((c) => !c.leaving && !c.gone).length; }

  // A block came home: the cat drops in near the front, bounces, and the treats float up.
  arrive(d, text) {
    const r = rng(hash(d.key) ^ 0x5bd1);
    const spot = this.freeSpot(r, 'front') || this.freeSpot(r);
    if (!spot) return null;
    const c = this.addCat(d, { x: spot[0], y: spot[1] });
    c.text = text;
    if (reduce.matches) this.landed(c); else { c.fall = true; c.z = 3.2; c.vz = 0; }
    this.view?.kick();
    return c;
  }
  landed(c) {
    const v = this.view;
    if (!v) return;
    v.sparkle(c.x, c.y, 0.4, 12);
    if (c.text) v.float(c.x, c.y, heightZ(c) + 0.2, c.text);
    if (c.title) v.showTip(c, c.title, c.sub);
  }
  // A cat with poses walks somewhere, side-on and facing the way it goes, then does one thing there:
  // a loaf, a wash, a sit, or looking out of the window with its back to you.
  pose(c, p) {
    c.posed = p;
    c.src = p === 'sit' ? c.base : c.poses[p] || c.base;
    c.w = p === 'sit' || !c.poses[p] ? 0.8 : POSE_W[p];
    c.nap = p === 'loaf';
  }
  mind(v, c, dt) {
    if (c.to) {
      const dx = c.to[0] - c.x, dy = c.to[1] - c.y, d = Math.hypot(dx, dy);
      if (d < 0.05) {
        c.to = null; c.hop = 0; c.lean = 0; c.squash = 0.08;
        const pick = c.toWindow && c.poses.back ? 'back' : ['loaf', 'wash', 'sit', 'loaf'][Math.floor(Math.random() * 4)];
        this.pose(c, pick);
        c.wait = pick === 'back' ? 9 + Math.random() * 5 : pick === 'loaf' ? 7 + Math.random() * 6 : 4 + Math.random() * 3;
        return;
      }
      if (c.posed !== 'walk') this.pose(c, 'walk');
      const sp = Math.min(d, 0.6 * dt);
      c.x += (dx / d) * sp; c.y += (dy / d) * sp; c.step = (c.step || 0) + dt;
      const ph = Math.sin(c.step * 11);
      c.hop = Math.abs(ph) * 0.04; c.lean = ph * 0.02;
      const sx = v.P(c.to[0], c.to[1]).x - v.P(c.x, c.y).x;
      if (Math.abs(sx) > 1) c.flip = sx < 0; // the walking paintings face right
      return;
    }
    if ((c.wait -= dt) > 0) return;
    if (c.posed && c.posed !== 'stretch' && c.posed !== 'sit' && c.poses.stretch) { this.pose(c, 'stretch'); c.wait = 1.6; return; }
    const win = this.walls.find((w) => w.id === 'window');
    let to = null;
    c.toWindow = false;
    if (win && c.poses.back && Math.random() < 0.35) {
      const spot = [clamp(win.u, 0.8, this.n - 0.8), 0.7];
      if (!this.occupied(spot[0], spot[1], 0.45, c)) { to = spot; c.toWindow = true; }
    }
    for (let k = 0; !to && k < 14; k++) {
      const x = clamp(c.x + (Math.random() - 0.5) * 4, 0.6, this.n - 0.6), y = clamp(c.y + (Math.random() - 0.5) * 4, 0.6, this.n - 0.6);
      if (!this.occupied(x, y, 0.5, c) && Math.hypot(x - c.x, y - c.y) > 1) to = [x, y];
    }
    if (to) c.to = to; else c.wait = 2;
  }
  busy() { return this.cats.some((c) => c.fall || c.hopT !== undefined || c.pop < 1 || c.to) || this.things.some((t) => t.pop < 1 || t.wiggle); }
  update(v, dt) {
    for (const s of this.things) {
      if (s.pop < 1) s.pop = Math.min(1, s.pop + dt * 3.2);
      if (s.wiggle) s.wiggle = Math.max(0, s.wiggle - dt);
    }
    for (const c of this.cats) {
      if (c.pop < 1) c.pop = Math.min(1, c.pop + dt * 3.2);
      if (c.seat) c.z = heightZ(c.seat) * c.seat.perch * (c.seat.pop >= 1 ? 1 : backOut(clamp(c.seat.pop, 0, 1)));
      if (c.fall) {
        c.vz -= 13 * dt; c.z += c.vz * dt;
        if (c.z <= 0) {
          c.z = 0;
          if (c.vz < -2.5) { c.vz *= -0.28; c.squash = 0.22; if (!c.didLand) { c.didLand = true; this.landed(c); } } else { c.fall = false; c.vz = 0; }
        }
      }
      if (c.squash) c.squash = Math.max(0, c.squash - dt * 1.4);
      if (c.hopT !== undefined) {
        c.hopT += dt;
        const T = 0.38;
        c.hop = Math.sin(Math.PI * clamp(c.hopT / T, 0, 1)) * 0.45;
        if (c.hopT >= T) { c.hop = 0; c.hopT = undefined; c.squash = 0.14; }
      }
      if (c.fall || reduce.matches) continue;
      if (c.poses) { this.mind(v, c, dt); continue; }
      if (c.walker) this.walk(v, c, dt);
    }
  }
  walk(v, c, dt) { // a cat without walking pictures hops along, leaning into it
    if (c.to) {
      const dx = c.to[0] - c.x, dy = c.to[1] - c.y, d = Math.hypot(dx, dy);
      if (d < 0.05) { c.to = null; c.wait = 3 + Math.random() * 7; c.hop = 0; c.lean = 0; c.squash = 0.1; return; }
      const sp = Math.min(d, 0.55 * dt);
      c.x += (dx / d) * sp; c.y += (dy / d) * sp; c.step = (c.step || 0) + dt;
      const ph = Math.sin(c.step * 9);
      c.hop = Math.abs(ph) * 0.09;
      c.lean = 0.07 + ph * 0.035;
      if (Math.abs(ph) < 0.12) c.squash = 0.05;
      const sx = v.P(c.to[0], c.to[1]).x - v.P(c.x, c.y).x;
      if (Math.abs(sx) > 2) c.flip = sx < 0;
    } else if ((c.wait -= dt) <= 0) {
      for (let k = 0; k < 12; k++) {
        const x = clamp(c.x + (Math.random() - 0.5) * 3, 0.6, this.n - 0.6), y = clamp(c.y + (Math.random() - 0.5) * 3, 0.6, this.n - 0.6);
        if (!this.occupied(x, y, 0.5, c)) { c.to = [x, y]; break; }
      }
      if (!c.to) c.wait = 2;
    }
  }
  extent() {
    const n = this.n, r = (n / 2 + this.rim) * Math.SQRT2;
    return { x0: -r, x1: r, y0: -r * K - this.wallH * KZ - 0.15, y1: r * K + (this.depth + 0.35) * KZ };
  }
  // The picture of a thing for the way the room faces: its front, its side (flipped on the other
  // side), or its back, where those are painted. With no back (the model always turns an armchair
  // to face you), the side, mirrored, stands in for it: a turned chair reads better than a front.
  thingSrc(t, q) {
    const vw = this.views[t.id];
    if (!vw || q === 0) return { src: t.src, flip: false };
    if (q === 2 && vw.back) return { src: vw.back, flip: false };
    if (q === 2 && vw.side) return { src: vw.side, flip: true };
    if ((q === 1 || q === 3) && vw.side) return { src: vw.side, flip: q === 3 };
    return { src: t.src, flip: q === 3 };
  }
  draw(v, g) {
    const T = THEMES[this.theme];
    const n = this.n, R = this.rim, D = this.depth, H = this.wallH;
    // The shadow under the floating café
    const c0 = v.P(n / 2, n / 2, -D - 0.2);
    const sh = g.createRadialGradient(c0.x, c0.y, 0, c0.x, c0.y, n * 0.78 * v.S);
    sh.addColorStop(0, 'rgba(40,30,20,.22)'); sh.addColorStop(1, 'rgba(40,30,20,0)');
    g.save(); g.translate(c0.x, c0.y); g.scale(1, 0.42); g.translate(-c0.x, -c0.y);
    g.fillStyle = sh; g.beginPath(); g.arc(c0.x, c0.y, n * 0.78 * v.S, 0, Math.PI * 2); g.fill(); g.restore();
    // The base: the sides facing us, with bricks, then the rim on top
    const corners = [[-R, -R], [n + R, -R], [n + R, n + R], [-R, n + R]];
    for (let i = 0; i < 4; i++) {
      const a = corners[i], b = corners[(i + 1) % 4];
      const m = v.P((a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
      if (m.d <= 0) continue;
      const pts = [v.P(a[0], a[1], 0), v.P(b[0], b[1], 0), v.P(b[0], b[1], -D), v.P(a[0], a[1], -D)];
      const facing = Math.abs(a[0] === b[0] ? v.ca : v.sa);
      poly(g, pts, shade(T.slab, -0.12 * (1 - facing)));
      g.save(); g.beginPath(); g.moveTo(pts[0].x, pts[0].y); for (const p of pts.slice(1)) g.lineTo(p.x, p.y); g.closePath(); g.clip();
      g.strokeStyle = 'rgba(60,30,10,.16)'; g.lineWidth = 1;
      const L = n + 2 * R;
      for (let row = 1; row < 3; row++) { const z = -D * row / 3; const p1 = v.P(a[0], a[1], z), p2 = v.P(b[0], b[1], z); g.beginPath(); g.moveTo(p1.x, p1.y); g.lineTo(p2.x, p2.y); g.stroke(); }
      for (let row = 0; row < 3; row++) for (let k = 0; k <= L * 1.6; k++) {
        const t = (k + (row % 2) * 0.5) / (L * 1.6); if (t <= 0 || t >= 1) continue;
        const x = lerp(a[0], b[0], t), y = lerp(a[1], b[1], t);
        const p1 = v.P(x, y, -D * row / 3), p2 = v.P(x, y, -D * (row + 1) / 3);
        g.beginPath(); g.moveTo(p1.x, p1.y); g.lineTo(p2.x, p2.y); g.stroke();
      }
      g.restore();
    }
    poly(g, corners.map(([x, y]) => v.P(x, y, 0)), T.trim);
    // The floor, in boards
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) poly(g, [v.P(i, j), v.P(i + 1, j), v.P(i + 1, j + 1), v.P(i, j + 1)], (i + j) % 2 ? T.floor[0] : T.floor[1]);
    g.strokeStyle = T.board; g.lineWidth = 1;
    for (let k = 0; k <= n * 2; k++) { const p1 = v.P(0, k / 2), p2 = v.P(n, k / 2); g.beginPath(); g.moveTo(p1.x, p1.y); g.lineTo(p2.x, p2.y); g.stroke(); }
    // The rug, laid flat
    if (this.rug) {
      const [rx, ry, rw, rh] = this.rug;
      const rug = art('cafe/rug-1.webp');
      if (rug.ok) {
        const o = v.P(rx, ry), u = v.P(rx + 1, ry), w = v.P(rx, ry + 1);
        v.plane(g, o, { x: u.x - o.x, y: u.y - o.y }, { x: w.x - o.x, y: w.y - o.y });
        g.globalAlpha = 0.95; g.drawImage(rug.img, rug.bx, rug.by, rug.bw, rug.bh, 0, 0, rw, rh); g.globalAlpha = 1;
        v.reset(g);
      }
    }
    // Paw prints
    for (const p of this.prints) {
      const o = v.P(p.x, p.y), u = v.P(p.x + 1, p.y), w = v.P(p.x, p.y + 1);
      v.plane(g, o, { x: u.x - o.x, y: u.y - o.y }, { x: w.x - o.x, y: w.y - o.y });
      g.rotate(p.a); g.translate(0, p.side ? 0.07 : -0.07);
      g.fillStyle = 'rgba(110,70,40,.4)';
      g.beginPath(); g.ellipse(0, 0, 0.06, 0.05, 0, 0, Math.PI * 2); g.fill();
      for (const [tx, ty] of [[0.07, -0.045], [0.09, 0], [0.07, 0.045]]) { g.beginPath(); g.arc(tx, ty, 0.022, 0, Math.PI * 2); g.fill(); }
      v.reset(g);
    }
    // The two walls at the back (the front two are cut away, like a dollhouse)
    const walls = [];
    for (const [edge, [A, B]] of Object.entries(EDGES)) {
      const a = [A[0] * n, A[1] * n], b = [B[0] * n, B[1] * n];
      const m = v.P((a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
      if (m.d < -0.01 * n) walls.push({ edge, a, b, d: m.d });
    }
    walls.sort((p, q) => p.d - q.d);
    for (const w of walls) this.drawWall(v, g, w, T, H);
    for (const w of walls) {
      const out = w.edge === 'N' ? [0, -R] : w.edge === 'S' ? [0, R] : w.edge === 'W' ? [-R, 0] : [R, 0];
      const A = w.a, B = w.b;
      poly(g, [v.P(A[0], A[1], H), v.P(B[0], B[1], H), v.P(B[0] + out[0], B[1] + out[1], H), v.P(A[0] + out[0], A[1] + out[1], H)], T.trim, 'rgba(90,60,30,.18)');
      for (const E of [A, B]) {
        if (v.P(E[0], E[1]).d < -0.4 * n) continue; // the corner at the very back is hidden
        poly(g, [v.P(E[0], E[1], 0), v.P(E[0] + out[0], E[1] + out[1], 0), v.P(E[0] + out[0], E[1] + out[1], H), v.P(E[0], E[1], H)], shade(T.trim, -0.08));
      }
    }
    // Everything standing, back to front
    const q = v.quarter();
    const list = [...this.things, ...this.cats];
    for (const s of list) s._d = v.P(s.x, s.y).d + (s.seat ? 0.08 : 0) + (s.cat ? 0.01 : 0);
    list.sort((p, r) => p._d - r._d);
    for (const s of list) {
      if (s.cat) { sprite(v, g, s); continue; }
      const { src, flip } = this.thingSrc(s, q);
      const keep = s.src; s.src = art(src).bad ? keep : src; s.flip = flip;
      sprite(v, g, s);
      s.src = keep;
    }
    // Low walls along the front edges, so the room has a lip
    const lip = 0.2;
    for (const [edge, [A, B]] of Object.entries(EDGES)) {
      const a = [A[0] * n, A[1] * n], b = [B[0] * n, B[1] * n];
      const m = v.P((a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
      if (m.d < -0.01 * n) continue;
      const out = edge === 'N' ? [0, -R] : edge === 'S' ? [0, R] : edge === 'W' ? [-R, 0] : [R, 0];
      const fa = [a[0] + out[0], a[1] + out[1]], fb = [b[0] + out[0], b[1] + out[1]];
      poly(g, [v.P(fa[0], fa[1], 0), v.P(fb[0], fb[1], 0), v.P(fb[0], fb[1], lip), v.P(fa[0], fa[1], lip)], shade(T.skirt, -0.06));
      poly(g, [v.P(a[0], a[1], lip), v.P(b[0], b[1], lip), v.P(fb[0], fb[1], lip), v.P(fa[0], fa[1], lip)], T.trim, 'rgba(90,60,30,.15)');
    }
    this.drawLight(v, g);
  }
  drawWall(v, g, w, T, H) {
    let A = w.a, B = w.b, flip = false;
    if (v.P(B[0], B[1]).x < v.P(A[0], A[1]).x) { [A, B] = [B, A]; flip = true; }
    const L = this.n;
    const o = v.P(A[0], A[1], H), e = v.P(B[0], B[1], H);
    v.plane(g, o, { x: (e.x - o.x) / L, y: (e.y - o.y) / L }, { x: 0, y: v.S * KZ });
    const grad = g.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, T.wall[0]); grad.addColorStop(1, T.wall[1]);
    g.fillStyle = grad; g.fillRect(0, 0, L, H);
    const lit = w.edge === 'N' || w.edge === 'S' ? Math.abs(v.sa) : Math.abs(v.ca); // the light falls differently on each wall
    g.fillStyle = `rgba(80,50,20,${(0.1 * (1 - lit)).toFixed(3)})`; g.fillRect(0, 0, L, H);
    g.fillStyle = T.dots;
    for (let row = 0, yy = 0.22; yy < H - 0.4; row++, yy += 0.3) for (let xx = 0.15 + (row % 2) * 0.15; xx < L; xx += 0.3) { g.beginPath(); g.arc(xx, yy, 0.022, 0, Math.PI * 2); g.fill(); }
    g.fillStyle = T.skirt; g.fillRect(0, H - 0.22, L, 0.22);
    g.fillStyle = T.skirtLine; g.fillRect(0, H - 0.24, L, 0.04);
    for (const it of this.walls.filter((x) => x.edge === w.edge)) {
      const uu = flip ? L - it.u : it.u;
      if (it.door) { this.drawDoor(g, uu, H); continue; }
      const a = art(`cafe/${it.id}-1.webp`);
      if (!a.ok) continue;
      g.drawImage(a.img, a.bx, a.by, a.bw, a.bh, uu - it.w / 2, it.v, it.w, it.w * a.bh / a.bw);
    }
    v.reset(g);
  }
  drawDoor(g, u, H) {
    const w = 0.95, h = 1.75, x = u - w / 2, y = H - h - 0.04;
    const rr = (x1, y1, w1, h1, r) => { g.beginPath(); if (g.roundRect) g.roundRect(x1, y1, w1, h1, r); else g.rect(x1, y1, w1, h1); };
    g.fillStyle = '#b98252'; rr(x - 0.06, y - 0.06, w + 0.12, h + 0.08, [0.5, 0.5, 0, 0]); g.fill();
    g.fillStyle = '#d9a46c'; rr(x, y, w, h, [0.45, 0.45, 0, 0]); g.fill();
    g.fillStyle = '#a7d7ee'; rr(x + 0.18, y + 0.18, w - 0.36, 0.55, [0.3, 0.3, 0.05, 0.05]); g.fill();
    g.fillStyle = '#7a4c2a'; g.beginPath(); g.arc(x + w - 0.16, y + h * 0.58, 0.045, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#fff8ec'; g.strokeStyle = '#7a4c2a'; g.lineWidth = 0.025;
    rr(x + 0.16, y + 0.86, w - 0.32, 0.26, 0.05); g.fill(); g.stroke();
    g.save(); g.translate(u, y + 1.0); g.scale(0.01, 0.01);
    g.fillStyle = '#2c8a7e'; g.font = `800 17px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('OPEN', 0, 1); g.restore();
  }
  drawLight(v, g) {
    const Lt = LIGHTS[this.light];
    const tint = Lt.tint || (this.dim ? 'rgba(10,12,30,.28)' : null);
    if (!tint && !this.dim) return;
    g.save();
    g.globalCompositeOperation = 'source-atop';
    if (tint) { g.fillStyle = tint; g.fillRect(0, 0, v.W, v.H); }
    if (this.dim && Lt.tint) { g.fillStyle = 'rgba(10,12,30,.14)'; g.fillRect(0, 0, v.W, v.H); }
    if (Lt.glow) {
      for (const t of this.things) {
        if (!t.light || t.pop < 1) continue;
        const p = v.P(t.x, t.y, heightZ(t) * t.light);
        const r = Lt.r * v.S * (t.id === 'lamp' ? 1 : 0.55);
        const gr = g.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
        gr.addColorStop(0, Lt.glow); gr.addColorStop(1, 'rgba(255,190,105,0)');
        g.fillStyle = gr; g.fillRect(p.x - r, p.y - r, r * 2, r * 2);
      }
    }
    g.restore();
  }
  tap(v, x, y) {
    const list = [...this.things, ...this.cats].filter((s) => s.rect).sort((p, q) => q._d - p._d);
    for (const s of list) {
      const r = s.rect;
      if (x < r.x || x > r.x + r.w || y < r.y || y > r.y + r.h) continue;
      this.poke(s);
      return s;
    }
    v.hideTip();
    return null;
  }
  poke(s) {
    const v = this.view;
    if (s.cat) {
      if (s.nap) s.squash = 0.16; else if (s.hopT === undefined && !s.fall) s.hopT = 0;
      if (s.title) v.showTip(s, s.title, s.sub);
    } else {
      s.wiggle = 0.35;
      const it = this.names && this.names[s.id];
      if (it) v.showTip(s, it[0], it[1]);
    }
    if (this.onTap) this.onTap(s);
    v.kick();
  }
}
function hash(str) { return [...String(str)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7); }

// A café in a box: the canvas, the label that follows what you tap, and the scene.
function create(box, opts = {}) {
  const cv = document.createElement('canvas');
  cv.className = 'cafe3d-canvas';
  cv.setAttribute('aria-label', opts.label || 'Your Cat Café. Drag to turn it, tap a cat.');
  cv.setAttribute('role', 'img');
  const tip = document.createElement('div');
  tip.className = 'cafe3d-tip'; tip.hidden = true;
  box.append(cv, tip);
  const scene = new Cafe();
  scene.names = opts.names || null;
  scene.onTap = opts.onTap || null;
  const view = new View(cv, scene, { tip, margin: opts.margin ?? 12 });
  return {
    canvas: cv, scene, view,
    show(data) { scene.show(data); view.kick(); },
    arrive(cat, text) { return scene.arrive(cat, text); },
    count: () => scene.count(),
    // For the walks: tap the cat with this key (or the first one) as if a finger did.
    pokeCat(key) { const c = scene.cats.find((x) => !key || x.key === key || String(x.key).startsWith(key)); if (c) scene.poke(c); return c || null; },
    spin(by) { view.spin(by * Q); },
  };
}

root.KavanaCafe3D = { create, art, lightAt, THEMES, SIZES, Cafe, View };
})(this);
