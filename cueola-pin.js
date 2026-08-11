/* Cueola student PIN helper. Shared by the front door (cueola-identity.js)
 * and the instructor dashboard (dashboard.html).
 *
 * Threat model, stated honestly so nobody mistakes this for real auth:
 * students sign in with a username and no server-checked secret (the
 * university prohibits student passwords). The 4-digit PIN is a CASUAL
 * IMPERSONATION DETERRENT: it stops a classmate from typing your username
 * and walking in. It is verified CLIENT-SIDE against a salted SHA-256 hash
 * stored on the world-readable profile doc, so a determined attacker with
 * dev tools and database access can brute-force 10,000 combinations offline
 * in under a second. Firestore rules plus App Check remain the real
 * perimeter; instructor powers ride real Firebase Auth, never the PIN.
 *
 * The PIN is stored one way (salt + hash), so nobody, super admins included,
 * can read it back: they can only set or reset it. Weak PINs are refused.
 *
 * Zero dependencies. Hashing via WebCrypto (crypto.subtle), available in
 * every browser context Cueola runs in (https / localhost). The pure
 * strength check is also reachable in Node for the test suite.
 */
(function (root) {
  'use strict';

  var PIN_RE = /^[0-9]{4}$/;

  // Known weak or well-worn PINs. Not exhaustive (the sequence and repeat
  // checks below catch whole families); this is the curated tail of PINs
  // that pass those structural checks but are still guessed first, drawn
  // from the widely published leaked-PIN frequency lists.
  var BLOCKLIST = [
    '0000', '1111', '1234', '1212', '7777', '1004', '2000', '4444', '2222',
    '6969', '9999', '3333', '5555', '6666', '1313', '8888', '4321', '2001',
    '1010', '2580', '5683', '0007', '1342', '1122', '1974', '0852', '2468',
    '1357', '1230', '4200', '1984', '1969', '1979', '1999', '2004', '1985',
    '1986', '1987', '1988', '1989', '1990', '1991', '1992', '1993', '1994',
    '1995', '1996', '1997', '1998', '2020', '2021', '2022', '2023', '2024',
  ];

  // Reject a PIN whose digits step by a constant +1 or -1 (1234, 4321, 3456,
  // 6543), which people reach for first after the obvious repeats.
  function isRun(pin) {
    var step = pin.charCodeAt(1) - pin.charCodeAt(0);
    if (step !== 1 && step !== -1) return false;
    for (var i = 2; i < pin.length; i++) {
      if (pin.charCodeAt(i) - pin.charCodeAt(i - 1) !== step) return false;
    }
    return true;
  }

  // Reject fewer than three distinct digits: kills 0000/1111 (one digit),
  // abab like 1212, aabb like 1122, aaab like 1112, and every other pattern
  // shallow enough to shoulder-surf in one glance.
  function tooFewDigits(pin) {
    var seen = {};
    for (var i = 0; i < pin.length; i++) seen[pin[i]] = true;
    return Object.keys(seen).length < 3;
  }

  // { ok: true } or { ok: false, msg }. msg is user-facing (no em dashes).
  function validate(rawPin) {
    var pin = String(rawPin == null ? '' : rawPin);
    if (!PIN_RE.test(pin)) return { ok: false, msg: 'Your PIN must be exactly 4 digits.' };
    if (tooFewDigits(pin)) return { ok: false, msg: 'Too easy to guess. Use at least three different digits.' };
    if (isRun(pin)) return { ok: false, msg: 'Too easy to guess. Do not use a run like 1234 or 4321.' };
    if (BLOCKLIST.indexOf(pin) >= 0) return { ok: false, msg: 'That PIN is on the too-common list. Pick a less obvious one.' };
    return { ok: true };
  }

  // base64url of `bytes` random bytes (URL-safe, matches the rules salt regex
  // ^[A-Za-z0-9_-]{8,64}$). 12 bytes -> 16 chars.
  function newSalt(bytes) {
    var n = bytes || 12;
    var buf = new Uint8Array(n);
    (root.crypto || root.msCrypto).getRandomValues(buf);
    var s = '';
    for (var i = 0; i < buf.length; i++) s += String.fromCharCode(buf[i]);
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function toHex(buffer) {
    var view = new Uint8Array(buffer);
    var out = '';
    for (var i = 0; i < view.length; i++) {
      var h = view[i].toString(16);
      out += h.length === 1 ? '0' + h : h;
    }
    return out;   // lowercase hex, matches rules ^[a-f0-9]{64}$
  }

  // Salted SHA-256, lowercase hex. Salt binds the hash to one profile so a
  // leak cannot precompute a rainbow table or compare PINs across students.
  function hash(pin, salt) {
    var enc = new TextEncoder();
    var data = enc.encode(String(salt) + ':' + String(pin));
    return (root.crypto || root.msCrypto).subtle.digest('SHA-256', data).then(toHex);
  }

  // Build the storable fields for a fresh PIN. Rejects weak PINs (throws the
  // validation message) so callers cannot skip the check. Async.
  function make(pin, setBy) {
    var v = validate(pin);
    if (!v.ok) return Promise.reject(new Error(v.msg));
    var salt = newSalt();
    return hash(pin, salt).then(function (h) {
      var fields = { pinSalt: salt, pinHash: h, pinSetAt: Date.now() };
      if (setBy) fields.pinSetBy = String(setBy).slice(0, 160);
      return fields;
    });
  }

  // Constant-ish comparison against the stored hash. Async -> boolean.
  function verify(pin, salt, storedHash) {
    if (!PIN_RE.test(String(pin == null ? '' : pin)) || !salt || !storedHash) return Promise.resolve(false);
    return hash(pin, salt).then(function (h) {
      if (h.length !== String(storedHash).length) return false;
      var a = h, b = String(storedHash), diff = 0;
      for (var i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
      return diff === 0;
    });
  }

  // A random 4-digit PIN that passes validate(). Used to seed a strong default
  // when a super admin resets a student PIN. Bounded retries; roughly a fifth
  // of PINs are rejected, so this returns almost immediately.
  function suggest() {
    var buf = new Uint8Array(2);
    for (var tries = 0; tries < 200; tries++) {
      (root.crypto || root.msCrypto).getRandomValues(buf);
      var pin = ('000' + (((buf[0] << 8) | buf[1]) % 10000)).slice(-4);
      if (validate(pin).ok) return pin;
    }
    return '1930';   // deterministic strong fallback (passes validate)
  }

  var api = { validate: validate, newSalt: newSalt, hash: hash, make: make, verify: verify, suggest: suggest, PIN_RE: PIN_RE, BLOCKLIST: BLOCKLIST };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.CueolaPin = api;
})(typeof globalThis !== 'undefined' ? globalThis : (typeof self !== 'undefined' ? self : this));
