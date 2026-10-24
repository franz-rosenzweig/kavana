#!/usr/bin/env node
'use strict';
// Paint the cat portraits, the growing kittens and the café things with imagegen-cc (https://github.com/Master0fFate/imagegen-cc) on another
// machine with a GPU. A batch takes a while (minutes per picture on an M2), so it runs there on its
// own (tools/paint-runner.py) and this copies the pictures back as they finish.
//   export PAINT_SSH="ssh -i key user@host" PAINT_BIN="/path/to/imagegen-cc" PAINT_DATA="/path/to/plugin/data"
//   node tools/paint-cats.js start [names...] [--seeds 2] [--size 512]   (names: miso, miso-kitten, miso-nap, rug, ...)
//   node tools/paint-cats.js fetch <out dir>       (prints what's done; run it again later for more)
// Then cut each pick out with tools/cutout.py into web/cats/ (cats and kittens) or web/cafe/ (things).
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const args = process.argv.slice(2);
const mode = args.shift();
const opt = (k, d) => { const i = args.indexOf(`--${k}`); if (i < 0) return d; const v = args[i + 1]; args.splice(i, 2); return v; };
const SSH = (process.env.PAINT_SSH || '').split(' ').filter(Boolean);
const HOST = SSH[SSH.length - 1];
const OPTS = SSH.slice(1, -1); // -i / -o options work for scp too
const REMOTE = process.env.PAINT_REMOTE || '/tmp/kavana-cats';
if (!SSH.length || !['start', 'fetch'].includes(mode)) { console.error('usage: node tools/paint-cats.js start|fetch ... (see the top of the file)'); process.exit(2); }
const ssh = (cmd) => execFileSync(SSH[0], [...SSH.slice(1), cmd], { encoding: 'utf8' });

// One look for all of them: chunky kawaii stickers with thick dark outlines (which also makes them
// easy to cut out of the white background).
const STYLE = 'cute kawaii cartoon cat character, sticker illustration, chibi proportions, big round head, big shiny expressive eyes, '
  + 'soft rounded shapes, thick clean dark brown outline around the whole cat, flat colors with soft cel shading, sitting, front view, '
  + 'full body centered, isolated on a pure plain white background, no shadow, no text, adorable picture-book style, high quality';
const KITTEN = 'cute kawaii cartoon baby kitten, sticker illustration, tiny chibi kitten, very big round head, huge shiny eyes, '
  + 'soft rounded shapes, thick clean dark brown outline around the whole kitten, flat colors with soft cel shading, '
  + 'full body centered, isolated on a pure plain white background, no shadow, no text, adorable picture-book style, high quality';
const THING = 'cute kawaii sticker illustration, thick clean dark brown outline around the whole object, flat colors with soft cel shading, '
  + 'front view, centered, isolated on a pure plain white background, no shadow, no text, no cats, no people, adorable picture-book style, high quality';
const CATS = {
  miso: 'an orange tabby cat with darker orange stripes, a cream muzzle and chest, pink nose, warm happy smile',
  pepper: 'a sleek black cat with bright yellow-green eyes, a small pink nose, head tilted with curiosity',
  mochi: 'a fluffy cream-white cat with one soft light grey ear, pink inner ears and pink nose, sleepy content smile',
  pickles: 'a calico cat, white fur with big orange and black patches, playful grin, one paw raised',
  noodle: 'a tuxedo cat, black fur with a white chest, white muzzle and white paws, wearing a tiny red bow tie',
  earl: 'a distinguished grey tabby cat with amber eyes, wearing tiny round glasses, holding a tiny teacup',
  biscuit: 'a siamese cat, cream body with dark brown ears, face mask, paws and tail, bright blue eyes, holding a little round biscuit',
  boo: 'a cute ghost cat, pale glowing lavender-white and slightly see-through, floating, a wispy ghost tail instead of back legs, tiny "boo" mouth, little sparkles around it',
  // the ones you adopt with treats
  luna: 'a fluffy white persian cat with a flat cute face, copper eyes, long silky fur, a tiny pink flower behind one ear',
  maple: 'a big fluffy brown tabby maine coon cat with ear tufts, a bushy tail and a lion-like ruff, gentle smile',
  olive: 'a hairless pink sphynx cat with big ears and soft wrinkles, wearing a cozy knitted green sweater',
  dumpling: 'a very round grey scottish fold cat with tiny folded ears and huge round orange eyes',
  ziggy: 'a sporty bengal cat with golden fur and dark leopard-like spots, bright green eyes, playful',
  cocoa: 'a chubby brown and white cat wearing a tiny barista apron, holding a little coffee cup',
  // Halloween (only in the shop Oct 25 to Nov 1)
  pumpkin: 'a bright orange cat peeking out of a carved jack-o-lantern pumpkin with a friendly smiling face, both paws on the rim, a tiny pumpkin hat with a green stem',
  // Winter, Dec 15 to Jan 5
  flurry: 'a fluffy silver-blue cat wearing a cozy red knitted scarf and white fluffy earmuffs, rosy cheeks, a few snowflakes around it',
  // shelter cats you sponsor (the cat version of Forest's real trees); portraits only
  shelter1: 'a senior ginger cat with grey whiskers and kind sleepy half-closed eyes, a little grey around the muzzle, calm and gentle',
  shelter2: 'a scruffy grey tabby cat with one notched ear and a lopsided happy grin, a bit rough around the edges but very sweet',
  shelter3: 'a small shy tortoiseshell cat with a bright blue bandana around its neck, looking up hopefully',
  shelter4: 'a black and white cat with one floppy ear and a big round face, wearing a small green collar with a round tag',
};
// The kitten that grows in the timer ring: no props, just the coat.
const COATS = {
  miso: 'an orange tabby kitten with darker orange stripes, a cream muzzle and chest, pink nose',
  pepper: 'a black kitten with bright yellow-green eyes and a small pink nose',
  mochi: 'a fluffy cream-white kitten with one soft light grey ear and pink inner ears',
  pickles: 'a calico kitten, white fur with orange and black patches',
  noodle: 'a tuxedo kitten, black fur with a white chest, white muzzle and white paws',
  earl: 'a grey tabby kitten with darker grey stripes and amber eyes',
  biscuit: 'a siamese kitten, cream body with dark brown ears, face mask and paws, blue eyes',
  boo: 'a cute little ghost kitten, pale glowing lavender-white and slightly see-through, a wispy ghost tail',
  luna: 'a fluffy white persian kitten with a flat cute face and copper eyes',
  maple: 'a fluffy brown tabby maine coon kitten with ear tufts',
  olive: 'a hairless pink sphynx kitten with big ears, wearing a tiny knitted green sweater',
  dumpling: 'a round grey scottish fold kitten with tiny folded ears and huge orange eyes',
  ziggy: 'a bengal kitten with golden fur and dark leopard spots, green eyes',
  cocoa: 'a chubby brown and white kitten',
  pumpkin: 'a bright orange kitten wearing a tiny pumpkin hat with a green stem',
  flurry: 'a fluffy silver-blue kitten wearing a tiny red knitted scarf',
};
// The café: what the kitten arrives in, what's left when it wanders off, and what treats buy.
const THINGS = {
  basket: 'a small round wicker cat basket bed with a soft cream blanket, empty',
  yarn: 'a ball of soft pink yarn with a loose curly strand',
  gone: 'an empty little round cat cushion with a few tiny paw prints walking away from it',
  fish: 'a small cute fish-shaped cat treat cookie, golden brown',
  cushion: 'a plump round cat cushion bed, soft blue with a white trim',
  rug: 'a round cozy woven rug, soft pink and cream pattern, seen from slightly above',
  box: 'an open empty cardboard box, the flaps open',
  plant: 'a leafy monstera plant in a round terracotta pot',
  cattree: 'an empty tall cat tree tower with round cushioned platforms, a little cat house and rope scratching posts, beige and brown, nothing on it, no animals',
  window: 'a cozy arched window with a sunny blue sky, one little cloud and pink curtains tied at the sides',
  lamp: 'a warm glowing floor lamp with a round paper shade',
  yarnbasket: 'a woven basket full of colorful yarn balls',
  clock: 'a round wooden wall clock with a cat face',
  bookshelf: 'a small wooden bookshelf with colorful books and a tiny plant on top',
  fishbowl: 'a round glass fishbowl with water and a little orange goldfish',
  armchair: 'a cozy round velvet armchair, mustard yellow',
  counter: 'a small wooden cafe counter with a coffee machine, cups and a cake stand',
  // Halloween
  jackolantern: 'two carved jack-o-lantern pumpkins with friendly smiling faces glowing warm inside, one big and one small, side by side',
  candles: 'three cream candles of different heights with melting wax drips and small warm flames, standing together',
  batgarland: 'a long horizontal garland bunting of small cute black paper bats and orange triangle flags hanging along a curved string, wide',
  // Winter
  fireplace: 'a cozy little brick fireplace with a warm crackling fire and a wooden mantel with two candles',
  snowman: 'a cute small snowman with cat ears, a red scarf, coal eyes and a carrot nose, standing on a bit of snow',
  snowglobe: 'a round glass snow globe with a tiny cat and a pine tree inside, falling snow, on a wooden base',
  sled: 'a small wooden sled with a folded cozy red plaid blanket on it',
  cauldron: 'a round black witch cauldron on little legs, bubbling with glowing green potion and bubbles',
};
// Pictures that aren't square: [width, height] as parts of --size.
const SHAPE = { room: [1.5, 1], batgarland: [1.5, 0.75] };
// Every picture by name: "miso" (the grown cat), "miso-kitten", "miso-nap", or a thing.
const PICTURES = {};
for (const [id, p] of Object.entries(CATS)) PICTURES[id] = `${p}, ${STYLE}`;
for (const [id, p] of Object.entries(COATS)) {
  PICTURES[`${id}-kitten`] = `${p}, sitting, front view, playful, ${KITTEN}`;
  PICTURES[`${id}-nap`] = `${p}, curled up fast asleep in a little round ball, both eyes fully closed as gentle curved lines, sleeping peacefully, ${KITTEN}`;
}
for (const [id, p] of Object.entries(THINGS)) PICTURES[id] = `${p}, ${THING}`;
PICTURES.room = 'a cozy empty cat cafe room interior, front view of the back wall and floor, warm cream wallpaper with tiny dots, '
  + 'honey colored wooden floor boards, nothing in the room, kawaii flat illustration, soft pastel colors, picture-book style, no text, no cats';

if (mode === 'start') {
  const seeds = Number(opt('seeds', 2));
  const size = Number(opt('size', 512));
  if (!process.env.PAINT_BIN || !process.env.PAINT_DATA) { console.error('set PAINT_BIN and PAINT_DATA'); process.exit(2); }
  const want = args.length ? args : Object.keys(CATS);
  const bad = want.filter((id) => !PICTURES[id]);
  if (bad.length) { console.error(`unknown: ${bad.join(' ')}\nknown: ${Object.keys(PICTURES).join(' ')}`); process.exit(2); }
  const jobs = [];
  for (let s = 0; s < seeds; s++) {
    for (const id of want) { // one round of everything first, so a first pick is ready early
      const seed = 1000 + Math.floor(Math.random() * 9000);
      const [w, h] = (SHAPE[id] || [1, 1]).map((k) => Math.round((size * k) / 64) * 64);
      jobs.push({ name: `${id}-${seed}`, args: { prompt: PICTURES[id], width: w, height: h, count: 1, seed } });
    }
  }
  const tmp = fs.mkdtempSync('/tmp/kavana-paint-');
  fs.writeFileSync(path.join(tmp, 'jobs.json'), JSON.stringify(jobs, null, 1));
  ssh(`mkdir -p ${REMOTE}`);
  execFileSync('scp', [...OPTS, path.join(__dirname, 'paint-runner.py'), path.join(tmp, 'jobs.json'), `${HOST}:${REMOTE}/`]);
  ssh(`cd ${REMOTE} && rm -f results.jsonl && nohup /usr/bin/python3 paint-runner.py ${JSON.stringify(process.env.PAINT_BIN)} ${JSON.stringify(process.env.PAINT_DATA)} jobs.json results.jsonl > runner.log 2>&1 < /dev/null &`);
  console.log(`started ${jobs.length} pictures on ${HOST}: ${jobs.map((j) => j.name).join(' ')}`);
} else {
  const out = args[0];
  fs.mkdirSync(out, { recursive: true });
  let lines = [];
  try { lines = ssh(`cat ${REMOTE}/results.jsonl 2>/dev/null || true`).split('\n').filter(Boolean).map((l) => JSON.parse(l)); } catch {}
  let done = false;
  for (const r of lines) {
    if (r.done) { done = true; continue; }
    if (r.error || !r.files.length) { console.log(`${r.name}: failed ${String(r.error).slice(0, 120)}`); continue; }
    const dest = path.join(out, `${r.name}${path.extname(r.files[0])}`);
    if (!fs.existsSync(dest)) execFileSync('scp', [...OPTS, `${HOST}:${r.files[0]}`, dest]);
    console.log(`${r.name}: ${dest} (${r.seconds} s)`);
  }
  console.log(done ? 'ALL DONE' : `${lines.filter((r) => !r.done).length} finished so far`);
}
