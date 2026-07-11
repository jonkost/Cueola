// Dependency-free Firestore rules contract test.
// Run under the emulator:
//   firebase emulators:exec --only firestore "node scripts/test-rules.mjs"
import assert from 'node:assert/strict';

const host = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
const project = process.env.GCLOUD_PROJECT || process.env.FIREBASE_PROJECT || 'cueola-rules-test';
const base = `http://${host}/v1/projects/${project}/databases/(default)/documents`;

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

const admins = { list: [{ id: 'adm_1', name: 'Instructor', codeHash: '12345678', level: 'super' }] };
allowed(await write('admins/global', admins), 'dashboard writes valid admin roster');
denied(await write('admins/other', admins), 'non-global admin document');
denied(await write('admins/global', { list: admins.list, unexpected: true }), 'invalid admin document shape');

allowedMissing(await request('accounts/acct_1'), 'entitlement reads remain available');
denied(await write('accounts/acct_1', { tier: 'paid' }), 'client entitlement grants remain denied');

const accessCode = { role: 'student', label: 'Fall TV', active: true, createdBy: 'Instructor', createdAt: 1 };
allowed(await write('accessCodes/CLASS2026', accessCode), 'future access code shape');
denied(await write('accessCodes/CLASS2026BAD', { ...accessCode, role: 'super' }), 'invalid access-code role');

const profile = {
  username: 'alex.smith', fullName: 'Alex Smith', role: 'student', avatar: { type: 'initials' },
  theme: 'cool', sessions: ['RULES1'], codeUsed: 'CLASS2026', createdAt: 1, lastSeen: 1,
};
allowed(await write('profiles/alex.smith', profile), 'profile create with active code');
denied(await write('profiles/no.code', { ...profile, username: 'no.code', codeUsed: 'MISSING' }), 'profile create without active code');
denied(await write('profiles/alex.smith', { ...profile, role: 'admin', lastSeen: 2 }), 'profile role elevation');
allowed(await write('profiles/alex.smith', { ...profile, lastSeen: 2 }), 'profile mutable fields update');

const note = { id: 'note1', text: 'Check camera two', by: 'Alex Smith', role: 'student', likes: [], checklist: [], attachments: [] };
allowed(await write('sessions/RULES1/notes/note1', note), 'future note subcollection write');
denied(await write('sessions/RULES1/notes/note1', { ...note, id: 'note2' }), 'note id mismatch');
denied(await write('unknown/doc', { anything: true }), 'unknown collection locked down');

allowed(await remove('sessions/RULES1/notes/note1'), 'future note delete');
allowed(await remove('sessions/RULES1/files/file1.chunk.1'), 'future file chunk delete');
allowed(await remove('sessions/RULES1/files/file1'), 'future file delete');
allowed(await remove('sessions/pbfile_file1'), 'legacy attachment delete');
allowed(await remove('sessions/RULES1'), 'dashboard deletes session');

console.log('PASS: current Cueola/dashboard/Flowmingo/Outrangutan/Prompt-Up patterns and future collection guards');
