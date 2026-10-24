'use strict';
// Kavana's screens. The work happens in engine.js (on the doc in data.js); this draws it.
const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const E = window.Kavana;
const D = window.Data;
const K = window.KavanaCats;
const SVGNS = 'http://www.w3.org/2000/svg';

// iPadOS Safari says it's a Mac; the touch points give it away.
const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const standalone = navigator.standalone === true || matchMedia('(display-mode: standalone)').matches;
// iOS only does web push for Home Screen apps, never in a Safari tab.
const pushSupported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window && !(ios && !standalone);
const platform = ios ? (standalone ? 'ios-app' : 'ios-safari') : /Android/.test(navigator.userAgent) ? (standalone ? 'android-app' : 'android') : 'desktop';

const TABS = ['focus', 'later', 'cafe', 'cats', 'settings'];
const PARENT = {
  friends: 'settings', account: 'settings', admin: 'settings', tags: 'settings', lines: 'settings', themes: 'settings',
  install: 'focus', remind: 'focus', breathe: 'focus', news: 'focus', shop: 'cats', missions: 'cats', shelter: 'cats', rankings: 'cafe',
};
const ALIAS = { history: 'cafe' }; // old links
const routeOf = (h) => ALIAS[h] || h || 'focus';
let state = null;       // E.view(doc): what the screens draw
let route = routeOf(location.hash.slice(1));
let mySub = null;       // this browser's push subscription
let minutes = 25;
let style = null;       // 'ask' or 'nudge' on the start screen; null = the saved default
let clockTimer = null;
let parkOpen = false;
let breakDismissed = null;
let whyFor = null;      // the check-in just answered "Drifted", waiting for "What pulled you away?"
let fromLater = null;   // the Later item in the start box, so starting it takes it off the list
let join = null;        // { name, end, nap } when joining a friend's block
let friends = null;     // GET api/friends
let friendsAt = 0;
let accountTab = 'login';
const meetQueue = [];   // cats you've just met, shown one at a time
let pickTag = null;     // the tag on the start screen; null = the last one used
let inviting = false;   // the "Who's coming?" sheet
let cafe = { span: 'day', at: Date.now() }; // the café's period
let swReg = null;       // the service worker, for the "come back" notification
let nap = null;         // the group my block naps in (GET api/nap), with .block = my block's id
let missionsSeen = null; // missions already done, so finishing one gets a toast just once
let soundsOpen = false;  // the sounds sheet
let mode = null;         // 'timer' or 'stopwatch' on the start screen; null = the one used last
let roomOpen = false;    // the nap room sheet (its code)
let optionsOpen = false; // the Focus tab's sheet: how long, tag, check-ins, first step
let menuOpen = false;    // the menu that slides in from the left
let diveFor = null;      // the block whose start dove into the window (plays once)
let homecoming = null;   // { id, phase } while a cat that came home drops into the café
let editId = null;       // the block being edited
let editTag = '';
let rankTab = 'world';   // Rankings: friends or worldwide
let rankings = null;     // GET api/rankings
let rankingsAt = 0;
let shelterCount = null; // GET api/shelter
let breathLen = 1;       // minutes of the mindful minute

const now = () => Date.now();
const pref = (k, v) => (v === undefined ? D.LS.get(k) : D.LS.set(k, v));
const remember = (k) => pref(k, '1');
const remembered = (k) => pref(k) === '1';
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const icon = (id, cls) => { const s = document.createElementNS(SVGNS, 'svg'); if (cls) s.setAttribute('class', cls); const u = document.createElementNS(SVGNS, 'use'); u.setAttribute('href', `#i-${id}`); s.append(u); return s; };

const TEXT = {
  unsupported: ios
    ? (standalone ? 'Reminders need iPadOS 16.4 or newer.' : 'Reminders work from the Home Screen app.')
    : "This browser can't show reminders.",
  denied: ios
    ? 'Notifications are off for Kavana. Open the Settings app, tap Notifications, then Kavana, and turn on Allow Notifications.'
    : "Notifications are blocked for this site. Allow them in the browser's site settings.",
};

let toastTimer = null;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  t.style.animation = 'none'; void t.offsetWidth; t.style.animation = '';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 2600);
}

function go(where) {
  menuOpen = false; optionsOpen = false;
  route = routeOf(where);
  const hash = route === 'focus' ? '' : route;
  if (location.hash.slice(1) !== hash) history.replaceState(null, '', hash ? '#' + hash : location.pathname);
  if (TABS.includes(route) || PARENT[route]) window.scrollTo({ top: 0 });
  render();
}

// Redraw from the doc, and react to what changed since last time (a check-in came, the end came...).
function refresh() {
  D.tick();
  const prev = state;
  state = E.view(D.doc, now());
  checkMeets();
  checkMissions();
  render();
  if (prev) reactTo(prev, state);
  tellExtension();
}

// The browser extension (extension/ in the repo) blocks your list of sites while a block runs. Its
// script on this page hears about the block from a "kavana-block" event, sent when something changes.
// It says "kavana-extension" when it starts, and then gets the block again.
let toldExt = '', extOn = false;
function tellExtension() {
  const a = state && state.active;
  const detail = !a ? { running: false } : {
    running: true,
    end: a.paused ? a.end + (a.pauseEnds - a.paused) : a.end, // a pause moves the end; this is the latest it can be
    intention: a.intention,
    cat: catsOn() ? { id: a.cat, name: K.byId(a.cat).name, kitten: a.kitten } : null,
  };
  const said = JSON.stringify(detail);
  if (said === toldExt) return;
  toldExt = said;
  window.dispatchEvent(new CustomEvent('kavana-block', { detail }));
}
window.addEventListener('kavana-extension', () => {
  extOn = true; toldExt = '';
  if (state) { tellExtension(); if (route === 'settings') render(); }
});

// Run an engine change. The engine throws on bad input; say so instead of failing quietly.
function act(fn, says) {
  try { D.act(fn); } catch (e) { toast(says || "That didn't work."); return false; }
  refresh();
  return true;
}

// ---------- system-style alerts (instead of the browser's confirm and prompt) ----------
function ask({ title, message = '', actions, input, type = 'password', value = '' }) {
  return new Promise((resolve) => {
    $('#alert-title').textContent = title;
    $('#alert-msg').textContent = message;
    $('#alert-msg').hidden = !message;
    const inp = $('#alert-input');
    inp.hidden = !input;
    inp.type = type;
    inp.value = value;
    if (input) inp.placeholder = input;
    const box = $('#alert-actions');
    box.className = `alert-actions${actions.length > 2 ? ' stack' : ''}`;
    const close = (i) => {
      $('#alert').hidden = true;
      document.removeEventListener('keydown', onKey, true);
      resolve({ i, value: inp.value });
    };
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); close(actions.findIndex((a) => a.cancel)); }
      if (e.key === 'Enter') { e.preventDefault(); close(actions.findIndex((a) => a.main)); }
    };
    box.replaceChildren(...actions.map((a, i) => {
      const b = el('button', [a.main ? 'bold' : '', a.danger ? 'destructive' : ''].join(' ').trim(), a.label);
      b.dataset.alert = String(i);
      b.addEventListener('click', () => close(i));
      return b;
    }));
    document.addEventListener('keydown', onKey, true);
    $('#alert').hidden = false;
    if (input) setTimeout(() => inp.focus(), 60);
  });
}
async function confirmIt(title, message, yes, danger) {
  const r = await ask({ title, message, actions: [{ label: 'Cancel', cancel: true }, { label: yes, main: true, danger }] });
  return r.i === 1;
}

// ---------- background sound (web/sounds.js): up to two at once, each with a volume ----------
const Sound = window.KavanaSound;
const soundOwned = (id) => { const k = Sound.byId(id); return Boolean(k && (k.free || E.owns(D.doc, `sound-${id}`))); };
// What you picked last ([{ id, vol }]), from this browser. Older versions kept one name in "sound".
function soundMix() {
  let mix = null;
  try { mix = JSON.parse(pref('mix') || 'null'); } catch {}
  if (!Array.isArray(mix)) { const old = pref('sound'); mix = old && old !== 'off' ? [{ id: old, vol: 0.8 }] : []; }
  return mix.filter((m) => m && soundOwned(m.id)).map((m) => ({ id: m.id, vol: Math.max(0.05, Math.min(1, Number(m.vol) || 0.8)) })).slice(0, 2);
}
const setMix = (mix) => pref('mix', JSON.stringify(mix));
const soundOn = () => soundMix().length > 0;
const mixLabel = (mix) => (mix.length ? mix.map((m) => Sound.byId(m.id).name).join(' + ') : 'Sound');
document.addEventListener('pointerdown', () => Sound.prime());

// ---------- keep the screen on (Screen Wake Lock) ----------
const Wake = {
  supported: 'wakeLock' in navigator,
  lock: null,
  on: false,
  async request() {
    try {
      this.lock = await navigator.wakeLock.request('screen');
      this.lock.addEventListener('release', () => { this.lock = null; });
      this.on = true;
    } catch { this.on = false; }
    return this.on;
  },
  release() {
    this.on = false;
    if (this.lock) this.lock.release().catch(() => {});
    this.lock = null;
  },
  wanted: () => pref('awake') !== '0', // on unless turned off: a locked screen counts as leaving
};

// Sound and screen-on for a block that's starting or resuming. Call from a tap.
function startExtras() {
  const mix = soundMix();
  if (mix.length) Sound.prime();
  return () => {
    if (mix.length) Sound.play(mix);
    if (Wake.supported && Wake.wanted()) Wake.request().then(render);
  };
}

// ---------- the chime, the cats and the confetti ----------
function chime(soft) {
  const c = Sound.ctx;
  if (pref('chime') === '0' || !c || c.state !== 'running' || document.hidden) return;
  const t = c.currentTime;
  for (const [f, v] of [[660, 0.2], [990, 0.1], [1320, 0.05]]) {
    const o = c.createOscillator();
    const g = c.createGain();
    o.frequency.value = soft ? f * 0.75 : f;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(soft ? v / 2 : v, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 2.2);
    o.connect(g).connect(c.destination);
    o.start(t);
    o.stop(t + 2.3);
  }
}

const catsOn = () => D.doc.settings.cat !== false;
const dayKey = (t) => { const d = new Date(t); return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`; };
// The past: past 2000 blocks, the oldest are folded into doc.past, which keeps each day's totals
// (E.pastDays: the minutes by tag, who came home, how many wandered off) but not the blocks or their hours.
const focusOf = (x) => Object.values(x.focus).reduce((n, v) => n + v, 0);
const hasPast = () => E.pastDays(D.doc).length > 0;
function pastUpTo() { // the last day in the past, for the notes that say what it can't show
  const days = E.pastDays(D.doc);
  return days.length ? new Date(days[days.length - 1].day).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '';
}
// For the cats' rules. The past keeps the minutes, the days and the kittens that came home at night,
// but not which blocks were stopped or marked Done. With a past there are 2000 blocks for those anyway,
// and a cat you met stays met (catsSeen).
function catStats() {
  const h = E.history(D.doc);
  const past = E.pastDays(D.doc);
  const days = [...new Set([...past.map((x) => dayKey(x.day)), ...h.map((b) => dayKey(b.start))])].map((k) => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d).getTime(); }).sort((a, b) => a - b);
  let best = 0, run = 0;
  days.forEach((t, i) => { run = i && Math.round((t - days[i - 1]) / 86400000) === 1 ? run + 1 : 1; best = Math.max(best, run); });
  return {
    finished: h.filter((b) => !b.stopped).length,
    totalMin: past.reduce((n, x) => n + focusOf(x), h.reduce((n, b) => n + b.actual, 0)),
    bestStreak: best,
    breaks: D.doc.tally.breaks || 0,
    done: h.filter((b) => b.outcome === 'done').length,
    night: D.doc.past.night + h.filter((b) => { const hr = new Date(b.start).getHours(); return hr >= 22 || hr < 4; }).length,
  };
}
// The cats you can invite: the ones you've met (once met, always met, even after Clear My History)
// and the ones you adopted.
function metCats() {
  const s = catStats();
  const seen = D.doc.settings.catsSeen || [];
  return K.CATS.filter((c) => (c.adopt ? E.owns(D.doc, c.id) : c.rule(s) || seen.includes(c.id)));
}
function companion() {
  const c = K.byId(D.doc.settings.companion);
  return metCats().includes(c) ? c : K.CATS[0];
}
const treatsLeft = () => E.treats(D.doc).left;
const fish = (n) => `🐟 ${n}`;
// Put a cat drawing in an element, only redrawing when it changes (so its animations don't restart).
function putCat(target, pose, cat = companion()) {
  if (!catsOn()) { target.replaceChildren(); target.dataset.k = ''; target.hidden = true; return; }
  target.hidden = false;
  const key = `${cat.id}:${pose}`;
  if (target.dataset.k !== key) { target.innerHTML = K.Cat(cat.breed, pose); target.dataset.k = key; }
}

// The painted picture if there is one (web/cats/): the grown cat, or the kitten ('kitten', 'nap').
// Falls back to the drawn cat in a pose, also if the picture doesn't load.
const POSE_FOR = { kitten: 'sit', nap: 'sleep' };
function portrait(c, pose = 'sit', which = 'portrait') {
  const drawn = () => { const d = el('div'); d.innerHTML = K.Cat(c.breed, POSE_FOR[which] || pose); return d.firstChild; };
  if (!c[which]) return drawn();
  const img = el('img', 'portrait');
  img.src = c[which]; img.alt = ''; img.decoding = 'async';
  img.addEventListener('error', () => { // keep where it was put and what it was tagged with
    const d = drawn();
    d.setAttribute('class', `${d.getAttribute('class')} ${img.className}`);
    d.style.cssText = img.style.cssText;
    Object.assign(d.dataset, img.dataset);
    img.replaceWith(d);
  }, { once: true });
  return img;
}
// ---------- living cats: the paintings bent live (web/warp.js and its rig, web/rig.json) ----------
// They breathe, blink, flick an ear, swish a tail, and hop when tapped. Without WebGL, the rig, or with
// Cat mode off, the still painting stands in. One loop draws them all, and only the ones on screen.
const Warp = window.KavanaWarp;
let RIG = null;
if (Warp) fetch('rig.json').then((r) => r.json()).then((j) => { RIG = j; if (state) render(); }).catch(() => {});
const WARP_FILE = { portrait: '-1', kitten: '-kitten-1', nap: '-nap-1' };
const canLive = (c, which) => Boolean(Warp && RIG && RIG[`${c.id}${WARP_FILE[which]}`]);
// A living cat in a square box the size the painting would have (its canvas reaches past the box, for
// room to hop). It starts once the box is on the page, so a sheet it sits in can count as on screen.
function livingCat(c, which = 'portrait', o = {}) {
  if (!canLive(c, which)) return null;
  const box = el('div', 'catbox');
  const cv = document.createElement('canvas');
  cv.className = 'catcanvas';
  if (o.interactive) { cv.tabIndex = 0; cv.setAttribute('aria-label', `${c.name}. Tap to say hi.`); }
  box.append(cv);
  queueMicrotask(() => {
    if (!box.isConnected) return;
    box.cat = new Warp.Cat(cv, c.id, which, { rig: RIG, base: 'cats/', interactive: Boolean(o.interactive), shadow: o.shadow !== false, seed: o.seed });
    if (o.hello) setTimeout(() => box.cat && box.cat[o.hello](), 350);
    Warp.start();
  });
  return box;
}
// The living cat if it can be, else the painting.
const catArt = (c, pose = 'sit', which = 'portrait', o = {}) => livingCat(c, which, o) || portrait(c, pose, which);
// Cats whose box left the page stop being drawn and are let go.
if (Warp) Warp.tickers.add(() => { for (const c of Warp.cats) if (!c.c.isConnected) c.destroy(); });

function thing(x) {
  const img = el('img', 'thing');
  img.src = x.art; img.alt = ''; img.decoding = 'async';
  img.addEventListener('error', () => { img.style.visibility = 'hidden'; }, { once: true });
  return img;
}

// New cats: met once, celebrated once (the list of cats you've seen is synced with your account).
function checkMeets() {
  if (!catsOn()) return;
  const met = metCats().map((c) => c.id);
  const seen = D.doc.settings.catsSeen;
  if (!seen) { D.act((doc, t) => E.setSettings(doc, { catsSeen: met }, t)); return; } // first run: no pile-up of old news
  const fresh = met.filter((id) => !seen.includes(id));
  if (!fresh.length) return;
  for (const id of fresh) if (!meetQueue.includes(id)) meetQueue.push(id);
  D.act((doc, t) => E.setSettings(doc, { catsSeen: [...seen, ...fresh] }, t));
}

let catTimer = null;
function cat(says) {
  if (!catsOn() || document.hidden) return;
  $('#cat-says').textContent = says;
  putCat($('#cat-art'), 'peek');
  const c = $('#cat');
  c.hidden = false;
  requestAnimationFrame(() => requestAnimationFrame(() => c.classList.add('up')));
  clearTimeout(catTimer);
  catTimer = setTimeout(catAway, 5000);
}
function catAway() {
  const c = $('#cat');
  c.classList.remove('up');
  clearTimeout(catTimer);
  catTimer = setTimeout(() => { c.hidden = true; }, 600);
}

function confetti() {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const box = $('#confetti');
  const colors = ['var(--tint)', 'var(--pink)', 'var(--orange)', 'var(--mint)', 'var(--purple)', 'var(--yellow)'];
  for (let i = 0; i < 28; i++) {
    const s = icon('paw');
    s.style.color = colors[i % colors.length];
    s.style.left = '50%';
    s.style.top = '42%';
    box.append(s);
    const a = Math.random() * Math.PI * 2;
    const d = 120 + Math.random() * 280;
    s.animate([
      { transform: 'translate(-50%, -50%) scale(.3) rotate(0deg)', opacity: 1 },
      { transform: `translate(${Math.cos(a) * d}px, ${Math.sin(a) * d + 140}px) scale(${0.8 + Math.random() * 0.6}) rotate(${Math.random() * 360 - 180}deg)`, opacity: 0 },
    ], { duration: 1300 + Math.random() * 700, easing: 'cubic-bezier(.15, .8, .3, 1)' }).onfinish = () => s.remove();
  }
}

function reactTo(prev, next) {
  if (prev.active && next.awaiting && !next.awaiting.stopped) chime(); // the outcome sheet has its own cheering cat
  else if (prev.active && next.active && prev.active.pending == null && next.active.pending != null) chime(); // the check-in sheet has its cat
  else if (prev.active && next.active && next.active.line && next.active.line !== prev.active.line) { chime(true); cat(next.active.line); }
  else if (prev.onBreak && !next.onBreak && !next.active) { chime(); cat("Boo! Break's over. It's time to focus."); }
}

// ---------- stats ----------
function stats(blocks) {
  const today = dayKey(now());
  const weekAgo = now() - 7 * 86400000;
  const out = { today: 0, week: 0, weekBlocks: 0, streak: 0, answered: 0, drifted: 0 };
  const days = new Set();
  for (const b of blocks) {
    days.add(dayKey(b.start));
    if (dayKey(b.start) === today) out.today += b.actual;
    if (b.start >= weekAgo) { out.week += b.actual; out.weekBlocks += 1; out.answered += b.answered || 0; out.drifted += b.drifts || 0; }
  }
  // The last 7 days are never in the past (that would take 2000 blocks in a week), but a streak can go further back.
  for (const x of E.pastDays(D.doc)) days.add(dayKey(x.day));
  const d = new Date();
  if (!days.has(dayKey(d))) d.setDate(d.getDate() - 1); // a streak still counts until today ends
  while (days.has(dayKey(d))) { out.streak += 1; d.setDate(d.getDate() - 1); }
  return out;
}
const fmtMin = (m) => (m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}`);
const pad = (n) => String(n).padStart(2, '0');
function fmtClock(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return h ? `${h}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
}
const fmtTime = (t) => new Date(t).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
const times = (n) => (n === 1 ? 'once' : `${n} times`);
const minLeft = (ms) => Math.max(1, Math.round(ms / 60000));
const PALETTE = ['#ff9500', '#ff2d55', '#5856d6', '#34c759', '#007aff', '#af52de', '#00c7be', '#ff3b30'];
function avatar(name, status) {
  const a = el('span', 'avatar', (name || '?').charAt(0).toUpperCase());
  a.style.background = PALETTE[[...name].reduce((h, c) => h + c.charCodeAt(0), 0) % PALETTE.length];
  if (status) a.append(el('i', `pres ${status}`));
  return a;
}

// ---------- friends ----------
async function loadFriends(force) {
  if (!D.account) { friends = null; return null; }
  if (!force && friends && now() - friendsAt < 15000) return friends;
  try {
    friends = await D.api('GET', 'api/friends'); friendsAt = now();
    if (friends && friends.friends.length > (D.doc.tally.friends || 0)) D.act((doc, t) => E.setTally(doc, 'friends', friends.friends.length, t)); // for the achievements
  } catch {}
  return friends;
}
function friendLine(f) {
  if (f.status === 'focusing' && f.mode === 'stopwatch') return `${f.intention ? `Focusing on ${f.intention}` : 'Focusing'} · ${minLeft(now() - f.start)} min so far`;
  if (f.status === 'focusing') return `${f.intention ? `Focusing on ${f.intention}` : 'Focusing'} · ${minLeft(f.left)} min left`;
  if (f.status === 'paused') return f.intention ? `Paused: ${f.intention}` : 'Paused';
  if (f.status === 'break') return 'On a break';
  if (f.status === 'hidden') return "Isn't sharing";
  return 'Not in a block';
}
const focusingFriends = () => (friends && friends.sharing ? friends.friends.filter((f) => f.status === 'focusing').map((f) => f.display) : []);

// ---------- rendering ----------
function show(id) { for (const v of $$('.view')) v.hidden = v.id !== 'v-' + id; }
const tabOf = (r) => (TABS.includes(r) ? r : PARENT[r] || 'focus');

function render() {
  clearInterval(clockTimer);
  if (!state) return show('loading');
  if ((!state.active || state.active.paused) && route !== 'breathe') Sound.stop();
  if (!state.active) Wake.release();
  if (route !== 'breathe') resetBreath();
  const welcome = !remembered('welcomed') && !D.account && route !== 'account' && route !== 'install';
  document.body.classList.toggle('bare', welcome);
  for (const b of $$('#sidebar [data-tab], #sidebar [data-go]')) b.classList.toggle('on', !welcome && (b.dataset.go ? b.dataset.go === route : b.dataset.tab === route));
  // Forest's way: the home and the running block fill the screen, and the menu is a button at the top.
  const focusing = route === 'focus' && Boolean(state.active);
  const home = route === 'focus' && !state.active && !state.onBreak && !welcome;
  document.body.classList.toggle('home', home);
  document.body.classList.toggle('sky', focusing && !welcome);
  document.body.classList.toggle('withmenu', !welcome && TABS.includes(route)); // during a block and a break too, for Later and Settings
  document.body.dataset.theme = state.settings.theme || 'classic';
  $('#menu-btn').hidden = !document.body.classList.contains('withmenu');
  drawMenu();
  if (!focusing) $('#sky').hidden = true;
  drawChrome();
  if (welcome) { show('welcome'); drawCast(); drawOverlays(); return; }
  if (route === 'focus' && state.active) renderRun();
  else if (route === 'focus' && state.onBreak) renderBreak();
  else {
    const views = {
      later: renderLater, cafe: renderCafe, cats: renderCats, shop: renderCats, missions: renderCats, settings: renderSettings,
      friends: renderFriends, account: renderAccount, admin: renderAdmin, tags: renderTags, remind: renderRemind, breathe: renderBreathe,
      install: () => show('install'), rankings: renderRankings, shelter: renderShelter, news: renderNews, lines: renderLines, themes: renderThemes,
    };
    (views[route] || renderHome)();
  }
  drawLive();
  drawOverlays();
}

// The welcome screen's cast: Miso in front, a few of the others around.
function drawCast() {
  const box = $('#welcome-cat');
  if (box.dataset.k === 'cast') return;
  box.dataset.k = 'cast';
  if (!K.CATS[0].portrait) { box.innerHTML = K.Cat('orange', 'cheer'); return; }
  const cast = el('div', 'cast');
  for (const id of ['pepper', 'mochi', 'biscuit', 'noodle', 'miso']) { const p = catArt(K.byId(id), 'sit', 'portrait', { interactive: true }); p.classList.add(`cast-${id}`); cast.append(p); }
  box.replaceChildren(cast);
}

// Tab bar badges, the sidebar cat.
function drawChrome() {
  const n = state.later.length;
  $('#sb-later').textContent = n || '';
  const met = metCats().length;
  $('#sb-cats').textContent = `${met}/${K.CATS.filter((c) => !c.limited || E.owns(D.doc, c.id) || E.forSale(c.id, now())).length}`; // a limited cat counts while it's in the shop, or once it's yours
  $('#sb-cafe').textContent = fish(treatsLeft());
  $('#menu-dot').hidden = !(met > Number(pref('catsKnown') || 1) || unreadNews().length);
  putCat($('#sb-cat'), state.active && !state.active.paused ? 'sleep' : 'sit');
}
// The menu slides in over the screen, with a shade behind it.
function drawMenu() {
  const open = menuOpen && !document.body.classList.contains('bare');
  document.body.classList.toggle('menu-open', open);
  $('#menu-scrim').hidden = !open;
  $('#menu-btn').setAttribute('aria-expanded', String(open));
  $('#sidebar').inert = !open;
}

// The Live Activity: a running block, seen from any other tab.
function drawLive() {
  const live = $('#live');
  const busy = state.active || state.onBreak;
  live.hidden = !busy || route === 'focus' || document.body.classList.contains('bare');
  if (live.hidden) return;
  live.classList.toggle('paused', Boolean(state.active && state.active.paused));
  $('#live-text').textContent = state.active ? state.active.intention : 'Break';
  paintLive();
}
function paintLive() {
  if (!state || $('#live').hidden) return;
  const b = state.active || state.onBreak;
  if (!b) return;
  const at = b.paused || now();
  $('#live-time').textContent = b.mode === 'stopwatch' ? fmtClock(b.total - (b.end - at)) : b.over ? `+${fmtClock(Math.max(0, b.total - (b.end - at) - b.minutes * 60000))}` : fmtClock(b.end - at);
}

// Sheets over whatever screen you're on: a check-in, the end of a block, parking a thought, meeting a cat.
function drawOverlays() {
  const a = state.active;
  const asking = Boolean(a && whyFor && whyFor.id === a.id);
  const checkin = Boolean(a && !a.paused && (a.pending != null || asking)) && !document.body.classList.contains('bare');
  $('#checkin').hidden = !checkin;
  if (checkin) {
    $('#ask-pane').hidden = asking;
    $('#why-pane').hidden = !asking;
    $('#checkin-text').textContent = a.intention;
    putCat($('#checkin-cat'), 'peek');
  }
  const outcome = Boolean(state.awaiting) && !checkin;
  $('#outcome').hidden = !outcome;
  if (outcome) drawOutcome();
  $('#park').hidden = !(parkOpen && a) || checkin;
  if (!$('#park').hidden) {
    const list = $('#parked-now');
    list.replaceChildren(...a.parked.map((t) => el('div', 'row', t)));
    list.hidden = !a.parked.length;
  }
  const meeting = meetQueue.length && !checkin && !outcome && $('#park').hidden && catsOn() && !document.body.classList.contains('bare');
  $('#meet').hidden = !meeting;
  if (meeting) {
    const c = K.byId(meetQueue[0]);
    if ($('#meet-art').dataset.k !== c.id) { $('#meet-art').replaceChildren(catArt(c, 'cheer', 'portrait', { interactive: true, hello: 'poke' })); $('#meet-art').dataset.k = c.id; }
    $('#meet-eyebrow').textContent = c.adopt ? 'Adopted' : 'New friend';
    $('#meet-title').textContent = c.adopt ? `Welcome home, ${c.name}!` : `You met ${c.name}!`;
    $('#meet-about').textContent = c.about;
    $('#meet-pick').textContent = `Invite ${c.name} Next`;
  }
  const picking = inviting && !state.active && !checkin && !outcome && !meeting;
  $('#invite-sheet').hidden = !picking;
  if (picking) drawInvite();
  const free = !checkin && !outcome && !meeting && !picking && $('#park').hidden;
  $('#sounds').hidden = !(soundsOpen && free);
  if (!$('#sounds').hidden) drawSounds();
  const room = roomOpen && free && nap && a && nap.block === a.id && nap.code;
  $('#room-sheet').hidden = !room;
  if (room) $('#room-code').textContent = nap.code;
  $('#edit').hidden = !(editId && free);
}

// "Who's coming?": the cats you can invite to the next block.
function drawInvite() {
  const mine = companion();
  $('#invitegrid').replaceChildren(...metCats().map((c) => {
    const b = el('button', `invitecard${c === mine ? ' on' : ''}`);
    b.type = 'button';
    b.dataset.invite = c.id;
    b.append(catArt(c, 'sit', 'kitten', { shadow: false }), el('b', null, c.name));
    return b;
  }));
}

function drawOutcome() {
  const b = state.awaiting;
  $('#outcome-eyebrow').textContent = b.mode === 'stopwatch' ? (b.stopped ? 'Stopwatch, under 10 minutes' : 'Stopwatch') : b.stopped ? 'Stopped early' : "Time's up";
  $('#outcome-text').textContent = b.intention;
  const c = K.byId(b.cat);
  const line = $('#outcome-kitten');
  line.hidden = !catsOn();
  line.textContent = b.kitten === 'home' && b.bonus ? `${c.name} came home, and so did ${b.napN === 1 ? "your friend's kitten" : `${b.napN} friends' kittens`}. ${fish(`+${b.treats + b.bonus}`)}`
    : b.kitten === 'home' ? `${c.name} came home to your café. ${fish(`+${b.treats}`)}`
    : b.goneWhy === 'nap' ? `${c.name} wandered off when ${b.goneBy || 'someone'} left the nap.`
    : b.goneWhy === 'away' ? `${c.name} wandered off while you were away.`
    : b.goneWhy === 'short' ? `${c.name} needs 10 minutes to come home, so it wandered off.` : `${c.name} wandered off. Next time, stay to the end.`;
  $('#outcome-note').textContent = b.note ? 'Edit the Note' : 'Add a Note';
  const h = E.history(D.doc).find((x) => x.id === b.id);
  const small = h ? cameHomeSmall(h) : b.minutes < 25;
  const art = $('#outcome-cat');
  const key = `${b.id}:${b.kitten}`;
  if (!catsOn()) { art.replaceChildren(); art.dataset.k = ''; }
  else if (art.dataset.k !== key) {
    art.replaceChildren(b.kitten === 'home' ? catArt(c, 'cheer', small ? 'kitten' : 'portrait', { interactive: true, hello: 'happy' }) : thing({ art: 'cafe/gone-1.webp' }));
    art.dataset.k = key;
  }
  // The homecoming: the café comes up behind the card, the cat drops onto its spot, the treats float up.
  const coming = catsOn() && b.kitten === 'home' && Boolean(h);
  $('#outcome').classList.toggle('homecoming', coming);
  $('#homecafe').hidden = !coming;
  if (coming && (!homecoming || homecoming.id !== b.id)) startHomecoming(h, b);
  const more = b.minutes <= 10 ? [10, 20] : [5, 10]; // after "Just start", offer a real block
  for (const [btn, m] of [[$('#more-a'), more[0]], [$('#more-b'), more[1]]]) { btn.dataset.more = m; btn.textContent = `+${m} min`; }
  $('#outcome-parked .parkedlist').replaceChildren(...b.parked.map((t) => el('div', 'row', t)));
  $('#outcome-parked').hidden = !b.parked.length;
}

// The Focus tab, Forest's way: the café wall, a round window with the cat who's coming on its cushion,
// drag around the window for how long, one button. Everything else about the block is in a sheet.
// The café of today behind the end of a block, and the cat that came home dropping into it. About two
// seconds, then the card comes up; a tap brings it sooner.
let homeCafe = null;
function startHomecoming(h, b) {
  homecoming = { id: b.id };
  const quick = reduceMotion();
  const box = $('#homecafe');
  if (!homeCafe) homeCafe = C3.create(box, { names: ITEM_NAMES, margin: 6 });
  const today = periodOf('day', now());
  const others = E.history(D.doc).filter((x) => x.start >= today.from && x.start < today.to && x.id !== b.id);
  homeCafe.show({ ...cafeData(others, 'day', hashOf(`home${today.from}`)), quiet: false });
  const sheet = $('#outcome');
  sheet.classList.add('arriving');
  const c = K.byId(b.cat);
  setTimeout(() => {
    if (!homecoming || homecoming.id !== b.id) return;
    homeCafe.view.resize();
    homeCafe.arrive({ ...cafeCat(h), title: `${c.name} came home`, sub: `${h.intention} · ${fmtMin(h.actual)}` }, fish(`+${b.treats + (b.bonus || 0)}`));
  }, quick ? 0 : 450);
  setTimeout(() => sheet.classList.remove('arriving'), quick ? 150 : 2300);
}
$('#homecafe').addEventListener('pointerup', () => $('#outcome').classList.remove('arriving'));

function renderHome() {
  show('focus');
  $('#today-date').textContent = new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
  $('#remind-banner').hidden = !pushSupported || Boolean(mySub);
  $('#install-banner').hidden = !(ios && !standalone) || remembered('installNo');
  // What's new, once per post; the starter challenge until it's done.
  const fresh = unreadNews();
  $('#news-banner').hidden = !fresh.length || pref('newsNo') === fresh[0].id;
  if (fresh.length) $('#news-banner-text').textContent = fresh[0].title;
  $('#news-count').hidden = !fresh.length;
  $('#news-count').textContent = String(fresh.length);
  const st0 = E.starter(D.doc);
  $('#starter-card').hidden = st0.finished || !catsOn();
  if (!st0.finished) {
    const done = st0.steps.filter((x) => x.done).length;
    const ready = st0.steps.filter((x) => x.done && !x.claimed).length + (st0.all.done && !st0.all.claimed ? 1 : 0);
    $('#starter-text').textContent = ready ? `${ready === 1 ? 'A reward is' : `${ready} rewards are`} waiting. Tap to collect.` : `${done} of ${st0.steps.length} done · ${fish(E.STARTER_PAY)} each`;
  }
  const offer = state.breakOffer;
  $('#break-banner').hidden = !offer || offer.id === breakDismissed;
  if (offer) for (const b of $$('[data-break]')) b.className = `btn small ${Number(b.dataset.break) === offer.minutes ? 'filled' : 'tinted'}`;

  const recent = $('#recent');
  recent.replaceChildren(...state.recent.map((t) => { const c = el('button', 'chip', t); c.type = 'button'; c.dataset.recent = t; return c; }));
  recent.hidden = !state.recent.length;

  // Joining a friend: their end time sets the length.
  if (join && join.end - now() < 2 * 60000) join = null;
  $('#join-banner').hidden = !join;
  const m = currentMode();
  for (const c of $$('#modes button')) c.classList.toggle('on', c.dataset.mode === m);
  $('#modes').hidden = Boolean(join);
  $('#modes').previousElementSibling.hidden = Boolean(join);
  $('#length-field').hidden = Boolean(join) || m === 'stopwatch';
  $('#join-code').hidden = !(D.account && catsOn() && !join);
  if (join) $('#join-text').textContent = join.nap && catsOn() && D.account
    ? `Napping with ${join.name}. You'll finish together at ${fmtTime(join.end)}. If anyone leaves, every kitten wanders off.`
    : `Joining ${join.name}. You'll both finish at ${fmtTime(join.end)}.`;

  const cats = catsOn();
  $('#invite-wrap').hidden = !cats;
  const inv = companion();
  $('#invite-name').textContent = inv.name;
  if ($('#invite-art').dataset.k !== inv.id) { $('#invite-art').replaceChildren(portrait(inv, 'sit', 'kitten')); $('#invite-art').dataset.k = inv.id; }
  drawTagChips();
  const tag = currentTag();
  $('#home-tag-name').textContent = tag || 'Choose a tag';
  $('#home-tag-dot').style.background = tag ? tagColor(tag) : 'transparent';
  $('#home-tag').classList.toggle('none', !tag);
  $('#home-treats').textContent = fish(treatsLeft());
  $('#home-treats').hidden = !cats;

  const s = style || state.settings.style || 'ask';
  for (const c of $$('#styles button')) c.classList.toggle('on', c.dataset.style === s);
  const custom = !$('#custom-wrap').hidden;
  for (const c of $$('#lengths button')) c.classList.toggle('on', custom ? c.dataset.min === 'custom' : Number(c.dataset.min) === minutes);
  const n = state.settings.interval;
  const tiny = minutes === 5 && !custom && !join;
  $('#start-hint').textContent = (m === 'stopwatch' && !join ? 'Counts up, for up to 3 hours. Tap Done when you are; after 10 minutes your kitten comes home. '
    : tiny ? 'Just start. When it ends you can keep going. ' : '') + (!n || (tiny && m !== 'stopwatch') ? 'Kavana checks in once, at the end.'
    : s === 'nudge' ? `About every ${n} minutes it sends a short line to keep you going.`
    : `Every ${n} minutes it asks if you're still on it.`);

  // The window: the cat on its cushion, the ring around it for how long, the clock under it.
  const len = join ? Math.max(1, Math.round((join.end - now()) / 60000)) : homeMinutes();
  const watch = m === 'stopwatch' && !join;
  $('#home-window').classList.toggle('fixed', Boolean(join) || watch);
  $('#home-window').classList.toggle('nocat', !cats);
  ringTo(watch ? 0 : len);
  $('#home-window').setAttribute('aria-valuenow', String(len));
  $('#home-window').setAttribute('aria-valuetext', watch ? 'Stopwatch' : fmtMin(len));
  $('#home-clock').textContent = watch ? '0:00' : fmtClock(len * 60000);
  const art = $('#home-cat');
  const which = !watch && len < 25 ? 'kitten' : 'portrait';
  const key = `${inv.id}:${which}:${cats}`;
  if (art.dataset.k !== key) {
    art.replaceChildren(...(cats ? [catArt(inv, 'sit', which, { interactive: true, shadow: false })] : []));
    art.dataset.k = key;
  }
  $('#home-pane').style.setProperty('--sky1', homeSky()[0]);
  $('#home-pane').style.setProperty('--sky2', homeSky()[1]);
  $('#home-line').textContent = !cats ? $('#start-hint').textContent
    : join ? `${inv.name} comes along. You'll finish together at ${fmtTime(join.end)}.`
    : watch ? `Stay 10 minutes and ${inv.name} can come home. Stay 25 and it comes home grown up.`
    : len < 25 ? `Under 25 minutes, ${inv.name} comes home a kitten.` : `${inv.name} comes home grown up.`;
  $('#options').hidden = !optionsOpen;
  // One quiet row under Start: only the first of the banners that wants to show.
  let shown = false;
  for (const n of $('#quiet').children) { if (!n.hidden && shown) n.classList.add('waits'); else n.classList.remove('waits'); if (!n.hidden) shown = true; }

  const st = stats(E.history(D.doc));
  const goal = state.settings.goal;
  $('#today-min').textContent = fmtMin(st.today);
  $('#today-sub').textContent = goal ? (st.today >= goal ? 'Goal reached!' : `of ${fmtMin(goal)} today`) : 'focused today';
  $('#goal-ring').style.strokeDashoffset = String(100 - Math.min(100, (100 * st.today) / (goal || 60)));
  $('#streak-n').textContent = st.streak === 1 ? '1 day' : `${st.streak} days`;
  $('#streak-sub').textContent = st.streak ? 'in a row' : 'Start a streak today';

  const ms = E.missions(D.doc, now());
  $('#home-missions').textContent = ms.dayClosed ? 'Closed today' : `${ms.day.filter((x) => x.done).length} of ${ms.day.length}`;
  const myRank = rankings && rankings.on && rankings.friends.find((r) => r.me);
  $('#home-rank').textContent = myRank && rankings.friends.length > 1 ? `#${myRank.rank}` : '';

  drawFriendsHome();
  loadFriends().then(() => { if (route === 'focus' && state && !state.active && !state.onBreak) drawFriendsHome(); });
}
// How long the next block is: the ring, or the minutes typed in the sheet.
const homeMinutes = () => (!$('#custom-wrap').hidden ? Math.max(1, Math.min(240, Math.round(Number($('#start').custom.value) || 0))) : minutes);
// The ring around the window: 2 hours all the way round, with a knob at the end.
function ringTo(min) {
  const f = Math.max(0, Math.min(1, min / 120));
  $('#home-ring').style.strokeDashoffset = String(1000 * (1 - f));
  const a = f * Math.PI * 2 - Math.PI / 2;
  $('#home-knob').setAttribute('cx', String(160 + 148 * Math.cos(a)));
  $('#home-knob').setAttribute('cy', String(160 + 148 * Math.sin(a)));
}
// The sky in the window right now, and the one a running block goes through: afternoon, sunset, stars.
// Each stop is [progress, top, bottom]; the stops are close in hue, so the sky never goes muddy between them.
const SKY = [[0, '#8fcdf0', '#e7f6ff'], [0.3, '#9fd2ee', '#fdf0d8'], [0.48, '#f7c98a', '#fde6c2'], [0.64, '#f2a17c', '#fbd0a0'],
  [0.78, '#8a64ad', '#ee9d86'], [0.9, '#3d3a78', '#8a6a9e'], [1, '#1f2756', '#4a4f8c']];
const mixHex = (a, b, t) => { const A = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16)), B = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16)); return `rgb(${A.map((x, i) => Math.round(x + (B[i] - x) * t)).join(',')})`; };
function skyAt(p) {
  p = Math.max(0, Math.min(1, p));
  for (let i = 1; i < SKY.length; i++) if (p <= SKY[i][0]) { const [p0, t0, b0] = SKY[i - 1], [p1, t1, b1] = SKY[i]; const t = (p - p0) / (p1 - p0); return [mixHex(t0, t1, t), mixHex(b0, b1, t)]; }
  return [SKY[SKY.length - 1][1], SKY[SKY.length - 1][2]];
}
function homeSky() { const h = new Date().getHours() + new Date().getMinutes() / 60; return skyAt(h >= 7 && h < 16 ? 0 : h >= 16 && h < 19 ? 0.2 + (h - 16) / 3 * 0.55 : h >= 19 && h < 21 ? 0.75 + (h - 19) / 2 * 0.25 : h >= 5 && h < 7 ? 0.72 - (h - 5) / 2 * 0.72 : 1); }

// Tags on the start screen. The one used last is picked; tap it again for no tag.
const TAG_COLORS = ['#ff9500', '#007aff', '#34c759', '#af52de', '#ff2d55', '#00c7be', '#5856d6', '#ffcc00', '#a2845e', '#30b0c7', '#ff3b30', '#64d2ff'];
function tagColor(t) {
  if (!t) return 'var(--fill2)';
  const i = state.settings.tags.indexOf(t);
  return TAG_COLORS[(i >= 0 ? i : [...t].reduce((h, c) => h + c.charCodeAt(0), 0)) % TAG_COLORS.length];
}
const currentTag = () => (pickTag != null ? pickTag : state.settings.tag || '');
function drawTagChips() {
  const cur = currentTag();
  const chips = state.settings.tags.map((t) => {
    const c = el('button', `chip tagchip${t === cur ? ' on' : ''}`);
    c.type = 'button';
    c.dataset.tag = t;
    const dot = el('i', 'dot'); dot.style.background = tagColor(t);
    c.append(dot, t);
    return c;
  });
  const edit = el('button', 'chip plainchip', 'Edit');
  edit.type = 'button';
  edit.dataset.go = 'tags';
  $('#tags').replaceChildren(...chips, edit);
}

function drawFriendsHome() {
  const f = friends;
  const has = Boolean(D.account && f && f.friends.length);
  $('#friends-home').hidden = !(has && f.sharing);
  $('#friends-off').hidden = !(has && !f.sharing);
  if (!has || !f.sharing) return;
  $('#friends-list').replaceChildren(...f.friends.map((x) => {
    const row = el('div', 'row friend');
    const who = el('span', 'grow');
    who.append(el('b', null, x.display), el('span', 'sub', friendLine(x)));
    row.append(avatar(x.display, x.status), who);
    if (x.status === 'focusing' && x.left > 2 * 60000 && x.mode !== 'stopwatch') { // an open-ended block has no end to share
      const b = el('button', 'btn tinted small', 'Join');
      b.dataset.join = x.name;
      row.append(b);
    }
    return row;
  }));
}

function renderRemind() {
  show('remind');
  const err = $('#v-remind .err');
  if (!pushSupported) { err.textContent = TEXT.unsupported; err.hidden = false; }
  else if (Notification.permission === 'denied') { err.textContent = TEXT.denied; err.hidden = false; }
  else err.hidden = true;
  $('#remind-on').hidden = !pushSupported;
}

const names = (xs) => (xs.length <= 2 ? xs.join(' and ') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);
const napmates = (a) => (nap && a && nap.block === a.id && catsOn() ? nap.members.filter((m) => !m.me) : []);
function drawTogether(a) {
  const others = focusingFriends();
  const mates = napmates(a);
  const t = mates.length ? `Napping with ${names(mates.map((m) => m.display))}` : a.with ? `Focusing with ${a.with}` : others.length ? `${others.join(' and ')} ${others.length === 1 ? 'is' : 'are'} focusing too` : '';
  $('#run-friends').hidden = !t;
  $('#run-friends').textContent = t;
}

function renderRun() {
  show('run');
  const a = state.active;
  // The sky behind the block, and the dive into the window when it has just started.
  const sky = $('#sky');
  sky.hidden = false;
  if (diveFor === a.id) {
    diveFor = null;
    for (const n of [sky, $('#v-run')]) { n.classList.remove('dive'); void n.offsetWidth; n.classList.add('dive'); }
    setTimeout(() => { sky.classList.remove('dive'); $('#v-run').classList.remove('dive'); }, 1400);
  }
  const paused = Boolean(a.paused);
  const watch = a.mode === 'stopwatch';
  $('#run-eyebrow').textContent = paused ? 'Paused' : a.over ? 'Extra time' : watch ? 'Stopwatch' : 'Focusing';
  $('#run-intention').textContent = a.intention;
  $('#run-step').hidden = !a.step;
  $('#run-step').replaceChildren(...(a.step ? [el('b', null, 'First step: '), a.step] : []));
  $('#run-line').hidden = !a.line || paused;
  $('#run-line').textContent = a.line || '';
  drawTogether(a);
  // With cats on, the kitten grows inside the ring and the clock goes underneath.
  const cats = catsOn();
  if (cats) $('#dial').after($('#clockline')); else $('#dial-center').append($('#clockline'));
  if (!cats) { $('#mates').hidden = true; $('#dial').classList.remove('together', 'side', 'two'); }
  $('#dial').classList.toggle('withcat', cats);
  $('#kitten').hidden = !cats;
  $('#kitten-says').hidden = !cats;
  if (D.account) loadFriends().then(() => { if (state && state.active && state.active.id === a.id) drawTogether(a); });

  const disk = pref('face') === 'disk';
  $('#dial').classList.toggle('disk-mode', disk);
  $('#dial').classList.toggle('paused', paused);
  $('#run-disk').hidden = !disk;
  const pauseBtn = $('#t-pause');
  pauseBtn.hidden = (Boolean(a.nap) || !E.canPause(D.doc)) && !paused; // no pausing while napping together, or if it's turned off
  pauseBtn.textContent = paused ? 'Resume' : 'Pause';
  pauseBtn.className = `round ${paused ? 'green' : 'orange'}`;
  const tool = (id, label, on) => { const b = $(id); b.lastElementChild.textContent = label; b.classList.toggle('on', Boolean(on)); };
  tool('#t-park', a.parked.length ? `Parked (${a.parked.length})` : 'Park a thought');
  tool('#t-sound', Sound.playing.length ? mixLabel(soundMix()) : 'Sound', Sound.playing.length > 0);
  tool('#t-face', disk ? 'Ring' : 'Disk', disk);
  $('#t-sound').hidden = paused;
  $('#t-awake').hidden = !Wake.supported || paused;
  tool('#t-awake', Wake.on ? 'Screen stays on' : 'Screen on', Wake.on);
  // A room anyone can join with a code (needs an account, a timer block with a few minutes left).
  $('#t-room').hidden = !(D.account && catsOn() && !watch && !paused && !a.over && a.kitten === 'growing' && a.end - now() > 3 * 60000);
  tool('#t-room', nap && nap.block === a.id && nap.code ? `Room ${nap.code}` : 'Invite', Boolean(nap && nap.block === a.id && nap.code));

  const paint = () => {
    const at = paused ? a.paused : now();
    const left = a.end - at;
    const spent = a.total - left; // time on the block, pauses left out
    let frac, grow;
    if (watch) { // counts up; the ring fills once an hour
      $('#run-clock').textContent = fmtClock(spent);
      frac = 1 - (spent % 3600000) / 3600000;
      grow = spent < 10 * 60000 ? 0.25 * (spent / 600000) : spent < 40 * 60000 ? 0.25 + 0.5 * ((spent - 600000) / 1800000) : Math.min(1, 0.75 + 0.25 * ((spent - 2400000) / 1200000));
    } else if (a.over) { // past the end, counting the extra
      $('#run-clock').textContent = `+${fmtClock(Math.max(0, spent - a.minutes * 60000))}`;
      frac = 0; grow = 1;
    } else {
      $('#run-clock').textContent = fmtClock(left);
      frac = Math.max(0, Math.min(1, left / a.total));
      grow = 1 - frac;
    }
    $('#ring-prog').style.strokeDashoffset = String(1000 * (1 - frac));
    // Afternoon, sunset, then stars as the block goes on (a stopwatch over its 3 hours).
    const p = watch ? Math.min(1, spent / (180 * 60000)) : a.over ? 1 : grow;
    const [s1, s2] = skyAt(p);
    $('#sky').style.setProperty('--sky1', s1); $('#sky').style.setProperty('--sky2', s2);
    $('#sky').style.setProperty('--stars', String(Math.max(0, Math.min(1, (p - 0.7) / 0.3))));
    document.body.classList.toggle('dusk', p > 0.74); // white text once the sky turns purple
    $('#sky').classList.toggle('paused', paused);
    if (disk) $('#run-disk').style.setProperty('--left', String(frac));
    if (cats) { drawKitten(a, grow, paused); drawMates(a); }
    $('#run-ends span').textContent = paused ? 'Paused' : watch ? `Started ${fmtTime(a.start)}` : a.over ? `Ended ${fmtTime(a.over)}` : fmtTime(a.end);
    // The first 10 seconds: Cancel takes it back, no harm done. Then Stop (or Done, when it's yours to end).
    const grace = Math.ceil((a.cancelUntil - now()) / 1000);
    const stop = $('#stop');
    stop.textContent = grace > 0 && !a.nap ? `Cancel (${grace})` : watch || a.over ? 'Done' : 'Stop';
    stop.classList.toggle('cancel', grace > 0 && !a.nap);
    const parts = [];
    if (paused) parts.push(`Starts again by itself in ${fmtClock(a.pauseEnds - now())}`);
    else if (a.over) parts.push('Kavana counts until you tap Done');
    else if (!a.interval) parts.push('Check-in at the end');
    else if (a.style === 'nudge') parts.push(`Nudges about every ${a.interval} min`);
    else if (a.next && a.next > now()) parts.push(`Next check-in in ${minLeft(a.next - now())} min`);
    if (a.drifts) parts.push(`Drifted ${times(a.drifts)}`);
    $('#run-meta').textContent = parts.join(' · ');
  };
  paint();
  clockTimer = setInterval(paint, 1000); // also while paused: the pause counts down
}

// The kitten in the ring: napping when it arrives, a kitten in the middle, grown up in the last quarter,
// getting a little bigger every second. Home: the grown cat. Gone: an empty cushion and paw prints.
const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const smallBlock = (a) => (a.mode === 'stopwatch' ? now() - a.start - (a.end - a.start - a.total) < 25 * 60000 : a.minutes < 25);
function drawKitten(a, p, paused) {
  const c = K.byId(a.cat);
  const box = $('#kitten');
  let stage = a.kitten !== 'growing' ? a.kitten : p < 0.25 ? 'nap' : p < 0.75 ? 'kitten' : 'grown';
  if (stage === 'grown' && smallBlock(a)) stage = 'kitten'; // under 25 minutes, it comes home a kitten
  const key = `${a.id}:${c.id}:${stage}`;
  if (box.dataset.k !== key) {
    const which = stage === 'nap' ? 'nap' : stage === 'kitten' || (stage === 'home' && smallBlock(a)) ? 'kitten' : 'portrait';
    const same = box.dataset.k && box.dataset.k.split(':').slice(0, 2).join(':') === `${a.id}:${c.id}`;
    const living = box.firstElementChild && box.firstElementChild.cat;
    if (stage === 'gone' && same && !reduceMotion()) { // it tiptoes out of the window, then the empty cushion
      box.dataset.k = key;
      const walk = el('img', 'kittenart tiptoe');
      walk.src = (c.poses && c.poses.walk) || c.kitten;
      walk.alt = '';
      box.replaceChildren(walk);
      setTimeout(() => { if (box.dataset.k === key) { const g = thing({ art: 'cafe/gone-1.webp' }); g.classList.add('kittenart'); box.replaceChildren(g); } }, 1400);
    } else if (stage !== 'gone' && same && living) {
      living.morph(c.id, which); // the same kitten growing: a squash and a pop into the next picture
      if (stage === 'home') setTimeout(() => living.happy(), 500);
    } else {
      const art = stage === 'gone' ? thing({ art: 'cafe/gone-1.webp' }) : catArt(c, stage === 'home' ? 'cheer' : 'sit', which, { interactive: true });
      art.classList.add('kittenart');
      if (same && !art.classList.contains('catbox')) art.classList.add('grew'); // a still picture: a little hop instead
      box.replaceChildren(art);
    }
    box.dataset.k = key;
  }
  box.style.setProperty('--grow', growSize(stage, p).toFixed(3));
  $('#dial').classList.toggle('gone', stage === 'gone'); // the empty cushion is its own picture
  box.classList.toggle('ghostly', c.breed === 'ghost');
  const says = $('#kitten-says');
  says.classList.toggle('sad', stage === 'gone');
  const mates = napmates(a);
  says.textContent = stage === 'gone' ? (a.goneWhy === 'nap' ? `${a.goneBy || 'Someone'} left the nap, so every kitten wandered off. Your block keeps going.`
    : a.goneWhy === 'away' ? `${c.name} wandered off while you were away. Your block keeps going.` : `${c.name} wandered off.`)
    : mates.length && stage !== 'home' ? `${mates.some((m) => m.away) ? `${names(mates.filter((m) => m.away).map((m) => m.display))} stepped away. ` : ''}Napping together. If anyone leaves, every kitten wanders off.`
    : stage === 'home' ? (a.over ? `${c.name} came home. Every extra minute is another treat.` : `${c.name} came home. Keep going for more treats.`)
    : paused ? `${c.name} waits for you. A pause lasts 5 minutes at most.`
    : a.mode === 'stopwatch' ? (now() - a.start - (a.end - a.start - a.total) < 600000 ? `Stay 10 minutes and ${c.name} can come home.` : `${c.name} can come home now. Tap Done when you're done.`)
    : stage === 'grown' ? `Almost there. ${c.name} is nearly grown up.`
    : stage === 'nap' ? `${c.name} just arrived. Stay in Kavana and it grows.` : `${c.name} is growing. Stay with it.`;
}

const growSize = (stage, p) => (stage === 'nap' ? 0.55 + 0.13 * (p / 0.25) : stage === 'kitten' ? 0.68 + 0.18 * ((p - 0.25) / 0.5)
  : stage === 'grown' ? 0.86 + 0.14 * ((p - 0.75) / 0.25) : stage === 'home' ? 1 : 0.8);

// Napping together: your friends' kittens grow in the same ring, smaller, along the bottom.
function drawMates(a) {
  const box = $('#mates');
  const mates = napmates(a);
  $('#dial').classList.toggle('together', mates.length > 0);
  $('#dial').classList.toggle('side', mates.length > 0 && mates.length <= 2);
  $('#dial').classList.toggle('two', mates.length === 2);
  box.hidden = !mates.length;
  if (!mates.length) { box.replaceChildren(); box.dataset.k = ''; return; }
  const t = now();
  const shown = mates.slice(0, 4).map((m) => {
    const p = Math.max(0, Math.min(1, (t - m.start) / Math.max(1, nap.end - m.start)));
    const stage = nap.broken ? 'gone' : t >= nap.end ? 'home' : p < 0.25 ? 'nap' : p < 0.75 ? 'kitten' : 'grown';
    return { m, p, stage, c: K.byId(m.cat) };
  });
  const key = shown.map((x) => `${x.m.name}:${x.c.id}:${x.stage}:${x.m.away ? 1 : 0}`).join('|') + `+${mates.length}`;
  if (box.dataset.k !== key) {
    box.replaceChildren(...shown.map(({ m, stage, c }) => {
      const fig = el('figure', `mate${c.breed === 'ghost' ? ' ghostly' : ''}${m.away ? ' away' : ''}`);
      const art = stage === 'gone' ? thing({ art: 'cafe/gone-1.webp' }) : catArt(c, 'sit', stage === 'nap' ? 'nap' : stage === 'kitten' ? 'kitten' : 'portrait', { shadow: false });
      art.classList.add('mateart');
      fig.append(art, el('figcaption', null, m.display));
      return fig;
    }), ...(mates.length > 4 ? [el('span', 'matemore', `+${mates.length - 4}`)] : []));
    box.dataset.k = key;
  }
  box.querySelectorAll('.mate').forEach((f, i) => f.style.setProperty('--grow', growSize(shown[i].stage, shown[i].p).toFixed(3)));
}

// The page asks the server how the group is doing every few seconds (and once more after the end, in
// case someone left just before it): who's in it, and whether someone left or stopped. Then your
// kitten wanders off too. The one who started the block finds out this way that it's a group now.
async function askNap(block) {
  let g = null;
  try { g = await D.api('GET', `api/nap?block=${encodeURIComponent(block)}`); } catch { return; }
  const prev = nap && nap.block === block ? nap : null;
  if (!g) { if (prev) { nap = null; refresh(); } return; }
  nap = { ...g, block };
  const b = D.doc.blocks.find((x) => x.id === block);
  if (!b) return;
  const others = g.members.filter((m) => !m.me);
  if (g.broken) {
    if (!b.gone && !(b.home && b.home <= g.broken.at) && D.act((doc, t) => E.napGone(doc, g.id, g.broken.at, g.broken.by, t))) {
      if (Sound.playing.includes('purr')) Sound.play(soundMix().filter((m) => m.id !== 'purr'));
      D.track('nap_gone', { why: g.broken.why });
      toast(`${g.broken.by} ${g.broken.why === 'away' ? 'left Kavana' : 'stopped'}, so every kitten wandered off.`);
    }
  } else {
    if (b.nap !== g.id || (b.napN || 0) < others.length) {
      D.act((doc, t) => E.napWith(doc, block, g.id, others.length, t));
      if (!prev && g.host) toast(`${names(others.map((m) => m.display))} joined you. If anyone leaves, every kitten wanders off.`);
    }
    const fresh = prev ? others.filter((m) => !prev.members.some((x) => x.name === m.name)) : [];
    if (fresh.length) toast(`${names(fresh.map((m) => m.display))} joined. If anyone leaves, every kitten wanders off.`);
  }
  if (JSON.stringify(prev && { ...prev, block: 0 }) !== JSON.stringify({ ...nap, block: 0 })) refresh();
}
// Which block to ask about: the one running (if it's in a group, or might be: you share and have
// friends), or the last one in a group that came home in the last 12 hours.
function napBlock() {
  if (!D.account || !catsOn() || !state) return null;
  const a = state.active;
  if (a) return a.nap || (nap && nap.block === a.id && nap.code) || (a.kitten === 'growing' && friends && friends.sharing && friends.friends.length) ? a.id : null;
  const last = D.doc.blocks.filter((b) => b.nap && b.ended && b.home && now() - b.ended < 12 * 3600000).sort((x, y) => y.ended - x.ended)[0];
  return last && !(nap && nap.block === last.id && nap.broken) ? last.id : null; // a broken group has nothing more to say
}
const napSay = (what, block) => fetch(`api/nap/${what}`, {
  method: 'POST', credentials: 'same-origin', keepalive: true, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ block }),
}).catch(() => {});
// Joining a friend: my block is started; now put it in their group.
async function joinNap(j) {
  const b = E.running(D.doc);
  if (!b || !b.cat) return;
  try {
    const g = await D.api('POST', 'api/nap/join', { id: j.nap, block: b.id, cat: b.cat, start: b.start, code: j.code });
    nap = { ...g, block: b.id };
    D.act((doc, t) => E.napWith(doc, b.id, g.id, g.members.length - 1, t));
    D.track('nap', { n: g.members.length });
  } catch (e) {
    toast(e.message === 'broken' ? `Someone in ${j.name}'s nap left already. You're focusing on your own.` : `Couldn't nap with ${j.name}. You're focusing on your own.`);
  }
  refresh();
}

// Leaving Kavana in the middle of a block sends the kitten off, like Forest. A few seconds are
// allowed (a glance at a notification). When you left is kept in the browser, in case the page was
// closed by the time you come back.
const AWAY_GRACE = 15000;
function leftKavana(e) {
  if (!state || !state.active || state.active.kitten !== 'growing' || !catsOn()) return;
  if (!pref('left')) {
    pref('left', String(now()));
    if (napBlock() === state.active.id) napSay('left', state.active.id);
    if (swReg && 'Notification' in window && Notification.permission === 'granted') {
      const c = K.byId(state.active.cat);
      swReg.showNotification(`🐱 ${c.name} is waiting`, { body: `Come back to Kavana, or ${c.name} wanders off.`, tag: 'kavana-away', icon: 'icons/cat-boo.png', silent: true }).catch(() => {});
    }
  }
  if (e && e.type === 'pagehide') pref('leftHow', 'close'); // closing Kavana, not just switching away
}
// A reload is never leaving, however long the page took to come back (a slow network, an update):
// unfair losses are what upset people most in Forest.
const reloaded = () => { try { return performance.getEntriesByType('navigation')[0].type === 'reload'; } catch { return false; } };
function backInKavana(boot) {
  const t = Number(pref('left')) || 0;
  const closed = pref('leftHow') === 'close';
  pref('left', null); pref('leftHow', null);
  if (boot && reloaded() && closed) { if (t && state && state.active && napBlock() === state.active.id) napSay('back', state.active.id); return; }
  if (t && state && state.active && napBlock() === state.active.id) { const id = state.active.id; napSay('back', id).then(() => askNap(id)); }
  if (swReg && swReg.getNotifications) swReg.getNotifications({ tag: 'kavana-away' }).then((ns) => ns.forEach((x) => x.close())).catch(() => {});
  if (!t || now() - t <= AWAY_GRACE) return;
  if (closed && D.doc.settings.closeCounts === false) return; // Settings: closing Kavana doesn't count
  const gone = D.act((doc, n) => E.away(doc, t, n, AWAY_GRACE)); // a pause in between moves the start of the grace
  if (!gone) return;
  if (Sound.playing.includes('purr')) Sound.play(soundMix().filter((m) => m.id !== 'purr')); // the purring cat left too
  D.track('away', { min: Math.round((now() - t) / 60000) });
  refresh();
  toast(`${K.byId(gone.cat).name} wandered off while you were away.`);
}

function renderBreak() {
  show('break');
  const b = state.onBreak;
  putCat($('#break-cat'), 'sit');
  const paint = () => {
    const left = b.end - now();
    $('#break-clock').textContent = fmtClock(left);
    $('#break-prog').style.strokeDashoffset = String(1000 * (1 - Math.max(0, Math.min(1, left / (b.end - b.start)))));
  };
  paint();
  clockTimer = setInterval(paint, 1000);
}

// Box breathing: in, hold, out, hold, four seconds each, four rounds. The flower is CSS.
let breathTimer = null;
function renderBreathe() {
  show('breathe');
  for (const b of $$('#breath-len button')) b.classList.toggle('on', Number(b.dataset.len) === breathLen);
  $('#breath-sound').textContent = Sound.playing.length ? 'Sound on' : 'Sound';
  if (breathTimer || !$('#breath-end').hidden) return;
  $('#breath-run').hidden = false;
  const f = $('#flower');
  f.style.animation = 'none';
  void f.offsetWidth; // restart from the top
  f.style.animation = '';
  const words = ['Breathe in', 'Hold', 'Breathe out', 'Hold'];
  const steps = Math.max(4, Math.round((breathLen * 60) / 16)) * 4; // four seconds a step, four steps a round
  let step = 0;
  $('#breath-word').textContent = words[0];
  $('#breath-meta').textContent = `Four seconds in, hold, out, hold. ${steps / 4} rounds.`;
  const mix = soundMix();
  if (mix.length) { Sound.prime(); Sound.play(mix); }
  D.track('breathe', { len: breathLen });
  breathTimer = setInterval(() => {
    step += 1;
    if (step >= steps) {
      stopBreath();
      D.track('mindful', { done: breathLen });
      D.act((doc, t) => E.count(doc, 'breathes', t));
      $('#breath-run').hidden = true;
      $('#breath-end').hidden = false;
      chime(true);
      return;
    }
    $('#breath-word').textContent = words[step % 4];
  }, 4000);
}
function stopBreath() { clearInterval(breathTimer); breathTimer = null; }
// Leaving the breathing screen resets it for next time.
function resetBreath() { stopBreath(); $('#breath-end').hidden = true; $('#breath-run').hidden = false; }

const OUTCOME = { done: ['🎉', 'Done'], partly: ['🌗', 'Partly'], notreally: ['🌧️', 'Not really'] };
const WHY_LABEL = { phone: 'Phone', messages: 'Messages', email: 'Email', web: 'The web', thoughts: 'Thoughts', people: 'People', tired: 'Tired', hungry: 'Hunger', other: 'Other' };

function topWhy(blocks) {
  const weekAgo = now() - 7 * 86400000;
  const n = {};
  for (const b of blocks) if (b.start >= weekAgo) for (const w of b.whys || []) n[w] = (n[w] || 0) + 1;
  return Object.keys(n).sort((a, b) => n[b] - n[a])[0] || null;
}

// Five weeks, Sunday to Saturday, darker = more focus. The darkest shade means the daily goal was met.
function drawHeat(blocks) {
  const mins = {};
  for (const b of blocks) mins[dayKey(b.start)] = (mins[dayKey(b.start)] || 0) + b.actual;
  const goal = state.settings.goal;
  const steps = goal ? [goal / 3, (goal * 2) / 3, goal] : [20, 45, 90];
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - d.getDay() - 28);
  const today = dayKey(now());
  const cells = ['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((x) => el('span', 'dn', x));
  let future = false;
  for (let i = 0; i < 35; i++) {
    const key = dayKey(d);
    const m = mins[key] || 0;
    const e = el('span', 'd');
    if (future) e.classList.add('future');
    else if (m) e.classList.add(`l${1 + steps.filter((x) => m >= x).length}`);
    if (key === today) { e.classList.add('today'); future = true; }
    e.title = `${d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}: ${m ? fmtMin(m) : 'nothing'}`;
    cells.push(e);
    d.setDate(d.getDate() + 1);
  }
  $('#heat-grid').replaceChildren(...cells);
  $('#heat').hidden = !blocks.length && !hasPast(); // five weeks are never in the past, but a past is still a history
}

function dayLabel(t) {
  const k = dayKey(t);
  if (k === dayKey(now())) return 'Today';
  if (k === dayKey(now() - 86400000)) return 'Yesterday';
  return new Date(t).toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
}

// ---------- the Cat Café: the cats that came home, your focus time, your history ----------
function periodOf(span, at) {
  const d = new Date(at);
  d.setHours(0, 0, 0, 0);
  let from = new Date(d);
  if (span === 'week') from.setDate(d.getDate() - d.getDay()); // Sunday, like the 5-week grid
  if (span === 'month') from = new Date(d.getFullYear(), d.getMonth(), 1);
  if (span === 'year') from = new Date(d.getFullYear(), 0, 1);
  const to = new Date(from);
  if (span === 'day') to.setDate(to.getDate() + 1);
  if (span === 'week') to.setDate(to.getDate() + 7);
  if (span === 'month') to.setMonth(to.getMonth() + 1);
  if (span === 'year') to.setFullYear(to.getFullYear() + 1);
  return { from: from.getTime(), to: to.getTime() };
}
function shiftPeriod(span, at, dir) {
  const d = new Date(periodOf(span, at).from);
  if (span === 'day') d.setDate(d.getDate() + dir);
  if (span === 'week') d.setDate(d.getDate() + 7 * dir);
  if (span === 'month') d.setMonth(d.getMonth() + dir);
  if (span === 'year') d.setFullYear(d.getFullYear() + dir);
  return d.getTime();
}
function periodLabel(span, p) {
  const same = (dir) => periodOf(span, shiftPeriod(span, now(), dir)).from === p.from;
  const cur = periodOf(span, now()).from === p.from;
  const f = new Date(p.from);
  const short = { month: 'short', day: 'numeric' };
  if (span === 'day') return cur ? 'Today' : same(-1) ? 'Yesterday' : f.toLocaleDateString(undefined, { weekday: 'long', ...short });
  if (span === 'week') {
    if (cur) return 'This Week';
    if (same(-1)) return 'Last Week';
    const l = new Date(p.to - 43200000);
    return `${f.toLocaleDateString(undefined, short)} – ${l.toLocaleDateString(undefined, l.getMonth() === f.getMonth() ? { day: 'numeric' } : short)}`;
  }
  if (span === 'month') return cur ? 'This Month' : f.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  return cur ? 'This Year' : String(f.getFullYear());
}
const PERIOD_WORD = { day: 'today', week: 'this week', month: 'this month', year: 'this year' };

const hashOf = (str) => [...str].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
const MAX_IN_ROOM = 60;
// The past's kittens, for the room: no block behind them, only their day. Newest first, like E.history.
const pastKittens = (past) => [...past].reverse().flatMap((x) => [
  ...Object.entries(x.cats).flatMap(([cat, n]) => Array.from({ length: n }, (_, i) => ({ id: `past-${x.day}-${cat}-${i}`, start: x.day, cat, kitten: 'home', past: true }))),
  ...Array.from({ length: x.gone }, (_, i) => ({ id: `past-${x.day}-gone-${i}`, start: x.day, kitten: 'gone', past: true })),
]);
const C3 = window.KavanaCafe3D;
const dayLong = (t) => new Date(t).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
// A block under 25 minutes brings home a kitten; 25 and up, the grown cat.
const cameHomeSmall = (b) => !b.past && b.actual < 25;
// One cat in the 3D café, from a block (or a day in the past) that came home.
function cafeCat(b) {
  const c = K.byId(b.cat);
  const small = cameHomeSmall(b);
  return {
    key: b.id, id: c.id, src: small ? c.kitten : c.portrait, napSrc: small ? null : c.nap, kitten: small, poses: small ? null : c.poses || null,
    ghost: c.breed === 'ghost', title: c.name, sub: b.past ? dayLong(b.start) : `${b.intention} · ${fmtMin(b.actual)}`,
  };
}
const ITEM_NAMES = Object.fromEntries(K.ITEMS.map((x) => [x.id, [x.name, x.about]]));
const ITEM_VIEWS = Object.fromEntries(K.ITEMS.filter((x) => x.views).map((x) => [x.id, x.views]));
const darkMode = () => matchMedia('(prefers-color-scheme: dark)').matches;
// Everything the 3D café draws, for a list of blocks: the things you own, the cats that came home (the first
// 60), the shelter cats who live there, and paw prints for the ones that wandered off.
function cafeData(list, size, seed) {
  const home = list.filter((b) => b.kitten === 'home').sort((a, b) => a.start - b.start);
  return {
    size, seed, theme: state.settings.theme || 'classic', light: C3.lightAt(now()), dim: darkMode(),
    things: K.ITEMS.filter((x) => E.owns(D.doc, x.id)).map((x) => x.id), views: ITEM_VIEWS,
    cats: home.slice(0, MAX_IN_ROOM).map(cafeCat),
    residents: K.SHELTER.filter((c) => E.owns(D.doc, c.id)).map((c) => ({ key: c.id, id: c.id, src: c.portrait, title: c.name, sub: 'A shelter cat you sponsored' })),
    gone: list.filter((b) => b.kitten === 'gone').map((b) => b.id),
  };
}
let cafe3 = null;
function drawRoom(blocks, p, past) {
  const list = [...blocks, ...pastKittens(past)];
  const homeN = list.filter((b) => b.kitten === 'home').length;
  if (!cafe3) cafe3 = C3.create($('#room'), { names: ITEM_NAMES });
  const size = cafe.span === 'day' ? 'day' : cafe.span === 'week' ? 'week' : 'month';
  cafe3.show(cafeData(list, size, hashOf(`${cafe.span}${p.from}`)));
  const empty = $('#roomempty');
  empty.hidden = homeN > 0;
  const word = periodOf(cafe.span, now()).from === p.from ? PERIOD_WORD[cafe.span] : '';
  empty.textContent = list.some((b) => b.kitten === 'gone')
    ? `No cats stayed ${word || 'then'}. Next time, stay to the end.`
    : `No cats came home ${word || 'then'}. ${word ? 'Finish a block and one will.' : ''}`.trim();
  return homeN - Math.min(homeN, MAX_IN_ROOM);
}

// Focus time in the period, as stacked bars by tag: hours of a day, days of a week or month, months of a year.
// A day in the past goes in its day's bar (its month's for a year). The past doesn't keep hours, so in
// a day's chart, which is by the hour, its minutes are only in By tag.
function drawChart(list, p, past) {
  const span = cafe.span;
  const f = new Date(p.from);
  const n = span === 'day' ? 24 : span === 'week' ? 7 : span === 'month' ? new Date(f.getFullYear(), f.getMonth() + 1, 0).getDate() : 12;
  const slot = (t) => { const d = new Date(t); return span === 'day' ? d.getHours() : span === 'week' ? d.getDay() : span === 'month' ? d.getDate() - 1 : d.getMonth(); };
  const bars = Array.from({ length: n }, () => ({}));
  for (const b of list) {
    for (let i = 0; i < b.actual; i++) { // minute by minute, so a block over the hour splits
      const t = b.start + i * 60000;
      if (t < p.from || t >= p.to) continue;
      const k = b.tag || '';
      const bar = bars[slot(t)];
      bar[k] = (bar[k] || 0) + 1;
    }
  }
  const byHour = span === 'day';
  if (!byHour) for (const x of past) { const bar = bars[slot(x.day)]; for (const [k, v] of Object.entries(x.focus)) bar[k] = (bar[k] || 0) + v; }
  $('#chart-foot').hidden = !(byHour && past.length);
  $('#chart-foot').textContent = byHour && past.length ? `Days up to ${pastUpTo()} don't keep their hours, so their minutes are only in By tag.` : '';
  const totals = bars.map((x) => Object.values(x).reduce((a, v) => a + v, 0));
  const max = Math.max(1, ...totals);
  const W = 320, H = 132, base = 112;
  const svg = document.createElementNS(SVGNS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('class', 'tagbars');
  const w = W / n;
  const node = (tag, attrs) => { const e = document.createElementNS(SVGNS, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v)); return e; };
  const order = [...state.settings.tags, ''];
  const rank = (k) => { const i = order.indexOf(k); return i < 0 ? 98 : i; };
  bars.forEach((bar, i) => {
    let y = base;
    const keys = Object.keys(bar).sort((a, b) => rank(a) - rank(b));
    if (!keys.length) svg.append(node('rect', { x: i * w + w * 0.18, width: w * 0.64, y: base - 2, height: 2, rx: 1, class: 'none' }));
    for (const k of keys) {
      const h = (96 * bar[k]) / max;
      const r = node('rect', { x: i * w + w * 0.18, width: w * 0.64, y: y - h, height: h, rx: Math.min(3, w * 0.2) });
      r.style.fill = tagColor(k);
      y -= h;
      svg.append(r);
    }
    const label = span === 'day' ? (i % 6 === 0 ? fmtTime(new Date(f).setHours(i, 0)).replace(':00', '') : '')
      : span === 'week' ? 'SMTWTFS'[i] : span === 'month' ? ([0, 7, 14, 21, 28].includes(i) ? String(i + 1) : '') : 'JFMAMJJASOND'[i];
    if (label) { const t = node('text', { x: i * w + w / 2, y: H - 4, 'text-anchor': span === 'day' ? 'start' : 'middle' }); t.textContent = label; svg.append(t); }
  });
  const top = node('text', { x: W, y: 9, 'text-anchor': 'end' });
  top.textContent = fmtMin(max);
  svg.append(top, node('line', { x1: 0, x2: W, y1: base + 0.5, y2: base + 0.5, class: 'axis' }));
  $('#chart').replaceChildren(svg);

  // By tag: a ring and the list.
  const byTag = {};
  for (const bar of bars) for (const [k, v] of Object.entries(bar)) byTag[k] = (byTag[k] || 0) + v;
  if (byHour) for (const x of past) for (const [k, v] of Object.entries(x.focus)) byTag[k] = (byTag[k] || 0) + v;
  const total = Object.values(byTag).reduce((a, v) => a + v, 0);
  const keys = Object.keys(byTag).sort((a, b) => byTag[b] - byTag[a]);
  let acc = 0;
  const stops = keys.map((k) => { const a = acc; acc += byTag[k] / total; return `${tagColor(k)} ${(a * 360).toFixed(1)}deg ${(acc * 360).toFixed(1)}deg`; });
  $('#donut').style.background = total ? `conic-gradient(${stops.join(', ')})` : 'var(--fill)';
  $('#donut-total').textContent = fmtMin(total);
  $('#taglegend').replaceChildren(...keys.map((k) => {
    const row = el('div', 'legendrow');
    const dot = el('i', 'dot'); dot.style.background = tagColor(k);
    row.append(dot, el('span', 'grow', k || 'No tag'), el('span', 'min', fmtMin(byTag[k])), el('span', 'pct', `${Math.round((100 * byTag[k]) / total)}%`));
    return row;
  }));
  $('#cafe-charts').hidden = !total;
}

// When you focus: minutes by hour of the day, over the whole period (Forest's "focused time distribution").
// The past keeps each day's minutes but not their hours, so its days aren't in it, and a period that's
// all in the past has nothing to show here.
function drawHours(list, p, past) {
  $('#hours-box').hidden = cafe.span === 'day' || (past.length > 0 && !list.length); // the day's chart is already by hour
  if ($('#hours-box').hidden) return;
  const bars = Array(24).fill(0);
  for (const b of list) for (let i = 0; i < b.actual; i++) bars[new Date(b.start + i * 60000).getHours()] += 1;
  const max = Math.max(1, ...bars);
  const W = 320, H = 110, base = 92, w = W / 24;
  const svg = document.createElementNS(SVGNS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('class', 'tagbars');
  const node = (tag, attrs) => { const e = document.createElementNS(SVGNS, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v)); return e; };
  bars.forEach((v, i) => {
    const h = v ? Math.max(2, (80 * v) / max) : 2;
    const r = node('rect', { x: i * w + w * 0.18, width: w * 0.64, y: base - h, height: h, rx: Math.min(3, w * 0.2), class: v ? 'hour' : 'none' });
    svg.append(r);
    if (i % 6 === 0) { const t = node('text', { x: i * w + w / 2, y: H - 4, 'text-anchor': 'start' }); t.textContent = fmtTime(new Date(p.from).setHours(i, 0)).replace(':00', ''); svg.append(t); }
  });
  $('#hours').replaceChildren(svg);
  const top = bars.indexOf(Math.max(...bars));
  $('#hours-foot').textContent = [bars.some(Boolean) ? `You focus most around ${fmtTime(new Date(p.from).setHours(top, 0)).replace(':00', '')}.` : '',
    past.length ? `Days up to ${pastUpTo()} don't keep their hours, so they aren't in it.` : ''].filter(Boolean).join(' ');
}
// Who came home: each cat and how many times, most first.
function drawTally(list, past) {
  const n = {};
  for (const b of list) if (b.kitten === 'home') n[b.cat] = (n[b.cat] || 0) + 1;
  for (const x of past) for (const [id, v] of Object.entries(x.cats)) n[id] = (n[id] || 0) + v;
  const ids = Object.keys(n).sort((a, b) => n[b] - n[a]);
  $('#cattally').replaceChildren(...(ids.length ? ids.map((id) => {
    const c = K.byId(id);
    const f = el('figure', 'tallycat');
    f.append(portrait(c, 'sit'), el('figcaption', null, `${c.name} ×${n[id]}`));
    return f;
  }) : [el('p', 'sub', 'Nobody yet.')]));
}
function renderCafe() {
  show('cafe');
  $('#cafe-treats').textContent = fish(treatsLeft());
  for (const b of $$('#cafe-span button')) b.classList.toggle('on', b.dataset.span === cafe.span);
  const p = periodOf(cafe.span, cafe.at);
  $('#cafe-now').textContent = periodLabel(cafe.span, p);
  $('#cafe-next').disabled = p.to > now();
  const blocks = E.history(D.doc);
  const list = blocks.filter((b) => b.start >= p.from && b.start < p.to);
  const past = E.pastDays(D.doc, p.from, p.to); // the days whose blocks are folded into doc.past
  const more = drawRoom(list, p, past);
  drawChart(list, p, past);
  const ev = E.season(now());
  $('#event-banner').hidden = !ev;
  if (ev) $('#event-banner').textContent = `${EVENT_ICON[ev.id] || ''} ${ev.name} is in the shop until ${eventEnd(ev, now())}: ${EVENT_TEASE[ev.id]}.`;

  const minutes = (bs, days) => days.reduce((n, x) => n + focusOf(x), bs.reduce((n, b) => n + b.actual, 0));
  const listHome = list.filter((b) => b.kitten === 'home').length;
  const home = past.reduce((n, x) => n + x.home, listHome);
  const gone = past.reduce((n, x) => n + x.gone, list.length - listHome);
  const is = minutes(list, past);
  const tiles = [[String(home), home === 1 ? 'cat came home' : 'cats came home'], [fmtMin(is), 'focused']];
  if (gone) tiles.push([String(gone), gone === 1 ? 'wandered off' : 'wandered off']);
  const earned = list.reduce((n, b) => n + b.treats, 0);
  if (earned && !past.length) tiles.push([fish(earned), 'treats earned']); // the past banks its treats, but not by day
  if (more) tiles.push([`+${more}`, 'more cats than fit in the room']);
  // Compared with the period before (like Forest's overview).
  const before = periodOf(cafe.span, shiftPeriod(cafe.span, cafe.at, -1));
  const was = minutes(blocks.filter((b) => b.start >= before.from && b.start < before.to), E.pastDays(D.doc, before.from, before.to));
  if (was || is) {
    const d = is - was;
    const vs = { day: 'yesterday', week: 'last week', month: 'last month', year: 'last year' }[cafe.span];
    tiles.push([`${d > 0 ? '+' : d < 0 ? '−' : ''}${fmtMin(Math.abs(d))}`, d === 0 ? `same as ${vs}` : `${d > 0 ? 'more' : 'less'} than ${vs}`]);
  }
  $('#cafe-tiles').replaceChildren(...tiles.map(([big, small]) => { const t = el('div'); t.append(el('b', null, big), el('span', null, small)); return t; }));

  // The blocks in this period, newest first, by day.
  const out = [];
  let group = null, label = null;
  for (const b of list) {
    const l = dayLabel(b.start);
    if (l !== label) { label = l; out.push(el('p', 'ghead', l)); group = el('div', 'group'); out.push(group); }
    const row = el('div', 'row hrow');
    const length = b.actual < b.minutes ? `${b.actual} of ${b.minutes} min` : `${b.minutes} min`;
    const drift = b.style === 'nudge' ? (b.checkins === 1 ? '1 nudge' : `${b.checkins} nudges`)
      : b.drifts ? `drifted ${times(b.drifts)}` : b.checkins ? 'no drift' : 'no check-ins';
    const [emo, word] = OUTCOME[b.outcome] || ['⏹️', 'No answer'];
    const mid = el('span', 'grow');
    const what = el('span', 'what', b.intention);
    if (b.tag) { const t = el('span', 'htag', b.tag); t.style.setProperty('--c', tagColor(b.tag)); what.append(' ', t); }
    mid.append(what, el('span', 'meta', `${word} · ${b.mode === 'stopwatch' ? `stopwatch, ${b.actual} min` : length} · ${drift}`));
    if (b.note) mid.append(el('span', 'hnote', b.note));
    row.dataset.edit = b.id;
    row.title = 'Tap to edit';
    const c = K.byId(b.cat);
    const who = el('span', `hcat ${b.kitten}`);
    who.title = b.kitten === 'home' ? `${c.name} came home` : `${c.name} wandered off`;
    who.append(b.kitten === 'home' ? portrait(c, 'sit') : icon('paw'));
    row.append(el('span', 'emo', emo), mid, el('span', 'when', fmtTime(b.start)), who);
    if (b.parked.length) { const pk = el('div', 'parked'); for (const t of b.parked) pk.append(el('div', null, t)); row.append(pk); }
    group.append(row);
  }
  if (past.length) out.push(el('p', 'gfoot', `Your blocks up to ${pastUpTo()} are kept as each day's totals, so they count above but aren't listed here.`));
  $('#hist').replaceChildren(...out);
  drawHours(list, p, past);
  drawTally(list, past);
  const any = blocks.length > 0 || hasPast();
  $('#hist-empty').hidden = any;
  if (!any) putCat($('#hist-cat'), 'sleep');

  // Habits, over everything.
  const st = stats(blocks);
  const habit = [
    [fmtMin(st.today), 'today'],
    [fmtMin(st.week), 'last 7 days'],
    [String(st.weekBlocks), st.weekBlocks === 1 ? 'block this week' : 'blocks this week'],
    [`${st.streak} 🐾`, st.streak === 1 ? 'day in a row' : 'days in a row'],
  ];
  if (st.answered) habit.push([`${Math.round((100 * (st.answered - st.drifted)) / st.answered)}%`, 'check-ins on track']);
  const why = topWhy(blocks);
  if (why) habit.push([WHY_LABEL[why], 'pulled you away most']);
  $('#hist-stats').replaceChildren(...habit.map(([big, small]) => { const t = el('div'); t.append(el('b', null, big), el('span', null, small)); return t; }));
  $('#hist-stats').hidden = !any;
  $('#habits').hidden = !any;
  drawHeat(blocks);
  $('#clear').hidden = !any; // it empties the past too
}

function renderLater() {
  show('later');
  $('#later-list').replaceChildren(...state.later.map((x) => {
    const row = el('div', 'row lrow');
    row.dataset.id = x.id;
    const check = el('button', 'check'); check.dataset.laterDone = ''; check.setAttribute('aria-label', 'Done'); check.append(icon('check'));
    const goBtn = el('button', 'go'); goBtn.dataset.laterStart = ''; goBtn.setAttribute('aria-label', 'Start'); goBtn.append(icon('play'));
    row.append(check, el('span', 'text', x.text), goBtn);
    return row;
  }));
  $('#later-list').hidden = !state.later.length;
  $('#later-empty').hidden = state.later.length > 0;
  if (!state.later.length) putCat($('#later-cat'), 'sit');
}

function renderCats() {
  show('cats');
  const pane = ['shop', 'missions'].includes(route) ? route : 'cats'; // the Cats tab's panes: My Cats (#cats), Missions, Shop
  for (const b of $$('#cats-seg button')) b.classList.toggle('on', b.dataset.pane === pane);
  for (const x of ['cats', 'missions', 'shop']) $(`#pane-${x}`).hidden = x !== pane;
  $('#cats-treats').textContent = fish(treatsLeft());
  const met = metCats();
  pref('catsKnown', String(met.length));
  $('#menu-dot').hidden = !unreadNews().length;
  if (pane === 'shop') return drawShop();
  if (pane === 'missions') return drawMissions();
  const mine = companion();
  const meetable = K.CATS.filter((c) => !c.adopt);
  const metN = met.filter((c) => !c.adopt).length;
  const adopted = met.length - metN;
  $('#cats-lede').textContent = `${metN === meetable.length ? `You've met all ${metN}` : `You've met ${metN} of ${meetable.length}`}${adopted ? ` and adopted ${adopted}` : ''}. `
    + 'Tap one to invite it to your next block.';
  $('#catgrid').replaceChildren(...K.CATS.filter((c) => !c.limited || E.owns(D.doc, c.id) || E.forSale(c.id, now())).map((c) => {
    const known = met.includes(c);
    const card = el('button', `catcard${known ? '' : ' locked'}${c === mine ? ' on' : ''}`);
    card.dataset.cat = c.id;
    const how = c.adopt ? `Adopt in the shop · ${fish(E.SHOP[c.id])}` : `🔒 ${c.how}`;
    card.append(known ? catArt(c, c === mine ? 'cheer' : 'sit') : portrait(c, 'sit'), el('b', null, known ? c.name : c.adopt ? c.name : '???'), el('span', null, known ? c.about : how));
    if (c === mine) { const p = el('span', 'pick'); p.append(icon('check')); card.append(p); }
    return card;
  }));
}

// The shop: what treats buy. Bought things show up in the café; adopted cats can be invited.
function drawShop() {
  const left = treatsLeft();
  const card = (id, art, name, about) => {
    const owned = E.owns(D.doc, id);
    const price = E.SHOP[id];
    const c = el('button', `shopcard${owned ? ' owned' : price > left ? ' dear' : ''}`);
    c.type = 'button';
    c.dataset.buy = id;
    const tag = el('span', 'price', owned ? 'In your café' : fish(price));
    if (owned) tag.prepend(icon('check'));
    c.append(art, el('b', null, name), el('span', 'about', about), tag);
    return c;
  };
  // Limited things: their own section while their event is on, then only if you got them.
  const t = now();
  const ev = E.season(t);
  const soon = !ev && E.soon(t);
  const regular = (x) => !x.limited || (E.owns(D.doc, x.id) && !E.forSale(x.id, t));
  const byPrice = (a, b) => E.SHOP[a.id] - E.SHOP[b.id];
  $('#shop-items').replaceChildren(...K.ITEMS.filter(regular).sort(byPrice).map((x) => card(x.id, thing(x), x.name, x.about)));
  $('#shop-cats').replaceChildren(...K.CATS.filter((c) => c.adopt && regular(c)).sort(byPrice).map((c) => card(c.id, portrait(c, 'sit'), c.name, c.about)));
  $('#shop-themes').replaceChildren(...K.THEMES.filter((x) => x.id !== 'classic').map((x) => {
    const c = card(`theme-${x.id}`, themeSwatch(x.id), x.name, x.about);
    if (E.owns(D.doc, `theme-${x.id}`)) c.querySelector('.price').lastChild.textContent = state.settings.theme === x.id ? 'In use' : 'Yours';
    return c;
  }));
  $('#shop-sounds').replaceChildren(...Sound.KINDS.filter((k) => !k.free).map((k) => {
    const art = el('span', 'soundart'); art.append(icon('sound'));
    const c = card(`sound-${k.id}`, art, k.name, k.about);
    if (E.owns(D.doc, `sound-${k.id}`)) c.querySelector('.price').lastChild.textContent = 'In Sounds';
    return c;
  }));
  const box = $('#shop-event');
  if (ev) {
    const cats = K.CATS.filter((c) => c.limited === ev.id).sort(byPrice).map((c) => card(c.id, portrait(c, 'sit'), c.name, c.about));
    const things = K.ITEMS.filter((x) => x.limited === ev.id).sort(byPrice).map((x) => card(x.id, thing(x), x.name, x.about));
    const grid = el('div', 'shopgrid eventgrid');
    grid.append(...cats, ...things);
    box.replaceChildren(el('p', 'ghead', `${EVENT_ICON[ev.id] || ''} ${ev.name} · until ${eventEnd(ev, t)}`.trim()), grid,
      el('p', 'gfoot', 'Only for a week. What you get, you keep.'));
  } else if (soon) {
    const c = el('div', 'callout eventcall');
    c.append(el('span', 'eventicon', EVENT_ICON[soon.id] || '✨'), el('span', 'grow', `${soon.name} starts in ${soon.days === 1 ? '1 day' : `${soon.days} days`}: ${EVENT_TEASE[soon.id] || 'new things for your café'}, for one week only.`));
    box.replaceChildren(c);
  } else box.replaceChildren();
}
const EVENT_ICON = { halloween: '🎃', winter: '❄️' };
const EVENT_TEASE = { halloween: 'a pumpkin cat and spooky things for your café', winter: 'Flurry the winter cat, a fireplace, a snowman and more for your café' };
const eventEnd = (ev, t) => new Date(new Date(t).getFullYear(), ev.to[0] - 1, ev.to[1]).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

// Missions: today's three and this week's one.
function missionRow(m) {
  const row = el('div', `row mission${m.done ? ' done' : ''}`);
  const tile = el('span', `tile ${m.done ? 't-green' : 't-orange'}`);
  tile.append(icon(m.done ? 'check' : 'target'));
  const mid = el('span', 'grow');
  const bar = el('span', 'mbar');
  const fill = el('i');
  fill.style.width = `${Math.round((100 * m.have) / m.need)}%`;
  bar.append(fill);
  mid.append(el('b', null, m.text), el('span', 'sub', m.done ? 'Done' : m.unit === 'min' ? `${fmtMin(m.have)} of ${fmtMin(m.need)}` : `${m.have} of ${m.need}`), bar);
  row.append(tile, mid, el('span', 'pay', fish(`+${m.pay}`)));
  return row;
}
function drawMissions() {
  const t0 = now();
  // The starter challenge, until it's done and collected.
  const st = E.starter(D.doc);
  $('#starter-box').hidden = st.finished;
  if (!st.finished) {
    const rows = st.steps.map((x) => stepRow(x, `Starter step: ${x.text}`));
    rows.push(stepRow({ ...st.all, text: 'Do all seven', have: st.steps.filter((x) => x.done).length, goal: st.steps.length }, 'Starter Challenge done'));
    $('#starter-steps').replaceChildren(...rows);
    $('#starter-foot').textContent = `Seven first steps, ${fish(E.STARTER_PAY)} each, and ${fish(E.STARTER_ALL)} more for all of them.`;
  }
  // This month's challenge, and last month's if it was done and not collected yet.
  const mo = E.monthly(D.doc, t0);
  const last = E.monthly(D.doc, new Date(new Date(t0).getFullYear(), new Date(t0).getMonth() - 1, 15).getTime());
  const monthName = (m) => new Date(m.from).toLocaleDateString(undefined, { month: 'long' });
  const mrow = (m) => stepRow({ id: m.id, text: `Bring kittens home on ${m.need} days in ${monthName(m)}`, have: m.have, goal: m.need, done: m.done, claimed: m.claimed, reward: m.reward }, `${monthName(m)} Focus Challenge done`);
  $('#monthly-head').textContent = `${monthName(mo)} Focus Challenge`;
  $('#monthly').replaceChildren(...[...(last.done && !last.claimed ? [mrow(last)] : []), mrow(mo)]);
  const daysLeft = Math.ceil((mo.to - t0) / 86400000);
  $('#monthly-foot').textContent = mo.done ? 'Done for this month.' : `${daysLeft === 1 ? 'Last day' : `${daysLeft} days left`}. A new challenge every month.`;
  // Achievements: ready to collect first, then in progress, then collected.
  const ach = E.achievements(D.doc);
  const order = (a) => (a.done && !a.claimed ? 0 : !a.done ? 1 : 2);
  $('#achievements').replaceChildren(...ach.slice().sort((a, b) => order(a) - order(b)).map(achCard));
  $('#ach-count').textContent = `${ach.filter((a) => a.done).length} of ${ach.length}`;
  const ms = E.missions(D.doc, t0);
  $('#missions-day').replaceChildren(...ms.day.map(missionRow));
  $('#missions-week').replaceChildren(...ms.week.map(missionRow));
  $('#missions-day').classList.toggle('closed', ms.dayClosed);
  $('#missions-week').classList.toggle('closed', ms.weekClosed);
  const hours = Math.max(1, Math.round((ms.dayEnds - now()) / 3600000));
  $('#missions-day-foot').textContent = ms.dayClosed ? "You cleared your history today, so today's missions are closed. New ones come at midnight."
    : `New missions in ${hours === 1 ? 'an hour' : `${hours} hours`}.`;
  const days = Math.round((ms.weekEnds - new Date(now()).setHours(0, 0, 0, 0)) / 86400000);
  $('#missions-week-foot').textContent = ms.weekClosed ? "You cleared your history this week, so this week's mission is closed. A new one comes on Sunday."
    : days <= 1 ? 'A new one tomorrow, on Sunday.' : `A new one in ${days} days, on Sunday.`;
}
// A mission just got done: say so once.
function checkMissions() {
  const ms = E.missions(D.doc, now());
  const done = [...ms.day.filter((m) => m.done).map((m) => [`d${ms.dayEnds}:${m.id}`, m]), ...ms.week.filter((m) => m.done).map((m) => [`w${ms.weekEnds}:${m.id}`, m])];
  const first = !missionsSeen;
  if (first) missionsSeen = new Set();
  const fresh = done.filter(([k]) => !missionsSeen.has(k));
  for (const [k] of fresh) missionsSeen.add(k);
  if (first || !fresh.length || !catsOn()) return;
  const m = fresh[fresh.length - 1][1];
  D.track('mission', { id: m.id });
  setTimeout(() => { toast(`Mission done: ${m.text}. ${fish(`+${m.pay}`)}`); chime(true); }, state && state.awaiting ? 1600 : 0);
}

function renderTags() {
  show('tags');
  const tags = state.settings.tags;
  $('#tag-list').replaceChildren(...(tags.length ? tags.map((t) => {
    const row = el('div', 'row');
    const dot = el('i', 'dot big'); dot.style.background = tagColor(t);
    const rm = el('button', 'minus'); rm.type = 'button'; rm.dataset.untag = t; rm.setAttribute('aria-label', `Remove ${t}`); rm.append(icon('minus'));
    row.append(rm, dot, el('span', 'grow', t));
    return row;
  }) : [el('div', 'row sub', 'No tags. Add one below.')]));
  $('#tag-add').hidden = tags.length >= 12;
}

function renderSettings() {
  show('settings');
  const s = state.settings;
  $('#interval').value = String(s.interval);
  $('#goal-select').value = String(s.goal || 0);
  $('#cat-on').checked = s.cat !== false;
  $('#companion-name').textContent = catsOn() ? companion().name : 'Off';
  $('#tags-value').textContent = String(s.tags.length);
  $('#pause-select').value = s.pause === 'off' ? 'off' : 'five';
  $('#overtime').checked = Boolean(s.overtime);
  $('#close-counts').checked = s.closeCounts !== false;
  $('#ext-row').hidden = platform !== 'desktop' && !extOn; // the extension is for Chrome and Firefox on a computer
  $('#ext-value').textContent = extOn ? 'On' : '';
  $('#lines-value').textContent = (s.lines || []).length ? String(s.lines.length) : 'None';
  $('#theme-value').textContent = (K.THEMES.find((x) => x.id === (s.theme || 'classic')) || K.THEMES[0]).name;
  $('#chime').checked = pref('chime') !== '0';
  $('#counting').checked = D.counting();
  const d = s.daily;
  $('#daily-on').checked = d.on;
  $('#daily-opts').hidden = !d.on;
  if (document.activeElement !== $('#daily-time')) $('#daily-time').value = d.time;
  for (const c of $$('#daily-days button')) c.classList.toggle('on', d.days.includes(Number(c.dataset.day)));

  let on = false;
  const status = $('#push-status');
  if (!pushSupported) status.textContent = TEXT.unsupported;
  else if (mySub) { status.textContent = 'Reminders are on'; on = true; }
  else if (Notification.permission === 'denied') status.textContent = TEXT.denied;
  else status.textContent = 'Reminders are off';
  $('#push-on').hidden = !pushSupported || on || Notification.permission === 'denied';
  $('#push-test').hidden = !on;

  const av = $('#acct-avatar');
  if (D.account) {
    const name = D.account.display || D.account.name;
    av.replaceWith(Object.assign(avatar(name), { id: 'acct-avatar' }));
    $('#acct-title').textContent = name;
    $('#acct-sub').textContent = D.syncTrouble ? 'Not syncing: too big for the server' : 'Backed up · syncs with your other devices';
  } else {
    if (!av.querySelector('svg')) { const a = el('span', 'avatar'); a.id = 'acct-avatar'; a.append(icon('person')); av.replaceWith(a); }
    $('#acct-title').textContent = 'Sign In';
    $('#acct-sub').textContent = 'Back up your history and focus with friends';
  }
  $('#admin-link').hidden = !(D.account && D.account.admin);
  $('#friends-value').textContent = !D.account ? 'Needs an account' : s.share === 'off' ? 'Off' : friends ? `${friends.friends.length}` : '';
  if (D.account) loadFriends().then(() => { if (route === 'settings' && friends) $('#friends-value').textContent = s.share === 'off' ? 'Off' : `${friends.friends.length}`; });
}

function renderFriends() {
  show('friends');
  $('#friends-anon').hidden = Boolean(D.account);
  $('#friends-in').hidden = !D.account;
  if (!D.account) return;
  const s = state.settings;
  $('#share').value = s.share;
  $('#share-opts').hidden = s.share === 'off';
  if (document.activeElement !== $('#share-name')) $('#share-name').value = s.name || '';
  $('#share-name').placeholder = D.account.name.charAt(0).toUpperCase() + D.account.name.slice(1);
  $('#friend-pings').checked = s.friendPings !== false;
  drawFriendsSettings();
  loadFriends().then(() => { if (route === 'friends') drawFriendsSettings(); });
}

function drawFriendsSettings() {
  $('#my-code').textContent = friends ? friends.code : '······';
  const list = friends ? friends.friends : [];
  $('#friends-settings').replaceChildren(...(list.length ? list.map((x) => {
    const row = el('div', 'row friend');
    const who = el('span', 'grow');
    who.append(el('b', null, x.display), el('span', 'sub', friendLine(x)));
    const rm = el('button', 'btn plain small', 'Remove'); rm.dataset.unfriend = x.name;
    row.append(avatar(x.display, x.status), who, rm);
    return row;
  }) : [el('div', 'row sub', 'No friends yet. Send someone your code.')]));
}

function renderAccount() {
  show('account');
  $('#account-out').hidden = Boolean(D.account);
  $('#account-in').hidden = !D.account;
  if (D.account) {
    const name = D.account.display || D.account.name;
    $('#account-title').textContent = 'Account';
    $('#who').textContent = name;
    $('#who-sub').textContent = D.syncTrouble
      ? "This device's history is too big for the server, so it isn't syncing. It's all still here on this device."
      : 'Your history is backed up and syncs.';
    const av = avatar(name); av.classList.add('big'); av.id = 'acct-avatar2';
    $('#acct-avatar2').replaceWith(av);
    return;
  }
  $('#account-title').textContent = accountTab === 'signup' ? 'Create Account' : 'Sign In';
  for (const c of $$('#account-tabs button')) c.classList.toggle('on', c.dataset.tabAcct === accountTab);
  const signup = accountTab === 'signup';
  $('#account-why').textContent = signup
    ? 'Your history in this browser comes with you. Pick a name your friends will recognize, and a password of at least 8 characters.'
    : 'Signing in brings your history here, and anything you did in this browser comes along.';
  $('#account-go').textContent = signup ? 'Create Account' : 'Sign In';
  $('#account-form').password.autocomplete = signup ? 'new-password' : 'current-password';
}

// The admin's usage dashboard: counts only.
async function renderAdmin() {
  show('admin');
  const body = $('#admin-body');
  if (!D.account || !D.account.admin) { body.replaceChildren(el('p', 'lede', 'This page is only for the admin.')); return; }
  let a;
  try { a = await D.api('GET', 'api/admin/analytics'); } catch { body.replaceChildren(el('p', 'lede', "Couldn't load the numbers.")); return; }
  if (route !== 'admin') return;
  const days = a.days;
  const sum = (key, n) => days.slice(-n).reduce((t, d) => t + (d.c[key] || 0), 0);
  const keys = (prefix) => [...new Set(days.flatMap((d) => Object.keys(d.c)).filter((k) => k.startsWith(prefix)))];
  const card = (title, ...kids) => { const c = el('div', 'dash-card'); c.append(el('h3', null, title), ...kids); return c; };
  const tiles = (rows) => { const t = el('div', 'tiles'); for (const [big, small] of rows) { const x = el('div'); x.append(el('b', null, String(big)), el('span', null, small)); t.append(x); } return t; };
  const last30 = days.slice(-30);
  const bars = (vals, label) => {
    const svg = document.createElementNS(SVGNS, 'svg');
    svg.setAttribute('viewBox', '0 0 300 120');
    svg.setAttribute('class', 'bars');
    svg.setAttribute('preserveAspectRatio', 'none');
    const max = Math.max(1, ...vals);
    const w = 300 / Math.max(1, vals.length);
    vals.forEach((v, i) => {
      const r = document.createElementNS(SVGNS, 'rect');
      const h = (100 * v) / max;
      r.setAttribute('x', String(i * w + 1)); r.setAttribute('width', String(Math.max(1, w - 2)));
      r.setAttribute('y', String(104 - h)); r.setAttribute('height', String(Math.max(v ? 2 : 0, h)));
      r.setAttribute('rx', '2');
      if (!v) r.setAttribute('class', 'low');
      const tt = document.createElementNS(SVGNS, 'title'); tt.textContent = `${last30[i].date}: ${v}`; r.append(tt);
      svg.append(r);
    });
    const tx = document.createElementNS(SVGNS, 'text'); tx.setAttribute('x', '0'); tx.setAttribute('y', '118'); tx.textContent = `max ${max} ${label}`; svg.append(tx);
    return svg;
  };
  const table = (rows) => {
    const t = el('table', 't');
    const head = el('tr'); head.append(el('th', null, ''), el('th', 'n', '7 days'), el('th', 'n', '30 days')); t.append(head);
    for (const [label, key] of rows) { const tr = el('tr'); tr.append(el('td', null, label), el('td', 'n', String(sum(key, 7))), el('td', 'n', String(sum(key, 30)))); t.append(tr); }
    return t;
  };
  const split = (title, prefix, labels = {}) => {
    const ks = keys(prefix).sort((x, y) => sum(y, 30) - sum(x, 30));
    return card(title, ks.length ? table(ks.map((k) => [labels[k.slice(prefix.length)] || k.slice(prefix.length), k])) : el('p', 'sub', 'Nothing yet.'));
  };
  const splits = el('div', 'split');
  splits.append(
    split('Where people open it', 'open.plat=', { 'ios-app': 'iPad/iPhone app', 'ios-safari': 'iPad/iPhone Safari', 'android-app': 'Android app', android: 'Android browser', desktop: 'Computer' }),
    split('With an account?', 'open.mode=', { anon: 'No account', account: 'Account' }),
    split('Block lengths', 'start.len='),
    split('Check-in style', 'start.style=', { ask: 'Ask me', nudge: 'Nudge me' }),
    split('How it went', 'end.outcome=', { done: 'Done', partly: 'Partly', notreally: 'Not really', skip: 'Skipped' }),
    split('What pulled people away', 'why.why=', WHY_LABEL),
    split('Kittens invited', 'start.cat='),
    split('Café views', 'cafe.span=', { day: 'Day', week: 'Week', month: 'Month', year: 'Year' }),
    split('What people buy', 'buy.item='),
    split('Who gets adopted', 'adopt.item='),
    split('Sounds', 'sound.kind='),
  );
  body.replaceChildren(
    tiles([
      [a.month.installs, 'browsers, 30 days'], [a.month.returning, 'came back another day'],
      [a.totals.accounts, 'accounts'], [a.totals.devices, 'devices with reminders'], [a.totals.sharing, 'sharing with friends'],
    ]),
    card('Browsers per day', bars(last30.map((d) => d.installs), 'browsers')),
    card('Blocks started per day', bars(last30.map((d) => d.c.start || 0), 'blocks')),
    card('Minutes focused per day', bars(last30.map((d) => d.c['end.min'] || 0), 'min')),
    card('What gets used', table([
      ['App opened', 'open'], ['Blocks started', 'start'], ['Blocks logged', 'end'], ['Stopped early', 'stop'], ['Kept going (+min)', 'extend'],
      ['Check-ins answered', 'checkin'], ['Said why they drifted', 'why'], ['Paused', 'pause'], ['Parked a thought', 'park'],
      ['Added to Later', 'later_add'], ['Breaks', 'break_start'], ['Breathing', 'breathe'], ['Sound turned on', 'sound'],
      ['Disk timer', 'face'], ['Screen kept on', 'awake'], ['Met a new cat', 'cat_met'], ['Picked the next kitten', 'companion'],
      ['Kitten wandered off (left the app)', 'away'], ['Opened the café', 'cafe'], ['Opened the shop', 'shop'], ['Bought something', 'buy'],
      ['Adopted a cat', 'adopt'], ['Blocks with a tag', 'start.tag=1'], ['Changed tags', 'tags'],
      ['Stopwatch blocks', 'start.len=stopwatch'], ['Cancelled in the first 10 s', 'cancel'], ['Collected a reward', 'claim'],
      ['Looked at the rankings', 'rankings'], ['Joined the rankings', 'rank.on=1'], ['Sponsored a shelter cat', 'sponsor'],
      ['Changed the café theme', 'theme'], ['Read the news', 'news'], ['Opened or joined a nap room', 'room'], ['Edited a block', 'edit'],
      ['Wrote a note', 'note'], ['Shared the café', 'share_cafe'], ['A mindful minute (done)', 'mindful'],
      ['Turned on reminders', 'push_on'], ['Said no to reminders', 'push_denied'],
      ['Made an account', 'signup'], ['Signed in', 'login'], ['Added a friend', 'friend_add'], ['Joined a friend', 'join'],
      ['Pings sent: check-ins', 'push.checkin'], ['Pings sent: nudges', 'push.nudge'], ['Pings sent: ends', 'push.end'],
      ['Pings sent: friends', 'push.friend'], ['Pings sent: daily', 'push.daily'], ['Turned counting off', 'analytics_off'],
    ])),
    splits,
  );
}

// ---------- push ----------
function keyBytes(b64u) {
  const s = atob(b64u.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((b64u.length + 3) % 4));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
}
const withTimeout = (p, ms) => Promise.race([p, new Promise((_, no) => setTimeout(() => no(new Error('timeout')), ms))]);

async function findSub() {
  if (!pushSupported) return;
  try {
    const reg = await navigator.serviceWorker.register('sw.js');
    swReg = reg;
    mySub = await reg.pushManager.getSubscription();
  } catch { mySub = null; }
}

async function vapidKey() {
  let k = pref('vapid');
  if (!k) { k = (await D.api('GET', 'api/config')).vapidKey; pref('vapid', k); }
  return k;
}

async function turnOnReminders() {
  const err = $('#v-remind .err');
  err.hidden = true;
  const btn = $('#remind-on');
  // iOS only shows the permission prompt if this runs straight from the tap, so ask first.
  let perm;
  try { perm = await Notification.requestPermission(); } catch { perm = Notification.permission; }
  if (perm !== 'granted') {
    D.track('push_denied');
    err.textContent = perm === 'denied' ? TEXT.denied : 'Kavana needs your OK to send reminders. Tap the button and choose Allow.';
    err.hidden = false;
    return;
  }
  btn.disabled = true;
  try {
    const reg = await withTimeout(navigator.serviceWorker.ready, 10000);
    mySub = (await reg.pushManager.getSubscription())
      || (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(await vapidKey()) }));
    await D.registerDevice(mySub);
    remember('remind');
    D.track('push_on');
    go('focus');
    toast('Reminders are on.');
  } catch {
    err.textContent = "Couldn't turn on reminders. Check your connection and try again.";
    err.hidden = false;
  } finally {
    btn.disabled = false;
  }
}

// ---------- events ----------
document.addEventListener('click', (e) => {
  const t = e.target.closest('[data-tab]');
  if (t) { e.preventDefault(); go(t.dataset.tab); return; }
  const b = e.target.closest('[data-go]');
  if (b) { e.preventDefault(); go(b.dataset.go); return; }
  const a = e.target.closest('[data-account]');
  if (a) { accountTab = a.dataset.account; go('account'); }
});

$('#welcome-start').addEventListener('click', () => {
  remember('welcomed');
  D.track('welcome', { choice: 'start' });
  go(pushSupported && !mySub ? 'remind' : 'focus');
});
$('#welcome-signin').addEventListener('click', () => {
  remember('welcomed');
  D.track('welcome', { choice: 'signin' });
  accountTab = 'login';
  go('account');
});
$('#install-no').addEventListener('click', () => { remember('installNo'); render(); });
$('#menu-btn').addEventListener('click', (e) => { menuOpen = !menuOpen; drawMenu(); if (menuOpen && !e.detail) $('#sidebar').querySelector('.sb-item.on, .sb-item').focus({ preventScroll: true }); });
$('#menu-scrim').addEventListener('click', () => { menuOpen = false; drawMenu(); });
// The clock and the tag open the sheet with everything else about the block.
for (const id of ['#home-clock', '#home-tag']) $(id).addEventListener('click', () => { optionsOpen = true; renderHome(); });
$('#options-done').addEventListener('click', () => { optionsOpen = false; renderHome(); });
$('#options').addEventListener('click', (e) => { if (e.target === e.currentTarget) { optionsOpen = false; renderHome(); } });
$('#start').custom.addEventListener('input', () => { if (route === 'focus' && !state.active) renderHome(); });
// Drag around the window to set how long, like Forest's old ring: 5 to 120 minutes, in fives.
// A tap on the cat (no drag) picks who's coming.
{
  const win = $('#home-window');
  let drag = null;
  const fromPointer = (e) => {
    const r = win.getBoundingClientRect();
    let a = Math.atan2(e.clientX - (r.left + r.width / 2), -(e.clientY - (r.top + r.height / 2)));
    if (a < 0) a += Math.PI * 2;
    const m = Math.max(5, Math.min(120, Math.round((a / (Math.PI * 2)) * 24) * 5 || 120));
    if (m !== minutes || !$('#custom-wrap').hidden) { minutes = m; $('#custom-wrap').hidden = true; renderHome(); }
  };
  const onRing = (e) => { const r = win.getBoundingClientRect(); const d = Math.hypot(e.clientX - (r.left + r.width / 2), e.clientY - (r.top + r.height / 2)); return d > r.width * 0.36; };
  win.addEventListener('pointerdown', (e) => {
    if (win.classList.contains('fixed')) return;
    drag = { x: e.clientX, y: e.clientY, ring: onRing(e), moved: false, id: e.pointerId };
    if (drag.ring) { try { win.setPointerCapture(e.pointerId); } catch {} fromPointer(e); }
  });
  win.addEventListener('pointermove', (e) => {
    if (!drag) return;
    if (!drag.moved && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) > 8) { drag.moved = true; if (!drag.ring) { drag.ring = true; try { win.setPointerCapture(drag.id); } catch {} } }
    if (drag.ring) fromPointer(e);
  });
  const end = (e) => {
    const d = drag; drag = null;
    if (!d || e.type !== 'pointerup') return;
    if (!d.ring && !d.moved && catsOn()) { inviting = true; render(); } // a tap on the cat
  };
  win.addEventListener('pointerup', end);
  win.addEventListener('pointercancel', end);
  win.addEventListener('click', () => { if (win.classList.contains('fixed') && catsOn() && !join) { inviting = true; render(); } });
  win.addEventListener('keydown', (e) => { // the arrow keys change it by five minutes
    if (win.classList.contains('fixed')) return;
    const by = e.key === 'ArrowRight' || e.key === 'ArrowUp' ? 5 : e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? -5 : 0;
    if (!by) return;
    e.preventDefault();
    minutes = Math.max(5, Math.min(120, homeMinutes() + by)); $('#custom-wrap').hidden = true; renderHome();
  });
}
$('#live').addEventListener('click', () => go('focus'));

// account
$('#account-tabs').addEventListener('click', (e) => {
  const c = e.target.closest('[data-tab-acct]');
  if (!c) return;
  accountTab = c.dataset.tabAcct;
  $('#v-account .err').hidden = true;
  renderAccount();
});
$('#account-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  const err = $('#v-account .err');
  err.hidden = true;
  const kind = accountTab;
  try {
    await D.signIn(kind, f.name.value, f.password.value);
    f.password.value = '';
    remember('welcomed');
    D.track(kind === 'signup' ? 'signup' : 'login');
    if (mySub) D.registerDevice(mySub).catch(() => {});
    friends = null;
    go(pushSupported && !mySub ? 'remind' : 'settings');
    toast(kind === 'signup' ? 'Account made. Your history is backed up.' : 'Signed in. Your history is here.');
  } catch (ex) {
    const why = ex.data && ex.data.error;
    err.textContent = ex.status === 401 ? "That name and password don't match."
      : ex.status === 429 ? 'Too many tries. Wait a while, then try again.'
      : why === 'taken' ? 'That name is taken. Try another one.'
      : why === 'name' ? 'Names are 2 to 24 letters or digits (dots, dashes and underscores are OK too).'
      : why === 'password' ? 'Pick a password of at least 8 characters.'
      : "Can't reach Kavana. Check your connection and try again.";
    err.hidden = false;
  }
});
$('#pw-show').addEventListener('click', () => {
  const i = $('#account-form').password;
  i.type = i.type === 'password' ? 'text' : 'password';
  $('#pw-show').textContent = i.type === 'password' ? 'Show' : 'Hide';
});
$('#signout').addEventListener('click', async () => {
  if (!(await confirmIt('Sign Out?', 'Your history is safe in your account, and it leaves this browser.', 'Sign Out'))) return;
  D.track('logout');
  await D.signOut();
  friends = null;
  go('focus');
  toast('Signed out.');
});
$('#delete-account').addEventListener('click', async () => {
  const r = await ask({
    title: 'Delete Your Account?', message: "This deletes everything of yours on the server. Your history stays in this browser. Type your password to go ahead.",
    input: 'Password', actions: [{ label: 'Cancel', cancel: true }, { label: 'Delete', main: true, danger: true }],
  });
  if (r.i !== 1 || !r.value) return;
  try {
    await D.deleteAccount(r.value);
    D.track('account_delete');
    friends = null;
    go('focus');
    toast('Account deleted.');
  } catch (ex) { toast(ex.status === 401 ? "That password doesn't match." : "Couldn't delete it. Check your connection."); }
});

$('#remind-on').addEventListener('click', turnOnReminders);
$('#remind-later').addEventListener('click', () => { remember('remind'); go('focus'); });

// start screen
$('#recent').addEventListener('click', (e) => {
  const c = e.target.closest('[data-recent]');
  if (c) $('#start').intention.value = c.dataset.recent;
});
$('#lengths').addEventListener('click', (e) => {
  const chip = e.target.closest('button');
  if (!chip) return;
  const custom = chip.dataset.min === 'custom';
  $('#custom-wrap').hidden = !custom;
  if (!custom) minutes = Number(chip.dataset.min);
  renderHome();
});
$('#custom-wrap').addEventListener('click', (e) => {
  const b = e.target.closest('[data-step]');
  if (!b) return;
  const i = $('#start').custom;
  i.value = String(Math.max(1, Math.min(240, (Number(i.value) || 0) + Number(b.dataset.step))));
});
$('#styles').addEventListener('click', (e) => {
  const chip = e.target.closest('button');
  if (!chip) return;
  style = chip.dataset.style;
  renderHome();
});
$('#start').addEventListener('submit', (e) => {
  e.preventDefault();
  const f = e.target;
  const custom = !$('#custom-wrap').hidden;
  const m = join ? 'timer' : currentMode();
  const len = join || m === 'stopwatch' ? 0 : custom ? Math.round(Number(f.custom.value)) : minutes;
  if (!join && m === 'timer' && !(len >= 1 && len <= 240)) { toast('Pick between 1 and 240 minutes.'); return; }
  if (!f.intention.value.trim()) { toast("Type what you're working on first."); f.intention.focus(); return; }
  const extras = startExtras();
  const s = style || state.settings.style;
  const later = fromLater && (state.later.find((x) => x.id === fromLater) || {}).text === f.intention.value.trim() ? fromLater : undefined;
  const joining = join;
  const invited = catsOn() ? companion().id : null;
  const ok = act((doc, t) => E.start(doc, {
    intention: f.intention.value, step: f.step.value, minutes: len, style: s, fromLater: later,
    withEnd: joining ? joining.end : undefined, withName: joining ? joining.name : undefined,
    cat: invited, tag: currentTag(), mode: m,
  }, t), "Couldn't start that.");
  if (!ok) return;
  pref('left', null);
  D.track('start', { len: joining ? 'join' : m === 'stopwatch' ? 'stopwatch' : custom ? 'custom' : String(len), style: s, step: f.step.value.trim() ? 1 : 0, later: later ? 1 : 0, tag: currentTag() ? 1 : 0, cat: invited || 'none' });
  if (joining) D.track(joining.code ? 'room' : 'join');
  style = null; fromLater = null; join = null; pickTag = null; mode = null; optionsOpen = false;
  diveFor = (E.running(D.doc) || {}).id || null;
  f.intention.value = ''; f.step.value = '';
  f.intention.blur();
  extras();
  render();
  if (joining && joining.nap && invited && D.account) joinNap(joining);
});
$('#join-cancel').addEventListener('click', () => { join = null; renderHome(); });
$('#modes').addEventListener('click', (e) => {
  const b = e.target.closest('[data-mode]');
  if (!b) return;
  mode = b.dataset.mode;
  renderHome();
});
$('#news-no').addEventListener('click', () => { const n = unreadNews(); if (n.length) pref('newsNo', n[0].id); renderHome(); });
// Nap rooms: join with a code (or a link with #room=CODE), or start one from a running block.
async function joinByCode(code) {
  if (!D.account) { accountTab = 'signup'; go('account'); toast('Nap rooms need an account.'); return; }
  code = String(code || '').toUpperCase().replace(/[^A-Z]/g, '');
  if (code.length !== 6) { toast('A room code is 6 letters.'); return; }
  let r;
  try { r = await D.api('GET', `api/nap/room?code=${code}`); } catch (ex) {
    const why = ex.data && ex.data.error;
    toast(why === 'code' ? "That code doesn't match a room." : why === 'ended' ? 'That nap is almost over.' : why === 'broken' ? 'Someone in that nap left already.' : "Couldn't find that room. Check your connection.");
    return;
  }
  if (r.full) { toast('That room is full.'); return; }
  join = { name: r.host, end: r.end, nap: r.id, code };
  go('focus');
  window.scrollTo({ top: 0, behavior: 'smooth' });
  $('#start').intention.focus();
  toast("Type what you'll work on, then Start. You'll finish together.");
}
$('#join-code').addEventListener('click', async () => {
  const r = await ask({ title: 'Join a Nap Room', message: 'Type the 6-letter code you got.', input: 'ABCDEF', type: 'text', actions: [{ label: 'Cancel', cancel: true }, { label: 'Join', main: true }] });
  if (r.i === 1) joinByCode(r.value);
});
$('#t-room').addEventListener('click', async () => {
  const a = state.active;
  if (!a) return;
  if (nap && nap.block === a.id && nap.code) { roomOpen = true; render(); return; }
  try {
    await D.flushSync(); // the server has to know about the block first
    const g = await D.api('POST', 'api/nap/room', { block: a.id });
    nap = { ...g, block: a.id };
    roomOpen = true;
    D.track('room', { made: 1 });
    render();
  } catch { toast("Couldn't open a room. Check your connection."); }
});
$('#room-done').addEventListener('click', () => { roomOpen = false; render(); });
$('#room-sheet').addEventListener('click', (e) => { if (e.target === e.currentTarget) { roomOpen = false; render(); } });
$('#room-share').addEventListener('click', async () => {
  const code = nap && nap.code;
  if (!code) return;
  const url = `${location.origin}${location.pathname}#room=${code}`;
  const text = `Nap with me in Kavana: our kittens grow together. Room code ${code}`;
  try {
    if (navigator.share) await navigator.share({ title: 'Kavana nap room', text, url });
    else { await navigator.clipboard.writeText(`${text}\n${url}`); toast('Copied. Send it to someone.'); }
  } catch {}
});
$('#tags').addEventListener('click', (e) => {
  const c = e.target.closest('[data-tag]');
  if (!c) return;
  pickTag = currentTag() === c.dataset.tag ? '' : c.dataset.tag;
  drawTagChips();
});
$('#invite').addEventListener('click', () => { inviting = true; render(); });
$('#invite-done').addEventListener('click', () => { inviting = false; render(); });
$('#invite-sheet').addEventListener('click', (e) => {
  if (e.target === e.currentTarget) { inviting = false; render(); return; }
  const b = e.target.closest('[data-invite]');
  if (!b) return;
  inviting = false;
  if (b.dataset.invite !== companion().id) { act((doc, t) => E.setSettings(doc, { companion: b.dataset.invite }, t)); D.track('companion', { cat: b.dataset.invite }); }
  else render();
});
$('#friends-list').addEventListener('click', (e) => {
  const b = e.target.closest('[data-join]');
  if (!b || !friends) return;
  const f = friends.friends.find((x) => x.name === b.dataset.join);
  if (!f) return;
  join = { name: f.display, end: f.end, nap: f.nap || null };
  renderHome();
  window.scrollTo({ top: 0, behavior: 'smooth' });
  $('#start').intention.focus();
  toast(join.nap && catsOn() ? "Type what you'll work on, then Start. Your kittens nap together." : "Type what you'll work on, then Start. You'll finish together.");
});

$('#break-banner').addEventListener('click', (e) => {
  const b = e.target.closest('[data-break]');
  if (!b) return;
  if (act((doc, t) => E.startBreak(doc, Number(b.dataset.break), t))) D.track('break_start', { min: Number(b.dataset.break) });
});
$('#break-no').addEventListener('click', () => { breakDismissed = state.breakOffer && state.breakOffer.id; render(); });
$('#break-end').addEventListener('click', () => { if (act((doc, t) => E.stopBreak(doc, t))) D.track('break_end'); });

// running block
async function stopBlock() {
  const a = state.active;
  if (!a) return;
  // The first 10 seconds: take it back, nothing counts, nobody wanders off.
  if (!a.nap && now() < a.cancelUntil) {
    parkOpen = false;
    if (act((doc, t) => E.cancel(doc, t), 'Too late to cancel. Use Stop.')) { Sound.stop(); D.track('cancel'); toast('Cancelled. Nothing counted.'); }
    return;
  }
  const name = K.byId(a.cat).name;
  const spent = a.total - (a.end - (a.paused || now()));
  let title = 'Stop This Block?', message = `${catsOn() && a.kitten === 'growing' ? `${name} will wander off. ` : ''}You can still say how it went.`, yes = 'Stop', danger = true;
  if (a.mode === 'stopwatch') {
    const enough = spent >= 10 * 60000;
    title = 'Done?';
    message = !catsOn() ? 'You can still say how it went.' : enough ? `${name} comes home with you.` : `${name} needs 10 minutes to come home. Stop now and it wanders off.`;
    yes = 'Done'; danger = !enough && catsOn();
  } else if (a.over) { title = 'Done?'; message = 'Your extra time counts too.'; yes = 'Done'; danger = false; }
  if (!(await confirmIt(title, message, yes, danger))) return;
  parkOpen = false;
  const started = state.active.start;
  if (act((doc, t) => E.stop(doc, t))) D.track('stop', { min: Math.round((now() - started) / 60000), mode: a.mode });
}
$('#stop').addEventListener('click', stopBlock);
function togglePause() {
  if (!state.active) return;
  if (state.active.nap && !state.active.paused) { toast('No pausing while you nap together.'); return; }
  if (!state.active.paused && !E.canPause(D.doc)) { toast('Pausing is off. You can turn it on in Settings.'); return; }
  const resuming = Boolean(state.active.paused);
  const extras = resuming ? startExtras() : null;
  if (!act((doc, t) => (resuming ? E.resume(doc, t) : E.pause(doc, t)))) return;
  D.track(resuming ? 'resume' : 'pause');
  if (extras) { extras(); render(); }
}
$('#t-pause').addEventListener('click', togglePause);
$('#t-sound').addEventListener('click', () => { Sound.prime(); soundsOpen = true; render(); });
// The sounds sheet: tap to add or take away (two at most), a volume for each.
function drawSounds() {
  const mix = soundMix();
  $('#sound-list').replaceChildren(...Sound.KINDS.map((k) => {
    const on = mix.find((m) => m.id === k.id);
    const owned = soundOwned(k.id);
    const row = el('div', `row soundrow${on ? ' on' : ''}${owned ? '' : ' locked'}`);
    const b = el('button', 'grow soundpick');
    b.type = 'button';
    b.dataset.sound = k.id;
    const ic = el('span', 'tile t-teal');
    ic.append(icon(on ? 'check' : owned ? 'sound' : 'lock'));
    const txt = el('span', 'grow');
    txt.append(el('b', null, k.name), el('span', 'sub', owned ? (k.about || 'Free') : `${k.about} · ${fish(E.SHOP[`sound-${k.id}`])} in the shop`));
    b.append(ic, txt);
    row.append(b);
    if (on) {
      const v = el('input', 'vol');
      v.type = 'range'; v.min = '5'; v.max = '100'; v.value = String(Math.round(on.vol * 100));
      v.dataset.vol = k.id;
      v.setAttribute('aria-label', `${k.name} volume`);
      row.append(v);
    }
    return row;
  }));
}
$('#sounds').addEventListener('click', (e) => {
  if (e.target === e.currentTarget || e.target.closest('#sounds-done')) { soundsOpen = false; render(); return; }
  if (e.target.closest('#sounds-off')) { setMix([]); Sound.stop(); D.track('sound', { kind: 'off' }); drawSounds(); render(); return; }
  const b = e.target.closest('[data-sound]');
  if (!b) return;
  const id = b.dataset.sound;
  if (!soundOwned(id)) { soundsOpen = false; go('shop'); toast(`${Sound.byId(id).name} is in the shop, under Sounds.`); return; }
  let mix = soundMix();
  if (mix.some((m) => m.id === id)) mix = mix.filter((m) => m.id !== id);
  else { mix.push({ id, vol: 0.8 }); if (mix.length > 2) mix.shift(); D.track('sound', { kind: id }); }
  setMix(mix);
  Sound.prime();
  if (state.active && !state.active.paused || route === 'breathe') Sound.play(mix);
  drawSounds();
  render();
});
$('#sounds').addEventListener('input', (e) => {
  const v = e.target.closest('[data-vol]');
  if (!v) return;
  const mix = soundMix().map((m) => (m.id === v.dataset.vol ? { ...m, vol: Number(v.value) / 100 } : m));
  setMix(mix);
  if (Sound.playing.length) Sound.play(mix);
});
$('#t-awake').addEventListener('click', async () => {
  if (Wake.on) { Wake.release(); pref('awake', '0'); }
  else if (await Wake.request()) { pref('awake', '1'); D.track('awake'); }
  else toast("This device won't let Kavana keep the screen on.");
  render();
});
$('#t-face').addEventListener('click', () => {
  pref('face', pref('face') === 'disk' ? 'ring' : 'disk');
  D.track('face', { face: pref('face') });
  render();
});
$('#t-park').addEventListener('click', () => { parkOpen = true; render(); $('#park').text.focus(); });
$('#park-cancel').addEventListener('click', () => { parkOpen = false; render(); });
$('#park').addEventListener('submit', (e) => {
  e.preventDefault();
  const f = e.target;
  parkOpen = false;
  if (!f.text.value.trim()) { render(); return; }
  if (act((doc, t) => E.park(doc, f.text.value, t))) { f.text.value = ''; D.track('park'); toast('Parked. Back to it.'); }
});

$('#checkin').addEventListener('click', (e) => {
  const b = e.target.closest('[data-ans]');
  if (!b) return;
  const a = state.active;
  const n = a.pending;
  if (b.dataset.ans === 'drifted') whyFor = { id: a.id, n };
  if (!act((doc, t) => E.answer(doc, a.id, n, b.dataset.ans, null, t))) { whyFor = null; return; }
  D.track('checkin', { answer: b.dataset.ans, via: 'app' });
  if (b.dataset.ans === 'yes') toast('Good. Keep going.');
});
$('#whys').addEventListener('click', (e) => {
  const c = e.target.closest('[data-why]');
  if (!c || !whyFor) return;
  const w = whyFor;
  whyFor = null;
  act((doc, t) => E.answer(doc, w.id, w.n, 'drifted', c.dataset.why, t));
  D.track('why', { why: c.dataset.why });
  toast('Noted. Back to it.');
});
$('#why-skip').addEventListener('click', () => { whyFor = null; render(); toast('Back to it.'); });
$('#cat').addEventListener('click', catAway);

// end of a block
$('#outcome').addEventListener('click', (e) => {
  const more = e.target.closest('[data-more]');
  if (more) {
    const extras = startExtras();
    const id = state.awaiting.id;
    if (act((doc, t) => E.extend(doc, id, Number(more.dataset.more), t))) { D.track('extend', { more: Number(more.dataset.more) }); extras(); go('focus'); }
    return;
  }
  const b = e.target.closest('[data-out]');
  if (!b) return;
  const done = state.awaiting;
  if (act((doc, t) => E.outcome(doc, done.id, b.dataset.out || null, t))) {
    const h = E.history(D.doc).find((x) => x.id === done.id);
    D.track('end', { outcome: b.dataset.out || 'skip', min: h ? h.actual : 0, stopped: done.stopped ? 1 : 0 });
    if (b.dataset.out === 'done') { confetti(); toast(`Nice! ${h ? fmtMin(h.actual) : ''} of focus.`); }
    else if (b.dataset.out) toast('Saved.');
  }
});
// Again: file this block without an answer and start the same one, with nothing in between.
$('#again').addEventListener('click', () => {
  const b = state.awaiting;
  if (!b) return;
  if (!act((doc, t) => E.outcome(doc, b.id, null, t))) return;
  D.track('end', { outcome: 'again', min: (E.history(D.doc).find((x) => x.id === b.id) || {}).actual || 0, stopped: b.stopped ? 1 : 0 });
  const f = $('#start');
  mode = b.mode === 'stopwatch' ? 'stopwatch' : 'timer';
  if (mode === 'timer') { minutes = b.minutes; $('#custom-wrap').hidden = true; }
  style = b.style; pickTag = b.tag || '';
  f.intention.value = b.intention; f.step.value = b.step || '';
  go('focus');
  f.requestSubmit();
});
$('#parked-copy').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(state.awaiting.parked.map((t) => `- ${t}`).join('\n'));
    toast('Copied. Paste them into your notes or to-do list.');
  } catch { toast("Couldn't copy on this device."); }
});
$('#breath-done').addEventListener('click', () => go('focus'));

// meeting a cat
function doneMeeting(pick) {
  const id = meetQueue.shift();
  const c = K.byId(id);
  D.track('cat_met', { cat: id });
  if (pick) {
    act((doc, t) => E.setSettings(doc, { companion: id }, t));
    D.track('companion', { cat: id });
    toast(`${c.name} is coming to your next block.`);
  } else render();
}
$('#meet-pick').addEventListener('click', () => doneMeeting(true));
$('#meet-ok').addEventListener('click', () => doneMeeting(false));

// Later list
$('#later-add').addEventListener('submit', (e) => {
  e.preventDefault();
  const f = e.target;
  if (!f.text.value.trim()) return;
  if (act((doc, t) => E.addLater(doc, f.text.value, t))) { f.text.value = ''; D.track('later_add'); }
});
$('#later-list').addEventListener('click', (e) => {
  const row = e.target.closest('.lrow');
  if (!row) return;
  const item = state.later.find((x) => x.id === row.dataset.id);
  if (!item) return;
  if (e.target.closest('[data-later-start]')) {
    fromLater = item.id;
    go('focus');
    $('#start').intention.value = item.text;
    toast('Pick how long, then Start.');
  } else if (e.target.closest('[data-later-done]')) {
    row.querySelector('.check').classList.add('on');
    row.classList.add('leaving');
    setTimeout(() => { if (act((doc, t) => E.doneLater(doc, item.id, t))) D.track('later_done'); }, 380);
  }
});

// cats
$('#catgrid').addEventListener('click', (e) => {
  const card = e.target.closest('[data-cat]');
  if (!card) return;
  const c = K.byId(card.dataset.cat);
  if (c.adopt && !metCats().includes(c)) { go('shop'); return; }
  if (!metCats().includes(c)) { toast(`🔒 ${c.how} to meet this cat.`); return; }
  if (c === companion()) { toast(`${c.name} is already coming to your next block.`); return; }
  act((doc, t) => E.setSettings(doc, { companion: c.id }, t));
  D.track('companion', { cat: c.id });
  toast(`${c.name} is coming to your next block.`);
});
$('#cats-seg').addEventListener('click', (e) => {
  const b = e.target.closest('[data-pane]');
  if (!b) return;
  go(b.dataset.pane);
  if (route === 'shop' || route === 'missions') D.track(route);
});
// The shop: café things and cats to adopt.
$('#pane-shop').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-buy]');
  if (!b) return;
  const id = b.dataset.buy;
  const c = K.CATS.find((x) => x.id === id);
  const theme = id.startsWith('theme-') && K.THEMES.find((x) => `theme-${x.id}` === id);
  const sound = id.startsWith('sound-') && Sound.byId(id.slice(6));
  const x = K.item(id);
  const name = c ? c.name : theme ? `${theme.name} theme` : sound ? `${sound.name} sound` : x.name;
  const price = E.SHOP[id];
  if (E.owns(D.doc, id)) {
    if (theme) { setting({ theme: theme.id }, ['theme', { id: theme.id }], true); toast(`${theme.name} it is.`); }
    else if (sound) { soundsOpen = true; render(); }
    else toast(c ? `${name} lives in your café.` : `The ${name.toLowerCase()} is in your café.`);
    return;
  }
  if (treatsLeft() < price) { toast(`That's ${fish(price)}. You have ${fish(treatsLeft())}. Every focused minute earns one.`); return; }
  if (!(await confirmIt(c ? `Adopt ${name}?` : `Buy the ${name}?`, `${fish(price)} of your ${fish(treatsLeft())}.`, c ? 'Adopt' : 'Buy'))) return;
  if (!act((doc, t) => E.buy(doc, id, t), "Couldn't buy that.")) return;
  D.track(c ? 'adopt' : 'buy', { item: id });
  if (c) { confetti(); toast(`${name} is home!`); }
  else if (theme) { setting({ theme: theme.id }, null, true); toast(`Your café has the ${theme.name} theme now.`); }
  else if (sound) toast(`${sound.name} is in Sounds now. Tap Sound during a block.`);
  else toast(`The ${name.toLowerCase()} is in your café.`);
});

// history + settings
$('#clear').addEventListener('click', async () => {
  if (!(await confirmIt('Clear Your History?', "Your café empties too. You keep your treats, what you bought, and the cats you've met. This can't be undone.", 'Clear', true))) return;
  if (act((doc, t) => E.clearHistory(doc, t))) { D.track('clear'); toast('History cleared.'); }
});
function setting(patch, track, quiet) {
  if (!act((doc, t) => E.setSettings(doc, patch, t), "Couldn't save that.")) return;
  if (track) D.track(...track);
  if (!quiet) toast('Saved.');
}
$('#interval').addEventListener('change', (e) => setting({ interval: Number(e.target.value) }));
$('#tag-add').addEventListener('submit', (e) => {
  e.preventDefault();
  const v = e.target.text.value.trim();
  if (!v) return;
  if (state.settings.tags.length >= 12) { toast('That is 12 tags. Remove one first.'); return; }
  if (state.settings.tags.some((t) => t.toLowerCase() === v.toLowerCase())) { toast('You have that tag already.'); return; }
  setting({ tags: [...state.settings.tags, v] }, ['tags', { n: state.settings.tags.length + 1 }], true);
  e.target.text.value = '';
});
$('#tag-list').addEventListener('click', (e) => {
  const b = e.target.closest('[data-untag]');
  if (b) setting({ tags: state.settings.tags.filter((t) => t !== b.dataset.untag) }, ['tags', { n: state.settings.tags.length - 1 }], true);
});
$('#cafe-span').addEventListener('click', (e) => {
  const b = e.target.closest('[data-span]');
  if (!b) return;
  cafe = { span: b.dataset.span, at: now() };
  D.track('cafe', { span: cafe.span });
  renderCafe();
});
$('#cafe-prev').addEventListener('click', () => { cafe.at = shiftPeriod(cafe.span, cafe.at, -1); renderCafe(); });
$('#cafe-next').addEventListener('click', () => { cafe.at = Math.min(now(), shiftPeriod(cafe.span, cafe.at, 1)); renderCafe(); });
$('#cafe-now').addEventListener('click', () => { cafe.at = now(); renderCafe(); });
$('#hist').addEventListener('click', (e) => {
  const row = e.target.closest('[data-edit]');
  if (row) openEdit(row.dataset.edit);
});
$('#goal-select').addEventListener('change', (e) => setting({ goal: Number(e.target.value) }, ['goal', { goal: Number(e.target.value) }]));
$('#cat-on').addEventListener('change', (e) => {
  setting({ cat: e.target.checked }, ['cat', { on: e.target.checked ? 1 : 0 }], true);
  if (e.target.checked) cat(`Boo! ${companion().name} is back.`); else toast('Cat mode off.');
});
$('#chime').addEventListener('change', (e) => {
  pref('chime', e.target.checked ? '1' : '0');
  D.track('chime', { on: e.target.checked ? 1 : 0 });
  if (e.target.checked) { Sound.prime(); setTimeout(() => chime(), 50); }
});
$('#counting').addEventListener('change', (e) => { D.setCounting(e.target.checked); toast(e.target.checked ? 'Thanks. Only counts, never what you type.' : 'Counting is off on this device.'); });
function saveDaily(change) {
  const d = { ...state.settings.daily, ...change };
  if (d.on && !d.days.length) d.days = [0, 1, 2, 3, 4, 5, 6]; // on with no days would never fire
  if (act((doc, t) => E.setSettings(doc, { daily: d }, t), "Couldn't save that.")) {
    D.track('daily', { on: d.on ? 1 : 0 });
    toast(d.on ? `Kavana will remind you at ${d.time}.` : 'Daily reminder off.');
  }
}
$('#daily-on').addEventListener('change', (e) => saveDaily({ on: e.target.checked }));
$('#daily-time').addEventListener('change', (e) => { if (e.target.value) saveDaily({ time: e.target.value }); });
$('#daily-days').addEventListener('click', (e) => {
  const c = e.target.closest('[data-day]');
  if (!c) return;
  const days = new Set(state.settings.daily.days);
  const day = Number(c.dataset.day);
  if (days.has(day)) days.delete(day); else days.add(day);
  saveDaily({ days: [...days] });
});
$('#push-test').addEventListener('click', async () => {
  try {
    const r = await D.api('POST', 'api/push/test');
    toast(r.sent ? 'Sent. It should show up in a few seconds.' : "Couldn't reach this device. Turn reminders off and on in the device's settings.");
  } catch { toast("Couldn't send. Check your connection."); }
});

// friends
$('#share').addEventListener('change', (e) => {
  setting({ share: e.target.value }, ['share', { level: e.target.value }]);
  D.flushSync().then(() => loadFriends(true)).then(() => { if (route === 'friends') drawFriendsSettings(); });
});
$('#share-name').addEventListener('change', (e) => setting({ name: e.target.value }));
$('#friend-pings').addEventListener('change', (e) => setting({ friendPings: e.target.checked }));
$('#copy-code').addEventListener('click', async () => {
  if (!friends) return;
  try { await navigator.clipboard.writeText(friends.code); toast('Copied. Send it to a friend.'); } catch { toast("Couldn't copy on this device."); }
});
$('#add-friend').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  try {
    friends = await D.api('POST', 'api/friends/add', { code: f.code.value });
    friendsAt = now();
    f.code.value = '';
    D.track('friend_add');
    drawFriendsSettings();
    toast('Friend added. You see each other once you both share.');
  } catch (ex) {
    const why = ex.data && ex.data.error;
    toast(why === 'code' ? "That code doesn't match anyone." : why === 'self' ? "That's your own code." : why === 'too many' ? 'That is a lot of friends. Remove one first.' : "Couldn't add that. Check your connection.");
  }
});
$('#friends-settings').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-unfriend]');
  if (!b || !(await confirmIt('Remove This Friend?', 'You stop seeing each other.', 'Remove', true))) return;
  try { friends = await D.api('POST', 'api/friends/remove', { name: b.dataset.unfriend }); friendsAt = now(); drawFriendsSettings(); } catch { toast("Couldn't remove them. Check your connection."); }
});

// ---------- Forest's other pages: rankings, shelter cats, news, your own lines, themes ----------
const currentMode = () => mode || state.settings.mode || 'timer';
const NEWS = window.KavanaNews || [];
const visibleNews = () => { const today = new Date(now()).toISOString().slice(0, 10); return NEWS.filter((n) => n.date <= today); };
// Posts newer than the last one you read.
function unreadNews() {
  const seen = pref('newsSeen');
  const list = visibleNews();
  const i = list.findIndex((n) => n.id === seen);
  return i < 0 ? (seen ? list : list.slice(0, 1)) : list.slice(0, i); // a first visit only hears about the newest
}
function renderNews() {
  show('news');
  const list = visibleNews();
  const fresh = new Set(unreadNews().map((n) => n.id));
  $('#news-list').replaceChildren(...list.map((n) => {
    const c = el('div', `newscard${fresh.has(n.id) ? ' fresh' : ''}`);
    c.append(el('span', 'newsdate', new Date(`${n.date}T12:00`).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })), el('h3', null, n.title), el('p', null, n.body));
    if (n.go) { const b = el('button', 'btn tinted small', 'Take Me There'); b.dataset.go = n.go; c.append(b); }
    return c;
  }));
  if (list.length) pref('newsSeen', list[0].id);
  D.track('news');
}

// Rankings: this week's round, with friends or worldwide.
async function loadRankings(force) {
  if (!D.account) { rankings = null; return null; }
  if (!force && rankings && now() - rankingsAt < 30000) return rankings;
  try { rankings = await D.api('GET', 'api/rankings'); rankingsAt = now(); } catch {}
  return rankings;
}
const MEDALS = ['🥇', '🥈', '🥉'];
function rankRow(r) {
  const row = el('div', `row rankrow${r.me ? ' me' : ''}`);
  row.append(el('span', 'rank', r.rank <= 3 ? MEDALS[r.rank - 1] : String(r.rank)), avatar(r.display || r.name));
  const who = el('span', 'grow');
  who.append(el('b', null, r.me ? `${r.display || r.name} (you)` : r.display || r.name), el('span', 'sub', `${r.kittens === 1 ? '1 kitten' : `${r.kittens} kittens`} home`));
  row.append(who, el('span', 'rankmin', fmtMin(r.minutes)));
  return row;
}
function renderRankings() {
  show('rankings');
  $('#rank-anon').hidden = Boolean(D.account);
  $('#rank-in').hidden = !D.account;
  if (!D.account) return;
  const r0 = state.settings.rank || {};
  $('#rank-on').checked = Boolean(r0.on);
  $('#rank-global').checked = Boolean(r0.global);
  $('#rank-global').disabled = !r0.on;
  $('#rank-name-row').hidden = !r0.on;
  if (document.activeElement !== $('#rank-name')) $('#rank-name').value = r0.name || '';
  for (const b of $$('#rank-seg button')) b.classList.toggle('on', b.dataset.rank === rankTab);
  const draw = () => {
    const r = rankings;
    if (!r || route !== 'rankings') return;
    const left = r.round.to - now();
    const d = Math.floor(left / 86400000), h = Math.floor((left % 86400000) / 3600000);
    $('#rank-left').textContent = `This round ends in ${d ? `${d} ${d === 1 ? 'day' : 'days'} ` : ''}${h} ${h === 1 ? 'hour' : 'hours'}.`;
    const list = rankTab === 'friends' ? r.friends : r.world;
    const rows = list.map(rankRow);
    if (rankTab === 'world' && r.worldMe) rows.push(el('div', 'row sub', '···'), rankRow(r.worldMe));
    $('#rank-list').replaceChildren(...(rows.length ? rows : [el('div', 'row sub', rankTab === 'friends' ? 'None of your friends are in the rankings yet.' : 'Nobody is in the worldwide rankings yet. Be the first.')]));
    $('#rank-foot').textContent = !r.on ? `Turn on "Be in the rankings" below to show up here. This week you've focused ${fmtMin(r.me.minutes)} so far.`
      : rankTab === 'world' && !r.global ? `You're not in the worldwide list. ${r.players === 1 ? '1 person is' : `${r.players} people are`}.`
      : rankTab === 'world' ? `${r.players === 1 ? '1 person' : `${r.players} people`} in this round.` : '';
  };
  draw();
  loadRankings().then(draw);
  D.track('rankings', { tab: rankTab });
}
async function saveRank(patch) {
  const r = { ...(state.settings.rank || {}), ...patch };
  if (r.global && !r.name) { toast('Pick a nickname first.'); $('#rank-name').focus(); render(); return; }
  if (!act((doc, t) => E.setSettings(doc, { rank: r }, t), "Couldn't save that.")) return;
  D.track('rank', { on: r.on ? 1 : 0, world: r.global ? 1 : 0 });
  await D.flushSync();
  await loadRankings(true);
  if (route === 'rankings') renderRankings();
}

// Shelter cats: sponsor them one after the other.
function renderShelter() {
  show('shelter');
  const mine = K.SHELTER.filter((c) => E.owns(D.doc, c.id));
  $('#shelter-you').textContent = String(mine.length);
  $('#shelter-friends').textContent = shelterCount && shelterCount.friends != null ? String(shelterCount.friends) : '–';
  $('#shelter-all').textContent = shelterCount ? String(shelterCount.everyone) : '–';
  const next = K.SHELTER.find((c) => !E.owns(D.doc, c.id));
  const left = treatsLeft();
  $('#shelter-cats').replaceChildren(...K.SHELTER.map((c) => {
    const owned = E.owns(D.doc, c.id);
    const price = E.SHOP[c.id];
    const card = el('button', `shopcard${owned ? ' owned' : c !== next ? ' later' : price > left ? ' dear' : ''}`);
    card.type = 'button';
    if (c === next) card.dataset.sponsor = c.id;
    const tag = el('span', 'price', owned ? 'In your café' : c === next ? fish(price) : `After ${K.SHELTER[K.SHELTER.indexOf(c) - 1].name}`);
    if (owned) tag.prepend(icon('heart'));
    const art = owned ? catArt({ ...c, breed: 'grey' }, 'sit') : portrait({ ...c, breed: 'grey' }, 'sit');
    if (!owned) art.classList.add('waiting');
    card.append(art, el('b', null, c.name), el('span', 'about', c.about), tag);
    return card;
  }));
  $('#shelter-link').href = K.SHELTER_ORG.url;
  $('#shelter-org').textContent = `Donate to ${K.SHELTER_ORG.name}, which takes care of thousands of cats waiting for a home.`;
  fetch('api/shelter', { credentials: 'same-origin' }).then((r) => r.json()).then((x) => {
    shelterCount = x;
    if (route === 'shelter') { $('#shelter-friends').textContent = x.friends != null ? String(x.friends) : '–'; $('#shelter-all').textContent = String(x.everyone); }
  }).catch(() => {});
}

// Your own lines, for "Nudge me".
function renderLines() {
  show('lines');
  const lines = state.settings.lines || [];
  $('#line-list').replaceChildren(...(lines.length ? lines.map((t, i) => {
    const row = el('div', 'row');
    const rm = el('button', 'minus'); rm.type = 'button'; rm.dataset.unline = String(i); rm.setAttribute('aria-label', 'Remove'); rm.append(icon('minus'));
    row.append(rm, el('span', 'grow', t));
    return row;
  }) : [el('div', 'row sub', 'No lines yet. Add one below.')]));
  $('#line-add').hidden = lines.length >= 20;
}

// Café themes: the ones you have, and the shop's.
function themeSwatch(id) { const sw = el('span', `swatch theme-${id}`); sw.append(el('i', 'w'), el('i', 'f')); return sw; }
function renderThemes() {
  show('themes');
  const cur = state.settings.theme || 'classic';
  $('#theme-grid').replaceChildren(...K.THEMES.map((th) => {
    const owned = th.id === 'classic' || E.owns(D.doc, `theme-${th.id}`);
    const card = el('button', `themecard${th.id === cur ? ' on' : ''}${owned ? '' : ' locked'}`);
    card.type = 'button';
    card.dataset.theme = th.id;
    card.append(themeSwatch(th.id), el('b', null, th.name), el('span', null, owned ? th.about : `${fish(E.SHOP[`theme-${th.id}`])} in the shop`));
    return card;
  }));
}

// Rewards: achievements, the starter steps, the monthly challenge.
function claim(id, what) {
  let paid = 0;
  if (!act((doc, t) => { paid = E.claim(doc, id, t); }, "That isn't ready yet.")) return;
  confetti();
  chime(true);
  toast(`${what}. ${fish(`+${paid}`)}`);
  D.track('claim', { id: id.replace(/-\d.*$/, '').slice(0, 20) });
}
const ACH_ICON = { home: 'cat', minutes: 'focus', streak: 'paw', long: 'stopwatch', stopwatch: 'stopwatch', early: 'sun', night: 'sparkle', naps: 'people', friends: 'people', missions: 'target', tags: 'tag', met: 'cat', adopted: 'heart', things: 'house', shelter: 'heart' };
function achCard(a) {
  const c = el('div', `achcard${a.claimed ? ' claimed' : a.done ? ' ready' : ''}`);
  const medal = el('span', 'medal');
  medal.append(icon(ACH_ICON[a.stat] || 'award'));
  c.append(medal, el('b', null, a.name), el('span', 'sub', a.text));
  if (a.claimed) { const d = el('span', 'achdone'); d.append(icon('check'), 'Collected'); c.append(d); }
  else if (a.done) { const b = el('button', 'btn filled small', `Collect ${fish(a.reward)}`); b.dataset.claim = a.id; b.dataset.what = a.name; c.append(b); }
  else {
    const bar = el('span', 'mbar'); const fill = el('i'); fill.style.width = `${Math.round((100 * a.have) / a.goal)}%`; bar.append(fill);
    c.append(bar, el('span', 'achpay', `${a.stat === 'minutes' ? `${fmtMin(a.have)} of ${fmtMin(a.goal)}` : `${a.have} of ${a.goal}`} · ${fish(a.reward)}`));
  }
  return c;
}
function stepRow(x, onDone) {
  const row = el('div', `row mission${x.done ? ' done' : ''}`);
  const tile = el('span', `tile ${x.claimed ? 't-green' : x.done ? 't-yellow' : 't-orange'}`);
  tile.append(icon(x.done ? 'check' : 'target'));
  const mid = el('span', 'grow');
  mid.append(el('b', null, x.text), el('span', 'sub', x.claimed ? 'Collected' : x.done ? 'Done' : `${x.have} of ${x.goal}`));
  row.append(tile, mid);
  if (x.done && !x.claimed) { const b = el('button', 'btn filled small', `Collect ${fish(x.reward)}`); b.dataset.claim = x.id; b.dataset.what = onDone; row.append(b); }
  else row.append(el('span', 'pay', fish(`+${x.reward}`)));
  return row;
}

// Editing a block from the café (or its note from the end card).
function openEdit(id) {
  const b = D.doc.blocks.find((x) => x.id === id);
  if (!b) return;
  editId = id;
  editTag = b.tag || '';
  const f = $('#edit');
  f.intention.value = b.intention;
  f.note.value = b.note || '';
  drawEditTags();
  render();
}
function drawEditTags() {
  const tags = [...new Set([...state.settings.tags, ...(editTag ? [editTag] : [])])];
  $('#edit-tags').replaceChildren(...tags.map((t) => {
    const c = el('button', `chip tagchip${t === editTag ? ' on' : ''}`);
    c.type = 'button';
    c.dataset.etag = t;
    const dot = el('i', 'dot'); dot.style.background = tagColor(t);
    c.append(dot, t);
    return c;
  }));
}

// Share your café as a picture: the room as it is on screen, with the period and the numbers under it.
async function shareCafe() {
  const room = cafe3 && cafe3.canvas;
  if (!room) return;
  const r = room.getBoundingClientRect();
  const scale = 2, W = Math.round(r.width * scale), H = Math.round(r.height * scale), pad = 40 * scale / 2;
  const canvas = document.createElement('canvas');
  canvas.width = W + pad * 2; canvas.height = H + pad * 2 + 120;
  const g = canvas.getContext('2d');
  const css = getComputedStyle(document.body);
  g.fillStyle = css.getPropertyValue('--bg') || '#f2f2f7';
  g.fillRect(0, 0, canvas.width, canvas.height);
  cafe3.view.draw(); // the frame as it is right now
  g.drawImage(room, pad, pad, W, H);
  g.fillStyle = css.getPropertyValue('--label') || '#000';
  g.font = `700 ${22 * scale}px -apple-system, system-ui, sans-serif`;
  g.fillText(`My Cat Café · ${$('#cafe-now').textContent}`, pad, H + pad + 34 * scale);
  g.font = `400 ${15 * scale}px -apple-system, system-ui, sans-serif`;
  g.fillStyle = '#888';
  g.fillText([...$$('#cafe-tiles > div')].slice(0, 3).map((t) => t.innerText.replace('\n', ' ')).join(' · ') + ' · Kavana', pad, H + pad + 58 * scale);
  const blob = await new Promise((ok) => canvas.toBlob(ok, 'image/png'));
  if (!blob) { toast("Couldn't make the picture."); return; }
  const file = new File([blob], 'my-cat-cafe.png', { type: 'image/png' });
  D.track('share_cafe');
  try {
    if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: 'My Cat Café' }); return; }
  } catch { return; }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = 'my-cat-cafe.png';
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  toast('Saved the picture.');
}

// rankings, shelter, lines, themes, rewards, editing, sharing
$('#rank-seg').addEventListener('click', (e) => { const b = e.target.closest('[data-rank]'); if (b) { rankTab = b.dataset.rank; renderRankings(); } });
$('#rank-on').addEventListener('change', (e) => saveRank({ on: e.target.checked, global: e.target.checked && state.settings.rank.global }));
$('#rank-global').addEventListener('change', (e) => saveRank({ global: e.target.checked, name: $('#rank-name').value }));
$('#rank-name').addEventListener('change', (e) => saveRank({ name: e.target.value }));
$('#shelter-cats').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-sponsor]');
  if (!b) return;
  const c = K.SHELTER.find((x) => x.id === b.dataset.sponsor);
  const price = E.SHOP[c.id];
  if (treatsLeft() < price) { toast(`That's ${fish(price)}. You have ${fish(treatsLeft())}.`); return; }
  if (!(await confirmIt(`Sponsor ${c.name}?`, `${fish(price)} of your ${fish(treatsLeft())}. ${c.name} moves into your café.`, 'Sponsor'))) return;
  if (!act((doc, t) => E.buy(doc, c.id, t), "Couldn't do that.")) return;
  D.track('sponsor', { n: K.SHELTER.indexOf(c) + 1 });
  confetti();
  toast(`Thank you. ${c.name} lives in your café now.`);
  try { shelterCount = { ...(shelterCount || {}), ...(await D.api('POST', 'api/sponsor', {})) }; } catch {}
  if (route === 'shelter') renderShelter();
});
$('#line-add').addEventListener('submit', (e) => {
  e.preventDefault();
  const v = e.target.text.value.trim();
  if (!v) return;
  setting({ lines: [...(state.settings.lines || []), v] }, ['lines', { n: (state.settings.lines || []).length + 1 }], true);
  e.target.text.value = '';
});
$('#line-list').addEventListener('click', (e) => {
  const b = e.target.closest('[data-unline]');
  if (b) setting({ lines: state.settings.lines.filter((_, i) => i !== Number(b.dataset.unline)) }, null, true);
});
$('#theme-grid').addEventListener('click', (e) => {
  const b = e.target.closest('[data-theme]');
  if (!b) return;
  const id = b.dataset.theme;
  if (id !== 'classic' && !E.owns(D.doc, `theme-${id}`)) { go('shop'); toast('Themes are in the shop.'); return; }
  setting({ theme: id }, ['theme', { id }], true);
  toast(`${K.THEMES.find((x) => x.id === id).name} it is.`);
});
document.addEventListener('click', (e) => {
  const c = e.target.closest('[data-claim]');
  if (c) { e.preventDefault(); claim(c.dataset.claim, c.dataset.what || 'Collected'); }
});
$('#outcome-note').addEventListener('click', async () => {
  const b = state.awaiting;
  if (!b) return;
  const r = await ask({ title: 'A Note', message: 'How it went, or what comes next.', input: 'Got the first page done', type: 'text', value: b.note || '', actions: [{ label: 'Cancel', cancel: true }, { label: 'Save', main: true }] });
  if (r.i !== 1) return;
  if (act((doc, t) => E.edit(doc, b.id, { note: r.value }, t))) { D.track('note'); toast(r.value.trim() ? 'Note saved.' : 'Note removed.'); }
});
$('#edit-tags').addEventListener('click', (e) => {
  const c = e.target.closest('[data-etag]');
  if (!c) return;
  editTag = editTag === c.dataset.etag ? '' : c.dataset.etag;
  drawEditTags();
});
$('#edit-cancel').addEventListener('click', () => { editId = null; render(); });
$('#edit').addEventListener('click', (e) => { if (e.target === e.currentTarget) { editId = null; render(); } });
$('#edit').addEventListener('submit', (e) => {
  e.preventDefault();
  const f = e.target;
  const id = editId;
  if (!f.intention.value.trim()) { toast('Say what you worked on.'); return; }
  editId = null;
  if (act((doc, t) => E.edit(doc, id, { intention: f.intention.value, tag: editTag, note: f.note.value }, t), "Couldn't save that.")) { D.track('edit'); toast('Saved.'); }
});
$('#cafe-share').addEventListener('click', () => shareCafe().catch(() => toast("Couldn't make the picture.")));
$('#pause-select').addEventListener('change', (e) => setting({ pause: e.target.value }, ['pausing', { to: e.target.value }]));
$('#overtime').addEventListener('change', (e) => setting({ overtime: e.target.checked }, ['overtime', { on: e.target.checked ? 1 : 0 }]));
$('#close-counts').addEventListener('change', (e) => setting({ closeCounts: e.target.checked }, null));
// the mindful minute
$('#breath-len').addEventListener('click', (e) => { const b = e.target.closest('[data-len]'); if (b) { breathLen = Number(b.dataset.len); stopBreath(); renderBreathe(); } });
$('#breath-sound').addEventListener('click', () => { Sound.prime(); soundsOpen = true; render(); });
$('#breath-focus').addEventListener('click', () => { go('focus'); setTimeout(() => $('#start').intention.focus(), 100); });

// Keyboard, for iPads with keyboards and Macs: ⌘1-5 for Focus, Later, Café, Cats and Settings, ⌘, for Settings, space to pause, Esc to close.
document.addEventListener('keydown', (e) => {
  if (!$('#alert').hidden) return;
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement && document.activeElement.tagName);
  if ((e.metaKey || e.ctrlKey) && /^[1-5]$/.test(e.key)) { e.preventDefault(); go(TABS[Number(e.key) - 1]); return; }
  if ((e.metaKey || e.ctrlKey) && e.key === ',') { e.preventDefault(); go('settings'); return; }
  if (e.key === 'Escape') {
    if (menuOpen) { menuOpen = false; drawMenu(); $('#menu-btn').focus(); } else if (optionsOpen) { optionsOpen = false; render(); }
    else if (parkOpen) { parkOpen = false; render(); } else if (whyFor) { whyFor = null; render(); } else if (inviting) { inviting = false; render(); }
    else if (soundsOpen || roomOpen || editId) { soundsOpen = false; roomOpen = false; editId = null; render(); } else if (PARENT[route]) go(PARENT[route]);
    return;
  }
  if (typing) return;
  if (e.key === ' ' && route === 'focus' && state && state.active) { e.preventDefault(); togglePause(); }
  if (e.key === 'n' && route === 'focus' && state && !state.active) { e.preventDefault(); $('#start').intention.focus(); }
});

// A nap room link: #room=CODE.
function roomLink() {
  const m = /^#room=([A-Za-z]{6})$/.exec(location.hash);
  if (!m) return false;
  history.replaceState(null, '', location.pathname);
  route = 'focus';
  joinByCode(m[1]);
  return true;
}
window.addEventListener('hashchange', () => {
  if (roomLink()) return;
  route = routeOf(location.hash.slice(1));
  if (['cafe', 'settings', 'later', 'cats'].includes(route)) D.track(route === 'cats' ? 'cat' : route);
  if (route === 'install') D.track('install_hint');
  render();
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { leftKavana(); return; }
  backInKavana();
  D.drainInbox().then(() => D.pull()).then(refresh);
  if (Wake.on && !Wake.lock && state && state.active) Wake.request(); // dropped when the app went to the background
});
if (pushSupported) navigator.serviceWorker.addEventListener('message', (e) => { if (e.data && e.data.type === 'refresh') D.drainInbox().then(refresh); });
window.addEventListener('pagehide', leftKavana);
D.onChange(refresh);
// Sync stopped because the server won't take this device's copy: say so once (Settings keeps saying it).
let syncTroubleSaid = null;
D.onChange(() => {
  if (D.syncTrouble && D.syncTrouble !== syncTroubleSaid) toast("Couldn't sync: this device's history is too big for the server.");
  syncTroubleSaid = D.syncTrouble;
});
// Once a second: check-ins coming due, the end of a block, the Live Activity clock.
setInterval(() => { if (D.tick()) refresh(); else paintLive(); }, 1000);
setInterval(() => { if (!document.hidden && D.account) D.pull(); }, 30000);
// Napping together: every 5 s while a block runs, every 30 s for one that just ended.
let napLast = 0;
setInterval(() => {
  const block = !document.hidden && napBlock();
  if (block && now() - napLast > (state.active ? 4500 : 29500)) { napLast = now(); askNap(block); }
}, 1000);
setInterval(() => {
  if (!document.hidden && D.account && route === 'focus' && state && !state.active) loadFriends(true).then(() => { if (route === 'focus') drawFriendsHome(); });
}, 20000);

// ---------- start ----------
(async function boot() {
  refresh();
  if (document.hidden) leftKavana(); else backInKavana(true); // came back after the page was closed?
  D.track('open', { mode: D.account ? 'account' : 'anon', plat: platform });
  await findSub();
  if (mySub) D.registerDevice(mySub).catch(() => {}); // keeps the server's copy current (browsers rotate them)
  else if (D.device) D.forgetDevice();
  await D.drainInbox();
  if (D.account) { await D.refreshMe(); await D.pull(); }
  refresh();
  roomLink();
  if (D.account) await loadFriends();
  const block = napBlock();
  if (block) { napLast = now(); askNap(block); }
})();
