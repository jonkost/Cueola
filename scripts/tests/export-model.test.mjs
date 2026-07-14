import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ExportModel = require('../../cueola-export-model.js');

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

function assignment(overrides = {}) {
  return {
    assignmentId: 'assignment_director',
    productionSession: 'STAB26',
    profileId: 'profile_student_01',
    displayName: 'Avery Stone',
    positionId: 'position_director',
    positionLabel: 'Director',
    paperworkIds: ['call-sheet', 'rundown'],
    paperworkLabels: ['Call Sheet', 'Full Rendered Rundown'],
    status: 'assigned',
    assignedBy: 'profile_instructor_01',
    assignedByLabel: 'Riley Instructor',
    createdAt: 1000,
    updatedAt: 2000,
    revision: 2,
    ...overrides,
  };
}

function snapshotInput(overrides = {}) {
  return {
    authority: 'server',
    production: {
      productionId: 'production_stab26',
      sessionCode: 'stab26',
      name: 'Cueola Stabilization Show',
    },
    exportedAt: 10_000,
    revisions: {
      sessionRevision: 4,
      sessionUpdatedAt: 9000,
      rundownBatchId: 'batch_04',
      rundownUpdatedAt: 8000,
      preProUpdatedAt: 8100,
      assignmentRevision: 3,
      assignmentUpdatedAt: 8200,
      notesRevision: 2,
      notesUpdatedAt: 8300,
      notesFingerprint: 'notes_02',
    },
    show: { name: 'Cueola Stabilization Show', start: '09:30', freeMode: false },
    beats: [
      { id: 'beat_2', style: 'timed', info: 'Second', notes: '', min: 0, sec: 30, cues: {} },
      { id: 'beat_1', style: 'flex', info: 'First by operator order', notes: '', min: 1, sec: 0, cues: {} },
    ],
    prePro: {
      production: 'Cueola Stabilization Show',
      safety: { notes: 'Use the marked exit.' },
      callSheets: [{ id: 'call-sheet', label: 'Show Day' }],
    },
    assignments: [assignment()],
    notes: [
      { id: 'note_later', at: 200, by: 'Blair', text: 'Later note' },
      { id: 'note_earlier', at: 100, by: 'Avery', text: 'Earlier note' },
    ],
    options: { includeNotes: true, includeAssignments: true, documentType: 'package' },
    ...overrides,
  };
}

test('exports the stable schema, authority, readiness, and revision contracts', () => {
  assert.equal(ExportModel.EXPORT_SCHEMA_VERSION, 1);
  assert.equal(ExportModel.EXPORT_KIND, 'cueola-paperwork-export');
  assert.deepEqual({ ...ExportModel.AUTHORITY }, {
    SERVER: 'server', LOCAL: 'local', UNPUBLISHED: 'unpublished',
  });
  assert.deepEqual({ ...ExportModel.READINESS_STATUS }, {
    READY: 'ready', LOCAL: 'local', UNPUBLISHED: 'unpublished', WAITING: 'waiting', BLOCKED: 'blocked',
  });
  assert.deepEqual([...ExportModel.CANONICAL_ASSIGNMENT_FIELDS], [
    'assignmentId', 'productionSession', 'profileId', 'displayName',
    'positionId', 'positionLabel', 'paperworkIds', 'paperworkLabels',
    'status', 'assignedBy', 'assignedByLabel', 'createdAt', 'updatedAt', 'revision',
  ]);
  assert.deepEqual([...ExportModel.REVISION_FIELDS], [
    'sessionRevision', 'sessionUpdatedAt', 'rundownBatchId', 'rundownUpdatedAt',
    'preProUpdatedAt', 'assignmentRevision', 'assignmentUpdatedAt',
    'notesRevision', 'notesUpdatedAt', 'notesFingerprint', 'tokens',
  ]);
});

test('stable fingerprints ignore object insertion order but retain array order and Unicode', () => {
  const first = { z: 3, nested: { b: 'Mañana 🐨', a: 1 }, rows: ['α', 'β'] };
  const reorderedKeys = { rows: ['α', 'β'], nested: { a: 1, b: 'Mañana 🐨' }, z: 3 };
  const reorderedRows = { rows: ['β', 'α'], nested: { a: 1, b: 'Mañana 🐨' }, z: 3 };
  assert.equal(ExportModel.stableStringify(first), ExportModel.stableStringify(reorderedKeys));
  assert.equal(ExportModel.fingerprint(first), ExportModel.fingerprint(reorderedKeys));
  assert.notEqual(ExportModel.fingerprint(first), ExportModel.fingerprint(reorderedRows));
  assert.notEqual(ExportModel.fingerprint(first), ExportModel.fingerprint({ ...reorderedKeys, z: 4 }));
});

test('deep clone creates JSON-safe independent data and deep freeze locks every level', () => {
  const source = {
    nested: { rows: [{ label: 'A' }] },
    when: new Date('2026-07-13T12:00:00Z'),
    set: new Set(['one', 'two']),
    map: new Map([[1, { value: 'number key' }], ['2', { value: 'string key' }]]),
    nonfinite: Infinity,
  };
  const clone = ExportModel.deepClone(source);
  assert.deepEqual(clone, {
    nested: { rows: [{ label: 'A' }] },
    when: '2026-07-13T12:00:00.000Z',
    set: ['one', 'two'],
    map: { 1: { value: 'number key' }, 2: { value: 'string key' } },
    nonfinite: null,
  });
  source.nested.rows[0].label = 'Changed';
  assert.equal(clone.nested.rows[0].label, 'A');
  const frozen = ExportModel.deepFreeze(clone);
  assert.equal(Object.isFrozen(frozen), true);
  assert.equal(Object.isFrozen(frozen.nested.rows[0]), true);
  assert.throws(() => { frozen.nested.rows[0].label = 'Nope'; }, TypeError);
  const cyclic = {};
  cyclic.self = cyclic;
  assert.throws(() => ExportModel.deepClone(cyclic), /Cyclic export data/);
});

test('a clean server-confirmed state is authoritative and ready', () => {
  const result = ExportModel.assessReadiness({
    authority: 'server',
    serverConfirmed: true,
    rundown: { state: 'saved' },
    prePro: { state: 'saved' },
    notes: { state: 'saved' },
    assignments: { state: 'saved' },
  });
  assert.equal(result.status, 'ready');
  assert.equal(result.canExport, true);
  assert.equal(result.authoritative, true);
  assert.equal(result.issues.length, 0);
  assert.equal(result.label, 'SERVER-CONFIRMED EXPORT');
});

test('dirty, debounce, and every pending subsystem wait instead of exporting', () => {
  const result = ExportModel.assessReadiness({
    authority: 'server',
    documentDirty: true,
    rundownPendingBatches: [{ id: 1 }, { id: 2 }],
    paperworkDirty: true,
    preProDebouncePending: true,
    preProPendingKeys: new Set(['callSheets', 'safety']),
    notesPendingWrites: new Set(['note_1']),
    assignmentSaveState: 'saving',
  });
  assert.equal(result.status, 'waiting');
  assert.equal(result.canExport, false);
  assert.equal(result.authoritative, false);
  assert.equal(result.pendingCount, 9);
  const issueKeys = result.issues.map(issue => `${issue.scope}:${issue.code}:${issue.count}`);
  assert.ok(issueKeys.includes('document:dirty:1'));
  assert.ok(issueKeys.includes('rundown:pending:2'));
  assert.ok(issueKeys.includes('prePro:dirty:1'));
  assert.ok(issueKeys.includes('prePro:debounce:1'));
  assert.ok(issueKeys.includes('prePro:pending:2'));
  assert.ok(issueKeys.includes('notes:pending:1'));
  assert.ok(issueKeys.includes('assignments:pending:1'));
});

test('cache, permission denial, unavailable reads, and conflicts block server exports', () => {
  const result = ExportModel.assessReadiness({
    authority: 'server',
    serverConfirmed: false,
    rundown: { fromCache: true },
    notes: { error: { code: 'permission-denied' } },
    prePro: { error: { code: 'unavailable' } },
    assignmentSaveState: 'conflict',
  });
  assert.equal(result.status, 'blocked');
  assert.equal(result.canExport, false);
  assert.deepEqual(result.issues.filter(issue => issue.severity === 'block').map(issue => `${issue.scope}:${issue.code}`), [
    'document:unconfirmed',
    'rundown:cache',
    'prePro:unavailable',
    'notes:denied',
    'assignments:conflict',
  ]);
});

test('a failed cached assignment load is blocked without a duplicate generic failure', () => {
  const result = ExportModel.assessReadiness({
    authority: 'server', assignmentSaveState: 'failed', assignmentFromCache: true,
  });
  assert.equal(result.status, 'blocked');
  assert.deepEqual(result.issues.map(issue => `${issue.scope}:${issue.code}`), ['assignments:cache']);
});

test('local authority permits an explicitly labeled local copy while surfacing cloud warnings', () => {
  const result = ExportModel.assessReadiness({
    authority: 'local',
    notes: { fromCache: true, error: { code: 'permission-denied' } },
    assignments: { unavailable: true },
  });
  assert.equal(result.status, 'local');
  assert.equal(result.canExport, true);
  assert.equal(result.authoritative, false);
  assert.equal(result.requiresLabel, true);
  assert.equal(result.label, 'LOCAL DRAFT — NOT CLOUD CONFIRMED');
  assert.deepEqual(result.warnings.map(issue => `${issue.scope}:${issue.code}`), [
    'notes:cache', 'notes:denied', 'assignments:unavailable',
  ]);
});

test('local dirty state still waits until the current draft is captured', () => {
  const result = ExportModel.assessReadiness({ authority: 'local', paperworkDirty: true });
  assert.equal(result.status, 'waiting');
  assert.equal(result.canExport, false);
  assert.equal(result.issues[0].code, 'dirty');
});

test('snapshot contains normalized production identity, timestamp, revisions, and deterministic order', () => {
  const snapshot = ExportModel.createSnapshot(snapshotInput());
  assert.equal(snapshot.schemaVersion, 1);
  assert.equal(snapshot.kind, 'cueola-paperwork-export');
  assert.match(snapshot.snapshotId, /^export_[0-9a-f]{16}$/);
  assert.match(snapshot.fingerprint, /^ef_[0-9a-f]{16}$/);
  assert.equal(snapshot.authority, 'server');
  assert.equal(snapshot.authoritative, true);
  assert.equal(snapshot.production.productionId, 'production_stab26');
  assert.equal(snapshot.production.sessionCode, 'STAB26');
  assert.equal(snapshot.production.identity, 'STAB26');
  assert.equal(snapshot.exportedAt, 10_000);
  assert.equal(snapshot.revisions.assignmentRevision, 3);
  assert.equal(snapshot.revisions.rundownBatchId, 'batch_04');
  assert.deepEqual(snapshot.beats.map(beat => beat.id), ['beat_2', 'beat_1']);
  assert.deepEqual(snapshot.notes.map(note => note.id), ['note_earlier', 'note_later']);
  assert.equal(snapshot.assignmentGroups.length, 1);
  assert.equal(Object.isFrozen(snapshot), true);
  assert.equal(Object.isFrozen(snapshot.prePro.safety), true);
});

test('notes are privacy-safe by default and an explicit false survives every snapshot path', () => {
  const implicit = ExportModel.createSnapshot(snapshotInput({ options: { documentType: 'package' } }));
  const explicit = ExportModel.createSnapshot(snapshotInput({ options: { includeNotes: false } }));
  assert.equal(implicit.options.includeNotes, false);
  assert.deepEqual(implicit.notes, []);
  assert.equal(explicit.options.includeNotes, false);
  assert.deepEqual(explicit.notes, []);
});

test('unpublished and local snapshots carry unavoidable document labels', () => {
  const unpublished = ExportModel.createSnapshot(snapshotInput({
    authority: 'unpublished',
    notes: [{ id: 'draft', text: 'Not posted', at: 1 }],
    options: { includeNotes: true, documentType: 'note-draft' },
  }));
  assert.equal(unpublished.publicationStatus, 'unpublished-draft');
  assert.equal(unpublished.unpublished, true);
  assert.equal(unpublished.labels.authority, 'UNPUBLISHED DRAFT — NOT SAVED');
  assert.equal(unpublished.labels.document, 'UNPUBLISHED DRAFT — NOT SAVED');
  assert.equal(unpublished.readiness.status, 'unpublished');

  const local = ExportModel.createSnapshot(snapshotInput({ authority: 'expert' }));
  assert.equal(local.publicationStatus, 'local-draft');
  assert.equal(local.localOnly, true);
  assert.equal(local.labels.document, 'LOCAL DRAFT — NOT CLOUD CONFIRMED');

  const namedDraft = ExportModel.createSnapshot(snapshotInput({
    authority: 'unpublished', documentLabel: 'Production Note',
  }));
  assert.equal(namedDraft.labels.document, 'UNPUBLISHED DRAFT — NOT SAVED · Production Note');
});

test('difficult Unicode, special characters, long text, and empty fields are lossless', () => {
  const long = 'Long cue — café 東京 🐨 👩🏽‍💻 <>& “quoted”\n'.repeat(500);
  const source = snapshotInput({
    production: { sessionCode: 'unicode26', name: `Mañana / 日本語 / ${long}` },
    show: { name: `Show ${long}`, start: '', freeMode: false },
    beats: [{
      id: 'unicode', info: long, notes: '', min: 0, sec: 0,
      cues: { script: { text: `Dialogue: ${long}` } },
    }],
    prePro: { safety: { notes: long, hospital: '' }, urls: ['https://example.test/a?b=1&c=✓'] },
    assignments: [assignment({ productionSession: 'UNICODE26' })],
    notes: [{ id: 'n', at: 1, by: 'Zoë 🐼', text: long, attachments: [] }],
  });
  const snapshot = ExportModel.createSnapshot(source);
  assert.equal(snapshot.production.sessionCode, 'UNICODE26');
  assert.equal(snapshot.production.name, source.production.name);
  assert.equal(snapshot.show.name, source.show.name);
  assert.equal(snapshot.beats[0].info, long);
  assert.equal(snapshot.beats[0].cues.script.text, `Dialogue: ${long}`);
  assert.equal(snapshot.prePro.safety.notes, long);
  assert.equal(snapshot.prePro.safety.hospital, '');
  assert.equal(snapshot.notes[0].text, long);
});

test('snapshot is mutation-safe in both directions and has a repeatable fingerprint', () => {
  const source = snapshotInput();
  const first = ExportModel.createSnapshot(source);
  const second = ExportModel.createSnapshot(snapshotInput());
  assert.equal(first.fingerprint, second.fingerprint);
  source.show.name = 'Mutated outside';
  source.beats[0].info = 'Mutated outside';
  source.prePro.safety.notes = 'Mutated outside';
  source.assignments[0].paperworkLabels.push('Mutated outside');
  source.notes[0].text = 'Mutated outside';
  assert.equal(first.show.name, 'Cueola Stabilization Show');
  assert.equal(first.beats[0].info, 'Second');
  assert.equal(first.prePro.safety.notes, 'Use the marked exit.');
  assert.deepEqual(first.assignments[0].paperworkLabels, ['Call Sheet', 'Full Rendered Rundown']);
  assert.equal(first.notes[1].text, 'Later note');
  assert.throws(() => { first.beats.push({}); }, TypeError);
  const reordered = ExportModel.createSnapshot(snapshotInput({ beats: [...snapshotInput().beats].reverse() }));
  assert.notEqual(first.fingerprint, reordered.fingerprint);
});

test('assignment normalization keeps the newest duplicate revision and never derives identity from a name', () => {
  const old = assignment({ revision: 1, updatedAt: 1000, paperworkIds: ['call-sheet'], paperworkLabels: ['Call Sheet'] });
  const current = assignment({ revision: 2, updatedAt: 2000, paperworkIds: ['rundown'], paperworkLabels: ['Rundown'] });
  const normalized = ExportModel.normalizeAssignments([current, old]);
  assert.equal(normalized.length, 1);
  assert.equal(normalized[0].revision, 2);
  assert.deepEqual(normalized[0].paperworkIds, ['rundown']);
  assert.deepEqual(Object.keys(normalized[0]), [...ExportModel.CANONICAL_ASSIGNMENT_FIELDS]);
  assert.throws(() => ExportModel.normalizeAssignment({
    displayName: 'Same Name Is Not Identity', positionId: 'position_camera', positionLabel: 'Camera',
  }), /missing profileId/);
  assert.throws(() => ExportModel.normalizeAssignment({
    profileId: 'profile_student', displayName: 'Student', positionId: 'position_camera', positionLabel: 'Camera',
  }), /missing productionSession/);
  assert.throws(() => ExportModel.normalizeAssignment({
    productionSession: 'STAB26', profileId: 'profile_student', positionId: 'position_camera', positionLabel: 'Camera',
  }), /missing displayName/);
});

test('multiple roles and paperwork group deterministically by canonical profile identity', () => {
  const records = [
    assignment(),
    assignment({
      assignmentId: 'assignment_producer',
      positionId: 'position_producer', positionLabel: 'Producer',
      paperworkIds: ['rundown', 'safety-plan'],
      paperworkLabels: ['Full Rendered Rundown', 'Safety Plan'],
      updatedAt: 3000,
    }),
  ];
  const groups = ExportModel.groupAssignments(records);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].profileId, 'profile_student_01');
  assert.deepEqual(groups[0].roles.map(role => role.positionLabel), ['Director', 'Producer']);
  assert.deepEqual(groups[0].paperwork.map(item => item.paperworkId), ['call-sheet', 'rundown', 'safety-plan']);
  const rundown = groups[0].paperwork.find(item => item.paperworkId === 'rundown');
  assert.deepEqual(rundown.assignmentIds, ['assignment_director', 'assignment_producer']);
  assert.deepEqual(rundown.positionIds, ['position_director', 'position_producer']);
});

test('profile aliases merge old and current IDs while equal display names never merge unrelated profiles', () => {
  const records = [
    assignment({ profileId: 'profile_current', assignmentId: 'assignment_director' }),
    assignment({
      profileId: 'profile_merged_old', assignmentId: 'assignment_producer',
      positionId: 'position_producer', positionLabel: 'Producer',
    }),
    assignment({
      profileId: 'profile_unrelated', assignmentId: 'assignment_camera',
      positionId: 'position_camera', positionLabel: 'Camera',
      displayName: 'Avery Stone',
    }),
  ];
  const groups = ExportModel.groupAssignments(records, {
    profiles: [{
      profileId: 'profile_current', profileAliases: ['profile_merged_old'],
      displayName: 'Avery Canonical',
    }],
  });
  assert.equal(groups.length, 2);
  const current = groups.find(group => group.profileId === 'profile_current');
  const unrelated = groups.find(group => group.profileId === 'profile_unrelated');
  assert.ok(current);
  assert.ok(unrelated);
  assert.equal(current.displayName, 'Avery Canonical');
  assert.deepEqual(current.identityIds, ['profile_current', 'profile_merged_old']);
  assert.deepEqual(current.roles.map(role => role.positionLabel), ['Director', 'Producer']);
  assert.equal(unrelated.roles.length, 1);
});

test('snapshot refuses a waiting or blocked readiness result unless explicitly used for diagnostics', () => {
  const readiness = ExportModel.assessReadiness({ authority: 'server', rundownPendingCount: 1 });
  assert.throws(() => ExportModel.createSnapshot(snapshotInput({ readiness })), error => {
    assert.equal(error.code, 'export-not-ready');
    assert.equal(error.readiness.status, 'waiting');
    return true;
  });
  const diagnostic = ExportModel.createSnapshot(snapshotInput({ readiness }), { allowUnready: true });
  assert.equal(diagnostic.readiness.status, 'waiting');
  assert.equal(diagnostic.authoritative, false);
});

test('snapshot rejects authority reuse and assignments from a different production', () => {
  const localReadiness = ExportModel.assessReadiness({ authority: 'local' });
  assert.throws(() => ExportModel.createSnapshot(snapshotInput({ readiness: localReadiness })), error => {
    assert.equal(error.code, 'export-authority-mismatch');
    return true;
  });
  assert.throws(() => ExportModel.createSnapshot(snapshotInput({
    assignments: [assignment({ productionSession: 'OTHER26' })],
  })), error => {
    assert.equal(error.code, 'export-assignment-session-mismatch');
    return true;
  });
});

test('revision normalization accepts parent fields, nested prePro/notes, timestamps, and extra tokens', () => {
  const revisions = ExportModel.normalizeRevisions({
    revision: 7,
    updatedAt: { seconds: 9, nanoseconds: 500_000_000 },
    rundownBatchId: 'batch_7',
    rundownUpdatedAt: { toMillis: () => 9100 },
    prePro: { updatedAt: 9200 },
    assignmentRevision: 4,
    assignmentUpdatedAt: 9300,
    notes: { revision: 3, updatedAt: 9400, fingerprint: 'notes_fp' },
    tokens: { z: 2, a: 1 },
  });
  assert.deepEqual(Object.keys(revisions), [...ExportModel.REVISION_FIELDS]);
  assert.equal(revisions.sessionRevision, 7);
  assert.equal(revisions.sessionUpdatedAt, 9500);
  assert.equal(revisions.rundownUpdatedAt, 9100);
  assert.equal(revisions.preProUpdatedAt, 9200);
  assert.equal(revisions.notesRevision, 3);
  assert.equal(revisions.notesFingerprint, 'notes_fp');
  assert.deepEqual(revisions.tokens, { z: 2, a: 1 });
});

test('revision fence comparison is stable across key order and detects every authoritative token change', () => {
  const before = {
    assignmentRevision: 4, rundownBatchId: 'batch', preProUpdatedAt: 50,
    tokens: { notesQuery: 'abc', assignmentQuery: 'def' },
  };
  const same = {
    tokens: { assignmentQuery: 'def', notesQuery: 'abc' },
    preProUpdatedAt: 50, rundownBatchId: 'batch', assignmentRevision: 4,
  };
  const changed = { ...same, assignmentRevision: 5 };
  assert.equal(ExportModel.compareRevisionFence(before, same).stable, true);
  const conflict = ExportModel.compareRevisionFence(before, changed);
  assert.equal(conflict.stable, false);
  assert.notEqual(conflict.beforeFingerprint, conflict.afterFingerprint);
});

test('revision-fenced capture retries a torn read and returns only the stable attempt', async () => {
  const revisions = [
    { assignmentRevision: 1, rundownBatchId: 'a' },
    { assignmentRevision: 2, rundownBatchId: 'b' },
    { assignmentRevision: 2, rundownBatchId: 'b' },
    { assignmentRevision: 2, rundownBatchId: 'b' },
  ];
  let readIndex = 0;
  const result = await ExportModel.captureWithRevisionFence({
    maxAttempts: 3,
    readRevision: async () => revisions[readIndex++],
    readData: async ({ attempt }) => ({ attempt, rows: [`attempt-${attempt}`] }),
  });
  assert.equal(result.attempts, 2);
  assert.deepEqual(result.data, { attempt: 2, rows: ['attempt-2'] });
  assert.equal(result.revisions.assignmentRevision, 2);
  assert.deepEqual(result.history.map(item => item.stable), [false, true]);
  assert.equal(Object.isFrozen(result.data), true);
});

test('revision-fenced capture fails explicitly after bounded conflict retries', async () => {
  let revision = 0;
  await assert.rejects(() => ExportModel.withRevisionFence({
    maxAttempts: 2,
    readRevision: async () => ({ assignmentRevision: revision++ }),
    readData: async ({ attempt }) => ({ attempt }),
  }), error => {
    assert.equal(error.code, 'export-revision-conflict');
    assert.equal(error.attempts, 2);
    assert.equal(error.history.length, 2);
    assert.deepEqual(error.history.map(item => item.stable), [false, false]);
    return true;
  });
});

let passed = 0;
for (const { name, fn } of tests) {
  try {
    await fn();
    passed += 1;
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

console.log(`PASS export model: ${passed}/${tests.length}`);
