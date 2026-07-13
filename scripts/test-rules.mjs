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

async function request(path, options = {}) {
  const response = await fetch(`${base}/${path}`, options);
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

const admins = { list: [{ id: 'adm_1', name: 'Instructor', codeHash: '12345678', level: 'super' }] };
allowed(await write('admins/global', admins), 'dashboard writes valid admin roster');
allowed(await request('admins/global'), 'admin roster listener read');
denied(await write('admins/other', admins), 'non-global admin document');
denied(await write('admins/global', { list: admins.list, unexpected: true }), 'invalid admin document shape');
denied(await remove('admins/global'), 'admin roster delete stays denied');

allowedMissing(await request('accounts/acct_1'), 'entitlement reads remain available');
denied(await write('accounts/acct_1', { tier: 'paid' }), 'client entitlement grants remain denied');

const accessCode = { role: 'student', label: 'Fall TV', active: true, createdBy: 'Instructor', createdAt: 1 };
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

// Rename = new doc under the (still active) code, then tombstone the old name.
allowed(await write('profiles/alexs.new', { ...profile, username: 'alexs.new' }), 'rename creates the new doc');
allowed(await write('profiles/alex.smith', { active: false, renamedTo: 'alexs.new' },
  ['active', 'renamedTo']), 'rename tombstones the old doc');
allowed(await write('profiles/alexs.new', { active: false, mergedInto: 'alex.smith' },
  ['active', 'mergedInto']), 'merge tombstone points at the target');

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

allowed(await remove('sessions/RULES1/notes/note1'), 'future note delete');
allowed(await remove('sessions/RULES1/files/file1.chunk.1'), 'future file chunk delete');
allowed(await remove('sessions/RULES1/files/file1'), 'future file delete');
allowed(await remove('sessions/pbfile_file1'), 'legacy attachment delete');
allowed(await remove('sessions/RULES1'), 'dashboard deletes session');

console.log('PASS: Cueola/dashboard/Flowmingo/Outrangutan/Prompt-Up write patterns, type/bound denials, and future collection guards');
