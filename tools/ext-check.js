#!/usr/bin/env node
'use strict';
// Load the browser extension (extension/) unpacked in headless Chromium and try it against a Chataltul:
// the welcome list on install, the Settings row, a block that turns the list on, the cat page on a
// site on the list (and its subdomains), a site off the list left alone, adding to the list, the
// toolbar popup, a pause moving the end, "Back to Chataltul", stopping (the blocked tab opens its site),
// and a block that ends while Chataltul is closed. Screenshots of each go to the out dir.
//   node tools/ext-check.js <Chataltul on localhost, like http://localhost:8462/> <out dir>
// It runs its own Chromium in Docker (zenika/alpine-chrome, on the host network so localhost is the
// sandbox) and removes it at the end. The page posts usage counts, so never point it at the live site.
// EXT_DEVTOOLS=http://127.0.0.1:<port> drives a Chromium you started yourself instead, with a fresh
// --user-data-dir, --load-extension=<the extension folder> and --remote-debugging-port (another machine
// over an SSH tunnel, say, with the sandbox tunnelled to its localhost).
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const [APP, OUT] = process.argv.slice(2);
if (!APP || !OUT) { console.error('node tools/ext-check.js <app url> <out dir>'); process.exit(2); }
if (/tiresia\.xyz/.test(APP)) { console.error('The check starts blocks and posts counts. Use a sandbox.'); process.exit(2); }
const app = new URL(APP);
if (!['localhost', '127.0.0.1'].includes(app.hostname)) { console.error('The extension only runs on localhost (and the live site), so the sandbox has to be on localhost.'); process.exit(2); }
fs.mkdirSync(OUT, { recursive: true });
const EXT = path.resolve(__dirname, '..', 'extension');
const NAME = 'kavana-ext-check';
const OWN = process.env.EXT_DEVTOOLS;
const DEVTOOLS = OWN || 'http://127.0.0.1:9371';
const OTHER = `http://127.0.0.1:${app.port || 80}/robots.txt`; // a page that isn't on the list (until we add it)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const docker = (...a) => (OWN ? '' : execFileSync('docker', a, { stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim());
try { docker('rm', '-f', NAME); } catch { /* not running */ }
docker('run', '-d', '--rm', '--name', NAME, '--network', 'host', '-v', `${EXT}:/ext:ro`, '--entrypoint', 'chromium-browser',
  'zenika/alpine-chrome:124', '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--hide-scrollbars',
  '--remote-debugging-address=127.0.0.1', `--remote-debugging-port=${new URL(DEVTOOLS).port}`, '--user-data-dir=/tmp/profile',
  '--load-extension=/ext', '--disable-extensions-except=/ext', 'about:blank');

for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { try { docker('rm', '-f', NAME); } catch { /* gone */ } process.exit(1); });

let ws, seq = 0;
const pending = new Map();
const listeners = [];
function cdp(method, params = {}, sessionId) {
  const id = ++seq;
  ws.send(JSON.stringify({ id, method, params, sessionId }));
  return new Promise((ok, no) => pending.set(id, { ok, no, method }));
}

const results = [];
function check(name, ok, got) {
  results.push(ok);
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : `  (got ${JSON.stringify(got)})`}`);
}

// A tab in the default profile (extensions don't run in the throwaway contexts shot.js uses).
async function tab(url, { width = 1280, height = 800, dark = false } = {}) {
  const { targetId } = await cdp('Target.createTarget', { url: 'about:blank' });
  return attach(targetId, url, { width, height, dark });
}
async function attach(targetId, url, { width = 1280, height = 800, dark = false } = {}) {
  const { sessionId } = await cdp('Target.attachToTarget', { targetId, flatten: true });
  const s = (method, params) => cdp(method, params, sessionId);
  const errors = [];
  listeners.push((m) => {
    if (m.sessionId !== sessionId) return;
    if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push(m.params.args.map((a) => a.value || a.description).join(' '));
  });
  await s('Page.enable');
  await s('Runtime.enable');
  await s('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 2, mobile: false });
  await s('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: dark ? 'dark' : 'light' }] });
  if (url) { await s('Page.navigate', { url }); await sleep(1500); }
  const t = {
    targetId, errors,
    js: async (src) => {
      const r = await s('Runtime.evaluate', { expression: `(async () => { const wait = (ms) => new Promise(r => setTimeout(r, ms)); ${src} })()`, awaitPromise: true, returnByValue: true });
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
      return r.result.value;
    },
    url: async () => (await cdp('Target.getTargetInfo', { targetId })).targetInfo.url,
    go: async (to) => { await s('Page.navigate', { url: to }); await sleep(1500); },
    shot: async (name, clip) => {
      await s('Page.bringToFront'); // a tab in the background doesn't paint
      await sleep(300);
      const { data } = await s('Page.captureScreenshot', { format: 'png', ...(clip ? { clip: { ...clip, scale: 1 } } : {}) });
      fs.writeFileSync(path.join(OUT, `${name}.png`), Buffer.from(data, 'base64'));
    },
    dark: (on) => s('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: on ? 'dark' : 'light' }] }),
    close: () => cdp('Target.closeTarget', { targetId }),
  };
  return t;
}
async function until(fn, ms = 5000) {
  const stop = Date.now() + ms;
  let v;
  while (Date.now() < stop) { v = await fn(); if (v) return v; await sleep(200); }
  return v;
}

(async () => {
  let ver;
  for (let i = 0; i < 50 && !ver; i++) { await sleep(200); ver = await fetch(`${DEVTOOLS}/json/version`).then((r) => r.json()).catch(() => null); }
  if (!ver) throw new Error('Chromium did not start');
  ws = new WebSocket(ver.webSocketDebuggerUrl);
  await new Promise((r) => { ws.onopen = r; });
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      const p = pending.get(m.id); pending.delete(m.id);
      if (m.error) p.no(new Error(`${p.method}: ${m.error.message}`)); else p.ok(m.result);
    } else listeners.forEach((l) => l(m));
  };

  // 1. Installing opens the list with a welcome.
  const welcome = await until(async () => (await cdp('Target.getTargets')).targetInfos.find((t) => t.type === 'page' && /options\.html\?welcome$/.test(t.url)));
  check('installing opens the list with a welcome', Boolean(welcome));
  const id = new URL(welcome.url).host;
  const EXTURL = `chrome-extension://${id}/`;
  const list = await attach(welcome.targetId, null, { width: 900, height: 900 });
  await sleep(500);
  check('the welcome and the default list show', await list.js(`return !document.querySelector('#welcome').hidden && [...document.querySelectorAll('#sites .grow')].map(e => e.textContent).join()`) === 'youtube.com,reddit.com,x.com,twitter.com,facebook.com,instagram.com,tiktok.com');
  await list.shot('ext-welcome');
  const store = () => list.js('return chrome.storage.local.get()');
  const rules = () => list.js('return chrome.declarativeNetRequest.getDynamicRules()');
  const badgeText = () => list.js('return chrome.action.getBadgeText({})');

  // 2. Chataltul knows the extension is there.
  const k = await tab(APP, { width: 1280, height: 860 });
  await sleep(800);
  await k.js(`document.querySelector('#welcome-start')?.click(); await wait(300); if (!document.querySelector('#v-remind').hidden) document.querySelector('#remind-later').click(); await wait(300);`);
  check('Settings says the extension is on', await k.js(`location.hash = 'settings'; await wait(600); return !document.querySelector('#ext-row').hidden && document.querySelector('#ext-value').textContent`) === 'On');
  await k.js(`document.querySelector('#ext-row').scrollIntoView({ block: 'center' }); await wait(300);`);
  await k.shot('ext-settings');
  check('no block, no rules', (await rules()).length === 0 && (await badgeText()) === '');

  // 3. Starting a block turns the list on.
  await k.js(`location.hash = ''; await wait(400); document.querySelector('[data-tab="focus"]')?.click(); await wait(300);
    const f = document.querySelector('#start'); f.intention.value = 'Write the chapter'; f.requestSubmit(); await wait(1200);`);
  const active = await k.js('return state.active && { end: state.active.end, id: state.active.cat, cat: K.byId(state.active.cat).name }');
  const st = await store();
  check('the page told the extension about the block', st.block && st.block.running && st.block.intention === 'Write the chapter' && st.block.end === active.end && st.block.cat.name === active.cat && st.block.cat.kitten === 'growing', st.block);
  check('it remembers where Chataltul is', st.app === `${app.origin}/`, st.app);
  const r1 = await rules();
  check('one redirect rule for the default list', r1.length === 1 && r1[0].action.type === 'redirect' && r1[0].condition.requestDomains.length === 7, r1);
  check('the toolbar badge shows the minutes left', /^\d+$/.test(await badgeText()), await badgeText());

  // 4. A site on the list shows the cat page, subdomains too; one off the list doesn't.
  const yt = await tab('https://www.youtube.com/watch?v=focus');
  check('youtube.com shows the cat page', await until(async () => (await yt.url()) === `${EXTURL}blocked.html#https://www.youtube.com/watch?v=focus`), await yt.url());
  await sleep(600);
  const boo = await yt.js(`return [document.querySelector('#title').textContent, document.querySelector('#site').textContent, document.querySelector('#intention').textContent, document.querySelector('#left').textContent]`);
  check('the cat page says who is growing', boo[0] === `Boo! ${active.cat} is growing.` && /^youtube\.com is on your list until /.test(boo[1]) && boo[2] === 'Write the chapter' && /min left$/.test(boo[3]), boo);
  check('the kitten picture comes from Chataltul', await yt.js(`await wait(300); const i = document.querySelector('#pic'); return i.complete && i.naturalWidth > 0 && i.src`) === `${app.origin}/cats/${active.id}-kitten-1.webp`);
  await yt.shot('ext-blocked');
  await yt.dark(true); await sleep(400); await yt.shot('ext-blocked-dark'); await yt.dark(false);
  const rd = await tab('https://old.reddit.com/r/all');
  check('old.reddit.com is covered by reddit.com', await until(async () => (await rd.url()).startsWith(`${EXTURL}blocked.html#`)), await rd.url());
  await rd.close();
  const other = await tab(OTHER);
  check('a site off the list opens as usual', (await other.url()) === OTHER, await other.url());

  // 5. The list: adding works during a block, removing waits.
  const add = (text) => list.js(`const i = document.querySelector('#site'); i.value = ${JSON.stringify(text)}; document.querySelector('#add').requestSubmit(); await wait(500); return document.querySelector('#err').textContent`);
  check('a bad site is refused', /doesn't look like a site/.test(await add('not a site')));
  check('Chataltul itself is refused', /Chataltul itself/.test(await add(app.origin)));
  check('a pasted address is added as its site', (await add('https://news.ycombinator.com/item?id=1')) === '' && (await store()).sites.includes('news.ycombinator.com'));
  check('the rule picks up the new site', (await until(async () => (await rules())[0]?.condition.requestDomains.includes('news.ycombinator.com'))) === true);
  check('Remove waits for the end of the block', await list.js(`return [...document.querySelectorAll('#sites button.x')].every(b => b.disabled) && document.querySelector('#status').textContent`).then((s) => /^A block is running until/.test(s)));
  await list.js('window.scrollTo(0, 0)');
  await list.shot('ext-list');

  // 6. The toolbar popup.
  const pop = await tab(`${EXTURL}popup.html`, { width: 320, height: 210 });
  check('the popup shows the block', await pop.js(`return document.querySelector('#title').textContent`) === `${active.cat} is growing`);
  const box = await pop.js(`const r = document.body.getBoundingClientRect(); return { x: 0, y: 0, width: Math.ceil(r.width), height: Math.ceil(r.height) }`);
  await pop.shot('ext-popup', box);
  await pop.close();

  // 7. A pause: the end the extension keeps moves out by the longest pause.
  await k.js(`D.act((doc, t) => E.pause(doc, t)); refresh(); await wait(500);`);
  const paused = await k.js('return state.active.pauseEnds - state.active.paused + state.active.end');
  check('a pause moves the end out', (await store()).block.end === paused, [(await store()).block.end, paused]);
  await k.js(`D.act((doc, t) => E.resume(doc, t)); refresh(); await wait(500);`);
  check('resuming brings it back', (await store()).block.end === await k.js('return state.active.end'));

  // 8. "Back to Chataltul" switches to the Chataltul tab.
  const activeTabs = () => list.js(`return (await chrome.tabs.query({ active: true })).map(t => String(t.url))`);
  await yt.shot('ext-blocked'); // brings it to the front
  const before = await activeTabs();
  await yt.js(`document.querySelector('#back').click(); await wait(800);`);
  const after = await activeTabs();
  check('"Back to Chataltul" switches to the Chataltul tab', !before.some((u) => u.includes(app.origin)) && after.some((u) => u.includes(app.origin)), { before, after });
  check('and leaves the cat page where it was', (await yt.url()).startsWith(`${EXTURL}blocked.html`));
  await yt.close();

  // 9. Stopping the block: the list goes off, and a cat page opens the site it stood in for.
  await add(`127.0.0.1`);
  await other.go(OTHER);
  check('a page blocked during the block…', (await other.url()).startsWith(`${EXTURL}blocked.html#`), await other.url());
  await k.js(`D.act((doc, t) => E.stop(doc, t)); refresh(); await wait(300);`);
  check('…opens by itself when the block stops', await until(async () => (await other.url()) === OTHER), await other.url());
  check('the page told the extension it stopped', (await store()).block.running === false);
  check('no rules and no badge after the stop', (await rules()).length === 0 && (await badgeText()) === '');
  check('Remove works again', await list.js(`await wait(300); const b = [...document.querySelectorAll('#sites .row')].find(r => r.textContent.startsWith('127.0.0.1')).querySelector('button'); if (b.disabled) return false; b.click(); await wait(500); return !(await chrome.storage.local.get('sites')).sites.includes('127.0.0.1')`) === true);
  await other.close();

  // 10. A block that ends while Chataltul is closed: the extension's own alarm turns the list off.
  await k.js(`D.act((doc, t) => { const b = E.awaiting(doc); if (b) E.outcome(doc, b.id, null, t); }); refresh(); await wait(300);
    D.act((doc, t) => E.start(doc, { intention: 'Short one', minutes: 5 }, t - 5 * 60000 + 4000)); refresh(); await wait(500);`);
  check('a short block turns the list on', (await rules()).length === 1);
  await k.close();
  check('the list goes off at its end with Chataltul closed', await until(async () => (await rules()).length === 0 && (await badgeText()) === '', 12000) === true);

  const errors = [...list.errors, ...yt.errors, ...rd.errors, ...pop.errors, ...other.errors];
  check('no errors on the extension pages', errors.length === 0, errors);
  check('no errors on the Chataltul page', k.errors.length === 0, k.errors);
  ws.close();
  const failed = results.filter((x) => !x).length;
  console.log(`\n${results.length - failed} passed, ${failed} failed. Screenshots in ${OUT}`);
  process.exitCode = failed ? 1 : 0;
})().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => {
  try { docker('rm', '-f', NAME); } catch { /* gone */ }
  setTimeout(() => process.exit(), 100);
});
