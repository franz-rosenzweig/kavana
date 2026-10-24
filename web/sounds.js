// Kavana's background sounds, all made on the device (nothing to download). Up to two play at once,
// each with its own volume, like Forest's ambient sounds. Purring, brown noise, rain and white noise
// are free; the others are in the shop (E.SHOP 'sound-<id>').
(function (root) {
'use strict';
const KINDS = [
  { id: 'purr', name: 'Purring', free: true },
  { id: 'rain', name: 'Rain', free: true },
  { id: 'brown', name: 'Brown noise', free: true },
  { id: 'white', name: 'White noise', free: true },
  { id: 'cafe', name: 'Café', about: 'Murmur and the odd cup.' },
  { id: 'fire', name: 'Fireplace', about: 'A low fire that crackles.' },
  { id: 'waves', name: 'Waves', about: 'Slow surf on a beach.' },
  { id: 'birds', name: 'Birds', about: 'A quiet morning garden.' },
  { id: 'night', name: 'Night', about: 'Crickets on a warm night.' },
  { id: 'wind', name: 'Wind', about: 'Wind around the house.' },
];

const rnd = () => Math.random() * 2 - 1;
// Pink noise (Paul Kellet's filter): sounds like steady rain.
function pinkGen() {
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  return () => {
    const w = rnd();
    b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.969 * b2 + w * 0.153852;
    b3 = 0.8665 * b3 + w * 0.3104856; b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
    const out = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11; b6 = w * 0.115926;
    return out;
  };
}
function brownGen() { let last = 0; return () => { last = (last + 0.02 * rnd()) / 1.02; return last * 3.2; }; }
// A one-pole low-pass: smaller k = darker.
function lowpass(k) { let y = 0; return (x) => (y += k * (x - y)); }

// Each maker fills `d` (n samples at sr). Loops are seamless: envelopes start and end at the same
// level, and a drift fix at the end makes the last sample meet the first.
const MAKERS = {
  purr(d, sr) { // rumbly noise in fast pulses, softer breathing in, stronger out; two 3-second breaths
    const n = d.length;
    let ph = 0, lp = 0, last = 0;
    for (let i = 0; i < n; i++) {
      const c = (i / sr) % 3;
      const env = c < 1.3 ? 0.55 * Math.sin((Math.PI * c) / 1.3) : c > 1.45 && c < 2.85 ? Math.sin((Math.PI * (c - 1.45)) / 1.4) : 0;
      ph += (2 * Math.PI * (c < 1.4 ? 22 : 26)) / sr;
      const pulse = (0.5 + 0.5 * Math.cos(ph)) ** 6;
      last = (last + 0.02 * rnd()) / 1.02;
      lp += 0.14 * ((last * 3.4 + rnd() * 0.06) * pulse * env - lp);
      d[i] = lp * 2.6;
    }
  },
  white(d) { for (let i = 0; i < d.length; i++) d[i] = rnd() * 0.18; },
  brown(d) { const g = brownGen(); for (let i = 0; i < d.length; i++) d[i] = g(); },
  rain(d) { const g = pinkGen(); for (let i = 0; i < d.length; i++) d[i] = g() * 0.45; },
  cafe(d, sr) { // a room full of quiet talk (band-limited noise that swells), and now and then a cup
    const g = pinkGen(); const lo = lowpass(0.08); const hi = lowpass(0.01);
    const n = d.length;
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      const swell = 0.75 + 0.25 * Math.sin((2 * Math.PI * t) / (n / sr)) * Math.sin(2 * Math.PI * t * 0.37);
      const x = g(); const band = lo(x) - hi(x);
      d[i] = band * 2.2 * swell;
    }
    for (let k = 0; k < 7; k++) { // clinks: short bright tones with a fast fade
      const at = Math.floor((0.05 + 0.9 * Math.random()) * (n - sr));
      const f = 1800 + Math.random() * 2200, amp = 0.05 + Math.random() * 0.05;
      for (let j = 0; j < sr * 0.5; j++) d[at + j] += amp * Math.sin((2 * Math.PI * f * j) / sr) * Math.exp(-j / (sr * 0.06));
    }
  },
  fire(d, sr) { // a low roar, and crackles: tiny bursts of noise
    const g = brownGen(); const lo = lowpass(0.05);
    const n = d.length;
    for (let i = 0; i < n; i++) d[i] = lo(g()) * 2.4;
    const pops = Math.round((n / sr) * 9);
    for (let k = 0; k < pops; k++) {
      const at = Math.floor(Math.random() * (n - sr * 0.05));
      const amp = 0.08 + Math.random() ** 3 * 0.5, len = sr * (0.002 + Math.random() * 0.01);
      for (let j = 0; j < len; j++) d[at + j] += amp * rnd() * Math.exp(-j / (len / 3));
    }
  },
  waves(d, sr) { // surf: noise that rises and falls, two waves per loop
    const g = pinkGen(); const lo = lowpass(0.12);
    const n = d.length;
    for (let i = 0; i < n; i++) {
      const c = ((i / n) * 2) % 1; // 0..1 within a wave
      const env = 0.15 + 0.85 * Math.sin(Math.PI * Math.min(1, c * 1.6)) ** 2 * (c < 0.62 ? 1 : Math.max(0, 1 - (c - 0.62) / 0.38));
      d[i] = lo(g()) * 1.9 * env;
    }
  },
  birds(d, sr) { // a very soft garden hush, and chirps: quick falling and rising whistles
    const g = pinkGen(); const lo = lowpass(0.04);
    const n = d.length;
    for (let i = 0; i < n; i++) d[i] = lo(g()) * 0.35;
    const songs = Math.round((n / sr) / 1.6);
    for (let k = 0; k < songs; k++) {
      let at = Math.floor(Math.random() * (n - sr * 1.2));
      const notes = 2 + Math.floor(Math.random() * 5), base = 2600 + Math.random() * 2400, amp = 0.05 + Math.random() * 0.06;
      for (let m = 0; m < notes; m++) {
        const len = Math.floor(sr * (0.05 + Math.random() * 0.08)), down = Math.random() < 0.6;
        let ph = 0;
        for (let j = 0; j < len && at + j < n; j++) {
          const p = j / len;
          const f = base * (down ? 1.25 - 0.45 * p : 0.85 + 0.4 * p);
          ph += (2 * Math.PI * f) / sr;
          d[at + j] += amp * Math.sin(ph) * Math.sin(Math.PI * p);
        }
        at += len + Math.floor(sr * (0.03 + Math.random() * 0.06));
      }
    }
  },
  night(d, sr) { // crickets: trains of short high pulses over a low hum of night air
    const g = brownGen(); const lo = lowpass(0.03);
    const n = d.length;
    for (let i = 0; i < n; i++) d[i] = lo(g()) * 0.9;
    for (const [f, rate, amp, off] of [[4400, 2.1, 0.035, 0], [4900, 1.7, 0.025, 0.31], [4100, 2.6, 0.02, 0.62]]) {
      for (let i = 0; i < n; i++) {
        const t = i / sr + off;
        const chirp = (t * rate) % 1; // a chirp of 4 pulses at the start of each cycle
        if (chirp > 0.22) continue;
        const pulse = Math.max(0, Math.sin(Math.PI * ((chirp / 0.22) * 4 % 1)));
        d[i] += amp * pulse * Math.sin((2 * Math.PI * f * i) / sr);
      }
    }
  },
  wind(d, sr) { // noise through a filter that slowly opens and closes, and a slow swell
    const g = pinkGen();
    const n = d.length;
    let y = 0;
    for (let i = 0; i < n; i++) {
      const c = i / n;
      const k = 0.01 + 0.05 * (0.5 + 0.5 * Math.sin(2 * Math.PI * c * 2 + Math.sin(2 * Math.PI * c * 3)));
      y += k * (g() - y);
      d[i] = y * (3.2 + 1.6 * Math.sin(2 * Math.PI * c * 2));
    }
  },
};
const SECONDS = { purr: 6, waves: 20, cafe: 16, fire: 12, birds: 16, night: 8, wind: 16, rain: 6, brown: 6, white: 6 };
// How loud each one sits (RMS), so switching between them doesn't jump.
const LEVEL = { purr: 0.11, rain: 0.1, brown: 0.14, white: 0.08, cafe: 0.11, fire: 0.12, waves: 0.12, birds: 0.08, night: 0.09, wind: 0.11 };

const Sound = {
  KINDS,
  byId: (id) => KINDS.find((k) => k.id === id),
  ctx: null,
  layers: [], // { id, src, gain }
  cache: new Map(),
  // iOS only lets audio start inside a tap.
  prime() {
    try {
      this.ctx = this.ctx || new (window.AudioContext || window.webkitAudioContext)();
      if (this.ctx.state === 'suspended') this.ctx.resume();
    } catch { this.ctx = null; }
  },
  buffer(id) {
    if (this.cache.has(id)) return this.cache.get(id);
    const sr = this.ctx.sampleRate;
    const n = Math.floor(sr * (SECONDS[id] || 8));
    const buf = this.ctx.createBuffer(1, n, sr);
    const d = buf.getChannelData(0);
    (MAKERS[id] || MAKERS.rain)(d, sr);
    const drift = d[n - 1] - d[0];
    let sq = 0;
    for (let i = 0; i < n; i++) { d[i] -= (drift * i) / n; sq += d[i] * d[i]; }
    const g = (LEVEL[id] || 0.1) / Math.max(1e-6, Math.sqrt(sq / n));
    for (let i = 0; i < n; i++) d[i] = Math.tanh(d[i] * g * 1.1) / 1.1; // soft, so a loud crackle doesn't clip
    this.cache.set(id, buf);
    return buf;
  },
  // Play these sounds ([{ id, vol }], at most two); anything else stops.
  play(mix) {
    if (!this.ctx) return;
    const want = mix.filter((m) => MAKERS[m.id]).slice(0, 2);
    for (const l of this.layers.filter((x) => !want.some((m) => m.id === x.id))) this.fade(l);
    this.layers = this.layers.filter((x) => want.some((m) => m.id === x.id));
    for (const m of want) {
      const l = this.layers.find((x) => x.id === m.id);
      if (l) { l.gain.gain.setTargetAtTime(m.vol * 0.8, this.ctx.currentTime, 0.2); continue; }
      try {
        const src = this.ctx.createBufferSource();
        src.buffer = this.buffer(m.id);
        src.loop = true;
        const gain = this.ctx.createGain();
        gain.gain.setValueAtTime(0, this.ctx.currentTime);
        gain.gain.linearRampToValueAtTime(m.vol * 0.8, this.ctx.currentTime + 2);
        src.connect(gain).connect(this.ctx.destination);
        src.start();
        this.layers.push({ id: m.id, src, gain });
      } catch {}
    }
  },
  fade(l) {
    try { l.gain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.25); l.src.stop(this.ctx.currentTime + 1.2); } catch {}
  },
  stop() { for (const l of this.layers) this.fade(l); this.layers = []; },
  get playing() { return this.layers.map((l) => l.id); },
};
root.KavanaSound = Sound;
})(this);
