/* Cueola Live-session controller.
 *
 * A small, dependency-free lifecycle boundary for the existing no-build app.
 * The controller owns Live entry/exit, separates the production's active cue
 * from this device's selected cue, normalizes subsystem status, and provides
 * one idempotent cleanup registry for Live-owned resources.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.CueolaLiveSession = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var LIFECYCLE_STATES = Object.freeze([
    'builder', 'entering-live', 'live', 'leaving-live', 'recovering', 'live-error'
  ]);
  var SUBSYSTEM_STATUSES = Object.freeze([
    'closed', 'opening', 'connecting', 'ready', 'active', 'paused',
    'stalled', 'disconnected', 'recovering', 'error'
  ]);
  var RUN_EXECUTION_STATES = Object.freeze([
    'upcoming', 'completed', 'skipped', 'failed', 'disabled'
  ]);
  var LIFECYCLE_SET = new Set(LIFECYCLE_STATES);
  var STATUS_SET = new Set(SUBSYSTEM_STATUSES);
  var RUN_EXECUTION_SET = new Set(RUN_EXECUTION_STATES);

  function cueIndex(value) {
    var number = Number(value);
    return Number.isFinite(number) ? Math.max(-1, Math.trunc(number)) : -1;
  }

  function isCueDisabled(cue) {
    return !cue || cue.disabled === true || cue.executionState === 'disabled' || cue.style === 'segment';
  }

  function firstPlayableCue(cues, requested) {
    var rows = Array.isArray(cues) ? cues : [];
    if (!rows.length) return -1;
    var index = Math.max(0, Math.min(cueIndex(requested), rows.length - 1));
    while (index < rows.length && isCueDisabled(rows[index])) index += 1;
    if (index < rows.length) return index;
    index = rows.length - 1;
    while (index >= 0 && isCueDisabled(rows[index])) index -= 1;
    return index;
  }

  function copySubsystems(subsystems) {
    var copy = {};
    Object.keys(subsystems).forEach(function (name) {
      copy[name] = Object.freeze(Object.assign({}, subsystems[name]));
    });
    return Object.freeze(copy);
  }

  function copyRunLedger(ledger) {
    var copy = {};
    Object.keys(ledger).forEach(function (key) {
      copy[key] = Object.freeze(Object.assign({}, ledger[key]));
    });
    return Object.freeze(copy);
  }

  function rowKey(value) {
    if (value == null || String(value).trim() === '') throw new Error('Every Live row requires a stable row key.');
    return String(value);
  }

  function createController(options) {
    options = options || {};
    var state = {
      lifecycle: 'builder',
      activeCueIndex: -1,
      selectedCueIndex: -1,
      transitionId: 0,
      lastReason: 'initial',
      error: null,
      exitSnapshot: null,
      runRevision: 0,
      runOrder: [],
      runLedger: {},
      subsystems: {
        prompter: { status: 'closed', detail: '', updatedAt: Date.now() },
        playback: { status: 'closed', detail: '', updatedAt: Date.now() },
        scriptOperator: { status: 'closed', detail: '', updatedAt: Date.now() }
      }
    };
    var cleanups = new Map();
    var pendingLeaveContext = null;
    var exitSequence = 0;

    function snapshot() {
      return Object.freeze({
        lifecycle: state.lifecycle,
        activeCueIndex: state.activeCueIndex,
        selectedCueIndex: state.selectedCueIndex,
        activeCueKey: getRowKey(state.activeCueIndex),
        selectedCueKey: getRowKey(state.selectedCueIndex),
        transitionId: state.transitionId,
        lastReason: state.lastReason,
        error: state.error,
        exitSnapshot: state.exitSnapshot,
        runRevision: state.runRevision,
        runOrder: Object.freeze(state.runOrder.slice()),
        runLedger: copyRunLedger(state.runLedger),
        subsystems: copySubsystems(state.subsystems)
      });
    }

    function captureExitSnapshot(context) {
      context = context || {};
      exitSequence += 1;
      return Object.freeze({
        exitId: 'live-exit-' + exitSequence,
        requestedAt: Date.now(),
        reason: context.reason || 'leave-live',
        lifecycle: state.lifecycle,
        transitionId: state.transitionId,
        activeCueIndex: state.activeCueIndex,
        selectedCueIndex: state.selectedCueIndex,
        activeCueKey: getRowKey(state.activeCueIndex),
        selectedCueKey: getRowKey(state.selectedCueIndex),
        runRevision: state.runRevision,
        runOrder: Object.freeze(state.runOrder.slice()),
        runLedger: copyRunLedger(state.runLedger),
        subsystems: copySubsystems(state.subsystems)
      });
    }

    function getExitSnapshot() {
      return state.exitSnapshot;
    }

    function canDispatch() {
      return state.lifecycle === 'live';
    }

    function getRowKey(index) {
      var normalized = cueIndex(index);
      return normalized >= 0 && normalized < state.runOrder.length ? state.runOrder[normalized] : null;
    }

    function configuredRowKey(row, index, configureOptions) {
      if (Array.isArray(configureOptions.rowKeys)) return rowKey(configureOptions.rowKeys[index]);
      if (typeof configureOptions.getRowKey === 'function') {
        return rowKey(configureOptions.getRowKey(row, index));
      }
      if (row && row.rowKey != null && String(row.rowKey).trim() !== '') return rowKey(row.rowKey);
      if (row && row.id != null && String(row.id).trim() !== '') return rowKey(row.id);
      // Compatibility for old callers that supply anonymous cue objects. The
      // production integration supplies beat ids, so persisted run history
      // never relies on a mutable array index.
      return 'index:' + index;
    }

    function configureRunRows(rows, configureOptions) {
      var list = Array.isArray(rows) ? rows : [];
      configureOptions = configureOptions || {};
      var preserve = configureOptions.preserve !== false;
      var priorActiveKey = preserve ? getRowKey(state.activeCueIndex) : null;
      var priorSelectedKey = preserve ? getRowKey(state.selectedCueIndex) : null;
      var disabledKeys = new Set((configureOptions.disabledKeys || []).map(function (key) { return rowKey(key); }));
      var nextOrder = [];
      var nextLedger = {};
      var nextRevision = state.runRevision + 1;

      list.forEach(function (row, index) {
        var key = configuredRowKey(row, index, configureOptions);
        if (Object.prototype.hasOwnProperty.call(nextLedger, key)) {
          throw new Error('Duplicate Live row key: ' + key);
        }
        var disabled = isCueDisabled(row) || disabledKeys.has(key)
          || (typeof configureOptions.isDisabled === 'function' && configureOptions.isDisabled(row, index, key) === true);
        var existing = preserve ? state.runLedger[key] : null;
        var status = disabled ? 'disabled' : (existing && existing.status !== 'disabled' ? existing.status : 'upcoming');
        var changed = !existing || existing.index !== index || existing.status !== status;
        nextOrder.push(key);
        nextLedger[key] = Object.assign({
          key: key,
          index: index,
          status: status,
          failure: null,
          lastFailure: null,
          failureCount: 0,
          recoveryCount: 0,
          revision: nextRevision,
          lastReason: disabled ? 'row-disabled' : 'run-configured'
        }, existing || {}, {
          key: key,
          index: index,
          status: status,
          failure: status === 'failed' && existing ? existing.failure : null,
          revision: changed ? nextRevision : (existing ? existing.revision : nextRevision),
          lastReason: changed
            ? (disabled ? 'row-disabled' : 'run-configured')
            : existing.lastReason
        });
      });

      var configurationChanged = (!preserve && state.runOrder.length > 0)
        || nextOrder.length !== state.runOrder.length
        || nextOrder.some(function (key, index) { return key !== state.runOrder[index]; })
        || nextOrder.some(function (key) {
          var before = state.runLedger[key];
          var after = nextLedger[key];
          return !before || before.index !== after.index || before.status !== after.status;
        });
      state.runOrder = nextOrder;
      state.runLedger = nextLedger;
      if (configurationChanged) state.runRevision = nextRevision;

      if (preserve) {
        state.activeCueIndex = priorActiveKey && nextLedger[priorActiveKey]
          && nextLedger[priorActiveKey].status !== 'disabled' ? nextOrder.indexOf(priorActiveKey) : -1;
        state.selectedCueIndex = priorSelectedKey ? nextOrder.indexOf(priorSelectedKey) : -1;
      } else {
        state.activeCueIndex = -1;
        state.selectedCueIndex = -1;
      }
      if (configureOptions.silent !== true) notify();
      return getRunLedger();
    }

    function getRunLedger() {
      return copyRunLedger(state.runLedger);
    }

    function resolveRunKey(reference) {
      var key = null;
      if (reference && typeof reference === 'object') {
        if (reference.rowKey != null) key = rowKey(reference.rowKey);
        else if (reference.index != null) key = getRowKey(reference.index);
      } else if (typeof reference === 'number') key = getRowKey(reference);
      else if (reference != null) key = rowKey(reference);
      if (!key || !Object.prototype.hasOwnProperty.call(state.runLedger, key)) {
        throw new Error('Unknown Live row: ' + String(reference));
      }
      return key;
    }

    function getCueExecution(reference) {
      var key = resolveRunKey(reference);
      return Object.freeze(Object.assign({}, state.runLedger[key]));
    }

    function replaceRunRecord(key, changes, reason) {
      var current = state.runLedger[key];
      state.runRevision += 1;
      state.runLedger[key] = Object.assign({}, current, changes, {
        revision: state.runRevision,
        lastReason: reason || 'cue-execution'
      });
      return state.runLedger[key];
    }

    function assertExecutionTransition(current, status, explicitRecovery) {
      if (!RUN_EXECUTION_SET.has(status)) throw new Error('Unknown cue execution state: ' + status);
      if (current.status === status) return;
      if (current.status === 'failed' && !explicitRecovery) {
        throw new Error('Recover a failed cue explicitly before changing its execution state.');
      }
      if (current.status === 'completed' || current.status === 'skipped') {
        throw new Error('Terminal cue history cannot be rewritten.');
      }
      if (current.status === 'disabled') {
        throw new Error('Enable a disabled cue explicitly before changing its execution state.');
      }
    }

    function setCueExecution(reference, status, meta) {
      meta = meta || {};
      var key = resolveRunKey(reference);
      var current = state.runLedger[key];
      assertExecutionTransition(current, status, false);
      if (status === 'disabled' && current.index === state.activeCueIndex) {
        throw new Error('The active cue cannot be disabled.');
      }
      if (current.status === status) return getCueExecution(key);
      if (status === 'failed') return recordCueFailure(key, meta.error || 'Cue failed', meta);
      replaceRunRecord(key, { status: status, failure: null }, meta.reason || 'cue-' + status);
      state.lastReason = meta.reason || 'cue-' + status;
      notify();
      return getCueExecution(key);
    }

    function completeCue(reference, meta) {
      return setCueExecution(reference, 'completed', meta);
    }

    function skipCue(reference, meta) {
      return setCueExecution(reference, 'skipped', meta);
    }

    function setCueDisabled(reference, disabled, meta) {
      meta = meta || {};
      var key = resolveRunKey(reference);
      var current = state.runLedger[key];
      if (disabled !== false) return setCueExecution(key, 'disabled', meta);
      if (current.status !== 'disabled') return getCueExecution(key);
      replaceRunRecord(key, { status: 'upcoming', failure: null }, meta.reason || 'cue-enabled');
      state.lastReason = meta.reason || 'cue-enabled';
      notify();
      return getCueExecution(key);
    }

    function recordCueFailure(reference, error, meta) {
      meta = meta || {};
      var key = resolveRunKey(reference);
      var current = state.runLedger[key];
      assertExecutionTransition(current, 'failed', false);
      var message = String(error && (error.message || error) || 'Cue failed');
      replaceRunRecord(key, {
        status: 'failed',
        failure: message,
        lastFailure: message,
        failureCount: current.failureCount + 1
      }, meta.reason || 'cue-failed');
      state.lastReason = meta.reason || 'cue-failed';
      notify();
      return getCueExecution(key);
    }

    function recoverCueFailure(reference, meta) {
      meta = meta || {};
      var key = resolveRunKey(reference);
      var current = state.runLedger[key];
      if (current.status !== 'failed') throw new Error('Only a failed cue can be recovered.');
      var status = meta.status || 'upcoming';
      if (!['upcoming', 'completed', 'skipped'].includes(status)) {
        throw new Error('A recovered cue must be upcoming, completed, or skipped.');
      }
      replaceRunRecord(key, {
        status: status,
        failure: null,
        recoveryCount: current.recoveryCount + 1
      }, meta.reason || 'cue-recovered');
      state.lastReason = meta.reason || 'cue-recovered';
      notify();
      return getCueExecution(key);
    }

    function report(label, error) {
      if (typeof options.onError === 'function') options.onError(label, error);
      else if (typeof console !== 'undefined' && console.error) console.error(label, error);
    }

    function notify() {
      if (typeof options.onStateChange !== 'function') return;
      try { options.onStateChange(snapshot()); }
      catch (error) { report('Live-session state projection failed', error); }
    }

    function transition(next, reason, error) {
      if (!LIFECYCLE_SET.has(next)) throw new Error('Unknown Live lifecycle state: ' + next);
      state.lifecycle = next;
      state.lastReason = reason || next;
      state.error = error ? String(error.message || error) : null;
      state.transitionId += 1;
      notify();
      return snapshot();
    }

    function setSelectedCue(index, meta) {
      state.selectedCueIndex = cueIndex(index);
      state.lastReason = (meta && meta.reason) || 'selected-cue';
      notify();
      return state.selectedCueIndex;
    }

    function setActiveCue(index, meta) {
      var next = cueIndex(index);
      if (next >= 0 && state.runOrder.length) {
        var nextKey = getRowKey(next);
        if (!nextKey) throw new Error('Unknown Live cue index: ' + next);
        if (state.runLedger[nextKey].status === 'disabled') {
          throw new Error('A disabled cue cannot become active: ' + nextKey);
        }
      }
      var previous = state.activeCueIndex;
      var reason = (meta && meta.reason) || 'active-cue';
      if (next > previous) {
        var previousKey = getRowKey(previous);
        if (previousKey && state.runLedger[previousKey].status === 'upcoming') {
          replaceRunRecord(previousKey, { status: 'completed', failure: null }, reason + ':completed-previous');
        }
        var firstBypassed = previous >= 0 ? previous + 1 : 0;
        for (var bypassed = firstBypassed; bypassed < next; bypassed += 1) {
          var bypassedKey = getRowKey(bypassed);
          if (bypassedKey && state.runLedger[bypassedKey].status === 'upcoming') {
            replaceRunRecord(bypassedKey, { status: 'skipped', failure: null }, reason + ':skipped-bypass');
          }
        }
      }
      state.activeCueIndex = next;
      if (!meta || meta.select !== false) state.selectedCueIndex = next;
      state.lastReason = reason;
      notify();
      return state.activeCueIndex;
    }

    function setSubsystemStatus(name, status, detail) {
      if (!name) throw new Error('Subsystem name is required.');
      if (!STATUS_SET.has(status)) throw new Error('Unknown subsystem status: ' + status);
      state.subsystems[name] = {
        status: status,
        detail: detail == null ? '' : String(detail),
        updatedAt: Date.now()
      };
      notify();
      return state.subsystems[name];
    }

    function firstConfiguredCue(requested) {
      if (!state.runOrder.length) return -1;
      var index = Math.max(0, Math.min(cueIndex(requested), state.runOrder.length - 1));
      while (index < state.runOrder.length && state.runLedger[state.runOrder[index]].status === 'disabled') index += 1;
      if (index < state.runOrder.length) return index;
      index = state.runOrder.length - 1;
      while (index >= 0 && state.runLedger[state.runOrder[index]].status === 'disabled') index -= 1;
      return index;
    }

    function registerCleanup(key, cleanup) {
      if (!key || typeof cleanup !== 'function') throw new Error('Cleanup requires a key and function.');
      var registration = { cleanup: cleanup };
      if (cleanups.has(key)) cleanups.delete(key);
      cleanups.set(key, registration);
      return function unregister() {
        if (cleanups.get(key) === registration) cleanups.delete(key);
      };
    }

    function cleanup(reason, context) {
      var entries = Array.from(cleanups.entries()).reverse();
      cleanups.clear();
      var errors = [];
      entries.forEach(function (entry) {
        try { entry[1].cleanup(reason || 'cleanup', context || {}); }
        catch (error) {
          errors.push(error);
          report('Live cleanup failed: ' + entry[0], error);
        }
      });
      return errors;
    }

    function enter(context) {
      context = context || {};
      if (state.lifecycle === 'live' || state.lifecycle === 'entering-live') return snapshot();
      if (state.lifecycle === 'leaving-live') throw new Error('Cannot enter Live while a leave transition is running.');
      if (state.lifecycle === 'recovering') throw new Error('Cannot enter Live while recovery is running.');
      if (state.lifecycle === 'live-error' && !context.recovering) {
        throw new Error('Recover to the builder before entering Live again.');
      }
      var staleCleanupErrors = cleanup('before-enter', context);
      if (staleCleanupErrors.length) {
        transition('live-error', 'enter-live-cleanup-error', staleCleanupErrors[0]);
        throw staleCleanupErrors[0];
      }
      pendingLeaveContext = null;
      state.exitSnapshot = null;
      configureRunRows(context.cues, {
        rowKeys: context.rowKeys,
        getRowKey: context.getRowKey,
        disabledKeys: context.disabledKeys,
        isDisabled: context.isDisabled,
        preserve: context.preserveRunLedger === true,
        silent: true
      });
      transition(context.recovering ? 'recovering' : 'entering-live', context.reason || 'enter-live');
      var selected = firstConfiguredCue(context.selectedCueIndex);
      var requestedActive = cueIndex(context.activeCueIndex);
      var active = requestedActive >= 0 ? firstConfiguredCue(requestedActive) : selected;
      state.activeCueIndex = active;
      state.selectedCueIndex = selected;
      notify();
      try {
        if (typeof options.onEnter === 'function') options.onEnter(snapshot(), context);
        return transition('live', context.reason || 'enter-live');
      } catch (error) {
        cleanup('enter-error', context);
        transition('live-error', 'enter-live-error', error);
        report('Live entry failed', error);
        throw error;
      }
    }

    function prepareLeave(context) {
      context = context || {};
      if (state.lifecycle === 'builder' || state.lifecycle === 'leaving-live') return snapshot();
      if (state.lifecycle !== 'live') {
        throw new Error('Cannot prepare a Live leave from ' + state.lifecycle + '.');
      }
      pendingLeaveContext = Object.assign({}, context);
      state.exitSnapshot = captureExitSnapshot(context);
      return transition('leaving-live', context.reason || 'prepare-leave-live');
    }

    function cancelLeave(context) {
      context = context || {};
      if (state.lifecycle === 'live' || state.lifecycle === 'builder') return snapshot();
      if (state.lifecycle !== 'leaving-live') {
        throw new Error('Cannot cancel a Live leave from ' + state.lifecycle + '.');
      }
      pendingLeaveContext = null;
      state.exitSnapshot = null;
      return transition('live', context.reason || 'cancel-leave-live');
    }

    function commitLeave(context) {
      context = context || {};
      if (state.lifecycle === 'builder') return snapshot();
      if (state.lifecycle !== 'leaving-live') {
        throw new Error('Prepare the Live leave before committing it.');
      }
      var leaveContext = Object.assign({}, pendingLeaveContext || {}, context);
      var reason = leaveContext.reason || 'leave-live';
      var error = null;
      try {
        if (typeof options.onLeave === 'function') options.onLeave(snapshot(), leaveContext);
      } catch (caught) {
        error = caught;
        report('Live leave failed', caught);
      }
      var cleanupErrors = cleanup(reason, leaveContext);
      if (!error && cleanupErrors.length) error = cleanupErrors[0];
      pendingLeaveContext = null;
      if (error) {
        transition('live-error', 'leave-live-error', error);
        throw error;
      }
      return transition('builder', reason);
    }

    // Compatibility path for existing callers. Phase 5 UI uses the explicit
    // prepare/cancel/commit methods so an output decision cannot be bypassed.
    function leave(context) {
      context = context || {};
      if (state.lifecycle === 'builder') {
        cleanup(context.reason || 'leave-builder', context);
        return snapshot();
      }
      if (state.lifecycle === 'leaving-live') return snapshot();
      prepareLeave(context);
      return commitLeave(context);
    }

    function closeSubsystems(detail) {
      var now = Date.now();
      Object.keys(state.subsystems).forEach(function (name) {
        state.subsystems[name] = { status: 'closed', detail: detail || '', updatedAt: now };
      });
    }

    function recoverToBuilder(context) {
      context = context || {};
      var reason = context.reason || 'recover-live-to-builder';
      if (state.lifecycle === 'builder') {
        cleanup(reason, context);
        closeSubsystems('Emergency recovery complete');
        pendingLeaveContext = null;
        notify();
        return snapshot();
      }
      if (!state.exitSnapshot) state.exitSnapshot = captureExitSnapshot({ reason: reason });
      var recoveryContext = Object.assign({}, pendingLeaveContext || {}, context, { recovering: true, reason: reason });
      transition('recovering', reason);
      try {
        if (typeof options.onLeave === 'function') options.onLeave(snapshot(), recoveryContext);
      } catch (error) {
        report('Live recovery navigation failed', error);
      }
      cleanup(reason, recoveryContext);
      closeSubsystems('Emergency recovery complete');
      pendingLeaveContext = null;
      return transition('builder', reason);
    }

    function reset(reason) {
      cleanup(reason || 'reset', { reset: true });
      state.activeCueIndex = -1;
      state.selectedCueIndex = -1;
      state.exitSnapshot = null;
      state.runRevision = 0;
      state.runOrder = [];
      state.runLedger = {};
      pendingLeaveContext = null;
      closeSubsystems('');
      return transition('builder', reason || 'reset');
    }

    notify();
    return Object.freeze({
      getState: snapshot,
      getExitSnapshot: getExitSnapshot,
      canDispatch: canDispatch,
      enter: enter,
      prepareLeave: prepareLeave,
      cancelLeave: cancelLeave,
      commitLeave: commitLeave,
      leave: leave,
      recoverToBuilder: recoverToBuilder,
      reset: reset,
      cleanup: cleanup,
      registerCleanup: registerCleanup,
      configureRunRows: configureRunRows,
      getRunLedger: getRunLedger,
      getRowKey: getRowKey,
      getCueExecution: getCueExecution,
      setCueExecution: setCueExecution,
      completeCue: completeCue,
      skipCue: skipCue,
      setCueDisabled: setCueDisabled,
      recordCueFailure: recordCueFailure,
      recoverCueFailure: recoverCueFailure,
      setActiveCue: setActiveCue,
      setSelectedCue: setSelectedCue,
      setSubsystemStatus: setSubsystemStatus
    });
  }

  // D12.3 show-caller certainty. ONE pure predicate answers "may this device
  // move the shared live cue" — the app's isShowCaller()/isFollowingSelf()
  // wrappers delegate here, and the Jul 20 TH2607 scenarios are its unit
  // tests. Inputs are plain values so this runs identically in tests.
  //
  //   followingSelf — whose position this device is viewing (its own vs. a
  //                   mirror of someone else); solo surfaces and privileged
  //                   roles default to driving their own position.
  //   isShowCaller  — followingSelf AND allowed to move the shared cue:
  //                   solo surfaces always; in a shared session any
  //                   non-student role, or ANY role holding an admin unlock
  //                   (rejoining by code lands as 'student' — the admin
  //                   device must still be able to call the show).
  function resolveCallerState(input) {
    input = input || {};
    var solo = Boolean(input.isDemo || input.isExpert || !input.code);
    var privileged = input.role !== 'student' || Boolean(input.hasAdminSession);
    var followingSelf = Boolean(input.browsingSelf) ||
      (!input.followTarget && (solo || privileged));
    return Object.freeze({
      followingSelf: followingSelf,
      isShowCaller: followingSelf && (solo || privileged)
    });
  }

  return Object.freeze({
    LIFECYCLE_STATES: LIFECYCLE_STATES,
    SUBSYSTEM_STATUSES: SUBSYSTEM_STATUSES,
    RUN_EXECUTION_STATES: RUN_EXECUTION_STATES,
    firstPlayableCue: firstPlayableCue,
    resolveCallerState: resolveCallerState,
    createController: createController
  });
});
