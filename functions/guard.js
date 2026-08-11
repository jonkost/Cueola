'use strict';
/* Pure per-username PIN rate-limit state machine. No IO, so it is unit-tested
 * directly (guard.test in pin.test.js). index.js runs it inside a Firestore
 * transaction on pinGuard/{username}, feeding it the stored guard doc and
 * whether the submitted PIN was correct. */

const MAX_ATTEMPTS = 5;                    // wrong tries allowed inside a window
const WINDOW_MS = 15 * 60 * 1000;          // rolling window the tries count in
const LOCK_MS = 15 * 60 * 1000;            // cooldown once the limit is hit

// evaluateGuard(storedGuard, now, pinWasCorrect, opts?) ->
//   { status: 'locked' | 'bad' | 'ok', patch: <merge into the guard doc>|null, retryMs }
// 'locked' means reject without revealing whether the PIN was right; 'bad' is a
// normal wrong PIN; 'ok' clears the guard. patch is null only when already
// locked (nothing to write).
function evaluateGuard(storedGuard, now, ok, opts) {
  const g = storedGuard || {};
  const MAX = (opts && opts.maxAttempts) || MAX_ATTEMPTS;
  const WIN = (opts && opts.windowMs) || WINDOW_MS;
  const LOCK = (opts && opts.lockMs) || LOCK_MS;

  if (g.lockedUntil && g.lockedUntil > now) {
    return { status: 'locked', patch: null, retryMs: g.lockedUntil - now };
  }
  if (ok) {
    return { status: 'ok', patch: { attempts: 0, windowStart: now, lockedUntil: 0, lastAttempt: now }, retryMs: 0 };
  }
  // Wrong PIN: count it inside the rolling window.
  const sameWindow = g.windowStart && (now - g.windowStart) < WIN;
  const windowStart = sameWindow ? g.windowStart : now;
  const attempts = (sameWindow ? (g.attempts || 0) : 0) + 1;
  const patch = { windowStart, attempts, lastAttempt: now };
  if (attempts >= MAX) {
    patch.lockedUntil = now + LOCK;
    patch.attempts = 0;          // reset the counter behind the lock
    patch.windowStart = now;
    return { status: 'locked', patch, retryMs: LOCK };
  }
  return { status: 'bad', patch, retryMs: 0 };
}

module.exports = { evaluateGuard, MAX_ATTEMPTS, WINDOW_MS, LOCK_MS };
