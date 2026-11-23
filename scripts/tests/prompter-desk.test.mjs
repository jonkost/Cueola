import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const D = require('../../cueola-prompter-desk.js');

function test(name, fn) {
  try { fn(); console.log(`PASS ${name}`); }
  catch (error) { console.error(`FAIL ${name}`); throw error; }
}

let n = 0;
const press = (sender, action, extra = {}) => sender.stamp({ id: 'c' + (++n), action, at: 1000 + n, ...extra }, extra.known);
// A tiny stand-in for the show's shared document: one record per family.
const put = (desk, stamped) => { desk[stamped.family] = stamped.record; return desk; };

test('every control lands in a family, and rivals share one', () => {
  assert.equal(D.familyOf('pause'), 'play');
  assert.equal(D.familyOf('resume'), 'play');
  assert.equal(D.familyOf('speed_set_80'), 'speed');
  assert.equal(D.familyOf('seek_line_-3'), 'nudge');
  assert.equal(D.familyOf('seek_row_4'), 'seek');
  assert.equal(D.familyOf('reset'), 'seek');
  assert.equal(D.familyOf('slate_tech_on'), 'slate');
  assert.equal(D.familyOf('slate_bars_off'), 'slate');
  assert.equal(D.familyOf('clock_size_up'), 'clocksize');
  assert.equal(D.familyOf('clock_timeofday'), 'clock');
  assert.equal(D.familyOf('wrapup_300'), 'wrap');
  assert.equal(D.familyOf('overlays_clear'), 'clear');
  assert.equal(D.familyOf(''), '');
});

test('faster and slower become a number the talent can land on', () => {
  assert.equal(D.absoluteAction('speed_up', { speed: 60 }), 'speed_set_70');
  assert.equal(D.absoluteAction('speed_down', { speed: 8 }), 'speed_set_5');
  assert.equal(D.absoluteAction('size_up', { size: 118 }), 'size_set_120');
  assert.equal(D.absoluteAction('size_down', { size: 52 }), 'size_set_48');
  // No known speed: the press stays as it was and is applied once.
  assert.equal(D.absoluteAction('speed_up', {}), 'speed_up');
  assert.equal(D.absoluteAction('pause', { speed: 60 }), 'pause');
});

test('a linked talent applies a press once, however many times it is seen', () => {
  const op = D.createSender({ writer: 'opA' });
  const talent = D.createReceiver();
  const desk = {};
  assert.deepEqual(talent.adopt(desk), []);          // the link: nothing yet
  put(desk, press(op, 'resume'));
  const first = talent.adopt(desk);
  assert.equal(first.length, 1);
  assert.equal(first[0].action, 'resume');
  assert.deepEqual(talent.adopt(desk), []);          // same document again (a heartbeat write)
  assert.deepEqual(talent.adopt(desk), []);
});

test('missed presses do not matter: the newest record is the truth', () => {
  const op = D.createSender({ writer: 'opA' });
  const talent = D.createReceiver();
  const desk = {};
  talent.adopt(desk);
  put(desk, press(op, 'resume'));
  put(desk, press(op, 'pause'));
  put(desk, press(op, 'resume'));
  put(desk, press(op, 'pause'));                    // the talent slept through three
  const got = talent.adopt(desk);
  assert.deepEqual(got.map(g => g.action), ['pause']);
});

test('two operators never push each other out', () => {
  const live = D.createSender({ writer: 'live' });
  const remote = D.createSender({ writer: 'remote' });
  const talent = D.createReceiver();
  const desk = {};
  talent.adopt(desk);
  put(desk, press(remote, 'speed_set_90'));
  put(desk, press(live, 'slate_tech_on'));
  put(desk, press(remote, 'resume'));
  put(desk, press(live, 'size_set_64'));
  const got = talent.adopt(desk).map(g => g.action);
  assert.deepEqual(got, ['speed_set_90', 'slate_tech_on', 'resume', 'size_set_64']);   // all four, in order
});

test('a seek then a play in one breath both arrive, seek first', () => {
  const op = D.createSender({ writer: 'opA' });
  const talent = D.createReceiver();
  const desk = {};
  talent.adopt(desk);
  put(desk, press(op, 'seek_row_4', { payload: { hold: true } }));
  put(desk, press(op, 'resume'));
  const got = talent.adopt(desk);
  assert.deepEqual(got.map(g => g.action), ['seek_row_4', 'resume']);
  assert.deepEqual(got[0].payload, { hold: true });
});

test('scrolling adds up even when updates are skipped', () => {
  const op = D.createSender({ writer: 'opA' });
  const talent = D.createReceiver();
  const desk = {};
  talent.adopt(desk);
  put(desk, press(op, 'seek_line_2'));
  assert.deepEqual(talent.adopt(desk).map(g => g.action), ['seek_line_2']);
  put(desk, press(op, 'seek_line_3'));              // skipped
  put(desk, press(op, 'seek_line_3'));              // skipped
  put(desk, press(op, 'seek_line_-1'));
  assert.deepEqual(talent.adopt(desk).map(g => g.action), ['seek_line_5']);   // 3 + 3 - 1
  assert.equal(op.nudgeTotal(), 7);
});

test('the same scroll seen in this browser and in the cloud moves once', () => {
  const op = D.createSender({ writer: 'opA' });
  const talent = D.createReceiver();
  const desk = {};
  talent.adopt(desk);
  const a = press(op, 'seek_line_4');
  assert.equal(talent.offer(a.family, a.record).action, 'seek_line_4');       // direct, same browser
  put(desk, a);
  assert.deepEqual(talent.adopt(desk), []);                                   // the cloud copy
  const b = press(op, 'seek_line_2');
  put(desk, b);
  assert.deepEqual(talent.adopt(desk).map(g => g.action), ['seek_line_2']);   // cloud first this time
  assert.equal(talent.offer(b.family, b.record), null);
});

test('a second hand on the wheel moves by its own latest step only', () => {
  const a = D.createSender({ writer: 'opA' });
  const b = D.createSender({ writer: 'opB' });
  const talent = D.createReceiver();
  const desk = {};
  talent.adopt(desk);
  for (let i = 0; i < 20; i++) press(b, 'seek_line_5');   // opB scrolled 100 lines on some other day
  put(desk, press(a, 'seek_line_1'));
  talent.adopt(desk);
  put(desk, press(b, 'seek_line_2'));
  assert.deepEqual(talent.adopt(desk).map(g => g.action), ['seek_line_2']);   // not 102
});

test('a talent that just linked replays the look, never the roll', () => {
  const op = D.createSender({ writer: 'opA' });
  const desk = {};
  const now = 5000;
  put(desk, press(op, 'resume'));
  put(desk, press(op, 'seek_row_7'));
  put(desk, press(op, 'seek_line_40'));
  put(desk, press(op, 'speed_set_150'));
  put(desk, press(op, 'slate_tech_on'));
  put(desk, press(op, 'clock_timeofday'));
  put(desk, press(op, 'question_on', { payload: { text: 'Who won?' } }));
  const talent = D.createReceiver();
  const got = talent.adopt(desk, now).map(g => g.action);
  assert.deepEqual(got, ['slate_tech_on', 'clock_timeofday', 'question_on']);
  // And the roll records are remembered as seen, so nothing fires late.
  assert.deepEqual(talent.adopt(desk, now), []);
  // A scroll after the link moves only by what is new.
  put(desk, press(op, 'seek_line_2'));
  assert.deepEqual(talent.adopt(desk, now).map(g => g.action), ['seek_line_2']);
  // A play pressed after the link does start the roll.
  put(desk, press(op, 'resume'));
  assert.deepEqual(talent.adopt(desk, now).map(g => g.action), ['resume']);
});

test('a slate left on from last week does not come up on a new link', () => {
  const op = D.createSender({ writer: 'opA' });
  const desk = {};
  put(desk, op.stamp({ id: 'old', action: 'slate_tech_on', at: 1000 }));
  const talent = D.createReceiver();
  const weekLater = 1000 + 7 * 24 * 3600 * 1000;
  assert.deepEqual(talent.adopt(desk, weekLater), []);
});

test('a slate then a clear replays in the order they were pressed', () => {
  const op = D.createSender({ writer: 'opA' });
  const desk = {};
  put(desk, press(op, 'overlays_clear'));
  put(desk, press(op, 'slate_bars_on'));
  const talent = D.createReceiver();
  assert.deepEqual(talent.adopt(desk, 2000).map(g => g.action), ['overlays_clear', 'slate_bars_on']);
});

test('a direct press before the first cloud copy does not turn the link into a replay', () => {
  const op = D.createSender({ writer: 'opA' });
  const desk = {};
  put(desk, op.stamp({ id: 'stale-play', action: 'resume', at: 10 }));
  const talent = D.createReceiver();
  const direct = press(op, 'size_set_60');
  assert.equal(talent.offer(direct.family, direct.record).action, 'size_set_60');
  put(desk, direct);
  assert.deepEqual(talent.adopt(desk, 2000), []);   // the stale play stays put
});

test('junk in the document is ignored', () => {
  const talent = D.createReceiver();
  assert.deepEqual(talent.adopt(null), []);
  assert.deepEqual(talent.adopt({ play: null, speed: 'fast', seek: { id: '', action: 'reset' } }), []);
  assert.equal(talent.offer('play', { id: 'x' }), null);
});

console.log('prompter-desk: all passed');
