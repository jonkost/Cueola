/* Cueola connection-truth model (v2.1 Phase 1.5 · D12.1).
 *
 * One shared link-state model for every live surface. Each link — cloud,
 * talent, playout, script-op — carries {status, lastAckAt, detail} driven by
 * acknowledged round-trips, never one-shot heartbeats. Hysteresis lives HERE,
 * not in the UI: displayed status demotes only after N consecutive missed ack
 * windows, and any ack promotes back to connected immediately. UI code renders
 * FROM this model on its transition events and must never flip displayed
 * status directly from a raw heartbeat.
 *
 * Dependency-free and serializable, same contract style as
 * cueola-prompter-session.js. DOM rendering stays in the surfaces.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.CueolaLinkState = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var STATUSES = Object.freeze(['off', 'connected', 'degraded', 'lost']);
  var STATUS_SET = new Set(STATUSES);

  var LINK_DEFAULTS = Object.freeze({
    // Expected ack cadence for the link. A "miss" is one elapsed ackIntervalMs
    // window with no ack.
    ackIntervalMs: 2000,
    // Consecutive missed windows before the displayed status demotes.
    degradeMisses: 2,
    lostMisses: 5,
    // Links with no fixed ack cadence (Firestore echoes only arrive when
    // something writes) set watchdog:false — tick() never demotes them and
    // their status moves only on explicit noteAck/noteDegraded/noteLost.
    watchdog: true
  });

  function finite(value, fallback) {
    var number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  function createModel(options) {
    options = options || {};
    var now = typeof options.now === 'function' ? options.now : Date.now;
    var listeners = [];
    var links = Object.create(null);

    function configure(key, config) {
      key = String(key || '').trim();
      if (!key) throw new Error('Link key is required');
      config = config || {};
      var existing = links[key];
      links[key] = {
        key: key,
        label: String(config.label || (existing && existing.label) || key),
        ackIntervalMs: Math.max(100, finite(config.ackIntervalMs, existing ? existing.ackIntervalMs : LINK_DEFAULTS.ackIntervalMs)),
        degradeMisses: Math.max(1, Math.floor(finite(config.degradeMisses, existing ? existing.degradeMisses : LINK_DEFAULTS.degradeMisses))),
        lostMisses: Math.max(2, Math.floor(finite(config.lostMisses, existing ? existing.lostMisses : LINK_DEFAULTS.lostMisses))),
        watchdog: config.watchdog != null ? config.watchdog !== false : (existing ? existing.watchdog : LINK_DEFAULTS.watchdog),
        status: existing ? existing.status : 'off',
        lastAckAt: existing ? existing.lastAckAt : 0,
        detail: existing ? existing.detail : '',
        // Free-form per-link facts rendered next to status (e.g. playout
        // ARMED / NOT ARMED for D12.4). Merged via noteMeta, never replaced.
        meta: existing ? existing.meta : {}
      };
      return snapshotLink(key);
    }

    function snapshotLink(key) {
      var link = links[key];
      if (!link) return null;
      return {
        key: link.key,
        label: link.label,
        status: link.status,
        lastAckAt: link.lastAckAt,
        detail: link.detail,
        meta: JSON.parse(JSON.stringify(link.meta))
      };
    }

    function getState() {
      return Object.keys(links).map(snapshotLink);
    }

    function getLink(key) {
      return snapshotLink(String(key || '').trim());
    }

    function subscribe(listener) {
      if (typeof listener !== 'function') throw new Error('Listener must be a function');
      listeners.push(listener);
      return function unsubscribe() {
        listeners = listeners.filter(function (fn) { return fn !== listener; });
      };
    }

    function emit(key, previousStatus) {
      var current = snapshotLink(key);
      listeners.forEach(function (listener) {
        try { listener(current, previousStatus); } catch (err) { /* listeners must not wedge the model */ }
      });
    }

    function transition(key, status, detail) {
      var link = links[key];
      if (!link) throw new Error('Unknown link: ' + key);
      if (!STATUS_SET.has(status)) throw new Error('Unknown link status: ' + status);
      var changedStatus = link.status !== status;
      var changedDetail = detail != null && link.detail !== String(detail);
      if (detail != null) link.detail = String(detail).slice(0, 300);
      if (!changedStatus && !changedDetail) return snapshotLink(key);
      var previous = link.status;
      link.status = status;
      emit(key, previous);
      return snapshotLink(key);
    }

    // An acknowledged round-trip landed. Promotion is instant — recovery must
    // show immediately even though demotion is damped.
    function noteAck(key, detail) {
      var link = links[String(key || '').trim()];
      if (!link) throw new Error('Unknown link: ' + key);
      link.lastAckAt = now();
      return transition(link.key, 'connected', detail != null ? detail : link.detail);
    }

    // A definitive death signal (talent window closed, transport torn down).
    // No hysteresis: a dead link must LOOK dead within seconds.
    function noteLost(key, detail) {
      return transition(String(key || '').trim(), 'lost', detail);
    }

    // An explicit degradation signal for watchdog-less links (Firestore
    // fell back to cache, reconnect in progress). Never promotes.
    function noteDegraded(key, detail) {
      var link = links[String(key || '').trim()];
      if (!link) throw new Error('Unknown link: ' + key);
      if (link.status === 'lost') return transition(link.key, 'lost', detail);
      return transition(link.key, 'degraded', detail);
    }

    // The link is deliberately not in use (no talent window opened yet).
    function noteOff(key, detail) {
      var link = links[String(key || '').trim()];
      if (!link) throw new Error('Unknown link: ' + key);
      link.lastAckAt = 0;
      return transition(link.key, 'off', detail != null ? detail : '');
    }

    function noteMeta(key, patch) {
      var link = links[String(key || '').trim()];
      if (!link) throw new Error('Unknown link: ' + key);
      var changed = false;
      Object.keys(patch || {}).forEach(function (name) {
        var value = patch[name];
        if (link.meta[name] !== value) {
          changed = true;
          if (value == null) delete link.meta[name];
          else link.meta[name] = value;
        }
      });
      if (changed) emit(link.key, link.status);
      return snapshotLink(link.key);
    }

    function missCount(link, at) {
      if (!link.lastAckAt) return Infinity;
      return Math.floor(Math.max(0, at - link.lastAckAt) / link.ackIntervalMs);
    }

    // Evaluate time-based demotion. Call from ONE owner interval per surface;
    // returns the links whose displayed status changed.
    function tick() {
      var at = now();
      var changed = [];
      Object.keys(links).forEach(function (key) {
        var link = links[key];
        if (!link.watchdog || link.status === 'off' || link.status === 'lost') return;
        var misses = missCount(link, at);
        var status = link.status;
        if (misses >= link.lostMisses) status = 'lost';
        else if (misses >= link.degradeMisses) status = 'degraded';
        else status = 'connected';
        if (status !== link.status) {
          transition(key, status, link.detail);
          changed.push(snapshotLink(key));
        }
      });
      return changed;
    }

    return {
      configure: configure,
      getState: getState,
      getLink: getLink,
      subscribe: subscribe,
      noteAck: noteAck,
      noteLost: noteLost,
      noteDegraded: noteDegraded,
      noteOff: noteOff,
      noteMeta: noteMeta,
      tick: tick
    };
  }

  return {
    STATUSES: STATUSES,
    LINK_DEFAULTS: LINK_DEFAULTS,
    createModel: createModel
  };
});
