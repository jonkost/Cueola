/* Cueola Script Operator host/popout protocol.
 *
 * Dependency-free identity, snapshot handshake, heartbeat, command, and
 * cleanup helpers shared by the Cueola host window and Script Operator
 * popout. DOM rendering and BroadcastChannel wiring stay in their callers.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.CueolaScriptOperatorProtocol = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var PROTOCOL_VERSION = 1;
  var HEARTBEAT_INTERVAL_MS = 2000;
  var HEARTBEAT_MISSES_ALLOWED = 3;
  var HEARTBEAT_TIMEOUT_MS = HEARTBEAT_INTERVAL_MS * HEARTBEAT_MISSES_ALLOWED;
  var MESSAGE_TYPES = Object.freeze({
    READY: 'READY',
    STATE: 'STATE',
    STATE_APPLIED: 'STATE_APPLIED',
    HEARTBEAT: 'HEARTBEAT',
    COMMAND: 'COMMAND',
    COMMAND_ACK: 'COMMAND_ACK',
    CLOSING: 'CLOSING',
    CONTROLLER_CLOSING: 'CONTROLLER_CLOSING'
  });
  var TYPE_SET = new Set(Object.keys(MESSAGE_TYPES).map(function (key) {
    return MESSAGE_TYPES[key];
  }));
  var ENVELOPE_FIELDS = Object.freeze([
    'protocolVersion', 'type', 'productionCode', 'sessionId',
    'controllerInstanceId', 'operatorInstanceId', 'targetInstanceId',
    'messageId', 'timestamp', 'payload'
  ]);
  var STATE_FIELDS = Object.freeze([
    'protocolVersion', 'productionCode', 'sessionId',
    'controllerInstanceId', 'operatorInstanceId', 'stateVersion',
    'snapshotId', 'timestamp', 'data'
  ]);

  function cleanId(value) {
    return String(value == null ? '' : value)
      .trim()
      .replace(/[^a-zA-Z0-9_.:-]/g, '_')
      .slice(0, 180);
  }

  function cleanType(value) {
    return String(value == null ? '' : value)
      .trim()
      .replace(/[^a-zA-Z0-9_.:-]/g, '_')
      .slice(0, 80);
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

  function identity(input, fallback) {
    input = input && typeof input === 'object' ? input : {};
    fallback = fallback && typeof fallback === 'object' ? fallback : {};
    return {
      productionCode: cleanId(input.productionCode || fallback.productionCode).toUpperCase(),
      sessionId: cleanId(input.sessionId || fallback.sessionId),
      controllerInstanceId: cleanId(input.controllerInstanceId || fallback.controllerInstanceId),
      operatorInstanceId: cleanId(input.operatorInstanceId || fallback.operatorInstanceId)
    };
  }

  function normalizeEnvelope(input) {
    input = input && typeof input === 'object' ? input : {};
    var ids = identity(input);
    var payload = input.payload && typeof input.payload === 'object' && !Array.isArray(input.payload)
      ? clone(input.payload, {})
      : {};
    return {
      protocolVersion: Math.floor(finite(input.protocolVersion, 0)),
      type: cleanType(input.type),
      productionCode: ids.productionCode,
      sessionId: ids.sessionId,
      controllerInstanceId: ids.controllerInstanceId,
      operatorInstanceId: ids.operatorInstanceId,
      targetInstanceId: cleanId(input.targetInstanceId),
      messageId: cleanId(input.messageId),
      timestamp: Math.max(0, finite(input.timestamp, 0)),
      payload: payload
    };
  }

  function completeEnvelope(message) {
    return message.protocolVersion === PROTOCOL_VERSION &&
      TYPE_SET.has(message.type) &&
      Boolean(message.productionCode && message.sessionId &&
        message.controllerInstanceId && message.operatorInstanceId &&
        message.targetInstanceId && message.messageId);
  }

  function normalizeState(input, fallback) {
    input = input && typeof input === 'object' ? input : {};
    fallback = fallback && typeof fallback === 'object' ? fallback : {};
    var ids = identity(input, fallback);
    var sourceData = has(input, 'data') ? input.data : fallback.data;
    return {
      protocolVersion: PROTOCOL_VERSION,
      productionCode: ids.productionCode,
      sessionId: ids.sessionId,
      controllerInstanceId: ids.controllerInstanceId,
      operatorInstanceId: ids.operatorInstanceId,
      stateVersion: Math.max(0, Math.floor(finite(input.stateVersion, finite(fallback.stateVersion, 0)))),
      snapshotId: cleanId(has(input, 'snapshotId') ? input.snapshotId : fallback.snapshotId),
      timestamp: Math.max(0, finite(input.timestamp, finite(fallback.timestamp, 0))),
      data: clone(sourceData, {})
    };
  }

  function normalizeResult(result) {
    if (result == null) return { ok: true, error: '' };
    if (typeof result === 'boolean') {
      return { ok: result, error: result ? '' : 'Command failed' };
    }
    var normalized = result && typeof result === 'object'
      ? clone(result, {})
      : { value: String(result) };
    normalized.ok = normalized.ok !== false;
    normalized.error = String(normalized.error || '').slice(0, 500);
    return normalized;
  }

  function cacheLimit(value, fallback) {
    return Math.max(1, Math.min(1000, Math.floor(finite(value, fallback))));
  }

  function createBoundedSet(limit) {
    var values = new Set();
    var order = [];
    return {
      add: function (value) {
        value = cleanId(value);
        if (!value || values.has(value)) return false;
        values.add(value);
        order.push(value);
        while (order.length > limit) values.delete(order.shift());
        return true;
      },
      has: function (value) { return values.has(cleanId(value)); },
      size: function () { return values.size; },
      clear: function () { values.clear(); order = []; }
    };
  }

  function putBoundedResult(cache, order, key, value, limit) {
    if (!cache.has(key)) order.push(key);
    cache.set(key, value);
    while (order.length > limit) cache.delete(order.shift());
  }

  function channelName(input) {
    var ids = identity(input);
    if (!ids.productionCode || !ids.sessionId || !ids.controllerInstanceId) {
      throw new Error('productionCode, sessionId, and controllerInstanceId are required');
    }
    return [
      'cueola-script-operator-v' + PROTOCOL_VERSION,
      ids.productionCode,
      ids.sessionId,
      ids.controllerInstanceId
    ].join(':');
  }

  function makeEnvelope(ids, type, targetInstanceId, options, now) {
    options = options || {};
    return normalizeEnvelope({
      protocolVersion: PROTOCOL_VERSION,
      type: type,
      productionCode: ids.productionCode,
      sessionId: ids.sessionId,
      controllerInstanceId: ids.controllerInstanceId,
      operatorInstanceId: options.operatorInstanceId || ids.operatorInstanceId,
      targetInstanceId: targetInstanceId,
      messageId: options.messageId,
      timestamp: finite(options.timestamp, now()),
      payload: options.payload || {}
    });
  }

  function requiredIdentity(options, requireOperator) {
    var ids = identity(options);
    if (!ids.productionCode || !ids.sessionId || !ids.controllerInstanceId ||
        (requireOperator && !ids.operatorInstanceId)) {
      throw new Error('productionCode, sessionId, controllerInstanceId' +
        (requireOperator ? ', and operatorInstanceId are required' : ' are required'));
    }
    return ids;
  }

  function createHost(options) {
    options = options || {};
    var now = typeof options.now === 'function' ? options.now : Date.now;
    var ids = requiredIdentity(options, false);
    var sequence = 0;
    var closed = false;
    var closeNotified = false;
    var onClose = typeof options.onClose === 'function' ? options.onClose : null;
    var messageLimit = cacheLimit(options.messageCacheSize, 128);
    var commandLimit = cacheLimit(options.commandCacheSize, 128);
    var seenMessages = createBoundedSet(messageLimit);
    var retiredOperators = createBoundedSet(messageLimit);
    var pendingCommands = Object.create(null);
    var resultCache = new Map();
    var resultOrder = [];
    var operator = null;
    var state = normalizeState({
      productionCode: ids.productionCode,
      sessionId: ids.sessionId,
      controllerInstanceId: ids.controllerInstanceId,
      data: has(options, 'state') ? options.state : {},
      timestamp: now()
    });

    function nextId(kind) {
      sequence += 1;
      return ids.controllerInstanceId + '_' + cleanType(kind || 'message') + '_' + now().toString(36) + '_' + sequence;
    }

    function hostEnvelope(type, operatorInstanceId, options) {
      options = options || {};
      options.operatorInstanceId = operatorInstanceId;
      options.messageId = cleanId(options.messageId || nextId(type));
      return makeEnvelope(ids, type, operatorInstanceId, options, now);
    }

    function accepts(message, acceptOptions) {
      acceptOptions = acceptOptions || {};
      var incoming = normalizeEnvelope(message);
      if (!completeEnvelope(incoming) ||
          incoming.productionCode !== ids.productionCode ||
          incoming.sessionId !== ids.sessionId ||
          incoming.controllerInstanceId !== ids.controllerInstanceId ||
          incoming.targetInstanceId !== ids.controllerInstanceId) return false;
      if (retiredOperators.has(incoming.operatorInstanceId)) return false;
      if (!acceptOptions.allowReplacement &&
          (!operator || incoming.operatorInstanceId !== operator.operatorInstanceId)) return false;
      return true;
    }

    function getState() {
      return clone(state, null);
    }

    function getStatus() {
      return {
        closed: closed,
        connected: Boolean(operator && operator.connected),
        ready: Boolean(operator && operator.ready),
        timedOut: Boolean(operator && operator.timedOut),
        operatorInstanceId: operator ? operator.operatorInstanceId : '',
        lastHeartbeatAt: operator ? operator.lastHeartbeatAt : 0,
        expectedSnapshotId: operator ? operator.expectedSnapshotId : '',
        expectedStateVersion: operator ? operator.expectedStateVersion : 0,
        stateVersion: state.stateVersion,
        pendingCommands: Object.keys(pendingCommands).length
      };
    }

    function clearCommands() {
      pendingCommands = Object.create(null);
      resultCache.clear();
      resultOrder = [];
    }

    function noteReady(message) {
      var incoming = normalizeEnvelope(message);
      if (closed || incoming.type !== MESSAGE_TYPES.READY ||
          !accepts(incoming, { allowReplacement: true }) ||
          seenMessages.has(incoming.messageId)) return false;
      seenMessages.add(incoming.messageId);
      if (operator && operator.operatorInstanceId !== incoming.operatorInstanceId) {
        retiredOperators.add(operator.operatorInstanceId);
        clearCommands();
      }
      operator = {
        operatorInstanceId: incoming.operatorInstanceId,
        connected: true,
        ready: false,
        timedOut: false,
        lastHeartbeatAt: now(),
        expectedSnapshotId: '',
        expectedStateVersion: 0
      };
      state = normalizeState({
        productionCode: ids.productionCode,
        sessionId: ids.sessionId,
        controllerInstanceId: ids.controllerInstanceId,
        operatorInstanceId: operator.operatorInstanceId,
        stateVersion: state.stateVersion,
        snapshotId: state.snapshotId,
        timestamp: now(),
        data: state.data
      }, state);
      return getStatus();
    }

    function buildState(snapshot, stateOptions) {
      stateOptions = stateOptions || {};
      if (closed || !operator || !operator.connected) return null;
      var messageId = nextId(MESSAGE_TYPES.STATE);
      var snapshotId = cleanId(stateOptions.snapshotId || messageId);
      var nextVersion = Math.max(
        state.stateVersion + 1,
        Math.floor(finite(stateOptions.stateVersion, 0))
      );
      state = normalizeState({
        productionCode: ids.productionCode,
        sessionId: ids.sessionId,
        controllerInstanceId: ids.controllerInstanceId,
        operatorInstanceId: operator.operatorInstanceId,
        stateVersion: nextVersion,
        snapshotId: snapshotId,
        timestamp: now(),
        data: snapshot === undefined ? state.data : snapshot
      }, state);
      operator.ready = false;
      operator.expectedSnapshotId = snapshotId;
      operator.expectedStateVersion = state.stateVersion;
      return hostEnvelope(MESSAGE_TYPES.STATE, operator.operatorInstanceId, {
        messageId: messageId,
        payload: { state: getState() }
      });
    }

    function markStateApplied(message) {
      var incoming = normalizeEnvelope(message);
      if (closed || incoming.type !== MESSAGE_TYPES.STATE_APPLIED ||
          !accepts(incoming) || seenMessages.has(incoming.messageId) ||
          !operator.expectedSnapshotId) return false;
      var snapshotId = cleanId(incoming.payload.snapshotId);
      var stateVersion = Math.max(0, Math.floor(finite(incoming.payload.stateVersion, -1)));
      if (snapshotId !== operator.expectedSnapshotId ||
          snapshotId !== state.snapshotId ||
          stateVersion !== operator.expectedStateVersion ||
          stateVersion !== state.stateVersion) return false;
      seenMessages.add(incoming.messageId);
      operator.ready = true;
      operator.connected = true;
      operator.timedOut = false;
      operator.lastHeartbeatAt = now();
      return true;
    }

    function isReady(operatorInstanceId) {
      return Boolean(!closed && operator && operator.ready && operator.connected &&
        !operator.timedOut && operator.expectedSnapshotId === state.snapshotId &&
        operator.expectedStateVersion === state.stateVersion &&
        (!operatorInstanceId || operator.operatorInstanceId === cleanId(operatorInstanceId)));
    }

    function buildHeartbeat() {
      if (closed || !operator) return null;
      return hostEnvelope(MESSAGE_TYPES.HEARTBEAT, operator.operatorInstanceId, {
        payload: {
          ready: isReady(),
          snapshotId: state.snapshotId,
          stateVersion: state.stateVersion
        }
      });
    }

    function noteHeartbeat(message) {
      var incoming = normalizeEnvelope(message);
      if (closed || incoming.type !== MESSAGE_TYPES.HEARTBEAT ||
          !accepts(incoming) || seenMessages.has(incoming.messageId)) return false;
      seenMessages.add(incoming.messageId);
      operator.connected = true;
      operator.timedOut = false;
      operator.lastHeartbeatAt = now();
      return true;
    }

    function checkHeartbeat(at) {
      at = finite(at, now());
      if (closed || !operator) return false;
      if (at - operator.lastHeartbeatAt < HEARTBEAT_TIMEOUT_MS) {
        return operator.connected && !operator.timedOut;
      }
      operator.connected = false;
      operator.ready = false;
      operator.timedOut = true;
      operator.expectedSnapshotId = '';
      operator.expectedStateVersion = 0;
      pendingCommands = Object.create(null);
      return false;
    }

    function buildCommandAck(entry, duplicate) {
      return hostEnvelope(MESSAGE_TYPES.COMMAND_ACK, entry.operatorInstanceId, {
        payload: {
          commandId: entry.commandId,
          commandType: entry.commandType,
          result: clone(entry.result, {}),
          duplicate: Boolean(duplicate)
        }
      });
    }

    function rejectedCommand(duplicate, pending, ack, result) {
      return {
        accepted: false,
        duplicate: Boolean(duplicate),
        pending: Boolean(pending),
        command: null,
        result: result || null,
        ack: ack || null
      };
    }

    function beginCommand(message) {
      var incoming = normalizeEnvelope(message);
      if (closed || !isReady() || incoming.type !== MESSAGE_TYPES.COMMAND || !accepts(incoming)) {
        return rejectedCommand(false, false, null, null);
      }
      var cached = resultCache.get(incoming.messageId);
      if (cached) {
        return rejectedCommand(true, false, buildCommandAck(cached, true), clone(cached.result, {}));
      }
      if (pendingCommands[incoming.messageId]) {
        return rejectedCommand(true, true, null, null);
      }
      if (seenMessages.has(incoming.messageId)) {
        return rejectedCommand(true, false, null, null);
      }
      var commandType = cleanType(incoming.payload.commandType);
      if (!commandType) return rejectedCommand(false, false, null, null);
      seenMessages.add(incoming.messageId);
      var entry = {
        commandId: incoming.messageId,
        commandType: commandType,
        operatorInstanceId: incoming.operatorInstanceId,
        data: clone(incoming.payload.data, {})
      };
      pendingCommands[incoming.messageId] = entry;
      return {
        accepted: true,
        duplicate: false,
        pending: false,
        command: clone(entry, null),
        result: null,
        ack: null
      };
    }

    function completeCommand(commandOrId, result) {
      var commandId = cleanId(typeof commandOrId === 'string'
        ? commandOrId
        : (commandOrId && (commandOrId.commandId || commandOrId.messageId)));
      var pending = pendingCommands[commandId];
      if (closed || !pending) return null;
      var entry = {
        commandId: commandId,
        commandType: pending.commandType,
        operatorInstanceId: pending.operatorInstanceId,
        result: normalizeResult(result)
      };
      delete pendingCommands[commandId];
      putBoundedResult(resultCache, resultOrder, commandId, entry, commandLimit);
      return buildCommandAck(entry, false);
    }

    function getCachedResult(commandId) {
      var entry = resultCache.get(cleanId(commandId));
      return entry ? clone(entry.result, {}) : null;
    }

    function noteClosing(message) {
      var incoming = normalizeEnvelope(message);
      if (closed || incoming.type !== MESSAGE_TYPES.CLOSING ||
          !accepts(incoming) || seenMessages.has(incoming.messageId)) return false;
      seenMessages.add(incoming.messageId);
      operator.connected = false;
      operator.ready = false;
      operator.expectedSnapshotId = '';
      operator.expectedStateVersion = 0;
      retiredOperators.add(operator.operatorInstanceId);
      pendingCommands = Object.create(null);
      return true;
    }

    function close(reason) {
      if (closed) return null;
      var message = operator
        ? hostEnvelope(MESSAGE_TYPES.CONTROLLER_CLOSING, operator.operatorInstanceId, {
            payload: { reason: String(reason || '').slice(0, 300) }
          })
        : null;
      closed = true;
      if (operator) {
        operator.connected = false;
        operator.ready = false;
      }
      pendingCommands = Object.create(null);
      if (!closeNotified) {
        closeNotified = true;
        if (onClose) onClose();
      }
      return message;
    }

    return {
      channelName: channelName(ids),
      controllerInstanceId: ids.controllerInstanceId,
      getState: getState,
      getStatus: getStatus,
      accepts: accepts,
      noteReady: noteReady,
      buildState: buildState,
      markStateApplied: markStateApplied,
      isReady: isReady,
      buildHeartbeat: buildHeartbeat,
      noteHeartbeat: noteHeartbeat,
      checkHeartbeat: checkHeartbeat,
      beginCommand: beginCommand,
      completeCommand: completeCommand,
      getCachedResult: getCachedResult,
      noteClosing: noteClosing,
      close: close,
      isClosed: function () { return closed; },
      cacheInfo: function () {
        return { messages: seenMessages.size(), commands: resultCache.size };
      }
    };
  }

  function createOperator(options) {
    options = options || {};
    var now = typeof options.now === 'function' ? options.now : Date.now;
    var ids = requiredIdentity(options, true);
    var sequence = 0;
    var closed = false;
    var controllerClosed = false;
    var closeNotified = false;
    var onClose = typeof options.onClose === 'function' ? options.onClose : null;
    var messageLimit = cacheLimit(options.messageCacheSize, 128);
    var seenMessages = createBoundedSet(messageLimit);
    var pendingCommands = Object.create(null);
    var connected = false;
    var ready = false;
    var timedOut = false;
    var lastControllerHeartbeatAt = 0;
    var expectedSnapshotId = '';
    var expectedStateVersion = 0;
    var lastAck = null;
    var state = normalizeState({
      productionCode: ids.productionCode,
      sessionId: ids.sessionId,
      controllerInstanceId: ids.controllerInstanceId,
      operatorInstanceId: ids.operatorInstanceId,
      data: {},
      timestamp: now()
    });

    function nextId(kind) {
      sequence += 1;
      return ids.operatorInstanceId + '_' + cleanType(kind || 'message') + '_' + now().toString(36) + '_' + sequence;
    }

    function operatorEnvelope(type, options) {
      options = options || {};
      options.messageId = cleanId(options.messageId || nextId(type));
      return makeEnvelope(ids, type, ids.controllerInstanceId, options, now);
    }

    function accepts(message) {
      var incoming = normalizeEnvelope(message);
      return completeEnvelope(incoming) &&
        incoming.productionCode === ids.productionCode &&
        incoming.sessionId === ids.sessionId &&
        incoming.controllerInstanceId === ids.controllerInstanceId &&
        incoming.operatorInstanceId === ids.operatorInstanceId &&
        incoming.targetInstanceId === ids.operatorInstanceId;
    }

    function getState() {
      return clone(state, null);
    }

    function getStatus() {
      return {
        closed: closed,
        controllerClosed: controllerClosed,
        connected: connected,
        ready: ready,
        timedOut: timedOut,
        lastHeartbeatAt: lastControllerHeartbeatAt,
        expectedSnapshotId: expectedSnapshotId,
        expectedStateVersion: expectedStateVersion,
        stateVersion: state.stateVersion,
        pendingCommands: Object.keys(pendingCommands).length,
        lastAck: clone(lastAck, null)
      };
    }

    function buildReady() {
      if (closed) return null;
      ready = false;
      return operatorEnvelope(MESSAGE_TYPES.READY, {
        payload: {
          lastSnapshotId: state.snapshotId,
          lastStateVersion: state.stateVersion
        }
      });
    }

    function applyState(message) {
      var incoming = normalizeEnvelope(message);
      if (closed || incoming.type !== MESSAGE_TYPES.STATE ||
          !accepts(incoming) || seenMessages.has(incoming.messageId)) return false;
      var observed = normalizeState(incoming.payload.state, state);
      if (observed.productionCode !== ids.productionCode ||
          observed.sessionId !== ids.sessionId ||
          observed.controllerInstanceId !== ids.controllerInstanceId ||
          observed.operatorInstanceId !== ids.operatorInstanceId ||
          !observed.snapshotId || observed.stateVersion <= state.stateVersion) return false;
      seenMessages.add(incoming.messageId);
      state = observed;
      expectedSnapshotId = state.snapshotId;
      expectedStateVersion = state.stateVersion;
      connected = true;
      timedOut = false;
      lastControllerHeartbeatAt = now();
      ready = false;
      return getState();
    }

    function buildStateApplied() {
      if (closed || !connected || !expectedSnapshotId) return null;
      ready = true;
      return operatorEnvelope(MESSAGE_TYPES.STATE_APPLIED, {
        payload: {
          snapshotId: expectedSnapshotId,
          stateVersion: expectedStateVersion
        }
      });
    }

    function isReady() {
      return Boolean(!closed && connected && ready && !timedOut &&
        expectedSnapshotId && expectedSnapshotId === state.snapshotId &&
        expectedStateVersion === state.stateVersion);
    }

    function buildHeartbeat() {
      if (closed) return null;
      return operatorEnvelope(MESSAGE_TYPES.HEARTBEAT, {
        payload: {
          ready: isReady(),
          snapshotId: state.snapshotId,
          stateVersion: state.stateVersion
        }
      });
    }

    function noteHeartbeat(message) {
      var incoming = normalizeEnvelope(message);
      if (closed || incoming.type !== MESSAGE_TYPES.HEARTBEAT ||
          !accepts(incoming) || seenMessages.has(incoming.messageId)) return false;
      seenMessages.add(incoming.messageId);
      connected = true;
      timedOut = false;
      lastControllerHeartbeatAt = now();
      return true;
    }

    function checkHeartbeat(at) {
      at = finite(at, now());
      if (closed || !lastControllerHeartbeatAt) return false;
      if (at - lastControllerHeartbeatAt < HEARTBEAT_TIMEOUT_MS) {
        return connected && !timedOut;
      }
      connected = false;
      ready = false;
      timedOut = true;
      expectedSnapshotId = '';
      expectedStateVersion = 0;
      pendingCommands = Object.create(null);
      return false;
    }

    function buildCommand(commandType, data, commandOptions) {
      commandOptions = commandOptions || {};
      commandType = cleanType(commandType);
      if (!isReady() || !commandType) return null;
      var messageId = cleanId(commandOptions.messageId || nextId(MESSAGE_TYPES.COMMAND));
      if (pendingCommands[messageId]) return clone(pendingCommands[messageId], null);
      var message = operatorEnvelope(MESSAGE_TYPES.COMMAND, {
        messageId: messageId,
        payload: {
          commandId: messageId,
          commandType: commandType,
          data: clone(data, {})
        }
      });
      pendingCommands[messageId] = message;
      return clone(message, null);
    }

    function noteCommandAck(message) {
      var incoming = normalizeEnvelope(message);
      if (closed || incoming.type !== MESSAGE_TYPES.COMMAND_ACK ||
          !accepts(incoming) || seenMessages.has(incoming.messageId)) return false;
      var commandId = cleanId(incoming.payload.commandId);
      if (!pendingCommands[commandId]) return false;
      seenMessages.add(incoming.messageId);
      delete pendingCommands[commandId];
      lastAck = {
        commandId: commandId,
        commandType: cleanType(incoming.payload.commandType),
        result: normalizeResult(incoming.payload.result),
        timestamp: incoming.timestamp,
        duplicate: Boolean(incoming.payload.duplicate)
      };
      return clone(lastAck.result, {});
    }

    function notifyClose() {
      if (closeNotified) return;
      closeNotified = true;
      if (onClose) onClose();
    }

    function noteControllerClosing(message) {
      var incoming = normalizeEnvelope(message);
      if (closed || incoming.type !== MESSAGE_TYPES.CONTROLLER_CLOSING ||
          !accepts(incoming) || seenMessages.has(incoming.messageId)) return false;
      seenMessages.add(incoming.messageId);
      controllerClosed = true;
      closed = true;
      connected = false;
      ready = false;
      expectedSnapshotId = '';
      expectedStateVersion = 0;
      pendingCommands = Object.create(null);
      notifyClose();
      return true;
    }

    function close(reason) {
      if (closed) return null;
      var message = operatorEnvelope(MESSAGE_TYPES.CLOSING, {
        payload: { reason: String(reason || '').slice(0, 300) }
      });
      closed = true;
      connected = false;
      ready = false;
      pendingCommands = Object.create(null);
      notifyClose();
      return message;
    }

    return {
      channelName: channelName(ids),
      operatorInstanceId: ids.operatorInstanceId,
      getState: getState,
      getStatus: getStatus,
      accepts: accepts,
      buildReady: buildReady,
      applyState: applyState,
      buildStateApplied: buildStateApplied,
      isReady: isReady,
      buildHeartbeat: buildHeartbeat,
      noteHeartbeat: noteHeartbeat,
      checkHeartbeat: checkHeartbeat,
      buildCommand: buildCommand,
      noteCommandAck: noteCommandAck,
      noteControllerClosing: noteControllerClosing,
      close: close,
      isClosed: function () { return closed; },
      pendingCount: function () { return Object.keys(pendingCommands).length; },
      cacheInfo: function () { return { messages: seenMessages.size() }; }
    };
  }

  return {
    PROTOCOL_VERSION: PROTOCOL_VERSION,
    HEARTBEAT_INTERVAL_MS: HEARTBEAT_INTERVAL_MS,
    HEARTBEAT_MISSES_ALLOWED: HEARTBEAT_MISSES_ALLOWED,
    HEARTBEAT_TIMEOUT_MS: HEARTBEAT_TIMEOUT_MS,
    MESSAGE_TYPES: MESSAGE_TYPES,
    ENVELOPE_FIELDS: ENVELOPE_FIELDS,
    STATE_FIELDS: STATE_FIELDS,
    channelName: channelName,
    normalizeEnvelope: normalizeEnvelope,
    normalizeState: normalizeState,
    createHost: createHost,
    createOperator: createOperator
  };
});
