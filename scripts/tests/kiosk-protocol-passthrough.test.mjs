/* Runs the real Outrangutan output protocol (createController/createOutput)
 * with every envelope carried by a live kiosk helper relay, proving the
 * helper transports the v2 contract unmodified: READY -> SYNC_STATE ->
 * STATE_APPLIED -> command -> COMMAND_ACK -> HEARTBEAT, plus REPLACED
 * retirement when a second renderer instance announces. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { createHelper } from '../kiosk-helper.mjs';

const require = createRequire(import.meta.url);
const Protocol = require('../../outrangutan/output-protocol.js');

let passCount = 0;
async function test(name, fn) {
  try {
    await fn();
    passCount++;
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kiosk-pass-'));
const helper = createHelper({ cacheDir });
const port = await helper.listen(0);
const base = `http://127.0.0.1:${port}`;
const SESSION = 'session_PASS';

/* Minimal relay endpoint mirroring what the pages do: POST wires out, SSE
 * frames in. Collected inbox + waitFor, like the browser message handlers. */
function relayClient(instance, role, onMessage) {
  const controller = new AbortController();
  const ready = fetch(base + '/events?' + new URLSearchParams({ role, session: SESSION, instance }), { signal: controller.signal }).then((res) => {
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    (async () => {
      for (;;) {
        const { done, value } = await reader.read().catch(() => ({ done: true }));
        if (done) return;
        buffer += decoder.decode(value, { stream: true });
        let index;
        while ((index = buffer.indexOf('\n\n')) !== -1) {
          const frame = buffer.slice(0, index);
          buffer = buffer.slice(index + 2);
          const eventMatch = frame.match(/^event: (.+)$/m);
          const dataMatch = frame.match(/^data: (.+)$/m);
          if (eventMatch && eventMatch[1] === 'envelope' && dataMatch) onMessage(JSON.parse(dataMatch[1]));
        }
      }
    })();
    return res;
  });
  return {
    ready,
    send(envelope) {
      return fetch(base + '/send', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ session: SESSION, senderInstance: instance, envelope })
      });
    },
    close() { controller.abort(); }
  };
}

function waitUntil(predicate, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const poll = () => {
      if (predicate()) { resolve(); return; }
      if (Date.now() > deadline) { reject(new Error('waitUntil timeout')); return; }
      setTimeout(poll, 20);
    };
    poll();
  });
}

const CONTROLLER_ID = 'ogc_pass';
const controllerProtocol = Protocol.createController({
  productionSessionId: SESSION,
  controllerInstanceId: CONTROLLER_ID,
  outputIds: ['1']
});
const outputProtocol = Protocol.createOutput({
  productionSessionId: SESSION,
  controllerInstanceId: CONTROLLER_ID,
  outputId: '1',
  outputInstanceId: 'ogout_pass_A',
  state: { windowStatus: 'open', communicationStatus: 'connecting' }
});

// Wire both protocol endpoints to the relay exactly the way the pages do.
const controllerInbox = [];
const outputInbox = [];
const controllerLink = relayClient(CONTROLLER_ID, 'controller', (m) => controllerInbox.push(m));
const outputLink = relayClient('ogout_pass_A', 'output', (m) => { if (outputProtocol.accepts(m)) outputInbox.push(m); });
await controllerLink.ready;
await outputLink.ready;

await test('READY -> SYNC_STATE -> STATE_APPLIED handshake over the relay', async () => {
  await outputLink.send(outputProtocol.buildReady());
  await waitUntil(() => controllerInbox.some((m) => m.commandType === Protocol.MESSAGE_TYPES.READY));
  const ready = controllerInbox.find((m) => m.commandType === Protocol.MESSAGE_TYPES.READY);
  assert.ok(controllerProtocol.noteReady(Protocol.normalizeEnvelope(ready)));

  const sync = controllerProtocol.buildSyncState('1', {});
  await controllerLink.send(sync);
  await waitUntil(() => outputInbox.some((m) => m.commandType === Protocol.MESSAGE_TYPES.SYNC_STATE));
  const gotSync = Protocol.normalizeEnvelope(outputInbox.find((m) => m.commandType === Protocol.MESSAGE_TYPES.SYNC_STATE));
  assert.deepEqual(gotSync, Protocol.normalizeEnvelope(sync)); // byte-faithful transit
  assert.ok(outputProtocol.applySyncState(gotSync));

  await outputLink.send(outputProtocol.buildStateApplied());
  await waitUntil(() => controllerInbox.some((m) => m.commandType === Protocol.MESSAGE_TYPES.STATE_APPLIED));
  const applied = controllerInbox.find((m) => m.commandType === Protocol.MESSAGE_TYPES.STATE_APPLIED);
  assert.equal(controllerProtocol.markStateApplied(Protocol.normalizeEnvelope(applied)), true);
  assert.equal(controllerProtocol.isReady('1', 'ogout_pass_A'), true);
});

await test('command and ack round-trip over the relay', async () => {
  const command = controllerProtocol.buildCommand('PLAY', { outputId: '1', mediaId: 'm_x', payload: { at: 0 } });
  await controllerLink.send(command);
  await waitUntil(() => outputInbox.some((m) => m.commandType === 'PLAY'));
  const got = Protocol.normalizeEnvelope(outputInbox.find((m) => m.commandType === 'PLAY'));
  assert.equal(got.commandId, command.commandId);
  assert.equal(got.mediaId, 'm_x');
  const begin = outputProtocol.beginCommand(got);
  assert.ok(begin.accepted);
  const ack = outputProtocol.completeCommand(begin.command, { ok: true }, { playbackStatus: 'playing' });
  await outputLink.send(ack);
  await waitUntil(() => controllerInbox.some((m) => m.commandType === Protocol.MESSAGE_TYPES.COMMAND_ACK));
  const gotAck = controllerInbox.find((m) => m.commandType === Protocol.MESSAGE_TYPES.COMMAND_ACK);
  const noted = controllerProtocol.noteAck(Protocol.normalizeEnvelope(gotAck));
  assert.ok(noted);
});

await test('heartbeats update controller state over the relay', async () => {
  await outputLink.send(outputProtocol.buildHeartbeat({ playbackStatus: 'playing' }));
  await waitUntil(() => controllerInbox.some((m) => m.commandType === Protocol.MESSAGE_TYPES.HEARTBEAT));
  const heartbeat = controllerInbox.find((m) => m.commandType === Protocol.MESSAGE_TYPES.HEARTBEAT);
  assert.equal(controllerProtocol.noteHeartbeat(Protocol.normalizeEnvelope(heartbeat)), true);
});

await test('a second renderer instance is adopted and the old one retired (REPLACED)', async () => {
  const secondProtocol = Protocol.createOutput({
    productionSessionId: SESSION,
    controllerInstanceId: CONTROLLER_ID,
    outputId: '1',
    outputInstanceId: 'ogout_pass_B',
    state: { windowStatus: 'open', communicationStatus: 'connecting' }
  });
  const secondInbox = [];
  const secondLink = relayClient('ogout_pass_B', 'output', (m) => { if (secondProtocol.accepts(m)) secondInbox.push(m); });
  await secondLink.ready;
  await secondLink.send(secondProtocol.buildReady());
  await waitUntil(() => controllerInbox.filter((m) => m.commandType === Protocol.MESSAGE_TYPES.READY).length >= 2);
  const readyB = controllerInbox.filter((m) => m.commandType === Protocol.MESSAGE_TYPES.READY).find((m) => m.outputInstanceId === 'ogout_pass_B');
  // Controller-side flow on a new instance: retire the old renderer, adopt the new.
  const replaced = controllerProtocol.buildCommand('REPLACED_NOTICE', { outputId: '1' });
  assert.ok(controllerProtocol.noteReady(Protocol.normalizeEnvelope(readyB)));
  await controllerLink.send(replaced);
  const sync = controllerProtocol.buildSyncState('1', {});
  await controllerLink.send(sync);
  await waitUntil(() => secondInbox.some((m) => m.commandType === Protocol.MESSAGE_TYPES.SYNC_STATE));
  assert.ok(secondProtocol.applySyncState(Protocol.normalizeEnvelope(secondInbox.find((m) => m.commandType === Protocol.MESSAGE_TYPES.SYNC_STATE))));
  await secondLink.send(secondProtocol.buildStateApplied());
  await waitUntil(() => controllerInbox.filter((m) => m.commandType === Protocol.MESSAGE_TYPES.STATE_APPLIED).length >= 2);
  const appliedB = controllerInbox.filter((m) => m.commandType === Protocol.MESSAGE_TYPES.STATE_APPLIED).find((m) => m.outputInstanceId === 'ogout_pass_B');
  assert.equal(controllerProtocol.markStateApplied(Protocol.normalizeEnvelope(appliedB)), true);
  assert.equal(controllerProtocol.isReady('1', 'ogout_pass_B'), true);
  assert.equal(controllerProtocol.isReady('1', 'ogout_pass_A'), false);
  secondLink.close();
});

controllerLink.close();
outputLink.close();
await helper.close();
fs.rmSync(cacheDir, { recursive: true, force: true });
console.log(`PASS ${passCount} kiosk protocol pass-through tests`);
