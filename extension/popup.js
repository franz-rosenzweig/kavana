// The toolbar button: is a block running, and how long is left.
'use strict';
const { api } = KX;
const $ = (s) => document.querySelector(s);

(async () => {
  const { block, app, sites, mode, keep } = await KX.load();
  const except = mode === 'except';
  const cat = KX.running(block) && block.cat;
  if (KX.running(block)) {
    const left = `${KX.left(block.end - Date.now())}, until ${KX.clock(block.end)}`;
    $('#title').textContent = cat && cat.kitten === 'growing' ? `${cat.name} is growing` : 'A block is running';
    $('#sub').textContent = `${block.intention ? `${block.intention}. ` : ''}${
      !except ? `Blocking ${KX.count(sites.length)} for ${left}.`
        : keep.length ? `Only ${KX.count(keep.length)} open for ${left}.` : `Every site shows a cat for ${left}.`}`;
  } else {
    $('#title').textContent = 'No block running';
    $('#sub').textContent = `Start one in Chataltul, and ${
      !except ? `${KX.count(sites.length)} show` : keep.length ? `every site but ${KX.count(keep.length)} shows` : 'every site shows'} a cat until it ends.`;
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
