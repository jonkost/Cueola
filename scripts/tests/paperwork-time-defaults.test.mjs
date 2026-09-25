// P1-2 regression guard: a time field that was never set stays blank.
// Source-text contract over cueola-app.js (no build step, no DOM in node).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const app = fs.readFileSync(new URL('../../cueola-app.js', import.meta.url), 'utf8');
const tests = [];
function test(name, fn) { tests.push({ name, fn }); }
const fn = name => {
  const start = app.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `function ${name} exists`);
  const next = app.indexOf('\nfunction ', start + 10);
  return app.slice(start, next < 0 ? undefined : next);
};

test('a new crew row on the call sheet starts with no call time', () => {
  const body = fn('addCallSheetPerson');
  assert.match(body, /call:''/);
  assert.doesNotMatch(body, /timeInputValue\('pp-call'\)/);
});

test('fill from roster never copies the sheet call time into people', () => {
  const body = fn('fillCallSheetCrewFromRoster');
  assert.match(body, /const defaultCall = ''/);
  assert.doesNotMatch(body, /timeInputValue\('pp-call'\)/);
});

test('every time input in the markup ships without a value', () => {
  const html = fs.readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
  const timeInputs = html.match(/<input[^>]*type="time"[^>]*>/g) || [];
  assert.ok(timeInputs.length >= 10, `found ${timeInputs.length} time inputs`);
  for (const tag of timeInputs) assert.doesNotMatch(tag, /\svalue="[^"]+"/, tag);
});

test('the time normalizer turns nothing into a time', () => {
  // normalizeTimeValue is a plain function; evaluate it in isolation.
  const src = fn('normalizeTimeValue');
  const normalize = new Function('pad', `${src}; return normalizeTimeValue;`)(n => String(n).padStart(2, '0'));
  for (const v of ['', null, undefined, '—', 'N/A', 'noon', 0]) assert.equal(normalize(v), '', `normalizeTimeValue(${JSON.stringify(v)})`);
  assert.equal(normalize('12:30'), '12:30');
  assert.equal(normalize('9:05 pm'), '21:05');
});

test('the checklist push never stamps default text into blank rows', () => {
  const body = fn('pushTodoToProductionSchedule');
  assert.match(body, /normalizeProductionChecklistRow\(row, -1\)/);
  assert.doesNotMatch(body, /\.map\(normalizeProductionChecklistRow\)/);
});

let failed = 0;
for (const { name, fn: run } of tests) {
  try { run(); console.log(`ok - ${name}`); }
  catch (error) { failed += 1; console.error(`not ok - ${name}\n${error.stack || error}`); }
}
console.log(`${tests.length - failed}/${tests.length} paperwork time-default tests passed`);
if (failed) process.exit(1);
