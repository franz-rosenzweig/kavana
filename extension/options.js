// The sites the cat comes for: only the ones on the block list, or every site except the ones you keep.
// During a block the list can only get stricter: on the block list you can add but not take anything
// off, on the keep list you can take off but not add, and the choice between the two waits for the end.
'use strict';
const { api } = KX;
const $ = (s) => document.querySelector(s);
let st = null;

const WORDS = {
  only: {
    title: 'Sites to block', head: 'Blocked during a block', example: 'news.ycombinator.com', label: 'Site to block',
    foot: 'A site covers its subdomains too, so reddit.com also blocks old.reddit.com.',
    later: 'Sites can come off the list when it\'s over.',
  },
  except: {
    title: 'Sites to keep', head: 'Open during a block', example: 'docs.google.com', label: 'Site to keep',
    foot: 'A site covers its subdomains too, so google.com also keeps docs.google.com.',
    later: 'Sites can go on the list when it\'s over.',
  },
};

const except = () => st.mode === 'except';
const listOf = () => (except() ? st.keep : st.sites);

function draw() {
  const { block, app, mode } = st;
  const on = KX.running(block);
  const w = WORDS[mode];
  const sites = listOf();
  document.title = `${w.title} · Chataltul`;
  $('#h1').textContent = w.title;
  $('#welcome').hidden = !location.search.includes('welcome') || except(); // it speaks of the block list
  $('#status').textContent = on
    ? `A block is running until ${KX.clock(block.end)}${block.intention ? `: ${block.intention}` : ''}. ${w.later}`
    : `No block running right now. Start one in Chataltul, and ${
      !except() ? 'these sites show' : sites.length ? 'every other site shows' : 'every site shows'} a cat until it ends.`;
  $('#open').href = app;
  for (const b of document.querySelectorAll('#mode button')) {
    b.setAttribute('aria-checked', String(b.dataset.mode === mode));
    b.disabled = on;
  }
  $('#ghead').textContent = w.head;
  $('#site').placeholder = `Add a site, like ${w.example}`;
  $('#site').setAttribute('aria-label', w.label);
  const noAdding = on && except(); // keeping more sites during a block would loosen it
  $('#site').disabled = noAdding;
  $('#add button').disabled = noAdding;
  $('#foot').textContent = w.foot;
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
    x.disabled = on && !except();
    x.setAttribute('aria-label', `Remove ${s}`);
    x.addEventListener('click', () => save(listOf().filter((t) => t !== s)));
    row.append(name, x);
    list.append(row);
  }
  $('#reset').hidden = on || except() || sites.join() === KX.DEFAULT_SITES.join();
}

async function save(sites) {
  await api.storage.local.set(except() ? { keep: sites } : { sites });
}

$('#mode').addEventListener('click', async (e) => {
  const b = e.target.closest('button');
  if (!b || b.disabled || !st || b.dataset.mode === st.mode) return;
  $('#err').textContent = '';
  await api.storage.local.set({ mode: b.dataset.mode });
});

$('#add').addEventListener('submit', async (e) => {
  e.preventDefault();
  const s = KX.site($('#site').value);
  const err = $('#err');
  const sites = listOf();
  if (KX.running(st.block) && except()) return;
  if (!s) { err.textContent = `That doesn't look like a site. Try something like ${WORDS[st.mode].example}.`; return; }
  if (s === new URL(st.app).hostname) {
    err.textContent = except() ? "That's Chataltul itself, which is always open." : "That's Chataltul itself, which never gets blocked.";
    return;
  }
  if (sites.includes(s)) { err.textContent = `${s} is on the list already.`; return; }
  if (sites.length >= KX.MAX_SITES) { err.textContent = `The list holds ${KX.MAX_SITES} sites at most.`; return; }
  err.textContent = '';
  $('#site').value = '';
  await save([...sites, s]);
});
$('#reset').addEventListener('click', () => api.storage.local.set({ sites: KX.DEFAULT_SITES.slice() }));

// Firefox lets you take away the extension's access to sites. Without it the cat page can't show.
const ALL = { origins: ['<all_urls>'] };
async function checkAccess() { $('#access').hidden = await api.permissions.contains(ALL); }
$('#allow').addEventListener('click', () => { api.permissions.request(ALL).then(checkAccess); });

async function load() { st = await KX.load(); draw(); }
api.storage.onChanged.addListener((c, area) => { if (area === 'local') load(); });
setInterval(() => { if (st && st.block && st.block.running && st.block.end <= Date.now()) load(); }, 5000); // the end passed
load();
checkAccess();
