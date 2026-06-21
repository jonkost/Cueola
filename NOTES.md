# Cueola Account & Entitlement Layer — NOTES

Running log of decisions and anything implemented in reduced form. Newest phase on top.

---

## Phase 1 — The model  (built; awaiting review)

### What shipped
- **`cueola-entitlements.js`** — new classic global script, loaded before
  `cueola-app.js`, exposing `window.CueolaEntitlements`. DOM-free, Firebase-injected.
  - Canonical entitlement shape + editable per-tier `TIER_CONFIG` table.
  - Pure helpers: `freeEntitlement`, `normalizeEntitlement`, `tierLimits`,
    `isActive`, `isExpired`, `isWithinGrace`.
  - `getDeviceAccountId` (persistent device id) — the account-identity baseline.
  - `createStore(...)` — offline-tolerant, server-authoritative `EntitlementStore`.
- **`scripts/test-entitlements.mjs`** — Node test for the pure model + store.
- **Wiring** (`cueola-app.js`, after the admin init): `cueolaInitEntitlements()`
  builds + starts the store on `firebaseReady`, keyed to `adminSession.id` or the
  device id. Exposes `window.cueolaEntitlements`. **Additive — gates nothing.**
- **`index.html`**: added the script tag; bumped both cache-busts to `?v=20260621a`.

### Key decisions
- **Where "account" lives.** Cueola had no per-user account — only a session *code*
  (collaboration key) and an *admin roster* (person identity). I did **not** add a
  parallel auth system. Account id = signed-in admin id when present, else a stable
  device id persisted at `cueola_account_id`. This always gives us an id to bind
  `appAccountToken` to (Phase 3) and to link/upgrade later.
- **Server-authoritative, enforced by structure.** Entitlement is only ever elevated
  through `EntitlementStore._applyServer`, which in production is fed *only* by the
  server-written `accounts/{id}` Firestore doc. No normal code path self-grants paid.
- **Offline tolerance.** `store.get()` is synchronous (seeded from the
  `cueola_entitlement_v1` cache) and never awaits the network. A snapshot error keeps
  serving the cache — never demotes. `isWithinGrace` honors an expired entitlement for
  14 days offline so a network outage can't kill a running show.
- **Defensive normalization.** `normalizeEntitlement` clamps tier/source/status to
  known sets and only accepts numeric limit overrides, so a tampered/partial doc can
  never *widen* access — it degrades to free/none.

### Reduced scope / deferred (on purpose)
- **No capability resolution and no platform detection** — that's Phase 2
  (`resolveCapabilities(entitlement, platform)`). Phase 1 deliberately gates nothing.
- **Re-keying the store on admin login/logout** is not wired into `loginAdmin`/
  `logoutAdmin` yet (kept Phase 1 surgical). The store keys off identity at boot;
  `cueolaInitEntitlements()` is idempotent and exposed for Phase 2 to call on identity
  change.
- **`accounts/{id}` Firestore rules added locally, NOT deployed.** `firestore.rules`
  now has `match /accounts/{accountId} { allow read: if true; allow write: if false; }`
  — public read (entitlement holds no secrets; needed for the server-authoritative read
  path) and **all client writes denied**, so grants can come only from the server
  (Cloud Functions / Admin SDK, which bypasses rules). Until then there is no writer, so
  grants are a documented seam, not yet exercised end-to-end. **Owed:** deploy the rules
  (`firebase deploy --only firestore:rules`) and, when Auth lands, tighten read to
  `request.auth.uid == accountId` + App Check. Rules are **not** deployed from here
  (owner deploys — see memory `feedback_git_workflow`). In the live preview the
  *undeployed* deny-all rule makes the `accounts` read return `permission-denied`; the
  store logs a `debug` and serves cache (correct offline behavior, verified).
- **No backend.** Phases 3–5 (IAP JWS verification, Stripe/Paddle webhooks, JWT
  license signing, server-side quotas) require **Firebase Cloud Functions**, which
  the repo does not have. See PLAN.md "Server boundary".
- `hashStr` (existing admin code hashing) is a **non-crypto** 32-bit hash; fine for the
  current open-rules model but not a security boundary. Out of scope for Phase 1.

### How to test Phase 1 (before moving to Phase 2)
1. `node scripts/test-entitlements.mjs` → all pure-model + store tests pass.
   *(No Node runtime on this machine — verified equivalently in the browser, below.)*
2. Load the app. Console should show **no errors**; `window.CueolaEntitlements` and
   `window.cueolaEntitlements` exist; `window.cueolaEntitlements.get().tier === 'free'`
   and `.isActive() === true` for a fresh account.
3. Confirm **no behavior change**: entry cards, join/create session, Planda Bear,
   Flowmingo all work exactly as before (Phase 1 gates nothing).
4. Simulate a server grant in the console:
   `cueolaEntitlements._applyServer({tier:'paid',source:'web',status:'active'})` →
   `.tier()` becomes `'paid'`; reload → still `'paid'` (read from cache, proves
   offline persistence). Then `_applyServer({tier:'free',status:'active'})` to reset.

### Open decisions still pending owner confirmation (left as config for later phases)
1. **iPhone access level** — paid-required vs. open to any authenticated account.
2. **iPad-class vs Mac-class entitlement** — keep one `paid`, or split $3.99 (web +
   basic Outangutan) from $9 (full Mac engine). Model already supports a second tier
   (`pro` slot is reserved); flip on when decided.
