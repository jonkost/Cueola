'use strict';
/* Cueola Cloud Functions: server-side student authentication (Phase 1).
 *
 * signInWithPin verifies a student's 4-digit PIN server-side (the hash never
 * leaves the server) and mints a Firebase custom token, so a student becomes a
 * REAL authenticated principal (request.auth.uid = their profileId) instead of
 * the anonymous "type a username" identity. A per-username rate limiter makes
 * brute-forcing the 10,000-PIN space infeasible.
 *
 * DEPLOY: this cannot ship via the Rules REST API. See
 * docs/auth-migration-runbook.md (Google Cloud Shell is the simplest path).
 *
 * APP CHECK: ENFORCE_APP_CHECK is false until App Check is enabled on the
 * client (docs/app-check-rollout.md). The rate limiter is the primary
 * brute-force defense and works without App Check; flip this to true right
 * after App Check enforcement goes live, then redeploy. */
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { setGlobalOptions } = require('firebase-functions/v2');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { getAuth } = require('firebase-admin/auth');
const { verify, hash, newSalt } = require('./pin');
const { evaluateGuard } = require('./guard');
const { validate: validateStrength } = require('./strength');
const { profileIdFor } = require('./assignment-model');

initializeApp();
setGlobalOptions({ region: 'us-central1', maxInstances: 10 });

// Flip to true once App Check enforcement is live on both clients.
const ENFORCE_APP_CHECK = false;

const USERNAME_RE = /^[a-z0-9][a-z0-9._-]{2,39}$/;   // mirrors firestore.rules validUsername
function normalizeUsername(raw) {
  const u = String(raw == null ? '' : raw).trim().toLowerCase();
  return USERNAME_RE.test(u) ? u : null;
}
// Stable Firebase uid for a student: the profile's canonical profileId, so the
// Phase 2 rules can gate a self-write on request.auth.uid == profileId.
//
// The fallback for a legacy profile with no profileId MUST use the client's own
// derivation (assignment-model.profileIdFor), not a hand-rolled slug. An earlier
// version used 'profile_' + username-with-punctuation-collapsed, which was wrong
// twice over: it never equalled the id the client generates (so the student
// would be locked out of their own profile forever), and it COLLIDED, mapping
// jon.kost / jon-kost / jon_kost onto one uid, i.e. three students sharing a
// single identity. assignment-model.js here is a verbatim copy of the repo root
// module (the deploy bundle only ships functions/); pin.test.js asserts the two
// files stay byte-identical so they can never drift apart.
function uidForProfile(username, profile) {
  const id = profile && typeof profile.profileId === 'string' && profile.profileId ? profile.profileId : '';
  return id || profileIdFor(username);
}

/* ── Phase 3: PIN secrets live where no client can read them ─────────────────
 * Through Phase 2 the salt+hash sat on profiles/{username}, which any signed-in
 * peer could read: enough to brute-force a 4-digit PIN offline in about a
 * second. They now live in pinSecrets/{profileId}, denied to every client by
 * the rules and touched only by these functions through the Admin SDK.
 *
 * secretFor() keeps reading the old location while the migration runs
 * (functions/migrate-pin-secrets.js), so sign-in never breaks mid-migration.
 * Once that script reports clean, the profile copies are gone and this falls
 * through to pinSecrets only. */
function pinSecretRef(db, profileId) {
  return db.doc(`pinSecrets/${profileId}`);
}
function secretFor(secretSnap, profileDoc) {
  if (secretSnap && secretSnap.exists) {
    const s = secretSnap.data() || {};
    if (s.pinSalt && s.pinHash) return { salt: s.pinSalt, hash: s.pinHash, source: 'pinSecrets' };
  }
  const p = profileDoc || {};
  if (p.pinSalt && p.pinHash) return { salt: p.pinSalt, hash: p.pinHash, source: 'profile' };
  return { salt: '', hash: '', source: 'none' };
}
// Build the stored secret for a new PIN, after enforcing the strength policy.
function pinSecretFields(pin, setBy) {
  const strong = validateStrength(pin);
  if (!strong.ok) throw new HttpsError('invalid-argument', strong.msg);
  const salt = newSalt();
  return {
    pinSalt: salt,
    pinHash: hash(pin, salt),
    pinSetAt: Date.now(),
    ...(setBy ? { pinSetBy: String(setBy).slice(0, 160) } : {}),
  };
}
// Authorize an admin from INSIDE a callable. Rules do not run for the Admin
// SDK, so an admin-only function has to check the admins/{uid} doc itself.
async function requireAdmin(db, req) {
  const uid = req.auth && req.auth.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in as an instructor first.');
  const snap = await db.doc(`admins/${uid}`).get();
  if (!snap.exists) throw new HttpsError('permission-denied', 'Only an instructor can do that.');
  return { uid, admin: snap.data() || {} };
}

exports.signInWithPin = onCall({ enforceAppCheck: ENFORCE_APP_CHECK }, async (req) => {
  const username = normalizeUsername(req.data && req.data.username);
  const pin = String((req.data && req.data.pin) == null ? '' : req.data.pin);
  if (!username) throw new HttpsError('invalid-argument', 'Enter your username.');
  if (!/^[0-9]{4}$/.test(pin)) throw new HttpsError('invalid-argument', 'Enter your 4 digit PIN.');

  const db = getFirestore();
  const profileRef = db.doc(`profiles/${username}`);
  const guardRef = db.doc(`pinGuard/${username}`);
  const now = Date.now();

  // One transaction covers the lockout check, the verify, and the attempt
  // bookkeeping so concurrent guesses cannot race past the limiter.
  const outcome = await db.runTransaction(async (tx) => {
    const profileSnap = await tx.get(profileRef);
    const p = profileSnap.exists ? (profileSnap.data() || {}) : null;
    // Phase 3: the salt+hash live in pinSecrets/{profileId}, a collection no
    // client can read (rules deny it outright), so a leaked profile doc no
    // longer carries anything to brute-force. Reading it needs the profileId,
    // hence the sequential get. secretFor falls back to the profile doc for any
    // profile not yet migrated.
    const secretRef = p ? pinSecretRef(db, uidForProfile(username, p)) : null;
    const [secretSnap, guardSnap] = await Promise.all([
      secretRef ? tx.get(secretRef) : Promise.resolve(null),
      tx.get(guardRef),
    ]);
    const guard = guardSnap.exists ? (guardSnap.data() || {}) : {};
    const secret = secretFor(secretSnap, p);

    // A single uniform failure for every "cannot sign in" reason (missing
    // profile, admin-role, deactivated, renamed/merged, no PIN, wrong PIN) so
    // the endpoint never reveals which usernames exist or why a try failed.
    const eligible = !!p && p.role !== 'admin' && p.active !== false
      && !p.renamedTo && !p.mergedInto && !!secret.salt && !!secret.hash;
    const ok = eligible && verify(pin, secret.salt, secret.hash);

    const step = evaluateGuard(guard, now, ok);
    if (step.patch) tx.set(guardRef, step.patch, { merge: true });
    if (step.status !== 'ok') return { status: step.status, retryMs: step.retryMs };

    const uid = uidForProfile(username, p);
    // Backfill profileId on a legacy profile that never got one. Phase 2 gates
    // a self-write on request.auth.uid == resource.data.profileId, so a profile
    // with no profileId could never write to itself. The Admin SDK bypasses
    // rules, so doing it here (at sign-in, inside the same transaction) is the
    // one place it is guaranteed to succeed.
    // profileAliases must be written alongside it: the client's
    // ensureProfileIdentity early-returns only when sameIdentityIds() matches,
    // and that returns false for an undefined array, so a doc with a profileId
    // but no profileAliases would retry a (now denied) write on every read.
    const backfill = {};
    if (!p.profileId) backfill.profileId = uid;
    if (!Array.isArray(p.profileAliases)) backfill.profileAliases = [];
    if (Object.keys(backfill).length) tx.set(profileRef, backfill, { merge: true });
    return { status: 'ok', uid };
  });

  if (outcome.status === 'locked') {
    const mins = Math.max(1, Math.ceil(outcome.retryMs / 60000));
    throw new HttpsError('resource-exhausted', `Too many tries. Wait about ${mins} minute${mins === 1 ? '' : 's'} and try again.`);
  }
  if (outcome.status !== 'ok') {
    throw new HttpsError('permission-denied', 'That username or PIN is not right.');
  }

  const token = await getAuth().createCustomToken(outcome.uid, { cueolaStudent: true });
  return { token };
});

/* ── Phase 2: the pre-auth surface ──────────────────────────────────────────
 * Once the rules require request.auth, an unauthenticated visitor can no longer
 * read Firestore at all. Everything the sign-in and create-profile flows need
 * BEFORE a token exists therefore moves behind these callables, which use the
 * Admin SDK (rules do not apply to it). After Phase 2 the invariant is: an
 * unauthenticated client talks only to Cloud Functions, never to Firestore. */

// The front door must know which gate to show (PIN, set a PIN, or admin
// password) before the person has any token, which used to be a direct
// profiles/{username} read. Returns only what the gate card renders: the stage
// plus the display name and avatar for the "continuing as" line. Deliberately
// does NOT return pinSalt/pinHash, so the hash stops being publicly readable
// through this path even before Phase 3 moves it out of the profile doc.
exports.getSignInStage = onCall({ enforceAppCheck: ENFORCE_APP_CHECK }, async (req) => {
  const username = normalizeUsername(req.data && req.data.username);
  if (!username) return { found: false };
  const db = getFirestore();
  const snap = await db.doc(`profiles/${username}`).get();
  if (!snap.exists) return { found: false };
  const p = snap.data() || {};
  if (p.renamedTo) return { found: false, renamedTo: String(p.renamedTo) };
  if (p.mergedInto) return { found: false, mergedInto: String(p.mergedInto) };
  if (p.active === false) return { found: false, deactivated: true };
  // Whether a PIN exists is now a pinSecrets question (with the migration
  // fallback). Only the existence leaks here, never the salt or hash.
  const secretSnap = await pinSecretRef(db, uidForProfile(username, p)).get();
  const hasPin = secretFor(secretSnap, p).hash !== '';
  return {
    found: true,
    stage: p.role === 'admin' ? 'password' : (hasPin ? 'pin' : 'setPin'),
    fullName: String(p.fullName || ''),
    avatar: p.avatar && typeof p.avatar === 'object' ? p.avatar : { type: 'initials' },
    theme: typeof p.theme === 'string' ? p.theme : '',
  };
});

// Wizard step 1 validates the class login code live, before the student has a
// profile (hence no token). Returns ONLY whether it works and which role it
// mints: no label, createdBy, or timestamps, so this cannot be used to harvest
// instructor names. The reason enum preserves the two distinct wizard errors.
exports.checkAccessCode = onCall({ enforceAppCheck: ENFORCE_APP_CHECK }, async (req) => {
  const code = String((req.data && req.data.code) == null ? '' : req.data.code).trim().toUpperCase();
  if (!/^[A-Za-z0-9_-]{4,80}$/.test(code)) return { ok: false, reason: 'missing' };
  const snap = await getFirestore().doc(`accessCodes/${code}`).get();
  if (!snap.exists) return { ok: false, reason: 'missing' };
  const d = snap.data() || {};
  if (d.active !== true) return { ok: false, reason: 'revoked' };
  return { ok: true, role: d.role === 'admin' ? 'admin' : 'student' };
});

// Create a student profile server-side and hand back a token in the SAME call.
// Phase 2 rules make profiles/{username} create admin-only, and a brand-new
// student has no auth to satisfy any rule, so creation has to live here. Doing
// the sign-in inline matters twice over: it avoids a second round trip through
// signInWithPin (which would spend one of the new user's rate-limit attempts),
// and it guarantees uid === profileId, the invariant every Phase 2 self-write
// rule depends on.
exports.createStudentProfile = onCall({ enforceAppCheck: ENFORCE_APP_CHECK }, async (req) => {
  const d = req.data || {};
  const code = String(d.code == null ? '' : d.code).trim().toUpperCase();
  const username = normalizeUsername(d.username);
  const fullName = String(d.fullName == null ? '' : d.fullName).trim().replace(/\s+/g, ' ');
  const pin = String(d.pin == null ? '' : d.pin);

  if (!/^[A-Za-z0-9_-]{4,80}$/.test(code)) throw new HttpsError('invalid-argument', 'Enter the class login code your instructor gave you.');
  if (!username) throw new HttpsError('invalid-argument', 'Pick a username: 3 to 40 characters, lowercase letters, numbers, dots or dashes, starting with a letter or number.');
  if (!fullName || fullName.length > 120) throw new HttpsError('invalid-argument', 'Enter your full name (up to 120 characters).');

  const db = getFirestore();
  const codeSnap = await db.doc(`accessCodes/${code}`).get();
  if (!codeSnap.exists) throw new HttpsError('permission-denied', 'That login code does not exist. Check it with your instructor.');
  const codeDoc = codeSnap.data() || {};
  if (codeDoc.active !== true) throw new HttpsError('permission-denied', 'That login code has been revoked. Ask your instructor for the current one.');

  // Admin profiles are minted by an instructor, never self-served here.
  if (codeDoc.role === 'admin') throw new HttpsError('permission-denied', 'That code creates an instructor account. Ask your instructor to set it up for you.');

  // Strength is enforced HERE, not just in the browser: a scripted client could
  // otherwise set 1234. functions/strength.js mirrors cueola-pin.js exactly and
  // pin.test.js sweeps all 10000 pins to prove the two never drift.
  // (pinSecretFields throws invalid-argument on a weak PIN.)
  const secretFields = pinSecretFields(pin, username);

  const sessions = [];
  String(d.sessions == null ? '' : d.sessions).split(/[\s,]+/).forEach((raw) => {
    const s = String(raw || '').trim().toUpperCase();
    if (s && /^[A-Za-z0-9_.-]{1,160}$/.test(s) && sessions.indexOf(s) < 0) sessions.push(s);
  });

  const profileId = profileIdFor(username);
  const now = Date.now();
  // The profile doc carries NO pin material: it goes to pinSecrets.
  const doc = {
    username,
    profileId,
    profileAliases: [],
    fullName,
    role: 'student',
    avatar: d.avatar && typeof d.avatar === 'object' ? d.avatar : { type: 'initials' },
    theme: typeof d.theme === 'string' && d.theme ? d.theme : 'cool',
    sessions: sessions.slice(0, 100),
    codeUsed: code,
    createdAt: now,
    lastSeen: now,
  };

  // create(), not set(): fails if the username was taken between the client's
  // check and now, so two people racing the same username cannot clobber.
  try {
    await db.doc(`profiles/${username}`).create(doc);
  } catch (err) {
    if (err && (err.code === 6 || err.code === 'already-exists')) {
      throw new HttpsError('already-exists', 'That username is taken. Pick another one.');
    }
    throw new HttpsError('internal', 'Could not save the profile. Try again.');
  }
  // Secret second: if this failed the student would land on the set-PIN gate,
  // which is recoverable. Writing it first would leave an orphan secret behind
  // a username that was never created.
  await pinSecretRef(db, profileId).set(secretFields);

  const token = await getAuth().createCustomToken(profileId, { cueolaStudent: true });
  return { token, profile: doc };
});

/* ── PIN management (Phase 3) ────────────────────────────────────────────────
 * The client can no longer write a PIN anywhere: pinSecrets is closed to it.
 * These three callables are the only ways a PIN changes. */

// Claim a PIN on a profile that has none (a legacy profile, or one an
// instructor just reset). SECURITY: this used to be wide open. Anyone who knew
// a username could walk up to the set-PIN gate and take the account. It now
// requires an ACTIVE class login code, the same proof of class membership that
// creating a profile requires. Returns a token so the student continues
// straight into the app.
exports.claimPin = onCall({ enforceAppCheck: ENFORCE_APP_CHECK }, async (req) => {
  const d = req.data || {};
  const username = normalizeUsername(d.username);
  const code = String(d.code == null ? '' : d.code).trim().toUpperCase();
  const pin = String(d.pin == null ? '' : d.pin);
  if (!username) throw new HttpsError('invalid-argument', 'Enter your username.');
  if (!/^[A-Za-z0-9_-]{4,80}$/.test(code)) throw new HttpsError('invalid-argument', 'Enter your class login code to set a PIN.');

  const db = getFirestore();
  const codeSnap = await db.doc(`accessCodes/${code}`).get();
  if (!codeSnap.exists || (codeSnap.data() || {}).active !== true) {
    throw new HttpsError('permission-denied', 'That class login code is not active. Check it with your instructor.');
  }

  const profileRef = db.doc(`profiles/${username}`);
  const profileSnap = await profileRef.get();
  if (!profileSnap.exists) throw new HttpsError('permission-denied', 'That username or code is not right.');
  const p = profileSnap.data() || {};
  if (p.role === 'admin' || p.active === false || p.renamedTo || p.mergedInto) {
    throw new HttpsError('permission-denied', 'That profile cannot set a PIN here.');
  }

  const profileId = uidForProfile(username, p);
  const secretSnap = await pinSecretRef(db, profileId).get();
  // Refuse to overwrite an EXISTING PIN: that path is signInWithPin (know the
  // current PIN) or an instructor reset. Otherwise a class code, which the
  // whole class holds, would be enough to take over a classmate's account.
  if (secretFor(secretSnap, p).hash) {
    throw new HttpsError('failed-precondition', 'This profile already has a PIN. Sign in with it, or ask your instructor to reset it.');
  }

  const fields = pinSecretFields(pin, username);
  await pinSecretRef(db, profileId).set(fields);
  if (!p.profileId) await profileRef.set({ profileId, profileAliases: Array.isArray(p.profileAliases) ? p.profileAliases : [] }, { merge: true });

  const token = await getAuth().createCustomToken(profileId, { cueolaStudent: true });
  return { token };
});

// An authenticated student changes their own PIN. The uid IS the profileId, so
// there is nothing to look up and no way to target someone else.
exports.setMyPin = onCall({ enforceAppCheck: ENFORCE_APP_CHECK }, async (req) => {
  const uid = req.auth && req.auth.uid;
  const isStudent = req.auth && req.auth.token && req.auth.token.cueolaStudent === true;
  if (!uid || !isStudent) throw new HttpsError('unauthenticated', 'Sign in first.');
  const fields = pinSecretFields(String((req.data && req.data.pin) == null ? '' : req.data.pin), uid);
  await pinSecretRef(getFirestore(), uid).set(fields);
  return { ok: true };
});

// An instructor resets a student's PIN. Admin-gated INSIDE the function,
// because the Admin SDK bypasses the rules that would otherwise enforce it.
exports.resetStudentPin = onCall({ enforceAppCheck: ENFORCE_APP_CHECK }, async (req) => {
  const db = getFirestore();
  const { admin } = await requireAdmin(db, req);
  const username = normalizeUsername(req.data && req.data.username);
  const pin = String((req.data && req.data.pin) == null ? '' : req.data.pin);
  if (!username) throw new HttpsError('invalid-argument', 'Pick a student.');

  const profileSnap = await db.doc(`profiles/${username}`).get();
  if (!profileSnap.exists) throw new HttpsError('not-found', 'No profile with that username.');
  const p = profileSnap.data() || {};
  if (p.role === 'admin') throw new HttpsError('failed-precondition', 'Admins sign in with a password, not a PIN.');

  const fields = pinSecretFields(pin, admin.name || admin.username || 'instructor');
  await pinSecretRef(db, uidForProfile(username, p)).set(fields);
  // Clear the rate limiter so a student locked out by wrong guesses can use the
  // new PIN immediately.
  await db.doc(`pinGuard/${username}`).set({ attempts: 0, lockedUntil: 0, windowStart: Date.now() }, { merge: true });
  return { ok: true };
});
