import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

// A pretend browser: localStorage and a WebSocket that plays the Mac app.
const storage = new Map();
globalThis.localStorage = {
  getItem: (k) => (storage.has(k) ? storage.get(k) : null),
  setItem: (k, v) => storage.set(k, String(v)),
  removeItem: (k) => storage.delete(k),
};
const sockets = [];
class FakeSocket {
  constructor(url) { this.url = url; this.readyState = 0; this.sent = []; sockets.push(this); }
  send(text) { this.sent.push(JSON.parse(text)); }
  close() { this.readyState = 3; this.onclose && this.onclose(); }
  // The Mac app's side:
  open() { this.readyState = 1; this.onopen && this.onopen(); }
  reply(msg) { this.onmessage && this.onmessage({ data: JSON.stringify(msg) }); }
}
globalThis.WebSocket = FakeSocket;

const require = createRequire(import.meta.url);
const link = require('../../cueola-mac-link.js');

function test(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

let code = 'AVTLAB';
const acks = [];
link.configure({ getCode: () => code, onAck: (a) => acks.push(a) });

test('off until switched on: never goes looking', () => {
  assert.equal(link.enabled(), false);
  assert.equal(link.status(), 'off');
  assert.equal(sockets.length, 0);
  assert.equal(link.send({ action: 'go' }, 'AVTLAB'), false);
});

test('switched on: looks for the Mac app on this Mac only', () => {
  link.setEnabled(true);
  assert.equal(sockets.length, 1);
  assert.equal(sockets[0].url, 'ws://127.0.0.1:47810');
  assert.equal(link.status(), 'looking');
  assert.equal(link.send({ action: 'go' }, 'AVTLAB'), false, 'nothing sends before the hello');
});

test('a Mac app on another show never takes this show\'s fires', () => {
  const s = sockets[0];
  s.open();
  assert.deepEqual(s.sent[0], { type: 'hello', code: 'AVTLAB' });
  s.reply({ type: 'hello', code: 'OTHER1' });
  assert.equal(link.status(), 'other-show');
  assert.equal(link.macShow(), 'OTHER1');
  assert.equal(link.send({ action: 'go' }, 'AVTLAB'), false);
});

test('same show: commands and levels go straight across', () => {
  const s = sockets[0];
  s.reply({ type: 'hello', code: 'avtlab' });
  assert.equal(link.status(), 'connected');
  const cmd = { commandId: 'out_1', origId: 'out_1', action: 'cue', cueId: 'og_1' };
  assert.equal(link.send(cmd, 'avtlab'), true);
  assert.deepEqual(s.sent.at(-1), { type: 'command', code: 'AVTLAB', command: cmd });
  assert.equal(link.sendGain(0.5, 'g1', 'AVTLAB'), true);
  assert.deepEqual(s.sent.at(-1), { type: 'gain', code: 'AVTLAB', v: 0.5, id: 'g1' });
  assert.equal(link.send(cmd, 'ELSE'), false, 'a command for another show stays off the link');
});

test('replies reach the ack handler', () => {
  sockets[0].reply({ type: 'ack', commandId: 'out_1', origId: 'out_1', ok: true, reason: '', ts: 5 });
  assert.equal(acks.length, 1);
  assert.equal(acks[0].origId, 'out_1');
});

test('the Mac app closing drops back to looking; switching off stops', () => {
  sockets[0].close();
  assert.equal(link.status(), 'looking');
  assert.equal(link.send({ action: 'go' }, 'AVTLAB'), false);
  link.setEnabled(false);
  assert.equal(link.status(), 'off');
  assert.equal(link.enabled(), false);
});
