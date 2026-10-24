'use strict';
// Kavana's service worker: shows the pings, and records Yes / Drifted tapped on a notification.
// Answers go into IndexedDB ("inbox"); the app picks them up the next time it opens, because
// the history lives in the browser, not on the server. iOS shows no notification buttons,
// so there a tap just opens the app, which asks the same question.
const at = (p) => new URL(p, self.registration.scope).href;

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

function inbox(item) {
  return new Promise((ok) => {
    const r = indexedDB.open('kavana', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('inbox', { autoIncrement: true });
    r.onerror = () => ok();
    r.onsuccess = () => {
      const tx = r.result.transaction('inbox', 'readwrite');
      tx.objectStore('inbox').add(item);
      tx.oncomplete = () => { r.result.close(); ok(); };
      tx.onerror = () => ok();
    };
  });
}

async function tellWindows() {
  for (const c of await self.clients.matchAll({ type: 'window', includeUncontrolled: true })) {
    if (c.url.startsWith(self.registration.scope)) c.postMessage({ type: 'refresh' });
  }
}

self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch {}
  const opts = {
    body: d.body || '',
    tag: d.tag || 'kavana',
    renotify: true,
    icon: at('icons/kavana-192.png'),
    badge: at('icons/kavana-badge-96.png'),
    data: d,
  };
  if (d.actions) opts.actions = d.actions;
  if (d.cat && ['checkin', 'end', 'break-over', 'daily'].includes(d.kind)) opts.image = at('icons/cat-boo.png'); // Android shows it big
  e.waitUntil(self.registration.showNotification(d.title || 'Kavana', opts).then(tellWindows));
});

self.addEventListener('notificationclick', (e) => {
  const d = e.notification.data || {};
  e.notification.close();
  if ((e.action === 'yes' || e.action === 'drifted') && d.block) {
    e.waitUntil(inbox({ block: d.block, n: d.n, answer: e.action, at: Date.now() }).then(tellWindows));
    return;
  }
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const w of wins.filter((x) => x.url.startsWith(self.registration.scope))) { // other apps can share the origin
      w.postMessage({ type: 'refresh' });
      if ('focus' in w) return w.focus();
    }
    return self.clients.openWindow(self.registration.scope);
  })());
});
