import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const LiveSession = require('../../cueola-live-session.js');

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

test('uses the approved lifecycle vocabulary and starts with dispatch frozen', () => {
  assert.deepEqual(Array.from(LiveSession.LIFECYCLE_STATES), [
    'builder', 'entering-live', 'live', 'leaving-live', 'recovering', 'live-error'
  ]);
  const controller = LiveSession.createController();
  assert.equal(controller.getState().lifecycle, 'builder');
  assert.equal(controller.canDispatch(), false);
  assert.equal(controller.getExitSnapshot(), null);
});

test('entry skips segment markers and has one coordinated transition', () => {
  const seen = [];
  let dispatchDuringEntry = null;
  const controller = LiveSession.createController({
    onStateChange: state => seen.push(state.lifecycle),
    onEnter: () => { dispatchDuringEntry = controller.canDispatch(); },
  });
  controller.enter({ cues:[{ style:'segment' }, { style:'timed' }], selectedCueIndex:0 });
  const state = controller.getState();
  assert.equal(state.lifecycle, 'live');
  assert.equal(state.activeCueIndex, 1);
  assert.equal(state.selectedCueIndex, 1);
  assert.ok(seen.includes('entering-live'));
  assert.equal(dispatchDuringEntry, false);
  assert.equal(controller.canDispatch(), true);
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

test('builds a stable-keyed execution ledger and keeps selection orthogonal', () => {
  assert.deepEqual(Array.from(LiveSession.RUN_EXECUTION_STATES), [
    'upcoming', 'completed', 'skipped', 'failed', 'disabled'
  ]);
  const controller = LiveSession.createController();
  controller.enter({
    cues:[
      { id:'open', style:'timed' },
      { id:'intro', style:'timed' },
      { id:'chapter', style:'segment' },
      { rowKey:'close', style:'timed' },
    ],
    selectedCueIndex:0,
  });
  controller.setSelectedCue(1, { reason:'browse-ahead' });

  const state = controller.getState();
  assert.deepEqual(Array.from(state.runOrder), ['open', 'intro', 'chapter', 'close']);
  assert.equal(state.activeCueKey, 'open');
  assert.equal(state.selectedCueKey, 'intro');
  assert.equal(state.runLedger.open.status, 'upcoming');
  assert.equal(state.runLedger.chapter.status, 'disabled');
  assert.equal(state.runLedger.close.status, 'upcoming');
  assert.equal(state.runRevision, 1);
});

test('forward activation completes the prior cue and skips eligible bypassed cues', () => {
  const controller = LiveSession.createController();
  controller.enter({
    cues:[
      { id:'a', style:'timed' },
      { id:'b', style:'timed' },
      { id:'marker', style:'segment' },
      { id:'d', style:'timed' },
    ],
    selectedCueIndex:0,
  });
  controller.setSelectedCue(1, { reason:'operator-preview' });
  controller.setActiveCue(3, { select:false, reason:'operator-go' });

  const state = controller.getState();
  assert.equal(state.activeCueKey, 'd');
  assert.equal(state.selectedCueKey, 'b');
  assert.equal(state.runLedger.a.status, 'completed');
  assert.equal(state.runLedger.b.status, 'skipped');
  assert.equal(state.runLedger.marker.status, 'disabled');
  assert.equal(state.runLedger.d.status, 'upcoming');
  assert.match(state.runLedger.a.lastReason, /completed-previous/);
  assert.match(state.runLedger.b.lastReason, /skipped-bypass/);
});

test('backward activation preserves terminal history and disabled rows reject activation', () => {
  const controller = LiveSession.createController();
  controller.enter({
    cues:[
      { id:'a', style:'timed' },
      { id:'b', style:'timed' },
      { id:'marker', disabled:true },
      { id:'d', style:'timed' },
    ],
    selectedCueIndex:0,
  });
  controller.setActiveCue(3, { reason:'jump-forward' });
  const beforeBack = controller.getState().runLedger;
  controller.setActiveCue(1, { reason:'rehearse-back' });
  const afterBack = controller.getState().runLedger;

  assert.equal(afterBack.a.status, 'completed');
  assert.equal(afterBack.b.status, 'skipped');
  assert.equal(afterBack.marker.status, 'disabled');
  assert.equal(afterBack.d.status, 'upcoming');
  assert.equal(afterBack.a.revision, beforeBack.a.revision);
  assert.equal(afterBack.b.revision, beforeBack.b.revision);
  assert.equal(afterBack.d.revision, beforeBack.d.revision);
  assert.throws(() => controller.setActiveCue(2), /disabled cue cannot become active/i);
  assert.equal(controller.getState().activeCueKey, 'b');
});

test('records failure and requires an explicit recovery before execution continues', () => {
  const controller = LiveSession.createController();
  controller.enter({
    cues:[{ id:'a' }, { id:'b' }, { id:'c' }],
    selectedCueIndex:0,
  });
  controller.setActiveCue(1, { reason:'next' });
  const failed = controller.recordCueFailure('b', new Error('decoder offline'), { reason:'playout-failed' });
  assert.equal(failed.status, 'failed');
  assert.equal(failed.failure, 'decoder offline');
  assert.equal(failed.lastFailure, 'decoder offline');
  assert.equal(failed.failureCount, 1);
  assert.throws(() => controller.completeCue('b'), /recover a failed cue explicitly/i);

  const recovered = controller.recoverCueFailure('b', { reason:'decoder-reloaded' });
  assert.equal(recovered.status, 'upcoming');
  assert.equal(recovered.failure, null);
  assert.equal(recovered.lastFailure, 'decoder offline');
  assert.equal(recovered.recoveryCount, 1);
  controller.setActiveCue(2, { reason:'resume-run' });
  assert.equal(controller.getCueExecution('b').status, 'completed');
  assert.throws(() => controller.skipCue('b'), /terminal cue history cannot be rewritten/i);
});

test('disabling and enabling a cue are explicit and cannot disable the active cue', () => {
  const controller = LiveSession.createController();
  controller.enter({ cues:[{ id:'a' }, { id:'b' }], selectedCueIndex:0 });
  assert.throws(() => controller.setCueDisabled('a', true), /active cue cannot be disabled/i);
  assert.equal(controller.setCueDisabled('b', true).status, 'disabled');
  assert.throws(() => controller.setActiveCue(1), /disabled cue cannot become active/i);
  assert.equal(controller.setCueDisabled('b', false).status, 'upcoming');
  controller.setActiveCue(1, { reason:'enabled-go' });
  assert.equal(controller.getState().activeCueKey, 'b');
});

test('stable row keys preserve history and active identity across rundown reordering', () => {
  const controller = LiveSession.createController();
  controller.enter({ cues:[{ id:'a' }, { id:'b' }], selectedCueIndex:0 });
  controller.setActiveCue(1, { reason:'next' });
  controller.configureRunRows([{ id:'b' }, { id:'a' }], { preserve:true });

  const reordered = controller.getState();
  assert.deepEqual(Array.from(reordered.runOrder), ['b', 'a']);
  assert.equal(reordered.activeCueIndex, 0);
  assert.equal(reordered.activeCueKey, 'b');
  assert.equal(reordered.runLedger.a.index, 1);
  assert.equal(reordered.runLedger.a.status, 'completed');
  assert.throws(
    () => controller.configureRunRows([{ id:'duplicate' }, { id:'duplicate' }]),
    /duplicate live row key/i
  );
});

test('explicit caller row keys support anonymous rows without index-owned history', () => {
  const controller = LiveSession.createController();
  controller.enter({
    cues:[{ style:'timed' }, { style:'timed' }],
    rowKeys:['beat-101', 'beat-205'],
    selectedCueIndex:0,
  });
  controller.setActiveCue(1, { reason:'next' });
  assert.equal(controller.getCueExecution({ rowKey:'beat-101' }).status, 'completed');
  assert.equal(controller.getCueExecution({ index:1 }).key, 'beat-205');
});

test('an authoritative active index can be staged before rundown rows arrive', () => {
  const controller = LiveSession.createController();
  assert.doesNotThrow(() => controller.setActiveCue(2, { select:false, reason:'remote-before-load' }));
  assert.equal(controller.getState().activeCueIndex, 2);
  controller.enter({
    cues:[{ id:'a' }, { id:'b' }, { id:'c' }],
    selectedCueIndex:0,
    activeCueIndex:controller.getState().activeCueIndex,
  });
  assert.equal(controller.getState().activeCueKey, 'c');
  assert.equal(controller.getState().runLedger.a.status, 'upcoming');
  assert.equal(controller.getState().runLedger.b.status, 'upcoming');
});

test('run and exit snapshots preserve a detached deeply immutable ledger', () => {
  const controller = LiveSession.createController();
  controller.enter({ cues:[{ id:'a' }, { id:'b' }], selectedCueIndex:0 });
  controller.setActiveCue(1, { reason:'next' });
  const prepared = controller.prepareLeave({ reason:'operator-exit' });
  const exit = prepared.exitSnapshot;

  assert.ok(Object.isFrozen(prepared.runOrder));
  assert.ok(Object.isFrozen(prepared.runLedger));
  assert.ok(Object.isFrozen(prepared.runLedger.a));
  assert.ok(Object.isFrozen(exit.runOrder));
  assert.ok(Object.isFrozen(exit.runLedger));
  assert.ok(Object.isFrozen(exit.runLedger.a));
  assert.throws(() => { prepared.runLedger.a.status = 'upcoming'; }, TypeError);
  assert.throws(() => { exit.runOrder.push('intruder'); }, TypeError);

  controller.setCueExecution('b', 'failed', { error:'late failure', reason:'late-projection' });
  assert.equal(controller.getState().runLedger.b.status, 'failed');
  assert.equal(exit.runLedger.b.status, 'upcoming');
  assert.equal(exit.runLedger.a.status, 'completed');
  assert.equal(controller.getExitSnapshot(), exit);
});

test('prepare freezes dispatch and captures one deeply immutable exit snapshot', () => {
  const controller = LiveSession.createController();
  controller.enter({ cues:[{ style:'timed' }, { style:'timed' }], selectedCueIndex:0 });
  controller.setSelectedCue(1, { reason:'browse-ahead' });
  controller.setSubsystemStatus('prompter', 'active', 'Talent scrolling');
  const prepared = controller.prepareLeave({ reason:'operator-request' });
  const exit = prepared.exitSnapshot;

  assert.equal(prepared.lifecycle, 'leaving-live');
  assert.equal(controller.canDispatch(), false);
  assert.equal(exit.lifecycle, 'live');
  assert.equal(exit.activeCueIndex, 0);
  assert.equal(exit.selectedCueIndex, 1);
  assert.equal(exit.subsystems.prompter.status, 'active');
  assert.ok(exit.requestedAt > 0);
  assert.ok(Object.isFrozen(exit));
  assert.ok(Object.isFrozen(exit.subsystems));
  assert.ok(Object.isFrozen(exit.subsystems.prompter));

  controller.setActiveCue(1, { reason:'late-state-projection' });
  controller.setSubsystemStatus('prompter', 'paused', 'Talent paused');
  assert.equal(exit.activeCueIndex, 0);
  assert.equal(exit.subsystems.prompter.status, 'active');
  assert.equal(controller.getExitSnapshot(), exit);
  assert.equal(controller.prepareLeave({ reason:'duplicate-request' }).exitSnapshot, exit);
});

test('cancel restores live dispatch without running cleanup', () => {
  let cleaned = 0;
  const controller = LiveSession.createController();
  controller.enter({ cues:[{ style:'timed' }], selectedCueIndex:0 });
  controller.registerCleanup('keyboard', () => { cleaned += 1; });
  controller.prepareLeave({ reason:'operator-request' });
  const cancelled = controller.cancelLeave({ reason:'operator-cancelled' });

  assert.equal(cancelled.lifecycle, 'live');
  assert.equal(cancelled.exitSnapshot, null);
  assert.equal(controller.getExitSnapshot(), null);
  assert.equal(controller.canDispatch(), true);
  assert.equal(cleaned, 0);

  controller.leave({ reason:'final-leave' });
  assert.equal(cleaned, 1);
});

test('commit merges exit context, cleans once in reverse order, and retains the snapshot', () => {
  const calls = [];
  const controller = LiveSession.createController({
    onLeave:(state, context) => calls.push(['leave', state.lifecycle, context.source, context.outputPolicy]),
  });
  controller.enter({ cues:[{ style:'timed' }], selectedCueIndex:0 });
  controller.registerCleanup('first', (reason, context) => calls.push(['first', reason, context.outputPolicy]));
  controller.registerCleanup('second', (reason, context) => calls.push(['second', reason, context.outputPolicy]));
  const exit = controller.prepareLeave({ reason:'operator-leave', source:'toolbar' }).exitSnapshot;
  const committed = controller.commitLeave({ outputPolicy:'stop' });

  assert.equal(committed.lifecycle, 'builder');
  assert.equal(committed.exitSnapshot, exit);
  assert.equal(controller.getExitSnapshot(), exit);
  assert.equal(controller.canDispatch(), false);
  assert.deepEqual(calls, [
    ['leave', 'leaving-live', 'toolbar', 'stop'],
    ['second', 'operator-leave', 'stop'],
    ['first', 'operator-leave', 'stop'],
  ]);

  controller.commitLeave({ outputPolicy:'stop' });
  controller.leave({ reason:'duplicate-leave' });
  assert.equal(calls.length, 3);
});

test('keyed cleanup replacement cannot be removed by a stale unregister function', () => {
  const cleaned = [];
  const controller = LiveSession.createController();
  const unregisterOld = controller.registerCleanup('keyboard', () => cleaned.push('old'));
  controller.registerCleanup('keyboard', () => cleaned.push('current'));
  unregisterOld();
  controller.cleanup('test-cleanup');
  controller.cleanup('duplicate-cleanup');
  assert.deepEqual(cleaned, ['current']);
});

test('ten enter/leave cycles never multiply simulated Live listeners', () => {
  const listeners = new Set();
  let enters = 0;
  let leaves = 0;
  let cleanupCalls = 0;
  let controller;
  controller = LiveSession.createController({
    onEnter:() => {
      enters += 1;
      for (const name of ['keydown', 'pointerdown']) {
        assert.equal(listeners.has(name), false, `${name} installed twice`);
        listeners.add(name);
        controller.registerCleanup(`listener:${name}`, () => {
          cleanupCalls += 1;
          listeners.delete(name);
        });
      }
    },
    onLeave:() => { leaves += 1; },
  });

  for (let cycle = 0; cycle < 10; cycle += 1) {
    controller.enter({ cues:[{ style:'timed' }], selectedCueIndex:0 });
    controller.enter({ cues:[{ style:'timed' }], selectedCueIndex:0 });
    assert.equal(listeners.size, 2);
    controller.leave({ reason:`cycle-${cycle}` });
    controller.leave({ reason:`cycle-${cycle}-duplicate` });
    assert.equal(listeners.size, 0);
    assert.equal(controller.getState().lifecycle, 'builder');
  }

  assert.equal(enters, 10);
  assert.equal(leaves, 10);
  assert.equal(cleanupCalls, 20);
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
  assert.equal(controller.getState().lifecycle, 'live-error');
  assert.equal(controller.canDispatch(), false);
});

test('leave errors run every cleanup, freeze dispatch, and remain recoverable', () => {
  const reports = [];
  const cleaned = [];
  const controller = LiveSession.createController({
    onLeave:() => { throw new Error('navigation failed'); },
    onError:(label, error) => reports.push([label, error.message]),
  });
  controller.enter({ cues:[{ style:'timed' }, { style:'timed' }], selectedCueIndex:1 });
  controller.setSubsystemStatus('playback', 'active', 'Media playing');
  controller.registerCleanup('survivor', () => cleaned.push('survivor'));
  controller.registerCleanup('broken', () => { cleaned.push('broken'); throw new Error('cleanup failed'); });
  const exit = controller.prepareLeave({ reason:'operator-leave' }).exitSnapshot;

  assert.throws(() => controller.commitLeave({ outputPolicy:'stop' }), /navigation failed/);
  assert.deepEqual(cleaned, ['broken', 'survivor']);
  assert.equal(controller.getState().lifecycle, 'live-error');
  assert.equal(controller.getState().exitSnapshot, exit);
  assert.equal(controller.canDispatch(), false);
  assert.ok(reports.some(([label]) => label === 'Live leave failed'));
  assert.ok(reports.some(([label]) => label === 'Live cleanup failed: broken'));

  const recovered = controller.recoverToBuilder({ reason:'emergency-reset' });
  assert.equal(recovered.lifecycle, 'builder');
  assert.equal(recovered.activeCueIndex, 1);
  assert.equal(recovered.selectedCueIndex, 1);
  assert.equal(recovered.exitSnapshot, exit);
  assert.equal(recovered.subsystems.playback.status, 'closed');
  assert.equal(controller.canDispatch(), false);
  assert.deepEqual(cleaned, ['broken', 'survivor']);
  assert.ok(reports.some(([label]) => label === 'Live recovery navigation failed'));
});

test('a cleanup-only leave failure enters live-error and exposes the cleanup error', () => {
  const controller = LiveSession.createController({ onError:() => {} });
  controller.enter({ cues:[{ style:'timed' }], selectedCueIndex:0 });
  controller.registerCleanup('broken', () => { throw new Error('cleanup alone failed'); });
  controller.prepareLeave({ reason:'operator-leave' });

  assert.throws(() => controller.commitLeave(), /cleanup alone failed/);
  assert.equal(controller.getState().lifecycle, 'live-error');
  assert.match(controller.getState().error, /cleanup alone failed/);
  assert.equal(controller.canDispatch(), false);
});

test('emergency recovery tolerates cleanup errors and always reaches builder', () => {
  const seen = [];
  const reports = [];
  const controller = LiveSession.createController({
    onStateChange:state => seen.push(state.lifecycle),
    onError:(label, error) => reports.push([label, error.message]),
  });
  controller.enter({ cues:[{ style:'timed' }], selectedCueIndex:0 });
  controller.registerCleanup('first', () => { throw new Error('first failed'); });
  controller.registerCleanup('second', () => {});

  const recovered = controller.recoverToBuilder({ reason:'operator-emergency' });
  assert.equal(recovered.lifecycle, 'builder');
  assert.ok(seen.includes('recovering'));
  assert.ok(recovered.exitSnapshot);
  assert.equal(recovered.exitSnapshot.activeCueIndex, 0);
  assert.equal(controller.canDispatch(), false);
  assert.ok(reports.some(([label]) => label === 'Live cleanup failed: first'));

  assert.doesNotThrow(() => controller.recoverToBuilder({ reason:'duplicate-emergency' }));
  assert.equal(controller.getState().lifecycle, 'builder');
});

for (const { name, fn } of tests) {
  await fn();
  console.log('PASS', name);
}
console.log(`PASS ${tests.length} Live-session controller tests`);
