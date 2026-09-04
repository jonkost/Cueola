// cueola-obs.js contract: the obs-websocket v5 client behind KeyWi's OBS keys.
// Runs the real script in a vm sandbox with a fake global WebSocket and a fake
// clock, so the handshake, keepalive, close-code, and socket-ownership rules
// are pinned without OBS or a browser.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../../cueola-obs.js', import.meta.url), 'utf8');

// ── Fake clock: setTimeout/setInterval the script sees, advanced by hand ──────
function makeClock() {
  let now = 0, seq = 0;
  const timers = new Map();
  const add = (fn, ms, repeat) => { const id = ++seq; timers.set(id, { id, fn, ms: Math.max(0, ms | 0), due: now + Math.max(0, ms | 0), repeat }); return id; };
  return {
    now: () => now,
    setTimeout: (fn, ms) => add(fn, ms, false),
    setInterval: (fn, ms) => add(fn, ms, true),
    clearTimeout: (id) => { timers.delete(id); },
    clearInterval: (id) => { timers.delete(id); },
    // Advance in steps so every due timer fires in order and microtasks drain between them.
    async advance(ms) {
      const target = now + ms;
      for (;;) {
        const due = [...timers.values()].filter(t => t.due <= target).sort((a, b) => a.due - b.due || a.id - b.id)[0];
        if (!due) break;
        now = due.due;
        if (due.repeat) due.due = now + due.ms; else timers.delete(due.id);
        try { due.fn(); } catch {}
        await flush();
      }
      now = target;
      await flush();
    },
    pending: () => timers.size,
  };
}
async function flush() { for (let i = 0; i < 8; i++) await new Promise(r => setImmediate(r)); }

// ── Fake WebSocket: a scripted OBS on the other end ───────────────────────────
class FakeWebSocket {
  constructor(url) {
    this.url = url; this.readyState = 0; this.sent = []; this.closeCalls = 0;
    this.onopen = null; this.onmessage = null; this.onclose = null; this.onerror = null;
    this.auto = true;            // answer requests with canned success unless a test says otherwise
    this.answers = {};           // requestType -> responseData or { fail: 'comment' }
    FakeWebSocket.instances.push(this);
  }
  send(text) {
    const msg = JSON.parse(text);
    this.sent.push(msg);
    if (msg.op === 6 && this.auto) {
      const a = this.answers[msg.d.requestType];
      // Answer on a microtask, the way a real socket delivers after send returns.
      Promise.resolve().then(() => {
        if (this.readyState !== 1) return;
        if (a && a.fail) this.message({ op: 7, d: { requestType: msg.d.requestType, requestId: msg.d.requestId, requestStatus: { result: false, code: 600, comment: a.fail } } });
        else this.message({ op: 7, d: { requestType: msg.d.requestType, requestId: msg.d.requestId, requestStatus: { result: true, code: 100 }, responseData: a || {} } });
      });
    }
  }
  close() { this.closeCalls++; if (this.readyState < 2) this.readyState = 2; }
  open() { this.readyState = 1; this.onopen && this.onopen({}); }
  message(obj) { this.onmessage && this.onmessage({ data: JSON.stringify(obj) }); }
  fireClose(code) { this.readyState = 3; this.onclose && this.onclose({ code }); }
  requests(type) { return this.sent.filter(m => m.op === 6 && (!type || m.d.requestType === type)); }
}
FakeWebSocket.instances = [];

// ── Boot the script in a sandbox ──────────────────────────────────────────────
function boot() {
  FakeWebSocket.instances = [];
  const clock = makeClock();
  const store = { cueola_obs_config: JSON.stringify({ url: 'ws://localhost:4455', password: '' }) };
  const sandbox = {
    WebSocket: FakeWebSocket,
    localStorage: { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } },
    setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout, setInterval: clock.setInterval, clearInterval: clock.clearInterval,
    Date, JSON, Math, Object, Promise, Error, RegExp, String, Array, console,
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename: 'cueola-obs.js' });
  const obs = sandbox.CueolaOBS;
  const emits = [];
  obs.onChange(s => emits.push({ connected: s.connected, streaming: s.streaming, recording: s.recording, currentScene: s.currentScene }));
  return { obs, clock, emits, sockets: FakeWebSocket.instances };
}
async function handshake(t) {
  t.obs.connect();
  const ws = t.sockets[t.sockets.length - 1];
  ws.open();
  ws.message({ op: 0, d: { obsWebSocketVersion: '5.3.0', rpcVersion: 1 } });
  await flush();
  ws.message({ op: 2, d: { negotiatedRpcVersion: 1 } });
  await flush();
  return ws;
}

const tests = [];
function test(name, run) { tests.push({ name, run }); }

test('Identified sets ready and the first connected emit carries primed status', async () => {
  const t = boot();
  const ws = await handshake(t);
  const identify = ws.sent.find(m => m.op === 1);
  assert.ok(identify, 'Identify was sent after Hello');
  assert.equal(identify.d.rpcVersion, 1);
  assert.ok(identify.d.eventSubscriptions & (1 << 10), 'Ui events (StudioModeStateChanged) are subscribed');
  assert.ok(identify.d.eventSubscriptions & (1 << 6), 'Outputs events are subscribed');
  assert.equal(t.obs.isReady(), true);
  assert.equal(t.obs.lastError(), '');
  assert.ok(ws.requests('GetStreamStatus').length >= 1 && ws.requests('GetRecordStatus').length >= 1, 'primeState re-read stream and record status');
  const first = t.emits.find(e => e.connected);
  assert.ok(first, 'a connected emit happened');
  assert.equal(t.emits.indexOf(first), 0, 'no emit fired before primeState finished (no stale flash)');
});

test('request() rejects at once on a socket that is not OPEN instead of a silent timeout', async () => {
  const t = boot();
  const ws = await handshake(t);
  ws.readyState = 2;   // CLOSING: the close handshake is still in flight
  await assert.rejects(t.obs.request('GetVersion'), /OBS not connected/);
});

test('keepalive re-reads status every 5s on the timer and emits only on change', async () => {
  const t = boot();
  const ws = await handshake(t);
  const before = ws.requests('GetStreamStatus').length;
  const emitsBefore = t.emits.length;
  await t.clock.advance(5000);
  assert.equal(ws.requests('GetStreamStatus').length, before + 1);
  assert.equal(ws.requests('GetRecordStatus').length, before + 1);
  assert.equal(t.emits.length, emitsBefore, 'unchanged status does not emit');
  ws.answers.GetStreamStatus = { outputActive: true };
  await t.clock.advance(5000);
  assert.equal(t.obs.state().streaming, true);
  assert.equal(t.obs.state().streamState, 'OBS_WEBSOCKET_OUTPUT_STARTED', 'active status settles the transition word');
  assert.equal(t.emits.length, emitsBefore + 1, 'a real change emits once');
});

test('two silent keepalives mark OBS dead, detach the socket, and schedule a reconnect', async () => {
  const t = boot();
  const ws = await handshake(t);
  ws.auto = false;   // OBS froze: nothing answers, the TCP link stays up
  await t.clock.advance(9500);
  assert.equal(t.obs.isReady(), true, 'one miss is not death');
  const pendingReq = t.obs.request('GetVersion');   // a press mid-freeze, still open when the link is declared dead
  pendingReq.catch(() => {});
  await t.clock.advance(4500);
  assert.equal(t.obs.isReady(), false, 'declared dead after the second unanswered keepalive');
  assert.equal(t.obs.lastError(), 'OBS stopped answering');
  assert.equal(ws.onclose, null, 'old socket handlers were detached');
  assert.equal(ws.onmessage, null);
  assert.ok(ws.closeCalls >= 1, 'old socket was asked to close');
  await assert.rejects(pendingReq, /OBS stopped answering/);
  assert.equal(t.obs.state().connected, false);
  assert.equal(t.emits[t.emits.length - 1].connected, false, 'emitChange announced the drop');
  const count = t.sockets.length;
  await t.clock.advance(3000);
  assert.equal(t.sockets.length, count + 1, 'reconnect attempt after 3s');
  // The frozen socket's late close must not touch the new connection.
  ws.readyState = 3; ws.fireClose(1006);
  assert.equal(t.sockets[t.sockets.length - 1].onclose !== null, true);
});

test('a slow but talking OBS is not declared dead: any message resets the miss count', async () => {
  const t = boot();
  const ws = await handshake(t);
  ws.auto = false;
  await t.clock.advance(9500);   // first keepalive timed out (one miss)
  ws.message({ op: 5, d: { eventType: 'CurrentProgramSceneChanged', eventData: { sceneName: 'B' } } });
  await t.clock.advance(4500);   // second keepalive times out, but the event reset the count
  assert.equal(t.obs.isReady(), true);
  assert.equal(t.obs.state().currentScene, 'B');
});

test('close 4009 stops reconnecting with the password message; Connect starts clean', async () => {
  const t = boot();
  const ws = await handshake(t);
  ws.fireClose(4009);
  assert.equal(t.obs.isReady(), false);
  assert.equal(t.obs.lastError(), 'OBS rejected the password. Open Deck settings, OBS Studio, and enter the current one.');
  const count = t.sockets.length;
  await t.clock.advance(10000);
  assert.equal(t.sockets.length, count, 'no reconnect storm after a rejected password');
  assert.equal(t.clock.pending(), 0, 'no timers left running');
  t.obs.connect();
  assert.equal(t.sockets.length, count + 1, 'a later Connect opens a fresh socket');
});

test('close 4010 stops with an update message; 4011 keeps retrying', async () => {
  let t = boot();
  let ws = await handshake(t);
  ws.fireClose(4010);
  assert.match(t.obs.lastError(), /Update OBS Studio/);
  let count = t.sockets.length;
  await t.clock.advance(10000);
  assert.equal(t.sockets.length, count);

  t = boot();
  ws = await handshake(t);
  ws.fireClose(4011);
  assert.equal(t.obs.isReady(), false);
  count = t.sockets.length;
  await t.clock.advance(3000);
  assert.equal(t.sockets.length, count + 1, 'SessionInvalidated retries');
});

test('a refused request rejects the caller and sets lastRequestError, never lastError', async () => {
  const t = boot();
  const ws = await handshake(t);
  ws.answers.ToggleStream = { fail: 'Output is already in transition' };
  ws.answers.SetCurrentProgramScene = { fail: 'No source was found by the name of `Old`.' };
  const errors = [];
  const onUnhandled = (e) => errors.push(e);
  process.on('unhandledRejection', onUnhandled);
  try {
    t.obs.toggleStream();   // fire-and-forget caller: no console noise
    await flush();
    assert.equal(t.obs.lastRequestError(), 'Output is already in transition');
    assert.equal(t.obs.lastError(), '', 'connection-level error stays clean');
    assert.equal(t.obs.isReady(), true);
    await assert.rejects(t.obs.setScene('Old'), /No source was found/);
    assert.match(t.obs.lastRequestError(), /No source was found/);
    const ok = await t.obs.toggleRecord();
    assert.deepEqual(ok, {});
    await flush();
  } finally { process.off('unhandledRejection', onUnhandled); }
  assert.equal(errors.length, 0, 'no unhandled rejection from an ignored control promise');
});

test('events store the transition word alongside the flag', async () => {
  const t = boot();
  const ws = await handshake(t);
  ws.message({ op: 5, d: { eventType: 'StreamStateChanged', eventData: { outputActive: false, outputState: 'OBS_WEBSOCKET_OUTPUT_STARTING' } } });
  assert.equal(t.obs.state().streaming, false);
  assert.equal(t.obs.state().streamState, 'OBS_WEBSOCKET_OUTPUT_STARTING');
  ws.message({ op: 5, d: { eventType: 'StreamStateChanged', eventData: { outputActive: true, outputState: 'OBS_WEBSOCKET_OUTPUT_STARTED' } } });
  assert.equal(t.obs.state().streaming, true);
  ws.message({ op: 5, d: { eventType: 'RecordStateChanged', eventData: { outputActive: true, outputState: 'OBS_WEBSOCKET_OUTPUT_STARTED' } } });
  assert.equal(t.obs.state().recordState, 'OBS_WEBSOCKET_OUTPUT_STARTED');
  ws.message({ op: 5, d: { eventType: 'StudioModeStateChanged', eventData: { studioModeEnabled: true } } });
  assert.equal(t.obs.state().studioMode, true);
});

test('a generic close resets streaming and the rest of the mirror, then reconnects', async () => {
  const t = boot();
  const ws = await handshake(t);
  ws.message({ op: 5, d: { eventType: 'StreamStateChanged', eventData: { outputActive: true, outputState: 'OBS_WEBSOCKET_OUTPUT_STARTED' } } });
  ws.message({ op: 5, d: { eventType: 'RecordStateChanged', eventData: { outputActive: true, outputState: 'OBS_WEBSOCKET_OUTPUT_STARTED' } } });
  ws.message({ op: 5, d: { eventType: 'InputMuteStateChanged', eventData: { inputName: 'Mic', inputMuted: true } } });
  assert.equal(t.obs.state().streaming, true);
  ws.fireClose(1006);
  const s = t.obs.state();
  assert.equal(s.connected, false);
  assert.equal(s.streaming, false);
  assert.equal(s.recording, false);
  assert.equal(s.streamState, '');
  assert.equal(s.currentScene, '');
  assert.deepEqual(Object.keys(s.mutes), []);
  assert.equal(t.obs.lastError(), 'OBS connection closed');
  const count = t.sockets.length;
  await t.clock.advance(3000);
  assert.equal(t.sockets.length, count + 1);
});

test('an orphaned socket cannot flip ready on the connection that replaced it', async () => {
  const t = boot();
  const first = await handshake(t);
  const staleOnclose = first.onclose;
  t.obs.disconnect();
  assert.equal(first.onclose, null, 'disconnect detaches before close');
  assert.equal(first.closeCalls, 1);
  assert.equal(t.obs.isReady(), false);
  const second = await handshake(t);
  assert.notEqual(first, second);
  assert.equal(t.obs.isReady(), true);
  // The old handler fires late (close handshake finally finished): guard drops it.
  staleOnclose({ code: 1000 });
  first.fireClose(1000);
  assert.equal(t.obs.isReady(), true, 'ready survives the orphan close');
  assert.equal(t.obs.state().connected, true);
  const count = t.sockets.length;
  await t.clock.advance(3000);
  assert.equal(t.sockets.length, count, 'no reconnect was scheduled by the orphan');
});

test('connect() over a CLOSING socket detaches it before opening a new one', async () => {
  const t = boot();
  const first = await handshake(t);
  first.readyState = 2;
  t.obs.connect();
  assert.equal(first.onclose, null);
  assert.equal(t.sockets.length, 2);
  first.fireClose(1000);
  const second = await (async () => { const ws = t.sockets[1]; ws.open(); ws.message({ op: 0, d: { rpcVersion: 1 } }); await flush(); ws.message({ op: 2, d: { negotiatedRpcVersion: 1 } }); await flush(); return ws; })();
  assert.equal(t.obs.isReady(), true);
  assert.equal(second.onclose !== null, true);
});

test('missing password when OBS demands auth stops with a clear message and no loop', async () => {
  const t = boot();
  t.obs.connect();
  const ws = t.sockets[0];
  ws.open();
  ws.message({ op: 0, d: { rpcVersion: 1, authentication: { challenge: 'c', salt: 's' } } });
  await flush();
  assert.match(t.obs.lastError(), /needs a password/);
  assert.equal(ws.onclose, null);
  await t.clock.advance(10000);
  assert.equal(t.sockets.length, 1);
});

test('a socket stuck in CONNECTING is declared dead after 8s and the reconnect loop resumes', async () => {
  const t = boot();
  t.obs.connect();
  const ws = t.sockets[0];
  // Hung OBS: TCP completes, the 101 never comes. The browser has no handshake timeout of its own.
  await t.clock.advance(7900);
  assert.equal(ws.onclose !== null, true, 'still waiting inside the deadline');
  assert.equal(t.sockets.length, 1);
  t.obs.connect();
  assert.equal(t.sockets.length, 1, 'a manual Connect inside the deadline does not replace a CONNECTING socket');
  await t.clock.advance(200);
  assert.equal(t.obs.lastError(), 'OBS is not completing the handshake');
  assert.equal(t.obs.isReady(), false);
  assert.equal(ws.onclose, null, 'stuck socket handlers were detached');
  assert.equal(ws.onmessage, null);
  assert.ok(ws.closeCalls >= 1, 'stuck socket was asked to close');
  assert.equal(t.emits[t.emits.length - 1].connected, false, 'emitChange announced the failure');
  await t.clock.advance(3000);
  assert.equal(t.sockets.length, 2, 'reconnect attempt after a further 3s');
  const next = t.sockets[1];
  assert.equal(next.onclose !== null, true, 'the fresh socket owns the handlers');
  // The old socket's late close cannot touch the replacement.
  ws.readyState = 3; ws.fireClose(1006);
  assert.equal(next.onclose !== null, true);
  // A finished handshake on the replacement clears its deadline: nothing fires at +8s.
  next.open(); next.message({ op: 0, d: { rpcVersion: 1 } }); await flush();
  next.message({ op: 2, d: { negotiatedRpcVersion: 1 } }); await flush();
  assert.equal(t.obs.isReady(), true);
  await t.clock.advance(8500);
  assert.equal(t.obs.isReady(), true, 'deadline cleared on Identified');
  assert.equal(t.obs.lastError(), '');
});

test('OPEN plus Hello but no Identified also hits the handshake deadline', async () => {
  const t = boot();
  t.obs.connect();
  const ws = t.sockets[0];
  ws.open();
  ws.message({ op: 0, d: { obsWebSocketVersion: '5.3.0', rpcVersion: 1 } });
  await flush();
  assert.ok(ws.sent.find(m => m.op === 1), 'Identify was sent');
  await t.clock.advance(7900);
  assert.equal(t.obs.lastError(), '', 'no failure inside the deadline');
  await t.clock.advance(200);
  assert.equal(t.obs.isReady(), false);
  assert.equal(t.obs.lastError(), 'OBS is not completing the handshake');
  assert.equal(ws.onmessage, null, 'handlers detached');
  assert.ok(ws.closeCalls >= 1);
  const count = t.sockets.length;
  await t.clock.advance(3000);
  assert.equal(t.sockets.length, count + 1, 'reconnect scheduled');
  // A late Identified from the dead socket is ignored (handlers are gone).
  ws.message({ op: 2, d: { negotiatedRpcVersion: 1 } });
  assert.equal(t.obs.isReady(), false);
});

test('disconnect() during CONNECTING clears the handshake deadline and leaves no timers', async () => {
  const t = boot();
  t.obs.connect();
  t.obs.disconnect();
  assert.equal(t.clock.pending(), 0, 'no deadline left ticking');
  await t.clock.advance(12000);
  assert.equal(t.sockets.length, 1, 'no reconnect after an explicit disconnect');
  assert.equal(t.obs.lastError(), '');
});

test('public surface stays compatible for cueola-app.js and cueola-streamdeck.js', async () => {
  const t = boot();
  for (const k of ['configure', 'config', 'connect', 'disconnect', 'isReady', 'lastError', 'lastRequestError', 'state', 'onChange',
    'setScene', 'toggleStream', 'toggleRecord', 'pauseRecord', 'toggleVirtualCam', 'saveReplay', 'studioTransition', 'toggleMute', 'setVolume', 'request']) {
    assert.equal(typeof t.obs[k], 'function', k);
  }
  assert.doesNotMatch(source, /[–—]/, 'no em or en dashes in the client');
});

for (const { name, run } of tests) {
  await run();
  console.log('PASS', name);
}
console.log(`PASS ${tests.length} OBS client tests`);
