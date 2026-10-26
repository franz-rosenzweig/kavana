// Turns the block list on while a Chataltul block runs, and off when it ends. A site on the list opens the
// cat page instead (whole pages only, so a video embedded in another site still plays).
'use strict';
if (typeof importScripts === 'function' && !globalThis.KX) importScripts('common.js'); // Chrome; Firefox's manifest lists both
const { api } = KX;
const RULE = 1;

// One update at a time, so a quick start-then-cancel can't finish in the wrong order.
let queue = Promise.resolve();
const apply = () => (queue = queue.catch(() => {}).then(update));

async function update() {
  const { block, app, sites } = await KX.load();
  const on = KX.running(block) && sites.length > 0;
  const rules = on ? [{
    id: RULE,
    priority: 1,
    // The address you wanted goes after the #, so the cat page can open it when the block is over.
    action: { type: 'redirect', redirect: { regexSubstitution: `${api.runtime.getURL('blocked.html')}#\\1` } },
    condition: {
      regexFilter: '^(.+)$',
      requestDomains: sites,
      excludedRequestDomains: [new URL(app).hostname], // never Chataltul itself
      resourceTypes: ['main_frame'],
    },
  }] : [];
  await api.declarativeNetRequest.updateDynamicRules({ removeRuleIds: [RULE], addRules: rules });
  await api.alarms.clear('end');
  if (on) await api.alarms.create('end', { when: block.end + 500 });
  await badge(on ? block : null);
  return on;
}

// Minutes left on the toolbar button while a block runs.
async function badge(block) {
  if (block) await api.alarms.create('tick', { periodInMinutes: 1 });
  else await api.alarms.clear('tick');
  await api.action.setBadgeBackgroundColor({ color: '#2c8a7e' });
  await api.action.setBadgeText({ text: block ? String(Math.ceil((block.end - Date.now()) / 60000)) : '' });
  await api.action.setTitle({ title: block ? `Chataltul: blocking until ${KX.clock(block.end)}` : 'Chataltul' });
}

// Chataltul pages that were already open when the extension was installed or updated get the script now.
async function inject() {
  const matches = api.runtime.getManifest().content_scripts[0].matches;
  for (const t of await api.tabs.query({ url: matches })) {
    api.scripting.executeScript({ target: { tabId: t.id }, files: ['kavana.js'] }).catch(() => {});
  }
}

api.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && (changes.block || changes.sites || changes.app)) apply();
});
api.alarms.onAlarm.addListener(async (a) => {
  if (a.name === 'end') apply();
  if (a.name === 'tick') { const { block } = await KX.load(); badge(KX.running(block) ? block : null); }
});
api.runtime.onStartup.addListener(apply);
api.runtime.onInstalled.addListener(async ({ reason }) => {
  await apply();
  inject();
  if (reason === 'install') api.tabs.create({ url: 'options.html?welcome' });
});
// The cat page asks for the rules to be brought up to date before it opens the site you wanted.
api.runtime.onMessage.addListener((m, sender, reply) => {
  if (m && m.type === 'apply') { apply().then((on) => reply({ on })); return true; }
  return false;
});
