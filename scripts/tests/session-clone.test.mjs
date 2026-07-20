// v2.1 Phase 6 (D5): Start Next Episode — whitelist-carry contract.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Clone = require('../../cueola-session-clone.js');

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

const source = {
  code: 'RULES1', showName: 'Campus News Ep 12', startTime: '19:00', freeMode: false,
  requireLoginCode: true, activeIdx: 26, status: 'active',
  beats: [{ id: 1, style: 'timed', info: 'Open', min: 1, sec: 30, cues: { video: { on: 'CAM 1' } } }],
  cues: [{ id: 'c1' }], rundownAliases: { Cam1: 'CAM 1' }, customSources: { video: ['CAM 9'] },
  groups: [{ id: 'g1', name: 'Group 1' }], groupsLocked: true,
  participants: [{ name: 'Alex' }], presence: { p1: { name: 'Alex' } },
  showClock: { mode: 'run' }, prompter: { text: 'SECRET SCRIPT' },
  outrangutan: { live: { status: 'playing' } },
  preProNotes: [{ id: 'n1' }], preProActivity: Array.from({ length: 300 }, (_, i) => ({ at: i })),
  roleAssignments: [{ person: 'Alex' }], assignments: { Alex: 'Camera' }, assignmentRevision: 9,
  deletedAt: 5, movedTo: 'X', forceCmd: { x: 1 }, rundownBatchId: 'b9',
  prePro: {
    production: 'Campus News', paperworkEnabled: { video_patch: false },
    callSheets: [{ id: 'cs_old', label: 'Show Night', date: '2026-07-17', call: '17:00',
      weather: { line: 'Sunny' }, people: [{ name: 'Alex', position: 'Camera', call: '17:00' }] }],
    callSheetTombstones: { cs_dead: 123 },
    productionSchedule: { call: '17:00' }, safety: { hospital: 'Mercy' },
    videoPatchRows: [{ label: 'CAM 1' }], 'audio-commsPatchRows': [{ position: 'SC' }],
    preProNotes: [{ id: 'nested' }], _fieldUpdatedAt: { production: 1 },
  },
};

test('carries structure, strips episode data', () => {
  const seed = Clone.buildEpisodeSeed(source, { code: '2608AB', name: 'Campus News Ep 13', createdBy: 'Jon', ownerUid: 'uid1', now: 999 });
  assert.equal(seed.code, '2608AB');
  assert.equal(seed.showName, 'Campus News Ep 13');
  assert.equal(seed.clonedFrom, 'RULES1');
  assert.equal(seed.ownerUid, 'uid1');
  assert.deepEqual(seed.beats, source.beats);
  assert.deepEqual(seed.groups, source.groups);
  assert.equal(seed.groupsLocked, true);
  assert.equal(seed.requireLoginCode, true);
  assert.equal(seed.activeIdx, 0);
  assert.equal(seed.status, 'idle');
  assert.deepEqual(seed.participants, []);
  for (const gone of ['presence', 'showClock', 'prompter', 'outrangutan', 'preProNotes',
    'preProActivity', 'roleAssignments', 'assignments', 'assignmentRevision', 'deletedAt',
    'movedTo', 'forceCmd', 'rundownBatchId']) {
    assert.equal(seed[gone], undefined, gone + ' must be stripped');
  }
});

test('call sheets scrub dates/weather/ids but keep times and crew', () => {
  const seed = Clone.buildEpisodeSeed(source, { code: '2608AB', now: 999 });
  const sheet = seed.prePro.callSheets[0];
  assert.equal(sheet.date, '');
  assert.equal(sheet.weather, null);
  assert.equal(sheet.id, 'call_sheet_1');
  assert.equal(sheet.call, '17:00');
  assert.deepEqual(sheet.people, source.prePro.callSheets[0].people);
  assert.equal(seed.prePro.callSheetTombstones, undefined, 'old tombstones must not carry');
  assert.deepEqual(seed.prePro.paperworkEnabled, { video_patch: false });
  assert.equal(seed.prePro.preProNotes, undefined, 'nested notes must not carry');
  assert.equal(seed.prePro._fieldUpdatedAt.callSheets, 999, 'fresh per-field stamps');
  assert.equal(seed.call, '17:00', 'legacy top-level re-spread');
  assert.equal(seed.date, '', 'legacy date blanked');
});

test('group subdocs carry their own structure with fresh stamps', () => {
  const groupDoc = { prePro: { callSheets: [{ id: 'g_cs', label: 'G1 sheet', date: '2026-07-17', people: [] }],
    safety: { hospital: 'Mercy' }, preProActivity: [{ at: 1 }] }, presence: { x: 1 } };
  const fresh = Clone.seedGroupDoc(groupDoc, 555);
  assert.equal(fresh.prePro.callSheets[0].date, '');
  assert.equal(fresh.prePro.callSheets[0].id, 'call_sheet_1');
  assert.deepEqual(fresh.prePro.safety, { hospital: 'Mercy' });
  assert.equal(fresh.prePro.preProActivity, undefined);
  assert.equal(fresh.presence, undefined);
  assert.equal(fresh.updatedAt, 555);
  assert.equal(fresh.prePro._fieldUpdatedAt.safety, 555);
});

test('episode names increment', () => {
  assert.equal(Clone.nextEpisodeName('Campus News Ep 12'), 'Campus News Ep 13');
  assert.equal(Clone.nextEpisodeName('Show 09'), 'Show 10');
  assert.equal(Clone.nextEpisodeName('Pilot'), 'Pilot 2');
  assert.equal(Clone.nextEpisodeName(''), 'Next Episode');
});

test('episode codes are YYMM + two no-I/O letters', () => {
  const code = Clone.generateEpisodeCode(new Date(2026, 7, 3), () => 0.5);
  assert.match(code, /^2608[A-HJ-NP-Z]{2}$/);
  assert.equal(Clone.CODE_ALPHABET.length, 24);
  assert.ok(!Clone.CODE_ALPHABET.includes('I') && !Clone.CODE_ALPHABET.includes('O'));
});

let passed = 0;
console.log('session clone contract');
for (const { name, fn } of tests) {
  fn();
  passed += 1;
  console.log('  ✓ ' + name);
}
console.log(`\nAll ${passed} session clone tests passed.`);
