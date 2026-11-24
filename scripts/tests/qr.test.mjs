import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Q = require('../../cueola-qr.js');

function test(name, fn) {
  try { fn(); console.log(`PASS ${name}`); }
  catch (error) { console.error(`FAIL ${name}`); throw error; }
}

// These codes were read back with the Mac's own QR reader (Core Image) on
// Nov 23, 2026, at sizes 1, 4, 5, 6 and 9. The picture of a known text is
// pinned here so a later change that breaks scanning cannot pass quietly.
const LINK = 'https://cueola.live/?operator=1&code=DEMO1#flowop';
const PINNED_HI = 697197372, PINNED_LINK = 3495769564;
const sum = m => { let h = 0; m.forEach(r => r.forEach(d => { h = (h * 31 + (d ? 1 : 0)) >>> 0; })); return h; };

test('the square grows with the text, and a text too long gives no code', () => {
  assert.equal(Q.matrix('HI').length, 21);
  assert.equal(Q.matrix(LINK).length, 33);
  assert.equal(Q.matrix('x'.repeat(180)).length, 53);
  assert.equal(Q.matrix('x'.repeat(181)), null);
  assert.equal(Q.svg('x'.repeat(500)), '');
});

test('the three corner squares are where a camera looks for them', () => {
  const m = Q.matrix(LINK), n = m.length;
  [[0, 0], [0, n - 7], [n - 7, 0]].forEach(([y, x]) => {
    for (let i = 0; i < 7; i++) { assert.ok(m[y][x + i]); assert.ok(m[y + 6][x + i]); assert.ok(m[y + i][x]); assert.ok(m[y + i][x + 6]); }
    assert.ok(m[y + 3][x + 3]);
    assert.ok(!m[y + 1][x + 1]);
  });
});

test('the same text always draws the same picture', () => {
  assert.equal(sum(Q.matrix(LINK)), sum(Q.matrix(LINK)));
  assert.notEqual(sum(Q.matrix(LINK)), sum(Q.matrix(LINK + '2')));
  assert.equal(sum(Q.matrix('HI')), PINNED_HI);
  assert.equal(sum(Q.matrix(LINK)), PINNED_LINK);
});

test('the picture is an SVG with a white border', () => {
  const svg = Q.svg(LINK, { size: 200, label: 'Scan <me>' });
  assert.ok(svg.startsWith('<svg'));
  assert.ok(svg.includes('viewBox="0 0 41 41"'));
  assert.ok(svg.includes('fill="#fff"'));
  assert.ok(!svg.includes('<me>'));
});
