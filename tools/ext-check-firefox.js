#!/usr/bin/env node
'use strict';
// The same idea as ext-check.js, in Firefox: install extension/ as a temporary add-on in headless
// Firefox and try it against a Chataltul on localhost (the welcome tab, the Settings row, the cat page,
// adding to the list, and a stop opening the blocked site again). Screenshots go to the out dir.
//   node tools/ext-check-firefox.js <Chataltul on localhost, like http://localhost:8462/> <out dir>
// It runs geckodriver from the selenium/standalone-firefox image (about 1.5 GB) on the host network
// and removes it at the end. System access is on so WebDriver can look inside the extension's pages.
// Never point it at the live site.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const [APP, OUT] = process.argv.slice(2);
if (!APP || !OUT) { console.error('node tools/ext-check-firefox.js <app url> <out dir>'); process.exit(2); }
if (/tiresia\.xyz/.test(APP)) { console.error('The check starts blocks and posts counts. Use a sandbox.'); process.exit(2); }
const app = new URL(APP);
if (app.hostname !== 'localhost') { console.error('Point it at the sandbox as http://localhost:<port>/ (127.0.0.1 is used as a site to block).'); process.exit(2); }
fs.mkdirSync(OUT, { recursive: true });
const EXT = path.resolve(__dirname, '..', 'extension');
const NAME = 'kavana-ext-firefox';
const WD = 'http://127.0.0.1:4455';
const OTHER = `http://127.0.0.1:${app.port || 80}/robots.txt`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const docker = (...a) => execFileSync('docker', a, { stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();
try { docker('rm', '-f', NAME); } catch { /* not running */ }
docker('run', '-d', '--rm', '--name', NAME, '--network', 'host', '-v', `${EXT}:/ext:ro`, '--entrypoint', 'geckodriver',
  'selenium/standalone-firefox:latest', '--host', '127.0.0.1', '--port', '4455', '--binary', '/usr/bin/firefox', '--allow-system-access');
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { try { docker('rm', '-f', NAME); } catch { /* gone */ } process.exit(1); });

let sid;
async function wd(method, route, body) {
  const r = await fetch(`${WD}${route.replace(':s', sid)}`, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json();
  if (j.value && j.value.error) throw new Error(`${route}: ${j.value.error} ${j.value.message}`);
  return j.value;
}
const js = (src) => wd('POST', '/session/:s/execute/async', { script: `const done = arguments[0]; (async () => { const wait = (ms) => new Promise(r => setTimeout(r, ms)); ${src} })().then(done, (e) => done('ERR ' + e));`, args: [] });
const go = async (url) => { await wd('POST', '/session/:s/url', { url }).catch(() => {}); await sleep(1500); };
const url = () => wd('GET', '/session/:s/url');
const shot = async (name) => fs.writeFileSync(path.join(OUT, `${name}.png`), Buffer.from(await wd('GET', '/session/:s/screenshot'), 'base64'));
const front = async () => { await wd('POST', '/session/:s/window', { handle: await wd('GET', '/session/:s/window') }); await sleep(1000); }; // selects the tab, so it paints and animates
const views = `[...document.querySelectorAll('.view')].filter(v => !v.hidden).map(v => v.id).join()`;
const results = [];
function check(name, ok, got) {
  results.push(ok);
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : `  (got ${JSON.stringify(got)})`}`);
}

(async () => {
  for (let i = 0; i < 50; i++) { try { await fetch(`${WD}/status`); break; } catch { await sleep(200); } }
  sid = (await wd('POST', '/session', { capabilities: { alwaysMatch: { browserName: 'firefox', 'moz:firefoxOptions': { args: ['-headless'] } } } })).sessionId;
  await wd('POST', '/session/:s/window/rect', { width: 1280, height: 800 });
  check('Firefox installs it as a temporary add-on', (await wd('POST', '/session/:s/moz/addon/install', { path: '/ext', temporary: true })) === 'kavana@tiresia.xyz');
  await sleep(1500);
  check('installing opens the welcome tab', (await wd('GET', '/session/:s/window/handles')).length === 2);

  await go(APP);
  check('Settings says the extension is on', await js(`document.querySelector('#welcome-start')?.click(); await wait(300); if (!document.querySelector('#v-remind').hidden) document.querySelector('#remind-later').click(); await wait(300); location.hash = 'settings'; await wait(700); done(document.querySelector('#ext-value').textContent)`) === 'On');
  check('a block starts', await js(`location.hash = ''; await wait(400); const f = document.querySelector('#start'); f.intention.value = 'Write the chapter'; f.requestSubmit(); await wait(1500); done(${views})`) === 'v-run');

  await go('https://www.youtube.com/watch?v=focus');
  const u = await url();
  check('youtube.com shows the cat page', /^moz-extension:\/\/[^/]+\/blocked\.html#https:\/\/www\.youtube\.com\/watch\?v=focus$/.test(u), u);
  const base = u.replace(/blocked\.html.*/, '');
  await front();
  const boo = await js(`done([document.querySelector('#title').textContent, document.querySelector('#intention').textContent, document.querySelector('#pic').naturalWidth > 0 && document.querySelector('#pic').src])`);
  check('the cat page says who is growing, with Chataltul\'s picture', /^Boo! \w+ is growing\.$/.test(boo[0]) && boo[1] === 'Write the chapter' && boo[2].startsWith(`${app.origin}/cats/`), boo);
  await shot('ff-blocked');

  await go(`${base}options.html`);
  const added = await js(`const i = document.querySelector('#site'); i.value = '127.0.0.1'; document.querySelector('#add').requestSubmit(); await wait(700); done([[...document.querySelectorAll('#sites .grow')].map(e => e.textContent).join(), [...document.querySelectorAll('#sites button')].every(b => b.disabled)])`);
  check('the list adds a site, and Remove waits for the end', added[0].endsWith(',127.0.0.1') && added[1] === true, added);
  await front();
  await shot('ff-list');

  const kavana = await wd('GET', '/session/:s/window');
  const other = (await wd('POST', '/session/:s/window/new', { type: 'tab' })).handle;
  await wd('POST', '/session/:s/window', { handle: other });
  await go(OTHER);
  check('the added site shows the cat page', (await url()).startsWith(`${base}blocked.html#`), await url());
  await wd('POST', '/session/:s/window', { handle: kavana });
  await go(APP);
  // Stop (after the 10 seconds when the button still says Cancel), and say yes to the alert.
  check('the block stops', await js(`await wait(9000); document.querySelector('#stop').click(); await wait(500); if (!document.querySelector('#alert').hidden) document.querySelector('#alert [data-alert="1"]').click(); await wait(1500); done(${views})`) !== 'v-run');
  await wd('POST', '/session/:s/window', { handle: other });
  let back = '';
  for (let i = 0; i < 20 && back !== OTHER; i++) { await sleep(300); back = await url(); }
  check('the cat page opens its site by itself after the stop', back === OTHER, back);

  await wd('DELETE', '/session/:s');
  const failed = results.filter((x) => !x).length;
  console.log(`\n${results.length - failed} passed, ${failed} failed. Screenshots in ${OUT}`);
  process.exitCode = failed ? 1 : 0;
})().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => {
  try { docker('rm', '-f', NAME); } catch { /* gone */ }
  setTimeout(() => process.exit(), 100);
});
