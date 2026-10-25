// Kavana's engine: everything a block does, as plain functions over one document (the "doc").
// The page keeps the doc in the browser. With an account it's also synced to the server, which
// loads this same file to merge copies and to work out when to send the pings.
(function (root) {
'use strict';
const E = {};
// Tests shrink the minute. A doc keeps its last KEEP blocks, and only as many as fit in BYTES of JSON
// (the server takes 1 MB); older ones go into doc.past.
E.config = { MIN: 60000, KEEP: 2000, BYTES: 800000 };
const M = () => E.config.MIN;
const LINES = typeof module !== 'undefined' ? require('./lines.js') : root.KavanaLines;

const uid = () => {
  const b = new Uint8Array(9);
  (typeof crypto !== 'undefined' ? crypto : require('node:crypto').webcrypto).getRandomValues(b);
  return Array.from(b, (x) => 'abcdefghijkmnpqrstuvwxyz23456789'[x % 32]).join('');
};
const clean = (v, max) => String(v || '').replace(/\s+/g, ' ').trim().slice(0, max);
E.clean = clean;
E.STYLES = ['ask', 'nudge'];
E.INTERVALS = [0, 10, 15, 20, 30, 45, 60];
E.GOALS = [0, 30, 60, 90, 120, 180];
E.MORE = [5, 10, 15, 20];
E.BREAKS = [5, 10, 15];
E.OUTCOMES = ['done', 'partly', 'notreally'];
E.REASONS = ['phone', 'messages', 'email', 'web', 'tired', 'hungry', 'thoughts', 'people', 'other'];
E.SHARE = ['off', 'status', 'all']; // focus with friends: nothing / that I'm focusing / and on what
E.TAGS = ['Work', 'Study', 'Reading', 'Writing', 'Other'];
// The Cat Café shop, in treats (🐟, one per minute of a block whose kitten came home). Café things
// first, then the cats you can adopt. What they look like and where they go is in cats.js.
E.SHOP = {
  box: 20, cushion: 40, yarnbasket: 40, rug: 60, plant: 60, clock: 60, lamp: 80, window: 100,
  fishbowl: 120, armchair: 150, bookshelf: 180, cattree: 240, counter: 300,
  luna: 200, cocoa: 250, olive: 300, dumpling: 350, maple: 400, ziggy: 450,
  // Halloween (see E.EVENTS)
  candles: 40, jackolantern: 60, batgarland: 80, cauldron: 120, pumpkin: 300,
  // Winter
  snowglobe: 40, sled: 60, snowman: 80, fireplace: 150, flurry: 300,
  // Café themes (wallpaper and floor; "classic" is free)
  'theme-mint': 100, 'theme-sakura': 150, 'theme-library': 150, 'theme-garden': 200, 'theme-night': 250,
  // Sounds (one in each group is free: see web/sounds.js)
  'sound-cafe': 60, 'sound-fire': 60, 'sound-waves': 80, 'sound-birds': 80, 'sound-night': 80, 'sound-wind': 60,
  'sound-bigpurr': 60, 'sound-deeppurr': 60, 'sound-sleepypurr': 60, 'sound-tomasina': 80,
  'sound-lightrain': 60, 'sound-heavyrain': 60, 'sound-thunder': 80, 'sound-rainforest': 80, 'sound-stream': 60,
  'sound-bigwaves': 80, 'sound-baltic': 60, 'sound-ocean': 60,
  'sound-crackle': 60, 'sound-hearth': 60, 'sound-bigroom': 80,
  'sound-birdsong': 60, 'sound-crickets': 60, 'sound-farstorm': 80, 'sound-hollowwind': 60,
  'sound-copenhagen': 80, 'sound-city': 60,
  'sound-dunes': 80, 'sound-angelic': 80, 'sound-bowls': 80, 'sound-tibetan': 80,
  // Shelter cats: the cat version of Forest's real trees. Each one stands for a real shelter cat;
  // they come one after the other.
  shelter1: 1000, shelter2: 1000, shelter3: 1000, shelter4: 1000,
};
E.SHELTER = ['shelter1', 'shelter2', 'shelter3', 'shelter4'];
// Limited things: in the shop only from `from` to `to` ([month, day], both days in, local time), every
// year. What you got, you keep.
E.EVENTS = [
  { id: 'halloween', name: 'Halloween', from: [10, 25], to: [11, 1], items: ['pumpkin', 'jackolantern', 'candles', 'batgarland', 'cauldron'] },
  { id: 'winter', name: 'Winter', from: [12, 15], to: [1, 5], items: ['flurry', 'snowglobe', 'sled', 'snowman', 'fireplace'] },
];
const md = (t) => { const d = new Date(t); return (d.getMonth() + 1) * 100 + d.getDate(); };
const inSeason = (e, t) => { const a = e.from[0] * 100 + e.from[1], z = e.to[0] * 100 + e.to[1], x = md(t); return a <= z ? x >= a && x <= z : x >= a || x <= z; }; // Winter runs over New Year
E.season = (now) => E.EVENTS.find((e) => inSeason(e, now)) || null;
// The next event, if it starts within `days` days (for a "coming soon" in the shop).
E.soon = (now, days = 7) => {
  for (let i = 1; i <= days; i++) {
    const t = new Date(now); t.setDate(t.getDate() + i);
    const e = E.season(t.getTime());
    if (e && e !== E.season(now)) return { ...e, days: i };
  }
  return null;
};
E.limited = (id) => E.EVENTS.find((e) => e.items.includes(id)) || null;
E.forSale = (id, now) => { const e = E.limited(id); return !e || E.season(now) === e; };
const CAT_ID = /^[a-z]{2,12}$/;
E.MODES = ['timer', 'stopwatch'];
E.STOPWATCH_MAX = 180; // minutes; a stopwatch block ends by itself after three hours
E.STOPWATCH_MIN = 10;  // a stopwatch block needs this many minutes for its kitten to come home
E.PAUSE_MAX = 5;       // minutes a pause lasts at most, like Forest
E.config.CANCEL = 10000; // ms after Start in which Cancel takes a block back, no harm done (real time)
const NAP_ID = /^[a-z0-9]{6,20}$/;

E.empty = () => ({
  v: 1,
  blocks: [],
  later: [],
  brk: null, brkU: 0,
  settings: {
    interval: 15, style: 'ask', goal: 0, daily: { on: false, time: '09:00', days: [0, 1, 2, 3, 4, 5, 6] },
    tz: '', share: 'off', friendPings: true, name: '', cat: true, companion: 'miso', catsSeen: null,
    tags: E.TAGS.slice(), tag: '', mode: 'timer',
    pause: 'five', overtime: false, closeCounts: true, lines: [], theme: 'classic',
    rank: { on: false, name: '', global: false }, u: 0,
  },
  owned: [], // what you bought in the shop: { id, at, u }
  claimed: [], // rewards collected: achievements, monthly challenges, starter steps: { id, at, u }
  tally: {}, // small counters for things history doesn't keep (breaks, breathing, treats from cleared history)
  past: emptyPast(), // what the oldest blocks counted for, once they're folded out of the doc
  cleared: 0,
  u: 0,
});

// A doc from storage or the network: fill in anything missing, drop anything malformed. (E.merge
// leaves the size to the merged doc, so it's measured once.)
E.normalize = (d, sized = true) => {
  const doc = E.empty();
  if (!d || typeof d !== 'object') return doc;
  doc.blocks = Array.isArray(d.blocks) ? d.blocks.filter((b) => b && typeof b.id === 'string' && b.start && b.end) : [];
  for (const b of doc.blocks) {
    b.checkins = Array.isArray(b.checkins) ? b.checkins : [];
    b.plan = Array.isArray(b.plan) ? b.plan : [];
    b.parked = Array.isArray(b.parked) ? b.parked : [];
  }
  doc.later = Array.isArray(d.later) ? d.later.filter((x) => x && typeof x.id === 'string').slice(0, 200) : [];
  doc.brk = d.brk && d.brk.end ? d.brk : null;
  doc.brkU = d.brkU || 0;
  doc.settings = { ...doc.settings, ...(d.settings || {}) };
  doc.settings.daily = { ...E.empty().settings.daily, ...(doc.settings.daily || {}) };
  if (!Array.isArray(doc.settings.tags)) doc.settings.tags = E.TAGS.slice();
  doc.owned = Array.isArray(d.owned) ? d.owned.filter((x) => x && E.SHOP[x.id] && x.at) : [];
  doc.claimed = Array.isArray(d.claimed) ? d.claimed.filter((x) => x && typeof x.id === 'string' && x.at && rewardOf(x.id)) : [];
  if (!Array.isArray(doc.settings.lines)) doc.settings.lines = [];
  doc.settings.rank = { ...E.empty().settings.rank, ...(doc.settings.rank && typeof doc.settings.rank === 'object' ? doc.settings.rank : {}) };
  doc.cleared = d.cleared || 0;
  doc.tally = {};
  for (const [k, v] of Object.entries(d.tally && typeof d.tally === 'object' ? d.tally : {})) if (/^[a-z]{1,16}$/.test(k) && Number.isInteger(v) && v >= 0) doc.tally[k] = v;
  doc.past = pastOf([d.past], doc.cleared);
  doc.blocks = doc.blocks.filter((b) => b.start >= doc.past.to); // already in the past
  trim(doc, sized);
  doc.u = d.u || 0;
  return doc;
};

// ---------- reading the doc ----------
const isOpen = (b) => !b.ended;
// A block cancelled in its first seconds stays in the doc as a tombstone (so other devices learn
// about it), and counts for nothing.
const live = (doc) => doc.blocks.filter((b) => !b.cancelled);
E.running = (doc) => doc.blocks.find(isOpen) || null;
E.awaiting = (doc) => doc.blocks.find((b) => b.ended && !b.closed) || null;
const drifts = (b) => b.checkins.filter((c) => c.answer === 'drifted').length;
const activeMs = (b, at) => at - b.start - (b.pausedTotal || 0); // time on the block, pauses left out
const touch = (doc, b, now) => { if (b) b.u = now; doc.u = now; };

// Every block invites a kitten (b.cat). It grows while you focus and comes home to the café when the
// block reaches its end (b.home). Stop early, or leave Kavana in the middle, and it wanders off (b.gone).
// Blocks from before the café have no b.cat: the finished ones count as home, with Miso.
const kitten = (b) => (b.home ? 'home' : b.gone ? 'gone' : !b.cat ? (b.ended ? (b.stopped ? 'gone' : 'home') : 'growing') : b.ended ? 'gone' : 'growing');
E.kitten = kitten;
const treatsOf = (b) => (kitten(b) !== 'home' ? 0 : b.cat ? b.treats || 0 : Math.max(1, Math.round(activeMs(b, b.ended) / M())));
const minutesOn = (b, at) => Math.max(1, Math.round(activeMs(b, at) / M()));
// Napping together (b.nap, the group's id; b.napN, how many friends were in it): if every kitten came
// home, each brings 5 more treats per friend. If anyone left, every kitten wandered off (E.napGone).
E.NAP_BONUS = 5;
const napBonus = (b) => (b.nap && b.napN && kitten(b) === 'home' ? E.NAP_BONUS * b.napN : 0);
// The block stops before its end: the kitten that was still growing wanders off.
function stopped(b, at, why) {
  if (b.home) b.treats = minutesOn(b, at); // came home already, then kept going: the extra minutes count
  else if (!b.gone && b.cat) { b.gone = at; b.goneWhy = why; }
}
// ---------- missions ----------
// Small goals that pay bonus treats: three a day (a different three every day, one of each kind) and
// one a week (weeks start on Sunday, like the café). Only blocks whose kitten came home count, by the
// day they started. What they pay is worked out from the blocks, like the treats themselves, so every
// device agrees and nothing more has to sync. A day or week in which you cleared your history is
// closed: what it had paid is banked, and it can't pay again. So is one that doc.past reaches into.
const homeMin = (b) => (b.cat ? b.treats || 1 : Math.max(1, Math.round(activeMs(b, b.ended) / M()))); // minutes, also while a block that came home is extended
const hourOf = (t) => new Date(t).getHours();
const count = (f) => (bs) => bs.filter(f).length;
const MISSIONS = {
  two: { kind: 'a', text: 'Bring 2 kittens home', need: 2, pay: 10, have: (bs) => bs.length },
  three: { kind: 'a', text: 'Bring 3 kittens home', need: 3, pay: 15, have: (bs) => bs.length },
  hour: { kind: 'a', text: 'Focus for an hour', need: 60, pay: 15, unit: 'min', have: (bs) => bs.reduce((n, b) => n + homeMin(b), 0) },
  ninety: { kind: 'a', text: 'Focus for 90 minutes', need: 90, pay: 20, unit: 'min', have: (bs) => bs.reduce((n, b) => n + homeMin(b), 0) },
  long: { kind: 'b', text: 'Finish a 50-minute block', need: 1, pay: 15, have: count((b) => homeMin(b) >= 50) },
  early: { kind: 'b', text: 'Start a block before 9 am', need: 1, pay: 15, have: count((b) => hourOf(b.start) >= 4 && hourOf(b.start) < 9) },
  evening: { kind: 'b', text: 'Start a block after 6 pm', need: 1, pay: 10, have: count((b) => hourOf(b.start) >= 18) },
  done: { kind: 'b', text: 'Mark 2 blocks Done', need: 2, pay: 10, have: count((b) => b.outcome === 'done') },
  park: { kind: 'c', text: 'Park a thought in a block', need: 1, pay: 10, have: count((b) => b.parked.length > 0) },
  step: { kind: 'c', text: 'Start a block with a first step', need: 1, pay: 10, have: count((b) => Boolean(b.step)) },
  noon: { kind: 'c', text: 'Bring a kitten home before noon', need: 1, pay: 10, have: count((b) => hourOf(b.home || b.ended) < 12) },
  tags: { kind: 'c', text: 'Focus on 2 different tags', need: 2, pay: 10, have: (bs) => new Set(bs.map((b) => b.tag).filter(Boolean)).size },
  week5h: { kind: 'w', text: 'Focus for 5 hours this week', need: 300, pay: 50, unit: 'min', have: (bs) => bs.reduce((n, b) => n + homeMin(b), 0) },
  week4d: { kind: 'w', text: 'Bring kittens home on 4 days this week', need: 4, pay: 50, have: (bs) => new Set(bs.map((b) => dayOf(b.start))).size },
  week12: { kind: 'w', text: 'Bring 12 kittens home this week', need: 12, pay: 50, have: (bs) => bs.length },
};
E.MISSIONS = MISSIONS;
const dayOf = (t) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
const weekOf = (t) => { const d = new Date(dayOf(t)); d.setDate(d.getDate() - d.getDay()); return d.getTime(); };
const ymd = (t) => { const d = new Date(t); return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`; };
const hash = (str) => [...str].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0, 2166136261);
const ofKind = (k) => Object.keys(MISSIONS).filter((id) => MISSIONS[id].kind === k);
// Which missions a day (or week) has: the same for everyone, from the date alone.
function missionsFor(from, week) {
  const h = hash(`${week ? 'w' : 'd'}${ymd(from)}`);
  if (week) { const w = ofKind('w'); return [w[h % w.length]]; }
  return ['a', 'b', 'c'].map((k, i) => { const ids = ofKind(k); return ids[(h >>> (i * 5)) % ids.length]; });
}
const homeBlocks = (doc) => live(doc).filter((b) => kitten(b) === 'home');
const closedTo = (doc) => Math.max(doc.cleared, doc.past.to); // days and weeks that start before this are closed
function progress(ids, list) {
  return ids.map((id) => {
    const m = MISSIONS[id];
    const have = m.have(list);
    return { id, text: m.text, need: m.need, unit: m.unit || null, pay: m.pay, have: Math.min(have, m.need), done: have >= m.need };
  });
}
// What missions have paid (and how many were done), over all the blocks.
function missionPay(doc) { return missionTotals(doc).pay; }
function missionTotals(doc) {
  const days = new Map(), weeks = new Map();
  for (const b of homeBlocks(doc)) {
    for (const [map, from] of [[days, dayOf(b.start)], [weeks, weekOf(b.start)]]) {
      if (from < closedTo(doc)) continue; // closed by a clear or the past
      if (!map.has(from)) map.set(from, []);
      map.get(from).push(b);
    }
  }
  let pay = 0, done = 0;
  for (const [map, week] of [[days, false], [weeks, true]]) {
    for (const [from, list] of map) for (const p of progress(missionsFor(from, week), list)) if (p.done) { pay += p.pay; done += 1; }
  }
  return { pay, done };
}
// Today's and this week's missions, and how far along they are.
E.missions = (doc, now) => {
  const d = dayOf(now), w = weekOf(now);
  const home = homeBlocks(doc);
  const end = new Date(d); end.setDate(end.getDate() + 1);
  const wEnd = new Date(w); wEnd.setDate(wEnd.getDate() + 7);
  return {
    day: progress(missionsFor(d, false), home.filter((b) => dayOf(b.start) === d)),
    week: progress(missionsFor(w, true), home.filter((b) => weekOf(b.start) === w)),
    dayClosed: d < closedTo(doc), weekClosed: w < closedTo(doc),
    dayEnds: end.getTime(), weekEnds: wEnd.getTime(),
  };
};

// ---------- achievements, the monthly challenge and the starter challenge ----------
// Like Forest's. Progress is worked out from the doc; a reward is collected once (doc.claimed, synced
// like the shop) and stays, even after Clear My History.
E.ADOPT = ['luna', 'cocoa', 'olive', 'dumpling', 'maple', 'ziggy', 'pumpkin', 'flurry'];
const isCafeThing = (id) => !E.ADOPT.includes(id) && !E.SHELTER.includes(id) && !/^(theme|sound)-/.test(id);
// What a kitten that came home counts toward, besides itself and its minutes. doc.past keeps the
// same counts for the blocks folded into it.
const FEATS = {
  long: (b) => homeMin(b) >= 120,
  early: (b) => hourOf(b.start) >= 4 && hourOf(b.start) < 7,
  night: (b) => hourOf(b.start) >= 22 || hourOf(b.start) < 4,
  naps: (b) => Boolean(b.nap && b.napN),
  stopwatch: (b) => b.mode === 'stopwatch' && homeMin(b) >= 30,
};
function statsOf(doc) {
  const home = homeBlocks(doc);
  const past = E.pastDays(doc);
  const days = [...new Set([...past.filter((x) => x.home).map((x) => x.day), ...home.map((b) => dayOf(b.start))])].sort((a, b) => a - b);
  let best = 0, run = 0;
  days.forEach((t, i) => { run = i && Math.round((t - days[i - 1]) / 86400000) === 1 ? run + 1 : 1; best = Math.max(best, run); });
  const seen = doc.settings.catsSeen || [];
  const feat = (k) => doc.past[k] + home.filter(FEATS[k]).length;
  return {
    home: past.reduce((n, x) => n + x.home, home.length),
    minutes: past.reduce((n, x) => n + x.min, home.reduce((n, b) => n + homeMin(b), 0)),
    streak: best,
    long: feat('long'),
    early: feat('early'),
    night: feat('night'),
    naps: feat('naps'),
    stopwatch: feat('stopwatch'),
    tags: new Set([...doc.past.tags, ...home.map((b) => b.tag).filter(Boolean)]).size,
    missions: doc.past.missions + missionTotals(doc).done,
    met: seen.filter((id) => !E.SHOP[id]).length,
    adopted: doc.owned.filter((x) => E.ADOPT.includes(x.id)).length,
    things: doc.owned.filter((x) => isCafeThing(x.id)).length,
    shelter: doc.owned.filter((x) => E.SHELTER.includes(x.id)).length,
    friends: doc.tally.friends || 0,
    breaks: doc.tally.breaks || 0,
    breathes: doc.tally.breathes || 0,
    tagged: live(doc).some((b) => b.ended && b.tag) || past.some((x) => Object.keys(x.focus).some(Boolean)) ? 1 : 0,
  };
}
E.stats = statsOf;
// [id, name, what it takes, stat, goal, treats]
const ACH = [
  ['first', 'First Kitten', 'Bring a kitten home', 'home', 1, 10],
  ['sitter', 'Cat Sitter', 'Bring 10 kittens home', 'home', 10, 25],
  ['owner', 'Café Owner', 'Bring 50 kittens home', 'home', 50, 75],
  ['whisperer', 'Cat Whisperer', 'Bring 200 kittens home', 'home', 200, 200],
  ['hour', 'One Good Hour', 'Focus for 1 hour in all', 'minutes', 60, 10],
  ['ten', 'Ten Hours In', 'Focus for 10 hours in all', 'minutes', 600, 40],
  ['deep', 'Deep Worker', 'Focus for 50 hours in all', 'minutes', 3000, 120],
  ['week', 'A Whole Week', 'Focus for 7 days (168 hours) in all', 'minutes', 10080, 300],
  ['streak3', '3 Days in a Row', 'Bring kittens home 3 days in a row', 'streak', 3, 15],
  ['streak7', '7 Days in a Row', 'Bring kittens home 7 days in a row', 'streak', 7, 50],
  ['streak30', '30 Days in a Row', 'Bring kittens home 30 days in a row', 'streak', 30, 200],
  ['streak100', '100 Days in a Row', 'Bring kittens home 100 days in a row', 'streak', 100, 500],
  ['haul', 'The Long Haul', 'Bring a kitten home from a 2-hour block', 'long', 1, 40],
  ['open', 'Open-Ended', 'Bring a kitten home from a 30-minute stopwatch block', 'stopwatch', 1, 20],
  ['bird', 'Early Bird', 'Start 5 blocks before 7 am', 'early', 5, 30],
  ['owl', 'Night Owl', 'Start 5 blocks after 10 pm', 'night', 5, 30],
  ['nap', 'Napping Together', 'Nap with a friend once', 'naps', 1, 20],
  ['club', 'Nap Club', 'Nap with friends 10 times', 'naps', 10, 75],
  ['friend', 'A Friend', 'Add a friend', 'friends', 1, 10],
  ['crew', 'Cat Crew', 'Have 5 friends', 'friends', 5, 40],
  ['mission', 'On a Mission', 'Finish 10 missions', 'missions', 10, 30],
  ['missions', 'Mission Master', 'Finish 50 missions', 'missions', 50, 100],
  ['hats', 'Many Hats', 'Bring kittens home on 3 different tags', 'tags', 3, 15],
  ['all8', 'Met Them All', 'Meet all 8 cats', 'met', 8, 100],
  ['adopter', 'Adopter', 'Adopt 3 cats', 'adopted', 3, 60],
  ['designer', 'Interior Designer', 'Put 10 things in your café', 'things', 10, 60],
  ['kind', 'Kind Heart', 'Sponsor a shelter cat', 'shelter', 1, 50],
];
E.ACHIEVEMENTS = ACH.map(([id, name, text, stat, goal, reward]) => ({ id, name, text, stat, goal, reward }));
// [step, what to do, stat, goal]; 20 treats a step, and 100 more when they're all done.
const STARTER = [
  ['first', 'Bring your first kitten home', 'home', 1],
  ['tag', 'Tag a block', 'tagged', 1],
  ['break', 'Take a break after a block', 'breaks', 1],
  ['buy', 'Buy something for your café', 'things', 1],
  ['breathe', 'Breathe for a minute', 'breathes', 1],
  ['mission', 'Finish a mission', 'missions', 1],
  ['five', 'Bring 5 kittens home', 'home', 5],
];
E.STARTER_PAY = 20; E.STARTER_ALL = 100;
E.MONTH_NEED = 20; E.MONTH_PAY = 300; // the monthly challenge: kittens home on 20 days of the month
const monthId = (t) => { const d = new Date(t); return `month-${d.getFullYear()}-${d.getMonth() + 1}`; };
function rewardOf(id) {
  const a = E.ACHIEVEMENTS.find((x) => x.id === id);
  if (a) return a.reward;
  if (/^month-\d{4}-\d{1,2}$/.test(id)) return E.MONTH_PAY;
  if (id === 'starter-all') return E.STARTER_ALL;
  if (/^starter-/.test(id) && STARTER.some((x) => `starter-${x[0]}` === id)) return E.STARTER_PAY;
  return 0;
}
const claimed = (doc, id) => doc.claimed.some((x) => x.id === id);
E.achievements = (doc) => {
  const st = statsOf(doc);
  return E.ACHIEVEMENTS.map((a) => ({ ...a, have: Math.min(st[a.stat], a.goal), done: st[a.stat] >= a.goal, claimed: claimed(doc, a.id) }));
};
E.starter = (doc) => {
  const st = statsOf(doc);
  const steps = STARTER.map(([id, text, stat, goal]) => ({ id: `starter-${id}`, text, goal, have: Math.min(st[stat], goal), done: st[stat] >= goal, claimed: claimed(doc, `starter-${id}`), reward: E.STARTER_PAY }));
  const all = steps.every((x) => x.done);
  return { steps, all: { id: 'starter-all', done: all, claimed: claimed(doc, 'starter-all'), reward: E.STARTER_ALL }, finished: all && claimed(doc, 'starter-all') };
};
// This month's challenge (or the month `at` is in).
E.monthly = (doc, at) => {
  const d = new Date(at);
  const from = new Date(d.getFullYear(), d.getMonth(), 1).getTime();
  const to = new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime();
  const past = E.pastDays(doc, from, to).filter((x) => x.home).map((x) => x.day);
  const days = new Set([...past, ...homeBlocks(doc).filter((b) => b.start >= from && b.start < to).map((b) => dayOf(b.start))]).size;
  const id = monthId(at);
  return { id, from, to, need: E.MONTH_NEED, have: Math.min(days, E.MONTH_NEED), done: days >= E.MONTH_NEED, claimed: claimed(doc, id), reward: E.MONTH_PAY };
};
// Collect a reward that's done and not collected yet.
E.claim = (doc, id, now) => {
  if (claimed(doc, id) || !rewardOf(id)) bad('claim');
  const a = E.achievements(doc).find((x) => x.id === id);
  const st = E.starter(doc);
  const step = st.steps.find((x) => x.id === id);
  const m = /^month-(\d{4})-(\d{1,2})$/.exec(id);
  const ok = a ? a.done : step ? step.done : id === 'starter-all' ? st.all.done : m ? E.monthly(doc, new Date(Number(m[1]), Number(m[2]) - 1, 15).getTime()).done : false;
  if (!ok) bad('claim');
  doc.claimed.push({ id, at: now, u: now });
  doc.u = now;
  return rewardOf(id);
};
// Counters the page learns about (how many friends you have): they only go up.
E.setTally = (doc, key, n, now) => {
  if (!/^[a-z]{1,16}$/.test(key) || !Number.isInteger(n) || n < 0) return;
  if ((doc.tally[key] || 0) >= n) return;
  doc.tally[key] = n; doc.u = now;
};

// Treats: earned (by minutes, napping together, missions and rewards), spent, and what's left to spend.
const blockPay = (doc) => live(doc).reduce((n, b) => n + treatsOf(b) + napBonus(b), 0);
const earnedOf = (doc) => blockPay(doc) + missionPay(doc);
const claimPay = (doc) => doc.claimed.reduce((n, x) => n + rewardOf(x.id), 0);
E.treats = (doc) => {
  const missions = missionPay(doc);
  const rewards = claimPay(doc);
  const earned = (doc.tally.banked || 0) + blockPay(doc) + missions + rewards;
  const spent = doc.owned.reduce((n, x) => n + (E.SHOP[x.id] || 0), 0);
  return { earned, spent, left: Math.max(0, earned - spent), missions, rewards };
};
E.owns = (doc, id) => doc.owned.some((x) => x.id === id);

// `own` is your own lines (settings.lines). They used to be copied into every block (b.own), which made
// a block up to ten times bigger; now they're read when the pings are planned.
function lineFor(b, n, own) {
  const seed = [...b.id].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
  if (own && own.length && (seed + n) % 2 === 0) return own[(seed + n) % own.length]; // your own lines, every other nudge
  return LINES[(seed + n * 5) % LINES.length];
}

// The pings a block will get from `from` to its end. Ask: every interval. Nudge: every 60-140%
// of the interval, so it doesn't feel like a metronome. None in the last minute (the end ping covers it).
function planFrom(b, from, own) {
  const plan = [];
  if (!b.interval) return plan;
  let n = b.checkins.length ? b.checkins[b.checkins.length - 1].n : 0;
  let t = from;
  for (;;) {
    t += b.interval * M() * (b.style === 'nudge' ? 0.6 + 0.8 * Math.random() : 1);
    if (b.end - t < M()) break;
    n += 1;
    plan.push(b.style === 'nudge' ? { n, at: Math.round(t), kind: 'nudge', line: lineFor(b, n, own) } : { n, at: Math.round(t), kind: 'checkin' });
  }
  return plan;
}

// Move time forward: check-ins whose time came, blocks that ended, a pause nobody came back to.
// Returns true when the doc changed (so the caller saves it).
E.tick = (doc, now) => {
  let changed = false;
  for (const b of doc.blocks) {
    if (b.ended) {
      // Nobody answered "How did it go?" within 12 hours: file it without an outcome.
      if (!b.closed && now - b.ended > 12 * 60 * M()) { b.closed = true; touch(doc, b, now); changed = true; }
      continue;
    }
    if (b.paused) {
      // A pause lasts 5 minutes at most, like Forest's; then the block goes on by itself.
      if (now - b.paused < E.PAUSE_MAX * M()) continue;
      resumeAt(b, b.paused + E.PAUSE_MAX * M());
      touch(doc, b, now); changed = true;
    }
    while (b.plan.length && b.plan[0].at <= now) {
      const p = b.plan.shift();
      b.checkins.push({ n: p.n, at: p.at, kind: p.kind, line: p.line, answer: null });
      touch(doc, b, now); changed = true;
    }
    if (now >= b.end) {
      if (b.overtime && !b.over) {
        // "Count extra time": the kitten comes home at the end, and the block keeps counting until
        // you stop it (two hours more at most).
        b.over = b.end; b.plan = [];
        if (b.cat && !b.gone) { b.home = b.home || b.end; b.treats = minutesOn(b, b.end); }
        b.end = b.over + 120 * M();
      } else if (b.mode === 'stopwatch') finish(b, b.end);
      else {
        b.ended = b.end; b.plan = [];
        if (b.cat && !b.gone) { b.home = b.home || b.end; b.treats = minutesOn(b, b.end); } // the kitten comes home
      }
      touch(doc, b, now); changed = true;
    }
  }
  if (doc.brk && now >= doc.brk.end) { doc.brk = null; doc.brkU = now; doc.u = now; changed = true; }
  return changed;
};

function blockView(b) {
  const last = b.checkins[b.checkins.length - 1];
  const nudge = b.style === 'nudge';
  return {
    id: b.id, intention: b.intention, minutes: b.minutes, interval: b.interval, start: b.start, end: b.end,
    ended: b.ended || null, stopped: Boolean(b.stopped), drifts: drifts(b),
    pending: !nudge && last && last.answer == null ? last.n : null,
    next: !b.ended && b.plan.length ? b.plan[0].at : null,
    style: b.style || 'ask', line: nudge && last ? last.line : null,
    step: b.step || null, paused: b.paused || null, total: b.end - b.start - (b.pausedTotal || 0),
    parked: b.parked.map((x) => x.text), with: b.with || null,
    cat: b.cat || 'miso', tag: b.tag || null, kitten: kitten(b), goneWhy: b.goneWhy || null, goneBy: b.goneBy || null, treats: treatsOf(b),
    nap: b.nap || null, napN: b.napN || 0, bonus: napBonus(b),
    mode: b.mode || 'timer', over: b.over || null, cancelUntil: b.start + E.config.CANCEL, note: b.note || '',
    pauseEnds: b.paused ? b.paused + E.PAUSE_MAX * M() : null, pauses: b.pauses || 0,
  };
}

// The same shape the screens have always drawn from.
E.view = (doc, now) => {
  const run = E.running(doc);
  const wait = E.awaiting(doc);
  const last = doc.blocks.filter((b) => b.ended && b.closed).sort((a, b) => b.ended - a.ended)[0];
  const offer = !run && !wait && !doc.brk && last && now - last.ended < 10 * M() && activeMs(last, last.ended) >= 10 * M()
    ? { id: last.id, minutes: activeMs(last, last.ended) > 40 * M() ? 10 : 5 } : null;
  const seen = new Set();
  const recent = [];
  for (const b of [...doc.blocks].sort((a, b) => b.start - a.start)) {
    if (!b.intention || seen.has(b.intention.toLowerCase())) continue; // a block without a title isn't one to repeat
    seen.add(b.intention.toLowerCase());
    recent.push(b.intention);
    if (recent.length === 4) break;
  }
  return {
    now,
    settings: doc.settings,
    active: run ? blockView(run) : null,
    awaiting: !run && wait ? blockView(wait) : null,
    onBreak: !run && doc.brk ? { ...doc.brk } : null,
    breakOffer: offer,
    recent,
    later: doc.later.filter((x) => !x.del).map(({ id, text }) => ({ id, text })),
  };
};

E.history = (doc) => live(doc).filter((b) => b.ended).sort((a, b) => b.start - a.start).map((b) => ({
  id: b.id, start: b.start, intention: b.intention, minutes: b.minutes,
  actual: actualMin(b), stopped: Boolean(b.stopped),
  outcome: b.outcome || null, drifts: drifts(b), checkins: b.checkins.length, style: b.style || 'ask',
  answered: b.checkins.filter((c) => c.answer).length,
  whys: b.checkins.filter((c) => c.answer === 'drifted' && c.why).map((c) => c.why),
  parked: b.parked.map((x) => x.text),
  cat: b.cat || 'miso', tag: b.tag || null, kitten: kitten(b), goneWhy: b.goneWhy || null, goneBy: b.goneBy || null,
  treats: treatsOf(b) + napBonus(b), nap: b.nap || null, napN: b.napN || 0,
  mode: b.mode || 'timer', note: b.note || '',
}));

// ---------- changing the doc (each takes `now`, throws on bad input) ----------
const bad = (what) => { throw Object.assign(new Error(what), { bad: true }); };

function closeAll(doc, now) {
  doc.brk = null; doc.brkU = now;
  for (const b of doc.blocks) {
    if (!b.ended) { stopped(b, b.paused || now, 'stop'); b.ended = b.paused || now; b.paused = null; b.stopped = true; b.plan = []; touch(doc, b, now); }
    if (!b.closed) { b.closed = true; touch(doc, b, now); }
  }
}

E.start = (doc, o, now) => {
  const intention = clean(o.intention, 140); // optional, like Forest's session title
  const joining = o.withEnd && o.withEnd > now + M();
  const mode = !joining && o.mode === 'stopwatch' ? 'stopwatch' : 'timer';
  let minutes = mode === 'stopwatch' ? E.STOPWATCH_MAX : Math.round(Number(o.minutes));
  // Joining a friend: end at the same moment they do.
  const end = joining ? o.withEnd : now + minutes * M();
  minutes = Math.max(1, Math.round((end - now) / M()));
  if (!(minutes >= 1 && minutes <= 240)) bad('minutes');
  const style = E.STYLES.includes(o.style) ? o.style : doc.settings.style;
  // the kitten invited to grow during the block (none with cat mode off)
  const cat = o.cat === null ? undefined : CAT_ID.test(o.cat || '') ? o.cat : doc.settings.companion || 'miso';
  const tag = clean(o.tag, 20);
  const nap = cat && NAP_ID.test(o.nap || '') ? o.nap : undefined; // napping together (joining a friend)
  closeAll(doc, now);
  const b = {
    id: uid(), intention, step: clean(o.step, 140) || undefined, minutes, style,
    interval: doc.settings.interval, start: now, end, checkins: [], plan: [], parked: [], pausedTotal: 0,
    with: clean(o.withName, 40) || undefined, cat, tag: tag || undefined, nap, u: now,
  };
  if (mode === 'stopwatch') b.mode = mode;
  if (mode === 'timer' && doc.settings.overtime && !nap) b.overtime = true;
  b.plan = planFrom(b, now, doc.settings.lines);
  // Cancelled blocks are kept a month, so other devices hear about them, then dropped.
  doc.blocks = doc.blocks.filter((x) => !x.cancelled || now - x.cancelled < 30 * 86400000);
  doc.blocks.push(b);
  trim(doc);
  doc.settings = { ...doc.settings, style, companion: cat || doc.settings.companion, tag, mode: joining ? doc.settings.mode : mode, u: now }; // what you used last is the default next time
  if (o.fromLater) E.doneLater(doc, o.fromLater, now);
  doc.u = now;
  return b;
};

E.stop = (doc, now) => {
  const b = E.running(doc);
  if (!b) return;
  const at = b.paused || now;
  if (b.mode === 'stopwatch') finish(b, at); // a stopwatch block ends when you stop it
  else if (b.over) { stopped(b, at, 'stop'); b.ended = at; b.paused = null; b.plan = []; } // extra time: done when you say so
  else { stopped(b, at, 'stop'); b.ended = at; b.paused = null; b.stopped = true; b.plan = []; }
  touch(doc, b, now);
};

// A stopwatch block ends: the kitten comes home if it lasted 10 minutes or more.
function finish(b, at) {
  const enough = activeMs(b, at) >= E.STOPWATCH_MIN * M();
  if (b.cat && !b.gone) {
    if (enough) { b.home = b.home || at; b.treats = minutesOn(b, at); } else { b.gone = at; b.goneWhy = 'short'; }
  }
  b.minutes = minutesOn(b, at);
  b.ended = at; b.paused = null; b.plan = [];
  b.stopped = !enough;
}

// Changed your mind in the first 10 seconds: the block is taken back, nothing counts.
E.cancel = (doc, now) => {
  const b = E.running(doc);
  if (!b || b.nap || now - b.start > E.config.CANCEL) bad('cancel');
  b.cancelled = now; b.ended = now; b.closed = true; b.paused = null; b.plan = [];
  touch(doc, b, now);
  return b;
};

// Change a block afterwards (or while it runs): what it was, its tag, a note.
E.edit = (doc, id, patch, now) => {
  const b = doc.blocks.find((x) => x.id === id && !x.cancelled);
  if (!b) bad('edit');
  if ('intention' in patch) b.intention = clean(patch.intention, 140);
  if ('tag' in patch) b.tag = clean(patch.tag, 20) || undefined;
  if ('note' in patch) b.note = String(patch.note || '').replace(/\r/g, '').trim().slice(0, 500) || undefined;
  touch(doc, b, now);
};

// You left Kavana in the middle of a block (the page knows from its visibility): the kitten wanders
// off at `at`. The block itself goes on. The page may only find out later, after the block has ended
// (and the kitten came home): then it's undone.
// With `grace`, `at` is when you left, and the kitten waits that long before it goes. Leaving during a
// pause counts from when the pause ended.
E.away = (doc, at, now, grace = 0) => {
  let b = null;
  for (let i = doc.blocks.length - 1; i >= 0 && !b; i--) { const x = doc.blocks[i]; if (!x.cancelled && x.start <= at && (!x.ended || x.ended > at)) b = x; }
  if (!b) return null;
  let when = at;
  if (b.lastPause && b.lastPause <= at && b.lastResume && at < b.lastResume) when = b.lastResume;
  when += grace;
  if (when > now || (b.ended && b.ended <= when)) return null;
  if (!b.cat || b.gone || (b.home && b.home <= when) || (b.paused && b.paused <= when)) return null;
  delete b.home; b.treats = 0;
  b.gone = when; b.goneWhy = 'away';
  touch(doc, b, now);
  return b;
};

// Napping together. The server keeps the group; the page tells the engine what it learns.
// The block is in a group with n friends (the one who started it learns this after someone joins):
E.napWith = (doc, blockId, napId, n, now) => {
  const b = doc.blocks.find((x) => x.id === blockId);
  if (!b || !b.cat || !NAP_ID.test(napId || '')) return null;
  const napN = Math.max(b.napN || 0, Math.min(20, Math.round(Number(n) || 0)));
  if (b.nap === napId && (b.napN || 0) === napN) return null;
  b.nap = napId; b.napN = napN;
  touch(doc, b, now);
  return b;
};
// Someone in the group left or stopped at `at`: this kitten wanders off too, unless it was home already.
E.napGone = (doc, napId, at, who, now) => {
  const b = doc.blocks.find((x) => x.nap === napId || x.id === napId);
  if (!b || !b.cat || b.gone || (b.home && b.home <= at) || at < b.start) return null;
  delete b.home; b.treats = 0;
  b.gone = at; b.goneWhy = 'nap'; b.goneBy = clean(who, 40) || undefined;
  touch(doc, b, now);
  return b;
};

E.buy = (doc, id, now) => {
  if (!E.SHOP[id]) bad('item');
  if (!E.forSale(id, now)) bad('season');
  if (E.owns(doc, id)) bad('owned');
  if (E.treats(doc).left < E.SHOP[id]) bad('treats');
  doc.owned.push({ id, at: now, u: now });
  doc.u = now;
};

// Treats from blocks that leave the doc (and the missions they did) stay yours: `before` is what
// the blocks had earned before they left.
function bank(doc, before) {
  const n = before - earnedOf(doc);
  if (n > 0) doc.tally.banked = (doc.tally.banked || 0) + n;
}

// ---------- the past ----------
// A doc keeps its last E.config.KEEP blocks (2000, a year and more), and only as many of them as fit
// in E.config.BYTES of JSON (800 KB, about 1600 everyday blocks), so it can always sync: the server
// takes 1 MB, and the rest is room for what changes before the next fold. Older ones are folded into
// doc.past, so nothing they counted for is lost: their treats and the missions they did are banked,
// each day keeps what the café shows (the minutes, by tag; which cats came home and the minutes they
// brought; how many wandered off), and the achievements keep their counts.
// doc.past.to is the high-water mark: every block that started before it is in the past and nowhere
// else, and the days and weeks it reaches into are closed for missions. The fold always takes the
// oldest blocks first, so two devices that fold at different times agree on everything before the
// mark, and the one that went further holds all the other has. That's what lets E.merge keep the
// further mark, drop the blocks before it, and take the larger number everywhere, and why
// tally.banked (merged by the larger number too) can't count a block twice.
const PAST_N = [...Object.keys(FEATS), 'missions'];
function emptyPast() { return { to: 0, days: {}, long: 0, early: 0, night: 0, naps: 0, stopwatch: 0, missions: 0, tags: [] }; }
const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;
const two = (n) => String(n).padStart(2, '0');
const dayKey = (t) => { const d = new Date(t); return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`; };
const keyDay = (k, add = 0) => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d + add).getTime(); };
const actualMin = (b) => Math.max(1, Math.round(activeMs(b, b.ended) / M()));
const num = (v) => (Number.isInteger(v) && v > 0 ? v : 0);
const sorted = (o) => Object.fromEntries(Object.entries(o).sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0)));
// One past out of any number of copies (or junk): the furthest mark, and per day and per count the
// larger number, written out the same way every time so equal pasts are equal JSON. A copy whose mark
// is before a Clear My History is all from before it, and the clear emptied the café, so only its mark
// counts; days that ended before the clear are dropped too.
function pastOf(copies, cleared) {
  const out = emptyPast();
  const days = new Map(), tags = new Set();
  for (const p of copies) {
    if (!p || typeof p !== 'object' || !(Number.isFinite(p.to) && p.to > 0)) continue;
    out.to = Math.max(out.to, p.to);
    if (p.to <= cleared) continue;
    for (const k of PAST_N) out[k] = Math.max(out[k], num(p[k]));
    for (const x of Array.isArray(p.tags) ? p.tags : []) if (typeof x === 'string' && clean(x, 20)) tags.add(clean(x, 20));
    for (const [k, x] of Object.entries(p.days && typeof p.days === 'object' ? p.days : {})) {
      if (!DAY_KEY.test(k) || !x || typeof x !== 'object' || keyDay(k, 1) <= cleared) continue;
      const day = days.get(k) || { min: 0, focus: {}, cats: {}, gone: 0 };
      day.min = Math.max(day.min, num(x.min));
      day.gone = Math.max(day.gone, num(x.gone));
      for (const [id, v] of Object.entries(x.focus && typeof x.focus === 'object' ? x.focus : {})) if (clean(id, 20) === id && num(v)) day.focus[id] = Math.max(day.focus[id] || 0, v);
      for (const [id, v] of Object.entries(x.cats && typeof x.cats === 'object' ? x.cats : {})) if (CAT_ID.test(id) && num(v)) day.cats[id] = Math.max(day.cats[id] || 0, v);
      days.set(k, day);
    }
  }
  for (const k of [...days.keys()].sort()) {
    const x = days.get(k), day = {};
    if (x.min) day.min = x.min;
    if (Object.keys(x.focus).length) day.focus = sorted(x.focus);
    if (Object.keys(x.cats).length) day.cats = sorted(x.cats);
    if (x.gone) day.gone = x.gone;
    if (Object.keys(day).length) out.days[k] = day;
  }
  out.tags = [...tags].sort().slice(0, 50);
  return out;
}
// One finished block into the past.
function fold(past, b) {
  const k = dayKey(b.start);
  const day = past.days[k] || (past.days[k] = {});
  const tag = b.tag || '';
  day.focus = { ...day.focus, [tag]: ((day.focus || {})[tag] || 0) + actualMin(b) }; // '' is no tag
  if (kitten(b) === 'home') {
    const cat = b.cat || 'miso';
    day.min = (day.min || 0) + homeMin(b);
    day.cats = { ...day.cats, [cat]: ((day.cats || {})[cat] || 0) + 1 };
    for (const f of Object.keys(FEATS)) if (FEATS[f](b)) past[f] += 1;
    if (b.tag && !past.tags.includes(b.tag)) past.tags.push(b.tag);
  } else day.gone = (day.gone || 0) + 1;
}
// How big a doc (or anything) is as JSON, in UTF-8 bytes, which is what the server reads. Counted by
// hand: Android's JavaScript sandbox has no TextEncoder.
E.size = (x) => {
  const s = JSON.stringify(x);
  let n = s.length;
  for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); if (c > 0x7f) n += c > 0x7ff && (c < 0xd800 || c > 0xdfff) ? 2 : 1; } // a surrogate pair is 2 + 2
  return n;
};
// What a block no longer needs: its own copy of your lines (blocks from before they were read from the
// settings), and once it's filed, the words its nudges said (they're only shown while it runs).
function settle(b) {
  if ('own' in b) delete b.own;
  if (b.closed) for (const c of b.checkins) if ('line' in c) delete c.line;
}
// Too many blocks, or too big a doc: fold the oldest into the past, never one that's still running or
// waiting for "How did it go?". Every device does the same, from the doc alone (E.normalize, E.start,
// E.merge). By size it folds the oldest blocks that add up to what's over, then measures again, since
// the past grows a little with each day it takes in.
function trim(doc, sized = true) {
  for (const b of doc.blocks) settle(b);
  if (doc.blocks.length > E.config.KEEP) foldBefore(doc, doc.blocks.map((b) => b.start).sort((x, y) => x - y)[doc.blocks.length - E.config.KEEP]);
  if (!sized || E.config.BYTES === Infinity) return; // (no limit: only in the tests)
  for (let size = E.size(doc); size > E.config.BYTES; size = E.size(doc)) {
    const old = doc.blocks.slice().sort((x, y) => x.start - y.start);
    if (!old.length) return;
    let i = 0, over = size - E.config.BYTES;
    for (; i < old.length && over > 0; i++) over -= E.size(old[i]) + 1;
    if (over > 0) return; // it's not the blocks (even without them it wouldn't fit), so folding them won't help
    while (i < old.length && old[i].start === old[i - 1].start) i++; // the mark is a start, so blocks that started together go together
    if (!foldBefore(doc, i < old.length ? old[i].start : old[old.length - 1].start + 1)) return; // only open blocks left
  }
}
function foldBefore(doc, to) {
  for (const b of doc.blocks) if (!b.closed) to = Math.min(to, b.start);
  const old = doc.blocks.filter((b) => b.start < to);
  if (!old.length) return false;
  const before = earnedOf(doc), done = missionTotals(doc).done;
  doc.past.to = to;
  doc.blocks = doc.blocks.filter((b) => b.start >= to);
  bank(doc, before); // their treats, and what the missions of the days and weeks this closes paid
  doc.past.missions += done - missionTotals(doc).done;
  for (const b of old) if (!b.cancelled) fold(doc.past, b);
  doc.past = pastOf([doc.past], doc.cleared);
  return true;
}
// The days in the past from `from` to `to`, oldest first, for the café's views: `min` is the minutes
// of kittens that came home, `focus` all the minutes by tag ('' is no tag), `cats` who came home and
// how often, `home` how many in all, and `gone` how many wandered off.
E.pastDays = (doc, from = -Infinity, to = Infinity) => Object.entries(doc.past.days).map(([k, x]) => ({
  day: keyDay(k), min: x.min || 0, focus: { ...x.focus }, cats: { ...x.cats },
  home: Object.values(x.cats || {}).reduce((n, v) => n + v, 0), gone: x.gone || 0,
})).filter((x) => x.day >= from && x.day < to);

// Pausing, unless it's turned off in Settings (and never while napping together). A pause lasts
// 5 minutes at most (E.tick ends it).
E.canPause = (doc) => doc.settings.pause !== 'off';
E.pause = (doc, now) => {
  const b = E.running(doc);
  if (!b || b.paused || b.nap || !E.canPause(doc)) return;
  b.paused = now; b.lastPause = now; b.pauses = (b.pauses || 0) + 1;
  touch(doc, b, now);
};

function resumeAt(b, at) {
  const d = at - b.paused; // the end and every ping move back by the pause
  b.end += d;
  for (const p of b.plan) p.at += d;
  b.pausedTotal = (b.pausedTotal || 0) + d;
  b.paused = null; b.lastResume = at;
}
E.resume = (doc, now) => {
  const b = E.running(doc);
  if (!b || !b.paused) return;
  resumeAt(b, Math.min(now, b.paused + E.PAUSE_MAX * M()));
  touch(doc, b, now);
};

E.extend = (doc, id, more, now) => {
  const b = E.awaiting(doc);
  if (!b || b.id !== id || !E.MORE.includes(Number(more)) || E.running(doc)) bad('extend');
  b.pausedTotal = (b.pausedTotal || 0) + (now - b.ended); // the time on the end screen doesn't count
  b.end = now + Number(more) * M();
  b.minutes += Number(more);
  b.ended = null;
  b.stopped = false;
  b.plan = planFrom(b, now, doc.settings.lines);
  touch(doc, b, now);
};

E.answer = (doc, id, n, answer, why, now) => {
  const b = doc.blocks.find((x) => x.id === id);
  if (!b || !['yes', 'drifted'].includes(answer)) bad('answer');
  const c = b.checkins.find((x) => x.n === Number(n)) || b.checkins[b.checkins.length - 1];
  if (!c) bad('answer');
  c.answer = answer;
  if (answer === 'drifted' && E.REASONS.includes(why)) c.why = why;
  touch(doc, b, now);
  return drifts(b);
};

E.outcome = (doc, id, outcome, now) => {
  const b = doc.blocks.find((x) => x.id === id && x.ended);
  if (!b) bad('outcome');
  b.outcome = E.OUTCOMES.includes(outcome) ? outcome : null;
  b.closed = true;
  touch(doc, b, now);
};

E.park = (doc, text, now) => {
  const t = clean(text, 200);
  const b = E.running(doc) || E.awaiting(doc);
  if (!b || !t) bad('park');
  b.parked = b.parked.concat({ at: now, text: t }).slice(-30);
  touch(doc, b, now);
  E.addLater(doc, t, now); // parked thoughts land on the Later list too
};

E.addLater = (doc, text, now) => {
  const t = clean(text, 200);
  if (!t) bad('text');
  if (doc.later.some((x) => !x.del && x.text.toLowerCase() === t.toLowerCase())) return;
  doc.later.unshift({ id: uid(), text: t, at: now, u: now });
  // Crossed-off items stay as tombstones for a month so other devices learn about them.
  doc.later = doc.later.filter((x) => !x.del || now - x.u < 30 * 86400000).slice(0, 200);
  doc.u = now;
};

E.doneLater = (doc, id, now) => {
  const x = doc.later.find((y) => y.id === id);
  if (x) { x.del = true; x.text = ''; x.u = now; doc.u = now; }
};

E.startBreak = (doc, minutes, now) => {
  if (!E.BREAKS.includes(Number(minutes)) || E.running(doc)) bad('break');
  doc.brk = { minutes: Number(minutes), start: now, end: now + Number(minutes) * M() };
  doc.brkU = now; doc.u = now;
  E.count(doc, 'breaks', now);
};

E.count = (doc, key, now) => { if (/^[a-z]{1,16}$/.test(key)) { doc.tally[key] = (doc.tally[key] || 0) + 1; doc.u = now; } };

E.stopBreak = (doc, now) => { doc.brk = null; doc.brkU = now; doc.u = now; };

E.clearHistory = (doc, now) => {
  const before = earnedOf(doc);
  doc.cleared = now;
  doc.blocks = doc.blocks.filter((b) => !b.ended);
  doc.past = { ...emptyPast(), to: doc.past.to }; // the past empties too; its treats are banked already
  bank(doc, before);
  doc.u = now;
};

E.setSettings = (doc, patch, now) => {
  const s = { ...doc.settings };
  if ('interval' in patch) {
    if (!E.INTERVALS.includes(Number(patch.interval))) bad('interval');
    s.interval = Number(patch.interval);
    const b = E.running(doc);
    if (b && !b.paused) { // applies to the block that's running too, counted from its last check-in
      const last = b.checkins.length ? b.checkins[b.checkins.length - 1].at : b.start;
      b.interval = s.interval;
      b.plan = planFrom(b, Math.max(last, now - b.interval * M() + M()), s.lines);
      touch(doc, b, now);
    }
  }
  if ('goal' in patch) {
    if (!E.GOALS.includes(Number(patch.goal))) bad('goal');
    s.goal = Number(patch.goal);
  }
  if ('daily' in patch) {
    const d = patch.daily || {};
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(String(d.time))) bad('time');
    const days = [...new Set((Array.isArray(d.days) ? d.days : []).map(Number))].filter((x) => x >= 0 && x <= 6).sort();
    s.daily = { on: Boolean(d.on), time: d.time, days };
  }
  if ('tz' in patch) s.tz = clean(patch.tz, 64);
  if ('share' in patch) {
    if (!E.SHARE.includes(patch.share)) bad('share');
    s.share = patch.share;
  }
  if ('friendPings' in patch) s.friendPings = Boolean(patch.friendPings);
  if ('name' in patch) s.name = clean(patch.name, 30);
  if ('cat' in patch) s.cat = Boolean(patch.cat);
  if ('companion' in patch && CAT_ID.test(patch.companion)) s.companion = patch.companion;
  if ('catsSeen' in patch && Array.isArray(patch.catsSeen)) s.catsSeen = [...new Set(patch.catsSeen.filter((x) => CAT_ID.test(x)))].slice(0, 30);
  if ('tags' in patch) {
    if (!Array.isArray(patch.tags)) bad('tags');
    const seen = new Set();
    s.tags = patch.tags.map((t) => clean(t, 20)).filter((t) => t && !seen.has(t.toLowerCase()) && seen.add(t.toLowerCase())).slice(0, 12);
    if (s.tag && !s.tags.includes(s.tag)) s.tag = '';
  }
  if ('tag' in patch) s.tag = clean(patch.tag, 20);
  if ('mode' in patch) { if (!E.MODES.includes(patch.mode)) bad('mode'); s.mode = patch.mode; }
  if ('pause' in patch) { if (!['five', 'off'].includes(patch.pause)) bad('pause'); s.pause = patch.pause; }
  if ('overtime' in patch) s.overtime = Boolean(patch.overtime);
  if ('closeCounts' in patch) s.closeCounts = Boolean(patch.closeCounts);
  if ('lines' in patch) {
    if (!Array.isArray(patch.lines)) bad('lines');
    s.lines = [...new Set(patch.lines.map((t) => clean(t, 120)).filter(Boolean))].slice(0, 20);
  }
  if ('theme' in patch) {
    if (patch.theme !== 'classic' && !(E.SHOP[`theme-${patch.theme}`] && E.owns(doc, `theme-${patch.theme}`))) bad('theme');
    s.theme = patch.theme;
  }
  if ('rank' in patch) {
    const r = patch.rank || {};
    const name = clean(r.name, 20).replace(/[^\p{L}\p{N} ._'-]/gu, '');
    if (r.global && !name) bad('rank');
    s.rank = { on: Boolean(r.on), name, global: Boolean(r.on && r.global) };
  }
  s.u = now;
  doc.settings = s;
  doc.u = now;
};

// ---------- what the server should send, and when ----------
// Cat mode (on unless turned off) gives the pings a cat and a "Boo!".
// A block's title at the start of a notification's line, if it has one (the title is optional).
const said = (b) => (b.intention ? `${b.intention}. ` : '');
E.pings = (doc, now) => {
  const out = [];
  const cat = doc.settings.cat !== false;
  const b = E.running(doc);
  if (b && !b.paused) {
    for (const p of b.plan) {
      if (p.at <= now) continue;
      out.push(p.kind === 'nudge'
        ? { at: p.at, kind: 'nudge', tag: `kavana-${b.id}`, title: `${cat ? '🐱 ' : ''}${b.intention || 'Keep going'}`, body: p.line, block: b.id, n: p.n }
        : {
          at: p.at, kind: 'checkin', tag: `kavana-${b.id}`, block: b.id, n: p.n,
          title: `${cat ? '🐱 Boo! ' : ''}${b.intention ? `Still on: ${b.intention}?` : 'Still focusing?'}`, body: `${Math.max(1, Math.round((b.end - p.at) / M()))} min left. Tap to answer.`,
          actions: [{ action: 'yes', title: 'Yes' }, { action: 'drifted', title: 'Drifted' }],
        });
    }
    const name = cat && b.cat ? b.cat.charAt(0).toUpperCase() + b.cat.slice(1) : 'Your kitten';
    const home = cat && !b.gone; // a kitten that already wandered off doesn't come home at the end
    if (b.overtime && !b.over) {
      out.push({ at: b.end, kind: 'end', tag: `kavana-${b.id}`, block: b.id, title: home ? `🐱 Time's up, and ${name} came home` : cat ? "🐱 Time's up" : "Time's up", body: `${said(b)}Kavana keeps counting until you stop.` });
    } else if (b.mode === 'stopwatch') {
      out.push({ at: b.end, kind: 'end', tag: `kavana-${b.id}`, block: b.id, title: home ? `🐱 Three hours! ${name} came home` : cat ? '🐱 Three hours. How did it go?' : 'Three hours. How did it go?', body: `${said(b)}Tap to log it.` });
    } else out.push({ at: b.end, kind: 'end', tag: `kavana-${b.id}`, block: b.id, title: cat ? "🐱 Boo! Time's up. How did it go?" : 'How did it go?', body: `${said(b)}Tap to log it.` });
  }
  if (doc.brk && doc.brk.end > now) {
    out.push({ at: doc.brk.end, kind: 'break-over', tag: 'kavana-break', title: cat ? "🐱 Boo! Break's over" : "Break's over", body: "It's time to focus. Ready for the next block?" });
  }
  for (const x of out) if (cat) x.cat = 1;
  return out;
};

// The daily "Time to focus?" ping, as the server needs it.
E.daily = (doc) => {
  const d = doc.settings.daily;
  const next = doc.later.find((x) => !x.del);
  return {
    on: Boolean(d.on), time: d.time, days: d.days, tz: doc.settings.tz,
    body: next ? `Up next: ${next.text}` : 'Pick one thing and start a block.',
    cat: doc.settings.cat !== false,
  };
};

// What a friend may see (nothing unless they share), worked out from their doc.
E.presence = (doc, now) => {
  const share = doc.settings.share;
  if (share === 'off') return null;
  const b = E.running(doc);
  const out = { status: 'idle' };
  if (b) {
    out.status = b.paused ? 'paused' : 'focusing';
    out.end = b.end;
    out.left = b.end - (b.paused || now); // a paused clock doesn't run down
    out.paused = b.paused || null;
    out.id = b.id;
    out.nap = b.cat ? b.nap || b.id : null; // the group to join (cat mode off: just focus together)
    if (b.mode === 'stopwatch') { out.mode = 'stopwatch'; out.start = b.start; out.nap = null; } // nobody can end with an open-ended block
    if (share === 'all') out.intention = b.intention;
  } else if (doc.brk && doc.brk.end > now) {
    out.status = 'break';
    out.end = doc.brk.end;
  }
  return out;
};

// ---------- rankings ----------
// A ranking round is a week, Monday 00:00 to Monday 00:00 UTC, the same for everyone. What counts is
// the minutes of blocks whose kitten came home, by when they started.
E.round = (now) => {
  const d = new Date(now);
  const from = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return { from, to: from + 7 * 86400000 };
};
E.ranked = (doc, from, to) => {
  const bs = homeBlocks(doc).filter((b) => b.start >= from && b.start < to);
  return { minutes: bs.reduce((n, b) => n + homeMin(b), 0), kittens: bs.length };
};

// ---------- merging two copies of the same doc (sync) ----------
// Records carry `u` (last change). Per record the newer copy wins, crossed-off Later items
// win as tombstones, and a "clear history" removes ended blocks that started before it. The past
// with the further mark wins, and blocks before the mark go (see "the past" above).
E.merge = (a, b) => {
  a = E.normalize(a, false);
  b = E.normalize(b, false);
  const newer = (x, y) => (!x ? y : !y ? x : (y.u || 0) > (x.u || 0) ? y : x);
  const byId = (xs, ys, join = newer) => {
    const m = new Map();
    for (const x of xs) m.set(x.id, x);
    for (const y of ys) m.set(y.id, join(m.get(y.id), y));
    return [...m.values()];
  };
  // A kitten that wandered off stays gone, even if the other copy is newer for another reason
  // (unless it had come home before then).
  const block = (x, y) => {
    const w = newer(x, y);
    const l = w === x ? y : x;
    if (l && l.cancelled && !w.cancelled) return l; // a cancel sticks
    if (!l || !l.gone || w.gone || (w.home && w.home <= l.gone)) return w;
    const out = { ...w, gone: l.gone, goneWhy: l.goneWhy, treats: 0 };
    if (l.goneBy) out.goneBy = l.goneBy;
    delete out.home;
    return out;
  };
  const out = E.empty();
  out.cleared = Math.max(a.cleared, b.cleared);
  out.past = pastOf([a.past, b.past], out.cleared);
  out.blocks = byId(a.blocks, b.blocks, block).filter((x) => !(x.ended && x.start < out.cleared) && x.start >= out.past.to).sort((x, y) => x.start - y.start);
  // Started on two devices at once: the newest one runs, the other counts as stopped.
  const open = out.blocks.filter(isOpen);
  for (const x of open.slice(0, -1)) { stopped(x, x.paused || x.start, 'stop'); x.ended = x.paused || x.start; x.stopped = true; x.plan = []; x.closed = true; }
  out.later = byId(a.later, b.later).sort((x, y) => y.at - x.at);
  out.owned = byId(a.owned, b.owned).sort((x, y) => x.at - y.at);
  out.claimed = byId(a.claimed, b.claimed).sort((x, y) => x.at - y.at);
  out.settings = (b.settings.u || 0) > (a.settings.u || 0) ? b.settings : a.settings;
  if ((b.brkU || 0) > (a.brkU || 0)) { out.brk = b.brk; out.brkU = b.brkU; } else { out.brk = a.brk; out.brkU = a.brkU; }
  for (const k of new Set([...Object.keys(a.tally), ...Object.keys(b.tally)])) out.tally[k] = Math.max(a.tally[k] || 0, b.tally[k] || 0);
  trim(out); // the two copies together can be more than a doc keeps
  out.u = Math.max(a.u, b.u);
  return out;
};

if (typeof module !== 'undefined') module.exports = E; else root.Kavana = E;
})(this);
