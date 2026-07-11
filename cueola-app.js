'use strict';

// Production-readiness build (CUEOLA MASTER PLAN phases 0–8) — see CHANGELOG.md.
const CUEOLA_VERSION = '1.0.0';
window.CUEOLA_VERSION = CUEOLA_VERSION;

function sfIcon(symbol, className='') {
  const classes = className ? `sf-symbol ${className}` : 'sf-symbol';
  return `<span class="${classes}" data-symbol="${symbol}" aria-hidden="true"></span>`;
}

function setSymbolButtonLabel(button, symbol, label) {
  if (!button) return;
  button.innerHTML = `${sfIcon(symbol)}<span>${label}</span>`;
}

// ─────────────────────────────────────────────────────────────
// CUE TYPE DEFINITIONS
// ─────────────────────────────────────────────────────────────
const CT = {
  video:    { label:'VIDEO',    color:'var(--video)',  bg:'var(--video-bg)',                                  symbol:'department.video' },
  audio:    { label:'AUDIO',    color:'var(--green)',  bg:'color-mix(in srgb,var(--green) 14%,transparent)',  symbol:'department.audio' },
  lighting: { label:'LIGHTING', color:'var(--purple)', bg:'color-mix(in srgb,var(--purple) 14%,transparent)', symbol:'department.lighting' },
  playback: { label:'PLAYBACK', color:'var(--red)',    bg:'color-mix(in srgb,var(--red) 14%,transparent)',    symbol:'department.playback' },
  gfx:      { label:'GFX',      color:'var(--yellow)', bg:'color-mix(in srgb,var(--yellow) 14%,transparent)', symbol:'department.graphics' },
  script:   { label:'SCRIPT',   color:'var(--cyan)',   bg:'color-mix(in srgb,var(--cyan) 14%,transparent)',   symbol:'department.script' },
};

// Column ordering — persisted per user in localStorage
const COL_META = {
  video:    { label:'Video',    color:'var(--video)',  symbol:'department.video' },
  audio:    { label:'Audio',    color:'var(--green)',  symbol:'department.audio' },
  playback: { label:'Playback', color:'var(--red)',    symbol:'department.playback' },
  gfx:      { label:'GFX',      color:'var(--yellow)', symbol:'department.graphics' },
  lighting: { label:'Lighting', color:'var(--purple)', symbol:'department.lighting' },
  script:   { label:'Script',   color:'var(--cyan)',   symbol:'department.script' },
};
const COL_DEFAULTS = ['video','audio','playback','gfx','lighting','script'];
let colOrder = (() => {
  try {
    const s = JSON.parse(localStorage.getItem('cueola_col_order')||'null');
    if (Array.isArray(s) && s.length === 6 && s.every(c=>COL_DEFAULTS.includes(c))) return s;
  } catch {}
  return [...COL_DEFAULTS];
})();
let colDragSrc = null;

// ─────────────────────────────────────────────────────────────
// STATE
// ─────────────────────────────────────────────────────────────
let beats = [];
let show  = { name:'Untitled Show', start:'' };
let session = { code:'', role:'', userName:'', isDemo:false, isExpert:false };
let lsIdx = -1;
let browsingSelf = false;   // true = browse the rundown on my own (Following: Myself)
let followTarget = '';      // name of the person whose position I mirror ('' = self / show caller)
let followTargetId = '';    // presence id keeps duplicate/stale display names from hijacking follow
let editId = null;
let timerInterval = null;
let elapsedSecs = 0;
let liveTimerStartMs = null;
let prompterText = '';
let prompterVersion = 0;
let prompterUpdatedAt = 0;
let prompterSource = 'assembled';
let prompterChannel = null;
let prompterLegacyChannel = null;
const CLIENT_ID = (() => {
  try {
    const key = 'cueola_client_id';
    const existing = localStorage.getItem(key);
    if (existing) return existing;
    const id = 'cl_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
    localStorage.setItem(key, id);
    return id;
  } catch {
    return 'cl_' + Math.random().toString(36).slice(2, 10);
  }
})();
const FLOWMINGO_ENDPOINT_ID = (() => {
  try {
    const raw = globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
    return 'fm_' + String(raw).replace(/[^a-zA-Z0-9_-]/g, '');
  } catch {
    return 'fm_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 10);
  }
})();
let _prompterMsgSeq = 0;
function nextPrompterMsgId(kind='msg') {
  _prompterMsgSeq += 1;
  return `${FLOWMINGO_ENDPOINT_ID}_${kind}_${Date.now().toString(36)}_${_prompterMsgSeq}`;
}
function isPrompterSelfSender(sender) {
  return !!sender && sender === FLOWMINGO_ENDPOINT_ID;
}
function withPrompterEnvelope(payload={}) {
  const ts = payload.ts || Date.now();
  return {
    ...payload,
    ts,
    sender: FLOWMINGO_ENDPOINT_ID,
    senderClient: CLIENT_ID,
    mid: payload.mid || nextPrompterMsgId(payload.type || 'msg')
  };
}
const CUEOLA_THEMES = ['cool','warm','white','green','koala','panda','flamingo','outrangutan','prepbear'];
const CUEOLA_THEME_LABELS = {
  warm:     'Honey',
  cool:     'Glacier',
  white:    'Polar Bear',
  green:    'Eucalyptus',
  koala:    'Koala',
  panda:    'Planda Bear',
  flamingo: 'Flowmingo',
  outrangutan: 'Outrangutan',
  prepbear: 'PrepBear',
};
function normalizeCueolaTheme(t) { return CUEOLA_THEMES.includes(t) ? t : 'cool'; }
const PLANDABEAR_THEMES = ['glacier','honey','polar-bear','eucalyptus','koala','panda','flamingo','outrangutan','prepbear'];
function normalizePlandaBearTheme(t) { return PLANDABEAR_THEMES.includes(t) ? t : 'glacier'; }
function cueolaThemeToPlandaBearTheme(t) {
  const map = { cool: 'glacier', warm: 'honey', white: 'polar-bear' };
  return normalizePlandaBearTheme(map[normalizeCueolaTheme(t)] || normalizeCueolaTheme(t));
}
function hasPlandaBearThemeOverride() {
  try { return localStorage.getItem('cueola_plandabear_theme') !== null; } catch { return false; }
}
function normalizeFrameRate(v) { return [24,30,60].includes(Number(v)) ? Number(v) : 30; }
let currentTheme = normalizeCueolaTheme(localStorage.getItem('cueola_theme'));
let plandaBearTheme = normalizePlandaBearTheme(hasPlandaBearThemeOverride() ? localStorage.getItem('cueola_plandabear_theme') : cueolaThemeToPlandaBearTheme(currentTheme));
let frameRate = normalizeFrameRate(localStorage.getItem('cueola_frame_rate'));
let adminSession = null; // { id, name, level }
let sessionCustomSources = {}; // { video:[], audio:[], gfx:[], scriptWho:[] }
let freeTextMode = false;
let pnPanelOpen = false;
let pnTargetBeatId = null;
let pnFilterTag = 'all';

const LOCAL_DRAFT_PREFIX = 'cueola_local_draft_';

function localDraftKey() {
  if (session.isDemo) return '';
  if (session.code) return `${LOCAL_DRAFT_PREFIX}${session.code}`;
  return `${LOCAL_DRAFT_PREFIX}expert`;
}

function saveLocalDraft() {
  const key = localDraftKey();
  if (!key) return;
  try {
    localStorage.setItem(key, JSON.stringify({
      show:{ ...show, start:normalizeTimeValue(show.start) },
      beats,
      customSources: sessionCustomSources,
      freeTextMode,
      updatedAt: Date.now(),
    }));
  } catch {}
}

function restoreLocalDraft() {
  const key = localDraftKey();
  if (!key) return false;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return false;
    const draft = JSON.parse(raw);
    if (!draft || !Array.isArray(draft.beats)) return false;
    show = {
      name: draft.show?.name || 'Untitled Show',
      start: normalizeTimeValue(draft.show?.start),
    };
    beats = draft.beats.map(migrateBeat);
    sessionCustomSources = draft.customSources || {};
    freeTextMode = Boolean(draft.freeTextMode);
    return true;
  } catch {
    return false;
  }
}

// Save / open a rundown as a file on the user's computer (portable backup).
// P7: branded ".cueola" show files. Chrome/Edge get the File System Access
// picker (a named "Cueola Show" type) and save-in-place — Cmd+S re-saves the
// opened/saved file instead of downloading copies; other browsers fall back
// to a download. Legacy ".json"/".cueola.json" files still open; validation
// stays schema-header-based (the payload `kind` check), not extension-based.
let _cueolaFileHandle = null;   // FileSystemFileHandle → Cmd+S saves back into the same file
function rundownFilePayload() {
  return {
    kind: 'cueola-rundown', app: 'cueola', version: 1, exportedAt: Date.now(),
    show: { name: show.name || 'Untitled Show', start: normalizeTimeValue(show.start) },
    beats, customSources: sessionCustomSources, freeTextMode,
  };
}
function rundownFileName() {
  const safe = (show.name || 'Cueola Rundown').replace(/[^\w \-]+/g, '').trim() || 'Cueola Rundown';
  return safe + '.cueola';
}
async function exportRundownFile() {
  if (!beats.length) { toast('Add a row before saving the rundown.'); return; }
  const json = JSON.stringify(rundownFilePayload());
  if (window.showSaveFilePicker) {
    try {
      if (!_cueolaFileHandle) {
        _cueolaFileHandle = await window.showSaveFilePicker({
          suggestedName: rundownFileName(),
          types: [{ description: 'Cueola Show', accept: { 'application/json': ['.cueola'] } }],
        });
      }
      const w = await _cueolaFileHandle.createWritable();
      await w.write(json);
      await w.close();
      logShow('session', 'Rundown saved → ' + _cueolaFileHandle.name);
      toast('Saved — ' + _cueolaFileHandle.name);
      return;
    } catch (e) {
      if (e && e.name === 'AbortError') return;   // user cancelled the picker
      _cueolaFileHandle = null;                   // stale or denied handle → plain download below
    }
  }
  try {
    const blob = new Blob([json], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = rundownFileName();
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    logShow('session', 'Rundown downloaded → ' + rundownFileName());
    toast('Rundown saved — ' + beats.length + ' row' + (beats.length === 1 ? '' : 's') + '.');
  } catch (e) { toast('Could not save the rundown file.'); }
}
async function openRundownFilePicker() {
  if (window.showOpenFilePicker) {
    try {
      const [h] = await window.showOpenFilePicker({
        types: [{ description: 'Cueola Show', accept: { 'application/json': ['.cueola', '.json'] } }],
      });
      const ok = await importRundownFile(await h.getFile());
      if (ok) _cueolaFileHandle = h;   // Cmd+S now saves back into the opened file
      return;
    } catch (e) { if (e && e.name === 'AbortError') return; }
  }
  document.getElementById('rundownFileInput')?.click();
}
async function importRundownFile(file) {
  if (!file) return false;
  if (session.isDemo) { toast('Exit demo mode before opening a rundown file.'); return false; }
  let payload;
  try { payload = JSON.parse(await file.text()); } catch (e) { toast('That file isn’t a valid rundown file.'); return false; }
  if (!payload || payload.kind !== 'cueola-rundown' || !Array.isArray(payload.beats)) { toast('That isn’t a Cueola rundown file.'); return false; }
  if (beats.length && !window.confirm('Replace the current ' + beats.length + ' row' + (beats.length === 1 ? '' : 's') + ' with ' + payload.beats.length + ' from this file?')) return false;
  try {
    show = { name: payload.show?.name || 'Untitled Show', start: normalizeTimeValue(payload.show?.start) };
    beats = payload.beats.map(migrateBeat);
    sessionCustomSources = payload.customSources || {};
    freeTextMode = Boolean(payload.freeTextMode);
    renderRundown();
    syncToFirestore();
    logShow('session', 'Rundown opened from file — ' + beats.length + ' rows');
    toast('Rundown opened — ' + beats.length + ' row' + (beats.length === 1 ? '' : 's') + '.');
    return true;
  } catch (e) { toast('Could not open the rundown file.'); return false; }
}

// ─────────────────────────────────────────────────────────────
// P7: STRUCTURED SHOW LOG — per-session, timestamped record of cue fires,
// media events, sync events, and errors, so any live problem is diagnosable
// afterward. Ring buffer persisted to localStorage (debounced); Outrangutan
// logs into the same stream via window.CueolaShowLog (same-tab).
// ─────────────────────────────────────────────────────────────
const SHOWLOG_MAX = 1000;
let showLogEntries = [];
let _showLogSaveTimer = null;
let _showLogLoadedKey = '';

function showLogKey() {
  if (session?.code && !session.isDemo) return 'cueola_showlog_' + session.code;
  return 'cueola_showlog_local';
}
// Restore the persisted log for this session key so a reload (or crash) never
// loses the record — the whole point is diagnosing what happened before one.
// MERGES under anything already buffered in memory: entries logged before the
// load (boot errors, pre-join events) must survive, and they're part of the
// same tab's story anyway.
function loadShowLog() {
  const key = showLogKey();
  if (key === _showLogLoadedKey) return;
  _showLogLoadedKey = key;
  try {
    const prior = JSON.parse(localStorage.getItem(key) || '[]');
    if (Array.isArray(prior) && prior.length) showLogEntries = prior.concat(showLogEntries).slice(-SHOWLOG_MAX);
  } catch {}
}
function logShow(cat, msg, data) {
  try {
    if (!_showLogLoadedKey) loadShowLog();
    const e = { t: Date.now(), cat: String(cat || 'info'), msg: String(msg || '') };
    if (data !== undefined) { try { e.data = JSON.parse(JSON.stringify(data)); } catch {} }
    showLogEntries.push(e);
    if (showLogEntries.length > SHOWLOG_MAX) showLogEntries.splice(0, showLogEntries.length - SHOWLOG_MAX);
    clearTimeout(_showLogSaveTimer);
    _showLogSaveTimer = setTimeout(() => {
      try { localStorage.setItem(showLogKey(), JSON.stringify(showLogEntries)); } catch {}
    }, 800);
    // Live-append when the viewer is open.
    const wrap = document.getElementById('modal-showlog');
    if (wrap?.classList.contains('on')) appendShowLogRow(e, true);
  } catch {}
}
window.CueolaShowLog = { add: logShow };

const SHOWLOG_CATS = { cue:'--accent', media:'--video', sfx:'--green', sync:'--cyan', session:'--text2', error:'--red', preflight:'--yellow' };
function showLogTime(t) {
  const d = new Date(t);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${String(d.getMilliseconds()).padStart(3,'0')}`;
}
function showLogRowHtml(e) {
  const dot = SHOWLOG_CATS[e.cat] || '--text3';
  return `<div class="slog-row"><span class="slog-time">${showLogTime(e.t)}</span><span class="slog-dot" style="background:var(${dot})"></span><span class="slog-cat">${esc(e.cat)}</span><span class="slog-msg">${esc(e.msg)}</span></div>`;
}
function appendShowLogRow(e, scroll) {
  const list = document.getElementById('showLogList');
  if (!list) return;
  list.insertAdjacentHTML('beforeend', showLogRowHtml(e));
  if (scroll) list.scrollTop = list.scrollHeight;
}
function openShowLog() {
  loadShowLog();
  const list = document.getElementById('showLogList');
  if (list) {
    list.innerHTML = showLogEntries.length
      ? showLogEntries.map(showLogRowHtml).join('')
      : '<div class="slog-empty">Nothing logged yet. Cue fires, media events, sync changes, and errors will appear here.</div>';
  }
  const sub = document.getElementById('showLogSub');
  if (sub) sub.textContent = (session?.code ? 'Session ' + session.code : 'Local workspace') + ' · ' + showLogEntries.length + ' event' + (showLogEntries.length === 1 ? '' : 's');
  showModal('modal-showlog');
  if (list) list.scrollTop = list.scrollHeight;
}
function exportShowLog() {
  if (!showLogEntries.length) { toast('The show log is empty.'); return; }
  const head = 'Cueola show log — ' + (session?.code ? 'session ' + session.code : 'local') + ' — exported ' + new Date().toLocaleString() + '\n\n';
  const lines = showLogEntries.map(e => `${new Date(e.t).toLocaleDateString()} ${showLogTime(e.t)}  [${e.cat}]  ${e.msg}${e.data ? '  ' + JSON.stringify(e.data) : ''}`);
  const blob = new Blob([head + lines.join('\n') + '\n'], { type: 'text/plain' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'Cueola Show Log ' + (session?.code || 'local') + ' ' + new Date().toISOString().slice(0, 10) + '.txt';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  toast('Show log exported — ' + showLogEntries.length + ' events.');
}
function clearShowLog() {
  if (!window.confirm('Clear the show log for ' + (session?.code ? 'session ' + session.code : 'this workspace') + '?')) return;
  showLogEntries = [];
  try { localStorage.removeItem(showLogKey()); } catch {}
  openShowLog();
}

// ─────────────────────────────────────────────────────────────
// P7: ERROR CONTAINMENT — an exception in one panel logs and recovers
// without taking down the show UI. Window-level handlers catch anything
// uncaught; guardFn() wraps the live-critical render/dispatch paths so a
// crash inside one leaves the rest of the surface running.
// ─────────────────────────────────────────────────────────────
let _errToastTs = 0;
function containError(label, err) {
  try {
    const msg = (err && (err.message || err.reason?.message)) || String(err || 'unknown');
    logShow('error', label + ': ' + msg, err?.stack ? { stack: String(err.stack).slice(0, 600) } : undefined);
    const now = Date.now();
    if (now - _errToastTs > 4000) {   // throttled: an error loop must not bury the operator in toasts
      _errToastTs = now;
      toast('⚠ ' + label + ' hit an error — logged to the show log. The show keeps running.', 3500);
    }
  } catch {}
}
window.addEventListener('error', e => containError('Uncaught', e.error || e.message));
window.addEventListener('unhandledrejection', e => { containError('Async', e.reason); try { e.preventDefault(); } catch {} });
function guardFn(fn, label) {
  return function (...args) {
    try { return fn.apply(this, args); }
    catch (err) { containError(label, err); }
  };
}

// ─────────────────────────────────────────────────────────────
// P7: SESSION RESUME (Decisions #14) — state already saves on every change;
// this records WHERE the operator was (session, screen, live row, Script Op)
// so an unclean exit offers a one-click "Resume where you left off" banner.
// Nothing moves without the click. Cleared on an intentional leave.
// ─────────────────────────────────────────────────────────────
const RESUME_KEY = 'cueola_resume';
const RESUME_MAX_AGE = 12 * 3600 * 1000;
function markResumeState() {
  if (!session?.code || session.isDemo || session.isExpert) return;
  try {
    localStorage.setItem(RESUME_KEY, JSON.stringify({
      code: session.code, name: session.userName || '', role: session.role || 'instructor',
      showName: show?.name || '',
      screen: sessionStorage.getItem('cueola_screen') || 'build',
      scriptOp: !!livePrompterOpen, lsIdx, ts: Date.now(),
    }));
  } catch {}
}
function clearResumeState() {
  try { localStorage.removeItem(RESUME_KEY); } catch {}
  const b = document.getElementById('resumeBanner');
  if (b) b.hidden = true;
}
function readResumeState() {
  try {
    const r = JSON.parse(localStorage.getItem(RESUME_KEY) || 'null');
    if (!r || !r.code || !r.ts || (Date.now() - r.ts) > RESUME_MAX_AGE) return null;
    return r;
  } catch { return null; }
}
function initResumeBanner() {
  const r = readResumeState();
  const banner = document.getElementById('resumeBanner');
  if (!r || !banner) return;
  if (!document.getElementById('entry')?.classList.contains('on')) return;  // a deep link already routed elsewhere
  const where = r.screen === 'live' ? 'live on row ' + ((r.lsIdx ?? 0) + 1) : 'building';
  const text = document.getElementById('resumeBannerText');
  if (text) text.innerHTML = `You were ${where} in session <b>${esc(r.code)}</b>${r.showName ? ' · “' + esc(r.showName) + '”' : ''}. Resume where you left off?`;
  banner.hidden = false;
}
function dismissResumeBanner() {
  clearResumeState();
  logShow('session', 'Resume banner dismissed');
}
function resumeLastSession() {
  const r = readResumeState();
  if (!r) { clearResumeState(); return; }
  const banner = document.getElementById('resumeBanner');
  if (banner) banner.hidden = true;
  session = { code: r.code, role: r.role || 'instructor', userName: r.name || '', isDemo: false, isExpert: false };
  freeTextMode = false;
  rememberLastSession(r.code, r.name);
  if (Number.isFinite(r.lsIdx)) lsIdx = r.lsIdx;
  // The rundown arrives async (cloud snapshot / local draft) — goLive()'s clamp
  // would zero the restored row on a still-empty list. Re-assert it once the
  // beats land (give up quietly after ~6 s; the operator is already back live).
  const reassertIdx = () => {
    if (!Number.isFinite(r.lsIdx) || r.lsIdx < 1) return;
    let tries = 0;
    const t = setInterval(() => {
      tries++;
      if (beats.length > r.lsIdx) {
        clearInterval(t);
        if (lsIdx !== r.lsIdx) {
          lsIdx = r.lsIdx;
          if (document.getElementById('liveshow')?.classList.contains('on')) renderLive();
          syncLiveIdx();
        }
      } else if (tries > 12) clearInterval(t);
    }, 500);
  };
  const after = () => {
    if (r.screen === 'live') {
      try { if (!document.getElementById('liveshow')?.classList.contains('on')) goLive(); } catch {}
      reassertIdx();
      if (r.scriptOp) setTimeout(() => { try { if (!livePrompterOpen) toggleLivePrompterPanel(); } catch {} }, 500);
    }
  };
  waitForFirebaseReady().then(ready => {
    if (ready) { enterRundown(); setTimeout(after, 400); }
    else { try { openLocalSession(r.code, r.name || 'Operator', r.role || 'instructor'); } catch {} setTimeout(after, 400); }
  });
  logShow('session', 'Resumed after unclean exit → ' + r.code + (r.screen === 'live' ? ' (live, row ' + ((r.lsIdx ?? 0) + 1) + ')' : ''));
}
// Refresh the record every 20 s while in a session — the ts doubles as the
// "was recently in use" signal for the banner's freshness window. Gated on a
// session screen actually being up: `session` survives leaveSessionForFrontPage,
// and an unguarded heartbeat resurrected the resume record after a deliberate
// leave (dress-rehearsal find).
setInterval(() => {
  const inSession = document.getElementById('rundown')?.classList.contains('on')
    || document.getElementById('liveshow')?.classList.contains('on');
  if (inSession && session?.code && !session.isDemo && !session.isExpert) markResumeState();
}, 20000);

// Add-row wizard state
let arStyle = null;
let arCueType = null; // single selected type in step 2

// Edit mode (gates row/column drag)
let editMode = false;

// Cue config modal state
let cueConfigBeatId = null;
let cueConfigType   = null;

// Presence cache for follow chips
let currentPresence = {};
let sessionParticipantNames = [];

// Live script edit
let liveScriptEditIdx = null;

// Edit style (for edit overlay)
let editStyle = null;

// Prompt Op Mode — teleprompter-operator focused live view
let promptOpMode = false;
// Live view — defaults to the full department grid. Focus view (one big NOW, a
// clear NEXT, calm coming-up list) is opt-in and remembered once chosen.
let liveFocusMode = (() => { try { return localStorage.getItem('cueola_live_focus') === '1'; } catch { return false; } })();
let browserBackGuardReady = false;
let _lastHandledForceCmdTs = 0;
let livePrompterOpen = false;
let liveSidebarWidth = 420;
let _lastLiveScrollIdx = null;
let previewRowIdx = 0;
let callSheetPeople = [];
let activeCallSheetIndex = 0;
let callSheetVenue = '';      // '' | 'indoors' | 'outdoors' | 'both'
let callSheetWeather = null;  // { conditions, high, low, precip, wind, sunrise, sunset, emoji, source, forecastDate, place, updatedAt }
let liveClockRunning = false;
let paperworkDirty = false;
let flowmingoRemoteOverrideUntil = 0;
// How long the Script Op desk defers TRANSPORT (play/speed/scroll) to a remote
// Flowmingo Op after the remote acts. Short so the desk can grab control back fast;
// clock/cue/question/slate bypass this entirely (isCollaborativePrompterControl).
const FLOWMINGO_REMOTE_OVERRIDE_MS = 5000;
let collapsedSegments = (() => {
  try { return new Set(JSON.parse(localStorage.getItem('cueola_collapsed_segs')||'[]')); }
  catch { return new Set(); }
})();

function pushSessionHistoryState(screen) {
  if (!history.pushState) return;
  try {
    history.pushState({ cueolaSession:true, screen }, '', location.href);
    browserBackGuardReady = true;
  } catch {}
}

function leaveSessionForFrontPage() {
  logShow('session', 'Left session' + (session?.code ? ' ' + session.code : ''));
  clearResumeState();   // P7: intentional leave — never offer to resume it (Decisions #14)
  stopTimer();
  leavePresence();      // drop our presence entry + stop the heartbeat — no ghost participants
  if (firestoreUnsub) { try { firestoreUnsub(); } catch {} firestoreUnsub = null; }
  document.getElementById('rundown')?.classList.remove('on');
  document.getElementById('liveshow')?.classList.remove('on');
  document.getElementById('liveshow')?.classList.remove('prompt-op-active');
  document.getElementById('promptypus')?.classList.remove('on');
  document.getElementById('flowOp')?.classList.remove('on');
  document.getElementById('entry')?.classList.add('on');
  sessionStorage.removeItem('cueola_screen');
}

// ─────────────────────────────────────────────────────────────
// UTILS
// ─────────────────────────────────────────────────────────────
const pad = n => String(n).padStart(2,'0');

function fmtDur(b) {
  if (!b) return '—';
  const m = b.min||0, s = b.sec||0;
  return (m||s) ? `${pad(m)}:${pad(s)}` : '—';
}

function totalSecs() {
  return beats.reduce((acc,b) => acc + (b.min||0)*60 + (b.sec||0), 0);
}

function fmtSecs(t) {
  const h = Math.floor(t/3600), m = Math.floor((t%3600)/60), s = t%60;
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

function fmtProductionClock(ms) {
  if (ms == null || !Number.isFinite(ms)) return '—';
  const safeMs = Math.max(0, ms);
  const totalSeconds = Math.floor(safeMs / 1000);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  const f = Math.min(frameRate - 1, Math.floor((safeMs % 1000) / 1000 * frameRate));
  return `${pad(h)}:${pad(m)}:${pad(s)}:${pad(f)}`;
}

function fmtProductionSecs(t) {
  return fmtProductionClock((t || 0) * 1000);
}

function normalizeTimeValue(value) {
  const raw = String(value || '').trim();
  if (!raw || raw === '—') return '';
  const clean = raw.replace(/\s+/g, ' ').replace(/\./g, '').toUpperCase();
  const meridiem = clean.match(/^(\d{1,2})(?::(\d{2}))?(?::\d{2})?\s*([AP]M)$/);
  if (meridiem) {
    let h = Number(meridiem[1]);
    const m = Number(meridiem[2] || 0);
    if (h < 1 || h > 12 || m < 0 || m > 59) return '';
    if (meridiem[3] === 'AM' && h === 12) h = 0;
    if (meridiem[3] === 'PM' && h !== 12) h += 12;
    return `${pad(h)}:${pad(m)}`;
  }
  const time24 = clean.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (time24) {
    const h = Number(time24[1]);
    const m = Number(time24[2]);
    if (h < 0 || h > 23 || m < 0 || m > 59) return '';
    return `${pad(h)}:${pad(m)}`;
  }
  return '';
}

function timeInputValue(id) {
  return normalizeTimeValue(document.getElementById(id)?.value || '');
}

function setTimeInputValue(id, value, fallback='') {
  const el = document.getElementById(id);
  if (!el) return;
  el.value = normalizeTimeValue(value) || normalizeTimeValue(fallback) || '';
}

// Like normalizeTimeValue, but preserves the literal "N/A" (e.g. a setup day with no show).
function normalizeTimeOrNA(value) {
  return String(value || '').trim().toUpperCase() === 'N/A' ? 'N/A' : normalizeTimeValue(value);
}

function clock(time24, offsetSecs) {
  const normalized = normalizeTimeValue(time24);
  if (!normalized) return '—';
  const [hh,mm] = normalized.split(':').map(Number);
  const total = hh*60 + mm + Math.floor(offsetSecs/60);
  const rh = Math.floor(total/60)%24, rm = total%60;
  const ap = rh>=12?'PM':'AM', h12 = rh%12||12;
  return `${h12}:${pad(rm)} ${ap}`;
}

function toast(msg, dur=2500) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.style.display = 'block';
  clearTimeout(el._t);
  el._t = setTimeout(() => el.style.display='none', dur);
}

const DIALOG_FOCUSABLE = [
  'a[href]',
  'area[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[contenteditable="true"]',
  '[tabindex]:not([tabindex="-1"])'
].join(',');
const activeDialogStack = [];

function dialogIsVisible(el) {
  return !!(el && (el.offsetWidth || el.offsetHeight || el.getClientRects().length));
}

function dialogFocusableEls(dialog) {
  return Array.from(dialog.querySelectorAll(DIALOG_FOCUSABLE)).filter(el => {
    if (el.closest('[hidden]')) return false;
    if (el.closest('[aria-hidden="true"]')) return false;
    return dialogIsVisible(el);
  });
}

function ensureDialogAttrs(el) {
  if (!el) return;
  if (!el.hasAttribute('role')) el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '-1');
  const title = el.querySelector('.modal-title,.warn-title,.ar-heading,.sheet-title,.settings-title,.admin-title,.guide-title,.paperwork-title,.pb-title');
  if (title) {
    if (!title.id) title.id = `${el.id || 'cueola-dialog'}-title`;
    el.setAttribute('aria-labelledby', title.id);
  }
}

function topDialog() {
  for (let i = activeDialogStack.length - 1; i >= 0; i--) {
    const el = activeDialogStack[i];
    if (el && el.classList.contains('on')) return el;
  }
  return null;
}

function setCueolaInert(el, on) {
  if (!el || ['SCRIPT', 'STYLE', 'LINK', 'TEMPLATE'].includes(el.tagName)) return;
  if (on) {
    if (el.dataset.cueolaInert === '1') return;
    el.dataset.cueolaInert = '1';
    el.dataset.cueolaPrevAriaHidden = el.hasAttribute('aria-hidden') ? el.getAttribute('aria-hidden') : '__missing';
    el.setAttribute('aria-hidden', 'true');
    if ('inert' in el) {
      el.dataset.cueolaPrevInert = el.inert ? 'true' : 'false';
      el.inert = true;
    }
    return;
  }
  if (el.dataset.cueolaInert !== '1') return;
  if (el.dataset.cueolaPrevAriaHidden === '__missing') el.removeAttribute('aria-hidden');
  else el.setAttribute('aria-hidden', el.dataset.cueolaPrevAriaHidden || 'true');
  if ('inert' in el) el.inert = el.dataset.cueolaPrevInert === 'true';
  delete el.dataset.cueolaInert;
  delete el.dataset.cueolaPrevAriaHidden;
  delete el.dataset.cueolaPrevInert;
}

function syncDialogInert() {
  const top = topDialog();
  Array.from(document.body.children).forEach(child => {
    const keepActive = top && (child === top || child.contains(top));
    setCueolaInert(child, !!top && !keepActive);
  });
}

function focusDialog(el) {
  const first = dialogFocusableEls(el)[0];
  const panel = el.querySelector('.ar-panel,.modal,.warn-card,.admin-panel,.join-card,.setup-card,.paperwork-modal,.sheet') || el;
  const target = first || panel;
  if (target && typeof target.focus === 'function') target.focus({ preventScroll: true });
}

function openDialog(id) {
  const el = document.getElementById(id);
  if (!el) return null;
  const active = document.activeElement;
  if (active instanceof HTMLElement && !el.contains(active)) el._cueolaReturnFocus = active;
  ensureDialogAttrs(el);
  el.style.display = '';
  el.removeAttribute('aria-hidden');
  el.classList.add('on');
  const existing = activeDialogStack.indexOf(el);
  if (existing !== -1) activeDialogStack.splice(existing, 1);
  activeDialogStack.push(el);
  requestAnimationFrame(() => {
    focusDialog(el);
    syncDialogInert();
  });
  return el;
}

function closeDialog(id) {
  const el = document.getElementById(id);
  if (!el) return null;
  el.classList.remove('on');
  el.setAttribute('aria-hidden', 'true');
  const idx = activeDialogStack.indexOf(el);
  if (idx !== -1) activeDialogStack.splice(idx, 1);
  syncDialogInert();
  const next = topDialog();
  requestAnimationFrame(() => {
    if (next) {
      focusDialog(next);
      return;
    }
    const returnTo = el._cueolaReturnFocus;
    if (returnTo && document.contains(returnTo) && typeof returnTo.focus === 'function') returnTo.focus({ preventScroll: true });
  });
  return el;
}

function initDialogAttrs() {
  document.querySelectorAll('.modal-wrap,.overlay').forEach(el => {
    ensureDialogAttrs(el);
    if (!el.classList.contains('on')) el.setAttribute('aria-hidden', 'true');
  });
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initDialogAttrs, { once: true });
else initDialogAttrs();

document.addEventListener('keydown', event => {
  if (event.key !== 'Tab') return;
  const dialog = topDialog();
  if (!dialog) return;
  const items = dialogFocusableEls(dialog);
  if (!items.length) {
    event.preventDefault();
    focusDialog(dialog);
    return;
  }
  const first = items[0];
  const last = items[items.length - 1];
  const active = document.activeElement;
  if (event.shiftKey && (active === first || !dialog.contains(active))) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && active === last) {
    event.preventDefault();
    first.focus();
  }
});

function showModal(id)  { return openDialog(id); }
function hideModal(id)  { return closeDialog(id); }
function hideOverlay(id){ return closeDialog(id); }
function showOverlay(id){ return openDialog(id); }

let _lastCloudErrorToastAt = 0;

function dangerConfirm(message, detail='', opts={}) {
  const body = [message, detail].filter(Boolean).join('\n\n');
  if (!opts.requireText) return confirm(body);
  const answer = prompt(`${body}\n\nType ${opts.requireText} to confirm.`);
  return answer === opts.requireText;
}

function setCloudSyncState(state='synced', detail='') {
  const dot = document.getElementById('syncDot');
  const badge = document.getElementById('topSessionBadge');
  if (!dot) return;
  dot.classList.remove('saving', 'error', 'off', 'local');
  if (state === 'saving') dot.classList.add('saving');
  else if (state === 'error') dot.classList.add('error');
  else if (state === 'local') dot.classList.add('local');
  else if (state === 'off') dot.classList.add('off');
  if (badge && detail) badge.title = detail;
}

function reportCloudWriteFailure(context='Cloud save', err=null) {
  console.warn(`${context} failed.`, err);
  logShow('sync', context + ' failed — local draft kept' + (err?.code ? ' (' + err.code + ')' : ''));
  setCloudSyncState('error', `${context} failed. Local draft kept; retrying when possible.`);
  const now = Date.now();
  if (now - _lastCloudErrorToastAt > 8000) {
    _lastCloudErrorToastAt = now;
    toast(`${context} failed. Local copy kept.`);
  }
}

const LEARNING_PROGRESS_KEY = 'cueola_learning_progress_v1';
let activeLearningLesson = 0;

const LEARNING_LESSONS = [
  {
    id:'start',
    area:'Start',
    title:'What The Three Tools Do',
    time:'3 min',
    intro:'Cueola is the show brain. Planda Bear is the prep package. Flowmingo is the script display and remote prompter.',
    navigation:[
      'Start inside this guide. Use the lesson list to jump between Cueola, Planda Bear, and Flowmingo.',
      'Use Voice Over, Replay Lesson, and the speed control at the top of the guide while you learn.',
      'Use Previous, Mark Complete, and Next at the bottom of each lesson to move through the training.'
    ],
    steps:[
      'Use Cueola to create or join a show, build rows, add cues, and run the live view.',
      'Use Planda Bear before show day for call sheets, schedules, safety plans, patch sheets, comments, and PDF exports.',
      'Use Flowmingo when talent needs a clean script screen that can be controlled from another window or device.',
      'Keep one shared session code. That code is the bridge between the rundown, paperwork, and prompter.'
    ],
    callouts:[
      ['Session code','The same code connects collaborators, Planda Bear, Flowmingo Talent Display, and Flowmingo Remote Op.'],
      ['Best first move','Load Demo, open this guide beside it, and walk through the lessons once before using a real show.']
    ],
    checks:['I know what Cueola, Planda Bear, and Flowmingo each do.','I know the session code is the shared connection point.'],
    actions:[['Load Demo','demo'],['Open Blank Slate','blank']]
  },
  {
    id:'cueola-build',
    area:'Cueola',
    title:'Build A Rundown',
    time:'5 min',
    intro:'A Cueola rundown is built from rows. Each row is one beat in the production, and each cue cell holds the instructions for one department.',
    navigation:[
      'From the home screen, choose Join Session, Blank Slate, or Load Demo.',
      'Inside the rundown, use Add Row to create the next beat, then click cue cells across that row.',
      'Use Edit in the topbar when you need to reorder rows, rename labels, or remove old beats.'
    ],
    steps:[
      'Join a session or create a Blank Slate code.',
      'Add a row for each show beat: open, intro, segment, package, conversation, outro, or any custom label.',
      'Choose Timed when the row has a known duration. Choose Flex when it can breathe.',
      'Click any cue cell to add Video, Audio, Playback, GFX, Lighting, or Script instructions.',
      'Use Edit when you need to reorder rows, clean labels, or remove old beats.'
    ],
    callouts:[
      ['Rows are beats','Think in production moments, not spreadsheet lines. One row should tell the room what happens next.'],
      ['Script feeds Flowmingo','Anything typed into a Script cue can be assembled and pushed to the talent display.']
    ],
    checks:['I can add a row.','I can add at least one cue cell.','I can tell Timed and Flex rows apart.'],
    actions:[['Open Blank Slate','blank'],['Load Demo','demo']]
  },
  {
    id:'cueola-live',
    area:'Cueola',
    title:'Run Live Without Panic',
    time:'4 min',
    intro:'Live mode turns the rundown into a show-caller surface. It highlights now, next, remaining time, and Flowmingo connection state.',
    navigation:[
      'From the rundown topbar, press Go Live when the rows and script cues are ready.',
      'Use the live bar for Start Show, Script Op, Flowmingo Op, Guide, fullscreen, and Exit.',
      'Use Prev and Next in the live controls to move the Now row without touching the talent display.'
    ],
    steps:[
      'Press Go Live after your rows and script cues are ready.',
      'Review the pre-live checks for script, Flowmingo talent, and cloud sync.',
      'Use Prev and Next to move the show one row at a time.',
      'Use the Script Op panel to edit the live script and push updates to Flowmingo.',
      'Watch the Flowmingo status badge. Connected means talent is sending heartbeats; applied controls confirm the remote worked.'
    ],
    callouts:[
      ['Operator view','Flowmingo Op mode focuses the live screen on prompter controls and script preview.'],
      ['Remote confidence','A sent command is not enough. The app now waits for the talent display to acknowledge applied controls.']
    ],
    checks:['I know where Now and Next are.','I know how to push script updates.','I know what Flowmingo connected/applied status means.'],
    actions:[['Load Demo','demo']]
  },
  {
    id:'plandabear',
    area:'Planda Bear',
    title:'Prep The Show Package',
    time:'6 min',
    intro:'Planda Bear keeps the production paperwork in the same workspace as the rundown so the team is not chasing separate files.',
    navigation:[
      'Open Planda Bear from the home screen card or the topbar button.',
      'Move through Call Sheet, Schedule, Safety Plan, patch sheets, comments, and export from the paperwork hub.',
      'Return to Cueola when the paperwork is set so the rundown and package stay tied to the same session code.'
    ],
    steps:[
      'Open Planda Bear from the home screen or the topbar.',
      'Start with the Call Sheet: production name, date, call time, location, contacts, access, crew, and talent.',
      'Fill the Production Schedule and readiness checklist so setup, rehearsal, show, and wrap are clear.',
      'Add Safety Plan details before the room gets busy.',
      'Use Video Patch, Audio Patch, and Comms Patch sheets to document routing.',
      'Open Production Notes so everyone on the session can post to the discussion board, tag notes by department, reply in threads, and export a single note or the whole board.',
      'Preview or export the PDF package when the paperwork is ready to share.'
    ],
    callouts:[
      ['Comments','Instructors can leave Planda Bear comments without overwriting student work.'],
      ['Production Notes','A shared discussion board: everyone posts, notes carry department tags and threaded replies, and the whole board joins the PDF package.'],
      ['One package','Export PDF Package gathers the paperwork, production notes, and rendered rundown into one shareable file.']
    ],
    checks:['I can open Planda Bear.','I know which paperwork page to fill first.','I know where PDF export lives.'],
    actions:[['Open Planda Bear','plandabear']]
  },
  {
    id:'flowmingo-talent',
    area:'Flowmingo',
    title:'Set Up The Talent Display',
    time:'4 min',
    intro:'The Talent Display is the screen talent reads. It should be opened in its own browser window or device and controlled remotely.',
    navigation:[
      'Open Flowmingo Talent Display from the home screen or the live bar Flowmingo button.',
      'Put the talent display in its own window or device, enter the same session code, then go fullscreen.',
      'After it shows ready, leave that window alone and control it from Script Op or Flowmingo Remote Op.'
    ],
    steps:[
      'Open Flowmingo Talent Display from the home screen or live screen.',
      'Enter the same session code used by the show.',
      'Wait for the READY state and confirm the Script check is on.',
      'Use Controls only for local setup: speed, size, alignment, theme, mirror, and fullscreen.',
      'Once live, leave the talent display alone. Run it from Script Op or Flowmingo Remote Op.'
    ],
    callouts:[
      ['Do not touch the talent window','The remote path is built so the operator can control play, pause, speed, size, theme, mirror, and reset without focusing the talent screen.'],
      ['Break markers','Markers like [BREAK - AUTO PAUSE] and [STOP HERE] can help the prompter stop at planned moments.']
    ],
    checks:['I can open the Talent Display.','I can connect it with a session code.','I know the talent window should stay untouched during operation.'],
    actions:[['Open Talent Display','talent']]
  },
  {
    id:'flowmingo-remote',
    area:'Flowmingo',
    title:'Run The Remote Prompter',
    time:'5 min',
    intro:'Flowmingo Remote Op is the dedicated control surface for the talent display. It is meant to work from another tab, window, or device.',
    navigation:[
      'Open Flowmingo Remote Op on the operator window or device and enter the same session code as talent.',
      'Keep Remote Op focused. The talent display does not need to be clicked or touched.',
      'Use the on-screen controls or hotkeys, then watch sent and applied status to confirm the talent display obeyed.'
    ],
    steps:[
      'Open Remote Op and load the same session code as the talent screen.',
      'Confirm the status says ready, then use Play to start talent scrolling.',
      'Use Space for play/pause, hold Down to brake, hold Up to boost, Left/Right for text size, and Option plus Down or Up for direction.',
      'Use Reset if the talent needs to return to the top.',
      'Watch for applied acknowledgements. If a command does not ack, check that the talent display is still connected.'
    ],
    callouts:[
      ['Control ownership','If Flowmingo Remote Op is active, Script Op pauses its own remote control briefly so operators do not fight each other.'],
      ['Trouble signal','No talent ack means the command was sent but the talent screen did not confirm it. Reconnect the talent display or reload its session code.']
    ],
    checks:['I can open Remote Op.','I know the hotkeys.','I know how to read sent versus applied status.'],
    actions:[['Open Remote Op','remote']]
  },
  {
    id:'support',
    area:'Support',
    title:'First Fixes When Something Feels Off',
    time:'4 min',
    intro:'Most show-day problems come from code mismatch, a missing script, or a talent screen that was closed, reloaded, or asleep.',
    navigation:[
      'Start with the session code: every Cueola, Planda Bear, Talent Display, and Remote Op window must match.',
      'Use live Script Op to push missing or changed script text to Flowmingo.',
      'Use Talent Display and Remote Op together to test Play, Reset, Mirror, then Reset again before the room depends on it.'
    ],
    steps:[
      'If collaborators cannot see the show, confirm everyone has the same session code.',
      'If Flowmingo is blank, confirm there is Script cue text and push to Flowmingo from live Script Op.',
      'If the remote says sent but not applied, reload the Talent Display and enter the same code again.',
      'If the wrong row is live, use Prev or Next until Now matches the room.',
      'If paperwork looks stale, reopen Planda Bear and check the activity and comments area.'
    ],
    callouts:[
      ['Fast rehearsal check','Before doors open: open Talent Display, open Remote Op, press Play, Reset, Mirror, then Reset again.'],
      ['When in doubt','A clean reload plus the same session code should reconnect the show, paperwork, and prompter surfaces.']
    ],
    checks:['I know the first three things to check: code, script, talent connection.','I know how to recover Flowmingo without touching the live talent window.'],
    actions:[['Open Guide Start','start']]
  }
];

const CUEOLA_TTS_MUTED_KEY = 'cueola_tts_muted';
const CUEOLA_TTS_RATE_KEY = 'cueola_tts_rate';
const LOCAL_NARRATION_VOICE = 'af_heart';
const LOCAL_NARRATION_BASE = `assets/narration/${LOCAL_NARRATION_VOICE}`;
const LOCAL_NARRATION_MANIFEST = `${LOCAL_NARRATION_BASE}/manifest.json`;
const TTS_SVG_ON = `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>`;
const TTS_SVG_OFF = `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/></svg>`;

function normalizeTTSRate(value) {
  const n = parseFloat(value);
  if (!Number.isFinite(n)) return 1;
  return Math.max(0.5, Math.min(1.5, n));
}

const cueolaTTS = {
  muted: localStorage.getItem(CUEOLA_TTS_MUTED_KEY) !== 'false',
  rate: normalizeTTSRate(localStorage.getItem(CUEOLA_TTS_RATE_KEY) || '1'),
  voice: LOCAL_NARRATION_VOICE,
  _audio: null,
  localManifestLoaded: false,
  localManifestPromise: null,
  localAssetRefs: new Set(),
  localMissingRefs: new Set(),
};

function ttsExpand(text) {
  return String(text || '')
    .replace(/\bCueola\b/g, 'Cue oh la')
    .replace(/\bPlanda Bear\b/g, 'Planda Bear')
    .replace(/\bFlowmingo\b/g, 'Flow mingo')
    .replace(/\bGFX\b/g, 'graphics')
    .replace(/\bPDF\b/g, 'P D F')
    .replace(/\bVO\b/g, 'voice over')
    .replace(/\bOp\b/g, 'operator')
    .replace(/\bMP3\b/g, 'M P 3')
    .replace(/\bUI\b/g, 'user interface')
    .replace(/\b[A-Z]{2,}\b/g, word => word.toLowerCase());
}

function ttsClean(text) {
  return ttsExpand(text)
    .replace(/[\u{1F000}-\u{1FFFF}]/gu, '')
    .replace(/[✓✗↺•·→←↑↓]/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function ttsStop() {
  if (cueolaTTS._audio) {
    try {
      cueolaTTS._audio.pause();
      cueolaTTS._audio.currentTime = 0;
    } catch {}
    cueolaTTS._audio = null;
  }
}

function browserCanPlayMp3() {
  const probe = document.createElement('audio');
  return !!probe.canPlayType && probe.canPlayType('audio/mpeg') !== '';
}

function getLocalNarrationUrl(refId) {
  return refId ? `${LOCAL_NARRATION_BASE}/${encodeURIComponent(refId)}.mp3` : '';
}

function setTTSAssetStatus(text) {
  document.querySelectorAll('[data-tts-status],#ttsAssetStatus').forEach(el => {
    el.textContent = text;
  });
}

function setTTSDot(state) {
  document.querySelectorAll('.tts-toggle-btn').forEach(btn => {
    btn.querySelectorAll('.tts-dot').forEach(dot => dot.remove());
    if (!state) return;
    const dot = document.createElement('span');
    dot.className = `tts-dot ${state}`;
    btn.appendChild(dot);
  });
}

async function loadLocalNarrationManifest() {
  // Promise check first — localManifestLoaded flips synchronously below, so a
  // caller arriving mid-fetch must get the pending promise, not the empty set.
  if (cueolaTTS.localManifestPromise) return cueolaTTS.localManifestPromise;
  if (cueolaTTS.localManifestLoaded) return cueolaTTS.localAssetRefs;
  cueolaTTS.localManifestPromise = (async () => {
    cueolaTTS.localManifestLoaded = true;
    setTTSAssetStatus(cueolaTTS.muted ? 'Voice over off.' : 'Checking Heart voice files...');
    setTTSDot(cueolaTTS.muted ? null : 'tts-system-loading');
    try {
      const response = await fetch(LOCAL_NARRATION_MANIFEST, { cache:'no-store' });
      if (!response.ok) throw new Error('Narration manifest unavailable.');
      const manifest = await response.json();
      if (!browserCanPlayMp3()) {
        cueolaTTS.localAssetRefs = new Set();
        setTTSAssetStatus(cueolaTTS.muted ? 'Voice over off.' : 'Kokoro MP3 playback unavailable in this browser.');
        setTTSDot(null);
        return cueolaTTS.localAssetRefs;
      }
      const files = Array.isArray(manifest.files) ? manifest.files : [];
      cueolaTTS.localAssetRefs = new Set(files.map(item => String(item).replace(/\.mp3$/i, '')));
      if (cueolaTTS.localAssetRefs.size) {
        setTTSAssetStatus(cueolaTTS.muted ? 'Voice over off.' : 'Heart voice ready.');
        setTTSDot(cueolaTTS.muted ? null : 'tts-system-ready');
      } else {
        setTTSAssetStatus(cueolaTTS.muted ? 'Voice over off.' : 'Kokoro files pending.');
        setTTSDot(null);
      }
    } catch {
      cueolaTTS.localAssetRefs = new Set();
      setTTSAssetStatus(cueolaTTS.muted ? 'Voice over off.' : (window.location.protocol === 'file:'
        ? 'Use the preview URL for Kokoro voice over.'
        : 'Kokoro files pending.'));
      setTTSDot(null);
    }
    return cueolaTTS.localAssetRefs;
  })();
  return cueolaTTS.localManifestPromise;
}

function playLocalNarration(refId) {
  if (!refId) return Promise.resolve(false);
  if (cueolaTTS.localMissingRefs.has(refId) || !cueolaTTS.localAssetRefs.has(refId)) {
    setTTSAssetStatus(`Kokoro file pending: ${refId}`);
    return Promise.resolve(false);
  }
  const url = getLocalNarrationUrl(refId);
  if (!url) return Promise.resolve(false);
  return new Promise(resolve => {
    const audio = new Audio(url);
    let settled = false;
    const finish = result => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    audio.playsInline = true;
    audio.preload = 'auto';
    audio.playbackRate = cueolaTTS.rate;
    audio.onended = () => {
      if (cueolaTTS._audio === audio) cueolaTTS._audio = null;
      setTTSAssetStatus('Heart voice ready.');
    };
    audio.onerror = () => {
      cueolaTTS.localMissingRefs.add(refId);
      setTTSAssetStatus(`Kokoro file pending: ${refId}`);
      finish(false);
    };
    audio.play()
      .then(() => {
        cueolaTTS._audio = audio;
        setTTSAssetStatus('Playing Heart voice.');
        finish(true);
      })
      .catch(() => {
        setTTSAssetStatus('Tap once, then try voice over again.');
        finish(false);
      });
  });
}

function initTTS() {
  updateTTSButtons();
  return loadLocalNarrationManifest();
}

async function ttsSpeak(text, priority=true, refId='') {
  if (cueolaTTS.muted) return false;
  if (priority) ttsStop();
  await initTTS();
  if (refId && await playLocalNarration(refId)) return true;
  setTTSAssetStatus(refId ? `Kokoro file pending: ${refId}` : 'Kokoro narration file pending.');
  return false;
}

function ttsCancelAndSpeak(text, refId='') {
  return ttsSpeak(text, true, refId);
}

function learningNarrationRefId(lesson) {
  return lesson?.id ? `LH-${lesson.id}.lesson` : '';
}

function learningNarrationText(lesson) {
  if (!lesson) return '';
  const navigation = (lesson.navigation || []).map((item, i) => `Where to go ${i + 1}. ${item}`).join(' ');
  const steps = (lesson.steps || []).map((step, i) => `Step ${i + 1}. ${step}`).join(' ');
  const callouts = (lesson.callouts || []).map(([title, text]) => `${title}. ${text}`).join(' ');
  return `${lesson.title}. ${lesson.intro} ${navigation} ${steps} ${callouts}`;
}

function speakActiveLearningLesson(priority=true) {
  const lesson = LEARNING_LESSONS[activeLearningLesson] || LEARNING_LESSONS[0];
  if (!lesson) return Promise.resolve(false);
  setTTSAssetStatus('Reading lesson...');
  return ttsSpeak(learningNarrationText(lesson), priority, learningNarrationRefId(lesson));
}

async function replayCurrentLearningVO() {
  if (cueolaTTS.muted) {
    cueolaTTS.muted = false;
    localStorage.setItem(CUEOLA_TTS_MUTED_KEY, 'false');
    updateTTSButtons();
  }
  await initTTS();
  return speakActiveLearningLesson(true);
}

function toggleTTS() {
  cueolaTTS.muted = !cueolaTTS.muted;
  localStorage.setItem(CUEOLA_TTS_MUTED_KEY, String(cueolaTTS.muted));
  if (cueolaTTS.muted) {
    ttsStop();
    setTTSAssetStatus('Voice over off.');
    updateTTSButtons();
    return;
  }
  updateTTSButtons();
  initTTS().then(() => {
    const guideOpen = document.getElementById('learningHubModal')?.classList.contains('on');
    if (guideOpen) speakActiveLearningLesson(true);
    else openLearningHub('start');
  });
}

function setTTSRate(value) {
  cueolaTTS.rate = normalizeTTSRate(value);
  localStorage.setItem(CUEOLA_TTS_RATE_KEY, String(cueolaTTS.rate));
  if (cueolaTTS._audio) {
    try { cueolaTTS._audio.playbackRate = cueolaTTS.rate; } catch {}
  }
  updateTTSButtons();
}

function updateTTSButtons() {
  const icon = cueolaTTS.muted ? sfIcon('action.volume.mute') : sfIcon('action.volume.up');
  document.querySelectorAll('.tts-toggle-btn').forEach(btn => {
    const short = btn.dataset.ttsShort === '1';
    const label = cueolaTTS.muted ? (short ? 'VO Off' : 'Voice Over Off') : (short ? 'VO On' : 'Voice Over On');
    btn.innerHTML = `${icon}<span>${label}</span>`;
    btn.setAttribute('aria-label', cueolaTTS.muted ? 'Turn on voice over' : 'Turn off voice over');
    btn.setAttribute('aria-pressed', String(!cueolaTTS.muted));
    btn.classList.toggle('tts-active', !cueolaTTS.muted);
  });
  const rate = cueolaTTS.rate.toFixed(2) + 'x';
  const range = document.getElementById('ttsRateRange');
  const label = document.getElementById('ttsRateLabel');
  if (range) range.value = String(cueolaTTS.rate);
  if (label) label.textContent = rate;
  if (cueolaTTS.muted) setTTSDot(null);
  else setTTSDot(cueolaTTS.localAssetRefs.size ? 'tts-system-ready' : null);
}

function readLearningProgress() {
  try {
    const raw = JSON.parse(localStorage.getItem(LEARNING_PROGRESS_KEY) || '{}');
    return {
      complete: Array.isArray(raw.complete) ? raw.complete : [],
      checks: raw.checks && typeof raw.checks === 'object' ? raw.checks : {}
    };
  } catch {
    return { complete:[], checks:{} };
  }
}

function writeLearningProgress(progress) {
  try { localStorage.setItem(LEARNING_PROGRESS_KEY, JSON.stringify(progress)); } catch {}
}

function openLearningHub(lessonId='') {
  const idx = LEARNING_LESSONS.findIndex(l => l.id === lessonId);
  if (idx >= 0) activeLearningLesson = idx;
  renderLearningHub();
  showModal('learningHubModal');
  if (!cueolaTTS.muted) setTimeout(() => speakActiveLearningLesson(true), 120);
}

function renderLearningHub() {
  const progress = readLearningProgress();
  const done = new Set(progress.complete || []);
  const list = document.getElementById('guideLessonList');
  const count = document.getElementById('guideProgressCount');
  const fill = document.getElementById('guideProgressFill');
  if (count) count.textContent = `${done.size}/${LEARNING_LESSONS.length}`;
  if (fill) fill.style.width = `${LEARNING_LESSONS.length ? (done.size / LEARNING_LESSONS.length) * 100 : 0}%`;
  if (list) {
    list.innerHTML = LEARNING_LESSONS.map((lesson, i) => `
      <button type="button" class="guide-lesson-btn ${i===activeLearningLesson?'active':''} ${done.has(lesson.id)?'done':''}" onclick="selectLearningLesson(${i})">
        <span class="guide-num">${done.has(lesson.id) ? '✓' : i + 1}</span>
        <span class="guide-nav-copy">
          <span class="guide-nav-title">${esc(lesson.title)}</span>
          <span class="guide-nav-meta">${esc(lesson.area)} · ${esc(lesson.time)}</span>
        </span>
        <span class="guide-done-dot"></span>
      </button>
    `).join('');
  }
  renderLearningLesson();
}

function renderLearningLesson() {
  const lesson = LEARNING_LESSONS[activeLearningLesson] || LEARNING_LESSONS[0];
  const body = document.getElementById('guideLessonBody');
  if (!lesson || !body) return;
  const progress = readLearningProgress();
  const done = progress.complete.includes(lesson.id);
  const checks = progress.checks?.[lesson.id] || [];
  body.innerHTML = `
    <div class="guide-lesson-head">
      <div>
        <div class="guide-kicker">${esc(lesson.area)}</div>
        <div class="guide-lesson-title">${esc(lesson.title)}</div>
      </div>
      <div class="guide-lesson-time">${esc(lesson.time)}</div>
    </div>
    <div class="guide-lesson-copy">${esc(lesson.intro)}</div>
    ${(lesson.navigation || []).length ? `
    <section class="guide-section guide-nav-section">
      <div class="guide-section-title">Where To Go</div>
      <div class="guide-routes">
        ${lesson.navigation.map((item, i) => `
          <div class="guide-route">
            <div class="guide-route-index">${i + 1}</div>
            <div class="guide-route-text">${esc(item)}</div>
          </div>
        `).join('')}
      </div>
    </section>
    ` : ''}
    <section class="guide-section">
      <div class="guide-section-title">Do This</div>
      <div class="guide-steps">
        ${lesson.steps.map((step, i) => `
          <div class="guide-step">
            <div class="guide-step-num">${i + 1}</div>
            <div class="guide-step-text">${esc(step)}</div>
          </div>
        `).join('')}
      </div>
    </section>
    <section class="guide-section">
      <div class="guide-section-title">Know This</div>
      <div class="guide-callouts">
        ${lesson.callouts.map(([title, text]) => `<div class="guide-callout"><strong>${esc(title)}</strong><span>${esc(text)}</span></div>`).join('')}
      </div>
    </section>
    <section class="guide-section">
      <div class="guide-section-title">Check Yourself</div>
      <div class="guide-checklist">
        ${lesson.checks.map((check, i) => `
          <label class="guide-check">
            <input type="checkbox" ${checks[i] ? 'checked' : ''} onchange="setLearningCheck('${lesson.id}',${i},this.checked)">
            <span>${esc(check)}</span>
          </label>
        `).join('')}
      </div>
    </section>
    <div class="guide-actions">
      <div class="guide-action-left">
        ${(lesson.actions || []).length ? `<span class="guide-try-label">Try it now →</span>` : ''}
        ${(lesson.actions || []).map(([label, action]) => `<button type="button" class="guide-mini-btn guide-try-btn" onclick="openGuideAction('${action}')">▶ ${esc(label)}</button>`).join('')}
      </div>
      <div class="guide-action-right">
        <button type="button" class="guide-mini-btn" onclick="selectLearningLesson(${activeLearningLesson - 1})" ${activeLearningLesson <= 0 ? 'disabled' : ''}>Previous</button>
        <button type="button" class="guide-mini-btn primary" onclick="toggleLearningComplete('${lesson.id}')">${done ? 'Mark Incomplete' : 'Mark Complete'}</button>
        <button type="button" class="guide-mini-btn" onclick="selectLearningLesson(${activeLearningLesson + 1})" ${activeLearningLesson >= LEARNING_LESSONS.length - 1 ? 'disabled' : ''}>Next</button>
      </div>
    </div>
  `;
}

function selectLearningLesson(index) {
  activeLearningLesson = Math.max(0, Math.min(LEARNING_LESSONS.length - 1, index));
  renderLearningHub();
  if (!cueolaTTS.muted) speakActiveLearningLesson(true);
}

function setLearningCheck(lessonId, index, checked) {
  const progress = readLearningProgress();
  const lesson = LEARNING_LESSONS.find(l => l.id === lessonId);
  if (!progress.checks[lessonId]) progress.checks[lessonId] = [];
  progress.checks[lessonId][index] = !!checked;
  const allChecked = lesson?.checks?.length && lesson.checks.every((_, i) => progress.checks[lessonId][i]);
  progress.complete = progress.complete.filter(id => id !== lessonId);
  if (allChecked) progress.complete.push(lessonId);
  writeLearningProgress(progress);
  renderLearningHub();
}

function toggleLearningComplete(lessonId) {
  const progress = readLearningProgress();
  const isDone = progress.complete.includes(lessonId);
  progress.complete = progress.complete.filter(id => id !== lessonId);
  if (!isDone) {
    progress.complete.push(lessonId);
    const lesson = LEARNING_LESSONS.find(l => l.id === lessonId);
    progress.checks[lessonId] = (lesson?.checks || []).map(() => true);
  }
  writeLearningProgress(progress);
  renderLearningHub();
}

function openGuideAction(action) {
  if (action === 'start') { openLearningHub('start'); return; }
  hideModal('learningHubModal');
  if (action === 'demo') loadDemo();
  else if (action === 'blank') openBlankSlateSetup();
  else if (action === 'plandabear') openPaperworkHub();
  else if (action === 'talent') openPrompterApp();
  else if (action === 'remote') openFlowmingoOperator(ptLinkedCueolaCode || session.code || '');
}

function markPaperworkDirty() {
  if (typeof currentPaperworkItemId === 'function' && currentPaperworkItemId()) paperworkDirty = true;
}

function confirmSaveUnsavedPaperwork() {
  if (!paperworkDirty) return true;
  if (confirm('You have unsaved Planda Bear data. Save it before leaving this page?')) {
    saveOpenPaperworkSection(false);
    paperworkDirty = false;
    toast('Planda Bear saved.');
    return true;
  }
  return confirm('Leave without saving those Planda Bear changes?');
}

window.addEventListener('beforeunload', e => {
  if (!paperworkDirty) return;
  e.preventDefault();
  e.returnValue = '';
});

document.addEventListener('input', e => {
  if (e.target?.closest?.('#preProModal,#productionScheduleModal,#safetyPlanModal,#patchSheetModal')) {
    markPaperworkDirty();
  }
});
document.addEventListener('change', e => {
  if (e.target?.closest?.('#preProModal,#productionScheduleModal,#safetyPlanModal,#patchSheetModal')) {
    markPaperworkDirty();
  }
});

function toggleCueolaFullscreen(screenId) {
  const el = document.getElementById(screenId);
  if (!el) return;
  const isFull = document.fullscreenElement === el || document.webkitFullscreenElement === el;
  if (isFull) {
    (document.exitFullscreen || document.webkitExitFullscreen || function(){}).call(document);
  } else {
    (el.requestFullscreen || el.webkitRequestFullscreen || function(){}).call(el);
  }
}

// ─────────────────────────────────────────────────────────────
// ADMIN SYSTEM (Firestore-backed, localStorage fallback cache)
// ─────────────────────────────────────────────────────────────
const ADMIN_KEY = 'cueola_admins_v2';         // localStorage mirror key
const ADMIN_SESSION_KEY = 'cueola_admin_sess'; // localStorage session key
const ADMINS_DOC = 'admins/global';            // Firestore document path
const OWNER_BOOTSTRAP_HASH = '045515f2';
const OWNER_ADMIN_ID = 'adm_owner_jonkost';

let _adminsCache = [];      // in-memory list, always current
let _adminsCacheReady = false; // true once Firestore (or fallback) has loaded
let _adminsUnsub = null;    // Firestore onSnapshot unsubscribe

const SESSION_SOURCE_DEFAULTS = {
  video: ['CAM 1','CAM 2','CAM 3','CAM 4','CPU','PLBK','GFX','ME 1'],
  audio: ['Host','Guest 1','Guest 2','CPU','PLBK','VOU','SFX','Music','Mains'],
  gfx:   ['GFX','Media 1','Media 2','Media 3','Media 4','ME 1'],
  scriptWho: ['Host','Guest 1','Guest 2','VOU'],
};

function hashStr(s) {
  let h = 0;
  for (let i=0;i<s.length;i++) { h = Math.imul(31,h)+s.charCodeAt(i)|0; }
  return (h>>>0).toString(16).padStart(8,'0');
}

function isOwnerBootstrapCode(code) {
  return hashStr(code || '') === OWNER_BOOTSTRAP_HASH;
}

// ── Read helpers (always sync against in-memory cache) ──────
function getAdmins()      { return _adminsCache; }
function hasSuperAdmin()  { return _adminsCache.some(a=>a.level==='super'); }
function countFullAccess(){ return _adminsCache.filter(a=>a.level==='super'||a.level==='full').length; }

// ── Write: update cache + localStorage mirror + Firestore ───
function saveAdmins(list) {
  _adminsCache = list;
  try { localStorage.setItem(ADMIN_KEY, JSON.stringify(list)); } catch {}
  if (window._firebaseReady) {
    window._setDoc(window._doc(window._db, 'admins', 'global'), { list })
      .catch(err => reportCloudWriteFailure('Admin cloud save', err));
  }
}

// ── Load from Firestore; migrate localStorage admins if first run ──
function initAdminsFromFirestore() {
  if (!window._firebaseReady) return;
  const ref = window._doc(window._db, 'admins', 'global');

  // Set up real-time listener — changes on any device propagate here instantly
  if (_adminsUnsub) _adminsUnsub();
  _adminsUnsub = window._onSnapshot(ref, snap => {
    if (snap.exists()) {
      _adminsCache = snap.data().list || [];
    } else {
      // First run: migrate any existing localStorage admins to Firestore
      const local = (() => { try { return JSON.parse(localStorage.getItem(ADMIN_KEY))||[]; } catch { return []; } })();
      _adminsCache = local;
      if (local.length) {
        window._setDoc(ref, { list: local }).catch(err => reportCloudWriteFailure('Admin migration', err));
      }
    }
    _adminsCacheReady = true;
    // Re-run session restore now that we have real data
    restoreAdminSession();
    updateAdminUI();
  }, () => {
    // Firestore read failed — fall back to localStorage
    _adminsCache = (() => { try { return JSON.parse(localStorage.getItem(ADMIN_KEY))||[]; } catch { return []; } })();
    _adminsCacheReady = true;
    restoreAdminSession();
    updateAdminUI();
  });
}

// ── Session: device-local, verified against cache ───────────
function loginAdmin(code) {
  if (!_adminsCacheReady) {
    const owner = ensureOwnerSuperAdmin(code);
    if (owner) {
      adminSession = { id:owner.id, name:owner.name, level:owner.level };
      try { localStorage.setItem(ADMIN_SESSION_KEY, JSON.stringify(adminSession)); } catch {}
      try { renderPresence(currentPresence); } catch {}
      return adminSession;
    }
    toast('Admin data loading — try again in a moment.');
    return null;
  }
  const h = hashStr(code);
  const a = _adminsCache.find(x=>x.codeHash===h);
  const resolved = a || ensureOwnerSuperAdmin(code);
  if (!resolved) return null;
  adminSession = { id:resolved.id, name:resolved.name, level:resolved.level };
  try { localStorage.setItem(ADMIN_SESSION_KEY, JSON.stringify(adminSession)); } catch {}
  try { renderPresence(currentPresence); } catch {}   // badges become clickable right away
  return adminSession;
}

function logoutAdmin() {
  adminSession = null;
  try { localStorage.removeItem(ADMIN_SESSION_KEY); } catch {}
  updateAdminUI();
  try { renderPresence(currentPresence); } catch {}
}

function restoreAdminSession() {
  try {
    const s = JSON.parse(localStorage.getItem(ADMIN_SESSION_KEY));
    if (s) {
      const a = _adminsCache.find(x=>x.id===s.id);
      if (a) adminSession = { id:a.id, name:a.name, level:a.level };
      else   adminSession = null; // admin was removed — invalidate session
    }
  } catch {}
}

// ── CRUD helpers ─────────────────────────────────────────────
function createAdmin(name, code, level, createdBy=null) {
  const list = [..._adminsCache];
  const id = 'adm_'+Date.now().toString(36);
  list.push({ id, name, codeHash:hashStr(code), level, createdBy });
  saveAdmins(list);
  return id;
}

function ensureOwnerSuperAdmin(code) {
  if (!isOwnerBootstrapCode(code)) return null;
  const existingOwner = _adminsCache.find(a=>a.id===OWNER_ADMIN_ID);
  const owner = {
    id: OWNER_ADMIN_ID,
    name: existingOwner?.name || 'Jon Kost',
    codeHash: existingOwner?.codeHash || OWNER_BOOTSTRAP_HASH,
    level: 'super',
    createdBy: 'owner-bootstrap'
  };
  const list = _adminsCache.filter(a=>a.id!==OWNER_ADMIN_ID);
  list.unshift(owner);
  saveAdmins(list);
  return owner;
}

function removeAdmin(id) {
  saveAdmins(_adminsCache.filter(a=>a.id!==id));
}

function updateAdminCode(id, newCode) {
  const idx = _adminsCache.findIndex(a=>a.id===id);
  if (idx < 0) return false;
  const list = _adminsCache.map(a=>a.id===id ? {...a, codeHash:hashStr(newCode)} : a);
  saveAdmins(list);
  return true;
}

function updateAdminUI() {
  const btn = document.getElementById('adminBtn');
  if (!btn) return;
  if (adminSession) {
    btn.textContent = adminSession.name.split(' ')[0];
    btn.className = 'tbtn tbtn-admin';
  } else {
    btn.textContent = 'Admin';
    btn.className = 'tbtn tbtn-ghost';
  }
}

// ─────────────────────────────────────────────────────────────
// ADMIN LOGIN OVERLAY
// ─────────────────────────────────────────────────────────────
function openAdminLogin() {
  hideModal('adminSetupModal');
  document.getElementById('adminCodeIn').value = '';
  document.getElementById('adminLoginErr').classList.remove('on');
  const hint = document.getElementById('adminSetupHint');
  hint.style.display = hasSuperAdmin() ? 'none' : 'block';
  showModal('adminLoginModal');
  setTimeout(()=>document.getElementById('adminCodeIn').focus(),100);
}

function submitAdminLogin() {
  const code = document.getElementById('adminCodeIn').value.trim();
  if (!code) return;
  const result = loginAdmin(code);
  if (result) {
    hideModal('adminLoginModal');
    updateAdminUI();
    toast(`Welcome, ${result.name}`);
    if (document.getElementById('rundown').classList.contains('on')) openAdminPanel();
  } else {
    document.getElementById('adminLoginErr').classList.add('on');
    document.getElementById('adminCodeIn').value='';
    document.getElementById('adminCodeIn').focus();
  }
}

function openAdminSetup() {
  hideModal('adminLoginModal');
  document.getElementById('setupOwnerCode').value = '';
  showModal('adminSetupModal');
}

function submitAdminSetup() {
  const name  = document.getElementById('setupAdminName').value.trim();
  const owner = document.getElementById('setupOwnerCode').value;
  const code  = document.getElementById('setupAdminCode').value;
  const code2 = document.getElementById('setupAdminCode2').value;
  const err   = document.getElementById('setupAdminErr');
  err.classList.remove('on');
  if (!name || !owner || !code) { err.textContent='Name, owner bootstrap code, and admin code are required.'; err.classList.add('on'); return; }
  if (!isOwnerBootstrapCode(owner)) { err.textContent='Owner bootstrap code is required to create a super admin.'; err.classList.add('on'); return; }
  if (code.trim().length < 4) { err.textContent='Use at least 4 characters for the admin code.'; err.classList.add('on'); return; }
  if (code !== code2) { err.textContent='Codes do not match.'; err.classList.add('on'); return; }
  if (hasSuperAdmin() && !_adminsCache.some(a=>a.id===OWNER_ADMIN_ID)) { err.textContent='Super admin already exists.'; err.classList.add('on'); return; }
  ensureOwnerSuperAdmin(owner);
  updateAdminCode(OWNER_ADMIN_ID, code);
  const admins = getAdmins().map(a=>a.id===OWNER_ADMIN_ID ? {...a, name:name||'Jon Kost'} : a);
  saveAdmins(admins);
  loginAdmin(code);
  hideModal('adminSetupModal');
  updateAdminUI();
  toast(`Super admin created. Welcome, ${name}!`);
}

// ─────────────────────────────────────────────────────────────
// ADMIN PANEL
// ─────────────────────────────────────────────────────────────
function openAdminPanel() {
  if (!adminSession) { openAdminLogin(); return; }
  document.getElementById('adminWhoName').textContent = adminSession.name;
  const chip = document.getElementById('adminWhoChip');
  chip.textContent = adminSession.level.toUpperCase();
  chip.className = `admin-level-chip alc-${adminSession.level}`;
  renderAdminBody();
  showOverlay('adminPanel');
}

function closeAdminPanel(e) {
  if (e && e.target !== document.getElementById('adminPanel')) return;
  hideOverlay('adminPanel');
}

function renderAdminBody() {
  const body = document.getElementById('adminBody');
  // Presence heartbeats rebuild this panel while it is open. Safari never gives
  // checkboxes/selects focus, so the activeElement guard can't protect mid-edit
  // assignment rows — carry any unsaved edits into the rebuild instead of
  // silently resetting them to the last saved state.
  const pendingAssignments = body?.querySelector('[data-role-assignment-row]')
    ? getRoleAssignmentsFromAdminDOM(true) : null;
  const admins = getAdmins();
  const isSuper = adminSession.level==='super';
  const isFull  = adminSession.level==='full'||isSuper;

  let html = '';

  // ── Admin management ──
  if (isSuper) {
    html += `<div class="admin-section">
      <div class="admin-section-label">Admin Management</div>
      ${session.code ? `<div class="admin-session-actions">
        <button class="admin-act-btn" onclick="copySessionCode()">Copy Session Code</button>
        <button class="admin-act-btn" onclick="copySessionLink()">Copy Session Link</button>
        <button class="admin-act-btn" onclick="shareSessionInvite()">Share Session</button>
        <button class="admin-act-btn" onclick="openPaperworkHub()">Open Planda Bear</button>
      </div>` : ''}
      <div class="admin-list">`;
    admins.forEach(a => {
      const isMe = a.id===adminSession.id;
      const canEdit = isSuper && !isMe; // super can edit others; full cannot see codes
      const canRemove = (isSuper && !isMe) || (isFull && a.level==='standard' && !isMe);
      const levelClass = `alc-${a.level}`;
      const canEditCode = isSuper; // super can edit any code including own
      html += `<div class="admin-item">
        <div>
          <div class="admin-item-name">${esc(a.name)}</div>
          <span class="admin-level-chip ${levelClass}" style="margin-top:4px;display:inline-block">${a.level.toUpperCase()}</span>
        </div>
        <div style="flex:1"></div>
        ${isMe ? '<span class="admin-item-you">YOU</span>' : ''}
        <div class="admin-item-acts">
          ${session.code ? `<button class="admin-act-btn" onclick="shareSessionInvite(${JSON.stringify(a.name).replace(/"/g,'&quot;')})">Send Session</button>` : ''}
          ${canEditCode ? `<button class="admin-act-btn" onclick="promptEditCode('${a.id}',${JSON.stringify(a.name).replace(/"/g,'&quot;')})">Edit Code</button>` : ''}
          ${isSuper && !isMe && a.level==='standard' ? `<button class="admin-act-btn" onclick="promoteToFull('${a.id}')">→ Full</button>` : ''}
          ${isSuper && !isMe && a.level==='full' ? `<button class="admin-act-btn" onclick="promoteToSuper('${a.id}')">→ Super</button><button class="admin-act-btn" onclick="demoteToStandard('${a.id}')">→ Standard</button>` : ''}
          ${isSuper && !isMe && a.level==='super' ? `<button class="admin-act-btn" onclick="demoteToFull('${a.id}')">→ Full</button>` : ''}
          ${canRemove ? `<button class="admin-act-btn danger" onclick="confirmRemoveAdmin('${a.id}',${JSON.stringify(a.name).replace(/"/g,'&quot;')})">Remove</button>` : ''}
        </div>
      </div>`;
    });
    html += `</div>`;

    // Add admin form
    html += `<div class="admin-add-form" id="addAdminForm">
      <div class="admin-add-label">Add Admin</div>
      <input class="admin-in" id="newAdminName" type="text" placeholder="Name" autocomplete="off">
      <input class="admin-in" id="newAdminCode" type="password" placeholder="Admin code" autocomplete="new-password">
      <div class="admin-level-row">
        <button class="admin-level-btn sel" id="newLvlStandard" onclick="selectNewLevel('standard')">Standard</button>
        ${isSuper && countFullAccess()<3 ? `<button class="admin-level-btn" id="newLvlFull" onclick="selectNewLevel('full')">Full Access</button>` : ''}
      </div>
      <div id="newAdminErr" style="font-size:12px;color:var(--red);display:none"></div>
      <button class="admin-add-btn" onclick="submitAddAdmin()">Add Admin</button>
    </div>`;

    html += `</div>`;
  }

  // ── Session sources ──
  if (session.code || session.isExpert) {
    html += `<div class="admin-section">
      <div class="admin-section-label">Session Sources <span style="color:var(--text3);font-size:9px">(this session only)</span></div>
      <div class="admin-sources-grid">
        ${renderSourcesRow('video','Video')}
        ${renderSourcesRow('audio','Audio')}
        ${renderSourcesRow('gfx','GFX')}
        ${renderSourcesRow('scriptWho','Script / Who')}
      </div>
    </div>`;
  }

  if (session.code) {
    const presenceNames = getActivePresencePeople().map(p=>p.name);
    const nameOpts = presenceNames.map(n=>`<option value="${esc(n)}">${esc(n)}</option>`).join('');
    html += `<div class="admin-section" style="margin-top:16px">
      <div class="admin-section-label">Live Control</div>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
        <select id="adminFollowSelect" class="field-in" style="flex:1;min-width:120px;font-size:12px;padding:6px 10px">
          ${presenceNames.length ? nameOpts : '<option>No users online</option>'}
        </select>
        <button class="admin-act-btn danger" ${presenceNames.length?'':'disabled'}${presenceNames.length?'':' style="opacity:.45;cursor:not-allowed"'} onclick="adminForceLive(document.getElementById('adminFollowSelect').value)">Force Everyone Live + Follow</button>
      </div>
    </div>`;
  }
  if (session.code || session.isExpert) {
    html += `<div class="admin-section" style="margin-top:16px">
      <div class="admin-section-label">Show Clock</div>
      <div style="font-size:11px;color:var(--text3);line-height:1.5;margin-bottom:8px">Reset the elapsed clock to 0:00 and jump back to the first row — take the show from the top.</div>
      <button class="admin-act-btn danger" onclick="restartShowClock()">↺ Restart Show Clock</button>
    </div>`;
  }
  if (session.code || session.isExpert) {
    const positionOptions = getRolePositionOptions();
    html += `<div class="admin-section">
      <div class="admin-section-label">Role and Planda Bear Assignments</div>
      <div style="font-size:10.5px;color:var(--text3);line-height:1.5;margin-bottom:8px">Changes save automatically and show on the Planda Bear hub for everyone in the session.</div>
      <div class="admin-src-row" style="margin-bottom:10px">
        <span class="admin-src-label">Positions</span>
        <div class="admin-src-chips">
          ${positionOptions.map(p => `<span class="admin-src-chip">${esc(p)}<button class="rm" onclick="removePositionOption(${JSON.stringify(p).replace(/"/g,'&quot;')})" title="Remove ${esc(p)} from this production">x</button></span>`).join('')}
          <button class="admin-src-add" onclick="addPositionOption()">+ Add</button>
        </div>
      </div>
      <div id="adminRoleAssignments" onchange="autoSaveRoleAssignments()">${renderRoleAssignmentRows(pendingAssignments?.length ? pendingAssignments : undefined)}</div>
      <div class="admin-assignment-actions">
        <button class="admin-act-btn" onclick="addRoleAssignmentRow()">+ Add Person</button>
        <button class="admin-add-btn" onclick="saveRoleAssignmentsFromAdmin()">Save Assignments</button>
      </div>
    </div>`;
  }

  // ── People in session (remove a device from the code) ──
  if (session.code && !session.isDemo && !session.isExpert) {
    const people = getActivePresencePeople();
    html += `<div class="admin-section" style="margin-top:16px">
      <div class="admin-section-label">People in Session</div>
      ${people.length ? `<div class="admin-list">` + people.map(p => {
        const isMe = sameParticipantName(p.name, session.userName);
        return `<div class="admin-item">
          <div class="admin-item-name">${esc(p.name)}
            <span class="admin-level-chip ${p.role==='instructor'?'alc-full':'alc-standard'}" style="margin-left:7px">${p.role==='instructor'?'INST':'STU'}</span>
          </div>
          <div style="flex:1"></div>
          ${isMe ? '<span class="admin-item-you">YOU</span>'
                 : `<div class="admin-item-acts"><button class="admin-act-btn danger" onclick="removePersonFromSession(${JSON.stringify(p.name).replace(/"/g,'&quot;')})">Remove</button></div>`}
        </div>`;
      }).join('') + `</div>`
      : `<div style="font-size:11px;color:var(--text3)">No one is connected right now.</div>`}
      <div style="font-size:10.5px;color:var(--text3);line-height:1.5;margin-top:8px">Remove disconnects that person's device from this code. They can rejoin with the same code — move the session to a new code to keep them out.</div>
    </div>`;

    // ── Session rescue: move the whole show to a fresh code ──
    html += `<div class="admin-section" style="margin-top:16px">
      <div class="admin-section-label">Session Code</div>
      <div style="font-size:11px;color:var(--text3);line-height:1.5;margin-bottom:8px">Current code: <b style="color:var(--text);font-family:var(--mono)">${esc(session.code)}</b>. If there's a problem with this session — a leaked code, stale data, or someone who keeps rejoining — move the whole show (rundown, Planda Bear, notes) to a fresh code. Everyone connected follows automatically; anyone joining later needs the new code.</div>
      <button class="admin-act-btn danger" onclick="moveSessionToNewCode()">Move Session to a New Code</button>
    </div>`;
  }
  html += `<button class="admin-logout-btn" onclick="logoutAdmin();closeAdminPanel()">Logout Admin</button>`;
  body.innerHTML = html;
  window._newAdminLevel = 'standard';
}

const ROLE_POSITION_OPTIONS = [
  'Producer',
  'Director',
  'Assistant Director',
  'Production Manager',
  'PM',
  'Stage Manager',
  'Show Caller',
  'Technical Director',
  'ENG Lead',
  'Video Lead',
  'Audio Lead',
  'Graphics Operator',
  'Playback Operator',
  'Camera Operator',
  'Camera 1',
  'Camera 2',
  'Camera 3',
  'Camera 4',
  'Host',
  'Guest',
  'Talent',
  'Script Runner',
  'Flowmingo Operator',
  'Safety Lead',
  'Runner',
  'Crew',
];

function defaultRoleAssignments() {
  return [{ person:'', position:'', paperwork:[] }];
}

function cleanUniqueStrings(values) {
  const seen = new Set();
  return (values || []).map(v => String(v || '').trim()).filter(v => {
    if (!v) return false;
    const key = v.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function collectSessionParticipantNames(data={}) {
  const names = [];
  if (Array.isArray(data.participants)) {
    data.participants.forEach(p => names.push(typeof p === 'string' ? p : p?.name));
  }
  if (data.presence && typeof data.presence === 'object') {
    Object.values(data.presence).forEach(p => names.push(p?.name));
  }
  return cleanUniqueStrings(names);
}

function getAssignmentPeople(savedRows=[]) {
  return cleanUniqueStrings([
    ...sessionParticipantNames,
    ...getActivePresencePeople().map(p => p.name),
    ...savedRows.map(row => row?.person || row?.name),
  ]);
}

function basePlandaBearAssignmentOptions(data=loadPreProData()) {
  const sheets = getCallSheets(data);
  const callSheets = sheets.map((sheet, i) => `Call Sheet: ${callSheetDisplayName(sheet, i)}`);
  return cleanUniqueStrings([
    ...callSheets,
    'Production Schedule',
    'Safety Plan',
    'Rundown',
    'Flowmingo Script',
    'Video Patch Sheet',
    'Audio & Comms Patch Sheet',
    'Tech Checklist',
  ]);
}

function plandaBearAssignmentOptions(data=loadPreProData()) {
  const options = basePlandaBearAssignmentOptions(data);
  if (Array.isArray(data.roleAssignments)) {
    data.roleAssignments.forEach(row => {
      const saved = row?.paperwork || row?.paperworkItems;
      if (Array.isArray(saved)) saved.forEach(item => {
        const label = String(item || '').trim();
        if (label && !options.some(opt => opt.toLowerCase() === label.toLowerCase())) options.push(label);
      });
    });
  }
  return options;
}

function normalizePaperworkSelections(value, options=basePlandaBearAssignmentOptions()) {
  const out = [];
  const add = label => {
    if (!label) return;
    const exact = options.find(opt => opt.toLowerCase() === String(label).trim().toLowerCase()) || String(label).trim();
    if (exact && !out.some(v => v.toLowerCase() === exact.toLowerCase())) out.push(exact);
  };
  const firstCallSheet = options.find(opt => opt.toLowerCase().startsWith('call sheet'));
  const scan = item => {
    if (Array.isArray(item)) { item.forEach(scan); return; }
    const text = String(item || '').trim();
    if (!text) return;
    const exact = options.find(opt => opt.toLowerCase() === text.toLowerCase());
    if (exact) { add(exact); return; }
    const lower = text.toLowerCase();
    let matched = false;
    if (lower.includes('call sheet')) { add(firstCallSheet); matched = true; }
    if (lower.includes('production schedule') || lower.includes('production scheduler')) { add('Production Schedule'); matched = true; }
    if (lower.includes('safety')) { add('Safety Plan'); matched = true; }
    if (lower.includes('rundown')) { add('Rundown'); matched = true; }
    if (lower.includes('flowmingo') || lower.includes('script')) { add('Flowmingo Script'); matched = true; }
    if (lower.includes('video') || lower.includes('patch sheet') || lower.includes('patch sheets')) { add('Video Patch Sheet'); matched = true; }
    if (lower.includes('audio') || lower.includes('comms') || lower.includes('patch sheet') || lower.includes('patch sheets')) { add('Audio & Comms Patch Sheet'); matched = true; }
    if (lower.includes('tech')) { add('Tech Checklist'); matched = true; }
    if (!matched) add(text);
  };
  scan(value);
  return out;
}

function normalizeRoleAssignment(row={}, options=plandaBearAssignmentOptions()) {
  return {
    person: String(row.person || row.name || '').trim(),
    position: String(row.position || row.role || '').trim(),
    paperwork: normalizePaperworkSelections(row.paperwork || row.paperworkItems || row.file, options),
  };
}

function getRoleAssignments() {
  const data = loadPreProData();
  const options = plandaBearAssignmentOptions(data);
  const saved = Array.isArray(data.roleAssignments) ? data.roleAssignments.map(row => normalizeRoleAssignment(row, options)) : [];
  const rows = saved.filter(row => row.person || row.position || row.paperwork.length);
  const seen = new Set(rows.map(row => row.person.trim().toLowerCase()).filter(Boolean));
  getAssignmentPeople(rows).forEach(name => {
    const key = name.trim().toLowerCase();
    if (!seen.has(key)) {
      rows.push({ person:name, position:'', paperwork:[] });
      seen.add(key);
    }
  });
  return rows.length ? rows : defaultRoleAssignments();
}

// Positions offered in the assignment dropdown, tailored per production:
// the built-in list minus anything this session removed, plus anything it
// added, alphabetical. Stored on the session's prePro doc so every device
// on the code sees the same list.
function getRolePositionOptions(data=loadPreProData()) {
  const removed = (Array.isArray(data.positionsRemoved) ? data.positionsRemoved : []).map(v => String(v || '').trim().toLowerCase());
  const custom = Array.isArray(data.positionsCustom) ? data.positionsCustom : [];
  return cleanUniqueStrings([
    ...ROLE_POSITION_OPTIONS.filter(p => !removed.includes(p.toLowerCase())),
    ...custom,
  ]).sort((a, b) => a.localeCompare(b, undefined, { sensitivity:'base' }));
}

function addPositionOption() {
  const name = (prompt('Add a position for this production:') || '').trim();
  if (!name) return;
  const data = loadPreProData();
  const key = name.toLowerCase();
  const custom = Array.isArray(data.positionsCustom) ? data.positionsCustom.slice() : [];
  const removed = (Array.isArray(data.positionsRemoved) ? data.positionsRemoved : [])
    .filter(r => String(r || '').trim().toLowerCase() !== key);   // re-adding a removed default un-hides it
  const listed = getRolePositionOptions({ ...data, positionsCustom: custom, positionsRemoved: removed });
  if (listed.some(p => p.toLowerCase() === key)) {
    if ((data.positionsRemoved || []).length === removed.length) { toast('That position is already in the list.'); return; }
  } else {
    custom.push(name);
  }
  persistPreProData({ positionsCustom: custom, positionsRemoved: removed }, 'Positions');
  renderAdminBody();
  toast(`Position "${name}" added.`);
}

function removePositionOption(name) {
  const key = String(name || '').trim().toLowerCase();
  if (!key) return;
  const data = loadPreProData();
  const custom = (Array.isArray(data.positionsCustom) ? data.positionsCustom : [])
    .filter(p => String(p || '').trim().toLowerCase() !== key);
  const removed = Array.isArray(data.positionsRemoved) ? data.positionsRemoved.slice() : [];
  if (ROLE_POSITION_OPTIONS.some(p => p.toLowerCase() === key) && !removed.some(r => String(r || '').trim().toLowerCase() === key)) {
    removed.push(String(name).trim());
  }
  persistPreProData({ positionsCustom: custom, positionsRemoved: removed }, 'Positions');
  renderAdminBody();
  toast(`Position "${name}" removed. Anyone already assigned to it keeps it.`);
}

function rolePositionOptionsHTML(selected='') {
  const chosen = String(selected || '').trim();
  // Keep the chosen value selectable even if it was removed from this
  // production's list — an existing assignment must never silently change.
  const options = cleanUniqueStrings([...getRolePositionOptions(), chosen])
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity:'base' }));
  return `<option value="">Select position</option>` + options.map(opt => `<option value="${esc(opt)}" ${opt.toLowerCase() === chosen.toLowerCase() ? 'selected' : ''}>${esc(opt)}</option>`).join('');
}

function renderRoleAssignmentRows(rows=getRoleAssignments()) {
  const normalizedRows = (rows.length ? rows : defaultRoleAssignments()).map(row => normalizeRoleAssignment(row));
  const people = getAssignmentPeople(normalizedRows);
  const peopleOptions = people.map(name => `<option value="${esc(name)}"></option>`).join('');
  const paperworkOptions = plandaBearAssignmentOptions();
  return `<div class="admin-assignment-list">
    ${normalizedRows.map((row,i)=>{
      const selectedPaperwork = new Set(row.paperwork.map(item => item.toLowerCase()));
      return `<div class="admin-assignment-row" data-role-assignment-row="${i}">
        <div class="admin-assignment-top">
          <div class="field">
            <label class="admin-add-label">Student</label>
            <input class="admin-in" data-role-field="person" value="${esc(row.person)}" list="adminAssignmentPeople" placeholder="Name">
          </div>
          <div class="field">
            <label class="admin-add-label">Position</label>
            <select class="admin-in" data-role-field="position">${rolePositionOptionsHTML(row.position)}</select>
          </div>
          <button class="admin-assignment-remove" onclick="removeRoleAssignmentRow(${i})" title="Remove assignment">x</button>
        </div>
        <div class="field">
          <label class="admin-add-label">Planda Bear Paperwork</label>
          <div class="admin-paperwork-checks">
            ${paperworkOptions.map(option => `<label class="admin-paperwork-pill"><input type="checkbox" data-role-field="paperwork" value="${esc(option)}" ${selectedPaperwork.has(option.toLowerCase()) ? 'checked' : ''}>${esc(option)}</label>`).join('')}
          </div>
        </div>
      </div>`;
    }).join('')}
    <datalist id="adminAssignmentPeople">${peopleOptions}</datalist>
  </div>`;
}

function getRoleAssignmentsFromAdminDOM(includeBlank=false) {
  const rows = Array.from(document.querySelectorAll('[data-role-assignment-row]')).map(rowEl => {
    const person = rowEl.querySelector('[data-role-field="person"]')?.value?.trim() || '';
    const position = rowEl.querySelector('[data-role-field="position"]')?.value?.trim() || '';
    const paperwork = Array.from(rowEl.querySelectorAll('[data-role-field="paperwork"]:checked')).map(input => input.value);
    return { person, position, paperwork };
  });
  return includeBlank ? rows : rows.filter(row => row.person || row.position || row.paperwork.length);
}

function rerenderRoleAssignments(rows) {
  const wrap = document.getElementById('adminRoleAssignments');
  if (wrap) wrap.innerHTML = renderRoleAssignmentRows(rows.length ? rows : defaultRoleAssignments());
}

function addRoleAssignmentRow() {
  const rows = getRoleAssignmentsFromAdminDOM(true);
  rows.push({ person:'', position:'', paperwork:[] });
  rerenderRoleAssignments(rows);
}

function removeRoleAssignmentRow(index) {
  const rows = getRoleAssignmentsFromAdminDOM(true);
  rows.splice(index, 1);
  rerenderRoleAssignments(rows);
}

function saveRoleAssignmentsFromAdmin() {
  clearTimeout(_assignmentAutoSaveTimer);
  const rows = getRoleAssignmentsFromAdminDOM().map(row => normalizeRoleAssignment(row));
  persistPreProData({ roleAssignments: rows }, 'Role Assignments');
  rerenderRoleAssignments(rows);
  renderPlandaBearAssignmentsCard();
  toast('Role assignments saved.');
}

// Every change (position picked, paperwork checked, name entered) saves right
// away — a presence-driven panel rebuild must never eat an unsaved assignment.
let _assignmentAutoSaveTimer = null;
function autoSaveRoleAssignments() {
  clearTimeout(_assignmentAutoSaveTimer);
  _assignmentAutoSaveTimer = setTimeout(() => {
    const rows = getRoleAssignmentsFromAdminDOM().map(row => normalizeRoleAssignment(row));
    persistPreProData({ roleAssignments: rows });   // no section → no activity-log spam per click
    renderPlandaBearAssignmentsCard();
  }, 400);
}

function renderSourcesRow(key, label) {
  const defaults = SESSION_SOURCE_DEFAULTS[key] || [];
  const removed = sessionCustomSources.__removed?.[key] || [];
  const custom = (sessionCustomSources[key]||[]);
  const all = [...defaults.filter(s=>!removed.includes(s)), ...custom];
  const chips = all.map(s => {
    return `<span class="admin-src-chip">${esc(s)}<button class="rm" onclick="removeSessionSource('${key}',${JSON.stringify(s).replace(/"/g,'&quot;')})" title="Remove ${esc(s)}">x</button></span>`;
  }).join('');
  return `<div class="admin-src-row">
    <span class="admin-src-label">${label}</span>
    <div class="admin-src-chips">${chips}
      <button class="admin-src-add" onclick="addCustomSource('${key}')">+ Add</button>
    </div>
  </div>`;
}

let _newAdminLevel = 'standard';
function selectNewLevel(lvl) {
  _newAdminLevel = lvl;
  document.querySelectorAll('.admin-level-btn').forEach(b => b.classList.remove('sel'));
  const btn = document.getElementById(`newLvl${lvl.charAt(0).toUpperCase()+lvl.slice(1)}`);
  if (btn) btn.classList.add('sel');
}

function submitAddAdmin() {
  const name = document.getElementById('newAdminName').value.trim();
  const code = document.getElementById('newAdminCode').value.trim();
  const err  = document.getElementById('newAdminErr');
  err.style.display='none';
  if (!name||!code) { err.textContent='Name and code required.'; err.style.display='block'; return; }
  if (code.length < 4) { err.textContent='Use at least 4 characters for an admin code.'; err.style.display='block'; return; }
  if (_adminsCache.some(a => a.name.trim().toLowerCase() === name.toLowerCase())) { err.textContent='An admin with that name already exists.'; err.style.display='block'; return; }
  if (_adminsCache.some(a => a.codeHash === hashStr(code))) { err.textContent='That admin code is already in use.'; err.style.display='block'; return; }
  if (_newAdminLevel==='full' && countFullAccess()>=3) { err.textContent='Max 3 full-access admins.'; err.style.display='block'; return; }
  createAdmin(name, code, _newAdminLevel, adminSession.id);
  renderAdminBody();
  toast(`Admin "${name}" added.`);
}

function promptEditCode(id, name) {
  const code = prompt(`New code for ${name}:`);
  const clean = (code || '').trim();
  if (!clean) return;
  if (clean.length < 4) { toast('Use at least 4 characters for an admin code.'); return; }
  if (_adminsCache.some(a => a.id !== id && a.codeHash === hashStr(clean))) { toast('That admin code is already in use.'); return; }
  if (updateAdminCode(id, clean)) toast('Code updated.');
}

function sessionInviteLink() {
  const url = new URL(location.href);
  url.searchParams.set('code', session.code || '');
  url.hash = '';
  return url.toString();
}

function writeClipboard(text, doneMsg) {
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(text).then(()=>toast(doneMsg)).catch(()=>prompt('Copy this:', text));
  } else {
    prompt('Copy this:', text);
  }
}

function copySessionCode() {
  if (!session.code) return;
  writeClipboard(session.code, 'Session code copied.');
}

function copySessionLink() {
  if (!session.code) return;
  writeClipboard(sessionInviteLink(), 'Session link copied.');
}

function shareSessionInvite(name='') {
  if (!session.code) return;
  const text = `${name ? `${name}, join` : 'Join'} ${show.name || 'Cueola'}\nCode: ${session.code}\n${sessionInviteLink()}`;
  if (navigator.share) {
    navigator.share({ title:'Cueola Session', text }).catch(()=>{});
  } else {
    writeClipboard(text, 'Session invite copied.');
  }
}

// ─────────────────────────────────────────────────────────────
// SESSION RESCUE — remove a person, or move the show to a new code
// ─────────────────────────────────────────────────────────────
// Sessions have no accounts, so "remove" is a soft kick: delete the person's
// presence entries and flag their device ids so their clients bounce back to
// the front page. A determined person can rejoin with the code — moving the
// session to a fresh code is the hard lock-out.
async function removePersonFromSession(name) {
  if (!session.code || !window._firebaseReady) { toast('A cloud session is required to remove people.'); return; }
  if (!dangerConfirm(`Remove "${name}" from this session?`, 'Their device is disconnected from this session code. They can rejoin with the same code — use "Move Session to a New Code" to keep them out for good.')) return;
  try {
    const ref = window._doc(window._db, 'sessions', session.code);
    const updates = {};
    Object.entries(currentPresence || {}).forEach(([id, p]) => {
      if (p?.name && sameParticipantName(p.name, name)) {
        updates[`presence.${id}`] = window._deleteField();
        updates[`kicked.${id}`] = Date.now();
      }
    });
    const snap = await window._getDoc(ref);
    const parts = (snap.exists() && Array.isArray(snap.data().participants)) ? snap.data().participants : [];
    updates.participants = parts.filter(p => !sameParticipantName(p?.name, name));
    await window._updateDoc(ref, updates);
    toast(`${name} removed from ${session.code}.`);
    renderAdminBody();
  } catch {
    toast('Could not remove — check the connection and try again.');
  }
}

// Copy the whole session doc to a fresh code and leave a forwarding pointer on
// the old doc. Every connected client sees `movedTo` and follows automatically.
async function moveSessionToNewCode() {
  if (!session.code || !window._firebaseReady || session.isDemo || session.isExpert) { toast('A cloud session is required to move codes.'); return; }
  if (!dangerConfirm('Move this session to a new code?', 'Cueola copies the whole show — rundown, Planda Bear paperwork, and notes — to a fresh session code. Everyone connected right now follows automatically. The old code stops updating, and anyone joining later needs the new code.')) return;
  const oldCode = session.code;
  try {
    let newCode = '';
    for (let i = 0; i < 10 && !newCode; i++) {
      const candidate = genCode() + (i > 2 ? String(Math.floor(Math.random() * 9) + 1) : '');
      if (candidate === oldCode) continue;
      const taken = await window._getDoc(window._doc(window._db, 'sessions', candidate));
      if (!taken.exists()) newCode = candidate;
    }
    if (!newCode) { toast('Could not find a free code — try again.'); return; }

    const oldRef = window._doc(window._db, 'sessions', oldCode);
    const snap = await window._getDoc(oldRef);
    const data = snap.exists() ? { ...snap.data() } : {};
    delete data.presence; delete data.kicked; delete data.movedTo; delete data.forceCmd;
    data.code = newCode;
    data.movedFrom = oldCode;
    data.participants = [];
    data.createdAt = window._serverTimestamp();
    await window._setDoc(window._doc(window._db, 'sessions', newCode), data);

    // Per-code local caches follow the show to the new key.
    ['cueola_prepro_', 'cueola_pb_notes_', 'cueola_pb_note_draft_', 'cueola_pb_comments_', 'cueola_customSources_'].forEach(prefix => {
      try {
        const v = localStorage.getItem(prefix + oldCode);
        if (v != null) localStorage.setItem(prefix + newCode, v);
      } catch {}
    });

    await window._updateDoc(oldRef, { movedTo: { code: newCode, by: session.userName || 'Instructor', at: Date.now() } });
    hideOverlay('adminPanel');
    followSessionMove(newCode, true);
  } catch {
    toast('Could not move the session — check the connection and try again.');
  }
}

// Switch this client onto a new session code (as the mover, or following a
// movedTo pointer another instructor wrote).
function followSessionMove(newCode, isMover = false) {
  const wasLive = document.getElementById('liveshow')?.classList.contains('on');
  if (firestoreUnsub) { try { firestoreUnsub(); } catch {} firestoreUnsub = null; }
  leavePresence();   // builds its doc ref from session.code synchronously — still the old code here
  session.code = String(newCode || '').trim().toUpperCase();
  rememberLastSession(session.code, session.userName);
  enterRundown();    // re-subscribes Firestore, rejoins presence, refreshes the code badge
  if (wasLive) setTimeout(goLive, 300);
  if (isMover) {
    copySessionCode();
    toast(`Session moved — new code ${session.code} copied. Share it with anyone joining later.`);
  } else {
    toast(`This session moved to a new code: ${session.code}`);
  }
}

function promoteToFull(id) {
  if (countFullAccess()>=3) { toast('Max 3 full-access admins reached.'); return; }
  const admins = getAdmins();
  const a = admins.find(x=>x.id===id);
  if (a && !dangerConfirm(`Promote "${a.name}" to Full Access?`, 'Full Access admins can manage sessions and operate high-impact show controls.')) return;
  if (a) { a.level='full'; saveAdmins(admins); renderAdminBody(); toast(`${a.name} promoted to Full Access.`); }
}

function promoteToSuper(id) {
  const admins = getAdmins();
  const a = admins.find(x=>x.id===id);
  if (a && !dangerConfirm(`Promote "${a.name}" to Super Admin?`, 'Super admins can add, remove, promote, and demote other admins across this app.', { requireText:'SUPER' })) return;
  if (a) { a.level='super'; saveAdmins(admins); renderAdminBody(); toast(`${a.name} promoted to Super Admin.`); }
}

function demoteToFull(id) {
  const admins = getAdmins();
  const a = admins.find(x=>x.id===id);
  if (a && !dangerConfirm(`Demote "${a.name}" to Full Access?`, 'They will keep broad show access but lose Super Admin management powers.')) return;
  if (a) { a.level='full'; saveAdmins(admins); renderAdminBody(); toast(`${a.name} set to Full Access.`); }
}

function demoteToStandard(id) {
  const admins = getAdmins();
  const a = admins.find(x=>x.id===id);
  if (a && !dangerConfirm(`Demote "${a.name}" to Standard?`, 'They will lose full-access controls for shared show management.')) return;
  if (a) { a.level='standard'; saveAdmins(admins); renderAdminBody(); toast(`${a.name} set to Standard.`); }
}

function confirmRemoveAdmin(id, name) {
  if (!dangerConfirm(`Remove admin "${name}"?`, 'Their saved admin session will stop working on the next admin sync. This does not delete show data.', { requireText:'REMOVE' })) return;
  removeAdmin(id);
  renderAdminBody();
  toast(`${name} removed.`);
}

function addCustomSource(key) {
  const val = prompt(`Add custom source for ${key}:`);
  if (!val||!val.trim()) return;
  const clean = val.trim();
  const defaults = SESSION_SOURCE_DEFAULTS[key] || [];
  if (!sessionCustomSources.__removed) sessionCustomSources.__removed = {};
  if (!sessionCustomSources.__removed[key]) sessionCustomSources.__removed[key] = [];
  if (defaults.includes(clean)) {
    sessionCustomSources.__removed[key] = sessionCustomSources.__removed[key].filter(s=>s!==clean);
    syncSessionSources();
    renderAdminBody();
    return;
  }
  if (!sessionCustomSources[key]) sessionCustomSources[key]=[];
  if (sessionCustomSources[key].includes(clean)) return;
  sessionCustomSources[key].push(clean);
  syncSessionSources();
  renderAdminBody();
}

function removeCustomSource(key, idx) {
  if (!sessionCustomSources[key]) return;
  sessionCustomSources[key].splice(idx,1);
  syncSessionSources();
  renderAdminBody();
}

function removeSessionSource(key, value) {
  const defaults = SESSION_SOURCE_DEFAULTS[key] || [];
  if (!sessionCustomSources.__removed) sessionCustomSources.__removed = {};
  if (!sessionCustomSources.__removed[key]) sessionCustomSources.__removed[key] = [];
  if (defaults.includes(value)) {
    if (!sessionCustomSources.__removed[key].includes(value)) sessionCustomSources.__removed[key].push(value);
  } else if (sessionCustomSources[key]) {
    sessionCustomSources[key] = sessionCustomSources[key].filter(s=>s!==value);
  }
  syncSessionSources();
  renderAdminBody();
}

function syncSessionSources() {
  if (window._firebaseReady && session.code && !session.isDemo) {
    window._updateDoc(window._doc(window._db,'sessions',session.code),{ customSources: sessionCustomSources })
      .catch(err => reportCloudWriteFailure('Source list cloud save', err));
  }
  localStorage.setItem('cueola_customSources_'+session.code, JSON.stringify(sessionCustomSources));
}

function getSources(key) {
  const defaults = SESSION_SOURCE_DEFAULTS[key] || [];
  const removed = sessionCustomSources.__removed?.[key] || [];
  return [...defaults.filter(s=>!removed.includes(s)), ...(sessionCustomSources[key]||[])];
}

function migrateOldCue(type, d) {
  if (!d) return d;
  if (
    d.on !== undefined ||
    d.off !== undefined ||
    d.ready !== undefined ||
    d.take !== undefined
  ) return d; // already migrated
  let migrated;
  switch(type) {
    case 'video':
      migrated = { ready:[d.state,d.source].filter(Boolean).join(' '), take:d.source?`${d.state==='Set'?'Dissolve':'Take'} ${d.source}`:'' }; break;
    case 'audio':
      migrated = { ready:[d.action,d.source].filter(Boolean).join(' '), take:d.action||'' }; break;
    case 'playback':
      migrated = { ready:[d.state,d.clipName].filter(Boolean).join(' '), take:d.clipName?`Roll ${d.clipName}`:'Roll' }; break;
    case 'gfx':
      migrated = { ready:[d.gfxType,d.transition].filter(Boolean).join(' / '), take:'Take GFX' }; break;
    case 'lighting':
      migrated = { ready:[d.action,d.fixture].filter(Boolean).join(' '), take:d.action==='At'?`Go ${d.intensity||0}%`:'Go' }; break;
    case 'script':
      migrated = { ready:d.who||'', take:'Begin', text:d.text||'' }; break;
    default: return d;
  }
  // P8 (dress-rehearsal find): the legacy rebuild above replaced the object and
  // silently dropped the Outrangutan link fields (P4) — a linked cue in the old
  // {state,clipName} shape lost its playout/SFX link on the next sync echo.
  ['outCueId', 'outAuto', 'outPadId', 'outPadAuto'].forEach(k => { if (d[k] !== undefined) migrated[k] = d[k]; });
  return migrated;
}

function migrateBeat(b) {
  if (b.cues === undefined) {
    // Very old format: { type, cueData }
    const cues = {};
    if (b.type && b.cueData && Object.keys(b.cueData).length) {
      cues[b.type] = migrateOldCue(b.type, b.cueData);
    }
    return { id:b.id, style:b.style||'flex', info:b.info||'', notes:b.notes||'', min:b.min||0, sec:b.sec||0, done:b.done||false, cues };
  }
  // Has cues — migrate each cue's fields to ready/take format
  const newCues = {};
  Object.keys(b.cues).forEach(type => {
    newCues[type] = CT[type] ? migrateOldCue(type, b.cues[type]) : b.cues[type];
  });
  return { ...b, cues: newCues };
}

// ─────────────────────────────────────────────────────────────
// SESSION MANAGEMENT
// ─────────────────────────────────────────────────────────────
const presenceId = Math.random().toString(36).slice(2,10);
let presenceInterval = null;
let firestoreUnsub = null;
const FIREBASE_WAIT_MS = 2500;
let rundownCloudBeats = [];
let rundownShadowBeats = [];
let rundownShadowShow = { name:'Untitled Show', start:'', freeMode:false };
let rundownAliases = {};
let rundownPendingBatches = [];
let rundownSyncRunning = false;
let rundownSyncRetryTimer = null;
let beatIdSequence = 0;

function genCode() {
  const d = new Date();
  const yy=String(d.getFullYear()).slice(-2), mm=pad(d.getMonth()+1);
  const letters='ABCDEFGHJKLMNPQRSTUVWXYZ';
  const l = letters[Math.floor(Math.random()*letters.length)];
  return `${yy}${mm}${l}`;
}

function waitForFirebaseReady(timeoutMs=FIREBASE_WAIT_MS) {
  if (window._firebaseReady) return Promise.resolve(true);
  return new Promise(resolve => {
    const t = setTimeout(() => resolve(false), timeoutMs);
    window.addEventListener('firebaseReady', () => {
      clearTimeout(t);
      resolve(true);
    }, { once:true });
  });
}

function firebaseConnectionLabel(err, fallback='Connection error') {
  const code = err?.code || '';
  if (code === 'permission-denied') return 'Cloud access denied';
  if (code === 'unavailable') return 'Cloud unavailable';
  if (code === 'not-found') return 'Not found';
  return fallback;
}

function firebaseConnectionHint(err) {
  const code = err?.code || '';
  if (code === 'permission-denied') return 'Firebase denied access. Check Firestore rules for shared sessions.';
  if (code === 'unavailable') return 'Could not reach Firebase. Check the network and try again.';
  return 'Connection error. Try again, or use a local script if this is just one browser.';
}

function openLocalSession(code='', name='You', role='instructor', showName='Untitled Show') {
  session = { code:(code || '').trim().toUpperCase(), role, userName:name || 'You', isDemo:false, isExpert:false };
  show = { name:showName || 'Untitled Show', start:'' };
  beats = [];
  freeTextMode = true;
  rememberLastSession(session.code, session.userName);
  restoreLocalDraft();
  enterRundown();
  toast('Opened local copy. Shared sync is unavailable while offline.');
}

function openLocalPlandaBear(code='', name='You') {
  session = { code:(code || 'LOCAL').trim().toUpperCase(), role:'instructor', userName:name || 'You', isDemo:false, isExpert:false };
  freeTextMode = true;
  rememberLastSession(session.code, session.userName);
  restoreLocalDraft();
  const data = loadPreProData();
  show = {
    name:data.production || show.name || 'Untitled Show',
    start:normalizeTimeValue(data.showStart || show.start),
  };
  hideModal('modal-prepro-join');
  if (preProJoinTarget === 'notes') {
    openProductionNotes();
    toast('Opened local Production Notes. Shared sync is unavailable while offline.');
  } else {
    openPaperworkHub();
    toast('Opened local Planda Bear copy. Shared sync is unavailable while offline.');
  }
}

function createSession() {
  const name = document.getElementById('inst-name').value.trim();
  const showName = document.getElementById('inst-show').value.trim();
  if (!name) { document.getElementById('inst-err').classList.add('on'); return; }
  document.getElementById('inst-err').classList.remove('on');
  session = { code:genCode(), role:'instructor', userName:name, isDemo:false, isExpert:false };
  show.name = showName||'Untitled Show';
  freeTextMode = false;
  document.getElementById('code-display-val').textContent = session.code;
  hideModal('modal-inst');
  showModal('modal-code');
}

function enterAsInstructor() {
  hideModal('modal-code');
  enterRundown();
}

// Remember the last session code + name so the user only enters them once,
// whether they came in through Cueola (Join Session) or Planda Bear.
function rememberLastSession(code, name) {
  try {
    if (code) localStorage.setItem('cueola_last_code', code);
    if (name) localStorage.setItem('cueola_last_name', name);
  } catch {}
}

function prefillJoinFields(codeId, nameId) {
  let code = '';
  let name = '';
  try {
    code = localStorage.getItem('cueola_last_code') || '';
    name = localStorage.getItem('cueola_last_name') || '';
  } catch {}
  const codeEl = document.getElementById(codeId);
  const nameEl = document.getElementById(nameId);
  if (codeEl && !codeEl.value) codeEl.value = code;
  if (nameEl && !nameEl.value) nameEl.value = name;
}

function openJoinSession() {
  prefillJoinFields('stud-code', 'stud-name');
  showModal('modal-stud');
  setTimeout(() => {
    const codeEl = document.getElementById('stud-code');
    (codeEl?.value ? document.getElementById('stud-name') : codeEl)?.focus();
  }, 60);
}

// The prepro join modal serves two entry points: the Planda Bear card (land in
// the paperwork hub) and the front-page Production Notes button (land straight
// on the notes board). Copy and post-join destination follow the mode.
let preProJoinTarget = 'hub';

function openPreProJoinModal(target) {
  preProJoinTarget = target === 'notes' ? 'notes' : 'hub';
  const notes = preProJoinTarget === 'notes';
  const modal = document.getElementById('modal-prepro-join');
  if (modal) {
    const title = modal.querySelector('.modal-title');
    const sub = modal.querySelector('.modal-sub');
    const go = modal.querySelector('.btn-primary');
    if (title) title.innerHTML = notes ? `${sfIcon('content.note')} Production Notes` : 'Open Planda Bear';
    if (sub) sub.textContent = notes
      ? 'Enter the session code to open your crew’s notes board.'
      : 'Enter the session code to work on the Planda Bear package.';
    if (go) go.textContent = notes ? 'Open Production Notes' : 'Open Planda Bear';
  }
  prefillJoinFields('pp-join-code', 'pp-join-name');
  showModal('modal-prepro-join');
  setTimeout(() => {
    const codeEl = document.getElementById('pp-join-code');
    (codeEl?.value ? document.getElementById('pp-join-name') : codeEl)?.focus();
  }, 60);
}

function openPlandaBearJoin() {
  openPreProJoinModal('hub');
}

async function joinSession() {
  const code = document.getElementById('stud-code').value.trim().toUpperCase();
  const name = document.getElementById('stud-name').value.trim();
  const errEl = document.getElementById('stud-err');
  if (!code || !name) { errEl.textContent='Code and name required.'; errEl.classList.add('on'); return; }
  errEl.classList.remove('on');
  const btn = document.getElementById('stud-join-btn');
  if (btn) { btn.disabled=true; btn.textContent='Checking...'; }
  const ready = await waitForFirebaseReady();
  if (!ready) {
    if (btn) { btn.disabled=false; btn.textContent='Join Session'; }
    hideModal('modal-stud');
    openLocalSession(code, name, 'instructor');
    return;
  }
  const verify = () => {
    window._getDoc(window._doc(window._db,'sessions',code)).then(snap => {
      if (btn) { btn.disabled=false; btn.textContent='Join Session'; }
      if (!snap.exists()) {
        errEl.textContent = 'Session not found. Check the code and try again.';
        errEl.classList.add('on');
        return;
      }
      const d = snap.data() || {};
      session = { code, role:'student', userName:name, isDemo:false, isExpert:false };
      show = { name:d.showName || 'Untitled Show', start:normalizeTimeValue(d.startTime) };
      beats = Array.isArray(d.beats) ? d.beats.map(migrateBeat) : [];
      freeTextMode = Boolean(d.freeMode);
      rundownCloudBeats = cloneRundownValue(beats);
      rundownShadowBeats = cloneRundownValue(beats);
      rundownShadowShow = { name:show.name, start:show.start, freeMode:freeTextMode };
      rundownAliases = d.rundownAliases && typeof d.rundownAliases === 'object' ? d.rundownAliases : {};
      rememberLastSession(code, name);
      hideModal('modal-stud');
      enterRundown();
    }).catch(() => {
      if (btn) { btn.disabled=false; btn.textContent='Join Session'; }
      hideModal('modal-stud');
      openLocalSession(code, name, 'instructor');
    });
  };
  verify();
}

async function joinPreProSession() {
  const code = document.getElementById('pp-join-code').value.trim().toUpperCase();
  const name = document.getElementById('pp-join-name').value.trim();
  const errEl = document.getElementById('pp-join-err');
  if (!code || !name) { errEl.textContent='Code and name required.'; errEl.classList.add('on'); return; }
  errEl.classList.remove('on');
  const openLocal = snap => {
    const d = snap.data() || {};
    session = { code, role:'student', userName:name, isDemo:false, isExpert:false };
    freeTextMode = false;
    show = { name:d.showName || 'Untitled Show', start:normalizeTimeValue(d.startTime) };
    if (Array.isArray(d.beats)) beats = d.beats.map(migrateBeat);
    // Seed local Planda Bear cache with any shared work already saved to the session.
    if (d.prePro && typeof d.prePro === 'object') {
      try { localStorage.setItem(preProKey(), JSON.stringify(d.prePro)); } catch {}
    }
    rememberLastSession(code, name);
    hideModal('modal-prepro-join');
    // joinPresence first: it SETS the whole presence entry, so the landing
    // page's pbPage announce (issued after, same client queue) survives it.
    joinPresence();
    if (preProJoinTarget === 'notes') openProductionNotes();
    else openPaperworkHub();
  };
  const verify = () => {
    window._getDoc(window._doc(window._db,'sessions',code)).then(snap => {
      if (!snap.exists()) {
        errEl.textContent = 'Session not found. Check the code and try again.';
        errEl.classList.add('on');
        return;
      }
      openLocal(snap);
    }).catch(() => {
      openLocalPlandaBear(code, name);
    });
  };
  const ready = await waitForFirebaseReady();
  if (!ready) return openLocalPlandaBear(code, name);
  verify();
}

function loadExpert() {
  session = { code:'', role:'instructor', userName:'You', isDemo:false, isExpert:true };
  show = { name:'Untitled Show', start:'' };
  beats = [];
  freeTextMode = true;
  restoreLocalDraft();
  enterRundown();
}

function openBlankSlateSetup() {
  hideModal('modal-blank');
  const name = document.getElementById('blank-name');
  const code = document.getElementById('blank-code');
  const showIn = document.getElementById('blank-show');
  const err = document.getElementById('blank-err');
  if (name && !name.value) name.value = adminSession?.name || localStorage.getItem('cueola_last_name') || '';
  if (code) code.value = '';
  if (showIn) showIn.value = '';
  err?.classList.remove('on');
  showModal('modal-blank');
  setTimeout(()=>name?.focus(), 80);
}

async function startBlankSlate() {
  const name = document.getElementById('blank-name')?.value?.trim() || '';
  const code = (document.getElementById('blank-code')?.value?.trim() || genCode()).toUpperCase();
  const showName = document.getElementById('blank-show')?.value?.trim() || 'Untitled Show';
  const err = document.getElementById('blank-err');
  const btn = document.getElementById('blank-create-btn');
  if (!name) { if (err) { err.textContent='Please enter your name.'; err.classList.add('on'); } return; }
  if (btn) { btn.disabled = true; btn.textContent = 'Creating...'; }
  const ready = await waitForFirebaseReady();
  if (!ready) {
    if (btn) { btn.disabled = false; btn.textContent = 'Create Shared Blank Slate'; }
    hideModal('modal-blank');
    localStorage.setItem('cueola_last_name', name);
    openLocalSession(code, name, 'instructor', showName);
    return;
  }
  try {
    const ref = window._doc(window._db,'sessions',code);
    const snap = await window._getDoc(ref);
    if (snap.exists()) {
      if (err) { err.textContent='That workspace code already exists. Pick another code or join it from the front page.'; err.classList.add('on'); }
      return;
    }
    await window._setDoc(ref, {
      code,
      createdBy:name,
      showName,
      startTime:'',
      beats:[],
      cues:[],
      freeMode:true,
      activeIdx:0,
      status:'idle',
      createdAt:window._serverTimestamp(),
      participants:[],
    });
    localStorage.setItem('cueola_last_name', name);
    session = { code, role:'instructor', userName:name, isDemo:false, isExpert:false };
    show = { name:showName, start:'' };
    beats = [];
    freeTextMode = true;
    hideModal('modal-blank');
    enterRundown();
    toast(`Blank Slate ${code} created.`);
  } catch (e) {
    if (err) { err.textContent = 'Could not create the workspace. Try another code.'; err.classList.add('on'); }
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Create Shared Blank Slate'; }
  }
}

function loadDemo() {
  session = { code:'DEMO1', role:'student', userName:'Demo', isDemo:true, isExpert:false };
  show = { name:'Campus News — Demo Show', start:'19:00' };
  beats = DEMO_BEATS.map((b,i)=>({...b, id:i+1})).map(migrateBeat);
  freeTextMode = false;
  enterRundown();
}

function goHome() {
  if (!confirmSaveUnsavedPaperwork()) return;
  if (!confirm('Go back to the home screen? You can rejoin or reload your session.')) return;
  leaveSessionForFrontPage();
}

function enterRundown() {
  applyTheme(currentTheme);
  document.getElementById('entry').classList.remove('on');
  document.getElementById('rundown').classList.add('on');
  document.getElementById('liveshow').classList.remove('on');
  pushSessionHistoryState('build');
  // P8 (dress-rehearsal find): without this, a stale 'live' from a previous
  // session leaks into the resume record and the banner claims the wrong screen.
  // Capture first — a same-tab reload mid-show must still restore the live screen
  // below (leaving a session clears the key, so a previous session can't leak in).
  const resumeScreen = sessionStorage.getItem('cueola_screen');
  sessionStorage.setItem('cueola_screen', 'build');
  loadShowLog();   // P7: pick up this session's persisted log before anything writes to it
  logShow('session', 'Entered session' + (session?.code ? ' ' + session.code : '') + (session?.isDemo ? ' (demo)' : '') + (session?.userName ? ' as ' + session.userName : ''));
  markResumeState();

  updateAdminUI();

  if (session.isDemo) {
    document.getElementById('demoBanner').style.display='block';
  } else {
    document.getElementById('demoBanner').style.display='none';
    if (session.code) setupFirestore();
  }

  // Load custom sources
  try {
    const stored = localStorage.getItem('cueola_customSources_'+session.code);
    if (stored) sessionCustomSources = JSON.parse(stored)||{};
  } catch {}

  const badge = document.getElementById('topSessionBadge');
  if (session.code && !session.isExpert) {
    badge.style.display='flex';
    document.getElementById('topCode').textContent = session.code;
    document.getElementById('roleTag').textContent = session.role==='instructor'?'INST':'STU';
    document.getElementById('roleTag').className = `role-badge ${session.role==='instructor'?'role-inst':'role-stud'}`;
    setCloudSyncState(session.isDemo ? 'local' : (window._firebaseReady ? 'synced' : 'saving'),
      session.isDemo ? 'Demo mode: same-browser sync only.' : (window._firebaseReady ? `Cloud sync ready · ${session.code}` : 'Connecting to cloud sync...'));
  } else {
    badge.style.display='none';
    setCloudSyncState('off', 'No shared session code.');
  }

  renderRundown();
  joinPresence();
  // Restore last screen
  if (resumeScreen === 'live') setTimeout(goLive, 300);
}

// ─────────────────────────────────────────────────────────────
// FIREBASE
// ─────────────────────────────────────────────────────────────
function cloneRundownValue(value) {
  if (value === undefined || value === null) return value;
  if (globalThis.structuredClone) return globalThis.structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

function rundownValueEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function nextBeatId() {
  if (globalThis.crypto?.getRandomValues) {
    const parts = new Uint32Array(2);
    do {
      globalThis.crypto.getRandomValues(parts);
      beatIdSequence = (parts[0] & 0x1fffff) * 0x100000000 + parts[1];
    } while (!beatIdSequence || beats.some(beat => beat.id === beatIdSequence));
    return beatIdSequence;
  }
  beatIdSequence = (beatIdSequence + 1) % 1000;
  return Date.now() * 1000 + beatIdSequence;
}

function resolveRundownBeatId(id, aliases=rundownAliases) {
  let current = String(id);
  const seen = new Set();
  while (aliases?.[current] !== undefined && !seen.has(current)) {
    seen.add(current);
    current = String(aliases[current]);
  }
  return current;
}

function rundownBeatKey(beat) {
  return [beat?.info, beat?.notes, beat?.style, beat?.min, beat?.sec]
    .map(v => String(v ?? '').trim().replace(/\s+/g, ' ').toLowerCase())
    .join('|');
}

function buildBeatPatch(before, after) {
  const patch = {};
  ['style','info','notes','min','sec','done','_createdAt','_createdBy'].forEach(key => {
    if (!rundownValueEqual(before?.[key], after?.[key])) patch[key] = cloneRundownValue(after?.[key]);
  });
  const cuePatch = {};
  const cueTypes = new Set([...Object.keys(before?.cues || {}), ...Object.keys(after?.cues || {})]);
  cueTypes.forEach(type => {
    if (!rundownValueEqual(before?.cues?.[type], after?.cues?.[type])) {
      cuePatch[type] = after?.cues?.[type] === undefined ? null : cloneRundownValue(after.cues[type]);
    }
  });
  if (Object.keys(cuePatch).length) patch.cues = cuePatch;
  return patch;
}

function buildRundownBatch(beforeBeats, afterBeats, beforeShow, afterShow) {
  const beforeMap = new Map((beforeBeats || []).map(beat => [String(beat.id), beat]));
  const afterMap = new Map((afterBeats || []).map(beat => [String(beat.id), beat]));
  const additions = [];
  const patches = [];
  const removals = [];

  afterMap.forEach((beat, id) => {
    const before = beforeMap.get(id);
    if (!before) additions.push(cloneRundownValue(beat));
    else {
      const patch = buildBeatPatch(before, beat);
      if (Object.keys(patch).length) patches.push({ id:beat.id, patch });
    }
  });
  beforeMap.forEach((beat, id) => {
    if (!afterMap.has(id)) removals.push(beat.id);
  });

  const beforeOrder = (beforeBeats || []).map(beat => String(beat.id));
  const afterOrder = (afterBeats || []).map(beat => String(beat.id));
  const showPatch = {};
  if (beforeShow?.name !== afterShow?.name) showPatch.showName = afterShow.name;
  if (normalizeTimeValue(beforeShow?.start) !== normalizeTimeValue(afterShow?.start)) showPatch.startTime = normalizeTimeValue(afterShow.start);
  if (Boolean(beforeShow?.freeMode) !== Boolean(afterShow?.freeMode)) showPatch.freeMode = Boolean(afterShow.freeMode);

  return {
    id: `${presenceId}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,7)}`,
    sessionCode: session.code,
    additions,
    patches,
    removals,
    order: rundownValueEqual(beforeOrder, afterOrder) ? null : afterBeats.map(beat => beat.id),
    showPatch,
    by: session.userName || 'Someone',
    at: Date.now(),
  };
}

function rundownBatchHasChanges(batch) {
  return Boolean(batch.additions.length || batch.patches.length || batch.removals.length || batch.order || Object.keys(batch.showPatch).length);
}

function applyBeatPatch(beat, patch) {
  const next = { ...beat };
  Object.entries(patch || {}).forEach(([key, value]) => {
    if (key !== 'cues') next[key] = cloneRundownValue(value);
  });
  if (patch?.cues) {
    next.cues = { ...(beat?.cues || {}) };
    Object.entries(patch.cues).forEach(([type, value]) => {
      if (value === null) delete next.cues[type];
      else next.cues[type] = cloneRundownValue(value);
    });
  }
  return migrateBeat(next);
}

function applyRundownBatch(remoteBeats, batch, knownAliases=rundownAliases, aliasSink=null) {
  const ordered = (remoteBeats || []).map(migrateBeat);
  const byId = new Map(ordered.map(beat => [String(beat.id), beat]));
  const aliases = { ...(knownAliases || {}) };
  const resolveId = id => resolveRundownBeatId(id, aliases);

  (batch.removals || []).forEach(id => byId.delete(resolveId(id)));
  (batch.additions || []).forEach(rawBeat => {
    const beat = migrateBeat(rawBeat);
    const id = String(beat.id);
    const knownId = resolveId(id);
    if (knownId !== id && byId.has(knownId)) return;
    if (byId.has(id)) {
      byId.set(id, beat);
      return;
    }
    const createdAt = Number(beat._createdAt) || 0;
    const duplicate = createdAt ? [...byId.values()].find(existing =>
      rundownBeatKey(existing) === rundownBeatKey(beat) &&
      existing._createdBy && existing._createdBy !== beat._createdBy &&
      Math.abs((Number(existing._createdAt) || 0) - createdAt) < 15000
    ) : null;
    if (duplicate) aliases[id] = resolveId(duplicate.id);
    else byId.set(id, beat);
  });
  (batch.patches || []).forEach(({ id, patch }) => {
    const key = resolveId(id);
    const current = byId.get(key);
    if (current) byId.set(key, applyBeatPatch(current, patch));
  });

  if (aliasSink) Object.assign(aliasSink, aliases);

  if (batch.order) {
    const seen = new Set();
    const result = [];
    batch.order.forEach(rawId => {
      const id = resolveId(rawId);
      if (seen.has(id) || !byId.has(id)) return;
      seen.add(id);
      result.push(byId.get(id));
    });
    ordered.forEach(beat => {
      const id = String(beat.id);
      if (!seen.has(id) && byId.has(id)) {
        seen.add(id);
        result.push(byId.get(id));
      }
    });
    byId.forEach((beat, id) => {
      if (!seen.has(id)) result.push(beat);
    });
    return result;
  }
  return ordered.filter(beat => byId.has(String(beat.id))).map(beat => byId.get(String(beat.id)))
    .concat([...byId.values()].filter(beat => !ordered.some(existing => String(existing.id) === String(beat.id))));
}

function projectPendingRundownBatches(remoteBeats) {
  return rundownPendingBatches.reduce((current, batch) => applyRundownBatch(current, batch, rundownAliases), remoteBeats || []);
}

async function flushRundownSyncQueue() {
  if (rundownSyncRunning || !rundownPendingBatches.length || !window._runTransaction) return;
  rundownSyncRunning = true;
  clearTimeout(rundownSyncRetryTimer);
  rundownSyncRetryTimer = null;
  const batch = rundownPendingBatches[0];
  const targetSessionCode = batch.sessionCode || session.code;
  const ref = window._doc(window._db, 'sessions', targetSessionCode);
  try {
    let committedBeats = null;
    let committedAliases = null;
    await window._runTransaction(window._db, async transaction => {
      const snap = await transaction.get(ref);
      const data = snap.exists() ? (snap.data() || {}) : {};
      const mergedAliases = { ...(data.rundownAliases || {}) };
      committedBeats = applyRundownBatch(Array.isArray(data.beats) ? data.beats : [], batch, mergedAliases, mergedAliases);
      committedAliases = mergedAliases;
      const update = {
        beats: committedBeats,
        rundownAliases: mergedAliases,
        ...batch.showPatch,
        rundownUpdatedAt: Date.now(),
        rundownUpdatedBy: batch.by,
      };
      if (snap.exists()) transaction.update(ref, update);
      else transaction.set(ref, { code:targetSessionCode, ...update }, { merge:true });
    });
    const batchIndex = rundownPendingBatches.findIndex(item => item.id === batch.id);
    if (batchIndex >= 0) rundownPendingBatches.splice(batchIndex, 1);
    if (session.code === targetSessionCode) {
      rundownCloudBeats = committedBeats || rundownCloudBeats;
      rundownAliases = committedAliases || rundownAliases;
    }
    if (session.code === targetSessionCode && !rundownPendingBatches.length) {
      rundownShadowBeats = cloneRundownValue(beats);
      rundownShadowShow = { name:show.name, start:normalizeTimeValue(show.start), freeMode:freeTextMode };
      setCloudSyncState('synced', `Cloud sync saved · ${targetSessionCode}`);
    }
  } catch (err) {
    reportCloudWriteFailure('Rundown cloud save', err);
    clearTimeout(rundownSyncRetryTimer);
    rundownSyncRetryTimer = setTimeout(() => {
      rundownSyncRetryTimer = null;
      flushRundownSyncQueue();
    }, 1500);
  } finally {
    rundownSyncRunning = false;
    if (rundownPendingBatches.length && !rundownSyncRetryTimer) queueMicrotask(flushRundownSyncQueue);
  }
}

function setupFirestore() {
  const init = () => {
    if (firestoreUnsub) firestoreUnsub();
    const ref = window._doc(window._db,'sessions',session.code);

    if (session.role==='instructor') {
      // Seed the session doc only when it doesn't exist yet — an instructor
      // REJOINING must never overwrite the live showName/startTime/freeMode
      // with this device's boot defaults (the snapshot below adopts cloud state).
      window._getDoc(ref).then(snap => {
        if (snap.exists()) return;
        return window._setDoc(ref,{
          code:session.code, createdBy:session.userName,
          showName:show.name, startTime:normalizeTimeValue(show.start),
          freeMode:freeTextMode,
          createdAt:window._serverTimestamp()
        },{merge:true});
      }).catch(err => reportCloudWriteFailure('Session cloud setup', err));
    }

    firestoreUnsub = window._onSnapshot(ref, snap => {
      if (!snap.exists()) return;
      setCloudSyncState(rundownPendingBatches.length ? 'saving' : 'synced', rundownPendingBatches.length ? 'Cloud sync saving changes...' : `Cloud sync connected · ${session.code}`);
      const d = snap.data();
      // Session rescue — handle a kick or a code move before adopting any other state.
      if (d.kicked && d.kicked[presenceId]) {
        if (firestoreUnsub) { try { firestoreUnsub(); } catch {} firestoreUnsub = null; }
        leavePresence();
        leaveSessionForFrontPage();
        toast('An instructor removed you from this session.');
        return;
      }
      if (typeof d.movedTo?.code === 'string' && d.movedTo.code && d.movedTo.code !== session.code) {
        followSessionMove(d.movedTo.code);
        return;
      }
      rundownAliases = d.rundownAliases && typeof d.rundownAliases === 'object' ? d.rundownAliases : {};
      if (d.beats && Array.isArray(d.beats)) {
        rundownCloudBeats = d.beats.map(migrateBeat);
        beats = projectPendingRundownBatches(rundownCloudBeats);
        if (!rundownPendingBatches.length) rundownShadowBeats = cloneRundownValue(beats);
      }
      const projectedShow = rundownPendingBatches.reduce((current, batch) => ({
        name: batch.showPatch.showName ?? current.name,
        start: batch.showPatch.startTime ?? current.start,
        freeMode: batch.showPatch.freeMode ?? current.freeMode,
      }), {
        name:d.showName || show.name,
        start:d.startTime !== undefined ? normalizeTimeValue(d.startTime) : show.start,
        freeMode:Boolean(d.freeMode),
      });
      show.name = projectedShow.name;
      show.start = normalizeTimeValue(projectedShow.start);
      freeTextMode = Boolean(projectedShow.freeMode);
      if (!rundownPendingBatches.length) {
        rundownShadowShow = { name:show.name, start:normalizeTimeValue(show.start), freeMode:freeTextMode };
      }
      if (d.customSources) sessionCustomSources = d.customSources;
      if (d.prePro && typeof d.prePro === 'object') {
        try {
          const local = loadPreProData();
          if (!local.updatedAt || (d.prePro.updatedAt || 0) > (local.updatedAt || 0)) {
            localStorage.setItem(preProKey(), JSON.stringify(d.prePro));
          }
        } catch {}
      }
      if (d.preProNotes !== undefined) onRemoteProductionNotes(d.preProNotes);
      // Following: mirror the position of whoever I follow (their broadcast
      // presence.idx). Browsing self keeps my own position. A student who hasn't
      // chosen mirrors the show caller (first instructor).
      {
        const followedIdx = resolveFollowedIdx(d.presence, { followTarget, followTargetId, browsingSelf, role: session.role, myName: session.userName });
        const targetIdx = followedIdx != null ? followedIdx : (session.role === 'student' && Number.isFinite(d.activeIdx) && !browsingSelf && !followTarget ? d.activeIdx : null);
        if (targetIdx != null && targetIdx !== lsIdx) {
          lsIdx = targetIdx;
          if (document.getElementById('liveshow').classList.contains('on')) renderLive();
        }
      }
      if (d.prompter && typeof d.prompter.text === 'string') {
        const adopted = adoptPrompterSnapshot(d.prompter);
        // Forward live to any connected Flowmingo on this device, scroll-preserving.
        // Skip while this tab is holding an unsent draft so an older snapshot cannot
        // interrupt the operator's edit.
        if (adopted) {
          _postPrompterMessage(getPrompterPayload(false));
          ptUpdateFromCueola(prompterText);
        }
      }
      if (d.prompter?.control?.action && !isPrompterSelfSender(d.prompter.control.sender)) {
        const control = d.prompter.control;
        if (applyRemoteControlOnce(control.action, control.ts, control.sender, control.controlId) && control.source === 'flowmingo-op') {
          flowmingoRemoteOverrideUntil = Date.now() + FLOWMINGO_REMOTE_OVERRIDE_MS;
        }
      }
      if (d.prompter?.controlAck) _handlePrompterControlAck(d.prompter.controlAck);
      if (d.showClock) applyRemoteShowClock(d.showClock);  // shared start/pause clock
      // Cross-device talent heartbeat — proves a talent screen is alive even when
      // it's on a different machine (BroadcastChannel can't cross devices).
      // Only count a heartbeat we haven't seen before AND that is recent — any
      // other doc write (presence, clock) re-fires this snapshot, and a stale
      // heartbeat must not keep a dead talent screen looking "Connected".
      const _hb = d.prompter?.talentHeartbeat;
      if (_hb?.ts && !isPrompterSelfSender(_hb.sender)
          && _hb.ts !== _lastSeenTalentHeartbeatTs && (Date.now() - _hb.ts) < 20000) {
        _lastSeenTalentHeartbeatTs = _hb.ts;
        _notePrompterTalentSeen(_hb);
      }
      // QLab agent presence + cue-fire acks (Cueola → QLab integration).
      if (d.qlab?.agentHeartbeat?.ts) noteQlabAgentBeat(d.qlab.agentHeartbeat);
      if (d.qlab?.lastAck) handleQlabAck(d.qlab.lastAck);
      // Outrangutan playback module — cue list + live status published back to us.
      if (d.outrangutan) applyOutrangutanState(d.outrangutan);
      // Handle force commands
      if (d.forceCmd && d.forceCmd.ts) {
        const cmd = d.forceCmd;
        const age = Date.now() - (cmd.ts||0);
        if (age < 30000 && cmd.ts > _lastHandledForceCmdTs) { // only act on new commands < 30 seconds old
          _lastHandledForceCmdTs = cmd.ts;
          if (cmd.type === 'followMe' && cmd.name !== session.userName) {
            forceFollowPerson(cmd.name, d.presence);
            toast(`Now following: ${cmd.name}`);
          }
          if (cmd.type === 'forceLive') {
            const liveOn = document.getElementById('liveshow').classList.contains('on');
            if (!liveOn) goLive();
            setTimeout(() => {
              if (cmd.name === session.userName) { followSelf(); }
              else { forceFollowPerson(cmd.name, d.presence); toast(`Forced live, following ${cmd.name}`); }
            }, 500);
          }
        }
      }
      sessionParticipantNames = collectSessionParticipantNames(d);
      renderPresence(d.presence||{});
      pbApplyRemoteCollab();   // Planda Bear live presence + field sync
      // P3: rebuild the rundown table only when its inputs actually changed.
      // Before this gate, EVERY snapshot (playout status ~1.4×/s, presence
      // heartbeats, clock writes) rebuilt the whole table — the measured driver
      // of the AVT "Questions" blanking/flash and main-thread flooding.
      renderRundownIfChanged(d);
      noteSnapshotArrived(snap);
    }, err => reportCloudWriteFailure('Cloud listener', err));
  };

  if (window._firebaseReady) init();
  else window.addEventListener('firebaseReady', init, {once:true});
}

// ── P3: snapshot render gating + connection-state surfacing ────────────────
let _rundownSnapFp = '';      // fingerprint of the last rendered snapshot inputs
let _rundownSnapDirty = false;
// Key-sorted stringify: Firestore serializes map keys in a different order on
// local-echo vs server snapshots, so plain JSON.stringify flaps between
// data-identical snapshots and would defeat the gate.
function stableStringify(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(stableStringify).join(',') + ']';
  return '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + stableStringify(v[k])).join(',') + '}';
}
function renderRundownIfChanged(d) {
  let fp;
  try {
    fp = stableStringify(d.beats || []) + '|' + (d.showName || '') + '|' + (d.startTime || '')
      + '|' + (d.freeMode ? 1 : 0) + '|' + stableStringify(d.rundownAliases || {})
      + '|' + stableStringify(d.outrangutan?.cues || {});
  } catch (e) { fp = 'x' + Date.now(); }
  if (fp === _rundownSnapFp) return;
  _rundownSnapFp = fp;
  if (document.getElementById('rundown')?.classList.contains('on')) { renderRundown(); _rundownSnapDirty = false; }
  else _rundownSnapDirty = true;   // render once when the screen next becomes visible
  // A live operator must see collaborators' edits too — refresh the NOW/NEXT
  // cards when the live screen is up (gated by the same fingerprint above).
  if (document.getElementById('liveshow')?.classList.contains('on')) renderLive();
}
// Flush the deferred render the moment the rundown screen is shown again.
(() => {
  const el = document.getElementById('rundown');
  if (!el || typeof MutationObserver === 'undefined') return;
  new MutationObserver(() => {
    if (_rundownSnapDirty && el.classList.contains('on')) { _rundownSnapDirty = false; renderRundown(); }
  }).observe(el, { attributes: true, attributeFilter: ['class'] });
})();

// Explicit "reconnecting" state: a follower must never sit on a stale screen
// without knowing it. Cached snapshots and offline events show the chip; the
// next server snapshot clears it (Firestore resyncs full state on reconnect).
let _lastSnapshotTs = 0;
function noteSnapshotArrived(snap) {
  _lastSnapshotTs = Date.now();
  setSyncReconnecting(!!(snap && snap.metadata && snap.metadata.fromCache && !(snap.metadata.hasPendingWrites)));
}
let _syncReconnState = false;
function setSyncReconnecting(on) {
  const chip = document.getElementById('ls-stat-sync');
  if (chip) chip.hidden = !on;
  if (on) setCloudSyncState('saving', 'Cloud sync reconnecting — showing last known state…');
  if (on !== _syncReconnState) {   // P7: log only the transitions, not every snapshot
    _syncReconnState = on;
    logShow('sync', on ? 'Cloud sync reconnecting — showing last known state' : 'Cloud sync restored');
  }
}
window.addEventListener('offline', () => { if (session.code && !session.isDemo && !session.isExpert) setSyncReconnecting(true); });
window.addEventListener('online', () => { /* chip clears on the next server snapshot */ });

function syncToFirestore() {
  saveLocalDraft();
  if (!window._firebaseReady||!session.code||session.isDemo||session.isExpert) {
    if (!session.isDemo) setCloudSyncState(session.isExpert ? 'local' : 'local', session.isExpert ? 'Local-only workspace. Saved in this browser.' : 'Saved locally. Cloud sync unavailable.');
    return;
  }
  const currentShow = { name:show.name, start:normalizeTimeValue(show.start), freeMode:freeTextMode };
  const batch = buildRundownBatch(rundownShadowBeats, beats, rundownShadowShow, currentShow);
  if (!rundownBatchHasChanges(batch)) return;
  rundownPendingBatches.push(batch);
  rundownShadowBeats = cloneRundownValue(beats);
  rundownShadowShow = currentShow;
  setCloudSyncState('saving', 'Cloud sync saving changes...');
  flushRundownSyncQueue();
}

function syncLiveIdx() {
  markResumeState();   // P7: live position rides the resume record (Decisions #14)
  if (!window._firebaseReady||!session.code||session.isDemo||session.isExpert) return;
  // Broadcast my own position into my presence record so anyone following me
  // mirrors it. (Your navigation only moves your followers, not the whole room.)
  // Keep the legacy global activeIdx for back-compat with older clients/dashboard.
  window._updateDoc(window._doc(window._db,'sessions',session.code), {
    activeIdx: lsIdx,
    [`presence.${presenceId}.idx`]: lsIdx,
    [`presence.${presenceId}.lastSeen`]: Date.now(),
  }).catch(()=>{});
}

// ─────────────────────────────────────────────────────────────
// PRESENCE
// ─────────────────────────────────────────────────────────────
async function joinPresence() {
  if (!session.code||session.isDemo||session.isExpert||!window._firebaseReady) return;
  const name = session.role==='instructor' ? session.userName : (session.userName||'?');
  try {
    await window._updateDoc(window._doc(window._db,'sessions',session.code),{
      [`presence.${presenceId}`]:{name,role:session.role,lastSeen:Date.now(),following:session.userName,followingId:'',idx:Math.max(lsIdx,0)}
    });
    clearInterval(presenceInterval);
    presenceInterval = setInterval(async()=>{
      try { await window._updateDoc(window._doc(window._db,'sessions',session.code),{[`presence.${presenceId}.lastSeen`]:Date.now()}); } catch {}
    },30000);
  } catch {}

  // Persist this participant to the dashboard-visible participants list.
  // Uses arrayUnion so each unique name+role pair is recorded once.
  try {
    const snap = await window._getDoc(window._doc(window._db,'sessions',session.code));
    if (snap.exists()) {
      const existing = snap.data().participants || [];
      const alreadyIn = existing.some(p => p.name === name);
      if (!alreadyIn) {
        // arrayUnion, not a whole-array overwrite — two devices joining at the
        // same moment must both survive (the loser used to vanish from the list).
        await window._updateDoc(window._doc(window._db,'sessions',session.code), {
          participants: window._arrayUnion({ name, role:session.role, joinedAt: Date.now() })
        });
      }
    }
  } catch {}
}

async function leavePresence() {
  if (!session.code||!window._firebaseReady) return;
  clearInterval(presenceInterval);
  try { await window._updateDoc(window._doc(window._db,'sessions',session.code),{[`presence.${presenceId}`]:window._deleteField()}); } catch {}
}

function getActivePresencePeople() {
  const now = Date.now();
  const seen = new Set();
  return Object.values(currentPresence||{})
    .filter(p => p?.name && (now - (p.lastSeen||0)) < 90000)
    .sort((a,b)=>a.role==='instructor'?-1:b.role==='instructor'?1:0)
    .filter(p => {
      const key = p.name.trim().toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function refreshAdminBodyForSessionPeople() {
  const panel = document.getElementById('adminPanel');
  if (!panel?.classList.contains('on')) return;
  if (document.activeElement?.closest?.('#adminBody')) return;
  renderAdminBody();
}

function renderPresence(map) {
  currentPresence = map || {};
  const active = getActivePresencePeople();
  const wrap = document.getElementById('presenceWrap');
  if (!active.length||!session.code||session.isDemo||session.isExpert){
    wrap.style.display='none';
    refreshAdminBodyForSessionPeople();
    return;
  }
  wrap.style.display='flex';
  const shown = active.slice(0,4), extra = active.length-4;
  const initials = n => {
    const parts = String(n||'?').trim().split(/\s+/).filter(Boolean);
    if (parts.length>=2) return (parts[0][0]+parts[parts.length-1][0]).toUpperCase();
    return String(n||'?').slice(0,2).toUpperCase();
  };
  const canInspect = Boolean(adminSession);   // admins can click a badge for that person's session work
  document.getElementById('presenceAvatars').innerHTML =
    shown.map(p=>{
      const tip = `${esc(p.name)} · ${p.role==='instructor'?'Instructor':'Student'}${canInspect?' · click for info':''}`;
      const click = canInspect ? ` onclick="openPersonInfo(${JSON.stringify(p.name).replace(/"/g,'&quot;')})"` : '';
      return `<div class="p-avatar ${p.role==='instructor'?'inst':'stud'}${canInspect?' pi-click':''}" data-fullname="${tip}"${click}>${initials(p.name)}</div>`;
    }).join('')+
    (extra>0?`<div class="p-avatar extra" data-fullname="${extra} more in session">+${extra}</div>`:'');
  document.getElementById('presenceTooltip').innerHTML =
    `<div style="font-size:10px;font-family:var(--mono);color:var(--text3);letter-spacing:.08em;margin-bottom:2px">IN SESSION</div>`+
    active.map(p=>{
      const col=p.role==='instructor'?'var(--accent)':'var(--green)';
      return `<div class="p-tip-row" title="${esc(p.name)}"><div class="p-tip-dot" style="background:${col};color:${col}"></div><span class="p-tip-name">${esc(p.name)}</span><span class="p-tip-label">${p.role==='instructor'?'INST':'STU'}</span></div>`;
    }).join('');
  refreshAdminBodyForSessionPeople();
}

// ── Person info: admin clicks a presence badge → that person's session work ──
async function openPersonInfo(name) {
  if (!adminSession) { toast('Log in as admin to view session info.'); return; }
  const body = document.getElementById('personInfoBody');
  const actions = document.getElementById('personInfoActions');
  if (!body || !actions) return;

  const entries = Object.values(currentPresence || {}).filter(p => p?.name && sameParticipantName(p.name, name));
  const now = Date.now();
  const newest = entries.slice().sort((a,b)=>(b.lastSeen||0)-(a.lastSeen||0))[0];
  const online = Boolean(newest && (now - (newest.lastSeen||0)) < 90000);
  const isInst = newest?.role === 'instructor';

  let where = '';
  if (online) {
    if (newest.pbPage) where = `In Planda Bear · ${PB_PAGE_LABELS[newest.pbPage] || newest.pbPage}`;
    else if (Number.isFinite(newest.idx)) where = `On rundown row ${(newest.idx|0) + 1}`;
  }
  const following = newest?.following && !sameParticipantName(newest.following, name) ? newest.following : '';

  const assignment = (Array.isArray(loadPreProData().roleAssignments) ? loadPreProData().roleAssignments : [])
    .map(r => normalizeRoleAssignment(r))
    .find(r => sameParticipantName(r.person, name));

  const head = `
    <div class="pi-head">
      <div class="pi-ava ${isInst ? 'inst' : 'stud'}">${esc(pbInitials(name))}</div>
      <div>
        <div class="pi-name">${esc(name)}</div>
        <div class="pi-sub">
          <span class="pi-role ${isInst ? 'inst' : 'stud'}">${isInst ? 'INSTRUCTOR' : 'STUDENT'}</span>
          <span class="pi-live ${online ? 'on' : ''}"><span class="dot"></span>${online ? 'Online now' : (newest?.lastSeen ? `Last seen ${pbAgo(newest.lastSeen)}` : 'Not connected')}</span>
        </div>
      </div>
    </div>
    ${where || following ? `<div class="pi-sec">Right now</div><div class="pi-card">${esc(where || '')}${where && following ? '<br>' : ''}${following ? `Following <b>${esc(following)}</b>` : ''}</div>` : ''}
    <div class="pi-sec">Assignment</div>
    <div class="pi-card">${assignment && (assignment.position || assignment.paperwork.length)
      ? `${assignment.position ? `Position: <b>${esc(assignment.position)}</b>` : 'No position picked yet'}
         ${assignment.paperwork.length ? `<div class="pi-chips">${assignment.paperwork.map(p => `<span class="admin-src-chip">${esc(p)}</span>`).join('')}</div>` : ''}`
      : 'No assignment yet — set one in Admin → Role and Planda Bear Assignments.'}</div>`;

  body.innerHTML = head + `<div class="pi-sec">Session work</div><div class="pi-card">Loading…</div>`;
  actions.innerHTML = `
    <button class="btn-secondary" style="color:var(--red)" onclick="hideModal('personInfoModal');removePersonFromSession(${JSON.stringify(name).replace(/"/g,'&quot;')})">Remove from Session</button>
    <button class="btn-primary" onclick="hideModal('personInfoModal')">Done</button>`;
  showModal('personInfoModal');

  // Notes board contributions
  let stats = { posts:0, replies:0, todosDone:0, todosOpen:0, lastAt:0 };
  try {
    await loadPlandaBearNotes();
    const mine = plandaBearNotes.filter(n => n?.by && sameParticipantName(n.by, name));
    stats = {
      posts: mine.filter(n => !n.replyTo).length,
      replies: mine.filter(n => n.replyTo).length,
      todosDone: plandaBearNotes.filter(n => n.tag === 'todo' && n.done && n.doneBy && sameParticipantName(n.doneBy, name)).length,
      todosOpen: plandaBearNotes.filter(n => n.tag === 'todo' && !n.done && n.assignee && sameParticipantName(n.assignee, name)).length,
      lastAt: mine.reduce((m, n) => Math.max(m, n.editedAt || n.at || 0), 0),
    };
  } catch {}

  // Paperwork saves logged on the session doc
  let saves = [];
  if (session.code && !session.isDemo && !session.isExpert && window._firebaseReady) {
    try {
      const snap = await window._getDoc(window._doc(window._db, 'sessions', session.code));
      const log = snap.exists() && Array.isArray(snap.data().preProActivity) ? snap.data().preProActivity : [];
      saves = log.filter(e => e?.by && sameParticipantName(e.by, name));
    } catch {}
  }
  // Note posts log activity entries too — keep the paperwork stat about paperwork.
  const paperworkSaves = saves.filter(e => !/^(Production Note|To-Do|Instructor Comment)/i.test(e.section || ''));
  const bySection = {};
  paperworkSaves.forEach(e => { if (e.section) bySection[e.section] = (bySection[e.section] || 0) + 1; });
  const sectionLine = Object.entries(bySection).sort((a,b)=>b[1]-a[1])
    .map(([s, c]) => `${esc(s)}${c > 1 ? ` ×${c}` : ''}`).join(' · ');
  const lastSave = saves.reduce((m, e) => Math.max(m, e.at || 0), 0);
  const lastTouch = Math.max(stats.lastAt, lastSave);

  body.innerHTML = head + `
    <div class="pi-sec">Session work</div>
    <div class="pi-stats">
      <div class="pi-stat"><b>${stats.posts}</b><span>Notes</span></div>
      <div class="pi-stat"><b>${stats.replies}</b><span>Replies</span></div>
      <div class="pi-stat"><b>${stats.todosDone}</b><span>To-Dos done</span></div>
      <div class="pi-stat"><b>${paperworkSaves.length}</b><span>PB saves</span></div>
    </div>
    ${stats.todosOpen ? `<div class="pi-card" style="margin-top:7px">Open to-dos assigned to them: <b>${stats.todosOpen}</b></div>` : ''}
    ${sectionLine ? `<div class="pi-sec">Paperwork touched</div><div class="pi-card">${sectionLine}</div>` : ''}
    ${lastTouch ? `<div class="pi-sec">Last contribution</div><div class="pi-card">${esc(pbAgo(lastTouch))}</div>` : (paperworkSaves.length || stats.posts ? '' : `<div class="pi-card" style="margin-top:7px">No paperwork saves or notes from ${esc(name)} in this session yet.</div>`)}`;
}

window.addEventListener('beforeunload', leavePresence);

function isTextEditingTarget(target) {
  return target?.tagName === 'INPUT' ||
    target?.tagName === 'TEXTAREA' ||
    target?.isContentEditable ||
    Boolean(target?.closest?.('[contenteditable="true"]'));
}

function isLiveScriptPanelTarget(target) {
  return Boolean(target?.closest?.('#lsSidebar'));
}

function consumeRemoteKey(e) {
  e.preventDefault();
  e.stopPropagation();
}

// ── P5: central keymap registry ─────────────────────────────────────────────
// One source of truth: key dispatch AND the "?" reference overlay are generated
// from this table, so documentation can never drift from behavior. Operator-
// approved layout (Decisions Log #8): arrows always drive the rundown — even
// with the Script Op panel open — Space/J/K/L drive the prompter, G/P/S drive
// playout, Shift+Esc is PANIC. Bindings can be overridden per action via
// localStorage.cueola_keymap = {"playout.go":["G","F13"], …}.
const KEYMAP = [
  { id: 'rundown.next',        scope: 'live', group: 'Rundown',  keys: ['ArrowRight', 'ArrowDown'], label: 'Next row',                    run: () => lsNext() },
  { id: 'rundown.back',        scope: 'live', group: 'Rundown',  keys: ['ArrowLeft', 'ArrowUp'],    label: 'Previous row',                run: () => lsPrev() },
  { id: 'prompter.playpause',  scope: 'live', group: 'Prompter', keys: ['Space'],  label: 'Play / pause',                  run: () => sendPrompterControl(ptPlaying ? 'pause' : 'resume') },
  { id: 'prompter.toggle',     scope: 'live', group: 'Prompter', keys: ['K'],      label: 'Play / pause (JKL)',            run: () => sendPrompterControl(ptPlaying ? 'pause' : 'resume') },
  { id: 'prompter.brake',      scope: 'live', group: 'Prompter', keys: ['J'],      label: 'Brake (hold)',                  hold: ['brake_start', 'brake_stop'] },
  { id: 'prompter.boost',      scope: 'live', group: 'Prompter', keys: ['L'],      label: 'Boost (hold)',                  hold: ['boost_start', 'boost_stop'] },
  { id: 'prompter.size.down',  scope: 'live', group: 'Prompter', keys: ['-'],      label: 'Text smaller',                  run: () => sendPrompterControl('size_down') },
  { id: 'prompter.size.up',    scope: 'live', group: 'Prompter', keys: ['='],      label: 'Text bigger',                   run: () => sendPrompterControl('size_up') },
  { id: 'prompter.speed.down', scope: 'live', group: 'Prompter', keys: ['['],      label: 'Speed down',                    run: () => sendPrompterControl('speed_down') },
  { id: 'prompter.speed.up',   scope: 'live', group: 'Prompter', keys: [']'],      label: 'Speed up',                      run: () => sendPrompterControl('speed_up') },
  { id: 'prompter.nudge.back', scope: 'live', group: 'Prompter', keys: [','],      label: 'Nudge back',                    run: () => poNudgeSeek(-3) },
  { id: 'prompter.nudge.fwd',  scope: 'live', group: 'Prompter', keys: ['.'],      label: 'Nudge forward',                 run: () => poNudgeSeek(3) },
  { id: 'prompter.cue.current',scope: 'live', group: 'Prompter', keys: ['C'],      label: 'Cue prompter to current row',   run: () => sendPrompterControl('seek_row_' + (Math.max(lsIdx, 0) + 1)) },
  { id: 'prompter.top',        scope: 'live', group: 'Prompter', keys: ['T'],      label: 'Prompter to top',               run: () => sendPrompterControl('reset') },
  { id: 'prompter.fullscreen', scope: 'live', group: 'Prompter', keys: ['F'],      label: 'Talent fullscreen',             run: () => sendPrompterControl('fullscreen') },
  { id: 'prompter.reset',      scope: 'live', group: 'Prompter', keys: ['R'],      label: 'Reset talent screen',           run: () => sendPrompterControl('reset') },
  { id: 'prompter.hideui',     scope: 'live', group: 'Prompter', keys: ['H'],      label: 'Hide talent UI',                run: () => sendPrompterControl('hide_interface') },
  { id: 'prompter.mirror',     scope: 'live', group: 'Prompter', keys: ['M'],      label: 'Mirror talent screen',          run: () => sendPrompterControl('mirror') },
  { id: 'prompter.editscript', scope: 'live', group: 'Prompter', keys: ['E'],      label: 'Edit current row script',       run: () => openLiveScript(Math.max(lsIdx, 0)) },
  { id: 'prompter.dir.fwd',    scope: 'live', group: 'Prompter', keys: ['Alt+ArrowUp'],   label: 'Direction forward',      run: () => sendPrompterControl('direction_forward') },
  { id: 'prompter.dir.rev',    scope: 'live', group: 'Prompter', keys: ['Alt+ArrowDown'], label: 'Direction reverse',      run: () => sendPrompterControl('direction_reverse') },
  { id: 'playout.go',          scope: 'live', group: 'Playout',  keys: ['G'],          label: 'GO (Outrangutan)',          run: () => fireOutrangutanTransport('go') },
  { id: 'playout.pause',       scope: 'live', group: 'Playout',  keys: ['P'],          label: 'Pause / resume playout',    run: () => fireOutrangutanTransport('pause') },
  { id: 'playout.stop',        scope: 'live', group: 'Playout',  keys: ['S'],          label: 'Stop playout',              run: () => fireOutrangutanTransport('stop') },
  { id: 'playout.fade',        scope: 'live', group: 'Playout',  keys: ['Shift+S'],    label: 'Fade-stop playout',         run: () => fireOutrangutanTransport('fadeStop') },
  { id: 'playout.panic',       scope: 'live', group: 'Playout',  keys: ['Shift+Escape'], label: 'PANIC (all stop)',        run: () => fireOutrangutanTransport('panic') },
  { id: 'scrub.open',          scope: 'live', group: 'Scrub & reference', keys: ['/'], label: 'Jog-wheel scrub (Enter cues, Esc cancels)', run: () => openJogScrub() },
  { id: 'ref.open',            scope: 'live', group: 'Scrub & reference', keys: ['?'], label: 'This shortcut reference',   run: () => toggleKeymapRef() },
  { id: 'ref.open.build',      scope: 'build', group: 'Scrub & reference', keys: ['?'], label: 'Shortcut reference',       run: () => toggleKeymapRef() },
];

// Effective bindings = defaults overridden per action id from localStorage.
function keymapBindings(action) {
  try {
    const ov = JSON.parse(localStorage.getItem('cueola_keymap') || '{}');
    if (Array.isArray(ov[action.id]) && ov[action.id].length) return ov[action.id];
  } catch (e) {}
  return action.keys;
}
// "Shift+S" / "Alt+ArrowUp" / "Space" / "?" → match against a keyboard event.
// Letters compare case-insensitively with an exact shift requirement; punctuation
// (?, =, [ …) matches e.key directly, so layouts that need Shift still work.
function keymapMatches(e, binding) {
  const parts = String(binding).split('+');
  const base = parts.pop();
  const mods = parts.map(p => p.toLowerCase());
  if (e.altKey !== mods.includes('alt')) return false;
  if (e.ctrlKey || e.metaKey) return false;
  const key = e.key === ' ' ? 'Space' : e.key;
  if (/^[a-z]$/i.test(base)) {
    if (key.toLowerCase() !== base.toLowerCase()) return false;
    return e.shiftKey === mods.includes('shift');
  }
  if (mods.includes('shift') && !e.shiftKey) return false;
  return key === base;
}
function keymapScopeNow() {
  if (document.getElementById('liveshow')?.classList.contains('on')) return 'live';
  if (document.getElementById('rundown')?.classList.contains('on')) return 'build';
  return null;
}
const _keymapHolds = new Map();   // action.id → stop control while a hold key is down
function keymapDispatch(e, phase) {
  const scope = keymapScopeNow();
  if (!scope) return false;
  // Overlays own their keys before the map runs.
  if (document.getElementById('lsRowPreviewOv')?.classList.contains('on')) {
    if (phase !== 'down' || isTextEditingTarget(e.target)) return false;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { consumeRemoteKey(e); previewRelativeRow(1); }
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { consumeRemoteKey(e); previewRelativeRow(-1); }
    else if (e.key === 'Escape') { consumeRemoteKey(e); hideOverlay('lsRowPreviewOv'); }
    return true;
  }
  if (typeof jogScrubHandleKey === 'function' && jogScrubHandleKey(e, phase)) return true;
  if (isTextEditingTarget(e.target)) {
    // Releasing a held key while focus sits in a text field must still send the
    // stop control — otherwise the prompter stays braked/boosted until blur.
    if (phase === 'up' && _keymapHolds.size) {
      for (const action of KEYMAP) {
        if (!action.hold || !_keymapHolds.has(action.id)) continue;
        if (!keymapBindings(action).some(b => keymapMatches(e, b))) continue;
        sendPrompterControl(_keymapHolds.get(action.id));
        _keymapHolds.delete(action.id);
      }
    }
    return false;   // typing suppresses everything else (Esc keeps browser default)
  }
  for (const action of KEYMAP) {
    if (action.scope !== scope) continue;
    if (!keymapBindings(action).some(b => keymapMatches(e, b))) continue;
    if (action.hold) {
      if (phase === 'down') { consumeRemoteKey(e); if (!e.repeat && !_keymapHolds.has(action.id)) { _keymapHolds.set(action.id, action.hold[1]); sendPrompterControl(action.hold[0]); } }
      else if (_keymapHolds.has(action.id)) { consumeRemoteKey(e); sendPrompterControl(_keymapHolds.get(action.id)); _keymapHolds.delete(action.id); }
      return true;
    }
    if (phase !== 'down' || e.repeat) { if (phase === 'down') consumeRemoteKey(e); return true; }
    consumeRemoteKey(e);
    action.run();
    return true;
  }
  return false;
}
document.addEventListener('keydown', e => { keymapDispatch(e, 'down'); });
document.addEventListener('keyup', e => { keymapDispatch(e, 'up'); });
// Losing window focus mid-hold must never leave the prompter braking/boosting.
window.addEventListener('blur', () => { _keymapHolds.forEach(stop => sendPrompterControl(stop)); _keymapHolds.clear(); });

// ── P5: shortcut reference (?) — generated from KEYMAP so it cannot drift ────
function toggleKeymapRef() {
  let ov = document.getElementById('keymapRefOv');
  if (ov && !ov.hidden) { ov.hidden = true; return; }
  if (!ov) {
    ov = document.createElement('div');
    ov.id = 'keymapRefOv'; ov.className = 'km-ov';
    ov.addEventListener('click', e => { if (e.target === ov || e.target.closest('.km-x')) ov.hidden = true; });
    document.body.appendChild(ov);
  }
  const chip = b => `<span class="km-key">${esc(b)}</span>`;
  const groups = {};
  KEYMAP.filter(a => a.scope === 'live').forEach(a => { (groups[a.group] = groups[a.group] || []).push(a); });
  let html = `<div class="km-card"><div class="km-head"><h3>Keyboard shortcuts — live screen</h3><button type="button" class="btn-secondary km-x">Done</button></div><div class="km-cols">`;
  Object.keys(groups).forEach(g => {
    html += `<div class="km-group"><div class="km-group-t">${esc(g)}</div>`
      + groups[g].map(a => `<div class="km-row"><span class="km-lbl">${esc(a.label)}</span><span class="km-keys">${keymapBindings(a).map(chip).join('')}</span></div>`).join('')
      + `</div>`;
  });
  // Outrangutan's own screen — read its LIVE bindings so this stays truthful.
  const og = window.Outrangutan && window.Outrangutan._state ? window.Outrangutan._state() : null;
  const sc = og && og.settings && og.settings.shortcuts;
  if (sc) {
    const nice = k => String(k) === ' ' ? 'Space' : (String(k).length === 1 ? String(k).toUpperCase() : String(k));
    html += `<div class="km-group"><div class="km-group-t">Outrangutan screen</div>`
      + [['GO', sc.go], ['Stop', sc.stop], ['Pause', sc.pause], ['Fade-stop', sc.fadeStop], ['PANIC', sc.panic], ['SFX board', 'Tab']]
        .map(([l, k]) => `<div class="km-row"><span class="km-lbl">${l}</span><span class="km-keys">${chip(nice(k))}</span></div>`).join('')
      + `<div class="km-note">Rebind inside Outrangutan (Tools ▸ Shortcuts); SFX pads carry per-pad hotkeys.</div></div>`;
  }
  html += `</div><div class="km-foot">Typing in any field suppresses shortcuts. Override a binding via <code>localStorage.cueola_keymap</code>, e.g. <code>{"playout.go":["G"]}</code> — ids match the registry.</div></div>`;
  ov.innerHTML = html;
  ov.hidden = false;
}

// ── P5: jog-wheel scrub — traverse the whole script, local until committed ──
// Position model: (script segment = rundown row anchor, char offset within it).
// Wheel / drag / arrows move it; Shift accelerates; Enter cues the prompter to
// the exact point (Decisions #9); Esc abandons. Talent sees nothing until Enter.
let jogState = null;
function jogSegments() {
  const text = prompterText || '';
  if (!text.trim()) return null;
  const segs = []; let off = 0;
  for (const line of text.split('\n')) {
    const m = line.match(/^\[(\d+)\]\s*(.*)/);
    if (m) segs.push({ row: +m[1], label: (m[2] || ('Row ' + m[1])).slice(0, 64), start: off });
    off += line.length + 1;
  }
  if (!segs.length || segs[0].start > 0) segs.unshift({ row: 0, label: 'Top of script', start: 0 });
  const total = Math.max(1, text.length);
  segs.forEach((s, i) => { s.end = i + 1 < segs.length ? segs[i + 1].start : total; });
  return { segs, total };
}
function jogSegAt(pos) { let idx = 0; jogState.segs.forEach((s, i) => { if (pos >= s.start) idx = i; }); return idx; }
function openJogScrub() {
  const built = jogSegments();
  if (!built) { toast('No script loaded to scrub.'); return; }
  let ov = document.getElementById('jogScrubOv');
  if (!ov) {
    ov = document.createElement('div');
    ov.id = 'jogScrubOv'; ov.className = 'km-ov';
    document.body.appendChild(ov);
    ov.addEventListener('wheel', e => { e.preventDefault(); if (jogState) jogNudge(e.deltaY * (e.shiftKey ? 5 : 1) * jogState.total / 4000); }, { passive: false });
    ov.addEventListener('pointerdown', e => { if (!jogState) return; if (e.target.closest('.jog-bar')) { ov.setPointerCapture(e.pointerId); jogState.drag = true; jogDragTo(e); } });
    ov.addEventListener('pointermove', e => { if (jogState && jogState.drag) jogDragTo(e); });
    ov.addEventListener('pointerup', () => { if (jogState) jogState.drag = false; });
    ov.addEventListener('click', e => {
      if (e.target.closest('.jog-commit')) { commitJogScrub(); return; }
      if (e.target.closest('.jog-cancel') || e.target === ov) { closeJogScrub(); return; }
      const segEl = e.target.closest('[data-jogseg]');
      if (segEl && jogState) { jogState.pos = jogState.segs[+segEl.getAttribute('data-jogseg')].start; renderJogScrub(); }
    });
  }
  jogState = Object.assign(built, { pos: Math.max(0, Math.min(100, ptProgressPct() || 0)) / 100 * built.total, drag: false });
  ov.hidden = false;
  renderJogScrub();
}
function jogNudge(d) { jogState.pos = Math.max(0, Math.min(jogState.total, jogState.pos + d)); renderJogScrub(); }
function jogDragTo(e) {
  const bar = document.querySelector('#jogScrubOv .jog-bar');
  if (!bar) return;
  const r = bar.getBoundingClientRect();
  jogState.pos = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * jogState.total;
  renderJogScrub();
}
function renderJogScrub() {
  const ov = document.getElementById('jogScrubOv');
  if (!ov || !jogState) return;
  const { segs, total, pos } = jogState;
  const cur = jogSegAt(pos);
  const seg = segs[cur];
  const inSeg = seg.end > seg.start ? (pos - seg.start) / (seg.end - seg.start) : 0;
  const from = Math.max(0, cur - 4), to = Math.min(segs.length, cur + 5);   // windowed — long scripts stay cheap
  const rows = segs.slice(from, to).map((s, k) => {
    const i = from + k;
    return `<div class="jog-seg${i === cur ? ' cur' : ''}" data-jogseg="${i}">${s.row ? `<span class="jog-num">${s.row}</span>` : ''}<span class="jog-seg-lbl">${esc(s.label)}</span>${i === cur ? `<span class="jog-inpct">${Math.round(inSeg * 100)}% in</span>` : ''}</div>`;
  }).join('');
  ov.innerHTML = `<div class="km-card jog-card">
    <div class="km-head"><h3>Scrub script</h3><span class="jog-pct">${(pos / total * 100).toFixed(1)}%</span></div>
    <div class="jog-list">${rows}</div>
    <div class="jog-bar" title="Drag to scrub"><div class="jog-fill" style="width:${(pos / total * 100).toFixed(2)}%"></div></div>
    <div class="km-note">Wheel or drag to scrub · Shift = faster · ↑ ↓ jump rows · ← → fine · <b>Enter cues the prompter here</b> · Esc cancels</div>
    <div class="km-actions"><button type="button" class="btn-secondary jog-cancel">Cancel</button><button type="button" class="btn-primary jog-commit">Cue here (Enter)</button></div>
  </div>`;
}
function commitJogScrub() {
  if (!jogState) return;
  const pct = Math.max(0, Math.min(100, jogState.pos / jogState.total * 100));
  sendPrompterControl('seek_set_' + pct.toFixed(2));
  toast('Prompter cued to ' + pct.toFixed(0) + '% of the script.');
  closeJogScrub();
}
function closeJogScrub() {
  const ov = document.getElementById('jogScrubOv');
  if (ov) ov.hidden = true;
  jogState = null;
}
// ── P6: one shared dismissal utility (plan item 6) ───────────────────────────
// Click-outside or Esc closes any registered popover/tool panel. Panels with
// unsaved edits (cue config, settings modal, Planda Bear compose) deliberately
// stay explicit-dismiss — flagged in the Phase 6 proposal.
const _uiDismiss = [];
function uiDismissRegister(getEl, closeFn, opts = {}) {
  _uiDismiss.push({ getEl, closeFn, isOpen: opts.isOpen || null, ignore: opts.ignore || [] });
}
document.addEventListener('pointerdown', e => {
  _uiDismiss.forEach(d => {
    const el = d.getEl(); if (!el) return;
    const open = d.isOpen ? d.isOpen(el) : !el.hidden;
    if (!open || el.contains(e.target)) return;
    if (d.ignore.some(sel => e.target.closest?.(sel))) return;
    d.closeFn(el);
  });
}, true);
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape' || e.defaultPrevented) return;
  for (let i = _uiDismiss.length - 1; i >= 0; i--) {
    const d = _uiDismiss[i], el = d.getEl(); if (!el) continue;
    const open = d.isOpen ? d.isOpen(el) : !el.hidden;
    if (open) { d.closeFn(el); e.preventDefault(); return; }
  }
});
uiDismissRegister(() => document.getElementById('notifPanel'), () => closeNotifCenter(), { ignore: ['#notifBellBtn'] });
uiDismissRegister(() => document.getElementById('entryThemePanel'), () => closeEntryThemes(), { isOpen: el => !el.hasAttribute('hidden'), ignore: ['#entryThemeGear'] });

// Owns ALL keys while open (called first from keymapDispatch).
function jogScrubHandleKey(e, phase) {
  const kmOv = document.getElementById('keymapRefOv');
  if (kmOv && !kmOv.hidden) {
    if (phase === 'down' && (e.key === 'Escape' || e.key === '?')) { consumeRemoteKey(e); kmOv.hidden = true; }
    return true;
  }
  const ov = document.getElementById('jogScrubOv');
  if (!ov || ov.hidden || !jogState) return false;
  if (phase !== 'down') return true;
  if (e.key === 'Enter') { consumeRemoteKey(e); commitJogScrub(); return true; }
  if (e.key === 'Escape') { consumeRemoteKey(e); closeJogScrub(); return true; }
  if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
    consumeRemoteKey(e);
    const i = jogSegAt(jogState.pos);
    const next = e.key === 'ArrowDown' ? Math.min(jogState.segs.length - 1, i + 1)
      : (jogState.pos > jogState.segs[i].start + 2 ? i : Math.max(0, i - 1));
    jogState.pos = jogState.segs[next].start;
    renderJogScrub(); return true;
  }
  if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
    consumeRemoteKey(e);
    jogNudge((e.key === 'ArrowRight' ? 1 : -1) * (e.shiftKey ? 5 : 1) * jogState.total / 400);
    return true;
  }
  consumeRemoteKey(e);
  return true;
}

// ─────────────────────────────────────────────────────────────
// RUNDOWN RENDERING
// ─────────────────────────────────────────────────────────────
function toggleEditMode() {
  editMode = !editMode;
  const btn = document.getElementById('editModeBtn');
  if (btn) {
    setSymbolButtonLabel(btn, editMode ? 'action.confirm' : 'action.edit', editMode ? 'Done Editing' : 'Edit');
    btn.style.background = editMode ? 'color-mix(in srgb,var(--accent) 16%,transparent)' : '';
    btn.style.borderColor = editMode ? 'var(--accent)' : '';
    btn.style.color = editMode ? 'var(--accent)' : '';
  }
  renderRundown();
}

function renderTableHeaders() {
  const thead = document.querySelector('.rd-head');
  if (!thead) return;
  const dynCols = colOrder.map(type => {
    const m = COL_META[type];
    if (editMode) {
      return `<th class="col-cue${type==='script'?' col-script-c':''}"
                style="color:${m.color};cursor:grab;user-select:none"
                draggable="true"
                ondragstart="colDragStart(event,'${type}')"
                ondragover="colDragOver(event,this)"
                ondrop="colDrop(event,'${type}')"
                ondragend="colDragEnd(event)"
                data-col="${type}"
                title="Drag to reorder">${sfIcon(m.symbol)} ${m.label} ${sfIcon('action.drag','col-grip')}</th>`;
    }
    return `<th class="col-cue${type==='script'?' col-script-c':''}" style="color:${m.color}" data-col="${type}">${sfIcon(m.symbol)} ${m.label}</th>`;
  }).join('');
  const dragCol = editMode ? `<th class="col-drag" title="Drag rows to reorder">${sfIcon('action.drag')}</th>` : '<th class="col-drag"></th>';
  thead.innerHTML = `${dragCol}<th class="col-num">#</th><th class="col-info">Name</th><th class="col-time">Start / Dur</th>${dynCols}`;
}

function colDragStart(e, type) {
  colDragSrc = type;
  e.dataTransfer.effectAllowed = 'move';
  e.currentTarget.style.opacity = '.5';
}
function colDragOver(e, el) {
  e.preventDefault();
  document.querySelectorAll('.col-drag-over').forEach(c=>c.classList.remove('col-drag-over'));
  if (el && el.dataset.col !== colDragSrc) el.classList.add('col-drag-over');
}
function reRenderActiveGrid() {
  if (document.getElementById('liveshow')?.classList.contains('on')) renderLive();
  else renderRundown();
}
function colDrop(e, targetType) {
  e.preventDefault();
  document.querySelectorAll('.col-drag-over').forEach(c=>c.classList.remove('col-drag-over'));
  if (!colDragSrc || colDragSrc === targetType) { colDragSrc=null; return; }
  const fi = colOrder.indexOf(colDragSrc), ti = colOrder.indexOf(targetType);
  if (fi < 0 || ti < 0) { colDragSrc=null; return; }
  colOrder.splice(fi, 1); colOrder.splice(ti, 0, colDragSrc);
  localStorage.setItem('cueola_col_order', JSON.stringify(colOrder));
  colDragSrc = null;
  reRenderActiveGrid();
}
function colDragEnd(e) {
  e.currentTarget.style.opacity = '';
  document.querySelectorAll('.col-drag-over').forEach(c=>c.classList.remove('col-drag-over'));
  colDragSrc = null;
}

function toggleSegmentCollapse(id) {
  if (collapsedSegments.has(id)) collapsedSegments.delete(id);
  else collapsedSegments.add(id);
  try { localStorage.setItem('cueola_collapsed_segs', JSON.stringify([...collapsedSegments])); } catch {}
  renderRundown();
}

function renderRundown() {
  renderTableHeaders();
  const name = show.name||'Untitled Show';
  document.getElementById('rd-name').textContent = name;
  document.getElementById('rd-start').textContent = show.start ? clock(show.start,0) : '—';

  const total = totalSecs();
  document.getElementById('rd-dur').textContent = fmtSecs(total);
  document.getElementById('rd-count').textContent = beats.length;
  document.getElementById('rd-end').textContent = show.start ? clock(show.start, total) : '—';
  document.getElementById('progFill').style.width = '0%';

  const tbody = document.getElementById('rdBody');
  if (!beats.length) {
    tbody.innerHTML = `<tr><td colspan="10">
      <div class="empty-rundown">
        <div class="empty-rundown-title">Start with your first row</div>
        <div class="empty-rundown-sub">${freeTextMode ? 'Blank Slate is free-form. Add a row, then type directly into any cue cell without guided setup.' : 'Build the rundown one production beat at a time. Each row can hold video, audio, playback, graphics, lighting, and script cues.'}</div>
        <button class="empty-rundown-btn" onclick="openAddRow()">Add First Row</button>
      </div>
    </td></tr>`;
    renderAddRowBtn(tbody);
    updateBotBar();
    return;
  }

  // Pre-compute child counts per segment
  const segChildCounts = {};
  let _csi = null;
  beats.forEach(b => {
    if (b.style === 'segment') { _csi = b.id; segChildCounts[b.id] = 0; }
    else if (_csi !== null) segChildCounts[_csi] = (segChildCounts[_csi]||0)+1;
  });

  let offsetSecs = 0;
  let activeSegCollapsed = false;
  let cueNum = 0; // number non-segment beats
  let html = '';
  beats.forEach((b, i) => {
    const dur = fmtDur(b);
    const startStr = show.start ? clock(show.start, offsetSecs) : '—';
    offsetSecs += (b.min||0)*60+(b.sec||0); // always advance even when collapsed

    if (b.style === 'segment') {
      activeSegCollapsed = collapsedSegments.has(b.id);
      const cc = segChildCounts[b.id] || 0;
      const editActions = editMode ? `
        <div class="row-edit-actions">
          <button class="row-ea-btn" onclick="event.stopPropagation();moveRowUp(${b.id})"${i===0?' disabled style="opacity:.3;cursor:not-allowed"':''} title="Move up">▲ Up</button>
          <button class="row-ea-btn" onclick="event.stopPropagation();moveRowDown(${b.id})"${i===beats.length-1?' disabled style="opacity:.3;cursor:not-allowed"':''} title="Move down">▼ Down</button>
          <button class="row-ea-btn row-ea-del" onclick="event.stopPropagation();removeRow(${b.id})" title="Remove row">${sfIcon('action.delete')} Remove</button>
        </div>` : '';
      html += `<tr class="cue-row segment-row${editMode?' edit-mode-row':''}" ${editMode?'draggable="true"':''} data-id="${b.id}" onclick="${editMode?'openEdit('+b.id+')':'toggleSegmentCollapse('+b.id+')'}">
        <td class="seg-td" colspan="${colOrder.length + 4}">
          <div class="seg-row-inner">
            <span class="seg-collapse-icon">${sfIcon(activeSegCollapsed ? 'action.collapse' : 'action.expand')}</span>
            <span class="seg-label-text">${esc(b.info || 'Segment')}</span>
            ${b.notes ? `<span class="seg-notes-text">${esc(b.notes)}</span>` : ''}
            <span class="seg-count-badge">${cc} cue${cc===1?'':'s'}${activeSegCollapsed?' · collapsed':''}</span>
          </div>
          ${editActions}
        </td>
      </tr>`;
      return;
    }

    if (activeSegCollapsed) return; // hide child rows; offsetSecs already incremented

    cueNum++;
    const editActions = editMode ? `
      <div class="row-edit-actions">
        <button class="row-ea-btn" onclick="moveRowUp(${b.id})"${i===0?' disabled style="opacity:.3;cursor:not-allowed"':''} title="Move up">▲ Up</button>
        <button class="row-ea-btn" onclick="moveRowDown(${b.id})"${i===beats.length-1?' disabled style="opacity:.3;cursor:not-allowed"':''} title="Move down">▼ Down</button>
        <button class="row-ea-btn row-ea-add-before" onclick="addRowAt(${i},'before')" title="Add row before">+ Before</button>
        <button class="row-ea-btn row-ea-del" onclick="removeRow(${b.id})" title="Remove row">${sfIcon('action.delete')} Remove</button>
        <button class="row-ea-btn row-ea-add-after" onclick="addRowAt(${i},'after')" title="Add row after">+ After</button>
      </div>` : '';
    html += `<tr class="cue-row${editMode?' edit-mode-row':''}" ${editMode?'draggable="true"':''} onclick="${editMode?'':'openEdit('+b.id+')'}" data-id="${b.id}">
      <td class="cd cd-drag" style="cursor:${editMode?'grab':'default'}" title="${editMode?'Drag to reorder':'Enable edit mode to reorder'}"><span>${sfIcon('action.drag')}</span></td>
      <td class="cd cd-num">${cueNum}</td>
      <td class="cd" style="padding:8px 6px">
        <div class="cd-name">${esc(b.info||'—')}${rundownRowPresenceHTML(b.id)}</div>
        ${b.notes?`<div class="cd-subnote">${esc(b.notes)}</div>`:''}
        <span class="style-pill style-${b.style||'flex'}" style="margin-top:3px;display:inline-flex;align-items:center;gap:4px">${sfIcon(b.style==='timed'?'state.timed':'state.flex')} ${(b.style||'flex').toUpperCase()}</span>
        ${editMode ? '' : '<div class="row-open-hint">Click row to edit</div>'}
        ${editActions}
      </td>
      <td class="cd" style="padding:8px 6px">
        ${startStr!=='—'?`<div class="cd-time-start">${startStr}</div>`:''}
        <div class="cd-time-dur">${dur}</div>
      </td>
      ${colOrder.map(type=>`<td class="cd-cue-cell">${getCueCell(b,type)}</td>`).join('')}
    </tr>`;
  });

  tbody.innerHTML = html;
  renderAddRowBtn(tbody);
  initDrag();
  updateBotBar();
  updateNowNext();
}

function renderAddRowBtn(tbody) {
  const tr = document.createElement('tr');
  tr.className = 'add-row-tr';
  tr.innerHTML = `<td colspan="10"><button class="add-row-btn-el" onclick="openAddRow()">+ Add Row</button></td>`;
  tbody.appendChild(tr);
}

function getCueOn(d)  { return d?.on  || d?.take  || ''; }   // new format, fallback legacy
function getCueOff(d) { return d?.off || d?.ready || ''; }   // new format, fallback legacy

function getCueCell(b, type) {
  const tc = CT[type];
  const d = b.cues?.[type];
  const on  = getCueOn(d);
  const off = getCueOff(d);
  const isEmpty = !on && !off && (type !== 'script' || !d?.text) && !(type === 'playback' && d?.outCueId) && !((type === 'playback' || type === 'audio') && d?.outPadId);
  if (isEmpty) {
    return `<button class="cue-add-btn" onclick="event.stopPropagation();openCueConfig(${b.id},'${type}')" title="Add ${tc.label} cue"><span>+</span><span>${tc.label}</span></button>`;
  }
  const lines = [
    on  ? `<div class="cue-on-line"><span class="cue-on-dot">${sfIcon('marker.go')}</span>${esc(on)}</div>`  : '',
    off ? `<div class="cue-off-line"><span class="cue-off-dot">${sfIcon('marker.stop')}</span>${esc(off)}</div>` : '',
  ].filter(Boolean).join('');
  const scriptMeta = type === 'script' && d?.text
    ? `<div class="script-present-line">Script · ${scriptLineLabel(d.text)}</div>`
    : '';
  const outBadge = (type === 'playback' ? outrangutanCellBadge(d, b.id) : '') + ((type === 'playback' || type === 'audio') ? outrangutanSfxBadge(d) : '');
  return `<div class="cue-cell-filled" style="--cue-clr:${tc.color}" onclick="event.stopPropagation();openCueConfig(${b.id},'${type}')">
    <div class="cue-cell-icon" style="color:${tc.color}">${sfIcon(tc.symbol)}</div>
    <div class="cue-cell-info">${lines}${scriptMeta}${outBadge}</div>
  </div>`;
}

function getCueSummary(b) {
  const pType = COL_DEFAULTS.find(t => b.cues?.[t] && (getCueOn(b.cues[t]) || getCueOff(b.cues[t])));
  if (!pType) return { stateStr:'', srcStr:'', detStr:'' };
  const d = b.cues[pType];
  return { stateStr: getCueOff(d)||'', srcStr: getCueOn(d)||'', detStr:'' };
}

function scriptLineCount(text) {
  const clean = String(text || '').trim();
  if (!clean) return 0;
  return clean.split(/\n+/).filter(line => line.trim()).length;
}

function scriptLineLabel(text) {
  const n = scriptLineCount(text);
  return `${n} ${n === 1 ? 'line' : 'lines'}`;
}

function updateBotBar() {
  const total = totalSecs();
  const elapsed = Math.min(elapsedSecs, total);
  const remain  = Math.max(total-elapsed, 0);
  document.getElementById('bb-el').textContent = fmtProductionSecs(elapsed);
  document.getElementById('bb-rm').textContent = remain>0 ? fmtProductionSecs(remain) : '—';
}

function updateNowNext() {
  const idx = beats.length ? Math.max(lsIdx, 0) : -1;
  const now  = beats[idx];
  const next = beats[idx+1];
  document.getElementById('nn-now').textContent = 'NOW → '+(now?now.info:'—');
  document.getElementById('nn-nxt').textContent = 'NEXT → '+(next?next.info:'—');
}

// ─────────────────────────────────────────────────────────────
// DRAG & DROP
// ─────────────────────────────────────────────────────────────
function initDrag() {
  const tbody = document.getElementById('rdBody');
  if (!tbody || !editMode) return;
  let dragSrc = null;
  tbody.querySelectorAll('tr.cue-row').forEach(tr=>{
    tr.addEventListener('dragstart', e => { dragSrc=tr; tr.classList.add('dragging'); e.dataTransfer.effectAllowed='move'; });
    tr.addEventListener('dragend', ()=>{ tr.classList.remove('dragging'); tbody.querySelectorAll('tr').forEach(r=>r.classList.remove('drag-over')); });
    tr.addEventListener('dragover', e=>{ e.preventDefault(); tbody.querySelectorAll('tr').forEach(r=>r.classList.remove('drag-over')); if(tr!==dragSrc)tr.classList.add('drag-over'); });
    tr.addEventListener('drop', e=>{
      e.preventDefault();
      if (!dragSrc||dragSrc===tr) return;
      const si=beats.findIndex(b=>b.id===parseInt(dragSrc.dataset.id));
      const ti=beats.findIndex(b=>b.id===parseInt(tr.dataset.id));
      if (si<0||ti<0) return;
      const [moved]=beats.splice(si,1); beats.splice(ti,0,moved);
      renderRundown(); syncToFirestore();
    });
  });
}

function rowConfirmLabel(id) {
  const b = beats.find(x => x.id === id);
  if (!b) return 'this row';
  const label = (b.info || 'Untitled row').trim();
  return `"${label}"${b.style === 'segment' ? ' segment' : ' row'}`;
}

function removeRow(id) {
  if (!dangerConfirm(`Remove ${rowConfirmLabel(id)}?`, 'This removes the row and all cue cells in it. In a shared session, the removal syncs to collaborators.')) return;
  beats = beats.filter(b => b.id !== id);
  renderRundown(); syncToFirestore(); toast('Row removed.');
}

function moveRowUp(id) {
  const i = beats.findIndex(b => b.id === id);
  if (i <= 0) return;
  [beats[i-1], beats[i]] = [beats[i], beats[i-1]];
  renderRundown(); syncToFirestore();
}

function moveRowDown(id) {
  const i = beats.findIndex(b => b.id === id);
  if (i < 0 || i >= beats.length - 1) return;
  [beats[i], beats[i+1]] = [beats[i+1], beats[i]];
  renderRundown(); syncToFirestore();
}

// insertIdx = index to insert at; position = 'before'|'after'
let _insertIdx = null;
function addRowAt(idx, position) {
  _insertIdx = position === 'after' ? idx + 1 : idx;
  openAddRow();
}

// ─────────────────────────────────────────────────────────────
// ADD ROW WIZARD
// ─────────────────────────────────────────────────────────────
const AR_TYPE_DESC = {
  video:    'Camera, source switch',
  audio:    'Mics, music, sound',
  lighting: 'Fixtures, scenes, looks',
  playback: 'Clip rolls, VT, media',
  gfx:      'Graphics, lower thirds',
  script:   'Copy, dialogue, Flowmingo',
};

function openAddRow() {
  arStyle = 'timed';
  arCueType = null;
  const nameIn = document.getElementById('ar-name-input');
  if (nameIn) nameIn.value = '';
  const notesIn = document.getElementById('ar-notes-input');
  if (notesIn) notesIn.value = '';
  const minIn = document.getElementById('ar-min');
  if (minIn) minIn.value = '0';
  const secIn = document.getElementById('ar-sec');
  if (secIn) secIn.value = '30';
  document.getElementById('ar-next-1').disabled = false;
  const suggestionGrid = document.querySelector('#ar-step-1 .chip-grid');
  if (suggestionGrid) suggestionGrid.style.display = freeTextMode ? 'none' : '';
  const stepLabel = document.querySelector('#ar-step-1 .ar-step-label');
  if (stepLabel) stepLabel.textContent = freeTextMode ? 'New Row' : 'New Row — Step 1 of 2';
  const nextBtn = document.getElementById('ar-next-1');
  if (nextBtn) nextBtn.innerHTML = `<span>${freeTextMode ? 'Add Row' : 'Choose Cue Type'}</span>${sfIcon('action.forward')}`;
  document.querySelectorAll('#ar-step-1 .opt-card').forEach(c=>c.classList.remove('sel'));
  document.getElementById('opt-timed')?.classList.add('sel');
  const durWrap = document.getElementById('ar-dur-wrap');
  if (durWrap) durWrap.style.display = '';
  document.getElementById('ar-step-1').classList.add('on');
  document.getElementById('ar-step-2').classList.remove('on');
  document.getElementById('ar-step-3')?.classList.remove('on');
  buildArContext();
  showOverlay('addRowOv');
  setTimeout(()=>nameIn?.focus(), 80);
}

function arGoStep2() {
  if (!arStyle) return;
  if (freeTextMode || arStyle === 'segment') {
    insertAddRowBeat();
    hideOverlay('addRowOv');
    renderRundown();
    syncToFirestore();
    toast(arStyle === 'segment' ? 'Segment marker added.' : 'Row added.');
    return;
  }
  arCueType = null;
  const grid = document.getElementById('arTypeGrid');
  grid.innerHTML = Object.keys(CT).map(type => {
    const tc = CT[type];
    return `<button type="button" class="opt-card" id="artype-${type}"
        style="--oc:${tc.color};--ob:${tc.bg}"
        onclick="arSelectCueType('${type}')">
      <div class="opt-icon" style="font-size:24px">${sfIcon(tc.symbol)}</div>
      <div class="opt-name" style="color:${tc.color}">${tc.label}</div>
      <div class="opt-desc">${AR_TYPE_DESC[type]||''}</div>
    </button>`;
  }).join('');
  document.getElementById('ar-next-2').disabled = true;
  document.getElementById('ar-step-1').classList.remove('on');
  document.getElementById('ar-step-3')?.classList.remove('on');
  document.getElementById('ar-step-2').classList.add('on');
}

function arSelectCueType(type) {
  arCueType = type;
  document.querySelectorAll('#arTypeGrid .opt-card').forEach(c=>c.classList.remove('sel'));
  document.getElementById(`artype-${type}`)?.classList.add('sel');
  document.getElementById('ar-next-2').disabled = false;
}

function buildAddRowBeat() {
  const info  = document.getElementById('ar-name-input')?.value?.trim()||'';
  const notes = document.getElementById('ar-notes-input')?.value?.trim()||'';
  const min   = arStyle==='timed' ? (parseInt(document.getElementById('ar-min')?.value)||0) : 0;
  const sec   = arStyle==='timed' ? (parseInt(document.getElementById('ar-sec')?.value)||0) : 0;
  const now = Date.now();
  return { id:nextBeatId(), style:arStyle, info, notes, min, sec, done:false, cues:{}, _createdAt:now, _createdBy:presenceId };
}

function insertAddRowBeat() {
  const newBeat = buildAddRowBeat();
  if (_insertIdx !== null && _insertIdx >= 0 && _insertIdx <= beats.length) {
    beats.splice(_insertIdx, 0, newBeat);
  } else {
    beats.push(newBeat);
  }
  _insertIdx = null;
  return newBeat;
}

function arCreateRowAndOpenCueBuilder() {
  if (!arStyle || !arCueType) return;
  const newBeat = insertAddRowBeat();
  hideOverlay('addRowOv');
  renderRundown();
  syncToFirestore();
  toast('Row added. Configure the cue.');
  setTimeout(() => openCueConfig(newBeat.id, arCueType), 80);
}

function arGoStep3() {
  arCreateRowAndOpenCueBuilder();
}

function arGoStep1() {
  document.getElementById('ar-step-2').classList.remove('on');
  document.getElementById('ar-step-3')?.classList.remove('on');
  document.getElementById('ar-step-1').classList.add('on');
}

function closeAddRowOv(e) {
  if (e && !e.target.closest('.ar-wrap')) { _insertIdx = null; hideOverlay('addRowOv'); }
  else if (!e) { _insertIdx = null; hideOverlay('addRowOv'); }
}

function buildArContext() {
  const ctx = document.getElementById('arContext');
  const last4 = beats.slice(-4);
  if (!last4.length) { ctx.innerHTML=''; return; }
  ctx.innerHTML = `<div class="ar-ctx-label">Last ${last4.length} row${last4.length>1?'s':''}</div>`+
    last4.map(b => {
      const types = Object.keys(b.cues||{}).filter(t=>CT[t]);
      const badges = types.map(t=>`<span class="type-badge tb-${t}" style="font-size:7px;color:${CT[t].color};background:${CT[t].bg}">${sfIcon(CT[t].symbol)}</span>`).join('');
      return `<div class="ar-ctx-row">
        <span class="ar-ctx-num">${beats.indexOf(b)+1}</span>
        <span style="display:flex;gap:2px;align-items:center">${badges||'<span style="color:var(--text3);font-size:10px">—</span>'}</span>
        <span class="ar-ctx-name">${esc(b.info||'—')}</span>
        <span class="ar-ctx-dur">${fmtDur(b)}</span>
      </div>`;
    }).join('');
}

function arSelectStyle(s) {
  arStyle = s;
  document.querySelectorAll('#ar-step-1 .opt-card').forEach(c=>c.classList.remove('sel'));
  document.getElementById(`opt-${s}`)?.classList.add('sel');
  const durWrap = document.getElementById('ar-dur-wrap');
  if (durWrap) durWrap.style.display = s==='timed' ? '' : 'none';
  const nextBtn = document.getElementById('ar-next-1');
  if (nextBtn && !freeTextMode) {
    nextBtn.innerHTML = `<span>${s === 'segment' ? 'Add Segment Marker' : 'Choose Cue Type'}</span>${sfIcon('action.forward')}`;
  }
  updateArNextEnabled();
}

function updateArNextEnabled() {
  document.getElementById('ar-next-1').disabled = !arStyle;
}

function arPickName(name) {
  const el = document.getElementById('ar-name-input');
  if (el) el.value = name;
  updateArNextEnabled();
}

// buildArFields removed — wizard now single-step; cue types configured via table cells

// ─────────────────────────────────────────────────────────────
// CUE CONFIG MODAL (per-cell)
// ─────────────────────────────────────────────────────────────
function openCueConfig(beatId, type) {
  cueConfigBeatId = beatId;
  cueConfigType   = type;
  // Reset all state
  _vOnSrc='';_vOnAct='';_vOnShot='';_vOffTrans='';_vOffDest='';
  _aOnSrc='';_aOnCueType='';_aOffSrc='';_aOffCall='';
  _pOnAction='';_pOffHow='';_pOffRet='';
  _gOnType='';_gOnSrc='';_gOnTrans='';_gOffType='';_gOffHow='';
  _lOnAction='';_lOnFix='';_lOnSpecial='';_lOffFix='';_lOffHow='';_lOffSpecial='';
  _sOnType='Script';_sOnSrc='';
  _sOnTags = [...(beats.find(x=>x.id===beatId)?.cues?.script?.scriptTags||[])];
  const b = beats.find(x=>x.id===beatId); if (!b) return;
  const existing = b.cues?.[type] || null;
  const tc = CT[type];
  document.getElementById('cueConfigTitle').innerHTML = `${sfIcon(tc.symbol)} ${tc.label}`;
  const bodyHTML = freeTextMode ? buildFreeTextCueFields(type, existing) : buildCueConfigFields(type, existing);
  document.getElementById('cueConfigFields').innerHTML = bodyHTML + outrangutanCueFields(type, existing) + qlabCueFields(type, existing);
  updateQlabFireBtn();
  document.getElementById('cueConfigRemoveBtn').style.display = existing ? '' : 'none';
  showModal('cueConfigModal');
  setRundownPresence(beatId);
}

function buildFreeTextCueFields(type, d) {
  d = d || {};
  const isScript = type === 'script';
  return `
    <div class="field">
      <label class="field-lbl">${isScript ? 'Script Cue' : 'Ready (standby)'}</label>
      <input class="field-in" id="cc-on-text" value="${esc(getCueOn(d))}" placeholder="Type anything..." maxlength="160" autocomplete="off">
    </div>
    ${isScript ? '' : `<div class="field">
      <label class="field-lbl">Take (go)</label>
      <input class="field-in" id="cc-off-text" value="${esc(getCueOff(d))}" placeholder="Type anything..." maxlength="160" autocomplete="off">
    </div>`}
    ${isScript ? `<div class="field">
      <label class="field-lbl">Speaker name</label>
      <input class="field-in" id="cc-s-speaker" value="${esc(d.speaker||d.customSrc||'')}" placeholder="e.g. Host, Anchor, Narrator" maxlength="80" autocomplete="off">
    </div>
    <div class="field">
      <label class="field-lbl">Script Copy</label>
      <textarea class="field-in" id="cc-s-text" rows="8" style="resize:vertical;line-height:1.7;font-size:14px" placeholder="Type or paste the script for Flowmingo.">${esc(d.text||'')}</textarea>
    </div>` : ''}
    <div class="field">
      <label class="field-lbl">Notes</label>
      <textarea class="field-in" id="cc-notes" rows="3" style="font-size:13px;line-height:1.6" placeholder="Anything the team needs to know.">${esc(d.notes||'')}</textarea>
    </div>`;
}

function ccChips(chips, fn) {
  return chips.map(c => {
    // JSON-stringify the JS argument, then HTML-escape the whole attribute —
    // chip values/labels include custom source names synced from other devices.
    const val = esc(JSON.stringify((c.v !== undefined ? c.v : c).toString()));
    const lbl = esc((c.label || c).toString());
    return `<button type="button" class="cc-chip" onclick="${fn}(${val})">${lbl}</button>`;
  }).join('');
}
function ccTabHint(icon, text) {
  return `<div class="cc-hint"><span class="cc-hint-icon">${icon}</span><span>${text}</span></div>`;
}
function ccCustomSrcField(id, val) {
  return `<input class="field-in cc-custom-in" id="${id}" value="${esc(val||'')}" placeholder="Type custom source name…" style="display:none;margin-top:8px" oninput="ccCustomSrcInput('${id}')">`;
}

// ── Cue config tab switcher ─────────────────────────
function ccTab(tab) {
  document.querySelectorAll('.cc-tab-btn').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
  document.querySelectorAll('.cc-panel').forEach(p => p.style.display = p.dataset.tab === tab ? '' : 'none');
}

// ── Chip helpers ────────────────────────────────────
function ccSelChip(groupId, val) {
  document.querySelectorAll(`#${groupId} .cc-chip`).forEach(c =>
    c.classList.toggle('sel', c.textContent.trim() === val || (c.getAttribute('data-val')||'') === val));
}
function ccShowCustom(fieldId, targetBuildFn) {
  document.getElementById(fieldId).style.display = '';
  document.getElementById(fieldId).focus();
  if (targetBuildFn) window[targetBuildFn]?.();
}
function ccCustomSrcInput(fieldId) {
  // triggers rebuild on whichever type is open
  const fns = { 'cc-v-custom':'_ccVOnBuild','cc-a-custom':'_ccAOnBuild','cc-s-custom':'_ccSOnBuild' };
  if (fns[fieldId]) window[fns[fieldId]]?.();
}

function buildCueConfigFields(type, d) {
  d = d || {};
  const onVal  = d.on  !== undefined ? d.on  : (d.take  || '');
  const offVal = d.off !== undefined ? d.off : (d.ready || '');
  const notes  = d.notes || '';
  let onPanel = '', offPanel = '';

  // Step header helper
  const step = (n, lbl) =>
    `<div class="cc-step-lbl"><span class="cc-step-num">${n}</span>${lbl}</div>`;

  // ══ VIDEO ══════════════════════════════════════════
  if (type === 'video') {
    onPanel = `
      ${step(1,'What is it?')}
      <div class="cc-section">
        <div class="cc-section-lbl">Source</div>
        <div class="cc-chip-grid" id="vOn-src">
          ${ccChips(getSources('video'), 'ccVOnSrc')}
          <button type="button" class="cc-chip cc-chip-add" onclick="ccShowCustom('cc-v-custom','_ccVOnBuild')">+ Custom</button>
        </div>
        ${ccCustomSrcField('cc-v-custom', d.customSrc)}
      </div>
      ${step(2,'What will you do with it?')}
      <div class="cc-section">
        <div class="cc-section-lbl">Action</div>
        <div class="cc-chip-grid" id="vOn-act">
          ${ccChips(['Ready','Standby','Set','Set with Media Wipe'], 'ccVOnAct')}
        </div>
      </div>
      <div class="cc-section" id="vOn-shot-row" style="display:none">
        <div class="cc-section-lbl">Shot type</div>
        <div class="cc-chip-grid" id="vOn-shot">
          ${ccChips(['Wide','Medium','CU','ECU','2-shot','OTS','POV','—'], 'ccVOnShot')}
        </div>
      </div>
      <div class="cc-divider"></div>
      <div class="field">
        <label class="field-lbl cc-result-lbl">○ READY (standby)</label>
        <input class="field-in cc-result-in" id="cc-on-text" value="${esc(onVal)}" placeholder="e.g. Set CAM 1 — Wide" maxlength="120" autocomplete="off">
      </div>`;

    offPanel = `
      ${step(1,'What is it?')}
      <div class="cc-section">
        <div class="cc-section-lbl">Destination</div>
        <div class="cc-chip-grid" id="vOff-dest">
          ${ccChips(['Black', ...getSources('video')], 'ccVOffDest')}
          <button type="button" class="cc-chip cc-chip-add" onclick="ccShowCustom('cc-v-off-dest-custom','_ccVOffBuild')">+ Custom</button>
        </div>
        <input class="field-in cc-custom-in" id="cc-v-off-dest-custom" value="" placeholder="Type custom destination…" style="display:none;margin-top:8px" oninput="_ccVOffBuild()">
      </div>
      ${step(2,'What will you do with it?')}
      <div class="cc-section">
        <div class="cc-section-lbl">Transition</div>
        <div class="cc-chip-grid" id="vOff-trans">
          ${ccChips(['Take','Dissolve','Media Wipe','Fade to Black'], 'ccVOffTrans')}
          <button type="button" class="cc-chip cc-chip-add" onclick="ccShowCustom('cc-v-off-trans-custom','_ccVOffBuild')">+ Custom</button>
        </div>
        <input class="field-in cc-custom-in" id="cc-v-off-trans-custom" value="" placeholder="Type custom transition…" style="display:none;margin-top:8px" oninput="_ccVOffBuild()">
      </div>
      <div class="cc-divider"></div>
      <div class="field">
        <label class="field-lbl cc-result-lbl">▶ TAKE (go)</label>
        <input class="field-in cc-result-in" id="cc-off-text" value="${esc(offVal)}" placeholder="e.g. Dissolve to Black" maxlength="120" autocomplete="off">
      </div>`;

  // ══ AUDIO ══════════════════════════════════════════
  } else if (type === 'audio') {
    onPanel = `
      ${step(1,'What is it?')}
      <div class="cc-section">
        <div class="cc-section-lbl">Source</div>
        <div class="cc-chip-grid" id="aOn-src">
          ${ccChips(getSources('audio'), 'ccAOnSrc')}
          <button type="button" class="cc-chip cc-chip-add" onclick="ccShowCustom('cc-a-custom','_ccAOnBuild')">+ Custom</button>
        </div>
        ${ccCustomSrcField('cc-a-custom', d.customSrc)}
      </div>
      ${step(2,'What will you do with it?')}
      <div class="cc-section">
        <div class="cc-section-lbl">Cue type</div>
        <div class="cc-chip-grid" id="aOn-cue">
          ${ccChips(['Open Mic','Track PLBK','Fade In','Play'], 'ccAOnCueType')}
          <button type="button" class="cc-chip cc-chip-add" onclick="ccShowCustom('cc-a-cue-custom','_ccAOnBuild')">+ Custom</button>
        </div>
        <input class="field-in cc-custom-in" id="cc-a-cue-custom" value="" placeholder="Type custom cue type…" style="display:none;margin-top:8px" oninput="_ccAOnBuild()">
      </div>
      <div class="cc-divider"></div>
      <div class="field">
        <label class="field-lbl cc-result-lbl">○ READY (standby)</label>
        <input class="field-in cc-result-in" id="cc-on-text" value="${esc(onVal)}" placeholder="e.g. Open Mic — Host" maxlength="120" autocomplete="off">
      </div>`;

    offPanel = `
      ${step(1,'What is it?')}
      <div class="cc-section">
        <div class="cc-section-lbl">Source</div>
        <div class="cc-chip-grid" id="aOff-src">
          ${ccChips([...getSources('audio'), 'All'], 'ccAOffSrc')}
          <button type="button" class="cc-chip cc-chip-add" onclick="ccShowCustom('cc-a-off-custom','_ccAOffBuild')">+ Custom</button>
        </div>
        <input class="field-in cc-custom-in" id="cc-a-off-custom" value="" placeholder="Type custom source…" style="display:none;margin-top:8px" oninput="_ccAOffBuild()">
      </div>
      ${step(2,'What will you do with it?')}
      <div class="cc-section">
        <div class="cc-section-lbl">Cue</div>
        <div class="cc-chip-grid" id="aOff-call">
          ${ccChips(['Close Mic','Mics Out','Fade Out','Track Out','Music Out','SFX Out','All Out','Silence'], 'ccAOffCall')}
        </div>
      </div>
      <div class="cc-divider"></div>
      <div class="field">
        <label class="field-lbl cc-result-lbl">▶ TAKE (go)</label>
        <input class="field-in cc-result-in" id="cc-off-text" value="${esc(offVal)}" placeholder="e.g. Close Mic — Host" maxlength="120" autocomplete="off">
      </div>`;

  // ══ PLAYBACK ════════════════════════════════════════
  } else if (type === 'playback') {
    onPanel = `
      ${step(1,'What is it?')}
      <div class="field">
        <label class="field-lbl">Clip name</label>
        <input class="field-in" id="cc-play-clip" value="${esc(d.clip||'')}" placeholder="e.g. SC_042 or HOFL_122_Open" maxlength="60" autocomplete="off" oninput="ccPOnBuild()">
      </div>
      ${step(2,'What will you do with it?')}
      <div class="cc-section">
        <div class="cc-section-lbl">Action</div>
        <div class="cc-chip-grid" id="pOn-act">
          ${ccChips(['Ready','Roll'], 'ccPOnAct')}
        </div>
      </div>
      <div class="cc-section" id="pOn-dur-row" style="display:none">
        <div class="cc-section-lbl">Duration (TRT)</div>
        <div style="display:flex;gap:10px;align-items:flex-start">
          <div class="field" style="flex:1;text-align:center">
            <label class="field-lbl">Min</label>
            <input class="field-in" id="cc-play-min" type="number" min="0" max="99" value="${d.trtMin||''}" placeholder="0" style="text-align:center;font-family:var(--mono);font-size:20px" oninput="ccPOnBuild()">
          </div>
          <div style="padding-top:34px;color:var(--text3);font-size:22px;font-family:var(--mono)">:</div>
          <div class="field" style="flex:1;text-align:center">
            <label class="field-lbl">Sec</label>
            <input class="field-in" id="cc-play-sec" type="number" min="0" max="59" value="${d.trtSec||''}" placeholder="00" style="text-align:center;font-family:var(--mono);font-size:20px" oninput="ccPOnBuild()">
          </div>
        </div>
        <div class="field" style="margin-top:10px">
          <label class="field-lbl">SMPTE Timecode <span style="color:var(--text3);font-weight:400">— HH:MM:SS:FF</span></label>
          <input class="field-in" id="cc-play-smpte" value="${esc(d.smpte||'')}" placeholder="e.g. 00:02:15:00" maxlength="30" autocomplete="off" style="font-family:var(--mono)" oninput="ccPOnBuild()">
        </div>
      </div>
      <div class="cc-divider"></div>
      <div class="field">
        <label class="field-lbl cc-result-lbl">○ READY (standby)</label>
        <input class="field-in cc-result-in" id="cc-on-text" value="${esc(onVal)}" placeholder="e.g. Roll SC_042 — 0:45 TRT" maxlength="120" autocomplete="off">
      </div>`;

    offPanel = `
      ${step(1,'What is it?')}
      <div class="cc-section">
        <div class="cc-section-lbl">Return to</div>
        <div class="cc-chip-grid" id="pOff-ret">
          ${ccChips(['CAM 1','CAM 2','CAM 3','CAM 4','PLBK','Host','Anchor','Studio','Live'], 'ccPOffReturn')}
        </div>
      </div>
      ${step(2,'What will you do with it?')}
      <div class="cc-section">
        <div class="cc-section-lbl">How it ends</div>
        <div class="cc-chip-grid" id="pOff-how">
          ${ccChips(['Cut PLBK','Fade PLBK','Stop','Roll Next','Take Live'], 'ccPOffHow')}
        </div>
      </div>
      <div class="cc-divider"></div>
      <div class="field">
        <label class="field-lbl cc-result-lbl">▶ TAKE (go)</label>
        <input class="field-in cc-result-in" id="cc-off-text" value="${esc(offVal)}" placeholder="e.g. Cut PLBK — Take CAM 1" maxlength="120" autocomplete="off">
      </div>`;

  // ══ GFX ═════════════════════════════════════════════
  } else if (type === 'gfx') {
    onPanel = `
      ${step(1,'What is it?')}
      <div class="cc-section">
        <div class="cc-section-lbl">Graphic type</div>
        <div class="cc-chip-grid" id="gOn-type">
          ${ccChips(['Lower 3rd','Full Screen','Bug'], 'ccGOnType')}
          <button type="button" class="cc-chip cc-chip-add" onclick="ccShowCustom('cc-g-custom','ccGOnBuild')">+ Custom</button>
        </div>
        <input class="field-in cc-custom-in" id="cc-g-custom" value="${esc(d.customType||'')}" placeholder="Type custom graphic type…" style="display:none;margin-top:8px" oninput="ccGOnBuild()">
      </div>
      <div class="cc-section">
        <div class="cc-section-lbl">Source</div>
        <div class="cc-chip-grid" id="gOn-src">
          ${ccChips(getSources('gfx'), 'ccGOnSrc')}
        </div>
      </div>
      ${step(2,'What will you do with it?')}
      <div class="cc-section">
        <div class="cc-section-lbl">Transition</div>
        <div class="cc-chip-grid" id="gOn-trans">
          ${ccChips(['Cut','Auto On'], 'ccGOnTrans')}
        </div>
      </div>
      <div class="cc-section">
        <div class="cc-section-lbl">Motion type</div>
        <div class="cc-checks">
          <label class="cc-check"><input type="checkbox" id="cc-g-fixed" ${d.isFixed?'checked':''}> Fixed</label>
          <label class="cc-check"><input type="checkbox" id="cc-g-animated" ${d.isAnimated?'checked':''}> Animated</label>
        </div>
      </div>
      <div class="field">
        <label class="field-lbl">Content <span style="color:var(--text3);font-weight:400">— what it reads / shows</span></label>
        <input class="field-in" id="cc-gfx-content" value="${esc(d.gfxContent||'')}" placeholder="e.g. Host lower third, sponsor bug, intro card" maxlength="120" autocomplete="off" oninput="ccGOnBuild()">
      </div>
      <div class="cc-divider"></div>
      <div class="field">
        <label class="field-lbl cc-result-lbl">○ READY (standby)</label>
        <input class="field-in cc-result-in" id="cc-on-text" value="${esc(onVal)}" placeholder="e.g. Auto On — Lower 3rd GFX" maxlength="120" autocomplete="off">
      </div>`;

    offPanel = `
      ${step(1,'What is it?')}
      <div class="cc-section">
        <div class="cc-section-lbl">Graphic type</div>
        <div class="cc-chip-grid" id="gOff-type">
          ${ccChips(['Lower 3rd','Full Screen','Bug','This GFX'], 'ccGOffType')}
        </div>
      </div>
      ${step(2,'What will you do with it?')}
      <div class="cc-section">
        <div class="cc-section-lbl">Take it out</div>
        <div class="cc-chip-grid" id="gOff-how">
          ${ccChips(['Lost It','Auto Off','Clear All'], 'ccGOffHow')}
        </div>
      </div>
      <div class="cc-divider"></div>
      <div class="field">
        <label class="field-lbl cc-result-lbl">▶ TAKE (go)</label>
        <input class="field-in cc-result-in" id="cc-off-text" value="${esc(offVal)}" placeholder="e.g. Lost It — Lower 3rd" maxlength="120" autocomplete="off">
      </div>`;

  // ══ LIGHTING ════════════════════════════════════════
  } else if (type === 'lighting') {
    onPanel = `
      ${step(1,'What is it?')}
      <div class="cc-section">
        <div class="cc-section-lbl">Fixture / Area</div>
        <div class="cc-chip-grid" id="lOn-fix">
          ${ccChips(['Key','Fill','Back','All','House','Studio Wash'], 'ccLOnFix')}
          <button type="button" class="cc-chip ${d.lightingGoFeature?'sel':''}" onclick="ccLOnSpecial('GoFeature')">Go to Feature</button>
          <button type="button" class="cc-chip ${d.lightingGoCue?'sel':''}" onclick="ccLOnSpecial('GoCue')">Go to Cue</button>
        </div>
      </div>
      <div class="cc-section" id="lOn-gofeature-row" style="display:${d.lightingGoFeature?'':'none'}">
        <div class="cc-section-lbl">Feature name / details</div>
        <input class="field-in" id="cc-l-gofeature" value="${esc(d.lightingGoFeature||'')}" placeholder="e.g. Front wash warm, interview key" maxlength="80" oninput="_ccLOnBuild()">
      </div>
      <div class="cc-section" id="lOn-gocue-row" style="display:${d.lightingGoCue?'':'none'}">
        <div class="cc-section-lbl">Board cue number / label</div>
        <input class="field-in" id="cc-l-gocue" value="${esc(d.lightingGoCue||'')}" placeholder="e.g. Cue 14.5" maxlength="60" oninput="_ccLOnBuild()">
      </div>
      ${step(2,'What will you do with it?')}
      <div class="cc-section">
        <div class="cc-section-lbl">Action</div>
        <div class="cc-chip-grid" id="lOn-act">
          ${ccChips(['Cue On','At','Color','Gobo'], 'ccLOnAct')}
        </div>
      </div>
      <div class="cc-section" id="lOn-intensity-row" style="display:none">
        <div class="cc-section-lbl">Intensity</div>
        <div style="display:flex;gap:8px;align-items:center">
          <input class="field-in" id="cc-l-intensity" value="${esc(d.intensity||'')}" placeholder="e.g. 75%" maxlength="20" style="max-width:120px" oninput="_ccLOnBuild()">
          <div class="cc-chip-grid">${ccChips(['25%','50%','75%','100%','Full'], 'ccLOnIntensity')}</div>
        </div>
      </div>
      <div class="cc-section" id="lOn-color-row" style="display:none">
        <div class="cc-section-lbl">Color</div>
        <div class="cc-chip-grid" id="lOn-color">
          ${ccChips(['Warm White','Cool White','Red','Blue','Green','Amber','Magenta','UV'], 'ccLOnColor')}
        </div>
        <input class="field-in cc-custom-in" id="cc-l-color" value="${esc(d.color||'')}" placeholder="e.g. Lee 201 Full CT Blue" maxlength="60" style="margin-top:6px" oninput="_ccLOnBuild()">
      </div>
      <div class="cc-section" id="lOn-gobo-row" style="display:none">
        <div class="cc-section-lbl">Gobo</div>
        <input class="field-in" id="cc-l-gobo" value="${esc(d.gobo||'')}" placeholder="e.g. Gobo 3 — Breakup pattern" maxlength="60" oninput="_ccLOnBuild()">
      </div>
      <div class="field">
        <label class="field-lbl">Lighting notes <span style="color:var(--text3);font-weight:400">— cue numbers, focus, wash details</span></label>
        <textarea class="field-in" id="cc-l-notes-detail" rows="2" style="font-size:12px;line-height:1.5" placeholder="e.g. Cue 14.5 — Key light focus on anchor, remove fill">${esc(d.lightingDetail||'')}</textarea>
      </div>
      <div class="cc-divider"></div>
      <div class="field">
        <label class="field-lbl cc-result-lbl">○ READY (standby)</label>
        <input class="field-in cc-result-in" id="cc-on-text" value="${esc(onVal)}" placeholder="e.g. Key — Cue On" maxlength="120" autocomplete="off">
      </div>`;

    offPanel = `
      ${step(1,'What is it?')}
      <div class="cc-section">
        <div class="cc-section-lbl">Fixture / Area</div>
        <div class="cc-chip-grid" id="lOff-fix">
          ${ccChips(['Key','Fill','Back','All','House','Studio Wash'], 'ccLOffFix')}
          <button type="button" class="cc-chip ${d.lightingOffGoFeature?'sel':''}" onclick="ccLOffSpecial('GoFeature')">Go to Feature</button>
          <button type="button" class="cc-chip ${d.lightingOffGoCue?'sel':''}" onclick="ccLOffSpecial('GoCue')">Go to Cue</button>
        </div>
      </div>
      <div class="cc-section" id="lOff-gofeature-row" style="display:${d.lightingOffGoFeature?'':'none'}">
        <div class="cc-section-lbl">Feature name / details</div>
        <input class="field-in" id="cc-l-off-gofeature" value="${esc(d.lightingOffGoFeature||'')}" placeholder="e.g. House lights up full" maxlength="80" oninput="_ccLOffBuild()">
      </div>
      <div class="cc-section" id="lOff-gocue-row" style="display:${d.lightingOffGoCue?'':'none'}">
        <div class="cc-section-lbl">Board cue number / label</div>
        <input class="field-in" id="cc-l-off-gocue" value="${esc(d.lightingOffGoCue||'')}" placeholder="e.g. Cue 20" maxlength="60" oninput="_ccLOffBuild()">
      </div>
      ${step(2,'What will you do with it?')}
      <div class="cc-section">
        <div class="cc-section-lbl">Lighting out</div>
        <div class="cc-chip-grid" id="lOff-how">
          ${ccChips(['Black Out','Fade Out','Dim to 50%','Dim to 20%','House Up','Cross Fade','Hold'], 'ccLOffHow')}
        </div>
      </div>
      <div class="cc-divider"></div>
      <div class="field">
        <label class="field-lbl cc-result-lbl">▶ TAKE (go)</label>
        <input class="field-in cc-result-in" id="cc-off-text" value="${esc(offVal)}" placeholder="e.g. Key — Fade Out" maxlength="120" autocomplete="off">
      </div>`;

  // ══ SCRIPT ══════════════════════════════════════════
  } else if (type === 'script') {
    const isDialogue = d.scriptType === 'Dialogue';
    onPanel = `
      ${step(1,'What is it?')}
      <div class="cc-section">
        <div class="cc-section-lbl">Script type</div>
        <div class="cc-chip-grid" id="sOn-type">
          <button type="button" class="cc-chip ${isDialogue?'':'sel'}" onclick="ccSOnType('Script')">Script</button>
          <button type="button" class="cc-chip ${isDialogue?'sel':''}" onclick="ccSOnType('Dialogue')">Dialogue</button>
        </div>
      </div>
      <div class="cc-section">
        <div class="cc-section-lbl">Tags</div>
        <div class="cc-chip-grid" id="sOn-tags">
          ${(()=>{const tags=['Cold Open','Show Open','PKG Intro','Live Shot','VO','Toss','Guest Intro','Open Conversation','Tease','Throw to Break','Signoff'];const cur=d.scriptTags||[];return tags.map(t=>`<button type="button" class="cc-chip ${cur.includes(t)?'sel':''}" onclick="ccSOnTag('${t}')">${t}</button>`).join('');})()}
        </div>
      </div>
      <div class="cc-section">
        <div class="cc-section-lbl">Source / Speaker</div>
        <div class="cc-chip-grid" id="sOn-src">
          ${ccChips([...getSources('scriptWho'), 'Narrator','Anchor'], 'ccSOnSrc')}
          <button type="button" class="cc-chip cc-chip-add" onclick="ccShowCustom('cc-s-custom','_ccSOnBuild')">+ Custom</button>
        </div>
        ${ccCustomSrcField('cc-s-custom', d.customSrc)}
        <input class="field-in" id="cc-s-speaker" value="${esc(d.speaker||d.customSrc||'')}" placeholder="Speaker name for Flowmingo headers…" maxlength="80" autocomplete="off" style="margin-top:8px">
      </div>
      ${step(2,'What will you do with it?')}
      <div id="sOn-script-panel" style="${isDialogue?'display:none':''}">
        <div class="field">
          <label class="field-lbl">Script copy <span style="color:var(--text3);font-weight:400">— feeds Flowmingo</span></label>
          <textarea class="field-in" id="cc-s-text" rows="5" style="resize:vertical;line-height:1.7;font-size:14px" placeholder="Write the copy here, word for word.">${esc(d.text||'')}</textarea>
          <div class="marker-chip-row">
            <button type="button" class="marker-chip" onclick="wrapTextareaSelection('cc-s-text','**','**')"><strong>B</strong>old</button>
            <button type="button" class="marker-chip" onclick="insertCueScriptMarker('[BREAK - AUTO PAUSE] ')">Break</button>
            <button type="button" class="marker-chip" onclick="insertCueScriptMarker('[STOP HERE] ')">Stop</button>
            <button type="button" class="marker-chip" onclick="insertCueScriptMarker('[UPDATE] ')">Update</button>
          </div>
        </div>
        <div class="field">
          <label class="field-lbl">Upload script <span style="color:var(--text3);font-weight:400">(.txt or .pdf)</span></label>
          <input type="file" id="cc-s-file" accept=".txt,.md,.pdf" style="color:var(--text2);font-size:12px" onchange="loadScriptFile(this,'cc-s-text')">
        </div>
      </div>
      <div id="sOn-dialogue-panel" style="${isDialogue?'':'display:none'}">
        <div class="field">
          <label class="field-lbl">Dialogue note <span style="color:var(--text3);font-weight:400">— brief description only</span></label>
          <input class="field-in" id="cc-s-dialogue" value="${esc(d.dialogueNote||'')}" placeholder="e.g. Host and guest discuss the segment topic — unscripted" maxlength="160" autocomplete="off">
        </div>
      </div>
      <div class="cc-divider"></div>
      <div class="field">
        <label class="field-lbl cc-result-lbl">▶ SCRIPT CUE</label>
        <input class="field-in cc-result-in" id="cc-on-text" value="${esc(onVal)}" placeholder="e.g. Host — Begin" maxlength="120" autocomplete="off">
      </div>`;

    offPanel = '';
  }

  // Script: single tab; all others: On/Off tabs
  const isScript = type === 'script';
  const tabHtml = isScript ? '' : `
    <div class="cc-tabs">
      <button class="cc-tab-btn active" data-tab="on" onclick="ccTab('on')">○&nbsp; Ready</button>
      <button class="cc-tab-btn" data-tab="off" onclick="ccTab('off')">▶&nbsp; Take</button>
    </div>`;
  return `
    ${tabHtml}
    <div class="cc-panel" data-tab="on">${onPanel}</div>
    ${isScript ? '' : `<div class="cc-panel" data-tab="off" style="display:none">${offPanel}</div>`}
    <div class="cc-divider"></div>
    <div class="field">
      <label class="field-lbl">Notes <span style="color:var(--text3);font-weight:400">— for your crew</span></label>
      <textarea class="field-in" id="cc-notes" rows="2" placeholder="Add context, reminders, or crew instructions…" style="font-size:13px;line-height:1.6">${esc(notes)}</textarea>
    </div>`;
}

// ══ VIDEO On helpers ════════════════════════════════
let _vOnSrc='',_vOnAct='',_vOnShot='';
function ccVOnSrc(src) {
  _vOnSrc=src; _vOnAct=''; _vOnShot='';
  ccSelChip('vOn-src',src);
  document.querySelectorAll('#vOn-act .cc-chip,#vOn-shot .cc-chip').forEach(c=>c.classList.remove('sel'));
  document.getElementById('vOn-shot-row').style.display = 'none';
  _ccVOnBuild();
}
function ccVOnAct(act) {
  _vOnAct=act; ccSelChip('vOn-act',act);
  const isLive = /^(CAM|CPU|ME)/.test(_vOnSrc);
  document.getElementById('vOn-shot-row').style.display = isLive ? '' : 'none';
  _ccVOnBuild();
}
function ccVOnShot(shot) {
  _vOnShot=shot==='—'?'':shot; ccSelChip('vOn-shot',shot); _ccVOnBuild();
}
function _ccVOnBuild() {
  if (!_vOnSrc) return;
  const src  = document.getElementById('cc-v-custom')?.style.display!=='none'
    ? (document.getElementById('cc-v-custom')?.value||_vOnSrc) : _vOnSrc;
  const act  = _vOnAct || 'Set';
  const shot = _vOnShot ? ` — ${_vOnShot}` : '';
  const el   = document.getElementById('cc-on-text');
  if (el) el.value = `${act} ${src}${shot}`;
}

// ══ VIDEO Off helpers ═══════════════════════════════
let _vOffTrans='',_vOffDest='';
function ccVOffTrans(t){ _vOffTrans=t; ccSelChip('vOff-trans',t); _ccVOffBuild(); }
function ccVOffDest(d) { _vOffDest=d;  ccSelChip('vOff-dest',d);  _ccVOffBuild(); }
function _ccVOffBuild() {
  const el=document.getElementById('cc-off-text'); if(!el) return;
  const destCustomEl = document.getElementById('cc-v-off-dest-custom');
  const transCustomEl = document.getElementById('cc-v-off-trans-custom');
  const d = (destCustomEl?.style.display!=='none' && destCustomEl?.value) ? destCustomEl.value : (_vOffDest||'Black');
  const t = (transCustomEl?.style.display!=='none' && transCustomEl?.value) ? transCustomEl.value : (_vOffTrans||'Take');
  el.value = d==='Black' ? `${t} to Black` : `${t} to ${d}`;
}

// ══ AUDIO On helpers ════════════════════════════════
let _aOnSrc='',_aOnCueType='';
function ccAOnSrc(src) {
  _aOnSrc=src; ccSelChip('aOn-src',src);
  _ccAOnBuild();
}
function ccAOnCueType(t) { _aOnCueType=t; ccSelChip('aOn-cue',t); _ccAOnBuild(); }
function _ccAOnBuild() {
  const src = document.getElementById('cc-a-custom')?.style.display!=='none'
    ? (document.getElementById('cc-a-custom')?.value||_aOnSrc) : _aOnSrc;
  const cueCustomEl = document.getElementById('cc-a-cue-custom');
  const cue = (cueCustomEl?.style.display!=='none' && cueCustomEl?.value) ? cueCustomEl.value : _aOnCueType;
  const el  = document.getElementById('cc-on-text'); if(!el) return;
  const parts=[cue,src].filter(Boolean);
  el.value = parts.join(' — ');
}

// ══ AUDIO Off helpers ═══════════════════════════════
let _aOffSrc='',_aOffCall='';
function ccAOffSrc(src) {
  _aOffSrc=src; ccSelChip('aOff-src',src);
  _ccAOffBuild();
}
function ccAOffCall(val) { _aOffCall=val; ccSelChip('aOff-call',val); _ccAOffBuild(); }
function _ccAOffBuild() {
  const src = document.getElementById('cc-a-off-custom')?.style.display!=='none'
    ? (document.getElementById('cc-a-off-custom')?.value||_aOffSrc) : _aOffSrc;
  const el=document.getElementById('cc-off-text'); if(!el) return;
  const parts=[_aOffCall,src].filter(Boolean);
  el.value = parts.join(' — ');
}

// ══ PLAYBACK On helpers ═════════════════════════════
let _pOnAction='';
function ccPOnAct(act){
  _pOnAction=act; ccSelChip('pOn-act',act);
  document.getElementById('pOn-dur-row').style.display = act==='Roll' ? '' : 'none';
  ccPOnBuild();
}
function ccPOnBuild(){
  const clip=document.getElementById('cc-play-clip')?.value?.trim()||'';
  const min=parseInt(document.getElementById('cc-play-min')?.value)||0;
  const sec=parseInt(document.getElementById('cc-play-sec')?.value)||0;
  const smpte=document.getElementById('cc-play-smpte')?.value?.trim()||'';
  const trt=(min||sec)?` — ${min}:${sec.toString().padStart(2,'0')} TRT`:'';
  const smpteStr=smpte?` [${smpte}]`:'';
  const act=_pOnAction||'Roll';
  const el=document.getElementById('cc-on-text'); if(!el) return;
  el.value=clip?`${act} ${clip}${trt}${smpteStr}`:act;
}

// ══ PLAYBACK Off helpers ════════════════════════════
let _pOffHow='',_pOffRet='';
function ccPOffHow(v)    { _pOffHow=v; ccSelChip('pOff-how',v);  _ccPOffBuild(); }
function ccPOffReturn(v) { _pOffRet=v; ccSelChip('pOff-ret',v); _ccPOffBuild(); }
function _ccPOffBuild(){
  const el=document.getElementById('cc-off-text'); if(!el) return;
  const parts=[_pOffHow,_pOffRet?`Take ${_pOffRet}`:''].filter(Boolean);
  el.value=parts.join(' — ')||_pOffHow;
}

// ══ GFX On helpers ══════════════════════════════════
let _gOnType='',_gOnSrc='',_gOnTrans='';
function ccGOnType(t){ _gOnType=t; ccSelChip('gOn-type',t); ccGOnBuild(); }
function ccGOnSrc(s) { _gOnSrc=s;  ccSelChip('gOn-src',s);  ccGOnBuild(); }
function ccGOnTrans(t){ _gOnTrans=t; ccSelChip('gOn-trans',t); ccGOnBuild(); }
function ccGOnBuild(){
  const type = document.getElementById('cc-g-custom')?.style.display!=='none'
    ? (document.getElementById('cc-g-custom')?.value?.trim()||_gOnType) : _gOnType;
  const content=document.getElementById('cc-gfx-content')?.value?.trim()||'';
  const trans=_gOnTrans||'Cut';
  const el=document.getElementById('cc-on-text'); if(!el) return;
  const parts=[trans,type||(content?'GFX':''),content?`(${content})`:''].filter(Boolean);
  el.value=parts.join(' — ');
}

// ══ GFX Off helpers ═════════════════════════════════
let _gOffType='',_gOffHow='';
function ccGOffType(t){
  _gOffType=t; ccSelChip('gOff-type',t);
  _ccGOffBuild();
}
function ccGOffHow(val){ _gOffHow=val; ccSelChip('gOff-how',val); _ccGOffBuild(); }
function _ccGOffBuild(){
  const el=document.getElementById('cc-off-text'); if(!el) return;
  const label=(_gOffType&&_gOffType!=='This GFX')?_gOffType:'';
  const parts=[_gOffHow,label].filter(Boolean);
  el.value=parts.join(' — ')||_gOffHow;
}

// ══ LIGHTING On helpers ═════════════════════════════
let _lOnAction='',_lOnFix='',_lOnSpecial=''; // special: 'GoFeature'|'GoCue'|''
function ccLOnFix(v){
  _lOnFix=v; _lOnSpecial='';
  // deselect Go to Feature / Go to Cue visually
  document.querySelectorAll('#lOn-fix .cc-chip').forEach(c=>{if(c.textContent==='Go to Feature'||c.textContent==='Go to Cue')c.classList.remove('sel');});
  ccSelChip('lOn-fix',v);
  document.getElementById('lOn-gofeature-row').style.display='none';
  document.getElementById('lOn-gocue-row').style.display='none';
  _ccLOnBuild();
}
function ccLOnSpecial(which){
  _lOnSpecial=which; _lOnFix='';
  document.querySelectorAll('#lOn-fix .cc-chip').forEach(c=>c.classList.remove('sel'));
  // highlight the clicked special button
  const label = which==='GoFeature'?'Go to Feature':'Go to Cue';
  document.querySelectorAll('#lOn-fix .cc-chip').forEach(c=>{if(c.textContent===label)c.classList.add('sel');});
  document.getElementById('lOn-gofeature-row').style.display = which==='GoFeature' ? '' : 'none';
  document.getElementById('lOn-gocue-row').style.display     = which==='GoCue'     ? '' : 'none';
  _ccLOnBuild();
}
function ccLOnAct(v){
  _lOnAction=v; ccSelChip('lOn-act',v);
  document.getElementById('lOn-intensity-row').style.display = v==='At'    ? '' : 'none';
  document.getElementById('lOn-color-row').style.display     = v==='Color' ? '' : 'none';
  document.getElementById('lOn-gobo-row').style.display      = v==='Gobo'  ? '' : 'none';
  _ccLOnBuild();
}
function ccLOnIntensity(v){
  const el=document.getElementById('cc-l-intensity'); if(el) el.value=v; _ccLOnBuild();
}
function ccLOnColor(v){
  const el=document.getElementById('cc-l-color'); if(el) el.value=v; _ccLOnBuild();
}
function _ccLOnBuild(){
  const el=document.getElementById('cc-on-text'); if(!el) return;
  // Determine fixture string
  let fix=_lOnFix;
  if(_lOnSpecial==='GoFeature'){
    const val=document.getElementById('cc-l-gofeature')?.value?.trim()||'';
    fix=val?`Go to Feature: ${val}`:'Go to Feature';
    el.value=fix; return;
  }
  if(_lOnSpecial==='GoCue'){
    const val=document.getElementById('cc-l-gocue')?.value?.trim()||'';
    fix=val?`Go to Cue ${val}`:'Go to Cue';
    el.value=fix; return;
  }
  const act=_lOnAction||'Cue On';
  let detail='';
  if(_lOnAction==='At'){
    const int=document.getElementById('cc-l-intensity')?.value||'';
    detail=int?`At ${int}`:'At';
  } else if(_lOnAction==='Color'){
    const col=document.getElementById('cc-l-color')?.value||'';
    detail=col?`Color: ${col}`:'Color';
  } else if(_lOnAction==='Gobo'){
    const gob=document.getElementById('cc-l-gobo')?.value||'';
    detail=gob?`Gobo: ${gob}`:'Gobo';
  }
  const parts=[fix,detail||act].filter(Boolean);
  el.value=parts.join(' — ');
}

// ══ LIGHTING Off helpers ════════════════════════════
let _lOffFix='',_lOffHow='',_lOffSpecial='';
function ccLOffFix(v){
  _lOffFix=v; _lOffSpecial='';
  document.querySelectorAll('#lOff-fix .cc-chip').forEach(c=>{if(c.textContent==='Go to Feature'||c.textContent==='Go to Cue')c.classList.remove('sel');});
  ccSelChip('lOff-fix',v);
  document.getElementById('lOff-gofeature-row').style.display='none';
  document.getElementById('lOff-gocue-row').style.display='none';
  _ccLOffBuild();
}
function ccLOffSpecial(which){
  _lOffSpecial=which; _lOffFix='';
  document.querySelectorAll('#lOff-fix .cc-chip').forEach(c=>c.classList.remove('sel'));
  const label=which==='GoFeature'?'Go to Feature':'Go to Cue';
  document.querySelectorAll('#lOff-fix .cc-chip').forEach(c=>{if(c.textContent===label)c.classList.add('sel');});
  document.getElementById('lOff-gofeature-row').style.display = which==='GoFeature' ? '' : 'none';
  document.getElementById('lOff-gocue-row').style.display     = which==='GoCue'     ? '' : 'none';
  _ccLOffBuild();
}
function ccLOffHow(val){ _lOffHow=val; ccSelChip('lOff-how',val); _ccLOffBuild(); }
function _ccLOffBuild(){
  const el=document.getElementById('cc-off-text'); if(!el) return;
  if(_lOffSpecial==='GoFeature'){
    const val=document.getElementById('cc-l-off-gofeature')?.value?.trim()||'';
    el.value=val?`Go to Feature: ${val}`:'Go to Feature'; return;
  }
  if(_lOffSpecial==='GoCue'){
    const val=document.getElementById('cc-l-off-gocue')?.value?.trim()||'';
    el.value=val?`Go to Cue ${val}`:'Go to Cue'; return;
  }
  const parts=[_lOffFix,_lOffHow].filter(Boolean);
  el.value=parts.join(' — ')||_lOffHow;
}

// ══ SCRIPT tag helpers ══════════════════════════════
let _sOnTags = [];
function ccSOnTag(tag) {
  const idx = _sOnTags.indexOf(tag);
  if (idx>=0) _sOnTags.splice(idx,1); else _sOnTags.push(tag);
  document.querySelectorAll('#sOn-tags .cc-chip').forEach(c=>{
    c.classList.toggle('sel', _sOnTags.includes(c.textContent));
  });
  _ccSOnBuild();
}

// ══ SCRIPT On helpers ═══════════════════════════════
let _sOnType='Script',_sOnSrc='';
function ccSOnType(t){
  _sOnType=t;
  document.querySelectorAll('#sOn-type .cc-chip').forEach(c=>c.classList.toggle('sel',c.textContent===t));
  document.getElementById('sOn-script-panel').style.display   = t==='Dialogue'?'none':'';
  document.getElementById('sOn-dialogue-panel').style.display = t==='Dialogue'?'':'none';
  _ccSOnBuild();
}
function ccSOnSrc(v){ _sOnSrc=v; ccSelChip('sOn-src',v); _ccSOnBuild(); }
function _ccSOnBuild(){
  const src=document.getElementById('cc-s-custom')?.style.display!=='none'
    ? (document.getElementById('cc-s-custom')?.value||_sOnSrc) : _sOnSrc;
  const el=document.getElementById('cc-on-text'); if(!el) return;
  el.value=src?`${src} — Begin`:'Begin';
}


function saveCueConfig() {
  const b = beats.find(x=>x.id===cueConfigBeatId); if (!b) return;
  if (!b.cues) b.cues = {};
  const d = {
    on:    (document.getElementById('cc-on-text')?.value ||'').trim(),
    off:   (document.getElementById('cc-off-text')?.value||'').trim(),
    notes: (document.getElementById('cc-notes')?.value   ||'').trim(),
  };
  // Type-specific extras
  switch(cueConfigType) {
    case 'video':
      d.customSrc = document.getElementById('cc-v-custom')?.value?.trim()||'';
      break;
    case 'audio':
      d.customSrc  = document.getElementById('cc-a-custom')?.value?.trim()||'';
      break;
    case 'playback':
      d.clip    = document.getElementById('cc-play-clip')?.value?.trim()||'';
      d.trtMin  = document.getElementById('cc-play-min')?.value||'';
      d.trtSec  = document.getElementById('cc-play-sec')?.value||'';
      d.smpte   = document.getElementById('cc-play-smpte')?.value?.trim()||'';
      break;
    case 'gfx':
      d.customType  = document.getElementById('cc-g-custom')?.value?.trim()||'';
      d.gfxContent  = document.getElementById('cc-gfx-content')?.value?.trim()||'';
      d.isFixed     = document.getElementById('cc-g-fixed')?.checked||false;
      d.isAnimated  = document.getElementById('cc-g-animated')?.checked||false;
      break;
    case 'lighting':
      d.lightingDetail      = document.getElementById('cc-l-notes-detail')?.value?.trim()||'';
      d.intensity           = document.getElementById('cc-l-intensity')?.value?.trim()||'';
      d.color               = document.getElementById('cc-l-color')?.value?.trim()||'';
      d.gobo                = document.getElementById('cc-l-gobo')?.value?.trim()||'';
      d.lightingGoFeature   = document.getElementById('cc-l-gofeature')?.value?.trim()||'';
      d.lightingGoCue       = document.getElementById('cc-l-gocue')?.value?.trim()||'';
      d.lightingOffGoFeature= document.getElementById('cc-l-off-gofeature')?.value?.trim()||'';
      d.lightingOffGoCue    = document.getElementById('cc-l-off-gocue')?.value?.trim()||'';
      break;
    case 'script':
      d.scriptType  = _sOnType;
      d.customSrc   = document.getElementById('cc-s-custom')?.value?.trim()||'';
      d.speaker     = document.getElementById('cc-s-speaker')?.value?.trim()||'';
      d.text        = document.getElementById('cc-s-text')?.value||'';
      d.dialogueNote= document.getElementById('cc-s-dialogue')?.value?.trim()||'';
      d.scriptTags  = [..._sOnTags];
      break;
  }
  // Outrangutan links — playback cells carry cue + SFX links; audio cells carry SFX (P4)
  if (cueConfigType === 'playback') {
    const outCue = document.getElementById('cc-out-cue')?.value || '';
    const outAuto = document.getElementById('cc-out-auto')?.checked || false;
    if (outCue || outAuto) { d.outCueId = outCue; d.outAuto = outAuto; }
    else { delete d.outCueId; delete d.outAuto; }
  }
  if (cueConfigType === 'playback' || cueConfigType === 'audio') {
    const outPad = document.getElementById('cc-out-pad')?.value || '';
    const outPadAuto = document.getElementById('cc-out-pad-auto')?.checked || false;
    if (outPad) { d.outPadId = outPad; d.outPadAuto = outPadAuto; }
    else { delete d.outPadId; delete d.outPadAuto; }
  }
  // QLab trigger — kept only when there's a real target (a cue number, or GO which needs none)
  const qlabCue = (document.getElementById('cc-qlab-cue')?.value || '').trim();
  const qlabAction = document.getElementById('cc-qlab-action')?.value || 'start';
  if (qlabCue || qlabAction === 'go') {
    d.qlabCue = qlabCue; d.qlabAction = qlabAction;
    d.qlabAuto = document.getElementById('cc-qlab-auto')?.checked || false;
  } else { delete d.qlabCue; delete d.qlabAction; delete d.qlabAuto; }
  b.cues[cueConfigType] = d;
  hideModal('cueConfigModal');
  setRundownPresence(null);
  renderRundown(); syncToFirestore(); toast('Cue saved.');
}

function removeCueCfg() {
  const b = beats.find(x=>x.id===cueConfigBeatId); if (!b||!b.cues) return;
  const cueName = CT[cueConfigType]?.label || cueConfigType || 'cue';
  if (!dangerConfirm(`Remove ${cueName} from ${rowConfirmLabel(cueConfigBeatId)}?`, 'Only this cue cell is removed. Other cues on the row stay in place.')) return;
  delete b.cues[cueConfigType];
  hideModal('cueConfigModal');
  setRundownPresence(null);
  renderRundown(); syncToFirestore(); toast('Cue removed.');
}

// ─────────────────────────────────────────────────────────────
// QLAB INTEGRATION (Cueola → QLab)
// Cueola is the master: firing a cue writes a command to Firestore
// (sessions/<code>.qlab.command). A small local QLab Agent (see /qlab-agent)
// listens to that doc and sends OSC to QLab. This mirrors the prompter-control
// transport: a single command object, deduped by commandId on the agent side.
// ─────────────────────────────────────────────────────────────
let qlabAgentLastBeat = 0;   // ts of the most recent agent heartbeat we've seen
let qlabAgentInfo = null;    // { host, port } reported by the agent
let qlabLastAckTs = 0;       // dedup acks (every doc write re-fires the snapshot)
let _qlabCmdSeq = 0;

// Actions Cueola can ask QLab to perform. 'go' advances the QLab playhead and
// needs no cue number; the rest are cue-scoped (/cue/<n>/<action>).
const QLAB_ACTIONS = [
  ['start',  'Start'],
  ['stop',   'Stop'],
  ['pause',  'Pause'],
  ['resume', 'Resume'],
  ['load',   'Load'],
  ['panic',  'Panic'],
  ['go',     'GO (playhead)'],
];

function nextQlabCommandId() {
  _qlabCmdSeq += 1;
  return `qlab_${CLIENT_ID}_${Date.now().toString(36)}_${_qlabCmdSeq}`;
}

// 'go' is the only action that doesn't require a cue number.
function qlabCueRequiresNumber(action) { return action !== 'go'; }

function qlabAgentOnline() {
  return !!qlabAgentLastBeat && (Date.now() - qlabAgentLastBeat) < 15000;
}

function noteQlabAgentBeat(hb) {
  qlabAgentLastBeat = hb.ts || Date.now();
  qlabAgentInfo = { host: hb.host || '', port: hb.port || '' };
  refreshQlabStatusBadges();
}

function handleQlabAck(ack) {
  if (!ack || !ack.ts || ack.ts === qlabLastAckTs) return;
  qlabLastAckTs = ack.ts;
  // Only surface acks for commands we just sent, and only recent ones.
  if (Date.now() - ack.ts > 8000) return;
  if (ack.ok && ack.sentCount) {
    toast(`QLab fired ${ack.sentCount} cue${ack.sentCount > 1 ? 's' : ''}.`);
  } else if (ack.ok && !ack.sentCount && ack.cueCount) {
    toast('QLab got the command but sent nothing — check cue numbers.');
  }
}

function qlabAgentStatusHTML() {
  const online = qlabAgentOnline();
  const dot = `<span class="qlab-dot ${online ? 'on' : 'off'}"></span>`;
  return `${dot}${online ? 'QLab Connected' : 'QLab Agent offline'}`;
}

function refreshQlabStatusBadges() {
  document.querySelectorAll('[data-qlab-status]').forEach(n => { n.innerHTML = qlabAgentStatusHTML(); });
}

// Optional QLab trigger block, appended to every cue-config modal.
function qlabCueFields(type, d) {
  d = d || {};
  const cueVal = esc(d.qlabCue || '');
  const action = d.qlabAction || 'start';
  const auto   = d.qlabAuto ? 'checked' : '';
  const opts = QLAB_ACTIONS.map(([v, l]) => `<option value="${v}" ${v === action ? 'selected' : ''}>${l}</option>`).join('');
  return `
    <div class="field cc-qlab">
      <div class="cc-section-lbl cc-qlab-head">
        ${sfIcon('action.forward')} QLab trigger <span class="cc-qlab-optional">— optional</span>
        <span class="cc-qlab-status" data-qlab-status>${qlabAgentStatusHTML()}</span>
      </div>
      <div class="cc-qlab-row">
        <div class="cc-qlab-cue-field">
          <label class="field-lbl">QLab cue number / ID</label>
          <input class="field-in" id="cc-qlab-cue" value="${cueVal}" placeholder="e.g. 14.5" maxlength="60" autocomplete="off" oninput="updateQlabFireBtn()">
        </div>
        <div class="cc-qlab-action-field">
          <label class="field-lbl">Action</label>
          <select class="field-in" id="cc-qlab-action" onchange="updateQlabFireBtn()">${opts}</select>
        </div>
      </div>
      <label class="cc-check cc-qlab-auto"><input type="checkbox" id="cc-qlab-auto" ${auto}> Auto-fire when this row advances live</label>
      <div class="cc-qlab-actions">
        <button type="button" class="cc-qlab-fire" id="cc-qlab-fire" onclick="fireQlabFromModal()">${sfIcon('action.forward')} Fire in QLab now</button>
      </div>
    </div>`;
}

// Keep the "Fire now" button disabled until there's a valid target.
function updateQlabFireBtn() {
  const btn = document.getElementById('cc-qlab-fire');
  if (!btn) return;
  const cue = (document.getElementById('cc-qlab-cue')?.value || '').trim();
  const action = document.getElementById('cc-qlab-action')?.value || 'start';
  btn.disabled = qlabCueRequiresNumber(action) && !cue;
}

// Core writer: push a fire command to Firestore for the agent. cues is an array
// of { cue, action } so a single row can batch several QLab actions in one write
// (avoids a race where rapid overwrites drop commands).
function fireQlabCommand(cues) {
  const list = (cues || [])
    .map(c => ({ cue: String(c.cue || '').trim(), action: c.action || 'start' }))
    .filter(c => c.cue || !qlabCueRequiresNumber(c.action));
  if (!list.length) return false;
  if (!(window._firebaseReady && session.code && !session.isDemo)) {
    toast('QLab needs a live (non-demo) session.');
    return false;
  }
  const command = {
    commandId: nextQlabCommandId(),
    ts: Date.now(),
    by: session.userName || '',
    sender: FLOWMINGO_ENDPOINT_ID,
    cues: list,
  };
  window._updateDoc(window._doc(window._db, 'sessions', session.code), {
    'qlab.command': command,
  }).catch(err => toast(firebaseConnectionLabel(err, 'QLab command failed')));
  return true;
}

// Manual GO from the cue-config modal — also doubles as a test trigger.
function fireQlabFromModal() {
  const cue = (document.getElementById('cc-qlab-cue')?.value || '').trim();
  const action = document.getElementById('cc-qlab-action')?.value || 'start';
  if (qlabCueRequiresNumber(action) && !cue) { toast('Enter a QLab cue number first.'); return; }
  if (fireQlabCommand([{ cue, action }])) {
    if (!qlabAgentOnline()) toast('Sent — but the QLab Agent looks offline.');
  }
}

// Collect every auto-fire QLab target programmed on a row.
function collectAutoQlabCues(beat) {
  if (!beat || !beat.cues) return [];
  const out = [];
  for (const type of COL_DEFAULTS) {
    const d = beat.cues[type];
    if (!d || !d.qlabAuto) continue;
    const cue = String(d.qlabCue || '').trim();
    const action = d.qlabAction || 'start';
    if (cue || !qlabCueRequiresNumber(action)) out.push({ cue, action });
  }
  return out;
}

// Fire a row's auto-cues. Called only from lsNext (a deliberate forward advance);
// scrubbing/jumping/going back never auto-fires, matching show-control norms.
function fireQlabAutoForBeat(beat) {
  const cues = collectAutoQlabCues(beat);
  if (cues.length) fireQlabCommand(cues);
}

// Does this cue cell have a QLab target worth showing a GO button for?
function qlabCellHasTarget(d) {
  return !!d && (String(d.qlabCue || '').trim() || d.qlabAction === 'go');
}

// Manual GO straight from a live cue card — fire one cell's QLab action.
function fireQlabCueCell(beatId, type) {
  const d = beats.find(x => x.id === beatId)?.cues?.[type];
  if (!qlabCellHasTarget(d)) { toast('No QLab cue on this cell.'); return; }
  const cue = String(d.qlabCue || '').trim();
  const action = d.qlabAction || 'start';
  if (fireQlabCommand([{ cue, action }])) {
    const what = action === 'start' ? `cue ${cue}` : (action === 'go' ? 'GO' : `${action} cue ${cue}`);
    toast(qlabAgentOnline() ? `QLab: ${what} sent.` : `QLab Agent offline — ${what} not delivered.`);
  }
}

// GO button markup for a live cue card (only when the cell has a QLab target).
function qlabGoBtnHTML(beatId, type, d) {
  if (!qlabCellHasTarget(d)) return '';
  const action = d.qlabAction || 'start';
  const label = (action === 'start' || action === 'go') ? 'GO' : action.toUpperCase();
  const tip = action === 'go' ? 'Fire QLab GO (playhead)' : `Fire QLab ${action} · cue ${esc(d.qlabCue || '')}`;
  return `<button type="button" class="lf-qlab-go" title="${tip}" onclick="event.stopPropagation();fireQlabCueCell('${beatId}','${type}')">${sfIcon('action.forward')} ${label}</button>`;
}

// ─────────────────────────────────────────────────────────────
// OUTRANGUTAN INTEGRATION (Cueola rundown ⇄ Outrangutan playback)
// A rundown `playback` cue can link to an Outrangutan cue. Firing it (manual GO
// or auto on live advance) writes sessions/<code>.outrangutan.command; the
// Outrangutan module (subscribed to the same session) plays it locally and
// publishes back sessions/<code>.outrangutan.{cues,live}, which we render into
// the cell. Mirrors the QLab transport: one command object, deduped by id.
// ─────────────────────────────────────────────────────────────
let outrangutanState = { cues: {}, pads: {}, live: null };
let _outCmdSeq = 0;
let _ogLiveStamp = 0;   // last applied live seq/ts — receivers drop stale out-of-order packets (P3)

// Snapshot → local state. Structural changes (the cue set) re-render the visible
// screen; live-status changes only patch the rundown badges IN PLACE — the live
// grid shows no continuous playout state, so it must never rebuild for one. (P3:
// this is what kept the "Questions" segment flashing at playout-publish rate.)
function applyOutrangutanState(og) {
  if (!og) return;
  let structural = false;
  // stableStringify: Firestore snapshot map-key order differs between local-echo
  // and server emissions — a plain JSON compare re-renders on identical data.
  if (og.cues && stableStringify(og.cues) !== stableStringify(outrangutanState.cues)) { outrangutanState.cues = og.cues; structural = true; }
  if (og.pads && stableStringify(og.pads) !== stableStringify(outrangutanState.pads || {})) { outrangutanState.pads = og.pads; }   // P4: pad summary (feeds the cue modal only — no re-render)
  if (og.sfxFire) applySfxFireEvent(og.sfxFire);   // P4: transient follower chip
  if (og.live) {
    // ts is the version stamp (monotonic per sender, survives publisher reloads);
    // seq breaks ties for writes landing in the same millisecond.
    const stamp = ((og.live.ts || 0) * 1000) + ((og.live.seq || 0) % 1000);
    if (!stamp || stamp >= _ogLiveStamp) {
      _ogLiveStamp = stamp;
      const prev = outrangutanState.live || {};
      const statusChanged = prev.cueId !== og.live.cueId || prev.status !== og.live.status;
      outrangutanState.live = og.live;
      if (statusChanged) logShow('media', 'Playout ' + (og.live.status || 'idle') + (og.live.name ? ' · ' + og.live.name : ''));
      if (statusChanged && !structural) refreshOutrangutanBadges();
    }
  }
  if (structural) {
    if (document.getElementById('rundown')?.classList.contains('on')) renderRundown();
    if (document.getElementById('liveshow')?.classList.contains('on')) renderLive();
  }
}

// P4: SFX fire → transient chip in the live overview (Decisions #7). Stale/dup
// events are dropped by ts+seq stamp, same scheme as outrangutan.live.
let _sfxFireStamp = 0, _sfxChipTimer = null;
function applySfxFireEvent(ev) {
  if (!ev || !ev.ts) return;
  const stamp = (ev.ts * 1000) + ((ev.seq || 0) % 1000);
  if (stamp <= _sfxFireStamp) return;
  const fresh = (Date.now() - ev.ts) < 10000;
  _sfxFireStamp = stamp;
  if (!fresh) return;   // old event replayed by a snapshot — record the stamp, show nothing
  logShow('sfx', 'SFX fired · ' + (ev.name || 'pad') + (ev.by ? ' (' + ev.by + ')' : ''));
  const chip = document.getElementById('ls-stat-sfx');
  if (!chip) return;
  chip.textContent = `${ev.emoji ? ev.emoji + ' ' : ''}SFX · ${ev.name || ''}`.trim();
  chip.hidden = false;
  clearTimeout(_sfxChipTimer);
  _sfxChipTimer = setTimeout(() => { chip.hidden = true; }, 2500);
}

// Patch every playback-cell badge in place — no table rebuild, no scroll loss.
function refreshOutrangutanBadges() {
  document.querySelectorAll('[data-outbadge]').forEach(el => {
    const beat = beats.find(b => String(b.id) === el.getAttribute('data-outbadge'));
    const html = outrangutanCellBadge(beat?.cues?.playback, beat?.id);
    if (!html) { el.remove(); return; }
    const tmp = document.createElement('div');
    tmp.innerHTML = html;
    if (tmp.firstElementChild) el.replaceWith(tmp.firstElementChild);
  });
}

function outrangutanFmtDur(sec) {
  sec = Math.max(0, Math.round(sec || 0));
  return Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0');
}

// <select> options of the Outrangutan cues published into this session.
function outrangutanCueOptions(cur) {
  const map = outrangutanState.cues || {};
  const ids = Object.keys(map).sort((a, b) => (map[a].num || 0) - (map[b].num || 0));
  let html = `<option value="">— none —</option>`;
  for (const id of ids) html += `<option value="${esc(id)}" ${cur === id ? 'selected' : ''}>#${esc(String(map[id].num ?? ''))} ${esc(map[id].name || 'Cue')}</option>`;
  if (cur && !map[cur]) html += `<option value="${esc(cur)}" selected>Linked cue (offline)</option>`;
  return html;
}

// <select> options of the Outrangutan SFX pads published into this session (P4).
function outrangutanPadOptions(cur) {
  const map = outrangutanState.pads || {};
  const ids = Object.keys(map).sort((a, b) => (map[a].bank + map[a].name).localeCompare(map[b].bank + map[b].name));
  let html = `<option value="">— none —</option>`;
  ids.forEach(id => {
    const p = map[id];
    html += `<option value="${esc(id)}"${cur === id ? ' selected' : ''}>${esc((p.emoji ? p.emoji + ' ' : '') + p.name + (p.bank ? ' · ' + p.bank : ''))}</option>`;
  });
  if (cur && !map[cur]) html += `<option value="${esc(cur)}" selected>Linked pad (offline)</option>`;
  return html;
}

// Optional Outrangutan link block — playback cells get cue + SFX links; audio
// cells get the SFX link (P4: rundown items cue SFX through the same cue flow).
function outrangutanCueFields(type, d) {
  if (type !== 'playback' && type !== 'audio') return '';
  d = d || {};
  const emptyCues = !Object.keys(outrangutanState.cues || {}).length;
  const emptyPads = !Object.keys(outrangutanState.pads || {}).length;
  const cuePart = type !== 'playback' ? '' : `
      <div class="cc-qlab-row">
        <div class="cc-qlab-cue-field" style="flex:1">
          <label class="field-lbl">Link to an Outrangutan cue</label>
          <select class="field-in" id="cc-out-cue">${outrangutanCueOptions(d.outCueId || '')}</select>
          ${emptyCues ? `<div class="cc-out-hint">Open Outrangutan in this session to list its cues.</div>` : ''}
        </div>
      </div>
      <label class="cc-check cc-qlab-auto"><input type="checkbox" id="cc-out-auto" ${d.outAuto ? 'checked' : ''}> Auto-fire when this row advances live</label>`;
  const sfxPart = `
      <div class="cc-qlab-row">
        <div class="cc-qlab-cue-field" style="flex:1">
          <label class="field-lbl">SFX pad</label>
          <select class="field-in" id="cc-out-pad">${outrangutanPadOptions(d.outPadId || '')}</select>
          ${emptyPads ? `<div class="cc-out-hint">Assign pads on Outrangutan's SFX board to list them here.</div>` : ''}
        </div>
      </div>
      <label class="cc-check cc-qlab-auto"><input type="checkbox" id="cc-out-pad-auto" ${d.outPadAuto ? 'checked' : ''}> Auto-fire SFX when this row advances live</label>`;
  return `
    <div class="field cc-qlab cc-outrangutan">
      <div class="cc-section-lbl cc-qlab-head"><span class="cc-out-glyph"><svg class="brand-ico"><use href="#ic-outrangutan"/></svg></span> Outrangutan ${type === 'playback' ? 'playback' : 'SFX'} <span class="cc-qlab-optional">— optional</span></div>
      ${cuePart}
      ${sfxPart}
      <div class="cc-qlab-actions">
        ${type === 'playback' ? `<button type="button" class="cc-qlab-fire" id="cc-out-fire" onclick="fireOutrangutanFromModal()"><span class="cc-out-glyph"><svg class="brand-ico"><use href="#ic-outrangutan"/></svg></span> Fire in Outrangutan now</button>` : ''}
        <button type="button" class="cc-qlab-fire" id="cc-out-fire-sfx" onclick="fireOutrangutanSfxFromModal()"><span class="cc-out-glyph"><svg class="brand-ico"><use href="#ic-outrangutan"/></svg></span> Fire SFX now</button>
      </div>
    </div>`;
}

// Core writer: push a fire command to the session doc for Outrangutan to consume.
// P4 fast path: when Outrangutan runs in THIS tab on the same session (the
// one-operator setup), fire it directly — <30 ms trigger-to-sound, no network.
function fireOutrangutanCommand(action, targetId) {
  const local = window.Outrangutan && window.Outrangutan._local;
  if (local && session.code && local.session() === session.code) {
    if (action === 'pad' && local.firePad(targetId)) return true;
    if (action === 'cue' && local.fireCue(targetId)) return true;
  }
  if (!(window._firebaseReady && session.code && !session.isDemo)) { toast('Outrangutan needs a live (non-demo) session.'); return false; }
  _outCmdSeq += 1;
  const command = {
    commandId: `out_${CLIENT_ID}_${Date.now().toString(36)}_${_outCmdSeq}`,
    ts: Date.now(), by: session.userName || '', sender: FLOWMINGO_ENDPOINT_ID,
    action: action || 'cue', cueId: action === 'pad' ? '' : (targetId || ''), padId: action === 'pad' ? (targetId || '') : '',
  };
  logShow(action === 'pad' ? 'sfx' : 'cue', 'Outrangutan command → ' + action + (targetId ? ' · ' + outrangutanTargetName(action, targetId) : ''));
  window._updateDoc(window._doc(window._db, 'sessions', session.code), { 'outrangutan.command': command })
    .catch(err => { logShow('error', 'Outrangutan command failed to send (' + (err?.code || 'network') + ')'); toast(firebaseConnectionLabel(err, 'Outrangutan command failed')); });
  return true;
}
// P7: resolve a cue/pad id to its published name for the show log.
function outrangutanTargetName(action, id) {
  const m = action === 'pad' ? (outrangutanState.pads || {})[id] : (outrangutanState.cues || {})[id];
  return m?.name || id;
}

function fireOutrangutanFromModal() {
  const outCue = document.getElementById('cc-out-cue')?.value || '';
  if (!outCue) { toast('Link an Outrangutan cue first.'); return; }
  if (fireOutrangutanCommand('cue', outCue)) toast('Outrangutan: GO sent.');
}

function fireOutrangutanSfxFromModal() {
  const outPad = document.getElementById('cc-out-pad')?.value || '';
  if (!outPad) { toast('Link an SFX pad first.'); return; }
  if (fireOutrangutanCommand('pad', outPad)) toast('Outrangutan: SFX sent.');
}

// P5: playout transport from the live-screen keymap — same-tab fast path first,
// session-doc command otherwise. Actions: go / pause / stop / fadeStop / panic.
function fireOutrangutanTransport(action) {
  const local = window.Outrangutan && window.Outrangutan._local;
  if (local && local.transport && session.code && local.session() === session.code && local.transport(action)) {
    toast(`Playout: ${action === 'fadeStop' ? 'fade-stop' : action === 'panic' ? 'PANIC' : action.toUpperCase()}.`);
    return true;
  }
  return fireOutrangutanCommand(action, '');
}

// Manual SFX trigger on a live row (P4, Decisions #6: manual + optional auto).
function fireOutrangutanSfxCell(beatId, type) {
  const b = beats.find(x => x.id === beatId);
  const d = b?.cues?.[type];
  if (!d || !d.outPadId) { toast('No SFX pad linked.'); return; }
  if (fireOutrangutanCommand('pad', d.outPadId)) toast('SFX sent.');
}

function outrangutanCellLinked(d) { return !!(d && d.outCueId); }

// Small SFX chip on rundown cells that link a pad (P4) — name only, no live state.
function outrangutanSfxBadge(d) {
  if (!d || !d.outPadId) return '';
  const p = (outrangutanState.pads || {})[d.outPadId];
  const label = p ? `${p.emoji ? p.emoji + ' ' : ''}${p.name}` : 'Linked SFX';
  return `<div class="cue-out-badge cue-sfx-badge"><svg class="brand-ico"><use href="#ic-outrangutan"/></svg> <span class="cue-out-name">SFX · ${esc(label)}</span>${d.outPadAuto ? '<span class="cue-out-live cue-out-auto">AUTO</span>' : ''}</div>`;
}

// Manual SFX trigger button for the live focus view (P4).
function outrangutanSfxGoBtnHTML(beatId, type, d) {
  if (!d || !d.outPadId) return '';
  return `<button type="button" class="lf-qlab-go lf-out-go lf-sfx-go" title="Fire the linked SFX pad" onclick="event.stopPropagation();fireOutrangutanSfxCell('${beatId}','${type}')"><span class="cc-out-glyph"><svg class="brand-ico"><use href="#ic-outrangutan"/></svg></span> SFX</button>`;
}

// Manual GO from a live cue card.
function fireOutrangutanCueCell(beatId) {
  const d = beats.find(x => x.id === beatId)?.cues?.playback;
  if (!outrangutanCellLinked(d)) { toast('No Outrangutan cue linked.'); return; }
  if (fireOutrangutanCommand('cue', d.outCueId)) toast('Outrangutan: GO sent.');
}

// GO button for a live cue card (playback cells linked to an Outrangutan cue).
function outrangutanGoBtnHTML(beatId, d) {
  if (!outrangutanCellLinked(d)) return '';
  return `<button type="button" class="lf-qlab-go lf-out-go" title="Fire the linked Outrangutan cue" onclick="event.stopPropagation();fireOutrangutanCueCell('${beatId}')"><span class="cc-out-glyph"><svg class="brand-ico"><use href="#ic-outrangutan"/></svg></span> GO</button>`;
}

// Auto-fire linked Outrangutan cues/SFX when a row advances live (lsNext only).
function fireOutrangutanAutoForBeat(beat) {
  const d = beat?.cues?.playback;
  if (d && d.outAuto && d.outCueId) fireOutrangutanCommand('cue', d.outCueId);
  // P4: SFX auto-fire (playback + audio cells; Decisions #6)
  ['playback', 'audio'].forEach(t => {
    const c = beat?.cues?.[t];
    if (c && c.outPadAuto && c.outPadId) fireOutrangutanCommand('pad', c.outPadId);
  });
}

// Rundown playback-cell badge: linked cue name/dur + live status (auto-populate).
// Carries data-outbadge=<beatId> so live-status flaps can patch it in place (P3).
function outrangutanCellBadge(d, beatId) {
  if (!outrangutanCellLinked(d)) return '';
  const id = d.outCueId, c = (outrangutanState.cues || {})[id], live = outrangutanState.live;
  const name = c ? c.name : 'Linked cue';
  const dur = c && c.dur ? ` · ${outrangutanFmtDur(c.dur)}` : '';
  const isLive = live && live.cueId === id && live.status && live.status !== 'idle';
  const label = isLive ? (live.status === 'play' ? 'ON AIR' : live.status === 'pre' ? 'PRE' : live.status === 'pause' ? 'PAUSE' : '') : '';
  const status = isLive ? `<span class="cue-out-live cue-out-${live.status}">${label}</span>` : '';
  return `<div class="cue-out-badge"${beatId != null ? ` data-outbadge="${esc(String(beatId))}"` : ''}><svg class="brand-ico"><use href="#ic-outrangutan"/></svg> <span class="cue-out-name">${esc(name)}</span>${dur}${status}</div>`;
}


// Script file upload (txt + pdf)
async function loadScriptFile(input, targetId) {
  const file = input.files[0]; if (!file) return;
  const target = document.getElementById(targetId||'cc-s-text');
  if (file.name.toLowerCase().endsWith('.pdf') && window.pdfjsLib) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.4.120/pdf.worker.min.js';
    try {
      const ab = await file.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({data:ab}).promise;
      let text = '';
      for (let i=1;i<=pdf.numPages;i++) {
        const page = await pdf.getPage(i);
        const content = await page.getTextContent();
        let lastY = null;
        content.items.forEach(item => {
          if (lastY!==null && Math.abs(item.transform[5]-lastY)>5) text+='\n';
          text += item.str+' ';
          lastY = item.transform[5];
        });
        if (i<pdf.numPages) text+='\n\n';
      }
      if (target) target.value = text.trim();
    } catch { toast('PDF read failed — try a .txt file'); }
    return;
  }
  const reader = new FileReader();
  reader.onload = e => { if (target) target.value = e.target.result; };
  reader.readAsText(file);
}

// loadScriptFile defined above (async, supports PDF)

// ─────────────────────────────────────────────────────────────
// EDIT
// ─────────────────────────────────────────────────────────────
function openEdit(id) {
  const b = beats.find(x=>x.id===id); if (!b) return;
  editId = id;
  editStyle = b.style||'flex';
  document.getElementById('editTitle').textContent = b.style === 'segment' ? 'Edit Segment Marker' : 'Edit Row';
  let h;
  if (b.style === 'segment') {
    h = `
      <div class="field"><label class="field-lbl">Section Label</label><input class="field-in" id="ed-info" value="${esc(b.info||'')}" maxlength="80" placeholder="e.g. Act 1, Opening Block, Break"></div>
      <div class="field"><label class="field-lbl">Notes <span style="color:var(--text3)">(optional)</span></label><input class="field-in" id="ed-notes" value="${esc(b.notes||'')}" maxlength="120"></div>`;
  } else {
    h = `
      <div class="field"><label class="field-lbl">Name</label><input class="field-in" id="ed-info" value="${esc(b.info||'')}" maxlength="80"></div>
      <div class="field"><label class="field-lbl">Notes</label><input class="field-in" id="ed-notes" value="${esc(b.notes||'')}" maxlength="120"></div>
      <div class="field"><label class="field-lbl">Duration</label>
        <div style="display:grid;grid-template-columns:1fr auto 1fr;gap:6px;align-items:center">
          <input class="field-in" id="ed-min" type="number" min="0" max="180" value="${b.min||0}" style="text-align:center;font-family:var(--mono)">
          <div style="font-family:var(--mono);color:var(--text3);text-align:center">:</div>
          <input class="field-in" id="ed-sec" type="number" min="0" max="59" value="${b.sec||0}" style="text-align:center;font-family:var(--mono)">
        </div></div>
      <div class="field"><label class="field-lbl">Style</label>
        <div class="chip-grid">
          <button class="chip ${editStyle==='timed'?'sel':''}" id="ed-s-timed" onclick="edSetStyle('timed',this)">${sfIcon('state.timed')} Timed</button>
          <button class="chip ${editStyle==='flex'?'sel':''}" id="ed-s-flex" onclick="edSetStyle('flex',this)">${sfIcon('state.flex')} Flex</button>
        </div></div>`;
  }
  document.getElementById('editFields').innerHTML = h;
  showOverlay('editOv');
  setRundownPresence(id);
}

function edSetStyle(s, el) {
  editStyle = s;
  document.querySelectorAll('#editFields .chip').forEach(c=>c.classList.remove('sel'));
  el.classList.add('sel');
}

function closeEdit(e) {
  if (e && e.target!==document.getElementById('editOv')) return;
  hideOverlay('editOv');
  setRundownPresence(null);
}

function saveEdit() {
  const b = beats.find(x=>x.id===editId); if (!b) return;
  b.info  = document.getElementById('ed-info').value.trim()||b.info;
  b.notes = document.getElementById('ed-notes').value.trim();
  if (b.style !== 'segment') {
    b.min = parseInt(document.getElementById('ed-min')?.value)||0;
    b.sec = parseInt(document.getElementById('ed-sec')?.value)||0;
    if (editStyle && editStyle !== 'segment') b.style = editStyle;
  }
  hideOverlay('editOv');
  setRundownPresence(null);
  renderRundown(); syncToFirestore(); toast('Saved.');
}

function v(id) { return document.getElementById(id)?.value?.trim()||''; }

function deleteCue() {
  if (!dangerConfirm(`Remove ${rowConfirmLabel(editId)}?`, 'This removes the entire row and all cue cells in it. In a shared session, the removal syncs to collaborators.')) return;
  beats = beats.filter(b=>b.id!==editId);
  hideOverlay('editOv');
  setRundownPresence(null);
  renderRundown(); syncToFirestore(); toast('Row removed.');
}

// ─────────────────────────────────────────────────────────────
// LIVE SHOW
// ─────────────────────────────────────────────────────────────
// Pre-Live Check — derives a snapshot of show readiness so the Go Live
// confirmation can tell the user exactly what's set and what isn't.
function preLiveCheck() {
  const cuesWithScript = beats.filter(b => b?.cues?.script?.text?.trim()).length;
  const totalRows = beats.length;
  const scriptOk = totalRows > 0 && cuesWithScript > 0;
  const scriptLabel = !totalRows
    ? 'No rows in the rundown'
    : !cuesWithScript
      ? `${totalRows} row${totalRows===1?'':'s'} but no script cues yet`
      : `${cuesWithScript} of ${totalRows} row${totalRows===1?'':'s'} have script`;

  const talentSeenMs = lastTalentPingTs ? Date.now() - lastTalentPingTs : Infinity;
  const talentOk = talentSeenMs < 14000;
  const talentLabel = !lastTalentPingTs
    ? 'Talent prompter hasn’t opened yet'
    : talentOk
      ? `Connected · last seen ${Math.max(0, Math.floor(talentSeenMs/1000))}s ago`
      : `Hasn’t responded for ${Math.floor(talentSeenMs/1000)}s`;

  const isDemo = !!session.isDemo;
  const cloudReady = !!(window._firebaseReady && session.code && !isDemo);
  const cloudOk = isDemo || cloudReady;
  const cloudLabel = isDemo
    ? 'Demo mode · same-browser sync only'
    : !session.code
      ? 'No session code — cross-device sync off'
      : cloudReady
        ? `Syncing · ${session.code}`
        : 'Cloud not connected';

  return {
    script: { ok: scriptOk, label: scriptLabel },
    talent: { ok: talentOk, label: talentLabel },
    cloud:  { ok: cloudOk,  label: cloudLabel  },
    allGreen: scriptOk && talentOk && cloudOk,
  };
}

// ─────────────────────────────────────────────────────────────
// P7: SHOW PREFLIGHT — one panel, run before going live (or any time from
// Settings), that validates the whole show: script/talent/cloud (the original
// pre-live rows), every rundown→Outrangutan link, the playout media library
// (exists + decodable + known dimensions, same-tab deep check), SFX banks,
// a real cloud write→server-ack round-trip, and theme/brand assets. Failing
// rows link straight to the rundown row that needs fixing.
// ─────────────────────────────────────────────────────────────
let _preflightRows = [];
let _preflightRun = 0;
let _preflightReviewOnly = false;

function preflightIcon(state) { return state === 'ok' ? '✓' : state === 'fail' ? '✕' : state === 'pend' ? '…' : '!'; }
function renderPreflightRows() {
  const container = document.getElementById('goLiveCheckRows');
  if (container) {
    container.innerHTML = _preflightRows.map(r => `
      <div class="precheck-row ${r.state}">
        <div class="precheck-icon">${preflightIcon(r.state)}</div>
        <div class="precheck-body">
          <div class="precheck-label">${esc(r.key)}</div>
          <div class="precheck-detail">${esc(r.detail)}</div>
        </div>
        ${r.jump != null ? `<button type="button" class="precheck-jump" onclick="preflightJump(${Number(r.jump)})">Row ${Number(r.jumpRow) || ''} →</button>` : ''}
      </div>`).join('');
  }
  const pending = _preflightRows.some(r => r.state === 'pend');
  const fails = _preflightRows.filter(r => r.state === 'fail').length;
  const warns = _preflightRows.filter(r => r.state === 'warn').length;
  const goBtn = document.getElementById('goLiveCheckGo');
  if (goBtn) goBtn.textContent = _preflightReviewOnly ? 'Done' : (fails || warns ? 'Continue Anyway' : 'Go Live');
  const note = document.getElementById('goLiveCheckNote');
  if (note) note.textContent = pending ? 'Running preflight checks…'
    : fails ? fails + ' check' + (fails === 1 ? '' : 's') + ' failed — jump to the item to fix it before going live.'
    : warns ? 'A couple of things aren\'t set yet — review before going live.'
    : 'Every check passed. You\'re clear to go live.';
  const title = document.getElementById('goLiveCheckTitle');
  if (title) title.textContent = _preflightReviewOnly ? 'Show preflight' : 'Ready to go live?';
  return { pending, fails, warns };
}
function setPreflightRow(key, patch) {
  const r = _preflightRows.find(x => x.key === key);
  if (r) Object.assign(r, patch);
}
function addPreflightRow(row) { _preflightRows.push(row); }
function removePreflightRow(key) { _preflightRows = _preflightRows.filter(r => r.key !== key); }

// Every rundown cell that points at an Outrangutan cue or SFX pad.
function collectPlayoutLinks() {
  const cues = [], pads = [];
  beats.forEach((b, i) => {
    const pb = b?.cues?.playback, au = b?.cues?.audio;
    if (pb?.outCueId) cues.push({ beatId: b.id, row: i + 1, id: pb.outCueId });
    [pb, au].forEach(d => { if (d?.outPadId) pads.push({ beatId: b.id, row: i + 1, id: d.outPadId }); });
  });
  return { cues, pads };
}

function confirmGoLive() { runPreflight(false); }
function openPreflightPanel() { runPreflight(true); }

function runPreflight(reviewOnly) {
  const c = preLiveCheck();
  const run = ++_preflightRun;
  _preflightReviewOnly = !!reviewOnly;
  _preflightRows = [
    { key: 'Script',          state: c.script.ok ? 'ok' : 'warn', detail: c.script.label },
    { key: 'Talent prompter', state: c.talent.ok ? 'ok' : 'warn', detail: c.talent.label },
    { key: 'Cloud sync',      state: c.cloud.ok  ? 'ok' : 'warn', detail: c.cloud.label },
  ];
  const links = collectPlayoutLinks();
  if (links.cues.length || links.pads.length) addPreflightRow({ key: 'Playout links', state: 'pend', detail: 'Checking ' + (links.cues.length + links.pads.length) + ' linked cue/pad reference' + (links.cues.length + links.pads.length === 1 ? '' : 's') + '…' });
  addPreflightRow({ key: 'Playout media', state: 'pend', detail: 'Checking the Outrangutan library…' });
  addPreflightRow({ key: 'SFX banks', state: 'pend', detail: 'Checking pads…' });
  if (window._firebaseReady && session.code && !session.isDemo && !session.isExpert) {
    addPreflightRow({ key: 'Cloud round-trip', state: 'pend', detail: 'Writing a ping and waiting for the server echo…' });
  }
  addPreflightRow({ key: 'Theme & brand assets', state: 'pend', detail: 'Checking…' });
  renderPreflightRows();
  showOverlay('goLiveCheckOv');
  runPreflightAsync(run, links).catch(err => containError('Preflight', err));
}

async function runPreflightAsync(run, links) {
  // 1) Deep-check the Outrangutan library when it shares this tab.
  let deep = null;
  try { deep = window.Outrangutan?.preflight ? await window.Outrangutan.preflight() : null; } catch (e) { deep = null; }
  if (run !== _preflightRun) return;
  const pubCues = outrangutanState.cues || {}, pubPads = outrangutanState.pads || {};
  const hasLocal = !!(deep && (deep.cues.length || deep.pads.length));
  const hasRemote = !!(Object.keys(pubCues).length || Object.keys(pubPads).length);

  // Playout links — every rundown reference must resolve somewhere real.
  if (links.cues.length || links.pads.length) {
    const cueMap = deep ? Object.fromEntries(deep.cues.map(x => [x.id, x])) : {};
    const padMap = deep ? Object.fromEntries(deep.pads.map(x => [x.id, x])) : {};
    const bad = [];
    links.cues.forEach(l => {
      const local = cueMap[l.id];
      if (local && !local.ok) bad.push({ ...l, why: '“' + local.name + '” — ' + local.issue });
      else if (!local && !pubCues[l.id]) bad.push({ ...l, why: 'linked playout cue not found' });
    });
    links.pads.forEach(l => {
      const local = padMap[l.id];
      if (local && !local.ok) bad.push({ ...l, why: 'SFX “' + local.name + '” — ' + local.issue });
      else if (!local && !pubPads[l.id]) bad.push({ ...l, why: 'linked SFX pad not found' });
    });
    if (!bad.length) setPreflightRow('Playout links', { state: 'ok', detail: (links.cues.length + links.pads.length) + ' link' + (links.cues.length + links.pads.length === 1 ? '' : 's') + ' verified' });
    else {
      // Replace the pending row in place so failures sit where the check ran.
      const at = _preflightRows.findIndex(r => r.key === 'Playout links');
      const failRows = bad.map(b => ({ key: 'Playout link · row ' + b.row, state: 'fail', detail: b.why, jump: b.beatId, jumpRow: b.row }));
      if (at >= 0) _preflightRows.splice(at, 1, ...failRows);
      else failRows.forEach(addPreflightRow);
    }
  }

  // Playout media — exists on this machine, decodable, known dimensions.
  if (hasLocal) {
    const media = deep.cues.filter(c => c.checked);
    const badMedia = media.filter(c => !c.ok);
    if (!badMedia.length) setPreflightRow('Playout media', { state: 'ok', detail: media.length + ' cue' + (media.length === 1 ? '' : 's') + ' present & decodable, dimensions known' });
    else setPreflightRow('Playout media', { state: 'fail', detail: badMedia.slice(0, 3).map(c => '#' + c.num + ' “' + c.name + '” — ' + c.issue).join(' · ') + (badMedia.length > 3 ? ' · +' + (badMedia.length - 3) + ' more' : '') });
  } else if (hasRemote) {
    setPreflightRow('Playout media', { state: 'warn', detail: 'Outrangutan runs on another machine — run its preflight there for the media deep-check' });
  } else {
    setPreflightRow('Playout media', { state: 'ok', detail: 'No playout in this show' });
  }

  // SFX banks — every pad's media loads; empty banks flagged.
  if (hasLocal) {
    const badPads = deep.pads.filter(p => !p.ok);
    const emptyBanks = deep.banks.filter(b => !b.padCount);
    if (badPads.length) setPreflightRow('SFX banks', { state: 'fail', detail: badPads.slice(0, 3).map(p => '“' + p.name + '” (' + p.bank + ') — ' + p.issue).join(' · ') + (badPads.length > 3 ? ' · +' + (badPads.length - 3) + ' more' : '') });
    else if (!deep.pads.length) setPreflightRow('SFX banks', { state: 'ok', detail: 'No SFX pads in this show' });
    else setPreflightRow('SFX banks', { state: emptyBanks.length ? 'warn' : 'ok', detail: deep.pads.length + ' pad' + (deep.pads.length === 1 ? '' : 's') + ' load & decode' + (emptyBanks.length ? ' · empty bank: ' + emptyBanks.map(b => '“' + b.name + '”').join(', ') : '') });
  } else if (Object.keys(pubPads).length) {
    setPreflightRow('SFX banks', { state: 'ok', detail: Object.keys(pubPads).length + ' pads published from the playout machine' });
  } else {
    setPreflightRow('SFX banks', { state: 'ok', detail: 'No SFX pads in this show' });
  }
  renderPreflightRows();

  // 2) Cloud round-trip — a real write acknowledged by the server, timed.
  if (_preflightRows.some(r => r.key === 'Cloud round-trip')) {
    const rtt = await preflightCloudRoundTrip();
    if (run !== _preflightRun) return;
    if (rtt >= 0) setPreflightRow('Cloud round-trip', { state: rtt < 2500 ? 'ok' : 'warn', detail: 'Write → server ack in ' + rtt + ' ms' });
    else setPreflightRow('Cloud round-trip', { state: 'fail', detail: rtt === -1 ? 'Write failed — check the connection' : 'No server echo within 8 s — sync may be degraded' });
    renderPreflightRows();
  }

  // 3) Theme & brand assets.
  const themes = await preflightThemeAssets();
  if (run !== _preflightRun) return;
  setPreflightRow('Theme & brand assets', themes);
  const { fails, warns } = renderPreflightRows();
  logShow('preflight', 'Preflight finished — ' + fails + ' fail · ' + warns + ' warn · ' + _preflightRows.filter(r => r.state === 'ok').length + ' ok');
}

function preflightCloudRoundTrip() {
  return new Promise(resolve => {
    if (!(window._firebaseReady && session.code && !session.isDemo && !session.isExpert)) return resolve(-1);
    let done = false, unsub = null;
    const t0 = Date.now();
    const token = 'pf_' + CLIENT_ID + '_' + t0.toString(36);
    const finish = v => { if (done) return; done = true; try { unsub && unsub(); } catch {} resolve(v); };
    try {
      const ref = window._doc(window._db, 'sessions', session.code);
      // includeMetadataChanges: the server ack arrives as a metadata-only
      // transition (hasPendingWrites → false) that default snapshots skip.
      unsub = window._onSnapshot(ref, { includeMetadataChanges: true }, snap => {
        const p = snap.data()?.preflightPing;
        if (p?.token === token && !snap.metadata.hasPendingWrites) finish(Date.now() - t0);
      });
      window._updateDoc(ref, { preflightPing: { token, ts: t0 } }).catch(() => finish(-1));
      setTimeout(() => finish(-2), 8000);
    } catch (e) { finish(-1); }
  });
}

async function preflightThemeAssets() {
  const notes = [];
  ['ic-cueola', 'ic-plandabear', 'ic-flowmingo', 'ic-outrangutan'].forEach(id => {
    if (!document.getElementById(id)) notes.push('brand sprite #' + id + ' missing');
  });
  if (!getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()) notes.push('theme tokens not resolving');
  let svgWarn = '';
  try {
    const r = await fetch('assets/Brand/Cueola_Icon.svg', { method: 'HEAD', cache: 'no-store' });
    if (!r.ok) notes.push('brand SVG returned ' + r.status);
  } catch (e) { svgWarn = 'brand SVG unreachable (offline?) — in-page sprite still renders'; }
  if (notes.length) return { state: 'fail', detail: notes.join(' · ') };
  if (svgWarn) return { state: 'warn', detail: svgWarn };
  return { state: 'ok', detail: 'Theme “' + currentTheme + '” tokens live · brand sprite + SVG present' };
}

// Jump from a failing preflight row straight to the rundown row it points at.
function preflightJump(beatId) {
  hideOverlay('goLiveCheckOv');
  if (!document.getElementById('rundown')?.classList.contains('on')) { showRundown(); renderRundown(); }
  setTimeout(() => {   // let the screen swap paint first (not rAF — headless previews starve it)
    const row = document.querySelector(`#rdBody tr[data-id="${beatId}"]`) || document.querySelector(`tr[data-id="${beatId}"]`);
    if (!row) { toast('Row not found — it may have been deleted.'); return; }
    row.scrollIntoView({ block: 'center', behavior: 'smooth' });
    row.classList.add('preflight-hit');
    setTimeout(() => row.classList.remove('preflight-hit'), 2600);
  }, 60);
}

function confirmedGoLive() {
  hideOverlay('goLiveCheckOv');
  if (_preflightReviewOnly) return;
  goLive();
}

function goLive() {
  if (lsIdx<0) lsIdx=0;
  // skip past any leading segment markers so lsIdx starts on a real cue
  while (lsIdx < beats.length && beats[lsIdx]?.style === 'segment') lsIdx++;
  if (lsIdx >= beats.length) lsIdx = Math.max(0, beats.length - 1);
  document.getElementById('rundown').classList.remove('on');
  document.getElementById('liveshow').classList.add('on');
  document.getElementById('liveshow').classList.toggle('prompt-op-active', promptOpMode);
  _lastLiveScrollIdx = null;
  document.getElementById('tabLive').classList.add('on');
  document.getElementById('tabBuild').classList.remove('on');
  sessionStorage.setItem('cueola_screen','live');
  pushSessionHistoryState('live');
  logShow('session', 'Went live · row ' + (lsIdx + 1) + rowLogLabel(beats[lsIdx]));
  markResumeState();
  buildPromptFromRundown();
  initPrompter();
  sendToPrompter(true);
  renderLive();
  syncLiveIdx();
  resumeRemoteClockIfRunning();  // late joiner picks up a clock already running
  updateLiveClockButton();
  const timerEl = document.getElementById('ls-timer');
  if (timerEl) timerEl.textContent = fmtProductionClock(elapsedSecs * 1000);
  updateWallClock();
}

function showRundown() {
  document.getElementById('liveshow').classList.remove('on');
  document.getElementById('liveshow').classList.remove('prompt-op-active');
  document.getElementById('rundown').classList.add('on');
  document.getElementById('tabBuild').classList.add('on');
  document.getElementById('tabLive').classList.remove('on');
  sessionStorage.setItem('cueola_screen','build');
  pushSessionHistoryState('build');
  logShow('session', 'Left live → build screen');
  markResumeState();
  stopTimer();
  liveClockRunning = false;
  updateLiveClockButton();
}

function isFollowingSelf() {
  if (browsingSelf) return true;        // explicitly browsing on my own
  if (followTarget) return false;       // mirroring someone else
  return session.role !== 'student';    // instructors/experts drive their own position by default
}

// Admin Show Caller = following self AND has any admin session
function isAdminShowCaller() {
  return isFollowingSelf() && adminSession != null;
}

// Standard Show Caller = following self, instructor, NO admin session
function isStandardShowCaller() {
  return isFollowingSelf() && session.role === 'instructor' && !adminSession;
}

function requestExitLive() {
  showOverlay('exitLiveOv');
}

function confirmExitLive() {
  hideOverlay('exitLiveOv');
  followSelf();
  showRundown();
}

function offsetBeforeIndex(idx) {
  return beats.slice(0, Math.max(0, idx)).reduce((acc,b)=>acc+(b.min||0)*60+(b.sec||0),0);
}

function liveRemainingSecs() {
  return Math.max(totalSecs() - elapsedSecs, 0);
}

function liveRemainingMs() {
  const elapsedMs = liveTimerStartMs ? Date.now() - liveTimerStartMs : elapsedSecs * 1000;
  return Math.max(totalSecs() * 1000 - elapsedMs, 0);
}

function updateLiveClockButton() {
  const btn = document.getElementById('liveStartBtn');
  if (!btn) return;
  btn.textContent = liveClockRunning ? 'Pause Clock' : (elapsedSecs ? 'Resume Clock' : 'Start Show');
  btn.classList.toggle('running', liveClockRunning);
}

// Only the show caller (whoever is driving their own live position) controls the
// shared clock; followers mirror it. Keeps two people from fighting over start/pause.
function canDriveShowClock() {
  return isFollowingSelf();
}

function toggleShowClock() {
  if (!canDriveShowClock()) {
    toast('The show caller controls the clock for everyone.');
    return;
  }
  if (liveClockRunning) {
    stopTimer(false);
    liveClockRunning = false;
  } else {
    returnToOwnLivePosition();
    startTimer();
  }
  updateLiveClockButton();
  updateLiveOverview();
  broadcastShowClock();  // start/pause the clock for everyone in the session
}

// Restart the show from the top: stop the clock, zero the elapsed time, and jump
// back to the first row — so you can leave live, restart, and go live again to
// take it from the top. Syncs the reset to any followers.
function restartShowClock() {
  if (!dangerConfirm('Restart the show clock for this session?', 'This stops the clock, resets it to 0:00, jumps back to the first row, and broadcasts the reset to synced collaborators.', { requireText:'RESTART' })) return;
  stopTimer(false);
  liveClockRunning = false;
  elapsedSecs = 0;
  liveTimerStartMs = null;
  lsIdx = beats.length ? 0 : -1;
  // Same as goLive: never park the live position on a leading segment marker
  while (lsIdx >= 0 && lsIdx < beats.length && beats[lsIdx]?.style === 'segment') lsIdx++;
  if (lsIdx >= beats.length) lsIdx = beats.length ? beats.length - 1 : -1;
  const t = document.getElementById('ls-timer');
  if (t) { t.textContent = fmtProductionClock(0); t.classList.remove('warn'); }
  updateBotBar();
  updateLiveClockButton();
  updateLiveRemain();
  if (document.getElementById('liveshow')?.classList.contains('on')) { renderLive(); sendToPrompter(false); }
  syncLiveIdx();
  broadcastShowClock();  // reset everyone's clock to 0:00 / stopped
  closeAdminPanel();
  toast('Show restarted — clock at 0:00, back to the top.');
}

function getPrompterPayload(isInit=false) {
  const cur = beats[lsIdx] || null;
  const next = beats[lsIdx+1] || null;
  return {
    type: isInit ? 'script_init' : 'script_update',
    text: prompterText,
    version: prompterVersion,
    source: prompterSource,
    sessionCode: session.code,
    showName: show.name || 'Untitled Show',
    activeIdx: lsIdx,
    currentRow: cur ? { index:lsIdx, name:cur.info||'', notes:cur.notes||'', duration:fmtDur(cur) } : null,
    nextRow: next ? { index:lsIdx+1, name:next.info||'', duration:fmtDur(next) } : null,
    ts: Date.now()
  };
}

function cleanPrompterText(text) {
  // Keep the spacing the user typed: normalize line endings and strip stray
  // trailing whitespace, but never collapse intentional blank lines.
  return String(text || '')
    .replace(/\r\n?/g, '\n')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .trim();
}

function livePrompterEditor() {
  return document.getElementById('lsPrompterText');
}

function livePrompterEditorText() {
  const el = livePrompterEditor();
  if (!el) return '';
  return ('value' in el) ? el.value : (el.innerText || el.textContent || '');
}

function setLivePrompterEditorText(text, force=false) {
  const el = livePrompterEditor();
  if (!el) return;
  if (!force && (livePrompterDraftDirty || document.activeElement === el)) return;
  const next = text || '';
  if ('value' in el) {
    if (el.value !== next) el.value = next;
  } else if (el.textContent !== next) {
    el.textContent = next;
  }
}

function nextPrompterVersion() {
  prompterVersion = Math.max(prompterVersion + 1, Date.now());
  prompterUpdatedAt = Date.now();
  return prompterVersion;
}

function adoptPrompterText(text, opts={}) {
  const clean = cleanPrompterText(text);
  prompterText = clean;
  if (Number.isFinite(opts.version) && opts.version > prompterVersion) prompterVersion = opts.version;
  if (Number.isFinite(opts.updatedAt) && opts.updatedAt > prompterUpdatedAt) prompterUpdatedAt = opts.updatedAt;
  if (opts.source) prompterSource = opts.source;
  setLivePrompterEditorText(clean, !!opts.forceEditor);
  return clean;
}

function adoptPrompterSnapshot(prompter={}, opts={}) {
  if (!prompter || typeof prompter.text !== 'string') return false;
  const remoteVersion = Number(prompter.version) || 0;
  const remoteUpdatedAt = Number(prompter.updatedAt) || 0;
  const isOlderVersion = remoteVersion && prompterVersion && remoteVersion < prompterVersion;
  const isOlderTime = !remoteVersion && remoteUpdatedAt && prompterUpdatedAt && remoteUpdatedAt < prompterUpdatedAt;
  if (isOlderVersion || isOlderTime) return false;
  if (livePrompterDraftDirty && !opts.force) {
    markLivePrompterStatus('Remote update held', 'busy');
    return false;
  }
  adoptPrompterText(prompter.text, {
    version: remoteVersion,
    updatedAt: remoteUpdatedAt,
    source: prompter.source || 'live',
    forceEditor: !!opts.forceEditor
  });
  return true;
}

function scriptSpeakerLabel(d) {
  const explicit = d?.speaker || d?.customSrc || d?.who || '';
  if (explicit) return explicit;
  const cue = getCueOff(d) || getCueOn(d);
  return String(cue || '').replace(/\s+—\s*Begin\s*$/i, '').trim();
}

function assemblePrompterScriptFromBeats(list=beats) {
  const scripts = (Array.isArray(list) ? list : [])
    .map((b, rowIdx) => ({ b, rowIdx }))
    .filter(({ b }) => b?.cues?.script?.text);
  return cleanPrompterText(scripts.map(({ b, rowIdx }) => {
    const d = b.cues.script;
    const rowNum = rowIdx + 1;
    const header = b.info ? `\n[${rowNum}] ${b.info}\n` : `\n[${rowNum}]\n`;
    const speaker = scriptSpeakerLabel(d);
    return header + (speaker ? `${speaker.toUpperCase()}:\n` : '') + (d.text || '');
  }).join('\n\n'));
}

function markLivePrompterStatus(text, tone='ok') {
  const el = document.getElementById('lsPrompterUpdateStatus');
  if (!el) return;
  el.textContent = text;
  el.className = `ls-prompter-update ${tone}`;
  clearTimeout(livePrompterStatusTimer);
  livePrompterStatusTimer = setTimeout(() => {
    if (el.textContent === text) el.textContent = 'Ready';
    el.className = 'ls-prompter-update ok';
  }, 2200);
}

function updateLiveOverview() {
  const cur = beats[lsIdx] || null;
  const next = beats[lsIdx+1] || null;
  const total = totalSecs();
  const remain = liveRemainingSecs();
  const progress = total ? Math.min(100, Math.max(0, elapsedSecs / total * 100)) : (beats.length ? (lsIdx+1)/beats.length*100 : 0);
  const setText = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  setText('ls-show-title', show.name || 'Untitled Show');
  setText('ls-show-sub', `${beats.length ? `Row ${Math.min(lsIdx+1, beats.length)} of ${beats.length}` : 'No rows'}${session.code&&!session.isExpert ? ` · ${session.code}` : ''}`);
  setText('ls-stat-now', cur ? cur.info || `Row ${lsIdx+1}` : '—');
  setText('ls-stat-next', next ? next.info || `Row ${lsIdx+2}` : 'End');
  setText('ls-stat-remain', remain ? fmtProductionClock(liveRemainingMs()) : '—');
  const fill = document.getElementById('ls-progress-fill');
  if (fill) fill.style.width = `${progress}%`;
  updateLiveRemain();
}

// Show time remaining, in the live transport bar. Turns amber under 10% left.
function updateLiveRemain() {
  const el = document.getElementById('ls-remain');
  if (!el) return;
  const ms = liveRemainingMs();
  el.textContent = fmtProductionClock(ms);
  const totalMs = totalSecs() * 1000;
  el.classList.toggle('warn', totalMs > 0 && ms <= totalMs * 0.1);
}

function applyLivePrompterPanelState() {
  const sidebar = document.getElementById('lsSidebar');
  const resizer = document.getElementById('lsResizer');
  const btn = document.getElementById('prompterPanelBtn');
  if (sidebar) {
    sidebar.classList.toggle('open', livePrompterOpen);
    sidebar.style.width = `${liveSidebarWidth}px`;
    if (livePrompterOpen) { try { const h = parseFloat(localStorage.getItem('cueola_scriptOpHeight')); if (h) applyScriptOpHeight(h); } catch (e) {} }
  }
  if (resizer) resizer.classList.toggle('on', livePrompterOpen);
  if (btn) {
    setSymbolButtonLabel(btn, 'content.script', livePrompterOpen ? 'Hide Script Op' : 'Script Op');
    btn.style.color = livePrompterOpen ? 'var(--cyan)' : '';
    btn.style.borderColor = livePrompterOpen ? 'rgba(34,211,211,.35)' : '';
  }
}

const FLOWMINGO_OP_LABEL = `${sfIcon('content.display')} <span>Flow<span class="brand-hi">mingo</span></span> Op`;

function setFlowmingoOpButton(active) {
  const btn = document.getElementById('promptOpBtn');
  if (!btn) return;
  if (active) {
    btn.style.color = 'var(--cyan)';
    btn.style.borderColor = 'var(--cyan)';
    btn.style.background = 'color-mix(in srgb,var(--cyan) 12%,transparent)';
    setSymbolButtonLabel(btn, 'action.grid', 'Rundown View');
  } else {
    btn.style.color = '';
    btn.style.borderColor = '';
    btn.style.background = '';
    btn.innerHTML = FLOWMINGO_OP_LABEL;
  }
}

function toggleLivePrompterPanel() {
  livePrompterOpen = !livePrompterOpen;
  // A user is one OR the other — Script Op and Flowmingo Op are mutually exclusive.
  if (livePrompterOpen && promptOpMode) {
    promptOpMode = false;
    document.getElementById('liveshow')?.classList.remove('prompt-op-active');
    setFlowmingoOpButton(false);
    renderLive();
  }
  applyLivePrompterPanelState();
  markResumeState();   // P7: Script Op open/closed is part of the resume snapshot
}

function startLivePanelResize(e) {
  e.preventDefault();
  const startX = e.clientX;
  const startW = liveSidebarWidth;
  const move = ev => {
    liveSidebarWidth = Math.min(620, Math.max(340, startW + (startX - ev.clientX)));
    applyLivePrompterPanelState();
  };
  const up = () => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up, {once:true});
}

function renderLiveCurrent(b, i) {
  const types = Object.keys(b.cues||{}).filter(t=>CT[t]&&t!=='script');
  const sd = b.cues?.script;
  const adminCaller = isAdminShowCaller();
  const rowStart = show.start ? clock(show.start, offsetBeforeIndex(i)) : '—';
  const elapsedRows = `${i+1} / ${beats.length}`;
  const cueBlocks = types.map(t => {
    const d = b.cues[t], tc = CT[t];
    const on  = getCueOn(d);
    const off = getCueOff(d);
    return `<div class="lv-cue-block" style="border-left-color:${tc.color}">
      <div class="lv-cue-label" style="color:${tc.color}">${sfIcon(tc.symbol)} ${tc.label}</div>
      ${on  ? `<div class="lv-cue-ready">▶ ${esc(on)}</div>`  : ''}
      ${off ? `<div class="lv-cue-take">■ ${esc(off)}</div>` : ''}
    </div>`;
  }).join('');
  return `<div class="lv-cur-card">
    <div class="lv-cur-badge">● NOW — Row ${i+1}</div>
    <div class="lv-cur-name">${esc(b.info||'—')}</div>
    ${b.notes?`<div class="lv-cur-note">${esc(b.notes)}</div>`:''}
    ${fmtDur(b)!=='—'?`<div class="lv-cur-dur">${fmtDur(b)}</div>`:''}
    <div class="lv-cur-meta">
      <div class="lv-cur-mi"><div class="lv-cur-ml">Scheduled</div><div class="lv-cur-mv">${rowStart}</div></div>
      <div class="lv-cur-mi"><div class="lv-cur-ml">Position</div><div class="lv-cur-mv">${elapsedRows}</div></div>
      <div class="lv-cur-mi"><div class="lv-cur-ml">Show Left</div><div class="lv-cur-mv">${liveRemainingSecs()?fmtProductionSecs(liveRemainingSecs()):'—'}</div></div>
    </div>
    ${cueBlocks?`<div class="lv-cue-blocks">${cueBlocks}</div>`:''}
    ${sd?.text?`<div class="lv-cur-script">${esc(sd.text)}</div>`:''}
    ${sd&&adminCaller?`<button class="ltr-edit-btn" style="margin-top:8px" onclick="openLiveScript(${i})">${sfIcon('action.edit')} Edit &amp; Push</button>`:''}
  </div>`;
}

function renderLiveNext(b, i, isRunner) {
  const types = Object.keys(b.cues||{}).filter(t=>CT[t]&&t!=='script');
  const cueSmall = types.map(t => {
    const d = b.cues[t], tc = CT[t];
    const on  = getCueOn(d);
    const off = getCueOff(d);
    return `<span class="lv-next-cue" style="border-left-color:${tc.color}">
      <span style="color:${tc.color}">${sfIcon(tc.symbol)}</span>
      ${on  ? `<span>▶ ${esc(on)}</span>`  : ''}
      ${off ? `<span style="opacity:.7">■ ${esc(off)}</span>` : ''}
    </span>`;
  }).join('');
  const handler = isRunner ? `jumpToLsCue(${i})` : `liveRowPreview(${i})`;
  return `<div class="lv-next-card" onclick="${handler}">
    <div class="lv-next-badge">NEXT → Row ${i+1}</div>
    <div class="lv-next-name">${esc(b.info||'—')}</div>
    ${b.notes?`<div class="lv-next-note">${esc(b.notes)}</div>`:''}
    ${cueSmall?`<div class="lv-next-cues">${cueSmall}</div>`:''}
    ${fmtDur(b)!=='—'?`<div class="lv-next-dur">${fmtDur(b)}</div>`:''}
  </div>`;
}

function liveRowPreview(idx) {
  const b = beats[idx]; if (!b) return;
  previewRowIdx = idx;
  const titleEl = document.getElementById('lrpTitle');
  const bodyEl  = document.getElementById('lrpBody');
  if (!titleEl||!bodyEl) return;
  titleEl.textContent = `${idx+1}. ${b.info||'—'}`;
  const types = Object.keys(b.cues||{}).filter(t=>CT[t]);
  let html = '';
  if (b.notes) html += `<div style="color:var(--text2);font-size:13px;margin-bottom:12px;line-height:1.5">${esc(b.notes)}</div>`;
  if (fmtDur(b)!=='—') html += `<div style="font-family:var(--mono);font-size:12px;color:var(--text3);margin-bottom:10px">Duration: ${fmtDur(b)}</div>`;
  types.forEach(t => {
    const d = b.cues[t], tc = CT[t];
    const on  = getCueOn(d);
    const off = getCueOff(d);
    html += `<div style="border-left:3px solid ${tc.color};padding:8px 12px;margin-bottom:8px;border-radius:0 8px 8px 0;background:var(--s2)">
      <div style="font-size:10px;font-family:var(--mono);color:${tc.color};letter-spacing:.1em;text-transform:uppercase;margin-bottom:4px">${sfIcon(tc.symbol)} ${tc.label}</div>
      ${on  ? `<div style="font-size:14px;color:var(--text2);margin-bottom:2px">○ ${esc(on)}</div>`  : ''}
      ${off ? `<div style="font-size:15px;font-weight:700;color:${tc.color}">▶ ${esc(off)}</div>` : ''}
      ${t==='script'&&d.text?`<div style="font-size:13px;line-height:1.7;color:var(--text);margin-top:8px;white-space:pre-wrap;border-top:1px solid var(--border);padding-top:8px">${esc(d.text)}</div>`:''}
    </div>`;
  });
  if (!types.length) html = '<div style="color:var(--text3);text-align:center;padding:20px">No cues configured.</div>';
  bodyEl.innerHTML = html;
  const prevBtn = document.getElementById('lrpPrevBtn');
  const nextBtn = document.getElementById('lrpNextBtn');
  if (prevBtn) prevBtn.disabled = idx <= 0;
  if (nextBtn) nextBtn.disabled = idx >= beats.length - 1;
  showOverlay('lsRowPreviewOv');
}

function previewRelativeRow(delta) {
  const next = previewRowIdx + delta;
  if (next < 0 || next >= beats.length) return;
  liveRowPreview(next);
}

function liveCellForBeat(b, type, beatIdx) {
  const tc = CT[type];
  const d = b.cues?.[type];
  if (!d && type === 'script') {
    return `<div class="live-script-open" onclick="event.stopPropagation();openLiveScript(${beatIdx})" title="Add script">+</div>`;
  }
  if (!d) return `<div class="live-cue-empty">·</div>`;
  const on = getCueOn(d);
  const off = getCueOff(d);
  const isScript = type === 'script';
  const scriptMeta = isScript && d.text ? `<div class="live-script-action">${scriptLineLabel(d.text)} · tap to open</div>` : '';
  if (!on && !off && !scriptMeta) return `<div class="live-cue-empty">·</div>`;
  // Ready (the "on"/standby cue) sits calm on top; Take (the "off"/go cue) is the
  // bold, department-coloured action line. "Ready one… take one."
  return `<div class="live-cue-cell${isScript?' live-script-cell':''}" style="--cue-clr:${tc.color}" ${isScript?`onclick="event.stopPropagation();openLiveScript(${beatIdx})" title="Open full script"`:''}>
    ${on  ? `<div class="live-cue-rdy">${sfIcon('marker.ready')} ${esc(on)}</div>` : ''}
    ${off ? `<div class="live-cue-go" style="color:${tc.color}">${sfIcon('marker.go')} ${esc(off)}</div>` : ''}
    ${isScript ? (scriptMeta || '<div class="live-script-action">Tap to open script</div>') : ''}
  </div>`;
}

// Clean cue chips for the Focus view — only the row's programmed departments.
function focusCuesForBeat(b) {
  const filled = colOrder.filter(type => {
    const d = b.cues?.[type];
    return d && (getCueOn(d) || getCueOff(d) || (type === 'script' && d.text));
  });
  if (!filled.length) return '<div class="lf-nocue">No cues on this row</div>';
  return `<div class="lf-cues">` + filled.map(type => {
    const d = b.cues[type], tc = CT[type];
    const on = getCueOn(d), off = getCueOff(d);
    let lines = '';
    if (type === 'script') {
      lines = `<div class="lf-cue-take">${sfIcon('content.script')} Script ready · ${scriptLineLabel(d.text)}</div>`;
    } else {
      // The "take" (on) cue is the action to call now — make it the big line.
      // If there's no take, the "ready"/off cue becomes the prominent one.
      if (on)  lines += `<div class="lf-cue-take">▶ ${esc(on)}</div>`;
      if (off) lines += `<div class="lf-cue-${on ? 'ready' : 'take'}">■ ${esc(off)}</div>`;
    }
    const outGo = type === 'playback' ? outrangutanGoBtnHTML(b.id, d) : '';
    const sfxGo = (type === 'playback' || type === 'audio') ? outrangutanSfxGoBtnHTML(b.id, type, d) : '';
    const goBtn = outGo + sfxGo;
    return `<div class="lf-cue${goBtn ? ' lf-cue-has-go' : ''}" style="--cue-clr:${tc.color}">
      <div class="lf-cue-dept">${sfIcon(COL_META[type].symbol)} ${COL_META[type].label}</div>
      <div class="lf-cue-lines">${lines}</div>
      ${goBtn}
    </div>`;
  }).join('') + `</div>`;
}

// Focus view: one dominant NOW, a clear NEXT, and a dim coming-up list.
function renderLiveFocus() {
  const body = document.getElementById('lsBody');
  const curIdx = Math.max(0, Math.min(lsIdx, beats.length - 1));
  const cur = beats[curIdx];
  // find next non-segment beat
  let nextBeatIdx = curIdx + 1;
  while (nextBeatIdx < beats.length && beats[nextBeatIdx]?.style === 'segment') nextBeatIdx++;
  const next = nextBeatIdx < beats.length ? beats[nextBeatIdx] : null;
  const total = beats.length;
  const remainSecs = beats.slice(curIdx).reduce((a, b) => a + (b.min || 0) * 60 + (b.sec || 0), 0);
  const startStr = show.start ? clock(show.start, beats.slice(0, curIdx).reduce((a, b) => a + (b.min || 0) * 60 + (b.sec || 0), 0)) : '';
  const canJump = isFollowingSelf() && isAdminShowCaller();

  let html = `<div class="lf-wrap">
    <div class="lf-now" onclick="liveRowPreview(${curIdx})">
      <div class="lf-now-head">
        <span class="lf-now-badge"><span class="lf-dot"></span> NOW</span>
        <span class="lf-now-meta">Row ${curIdx + 1} of ${total} · ${fmtSecs(remainSecs)} left</span>
      </div>
      <div class="lf-now-title">
        <span class="lf-now-name">${esc(cur.info || '—')}</span>
        <span class="lf-now-dur">${fmtDur(cur)}</span>
        ${startStr ? `<span class="lf-now-clock">starts ${startStr}</span>` : ''}
      </div>
      ${cur.notes ? `<div class="lf-now-note">${esc(cur.notes)}</div>` : ''}
      ${focusCuesForBeat(cur)}
    </div>`;

  if (next) {
    html += `<div class="lf-next" onclick="liveRowPreview(${nextBeatIdx})">
      <span class="lf-next-badge">NEXT</span>
      <span class="lf-next-name">${esc(next.info || '—')}</span>
      <span class="lf-next-time">${fmtDur(next)}</span>
    </div>`;
  } else {
    html += `<div class="lf-next lf-next-last"><span class="lf-next-badge">END</span><span class="lf-next-name">Last row — show ends after this</span></div>`;
  }

  const rest = beats.slice(nextBeatIdx + 1);
  if (rest.length) {
    html += `<div class="lf-up-lbl">Coming up</div><div class="lf-up">` + rest.map((b, j) => {
      const i = nextBeatIdx + 1 + j;
      if (b.style === 'segment') {
        return `<div class="lf-up-seg">${esc(b.info || 'Segment')}</div>`;
      }
      return `<div class="lf-up-row" onclick="${canJump ? `jumpToLsCue(${i})` : `liveRowPreview(${i})`}">
        <span class="lf-up-num">${i + 1}</span>
        <span class="lf-up-name">${esc(b.info || '—')}</span>
        <span class="lf-up-time">${fmtDur(b)}</span>
      </div>`;
    }).join('') + `</div>`;
  }
  html += `</div>`;
  body.innerHTML = html;
}

function updateLiveFocusToggle() {
  const btn = document.getElementById('liveFocusBtn');
  if (btn) setSymbolButtonLabel(btn, liveFocusMode ? 'action.grid' : 'content.display', liveFocusMode ? 'Full Grid' : 'Focus');
}

function toggleLiveFocus() {
  liveFocusMode = !liveFocusMode;
  try { localStorage.setItem('cueola_live_focus', liveFocusMode ? '1' : '0'); } catch {}
  renderLive();
}

function renderLive() {
  if (promptOpMode) { renderLivePromptOp(); return; }
  const body = document.getElementById('lsBody');
  if (!beats.length) { body.innerHTML='<div style="text-align:center;padding:40px;color:var(--text3)">No cues in rundown.</div>'; return; }

  document.getElementById('liveshow')?.classList.toggle('lf-on', liveFocusMode);
  updateLiveFocusToggle();
  if (liveFocusMode) {
    renderLiveFocus();
    applyLivePrompterPanelState();
    renderFollowChips();
    updateLiveOverview();
    updateLsPrompter();
    renderLivePrompterControls();
    return;
  }
  // canJump = can click arbitrary rows to jump position (admin show callers only)
  const runner  = isFollowingSelf();
  const canJump = runner && isAdminShowCaller();
  // Only show department columns actually used in this show — no empty lanes.
  const usedCols = colOrder.filter(type => beats.some(b => { const d=b.cues?.[type]; return d && (getCueOn(d)||getCueOff(d)||(type==='script'&&d.text)); }));
  const showCols = usedCols.length ? usedCols : ['video'];
  let offsetSecs = 0;
  let html = `<div class="live-grid-wrap"><table class="live-grid">
    <thead><tr>
      <th class="live-col-num">#</th>
      <th class="live-col-status">State</th>
      <th class="live-col-name">Row</th>
      <th class="live-col-time">Time</th>
      ${showCols.map(type=>`<th class="${type==='script'?'live-col-script':'live-col-cue'}" style="color:${CT[type].color};cursor:grab;user-select:none" draggable="true" data-col="${type}" ondragstart="colDragStart(event,'${type}')" ondragover="colDragOver(event,this)" ondrop="colDrop(event,'${type}')" ondragend="colDragEnd(event)" title="Drag to reorder">${sfIcon(COL_META[type].symbol)} ${COL_META[type].label} ${sfIcon('action.drag','col-grip')}</th>`).join('')}
    </tr></thead><tbody>`;

  beats.forEach((b, i) => {
    const durSecs = (b.min||0)*60+(b.sec||0);
    const startStr = show.start ? clock(show.start, offsetSecs) : '—';
    offsetSecs += durSecs;

    if (b.style === 'segment') {
      const colSpan = 4 + showCols.length;
      html += `<tr class="live-segment-header">
        <td colspan="${colSpan}" class="live-seg-cell">
          <span class="live-seg-label">${esc(b.info || 'Segment')}</span>
          ${b.notes ? `<span class="live-seg-note">${esc(b.notes)}</span>` : ''}
        </td>
      </tr>`;
      return;
    }

    const isCur  = i === lsIdx;
    const isNext = i > lsIdx && beats.slice(lsIdx+1, i).every(x => x.style === 'segment');
    const isDone = i < lsIdx;
    const handler = canJump ? `jumpToLsCue(${i})` : `liveRowPreview(${i})`;
    const statusClass = isCur ? 'now' : isNext ? 'next' : isDone ? 'done' : 'later';
    const statusText = isCur ? 'On Air' : isNext ? 'Next' : isDone ? 'Done' : 'Later';
    const rowClass = isCur ? 'live-row-current' : isNext ? 'live-row-next' : isDone ? 'live-row-done' : '';
    html += `<tr class="${rowClass}" onclick="${handler}">
      <td><div class="live-num">${i + 1}</div></td>
      <td><span class="live-status ${statusClass}">${statusText}</span></td>
      <td>
        <div class="live-name">${esc(b.info||'—')}</div>
        ${b.notes?`<div class="live-note">${esc(b.notes)}</div>`:''}
      </td>
      <td><div class="live-time"><strong>${fmtDur(b)}</strong>${startStr}</div></td>
      ${showCols.map(type=>`<td class="live-cue-td">${liveCellForBeat(b,type,i)}</td>`).join('')}
    </tr>`;
  });
  html += `</tbody></table></div>`;

  // P3: an innerHTML rebuild resets scroll to the top — the visible "flash" for
  // anyone reading elsewhere in the rundown. Keep their place unless the live
  // position actually moved (then center it as before).
  const prevScroll = body.scrollTop;
  body.innerHTML = html;
  const cur = body.querySelector('.live-row-current');
  if (cur && _lastLiveScrollIdx !== lsIdx) {
    _lastLiveScrollIdx = lsIdx;
    cur.scrollIntoView({behavior:'auto', block:'center'});
  } else {
    body.scrollTop = prevScroll;
  }
  applyLivePrompterPanelState();
  renderFollowChips();
  updateLiveOverview();
  updateLsPrompter();
  renderLivePrompterControls();
}

function openLiveScript(beatIdx) {
  const b = beats[beatIdx]; if (!b) return;
  liveScriptEditIdx = beatIdx;
  const d = b.cues?.script||{};
  document.getElementById('lsScriptEditTitle').textContent = `Script • ${b.info||`Row ${beatIdx+1}`}`;
  document.getElementById('lsScriptEditText').value = d.text||'';
  showOverlay('lsScriptEditOv');
  setTimeout(()=>document.getElementById('lsScriptEditText')?.focus(),80);
}

// Wrap the current selection (in a textarea) with markers, e.g. **bold**.
function wrapTextareaSelection(taId, pre, post) {
  const ta = document.getElementById(taId);
  if (!ta) return;
  const start = ta.selectionStart ?? ta.value.length;
  const end = ta.selectionEnd ?? start;
  const sel = ta.value.slice(start, end) || 'text';
  ta.value = ta.value.slice(0, start) + pre + sel + post + ta.value.slice(end);
  ta.focus();
  ta.setSelectionRange(start + pre.length, start + pre.length + sel.length);
}

// Wrap the current selection (in the live contenteditable panel) with markers.
// Keyboard shortcuts inside the Script Op editor: ⌘/Ctrl+B bold, +I italic,
// +Enter pushes to Flowmingo. Makes formatting and pushing fast without reaching
// for the toolbar.
function livePrompterKeydown(e) {
  if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
  const k = (e.key || '').toLowerCase();
  if (k === 'b') { e.preventDefault(); e.stopPropagation(); wrapLivePanelSelection('**', '**'); }
  else if (k === 'i') { e.preventDefault(); e.stopPropagation(); wrapLivePanelSelection('*', '*'); }
  else if (k === 'enter') { e.preventDefault(); e.stopPropagation(); pushToPrompter(); }
}

function wrapLivePanelSelection(pre, post) {
  const el = livePrompterEditor();
  if (!el) return;
  if ('value' in el) {
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? start;
    const sel = el.value.slice(start, end) || 'text';
    el.value = el.value.slice(0, start) + pre + sel + post + el.value.slice(end);
    el.focus();
    el.setSelectionRange(start + pre.length, start + pre.length + sel.length);
    queueLivePrompterDraftPush();
    return;
  }
  el.focus();
  const sel = window.getSelection();
  if (sel && sel.rangeCount && !sel.isCollapsed) {
    const range = sel.getRangeAt(0);
    const txt = range.toString();
    range.deleteContents();
    range.insertNode(document.createTextNode(pre + txt + post));
    range.collapse(false);
    sel.removeAllRanges();
    sel.addRange(range);
  } else {
    insertLivePanelMarker(pre + 'text' + post);
    return;
  }
  queueLivePrompterDraftPush();
}

function insertScriptMarker(text) {
  const ta = document.getElementById('lsScriptEditText');
  if (!ta) return;
  const start = ta.selectionStart ?? ta.value.length;
  const end = ta.selectionEnd ?? start;
  const before = ta.value.slice(0, start);
  const after = ta.value.slice(end);
  ta.value = before + text + after;
  const pos = start + text.length;
  ta.focus();
  ta.setSelectionRange(pos, pos);
}

function insertLivePanelMarker(text) {
  const el = livePrompterEditor();
  if (!el) return;
  if ('value' in el) {
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? start;
    el.value = el.value.slice(0, start) + text + el.value.slice(end);
    const pos = start + text.length;
    el.focus();
    el.setSelectionRange(pos, pos);
    queueLivePrompterDraftPush();
    return;
  }
  el.focus();
  const sel = window.getSelection();
  if (sel && sel.rangeCount) {
    const range = sel.getRangeAt(0);
    range.deleteContents();
    range.insertNode(document.createTextNode(text));
    range.collapse(false);
    sel.removeAllRanges();
    sel.addRange(range);
  } else {
    el.textContent += text;
  }
  queueLivePrompterDraftPush();
}

async function pasteClipboardToPrompter(pushNow=false) {
  let text = '';
  try {
    text = await navigator.clipboard.readText();
  } catch {
    // Paste-Push should fire straight through — never interrupt with a prompt.
    if (pushNow) { markLivePrompterStatus('Allow clipboard access to paste', 'busy'); return; }
    text = prompt('Paste chat text to send to Flowmingo:', '') || '';
  }
  text = cleanPrompterText(text);
  if (!text) {
    markLivePrompterStatus('Clipboard empty', 'busy');
    return;
  }
  insertLivePanelMarker(`${prompterText || livePrompterEditorText() ? '\n\n' : ''}[CHAT]\n${text}`);
  if (pushNow) pushToPrompter();
}

function insertCueScriptMarker(text) {
  const ta = document.getElementById('cc-s-text');
  if (!ta) return;
  const start = ta.selectionStart ?? ta.value.length;
  const end = ta.selectionEnd ?? start;
  ta.value = ta.value.slice(0, start) + text + ta.value.slice(end);
  const pos = start + text.length;
  ta.focus();
  ta.setSelectionRange(pos, pos);
}

function saveLiveScript() {
  const b = beats[liveScriptEditIdx]; if (!b) return;
  if (!b.cues) b.cues={};
  if (!b.cues.script) b.cues.script={ready:'',take:''};
  b.cues.script.text = cleanPrompterText(document.getElementById('lsScriptEditText').value);
  adoptPrompterText(assemblePrompterScriptFromBeats(), { forceEditor:true, source:'assembled' });
  livePrompterDraftDirty = false;
  sendToPrompter();
  hideOverlay('lsScriptEditOv');
  renderLive(); syncToFirestore(); toast('Script saved & pushed.');
}

function jumpToLsCue(i) {
  if (session.role==='student') return;
  if (isStandardShowCaller()) return; // standard show callers may only advance sequentially
  lsIdx = i;
  renderLive();
  sendToPrompter(false).then(pushed => { if (pushed) cuePrompterToLiveRow(); });
  syncLiveIdx();
}

// If I'm mirroring someone (or auto-following the caller), navigating on my own
// detaches me to browse — I can look ahead/back without snapping straight back.
function detachIfFollowing() {
  if (isFollowingSelf()) return;
  browsingSelf = true;
  followTarget = '';
  followTargetId = '';
  renderFollowChips();
  updateFollowInPresence(session.userName);
}

function lsNext() {
  detachIfFollowing();
  const prev = beats[lsIdx];
  let ni = lsIdx;
  do { ni++; } while (ni < beats.length && beats[ni]?.style === 'segment');
  if (ni < beats.length) {
    lsIdx = ni;
    updatePrompterOnAdvance(prev, beats[lsIdx]);
    fireOutrangutanAutoForBeat(beats[lsIdx]);  // auto-fire a linked Outrangutan playback cue
    fireQlabAutoForBeat(beats[lsIdx]);         // auto-fire any QLab triggers programmed on the row
    logShow('cue', 'Advance → row ' + (lsIdx + 1) + rowLogLabel(beats[lsIdx]));
    renderLive();
    syncLiveIdx();
  }
}
// P7: short human label for a row in the show log.
function rowLogLabel(b) {
  const name = String(b?.info || b?.cues?.script?.who || '').trim();
  return name ? ' · ' + name.slice(0, 60) : '';
}

function lsPrev() {
  detachIfFollowing();
  let ni = lsIdx;
  do { ni--; } while (ni >= 0 && beats[ni]?.style === 'segment');
  if (ni >= 0) {
    lsIdx = ni;
    logShow('cue', 'Back → row ' + (lsIdx + 1) + rowLogLabel(beats[lsIdx]));
    renderLive();
    sendToPrompter(false).then(pushed => { if (pushed) cuePrompterToLiveRow(); });
    syncLiveIdx();
  }
}

// Per-person following: which position should I mirror? Browsing self → null (keep
// my own). Otherwise mirror my explicit follow target, or — for a student who hasn't
// chosen — the show caller (first instructor broadcasting a position).
function resolveFollowedIdx(presence, opts) {
  if (!opts || opts.browsingSelf) return null;
  const people = activePresenceEntries(presence);
  if (opts.followTargetId) {
    const target = people.find(([id]) => id === opts.followTargetId)?.[1];
    if (target && Number.isFinite(target.idx)) return target.idx;
  }
  if (opts.followTarget && opts.followTarget !== opts.myName) {
    const t = people.find(([, p]) => sameParticipantName(p?.name, opts.followTarget))?.[1];
    if (t && Number.isFinite(t.idx)) return t.idx;
  }
  if (opts.role === 'student') {
    const caller = people.find(([, p]) => p && p.role === 'instructor' && Number.isFinite(p.idx))?.[1];
    if (caller) return caller.idx;
  }
  return null;
}

function participantNameKey(name) {
  return String(name || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function sameParticipantName(a, b) {
  return participantNameKey(a) === participantNameKey(b);
}

// Newest active connection first. A person can have an old tab or reconnect
// under the same display name; following must use the live record, not whichever
// object property Firestore happens to enumerate first.
function activePresenceEntries(presence=currentPresence) {
  const now = Date.now();
  return Object.entries(presence || {})
    .filter(([, p]) => p?.name && (now - (p.lastSeen || 0)) < 90000)
    .sort((a, b) => (b[1].lastSeen || 0) - (a[1].lastSeen || 0));
}

// Who am I effectively following right now (for highlighting the right chip)?
function effectiveFollowedName(presence) {
  if (browsingSelf) return session.userName;
  if (followTargetId && presence?.[followTargetId]?.name) return presence[followTargetId].name;
  if (followTarget) return followTarget;
  if (session.role === 'student') {
    const caller = activePresenceEntries(presence).find(([, p]) => p?.role === 'instructor')?.[1];
    if (caller) return caller.name;
  }
  return session.userName;
}

function renderFollowChips() {
  const chips = document.getElementById('followChips');
  if (!chips) return;
  const activeName = effectiveFollowedName(currentPresence);
  const seenNames = new Set();
  const others = activePresenceEntries(currentPresence)
    .filter(([, p]) => !sameParticipantName(p.name, session.userName))
    .filter(([, p]) => {
      const key = participantNameKey(p.name);
      if (seenNames.has(key)) return false;
      seenNames.add(key);
      return true;
    });
  let html = `<div class="follow-chip follow-self ${activeName===session.userName?'active':''}" onclick="followSelf()">Myself</div>`;
  others.forEach(([id, p])=>{
    const isActive = followTargetId ? followTargetId === id : sameParticipantName(activeName, p.name);
    html+=`<div class="follow-chip ${isActive?'active':''}" data-follow-id="${esc(id)}" data-follow-name="${esc(p.name)}" onclick="followPerson(this)">${esc(p.name)}<span class="p-tip-label" style="margin-left:5px">${p.role==='instructor'?'INST':'STU'}</span></div>`;
  });
  chips.innerHTML = html;
  const forceBtn = document.getElementById('forceFollowBtn');
  if (forceBtn) {
    forceBtn.style.display = (session.role === 'instructor' && isFollowingSelf()) ? '' : 'none';
  }
}

function followSelf() {
  browsingSelf = true;        // detach and browse the rundown on my own
  followTarget = '';
  followTargetId = '';
  renderFollowChips();
  updateFollowInPresence(session.userName);
}

function followPerson(el, legacyName='', legacyId='') {
  const name = el?.dataset?.followName || legacyName;
  const id = el?.dataset?.followId || legacyId;
  if (!name) return;
  browsingSelf = false;
  followTarget = name;
  followTargetId = id;
  renderFollowChips();
  toast(`Following ${name}`);
  updateFollowInPresence(name, id);
  // Snap to their position immediately if they're broadcasting one.
  const target = (id && currentPresence?.[id]) ||
    activePresenceEntries(currentPresence).find(([, p]) => sameParticipantName(p?.name, name))?.[1];
  if (target && Number.isFinite(target.idx)) {
    lsIdx = target.idx;
    if (document.getElementById('liveshow')?.classList.contains('on')) renderLive();
  }
}

// Adopt a follow target without a click (used by the force-follow commands).
function forceFollowPerson(name, presence) {
  const targetEntry = activePresenceEntries(presence || currentPresence)
    .find(([, p]) => sameParticipantName(p?.name, name));
  browsingSelf = false;
  followTarget = name;
  followTargetId = targetEntry?.[0] || '';
  renderFollowChips();
  updateFollowInPresence(name, followTargetId);
  const target = targetEntry?.[1];
  if (target && Number.isFinite(target.idx)) lsIdx = target.idx;
  if (document.getElementById('liveshow')?.classList.contains('on')) renderLive();
}

function updateFollowInPresence(name, targetId='') {
  if (!session.code || session.isDemo || !window._firebaseReady) return;
  window._updateDoc(window._doc(window._db,'sessions',session.code), {
    [`presence.${presenceId}.following`]: name,
    [`presence.${presenceId}.followingId`]: targetId,
  }).catch(()=>{});
}

function returnToOwnLivePosition() {
  const ownIdx = currentPresence?.[presenceId]?.idx;
  browsingSelf = true;
  followTarget = '';
  followTargetId = '';
  if (Number.isFinite(ownIdx)) lsIdx = ownIdx;
  renderFollowChips();
  updateFollowInPresence(session.userName);
  renderLive();
  sendToPrompter(false);
  syncLiveIdx();
}

// Show Caller: force all users to follow them
function forceMeAsShowCaller() {
  if (!session.code || session.isDemo) return;
  if (!dangerConfirm('Make everyone follow your live position?', 'This broadcasts a command to synced collaborators in this session.')) return;
  window._updateDoc(window._doc(window._db,'sessions',session.code), {
    forceCmd: { type:'followMe', name:session.userName, role:session.role, ts:Date.now() }
  }).catch(err => reportCloudWriteFailure('Show caller command', err));
  toast('Forcing all users to follow you.');
}

// Admin: force everyone live and following a specific person
function adminForceLive(followName) {
  if (!adminSession || !session.code) return;
  if (!followName || followName === 'No users online') { toast('No live users to follow.'); return; }
  if (!dangerConfirm(`Force everyone live following ${followName}?`, 'This can move other devices into Live view and change who they follow. Use it only when you are actively show-calling.', { requireText:'LIVE' })) return;
  window._updateDoc(window._doc(window._db,'sessions',session.code), {
    forceCmd: { type:'forceLive', name:followName, ts:Date.now() }
  }).catch(err => reportCloudWriteFailure('Force live command', err));
  toast(`Forcing everyone live, following ${followName}.`);
  closeAdminPanel();
}

// ─────────────────────────────────────────────────────────────
// PROMPTER
// ─────────────────────────────────────────────────────────────
function buildPromptFromRundown() {
  adoptPrompterText(assemblePrompterScriptFromBeats(), { forceEditor:true, source:'assembled' });
}

let _prompterPingInterval = null;
let _prompterStorageHandler = null;
let lastTalentPingTs = 0;        // operator-side: when did we last hear from a talent
let _lastSeenTalentHeartbeatTs = 0; // dedup: last Firestore heartbeat ts we counted
let _talentWatchdog = null;       // interval that flips FLOWMINGO status if the talent goes silent
let _lastTalentInitSendBySender = {};
let _pendingPrompterControls = {};
let _lastPrompterAckId = '';
const PROMPTYPUS_CHANNEL = 'promptypus';
const PROMPTYPUS_STORAGE_MSG = 'promptypus_msg';
const PROMPTYPUS_STORAGE_PING = 'promptypus_ping';
const PROMPTYPUS_LEGACY_CHANNEL = 'prompt_up_the_jam';
const PROMPTYPUS_LEGACY_STORAGE_MSG = 'prompt_up_the_jam_msg';
const PROMPTYPUS_LEGACY_STORAGE_PING = 'prompt_up_the_jam_ping';

function _postPrompterMessage(payload) {
  // Per-window sender id matters: operator and talent windows often share one
  // localStorage CLIENT_ID, so remote commands must identify the actual tab/window.
  payload = withPrompterEnvelope(payload);
  [prompterChannel, prompterLegacyChannel].forEach(ch => {
    if (ch) {
      try { ch.postMessage(payload); } catch {}
    }
  });
  try {
    const msg = JSON.stringify({...payload, storageNonce:Date.now()+Math.random()});
    localStorage.setItem(PROMPTYPUS_STORAGE_MSG, msg);
    localStorage.setItem(PROMPTYPUS_LEGACY_STORAGE_MSG, msg);
  } catch {}
}

function _postPrompterHello() {
  _postPrompterMessage({ type:'cueola_hello', sessionCode:session.code, showName:show.name||'Untitled Show', reason:'hello' });
}

function _prompterHasRecentTalent() {
  return !!lastTalentPingTs && (Date.now() - lastTalentPingTs) < 14000;
}

function _notePrompterTalentSeen(msg={}) {
  if (isPrompterSelfSender(msg.sender)) return false;
  const wasSilent = !_prompterHasRecentTalent();
  lastTalentPingTs = Date.now();
  _setPrompterStatus(true);
  startTalentWatchdog(); // operator side: flip the badge loudly if this talent goes silent
  return wasSilent;
}

function _shouldSendInitForTalent(msg={}, wasSilent=false) {
  if (!document.getElementById('liveshow')?.classList.contains('on')) return false;
  const sender = msg.sender || 'unknown';
  const reason = msg.reason || '';
  const explicitReady = reason === 'ready' || reason === 'connect' || reason === 'hello';
  if (!wasSilent && !explicitReady) return false;
  const lastSent = _lastTalentInitSendBySender[sender] || 0;
  if (Date.now() - lastSent < 4000) return false;
  _lastTalentInitSendBySender[sender] = Date.now();
  return true;
}

function adoptPrompterTalentState(state={}) {
  if (!state || typeof state !== 'object') return;
  if (typeof state.playing === 'boolean') {
    ptPlaying = state.playing;
    flowOpPlaying = state.playing;
    ptSyncPlayIcons(ptPlaying);
  }
  if (Number.isFinite(Number(state.speed))) {
    ptTargetSpeed = Math.max(5, Math.min(200, Number(state.speed)));
    ptLiveSpeed = ptTargetSpeed;
  }
  if (Number.isFinite(Number(state.size))) {
    ptFontSize = Math.max(24, Math.min(120, Number(state.size)));
    document.documentElement.style.setProperty('--pt-size', `${ptFontSize}px`);
    ptEl('promptypus')?.style.setProperty('--pt-size', `${ptFontSize}px`);
    flowOpEl('flowOp')?.style.setProperty('--pt-size', `${ptFontSize}px`);
  }
  if (['left','center','right'].includes(state.align)) {
    ptAlign = state.align;
    document.documentElement.style.setProperty('--pt-align', ptAlign);
    ptEl('promptypus')?.style.setProperty('--pt-align', ptAlign);
    flowOpEl('flowOp')?.style.setProperty('--pt-align', ptAlign);
  }
  if (state.theme && PT_THEMES[state.theme]) {
    ptThemeName = state.theme;
    ptSetTheme(state.theme);
    flowOpSetTheme(state.theme);
  }
  if (typeof state.mirrored === 'boolean') ptMirrored = state.mirrored;
  flowOpSyncControls();
  renderLivePrompterControls();
}

function _handlePrompterControlAck(msg) {
  if (!msg || msg.type !== 'control_ack') return;
  if (isPrompterSelfSender(msg.sender)) return;
  if (msg.target && msg.target !== FLOWMINGO_ENDPOINT_ID) return;
  const ackId = msg.controlId || msg.mid || `${msg.sender || ''}:${msg.controlTs || msg.ts || ''}:${msg.action || ''}`;
  if (!ackId || ackId === _lastPrompterAckId) return;
  _lastPrompterAckId = ackId;
  _notePrompterTalentSeen(msg);
  if (msg.state) adoptPrompterTalentState(msg.state);
  const pending = _pendingPrompterControls[msg.controlId];
  if (pending) {
    clearTimeout(pending.waitTimer);
    clearTimeout(pending.failTimer);
    delete _pendingPrompterControls[msg.controlId];
    const label = flowOpControlLabel(pending.action);
    if (pending.origin === 'flowop') flowOpSetStatus(`${label} applied`);
    else markLivePrompterStatus(`${label} applied`, 'ok');
  }
}

function _handlePrompterOperatorMessage(msg) {
  if (!msg || isPrompterSelfSender(msg.sender)) return;
  if (msg.type === 'ping') {
    const wasSilent = _notePrompterTalentSeen(msg);
    if (_shouldSendInitForTalent(msg, wasSilent)) sendToPrompter(true);
    return;
  }
  if (msg.type === 'control_ack') {
    _handlePrompterControlAck(msg);
  }
}

function _ensurePrompterOperatorBridge(startHello=false) {
  if (!prompterChannel) {
    try {
      prompterChannel = new BroadcastChannel(PROMPTYPUS_CHANNEL);
      prompterChannel.onmessage = e => _handlePrompterOperatorMessage(e.data);
      prompterLegacyChannel = new BroadcastChannel(PROMPTYPUS_LEGACY_CHANNEL);
      prompterLegacyChannel.onmessage = e => _handlePrompterOperatorMessage(e.data);
    } catch {}
  }
  if (!_prompterStorageHandler) {
    _prompterStorageHandler = (e) => {
      if (![PROMPTYPUS_STORAGE_PING, PROMPTYPUS_LEGACY_STORAGE_PING, PROMPTYPUS_STORAGE_MSG, PROMPTYPUS_LEGACY_STORAGE_MSG].includes(e.key) || !e.newValue) return;
      try { _handlePrompterOperatorMessage(JSON.parse(e.newValue)); } catch {}
    };
    window.addEventListener('storage', _prompterStorageHandler);
  }
  if (startHello) {
    clearInterval(_prompterPingInterval);
    _prompterPingInterval = setInterval(_postPrompterHello, 5000);
    _postPrompterHello();
  }
}

// Watch the talent's heartbeat — if it goes silent for too long, flip the
// FLOWMINGO indicator to "Talent disconnected" so a dropout is loud, not silent.
function startTalentWatchdog() {
  if (_talentWatchdog) return;
  _talentWatchdog = setInterval(() => {
    if (!lastTalentPingTs) return; // never seen one yet — keep "Waiting"
    const age = Date.now() - lastTalentPingTs;
    if (age > 14000) {
      _setPrompterStatus(false);
      const txt = document.getElementById('prompterStatusTxt');
      const stat = document.getElementById('ls-stat-prompter');
      const secs = Math.floor(age / 1000);
      if (txt)  txt.textContent  = `Talent disconnected · last seen ${secs}s ago`;
      if (stat) { stat.textContent = 'TALENT DROPPED'; stat.title = `Last heartbeat ${secs}s ago`; stat.classList.remove('connected'); }
    }
  }, 3000);
}

function initPrompter() {
  startTalentWatchdog();
  _ensurePrompterOperatorBridge(true);
  _setPrompterStatus(_prompterHasRecentTalent());
}

function _setPrompterStatus(connected, unavailable=false) {
  const dot = document.getElementById('prompterDot');
  const txt = document.getElementById('prompterStatusTxt');
  const stat = document.getElementById('ls-stat-prompter');
  if (unavailable) {
    if (dot) dot.className='ls-prompter-dot off';
    if (txt) txt.textContent='Not available';
    if (stat) { stat.textContent='FLOWMINGO OFF'; stat.title='Flowmingo offline'; stat.classList.remove('connected'); }
    return;
  }
  if (connected) {
    if (dot) dot.className='ls-prompter-dot';
    if (txt) txt.textContent='Connected';
    if (stat) { stat.textContent='FLOWMINGO ON'; stat.title='Flowmingo connected and functioning'; stat.classList.add('connected'); }
  } else {
    if (dot) dot.className='ls-prompter-dot off';
    if (txt) txt.textContent='Waiting for Flowmingo…';
    if (stat) { stat.textContent='FLOWMINGO WAIT'; stat.title='Flowmingo waiting'; stat.classList.remove('connected'); }
  }
}

function updatePrompterOnAdvance(prevBeat, newBeat) {
  if (!prompterText.trim()) buildPromptFromRundown();
  const rowNum = (beats.indexOf(newBeat) >= 0) ? beats.indexOf(newBeat) + 1 : 0;
  Promise.resolve(sendToPrompter(false)).then(pushed => {
    if (!pushed || !rowNum) return;
    setTimeout(() => sendPrompterControl(`seek_row_${rowNum}`), 140);
  });
}

function cuePrompterToLiveRow() {
  const rowNum = lsIdx + 1;
  if (rowNum > 0) setTimeout(() => sendPrompterControl(`seek_row_${rowNum}`), 120);
}

async function sendToPrompter(isInit=false) {
  const el = livePrompterEditor();
  if (el && (livePrompterDraftDirty || document.activeElement === el)) {
    adoptPrompterText(livePrompterEditorText(), { forceEditor:true, source:'live-edit' });
  } else {
    adoptPrompterText(prompterText, { forceEditor:true, source:prompterSource || 'live' });
  }
  const version = nextPrompterVersion();
  const updatedAt = prompterUpdatedAt || Date.now();
  markLivePrompterStatus('Updating...', 'busy');
  _postPrompterMessage(getPrompterPayload(isInit));
  // Also update the native built-in Flowmingo screen
  if (isInit) {
    ptInitScriptFromCueola(prompterText);
  } else {
    ptUpdateFromCueola(prompterText);
  }
  try {
    if (window._firebaseReady && session.code && !session.isDemo) {
      const cur = beats[lsIdx] || null;
      const next = beats[lsIdx+1] || null;
      await window._updateDoc(window._doc(window._db,'sessions',session.code),{
        'prompter.text':prompterText,
        'prompter.version':version,
        'prompter.updatedAt':updatedAt,
        'prompter.source':prompterSource || 'live',
        'prompter.sender':FLOWMINGO_ENDPOINT_ID,
        'prompter.senderClient':CLIENT_ID,
        'prompter.showName':show.name||'Untitled Show',
        'prompter.activeIdx':lsIdx,
        'prompter.currentRow':cur ? { index:lsIdx, name:cur.info||'', duration:fmtDur(cur) } : null,
        'prompter.nextRow':next ? { index:lsIdx+1, name:next.info||'', duration:fmtDur(next) } : null
      });
    }
    markLivePrompterStatus('Updated', 'ok');
    return true;
  } catch (err) {
    markLivePrompterStatus('Update failed', 'error');
    toast(firebaseConnectionLabel(err, 'Flowmingo update failed'));
    return false;
  } finally {
    renderLivePrompterControls();
  }
}

function updateLsPrompter() {
  setLivePrompterEditorText(prompterText);
}

// Inspector tabs (Keynote-style): one control group at a time in the Script Op
// drawer. The chosen tab is remembered so the panel reopens where you work.
const LS_INSP_LABELS = { transport: 'Prompter', live: 'Cue & On Air', clock: 'Clocks & Alerts', format: 'Formatting & Markers' };
function lsInspTab(key) {
  if (!LS_INSP_LABELS[key]) key = 'transport';
  document.querySelectorAll('#lsOperatorDrawer .insp-tab').forEach(b => {
    const on = b.getAttribute('data-insp') === key;
    b.classList.toggle('on', on);
    b.setAttribute('aria-selected', on ? 'true' : 'false');
  });
  document.querySelectorAll('#lsOperatorDrawer .insp-pane').forEach(p => p.classList.toggle('on', p.getAttribute('data-insp-pane') === key));
  const cap = document.getElementById('lsInspCaption');
  if (cap) cap.textContent = LS_INSP_LABELS[key];
  try { localStorage.setItem('cueola_insp_tab', key); } catch {}
}
function lsInspRestoreTab() {
  let key = 'transport';
  try { key = localStorage.getItem('cueola_insp_tab') || 'transport'; } catch {}
  lsInspTab(key);
}

function renderLivePrompterControls() {
  // Live actions stay visible in the sidebar;
  // the full transport block lives in a collapsible disclosure below.
  const live = document.getElementById('lsLiveActions');
  if (live) live.innerHTML = liveActionsHTML('lsq');
  const clocks = document.getElementById('lsClockActions');
  if (clocks) clocks.innerHTML = clockAndAlertControlsHTML('lsq');
  else if (live) live.innerHTML += clockAndAlertControlsHTML('lsq');
  const el = document.getElementById('lsPrompterRemote');
  if (el) el.innerHTML = promptOpControlsHTML(false);
  renderPromptOpClockPreview();
  lsInspRestoreTab();   // keep the remembered inspector tab active across re-renders
}

// ── Script Op pop-out controls ─────────────────────────────────────────────
// "Pop out" floats the whole Script Op panel into a movable, resizable window
// so the operator keeps a lot of controls at the ready. We toggle a class on
// the sidebar in place (no DOM moving), so every .ls-sidebar-scoped control
// rule keeps applying and renderLivePrompterControls() still works unchanged.
// "Pop out" now opens the Script Op controls in a REAL, scaled, resizable browser
// window (drag it to another monitor). The new window boots the app at
// ?scriptop=<code>, auto-joins the SAME session, goes live and opens the Script Op
// panel — so it drives the same Flowmingo through the existing session sync (the
// session is the bridge; no separate messaging layer needed).
let _scriptOpWin = null;
function toggleScriptOpPopout() { openScriptOpPopout(); }

function openScriptOpPopout() {
  if (document.body.classList.contains('scriptop-popout')) return; // already inside a pop-out window
  const code = (session.code || '').trim();
  if (!code || session.isDemo) { toast('Script Op pop-out needs a live (non-demo) session.'); return; }
  if (_scriptOpWin && !_scriptOpWin.closed) { _scriptOpWin.focus(); return; }
  const url = location.origin + location.pathname + '?scriptop=' + encodeURIComponent(code)
    + (session.userName ? '&name=' + encodeURIComponent(session.userName) : '');
  const w = Math.min(560, (screen.availWidth || 1280) - 40);
  const h = Math.min(940, (screen.availHeight || 900) - 40);
  _scriptOpWin = window.open(url, 'cueolaScriptOp_' + code, `width=${w},height=${h},menubar=no,toolbar=no,location=no,status=no`);
  if (!_scriptOpWin) { toast('Pop-out blocked — allow pop-ups for Cueola.'); return; }
  const btn = document.getElementById('lsPopoutBtn');
  if (btn) { setSymbolButtonLabel(btn, 'action.fullscreen', 'Script Op window'); btn.classList.add('active'); }
  toast('Script Op opened in a new window — drag it to another monitor.');
}

function dockScriptOpPopout() {
  if (_scriptOpWin && !_scriptOpWin.closed) { try { _scriptOpWin.close(); } catch (e) {} }
  _scriptOpWin = null;
  const btn = document.getElementById('lsPopoutBtn');
  if (btn) { setSymbolButtonLabel(btn, 'action.fullscreen', 'Pop out'); btn.classList.remove('active'); }
}

// Drag the divider under the script to grow/shrink the "Live Flowmingo script"
// editor — drag down to reveal more of the script (the controls drawer takes the rest).
let _scriptHeightDrag = null;
function applyScriptOpHeight(h) {
  const ta = document.getElementById('lsPrompterText');
  if (!ta) return;
  if (h == null || isNaN(h)) { ta.style.flex = ''; return; }
  ta.style.flex = '0 0 ' + Math.round(h) + 'px';
}
function startScriptHeightResize(e) {
  const ta = document.getElementById('lsPrompterText');
  if (!ta) return;
  _scriptHeightDrag = { startY: e.clientY, startH: ta.getBoundingClientRect().height };
  document.body.style.userSelect = 'none';
  window.addEventListener('pointermove', _scriptHeightMove);
  window.addEventListener('pointerup', _scriptHeightEnd);
  e.preventDefault();
}
function _scriptHeightMove(e) {
  const ta = document.getElementById('lsPrompterText');
  if (!ta || !_scriptHeightDrag) return;
  const sidebar = ta.closest('.ls-sidebar');
  const maxH = sidebar ? Math.max(180, sidebar.getBoundingClientRect().height - 200) : 1400;
  const h = Math.max(140, Math.min(maxH, _scriptHeightDrag.startH + (e.clientY - _scriptHeightDrag.startY)));
  applyScriptOpHeight(h);
}
function _scriptHeightEnd() {
  _scriptHeightDrag = null;
  document.body.style.userSelect = '';
  window.removeEventListener('pointermove', _scriptHeightMove);
  window.removeEventListener('pointerup', _scriptHeightEnd);
  const ta = document.getElementById('lsPrompterText');
  try { if (ta) localStorage.setItem('cueola_scriptOpHeight', parseFloat(ta.style.flexBasis) || ''); } catch (e) {}
}

// The Cue scrubber should show WHERE it is in the script, not just move the
// talent screen — mirror the scrub position into the Script Op editor so the
// operator watches the text fly by as they drag.
function lsScrubPreviewScript(pct) {
  const ta = document.getElementById('lsPrompterText');
  if (!ta) return;
  const p = Math.max(0, Math.min(100, parseFloat(pct) || 0)) / 100;
  ta.scrollTop = p * Math.max(0, ta.scrollHeight - ta.clientHeight);
}

async function pushToPrompter() {
  const el = livePrompterEditor();
  if (el) adoptPrompterText(livePrompterEditorText(), { forceEditor:true, source:'live-edit' });
  const draftVersion = livePrompterDraftVersion;
  const pushed = await sendToPrompter();
  if (pushed && draftVersion === livePrompterDraftVersion) livePrompterDraftDirty = false;
  if (promptOpMode) renderLivePromptOp();
  if (pushed) toast('Pushed to Flowmingo');
}

function queueLivePrompterDraftPush() {
  livePrompterDraftDirty = true;
  livePrompterDraftVersion += 1;
  adoptPrompterText(livePrompterEditorText(), { source:'live-edit' });
  markLivePrompterStatus('Draft held', 'busy');
  clearTimeout(livePrompterDraftTimer);
  livePrompterDraftTimer = setTimeout(() => {
    if (livePrompterDraftDirty) markLivePrompterStatus('Ready to push', 'busy');
  }, 700);
}

function clearPrompter() {
  if (!dangerConfirm('Clear Flowmingo text?', 'This pushes an empty script to the talent display for this session.', { requireText:'CLEAR' })) return;
  adoptPrompterText('', { forceEditor:true, source:'cleared' });
  livePrompterDraftDirty = false;
  sendToPrompter(true); // reset scroll on clear
}

function buildPrompterControl(action, source='script-op') {
  const ts = Date.now();
  return {
    type:'prompter_control',
    action,
    ts,
    source,
    controlId: nextPrompterMsgId('control')
  };
}

function isQuietPrompterControl(action) {
  return !action || action.endsWith('_stop') || action.includes('_set_');
}

// "Collaborative" controls set discrete talent state (clock, wrap-up, question,
// stand-by slate) or jump the cue position — they're last-writer-wins and never
// fight the live scroll the way transport (play/speed/brake/boost/direction) does.
// A connected Flowmingo Op arms a 30s "remote has control" lockout on the Script Op
// desk; that's meant to stop the desk stomping the remote's SCROLL, but it was also
// silently swallowing these complementary commands. Let them through so the desk can
// always drive the clock/cue even while the remote handles scrolling.
function isCollaborativePrompterControl(action) {
  if (!action) return false;
  return action.startsWith('clock_')
      || action.startsWith('wrapup_')
      || action.startsWith('question_')
      || action.startsWith('slate_')
      || action.startsWith('seek_');   // cue to row / scrub position
}

function trackPrompterControl(control, origin='live', quiet=false) {
  if (!control?.controlId || quiet || isQuietPrompterControl(control.action)) return;
  const label = flowOpControlLabel(control.action);
  clearTimeout(_pendingPrompterControls[control.controlId]?.waitTimer);
  clearTimeout(_pendingPrompterControls[control.controlId]?.failTimer);
  const waitTimer = setTimeout(() => {
    if (!_pendingPrompterControls[control.controlId]) return;
    if (origin === 'flowop') flowOpSetStatus(`${label} sent · waiting for talent`);
    else markLivePrompterStatus(`${label} sent`, 'busy');
  }, _prompterHasRecentTalent() ? 900 : 0);
  const failTimer = setTimeout(() => {
    if (!_pendingPrompterControls[control.controlId]) return;
    delete _pendingPrompterControls[control.controlId];
    if (origin === 'flowop') flowOpSetStatus(`${label} sent · no talent ack`, true);
    else markLivePrompterStatus('No talent ack', 'busy');
  }, 5000);
  _pendingPrompterControls[control.controlId] = { action:control.action, origin, waitTimer, failTimer };
}

function openPrompterApp() {
  sessionStorage.setItem('cueola_screen', 'entry');
  enterPrompter();
}

function openFlowmingoTalentWindow() {
  initPrompter(); // make sure this window answers the new tab's pings with the current script
  const url = new URL(location.href);
  url.searchParams.set('prompter', '1');
  if (session.code) url.searchParams.set('code', session.code);
  url.hash = 'flowmingo';
  const win = window.open(url.toString(), 'cueola-flowmingo-talent');
  if (!win) {
    toast('Allow pop-ups to open Flowmingo in a new window.');
    enterPrompter();
  }
}

function sendPrompterPreviewControl(action) {
  _ensurePrompterOperatorBridge();
  const control = buildPrompterControl(action, 'script-op-preview');
  _postPrompterMessage(control);
  ptHandleRemoteControl(action);
}

function sendPrompterControl(action) {
  if (livePrompterOpen && Date.now() < flowmingoRemoteOverrideUntil && !isCollaborativePrompterControl(action)) {
    markLivePrompterStatus('Flowmingo Op has control', 'busy');
    return;
  }
  _ensurePrompterOperatorBridge();
  const control = buildPrompterControl(action, 'script-op');
  _postPrompterMessage(control);
  trackPrompterControl(control, 'live');
  ptHandleRemoteControl(action);
  if (promptOpMode && !action.endsWith('_stop') && !action.includes('_set_')) renderLivePromptOp();
  if (!promptOpMode && !action.endsWith('_stop') && !action.includes('_set_')) renderLivePrompterControls();
  if (window._firebaseReady && session.code && !session.isDemo) {
    window._updateDoc(window._doc(window._db,'sessions',session.code),{
      'prompter.control': { ...control, sender:FLOWMINGO_ENDPOINT_ID, senderClient:CLIENT_ID },
      'prompter.updatedAt': control.ts
    }).catch(()=>{});
  }
}

// ─────────────────────────────────────────────────────────────
// PROMPTYPUS — native teleprompter screen
// ─────────────────────────────────────────────────────────────

// State
let ptPlaying = false;
let ptOffset = 0;
let ptLastTime = null;
let ptAnimFrame = null;
let ptTargetSpeed = 60;
let ptLiveSpeed = 60;
let ptBraking = false;
let ptBoosting = false;
let ptReversing = false;
let ptMirrored = false;
let ptPanelVisible = true;
let ptFontSize = 52;
let ptAlign = 'center';
let ptThemeName = normalizeCueolaTheme(localStorage.getItem('promptypus_theme') || 'cool');
let ptIdleTimer = null;
let ptKeydownHandler = null;
let ptKeyupHandler = null;
let ptReceiverChannels = [];
let ptReceiverStorageHandler = null;
let _seenPrompterMsgIds = [];   // dedup messages delivered via both BroadcastChannel and localStorage
const _appliedControlSigs = new Set(); // dedup the same control across every transport (BC, storage, Firestore) — a small FIFO of recent signatures so a lagging transport can't re-apply an older control that a faster one already delivered
let ptLinkedCueolaCode = '';
let ptSeenPauseMarkers = new Set();
let livePrompterDraftTimer = null;
let livePrompterStatusTimer = null;
let livePrompterDraftDirty = false;
let livePrompterDraftVersion = 0;
let flowOpCode = '';
let flowOpSub = null;
let flowOpData = null;
let flowOpPlaying = false;
let flowOpReturnScreen = 'entry';
let flowOpKeydownHandler = null;
let flowOpKeyupHandler = null;
let flowOpLastRemoteControlTs = 0;
let ptTechSlateOn = false;    // talent stand-by ("technical difficulties") cover
let flowOpTechSlate = false;  // mirror of the slate state on the standalone Flowmingo Op
let ptColorBarsOn = false;    // generated NTSC bars on the talent display
let flowOpColorBarsOn = false;
let ptQuestionOn = false;
let flowOpQuestionOn = false;
let ptClockState = { mode:'off', label:'', targetTs:0, size:1 };
let flowOpClockState = { mode:'off', label:'', targetTs:0, size:1 };
// Operator-entered clock inputs — persisted so a panel re-render doesn't wipe the
// typed duration / count-to time (which broke "change duration" + "countdown to time").
let flowClockDurationMin = 5;
let flowWrapCustomMin = 3;   // custom "Wrap in (min)" — survives control-panel re-renders
let flowClockCountTime = '';
function setFlowClockDuration(v) { const n = parseInt(v, 10); if (!isNaN(n)) flowClockDurationMin = Math.max(1, Math.min(999, n)); }
function setFlowWrapCustomMin(v) { const n = parseInt(v, 10); if (!isNaN(n)) flowWrapCustomMin = Math.max(1, Math.min(999, n)); }
function setFlowClockCountTime(v) { flowClockCountTime = (v || '').trim(); }
let ptClockInterval = null;
const FLOWMINGO_AUTO_PAUSE_RE = /\[(?:BREAK|AUTO PAUSE|PAUSE|STOP HERE|HOLD|TECHNICAL DIFFICULTIES)(?:[^\]]*)\]/i;

const PT_THEMES = {
  warm:     { bg:'#0c0a03', text:'#fdf6e3', accent:'#ffc400', uiBg:'rgba(28,22,8,.92)',     uiBorder:'rgba(255,196,0,.30)' },
  cool:     { bg:'#08090f', text:'#d6e8f0', accent:'#7eb8c8', uiBg:'rgba(15,15,25,.92)',    uiBorder:'rgba(126,184,200,.25)' },
  white:    { bg:'#ffffff', text:'#000000', accent:'#e50000', uiBg:'rgba(255,255,255,.95)', uiBorder:'rgba(229,0,0,.20)' },
  green:    { bg:'#040d05', text:'#e8f5d5', accent:'#7ddb33', uiBg:'rgba(7,19,8,.92)',      uiBorder:'rgba(125,219,51,.25)' },
  koala:    { bg:'#1f1f1e', text:'#ffffff', accent:'#ffffff', uiBg:'rgba(38,38,38,.92)',    uiBorder:'rgba(255,255,255,.28)' },
  panda:    { bg:'#000000', text:'#ffffff', accent:'#ffffff', uiBg:'rgba(10,10,10,.92)',    uiBorder:'rgba(255,255,255,.28)' },
  flamingo: { bg:'#330512', text:'#ffffff', accent:'#de4b9a', uiBg:'rgba(59,20,41,.88)',    uiBorder:'rgba(222,75,154,.34)' },
  outrangutan: { bg:'#0c0906', text:'#ffffff', accent:'#ff6a00', uiBg:'rgba(26,18,11,.88)', uiBorder:'rgba(255,106,0,.38)' },
  prepbear: { bg:'#080912', text:'#ffffff', accent:'#eeca57', uiBg:'rgba(20,23,42,.92)',    uiBorder:'rgba(238,202,87,.30)' },
};

const PT_SVG_PLAY  = `<svg width="10" height="12" viewBox="0 0 10 12" fill="currentColor"><path d="M0 0 L10 6 L0 12Z"/></svg>`;
const PT_SVG_PAUSE = `<svg width="10" height="12" viewBox="0 0 10 12" fill="currentColor"><rect x="0" y="0" width="3.5" height="12" rx="1"/><rect x="6.5" y="0" width="3.5" height="12" rx="1"/></svg>`;

function ptEl(id) { return document.getElementById(id); }

function ptPostOperatorMessage(payload) {
  const msgObj = withPrompterEnvelope(payload);
  ptReceiverChannels.forEach(ch => {
    try { ch.postMessage(msgObj); } catch {}
  });
  try {
    const msg = JSON.stringify({...msgObj, storageNonce:Date.now()+Math.random()});
    localStorage.setItem(PROMPTYPUS_STORAGE_MSG, msg);
    localStorage.setItem(PROMPTYPUS_LEGACY_STORAGE_MSG, msg);
  } catch {}
  return msgObj;
}

function ptPostPing(reason='heartbeat') {
  const ping = withPrompterEnvelope({ type:'ping', reason, sessionCode:ptLinkedCueolaCode || session.code || '' });
  ptReceiverChannels.forEach(ch => {
    try { ch.postMessage(ping); } catch {}
  });
  try {
    const msg = JSON.stringify({...ping, storageNonce:Date.now()+Math.random()});
    localStorage.setItem(PROMPTYPUS_STORAGE_PING, msg);
    localStorage.setItem(PROMPTYPUS_LEGACY_STORAGE_PING, msg);
  } catch {}
}

// Ping a few times right after connecting so the operator answers fast, instead
// of waiting up to 5s for the next hello cycle.
function ptPingBurst() {
  [0, 250, 750, 1500, 3000].forEach(d => setTimeout(() => ptPostPing('ready'), d));
}

function ptAdoptCueolaBridgeMessage(msg={}) {
  const code = String(msg.sessionCode || '').trim().toUpperCase();
  if (code) {
    ptLinkedCueolaCode = code;
    if (!session.code || session.isDemo) {
      session.code = code;
      session.isDemo = false;
      session.isExpert = false;
    }
    const ci = ptEl('pt-cueola-code-input');
    if (ci && !ci.value) ci.value = code;
    const setup = ptEl('pt-setup-code');
    if (setup && !setup.value) setup.value = code;
  }
  if (code || msg.showName) {
    ptConnState = 'connected';
    ptConnMessage = '';
  }
}

function ptHandleCueolaMessage(msg) {
  if (!msg || isPrompterSelfSender(msg.sender)) return;
  // Dedup: each message is sent over BroadcastChannel AND localStorage, so it
  // arrives twice. Skip repeats by id instead of dropping by timestamp (which
  // broke across devices with skewed clocks and re-applied relative controls).
  const mid = msg.mid || `${msg.sender || ''}-${msg.ts || 0}-${msg.type || ''}`;
  if (_seenPrompterMsgIds.includes(mid)) return;
  _seenPrompterMsgIds.push(mid);
  if (_seenPrompterMsgIds.length > 120) _seenPrompterMsgIds = _seenPrompterMsgIds.slice(-60);
  if (msg.type === 'cueola_hello') {
    ptAdoptCueolaBridgeMessage(msg);
    ptPostPing('ready');
    ptUpdateSyncLabel();
  }
  if (msg.type === 'script_init' && msg.text != null) {
    ptAdoptCueolaBridgeMessage(msg);
    adoptPrompterText(msg.text || '', { version:Number(msg.version)||0, updatedAt:Number(msg.ts)||0, source:msg.source || 'bridge' });
    ptInitScriptFromCueola(prompterText);
    ptPostPing();
  }
  if (msg.type === 'script_update' && msg.text != null) {
    ptAdoptCueolaBridgeMessage(msg);
    adoptPrompterText(msg.text || '', { version:Number(msg.version)||0, updatedAt:Number(msg.ts)||0, source:msg.source || 'bridge' });
    ptUpdateFromCueola(prompterText);
  }
  if (msg.type === 'prompter_control' && msg.action) {
    applyRemoteControlOnce(msg.action, msg.ts, msg.sender, msg.controlId);
  }
}

function ptLoadSavedOrDefault() {
  const textEl = ptEl('pt-text');
  if (!textEl || textEl.textContent.trim()) return;
  const saved = (() => { try { return localStorage.getItem('promptypus_script_html'); } catch { return null; } })();
  if (saved) {
    ptSetScriptHTML(saved);
    return;
  }
  ptSetScriptText(
    'Welcome to Flowmingo\n\n' +
    'Upload a PDF, DOCX, Pages, TXT, or Markdown file, or paste your script directly.\n\n' +
    'Cueola can feed Flowmingo when you have a session code, but it is optional.\n\n' +
    'Press PLAY, or tap the stage, to begin scrolling.\n\n' +
    'Use the controls to adjust speed, text size, alignment, theme, mirror, and fullscreen.'
  );
  ptScriptIsPlaceholder = true; // mark the welcome default so the setup card still shows
  ptUpdateReady();
}

// Talent heartbeat: a ping every ~6s so the operator can tell at a glance
// whether the talent screen is alive (BroadcastChannel for same browser,
// Firestore prompter.talentHeartbeat for cross-device).
let ptHeartbeatInterval = null;
function ptTalentHeartbeat() {
  // Publish "talent online" only while the talent screen is actually up —
  // otherwise operators see a phantom talent long after this tab left the screen.
  if (!document.getElementById('promptypus')?.classList.contains('on')) return;
  ptPostPing('heartbeat');
  if (window._firebaseReady && ptLinkedCueolaCode && window._updateDoc && window._doc && window._db) {
    try {
      window._updateDoc(window._doc(window._db, 'sessions', ptLinkedCueolaCode), {
        'prompter.talentHeartbeat': { ts: Date.now(), sender: FLOWMINGO_ENDPOINT_ID, senderClient: CLIENT_ID }
      }).catch(() => {});
    } catch {}
  }
}

function ptInitReceiver() {
  if (ptReceiverChannels.length || ptReceiverStorageHandler) {
    ptPingBurst();
    return;
  }
  try {
    [PROMPTYPUS_CHANNEL, PROMPTYPUS_LEGACY_CHANNEL].forEach(name => {
      const ch = new BroadcastChannel(name);
      ch.onmessage = e => ptHandleCueolaMessage(e.data);
      ptReceiverChannels.push(ch);
    });
  } catch {}
  ptReceiverStorageHandler = (e) => {
    if (![PROMPTYPUS_STORAGE_MSG, PROMPTYPUS_LEGACY_STORAGE_MSG].includes(e.key) || !e.newValue) return;
    try { ptHandleCueolaMessage(JSON.parse(e.newValue)); } catch {}
  };
  window.addEventListener('storage', ptReceiverStorageHandler);
  ptPingBurst();
  if (!ptHeartbeatInterval) ptHeartbeatInterval = setInterval(ptTalentHeartbeat, 6000);
}

function ptGetMaxScroll() {
  const track = ptEl('pt-track');
  return track ? track.scrollHeight - (window.innerHeight - 48) : 0;
}

function ptUpdateProgress() {
  const max = ptGetMaxScroll();
  const pct = max > 0 ? Math.min(100, (ptOffset / max) * 100) : 0;
  const prog = ptEl('pt-progress');
  if (prog) prog.style.width = pct + '%';
  // Keep the operator cue scrubber tracking the live position (unless being dragged).
  // Only when there's a real scrollable track here — in the Script Op (no rendered talent
  // track, max=0) leave the scrubber where the operator set it instead of snapping to 0.
  if (max > 0) ['po-seek', 'lsq-seek'].forEach(id => {
    const s = document.getElementById(id);
    if (s && document.activeElement !== s && s.dataset.seekDragging !== '1') s.value = Math.round(pct);
  });
}

function ptResetAutoPauseMarkers() {
  ptSeenPauseMarkers = new Set();
}

function ptCheckAutoPauseMarkers() {
  if (!ptPlaying) return false;
  const text = ptEl('pt-text');
  if (!text) return false;
  const readY = window.innerHeight / 2 + 24;
  const lines = Array.from(text.querySelectorAll('p'));
  for (let i = 0; i < lines.length; i++) {
    const lineText = lines[i].innerText || lines[i].textContent || '';
    if (!FLOWMINGO_AUTO_PAUSE_RE.test(lineText)) continue;
    const key = `${i}:${lineText}`;
    if (ptSeenPauseMarkers.has(key)) continue;
    const rect = lines[i].getBoundingClientRect();
    if (rect.top <= readY && rect.bottom >= readY) {
      ptSeenPauseMarkers.add(key);
      ptStopPlay();
      toast('Flowmingo auto-paused at break.');
      return true;
    }
  }
  return false;
}

function ptScrollLoop(ts) {
  if (!ptPlaying) return;
  if (ptLastTime === null) ptLastTime = ts;
  const delta = ts - ptLastTime;
  ptLastTime = ts;

  if (ptBraking) {
    ptLiveSpeed = Math.max(ptTargetSpeed * 0.25, 2);
  } else if (ptBoosting) {
    ptLiveSpeed = Math.min(ptTargetSpeed * 2.5, 300);
  } else {
    ptLiveSpeed += (ptTargetSpeed - ptLiveSpeed) * 0.06;
    if (Math.abs(ptLiveSpeed - ptTargetSpeed) < 0.5) ptLiveSpeed = ptTargetSpeed;
  }

  const step = (ptLiveSpeed / 60) * (delta / 16.67);
  ptOffset += ptReversing ? -step : step;
  const max = ptGetMaxScroll();
  if (ptOffset >= max) {
    ptOffset = max;
    ptStopPlay();
  } else {
    if (ptOffset < 0) ptOffset = 0;
    const track = ptEl('pt-track');
    if (track) track.style.transform = `translateY(-${ptOffset}px)`;
    ptUpdateProgress();
    if (ptCheckAutoPauseMarkers()) return;
    ptAnimFrame = requestAnimationFrame(ptScrollLoop);
  }
}

function ptSyncPlayIcons(isPlaying) {
  const icon = ptEl('pt-play-icon');
  ['pt-play-btn', 'po-play-btn'].forEach(id => {
    const btn = document.getElementById(id);
    if (!btn) return;
    btn.innerHTML = `${isPlaying ? PT_SVG_PAUSE : PT_SVG_PLAY} ${isPlaying ? 'PAUSE' : 'PLAY'}`;
    btn.classList.toggle('active', isPlaying);
  });
  if (icon) icon.innerHTML = isPlaying ? PT_SVG_PAUSE : PT_SVG_PLAY;
}

function promptOpControlsHTML(includeLiveActions = true) {
  const playAction = ptPlaying ? 'pause' : 'resume';
  const playLabel = ptPlaying ? 'PAUSE' : 'PLAY';
  const playIcon = ptPlaying ? PT_SVG_PAUSE : PT_SVG_PLAY;
  const transport = `<div class="flow-control-section flow-control-transport">
      <div class="flow-control-title">Transport</div>
      <div class="flow-control-grid one">
        <button class="pt-btn${ptPlaying?' active':''}" id="po-play-btn" onclick="sendPrompterControl('${playAction}')" aria-pressed="${ptPlaying ? 'true' : 'false'}">${playIcon}<span>${playLabel}</span></button>
      </div>
      <div class="flow-control-grid four">
        <button class="pt-btn" onpointerdown="sendPrompterControl('brake_start')" onpointerup="sendPrompterControl('brake_stop')" onpointerleave="sendPrompterControl('brake_stop')">Brake</button>
        <button class="pt-btn" onpointerdown="sendPrompterControl('boost_start')" onpointerup="sendPrompterControl('boost_stop')" onpointerleave="sendPrompterControl('boost_stop')">Boost</button>
        <button class="pt-btn" onclick="sendPrompterControl('direction_reverse')">Reverse</button>
        <button class="pt-btn" onclick="sendPrompterControl('direction_forward')">Forward</button>
      </div>
    </div>`;
  const display = `<div class="flow-control-section flow-control-display">
      <div class="flow-control-title">Display</div>
      <div class="pt-ctrl-group flow-control-slider">
        <span class="pt-ctrl-label">Speed</span>
      <button class="pt-btn" onclick="sendPrompterControl('speed_down')">−</button>
      <input type="range" class="pt-range" min="5" max="200" value="${ptTargetSpeed}" oninput="ptSetSpeed(this.value);sendPrompterPreviewControl('speed_set_'+this.value)" onchange="sendPrompterControl('speed_set_'+this.value)">
      <button class="pt-btn" onclick="sendPrompterControl('speed_up')">+</button>
      </div>
      <div class="pt-ctrl-group flow-control-slider">
        <span class="pt-ctrl-label">Size</span>
      <button class="pt-btn" onclick="sendPrompterControl('size_down')">−</button>
      <input type="range" class="pt-range" min="24" max="120" value="${ptFontSize}" oninput="ptSetSize(this.value);sendPrompterPreviewControl('size_set_'+this.value)" onchange="sendPrompterControl('size_set_'+this.value)">
      <button class="pt-btn" onclick="sendPrompterControl('size_up')">+</button>
      </div>
      <div class="pt-ctrl-group flow-control-segment">
        <span class="pt-ctrl-label">Align</span>
        <button class="pt-btn${ptAlign==='left'?' active':''}" onclick="sendPrompterControl('align_left')" aria-label="Align left"><svg width="14" height="12" viewBox="0 0 14 12" fill="currentColor"><rect x="0" y="0" width="14" height="2" rx="1"/><rect x="0" y="5" width="9" height="2" rx="1"/><rect x="0" y="10" width="12" height="2" rx="1"/></svg></button>
        <button class="pt-btn${ptAlign==='center'?' active':''}" onclick="sendPrompterControl('align_center')" aria-label="Align center"><svg width="14" height="12" viewBox="0 0 14 12" fill="currentColor"><rect x="0" y="0" width="14" height="2" rx="1"/><rect x="2.5" y="5" width="9" height="2" rx="1"/><rect x="1" y="10" width="12" height="2" rx="1"/></svg></button>
        <button class="pt-btn${ptAlign==='right'?' active':''}" onclick="sendPrompterControl('align_right')" aria-label="Align right"><svg width="14" height="12" viewBox="0 0 14 12" fill="currentColor"><rect x="0" y="0" width="14" height="2" rx="1"/><rect x="5" y="5" width="9" height="2" rx="1"/><rect x="2" y="10" width="12" height="2" rx="1"/></svg></button>
      </div>
    </div>`;
  const theme = `<div class="flow-control-section flow-theme-section">
      <div class="flow-control-title">Theme</div>
      <div class="pt-ctrl-group flow-theme-grid ui-theme-grid">
        ${CUEOLA_THEMES.map(name => `<button type="button" class="ui-theme-tile pt-theme-dot${ptThemeName===name?' on active':''}" onclick="sendPrompterControl('theme_${name}')" title="${CUEOLA_THEME_LABELS[name] || name}" aria-label="${CUEOLA_THEME_LABELS[name] || name}"><span class="tt-prev" style="background:${PT_THEMES[name].bg}"></span><span class="tt-name">${CUEOLA_THEME_LABELS[name] || name}</span></button>`).join('')}
      </div>
    </div>`;
  const screen = `<div class="flow-control-section flow-control-screen">
      <div class="flow-control-title">Screen</div>
      <div class="flow-control-grid four">
        <button class="pt-btn" onclick="sendPrompterControl('reset')">Reset</button>
        <button class="pt-btn" onclick="sendPrompterControl('hide_interface')">Hide UI</button>
        <button class="pt-btn" onclick="sendPrompterControl('mirror')">Mirror</button>
        <button class="pt-btn" onclick="sendPrompterControl('fullscreen')">Full</button>
      </div>
    </div>`;
  // Script Op's Prompter pane: flat sections only — the drawer already has its own tabs.
  if (!includeLiveActions) return `<div class="prompt-op-panel flow-control-panel">${transport}${display}${theme}${screen}</div>`;
  // Operator overlay: the same inspector standard as the Script Op drawer —
  // icon tabs pick ONE flat group, no card grid.
  return `<div class="prompt-op-panel flow-control-panel op-insp" data-insp-scope="po">
    ${opInspHeadHTML('po')}
    <div class="insp-pane" data-insp-pane="transport">${transport}</div>
    <div class="insp-pane" data-insp-pane="live"><div class="ls-live-actions">${liveActionsHTML('po')}</div></div>
    <div class="insp-pane" data-insp-pane="clock">${clockAndAlertControlsHTML('po')}</div>
    <div class="insp-pane" data-insp-pane="display">${display}${theme}</div>
    <div class="insp-pane" data-insp-pane="screen">${screen}</div>
  </div>`;
}

// ── Operator overlay / Flowmingo Op inspector tabs ─────────────────────────
// Same pattern as the Script Op drawer (lsInspTab): icon tabs, one flat page,
// remembered per surface so each panel reopens where the operator works.
const OP_INSP_LABELS = { transport: 'Transport', live: 'Cue & On Air', clock: 'Clocks & Alerts', display: 'Display & Theme', screen: 'Screen' };
const OP_INSP_ICONS = { transport: 'media.play', live: 'content.display', clock: 'state.timed', display: 'content.script', screen: 'action.fullscreen' };
function opInspHeadHTML(scope) {
  return `<div class="insp-head op-insp-head">
    <div class="insp-tabs" role="tablist" aria-label="Operator control groups">
      ${Object.keys(OP_INSP_LABELS).map(key =>
        `<button type="button" class="insp-tab" role="tab" aria-selected="false" data-insp="${key}" onclick="opInspTab('${scope}','${key}')" title="${OP_INSP_LABELS[key]}"><span class="sf-symbol" data-symbol="${OP_INSP_ICONS[key]}" aria-hidden="true"></span></button>`).join('')}
    </div>
    <div class="insp-caption" data-insp-caption>${OP_INSP_LABELS.transport}</div>
  </div>`;
}
function opInspTab(scope, key) {
  if (!OP_INSP_LABELS[key]) key = 'transport';
  document.querySelectorAll(`.op-insp[data-insp-scope="${scope}"]`).forEach(panel => {
    panel.querySelectorAll('.insp-tab').forEach(b => {
      const on = b.getAttribute('data-insp') === key;
      b.classList.toggle('on', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    panel.querySelectorAll('.insp-pane').forEach(p => p.classList.toggle('on', p.getAttribute('data-insp-pane') === key));
    const cap = panel.querySelector('[data-insp-caption]');
    if (cap) cap.textContent = OP_INSP_LABELS[key];
  });
  try { localStorage.setItem(`cueola_op_insp_tab_${scope}`, key); } catch {}
}
function opInspRestoreTab(scope) {
  let key = 'transport';
  try { key = localStorage.getItem(`cueola_op_insp_tab_${scope}`) || 'transport'; } catch {}
  opInspTab(scope, key);
}

function ptStartPlay() {
  ptPlaying = true;
  ptLastTime = null;
  ptSyncPlayIcons(true);
  ptAnimFrame = requestAnimationFrame(ptScrollLoop);
}

function ptStopPlay() {
  ptPlaying = false;
  if (ptAnimFrame) cancelAnimationFrame(ptAnimFrame);
  ptAnimFrame = null;
  ptSyncPlayIcons(false);
}

function ptTogglePlay() {
  ptPlaying ? ptStopPlay() : ptStartPlay();
}

function ptSetSpeed(val) {
  ptTargetSpeed = parseFloat(val);
  ptLiveSpeed = ptTargetSpeed;
  const sl = ptEl('pt-speed-slider');
  if (sl) sl.value = val;
}

function ptAdjustSpeed(delta) {
  ptSetSpeed(Math.max(5, Math.min(200, ptTargetSpeed + delta)));
}

function ptSetSize(val) {
  ptFontSize = parseInt(val);
  const screen = ptEl('promptypus');
  if (screen) screen.style.setProperty('--pt-size', val + 'px');
  document.documentElement.style.setProperty('--pt-size', val + 'px');
  const sl = ptEl('pt-size-slider');
  if (sl) sl.value = val;
}

function ptAdjustSize(delta) {
  ptSetSize(Math.max(24, Math.min(120, ptFontSize + delta)));
}

function ptSetAlign(a) {
  ptAlign = a;
  const screen = ptEl('promptypus');
  if (screen) screen.style.setProperty('--pt-align', a);
  document.documentElement.style.setProperty('--pt-align', a);
  ['l','c','r'].forEach(x => {
    const btn = ptEl('pt-align-' + x);
    if (btn) btn.classList.toggle('active', x === a[0]);
  });
}

function ptResetScroll() {
  ptStopPlay();
  ptOffset = 0;
  ptResetAutoPauseMarkers();
  const track = ptEl('pt-track');
  if (track) track.style.transform = 'translateY(0)';
  ptUpdateProgress();
}

// Current scroll position as a 0–100 percentage (for the operator cue scrubber).
function ptProgressPct() {
  const max = ptGetMaxScroll();
  return max > 0 ? Math.round(Math.min(100, Math.max(0, (ptOffset / max) * 100))) : 0;
}

function ptApplyScrollOffset(offset) {
  const max = ptGetMaxScroll();
  ptOffset = Math.max(0, Math.min(max, Number(offset) || 0));
  const track = ptEl('pt-track');
  if (track) track.style.transform = `translateY(-${ptOffset}px)`;
  ptUpdateProgress();
}

// Live "cue" scroll — operators drag the talent prompter to any spot on the fly.
// Pure repositioning: never pauses, never writes a marker.
function ptSeekToProgress(pct) {
  const p = Math.max(0, Math.min(100, parseFloat(pct) || 0));
  const max = ptGetMaxScroll();
  ptApplyScrollOffset(max > 0 ? (p / 100) * max : 0);
}

function ptSeekToRow(rowNum) {
  const n = parseInt(rowNum, 10);
  if (!Number.isFinite(n) || n < 1) return;
  requestAnimationFrame(() => {
    const text = ptEl('pt-text');
    const track = ptEl('pt-track');
    if (!text || !track) return;
    const tag = `[${n}]`;
    const headers = Array.from(text.querySelectorAll('.scr-header'));
    const target = headers.find(h => String(h.textContent || '').trim().startsWith(tag));
    if (!target) return;
    const readY = window.innerHeight / 2 + 24;
    const fontSize = parseFloat(getComputedStyle(target).fontSize) || 22;
    const targetY = readY - Math.max(34, fontSize * 1.8);
    const delta = target.getBoundingClientRect().top - targetY;
    ptApplyScrollOffset(ptOffset + delta);
  });
}

// Full-screen generated slates. Instant hold + scroll pause.
function ptShowTechSlate() {
  ptTechSlateOn = true;
  ptColorBarsOn = false;
  ptStopPlay();
  const slate = ptEl('pt-slate');
  if (slate) {
    slate.classList.add('on');
    slate.classList.remove('bars');
  }
  syncTechButtons();
}
function ptShowColorBars() {
  ptColorBarsOn = true;
  ptTechSlateOn = false;
  ptStopPlay();
  const slate = ptEl('pt-slate');
  if (slate) {
    slate.classList.add('on', 'bars');
  }
  syncTechButtons();
}
function ptHideAllSlates() {
  ptTechSlateOn = false;
  ptColorBarsOn = false;
  const slate = ptEl('pt-slate');
  if (slate) slate.classList.remove('on', 'bars');
  syncTechButtons();
}
function ptHideTechSlate() {
  ptHideAllSlates();
}
function ptHideColorBars() {
  ptHideAllSlates();
}

function anyTalentSlateOn() {
  return ptTechSlateOn || ptColorBarsOn;
}

function anyFlowOpSlateOn() {
  return flowOpTechSlate || flowOpColorBarsOn;
}

function setFlowOpSlateState(kind) {
  flowOpTechSlate = kind === 'tech';
  flowOpColorBarsOn = kind === 'bars';
  syncTechButtons();
}

// Keep every visible slate toggle in sync with the state.
function syncTechButtons() {
  const talentSlateOn = anyTalentSlateOn();
  const flowSlateOn = anyFlowOpSlateOn();
  ['lsq-tech-btn', 'po-tech-btn', 'flow-tech-btn'].forEach(id => {
    const b = document.getElementById(id);
    if (!b) return;
    const isFlow = id.startsWith('flow');
    const techOn = isFlow ? flowOpTechSlate : ptTechSlateOn;
    const anyOn = isFlow ? flowSlateOn : talentSlateOn;
    setSymbolButtonLabel(b, 'state.warning', techOn ? 'Back on air' : 'Tech Difficulty');
    b.classList.toggle('active', techOn);
    b.classList.toggle('muted', anyOn && !techOn);
  });
  ['lsq-bars-btn', 'po-bars-btn', 'flow-bars-btn'].forEach(id => {
    const b = document.getElementById(id);
    if (!b) return;
    const isFlow = id.startsWith('flow');
    const barsOn = isFlow ? flowOpColorBarsOn : ptColorBarsOn;
    const anyOn = isFlow ? flowSlateOn : talentSlateOn;
    setSymbolButtonLabel(b, 'content.display', barsOn ? 'Back on air' : 'NTSC Bars');
    b.classList.toggle('active', barsOn);
    b.classList.toggle('muted', anyOn && !barsOn);
  });
}

// Operator quick action (Script Op): throw up the stand-by slate AND record the
// marker in the script, or clear it. "Both" behaviour from the plan.
function toggleTechDifficulty() {
  if (anyTalentSlateOn()) {
    sendPrompterControl('slate_tech_off');
  } else {
    recordTechDifficultyMarker();
    sendPrompterControl('slate_tech_on');
  }
  // sendPrompterControl applies locally too, so state is up to date now.
  syncTechButtons();
}

function toggleColorBars() {
  sendPrompterControl(ptColorBarsOn ? 'slate_bars_off' : 'slate_bars_on');
  syncTechButtons();
}

function recordTechDifficultyMarker() {
  const marker = '[TECHNICAL DIFFICULTIES] ';
  const base = (prompterText || '').replace(/\s+$/, '');
  const next = base ? `${base}\n\n${marker}` : marker;
  adoptPrompterText(next, { forceEditor: true, source: 'tech-difficulty' });
  livePrompterDraftDirty = false;
  sendToPrompter();
}

// Fine nudge for the Script Op cue scrubber.
function poNudgeSeek(delta) {
  const sl = document.getElementById('po-seek') || document.getElementById('lsq-seek');
  const cur = sl ? parseFloat(sl.value) || 0 : ptProgressPct();
  const next = Math.max(0, Math.min(100, cur + delta));
  ['po-seek', 'lsq-seek'].forEach(id => { const s = document.getElementById(id); if (s) s.value = next; });
  sendPrompterControl('seek_set_' + next);
}

function poPunchInSeek(scope = 'lsq') {
  const sl = document.getElementById(`${scope}-seek`) || document.getElementById('lsq-seek') || document.getElementById('po-seek');
  const val = sl ? parseFloat(sl.value) || 0 : ptProgressPct();
  const next = Math.max(0, Math.min(100, val));
  sendPrompterControl('seek_set_' + next);
  sendPrompterControl('resume');
}

// Shared "Live actions" block: Tech Difficulty toggle + the live cue scrubber.
// scope: 'po' (prompt-op stage), 'lsq' (Script Op sidebar), 'flow' (Flowmingo Op).
function liveActionsHTML(scope = 'po', disabled = false) {
  const dis = disabled ? ' disabled' : '';
  const isFlow = scope === 'flow';
  const techOn = isFlow ? flowOpTechSlate : ptTechSlateOn;
  const barsOn = isFlow ? flowOpColorBarsOn : ptColorBarsOn;
  const techCall = isFlow ? 'flowOpToggleTechDifficulty()' : 'toggleTechDifficulty()';
  const barsCall = isFlow ? 'flowOpToggleColorBars()' : 'toggleColorBars()';
  const seekVal = isFlow ? 0 : ptProgressPct();
  const seekInput = isFlow
    ? `flowOpApplyControlPreview('seek_set_'+this.value,true)`
    : `sendPrompterPreviewControl('seek_set_'+this.value);lsScrubPreviewScript(this.value)`;
  const seekChange = isFlow
    ? ` onchange="flowOpSendControl('seek_set_'+this.value);this.dataset.seekDragging=''"`
    : ` onchange="sendPrompterControl('seek_set_'+this.value);this.dataset.seekDragging=''"`;
  // Mark the scrubber as actively dragged so the live-position sync can't yank its
  // value back mid-drag (which made the release land on the wrong spot / snap to 0).
  const seekDrag = ` onpointerdown="this.dataset.seekDragging='1'" onpointerup="this.dataset.seekDragging=''" onpointercancel="this.dataset.seekDragging=''"`;
  const nudge = d => isFlow ? `flowOpNudgeSeek(${d})` : `poNudgeSeek(${d})`;
  const punch = isFlow ? 'flowOpPunchInSeek()' : `poPunchInSeek('${scope}')`;
  const nextRowIdx = (() => {
    let i = lsIdx;
    do { i++; } while (i < beats.length && beats[i]?.style === 'segment');
    return i < beats.length ? i : -1;
  })();
  const rowCue = isFlow ? '' : `<div class="flow-control-section flow-control-rowcue">
      <div class="flow-control-title">Cue</div>
      <div class="pt-ctrl-group pt-live-rowcue flow-control-grid two">
        <button class="pt-btn" onclick="sendPrompterControl('seek_row_${Math.max(lsIdx, 0) + 1}')" title="Cue Flowmingo to the current rundown row"${dis}>${sfIcon('marker.active')}<span>Cue Now</span></button>
        <button class="pt-btn" onclick="sendPrompterControl('seek_row_${nextRowIdx + 1}')" title="Cue Flowmingo to the next rundown row"${nextRowIdx < 0 || disabled ? ' disabled' : ''}>${sfIcon('action.forward')}<span>Cue Next</span></button>
      </div>
    </div>`;
  // Returns bare control groups so they nest inside the existing panel containers
  // (prompt-op-panel / flowop-controls / #lsLiveActions) without overlapping them.
  return `${rowCue}
    <div class="flow-control-section flow-control-onair">
      <div class="flow-control-title">On Air</div>
      <div class="pt-ctrl-group pt-live-slate flow-control-grid two">
        <button class="pt-btn pt-tech-btn${techOn ? ' active' : ''}" id="${scope}-tech-btn" onclick="${techCall}" title="Show a Technical Difficulties stand-by cover on Flowmingo" aria-label="Toggle technical difficulties cover" aria-pressed="${techOn ? 'true' : 'false'}"${dis}>${sfIcon('state.warning')}<span>${techOn ? 'Back on air' : 'Tech Difficulty'}</span></button>
        <button class="pt-btn pt-bars-btn${barsOn ? ' active' : ''}" id="${scope}-bars-btn" onclick="${barsCall}" title="Generate NTSC color bars on Flowmingo" aria-label="Toggle NTSC color bars" aria-pressed="${barsOn ? 'true' : 'false'}"${dis}>${sfIcon('content.display')}<span>${barsOn ? 'Back on air' : 'NTSC Bars'}</span></button>
      </div>
    </div>
	    <div class="flow-control-section flow-control-cue">
	      <div class="flow-control-title">Scrub</div>
	      <div class="pt-ctrl-group pt-live-cue flow-control-slider">
	        <span class="pt-ctrl-label">Cue</span>
	        <button class="pt-btn pt-icon-btn" onclick="${nudge(-3)}" title="Cue back" aria-label="Cue prompter back"${dis}>${sfIcon('marker.go','pt-nudge-back')}</button>
	        <input type="range" class="pt-range" id="${scope}-seek" min="0" max="100" value="${seekVal}" aria-label="Cue prompter position" oninput="${seekInput}"${seekChange}${seekDrag}${dis}>
	        <button class="pt-btn pt-icon-btn" onclick="${nudge(3)}" title="Cue forward" aria-label="Cue prompter forward"${dis}>${sfIcon('marker.go','pt-nudge-forward')}</button>
	        <button class="pt-btn pt-icon-btn pt-punch-btn" onclick="${punch}" title="Punch in from this script position" aria-label="Punch in from this script position"${dis}>${sfIcon('media.play')}</button>
	      </div>
	    </div>`;
}

function ptToggleMirror() {
  ptMirrored = !ptMirrored;
  const stage = ptEl('pt-stage');
  if (stage) stage.classList.toggle('mirrored', ptMirrored);
  const screen = ptEl('promptypus');
  if (screen) screen.classList.toggle('mirrored', ptMirrored);
  const btn = ptEl('pt-mirror-btn');
  if (btn) btn.classList.toggle('active', ptMirrored);
}

function ptToggleFullscreen() {
  const el = ptEl('promptypus');
  if (!el) return;
  const isFull = document.fullscreenElement === el || document.webkitFullscreenElement === el;
  if (!isFull) {
    (el.requestFullscreen || el.webkitRequestFullscreen || function(){}).call(el);
  } else {
    (document.exitFullscreen || document.webkitExitFullscreen || function(){}).call(document);
  }
}

function ptTogglePanel() {
  ptPanelVisible = !ptPanelVisible;
  const panel = ptEl('pt-panel');
  const hint = ptEl('pt-hint');
  if (panel) panel.classList.toggle('hidden', !ptPanelVisible);
  if (hint) hint.classList.toggle('hidden', !ptPanelVisible);
  // Update Controls button label
  const btn = document.querySelector('.pt-bar-controls-btn');
  if (btn) btn.textContent = ptPanelVisible ? 'Controls' : 'Show Controls';
}

function ptSetTheme(name) {
  const t = PT_THEMES[name];
  if (!t) return;
  ptThemeName = name;
  const screen = ptEl('promptypus');
  if (!screen) return;
  screen.dataset.ptTheme = name;
  screen.style.setProperty('--pt-bg', t.bg);
  screen.style.setProperty('--pt-text', t.text);
  screen.style.setProperty('--pt-accent', t.accent);
  screen.style.setProperty('--pt-ui-bg', t.uiBg);
  screen.style.setProperty('--pt-ui-border', t.uiBorder);
  screen.style.background = name === 'flamingo'
    ? 'linear-gradient(135deg,#330512 0%,#411b48 50%,#3b1429 100%)'
    : name === 'koala'
      ? 'linear-gradient(135deg,#1f1f1e 0%,#262626 50%,#404040 100%)'
      : name === 'panda'
        ? 'linear-gradient(135deg,#000000 0%,#1e1e1e 50%,#000000 100%)'
        : name === 'outrangutan'
          ? '#100c09'
        : name === 'prepbear'
          ? 'linear-gradient(135deg,#080912 0%,#14172a 50%,#2f357c 100%)'
          : t.bg;
  document.documentElement.style.setProperty('--pt-bg', t.bg);
  document.documentElement.style.setProperty('--pt-text', t.text);
  document.documentElement.style.setProperty('--pt-accent', t.accent);
  document.documentElement.style.setProperty('--pt-ui-bg', t.uiBg);
  document.documentElement.style.setProperty('--pt-ui-border', t.uiBorder);
  try { localStorage.setItem('promptypus_theme', name); } catch {}
  document.querySelectorAll('.pt-theme-dot').forEach(d => { d.classList.remove('active'); d.classList.remove('on'); });
  const dot = ptEl('pt-t-' + name);
  if (dot) dot.classList.add('active');
  // P6 theme tiles (Script Op / op overlay) carry the kit's "on" state too
  document.querySelectorAll(`.pt-theme-dot[onclick*="theme_${name}"]`).forEach(d => { d.classList.add('active'); d.classList.add('on'); });
}

// Display-only formatting for the talent + operator screens. The stored script
// stays plain text (with [bracket] directions and **bold** markers); this turns
// it into clean HTML for reading. The editable Script Panel is left plain so the
// plain text remains the single source of truth.
function formatScriptLine(line) {
  const trimmed = line.trim();
  // Row/section header, e.g. "[1] Anchor Cold Open"
  if (/^\[\d+\]/.test(trimmed)) return `<span class="scr-header">${esc(line)}</span>`;
  // Speaker label on its own line, e.g. "HOST:" (all caps, ends with colon)
  if (/[A-Z]/.test(trimmed) && /^[A-Z0-9][A-Z0-9 .,'&/-]*:$/.test(trimmed)) {
    return `<span class="scr-speaker">${esc(line)}</span>`;
  }
  let html = esc(line);
  // Stage directions / cues in [brackets] — dimmed so talent doesn't read them
  html = html.replace(/\[[^\]]*\]/g, m => `<span class="scr-direction">${m}</span>`);
  // **emphasis** — words the talent should stress
  html = html.replace(/\*\*([^*\n]+)\*\*/g, (_, inner) => `<strong>${inner}</strong>`);
  return html;
}

function scriptToFormattedHTML(text) {
  return String(text || '').split('\n').map(line => `<p>${formatScriptLine(line) || '&nbsp;'}</p>`).join('');
}

function ptPlainTextToHTML(text) {
  return scriptToFormattedHTML(text);
}
function ptSanitizeHTML(html) {
  const doc = new DOMParser().parseFromString(html || '', 'text/html');
  doc.querySelectorAll('script,style,iframe,object,embed,link,meta').forEach(el => el.remove());
  doc.body.querySelectorAll('*').forEach(el => {
    [...el.attributes].forEach(attr => {
      if (/^on/i.test(attr.name) || attr.name === 'style') el.removeAttribute(attr.name);
    });
  });
  return doc.body.innerHTML;
}

// Reconstruct plain text (with line breaks) from the prompter DOM. Unlike
// el.innerText, this does NOT depend on the element being visible — innerText
// collapses to a single line when #pt-text is hidden, which would flatten the
// shared prompterText and bunch up every script view.
function ptExtractText(el) {
  const parts = [];
  el.childNodes.forEach(node => {
    if (node.nodeType === Node.TEXT_NODE) parts.push(node.nodeValue);
    else if (node.nodeName === 'BR') parts.push('\n');
    else { parts.push(node.textContent); parts.push('\n'); }
  });
  return parts.join('')
    .replace(/ /g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n$/, '');
}

function ptSetScriptHTML(html, sourceText) {
  const el = ptEl('pt-text');
  if (!el) return;
  el.innerHTML = ptSanitizeHTML(html);
  // When we have the original plain text (the script feed), keep it verbatim so
  // [bracket] and **bold** markers survive. Only fall back to reading the DOM for
  // rich imports (DOCX/Pages) that have no plain source.
  prompterText = (sourceText != null) ? sourceText : ptExtractText(el);
  ptScriptIsPlaceholder = false; // a real script was loaded (welcome default overrides this after)
  try { localStorage.setItem('promptypus_script_html', el.innerHTML); } catch {}
  ptResetAutoPauseMarkers();
  ptResetScroll();
  ptUpdateSyncLabel();
}

function ptSetScriptText(text) {
  ptSetScriptHTML(scriptToFormattedHTML(text), text || '');
}

// Apply a pushed Cueola update WITHOUT resetting scroll or playback. Used for
// every update after the first load so live pushes are seamless on the talent
// screen (ptSetScriptText/ptSetScriptHTML reset scroll to the top — fine for the
// initial render, jarring for a mid-show edit).
function ptApplyCueolaLiveUpdate(text) {
  prompterText = text || '';
  try { localStorage.setItem('promptypus_script_html', scriptToFormattedHTML(text || '')); } catch {}
  ptUpdateFromCueola(text || '');   // preserves ptOffset + keeps scrolling if playing
}

function ptLoadLibrary(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) { resolve(); return; }
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error('Could not load import support.'));
    document.head.appendChild(s);
  });
}

async function ptExtractFromPDF(arrayBuffer) {
  await ptLoadLibrary('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js');
  pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const pages = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const lines = [];
    let lastY = null;
    let lineAccum = '';
    for (const item of content.items) {
      const y = item.transform[5];
      if (lastY !== null && Math.abs(y - lastY) > 2) {
        if (lineAccum.trim()) lines.push(lineAccum.trimEnd());
        lineAccum = '';
      }
      lineAccum += item.str;
      lastY = y;
    }
    if (lineAccum.trim()) lines.push(lineAccum.trimEnd());
    if (lines.length) pages.push(lines.join('\n'));
  }
  return pages.join('\n\n');
}

async function ptExtractFromDOCX(arrayBuffer) {
  await ptLoadLibrary('https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.6.0/mammoth.browser.min.js');
  const result = await mammoth.convertToHtml({ arrayBuffer });
  return result.value.replace(/<p>\s*<\/p>/g, '<p> </p>');
}

async function ptExtractFromPages(arrayBuffer) {
  await ptLoadLibrary('https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js');
  const zip = await JSZip.loadAsync(arrayBuffer);
  const pdfEntry = zip.file('QuickLook/Preview.pdf');
  if (pdfEntry) {
    const pdfBuf = await pdfEntry.async('arraybuffer');
    return { text: await ptExtractFromPDF(pdfBuf) };
  }
  const xmlEntry = zip.file('index.apxl');
  if (xmlEntry) {
    const xmlStr = await xmlEntry.async('string');
    const xmlDoc = new DOMParser().parseFromString(xmlStr, 'text/xml');
    const paras = Array.from(xmlDoc.querySelectorAll('p')).map(n => n.textContent).filter(Boolean);
    return { text: paras.join('\n\n') };
  }
  throw new Error('Cannot read this Pages file. Export it as PDF or DOCX and try again.');
}

function ptChooseScriptFile() {
  const input = ptEl('pt-file-input');
  if (input) input.click();
}

function ptSetUploadStatus(text, isError=false) {
  const status = ptEl('pt-upload-status');
  if (!status) return;
  status.textContent = text;
  status.style.color = isError ? '#f05252' : '';
  status.classList.add('on');
}

async function ptHandleScriptFile(file) {
  const uploadBtn = ptEl('pt-upload-file-btn');
  if (uploadBtn) uploadBtn.disabled = true;
  ptSetUploadStatus('Reading...');
  try {
    const buf = await file.arrayBuffer();
    const name = file.name.toLowerCase();
    if (name.endsWith('.pdf')) {
      ptSetScriptText(await ptExtractFromPDF(buf));
    } else if (name.endsWith('.docx')) {
      ptSetScriptHTML(await ptExtractFromDOCX(buf));
    } else if (name.endsWith('.pages')) {
      const result = await ptExtractFromPages(buf);
      if (result.html) ptSetScriptHTML(result.html);
      else ptSetScriptText(result.text || '');
    } else if (name.endsWith('.txt') || name.endsWith('.md')) {
      ptSetScriptText(await file.text());
    } else {
      throw new Error('Unsupported file type. Use PDF, DOCX, Pages, TXT, or MD.');
    }
    const ta = ptEl('pt-script-input');
    const textEl = ptEl('pt-text');
    if (ta && textEl) ta.value = textEl.innerText.trim();
    ptSetUploadStatus('Loaded');
    setTimeout(() => ptEl('pt-upload-status')?.classList.remove('on'), 2500);
  } catch (err) {
    ptSetUploadStatus(err.message || 'Import failed', true);
    console.warn('Flowmingo import error:', err);
  } finally {
    if (uploadBtn) uploadBtn.disabled = false;
  }
}

function ptDownloadText() {
  const ta = ptEl('pt-script-input');
  const textEl = ptEl('pt-text');
  return (ta?.value.trim()) || (textEl?.innerText.trim()) || '';
}

function ptDownloadAsTxt() {
  const txt = ptDownloadText();
  if (!txt) return;
  const blob = new Blob([txt], { type:'text/plain' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'flowmingo-script.txt';
  a.click();
  URL.revokeObjectURL(a.href);
}

async function ptDownloadAsPDF() {
  const txt = ptDownloadText();
  if (!txt) return;
  await ptLoadLibrary('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js');
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();
  const margin = 20;
  const pageW = doc.internal.pageSize.width - margin * 2;
  const pageH = doc.internal.pageSize.height - margin * 2;
  doc.setFontSize(12);
  doc.setFont('helvetica', 'normal');
  const lines = doc.splitTextToSize(txt, pageW);
  let y = margin;
  for (const line of lines) {
    if (y + 7 > margin + pageH) { doc.addPage(); y = margin; }
    doc.text(line, margin, y);
    y += 7;
  }
  doc.save('flowmingo-script.pdf');
}

// Called by Cueola when script changes — scroll reset (new cue/session)
function ptInitScriptFromCueola(text) {
  ptSetScriptText(text || '');
  ptUpdateSyncLabel();
}

// Called by Cueola on live advance — update text without interrupting scroll
function ptUpdateFromCueola(text) {
  const el = ptEl('pt-text');
  if (!el) return;
  const track = ptEl('pt-track');
  const prevHeight = track ? track.scrollHeight : 0;
  el.innerHTML = ptPlainTextToHTML(text || '');
  if (text && text.trim()) ptScriptIsPlaceholder = false;
  ptResetAutoPauseMarkers();
  ptUpdateSyncLabel();
  requestAnimationFrame(() => {
    if (!track) return;
    const newHeight = track.scrollHeight;
    if (prevHeight > 0 && newHeight > 0 && newHeight !== prevHeight) {
      ptOffset = (ptOffset / prevHeight) * newHeight;
    }
    if (!ptPlaying) track.style.transform = `translateY(-${ptOffset}px)`;
    ptUpdateProgress();
  });
}

// Connection state for the talent setup/ready indicator.
let ptConnState = 'idle'; // idle | connecting | connected | notfound | error
let ptConnMessage = '';
let ptScriptIsPlaceholder = false; // true when only the default "Welcome to Flowmingo" text is loaded

function ptHasScript() {
  if (ptScriptIsPlaceholder) return false; // the welcome placeholder doesn't count as a real script
  if (prompterText && prompterText.trim()) return true;
  const el = ptEl('pt-text');
  return !!(el && el.textContent && el.textContent.trim());
}

// Single source of truth for the talent screen's "are we set up & ready?" UI:
// the status pill, the two checks, the step dots, and the setup card.
function ptUpdateReady() {
  const code = ptLinkedCueolaCode || (session && session.code && !session.isDemo ? session.code : '');
  const hasScript = ptHasScript();
  let state, text;
  if (ptConnState === 'connecting')      { state = 'connecting'; text = 'Connecting…'; }
  else if (ptConnState === 'notfound')   { state = 'bad';        text = 'Show not found — check the code'; }
  else if (ptConnState === 'error')      { state = 'warn';       text = ptConnMessage || (code ? 'Reconnecting…' : 'Connection issue'); }
  else if (code && hasScript)            { state = 'ready';      text = 'READY · ' + code; }
  else if (code)                         { state = 'warn';       text = 'Connected · ' + code + ' · waiting for script'; }
  else if (hasScript)                    { state = 'ready';      text = 'Script loaded'; }
  else                                   { state = 'bad';        text = 'Not connected'; }

  const pill = ptEl('pt-sync-label');
  if (pill) { pill.textContent = text; pill.className = 'pt-bar-sync pt-state-' + state; }
  const showCheck = ptEl('pt-check-show');   if (showCheck)   showCheck.classList.toggle('ok', !!code);
  const scriptCheck = ptEl('pt-check-script'); if (scriptCheck) scriptCheck.classList.toggle('ok', hasScript);
  const s1 = ptEl('pt-step-1'); if (s1) s1.classList.toggle('ok', !!code);
  const s2 = ptEl('pt-step-2'); if (s2) s2.classList.toggle('ok', hasScript);
  const s3 = ptEl('pt-step-3'); if (s3) s3.classList.toggle('ok', !!code && hasScript);
  // Setup card guides connection until we're joined to a show OR have a script.
  const setup = ptEl('pt-setup');
  if (setup) setup.classList.toggle('on', !code && !hasScript);
}

// Back-compat: existing callers use ptUpdateSyncLabel().
function ptUpdateSyncLabel() { ptUpdateReady(); }

// Connect from the big setup card.
function ptSetupConnect() {
  const input = ptEl('pt-setup-code');
  const status = ptEl('pt-setup-status');
  const code = (input?.value || '').trim().toUpperCase();
  if (!code) {
    if (status) { status.textContent = 'Enter the show code first.'; status.className = 'pt-setup-status warn'; }
    input?.focus();
    return;
  }
  if (status) { status.textContent = 'Connecting to ' + code + '…'; status.className = 'pt-setup-status'; }
  ptConnMessage = '';
  const ci = ptEl('pt-cueola-code-input'); if (ci) ci.value = code;
  ptLoadFromCueolaCode(code);
}

function isFlowmingoTalentActive() {
  return document.getElementById('promptypus')?.classList.contains('on');
}

function ptStateSnapshot() {
  return {
    playing: ptPlaying,
    speed: ptTargetSpeed,
    size: ptFontSize,
    align: ptAlign,
    theme: ptThemeName,
    mirrored: ptMirrored,
    panelVisible: ptPanelVisible,
    offset: Math.round(ptOffset),
    ts: Date.now()
  };
}

function ptPostControlAck(controlId, action, controlTs, target) {
  if (!controlId || !target || !isFlowmingoTalentActive()) return;
  const ack = ptPostOperatorMessage({
    type:'control_ack',
    controlId,
    action,
    controlTs,
    target,
    state: ptStateSnapshot()
  });
  if (window._firebaseReady && ptLinkedCueolaCode && window._updateDoc && window._doc && window._db) {
    try {
      window._updateDoc(window._doc(window._db, 'sessions', ptLinkedCueolaCode), {
        'prompter.controlAck': ack,
        'prompter.talentState': ack.state,
        'prompter.updatedAt': Date.now()
      }).catch(() => {});
    } catch {}
  }
}

function encodePrompterActionText(text) {
  try { return encodeURIComponent(String(text || '')).replace(/_/g, '%5F'); }
  catch { return ''; }
}

function decodePrompterActionText(text) {
  try { return decodeURIComponent(String(text || '').replace(/%5F/g, '_')); }
  catch { return String(text || ''); }
}

function nextClockTargetFromHHMM(value) {
  const m = String(value || '').match(/^(\d{1,2}):?(\d{2})$/);
  if (!m) return 0;
  const h = Math.max(0, Math.min(23, parseInt(m[1], 10)));
  const min = Math.max(0, Math.min(59, parseInt(m[2], 10)));
  const d = new Date();
  d.setHours(h, min, 0, 0);
  if (d.getTime() <= Date.now()) d.setDate(d.getDate() + 1);
  return d.getTime();
}

function fmtClockOverlay(ms, showHours=true) {
  const safe = Math.max(0, Math.ceil((Number(ms) || 0) / 1000));
  const h = Math.floor(safe / 3600);
  const m = Math.floor((safe % 3600) / 60);
  const s = safe % 60;
  return showHours || h ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

function formatTimeOfDay() {
  try {
    return new Date().toLocaleTimeString([], { hour:'numeric', minute:'2-digit', second:'2-digit' });
  } catch {
    const d = new Date();
    return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  }
}

function ptEnsureOverlayEls() {
  const screen = ptEl('promptypus');
  if (!screen) return {};
  let clock = ptEl('pt-clock-overlay');
  if (!clock) {
    clock = document.createElement('div');
    clock.id = 'pt-clock-overlay';
    clock.setAttribute('aria-live', 'polite');
    clock.innerHTML = '<div class="pt-clock-label"></div><div class="pt-clock-value"></div>';
    screen.appendChild(clock);
  }
  let question = ptEl('pt-question-overlay');
  if (!question) {
    question = document.createElement('div');
    question.id = 'pt-question-overlay';
    question.setAttribute('aria-live', 'polite');
    question.textContent = 'Question in chat';
    screen.appendChild(question);
  }
  return { clock, question };
}

function ptRenderClockOverlay() {
  const { clock, question } = ptEnsureOverlayEls();
  if (!clock || !question) return;
  const state = ptClockState || {};
  const visible = state.mode && state.mode !== 'off';
  clock.className = `pt-clock-overlay ${state.mode || 'off'} size-${state.size || 1}${visible ? ' on' : ''}`;
  if (visible) {
    const labelEl = clock.querySelector('.pt-clock-label');
    const valueEl = clock.querySelector('.pt-clock-value');
    const left = (Number(state.targetTs) || 0) - Date.now();
    let label = state.label || 'Clock';
    let value = '—';
    if (state.mode === 'timeofday') {
      label = state.label || 'Time';
      value = formatTimeOfDay();
    } else if (state.mode === 'wrap') {
      label = state.label || 'Wrap up';
      value = fmtClockOverlay(left, false);
    } else {
      value = fmtClockOverlay(left, true);
    }
    if (labelEl) labelEl.textContent = label;
    if (valueEl) valueEl.textContent = value;
    clock.classList.toggle('expired', state.mode !== 'timeofday' && left <= 0);
  }
  // P6 (Decisions #11): the question indicator rides the same global overlay
  // size as the clock/wrap banner — one stepper controls all three readouts.
  question.className = 'size-' + Math.max(0, Math.min(4, state.size ?? 1)) + (ptQuestionOn ? ' on' : '');
  if (visible && !ptClockInterval) ptClockInterval = setInterval(ptRenderClockOverlay, 500);
  if (!visible && !ptQuestionOn && ptClockInterval) {
    clearInterval(ptClockInterval);
    ptClockInterval = null;
  }
  renderPromptOpClockPreview();
}

function renderPromptOpClockPreview() {
  ['poClockPreview', 'lsqClockPreview'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    const state = ptClockState || {};
    const clockOn = state.mode && state.mode !== 'off';
    const left = (Number(state.targetTs) || 0) - Date.now();
    const value = !clockOn ? 'Off'
      : state.mode === 'timeofday' ? formatTimeOfDay()
        : fmtClockOverlay(left, state.mode !== 'wrap');
    const label = !clockOn ? 'Clock' : (state.label || 'Clock');
    el.classList.toggle('off', !clockOn);
    el.innerHTML = `<div class="flowop-clock-mini ${state.mode || 'off'}">
      <span>${esc(label)}</span>
      <strong>${esc(value)}</strong>
      ${ptQuestionOn ? '<em>Question in chat</em>' : ''}
    </div>`;
  });
}

function applyClockActionToState(action, target='talent') {
  const isFlow = target === 'flowop';
  const current = isFlow ? flowOpClockState : ptClockState;
  const update = patch => {
    const next = { ...current, ...patch };
    if (isFlow) flowOpClockState = next;
    else ptClockState = next;
  };
  if (action === 'clock_off') update({ mode:'off', label:'', targetTs:0 });
  else if (action === 'clock_timeofday') update({ mode:'timeofday', label:'Time', targetTs:0 });
  else if (action.startsWith('clock_until_')) {
    const [, rest=''] = action.split('clock_until_');
    const parts = rest.split('_label_');
    update({ mode:'countdown', label:decodePrompterActionText(parts[1] || 'Countdown'), targetTs:Number(parts[0]) || Date.now(), size:current.size || 1 });
  } else if (action.startsWith('clock_duration_')) {
    const sec = Math.max(1, parseInt(action.replace('clock_duration_', ''), 10) || 60);
    update({ mode:'duration', label:'Duration', targetTs:Date.now() + sec * 1000, size:current.size || 1 });
  } else if (action.startsWith('wrapup_')) {
    const sec = Math.max(1, parseInt(action.replace('wrapup_', ''), 10) || 300);
    update({ mode:'wrap', label:'Wrap up', targetTs:Date.now() + sec * 1000, size:2 });
  } else if (action === 'clock_size_up') update({ size:Math.min(4, (current.size || 1) + 1) });
  else if (action === 'clock_size_down') update({ size:Math.max(0, (current.size || 1) - 1) });
  if (isFlow) flowOpRenderClockPreview();
  else {
    ptRenderClockOverlay();
    renderPromptOpClockPreview();
  }
}

function applyQuestionAction(action, target='talent') {
  const on = action === 'question_on';
  if (target === 'flowop') {
    flowOpQuestionOn = on;
    flowOpRenderClockPreview();
  } else {
    ptQuestionOn = on;
    ptRenderClockOverlay();
    renderPromptOpClockPreview();
  }
}

// Called by sendPrompterControl to mirror controls into the native prompter
// Apply a remote control exactly once, no matter how many transports deliver it
// or how often a Firestore snapshot re-fires. Dedup by a signature instead of a
// monotonic timestamp so clock skew between devices can't permanently wedge it.
function applyRemoteControlOnce(action, ts, sender, controlId='') {
  if (!action) return false;
  if (isPrompterSelfSender(sender)) return false;
  const sig = controlId || `${sender || ''}:${ts || 0}:${action}`;
  if (_appliedControlSigs.has(sig)) return false;
  _appliedControlSigs.add(sig);
  if (_appliedControlSigs.size > 64) _appliedControlSigs.delete(_appliedControlSigs.values().next().value);
  ptHandleRemoteControl(action);
  ptPostControlAck(controlId, action, ts, sender);
  return true;
}

function ptHandleRemoteControl(action) {
  if (action?.startsWith('speed_set_')) { ptSetSpeed(action.replace('speed_set_', '')); return; }
  if (action?.startsWith('size_set_')) { ptSetSize(action.replace('size_set_', '')); return; }
  if (action?.startsWith('seek_set_')) { ptSeekToProgress(action.replace('seek_set_', '')); return; }
  if (action?.startsWith('seek_row_')) { ptSeekToRow(action.replace('seek_row_', '')); return; }
  if (action === 'clock_off' || action === 'clock_timeofday' || action === 'clock_size_up' || action === 'clock_size_down' || action?.startsWith('clock_until_') || action?.startsWith('clock_duration_') || action?.startsWith('wrapup_')) {
    applyClockActionToState(action, 'talent');
    return;
  }
  if (action === 'question_on' || action === 'question_off') {
    applyQuestionAction(action, 'talent');
    return;
  }
  switch (action) {
    case 'slate_tech_on':  ptShowTechSlate(); break;
    case 'slate_tech_off': ptHideTechSlate(); break;
    case 'slate_bars_on':  ptShowColorBars(); break;
    case 'slate_bars_off': ptHideColorBars(); break;
    case 'pause':      ptStopPlay(); break;
    case 'resume':     ptStartPlay(); break;
    case 'speed_up':   ptAdjustSpeed(10); break;
    case 'speed_down': ptAdjustSpeed(-10); break;
    case 'size_up':    ptAdjustSize(4); break;
    case 'size_down':  ptAdjustSize(-4); break;
    case 'align_left':   ptSetAlign('left'); break;
    case 'align_center': ptSetAlign('center'); break;
    case 'align_right':  ptSetAlign('right'); break;
    case 'theme_warm':     ptSetTheme('warm'); break;
    case 'theme_cool':     ptSetTheme('cool'); break;
    case 'theme_white':    ptSetTheme('white'); break;
    case 'theme_green':    ptSetTheme('green'); break;
    case 'theme_koala':    ptSetTheme('koala'); break;
    case 'theme_panda':    ptSetTheme('panda'); break;
    case 'theme_flamingo': ptSetTheme('flamingo'); break;
    case 'theme_outrangutan': ptSetTheme('outrangutan'); break;
    case 'theme_prepbear': ptSetTheme('prepbear'); break;
    case 'mirror':     ptToggleMirror(); break;
    case 'hide_interface': ptTogglePanel(); break;
    case 'fullscreen':
      if (ptEl('promptypus')?.classList.contains('on')) ptToggleFullscreen();
      break;
    case 'brake_start': ptBraking = true; break;
    case 'brake_stop':  ptBraking = false; break;
    case 'boost_start': ptBoosting = true; ptLiveSpeed = Math.min(ptTargetSpeed * 2.5, 300); break;
    case 'boost_stop':  ptBoosting = false; break;
    case 'direction_reverse': ptReversing = true; break;
    case 'direction_forward': ptReversing = false; break;
    case 'reset':
    case 'rewind':     ptResetScroll(); break;
  }
}

function flowOpEl(id) {
  return document.getElementById(id);
}

function flowOpSetStatus(text, isError=false) {
  const el = flowOpEl('flowOpStatus');
  if (!el) return;
  el.textContent = text;
  el.style.color = isError ? '#f05252' : '';
}

function flowOpSetSpeed(val) {
  ptTargetSpeed = Math.max(5, Math.min(200, parseFloat(val) || 60));
  ptLiveSpeed = ptTargetSpeed;
}

function flowOpSetSize(val) {
  ptFontSize = Math.max(24, Math.min(120, parseInt(val) || 52));
  flowOpEl('flowOp')?.style.setProperty('--pt-size', `${ptFontSize}px`);
}

function flowOpSetAlign(a) {
  ptAlign = ['left','center','right'].includes(a) ? a : 'center';
  flowOpEl('flowOp')?.style.setProperty('--pt-align', ptAlign);
}

function flowOpSetTheme(name) {
  name = normalizeCueolaTheme(name);
  const t = PT_THEMES[name];
  const screen = flowOpEl('flowOp');
  if (!screen || !t) return;
  ptThemeName = name;
  screen.dataset.ptTheme = name;
  screen.style.setProperty('--pt-bg', t.bg);
  screen.style.setProperty('--pt-text', t.text);
  screen.style.setProperty('--pt-accent', t.accent);
  screen.style.setProperty('--pt-ui-bg', t.uiBg);
  screen.style.setProperty('--pt-ui-border', t.uiBorder);
  screen.style.background = name === 'flamingo'
    ? 'linear-gradient(135deg,#330512 0%,#411b48 50%,#3b1429 100%)'
    : name === 'koala'
      ? 'linear-gradient(135deg,#1f1f1e 0%,#262626 50%,#404040 100%)'
      : name === 'panda'
        ? 'linear-gradient(135deg,#000000 0%,#1e1e1e 50%,#000000 100%)'
        : name === 'outrangutan'
          ? '#100c09'
        : name === 'prepbear'
          ? 'linear-gradient(135deg,#080912 0%,#14172a 50%,#2f357c 100%)'
          : t.bg;
  try { localStorage.setItem('promptypus_theme', name); } catch {}
}

function flowOpControlLabel(action) {
  const labels = {
    pause:'Pause', resume:'Play', speed_up:'Faster', speed_down:'Slower',
    size_up:'Bigger text', size_down:'Smaller text', reset:'Reset',
    align_left:'Left', align_center:'Center', align_right:'Right',
    mirror:'Mirror talent', fullscreen:'Talent fullscreen', hide_interface:'Talent controls',
    direction_reverse:'Reverse', direction_forward:'Forward',
    brake_start:'Brake', brake_stop:'Brake release',
    boost_start:'Boost', boost_stop:'Boost release',
    slate_tech_on:'Tech difficulties', slate_tech_off:'Back on air',
    slate_bars_on:'NTSC bars', slate_bars_off:'Bars off',
    clock_timeofday:'Time clock', clock_off:'Clock off',
    clock_size_up:'Clock bigger', clock_size_down:'Clock smaller',
    question_on:'Question indicator', question_off:'Question cleared'
  };
  if (action?.startsWith('theme_')) return `${CUEOLA_THEME_LABELS[action.replace('theme_', '')] || 'Theme'} theme`;
  if (action?.startsWith('speed_set_')) return `Speed ${action.replace('speed_set_', '')}`;
  if (action?.startsWith('size_set_')) return `Size ${action.replace('size_set_', '')}`;
  if (action?.startsWith('seek_set_')) return 'Cue';
  if (action?.startsWith('seek_row_')) return `Cue row ${action.replace('seek_row_', '')}`;
  if (action?.startsWith('clock_until_')) return 'Countdown clock';
  if (action?.startsWith('clock_duration_')) return 'Duration clock';
  if (action?.startsWith('wrapup_')) return 'Wrap up';
  return labels[action] || action || 'Control';
}

function flowOpRenderClockPreview() {
  const el = flowOpEl('flowOpClockPreview');
  if (!el) return;
  const state = flowOpClockState || {};
  const clockOn = state.mode && state.mode !== 'off';
  const left = (Number(state.targetTs) || 0) - Date.now();
  const value = !clockOn ? 'Off'
    : state.mode === 'timeofday' ? formatTimeOfDay()
      : fmtClockOverlay(left, state.mode !== 'wrap');
  const label = !clockOn ? 'Clock' : (state.label || (state.mode === 'wrap' ? 'Wrap up' : 'Clock'));
  el.classList.toggle('off', !clockOn);
  el.innerHTML = `<div class="flowop-clock-mini ${state.mode || 'off'}">
    <span>${esc(label)}</span>
    <strong>${esc(value)}</strong>
    ${flowOpQuestionOn ? '<em>Question in chat</em>' : ''}
  </div>`;
  if (clockOn && !flowOpClockPreviewTimer) flowOpClockPreviewTimer = setInterval(flowOpRenderClockPreview, 500);
  if (!clockOn && flowOpClockPreviewTimer) {
    clearInterval(flowOpClockPreviewTimer);
    flowOpClockPreviewTimer = null;
  }
}

function flowOpApplyControlPreview(action, quiet=false) {
  if (!action) return;
  if (action.startsWith('speed_set_')) {
    flowOpSetSpeed(action.replace('speed_set_', ''));
  } else if (action.startsWith('size_set_')) {
    flowOpSetSize(action.replace('size_set_', ''));
  } else if (action.startsWith('theme_')) {
    flowOpSetTheme(action.replace('theme_', ''));
  } else if (action.startsWith('seek_set_')) {
    // Pure live cue scroll — no local Flowmingo Op preview state to mirror.
  } else if (action.startsWith('seek_row_')) {
    // Talent resolves row headers locally after the latest script update.
  } else if (action === 'clock_off' || action === 'clock_timeofday' || action === 'clock_size_up' || action === 'clock_size_down' || action.startsWith('clock_until_') || action.startsWith('clock_duration_') || action.startsWith('wrapup_')) {
    applyClockActionToState(action, 'flowop');
  } else if (action === 'question_on' || action === 'question_off') {
    applyQuestionAction(action, 'flowop');
  } else {
    switch (action) {
      case 'slate_tech_on': setFlowOpSlateState('tech'); break;
      case 'slate_tech_off': setFlowOpSlateState('off'); break;
      case 'slate_bars_on': setFlowOpSlateState('bars'); break;
      case 'slate_bars_off': setFlowOpSlateState('off'); break;
      case 'pause': flowOpPlaying = false; break;
      case 'resume': flowOpPlaying = true; break;
      case 'speed_up': flowOpSetSpeed(ptTargetSpeed + 10); break;
      case 'speed_down': flowOpSetSpeed(ptTargetSpeed - 10); break;
      case 'size_up': flowOpSetSize(ptFontSize + 4); break;
      case 'size_down': flowOpSetSize(ptFontSize - 4); break;
      case 'align_left': flowOpSetAlign('left'); break;
      case 'align_center': flowOpSetAlign('center'); break;
      case 'align_right': flowOpSetAlign('right'); break;
      case 'direction_reverse': ptReversing = true; break;
      case 'direction_forward': ptReversing = false; break;
      case 'brake_start': ptBraking = true; break;
      case 'brake_stop': ptBraking = false; break;
      case 'boost_start': ptBoosting = true; break;
      case 'boost_stop': ptBoosting = false; break;
      default: break;
    }
  }
  flowOpSyncControls();
  if (!quiet && !action.endsWith('_stop') && !action.includes('_set_')) {
    flowOpSetStatus(`${flowOpControlLabel(action)} sent`);
  }
}

let flowOpClockPreviewTimer = null;

function buildCountdownActionFromInput(scope) {
  const input = document.getElementById(`${scope}-clock-time`);
  const target = nextClockTargetFromHHMM(input?.value || '');
  if (!target) {
    if (scope === 'flow') flowOpSetStatus('Set a countdown time first', true);
    else markLivePrompterStatus('Set a countdown time', 'busy');
    return '';
  }
  return `clock_until_${target}_label_${encodePrompterActionText('Countdown')}`;
}

function sendCountdownClock(scope='po') {
  const action = buildCountdownActionFromInput(scope);
  if (!action) return;
  if (scope === 'flow') flowOpSendControl(action);
  else sendPrompterControl(action);
}

function sendDurationClock(scope='po') {
  const input = document.getElementById(`${scope}-duration-min`);
  const mins = Math.max(1, Math.min(999, parseInt(input?.value || '5', 10) || 5));
  const action = `clock_duration_${mins * 60}`;
  if (scope === 'flow') flowOpSendControl(action);
  else sendPrompterControl(action);
}

function sendWrapUp(scope='po', minsOverride=null) {
  const input = document.getElementById(`${scope}-wrap-min`);
  const mins = Math.max(1, Math.min(999, parseInt(minsOverride ?? input?.value ?? '5', 10) || 5));
  const action = `wrapup_${mins * 60}`;
  if (scope === 'flow') flowOpSendControl(action);
  else sendPrompterControl(action);
}

function toggleQuestionIndicator(scope='po') {
  const on = scope === 'flow' ? flowOpQuestionOn : ptQuestionOn;
  if (scope === 'flow') flowOpSendControl(on ? 'question_off' : 'question_on');
  else sendPrompterControl(on ? 'question_off' : 'question_on');
}

function clockAndAlertControlsHTML(scope='po', disabled=false) {
  const dis = disabled ? ' disabled' : '';
  const isFlow = scope === 'flow';
  const state = isFlow ? flowOpClockState : ptClockState;
  const mode = state?.mode || 'off';
  const questionOn = isFlow ? flowOpQuestionOn : ptQuestionOn;
  const send = action => isFlow ? `flowOpSendControl('${action}')` : `sendPrompterControl('${action}')`;
  const btn = (symbol, label, onclick, active=false, className='') =>
    `<button class="pt-btn${className ? ` ${className}` : ''}${active ? ' active' : ''}" onclick="${onclick}" aria-pressed="${active ? 'true' : 'false'}"${dis}>${sfIcon(symbol)}<span>${label}</span></button>`;
  return `<div class="flow-clock-stack">
    <div class="flow-clock-preview" id="${scope === 'flow' ? 'flowOpClockPreview' : `${scope}ClockPreview`}"></div>
    <div class="flow-control-section flow-clock-section">
      <div class="flow-control-title">Clock</div>
      <div class="flow-clock-grid flow-clock-modes flow-control-grid four">
        ${btn('state.timed', 'Time', send('clock_timeofday'), mode === 'timeofday')}
        ${btn('state.timed', 'Duration', `sendDurationClock('${scope}')`, mode === 'duration')}
        ${btn('time.clock', 'To Time', `sendCountdownClock('${scope}')`, mode === 'countdown')}
        ${btn('media.stop', 'Hide', send('clock_off'), false)}
      </div>
      <div class="flow-clock-fields">
        <label class="flow-clock-field"><span>${sfIcon('state.timed')}<b>Duration</b></span><input id="${scope}-duration-min" type="number" min="1" max="999" value="${flowClockDurationMin}" oninput="setFlowClockDuration(this.value)" aria-label="Duration minutes"${dis}></label>
        <label class="flow-clock-field"><span>${sfIcon('time.clock')}<b>Count to</b></span><input id="${scope}-clock-time" type="time" value="${flowClockCountTime}" oninput="setFlowClockCountTime(this.value)" aria-label="Countdown target time"${dis}></label>
      </div>
    </div>
    <div class="flow-control-section flow-wrap-section">
      <div class="flow-control-title">Wrap Up</div>
      <div class="flow-clock-grid flow-wrap-grid flow-control-grid three">
        ${btn('state.warning', 'Wrap 10', `sendWrapUp('${scope}',10)`, false, 'pt-wrap-btn')}
        ${btn('state.warning', 'Wrap 5', `sendWrapUp('${scope}',5)`, false, 'pt-wrap-btn')}
        ${btn('action.forward', 'Send', `sendWrapUp('${scope}')`, false, 'pt-wrap-btn')}
      </div>
      <label class="flow-wrap-custom flow-wrap-custom-row"><span>${sfIcon('state.warning')}<b>Wrap in (min)</b></span><input id="${scope}-wrap-min" type="number" min="1" max="999" value="${flowWrapCustomMin}" oninput="setFlowWrapCustomMin(this.value)" aria-label="Custom wrap minutes"${dis}></label>
    </div>
    <div class="flow-control-section flow-alert-section">
      <div class="flow-control-title">Alerts</div>
      <div class="flow-clock-grid flow-alert-grid flow-control-grid one">
        ${btn(questionOn ? 'notification.unread' : 'notification.default', questionOn ? 'Clear question' : 'Question', `toggleQuestionIndicator('${scope}')`, questionOn, 'pt-question-btn')}
      </div>
      <div class="ui-row" style="border:0">
        <span class="ui-row-lbl">Overlay size</span>
        <div class="ui-stepper">
          <button type="button" class="ui-step-btn" onclick="${send('clock_size_down')}" aria-label="Overlay smaller"${dis}>−</button>
          <span class="ui-step-val">${['S','M','L','XL','MAX'][Math.max(0, Math.min(4, state?.size ?? 1))]}</span>
          <button type="button" class="ui-step-btn" onclick="${send('clock_size_up')}" aria-label="Overlay bigger"${dis}>+</button>
        </div>
      </div>
    </div>
  </div>`;
}

function flowOpControlsHTML(disabled=false) {
  const dis = disabled ? ' disabled' : '';
  const playAction = flowOpPlaying ? 'pause' : 'resume';
  const playLabel = flowOpPlaying ? 'PAUSE' : 'PLAY';
  const playIcon = flowOpPlaying ? PT_SVG_PAUSE : PT_SVG_PLAY;
  const transport = `<div class="flow-control-section flow-control-transport">
      <div class="flow-control-title">Transport</div>
      <div class="flow-control-grid one">
        <button class="pt-btn${flowOpPlaying?' active':''}" id="flowOpPlayBtn" onclick="flowOpSendControl('${playAction}')" aria-pressed="${flowOpPlaying ? 'true' : 'false'}"${dis}>${playIcon}<span>${playLabel}</span></button>
      </div>
      <div class="flow-control-grid four">
        <button class="pt-btn" onpointerdown="flowOpSendControl('brake_start')" onpointerup="flowOpSendControl('brake_stop')" onpointerleave="flowOpSendControl('brake_stop')"${dis}>Brake</button>
        <button class="pt-btn" onpointerdown="flowOpSendControl('boost_start')" onpointerup="flowOpSendControl('boost_stop')" onpointerleave="flowOpSendControl('boost_stop')"${dis}>Boost</button>
        <button class="pt-btn" onclick="flowOpSendControl('direction_reverse')"${dis}>Reverse</button>
        <button class="pt-btn" onclick="flowOpSendControl('direction_forward')"${dis}>Forward</button>
      </div>
    </div>`;
  const display = `<div class="flow-control-section flow-control-display">
      <div class="flow-control-title">Display</div>
      <div class="pt-ctrl-group flow-control-slider">
        <span class="pt-ctrl-label">Speed</span>
        <button class="pt-btn" onclick="flowOpSendControl('speed_down')"${dis}>−</button>
        <input type="range" class="pt-range" id="flowOpSpeedRange" min="5" max="200" value="${ptTargetSpeed}" oninput="flowOpApplyControlPreview('speed_set_'+this.value,true)" onchange="flowOpSendControl('speed_set_'+this.value,true)"${dis}>
        <button class="pt-btn" onclick="flowOpSendControl('speed_up')"${dis}>+</button>
      </div>
      <div class="pt-ctrl-group flow-control-slider">
        <span class="pt-ctrl-label">Size</span>
        <button class="pt-btn" onclick="flowOpSendControl('size_down')"${dis}>−</button>
        <input type="range" class="pt-range" id="flowOpSizeRange" min="24" max="120" value="${ptFontSize}" oninput="flowOpApplyControlPreview('size_set_'+this.value,true)" onchange="flowOpSendControl('size_set_'+this.value,true)"${dis}>
        <button class="pt-btn" onclick="flowOpSendControl('size_up')"${dis}>+</button>
      </div>
      <div class="pt-ctrl-group flow-control-segment">
        <span class="pt-ctrl-label">Align</span>
        <button class="pt-btn${ptAlign==='left'?' active':''}" data-flowop-align="left" onclick="flowOpSendControl('align_left')" aria-label="Align left"${dis}><svg width="14" height="12" viewBox="0 0 14 12" fill="currentColor"><rect x="0" y="0" width="14" height="2" rx="1"/><rect x="0" y="5" width="9" height="2" rx="1"/><rect x="0" y="10" width="12" height="2" rx="1"/></svg></button>
        <button class="pt-btn${ptAlign==='center'?' active':''}" data-flowop-align="center" onclick="flowOpSendControl('align_center')" aria-label="Align center"${dis}><svg width="14" height="12" viewBox="0 0 14 12" fill="currentColor"><rect x="0" y="0" width="14" height="2" rx="1"/><rect x="2.5" y="5" width="9" height="2" rx="1"/><rect x="1" y="10" width="12" height="2" rx="1"/></svg></button>
        <button class="pt-btn${ptAlign==='right'?' active':''}" data-flowop-align="right" onclick="flowOpSendControl('align_right')" aria-label="Align right"${dis}><svg width="14" height="12" viewBox="0 0 14 12" fill="currentColor"><rect x="0" y="0" width="14" height="2" rx="1"/><rect x="5" y="5" width="9" height="2" rx="1"/><rect x="2" y="10" width="12" height="2" rx="1"/></svg></button>
      </div>
    </div>`;
  const theme = `<div class="flow-control-section flow-theme-section">
      <div class="flow-control-title">Theme</div>
      <div class="pt-ctrl-group flow-theme-grid ui-theme-grid">
        ${CUEOLA_THEMES.map(name => `<button type="button" class="ui-theme-tile flowop-theme-dot${ptThemeName===name?' on active':''}" data-flowop-theme="${name}" onclick="flowOpSendControl('theme_${name}')" title="${CUEOLA_THEME_LABELS[name] || name}" aria-label="${CUEOLA_THEME_LABELS[name] || name}"${dis}><span class="tt-prev" style="background:${PT_THEMES[name].bg}"></span><span class="tt-name">${CUEOLA_THEME_LABELS[name] || name}</span></button>`).join('')}
      </div>
    </div>`;
  const screen = `<div class="flow-control-section flow-control-screen">
      <div class="flow-control-title">Screen</div>
      <div class="flow-control-grid five">
        <button class="pt-btn" onclick="flowOpSendControl('reset')"${dis}>Reset</button>
        <button class="pt-btn" onclick="flowOpSendControl('hide_interface')"${dis}>Hide UI</button>
        <button class="pt-btn" onclick="flowOpSendControl('mirror')"${dis}>Mirror</button>
        <button class="pt-btn" onclick="flowOpSendControl('fullscreen')"${dis}>Full</button>
        <button class="pt-btn" onclick="openPrompterFromFlowOp()"${dis}>Talent</button>
      </div>
    </div>`;
  return `<div class="flowop-controls flow-control-panel op-insp" data-insp-scope="flow">
    ${opInspHeadHTML('flow')}
    <div class="insp-pane" data-insp-pane="transport">${transport}</div>
    <div class="insp-pane" data-insp-pane="live"><div class="ls-live-actions">${liveActionsHTML('flow', disabled)}</div></div>
    <div class="insp-pane" data-insp-pane="clock">${clockAndAlertControlsHTML('flow', disabled)}</div>
    <div class="insp-pane" data-insp-pane="display">${display}${theme}</div>
    <div class="insp-pane" data-insp-pane="screen">${screen}</div>
  </div>`;
}

function flowOpRenderControls(disabled=false) {
  const el = flowOpEl('flowOpControls');
  if (el) el.innerHTML = flowOpControlsHTML(disabled);
  opInspRestoreTab('flow');   // keep the remembered inspector tab active across re-renders
  flowOpSyncControls();
}

function flowOpSyncControls() {
  const playBtn = flowOpEl('flowOpPlayBtn');
  if (playBtn) {
    playBtn.innerHTML = `${flowOpPlaying ? PT_SVG_PAUSE : PT_SVG_PLAY} ${flowOpPlaying ? 'PAUSE' : 'PLAY'}`;
    playBtn.classList.toggle('active', flowOpPlaying);
    playBtn.setAttribute('onclick', `flowOpSendControl('${flowOpPlaying ? 'pause' : 'resume'}')`);
  }
  const speed = flowOpEl('flowOpSpeedRange');
  if (speed) speed.value = ptTargetSpeed;
  const size = flowOpEl('flowOpSizeRange');
  if (size) size.value = ptFontSize;
  document.querySelectorAll('[data-flowop-align]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.flowopAlign === ptAlign);
  });
  document.querySelectorAll('[data-flowop-theme]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.flowopTheme === ptThemeName);
    btn.classList.toggle('on', btn.dataset.flowopTheme === ptThemeName);
  });
  flowOpRenderClockPreview();
}

function flowOpRenderSession(data=null) {
  const titleEl = flowOpEl('flowOpTitle');
  const meta = flowOpEl('flowOpSessionMeta');
  const preview = flowOpEl('flowOpScriptPreview');
  if (!data) {
    if (titleEl) titleEl.textContent = 'Flowmingo Op';
    if (meta) meta.innerHTML = `<div class="flowop-session-title">No session loaded</div><div class="flowop-note">Enter the same code used on the talent Flowmingo screen.</div>`;
    if (preview) preview.innerHTML = `<div class="flowop-empty">Load a session code to control Flowmingo remotely.</div>`;
    return;
  }
  const showName = data.show?.name || data.showName || data.name || 'Untitled Show';
  const beatsInSession = Array.isArray(data.beats) ? data.beats.map(migrateBeat) : [];
  const activeIdx = Number.isFinite(data.prompter?.activeIdx) ? data.prompter.activeIdx : 0;
  const cur = data.prompter?.currentRow || beatsInSession[activeIdx] || null;
  const next = data.prompter?.nextRow || beatsInSession[activeIdx + 1] || null;
  const text = ptAssembleCueolaScript(data);
  if (titleEl) titleEl.textContent = showName;
  if (preview) {
    preview.innerHTML = text.trim()
      ? ptSanitizeHTML(ptPlainTextToHTML(text))
      : `<div class="flowop-empty">This session has no Flowmingo script yet.</div>`;
  }
  if (meta) {
    meta.innerHTML = `
      <div class="flowop-session-title">${esc(showName)}</div>
      <div class="flowop-meta" style="margin-top:10px">
        <div class="flowop-meta-item"><div class="flowop-meta-label">Code</div><div class="flowop-meta-value">${esc(flowOpCode || '—')}</div></div>
        <div class="flowop-meta-item"><div class="flowop-meta-label">Rows</div><div class="flowop-meta-value">${beatsInSession.length || '—'}</div></div>
        <div class="flowop-meta-item"><div class="flowop-meta-label">Now</div><div class="flowop-meta-value">${esc(cur?.name || cur?.info || '—')}</div></div>
        <div class="flowop-meta-item"><div class="flowop-meta-label">Next</div><div class="flowop-meta-value">${esc(next?.name || next?.info || '—')}</div></div>
      </div>`;
  }
}

function flowOpLoadSession(codeOverride='') {
  const input = flowOpEl('flowOpCodeInput');
  const code = (codeOverride || input?.value || '').trim().toUpperCase();
  const btn = flowOpEl('flowOpLoadBtn');
  if (!code) {
    flowOpSetStatus('Enter a code', true);
    input?.focus();
    return;
  }
  if (input) input.value = code;
  if (btn) { btn.disabled = true; btn.textContent = '...'; }
  flowOpCode = '';
  flowOpRenderControls(true);
  flowOpSetStatus('Loading...');
  _ensurePrompterOperatorBridge(true);
  const load = () => {
    try {
      if (flowOpSub) { flowOpSub(); flowOpSub = null; }
      flowOpSub = window._onSnapshot(window._doc(window._db, 'sessions', code), snap => {
        if (!snap.exists()) {
          flowOpCode = '';
          flowOpData = null;
          flowOpRenderSession(null);
          flowOpRenderControls(true);
          flowOpSetStatus('Not found', true);
          if (btn) { btn.disabled = false; btn.textContent = 'Load'; }
          return;
        }
        flowOpCode = code;
        ptLinkedCueolaCode = code;
        flowOpData = snap.data() || {};
        flowOpRenderSession(flowOpData);
        flowOpRenderControls(false);
        const heartbeat = flowOpData.prompter?.talentHeartbeat;
        const talentOnline = heartbeat?.ts && !isPrompterSelfSender(heartbeat.sender) && (Date.now() - heartbeat.ts) < 20000;
        if (talentOnline) {
          _notePrompterTalentSeen(heartbeat);
          flowOpSetStatus(`READY · ${code} · talent online`);
        } else {
          flowOpSetStatus(`READY · ${code}`);
        }
        const control = flowOpData.prompter?.control;
        if (control?.ts && control.ts > flowOpLastRemoteControlTs && !isPrompterSelfSender(control.sender)) {
          flowOpLastRemoteControlTs = control.ts;
          flowOpApplyControlPreview(control.action, true);
        }
        if (flowOpData.prompter?.controlAck) _handlePrompterControlAck(flowOpData.prompter.controlAck);
        if (btn) { btn.disabled = false; btn.textContent = 'Load'; }
      }, err => {
        flowOpCode = '';
        flowOpSetStatus(firebaseConnectionLabel(err, 'Error'), true);
        flowOpRenderControls(true);
        if (btn) { btn.disabled = false; btn.textContent = 'Load'; }
      });
    } catch {
      flowOpCode = '';
      flowOpSetStatus('Error', true);
      flowOpRenderControls(true);
      if (btn) { btn.disabled = false; btn.textContent = 'Load'; }
    }
  };
  if (window._firebaseReady) load();
  else window.addEventListener('firebaseReady', load, { once:true });
}

function flowOpStopListening() {
  if (flowOpSub) {
    try { flowOpSub(); } catch {}
    flowOpSub = null;
  }
}

function flowOpSendControl(action, quiet=false) {
  if (!flowOpCode) {
    flowOpSetStatus('Load a session first', true);
    flowOpEl('flowOpCodeInput')?.focus();
    return;
  }
  _ensurePrompterOperatorBridge(true);
  const control = buildPrompterControl(action, 'flowmingo-op');
  _postPrompterMessage(control);
  trackPrompterControl(control, 'flowop', quiet);
  flowOpApplyControlPreview(action, quiet);
  if (!window._firebaseReady) {
    flowOpSetStatus('Local only · not connected', true);
    return;
  }
  window._updateDoc(window._doc(window._db, 'sessions', flowOpCode), {
    'prompter.control': { ...control, sender:FLOWMINGO_ENDPOINT_ID, senderClient:CLIENT_ID },
    'prompter.updatedAt': control.ts
  }).catch(err => flowOpSetStatus(firebaseConnectionLabel(err, 'Send failed'), true));
}

// Flowmingo Op: toggle the Technical Difficulties stand-by cover on the talent.
function flowOpToggleTechDifficulty() {
  flowOpSendControl(anyFlowOpSlateOn() ? 'slate_tech_off' : 'slate_tech_on');
}

// Flowmingo Op: generate NTSC bars on the talent display.
function flowOpToggleColorBars() {
  flowOpSendControl(flowOpColorBarsOn ? 'slate_bars_off' : 'slate_bars_on');
}

// Flowmingo Op: fine nudge for the live cue scrubber.
function flowOpNudgeSeek(delta) {
  const sl = flowOpEl('flow-seek');
  const cur = sl ? parseFloat(sl.value) || 0 : 0;
  const next = Math.max(0, Math.min(100, cur + delta));
  if (sl) sl.value = next;
  flowOpSendControl('seek_set_' + next);
}

function flowOpPunchInSeek() {
  const sl = flowOpEl('flow-seek');
  const val = sl ? parseFloat(sl.value) || 0 : 0;
  const next = Math.max(0, Math.min(100, val));
  flowOpSendControl('seek_set_' + next);
  flowOpSendControl('resume');
}

function flowOpReleaseHoldKeys() {
  if (!flowOpCode) return;
  if (ptBraking) flowOpSendControl('brake_stop', true);
  if (ptBoosting) flowOpSendControl('boost_stop', true);
  ptBraking = false;
  ptBoosting = false;
}

function flowOpBindKeys() {
  if (flowOpKeydownHandler) document.removeEventListener('keydown', flowOpKeydownHandler);
  if (flowOpKeyupHandler) document.removeEventListener('keyup', flowOpKeyupHandler);
  flowOpKeydownHandler = e => {
    if (!flowOpEl('flowOp')?.classList.contains('on')) return;
    if (isTextEditingTarget(e.target)) return;
    if (e.key === 'ArrowDown' && e.altKey) { consumeRemoteKey(e); if (!e.repeat) flowOpSendControl('direction_reverse'); return; }
    if (e.key === 'ArrowUp' && e.altKey) { consumeRemoteKey(e); if (!e.repeat) flowOpSendControl('direction_forward'); return; }
    if (e.repeat && !['ArrowUp','ArrowDown'].includes(e.key)) {
      if (['ArrowLeft','ArrowRight',' ','Space','f','F','r','R','h','H','m','M'].includes(e.key)) consumeRemoteKey(e);
      return;
    }
    switch (e.key) {
      case ' ':
      case 'Space': consumeRemoteKey(e); flowOpSendControl(flowOpPlaying ? 'pause' : 'resume'); break;
      case 'ArrowUp': consumeRemoteKey(e); if (!e.repeat) flowOpSendControl('boost_start'); break;
      case 'ArrowDown': consumeRemoteKey(e); if (!e.repeat) flowOpSendControl('brake_start'); break;
      case 'ArrowLeft': consumeRemoteKey(e); if (!e.repeat) flowOpSendControl('size_down'); break;
      case 'ArrowRight': consumeRemoteKey(e); if (!e.repeat) flowOpSendControl('size_up'); break;
      case 'f': case 'F': consumeRemoteKey(e); flowOpSendControl('fullscreen'); break;
      case 'r': case 'R': consumeRemoteKey(e); flowOpSendControl('reset'); break;
      case 'h': case 'H': consumeRemoteKey(e); flowOpSendControl('hide_interface'); break;
      case 'm': case 'M': consumeRemoteKey(e); flowOpSendControl('mirror'); break;
      case 'Escape': exitFlowmingoOperator(); break;
    }
  };
  flowOpKeyupHandler = e => {
    if (!flowOpEl('flowOp')?.classList.contains('on')) return;
    if (e.key === 'ArrowUp') { consumeRemoteKey(e); flowOpSendControl('boost_stop', true); }
    if (e.key === 'ArrowDown') { consumeRemoteKey(e); flowOpSendControl('brake_stop', true); }
  };
  document.addEventListener('keydown', flowOpKeydownHandler);
  document.addEventListener('keyup', flowOpKeyupHandler);
}

function openFlowmingoOperator(codeOverride='') {
  flowOpReturnScreen = document.getElementById('promptypus')?.classList.contains('on') ? 'promptypus'
    : document.getElementById('rundown')?.classList.contains('on') ? 'rundown'
      : document.getElementById('liveshow')?.classList.contains('on') ? 'live'
        : 'entry';
  ptStopPlay();
  ptCloseEdit();
  ['entry','rundown','liveshow','promptypus'].forEach(id => document.getElementById(id)?.classList.remove('on'));
  flowOpEl('flowOp')?.classList.add('on');
  sessionStorage.setItem('cueola_screen', 'flowop');
  pushSessionHistoryState('flowop');
  flowOpSetTheme(ptThemeName);
  flowOpSetAlign(ptAlign);
  flowOpSetSize(ptFontSize);
  flowOpRenderSession(flowOpData);
  flowOpRenderControls(!flowOpCode);
  flowOpBindKeys();
  const code = (codeOverride || flowOpCode || ptLinkedCueolaCode || '').trim().toUpperCase();
  const input = flowOpEl('flowOpCodeInput');
  if (input) input.value = code;
  if (code) flowOpLoadSession(code);
  else setTimeout(() => input?.focus(), 50);
}

function exitFlowmingoOperator() {
  flowOpReleaseHoldKeys();
  flowOpStopListening();
  flowOpEl('flowOp')?.classList.remove('on');
  if (flowOpReturnScreen === 'promptypus') {
    enterPrompter();
  } else if (flowOpReturnScreen === 'live') {
    document.getElementById('liveshow')?.classList.add('on');
    sessionStorage.setItem('cueola_screen', 'live');
  } else if (flowOpReturnScreen === 'rundown') {
    document.getElementById('rundown')?.classList.add('on');
    sessionStorage.setItem('cueola_screen', 'build');
  } else {
    document.getElementById('entry')?.classList.add('on');
    sessionStorage.setItem('cueola_screen', 'entry');
  }
}

function openPrompterFromFlowOp() {
  const code = (flowOpCode || flowOpEl('flowOpCodeInput')?.value || '').trim().toUpperCase();
  flowOpReleaseHoldKeys();
  flowOpStopListening();
  flowOpEl('flowOp')?.classList.remove('on');
  sessionStorage.setItem('cueola_screen', 'entry');
  enterPrompter();
  if (code) {
    const input = ptEl('pt-cueola-code-input');
    if (input) input.value = code;
    ptLoadFromCueolaCode(code);
  }
}

function ptOpenEdit() {
  ptStopPlay();
  const ta = ptEl('pt-script-input');
  const textEl = ptEl('pt-text');
  if (ta && textEl) ta.value = textEl.innerText.trim();
  const codeIn = ptEl('pt-cueola-code-input');
  if (codeIn && (ptLinkedCueolaCode || session?.code)) codeIn.value = ptLinkedCueolaCode || session.code;
  const ov = ptEl('pt-edit-overlay');
  if (ov) ov.classList.add('open');
  setTimeout(() => { if (ta) ta.focus(); }, 50);
}

function ptCloseEdit() {
  const ov = ptEl('pt-edit-overlay');
  if (ov) ov.classList.remove('open');
}

function ptSaveScript() {
  const ta = ptEl('pt-script-input');
  if (ta && ta.value.trim()) ptSetScriptText(ta.value.trim());
  ptCloseEdit();
}

function ptLoadFromCueola() {
  if (prompterText && prompterText.trim()) {
    ptInitScriptFromCueola(prompterText);
    ptCloseEdit();
    toast('Loaded script from Cueola');
  } else {
    toast('No script in Cueola yet — add script cues and push to Flowmingo from the live view.');
  }
}

let ptCueolaSub = null;
let ptLastCueolaScript = null; // last script SOURCE applied from the cloud feed (loop guard)

function ptCurrentPlainText() {
  const textEl = ptEl('pt-text');
  return textEl ? ptExtractText(textEl) : '';
}

function ptSetCueolaStatus(text, isError=false) {
  const status = ptEl('pt-cueola-status');
  if (!status) return;
  status.textContent = text;
  status.style.color = isError ? '#f05252' : '';
  status.classList.add('on');
}

function ptAssembleCueolaScript(data) {
  if (data?.prompter && typeof data.prompter.text === 'string') return data.prompter.text;
  return assemblePrompterScriptFromBeats((data?.beats || []).map(migrateBeat));
}

function ptLoadFromCueolaCode(codeOverride='') {
  const codeIn = ptEl('pt-cueola-code-input');
  const code = (codeOverride || codeIn?.value || '').trim().toUpperCase();
  const btn = ptEl('pt-cueola-load-btn');
  if (!code) return;
  if (codeIn) codeIn.value = code;
  if (btn) { btn.disabled = true; btn.textContent = '...'; }
  ptLastCueolaScript = null; // fresh load → allow the first snapshot to render from the top
  ptSetCueolaStatus('Loading...');
  ptConnState = 'connecting';
  ptConnMessage = '';
  ptUpdateReady();
  let loadedOnce = false;
  const load = () => {
    try {
      if (ptCueolaSub) { ptCueolaSub(); ptCueolaSub = null; }
      ptCueolaSub = window._onSnapshot(window._doc(window._db, 'sessions', code), snap => {
        if (!snap.exists()) {
          ptSetCueolaStatus('Not found', true);
          ptConnState = 'notfound';
          ptConnMessage = '';
          if (loadedOnce) ptShowTechSlate();
          ptUpdateReady();
          const ss = ptEl('pt-setup-status'); if (ss) { ss.textContent = `No show found for "${code}". Double-check the code.`; ss.className = 'pt-setup-status warn'; }
          if (btn) { btn.disabled = false; btn.textContent = 'Load'; }
          return;
        }
        const data = snap.data() || {};
        ptLinkedCueolaCode = code;
        session.code = code;
        session.isDemo = false;
        session.isExpert = false;
        ptConnState = 'connected';
        ptConnMessage = '';
        const text = ptAssembleCueolaScript(data);
        const hasExplicitPrompterText = data?.prompter && typeof data.prompter.text === 'string';
        if (text.trim() || hasExplicitPrompterText) {
          adoptPrompterText(text, {
            version:Number(data.prompter?.version)||0,
            updatedAt:Number(data.prompter?.updatedAt)||0,
            source:data.prompter?.source || 'cueola'
          });
          // Only rebuild the talent script when the SOURCE actually changed. This
          // snapshot fires on EVERY session-doc write (talent heartbeats, presence,
          // clock, control acks), and ptSetScriptText() resets the scroll to the top.
          // The old render→source round-trip comparison was lossy, so it rebuilt on
          // nearly every write — the script appeared to load, then restart every
          // couple of seconds. Compare the stable source string instead.
          if (text !== ptLastCueolaScript) {
            const firstApply = ptLastCueolaScript === null;
            ptLastCueolaScript = text;
            // First load starts from the top; every later pushed update applies
            // LIVE in place — preserving scroll position and playback — so the
            // talent screen never has to be reset to "play" the new copy.
            if (firstApply) ptSetScriptText(text);
            else ptApplyCueolaLiveUpdate(text);
          }
          const ta = ptEl('pt-script-input');
          if (ta) ta.value = text.trim();
          ptSetCueolaStatus(text.trim() ? `READY · ${code}` : `READY · ${code} · script cleared`);
          ptUpdateSyncLabel();
          if (!loadedOnce) {
            loadedOnce = true;
            setTimeout(ptCloseEdit, 550);
            toast(text.trim() ? `Flowmingo ready for ${code}` : `Flowmingo linked to ${code}`);
          }
        } else {
          ptSetCueolaStatus(`READY · ${code} · no script yet`);
          if (!loadedOnce) {
            loadedOnce = true;
            setTimeout(ptCloseEdit, 700);
            toast(`Flowmingo linked to ${code}`);
          }
        }
        ptUpdateReady();
        const control = data.prompter?.control;
        if (control?.action && !isPrompterSelfSender(control.sender)) {
          applyRemoteControlOnce(control.action, control.ts, control.sender, control.controlId);
        }
        if (btn) { btn.disabled = false; btn.textContent = 'Load'; }
      }, err => {
        const label = firebaseConnectionLabel(err, 'Error');
        ptSetCueolaStatus(label, true);
        ptConnState = 'error';
        ptConnMessage = label;
        if (loadedOnce) ptShowTechSlate();
        ptUpdateReady();
        const ss = ptEl('pt-setup-status');
        if (ss) { ss.textContent = firebaseConnectionHint(err); ss.className = 'pt-setup-status warn'; }
        if (btn) { btn.disabled = false; btn.textContent = 'Load'; }
      });
    } catch (err) {
      const label = firebaseConnectionLabel(err, 'Error');
      ptSetCueolaStatus(label, true);
      ptConnState = 'error';
      ptConnMessage = label;
      if (loadedOnce) ptShowTechSlate();
      ptUpdateReady();
      const ss = ptEl('pt-setup-status');
      if (ss) { ss.textContent = firebaseConnectionHint(err); ss.className = 'pt-setup-status warn'; }
      if (btn) { btn.disabled = false; btn.textContent = 'Load'; }
    }
  };
  if (window._firebaseReady) load();
  else window.addEventListener('firebaseReady', load, { once:true });
}

function ptResetIdle() {
  const screen = ptEl('promptypus');
  if (!screen) return;
  screen.classList.add('show-cursor');
  if (ptPlaying && ptPanelVisible) {
    clearTimeout(ptIdleTimer);
    ptIdleTimer = setTimeout(() => {
      if (ptPlaying) screen.classList.remove('show-cursor');
    }, 3000);
  }
}

function enterPrompter() {
  // Show the promptypus screen
  document.getElementById('entry').classList.remove('on');
  document.getElementById('rundown').classList.remove('on');
  document.getElementById('liveshow').classList.remove('on');
  document.getElementById('promptypus').classList.add('on');
  pushSessionHistoryState('promptypus');
  ptInitReceiver();

  // Sync live script from Cueola if available (always takes priority over previous content)
  const textEl = ptEl('pt-text');
  if (prompterText && prompterText.trim()) {
    // Always load the latest live script from Cueola when entering
    ptSetScriptText(prompterText);
  } else if (!textEl || !textEl.textContent.trim()) {
    ptLoadSavedOrDefault();
  }
  // (If textEl has content from a previous manual load and no live script, keep it)
  // Initialize theme
  ptSetTheme(ptThemeName);
  ptSetAlign(ptAlign);
  ptSetSize(ptFontSize);
  ptRenderClockOverlay();
  ptUpdateSyncLabel();

  // Keyboard handler (scoped to when this screen is active)
  if (ptKeydownHandler) document.removeEventListener('keydown', ptKeydownHandler);
  if (ptKeyupHandler) document.removeEventListener('keyup', ptKeyupHandler);

  ptKeydownHandler = (e) => {
    if (!document.getElementById('promptypus').classList.contains('on')) return;
    const editOpen = ptEl('pt-edit-overlay')?.classList.contains('open');
    if (editOpen) {
      if (e.key === 'Escape') ptCloseEdit();
      return;
    }
    if (e.key === 'ArrowDown' && e.altKey) { e.preventDefault(); ptReversing = true; return; }
    if (e.key === 'ArrowUp' && e.altKey) { e.preventDefault(); ptReversing = false; return; }
    if (e.repeat) return;
    switch (e.key) {
      case ' ':          e.preventDefault(); ptTogglePlay(); break;
      case 'ArrowUp':    e.preventDefault(); ptBoosting = true; ptLiveSpeed = Math.min(ptTargetSpeed * 2.5, 300); break;
      case 'ArrowDown':  e.preventDefault(); ptBraking = true; break;
      case 'ArrowLeft':  e.preventDefault(); ptAdjustSize(-4); break;
      case 'ArrowRight': e.preventDefault(); ptAdjustSize(4); break;
      case 'f': case 'F': ptToggleFullscreen(); break;
      case 'e': case 'E': ptOpenEdit(); break;
      case 'r': case 'R': ptResetScroll(); break;
      case 'h': case 'H': ptTogglePanel(); break;
      case 'm': case 'M': ptToggleMirror(); break;
      case 'Escape':
        if (document.fullscreenElement || document.webkitFullscreenElement) {
          (document.exitFullscreen || document.webkitExitFullscreen).call(document);
        } else if (ptPlaying) {
          ptStopPlay();
        } else {
          exitPrompter();
        }
        break;
    }
  };
  ptKeyupHandler = (e) => {
    if (!document.getElementById('promptypus').classList.contains('on')) return;
    if (e.key === 'ArrowUp')   { ptBoosting = false; }
    if (e.key === 'ArrowDown') { ptBraking = false; }
  };
  document.addEventListener('keydown', ptKeydownHandler);
  document.addEventListener('keyup', ptKeyupHandler);

  // Idle cursor tracking
  ptEl('promptypus').addEventListener('mousemove', ptResetIdle);

  // Touch: tap to play/pause
  const stage = ptEl('pt-stage');
  if (stage && !stage._ptTouch) {
    stage._ptTouch = true;
    let _tY = 0, _tT = 0, _tDrag = false;
    stage.addEventListener('touchstart', e => {
      _tY = e.touches[0].clientY; _tT = Date.now(); _tDrag = false;
    }, { passive: true });
    stage.addEventListener('touchmove', e => {
      const dy = e.touches[0].clientY - _tY;
      if (dy > 20) { ptBraking = true; ptBoosting = false; _tDrag = true; }
      else if (dy < -20) { ptBoosting = true; ptBraking = false; ptLiveSpeed = Math.min(ptTargetSpeed * 2.5, 300); _tDrag = true; }
      else { ptBraking = false; ptBoosting = false; }
    }, { passive: true });
    stage.addEventListener('touchend', e => {
      ptBraking = false; ptBoosting = false;
      const dy = e.changedTouches[0].clientY - _tY;
      if (!_tDrag && Date.now() - _tT < 300 && Math.abs(dy) < 18) ptTogglePlay();
      _tDrag = false;
    }, { passive: true });
  }
  const fileInput = ptEl('pt-file-input');
  if (fileInput && !fileInput._ptBound) {
    fileInput._ptBound = true;
    fileInput.addEventListener('change', e => {
      const file = e.target.files?.[0];
      if (file) ptHandleScriptFile(file);
      e.target.value = '';
    });
  }
}

function exitPrompter() {
  ptStopPlay();
  document.getElementById('promptypus').classList.remove('on');
  // Go back to whichever screen was active before
  const prevScreen = sessionStorage.getItem('cueola_screen');
  if (prevScreen === 'live') {
    document.getElementById('liveshow').classList.add('on');
  } else if (prevScreen === 'entry' || ptLinkedCueolaCode) {
    document.getElementById('entry').classList.add('on');
  } else if (session && session.code) {
    document.getElementById('rundown').classList.add('on');
  } else {
    document.getElementById('entry').classList.add('on');
  }
}

function togglePromptOpMode() {
  promptOpMode = !promptOpMode;
  // Mutually exclusive with the Script Op panel — close it when entering Flowmingo Op.
  if (promptOpMode && livePrompterOpen) {
    livePrompterOpen = false;
    applyLivePrompterPanelState();
  }
  document.getElementById('liveshow')?.classList.toggle('prompt-op-active', promptOpMode);
  setFlowmingoOpButton(promptOpMode);
  renderLive();
}

function renderLivePromptOp() {
  const body = document.getElementById('lsBody');
  ptSetTheme(ptThemeName);
  if (!beats.length) {
    body.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text3)">No cues in rundown.</div>';
    return;
  }
  const cur  = beats[lsIdx] || null;
  const next = beats[lsIdx + 1] || null;
  const sd   = cur?.cues?.script;
  const script = cleanPrompterText((prompterText && prompterText.trim()) || sd?.text || '');
  body.innerHTML = `<div class="prompt-op-stage" tabindex="0" aria-label="Flowmingo operator controls">
    <div class="prompt-op-info">Now · ${esc(cur?.info || '—')} · Row ${lsIdx + 1} of ${beats.length}${next ? ` · Next: ${esc(next.info || '—')}` : ''}</div>
    <div class="prompt-op-read-line"></div>
    <div class="prompt-op-track">
      <div class="prompt-op-text">${script ? scriptToFormattedHTML(script) : 'No script loaded.\n\nWaiting for Script Op.'}</div>
    </div>
    ${promptOpControlsHTML()}
  </div>`;
  opInspRestoreTab('po');   // keep the remembered inspector tab active across re-renders
  renderPromptOpClockPreview();
  requestAnimationFrame(() => body.querySelector('.prompt-op-stage')?.focus({ preventScroll:true }));
}

// ─────────────────────────────────────────────────────────────
// TIMER
// ─────────────────────────────────────────────────────────────
// Shared show clock: the person who starts/pauses/restarts broadcasts the clock
// state to the session so everyone's clock runs and pauses together. Late joiners
// (and anyone re-entering the live view) pick up a running clock from anchorMs.
let _remoteClockState = null;   // last clock object seen from the session
let _lastAppliedClockTs = 0;    // newest clock ts we've broadcast or applied
let _applyingRemoteClock = false;

function broadcastShowClock() {
  if (_applyingRemoteClock) return;
  if (!window._firebaseReady || !session.code || session.isDemo || session.isExpert) return;
  const payload = {
    running: !!liveClockRunning,
    anchorMs: liveClockRunning ? (liveTimerStartMs || (Date.now() - elapsedSecs * 1000)) : 0,
    elapsedSecs: Math.max(0, Math.floor(elapsedSecs)),
    by: session.userName || '',
    senderId: presenceId,
    ts: Date.now(),
  };
  _remoteClockState = payload;
  _lastAppliedClockTs = payload.ts;  // ignore my own echo when it bounces back
  window._updateDoc(window._doc(window._db, 'sessions', session.code), { showClock: payload }).catch(() => {});
}

function applyRemoteShowClock(clock) {
  if (!clock || typeof clock !== 'object') return;
  _remoteClockState = clock;
  if (clock.senderId === presenceId) return;        // my own write coming back
  if (!(Number(clock.ts) > _lastAppliedClockTs)) return; // not newer than what we have
  _lastAppliedClockTs = Number(clock.ts);
  _applyingRemoteClock = true;
  try {
    if (clock.running) {
      const anchor = Number(clock.anchorMs) || Date.now();
      elapsedSecs = Math.max(0, Math.floor((Date.now() - anchor) / 1000));
      startTimer(anchor);
    } else {
      stopTimer(false);
      elapsedSecs = Math.max(0, Math.floor(Number(clock.elapsedSecs) || 0));
      liveTimerStartMs = null;
      liveClockRunning = false;
    }
    const el = document.getElementById('ls-timer');
    if (el && !clock.running) el.textContent = fmtProductionClock(elapsedSecs * 1000);
    updateLiveClockButton();
    updateBotBar();
    updateLiveRemain();
    updateLiveOverview();
  } finally {
    _applyingRemoteClock = false;
  }
}

// Re-sync a running clock when (re)entering the live view, e.g. a late joiner.
function resumeRemoteClockIfRunning() {
  if (!_remoteClockState || !_remoteClockState.running) return;
  if (_remoteClockState.senderId === presenceId) return;
  if (liveClockRunning) return;
  _applyingRemoteClock = true;
  try {
    const anchor = Number(_remoteClockState.anchorMs) || Date.now();
    elapsedSecs = Math.max(0, Math.floor((Date.now() - anchor) / 1000));
    startTimer(anchor);
    updateLiveClockButton();
    updateBotBar();
    updateLiveRemain();
  } finally {
    _applyingRemoteClock = false;
  }
}

function startTimer(anchorMs) {
  stopTimer(false);
  liveClockRunning = true;
  // anchorMs lets a synced (remote) clock line up to the exact origin the caller
  // started from; locally we derive it from the elapsed time so far.
  const start = (typeof anchorMs === 'number' && anchorMs > 0) ? anchorMs : (Date.now() - elapsedSecs * 1000);
  liveTimerStartMs = start;
  timerInterval = setInterval(()=>{
    const elapsedMs = Date.now() - start;
    elapsedSecs = Math.floor(elapsedMs / 1000);
    const el = document.getElementById('ls-timer');
    if (el) {
      el.textContent = fmtProductionClock(elapsedMs);
      const total = totalSecs();
      el.classList.toggle('warn', total>0 && elapsedSecs>total*0.9);
    }
    updateBotBar();
    updateLiveOverview();
    updateWallClock();
  },1000 / Math.min(frameRate, 30));
  updateLiveClockButton();
}

function updateWallClock() {
  const clockEl = document.getElementById('ls-clock');
  if (!clockEl) return;
  const now = new Date();
  const h=now.getHours(), m=now.getMinutes(), s=now.getSeconds();
  const ap=h>=12?'PM':'AM', h12=h%12||12;
  clockEl.textContent=`${h12}:${pad(m)}:${pad(s)} ${ap}`;
}

function stopTimer(stopPrompter=true) {
  clearInterval(timerInterval); timerInterval=null;
  liveTimerStartMs = null;
  liveClockRunning = false;
  updateLiveClockButton();
  if (!stopPrompter) return;
  clearInterval(_prompterPingInterval); _prompterPingInterval=null;
  if (_prompterStorageHandler) {
    window.removeEventListener('storage', _prompterStorageHandler);
    _prompterStorageHandler = null;
  }
}

// ─────────────────────────────────────────────────────────────
// SETTINGS & THEME
// ─────────────────────────────────────────────────────────────
function applyTheme(t) {
  const root = document.documentElement;
  root.classList.add('theme-switching');
  root.setAttribute('data-theme', normalizeCueolaTheme(t));
  requestAnimationFrame(() => requestAnimationFrame(() => root.classList.remove('theme-switching')));
}

function applyPlandaBearTheme(t) {
  plandaBearTheme = normalizePlandaBearTheme(t);
  document.documentElement.setAttribute('data-plandabear-theme', plandaBearTheme);
  document.querySelectorAll('[data-plandabear-theme-choice]').forEach(btn => {
    const active = btn.dataset.plandabearThemeChoice === plandaBearTheme;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-pressed', active ? 'true' : 'false');
  });
}

function setPlandaBearTheme(t) {
  applyPlandaBearTheme(t);
  try { localStorage.setItem('cueola_plandabear_theme', plandaBearTheme); } catch {}
}

function togglePlandaBearThemes() {
  const bar = document.querySelector('#paperworkHubModal .plandabear-theme-bar');
  const btn = document.getElementById('plandabearThemeToggle');
  const open = !bar?.classList.contains('on');
  bar?.classList.toggle('on', open);
  btn?.classList.toggle('active', open);
}

function selectTheme(t) {
  currentTheme = normalizeCueolaTheme(t);
  document.querySelectorAll('#modal-settings .theme-swatch').forEach(s => {
    const active = s.dataset.theme === currentTheme;
    s.classList.toggle('active', active);
    s.setAttribute('aria-pressed', active ? 'true' : 'false');
  });
  applyTheme(currentTheme); // live preview — reverted on Cancel, saved on Save
}

// Front-page theme picker — applies and persists immediately (no Save step).
function toggleEntryThemes() {
  const panel = document.getElementById('entryThemePanel');
  const gear = document.getElementById('entryThemeGear');
  if (!panel) return;
  const open = panel.hasAttribute('hidden');
  panel.toggleAttribute('hidden', !open);
  gear?.classList.toggle('active', open);
  if (open) syncEntryThemeSwatches();   // dismissal handled by uiDismissRegister (P6)
}
function closeEntryThemes() {
  document.getElementById('entryThemePanel')?.setAttribute('hidden', '');
  document.getElementById('entryThemeGear')?.classList.remove('active');
}
function pickEntryTheme(t) {
  currentTheme = normalizeCueolaTheme(t);
  applyTheme(currentTheme);
  try { localStorage.setItem('cueola_theme', currentTheme); } catch {}
  if (!hasPlandaBearThemeOverride()) applyPlandaBearTheme(cueolaThemeToPlandaBearTheme(currentTheme));
  syncEntryThemeSwatches();
}
function syncEntryThemeSwatches() {
  document.querySelectorAll('#entryThemePanel .theme-swatch').forEach(s => {
    const active = s.dataset.theme === currentTheme;
    s.classList.toggle('active', active);
    s.setAttribute('aria-pressed', active ? 'true' : 'false');
  });
}

function saveSettings() {
  const nameIn = document.getElementById('set-showname');
  if (!nameIn.disabled) show.name = nameIn.value.trim()||show.name;
  show.start = timeInputValue('set-starttime');
  frameRate = normalizeFrameRate(document.getElementById('set-framerate')?.value);
  applyTheme(currentTheme);
  localStorage.setItem('cueola_theme', currentTheme);
  localStorage.setItem('cueola_frame_rate', String(frameRate));
  hideModal('modal-settings');
  renderRundown(); syncToFirestore();
}

let _settingsOpenTheme = null; // theme at the time settings opened, for Cancel revert

function cancelSettings() {
  // Revert live preview to whatever was saved before opening
  if (_settingsOpenTheme !== null) {
    currentTheme = _settingsOpenTheme;
    applyTheme(currentTheme);
    _settingsOpenTheme = null;
  }
  hideModal('modal-settings');
}

// Pre-fill settings on open
const _origShowModal = window.showModal;
window.showModal = function(id) {
  if (id==='modal-settings') {
    const locked = !adminSession;
    const nameIn = document.getElementById('set-showname');
    nameIn.value = show.name||'';
    nameIn.disabled = locked;
    nameIn.style.opacity = locked?'0.5':'1';
    document.getElementById('showname-locked-hint').style.display = locked?'block':'none';
    setTimeInputValue('set-starttime', show.start);
    const fps = document.getElementById('set-framerate');
    if (fps) fps.value = String(frameRate);
    const saved = normalizeCueolaTheme(localStorage.getItem('cueola_theme'));
    _settingsOpenTheme = saved; // remember so Cancel can revert
    currentTheme = saved;
    document.querySelectorAll('#modal-settings .theme-swatch').forEach(s => {
      const active = s.dataset.theme === saved;
      s.classList.toggle('active', active);
      s.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
  }
  if (typeof _origShowModal === 'function') return _origShowModal(id);
  return null;
};

// ─────────────────────────────────────────────────────────────
// CALL SHEET
// ─────────────────────────────────────────────────────────────
const PAPERWORK_ITEMS = [
  { order:1, id:'call-sheet', title:'Call Sheet', sub:'Who, where, and when — the sheet the whole crew works from.' },
  { order:2, id:'production-scheduler', title:'Production Schedule', sub:'Setup day and show day, hour by hour, ending in the last checks before doors.' },
  { order:3, id:'safety-plan', title:'Safety Plan', sub:'Emergency contacts, safe locations, weather, and equipment — sorted before you need it.' },
  { order:4, id:'rundown', title:'Full Rendered Rundown', sub:'Your whole show, cue by cue, ready to print.' },
  { order:5, id:'video-patch', title:'Video Patch Sheet', sub:'Where every video line runs, source to destination, cabling included.' },
  { order:6, id:'audio-comms-patch', title:'Audio and Comms Patch Sheets', sub:'Audio routing plus who talks on which comms channel.' },
  { order:7, id:'production-notes', title:'Production Notes', sub:'The crew’s message board — tag a department and the thread stays with the show.' },
];
const PRODUCTION_CHECKLIST_GUIDES = [
  { area:'Record path', hint:'Confirm record destination, inputs, media space, format, and expected runtime.' },
  { area:'Camera chain', hint:'Confirm cameras, lenses, white balance, shade, framing, and return/video paths.' },
  { area:'Audio chain', hint:'Confirm mics, program audio, playback audio, monitors, and backup routing.' },
  { area:'Playback and GFX', hint:'Confirm media, graphics, keys, lower thirds, and roll tests.' },
  { area:'Switcher and routing', hint:'Confirm sources, destinations, multiview, stream, and record routes.' },
  { area:'Lighting look', hint:'Confirm focus, color, cue looks, house lights, and fixture safety.' },
  { area:'Stage and talent', hint:'Confirm marks, chairs, props, IFB, scripts, water, and talent positions.' },
  { area:'Crew comms', hint:'Confirm headsets, channels, hand signals, and show-caller expectations.' },
  { area:'Safety and access', hint:'Confirm exits, cables, weather, security, first aid, and trip hazards.' },
  { area:'Flowmingo', hint:'Confirm session code, script, theme, mirror, speed, size, and auto-pause marks.' },
  { area:'Final go/no-go', hint:'Confirm every department is ready before the show starts.' },
];
const DEFAULT_PRODUCTION_CHECKS = [
  { area:'Setup complete', item:'Setup is complete and the room is ready for show.' },
  { area:'Record path', item:'Recording destination, inputs, media space, and format are confirmed.' },
  { area:'Camera and video', item:'Cameras, video sources, routing, and multiview are checked.' },
  { area:'Audio', item:'Microphones, playback audio, program audio, and monitors are checked.' },
  { area:'Playback and graphics', item:'Playback, graphics, keys, lower thirds, and roll tests are complete.' },
  { area:'Crew comms', item:'Headsets, channels, hand signals, and show-caller expectations are confirmed.' },
  { area:'Flowmingo', item:'Flowmingo session, script, speed, size, theme, mirror, and remote control are confirmed.' },
  { area:'Final go/no-go', item:'The show caller has confirmed every department is ready.' },
];
let activePatchKind = '';
let activePaperworkItemId = '';
let plandaBearComments = [];
let plandaBearNotes = [];

function preProKey() {
  return `cueola_prepro_${session.code || session.userName || 'local'}`;
}

function loadPreProData() {
  try { return JSON.parse(localStorage.getItem(preProKey()) || '{}') || {}; } catch { return {}; }
}

function preProActor() {
  const n = (session.userName || '').trim();
  if (n) return n;
  return session.role === 'instructor' ? 'Instructor' : 'Someone';
}

function persistPreProData(patch, section) {
  const next = { ...loadPreProData(), ...patch, updatedAt: Date.now() };
  try { localStorage.setItem(preProKey(), JSON.stringify(next)); } catch {}
  syncPreProToFirestore(next, section);
  return next;
}

let _pbSuppressActivity = false;  // debounced live-typing saves shouldn't log an activity entry each keystroke
function syncPreProToFirestore(data=loadPreProData(), section) {
  if (!window._firebaseReady || !session.code || session.isDemo || session.isExpert) return;
  const ref = window._doc(window._db,'sessions',session.code);
  window._updateDoc(ref, { prePro:data }).catch(err => reportCloudWriteFailure('Planda Bear cloud save', err));
  if (section && !_pbSuppressActivity && window._arrayUnion) {
    const entry = { section, by: preProActor(), clientId: CLIENT_ID, at: Date.now() };
    window._updateDoc(ref, { preProActivity: window._arrayUnion(entry) }).catch(err => reportCloudWriteFailure('Planda Bear activity save', err));
  }
}

// Pull shared Planda Bear work saved by others (cloud → local) so every
// device in the session sees the latest package.
async function hydratePreProFromFirestore() {
  if (!window._firebaseReady || !session.code || session.isDemo || session.isExpert) return;
  try {
    const snap = await window._getDoc(window._doc(window._db,'sessions',session.code));
    if (!snap.exists()) return;
    const server = snap.data().prePro;
    if (!server || typeof server !== 'object') return;
    const local = loadPreProData();
    if (!local.updatedAt || (server.updatedAt || 0) > (local.updatedAt || 0)) {
      localStorage.setItem(preProKey(), JSON.stringify(server));
    }
  } catch {}
}

// ═════════════════════════════════════════════════════════════════
// PLANDA BEAR — LIVE COLLABORATION
// See who else is in the workspace, which page they're on, and which field
// they're editing in real time; refresh fields others change as they type.
// ═════════════════════════════════════════════════════════════════
const PB_PAGE_LABELS = {
  'hub':'Planda Bear', 'call-sheet':'Call Sheet', 'production-scheduler':'Production Schedule',
  'safety-plan':'Safety Plan', 'video-patch':'Video Patch', 'audio-comms-patch':'Audio / Comms Patch',
  'production-notes':'Production Notes',
};
let _pbFieldSaveTimer = null;
let _pbFieldBlurTimer = null;

// Which Planda Bear page is open right now (null when the workspace is closed).
function pbOpenPageId() {
  if (document.getElementById('safetyPlanModal')?.classList.contains('on')) return 'safety-plan';
  if (document.getElementById('productionScheduleModal')?.classList.contains('on')) return 'production-scheduler';
  if (document.getElementById('preProModal')?.classList.contains('on')) return 'call-sheet';
  if (document.getElementById('patchSheetModal')?.classList.contains('on')) return (typeof activePatchKind !== 'undefined' && activePatchKind === 'video') ? 'video-patch' : 'audio-comms-patch';
  if (document.getElementById('productionNotesModal')?.classList.contains('on')) return 'production-notes';
  if (document.getElementById('paperworkHubModal')?.classList.contains('on')) return 'hub';
  return null;
}

function pbWritePresence(patch) {
  if (!window._firebaseReady || !session.code || session.isDemo || session.isExpert) return;
  const updates = { [`presence.${presenceId}.lastSeen`]: Date.now() };
  for (const k in patch) {
    updates[`presence.${presenceId}.${k}`] = (patch[k] == null) ? window._deleteField() : patch[k];
  }
  window._updateDoc(window._doc(window._db, 'sessions', session.code), updates).catch(() => {});
}

// Announce which page I'm on (and drop any stale "editing" marker).
function pbSetPresencePage(pageId) {
  pbWritePresence({ pbPage: pageId || null, pbField: null });
  pbRenderPagePresence();
}

function pbSetPresenceField(fieldKey) {
  pbWritePresence({ pbField: fieldKey || null });
}

// Build rundown: announce which row I'm editing so collaborators see where I am.
function setRundownPresence(beatId) {
  pbWritePresence({ rdBeat: (beatId == null ? null : Number(beatId)) });
}
function rundownRowPresenceHTML(beatId) {
  if (!currentPresence || !session.code || session.isDemo || session.isExpert) return '';
  const now = Date.now();
  const people = Object.entries(currentPresence)
    .filter(([id, p]) => id !== presenceId && p && Number(p.rdBeat) === Number(beatId) && (now - (p.lastSeen || 0) < 25000))
    .map(([, p]) => p);
  if (!people.length) return '';
  return `<span class="rd-row-presence" title="Editing now">` + people.slice(0, 3).map(p =>
    `<span class="rd-pres-avatar ${p.role === 'instructor' ? 'inst' : 'stud'}" data-fullname="${esc(p.name)} · editing">${esc(pbInitials(p.name))}</span>`
  ).join('') + `</span>`;
}

function pbActiveCollabPeople() {
  const now = Date.now();
  return Object.entries(currentPresence || {})
    .filter(([id, p]) => id !== presenceId && p && p.name && (now - (p.lastSeen || 0)) < 90000)
    .map(([id, p]) => ({ id, ...p }));
}

// Render the "also here" strip in the open page's header. (pbInitials is the
// shared helper defined with the production-notes code.)
function pbRenderPagePresence() {
  const pageId = pbOpenPageId();
  document.querySelectorAll('[data-pb-collab]').forEach(box => {
    const boxPage = box.getAttribute('data-pb-collab');
    if (boxPage && boxPage !== pageId) { box.innerHTML = ''; return; }
    const here = pbActiveCollabPeople();
    const onThisPage = here.filter(p => p.pbPage === pageId);
    const elsewhere = here.filter(p => p.pbPage && p.pbPage !== pageId);
    if (!here.length) { box.innerHTML = ''; return; }
    const avatar = p => `<span class="pb-collab-avatar ${p.role === 'instructor' ? 'inst' : 'stud'}" data-fullname="${esc(p.name)}${p.pbPage && p.pbPage !== pageId ? ' · ' + esc(PB_PAGE_LABELS[p.pbPage] || p.pbPage) : ' · on this page'}">${esc(pbInitials(p.name))}</span>`;
    let html = '';
    if (onThisPage.length) html += `<span class="pb-collab-label">On this page</span>${onThisPage.map(avatar).join('')}`;
    if (elsewhere.length) html += `<span class="pb-collab-label dim">Elsewhere</span>${elsewhere.map(avatar).join('')}`;
    box.innerHTML = html;
  });
}

// Highlight the inputs other people are actively editing.
function pbRenderFieldPresence() {
  document.querySelectorAll('.pb-field-busy').forEach(el => el.classList.remove('pb-field-busy'));
  document.querySelectorAll('.pb-field-editor-chip').forEach(el => el.remove());
  const pageId = pbOpenPageId();
  if (!pageId || pageId === 'hub') return;
  const now = Date.now();
  Object.entries(currentPresence || {}).forEach(([id, p]) => {
    if (id === presenceId || !p || !p.pbField || p.pbPage !== pageId) return;
    if (now - (p.lastSeen || 0) > 25000) return;   // "editing" is short-lived
    const el = document.getElementById(p.pbField);
    if (!el || el === document.activeElement) return;
    el.classList.add('pb-field-busy');
    const field = el.closest('.field') || el.parentElement;
    if (field) {
      field.style.position = 'relative';
      const chip = document.createElement('div');
      chip.className = 'pb-field-editor-chip';
      chip.textContent = `✏️ ${p.name || 'Someone'}`;
      field.appendChild(chip);
    }
  });
}

// Fields this user touched in the last few seconds. The collab refresh must
// never revert them: a time picked from the native picker (or any field the
// user clicks away from) is no longer document.activeElement when the 650ms
// debounced save runs, and the old focus-only guard let the pre-save merge
// overwrite the fresh value with the last-saved one — typed times vanished.
const _pbRecentLocalEdits = new Map();   // field id -> last local input ts
const PB_LOCAL_EDIT_HOLD_MS = 10000;
function pbNoteLocalEdit(id) {
  if (id) _pbRecentLocalEdits.set(id, Date.now());
}
function pbFieldRecentlyEdited(id) {
  const t = _pbRecentLocalEdits.get(id);
  return Boolean(t && (Date.now() - t) < PB_LOCAL_EDIT_HOLD_MS);
}

// Update a scalar field from the latest cloud data, unless the user is in it
// (or just edited it — see above).
function pbSetFieldIfIdle(id, val) {
  const el = document.getElementById(id);
  if (!el || el === document.activeElement || pbFieldRecentlyEdited(id)) return;
  if (el.value !== val) el.value = val;
}

function pbRefreshSafetyFields() {
  const data = loadPreProData();
  const safety = data.safety || {};
  const wxNote = typeof safety.weather === 'string' ? safety.weather : '';
  pbSetFieldIfIdle('sp-hospital', safety.hospital || data.hospital || '');
  pbSetFieldIfIdle('sp-weather', wxNote || safetyPlanWeatherAutoText(data));
  pbSetFieldIfIdle('sp-first-aid', safety.firstAid || '');
  pbSetFieldIfIdle('sp-fire', safety.fire || '');
  pbSetFieldIfIdle('sp-emergency', safety.emergency || '');
  pbSetFieldIfIdle('sp-nonemergency', safety.nonemergency || '');
  pbSetFieldIfIdle('sp-security', safetySecurityValue(safety.security));
  pbSetFieldIfIdle('sp-late', safety.late || data.late || '');
  pbSetFieldIfIdle('sp-equipment', safety.equipment || data.equipment || '');
  pbSetFieldIfIdle('sp-notes', safety.notes || '');
  renderSafetyPlanWeatherSymbols(data);
}

function pbRefreshScheduleFields() {
  const callSheet = loadPreProData();
  const schedule = productionScheduleWithCallSheet(callSheet.productionSchedule || {}, callSheet);
  pbSetFieldIfIdle('ps-date', schedule.date || '');
  pbSetFieldIfIdle('ps-setup', timeTo24(schedule.setup));
  pbSetFieldIfIdle('ps-call', timeTo24(schedule.call));
  pbSetFieldIfIdle('ps-show', timeTo24(schedule.show));
  pbSetFieldIfIdle('ps-wrap', timeTo24(schedule.wrap));
  pbSetFieldIfIdle('ps-show-date', schedule.showDate || '');
  pbSetFieldIfIdle('ps-doors', schedule.doors || '');
  pbSetFieldIfIdle('ps-location', schedule.location || '');
  pbSetFieldIfIdle('ps-address', schedule.address || '');
  pbSetFieldIfIdle('ps-setup-notes', schedule.setupNotes || '');
  pbSetFieldIfIdle('ps-show-notes', schedule.showNotes || '');
}

// For type=time inputs, the value must be HH:MM (24h). setTimeInputValue handles
// AM/PM strings; mirror just enough of it for the idle refresh.
function timeTo24(v) {
  if (!v) return '';
  const s = String(v).trim();
  if (/^\d{2}:\d{2}$/.test(s)) return s;
  const m = /^(\d{1,2}):(\d{2})\s*([AaPp][Mm])?$/.exec(s);
  if (!m) return '';
  let h = parseInt(m[1], 10);
  const ap = (m[3] || '').toLowerCase();
  if (ap === 'pm' && h < 12) h += 12;
  if (ap === 'am' && h === 12) h = 0;
  return `${String(h).padStart(2, '0')}:${m[2]}`;
}

// Live-refresh the Call Sheet's scalar fields + crew grid (for the call sheet the
// local user is actually viewing — activeCallSheetIndex is per-device, so we only
// touch that sheet). Skips focused inputs and the crew grid while it's being edited.
function pbRefreshCallSheetFields() {
  const data = loadPreProData();
  const sheets = getCallSheets(data);
  const idx = Math.max(0, Math.min(Number(activeCallSheetIndex) || 0, sheets.length - 1));
  const sheet = normalizeCallSheet(sheets[idx], idx);
  pbSetFieldIfIdle('pp-sheet-label', sheet.label || '');
  pbSetFieldIfIdle('pp-production', sheet.production || show.name || '');
  pbSetFieldIfIdle('pp-date', sheet.date || '');
  pbSetFieldIfIdle('pp-call', timeTo24(sheet.call));
  pbSetFieldIfIdle('pp-location', sheet.location || '');
  pbSetFieldIfIdle('pp-address', sheet.address || '');
  pbSetFieldIfIdle('pp-late', sheet.late || '');
  pbSetFieldIfIdle('pp-parking', sheet.parking || '');
  pbSetFieldIfIdle('pp-entrance', sheet.entrance || '');
  pbSetFieldIfIdle('pp-stream', sheet.stream || '');
  pbSetFieldIfIdle('pp-dress', sheet.dress || '');
  pbSetFieldIfIdle('pp-meals', sheet.meals || '');
  pbSetFieldIfIdle('pp-notes', sheet.notes || '');
  // Crew grid is an array — re-render it (so adds/removes sync) only when nobody
  // is typing in it, then keep the local roster in step for the next save.
  const people = Array.isArray(sheet.people) && sheet.people.length ? sheet.people : [{ name:'', position:'', email:'', phone:'', call:'' }];
  if (!document.activeElement?.closest?.('#pp-crew-grid') && JSON.stringify(people) !== JSON.stringify(callSheetPeople)) {
    callSheetPeople = people;
    renderCallSheetPeople();
  }
}

// Live-refresh patch grids: update existing cells in place (skip focused); when the
// user isn't typing in a grid, re-render so row adds/removes from others show up.
function pbRenderPatchBody() {
  const body = document.getElementById('patchSheetBody');
  if (!body) return;
  body.innerHTML = activePatchKind === 'video'
    ? renderPatchTable('video', 'Video Patch Sheet')
    : renderPatchTable('audio', 'Audio Patch Sheet') + renderPatchTable('comms', 'Comms Patch Sheet');
}
function pbRefreshPatchFields() {
  const data = loadPreProData();
  const kinds = activePatchKind === 'video' ? ['video'] : ['audio', 'comms'];
  const editingInGrid = !!document.activeElement?.closest?.('.patch-table');
  if (editingInGrid) {
    kinds.forEach(kind => {
      const rows = data[`${kind}PatchRows`];
      if (!Array.isArray(rows)) return;
      document.querySelectorAll(`[data-patch-kind="${kind}"]`).forEach(input => {
        if (input === document.activeElement) return;
        const r = rows[Number(input.dataset.patchRow)];
        const val = r ? (r[input.dataset.patchField] || '') : input.value;
        if (input.value !== val) input.value = val;
      });
    });
    return;
  }
  const differs = kinds.some(kind => {
    const rows = data[`${kind}PatchRows`];
    if (!Array.isArray(rows)) return false;
    return JSON.stringify(rows) !== JSON.stringify(collectPatchRows(kind, true));
  });
  if (differs) pbRenderPatchBody();
}

// Pull live edits from collaborators into the open forms.
function pbRefreshOpenPaperworkFields() {
  const pageId = pbOpenPageId();
  if (pageId === 'safety-plan') pbRefreshSafetyFields();
  else if (pageId === 'production-scheduler') pbRefreshScheduleFields();
  else if (pageId === 'call-sheet') pbRefreshCallSheetFields();
  else if (pageId === 'video-patch' || pageId === 'audio-comms-patch') pbRefreshPatchFields();
}

// Called from the session snapshot after presence is updated.
function pbApplyRemoteCollab() {
  if (!pbOpenPageId()) return;
  pbRefreshOpenPaperworkFields();
  pbRenderFieldPresence();
  pbRenderPagePresence();
}

function pbIsCollabField(el) {
  return el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') && el.id;
}

let _pbCollabListenersReady = false;
function pbInitCollabListeners() {
  if (_pbCollabListenersReady) return;
  _pbCollabListenersReady = true;
  ['preProModal', 'productionScheduleModal', 'safetyPlanModal', 'patchSheetModal'].forEach(id => {
    const modal = document.getElementById(id);
    if (!modal) return;
    modal.addEventListener('focusin', e => {
      if (!pbIsCollabField(e.target)) return;
      clearTimeout(_pbFieldBlurTimer);
      pbSetPresenceField(e.target.id);
    });
    modal.addEventListener('focusout', e => {
      if (!pbIsCollabField(e.target)) return;
      clearTimeout(_pbFieldBlurTimer);
      _pbFieldBlurTimer = setTimeout(() => pbSetPresenceField(null), 1500);
    });
    const queuePaperworkAutosave = e => {
      if (!pbIsCollabField(e.target)) return;
      paperworkDirty = true;
      pbNoteLocalEdit(e.target.id);
      clearTimeout(_pbFieldSaveTimer);
      _pbFieldSaveTimer = setTimeout(() => {
        // Merge in collaborators' latest values before saving so two people on
        // the same page editing different fields don't overwrite each other.
        pbRefreshOpenPaperworkFields();
        _pbSuppressActivity = true;
        try { saveOpenPaperworkSection(false); } finally { _pbSuppressActivity = false; }
      }, 650);
    };
    modal.addEventListener('input', queuePaperworkAutosave);
    // Safari commits time pickers and <select>s with only a 'change' event.
    modal.addEventListener('change', queuePaperworkAutosave);
  });
}

function paperworkItemIndex(id) {
  return PAPERWORK_ITEMS.findIndex(item => item.id === id);
}

function currentPaperworkItemId() {
  if (document.getElementById('preProModal')?.classList.contains('on')) return 'call-sheet';
  if (document.getElementById('productionScheduleModal')?.classList.contains('on')) return 'production-scheduler';
  if (document.getElementById('safetyPlanModal')?.classList.contains('on')) return 'safety-plan';
  if (document.getElementById('patchSheetModal')?.classList.contains('on')) return activePatchKind === 'video' ? 'video-patch' : 'audio-comms-patch';
  if (document.getElementById('productionNotesModal')?.classList.contains('on')) return 'production-notes';
  return activePaperworkItemId || 'call-sheet';
}

function hidePaperworkEditors() {
  ['paperPreviewModal','preProModal','productionScheduleModal','safetyPlanModal','patchSheetModal','productionNotesModal'].forEach(hideModal);
  pbUpdatePlandaBearBadge();
}

function previewPaperworkItem(id=currentPaperworkItemId()) {
  if (id === 'call-sheet') return showCallSheetPreview();
  if (id === 'production-scheduler') return showProductionSchedulePreview();
  if (id === 'safety-plan') return showSafetyPlanPreview();
  if (id === 'rundown') return showRundownPaperPreview();
  if (id === 'video-patch') return showPatchSheetPaperPreview('video');
  if (id === 'audio-comms-patch') return showPatchSheetPaperPreview('audio-comms');
  if (id === 'production-notes') return showProductionNotesPreview();
}

function savePaperworkItem(id=currentPaperworkItemId(), showToastOnSave=true) {
  if (id === 'call-sheet') { saveCallSheet(showToastOnSave); paperworkDirty = false; return; }
  if (id === 'production-scheduler') { saveProductionSchedule(showToastOnSave); paperworkDirty = false; return; }
  if (id === 'safety-plan') { saveSafetyPlan(showToastOnSave); paperworkDirty = false; return; }
  if (id === 'video-patch' || id === 'audio-comms-patch') { savePatchSheet(showToastOnSave); paperworkDirty = false; return; }
  if (id === 'production-notes') { saveProductionNoteDraft(); paperworkDirty = false; if (showToastOnSave) toast('Published notes save automatically. Draft kept.'); return; }
  if (showToastOnSave) toast('Rundown is already part of the package.');
}

function renderPaperworkNav(id, slotId='') {
  const idx = paperworkItemIndex(id);
  const item = PAPERWORK_ITEMS[idx] || PAPERWORK_ITEMS[0];
  const slotMap = {
    'call-sheet':'pbNavCallSheet',
    'production-scheduler':'pbNavProduction',
    'safety-plan':'pbNavSafety',
    'video-patch':'pbNavPatch',
    'audio-comms-patch':'pbNavPatch',
    'production-notes':'pbNavNotes',
  };
  const slot = document.getElementById(slotId || slotMap[id]);
  if (!slot || !item) return;
  slot.hidden = false;
  const isFirst = idx <= 0;
  const isLast = idx >= PAPERWORK_ITEMS.length - 1;
  // Notes post instantly and the rundown page renders itself — "Save Progress"
  // and "Preview" only make sense on the form pages.
  const saveButton = (id === 'rundown' || id === 'production-notes') ? '' : `<button type="button" class="save" onclick="savePaperworkItem('${item.id}',true)">Save Progress</button>`;
  const previewButton = (slotId === 'pbNavPreview' || id === 'production-notes') ? '' : `<button type="button" onclick="previewPaperworkItem('${item.id}')">Preview</button>`;
  slot.innerHTML = `
    <div class="paperwork-flow-left">
      <button type="button" onclick="returnToPaperworkHub()">${sfIcon('action.back')}<span>Planda Bear</span></button>
    </div>
    <div class="pb-step-pill">Step ${item.order} of ${PAPERWORK_ITEMS.length}</div>
    <div class="paperwork-flow-right">
      ${saveButton}
      ${previewButton}
      <button type="button" onclick="openPaperworkRelative(-1)" ${isFirst ? 'disabled' : ''}>${sfIcon('action.back')}<span>Previous</span></button>
      <button type="button" class="primary" onclick="openPaperworkRelative(1)"><span>${isLast ? 'Finish' : 'Next'}</span>${sfIcon('action.forward')}</button>
    </div>`;
}

function openPaperworkRelative(delta) {
  const current = currentPaperworkItemId();
  savePaperworkItem(current, false);
  const idx = paperworkItemIndex(current);
  const nextIdx = idx + delta;
  if (nextIdx < 0 || nextIdx >= PAPERWORK_ITEMS.length) return returnToPaperworkHub();
  hidePaperworkEditors();
  openPaperworkItem(PAPERWORK_ITEMS[nextIdx].id);
}

function openPaperworkHub() {
  if (!confirmSaveUnsavedPaperwork()) return;
  if (!session.code && !session.isDemo && !session.isExpert) {
    openPreProJoinModal('hub');
    return;
  }
  applyPlandaBearTheme(plandaBearTheme);
  hydratePreProFromFirestore();
  const grid = document.getElementById('paperworkGrid');
  if (grid) {
    // Production Notes lives in its own wide bar above the grid, not in the numbered list.
    grid.innerHTML = PAPERWORK_ITEMS.filter(item => item.id !== 'production-notes').map(item => `<button class="paperwork-card" data-pb-section="${PB_SECTION_FOR_ITEM[item.id]||''}" onclick="openPaperworkItem('${item.id}')">
      <div class="paperwork-card-num">${item.order}</div>
      <div>
        <div class="paperwork-card-title">${esc(item.title)}</div>
        <div class="paperwork-card-sub">${esc(item.sub)}</div>
      </div>
      <div class="paperwork-card-by" data-pb-by hidden></div>
    </button>`).join('');
  }
  showModal('paperworkHubModal');
  paperworkDirty = false;
  pbInitCollabListeners();
  pbSetPresencePage('hub');   // tell the room I'm in the Planda Bear workspace
  renderPlandaBearComments('All', 'pbCommentsHub');
  loadPlandaBearNotes().then(() => { annotatePlandaBearNoteCards(); pbUpdatePlandaBearBadge(); });
  renderPlandaBearHubActivity();
  renderPlandaBearAssignmentsCard();
}

// Crew assignments (set in Admin → Role and Planda Bear Assignments) shown to
// everyone on the hub — proof the instructor's assignments actually landed.
function renderPlandaBearAssignmentsCard() {
  const wrap = document.getElementById('pbAssignmentsCard');
  if (!wrap) return;
  const data = loadPreProData();
  const rows = Array.isArray(data.roleAssignments)
    ? data.roleAssignments.map(row => normalizeRoleAssignment(row)).filter(row => row.person && (row.position || row.paperwork.length))
    : [];
  if (!rows.length) { wrap.innerHTML = ''; return; }
  wrap.innerHTML = `<div class="pb-assign-card">
    <div class="pb-assign-title">${sfIcon('content.checklist')} Crew Assignments</div>
    ${rows.map(row => `<div class="pb-assign-row">
      <span class="pb-assign-name">${esc(row.person)}</span>
      ${row.position ? `<span class="pb-assign-pos">${esc(row.position)}</span>` : ''}
      ${row.paperwork.length ? `<span class="pb-assign-items">${esc(row.paperwork.join(' · '))}</span>` : ''}
    </div>`).join('')}
  </div>`;
}

// Leave the Planda Bear workspace and clear my page presence so collaborators
// stop seeing me "here".
function closePlandaBear() {
  saveOpenPaperworkSection(false);
  hidePaperworkEditors();
  hideModal('paperworkHubModal');
  pbSetPresencePage(null);
}

const PB_SECTION_FOR_ITEM = {
  'call-sheet':'Call Sheet',
  'production-scheduler':'Production Schedule',
  'Production Scheduler':'Production Schedule',
  'safety-plan':'Safety Plan',
  'rundown':'Full Rendered Rundown',
  'video-patch':'Video Patch',
  'audio-comms-patch':'Audio & Comms Patch',
  'production-notes':'Production Notes',
};

function pbAgo(ts) {
  if (!ts) return '';
  const diff = Date.now() - ts;
  if (diff < 60000) return 'just now';
  const m = Math.floor(diff/60000);
  if (m < 60) return m + 'm ago';
  const h = Math.floor(m/60);
  if (h < 24) return h + 'h ago';
  const d = Math.floor(h/24);
  if (d < 7) return d + 'd ago';
  return new Date(ts).toLocaleDateString([], { month:'short', day:'numeric' });
}

function pbCommentsKey() {
  return `cueola_pb_comments_${session.code || session.userName || 'local'}`;
}

function pbIsInstructor() {
  return session.role === 'instructor' || Boolean(adminSession);
}

function pbReviewerId() {
  return CLIENT_ID;
}

function pbSectionLabel(idOrSection='Overall') {
  return PB_SECTION_FOR_ITEM[idOrSection] || idOrSection || 'Overall';
}

function normalizePlandaBearComment(c) {
  return {
    id: c?.id || `pbc_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,7)}`,
    section: pbSectionLabel(c?.section || 'Overall'),
    text: String(c?.text || '').trim(),
    by: c?.by || 'Instructor',
    at: c?.at || Date.now(),
    clientId: c?.clientId || '',
    reviewedBy: Array.isArray(c?.reviewedBy) ? c.reviewedBy : [],
  };
}

function localPlandaBearComments() {
  try {
    return JSON.parse(localStorage.getItem(pbCommentsKey()) || '[]').map(normalizePlandaBearComment).filter(c => c.text);
  } catch {
    return [];
  }
}

function saveLocalPlandaBearComments(comments=plandaBearComments) {
  try { localStorage.setItem(pbCommentsKey(), JSON.stringify(comments)); } catch {}
}

async function loadPlandaBearComments() {
  if (!session.code || session.isDemo || session.isExpert || !window._firebaseReady) {
    plandaBearComments = localPlandaBearComments();
    return plandaBearComments;
  }
  try {
    const snap = await window._getDoc(window._doc(window._db, 'sessions', session.code));
    const raw = snap.exists() && Array.isArray(snap.data().preProComments) ? snap.data().preProComments : [];
    plandaBearComments = raw.map(normalizePlandaBearComment).filter(c => c.text);
    saveLocalPlandaBearComments(plandaBearComments);
  } catch {
    plandaBearComments = localPlandaBearComments();
  }
  return plandaBearComments;
}

async function writePlandaBearComments(comments, activitySection='Instructor Comment') {
  plandaBearComments = comments.map(normalizePlandaBearComment).filter(c => c.text);
  saveLocalPlandaBearComments(plandaBearComments);
  if (!window._firebaseReady || !session.code || session.isDemo || session.isExpert) return;
  const ref = window._doc(window._db, 'sessions', session.code);
  window._updateDoc(ref, { preProComments: plandaBearComments }).catch(err => reportCloudWriteFailure('Planda Bear comment save', err));
  if (activitySection && window._arrayUnion) {
    const entry = { section:activitySection, by:preProActor(), clientId:CLIENT_ID, at:Date.now() };
    window._updateDoc(ref, { preProActivity: window._arrayUnion(entry) }).catch(err => reportCloudWriteFailure('Planda Bear activity save', err));
  }
}

function plandaBearCommentApplies(comment, section) {
  if (section === 'All') return true;
  return comment.section === section || comment.section === 'Overall';
}

function plandaBearCommentReviewed(comment) {
  const reviewer = pbReviewerId();
  const actor = preProActor();
  return (comment.reviewedBy || []).some(r => r?.clientId === reviewer || (r?.name && r.name === actor));
}

function visiblePlandaBearCommentSlots() {
  return [
    ['All', 'pbCommentsHub'],
    [pbSectionLabel(activePaperworkItemId), 'pbCommentsPreview'],
    ['Call Sheet', 'pbCommentsCallSheet'],
    ['Production Schedule', 'pbCommentsProduction'],
    ['Safety Plan', 'pbCommentsSafety'],
    [activePatchKind === 'video' ? 'Video Patch' : 'Audio & Comms Patch', 'pbCommentsPatch'],
  ].filter(([,slot]) => document.getElementById(slot));
}

function rerenderVisiblePlandaBearComments() {
  visiblePlandaBearCommentSlots().forEach(([section, slot]) => renderPlandaBearComments(section, slot, false));
  annotatePlandaBearCommentCards();
}

function plandaBearCommentSectionOptions(selected='Overall') {
  const sections = ['Overall', ...PAPERWORK_ITEMS.map(item => pbSectionLabel(item.id))];
  return sections.map(section => `<option value="${esc(section)}" ${section === selected ? 'selected' : ''}>${esc(section)}</option>`).join('');
}

async function addPlandaBearComment(section, slotId) {
  if (!pbIsInstructor()) {
    toast('Only instructors can add Planda Bear comments.');
    return;
  }
  const scope = slotId || 'pbCommentsHub';
  const input = document.getElementById(`${scope}-input`);
  const select = document.getElementById(`${scope}-section`);
  const text = input?.value.trim() || '';
  const commentSection = pbSectionLabel(select?.value || section || 'Overall');
  if (!text) {
    input?.focus();
    return;
  }
  await loadPlandaBearComments();
  const comment = normalizePlandaBearComment({
    id:`pbc_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,7)}`,
    section:commentSection,
    text,
    by:preProActor(),
    at:Date.now(),
    clientId:CLIENT_ID,
    reviewedBy:[],
  });
  await writePlandaBearComments([comment, ...plandaBearComments], `Comment: ${commentSection}`);
  if (input) input.value = '';
  toast('Instructor comment added.');
  rerenderVisiblePlandaBearComments();
  renderPlandaBearHubActivity();
}

async function markPlandaBearCommentReviewed(id) {
  await loadPlandaBearComments();
  const next = plandaBearComments.map(comment => {
    if (comment.id !== id || plandaBearCommentReviewed(comment)) return comment;
    return {
      ...comment,
      reviewedBy:[...(comment.reviewedBy || []), { name:preProActor(), clientId:CLIENT_ID, at:Date.now() }],
    };
  });
  await writePlandaBearComments(next, 'Reviewed Instructor Comment');
  toast('Comment marked reviewed.');
  rerenderVisiblePlandaBearComments();
}

async function deletePlandaBearComment(id) {
  if (!pbIsInstructor()) return;
  await loadPlandaBearComments();
  const comment = plandaBearComments.find(c => c.id === id);
  await writePlandaBearComments(plandaBearComments.filter(c => c.id !== id), comment ? `Removed Comment: ${comment.section}` : 'Removed Comment');
  toast('Instructor comment removed.');
  rerenderVisiblePlandaBearComments();
  renderPlandaBearHubActivity();
}

function renderPlandaBearComments(section='All', slotId='pbCommentsHub', shouldLoad=true) {
  const slot = document.getElementById(slotId);
  if (!slot) return;
  const doRender = () => {
    const targetSection = pbSectionLabel(section);
    const comments = plandaBearComments
      .filter(comment => plandaBearCommentApplies(comment, targetSection))
      .sort((a,b)=>(b.at||0)-(a.at||0));
    const canComment = pbIsInstructor();
    const addSection = targetSection === 'All' ? 'Overall' : targetSection;
    const sectionSelect = targetSection === 'All'
      ? `<select class="field-in" id="${slotId}-section" aria-label="Comment section">${plandaBearCommentSectionOptions('Overall')}</select>`
      : `<input type="hidden" id="${slotId}-section" value="${esc(addSection)}">`;
    const studentCopy = comments.length
      ? 'Mark each note reviewed once you’ve made the change or talked it through.'
      : 'Feedback from your instructor lands here.';
    const instructorCopy = 'Leave feedback without touching the paperwork itself.';
    slot.innerHTML = `<div class="pb-comments" data-pb-comments-for="${esc(targetSection)}">
      <div class="pb-comments-head">
        <div>
          <div class="pb-comments-title">Instructor Comments</div>
          <div class="pb-comments-sub">${canComment ? instructorCopy : studentCopy}</div>
        </div>
        <div class="pb-comments-count">${comments.length} note${comments.length===1?'':'s'}</div>
      </div>
      <div class="pb-comment-list">
        ${comments.length ? comments.map(comment => {
          const reviewed = plandaBearCommentReviewed(comment);
          const reviewedCount = (comment.reviewedBy || []).length;
          return `<div class="pb-comment-card">
            <div class="pb-comment-meta">
              <span class="pb-comment-section">${esc(comment.section)}</span>
              <span>by ${esc(comment.by || 'Instructor')}</span>
              <span>${pbAgo(comment.at)}</span>
              ${reviewedCount ? `<span>${reviewedCount} reviewed</span>` : ''}
            </div>
            <div class="pb-comment-text">${esc(comment.text)}</div>
            <div class="pb-comment-actions">
              ${!canComment ? (reviewed
                ? '<span class="pb-comment-reviewed">Reviewed by you</span>'
                : `<button type="button" class="pb-comment-review" onclick="markPlandaBearCommentReviewed('${esc(comment.id)}')">Mark reviewed</button>`) : ''}
              ${canComment ? `<button type="button" class="pb-comment-delete" onclick="deletePlandaBearComment('${esc(comment.id)}')">Remove</button>` : ''}
            </div>
          </div>`;
        }).join('') : (canComment ? '<div class="pb-comment-empty">Nothing yet — notes you leave show up here for the whole group.</div>' : '')}
      </div>
      ${canComment ? `<div class="pb-comment-form">
        ${sectionSelect}
        <textarea class="field-in" id="${slotId}-input" rows="2" placeholder="Add a comment for students to review..."></textarea>
        <button type="button" class="pb-comment-add" onclick="addPlandaBearComment('${esc(addSection)}','${esc(slotId)}')">Add Comment</button>
      </div>` : ''}
    </div>`;
    annotatePlandaBearCommentCards();
  };
  if (shouldLoad) loadPlandaBearComments().then(doRender);
  else doRender();
}

function annotatePlandaBearCommentCards() {
  const cards = document.querySelectorAll('#paperworkGrid [data-pb-section]');
  if (!cards.length) return;
  cards.forEach(card => {
    const section = card.getAttribute('data-pb-section');
    let badge = card.querySelector('[data-pb-comments]');
    if (!badge) {
      badge = document.createElement('div');
      badge.dataset.pbComments = '';
      badge.className = 'paperwork-card-comments';
      card.appendChild(badge);
    }
    const count = plandaBearComments.filter(comment => comment.section === section).length;
    badge.classList.toggle('on', count > 0);
    badge.textContent = count ? `${count} instructor note${count===1?'':'s'}` : '';
  });
}

/* ══════════════════════════════════════════════════════════════════════
   PRODUCTION NOTES — a shared discussion board inside Planda Bear.
   Anyone on the session code can post a note (tagged by department or as
   a To-Do), reply in a thread under any note, edit their own posts, and
   attach images or documents. Instructors can pin notes to the top.
   Notes live on the session doc (preProNotes) so the whole team sees the
   same living board; attachment payloads are stored as sibling `pbfile_*`
   docs in the sessions collection (chunked to stay under the 1 MiB
   Firestore doc limit) so the board itself stays light.
   ══════════════════════════════════════════════════════════════════════ */

let pbPendingAttachments = [];   // staged uploads, sent with the next note
let pbReplyPendingAttachments = []; // staged uploads for the open reply composer
let pbReplyTargetId = null;      // root note id with an open reply composer
let pbEditingNoteId = null;      // note id currently being edited inline
let pbNotesFilterTag = 'all';    // active tag filter chip
let pbNotesSearch = '';          // live search query
let pbNotesNewestFirst = true;   // thread sort direction
let pbComposerTag = 'general';   // tag selected in the composer
const pbCollapsed = new Set();    // note ids whose thread is collapsed to a one-line summary
const pbNoteFileCache = new Map(); // fileId -> dataURL

const PB_NOTE_TAGS = {
  general:  { label:'General',  symbol:'content.note' },
  audio:    { label:'Audio',    symbol:'department.audio' },
  video:    { label:'Video',    symbol:'department.video' },
  lighting: { label:'Lighting', symbol:'department.lighting' },
  content:  { label:'Content',  symbol:'content.script' },
  gfx:      { label:'GFX',      symbol:'department.graphics' },
  question: { label:'Question', symbol:'content.question' },
  todo:     { label:'To-Do',    symbol:'content.checklist' },
};

const PB_FILE_CHUNK_CHARS = 800000;          // dataURL chars per Firestore doc (~600 KB binary)
const PB_FILE_MAX_BYTES = 4 * 1024 * 1024;   // document upload cap
const PB_IMAGE_MAX_EDGE = 1600;              // px — larger images get resized + compressed
const PB_MAX_ATTACHMENTS = 6;                // per note

function pbNotesKey() {
  return `cueola_pb_notes_${session.code || session.userName || 'local'}`;
}

function productionNoteDraftKey() {
  return `cueola_pb_note_draft_${session.code || session.userName || 'local'}`;
}

function pbNormalizeNoteAttachment(a) {
  return {
    // ids are generated tokens — whitelist the charset so a crafted remote id
    // can never break out of the onclick/data- attributes it gets rendered into
    fileId: String(a?.fileId || '').replace(/[^\w.-]/g, ''),
    name: String(a?.name || 'file').slice(0, 120),
    type: String(a?.type || ''),
    size: Number(a?.size) || 0,
    isImage: Boolean(a?.isImage),
    isAudio: Boolean(a?.isAudio) || /^audio\//i.test(String(a?.type || '')),
    w: Number(a?.w) || 0,
    h: Number(a?.h) || 0,
  };
}

function normalizePlandaBearNote(n) {
  // `kind:'todo'` is the legacy field from the chat-style log — map it to a tag.
  const tag = PB_NOTE_TAGS[n?.tag] ? n.tag : (n?.kind === 'todo' ? 'todo' : 'general');
  return {
    id: String(n?.id || '').replace(/[^\w.-]/g, '') || `pbn_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,7)}`,
    text: String(n?.text || '').trim(),
    by: n?.by || 'Someone',
    role: n?.role === 'instructor' ? 'instructor' : 'student',
    tag,
    assignee: String(n?.assignee || '').slice(0, 60),  // To-Do owner
    done: Boolean(n?.done),
    doneBy: String(n?.doneBy || '').slice(0, 60),       // who checked it off
    doneAt: Number(n?.doneAt) || 0,
    at: n?.at || Date.now(),
    clientId: n?.clientId || '',
    replyTo: typeof n?.replyTo === 'string' ? n.replyTo : '',
    editedAt: Number(n?.editedAt) || 0,
    pinned: Boolean(n?.pinned),
    avatar: pbNormalizeAvatar(n?.avatar) || { type: 'initials' },
    likes: Array.isArray(n?.likes) ? Array.from(new Set(n.likes.filter(x => typeof x === 'string'))) : [],
    mentions: Array.isArray(n?.mentions) ? n.mentions.filter(x => typeof x === 'string').map(s => s.slice(0, 60)).slice(0, 30) : [],
    checklist: Array.isArray(n?.checklist) ? n.checklist.map(pbNormalizeChecklistItem).filter(Boolean).slice(0, 40) : [],
    attachments: Array.isArray(n?.attachments) ? n.attachments.map(pbNormalizeNoteAttachment).filter(a => a.fileId) : [],
  };
}

// A single To-Do checklist item inside a note (a post can carry several).
function pbNormalizeChecklistItem(it) {
  const text = String(it?.text || '').trim().slice(0, 300);
  if (!text) return null;
  return {
    id: String(it?.id || '').replace(/[^\w.-]/g, '') || `ci_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    text,
    done: Boolean(it?.done),
    doneBy: String(it?.doneBy || '').slice(0, 60),
    doneAt: Number(it?.doneAt) || 0,
  };
}

function pbNoteHasContent(n) {
  return Boolean(n && (n.text || (n.attachments && n.attachments.length) || (n.checklist && n.checklist.length)));
}

function localPlandaBearNotes() {
  try {
    return JSON.parse(localStorage.getItem(pbNotesKey()) || '[]').map(normalizePlandaBearNote).filter(pbNoteHasContent);
  } catch {
    return [];
  }
}

function saveLocalPlandaBearNotes(notes=plandaBearNotes) {
  try { localStorage.setItem(pbNotesKey(), JSON.stringify(notes)); } catch {}
}

async function loadPlandaBearNotes() {
  if (!session.code || session.isDemo || session.isExpert || !window._firebaseReady) {
    plandaBearNotes = localPlandaBearNotes();
    return plandaBearNotes;
  }
  try {
    const snap = await window._getDoc(window._doc(window._db, 'sessions', session.code));
    const raw = snap.exists() && Array.isArray(snap.data().preProNotes) ? snap.data().preProNotes : [];
    plandaBearNotes = raw.map(normalizePlandaBearNote).filter(pbNoteHasContent);
    saveLocalPlandaBearNotes(plandaBearNotes);
    _pbNotesBaseline = new Set(plandaBearNotes.map(n => n.id));   // ids present when we loaded — used to tell my adds/deletes from a collaborator's
  } catch {
    plandaBearNotes = localPlandaBearNotes();
  }
  return plandaBearNotes;
}
let _pbNotesBaseline = new Set();

// Reconcile my intended note list against whatever is on the server RIGHT NOW,
// so two people editing at once don't clobber each other:
//  • a note the server has that I never saw (not in my baseline) → a collaborator
//    just added it → keep it.
//  • a note in my baseline but not in my new list → I deleted it → drop it.
//  • everything in my list → my adds/edits win.
function pbReconcileNotes(serverRaw, intended) {
  const serverList = (Array.isArray(serverRaw) ? serverRaw : []).map(normalizePlandaBearNote).filter(pbNoteHasContent);
  const mine = new Map(intended.map(n => [n.id, n]));
  const out = [];
  const emitted = new Set();
  for (const s of serverList) {
    if (mine.has(s.id)) { out.push(mine.get(s.id)); emitted.add(s.id); }        // my edit wins
    else if (!_pbNotesBaseline.has(s.id)) { out.push(s); }                      // collaborator's new note — keep
    // else: I deleted it since load — drop
  }
  for (const n of intended) if (!emitted.has(n.id)) out.push(n);               // my brand-new notes
  return out;
}

async function writePlandaBearNotes(notes, activitySection='Production Note') {
  const intended = notes.map(normalizePlandaBearNote).filter(pbNoteHasContent);
  plandaBearNotes = intended;
  saveLocalPlandaBearNotes(plandaBearNotes);
  if (!window._firebaseReady || !session.code || session.isDemo || session.isExpert) return;
  const ref = window._doc(window._db, 'sessions', session.code);
  try {
    if (window._runTransaction) {
      await window._runTransaction(window._db, async (tx) => {
        const snap = await tx.get(ref);
        const merged = pbReconcileNotes(snap.exists() ? snap.data().preProNotes : [], intended);
        tx.set(ref, { preProNotes: merged }, { merge: true });
        plandaBearNotes = merged;
      });
      saveLocalPlandaBearNotes(plandaBearNotes);
      _pbNotesBaseline = new Set(plandaBearNotes.map(n => n.id));
      renderPlandaBearNotes();
    } else {
      await window._updateDoc(ref, { preProNotes: intended });
    }
  } catch (err) {
    reportCloudWriteFailure('Production notes cloud save', err);
  }
  if (activitySection && window._arrayUnion) {
    const entry = { section:activitySection, by:preProActor(), clientId:CLIENT_ID, at:Date.now() };
    window._updateDoc(ref, { preProActivity: window._arrayUnion(entry) }).catch(err => reportCloudWriteFailure('Planda Bear activity save', err));
  }
}

function pbNoteActorRole() {
  return pbIsInstructor() ? 'instructor' : 'student';
}

function pbCanManageNote(note) {
  return pbIsInstructor() || (note?.clientId && note.clientId === CLIENT_ID);
}

/* ── Time + identity helpers for the board ── */
function pbSameDay(a, b) {
  const da = new Date(a), dbb = new Date(b);
  return da.getFullYear() === dbb.getFullYear() && da.getMonth() === dbb.getMonth() && da.getDate() === dbb.getDate();
}

function pbNoteClock(ts) {
  if (!ts) return '';
  try { return new Date(ts).toLocaleTimeString([], { hour:'numeric', minute:'2-digit' }); }
  catch { return ''; }
}

function pbNoteTime(ts) {
  if (!ts) return '';
  try {
    const clock = pbNoteClock(ts);
    if (pbSameDay(ts, Date.now())) return `Today at ${clock}`;
    const yest = new Date(); yest.setDate(yest.getDate() - 1);
    if (pbSameDay(ts, yest.getTime())) return `Yesterday at ${clock}`;
    return `${new Date(ts).toLocaleDateString([], { month:'short', day:'numeric' })} · ${clock}`;
  } catch { return ''; }
}

const PB_AVATAR_PALETTE = ['#5b8df8','#22d3a0','#f5b731','#f05252','#b06ef8','#f97316','#ec4899','#22d3d3'];

function pbAvatarColor(note) {
  const key = String(note?.clientId || note?.by || '?');
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return PB_AVATAR_PALETTE[h % PB_AVATAR_PALETTE.length];
}

function pbInitials(name) {
  const parts = String(name || '?').trim().split(/\s+/).slice(0, 2);
  return (parts.map(p => p[0] || '').join('').toUpperCase()) || '?';
}

/* ── User portal: pick your avatar (initials · brand animal · uploaded photo) ──
   Stored per device in cueola_profile and stamped onto each note/reply you post,
   so the whole crew sees your chosen avatar (live and in history). ── */
const PB_AVATAR_ANIMALS = {
  plandabear:  { label: 'Planda Bear', src: 'assets/Brand/Planda_Bear_icon.svg', bg: '#1b1b1b' },
  flowmingo:   { label: 'Flowmingo',   src: 'assets/Brand/Flowmingo_Icon.svg',   bg: '#3a0f1e' },
  outrangutan: { label: 'Outrangutan', src: 'assets/Brand/Outrangutan_icon.svg', bg: '#1a1817' },
  cueola:      { label: 'Cueola',      src: 'assets/Brand/Cueola_Icon.svg',      bg: '#123a2a' },
};
const PB_PROFILE_KEY = 'cueola_profile';
const pbProfileModel = CueolaAvatarProfile.createProfileModel({
  storage: localStorage,
  profileKey: PB_PROFILE_KEY,
  approvedAnimals: PB_AVATAR_ANIMALS,
});

function pbGetProfile() {
  return pbProfileModel.getProfile();
}
function pbSetProfileAvatar(avatar) {
  return pbProfileModel.setAvatar(avatar);
}

// Coerce any avatar blob to a safe shape: an approved animal key, a data:image URL, else initials.
function pbNormalizeAvatar(a) {
  return CueolaAvatarProfile.normalizeAvatar(a, PB_AVATAR_ANIMALS);
}

// The avatar chip's inner content for a note/reply author (falls back to initials).
function pbAvatarInner(note) {
  const a = pbNormalizeAvatar(note && note.avatar);
  if (a && a.type === 'animal') { const an = PB_AVATAR_ANIMALS[a.value]; return `<img class="pb-av-img" src="${an.src}" alt="" draggable="false">`; }
  if (a && a.type === 'image') return `<img class="pb-av-img" src="${esc(a.value)}" alt="" draggable="false">`;
  return esc(pbInitials(note && note.by));
}
// Background for the avatar chip: brand bg for animals, transparent for photos, else the hashed color.
function pbAvatarBg(note) {
  const a = pbNormalizeAvatar(note && note.avatar);
  if (a && a.type === 'animal') return PB_AVATAR_ANIMALS[a.value].bg;
  if (a && a.type === 'image') return 'transparent';
  return pbAvatarColor(note);
}
// My own avatar object for stamping onto a new note/reply.
function pbMyAvatar() { return pbGetProfile().avatar; }

/* ── The portal modal ── */
let _pbPortalDraft = null;   // avatar being previewed in the open portal
function openUserPortal() {
  _pbPortalDraft = pbNormalizeAvatar(pbMyAvatar()) || { type: 'initials' };
  pbRenderUserPortal();
  showModal('userPortalModal');
}
function pbPortalPick(type, value) {
  _pbPortalDraft = pbNormalizeAvatar({ type, value }) || { type: 'initials' };
  pbRenderUserPortal();
}
function pbPortalUpload(input) {
  const file = input.files && input.files[0];
  if (!file) return;
  if (!/^image\//.test(file.type)) { toast('Pick an image file.'); return; }
  const reader = new FileReader();
  reader.onload = () => {
    const img = new Image();
    img.onload = () => {
      // square-crop + downscale to a tiny avatar so it stays small enough to sync on every note
      const S = 96, c = document.createElement('canvas'); c.width = S; c.height = S;
      const ctx = c.getContext('2d');
      const side = Math.min(img.width, img.height);
      ctx.drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, S, S);
      const dataUrl = c.toDataURL('image/jpeg', 0.72);
      if (dataUrl.length > 60000) { toast('That image is too large after compression — try a simpler one.'); return; }
      _pbPortalDraft = { type: 'image', value: dataUrl };
      pbRenderUserPortal();
    };
    img.onerror = () => toast('Could not read that image.');
    img.src = reader.result;
  };
  reader.readAsDataURL(file);
  input.value = '';
}
function pbRenderUserPortal() {
  const slot = document.getElementById('userPortalBody');
  if (!slot) return;
  const me = { by: session.userName || 'You', clientId: CLIENT_ID, avatar: _pbPortalDraft };
  const sel = t => (_pbPortalDraft && _pbPortalDraft.type === t);
  const animalBtns = Object.entries(PB_AVATAR_ANIMALS).map(([k, v]) =>
    `<button type="button" class="pb-av-choice${_pbPortalDraft && _pbPortalDraft.type === 'animal' && _pbPortalDraft.value === k ? ' sel' : ''}" onclick="pbPortalPick('animal','${k}')" title="${esc(v.label)}">
      <span class="pb-av-chip" style="background:${v.bg}"><img class="pb-av-img" src="${v.src}" alt=""></span><span class="pb-av-choice-lbl">${esc(v.label)}</span>
    </button>`).join('');
  slot.innerHTML = `
    <div class="pb-portal-preview">
      <span class="pb-note-avatar pb-av-lg" style="background:${pbAvatarBg(me)}">${pbAvatarInner(me)}</span>
      <div class="pb-portal-who"><b>${esc(session.userName || 'You')}</b><span>This is how you appear on the notes board.</span></div>
    </div>
    <div class="pb-portal-label">Choose your look</div>
    <div class="pb-av-grid">
      <button type="button" class="pb-av-choice${sel('initials') ? ' sel' : ''}" onclick="pbPortalPick('initials')">
        <span class="pb-av-chip" style="background:${pbAvatarColor(me)}">${esc(pbInitials(session.userName))}</span><span class="pb-av-choice-lbl">Initials</span>
      </button>
      ${animalBtns}
      <label class="pb-av-choice pb-av-upload${sel('image') ? ' sel' : ''}">
        <span class="pb-av-chip">${sel('image') ? `<img class="pb-av-img" src="${esc(_pbPortalDraft.value)}" alt="">` : sfIcon('action.attach')}</span>
        <span class="pb-av-choice-lbl">${sel('image') ? 'Change photo' : 'Upload'}</span>
        <input type="file" accept="image/*" hidden onchange="pbPortalUpload(this)">
      </label>
    </div>`;
}
function pbSaveUserPortal() {
  pbSetProfileAvatar(_pbPortalDraft || { type: 'initials' });
  hideModal('userPortalModal');
  toast('Profile updated.');
  // Reflect the new avatar immediately on the board + the header chip.
  if (document.getElementById('productionNotesModal')?.classList.contains('on')) renderPlandaBearNotes();
  pbRenderPortalChip();
}
// The small "you" chip in the notes toolbar that opens the portal.
function pbRenderPortalChip() {
  const chip = document.getElementById('pbPortalChip');
  if (!chip) return;
  const me = { by: session.userName || 'You', clientId: CLIENT_ID, avatar: pbMyAvatar() };
  chip.innerHTML = `<span class="pb-note-avatar pb-av-sm" style="background:${pbAvatarBg(me)}">${pbAvatarInner(me)}</span>`;
}

/* ── Composer: draft, autosize, keyboard ── */
function saveProductionNoteDraft() {
  const input = document.getElementById('pbNoteInput');
  if (!input) return;
  try { localStorage.setItem(productionNoteDraftKey(), input.value); } catch {}
}

function restoreProductionNoteDraft() {
  const input = document.getElementById('pbNoteInput');
  if (!input) return;
  try { input.value = localStorage.getItem(productionNoteDraftKey()) || ''; } catch {}
}

function pbAutosizeNoteInput(el) {
  if (!el) return;
  // Main composer grows tall; reply input stays compact (capped by its own CSS max-height).
  const cap = el.id === 'pbNoteInput' ? 460 : 132;
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, cap) + 'px';
}

/* ── Lightweight markdown-style rich text ──────────────────────────────
   Notes are stored as plain text (markers like **bold**), kept escaped, and
   only a known safe subset is converted to tags on display — so syncing raw
   text between clients can never inject HTML. Supports **bold**, *italic*,
   ~~strikethrough~~, `code`, "- " bullet lists and "1. " numbered lists. ── */
function pbRichInline(s) {
  s = esc(s);
  s = s.replace(/\*\*([^\n]+?)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/~~([^\n]+?)~~/g, '<del>$1</del>');
  s = s.replace(/(^|[\s(])\*(?!\s)([^*\n]+?)\*(?=[\s).,!?:;]|$)/g, '$1<em>$2</em>');
  s = s.replace(/(^|[\s(])_(?!\s)([^_\n]+?)_(?=[\s).,!?:;]|$)/g, '$1<em>$2</em>');
  s = s.replace(/`([^`\n]+?)`/g, '<code>$1</code>');
  return s;
}

function pbRenderRichText(raw) {
  const lines = String(raw || '').split('\n');
  let html = '';
  let listType = null;
  const closeList = () => { if (listType) { html += `</${listType}>`; listType = null; } };
  for (const line of lines) {
    const bullet = line.match(/^\s*[-*]\s+(.*)$/);
    const number = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (bullet) {
      if (listType !== 'ul') { closeList(); html += '<ul class="pb-rt-list">'; listType = 'ul'; }
      html += `<li>${pbRichInline(bullet[1])}</li>`;
    } else if (number) {
      if (listType !== 'ol') { closeList(); html += '<ol class="pb-rt-list">'; listType = 'ol'; }
      html += `<li>${pbRichInline(number[1])}</li>`;
    } else {
      closeList();
      html += line.trim() === '' ? '<br>' : `<div>${pbRichInline(line)}</div>`;
    }
  }
  closeList();
  return pbApplyMentionChips(html);
}

// Plain-text fallback for the jsPDF package export (no HTML there).
function pbStripMarkdown(raw) {
  return String(raw || '')
    .replace(/\*\*([^\n]+?)\*\*/g, '$1')
    .replace(/~~([^\n]+?)~~/g, '$1')
    .replace(/`([^`\n]+?)`/g, '$1')
    .replace(/(^|[\s(])[*_](?!\s)([^*_\n]+?)[*_](?=[\s).,!?:;]|$)/g, '$1$2')
    .replace(/^\s*[-*]\s+/gm, '• ')
    .replace(/^\s*(\d+)[.)]\s+/gm, '$1. ');
}

/* ── Formatting toolbar: operate on the textarea selection ── */
function pbFmtWrap(open, close) {
  const ta = document.getElementById('pbNoteInput');
  if (!ta) return;
  const s = ta.selectionStart, e = ta.selectionEnd;
  const sel = ta.value.slice(s, e) || 'text';
  ta.value = ta.value.slice(0, s) + open + sel + close + ta.value.slice(e);
  const ns = s + open.length;
  ta.focus();
  ta.setSelectionRange(ns, ns + sel.length);
  saveProductionNoteDraft();
  pbAutosizeNoteInput(ta);
}

function pbFmtList(ordered) {
  const ta = document.getElementById('pbNoteInput');
  if (!ta) return;
  const s = ta.selectionStart, e = ta.selectionEnd;
  const before = ta.value.slice(0, s);
  const sel = ta.value.slice(s, e) || 'List item';
  const out = sel.split('\n').map((ln, i) => (ordered ? `${i + 1}. ` : '- ') + ln).join('\n');
  const lead = (before && !before.endsWith('\n')) ? '\n' : '';
  ta.value = before + lead + out + ta.value.slice(e);
  const ns = s + lead.length;
  ta.focus();
  ta.setSelectionRange(ns, ns + out.length);
  saveProductionNoteDraft();
  pbAutosizeNoteInput(ta);
}

async function pbExportDraftPDF() {
  const text = document.getElementById('pbNoteInput')?.value.trim() || '';
  if (!text) { toast('Type a note first, then export it.'); return; }
  const draft = normalizePlandaBearNote({
    text, by: preProActor(), role: pbNoteActorRole(), tag: pbComposerTag, at: Date.now(), clientId: CLIENT_ID,
  });
  try {
    toast('Building note PDF...');
    const stamp = new Date().toISOString().slice(0, 10);
    await exportPaperHTMLAsPDF(productionNoteDocHTML(draft), `cueola-production-note-${stamp}.pdf`);
    toast('Note PDF downloaded.');
  } catch (e) {
    toast('PDF export needs an internet connection. Use the browser print dialog instead.');
    window.print();
  }
}

function pbNoteInputKeydown(e) {
  if (pbMentionKeydown(e)) return;   // mention autocomplete owns keys while open
  const mod = e.metaKey || e.ctrlKey;
  if (mod && e.key === 'Enter') { e.preventDefault(); publishPlandaBearNote(); return; }
  if (mod && (e.key === 'b' || e.key === 'B')) { e.preventDefault(); pbFmtWrap('**', '**'); return; }
  if (mod && (e.key === 'i' || e.key === 'I')) { e.preventDefault(); pbFmtWrap('*', '*'); return; }
  // plain Enter inserts a new line (default textarea behavior)
}

// Front-page shortcut: jump straight to the notes board. Notes are session-scoped,
// so with no session we route through the join prompt in notes mode — Production
// Notes copy, and a successful join lands directly on the board, never the hub.
function openProductionNotesShortcut(e) {
  e?.stopPropagation?.();
  if (session.code || session.isDemo || session.isExpert) { openProductionNotes(); return; }
  openPreProJoinModal('notes');
}

// The board is a clip container — its children (threads) scroll, it never does.
// Browsers still scroll overflow:hidden ancestors on focus/scrollIntoView, which
// shoved the toolbar out of view; pin it so any such scroll self-heals.
let _pbBoardScrollPinned = false;
function pbPinBoardScroll() {
  if (_pbBoardScrollPinned) return;
  const board = document.getElementById('pbBoard');
  if (!board) return;
  _pbBoardScrollPinned = true;
  board.addEventListener('scroll', () => { if (board.scrollTop || board.scrollLeft) { board.scrollTop = 0; board.scrollLeft = 0; } });
}

function openProductionNotes() {
  activePaperworkItemId = 'production-notes';
  pbSetPresencePage('production-notes');   // direct entries (front page, toolbar bell) skip openPaperworkItem
  pbPinBoardScroll();
  hideModal('paperworkHubModal');
  pbEditingNoteId = null;
  pbReplyTargetId = null;
  pbPendingAttachments = [];
  pbReplyPendingAttachments = [];
  pbComposerTag = 'general';
  pbNotesFilterTag = 'all';
  pbNotesSearch = '';
  pbCloseFilterMenu();
  document.getElementById('pbBoard')?.classList.remove('composing');
  const search = document.getElementById('pbNotesSearch');
  if (search) search.value = '';
  pbRenderAttachTray('main');
  pbRenderComposerTags();
  pbRenderPortalChip();
  pbUpdateBellBtn();
  renderProductionNotesGuide();
  renderPaperworkNav('production-notes');
  showModal('productionNotesModal');
  restoreProductionNoteDraft();
  renderPlandaBearNotes();
  loadPlandaBearNotes().then(() => { renderPlandaBearNotes(); pbMarkNotesRead(); });
  pbMarkNotesRead();
}

/* ── Compose sheet (FAB-triggered, social-style) ── */
function pbOpenComposer() {
  const board = document.getElementById('pbBoard');
  if (!board) return;
  pbCloseFilterMenu();
  pbRenderComposerChecklist();
  board.classList.add('composing');
  const input = document.getElementById('pbNoteInput');
  if (input) {
    requestAnimationFrame(() => { pbAutosizeNoteInput(input); input.focus({ preventScroll: true }); });
  }
}

function pbCloseComposer() {
  document.getElementById('pbBoard')?.classList.remove('composing');
}

/* ── Attachments: images get compressed, documents are size-capped, and the
   payload is chunked into `pbfile_*` docs inside the sessions collection so
   the existing security rules cover them. ── */
function pbFileDocId(fileId, chunk=0) {
  const base = `pbfile_${session.code || 'local'}_${fileId}`;
  return chunk ? `${base}_c${chunk}` : base;
}

function pbLocalFileKey(fileId) {
  return `cueola_pb_file_${session.code || session.userName || 'local'}_${fileId}`;
}

function pbReadFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result || ''));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

async function pbCompressNoteImage(file) {
  const raw = await pbReadFileAsDataURL(file);
  const img = await new Promise((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = reject;
    i.src = raw;
  });
  // Small images keep their original format (preserves PNG transparency / GIFs).
  if (raw.length <= PB_FILE_CHUNK_CHARS && Math.max(img.width, img.height) <= PB_IMAGE_MAX_EDGE) {
    return { dataUrl: raw, w: img.width, h: img.height, type: file.type || 'image/jpeg' };
  }
  const canvas = document.createElement('canvas');
  let scale = Math.min(1, PB_IMAGE_MAX_EDGE / Math.max(img.width, img.height));
  let quality = 0.82;
  let out = raw;
  for (let attempt = 0; attempt < 6; attempt++) {
    canvas.width = Math.max(1, Math.round(img.width * scale));
    canvas.height = Math.max(1, Math.round(img.height * scale));
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    out = canvas.toDataURL('image/jpeg', quality);
    if (out.length <= PB_FILE_CHUNK_CHARS) break;
    if (quality > 0.5) quality -= 0.16; else scale *= 0.75;
  }
  return { dataUrl: out, w: canvas.width, h: canvas.height, type: 'image/jpeg' };
}

async function pbPrepareNoteAttachment(file) {
  const isImage = /^image\//i.test(file.type || '');
  if (!isImage && file.size > PB_FILE_MAX_BYTES) {
    toast(`"${file.name}" is over the 4 MB document limit.`);
    return null;
  }
  const fileId = `pbf_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,7)}`;
  if (isImage) {
    const img = await pbCompressNoteImage(file);
    return {
      fileId, name: file.name || 'image', type: img.type,
      size: Math.round(img.dataUrl.length * 0.75), isImage: true,
      w: img.w, h: img.h, dataUrl: img.dataUrl,
    };
  }
  const dataUrl = await pbReadFileAsDataURL(file);
  const isAudio = /^audio\//i.test(file.type || '') || /\.(mp3|wav|m4a|aac|ogg|opus|weba)$/i.test(file.name || '');
  return { fileId, name: file.name || 'file', type: file.type || '', size: file.size || 0, isImage: false, isAudio, w: 0, h: 0, dataUrl };
}

function pbAttachListFor(scope) {
  return scope === 'reply' ? pbReplyPendingAttachments : pbPendingAttachments;
}

async function pbHandleNoteFiles(input, scope='main') {
  const files = Array.from(input?.files || []);
  if (input) input.value = '';
  if (files.length) await pbStageNoteFiles(files, scope);
}

// Shared staging path for the file picker, paste, and drag & drop.
async function pbStageNoteFiles(files, scope='main') {
  const list = pbAttachListFor(scope);
  for (const file of files) {
    if (list.length >= PB_MAX_ATTACHMENTS) {
      toast(`Up to ${PB_MAX_ATTACHMENTS} attachments per ${scope === 'reply' ? 'reply' : 'note'}.`);
      break;
    }
    try {
      const att = await pbPrepareNoteAttachment(file);
      if (att) list.push(att);
    } catch {
      toast(`Couldn't read "${file.name}".`);
    }
  }
  pbRenderAttachTray(scope);
  document.getElementById(scope === 'reply' ? 'pbReplyInput' : 'pbNoteInput')?.focus();
}

function pbNotePaste(e, scope='main') {
  const files = Array.from(e.clipboardData?.files || []);
  if (!files.length) return;
  e.preventDefault();
  pbStageNoteFiles(files, scope);
}

function pbComposerDrag(e, over) {
  e.preventDefault();
  e.currentTarget?.classList?.toggle('dragover', over);
}

function pbComposerDrop(e) {
  e.preventDefault();
  e.currentTarget?.classList?.remove('dragover');
  const files = Array.from(e.dataTransfer?.files || []);
  if (files.length) pbStageNoteFiles(files, 'main');
}

function pbAttachChipsHTML(list, scope) {
  return list.map(a => `
    <div class="pb-attach-chip">
      ${a.isImage ? `<img src="${a.dataUrl}" alt="">` : `<span class="pb-file-ico">${sfIcon(a.isAudio ? 'department.audio' : pbFileSymbol(a))}</span>`}
      <span class="pb-attach-meta"><span class="pb-attach-name">${esc(a.name)}</span><span class="pb-attach-size">${esc(pbFileSize(a.size))}</span></span>
      <button type="button" class="pb-attach-x" onclick="pbRemovePendingAttachment('${a.fileId}','${scope}')" title="Remove attachment">×</button>
    </div>`).join('');
}

function pbRenderAttachTray(scope='main') {
  const tray = document.getElementById(scope === 'reply' ? 'pbReplyAttachTray' : 'pbAttachTray');
  if (!tray) return;
  const list = pbAttachListFor(scope);
  tray.hidden = !list.length;
  tray.innerHTML = pbAttachChipsHTML(list, scope);
}

function pbRemovePendingAttachment(fileId, scope='main') {
  if (scope === 'reply') pbReplyPendingAttachments = pbReplyPendingAttachments.filter(a => a.fileId !== fileId);
  else pbPendingAttachments = pbPendingAttachments.filter(a => a.fileId !== fileId);
  pbRenderAttachTray(scope);
}

async function pbSaveNoteFile(att) {
  pbNoteFileCache.set(att.fileId, att.dataUrl);
  if (window._firebaseReady && window._setDoc && session.code && !session.isDemo && !session.isExpert) {
    const chunks = [];
    for (let i = 0; i < att.dataUrl.length; i += PB_FILE_CHUNK_CHARS) chunks.push(att.dataUrl.slice(i, i + PB_FILE_CHUNK_CHARS));
    await window._setDoc(window._doc(window._db, 'sessions', pbFileDocId(att.fileId)), {
      kind: 'pbNoteFile', session: session.code, name: att.name, type: att.type,
      size: att.size, chunkCount: chunks.length, data: chunks[0] || '', at: Date.now(),
    });
    for (let i = 1; i < chunks.length; i++) {
      await window._setDoc(window._doc(window._db, 'sessions', pbFileDocId(att.fileId, i)), {
        kind: 'pbNoteFileChunk', session: session.code, data: chunks[i],
      });
    }
    return;
  }
  try { localStorage.setItem(pbLocalFileKey(att.fileId), att.dataUrl); }
  catch { toast('Attachment is too large to keep offline — it will only last this visit.'); }
}

async function pbLoadNoteFile(fileId) {
  if (!fileId) return '';
  if (pbNoteFileCache.has(fileId)) return pbNoteFileCache.get(fileId);
  try {
    const local = localStorage.getItem(pbLocalFileKey(fileId));
    if (local) { pbNoteFileCache.set(fileId, local); return local; }
  } catch {}
  if (!window._firebaseReady || !session.code || session.isDemo) return '';
  try {
    const snap = await window._getDoc(window._doc(window._db, 'sessions', pbFileDocId(fileId)));
    if (!snap.exists()) return '';
    const d = snap.data() || {};
    let dataUrl = d.data || '';
    for (let i = 1; i < (Number(d.chunkCount) || 1); i++) {
      const c = await window._getDoc(window._doc(window._db, 'sessions', pbFileDocId(fileId, i)));
      dataUrl += c.exists() ? (c.data().data || '') : '';
    }
    pbNoteFileCache.set(fileId, dataUrl);
    return dataUrl;
  } catch { return ''; }
}

function pbDeleteNoteFiles(note) {
  (note?.attachments || []).forEach(att => {
    pbNoteFileCache.delete(att.fileId);
    try { localStorage.removeItem(pbLocalFileKey(att.fileId)); } catch {}
    if (window._firebaseReady && window._deleteDoc && session.code && !session.isDemo && !session.isExpert) {
      // chunkCount may be unknown here — sweep the base doc plus possible chunks
      for (let i = 0; i < 8; i++) {
        window._deleteDoc(window._doc(window._db, 'sessions', pbFileDocId(att.fileId, i))).catch(()=>{});
      }
    }
  });
}

function pbFileSymbol(att) {
  const n = String(att?.name || '').toLowerCase();
  const t = String(att?.type || '').toLowerCase();
  if (att?.isImage || /^image\//.test(t)) return 'content.image';
  if (/\.(xls|xlsx|csv|numbers)$/.test(n) || t.includes('sheet') || t.includes('csv')) return 'content.list';
  return 'content.script';
}

function pbFileSize(bytes) {
  const b = Number(bytes) || 0;
  if (b >= 1024 * 1024) return (b / (1024 * 1024)).toFixed(1) + ' MB';
  if (b >= 1024) return Math.round(b / 1024) + ' KB';
  return b + ' B';
}

async function pbDownloadNoteFile(fileId) {
  let name = 'attachment';
  for (const n of plandaBearNotes) {
    const a = (n.attachments || []).find(x => x.fileId === fileId);
    if (a) { name = a.name || name; break; }
  }
  toast('Fetching attachment…');
  const dataUrl = await pbLoadNoteFile(fileId);
  if (!dataUrl) { toast('Could not load that attachment.'); return; }
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

async function pbOpenLightbox(fileId) {
  const dataUrl = await pbLoadNoteFile(fileId);
  if (!dataUrl) { toast('Image is still loading — try again in a second.'); return; }
  const box = document.getElementById('pbLightbox');
  const img = document.getElementById('pbLightboxImg');
  if (!box || !img) return;
  img.src = dataUrl;
  box.classList.add('on');
}

function pbCloseLightbox() {
  document.getElementById('pbLightbox')?.classList.remove('on');
}
// Esc closes the enlarged image (registered last → wins over modals underneath).
uiDismissRegister(() => document.getElementById('pbLightbox'), el => el.classList.remove('on'),
  { isOpen: el => el.classList.contains('on') });

/* ── Threading: group flat notes into root + replies. Reply chains flatten
   to one level under the root note; replies whose root was deleted are
   promoted to top-level so nothing ever disappears from the board. ── */
function pbRootIdOf(note, byId, depth=0) {
  if (!note.replyTo || depth > 6) return note.id;
  const parent = byId.get(note.replyTo);
  return parent ? pbRootIdOf(parent, byId, depth + 1) : note.id;
}

function pbBuildThreads() {
  const all = plandaBearNotes.slice().sort((a,b)=>(a.at||0)-(b.at||0));
  const byId = new Map(all.map(n => [n.id, n]));
  const threads = new Map(); // rootId -> { root, replies }
  for (const n of all) {
    const rootId = n.replyTo ? pbRootIdOf(n, byId) : n.id;
    if (rootId === n.id) {
      const t = threads.get(n.id);
      if (t) t.root = n; else threads.set(n.id, { root:n, replies:[] });
    } else {
      let t = threads.get(rootId);
      if (!t) { t = { root: byId.get(rootId), replies: [] }; threads.set(rootId, t); }
      t.replies.push(n);
    }
  }
  const out = [];
  for (const t of threads.values()) {
    if (!t.root) { t.replies.forEach(r => out.push({ root:r, replies:[] })); continue; }
    out.push(t);
  }
  out.forEach(t => { t.lastAt = Math.max(t.root.at || 0, ...t.replies.map(r => r.at || 0)); });
  return out;
}

function pbThreadMatches(t) {
  if (pbNotesFilterTag !== 'all') {
    if (pbNotesFilterTag === 'todo') {
      if (t.root.tag !== 'todo' && !t.replies.some(r => r.tag === 'todo')) return false;
    } else if (t.root.tag !== pbNotesFilterTag) return false;
  }
  const q = pbNotesSearch.trim().toLowerCase();
  if (!q) return true;
  return [t.root.text, t.root.by, ...t.replies.flatMap(r => [r.text, r.by])]
    .join(' ').toLowerCase().includes(q);
}

/* ── Toolbar: search, tag filter, sort ── */
function pbSetNotesFilter(tag) {
  pbNotesFilterTag = tag;
  pbCloseFilterMenu();
  renderPlandaBearNotes();
}

function pbSetNotesSearch(v) {
  pbNotesSearch = v || '';
  renderPlandaBearNotes();
}

function pbClearNotesFilters() {
  pbNotesFilterTag = 'all';
  pbNotesSearch = '';
  const search = document.getElementById('pbNotesSearch');
  if (search) search.value = '';
  renderPlandaBearNotes();
}

function pbToggleNotesSort() {
  pbNotesNewestFirst = !pbNotesNewestFirst;
  const btn = document.getElementById('pbNotesSortBtn');
  if (btn) btn.textContent = pbNotesNewestFirst ? '↓ Newest' : '↑ Oldest';
  renderPlandaBearNotes();
}

function pbToggleFilterMenu(e) {
  e?.stopPropagation?.();
  const pop = document.getElementById('pbNotesFilters');
  if (!pop) return;
  const open = pop.hidden;
  pop.hidden = !open;
  document.getElementById('pbFilterBtn')?.classList.toggle('on', open);
  if (open) {
    // close on the next outside click
    setTimeout(() => document.addEventListener('click', pbFilterOutside, { once:true }), 0);
  }
}

function pbFilterOutside(e) {
  if (e.target.closest?.('.pb-filter-wrap')) {
    document.addEventListener('click', pbFilterOutside, { once:true });
    return;
  }
  pbCloseFilterMenu();
}

function pbCloseFilterMenu() {
  const pop = document.getElementById('pbNotesFilters');
  if (pop) pop.hidden = true;
  document.getElementById('pbFilterBtn')?.classList.remove('on');
}

function pbRenderNoteFilters(threads) {
  const counts = { all: threads.length };
  for (const t of threads) counts[t.root.tag] = (counts[t.root.tag] || 0) + 1;

  // Popover list
  const pop = document.getElementById('pbNotesFilters');
  if (pop) {
    const row = (key, label) =>
      `<button type="button" class="pb-filter-chip t-${key}${pbNotesFilterTag === key ? ' on' : ''}" onclick="pbSetNotesFilter('${key}')">
        <span class="pb-filter-dot"></span>${label}${counts[key] ? ` <b>${counts[key]}</b>` : ''}
      </button>`;
    pop.innerHTML = row('all', 'All notes')
      + Object.entries(PB_NOTE_TAGS).map(([k, v]) => row(k, `${sfIcon(v.symbol)} ${v.label}`)).join('');
  }

  // Filter button reflects the active filter
  const btn = document.getElementById('pbFilterBtn');
  if (btn) {
    const active = pbNotesFilterTag !== 'all';
    btn.classList.toggle('active', active);
    btn.innerHTML = `${sfIcon('action.filter')}<span>${active ? (PB_NOTE_TAGS[pbNotesFilterTag] || {}).label || 'Filter' : 'Filter'}</span>`;
  }

  // Active-filter banner
  const banner = document.getElementById('pbActiveFilter');
  if (banner) {
    const hasFilter = pbNotesFilterTag !== 'all';
    const hasSearch = pbNotesSearch.trim().length > 0;
    if (!hasFilter && !hasSearch) {
      banner.hidden = true;
    } else {
      banner.hidden = false;
      const tag = PB_NOTE_TAGS[pbNotesFilterTag];
      banner.className = `pb-active-filter t-${hasFilter ? pbNotesFilterTag : 'general'}`;
      const parts = [];
      if (hasFilter) parts.push(`Showing <b>${tag ? sfIcon(tag.symbol) + ' ' + tag.label : 'tagged'}</b>`);
      if (hasSearch) parts.push(`matching <b>"${esc(pbNotesSearch.trim())}"</b>`);
      banner.innerHTML = `<span>${parts.join(' ')}</span><button type="button" class="pb-active-clear" onclick="pbClearNotesFilters()">Clear</button>`;
    }
  }
}

/* ── Composer tag picker ── */
let pbComposerAssignee = '';   // who a new To-Do is assigned to
let pbComposerChecklist = [];  // [{id,text,done:false}] checklist items staged for a new post
let pbChecklistOpen = false;   // is the composer's checklist builder revealed

// Names we can assign a To-Do to: everyone present + everyone on the roster.
function pbAssigneeOptions() {
  const names = new Set();
  try { getActivePresencePeople().forEach(p => p?.name && names.add(p.name.trim())); } catch {}
  (sessionParticipantNames || []).forEach(n => n && names.add(String(n).trim()));
  const me = (session.userName || '').trim();
  if (me) names.add(me);
  return Array.from(names).filter(Boolean);
}

/* ── @mentions ──────────────────────────────────────────────────────────────
   Type "@" in a note or reply → an autocomplete of everyone who has entered the
   session. Picking one inserts @Name; on post it's stored in the note's
   `mentions` and the mentioned person gets a notification and a badge. ── */
const _escRe = s => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Everyone who has entered this session (present + roster + me) — the mention pool.
function pbMentionNames() { return pbAssigneeOptions(); }

// Which known names are @-mentioned in this text (longest-first so "Sam Lee" wins over "Sam").
function pbExtractMentions(text) {
  const t = String(text || '');
  const found = [];
  for (const name of pbMentionNames().sort((a, b) => b.length - a.length)) {
    const re = new RegExp('(^|[^\\w@])@' + _escRe(name) + '(?![\\w])', 'i');
    if (re.test(t)) found.push(name);
  }
  return Array.from(new Set(found));
}

// Wrap @Name tokens (known session names) in a highlight chip. Runs on already-
// escaped HTML, matching the same-escaped name, longest-first to avoid partials.
function pbApplyMentionChips(html) {
  const names = pbMentionNames().sort((a, b) => b.length - a.length);
  const me = (session.userName || '').trim().toLowerCase();
  for (const name of names) {
    const e = esc(name);
    const re = new RegExp('@' + _escRe(e) + '(?![\\w])', 'g');
    const mineCls = name.trim().toLowerCase() === me ? ' me' : '';
    html = html.replace(re, `<span class="pb-mention${mineCls}">@${e}</span>`);
  }
  return html;
}

// ── autocomplete popover, shared by the main composer + reply inputs ──
let _pbMention = null;   // { el, field, start, query, items, sel }

function pbMentionMenuEl() {
  let el = document.getElementById('pbMentionMenu');
  if (!el) {
    el = document.createElement('div');
    el.id = 'pbMentionMenu';
    el.className = 'pb-mention-menu';
    el.hidden = true;
    document.body.appendChild(el);
  }
  return el;
}

function pbMentionClose() {
  _pbMention = null;
  const el = document.getElementById('pbMentionMenu');
  if (el) { el.hidden = true; el.innerHTML = ''; }
}

// Detect an "@query" token immediately before the caret and open/refresh the menu.
function pbMentionOnInput(el, field) {
  if (!el) return;
  const caret = el.selectionStart;
  const before = el.value.slice(0, caret);
  const m = before.match(/(^|\s)@([^\s@]{0,40})$/);
  if (!m) { pbMentionClose(); return; }
  const query = m[2];
  const start = caret - query.length - 1;   // index of '@'
  const q = query.toLowerCase();
  const items = pbMentionNames()
    .filter(n => !q || n.toLowerCase().includes(q))
    .sort((a, b) => {
      const as = a.toLowerCase().startsWith(q) ? 0 : 1, bs = b.toLowerCase().startsWith(q) ? 0 : 1;
      return as - bs || a.localeCompare(b);
    })
    .slice(0, 6);
  if (!items.length) { pbMentionClose(); return; }
  _pbMention = { el, field, start, query, items, sel: 0 };
  pbMentionRender();
}

function pbMentionRender() {
  if (!_pbMention) return;
  const menu = pbMentionMenuEl();
  menu.innerHTML = _pbMention.items.map((n, i) =>
    `<button type="button" class="pb-mention-item${i === _pbMention.sel ? ' sel' : ''}" data-i="${i}" onmousedown="event.preventDefault();pbMentionPick(${i})">
      <span class="pb-mention-av">${esc(pbInitials(n))}</span><span class="pb-mention-name">${esc(n)}</span>
    </button>`).join('');
  menu.hidden = false;
  // Position just below the textarea, left-aligned to it.
  const r = _pbMention.el.getBoundingClientRect();
  menu.style.left = Math.round(r.left) + 'px';
  menu.style.top = Math.round(Math.min(r.bottom + 4, window.innerHeight - 12)) + 'px';
  menu.style.minWidth = Math.round(Math.min(r.width, 280)) + 'px';
}

function pbMentionPick(i) {
  if (!_pbMention) return;
  const { el, start, query } = _pbMention;
  const name = _pbMention.items[i];
  if (name == null) return;
  const caret = start + 1 + query.length;
  const insert = '@' + name + ' ';
  el.value = el.value.slice(0, start) + insert + el.value.slice(caret);
  const pos = start + insert.length;
  el.focus();
  el.setSelectionRange(pos, pos);
  pbMentionClose();
  pbAutosizeNoteInput(el);
  if (el.id === 'pbNoteInput') saveProductionNoteDraft();
}

// Called first from the textareas' keydown; returns true if it consumed the key.
function pbMentionKeydown(e) {
  if (!_pbMention) return false;
  if (e.key === 'ArrowDown') { e.preventDefault(); _pbMention.sel = (_pbMention.sel + 1) % _pbMention.items.length; pbMentionRender(); return true; }
  if (e.key === 'ArrowUp') { e.preventDefault(); _pbMention.sel = (_pbMention.sel - 1 + _pbMention.items.length) % _pbMention.items.length; pbMentionRender(); return true; }
  if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); pbMentionPick(_pbMention.sel); return true; }
  if (e.key === 'Escape') { e.preventDefault(); pbMentionClose(); return true; }
  return false;
}

function pbRenderComposerTags() {
  const slot = document.getElementById('pbTagPicker');
  if (!slot) return;
  const chips = Object.entries(PB_NOTE_TAGS).map(([k, v]) =>
    `<button type="button" class="pb-tag-chip t-${k}${pbComposerTag === k ? ' on' : ''}" onclick="pbSelectComposerTag('${k}')" title="${k === 'todo' ? 'Post as an action item with a checkbox' : `Tag this note ${v.label}`}">${sfIcon(v.symbol)} ${v.label}</button>`).join('');
  const assign = pbComposerTag === 'todo'
    ? `<label class="pb-assign-pick" title="Assign this to-do to someone in the session">Assign:
        <select onchange="pbSetComposerAssignee(this.value)">
          <option value="">Anyone</option>
          ${pbAssigneeOptions().map(n => `<option value="${esc(n)}"${pbComposerAssignee === n ? ' selected' : ''}>${esc(n)}</option>`).join('')}
        </select>
      </label>`
    : '';
  slot.innerHTML = chips + assign;
}

function pbSetComposerAssignee(v) {
  pbComposerAssignee = v || '';
}

function pbSelectComposerTag(tag) {
  pbComposerTag = PB_NOTE_TAGS[tag] ? tag : 'general';
  if (pbComposerTag !== 'todo') pbComposerAssignee = '';
  // Picking To-Do reveals the multi-item checklist builder with a first row ready.
  if (pbComposerTag === 'todo' && !pbChecklistOpen && !pbComposerChecklist.length) {
    pbChecklistOpen = true;
    pbComposerChecklist.push({ id: pbNewChecklistId(), text: '', done: false });
  }
  pbRenderComposerTags();
  pbRenderComposerChecklist();
}

/* ── Composer checklist builder (multiple to-do items in one post) ── */
function pbRenderComposerChecklist() {
  const slot = document.getElementById('pbChecklistBuilder');
  if (!slot) return;
  if (!pbChecklistOpen && !pbComposerChecklist.length) {
    slot.innerHTML = `<button type="button" class="pb-checklist-add-toggle" onclick="pbToggleChecklistBuilder()">${sfIcon('content.checklist')} Add a checklist</button>`;
    return;
  }
  const rows = pbComposerChecklist.map((it, i) => `
    <div class="pb-cl-row">
      <span class="pb-cl-box" aria-hidden="true"></span>
      <input class="pb-cl-input" type="text" value="${esc(it.text)}" placeholder="To-do item ${i + 1}" oninput="pbChecklistEdit(${i}, this.value)" onkeydown="pbChecklistKeydown(event, ${i})" aria-label="Checklist item ${i + 1}">
      <button type="button" class="pb-cl-del" onclick="pbChecklistRemove(${i})" title="Remove item" aria-label="Remove item">${sfIcon('action.close')}</button>
    </div>`).join('');
  slot.innerHTML = `
    <div class="pb-checklist-head"><span>${sfIcon('content.checklist')} Checklist</span><span class="pb-cl-count">${pbComposerChecklist.length} item${pbComposerChecklist.length === 1 ? '' : 's'}</span></div>
    <div class="pb-cl-rows">${rows}</div>
    <button type="button" class="pb-cl-add" onclick="pbChecklistAdd()">${sfIcon('action.add')} Add item</button>`;
}

function pbToggleChecklistBuilder() {
  pbChecklistOpen = !pbChecklistOpen;
  if (pbChecklistOpen && !pbComposerChecklist.length) pbComposerChecklist.push({ id: pbNewChecklistId(), text: '', done: false });
  pbRenderComposerChecklist();
  if (pbChecklistOpen) setTimeout(() => document.querySelector('.pb-cl-input')?.focus({ preventScroll: true }), 0);
}

function pbNewChecklistId() { return `ci_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`; }
function pbChecklistAdd() { pbComposerChecklist.push({ id: pbNewChecklistId(), text: '', done: false }); pbRenderComposerChecklist(); setTimeout(() => { const rows = document.querySelectorAll('.pb-cl-input'); rows[rows.length - 1]?.focus({ preventScroll: true }); }, 0); }
function pbChecklistEdit(i, val) { if (pbComposerChecklist[i]) pbComposerChecklist[i].text = val; }
function pbChecklistRemove(i) { pbComposerChecklist.splice(i, 1); if (!pbComposerChecklist.length) pbChecklistOpen = false; pbRenderComposerChecklist(); }
function pbChecklistKeydown(e, i) {
  if (e.key === 'Enter') { e.preventDefault(); if ((pbComposerChecklist[i]?.text || '').trim()) pbChecklistAdd(); }
  else if (e.key === 'Backspace' && !pbComposerChecklist[i]?.text && pbComposerChecklist.length > 1) { e.preventDefault(); pbChecklistRemove(i); setTimeout(() => { const rows = document.querySelectorAll('.pb-cl-input'); rows[Math.max(0, i - 1)]?.focus({ preventScroll: true }); }, 0); }
}
function pbResetComposerChecklist() { pbComposerChecklist = []; pbChecklistOpen = false; pbRenderComposerChecklist(); }

/* ── Replies: an inline composer inside the thread card ── */
function pbOpenReply(id) {
  const t = pbBuildThreads().find(t => t.root.id === id || t.replies.some(r => r.id === id));
  pbReplyTargetId = t ? t.root.id : id;
  pbReplyPendingAttachments = [];
  renderPlandaBearNotes();
  const input = document.getElementById('pbReplyInput');
  if (input) {
    input.focus();
    input.closest('.pb-thread')?.scrollIntoView({ behavior:'smooth', block:'nearest' });
  }
}

function pbCancelReply() {
  pbReplyTargetId = null;
  pbReplyPendingAttachments = [];
  renderPlandaBearNotes();
}

function pbReplyKeydown(e, rootId) {
  if (pbMentionKeydown(e)) return;   // mention autocomplete owns keys while open
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); pbPostReply(rootId); }
  else if (e.key === 'Escape') pbCancelReply();
}

async function pbPostReply(rootId) {
  const input = document.getElementById('pbReplyInput');
  const text = input?.value.trim() || '';
  const atts = pbReplyPendingAttachments.slice();
  if (!text && !atts.length) { input?.focus(); return; }
  if (atts.length) toast(`Uploading ${atts.length === 1 ? 'attachment' : 'attachments'}…`);
  for (const a of atts) await pbSaveNoteFile(a);
  await loadPlandaBearNotes();
  const reply = normalizePlandaBearNote({
    text, by: preProActor(), role: pbNoteActorRole(),
    at: Date.now(), clientId: CLIENT_ID, replyTo: rootId,
    avatar: pbMyAvatar(),
    mentions: pbExtractMentions(text),
    attachments: atts.map(({ fileId, name, type, size, isImage, w, h }) => ({ fileId, name, type, size, isImage, w, h })),
  });
  pbReplyTargetId = null;
  pbReplyPendingAttachments = [];
  await writePlandaBearNotes([...plandaBearNotes, reply], 'Production Note Reply');
  renderPlandaBearNotes();
}

/* ── Likes ── */
function pbHasLiked(note) {
  return Array.isArray(note?.likes) && note.likes.includes(CLIENT_ID);
}

async function pbToggleLike(id) {
  // optimistic flip so the heart responds instantly
  const local = plandaBearNotes.find(n => n.id === id);
  if (local) {
    local.likes = pbHasLiked(local) ? local.likes.filter(c => c !== CLIENT_ID) : [...local.likes, CLIENT_ID];
    renderPlandaBearNotes();
  }
  await loadPlandaBearNotes();
  const note = plandaBearNotes.find(n => n.id === id);
  if (!note) return;
  const liked = pbHasLiked(note);
  const next = plandaBearNotes.map(n => n.id === id
    ? { ...n, likes: liked ? n.likes.filter(c => c !== CLIENT_ID) : [...n.likes, CLIENT_ID] }
    : n);
  await writePlandaBearNotes(next, null); // likes don't need their own activity entry
  renderPlandaBearNotes();
}

/* ── Pinning (instructors) ── */
async function pbTogglePin(id) {
  if (!pbIsInstructor()) { toast('Only instructors can pin notes.'); return; }
  await loadPlandaBearNotes();
  const note = plandaBearNotes.find(n => n.id === id);
  if (!note) return;
  const next = plandaBearNotes.map(n => n.id === id ? { ...n, pinned: !n.pinned } : n);
  await writePlandaBearNotes(next, note.pinned ? 'Note Unpinned' : 'Note Pinned');
  renderPlandaBearNotes();
}

/* ── Edit your own note inline ── */
function pbStartEditNote(id) {
  const note = plandaBearNotes.find(n => n.id === id);
  if (!note) return;
  if (!(note.clientId && note.clientId === CLIENT_ID)) { toast('You can only edit your own notes.'); return; }
  pbEditingNoteId = id;
  renderPlandaBearNotes();
  const ta = document.getElementById('pbEditInput');
  if (ta) {
    ta.focus();
    ta.setSelectionRange(ta.value.length, ta.value.length);
  }
}

function pbCancelEditNote() {
  pbEditingNoteId = null;
  renderPlandaBearNotes();
}

function pbEditInputKeydown(e, id) {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); pbSaveEditNote(id); }
  else if (e.key === 'Escape') { pbCancelEditNote(); }
}

async function pbSaveEditNote(id) {
  const ta = document.getElementById('pbEditInput');
  const text = ta?.value.trim() || '';
  await loadPlandaBearNotes();
  const original = plandaBearNotes.find(n => n.id === id);
  if (!original) { pbCancelEditNote(); return; }
  if (!text && !(original.attachments || []).length) { toast('A note needs some text — or delete it instead.'); return; }
  const next = plandaBearNotes.map(n => n.id === id
    ? { ...n, text, editedAt: text !== original.text ? Date.now() : n.editedAt }
    : n);
  pbEditingNoteId = null;
  await writePlandaBearNotes(next, 'Production Note Edited');
  renderPlandaBearNotes();
}

/* ── Publish ── */
async function publishPlandaBearNote() {
  const input = document.getElementById('pbNoteInput');
  const text = input?.value.trim() || '';
  const atts = pbPendingAttachments.slice();
  const hasChecklist = pbComposerChecklist.some(it => (it.text || '').trim());
  if (!text && !atts.length && !hasChecklist) { input?.focus(); toast('Type a note, add a checklist, or attach a file first.'); return; }
  const sendBtn = document.getElementById('pbNoteSendBtn');
  if (sendBtn) sendBtn.disabled = true;
  try {
    if (atts.length) toast(`Uploading ${atts.length === 1 ? 'attachment' : 'attachments'}…`);
    for (const a of atts) await pbSaveNoteFile(a);
    await loadPlandaBearNotes();
    const note = normalizePlandaBearNote({
      text,
      by: preProActor(),
      role: pbNoteActorRole(),
      tag: pbComposerTag,
      assignee: pbComposerTag === 'todo' ? pbComposerAssignee : '',
      at: Date.now(),
      clientId: CLIENT_ID,
      avatar: pbMyAvatar(),
      mentions: pbExtractMentions(text),
      checklist: pbComposerChecklist.slice(),
      attachments: atts.map(({ fileId, name, type, size, isImage, w, h }) => ({ fileId, name, type, size, isImage, w, h })),
    });
    await writePlandaBearNotes([...plandaBearNotes, note], pbComposerTag === 'todo' ? 'To-Do Posted' : 'Production Note');
    if (input) { input.value = ''; pbAutosizeNoteInput(input); }
    pbPendingAttachments = [];
    pbRenderAttachTray('main');
    pbComposerTag = 'general';
    pbComposerAssignee = '';
    pbResetComposerChecklist();
    pbRenderComposerTags();
    try { localStorage.removeItem(productionNoteDraftKey()); } catch {}
    pbCloseComposer();
    renderPlandaBearNotes();
  } catch (err) {
    // Upload or write failed — keep the composer contents so nothing is lost, but say so.
    console.warn('[plandabear] note publish failed', err);
    toast('⚠ Could not post the note — check your connection and try again.');
  } finally {
    if (sendBtn) sendBtn.disabled = false;
  }
}

async function toggleProductionNotesTodo(id) {
  await loadPlandaBearNotes();
  const note = plandaBearNotes.find(n => n.id === id);
  if (!note) return;
  if (!pbCanManageNote(note)) { toast('Only instructors or the author can check off this to-do.'); return; }
  const next = plandaBearNotes.map(n => {
    if (n.id !== id) return n;
    const done = !n.done;
    // Record who completed it and when (accountability), cleared if reopened.
    return { ...n, done, doneBy: done ? preProActor() : '', doneAt: done ? Date.now() : 0 };
  });
  await writePlandaBearNotes(next, 'To-Do Updated');
  renderPlandaBearNotes();
}

async function deletePlandaBearNote(id) {
  await loadPlandaBearNotes();
  const note = plandaBearNotes.find(n => n.id === id);
  if (!note) return;
  if (!pbCanManageNote(note)) { toast('You can only remove your own notes.'); return; }
  // Deleting a root note takes its replies with it; deleting a reply is just the reply.
  const thread = pbBuildThreads().find(t => t.root.id === id);
  const ids = new Set([id, ...(thread ? thread.replies.map(r => r.id) : [])]);
  const extra = ids.size - 1;
  const msg = extra
    ? `Delete this note and its ${extra} repl${extra === 1 ? 'y' : 'ies'} for everyone on the session?`
    : 'Delete this note for everyone on the session?';
  if (!dangerConfirm(msg, 'Any attached note files tied to the deleted note are removed too. This syncs to collaborators.', { requireText:'DELETE' })) return;
  plandaBearNotes.filter(n => ids.has(n.id)).forEach(pbDeleteNoteFiles);
  if (pbReplyTargetId && ids.has(pbReplyTargetId)) pbReplyTargetId = null;
  if (pbEditingNoteId && ids.has(pbEditingNoteId)) pbEditingNoteId = null;
  await writePlandaBearNotes(plandaBearNotes.filter(n => !ids.has(n.id)), 'Production Note Removed');
  toast('Note removed.');
  renderPlandaBearNotes();
}

/* ── Rendering the board ── */
function pbAttachmentHTML(att) {
  if (att.isImage) {
    return `<div class="pb-msg-img" data-pb-img="${att.fileId}" onclick="pbOpenLightbox('${att.fileId}')" title="Click to enlarge"><div class="pb-img-loading">Loading image…</div></div>`;
  }
  if (att.isAudio) {
    const argName = JSON.stringify(att.name || 'audio').replace(/"/g, '&quot;');
    return `<div class="pb-msg-audio" data-pb-audio="${att.fileId}">
      <div class="pb-audio-head"><span class="pb-file-ico">${sfIcon('department.audio')}</span><span class="pb-file-name">${esc(att.name)}</span>
        <button type="button" class="pb-audio-og" onclick="pbSendAudioToOutrangutan('${att.fileId}',${argName})" title="Download & send to the Outrangutan SFX board">${sfIcon('action.forward')} SFX</button>
        <button type="button" class="pb-audio-dl" onclick="pbDownloadNoteFile('${att.fileId}')" title="Download">${sfIcon('action.download')}</button></div>
      <div class="pb-audio-slot"><div class="pb-audio-loading">Loading audio…</div></div>
    </div>`;
  }
  return `<button type="button" class="pb-file-chip" onclick="pbDownloadNoteFile('${att.fileId}')" title="Download this file">
    <span class="pb-file-ico">${sfIcon(pbFileSymbol(att))}</span>
    <span class="pb-file-meta"><span class="pb-file-name">${esc(att.name)}</span><span class="pb-file-size">${esc(pbFileSize(att.size))}</span></span>
    <span class="pb-file-dl">${sfIcon('action.download')}</span>
  </button>`;
}

function pbDataURLtoBlob(dataUrl) {
  const [head, b64] = String(dataUrl || '').split(',');
  const mime = (head.match(/data:([^;]+)/) || [])[1] || 'application/octet-stream';
  const bin = atob(b64 || '');
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime });
}

// Send a note's audio to Outrangutan's SFX board. Per the safe hand-off design:
// download a local copy to the device first, then — if Outrangutan is already
// open in this tab — drop it straight onto the SFX board as a pad. Writing into
// Outrangutan's saved show while it's closed would risk clobbering it, so when
// it's not open we stop at the download and tell the operator how to import it.
async function pbSendAudioToOutrangutan(fileId, name) {
  const fname = name || 'audio';
  let dataUrl;
  try { dataUrl = await pbLoadNoteFile(fileId); } catch { dataUrl = null; }
  if (!dataUrl || !/^data:audio\//i.test(dataUrl)) { toast('That audio isn’t ready yet — try again in a moment.'); return; }
  let blob;
  try { blob = pbDataURLtoBlob(dataUrl); } catch { toast('Could not read that audio file.'); return; }
  // 1) Always download a local copy — the safe, universal hand-off path.
  try {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = fname; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  } catch {}
  // 2) If Outrangutan is open right here, also add it as a pad immediately.
  const OG = window.Outrangutan;
  if (OG && typeof OG.isReady === 'function' && OG.isReady() && typeof OG.addAudioPad === 'function') {
    try {
      const file = new File([blob], fname, { type: blob.type || 'audio/mpeg' });
      const res = await OG.addAudioPad(file);
      if (res && res.ok) { toast(`Downloaded “${fname}” and added it to Outrangutan’s SFX board.`); return; }
    } catch {}
  }
  toast(`Downloaded “${fname}”. Open Outrangutan → SFX Board and add it to a pad.`);
}

// Audio attachments hydrate into a native <audio> player once their payload loads.
function pbHydrateNoteAudio(scope) {
  const slots = Array.from((scope || document).querySelectorAll('[data-pb-audio]'));
  slots.forEach(el => {
    if (el._pbAudioLoaded) return;
    el._pbAudioLoaded = true;
    const fileId = el.getAttribute('data-pb-audio');
    pbLoadNoteFile(fileId).then(dataUrl => {
      if (!el.isConnected) return;
      const slot = el.querySelector('.pb-audio-slot');
      if (!slot) return;
      if (!dataUrl || !/^data:audio\//i.test(dataUrl)) { slot.innerHTML = `<div class="pb-img-missing">${sfIcon('state.warning')} Audio unavailable</div>`; return; }
      const audio = document.createElement('audio');
      audio.controls = true; audio.preload = 'metadata'; audio.src = dataUrl; audio.className = 'pb-audio-el';
      slot.innerHTML = '';
      slot.appendChild(audio);
    });
  });
}

function pbTodoCheckHTML(note) {
  if (pbCanManageNote(note)) {
    return `<button type="button" class="pb-todo-check${note.done ? ' done' : ''}" onclick="toggleProductionNotesTodo('${note.id}')" title="${note.done ? 'Reopen this to-do' : 'Mark this to-do done'}">${note.done ? '✓' : ''}</button>`;
  }
  return `<span class="pb-todo-check static${note.done ? ' done' : ''}">${note.done ? '✓' : ''}</span>`;
}

function pbEditBoxHTML(note) {
  return `<div class="pb-editbox">
    <textarea id="pbEditInput" rows="2" onkeydown="pbEditInputKeydown(event,'${note.id}')">${esc(note.text)}</textarea>
    <div class="pb-editbtns">
      <button type="button" class="pb-mini-btn save" onclick="pbSaveEditNote('${note.id}')">Save changes</button>
      <button type="button" class="pb-mini-btn" onclick="pbCancelEditNote()">Cancel</button>
      <span class="pb-edit-hint">Enter to save · Esc to cancel</span>
    </div>
  </div>`;
}

function pbNoteHeadHTML(note) {
  const tag = PB_NOTE_TAGS[note.tag] || PB_NOTE_TAGS.general;
  const tagChip = note.tag !== 'general'
    ? `<span class="pb-note-tag t-${note.tag}${note.tag === 'todo' && note.done ? ' done' : ''}">${sfIcon(tag.symbol)} ${tag.label}${note.tag === 'todo' && note.done ? ' · Done' : ''}</span>`
    : '';
  // To-Do ownership chip: who it's assigned to, or who completed it.
  const assignChip = note.tag === 'todo'
    ? (note.done
        ? `<span class="pb-note-assign done" title="Completed">✓ ${esc(note.doneBy || 'Done')}${note.doneAt ? ` · ${esc(pbAgo(note.doneAt))}` : ''}</span>`
        : (note.assignee ? `<span class="pb-note-assign" title="Assigned to">→ ${esc(note.assignee)}</span>` : ''))
    : '';
  return `<header class="pb-note-head">
    <span class="pb-note-avatar" style="background:${pbAvatarBg(note)}">${pbAvatarInner(note)}</span>
    <div class="pb-note-who">
      <div class="pb-note-byline">
        <span class="pb-note-author">${esc(note.by)}</span>
        ${note.role === 'instructor' ? '<span class="pb-note-role">Instructor</span>' : ''}
        ${tagChip}
        ${assignChip}
      </div>
      <span class="pb-note-time">${esc(pbNoteTime(note.at))}${note.editedAt ? ' · edited' : ''}</span>
    </div>
  </header>`;
}

// Multi-item checklist inside a post: each item is individually checkable, with a
// progress bar. Anyone who can manage the note (author or instructor) can tick items.
function pbChecklistHTML(note) {
  const items = note.checklist || [];
  if (!items.length) return '';
  const done = items.filter(it => it.done).length;
  const canManage = pbCanManageNote(note);
  const pct = Math.round((done / items.length) * 100);
  const rows = items.map(it => {
    const box = canManage
      ? `<button type="button" class="pb-clitem-check${it.done ? ' done' : ''}" onclick="pbToggleChecklistItem('${note.id}','${it.id}')" title="${it.done ? 'Reopen' : 'Mark done'}" aria-pressed="${it.done}">${it.done ? '✓' : ''}</button>`
      : `<span class="pb-clitem-check static${it.done ? ' done' : ''}">${it.done ? '✓' : ''}</span>`;
    const meta = it.done && it.doneBy ? `<span class="pb-clitem-by">${esc(it.doneBy)}</span>` : '';
    return `<li class="pb-clitem${it.done ? ' done' : ''}">${box}<span class="pb-clitem-text">${esc(it.text)}</span>${meta}</li>`;
  }).join('');
  return `<div class="pb-checklist${done === items.length ? ' complete' : ''}">
    <div class="pb-checklist-bar"><div class="pb-checklist-fill" style="width:${pct}%"></div></div>
    <div class="pb-checklist-count">${done}/${items.length} done</div>
    <ul class="pb-checklist-items">${rows}</ul>
  </div>`;
}

function pbNoteBodyHTML(note) {
  if (note.id === pbEditingNoteId) return `<div class="pb-note-body">${pbEditBoxHTML(note)}</div>`;
  const check = note.tag === 'todo' ? pbTodoCheckHTML(note) : '';
  const text = note.text ? `<div class="pb-note-text">${pbRenderRichText(note.text)}</div>` : '';
  const checklist = pbChecklistHTML(note);
  const atts = (note.attachments || []).length
    ? `<div class="pb-note-attachments">${note.attachments.map(pbAttachmentHTML).join('')}</div>`
    : '';
  return `<div class="pb-note-body">${check}<div class="pb-note-main">${text}${checklist}${atts}</div></div>`;
}

async function pbToggleChecklistItem(noteId, itemId) {
  await loadPlandaBearNotes();
  const note = plandaBearNotes.find(n => n.id === noteId);
  if (!note) return;
  if (!pbCanManageNote(note)) { toast('Only instructors or the author can check off items.'); return; }
  const next = plandaBearNotes.map(n => {
    if (n.id !== noteId) return n;
    return { ...n, checklist: (n.checklist || []).map(it => it.id === itemId
      ? { ...it, done: !it.done, doneBy: !it.done ? preProActor() : '', doneAt: !it.done ? Date.now() : 0 }
      : it) };
  });
  await writePlandaBearNotes(next, 'Checklist Updated');
  renderPlandaBearNotes();
}

function pbLikeButtonHTML(note) {
  const liked = pbHasLiked(note);
  const n = (note.likes || []).length;
  return `<button type="button" class="pb-like${liked ? ' liked' : ''}" onclick="pbToggleLike('${note.id}')" title="${liked ? 'Remove your like' : 'Like this note'}" aria-pressed="${liked}">
    <span class="pb-like-ico">${sfIcon('state.favorite')}</span>${n ? `<span class="pb-like-count">${n}</span>` : ''}
  </button>`;
}

function pbNoteFootHTML(note, replyCount) {
  const mine = note.clientId && note.clientId === CLIENT_ID;
  return `<footer class="pb-note-foot">
    ${pbLikeButtonHTML(note)}
    <button type="button" class="pb-note-act" onclick="pbOpenReply('${note.id}')">${sfIcon('content.note')} Reply${replyCount ? ` (${replyCount})` : ''}</button>
    ${mine ? `<button type="button" class="pb-note-act" onclick="pbStartEditNote('${note.id}')">${sfIcon('action.edit')} Edit</button>` : ''}
    ${pbIsInstructor() ? `<button type="button" class="pb-note-act" onclick="pbTogglePin('${note.id}')">${sfIcon('action.pin')} ${note.pinned ? 'Unpin' : 'Pin'}</button>` : ''}
    <button type="button" class="pb-note-act export-action" onclick="exportProductionNoteById('${note.id}')">${sfIcon('action.export')} PDF</button>
    ${pbCanManageNote(note) ? `<button type="button" class="pb-note-act danger" onclick="deletePlandaBearNote('${note.id}')">${sfIcon('action.delete')} Delete</button>` : ''}
  </footer>`;
}

function pbReplyHTML(reply) {
  const mine = reply.clientId && reply.clientId === CLIENT_ID;
  const avatar = `<span class="pb-reply-avatar" style="background:${pbAvatarBg(reply)}">${pbAvatarInner(reply)}</span>`;
  if (reply.id === pbEditingNoteId) {
    return `<div class="pb-reply" data-note-id="${reply.id}">${avatar}${pbEditBoxHTML(reply)}</div>`;
  }
  const check = reply.tag === 'todo' ? pbTodoCheckHTML(reply) : '';
  const text = reply.text ? `<div class="pb-note-text">${pbRenderRichText(reply.text)}</div>` : '';
  const atts = (reply.attachments || []).length
    ? `<div class="pb-note-attachments">${reply.attachments.map(pbAttachmentHTML).join('')}</div>`
    : '';
  const liked = pbHasLiked(reply);
  const likeN = (reply.likes || []).length;
  return `<div class="pb-reply${reply.tag === 'todo' && reply.done ? ' done' : ''}" data-note-id="${reply.id}">
    ${avatar}
    <div class="pb-reply-main">
      <div class="pb-reply-head">
        <span class="pb-reply-author">${esc(reply.by)}</span>
        ${reply.role === 'instructor' ? '<span class="pb-note-role">Instructor</span>' : ''}
        <span class="pb-note-time">${esc(pbNoteTime(reply.at))}${reply.editedAt ? ' · edited' : ''}</span>
      </div>
      <div class="pb-reply-body">${check}<div class="pb-note-main">${text}${atts}</div></div>
    </div>
    <div class="pb-reply-acts">
      <button type="button" class="pb-reply-like${liked ? ' liked' : ''}" onclick="pbToggleLike('${reply.id}')" title="${liked ? 'Remove your like' : 'Like'}" aria-pressed="${liked}">${sfIcon('state.favorite')}${likeN ? ` ${likeN}` : ''}</button>
      ${mine ? `<button type="button" onclick="pbStartEditNote('${reply.id}')" title="Edit your reply" aria-label="Edit your reply">${sfIcon('action.edit')}</button>` : ''}
      ${pbCanManageNote(reply) ? `<button type="button" class="danger" onclick="deletePlandaBearNote('${reply.id}')" title="Delete reply" aria-label="Delete reply">${sfIcon('action.delete')}</button>` : ''}
    </div>
  </div>`;
}

function pbReplyComposerHTML(root) {
  if (pbReplyTargetId !== root.id) return '';
  return `<div class="pb-reply-compose">
    <div class="pb-attach-tray" id="pbReplyAttachTray" hidden></div>
    <div class="pb-reply-compose-row">
      <textarea id="pbReplyInput" rows="1" placeholder="Reply to ${esc(root.by)}… — @ to mention" oninput="pbAutosizeNoteInput(this);pbMentionOnInput(this,'reply')" onkeydown="pbReplyKeydown(event,'${root.id}')" onblur="setTimeout(pbMentionClose,120)" onpaste="pbNotePaste(event,'reply')"></textarea>
      <button type="button" class="pb-reply-attach" onclick="document.getElementById('pbReplyFileInput').click()" title="Attach to reply" aria-label="Attach to reply">${sfIcon('action.attach')}</button>
      <input type="file" id="pbReplyFileInput" hidden multiple accept="image/*,audio/*,.pdf,.doc,.docx,.txt,.md,.csv,.rtf,.pages,.key,.numbers,.xls,.xlsx,.ppt,.pptx" onchange="pbHandleNoteFiles(this,'reply')">
      <button type="button" class="pb-post-btn small" onclick="pbPostReply('${root.id}')"><span>Reply</span>${sfIcon('action.forward')}</button>
      <button type="button" class="pb-note-act" onclick="pbCancelReply()">Cancel</button>
    </div>
  </div>`;
}

// One-line gist of a note for the collapsed state: first line of text, else a file/photo hint.
function pbNoteSummary(note) {
  const firstLine = String(note.text || '').split('\n').map(s => s.trim()).find(Boolean) || '';
  const plain = pbStripMarkdown(firstLine).replace(/\s+/g, ' ').trim();
  if (plain) return plain.length > 120 ? plain.slice(0, 118) + '…' : plain;
  const cl = note.checklist || [];
  if (cl.length) return `Checklist · ${cl.filter(i => i.done).length}/${cl.length} done`;
  const atts = note.attachments || [];
  if (atts.length) { const img = atts.filter(a => a.isImage).length; return img ? `${img} photo${img === 1 ? '' : 's'}` : `${atts.length} file${atts.length === 1 ? '' : 's'}`; }
  return 'Empty note';
}

function pbThreadHTML(t) {
  const root = t.root;
  const collapsed = pbCollapsed.has(root.id);
  const repliesOpen = t.replies.length || pbReplyTargetId === root.id;
  const classes = ['pb-thread'];
  if (root.pinned) classes.push('pinned');
  if (root.tag === 'todo' && root.done) classes.push('done');
  if (collapsed) classes.push('collapsed');
  const replyCount = t.replies.length;
  const collapseBtn = `<button type="button" class="pb-collapse-btn" onclick="pbToggleCollapse('${root.id}')" title="Collapse note" aria-expanded="true" aria-label="Collapse note">${sfIcon('action.expand')}</button>`;
  if (collapsed) {
    return `<article class="${classes.join(' ')}" data-note-id="${root.id}">
      ${root.pinned ? `<div class="pb-pin-flag">${sfIcon('action.pin')} Pinned</div>` : ''}
      <button type="button" class="pb-collapsed-row" onclick="pbToggleCollapse('${root.id}')" aria-label="Expand note">
        <span class="pb-note-avatar sm" style="background:${pbAvatarBg(root)}">${pbAvatarInner(root)}</span>
        <span class="pb-collapsed-author">${esc(root.by)}</span>
        ${root.tag !== 'general' ? `<span class="pb-note-tag t-${root.tag}${root.tag === 'todo' && root.done ? ' done' : ''}">${sfIcon((PB_NOTE_TAGS[root.tag] || PB_NOTE_TAGS.general).symbol)}</span>` : ''}
        <span class="pb-collapsed-gist">${esc(pbNoteSummary(root))}</span>
        ${replyCount ? `<span class="pb-collapsed-replies">${sfIcon('content.note')} ${replyCount}</span>` : ''}
        <span class="pb-collapse-chev">${sfIcon('action.collapse')}</span>
      </button>
    </article>`;
  }
  return `<article class="${classes.join(' ')}" data-note-id="${root.id}">
    ${root.pinned ? `<div class="pb-pin-flag">${sfIcon('action.pin')} Pinned</div>` : ''}
    ${collapseBtn}
    ${pbNoteHeadHTML(root)}
    ${pbNoteBodyHTML(root)}
    ${pbNoteFootHTML(root, t.replies.length)}
    ${repliesOpen ? `<div class="pb-replies">${t.replies.map(pbReplyHTML).join('')}${pbReplyComposerHTML(root)}</div>` : ''}
  </article>`;
}

function pbToggleCollapse(id) {
  if (pbCollapsed.has(id)) pbCollapsed.delete(id); else pbCollapsed.add(id);
  renderPlandaBearNotes();
}

function renderPlandaBearNotes(slotId='pbNotesThread') {
  const slot = document.getElementById(slotId);
  if (!slot) return;

  // Live updates re-render the board — keep any in-progress reply text alive.
  const replyInput = document.getElementById('pbReplyInput');
  const replyDraft = replyInput ? replyInput.value : '';
  const replyHadFocus = replyInput && document.activeElement === replyInput;
  const scrollTop = slot.scrollTop;

  const threads = pbBuildThreads();
  const total = plandaBearNotes.length;
  const openTodos = plandaBearNotes.filter(n => n.tag === 'todo' && !n.done).length;
  const count = document.getElementById('pbNotesCount');
  if (count) count.textContent = `${total} note${total===1?'':'s'}${openTodos ? ` · ${openTodos} open to-do${openTodos===1?'':'s'}` : ''}`;
  pbRenderNoteFilters(threads);

  if (!total) {
    slot.innerHTML = `<div class="pb-note-empty"><span class="pb-note-empty-ico">${sfIcon('content.note')}</span><b>No notes yet</b><span>Start the board — post a note, a photo, or a file. Everyone in this session sees it live.</span></div>`;
    annotatePlandaBearNoteCards();
    return;
  }

  const visible = threads.filter(pbThreadMatches);
  visible.sort((a, b) =>
    (b.root.pinned ? 1 : 0) - (a.root.pinned ? 1 : 0)
    || (pbNotesNewestFirst ? b.lastAt - a.lastAt : a.lastAt - b.lastAt));

  if (!visible.length) {
    slot.innerHTML = `<div class="pb-note-empty"><span class="pb-note-empty-ico">🔍</span><b>No matching notes</b><span>Nothing matches that search or tag.</span><button type="button" class="pb-chat-tool" onclick="pbClearNotesFilters()">Clear filters</button></div>`;
    annotatePlandaBearNoteCards();
    return;
  }

  slot.innerHTML = visible.map(pbThreadHTML).join('');
  slot.scrollTop = scrollTop;

  const restored = document.getElementById('pbReplyInput');
  if (restored) {
    if (replyDraft) {
      restored.value = replyDraft;
      pbAutosizeNoteInput(restored);
      if (replyHadFocus) {
        restored.focus();
        restored.setSelectionRange(replyDraft.length, replyDraft.length);
      }
    }
    pbRenderAttachTray('reply');
  }

  pbHydrateNoteImages(slot);
  pbHydrateNoteAudio(slot);
  annotatePlandaBearNoteCards();
  pbApplyPendingFlash();
}

// Image attachments render as placeholders, then fill in as the (cached)
// payload docs arrive — keeps the board snappy on first paint.
function pbHydrateNoteImages(scope) {
  const slots = Array.from((scope || document).querySelectorAll('[data-pb-img]'));
  slots.forEach(el => {
    const fileId = el.getAttribute('data-pb-img');
    pbLoadNoteFile(fileId).then(dataUrl => {
      if (!el.isConnected) return;
      if (!dataUrl) { el.innerHTML = `<div class="pb-img-missing">${sfIcon('state.warning')} Image unavailable</div>`; return; }
      const img = document.createElement('img');
      img.alt = 'Attached image';
      img.src = dataUrl;
      el.innerHTML = '';
      el.appendChild(img);
    });
  });
}

function annotatePlandaBearNoteCards() {
  // The hub's Production Notes count lives in the wide bar above the numbered grid.
  const countEl = document.getElementById('paperworkNotesBarCount');
  if (!countEl) return;
  const total = plandaBearNotes.length;
  const openTodos = plandaBearNotes.filter(n => n.tag === 'todo' && !n.done).length;
  countEl.textContent = total
    ? `${total} note${total===1?'':'s'}${openTodos ? ` · ${openTodos} open to-do${openTodos===1?'':'s'}` : ''}`
    : '';
}

/* ── Notifications ─────────────────────────────────────────────────────
   When a teammate posts a note or replies (live, via the session snapshot),
   give a heads-up even if the notes board is closed: an unread badge on the
   🐼 Planda Bear button, an in-app clickable toast, and — if the user opts in
   — a browser notification that fires while this tab is backgrounded.
   Notes you wrote yourself never notify you. ── */
let pbNotifySeeded = false;          // first snapshot only seeds known ids (no toast for history)
const pbKnownNoteIds = new Set();    // note ids already processed for notifications
let pbNotifySessionCode = null;      // reseed on session switch — B's history must not toast after leaving A
let notifPanelSince = 0;             // lastRead captured when the panel was opened (keeps unread highlight stable)
let pbPendingFlashId = null;         // note to scroll-to + flash on the next board render
let pbFlashClearT = null;            // clears the pending flash once it has settled

function pbLastReadKey() { return `cueola_pb_lastread_${session.code || session.userName || 'local'}`; }
function pbGetLastRead() { try { return Number(localStorage.getItem(pbLastReadKey())) || 0; } catch { return 0; } }
function pbSetLastRead(ts) { try { localStorage.setItem(pbLastReadKey(), String(ts)); } catch {} }

function pbIsMine(n) { return Boolean(n && n.clientId && n.clientId === CLIENT_ID); }
function pbNotesBoardOpen() { return Boolean(document.getElementById('productionNotesModal')?.classList.contains('on')); }

function pbUnreadNoteCount() {
  const since = pbGetLastRead();
  return plandaBearNotes.filter(n => (n.at || 0) > since && !pbIsMine(n)).length;
}

function pbNotificationSymbol(unread, muted=false) {
  if (muted) return unread ? 'notification.unread-muted' : 'notification.muted';
  return unread ? 'notification.unread' : 'notification.default';
}

function pbUpdatePlandaBearBadge() {
  // Keep the message center available on the front page, including its empty state.
  const center = document.getElementById('notifCenter');
  if (center) center.hidden = false;
  const badge = document.getElementById('notifUnread');
  if (!badge) return;
  const n = pbNotesBoardOpen() ? 0 : pbUnreadNoteCount();
  const symbol = document.querySelector('#notifBellBtn .sf-symbol');
  if (symbol) symbol.dataset.symbol = pbNotificationSymbol(n > 0);
  if (n > 0) { badge.textContent = n > 99 ? '99+' : String(n); badge.hidden = false; }
  else { badge.hidden = true; }
  pbUpdateBellBtn();
}

function pbMarkNotesRead() {
  pbSetLastRead(Date.now());
  pbUpdatePlandaBearBadge();
}

/* ── Notification center (bell dropdown / message inbox) ── */
function notifItems() {
  return plandaBearNotes
    .filter(n => !pbIsMine(n))
    .slice()
    .sort((a, b) => (b.at || 0) - (a.at || 0))
    .slice(0, 30);
}

function renderNotifCenter(unreadSince) {
  const list = document.getElementById('notifList');
  if (!list) return;
  const since = unreadSince == null ? pbGetLastRead() : unreadSince;
  const items = notifItems();
  if (!items.length) {
    list.innerHTML = `<div class="notif-empty">No messages yet.<br>When a teammate posts or replies in Production Notes, it shows up here.</div>`;
    return;
  }
  list.innerHTML = items.map(n => {
    const unread = (n.at || 0) > since;
    const repliesToMine = n.replyTo && plandaBearNotes.some(p => p.id === n.replyTo && pbIsMine(p));
    const tag = PB_NOTE_TAGS[n.tag];
    const action = repliesToMine ? 'replied to your note'
      : n.replyTo ? 'replied'
      : (tag && n.tag !== 'general' ? `posted a ${tag.label} note` : 'posted');
    const snippet = esc(pbStripMarkdown(n.text || '').replace(/\s+/g, ' ').trim().slice(0, 90))
      || ((n.attachments || []).length ? 'Attachment' : '');
    return `<button type="button" class="notif-item${unread ? ' unread' : ''}" onclick="openNoteFromNotif('${n.id}')">
      <span class="notif-avatar" style="background:${pbAvatarColor(n)}">${esc(pbInitials(n.by))}</span>
      <span class="notif-body">
        <span class="notif-line"><b>${esc(n.by)}</b> ${action}</span>
        ${snippet ? `<span class="notif-snip">${snippet}</span>` : ''}
        <span class="notif-time">${pbAgo(n.at)}</span>
      </span>
      ${unread ? '<span class="notif-dot"></span>' : ''}
    </button>`;
  }).join('');
}

function positionNotifPanel() {
  const panel = document.getElementById('notifPanel');
  const bell = document.getElementById('notifBellBtn');
  if (!panel || !bell || panel.hidden) return;
  const gutter = 10;
  const r = bell.getBoundingClientRect();
  const anchor = panel.offsetParent || document.body;
  const base = anchor.getBoundingClientRect();
  const panelW = Math.min(360, Math.max(280, window.innerWidth - (gutter * 2)));
  panel.style.width = `${panelW}px`;
  panel.style.right = 'auto';
  panel.style.bottom = 'auto';
  const left = Math.max(gutter, Math.min(window.innerWidth - panelW - gutter, r.left + (r.width / 2) - (panelW / 2)));
  const top = Math.round(r.bottom + 10);
  panel.style.left = `${Math.round(left - base.left)}px`;
  panel.style.top = `${Math.round(top - base.top)}px`;
  panel.style.maxHeight = `${Math.max(180, window.innerHeight - top - gutter)}px`;
}

function toggleNotifCenter(e) {
  e?.stopPropagation?.();
  const panel = document.getElementById('notifPanel');
  if (!panel) return;
  if (panel.hidden) {
    notifPanelSince = pbGetLastRead();      // freeze the unread cutoff while the panel is open
    renderNotifCenter(notifPanelSince);     // highlight what was unread before this open
    panel.hidden = false;
    positionNotifPanel();
    window.addEventListener('resize', positionNotifPanel);
    window.addEventListener('scroll', positionNotifPanel, true);
    document.getElementById('notifBellBtn')?.classList.add('on');
    pbMarkNotesRead();                       // clears the badge (panel keeps its highlight)
    // dismissal handled by the shared uiDismissRegister utility (P6)
  } else {
    closeNotifCenter();
  }
}

function closeNotifCenter() {
  const panel = document.getElementById('notifPanel');
  if (panel) panel.hidden = true;
  window.removeEventListener('resize', positionNotifPanel);
  window.removeEventListener('scroll', positionNotifPanel, true);
  document.getElementById('notifBellBtn')?.classList.remove('on');
}

function markAllNotifsRead() {
  pbMarkNotesRead();
  notifPanelSince = Date.now();   // a live update re-renders with this cutoff — keep "read" items read
  renderNotifCenter(notifPanelSince);
}

function openNoteFromNotif(id) {
  closeNotifCenter();
  pbPendingFlashId = id;        // applied by renderPlandaBearNotes once the board paints
  openProductionNotes();
}

// Highlight + scroll to a note after the board renders (survives the async
// load → re-render, since it runs at the end of every render until consumed).
function pbApplyPendingFlash() {
  if (!pbPendingFlashId) return;
  const id = pbPendingFlashId;
  const t = pbBuildThreads().find(t => t.root.id === id || t.replies.some(r => r.id === id));
  const rootId = t ? t.root.id : id;
  const el = document.querySelector(`#pbNotesThread .pb-thread[data-note-id="${rootId}"]`);
  if (!el) return;             // not painted yet — a later render will catch it
  requestAnimationFrame(() => {
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.classList.remove('pb-thread-flash');
    void el.offsetWidth;
    el.classList.add('pb-thread-flash');
  });
  // Keep the pending id alive briefly so an async re-render re-applies the flash
  // to the freshly rebuilt element instead of dropping it.
  clearTimeout(pbFlashClearT);
  pbFlashClearT = setTimeout(() => { pbPendingFlashId = null; }, 1900);
}

// Does this note @-mention me?
function pbMentionsMe(note) {
  const me = (session.userName || '').trim().toLowerCase();
  if (!me) return false;
  return (note.mentions || []).some(n => String(n).trim().toLowerCase() === me);
}

function pbNoteNotifyText(note) {
  const who = note.by || 'Someone';
  const snippet = pbStripMarkdown(note.text || '').replace(/\s+/g, ' ').trim().slice(0, 80);
  const tail = snippet ? `: “${snippet}”` : '';
  if (pbMentionsMe(note)) return `${who} mentioned you${tail}`;
  const repliesToMine = note.replyTo && plandaBearNotes.some(p => p.id === note.replyTo && pbIsMine(p));
  if (repliesToMine) return `${who} replied to your note${tail}`;
  if (note.replyTo) return `${who} replied in Production Notes${tail}`;
  const tag = PB_NOTE_TAGS[note.tag];
  const kind = tag && note.tag !== 'general' ? ` a ${tag.label} note` : '';
  return `${who} posted${kind}${tail}`;
}

function pbFireNoteNotifications(fresh) {
  if (!fresh.length || pbNotesBoardOpen()) return;
  // A direct @mention or a reply to my note leads the notification — it's the most personal.
  const mentionsMe = fresh.find(pbMentionsMe);
  const replyToYou = fresh.find(n => n.replyTo && plandaBearNotes.some(p => p.id === n.replyTo && pbIsMine(p)));
  const lead = mentionsMe || replyToYou || fresh[fresh.length - 1];
  const extra = fresh.length - 1;
  const msg = extra > 0 ? `${pbNoteNotifyText(lead)}  ·  +${extra} more` : pbNoteNotifyText(lead);
  pbShowNotifyToast(msg);
  if (pbBrowserNotifyEnabled() && document.hidden) {
    try {
      const note = new Notification('Planda Bear · Production Notes', {
        body: msg,
        tag: 'cueola-pb-notes',
      });
      note.onclick = () => { window.focus(); pbOpenFromNotify(); note.close(); };
    } catch {}
  }
}

function pbShowNotifyToast(msg) {
  const el = document.getElementById('pbNotifyToast');
  if (!el) { toast(msg, 6000); return; }
  const text = el.querySelector('.pb-notify-text') || el;
  text.textContent = msg;
  el.hidden = false;
  requestAnimationFrame(() => el.classList.add('on'));
  clearTimeout(el._t);
  el._t = setTimeout(pbDismissNotifyToast, 7000);
}

function pbDismissNotifyToast() {
  const el = document.getElementById('pbNotifyToast');
  if (!el) return;
  clearTimeout(el._t);
  el.classList.remove('on');
  setTimeout(() => { el.hidden = true; }, 250);
}

function pbOpenFromNotify() {
  pbDismissNotifyToast();
  openProductionNotes();
}

/* ── Browser-notification opt-in (bell toggle in the board toolbar) ── */
function pbBrowserNotifyEnabled() {
  try {
    return localStorage.getItem('cueola_pb_browser_notify') === '1'
      && 'Notification' in window && Notification.permission === 'granted';
  } catch { return false; }
}

function pbUpdateBellBtn() {
  const btn = document.getElementById('pbBellBtn');
  if (!btn) return;
  const on = pbBrowserNotifyEnabled();
  const unread = !pbNotesBoardOpen() && pbUnreadNoteCount() > 0;
  btn.classList.toggle('on', on);
  btn.setAttribute('aria-pressed', String(on));
  setSymbolButtonLabel(btn, pbNotificationSymbol(unread, !on), on ? 'Alerts on' : 'Alerts off');
  btn.title = on
    ? 'Browser notifications are on — click to turn off'
    : 'Get a browser notification when teammates post (works while this tab is open in the background)';
}

function pbToggleBrowserNotify() {
  if (!('Notification' in window)) { toast('This browser does not support notifications.'); return; }
  const enabled = (() => { try { return localStorage.getItem('cueola_pb_browser_notify') === '1'; } catch { return false; } })();
  const set = (v) => { try { localStorage.setItem('cueola_pb_browser_notify', v ? '1' : '0'); } catch {} };
  if (enabled) {
    set(false);
    toast('Browser alerts off. You will still see in-app alerts and the badge.');
    pbUpdateBellBtn();
    return;
  }
  if (Notification.permission === 'granted') {
    set(true); toast('Browser alerts on.'); pbUpdateBellBtn();
  } else if (Notification.permission !== 'denied') {
    Notification.requestPermission().then(p => {
      if (p === 'granted') { set(true); toast('Browser alerts on.'); }
      else toast('Notifications blocked — you will still see in-app alerts.');
      pbUpdateBellBtn();
    });
  } else {
    toast('Notifications are blocked in your browser settings for this site.');
  }
}

// Live board: when the session doc pushes new notes, surface notifications and
// (if the board is open) refresh it — skipped while a note is being edited;
// in-progress reply text is preserved by renderPlandaBearNotes.
function onRemoteProductionNotes(raw) {
  if (!Array.isArray(raw)) return;
  if (pbNotifySessionCode !== (session?.code || null)) {
    pbNotifySessionCode = session?.code || null;
    pbNotifySeeded = false;
    pbKnownNoteIds.clear();
  }
  plandaBearNotes = raw.map(normalizePlandaBearNote).filter(pbNoteHasContent);
  saveLocalPlandaBearNotes(plandaBearNotes);
  annotatePlandaBearNoteCards();

  if (!pbNotifySeeded) {
    plandaBearNotes.forEach(n => pbKnownNoteIds.add(n.id));
    pbNotifySeeded = true;
  } else {
    const fresh = plandaBearNotes.filter(n => !pbKnownNoteIds.has(n.id) && !pbIsMine(n));
    plandaBearNotes.forEach(n => pbKnownNoteIds.add(n.id));
    if (fresh.length) pbFireNoteNotifications(fresh);
  }
  if (pbNotesBoardOpen()) pbMarkNotesRead(); else pbUpdatePlandaBearBadge();
  const panel = document.getElementById('notifPanel');
  if (panel && !panel.hidden) renderNotifCenter(notifPanelSince);

  if (pbEditingNoteId) return;
  if (pbNotesBoardOpen()) renderPlandaBearNotes();
}

/* ── Note-taking guide / suggestions ── */
const PRODUCTION_NOTE_GUIDES = [
  ['Lead with the moment', 'Start with the row, cue, or timecode the note is about so anyone scanning the board finds it fast.'],
  ['One note, one idea', 'Keep each note to a single change, problem, or decision. Post separate notes instead of one long wall.'],
  ['Tag the department', 'Pick Audio, Video, or Lighting so the right crew can filter straight to their notes.'],
  ['Use To-Do for actions', 'Tag action items as a To-Do — they get a checkbox and stay counted until someone checks them off.'],
  ['Reply under the note', 'Answers, fixes, and follow-ups belong as replies, so the whole story stays in one thread.'],
  ['Like to acknowledge', 'Tap the heart to say "got it" or "agreed" without adding a reply that clutters the thread.'],
  ['Attach the evidence', 'Use Attach — or just paste/drop a screenshot — to share the patch photo or document you mean.'],
  ['Pin what matters', 'Instructors can pin a note so it holds the top of the board until it is unpinned.'],
];

function renderProductionNotesGuide() {
  const slot = document.getElementById('pbNotesGuideBody');
  if (!slot) return;
  slot.innerHTML = PRODUCTION_NOTE_GUIDES.map(([t,d]) =>
    `<div class="pb-note-guide-row"><span class="pb-note-guide-t">${esc(t)}</span><span class="pb-note-guide-d">${esc(d)}</span></div>`
  ).join('');
}

function toggleProductionNotesGuide() {
  const guide = document.getElementById('pbNotesGuide');
  if (!guide) return;
  guide.classList.toggle('open');
  document.getElementById('pbNotesGuideBtn')?.classList.toggle('on', guide.classList.contains('open'));
}

/* ── PDF: single note for submission, and the full thread ── */
function pbAttachmentsPaperHTML(note) {
  const atts = note?.attachments || [];
  if (!atts.length) return '';
  return atts.map(a => {
    if (a.isImage) {
      // synced payloads are attacker-writable: only a real data:image URL may enter the markup
      const raw = pbNoteFileCache.get(a.fileId) || '';
      const dataUrl = /^data:image\//i.test(raw) ? esc(raw) : '';
      return dataUrl
        ? `<div style="margin-top:10px"><img src="${dataUrl}" style="max-width:420px;max-height:320px;border:1px solid #ccc;border-radius:6px"><div style="font-size:10px;color:#777;margin-top:3px">${esc(a.name)}</div></div>`
        : `<div style="font-size:11px;color:#777;margin-top:6px">📷 Image attachment: ${esc(a.name)}</div>`;
    }
    return `<div style="font-size:11px;color:#777;margin-top:6px">Attached document: ${esc(a.name)} (${esc(pbFileSize(a.size))})</div>`;
  }).join('');
}

function pbTagLabel(note) {
  if (note.tag === 'todo') return note.done ? 'To-Do ✓' : 'To-Do';
  return (PB_NOTE_TAGS[note.tag] || PB_NOTE_TAGS.general).label;
}

function productionNoteDocHTML(note) {
  // Pull in the thread's replies so an exported note carries its whole conversation.
  const thread = pbBuildThreads().find(t => t.root.id === note.id);
  const replies = thread ? thread.replies : [];
  const likeLine = (note.likes || []).length ? `<tr><th>Likes</th><td>${(note.likes || []).length}</td></tr>` : '';
  const repliesHTML = replies.length ? `
    <h2 style="margin-top:18px">Replies (${replies.length})</h2>
    ${replies.map(r => `
      <div style="margin-top:10px;padding-left:14px;border-left:3px solid #ddd">
        <div style="font-size:11px;color:#555"><b>${esc(r.by)}</b>${r.role === 'instructor' ? ' (Instructor)' : ''} · ${esc(new Date(r.at || Date.now()).toLocaleString())}</div>
        ${r.text ? `<div class="paper-note-body" style="margin-top:6px">${pbRenderRichText(r.text)}</div>` : ''}
        ${pbAttachmentsPaperHTML(r)}
      </div>`).join('')}
  ` : '';
  return `
    <h1>Production Note</h1>
    <div>${esc(show.name || 'Cueola')} · Production Notes</div>
    <table><tbody>
      <tr><th>Tag</th><td>${esc(pbTagLabel(note))}${note.pinned ? ' · Pinned' : ''}</td></tr>
      <tr><th>Author</th><td>${esc(note.by || preProActor())}</td></tr>
      <tr><th>Time</th><td>${esc(new Date(note.at || Date.now()).toLocaleString())}</td></tr>
      ${likeLine}
    </tbody></table>
    ${note.text ? `<div class="paper-note-body">${pbRenderRichText(note.text)}</div>` : ''}
    ${pbAttachmentsPaperHTML(note)}
    ${repliesHTML}
  `;
}

function productionNotesThreadHTML() {
  const threads = pbBuildThreads().sort((a,b)=>(a.root.at||0)-(b.root.at||0));
  const attHTML = (n) => (n.attachments || []).map(a => {
    if (a.isImage) {
      const dataUrl = pbNoteFileCache.get(a.fileId) || '';
      return dataUrl
        ? `<div style="margin-top:6px"><img src="${dataUrl}" style="max-width:240px;max-height:180px;border:1px solid #ccc;border-radius:4px"></div>`
        : `<div class="cue-muted">📷 Image: ${esc(a.name)}</div>`;
    }
    return `<div class="cue-muted">Document: ${esc(a.name)} (${esc(pbFileSize(a.size))})</div>`;
  }).join('');
  const row = (n, isReply) => `<tr>
    <td>${esc(n.at ? new Date(n.at).toLocaleString() : '')}</td>
    <td>${esc(n.by)}${n.role === 'instructor' ? '<br><span class="cue-muted">Instructor</span>' : ''}</td>
    <td>${esc(pbTagLabel(n))}${n.pinned ? ' 📌' : ''}</td>
    <td>${isReply ? '<div style="padding-left:16px;border-left:3px solid #ddd"><span class="cue-muted">↩ reply</span><br>' : ''}${pbRenderRichText(n.text)}${n.editedAt ? ' <span class="cue-muted">(edited)</span>' : ''}${attHTML(n)}${isReply ? '</div>' : ''}</td>
  </tr>`;
  const rows = threads.flatMap(t => [row(t.root, false), ...t.replies.map(r => row(r, true))]).join('');
  return `
    <h1>7. Production Notes</h1>
    <div>${esc(show.name || 'Cueola')} · Shared discussion board</div>
    <table><thead><tr><th>Time</th><th>By</th><th>Tag</th><th>Note</th></tr></thead>
    <tbody>${rows || '<tr><td colspan="4">No production notes yet.</td></tr>'}</tbody></table>
  `;
}

// Pull image attachment payloads into the cache so PDF/preview can embed them.
async function pbPrefetchNoteImages() {
  const imgs = plandaBearNotes.flatMap(n => (n.attachments || []).filter(a => a.isImage));
  for (const a of imgs) {
    try { await pbLoadNoteFile(a.fileId); } catch {}
  }
}

async function exportProductionNoteById(id) {
  const note = plandaBearNotes.find(n => n.id === id);
  if (!note) return;
  try {
    toast('Building note PDF...');
    const thread = pbBuildThreads().find(t => t.root.id === id);
    const imgNotes = [note, ...(thread ? thread.replies : [])];
    for (const n of imgNotes) for (const a of (n.attachments || []).filter(x => x.isImage)) await pbLoadNoteFile(a.fileId);
    const stamp = new Date(note.at || Date.now()).toISOString().slice(0,10);
    await exportPaperHTMLAsPDF(productionNoteDocHTML(note), `cueola-production-note-${stamp}.pdf`);
    toast('Note PDF downloaded.');
  } catch (e) {
    toast('PDF export needs an internet connection. Use the browser print dialog instead.');
    window.print();
  }
}

function showProductionNotesPreview() {
  activePaperworkItemId = 'production-notes';
  loadPlandaBearNotes().then(pbPrefetchNoteImages).then(() => {
    showPaperPreview('Production Notes Preview', productionNotesThreadHTML(), 'Export Notes Log PDF', 'exportProductionNotesPDF()', 'production-notes');
  });
}

async function exportProductionNotesPDF() {
  try {
    toast('Building notes log PDF...');
    await loadPlandaBearNotes();
    await pbPrefetchNoteImages();
    const stamp = new Date().toISOString().slice(0,10);
    await exportPaperHTMLAsPDF(productionNotesThreadHTML(), `cueola-production-notes-${stamp}.pdf`);
    toast('Notes log PDF downloaded.');
  } catch (e) {
    toast('PDF export needs an internet connection. Use the browser print dialog instead.');
    window.print();
  }
}

/* ══════════════════════════════════════════════════════════════════════
   BUILD-SIDE PRODUCTION NOTES PANEL
   Brings Planda Bear notes into the rundown build view as a reference
   panel. Notes can be sent to a row's notes field, set as a script cue,
   or used to create a new row — without leaving the build screen.
   ══════════════════════════════════════════════════════════════════════ */

function togglePnPanel() {
  pnPanelOpen = !pnPanelOpen;
  const panel = document.getElementById('pnPanel');
  const btn   = document.getElementById('pnPanelBtn');
  if (panel) panel.classList.toggle('open', pnPanelOpen);
  if (btn)   btn.classList.toggle('active', pnPanelOpen);
  if (pnPanelOpen) loadPlandaBearNotes().then(renderPnPanel);
}

function renderPnPanel() {
  const panel = document.getElementById('pnPanel');
  if (!panel || !pnPanelOpen) return;

  const topLevel = plandaBearNotes.filter(n => !n.replyTo);
  const filtered = pnFilterTag === 'all' ? topLevel : topLevel.filter(n => n.tag === pnFilterTag);
  const total    = topLevel.length;

  const rowOpts = beats.map((b, i) =>
    `<option value="${b.id}"${pnTargetBeatId === b.id ? ' selected' : ''}>${i + 1}. ${esc(b.info || 'Untitled')}</option>`
  ).join('');
  const targetControl = beats.length
    ? `<select class="pn-target-select" onchange="pnSetTarget(this.value)" aria-label="Target row">
        <option value=""${!pnTargetBeatId ? ' selected' : ''}>— Pick a row —</option>
        ${rowOpts}
       </select>`
    : `<span class="pn-no-rows">Add a row first</span>`;

  const TAG_KEYS = ['all', 'general', 'audio', 'video', 'lighting', 'todo'];
  const chips = TAG_KEYS.map(t => {
    const label = t === 'all' ? 'All' : (PB_NOTE_TAGS[t]?.label || t);
    const sym   = t !== 'all' ? sfIcon(PB_NOTE_TAGS[t]?.symbol || 'content.note') : '';
    return `<button type="button" class="pn-tag-chip${pnFilterTag === t ? ' active' : ''}" onclick="pnSetFilter('${t}')">${sym}${label}</button>`;
  }).join('');

  const cards = filtered.length
    ? filtered.map(n => pnNoteCardHTML(n)).join('')
    : `<div class="pn-empty">${sfIcon('content.note')}<span>No notes${pnFilterTag !== 'all' ? ' tagged ' + pnFilterTag : ''}</span></div>`;

  panel.innerHTML = `
    <div class="pn-head">
      <div class="pn-head-row">
        <span class="pn-head-title">${sfIcon('content.note')} Notes</span>
        ${total ? `<span class="pn-count">${total}</span>` : ''}
        <button type="button" class="pn-close" onclick="togglePnPanel()" aria-label="Close notes panel" title="Close">${sfIcon('action.close')}</button>
      </div>
      <div class="pn-target-row">
        <span class="pn-target-label">Row</span>
        ${targetControl}
      </div>
      <div class="pn-tag-chips">${chips}</div>
    </div>
    <div class="pn-scroll" id="pnScroll">${cards}</div>
  `;
}

function pnNoteCardHTML(note) {
  const tag     = PB_NOTE_TAGS[note.tag] || PB_NOTE_TAGS.general;
  const preview = note.text ? note.text.slice(0, 180) + (note.text.length > 180 ? '…' : '') : '';
  const hasText = Boolean(note.text);
  const atts    = (note.attachments || []).length;
  const canTarget = Boolean(pnTargetBeatId && beats.find(b => b.id === pnTargetBeatId));

  return `<div class="pn-card" data-note-id="${note.id}">
    <div class="pn-card-meta">
      <span class="pn-card-tag t-${note.tag}">${sfIcon(tag.symbol)} ${tag.label}</span>
      <span class="pn-card-by">${esc(note.by)}</span>
      <span class="pn-card-time">${esc(pbNoteTime(note.at))}</span>
    </div>
    ${preview ? `<div class="pn-card-text">${esc(preview)}</div>` : ''}
    ${atts ? `<div class="pn-card-atts">${sfIcon('action.attach')} ${atts} file${atts > 1 ? 's' : ''}</div>` : ''}
    <div class="pn-card-acts">
      ${canTarget && hasText ? `
        <button type="button" class="pn-act-btn pn-act-notes" onclick="pnAddToRowNotes('${note.id}')" title="Copy note text to the target row's notes field">
          ${sfIcon('content.note')} Row Notes
        </button>
        <button type="button" class="pn-act-btn pn-act-script" onclick="pnAddAsScript('${note.id}')" title="Set as script cue text on the target row">
          ${sfIcon('content.script')} Script
        </button>
      ` : ''}
      <button type="button" class="pn-act-btn pn-act-new" onclick="pnAddAsNewRow('${note.id}')" title="Create a new rundown row from this note">
        ${sfIcon('action.add')} New Row
      </button>
    </div>
  </div>`;
}

function pnSetTarget(val) {
  pnTargetBeatId = val ? Number(val) : null;
  renderPnPanel();
}

function pnSetFilter(tag) {
  pnFilterTag = tag;
  renderPnPanel();
}

function pnAddToRowNotes(noteId) {
  const note = plandaBearNotes.find(n => n.id === noteId);
  const beat = beats.find(b => b.id === pnTargetBeatId);
  if (!note || !beat) { toast('Pick a target row first.'); return; }
  if (!note.text)     { toast('Note has no text to add.'); return; }
  beat.notes = note.text.slice(0, 120);
  renderRundown();
  syncToFirestore();
  toast(`Note added to row ${beats.indexOf(beat) + 1}.`);
  renderPnPanel();
}

function pnAddAsScript(noteId) {
  const note = plandaBearNotes.find(n => n.id === noteId);
  const beat = beats.find(b => b.id === pnTargetBeatId);
  if (!note || !beat) { toast('Pick a target row first.'); return; }
  if (!note.text)     { toast('Note has no text to use as script.'); return; }
  if (!beat.cues) beat.cues = {};
  beat.cues.script = { ...(beat.cues.script || {}), text: note.text };
  renderRundown();
  syncToFirestore();
  toast(`Script set on row ${beats.indexOf(beat) + 1}.`);
  renderPnPanel();
}

function pnAddAsNewRow(noteId) {
  const note = plandaBearNotes.find(n => n.id === noteId);
  if (!note) return;
  const firstLine = (note.text || '').split('\n')[0].trim().slice(0, 80) || 'From Production Notes';
  const noteText  = (note.text || '').slice(0, 120);
  const newId     = nextBeatId();
  const newBeat   = { id: newId, style: 'flex', info: firstLine, notes: noteText, min: 0, sec: 0, done: false, cues: {}, _createdAt:Date.now(), _createdBy:presenceId };
  beats.push(newBeat);
  pnTargetBeatId = newId;
  renderRundown();
  syncToFirestore();
  toast('New row added from note — now the target row.');
  renderPnPanel();
}

function togglePbHub(head) {
  head.parentElement.classList.toggle('open');
}

// Show "who worked on what" inside Planda Bear, pulled from the session's
// shared activity log in Firestore.
async function renderPlandaBearHubActivity() {
  const panel = document.getElementById('plandabearHubActivity');
  const cards = document.querySelectorAll('#paperworkGrid [data-pb-section]');
  const clearCards = () => cards.forEach(c => {
    const by = c.querySelector('[data-pb-by]');
    if (by) { by.hidden = true; by.textContent = ''; by.classList.remove('done'); }
  });
  if (!panel) return;
  if (!session.code || session.isDemo || session.isExpert || !window._firebaseReady) {
    panel.innerHTML = '';
    clearCards();
    return;
  }
  let log = [];
  try {
    const snap = await window._getDoc(window._doc(window._db,'sessions',session.code));
    if (snap.exists()) log = Array.isArray(snap.data().preProActivity) ? snap.data().preProActivity : [];
  } catch {}
  const lastBySection = {};
  log.forEach(e => {
    if (!e || !e.section) return;
    if (!lastBySection[e.section] || (e.at||0) > (lastBySection[e.section].at||0)) lastBySection[e.section] = e;
  });
  // Annotate each paperwork card with who last touched it
  cards.forEach(c => {
    const sec = c.getAttribute('data-pb-section');
    const by = c.querySelector('[data-pb-by]');
    if (!by) return;
    const e = sec && lastBySection[sec];
    if (e) {
      by.hidden = false;
      by.classList.add('done');
      by.textContent = `Last by ${e.by || 'Someone'} · ${pbAgo(e.at)}`;
    } else {
      by.hidden = true;
      by.textContent = '';
      by.classList.remove('done');
    }
  });
  // Collapsible "who worked on what" log
  if (!log.length) {
    panel.innerHTML = '';
    return;
  }
  const recent = log.slice().sort((a,b)=>(b.at||0)-(a.at||0)).slice(0, 40);
  const contributors = new Set(log.map(e => e && e.by).filter(Boolean)).size;
  panel.innerHTML = `<div class="pb-hub-activity">
    <div class="pb-hub-activity-head" onclick="togglePbHub(this)">
      <span>👥 Who worked on what</span>
      <span style="font-weight:400;text-transform:none;letter-spacing:0;color:var(--text3)">${log.length} change${log.length===1?'':'s'} · ${contributors} ${contributors===1?'person':'people'}</span>
      <span class="pb-hub-caret">▶</span>
    </div>
    <div class="pb-hub-activity-body">
      ${recent.map(e=>`<div class="pb-hub-row">
        <span class="s">${esc(e.section||'Planda Bear')}</span>
        <span class="b" title="${esc(e.by||'Unknown')}">by ${esc(e.by||'Unknown')}</span>
        <span class="w">${pbAgo(e.at)}</span>
      </div>`).join('')}
    </div>
  </div>`;
}

function openPaperworkItem(id) {
  activePaperworkItemId = id;
  pbSetPresencePage(id);   // tell the room which page I'm on
  if (id === 'call-sheet') return openPrePro();
  if (id === 'production-scheduler') return openProductionSchedule();
  if (id === 'safety-plan') return openSafetyPlan();
  if (id === 'rundown') return showRundownPaperPreview();
  if (id === 'video-patch') return showPatchSheetPreview('video');
  if (id === 'audio-comms-patch') return showPatchSheetPreview('audio-comms');
  if (id === 'production-notes') return openProductionNotes();
}

function returnToPaperworkHub() {
  saveOpenPaperworkSection(false);
  hidePaperworkEditors();
  openPaperworkHub();
}

function saveOpenPaperworkSection(showToastOnSave=true) {
  if (document.getElementById('preProModal')?.classList.contains('on')) saveCallSheet(showToastOnSave);
  if (document.getElementById('productionScheduleModal')?.classList.contains('on')) saveProductionSchedule(showToastOnSave);
  if (document.getElementById('safetyPlanModal')?.classList.contains('on')) saveSafetyPlan(showToastOnSave);
  if (document.getElementById('patchSheetModal')?.classList.contains('on')) savePatchSheet(showToastOnSave);
}

function showPaperPreview(title, html, primaryLabel='Done', primaryAction="hideModal('paperPreviewModal')", flowId=null) {
  document.getElementById('paperPreviewTitle').textContent = title;
  document.getElementById('paperPreviewBody').innerHTML = html;
  const primary = document.getElementById('paperPreviewPrimary');
  const isExportAction = /\b(export|download)\b/i.test(primaryLabel || '');
  primary.classList.toggle('export-action', isExportAction);
  primary.innerHTML = isExportAction
    ? `${sfIcon('action.export')}<span>${esc(primaryLabel)}</span>`
    : esc(primaryLabel);
  primary.setAttribute('onclick', primaryAction);
  const previewNav = document.getElementById('pbNavPreview');
  if (previewNav) {
    previewNav.hidden = !flowId;
    if (flowId) renderPaperworkNav(flowId, 'pbNavPreview');
    else previewNav.innerHTML = '';
  }
  hideModal('paperworkHubModal');
  hideModal('preProModal');
  hideModal('productionScheduleModal');
  hideModal('safetyPlanModal');
  hideModal('patchSheetModal');
  showModal('paperPreviewModal');
  renderPlandaBearComments(flowId ? pbSectionLabel(flowId) : 'All', 'pbCommentsPreview');
}

function showRundownPaperPreview() {
  activePaperworkItemId = 'rundown';
  let offsetSecs = 0;
  showPaperPreview('Rundown Planda Bear Preview', `
    <h1>${esc(show.name || 'Cueola Rundown')}</h1>
    <div>Item 4 · Full rendered rundown</div>
    <h2>Rundown</h2>
    ${rundownPreviewTableHTML()}
  `, 'Download Rundown PDF', 'exportPDF()', 'rundown');
}

function rundownPreviewTableHTML() {
  let offsetSecs = 0;
  const cellFor = (b, type) => {
    const d = b.cues?.[type];
    const on = getCueOn(d), off = getCueOff(d);
    const script = type === 'script' && d?.text ? `Script ${scriptLineLabel(d.text)}` : '';
    const parts = [on && `<span class="cue-type">ON</span> ${esc(on)}`, off && `<span class="cue-type">OFF</span> ${esc(off)}`, script && `<span class="cue-muted">${esc(script)}</span>`].filter(Boolean);
    return parts.length ? parts.join('<br>') : '<span class="cue-muted">-</span>';
  };
  let pdfCueNum = 0;
  const rows = beats.map((b,i) => {
    const start = show.start ? clock(show.start, offsetSecs) : '-';
    offsetSecs += (b.min||0)*60+(b.sec||0);
    if (b.style === 'segment') {
      return `<tr><td colspan="10" style="background:rgba(200,200,200,.12);font-weight:800;padding:8px 6px;font-size:10px;letter-spacing:.07em;text-transform:uppercase;border-left:3px solid currentColor">§ ${esc(b.info||'Segment')}</td></tr>`;
    }
    pdfCueNum++;
    return `<tr>
      <td>${pdfCueNum}</td>
      <td><strong>${esc(b.info||'-')}</strong>${b.notes?`<br><span class="cue-muted">${esc(b.notes)}</span>`:''}</td>
      <td>${start}</td>
      <td>${fmtDur(b)}</td>
      <td class="cue-video">${cellFor(b,'video')}</td>
      <td class="cue-audio">${cellFor(b,'audio')}</td>
      <td class="cue-playback">${cellFor(b,'playback')}</td>
      <td class="cue-gfx">${cellFor(b,'gfx')}</td>
      <td class="cue-lighting">${cellFor(b,'lighting')}</td>
      <td class="cue-script">${cellFor(b,'script')}</td>
    </tr>`;
  }).join('');
  return `<div class="paper-landscape"><table class="paper-rundown-grid"><thead><tr><th>#</th><th>Row</th><th>Start</th><th>Dur</th><th class="cue-video">Video</th><th class="cue-audio">Audio</th><th class="cue-playback">Playback</th><th class="cue-gfx">GFX</th><th class="cue-lighting">Lighting</th><th class="cue-script">Script</th></tr></thead><tbody>${rows || '<tr><td colspan="10">No rows yet.</td></tr>'}</tbody></table></div>`;
}

function showCallSheetPreview() {
  const data = getPreProData();
  saveCallSheet(false);
  showPaperPreview('Call Sheet Preview', `
    ${callSheetPreviewHTML(data)}
  `, 'Export Call Sheet PDF', 'downloadCallSheetPDF()', 'call-sheet');
}

function legacyCallSheetFromData(data={}) {
  return {
    label: data.label || data.sheetLabel || '',
    production: data.production || show.name || '',
    date: data.date || '',
    call: normalizeTimeValue(data.call),
    showStart: normalizeTimeOrNA(data.showStart),
    wrap: normalizeTimeOrNA(data.wrap),
    doors: normalizeTimeOrNA(data.doors) || '',
    location: data.location || '',
    address: data.address || '',
    venue: normalizeCallSheetVenue(data.venue),
    weather: normalizeCallSheetWeather(data.weather),
    parking: data.parking || '',
    entrance: data.entrance || '',
    late: data.late || '',
    stream: data.stream || '',
    dress: data.dress || '',
    meals: data.meals || '',
    people: Array.isArray(data.people) ? data.people : [],
    notes: data.notes || '',
  };
}

function normalizeCallSheet(sheet={}, i=0, fallback={}) {
  return {
    label: sheet.label || sheet.sheetLabel || fallback.label || `Call Sheet ${i + 1}`,
    production: sheet.production || fallback.production || show.name || '',
    date: sheet.date || fallback.date || '',
    call: normalizeTimeValue(sheet.call) || normalizeTimeValue(fallback.call),
    showStart: normalizeTimeOrNA(sheet.showStart) || normalizeTimeOrNA(fallback.showStart),
    wrap: normalizeTimeOrNA(sheet.wrap) || normalizeTimeOrNA(fallback.wrap),
    doors: normalizeTimeOrNA(sheet.doors) || normalizeTimeOrNA(fallback.doors) || '',
    location: sheet.location || fallback.location || '',
    address: sheet.address || fallback.address || '',
    venue: normalizeCallSheetVenue(sheet.venue || fallback.venue),
    weather: normalizeCallSheetWeather(sheet.weather) || normalizeCallSheetWeather(fallback.weather),
    parking: sheet.parking || fallback.parking || '',
    entrance: sheet.entrance || fallback.entrance || '',
    late: sheet.late || fallback.late || '',
    stream: sheet.stream || fallback.stream || '',
    dress: sheet.dress || fallback.dress || '',
    meals: sheet.meals || fallback.meals || '',
    people: Array.isArray(sheet.people) ? sheet.people : (Array.isArray(fallback.people) ? fallback.people : []),
    notes: sheet.notes || fallback.notes || '',
  };
}

function getCallSheets(data=loadPreProData()) {
  const legacy = legacyCallSheetFromData(data);
  const rawSheets = Array.isArray(data.callSheets) && data.callSheets.length ? data.callSheets : [legacy];
  // Each sheet is self-contained — do NOT inherit empty fields from another sheet
  // (the shared top-level "legacy" values), which used to bleed times across days.
  const sheets = rawSheets.map((sheet, i) => normalizeCallSheet(sheet, i));
  return sheets.length ? sheets : [normalizeCallSheet(legacy, 0)];
}

function callSheetDisplayName(sheet, i=0) {
  const label = (sheet?.label || '').trim();
  return label || `Call Sheet ${i + 1}`;
}

function renderCallSheetSelector(sheets=getCallSheets()) {
  const select = document.getElementById('pp-call-sheet-select');
  if (!select) return;
  select.innerHTML = sheets.map((sheet, i) => `<option value="${i}" ${i === activeCallSheetIndex ? 'selected' : ''}>${esc(callSheetDisplayName(sheet, i))}</option>`).join('');
}

function hydrateCallSheetForm(sheet) {
  const data = normalizeCallSheet(sheet, activeCallSheetIndex);
  document.getElementById('pp-sheet-label').value = data.label || '';
  document.getElementById('pp-production').value = data.production || show.name || '';
  document.getElementById('pp-date').value = data.date || '';
  // No fallback times: an unset field stays --:-- so the user knows to fill it
  // in (times must never silently default from the rundown or another sheet).
  setTimeInputValue('pp-call', data.call);
  const showNA = data.showStart === 'N/A';
  setShowNotApplicable(showNA);
  if (!showNA) setTimeInputValue('pp-show-start', data.showStart);
  const wrapNA = data.wrap === 'N/A';
  setWrapNotApplicable(wrapNA);
  if (!wrapNA) setTimeInputValue('pp-wrap', data.wrap);
  setDoorsNotApplicable(data.doors === 'N/A');
  setTimeInputValue('pp-doors', data.doors === 'N/A' ? '' : data.doors);
  document.getElementById('pp-location').value = data.location || '';
  document.getElementById('pp-address').value = data.address || '';
  callSheetVenue = normalizeCallSheetVenue(data.venue);
  renderCallSheetVenue();
  callSheetWeather = normalizeCallSheetWeather(data.weather);
  renderCallSheetWeatherCard();
  document.getElementById('pp-late').value = data.late || '';
  document.getElementById('pp-parking').value = data.parking || '';
  document.getElementById('pp-entrance').value = data.entrance || '';
  document.getElementById('pp-stream').value = data.stream || '';
  document.getElementById('pp-dress').value = data.dress || '';
  document.getElementById('pp-meals').value = data.meals || '';
  document.getElementById('pp-notes').value = data.notes || '';
  callSheetPeople = Array.isArray(data.people) && data.people.length ? data.people : [{ name:'', position:'', email:'', phone:'', call:'' }];
  renderCallSheetPeople();
}

function currentCallSheetFromForm() {
  syncCallSheetPeopleFromDOM();
  return normalizeCallSheet({
    label: document.getElementById('pp-sheet-label')?.value?.trim() || `Call Sheet ${activeCallSheetIndex + 1}`,
    production: document.getElementById('pp-production')?.value?.trim() || show.name || '',
    date: document.getElementById('pp-date')?.value || '',
    call: timeInputValue('pp-call'),
    showStart: getShowStartValue(),
    wrap: getWrapValue(),
    doors: getDoorsOpenValue(),
    location: document.getElementById('pp-location')?.value?.trim() || '',
    address: document.getElementById('pp-address')?.value?.trim() || '',
    venue: callSheetVenue,
    weather: normalizeCallSheetWeather(callSheetWeather),
    parking: document.getElementById('pp-parking')?.value?.trim() || '',
    entrance: document.getElementById('pp-entrance')?.value?.trim() || '',
    late: document.getElementById('pp-late')?.value?.trim() || '',
    stream: document.getElementById('pp-stream')?.value?.trim() || '',
    dress: document.getElementById('pp-dress')?.value?.trim() || '',
    meals: document.getElementById('pp-meals')?.value || '',
    people: callSheetPeople,
    notes: document.getElementById('pp-notes')?.value || '',
  }, activeCallSheetIndex);
}

// ── Call sheet venue + weather ───────────────────────────────
// Venue is a simple indoors/outdoors/both tag. Weather auto-fills from
// Open-Meteo (free, no API key) for the location + shoot date, and every
// field stays editable as a manual override.
function normalizeCallSheetVenue(v) {
  return ['indoors','outdoors','both'].includes(v) ? v : '';
}

function venueLabel(v) {
  return v === 'indoors' ? 'Indoors' : v === 'outdoors' ? 'Outdoors' : v === 'both' ? 'Indoors & Outdoors' : '';
}

function normalizeCallSheetWeather(w) {
  if (!w || typeof w !== 'object') return null;
  const s = v => (v == null ? '' : String(v)).slice(0, 60);
  const out = {
    conditions: s(w.conditions), high: s(w.high), low: s(w.low),
    precip: s(w.precip), wind: s(w.wind), sunrise: s(w.sunrise), sunset: s(w.sunset),
    emoji: s(w.emoji), symbol: s(w.symbol),
    source: w.source === 'auto' ? 'auto' : (w.source === 'manual' ? 'manual' : ''),
    forecastDate: s(w.forecastDate), place: s(w.place), updatedAt: Number(w.updatedAt) || 0,
  };
  const hasAny = out.conditions || out.high || out.low || out.precip || out.wind || out.sunrise || out.sunset;
  return hasAny ? out : null;
}

// [label, emoji (text/PDF), symbol (SVG icon from the design-system weather library)]
const WMO_WEATHER = {
  0:['Clear sky','☀️','weather.clear'], 1:['Mainly clear','🌤️','weather.mostly-clear'], 2:['Partly cloudy','⛅','weather.partly-cloudy'], 3:['Overcast','☁️','weather.overcast'],
  45:['Fog','🌫️','weather.fog'], 48:['Rime fog','🌫️','weather.fog'],
  51:['Light drizzle','🌦️','weather.drizzle'], 53:['Drizzle','🌦️','weather.drizzle'], 55:['Heavy drizzle','🌧️','weather.drizzle'],
  56:['Freezing drizzle','🌧️','weather.sleet'], 57:['Freezing drizzle','🌧️','weather.sleet'],
  61:['Light rain','🌦️','weather.showers'], 63:['Rain','🌧️','weather.rain'], 65:['Heavy rain','🌧️','weather.heavy-rain'],
  66:['Freezing rain','🌧️','weather.sleet'], 67:['Freezing rain','🌧️','weather.sleet'],
  71:['Light snow','🌨️','weather.snow'], 73:['Snow','❄️','weather.snow'], 75:['Heavy snow','❄️','weather.snow'], 77:['Snow grains','❄️','weather.snow'],
  80:['Rain showers','🌦️','weather.showers'], 81:['Rain showers','🌧️','weather.rain'], 82:['Violent showers','⛈️','weather.heavy-rain'],
  85:['Snow showers','🌨️','weather.snow'], 86:['Snow showers','🌨️','weather.snow'],
  95:['Thunderstorm','⛈️','weather.thunderstorm'], 96:['Thunderstorm, hail','⛈️','weather.thunderstorm-rain'], 99:['Thunderstorm, hail','⛈️','weather.thunderstorm-rain'],
};
function wmoWeather(code) {
  const hit = WMO_WEATHER[code];
  return hit ? { label:hit[0], emoji:hit[1], symbol:hit[2] } : { label:'', emoji:'🌤️', symbol:'weather.default' };
}

// Best-effort weather SVG symbol for a stored weather object: use the saved
// symbol, else infer one from the conditions text (manual entries), else default.
function weatherSymbolFor(w) {
  if (w && w.symbol) return w.symbol;
  const text = String(w?.conditions || '').toLowerCase();
  if (!text) return 'weather.default';
  if (/thunder|storm|lightning/.test(text)) return 'weather.thunderstorm';
  if (/hail|sleet|freezing/.test(text)) return 'weather.sleet';
  if (/snow|flurr/.test(text)) return 'weather.snow';
  if (/heavy rain|downpour|pouring/.test(text)) return 'weather.heavy-rain';
  if (/shower/.test(text)) return 'weather.showers';
  if (/drizzle/.test(text)) return 'weather.drizzle';
  if (/rain|wet/.test(text)) return 'weather.rain';
  if (/fog|mist|haze/.test(text)) return 'weather.fog';
  if (/overcast|cloudy|clouds/.test(text)) return 'weather.overcast';
  if (/partly|mostly clear|partial/.test(text)) return 'weather.partly-cloudy';
  if (/clear|sunny|sun\b|fair/.test(text)) return 'weather.clear';
  if (/wind|breez|gust/.test(text)) return 'weather.wind';
  return 'weather.default';
}

function fmtClockFromISO(iso) {
  if (!iso) return '';
  const t = String(iso).split('T')[1] || '';
  const parts = t.split(':');
  if (parts.length < 2) return '';
  let hr = parseInt(parts[0], 10);
  if (!Number.isFinite(hr)) return '';
  const ap = hr >= 12 ? 'PM' : 'AM';
  hr = hr % 12 || 12;
  return `${hr}:${parts[1]} ${ap}`;
}

function callSheetDayLabel(dateStr) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr || '');
  if (!m) return '';
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return isNaN(d) ? '' : d.toLocaleDateString(undefined, { weekday:'long', month:'short', day:'numeric' });
}

// Plain text (no emoji) — safe for the jsPDF call-sheet export.
function weatherSummaryLine(w) {
  w = normalizeCallSheetWeather(w);
  if (!w) return '';
  const parts = [];
  if (w.conditions) parts.push(w.conditions);
  if (w.high || w.low) parts.push(`High ${w.high || '—'} / Low ${w.low || '—'}`);
  if (w.precip) parts.push(`Precip ${w.precip}`);
  if (w.wind) parts.push(`Wind ${w.wind}`);
  if (w.sunrise || w.sunset) parts.push(`Sunrise ${w.sunrise || '—'} / Sunset ${w.sunset || '—'}`);
  return parts.join(' · ');
}

// Cute one-liner with emoji icons — used only where plain text rendering is
// acceptable. Form fields use sf-symbol icons beside plain editable text.
function weatherCuteSummary(w, withSun=false) {
  w = normalizeCallSheetWeather(w);
  if (!w) return '';
  const parts = [];
  if (w.conditions) parts.push(`${w.emoji || '🌤️'} ${w.conditions}`);
  else if (w.emoji) parts.push(w.emoji);
  if (w.high || w.low) parts.push(`🌡️ ${w.high || '—'} / ${w.low || '—'}`);
  if (w.precip) parts.push(`💧 ${w.precip}`);
  if (w.wind) parts.push(`💨 ${w.wind}`);
  if (withSun && (w.sunrise || w.sunset)) parts.push(`🌅 ${w.sunrise || '—'}  🌇 ${w.sunset || '—'}`);
  return parts.join('  ·  ');
}

function weatherCompactSummary(w, withSun=false) {
  w = normalizeCallSheetWeather(w);
  if (!w) return '';
  const parts = [];
  if (w.conditions) parts.push(w.conditions);
  if (w.high || w.low) parts.push(`${w.high || '-'} / ${w.low || '-'}`);
  if (w.precip) parts.push(w.precip);
  if (w.wind) parts.push(w.wind);
  if (withSun && (w.sunrise || w.sunset)) parts.push(`${w.sunrise || '-'} / ${w.sunset || '-'}`);
  return parts.join(' · ');
}

// The active call sheet's weather object (used to auto-fill the safety plan).
function activeCallSheetWeather(data) {
  const sheets = getCallSheets(data);
  const idx = Math.max(0, Math.min(Number(data?.activeCallSheetIndex ?? activeCallSheetIndex) || 0, sheets.length - 1));
  return sheets[idx]?.weather || null;
}

function safetyPlanWeatherAutoText(data) {
  const sheetWeather = activeCallSheetWeather(data);
  const sheetText = typeof sheetWeather === 'string' ? sheetWeather : '';
  const topText = typeof data?.weather === 'string' ? data.weather : '';
  return weatherCompactSummary(sheetWeather) || sheetText || weatherCompactSummary(data?.weather) || topText || '';
}

function safetyPlanWeatherSource(data) {
  return normalizeCallSheetWeather(activeCallSheetWeather(data)) || normalizeCallSheetWeather(data?.weather);
}

function weatherChipHTML(symbol, label) {
  if (!label) return '';
  return `<span class="sp-weather-part">${sfIcon(symbol)}<span>${esc(label)}</span></span>`;
}

function safetyPlanWeatherSymbolHTML(w) {
  w = normalizeCallSheetWeather(w);
  if (!w) return '';
  const parts = [];
  if (w.conditions || w.symbol) parts.push(weatherChipHTML(weatherSymbolFor(w), w.conditions || 'Weather'));
  if (w.high || w.low) parts.push(weatherChipHTML('weather.temp', `${w.high || '-'} / ${w.low || '-'}`));
  if (w.precip) parts.push(weatherChipHTML('weather.precip', w.precip));
  if (w.wind) parts.push(weatherChipHTML('weather.wind', w.wind));
  return parts.filter(Boolean).join('<span class="sp-weather-sep" aria-hidden="true">·</span>');
}

function renderSafetyPlanWeatherSymbols(data=loadPreProData()) {
  const host = document.getElementById('sp-weather-symbols');
  const input = document.getElementById('sp-weather');
  if (!host || !input) return;
  const auto = safetyPlanWeatherAutoText(data);
  const current = input.value.trim();
  const sourceHtml = safetyPlanWeatherSymbolHTML(safetyPlanWeatherSource(data));
  const useSource = Boolean(sourceHtml && (!current || current === auto));
  const html = useSource ? sourceHtml : (current ? weatherChipHTML(weatherSymbolFor({ conditions: current }), current) : '');
  host.innerHTML = html;
  host.hidden = !html;
  host.setAttribute('aria-label', useSource ? auto : current);
  host.parentElement?.classList.toggle('has-weather-summary', Boolean(html));
}

function safetySecurityValue(value) {
  const v = String(value || '').trim();
  return v === '8822' ? '' : v;
}

function setCallSheetVenue(v) {
  const nv = normalizeCallSheetVenue(v);
  callSheetVenue = (callSheetVenue === nv) ? '' : nv; // click active to clear
  renderCallSheetVenue();
  paperworkDirty = true;
}

function renderCallSheetVenue() {
  document.querySelectorAll('#pp-venue-group [data-venue]').forEach(btn => {
    const on = btn.getAttribute('data-venue') === callSheetVenue;
    btn.classList.toggle('on', on);
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
  });
}

function setWeatherStatus(text, isError=false) {
  const el = document.getElementById('pp-weather-status');
  if (!el) return;
  el.textContent = text || '';
  el.classList.toggle('warn', !!isError);
}

function renderCallSheetWeatherCard() {
  const date = document.getElementById('pp-date')?.value || '';
  const setTxt = (id, t) => { const e = document.getElementById(id); if (e) e.textContent = t; };
  const setV = (id, v) => { const e = document.getElementById(id); if (e && document.activeElement !== e) e.value = v; };
  setTxt('pp-weather-day', callSheetDayLabel(date) || 'Add a shoot date');
  setTxt('pp-weather-call', document.getElementById('pp-call')?.value || '—');
  setTxt('pp-weather-loc', document.getElementById('pp-location')?.value?.trim() || 'Add a location');
  const w = callSheetWeather || {};
  setV('pp-wx-conditions', w.conditions || '');
  setV('pp-wx-high', w.high || '');
  setV('pp-wx-low', w.low || '');
  setV('pp-wx-precip', w.precip || '');
  setV('pp-wx-wind', w.wind || '');
  setV('pp-wx-sunrise', w.sunrise || '');
  setV('pp-wx-sunset', w.sunset || '');
  const icoEl = document.getElementById('pp-weather-ico');
  if (icoEl) icoEl.innerHTML = sfIcon(weatherSymbolFor(w));
  if (w.updatedAt) {
    setWeatherStatus([w.source === 'auto' ? 'Auto forecast' : 'Manual entry', w.place, w.forecastDate].filter(Boolean).join(' · '));
  } else {
    setWeatherStatus('Auto-fills from your location and shoot date. You can edit anything below.');
  }
}

function onCallSheetWeatherInput(field, value) {
  if (!callSheetWeather) {
    callSheetWeather = { conditions:'', high:'', low:'', precip:'', wind:'', sunrise:'', sunset:'', emoji:'', source:'manual', forecastDate:'', place:'', updatedAt:0 };
  }
  callSheetWeather[field] = value;
  callSheetWeather.source = callSheetWeather.source || 'manual';
  callSheetWeather.updatedAt = Date.now();
  paperworkDirty = true;
}

// The Open-Meteo geocoder matches place names and postal codes only — a full
// street address ("123 Main St, Springfield, IL 62704") finds nothing. Build a
// candidate list from the location AND address fields: full string, then the
// tail segments after each comma (usually city/state), each segment, each
// segment with zip/state abbreviation stripped, and any zip code on its own.
function weatherGeoQueries(...sources) {
  const out = [];
  const push = q => {
    q = String(q || '').replace(/\s+/g, ' ').trim();
    if (q.length >= 2 && !/^\d{1,4}$/.test(q) && !out.some(x => x.toLowerCase() === q.toLowerCase())) out.push(q);
  };
  sources.forEach(src => {
    const s = String(src || '').trim();
    if (!s) return;
    push(s);
    const zip = s.match(/\b\d{5}(?:-\d{4})?\b/);
    if (zip) push(zip[0]);
    const segs = s.split(',').map(x => x.trim()).filter(Boolean);
    for (let i = 1; i < segs.length; i++) push(segs.slice(i).join(', '));
    segs.forEach(seg => {
      push(seg);
      const noZip = seg.replace(/\b\d{5}(?:-\d{4})?\b/g, '').trim();
      push(noZip);
      push(noZip.replace(/\b[A-Z]{2}\.?$/, '').trim());   // trailing state abbreviation
    });
  });
  return out.slice(0, 10);
}

async function fetchCallSheetWeather() {
  const btn = document.getElementById('pp-weather-fetch-btn');
  const location = document.getElementById('pp-location')?.value?.trim() || '';
  const address = document.getElementById('pp-address')?.value?.trim() || '';
  const date = document.getElementById('pp-date')?.value || '';
  if (!location && !address) { setWeatherStatus('Add a location or address first, then get the forecast.', true); document.getElementById('pp-location')?.focus(); return; }
  if (!date) { setWeatherStatus('Add a shoot date first, then get the forecast.', true); document.getElementById('pp-date')?.focus(); return; }
  if (btn) btn.disabled = true;
  setWeatherStatus('Finding location…');
  try {
    const geoQueries = weatherGeoQueries(location, address);
    let place = null;
    for (const q of geoQueries) {
      const geoRes = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=1&language=en&format=json`);
      if (!geoRes.ok) throw new Error('geo');
      place = (await geoRes.json())?.results?.[0];
      if (place) break;
    }
    if (!place) { setWeatherStatus(`Couldn't find "${location || address}". Try just a city name (e.g. "Boston"), or enter weather manually below.`, true); return; }
    setWeatherStatus('Loading forecast…');
    const q = `latitude=${place.latitude}&longitude=${place.longitude}&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,wind_speed_10m_max,sunrise,sunset&temperature_unit=fahrenheit&wind_speed_unit=mph&timezone=auto&start_date=${date}&end_date=${date}`;
    const fRes = await fetch(`https://api.open-meteo.com/v1/forecast?${q}`);
    if (!fRes.ok) throw new Error('forecast');
    const d = (await fRes.json())?.daily;
    if (!d?.time?.length || d.temperature_2m_max?.[0] == null) {
      setWeatherStatus('That date is outside the 16-day forecast window — enter weather manually below.', true);
      return;
    }
    const wx = wmoWeather(d.weather_code?.[0]);
    const round = n => (n == null ? '' : Math.round(n));
    callSheetWeather = {
      conditions: wx.label, emoji: wx.emoji, symbol: wx.symbol,
      high: d.temperature_2m_max?.[0] != null ? round(d.temperature_2m_max[0]) + '°' : '',
      low:  d.temperature_2m_min?.[0] != null ? round(d.temperature_2m_min[0]) + '°' : '',
      precip: d.precipitation_probability_max?.[0] != null ? d.precipitation_probability_max[0] + '%' : '',
      wind: d.wind_speed_10m_max?.[0] != null ? round(d.wind_speed_10m_max[0]) + ' mph' : '',
      sunrise: fmtClockFromISO(d.sunrise?.[0]),
      sunset: fmtClockFromISO(d.sunset?.[0]),
      source: 'auto', forecastDate: date,
      place: [place.name, place.admin1, place.country_code].filter(Boolean).join(', '),
      updatedAt: Date.now(),
    };
    renderCallSheetWeatherCard();
    paperworkDirty = true;
    saveCallSheetStateLocally(false);
  } catch (e) {
    setWeatherStatus('Could not reach the weather service. Check your connection or enter weather manually below.', true);
  } finally {
    if (btn) btn.disabled = false;
  }
}

function saveCallSheetStateLocally(showToastOnSave=false) {
  const data = getPreProData();
  persistPreProData(data, 'Call Sheet');
  if (showToastOnSave) toast('Call sheet saved.');
  return data;
}

function switchCallSheet(index) {
  const nextIndex = Number(index);
  if (!Number.isFinite(nextIndex)) return;
  const data = saveCallSheetStateLocally(false);
  const sheets = getCallSheets(data);
  activeCallSheetIndex = Math.max(0, Math.min(nextIndex, sheets.length - 1));
  const next = { ...data, activeCallSheetIndex };
  try { localStorage.setItem(preProKey(), JSON.stringify(next)); } catch {}
  renderCallSheetSelector(sheets);
  hydrateCallSheetForm(sheets[activeCallSheetIndex]);
}

function updateActiveCallSheetLabel(value) {
  const select = document.getElementById('pp-call-sheet-select');
  if (!select?.options?.[activeCallSheetIndex]) return;
  select.options[activeCallSheetIndex].textContent = (value || '').trim() || `Call Sheet ${activeCallSheetIndex + 1}`;
}

function addAnotherCallSheet() {
  const data = saveCallSheetStateLocally(false);
  const sheets = getCallSheets(data);
  const source = sheets[activeCallSheetIndex] || sheets[0] || legacyCallSheetFromData(data);
  // Copy the venue + crew roster, but start the schedule fresh so the new day's
  // sheet doesn't inherit the previous day's call/show/wrap times.
  const nextSheet = normalizeCallSheet({
    ...source,
    label: `Call Sheet ${sheets.length + 1}`,
    date: '', call: '', showStart: '', wrap: '', doors: '',
    weather: null, // new day → fetch fresh forecast; venue carries over from source
    people: (Array.isArray(source.people) ? source.people : []).map(p => ({ ...p, call:'' })),
  }, sheets.length);
  sheets.push(nextSheet);
  activeCallSheetIndex = sheets.length - 1;
  const next = { ...data, callSheets:sheets, activeCallSheetIndex, updatedAt:Date.now() };
  persistPreProData(next, 'Call Sheet');
  renderCallSheetSelector(sheets);
  hydrateCallSheetForm(nextSheet);
  toast('Added another call sheet.');
}

function cleanPdfName(value, fallback='cueola-export') {
  return (value || fallback)
    .replace(/[^\w\-]+/g,'-')
    .replace(/-+/g,'-')
    .replace(/^-|-$/g,'')
    .toLowerCase() || fallback;
}

function callSheetTitle(data={}) {
  const production = (data.production || show.name || '').trim();
  const label = (data.label || data.sheetLabel || '').trim();
  const isGeneric = !label || /^call sheet\s*\d*$/i.test(label);
  const suffix = isGeneric ? 'Call Sheet' : (/\bcall sheet$/i.test(label) ? label : `${label} Call Sheet`);
  return production ? `${production} - ${suffix}` : suffix;
}

function getCallSheetExportData() {
  if (document.getElementById('preProModal')?.classList.contains('on')) {
    const data = getPreProData();
    persistPreProData(data, 'Call Sheet');
    return data;
  }
  const data = loadPreProData();
  const sheets = getCallSheets(data);
  const idx = Math.max(0, Math.min(Number(data.activeCallSheetIndex ?? activeCallSheetIndex) || 0, sheets.length - 1));
  return normalizeCallSheet(sheets[idx], idx);
}

function showPatchSheetPreview(kind) {
  openPatchSheetEditor(kind);
}

function callSheetPreviewHTML(data) {
  const title = callSheetTitle(data);
  const people = (data.people || []).filter(p => p.name || p.position || p.role || p.email || p.phone || p.call);
  const peopleRows = people.map(p => `<tr><td>${esc(p.name || '')}</td><td>${esc(p.position || p.role || '')}</td><td>${esc(p.email || '')}</td><td>${esc(p.phone || '')}</td><td>${esc(p.call || data.call || '')}</td></tr>`).join('');
  return `
    <h1>${esc(title)}</h1>
    <table><tbody>
      <tr><th>Production</th><td>${esc(data.production || show.name || '')}</td></tr>
      <tr><th>Shoot Date</th><td>${esc(data.date || '')}</td></tr>
      <tr><th>Call Time</th><td>${esc(data.call || show.start || '')}</td></tr>
      <tr><th>Doors Open</th><td>${esc(data.doors || '')}</td></tr>
      <tr><th>Show Start</th><td>${esc(data.showStart || '')}</td></tr>
      <tr><th>Estimated Wrap</th><td>${esc(data.wrap || '')}</td></tr>
      <tr><th>Location</th><td>${esc(data.location || '')}</td></tr>
      <tr><th>Address</th><td>${esc(data.address || '')}</td></tr>
      <tr><th>Venue</th><td>${esc(venueLabel(data.venue))}</td></tr>
      <tr><th>Weather</th><td>${esc(weatherCuteSummary(data.weather, true))}</td></tr>
      <tr><th>Parking</th><td>${esc(data.parking || '')}</td></tr>
      <tr><th>Entrance</th><td>${esc(data.entrance || '')}</td></tr>
      <tr><th>Late / Lost Contact</th><td>${esc(data.late || '')}</td></tr>
      <tr><th>Stream Information</th><td>${esc(data.stream || '')}</td></tr>
      <tr><th>Dress Code</th><td>${esc(data.dress || '')}</td></tr>
      <tr><th>Meals Provided</th><td>${esc(data.meals || '')}</td></tr>
    </tbody></table>
    <h2>Crew / Talent</h2>
    <table><thead><tr><th>Name</th><th>Position</th><th>Email</th><th>Phone</th><th>Call</th></tr></thead><tbody>${peopleRows || '<tr><td colspan="5">No crew or talent entered yet.</td></tr>'}</tbody></table>
    <h2>General Notes</h2>
    <table><tbody><tr><td>${esc(data.notes || '')}</td></tr></tbody></table>`;
}

function showCuePartPreview(type) {
  const titleMap = { video:'Camera Cue Part', audio:'Rundown Audio Cues Part', lighting:'Rundown Lighting Cues Part' };
  const rows = beats.map((b,i) => {
    const d = b.cues?.[type];
    if (!d) return '';
    const on = getCueOn(d), off = getCueOff(d);
    return `<tr><td>${i+1}</td><td>${esc(b.info||'-')}</td><td>${esc(on||'-')}</td><td>${esc(off||'-')}</td><td>${esc(d.notes||'')}</td></tr>`;
  }).filter(Boolean).join('');
  showPaperPreview(titleMap[type], `
    <h1>${titleMap[type]}</h1>
    <div>Rendered from the rundown editor.</div>
    <table><thead><tr><th>#</th><th>Row</th><th>Ready</th><th>Take</th><th>Notes</th></tr></thead><tbody>${rows || '<tr><td colspan="5">No cues for this part yet.</td></tr>'}</tbody></table>
  `, 'Done', "hideModal('paperPreviewModal')", null);
}

function openSafetyPlan() {
  activePaperworkItemId = 'safety-plan';
  hideModal('paperworkHubModal');
  const data = loadPreProData();
  const safety = data.safety || {};
  document.getElementById('sp-hospital').value = safety.hospital || data.hospital || '';
  // Auto-fill weather from the call sheet's fetched forecast (with icons) when the
  // safety plan hasn't been given its own weather note yet. Only a real STRING note
  // counts — legacy saves sometimes stored the whole weather OBJECT here, which both
  // rendered "[object Object]" and (being truthy) blocked the call-sheet auto-fill.
  const safetyWeatherNote = typeof safety.weather === 'string' ? safety.weather : '';
  document.getElementById('sp-weather').value = safetyWeatherNote || safetyPlanWeatherAutoText(data);
  renderSafetyPlanWeatherSymbols(data);
  document.getElementById('sp-first-aid').value = safety.firstAid || '';
  document.getElementById('sp-fire').value = safety.fire || '';
  document.getElementById('sp-emergency').value = safety.emergency || '';
  document.getElementById('sp-nonemergency').value = safety.nonemergency || '';
  document.getElementById('sp-security').value = safetySecurityValue(safety.security);
  document.getElementById('sp-late').value = safety.late || data.late || '';
  document.getElementById('sp-equipment').value = safety.equipment || data.equipment || '';
  document.getElementById('sp-notes').value = safety.notes || '';
  renderPaperworkNav('safety-plan');
  renderPlandaBearComments('Safety Plan', 'pbCommentsSafety');
  showModal('safetyPlanModal');
}

function getSafetyPlanData() {
  const data = loadPreProData();
  const existing = data.safety || {};
  // If the weather field still equals the call-sheet auto-fill, keep it "auto"
  // (store empty) so it stays live with the call sheet; a real edit is kept.
  const existingWeather = typeof existing.weather === 'string' ? existing.weather : '';
  const wxVal = document.getElementById('sp-weather')?.value?.trim() || existingWeather || '';
  const wxAuto = safetyPlanWeatherAutoText(data);
  return {
    hospital: document.getElementById('sp-hospital')?.value?.trim() ?? existing.hospital ?? '',
    weather: (wxAuto && wxVal === wxAuto) ? '' : wxVal,
    firstAid: document.getElementById('sp-first-aid')?.value?.trim() ?? existing.firstAid ?? '',
    fire: document.getElementById('sp-fire')?.value?.trim() ?? existing.fire ?? '',
    emergency: document.getElementById('sp-emergency')?.value?.trim() ?? existing.emergency ?? '',
    nonemergency: document.getElementById('sp-nonemergency')?.value?.trim() ?? existing.nonemergency ?? '',
    security: safetySecurityValue(document.getElementById('sp-security')?.value?.trim() ?? existing.security ?? ''),
    late: document.getElementById('sp-late')?.value?.trim() ?? existing.late ?? '',
    equipment: document.getElementById('sp-equipment')?.value?.trim() ?? existing.equipment ?? '',
    notes: document.getElementById('sp-notes')?.value ?? existing.notes ?? '',
  };
}

function saveSafetyPlan(showToastOnSave=true) {
  persistPreProData({ safety: getSafetyPlanData() }, 'Safety Plan');
  if (showToastOnSave) toast('Safety plan saved.');
}

function safetyPlanHTML(safety) {
  const data = loadPreProData();
  const safetyWeather = typeof safety.weather === 'string' ? safety.weather : '';
  return `
    <h1>3. Safety Plan</h1>
    <div>Item 3</div>
    <table><tbody>
      <tr><th>Local Hospital</th><td>${esc(safety.hospital || '')}</td></tr>
      <tr><th>Weather</th><td>${esc(safetyWeather || safetyPlanWeatherAutoText(data))}</td></tr>
      <tr><th>First Aid Kit Location</th><td>${esc(safety.firstAid || '')}</td></tr>
      <tr><th>Fire Extinguisher Location</th><td>${esc(safety.fire || '')}</td></tr>
      <tr><th>Emergency Numbers</th><td>${esc(safety.emergency || '')}</td></tr>
      <tr><th>Non-Emergency Numbers</th><td>${esc(safety.nonemergency || '')}</td></tr>
      <tr><th>Security</th><td>${esc(safety.security || '')}</td></tr>
      <tr><th>Late / Lost Contact</th><td>${esc(safety.late || '')}</td></tr>
      <tr><th>Equipment Needed</th><td>${esc(safety.equipment || '')}</td></tr>
      <tr><th>Safety Notes</th><td>${esc(safety.notes || '')}</td></tr>
    </tbody></table>
  `;
}

function showSafetyPlanPreview() {
  const safety = getSafetyPlanData();
  saveSafetyPlan(false);
  showPaperPreview('Safety Plan Preview', safetyPlanHTML(safety), 'Back to Editor', "hideModal('paperPreviewModal');openSafetyPlan()", 'safety-plan');
}

function defaultProductionSchedule() {
  return {
    date:'',
    showDate:'',
    setup:'',
    call:'',
    show:'',
    wrap:'',
    doors:'',
    location:'',
    address:'',
    setupNotes:'',
    showNotes:'',
    checklist: DEFAULT_PRODUCTION_CHECKS.map(row => ({ area:row.area, item:row.item, hint:row.item, done:false })),
  };
}

function normalizeProductionChecklistRow(row, i=0) {
  if (typeof row === 'string') return { area:'Crew-defined check', item:row, hint:'Rewrite this as a show-day check your crew can verify.', done:false, doneBy:'', doneAt:0 };
  const guide = guideForProductionArea(row?.area) || PRODUCTION_CHECKLIST_GUIDES[i] || {};
  const fallback = DEFAULT_PRODUCTION_CHECKS[i]?.item || guide.hint || row?.hint || '';
  const done = Boolean(row?.done);
  return {
    area: row?.area || guide.area || '',
    item: row?.item || row?.task || fallback,
    hint: row?.hint || guide.hint || fallback,
    done,
    // Accountability: who signed the item off, and when. Cleared if reopened.
    doneBy: done ? String(row?.doneBy || '') : '',
    doneAt: done ? (Number(row?.doneAt) || 0) : 0,
  };
}

function productionScheduleWithCallSheet(schedule={}, callSheet=loadPreProData()) {
  const base = { ...defaultProductionSchedule(), ...(schedule || {}) };
  base.checklist = Array.isArray(base.checklist) && base.checklist.length ? base.checklist : defaultProductionSchedule().checklist;
  return {
    ...base,
    setup: normalizeTimeValue(base.setup),
    wrap: normalizeTimeValue(base.wrap),
    showDate: base.showDate || callSheet.date || '',
    // Times never default from the call sheet or rundown — an unset time stays
    // blank (--:--) so the user knows it still needs a real value.
    call: normalizeTimeValue(base.call),
    show: normalizeTimeValue(base.show),
    doors: base.doors || callSheet.doors || '',
    location: base.location || callSheet.location || '',
    address: base.address || callSheet.address || '',
    checklist: base.checklist.map(normalizeProductionChecklistRow),
  };
}

function guideForProductionArea(area) {
  const needle = String(area || '').trim().toLowerCase();
  return PRODUCTION_CHECKLIST_GUIDES.find(row => row.area.toLowerCase() === needle);
}

function syncProductionChecklistGuide(input) {
  const idx = Number(input?.dataset?.psRow);
  if (!Number.isFinite(idx)) return;
  const guide = guideForProductionArea(input.value);
  const hint = guide?.hint || 'Add a ready-before-show item.';
  const hidden = document.querySelector(`[data-ps-row="${idx}"][data-ps-field="hint"]`);
  const check = document.querySelector(`[data-ps-row="${idx}"][data-ps-field="item"]`);
  if (hidden) hidden.value = hint;
  if (check && !check.value.trim()) check.setAttribute('placeholder', hint);
}

function openProductionSchedule() {
  activePaperworkItemId = 'production-scheduler';
  hideModal('paperworkHubModal');
  const callSheet = loadPreProData();
  const schedule = productionScheduleWithCallSheet(callSheet.productionSchedule || {}, callSheet);
  document.getElementById('ps-date').value = schedule.date || '';
  setTimeInputValue('ps-setup', schedule.setup);
  setTimeInputValue('ps-call', schedule.call);
  setTimeInputValue('ps-show', schedule.show);
  setTimeInputValue('ps-wrap', schedule.wrap);
  document.getElementById('ps-show-date').value = schedule.showDate || '';
  document.getElementById('ps-doors').value = schedule.doors || '';
  document.getElementById('ps-location').value = schedule.location || '';
  document.getElementById('ps-address').value = schedule.address || '';
  document.getElementById('ps-setup-notes').value = schedule.setupNotes || '';
  document.getElementById('ps-show-notes').value = schedule.showNotes || '';
  setSetupNotApplicable(schedule.setupNA);
  renderProductionChecklist(schedule.checklist);
  renderPaperworkNav('production-scheduler');
  renderPlandaBearComments('Production Schedule', 'pbCommentsProduction');
  showModal('productionScheduleModal');
}

function renderProductionChecklist(items) {
  const el = document.getElementById('ps-checklist');
  if (!el) return;
  const rows = (Array.isArray(items) && items.length ? items : defaultProductionSchedule().checklist).map(normalizeProductionChecklistRow);
  const complete = rows.filter(row => row.done).length;
  el.innerHTML = `<div class="readiness-builder">
    <div class="readiness-builder-head">
      <div>
        <div class="readiness-title">Ready Before Show</div>
        <div class="readiness-copy">Use this as the final walk-through. Check a row only when that item is actually ready.</div>
      </div>
      <div class="readiness-progress">${complete} of ${rows.length} ready</div>
    </div>
    <div class="readiness-simple-head" aria-hidden="true">
      <span>Ready</span><span>Checklist Item</span><span></span>
    </div>
    ${rows.map((row,i)=>`
      <div class="readiness-simple-row${row.done?' signed':''}">
        <label class="readiness-done"><input type="checkbox" data-ps-row="${i}" data-ps-field="done" ${row.done?'checked':''} onchange="onProductionChecklistToggle(this)"> Ready</label>
        <div class="readiness-item-wrap">
          <input class="field-in" data-ps-row="${i}" data-ps-field="item" value="${esc(row.item||'')}" placeholder="Add a ready-before-show item">
          ${row.done && row.doneBy ? `<div class="readiness-signoff">✓ Signed off by ${esc(row.doneBy)}${row.doneAt ? ` · ${esc(pbAgo(row.doneAt))}` : ''}</div>` : ''}
        </div>
        <button class="readiness-remove" onclick="removeProductionChecklistRow(${i})" title="Remove row" aria-label="Remove readiness row">×</button>
        <input type="hidden" data-ps-row="${i}" data-ps-field="area" value="${esc(row.area||'')}">
        <input type="hidden" data-ps-row="${i}" data-ps-field="hint" value="${esc(row.hint||'')}">
        <input type="hidden" data-ps-row="${i}" data-ps-field="doneBy" value="${esc(row.doneBy||'')}">
        <input type="hidden" data-ps-row="${i}" data-ps-field="doneAt" value="${esc(String(row.doneAt||0))}">
      </div>
    `).join('')}
    <button class="call-add-btn" onclick="addProductionChecklistRow()">${sfIcon('action.add')}<span>Add checklist item</span></button>
  </div>`;
}

function addProductionChecklistRow() {
  const current = getProductionScheduleData();
  current.checklist.push({ area:'', item:'', hint:'', done:false });
  renderProductionChecklist(current.checklist);
}

// Checking a readiness item records WHO signed it off and WHEN, then syncs to the
// whole session — so the checklist is accountable, not just a personal tick box.
function onProductionChecklistToggle(cb) {
  const idx = Number(cb?.dataset?.psRow);
  if (!Number.isFinite(idx)) return;
  const byEl = document.querySelector(`[data-ps-row="${idx}"][data-ps-field="doneBy"]`);
  const atEl = document.querySelector(`[data-ps-row="${idx}"][data-ps-field="doneAt"]`);
  if (cb.checked) {
    if (byEl) byEl.value = preProActor();
    if (atEl) atEl.value = String(Date.now());
  } else {
    if (byEl) byEl.value = '';
    if (atEl) atEl.value = '0';
  }
  saveProductionSchedule(false);                                  // persist + broadcast to the session
  renderProductionChecklist(getProductionScheduleData().checklist); // show the sign-off line
}

function removeProductionChecklistRow(idx) {
  const current = getProductionScheduleData();
  current.checklist.splice(idx, 1);
  renderProductionChecklist(current.checklist.length ? current.checklist : [{ area:'', item:'', hint:'', done:false }]);
}

function getProductionScheduleData() {
  const rows = [];
  document.querySelectorAll('[data-ps-row]').forEach(input => {
    const idx = Number(input.dataset.psRow);
    const field = input.dataset.psField;
    if (!rows[idx]) rows[idx] = {};
    rows[idx][field] = field === 'done' ? input.checked : input.value.trim();
  });
  return {
    setupNA: document.getElementById('ps-setup-na')?.classList.contains('on') || false,
    date: document.getElementById('ps-date')?.value || '',
    showDate: document.getElementById('ps-show-date')?.value || '',
    setup: timeInputValue('ps-setup'),
    call: timeInputValue('ps-call'),
    show: timeInputValue('ps-show'),
    wrap: timeInputValue('ps-wrap'),
    doors: document.getElementById('ps-doors')?.value?.trim() || '',
    location: document.getElementById('ps-location')?.value?.trim() || '',
    address: document.getElementById('ps-address')?.value?.trim() || '',
    setupNotes: document.getElementById('ps-setup-notes')?.value || '',
    showNotes: document.getElementById('ps-show-notes')?.value || '',
    checklist: rows.map(normalizeProductionChecklistRow).filter(row => row && (row.area || row.item || row.done)),
  };
}

function saveProductionSchedule(showToastOnSave=true) {
  persistPreProData({ productionSchedule: getProductionScheduleData() }, 'Production Schedule');
  if (showToastOnSave) toast('Production schedule saved.');
}

function productionScheduleHTML(schedule) {
  const s = productionScheduleWithCallSheet(schedule || {}, loadPreProData());
  const rows = (s.checklist || []).map(normalizeProductionChecklistRow).map(row => `<tr><td>${row.done ? 'Yes' : 'No'}</td><td>${esc(row.item || '')}</td><td>${row.done && row.doneBy ? esc(row.doneBy) + (row.doneAt ? ` (${esc(new Date(row.doneAt).toLocaleString())})` : '') : '—'}</td></tr>`).join('');
  const setupBody = s.setupNA
    ? `<tr><td>No separate setup day — setup happens on show day.</td></tr>`
    : `<tr><th>Setup Date</th><td>${esc(s.date || '')}</td></tr>
      <tr><th>Setup Start</th><td>${esc(s.setup || '')}</td></tr>
      <tr><th>Setup Wrap</th><td>${esc(s.wrap || '')}</td></tr>
      <tr><th>Setup Notes</th><td>${esc(s.setupNotes || '')}</td></tr>`;
  return `
    <h1>2. Production Schedule</h1>
    <h2>Setup Day${s.setupNA ? ' — N/A' : ''}</h2>
    <table><tbody>
      ${setupBody}
    </tbody></table>
    <h2>Show Day</h2>
    <table><tbody>
      <tr><th>Show Day</th><td>${esc(s.showDate || s.date || '')}</td></tr>
      <tr><th>Crew Call</th><td>${esc(s.call || '')}</td></tr>
      <tr><th>Doors Open</th><td>${esc(s.doors || '')}</td></tr>
      <tr><th>Show Start</th><td>${esc(s.show || '')}</td></tr>
      <tr><th>Location</th><td>${esc(s.location || '')}</td></tr>
      <tr><th>Address</th><td>${esc(s.address || '')}</td></tr>
      <tr><th>Show Notes</th><td>${esc(s.showNotes || '')}</td></tr>
    </tbody></table>
    <h2>Ready Before Show</h2>
    <table><thead><tr><th>Ready</th><th>Checklist Item</th><th>Signed Off By</th></tr></thead><tbody>${rows || '<tr><td colspan="3">No checklist rows.</td></tr>'}</tbody></table>`;
}

function showProductionSchedulePreview() {
  const schedule = getProductionScheduleData();
  saveProductionSchedule(false);
  showPaperPreview('Production Schedule Preview', productionScheduleHTML(schedule), 'Back to Editor', "hideModal('paperPreviewModal');openProductionSchedule()", 'production-scheduler');
}

function defaultPatchRows(kind) {
  if (kind === 'comms') return [{ position:'', out:'', gear:'', notes:'' }];
  return [{ label:'', destination:'', source:'', cabling:'', notes:'' }];
}

function getPatchRows(kind) {
  const data = loadPreProData();
  const key = `${kind}PatchRows`;
  return Array.isArray(data[key]) && data[key].length ? data[key] : defaultPatchRows(kind);
}

function patchInput(value, kind, row, field) {
  const id = `pb-patch-${kind}-${row}-${field}`;
  const label = `${kind === 'comms' ? 'Comms' : kind === 'audio' ? 'Audio' : 'Video'} row ${Number(row) + 1} ${field}`;
  return `<input id="${esc(id)}" class="field-in" data-patch-kind="${kind}" data-patch-row="${row}" data-patch-field="${field}" value="${esc(value || '')}" placeholder="${field === 'label' ? 'Label' : field}" aria-label="${esc(label)}">`;
}

function renderPatchTable(kind, title) {
  const rows = getPatchRows(kind);
  const isComms = kind === 'comms';
  const heads = isComms ? ['Position','Out','Gear','Notes'] : ['Label','Destination','Source','Cabling','Notes'];
  return `
    <div class="field">
      <label class="field-lbl">${title}</label>
      <div class="field-hint">Type directly in the first row. Use Add row for another line, or import a CSV/TSV.</div>
      <div class="patch-table ${isComms ? 'comms' : kind}" id="${kind}-patch-table">
        ${heads.map(h => `<div class="patch-head">${h}</div>`).join('')}<div></div>
        ${rows.map((row,i) => isComms ? `
          ${patchInput(row.position, kind, i, 'position')}
          ${patchInput(row.out, kind, i, 'out')}
          ${patchInput(row.gear, kind, i, 'gear')}
          ${patchInput(row.notes, kind, i, 'notes')}
          <button class="patch-remove" onclick="removePatchRow('${kind}',${i})">x</button>
        ` : `
          ${patchInput(row.label, kind, i, 'label')}
          ${patchInput(row.destination, kind, i, 'destination')}
          ${patchInput(row.source, kind, i, 'source')}
          ${patchInput(row.cabling, kind, i, 'cabling')}
          ${patchInput(row.notes, kind, i, 'notes')}
          <button class="patch-remove" onclick="removePatchRow('${kind}',${i})">x</button>
        `).join('')}
      </div>
      <button class="call-add-btn" onclick="addPatchRow('${kind}')">${sfIcon('action.add')}<span>Add row</span></button>
      <label class="patch-upload-btn">${sfIcon('action.upload')}<span>Import CSV/TSV</span><input type="file" accept=".csv,.tsv,.txt" onchange="importPatchRows('${kind}',this)" hidden></label>
    </div>`;
}

function collectPatchRows(kind, keepBlank=false) {
  const rows = [];
  document.querySelectorAll(`[data-patch-kind="${kind}"]`).forEach(input => {
    const idx = Number(input.dataset.patchRow);
    const field = input.dataset.patchField;
    if (!rows[idx]) rows[idx] = {};
    rows[idx][field] = input.value.trim();
  });
  return keepBlank ? rows.filter(Boolean) : rows.filter(row => Object.values(row).some(Boolean));
}

function patchSectionForKind(kind) {
  return kind === 'video' ? 'Video Patch' : 'Audio & Comms Patch';
}

function savePatchRowsBatch(rowsByKind, section) {
  const patch = {};
  Object.entries(rowsByKind || {}).forEach(([kind, rows]) => {
    patch[`${kind}PatchRows`] = Array.isArray(rows) && rows.length ? rows : defaultPatchRows(kind);
  });
  if (Object.keys(patch).length) persistPreProData(patch, section);
}

function savePatchRows(kind, rows) {
  savePatchRowsBatch({ [kind]: rows }, patchSectionForKind(kind));
}

function patchEditorKinds(fallbackKind='') {
  const mode = activePatchKind || fallbackKind;
  return mode === 'video' ? ['video'] : ['audio', 'comms'];
}

function saveVisiblePatchRows(overrides={}, fallbackKind='') {
  const rowsByKind = {};
  patchEditorKinds(fallbackKind).forEach(kind => {
    rowsByKind[kind] = Object.prototype.hasOwnProperty.call(overrides, kind)
      ? overrides[kind]
      : collectPatchRows(kind, true);
  });
  savePatchRowsBatch(rowsByKind, patchSectionForKind((activePatchKind || fallbackKind) === 'video' ? 'video' : 'audio'));
}

function openPatchSheetEditor(kind) {
  activePatchKind = kind;
  activePaperworkItemId = kind === 'video' ? 'video-patch' : 'audio-comms-patch';
  hideModal('paperworkHubModal');
  const isVideo = kind === 'video';
  document.getElementById('patchSheetTitle').textContent = isVideo ? 'Video Patch Sheet' : 'Audio and Comms Patch Sheets';
  document.getElementById('patchSheetSub').textContent = 'Add rows manually or upload a CSV/TSV. Imported columns fill left to right.';
  document.getElementById('patchSheetBody').innerHTML = isVideo
    ? renderPatchTable('video', 'Video Patch Sheet')
    : renderPatchTable('audio', 'Audio Patch Sheet') + renderPatchTable('comms', 'Comms Patch Sheet');
  renderPaperworkNav(activePaperworkItemId);
  renderPlandaBearComments(isVideo ? 'Video Patch' : 'Audio & Comms Patch', 'pbCommentsPatch');
  showModal('patchSheetModal');
}

function addPatchRow(kind) {
  const rows = collectPatchRows(kind, true).concat(defaultPatchRows(kind));
  saveVisiblePatchRows({ [kind]: rows }, kind);
  pbRenderPatchBody();
  setTimeout(() => {
    const firstField = kind === 'comms' ? 'position' : 'label';
    document.querySelector(`[data-patch-kind="${kind}"][data-patch-row="${rows.length - 1}"][data-patch-field="${firstField}"]`)?.focus();
  }, 0);
}

function removePatchRow(kind, idx) {
  const rows = collectPatchRows(kind, true);
  rows.splice(idx, 1);
  saveVisiblePatchRows({ [kind]: rows }, kind);
  pbRenderPatchBody();
}

function savePatchSheet(showToastOnSave=true) {
  if (activePatchKind === 'video') {
    savePatchRows('video', collectPatchRows('video'));
    if (showToastOnSave) toast('Video patch sheet saved.');
  } else {
    savePatchRows('audio', collectPatchRows('audio'));
    savePatchRows('comms', collectPatchRows('comms'));
    if (showToastOnSave) toast('Audio and comms patch sheets saved.');
  }
}

function importPatchRows(kind, input) {
  const file = input.files && input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    const lines = String(reader.result || '').split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    // Drop a header row if the first line's first cell is a known column name.
    if (lines.length) {
      const first = (lines[0].split(/[\t,]/)[0] || '').trim().toLowerCase();
      const headerCells = kind === 'comms' ? ['position','pos'] : ['label','name'];
      if (headerCells.includes(first)) lines.shift();
    }
    const rows = lines.map(line => {
      const cols = line.includes('\t') ? line.split('\t') : line.split(',');
      if (kind === 'comms') return { position:cols[0]||'', out:cols[1]||'', gear:cols[2]||'', notes:cols.slice(3).join(', ')||'' };
      return { label:cols[0]||'', destination:cols[1]||'', source:cols[2]||'', cabling:cols[3]||'', notes:cols.slice(4).join(', ')||'' };
    });
    saveVisiblePatchRows({ [kind]: rows }, kind);
    openPatchSheetEditor(activePatchKind || kind);
    toast('Patch rows imported.');
  };
  reader.readAsText(file);
}

function patchTableHTML(kind, title) {
  const rows = getPatchRows(kind).filter(row => Object.values(row).some(Boolean));
  const isComms = kind === 'comms';
  const body = rows.map(row => isComms
    ? `<tr><td>${esc(row.position || '')}</td><td>${esc(row.out || '')}</td><td>${esc(row.gear || '')}</td><td>${esc(row.notes || '')}</td></tr>`
    : `<tr><td>${esc(row.label || '')}</td><td>${esc(row.destination || '')}</td><td>${esc(row.source || '')}</td><td>${esc(row.cabling || '')}</td><td>${esc(row.notes || '')}</td></tr>`
  ).join('');
  return `<h2>${title}</h2><table><thead><tr>${isComms ? '<th>Position</th><th>Out</th><th>Gear</th><th>Notes</th>' : '<th>Label</th><th>Destination</th><th>Source</th><th>Cabling</th><th>Notes</th>'}</tr></thead><tbody>${body || `<tr><td colspan="${isComms ? 4 : 5}">No rows saved yet.</td></tr>`}</tbody></table>`;
}

function showPatchSheetPaperPreview(kind=activePatchKind || 'video') {
  savePatchSheet(false);
  if (kind === 'video') {
    showPaperPreview('Video Patch Sheet Preview', `
      <h1>5. Video Patch Sheet</h1>
      ${patchTableHTML('video', 'Video Patch Sheet')}
    `, 'Back to Editor', "hideModal('paperPreviewModal');openPatchSheetEditor('video')", 'video-patch');
    return;
  }
  showPaperPreview('Audio and Comms Patch Sheet Preview', `
    <h1>6. Audio and Comms Patch Sheets</h1>
    ${patchTableHTML('audio', 'Audio Patch Sheet')}
    ${patchTableHTML('comms', 'Comms Patch Sheet')}
  `, 'Back to Editor', "hideModal('paperPreviewModal');openPatchSheetEditor('audio-comms')", 'audio-comms-patch');
}

// Production Notes are a working discussion board, not deliverable paperwork —
// so they're EXCLUDED from the exported package unless the user opts in here.
let pbPackageIncludeNotes = false;
function showPreProPackagePreview() {
  loadPlandaBearNotes().then(() => {
    showPaperPreview('PDF Package Preview', preProPackageHTML(), 'Export PDF Package', 'exportPreProPackagePDF()', null);
  });
}
function pbTogglePackageNotes(on) {
  pbPackageIncludeNotes = !!on;
  const body = document.getElementById('paperPreviewBody');
  if (body) body.innerHTML = preProPackageHTML();
}

function preProPackageHTML(forExport=false) {
  const data = loadPreProData();
  const safety = data.safety || {};
  const schedule = productionScheduleWithCallSheet(data.productionSchedule || {}, data);
  const callSheets = getCallSheets(data);
  const callSheetSections = callSheets.map((sheet, i) => `
    ${i > 0 ? '<div class="paper-page-break"></div>' : ''}
    <section>${callSheetPreviewHTML(sheet)}</section>
  `).join('');
  const noteCount = plandaBearNotes.length;
  const notesToggle = forExport ? '' : `
    <label class="pb-pkg-optin no-print">
      <input type="checkbox" ${pbPackageIncludeNotes ? 'checked' : ''} onchange="pbTogglePackageNotes(this.checked)">
      <span>Include Production Notes in this package${noteCount ? ` (${noteCount} note${noteCount === 1 ? '' : 's'})` : ''}</span>
    </label>`;
  const notesSection = pbPackageIncludeNotes
    ? `<div class="paper-page-break"></div><section>${productionNotesThreadHTML()}</section>`
    : '';
  return `
    ${notesToggle}
    ${callSheetSections}
    <div class="paper-page-break"></div>
    <section>${productionScheduleHTML(schedule)}</section>
    <div class="paper-page-break"></div>
    <section>${safetyPlanHTML(safety)}</section>
    <div class="paper-page-break"></div>
    <section>
    <h1>4. Full Rendered Rundown</h1>
    <div>${esc(show.name || 'Cueola Rundown')}</div>
    ${rundownPreviewTableHTML()}
    </section>
    <div class="paper-page-break"></div>
    <section>
    <h1>5. Video Patch Sheet</h1>
    ${patchTableHTML('video', 'Video Patch Sheet')}
    </section>
    <div class="paper-page-break"></div>
    <section>
    <h1>6. Audio and Comms Patch Sheets</h1>
    ${patchTableHTML('audio', 'Audio Patch Sheet')}
    ${patchTableHTML('comms', 'Comms Patch Sheet')}
    </section>
    ${notesSection}
  `;
}

async function exportPaperHTMLAsPDF(html, fileName, opts={}) {
  await ptLoadLibrary('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js');
  await ptLoadLibrary('https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js');
  const { jsPDF } = window.jspdf;
  if (!window.html2canvas) throw new Error('html2canvas unavailable');
  const orientation = opts.orientation || (html.includes('paper-landscape') ? 'landscape' : 'portrait');
  const doc = new jsPDF({ unit:'pt', format:'letter', orientation });
  const margin = opts.margin ?? 24;
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const pageInnerW = pageW - margin * 2;
  const pageInnerH = pageH - margin * 2;
  const root = document.createElement('div');
  root.className = 'paper-preview';
  root.style.position = 'fixed';
  root.style.left = '-10000px';
  root.style.top = '0';
  root.style.width = orientation === 'landscape' ? '1120px' : '820px';
  root.style.maxHeight = 'none';
  root.style.overflow = 'visible';
  const pageChunks = html.includes('paper-page-break')
    ? html.split(/<div class="paper-page-break"><\/div>|<div class="paper-page-break">\s*<\/div>/i).map(chunk => chunk.trim()).filter(Boolean)
    : [];
  const renderChunkToPage = async (chunk, pageIndex) => {
    root.innerHTML = chunk;
    await new Promise(resolve => requestAnimationFrame(resolve));
    const canvas = await window.html2canvas(root, { scale:2, backgroundColor:'#ffffff', useCORS:true });
    const ratio = Math.min(pageInnerW / canvas.width, pageInnerH / canvas.height);
    const drawW = canvas.width * ratio;
    const drawH = canvas.height * ratio;
    if (pageIndex > 0) doc.addPage('letter', orientation);
    doc.addImage(canvas.toDataURL('image/png'), 'PNG', margin + (pageInnerW - drawW) / 2, margin, drawW, drawH);
  };
  document.body.appendChild(root);
  try {
    if (pageChunks.length) {
      for (let i = 0; i < pageChunks.length; i++) await renderChunkToPage(pageChunks[i], i);
      doc.save(fileName);
      return;
    }
    root.innerHTML = html;
    const canvas = await window.html2canvas(root, { scale:2, backgroundColor:'#ffffff', useCORS:true });
    const pageCanvas = document.createElement('canvas');
    const pageCtx = pageCanvas.getContext('2d');
    const sliceH = Math.floor(canvas.width * (pageInnerH / pageInnerW));
    pageCanvas.width = canvas.width;
    pageCanvas.height = sliceH;
    let sourceY = 0;
    let page = 0;
    while (sourceY < canvas.height) {
      pageCtx.clearRect(0, 0, pageCanvas.width, pageCanvas.height);
      pageCtx.fillStyle = '#fff';
      pageCtx.fillRect(0, 0, pageCanvas.width, pageCanvas.height);
      pageCtx.drawImage(canvas, 0, sourceY, canvas.width, sliceH, 0, 0, canvas.width, sliceH);
      const imgData = pageCanvas.toDataURL('image/png');
      if (page > 0) doc.addPage('letter', orientation);
      doc.addImage(imgData, 'PNG', margin, margin, pageInnerW, pageInnerH);
      sourceY += sliceH;
      page++;
    }
    doc.save(fileName);
  } finally {
    root.remove();
  }
}

function openPrePro() {
  activePaperworkItemId = 'call-sheet';
  hideModal('paperworkHubModal');
  const data = loadPreProData();
  const sheets = getCallSheets(data);
  activeCallSheetIndex = Math.max(0, Math.min(Number(data.activeCallSheetIndex ?? activeCallSheetIndex) || 0, sheets.length - 1));
  renderCallSheetSelector(sheets);
  hydrateCallSheetForm(sheets[activeCallSheetIndex]);
  renderPaperworkNav('call-sheet');
  renderPlandaBearComments('Call Sheet', 'pbCommentsCallSheet');
  showModal('preProModal');
}

function setDoorsNotApplicable(isNotApplicable) {
  const input = document.getElementById('pp-doors');
  const btn = document.getElementById('pp-doors-na');
  if (!input || !btn) return;
  input.disabled = Boolean(isNotApplicable);
  if (isNotApplicable) input.value = '';
  btn.classList.toggle('on', Boolean(isNotApplicable));
  btn.setAttribute('aria-pressed', isNotApplicable ? 'true' : 'false');
}

function toggleDoorsNotApplicable() {
  const btn = document.getElementById('pp-doors-na');
  setDoorsNotApplicable(!(btn?.classList.contains('on')));
}

function getDoorsOpenValue() {
  if (document.getElementById('pp-doors-na')?.classList.contains('on')) return 'N/A';
  return timeInputValue('pp-doors');
}

window.setDoorsNotApplicable = setDoorsNotApplicable;
window.toggleDoorsNotApplicable = toggleDoorsNotApplicable;
window.getDoorsOpenValue = getDoorsOpenValue;

// Show Start "N/A" (e.g. a setup day with no show) — mirrors the Doors pattern.
function setShowNotApplicable(isNA) {
  const input = document.getElementById('pp-show-start');
  const btn = document.getElementById('pp-show-na');
  if (!input || !btn) return;
  input.disabled = Boolean(isNA);
  if (isNA) input.value = '';
  btn.classList.toggle('on', Boolean(isNA));
  btn.setAttribute('aria-pressed', isNA ? 'true' : 'false');
}
function toggleShowNotApplicable() {
  setShowNotApplicable(!document.getElementById('pp-show-na')?.classList.contains('on'));
}
function getShowStartValue() {
  if (document.getElementById('pp-show-na')?.classList.contains('on')) return 'N/A';
  return timeInputValue('pp-show-start');
}

// Estimated Wrap, also with an "N/A" option.
function setWrapNotApplicable(isNA) {
  const input = document.getElementById('pp-wrap');
  const btn = document.getElementById('pp-wrap-na');
  if (!input || !btn) return;
  input.disabled = Boolean(isNA);
  if (isNA) input.value = '';
  btn.classList.toggle('on', Boolean(isNA));
  btn.setAttribute('aria-pressed', isNA ? 'true' : 'false');
}
function toggleWrapNotApplicable() {
  setWrapNotApplicable(!document.getElementById('pp-wrap-na')?.classList.contains('on'));
}
function getWrapValue() {
  if (document.getElementById('pp-wrap-na')?.classList.contains('on')) return 'N/A';
  return timeInputValue('pp-wrap');
}

window.setShowNotApplicable = setShowNotApplicable;
window.toggleShowNotApplicable = toggleShowNotApplicable;
window.setWrapNotApplicable = setWrapNotApplicable;
window.toggleWrapNotApplicable = toggleWrapNotApplicable;

// Production Schedule — "N/A" for the whole Setup Day (setup happens on show day,
// or on a different day tracked elsewhere). Disables and clears the setup fields.
function setSetupNotApplicable(isNA) {
  isNA = Boolean(isNA);
  const btn = document.getElementById('ps-setup-na');
  if (btn) { btn.classList.toggle('on', isNA); btn.setAttribute('aria-pressed', isNA ? 'true' : 'false'); }
  ['ps-date','ps-setup','ps-wrap','ps-setup-notes'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.disabled = isNA;
    if (isNA) el.value = '';
  });
}
function toggleSetupNotApplicable() {
  setSetupNotApplicable(!document.getElementById('ps-setup-na')?.classList.contains('on'));
  paperworkDirty = true;
}
window.setSetupNotApplicable = setSetupNotApplicable;
window.toggleSetupNotApplicable = toggleSetupNotApplicable;

function getPreProData() {
  const existing = loadPreProData();
  const sheets = getCallSheets(existing);
  activeCallSheetIndex = Math.max(0, Math.min(activeCallSheetIndex, sheets.length - 1));
  const active = currentCallSheetFromForm();
  sheets[activeCallSheetIndex] = active;
  return {
    ...active,
    callSheets: sheets,
    activeCallSheetIndex,
    updatedAt: Date.now(),
  };
}

function saveCallSheet(showToastOnSave=true) {
  persistPreProData(getPreProData(), 'Call Sheet');
  applyPlandaShowStartToRundown();
  if (showToastOnSave) toast('Call sheet saved.');
}

// Planda Bear's Call Sheet "Show Start" is the source of truth for the rundown
// start time — keep the build/settings start in sync whenever it's set there.
function applyPlandaShowStartToRundown() {
  const raw = (typeof getShowStartValue === 'function') ? getShowStartValue() : '';
  if (!raw || raw === 'N/A') return;
  const norm = normalizeTimeValue(raw);
  if (!norm || norm === show.start) return;
  show.start = norm;
  const setInput = document.getElementById('set-starttime');
  if (setInput) setTimeInputValue('set-starttime', show.start);
  if (document.getElementById('rundown')?.classList.contains('on')) renderRundown();
  syncToFirestore();
}

function savePrePro() {
  saveCallSheet();
}

function syncCallSheetPeopleFromDOM() {
  callSheetPeople = Array.from(document.querySelectorAll('.call-person-row')).map(row => ({
    name: row.querySelector('[data-call-field="name"]')?.value?.trim() || '',
    position: row.querySelector('[data-call-field="position"]')?.value?.trim() || '',
    email: row.querySelector('[data-call-field="email"]')?.value?.trim() || '',
    phone: row.querySelector('[data-call-field="phone"]')?.value?.trim() || '',
    call: normalizeTimeValue(row.querySelector('[data-call-field="call"]')?.value || ''),
  })).filter(p => p.name || p.position || p.email || p.phone || p.call);
  if (!callSheetPeople.length) callSheetPeople = [{ name:'', position:'', email:'', phone:'', call:'' }];
}

// ── Reorder crew/talent by dragging the grip handle ──────────────────────────
let _callDragFrom = -1;

// Read the rows straight from the DOM in render order (no filtering) so a reorder
// keeps every row, including any the user is mid-typing.
function readCallPeopleRows() {
  return Array.from(document.querySelectorAll('#pp-crew-grid .call-person-row')).map(row => ({
    name: row.querySelector('[data-call-field="name"]')?.value || '',
    position: row.querySelector('[data-call-field="position"]')?.value || '',
    email: row.querySelector('[data-call-field="email"]')?.value || '',
    phone: row.querySelector('[data-call-field="phone"]')?.value || '',
    call: normalizeTimeValue(row.querySelector('[data-call-field="call"]')?.value || ''),
  }));
}

function moveCallSheetPerson(from, to) {
  const people = readCallPeopleRows();
  if (from < 0 || from >= people.length || to < 0 || to >= people.length || from === to) return;
  const [moved] = people.splice(from, 1);
  people.splice(to, 0, moved);
  callSheetPeople = people;
  renderCallSheetPeople();
}

// Which row index the pointer is currently over (the drop position).
function callDropIndex(clientY) {
  const handles = Array.from(document.querySelectorAll('#pp-crew-grid .call-drag-handle'));
  for (let i = 0; i < handles.length; i++) {
    const r = handles[i].getBoundingClientRect();
    if (clientY < r.top + r.height / 2) return i;
  }
  return handles.length - 1;
}

// Pointer-based drag so reordering works with a mouse, a trackpad, AND touch
// (iPad/phone) — HTML5 drag-and-drop does not fire on touchscreens.
function callPointerMove(e) {
  if (_callDragFrom < 0) return;
  e.preventDefault();
  const target = callDropIndex(e.clientY);
  document.querySelectorAll('#pp-crew-grid .call-person-row').forEach((row, i) => {
    row.classList.toggle('drag-target', i === target && i !== _callDragFrom);
  });
}

function callPointerUp(e) {
  const handle = e.currentTarget;
  handle.removeEventListener('pointermove', callPointerMove);
  handle.removeEventListener('pointerup', callPointerUp);
  handle.removeEventListener('pointercancel', callPointerUp);
  if (_callDragFrom < 0) return;
  const from = _callDragFrom;
  const to = callDropIndex(e.clientY);
  _callDragFrom = -1;
  document.querySelectorAll('#pp-crew-grid .call-person-row').forEach(row => row.classList.remove('dragging', 'drag-target'));
  moveCallSheetPerson(from, to);
}

function callPointerDown(e, idx) {
  if (e.button != null && e.button > 0) return; // primary button / touch only
  e.preventDefault();
  _callDragFrom = idx;
  const handle = e.currentTarget;
  try { handle.setPointerCapture(e.pointerId); } catch {}
  handle.closest('.call-person-row')?.classList.add('dragging');
  handle.addEventListener('pointermove', callPointerMove);
  handle.addEventListener('pointerup', callPointerUp);
  handle.addEventListener('pointercancel', callPointerUp);
}

function renderCallSheetPeople() {
  const grid = document.getElementById('pp-crew-grid');
  if (!grid) return;
  const rows = callSheetPeople.length ? callSheetPeople : [{ name:'', position:'', email:'', phone:'', call:'' }];
  grid.innerHTML = `
    <div class="call-grid-head call-grid-head-grip"></div>
    <div class="call-grid-head">Name</div>
    <div class="call-grid-head">Position</div>
    <div class="call-grid-head">Email</div>
    <div class="call-grid-head">Phone</div>
    <div class="call-grid-head">Call</div>
    <div class="call-grid-head"></div>
    ${rows.map((p,i)=>`
      <div class="call-person-row" data-idx="${i}" style="display:contents">
        <div class="call-drag-handle" onpointerdown="callPointerDown(event, ${i})" title="Drag to reorder" aria-label="Drag to reorder">⠿</div>
        <input class="field-in" data-call-field="name" value="${esc(p.name||'')}" placeholder="Name" oninput="syncCallSheetPeopleFromDOM()">
        <input class="field-in" data-call-field="position" value="${esc(p.position||p.role||'')}" placeholder="Position" oninput="syncCallSheetPeopleFromDOM()">
        <input class="field-in" data-call-field="email" value="${esc(p.email||'')}" placeholder="Email" oninput="syncCallSheetPeopleFromDOM()">
        <input class="field-in" data-call-field="phone" value="${esc(p.phone||'')}" placeholder="Phone" oninput="syncCallSheetPeopleFromDOM()">
        <input class="field-in" data-call-field="call" type="time" value="${esc(normalizeTimeValue(p.call)||'')}" oninput="syncCallSheetPeopleFromDOM()">
        <button class="call-row-remove" onclick="removeCallSheetPerson(${i})" title="Remove person">x</button>
      </div>`).join('')}`;
}

function addCallSheetPerson() {
  syncCallSheetPeopleFromDOM();
  // New crew/talent default to the sheet's overall call time (editable per person).
  callSheetPeople.push({ name:'', position:'', email:'', phone:'', call:timeInputValue('pp-call') });
  renderCallSheetPeople();
}

function removeCallSheetPerson(idx) {
  // Read rows unfiltered in DOM order — syncCallSheetPeopleFromDOM drops blank
  // rows, which shifts indices and would delete the wrong person.
  const rows = readCallPeopleRows();
  rows.splice(idx, 1);
  callSheetPeople = rows.length ? rows : [{ name:'', position:'', email:'', phone:'', call:'' }];
  renderCallSheetPeople();
}

async function downloadCallSheetPDF() {
  const data = getCallSheetExportData();
  const fileName = `${cleanPdfName(callSheetTitle(data), 'cueola-call-sheet')}.pdf`;
  try {
    await exportPaperHTMLAsPDF(callSheetPreviewHTML(data), fileName);
    toast('Call sheet PDF downloaded.');
    return;
  } catch (htmlErr) {
    console.warn('Call sheet rendered PDF export failed; falling back to text PDF:', htmlErr);
  }
  try {
    await ptLoadLibrary('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js');
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit:'pt', format:'letter' });
    const margin = 42;
    const pageW = doc.internal.pageSize.getWidth();
    const pageH = doc.internal.pageSize.getHeight();
    let y = margin;
    const add = (label, value, size=10) => {
      doc.setFont('helvetica', label ? 'bold' : 'normal');
      doc.setFontSize(size);
      const prefix = label ? `${label}: ` : '';
      const lines = doc.splitTextToSize(prefix + (value || '-'), pageW - margin * 2);
      lines.forEach(line => {
        if (y > pageH - margin) { doc.addPage(); y = margin; }
        doc.text(line, margin, y);
        y += size + 6;
      });
      y += label ? 2 : 8;
    };
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(20);
    doc.text(callSheetTitle(data), margin, y);
    y += 28;
    add('Production', data.production, 12);
    add('Date', data.date, 10);
    add('Call Time', data.call, 10);
    add('Doors Open', data.doors, 10);
    add('Show Start', data.showStart, 10);
    add('Location', data.location, 10);
    add('Address', data.address, 10);
    add('Venue', venueLabel(data.venue), 10);
    add('Weather', weatherSummaryLine(data.weather), 10);
    add('Parking', data.parking, 10);
    add('Entrance', data.entrance, 10);
    add('Late / Lost Contact', data.late, 10);
    add('Stream Information', data.stream, 10);
    add('Dress Code', data.dress, 10);
    add('Meals Provided', data.meals, 10);
    y += 8;
    const people = (data.people || []).filter(p => p.name || p.position || p.role || p.email || p.phone || p.call);
    add('Crew / Talent', people.map(p => [p.name, p.position || p.role, p.email, p.phone, p.call].filter(Boolean).join(' - ')).join('\n'), 10);
    add('General Notes', data.notes, 10);
    doc.save(fileName);
    toast('Call sheet PDF downloaded.');
  } catch {
    const area = document.getElementById('printArea');
    if (area) area.innerHTML = `<div class="paper-preview">${callSheetPreviewHTML(data)}</div>`;
    toast('PDF library unavailable. Opening print dialog instead.');
    window.print();
  }
}

async function exportPreProPackagePDF() {
  try {
    if (document.getElementById('preProModal')?.classList.contains('on')) persistPreProData(getPreProData(), 'Call Sheet');
    if (document.getElementById('safetyPlanModal')?.classList.contains('on')) persistPreProData({ safety: getSafetyPlanData() }, 'Safety Plan');
    if (document.getElementById('patchSheetModal')?.classList.contains('on')) savePatchSheet(false);
    if (document.getElementById('productionScheduleModal')?.classList.contains('on')) persistPreProData({ productionSchedule: getProductionScheduleData() }, 'Production Schedule');
    await loadPlandaBearNotes();
    const dataForName = loadPreProData();
    const cleanPreviewName = (dataForName.production || show.name || 'cueola-plandabear-package').replace(/[^\w\-]+/g,'-').replace(/-+/g,'-').replace(/^-|-$/g,'').toLowerCase() || 'cueola-plandabear-package';
    try {
      await exportPaperHTMLAsPDF(preProPackageHTML(true), `${cleanPreviewName}-plandabear-package.pdf`);
      toast('Planda Bear package PDF downloaded.');
      return;
    } catch (htmlErr) {
      console.warn('Preview-matched PDF export failed; falling back to text PDF:', htmlErr);
    }
    await ptLoadLibrary('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js');
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit:'pt', format:'letter' });
    const margin = 36;
    const pageW = doc.internal.pageSize.getWidth();
    const pageH = doc.internal.pageSize.getHeight();
    let y = margin;
    const data = loadPreProData();
    const safety = data.safety || {};
    const schedule = productionScheduleWithCallSheet(data.productionSchedule || {}, data);
    const cleanFileName = (data.production || show.name || 'cueola-plandabear-package').replace(/[^\w\-]+/g,'-').replace(/-+/g,'-').replace(/^-|-$/g,'').toLowerCase() || 'cueola-plandabear-package';
    const newPage = () => { doc.addPage(); y = margin; };
    const line = (txt, size=9, bold=false, color=[25,25,25]) => {
      doc.setFont('helvetica', bold ? 'bold' : 'normal');
      doc.setFontSize(size);
      doc.setTextColor(...color);
      const chunks = doc.splitTextToSize(String(txt || '-'), pageW - margin * 2);
      chunks.forEach(chunk => {
        if (y > pageH - margin) newPage();
        doc.text(chunk, margin, y);
        y += size + 5;
      });
    };
    const section = title => {
      if (y > margin + 6) newPage();
      line(title, 18, true);
      line(`Session ${session.code || 'local'} | Exported ${new Date().toLocaleString()}`, 8, false, [95,95,95]);
      y += 8;
    };
    const field = (label, value) => line(`${label}: ${value || '-'}`, 10, Boolean(label));
    const tableRows = (headers, rows) => {
      line(headers.join(' | '), 8, true, [50,70,100]);
      rows.forEach(row => line(row.map(v => v || '-').join(' | '), 8));
      y += 8;
    };

    getCallSheets(data).forEach(sheet => {
      section(callSheetTitle(sheet));
      field('Production', sheet.production || show.name || '');
      field('Shoot Date', sheet.date || '');
      field('Call Time', sheet.call || '');
      field('Doors Open', sheet.doors || '');
      field('Show Start', sheet.showStart || '');
      field('Location', sheet.location || '');
      field('Address', sheet.address || '');
      field('Parking', sheet.parking || '');
      field('Entrance', sheet.entrance || '');
      field('Late / Lost Contact', sheet.late || '');
      field('Stream Information', sheet.stream || '');
      field('Dress Code', sheet.dress || '');
      field('Meals Provided', sheet.meals || '');
      const people = (sheet.people || []).filter(p => p.name || p.role || p.position || p.email || p.phone || p.call);
      tableRows(['Name','Position','Email','Phone','Call'], people.length ? people.map(p => [p.name, p.position || p.role, p.email, p.phone, p.call]) : [['No crew or talent entered yet','','','','']]);
      field('General Notes', sheet.notes || '');
    });

    section('2. Production Schedule');
    line(schedule.setupNA ? 'Setup Day — N/A' : 'Setup Day', 12, true, [50,70,100]);
    if (schedule.setupNA) {
      field('Setup', 'No separate setup day — setup happens on show day.');
    } else {
      field('Setup Date', schedule.date || '');
      field('Setup Start', schedule.setup || '');
      field('Setup Wrap', schedule.wrap || '');
      field('Setup Notes', schedule.setupNotes || '');
    }
    line('Show Day', 12, true, [50,70,100]);
    field('Show Day', schedule.showDate || schedule.date || '');
    field('Crew Call', schedule.call || '');
    field('Doors Open', schedule.doors || '');
    field('Show Start', schedule.show || '');
    field('Location', schedule.location || '');
    field('Address', schedule.address || '');
    field('Show Notes', schedule.showNotes || '');
    line('Ready Before Show', 12, true, [50,70,100]);
    tableRows(['Ready','Checklist Item','Signed Off By'], (schedule.checklist || []).map(normalizeProductionChecklistRow).map(row => [row.done ? 'Yes' : 'No', row.item, row.done && row.doneBy ? `${row.doneBy}${row.doneAt ? ` (${new Date(row.doneAt).toLocaleDateString()})` : ''}` : '—']));

    section('3. Safety Plan');
    ['hospital','weather','firstAid','fire','emergency','nonemergency','security','late','equipment','notes'].forEach(key => {
      const labels = { hospital:'Local Hospital', weather:'Weather', firstAid:'First Aid Kit Location', fire:'Fire Extinguisher Location', emergency:'Emergency Numbers', nonemergency:'Non-Emergency Numbers', security:'Security', late:'Late / Lost Contact', equipment:'Equipment Needed', notes:'Safety Notes' };
      field(labels[key], safety[key] || '');
    });

    section('4. Full Rendered Rundown');
    let offsetSecs = 0;
    beats.forEach((b, i) => {
      const startStr = show.start ? clock(show.start, offsetSecs) : '-';
      offsetSecs += (b.min||0)*60+(b.sec||0);
      line(`${i+1}. ${b.info || '-'}`, 11, true);
      line(`${b.style === 'timed' ? 'Timed' : 'Flex'} | Start ${startStr} | Dur ${fmtDur(b)}`, 8, false, [90,90,90]);
      if (b.notes) line(`Notes: ${b.notes}`, 8);
      COL_DEFAULTS.forEach(type => {
        const d = b.cues?.[type];
        const on = getCueOn(d), off = getCueOff(d);
        const script = type === 'script' && d?.text ? cleanPrompterText(d.text) : '';
        if (!on && !off && !script) return;
        line(`${CT[type].label}: ${[on ? `ON ${on}` : '', off ? `OFF ${off}` : ''].filter(Boolean).join(' | ')}`, 8, true, [45,75,110]);
        if (script) line(script, 8);
      });
      y += 6;
    });

    section('5. Video Patch Sheet');
    tableRows(['Label','Destination','Source','Cabling','Notes'], getPatchRows('video').filter(r => Object.values(r).some(Boolean)).map(r => [r.label, r.destination, r.source, r.cabling, r.notes]));

    section('6. Audio and Comms Patch Sheets');
    line('Audio Patch Sheet', 12, true);
    tableRows(['Label','Destination','Source','Cabling','Notes'], getPatchRows('audio').filter(r => Object.values(r).some(Boolean)).map(r => [r.label, r.destination, r.source, r.cabling, r.notes]));
    line('Comms Patch Sheet', 12, true);
    tableRows(['Position','Out','Gear','Notes'], getPatchRows('comms').filter(r => Object.values(r).some(Boolean)).map(r => [r.position, r.out, r.gear, r.notes]));

    section('7. Production Notes');
    const noteThreads = pbBuildThreads().sort((a,b)=>(a.root.at||0)-(b.root.at||0));
    if (noteThreads.length) {
      const meta = n => `${n.at ? new Date(n.at).toLocaleString() : ''} | ${n.by}${n.role === 'instructor' ? ' (Instructor)' : ''} | ${pbTagLabel(n)}${n.pinned ? ' | Pinned' : ''}`;
      noteThreads.forEach(t => {
        line(meta(t.root), 8, true, [50,70,100]);
        line(pbStripMarkdown(t.root.text), 9);
        t.replies.forEach(r => {
          line(`    ↩ ${meta(r)}`, 8, true, [50,70,100]);
          line(`    ${pbStripMarkdown(r.text)}`, 9);
        });
        y += 4;
      });
    } else {
      line('No production notes yet.', 9);
    }

    doc.save(`${cleanFileName}-plandabear-package.pdf`);
    toast('Planda Bear package PDF downloaded.');
  } catch {
    toast('Could not export the Planda Bear package.');
  }
}

// ─────────────────────────────────────────────────────────────
// PDF EXPORT
// ─────────────────────────────────────────────────────────────
async function exportPDF() {
  try {
    const cleanFileName = `${(show.name || 'cueola-rundown').replace(/[^\w\-]+/g,'-').replace(/-+/g,'-').replace(/^-|-$/g,'').toLowerCase() || 'cueola-rundown'}.pdf`;
    try {
      await exportPaperHTMLAsPDF(`
        <h1>${esc(show.name || 'Cueola Rundown')}</h1>
        <div>Full rendered rundown${session.code ? ` · Session ${esc(session.code)}` : ''}</div>
        <h2>Rundown</h2>
        ${rundownPreviewTableHTML()}
      `, cleanFileName, { orientation:'landscape', margin:18 });
      toast('PDF downloaded.');
      return;
    } catch (htmlErr) {
      console.warn('Preview-matched PDF export failed; falling back to table PDF:', htmlErr);
    }
    await ptLoadLibrary('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js');
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit:'pt', format:'letter', orientation:'landscape' });
    const margin = 28;
    const pageW = doc.internal.pageSize.getWidth();
    const pageH = doc.internal.pageSize.getHeight();
    let offsetSecs = 0;
    const cueColors = {
      video:[91,141,248], audio:[34,211,160], playback:[240,82,82],
      gfx:[245,183,49], lighting:[176,110,248], script:[34,211,211],
    };
    const columns = [
      { key:'num', label:'#', w:24 },
      { key:'row', label:'Row', w:128 },
      { key:'start', label:'Start', w:52 },
      { key:'dur', label:'Dur', w:42 },
      ...COL_DEFAULTS.map(t => ({ key:t, label:CT[t].label, w:t==='script'?118:96 })),
    ];
    const tableW = columns.reduce((sum,c)=>sum+c.w,0);
    const scale = Math.min(1, (pageW - margin*2) / tableW);
    columns.forEach(c => c.sw = c.w * scale);
    let y = margin;
    const title = () => {
      doc.setFont('helvetica','bold'); doc.setFontSize(16); doc.setTextColor(20,24,35);
      doc.text(show.name || 'Cueola Rundown', margin, y);
      doc.setFont('helvetica','normal'); doc.setFontSize(7); doc.setTextColor(95,100,115);
      doc.text(`Exported ${new Date().toLocaleString()}${session.code ? ` | Session ${session.code}` : ''}`, margin, y + 13);
      y += 28;
    };
    const header = () => {
      let x = margin;
      columns.forEach(c => {
        const color = cueColors[c.key] || [225,228,235];
        doc.setFillColor(...(cueColors[c.key] ? color : [238,240,244]));
        doc.setDrawColor(205,210,220);
        doc.rect(x, y, c.sw, 18, 'FD');
        doc.setFont('helvetica','bold'); doc.setFontSize(6.5); doc.setTextColor(cueColors[c.key] ? 255 : 45, cueColors[c.key] ? 255 : 50, cueColors[c.key] ? 255 : 60);
        doc.text(c.label, x + 4, y + 12, { maxWidth:c.sw - 8 });
        x += c.sw;
      });
      y += 18;
    };
    const cueText = (b, type) => {
      const d = b.cues?.[type];
      const on = getCueOn(d), off = getCueOff(d);
      const script = type === 'script' && d?.text ? `Script: ${cleanPrompterText(d.text).slice(0, 220)}` : '';
      return [on ? `ON ${on}` : '', off ? `OFF ${off}` : '', script].filter(Boolean).join('\n') || '-';
    };
    title();
    header();
    beats.forEach((b, i) => {
      const startStr = show.start ? clock(show.start, offsetSecs) : '-';
      offsetSecs += (b.min||0)*60+(b.sec||0);
      const values = {
        num:String(i+1),
        row:[b.info || '-', b.notes || ''].filter(Boolean).join('\n'),
        start:startStr,
        dur:fmtDur(b),
      };
      COL_DEFAULTS.forEach(type => { values[type] = cueText(b,type); });
      const lineSets = columns.map(c => doc.splitTextToSize(String(values[c.key] || '-'), c.sw - 8));
      const rowH = Math.max(28, ...lineSets.map(lines => lines.length * 8 + 10));
      if (y + rowH > pageH - margin) {
        doc.addPage('letter','landscape');
        y = margin;
        title();
        header();
      }
      let x = margin;
      columns.forEach((c, idx) => {
        const color = cueColors[c.key];
        if (color) {
          doc.setFillColor(color[0], color[1], color[2]);
          doc.rect(x, y, 3, rowH, 'F');
        }
        doc.setDrawColor(215,218,226);
        doc.setFillColor(idx % 2 ? 252 : 255, idx % 2 ? 253 : 255, idx % 2 ? 255 : 255);
        doc.rect(x, y, c.sw, rowH, 'S');
        doc.setFont('helvetica', c.key === 'row' ? 'bold' : 'normal');
        doc.setFontSize(c.key === 'row' ? 7.5 : 6.5);
        doc.setTextColor(35,38,48);
        doc.text(lineSets[idx], x + 5, y + 10);
        x += c.sw;
      });
      y += rowH;
    });
    const fileName = `${(show.name || 'cueola-rundown').replace(/[^\w\-]+/g,'-').replace(/-+/g,'-').replace(/^-|-$/g,'').toLowerCase() || 'cueola-rundown'}.pdf`;
    doc.save(fileName);
    toast('PDF downloaded.');
  } catch {
    toast('PDF library unavailable. Opening print dialog instead.');
    window.print();
  }
}

// ─────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────
function esc(s) {
  if (!s) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

// ─────────────────────────────────────────────────────────────
// DEMO DATA
// ─────────────────────────────────────────────────────────────
// Demo rundown — modern multi-cue format. Most rows fire several departments at
// once (that's how the app is used). Each cue reads as Ready (the standby — the
// "on" field) then Take (the go — the "off" field): "Ready one… take one." A hard
// cut is Ready → Take, a soft mix is Set → Dissolve.
const DEMO_BEATS = [
  { id:1, style:'timed', info:'Countdown Slate', notes:'Roll to air', min:0, sec:30, done:false, cues:{
    gfx:   { on:'Ready Countdown',  off:'Take Countdown' },
    audio: { on:'Ready Theme Bed',  off:'Play Theme Bed' },
  }},
  { id:2, style:'timed', info:'Show Open', notes:'Theme up full, under at open', min:0, sec:15, done:false, cues:{
    video: { on:'Set OPEN',        off:'Dissolve OPEN' },
    audio: { on:'Ready Theme Full',off:'Play Theme Full' },
    gfx:   { on:'Ready Title',     off:'Take Title' },
  }},
  { id:3, style:'timed', info:'Anchor Wide — Welcome', notes:'', min:0, sec:20, done:false, cues:{
    video:  { on:'Ready CAM 1',     off:'Take CAM 1' },
    audio:  { on:'Ready Anchor Mics', off:'Open Mics 1+2' },
    script: { on:'Standby Host', off:'Cue Host', text:"Good evening and welcome to Campus News. I'm your anchor — tonight, three big stories from around campus." },
  }},
  { id:4, style:'timed', info:'Anchor Lower Third', notes:'Name / Title', min:0, sec:5, done:false, cues:{
    gfx: { on:'Set Lower Third', off:'Dissolve L3' },
  }},
  { id:5, style:'timed', info:'PKG — Student Council', notes:'Nat sound up full', min:2, sec:15, done:false, cues:{
    video:    { on:'Set FULL SCREEN', off:'Dissolve to PKG' },
    playback: { on:'Ready SC_042',    off:'Roll SC_042' },
    audio:    { on:'Ready PKG Audio', off:'Take PKG SOT' },
  }},
  { id:6, style:'timed', info:'Back to Anchor', notes:'', min:0, sec:10, done:false, cues:{
    video: { on:'Ready CAM 2',      off:'Take CAM 2' },
    audio: { on:'Ready Anchor Mics',off:'Open Mic Host' },
  }},
  { id:7, style:'flex', info:'Guest Conversation', notes:'"What surprised you most?"', min:5, sec:0, done:false, cues:{
    video:  { on:'Set 2-SHOT',    off:'Dissolve 2-SHOT' },
    audio:  { on:'Ready Guest Mic', off:'Open Guest Mic' },
    script: { on:'Standby Host', off:'Cue Host', text:'Guest conversation — ad-lib topic: the student budget vote and what it means for clubs.' },
  }},
  { id:8, style:'timed', info:'Sports Highlight', notes:'', min:1, sec:30, done:false, cues:{
    playback: { on:'Ready SPT_HL', off:'Roll SPT_HL' },
    gfx:      { on:'Ready Scorebug', off:'Take Scorebug' },
  }},
  { id:9, style:'timed', info:'Weather Look-Live', notes:'Chroma key', min:1, sec:0, done:false, cues:{
    video: { on:'Ready CHROMA',    off:'Take CHROMA' },
    gfx:   { on:'Set Weather Map', off:'Dissolve Weather Map' },
    audio: { on:'Ready Talent Mic',off:'Open Talent Mic' },
  }},
  { id:10, style:'timed', info:'Outro & Signoff', notes:'', min:0, sec:45, done:false, cues:{
    video: { on:'Set WIDE',      off:'Dissolve WIDE' },
    gfx:   { on:'Ready Credits', off:'Take Credits' },
    audio: { on:'Ready Theme Out', off:'Play Theme Out' },
  }},
];

// ─────────────────────────────────────────────────────────────
// INIT — auto-join from dashboard or ?code= URL param
// ─────────────────────────────────────────────────────────────
// Seed cache from localStorage immediately (best-effort, before Firebase loads)
// so the login UI is usable even on a slow connection.
_adminsCache = (() => { try { return JSON.parse(localStorage.getItem(ADMIN_KEY))||[]; } catch { return []; } })();
restoreAdminSession();
updateAdminUI();
applyTheme(currentTheme);
applyPlandaBearTheme(plandaBearTheme);
updateTTSButtons();
initTTS();

window.addEventListener('popstate', () => {
  const inSession =
    document.getElementById('rundown')?.classList.contains('on') ||
    document.getElementById('liveshow')?.classList.contains('on') ||
    document.getElementById('promptypus')?.classList.contains('on') ||
    document.getElementById('flowOp')?.classList.contains('on');
  if (!browserBackGuardReady || !inSession) return;
  if (!confirmSaveUnsavedPaperwork()) {
    pushSessionHistoryState(sessionStorage.getItem('cueola_screen') || 'build');
    return;
  }
  if (confirm('Leave this session and return to the front page?')) {
    leaveSessionForFrontPage();
  } else {
    pushSessionHistoryState(sessionStorage.getItem('cueola_screen') || 'build');
  }
});

// Then load from Firestore (source of truth) — updates cache + restores session again
if (window._firebaseReady) initAdminsFromFirestore();
else window.addEventListener('firebaseReady', initAdminsFromFirestore, { once: true });

// ── Entitlement layer (Phase 1) ─────────────────────────────────────────────
// Server-authoritative, offline-tolerant account entitlement. Reads accounts/{id}
// as the source of truth and caches it so live use survives a bad network. This
// EXTENDS the existing identity — account id = signed-in admin id when present,
// else a persistent device account id — rather than adding a parallel auth.
// Phase 1 is read-only: it never gates a feature (capability resolution = Phase 2).
function cueolaInitEntitlements() {
  const E = window.CueolaEntitlements;
  if (!E) return null;
  const accountId = (adminSession && adminSession.id) || E.getDeviceAccountId();
  if (window.cueolaEntitlements && window.cueolaEntitlements.accountId === accountId) {
    return window.cueolaEntitlements; // already keyed to this identity
  }
  if (window.cueolaEntitlements) window.cueolaEntitlements.stop();
  const firestore = (window._firebaseReady && window._db && window._doc && window._onSnapshot)
    ? { db: window._db, doc: window._doc, onSnapshot: window._onSnapshot }
    : null;
  window.cueolaEntitlements = E.createStore({
    accountId,
    firestore,
    log: function () { try { console.debug.apply(console, ['[entitlement]'].concat([].slice.call(arguments))); } catch {} },
  }).start();
  // Compute capabilities now and whenever the entitlement changes (grant/refund/expiry).
  cueolaComputeCapabilities();
  try { window.cueolaEntitlements.subscribe(cueolaComputeCapabilities); } catch {}
  return window.cueolaEntitlements;
}

// ── Capability resolution (Phase 2) ─────────────────────────────────────────
// resolveCapabilities(entitlement, platform) is the single gate. Computed here and
// exposed as window.cueolaCapabilities. Pricing is NOT live (GATING_ENABLED=false), so
// the web app resolves to FULL function — this layer is additive and gates nothing
// today; it's the declarative hook platform builds use later (data-cap-requires).
function cueolaComputeCapabilities() {
  const E = window.CueolaEntitlements;
  if (!E || !window.cueolaEntitlements) return null;
  const platform = E.detectPlatform(typeof navigator !== 'undefined' ? navigator : null);
  const offline = (typeof navigator !== 'undefined') && navigator.onLine === false;
  const caps = E.resolveCapabilities(window.cueolaEntitlements.get(), platform, { offline });
  window.cueolaPlatform = platform;
  window.cueolaCapabilities = caps;
  applyCapabilityVisibility(caps);
  return caps;
}

// Declarative, reversible UI gating. Mark an element data-cap-requires="<key>" (e.g.
// "outrangutan", "flowmingo") and it's hidden when that capability resolves unavailable.
// On the web app today everything resolves available, so this is a no-op — it only
// lights up on restricted platform builds or once gating is switched on.
function applyCapabilityVisibility(caps) {
  if (!caps || typeof document === 'undefined') return;
  document.querySelectorAll('[data-cap-requires]').forEach(function (el) {
    const available = window.CueolaEntitlements.can(caps, el.getAttribute('data-cap-requires'));
    el.hidden = !available;
    el.setAttribute('aria-hidden', available ? 'false' : 'true');
  });
}

// Simple feature check for app code: cueolaCan('outrangutan'), cueolaCan('flowmingo').
function cueolaCan(key) {
  return !!(window.CueolaEntitlements && window.CueolaEntitlements.can(window.cueolaCapabilities, key));
}

if (window._firebaseReady) cueolaInitEntitlements();
else window.addEventListener('firebaseReady', cueolaInitEntitlements, { once: true });

(function autoJoinFromDashboard() {
  const params = new URLSearchParams(window.location.search);
  // Script Op pop-out window: boot focused into the live Script Op controls,
  // joined to the same session (opened by openScriptOpPopout in another window).
  if (params.has('scriptop')) {
    sessionStorage.setItem('cueola_screen', 'entry');
    document.body.classList.add('scriptop-popout');
    const code = (params.get('scriptop') || params.get('code') || '').trim().toUpperCase();
    let name = (params.get('name') || '').trim();
    try { name = name || localStorage.getItem('cueola_last_name') || ''; } catch (e) {}
    name = name || 'Script Op';
    const bootScriptOp = () => {
      if (!code) { showModal('modal-stud'); return; }
      session = { code, role: 'instructor', userName: name, isDemo: false, isExpert: false };
      freeTextMode = false;
      enterRundown();
      setTimeout(() => {
        try { if (!document.getElementById('liveshow').classList.contains('on')) goLive(); } catch (e) {}
        setTimeout(() => { try { if (!livePrompterOpen) toggleLivePrompterPanel(); } catch (e) {} }, 500);
      }, 400);
    };
    waitForFirebaseReady().then(ready => {
      if (ready || !code) bootScriptOp();
      else { try { openLocalSession(code, name, 'instructor'); } catch (e) {} setTimeout(() => { try { if (!document.getElementById('liveshow').classList.contains('on')) goLive(); } catch (e) {} setTimeout(() => { try { if (!livePrompterOpen) toggleLivePrompterPanel(); } catch (e) {} }, 500); }, 400); }
    });
    return;
  }
  if (location.hash === '#flowmingo-op' || location.hash === '#flowop' || params.has('flowop') || params.has('operator')) {
    sessionStorage.setItem('cueola_screen', 'entry');
    setTimeout(() => openFlowmingoOperator(params.get('code') || ''), 0);
    return;
  }
  if (location.hash === '#flowmingo' || location.hash === '#promptypus' || params.has('flowmingo') || params.has('prompter') || params.has('promptypus')) {
    sessionStorage.setItem('cueola_screen', 'entry');
    setTimeout(() => {
      enterPrompter();
      const code = (params.get('code') || '').trim().toUpperCase();
      if (code) {
        const input = ptEl('pt-cueola-code-input');
        if (input) input.value = code;
        ptLoadFromCueolaCode(code);
      }
      if (params.has('bars') || location.hash === '#bars') {
        setTimeout(ptShowColorBars, 80);
      }
    }, 0);
    return;
  }
  // Check URL param first (?code=XXXX)
  const urlCode = params.get('code');
  // Then check localStorage set by dashboard launchRundown()
  let stored = null;
  try { stored = JSON.parse(localStorage.getItem('cueola_session') || 'null'); } catch {}
  // Clear it immediately so a refresh doesn't re-trigger
  localStorage.removeItem('cueola_session');

  const code = urlCode || stored?.code;
  if (!code) return;
  const shouldOpenPrePro = localStorage.getItem('cueola_open_prepro') === '1';
  localStorage.removeItem('cueola_open_prepro');

  const name = stored?.userName || adminSession?.name || '';
  const role = stored?.role || 'instructor';

  const doJoin = () => {
    if (name) {
      session = { code, role, userName:name, isDemo:false, isExpert:false };
      freeTextMode = false;
      enterRundown();
      if (shouldOpenPrePro) setTimeout(openPaperworkHub, 700);
    } else {
      // No name stored — show the join modal pre-filled with the code
      const inp = document.getElementById('stud-code');
      if (inp) inp.value = code;
      showModal('modal-stud');
    }
  };

  waitForFirebaseReady().then(ready => {
    if (ready) doJoin();
    else if (name) {
      openLocalSession(code, name, role, stored?.showName || 'Untitled Show');
      if (shouldOpenPrePro) setTimeout(openPaperworkHub, 700);
    } else {
      const inp = document.getElementById('stud-code');
      if (inp) inp.value = code;
      showModal('modal-stud');
      toast('Offline in this browser. You can open a local copy with this code.');
    }
  });
})();

// ─────────────────────────────────────────────────────────────
// P7: BOOT WIRING — error containment + session resume.
// Wrap the live-critical render/dispatch paths so an exception in one panel
// logs to the show log and recovers without taking down the show UI. These
// rebind the top-level declarations; every caller picks up the guarded
// version at call time.
// ─────────────────────────────────────────────────────────────
renderLive = guardFn(renderLive, 'Live view');
renderRundown = guardFn(renderRundown, 'Rundown view');
renderLiveFocus = guardFn(renderLiveFocus, 'Live focus view');
renderLivePromptOp = guardFn(renderLivePromptOp, 'Flowmingo Op view');
applyOutrangutanState = guardFn(applyOutrangutanState, 'Playout status');
keymapDispatch = guardFn(keymapDispatch, 'Keyboard dispatch');

// Offer to resume after an unclean exit (Decisions #14). The banner lives on
// the entry screen; a deep link that routes elsewhere hides it with the screen.
initResumeBanner();

// P7: Save the show file with the standard shortcut — Cmd/Ctrl+S saves the
// open surface in place (Outrangutan screen → .ogshow, otherwise → .cueola)
// instead of triggering the browser's save-page dialog.
window.addEventListener('keydown', e => {
  if (!(e.metaKey || e.ctrlKey) || e.shiftKey || e.altKey || String(e.key).toLowerCase() !== 's') return;
  const og = document.getElementById('outrangutan')?.classList.contains('on');
  const build = document.getElementById('rundown')?.classList.contains('on');
  const live = document.getElementById('liveshow')?.classList.contains('on');
  if (og) { e.preventDefault(); try { window.Outrangutan?.saveShowFile?.(); } catch (err) { containError('Show save', err); } return; }
  if (build || live) { e.preventDefault(); exportRundownFile(); }
}, true);

// Name-badge hover tooltips (presence avatars, Planda Bear collab badges,
// rundown presence dots). The old pure-CSS ::after tooltips were clipped by
// scrollable ancestors (.tb-right gains overflow-x:auto under 900px, which
// forces vertical clipping too), so the tooltip is a body-level fixed element
// positioned from the badge's viewport rect instead.
(function uiFloatTip() {
  let tip = null, anchor = null;
  const hide = () => { tip?.remove(); tip = null; anchor = null; };
  document.addEventListener('mouseover', e => {
    const t = e.target.closest?.('[data-fullname]');
    if (!t) { if (anchor) hide(); return; }
    if (t === anchor) return;
    hide();
    anchor = t;
    tip = document.createElement('div');
    tip.className = 'ui-float-tip';
    tip.textContent = t.getAttribute('data-fullname') || '';
    document.body.appendChild(tip);
    const r = t.getBoundingClientRect(), tr = tip.getBoundingClientRect();
    const x = Math.max(8, Math.min(r.left + r.width / 2 - tr.width / 2, innerWidth - tr.width - 8));
    let y = r.bottom + 8;
    if (y + tr.height > innerHeight - 8) y = r.top - tr.height - 8;
    tip.style.left = x + 'px';
    tip.style.top = y + 'px';
    requestAnimationFrame(() => tip?.classList.add('on'));
  });
  document.addEventListener('mouseout', e => {
    if (anchor && !(e.relatedTarget && anchor.contains(e.relatedTarget))) hide();
  });
  document.addEventListener('scroll', hide, true);
  document.addEventListener('click', hide, true);
})();
