'use strict';
/* Unit tests for the Cloud Functions PIN + rate-limit logic.
 * Run: node functions/pin.test.js  (plain node, no Firebase needed)
 *
 * The critical assertion is CROSS-IMPLEMENTATION EQUIVALENCE: a hash produced
 * by the browser helper cueola-pin.js must verify here, or a student whose PIN
 * was set client-side could never sign in through the server. We recompute the
 * browser hash with the SAME formula and require the two to agree, and we run
 * the browser module's own hash() (it uses WebCrypto, available in node 20+)
 * against the server's. */
const assert = require('node:assert');
const path = require('node:path');
const { hash, verify } = require('./pin');
const { evaluateGuard } = require('./guard');
const strength = require('./strength');
const browserPin = require(path.join(__dirname, '..', 'cueola-pin.js'));

let passed = 0;
function ok(name, cond) { assert.ok(cond, name); passed++; }

(async () => {
  // ── server hash shape matches the rules regex ^[a-f0-9]{64}$ ──
  const HASH_RE = /^[a-f0-9]{64}$/;
  const salt = 'Xy9_-aB2cD3e';
  const h = hash('1930', salt);
  ok('server hash is 64 lowercase hex', HASH_RE.test(h));
  ok('server hash is deterministic', hash('1930', salt) === h);
  ok('server hash changes with salt', hash('1930', 'Different_salt99') !== h);
  ok('server hash changes with pin', hash('8261', salt) !== h);

  // ── CROSS-IMPL: browser cueola-pin.js and server pin.js agree exactly ──
  for (const [pin, s] of [['1930', salt], ['8261', 'aBcD_efgh'], ['5079', 'ZZ--__99abcd']]) {
    const browserHash = await browserPin.hash(pin, s);   // WebCrypto path
    ok(`browser hash === server hash (${pin})`, browserHash === hash(pin, s));
    ok(`server verify accepts a browser-set hash (${pin})`, verify(pin, s, browserHash) === true);
  }

  // ── server verify round trip ──
  ok('verify accepts the right pin', verify('1930', salt, h) === true);
  ok('verify rejects the wrong pin', verify('1931', salt, h) === false);
  ok('verify rejects a non-4-digit input', verify('19300', salt, h) === false);
  ok('verify rejects empty salt', verify('1930', '', h) === false);
  ok('verify rejects empty hash', verify('1930', salt, '') === false);
  ok('verify rejects null pin', verify(null, salt, h) === false);

  // ── DRIFT GUARD: server strength policy === browser strength policy ──
  // Profile creation and PIN changes move server-side in Phase 2, so the two
  // implementations must agree on every possible PIN, verdict AND message. This
  // sweeps the entire 0000-9999 space so any future edit to one side fails here.
  let mismatches = 0;
  let rejected = 0;
  for (let n = 0; n < 10000; n++) {
    const pin = String(n).padStart(4, '0');
    const a = strength.validate(pin);
    const b = browserPin.validate(pin);
    if (a.ok !== b.ok || (a.msg || '') !== (b.msg || '')) {
      if (mismatches < 5) console.error(`  drift on ${pin}: server=${JSON.stringify(a)} browser=${JSON.stringify(b)}`);
      mismatches++;
    }
    if (!a.ok) rejected++;
  }
  ok('server and browser strength agree on all 10000 pins', mismatches === 0);
  ok('the policy actually rejects a meaningful share', rejected > 500 && rejected < 5000);
  // malformed inputs agree too
  for (const bad of ['', '12', '12345', 'abcd', '1.34', null, undefined]) {
    const a = strength.validate(bad), b = browserPin.validate(bad);
    ok(`malformed ${JSON.stringify(bad)} agrees`, a.ok === b.ok && (a.msg || '') === (b.msg || ''));
  }

  // ── VENDORED COPY must stay byte-identical to the repo-root module ──
  // The deploy bundle only ships functions/, so assignment-model.js is a copy.
  // If it drifts, the server would derive a different uid than the client and
  // students would be locked out of their own profiles.
  const fs = require('node:fs');
  const vendored = fs.readFileSync(path.join(__dirname, 'assignment-model.js'), 'utf8');
  const source = fs.readFileSync(path.join(__dirname, '..', 'cueola-assignment-model.js'), 'utf8');
  ok('functions/assignment-model.js is byte-identical to the repo root copy', vendored === source);

  // ── uid parity: server uid === client profileIdFor, and no collisions ──
  const clientModel = require(path.join(__dirname, '..', 'cueola-assignment-model.js'));
  const serverModel = require('./assignment-model');
  const names = ['jon.kost', 'jon-kost', 'jon_kost', 'alex.j', 'sam', 'a.b-c_d', 'zoe.9'];
  for (const u of names) {
    ok(`uid parity for ${u}`, serverModel.profileIdFor(u) === clientModel.profileIdFor(u));
  }
  const uids = names.map((u) => serverModel.profileIdFor(u));
  ok('distinct usernames yield distinct uids (no collision)', new Set(uids).size === names.length);
  ok('derived uid satisfies the rules validCanonicalId regex',
    uids.every((id) => /^[A-Za-z0-9_.-]{3,160}$/.test(id)));

  // ── server salt shape matches the rules regex ──
  const SALT_RE2 = /^[A-Za-z0-9_-]{8,64}$/;
  const { newSalt: serverNewSalt } = require('./pin');
  for (let i = 0; i < 200; i++) ok('server salt matches rules regex', SALT_RE2.test(serverNewSalt()));
  ok('server salts vary', serverNewSalt() !== serverNewSalt());
  // a server-minted salt+hash verifies in the BROWSER helper too (a student who
  // is created server-side must be able to sign in if the fallback ever runs)
  const sSalt = serverNewSalt();
  const sHash = hash('8261', sSalt);
  ok('browser verify accepts a server-minted hash', (await browserPin.verify('8261', sSalt, sHash)) === true);

  // ── Phase 3: secretFor resolves pinSecrets first, profile as migration fallback ──
  // Loaded lazily so the test does not need firebase-admin installed.
  const idxSrc = fs.readFileSync(path.join(__dirname, 'index.js'), 'utf8');
  ok('pinSecrets is the primary PIN home', /pinSecrets\/\$\{profileId\}/.test(idxSrc));
  ok('signInWithPin reads the secret, not the profile hash', /verify\(pin, secret\.salt, secret\.hash\)/.test(idxSrc));
  // The profile doc createStudentProfile builds must carry NO pin material; the
  // secret goes to pinSecrets in a separate write.
  const createBlock = idxSrc.slice(idxSrc.indexOf('exports.createStudentProfile'), idxSrc.indexOf('exports.claimPin'));
  const docLiteral = createBlock.slice(createBlock.indexOf('const doc = {'), createBlock.indexOf('create(), not set()'));
  ok('createStudentProfile profile doc carries no pinHash', !/pinHash/.test(docLiteral));
  ok('createStudentProfile profile doc carries no pinSalt', !/pinSalt/.test(docLiteral));
  ok('createStudentProfile writes the secret to pinSecrets',
    /pinSecretRef\(db, profileId\)\.set\(secretFields\)/.test(createBlock));
  ok('claimPin requires an active class code', /claimPin[\s\S]*?accessCodes\/\$\{code\}[\s\S]*?active !== true/.test(idxSrc));
  ok('claimPin refuses to overwrite an existing PIN', /claimPin[\s\S]*?already has a PIN/.test(idxSrc));
  ok('resetStudentPin is admin-gated inside the function', /resetStudentPin[\s\S]*?requireAdmin\(db, req\)/.test(idxSrc));
  ok('resetStudentPin clears the rate-limit lockout', /resetStudentPin[\s\S]*?pinGuard\/\$\{username\}/.test(idxSrc));
  ok('setMyPin can only target the callers own uid', /setMyPin[\s\S]*?pinSecretRef\(getFirestore\(\), uid\)/.test(idxSrc));

  // The rules must deny pinSecrets to every client. This is the whole point of
  // Phase 3, so assert it here as well as in the rules contract suite.
  const rulesSrc = fs.readFileSync(path.join(__dirname, '..', 'firestore.rules'), 'utf8');
  const secretsBlock = rulesSrc.slice(rulesSrc.indexOf('match /pinSecrets/{profileId} {'));
  ok('pinSecrets denies all client access', /match \/pinSecrets\/\{profileId\} \{\s*allow read, write: if false;/.test(secretsBlock));
  ok('pinGuard denies all client access', /match \/pinGuard\/\{username\} \{\s*allow read, write: if false;/.test(rulesSrc));

  // ── rate-limit state machine ──
  const T0 = 1_000_000;   // fixed base time (no Date.now in tests)
  // correct PIN clears the guard from a clean slate
  let r = evaluateGuard({}, T0, true);
  ok('ok from empty clears guard', r.status === 'ok' && r.patch.attempts === 0 && r.patch.lockedUntil === 0);

  // five wrong tries in the window -> lock on the 5th
  let g = {};
  for (let i = 1; i <= 4; i++) {
    r = evaluateGuard(g, T0 + i * 1000, false);
    ok(`wrong try ${i} is 'bad'`, r.status === 'bad' && r.patch.attempts === i);
    g = { ...g, ...r.patch };
  }
  r = evaluateGuard(g, T0 + 5000, false);
  ok('5th wrong try locks', r.status === 'locked' && r.patch.lockedUntil === T0 + 5000 + 15 * 60 * 1000);
  g = { ...g, ...r.patch };

  // while locked, even a CORRECT pin is refused (uniform lock)
  r = evaluateGuard(g, T0 + 6000, true);
  ok('correct pin during lock is still locked', r.status === 'locked' && r.patch === null && r.retryMs > 0);

  // after the lock expires, the counter is fresh
  r = evaluateGuard(g, g.lockedUntil + 1, false);
  ok('first wrong try after lock expiry is a fresh window', r.status === 'bad' && r.patch.attempts === 1);

  // the window rolls: a wrong try long after windowStart resets to attempt 1
  r = evaluateGuard({ windowStart: T0, attempts: 4 }, T0 + 15 * 60 * 1000 + 1, false);
  ok('stale window resets to attempt 1', r.status === 'bad' && r.patch.attempts === 1);

  // a correct pin after some wrong tries clears everything
  r = evaluateGuard({ windowStart: T0, attempts: 3 }, T0 + 2000, true);
  ok('correct pin clears prior attempts', r.status === 'ok' && r.patch.attempts === 0);

  console.log(`PASS functions/pin.test.js (${passed} assertions)`);
})().catch((e) => { console.error(e); process.exit(1); });
