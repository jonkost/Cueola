import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const C = require('../../cueola-prompter-controls.js');
const D = require('../../cueola-prompter-desk.js');

function test(name, fn) {
  try { fn(); console.log(`PASS ${name}`); }
  catch (error) { console.error(`FAIL ${name}`); throw error; }
}

test('fifteen controls, three groups of five, in deck order', () => {
  assert.equal(C.CONTROLS.length, 15);
  C.GROUPS.forEach(g => assert.equal(C.CONTROLS.filter(c => c.group === g).length, 5));
  assert.deepEqual(C.IDS, ['prev', 'back', 'play', 'ahead', 'next', 'top', 'follow', 'slower', 'speed', 'faster', 'clock', 'slate', 'message', 'wrap', 'clear']);
});

test('no two controls share a keyboard key', () => {
  const seen = new Map();
  C.CONTROLS.forEach(c => c.codes.forEach(k => {
    assert.ok(!seen.has(k), `${k} is on ${seen.get(k)} and ${c.id}`);
    seen.set(k, c.id);
  }));
});

test('Play reads Pause while the talent is rolling', () => {
  assert.equal(C.face('play', { playing: false }).label, 'Play');
  const f = C.face('play', { playing: true });
  assert.equal(f.label, 'Pause');
  assert.equal(f.symbol, 'pt.pause');
  assert.ok(f.rolling);
  assert.deepEqual(C.press('play', { playing: false }), [{ action: 'resume' }]);
  assert.deepEqual(C.press('play', { playing: true }), [{ action: 'pause' }]);
});

test('speed steps by 5 from what the talent reported, and stays in range', () => {
  assert.deepEqual(C.press('faster', { speed: 60 }), [{ action: 'speed_set_65' }]);
  assert.deepEqual(C.press('slower', { speed: 60 }), [{ action: 'speed_set_55' }]);
  assert.deepEqual(C.press('faster', { speed: 200 }), [{ action: 'speed_set_200' }]);
  assert.deepEqual(C.press('slower', { speed: 5 }), [{ action: 'speed_set_5' }]);
  assert.equal(C.face('speed', { speed: 65 }).value, '65');
  assert.deepEqual(C.press('speed', {}), []);
});

test('Back and Ahead are holds: down starts, up lets go', () => {
  assert.deepEqual(C.press('back', {}, 'down'), [{ action: 'hold_back' }]);
  assert.deepEqual(C.press('back', {}, 'up'), [{ action: 'hold_off' }]);
  assert.deepEqual(C.press('ahead', {}), [{ action: 'hold_ahead' }]);
  assert.deepEqual(C.press('ahead', {}, 'up'), [{ action: 'hold_off' }]);
  assert.ok(C.face('back', { hold: 'back' }).held);
  assert.ok(!C.face('ahead', { hold: 'back' }).held);
  // Letting go of any other control sends nothing.
  assert.deepEqual(C.press('play', {}, 'up'), []);
});

test('on-screen controls toggle from what the talent shows', () => {
  assert.deepEqual(C.press('clock', { clock: false }), [{ action: 'clock_timeofday' }]);
  assert.deepEqual(C.press('clock', { clock: true }), [{ action: 'clock_off' }]);
  assert.deepEqual(C.press('slate', { slate: false }), [{ action: 'slate_standby_on' }]);
  assert.deepEqual(C.press('slate', { slate: true }), [{ action: 'slate_standby_off' }]);
  assert.deepEqual(C.press('wrap', { wrap: false }), [{ action: 'wrapup_120' }]);
  assert.deepEqual(C.press('wrap', { wrap: true }), [{ action: 'clock_off' }]);
  assert.deepEqual(C.press('message', { message: false }), [{ ui: 'message' }]);
  assert.deepEqual(C.press('message', { message: true }), [{ action: 'question_off' }]);
  assert.deepEqual(C.press('clear', {}), [{ action: 'overlays_clear' }]);
  assert.equal(C.face('clock', { clock: true }).lit, 'air');
  assert.equal(C.face('clock', { clock: false }).lit, '');
});

test('Follow is lit when on, and the press flips it', () => {
  assert.equal(C.face('follow', { follow: true }).lit, 'on');
  assert.equal(C.face('follow', { follow: false }).lit, '');
  assert.deepEqual(C.press('follow', { follow: true }), [{ action: 'follow_off' }]);
  assert.deepEqual(C.press('follow', { follow: false }), [{ action: 'follow_on' }]);
});

test('every action a control sends has a home on the desk', () => {
  const states = [{}, { playing: true, clock: true, slate: true, message: true, wrap: true, follow: false }];
  C.IDS.forEach(id => states.forEach(st => ['down', 'up'].forEach(how => {
    C.press(id, st, how).forEach(out => {
      if (out.ui) return;
      const family = D.familyOf(out.action);
      assert.ok(family && family !== 'other', `${id} sends ${out.action} with no family`);
    });
  })));
  assert.equal(D.familyOf('hold_back'), 'hold');
  assert.equal(D.familyOf('hold_off'), 'hold');
  assert.equal(D.familyOf('row_next'), 'seek');
  assert.equal(D.familyOf('follow_on'), 'follow');
  assert.equal(D.familyOf('slate_standby_on'), 'slate');
});

test('the keyboard reaches the same controls', () => {
  assert.equal(C.keyControl({ key: ' ' }), 'play');
  assert.equal(C.keyControl({ key: 'ArrowLeft' }), 'back');
  assert.equal(C.keyControl({ key: 'ArrowDown' }), 'next');
  assert.equal(C.keyControl({ key: ']' }), 'faster');
  assert.equal(C.keyControl({ key: 'Escape' }), 'clear');
  assert.equal(C.keyControl({ key: 'f' }), 'follow');
  assert.equal(C.keyControl({ key: 'f', metaKey: true }), '');
  assert.equal(C.keyControl({ key: 'q' }), '');
});

test('the talent report is read one way', () => {
  const s = C.stateFromTalent({ playing: true, speed: 72, clockState: { mode: 'wrap' }, questionOn: true, techSlateOn: false, follow: false });
  assert.deepEqual(s, { linked: true, playing: true, speed: 72, follow: false, hold: '', clock: false, slate: false, message: true, wrap: true });
  assert.equal(C.stateFromTalent({}, false).linked, false);
  assert.equal(C.stateFromTalent({ clockState: { mode: 'timeofday' } }).clock, true);
  assert.equal(C.stateFromTalent({ standbyOn: true }).slate, true);
});

test('the strip draws all fifteen once, dim when no talent is linked', () => {
  const html = C.stripHTML({ playing: true, speed: 65, clock: true });
  C.IDS.forEach(id => assert.equal(html.split(`data-ptc="${id}"`).length, 2, id));
  assert.ok(html.includes('is-rolling'));
  assert.ok(html.includes('>Pause<'));
  assert.ok(html.includes('>65<'));
  assert.ok(html.includes('is-air'));
  assert.ok(!html.includes('is-off'));
  assert.ok(C.stripHTML({ linked: false }).includes('is-off'));
  assert.ok(C.stripHTML({}, { size: 'compact' }).includes('ptc-compact'));
  assert.ok(!C.stripHTML({}, { captions: false }).includes('ptc-cap'));
});

test('smaller decks get the same controls in the same order', () => {
  assert.equal(C.deckLayout(15).length, 15);
  assert.equal(C.deckLayout(32).length, 15);
  assert.equal(C.deckLayout(8).length, 8);
  assert.equal(C.deckLayout(6).length, 6);
  C.deckLayout(8).concat(C.deckLayout(6)).forEach(id => assert.ok(C.get(id), id));
});
