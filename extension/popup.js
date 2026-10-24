// The toolbar button: is a block running, and how long is left.
'use strict';
const { api } = KX;
const $ = (s) => document.querySelector(s);

(async () => {
  const { block, app, sites } = await KX.load();
  const n = `${sites.length} site${sites.length === 1 ? '' : 's'}`;
  const cat = KX.running(block) && block.cat;
  if (KX.running(block)) {
    $('#title').textContent = cat && cat.kitten === 'growing' ? `${cat.name} is growing` : 'A block is running';
    $('#sub').textContent = `${block.intention ? `${block.intention}. ` : ''}Blocking ${n} for ${KX.left(block.end - Date.now())}, until ${KX.clock(block.end)}.`;
  } else {
    $('#title').textContent = 'No block running';
    $('#sub').textContent = `Start one in Kavana, and ${n} show a cat until it ends.`;
  }
  const img = $('#pic');
  if (KX.picture(app, cat)) {
    img.onerror = () => { img.onerror = null; img.src = 'icons/kitten.webp'; };
    img.src = KX.picture(app, cat);
  }
  $('#open').addEventListener('click', async () => {
    if (!(await KX.toKavana(app))) await api.tabs.create({ url: app });
    window.close();
  });
  $('#edit').addEventListener('click', () => { api.runtime.openOptionsPage(); window.close(); });
})();
