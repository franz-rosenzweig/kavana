// The list of sites to block. During a block you can add to it but not take anything off.
'use strict';
const { api } = KX;
const $ = (s) => document.querySelector(s);
let st = null;

function draw() {
  const { block, app, sites } = st;
  const on = KX.running(block);
  $('#welcome').hidden = !location.search.includes('welcome');
  $('#status').textContent = on
    ? `A block is running until ${KX.clock(block.end)}${block.intention ? `: ${block.intention}` : ''}. Sites can come off the list when it's over.`
    : 'No block running right now. Start one in Kavana, and these sites show a cat until it ends.';
  $('#open').href = app;
  const list = $('#sites');
  list.replaceChildren();
  if (!sites.length) {
    const p = document.createElement('div');
    p.className = 'empty';
    p.textContent = 'Nothing on the list yet.';
    list.append(p);
  }
  for (const s of sites) {
    const row = document.createElement('div');
    row.className = 'row';
    const name = document.createElement('span');
    name.className = 'grow';
    name.textContent = s;
    const x = document.createElement('button');
    x.className = 'x';
    x.textContent = 'Remove';
    x.disabled = on;
    x.setAttribute('aria-label', `Remove ${s}`);
    x.addEventListener('click', () => save(st.sites.filter((t) => t !== s)));
    row.append(name, x);
    list.append(row);
  }
  $('#reset').hidden = on || sites.join() === KX.DEFAULT_SITES.join();
}

async function save(sites) {
  await api.storage.local.set({ sites });
}

$('#add').addEventListener('submit', async (e) => {
  e.preventDefault();
  const s = KX.site($('#site').value);
  const err = $('#err');
  if (!s) { err.textContent = "That doesn't look like a site. Try something like reddit.com."; return; }
  if (s === new URL(st.app).hostname) { err.textContent = "That's Kavana itself, which never gets blocked."; return; }
  if (st.sites.includes(s)) { err.textContent = `${s} is on the list already.`; return; }
  if (st.sites.length >= KX.MAX_SITES) { err.textContent = `The list holds ${KX.MAX_SITES} sites at most.`; return; }
  err.textContent = '';
  $('#site').value = '';
  await save([...st.sites, s]);
});
$('#reset').addEventListener('click', () => save(KX.DEFAULT_SITES.slice()));

// Firefox lets you take away the extension's access to sites. Without it the cat page can't show.
const ALL = { origins: ['<all_urls>'] };
async function checkAccess() { $('#access').hidden = await api.permissions.contains(ALL); }
$('#allow').addEventListener('click', () => { api.permissions.request(ALL).then(checkAccess); });

async function load() { st = await KX.load(); draw(); }
api.storage.onChanged.addListener((c, area) => { if (area === 'local') load(); });
setInterval(() => { if (st && st.block && st.block.running && st.block.end <= Date.now()) load(); }, 5000); // the end passed
load();
checkAccess();
