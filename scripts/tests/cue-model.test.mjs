// 3.0 cue model: one type per cue, minimal fields, one call line, and a
// migration that loses no student work.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const M = require('../../cueola-cue-model.js');
const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

test('six types, each with a storage cell and a minimal field set', () => {
  assert.deepEqual(M.TYPES.map(t => t.id), ['camera', 'audio', 'graphic', 'playback', 'lighting', 'script']);
  assert.equal(M.cellKey('camera'), 'video');
  assert.equal(M.cellKey('graphic'), 'gfx');
  assert.equal(M.typeForCell('video'), 'camera');
  assert.deepEqual(M.fields('camera').map(f => f.key), ['camera', 'shot']);
  assert.deepEqual(M.fields('audio').map(f => f.key), ['source', 'action', 'level']);
  assert.deepEqual(M.fields('graphic').map(f => f.key), ['name', 'text', 'hold']);
  assert.deepEqual(M.fields('playback').map(f => f.key), ['clip', 'in', 'out', 'preRoll', 'audioFromClip', 'autoAdvance']);
  assert.deepEqual(M.fields('lighting').map(f => f.key), ['look']);
  assert.deepEqual(M.fields('script').map(f => f.key), ['text', 'speaker']);
  for (const t of M.TYPES) for (const f of M.fields(t.id)) assert.ok(f.help && f.label, `${t.id}.${f.key} has a label and ⓘ text`);
});

test('call lines read like a director talks', () => {
  assert.equal(M.callLine('camera', { camera: 'CAM 2', shot: 'Medium' }), 'CAM 2 · Medium');
  assert.equal(M.callLine('audio', { source: 'Host mic', action: 'on' }), 'Host mic on');
  assert.equal(M.callLine('audio', { source: 'Music', action: 'under', level: '-20 dB' }), 'Music under -20 dB');
  assert.equal(M.callLine('graphic', { name: 'Lower third', text: 'Jane Doe' }), 'Lower third: Jane Doe');
  assert.equal(M.callLine('graphic', { name: '', text: 'Jane Doe' }), 'Jane Doe');
  assert.equal(M.callLine('playback', { clip: 'OPEN.mp4' }), 'Roll OPEN.mp4');
  assert.equal(M.callLine('playback', { clip: 'OPEN.mp4', in: '0:10', out: '1:30' }), 'Roll OPEN.mp4 · 0:10–1:30');
  assert.equal(M.callLine('playback', { clip: '', outCueName: 'SHOW OPEN' }), 'Roll SHOW OPEN');
  assert.equal(M.callLine('lighting', { look: 'Warm wash' }), 'Warm wash');
  assert.equal(M.callLine('script', { text: 'Good evening and **welcome**.\nSecond line.' }), 'Good evening and welcome.');
  assert.equal(M.callLine('script', { text: '', speaker: 'Host' }), 'Cue Host');
  assert.equal(M.callLine('camera', {}), '');
  // Blank Slate: a typed line with no fields is the call line.
  assert.equal(M.callLine('camera', { _v: 3, on: 'Take the drone' }), 'Take the drone');
});

test('migrating the demo show keeps every call and picks one type per row', () => {
  const beat = { id: 5, style: 'timed', info: 'PKG: Student Council', notes: 'Nat sound up full', min: 2, sec: 15, done: false, cues: {
    video:    { on: 'Set FULL SCREEN', off: 'Dissolve to PKG' },
    playback: { on: 'Ready SC_042',    off: 'Roll SC_042' },
    audio:    { on: 'Ready PKG Audio', off: 'Take PKG SOT' },
  } };
  const m = M.migrateBeat(beat);
  assert.equal(m.type, 'playback');
  assert.equal(m.done, undefined);
  assert.equal(m.cues.playback.clip, 'SC_042');
  assert.equal(m.cues.playback.on, 'Roll SC_042');
  assert.equal(m.cues.playback.notes, 'Then: Roll SC_042');
  assert.equal(m.cues.playback.preRoll, 0);
  assert.equal(m.cues.video.camera, 'FULL SCREEN');
  assert.equal(m.cues.video.notes, 'Then: Dissolve to PKG');
  assert.equal(m.cues.audio.source, 'PKG Audio');
  assert.equal(m.cues.audio.on, 'PKG Audio');
  assert.equal(m.cues.video.off, undefined, 'off is gone');
  assert.equal(M.summary(m).line, 'Roll SC_042');
  assert.deepEqual(M.summary(m).extras, ['camera', 'audio']);
  assert.equal(M.summary(m).duration, '2:15');
});

test('camera, audio and graphic calls parse into fields', () => {
  assert.deepEqual(pick(M.migrateCell('video', { on: 'Ready CAM 2 · CU', off: 'Take CAM 2' }), ['camera', 'shot', 'notes', 'on']), { camera: 'CAM 2', shot: 'CU', notes: '', on: 'CAM 2 · CU' });
  assert.deepEqual(pick(M.migrateCell('audio', { on: 'Open Mic · Host', off: 'Close Mic · Host' }), ['source', 'action', 'on']), { source: 'Host', action: 'on', on: 'Host on' });
  assert.deepEqual(pick(M.migrateCell('audio', { on: 'Track PLBK', off: '' }), ['source', 'action']), { source: 'PLBK', action: 'under' });
  assert.deepEqual(pick(M.migrateCell('audio', { on: 'Fade In · Theme', off: '' }), ['source', 'action']), { source: 'Theme', action: 'up' });
  assert.deepEqual(pick(M.migrateCell('gfx', { on: 'Ready Lower 3rd · Dr. Imogen Rey', off: 'Take L3', gfxContent: 'Dr. Imogen Rey · Sleep Science Lab' }), ['name', 'text']), { name: 'Lower 3rd · Dr. Imogen Rey', text: 'Dr. Imogen Rey · Sleep Science Lab' });
  assert.deepEqual(pick(M.migrateCell('gfx', { on: 'Ready Lower 3rd · Coming Up', off: 'Take L3' }), ['name', 'text']), { name: 'Lower 3rd', text: 'Coming Up' });
  const gfx = M.migrateCell('gfx', { on: 'Set Bug', off: 'Take Bug', gfxContent: 'Show bug, lower right', isFixed: true, isAnimated: false, customType: 'Bug' });
  assert.equal(gfx.name, 'Bug');
  assert.equal(gfx.text, 'Show bug, lower right');
  assert.equal(gfx.isFixed, undefined);
});

test('playback keeps its links, takes a 3 s pre-roll when it rolled on TAKE, and moves the TRT into the cue duration', () => {
  const beat = { id: 1, style: 'flex', info: 'Show Open', min: 0, sec: 0, cues: {
    playback: { on: 'Ready SHOW OPEN', off: 'Roll SHOW OPEN', clip: 'SHOW_OPEN_16x9', trtMin: '0', trtSec: '20', smpte: '00:00:20:00', outCueId: 'cue_1', outAuto: true, outPadId: 'pad_9', outPadAuto: false },
  } };
  const m = M.migrateBeat(beat);
  assert.equal(m.type, 'playback');
  assert.equal(m.min, 0); assert.equal(m.sec, 20);
  assert.equal(m.style, 'timed');
  const pb = m.cues.playback;
  assert.equal(pb.clip, 'SHOW_OPEN_16x9');
  assert.equal(pb.preRoll, 3);
  assert.equal(pb.outCueId, 'cue_1'); assert.equal(pb.outAuto, true);
  assert.equal(pb.outPadId, 'pad_9'); assert.equal(pb.outPadAuto, false);
  assert.equal(pb._trt, undefined);
  assert.match(pb.notes, /Timecode: 00:00:20:00/);
  assert.equal(pb.audioFromClip, true);
  // A cue that already has a duration keeps it.
  const timed = M.migrateBeat({ id: 2, style: 'timed', min: 1, sec: 30, cues: { playback: { on: 'Ready X', off: '', trtMin: '0', trtSec: '20' } } });
  assert.equal(timed.min, 1); assert.equal(timed.sec, 30);
  // An explicit preRoll wins over the outAuto default.
  assert.equal(M.migrateCell('playback', { on: 'Roll X', outAuto: true, preRoll: 0 }).preRoll, 0);
});

test('lighting and script migrate with nothing lost', () => {
  const lx = M.migrateCell('lighting', { on: 'Ready Cue 8 · Break Wash', off: 'Go Cue 8', lightingGoCue: '8', lightingDetail: 'Cue 8: cool wash, desk key out', intensity: '40%' });
  assert.equal(lx.look, 'Cue 8');
  assert.match(lx.notes, /Intensity: 40%/);
  assert.match(lx.notes, /Detail: Cue 8: cool wash/);
  assert.match(lx.notes, /Then: Go Cue 8/);
  const sc = M.migrateCell('script', { on: 'Standby Host', off: 'Cue Host', scriptType: 'Script', speaker: 'FINN VOSS', scriptTags: ['Cold Open'], text: 'Good evening.\nMore.' });
  assert.equal(sc.speaker, 'FINN VOSS');
  assert.equal(sc.text, 'Good evening.\nMore.');
  assert.equal(sc.on, 'Good evening.');
  assert.equal(sc.notes, 'Tags: Cold Open');
  assert.equal(sc.scriptTags, undefined);
  const dlg = M.migrateCell('script', { on: 'Standby Host', off: '', scriptType: 'Dialogue', dialogueNote: 'Ad-lib the budget vote.' });
  assert.equal(dlg.text, '(unscripted) Ad-lib the budget vote.');
  assert.equal(dlg.speaker, 'Host');
  // Unreadable text still shows as the call line, nothing dropped.
  const odd = M.migrateCell('video', { on: 'Whatever the TD wants', off: 'Dissolve to Black', notes: 'old cell note' });
  assert.equal(odd.camera, 'Whatever the TD wants');
  assert.equal(odd.on, 'Whatever the TD wants');
  assert.equal(odd.notes, 'old cell note\nThen: Dissolve to Black');
});

test('migration is idempotent and leaves migrated cells alone', () => {
  const once = M.migrateBeat({ id: 3, style: 'timed', info: 'x', min: 0, sec: 20, cues: { video: { on: 'Ready CAM 1', off: 'Take CAM 1' } } });
  const twice = M.migrateBeat(once);
  assert.deepEqual(twice, once);
  const edited = M.setField('camera', once.cues.video, 'shot', 'Wide');
  assert.equal(edited.on, 'CAM 1 · Wide');
  assert.deepEqual(M.migrateCell('video', edited), edited);
});

test('type is inferred by what the row does, playback first', () => {
  assert.equal(M.inferType({ cues: { video: { on: 'Ready CAM 1' }, audio: { on: 'Open Mic' } } }), 'camera');
  assert.equal(M.inferType({ cues: { audio: { on: 'Open Mic' }, playback: { on: 'Roll X' } } }), 'playback');
  assert.equal(M.inferType({ cues: { gfx: { on: 'Ready L3' }, audio: { on: 'Open Mic' } } }), 'graphic');
  assert.equal(M.inferType({ cues: { script: { text: 'Hi' } } }), 'script');
  assert.equal(M.inferType({ style: 'segment', cues: {} }), 'segment');
  assert.equal(M.inferType({ cues: {} }), 'camera');
  assert.equal(M.inferType({ type: 'lighting', cues: { video: { on: 'Ready CAM 1' } } }), 'lighting', 'an explicit type wins');
  // Empty cells never decide the type.
  assert.equal(M.inferType({ cues: { playback: { on: '', off: '' }, video: { on: 'Ready CAM 1' } } }), 'camera');
});

test('a new cue is type, name and duration, and nothing else', () => {
  const b = M.newBeat({ id: 9, type: 'graphic', name: 'Title', min: '0', sec: '5', createdAt: 1, createdBy: 'me' });
  assert.equal(b.type, 'graphic');
  assert.equal(b.style, 'timed');
  assert.deepEqual(Object.keys(b.cues), ['gfx']);
  assert.equal(b.cues.gfx._v, 3);
  assert.equal(M.callLine('graphic', b.cues.gfx), '');
  assert.ok(M.isCellEmpty('graphic', b.cues.gfx));
  const flex = M.newBeat({ id: 10, type: 'script', name: 'Chat' });
  assert.equal(flex.style, 'flex');
  const seg = M.newBeat({ id: 11, type: 'segment', name: 'Act 1' });
  assert.equal(seg.style, 'segment');
  assert.equal(seg.type, undefined);
  assert.equal(M.newBeat({ id: 12, type: 'bogus', name: 'x' }).type, 'camera');
});

test('a linked playback cell with no clip name is not empty', () => {
  assert.equal(M.isCellEmpty('playback', { _v: 3, clip: '', outCueId: 'cue_2' }), false);
  assert.equal(M.isCellEmpty('audio', { _v: 3, source: '', outPadId: 'pad_1' }), false);
  assert.equal(M.isCellEmpty('camera', { _v: 3, camera: '', notes: 'hold for the wide' }), false);
  assert.equal(M.isCellEmpty('camera', { _v: 3, camera: '' }), true);
});

test('durations format the way the clock reads them', () => {
  assert.equal(M.formatDuration({ min: 0, sec: 5 }), '0:05');
  assert.equal(M.formatDuration({ min: 2, sec: 15 }), '2:15');
  assert.equal(M.formatDuration({ min: 65, sec: 0 }), '1:05:00');
  assert.equal(M.formatDuration({ min: 0, sec: 0 }), '');
});

function pick(o, keys) { return Object.fromEntries(keys.map(k => [k, o[k]])); }

let failed = 0;
for (const { name, fn } of tests) {
  try { fn(); console.log(`ok - ${name}`); }
  catch (error) { failed += 1; console.error(`not ok - ${name}\n${error.stack || error}`); }
}
console.log(`${tests.length - failed}/${tests.length} cue model tests passed`);
if (failed) process.exit(1);
