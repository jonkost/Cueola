import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { PROTOCOL_VERSION, STATE_FIELDS, createController } = require('../../cueola-prompter-session.js');

function clock(start = 1000) {
  let value = start;
  return { now: () => value, tick: (amount = 1) => { value += amount; } };
}

function test(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

test('state is complete and JSON serializable', () => {
  const time = clock();
  const controller = createController({ now: time.now, instanceId: 'operator-A', productionCode: 'show1' });
  controller.setIdentity({ sessionId: 'session-1', scriptId: 'script-2', activeCueId: 'cue-3' });
  controller.setTransport({ running: true, position: 42, targetSpeed: 70, effectiveSpeed: 68, lastCommandId: 'cmd-1' });
  const state = JSON.parse(JSON.stringify(controller.getState()));
  assert.deepEqual(Object.keys(state), [...STATE_FIELDS]);
  assert.equal(state.productionCode, 'SHOW1');
  assert.equal(state.running, true);
  assert.equal(state.status, 'running');
});

test('ready snapshot applied handshake gates commands', () => {
  const time = clock();
  const operator = createController({ now: time.now, instanceId: 'operator', productionCode: 'STAB26' });
  const output = createController({ now: time.now, instanceId: 'output', productionCode: 'STAB26' });
  operator.setIdentity({ sessionId: 'live-1', scriptId: 'script-1', activeCueId: 'cue-1' });
  const ready = output.buildReady();
  assert.equal(operator.accepts(ready), true);
  operator.noteOutput(ready.outputInstanceId);
  const snapshot = operator.buildSnapshot({ outputInstanceId: ready.outputInstanceId });
  assert.equal(operator.isReady(), false);
  output.applySnapshot(snapshot.state, output.instanceId);
  const applied = output.buildStateApplied(snapshot.snapshotId);
  assert.equal(operator.markStateApplied(applied.outputInstanceId, applied.snapshotId, applied.state), true);
  assert.equal(operator.isReady(), true);
});

test('wrong production and stale output messages are rejected', () => {
  const controller = createController({ instanceId: 'operator', productionCode: 'A' });
  controller.setIdentity({ sessionId: 'session-A' });
  controller.noteOutput('output-new');
  assert.equal(controller.accepts({ protocolVersion: PROTOCOL_VERSION, productionCode: 'B', sessionId: 'session-A' }), false);
  assert.equal(controller.accepts({ protocolVersion: PROTOCOL_VERSION, productionCode: 'A', sessionId: 'session-old' }), false);
  assert.equal(controller.accepts({ protocolVersion: PROTOCOL_VERSION, productionCode: 'A', sessionId: 'session-A', outputInstanceId: 'output-old' }, { outputInstanceId: 'output-new' }), false);
});

test('new output instance invalidates old readiness', () => {
  const controller = createController({ instanceId: 'operator', productionCode: 'A' });
  controller.noteOutput('output-1');
  const first = controller.buildSnapshot({ outputInstanceId: 'output-1' });
  assert.equal(controller.markStateApplied('output-1', first.snapshotId, first.state), true);
  assert.equal(controller.isReady('output-1'), true);
  controller.noteOutput('output-2');
  assert.equal(controller.isReady('output-1'), false);
  assert.equal(controller.isReady('output-2'), false);
});

test('queued commands flush once after readiness', () => {
  const controller = createController({ instanceId: 'operator', productionCode: 'A' });
  controller.noteOutput('output-1');
  const snapshot = controller.buildSnapshot({ outputInstanceId: 'output-1' });
  const command = controller.buildCommand('resume');
  assert.equal(controller.queueCommand(command), true);
  assert.equal(controller.queueCommand(command), false);
  assert.deepEqual(controller.takeQueuedCommands('output-1'), []);
  controller.markStateApplied('output-1', snapshot.snapshotId, snapshot.state);
  assert.equal(controller.takeQueuedCommands('output-1').length, 1);
  assert.equal(controller.takeQueuedCommands('output-1').length, 0);
});

test('missed heartbeat invalidates readiness before recovery commands', () => {
  const controller = createController({ instanceId:'operator', productionCode:'A' });
  controller.noteOutput('output-1');
  const snapshot = controller.buildSnapshot({ outputInstanceId:'output-1' });
  controller.markStateApplied('output-1', snapshot.snapshotId, snapshot.state);
  assert.equal(controller.isReady('output-1'), true);
  controller.markDisconnected('output-1', 'missed heartbeats');
  assert.equal(controller.isReady('output-1'), false);
  assert.equal(controller.getState().status, 'recovering');
});

test('queued recovery commands retarget a replacement output after handshake', () => {
  const controller = createController({ instanceId:'operator', productionCode:'A' });
  controller.noteOutput('output-old');
  const firstSnapshot = controller.buildSnapshot({ outputInstanceId:'output-old' });
  controller.markStateApplied('output-old', firstSnapshot.snapshotId, firstSnapshot.state);
  controller.markDisconnected('output-old', 'missed heartbeats');
  const command = controller.buildCommand('resume');
  controller.queueCommand(command);
  controller.noteOutput('output-new');
  const recoverySnapshot = controller.buildSnapshot({ outputInstanceId:'output-new' });
  controller.markStateApplied('output-new', recoverySnapshot.snapshotId, recoverySnapshot.state);
  const queued = controller.takeQueuedCommands('output-new');
  assert.equal(queued.length, 1);
  assert.equal(queued[0].commandId, command.commandId);
  assert.equal(queued[0].outputInstanceId, 'output-new');
  assert.equal(queued[0].targetOutputInstanceId, 'output-new');
});

test('split-brain regression (TH2607 / 46e4fc8): rival sessions deadlock until the caller adopts', () => {
  const time = clock();
  const operator = createController({ now: time.now, instanceId: 'operator', productionCode: 'TH2607' });
  const talent = createController({ now: time.now, instanceId: 'talent-out', productionCode: 'TH2607' });
  operator.setIdentity({ sessionId: 'session-operator' });
  talent.setIdentity({ sessionId: 'session-rival' });   // re-seeded by a second surface
  // The deadlock: same production, different sessionIds — both sides drop
  // each other's messages forever while the talent looks "connected".
  const rivalHeartbeat = talent.buildHeartbeat();
  assert.equal(operator.accepts(rivalHeartbeat), false);
  // Recovery path: the show-calling surface ADOPTS the talent's session,
  // binds the output, and re-publishes its state into it.
  operator.setIdentity({ sessionId: rivalHeartbeat.sessionId });
  operator.noteOutput('talent-out', 'connected');
  const snapshot = operator.buildSnapshot({ outputInstanceId: 'talent-out' });
  assert.equal(talent.accepts(snapshot), true);          // sessionIds now match
  talent.applySnapshot(snapshot.state, 'talent-out');
  // The talent's next heartbeat echoes the operator's snapshotId → readiness
  // and queued commands converge through the normal path.
  const echo = talent.buildHeartbeat();
  assert.equal(operator.accepts(echo), true);
  assert.equal(operator.markStateApplied('talent-out', echo.snapshotId, echo.state), true);
  assert.equal(operator.isReady('talent-out'), true);
  const command = operator.buildCommand('seek_row_26');
  operator.queueCommand(command);
  assert.equal(operator.takeQueuedCommands('talent-out').length, 1);
});

test('single-authority: a joining surface adopts the seeded session instead of minting', () => {
  const time = clock();
  const joiner = createController({ now: time.now, instanceId: 'second-op', productionCode: 'TH2607' });
  // The session doc carries the authoritative id; the joiner adopts it and
  // every message it emits rides that session.
  joiner.setIdentity({ sessionId: 'session-authoritative' });
  const ready = joiner.buildReady();
  assert.equal(ready.sessionId, 'session-authoritative');
  const caller = createController({ now: time.now, instanceId: 'caller', productionCode: 'TH2607' });
  caller.setIdentity({ sessionId: 'session-authoritative' });
  assert.equal(caller.accepts(ready), true);
});

test('doc-delivered controls may ignore a stale output target but never a foreign session', () => {
  // A talent that reloaded on another machine has a fresh instance id; the
  // operator's commands still carry the OLD target. Over the session doc the
  // address is production + session only; the BroadcastChannel path keeps
  // the target check so several local windows stay individually addressed.
  const talent = createController({ instanceId: 'talent-new', productionCode: 'A' });
  talent.setIdentity({ sessionId: 'session-A' });
  const stale = { protocolVersion: PROTOCOL_VERSION, productionCode: 'A', sessionId: 'session-A', targetOutputInstanceId: 'talent-old', action: 'resume' };
  assert.equal(talent.accepts(stale), false);
  assert.equal(talent.accepts(stale, { ignoreTarget: true }), true);
  assert.equal(talent.accepts({ ...stale, sessionId: 'session-rival' }, { ignoreTarget: true }), false);
  assert.equal(talent.accepts({ ...stale, productionCode: 'B' }, { ignoreTarget: true }), false);
  assert.equal(talent.accepts({ action: 'resume', targetOutputInstanceId: 'talent-old' }, { allowLegacy: true, ignoreTarget: true }), true);
});

test('rebind on evidence: a replacement output echoing the current snapshotId becomes ready and takes the queue', () => {
  const operator = createController({ instanceId: 'operator', productionCode: 'A' });
  operator.setIdentity({ sessionId: 'session-A' });
  operator.noteOutput('output-A');
  const seed = operator.buildSnapshot({ outputInstanceId: 'output-A' });
  operator.markStateApplied('output-A', seed.snapshotId, seed.state);
  operator.markDisconnected('output-A', 'missed heartbeats');
  const command = operator.buildCommand('resume');
  operator.queueCommand(command);
  // Output B (the reloaded talent) applied the retargeted doc seed and its
  // heartbeat echoes the operator's CURRENT snapshotId: that is the evidence.
  const talentB = createController({ instanceId: 'output-B', productionCode: 'A' });
  talentB.setIdentity({ sessionId: 'session-A' });
  talentB.applySnapshot({ ...seed.state, outputInstanceId: 'output-B' }, 'output-B');
  const beat = talentB.buildHeartbeat();
  assert.equal(operator.accepts(beat), true);
  assert.equal(beat.snapshotId, operator.getState().snapshotId);
  operator.noteOutput('output-B', 'connected');
  assert.equal(operator.isReady('output-A'), false);
  assert.equal(operator.markStateApplied('output-B', beat.snapshotId, beat.state), true);
  assert.equal(operator.isReady('output-B'), true);
  const queued = operator.takeQueuedCommands('output-B');
  assert.equal(queued.length, 1);
  assert.equal(queued[0].commandId, command.commandId);
  assert.equal(queued[0].targetOutputInstanceId, 'output-B');
});

console.log('PASS 11 Flowmingo session controller tests');
