/* ============================================================================
 * cueola-entitlements.js — Phase 1: the account + entitlement MODEL.
 *
 * One ACCOUNT holds one ENTITLEMENT state. This module owns:
 *   • the canonical entitlement shape + an editable per-tier config table,
 *   • pure helpers (free/normalize/isActive/isExpired/isWithinGrace),
 *   • account identity that EXTENDS Cueola's existing identity (admin id or a
 *     persistent device id) — no parallel auth system,
 *   • an offline-tolerant EntitlementStore that reads the SERVER-AUTHORITATIVE
 *     doc at accounts/{id} and caches it so live use survives a bad network.
 *
 * Two principles enforced architecturally:
 *   1. SERVER-AUTHORITATIVE — entitlement is only ever ELEVATED by the
 *      server-written Firestore doc (via _applyServer). Normal app flow can
 *      never self-grant paid. The client only READS + CACHES.
 *   2. OFFLINE-TOLERANT — get() is synchronous and never blocks on the network;
 *      on a read failure the store keeps serving the cache within a grace window.
 *
 * DOM-free and Firebase-injected on purpose, so it unit-tests in plain Node.
 * Loaded as a classic global script BEFORE cueola-app.js → window.CueolaEntitlements.
 * Capability resolution + platform detection are Phase 2 and intentionally NOT here.
 * ==========================================================================*/
(function (root, factory) {
  const api = factory();
  // Browser: attach to window. Node (tests): attach to globalThis + module.exports.
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.CueolaEntitlements = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const VERSION = 1;
  const KB = 1024, MB = 1024 * KB, GB = 1024 * MB;

  // localStorage keys (additive; do not collide with existing cueola_* keys).
  const CACHE_KEY = 'cueola_entitlement_v1';
  const DEVICE_ACCOUNT_KEY = 'cueola_account_id';

  // Grace window: how long an EXPIRED entitlement is still honored while the
  // device is offline, so a network outage never kills a running show.
  const GRACE_MS = 14 * 24 * 60 * 60 * 1000; // 14 days

  const TIERS = ['free', 'paid', 'edu', 'pro']; // 'pro' reserved for the future $99 tier
  const SOURCES = ['apple_iap', 'web', 'edu_grant'];
  const STATUSES = ['none', 'pending', 'active', 'expired', 'refunded'];

  // ── EDITABLE CONFIG TABLE ─────────────────────────────────────────────────
  // Per-tier defaults. Phase 4 owns the real numbers + server-side enforcement;
  // these are seeded here so the model carries a `limits` block from day one.
  // Change a tier's caps here, not in scattered code.
  const TIER_CONFIG = {
    free: {
      label: 'Free',
      limits: { storageBytes: 50 * MB, maxUploadBytes: 5 * MB, syncBytesPerMonth: 200 * MB },
    },
    paid: {
      label: 'Cueola Unlock',
      limits: { storageBytes: 5 * GB, maxUploadBytes: 250 * MB, syncBytesPerMonth: 20 * GB },
    },
    edu: { // same capability/caps as paid by design
      label: 'Education',
      limits: { storageBytes: 5 * GB, maxUploadBytes: 250 * MB, syncBytesPerMonth: 20 * GB },
    },
    pro: { // reserved
      label: 'Pro',
      limits: { storageBytes: 25 * GB, maxUploadBytes: 1 * GB, syncBytesPerMonth: 100 * GB },
    },
  };

  // ── small pure utilities ──────────────────────────────────────────────────
  function nowMs(now) { return typeof now === 'number' ? now : Date.now(); }

  function toIsoOrNull(v) {
    if (v == null || v === '') return null;
    if (typeof v === 'number') { const d = new Date(v); return isNaN(d) ? null : d.toISOString(); }
    if (typeof v === 'string') { const t = Date.parse(v); return isNaN(t) ? null : new Date(t).toISOString(); }
    // Firestore Timestamp { seconds } or Date
    if (typeof v === 'object') {
      if (typeof v.toDate === 'function') { try { return v.toDate().toISOString(); } catch { return null; } }
      if (typeof v.seconds === 'number') return new Date(v.seconds * 1000).toISOString();
    }
    return null;
  }

  function tierLimits(tier) {
    const cfg = TIER_CONFIG[tier] || TIER_CONFIG.free;
    return { ...cfg.limits };
  }

  // ── model factories ───────────────────────────────────────────────────────
  function freeEntitlement(opts) {
    opts = opts || {};
    return {
      schemaVersion: VERSION,
      accountId: opts.accountId || null,
      tier: 'free',
      source: null,
      status: 'active',         // a free account is an active free account
      grantedAt: null,
      expiresAt: null,          // perpetual
      limits: tierLimits('free'),
      appAccountToken: null,    // bound at IAP purchase (Phase 3)
      updatedAt: toIsoOrNull(nowMs(opts.now)),
    };
  }

  // Coerce ANY raw object (server doc or cached blob) into the canonical shape.
  // Defensive: unknown/garbage values fall back to the safe (free/none) defaults
  // so a tampered or partial doc can never widen access by accident.
  function normalizeEntitlement(raw, opts) {
    opts = opts || {};
    if (!raw || typeof raw !== 'object') return freeEntitlement(opts);

    const tier = TIERS.indexOf(raw.tier) >= 0 ? raw.tier : 'free';
    const source = SOURCES.indexOf(raw.source) >= 0 ? raw.source : null;
    let status = STATUSES.indexOf(raw.status) >= 0 ? raw.status : (tier === 'free' ? 'active' : 'none');

    // limits: start from the tier defaults, allow server to TIGHTEN/override
    // individual numeric caps (never invent non-numeric values).
    const limits = tierLimits(tier);
    if (raw.limits && typeof raw.limits === 'object') {
      for (const k of Object.keys(limits)) {
        if (typeof raw.limits[k] === 'number' && raw.limits[k] >= 0) limits[k] = raw.limits[k];
      }
    }

    return {
      schemaVersion: VERSION,
      accountId: typeof raw.accountId === 'string' && raw.accountId ? raw.accountId : (opts.accountId || null),
      tier,
      source,
      status,
      grantedAt: toIsoOrNull(raw.grantedAt),
      expiresAt: toIsoOrNull(raw.expiresAt),
      limits,
      appAccountToken: typeof raw.appAccountToken === 'string' ? raw.appAccountToken : null,
      updatedAt: toIsoOrNull(raw.updatedAt) || toIsoOrNull(nowMs(opts.now)),
    };
  }

  // ── status predicates ─────────────────────────────────────────────────────
  function isExpired(ent, now) {
    if (!ent || !ent.expiresAt) return false; // null expiry = perpetual
    return Date.parse(ent.expiresAt) <= nowMs(now);
  }

  // Active = server says active AND not past expiry. This is the strict check.
  function isActive(ent, now) {
    if (!ent) return false;
    if (ent.status === 'refunded' || ent.status === 'none') return false;
    if (ent.status === 'pending') return false;
    return !isExpired(ent, now);
  }

  // Within grace = expired but still inside the offline grace window. Consumers
  // use (isActive || (offline && isWithinGrace)) so a bad network never demotes
  // a live show mid-performance. Refunds are never within grace.
  function isWithinGrace(ent, now) {
    if (!ent) return false;
    if (ent.status === 'refunded') return false;
    if (!ent.expiresAt) return ent.status === 'active'; // perpetual: grace == active
    return nowMs(now) < (Date.parse(ent.expiresAt) + GRACE_MS);
  }

  // ── account identity (extends existing identity; no parallel auth) ─────────
  // Account id resolution priority is owned by the app glue; this module just
  // provides the persistent DEVICE fallback id so we always have a stable id to
  // bind appAccountToken to at purchase and to link an account to later.
  function getDeviceAccountId(storage) {
    const store = storage || safeLocalStorage();
    let id = null;
    try { id = store.getItem(DEVICE_ACCOUNT_KEY); } catch {}
    if (!id) {
      id = 'acct_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
      try { store.setItem(DEVICE_ACCOUNT_KEY, id); } catch {}
    }
    return id;
  }

  // ── EntitlementStore: offline-tolerant, server-authoritative ──────────────
  // config: { accountId, firestore?, storage?, now?, log?, graceMs? }
  //   firestore = { db, doc, onSnapshot }  (the window._* handles)
  function createStore(config) {
    config = config || {};
    const storage = config.storage || safeLocalStorage();
    const log = config.log || function () {};
    const accountId = config.accountId || getDeviceAccountId(storage);

    let current = freeEntitlement({ accountId, now: config.now });
    let cachedAt = 0;
    let unsub = null;
    let started = false;
    const subscribers = new Set();

    function cacheKey() { return CACHE_KEY; }

    function loadCache() {
      try {
        const blob = JSON.parse(storage.getItem(cacheKey()) || 'null');
        if (blob && blob.accountId === accountId && blob.entitlement) {
          current = normalizeEntitlement(blob.entitlement, { accountId, now: config.now });
          cachedAt = typeof blob.cachedAt === 'number' ? blob.cachedAt : 0;
          return true;
        }
      } catch {}
      return false;
    }

    function saveCache() {
      try {
        storage.setItem(cacheKey(), JSON.stringify({
          accountId, entitlement: current, cachedAt: nowMs(config.now),
        }));
      } catch {}
    }

    function emit() { subscribers.forEach(function (cb) { try { cb(current); } catch {} }); }

    function set(ent, fromServer) {
      current = normalizeEntitlement(ent, { accountId, now: config.now });
      if (fromServer) { cachedAt = nowMs(config.now); saveCache(); }
      emit();
    }

    // The ONLY elevation path. In production this is fed exclusively by the
    // server-written accounts/{id} doc; the client never calls it to grant itself.
    function _applyServer(raw) { set(raw, true); }

    function attachFirestore(fs) {
      if (!fs || !fs.db || !fs.doc || !fs.onSnapshot) { log('entitlement: firestore unavailable, cache-only'); return; }
      try {
        const ref = fs.doc(fs.db, 'accounts', accountId);
        unsub = fs.onSnapshot(ref, function (snap) {
          if (snap && snap.exists && snap.exists()) {
            _applyServer(snap.data());
          } else {
            // No server doc yet → this account is free. Keep it as free, cached.
            _applyServer(freeEntitlement({ accountId, now: config.now }));
          }
        }, function (err) {
          // Read failed (offline / rules / App Check). Keep serving cache — do
          // NOT demote. This is the offline-tolerance guarantee.
          log('entitlement: snapshot error, serving cache', err && err.code);
        });
      } catch (err) {
        log('entitlement: attach failed, serving cache', err && err.message);
      }
    }

    return {
      get accountId() { return accountId; },
      // get() is synchronous and never blocks — safe to call mid-show.
      get: function () { return current; },
      cachedAt: function () { return cachedAt; },
      limits: function () { return current.limits; },
      tier: function () { return current.tier; },
      isActive: function (now) { return isActive(current, now); },
      isWithinGrace: function (now) { return isWithinGrace(current, now); },

      subscribe: function (cb) { subscribers.add(cb); try { cb(current); } catch {} return function () { subscribers.delete(cb); }; },

      // Seed from cache synchronously, then attach the server listener (if any).
      // Returns immediately; never awaits the network.
      start: function () {
        if (started) return this;
        started = true;
        loadCache();
        emit();
        if (config.firestore) attachFirestore(config.firestore);
        return this;
      },
      stop: function () { if (unsub) { try { unsub(); } catch {} unsub = null; } started = false; },

      // Exposed for the server/admin tooling seam + tests. Not called by app flow.
      _applyServer,
    };
  }

  function safeLocalStorage() {
    try {
      if (typeof localStorage !== 'undefined') return localStorage;
    } catch {}
    // in-memory shim (Node / restricted contexts)
    const m = new Map();
    return {
      getItem: function (k) { return m.has(k) ? m.get(k) : null; },
      setItem: function (k, v) { m.set(k, String(v)); },
      removeItem: function (k) { m.delete(k); },
    };
  }

  return {
    VERSION,
    GRACE_MS,
    TIERS, SOURCES, STATUSES,
    TIER_CONFIG,
    // model
    freeEntitlement,
    normalizeEntitlement,
    tierLimits,
    isActive,
    isExpired,
    isWithinGrace,
    // identity
    getDeviceAccountId,
    // store
    createStore,
    // internals exposed for tests
    _toIsoOrNull: toIsoOrNull,
  };
});
