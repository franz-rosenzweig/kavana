'use strict';
// Chataltul's server. The app itself runs in the browser (web/engine.js); this is the part that can't:
// - a mailbox that sends a device its check-in pings on time, so they arrive with the app closed;
// - optional accounts, which back up and sync the browser's data between devices (a name and a
//   password, or an email and a code we send it, through Proton Mail Bridge here);
// - focus with friends (accounts only, opt-in on both sides), napping together, rankings;
// - a count of the shelter cats everyone sponsored;
// - feature counts for the admin dashboard.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const push = require('./lib/push');
const S = require('./lib/state');
const M = require('./lib/mail');
const E = require('./web/engine');

const PORT = Number(process.env.KAVANA_PORT) || 8460;
const HOST = process.env.KAVANA_HOST || '127.0.0.1';
const PUBLIC_URL = process.env.KAVANA_URL || 'https://stuffs.tiresia.xyz/kavana/';
const WEB = path.join(__dirname, 'web');
const COOKIE = 'kavana';
const COOKIE_PATH = process.env.KAVANA_PATH || '/'; // /kavana/ behind the stuffs Caddy
const COOKIE_DAYS = 400;
const MIN = Number(process.env.KAVANA_MINUTE_MS) || 60000; // tests shrink the minute
E.config.MIN = MIN;
const DAY = 86400000;
const LIMITS = { accounts: 2000, devices: 5000, docBytes: 1_000_000, friends: 20, pings: 60, napping: 8 };
const CODE_MS = 10 * 60000; // an emailed code works for ten real minutes, whatever the tests do to the minute
const NAP_GRACE = Number(process.env.KAVANA_NAP_GRACE_MS) || 15000; // like the page's: a glance away is fine

const VAPID = S.vapid();
const ADMIN_TOKEN = S.adminToken();
const sign = push.vapidSigner(VAPID, PUBLIC_URL);
const mail = M.mailer(S.DIR);
const { st, migrated } = S.loadState();
st.naps = st.naps || {};
st.shelter = st.shelter || { total: 0 };
if (migrated) for (const [name, d] of Object.entries(migrated)) S.saveDoc(name, d);
let saveTimer = null;
const save = () => { clearTimeout(saveTimer); saveTimer = setTimeout(() => S.saveState(st), 200); };
if (migrated) save();

// ---------- account docs (cached in memory, one file each) ----------
const docs = new Map();
function docOf(name) {
  if (!docs.has(name)) {
    const d = S.loadDoc(name) || { rev: 0, doc: E.empty() };
    d.doc = E.normalize(d.doc);
    docs.set(name, d);
  }
  return docs.get(name);
}
const display = (name) => docOf(name).doc.settings.name || name.charAt(0).toUpperCase() + name.slice(1);

// ---------- http helpers ----------
const STATIC = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/data.js': ['data.js', 'text/javascript; charset=utf-8'],
  '/engine.js': ['engine.js', 'text/javascript; charset=utf-8'],
  '/lines.js': ['lines.js', 'text/javascript; charset=utf-8'],
  '/cats.js': ['cats.js', 'text/javascript; charset=utf-8'],
  '/sw.js': ['sw.js', 'text/javascript; charset=utf-8'],
  '/style.css': ['style.css', 'text/css; charset=utf-8'],
  '/manifest.webmanifest': ['manifest.webmanifest', 'application/manifest+json'],
  '/robots.txt': ['robots.txt', 'text/plain; charset=utf-8'],
  '/news.js': ['news.js', 'text/javascript; charset=utf-8'],
  '/sounds.js': ['sounds.js', 'text/javascript; charset=utf-8'],
  '/warp.js': ['warp.js', 'text/javascript; charset=utf-8'],
  '/cafe3d.js': ['cafe3d.js', 'text/javascript; charset=utf-8'],
  '/rig.json': ['rig.json', 'application/json; charset=utf-8'],
};
const ICON = /^\/icons\/([a-z0-9-]+\.(png|svg))$/;
const PORTRAIT = /^\/(cats|cafe)\/([a-z0-9-]+\.webp)$/; // the painted cats (web/cats/) and café things (web/cafe/)
const AUDIO = /^\/audio\/([a-z0-9-]+)\.(mp3|m4a|ogg)$/; // recorded background sounds (web/audio/), a new name when one changes
const AUDIO_TYPE = { mp3: 'audio/mpeg', m4a: 'audio/mp4', ogg: 'audio/ogg' };
const BASE_HEADERS = {
  'X-Robots-Tag': 'noindex, nofollow, noarchive', 'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY',
};
const CSP = "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; "
  + "manifest-src 'self'; worker-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'";

function send(res, status, body, headers = {}) { res.writeHead(status, { ...BASE_HEADERS, ...headers }); res.end(body); }
function json(res, status, obj, headers = {}) {
  send(res, status, obj === null ? null : JSON.stringify(obj), {
    'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', Vary: 'Cookie', ...headers,
  });
}

function serveStatic(req, res, rel, type) {
  let buf;
  try { buf = fs.readFileSync(path.join(WEB, rel)); } catch { return json(res, 404, { error: 'not found' }); }
  const etag = '"' + crypto.createHash('sha1').update(buf).digest('base64url').slice(0, 16) + '"';
  const headers = {
    'Content-Type': type, ETag: etag,
    // Cloudflare rewrites any other Cache-Control on .js/.css to 4 hours; "private" makes it pass through.
    'Cache-Control': rel.startsWith('icons/') || rel.startsWith('cats/') || rel.startsWith('cafe/') || rel.startsWith('audio/') ? 'public, max-age=86400' : 'private, no-cache', // pictures get a new name when they change
  };
  if (rel === 'index.html') headers['Content-Security-Policy'] = CSP;
  if (req.headers['if-none-match'] === etag) return send(res, 304, null, headers);
  send(res, 200, req.method === 'HEAD' ? null : buf, headers);
}

function readBody(req, max = 1_100_000) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > max) { reject(Object.assign(new Error('too big'), { status: 413 })); req.destroy(); } else chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { reject(Object.assign(new Error('bad json'), { status: 400 })); }
    });
    req.on('error', reject);
  });
}

function cookies(req) {
  const out = {};
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

const isHttps = (req) => Boolean(req.headers['cf-ray']) || req.headers['x-forwarded-proto'] === 'https';
const loopback = (req) => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress);
const clientIp = (req) => (loopback(req) && req.headers['cf-connecting-ip']) || req.socket.remoteAddress;
const sessionCookie = (req, token, days) => `${COOKIE}=${token}; Path=${COOKIE_PATH}; Max-Age=${Math.round(days * 86400)}; HttpOnly; SameSite=Lax`
  + (isHttps(req) ? '; Secure' : '');

function currentUser(req) {
  const token = cookies(req)[COOKIE];
  if (!token) return null;
  const s = st.sessions[S.sha(token)];
  const a = s && st.accounts[s.user];
  if (!a || (a.pwv || 0) !== (s.pwv || 0)) return null;
  return { name: s.user, token, session: s, account: a };
}

// A device proves itself with the secret it got when it registered: "X-Kavana-Device: id.secret".
function currentDevice(req) {
  const [id, secret] = String(req.headers['x-kavana-device'] || '').split('.');
  const d = id && st.devices[id];
  if (!d || !secret || d.secret !== S.sha(secret)) return null;
  d.seen = Date.now();
  return { id, d };
}

// ---------- rate limits (in memory) ----------
const buckets = new Map();
function limited(key, max, windowMs) {
  const now = Date.now();
  const list = (buckets.get(key) || []).filter((t) => now - t < windowMs);
  buckets.set(key, list);
  if (buckets.size > 20000) buckets.clear();
  return list.length >= max;
}
const hit = (key) => { buckets.set(key, [...(buckets.get(key) || []), Date.now()]); };

// ---------- push ----------
// Who gets a ping: "a:<name>" = every device signed in to that account, "d:<id>" = one device.
const devicesOf = (owner) => (owner.startsWith('a:')
  ? Object.entries(st.devices).filter(([, d]) => d.owner === owner.slice(2))
  : Object.entries(st.devices).filter(([id, d]) => id === owner.slice(2) && !d.owner));

async function notify(owner, payload) {
  const results = await Promise.all(devicesOf(owner).map(async ([id, d]) => {
    try {
      const r = await push.send(d, payload, sign);
      if (r.gone) { delete st.devices[id]; delete st.pings[`d:${id}`]; delete st.daily[`d:${id}`]; save(); }
      if (!r.ok) console.log(`push ${payload.kind} -> ${new URL(d.endpoint).hostname}: ${r.status} ${r.text}`);
      return r;
    } catch (e) {
      console.log(`push ${payload.kind} -> ${new URL(d.endpoint).hostname}: ${e.message}`);
      return { ok: false };
    }
  }));
  count(null, `push.${payload.kind}`, results.filter((r) => r.ok).length);
  return { sent: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length };
}

// Pings from a browser (no account): checked and trimmed, kept only until they're sent.
const KINDS = ['checkin', 'nudge', 'end', 'break-over'];
function cleanPings(list, now) {
  return (Array.isArray(list) ? list : []).filter((p) => p && KINDS.includes(p.kind) && p.at > now - MIN && p.at < now + 8 * 60 * MIN)
    .slice(0, LIMITS.pings).map((p) => {
      const o = { at: Math.round(p.at), kind: p.kind, tag: E.clean(p.tag, 60) || 'kavana', title: E.clean(p.title, 200), body: E.clean(p.body, 240) };
      if (p.block) o.block = E.clean(p.block, 20);
      if (p.n) o.n = Number(p.n) || 0;
      if (p.kind === 'checkin') o.actions = [{ action: 'yes', title: 'Yes' }, { action: 'drifted', title: 'Drifted' }];
      if (p.cat) o.cat = 1;
      return o;
    });
}
function cleanDaily(d) {
  if (!d || !/^([01]\d|2[0-3]):[0-5]\d$/.test(String(d.time)) || typeof d.tz !== 'string') return null;
  try { new Intl.DateTimeFormat('en-US', { timeZone: d.tz }); } catch { return null; }
  const days = [...new Set((Array.isArray(d.days) ? d.days : []).map(Number))].filter((x) => x >= 0 && x <= 6);
  return { on: Boolean(d.on), time: d.time, days, tz: d.tz, body: E.clean(d.body, 240) || 'Pick one thing and start a block.', cat: d.cat !== false };
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
function localParts(t, tz) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23', weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }).formatToParts(t).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, day: DAYS.indexOf(p.weekday), minutes: Number(p.hour) * 60 + Number(p.minute) };
}

function tick() {
  const now = Date.now();
  for (const [owner, list] of Object.entries(st.pings)) {
    const due = list.filter((p) => p.at <= now);
    if (!due.length) continue;
    st.pings[owner] = list.filter((p) => p.at > now);
    if (!st.pings[owner].length) delete st.pings[owner];
    save();
    // Only the newest of a bunch that came due together (the server may have been down), and never a stale one.
    const fresh = due.filter((p) => now - p.at < 5 * MIN);
    if (fresh.length) { const { at, ...payload } = fresh[fresh.length - 1]; notify(owner, payload); }
  }
  for (const [owner, d] of Object.entries(st.daily)) {
    if (!d.on || !d.tz) continue;
    let t;
    try { t = localParts(now, d.tz); } catch { continue; }
    const [h, m] = d.time.split(':').map(Number);
    if (!d.days.includes(t.day) || d.sent === t.date) continue;
    if (t.minutes >= h * 60 + m && t.minutes < h * 60 + m + 15) {
      d.sent = t.date;
      save();
      const busy = (st.pings[owner] || []).some((p) => p.kind === 'end' || p.kind === 'break-over'); // in a block or a break
      if (!busy) notify(owner, { kind: 'daily', tag: 'kavana-daily', title: `${d.cat ? '🐱 Boo! ' : ''}Time to focus?`, body: d.body, cat: d.cat ? 1 : undefined });
    }
  }
}
setInterval(tick, Math.min(10000, MIN / 4)).unref();
setInterval(napTick, Math.min(2000, NAP_GRACE / 3)).unref();

// After an account's doc changes: its pings, its daily reminder, and a heads-up to friends.
function afterSync(name, prevRunning) {
  const { doc } = docOf(name);
  rankCache.at = 0; // the rankings are worked out again on the next look
  const now = Date.now();
  E.tick(doc, now);
  const pings = E.pings(doc, now).slice(0, LIMITS.pings);
  if (pings.length) st.pings[`a:${name}`] = pings; else delete st.pings[`a:${name}`];
  const daily = cleanDaily(E.daily(doc));
  const prev = st.daily[`a:${name}`];
  if (daily) st.daily[`a:${name}`] = { ...daily, sent: prev && prev.time === daily.time ? prev.sent : undefined };
  else delete st.daily[`a:${name}`];
  save();
  const run = E.running(doc);
  if (run && !run.paused && run.id !== prevRunning && now - run.start < 5 * MIN) friendStarted(name, run);
  napSynced(name, doc);
}

// ---------- friends ----------
const friendsOf = (name) => (st.accounts[name] && st.accounts[name].friends || []).filter((f) => st.accounts[f]);

function friendStarted(name, block) {
  const mine = docOf(name).doc;
  if (mine.settings.share === 'off') return;
  for (const f of friendsOf(name)) {
    const fd = docOf(f).doc;
    E.tick(fd, Date.now()); // their doc is as of their last sync; bring it up to now
    if (fd.settings.share === 'off' || !fd.settings.friendPings) continue;
    const theirs = E.running(fd);
    if (theirs && !theirs.paused) continue; // never break someone's focus
    const key = `friendping:${name}>${f}`;
    if (limited(key, 1, 30 * MIN)) continue;
    hit(key);
    const left = Math.max(1, Math.round((block.end - Date.now()) / MIN));
    notify(`a:${f}`, {
      kind: 'friend', tag: `kavana-friend-${name}`, friend: name,
      title: `${display(name)} started focusing`,
      body: `${mine.settings.share === 'all' && block.intention ? `${block.intention}. ` : ''}${block.mode === 'stopwatch' ? 'On a stopwatch.' : `${left} min. Join them?`}`,
    });
  }
}

function friendsView(name) {
  const mine = docOf(name).doc;
  const sharing = mine.settings.share !== 'off';
  const now = Date.now();
  return {
    code: st.accounts[name].code,
    sharing,
    friends: friendsOf(name).map((f) => {
      const fd = docOf(f).doc;
      E.tick(fd, now); // as of their last sync; bring it up to now so an ended block isn't "focusing"
      const p = sharing ? E.presence(fd, now) : null;
      return { name: f, display: display(f), ...(p || { status: sharing ? 'hidden' : 'unknown' }) };
    }),
  };
}

// ---------- napping together ----------
// Friends' kittens grow in one ring: you join a friend's block (it ends when theirs does), and if
// anyone leaves Chataltul for longer than the grace or stops, every kitten in the group wanders off.
// The group lives here, in st.naps[id] (id = the first block's id). Pages tell it when they leave and
// come back; their synced docs tell it about a stop. Each page asks for its group and sends its own
// kitten off when the group breaks (E.napGone), so the server never edits anyone's doc.
const napOf = (name, block) => Object.entries(st.naps).find(([, g]) => g.members[name] && g.members[name].block === block);

function napBreak(id, g, by, at, why) {
  if (g.broken) return;
  g.broken = { by, at: Math.round(at), why };
  save();
  count(null, `nap.broken.${why}`);
}

function napView(id, g, name) {
  const members = Object.entries(g.members).sort(([a], [b]) => (a === g.host ? -1 : b === g.host ? 1 : g.members[a].joined - g.members[b].joined));
  return {
    id, end: g.end, host: g.host === name,
    members: members.map(([n, m]) => ({ name: n, display: display(n), cat: m.cat, start: m.start, me: n === name, away: Boolean(m.left) })),
    broken: g.broken ? { by: display(g.broken.by), me: g.broken.by === name, at: g.broken.at, why: g.broken.why } : null,
  };
}

// Someone left and didn't come back in time; groups long over are dropped.
function napTick() {
  const now = Date.now();
  for (const [id, g] of Object.entries(st.naps)) {
    if (now > g.end + 12 * 60 * MIN) { delete st.naps[id]; save(); continue; }
    if (g.broken || now >= g.end) continue;
    for (const [n, m] of Object.entries(g.members)) if (m.left && now - m.left > NAP_GRACE) { napBreak(id, g, n, m.left + NAP_GRACE, 'away'); break; }
  }
}

// A synced doc: did this member stop, or did their kitten wander off on its own?
function napSynced(name, doc) {
  for (const [id, g] of Object.entries(st.naps)) {
    const m = g.members[name];
    if (!m || g.broken) continue;
    const b = doc.blocks.find((x) => x.id === m.block);
    if (!b) continue;
    if (b.gone && b.goneWhy !== 'nap' && b.gone < g.end) napBreak(id, g, name, b.gone, b.goneWhy === 'away' ? 'away' : 'stop');
    else if (b.paused && b.paused < g.end) napBreak(id, g, name, b.paused, 'stop');
  }
}

// Rooms: a group can also be joined with a code, by anyone with an account (no need to be friends).
const ROOM_LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
function roomCode() {
  for (;;) {
    const c = Array.from(crypto.randomBytes(6), (x) => ROOM_LETTERS[x % ROOM_LETTERS.length]).join('');
    if (!Object.values(st.naps).some((g) => g.code === c)) return c;
  }
}
const roomOf = (code) => Object.entries(st.naps).find(([, g]) => g.code && g.code === code);

// ---------- rankings ----------
// A round is a UTC week (E.round). Friends: you and the friends who joined the rankings. Worldwide:
// everyone who also chose to be in it, under the nickname they picked. Minutes of kittens that came
// home, nothing else. Worked out at most once a minute.
let rankCache = { at: 0, from: 0, rows: [] };
function rankRows(now) {
  const round = E.round(now);
  if (now - rankCache.at < MIN && rankCache.from === round.from) return rankCache;
  const rows = [];
  for (const n of Object.keys(st.accounts)) {
    const doc = docOf(n).doc;
    const r = doc.settings.rank || {};
    if (!r.on) continue;
    rows.push({ account: n, display: display(n), nick: r.global ? r.name : null, ...E.ranked(doc, round.from, round.to) });
  }
  rows.sort((a, b) => b.minutes - a.minutes || b.kittens - a.kittens);
  rankCache = { at: now, from: round.from, round, rows };
  return rankCache;
}
function rankingsView(name, now) {
  const { round, rows } = rankRows(now);
  const mine = docOf(name).doc;
  const on = Boolean(mine.settings.rank && mine.settings.rank.on);
  const meNow = { display: display(name), ...E.ranked(mine, round.from, round.to), me: true };
  const friends = friendsOf(name);
  const fr = rows.filter((r) => friends.includes(r.account)).map((r) => ({ display: r.display, minutes: r.minutes, kittens: r.kittens }));
  if (on) fr.push(meNow);
  fr.sort((a, b) => b.minutes - a.minutes || b.kittens - a.kittens);
  const world = rows.filter((r) => r.nick);
  const mineAt = world.findIndex((r) => r.account === name);
  return {
    round: { from: round.from, to: round.to }, on, global: Boolean(on && mine.settings.rank.global),
    me: meNow,
    friends: fr.map((r, i) => ({ rank: i + 1, ...r })),
    world: world.slice(0, 50).map((r, i) => ({ rank: i + 1, name: r.nick, minutes: r.minutes, kittens: r.kittens, me: r.account === name })),
    worldMe: mineAt >= 50 ? { rank: mineAt + 1, name: world[mineAt].nick, minutes: world[mineAt].minutes, kittens: world[mineAt].kittens, me: true } : null,
    players: world.length,
  };
}

// ---------- analytics: counts per day, never content ----------
const AN_FILE = 'analytics.json';
const an = S.readJSON(AN_FILE, { days: {} });
let anTimer = null;
const anSave = () => { if (!anTimer) anTimer = setTimeout(() => { anTimer = null; S.writeJSON(AN_FILE, an); }, 15000); };
const EVENTS = new Set(['open', 'start', 'end', 'stop', 'checkin', 'why', 'pause', 'resume', 'park', 'later_add', 'later_done',
  'extend', 'break_start', 'break_end', 'breathe', 'sound', 'awake', 'face', 'goal', 'daily', 'push_on', 'push_denied',
  'install_hint', 'signup', 'login', 'logout', 'account_delete', 'friend_add', 'share', 'join', 'history', 'clear', 'settings',
  'later', 'cat', 'chime', 'welcome', 'analytics_off', 'cat_met', 'companion', 'cafe', 'shop', 'buy', 'adopt', 'away', 'tags',
  'missions', 'mission', 'nap', 'nap_gone', 'cancel', 'claim', 'rankings', 'rank', 'sponsor', 'shelter', 'theme', 'news',
  'room', 'edit', 'note', 'achievements', 'share_cafe', 'lines', 'pausing', 'overtime', 'mindful', 'email', 'password']);
const today = () => new Date().toISOString().slice(0, 10);
function dayRec(day) {
  if (!an.days[day]) {
    an.days[day] = { i: {}, c: {} };
    const keep = Object.keys(an.days).sort().slice(-120);
    for (const k of Object.keys(an.days)) if (!keep.includes(k)) delete an.days[k];
  }
  return an.days[day];
}
function count(install, key, n = 1) {
  const d = dayRec(today());
  if (install) d.i[install] = 1;
  if (n) d.c[key] = (d.c[key] || 0) + n;
  anSave();
}
function track(install, e, p) {
  if (!EVENTS.has(e)) return;
  count(install, e);
  for (const [k, v] of Object.entries(p && typeof p === 'object' ? p : {}).slice(0, 6)) {
    if (!/^[a-z]{1,12}$/.test(k)) continue;
    if (k === 'min' && Number.isFinite(v)) count(install, `${e}.min`, Math.max(0, Math.min(240, Math.round(v))));
    else if (typeof v === 'string' && /^[a-z0-9_-]{1,20}$/.test(v)) count(install, `${e}.${k}=${v}`);
    else if (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 999) count(install, `${e}.${k}=${v}`);
  }
}

function analyticsView() {
  const days = Object.keys(an.days).sort().slice(-60);
  const seen = {}; // install -> distinct days, over the last 30
  for (const d of days.slice(-30)) for (const id of Object.keys(an.days[d].i)) seen[id] = (seen[id] || 0) + 1;
  const ids = Object.keys(seen);
  return {
    days: days.map((d) => ({ date: d, installs: Object.keys(an.days[d].i).length, c: an.days[d].c })),
    month: { installs: ids.length, returning: ids.filter((id) => seen[id] > 1).length },
    totals: {
      accounts: Object.keys(st.accounts).length,
      devices: Object.keys(st.devices).length,
      anonDevices: Object.values(st.devices).filter((d) => !d.owner).length,
      sharing: Object.keys(st.accounts).filter((n) => docOf(n).doc.settings.share !== 'off').length,
      friendships: Object.values(st.accounts).reduce((n, a) => n + (a.friends || []).length, 0) / 2,
    },
  };
}

// ---------- accounts ----------
function newSession(req, name, via) {
  const token = crypto.randomBytes(32).toString('base64url');
  st.sessions[S.sha(token)] = { user: name, pwv: st.accounts[name].pwv || 0, created: Date.now(), ...(via ? { via } : {}) };
  // A device that signs in now gets the account's pings instead of its own.
  const dev = currentDevice(req);
  if (dev) { dev.d.owner = name; delete st.pings[`d:${dev.id}`]; delete st.daily[`d:${dev.id}`]; }
  save();
  return { 'Set-Cookie': sessionCookie(req, token, COOKIE_DAYS) };
}

function removeAccount(name) {
  delete st.accounts[name];
  for (const [k, s] of Object.entries(st.sessions)) if (s.user === name) delete st.sessions[k];
  for (const d of Object.values(st.devices)) if (d.owner === name) d.owner = null;
  for (const a of Object.values(st.accounts)) a.friends = (a.friends || []).filter((f) => f !== name);
  delete st.pings[`a:${name}`];
  delete st.daily[`a:${name}`];
  delete st.docs[name];
  docs.delete(name);
  S.dropDoc(name);
  save();
}

const me = (name) => {
  const a = st.accounts[name];
  return { name, display: display(name), admin: Boolean(a.admin), email: a.email || null, password: Boolean(a.hash) };
};

// ---------- emailed codes: six digits, ten minutes, five tries, kept in memory only ----------
// kind 'in' signs in (or makes the account), 'add' puts an address on a signed-in account,
// 'confirm' stands in for the password when an account without one is deleted.
const codes = new Map(); // `${kind}:${email}` -> { hash, exp, tries, user }
const emailOwner = (email) => Object.keys(st.accounts).find((n) => st.accounts[n].email === email) || null;
const SUBJECTS = { in: 'signing in to Chataltul', add: 'adding this address to your Chataltul account', confirm: 'deleting your Chataltul account' };

async function sendCode(kind, email, user, ip) {
  if (limited(`code:${ip}`, 6, 60 * MIN) || limited(`code:${email}`, 3, 15 * MIN) || limited(`codeday:${email}`, 8, DAY)
    || limited('code', 100, 60 * MIN) || limited('codeday', 500, DAY)) return 'throttled';
  for (const k of [`code:${ip}`, `code:${email}`, `codeday:${email}`, 'code', 'codeday']) hit(k);
  if (codes.size > 5000) for (const [k, c] of codes) if (c.exp < Date.now()) codes.delete(k);
  const code = String(crypto.randomInt(1000000)).padStart(6, '0');
  codes.set(`${kind}:${email}`, { hash: S.sha(`${email}:${code}`), exp: Date.now() + CODE_MS, tries: 0, user });
  const text = `Hi,\n\nYour code for ${SUBJECTS[kind]} is:\n\n    ${code.slice(0, 3)} ${code.slice(3)}\n\n`
    + "It works for 10 minutes. If you didn't ask for it, you can ignore this email: nobody gets in without the code.\n\n"
    + `Chataltul\n${PUBLIC_URL}\n`;
  try { await mail.send(email, `${code} is your Chataltul code`, text); } catch (e) {
    console.log(`mail to ${email.split('@')[1]}: ${e.message}`);
    codes.delete(`${kind}:${email}`);
    return 'mail';
  }
  return null;
}

function takeCode(kind, email, code, user) {
  const key = `${kind}:${email}`;
  const c = codes.get(key);
  if (!c || c.exp < Date.now() || (user && c.user !== user)) return false;
  if (c.hash !== S.sha(`${email}:${String(code || '').replace(/\D/g, '')}`)) {
    if (++c.tries >= 5) codes.delete(key);
    return false;
  }
  codes.delete(key);
  return true;
}

// An account made from an email gets a name from the part before the @ (friends see it until you
// pick a display name), with a number on the end if it's taken.
function nameFor(email) {
  let base = email.split('@')[0].replace(/\+.*$/, '').replace(/[^a-z0-9._-]/g, '').replace(/^[._-]+/, '').slice(0, 20);
  if (base.length < 2) base = 'cat';
  let name = base;
  for (let i = 2; st.accounts[name] || !S.validName(name); i++) name = `${base}${i}`;
  return name;
}


// ---------- routes ----------
async function api(req, res, route) {
  if (req.method !== 'GET') {
    const ct = String(req.headers['content-type'] || '');
    if (!ct.startsWith('application/json')) return json(res, 415, { error: 'json only' });
    const origin = req.headers.origin;
    let sameOrigin = true;
    if (origin) { try { sameOrigin = new URL(origin).host === req.headers.host; } catch { sameOrigin = false; } }
    if (!sameOrigin) return json(res, 403, { error: 'bad origin' });
  }
  const body = req.method === 'GET' ? {} : await readBody(req);
  const ip = clientIp(req);
  const now = Date.now();

  // --- open to everyone ---
  switch (route) {
    case 'GET /api/config':
      return json(res, 200, { vapidKey: VAPID.publicKey, email: mail.on });

    case 'POST /api/devices': { // turn on reminders: register (or refresh) this browser's push subscription
      if (!push.endpointAllowed(body.endpoint) || !body.keys || !push.validKeys(body.keys)) return json(res, 400, { error: 'subscription' });
      const user = currentUser(req);
      let dev = currentDevice(req);
      let secret = null;
      if (!dev) {
        if (limited(`dev:${ip}`, 20, 60 * MIN)) return json(res, 429, { error: 'throttled' });
        hit(`dev:${ip}`);
        if (Object.keys(st.devices).length >= LIMITS.devices) return json(res, 503, { error: 'full' });
        // The same browser subscribing again replaces its old record.
        for (const [id, d] of Object.entries(st.devices)) if (d.endpoint === body.endpoint) delete st.devices[id];
        const id = crypto.randomBytes(9).toString('base64url');
        secret = crypto.randomBytes(24).toString('base64url');
        st.devices[id] = { secret: S.sha(secret), created: now };
        dev = { id, d: st.devices[id] };
      }
      Object.assign(dev.d, { endpoint: body.endpoint, keys: { p256dh: body.keys.p256dh, auth: body.keys.auth }, owner: user ? user.name : null, seen: now });
      save();
      return json(res, 200, { id: dev.id, secret, owner: dev.d.owner });
    }

    case 'POST /api/devices/forget': {
      const dev = currentDevice(req);
      if (dev) { delete st.devices[dev.id]; delete st.pings[`d:${dev.id}`]; delete st.daily[`d:${dev.id}`]; save(); }
      return json(res, 200, { ok: true });
    }

    case 'POST /api/pings': { // a browser without an account hands over its next pings
      const dev = currentDevice(req);
      if (!dev) return json(res, 401, { error: 'device' });
      if (dev.d.owner) return json(res, 200, { ok: true, owner: dev.d.owner }); // accounts: worked out from the synced doc
      const pings = cleanPings(body.pings, now);
      if (pings.length) st.pings[`d:${dev.id}`] = pings; else delete st.pings[`d:${dev.id}`];
      const daily = cleanDaily(body.daily);
      const prev = st.daily[`d:${dev.id}`];
      if (daily) st.daily[`d:${dev.id}`] = { ...daily, sent: prev && prev.time === daily.time ? prev.sent : undefined };
      else delete st.daily[`d:${dev.id}`];
      save();
      return json(res, 200, { ok: true });
    }

    case 'POST /api/push/test': {
      const dev = currentDevice(req);
      if (!dev) return json(res, 401, { error: 'device' });
      if (limited(`test:${dev.id}`, 10, 60 * MIN)) return json(res, 429, { error: 'throttled' });
      hit(`test:${dev.id}`);
      const r = await push.send(dev.d, { kind: 'test', tag: 'kavana-test', title: 'Chataltul', body: 'Reminders are working.' }, sign).catch(() => ({ ok: false }));
      return json(res, 200, { sent: r.ok ? 1 : 0 });
    }

    case 'POST /api/events': {
      if (limited(`ev:${ip}`, 120, 60 * MIN)) return json(res, 429, { error: 'throttled' });
      hit(`ev:${ip}`);
      const install = /^[a-z0-9]{8,32}$/.test(String(body.install)) ? body.install : null;
      if (!install) return json(res, 400, { error: 'install' });
      for (const ev of (Array.isArray(body.events) ? body.events : []).slice(0, 50)) if (ev && typeof ev.e === 'string') track(install, ev.e, ev.p);
      return json(res, 200, { ok: true });
    }

    // The shelter cats everyone sponsored (a count, nothing else; anyone may add theirs).
    case 'GET /api/shelter': {
      const user = currentUser(req);
      const friends = user ? friendsOf(user.name).reduce((n, f) => n + docOf(f).doc.owned.filter((x) => E.SHELTER.includes(x.id)).length, 0) : null;
      return json(res, 200, { everyone: st.shelter.total, friends });
    }
    case 'POST /api/sponsor': {
      if (limited(`sponsor:${ip}`, 4, DAY)) return json(res, 429, { error: 'throttled' });
      hit(`sponsor:${ip}`);
      st.shelter.total += 1;
      save();
      return json(res, 200, { everyone: st.shelter.total });
    }

    case 'POST /api/signup': {
      if (limited(`signup:${ip}`, 3, 60 * MIN) || limited('signup', 30, DAY)) return json(res, 429, { error: 'throttled' });
      const name = S.cleanName(body.name);
      const pw = String(body.password || '');
      if (!S.validName(name)) return json(res, 400, { error: 'name' });
      if (pw.length < 8 || pw.length > 200) return json(res, 400, { error: 'password' });
      if (st.accounts[name]) return json(res, 409, { error: 'taken' });
      if (Object.keys(st.accounts).length >= LIMITS.accounts) return json(res, 503, { error: 'full' });
      hit(`signup:${ip}`); hit('signup');
      st.accounts[name] = { ...S.hashPassword(pw), created: now, pwv: 0, code: S.friendCode(), friends: [] };
      count(null, 'server.signup');
      return json(res, 200, me(name), newSession(req, name));
    }

    case 'POST /api/login': { // a name or an email, and the password
      if (limited(`login:${ip}`, 5, 15 * MIN) || limited('login', 20, 60 * MIN)) return json(res, 429, { error: 'throttled' });
      const given = S.cleanName(body.name);
      const name = given.includes('@') ? emailOwner(M.cleanEmail(given)) : given;
      const a = name && st.accounts[name];
      if (!a || !a.hash || !S.checkPassword(a, String(body.password || '').trim())) { hit(`login:${ip}`); hit('login'); return json(res, 401, { error: 'wrong' }); }
      return json(res, 200, me(name), newSession(req, name));
    }

    case 'POST /api/email/code': { // send a sign-in code; the same code makes an account if there isn't one
      if (!mail.on) return json(res, 404, { error: 'no email' });
      const email = M.cleanEmail(body.email);
      if (!M.validEmail(email)) return json(res, 400, { error: 'email' });
      const err = await sendCode('in', email, null, ip);
      if (err) return json(res, err === 'throttled' ? 429 : 502, { error: err });
      return json(res, 200, { ok: true });
    }

    case 'POST /api/email/signin': {
      if (limited(`codebad:${ip}`, 20, 60 * MIN)) return json(res, 429, { error: 'throttled' });
      const email = M.cleanEmail(body.email);
      if (!takeCode('in', email, body.code)) { hit(`codebad:${ip}`); return json(res, 401, { error: 'wrong' }); }
      let name = emailOwner(email);
      const created = !name;
      if (created) {
        if (Object.keys(st.accounts).length >= LIMITS.accounts) return json(res, 503, { error: 'full' });
        name = nameFor(email);
        st.accounts[name] = { created: now, pwv: 0, code: S.friendCode(), friends: [], email };
        count(null, 'server.signup');
      }
      return json(res, 200, { ...me(name), created }, newSession(req, name, 'email'));
    }
  }

  // --- signed in ---
  const user = currentUser(req);
  if (!user) return json(res, 401, { error: 'signed out' });
  const name = user.name;

  switch (route) {
    case 'GET /api/me': {
      const headers = {};
      if (now - (user.session.renewed || user.session.created) > DAY) { // slide the sign-in forward once a day
        user.session.renewed = now;
        save();
        headers['Set-Cookie'] = sessionCookie(req, user.token, COOKIE_DAYS);
      }
      return json(res, 200, me(name), headers);
    }

    case 'POST /api/logout': {
      delete st.sessions[S.sha(user.token)];
      const dev = currentDevice(req);
      if (dev && dev.d.owner === name) dev.d.owner = null;
      save();
      return json(res, 200, { ok: true }, { 'Set-Cookie': sessionCookie(req, '', 0) });
    }

    case 'GET /api/sync': { // ?rev=N: nothing new is a 204
      const d = docOf(name);
      const rev = Number(new URL(req.url, 'http://x').searchParams.get('rev'));
      if (rev === d.rev) return json(res, 204, null);
      return json(res, 200, { rev: d.rev, doc: d.doc });
    }

    case 'POST /api/sync': { // the browser's copy; on a revision mismatch it gets ours back to merge
      const d = docOf(name);
      if (Number(body.rev) !== d.rev) return json(res, 409, { rev: d.rev, doc: d.doc });
      const doc = E.normalize(body.doc);
      if (JSON.stringify(doc).length > LIMITS.docBytes) return json(res, 413, { error: 'too big' });
      const prevRunning = (E.running(d.doc) || {}).id;
      d.doc = doc;
      d.rev += 1;
      st.docs[name] = d.rev;
      S.saveDoc(name, { rev: d.rev, doc });
      afterSync(name, prevRunning);
      return json(res, 200, { rev: d.rev });
    }

    // Email and password on the account page.
    case 'POST /api/account/email': { // send a code to the new address; it's set once the code comes back
      if (!mail.on) return json(res, 404, { error: 'no email' });
      const email = M.cleanEmail(body.email);
      if (!M.validEmail(email)) return json(res, 400, { error: 'email' });
      const owner = emailOwner(email);
      if (owner === name) return json(res, 200, me(name));
      if (owner) return json(res, 409, { error: 'taken' });
      const err = await sendCode('add', email, name, ip);
      if (err) return json(res, err === 'throttled' ? 429 : 502, { error: err });
      return json(res, 200, { ok: true, sent: email });
    }
    case 'POST /api/account/email/confirm': {
      if (limited(`codebad:${ip}`, 20, 60 * MIN)) return json(res, 429, { error: 'throttled' });
      const email = M.cleanEmail(body.email);
      if (!takeCode('add', email, body.code, name)) { hit(`codebad:${ip}`); return json(res, 401, { error: 'wrong' }); }
      const owner = emailOwner(email);
      if (owner && owner !== name) return json(res, 409, { error: 'taken' });
      user.account.email = email;
      save();
      return json(res, 200, me(name));
    }

    // Set a password (or change it: that signs out your other devices). Changing it needs the old
    // one, or a sign-in by email in the last 15 minutes ("forgot my password").
    case 'POST /api/account/password': {
      const pw = String(body.password || '');
      if (pw.length < 8 || pw.length > 200) return json(res, 400, { error: 'password' });
      const a = user.account;
      const fresh = user.session.via === 'email' && now - user.session.created < 15 * 60000;
      if (a.hash && !fresh) {
        if (limited(`pw:${name}`, 5, 15 * MIN)) return json(res, 429, { error: 'throttled' });
        if (!S.checkPassword(a, String(body.current || '').trim())) { hit(`pw:${name}`); return json(res, 401, { error: 'wrong' }); }
      }
      const had = Boolean(a.hash);
      Object.assign(a, S.hashPassword(pw));
      if (had) { a.pwv = (a.pwv || 0) + 1; user.session.pwv = a.pwv; }
      save();
      return json(res, 200, me(name));
    }

    case 'POST /api/account/code': { // an account without a password confirms things with an emailed code
      if (!user.account.email || !mail.on) return json(res, 404, { error: 'no email' });
      const err = await sendCode('confirm', user.account.email, name, ip);
      if (err) return json(res, err === 'throttled' ? 429 : 502, { error: err });
      return json(res, 200, { ok: true, sent: user.account.email });
    }

    case 'POST /api/account/delete': { // the password, or (no password) an emailed code
      const a = user.account;
      const ok = body.password ? Boolean(a.hash) && S.checkPassword(a, String(body.password))
        : Boolean(a.email) && takeCode('confirm', a.email, body.code, name);
      if (!ok) return json(res, 401, { error: 'wrong' });
      removeAccount(name);
      count(null, 'server.account_delete');
      return json(res, 200, { ok: true }, { 'Set-Cookie': sessionCookie(req, '', 0) });
    }

    case 'GET /api/friends':
      return json(res, 200, friendsView(name));

    case 'POST /api/friends/add': {
      if (limited(`fadd:${name}`, 10, 60 * MIN)) return json(res, 429, { error: 'throttled' });
      hit(`fadd:${name}`);
      const code = String(body.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
      const other = Object.keys(st.accounts).find((n) => st.accounts[n].code === code);
      if (!other) return json(res, 404, { error: 'code' });
      if (other === name) return json(res, 400, { error: 'self' });
      for (const [a, b] of [[name, other], [other, name]]) {
        const list = st.accounts[a].friends || (st.accounts[a].friends = []);
        if (!list.includes(b)) { if (list.length >= LIMITS.friends) return json(res, 400, { error: 'too many' }); list.push(b); }
      }
      save();
      return json(res, 200, friendsView(name));
    }

    case 'POST /api/friends/remove': {
      const other = S.cleanName(body.name);
      for (const [a, b] of [[name, other], [other, name]]) if (st.accounts[a]) st.accounts[a].friends = (st.accounts[a].friends || []).filter((f) => f !== b);
      save();
      return json(res, 200, friendsView(name));
    }

    case 'GET /api/rankings':
      return json(res, 200, rankingsView(name, now));

    // --- rooms: start a group anyone with the code can join ---
    case 'POST /api/nap/room': {
      const block = String(body.block || '');
      const doc = docOf(name).doc;
      E.tick(doc, now);
      const b = E.running(doc);
      if (!b || b.id !== block || b.paused || !b.cat || b.gone || b.mode === 'stopwatch' || b.end - now < 3 * MIN) return json(res, 404, { error: 'block' });
      let found = napOf(name, block);
      if (!found) {
        const id = b.nap || b.id;
        if (!st.naps[id]) st.naps[id] = { host: name, end: b.end, created: now, broken: null, members: { [name]: { block: b.id, cat: b.cat, start: b.start, joined: now } } };
        found = [id, st.naps[id]];
      }
      const [id, g] = found;
      if (g.broken) return json(res, 409, { error: 'broken' });
      if (!g.code) { g.code = roomCode(); save(); count(null, 'nap.room'); }
      return json(res, 200, { code: g.code, ...napView(id, g, name) });
    }
    case 'GET /api/nap/room': { // ?code=XXXXXX: what joining would mean
      if (limited(`room:${name}`, 20, 60 * MIN)) return json(res, 429, { error: 'throttled' });
      hit(`room:${name}`);
      const code = String(new URL(req.url, 'http://x').searchParams.get('code') || '').toUpperCase().replace(/[^A-Z]/g, '');
      const found = code.length === 6 && roomOf(code);
      if (!found) return json(res, 404, { error: 'code' });
      const [id, g] = found;
      if (g.broken) return json(res, 409, { error: 'broken' });
      if (now > g.end - 2 * MIN) return json(res, 409, { error: 'ended' });
      return json(res, 200, { id, end: g.end, host: display(g.host), members: Object.keys(g.members).length, full: Object.keys(g.members).length >= LIMITS.napping });
    }

    // --- napping together ---
    case 'POST /api/nap/join': { // I started a block that ends with a friend's: put it in their group
      const id = String(body.id || '');
      const block = String(body.block || '');
      if (!/^[a-z0-9]{6,20}$/.test(id) || !/^[a-z0-9]{6,20}$/.test(block)) return json(res, 400, { error: 'nap' });
      let g = st.naps[id];
      if (!g) { // the first one to join: the group starts from the friend's running block
        const host = friendsOf(name).find((f) => { const fb = E.running(docOf(f).doc); return fb && fb.id === id; });
        const fd = host && docOf(host).doc;
        if (fd) E.tick(fd, now);
        const fb = fd && E.running(fd);
        if (!fb || fb.id !== id || fb.paused || !fb.cat || fb.gone || fd.settings.share === 'off') return json(res, 404, { error: 'nap' });
        g = st.naps[id] = { host, end: fb.end, created: now, broken: null, members: { [host]: { block: fb.id, cat: fb.cat, start: fb.start, joined: now } } };
      }
      if (g.broken) return json(res, 409, { error: 'broken', nap: napView(id, g, name) });
      if (now > g.end - MIN) return json(res, 409, { error: 'ended' });
      const byCode = g.code && String(body.code || '').toUpperCase() === g.code;
      if (!g.members[name] && !byCode && !Object.keys(g.members).some((n) => friendsOf(name).includes(n))) return json(res, 403, { error: 'friends' });
      if (!g.members[name] && Object.keys(g.members).length >= LIMITS.napping) return json(res, 409, { error: 'full' });
      if (g.members[name] && g.members[name].block !== block) { // left the group's block for a new one: that's a stop
        napBreak(id, g, name, now, 'stop');
        return json(res, 409, { error: 'broken', nap: napView(id, g, name) });
      }
      g.members[name] = { block, cat: /^[a-z]{2,12}$/.test(body.cat) ? body.cat : 'miso', start: Number(body.start) || now, joined: now, left: null };
      save();
      count(null, 'nap.join');
      return json(res, 200, napView(id, g, name));
    }

    case 'GET /api/nap': { // ?block=<my block>: the group it's in, if any
      const block = new URL(req.url, 'http://x').searchParams.get('block');
      const found = napOf(name, block);
      if (!found) return json(res, 204, null);
      return json(res, 200, napView(found[0], found[1], name));
    }

    case 'POST /api/nap/left': // the page went to the background (or closed) in the middle of a group block
    case 'POST /api/nap/back': {
      const found = napOf(name, String(body.block || ''));
      if (!found) return json(res, 200, { ok: true });
      const [id, g] = found;
      const m = g.members[name];
      if (route.endsWith('left')) { if (!m.left && !g.broken && now < g.end) { m.left = now; save(); } }
      else if (m.left) {
        if (now - m.left > NAP_GRACE && m.left + NAP_GRACE < g.end) napBreak(id, g, name, m.left + NAP_GRACE, 'away');
        m.left = null;
        save();
      }
      return json(res, 200, napView(id, g, name));
    }

    case 'GET /api/admin/analytics':
      if (!user.account.admin) return json(res, 403, { error: 'admin' });
      return json(res, 200, analyticsView());
  }
  return json(res, 404, { error: 'not found' });
}

// ---------- the CLI's API: loopback only, never through a proxy, with the token ----------
async function admin(req, res, route) {
  const token = String(req.headers['x-admin-token'] || '');
  const ok = loopback(req) && !req.headers['cf-ray'] && !req.headers['x-forwarded-for']
    && token.length === ADMIN_TOKEN.length && crypto.timingSafeEqual(Buffer.from(token), Buffer.from(ADMIN_TOKEN));
  if (!ok) return json(res, 404, { error: 'not found' });
  const body = req.method === 'GET' ? {} : await readBody(req);
  const name = S.cleanName(body.name);
  const a = st.accounts[name];
  switch (route) {
    case 'GET /admin/users':
      return json(res, 200, Object.entries(st.accounts).map(([n, x]) => ({
        name: n, email: x.email || null, created: x.created, admin: Boolean(x.admin), friends: x.friends || [],
        devices: Object.values(st.devices).filter((d) => d.owner === n).length, blocks: docOf(n).doc.blocks.length,
      })));
    case 'POST /admin/add-user': {
      if (!S.validName(name)) return json(res, 400, { error: 'name' });
      if (a) return json(res, 409, { error: 'taken' });
      const pw = S.newPassword();
      st.accounts[name] = { ...S.hashPassword(pw), created: Date.now(), pwv: 0, code: S.friendCode(), friends: [] };
      save();
      return json(res, 200, { name, password: pw });
    }
    case 'POST /admin/reset-password': {
      if (!a) return json(res, 404, { error: 'no user' });
      const pw = S.newPassword();
      Object.assign(a, S.hashPassword(pw), { pwv: (a.pwv || 0) + 1 });
      save();
      return json(res, 200, { name, password: pw });
    }
    case 'POST /admin/remove-user':
      if (!a) return json(res, 404, { error: 'no user' });
      removeAccount(name);
      return json(res, 200, { ok: true });
    case 'POST /admin/admin':
      if (!a) return json(res, 404, { error: 'no user' });
      a.admin = Boolean(body.on);
      save();
      return json(res, 200, { name, admin: a.admin });
    case 'POST /admin/friends': {
      const other = S.cleanName(body.other);
      if (!a || !st.accounts[other] || other === name) return json(res, 400, { error: 'users' });
      for (const [x, y] of [[name, other], [other, name]]) {
        const list = st.accounts[x].friends || (st.accounts[x].friends = []);
        if (body.off) st.accounts[x].friends = list.filter((f) => f !== y); else if (!list.includes(y)) list.push(y);
      }
      save();
      return json(res, 200, { ok: true });
    }
    case 'POST /admin/test-push': {
      if (!a) return json(res, 404, { error: 'no user' });
      return json(res, 200, await notify(`a:${name}`, { kind: 'test', tag: 'kavana-test', title: 'Chataltul', body: 'Reminders are working.' }));
    }
  }
  return json(res, 404, { error: 'not found' });
}

const server = http.createServer(async (req, res) => {
  try {
    const p = new URL(req.url, 'http://x').pathname;
    if (p.startsWith('/api/')) return await api(req, res, `${req.method} ${p}`);
    if (p.startsWith('/admin/')) return await admin(req, res, `${req.method} ${p}`);
    if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, 405, { error: 'method' });
    if (STATIC[p]) return serveStatic(req, res, ...STATIC[p]);
    const m = ICON.exec(p);
    if (m) return serveStatic(req, res, `icons/${m[1]}`, m[2] === 'svg' ? 'image/svg+xml' : 'image/png');
    const pm = PORTRAIT.exec(p);
    if (pm) return serveStatic(req, res, `${pm[1]}/${pm[2]}`, 'image/webp');
    const am = AUDIO.exec(p);
    if (am) return serveStatic(req, res, `audio/${am[1]}.${am[2]}`, AUDIO_TYPE[am[2]]);
    return json(res, 404, { error: 'not found' });
  } catch (e) {
    if (!res.headersSent) json(res, e.status || 500, { error: e.status ? e.message : 'server error' });
    if (!e.status) console.error(e);
  }
});

const flush = () => {
  clearTimeout(saveTimer); S.saveState(st);
  clearTimeout(anTimer); S.writeJSON(AN_FILE, an);
  process.exit(0);
};
process.on('SIGTERM', flush);
process.on('SIGINT', flush);
// A sandbox on another address also listens on localhost, so the CLI (loopback only) can reach it.
if (HOST !== '127.0.0.1') http.createServer(server.listeners('request')[0]).listen(PORT, '127.0.0.1');
server.listen(PORT, HOST, () => console.log(`kavana on http://${HOST}:${PORT} (state ${S.DIR})${migrated ? ', migrated the old state' : ''}`));
