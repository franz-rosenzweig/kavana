#!/usr/bin/env node
'use strict';
// Walk the app in headless Chrome (docker-chrome-1's DevTools port) and screenshot each screen.
// Each device runs in its own fresh browser context, so storage and cookies start empty.
//   node tools/shot.js <app url as Chrome sees it> <api url as this machine sees it> <out dir> [state dir]
// The app must be a secure origin for the service worker and PushManager to exist, so for a
// sandbox point it at a localhost proxy inside the chrome container's network namespace.
// A "pal" account is made through the API first (sharing, in a block) so there's a friend to join.
// ONLY=ipad,cafe,friends,... runs just those walks. Never point this at the live site: it makes accounts.
// The nap walks are quicker with the sandbox started with KAVANA_NAP_GRACE_MS=4000.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const E = require('../web/engine');

const [APP, API, OUT, STATE] = process.argv.slice(2);
if (/tiresia\.xyz/.test(APP + API)) { console.error('The walk makes accounts. Use a sandbox.'); process.exit(2); }
fs.mkdirSync(OUT, { recursive: true });
const ONLY = process.env.ONLY ? process.env.ONLY.split(',') : null;
// KAVANA_CHROME names another headless Chrome container (same image and flags) when others share docker-chrome-1.
const chromeIp = execFileSync('docker', ['inspect', '-f', '{{range .NetworkSettings.Networks}}{{.IPAddress}} {{end}}', process.env.KAVANA_CHROME || 'docker-chrome-1']).toString().trim().split(' ')[0];
const IPAD_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Safari/605.1.15';
const ANDROID_UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36';
const ipad = { width: 820, height: 1180, ua: IPAD_UA, platform: 'MacIntel', touch: true };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tag = Math.random().toString(36).slice(2, 6);

let ws, seq = 0;
const pending = new Map();
const listeners = [];
function cdp(method, params = {}, sessionId) {
  const id = ++seq;
  ws.send(JSON.stringify({ id, method, params, sessionId }));
  return new Promise((ok, no) => pending.set(id, { ok, no, method }));
}

// A page clock set to another time (for the Halloween shop, and missions on a known day).
const fakeClock = (when) => `(() => { const off = new Date(${JSON.stringify(when)}).getTime() - Date.now(); const R = Date;
  class Fake extends R { constructor(...a) { if (a.length) super(...a); else super(R.now() + off); } static now() { return R.now() + off; } }
  window.Date = Fake; })();`;

async function device(label, { width, height, ua, platform, touch, standalone, dark, clock }, steps) {
  if (ONLY && !ONLY.includes(label)) return;
  const { browserContextId } = await cdp('Target.createBrowserContext', { disposeOnDetach: true });
  const { targetId } = await cdp('Target.createTarget', { url: 'about:blank', browserContextId });
  const { sessionId } = await cdp('Target.attachToTarget', { targetId, flatten: true });
  const errors = [];
  listeners.push((m) => {
    if (m.sessionId !== sessionId) return;
    if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push(m.params.args.map((a) => a.value || a.description).join(' '));
  });
  const s = (method, params) => cdp(method, params, sessionId);
  await s('Page.enable');
  await s('Runtime.enable');
  await s('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 2, mobile: true });
  await s('Emulation.setUserAgentOverride', { userAgent: ua, platform });
  if (touch) await s('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await s('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: dark ? 'dark' : 'light' }] });
  // Home Screen apps on iOS report navigator.standalone = true; Safari tabs report false.
  await s('Page.addScriptToEvaluateOnNewDocument', {
    source: `Object.defineProperty(Navigator.prototype, 'standalone', { get: () => ${standalone ? 'true' : 'false'} });
             window.confirm = () => true; window.prompt = () => window.__prompt || null;`,
  });
  if (clock) await s('Page.addScriptToEvaluateOnNewDocument', { source: fakeClock(clock) });
  await s('Page.navigate', { url: APP });
  await sleep(1800);
  for (const step of steps) {
    if (step.node) await step.node();
    if (step.js) {
      const r = await s('Runtime.evaluate', { expression: `(async () => { const wait = (ms) => new Promise(r => setTimeout(r, ms)); ${step.js} })()`, awaitPromise: true, returnByValue: true });
      if (r.exceptionDetails) errors.push(`step ${step.name}: ${r.exceptionDetails.exception?.description}`);
      else if (r.result && r.result.value !== undefined) console.log(`  ${label}/${step.name}:`, JSON.stringify(r.result.value));
    }
    await sleep(step.wait || 900);
    if (step.shot !== false) {
      const { data } = await s('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(path.join(OUT, `${label}-${step.name}.png`), Buffer.from(data, 'base64'));
    }
  }
  await cdp('Target.closeTarget', { targetId });
  await cdp('Target.disposeBrowserContext', { browserContextId }).catch(() => {});
  console.log(`${label}: ${steps.length} steps, errors: ${errors.length ? errors.join(' | ') : 'none'}`);
}

// What's on screen, and a few helpers that run inside the page.
const visible = `return [...document.querySelectorAll('.view')].filter(v => !v.hidden).map(v => v.id).concat([...document.querySelectorAll('.sheet')].filter(v => !v.hidden).map(v => 'sheet:' + v.id)).join(',')`;
const click = (sel) => `document.querySelector(${JSON.stringify(sel)}).click();`;
const start = (what, extra = '') => `{ const f = document.querySelector('#start'); f.intention.value = ${JSON.stringify(what)}; ${extra} f.requestSubmit(); } await wait(700);`;
const dueNow = `D.act((doc, t) => { const b = E.running(doc); b.plan[0].at = t - 1; }); refresh(); await wait(900);`; // make the next check-in come due now
const scrollToSel = (sel, off = 60) => `{ const el = document.querySelector(${JSON.stringify(sel)}); window.scrollTo(0, el.getBoundingClientRect().top + scrollY - ${off}); } await wait(300);`;
const yes = `await wait(350); document.querySelector('#alert [data-alert="1"]').click(); await wait(600);`; // the system-style alert's main button
// A block that started 30 minutes ago and has just ended (so it counts as finished).
const finished = (what) => `D.act((doc, t) => E.start(doc, { intention: ${JSON.stringify(what)}, minutes: 25, style: 'ask' }, t - 30 * 60000)); refresh(); await wait(700);`;
const MAC_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Safari/605.1.15';

// An account, sharing ('all') under a display name. With the state dir it's made through the
// sandbox's admin API (loopback only), because sign-ups are limited to 3 an hour per address.
async function account(name, display) {
  let password = `${name} password`;
  let res;
  if (STATE) {
    const token = fs.readFileSync(path.join(STATE, 'admin-token'), 'utf8').trim();
    const made = await fetch(`http://127.0.0.1:${new URL(API).port}/admin/add-user`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Admin-Token': token }, body: JSON.stringify({ name }) });
    if (!made.ok) throw new Error(`add-user ${name}: ${made.status}`);
    password = (await made.json()).password;
    res = await fetch(`${API}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, password }) });
  } else res = await fetch(`${API}/api/signup`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, password }) });
  if (!res.ok) throw new Error(`account ${name}: ${res.status}`);
  const cookie = res.headers.get('set-cookie').split(';')[0];
  const call = async (method, route, body) => { const r = await fetch(API + route, { method, headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: body ? JSON.stringify(body) : undefined }); return r.status === 204 ? null : r.json(); };
  const a = { name, password, call, doc: null };
  a.change = async (fn) => { // change its doc the way a page does, and sync
    const cur = await call('GET', '/api/sync?rev=-1');
    const doc = E.normalize(cur.doc);
    const out = fn(doc, Date.now());
    await call('POST', '/api/sync', { rev: cur.rev, doc });
    a.doc = doc;
    return out;
  };
  await a.change((doc, t) => E.setSettings(doc, { share: 'all', name: display }, t));
  a.code = (await call('GET', '/api/friends')).code;
  return a;
}
// A friend to join: in the middle of a block.
async function makePal() {
  const pal = await account(`pal${tag}`, 'Dana');
  await pal.change((doc, t) => E.start(doc, { intention: 'Thesis chapter 2', minutes: 50, style: 'ask' }, t - 12 * 60000));
  return pal;
}

(async () => {
  const ver = await (await fetch(`http://${chromeIp}:9222/json/version`)).json();
  ws = new WebSocket(ver.webSocketDebuggerUrl.replace(/ws:\/\/[^/]+/, `ws://${chromeIp}:9222`));
  await new Promise((r) => { ws.onopen = r; });
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      const p = pending.get(m.id); pending.delete(m.id);
      if (m.error) p.no(new Error(`${p.method}: ${m.error.message}`)); else p.ok(m.result);
    } else listeners.forEach((l) => l(m));
  };
  const pal = (!ONLY || ONLY.includes('friends')) ? await makePal() : null;
  const me = `walker${tag}`;
  const signIn = `${click('#welcome-signin')} await wait(300); { const f = document.querySelector('#account-form'); f.name.value = ${JSON.stringify(me)}; f.password.value = 'walker password'; f.requestSubmit(); } await wait(2500);`;
  const skipIntro = `${click('#welcome-start')} await wait(300); if (!document.querySelector('#v-remind').hidden) ${click('#remind-later')} await wait(300);`;

  // 1. iPad from the Home Screen, no account: the first run and a block with every tool.
  await device('ipad', { ...ipad, standalone: true }, [
    { name: '01-welcome', js: visible },
    { name: '02-remind', js: `${click('#welcome-start')} await wait(300); ${visible}` },
    { name: '03-home', js: `${click('#remind-later')} await wait(300); ${visible}` },
    { name: '04-run', js: `${start('Write the intro', "f.step.value = 'Open the doc and write one sentence';")} ${visible}`, wait: 1500 },
    { name: '05-checkin', js: `${dueNow} ${visible}`, wait: 1200 },
    { name: '06-why', js: `${click('[data-ans="drifted"]')} await wait(400); ${visible}` },
    { name: '07-park', js: `${click('[data-why="phone"]')} await wait(300); ${click('#t-park')} document.querySelector('#park').text.value = 'Email the landlord'; await wait(200); ${visible}` },
    { name: '08-later-tab-live', js: `document.querySelector('#park').requestSubmit(); await wait(500); ${click('[data-tab="later"]')} await wait(500); return [document.querySelector('#live').hidden ? 'no pill' : 'live pill', document.querySelector('#later-list').innerText]` },
    { name: '09-stop-alert', js: `${click('#live')} await wait(400); ${click('#stop')} await wait(400); return document.querySelector('#alert-title').textContent` },
    { name: '10-outcome', js: `${yes} ${visible}` },
    { name: '11-cafe', js: `${click('[data-out="partly"]')} await wait(500); ${click('[data-tab="cafe"]')} await wait(600); return document.querySelector('#hist').innerText.slice(0, 120)` },
    { name: '12-cats', js: `${click('[data-tab="cats"]')} await wait(600); return document.querySelector('#cats-lede').textContent` },
    { name: '13-settings', js: `${click('[data-tab="settings"]')} await wait(600); ${visible}` },
    { name: '14-account', js: `${click('[data-go="account"]')} await wait(300); ${click('[data-tab-acct="signup"]')} await wait(200); ${visible}` },
    { name: '15-signed-in', js: `{ const f = document.querySelector('#account-form'); f.name.value = ${JSON.stringify(me)}; f.password.value = 'walker password'; f.requestSubmit(); } await wait(2500); if (!document.querySelector('#v-remind').hidden) ${click('#remind-later')} ${click('[data-tab="settings"]')} await wait(700); return document.querySelector('#acct-title').textContent`, wait: 1200 },
  ]);

  // 2. A finished block, Done, confetti, and meeting Pepper (first finished block).
  await device('meet', { ...ipad, standalone: true }, [
    { name: '1-outcome', js: `${skipIntro} ${finished('Read chapter 3')} ${visible}` },
    { name: '2-confetti', js: `${click('[data-out="done"]')} await wait(450); ${visible}`, wait: 150 },
    { name: '3-meet', js: `await wait(1500); return document.querySelector('#meet-title').textContent`, wait: 1300 },
    { name: '4-cats', js: `${click('#meet-pick')} await wait(400); ${click('[data-tab="cats"]')} await wait(700); return document.querySelector('#cats-lede').textContent` },
    { name: '5-home', js: `${click('[data-tab="focus"]')} await wait(700); return document.querySelector('#today-min').textContent + ' / ' + document.querySelector('#streak-n').textContent` },
  ]);

  // 3. iPad landscape and a Mac: the sidebar.
  await device('landscape', { width: 1180, height: 820, ua: IPAD_UA, platform: 'MacIntel', touch: true, standalone: true }, [
    { name: '1-home', js: `${skipIntro} ${visible}` },
    { name: '2-run', js: `${start('Thesis chapter 2')} ${visible}`, wait: 1500 },
    { name: '3-cafe-live', js: `${click('[data-tab="cafe"]')} await wait(600); return document.querySelector('#live').hidden ? 'no pill' : 'pill'` },
  ]);
  await device('mac', { width: 1440, height: 900, ua: MAC_UA, platform: 'MacIntel', touch: false, standalone: false }, [
    { name: '1-welcome', js: visible },
    { name: '2-home', js: `${skipIntro} ${finished('Inbox to zero')} ${click('[data-out="done"]')} await wait(2200); if (!document.querySelector('#meet').hidden) ${click('#meet-ok')} await wait(400); ${visible}`, wait: 1200 },
    { name: '3-cats', js: `document.dispatchEvent(new KeyboardEvent('keydown', { key: '4', metaKey: true })); await wait(700); ${visible}` },
    { name: '4-settings', js: `document.dispatchEvent(new KeyboardEvent('keydown', { key: ',', metaKey: true })); await wait(700); ${visible}` },
  ]);

  // 4. Dark mode and a phone.
  await device('dark', { ...ipad, standalone: true, dark: true }, [
    { name: '1-home', js: `${skipIntro} ${visible}` },
    { name: '2-checkin', js: `${start('Read chapter 3')} ${dueNow} ${visible}`, wait: 1300 },
    { name: '3-run', js: `${click('[data-ans="yes"]')} await wait(500); ${visible}` },
    { name: '4-cats', js: `${click('[data-tab="cats"]')} await wait(600); ${visible}` },
  ]);
  await device('phone', { width: 390, height: 844, ua: ANDROID_UA, platform: 'Linux armv8l', touch: true, standalone: false }, [
    { name: '1-welcome', js: visible },
    { name: '2-home', js: `${skipIntro} ${visible}` },
    { name: '3-run', js: `${start('Inbox to zero')} return [${visible.slice(7)}, document.querySelector('.toolbar').getBoundingClientRect().bottom <= innerHeight ? 'toolbar on screen' : 'TOOLBAR OFF THE SCREEN']`, wait: 1500 },
    { name: '4-checkin', js: `${dueNow} ${visible}`, wait: 1300 },
    { name: '5-breathe', js: `${click('[data-ans="yes"]')} await wait(300); D.act((doc) => { E.running(doc).start -= 20000; }); refresh(); ${click('#stop')} ${yes} ${click('[data-out=""]')} await wait(400); location.hash = 'breathe'; await wait(4500); ${visible}` },
  ]);

  // 4b. The Cat Café: a kitten grows, wanders off when you leave, comes home when you stay;
  // the café by day, week, month and year, the shop, tags.
  const grow = (p) => `D.act((doc, t) => { const b = E.running(doc); const shift = ${p} * (b.end - b.start) - (t - b.start); b.start -= shift; b.end -= shift; for (const x of b.plan) x.at -= shift; }); refresh(); await wait(500);`;
  const CATS = ['miso', 'pepper', 'mochi', 'pickles', 'noodle', 'earl', 'biscuit', 'boo', 'luna', 'cocoa'];
  const TAGS = ['Work', 'Study', 'Reading', 'Writing', ''];
  // Past blocks: n of them over the last `days` days, most coming home, a few wandering off.
  const past = (n, days) => `D.act((doc, t) => { for (let i = 0; i < ${n}; i++) { const at = t - 3600000 - Math.floor(((i * 7919) % 1000) / 1000 * ${days} * 86400000); const b = E.start(doc, { intention: 'Block ' + i, minutes: 20 + (i * 13) % 40, cat: ${JSON.stringify(CATS)}[i % ${CATS.length}], tag: ${JSON.stringify(TAGS)}[i % 5] }, at); if (i % 6 === 5) E.stop(doc, at + 600000); E.tick(doc, b.end + 1); b.closed = true; } }); refresh(); await wait(500);`;
  const noMeets = `for (let i = 0; i < 12 && !document.querySelector('#meet').hidden; i++) { ${click('#meet-ok')} await wait(250); }`;
  await device('cafe', { ...ipad, standalone: true }, [
    { name: '01-home', js: `${skipIntro} return [document.querySelector('#invite-name').textContent, document.querySelector('#tags').innerText]` },
    { name: '02-invite', js: `${click('#invite')} await wait(500); ${visible}` },
    { name: '03-nap', js: `${click('#invite-done')} await wait(300); ${click('[data-tag="Study"]')} ${start('Read chapter 3')} return document.querySelector('#kitten-says').textContent`, wait: 1500 },
    { name: '04-kitten', js: `${grow(0.5)} return document.querySelector('#kitten-says').textContent`, wait: 1600 },
    { name: '05-grown', js: `${grow(0.85)} return document.querySelector('#kitten-says').textContent`, wait: 1600 },
    { name: '06-came-home', js: `${grow(1.01)} await wait(1300); return document.querySelector('#outcome-kitten').textContent`, wait: 1200 },
    { name: '07-away', js: `${click('[data-out="done"]')} await wait(2500); if (!document.querySelector('#meet').hidden) ${click('#meet-ok')} ${start('Write the intro')} ${grow(0.4)} pref('left', String(Date.now() - 60000)); backInKavana(); await wait(900); return document.querySelector('#kitten-says').textContent`, wait: 1500 },
    { name: '08-outcome-gone', js: `${grow(1.01)} await wait(1300); return document.querySelector('#outcome-kitten').textContent`, wait: 1200 },
    { name: '09-cafe-day', js: `${click('[data-out="partly"]')} await wait(400); ${past(5, 0.6)} ${noMeets} ${click('[data-tab="cafe"]')} await wait(900); return document.querySelector('#cafe-tiles').innerText`, wait: 1500 },
    { name: '10-shop', js: `D.act((doc) => { doc.tally.banked = 3000; }); ${click('[data-go="shop"]')} await wait(700); ${visible}`, wait: 1500 },
    { name: '11-bought', js: `document.querySelector('[data-buy="cushion"]').click(); ${yes} D.act((doc, t) => { for (const id of ['rug', 'window', 'plant', 'cattree', 'lamp', 'box', 'armchair', 'clock']) if (!E.owns(doc, id)) E.buy(doc, id, t); }); ${click('[data-tab="cafe"]')} await wait(900); return document.querySelector('#cafe-treats').textContent`, wait: 1500 },
    { name: '12-cafe-week', js: `${past(30, 6)} ${noMeets} ${click('[data-span="week"]')} await wait(900); return document.querySelector('#cafe-now').textContent`, wait: 1500 },
    { name: '13-cafe-month', js: `${past(60, 28)} ${noMeets} ${click('[data-span="month"]')} await wait(900); return document.querySelector('#cafe-tiles').innerText`, wait: 1500 },
    { name: '14-cafe-year', js: `D.act((doc, t) => { for (const id of ['bookshelf', 'counter', 'fishbowl', 'yarnbasket']) if (!E.owns(doc, id)) E.buy(doc, id, t); }); ${click('[data-span="year"]')} await wait(900); return document.querySelector('#cafe-tiles').innerText`, wait: 1500 },
    { name: '15-adopt', js: `${click('[data-go="shop"]')} await wait(500); document.querySelector('[data-buy="luna"]').click(); ${yes} await wait(1200); return document.querySelector('#meet-title').textContent`, wait: 1300 },
    { name: '16-my-cats', js: `${click('#meet-pick')} await wait(400); ${click('[data-pane="cats"]')} await wait(700); return document.querySelector('#cats-lede').textContent`, wait: 1300 },
    { name: '17-tags', js: `location.hash = 'tags'; await wait(500); const f = document.querySelector('#tag-add'); f.text.value = 'Deep work'; f.requestSubmit(); await wait(500); return state.settings.tags`, wait: 1000 },
  ]);
  await device('cafe-dark', { ...ipad, standalone: true, dark: true }, [
    { name: '1-cafe', js: `${skipIntro} ${past(8, 0.5)} ${noMeets} D.act((doc, t) => { doc.tally.banked = 3000; for (const id of ['rug', 'window', 'plant', 'cattree', 'cushion', 'box', 'armchair', 'lamp']) E.buy(doc, id, t); }); ${click('[data-tab="cafe"]')} await wait(900); ${visible}`, wait: 1500 },
    { name: '2-run', js: `${click('[data-tab="focus"]')} await wait(300); ${start('Read chapter 3')} ${grow(0.6)} ${visible}`, wait: 1500 },
  ]);
  await device('cafe-phone', { width: 390, height: 844, ua: ANDROID_UA, platform: 'Linux armv8l', touch: true, standalone: false }, [
    { name: '1-cafe', js: `${skipIntro} ${past(6, 0.5)} ${noMeets} D.act((doc, t) => { doc.tally.banked = 3000; for (const id of ['rug', 'window', 'cattree', 'cushion', 'armchair']) E.buy(doc, id, t); }); ${click('[data-tab="cafe"]')} await wait(900); ${visible}`, wait: 1500 },
    { name: '2-shop', js: `${click('[data-go="shop"]')} await wait(700); ${visible}`, wait: 1200 },
    { name: '3-run', js: `${click('[data-tab="focus"]')} await wait(300); ${start('Read chapter 3')} ${grow(0.6)} ${visible}`, wait: 1500 },
  ]);
  // 4a2. The living café (round A): the home is the café wall with the window and one button, the ring sets
  // how long, the clock opens the sheet, the menu slides in; Start dives into the window, the sky goes
  // to sunset and stars, the cat comes home into the 3D café and Again starts the same block; leaving
  // makes the kitten tiptoe out; the Café tab is the 3D room, furnished, turned and tapped.
  const ringAt = (min) => `{ const w = document.querySelector('#home-window'), r = w.getBoundingClientRect(), a = ${min} / 120 * Math.PI * 2, R = r.width * 0.46;
    const at = (k) => ({ clientX: r.left + r.width / 2 + Math.sin(a * k) * R, clientY: r.top + r.height / 2 - Math.cos(a * k) * R, pointerId: 1, bubbles: true });
    w.dispatchEvent(new PointerEvent('pointerdown', at(0.6))); w.dispatchEvent(new PointerEvent('pointermove', at(0.8))); w.dispatchEvent(new PointerEvent('pointermove', at(1))); w.dispatchEvent(new PointerEvent('pointerup', at(1))); } await wait(300);`;
  const homeSays = `return [document.querySelector('#home-clock').textContent, document.querySelector('#home-line').textContent]`;
  const furnish = `D.act((doc, t) => { doc.tally.banked = 4000; for (const id of ['rug', 'window', 'plant', 'cattree', 'cushion', 'box', 'armchair', 'lamp', 'clock', 'bookshelf', 'counter', 'yarnbasket', 'fishbowl']) if (!E.owns(doc, id)) E.buy(doc, id, t); });`;
  const tipText = `(document.querySelector('#room .cafe3d-tip').hidden ? 'no tip' : document.querySelector('#room .cafe3d-tip').innerText.replace(/\\n/g, ' · '))`;
  for (const [label, dev] of [['living', { ...ipad, standalone: true }], ['living-phone', { width: 390, height: 844, ua: ANDROID_UA, platform: 'Linux armv8l', touch: true, standalone: true }], ['living-dark', { ...ipad, standalone: true, dark: true }]]) {
    await device(label, dev, [
      { name: '01-home', js: `${skipIntro} ${homeSays}` },
      { name: '02-ring-15', js: `${ringAt(15)} ${homeSays}` },
      { name: '03-ring-50', js: `${ringAt(50)} ${homeSays}` },
      { name: '04-options', js: `${click('#home-clock')} await wait(500); ${visible}` },
      { name: '05-menu', js: `${click('#options-done')} await wait(200); ${click('#menu-btn')} await wait(500); return [document.body.classList.contains('menu-open') ? 'menu open' : 'MENU SHUT', document.querySelector('#sidebar .sb-item.on').textContent]` },
      { name: '06-dive', js: `${click('#menu-scrim')} await wait(300); { const f = document.querySelector('#start'); f.intention.value = 'Write the intro'; f.requestSubmit(); } await wait(450); return document.querySelector('#sky').className`, wait: 80 },
      { name: '07-afternoon', js: `await wait(1200); ${grow(0.2)} return document.body.classList.contains('dusk') ? 'dusk' : 'day'`, wait: 1200 },
      { name: '08-sunset', js: `${grow(0.55)} return document.querySelector('#kitten-says').textContent`, wait: 1500 },
      { name: '09-stars', js: `${grow(0.9)} return [document.body.classList.contains('dusk') ? 'dusk' : 'DAY', getComputedStyle(document.querySelector('#sky')).getPropertyValue('--stars')]`, wait: 1500 },
      { name: '10-homecoming', js: `${grow(1.01)} await wait(1250); return [document.querySelector('#outcome').className, homeCafe.count() + ' in the café']`, wait: 60 },
      { name: '11-came-home', js: `await wait(2200); return document.querySelector('#outcome-kitten').textContent`, wait: 600 },
      { name: '12-again', js: `${click('#again')} await wait(900); ${noMeets} return [document.querySelector('#run-intention').textContent, document.querySelector('#run-clock').textContent]`, wait: 1200 },
      { name: '13-tiptoe', js: `${grow(0.4)} pref('left', String(Date.now() - 60000)); backInKavana(); await wait(450); return document.querySelector('#kitten .tiptoe') ? 'tiptoeing' : 'NO TIPTOE'`, wait: 60 },
      { name: '14-gone', js: `await wait(1600); return document.querySelector('#kitten-says').textContent`, wait: 400 },
      { name: '15-cafe', js: `${click('#stop')} ${yes} ${click('[data-out=""]')} await wait(500); ${noMeets} ${past(6, 0.4)} ${noMeets} ${furnish} ${click('[data-tab="cafe"]')} await wait(1500); return [cafe3.count() + ' cats', document.querySelector('#cafe-tiles').innerText.split('\\n').slice(0, 2).join(' ')]`, wait: 1800 },
      { name: '16-week', js: `${past(16, 5)} ${noMeets} ${click('[data-span="week"]')} await wait(1500); return cafe3.count() + ' cats in a ' + cafe3.scene.n + '-tile room'`, wait: 2200 },
      { name: '17-turned', js: `cafe3.spin(1); await wait(1500); return cafe3.view.quarter()`, wait: 600 },
      { name: '17b-behind', js: `cafe3.spin(1); await wait(1500); return cafe3.view.quarter()`, wait: 600 },
      { name: '18-tap', js: `cafe3.pokeCat(); await wait(300); return ${tipText}`, wait: 300 },
    ]);
  }

  // 4b. A long history: four blocks a day since January 2025, more than 2000, so the oldest are folded
  // into doc.past (cafe-past), and the same history kept whole (cafe-whole, KEEP set to Infinity in the
  // page and never reloaded). Each step prints what the café counts, so the two can be compared.
  const long = (keep) => `E.config.KEEP = ${keep}; E.config.BYTES = ${keep === 'Infinity' ? 'Infinity' : 'E.config.BYTES'}; D.act((doc) => { const days = Math.round((new Date().setHours(0, 0, 0, 0) - new Date(2025, 0, 5).getTime()) / 86400000);
    for (let k = 0; k < days * 4; k++) { const s = new Date(2025, 0, 5 + Math.floor(k / 4), [5, 9, 14, 22][k % 4], k % 7).getTime(); const b = E.start(doc, { intention: 'Block ' + k, minutes: [25, 50, 125, 30][k % 4], cat: ${JSON.stringify(CATS)}[k % ${CATS.length}], tag: ${JSON.stringify(TAGS)}[k % 5] }, s); if (k % 9 === 4) E.stop(doc, s + 600000); E.tick(doc, b.end + 1); b.closed = true; } }); refresh(); await wait(500);`;
  const counts = `return ['#cafe-now', '#cafe-tiles', '#taglegend', '#cattally', '#hours-foot'].map((s) => document.querySelector(s).innerText.replace(/\\n/g, ' ')).concat([cafe3.scene.cats.length + ' in the room', document.querySelectorAll('#chart rect:not(.none)').length + ' bar parts', document.querySelector('#hist').innerText.split('\\n').slice(-1)[0]]).join(' | ')`;
  const at = (span, y, m, d) => `cafe.span = '${span}'; cafe.at = new Date(${y}, ${m}, ${d}, 12).getTime(); renderCafe(); await wait(900); window.scrollTo(0, 0);`;
  // The month the fold mark is in. The mark comes from the block count or the doc's size, whichever folds more,
  // so the whole copy (which has none) works out where it would be by folding a throwaway copy of itself.
  const markMonth = `let mark = D.doc.past.to; if (!mark) { const was = { ...E.config }; Object.assign(E.config, { KEEP: 2000, BYTES: 800000 }); mark = E.normalize(JSON.parse(JSON.stringify(D.doc))).past.to; Object.assign(E.config, was); }
    cafe.span = 'month'; cafe.at = mark - 3600000; renderCafe(); await wait(900); window.scrollTo(0, 0);`;
  for (const [label, keep] of [['cafe-past', 2000], ['cafe-whole', 'Infinity']]) {
    await device(label, { ...ipad, standalone: true }, [
      { name: '1-year', js: `${skipIntro} ${long(keep)} ${noMeets} D.act((doc, t) => { doc.tally.banked = 3000; for (const id of ['rug', 'window', 'plant', 'cattree', 'cushion', 'box', 'armchair', 'lamp']) E.buy(doc, id, t); }); ${click('[data-tab="cafe"]')} await wait(900); ${at('year', 2025, 5, 1)} ${counts}`, wait: 2500 },
      { name: '2-year-charts', js: `${scrollToSel('#cafe-charts')} ${counts}`, wait: 1000 },
      { name: '3-year-end', js: `window.scrollTo(0, document.body.scrollHeight); await wait(300); return document.querySelector('#hist').innerText.split('\\n').slice(-3).join(' / ')`, wait: 1000 },
      { name: '4-month-mark', js: `${markMonth} ${counts}`, wait: 2000 },
      { name: '5-month-past', js: `${at('month', 2025, 2, 1)} await wait(600); (cafe3.pokeCat('past-') || cafe3.pokeCat()); await wait(200); return document.querySelector('#room .cafe3d-tip').innerText.replace(/\\n/g, ' · ') + ' | ' + (${counts.replace(/^return /, '')})`, wait: 600 },
      { name: '6-month-past-charts', js: `${scrollToSel('#cafe-charts')} ${counts}`, wait: 1000 },
      { name: '7-week-past', js: `${at('week', 2025, 2, 12)} ${counts}`, wait: 2000 },
      { name: '8-day-past', js: `${at('day', 2025, 2, 12)} ${counts}`, wait: 2000 },
      { name: '9-day-past-charts', js: `${scrollToSel('#cafe-charts')} ${counts}`, wait: 1000 },
      // a past with no blocks left (rare: every block kept was cancelled) is still a history, until Clear My History
      ...(keep === 2000 ? [
        { name: '10-past-no-blocks', js: `D.act((doc) => { for (const b of doc.blocks) b.cancelled = true; }); ${at('year', 2025, 5, 1)} return [E.history(D.doc).length, E.pastDays(D.doc).length, ...['#hist-empty', '#clear', '#habits'].map((s) => s + (document.querySelector(s).hidden ? ' hidden' : ' shown'))].join(', ')`, wait: 1500 },
        { name: '11-cleared', js: `${click('#clear')} ${yes} renderCafe(); await wait(500); return [E.pastDays(D.doc).length, E.treats(D.doc).left, ...['#hist-empty', '#clear', '#habits'].map((s) => s + (document.querySelector(s).hidden ? ' hidden' : ' shown'))].join(', ')`, wait: 1500 },
      ] : []),
    ]);
  }

  // 4b2. A history too big for the server (it takes 1 MB). Blocks with long notes fold by size as they're
  // made, so sync keeps going (2-folds), and a doc that comes in too big anyway (folding off in this page)
  // is folded by the server, which takes it (3-server-folds). Past that, when the server still says no
  // (faked here, since nothing real gets there), the page says so (4-5), until a sync goes through (6).
  // Needs the state dir, for an account that doesn't use up the sign-ups.
  if (STATE && (!ONLY || ONLY.includes('sync-big'))) {
    const bigName = `bigdoc${tag}`;
    const token = fs.readFileSync(path.join(STATE, 'admin-token'), 'utf8').trim();
    const made = await fetch(`http://127.0.0.1:${new URL(API).port}/admin/add-user`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Admin-Token': token }, body: JSON.stringify({ name: bigName }) });
    if (!made.ok) throw new Error(`add-user ${bigName}: ${made.status}`);
    const bigPass = (await made.json()).password;
    const fatBlock = `const b = E.start(doc, { intention: 'Long notes ' + k, minutes: 25 }, s); for (let i = 0; i < 30; i++) E.park(doc, ('Thought ' + i + ' ').padEnd(200, 'x'), s + 60000); E.tick(doc, b.end + 1); b.closed = true;`;
    const t0 = 'Date.now() - 400 * 86400000';
    const syncState = `return [Math.round(E.size(D.doc) / 1000) + ' KB', E.pastDays(D.doc).length + ' days in the past', 'trouble: ' + D.syncTrouble, document.querySelector('#acct-sub').textContent]`;
    const waitFor = (cond, ms = 12000) => `for (let i = 0; i < ${ms / 250} && !(${cond}); i++) await wait(250);`;
    await device('sync-big', { ...ipad, standalone: true }, [
      { name: '1-signed-in', js: `${click('#welcome-signin')} await wait(300); { const f = document.querySelector('#account-form'); f.name.value = ${JSON.stringify(bigName)}; f.password.value = ${JSON.stringify(bigPass)}; f.requestSubmit(); } await wait(2500); if (!document.querySelector('#v-remind').hidden) ${click('#remind-later')} ${click('[data-tab="settings"]')} await wait(700); ${syncState}`, wait: 600 },
      { name: '2-folds', js: `D.act((doc) => { const t0 = ${t0}; for (let k = 0; k < 170; k++) { const s = t0 + k * 3600000; ${fatBlock} } }); await wait(4000); ${syncState}`, wait: 600 },
      { name: '3-server-folds', js: `E.config.BYTES = Infinity; D.act((doc) => { const t0 = ${t0} + 200 * 3600000; for (let k = 0; k < 400 && E.size(doc) < 1030000; k++) { const s = t0 + k * 3600000; ${fatBlock} } }); await wait(5000);
        const r = await (await fetch('api/sync?rev=0', { credentials: 'same-origin' })).json(); return ['here ' + Math.round(E.size(D.doc) / 1000) + ' KB', 'on the server ' + Math.round(E.size(r.doc) / 1000) + ' KB with ' + E.pastDays(r.doc).length + ' days in the past', 'trouble: ' + D.syncTrouble]`, wait: 600, shot: false },
      { name: '4-too-big', js: `const real = window.fetch; window.__fetch = real; window.fetch = (u, o) => (String(u).includes('api/sync') && o && o.method === 'POST' ? Promise.resolve(new Response('{"error":"too big"}', { status: 413, headers: { 'Content-Type': 'application/json' } })) : real(u, o));
        D.act(() => {}); ${waitFor('D.syncTrouble')} await wait(200); return [document.querySelector('#toast').hidden ? 'no toast' : document.querySelector('#toast').textContent].concat((() => { ${syncState} })())`, wait: 150 },
      { name: '5-account', js: `${click('[data-go="account"]')} await wait(500); return document.querySelector('#who-sub').textContent`, wait: 600 },
      { name: '6-back', js: `window.fetch = window.__fetch; E.config.BYTES = 800000; D.act(() => {}); ${waitFor('!D.syncTrouble')} ${click('[data-tab="settings"]')} await wait(700); ${syncState}`, wait: 600 },
    ]);
  }

  // 4c. Missions, on a known day (a Wednesday evening): three blocks that do every kind.
  const dayBlocks = `D.act((doc) => { const d = new Date(); d.setHours(0, 0, 0, 0); const at = (h) => d.getTime() + h * 3600000;
    const a = E.start(doc, { intention: 'Morning pages', minutes: 50, step: 'Open the notebook', tag: 'Writing' }, at(7)); E.park(doc, 'Call the bank', at(7.2)); E.tick(doc, a.end); E.outcome(doc, a.id, 'done', a.end);
    const b = E.start(doc, { intention: 'Thesis chapter 2', minutes: 50, tag: 'Study' }, at(13)); E.tick(doc, b.end); E.outcome(doc, b.id, 'done', b.end); }); refresh(); await wait(600);`;
  const evening = `D.act((doc) => { const d = new Date(); d.setHours(19, 0, 0, 0); const c = E.start(doc, { intention: 'Inbox to zero', minutes: 25 }, d.getTime()); E.tick(doc, c.end); E.outcome(doc, c.id, 'partly', c.end); }); refresh(); await wait(600);`;
  const missionText = `return [...document.querySelectorAll('#pane-missions .mission')].map((r) => r.innerText.replace(/\\n/g, ' / '))`;
  await device('missions', { ...ipad, standalone: true, clock: '2026-10-21T20:30:00' }, [
    { name: '1-home', js: `${skipIntro} return document.querySelector('#home-missions').textContent` },
    { name: '2-missions', js: `${click('#home-missions-row')} await wait(600); ${missionText}`, wait: 1000 },
    { name: '3-two-blocks', js: `${dayBlocks} ${noMeets} ${missionText}`, wait: 1200 },
    { name: '4-done-toast', js: `${evening} ${noMeets} await wait(300); return [document.querySelector('#toast').textContent, document.querySelector('#cats-treats').textContent]`, wait: 300 },
    { name: '5-all-done', js: `await wait(2500); ${missionText}`, wait: 600 },
    { name: '6-home', js: `${click('[data-tab="focus"]')} await wait(500); return document.querySelector('#home-missions').textContent` },
  ]);
  await device('missions-dark', { ...ipad, standalone: true, dark: true, clock: '2026-10-21T20:30:00' }, [
    { name: '1-missions', js: `${skipIntro} ${dayBlocks} ${noMeets} location.hash = 'missions'; await wait(700); ${missionText}`, wait: 1200 },
  ]);

  // 4d. Halloween: the shop's limited section (with the page clock on Oct 27), and the week before.
  const HALLOWEEN = ['pumpkin', 'jackolantern', 'candles', 'batgarland', 'cauldron'];
  await device('halloween', { ...ipad, standalone: true, clock: '2026-10-27T17:00:00' }, [
    { name: '1-shop', js: `${skipIntro} D.act((doc) => { doc.tally.banked = 3000; }); location.hash = 'shop'; await wait(800); return document.querySelector('#shop-event').innerText.slice(0, 160)`, wait: 1500 },
    { name: '2-adopt', js: `document.querySelector('[data-buy="pumpkin"]').click(); ${yes} await wait(1200); return document.querySelector('#meet-title').textContent`, wait: 1300 },
    { name: '3-cafe', js: `${click('#meet-ok')} await wait(300); D.act((doc, t) => { for (const id of ${JSON.stringify(HALLOWEEN.slice(1))}.concat(['rug', 'window', 'cattree', 'cushion', 'armchair', 'lamp', 'plant'])) if (!E.owns(doc, id)) E.buy(doc, id, t); }); ${past(6, 0.3)} ${noMeets} ${click('[data-tab="cafe"]')} await wait(900); return document.querySelector('#event-banner').textContent`, wait: 1500 },
    { name: '4-cats', js: `${click('[data-tab="cats"]')} await wait(600); location.hash = 'cats'; await wait(500); return [...document.querySelectorAll('#catgrid .catcard b')].map((b) => b.textContent).join(', ')` },
    { name: '5-run', js: `D.act((doc, t) => E.setSettings(doc, { companion: 'pumpkin' }, t)); ${click('[data-tab="focus"]')} await wait(300); ${start('Carve the pumpkins')} ${grow(0.8)} return document.querySelector('#kitten-says').textContent`, wait: 1500 },
  ]);
  await device('halloween-dark', { ...ipad, standalone: true, dark: true, clock: '2026-10-29T21:00:00' }, [
    { name: '1-cafe', js: `${skipIntro} D.act((doc, t) => { doc.tally.banked = 3000; for (const id of ${JSON.stringify(HALLOWEEN)}.concat(['rug', 'window', 'cattree', 'cushion', 'lamp'])) E.buy(doc, id, t); }); ${past(5, 0.3)} ${noMeets} ${click('[data-tab="cafe"]')} await wait(900); ${visible}`, wait: 1500 },
  ]);
  await device('halloween-soon', { ...ipad, standalone: true, clock: '2026-10-21T12:00:00' }, [
    { name: '1-teaser', js: `${skipIntro} location.hash = 'shop'; await wait(800); return document.querySelector('#shop-event').innerText`, wait: 1000 },
  ]);
  await device('halloween-after', { ...ipad, standalone: true, clock: '2026-11-03T12:00:00' }, [
    { name: '1-shop', js: `${skipIntro} location.hash = 'shop'; await wait(800); return [document.querySelector('#shop-event').innerText, [...document.querySelectorAll('#pane-shop [data-buy]')].map((b) => b.dataset.buy).filter((id) => ${JSON.stringify(HALLOWEEN)}.includes(id))]`, wait: 1000 },
  ]);

  // 4d'. Winter (with the page clock in December): the shop's corner and the café with its things.
  const WINTER = ['flurry', 'snowglobe', 'sled', 'snowman', 'fireplace'];
  await device('winter', { ...ipad, standalone: true, clock: '2026-12-20T17:00:00' }, [
    { name: '1-shop', js: `${skipIntro} D.act((doc) => { doc.tally.banked = 4000; }); location.hash = 'shop'; await wait(800); return document.querySelector('#shop-event').innerText.slice(0, 160)`, wait: 1500 },
    { name: '2-cafe', js: `D.act((doc, t) => { for (const id of ${JSON.stringify(WINTER)}.concat(['rug', 'window', 'cattree', 'cushion', 'armchair', 'lamp', 'plant', 'clock'])) if (!E.owns(doc, id)) E.buy(doc, id, t); }); ${past(6, 0.3)} ${noMeets} ${click('[data-tab="cafe"]')} await wait(900); window.scrollTo(0, 0); return document.querySelector('#event-banner').textContent`, wait: 1500 },
    { name: '3-no-window', js: `D.act((doc) => { doc.owned = doc.owned.filter((x) => x.id !== 'window'); }); refresh(); await wait(800); return 'globe on the floor'`, wait: 1200 },
  ]);
  await device('winter-dark', { ...ipad, standalone: true, dark: true, clock: '2027-01-02T21:00:00' }, [
    { name: '1-cafe', js: `${skipIntro} D.act((doc, t) => { doc.tally.banked = 4000; for (const id of ${JSON.stringify(WINTER)}.concat(['rug', 'window', 'cattree', 'cushion', 'lamp'])) E.buy(doc, id, t); E.setSettings(doc, { theme: 'classic' }, t); }); ${past(5, 0.3)} ${noMeets} ${click('[data-tab="cafe"]')} await wait(900); return 'ok'`, wait: 1500 },
  ]);

  // 4e. Napping together. You join Mira's block: her kitten grows in your ring. Then she leaves
  // Kavana, and after the grace every kitten wanders off. And the other way: Ana joins yours, and you
  // both make it to the end.
  const napOn = !ONLY || ONLY.some((x) => x.startsWith('nap'));
  if (napOn) {
    const mira = await account(`mira${tag}`, 'Mira');
    const napper = await account(`napper${tag}`, 'Sam');
    await napper.call('POST', '/api/friends/add', { code: mira.code });
    await mira.change((doc, t) => E.start(doc, { intention: 'Lab report', minutes: 40, cat: 'pepper' }, t - 14 * 60000));
    const napIn = `${click('#welcome-signin')} await wait(300); { const f = document.querySelector('#account-form'); f.name.value = ${JSON.stringify(napper.name)}; f.password.value = ${JSON.stringify(napper.password)}; f.requestSubmit(); } await wait(2500); if (!document.querySelector('#v-remind').hidden) ${click('#remind-later')} ${click('[data-tab="focus"]')} await wait(300); await loadFriends(true); drawFriendsHome(); await wait(300);`;
    await device('nap', { ...ipad, standalone: true }, [
      { name: '1-friends', js: `${napIn} return document.querySelector('#friends-list').innerText` },
      { name: '2-join', js: `${click('[data-join]')} await wait(500); return document.querySelector('#join-text').textContent` },
      { name: '3-together', js: `${start('Read for class')} await wait(2000); return [document.querySelector('#run-friends').textContent, document.querySelector('#kitten-says').textContent, document.querySelector('#mates').innerText, document.querySelector('#t-pause').hidden ? 'no pause' : 'PAUSE SHOWN']`, wait: 1500 },
      { name: '4-mira-away', node: () => mira.call('POST', '/api/nap/left', { block: E.running(mira.doc).id }), js: `await wait(5500); return document.querySelector('#kitten-says').textContent`, wait: 600 },
      { name: '5-all-gone', js: `await wait(6000); return [document.querySelector('#kitten-says').textContent, document.querySelector('#toast').textContent]`, wait: 300 },
    ]);
    const ana = await account(`ana${tag}`, 'Ana');
    const host = await account(`host${tag}`, 'Lee');
    await ana.call('POST', '/api/friends/add', { code: host.code });
    const hostIn = napIn.replace(JSON.stringify(napper.name), JSON.stringify(host.name)).replace(JSON.stringify(napper.password), JSON.stringify(host.password));
    await device('nap-host', { ...ipad, standalone: true }, [
      { name: '1-run', js: `${hostIn} ${start('Write the intro')} ${grow(0.3)} return document.querySelector('#kitten-says').textContent`, wait: 1200 },
      { name: '2-ana-joins', node: async () => {
        const f = (await ana.call('GET', '/api/friends')).friends.find((x) => x.name === host.name);
        const b = await ana.change((doc, t) => E.start(doc, { intention: 'Problem set', minutes: 25, withEnd: f.end, withName: 'Lee', cat: 'mochi' }, t));
        await ana.call('POST', '/api/nap/join', { id: f.nap, block: b.id, cat: 'mochi', start: b.start });
      }, js: `await wait(6000); return [document.querySelector('#toast').textContent, document.querySelector('#run-friends').textContent, document.querySelector('#mates').innerText]`, wait: 300 },
      { name: '3-together', js: `await wait(2500); return document.querySelector('#kitten-says').textContent`, wait: 600 },
      { name: '4-home', js: `${grow(1.01)} await wait(1500); return document.querySelector('#outcome-kitten').textContent`, wait: 1200 },
    ]);
    await device('nap-phone', { width: 390, height: 844, ua: ANDROID_UA, platform: 'Linux armv8l', touch: true, standalone: false, dark: true }, [
      { name: '1-together', node: () => mira.change((doc, t) => E.start(doc, { intention: 'Lab report, take 2', minutes: 30, cat: 'boo' }, t - 20 * 60000)),
        js: `${napIn} ${click('[data-join]')} await wait(400); ${start('Flashcards')} await wait(2500); return document.querySelector('#mates').innerText`, wait: 1500 },
    ]);
  }

  // 4f. How bigger groups look in the ring (a made-up group, on a page without an account, so nothing
  // asks the server about it).
  const fakeNap = (n) => `nap = { id: 'fakenap1', block: state.active.id, end: state.active.end, host: false, broken: null,
    members: [{ name: 'me', display: 'Me', cat: 'miso', start: state.active.start, me: true }].concat(${JSON.stringify([['Mira', 'pepper'], ['Ana', 'mochi'], ['Lee', 'boo'], ['Kai', 'luna'], ['Noa', 'biscuit']])}
      .slice(0, ${n}).map(([d, c], i) => ({ name: d.toLowerCase(), display: d, cat: c, start: state.active.start - i * 400000, me: false, away: i === 2 }))) }; refresh(); await wait(700);`;
  await device('nap-layout', { ...ipad, standalone: true }, [
    { name: '1-two', js: `${skipIntro} ${start('Group study')} ${grow(0.5)} ${fakeNap(2)} return document.querySelector('#mates').innerText`, wait: 1500 },
    { name: '2-three', js: `${fakeNap(3)} return document.querySelector('#kitten-says').textContent`, wait: 1500 },
    { name: '3-five', js: `${grow(0.8)} ${fakeNap(5)} return document.querySelector('#mates').innerText`, wait: 1500 },
  ]);

  // 5. Focus with a friend, and the dashboard.
  if (pal) {
    await device('friends', { ...ipad, standalone: true }, [
      { name: '1-friends', js: `${signIn} if (!document.querySelector('#v-remind').hidden) ${click('#remind-later')} location.hash = 'friends'; await wait(700); const sel = document.querySelector('#share'); sel.value = 'all'; sel.dispatchEvent(new Event('change')); await wait(1500); const f = document.querySelector('#add-friend'); f.code.value = ${JSON.stringify(pal.code)}; f.requestSubmit(); await wait(1500); return document.querySelector('#friends-settings').innerText`, wait: 1200 },
      { name: '2-home', js: `${click('[data-tab="focus"]')} await wait(300); await loadFriends(true); drawFriendsHome(); await wait(300); return document.querySelector('#friends-list').innerText` },
      { name: '3-join', js: `${click('[data-join]')} await wait(500); return document.querySelector('#join-text').textContent` },
      { name: '4-together', js: `${start('Read for class')} return document.querySelector('#run-friends').textContent`, wait: 1500 },
    ]);
  }
  await device('admin', { ...ipad, standalone: true }, [
    { name: '1-dashboard', node: () => execFileSync('node', [path.join(__dirname, '../bin/kavana'), 'admin', me], { env: { ...process.env, KAVANA_STATE: STATE, KAVANA_PORT: new URL(API).port } }),
      js: `${signIn} D.act((doc, t) => { E.stop(doc, t); const b = E.awaiting(doc); if (b) E.outcome(doc, b.id, 'done', t); }); refresh(); location.hash = 'admin'; await wait(1500); return document.querySelector('#admin-body').innerText.slice(0, 100)`, wait: 1200 },
  ]);
  // 4f. Everything else Forest does: stopwatch, cancel, pauses, extra time, notes and edits, goals and
  // achievements, themes, sounds, shelter cats, news, your own lines, rankings, nap rooms.
  const forestOn = !ONLY || ONLY.some((x) => x.startsWith('forest'));
  const back = (min) => `D.act((doc, t) => { const b = E.running(doc); const d = ${min} * 60000; b.start -= d; b.end -= d; for (const x of b.plan) x.at -= d; }); refresh(); await wait(500);`;
  const yes2 = `await wait(350); document.querySelector('#alert [data-alert="1"]').click(); await wait(700);`;
  await device('forest', { ...ipad, standalone: true }, [
    { name: '01-start-stopwatch', js: `${skipIntro} ${click('[data-mode="stopwatch"]')} await wait(300); return [document.querySelector('#length-field').hidden, document.querySelector('#start-hint').textContent]` },
    { name: '02-cancel', js: `${start('Changed my mind')} await wait(400); const label = document.querySelector('#stop').textContent; ${click('#stop')} await wait(600); return [label, document.querySelector('#toast').textContent, E.history(D.doc).length]`, wait: 400 },
    { name: '03-stopwatch-run', js: `${start('Sketch the logo')} ${back(18)} await wait(1200); return [document.querySelector('#run-clock').textContent, document.querySelector('#stop').textContent, document.querySelector('#kitten-says').textContent]`, wait: 1500 },
    { name: '04-stopwatch-done', js: `${click('#stop')} await wait(400); const m = document.querySelector('#alert-msg').textContent; ${yes2} return [m, document.querySelector('#outcome-eyebrow').textContent, document.querySelector('#outcome-kitten').textContent]`, wait: 1200 },
    { name: '05-note', js: `${click('#outcome-note')} await wait(300); document.querySelector('#alert-input').value = 'Three logo ideas, the round one is best.'; ${yes2} ${click('[data-out="done"]')} await wait(2600); ${noMeets} return E.history(D.doc)[0].note`, wait: 600 },
    { name: '06-pause', js: `${click('[data-mode="timer"]')} ${start('Read chapter 3')} ${back(1)} ${click('#t-pause')} await wait(1200); return [document.querySelector('#run-meta').textContent, document.querySelector('#kitten-says').textContent]`, wait: 1200 },
    { name: '07-overtime', js: `${click('#t-pause')} await wait(300); D.act((doc, t) => { E.stop(doc, t); const b = E.awaiting(doc); E.outcome(doc, b.id, null, t); E.setSettings(doc, { overtime: true }, t); }); ${noMeets} refresh(); await wait(300); ${start('Write the intro')} ${back(28)} await wait(1500); return [document.querySelector('#run-eyebrow').textContent, document.querySelector('#run-clock').textContent, document.querySelector('#stop').textContent]`, wait: 1500 },
    { name: '08-goals', js: `${click('#stop')} ${yes2} ${click('[data-out="partly"]')} await wait(2500); ${noMeets} location.hash = 'missions'; await wait(800); return document.querySelector('#starter-steps').innerText.slice(0, 200)`, wait: 1200 },
    { name: '09-claim', js: `document.querySelector('#starter-steps [data-claim]').click(); await wait(500); return [document.querySelector('#toast').textContent, document.querySelector('#cats-treats').textContent]`, wait: 900 },
    { name: '10-achievements', js: `${scrollToSel('#achievements')} return document.querySelector('#ach-count').textContent`, wait: 900 },
    { name: '11-shop', js: `D.act((doc) => { doc.tally.banked = 5000; }); location.hash = 'shop'; await wait(700); ${scrollToSel('#shop-themes')} return [...document.querySelectorAll('#shop-themes b, #shop-sounds b')].map((b) => b.textContent).join(', ')`, wait: 1200 },
    { name: '12-night-cafe', js: `document.querySelector('[data-buy="theme-night"]').click(); ${yes2} D.act((doc, t) => { for (const id of ['rug', 'window', 'cattree', 'cushion', 'armchair', 'lamp', 'plant', 'clock']) if (!E.owns(doc, id)) E.buy(doc, id, t); }); ${click('[data-tab="cafe"]')} await wait(900); window.scrollTo(0, 0); return document.querySelector('#room').className`, wait: 1500 },
    { name: '13-cafe-stats', js: `${click('[data-span="week"]')} await wait(700); ${scrollToSel('#cafe-tiles')} return document.querySelector('#cafe-tiles').innerText.replace(/\\n/g, ' ')`, wait: 1000 },
    { name: '14-edit', js: `${scrollToSel('#hist')} document.querySelector('#hist [data-edit]').click(); await wait(500); return document.querySelector('#edit').hidden ? 'no sheet' : 'edit sheet'`, wait: 900 },
    { name: '15-edited', js: `const f = document.querySelector('#edit'); f.note.value = 'Rewrote the opening twice.'; f.requestSubmit(); await wait(600); return document.querySelector('#hist .hnote') && document.querySelector('#hist .hnote').textContent`, wait: 900 },
    { name: '16-sounds', js: `document.querySelector('[data-buy="sound-cafe"]') ; location.hash = 'shop'; await wait(500); document.querySelector('[data-buy="sound-fire"]').click(); ${yes2} location.hash = ''; await wait(300); ${click('[data-tab="focus"]')} ${start('Plan next week')} ${click('#t-sound')} await wait(500); document.querySelector('[data-sound="fire"]').click(); await wait(300); document.querySelector('[data-sound="purr"]').click(); await wait(500); return soundMix()`, wait: 1000 },
    { name: '17-shelter', js: `${click('#sounds-done')} await wait(300); ${click('#stop')} ${yes2} ${click('[data-out=""]')} await wait(400); location.hash = 'shelter'; await wait(900); return document.querySelector('.sheltertiles').innerText.replace(/\\n/g, ' ')`, wait: 1200 },
    { name: '18-sponsored', js: `document.querySelector('[data-sponsor]').click(); ${yes2} await wait(800); return [document.querySelector('#toast').textContent, document.querySelector('#shelter-all').textContent]`, wait: 1200 },
    { name: '19-news', js: `location.hash = 'news'; await wait(600); return document.querySelector('#news-list').innerText.slice(0, 120)`, wait: 800 },
    { name: '20-lines', js: `location.hash = 'lines'; await wait(400); const f = document.querySelector('#line-add'); f.text.value = 'Small steps still count.'; f.requestSubmit(); await wait(400); return state.settings.lines`, wait: 800 },
    { name: '21-themes', js: `location.hash = 'themes'; await wait(500); return [...document.querySelectorAll('.themecard b')].map((b) => b.textContent).join(', ')`, wait: 800 },
    { name: '22-breathe', js: `location.hash = 'breathe'; await wait(800); return document.querySelector('#breath-meta').textContent`, wait: 1500 },
    { name: '23-rankings-anon', js: `location.hash = 'rankings'; await wait(500); return document.querySelector('#rank-anon').hidden ? 'shown in' : 'needs account'`, wait: 700 },
  ]);
  await device('forest-phone', { width: 390, height: 844, ua: ANDROID_UA, platform: 'Linux armv8l', touch: true, standalone: false }, [
    { name: '1-home', js: `${skipIntro} ${click('[data-mode="stopwatch"]')} await wait(300); ${visible}` },
    { name: '2-run', js: `${start('Sketch the logo')} ${back(12)} await wait(1200); return document.querySelector('.toolbar').getBoundingClientRect().bottom <= innerHeight ? 'toolbar on screen' : 'TOOLBAR OFF THE SCREEN'`, wait: 1200 },
    { name: '3-goals', js: `${click('#stop')} ${yes2} ${click('[data-out="done"]')} await wait(2600); ${noMeets} location.hash = 'missions'; await wait(700); ${visible}`, wait: 1000 },
  ]);
  if (forestOn) {
    const rin = await account(`rin${tag}`, 'Rin');
    const kai = await account(`kai${tag}`, 'Kai');
    await kai.call('POST', '/api/friends/add', { code: rin.code });
    await rin.change((doc, t) => { E.setSettings(doc, { rank: { on: true, global: true, name: 'Rin the Reader' } }, t); for (let i = 0; i < 3; i++) { const b = E.start(doc, { intention: 'Read', minutes: 40 }, t - (i + 1) * 3 * 3600000); E.tick(doc, b.end); E.outcome(doc, b.id, 'done', b.end); } });
    const kaiIn = `${click('#welcome-signin')} await wait(300); { const f = document.querySelector('#account-form'); f.name.value = ${JSON.stringify(kai.name)}; f.password.value = ${JSON.stringify(kai.password)}; f.requestSubmit(); } await wait(2500); if (!document.querySelector('#v-remind').hidden) ${click('#remind-later')} await wait(300);`;
    await device('forest-rank', { ...ipad, standalone: true }, [
      { name: '1-rankings', js: `${kaiIn} location.hash = 'rankings'; await wait(1200); return document.querySelector('#rank-list').innerText.replace(/\\n/g, ' / ')`, wait: 1000 },
      { name: '2-join', js: `const c = document.querySelector('#rank-on'); c.checked = true; c.dispatchEvent(new Event('change')); await wait(1500); const n = document.querySelector('#rank-name'); n.value = 'Kai'; n.dispatchEvent(new Event('change')); await wait(1200); const g = document.querySelector('#rank-global'); g.checked = true; g.dispatchEvent(new Event('change')); await wait(1500); return [state.settings.rank, document.querySelector('#rank-list').innerText.replace(/\\n/g, ' / ')]`, wait: 1000 },
      { name: '3-friends', js: `${click('[data-rank="friends"]')} await wait(800); return document.querySelector('#rank-list').innerText.replace(/\\n/g, ' / ')`, wait: 800 },
      { name: '4-room', js: `location.hash = ''; await wait(300); ${click('[data-tab="focus"]')} ${start('Thesis chapter 2')} await wait(11500); ${click('#t-room')} await wait(1200); return document.querySelector('#room-code').textContent`, wait: 1000 },
    ]);
  }

  ws.close();
})().catch((e) => { console.error(e); process.exit(1); });
