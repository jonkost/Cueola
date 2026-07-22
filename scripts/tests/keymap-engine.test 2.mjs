import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Keymap = require('../../cueola-keymap.js');

function test(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

const key = (k, mods = {}) => ({ key: k, altKey: false, ctrlKey: false, metaKey: false, shiftKey: false, ...mods });

test('binding grammar: letters, punctuation, Space, and modifiers', () => {
  assert.equal(Keymap.matches(key('g'), 'G'), true);
  assert.equal(Keymap.matches(key('G', { shiftKey: true }), 'G'), false);   // exact shift requirement on letters
  assert.equal(Keymap.matches(key('S', { shiftKey: true }), 'Shift+S'), true);
  assert.equal(Keymap.matches(key(' '), 'Space'), true);
  assert.equal(Keymap.matches(key('?', { shiftKey: true }), '?'), true);    // layouts that need Shift still work
  assert.equal(Keymap.matches(key('ArrowUp', { altKey: true }), 'Alt+ArrowUp'), true);
  assert.equal(Keymap.matches(key('ArrowUp'), 'Alt+ArrowUp'), false);
  assert.equal(Keymap.matches(key('g', { ctrlKey: true }), 'G'), false);    // never swallow browser chords
  assert.equal(Keymap.matches(key('g', { metaKey: true }), 'G'), false);
});

test('overrides come from storage per action id, defaults otherwise', () => {
  const action = { id: 'playout.go', keys: ['G'] };
  const storage = { getItem: () => JSON.stringify({ 'playout.go': ['F13'] }) };
  assert.deepEqual(Keymap.effectiveBindings(action, storage), ['F13']);
  assert.deepEqual(Keymap.effectiveBindings(action, { getItem: () => 'not-json{' }), ['G']);
  assert.deepEqual(Keymap.effectiveBindings(action, { getItem: () => null }), ['G']);
});

test('hold tracker: down once, up sends stop, repeats ignored', () => {
  const sent = [];
  const holds = Keymap.createHoldTracker(a => sent.push(a));
  const brake = { id: 'brake', keys: ['J'], hold: ['brake_start', 'brake_stop'] };
  holds.down(brake, { repeat: false });
  holds.down(brake, { repeat: true });    // key-repeat must not restart the hold
  holds.down(brake, { repeat: false });   // still held — no second start
  assert.deepEqual(sent, ['brake_start']);
  holds.up(brake);
  assert.deepEqual(sent, ['brake_start', 'brake_stop']);
  assert.equal(holds.up(brake), false);   // already released
});

test('blur safety: releaseAll sends every held stop', () => {
  const sent = [];
  const holds = Keymap.createHoldTracker(a => sent.push(a));
  holds.down({ id: 'brake', hold: ['brake_start', 'brake_stop'] }, {});
  holds.down({ id: 'boost', hold: ['boost_start', 'boost_stop'] }, {});
  holds.releaseAll();
  assert.deepEqual(sent.sort(), ['boost_start', 'boost_stop', 'brake_start', 'brake_stop'].sort());
  assert.equal(holds.size(), 0);
});

test('upByEvent releases only the matching held action (text-field keyup path)', () => {
  const sent = [];
  const holds = Keymap.createHoldTracker(a => sent.push(a));
  const actions = [
    { id: 'brake', keys: ['J'], hold: ['brake_start', 'brake_stop'] },
    { id: 'boost', keys: ['L'], hold: ['boost_start', 'boost_stop'] },
  ];
  actions.forEach(a => holds.down(a, {}));
  const storage = { getItem: () => null };
  holds.upByEvent(actions, key('j'), storage);
  assert.deepEqual(sent, ['brake_start', 'boost_start', 'brake_stop']);
  assert.equal(holds.has('boost'), true);
});

test('reference HTML is generated from the table and escapes content', () => {
  const actions = [
    { id: 'a', scope: 'scriptop', group: 'Prompter', keys: ['J'], label: 'Brake <hold>' },
    { id: 'b', scope: 'other', group: 'X', keys: ['Z'], label: 'not in scope' },
  ];
  const sections = Keymap.sectionsForScope(actions, 'scriptop', { getItem: () => null });
  assert.equal(sections.length, 1);
  const html = Keymap.referenceHTML({ title: 'T & T', sections });
  assert.match(html, /Brake &lt;hold&gt;/);
  assert.match(html, /T &amp; T/);
  assert.doesNotMatch(html, /not in scope/);
});

console.log('keymap-engine: all tests passed');
