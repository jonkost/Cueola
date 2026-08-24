/* cueola-obs.js — connection error lifecycle.
 *
 * The deck screen shows the OBS failure reason (the .sd-obs-err line) purely
 * from what this client records and announces. If a failure sets no reason, or
 * sets one without calling the change callback, the operator gets a dead grey
 * dot and no explanation — which is exactly the bug this suite pins shut.
 *
 * The real module is loaded and its handshake driven message by message against
 * a fake WebSocket; nothing here re-implements the logic under test.
 *
 *     node scripts/tests/obs-client.test.mjs
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MODULE_PATH = path.join(HERE, '..', '..', 'cueola-obs.js');

const realSetTimeout = globalThis.setTimeout;
const tick = () => new Promise((r) => realSetTimeout(r, 0));

// ── Environment shims ───────────────────────────────────────────────────────
const store = new Map();
globalThis.window = globalThis;
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
};

let sockets = [];
let throwOnConstruct = false;
class FakeWS {
  constructor(url) {
    if (throwOnConstruct) throw new Error('refused');
    this.url = url;
    this.readyState = 1; // the client waits for the Hello frame, not onopen
    this.sent = [];
    sockets.push(this);
  }
  send(s) { this.sent.push(JSON.parse(s)); }
  close() { this.readyState = 3; if (this.onclose) this.onclose(); }
  deliver(obj) { if (this.onmessage) return this.onmessage({ data: JSON.stringify(obj) }); }
  fail() { this.readyState = 3; if (this.onerror) this.onerror(); if (this.onclose) this.onclose(); }
}
globalThis.WebSocket = FakeWS;

// Capture timers so no real 3s reconnect or 5s request timeout is scheduled.
let timers = [];
globalThis.setTimeout = (fn, delay) => { timers.push({ fn, delay }); return timers.length; };
globalThis.clearTimeout = () => {};
function fireDelay(d) {
  const hit = timers.filter((t) => t.delay === d);
  timers = timers.filter((t) => t.delay !== d);
  hit.forEach((t) => t.fn());
  return hit.length;
}

vm.runInThisContext(fs.readFileSync(MODULE_PATH, 'utf8'));
const OBS = globalThis.window.CueolaOBS;
assert.ok(OBS, 'CueolaOBS attaches to window');

let seen = [];
OBS.onChange(() => { seen.push({ connected: OBS.isReady(), err: OBS.lastError() }); });

const HELLO_AUTH = { op: 0, d: { authentication: { salt: 's4lt', challenge: 'ch4l' } } };
let passed = 0;
const ok = (label) => { passed++; console.log('PASS ' + label); };

// ── A password-protected OBS with no password set explains itself ───────────
sockets = []; seen = [];
OBS.configure({ url: 'ws://localhost:4455', password: '' });
OBS.connect();
await tick();
await sockets[0].deliver(HELLO_AUTH);
await tick();
assert.match(OBS.lastError(), /needs a password/i);
assert.equal(OBS.isReady(), false);
assert.ok(seen.some((s) => /needs a password/i.test(s.err)),
  'the change callback carries the reason — without this the UI never learns why');
ok('password-required failure records a reason AND announces it');

// ── A hand-driven retry resets the standing reason, then connects ───────────
assert.ok(OBS.lastError(), 'precondition: a reason is standing');
sockets = []; seen = [];
OBS.configure({ url: 'ws://localhost:4455', password: 'pw' });
OBS.connect();                                  // operator-driven: quiet is falsy
assert.equal(OBS.lastError(), '', 'the stale reason clears as the attempt starts');
assert.ok(seen.some((s) => s.err === ''), 'the reset is announced');
await tick();
await sockets[0].deliver(HELLO_AUTH);
await tick();
const identify = sockets[0].sent.find((m) => m.op === 1);
assert.ok(identify && identify.d.authentication, 'Identify carries a computed auth response');
await sockets[0].deliver({ op: 2, d: {} });     // IDENTIFIED
await tick();
assert.equal(OBS.isReady(), true);
assert.equal(OBS.lastError(), '');
ok('manual reconnect clears the stale reason and completes the handshake');

// ── The 3s automatic retry must NOT wipe the message off the screen ─────────
OBS.disconnect();
sockets = []; seen = []; timers = [];
OBS.configure({ url: 'ws://localhost:4455', password: 'pw' });
OBS.connect();
await tick();
sockets[0].fail();                              // unreachable
await tick();
const standing = OBS.lastError();
assert.match(standing, /not reachable/i);
assert.equal(fireDelay(3000), 1, 'a reconnect is scheduled');
await tick();
assert.equal(OBS.lastError(), standing, 'the automatic retry keeps the reason visible');
ok('automatic retry preserves the standing reason');

// ── A refused socket construction still reaches the UI ──────────────────────
OBS.disconnect();
sockets = []; seen = []; timers = [];
throwOnConstruct = true;
OBS.connect();
throwOnConstruct = false;
assert.match(OBS.lastError(), /could not open/i);
assert.ok(seen.length >= 1, 'the throw path announces rather than failing silently');
ok('socket-construction failure records a reason AND announces it');

// ── Announcing must not re-enter connect or stack reconnect timers ──────────
assert.ok(timers.filter((t) => t.delay === 3000).length <= 1, 'at most one reconnect outstanding');
ok('announcing state does not re-enter connect or stack timers');

// ── A malformed address is refused before any socket is opened ──────────────
OBS.disconnect();
sockets = []; timers = [];
OBS.configure({ url: 'http://localhost:4455', password: '' });
OBS.connect();
assert.match(OBS.lastError(), /must start with ws:\/\//i);
assert.equal(sockets.length, 0, 'no socket attempted for a non-ws address');
ok('a non-ws address is rejected with a reason and no socket');

console.log(passed + ' OBS client tests passed.');
