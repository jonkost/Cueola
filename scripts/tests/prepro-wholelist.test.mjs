// Planda Bear saves whole lists again (field-level saves are off until the
// one-time move to the new list shape exists). These tests run the real
// save and merge functions from cueola-app.js, and the real sync engine,
// against a pretend cloud that follows Firestore's rule for field saves:
// saving "a.b.c" into a spot where "a.b" is a list REPLACES the list with a
// map holding only "c". That rule is what wiped lists after Sept 25.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const app = fs.readFileSync(new URL('../../cueola-app.js', import.meta.url), 'utf8');
const engine = fs.readFileSync(new URL('../../cueola-prepro-sync.js', import.meta.url), 'utf8');

const FUNCS = ['loadPreProData', 'pbBeginCloudSave', 'pbEndCloudSave', 'preProValuesEqual', 'preProSyncEngine',
  'pbAdoptRowIdentity', 'pbCollectionsToArrays', 'persistPreProData', 'persistPreProDataLegacy', 'syncPreProToFirestore',
  'pbLeafPathSafe', 'syncPreProLeavesToFirestore', 'pbSaveTimesWithFieldStamps', 'pbListsCutByOldWindows',
  'mergePreProFromCloud', 'mergePreProFromCloudLegacy'];
function slice(name) {
  const lines = app.split('\n');
  const start = lines.findIndex(l => l.startsWith(`function ${name}(`));
  assert.ok(start >= 0, `function ${name} exists`);
  if (/^function [^(]+\([^)]*\) \{.*\}\s*$/.test(lines[start])) return lines[start];
  let end = start + 1;
  while (end < lines.length && !/^}\s*$/.test(lines[end])) end++;
  return lines.slice(start, end + 1).join('\n');
}
const FLAG = /^window\.CUEOLA_PB_LEAF_SYNC = (true|false);/m.exec(app)?.[1] === 'true';
const APP_SLICE = FUNCS.map(slice).join('\n\n');

const DELETE = { __delete: true };
const isMap = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const copy = v => JSON.parse(JSON.stringify(v));

function cloud(prePro) {
  const doc = { prePro: copy(prePro) };
  return {
    doc,
    update(updates) {
      for (const [dotted, value] of Object.entries(updates)) {
        const segs = dotted.split('.');
        let cur = doc;
        let skip = false;
        for (const s of segs.slice(0, -1)) {
          if (!isMap(cur[s])) { if (value === DELETE) { skip = true; break; } cur[s] = {}; }
          cur = cur[s];
        }
        if (skip) continue;
        if (value === DELETE) delete cur[segs[segs.length - 1]];
        else cur[segs[segs.length - 1]] = copy(value);
      }
    },
  };
}

let clockNow = Date.UTC(2026, 8, 30, 14);
function device(store, { leafSync = FLAG, storage = new Map() } = {}) {
  const ctx = {
    console, JSON, Math, Object, Array, Number, String, Boolean, Set, Map, Promise, Error, isFinite,
    Date: { now: () => ++clockNow, UTC: Date.UTC },
    localStorage: { getItem: k => (storage.has(k) ? storage.get(k) : null), setItem: (k, v) => storage.set(k, String(v)), removeItem: k => storage.delete(k) },
    session: { code: 'TEST1', userName: 'Tester', isDemo: false, isExpert: false },
    CLIENT_ID: 'c1',
  };
  ctx.window = {
    CUEOLA_PB_LEAF_SYNC: leafSync, _firebaseReady: true, _deleteField: () => DELETE, _arrayUnion: null,
    _updateDoc: (ref, updates) => { store.update(updates); return Promise.resolve(); },
    _setDoc: () => Promise.resolve(),
  };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(engine, ctx);
  vm.runInContext(`
    window.CueolaPreProSync = globalThis.CueolaPreProSync;
    const _pbPendingCloudKeys = new Set(); const _pbPendingCloudCounts = new Map();
    let _pbLastCloudSaveError = null; let _pbSuppressActivity = true; let _pbFieldSaveTimer = null;
    function updatePbSaveStatus() {} function preProActor() { return 'Tester'; } function preProActivityValue(e) { return [e]; }
    function reportCloudWriteFailure() {} function logShow() {} function liveServerNow() { return Date.now(); }
    function preProKey() { return 'cueola_prepro_TEST1'; } function preProDocRef() { return 'ref'; } function groupActive() { return false; }
    ${APP_SLICE}
    globalThis.api = { loadPreProData, persistPreProData, mergePreProFromCloud };
  `, ctx);
  const api = ctx.api;
  return {
    storage,
    mirror: () => api.loadPreProData(),
    snapshot: () => api.mergePreProFromCloud(copy(store.doc.prePro), false, 0),
    join: () => api.mergePreProFromCloud(copy(store.doc.prePro), true, 0),
    save: (patch, section) => api.persistPreProData(patch, section),
  };
}
const settle = () => new Promise(r => setImmediate(r));

// A show saved before 3.0: every list stored whole, no row ids (like the Break Room seed).
function oldShow() {
  const T0 = Date.UTC(2026, 8, 20);
  const people = ['Ana', 'Ben', 'Cal', 'Dee'].map(name => ({ name, position: 'Crew', email: '', phone: '', call: '17:30' }));
  const prePro = {
    callSheets: [{ id: 'call_sheet_1', label: 'Show Day', date: '2026-09-30', people }],
    people: copy(people),
    videoPatchRows: [1, 2, 3].map(i => ({ label: `CAM ${i}`, destination: '', source: '', cabling: '', notes: '' })),
    productionSchedule: { date: '2026-09-30', checklist: [{ area: 'Record', item: 'Armed', hint: '', done: false }] },
  };
  prePro._fieldUpdatedAt = Object.fromEntries(Object.keys(prePro).map(k => [k, T0]));
  prePro.updatedAt = T0;
  return prePro;
}
const sheetOf = pre => (Array.isArray(pre.callSheets) ? pre.callSheets : Object.values(pre.callSheets || {}))[0] || {};

test('field-level saves are off', () => {
  assert.equal(FLAG, false, 'window.CUEOLA_PB_LEAF_SYNC must stay false until the one-time list move ships');
});

test('re-reading an old show never adds copies of rows that have no id', async () => {
  const store = cloud(oldShow());
  const a = device(store);
  a.join();
  for (let i = 0; i < 5; i++) { a.snapshot(); await settle(); }
  assert.equal(sheetOf(a.mirror()).people.length, 4);
  assert.equal(a.mirror().videoPatchRows.length, 3);
  assert.equal(a.mirror().productionSchedule.checklist.length, 1);
});

test('an edit saves the whole list, so the rest of the list stays in the cloud', async () => {
  const store = cloud(oldShow());
  const a = device(store);
  a.join(); await settle();
  const pre = a.mirror();
  const rows = pre.videoPatchRows.map(r => ({ ...r }));
  rows[1].notes = 'Tight on host';
  a.save({ videoPatchRows: rows }, 'Video Patch'); await settle();
  assert.ok(Array.isArray(store.doc.prePro.videoPatchRows), 'still a list in the cloud');
  assert.deepEqual(store.doc.prePro.videoPatchRows.map(r => r.label), ['CAM 1', 'CAM 2', 'CAM 3']);
  assert.equal(store.doc.prePro.videoPatchRows[1].notes, 'Tight on host');
  const fresh = device(store);
  fresh.join();
  assert.equal(fresh.mirror().videoPatchRows.length, 3);
});

test('a show made under 3.x (lists stored as maps) reads in full, and the next save stores the list whole again', async () => {
  const pre = oldShow();
  pre.videoPatchRows = { r_a: { label: 'CAM 1', ord: 1 }, r_b: { label: 'CAM 2', ord: 2 } };
  const store = cloud(pre);
  const a = device(store);
  a.join(); await settle();
  assert.deepEqual(a.mirror().videoPatchRows.map(r => r.label), ['CAM 1', 'CAM 2']);
  const rows = a.mirror().videoPatchRows.map(r => ({ ...r }));
  rows[0].notes = 'Wide';
  a.save({ videoPatchRows: rows }, 'Video Patch'); await settle();
  assert.ok(Array.isArray(store.doc.prePro.videoPatchRows));
  assert.deepEqual(store.doc.prePro.videoPatchRows.map(r => r.label), ['CAM 1', 'CAM 2']);
});

test('a list cut down by a window still on the 3.x build is put back whole', async () => {
  const store = cloud(oldShow());
  const a = device(store);
  a.join(); await settle();
  a.snapshot(); await settle();
  // An old 3.x window saves one field into the crew list. The cloud keeps only that field.
  store.update({ 'prePro.callSheets.call_sheet_1.people.r_x.call': '16:00', 'prePro._stamps.callSheets.call_sheet_1.people.r_x.call': Date.now(), 'prePro.updatedAt': Date.now() });
  assert.ok(isMap(store.doc.prePro.callSheets), 'the old window turned the list into a one-field map');
  a.snapshot(); await settle();
  assert.ok(Array.isArray(store.doc.prePro.callSheets), 'put back as a list');
  assert.equal(sheetOf(store.doc.prePro).label, 'Show Day');
  assert.equal(sheetOf(store.doc.prePro).people.length, 4);
  const fresh = device(store);
  fresh.join();
  assert.equal(sheetOf(fresh.mirror()).people.length, 4);
});

test('a list damaged before this fix is left alone for the instructor to check (no automatic push)', async () => {
  const pre = oldShow();
  const store = cloud(pre);
  // This device last had the full list under 3.x, then the list was cut down before the fix shipped.
  const storage = new Map();
  const old = device(store, { leafSync: true, storage });
  old.join(); await settle();
  store.update({ 'prePro.videoPatchRows.r_x.notes': 'x', 'prePro._stamps.videoPatchRows.r_x.notes': Date.now(), 'prePro.updatedAt': Date.now() });
  const before = JSON.stringify(store.doc.prePro.videoPatchRows);
  const now = device(store, { storage });
  now.snapshot(); await settle();
  assert.equal(JSON.stringify(store.doc.prePro.videoPatchRows), before, 'no automatic write on a plain re-read');
});

test('a device that missed a field saved between Sept 25 and this fix takes the newer cloud copy', async () => {
  const store = cloud({ ...oldShow(), safety: { hospital: 'General', fire: 'Exits' } });
  store.doc.prePro._fieldUpdatedAt.safety = Date.UTC(2026, 8, 20);
  // Under 3.x, device V saves the hospital, then device X (while V is closed) saves the fire station.
  const vStorage = new Map();
  const v3 = device(store, { leafSync: true, storage: vStorage });
  v3.join(); await settle();
  v3.save({ safety: { ...v3.mirror().safety, hospital: 'Mercy' } }, 'Safety Plan'); await settle();
  v3.snapshot(); await settle();
  const x3 = device(store, { leafSync: true });
  x3.join(); await settle();
  x3.save({ safety: { ...x3.mirror().safety, fire: 'Station 4' } }, 'Safety Plan'); await settle();
  // After the fix, V opens Planda Bear through the join door.
  const v = device(store, { storage: vStorage });
  v.join(); await settle();
  assert.equal(store.doc.prePro.safety.fire, 'Station 4', 'the later field survives');
  assert.equal(store.doc.prePro.safety.hospital, 'Mercy');
  assert.equal(v.mirror().safety.fire, 'Station 4');
});
