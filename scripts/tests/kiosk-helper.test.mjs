import assert from 'node:assert/strict';
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHelper, originAllowed, HELPER_APP, HELPER_VERSION } from '../kiosk-helper.mjs';

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

function jsonFetch(base, path, options = {}) {
  return fetch(base + path, options).then(async (res) => ({ status: res.status, headers: res.headers, body: await res.json().catch(() => null) }));
}

/* Reads SSE frames off a fetch body stream; resolves collected events by name. */
function sseClient(base, params) {
  const controller = new AbortController();
  const events = [];
  const waiters = [];
  const ready = fetch(base + '/events?' + new URLSearchParams(params), { signal: controller.signal }).then((res) => {
    assert.equal(res.status, 200);
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
          if (!eventMatch || !dataMatch) continue;
          const entry = { event: eventMatch[1], data: JSON.parse(dataMatch[1]) };
          events.push(entry);
          waiters.splice(0).forEach((resolve) => resolve());
        }
      }
    })();
    return res;
  });
  return {
    ready,
    events,
    async waitFor(predicate, timeoutMs = 2000) {
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        const found = events.find(predicate);
        if (found) return found;
        if (Date.now() > deadline) throw new Error('sse-wait-timeout');
        await new Promise((resolve) => { waiters.push(resolve); setTimeout(resolve, 50); });
      }
    },
    close() { controller.abort(); }
  };
}

const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kiosk-helper-test-'));
const helper = createHelper({ cacheDir });
const port = await helper.listen(0);
const base = `http://127.0.0.1:${port}`;

await test('origin allowlist admits cueola.live, localhost, and no-origin clients only', () => {
  assert.equal(originAllowed('https://cueola.live'), true);
  assert.equal(originAllowed('http://localhost:3001'), true);
  assert.equal(originAllowed('http://127.0.0.1:8010'), true);
  assert.equal(originAllowed(''), true);
  assert.equal(originAllowed(undefined), true);
  assert.equal(originAllowed('https://evil.example'), false);
  assert.equal(originAllowed('https://cueola.live.evil.example'), false);
  assert.equal(originAllowed('http://192.168.1.20:3001'), false);
});

await test('health reports helper identity', async () => {
  const res = await jsonFetch(base, '/health');
  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.app, HELPER_APP);
  assert.equal(res.body.version, HELPER_VERSION);
  assert.equal(res.body.port, port);
});

await test('disallowed Origin is refused with 403', async () => {
  const res = await jsonFetch(base, '/health', { headers: { Origin: 'https://evil.example' } });
  assert.equal(res.status, 403);
});

await test('allowed Origin is echoed in CORS headers', async () => {
  const res = await jsonFetch(base, '/health', { headers: { Origin: 'https://cueola.live' } });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('access-control-allow-origin'), 'https://cueola.live');
});

await test('OPTIONS preflight answers CORS and Private Network Access', async () => {
  const res = await fetch(base + '/send', {
    method: 'OPTIONS',
    headers: {
      Origin: 'https://cueola.live',
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Private-Network': 'true'
    }
  });
  assert.equal(res.status, 204);
  assert.equal(res.headers.get('access-control-allow-private-network'), 'true');
  assert.ok(res.headers.get('access-control-allow-methods').includes('POST'));
});

await test('relay delivers envelopes to session subscribers except the sender', async () => {
  const controller = sseClient(base, { role: 'controller', session: 'session_ABCD', instance: 'ctrl-1' });
  const output = sseClient(base, { role: 'output', session: 'session_ABCD', output: '1', instance: 'out-1' });
  await controller.ready;
  await output.ready;
  await controller.waitFor((e) => e.event === 'hello');
  await output.waitFor((e) => e.event === 'hello');

  const envelope = { protocolVersion: 2, commandId: 'cmd_1', commandType: 'PLAY', payload: { nested: { deep: true } } };
  const send = await jsonFetch(base, '/send', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ session: 'session_ABCD', senderInstance: 'ctrl-1', envelope })
  });
  assert.equal(send.status, 200);
  assert.equal(send.body.delivered, 1);

  const received = await output.waitFor((e) => e.event === 'envelope');
  assert.deepEqual(received.data, envelope);
  assert.equal(controller.events.filter((e) => e.event === 'envelope').length, 0);
  controller.close();
  output.close();
});

await test('relay isolates sessions', async () => {
  const a = sseClient(base, { role: 'output', session: 'session_AAAA', instance: 'out-a' });
  const b = sseClient(base, { role: 'output', session: 'session_BBBB', instance: 'out-b' });
  await a.ready; await b.ready;
  await a.waitFor((e) => e.event === 'hello');
  await b.waitFor((e) => e.event === 'hello');
  await jsonFetch(base, '/send', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ session: 'session_AAAA', senderInstance: 'someone-else', envelope: { commandId: 'iso_1' } })
  });
  await a.waitFor((e) => e.event === 'envelope' && e.data.commandId === 'iso_1');
  assert.equal(b.events.filter((e) => e.event === 'envelope').length, 0);
  a.close(); b.close();
});

await test('relay preserves ordering', async () => {
  const out = sseClient(base, { role: 'output', session: 'session_ORDER', instance: 'out-1' });
  await out.ready;
  await out.waitFor((e) => e.event === 'hello');
  for (let i = 0; i < 20; i++) {
    // Sequential awaits: ordering is asserted for ordered submission.
    await jsonFetch(base, '/send', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ session: 'session_ORDER', senderInstance: 'ctrl', envelope: { commandId: 'seq_' + i } })
    });
  }
  await out.waitFor((e) => e.event === 'envelope' && e.data.commandId === 'seq_19');
  const ids = out.events.filter((e) => e.event === 'envelope').map((e) => e.data.commandId);
  assert.deepEqual(ids, Array.from({ length: 20 }, (_, i) => 'seq_' + i));
  out.close();
});

await test('send rejects missing session or envelope and oversized bodies', async () => {
  const bad = await jsonFetch(base, '/send', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ senderInstance: 'x', envelope: {} })
  });
  assert.equal(bad.status, 400);
  const big = await jsonFetch(base, '/send', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ session: 's', senderInstance: 'x', envelope: { blob: 'x'.repeat(1024 * 1024 + 100) } })
  });
  assert.equal(big.status, 413);
});

await test('port walk skips an occupied port', async () => {
  const blocker = net.createServer();
  await new Promise((resolve) => blocker.listen(0, '127.0.0.1', resolve));
  const blockedPort = blocker.address().port;
  const walker = createHelper();
  const boundPort = await walker.listen(blockedPort);
  assert.equal(boundPort, blockedPort + 1);
  await walker.close();
  await new Promise((resolve) => blocker.close(resolve));
});

await test('media PUT/GET roundtrip with metadata', async () => {
  const bytes = new Uint8Array(70000).map((_, i) => i % 251);
  const put = await jsonFetch(base, '/media/m_abc123?name=intro.mp4&mime=video/mp4&kind=video&duration=12.5&width=1920&height=1080', {
    method: 'PUT',
    body: bytes
  });
  assert.equal(put.status, 200);
  assert.equal(put.body.bytes, 70000);
  const get = await fetch(base + '/media/m_abc123');
  assert.equal(get.status, 200);
  assert.equal(get.headers.get('content-type'), 'video/mp4');
  assert.equal(get.headers.get('accept-ranges'), 'bytes');
  const back = new Uint8Array(await get.arrayBuffer());
  assert.deepEqual(back, bytes);
  const meta = await jsonFetch(base, '/media/m_abc123/meta');
  assert.equal(meta.body.name, 'intro.mp4');
  assert.equal(meta.body.kind, 'video');
  assert.equal(meta.body.duration, 12.5);
  assert.equal(meta.body.size, 70000);
});

await test('media HEAD reports length; GET 404 on miss', async () => {
  const head = await fetch(base + '/media/m_abc123', { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(head.headers.get('content-length'), '70000');
  const miss = await fetch(base + '/media/m_nope');
  assert.equal(miss.status, 404);
});

await test('media GET honors single Range requests', async () => {
  const part = await fetch(base + '/media/m_abc123', { headers: { Range: 'bytes=100-199' } });
  assert.equal(part.status, 206);
  assert.equal(part.headers.get('content-range'), 'bytes 100-199/70000');
  const body = new Uint8Array(await part.arrayBuffer());
  assert.equal(body.length, 100);
  assert.equal(body[0], 100 % 251);
  const open = await fetch(base + '/media/m_abc123', { headers: { Range: 'bytes=69990-' } });
  assert.equal(open.status, 206);
  assert.equal((await open.arrayBuffer()).byteLength, 10);
  const bad = await fetch(base + '/media/m_abc123', { headers: { Range: 'bytes=99999-' } });
  assert.equal(bad.status, 416);
});

await test('media re-PUT is idempotent and list reflects the cache', async () => {
  const rePut = await jsonFetch(base, '/media/m_abc123?name=intro.mp4&mime=video/mp4&kind=video', {
    method: 'PUT',
    body: new Uint8Array(70000)
  });
  assert.equal(rePut.status, 200);
  const list = await jsonFetch(base, '/media');
  assert.equal(list.status, 200);
  assert.equal(list.body.length, 1);
  assert.equal(list.body[0].id, 'm_abc123');
  assert.equal(list.body[0].size, 70000);
});

await test('media ids are validated (path traversal refused)', async () => {
  const evil = await fetch(base + '/media/..%2F..%2Fetc%2Fpasswd', { method: 'PUT', body: 'x' });
  assert.equal(evil.status, 400);
  const evilGet = await fetch(base + '/media/%2e%2e%2fsecret');
  assert.equal(evilGet.status, 400);
});

await test('media prune removes everything not kept', async () => {
  await jsonFetch(base, '/media/m_keepme?mime=image/png', { method: 'PUT', body: new Uint8Array(10) });
  const prune = await jsonFetch(base, '/media/prune', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ keep: ['m_keepme'] })
  });
  assert.equal(prune.status, 200);
  assert.equal(prune.body.removed, 1);
  assert.equal((await fetch(base + '/media/m_abc123')).status, 404);
  assert.equal((await fetch(base + '/media/m_keepme')).status, 200);
});

await test('health and hello report media cache stats', async () => {
  const res = await jsonFetch(base, '/health');
  assert.equal(res.body.mediaCount, 1);
  assert.equal(res.body.cacheBytes, 10);
});

await helper.close();
fs.rmSync(cacheDir, { recursive: true, force: true });
console.log(`PASS ${passCount} kiosk helper tests`);
