/* Cueola Outrangutan output command queue.
 *
 * Dependency-free serialization and invalidation for asynchronous renderer
 * commands. A destructive command advances the generation synchronously when
 * submitted, allowing an older in-flight command to check isCurrent() before
 * it changes the visible output.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.CueolaOutputCommandQueue = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var DEFAULT_MAX_RESULTS = 128;

  function commandId(command) {
    if (!command || typeof command !== 'object') return '';
    return String(command.commandId || command.id || '').trim().slice(0, 240);
  }

  function positiveInteger(value, fallback) {
    var number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    return Math.max(1, Math.floor(number));
  }

  function serializeError(error) {
    var source = error && typeof error === 'object' ? error : {};
    var output = {
      name: String(source.name || 'Error'),
      message: String(source.message || error || 'Output command failed')
    };
    if (source.code != null) output.code = String(source.code);
    return Object.freeze(output);
  }

  function createQueue(options) {
    options = options || {};
    var apply = typeof options.apply === 'function' ? options.apply : null;
    var isDestructive = typeof options.isDestructive === 'function'
      ? options.isDestructive
      : function (command) { return Boolean(command && command.destructive); };
    var onInvalidate = typeof options.onInvalidate === 'function' ? options.onInvalidate : null;
    var maxResults = positiveInteger(options.maxResults, DEFAULT_MAX_RESULTS);
    var generation = 0;
    var closed = false;
    var closeReason = '';
    var pendingCount = 0;
    var tail = Promise.resolve();
    var inFlight = new Map();
    var cancellationSignals = new Map();
    var results = new Map();

    function state() {
      return Object.freeze({
        generation: generation,
        closed: closed,
        pending: pendingCount,
        inFlight: inFlight.size,
        cachedResults: results.size,
        maxResults: maxResults
      });
    }

    function remember(id, result) {
      if (results.has(id)) results.delete(id);
      results.set(id, result);
      while (results.size > maxResults) {
        results.delete(results.keys().next().value);
      }
      return result;
    }

    function notifyInvalidation(reason, details) {
      generation += 1;
      cancellationSignals.forEach(function (entry) {
        if (entry.generation < generation) entry.resolve(cancelledResult(entry.commandId, entry.generation, reason || 'superseded'));
      });
      if (onInvalidate) {
        try {
          onInvalidate(Object.freeze({
            generation: generation,
            reason: String(reason || 'invalidated'),
            commandId: details && details.commandId ? details.commandId : ''
          }));
        } catch (_) {
          // Renderer cleanup callbacks must never wedge command processing.
        }
      }
      return generation;
    }

    function cancelledResult(id, submittedGeneration, reason) {
      return Object.freeze({
        ok: false,
        status: 'cancelled',
        commandId: id,
        generation: submittedGeneration,
        reason: String(reason || 'superseded')
      });
    }

    function failedResult(id, submittedGeneration, error) {
      return Object.freeze({
        ok: false,
        status: 'failed',
        commandId: id,
        generation: submittedGeneration,
        error: serializeError(error)
      });
    }

    function appliedResult(id, submittedGeneration, value) {
      return Object.freeze({
        ok: true,
        status: 'applied',
        commandId: id,
        generation: submittedGeneration,
        value: value
      });
    }

    function submit(command, commandApply) {
      var id = commandId(command);
      if (!id) return Promise.reject(new TypeError('Output command requires a commandId.'));

      if (inFlight.has(id)) return inFlight.get(id);
      if (results.has(id)) return Promise.resolve(results.get(id));

      if (closed) {
        return Promise.resolve(remember(id, cancelledResult(id, generation, closeReason || 'queue closed')));
      }

      var destructive = Boolean(isDestructive(command));
      var submittedGeneration = destructive
        ? notifyInvalidation('destructive-command', { commandId: id })
        : generation;
      var handler = typeof commandApply === 'function' ? commandApply : apply;
      pendingCount += 1;

      function isCurrent() {
        return !closed && generation === submittedGeneration;
      }

      async function run() {
        if (!isCurrent()) {
          return cancelledResult(id, submittedGeneration, closed ? (closeReason || 'queue closed') : 'superseded');
        }
        if (typeof handler !== 'function') {
          return failedResult(id, submittedGeneration, new Error('No output command apply handler was provided.'));
        }

        var context = Object.freeze({
          commandId: id,
          generation: submittedGeneration,
          destructive: destructive,
          isCurrent: isCurrent
        });

        try {
          var value = await handler(command, context);
          if (!isCurrent()) {
            return cancelledResult(id, submittedGeneration, closed ? (closeReason || 'queue closed') : 'superseded');
          }
          return appliedResult(id, submittedGeneration, value);
        } catch (error) {
          return failedResult(id, submittedGeneration, error);
        }
      }

      // A destructive command owns a new generation and starts immediately.
      // Older async work may still settle, but its isCurrent() guards prevent
      // it from mutating the renderer. This keeps STOP/CLEAR responsive even
      // when a decoder or IndexedDB request never resolves.
      var base = destructive ? Promise.resolve() : tail;
      var cancelResolve;
      var cancelled = new Promise(function (resolve) { cancelResolve = resolve; });
      cancellationSignals.set(id, { commandId: id, generation: submittedGeneration, resolve: cancelResolve });
      var execution = base.then(run, run);
      var promise = Promise.race([execution, cancelled]).then(function (result) {
        return remember(id, result);
      }).finally(function () {
        pendingCount -= 1;
        inFlight.delete(id);
        cancellationSignals.delete(id);
      });

      // Continue the serialization chain even when a consumer callback fails.
      tail = promise.then(function () {}, function () {});
      inFlight.set(id, promise);
      return promise;
    }

    function cancel(reason) {
      return notifyInvalidation(reason || 'cancelled');
    }

    function close(reason) {
      if (!closed) {
        closed = true;
        closeReason = String(reason || 'queue closed');
        notifyInvalidation(closeReason);
      }
      return tail;
    }

    function whenIdle() {
      return tail.then(function () { return state(); });
    }

    return Object.freeze({
      submit: submit,
      cancel: cancel,
      close: close,
      whenIdle: whenIdle,
      getState: state
    });
  }

  return Object.freeze({
    DEFAULT_MAX_RESULTS: DEFAULT_MAX_RESULTS,
    createQueue: createQueue
  });
});
