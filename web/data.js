// Where Chataltul keeps things, and the few times it talks to the server.
// - The doc (blocks, Later, settings) lives in this browser's localStorage, always.
// - Signed in: the doc is also synced with the account (merge on conflict, see engine.js).
// - Reminders on, no account: the device hands the server its next pings, which it deletes once sent.
// - Answers tapped on a notification are left by the service worker in IndexedDB ("inbox").
// - Usage counts (never content) go out in small batches unless turned off.
(function (root) {
'use strict';
const E = root.Kavana;
const LS = {
  get(k) { try { return localStorage.getItem('kavana.' + k); } catch { return null; } },
  set(k, v) { try { if (v == null) localStorage.removeItem('kavana.' + k); else localStorage.setItem('kavana.' + k, String(v)); } catch {} },
  json(k) { try { return JSON.parse(LS.get(k)); } catch { return null; } },
};

const D = { LS };
D.doc = E.normalize(LS.json('doc'));
D.account = LS.json('account'); // { name, display, admin } while signed in
D.device = LS.json('device');   // { id, secret } once reminders are on
D.rev = Number(LS.get('rev')) || 0;
const listeners = [];
D.onChange = (fn) => listeners.push(fn);
const emit = () => { for (const fn of listeners) { try { fn(); } catch (e) { console.error(e); } } };
const store = () => { LS.set('doc', JSON.stringify(D.doc)); LS.set('rev', D.rev); };

async function api(method, url, body) {
  const headers = {};
  if (D.device) headers['X-Kavana-Device'] = `${D.device.id}.${D.device.secret}`;
  const opts = { method, credentials: 'same-origin', headers };
  if (method !== 'GET') { headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body || {}); }
  const res = await fetch(url, opts);
  let data = null;
  if (res.status !== 204) { try { data = await res.json(); } catch {} }
  if (!res.ok) throw Object.assign(new Error((data && data.error) || String(res.status)), { status: res.status, data });
  return data;
}
D.api = api;

// ---------- every change goes through here ----------
const tz = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch { return ''; } };
D.save = () => {
  if (D.doc.settings.tz !== tz()) E.setSettings(D.doc, { tz: tz() }, Date.now()); // the daily reminder needs it
  store();
  if (D.account) queueSync(); else queuePings();
};
// Run an engine change (it gets the doc and now), then save. Throws what the engine throws.
D.act = (fn) => {
  const now = Date.now();
  E.tick(D.doc, now);
  const r = fn(D.doc, now);
  D.save();
  return r;
};
D.tick = () => { if (E.tick(D.doc, Date.now())) { D.save(); return true; } return false; };

// ---------- no account: hand the server this device's next pings ----------
let pingTimer = null;
function queuePings() { clearTimeout(pingTimer); pingTimer = setTimeout(postPings, 400); }
async function postPings() {
  if (!D.device || D.account) return;
  const now = Date.now();
  try { await api('POST', 'api/pings', { pings: E.pings(D.doc, now), daily: { ...E.daily(D.doc), tz: tz() } }); } catch {}
}

// ---------- with an account: sync ----------
let syncTimer = null, syncing = false, again = false;
// 'too big' while the server won't take this device's copy, even folded. The page says so until a
// sync goes through, so it never stops syncing without anyone knowing.
D.syncTrouble = null;
const trouble = (what) => { if (D.syncTrouble !== what) { D.syncTrouble = what; emit(); } };
function queueSync() { clearTimeout(syncTimer); syncTimer = setTimeout(pushSync, 700); }
async function pushSync() {
  if (!D.account) return;
  if (syncing) { again = true; return; }
  syncing = true;
  let squeezed = false;
  try {
    for (let i = 0; i < 4; i++) {
      try {
        const r = await api('POST', 'api/sync', { rev: D.rev, doc: D.doc });
        D.rev = r.rev;
        store();
        trouble(null);
        break;
      } catch (e) {
        if (e.status === 409 && e.data) { // someone else synced first: merge theirs in and try again
          D.doc = E.merge(D.doc, e.data.doc);
          D.rev = e.data.rev;
          store();
          emit();
          continue;
        }
        // Too big. Past what the server reads at all it cuts the connection instead of answering, which
        // looks like being offline, except that the doc is bigger than the engine keeps.
        const tooBig = e.status === 413 || (!e.status && E.size(D.doc) > E.config.BYTES);
        if (tooBig && !squeezed) { // fold the oldest blocks into the past (E.normalize does) and try once more
          squeezed = true;
          D.doc = E.normalize(D.doc);
          store();
          emit();
          continue;
        }
        if (tooBig) trouble('too big');
        if (e.status === 401) signedOutElsewhere();
        break;
      }
    }
  } finally {
    syncing = false;
    if (again) { again = false; queueSync(); }
  }
}
D.flushSync = pushSync;

D.pull = async () => {
  if (!D.account) return;
  try {
    const r = await api('GET', `api/sync?rev=${D.rev}`);
    if (!r) return; // nothing new
    const merged = E.merge(D.doc, r.doc);
    const mineToo = JSON.stringify(merged) !== JSON.stringify(E.normalize(r.doc));
    D.doc = merged;
    D.rev = r.rev;
    store();
    emit();
    if (mineToo) queueSync();
  } catch (e) { if (e.status === 401) signedOutElsewhere(); }
};

function signedOutElsewhere() { // the password was reset, or the account removed
  D.account = null;
  LS.set('account', null);
  D.rev = 0;
  store();
  emit();
}

// After any sign-in, this browser's data comes along into the account.
async function joined(me, existing) {
  LS.set('emailAt', null);
  D.account = me;
  LS.set('account', JSON.stringify(me));
  try {
    const r = await api('GET', 'api/sync?rev=-1');
    // Signing in to an account that has settings: they come with it (this browser's look newer only
    // because its first save noted the time zone, and they'd turn off sharing, rename you, ...).
    const theirs = E.normalize(r.doc).settings;
    if (existing && theirs.u) D.doc.settings = { ...theirs, u: Math.max(theirs.u, D.doc.settings.u || 0) };
    D.doc = E.merge(D.doc, r.doc);
    D.rev = r.rev;
  } catch {}
  store();
  await pushSync();
  emit();
  return me;
}

// kind: 'signup' or 'login' (a name or an email, and the password).
D.signIn = async (kind, name, password) => joined(await api('POST', kind === 'signup' ? 'api/signup' : 'api/login', { name, password }), kind === 'login');

// By email: a code, which signs in, or makes the account if there isn't one. Resolves with created.
D.emailCode = (email) => api('POST', 'api/email/code', { email });
D.emailSignIn = async (email, code) => {
  const { created, ...me } = await api('POST', 'api/email/signin', { email, code });
  await joined(me, !created);
  LS.set('emailAt', Date.now()); // for the next 15 minutes a new password doesn't need the old one
  return created;
};

// The account page: an email (a code to it, then the code back), a password.
const meNow = (me) => { D.account = me; LS.set('account', JSON.stringify(me)); emit(); return me; };
D.addEmail = (email) => api('POST', 'api/account/email', { email }).then((r) => (r.name ? meNow(r) : r));
D.confirmEmail = async (email, code) => meNow(await api('POST', 'api/account/email/confirm', { email, code }));
D.setPassword = async (password, current) => meNow(await api('POST', 'api/account/password', { password, current }));
D.freshEmailSignIn = () => Date.now() - (Number(LS.get('emailAt')) || 0) < 14 * 60000;
D.accountCode = () => api('POST', 'api/account/code', {});

D.refreshMe = async () => {
  if (!D.account) return;
  try { D.account = await api('GET', 'api/me'); LS.set('account', JSON.stringify(D.account)); } catch (e) { if (e.status === 401) signedOutElsewhere(); }
};

// The account's data leaves this browser on sign out (it's safe on the server).
D.signOut = async () => {
  await pushSync();
  try { await api('POST', 'api/logout', {}); } catch {}
  LS.set('emailAt', null);
  D.account = null;
  LS.set('account', null);
  D.doc = E.empty();
  D.rev = 0;
  store();
  queuePings();
  emit();
};

// Deleting the account removes the server's copy; this browser keeps its own. proof: { password } or { code }.
D.deleteAccount = async (proof) => {
  await api('POST', 'api/account/delete', proof);
  D.account = null;
  LS.set('account', null);
  D.rev = 0;
  store();
  queuePings();
  emit();
};

// ---------- reminders on this device ----------
D.registerDevice = async (sub) => {
  const r = await api('POST', 'api/devices', sub.toJSON());
  if (r.secret) { D.device = { id: r.id, secret: r.secret }; LS.set('device', JSON.stringify(D.device)); }
  if (D.account) queueSync(); else queuePings();
};
D.forgetDevice = async () => {
  try { await api('POST', 'api/devices/forget', {}); } catch {}
  D.device = null;
  LS.set('device', null);
};

// ---------- answers left by the service worker ----------
function idb() {
  return new Promise((ok, no) => {
    const r = indexedDB.open('kavana', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('inbox', { autoIncrement: true });
    r.onsuccess = () => ok(r.result);
    r.onerror = () => no(r.error);
  });
}
D.drainInbox = async () => {
  if (!('indexedDB' in root)) return 0;
  let items = [];
  try {
    const db = await idb();
    items = await new Promise((ok) => {
      const tx = db.transaction('inbox', 'readwrite');
      const os = tx.objectStore('inbox');
      const all = os.getAll();
      all.onsuccess = () => { os.clear(); ok(all.result || []); };
      all.onerror = () => ok([]);
    });
    db.close();
  } catch { return 0; }
  if (!items.length) return 0;
  D.act((doc, now) => { for (const x of items) { try { E.answer(doc, x.block, x.n, x.answer, null, now); } catch {} } });
  for (const x of items) D.track('checkin', { answer: x.answer, via: 'notif' });
  emit();
  return items.length;
};

// ---------- usage counts ----------
const rid = () => Array.from(crypto.getRandomValues(new Uint8Array(12)), (x) => 'abcdefghijklmnopqrstuvwxyz0123456789'[x % 36]).join('');
D.install = LS.get('install') || (() => { const id = rid(); LS.set('install', id); return id; })();
let queue = LS.json('events') || [];
D.counting = () => LS.get('analytics') !== '0';
D.track = (e, p) => {
  if (!D.counting()) return;
  queue.push(p ? { e, p } : { e });
  if (queue.length > 300) queue = queue.slice(-300);
  LS.set('events', JSON.stringify(queue));
};
D.setCounting = (on) => {
  if (!on) { D.track('analytics_off'); D.flush(); }
  LS.set('analytics', on ? null : '0');
  if (!on) { queue = []; LS.set('events', null); }
};
D.flush = async () => {
  if (!queue.length) return;
  const batch = queue.slice(0, 50);
  try {
    await fetch('api/events', {
      method: 'POST', credentials: 'same-origin', keepalive: true,
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ install: D.install, events: batch }),
    });
    queue = queue.slice(batch.length);
    LS.set('events', JSON.stringify(queue));
  } catch {}
};
setInterval(D.flush, 30000);
setTimeout(D.flush, 4000); // a quick visit still counts
document.addEventListener('visibilitychange', () => { if (document.hidden) D.flush(); });

root.Data = D;
})(this);
