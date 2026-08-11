'use strict';
/* ONE-SHOT MIGRATION. Run this BEFORE deploying the Phase 2 rules.
 *
 * Phase 2 gates a profile self-write on request.auth.uid == profileId. Any
 * profile missing profileId therefore becomes unwritable by its own owner, and
 * the client path that would add the field is itself an update gated by that
 * same rule: a deadlock. profileAliases matters just as much, because the
 * client's ensureProfileIdentity only stops retrying when sameIdentityIds()
 * matches, and that returns false for an undefined array, so a doc with an id
 * but no aliases would retry a denied write on every read.
 *
 * A backfill inside signInWithPin is not enough on its own: it only ever
 * reaches students who can already sign in, which excludes anyone who has not
 * set a PIN yet. This walks every profile.
 *
 * The ids come from the SAME module the client uses (assignment-model.js), so a
 * backfilled id matches what the browser would have generated.
 *
 * RUN (Google Cloud Shell, authenticated to the cueola project):
 *     cd functions && npm install
 *     node backfill-profile-ids.js --dry     # report only, writes nothing
 *     node backfill-profile-ids.js           # apply
 *
 * The dry run prints exactly what would change. Re-running is safe: profiles
 * that already have both fields are skipped. The final line is the go/no-go
 * gate for the rules deploy: it must report 0 remaining.
 */
const { initializeApp, applicationDefault } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { profileIdFor } = require('./assignment-model');

const DRY = process.argv.includes('--dry');

initializeApp({ credential: applicationDefault() });
const db = getFirestore();

(async () => {
  const snap = await db.collection('profiles').get();
  let scanned = 0, needId = 0, needAliases = 0, written = 0, remaining = 0;
  const batchLimit = 400;
  let batch = db.batch();
  let pending = 0;

  for (const doc of snap.docs) {
    scanned++;
    const p = doc.data() || {};
    const username = String(p.username || doc.id);
    const patch = {};
    if (!p.profileId) { patch.profileId = profileIdFor(username); needId++; }
    if (!Array.isArray(p.profileAliases)) { patch.profileAliases = []; needAliases++; }
    if (!Object.keys(patch).length) continue;

    console.log(`${DRY ? '[dry] ' : ''}${doc.id}: ${JSON.stringify(patch)}`);
    if (DRY) { remaining++; continue; }

    batch.set(doc.ref, patch, { merge: true });
    pending++; written++;
    if (pending >= batchLimit) { await batch.commit(); batch = db.batch(); pending = 0; }
  }
  if (!DRY && pending) await batch.commit();

  // Re-read to prove the invariant the rules depend on actually holds.
  if (!DRY) {
    const after = await db.collection('profiles').get();
    remaining = after.docs.filter((d) => {
      const x = d.data() || {};
      return !x.profileId || !Array.isArray(x.profileAliases);
    }).length;
  }

  console.log('');
  console.log(`scanned ${scanned} profiles | missing profileId ${needId} | missing profileAliases ${needAliases}`);
  console.log(DRY ? `[dry run] ${remaining} would be updated. Re-run without --dry to apply.`
                  : `updated ${written}. REMAINING INCOMPLETE: ${remaining}`);
  if (!DRY && remaining > 0) {
    console.error('STOP: some profiles are still missing profileId/profileAliases. Do NOT deploy the Phase 2 rules.');
    process.exit(1);
  }
})().catch((e) => { console.error(e); process.exit(1); });
