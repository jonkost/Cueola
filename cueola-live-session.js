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
    'build', 'entering', 'live', 'leaving', 'recovering', 'error'
  ]);
  var SUBSYSTEM_STATUSES = Object.freeze([
    'closed', 'opening', 'connecting', 'ready', 'active', 'paused',
    'stalled', 'disconnected', 'recovering', 'error'
  ]);
  var LIFECYCLE_SET = new Set(LIFECYCLE_STATES);
  var STATUS_SET = new Set(SUBSYSTEM_STATUSES);

  function cueIndex(value) {
    var number = Number(value);
    return Number.isFinite(number) ? Math.max(-1, Math.trunc(number)) : -1;
  }

  function firstPlayableCue(cues, requested) {
    var rows = Array.isArray(cues) ? cues : [];
    if (!rows.length) return -1;
    var index = Math.max(0, Math.min(cueIndex(requested), rows.length - 1));
    while (index < rows.length && rows[index] && rows[index].style === 'segment') index += 1;
    if (index < rows.length) return index;
    index = rows.length - 1;
    while (index >= 0 && rows[index] && rows[index].style === 'segment') index -= 1;
    return index;
  }

  function copySubsystems(subsystems) {
    var copy = {};
    Object.keys(subsystems).forEach(function (name) {
      copy[name] = Object.freeze(Object.assign({}, subsystems[name]));
    });
    return Object.freeze(copy);
  }

  function createController(options) {
    options = options || {};
    var state = {
      lifecycle: 'build',
      activeCueIndex: -1,
      selectedCueIndex: -1,
      transitionId: 0,
      lastReason: 'initial',
      error: null,
      subsystems: {
        prompter: { status: 'closed', detail: '', updatedAt: Date.now() },
        playback: { status: 'closed', detail: '', updatedAt: Date.now() },
        scriptOperator: { status: 'closed', detail: '', updatedAt: Date.now() }
      }
    };
    var cleanups = new Map();

    function snapshot() {
      return Object.freeze({
        lifecycle: state.lifecycle,
        activeCueIndex: state.activeCueIndex,
        selectedCueIndex: state.selectedCueIndex,
        transitionId: state.transitionId,
        lastReason: state.lastReason,
        error: state.error,
        subsystems: copySubsystems(state.subsystems)
      });
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
      state.activeCueIndex = next;
      if (!meta || meta.select !== false) state.selectedCueIndex = next;
      state.lastReason = (meta && meta.reason) || 'active-cue';
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

    function registerCleanup(key, cleanup) {
      if (!key || typeof cleanup !== 'function') throw new Error('Cleanup requires a key and function.');
      if (cleanups.has(key)) cleanups.delete(key);
      cleanups.set(key, cleanup);
      return function unregister() { cleanups.delete(key); };
    }

    function cleanup(reason) {
      var entries = Array.from(cleanups.entries()).reverse();
      cleanups.clear();
      var errors = [];
      entries.forEach(function (entry) {
        try { entry[1](reason || 'cleanup'); }
        catch (error) {
          errors.push(error);
          report('Live cleanup failed: ' + entry[0], error);
        }
      });
      return errors;
    }

    function enter(context) {
      context = context || {};
      if (state.lifecycle === 'live' || state.lifecycle === 'entering') return snapshot();
      if (state.lifecycle === 'leaving') throw new Error('Cannot enter Live while a leave transition is running.');
      cleanup('before-enter');
      transition(context.recovering ? 'recovering' : 'entering', context.reason || 'enter-live');
      var selected = firstPlayableCue(context.cues, context.selectedCueIndex);
      var requestedActive = cueIndex(context.activeCueIndex);
      var active = requestedActive >= 0 ? firstPlayableCue(context.cues, requestedActive) : selected;
      state.activeCueIndex = active;
      state.selectedCueIndex = selected;
      notify();
      try {
        if (typeof options.onEnter === 'function') options.onEnter(snapshot(), context);
        return transition('live', context.reason || 'enter-live');
      } catch (error) {
        cleanup('enter-error');
        transition('error', 'enter-live-error', error);
        report('Live entry failed', error);
        throw error;
      }
    }

    function leave(context) {
      context = context || {};
      if (state.lifecycle === 'build') {
        cleanup(context.reason || 'leave-build');
        return snapshot();
      }
      if (state.lifecycle === 'leaving') return snapshot();
      transition('leaving', context.reason || 'leave-live');
      var error = null;
      try {
        if (typeof options.onLeave === 'function') options.onLeave(snapshot(), context);
      } catch (caught) {
        error = caught;
        report('Live leave failed', caught);
      }
      var cleanupErrors = cleanup(context.reason || 'leave-live');
      if (!error && cleanupErrors.length) error = cleanupErrors[0];
      if (error) {
        transition('error', 'leave-live-error', error);
        throw error;
      }
      return transition('build', context.reason || 'leave-live');
    }

    function reset(reason) {
      cleanup(reason || 'reset');
      state.activeCueIndex = -1;
      state.selectedCueIndex = -1;
      Object.keys(state.subsystems).forEach(function (name) {
        state.subsystems[name] = { status: 'closed', detail: '', updatedAt: Date.now() };
      });
      return transition('build', reason || 'reset');
    }

    notify();
    return Object.freeze({
      getState: snapshot,
      enter: enter,
      leave: leave,
      reset: reset,
      cleanup: cleanup,
      registerCleanup: registerCleanup,
      setActiveCue: setActiveCue,
      setSelectedCue: setSelectedCue,
      setSubsystemStatus: setSubsystemStatus
    });
  }

  return Object.freeze({
    LIFECYCLE_STATES: LIFECYCLE_STATES,
    SUBSYSTEM_STATUSES: SUBSYSTEM_STATUSES,
    firstPlayableCue: firstPlayableCue,
    createController: createController
  });
});
