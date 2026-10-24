#!/usr/bin/env node
'use strict';
// The server end to end, with Mozilla's real push service standing in for the devices:
//   anonymous device: register, hand over pings, get them on time, daily reminder, forget
//   accounts: sign up, sync (and a conflict), pings worked out from the synced doc
//   friends: codes, sharing levels, the friend-start ping, presence, napping together
//   analytics: events in, the admin dashboard numbers out
// Run against a sandbox started with KAVANA_MINUTE_MS=1000 (a "minute" is one second) and a short
// grace for napping together:
//   KAVANA_STATE=<dir> KAVANA_PORT=8462 KAVANA_HOST=172.17.0.1 KAVANA_MINUTE_MS=1000 KAVANA_NAP_GRACE_MS=2000 node server.js
//   node tools/e2e-server.js http://172.17.0.1:8462 <state dir>
// "quick" (safe on the live site, needs no account and leaves nothing behind):
//   node tools/e2e-server.js https://stuffs.tiresia.xyz/kavana quick
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const push = require('../lib/push');
const E = require('../web/engine');

const [BASE, ARG] = process.argv.slice(2);
const QUICK = ARG === 'quick';
if (!QUICK && /tiresia\.xyz/.test(BASE)) {
  console.error('The full run makes and deletes accounts. Point it at a sandbox, or add "quick" for the live site.');
  process.exit(2);
}
const STATE = QUICK ? null : ARG;
E.config.MIN = 1000;
const fail = (m) => { console.error('FAIL', m); process.exit(1); };
setTimeout(() => fail('timed out'), 240000);
const say = (...a) => console.log(...a);

// ---------- a "device": a cookie jar, a device header, and a Mozilla push channel ----------
function decrypt(body, ua, auth) {
  const salt = body.subarray(0, 16), idlen = body[20];
  const asPublic = body.subarray(21, 21 + idlen), ct = body.subarray(21 + idlen);
  const hkdf = (ikm, s, info, len) => Buffer.from(crypto.hkdfSync('sha256', ikm, s, info, len));
  const ikm = hkdf(ua.computeSecret(asPublic), auth, Buffer.concat([Buffer.from('WebPush: info\0'), ua.getPublicKey(), asPublic]), 32);
  const d = crypto.createDecipheriv('aes-128-gcm', hkdf(ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16), hkdf(ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
  d.setAuthTag(ct.subarray(ct.length - 16));
  const plain = Buffer.concat([d.update(ct.subarray(0, ct.length - 16)), d.final()]);
  return JSON.parse(plain.subarray(0, plain.lastIndexOf(2)).toString());
}

class Device {
  constructor(label) { this.label = label; this.cookie = ''; this.dev = null; this.got = []; this.waiter = null; }
  async api(method, route, body, expect = [200]) {
    const headers = { 'Content-Type': 'application/json' };
    if (this.cookie) headers.Cookie = this.cookie;
    if (this.dev) headers['X-Kavana-Device'] = `${this.dev.id}.${this.dev.secret}`;
    const res = await fetch(BASE + route, { method, headers, body: method === 'GET' ? undefined : JSON.stringify(body || {}) });
    const set = res.headers.get('set-cookie');
    if (set) this.cookie = set.split(';')[0];
    const data = res.status === 204 ? null : await res.json().catch(() => null);
    if (!expect.includes(res.status)) fail(`${this.label} ${method} ${route} -> ${res.status} ${JSON.stringify(data)}`);
    return { status: res.status, data };
  }
  // Open a push channel bound to the server's VAPID key; reconnects keep the uaid so nothing is lost.
  channel(vapidKey) {
    this.ua = crypto.createECDH('prime256v1');
    this.ua.generateKeys();
    this.auth = crypto.randomBytes(16);
    const channelID = crypto.randomUUID();
    let uaid = '';
    return new Promise((resolve) => {
      const connect = () => {
        const ws = new WebSocket('wss://push.services.mozilla.com/');
        ws.onerror = () => {};
        ws.onclose = () => setTimeout(connect, 500);
        ws.onopen = () => ws.send(JSON.stringify({ messageType: 'hello', use_webpush: true, uaid, channelIDs: uaid ? [channelID] : [] }));
        ws.onmessage = (ev) => {
          const m = JSON.parse(ev.data);
          if (m.messageType === 'hello') {
            const first = !uaid;
            uaid = m.uaid;
            if (first) ws.send(JSON.stringify({ messageType: 'register', channelID, key: vapidKey }));
          } else if (m.messageType === 'register') {
            resolve({ endpoint: m.pushEndpoint, keys: { p256dh: push.b64u(this.ua.getPublicKey()), auth: push.b64u(this.auth) } });
          } else if (m.messageType === 'notification') {
            ws.send(JSON.stringify({ messageType: 'ack', updates: [{ channelID: m.channelID, version: m.version }] }));
            const p = decrypt(Buffer.from(m.data, 'base64url'), this.ua, this.auth);
            if (this.waiter) { const w = this.waiter; this.waiter = null; w(p); } else this.got.push(p);
          }
        };
        this.ws = ws;
      };
      connect();
    });
  }
  // The next push, or null after ms. A timer only ever clears its own waiter.
  next(ms = 20000) {
    return new Promise((resolve) => {
      if (this.got.length) { resolve(this.got.shift()); return; }
      const mine = (p) => { clearTimeout(timer); resolve(p); };
      this.waiter = mine;
      const timer = setTimeout(() => { if (this.waiter === mine) this.waiter = null; resolve(null); }, ms);
    });
  }
  close() { if (this.ws) { this.ws.onclose = null; this.ws.close(); } }
}

const cli = (...args) => execFileSync('node', [path.join(__dirname, '../bin/kavana'), ...args], {
  env: { ...process.env, KAVANA_STATE: STATE, KAVANA_PORT: new URL(BASE).port }, encoding: 'utf8',
});

(async () => {
  const { data: config } = await new Device('x').api('GET', '/api/config');
  say('vapid key', config.vapidKey.slice(0, 12) + '…');

  // ---------- anonymous device ----------
  const anon = new Device('anon');
  const sub = await anon.channel(config.vapidKey);
  const { data: reg } = await anon.api('POST', '/api/devices', sub);
  anon.dev = { id: reg.id, secret: reg.secret };
  say('anonymous device registered, owner:', reg.owner);
  await anon.api('POST', '/api/push/test');
  const t0 = await anon.next();
  say('  test push:', t0 && t0.title, '|', t0 && t0.body);
  if (!t0 || t0.kind !== 'test') fail('test push');
  if (QUICK) {
    await anon.api('POST', '/api/devices/forget');
    say('  forgot the device');
    anon.close();
    say('PASS (quick)');
    process.exit(0);
  }

  // Its pings come from its own doc, the same engine the browser runs.
  const doc = E.empty();
  E.start(doc, { intention: 'Anon block', minutes: 25, style: 'ask' }, Date.now()); // interval 15 -> one check-in at 15 s
  const pings = E.pings(doc, Date.now());
  pings.push({ at: Date.now() + 3 * 86400000, kind: 'checkin', title: 'too far ahead' }); // dropped by the server
  await anon.api('POST', '/api/pings', { pings, daily: { ...E.daily(doc), tz: 'Asia/Jerusalem' } });
  const p1 = await anon.next(25000);
  say('  ping 1:', p1 && p1.kind, '|', p1 && p1.title, '|', p1 && p1.body, '| buttons', p1 && (p1.actions || []).map((a) => a.title).join('/'));
  if (!p1 || p1.kind !== 'checkin' || p1.title !== '🐱 Boo! Still on: Anon block?' || !p1.cat) fail('anon check-in');
  const p2 = await anon.next(15000);
  say('  ping 2:', p2 && p2.kind, '|', p2 && p2.title);
  if (!p2 || p2.kind !== 'end') fail('anon end');
  // Daily reminder at this very minute in Jerusalem, once.
  const tz = 'Asia/Jerusalem';
  const hm = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date());
  await anon.api('POST', '/api/pings', { pings: [], daily: { on: true, time: hm, days: [0, 1, 2, 3, 4, 5, 6], tz, body: 'Up next: Call the bank', cat: true } });
  const dly = await anon.next(5000);
  const again = await anon.next(2500);
  say('  daily:', dly && dly.title, '|', dly && dly.body, '| a second one:', again ? 'yes' : 'no');
  if (!dly || dly.kind !== 'daily' || again) fail('anon daily');
  await anon.api('POST', '/api/pings', { pings: [{ at: Date.now() + 2000, kind: 'evil', title: 'x' }] });
  const bad = await anon.next(4000);
  say('  a ping of an unknown kind is dropped:', bad ? 'NO' : 'yes');
  if (bad) fail('bad ping kind');

  // ---------- accounts ----------
  const tag = crypto.randomBytes(3).toString('hex');
  const A = new Device('A'); const B = new Device('B');
  const nameA = `ann${tag}`, nameB = `ben${tag}`;
  const subA = await A.channel(config.vapidKey);
  const subB = await B.channel(config.vapidKey);
  const rA = (await A.api('POST', '/api/devices', subA)).data; A.dev = { id: rA.id, secret: rA.secret };
  const rB = (await B.api('POST', '/api/devices', subB)).data; B.dev = { id: rB.id, secret: rB.secret };
  await A.api('POST', '/api/signup', { name: 'x', password: 'longenough' }, [400]);
  await A.api('POST', '/api/signup', { name: nameA, password: 'short' }, [400]);
  const { data: meA } = await A.api('POST', '/api/signup', { name: nameA, password: 'correct horse' });
  await B.api('POST', '/api/signup', { name: nameA, password: 'correct horse' }, [409]);
  await B.api('POST', '/api/signup', { name: nameB, password: 'battery staple' });
  say('signed up', meA.name, 'and', nameB);
  await A.api('POST', '/api/logout');
  await A.api('POST', '/api/login', { name: nameA, password: 'wrong one' }, [401]);
  await A.api('POST', '/api/login', { name: nameA.toUpperCase(), password: 'correct horse' });
  say('  sign out and back in (case-insensitive name): ok');

  // Sync: empty account, upload, a stale copy gets a 409 with the server's doc to merge.
  const { data: s0 } = await A.api('GET', '/api/sync?rev=-1');
  if (s0.rev !== 0) fail('fresh account rev');
  const docA = E.empty();
  E.addLater(docA, 'Call the bank', Date.now());
  const { data: s1 } = await A.api('POST', '/api/sync', { rev: 0, doc: docA });
  await A.api('GET', `/api/sync?rev=${s1.rev}`, null, [204]);
  const other = E.empty(); // "another device" that never saw rev 1
  E.addLater(other, 'Buy batteries', Date.now());
  const { status: c409, data: theirs } = await A.api('POST', '/api/sync', { rev: 0, doc: other }, [409]);
  const merged = E.merge(other, theirs.doc);
  const { data: s2 } = await A.api('POST', '/api/sync', { rev: theirs.rev, doc: merged });
  const { data: back } = await A.api('GET', '/api/sync?rev=0');
  say(`  sync: rev ${s1.rev} -> stale copy got ${c409} -> merged -> rev ${s2.rev}, Later now:`, E.view(back.doc, Date.now()).later.map((x) => x.text).join(', '));
  if (E.view(back.doc, Date.now()).later.length !== 2) fail('merge');

  // Friends: B adds A's code.
  const { data: fa } = await A.api('GET', '/api/friends');
  await B.api('POST', '/api/friends/add', { code: 'NOPE00' }, [404]);
  await B.api('POST', '/api/friends/add', { code: (await B.api('GET', '/api/friends')).data.code }, [400]);
  const { data: fb } = await B.api('POST', '/api/friends/add', { code: fa.code.toLowerCase() });
  say('friends:', nameB, 'added', fb.friends.map((f) => f.name).join(','), '| sharing yet:', fb.sharing);
  // Both share; B only "that I'm focusing", A "what I'm working on too".
  const share = async (dev, level) => {
    const cur = (await dev.api('GET', '/api/sync?rev=-1')).data;
    const next = E.normalize(cur.doc);
    E.setSettings(next, { share: level, friendPings: true }, Date.now());
    return (await dev.api('POST', '/api/sync', { rev: cur.rev, doc: next })).data;
  };
  await share(A, 'all');
  await share(B, 'status');

  // A starts a block (synced): A's device gets the pings, B gets "started focusing".
  let cur = (await A.api('GET', '/api/sync?rev=-1')).data;
  const docRun = E.normalize(cur.doc);
  E.setSettings(docRun, { interval: 10 }, Date.now());
  E.start(docRun, { intention: 'Write the intro', minutes: 20, style: 'ask' }, Date.now());
  await A.api('POST', '/api/sync', { rev: cur.rev, doc: docRun });
  const fping = await B.next(10000);
  say('  B got:', fping && fping.kind, '|', fping && fping.title, '|', fping && fping.body);
  if (!fping || fping.kind !== 'friend' || !fping.body.includes('Write the intro')) fail('friend ping');
  const { data: seen } = await B.api('GET', '/api/friends');
  say('  B sees A:', JSON.stringify({ status: seen.friends[0].status, intention: seen.friends[0].intention, leftS: Math.round(seen.friends[0].left / 1000) }));
  if (seen.friends[0].status !== 'focusing' || seen.friends[0].intention !== 'Write the intro') fail('presence');
  const { data: seenB } = await A.api('GET', '/api/friends');
  say('  A sees B (shares status only):', JSON.stringify(seenB.friends[0]));
  if (seenB.friends[0].intention !== undefined) fail('status-only leaked an intention');
  const ck = await A.next(15000);
  say('  A got its check-in from the synced doc:', ck && ck.title);
  if (!ck || ck.kind !== 'checkin') fail('account check-in');
  // A second block right away: no second friend ping within 30 (test) minutes.
  cur = (await A.api('GET', '/api/sync?rev=-1')).data;
  const docRun2 = E.normalize(cur.doc);
  E.start(docRun2, { intention: 'Second', minutes: 20, style: 'ask' }, Date.now());
  await A.api('POST', '/api/sync', { rev: cur.rev, doc: docRun2 });
  const quiet = await B.next(3000);
  say('  a second start within the limit pings B again:', quiet ? 'yes (WRONG)' : 'no');
  if (quiet) fail('friend ping rate limit');
  // B stops sharing: B no longer sees A.
  await share(B, 'off');
  const { data: seen2 } = await B.api('GET', '/api/friends');
  const aSeesB = (await A.api('GET', '/api/friends')).data.friends[0].status;
  say('  B stopped sharing -> B sees:', seen2.friends[0].status, '| A sees B:', aSeesB);
  if (seen2.friends[0].status !== 'unknown' || aSeesB !== 'hidden') fail('reciprocity');

  // ---------- napping together ----------
  await share(B, 'status');
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const change = async (dev, fn) => { // like a page: change the doc, sync it
    const c = (await dev.api('GET', '/api/sync?rev=-1')).data;
    const d = E.normalize(c.doc);
    const out = fn(d, Date.now());
    await dev.api('POST', '/api/sync', { rev: c.rev, doc: d });
    return out;
  };
  const joinA = async () => { // B joins A's running block
    const f = (await B.api('GET', '/api/friends')).data.friends[0];
    if (!f.nap) fail('presence has no nap id');
    const b = await change(B, (d, t) => E.start(d, { intention: 'Problem set', minutes: 20, withEnd: f.end, withName: 'Ann', cat: 'pepper' }, t));
    return { f, b, res: await B.api('POST', '/api/nap/join', { id: f.nap, block: b.id, cat: 'pepper', start: b.start }, [200, 409]) };
  };
  const hostA = await change(A, (d, t) => E.start(d, { intention: 'Nap one', minutes: 60, cat: 'miso' }, t));
  await B.api('POST', '/api/nap/join', { id: 'nosuchblock1', block: 'abcdefghi', cat: 'pepper' }, [404]);
  await B.api('POST', '/api/nap/join', { id: '<bad>', block: 'abcdefghi' }, [400]);
  const j1 = await joinA();
  if (j1.res.status !== 200 || j1.f.nap !== hostA.id || j1.res.data.members.length !== 2 || j1.res.data.host) fail(`nap join ${JSON.stringify(j1.res.data)}`);
  let gA = (await A.api('GET', `/api/nap?block=${hostA.id}`)).data;
  say('nap: B joined A ->', gA.members.map((m) => `${m.display}/${m.cat}`).join(' + '), '| A is host:', gA.host);
  if (!gA.host || gA.members.length !== 2 || gA.broken) fail('nap view');
  await A.api('GET', '/api/nap?block=notmyblock1', null, [204]);
  // a glance away (back within the grace) is fine; a long one breaks the group for everyone
  await B.api('POST', '/api/nap/left', { block: j1.b.id });
  if (!(await A.api('GET', `/api/nap?block=${hostA.id}`)).data.members.find((m) => !m.me).away) fail('nap away flag');
  await sleep(500);
  await B.api('POST', '/api/nap/back', { block: j1.b.id });
  await sleep(2600);
  if ((await A.api('GET', `/api/nap?block=${hostA.id}`)).data.broken) fail('a short glance broke the nap');
  await B.api('POST', '/api/nap/left', { block: j1.b.id });
  await sleep(3500);
  gA = (await A.api('GET', `/api/nap?block=${hostA.id}`)).data;
  say('  B left for longer than the grace -> broken:', JSON.stringify(gA.broken && { by: gA.broken.by, why: gA.broken.why }));
  if (!gA.broken || gA.broken.why !== 'away' || gA.broken.me) fail('nap break on leaving');
  const after = await change(A, (d, t) => { E.napWith(d, hostA.id, gA.id, 1, t); return E.napGone(d, gA.id, gA.broken.at, gA.broken.by, t); });
  if (!after || after.goneWhy !== 'nap') fail('napGone on the host');
  await B.api('POST', '/api/nap/back', { block: j1.b.id }); // came back late: still broken, no error
  const late = await joinA(); // joining a broken group
  if (late.res.status !== 409 || late.res.data.error !== 'broken') fail('joined a broken nap');
  // a new nap: B stops (the synced doc says so), and that breaks it too
  const hostA2 = await change(A, (d, t) => E.start(d, { intention: 'Nap two', minutes: 60, cat: 'miso' }, t));
  const j2 = await joinA();
  if (j2.res.status !== 200 || j2.res.data.id !== hostA2.id) fail('second nap join');
  await change(B, (d, t) => E.stop(d, t));
  gA = (await A.api('GET', `/api/nap?block=${hostA2.id}`)).data;
  say('  B stopped -> broken:', JSON.stringify(gA.broken && { by: gA.broken.by, why: gA.broken.why }));
  if (!gA.broken || gA.broken.why !== 'stop') fail('nap break on stop');
  // a third: B rejoins the same group with a different block, which counts as leaving it
  const hostA3 = await change(A, (d, t) => E.start(d, { intention: 'Nap three', minutes: 60, cat: 'miso' }, t));
  const j3 = await joinA();
  if (j3.res.status !== 200) fail('third nap join');
  const again2 = await joinA();
  if (again2.res.status !== 409 || !(await A.api('GET', `/api/nap?block=${hostA3.id}`)).data.broken) fail('rejoin with a new block');
  say('  joining a broken nap -> 409; rejoining with another block breaks it: ok');

  // ---------- nap rooms: joined with a code, no friendship needed ----------
  await B.api('POST', '/api/friends/remove', { name: nameA });
  const hostA4 = await change(A, (d, t) => E.start(d, { intention: 'Room nap', minutes: 60, cat: 'miso' }, t));
  const room = (await A.api('POST', '/api/nap/room', { block: hostA4.id })).data;
  if (!/^[A-Z]{6}$/.test(room.code || '')) fail(`room code ${JSON.stringify(room)}`);
  const room2 = (await A.api('POST', '/api/nap/room', { block: hostA4.id })).data;
  if (room2.code !== room.code) fail('a second room for the same block');
  await B.api('GET', '/api/nap/room?code=ZZZZZZ', null, [404]);
  const look = (await B.api('GET', `/api/nap/room?code=${room.code.toLowerCase()}`)).data;
  if (look.id !== hostA4.id || look.members !== 1) fail(`room lookup ${JSON.stringify(look)}`);
  const bRoom = await change(B, (d, t) => E.start(d, { intention: 'Joining by code', minutes: 30, cat: 'pepper', withEnd: look.end }, t));
  await B.api('POST', '/api/nap/join', { id: look.id, block: bRoom.id, cat: 'pepper', start: bRoom.start }, [403]); // no code, not friends
  const inRoom = (await B.api('POST', '/api/nap/join', { id: look.id, block: bRoom.id, cat: 'pepper', start: bRoom.start, code: room.code })).data;
  say('  room', room.code, '-> B joined without being friends:', inRoom.members.map((m) => m.display).join(' + '));
  if (inRoom.members.length !== 2) fail('room join');

  // ---------- rankings and shelter cats ----------
  const r0 = (await A.api('GET', '/api/rankings')).data;
  if (r0.on || r0.world.length || !(r0.round.to - r0.round.from === 7 * 86400000)) fail(`rankings off ${JSON.stringify(r0)}`);
  await change(A, (d, t) => E.setSettings(d, { rank: { on: true, global: true, name: 'Ada' } }, t));
  const r1 = (await B.api('GET', '/api/rankings')).data;
  say('  rankings: B sees worldwide', JSON.stringify(r1.world.map((w) => [w.name, w.minutes])));
  if (!r1.world.some((w) => w.name === 'Ada') || r1.world.some((w) => w.name === nameA)) fail('worldwide rankings show the nickname only');
  const sh0 = (await anon.api('GET', '/api/shelter')).data;
  const sh1 = (await anon.api('POST', '/api/sponsor', {})).data;
  if (sh1.everyone !== sh0.everyone + 1 || sh0.friends !== null) fail('shelter count');
  say('  shelter cats sponsored by everyone:', sh0.everyone, '->', sh1.everyone);

  // ---------- analytics ----------
  await anon.api('POST', '/api/events', { install: 'abc12345xyz', events: [
    { e: 'open', p: { mode: 'anon', plat: 'ios-app' } }, { e: 'start', p: { len: '25', style: 'ask' } },
    { e: 'end', p: { outcome: 'done', min: 25 } }, { e: 'not-an-event' }, { e: 'start', p: { len: '<script>' } },
  ] });
  await anon.api('POST', '/api/events', { install: 'bad id!', events: [] }, [400]);
  cli('admin', nameA);
  const { data: an } = await A.api('GET', '/api/admin/analytics');
  const today = an.days[an.days.length - 1];
  say('analytics today:', JSON.stringify({ installs: today.installs, open: today.c.open, start: today.c.start, 'start.len=25': today.c['start.len=25'], 'end.min': today.c['end.min'], junk: today.c['not-an-event'] || 0, pushes: today.c['push.checkin'] }));
  if (!today.c.start || today.c['end.min'] < 25 || today.c['not-an-event'] || Object.keys(today.c).some((k) => k.includes('<'))) fail('analytics');
  await B.api('GET', '/api/admin/analytics', null, [403]);

  // ---------- cleanup: delete both accounts, forget the devices ----------
  await A.api('POST', '/api/account/delete', { password: 'nope' }, [401]);
  await A.api('POST', '/api/account/delete', { password: 'correct horse' });
  await B.api('POST', '/api/account/delete', { password: 'battery staple' });
  await B.api('GET', '/api/friends', null, [401]);
  for (const d of [anon, A, B]) { await d.api('POST', '/api/devices/forget'); d.close(); }
  say('deleted both accounts and forgot the three devices');
  say('PASS');
  process.exit(0);
})().catch((e) => fail(e.stack));
