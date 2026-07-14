/* Outrangutan controller/output session protocol.
 *
 * Dependency-free identity, state, handshake, queue, and idempotency helpers.
 * Rendering and transport stay in outrangutan.js/output.html; this module owns
 * the serializable contract shared by those two runtimes.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.CueolaOutputProtocol = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var PROTOCOL_VERSION = 2;
  var MESSAGE_TYPES = Object.freeze({
    READY: 'READY',
    SYNC_STATE: 'SYNC_STATE',
    STATE_APPLIED: 'STATE_APPLIED',
    COMMAND_ACK: 'COMMAND_ACK',
    HEARTBEAT: 'HEARTBEAT'
  });
  var SYSTEM_TYPES = new Set(Object.keys(MESSAGE_TYPES).map(function (key) { return MESSAGE_TYPES[key]; }));
  var STATUSES = Object.freeze({
    window: Object.freeze(['closed', 'opening', 'open', 'blocked', 'error']),
    communication: Object.freeze(['disconnected', 'connecting', 'connected', 'syncing', 'ready', 'recovering', 'error']),
    mediaLoad: Object.freeze(['empty', 'loading', 'ready', 'error']),
    playback: Object.freeze(['stopped', 'paused', 'playing', 'ended', 'error']),
    renderer: Object.freeze(['idle', 'painting', 'stalled', 'error']),
    heartbeat: Object.freeze(['unknown', 'healthy', 'late', 'dead']),
    recoverability: Object.freeze(['none', 'automatic', 'operator', 'reload', 'unrecoverable'])
  });
  var STATUS_SETS = {
    window: new Set(STATUSES.window),
    communication: new Set(STATUSES.communication),
    mediaLoad: new Set(STATUSES.mediaLoad),
    playback: new Set(STATUSES.playback),
    renderer: new Set(STATUSES.renderer),
    heartbeat: new Set(STATUSES.heartbeat),
    recoverability: new Set(STATUSES.recoverability)
  };
  var ENVELOPE_FIELDS = Object.freeze([
    'protocolVersion', 'productionSessionId', 'controllerInstanceId',
    'outputId', 'outputInstanceId', 'commandId', 'commandType', 'cueId',
    'mediaId', 'timestamp', 'payload'
  ]);
  var STATE_FIELDS = Object.freeze([
    'protocolVersion', 'productionSessionId', 'controllerInstanceId',
    'outputId', 'outputInstanceId', 'windowStatus', 'communicationStatus',
    'mediaLoadStatus', 'playbackStatus', 'rendererStatus', 'heartbeatStatus',
    'lastHeartbeatAt', 'lastAck', 'cueId', 'mediaId', 'playhead',
    'recoverability', 'error', 'stateVersion', 'snapshotId', 'timestamp'
  ]);

  function cleanId(value) {
    return String(value == null ? '' : value).trim().replace(/[^a-zA-Z0-9_.:-]/g, '_').slice(0, 180);
  }

  function cleanType(value) {
    return String(value == null ? '' : value).trim().replace(/[^a-zA-Z0-9_.:-]/g, '_').slice(0, 80);
  }

  function finite(value, fallback) {
    var number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  function has(object, key) {
    return Object.prototype.hasOwnProperty.call(object, key);
  }

  function clone(value, fallback) {
    try {
      var encoded = JSON.stringify(value);
      return encoded === undefined ? fallback : JSON.parse(encoded);
    } catch (error) {
      return fallback;
    }
  }

  function status(group, value, fallback, defaultValue) {
    if (STATUS_SETS[group].has(value)) return value;
    if (STATUS_SETS[group].has(fallback)) return fallback;
    return defaultValue;
  }

  function identity(input, fallback) {
    input = input && typeof input === 'object' ? input : {};
    fallback = fallback && typeof fallback === 'object' ? fallback : {};
    return {
      productionSessionId: cleanId(input.productionSessionId || fallback.productionSessionId),
      controllerInstanceId: cleanId(input.controllerInstanceId || fallback.controllerInstanceId),
      outputId: cleanId(input.outputId || fallback.outputId),
      outputInstanceId: cleanId(input.outputInstanceId || fallback.outputInstanceId)
    };
  }

  function normalizeLastAck(input, fallback) {
    if (input === null) return null;
    input = input && typeof input === 'object' ? input : null;
    fallback = fallback && typeof fallback === 'object' ? fallback : null;
    var source = input || fallback;
    if (!source) return null;
    return {
      commandId: cleanId(source.commandId),
      commandType: cleanType(source.commandType),
      ok: source.ok !== false,
      timestamp: Math.max(0, finite(source.timestamp, 0)),
      error: String(source.error || '').slice(0, 500)
    };
  }

  function normalizeState(input, fallback) {
    input = input && typeof input === 'object' ? input : {};
    fallback = fallback && typeof fallback === 'object' ? fallback : {};
    var ids = identity(input, fallback);
    var ack = has(input, 'lastAck')
      ? normalizeLastAck(input.lastAck, null)
      : normalizeLastAck(fallback.lastAck, null);
    return {
      protocolVersion: PROTOCOL_VERSION,
      productionSessionId: ids.productionSessionId,
      controllerInstanceId: ids.controllerInstanceId,
      outputId: ids.outputId,
      outputInstanceId: ids.outputInstanceId,
      windowStatus: status('window', input.windowStatus, fallback.windowStatus, 'closed'),
      communicationStatus: status('communication', input.communicationStatus, fallback.communicationStatus, 'disconnected'),
      mediaLoadStatus: status('mediaLoad', input.mediaLoadStatus, fallback.mediaLoadStatus, 'empty'),
      playbackStatus: status('playback', input.playbackStatus, fallback.playbackStatus, 'stopped'),
      rendererStatus: status('renderer', input.rendererStatus, fallback.rendererStatus, 'idle'),
      heartbeatStatus: status('heartbeat', input.heartbeatStatus, fallback.heartbeatStatus, 'unknown'),
      lastHeartbeatAt: Math.max(0, finite(input.lastHeartbeatAt, finite(fallback.lastHeartbeatAt, 0))),
      lastAck: ack,
      cueId: cleanId(has(input, 'cueId') ? input.cueId : fallback.cueId),
      mediaId: cleanId(has(input, 'mediaId') ? input.mediaId : fallback.mediaId),
      playhead: Math.max(0, finite(input.playhead, finite(fallback.playhead, 0))),
      recoverability: status('recoverability', input.recoverability, fallback.recoverability, 'none'),
      error: String(has(input, 'error') ? (input.error || '') : (fallback.error || '')).slice(0, 500),
      stateVersion: Math.max(0, Math.floor(finite(input.stateVersion, finite(fallback.stateVersion, 0)))),
      snapshotId: cleanId(has(input, 'snapshotId') ? input.snapshotId : fallback.snapshotId),
      timestamp: Math.max(0, finite(input.timestamp, finite(fallback.timestamp, 0)))
    };
  }

  function safeRecoveryState(input, fallback) {
    var state = normalizeState(input, fallback);
    if (state.playbackStatus === 'playing') {
      state.playbackStatus = 'paused';
      state.recoverability = 'operator';
    }
    return state;
  }

  function normalizeEnvelope(input) {
    input = input && typeof input === 'object' ? input : {};
    var ids = identity(input);
    var payload = input.payload && typeof input.payload === 'object' && !Array.isArray(input.payload)
      ? clone(input.payload, {})
      : {};
    return {
      protocolVersion: Math.floor(finite(input.protocolVersion, 0)),
      productionSessionId: ids.productionSessionId,
      controllerInstanceId: ids.controllerInstanceId,
      outputId: ids.outputId,
      outputInstanceId: ids.outputInstanceId,
      commandId: cleanId(input.commandId),
      commandType: cleanType(input.commandType),
      cueId: cleanId(input.cueId),
      mediaId: cleanId(input.mediaId),
      timestamp: Math.max(0, finite(input.timestamp, 0)),
      payload: payload
    };
  }

  function envelope(ids, commandType, options, now) {
    options = options || {};
    return normalizeEnvelope({
      protocolVersion: PROTOCOL_VERSION,
      productionSessionId: ids.productionSessionId,
      controllerInstanceId: ids.controllerInstanceId,
      outputId: options.outputId || ids.outputId,
      outputInstanceId: options.outputInstanceId || ids.outputInstanceId,
      commandId: options.commandId,
      commandType: commandType,
      cueId: options.cueId,
      mediaId: options.mediaId,
      timestamp: finite(options.timestamp, now()),
      payload: options.payload || {}
    });
  }

  function completeEnvelope(message) {
    return message.protocolVersion === PROTOCOL_VERSION &&
      Boolean(message.productionSessionId && message.controllerInstanceId && message.outputId &&
        message.outputInstanceId && message.commandId && message.commandType);
  }

  function fixedState(state, ids, patch) {
    return normalizeState(Object.assign({}, state, patch || {}, ids), state);
  }

  function createController(options) {
    options = options || {};
    var now = typeof options.now === 'function' ? options.now : Date.now;
    var ids = identity({
      productionSessionId: options.productionSessionId,
      controllerInstanceId: options.controllerInstanceId || options.instanceId || ('ogctl_' + Math.random().toString(36).slice(2))
    });
    if (!ids.productionSessionId) throw new Error('productionSessionId is required');
    if (!ids.controllerInstanceId) throw new Error('controllerInstanceId is required');
    var knownOutputs = Array.isArray(options.outputIds)
      ? new Set(options.outputIds.map(cleanId).filter(Boolean))
      : null;
    var records = Object.create(null);
    var queued = [];
    var seenQueued = new Set();
    var seenQueuedOrder = [];
    var sequence = 0;

    function nextId(kind) {
      sequence += 1;
      return ids.controllerInstanceId + '_' + cleanType(kind || 'message') + '_' + now().toString(36) + '_' + sequence;
    }

    function recordFor(outputId) {
      return records[cleanId(outputId)] || null;
    }

    function defaultState(outputId, outputInstanceId) {
      return normalizeState({
        productionSessionId: ids.productionSessionId,
        controllerInstanceId: ids.controllerInstanceId,
        outputId: outputId,
        outputInstanceId: outputInstanceId,
        timestamp: now()
      });
    }

    function rememberQueued(commandId) {
      seenQueued.add(commandId);
      seenQueuedOrder.push(commandId);
      if (seenQueuedOrder.length > 500) seenQueued.delete(seenQueuedOrder.shift());
    }

    function accepts(message, acceptOptions) {
      acceptOptions = acceptOptions || {};
      var incoming = normalizeEnvelope(message);
      if (!completeEnvelope(incoming)) return false;
      if (incoming.productionSessionId !== ids.productionSessionId || incoming.controllerInstanceId !== ids.controllerInstanceId) return false;
      if (knownOutputs && !knownOutputs.has(incoming.outputId)) return false;
      if (acceptOptions.outputId && incoming.outputId !== cleanId(acceptOptions.outputId)) return false;
      var record = recordFor(incoming.outputId);
      if (record && record.outputInstanceId && !acceptOptions.allowReplacement && incoming.outputInstanceId !== record.outputInstanceId) return false;
      if (acceptOptions.outputInstanceId && incoming.outputInstanceId !== cleanId(acceptOptions.outputInstanceId)) return false;
      return true;
    }

    function noteReady(message) {
      var incoming = normalizeEnvelope(message);
      if (incoming.commandType !== MESSAGE_TYPES.READY || !accepts(incoming, { allowReplacement: true })) return false;
      var previous = recordFor(incoming.outputId);
      var state = normalizeState(incoming.payload.state, previous && previous.state);
      var originStateVersion = state.stateVersion;
      state = fixedState(state, {
        productionSessionId: ids.productionSessionId,
        controllerInstanceId: ids.controllerInstanceId,
        outputId: incoming.outputId,
        outputInstanceId: incoming.outputInstanceId
      }, {
        windowStatus: 'open',
        communicationStatus: 'connected',
        heartbeatStatus: 'healthy',
        lastHeartbeatAt: incoming.timestamp,
        timestamp: now(),
        error: '',
        stateVersion: Math.max(state.stateVersion, previous && previous.state.stateVersion || 0) + 1
      });
      records[incoming.outputId] = {
        outputInstanceId: incoming.outputInstanceId,
        ready: false,
        expectedSyncCommandId: '',
        originStateVersion: originStateVersion,
        state: state
      };
      return clone(state, null);
    }

    function buildSyncState(outputId, requestedState, syncOptions) {
      syncOptions = syncOptions || {};
      var record = recordFor(outputId);
      if (!record) return null;
      var requested = normalizeState(requestedState, record.state);
      var wasPlaying = requested.playbackStatus === 'playing';
      var commandId = nextId(MESSAGE_TYPES.SYNC_STATE);
      var state = safeRecoveryState(requested, record.state);
      state = fixedState(state, {
        productionSessionId: ids.productionSessionId,
        controllerInstanceId: ids.controllerInstanceId,
        outputId: cleanId(outputId),
        outputInstanceId: record.outputInstanceId
      }, {
        windowStatus: 'open',
        communicationStatus: 'syncing',
        heartbeatStatus: 'healthy',
        playbackStatus: wasPlaying ? 'paused' : state.playbackStatus,
        recoverability: wasPlaying ? 'operator' : state.recoverability,
        snapshotId: commandId,
        timestamp: now(),
        stateVersion: Math.max(state.stateVersion, record.state.stateVersion) + 1
      });
      record.ready = false;
      record.expectedSyncCommandId = commandId;
      record.state = state;
      return envelope(Object.assign({}, ids, {
        outputId: cleanId(outputId), outputInstanceId: record.outputInstanceId
      }), MESSAGE_TYPES.SYNC_STATE, {
        commandId: commandId,
        cueId: state.cueId,
        mediaId: state.mediaId,
        payload: {
          state: state,
          safeRecovery: wasPlaying,
          reason: String(syncOptions.reason || (wasPlaying ? 'safe-recovery' : 'initial-sync')).slice(0, 120)
        }
      }, now);
    }

    function markStateApplied(message) {
      var incoming = normalizeEnvelope(message);
      if (incoming.commandType !== MESSAGE_TYPES.STATE_APPLIED || !accepts(incoming)) return false;
      var record = recordFor(incoming.outputId);
      if (!record || !record.expectedSyncCommandId || incoming.commandId !== record.expectedSyncCommandId) return false;
      var state = safeRecoveryState(incoming.payload.state, record.state);
      record.originStateVersion = Math.max(record.originStateVersion || 0, state.stateVersion);
      record.state = fixedState(state, {
        productionSessionId: ids.productionSessionId,
        controllerInstanceId: ids.controllerInstanceId,
        outputId: incoming.outputId,
        outputInstanceId: incoming.outputInstanceId
      }, {
        windowStatus: 'open', communicationStatus: 'ready', heartbeatStatus: 'healthy',
        lastHeartbeatAt: incoming.timestamp, snapshotId: incoming.commandId,
        timestamp: now(), error: state.error || '', stateVersion: Math.max(state.stateVersion, record.state.stateVersion) + 1
      });
      record.ready = true;
      return true;
    }

    function isReady(outputId, outputInstanceId) {
      var record = recordFor(outputId);
      return Boolean(record && record.ready && record.expectedSyncCommandId &&
        (!outputInstanceId || record.outputInstanceId === cleanId(outputInstanceId)));
    }

    function buildCommand(commandType, commandOptions) {
      commandOptions = commandOptions || {};
      commandType = cleanType(commandType);
      if (!commandType || SYSTEM_TYPES.has(commandType)) return null;
      var outputId = cleanId(commandOptions.outputId);
      var record = recordFor(outputId);
      var outputInstanceId = cleanId(commandOptions.outputInstanceId || (record && record.outputInstanceId));
      if (!outputId || !outputInstanceId) return null;
      return envelope(Object.assign({}, ids, { outputId: outputId, outputInstanceId: outputInstanceId }), commandType, {
        commandId: cleanId(commandOptions.commandId || nextId('command')),
        cueId: commandOptions.cueId || (record && record.state.cueId),
        mediaId: commandOptions.mediaId || (record && record.state.mediaId),
        payload: commandOptions.payload || {}
      }, now);
    }

    function queueCommand(command) {
      var incoming = normalizeEnvelope(command);
      if (!accepts(incoming, { allowReplacement: true }) || SYSTEM_TYPES.has(incoming.commandType) || seenQueued.has(incoming.commandId)) return false;
      queued.push(incoming);
      rememberQueued(incoming.commandId);
      if (queued.length > 200) queued = queued.slice(-100);
      return true;
    }

    function takeQueuedCommands(outputId, outputInstanceId) {
      var record = recordFor(outputId);
      if (!record || !isReady(outputId, outputInstanceId)) return [];
      var take = [];
      var keep = [];
      queued.forEach(function (command) {
        if (command.outputId !== cleanId(outputId)) {
          keep.push(command);
          return;
        }
        take.push(normalizeEnvelope(Object.assign({}, command, {
          outputInstanceId: record.outputInstanceId
        })));
      });
      queued = keep;
      return clone(take, []);
    }

    function markDisconnected(outputId, error) {
      var record = recordFor(outputId);
      if (!record) return null;
      var wasPlaying = record.state.playbackStatus === 'playing';
      record.ready = false;
      record.expectedSyncCommandId = '';
      record.state = fixedState(safeRecoveryState(record.state), {
        productionSessionId: ids.productionSessionId,
        controllerInstanceId: ids.controllerInstanceId,
        outputId: cleanId(outputId),
        outputInstanceId: record.outputInstanceId
      }, {
        communicationStatus: 'recovering', heartbeatStatus: 'dead',
        recoverability: wasPlaying ? 'operator' : 'automatic', error: error || '', timestamp: now(),
        stateVersion: record.state.stateVersion + 1
      });
      return clone(record.state, null);
    }

    function noteHeartbeat(message) {
      var incoming = normalizeEnvelope(message);
      if (incoming.commandType !== MESSAGE_TYPES.HEARTBEAT || !accepts(incoming)) return false;
      var record = recordFor(incoming.outputId);
      var observed = normalizeState(incoming.payload.state, record.state);
      if (observed.stateVersion < (record.originStateVersion || 0)) return false;
      record.originStateVersion = observed.stateVersion;
      record.state = fixedState(observed, {
        productionSessionId: ids.productionSessionId,
        controllerInstanceId: ids.controllerInstanceId,
        outputId: incoming.outputId,
        outputInstanceId: incoming.outputInstanceId
      }, {
        windowStatus: 'open', communicationStatus: record.ready ? 'ready' : 'connected',
        heartbeatStatus: 'healthy', lastHeartbeatAt: incoming.timestamp,
        timestamp: now(), error: observed.error || '', stateVersion: Math.max(observed.stateVersion, record.state.stateVersion) + 1
      });
      return true;
    }

    function noteAck(message) {
      var incoming = normalizeEnvelope(message);
      if (incoming.commandType !== MESSAGE_TYPES.COMMAND_ACK || !accepts(incoming)) return false;
      var record = recordFor(incoming.outputId);
      var result = incoming.payload.result && typeof incoming.payload.result === 'object' ? incoming.payload.result : {};
      var observed = normalizeState(incoming.payload.state, record.state);
      var staleObservedState = observed.stateVersion < (record.originStateVersion || 0);
      if (!staleObservedState) record.originStateVersion = observed.stateVersion;
      record.state = fixedState(staleObservedState ? record.state : observed, {
        productionSessionId: ids.productionSessionId,
        controllerInstanceId: ids.controllerInstanceId,
        outputId: incoming.outputId,
        outputInstanceId: incoming.outputInstanceId
      }, {
        lastAck: {
          commandId: incoming.commandId,
          commandType: cleanType(incoming.payload.forCommandType),
          ok: result.ok !== false,
          timestamp: incoming.timestamp,
          error: result.error || ''
        },
        timestamp: now(),
        stateVersion: Math.max(observed.stateVersion, record.state.stateVersion) + 1
      });
      return clone(result, {});
    }

    function getState(outputId) {
      var record = recordFor(outputId);
      return clone(record ? record.state : defaultState(cleanId(outputId), ''), null);
    }

    function getStates() {
      var result = {};
      Object.keys(records).forEach(function (outputId) { result[outputId] = clone(records[outputId].state, null); });
      return result;
    }

    function updateOutput(outputId, patch) {
      var record = recordFor(outputId);
      if (!record) return null;
      record.state = fixedState(record.state, {
        productionSessionId: ids.productionSessionId,
        controllerInstanceId: ids.controllerInstanceId,
        outputId: cleanId(outputId),
        outputInstanceId: record.outputInstanceId
      }, Object.assign({}, patch || {}, {
        timestamp: finite(patch && patch.timestamp, now()),
        stateVersion: Math.max(record.state.stateVersion + 1, finite(patch && patch.stateVersion, 0))
      }));
      return clone(record.state, null);
    }

    function pendingCount(outputId) {
      outputId = cleanId(outputId);
      return queued.filter(function (command) { return !outputId || command.outputId === outputId; }).length;
    }

    return {
      controllerInstanceId: ids.controllerInstanceId,
      getState: getState,
      getStates: getStates,
      updateOutput: updateOutput,
      accepts: accepts,
      noteReady: noteReady,
      buildSyncState: buildSyncState,
      markStateApplied: markStateApplied,
      isReady: isReady,
      buildCommand: buildCommand,
      queueCommand: queueCommand,
      takeQueuedCommands: takeQueuedCommands,
      markDisconnected: markDisconnected,
      noteHeartbeat: noteHeartbeat,
      noteAck: noteAck,
      pendingCount: pendingCount
    };
  }

  function createOutput(options) {
    options = options || {};
    var now = typeof options.now === 'function' ? options.now : Date.now;
    var ids = identity({
      productionSessionId: options.productionSessionId,
      controllerInstanceId: options.controllerInstanceId,
      outputId: options.outputId,
      outputInstanceId: options.outputInstanceId || options.instanceId || ('ogout_' + Math.random().toString(36).slice(2))
    });
    if (!ids.productionSessionId || !ids.controllerInstanceId || !ids.outputId || !ids.outputInstanceId) {
      throw new Error('productionSessionId, controllerInstanceId, outputId, and outputInstanceId are required');
    }
    var sequence = 0;
    var ready = false;
    var syncCommandId = '';
    var pending = Object.create(null);
    var resultCache = new Map();
    var resultOrder = [];
    var cacheLimit = Math.max(8, Math.min(500, Math.floor(finite(options.resultCacheSize, 128))));
    var state = normalizeState(Object.assign({}, ids, options.state || {}, { timestamp: now() }));

    function nextId(kind) {
      sequence += 1;
      return ids.outputInstanceId + '_' + cleanType(kind || 'message') + '_' + now().toString(36) + '_' + sequence;
    }

    function getState() {
      return clone(state, null);
    }

    function update(patch) {
      state = fixedState(state, ids, Object.assign({}, patch || {}, {
        timestamp: finite(patch && patch.timestamp, now()),
        stateVersion: Math.max(state.stateVersion + 1, finite(patch && patch.stateVersion, 0))
      }));
      return getState();
    }

    function accepts(message) {
      var incoming = normalizeEnvelope(message);
      return completeEnvelope(incoming) &&
        incoming.productionSessionId === ids.productionSessionId &&
        incoming.controllerInstanceId === ids.controllerInstanceId &&
        incoming.outputId === ids.outputId &&
        incoming.outputInstanceId === ids.outputInstanceId;
    }

    function buildReady() {
      update({
        windowStatus: 'open', communicationStatus: 'connected', heartbeatStatus: 'healthy',
        lastHeartbeatAt: now(), error: ''
      });
      return envelope(ids, MESSAGE_TYPES.READY, {
        commandId: nextId(MESSAGE_TYPES.READY), cueId: state.cueId, mediaId: state.mediaId,
        payload: { state: getState() }
      }, now);
    }

    function applySyncState(message) {
      var incoming = normalizeEnvelope(message);
      if (incoming.commandType !== MESSAGE_TYPES.SYNC_STATE || !accepts(incoming)) return false;
      var observed = safeRecoveryState(incoming.payload.state, state);
      var wasPlaying = normalizeState(incoming.payload.state, state).playbackStatus === 'playing';
      state = fixedState(observed, ids, {
        windowStatus: 'open', communicationStatus: 'syncing', heartbeatStatus: 'healthy',
        lastHeartbeatAt: incoming.timestamp, playbackStatus: wasPlaying ? 'paused' : observed.playbackStatus,
        recoverability: wasPlaying ? 'operator' : observed.recoverability,
        snapshotId: incoming.commandId, timestamp: now(), error: '',
        stateVersion: Math.max(observed.stateVersion, state.stateVersion) + 1
      });
      ready = false;
      syncCommandId = incoming.commandId;
      pending = Object.create(null);
      return getState();
    }

    function buildStateApplied(commandId) {
      commandId = cleanId(commandId || syncCommandId);
      if (!commandId || commandId !== syncCommandId) return null;
      update({ communicationStatus: 'ready' });
      ready = true;
      return envelope(ids, MESSAGE_TYPES.STATE_APPLIED, {
        commandId: commandId, cueId: state.cueId, mediaId: state.mediaId,
        payload: { state: getState() }
      }, now);
    }

    function buildAck(entry, duplicate) {
      return envelope(ids, MESSAGE_TYPES.COMMAND_ACK, {
        commandId: entry.commandId,
        cueId: entry.cueId,
        mediaId: entry.mediaId,
        payload: {
          forCommandType: entry.commandType,
          result: clone(entry.result, {}),
          state: clone(entry.state, null),
          duplicate: Boolean(duplicate)
        }
      }, now);
    }

    function beginCommand(message) {
      var incoming = normalizeEnvelope(message);
      if (!ready || !accepts(incoming) || SYSTEM_TYPES.has(incoming.commandType)) {
        return { accepted: false, duplicate: false, pending: false, result: null, ack: null };
      }
      var cached = resultCache.get(incoming.commandId);
      if (cached) {
        return {
          accepted: false, duplicate: true, pending: false,
          result: clone(cached.result, {}), ack: buildAck(cached, true)
        };
      }
      if (pending[incoming.commandId]) {
        return { accepted: false, duplicate: true, pending: true, result: null, ack: null };
      }
      pending[incoming.commandId] = incoming;
      return { accepted: true, duplicate: false, pending: false, command: clone(incoming, null), result: null, ack: null };
    }

    function normalizeResult(result) {
      if (result == null) return { ok: true, error: '' };
      if (typeof result === 'boolean') return { ok: result, error: result ? '' : 'Command failed' };
      var normalized = result && typeof result === 'object' ? clone(result, {}) : { value: String(result) };
      normalized.ok = normalized.ok !== false;
      normalized.error = String(normalized.error || '').slice(0, 500);
      return normalized;
    }

    function completeCommand(commandOrId, result, statePatch) {
      var commandId = cleanId(typeof commandOrId === 'string' ? commandOrId : commandOrId && commandOrId.commandId);
      var command = pending[commandId];
      if (!command) return null;
      var normalizedResult = normalizeResult(result);
      update(Object.assign({}, statePatch || {}, {
        cueId: has(statePatch || {}, 'cueId') ? statePatch.cueId : (command.cueId || state.cueId),
        mediaId: has(statePatch || {}, 'mediaId') ? statePatch.mediaId : (command.mediaId || state.mediaId),
        lastAck: {
          commandId: commandId, commandType: command.commandType,
          ok: normalizedResult.ok, timestamp: now(), error: normalizedResult.error
        },
        error: normalizedResult.ok ? '' : normalizedResult.error
      }));
      var entry = {
        commandId: commandId,
        commandType: command.commandType,
        cueId: command.cueId,
        mediaId: command.mediaId,
        result: normalizedResult,
        state: getState()
      };
      delete pending[commandId];
      resultCache.set(commandId, entry);
      resultOrder.push(commandId);
      while (resultOrder.length > cacheLimit) resultCache.delete(resultOrder.shift());
      return buildAck(entry, false);
    }

    function getCachedResult(commandId) {
      var entry = resultCache.get(cleanId(commandId));
      return entry ? clone(entry.result, {}) : null;
    }

    function buildHeartbeat(patch) {
      update(Object.assign({}, patch || {}, {
        windowStatus: 'open', heartbeatStatus: 'healthy', lastHeartbeatAt: now()
      }));
      return envelope(ids, MESSAGE_TYPES.HEARTBEAT, {
        commandId: nextId(MESSAGE_TYPES.HEARTBEAT), cueId: state.cueId, mediaId: state.mediaId,
        payload: { state: getState() }
      }, now);
    }

    function markRecovering(error) {
      var wasPlaying = state.playbackStatus === 'playing';
      ready = false;
      syncCommandId = '';
      pending = Object.create(null);
      state = fixedState(safeRecoveryState(state), ids, {
        communicationStatus: 'recovering', heartbeatStatus: 'dead',
        recoverability: wasPlaying ? 'operator' : 'automatic', error: error || '', timestamp: now(),
        stateVersion: state.stateVersion + 1
      });
      return getState();
    }

    return {
      outputId: ids.outputId,
      outputInstanceId: ids.outputInstanceId,
      getState: getState,
      update: update,
      accepts: accepts,
      buildReady: buildReady,
      applySyncState: applySyncState,
      buildStateApplied: buildStateApplied,
      isReady: function () { return ready; },
      beginCommand: beginCommand,
      completeCommand: completeCommand,
      getCachedResult: getCachedResult,
      buildHeartbeat: buildHeartbeat,
      markRecovering: markRecovering,
      pendingCount: function () { return Object.keys(pending).length; }
    };
  }

  return {
    PROTOCOL_VERSION: PROTOCOL_VERSION,
    MESSAGE_TYPES: MESSAGE_TYPES,
    STATUSES: STATUSES,
    STATE_FIELDS: STATE_FIELDS,
    ENVELOPE_FIELDS: ENVELOPE_FIELDS,
    normalizeState: normalizeState,
    safeRecoveryState: safeRecoveryState,
    normalizeEnvelope: normalizeEnvelope,
    createController: createController,
    createOutput: createOutput
  };
});
