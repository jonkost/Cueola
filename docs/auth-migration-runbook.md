# Student authentication migration runbook

Turning the client-side PIN deterrent into real server-side authentication.
Everything here is an **owner action**; nothing runs automatically. This is a
**migration**, so the order matters: ship the auth layer first (nothing breaks),
tighten the rules only after the whole fleet authenticates.

Why: today a student "signs in" with a username and the PIN is checked in the
browser against a world-readable hash. On the Blaze plan a Cloud Function can
verify the PIN server-side and mint a real Firebase Auth token, so students
become authenticated principals and the rules can stop allowing anonymous
writes. See `.claude/plans/` (approved plan) for the full design.

---

## Phase 1: auth layer (additive, no breakage). BUILT, awaiting deploy.

Ships real student authentication with **rules unchanged**, so there is zero
lockout risk. Online PIN-guessing is defeated by a server rate limiter.

### What is in the repo already
- `functions/` holds the `signInWithPin` callable (`index.js`), the server PIN
  hash/verify (`pin.js`, byte-identical to `cueola-pin.js`), the rate-limit
  state machine (`guard.js`), and `functions/pin.test.js` (runs under plain
  node, no Firebase).
- `firebase.json` gains a `"functions"` block, `functions/**` added to the hosting
  ignore list (never web-serve the source), and the callable host added to the
  CSP `connect-src` (`us-central1-cueola.cloudfunctions.net`, `*.run.app`).
- Client: the `index.html` bootstrap exposes `window._functions` /
  `window._httpsCallable` and adds `signInWithCustomToken`; `cueola-identity.js`
  routes the PIN gate through the callable with a **graceful fallback** to the
  old client-side check when the function is not reachable (so the client is
  safe to ship before the function is deployed). A wrong PIN or a rate-limit
  lock never falls back, so the lock cannot be bypassed by going offline.

### Deploy steps (owner)

There is **no REST shortcut for Cloud Functions** (unlike the Firestore rules).
The local `firebase-tools` (`~/.cache/firebase/tools`) is logged out and has no
working `npm`, so deploy from a fully-equipped environment.

**Recommended: Google Cloud Shell** (browser, preauthenticated, has node + npm +
firebase-tools + Java):
1. In the Firebase/Google Cloud console, open **Cloud Shell**.
2. Clone or upload the repo, `cd` into it.
3. `cd functions && npm install` (installs `firebase-functions` + `firebase-admin`).
4. `cd .. && firebase use cueola` then `firebase deploy --only functions`.
5. First deploy on Blaze may prompt to enable the Cloud Functions / Cloud Build
   / Artifact Registry APIs. Accept them.
6. Note the deployed callable URL/region in the console. It must be
   `us-central1` (the client pins that region and the CSP allows that host).

Any machine with node 20+, npm, and firebase-tools works equally (`firebase login`
first). Do **not** try to deploy functions from this Mac as-is.

### Then ship the client
- Bump `sw.js` WORKER_SCHEMA and run `scripts/bump-cache.mjs` (done as part of
  the build), deploy hosting the usual way, and roll the fleet.
- Before the function is deployed, the client already runs the fallback (old
  behavior). After the function is live, the same sign-in transparently becomes
  real authentication.

### Enable App Check (perimeter for the callable)
Follow `docs/app-check-rollout.md`: register reCAPTCHA v3, paste the site key
into `APP_CHECK_RECAPTCHA_V3_SITE_KEY` in **both** `index.html` and
`dashboard.html`, flip `APP_CHECK_ENABLED = true`, verify
`window._appCheckReady === true`, soak in monitor mode, then enforce for
Firestore. Once App Check is enforcing, set `ENFORCE_APP_CHECK = true` in
`functions/index.js` and redeploy the function so the sign-in endpoint requires
an App Check token too. (Until then the per-username rate limiter is the
brute-force defense.)

### Verify Phase 1 live
- Sign in with a correct PIN → in the console, `window._adminAuth.currentUser`
  is set, `await window._adminAuth.currentUser.getIdTokenResult()` shows
  `claims.cueolaStudent === true` and `uid` equal to the profile's `profileId`.
- Wrong PIN five times → the sixth attempt returns the "too many tries" lock;
  it clears after ~15 minutes.
- Admin password sign-in still yields an admin session; a student sign-in is not
  treated as an admin (no `admins/{uid}` warning, `CueolaAdminAuth.current()` is
  null for the student).

---

## Phase 2: tighten the rules. BUILT, awaiting Phase 1 deploy + the backfill.

**Do not deploy the Phase 2 rules until every box below is ticked.** This is the
breaking phase: it makes shared show data unwritable without authentication, and
almost every affected write is fire-and-forget with a swallowed error, so a
premature deploy fails **silently, mid-show** (presence bubbles never appear, the
prompter says "waiting for talent" forever, cues stop propagating).

### What is in the repo already
- **Three more callables** (`functions/index.js`): `getSignInStage` (which gate
  to show, without exposing the PIN hash), `checkAccessCode` (wizard step 1),
  and `createStudentProfile` (server-side creation that validates the class
  code, checks the username atomically, enforces PIN strength via
  `functions/strength.js`, and returns a token in the same call so
  `uid === profileId`).
- **`functions/backfill-profile-ids.js`**: the one-shot migration below.
- **Client cloud entry gate** (`requireProfileForCloud` in `cueola-app.js`):
  joining a session, opening shared paperwork, driving a prompter, linking a
  talent screen, and Outrangutan session mode all require a signed-in profile.
  Not signed in you still get the demo, a **local** blank slate, and the guides.
- **Tightened `firestore.rules`** (mirrored to
  `docs/rules-phase2-2026-08-12-auth-required.rules`; rollback copy
  `docs/rules-rollback-2026-08-12-pre-phase2.rules`).
- **201 rules cases** in `scripts/test-rules.mjs`, including anonymous-denial
  coverage for every high-frequency live-show write.

### Deploy order (each step gates the next)
1. **Phase 1 must be live** (the functions deployed, clients authenticating).
2. **Deploy the three new callables** the same way (Cloud Shell,
   `firebase deploy --only functions`).
3. **Run the backfill and get a clean report.** Phase 2 gates a profile
   self-write on `request.auth.uid == profileId`, so any profile missing
   `profileId`/`profileAliases` becomes unwritable by its own owner, and the
   client path that would fix it is itself blocked by that rule. A sign-in-time
   backfill is not enough: it never reaches students who have not set a PIN.
   ```bash
   cd functions && node backfill-profile-ids.js --dry
   ```
   Then run it for real. **It must end with `REMAINING INCOMPLETE: 0`.** That
   line is the go/no-go gate.
4. **Ship the hosting** carrying the Phase 2 client (WORKER_SCHEMA 33) and let
   the fleet refresh. A stale shell keeps the old code-only doors open and will
   be denied by the new rules.
5. **Snapshot the live ruleset**, then deploy `firestore.rules` via the Rules
   REST path. ⚠ That file is the whole round-2 bundle (SEC-5, SEC-11, INC-13,
   Phase 10 lists, PIN, Phase 2), not the Phase 2 diff alone.
6. **Smoke-test on a throwaway session** as an authed student AND signed out:
   presence, a cue move, the control bus, a prePro patch, and a production note.
   Then confirm a signed-out browser is refused.

### Correction to an earlier plan
An earlier draft of this runbook said `accessCodes` read could lock to
`isAdmin()`. **That is wrong and would break the per-session entry gate for
every student.** The gate re-checks a student's own `codeUsed`, so the rule is
`allow get: if isSignedIn()`. Only the one caller that runs before any token
exists (wizard step 1) goes through `checkAccessCode`.

## Phase 3: protect the PIN hashes. BUILT, deploys after Phase 2.

Closes the last two residuals: a signed-in peer could read a classmate's hash
and brute-force a 4-digit PIN offline, and **anyone who knew a username could
claim a PIN on a profile that had none** (a legacy profile, or one just reset).

### What is in the repo already
- **`pinSecrets/{profileId}`** holds the salt and hash. The rules deny read AND
  write to every client, including the profile's own owner; only the Cloud
  Functions touch it through the Admin SDK. `pinGuard` is closed the same way,
  so nobody can clear their own rate-limit lockout.
- **`claimPin`** now requires an **active class login code** to set a PIN on a
  profile that has none, and refuses outright if a PIN already exists (that path
  is sign-in, or an instructor reset). The set-PIN gate therefore asks for the
  class code alongside the new PIN.
- **`setMyPin`** (an authenticated student changes their own; the uid IS the
  profileId, so it cannot target anyone else) and **`resetStudentPin`**
  (instructor-only, re-checked inside the function because the Admin SDK
  bypasses rules; it also clears the lockout so a locked-out student can use the
  new PIN immediately).
- **`functions/migrate-pin-secrets.js`**, a copy-verify-strip migration.
- The dashboard's Reset PIN calls the function; the client no longer writes a
  hash anywhere.

### Deploy order
1. **Phase 2 must be live and settled.**
2. Deploy the Phase 3 functions (`firebase deploy --only functions`).
3. Copy the secrets across, then verify a real student can still sign in:
   ```bash
   cd functions && node migrate-pin-secrets.js --dry
   ```
   then `--copy`. Sign-in keeps working from **either** location during this
   window (the functions read `pinSecrets` and fall back to the profile doc), so
   there is no lockout risk and the run is safely repeatable.
4. Ship the hosting (WORKER_SCHEMA 34) and let the fleet refresh.
5. Deploy the rules (they add the `pinSecrets` / `pinGuard` denies).
6. Only once sign-in is confirmed working, strip the old copies:
   ```bash
   node migrate-pin-secrets.js --strip
   ```
7. Spot-check in the console that a profile doc no longer carries `pinHash`.

### Where this leaves the security model
A PIN is now a server-verified secret that nothing readable exposes: rate
limited online, unreadable offline, and claimable only with proof of class
membership. What remains is the honest floor of any 4-digit credential shared in
a classroom, plus App Check as the perimeter.

---

## Security note (unrelated to this build, worth acting on)

The local `~/.config/configstore/firebase-tools.json` contains a **plaintext,
still-present OAuth refresh token** for `spbs.avt.staff@gmail.com` (the CLI is
logged out per `activeAccounts: {}`, but the refresh token is sitting in the
file). Consider revoking it (Google Account → Security → Third-party access) and
running `firebase logout` to clear it, especially before sharing or backing up
this machine.
