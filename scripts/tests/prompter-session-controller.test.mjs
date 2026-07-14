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

console.log('PASS 7 Flowmingo session controller tests');
