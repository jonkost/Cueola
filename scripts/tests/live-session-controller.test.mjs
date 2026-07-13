import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const LiveSession = require('../../cueola-live-session.js');

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

test('entry skips segment markers and has one coordinated transition', () => {
  const seen = [];
  const controller = LiveSession.createController({
    onStateChange: state => seen.push(state.lifecycle),
  });
  controller.enter({ cues:[{ style:'segment' }, { style:'timed' }], selectedCueIndex:0 });
  const state = controller.getState();
  assert.equal(state.lifecycle, 'live');
  assert.equal(state.activeCueIndex, 1);
  assert.equal(state.selectedCueIndex, 1);
  assert.ok(seen.includes('entering'));
});

test('active and selected cues are independent', () => {
  const controller = LiveSession.createController();
  controller.enter({ cues:[{ style:'timed' }, { style:'timed' }], selectedCueIndex:0 });
  controller.setSelectedCue(1, { reason:'followed-cue' });
  assert.equal(controller.getState().activeCueIndex, 0);
  assert.equal(controller.getState().selectedCueIndex, 1);
  controller.setActiveCue(1, { select:false, reason:'remote-active' });
  assert.equal(controller.getState().activeCueIndex, 1);
  assert.equal(controller.getState().selectedCueIndex, 1);
});

test('repeated entry is idempotent and cleanup runs once in reverse order', () => {
  let enters = 0;
  const cleaned = [];
  const controller = LiveSession.createController({ onEnter:() => { enters += 1; } });
  controller.enter({ cues:[{ style:'timed' }], selectedCueIndex:0 });
  controller.registerCleanup('first', () => cleaned.push('first'));
  controller.registerCleanup('second', () => cleaned.push('second'));
  controller.enter({ cues:[{ style:'timed' }], selectedCueIndex:0 });
  controller.leave({ reason:'test-leave' });
  controller.leave({ reason:'test-leave-again' });
  assert.equal(enters, 1);
  assert.deepEqual(cleaned, ['second', 'first']);
  assert.equal(controller.getState().lifecycle, 'build');
});

test('subsystem status is one validated value', () => {
  const controller = LiveSession.createController();
  controller.setSubsystemStatus('prompter', 'connecting', 'waiting for talent');
  controller.setSubsystemStatus('prompter', 'active', 'talent heartbeat');
  assert.deepEqual(
    { status:controller.getState().subsystems.prompter.status, detail:controller.getState().subsystems.prompter.detail },
    { status:'active', detail:'talent heartbeat' }
  );
  assert.throws(() => controller.setSubsystemStatus('prompter', 'alive'), /Unknown subsystem status/);
});

test('entry failure cleans resources and exposes an error lifecycle', () => {
  let cleaned = 0;
  const controller = LiveSession.createController({
    onEnter:() => {
      controller.registerCleanup('resource', () => { cleaned += 1; });
      throw new Error('entry failed');
    },
    onError:() => {},
  });
  assert.throws(() => controller.enter({ cues:[{ style:'timed' }], selectedCueIndex:0 }), /entry failed/);
  assert.equal(cleaned, 1);
  assert.equal(controller.getState().lifecycle, 'error');
});

for (const { name, fn } of tests) {
  await fn();
  console.log('PASS', name);
}
console.log(`PASS ${tests.length} Live-session controller tests`);
