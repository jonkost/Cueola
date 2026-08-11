/* Unit tests for the shared PIN helper (cueola-pin.js).
 * Run: node scripts/tests/pin.test.mjs
 *
 * Covers the strength policy (the "no easy pins" owner rule) and the
 * salt/hash/verify round trip. Uses Node's global WebCrypto (crypto.subtle,
 * available since Node 20) so the same code the browser runs is exercised.
 */
import assert from 'node:assert';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const Pin = require(join(root, 'cueola-pin.js'));

let passed = 0;
function ok(name, cond) { assert.ok(cond, name); passed++; }

// ── strength: rejects ──
for (const weak of [
  '0000', '1111', '9999',          // one digit
  '1212', '2323', '7070',          // abab (two digits)
  '1122', '4455',                  // aabb (two digits)
  '1112', '1222',                  // three-of-a-kind (two digits)
  '1234', '3456', '6789',          // ascending run
  '4321', '9876', '3210',          // descending run
  '2580', '6969', '4200', '2024',  // blocklist
]) {
  ok(`rejects weak ${weak}`, Pin.validate(weak).ok === false);
}

// ── strength: rejects malformed ──
for (const bad of ['', '12', '12345', 'abcd', '12a4', '  12', '1.34', null, undefined]) {
  ok(`rejects malformed ${JSON.stringify(bad)}`, Pin.validate(bad).ok === false);
}

// ── strength: accepts real-world-strong pins ──
for (const good of ['1930', '8261', '5079', '3814', '9027', '4703', '6194']) {
  const v = Pin.validate(good);
  ok(`accepts strong ${good}`, v.ok === true);
}
// every accepted PIN has at least three distinct digits and is not a run
for (const good of ['1930', '8261', '5079', '3814']) {
  const distinct = new Set(good.split('')).size;
  ok(`strong ${good} has >=3 distinct digits`, distinct >= 3);
}

// ── every strength message is em/en-dash free (owner copy ban) ──
for (const weak of ['0000', '1234', '12', '2580']) {
  const msg = Pin.validate(weak).msg || '';
  ok(`message for ${weak} has no em/en dash`, !/[\u2014\u2013]/.test(msg));
}

// ── salt shape matches the rules regex ^[A-Za-z0-9_-]{8,64}$ ──
const SALT_RE = /^[A-Za-z0-9_-]{8,64}$/;
for (let i = 0; i < 200; i++) {
  ok('salt matches rules regex', SALT_RE.test(Pin.newSalt()));
}
ok('two salts differ', Pin.newSalt() !== Pin.newSalt());

// ── hash shape matches the rules regex ^[a-f0-9]{64}$ ──
const HASH_RE = /^[a-f0-9]{64}$/;
const salt = Pin.newSalt();
const h = await Pin.hash('1930', salt);
ok('hash is 64 lowercase hex', HASH_RE.test(h));
ok('hash is deterministic for same salt+pin', (await Pin.hash('1930', salt)) === h);
ok('hash changes with salt', (await Pin.hash('1930', Pin.newSalt())) !== h);
ok('hash changes with pin', (await Pin.hash('8261', salt)) !== h);

// ── make() bundles valid fields and refuses weak pins ──
const fields = await Pin.make('1930', 'Instructor Jane');
ok('make returns salt', SALT_RE.test(fields.pinSalt));
ok('make returns hash', HASH_RE.test(fields.pinHash));
ok('make returns int pinSetAt', Number.isInteger(fields.pinSetAt));
ok('make records pinSetBy', fields.pinSetBy === 'Instructor Jane');
ok('make omits pinSetBy when absent', !('pinSetBy' in (await Pin.make('8261'))));
let threw = false;
try { await Pin.make('1234'); } catch { threw = true; }
ok('make rejects a weak pin', threw);

// ── suggest() always returns a PIN that passes validate() ──
for (let i = 0; i < 500; i++) {
  const s = Pin.suggest();
  ok('suggest passes validate', Pin.validate(s).ok === true);
}
ok('suggest varies', new Set(Array.from({ length: 20 }, () => Pin.suggest())).size > 1);

// ── verify() round trip ──
ok('verify accepts the right pin', (await Pin.verify('1930', fields.pinSalt, fields.pinHash)) === true);
ok('verify rejects the wrong pin', (await Pin.verify('1931', fields.pinSalt, fields.pinHash)) === false);
ok('verify rejects a wrong-length input', (await Pin.verify('19300', fields.pinSalt, fields.pinHash)) === false);
ok('verify rejects empty salt', (await Pin.verify('1930', '', fields.pinHash)) === false);
ok('verify rejects empty hash', (await Pin.verify('1930', fields.pinSalt, '')) === false);

console.log(`PASS pin.test.mjs (${passed} assertions)`);
