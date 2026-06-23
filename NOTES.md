# Cueola Account & Entitlement Layer — NOTES

Running log of decisions and anything implemented in reduced form. Newest phase on top.

---

## Phase 2 — Capability resolution  (built; awaiting review)

### Scope change from the owner (important)
Owner clarified: **no pricing now** — the $9/$3.99 tiers were a future/ship-time
concern, not part of this build. Build the capability layer **purely as an addition to
Cueola**, and ship the **full-function web app now**. So Phase 2 builds the architecture
the task asks for, but with gating **off** by default: every account resolves to its
platform's full feature set today. Nothing is hidden from current web users.

### What shipped
- **`resolveCapabilities(entitlement, platform) → featureSet`** in
  `cueola-entitlements.js` — the single pure gate. Mapping lives in the editable
  **`CAPABILITY_MATRIX`** table (web / mac / ipad / iphone, each with a `full` and
  `base` row), not in call sites.
- **`GATING_ENABLED = false`** — the pricing switch. Off → everyone gets the platform's
  `full` row (full-function web now). Flip to `true` when the paid era arrives and the
  free/paid split in the table takes effect with **zero call-site changes**.
- **`detectPlatform()`** — authoritative platform = native build flag
  `window.CUEOLA_PLATFORM`, else `?platform=` dev override, else `web`. A plain browser
  (even on an iPad) is the web app; the native shells inject their flag.
- **Hard device rule enforced in code** (not just the table): iPad & iPhone always get
  `outangutan: 'none'` regardless of tier/gating — applied after the table lookup so a
  future table edit can't leak it. Verified it holds even when forced paid + gating on.
- **Wiring** (`cueola-app.js`): `cueolaComputeCapabilities()` resolves on boot and on
  every entitlement change; exposes `window.cueolaCapabilities`, `window.cueolaPlatform`,
  and a `cueolaCan(key)` helper. `applyCapabilityVisibility()` hides
  `[data-cap-requires="key"]` elements whose capability is unavailable — **a no-op on
  web today** (everything resolves available), the declarative hook platform builds use
  later. Cache-busts bumped to `?v=20260621c`.
- Extended `scripts/test-entitlements.mjs` with capability cases.

### Key decisions
- **"Entitled" = premium tier, not merely active.** A free entitlement is `status:active`
  but NOT entitled to the `full` row. `entitled = (tier ∈ {paid,edu,pro}) && (active ||
  offline-within-grace)`. (Caught by a test — the first pass wrongly treated free as
  entitled.)
- **Full-function web is preserved** by `GATING_ENABLED=false`, not by special-casing the
  web row. The table already describes the eventual paid/free split; the flag just makes
  it inert for now. Honest + future-ready.
- **No UI was stripped.** Per owner direction, capability gating is additive plumbing;
  the entry cards/screens are untouched and all visible. The mechanism to gate exists
  (`data-cap-requires` + `cueolaCan`) and is verified, but nothing on web resolves to
  unavailable, so the live UI is unchanged.

### Reduced scope / deferred
- **iPhone-requires-paid (open decision #1)** — owner said skip. Left at the safe default
  in the table: iPhone `base` == `full` (open to any account). Flip the iPhone `base` row
  when gating goes live to require paid.
- **iPad-class vs Mac-class split (open decision #2)** — owner said skip. Single `paid`
  tier; `pro` slot still reserved. No second tier added.
- **Phase 3 (unlock paths: Apple IAP, Stripe/Paddle webhooks) is deferred** per the "no
  pricing now" direction. The model already carries `source`/`appAccountToken`/the
  server-write seam, so it's ready when pricing is.

### How to test Phase 2
1. Load the app → `window.cueolaPlatform === 'web'`, `window.cueolaCapabilities` shows
   `cueola/plandaBear/flowmingo: 'full'`, `outangutan: 'basic'`; **no entry card hidden**;
   no console errors; existing flows unchanged.
2. Pure function across platforms (console):
   `CueolaEntitlements.resolveCapabilities(CueolaEntitlements.freeEntitlement(),'mac')`
   → `outangutan:'full'`; `'ipad'`/`'iphone'` → `outangutan:'none'`; `'iphone'` →
   `cueola:'read'`.
3. Hard rule: force paid + gating on for iPad/iPhone → Outangutan still `'none'`.
4. Gating preview: `resolveCapabilities(free,'web',{gatingEnabled:true}).outangutan ===
   'none'` vs paid → `'basic'`.

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
