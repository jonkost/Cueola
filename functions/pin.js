'use strict';
/* Server-side PIN hashing for Cueola Cloud Functions.
 *
 * MUST stay byte-identical to the browser helper cueola-pin.js: both compute
 * SHA-256 over the UTF-8 bytes of `${salt}:${pin}` and emit lowercase hex, so a
 * hash written by the client (the current client-side set-PIN flow) verifies
 * here on the server. The shared vectors in pin.test.js lock this equivalence.
 *
 * The 4-digit strength policy (weak-PIN rejection) lives on the client
 * (cueola-pin.js validate/suggest) since it is a UX gate; the server only
 * needs to hash and verify. */
const crypto = require('crypto');

const PIN_RE = /^[0-9]{4}$/;

// Salted SHA-256, lowercase hex. Identical output to the browser's
// crypto.subtle.digest('SHA-256', TextEncoder().encode(`${salt}:${pin}`)).
function hash(pin, salt) {
  return crypto.createHash('sha256').update(`${salt}:${pin}`, 'utf8').digest('hex');
}

// Timing-safe verification of an input PIN against the stored salt + hash.
function verify(pin, salt, storedHash) {
  const p = String(pin == null ? '' : pin);
  if (!PIN_RE.test(p) || !salt || !storedHash) return false;
  const computed = Buffer.from(hash(p, String(salt)), 'utf8');
  const stored = Buffer.from(String(storedHash), 'utf8');
  if (computed.length !== stored.length) return false;
  return crypto.timingSafeEqual(computed, stored);
}

// base64url salt matching the rules regex ^[A-Za-z0-9_-]{8,64}$ (12 bytes -> 16
// chars), same shape the browser helper emits.
function newSalt(bytes) {
  return crypto.randomBytes(bytes || 12)
    .toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

module.exports = { hash, verify, newSalt, PIN_RE };
