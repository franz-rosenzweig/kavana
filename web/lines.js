// The short lines a "Nudge me" block sends. Quotes are only ones with a solid source.
// Loaded by the page (window.KavanaLines) and by Node (require).
(function (root) {
'use strict';
const LINES = [
  'One thing at a time.',
  'Just the next small step.',
  'Back to it. You know what comes next.',
  'Phone down, eyes on the work.',
  'Notice where your mind went, then come back.',
  "You don't have to finish it. Just keep at it.",
  'Stay with it a little longer.',
  'Close the tab you just opened.',
  'Small and steady beats big and scattered.',
  "It's fine to slow down. Just don't switch.",
  'Where is your attention right now?',
  'Bring it back, gently.',
  'Make the next minute count.',
  'You picked this for a reason.',
  'Breathe once, then the next line.',
  'Done is better than perfect.',
  'Do the next thing.',
  'Little by little, one travels far.',
  '“It is not your duty to finish the work, but neither are you free to desist from it.” Rabbi Tarfon',
  '“If not now, when?” Hillel',
  '“How we spend our days is, of course, how we spend our lives.” Annie Dillard',
  '“Attention is the rarest and purest form of generosity.” Simone Weil',
  '“While we are postponing, life speeds by.” Seneca',
  '“He who has begun has half done. Dare to be wise; begin!” Horace',
  '“It is not enough to be busy; so are the ants. The question is: What are we busy about?” Thoreau',
  '“Wherever you are, be all there.” Jim Elliot',
  '“The best way out is always through.” Robert Frost',
  '“The reward of a thing well done is to have done it.” Emerson',
];
if (typeof module !== 'undefined') module.exports = LINES; else root.KavanaLines = LINES;
})(this);
