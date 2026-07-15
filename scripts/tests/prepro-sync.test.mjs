import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Sync = require('../../cueola-prepro-sync.js');

const T0 = 1_000_000;

function docWith(overrides = {}) {
  return { updatedAt: T0, _stamps: {}, ...overrides };
}

// Simulate one client's local edit: apply to doc, record stamps like the app would.
function edit(doc, mutate, at) {
  const prev = JSON.parse(JSON.stringify(doc));
  mutate(doc);
  const diff = Sync.diffLeaves(prev, doc, at);
  for (const [dotted, stamp] of Object.entries(diff.stampWrites)) {
    const path = dotted.replace(/^_stamps\./, '').split('.');
    setStamp(doc, path, stamp);
  }
  doc.updatedAt = at;
  return diff;
}

function setStamp(doc, path, stamp) {
  doc._stamps = doc._stamps || {};
  let cur = doc._stamps;
  for (let i = 0; i < path.length - 1; i++) {
    if (typeof cur[path[i]] !== 'object' || cur[path[i]] === null) cur[path[i]] = {};
    cur = cur[path[i]];
  }
  cur[path[path.length - 1]] = stamp;
}

test('rowsToMap/rowsToList round-trip preserves order and ids', () => {
  const map = Sync.rowsToMap([{ name: 'A' }, { name: 'B' }, { name: 'C' }], { rng: () => 0.5 });
  const list = Sync.rowsToList(map);
  assert.equal(list.length, 3);
  assert.deepEqual(list.map(r => r.name), ['A', 'B', 'C']);
  assert.ok(list.every(r => /^r_[a-z0-9]+$/.test(r.id)));
  const uniqueIds = new Set(list.map(r => r.id));
  assert.equal(uniqueIds.size, 3);
});

test('two writers editing different scalar fields of the same section both survive', () => {
  const base = docWith({ safety: { hospital: '', fire: '' } });
  const a = JSON.parse(JSON.stringify(base));
  const b = JSON.parse(JSON.stringify(base));
  edit(a, d => { d.safety.hospital = 'Mercy General'; }, T0 + 10);
  edit(b, d => { d.safety.fire = 'Station 4'; }, T0 + 20);
  // A receives B's doc (as server) and vice versa
  const mergedA = Sync.mergeDocs(a, b).merged;
  const mergedB = Sync.mergeDocs(b, a).merged;
  for (const m of [mergedA, mergedB]) {
    assert.equal(m.safety.hospital, 'Mercy General');
    assert.equal(m.safety.fire, 'Station 4');
  }
});

test('two writers editing different rows of the same grid both survive', () => {
  const people = Sync.rowsToMap([{ name: 'Ada' }, { name: 'Grace' }]);
  const [r1, r2] = Object.keys(people);
  const base = docWith({ people });
  const a = JSON.parse(JSON.stringify(base));
  const b = JSON.parse(JSON.stringify(base));
  edit(a, d => { d.people[r1].name = 'Ada Lovelace'; }, T0 + 10);
  edit(b, d => { d.people[r2].phone = '555-0100'; }, T0 + 20);
  const merged = Sync.mergeDocs(a, b).merged;
  assert.equal(merged.people[r1].name, 'Ada Lovelace');
  assert.equal(merged.people[r2].phone, '555-0100');
  assert.equal(merged.people[r2].name, 'Grace');
});

test('same leaf conflict: newer stamp wins in both directions', () => {
  const base = docWith({ safety: { hospital: 'Old' } });
  const older = JSON.parse(JSON.stringify(base));
  const newer = JSON.parse(JSON.stringify(base));
  edit(older, d => { d.safety.hospital = 'A'; }, T0 + 10);
  edit(newer, d => { d.safety.hospital = 'B'; }, T0 + 99);
  assert.equal(Sync.mergeDocs(older, newer).merged.safety.hospital, 'B');
  assert.equal(Sync.mergeDocs(newer, older).merged.safety.hospital, 'B');
});

test('row delete beats concurrent stale edit; newer edit survives vs older tombstone via recovery', () => {
  const people = Sync.rowsToMap([{ name: 'Ada' }]);
  const rid = Object.keys(people)[0];
  const base = docWith({ people });
  const deleter = JSON.parse(JSON.stringify(base));
  const editor = JSON.parse(JSON.stringify(base));
  edit(editor, d => { d.people[rid].name = 'Stale edit'; }, T0 + 10);
  edit(deleter, d => { delete d.people[rid]; }, T0 + 50);
  // editor receives deleter's doc: tombstone (T0+50) newer than edit (T0+10) → row gone
  const merged = Sync.mergeDocs(editor, deleter).merged;
  assert.equal(merged.people[rid], undefined);
  // reverse direction: deleter receives editor's stale row — must NOT resurrect
  const merged2 = Sync.mergeDocs(deleter, editor).merged;
  assert.equal(merged2.people[rid], undefined);
});

test('reorder touches only ord; concurrent field edit on moved row survives', () => {
  const people = Sync.rowsToMap([{ name: 'A' }, { name: 'B' }, { name: 'C' }]);
  const ids = Sync.rowsToList(people).map(r => r.id);
  const base = docWith({ people });
  const mover = JSON.parse(JSON.stringify(base));
  const editor = JSON.parse(JSON.stringify(base));
  // move C between A and B
  const diff = edit(mover, d => {
    d.people[ids[2]].ord = Sync.ordBetween(d.people[ids[0]].ord, d.people[ids[1]].ord);
  }, T0 + 10);
  assert.deepEqual(Object.keys(diff.updates), [`people.${ids[2]}.ord`]);
  edit(editor, d => { d.people[ids[2]].name = 'C-prime'; }, T0 + 20);
  const merged = Sync.mergeDocs(editor, mover).merged;
  const order = Sync.rowsToList(merged.people).map(r => r.name);
  assert.deepEqual(order, ['A', 'C-prime', 'B']);
});

test('legacy interop: server doc with arrays + section-level _fieldUpdatedAt merges correctly', () => {
  const local = docWith({ safety: { hospital: 'Local General' } });
  edit(local, d => { d.safety.hospital = 'Local General 2'; }, T0 + 100);
  const legacyServer = {
    updatedAt: T0 + 50,
    safety: { hospital: 'Server General', fire: 'Station 9' },
    people: [{ name: 'Legacy Crew' }],
    _fieldUpdatedAt: { safety: T0 + 50, people: T0 + 50 },
  };
  const merged = Sync.mergeDocs(local, legacyServer).merged;
  // local leaf is newer (T0+100 > T0+50) → survives
  assert.equal(merged.safety.hospital, 'Local General 2');
  // server-only leaf arrives
  assert.equal(merged.safety.fire, 'Station 9');
  // legacy array converts to map shape
  assert.equal(Sync.rowsToList(merged.people)[0].name, 'Legacy Crew');
});

test('pending-path protection: in-flight local write never reverted by newer server stamp', () => {
  const base = docWith({ safety: { hospital: 'X' } });
  const local = JSON.parse(JSON.stringify(base));
  const server = JSON.parse(JSON.stringify(base));
  edit(local, d => { d.safety.hospital = 'Mine, in flight'; }, T0 + 10);
  edit(server, d => { d.safety.hospital = 'Server, newer'; }, T0 + 999);
  const pending = new Set(['safety.hospital']);
  const merged = Sync.mergeDocs(local, server, { pendingPaths: pending }).merged;
  assert.equal(merged.safety.hospital, 'Mine, in flight');
});

test('diffLeaves emits masked updates + stamps; buildFirestoreUpdates prefixes and deletes', () => {
  const prev = docWith({ safety: { hospital: 'A' }, people: Sync.rowsToMap([{ name: 'Ada' }]) });
  const rid = Object.keys(prev.people)[0];
  const next = JSON.parse(JSON.stringify(prev));
  next.safety.hospital = 'B';
  delete next.people[rid];
  const diff = Sync.diffLeaves(prev, next, T0 + 5);
  assert.deepEqual(diff.updates, { 'safety.hospital': 'B' });
  assert.deepEqual(diff.deletePaths, [`people.${rid}`]);
  const DELETE = Symbol('deleteField');
  const updates = Sync.buildFirestoreUpdates(diff, { base: 'prePro', now: T0 + 5, deleteField: DELETE });
  assert.equal(updates['prePro.safety.hospital'], 'B');
  assert.equal(updates[`prePro.people.${rid}`], DELETE);
  assert.equal(updates['prePro.updatedAt'], T0 + 5);
  assert.equal(updates['prePro._stamps.safety.hospital'], T0 + 5);
  assert.deepEqual(updates[`prePro._stamps.people.${rid}`], { [Sync.DEL]: T0 + 5 });
});

test('callSheets nested crew: per-sheet people rows merge independently', () => {
  const sheets = Sync.rowsToMap([{ label: 'Day 1', people: [] }, { label: 'Day 2', people: [] }]);
  const [s1, s2] = Object.keys(sheets);
  sheets[s1].people = Sync.rowsToMap([{ name: 'Crew A' }]);
  sheets[s2].people = Sync.rowsToMap([{ name: 'Crew B' }]);
  const base = docWith({ callSheets: sheets });
  const a = JSON.parse(JSON.stringify(base));
  const b = JSON.parse(JSON.stringify(base));
  const crewA = Object.keys(a.callSheets[s1].people)[0];
  const crewB = Object.keys(b.callSheets[s2].people)[0];
  edit(a, d => { d.callSheets[s1].people[crewA].call = '17:00'; }, T0 + 10);
  edit(b, d => { d.callSheets[s2].people[crewB].call = '18:30'; }, T0 + 20);
  const merged = Sync.mergeDocs(a, b).merged;
  assert.equal(merged.callSheets[s1].people[crewA].call, '17:00');
  assert.equal(merged.callSheets[s2].people[crewB].call, '18:30');
});

test('legacy dotted/hyphenated row ids key deterministically with no churn', () => {
  const sheets = [{ id: 'call_sheet.day-1', label: 'Day 1' }];
  const map1 = Sync.rowsToMap(sheets);
  const map2 = Sync.rowsToMap(JSON.parse(JSON.stringify(sheets)));
  const key = Object.keys(map1)[0];
  assert.deepEqual(Object.keys(map2), [key]);            // deterministic key
  assert.match(key, /^[A-Za-z_][A-Za-z0-9_]*$/);         // field-path safe
  assert.equal(map1[key].id, 'call_sheet.day-1');        // original id preserved
  assert.equal(Sync.rowsToList(map1)[0].id, 'call_sheet.day-1');
  // diff between two saves of the same unchanged sheet = no changes
  const d = Sync.diffLeaves({ callSheets: map1 }, { callSheets: map2 }, 5);
  assert.deepEqual(d.changedPaths, []);
});

test('sanitizeKey produces identifier-safe Firestore path segments', () => {
  assert.match(Sync.sanitizeKey('sp-hospital.name'), /^[A-Za-z_][A-Za-z0-9_]*$/);
  assert.match(Sync.sanitizeKey('9lives'), /^[A-Za-z_]/);
  assert.match(Sync.sanitizeKey(''), /^[A-Za-z_]/);
});

test('tombstone GC removes only expired tombstones', () => {
  const people = Sync.rowsToMap([{ name: 'Ada' }, { name: 'Grace' }]);
  const [r1, r2] = Object.keys(people);
  const doc = docWith({ people });
  edit(doc, d => { delete d.people[r1]; }, T0 + 10);
  edit(doc, d => { delete d.people[r2]; }, T0 + 20);
  const WEEK = 7 * 24 * 60 * 60 * 1000;
  const removed = Sync.gcTombstones(doc, T0 + 15 + WEEK, WEEK);
  assert.equal(removed, 1); // r1 expired, r2 not yet
});
