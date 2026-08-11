'use strict';
/* ONE-SHOT MIGRATION (Phase 3). Moves student PIN material off the profile doc.
 *
 * Through Phase 2 pinSalt/pinHash lived on profiles/{username}. Any signed-in
 * peer could read a classmate's hash and brute-force a 4-digit PIN offline in
 * about a second. This copies them to pinSecrets/{profileId} (which no client
 * can read) and then strips them from the profile docs.
 *
 * SAFE ORDER, and why it matters:
 *   copy first, verify, strip second. The functions read pinSecrets with a
 *   fallback to the profile doc (secretFor in index.js), so a profile is
 *   readable from EITHER location throughout. Nobody is locked out mid-run, and
 *   an interrupted run can simply be re-run.
 *
 * PREREQUISITE: every profile must already have a profileId. Run
 * backfill-profile-ids.js first; this script refuses to touch a profile without
 * one, because profileId is the pinSecrets key.
 *
 * RUN (Google Cloud Shell, authenticated to the cueola project):
 *     cd functions && npm install
 *     node migrate-pin-secrets.js --dry     # report only
 *     node migrate-pin-secrets.js --copy    # step 1: copy, leave profiles as-is
 *     node migrate-pin-secrets.js --strip   # step 2: remove from profiles
 *
 * Deploy the Phase 3 functions BEFORE --strip, or a client running older code
 * that still reads the profile hash would break. After --strip, verify sign-in
 * with a real student account before considering it done.
 */
const { initializeApp, applicationDefault } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { profileIdFor } = require('./assignment-model');

const DRY = process.argv.includes('--dry');
const COPY = process.argv.includes('--copy');
const STRIP = process.argv.includes('--strip');

if (!DRY && !COPY && !STRIP) {
  console.error('Pick a mode: --dry, --copy, or --strip (see the header).');
  process.exit(2);
}

initializeApp({ credential: applicationDefault() });
const db = getFirestore();

(async () => {
  const snap = await db.collection('profiles').get();
  let scanned = 0, withPin = 0, copied = 0, stripped = 0, missingId = 0, alreadyThere = 0;

  for (const doc of snap.docs) {
    scanned++;
    const p = doc.data() || {};
    if (p.role === 'admin') continue;              // admins use passwords
    const hasProfilePin = Boolean(p.pinSalt && p.pinHash);
    if (!hasProfilePin && !STRIP) continue;
    if (hasProfilePin) withPin++;

    const username = String(p.username || doc.id);
    const profileId = p.profileId || '';
    if (!profileId) {
      missingId++;
      console.error(`  SKIP ${doc.id}: no profileId. Run backfill-profile-ids.js first.`);
      continue;
    }
    // Guard against a wrong key: the id must be the one the app derives.
    if (!p.profileId && profileIdFor(username) !== profileId) {
      console.error(`  SKIP ${doc.id}: profileId does not match the derived id.`);
      continue;
    }
    const secretRef = db.doc(`pinSecrets/${profileId}`);

    if (DRY || COPY) {
      const existing = await secretRef.get();
      if (existing.exists && (existing.data() || {}).pinHash) { alreadyThere++; continue; }
      if (!hasProfilePin) continue;
      console.log(`${DRY ? '[dry] ' : ''}copy ${doc.id} -> pinSecrets/${profileId}`);
      if (COPY) {
        await secretRef.set({
          pinSalt: p.pinSalt, pinHash: p.pinHash,
          ...(typeof p.pinSetAt === 'number' ? { pinSetAt: p.pinSetAt } : {}),
          ...(p.pinSetBy ? { pinSetBy: p.pinSetBy } : {}),
          migratedAt: Date.now(),
        }, { merge: true });
        copied++;
      }
    }

    if (STRIP) {
      // Never strip unless the secret is safely readable in the new home.
      const existing = await secretRef.get();
      const ok = existing.exists && (existing.data() || {}).pinHash;
      if (!ok) {
        console.error(`  SKIP ${doc.id}: pinSecrets/${profileId} has no hash yet. Run --copy first.`);
        continue;
      }
      if (!hasProfilePin) continue;
      console.log(`strip ${doc.id}`);
      await doc.ref.update({
        pinSalt: FieldValue.delete(), pinHash: FieldValue.delete(),
        pinSetAt: FieldValue.delete(), pinSetBy: FieldValue.delete(),
      });
      stripped++;
    }
  }

  console.log('');
  console.log(`scanned ${scanned} | profiles carrying a PIN ${withPin} | already in pinSecrets ${alreadyThere}`);
  if (DRY) console.log('[dry run] nothing written. Re-run with --copy, then --strip.');
  if (COPY) console.log(`copied ${copied} into pinSecrets. Verify sign-in, then re-run with --strip.`);
  if (STRIP) console.log(`stripped ${stripped} profile docs.`);
  if (missingId) {
    console.error(`STOP: ${missingId} profiles have no profileId. Run backfill-profile-ids.js, then re-run.`);
    process.exit(1);
  }
})().catch((e) => { console.error(e); process.exit(1); });
