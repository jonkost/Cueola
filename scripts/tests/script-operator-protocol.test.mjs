import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  PROTOCOL_VERSION,
  HEARTBEAT_INTERVAL_MS,
  HEARTBEAT_MISSES_ALLOWED,
  HEARTBEAT_TIMEOUT_MS,
  MESSAGE_TYPES,
  ENVELOPE_FIELDS,
  STATE_FIELDS,
  channelName,
  normalizeEnvelope,
  createHost,
  createOperator
} = require('../../cueola-script-operator-protocol.js');

function clock(start = 1000) {
  let value = start;
  return {
    now: () => value,
    tick: (amount = 1) => { value += amount; }
  };
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

function pair(options = {}) {
  const time = options.time || clock();
  const common = {
    now: time.now,
    productionCode: options.productionCode || 'STAB26',
    sessionId: options.sessionId || 'live-session-1',
    controllerInstanceId: options.controllerInstanceId || 'controller-A'
  };
  const host = createHost({
    ...common,
    messageCacheSize: options.messageCacheSize,
    commandCacheSize: options.commandCacheSize
  });
  const operator = createOperator({
    ...common,
    operatorInstanceId: options.operatorInstanceId || 'script-op-A',
    messageCacheSize: options.messageCacheSize
  });
  return { time, common, host, operator };
}

function handshake(host, operator, snapshot = { activeCueId: 'cue-1', running: false }) {
  const ready = operator.buildReady();
  assert.equal(ready.type, MESSAGE_TYPES.READY);
  assert.ok(host.noteReady(ready));
  const state = host.buildState(snapshot);
  assert.equal(state.type, MESSAGE_TYPES.STATE);
  assert.ok(operator.applyState(state));
  const applied = operator.buildStateApplied();
  assert.equal(applied.type, MESSAGE_TYPES.STATE_APPLIED);
  assert.equal(host.markStateApplied(applied), true);
  return { ready, state, applied };
}

test('envelopes and snapshots have complete serializable v1 shapes', () => {
  const { host, operator } = pair();
  const ready = JSON.parse(JSON.stringify(operator.buildReady()));
  assert.deepEqual(Object.keys(ready), [...ENVELOPE_FIELDS]);
  assert.equal(ready.protocolVersion, PROTOCOL_VERSION);
  assert.equal(ready.productionCode, 'STAB26');
  assert.equal(ready.targetInstanceId, host.controllerInstanceId);
  assert.deepEqual(normalizeEnvelope(ready), ready);

  assert.ok(host.noteReady(ready));
  const message = host.buildState({
    scriptId: 'script-1',
    activeCueId: 'cue-4',
    running: false,
    position: 18.5,
    controls: { speed: 65, mirrored: true }
  });
  const state = JSON.parse(JSON.stringify(message.payload.state));
  assert.deepEqual(Object.keys(state), [...STATE_FIELDS]);
  assert.equal(state.protocolVersion, PROTOCOL_VERSION);
  assert.equal(state.operatorInstanceId, operator.operatorInstanceId);
  assert.equal(state.stateVersion, 1);
  assert.equal(state.data.controls.mirrored, true);
  assert.equal(
    host.channelName,
    channelName({ productionCode: 'STAB26', sessionId: 'live-session-1', controllerInstanceId: 'controller-A' })
  );
  assert.equal(host.channelName, operator.channelName);
  assert.equal(HEARTBEAT_TIMEOUT_MS, HEARTBEAT_INTERVAL_MS * HEARTBEAT_MISSES_ALLOWED);
});

test('READY then exact STATE_APPLIED is the only command-ready path', () => {
  const { host, operator } = pair();
  assert.equal(operator.buildCommand('play'), null);
  assert.ok(host.noteReady(operator.buildReady()));
  assert.equal(host.isReady(), false);
  assert.equal(operator.isReady(), false);

  const state = host.buildState({ running: false, position: 9 });
  assert.ok(operator.applyState(state));
  assert.equal(host.isReady(), false);
  assert.equal(operator.isReady(), false);

  const wrongSnapshot = {
    ...operator.buildStateApplied(),
    messageId: 'wrong-applied',
    payload: { snapshotId: 'another-snapshot', stateVersion: state.payload.state.stateVersion }
  };
  assert.equal(host.markStateApplied(wrongSnapshot), false);
  const wrongVersion = {
    ...operator.buildStateApplied(),
    messageId: 'wrong-version',
    payload: { snapshotId: state.payload.state.snapshotId, stateVersion: state.payload.state.stateVersion + 1 }
  };
  assert.equal(host.markStateApplied(wrongVersion), false);

  const applied = operator.buildStateApplied();
  assert.equal(operator.isReady(), true);
  assert.equal(host.markStateApplied(applied), true);
  assert.equal(host.isReady(operator.operatorInstanceId), true);
  assert.ok(operator.buildCommand('play', { from: 9 }));
});

test('wrong production, session, controller, operator, target, and stale identities are rejected', () => {
  const { host, operator, common } = pair();
  handshake(host, operator);
  const heartbeat = operator.buildHeartbeat();
  assert.equal(host.accepts(heartbeat), true);
  assert.equal(host.accepts({ ...heartbeat, productionCode: 'OTHER' }), false);
  assert.equal(host.accepts({ ...heartbeat, sessionId: 'other-session' }), false);
  assert.equal(host.accepts({ ...heartbeat, controllerInstanceId: 'controller-B' }), false);
  assert.equal(host.accepts({ ...heartbeat, targetInstanceId: 'controller-B' }), false);
  assert.equal(host.accepts({ ...heartbeat, operatorInstanceId: 'script-op-old' }), false);

  const replacement = createOperator({ ...common, operatorInstanceId: 'script-op-new' });
  assert.ok(host.noteReady(replacement.buildReady()));
  assert.equal(host.accepts(operator.buildHeartbeat()), false);
  assert.equal(host.noteReady(operator.buildReady()), false);

  const state = host.buildState({ activeCueId: 'cue-new' });
  assert.equal(operator.accepts(state), false);
  assert.equal(replacement.accepts({ ...state, targetInstanceId: 'script-op-old' }), false);
});

test('a replacement operator invalidates old readiness and requires a fresh exact snapshot', () => {
  const { host, operator, common } = pair();
  handshake(host, operator);
  assert.equal(host.isReady('script-op-A'), true);

  const replacement = createOperator({ ...common, operatorInstanceId: 'script-op-B' });
  assert.ok(host.noteReady(replacement.buildReady()));
  assert.equal(host.isReady('script-op-A'), false);
  assert.equal(host.isReady('script-op-B'), false);
  const replacementState = host.buildState({ activeCueId: 'cue-2' });
  assert.equal(replacementState.targetInstanceId, 'script-op-B');
  assert.equal(operator.applyState(replacementState), false);
  assert.ok(replacement.applyState(replacementState));
  assert.equal(host.markStateApplied(replacement.buildStateApplied()), true);
  assert.equal(host.isReady('script-op-B'), true);
});

test('a duplicate completed command executes once and receives a cached fresh re-ack', () => {
  const { time, host, operator } = pair();
  handshake(host, operator);
  const command = operator.buildCommand('set-speed', { speed: 72 });
  let executions = 0;
  const first = host.beginCommand(command);
  assert.equal(first.accepted, true);
  executions += 1;
  assert.deepEqual(first.command.data, { speed: 72 });
  const firstAck = host.completeCommand(first.command, { ok: true, appliedSpeed: 72 });
  assert.equal(firstAck.type, MESSAGE_TYPES.COMMAND_ACK);
  assert.equal(firstAck.payload.duplicate, false);
  assert.equal(operator.pendingCount(), 1);

  time.tick(25);
  const duplicate = host.beginCommand(command);
  assert.equal(duplicate.accepted, false);
  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.pending, false);
  assert.equal(executions, 1);
  assert.equal(duplicate.ack.type, MESSAGE_TYPES.COMMAND_ACK);
  assert.equal(duplicate.ack.payload.commandId, command.messageId);
  assert.equal(duplicate.ack.payload.duplicate, true);
  assert.equal(duplicate.ack.timestamp, firstAck.timestamp + 25);
  assert.deepEqual(duplicate.result, { ok: true, appliedSpeed: 72, error: '' });
  assert.deepEqual(operator.noteCommandAck(duplicate.ack), duplicate.result);
  assert.equal(operator.pendingCount(), 0);
  assert.deepEqual(host.getCachedResult(command.messageId), duplicate.result);
});

test('duplicate messages are ignored and both message and command caches stay bounded', () => {
  const { host, operator } = pair({ messageCacheSize: 2, commandCacheSize: 2 });
  handshake(host, operator);
  const heartbeat = operator.buildHeartbeat();
  assert.equal(host.noteHeartbeat(heartbeat), true);
  assert.equal(host.noteHeartbeat(heartbeat), false);
  const controllerHeartbeat = host.buildHeartbeat();
  assert.equal(operator.noteHeartbeat(controllerHeartbeat), true);
  assert.equal(operator.noteHeartbeat(controllerHeartbeat), false);

  for (let index = 0; index < 5; index += 1) {
    const command = operator.buildCommand(`command-${index}`, { index });
    const begun = host.beginCommand(command);
    assert.equal(begun.accepted, true);
    const ack = host.completeCommand(command, { ok: true, index });
    assert.ok(operator.noteCommandAck(ack));
  }
  assert.ok(host.cacheInfo().messages <= 2);
  assert.ok(host.cacheInfo().commands <= 2);
  assert.ok(operator.cacheInfo().messages <= 2);
});

test('state versions increase monotonically and stale or replayed state is rejected', () => {
  const { host, operator } = pair();
  const first = handshake(host, operator, { position: 1 }).state;
  const second = host.buildState({ position: 2 });
  assert.equal(second.payload.state.stateVersion, first.payload.state.stateVersion + 1);
  assert.ok(operator.applyState(second));

  const replayWithFreshMessageId = {
    ...first,
    messageId: 'fresh-id-for-stale-state'
  };
  assert.equal(operator.applyState(replayWithFreshMessageId), false);
  assert.equal(operator.getState().data.position, 2);
  assert.equal(operator.buildStateApplied().payload.stateVersion, second.payload.state.stateVersion);
});

test('three missed heartbeats remove readiness; liveness and handshake recover independently', () => {
  const { time, host, operator } = pair();
  handshake(host, operator);
  time.tick(HEARTBEAT_TIMEOUT_MS - 1);
  assert.equal(host.checkHeartbeat(), true);
  assert.equal(operator.checkHeartbeat(), true);
  time.tick(1);
  assert.equal(host.checkHeartbeat(), false);
  assert.equal(operator.checkHeartbeat(), false);
  assert.equal(host.getStatus().timedOut, true);
  assert.equal(operator.getStatus().timedOut, true);
  assert.equal(host.isReady(), false);
  assert.equal(operator.isReady(), false);

  assert.equal(host.noteHeartbeat(operator.buildHeartbeat()), true);
  assert.equal(operator.noteHeartbeat(host.buildHeartbeat()), true);
  assert.equal(host.getStatus().connected, true);
  assert.equal(operator.getStatus().connected, true);
  assert.equal(host.isReady(), false);
  assert.equal(operator.isReady(), false);

  assert.ok(host.noteReady(operator.buildReady()));
  const recoveryState = host.buildState({ running: false, position: 14 });
  assert.ok(operator.applyState(recoveryState));
  assert.equal(host.markStateApplied(operator.buildStateApplied()), true);
  assert.equal(host.isReady(), true);
  assert.equal(operator.isReady(), true);
});

test('host and operator cleanup are idempotent and closing envelopes are explicit', () => {
  const time = clock();
  let hostCleanup = 0;
  let operatorCleanup = 0;
  const common = {
    now: time.now,
    productionCode: 'STAB26',
    sessionId: 'live-session-1',
    controllerInstanceId: 'controller-A'
  };
  const host = createHost({ ...common, onClose: () => { hostCleanup += 1; } });
  const operator = createOperator({
    ...common,
    operatorInstanceId: 'script-op-A',
    onClose: () => { operatorCleanup += 1; }
  });
  handshake(host, operator);

  const controllerClosing = host.close('main window left Live');
  assert.equal(controllerClosing.type, MESSAGE_TYPES.CONTROLLER_CLOSING);
  assert.equal(host.close('again'), null);
  assert.equal(hostCleanup, 1);
  assert.equal(host.isClosed(), true);
  assert.equal(operator.noteControllerClosing(controllerClosing), true);
  assert.equal(operator.close('already closed'), null);
  assert.equal(operatorCleanup, 1);
  assert.equal(operator.getStatus().controllerClosed, true);

  let localCleanup = 0;
  const local = createOperator({
    ...common,
    operatorInstanceId: 'script-op-local',
    onClose: () => { localCleanup += 1; }
  });
  const closing = local.close('operator closed popout');
  assert.equal(closing.type, MESSAGE_TYPES.CLOSING);
  assert.equal(local.close('again'), null);
  assert.equal(localCleanup, 1);
});

console.log('PASS 9 Script Operator protocol tests');
