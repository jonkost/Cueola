// Node test for the Phase 1 entitlement model. Run: node scripts/test-entitlements.mjs
// Pure-model + offline-store coverage. No DOM, no Firebase, no network.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const E = require('../cueola-entitlements.js');

let passed = 0;
const ok = (name, fn) => { fn(); passed++; console.log('  ✓ ' + name); };

// in-memory storage shim
function memStore() {
  const m = new Map();
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k), _m: m };
}

console.log('entitlement model');

ok('free entitlement is active, perpetual, no source', () => {
  const f = E.freeEntitlement({ accountId: 'acct_x' });
  assert.equal(f.tier, 'free');
  assert.equal(f.source, null);
  assert.equal(f.status, 'active');
  assert.equal(f.expiresAt, null);
  assert.equal(f.accountId, 'acct_x');
  assert.equal(f.limits.maxUploadBytes, E.TIER_CONFIG.free.limits.maxUploadBytes);
});

ok('normalize coerces garbage tier/source/status to safe defaults', () => {
  const n = E.normalizeEntitlement({ tier: 'hacker', source: 'free_money', status: 'godmode' });
  assert.equal(n.tier, 'free');
  assert.equal(n.source, null);
  assert.equal(n.status, 'active'); // free defaults to active
});

ok('normalize keeps a valid paid grant and tier limits', () => {
  const n = E.normalizeEntitlement({ tier: 'paid', source: 'apple_iap', status: 'active' });
  assert.equal(n.tier, 'paid');
  assert.equal(n.source, 'apple_iap');
  assert.equal(n.limits.storageBytes, E.TIER_CONFIG.paid.limits.storageBytes);
});

ok('paid with non-active status (no source) is not active', () => {
  const n = E.normalizeEntitlement({ tier: 'paid', status: 'none' });
  assert.equal(E.isActive(n), false);
});

ok('limits override accepts numeric, rejects junk', () => {
  const n = E.normalizeEntitlement({ tier: 'paid', status: 'active', limits: { storageBytes: 123, maxUploadBytes: 'lots' } });
  assert.equal(n.limits.storageBytes, 123);
  assert.equal(n.limits.maxUploadBytes, E.TIER_CONFIG.paid.limits.maxUploadBytes); // junk ignored
});

ok('date coercion handles ISO, epoch ms, and Firestore Timestamp', () => {
  assert.equal(E._toIsoOrNull('2026-01-01T00:00:00.000Z'), '2026-01-01T00:00:00.000Z');
  assert.equal(E._toIsoOrNull(0), '1970-01-01T00:00:00.000Z');
  assert.equal(E._toIsoOrNull({ seconds: 1735689600 }), '2025-01-01T00:00:00.000Z');
  assert.equal(E._toIsoOrNull('not a date'), null);
});

console.log('status predicates');
const T0 = Date.parse('2026-06-21T00:00:00Z');
const day = 24 * 60 * 60 * 1000;

ok('perpetual paid is active forever', () => {
  const n = E.normalizeEntitlement({ tier: 'paid', source: 'web', status: 'active', expiresAt: null });
  assert.equal(E.isActive(n, T0), true);
  assert.equal(E.isExpired(n, T0 + 9999 * day), false);
});

ok('expiry flips active → expired, but grace still honors it', () => {
  const exp = new Date(T0 + 1 * day).toISOString();
  const n = E.normalizeEntitlement({ tier: 'paid', source: 'web', status: 'active', expiresAt: exp });
  assert.equal(E.isActive(n, T0), true);                 // before expiry
  assert.equal(E.isActive(n, T0 + 2 * day), false);      // after expiry → not strictly active
  assert.equal(E.isWithinGrace(n, T0 + 2 * day), true);  // ...but within grace (show survives)
  assert.equal(E.isWithinGrace(n, T0 + 20 * day), false); // past 14-day grace
});

ok('refunded is never active and never within grace', () => {
  const n = E.normalizeEntitlement({ tier: 'paid', source: 'apple_iap', status: 'refunded' });
  assert.equal(E.isActive(n, T0), false);
  assert.equal(E.isWithinGrace(n, T0), false);
});

console.log('account identity');
ok('device account id is stable across calls', () => {
  const s = memStore();
  const a = E.getDeviceAccountId(s);
  const b = E.getDeviceAccountId(s);
  assert.equal(a, b);
  assert.match(a, /^acct_/);
});

console.log('offline-tolerant store');
ok('get() is synchronous and returns free before any server data', () => {
  const s = memStore();
  const store = E.createStore({ accountId: 'acct_1', storage: s }).start();
  assert.equal(store.get().tier, 'free');
  assert.equal(store.isActive(), true);
});

ok('server doc elevates to paid and is cached', () => {
  const s = memStore();
  const store = E.createStore({ accountId: 'acct_2', storage: s }).start();
  store._applyServer({ tier: 'paid', source: 'web', status: 'active' });
  assert.equal(store.tier(), 'paid');
  // a fresh store for the same account reads the cache synchronously (offline)
  const store2 = E.createStore({ accountId: 'acct_2', storage: s }).start();
  assert.equal(store2.tier(), 'paid');
  assert.equal(store2.isActive(), true);
});

ok('cache is per-account: a different id does not inherit paid', () => {
  const s = memStore();
  E.createStore({ accountId: 'acct_3', storage: s }).start()._applyServer({ tier: 'paid', status: 'active' });
  const other = E.createStore({ accountId: 'acct_4', storage: s }).start();
  assert.equal(other.tier(), 'free');
});

ok('subscribe fires immediately and on change', () => {
  const s = memStore();
  const store = E.createStore({ accountId: 'acct_5', storage: s }).start();
  const seen = [];
  const off = store.subscribe(e => seen.push(e.tier));
  store._applyServer({ tier: 'paid', status: 'active' });
  off();
  store._applyServer({ tier: 'free', status: 'active' });
  assert.deepEqual(seen, ['free', 'paid']); // immediate 'free', then 'paid'; unsub stops the rest
});

console.log('capability resolution');
const paid = E.normalizeEntitlement({ tier: 'paid', source: 'web', status: 'active' });
const free = E.freeEntitlement();

ok('web (gating off) is full + Outangutan basic for any account', () => {
  const c = E.resolveCapabilities(free, 'web');
  assert.equal(c.cueola, 'full');
  assert.equal(c.plandaBear, 'full');
  assert.equal(c.flowmingo, 'full');
  assert.equal(c.outangutan, 'basic');
  assert.equal(c.outangutanUpload, 'limited');
  assert.equal(c.outangutanPlayout, 'simple');
});

ok('mac (gating off) unlocks full Outangutan engine', () => {
  assert.equal(E.resolveCapabilities(free, 'mac').outangutan, 'full');
});

ok('iPad/iPhone NEVER expose Outangutan (hard rule), even forced full + paid', () => {
  for (const p of ['ipad', 'iphone']) {
    const c = E.resolveCapabilities(paid, p, { gatingEnabled: true });
    assert.equal(c.outangutan, 'none', p + ' outangutan');
    assert.equal(c.outangutanUpload, 'none');
    assert.equal(c.flowmingoAsPrompter, true, p + ' flowmingo-as-prompter');
  }
});

ok('iPhone is rundown READ, not full edit', () => {
  assert.equal(E.resolveCapabilities(paid, 'iphone').cueola, 'read');
});

ok('gating ON: free web loses Outangutan, paid web keeps it', () => {
  assert.equal(E.resolveCapabilities(free, 'web', { gatingEnabled: true }).outangutan, 'none');
  assert.equal(E.resolveCapabilities(paid, 'web', { gatingEnabled: true }).outangutan, 'basic');
});

ok('unknown platform falls back to web', () => {
  assert.equal(E.resolveCapabilities(free, 'playstation').platform, 'web');
});

ok('can() reports availability (none/false → unavailable)', () => {
  const c = E.resolveCapabilities(free, 'web');
  assert.equal(E.can(c, 'cueola'), true);
  assert.equal(E.can(c, 'outangutan'), true);
  assert.equal(E.can(E.resolveCapabilities(free, 'ipad'), 'outangutan'), false);
});

console.log(`\nAll ${passed} entitlement tests passed.`);
