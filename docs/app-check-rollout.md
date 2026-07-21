# Cueola Firestore Rules and App Check Owner Runbook

> **v2.1 Phase 10 (2026-07-21):** the repo rules now carry a second TIGHTENING
> round — admin-gated `list` on `sessions` and `accessCodes` (profiles list
> stays open on purpose; rationale in the rules header). Deploy them in the
> release-day sequence, and see [term-boundary-runbook.md](term-boundary-runbook.md)
> for the term-rotation and enforcement-flip procedure.

The repository contains staged, shape-validating Firestore rules and optional
Firebase App Check bootstrap in both `index.html` and `dashboard.html`. Nothing
in this runbook is deployed automatically. The owner controls every Firebase
Console and deploy action.

## ✅ Staged rules DEPLOYED 2026-07-15 (owner-instructed)

The staged `firestore.rules` were released 2026-07-15 18:32 UTC as ruleset
`ff0556f6-0a58-4d98-8992-87caf599fd3b` (via the Rules REST API — no local
firebase CLI/Java). Live smoke test passed: session writes unchanged;
profiles/assignments/notes reads open; malformed writes rejected. The previous
ruleset text is preserved at `docs/rules-rollback-2026-07-15.rules`.
App Check registration/enforcement (sections 3–6) remains NOT started.

The section below is retained for history.

## ⚠ Deploy sooner rather than later (verified 2026-07-11) — RESOLVED 2026-07-15

Production probes show the CURRENTLY DEPLOYED rules are an older hardened
revision: `sessions/{code}` works, but `sessions/{code}/files`,
`sessions/{code}/notes`, `accessCodes`, `profiles`, and even `accounts/{id}`
READS are all denied. Two live consequences until the staged rules deploy:

- **Note attachments** could not post at all (the client writes the files
  subcollection). The client now falls back to the legacy `pbfile_*` sibling
  docs when it sees `permission-denied` — attachments work again, but land in
  the legacy location and keep bloating the sessions collection. The fallback
  self-retires once the staged rules are live.
- **Entitlement reads** (`accounts/{id}`) fail quietly; the client uses its
  local default (currently full-function, so no user-visible impact).

Deploying the staged `firestore.rules` (section 2) resolves both.

## What this protects—and what it does not

- The rules allow only Cueola's known top-level collections and validate paths,
  bounded lists, and important document fields.
- Current Cueola, dashboard, Flowmingo, Outrangutan, and Prompt-Up session
  reads/writes remain compatible.
- Forward-compatible rules are staged for `sessions/{code}/files`,
  `sessions/{code}/notes`, `accessCodes`, and `profiles` so later migrations do
  not require reopening arbitrary collections.
- App Check rejects traffic that does not carry a valid app attestation after
  enforcement is enabled.
- Neither rules nor App Check identify a person. Cueola intentionally has no
  username/password authentication, so session roles and admin codes remain an
  honor system. Do not describe this as user authorization.

## 1. Run rules tests locally

The contract test uses only Node's built-in `fetch`; it adds no project
dependency. It expects a Firestore emulator supplied by Firebase CLI:

```sh
firebase emulators:exec --project cueola-rules-test --only firestore \
  "node scripts/test-rules.mjs"
```

The suite covers main-app session create/read/update, the highest-frequency
live writes verbatim (presence maps, Planda Bear notes/activity, preflight
pings, rundown transaction batches), dashboard list/delete and admin roster,
Flowmingo/Prompt-Up prompter updates, Outrangutan updates, legacy attachment
documents, read-only entitlements, deny-by-default behavior, type/bound
denials (list/map types, showName bounds, attachment chunk caps, unknown
keys), and the future files/notes/accessCodes/profiles shapes including code
revocation and profile identity immutability. It refuses to run against a
non-local FIRESTORE_EMULATOR_HOST.

For an operator-style browser rehearsal against those staged rules, start the
Firestore emulator and open either localhost entry point with
`?firestoreEmulator=1`. The hook is ignored on non-localhost domains:

```text
http://127.0.0.1:8022/index.html?firestoreEmulator=1
http://127.0.0.1:8022/dashboard.html?firestoreEmulator=1
```

Do not deploy rules unless the suite ends with `PASS`. The emulator requires a
local Java runtime; install/enable that outside this repository if necessary.

## 2. Review and deploy rules (owner only)

1. Confirm Prompt-Up still uses only `sessions/{code}` and does not depend on an
   undocumented collection.
2. Run the emulator suite above.
3. Review the staged diff in `firestore.rules`.
4. Deploy rules only:

   ```sh
   firebase deploy --only firestore:rules
   ```

5. Before enabling App Check enforcement, smoke-test Cueola, dashboard,
   Flowmingo, Outrangutan session linking, and Prompt-Up.
6. Keep the previous rules text available for immediate rollback.

## 3. Register App Check

1. In Firebase Console, open **Security → App Check** and register the existing
   Cueola web app with reCAPTCHA v3.
2. Allow `cueola.live`, `www.cueola.live` if used, and the Firebase Hosting
   preview domains used by the owner.
3. Copy the public reCAPTCHA v3 site key into
   `APP_CHECK_RECAPTCHA_V3_SITE_KEY` in both `index.html` and `dashboard.html`.
4. Set `APP_CHECK_ENABLED = true` in both files.
5. Leave `APP_CHECK_DEBUG_LOCAL = false` in committed code.
6. Deploy Hosting. Do **not** enable Firestore enforcement yet.

The explicit enable flag is intentionally separate from the public site key: a
key may be staged without unexpectedly changing live request behavior.

## 4. Verify before enforcement

With enforcement still off:

1. Open Cueola and dashboard from the hosted preview.
2. Confirm `window._appCheckConfigured === true` and
   `window._appCheckReady === true` in each page.
3. Create/join a disposable session, edit a rundown row, open Production Notes,
   link Flowmingo, and confirm the dashboard lists the session.
4. Inspect the console: there must be no App Check or Firestore permission
   errors.
5. In Firebase Console App Check metrics, wait until Cueola and dashboard
   requests appear as verified. Also verify Prompt-Up;
   server/Admin SDK traffic has different handling and must not be guessed.

## 5. Local debug-token rehearsal

Only for a localhost rehearsal, temporarily set `APP_CHECK_DEBUG_LOCAL = true`,
open the app, copy the generated debug token from the console, and register it
in Firebase Console. Never commit a debug token. Restore the flag to `false`
afterward.

## 6. Enable enforcement gradually (owner only)

1. Enable enforcement for **Cloud Firestore only** after verified metrics cover
   every production client.
2. Re-run the operator smoke test immediately.
3. Watch rejected-request metrics and production console reports.
4. If any client is rejected, disable enforcement first, then diagnose. Do not
   loosen Firestore collection rules to mask an App Check registration issue.

## Rollback

- App Check incident: disable Cloud Firestore enforcement in Firebase Console.
- Bootstrap incident: set `APP_CHECK_ENABLED = false` in both pages and redeploy
  Hosting.
- Rules incident: restore the previously reviewed `firestore.rules` and deploy
  rules only.

App Check enforcement and rules deployment are both owner operations. Codex
must leave them staged unless explicitly instructed otherwise.
