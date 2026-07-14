import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const AssignmentModel = require('../../cueola-assignment-model.js');

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

const actor = { assignedBy: 'profile_instructor_01', assignedByLabel: 'Riley Instructor' };

function recordInput(overrides = {}) {
  return {
    productionSession: 'STAB26',
    profileId: 'profile_student_01',
    displayName: 'Alex Student',
    positionId: AssignmentModel.positionIdFor('Director'),
    positionLabel: 'Director',
    paperworkIds: ['call-sheet', 'rundown'],
    paperworkLabels: ['Call Sheet', 'Rundown'],
    status: 'assigned',
    ...actor,
    ...overrides,
  };
}

test('exports the exact canonical record fields and approved statuses', () => {
  assert.deepEqual(Array.from(AssignmentModel.ASSIGNMENT_STATUSES), ['assigned', 'completed']);
  assert.deepEqual(Array.from(AssignmentModel.CANONICAL_ASSIGNMENT_FIELDS), [
    'assignmentId', 'productionSession', 'profileId', 'displayName',
    'positionId', 'positionLabel', 'paperworkIds', 'paperworkLabels',
    'status', 'assignedBy', 'assignedByLabel', 'createdAt', 'updatedAt', 'revision',
  ]);
  const record = AssignmentModel.createAssignmentRecord(recordInput(), null, 1000);
  assert.deepEqual(Object.keys(record), Array.from(AssignmentModel.CANONICAL_ASSIGNMENT_FIELDS));
});

test('legacy profile IDs are deterministic while new IDs are opaque', () => {
  const first = AssignmentModel.profileIdFor('Alex.Student');
  const second = AssignmentModel.profileIdFor('  alex.student  ');
  assert.equal(first, second);
  assert.match(first, /^profile_legacy_/);
  assert.equal(AssignmentModel.profileIdFor({ profileId: 'profile_Canonical_01', username: 'ignored' }), 'profile_canonical_01');
  assert.equal(AssignmentModel.createProfileId('legacy-profile:alex.student'), AssignmentModel.createProfileId('legacy-profile:alex.student'));
  assert.match(AssignmentModel.createProfileId(), /^profile_[a-z0-9_.-]+$/);
});

test('profile aliases survive rename and merge identity lookups', () => {
  const profile = {
    profileId: 'profile_current_01',
    username: 'alex.new',
    profileAliases: ['profile_source_01', 'profile_old_01'],
    previousUsernames: ['alex.old'],
  };
  const ids = AssignmentModel.profileIdentityIds(profile);
  assert.ok(ids.includes('profile_current_01'));
  assert.ok(ids.includes('profile_source_01'));
  assert.ok(ids.includes('profile_old_01'));
  assert.ok(ids.includes(AssignmentModel.profileIdFor('alex.old')));
  assert.ok(ids.includes(AssignmentModel.profileIdFor('alex.new')));
  assert.equal(new Set(ids).size, ids.length);
});

test('position and assignment IDs are stable and distinguish multiple positions', () => {
  const directorA = AssignmentModel.positionIdFor('Director');
  const directorB = AssignmentModel.positionIdFor('  director ');
  const producer = AssignmentModel.positionIdFor('Producer');
  assert.equal(directorA, directorB);
  assert.notEqual(directorA, producer);
  assert.equal(AssignmentModel.positionIdFor({ positionId: directorA, label: 'Renamed label' }), directorA);

  const directorAssignment = AssignmentModel.assignmentIdFor('profile_student_01', directorA);
  assert.equal(directorAssignment, AssignmentModel.assignmentIdFor('profile_student_01', directorB));
  assert.notEqual(directorAssignment, AssignmentModel.assignmentIdFor('profile_student_01', producer));
  assert.notEqual(directorAssignment, AssignmentModel.assignmentIdFor('profile_student_02', directorA));
});

test('create produces a complete record and update preserves creation while incrementing revision', () => {
  const first = AssignmentModel.createAssignmentRecord(recordInput(), null, 1000);
  assert.equal(first.assignmentId, AssignmentModel.assignmentIdFor(first.profileId, first.positionId));
  assert.equal(first.createdAt, 1000);
  assert.equal(first.updatedAt, 1000);
  assert.equal(first.revision, 1);
  assert.equal(first.status, 'assigned');
  assert.deepEqual(first.paperworkIds, ['call-sheet', 'rundown']);
  assert.deepEqual(first.paperworkLabels, ['Call Sheet', 'Rundown']);

  const updated = AssignmentModel.createAssignmentRecord({
    paperworkIds: ['rundown'], paperworkLabels: ['Full Rendered Rundown'],
    status: 'completed', assignedBy: 'profile_instructor_02', assignedByLabel: 'Blair Instructor',
  }, first, 2000);
  assert.equal(updated.assignmentId, first.assignmentId);
  assert.equal(updated.createdAt, 1000);
  assert.equal(updated.updatedAt, 2000);
  assert.equal(updated.revision, 2);
  assert.equal(updated.status, 'completed');
  assert.deepEqual(updated.paperworkIds, ['rundown']);
  assert.deepEqual(updated.paperworkLabels, ['Full Rendered Rundown']);
  assert.equal(updated.assignedBy, 'profile_instructor_02');
});

test('create rejects incomplete records, invalid status, and identity mutation', () => {
  assert.throws(() => AssignmentModel.createAssignmentRecord({ ...recordInput(), displayName: '' }, null, 1000), /displayName is required/);
  const { profileId, ...withoutProfile } = recordInput();
  assert.throws(() => AssignmentModel.createAssignmentRecord(withoutProfile, null, 1000), /profileId is required/);
  const { assignedBy, ...withoutActor } = recordInput();
  assert.throws(() => AssignmentModel.createAssignmentRecord(withoutActor, null, 1000), /assignedBy is required/);
  assert.throws(() => AssignmentModel.createAssignmentRecord({ ...recordInput(), status: 'removed' }, null, 1000), /Unknown assignment status/);
  const prior = AssignmentModel.createAssignmentRecord(recordInput(), null, 1000);
  assert.throws(() => AssignmentModel.createAssignmentRecord({ positionId: AssignmentModel.positionIdFor('Producer') }, prior, 2000), /identity fields are immutable/);
});

test('normalizes legacy assignment aliases into the canonical shape', () => {
  const normalized = AssignmentModel.normalizeAssignmentRecord({
    code: 'stab26',
    username: 'alex.student',
    name: ' Alex   Student ',
    role: 'Director',
    paperwork: 'Call Sheet / Production Scheduler / Safety Plan',
    assignedAt: { seconds: 2, nanoseconds: 500000000 },
    createdBy: 'Legacy Instructor',
  });
  assert.deepEqual(Object.keys(normalized), Array.from(AssignmentModel.CANONICAL_ASSIGNMENT_FIELDS));
  assert.equal(normalized.productionSession, 'STAB26');
  assert.equal(normalized.profileId, AssignmentModel.profileIdFor('alex.student'));
  assert.equal(normalized.displayName, 'Alex Student');
  assert.equal(normalized.positionId, AssignmentModel.positionIdFor('Director'));
  assert.deepEqual(normalized.paperworkIds, ['call-sheet', 'production-scheduler', 'safety-plan']);
  assert.deepEqual(normalized.paperworkLabels, ['Call Sheet', 'Production Scheduler', 'Safety Plan']);
  assert.equal(normalized.createdAt, 2500);
  assert.equal(normalized.updatedAt, 2500);
  assert.equal(normalized.revision, 1);
  assert.equal(normalized.status, 'assigned');
  assert.equal(normalized.assignedBy, 'legacy_instructor');
  assert.equal(normalized.assignedByLabel, 'Legacy Instructor');
});

test('legacy combined Patch Sheets expands to both stable paperwork IDs', () => {
  const normalized = AssignmentModel.normalizeAssignmentRecord({
    sessionCode: 'STAB26', username: 'alex.student', person: 'Alex Student',
    role: 'ENG Lead', paperwork: 'Patch Sheets / Tech Checklist',
  });
  assert.deepEqual(normalized.paperworkIds, ['video-patch', 'audio-comms-patch', 'tech-checklist']);
  assert.deepEqual(normalized.paperworkLabels, ['Video Patch Sheet', 'Audio & Comms Patch Sheet', 'Tech Checklist']);
});

test('serializes a canonical record with a lossless JSON round trip', () => {
  const record = AssignmentModel.createAssignmentRecord(recordInput(), null, 1234);
  const encoded = AssignmentModel.serializeAssignmentRecord(record);
  assert.equal(typeof encoded, 'string');
  assert.deepEqual(AssignmentModel.deserializeAssignmentRecord(encoded), record);
  assert.deepEqual(AssignmentModel.deserializeAssignmentRecord(JSON.parse(encoded)), record);
});

test('assignmentsForProfile returns multiple records across canonical and alias IDs', () => {
  const director = AssignmentModel.createAssignmentRecord(recordInput({
    profileId: 'profile_current_01', positionLabel: 'Director',
    positionId: AssignmentModel.positionIdFor('Director'),
  }), null, 1000);
  const producer = AssignmentModel.createAssignmentRecord(recordInput({
    profileId: 'profile_source_01', positionLabel: 'Producer',
    positionId: AssignmentModel.positionIdFor('Producer'),
  }), null, 1100);
  const unrelated = AssignmentModel.createAssignmentRecord(recordInput({
    profileId: 'profile_other_01', displayName: 'Other Student',
  }), null, 1200);
  const newerDirector = { ...director, paperworkIds: ['rundown'], paperworkLabels: ['Rundown'], revision: 2, updatedAt: 1300 };
  const found = AssignmentModel.assignmentsForProfile(
    [director, producer, unrelated, newerDirector],
    { profileId: 'profile_current_01', profileAliases: ['profile_source_01'] },
  );
  assert.equal(found.length, 2);
  assert.deepEqual(found.map(row => row.positionLabel), ['Director', 'Producer']);
  assert.equal(found[0].revision, 2);
});

test('compatibility projection preserves old person, position, and paperwork fields', () => {
  const director = AssignmentModel.createAssignmentRecord(recordInput(), null, 1000);
  const producer = AssignmentModel.createAssignmentRecord(recordInput({
    positionId: AssignmentModel.positionIdFor('Producer'), positionLabel: 'Producer',
    paperworkIds: [], paperworkLabels: [],
  }), null, 1100);
  assert.deepEqual(AssignmentModel.compatibilityRows([director, producer]), [
    { person: 'Alex Student', position: 'Director', paperwork: ['Call Sheet', 'Rundown'] },
    { person: 'Alex Student', position: 'Producer', paperwork: [] },
  ]);
});

test('revision conflict detection handles create, delete, replacement, and stale update', () => {
  const first = AssignmentModel.createAssignmentRecord(recordInput(), null, 1000);
  const second = AssignmentModel.createAssignmentRecord({ ...actor }, first, 2000);
  assert.equal(AssignmentModel.hasRevisionConflict(null, null), false);
  assert.equal(AssignmentModel.hasRevisionConflict(null, first), true);
  assert.equal(AssignmentModel.hasRevisionConflict(first, null), true);
  assert.equal(AssignmentModel.hasRevisionConflict(first, { ...first }), false);
  assert.equal(AssignmentModel.hasRevisionConflict(first, second), true);
  assert.equal(AssignmentModel.hasRevisionConflict(1, 1), false);
  assert.equal(AssignmentModel.hasRevisionConflict(1, 2), true);
  assert.equal(AssignmentModel.hasRevisionConflict(first, { ...first, assignmentId: 'assignment_other' }), true);
});

test('normalization and compatibility projection do not mutate caller data', () => {
  const source = {
    productionSession: 'STAB26', profileId: 'profile_student_01', displayName: 'Alex',
    positionLabel: 'Director', paperworkLabels: ['Call Sheet'], paperworkIds: ['call-sheet'],
    status: 'assigned', ...actor, createdAt: 1, updatedAt: 1, revision: 1,
  };
  const before = JSON.stringify(source);
  AssignmentModel.normalizeAssignmentRecord(source);
  AssignmentModel.compatibilityRows([source]);
  assert.equal(JSON.stringify(source), before);
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

console.log(`PASS assignment model: ${passed}/${tests.length}`);
