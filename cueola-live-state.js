/* Cueola 3.0 live state (P0-3 / §2.1).
 *
 * One shared record on the session document is the single source of truth
 * for the live show:
 *
 *   live: { idx, seq, cueStartedAt, showStartedAt, directorId, takenAt }
 *
 *   idx            index of the cue that is ON AIR (-1 = nothing yet)
 *   seq            strictly increasing take counter. Only the director writes
 *                  it, and every TAKE increments it. Readers apply an update
 *                  ONLY when its seq is greater than the last one they applied,
 *                  so a take is idempotent: the director's own echo, a replayed
 *                  snapshot, or a duplicate press can never advance twice.
 *   cueStartedAt   server time (ms) the on-air cue was taken
 *   showStartedAt  server time (ms) the show clock started (0 = not started)
 *   directorId     client id of the director who wrote the record
 *
 * Elapsed time is always wall-clock arithmetic against server time
 * (now − startedAt). Nothing in here counts ticks.
 *
 * This file is dependency-free and pure: no DOM, no Firestore. The app wires
 * it to the session document; scripts/tests/live-state.test.mjs is its
 * contract.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.CueolaLiveState = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var FIELD = 'live';

  function num(value, fallback) {
    var n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  }

  // A Firestore Timestamp, a Date, or a number all read as milliseconds.
  function millis(value) {
    if (value == null) return 0;
    if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
    if (typeof value.toMillis === 'function') return num(value.toMillis(), 0);
    if (value instanceof Date) return num(value.getTime(), 0);
    if (typeof value.seconds === 'number') return value.seconds * 1000 + Math.floor(num(value.nanoseconds, 0) / 1e6);
    return num(value, 0);
  }

  function normalize(record) {
    record = record && typeof record === 'object' ? record : {};
    return Object.freeze({
      idx: Math.max(-1, Math.trunc(num(record.idx, -1))),
      seq: Math.max(0, Math.trunc(num(record.seq, 0))),
      cueStartedAt: millis(record.cueStartedAt),
      showStartedAt: millis(record.showStartedAt),
      directorId: String(record.directorId || ''),
      takenAt: millis(record.takenAt),
    });
  }

  /* ── Server clock ───────────────────────────────────────────────────────
   * Estimates (server time − local time) from round trips this client made:
   * a write stamped with serverTimestamp() comes back resolved; the server
   * value minus the midpoint of the local send/ack window is one sample. The
   * median of recent samples is the offset. With no samples the offset is 0,
   * which is exactly the pre-3.0 behavior (local clocks), never worse.
   */
  function createServerClock(options) {
    options = options || {};
    var maxSamples = Math.max(1, num(options.maxSamples, 9));
    var samples = [];

    function addSample(serverMs, sentAtMs, ackAtMs) {
      var server = millis(serverMs);
      var sent = num(sentAtMs, NaN);
      if (!server || !Number.isFinite(sent)) return null;
      var ack = num(ackAtMs, sent);
      if (ack < sent) ack = sent;
      // Round trips over a few seconds carry too much uncertainty to trust.
      if (ack - sent > 5000) return null;
      var offset = server - (sent + (ack - sent) / 2);
      samples.push(offset);
      if (samples.length > maxSamples) samples.shift();
      return offset;
    }

    function offsetMs() {
      if (!samples.length) return 0;
      var sorted = samples.slice().sort(function (a, b) { return a - b; });
      var mid = Math.floor(sorted.length / 2);
      return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
    }

    function now(localNowMs) {
      var local = Number.isFinite(localNowMs) ? localNowMs : Date.now();
      return local + offsetMs();
    }

    return Object.freeze({
      addSample: addSample,
      offsetMs: offsetMs,
      now: now,
      sampleCount: function () { return samples.length; },
      reset: function () { samples = []; },
    });
  }

  /* ── Live state model ───────────────────────────────────────────────────
   * Holds this client's applied copy of the shared record and decides what a
   * TAKE writes and which remote updates count.
   */
  function createLiveState(options) {
    options = options || {};
    var clientId = String(options.clientId || '');
    var state = normalize(options.initial);
    var pending = null;   // { previous, seq } while the director's write is in flight
    var listeners = [];

    function emit(reason) {
      listeners.forEach(function (fn) {
        try { fn(state, reason); } catch (e) { /* a listener must never break a take */ }
      });
    }

    function get() { return state; }

    // Director: take a cue. Returns the optimistic local state and the exact
    // patch to write. seq is predicted locally (last applied + 1); the server
    // may assign a higher one if two directors race, and the echo then wins.
    function take(index, meta) {
      meta = meta || {};
      var idx = Math.max(-1, Math.trunc(num(index, -1)));
      var nowMs = num(meta.nowMs, Date.now());
      var previous = state;
      var next = normalize({
        idx: idx,
        seq: state.seq + 1,
        cueStartedAt: nowMs,
        showStartedAt: state.showStartedAt,
        directorId: clientId,
        takenAt: nowMs,
      });
      state = next;
      pending = { previous: previous, seq: next.seq };
      emit(meta.reason || 'take');
      return Object.freeze({
        state: next,
        patch: {
          idx: idx,
          seq: next.seq,
          cueStartedAt: nowMs,
          showStartedAt: next.showStartedAt,
          directorId: clientId,
          takenAt: nowMs,
        },
      });
    }

    // Director: start or stop the show clock without moving the cue.
    function setShowStarted(startedAtMs, meta) {
      meta = meta || {};
      var previous = state;
      var next = normalize({
        idx: state.idx,
        seq: state.seq + 1,
        cueStartedAt: state.cueStartedAt,
        showStartedAt: millis(startedAtMs),
        directorId: clientId,
        takenAt: num(meta.nowMs, Date.now()),
      });
      state = next;
      pending = { previous: previous, seq: next.seq };
      emit(meta.reason || 'show-clock');
      return Object.freeze({
        state: next,
        patch: {
          idx: next.idx,
          seq: next.seq,
          cueStartedAt: next.cueStartedAt,
          showStartedAt: next.showStartedAt,
          directorId: clientId,
          takenAt: next.takenAt,
        },
      });
    }

    // The director's write landed (or not). A failed write rolls the local
    // copy back so the room's next update is not ignored forever.
    function settle(ok, meta) {
      if (!pending) return state;
      var was = pending;
      pending = null;
      if (ok) return state;
      state = was.previous;
      emit((meta && meta.reason) || 'take-failed');
      return state;
    }

    // Reader: adopt a remote record. Applied only when its seq moves forward.
    // `force` re-syncs on (re)join, where the local copy is meaningless.
    function adopt(remote, meta) {
      meta = meta || {};
      if (!remote || typeof remote !== 'object') return Object.freeze({ applied: false, reason: 'empty' });
      var next = normalize(remote);
      if (!meta.force) {
        if (next.seq < state.seq) return Object.freeze({ applied: false, reason: 'older', state: state });
        if (next.seq === state.seq) {
          // Same take echoed back. Fold in server-resolved timestamps so the
          // clock math lines up with everyone else, but never move the cue.
          if (next.directorId === state.directorId && next.idx === state.idx
              && (next.cueStartedAt !== state.cueStartedAt || next.showStartedAt !== state.showStartedAt)) {
            state = normalize({
              idx: state.idx, seq: state.seq, directorId: state.directorId, takenAt: next.takenAt || state.takenAt,
              cueStartedAt: next.cueStartedAt || state.cueStartedAt,
              showStartedAt: next.showStartedAt,
            });
            if (pending && pending.seq === state.seq) pending = null;
            emit('echo-times');
            return Object.freeze({ applied: false, reason: 'echo', state: state, timesUpdated: true });
          }
          if (pending && pending.seq === state.seq) pending = null;
          return Object.freeze({ applied: false, reason: 'duplicate', state: state });
        }
      }
      var moved = next.idx !== state.idx;
      state = next;
      pending = null;
      emit(meta.reason || (moved ? 'remote-take' : 'remote-update'));
      return Object.freeze({ applied: true, reason: moved ? 'moved' : 'updated', state: state, moved: moved });
    }

    function reset(record) {
      state = normalize(record);
      pending = null;
      emit('reset');
      return state;
    }

    function elapsedCueMs(serverNowMs) {
      if (!state.cueStartedAt) return 0;
      return Math.max(0, num(serverNowMs, Date.now()) - state.cueStartedAt);
    }

    function elapsedShowMs(serverNowMs) {
      if (!state.showStartedAt) return 0;
      return Math.max(0, num(serverNowMs, Date.now()) - state.showStartedAt);
    }

    function isDirector() {
      return !!clientId && state.directorId === clientId;
    }

    function subscribe(fn) {
      if (typeof fn !== 'function') return function () {};
      listeners.push(fn);
      return function () { listeners = listeners.filter(function (x) { return x !== fn; }); };
    }

    return Object.freeze({
      FIELD: FIELD,
      get: get,
      take: take,
      setShowStarted: setShowStarted,
      settle: settle,
      adopt: adopt,
      reset: reset,
      elapsedCueMs: elapsedCueMs,
      elapsedShowMs: elapsedShowMs,
      isDirector: isDirector,
      hasPendingWrite: function () { return pending != null; },
      subscribe: subscribe,
    });
  }

  /* ── TAKE gate ──────────────────────────────────────────────────────────
   * One press = one take. A press within the debounce window of the last
   * accepted press, or while a write is still in flight, is refused.
   */
  function createTakeGate(options) {
    options = options || {};
    var debounceMs = Math.max(0, num(options.debounceMs, 300));
    var lastAt = -Infinity;
    var inFlight = false;

    function tryAcquire(nowMs) {
      var now = num(nowMs, Date.now());
      if (inFlight) return Object.freeze({ ok: false, reason: 'in-flight' });
      if (now - lastAt < debounceMs) return Object.freeze({ ok: false, reason: 'debounced' });
      lastAt = now;
      inFlight = true;
      return Object.freeze({ ok: true });
    }

    function release() { inFlight = false; }

    return Object.freeze({
      tryAcquire: tryAcquire,
      release: release,
      isBusy: function () { return inFlight; },
      reset: function () { inFlight = false; lastAt = -Infinity; },
    });
  }

  /* ── Duration math (one place, seconds in, text out) ─────────────────── */
  function cueSeconds(cue) {
    if (!cue) return 0;
    var min = Math.max(0, Math.trunc(num(cue.min, 0)));
    var sec = Math.max(0, Math.trunc(num(cue.sec, 0)));
    return min * 60 + sec;
  }

  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  // "m:ss" for cue durations; hours appear only when needed ("1:02:03").
  function formatSeconds(totalSeconds) {
    var s = Math.max(0, Math.round(num(totalSeconds, 0)));
    var h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
    return h ? h + ':' + pad2(m) + ':' + pad2(r) : m + ':' + pad2(r);
  }

  // Signed remaining/over text: "-0:12" when over.
  function formatRemaining(remainingSeconds) {
    var s = Math.round(num(remainingSeconds, 0));
    return (s < 0 ? '-' : '') + formatSeconds(Math.abs(s));
  }

  // Sum of durations before `index`, skipping segments.
  function offsetBefore(cues, index) {
    var list = Array.isArray(cues) ? cues : [];
    var total = 0;
    for (var i = 0; i < list.length && i < index; i++) {
      if (list[i] && list[i].style !== 'segment') total += cueSeconds(list[i]);
    }
    return total;
  }

  function totalSeconds(cues) {
    return offsetBefore(cues, Infinity);
  }

  return Object.freeze({
    FIELD: FIELD,
    normalize: normalize,
    millis: millis,
    createServerClock: createServerClock,
    createLiveState: createLiveState,
    createTakeGate: createTakeGate,
    cueSeconds: cueSeconds,
    formatSeconds: formatSeconds,
    formatRemaining: formatRemaining,
    offsetBefore: offsetBefore,
    totalSeconds: totalSeconds,
  });
});
