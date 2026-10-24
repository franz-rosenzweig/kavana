// Runs on the Kavana page. The page sends a "kavana-block" event when a block starts, pauses, stops or
// ends; this keeps the latest one in the extension's storage, and background.js does the rest.
'use strict';
(() => {
  const api = globalThis.browser || globalThis.chrome;
  const app = location.origin + location.pathname.replace(/[^/]*$/, ''); // the folder Kavana is in
  const text = (v, n) => String(v == null ? '' : v).slice(0, n);

  window.addEventListener('kavana-block', (e) => {
    let d = e.detail;
    if (typeof d === 'string') { try { d = JSON.parse(d); } catch { return; } }
    if (!d || typeof d !== 'object') return;
    const now = Date.now();
    const end = Number(d.end);
    const block = d.running === true && Number.isFinite(end) ? {
      running: true,
      end: Math.min(end, now + 8 * 3600e3), // the longest block, with extra time and a pause, is about 6 hours
      intention: text(d.intention, 200),
      cat: d.cat && typeof d.cat === 'object'
        ? { id: text(d.cat.id, 40).replace(/[^a-z0-9-]/g, ''), name: text(d.cat.name, 40), kitten: text(d.cat.kitten, 10) }
        : null,
      at: now,
    } : { running: false, at: now };
    api.storage.local.set({ block, app }).catch(() => {}); // fails quietly after the extension was reloaded
  });

  // Tell the page the extension is here, so it sends the block again (this script can start after it).
  const hello = () => window.dispatchEvent(new CustomEvent('kavana-extension'));
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', hello, { once: true });
  else hello();
})();
