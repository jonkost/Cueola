// Cueola → QLab Agent
// ---------------------------------------------------------------------------
// Runs on (or near) the QLab machine. Listens to a Cueola session document in
// Firestore for cue-fire commands and forwards them to QLab as OSC.
//
// Cueola never talks to QLab directly (browsers can't send UDP). Cueola writes
//   sessions/<code>.qlab.command = { commandId, ts, by, cues: [{cue, action}] }
// and this agent translates each entry into an OSC message such as
//   /cue/14.5/start
// sent to QLab on UDP 53000.
//
// Config resolution order (later wins): config.json → environment vars → CLI flags.
//   CLI:  node agent.js --session ABCDEF --host 127.0.0.1 --port 53000 --passcode 1234
//   ENV:  CUEOLA_SESSION, QLAB_HOST, QLAB_PORT, QLAB_PASSCODE
// ---------------------------------------------------------------------------

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { initializeApp } from 'firebase/app';
import { getFirestore, doc, onSnapshot, updateDoc } from 'firebase/firestore';
import { OscSender } from './osc.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Same public client config the Cueola web app uses (cueola project, open rules).
const firebaseConfig = {
  apiKey: 'AIzaSyCr5ZuIB1kjPRxdDd2X2-FnFef-r1ZUFIA',
  authDomain: 'cueola.firebaseapp.com',
  projectId: 'cueola',
  storageBucket: 'cueola.firebasestorage.app',
  messagingSenderId: '796559668931',
  appId: '1:796559668931:web:69e54b49de99644ee79476',
};

// ── Config ────────────────────────────────────────────────────────────────
function loadConfig() {
  let fileCfg = {};
  try {
    fileCfg = JSON.parse(readFileSync(join(__dirname, 'config.json'), 'utf8'));
  } catch {
    /* no config.json — fall back to env / CLI */
  }

  const args = process.argv.slice(2);
  const cli = {};
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (flag === '--session') cli.sessionCode = args[++i];
    else if (flag === '--host') cli.qlabHost = args[++i];
    else if (flag === '--port') cli.qlabPort = Number(args[++i]);
    else if (flag === '--passcode') cli.qlabPasscode = args[++i];
  }

  const cfg = {
    sessionCode: cli.sessionCode || process.env.CUEOLA_SESSION || fileCfg.sessionCode || '',
    qlabHost: cli.qlabHost || process.env.QLAB_HOST || fileCfg.qlabHost || '127.0.0.1',
    qlabPort: cli.qlabPort || Number(process.env.QLAB_PORT) || fileCfg.qlabPort || 53000,
    qlabPasscode: cli.qlabPasscode ?? process.env.QLAB_PASSCODE ?? fileCfg.qlabPasscode ?? '',
    heartbeatSeconds: fileCfg.heartbeatSeconds || 5,
  };

  cfg.sessionCode = String(cfg.sessionCode || '').trim().toUpperCase();
  return cfg;
}

const cfg = loadConfig();
if (!cfg.sessionCode) {
  console.error('No session code. Set it in config.json, CUEOLA_SESSION, or --session ABCDEF.');
  process.exit(1);
}

// ── OSC address mapping ─────────────────────────────────────────────────────
// QLab uses /cue/<number-or-uid>/<action> for cue-scoped actions, and a few
// workspace-level addresses (/go, /stop, /panic, /pause, /resume) with no cue.
const WORKSPACE_ACTIONS = {
  go: '/go',
  stopAll: '/stop',
  panicAll: '/panic',
  pauseAll: '/pause',
  resumeAll: '/resume',
};
const CUE_ACTIONS = new Set([
  'start', 'stop', 'hardStop', 'pause', 'resume', 'load', 'preview', 'panic', 'reset',
]);

function addressFor(cue, action) {
  const act = String(action || 'start').trim();
  if (WORKSPACE_ACTIONS[act]) return WORKSPACE_ACTIONS[act];
  const target = String(cue || '').trim();
  if (!target) return null; // a cue-scoped action needs a cue number/UID
  const safeAction = CUE_ACTIONS.has(act) ? act : 'start';
  return `/cue/${encodeURIComponent(target)}/${safeAction}`;
}

// ── Boot ────────────────────────────────────────────────────────────────────
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const sessionRef = doc(db, 'sessions', cfg.sessionCode);
const osc = new OscSender(cfg.qlabHost, cfg.qlabPort);

let lastCommandId = null; // dedup — don't fire the same command twice
let firstSnapshot = true; // don't fire a stale command that predates startup

console.log('Cueola → QLab Agent');
console.log(`  session : ${cfg.sessionCode}`);
console.log(`  qlab    : ${cfg.qlabHost}:${cfg.qlabPort}${cfg.qlabPasscode ? ' (passcode set)' : ''}`);
console.log('Listening for cue commands…');

// QLab 5 requires an OSC "connect" with the workspace passcode before it will
// accept commands from a new source. Harmless to (re)send periodically.
async function connectQLab() {
  if (!cfg.qlabPasscode) return;
  try {
    await osc.send('/connect', [{ type: 's', value: cfg.qlabPasscode }]);
  } catch (err) {
    console.error('[qlab] connect failed:', err.message);
  }
}
connectQLab();
if (cfg.qlabPasscode) setInterval(connectQLab, 60_000);

async function fireCommand(command) {
  const cues = Array.isArray(command.cues) ? command.cues : [];
  let sent = 0;
  for (const c of cues) {
    const address = addressFor(c.cue, c.action);
    if (!address) {
      console.warn(`  skip: no QLab target for action "${c.action}" (cue "${c.cue ?? ''}")`);
      continue;
    }
    if (cfg.qlabPasscode) await connectQLab();
    try {
      await osc.send(address);
      sent++;
      console.log(`  → ${address}`);
    } catch (err) {
      console.error(`  ✗ ${address}: ${err.message}`);
    }
  }
  // Ack back so Cueola can confirm the fire reached QLab.
  try {
    await updateDoc(sessionRef, {
      'qlab.lastAck': {
        commandId: command.commandId || null,
        ok: true,
        sentCount: sent,
        cueCount: cues.length,
        ts: Date.now(),
      },
    });
  } catch (err) {
    console.error('[firestore] ack write failed:', err.message);
  }
}

onSnapshot(
  sessionRef,
  (snap) => {
    const data = snap.data() || {};
    const command = data.qlab?.command;
    if (!command || !command.commandId) return;

    if (firstSnapshot) {
      // Adopt whatever's already there as "seen" so we don't replay an old fire
      // when the agent (re)starts.
      lastCommandId = command.commandId;
      firstSnapshot = false;
      return;
    }
    if (command.commandId === lastCommandId) return;
    lastCommandId = command.commandId;

    const label = command.by ? ` (by ${command.by})` : '';
    console.log(`▶ command ${command.commandId}${label}`);
    fireCommand(command);
  },
  (err) => {
    console.error('[firestore] listen error:', err.message);
  }
);

// ── Heartbeat ────────────────────────────────────────────────────────────────
async function beat() {
  try {
    await updateDoc(sessionRef, {
      'qlab.agentHeartbeat': {
        ts: Date.now(),
        host: cfg.qlabHost,
        port: cfg.qlabPort,
      },
    });
  } catch (err) {
    console.error('[firestore] heartbeat failed:', err.message);
  }
}
beat();
setInterval(beat, Math.max(2, cfg.heartbeatSeconds) * 1000);

function shutdown() {
  console.log('\nShutting down…');
  osc.close();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
