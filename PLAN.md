# Cueola Account & Entitlement Layer — PLAN

> Single source of truth for **who can access what, on which device**. The apps
> (web, Mac, iPad, iPhone) are free clients; the **account + entitlement** is the
> product. This document records what already exists in the repo (Phase 0) and how
> each build phase maps onto it.

---

## Phase 0 — What's already here (the system we extend)

Cueola is a **static site + Firebase (serverless)**. There is no application server.

| Piece | Where | Notes |
|---|---|---|
| App shell | `index.html` (~3.2k lines) | Loads `cueola-app.js?v=…` as a **classic global script**, then a small ES-module `<script>` that boots Firebase. |
| App logic | `cueola-app.js` (~12.3k lines) | Everything is a global function/var in this one file. No bundler, no modules. |
| Instructor view | `dashboard.html` | Launches rundowns via `localStorage('cueola_session')` + `?code=`. |
| Firebase | project **`cueola`** | Loads `firebase-app`, `firebase-app-check`, `firebase-firestore`. **No `firebase-auth`.** App Check is wired but **disabled** (`APP_CHECK_RECAPTCHA_V3_SITE_KEY = ""`). |
| Firestore handles | `window._db`, `window._doc`, `window._setDoc`, `window._getDoc`, `window._onSnapshot`, `window._updateDoc`, `window._deleteDoc`, `window._runTransaction`, … | The app passes Firestore around as `window._*` globals; modules consume those rather than importing Firebase. |

### Identity primitives that exist today

1. **Session code** — `session = { code, role, userName, isDemo, isExpert }`
   (`cueola-app.js:49`). The code (e.g. `2606K`, from `genCode()`) is a **shared
   collaboration key**, stored at Firestore `sessions/{code}` (rundown, prompter,
   presence, …). It is **not** a per-user account — anyone with the code is in.
2. **Admin roster** — the closest thing to real accounts. `admins/global` holds
   `{ list: [{ id, name, codeHash, level }] }` (`cueola-app.js:1150-1299`).
   Login hashes a code (`hashStr`, a non-crypto 32-bit hash) and matches `codeHash`;
   `adminSession = { id, name, level }` is cached in `localStorage('cueola_admin_sess')`.
   Persistent, **cloud-mirrored, person-level identity** with an owner-bootstrap path.
3. **Device-local prefs** — `cueola_last_code`, `cueola_last_name`, theme, etc.

### Firestore rules (current)

`firestore.rules`: `sessions/{code}` and `admins/global` are **publicly read/write**
(`if true` / shape-pinned). No `request.auth` to gate on because no Auth is loaded.
The documented real protection is **App Check** (wired, not yet enforced). See
`docs/app-check-rollout.md`.

### Offline behavior already in the codebase (the pattern we mirror)

The app already degrades gracefully when Firestore is unreachable: `waitForFirebaseReady()`
times out → `openLocalSession()`; admin roster falls back to the `localStorage` mirror;
writes are best-effort with `reportCloudWriteFailure`. **Entitlement checks must follow
this same offline-tolerant pattern — never block on a live server call.**

### What does NOT exist yet (this task builds it)

- ❌ No `entitlement` / `tier` / `paid` / `license` concept anywhere.
- ❌ No **Outangutan** — **0 references** in `index.html` or `cueola-app.js`. It is a
  future product, not an existing feature.
- ❌ No platform detection (web / Mac / iPad / iPhone).
- ❌ No payment, IAP, or webhook code. No Cloud Functions directory.

---

## The model we're adding (recap of the target)

One **account** → one **entitlement state**:

```
tier      : 'free' | 'paid' | 'edu'      (reserved: 'pro')
source    : 'apple_iap' | 'web' | 'edu_grant' | null
status    : 'active' | 'expired' | 'refunded' | 'pending' | 'none'
grantedAt : ISO | null
expiresAt : ISO | null                    (null = one-time / perpetual)
limits    : { storageBytes, maxUploadBytes, syncBytesPerMonth }   (Phase 4)
```

A single account/entitlement is usable across every platform (Apple-permitted
multiplatform pattern). Two non-negotiables hold throughout:

- **Server-authoritative.** The client never decides what it may do. It reads a
  server-written entitlement (or validates a server-signed token). No trusted client flag.
- **Live use survives a bad network.** Cache a signed entitlement and keep working
  through an outage; never block playback or a running show on a live server call.

---

## How each phase maps onto Cueola

### Phase 1 — The model  ← built now, then STOP for review
- **New file `cueola-entitlements.js`** (classic global script, loaded *before*
  `cueola-app.js`), exposing `window.CueolaEntitlements`. Self-contained, **DOM-free
  and Firebase-injected** so it is unit-testable in Node. This isolates the new layer
  from the 12k-line file (lower merge risk; see memory on dropped merges).
- Defines the **canonical entitlement shape**, per-tier defaults in an **editable
  config table** (`TIERS`), and pure helpers: `freeEntitlement`, `normalizeEntitlement`
  (defensive coercion of server/cache data), `isActive`, `isExpired`, `isWithinGrace`.
- **Account identity** extends what exists: account id = `adminSession.id` when an
  admin is signed in, else a persistent **device account id** (`cueola_account_id`).
  This guarantees we always have a stable id to bind `appAccountToken` to at purchase
  (Phase 3) and to link accounts later. **No parallel auth system.**
- **Offline-tolerant `EntitlementStore`**: seeds synchronously from a localStorage
  cache (`cueola_entitlement_v1`), then attaches a Firestore listener on
  `accounts/{accountId}` as the **server-authoritative** source. `get()` is synchronous
  and never blocks; on read failure it keeps serving cache within a grace window.
- **Thin wiring** into `cueola-app.js` boot: derive the account id from the existing
  identity and `start()` the store on `firebaseReady`. **Additive only — no feature
  gating, no UI change in Phase 1.**

### Phase 2 — Capability resolution (next)
- One **pure** `resolveCapabilities(entitlement, platform) → featureSet`, driven by an
  **editable config table**, called by all clients. Add platform detection
  (web / Mac / iPad / iPhone). Hard rule encoded in the table: **iPad & iPhone return no
  Outangutan at the device level**, and the hosted web view must not expose it either.
- Replace the entry-screen cards / screen access (`entry`, `rundown`, `liveshow`,
  `promptypus`, `flowOp`) so visibility derives from `resolveCapabilities`, never
  hardcoded per surface.

### Phase 3 — Unlock paths (both converge on ONE account)
- **Apple IAP** ($9 non-consumable, StoreKit 2): bind `appAccountToken` = Cueola
  account id; **verify server-side** (JWS + App Store Server API); subscribe to App
  Store Server Notifications v2. On verified purchase → `tier=paid, source=apple_iap`.
- **Web checkout** (Stripe / Paddle-as-MoR): on provider webhook → `tier=paid, source=web`.
- Both write the **same `accounts/{id}.entitlement`**. Account linking reconciles by
  `appAccountToken` / email. **Requires a server writer (Cloud Functions)** — see
  "Server boundary" below.

### Phase 4 — Edu grants + cost guardrails
- Edu/non-profit free grant → `tier=edu` (same caps as paid). Switchable mechanism:
  email-domain allowlist | redemption codes | manual approval queue.
- **Server-side quotas per account by tier**: storage cap, per-file upload cap,
  sync/bandwidth allowance. Reject/degrade past cap; surface usage vs. cap in the UI.
  The `limits` block + `TIERS` table seeded in Phase 1 are the hook for this.

### Phase 5 — Outangutan download + license gating
- Direct download from cueola.com gated by **Mac-level** entitlement; issue a
  **signed JWT license** tied to the account. The native Mac engine validates locally
  (signature + expiry), caches it, re-checks when online, with a **grace period** so a
  lapsed check never kills a show. Kept **separate from the IAP flow** and **out of the
  App Store listing**.

---

## Server boundary (the elephant: there's no backend yet)

Phases 3–5 require **server-authoritative** verification (IAP JWS, Stripe webhooks,
JWT signing, quota enforcement). A static + Firestore site cannot do that securely on
the client. The intended server is **Firebase Cloud Functions** (not yet in the repo).

Phase 1 respects this boundary by design:
- The client **reads** `accounts/{id}.entitlement` (legitimately client-side) and
  caches it. The **read/cache path is all Phase 1 implements.**
- Granting/elevating entitlement is funneled through a single seam
  (`EntitlementStore._applyServer`) that, in production, is fed only by the
  server-written Firestore doc. Normal app flow can **never self-grant paid**.
- Firestore rules must eventually lock `accounts/{id}.entitlement` to the server
  writer (App Check + a privileged Functions identity). Until Functions exist, this is
  tracked in `NOTES.md`; rules are **not** deployed from here (owner deploys rules).

---

## Definition of done (per phase) — tracking

- [x] Extends Cueola's existing auth/session system; no parallel auth. *(Phase 1)*
- [ ] `resolveCapabilities()` is the single gate; clients hold no hardcoded entitlements. *(Phase 2)*
- [ ] Both unlock paths land on one account; refunds/expiry reflected server-side. *(Phase 3)*
- [ ] Quotas enforced server-side; usage visible to the user. *(Phase 4)*
- [ ] Mac license validation works fully offline within the grace window. *(Phase 5)*
- [x] `NOTES.md` records reduced-scope choices; pause and summarize before next phase.
