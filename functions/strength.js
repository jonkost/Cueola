'use strict';
/* Server-side 4-digit PIN strength policy.
 *
 * MUST stay in lockstep with the browser policy in cueola-pin.js. Profile
 * creation and PIN changes move server-side in Phase 2, so the weak-PIN rules
 * can no longer live only in the browser: a scripted client would otherwise set
 * "1234". The deployed function bundle contains only functions/, so this cannot
 * require('../cueola-pin.js'); instead pin.test.js cross-checks BOTH
 * implementations across the whole 0000-9999 space and fails on any drift.
 *
 * Keep the messages byte-identical to cueola-pin.js so the UI reads the same
 * whether the rejection came from the browser or the server. */

const PIN_RE = /^[0-9]{4}$/;

const BLOCKLIST = [
  '0000', '1111', '1234', '1212', '7777', '1004', '2000', '4444', '2222',
  '6969', '9999', '3333', '5555', '6666', '1313', '8888', '4321', '2001',
  '1010', '2580', '5683', '0007', '1342', '1122', '1974', '0852', '2468',
  '1357', '1230', '4200', '1984', '1969', '1979', '1999', '2004', '1985',
  '1986', '1987', '1988', '1989', '1990', '1991', '1992', '1993', '1994',
  '1995', '1996', '1997', '1998', '2020', '2021', '2022', '2023', '2024',
];

// Digits stepping by a constant +1 or -1 (1234, 4321, 3456, 6543).
function isRun(pin) {
  const step = pin.charCodeAt(1) - pin.charCodeAt(0);
  if (step !== 1 && step !== -1) return false;
  for (let i = 2; i < pin.length; i++) {
    if (pin.charCodeAt(i) - pin.charCodeAt(i - 1) !== step) return false;
  }
  return true;
}

// Fewer than three distinct digits: kills 0000, 1212, 1122, 1112, and friends.
function tooFewDigits(pin) {
  return new Set(pin.split('')).size < 3;
}

function validate(rawPin) {
  const pin = String(rawPin == null ? '' : rawPin);
  if (!PIN_RE.test(pin)) return { ok: false, msg: 'Your PIN must be exactly 4 digits.' };
  if (tooFewDigits(pin)) return { ok: false, msg: 'Too easy to guess. Use at least three different digits.' };
  if (isRun(pin)) return { ok: false, msg: 'Too easy to guess. Do not use a run like 1234 or 4321.' };
  if (BLOCKLIST.indexOf(pin) >= 0) return { ok: false, msg: 'That PIN is on the too-common list. Pick a less obvious one.' };
  return { ok: true };
}

module.exports = { validate, PIN_RE, BLOCKLIST };
