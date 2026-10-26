// Chataltul's cats: one drawing kit, fourteen cats, four poses (peek, sit, sleep, cheer), and the Cat Café's things.
// Cat(breed, pose) returns an SVG string. Ids inside are unique per call, so many can share a page.
// Loaded by the page (window.KavanaCats) and by Node for tests and the Android notification picture.
(function (root) {
'use strict';
const INK = '#1e2627';

// Fur, details, and which markings each breed gets.
const BREEDS = {
  orange: { fur: '#eea45c', mark: '#b96d2a', ear: '#f5c4b3', nose: '#e07a6a', eye: INK, line: INK, marks: 'tabby' },
  black: { fur: '#2d2f36', mark: '#2d2f36', ear: '#6e4c5c', nose: '#8a5e6e', eye: '#e6a42a', pupil: INK, line: '#101214', detail: '#d9d5e2', marks: 'none', shine: '#fff' },
  cream: { fur: '#fff6ea', mark: '#cbc3bb', ear: '#f7b9c6', nose: '#f19aac', eye: INK, line: INK, marks: 'earpatch' },
  calico: { fur: '#fffaf3', mark: '#eea45c', mark2: '#33353c', ear: '#f5c4b3', nose: '#e07a6a', eye: INK, line: INK, marks: 'calico' },
  grey: { fur: '#a3acb7', mark: '#6c7581', ear: '#f0c1c4', nose: '#d98a93', eye: '#d9a441', pupil: INK, line: INK, marks: 'tabby' },
  siamese: { fur: '#f4e8d6', mark: '#6a4a3a', ear: '#6a4a3a', nose: '#4a3328', eye: '#6bb8ea', pupil: INK, line: INK, marks: 'points' },
  tuxedo: { fur: '#2d2f36', mark: '#ffffff', ear: '#6e4c5c', nose: '#f19aac', eye: '#9fd88a', pupil: INK, line: '#101214', detail: '#d9d5e2', marks: 'tuxedo', shine: '#fff' },
  ghost: { fur: '#efeaff', mark: '#d9d1ff', ear: '#d9d1ff', nose: '#b9aee8', eye: '#5b5480', line: '#7d74a8', marks: 'none', ghost: true },
  white: { fur: '#ffffff', mark: '#ece6df', ear: '#f7b9c6', nose: '#f19aac', eye: '#d98a3a', pupil: INK, line: INK, marks: 'none' },
  cocoa: { fur: '#8a5a3c', mark: '#fff6ea', ear: '#d9a08a', nose: '#f19aac', eye: '#e0b040', pupil: INK, line: INK, marks: 'tuxedo' },
  sphynx: { fur: '#f4c6b8', mark: '#e3a998', ear: '#ec9f92', nose: '#d97a7a', eye: '#7fc4a0', pupil: INK, line: INK, marks: 'none' },
  fold: { fur: '#9aa3b0', mark: '#7a8391', ear: '#e8bcc0', nose: '#cf8a93', eye: '#f0a040', pupil: INK, line: INK, marks: 'none' },
  brown: { fur: '#a8794e', mark: '#6b4a2e', ear: '#e8b9a0', nose: '#c97a6a', eye: '#c9a13a', pupil: INK, line: INK, marks: 'tabby' },
  gold: { fur: '#e9b25a', mark: '#7a4a22', ear: '#f5c4b3', nose: '#d0705a', eye: '#8fd06a', pupil: INK, line: INK, marks: 'tabby' },
  pumpkin: { fur: '#f28c28', mark: '#c4621a', ear: '#f5c4b3', nose: '#e07a6a', eye: INK, line: INK, marks: 'tabby' },
  flurry: { fur: '#c9d6e6', mark: '#9fb3cc', ear: '#f2c1cc', nose: '#e59aac', eye: '#5b8fd6', pupil: INK, line: INK, marks: 'none' },
};

// The cats. The first eight you meet by focusing: `rule` gets the stats from Chataltul's history (see
// app.js) and says if you've met them. The rest you adopt in the shop with treats (prices in engine.js).
// The pictures are painted (web/cats/, made with tools/paint-cats.js): the grown cat, the kitten
// growing in the timer ring, and the kitten napping when it has just arrived.
// A cat whose pictures are repainted gets a new number, because they're cached for a day (Milo's eyes went gold).
const V = { pepper: 2 };
const art = (id) => ({ portrait: `cats/${id}-${V[id] || 1}.webp`, kitten: `cats/${id}-kitten-${V[id] || 1}.webp`, nap: `cats/${id}-nap-${V[id] || 1}.webp` });
const CATS = [
  { id: 'miso', name: 'Miso', ...art('miso'), breed: 'orange', about: 'An orange tabby who naps while you work.', how: 'Here from the start', rule: () => true },
  { id: 'pepper', name: 'Milo', ...art('pepper'), breed: 'black', about: 'Gold eyes, quiet and curious, and always on time.', how: 'Finish your first block', rule: (s) => s.finished >= 1 },
  { id: 'mochi', name: 'Mochi', ...art('mochi'), breed: 'cream', about: 'Soft as a cloud, sleeps in sunbeams.', how: 'Focus for 1 hour in all', rule: (s) => s.totalMin >= 60 },
  { id: 'pickles', name: 'Pickles', ...art('pickles'), breed: 'calico', about: 'Shows up when you keep showing up.', how: 'Focus 3 days in a row', rule: (s) => s.bestStreak >= 3 },
  { id: 'noodle', name: 'Noodle', ...art('noodle'), breed: 'tuxedo', about: 'Dressed up for a good break.', how: 'Take 3 breaks', rule: (s) => s.breaks >= 3 },
  { id: 'earl', name: 'Earl Grey', ...art('earl'), breed: 'grey', about: 'A distinguished cat for long sessions.', how: 'Focus for 5 hours in all', rule: (s) => s.totalMin >= 300 },
  { id: 'biscuit', name: 'Biscuit', ...art('biscuit'), breed: 'siamese', about: 'Says a lot, mostly "well done".', how: 'Mark 10 blocks Done', rule: (s) => s.done >= 10 },
  { id: 'boo', name: 'Boo', ...art('boo'), breed: 'ghost', about: 'Only comes out late. Boo!', how: 'Focus after 10 at night', rule: (s) => s.night >= 1 },
  { id: 'luna', name: 'Luna', ...art('luna'), breed: 'white', about: 'A fluffy cloud with opinions.', adopt: true },
  { id: 'cocoa', name: 'Cocoa', ...art('cocoa'), breed: 'cocoa', about: 'Runs the café. Makes a good latte.', adopt: true },
  { id: 'olive', name: 'Olive', ...art('olive'), breed: 'sphynx', about: 'Wears her sweater all year round.', adopt: true },
  { id: 'dumpling', name: 'Dumpling', ...art('dumpling'), breed: 'fold', about: 'Round, folded, very sure of himself.', adopt: true },
  { id: 'maple', name: 'Maple', ...art('maple'), breed: 'brown', about: 'A gentle giant for long sessions.', adopt: true },
  { id: 'ziggy', name: 'Ziggy', ...art('ziggy'), breed: 'gold', about: 'Fast, spotted, always ready to start.', adopt: true },
  // Limited: in the shop only during its event (E.EVENTS in engine.js)
  { id: 'pumpkin', name: 'Pumpkin', ...art('pumpkin'), breed: 'pumpkin', about: 'Lives in a jack-o\'-lantern. Only here for Halloween.', adopt: true, limited: 'halloween' },
  { id: 'flurry', name: 'Flurry', ...art('flurry'), breed: 'flurry', about: 'Wears her scarf indoors. Only here in winter.', adopt: true, limited: 'winter' },
];
// What the 3D café's cats can do besides sit and nap (web/cats/<id>-<pose>-1.webp): walk side-on (the
// paintings face right), lie in a loaf, stretch, wash a paw, and sit with their back to you at the window.
// Only some cats have them so far; the rest sit, nap and hop.
const MOVES = {
  miso: ['walk', 'loaf', 'stretch', 'wash', 'back'], mochi: ['walk', 'loaf', 'stretch', 'wash', 'back'],
  pepper: ['walk', 'loaf', 'stretch', 'wash', 'back'], pickles: ['walk', 'loaf', 'stretch', 'wash', 'back'],
};
for (const c of CATS) if (MOVES[c.id]) c.poses = Object.fromEntries(MOVES[c.id].map((p) => [p, `cats/${c.id}-${p}-${V[c.id] || 1}.webp`]));

// The Cat Café's things (web/cafe/). `at` is where it goes in the room: [center x, bottom y, width],
// in % of the room (3:2; the wall is the top 58%). Wall things hang behind everything on the floor.
// `perch` is a spot where a cat that came home can sit on it, [x, bottom y].
const ITEMS = [
  { id: 'box', name: 'Cardboard Box', about: 'Every cat\'s favorite.', at: [69, 97, 14], perch: [69, 90] },
  { id: 'cushion', name: 'Cushion', about: 'A soft place to land.', at: [37, 95, 15], perch: [37, 89] },
  { id: 'yarnbasket', name: 'Yarn Basket', about: 'Something to bat at.', at: [27, 79, 11] },
  { id: 'rug', name: 'Rug', about: 'Warms up the floor.', at: [52, 95, 40], floor: true }, // painted from above, laid flat
  { id: 'plant', name: 'Plant', about: 'Leafy. Please don\'t eat it.', at: [6, 64, 14] },
  { id: 'clock', name: 'Clock', about: 'Tells you when the next block ends.', at: [87, 27, 10], wall: true },
  { id: 'lamp', name: 'Lamp', about: 'A warm glow for late sessions.', at: [46, 63, 17] },
  { id: 'window', name: 'Window', about: 'Sunshine and birds to watch.', at: [27, 50, 25], wall: true, perch: [27, 48] },
  { id: 'fishbowl', name: 'Fishbowl', about: 'Look, don\'t touch.', at: [77, 77, 10] },
  { id: 'armchair', name: 'Armchair', about: 'The best seat in the café.', at: [87, 93, 23], perch: [87, 83] },
  { id: 'bookshelf', name: 'Bookshelf', about: 'Good reading for breaks.', at: [91, 63, 17], perch: [88, 39.5] },
  { id: 'cattree', name: 'Cat Tree', about: 'Room to climb, a lookout on top.', at: [12, 90, 27], perch: [12, 55.5] },
  { id: 'counter', name: 'Café Counter', about: 'Coffee for you, cream for them.', at: [66, 64, 29], perch: [66, 23] },
  // Halloween
  { id: 'batgarland', name: 'Bat Garland', about: 'Little bats along the wall.', at: [50, 31, 60], wall: true, limited: 'halloween' },
  { id: 'jackolantern', name: 'Jack-o\'-Lanterns', about: 'Two grins that glow.', at: [57, 75, 12], limited: 'halloween' },
  { id: 'candles', name: 'Candles', about: 'A spooky glow. Paws off.', at: [33, 72, 7], limited: 'halloween' },
  { id: 'cauldron', name: 'Cauldron', about: 'Bubbling, green, smells like tuna.', at: [42, 80, 12], limited: 'halloween' },
  // Winter (the snow globe sits on the window sill, or on the floor without a window)
  { id: 'fireplace', name: 'Fireplace', about: 'Toasty. Every cat wants the spot in front.', at: [36, 64, 15], limited: 'winter', perch: [36, 67] },
  { id: 'snowman', name: 'Snowman', about: 'Built by paws. Has ears, obviously.', at: [59, 77, 10], limited: 'winter' },
  { id: 'snowglobe', name: 'Snow Globe', about: 'Shake it and a tiny cat gets snowed on.', at: [19, 49.5, 6], on: 'window', alt: [8, 80, 7], limited: 'winter' },
  { id: 'sled', name: 'Sled', about: 'A blanket, a sled, a nap.', at: [30, 99, 14], limited: 'winter' },
].map((x) => ({ ...x, art: `cafe/${x.id}-1.webp` }));
// Things painted from more than the front, so they turn when you spin the 3D café
// (web/cafe/<id>-<view>-<number>.webp; a repainted view gets the next number).
const TURNS = { cattree: { side: 1, back: 1 }, counter: { side: 1, back: 1 }, bookshelf: { side: 2, back: 1 }, armchair: { side: 2 } };
for (const x of ITEMS) if (TURNS[x.id]) x.views = Object.fromEntries(Object.entries(TURNS[x.id]).map(([v, n]) => [v, `cafe/${x.id}-${v}-${n}.webp`]));

// Shelter cats: the cat version of Forest's real trees. Sponsoring one (with treats) stands for a real
// shelter cat; they come one after the other, and live in your café from then on. The link goes to a
// real shelter's donation page: no money goes through Chataltul.
const SHELTER_ORG = { name: 'Best Friends Animal Society', url: 'https://bestfriends.org/donate' };
const SHELTER = [
  { id: 'shelter1', name: 'Ginger Snap', about: 'A senior with grey whiskers. Calm, gentle, patient.' },
  { id: 'shelter2', name: 'Scrappy', about: 'A notched ear and a lopsided grin. All heart.' },
  { id: 'shelter3', name: 'Penny', about: 'Shy at first, then your shadow. Loves her bandana.' },
  { id: 'shelter4', name: 'Domino', about: 'One floppy ear, one big round face, zero worries.' },
].map((x) => ({ ...x, portrait: `cats/${x.id}-1.webp` }));

// Café themes (Forest's land styles): the wall and floor. The colors are in style.css (.room.theme-<id>).
const THEMES = [
  { id: 'classic', name: 'Classic', about: 'Cream walls, honey floor.' },
  { id: 'mint', name: 'Mint', about: 'Fresh green walls, light oak.' },
  { id: 'sakura', name: 'Sakura', about: 'Pink walls and petals.' },
  { id: 'library', name: 'Library', about: 'Deep green and dark wood.' },
  { id: 'garden', name: 'Garden', about: 'Sky blue and a grass floor.' },
  { id: 'night', name: 'Night Café', about: 'Starry walls, lamplit floor.' },
];

let n = 0;
const uid = () => `c${Date.now().toString(36)}${(n++).toString(36)}`;

// Eyes: open (with pupils for colored eyes), closed (sleep), happy (^ ^).
function eyes(b, kind, lx, ly, rx, ry, r = 9) {
  if (kind === 'closed') {
    return `<path d="M${lx - 10} ${ly} q10 8 20 0 M${rx - 10} ${ry} q10 8 20 0" fill="none" stroke="${b.detail || b.line}" stroke-width="4.5" stroke-linecap="round"/>`;
  }
  if (kind === 'happy') {
    return `<path d="M${lx - 10} ${ly + 3} q10 -12 20 0 M${rx - 10} ${ry + 3} q10 -12 20 0" fill="none" stroke="${b.detail || b.line}" stroke-width="4.5" stroke-linecap="round"/>`;
  }
  const one = (x, y) => (b.pupil
    ? `<ellipse cx="${x}" cy="${y}" rx="${r}" ry="${r * 1.2}" fill="${b.eye}" stroke="${b.line}" stroke-width="2.5"/><ellipse cx="${x}" cy="${y}" rx="${r * 0.38}" ry="${r * 1}" fill="${b.pupil}"/>`
    : `<ellipse cx="${x}" cy="${y}" rx="${r * 0.85}" ry="${r * 1.15}" fill="${b.eye}"/>`) + `<circle cx="${x + 3}" cy="${y - 4}" r="2.8" fill="${b.shine || '#fff'}"/>`;
  return `<g class="eyes">${one(lx, ly)}${one(rx, ry)}</g>`;
}

// One face, placed at a head center (cx, cy) with a size factor.
function face(b, cx, cy, k, mood) {
  const d = b.detail || b.line;
  const ex = 24 * k, ey = -4 * k;
  const mouth = mood === 'boo' ? `<ellipse cx="${cx}" cy="${cy + 26 * k}" rx="${6 * k}" ry="${7 * k}" fill="#6b2b2b"/>`
    : mood === 'happy' ? `<path d="M${cx - 12 * k} ${cy + 20 * k} q${12 * k} ${16 * k} ${24 * k} 0 z" fill="#8a3b3b" stroke="${b.line}" stroke-width="3" stroke-linejoin="round"/>`
    : `<path d="M${cx} ${cy + 18 * k} q-${6 * k} ${8 * k} -${12 * k} ${3 * k} M${cx} ${cy + 18 * k} q${6 * k} ${8 * k} ${12 * k} ${3 * k}" fill="none" stroke="${d}" stroke-width="3" stroke-linecap="round"/>`;
  const eyeKind = mood === 'sleep' ? 'closed' : mood === 'happy' ? 'happy' : 'open';
  const whisk = (s) => `<path d="M${cx + s * 34 * k} ${cy + 10 * k} l${s * 30 * k} -${5 * k} M${cx + s * 34 * k} ${cy + 17 * k} l${s * 28 * k} ${3 * k}" stroke="${d}" stroke-width="2.6" stroke-linecap="round"/>`;
  return eyes(b, eyeKind, cx - ex, cy + ey, cx + ex, cy + ey, 8.5 * k)
    + `<path d="M${cx - 6 * k} ${cy + 9 * k} h${12 * k} l-${6 * k} ${7 * k} z" fill="${b.nose}" stroke-linejoin="round"/>`
    + mouth + whisk(-1) + whisk(1)
    + (mood === 'happy' ? `<ellipse cx="${cx - 34 * k}" cy="${cy + 14 * k}" rx="${8 * k}" ry="${5 * k}" fill="#f2918f" opacity=".45"/><ellipse cx="${cx + 34 * k}" cy="${cy + 14 * k}" rx="${8 * k}" ry="${5 * k}" fill="#f2918f" opacity=".45"/>` : '');
}

// Markings, clipped to a head or body shape.
function marks(b, part, shape, id) {
  const clip = `<clipPath id="${id}">${shape}</clipPath>`;
  const g = (inner) => `${clip}<g clip-path="url(#${id})">${inner}</g>`;
  const { x, y, k } = part;
  switch (b.marks) {
    case 'tabby':
      return part.head
        ? g(`<path d="M${x - 14 * k} ${y - 44 * k} q4 ${14 * k} 0 ${22 * k} M${x} ${y - 46 * k} v${22 * k} M${x + 14 * k} ${y - 44 * k} q-4 ${14 * k} 0 ${22 * k}" stroke="${b.mark}" stroke-width="${5 * k}" stroke-linecap="round" fill="none"/>`)
        : g(`<path d="M${x - 60 * k} ${y - 6 * k} q${18 * k} ${10 * k} ${30 * k} 0 M${x + 30 * k} ${y - 2 * k} q${14 * k} ${10 * k} ${30 * k} 0 M${x - 50 * k} ${y + 18 * k} q${16 * k} ${8 * k} ${26 * k} 0" stroke="${b.mark}" stroke-width="${6 * k}" stroke-linecap="round" fill="none"/>`);
    case 'calico':
      return part.head
        ? g(`<circle cx="${x - 40 * k}" cy="${y - 30 * k}" r="${34 * k}" fill="${b.mark}"/><circle cx="${x + 46 * k}" cy="${y - 34 * k}" r="${26 * k}" fill="${b.mark2}"/>`)
        : g(`<ellipse cx="${x + 40 * k}" cy="${y - 6 * k}" rx="${34 * k}" ry="${24 * k}" fill="${b.mark}"/><ellipse cx="${x - 48 * k}" cy="${y + 14 * k}" rx="${26 * k}" ry="${20 * k}" fill="${b.mark2}"/>`);
    case 'points':
      return part.head ? g(`<ellipse cx="${x}" cy="${y + 16 * k}" rx="${30 * k}" ry="${26 * k}" fill="${b.mark}" opacity=".85"/>`) : '';
    case 'tuxedo':
      return part.head
        ? g(`<path d="M${x} ${y - 8 * k} q-${26 * k} ${18 * k} -${30 * k} ${50 * k} h${60 * k} q-${4 * k} -${32 * k} -${30 * k} -${50 * k} z" fill="${b.mark}"/>`)
        : part.side ? '' : g(`<ellipse cx="${x}" cy="${y - 10 * k}" rx="${24 * k}" ry="${34 * k}" fill="${b.mark}"/>`);
    case 'earpatch':
      return part.head ? g(`<circle cx="${x + 44 * k}" cy="${y - 40 * k}" r="${24 * k}" fill="${b.mark}"/>`) : '';
    default:
      return '';
  }
}

const furAttrs = (b) => `fill="${b.fur}" stroke="${b.line}" stroke-width="5" stroke-linejoin="round"`;
const pointColor = (b, part) => (b.marks === 'points' && ['ear', 'paw', 'tail'].includes(part) ? b.mark : b.marks === 'tuxedo' && part === 'paw' ? b.mark : b.fur);

function ears(b, cx, cy, k) {
  const one = (s) => `<path d="M${cx + s * 22 * k} ${cy - 34 * k} L${cx + s * 50 * k} ${cy - 78 * k} L${cx + s * 58 * k} ${cy - 18 * k} Z" fill="${pointColor(b, 'ear')}" stroke="${b.line}" stroke-width="5" stroke-linejoin="round"/>`
    + `<path d="M${cx + s * 32 * k} ${cy - 36 * k} L${cx + s * 48 * k} ${cy - 62 * k} L${cx + s * 51 * k} ${cy - 30 * k} Z" fill="${b.ear}"/>`;
  return `<g class="ears">${one(-1)}${one(1)}</g>`;
}

function head(b, cx, cy, k, mood, id) {
  const shape = `<ellipse cx="${cx}" cy="${cy}" rx="${64 * k}" ry="${54 * k}"/>`;
  return ears(b, cx, cy, k)
    + `<ellipse cx="${cx}" cy="${cy}" rx="${64 * k}" ry="${54 * k}" ${furAttrs(b)}/>`
    + marks(b, { head: true, x: cx, y: cy, k }, shape, `${id}h`)
    + `<ellipse cx="${cx}" cy="${cy}" rx="${64 * k}" ry="${54 * k}" fill="none" stroke="${b.line}" stroke-width="5"/>`
    + `<g class="face">${face(b, cx, cy, k, mood)}</g>`;
}

const tailPath = (b, d) => `<path d="${d}" fill="none" stroke="${b.line}" stroke-width="22" stroke-linecap="round"/><path d="${d}" fill="none" stroke="${pointColor(b, 'tail')}" stroke-width="13" stroke-linecap="round"/>`;

const POSES = {
  // Head and paws over an edge (the check-in cat). viewBox 200x150.
  peek(b, id) {
    return { vb: '0 0 200 150', body: head(b, 100, 92, 1, 'boo', id)
      + `<ellipse cx="58" cy="146" rx="22" ry="13" fill="${pointColor(b, 'paw')}" stroke="${b.line}" stroke-width="5"/>`
      + `<ellipse cx="142" cy="146" rx="22" ry="13" fill="${pointColor(b, 'paw')}" stroke="${b.line}" stroke-width="5"/>` };
  },
  // Sitting up, tail around the paws (home, breaks). viewBox 200x220.
  sit(b, id, mood = 'calm') {
    const body = 'M58 205 C40 150 58 112 100 110 C142 112 160 150 142 205 Z';
    const shape = `<path d="${body}"/>`;
    return { vb: '0 0 200 220', body: `<g class="tail">${tailPath(b, 'M140 196 C186 196 190 150 168 128')}</g>`
      + `<path d="${body}" ${furAttrs(b)}/>` + marks(b, { x: 100, y: 160, k: 0.8 }, shape, `${id}b`)
      + `<path d="${body}" fill="none" stroke="${b.line}" stroke-width="5" stroke-linejoin="round"/>`
      + `<ellipse cx="80" cy="203" rx="18" ry="11" fill="${pointColor(b, 'paw')}" stroke="${b.line}" stroke-width="5"/>`
      + `<ellipse cx="120" cy="203" rx="18" ry="11" fill="${pointColor(b, 'paw')}" stroke="${b.line}" stroke-width="5"/>`
      + `<g class="headgroup">${head(b, 100, 82, 0.82, mood, id)}</g>` };
  },
  // Curled up asleep (during a block). viewBox 240x170.
  sleep(b, id) {
    const body = 'M30 118 C30 66 90 52 140 56 C196 60 222 92 214 128 C206 160 150 166 110 164 C60 162 30 150 30 118 Z';
    const shape = `<path d="${body}"/>`;
    return { vb: '0 0 240 170', body: `<g class="breath">`
      + `<path d="${body}" ${furAttrs(b)}/>` + marks(b, { x: 150, y: 104, k: 0.85, side: true }, shape, `${id}b`)
      + `<path d="${body}" fill="none" stroke="${b.line}" stroke-width="5" stroke-linejoin="round"/>`
      + `<g class="tail">${tailPath(b, 'M206 134 C196 168 120 172 76 156')}</g>`
      + `<g class="headgroup">${head(b, 84, 112, 0.66, 'sleep', id)}</g>`
      + `</g><g class="zzz" fill="${b.line}" font-family="ui-rounded, system-ui, sans-serif" font-weight="800"><text x="132" y="44" font-size="22">z</text><text x="154" y="26" font-size="16">z</text><text x="170" y="12" font-size="12">z</text></g>` };
  },
  // Paws up (a block done, a new cat met). viewBox 200x220.
  cheer(b, id) {
    const body = 'M60 205 C44 154 60 116 100 114 C140 116 156 154 140 205 Z';
    const shape = `<path d="${body}"/>`;
    const arm = (d) => `<path d="${d}" fill="none" stroke="${b.line}" stroke-width="24" stroke-linecap="round"/><path d="${d}" fill="none" stroke="${pointColor(b, 'paw')}" stroke-width="14" stroke-linecap="round"/>`;
    return { vb: '0 0 200 220', body: `<g class="tail">${tailPath(b, 'M138 194 C178 190 186 160 176 136')}</g>`
      + `<path d="${body}" ${furAttrs(b)}/>` + marks(b, { x: 100, y: 162, k: 0.8 }, shape, `${id}b`)
      + `<path d="${body}" fill="none" stroke="${b.line}" stroke-width="5" stroke-linejoin="round"/>`
      + `<g class="arms">${arm('M70 140 C50 124 40 104 36 84')}${arm('M130 140 C150 124 160 104 164 84')}</g>`
      + `<ellipse cx="82" cy="204" rx="17" ry="10" fill="${pointColor(b, 'paw')}" stroke="${b.line}" stroke-width="5"/>`
      + `<ellipse cx="118" cy="204" rx="17" ry="10" fill="${pointColor(b, 'paw')}" stroke="${b.line}" stroke-width="5"/>`
      + `<g class="headgroup">${head(b, 100, 82, 0.82, 'happy', id)}</g>` };
  },
};

function Cat(breed, pose = 'sit', opts = {}) {
  const b = BREEDS[breed] || BREEDS.orange;
  const id = uid();
  const p = POSES[pose] ? POSES[pose](b, id, opts.mood) : POSES.sit(b, id, opts.mood);
  const ghost = b.ghost ? ' ghost' : '';
  return `<svg class="catart pose-${pose}${ghost}" viewBox="${p.vb}" aria-hidden="true" overflow="visible">${p.body}</svg>`;
}

const api = { Cat, CATS, BREEDS, ITEMS, SHELTER, SHELTER_ORG, THEMES, byId: (id) => CATS.find((c) => c.id === id) || CATS[0], item: (id) => ITEMS.find((x) => x.id === id) };
if (typeof module !== 'undefined') module.exports = api; else root.KavanaCats = api;
})(this);
