import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  PROTOCOL_VERSION,
  MESSAGE_TYPES,
  ENVELOPE_FIELDS,
  STATE_FIELDS,
  normalizeEnvelope,
  normalizeState,
  safeRecoveryState,
  createController,
  createOutput
} = require('../../outrangutan/output-protocol.js');

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
    productionSessionId: options.productionSessionId || 'STAB26-session',
    controllerInstanceId: options.controllerInstanceId || 'controller-A'
  };
  const controller = createController({ ...common, outputIds: ['program'] });
  const output = createOutput({
    ...common,
    outputId: 'program',
    outputInstanceId: options.outputInstanceId || 'renderer-A'
  });
  return { time, controller, output };
}

function handshake(controller, output, state = {}) {
  const ready = output.buildReady();
  assert.ok(controller.noteReady(ready));
  const sync = controller.buildSyncState(output.outputId, state);
  assert.ok(sync);
  assert.ok(output.applySyncState(sync));
  const applied = output.buildStateApplied();
  assert.ok(applied);
  assert.equal(controller.markStateApplied(applied), true);
  return { ready, sync, applied };
}

test('protocol envelopes and state have the complete serializable v2 shape', () => {
  const normalizedState = JSON.parse(JSON.stringify(normalizeState({
    productionSessionId: 'show/one',
    controllerInstanceId: 'controller one',
    outputId: 'program',
    outputInstanceId: 'renderer-A',
    windowStatus: 'open',
    communicationStatus: 'ready',
    mediaLoadStatus: 'ready',
    playbackStatus: 'playing',
    rendererStatus: 'painting',
    heartbeatStatus: 'healthy',
    lastHeartbeatAt: 80,
    lastAck: { commandId: 'cmd-1', commandType: 'play', ok: true, timestamp: 75 },
    cueId: 'cue 1',
    mediaId: 'media 1',
    playhead: 12.5,
    recoverability: 'operator',
    timestamp: 100
  })));
  assert.deepEqual(Object.keys(normalizedState), [...STATE_FIELDS]);
  assert.equal(normalizedState.protocolVersion, PROTOCOL_VERSION);
  assert.equal(normalizedState.productionSessionId, 'show_one');
  assert.equal(normalizedState.controllerInstanceId, 'controller_one');
  assert.equal(normalizedState.playhead, 12.5);
  assert.equal(normalizedState.lastAck.commandId, 'cmd-1');

  const normalizedEnvelope = normalizeEnvelope({
    protocolVersion: PROTOCOL_VERSION,
    productionSessionId: 'show',
    controllerInstanceId: 'controller',
    outputId: 'program',
    outputInstanceId: 'renderer',
    commandId: 'cmd',
    commandType: 'play',
    cueId: 'cue',
    mediaId: 'media',
    timestamp: 100,
    payload: { at: 12 }
  });
  assert.deepEqual(Object.keys(normalizedEnvelope), [...ENVELOPE_FIELDS]);
  assert.equal(normalizedEnvelope.payload.at, 12);
});

test('READY to SYNC_STATE to STATE_APPLIED is the only readiness path', () => {
  const { controller, output } = pair();
  const ready = output.buildReady();
  assert.equal(ready.commandType, MESSAGE_TYPES.READY);
  assert.ok(controller.noteReady(ready));
  assert.equal(controller.isReady('program'), false);

  const sync = controller.buildSyncState('program', {
    cueId: 'cue-1',
    mediaId: 'media-1',
    playbackStatus: 'playing',
    playhead: 42
  });
  assert.equal(sync.commandType, MESSAGE_TYPES.SYNC_STATE);
  assert.equal(sync.payload.safeRecovery, true);
  assert.equal(sync.payload.state.playbackStatus, 'paused');
  assert.equal(controller.isReady('program'), false);

  const appliedState = output.applySyncState(sync);
  assert.equal(appliedState.playbackStatus, 'paused');
  assert.equal(appliedState.playhead, 42);
  assert.equal(appliedState.recoverability, 'operator');
  assert.equal(appliedState.communicationStatus, 'syncing');
  assert.equal(output.isReady(), false);
  const applied = output.buildStateApplied();
  assert.equal(applied.commandType, MESSAGE_TYPES.STATE_APPLIED);
  assert.equal(applied.commandId, sync.commandId);
  assert.equal(output.isReady(), true);
  assert.equal(controller.markStateApplied(applied), true);
  assert.equal(controller.isReady('program', output.outputInstanceId), true);
});

test('wrong production, controller, output, and output instance are rejected', () => {
  const { controller, output } = pair();
  const { sync } = handshake(controller, output);
  const command = controller.buildCommand('play', { outputId: 'program', cueId: 'cue-1', mediaId: 'media-1' });
  assert.equal(output.accepts(command), true);
  assert.equal(output.accepts({ ...command, productionSessionId: 'OTHER' }), false);
  assert.equal(output.accepts({ ...command, controllerInstanceId: 'controller-B' }), false);
  assert.equal(output.accepts({ ...command, outputId: 'preview' }), false);
  assert.equal(output.accepts({ ...command, outputInstanceId: 'renderer-old' }), false);
  assert.equal(controller.accepts({ ...output.buildHeartbeat(), outputInstanceId: 'renderer-old' }), false);
  assert.equal(controller.markStateApplied({ ...output.buildStateApplied(sync.commandId), commandId: 'wrong-sync' }), false);
});

test('queued commands retarget a replacement renderer and flush exactly once', () => {
  const time = clock();
  const common = { time, productionSessionId: 'show', controllerInstanceId: 'controller' };
  const first = pair({ ...common, outputInstanceId: 'renderer-old' });
  handshake(first.controller, first.output);
  first.controller.markDisconnected('program', 'heartbeat timeout');
  const command = first.controller.buildCommand('play', {
    outputId: 'program', cueId: 'cue-2', mediaId: 'media-2', payload: { at: 8 }
  });
  assert.equal(first.controller.queueCommand(command), true);
  assert.equal(first.controller.queueCommand(command), false);
  assert.deepEqual(first.controller.takeQueuedCommands('program'), []);

  const replacement = createOutput({
    now: time.now,
    productionSessionId: 'show',
    controllerInstanceId: 'controller',
    outputId: 'program',
    outputInstanceId: 'renderer-new'
  });
  handshake(first.controller, replacement);
  const flushed = first.controller.takeQueuedCommands('program', 'renderer-new');
  assert.equal(flushed.length, 1);
  assert.equal(flushed[0].commandId, command.commandId);
  assert.equal(flushed[0].outputInstanceId, 'renderer-new');
  assert.deepEqual(first.controller.takeQueuedCommands('program', 'renderer-new'), []);
  assert.equal(first.controller.queueCommand(command), false);
});

test('completed duplicate commands return the cached result and a fresh re-ack', () => {
  const { time, controller, output } = pair();
  handshake(controller, output);
  const command = controller.buildCommand('play', {
    outputId: 'program', cueId: 'cue-3', mediaId: 'media-3', payload: { at: 5 }
  });
  const first = output.beginCommand(command);
  assert.equal(first.accepted, true);
  assert.equal(output.pendingCount(), 1);
  const whilePending = output.beginCommand(command);
  assert.equal(whilePending.duplicate, true);
  assert.equal(whilePending.pending, true);
  assert.equal(whilePending.ack, null);

  const ack = output.completeCommand(command, { ok: true, appliedAt: 5 }, {
    mediaLoadStatus: 'ready', playbackStatus: 'playing', rendererStatus: 'painting', playhead: 5
  });
  assert.equal(ack.commandType, MESSAGE_TYPES.COMMAND_ACK);
  assert.equal(ack.commandId, command.commandId);
  assert.equal(ack.payload.duplicate, false);
  assert.deepEqual(output.getCachedResult(command.commandId), { ok: true, appliedAt: 5, error: '' });
  assert.deepEqual(controller.noteAck(ack), { ok: true, appliedAt: 5, error: '' });

  time.tick(10);
  const duplicate = output.beginCommand(command);
  assert.equal(duplicate.accepted, false);
  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.pending, false);
  assert.deepEqual(duplicate.result, ack.payload.result);
  assert.equal(duplicate.ack.commandId, command.commandId);
  assert.equal(duplicate.ack.payload.duplicate, true);
  assert.equal(duplicate.ack.timestamp, ack.timestamp + 10);
});

test('heartbeat and acknowledgments project independent output health fields', () => {
  const { time, controller, output } = pair();
  handshake(controller, output);
  time.tick(2000);
  const heartbeat = output.buildHeartbeat({
    windowStatus: 'open',
    communicationStatus: 'ready',
    mediaLoadStatus: 'ready',
    playbackStatus: 'paused',
    rendererStatus: 'painting',
    cueId: 'cue-4',
    mediaId: 'media-4',
    playhead: 9,
    recoverability: 'operator'
  });
  assert.equal(controller.noteHeartbeat(heartbeat), true);
  const state = controller.getState('program');
  assert.equal(state.windowStatus, 'open');
  assert.equal(state.communicationStatus, 'ready');
  assert.equal(state.mediaLoadStatus, 'ready');
  assert.equal(state.playbackStatus, 'paused');
  assert.equal(state.rendererStatus, 'painting');
  assert.equal(state.heartbeatStatus, 'healthy');
  assert.equal(state.lastHeartbeatAt, time.now());
  assert.equal(state.cueId, 'cue-4');
  assert.equal(state.mediaId, 'media-4');
  assert.equal(state.playhead, 9);
  assert.equal(state.recoverability, 'operator');
});

test('safe recovery never carries playing into a replacement output', () => {
  const safe = safeRecoveryState({ playbackStatus: 'playing', playhead: 18, recoverability: 'automatic' });
  assert.equal(safe.playbackStatus, 'paused');
  assert.equal(safe.playhead, 18);
  assert.equal(safe.recoverability, 'operator');

  const { controller, output } = pair();
  handshake(controller, output);
  output.update({ playbackStatus: 'playing', cueId: 'cue-5', mediaId: 'media-5', playhead: 18 });
  const recovering = output.markRecovering('missed controller heartbeat');
  assert.equal(recovering.playbackStatus, 'paused');
  assert.equal(recovering.communicationStatus, 'recovering');
  assert.equal(recovering.heartbeatStatus, 'dead');
  assert.equal(recovering.recoverability, 'operator');
  assert.equal(output.isReady(), false);
});

test('STATE_APPLIED preserves a renderer failure for immediate operator status', () => {
  const { controller, output } = pair();
  const ready = output.buildReady();
  assert.ok(controller.noteReady(ready));
  const sync = controller.buildSyncState('program', { cueId: 'cue-bad', mediaId: 'media-missing' });
  assert.ok(output.applySyncState(sync));
  output.update({
    mediaLoadStatus: 'error', playbackStatus: 'error', rendererStatus: 'error',
    recoverability: 'reload', error: 'Media is not available in this output window.'
  });
  const applied = output.buildStateApplied(sync.commandId);
  assert.ok(controller.markStateApplied(applied));
  const state = controller.getState('program');
  assert.equal(state.mediaLoadStatus, 'error');
  assert.equal(state.rendererStatus, 'error');
  assert.equal(state.error, 'Media is not available in this output window.');
  assert.equal(state.recoverability, 'reload');
});

test('heartbeat preserves renderer error details while communication remains alive', () => {
  const { controller, output } = pair();
  handshake(controller, output);
  const heartbeat = output.buildHeartbeat({
    mediaLoadStatus: 'error', playbackStatus: 'error', rendererStatus: 'error',
    recoverability: 'reload', error: 'Decoder failed while frames were still responsive.'
  });
  assert.ok(controller.noteHeartbeat(heartbeat));
  const state = controller.getState('program');
  assert.equal(state.heartbeatStatus, 'healthy');
  assert.equal(state.rendererStatus, 'error');
  assert.equal(state.error, 'Decoder failed while frames were still responsive.');
});

test('explicit empty state identifiers clear stopped media instead of reviving fallback IDs', () => {
  const prior = normalizeState({
    productionSessionId: 'show', controllerInstanceId: 'controller', outputId: 'program', outputInstanceId: 'renderer',
    cueId: 'cue-old', mediaId: 'media-old', snapshotId: 'snapshot-old'
  });
  const cleared = normalizeState({ cueId: '', mediaId: '', snapshotId: '' }, prior);
  assert.equal(cleared.cueId, '');
  assert.equal(cleared.mediaId, '');
  assert.equal(cleared.snapshotId, '');
});

test('out-of-order output heartbeats cannot regress observed renderer state', () => {
  const { controller, output } = pair();
  handshake(controller, output);
  const older = output.buildHeartbeat({ playbackStatus: 'playing', playhead: 4, rendererStatus: 'painting' });
  const newer = output.buildHeartbeat({ playbackStatus: 'paused', playhead: 9, rendererStatus: 'painting' });
  assert.ok(controller.noteHeartbeat(newer));
  assert.equal(controller.noteHeartbeat(older), false);
  const state = controller.getState('program');
  assert.equal(state.playbackStatus, 'paused');
  assert.equal(state.playhead, 9);
});

console.log('PASS 11 Outrangutan output protocol tests');
