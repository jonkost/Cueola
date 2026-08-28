/* Cueola kiosk helper — local loopback daemon for Outrangutan kiosk outputs.
 *
 * Runs on the playout machine. Three dumb jobs, zero protocol logic:
 *   1. Relay: forwards Outrangutan output-protocol v2 envelopes verbatim
 *      between the controller page and kiosk output renderers over
 *      SSE (helper -> page) + POST (page -> helper). Kiosk Chrome instances
 *      run in their own profiles, so BroadcastChannel never reaches them.
 *   2. Media cache: serves media blobs the controller pushes at prep time,
 *      so kiosk profiles can fill their own IndexedDB media stores.
 *   3. Chrome process control: spawns/kills one `--kiosk` Chrome per output.
 *
 * Zero dependencies. Binds 127.0.0.1 only. Browser pages are admitted by an
 * Origin allowlist (same doctrine as talkbackd); requests without an Origin
 * header (curl, tests) are allowed.
 *
 * Run: node scripts/kiosk-helper.mjs [--port 17845] [--cache-dir <dir>] [--chrome <path>]
 */

import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';

export const HELPER_VERSION = '1.0.0';
export const HELPER_APP = 'cueola-kiosk-helper';
export const DEFAULT_PORT = 17845;
export const PORT_WALK = 5; // 17845..17849

const ORIGIN_ALLOW = /^https:\/\/cueola\.live$|^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;
const MEDIA_ID = /^[A-Za-z0-9_-]{1,120}$/; // path-traversal guard; storeFile ids are m_<random>
export const DEFAULT_CACHE_DIR = path.join(os.homedir(), 'Library', 'Application Support', 'CueolaKiosk', 'media');
const SEND_BODY_LIMIT = 1024 * 1024; // envelopes are JSON scalars + payload; 1 MB is generous
const KEEPALIVE_MS = 15000;

function cleanToken(value, max = 200) {
  return String(value == null ? '' : value).trim().replace(/[^A-Za-z0-9_.:-]/g, '_').slice(0, max);
}

export function originAllowed(origin) {
  if (origin == null || origin === '') return true; // non-browser client
  return ORIGIN_ALLOW.test(String(origin));
}

function corsHeaders(req) {
  const origin = req.headers.origin;
  if (!origin) return {};
  return { 'Access-Control-Allow-Origin': origin, 'Vary': 'Origin' };
}

function sendJson(res, status, body, extra = {}) {
  const data = JSON.stringify(body);
  res.writeHead(status, Object.assign({
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  }, extra));
  res.end(data);
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let rejected = false;
    req.on('data', (chunk) => {
      if (rejected) return; // keep draining so the early 413 can reach the client
      size += chunk.length;
      if (size > limit) { rejected = true; chunks.length = 0; reject(new Error('body-too-large')); return; }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

/* Creates the helper. Returns { server, listen(port), close(), state } —
 * exported so tests can run it in-process on an ephemeral port. */
export function createHelper(options = {}) {
  const helperInstanceId = 'kh_' + randomUUID();
  const clients = new Set(); // { res, session, instance, role, output }
  const cacheDir = options.cacheDir || DEFAULT_CACHE_DIR;
  let boundPort = null;

  const state = {
    helperInstanceId,
    clients,
    get port() { return boundPort; }
  };

  function helloInfo() {
    const stats = mediaStatsSync();
    return {
      helperVersion: HELPER_VERSION,
      helperInstanceId,
      chrome: { found: false, path: null },
      cacheDir,
      cacheBytes: stats.bytes,
      mediaCount: stats.count
    };
  }

  // ── media cache ──────────────────────────────────────────────────────────
  const binPath = (id) => path.join(cacheDir, id + '.bin');
  const metaPath = (id) => path.join(cacheDir, id + '.json');

  function ensureCacheDir() { fs.mkdirSync(cacheDir, { recursive: true }); }

  function mediaStatsSync() {
    try {
      const names = fs.readdirSync(cacheDir).filter((n) => n.endsWith('.bin'));
      let bytes = 0;
      for (const name of names) {
        try { bytes += fs.statSync(path.join(cacheDir, name)).size; } catch (e) {}
      }
      return { count: names.length, bytes };
    } catch (e) { return { count: 0, bytes: 0 }; }
  }

  function readMeta(id) {
    try { return JSON.parse(fs.readFileSync(metaPath(id), 'utf8')); } catch (e) { return null; }
  }

  function mediaIdFrom(url) {
    const id = decodeURIComponent(url.pathname.split('/')[2] || '');
    return MEDIA_ID.test(id) ? id : null;
  }

  function handleMediaPut(req, res, url, id) {
    ensureCacheDir();
    const tmp = binPath(id) + '.tmp';
    const out = fs.createWriteStream(tmp);
    let failed = false;
    const fail = (status, error) => {
      if (failed) return; failed = true;
      out.destroy();
      fsp.rm(tmp, { force: true }).catch(() => {});
      sendJson(res, status, { ok: false, error }, corsHeaders(req));
    };
    req.on('error', () => fail(500, 'upload-aborted'));
    out.on('error', () => fail(500, 'disk-write-failed'));
    out.on('finish', async () => {
      if (failed) return;
      try {
        const size = (await fsp.stat(tmp)).size;
        const meta = {
          id,
          name: String(url.searchParams.get('name') || ''),
          mime: String(url.searchParams.get('mime') || 'application/octet-stream'),
          kind: String(url.searchParams.get('kind') || ''),
          duration: Number(url.searchParams.get('duration')) || 0,
          width: Number(url.searchParams.get('width')) || 0,
          height: Number(url.searchParams.get('height')) || 0,
          size,
          storedAt: Date.now()
        };
        await fsp.rename(tmp, binPath(id));
        await fsp.writeFile(metaPath(id), JSON.stringify(meta));
        sendJson(res, 200, { ok: true, bytes: size }, corsHeaders(req));
      } catch (e) { fail(500, 'store-failed'); }
    });
    req.pipe(out);
  }

  function handleMediaGet(req, res, id, headOnly) {
    let stat;
    try { stat = fs.statSync(binPath(id)); } catch (e) {
      sendJson(res, 404, { ok: false, error: 'media-not-found' }, corsHeaders(req));
      return;
    }
    const meta = readMeta(id) || {};
    const baseHeaders = Object.assign({
      'Content-Type': meta.mime || 'application/octet-stream',
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'no-store'
    }, corsHeaders(req));
    const range = req.headers.range;
    if (headOnly) {
      res.writeHead(200, Object.assign({ 'Content-Length': stat.size }, baseHeaders));
      res.end();
      return;
    }
    if (range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range);
      let start = match && match[1] !== '' ? parseInt(match[1], 10) : null;
      let end = match && match[2] !== '' ? parseInt(match[2], 10) : null;
      if (start === null && end !== null) { start = Math.max(0, stat.size - end); end = stat.size - 1; } // suffix range
      if (end === null && start !== null) end = stat.size - 1;
      if (!match || start === null || start >= stat.size || end < start) {
        res.writeHead(416, Object.assign({ 'Content-Range': 'bytes */' + stat.size }, baseHeaders));
        res.end();
        return;
      }
      end = Math.min(end, stat.size - 1);
      res.writeHead(206, Object.assign({
        'Content-Range': `bytes ${start}-${end}/${stat.size}`,
        'Content-Length': end - start + 1
      }, baseHeaders));
      fs.createReadStream(binPath(id), { start, end }).pipe(res);
      return;
    }
    res.writeHead(200, Object.assign({ 'Content-Length': stat.size }, baseHeaders));
    fs.createReadStream(binPath(id)).pipe(res);
  }

  function handleMediaList(req, res) {
    let entries = [];
    try {
      entries = fs.readdirSync(cacheDir)
        .filter((n) => n.endsWith('.json'))
        .map((n) => readMeta(n.slice(0, -5)))
        .filter(Boolean)
        .map((m) => ({ id: m.id, size: m.size, mime: m.mime, kind: m.kind, name: m.name, storedAt: m.storedAt }));
    } catch (e) {}
    sendJson(res, 200, entries, corsHeaders(req));
  }

  async function handleMediaPrune(req, res) {
    let parsed;
    try { parsed = JSON.parse((await readBody(req, SEND_BODY_LIMIT)).toString('utf8')); } catch (e) {
      sendJson(res, 400, { ok: false, error: 'bad-json' }, corsHeaders(req));
      return;
    }
    const keep = new Set(Array.isArray(parsed && parsed.keep) ? parsed.keep.map(String) : []);
    let removed = 0;
    try {
      for (const name of fs.readdirSync(cacheDir)) {
        if (!name.endsWith('.bin')) continue;
        const id = name.slice(0, -4);
        if (keep.has(id)) continue;
        await fsp.rm(binPath(id), { force: true });
        await fsp.rm(metaPath(id), { force: true });
        removed++;
      }
    } catch (e) {}
    sendJson(res, 200, { ok: true, removed }, corsHeaders(req));
  }

  function sseWrite(client, event, data) {
    try {
      client.res.write('event: ' + event + '\n' + 'data: ' + JSON.stringify(data) + '\n\n');
    } catch (e) { /* dead socket; close event will reap it */ }
  }

  function broadcastEnvelope(session, senderInstance, envelope) {
    let delivered = 0;
    for (const client of clients) {
      if (client.session !== session) continue;
      if (client.instance && senderInstance && client.instance === senderInstance) continue;
      sseWrite(client, 'envelope', envelope);
      delivered++;
    }
    return delivered;
  }

  function handleEvents(req, res, url) {
    const client = {
      res,
      role: cleanToken(url.searchParams.get('role'), 20) || 'unknown',
      session: cleanToken(url.searchParams.get('session')),
      output: cleanToken(url.searchParams.get('output'), 20),
      instance: cleanToken(url.searchParams.get('instance'))
    };
    if (!client.session) { sendJson(res, 400, { ok: false, error: 'session-required' }, corsHeaders(req)); return; }
    res.writeHead(200, Object.assign({
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-store',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no'
    }, corsHeaders(req)));
    res.write(': connected\n\n');
    clients.add(client);
    sseWrite(client, 'hello', helloInfo());
    req.on('close', () => clients.delete(client));
  }

  async function handleSend(req, res) {
    let body;
    try { body = await readBody(req, SEND_BODY_LIMIT); } catch (e) {
      sendJson(res, 413, { ok: false, error: 'body-too-large' }, corsHeaders(req));
      return;
    }
    let parsed;
    try { parsed = JSON.parse(body.toString('utf8')); } catch (e) {
      sendJson(res, 400, { ok: false, error: 'bad-json' }, corsHeaders(req));
      return;
    }
    const session = cleanToken(parsed && parsed.session);
    const senderInstance = cleanToken(parsed && parsed.senderInstance);
    const envelope = parsed && parsed.envelope;
    if (!session || !envelope || typeof envelope !== 'object') {
      sendJson(res, 400, { ok: false, error: 'session-and-envelope-required' }, corsHeaders(req));
      return;
    }
    const delivered = broadcastEnvelope(session, senderInstance, envelope);
    sendJson(res, 200, { ok: true, delivered }, corsHeaders(req));
  }

  function handleHealth(req, res) {
    sendJson(res, 200, Object.assign({ ok: true, app: HELPER_APP, version: HELPER_VERSION, port: boundPort }, helloInfo()), corsHeaders(req));
  }

  const server = http.createServer((req, res) => {
    const origin = req.headers.origin;
    if (!originAllowed(origin)) {
      sendJson(res, 403, { ok: false, error: 'origin-not-allowed' });
      return;
    }
    if (req.method === 'OPTIONS') {
      const headers = Object.assign({
        'Access-Control-Allow-Methods': 'GET, POST, PUT, HEAD, OPTIONS',
        'Access-Control-Allow-Headers': 'content-type',
        'Access-Control-Max-Age': '3600'
      }, corsHeaders(req));
      if (req.headers['access-control-request-private-network'] === 'true') {
        headers['Access-Control-Allow-Private-Network'] = 'true';
      }
      res.writeHead(204, headers);
      res.end();
      return;
    }
    const url = new URL(req.url, 'http://127.0.0.1');
    if (req.method === 'GET' && url.pathname === '/health') { handleHealth(req, res); return; }
    if (req.method === 'GET' && url.pathname === '/events') { handleEvents(req, res, url); return; }
    if (req.method === 'POST' && url.pathname === '/send') { handleSend(req, res); return; }
    if (url.pathname === '/media' && req.method === 'GET') { handleMediaList(req, res); return; }
    if (url.pathname === '/media/prune' && req.method === 'POST') { handleMediaPrune(req, res); return; }
    if (url.pathname.startsWith('/media/')) {
      const id = mediaIdFrom(url);
      if (!id) { sendJson(res, 400, { ok: false, error: 'bad-media-id' }, corsHeaders(req)); return; }
      const isMeta = url.pathname === '/media/' + id + '/meta';
      if (req.method === 'PUT' && !isMeta) { handleMediaPut(req, res, url, id); return; }
      if (req.method === 'GET' && isMeta) {
        const meta = readMeta(id);
        if (meta) sendJson(res, 200, meta, corsHeaders(req));
        else sendJson(res, 404, { ok: false, error: 'media-not-found' }, corsHeaders(req));
        return;
      }
      if ((req.method === 'GET' || req.method === 'HEAD') && !isMeta) { handleMediaGet(req, res, id, req.method === 'HEAD'); return; }
    }
    sendJson(res, 404, { ok: false, error: 'not-found' }, corsHeaders(req));
  });

  const keepalive = setInterval(() => {
    for (const client of clients) {
      try { client.res.write(': keepalive\n\n'); } catch (e) { /* reaped on close */ }
    }
  }, KEEPALIVE_MS);
  keepalive.unref();

  /* Listens on 127.0.0.1. A fixed port walks forward on EADDRINUSE so a
   * lingering old helper never blocks a restart; port 0 binds ephemerally. */
  function listen(port = DEFAULT_PORT) {
    const attempts = port === 0 ? [0] : Array.from({ length: PORT_WALK }, (_, i) => port + i);
    return new Promise((resolve, reject) => {
      const tryNext = (index) => {
        if (index >= attempts.length) { reject(new Error('no-port-available')); return; }
        const attempt = attempts[index];
        const onError = (error) => {
          server.removeListener('error', onError);
          if (error && error.code === 'EADDRINUSE') { tryNext(index + 1); return; }
          reject(error);
        };
        server.once('error', onError);
        server.listen(attempt, '127.0.0.1', () => {
          server.removeListener('error', onError);
          boundPort = server.address().port;
          resolve(boundPort);
        });
      };
      tryNext(0);
    });
  }

  function close() {
    clearInterval(keepalive);
    for (const client of clients) { try { client.res.end(); } catch (e) {} }
    clients.clear();
    return new Promise((resolve) => server.close(() => resolve()));
  }

  return { server, listen, close, state };
}

function parseArgs(argv) {
  const args = { port: DEFAULT_PORT };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--port' && argv[i + 1]) args.port = parseInt(argv[++i], 10) || DEFAULT_PORT;
    else if (argv[i] === '--cache-dir' && argv[i + 1]) args.cacheDir = argv[++i];
    else if (argv[i] === '--chrome' && argv[i + 1]) args.chrome = argv[++i];
  }
  return args;
}

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop());
if (isMain) {
  const args = parseArgs(process.argv.slice(2));
  const helper = createHelper(args);
  helper.listen(args.port).then((port) => {
    console.log(`${HELPER_APP} v${HELPER_VERSION} listening on http://127.0.0.1:${port}`);
  }).catch((error) => {
    console.error(`${HELPER_APP}: could not bind a port (${error.message})`);
    process.exit(1);
  });
  const shutdown = () => { helper.close().then(() => process.exit(0)); };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
