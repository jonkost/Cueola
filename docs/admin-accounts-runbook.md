# Admin Accounts Runbook (v2.1 · design D1)

Username + password sign-in for **admins only** — students keep codes and
profiles (no passwords, university rule). Sign-in maps `<username>` to the
synthetic email `<username>@admins.cueola.app` on Firebase Auth; authorization
is the `admins/{uid}` Firestore doc (`{username, name, level}`, level =
`super` | `standard`). Rules check `isAdmin()` / `isSuperAdmin()`.

## One-time setup (owner)

1. **Console errand (~5 min), one visit:**
   - Firebase Console → project `cueola` → Authentication → Sign-in method →
     enable **Email/Password**. Under Settings → User actions, turn ON
     **email enumeration protection**.
   - Same visit: **App Check** → register the web app(s) with reCAPTCHA v3 in
     **monitor mode** (no enforcement). Phase 10 flips enforcement on soaked data.
2. **Service-account key** (for the local scripts): Project settings →
   Service accounts → Generate new private key. Save it ONLY in
   `~/Documents/Cueola-recovery-local/` — never in a repo or web root.
3. **Mint your own super account** (local, bypasses rules — first-admin bootstrap):
   ```
   ~/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node \
     ~/Documents/Cueola-recovery-local/cueola-bootstrap-admin.mjs \
     ~/Documents/Cueola-recovery-local/<service-account>.json \
     <username> "<Full Name>" '<password>' super
   ```
4. Sign in on the dashboard. Every further instructor account is minted on
   **Dashboard → Accounts** (super only) with a temp password; instructors
   change it via their account controls.

## Password resets (decision 3: owner-run script, zero exposure)

Synthetic emails cannot receive reset mail — resets are a local script:
```
node ~/Documents/Cueola-recovery-local/cueola-reset-admin-password.mjs \
  <service-account>.json <username> '<new-password>'
```

## Revoking access

Dashboard → Accounts → Remove deletes `admins/{uid}`: all admin access dies
instantly (rules check the doc, not the Auth user). The orphaned Auth login is
inert; delete it eventually via the console or a script. Rules refuse
self-deletion (lockout guard), and the legacy `admins/global` doc is frozen
read-only for one release, then removed.

## Release-day deploy order (D8 rule 3 — TIGHTENING, do not reorder)

0. **ADDITIVE pre-step (any time BEFORE hosting ships — Phases 6 + 7):**
   deploy an intermediate rules file = the currently deployed (2026-07-15)
   rules PLUS, copied verbatim from the staged `firestore.rules`: the
   `match /groups/{groupId}` block, the `match /snapshots/{snapId}` block,
   `validSnapshotDocument`, and the `isAdmin()`/`isSuperAdmin()` helpers with
   their `match /admins/{docId}` block. All of it only ADDS collections/grants
   — harmless to the live fleet — and it must exist before the new JS ships:
   `cloudSnapshotPut` is fire-and-forget, so JS-first means cloud captures
   fail silently (the worst failure for a safety feature). **Verify by
   watching a capture doc actually appear** under
   `sessions/{code}/snapshots/` in the console, not by absence of errors.
   Keep a dated rollback copy of whatever was deployed before this step.
1. Hosting ships (new JS, `?v=` + WORKER_SCHEMA bumps) → fleet refreshes.
2. Owner mints instructor accounts with temp passwords (they can sign in
   immediately — Auth is live even before rules tighten).
3. THEN deploy the full staged `firestore.rules` via the REST script.
   Rollback copy: `docs/rules-rollback-2026-07-18-pre-admin-auth.rules`.

**Rollback:** revert hosting via `?v=`/WORKER_SCHEMA, redeploy the rollback
rules. The legacy honor-system admin flow resumes on old JS; Auth users and
`admins/{uid}` docs sit inert under old rules.

## Emulator QA (no console errand needed)

- Firestore rules: `scripts/test-rules.mjs` (emulator jar; rules PUT reloads).
- Auth flows locally: run the Auth emulator on `127.0.0.1:9099` and load any
  page with `?firestoreEmulator=1&authEmulator=1`.
