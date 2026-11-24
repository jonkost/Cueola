import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const E = require('../../cueola-prompter-engine.js');

function test(name, fn) {
  try { fn(); console.log(`PASS ${name}`); }
  catch (error) { console.error(`FAIL ${name}`); throw error; }
}

// Run the motion for a while at 60 Hz; returns every frame's result.
function run(m, frames, dt = 16.7) {
  const out = [];
  for (let i = 0; i < frames; i++) out.push(m.step(dt));
  return out;
}

test('the crawl ramps up from a stop and settles at the set speed', () => {
  const m = E.createMotion({ speed: 60, max: 100000 });
  m.roll(true);
  const frames = run(m, 90);
  // Starts gentle: the first frame moves far less than a full step.
  assert.ok(frames[0].pos < 60 * 0.0167 * 0.2, 'first frame is a soft start');
  // After a second and a half it is at speed: 60 px/s = 1.002 px per frame.
  const last = frames[frames.length - 1];
  assert.ok(Math.abs(last.vel - 60) < 0.6, `settled near 60, got ${last.vel}`);
  // Position only ever increases while rolling forward.
  for (let i = 1; i < frames.length; i++) assert.ok(frames[i].pos >= frames[i - 1].pos);
});

test('brake, boost and reverse change the cruise speed, and a stall frame is capped', () => {
  const m = E.createMotion({ speed: 100, max: 100000 });
  m.roll(true);
  assert.equal(m.cruise(), 100);
  m.hold('brake', true);  assert.equal(m.cruise(), 25);
  m.hold('brake', false); m.hold('boost', true); assert.equal(m.cruise(), 250);
  m.hold('boost', false); m.hold('reverse', true); assert.equal(m.cruise(), -100);
  m.hold('reverse', false);
  // Speed clamps to the app's range.
  assert.equal(m.setSpeed(999), 200);
  assert.equal(m.setSpeed(1), 5);
  m.setSpeed(60);
  run(m, 120);
  const before = m.get().pos;
  m.step(5000);   // a hidden window's five seconds land as one capped frame
  assert.ok(m.get().pos - before < 60 * 0.1 + 1, 'a stall never leaps');
});

test('a cue travels smoothly to its spot: no jump, velocity continuous, lands and stays', () => {
  const m = E.createMotion({ speed: 60, max: 100000 });
  m.moveTo(1200);
  const frames = run(m, 240);
  let maxJump = 0;
  let maxVelJump = 0;
  for (let i = 1; i < frames.length; i++) {
    maxJump = Math.max(maxJump, Math.abs(frames[i].pos - frames[i - 1].pos));
    maxVelJump = Math.max(maxVelJump, Math.abs(frames[i].vel - frames[i - 1].vel));
  }
  assert.ok(maxJump < 60, `no frame moves more than a screen fraction (${maxJump})`);
  assert.ok(maxVelJump < 120, `velocity never steps (${maxVelJump})`);
  assert.ok(frames.some(f => f.landed), 'the travel lands');
  const end = m.get();
  assert.equal(end.target, null);
  assert.ok(Math.abs(end.pos - 1200) < 1, `lands on the spot (${end.pos})`);
  assert.ok(Math.abs(end.vel) < 1, 'and stands still there when paused');
  // The old glide's timing is kept: a 1200px cue lands in about 1.4 seconds.
  const landedAt = frames.findIndex(f => f.landed) * 16.7;
  assert.ok(landedAt > 700 && landedAt < 2400, `landed at ${landedAt}ms`);
});

test('a cue while rolling keeps rolling: the target rides the crawl and the roll continues after landing', () => {
  const m = E.createMotion({ speed: 60, max: 100000 });
  m.roll(true);
  run(m, 60);
  const start = m.get().pos;
  m.moveTo(start + 800);
  const frames = run(m, 240);
  const landedIdx = frames.findIndex(f => f.landed);
  assert.ok(landedIdx > 0, 'landed');
  // After landing, the crawl is at speed with no pause or restart.
  const after = frames.slice(landedIdx + 1, landedIdx + 20);
  for (const f of after) assert.ok(Math.abs(f.vel - 60) < 2, `rolling at speed after the cue (${f.vel})`);
  // And it landed past the asked spot by about what the crawl covered meanwhile.
  assert.ok(frames[landedIdx].pos > start + 800, 'the crawl kept going during the travel');
});

test('the dial accumulates: three quick turns read as one travel to the sum', () => {
  const m = E.createMotion({ speed: 60, max: 100000 });
  m.jumpTo(500);
  m.moveBy(40);
  run(m, 2);
  m.moveBy(40);
  run(m, 2);
  m.moveBy(40);
  assert.equal(m.get().target.to, 620);
  assert.equal(m.reportedPos(), 620);   // mid-travel the honest spot is the destination
  const frames = run(m, 60);
  assert.ok(frames.some(f => f.landed));
  assert.ok(Math.abs(m.get().pos - 620) < 1);
  // The dial settles fast: within a third of a second.
  const landedAt = frames.findIndex(f => f.landed) * 16.7;
  assert.ok(landedAt < 400, `dial settles quickly (${landedAt}ms)`);
  // Turning back re-arms toward the new sum, no snap.
  m.moveBy(-200);
  assert.equal(m.get().target.to, 420);
});

test('a hard set clears travel; a layout shift carries position and travel together', () => {
  const m = E.createMotion({ speed: 60, max: 5000 });
  m.moveTo(3000);
  run(m, 5);
  m.jumpTo(100);
  assert.equal(m.get().target, null);
  assert.equal(m.get().pos, 100);
  m.moveTo(900);
  m.shift(250);
  assert.equal(m.get().pos, 350);
  assert.equal(m.get().target.to, 1150);
  // Shrinking the script clamps everything inside it.
  m.setMax(1000);
  assert.equal(m.get().target.to, 1000);
  m.jumpTo(99999);
  assert.equal(m.get().pos, 1000);
});

test('the end of the script stops the roll there', () => {
  const m = E.createMotion({ speed: 200, max: 300 });
  m.roll(true);
  const frames = run(m, 300);
  assert.ok(frames.some(f => f.ended), 'reports the end');
  assert.equal(m.get().rolling, false);
  assert.equal(m.get().pos, 300);
  // Reverse from the top stays at the top, and does not report an end.
  m.jumpTo(0); m.roll(true); m.hold('reverse', true);
  const back = run(m, 30);
  assert.ok(back.every(f => !f.ended));
  assert.equal(m.get().pos, 0);
});

test('parseRows reads [N] headers into rows and trims the blank lines around each', () => {
  const text = '\n[1] Cold open\nHOST:\nWelcome to the show.\n\n\n[2]\n[Toss to weather]\n\n[3] Weather\nWEATHER:\nSunny all week.\n';
  const rows = E.parseRows(text);
  assert.deepEqual(rows.map(r => [r.num, r.name, r.key]), [[1, 'Cold open', 'r1'], [2, '', 'r2'], [3, 'Weather', 'r3']]);
  assert.equal(rows[0].text, 'HOST:\nWelcome to the show.');
  assert.equal(rows[1].text, '[Toss to weather]');
  assert.equal(rows[0].words, 5);         // HOST + Welcome to the show
  assert.equal(rows[1].words, 0);         // a direction is not read aloud
  // A pasted script with no headers is one unnumbered row.
  const plain = E.parseRows('Just some words.\nMore words.');
  assert.equal(plain.length, 1);
  assert.equal(plain[0].num, null);
  assert.equal(plain[0].text, 'Just some words.\nMore words.');
  assert.deepEqual(E.parseRows(''), []);
});

test('diffRows touches only the rows whose words changed', () => {
  const a = E.parseRows('[1] Open\nHello.\n\n[2] Weather\nSunny.\n\n[3] Close\nBye.');
  const b = E.parseRows('[1] Open\nHello.\n\n[2] Weather\nRainy.\n\n[3] Close\nBye.\n\n[4] Extra\nNew row.');
  const d = E.diffRows(a, b);
  assert.deepEqual(d.ops.map(o => o.type), ['keep', 'replace', 'keep', 'insert']);
  assert.deepEqual(d.removed, []);
  assert.equal(d.changed, 2);
  const c = E.parseRows('[1] Open\nHello.');
  const d2 = E.diffRows(b, c);
  assert.deepEqual(d2.removed, ['r2', 'r3', 'r4']);
  // A renamed row re-renders its header.
  const e = E.parseRows('[1] Opening\nHello.');
  assert.equal(E.diffRows(c, e).ops[0].type, 'replace');
  // Identical text is a no-op.
  assert.equal(E.diffRows(b, b).changed, 0);
});

test('time readouts: seconds for a distance at a speed, formatted m:ss', () => {
  assert.equal(E.secondsForPixels(600, 60), 10);
  assert.equal(E.secondsForPixels(600, 0), null);
  assert.equal(E.secondsForPixels(600, -120), 5);
  assert.equal(E.formatSeconds(10), '0:10');
  assert.equal(E.formatSeconds(75.4), '1:15');
  assert.equal(E.formatSeconds(null), '');
  assert.equal(E.wordCount('Say **this** word, [not this]'), 3);
});

console.log('prompter-engine: all tests passed');

test('a jog stays steady on slow and stalled frames (30 Hz, 10 Hz, a hidden window)', () => {
  for (const dt of [16.7, 33.4, 50, 100, 250, 500]) {
    const m = E.createMotion({ speed: 60, max: 100000 });
    m.jumpTo(1000);
    m.moveBy(120);                       // one line down
    let peak = 0, last = null;
    for (let t = 0; t < 3000; t += dt) {
      last = m.step(dt, 1000);
      peak = Math.max(peak, last.pos);
      assert.ok(Number.isFinite(last.pos) && Number.isFinite(last.vel), `finite at ${dt}ms`);
      assert.ok(Math.abs(last.vel) < 5000, `no runaway speed at ${dt}ms frames, got ${last.vel}`);
    }
    assert.ok(peak <= 1121, `never past the target at ${dt}ms frames, peak ${peak}`);
    assert.ok(Math.abs(last.pos - 1120) < 1, `lands on the target at ${dt}ms frames, got ${last.pos}`);
  }
});

test('a jog while rolling on slow frames keeps rolling and never hits the end', () => {
  const m = E.createMotion({ speed: 60, max: 5000 });
  m.roll(true);
  for (let i = 0; i < 60; i++) m.step(16.7);
  m.moveBy(240);
  let ended = false;
  for (let t = 0; t < 2000; t += 250) ended = ended || m.step(250, 500).ended;
  assert.equal(ended, false, 'the roll did not stop');
  assert.ok(m.get().pos < 1000, `still near where it was, got ${m.get().pos}`);
  assert.equal(m.get().rolling, true);
});

test('held Back rolls backward while paused, and stops when let go', () => {
  const m = E.createMotion({ speed: 60, max: 5000 });
  m.jumpTo(2000);
  m.hold('back', true);
  for (let i = 0; i < 120; i++) m.step(16.7);
  const moved = m.get().pos;
  assert.ok(moved < 1800, `went backward, got ${moved}`);
  m.hold('back', false);
  for (let i = 0; i < 120; i++) m.step(16.7);
  const rest = m.get().pos;
  for (let i = 0; i < 30; i++) m.step(16.7);
  assert.ok(Math.abs(m.get().pos - rest) < 0.5, 'still after letting go');
  assert.equal(m.get().rolling, false);
});

test('held Ahead rolls forward fast, then the roll carries on at its own speed', () => {
  const m = E.createMotion({ speed: 60, max: 50000 });
  m.roll(true);
  for (let i = 0; i < 120; i++) m.step(16.7);
  m.hold('ahead', true);
  for (let i = 0; i < 120; i++) m.step(16.7);
  assert.ok(m.get().vel > 140, `fast while held, got ${m.get().vel}`);
  m.hold('off');
  for (let i = 0; i < 240; i++) m.step(16.7);
  assert.ok(Math.abs(m.get().vel - 60) < 1, `back to the set speed, got ${m.get().vel}`);
  assert.equal(m.get().rolling, true);
});

test('Back stops at the top and Ahead stops at the end', () => {
  const m = E.createMotion({ speed: 60, max: 300 });
  m.jumpTo(100);
  m.hold('back', true);
  for (let i = 0; i < 200; i++) m.step(16.7);
  assert.equal(m.get().pos, 0);
  m.hold('ahead', true);
  let ended = false;
  for (let i = 0; i < 400; i++) ended = m.step(16.7).ended || ended;
  assert.equal(m.get().pos, 300);
  assert.ok(ended);
  assert.equal(m.get().dir, '', 'the hold lets go at the end');
});

const SENT = '[1] Open\nHOST:\nGood evening.\n\n[2] Lower Third\n\n[3] Welcome\nTonight, three stories.';
test('a change to the row on air is held; other rows go through', () => {
  const next = '[1] Open\nHOST:\nGood evening, everyone.\n\n[2] Lower Third\n\n[3] Welcome\nTonight, four stories.';
  assert.equal(E.rowChanged(SENT, next, 1), true);
  assert.equal(E.rowChanged(SENT, next, 2), false);
  const held = E.holdRow(next, SENT, 1);
  assert.equal(E.rowText(held, 1), 'HOST:\nGood evening.', 'row 1 keeps the words the talent has');
  assert.equal(E.rowText(held, 3), 'Tonight, four stories.', 'row 3 took the change');
  assert.equal(E.rowChanged(held, next, 1), true, 'still waiting to be sent');
  assert.equal(E.rowChanged(next, next, 1), false);
});

test('a brand new row is never treated as a change on air', () => {
  const next = SENT + '\n\n[4] Sign Off\nGood night.';
  assert.equal(E.rowChanged(SENT, next, 4), false);
  assert.equal(E.holdRow(next, SENT, 4), next);
});

test('rows survive a round trip through text', () => {
  assert.equal(E.rowsText(E.parseRows(SENT)), SENT);
});

test('read time comes from the words, and crew directions do not count', () => {
  assert.equal(E.readSeconds(''), 0);
  assert.equal(E.readSeconds('[TURN TO CAMERA 2]'), 0);
  assert.equal(E.readSeconds(Array(151).join('word ')), 60);
  assert.equal(E.readSeconds('Hello'), 1);
});

test('Speaker: a name with a colon on its own line, in any case', () => {
  assert.equal(E.scriptLineHTML('HOST:'), '<span class="scr-speaker">HOST</span>');
  assert.equal(E.scriptLineHTML('Host:'), '<span class="scr-speaker">HOST</span>');
  assert.equal(E.scriptLineHTML('Co-host 2:'), '<span class="scr-speaker">CO-HOST 2</span>');
  assert.ok(!E.isSpeakerLine('Here is the thing I want to say today:'));
  assert.ok(!E.isSpeakerLine('Host: good evening'));
  assert.ok(!E.isSpeakerLine('7:'));
});

test('Punch: two stars or one star, and stars never reach the talent', () => {
  assert.equal(E.scriptLineHTML('Tonight, **three big stories**.'), 'Tonight, <span class="scr-punch">three big stories</span>.');
  assert.equal(E.scriptLineHTML('from *around* campus'), 'from <span class="scr-punch">around</span> campus');
  assert.ok(!E.scriptHTML('**a** and *b*').includes('*'));
  assert.equal(E.scriptLineHTML('2 * 3 * 4'), '2 * 3 * 4');
});

test('Note to talent: brackets become a box, with no brackets shown', () => {
  assert.equal(E.scriptLineHTML('[Turn to camera 2]'), '<span class="scr-note">TURN TO CAMERA 2</span>');
  assert.equal(E.scriptLineHTML('Hello [smile] there'), 'Hello <span class="scr-note">SMILE</span> there');
});

test('Stop here: every old stop mark is one stop line', () => {
  ['[STOP HERE]', '[stop]', '[BREAK - AUTO PAUSE]', '[HOLD]', '[PAUSE]'].forEach(m => {
    assert.equal(E.scriptLineHTML(m), '<span class="scr-stop" data-stop="1">STOP</span>', m);
  });
  assert.equal(E.scriptLineHTML('[STOP HERE] Ad lib here'), '<span class="scr-stop" data-stop="1">STOP</span>Ad lib here');
  assert.ok(E.scriptLineHTML('[TECHNICAL DIFFICULTIES]').includes('data-stop'));
});

test('marks that mean nothing are dropped and leave no gap', () => {
  assert.equal(E.scriptLineHTML('[UPDATE] The vote was 7 to 2.'), 'The vote was 7 to 2.');
  assert.equal(E.scriptLineHTML('[DIALOGUE]'), '');
  assert.equal(E.scriptHTML('HOST:\n[DIALOGUE]\nGood evening.'), '<p><span class="scr-speaker">HOST</span></p><p>Good evening.</p>');
  assert.equal(E.scriptHTML('One.\n\nTwo.'), '<p>One.</p><p class="scr-gap">Two.</p>');
});

test('nothing typed can become live HTML', () => {
  const html = E.scriptHTML('<img src=x onerror=alert(1)> **<b>x</b>** [<i>y</i>]');
  assert.ok(!/<img|<b>|<i>/.test(html));
});

test('Clear formatting takes every mark off', () => {
  assert.equal(E.stripMarks('Tonight, **three** *big* stories. [SMILE] Go.'), 'Tonight, three big stories. Go.');
});

test('read time skips speaker names and notes', () => {
  assert.equal(E.readSeconds('HOST:\n[TURN TO CAMERA 2]'), 0);
  assert.equal(E.readSeconds('HOST:\n' + Array(151).join('word ')), 60);
});
