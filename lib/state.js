'use strict';
// What the server keeps, in one state directory (default /srv/docker/kavana, mode 700):
//   state.json      accounts (name, password hash, friend code, friends), sign-ins, push devices,
//                   the pings waiting to be sent, daily reminder times
//   docs/<name>.json  an account's synced data (the same doc the browser keeps), with its revision
//   analytics.json  feature counts per day (never anything anyone typed)
//   vapid.json      the push key pair, made on first run
//   admin-token     the CLI's key to the /admin API, made on first run
// People without an account have nothing here except, if they turned on reminders, their device
// and its next few pings (deleted as they're sent).
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const push = require('./push');

const DIR = process.env.KAVANA_STATE || '/srv/docker/kavana';
const file = (n) => path.join(DIR, n);

function readJSON(name, fallback) {
  try { return JSON.parse(fs.readFileSync(file(name), 'utf8')); } catch (e) {
    if (e.code === 'ENOENT') return fallback;
    throw e;
  }
}

function writeJSON(name, data) {
  fs.mkdirSync(path.dirname(file(name)), { recursive: true, mode: 0o700 });
  const tmp = file(`${name}.${process.pid}.tmp`);
  fs.writeFileSync(tmp, JSON.stringify(data) + '\n', { mode: 0o600 });
  fs.renameSync(tmp, file(name));
}

function vapid() {
  let v = readJSON('vapid.json', null);
  if (!v) { v = push.generateVapidKeys(); writeJSON('vapid.json', v); }
  return v;
}

function adminToken() {
  try { return fs.readFileSync(file('admin-token'), 'utf8').trim(); } catch {}
  const t = crypto.randomBytes(24).toString('base64url');
  fs.mkdirSync(DIR, { recursive: true, mode: 0o700 });
  fs.writeFileSync(file('admin-token'), t + '\n', { mode: 0o600 });
  return t;
}

// Passwords the CLI makes up (three plain words, easy to type on an iPad).
const WORDS = ('acorn amber anchor apple arch aspen autumn badge bamboo banner barley basil beacon berry birch '
  + 'blossom bonnet branch breeze brook bubble button cabin cactus candle canoe canyon carpet cedar cello '
  + 'cherry chess cider citrus clover cobalt comet copper coral cotton crane crayon creek crystal cubby daisy '
  + 'delta denim dolphin dove dune eagle ember fable falcon feather fennel fern fiddle fig finch fjord flint '
  + 'forest fossil fox garden garnet ginger glacier glove granite grape harbor harvest hazel heron hickory '
  + 'honey island ivory jasmine juniper kettle kite koala ladder lagoon lantern laurel lemon lilac linen '
  + 'lotus lunar magnet mango maple marble meadow melon mint mitten mosaic moss nectar nutmeg oak oasis '
  + 'olive onyx orbit orchid otter owl paddle palm panda pebble pepper piano pillow pine planet plum pocket '
  + 'pond poppy prairie pumpkin quail quartz quill rabbit raven reef ribbon river robin rocket saffron sage '
  + 'sail salt sapphire satin shell sierra silver sky sparrow spruce stone summit sunny swan teapot thistle '
  + 'thunder tiger timber topaz tulip tundra turtle velvet violet walnut wave willow window winter wren yarrow').split(' ');
const newPassword = () => [0, 1, 2].map(() => WORDS[crypto.randomInt(WORDS.length)]).join('-');

function hashPassword(pw, salt = crypto.randomBytes(16).toString('base64url')) {
  return { salt, hash: crypto.scryptSync(String(pw), salt, 32).toString('base64url') };
}
function checkPassword(user, pw) {
  const a = Buffer.from(hashPassword(pw, user.salt).hash);
  const b = Buffer.from(user.hash);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

const cleanName = (n) => String(n || '').trim().toLowerCase();
const RESERVED = new Set(['admin', 'administrator', 'kavana', 'root', 'support', 'help', 'system', 'null', 'undefined', 'me', 'friend-code']);
const validName = (n) => /^[a-z0-9][a-z0-9._-]{1,23}$/.test(n) && !RESERVED.has(n);
const friendCode = () => Array.from(crypto.randomBytes(6), (x) => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[x % 32]).join('');

const emptyState = () => ({ v: 2, accounts: {}, sessions: {}, devices: {}, pings: {}, daily: {}, docs: {}, naps: {} });

// The first version kept accounts in users.json and blocks in state.json; carry them over once.
function migrate(old, docs) {
  const st = emptyState();
  const users = readJSON('users.json', {});
  for (const [name, u] of Object.entries(users)) {
    st.accounts[name] = { hash: u.hash, salt: u.salt, created: u.created, pwv: u.pwv || 0, code: friendCode(), friends: [] };
  }
  for (const [k, s] of Object.entries(old.sessions || {})) if (st.accounts[s.user]) st.sessions[k] = s;
  for (const name of Object.keys(st.accounts)) {
    const set = (old.settings || {})[name] || {};
    const later = ((old.later || {})[name] || []).map((x) => ({ id: x.id, text: x.text, at: x.at, u: x.at }));
    const blocks = (old.blocks || []).filter((b) => b.user === name && b.kind !== 'break').map((b) => {
      const { user, token, nextAt, ...rest } = b;
      return { ...rest, plan: [], parked: rest.parked || [], checkins: rest.checkins || [], u: Date.now() };
    });
    docs[name] = {
      rev: 1,
      doc: {
        v: 1, blocks, later, brk: null, brkU: 0, cleared: 0, u: Date.now(),
        settings: { interval: set.interval ?? 15, style: set.style || 'ask', goal: set.goal || 0, daily: set.daily || undefined, u: Date.now() },
      },
    };
    st.docs[name] = 1;
  }
  return st;
}

function loadState() {
  const raw = readJSON('state.json', null);
  if (raw && raw.v === 2) return { st: Object.assign(emptyState(), raw), migrated: null };
  if (!raw && !readJSON('users.json', null)) return { st: emptyState(), migrated: null }; // a fresh start
  const docs = {};
  const st = migrate(raw || {}, docs);
  return { st, migrated: docs };
}

const saveState = (s) => writeJSON('state.json', s);
const docFile = (name) => `docs/${name}.json`;
const loadDoc = (name) => readJSON(docFile(name), null);
const saveDoc = (name, d) => writeJSON(docFile(name), d);
const dropDoc = (name) => { try { fs.unlinkSync(file(docFile(name))); } catch {} };

const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('base64url');

module.exports = {
  DIR, readJSON, writeJSON, vapid, adminToken, newPassword, hashPassword, checkPassword, cleanName, validName,
  friendCode, loadState, saveState, loadDoc, saveDoc, dropDoc, sha,
};
