// Dependency-free Firestore rules contract test.
// Run under the emulator:
//   firebase emulators:exec --only firestore "node scripts/test-rules.mjs"
import assert from 'node:assert/strict';

const host = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
const project = process.env.GCLOUD_PROJECT || process.env.FIREBASE_PROJECT || 'cueola-rules-test';
const base = `http://${host}/v1/projects/${project}/databases/(default)/documents`;

// This suite writes freely — refuse anything that is not a local emulator.
if (!/^(localhost|127\.0\.0\.1|\[?::1\]?)(:\d+)?$/.test(host)) {
  console.error(`Refusing to run: FIRESTORE_EMULATOR_HOST=${host} is not a local emulator.`);
  process.exit(1);
}

function encode(value) {
  if (value === null) return { nullValue: null };
  if (typeof value === 'string') return { stringValue: value };
  if (typeof value === 'boolean') return { booleanValue: value };
  if (Number.isInteger(value)) return { integerValue: String(value) };
  if (typeof value === 'number') return { doubleValue: value };
  if (Array.isArray(value)) return { arrayValue: { values: value.map(encode) } };
  if (value && typeof value === 'object') {
    return { mapValue: { fields: Object.fromEntries(Object.entries(value).map(([key, item]) => [key, encode(item)])) } };
  }
  throw new TypeError('Unsupported Firestore test value');
}

function document(data) {
  return { fields: Object.fromEntries(Object.entries(data).map(([key, value]) => [key, encode(value)])) };
}

// v2.1 (D1): simulated Firebase Auth. The emulator accepts unsigned JWTs for
// request.auth, and the literal token 'owner' bypasses rules entirely (used
// ONLY to seed admins/{uid} fixtures the way the service-account bootstrap
// script does in production). setAuth(null) restores anonymous requests.
let authToken = null;
function fakeToken(uid) {
  const b64 = obj => Buffer.from(JSON.stringify(obj)).toString('base64url');
  return `${b64({ alg: 'none', typ: 'JWT' })}.${b64({
    iss: `https://securetoken.google.com/${project}`, aud: project, auth_time: 1,
    user_id: uid, sub: uid, iat: 1, exp: 9999999999, firebase: { sign_in_provider: 'password' },
  })}.`;
}
function setAuth(uid) {
  authToken = uid === null ? null : (uid === 'owner' ? 'owner' : fakeToken(uid));
}

async function request(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (authToken) headers.Authorization = `Bearer ${authToken}`;
  const response = await fetch(`${base}/${path}`, { ...options, headers });
  const body = await response.text();
  return { status: response.status, ok: response.ok, body };
}

async function write(path, data, mask = []) {
  const query = mask.map(field => `updateMask.fieldPaths=${encodeURIComponent(field)}`).join('&');
  return request(path + (query ? `?${query}` : ''), {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(document(data)),
  });
}

async function remove(path) { return request(path, { method: 'DELETE' }); }

function allowed(result, label) {
  assert.equal(result.ok, true, `${label}: expected allow, got ${result.status} ${result.body}`);
}

function denied(result, label) {
  assert.equal(result.status, 403, `${label}: expected rules denial, got ${result.status} ${result.body}`);
}

function allowedMissing(result, label) {
  assert.equal(result.status, 404, `${label}: expected allowed missing read, got ${result.status} ${result.body}`);
}

const session = {
  code: 'RULES1', showName: 'Rules rehearsal', createdBy: 'Operator',
  beats: [], cues: [], participants: [], presence: {}, prompter: {}, outrangutan: {},
};

console.log(`Firestore rules contract · ${host} · ${project}`);

allowed(await write('sessions/RULES1', session), 'Cueola creates session');
allowed(await write('sessions/BOOTSTRAP1', {
  code: 'BOOTSTRAP1', createdBy: 'Recovery Operator', showName: 'Recovered rehearsal', startTime: '',
  beats: [{ id: 1, style: 'flex', info: 'Recovered open', cues: {} }],
  rundownAliases: {}, customSources: {}, cues: [], freeMode: false,
  activeIdx: 0, status: 'idle', participants: [],
  prePro: { production: 'Recovered rehearsal' }, preProNotes: [], roleAssignments: [],
  rundownUpdatedAt: 1, rundownUpdatedBy: 'Recovery Operator', createdAt: 1,
}), 'explicit create or History recovery writes a complete session document');
allowed(await request('sessions/RULES1'), 'Cueola/Flowmingo reads session');
allowed(await request('sessions?pageSize=20'), 'dashboard lists sessions');
allowed(await write('sessions/RULES1', { prompter: { text: 'Prompt-Up update' } }, ['prompter']), 'Prompt-Up updates prompter');
allowed(await write('sessions/RULES1', { outrangutan: { live: { status: 'playing' } } }, ['outrangutan']), 'Outrangutan updates state');

// The highest-frequency writes in a real show, verbatim from the clients.
allowed(await write('sessions/RULES1', {
  presence: { p_qa1: { name: 'QA', role: 'student', lastSeen: 1, following: 'QA', followingId: '', idx: 0 } },
}, ['presence']), 'joinPresence presence map');
allowed(await write('sessions/RULES1', {
  preProNotes: [{ id: 'n1', text: 'Camera 2 iris flickers', by: 'QA', tag: 'video', at: 1 }],
  preProActivity: [{ section: 'Production Note', by: 'QA', clientId: 'c1', at: 1 }],
}, ['preProNotes', 'preProActivity']), 'Planda Bear notes + activity write');
allowed(await write('sessions/RULES1', { preflightPing: { token: 'pf_qa', ts: 1 } }, ['preflightPing']), 'preflight round-trip ping');
allowed(await write('sessions/RULES1', {
  beats: [{ id: 1, label: 'Open', style: 'timed', min: 1, sec: 0 }],
  rundownAliases: {}, rundownUpdatedAt: 2, rundownUpdatedBy: 'QA', showName: 'Rules rehearsal 2',
}, ['beats', 'rundownAliases', 'rundownUpdatedAt', 'rundownUpdatedBy', 'showName']), 'rundown transaction batch shape');

// Phase 3 per-session entry toggle.
allowed(await write('sessions/RULES1', { requireLoginCode: true }, ['requireLoginCode']), 'admin flips require-login-code on');
allowed(await write('sessions/RULES1', { requireLoginCode: false }, ['requireLoginCode']), 'admin flips require-login-code off');
denied(await write('sessions/RULES1', { requireLoginCode: 'yes' }, ['requireLoginCode']), 'require-login-code must be a bool');

// Dashboard soft-delete lifecycle (Phase 1 item 4).
allowed(await write('sessions/RULES1', { deletedAt: 1, deletedBy: 'QA Admin' }, ['deletedAt', 'deletedBy']), 'dashboard soft-delete stamp');
allowed(await write('sessions/RULES1', {}, ['deletedAt', 'deletedBy']), 'restore clears the soft-delete stamp');
denied(await write('sessions/RULES1', { deletedAt: 'yesterday' }, ['deletedAt']), 'soft-delete timestamp must be an int');

// Type and bound violations on the session doc.
denied(await write('sessions/RULES1', { beats: { oops: true } }, ['beats']), 'beats must stay a list');
denied(await write('sessions/RULES1', { presence: 'nope' }, ['presence']), 'presence must stay a map');
denied(await write('sessions/RULES1', { prePro: 'nope' }, ['prePro']), 'prePro must stay a map');
denied(await write('sessions/RULES1', { assignments: [] }, ['assignments']), 'legacy assignments projection must stay a map');
denied(await write('sessions/RULES1', { roleAssignments: {} }, ['roleAssignments']), 'legacy roleAssignments projection must stay a list');
allowed(await write('sessions/RULES1', {
  assignmentRevision: 1, assignmentUpdatedAt: 8, assignmentUpdatedBy: 'profile_instructor_01',
}, ['assignmentRevision', 'assignmentUpdatedAt', 'assignmentUpdatedBy']), 'canonical assignment parent revision metadata');
denied(await write('sessions/RULES1', { assignmentRevision: -1 }, ['assignmentRevision']), 'assignment parent revision must be nonnegative');
denied(await write('sessions/RULES1', { assignmentUpdatedAt: 'now' }, ['assignmentUpdatedAt']), 'assignment parent timestamp must be an int');
denied(await write('sessions/RULES1', { assignmentUpdatedBy: '' }, ['assignmentUpdatedBy']), 'assignment parent actor cannot be empty');
denied(await write('sessions/RULES1', { assignmentUpdatedBy: 'x'.repeat(161) }, ['assignmentUpdatedBy']), 'assignment parent actor is bounded');
denied(await write('sessions/RULESLONG', { code: 'RULESLONG', showName: 'x'.repeat(250) }), 'showName over 200 chars');
denied(await write('sessions/RULESEMPTY', { code: 'RULESEMPTY', showName: '' }), 'showName empty string');
denied(await write('sessions/WRONG', { ...session, code: 'OTHER' }), 'mismatched session code');

const legacyFile = { kind: 'pbNoteFile', session: 'RULES1', name: 'still.png', type: 'image/png', size: 4, chunkCount: 1, data: 'data' };
allowed(await write('sessions/pbfile_file1', legacyFile), 'legacy sibling attachment remains compatible');
allowed(await write('sessions/RULES1/files/file1', { ...legacyFile, fileId: 'file1' }), 'future attachment subcollection write');
allowed(await write('sessions/RULES1/files/file1.chunk.1', {
  kind: 'pbNoteFileChunk', fileId: 'file1.chunk.1', parentFileId: 'file1',
  session: 'RULES1', chunkIndex: 1, data: 'more-data',
}), 'attachment chunk write');
allowed(await request('sessions/RULES1/files?pageSize=20'), 'dashboard lists attachment subcollection for cascade');
denied(await write('sessions/RULES1/files/file1', { ...legacyFile, fileId: '../escape' }), 'attachment id mismatch');
denied(await write('sessions/RULES1/files/file2', { ...legacyFile, data: 'x'.repeat(800001) }), 'oversized attachment chunk');
denied(await write('sessions/RULES1/files/file3', { ...legacyFile, fileId: 'file3', chunkCount: 9 }), 'chunkCount beyond the 4 MB cap math');
denied(await write('sessions/RULES1/files/file4', { ...legacyFile, fileId: 'file4', evil: true }), 'unknown key on attachment doc');
denied(await write('sessions/RULES1/files/file5', { ...legacyFile, fileId: 'file5', session: 'OTHERSESSION' }), 'attachment pinned to another session');

// ── v2.1 admin accounts (D1) ─────────────────────────────────────────────
// Legacy admins/global is frozen read-only; admins/{uid} is the directory.
const admins = { list: [{ id: 'adm_1', name: 'Instructor', codeHash: '12345678', level: 'super' }] };
denied(await write('admins/global', admins), 'legacy admin roster writes are retired');
allowedMissing(await request('admins/global'), 'legacy roster read stays open (rollback safety)');
denied(await remove('admins/global'), 'admin roster delete stays denied');

const superDoc = { username: 'jkost', name: 'Jon Kost', level: 'super', createdAt: 1, createdBy: 'bootstrap-script' };
const stdDoc = { username: 'casey', name: 'Casey Kim', level: 'standard', createdAt: 2, createdBy: 'uid_super_1' };
setAuth('owner');   // rules bypass — stands in for the service-account bootstrap
allowed(await write('admins/uid_super_1', superDoc), 'bootstrap seeds the first super admin (bypass)');
setAuth(null);
denied(await request('admins/uid_super_1'), 'admins doc read requires a signed-in user');
denied(await write('admins/uid_nope_1', stdDoc), 'unauthenticated cannot mint admins');
setAuth('uid_rando_9');   // signed in, but no admins doc → not an admin
allowed(await request('admins/uid_super_1'), 'any signed-in user resolves admins docs');
denied(await write('admins/uid_nope_1', stdDoc), 'signed-in non-admin cannot mint admins');
denied(await remove('admins/uid_super_1'), 'signed-in non-admin cannot delete admins');
setAuth('uid_super_1');
allowed(await write('admins/uid_std_1', stdDoc), 'super mints a standard admin');
denied(await write('admins/uid_bad_1', { ...stdDoc, username: 'Bad Name!' }), 'admin username shape enforced');
denied(await write('admins/uid_bad_2', { ...stdDoc, username: 'okname', level: 'full' }), "retired 'full' level rejected");
denied(await write('admins/uid_bad_3', { username: 'okname2', level: 'standard' }), 'admin doc requires name');
denied(await remove('admins/uid_super_1'), 'self-deletion lockout guard');
setAuth('uid_std_1');
denied(await write('admins/uid_nope_2', stdDoc), 'standard admin cannot mint admins');
setAuth(null);

allowedMissing(await request('accounts/acct_1'), 'entitlement reads remain available');
denied(await write('accounts/acct_1', { tier: 'paid' }), 'client entitlement grants remain denied');

const accessCode = { role: 'student', label: 'Fall TV', active: true, createdBy: 'Instructor', createdAt: 1 };
// v2.1 (D1): minting is admin-gated — the public minting hole is closed.
denied(await write('accessCodes/UNAUTH1', accessCode), 'unauthenticated code minting retired');
setAuth('uid_rando_9');
denied(await write('accessCodes/UNAUTH2', accessCode), 'signed-in non-admin code minting refused');
setAuth('uid_std_1');   // a standard admin can mint class codes
allowed(await write('accessCodes/CLASS2026', accessCode), 'future access code shape');
denied(await write('accessCodes/CLASS2026BAD', { ...accessCode, role: 'super' }), 'invalid access-code role');
denied(await write('accessCodes/CLASS2026BAD', { role: 'student', active: true, createdBy: 'x', createdAt: 1 }), 'access code missing required label');
denied(await remove('accessCodes/CLASS2026'), 'access-code delete denied (revoke = active:false)');
allowed(await write('accessCodes/REVOKED1', { ...accessCode, label: 'Spring 2025', active: false }), 'revoking a code by deactivating it');

// Phase 3 dashboard lifecycle verbatim: revoke patch, reactivate patch, type bounds.
allowed(await write('accessCodes/CLASS2026', { active: false, revokedAt: 5, revokedBy: 'Instructor' },
  ['active', 'revokedAt', 'revokedBy']), 'dashboard revoke patch (active/revokedAt/revokedBy)');
denied(await write('accessCodes/CLASS2026', { active: false, revokedAt: 'yesterday' },
  ['active', 'revokedAt']), 'revokedAt must be an int');
allowed(await write('accessCodes/CLASS2026', { active: true }, ['active']), 'dashboard reactivate patch');
setAuth(null);   // student flows below stay anonymous — the university rule

const profile = {
  username: 'alex.smith', fullName: 'Alex Smith', role: 'student', avatar: { type: 'initials' },
  theme: 'cool', sessions: ['RULES1'], codeUsed: 'CLASS2026', createdAt: 1, lastSeen: 1,
};
allowed(await write('profiles/alex.smith', profile), 'profile create with active code');
denied(await write('profiles/no.code', { ...profile, username: 'no.code', codeUsed: 'MISSING' }), 'profile create without active code');
denied(await write('profiles/casey.k', { ...profile, username: 'casey.k', codeUsed: 'REVOKED1' }), 'profile create with revoked code');
denied(await write('profiles/alex.smith', { ...profile, role: 'admin', lastSeen: 2 }), 'profile role elevation');
denied(await write('profiles/alex.smith', { ...profile, codeUsed: 'REVOKED1', lastSeen: 2 }), 'profile codeUsed mutation');
allowed(await write('profiles/alex.smith', { ...profile, lastSeen: 2 }), 'profile mutable fields update');
denied(await write('profiles/ab', { ...profile, username: 'ab' }), 'username shorter than 3 chars');
denied(await remove('profiles/alex.smith'), 'profile delete denied (deactivate instead)');

// Phase 3 client/dashboard patches verbatim (masked updates merge, rules see the whole doc).
allowed(await write('profiles/alex.smith', { avatar: { type: 'animal', value: 'koala' }, lastSeen: 3 },
  ['avatar', 'lastSeen']), 'device avatar save syncs onto the profile');
allowed(await write('profiles/alex.smith', { sessions: ['RULES1', 'SHOW42'], lastSeen: 4 },
  ['sessions', 'lastSeen']), 'attach a session code to the profile');
allowed(await write('profiles/alex.smith', { lastSeen: 5 }, ['lastSeen']), 'sign-in lastSeen bump');
allowed(await write('profiles/alex.smith', { active: false }, ['active']), 'roster deactivate');
allowed(await write('profiles/alex.smith', { active: true }, ['active']), 'roster reactivate');
denied(await write('profiles/alex.smith', { role: 'admin' }, ['role']), 'masked role elevation still denied');
denied(await write('profiles/alex.smith', { sessions: Array.from({ length: 101 }, (_, i) => `S${i}`) },
  ['sessions']), 'profile sessions list over the 100 cap');
denied(await write('profiles/mismatch.role', { ...profile, username: 'mismatch.role', role: 'admin' }),
  'create with role not matching the code doc');

// Phase 6 stable identity migration. Legacy profiles may omit profileId; once
// one is added it cannot be changed or removed. Aliases stay mutable but bounded.
const alexProfileId = 'profile_alex_smith_01';
allowed(await write('profiles/alex.smith', {
  profileId: alexProfileId, profileAliases: ['alex.smith'], lastSeen: 6,
}, ['profileId', 'profileAliases', 'lastSeen']), 'legacy profile adds its stable id once');
denied(await write('profiles/alex.smith', { profileId: 'profile_alex_changed_02' }, ['profileId']), 'stable profile id cannot change');
denied(await write('profiles/alex.smith', {}, ['profileId']), 'stable profile id cannot be removed');
allowed(await write('profiles/alex.smith', { profileAliases: ['alex.smith', 'alex.s'] }, ['profileAliases']), 'profile aliases may grow within the bound');
denied(await write('profiles/alex.smith', { profileAliases: 'alex.smith' }, ['profileAliases']), 'profile aliases must be a list');
denied(await write('profiles/alex.smith', {
  profileAliases: Array.from({ length: 41 }, (_, i) => `alex.alias.${i}`),
}, ['profileAliases']), 'profile aliases over the 40-entry cap');

// Rename = new doc under the (still active) code, then tombstone the old name.
allowed(await write('profiles/alexs.new', {
  ...profile, username: 'alexs.new', profileId: alexProfileId, profileAliases: ['alex.smith', 'alexs.new'],
}), 'rename creates the new doc with the same stable id');
allowed(await write('profiles/alex.smith', { active: false, renamedTo: 'alexs.new' },
  ['active', 'renamedTo']), 'rename tombstones the old doc');
allowed(await write('profiles/alexs.new', { active: false, mergedInto: 'alex.smith' },
  ['active', 'mergedInto']), 'merge tombstone points at the target');

// Phase 6 canonical assignments. Cueola has no Firebase Auth, so these are
// role-neutral shape/consistency checks, not instructor/student authorization.
const assignment = {
  assignmentId: 'asn_alex_producer_01', productionSession: 'RULES1',
  profileId: alexProfileId, displayName: 'Alex Smith',
  positionId: 'position_producer_01', positionLabel: 'Producer',
  paperworkIds: ['call-sheet', 'rundown'], paperworkLabels: ['Call Sheet', 'Rundown'],
  status: 'assigned', assignedBy: 'profile_instructor_01', assignedByLabel: 'Instructor One',
  createdAt: 10, updatedAt: 10, revision: 1,
};
allowed(await write('sessions/RULES1/assignments/asn_alex_producer_01', assignment), 'canonical assignment create');
allowed(await request('sessions/RULES1/assignments/asn_alex_producer_01'), 'canonical assignment get');
allowed(await request('sessions/RULES1/assignments?pageSize=20'), 'canonical assignments list');

const secondPosition = {
  ...assignment,
  assignmentId: 'asn_alex_camera_01',
  positionId: 'position_camera_01',
  positionLabel: 'Camera 1',
  paperworkIds: ['video-patch'],
  paperworkLabels: ['Video Patch Sheet'],
};
allowed(await write('sessions/RULES1/assignments/asn_alex_camera_01', secondPosition), 'same profile may hold a second position record');

allowed(await write('sessions/RULES1/assignments/asn_alex_producer_01', {
  displayName: 'Alex S.', positionLabel: 'Lead Producer',
  paperworkIds: ['call-sheet', 'rundown', 'safety-plan'],
  paperworkLabels: ['Call Sheet', 'Rundown', 'Safety Plan'],
  status: 'completed', assignedBy: 'profile_instructor_02', assignedByLabel: 'Instructor Two',
  updatedAt: 11, revision: 2,
}, ['displayName', 'positionLabel', 'paperworkIds', 'paperworkLabels', 'status', 'assignedBy', 'assignedByLabel', 'updatedAt', 'revision']), 'assignment mutable fields update with a newer revision');

const missingAssignmentStatus = { ...assignment };
delete missingAssignmentStatus.status;
denied(await write('sessions/RULES1/assignments/asn_missing_status_01', {
  ...missingAssignmentStatus, assignmentId: 'asn_missing_status_01',
}), 'assignment create requires every canonical field');
denied(await write('sessions/RULES1/assignments/asn_doc_mismatch_01', assignment), 'assignment id must match its document id');
denied(await write('sessions/RULES1/assignments/asn_wrong_session_01', {
  ...assignment, assignmentId: 'asn_wrong_session_01', productionSession: 'OTHER',
}), 'assignment is pinned to its parent production');
allowed(await write('sessions/A/assignments/asn_short_session_01', {
  ...assignment, assignmentId: 'asn_short_session_01', productionSession: 'A',
}), 'canonical assignments preserve the existing short session-code contract');
allowed(await remove('sessions/A/assignments/asn_short_session_01'), 'short-code assignment can be removed');
denied(await write('sessions/RULES1/assignments/bad:id', {
  ...assignment, assignmentId: 'bad:id',
}), 'assignment document id uses the safe canonical alphabet');
denied(await write('sessions/RULES1/assignments/asn_bad_profile_01', {
  ...assignment, assignmentId: 'asn_bad_profile_01', profileId: 'bad:id',
}), 'assignment profile id uses the safe canonical alphabet');
denied(await write('sessions/RULES1/assignments/asn_bad_position_01', {
  ...assignment, assignmentId: 'asn_bad_position_01', positionId: 'x',
}), 'assignment position id is bounded and canonical');
denied(await write('sessions/RULES1/assignments/asn_empty_name_01', {
  ...assignment, assignmentId: 'asn_empty_name_01', displayName: '',
}), 'assignment display name cannot be empty');
denied(await write('sessions/RULES1/assignments/asn_long_name_01', {
  ...assignment, assignmentId: 'asn_long_name_01', displayName: 'x'.repeat(161),
}), 'assignment display name is bounded at the model contract');
denied(await write('sessions/RULES1/assignments/asn_long_position_01', {
  ...assignment, assignmentId: 'asn_long_position_01', positionLabel: 'x'.repeat(161),
}), 'assignment position label is bounded at the model contract');
denied(await write('sessions/RULES1/assignments/asn_bad_paperwork_01', {
  ...assignment, assignmentId: 'asn_bad_paperwork_01', paperworkIds: 'rundown',
}), 'assignment paperwork ids must be a list');
denied(await write('sessions/RULES1/assignments/asn_unpaired_paperwork_01', {
  ...assignment, assignmentId: 'asn_unpaired_paperwork_01', paperworkLabels: ['Call Sheet'],
}), 'assignment paperwork ids and labels stay paired');
denied(await write('sessions/RULES1/assignments/asn_too_much_paperwork_01', {
  ...assignment, assignmentId: 'asn_too_much_paperwork_01',
  paperworkIds: Array.from({ length: 41 }, (_, i) => `paper_${i}`),
  paperworkLabels: Array.from({ length: 41 }, (_, i) => `Paper ${i}`),
}), 'assignment paperwork is capped at 40 items');
denied(await write('sessions/RULES1/assignments/asn_bad_status_01', {
  ...assignment, assignmentId: 'asn_bad_status_01', status: 'deleted',
}), 'assignment status uses the approved enum');
denied(await write('sessions/RULES1/assignments/asn_bad_actor_01', {
  ...assignment, assignmentId: 'asn_bad_actor_01', assignedBy: 'x',
}), 'assignment actor id is bounded and canonical');
denied(await write('sessions/RULES1/assignments/asn_long_actor_label_01', {
  ...assignment, assignmentId: 'asn_long_actor_label_01', assignedByLabel: 'x'.repeat(161),
}), 'assignment actor label is bounded at the model contract');
denied(await write('sessions/RULES1/assignments/asn_bad_created_01', {
  ...assignment, assignmentId: 'asn_bad_created_01', createdAt: 'now',
}), 'assignment created timestamp must be an int');
denied(await write('sessions/RULES1/assignments/asn_bad_updated_01', {
  ...assignment, assignmentId: 'asn_bad_updated_01', updatedAt: 9,
}), 'assignment updated timestamp cannot precede creation');
denied(await write('sessions/RULES1/assignments/asn_bad_revision_01', {
  ...assignment, assignmentId: 'asn_bad_revision_01', revision: 0,
}), 'assignment revision starts at one');
denied(await write('sessions/RULES1/assignments/asn_huge_revision_01', {
  ...assignment, assignmentId: 'asn_huge_revision_01', revision: 1000001,
}), 'assignment revision is bounded');
denied(await write('sessions/RULES1/assignments/asn_unknown_key_01', {
  ...assignment, assignmentId: 'asn_unknown_key_01', unexpected: true,
}), 'assignment rejects unknown fields');

// Existing producer record is now revision 2 / updatedAt 11. Identity/created
// fields are immutable; mutable writes must advance both ordering signals.
denied(await write('sessions/RULES1/assignments/asn_alex_producer_01', {
  assignmentId: 'asn_alex_changed_01', updatedAt: 12, revision: 3,
}, ['assignmentId', 'updatedAt', 'revision']), 'assignment document identity cannot change');
denied(await write('sessions/RULES1/assignments/asn_alex_producer_01', {
  profileId: 'profile_other_student_01', updatedAt: 12, revision: 3,
}, ['profileId', 'updatedAt', 'revision']), 'assignment profile identity cannot change');
denied(await write('sessions/RULES1/assignments/asn_alex_producer_01', {
  positionId: 'position_director_01', updatedAt: 12, revision: 3,
}, ['positionId', 'updatedAt', 'revision']), 'assignment position identity cannot change');
denied(await write('sessions/RULES1/assignments/asn_alex_producer_01', {
  productionSession: 'OTHER', updatedAt: 12, revision: 3,
}, ['productionSession', 'updatedAt', 'revision']), 'assignment production identity cannot change');
denied(await write('sessions/RULES1/assignments/asn_alex_producer_01', {
  createdAt: 9, updatedAt: 12, revision: 3,
}, ['createdAt', 'updatedAt', 'revision']), 'assignment creation timestamp cannot change');
denied(await write('sessions/RULES1/assignments/asn_alex_producer_01', {
  updatedAt: 12, revision: 2,
}, ['updatedAt', 'revision']), 'assignment update must advance its revision');
denied(await write('sessions/RULES1/assignments/asn_alex_producer_01', {
  updatedAt: 10, revision: 3,
}, ['updatedAt', 'revision']), 'assignment update cannot move its timestamp backward');
denied(await write('sessions/RULES1/assignments/asn_alex_producer_01', {
  unexpected: true, updatedAt: 12, revision: 3,
}, ['unexpected', 'updatedAt', 'revision']), 'assignment update rejects unknown fields');

allowed(await remove('sessions/RULES1/assignments/asn_alex_producer_01'), 'canonical assignment delete');
allowed(await request('sessions/RULES1/assignments/asn_alex_camera_01'), 'removing one position preserves the second');
allowed(await remove('sessions/RULES1/assignments/asn_alex_camera_01'), 'second canonical assignment delete');

const note = { id: 'note1', text: 'Check camera two', by: 'Alex Smith', role: 'student', likes: [], checklist: [], attachments: [] };
allowed(await write('sessions/RULES1/notes/note1', note), 'future note subcollection write');
allowed(await request('sessions/RULES1/notes?pageSize=20'), 'future note subcollection list');
denied(await write('sessions/RULES1/notes/note1', { ...note, id: 'note2' }), 'note id mismatch');
denied(await write('sessions/RULES1/notes/note2', { ...note, id: 'note2', payload: 'evil' }), 'unknown key on note doc');
denied(await write('sessions/RULES1/notes/note3', { ...note, id: 'note3', text: 'x'.repeat(20001) }), 'note text over 20000 chars');

// Phase 4 per-note migration: the live client's compact docs + masked patches verbatim
// (a masked patch merges server-side, so writing the merged result emulates arrayUnion).
const compactNote = { id: 'note9', text: 'Board migration note', by: 'Alex Smith', role: 'student', tag: 'todo',
  assignee: 'Casey Kim', at: 5, clientId: 'client_abc', likes: ['client_abc'] };
allowed(await write('sessions/RULES1/notes/note9', compactNote), 'compact per-note post');
allowed(await write('sessions/RULES1/notes/note9', { likes: ['client_abc', 'client_xyz'] }, ['likes']), 'like patch result');
allowed(await write('sessions/RULES1/notes/note9', { done: true, doneBy: 'Casey Kim', doneAt: 6 }, ['done', 'doneBy', 'doneAt']), 'to-do done patch');
allowed(await write('sessions/RULES1/notes/note9', { text: 'Edited text', editedAt: 7 }, ['text', 'editedAt']), 'note edit patch');
allowed(await write('sessions/RULES1/notes/note9', { pinned: true }, ['pinned']), 'pin patch');
allowed(await write('sessions/RULES1/notes/note9', { checklist: [{ id: 'ci1', text: 'Reset the set', done: true, doneBy: 'Alex', doneAt: 8 }] }, ['checklist']), 'checklist field patch');
allowed(await write('sessions/RULES1/notes/note9', { checklist: [{ id: 'ci1', text: 'Reset the set', assignee: 'Casey Kim' }] }, ['checklist']), 'checklist item carries an assignee');
allowed(await write('sessions/RULES1/notes/note9', { seenBy: { casey_kim: { name: 'Casey Kim', at: 9 } } },
  ['seenBy.casey_kim']), 'read receipt as a masked field-path patch');
denied(await write('sessions/RULES1/notes/note9', { seenBy: ['casey_kim'] }, ['seenBy']), 'seenBy must be a map');
denied(await write('sessions/RULES1/notes/note9', { done: 'yes' }, ['done']), 'note done must be a bool');
denied(await write('sessions/RULES1/notes/note9', { pinned: 1 }, ['pinned']), 'note pinned must be a bool');
denied(await write('sessions/RULES1/notes/note9', { at: 'now' }, ['at']), 'note timestamp must be an int');
denied(await write('sessions/RULES1/notes/note9', { assignee: '' }, ['assignee']), 'empty-string field must be deleted, not written');
allowed(await remove('sessions/RULES1/notes/note9'), 'per-note delete');
denied(await write('unknown/doc', { anything: true }), 'unknown collection locked down');
denied(await request('unknown/doc'), 'unknown collection read locked down');

// v2.1 (D2/D5): group workspaces + clone lineage + config hygiene.
allowed(await write('sessions/RULES1', { groups: [{ id:'g1', name:'Group 1' }], groupsLocked: false },
  ['groups', 'groupsLocked']), 'groups config on the session doc');
denied(await write('sessions/RULES1', { groups: 'g1' }, ['groups']), 'groups must be a list');
denied(await write('sessions/RULES1', { groupsLocked: 'yes' }, ['groupsLocked']), 'groupsLocked must be a bool');
allowed(await write('sessions/RULES1', { clonedFrom: 'RULES0' }, ['clonedFrom']), 'clone lineage stamp');
denied(await write('sessions/RULES1', { clonedFrom: 42 }, ['clonedFrom']), 'clonedFrom must be a string');
allowed(await write('sessions/RULES1/groups/g1', {
  prePro: { production: 'Group 1 show', _fieldUpdatedAt: { production: 1 } },
  preProActivity: [{ section: 'Call Sheet', by: 'QA', at: 1 }],
  updatedAt: 1,
}), 'group workspace doc write');
allowed(await write('sessions/RULES1/groups/g1', { prePro: { production: 'Edited' } }, ['prePro.production']), 'masked group paperwork patch');
allowed(await request('sessions/RULES1/groups?pageSize=10'), 'group workspace list');
denied(await write('sessions/RULES1/groups/bad-id', { prePro: {} }), 'group id must be identifier-safe');
denied(await write('sessions/RULES1/groups/g2', { prePro: 'nope' }), 'group prePro must be a map');
denied(await write('sessions/RULES1/groups/g3', { preProActivity: {} }), 'group activity must be a list');
allowed(await remove('sessions/RULES1/groups/g1'), 'group workspace delete (purge cascade)');

allowed(await remove('sessions/RULES1/notes/note1'), 'future note delete');
allowed(await remove('sessions/RULES1/files/file1.chunk.1'), 'future file chunk delete');
allowed(await remove('sessions/RULES1/files/file1'), 'future file delete');

// v2.1 (D1): session ownership stamp + admin-gated session destruction.
allowed(await write('sessions/RULES1', { ownerUid: 'uid_super_1' }, ['ownerUid']), 'ownerUid stamp patch');
denied(await write('sessions/RULES1', { ownerUid: 42 }, ['ownerUid']), 'ownerUid must be a string');
denied(await remove('sessions/pbfile_file1'), 'unauthenticated legacy attachment delete refused');
denied(await remove('sessions/RULES1'), 'unauthenticated session delete refused');
setAuth('uid_rando_9');
denied(await remove('sessions/RULES1'), 'signed-in non-admin session delete refused');
setAuth('uid_std_1');
allowed(await remove('sessions/pbfile_file1'), 'admin purge deletes legacy attachment');
allowed(await remove('sessions/RULES1'), 'admin deletes session');
setAuth(null);

console.log('PASS: Cueola/dashboard/Flowmingo/Outrangutan/Prompt-Up write patterns, type/bound denials, and future collection guards');
