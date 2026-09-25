import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const LiveState = require('../../cueola-live-state.js');

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

// ── Sequence-gated adoption (P0-3: takes are idempotent) ────────────────────

test('a director TAKE increments seq and stamps the cue start from server time', () => {
  const s = LiveState.createLiveState({ clientId: 'A', initial: { idx: 0, seq: 4, showStartedAt: 1000 } });
  const { state, patch } = s.take(1, { nowMs: 5000 });
  assert.equal(state.idx, 1);
  assert.equal(state.seq, 5);
  assert.equal(state.cueStartedAt, 5000);
  assert.equal(state.showStartedAt, 1000);
  assert.equal(state.directorId, 'A');
  assert.deepEqual(patch, { idx: 1, seq: 5, cueStartedAt: 5000, showStartedAt: 1000, directorId: 'A', takenAt: 5000 });
});

test('the director\'s own echo never advances again', () => {
  const s = LiveState.createLiveState({ clientId: 'A', initial: { idx: 0, seq: 4 } });
  const { patch } = s.take(1, { nowMs: 5000 });
  let moves = 0;
  s.subscribe((_, reason) => { if (reason === 'remote-take') moves += 1; });
  const echo = s.adopt(patch);
  assert.equal(echo.applied, false);
  assert.equal(s.get().idx, 1);
  assert.equal(s.get().seq, 5);
  assert.equal(moves, 0);
});

test('an echo with the same seq folds in server-resolved timestamps without moving the cue', () => {
  const s = LiveState.createLiveState({ clientId: 'A', initial: { idx: 0, seq: 4 } });
  const { patch } = s.take(1, { nowMs: 5000 });
  const resolved = { ...patch, cueStartedAt: { toMillis: () => 5250 } };   // Firestore Timestamp shape
  const r = s.adopt(resolved);
  assert.equal(r.applied, false);
  assert.equal(r.timesUpdated, true);
  assert.equal(s.get().idx, 1);
  assert.equal(s.get().cueStartedAt, 5250);
});

test('a follower ignores any update whose seq is not greater than the last applied', () => {
  const f = LiveState.createLiveState({ clientId: 'B' });
  assert.equal(f.adopt({ idx: 3, seq: 10, directorId: 'A' }).applied, true);
  assert.equal(f.adopt({ idx: 2, seq: 9, directorId: 'A' }).applied, false);   // stale replay
  assert.equal(f.adopt({ idx: 3, seq: 10, directorId: 'A' }).applied, false);  // duplicate
  assert.equal(f.get().idx, 3);
  assert.equal(f.adopt({ idx: 4, seq: 11, directorId: 'A' }).applied, true);
  assert.equal(f.get().idx, 4);
});

test('ten fast takes are exactly ten takes on the director and on a follower', () => {
  const d = LiveState.createLiveState({ clientId: 'A', initial: { idx: -1, seq: 0 } });
  const f = LiveState.createLiveState({ clientId: 'B' });
  const echoes = [];
  for (let i = 0; i < 10; i++) {
    const { patch } = d.take(i, { nowMs: 1000 + i });
    echoes.push(patch);
  }
  // Echoes arrive twice (a duplicated snapshot) and once out of order.
  const delivered = [...echoes, ...echoes, echoes[3]];
  delivered.forEach(p => { d.adopt(p); f.adopt(p); });
  assert.equal(d.get().idx, 9);
  assert.equal(d.get().seq, 10);
  assert.equal(f.get().idx, 9);
  assert.equal(f.get().seq, 10);
});

test('a failed director write rolls back so the next room update is not ignored', () => {
  const d = LiveState.createLiveState({ clientId: 'A', initial: { idx: 2, seq: 7, directorId: 'A' } });
  d.take(3, { nowMs: 100 });
  assert.equal(d.hasPendingWrite(), true);
  d.settle(false);
  assert.equal(d.get().idx, 2);
  assert.equal(d.get().seq, 7);
  assert.equal(d.hasPendingWrite(), false);
  assert.equal(d.adopt({ idx: 3, seq: 8, directorId: 'C' }).applied, true);
});

test('two directors racing converge on the record the server kept', () => {
  const a = LiveState.createLiveState({ clientId: 'A', initial: { idx: 5, seq: 20 } });
  const b = LiveState.createLiveState({ clientId: 'B', initial: { idx: 5, seq: 20 } });
  const ta = a.take(6, { nowMs: 1 });
  const tb = b.take(7, { nowMs: 2 });
  // The server applied A then B; with a server-side increment B lands as 22.
  const kept = { ...tb.patch, seq: 22 };
  a.adopt(ta.patch); a.adopt(kept);
  b.adopt(ta.patch); b.adopt(kept);
  assert.equal(a.get().idx, 7);
  assert.equal(b.get().idx, 7);
  assert.equal(a.get().seq, 22);
  assert.equal(b.get().seq, 22);
});

test('force adoption re-syncs a rejoining window regardless of seq', () => {
  const f = LiveState.createLiveState({ clientId: 'B', initial: { idx: 9, seq: 50 } });
  assert.equal(f.adopt({ idx: 2, seq: 3, directorId: 'A' }, { force: true }).applied, true);
  assert.equal(f.get().idx, 2);
});

test('elapsed time is wall-clock math against the cue start, never a counter', () => {
  const s = LiveState.createLiveState({ clientId: 'A', initial: { idx: 0, seq: 1, cueStartedAt: 10_000, showStartedAt: 4_000 } });
  assert.equal(s.elapsedCueMs(70_000), 60_000);
  assert.equal(s.elapsedShowMs(70_000), 66_000);
  assert.equal(s.elapsedCueMs(9_000), 0);
  const idle = LiveState.createLiveState({ clientId: 'A' });
  assert.equal(idle.elapsedCueMs(99_999), 0);
  assert.equal(idle.elapsedShowMs(99_999), 0);
});

// ── Server clock ─────────────────────────────────────────────────────────────

test('server clock offset is the median of round-trip samples and zero without samples', () => {
  const c = LiveState.createServerClock();
  assert.equal(c.offsetMs(), 0);
  assert.equal(c.now(1000), 1000);
  c.addSample(2000, 1000, 1200);   // server 2000 vs local midpoint 1100 → +900
  c.addSample(2010, 1000, 1200);   // +910
  c.addSample(9999, 1000, 1200);   // outlier +8899
  assert.equal(c.offsetMs(), 910);
  assert.equal(c.now(1000), 1910);
});

test('server clock rejects unusable samples', () => {
  const c = LiveState.createServerClock();
  assert.equal(c.addSample(0, 1000, 1100), null);
  assert.equal(c.addSample(2000, NaN, 1100), null);
  assert.equal(c.addSample(2000, 1000, 9000), null);   // 8 s round trip
  assert.equal(c.sampleCount(), 0);
});

test('server clock reads Firestore Timestamp shapes', () => {
  const c = LiveState.createServerClock();
  c.addSample({ toMillis: () => 5000 }, 4000, 4000);
  assert.equal(c.offsetMs(), 1000);
  assert.equal(LiveState.millis({ seconds: 2, nanoseconds: 5e8 }), 2500);
  assert.equal(LiveState.millis(new Date(1234)), 1234);
});

// ── TAKE gate ────────────────────────────────────────────────────────────────

test('TAKE is debounced and disabled while a write is in flight', () => {
  const g = LiveState.createTakeGate({ debounceMs: 300 });
  assert.equal(g.tryAcquire(1000).ok, true);
  assert.equal(g.tryAcquire(1100).reason, 'in-flight');
  g.release();
  assert.equal(g.tryAcquire(1100).reason, 'debounced');
  assert.equal(g.tryAcquire(1300).ok, true);
  g.release();
  assert.equal(g.isBusy(), false);
});

// ── Duration math ────────────────────────────────────────────────────────────

test('duration helpers store seconds and format only at render', () => {
  assert.equal(LiveState.cueSeconds({ min: 2, sec: 5 }), 125);
  assert.equal(LiveState.cueSeconds({ min: '1', sec: '30' }), 90);
  assert.equal(LiveState.cueSeconds(null), 0);
  assert.equal(LiveState.formatSeconds(125), '2:05');
  assert.equal(LiveState.formatSeconds(3725), '1:02:05');
  assert.equal(LiveState.formatSeconds(0), '0:00');
  assert.equal(LiveState.formatRemaining(-12), '-0:12');
  const cues = [{ style: 'segment' }, { min: 1, sec: 0 }, { min: 0, sec: 30 }, { style: 'segment', min: 9 }, { min: 2, sec: 0 }];
  assert.equal(LiveState.offsetBefore(cues, 2), 60);
  assert.equal(LiveState.offsetBefore(cues, 4), 90);
  assert.equal(LiveState.totalSeconds(cues), 210);
});

test('normalize tolerates garbage and never produces NaN', () => {
  const n = LiveState.normalize({ idx: 'x', seq: -3, cueStartedAt: 'nope', directorId: 42 });
  assert.deepEqual(n, { idx: -1, seq: 0, cueStartedAt: 0, showStartedAt: 0, directorId: '42', takenAt: 0 });
  assert.deepEqual(LiveState.normalize(null), { idx: -1, seq: 0, cueStartedAt: 0, showStartedAt: 0, directorId: '', takenAt: 0 });
});

let failed = 0;
for (const { name, fn } of tests) {
  try { fn(); console.log(`ok - ${name}`); }
  catch (error) { failed += 1; console.error(`not ok - ${name}\n${error.stack || error}`); }
}
console.log(`${tests.length - failed}/${tests.length} live-state tests passed`);
if (failed) process.exit(1);
