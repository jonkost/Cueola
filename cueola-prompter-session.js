/* Cueola Flowmingo session protocol.
 *
 * Dependency-free, serializable state and handshake helpers shared by the
 * Cueola operator, Script Op, Flowmingo Op, and talent display. DOM rendering
 * stays in cueola-app.js; this module owns protocol identity and state shape.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.CueolaPrompterSession = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var PROTOCOL_VERSION = 2;
  var STATUSES = Object.freeze([
    'closed', 'opening', 'connected', 'ready', 'running', 'paused', 'recovering', 'error'
  ]);
  var STATUS_SET = new Set(STATUSES);
  var STATE_FIELDS = Object.freeze([
    'protocolVersion', 'sessionId', 'productionCode', 'scriptId',
    'activeCueId', 'running', 'position', 'targetSpeed', 'effectiveSpeed',
    'lastCommandId', 'lastUpdateTimestamp', 'connectedOperatorWindows',
    'error', 'outputInstanceId', 'status', 'stateVersion', 'snapshotId'
  ]);

  function cleanId(value) {
    return String(value || '').trim().replace(/[^a-zA-Z0-9_.:-]/g, '_').slice(0, 180);
  }

  function finite(value, fallback) {
    var number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function normalizeState(input, fallback) {
    input = input && typeof input === 'object' ? input : {};
    fallback = fallback && typeof fallback === 'object' ? fallback : {};
    var status = STATUS_SET.has(input.status) ? input.status : (STATUS_SET.has(fallback.status) ? fallback.status : 'closed');
    var operators = Array.isArray(input.connectedOperatorWindows)
      ? input.connectedOperatorWindows
      : (Array.isArray(fallback.connectedOperatorWindows) ? fallback.connectedOperatorWindows : []);
    return {
      protocolVersion: PROTOCOL_VERSION,
      sessionId: cleanId(input.sessionId || fallback.sessionId),
      productionCode: cleanId(input.productionCode || fallback.productionCode).toUpperCase(),
      scriptId: cleanId(input.scriptId || fallback.scriptId),
      activeCueId: cleanId(input.activeCueId || fallback.activeCueId),
      running: typeof input.running === 'boolean' ? input.running : Boolean(fallback.running),
      position: Math.max(0, finite(input.position, finite(fallback.position, 0))),
      targetSpeed: Math.max(0, finite(input.targetSpeed, finite(fallback.targetSpeed, 60))),
      effectiveSpeed: Math.max(0, finite(input.effectiveSpeed, finite(fallback.effectiveSpeed, 60))),
      lastCommandId: cleanId(input.lastCommandId || fallback.lastCommandId),
      lastUpdateTimestamp: Math.max(0, finite(input.lastUpdateTimestamp, finite(fallback.lastUpdateTimestamp, 0))),
      connectedOperatorWindows: Array.from(new Set(operators.map(cleanId).filter(Boolean))).slice(0, 24),
      error: String(input.error != null ? input.error : (fallback.error || '')).slice(0, 500),
      outputInstanceId: cleanId(input.outputInstanceId || fallback.outputInstanceId),
      status: status,
      stateVersion: Math.max(0, Math.floor(finite(input.stateVersion, finite(fallback.stateVersion, 0)))),
      snapshotId: cleanId(input.snapshotId || fallback.snapshotId)
    };
  }

  function createController(options) {
    options = options || {};
    var now = typeof options.now === 'function' ? options.now : Date.now;
    var instanceId = cleanId(options.instanceId || ('flow_' + Math.random().toString(36).slice(2)));
    var sequence = 0;
    var appliedSnapshotByOutput = Object.create(null);
    var queuedCommands = [];
    var state = normalizeState({
      productionCode: options.productionCode,
      sessionId: options.sessionId,
      status: options.status || 'closed',
      lastUpdateTimestamp: now()
    });

    function nextId(kind) {
      sequence += 1;
      return instanceId + '_' + cleanId(kind || 'msg') + '_' + now().toString(36) + '_' + sequence;
    }

    function getState() {
      return clone(state);
    }

    function update(patch, options) {
      options = options || {};
      var next = normalizeState(patch, state);
      next.stateVersion = options.preserveVersion
        ? next.stateVersion
        : Math.max(state.stateVersion + 1, next.stateVersion);
      next.lastUpdateTimestamp = finite(patch && patch.lastUpdateTimestamp, now());
      state = next;
      return getState();
    }

    function setStatus(status, error) {
      if (!STATUS_SET.has(status)) throw new Error('Unknown prompter status: ' + status);
      return update({ status: status, error: error || '' });
    }

    function setIdentity(identity) {
      identity = identity || {};
      return update({
        sessionId: identity.sessionId,
        productionCode: identity.productionCode,
        scriptId: identity.scriptId,
        activeCueId: identity.activeCueId
      });
    }

    function setTransport(transport) {
      transport = transport || {};
      var running = typeof transport.running === 'boolean' ? transport.running : state.running;
      return update({
        running: running,
        position: transport.position,
        targetSpeed: transport.targetSpeed,
        effectiveSpeed: transport.effectiveSpeed,
        lastCommandId: transport.lastCommandId,
        status: transport.status || (running ? 'running' : 'paused')
      });
    }

    function noteOperator(operatorId, connected) {
      operatorId = cleanId(operatorId);
      if (!operatorId) return getState();
      var operators = state.connectedOperatorWindows.filter(function (id) { return id !== operatorId; });
      if (connected !== false) operators.push(operatorId);
      return update({ connectedOperatorWindows: operators });
    }

    function noteOutput(outputId, status) {
      outputId = cleanId(outputId);
      if (!outputId) return getState();
      if (state.outputInstanceId && state.outputInstanceId !== outputId) {
        appliedSnapshotByOutput = Object.create(null);
        queuedCommands = queuedCommands.map(function (command) {
          return Object.assign({}, command, {
            outputInstanceId: outputId,
            targetOutputInstanceId: outputId
          });
        });
      }
      return update({ outputInstanceId: outputId, status: status || 'connected', error: '' });
    }

    function envelope(type, payload) {
      payload = payload || {};
      return Object.assign({}, payload, {
        type: type,
        protocolVersion: PROTOCOL_VERSION,
        sessionId: cleanId(payload.sessionId || state.sessionId),
        productionCode: cleanId(payload.productionCode || state.productionCode).toUpperCase(),
        senderInstanceId: instanceId,
        outputInstanceId: cleanId(payload.outputInstanceId || state.outputInstanceId),
        mid: cleanId(payload.mid || nextId(type)),
        ts: finite(payload.ts, now())
      });
    }

    function buildReady(reason) {
      return envelope('PROMPTER_READY', {
        reason: reason || 'ready',
        outputInstanceId: instanceId
      });
    }

    function buildSnapshot(extra) {
      extra = extra || {};
      var snapshotId = cleanId(extra.snapshotId || nextId('snapshot'));
      state = normalizeState(Object.assign({}, state, extra.state || {}, {
        snapshotId: snapshotId,
        outputInstanceId: extra.outputInstanceId || state.outputInstanceId,
        lastUpdateTimestamp: now(),
        stateVersion: state.stateVersion + 1
      }), state);
      return envelope('PROMPTER_STATE', {
        snapshotId: snapshotId,
        targetOutputInstanceId: cleanId(extra.outputInstanceId || state.outputInstanceId),
        state: getState()
      });
    }

    function applySnapshot(snapshot, outputId) {
      if (!snapshot || typeof snapshot !== 'object') throw new Error('Prompter snapshot is required');
      var incoming = normalizeState(snapshot, state);
      outputId = cleanId(outputId || incoming.outputInstanceId || instanceId);
      incoming.outputInstanceId = outputId;
      incoming.status = incoming.running ? 'running' : 'paused';
      state = incoming;
      return getState();
    }

    function buildStateApplied(snapshotId) {
      return envelope('PROMPTER_STATE_APPLIED', {
        snapshotId: cleanId(snapshotId || state.snapshotId),
        outputInstanceId: instanceId,
        state: getState()
      });
    }

    function markStateApplied(outputId, snapshotId, observedState) {
      outputId = cleanId(outputId);
      snapshotId = cleanId(snapshotId);
      if (!outputId || !snapshotId) return false;
      if (state.outputInstanceId && state.outputInstanceId !== outputId) return false;
      if (state.snapshotId && state.snapshotId !== snapshotId) return false;
      appliedSnapshotByOutput[outputId] = snapshotId;
      if (observedState && typeof observedState === 'object') {
        state = normalizeState(observedState, state);
        state.outputInstanceId = outputId;
        state.snapshotId = snapshotId;
      }
      state.status = state.running ? 'running' : 'ready';
      state.error = '';
      state.lastUpdateTimestamp = now();
      return true;
    }

    function isReady(outputId) {
      outputId = cleanId(outputId || state.outputInstanceId);
      return Boolean(outputId && appliedSnapshotByOutput[outputId] && appliedSnapshotByOutput[outputId] === state.snapshotId);
    }

    function markDisconnected(outputId, error) {
      outputId = cleanId(outputId || state.outputInstanceId);
      if (outputId) delete appliedSnapshotByOutput[outputId];
      state = normalizeState({
        status:'recovering',
        error:error || '',
        outputInstanceId:outputId,
        lastUpdateTimestamp:now(),
        stateVersion:state.stateVersion + 1
      }, state);
      return getState();
    }

    function buildHeartbeat() {
      return envelope('PROMPTER_HEARTBEAT', {
        outputInstanceId: instanceId,
        snapshotId: state.snapshotId,
        state: getState()
      });
    }

    function buildCommand(action, payload) {
      var commandId = nextId('command');
      return envelope('PROMPTER_COMMAND', {
        action: String(action || ''),
        commandId: commandId,
        targetOutputInstanceId: state.outputInstanceId,
        payload: payload || {}
      });
    }

    function queueCommand(command) {
      if (!command || !command.commandId) return false;
      if (queuedCommands.some(function (item) { return item.commandId === command.commandId; })) return false;
      queuedCommands.push(clone(command));
      if (queuedCommands.length > 100) queuedCommands = queuedCommands.slice(-50);
      return true;
    }

    function takeQueuedCommands(outputId) {
      if (!isReady(outputId)) return [];
      outputId = cleanId(outputId || state.outputInstanceId);
      var ready = queuedCommands.map(function (command) {
        return Object.assign({}, command, {
          outputInstanceId: outputId,
          targetOutputInstanceId: outputId
        });
      });
      queuedCommands = [];
      return clone(ready);
    }

    function accepts(message, options) {
      options = options || {};
      if (!message || typeof message !== 'object') return false;
      if (Number(message.protocolVersion) !== PROTOCOL_VERSION) return Boolean(options.allowLegacy && !message.protocolVersion);
      var code = cleanId(message.productionCode || '').toUpperCase();
      if (state.productionCode && code && code !== state.productionCode) return false;
      var sessionId = cleanId(message.sessionId || '');
      if (state.sessionId && sessionId && sessionId !== state.sessionId) return false;
      var target = cleanId(message.targetOutputInstanceId || '');
      if (target && target !== instanceId && target !== state.outputInstanceId) return false;
      if (options.outputInstanceId) {
        var output = cleanId(message.outputInstanceId || message.senderInstanceId || '');
        if (output && output !== cleanId(options.outputInstanceId)) return false;
      }
      return true;
    }

    return {
      instanceId: instanceId,
      getState: getState,
      update: update,
      setStatus: setStatus,
      setIdentity: setIdentity,
      setTransport: setTransport,
      noteOperator: noteOperator,
      noteOutput: noteOutput,
      envelope: envelope,
      buildReady: buildReady,
      buildSnapshot: buildSnapshot,
      applySnapshot: applySnapshot,
      buildStateApplied: buildStateApplied,
      markStateApplied: markStateApplied,
      isReady: isReady,
      markDisconnected: markDisconnected,
      buildHeartbeat: buildHeartbeat,
      buildCommand: buildCommand,
      queueCommand: queueCommand,
      takeQueuedCommands: takeQueuedCommands,
      accepts: accepts
    };
  }

  return {
    PROTOCOL_VERSION: PROTOCOL_VERSION,
    STATUSES: STATUSES,
    STATE_FIELDS: STATE_FIELDS,
    normalizeState: normalizeState,
    createController: createController
  };
});
