#!/usr/bin/env node
'use strict';
// The living cats (web/warp.js) in a browser without WebGL, and with it as a control. Without WebGL the
// page must not throw, and the still paintings stand in; with it, the cats are drawn on canvases.
//   node tools/warp-check.js <Kavana on localhost, like http://localhost:8462/> <out dir>
// It runs its own headless Chromium in Docker (zenika/alpine-chrome, on the host network so localhost is
// the sandbox), once with --disable-3d-apis (getContext('webgl') gives null, like Firefox with
// webgl.disabled) and once with software WebGL, and removes it at the end. Never point it at the live site.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const [APP, OUT] = process.argv.slice(2);
if (!APP || !OUT) { console.error('node tools/warp-check.js <app url> <out dir>'); process.exit(2); }
if (/tiresia\.xyz/.test(APP)) { console.error('The check starts a block and posts counts. Use a sandbox.'); process.exit(2); }
if (!/^http:\/\/(localhost|127\.0\.0\.1)[:/]/.test(APP)) { console.error('Use the sandbox on localhost, so the browser counts it as a secure origin.'); process.exit(2); }
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const docker = (...a) => execFileSync('docker', a, { stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();
const results = [];
function check(name, ok, got) {
  results.push(ok);
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : `  (got ${JSON.stringify(got)})`}`);
}

// Start a Chromium, drive one tab through the walk, stop it.
async function run(label, port, flags, walk) {
  const NAME = `kavana-warp-check-${label}`;
  try { docker('rm', '-f', NAME); } catch { /* not running */ }
  docker('run', '-d', '--rm', '--name', NAME, '--network', 'host', '--entrypoint', 'chromium-browser', 'zenika/alpine-chrome:124',
    '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--hide-scrollbars', '--user-data-dir=/tmp/profile',
    '--remote-debugging-address=127.0.0.1', `--remote-debugging-port=${port}`, ...flags, 'about:blank');
  const stop = () => { try { docker('rm', '-f', NAME); } catch { /* gone */ } };
  process.once('SIGINT', () => { stop(); process.exit(1); });
  let ws, seq = 0;
  const pending = new Map(), listeners = [];
  try {
    let ver;
    for (let i = 0; i < 50 && !ver; i++) { await sleep(200); ver = await fetch(`http://127.0.0.1:${port}/json/version`).then((r) => r.json()).catch(() => null); }
    if (!ver) throw new Error('Chromium did not start');
    ws = new WebSocket(ver.webSocketDebuggerUrl);
    await new Promise((r) => { ws.onopen = r; });
    ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); if (m.error) p.no(new Error(`${p.method}: ${m.error.message}`)); else p.ok(m.result); } else listeners.forEach((l) => l(m));
    };
    const cdp = (method, params = {}, sessionId) => { const id = ++seq; ws.send(JSON.stringify({ id, method, params, sessionId })); return new Promise((ok, no) => pending.set(id, { ok, no, method })); };
    const { targetId } = await cdp('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await cdp('Target.attachToTarget', { targetId, flatten: true });
    const s = (method, params) => cdp(method, params, sessionId);
    const errors = [];
    listeners.push((m) => {
      if (m.sessionId !== sessionId) return;
      if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
      if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push(m.params.args.map((a) => a.value || a.description).join(' '));
    });
    await s('Page.enable'); await s('Runtime.enable');
    await s('Emulation.setDeviceMetricsOverride', { width: 1100, height: 800, deviceScaleFactor: 1, mobile: false });
    await s('Page.navigate', { url: APP });
    await sleep(2000);
    const js = async (src) => {
      const r = await s('Runtime.evaluate', { expression: `(async () => { const wait = (ms) => new Promise(r => setTimeout(r, ms)); ${src} })()`, awaitPromise: true, returnByValue: true });
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
      return r.result.value;
    };
    const shot = async (name) => fs.writeFileSync(path.join(OUT, `${label}-${name}.png`), Buffer.from((await s('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
    await walk({ js, shot, errors });
  } finally { stop(); }
}

// Skip the welcome, start a block (its kitten is in the ring), then look at the Cats tab.
const startBlock = `document.querySelector('#welcome-start')?.click(); await wait(300); if (!document.querySelector('#v-remind').hidden) document.querySelector('#remind-later').click(); await wait(300);
  const f = document.querySelector('#start'); f.intention.value = 'Write the chapter'; f.requestSubmit(); await wait(1800);`;
// What's on screen: living cats (canvases with how many pixels they painted) and still paintings.
const cats = `const live = [...document.querySelectorAll('.catcanvas')].map((c) => { const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 200) n++; return n; });
  const still = [...document.querySelectorAll('img.portrait')].filter((i) => i.getBoundingClientRect().width > 0).map((i) => i.complete && i.naturalWidth > 0);
  return { live, still, gl: Boolean(KavanaWarp.renderer().gl) };`;

(async () => {
  console.log('-- WebGL off');
  await run('nowebgl', 9381, ['--disable-3d-apis'], async ({ js, shot, errors }) => {
    check('the page has no WebGL here', (await js('return !document.createElement("canvas").getContext("webgl")')) === true);
    await js(startBlock);
    await shot('run');
    const run1 = await js(cats);
    check('a block runs and its kitten shows as a still painting', run1.still.length > 0 && run1.still.every(Boolean) && run1.live.length === 0, run1);
    await js(`document.querySelector('[data-tab="cats"]').click(); await wait(1200);`);
    await shot('cats');
    const tab = await js(cats);
    check('the Cats tab shows still paintings', tab.still.length > 1 && tab.still.every(Boolean) && tab.live.length === 0 && tab.gl === false, tab);
    // warp.js on its own, as a library: a cat made straight on a canvas draws the flat picture, no throw.
    const lib = await js(`const rig = await (await fetch('rig.json')).json(); const cv = document.createElement('canvas'); cv.width = cv.height = 300; cv.style.cssText = 'position:fixed;left:0;top:0;width:300px;height:300px'; document.body.append(cv);
      const cat = new KavanaWarp.Cat(cv, 'miso', 'portrait', { rig, base: 'cats/' }); KavanaWarp.start(); await wait(1500);
      const d = cv.getContext('2d').getImageData(0, 0, 300, 300).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 200) n++; cat.destroy(); cv.remove(); return n;`);
    check('a Cat made on a canvas without WebGL still draws the picture', lib > 2000, lib);
    check('no errors on the page', errors.length === 0, errors);
  });
  console.log('-- WebGL on (control)');
  await run('webgl', 9382, ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'], async ({ js, shot, errors }) => {
    const has = await js('return Boolean(document.createElement("canvas").getContext("webgl"))');
    if (!has) { console.log('     (this Chromium has no software WebGL, so no control)'); return; }
    await js(startBlock);
    await shot('run');
    const run1 = await js(cats);
    check('with WebGL the kitten is a living cat that painted itself', run1.gl && run1.live.length > 0 && run1.live.every((n) => n > 2000), run1);
    await js(`document.querySelector('[data-tab="cats"]').click(); await wait(1500);`);
    await shot('cats');
    const tab = await js(cats);
    check('and the Cats tab is living cats too', tab.live.length > 1 && tab.live.some((n) => n > 2000), tab);
    check('no errors on the page', errors.length === 0, errors);
  });
  const failed = results.filter((x) => !x).length;
  console.log(`\n${results.length - failed} passed, ${failed} failed. Screenshots in ${OUT}`);
  process.exitCode = failed ? 1 : 0;
})().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => setTimeout(() => process.exit(), 100));
