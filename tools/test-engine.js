#!/usr/bin/env node
'use strict';
// Unit tests for web/engine.js (no server, no browser): node tools/test-engine.js
process.env.TZ = 'UTC'; // missions and events go by the local day
const assert = require('node:assert/strict');
const E = require('../web/engine.js');
const LINES = require('../web/lines.js');
const MIN = E.config.MIN;
let t = Date.UTC(2026, 9, 18, 9, 0);
const at = (m) => t + m * MIN;
let n = 0;
const test = (name, fn) => { fn(); n += 1; console.log('ok', name); };
const H = 60 * MIN, DAY = 24 * H;
// Treats without what missions paid (the older tests don't care which missions a day has).
const coins = (d) => { const x = E.treats(d); return { earned: x.earned - x.missions, spent: x.spent, left: x.left - x.missions }; };
// A day whose first mission is `id` (searching from `from`).
const dayWith = (id, from = Date.UTC(2026, 9, 1)) => { for (let i = 0; i < 400; i++) { const d = from + i * DAY; if (E.missions(E.empty(), d).day.some((m) => m.id === id)) return d; } throw new Error(`no day with ${id}`); };

test('start plans check-ins every 15 min, none in the last minute', () => {
  const d = E.empty();
  const b = E.start(d, { intention: '  Write   the intro ', minutes: 45, style: 'ask' }, t);
  assert.equal(b.intention, 'Write the intro');
  assert.deepEqual(b.plan.map((p) => (p.at - t) / MIN), [15, 30]); // 45 would be the end itself
  assert.equal(E.view(d, t).active.next, at(15));
});

test('tick turns due check-ins into pending ones, and ends the block', () => {
  const d = E.empty();
  const b = E.start(d, { intention: 'x', minutes: 25, style: 'ask' }, t);
  assert.equal(E.tick(d, at(14)), false);
  assert.equal(E.tick(d, at(15)), true);
  assert.equal(E.view(d, at(15)).active.pending, 1);
  assert.equal(E.answer(d, b.id, 1, 'drifted', 'phone', at(16)), 1);
  assert.equal(E.view(d, at(16)).active.pending, null);
  E.tick(d, at(26));
  const v = E.view(d, at(26));
  assert.equal(v.active, null);
  assert.equal(v.awaiting.id, b.id);
  E.outcome(d, b.id, 'partly', at(27));
  const h = E.history(d)[0];
  assert.deepEqual([h.outcome, h.drifts, h.whys[0], h.actual], ['partly', 1, 'phone', 25]);
  assert.deepEqual(E.view(d, at(27)).breakOffer, { id: b.id, minutes: 5 });
});

test('pause stops the clock and the pings; resume shifts them', () => {
  const d = E.empty();
  E.start(d, { intention: 'x', minutes: 25, style: 'ask' }, t);
  E.pause(d, at(5));
  assert.deepEqual(E.pings(d, at(5)), []);
  E.tick(d, at(8));
  assert.ok(E.running(d).paused);
  E.resume(d, at(8));
  const b = E.running(d);
  assert.equal(b.end, at(28));
  assert.equal(b.plan[0].at, at(18));
  assert.equal(E.view(d, at(8)).active.total, 25 * MIN);
  E.tick(d, at(29));
  assert.equal(E.history(d)[0].actual, 25);
});

test('a pause lasts 5 minutes at most, like Forest, and can be turned off', () => {
  const d = E.empty();
  E.start(d, { intention: 'x', minutes: 25 }, t);
  E.pause(d, at(5));
  E.tick(d, at(40)); // the pause ended by itself at 10, so the block ends at 30
  assert.equal(E.running(d), null);
  const h = E.history(d)[0];
  assert.deepEqual([h.stopped, h.actual, h.kitten], [false, 25, 'home']);
  // resuming late still only counts 5 minutes of pause
  const e = E.empty();
  E.start(e, { intention: 'x', minutes: 25 }, t);
  E.pause(e, at(5));
  E.resume(e, at(20));
  assert.equal(E.running(e).end, at(30));
  // turned off
  const f = E.empty();
  E.setSettings(f, { pause: 'off' }, t);
  E.start(f, { intention: 'x', minutes: 25 }, t);
  E.pause(f, at(5));
  assert.equal(E.running(f).paused, undefined);
  assert.throws(() => E.setSettings(f, { pause: 'forever' }, t));
});

test('nudges carry a line and never ask', () => {
  const d = E.empty();
  E.start(d, { intention: 'x', minutes: 60, style: 'nudge' }, t);
  const b = E.running(d);
  assert.ok(b.plan.length >= 2 && b.plan.every((p) => p.kind === 'nudge' && LINES.includes(p.line)));
  for (const p of b.plan) assert.ok(p.at > t && p.at < b.end - MIN + 1);
  E.tick(d, b.plan[0].at);
  const v = E.view(d, b.plan[0].at);
  assert.equal(v.active.pending, null);
  assert.equal(v.active.line, b.checkins[0].line);
  assert.equal(d.settings.style, 'nudge'); // sticks as the default
});

test('pings for the server: check-ins, the end, a break', () => {
  const d = E.empty();
  const b = E.start(d, { intention: 'Read', minutes: 25, style: 'ask' }, t);
  let p = E.pings(d, t);
  assert.deepEqual(p.map((x) => x.kind), ['checkin', 'end']);
  assert.equal(p[0].title, '🐱 Boo! Still on: Read?'); // cat mode is on unless turned off
  E.setSettings(d, { cat: false }, t);
  p = E.pings(d, t);
  assert.equal(p[0].title, 'Still on: Read?');
  assert.equal(p[0].body, '10 min left. Tap to answer.');
  assert.equal(p[1].at, b.end);
  E.stop(d, at(3));
  assert.deepEqual(E.pings(d, at(3)), []);
  E.outcome(d, b.id, null, at(3));
  E.startBreak(d, 5, at(4));
  assert.deepEqual(E.pings(d, at(4)).map((x) => [x.kind, x.at]), [['break-over', at(9)]]);
  E.tick(d, at(9));
  assert.equal(d.brk, null);
});

test('park, Later list, start from Later, extend', () => {
  const d = E.empty();
  E.start(d, { intention: 'x', minutes: 5 }, t);
  E.park(d, ' Email   the landlord ', at(1));
  E.addLater(d, 'email the LANDLORD', at(1)); // not twice
  E.addLater(d, 'Call the bank', at(2));
  let v = E.view(d, at(2));
  assert.deepEqual(v.later.map((x) => x.text), ['Call the bank', 'Email the landlord']);
  assert.deepEqual(v.active.parked, ['Email the landlord']);
  E.tick(d, at(5));
  const b = E.awaiting(d);
  E.extend(d, b.id, 20, at(6));
  assert.equal(E.running(d).end, at(26));
  assert.equal(E.running(d).minutes, 25);
  E.stop(d, at(8));
  E.outcome(d, b.id, 'done', at(8));
  const bank = v.later[0];
  E.start(d, { intention: bank.text, minutes: 25, fromLater: bank.id }, at(9));
  v = E.view(d, at(9));
  assert.deepEqual(v.later.map((x) => x.text), ['Email the landlord']);
});

test('joining a friend ends at the same time', () => {
  const d = E.empty();
  const b = E.start(d, { intention: 'Inbox', minutes: 25, withEnd: at(18), withName: 'Dana' }, t);
  assert.equal(b.end, at(18));
  assert.equal(b.minutes, 18);
  assert.equal(E.view(d, t).active.with, 'Dana');
});

test('settings validate; changing the interval re-plans the running block', () => {
  const d = E.empty();
  E.start(d, { intention: 'x', minutes: 60, style: 'ask' }, t);
  E.setSettings(d, { interval: 30 }, at(5));
  assert.deepEqual(E.running(d).plan.map((p) => (p.at - t) / MIN), [30]);
  assert.throws(() => E.setSettings(d, { interval: 7 }, at(5)));
  assert.throws(() => E.setSettings(d, { goal: 45 }, at(5)));
  assert.throws(() => E.setSettings(d, { daily: { time: '25:00' } }, at(5)));
  E.setSettings(d, { daily: { on: true, time: '09:00', days: [0, 0, 3] }, tz: 'Asia/Jerusalem' }, at(5));
  assert.deepEqual(E.daily(d), { on: true, time: '09:00', days: [0, 3], tz: 'Asia/Jerusalem', body: 'Pick one thing and start a block.', cat: true });
});

test('presence follows sharing', () => {
  const d = E.empty();
  E.start(d, { intention: 'Secret plan', minutes: 25 }, t);
  assert.equal(E.presence(d, t), null);
  E.setSettings(d, { share: 'status' }, t);
  assert.equal(E.presence(d, at(5)).intention, undefined);
  assert.equal(E.presence(d, at(5)).left, 20 * MIN);
  E.setSettings(d, { share: 'all' }, t);
  assert.equal(E.presence(d, at(5)).intention, 'Secret plan');
});

test('merge: newer record wins, tombstones win, clear history wins, one block runs', () => {
  const base = E.empty();
  E.addLater(base, 'A', t);
  E.addLater(base, 'B', t);
  const a = JSON.parse(JSON.stringify(base));
  const b = JSON.parse(JSON.stringify(base));
  E.doneLater(a, a.later.find((x) => x.text === 'A').id, at(1)); // crossed off on device a
  E.addLater(b, 'C', at(2)); // added on device b
  E.setSettings(b, { goal: 60 }, at(3));
  const m = E.merge(a, b);
  assert.deepEqual(E.view(m, at(3)).later.map((x) => x.text).sort(), ['B', 'C']);
  assert.equal(m.settings.goal, 60);
  // history cleared on a, an old finished block still on b
  const c = E.empty(); const e = E.empty();
  const old = E.start(e, { intention: 'old', minutes: 5 }, t); E.tick(e, at(6)); E.outcome(e, old.id, 'done', at(6));
  E.clearHistory(c, at(10));
  assert.equal(E.history(E.merge(c, e)).length, 0);
  // two devices started a block: the newer one keeps running
  const f = E.empty(); const g = E.empty();
  E.start(f, { intention: 'first', minutes: 25 }, at(20));
  E.start(g, { intention: 'second', minutes: 25 }, at(21));
  const mm = E.merge(f, g);
  assert.equal(E.running(mm).intention, 'second');
  assert.equal(mm.blocks.length, 2);
});

test('tally counts breaks and merges by the larger count; companion and catsSeen validate', () => {
  const a = E.empty(); const b = E.empty();
  E.startBreak(a, 5, t); E.stopBreak(a, t); E.startBreak(a, 5, t);
  E.count(b, 'breathes', t);
  const m = E.merge(a, b);
  assert.deepEqual(m.tally, { breaks: 2, breathes: 1 });
  E.setSettings(a, { companion: 'pepper', catsSeen: ['miso', 'miso', 'pepper', '<x>'] }, t);
  assert.equal(a.settings.companion, 'pepper');
  assert.deepEqual(a.settings.catsSeen, ['miso', 'pepper']);
  assert.deepEqual(E.normalize({ tally: { breaks: 3, bad: -1, 'x y': 2 } }).tally, { breaks: 3 });
});

test('normalize survives junk', () => {
  assert.deepEqual(E.normalize(null).blocks, []);
  const d = E.normalize({ blocks: [{ id: 'x' }, { id: 'y', start: 1, end: 2 }], later: 'nope', settings: { goal: 30 } });
  assert.equal(d.blocks.length, 1);
  assert.deepEqual(d.later, []);
  assert.equal(d.settings.goal, 30);
  assert.equal(d.settings.interval, 15);
});

test('the kitten comes home at the end and brings treats; a tag and the cat stick as defaults', () => {
  const d = E.empty();
  const b = E.start(d, { intention: 'x', minutes: 25, cat: 'pepper', tag: 'Study' }, t);
  assert.equal(E.view(d, at(10)).active.kitten, 'growing');
  assert.deepEqual([d.settings.companion, d.settings.tag], ['pepper', 'Study']);
  E.tick(d, at(25));
  const h = E.history(d)[0];
  assert.deepEqual([h.cat, h.tag, h.kitten, h.treats], ['pepper', 'Study', 'home', 25]);
  assert.equal(b.home, at(25));
  assert.deepEqual(coins(d), { earned: 25, spent: 0, left: 25 });
  // keep going after it came home: the extra minutes count, stopping the extension doesn't undo it
  E.extend(d, b.id, 10, at(26));
  E.stop(d, at(31));
  assert.deepEqual([E.history(d)[0].kitten, E.history(d)[0].treats], ['home', 30]);
});

test('stopping early or leaving the app sends the kitten off; the block goes on after leaving', () => {
  const d = E.empty();
  E.start(d, { intention: 'x', minutes: 25 }, t);
  E.stop(d, at(10));
  let h = E.history(d)[0];
  assert.deepEqual([h.kitten, h.goneWhy, h.treats], ['gone', 'stop', 0]);
  E.outcome(d, h.id, null, at(11));
  const b = E.start(d, { intention: 'y', minutes: 25 }, at(12));
  E.pause(d, at(13));
  assert.equal(E.away(d, at(13), at(14)), null); // paused: away doesn't count
  E.resume(d, at(14));
  assert.equal(E.away(d, at(20), at(21)).id, b.id);
  assert.equal(E.running(d).id, b.id);
  E.tick(d, at(40));
  h = E.history(d)[0];
  assert.deepEqual([h.kitten, h.goneWhy, h.treats], ['gone', 'away', 0]);
  assert.equal(E.treats(d).earned, 0);
  // the page finds out after the end, when the kitten has already come home
  const late = E.empty();
  E.start(late, { intention: 'x', minutes: 25 }, t);
  E.tick(late, at(30));
  assert.equal(E.history(late)[0].kitten, 'home');
  assert.equal(E.away(late, at(26), at(31)), null); // left after the end: it was home already
  assert.ok(E.away(late, at(10), at(31)));
  assert.deepEqual([E.history(late)[0].kitten, E.treats(late).earned], ['gone', 0]);
  // starting a new block while one runs stops the old one, and its kitten leaves
  E.outcome(d, b.id, null, at(41));
  E.start(d, { intention: 'z', minutes: 25 }, at(42));
  E.start(d, { intention: 'w', minutes: 25 }, at(43));
  assert.equal(E.history(d)[0].kitten, 'gone');
});

test('the shop: buy with treats, once each, and clearing history keeps the treats', () => {
  const d = E.empty();
  E.start(d, { intention: 'x', minutes: 50 }, t);
  E.tick(d, at(50));
  assert.throws(() => E.buy(d, 'counter', at(51)), /treats/);
  assert.throws(() => E.buy(d, 'sofa', at(51)), /item/);
  E.buy(d, 'cushion', at(51));
  assert.throws(() => E.buy(d, 'cushion', at(52)), /owned/);
  const paid = E.treats(d).missions;
  assert.deepEqual(coins(d), { earned: 50, spent: 40, left: 10 });
  E.clearHistory(d, at(53));
  assert.equal(E.history(d).length, 0);
  assert.deepEqual(E.treats(d), { earned: 50 + paid, spent: 40, left: 10 + paid, missions: 0, rewards: 0 }); // what missions paid is banked
  // another device that still has the block, and bought something else
  const other = E.empty();
  other.blocks = [{ ...d.blocks[0] }].filter(Boolean);
  const o2 = E.normalize(JSON.parse(JSON.stringify(other)));
  E.start(o2, { intention: 'old', minutes: 30 }, t - 60 * MIN);
  E.tick(o2, t - 30 * MIN);
  o2.owned.push({ id: 'box', at: at(52), u: at(52) });
  const m = E.merge(d, o2);
  assert.equal(E.history(m).length, 0); // started before the clear
  assert.deepEqual(m.owned.map((x) => x.id), ['cushion', 'box']);
  assert.deepEqual(E.treats(m), { earned: 50 + paid, spent: 60, left: paid > 10 ? paid - 10 : 0, missions: 0, rewards: 0 });
});

test('blocks from before the café: finished ones came home with Miso', () => {
  const d = E.normalize({ blocks: [
    { id: 'a', intention: 'old', minutes: 20, start: t, end: at(20), ended: at(20), closed: true },
    { id: 'b', intention: 'old', minutes: 20, start: at(30), end: at(50), ended: at(35), stopped: true, closed: true },
  ] });
  const [b2, a] = E.history(d);
  assert.deepEqual([a.cat, a.kitten, a.treats], ['miso', 'home', 20]);
  assert.deepEqual([b2.kitten, b2.treats], ['gone', 0]);
});

test('tags: cleaned, unique, at most 12; dropping the last-used one clears it', () => {
  const d = E.empty();
  assert.deepEqual(d.settings.tags, ['Work', 'Study', 'Reading', 'Writing', 'Other']);
  E.setSettings(d, { tag: 'Study' }, t);
  E.setSettings(d, { tags: ['  Work ', 'work', 'Deep   work', '', 'Fun'] }, t);
  assert.deepEqual(d.settings.tags, ['Work', 'Deep work', 'Fun']);
  assert.equal(d.settings.tag, '');
  assert.throws(() => E.setSettings(d, { tags: 'Work' }, t));
  assert.deepEqual(E.normalize({ settings: { tags: 'junk' } }).settings.tags, E.TAGS);
});

test('missions: three a day (one of each kind) and one a week, the same on every device', () => {
  const day = Date.UTC(2026, 9, 21); // a Wednesday
  const m = E.missions(E.empty(), day + 10 * H);
  assert.deepEqual(m.day.map((x) => E.MISSIONS[x.id].kind), ['a', 'b', 'c']);
  assert.equal(m.week.length, 1);
  assert.equal(E.MISSIONS[m.week[0].id].kind, 'w');
  assert.deepEqual(E.missions(E.empty(), day + 23 * H).day, m.day); // all day long
  assert.equal(m.dayEnds, day + DAY);
  assert.equal(m.weekEnds, Date.UTC(2026, 9, 25)); // weeks start on Sunday
  const sets = new Set();
  for (let i = 0; i < 14; i++) sets.add(E.missions(E.empty(), day + i * DAY).day.map((x) => x.id).join());
  assert.ok(sets.size >= 8, 'a different set most days');
  const weeks = new Set();
  for (let i = 0; i < 10; i++) weeks.add(E.missions(E.empty(), day + i * 7 * DAY).week[0].id);
  assert.ok(weeks.size >= 2);
});

test('missions pay bonus treats, and only kittens that came home count', () => {
  const day = dayWith('two');
  const d = E.empty();
  // 1 pm, 20 minutes, no tag, no first step, nothing parked: nothing but "Bring 2 kittens home" can be done
  const block = (h, stop) => { const b = E.start(d, { intention: 'x', minutes: 20 }, day + h * H); if (stop) E.stop(d, b.start + 5 * MIN); E.tick(d, b.start + 21 * MIN); E.outcome(d, b.id, null, b.start + 21 * MIN); return b; };
  block(13);
  block(14, true); // wandered off: doesn't count
  let ms = E.missions(d, day + 15 * H);
  assert.deepEqual(ms.day.find((x) => x.id === 'two'), { id: 'two', text: 'Bring 2 kittens home', need: 2, unit: null, pay: 10, have: 1, done: false });
  assert.equal(E.treats(d).missions, 0);
  block(15);
  ms = E.missions(d, day + 16 * H);
  assert.equal(ms.day.find((x) => x.id === 'two').done, true);
  assert.deepEqual(E.treats(d), { earned: 50, spent: 0, left: 50, missions: 10, rewards: 0 });
  // minutes add up for the time missions
  const t2 = dayWith('hour');
  const e = E.empty();
  for (const h of [13, 14, 15]) { const b = E.start(e, { intention: 'x', minutes: 20 }, t2 + h * H); E.tick(e, b.end); }
  assert.deepEqual(E.missions(e, t2 + 16 * H).day.find((x) => x.id === 'hour'), { id: 'hour', text: 'Focus for an hour', need: 60, unit: 'min', pay: 15, have: 60, done: true });
  // keeping going after the last one came home doesn't take the minutes away for a moment
  const last = e.blocks[e.blocks.length - 1];
  const end = last.end;
  E.extend(e, last.id, 5, end + MIN);
  assert.equal(E.missions(e, t2 + 16 * H).day.find((x) => x.id === 'hour').have, 60);
  E.stop(e, end + 6 * MIN);
  assert.equal(E.history(e)[0].treats, 25);
});

test('missions after Clear My History: paid ones are banked, that day closes and can\'t pay twice', () => {
  const day = dayWith('two');
  const d = E.empty();
  for (const h of [13, 14]) { const b = E.start(d, { intention: 'x', minutes: 20 }, day + h * H); E.tick(d, b.end); E.outcome(d, b.id, null, b.end); }
  const copy = JSON.parse(JSON.stringify(d)); // another device, from before the clear
  assert.equal(E.treats(d).missions, 10);
  E.clearHistory(d, day + 15 * H);
  assert.deepEqual(E.treats(d), { earned: 50, spent: 0, left: 50, missions: 0, rewards: 0 });
  assert.equal(E.missions(d, day + 15 * H).dayClosed, true);
  for (const h of [16, 17]) { const b = E.start(d, { intention: 'x', minutes: 20 }, day + h * H); E.tick(d, b.end); }
  assert.deepEqual(E.treats(d), { earned: 90, spent: 0, left: 90, missions: 0, rewards: 0 }); // just the minutes
  assert.deepEqual(E.treats(E.merge(copy, d)), E.treats(d));
  assert.equal(E.missions(d, day + DAY + H).dayClosed, false); // tomorrow is a new day
});

test('napping together: no pausing, a bonus when every kitten comes home', () => {
  const d = E.empty();
  const b = E.start(d, { intention: 'x', minutes: 25, withEnd: at(25), withName: 'Dana', nap: 'host1block' }, t);
  assert.equal(b.nap, 'host1block');
  E.pause(d, at(2));
  assert.equal(E.running(d).paused, undefined);
  assert.ok(E.napWith(d, b.id, 'host1block', 2, at(3)));
  assert.equal(E.napWith(d, b.id, 'host1block', 1, at(4)), null); // never fewer
  E.tick(d, at(25));
  const h = E.history(d)[0];
  assert.deepEqual([h.kitten, h.treats, h.napN], ['home', 25 + 2 * E.NAP_BONUS, 2]);
  assert.equal(coins(d).earned, 35);
  // the one who started it learns about the group later; cat mode off: no group
  const host = E.empty();
  const hb = E.start(host, { intention: 'y', minutes: 25 }, t);
  E.setSettings(host, { share: 'status' }, t);
  assert.equal(E.presence(host, at(1)).nap, hb.id);
  E.napWith(host, hb.id, hb.id, 1, at(2));
  assert.equal(E.presence(host, at(2)).nap, hb.id);
  const off = E.empty();
  assert.equal(E.start(off, { intention: 'z', minutes: 25, cat: null, nap: 'host1block' }, t).nap, undefined);
  assert.equal(E.napWith(off, off.blocks[0].id, 'host1block', 1, t), null);
});

test('napping together: when anyone leaves or stops, every kitten wanders off', () => {
  const d = E.empty();
  const b = E.start(d, { intention: 'x', minutes: 25, nap: 'host1block' }, t);
  E.napWith(d, b.id, 'host1block', 1, at(1));
  assert.ok(E.napGone(d, 'host1block', at(10), 'Dana', at(11)));
  assert.equal(E.running(d).id, b.id); // the block goes on
  E.tick(d, at(25));
  const h = E.history(d)[0];
  assert.deepEqual([h.kitten, h.goneWhy, h.goneBy, h.treats], ['gone', 'nap', 'Dana', 0]);
  assert.equal(E.napGone(d, 'host1block', at(12), 'Sam', at(30)), null); // gone once
  // found out late, after this kitten came home: undone if the friend left before then...
  const late = E.empty();
  const lb = E.start(late, { intention: 'x', minutes: 25 }, t);
  E.tick(late, at(26));
  assert.ok(E.napGone(late, lb.id, at(24), 'Dana', at(27))); // the host's group id is its block id
  assert.equal(E.history(late)[0].kitten, 'gone');
  // ...but not if they left after it came home
  const ok = E.empty();
  const ob = E.start(ok, { intention: 'x', minutes: 25, nap: 'host1block' }, t);
  E.tick(ok, at(26));
  assert.equal(E.napGone(ok, 'host1block', at(25.5), 'Dana', at(27)), null);
  assert.equal(E.history(ok)[0].kitten, 'home');
  assert.equal(ob.home, at(25));
});

test('merge: a kitten that wandered off stays gone', () => {
  const a = E.empty();
  const b0 = E.start(a, { intention: 'x', minutes: 25 }, t);
  E.tick(a, at(15));
  const b = JSON.parse(JSON.stringify(a));
  E.away(a, at(10), at(16)); // device a: you left
  E.answer(b, b0.id, 1, 'yes', null, at(17)); // device b: newer, but didn't know
  E.tick(b, at(25)); // ...and its copy came home
  for (const m of [E.merge(a, b), E.merge(b, a)]) {
    const h = E.history(m)[0];
    assert.deepEqual([h.kitten, h.goneWhy, h.treats], ['gone', 'away', 0]);
  }
  // came home before it was sent off on the other copy: home wins
  const c = E.empty();
  const cb = E.start(c, { intention: 'x', minutes: 25 }, t);
  E.tick(c, at(25));
  const old = JSON.parse(JSON.stringify(c));
  old.blocks[0].gone = at(26); old.blocks[0].goneWhy = 'away'; delete old.blocks[0].home; old.blocks[0].u = at(1);
  assert.equal(E.history(E.merge(c, old))[0].kitten, 'home');
  assert.equal(cb.home, at(25));
});

test('Halloween: the limited things are in the shop from Oct 25 to Nov 1, and you keep them', () => {
  const oct = (dd, hh = 12) => Date.UTC(2026, 9, dd, hh);
  assert.equal(E.season(oct(24, 23)), null);
  assert.equal(E.season(oct(25, 0)).id, 'halloween');
  assert.equal(E.season(Date.UTC(2026, 10, 1, 23, 59)).id, 'halloween');
  assert.equal(E.season(Date.UTC(2026, 10, 2)), null);
  assert.equal(E.season(Date.UTC(2027, 9, 31)).id, 'halloween'); // every year
  assert.deepEqual([E.soon(oct(20)).id, E.soon(oct(20)).days], ['halloween', 5]);
  assert.equal(E.soon(oct(10)), null);
  assert.equal(E.soon(oct(27)), null); // it's on
  assert.equal(E.forSale('box', oct(20)), true);
  assert.equal(E.forSale('pumpkin', oct(20)), false);
  const d = E.empty();
  d.tally.banked = 1000;
  assert.throws(() => E.buy(d, 'pumpkin', oct(20)), /season/);
  E.buy(d, 'pumpkin', oct(26));
  E.buy(d, 'cauldron', oct(31));
  assert.ok(E.owns(d, 'pumpkin') && E.owns(E.normalize(JSON.parse(JSON.stringify(d))), 'cauldron'));
  assert.equal(E.treats(d).spent, 420);
});

test('stopwatch: counts up, the kitten comes home after 10 minutes, not before; ends itself at 3 hours', () => {
  const d = E.empty();
  E.start(d, { intention: 'x', mode: 'stopwatch' }, t);
  const b = E.running(d);
  assert.deepEqual([b.mode, b.end], ['stopwatch', at(180)]);
  assert.equal(d.settings.mode, 'stopwatch');
  E.stop(d, at(25));
  let h = E.history(d)[0];
  assert.deepEqual([h.kitten, h.treats, h.actual, h.minutes, h.stopped], ['home', 25, 25, 25, false]);
  E.outcome(d, h.id, 'done', at(26));
  E.start(d, { intention: 'y', mode: 'stopwatch' }, at(30));
  E.stop(d, at(36));
  h = E.history(d)[0];
  assert.deepEqual([h.kitten, h.goneWhy, h.treats, h.stopped], ['gone', 'short', 0, true]);
  E.outcome(d, h.id, null, at(37));
  E.start(d, { intention: 'z', mode: 'stopwatch' }, at(40));
  E.tick(d, at(221));
  h = E.history(d)[0];
  assert.deepEqual([h.kitten, h.treats], ['home', 180]);
  // joining a friend is always a timer
  E.outcome(d, h.id, null, at(222));
  E.start(d, { intention: 'w', mode: 'stopwatch', withEnd: at(250) }, at(223));
  assert.equal(E.running(d).mode, undefined);
});

test('cancel in the first 10 seconds takes the block back; later it cannot', () => {
  const d = E.empty();
  const b = E.start(d, { intention: 'x', minutes: 25 }, t);
  E.cancel(d, t + 9000);
  assert.equal(E.running(d), null);
  assert.equal(E.awaiting(d), null);
  assert.deepEqual(E.history(d), []);
  assert.ok(d.blocks.find((x) => x.id === b.id).cancelled); // a tombstone, for the other devices
  assert.equal(E.treats(d).earned, 0);
  E.start(d, { intention: 'y', minutes: 25 }, at(1));
  assert.throws(() => E.cancel(d, at(1) + 11000), /cancel/);
  // a copy without the cancel can't bring it back
  const old = E.normalize(JSON.parse(JSON.stringify(d)));
  old.blocks.find((x) => x.id === b.id).cancelled = undefined;
  old.blocks.find((x) => x.id === b.id).u = t;
  assert.ok(E.merge(old, d).blocks.find((x) => x.id === b.id).cancelled);
  old.blocks.find((x) => x.id === b.id).u = at(5); // even when the other copy changed it later
  assert.ok(E.merge(old, d).blocks.find((x) => x.id === b.id).cancelled);
});

test('count extra time: home at the end, keeps going until you stop, extra minutes pay', () => {
  const d = E.empty();
  E.setSettings(d, { overtime: true }, t);
  E.start(d, { intention: 'x', minutes: 25 }, t);
  E.tick(d, at(26));
  const b = E.running(d);
  assert.ok(b && b.over === at(25) && b.home === at(25));
  assert.equal(E.view(d, at(26)).active.kitten, 'home');
  E.stop(d, at(40));
  const h = E.history(d)[0];
  assert.deepEqual([h.kitten, h.treats, h.stopped, h.actual], ['home', 40, false, 40]);
  // the end ping says it keeps counting
  const e = E.empty();
  E.setSettings(e, { overtime: true }, t);
  E.start(e, { intention: 'x', minutes: 25 }, t);
  assert.match(E.pings(e, t).find((p) => p.kind === 'end').body, /keeps counting/);
  assert.match(E.pings(e, t).find((p) => p.kind === 'end').title, /came home/);
  // ...but a kitten that already wandered off doesn't come home at the end, nor at a stopwatch's three hours
  E.away(e, at(5), at(6));
  assert.equal(E.pings(e, at(6)).find((p) => p.kind === 'end').title, "🐱 Time's up");
  const w = E.empty();
  E.setSettings(w, { mode: 'stopwatch' }, t);
  E.start(w, { intention: 'x', mode: 'stopwatch' }, t);
  assert.match(E.pings(w, t).find((p) => p.kind === 'end').title, /came home/);
  E.away(w, at(5), at(6));
  assert.equal(E.pings(w, at(6)).find((p) => p.kind === 'end').title, '🐱 Three hours. How did it go?');
});

test('leaving: grace and pauses', () => {
  const d = E.empty();
  E.start(d, { intention: 'x', minutes: 25 }, t);
  assert.equal(E.away(d, at(5), at(5) + 10000, 15000), null); // back within the grace
  E.pause(d, at(6));
  E.resume(d, at(9)); // left during the pause at 7: counts from 9
  assert.equal(E.away(d, at(7), at(9) + 10000, 15000), null);
  const b = E.away(d, at(7), at(12), 15000);
  assert.equal(b.gone, at(9) + 15000);
});

test('notes and edits', () => {
  const d = E.empty();
  const b = E.start(d, { intention: 'x', minutes: 25, tag: 'Work' }, t);
  E.tick(d, at(25));
  E.edit(d, b.id, { intention: ' Write   the intro ', tag: 'Study', note: 'Got the first page done.' }, at(26));
  const h = E.history(d)[0];
  assert.deepEqual([h.intention, h.tag, h.note], ['Write the intro', 'Study', 'Got the first page done.']);
  E.edit(d, b.id, { tag: '', note: '' }, at(27));
  assert.deepEqual([E.history(d)[0].tag, E.history(d)[0].note], [null, '']);
  E.edit(d, b.id, { intention: '  ' }, at(28)); // the title is optional: clearing it is fine
  assert.equal(E.history(d)[0].intention, '');
});

test('a block without a title: it starts, stays out of the recent ones, and its pings still read well', () => {
  const d = E.empty();
  E.setSettings(d, { interval: 10 }, t);
  const b = E.start(d, { minutes: 25 }, t);
  assert.equal(b.intention, '');
  const p = E.pings(d, t);
  assert.equal(p.find((x) => x.kind === 'checkin').title, '🐱 Boo! Still focusing?');
  assert.equal(p.find((x) => x.kind === 'end').body, 'Tap to log it.');
  E.tick(d, at(26));
  E.outcome(d, b.id, 'done', at(26));
  E.start(d, { intention: 'Read', minutes: 25 }, at(30));
  assert.deepEqual(E.view(d, at(31)).recent, ['Read']);
});

test('achievements: progress, claim once, the reward is treats', () => {
  const d = E.empty();
  let first = E.achievements(d).find((a) => a.id === 'first');
  assert.deepEqual([first.have, first.done, first.claimed], [0, false, false]);
  assert.throws(() => E.claim(d, 'first', t), /claim/);
  E.start(d, { intention: 'x', minutes: 60 }, t);
  E.tick(d, at(60));
  first = E.achievements(d).find((a) => a.id === 'first');
  assert.ok(first.done);
  assert.equal(E.achievements(d).find((a) => a.id === 'hour').done, true);
  const before = E.treats(d).left;
  assert.equal(E.claim(d, 'first', at(61)), 10);
  assert.equal(E.treats(d).left, before + 10);
  assert.throws(() => E.claim(d, 'first', at(62)), /claim/);
  assert.throws(() => E.claim(d, 'nope', at(62)), /claim/);
  // claims stay through Clear My History, and merge as a set
  E.claim(d, 'hour', at(63));
  const copy = E.normalize(JSON.parse(JSON.stringify(d)));
  E.clearHistory(d, at(64));
  assert.deepEqual(d.claimed.map((x) => x.id), ['first', 'hour']);
  assert.equal(E.merge(copy, d).claimed.length, 2);
  // friends counted by the page only go up
  E.setTally(d, 'friends', 2, at(65)); E.setTally(d, 'friends', 1, at(66));
  assert.equal(E.stats(d).friends, 2);
});

test('the starter challenge and the monthly challenge', () => {
  const d = E.empty();
  const s0 = E.starter(d);
  assert.equal(s0.steps.length, 7);
  E.start(d, { intention: 'x', minutes: 25, tag: 'Work' }, t);
  E.tick(d, at(25));
  const s1 = E.starter(d);
  assert.deepEqual(s1.steps.filter((x) => x.done).map((x) => x.id), ['starter-first', 'starter-tag']);
  assert.equal(E.claim(d, 'starter-first', at(26)), E.STARTER_PAY);
  assert.throws(() => E.claim(d, 'starter-all', at(26)), /claim/);
  // 20 days with a kitten home this month
  const m = E.empty();
  const first = new Date(2026, 6, 1, 9).getTime();
  for (let i = 0; i < 20; i++) { E.start(m, { intention: 'x', minutes: 25 }, first + i * 86400000); E.tick(m, first + i * 86400000 + 25 * MIN); E.outcome(m, m.blocks[m.blocks.length - 1].id, null, first + i * 86400000 + 26 * MIN); }
  const mo = E.monthly(m, first + 25 * 86400000);
  assert.deepEqual([mo.id, mo.have, mo.done], ['month-2026-7', 20, true]);
  assert.equal(E.claim(m, mo.id, first + 25 * 86400000), E.MONTH_PAY);
  assert.equal(E.monthly(m, first + 40 * 86400000).have, 0); // August
});

test('settings: own lines go into nudges, rankings need a name to be worldwide, themes must be owned', () => {
  const d = E.empty();
  E.setSettings(d, { lines: ['  Small steps.  ', 'Small steps.', '', 'Breathe, then type.'] }, t);
  assert.deepEqual(d.settings.lines, ['Small steps.', 'Breathe, then type.']);
  E.start(d, { intention: 'x', minutes: 120, style: 'nudge' }, t);
  const lines = E.running(d).plan.map((p) => p.line);
  assert.ok(lines.some((l) => d.settings.lines.includes(l)) && lines.some((l) => LINES.includes(l)));
  assert.throws(() => E.setSettings(d, { rank: { on: true, global: true, name: '' } }, t), /rank/);
  E.setSettings(d, { rank: { on: true, global: true, name: '<Miso fan>' } }, t);
  assert.deepEqual(d.settings.rank, { on: true, name: 'Miso fan', global: true });
  assert.throws(() => E.setSettings(d, { theme: 'night' }, t), /theme/);
  d.tally.banked = 300;
  E.buy(d, 'theme-night', t);
  E.setSettings(d, { theme: 'night' }, t);
  assert.equal(d.settings.theme, 'night');
  assert.deepEqual(E.normalize({ settings: { rank: 'x', lines: 'y' } }).settings.rank, { on: false, name: '', global: false });
});

test('rankings: a UTC week from Monday, minutes of kittens that came home', () => {
  const r = E.round(Date.UTC(2026, 9, 22, 15)); // a Thursday
  assert.deepEqual([new Date(r.from).toISOString(), new Date(r.to).toISOString()], ['2026-10-19T00:00:00.000Z', '2026-10-26T00:00:00.000Z']);
  const d = E.empty();
  E.start(d, { intention: 'x', minutes: 30 }, Date.UTC(2026, 9, 20, 9)); E.tick(d, Date.UTC(2026, 9, 20, 10));
  E.outcome(d, d.blocks[0].id, null, Date.UTC(2026, 9, 20, 10));
  E.start(d, { intention: 'y', minutes: 30 }, Date.UTC(2026, 9, 18, 9)); E.tick(d, Date.UTC(2026, 9, 18, 10)); // the week before
  assert.deepEqual(E.ranked(d, r.from, r.to), { minutes: 30, kittens: 1 });
});

test('winter runs over New Year, and its things are only for sale then', () => {
  assert.equal(E.season(new Date(2026, 11, 20).getTime()).id, 'winter');
  assert.equal(E.season(new Date(2027, 0, 3).getTime()).id, 'winter');
  assert.equal(E.season(new Date(2027, 0, 6).getTime()), null);
  assert.equal(E.soon(new Date(2026, 11, 10).getTime()).id, 'winter');
  assert.ok(!E.forSale('flurry', new Date(2026, 10, 20).getTime()));
});

// A long history, block k of it: four a day (at 5, 9, 14 and 22 o'clock) with a mix of cats, tags,
// lengths and outcomes, kittens that wander off, stopwatch blocks and naps.
const T0 = Date.UTC(2025, 0, 5);
function grow(d, from, n) {
  for (let k = from; k < from + n; k++) {
    const s = T0 + Math.floor(k / 4) * DAY + [5, 9, 14, 22][k % 4] * H + (k % 7) * MIN;
    const minutes = [25, 50, 125, 30][k % 4];
    const watch = k % 11 === 3;
    const b = E.start(d, { intention: `block ${k}`, minutes, cat: ['miso', 'luna', 'olive'][k % 3], tag: ['Work', 'Study', ''][k % 5 % 3], mode: watch ? 'stopwatch' : 'timer' }, s);
    if (k % 13 === 6) E.napWith(d, b.id, `nap${k}kv`, 1, s + MIN);
    if (watch) E.stop(d, s + 40 * MIN);
    else if (k % 9 === 4) E.stop(d, s + 10 * MIN); // the kitten wanders off
    else E.tick(d, s + minutes * MIN);
    E.outcome(d, b.id, k % 2 ? 'done' : 'partly', s + 130 * MIN);
  }
  return d;
}
// Run fn keeping n blocks, and `bytes` of JSON (no limit unless a test is about the size).
const keep = (n, fn, bytes = Infinity) => { const was = { ...E.config }; Object.assign(E.config, { KEEP: n, BYTES: bytes }); try { return fn(); } finally { Object.assign(E.config, was); } };
const copy = (d) => JSON.parse(JSON.stringify(d));
const purse = (d) => { const x = E.treats(d); return { earned: x.earned, spent: x.spent, left: x.left }; }; // what missions paid moves into the bank
// What the café shows for a period: the past days and the blocks still in the doc, together.
function cafeOf(d, from, to) {
  const out = { home: 0, gone: 0, cats: {}, focus: {} };
  const add = (o, k, v) => { o[k] = (o[k] || 0) + v; };
  for (const b of E.history(d).filter((x) => x.start >= from && x.start < to)) {
    add(out.focus, b.tag || '', b.actual);
    if (b.kitten === 'home') { out.home += 1; add(out.cats, b.cat, 1); } else out.gone += 1;
  }
  for (const x of E.pastDays(d, from, to)) {
    out.home += x.home; out.gone += x.gone;
    for (const [k, v] of Object.entries(x.cats)) add(out.cats, k, v);
    for (const [k, v] of Object.entries(x.focus)) add(out.focus, k, v);
  }
  return out;
}

test('more than 2000 blocks: the oldest go into the past, and nothing they counted for is lost', () => keep(2000, () => {
  const all = keep(Infinity, () => grow(E.empty(), 0, 2100));
  const d = grow(E.empty(), 0, 2100);
  assert.equal(all.blocks.length, 2100);
  assert.equal(d.blocks.length, 2000);
  assert.equal(d.past.to, all.blocks[100].start);
  assert.equal(d.blocks[0].start, d.past.to);
  assert.ok(d.tally.banked > 0);
  // buy the shop: the balance is the same as with the whole history, so what was bought can't push it below zero
  const now = T0 + 600 * DAY;
  const shop = Object.keys(E.SHOP).filter((x) => !E.limited(x));
  for (const id of shop) { E.buy(all, id, now); E.buy(d, id, now); }
  assert.equal(E.treats(d).spent, shop.reduce((n, x) => n + E.SHOP[x], 0));
  assert.deepEqual(purse(d), purse(all));
  assert.deepEqual(E.stats(d), E.stats(all));
  assert.deepEqual(E.achievements(d), E.achievements(all));
  for (const m of [0, 1, 6, 12]) { const x = Date.UTC(2025, m, 15); assert.deepEqual(E.monthly(d, x), E.monthly(all, x)); }
  // January 2025 is half in the past and half still in the doc; the café counts all of it, by cat and by tag
  for (const [from, to] of [[Date.UTC(2025, 0, 1), Date.UTC(2025, 1, 1)], [Date.UTC(2025, 0, 1), Date.UTC(2026, 0, 1)], [Date.UTC(2025, 0, 30), Date.UTC(2025, 0, 31)]]) {
    assert.deepEqual(cafeOf(d, from, to), cafeOf(all, from, to));
  }
  assert.deepEqual([E.pastDays(d).length, E.pastDays(d)[0].day], [25, T0]); // 100 blocks, four a day
  // the doc is the same each time it's read, and merging it with itself changes nothing (so sync doesn't loop)
  const n = E.normalize(copy(d));
  assert.equal(JSON.stringify(E.normalize(copy(n))), JSON.stringify(n));
  assert.equal(JSON.stringify(E.merge(n, copy(n))), JSON.stringify(n));
  assert.deepEqual(purse(n), purse(all));
}));

test('two devices that fold at different times merge without counting a block twice', () => keep(2000, () => {
  const base = keep(Infinity, () => grow(E.empty(), 0, 2000));
  const a = grow(copy(base), 2000, 3), b = grow(copy(base), 2003, 2); // each folds its oldest few
  assert.deepEqual([a.blocks.length, b.blocks.length, a.past.to > b.past.to], [2000, 2000, true]);
  const want = keep(Infinity, () => E.merge(grow(copy(base), 2000, 3), grow(copy(base), 2003, 2))); // the whole history
  assert.equal(want.blocks.length, 2005);
  const m = E.merge(a, b);
  assert.equal(JSON.stringify(E.merge(b, a).past), JSON.stringify(m.past));
  assert.equal(m.blocks.length, 2000);
  assert.equal(m.past.to, want.blocks[5].start);
  assert.deepEqual(purse(m), purse(want));
  assert.deepEqual(E.stats(m), E.stats(want));
  assert.deepEqual(cafeOf(m, T0, T0 + 30 * DAY), cafeOf(want, T0, T0 + 30 * DAY));
  // a copy that still has the folded blocks (or folded fewer) brings nothing back, in any order, any number of times
  for (const old of [base, a, b, m]) {
    for (const x of [E.merge(m, copy(old)), E.merge(copy(old), m), E.merge(E.merge(m, copy(old)), copy(old))]) {
      assert.equal(x.blocks.length, 2000);
      assert.deepEqual(purse(x), purse(want));
      assert.deepEqual(E.stats(x), E.stats(want));
    }
  }
}));

test('the past never takes a block still waiting; Clear My History empties it but keeps the treats; junk is dropped', () => keep(4, () => {
  const d = keep(Infinity, () => grow(E.empty(), 0, 5));
  delete d.blocks[0].closed; // nobody said how the oldest one went (a copy from before E.start filed it)
  const w = E.normalize(d);
  assert.deepEqual([w.blocks.length, w.past.to], [5, 0]);
  E.tick(w, T0 + 3 * DAY); // twelve hours on, it's filed without an answer
  const n = E.normalize(w);
  assert.equal(n.blocks.length, 4);
  assert.equal(n.past.to, n.blocks[0].start);
  assert.deepEqual(purse(n), purse(d));
  // a block still running stays, even if it's the oldest
  const r = E.normalize({ blocks: [{ id: 'run', start: T0, end: T0 + H }, ...grow(E.empty(), 1, 4).blocks] });
  assert.ok(r.blocks.some((x) => x.id === 'run'));

  // Clear My History: the past empties too, the treats stay, and an old copy doesn't bring it back
  const c = grow(E.empty(), 0, 8);
  const old = copy(c);
  const earned = E.treats(c).earned;
  E.clearHistory(c, T0 + 10 * DAY);
  assert.equal(E.treats(c).earned, earned);
  assert.deepEqual([E.pastDays(c), E.stats(c).home, E.stats(c).minutes, c.past.long, c.past.tags], [[], 0, 0, 0, []]);
  for (const x of [E.merge(old, c), E.merge(c, old)]) {
    assert.deepEqual([E.pastDays(x), E.stats(x).home, E.treats(x).earned, x.past.to], [[], 0, earned, old.past.to]);
  }
  grow(c, 100, 6); // after the clear, the past fills up again, with only what came after it
  const x = E.merge(old, c);
  assert.equal(E.pastDays(x).length, 1);
  assert.deepEqual(E.stats(x), E.stats(c));
  assert.deepEqual(purse(x), purse(c));

  // junk
  assert.deepEqual(E.normalize({ past: { to: 'soon', days: { '2025-01-05': { min: 5 } }, long: 3 } }).past, E.empty().past);
  const j = E.normalize({
    past: { to: T0 + DAY, days: { '2025-01-05': { min: -3, gone: 1.5, cats: { miso: 2, 'Bad!': 1 }, focus: { Work: 10, '': 4, [' x ']: 1 } }, nope: { min: 1 }, '2025-01-04': {} }, long: 2, early: 'x', tags: [' Work ', 7, ''] },
    blocks: [{ id: 'gone', start: T0, end: T0 + H }, { id: 'kept', start: T0 + DAY, end: T0 + DAY + H }],
  });
  assert.deepEqual(j.past, { ...E.empty().past, to: T0 + DAY, days: { '2025-01-05': { focus: { '': 4, Work: 10 }, cats: { miso: 2 } } }, long: 2, tags: ['Work'] });
  assert.deepEqual(j.blocks.map((b) => b.id), ['kept']); // it's already in the past
}));

// ---------- the doc's size ----------
// What the server takes (server.js): a posted body of up to `body` bytes, and a doc of up to `doc`
// characters of JSON once it's normalized.
const SERVER = (() => {
  const src = require('node:fs').readFileSync(require('node:path').join(__dirname, '../server.js'), 'utf8');
  const num = (re) => Number(re.exec(src)[1].replace(/_/g, ''));
  return { doc: num(/docBytes: ([\d_]+)/), body: num(/function readBody\(req, max = ([\d_]+)\)/) };
})();
const serverTakes = (d) => Buffer.byteLength(JSON.stringify({ rev: 12345, doc: d })) <= SERVER.body && JSON.stringify(E.normalize(copy(d))).length <= SERVER.doc;
// n characters of text, starting with `k`, in 3-byte characters (the most UTF-8 takes per character)
const wide = (k, n) => `${k} ${'漢字'.repeat(n)}`.slice(0, n);
const OWN = Array.from({ length: 20 }, (_, i) => wide(`line ${i}`, 120));
// The most a block can hold: nearly four hours of nudges every 10 minutes from 20 own lines, the
// longest intention, first step and note, and 30 parked thoughts (which fill Later to 200 too), all in
// wide characters. `check` looks at the doc right after the block starts (the fold), and when it's at
// its fullest.
function heavy(d, from, n, check = () => {}) {
  E.setSettings(d, { interval: 10, lines: OWN }, T0);
  for (let k = from; k < from + n; k++) {
    const s = T0 + Math.floor(k / 4) * DAY + [5, 9, 14, 22][k % 4] * H;
    const b = E.start(d, { intention: wide(`block ${k}`, 140), step: wide('step', 140), minutes: 230, style: 'nudge', tag: 'Work', cat: 'miso' }, s);
    check(d, true);
    for (let i = 0; i < 30; i++) E.park(d, wide(`thought ${k}.${i}`, 200), s + i * MIN);
    E.edit(d, b.id, { note: wide('note', 500) }, s + 31 * MIN);
    E.tick(d, s + 200 * MIN);
    check(d, false);
    E.tick(d, s + 230 * MIN);
    E.outcome(d, b.id, 'done', s + 231 * MIN);
  }
  return d;
}

test('E.size counts the bytes the server reads', () => {
  for (const x of ['plain', 'שלום, עולם', '漢字', '🐱 cat', { a: ['é', '\u2028', '\ud83d'] }, E.empty(), grow(E.empty(), 0, 20)]) {
    assert.equal(E.size(x), Buffer.byteLength(JSON.stringify(x)));
  }
});

test('your own lines and what the nudges said stay out of filed blocks', () => {
  const d = E.empty();
  E.setSettings(d, { interval: 10, lines: OWN }, t);
  const b = E.start(d, { intention: 'x', minutes: 240, style: 'nudge' }, t);
  assert.equal(b.own, undefined);
  assert.ok(b.plan.some((p) => OWN.includes(p.line)) && b.plan.some((p) => LINES.includes(p.line))); // every other nudge is one of yours
  E.tick(d, at(100));
  const last = E.running(d).checkins.at(-1);
  assert.ok(last.line);
  assert.equal(E.view(E.normalize(copy(d)), at(100)).active.line, last.line); // the running block still shows it
  E.tick(d, at(241));
  E.extend(d, b.id, 20, at(242)); // more time plans from the settings' lines
  assert.ok(E.running(d).plan.every((p) => OWN.includes(p.line) || LINES.includes(p.line)));
  E.tick(d, at(263));
  assert.ok(E.awaiting(E.normalize(copy(d))).checkins.every((c) => c.line)); // not filed yet: on the end screen
  E.outcome(d, b.id, 'done', at(264));
  const n = E.normalize(copy(d));
  const f = n.blocks[0];
  assert.ok(f.checkins.length > 20 && f.checkins.every((c) => c.kind === 'nudge' && !('line' in c)));
  assert.equal(E.history(n)[0].checkins, f.checkins.length);
  assert.ok(E.size(f) < 2000, `${E.size(f)} bytes`); // it was 6600 with the lines in it
  // a copy from before: its blocks lose their own copy of the lines, and the filed ones their words, both ways
  const old = copy(d);
  E.start(old, { intention: 'y', minutes: 25, style: 'nudge' }, at(300));
  old.blocks[0].own = OWN; // as a copy from before has them
  old.blocks[0].checkins.forEach((c, i) => { c.line = OWN[i % OWN.length]; });
  old.blocks[1].own = OWN;
  for (const x of [E.normalize(copy(old)), E.merge(copy(old), n), E.merge(n, copy(old))]) {
    assert.ok(x.blocks.every((y) => !('own' in y)));
    assert.ok(x.blocks[0].checkins.every((c) => !('line' in c)));
    assert.equal(JSON.stringify(E.normalize(copy(x))), JSON.stringify(x));
  }
});

test('a doc never gets too big to sync, however full its blocks are, and nothing is lost', () => {
  assert.ok(SERVER.doc - E.config.BYTES >= 150000 && SERVER.body >= SERVER.doc, 'room between what the engine keeps and what the server takes');
  const whole = keep(Infinity, () => heavy(E.empty(), 0, 60));
  assert.ok(!serverTakes(whole)); // without the fold it wouldn't sync
  let most = 0;
  const d = heavy(E.empty(), 0, 60, (x, started) => {
    if (started) assert.ok(E.size(x) <= E.config.BYTES);
    else { most = Math.max(most, E.size(x)); assert.ok(serverTakes(x)); }
  });
  assert.ok(most > E.config.BYTES); // between folds it grows, and the server still takes it
  assert.ok(d.past.to > 0 && d.blocks.length < 60 && d.blocks.length > 20, `${d.blocks.length} blocks`);
  assert.equal(d.blocks[0].start, d.past.to);
  assert.deepEqual(purse(d), purse(whole));
  assert.deepEqual(E.stats(d), E.stats(whole));
  assert.deepEqual(E.achievements(d), E.achievements(whole));
  assert.deepEqual(cafeOf(d, T0, T0 + 30 * DAY), cafeOf(whole, T0, T0 + 30 * DAY));
  // the whole history, read in one go, folds down the same way, and reading it again changes nothing
  const n = E.normalize(copy(whole));
  assert.ok(E.size(n) <= E.config.BYTES && serverTakes(n));
  assert.deepEqual(purse(n), purse(whole));
  assert.equal(JSON.stringify(E.normalize(copy(n))), JSON.stringify(n));
  assert.equal(JSON.stringify(E.merge(n, copy(n))), JSON.stringify(n));
  // the worst moment: Later was empty at the last fold, then 200 long items went on it before the next one
  const w = keep(Infinity, () => grow(copy(d), 1000, 300)); // everyday blocks after these
  w.later = [];
  const now = T0 + 400 * DAY;
  heavy(E.normalize(w), 2000, 1, (x, started) => {
    if (started) return;
    for (let i = 0; i < 200; i++) E.addLater(x, wide(`later ${i}`, 200), now + i);
    assert.ok(E.size(x) > E.config.BYTES + 100000 && serverTakes(x), `${E.size(x)} bytes`);
  });
});

test('everyday blocks: 1500 and more fit, and two devices that fold by size at different times agree', () => {
  const base = keep(Infinity, () => grow(E.empty(), 0, 2000));
  const d = E.normalize(copy(base));
  assert.ok(E.size(d) <= E.config.BYTES && E.size(d) > E.config.BYTES - 2000);
  assert.ok(d.blocks.length > 1500 && d.blocks.length < 2000, `${d.blocks.length} blocks`);
  assert.equal(JSON.stringify(E.normalize(copy(d))), JSON.stringify(d));
  // with a smaller budget (it's quicker; the past of these 500 days is 50 KB on its own), like the count test above
  const SMALL = 150000;
  keep(Infinity, () => {
    const a = grow(copy(base), 2000, 3), b = grow(copy(base), 2003, 2);
    const want = E.merge(copy(a), copy(b));
    keep(Infinity, () => {
      const x = E.normalize(copy(a)), y = E.normalize(copy(b)); // each folds what's over, at its own mark
      assert.ok(x.past.to !== y.past.to && E.size(x) <= SMALL && E.size(y) <= SMALL);
      const m = E.merge(x, y);
      assert.equal(JSON.stringify(E.merge(y, x).past), JSON.stringify(m.past));
      assert.ok(E.size(m) <= SMALL);
      assert.deepEqual(purse(m), purse(want));
      assert.deepEqual(E.stats(m), E.stats(want));
      for (const old of [base, a, b, x, y]) {
        for (const z of [E.merge(m, copy(old)), E.merge(copy(old), m)]) {
          assert.deepEqual(purse(z), purse(want));
          assert.deepEqual(E.stats(z), E.stats(want));
        }
      }
    }, SMALL);
  });
});

test('the size fold never takes a block that is running or waiting, and leaves the blocks alone when they are not the problem', () => keep(Infinity, () => {
  const d = grow(E.empty(), 0, 6);
  const b = E.start(d, { intention: wide('long', 140), minutes: 60 }, T0 + 10 * DAY);
  const w = copy(d);
  E.tick(w, T0 + 10 * DAY + H); // ended, waiting for "How did it go?"
  for (const x of [d, w]) {
    const one = keep(1, () => E.normalize(copy(x))); // every other block folded
    const n = keep(Infinity, () => E.normalize(copy(x)), E.size(one) + 100); // only room for the running or waiting one
    assert.equal(JSON.stringify(n), JSON.stringify(one));
    assert.deepEqual(n.blocks.map((y) => y.id), [b.id]);
    assert.equal(n.past.to, b.start);
    assert.deepEqual(purse(n), purse(x));
    // something else is what's too big (junk from somewhere): folding wouldn't help, so nothing goes
    const j = keep(Infinity, () => E.normalize({ ...copy(x), settings: { ...x.settings, junk: 'x'.repeat(5000) } }), 3000);
    assert.deepEqual([j.blocks.length, j.past.to], [7, 0]);
  }
}));

test('every cat and café thing has its painting, and every shop item is in cats.js', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const K = require('../web/cats.js');
  const web = (f) => fs.existsSync(path.join(__dirname, '../web', f));
  for (const c of K.CATS) for (const k of ['portrait', 'kitten', 'nap']) assert.ok(web(c[k]), c[k]);
  for (const x of K.ITEMS) assert.ok(web(x.art), x.art);
  for (const c of K.CATS) for (const f of Object.values(c.poses || {})) assert.ok(web(f), f); // the 3D café's poses
  for (const x of K.ITEMS) for (const f of Object.values(x.views || {})) assert.ok(web(f), f); // and its turning things
  assert.ok(web('cafe/gone-1.webp'));
  for (const c of K.SHELTER) assert.ok(web(c.portrait), c.portrait);
  const ids = [...K.ITEMS.map((x) => x.id), ...K.CATS.filter((c) => c.adopt).map((c) => c.id), ...K.SHELTER.map((c) => c.id),
    ...K.THEMES.filter((x) => x.id !== 'classic').map((x) => `theme-${x.id}`)].sort();
  assert.deepEqual(ids, Object.keys(E.SHOP).filter((id) => !id.startsWith('sound-')).sort());
  assert.deepEqual(E.ADOPT.slice().sort(), K.CATS.filter((c) => c.adopt).map((c) => c.id).sort());
  assert.deepEqual(E.SHELTER, K.SHELTER.map((c) => c.id));
});

console.log(`\n${n} passed`);
