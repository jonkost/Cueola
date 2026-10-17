import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const G = require('../../cueola-grading-model.js');

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

// A fixed local moment: Oct 17 2026, 09:05 local time.
const T = new Date(2026, 9, 17, 9, 5, 30).getTime();

test('day keys and minutes are local and identifier-safe', () => {
  assert.equal(G.dayKey(T), 'd20261017');
  assert.equal(G.minuteOfDay(T), 9 * 60 + 5);
  assert.equal(G.dayKeyToDate('d20261017').getDate(), 17);
  assert.equal(G.dayKeyToDate('2026-10-17'), null);
  assert.equal(G.tickTime('d20261017', 545), new Date(2026, 9, 17, 9, 5).getTime());
  assert.equal(G.safeKey('call-sheet'), 'call_sheet');
  assert.equal(G.safeKey('9lives'), 'k_9lives');
});

test('the record id is the profile id, or a slug of the name', () => {
  assert.equal(G.docId({ profileId: 'profile_ab12', name: 'Ada' }), 'profile_ab12');
  assert.equal(G.docId({ name: '  Ada   Lovelace ' }), 'n_ada-lovelace');
  assert.equal(G.docId({}), 'n_someone');
  assert.match(G.docId({ profileId: 'weird/id with spaces' }), /^[A-Za-z0-9_.-]{1,160}$/);
});

test('sittings split on quiet gaps and count each minute once', () => {
  const s = G.sittings([540, 541, 541, 542, 560, 575, 1439, 0]);
  assert.deepEqual(s, [
    { from: 0, to: 1, minutes: 1 },
    { from: 540, to: 543, minutes: 3 },
    { from: 560, to: 561, minutes: 1 },   // 18 minutes after 542: a new sitting
    { from: 575, to: 576, minutes: 1 },   // 15 minutes later: new again
    { from: 1439, to: 1440, minutes: 1 },
  ]);
  assert.deepEqual(G.sittings([]), []);
});

test('summarizeDays gives first, last, minutes and where per day', () => {
  const days = G.summarizeDays({
    d20261017: { ticks: [545, 546, 547, 600], where: { pb_call_sheet: 3, rundown: 1 } },
    d20261016: { ticks: [700], where: {} },
    bogus: { ticks: [1] },
  });
  assert.equal(days.length, 2);
  assert.equal(days[0].key, 'd20261016');
  assert.equal(days[1].minutes, 4);
  assert.equal(days[1].first, new Date(2026, 9, 17, 9, 5).getTime());
  assert.equal(days[1].last, new Date(2026, 9, 17, 10, 1).getTime());
  assert.equal(days[1].sittings.length, 2);
  assert.deepEqual(days[1].where.map(w => w.label), ['Call Sheet', 'Rundown']);
});

test('describeField turns an input into the words a grader reads', () => {
  assert.equal(G.describeField({ label: 'Production' }), 'Production');
  assert.equal(G.describeField({ callField: 'name', rowIndex: 2 }), 'Crew row 3: Name');
  assert.equal(G.describeField({ callField: 'call', rowIndex: 0 }), 'Crew row 1: Call time');
  assert.equal(G.describeField({ patchField: 'source', patchKind: 'video', rowIndex: 4 }), 'Video row 5: Source');
  assert.equal(G.describeField({ patchField: 'gear', patchKind: 'comms', rowIndex: 0 }), 'Comms row 1: Gear');
  assert.equal(G.describeField({ patchField: 'id', patchKind: 'video', rowIndex: 0 }), '');
  assert.equal(G.describeField({ psField: 'item', rowIndex: 1 }), 'Ready list row 2');
  assert.equal(G.describeField({ psField: 'done', rowIndex: 1 }), 'Ready list row 2: Ready check');
  assert.equal(G.describeField({ psField: 'doneBy', rowIndex: 1 }), '');
  assert.equal(G.describeField({ spPpe: 1 }), 'PPE item 2');
  assert.equal(G.describeField({ id: 'pp-plot-canvas' }), 'Stage plot drawing');
  assert.equal(G.describeField({ id: 'pp-show-start' }), 'Show start');
  assert.equal(G.describeField({ id: 'sp-hospital-address', placeholder: 'e.g. 1200 Health Way' }), 'Hospital address');
  assert.equal(G.describeField({ ariaLabel: 'Video row 1 label' }), 'Video row 1 label');
  assert.equal(G.describeField({}), '');
});

test('rundownChangeLabels names rows and cells', () => {
  const after = [{ id: 1, info: 'Open' }, { id: 2, info: 'Weather' }, { id: 3, info: '' }];
  const before = [{ id: 1, info: 'Open' }, { id: 9, info: 'Old row' }];
  const labels = G.rundownChangeLabels({
    additions: [{ id: 2, info: 'Weather' }],
    patches: [
      { id: 1, patch: { info: 'Open', cues: { video: {}, audio: {} }, min: 1, sec: 30, _createdAt: 1 } },
      { id: 3, patch: { cues: { script: {} } } },
    ],
    removals: [9],
    order: [1, 2, 3],
    showPatch: { showName: 'X', startTime: '19:00' },
  }, after, before);
  assert.deepEqual(labels, [
    'Added Row 2 "Weather"',
    'Row 1 "Open": Row name, Video cue, Audio cue, Timing',
    'Row 3: Script cue',
    'Removed Row 2 "Old row"',
    'Moved rows',
    'Show name',
    'Show start time',
  ]);
  assert.deepEqual(G.rundownChangeLabels(null, [], []), []);
});

test('mergePending folds touches into one entry per page', () => {
  let p = G.mergePending(null, { kind: 'paperwork', section: 'Call Sheet', page: 'call-sheet', fields: ['Production'], at: 1000 });
  p = G.mergePending(p, { kind: 'paperwork', section: 'Call Sheet', fields: ['Shoot Date', 'Production'], at: 2000 });
  assert.deepEqual(p.fields, ['Production', 'Shoot Date']);
  assert.equal(p.at, 2000);
  assert.equal(p.firstAt, 1000);
  assert.equal(p.n, 2);
  const e = G.entryFromPending(p);
  assert.equal(e.kind, 'paperwork');
  assert.equal(e.section, 'Call Sheet');
  assert.equal(e.n, 2);
  const many = G.mergePending(null, { kind: 'rundown', section: 'Rundown', at: 1, fields: Array.from({ length: 60 }, (_, i) => 'Row ' + i) });
  assert.equal(many.fields.length, G.FIELDS_PER_ENTRY);
});

test('trimEntries keeps the newest when the record is full', () => {
  const entries = Array.from({ length: 520 }, (_, i) => ({ at: i + 1, kind: 'paperwork', section: 'S' }));
  const r = G.trimEntries(entries);
  assert.equal(r.trimmed, 70);
  assert.equal(r.entries.length, 450);
  assert.equal(r.entries[0].at, 71);
  assert.equal(G.trimEntries(entries.slice(0, 10)).trimmed, 0);
});

test('log and note entries belong to the named person only', () => {
  const log = [
    { section: 'Call Sheet', by: 'Ada Lovelace', at: 5000, fields: ['Production'] },
    { section: 'Safety Plan', by: 'ada  lovelace', at: 6000 },
    { section: 'Production Note', by: 'Ada Lovelace', at: 7000 },
    { section: 'Call Sheet', by: 'Grace', at: 8000 },
  ];
  const mine = G.entriesFromActivityLog(log, 'Ada Lovelace');
  assert.deepEqual(mine.map(e => e.section), ['Call Sheet', 'Safety Plan']);
  assert.deepEqual(mine[0].fields, ['Production']);
  assert.equal(mine[0].source, 'log');

  const notes = [
    { id: 'a', by: 'Ada Lovelace', at: 100, text: 'First post', tag: 'general' },
    { id: 'b', by: 'Grace', at: 200, text: 'Reply me', tag: 'general' },
    { id: 'c', by: 'Ada Lovelace', at: 300, text: 'Yes', tag: 'general', replyTo: 'b' },
    { id: 'd', by: 'Grace', at: 400, text: 'Bring cables', tag: 'todo', done: true, doneBy: 'Ada Lovelace', doneAt: 500 },
    { id: 'e', by: 'Grace', at: 600, text: 'Checks', tag: 'general', checklist: [
      { text: 'Mic check', done: true, doneBy: 'Ada Lovelace', doneAt: 700 },
      { text: 'Lights', done: true, doneBy: 'Grace', doneAt: 800 },
    ] },
    { id: 'f', by: 'Ada Lovelace', at: 900, text: 'Buy tape', tag: 'todo' },
  ];
  const n = G.entriesFromNotes(notes, 'Ada Lovelace').sort((a, b) => a.at - b.at);
  assert.deepEqual(n.map(e => e.kind), ['note', 'reply', 'todo-done', 'checklist', 'todo']);
  assert.deepEqual(n[1].fields, ['Reply to Grace']);
  assert.equal(n[2].text, 'Bring cables');
  assert.equal(n[3].text, 'Mic check');
});

test('mergeTimeline drops what the record already covers', () => {
  const record = [
    { at: 10000, kind: 'paperwork', section: 'Call Sheet', fields: ['Production', 'Shoot Date'] },
    { at: 50000, kind: 'note', section: 'Production Notes', text: 'Hi' },
  ];
  const log = [
    { at: 11000, kind: 'paperwork', section: 'Call Sheet', source: 'log' },   // covered by the record
    { at: 400000, kind: 'paperwork', section: 'Safety Plan', source: 'log' }, // not covered
  ];
  const notes = [
    { at: 50500, kind: 'note', section: 'Production Notes', text: 'Hi', source: 'notes' }, // same note, richer source wins once
    { at: 90000, kind: 'reply', section: 'Production Notes', text: 'Yo', source: 'notes' },
  ];
  const t = G.mergeTimeline(record, log, notes);
  assert.deepEqual(t.map(e => [e.kind, e.section, e.at]), [
    ['paperwork', 'Safety Plan', 400000],
    ['reply', 'Production Notes', 90000],
    ['note', 'Production Notes', 50500],
    ['paperwork', 'Call Sheet', 10000],
  ]);
  const grouped = G.groupByDay(t);
  assert.ok(grouped.length >= 1);
  assert.equal(grouped.reduce((n, g) => n + g.entries.length, 0), 4);
});

test('summary counts minutes, fields, notes and to-dos', () => {
  const timeline = [
    { at: 1, kind: 'paperwork', section: 'Call Sheet', fields: ['Production', 'Shoot Date'] },
    { at: 2, kind: 'paperwork', section: 'Call Sheet', fields: ['Production'] },
    { at: 3, kind: 'paperwork', section: 'Safety Plan', fields: ['PPE item 1'] },
    { at: 4, kind: 'rundown', section: 'Rundown', fields: ['Row 1 "Open": Video cue', 'Added Row 2'] },
    { at: 5, kind: 'live', section: 'Live', fields: ['TAKE Row 1', 'TAKE Row 2', 'TAKE Row 3'] },
    { at: 6, kind: 'note' }, { at: 7, kind: 'reply' }, { at: 8, kind: 'todo-done' }, { at: 9, kind: 'checklist' }, { at: 10, kind: 'todo' },
  ].map(G.normalizeEntry);
  const s = G.summary(timeline, { d20261017: { ticks: [1, 2, 3] }, d20261016: { ticks: [] } });
  assert.equal(s.minutes, 3);
  assert.equal(s.daysActive, 1);
  assert.equal(s.fieldsTouched, 3);
  assert.equal(s.rundownChanges, 2);
  assert.equal(s.takes, 3);
  assert.equal(s.notes, 1);
  assert.equal(s.replies, 1);
  assert.equal(s.todosDone, 1);
  assert.equal(s.checklistDone, 1);
  assert.equal(s.todosPosted, 1);
  assert.equal(G.formatMinutes(0), '0 min');
  assert.equal(G.formatMinutes(59), '59 min');
  assert.equal(G.formatMinutes(125), '2 h 5 min');
  assert.equal(G.kindLabel('todo-done'), 'To-do done');
});

test('normalizeRecord drops junk and keeps the shape', () => {
  const rec = G.normalizeRecord({
    name: 'Ada', profileId: 'p1', role: 'student', updatedAt: 5,
    days: { d20261017: { ticks: [3, 3, 'x', 2000, -1, 10], where: { 'call-sheet': 2, bad: 'no' } }, nope: {} },
    entries: [{ at: 1, kind: 'paperwork', section: 'S', fields: ['a', null, 'b'] }, { kind: 'x' }, 'junk'],
  });
  assert.deepEqual(rec.days.d20261017.ticks, [3, 10]);
  assert.deepEqual(rec.days.d20261017.where, { call_sheet: 2 });
  assert.equal(rec.entries.length, 1);
  assert.deepEqual(rec.entries[0].fields, ['a', 'b']);
  assert.equal(rec.role, 'student');
});

let failed = 0;
for (const { name, fn } of tests) {
  try { await fn(); console.log(`ok - ${name}`); }
  catch (err) { failed++; console.log(`not ok - ${name}\n${err.stack || err}`); }
}
console.log(`\n${tests.length - failed}/${tests.length} passed`);
process.exit(failed ? 1 : 0);
