// Shared by the background script and the extension's pages. Plain script, no modules, so the same
// file loads in Chrome's service worker (importScripts) and Firefox's background page.
'use strict';
(function (root) {
const api = root.browser || root.chrome;

const KX = {
  api,
  // What's blocked until you change it. A site covers its subdomains too (www., m., old.).
  DEFAULT_SITES: ['youtube.com', 'reddit.com', 'x.com', 'twitter.com', 'facebook.com', 'instagram.com', 'tiktok.com'],
  DEFAULT_APP: 'https://stuffs.tiresia.xyz/kavana/',
  MAX_SITES: 200,

  // "https://www.Reddit.com/r/x" → "reddit.com". Returns null for anything that isn't a site.
  site(text) {
    let t = String(text || '').trim().toLowerCase();
    if (!t) return null;
    if (!/^[a-z][a-z0-9+.-]*:\/\//.test(t)) t = `http://${t}`;
    let host;
    try { host = new URL(t).hostname; } catch { return null; }
    host = host.replace(/^www\./, '').replace(/\.$/, '');
    if (!/^[a-z0-9-]+(\.[a-z0-9-]+)*$/.test(host) || host.length > 253) return null;
    if (!host.includes('.') && host !== 'localhost') return null;
    return host;
  },

  // Everything the extension keeps, in its own storage on this computer:
  //   block  what the Kavana page last said: { running, end, intention, cat, at }
  //   app    the Kavana page that said it, for "Back to Kavana"
  //   sites  the block list (missing until you change it, then the defaults are copied in)
  async load() {
    const got = await api.storage.local.get(['block', 'app', 'sites']);
    return {
      block: got.block || null,
      app: got.app || KX.DEFAULT_APP,
      sites: Array.isArray(got.sites) ? got.sites : KX.DEFAULT_SITES.slice(),
    };
  },

  // A block counts while Kavana says it runs and its end hasn't passed.
  running(block, now = Date.now()) {
    return Boolean(block && block.running && block.end > now);
  },

  // "18 min", "1 h 5 min"
  left(ms) {
    const m = Math.max(1, Math.ceil(ms / 60000));
    return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}`;
  },

  // "3:45 PM" in the computer's own style.
  clock(at) {
    return new Date(at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  },

  // Kavana's painting of the block's kitten (grown once it's home), or null when there's no cat to show.
  picture(app, cat) {
    if (!cat || !cat.id || cat.kitten === 'gone') return null;
    return `${app}cats/${cat.id}${cat.kitten === 'home' ? '' : '-kitten'}-1.webp`;
  },

  // Switch to a Kavana tab that's open already. False if there isn't one.
  async toKavana(app) {
    const tab = (await api.tabs.query({})).find((t) => t.url && t.url.startsWith(app));
    if (!tab) return false;
    await api.tabs.update(tab.id, { active: true });
    await api.windows.update(tab.windowId, { focused: true });
    return true;
  },
};
root.KX = KX;
})(globalThis);
