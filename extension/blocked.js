// What a site on the list opens while a block runs. The address you wanted is after the #, and it
// opens by itself once the block is over.
'use strict';
const { api } = KX;
const $ = (s) => document.querySelector(s);
const wanted = (() => {
  try { const u = new URL(location.hash.slice(1)); return /^https?:$/.test(u.protocol) ? u : null; } catch { return null; }
})();
const host = wanted ? wanted.hostname.replace(/^www\./, '') : '';
let st = null, over = false;

// The kitten growing in this block, from Chataltul's own pictures (the extension has Miso in case it can't load them).
function picture(cat, app) {
  const img = $('#pic');
  const spare = cat && cat.kitten !== 'gone' ? 'icons/kitten.webp' : 'icons/icon-128.png';
  const want = KX.picture(app, cat) || spare;
  if (img.dataset.want === want) return;
  img.dataset.want = want;
  img.onerror = () => { img.onerror = null; img.src = spare; };
  img.src = want;
}

function draw() {
  const { block, app } = st;
  if (!KX.running(block)) { done(); return; }
  const cat = block.cat;
  $('#title').textContent = !cat ? "Boo! You're in a focus block."
    : cat.kitten === 'home' ? `Boo! ${cat.name} is home, and you're still going.`
      : cat.kitten === 'gone' ? 'Boo! Your block is still going.'
        : `Boo! ${cat.name} is growing.`;
  $('#site').textContent = `${host || 'This site'} is on your list until ${KX.clock(block.end)}.`;
  $('#on').hidden = !block.intention;
  $('#intention').textContent = block.intention;
  $('#left').textContent = `${KX.left(block.end - Date.now())} left`;
  picture(cat, app);
}

async function done() {
  if (over) return;
  over = true;
  $('#title').textContent = 'The block is over.';
  $('#on').hidden = true;
  if (!wanted) { $('#site').textContent = 'Nice work.'; return; }
  $('#site').textContent = `Opening ${host}…`;
  $('#buttons').hidden = true;
  await api.runtime.sendMessage({ type: 'apply' }).catch(() => {}); // the list is off before going there
  location.replace(wanted.href);
}

// Back to the Chataltul tab if one is open, or open Chataltul here.
$('#back').addEventListener('click', async () => {
  const app = st ? st.app : KX.DEFAULT_APP;
  if (!(await KX.toKavana(app))) location.href = app;
});
$('#edit').addEventListener('click', () => api.runtime.openOptionsPage());

async function load() { st = await KX.load(); draw(); }
api.storage.onChanged.addListener((c, area) => { if (area === 'local' && !over) load(); });
setInterval(() => { if (st && !over) draw(); }, 1000);
load();
