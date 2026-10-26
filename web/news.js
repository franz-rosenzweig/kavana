// What's new in Chataltul, newest first. `date` is when it shows up (an event's post shows from a week
// before it starts); `go` is where "Take me there" goes.
(function (root) {
'use strict';
const NEWS = [
  {
    id: 'winter-2026', date: '2026-12-08', title: 'Winter is coming to the café',
    body: 'From December 15 to January 5, Flurry the winter cat and four cozy things are in the shop: a fireplace, a snowman, a snow globe and a sled. What you get, you keep.',
    go: 'shop',
  },
  {
    id: 'name-2026-10', date: '2026-10-25', title: 'Kavana is now Chataltul',
    body: 'Chataltul (חתלתול) is Hebrew for kitten, the one that grows up while you focus. Same app, same café, and everything you had is still here. Pepper has a new name too: say hi to Milo, a black cat with gold eyes.',
    go: 'cats',
  },
  {
    id: 'sounds-2026-10', date: '2026-10-25', title: 'Real sounds, and lots more of them',
    body: 'The background sounds are real recordings now, and there are 39 of them: five cats purring, rain and thunder, waves and a stream, fires, birds and crickets, cafés, a city at night, and music. One in each group is free, the rest are in the shop. And when a kitten comes home, it says hello.',
    go: 'shop',
  },
  {
    id: 'forest-2026-10', date: '2026-10-22', title: 'A big update: everything Forest does, with cats',
    body: 'A stopwatch that counts up. Cancel in the first 10 seconds. Pauses of up to 5 minutes (or none). Count extra time past the end. Notes on your blocks. Achievements, a monthly challenge and a starter challenge. Rankings with friends and worldwide. Shelter cats you sponsor. Café themes, six new sounds that you can layer, a mindful minute, and rooms anyone can join with a code.',
    go: 'missions',
  },
  {
    id: 'halloween-2026', date: '2026-10-21', title: 'Halloween week: Oct 25 to Nov 1',
    body: 'Pumpkin the cat and four spooky things for your café, only that week. Plus napping together with friends, and daily and weekly missions.',
    go: 'shop',
  },
  {
    id: 'cafe-2026-10', date: '2026-10-20', title: 'The Cat Café is open',
    body: 'A kitten grows while you focus. Stay to the end and it comes home to your café; leave in the middle and it wanders off. Every minute earns a treat for the shop.',
    go: 'cafe',
  },
];
root.KavanaNews = NEWS;
if (typeof module !== 'undefined') module.exports = NEWS;
})(this);
