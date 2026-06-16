'use strict';

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
const CUEOLA_THEMES = ['cool','warm','white','green','koala','panda','flamingo','prepbear'];
const CUEOLA_THEME_LABELS = {
  warm:     'Honey',
  cool:     'Glacier',
  white:    'Polar Bear',
  green:    'Eucalyptus',
  koala:    'Koala',
  panda:    'Planda Bear',
  flamingo: 'Flowmingo',
  prepbear: 'PrepBear',
};
function normalizeCueolaTheme(t) { return CUEOLA_THEMES.includes(t) ? t : 'cool'; }
const PLANDABEAR_THEMES = ['default','honey','glacier','polar-bear','eucalyptus','koala','panda','flamingo','prepbear'];
function normalizePlandaBearTheme(t) { return PLANDABEAR_THEMES.includes(t) ? t : 'default'; }
function normalizeFrameRate(v) { return [24,30,60].includes(Number(v)) ? Number(v) : 30; }
let currentTheme = normalizeCueolaTheme(localStorage.getItem('cueola_theme'));
let plandaBearTheme = normalizePlandaBearTheme(localStorage.getItem('cueola_plandabear_theme'));
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
// Live Focus view — the default live surface: one big NOW, a clear NEXT, and a
// calm coming-up list. Toggling off shows the full department grid.
let liveFocusMode = (() => { try { return localStorage.getItem('cueola_live_focus') !== '0'; } catch { return true; } })();
let browserBackGuardReady = false;
let _lastHandledForceCmdTs = 0;
let livePrompterOpen = false;
let liveSidebarWidth = 360;
let previewRowIdx = 0;
let callSheetPeople = [];
let activeCallSheetIndex = 0;
let callSheetVenue = '';      // '' | 'indoors' | 'outdoors' | 'both'
let callSheetWeather = null;  // { conditions, high, low, precip, wind, sunrise, sunset, emoji, source, forecastDate, place, updatedAt }
let liveClockRunning = false;
let paperworkDirty = false;
let flowmingoRemoteOverrideUntil = 0;

function pushSessionHistoryState(screen) {
  if (!history.pushState) return;
  try {
    history.pushState({ cueolaSession:true, screen }, '', location.href);
    browserBackGuardReady = true;
  } catch {}
}

function leaveSessionForFrontPage() {
  stopTimer();
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

function showModal(id)  { const el=document.getElementById(id); if(!el)return; el.style.display=''; el.classList.add('on'); }
function hideModal(id)  { const el=document.getElementById(id); if(!el)return; el.style.display=''; el.classList.remove('on'); }
function hideOverlay(id){ const el=document.getElementById(id); if(!el)return; el.style.display=''; el.classList.remove('on'); }

function showOverlay(id){ const el=document.getElementById(id); if(!el)return; el.style.display=''; el.classList.add('on'); }

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
      ['One package','Export One PDF Package gathers the paperwork, production notes, and rendered rundown into a shareable file.']
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
  if (cueolaTTS.localManifestLoaded) return cueolaTTS.localAssetRefs;
  if (cueolaTTS.localManifestPromise) return cueolaTTS.localManifestPromise;
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
  const icon = cueolaTTS.muted ? TTS_SVG_OFF : TTS_SVG_ON;
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
      .catch(() => {});
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
        window._setDoc(ref, { list: local }).catch(() => {});
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
  return adminSession;
}

function logoutAdmin() {
  adminSession = null;
  try { localStorage.removeItem(ADMIN_SESSION_KEY); } catch {}
  updateAdminUI();
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
          ${canRemove ? `<button class="admin-act-btn danger" onclick="confirmRemoveAdmin('${a.id}','${esc(a.name)}')">Remove</button>` : ''}
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
        <button class="admin-act-btn" ${presenceNames.length?'':'disabled'} style="background:rgba(240,82,82,.15);border-color:rgba(240,82,82,.4);color:var(--red);${presenceNames.length?'':'opacity:.45;cursor:not-allowed'}" onclick="adminForceLive(document.getElementById('adminFollowSelect').value)">Force Everyone Live + Follow</button>
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
    html += `<div class="admin-section">
      <div class="admin-section-label">Role and Planda Bear Assignments</div>
      <div id="adminRoleAssignments">${renderRoleAssignmentRows()}</div>
      <div class="admin-assignment-actions">
        <button class="admin-act-btn" onclick="addRoleAssignmentRow()">+ Add Person</button>
        <button class="admin-add-btn" onclick="saveRoleAssignmentsFromAdmin()">Save Assignments</button>
      </div>
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

function rolePositionOptionsHTML(selected='') {
  const chosen = String(selected || '').trim();
  const options = ROLE_POSITION_OPTIONS.some(opt => opt.toLowerCase() === chosen.toLowerCase())
    ? ROLE_POSITION_OPTIONS
    : cleanUniqueStrings([chosen, ...ROLE_POSITION_OPTIONS]);
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
  const rows = getRoleAssignmentsFromAdminDOM().map(row => normalizeRoleAssignment(row));
  persistPreProData({ roleAssignments: rows }, 'Role Assignments');
  rerenderRoleAssignments(rows);
  toast('Role assignments saved.');
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
  const code = document.getElementById('newAdminCode').value;
  const err  = document.getElementById('newAdminErr');
  err.style.display='none';
  if (!name||!code) { err.textContent='Name and code required.'; err.style.display='block'; return; }
  if (_newAdminLevel==='full' && countFullAccess()>=3) { err.textContent='Max 3 full-access admins.'; err.style.display='block'; return; }
  createAdmin(name, code, _newAdminLevel, adminSession.id);
  renderAdminBody();
  toast(`Admin "${name}" added.`);
}

function promptEditCode(id, name) {
  const code = prompt(`New code for ${name}:`);
  if (!code) return;
  if (updateAdminCode(id, code)) toast('Code updated.');
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

function promoteToFull(id) {
  if (countFullAccess()>=3) { toast('Max 3 full-access admins reached.'); return; }
  const admins = getAdmins();
  const a = admins.find(x=>x.id===id);
  if (a) { a.level='full'; saveAdmins(admins); renderAdminBody(); toast(`${a.name} promoted to Full Access.`); }
}

function promoteToSuper(id) {
  const admins = getAdmins();
  const a = admins.find(x=>x.id===id);
  if (a) { a.level='super'; saveAdmins(admins); renderAdminBody(); toast(`${a.name} promoted to Super Admin.`); }
}

function demoteToFull(id) {
  const admins = getAdmins();
  const a = admins.find(x=>x.id===id);
  if (a) { a.level='full'; saveAdmins(admins); renderAdminBody(); toast(`${a.name} set to Full Access.`); }
}

function demoteToStandard(id) {
  const admins = getAdmins();
  const a = admins.find(x=>x.id===id);
  if (a) { a.level='standard'; saveAdmins(admins); renderAdminBody(); toast(`${a.name} set to Standard.`); }
}

function confirmRemoveAdmin(id, name) {
  if (!confirm(`Remove admin "${name}"?`)) return;
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
    window._updateDoc(window._doc(window._db,'sessions',session.code),{ customSources: sessionCustomSources }).catch(()=>{});
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
  switch(type) {
    case 'video':
      return { ready:[d.state,d.source].filter(Boolean).join(' '), take:d.source?`${d.state==='Set'?'Dissolve':'Take'} ${d.source}`:'' };
    case 'audio':
      return { ready:[d.action,d.source].filter(Boolean).join(' '), take:d.action||'' };
    case 'playback':
      return { ready:[d.state,d.clipName].filter(Boolean).join(' '), take:d.clipName?`Roll ${d.clipName}`:'Roll' };
    case 'gfx':
      return { ready:[d.gfxType,d.transition].filter(Boolean).join(' / '), take:'Take GFX' };
    case 'lighting':
      return { ready:[d.action,d.fixture].filter(Boolean).join(' '), take:d.action==='At'?`Go ${d.intensity||0}%`:'Go' };
    case 'script':
      return { ready:d.who||'', take:'Begin', text:d.text||'' };
    default: return d;
  }
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
  restoreLocalDraft();
  enterRundown();
  toast('Opened local copy. Shared sync is unavailable while offline.');
}

function openLocalPlandaBear(code='', name='You') {
  session = { code:(code || 'LOCAL').trim().toUpperCase(), role:'instructor', userName:name || 'You', isDemo:false, isExpert:false };
  freeTextMode = true;
  restoreLocalDraft();
  const data = loadPreProData();
  show = {
    name:data.production || show.name || 'Untitled Show',
    start:normalizeTimeValue(data.showStart || show.start),
  };
  hideModal('modal-prepro-join');
  openPaperworkHub();
  toast('Opened local Planda Bear copy. Shared sync is unavailable while offline.');
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
    hideModal('modal-prepro-join');
    openPaperworkHub();
    joinPresence();
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
  } else {
    badge.style.display='none';
  }

  renderRundown();
  joinPresence();
  // Restore last screen
  if (sessionStorage.getItem('cueola_screen') === 'live') setTimeout(goLive, 300);
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
    }
  } catch (err) {
    console.warn('Rundown merge save failed; retrying.', err);
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
      window._setDoc(ref,{
        code:session.code, createdBy:session.userName,
        showName:show.name, startTime:normalizeTimeValue(show.start),
        freeMode:freeTextMode,
        createdAt:window._serverTimestamp()
      },{merge:true}).catch(()=>{});
    }

    firestoreUnsub = window._onSnapshot(ref, snap => {
      if (!snap.exists()) return;
      const d = snap.data();
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
      if (d.prompter && d.prompter.text !== undefined && session.role==='student') {
        prompterText = d.prompter.text || '';
        const el = document.getElementById('lsPrompterText');
        // Script operators are commonly joined as students. Presence and other
        // session writes also trigger this snapshot, so never replace a draft
        // while it is being edited or waiting for its debounced cloud push.
        if (el && !livePrompterDraftDirty && document.activeElement !== el) {
          el.textContent = prompterText;
        }
        // Forward live to any connected Flowmingo on this device, scroll-preserving.
        _postPrompterMessage(getPrompterPayload(false));
        ptUpdateFromCueola(prompterText);
      }
      if (d.prompter?.control?.action && !isPrompterSelfSender(d.prompter.control.sender)) {
        const control = d.prompter.control;
        if (applyRemoteControlOnce(control.action, control.ts, control.sender, control.controlId) && control.source === 'flowmingo-op') {
          flowmingoRemoteOverrideUntil = Date.now() + 30000;
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
      renderRundown();
    }, ()=>{});
  };

  if (window._firebaseReady) init();
  else window.addEventListener('firebaseReady', init, {once:true});
}

function syncToFirestore() {
  saveLocalDraft();
  if (!window._firebaseReady||!session.code||session.isDemo||session.isExpert) return;
  const currentShow = { name:show.name, start:normalizeTimeValue(show.start), freeMode:freeTextMode };
  const batch = buildRundownBatch(rundownShadowBeats, beats, rundownShadowShow, currentShow);
  if (!rundownBatchHasChanges(batch)) return;
  rundownPendingBatches.push(batch);
  rundownShadowBeats = cloneRundownValue(beats);
  rundownShadowShow = currentShow;
  flushRundownSyncQueue();
}

function syncLiveIdx() {
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
        await window._updateDoc(window._doc(window._db,'sessions',session.code), {
          participants: [...existing, { name, role:session.role, joinedAt: Date.now() }]
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
  document.getElementById('presenceAvatars').innerHTML =
    shown.map(p=>`<div class="p-avatar ${p.role==='instructor'?'inst':'stud'}" title="${esc(p.name)} — ${p.role==='instructor'?'Instructor':'Student'}">${initials(p.name)}</div>`).join('')+
    (extra>0?`<div class="p-avatar extra" title="${extra} more in session">+${extra}</div>`:'');
  document.getElementById('presenceTooltip').innerHTML =
    `<div style="font-size:10px;font-family:var(--mono);color:var(--text3);letter-spacing:.08em;margin-bottom:2px">IN SESSION</div>`+
    active.map(p=>{
      const col=p.role==='instructor'?'var(--accent)':'var(--green)';
      return `<div class="p-tip-row" title="${esc(p.name)}"><div class="p-tip-dot" style="background:${col};color:${col}"></div><span class="p-tip-name">${esc(p.name)}</span><span class="p-tip-label">${p.role==='instructor'?'INST':'STU'}</span></div>`;
    }).join('');
  refreshAdminBodyForSessionPeople();
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

function handleLiveRemoteKeydown(e) {
  const inPromptOp = promptOpMode && document.getElementById('liveshow')?.classList.contains('on');
  const inScriptPanel = livePrompterOpen || isLiveScriptPanelTarget(e.target);
  if (!inPromptOp && !inScriptPanel) return false;
  if (isTextEditingTarget(e.target) && !['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.key)) return false;

  if (inScriptPanel) {
    if (e.repeat && !['ArrowUp','ArrowDown'].includes(e.key)) {
      if (['ArrowLeft','ArrowRight',' ','Space','f','F','r','R','h','H','m','M'].includes(e.key)) consumeRemoteKey(e);
      return true;
    }
    if (e.key === ' ' || e.key === 'Space') { consumeRemoteKey(e); if (!e.repeat) sendPrompterControl(ptPlaying ? 'pause' : 'resume'); return true; }
    if (e.key === 'ArrowUp')    { consumeRemoteKey(e); if (!e.repeat) sendPrompterControl('boost_start'); return true; }
    if (e.key === 'ArrowDown')  { consumeRemoteKey(e); if (!e.repeat) sendPrompterControl('brake_start'); return true; }
    if (e.key === 'ArrowLeft')  { consumeRemoteKey(e); if (!e.repeat) sendPrompterControl('size_down'); return true; }
    if (e.key === 'ArrowRight') { consumeRemoteKey(e); if (!e.repeat) sendPrompterControl('size_up'); return true; }
    if (e.key === 'f' || e.key === 'F') { consumeRemoteKey(e); if (!e.repeat) sendPrompterControl('fullscreen'); return true; }
    if (e.key === 'r' || e.key === 'R') { consumeRemoteKey(e); if (!e.repeat) sendPrompterControl('reset'); return true; }
    if (e.key === 'h' || e.key === 'H') { consumeRemoteKey(e); if (!e.repeat) sendPrompterControl('hide_interface'); return true; }
    if (e.key === 'm' || e.key === 'M') { consumeRemoteKey(e); if (!e.repeat) sendPrompterControl('mirror'); return true; }
    return false;
  }

  if (e.key === 'ArrowDown' && e.altKey) { consumeRemoteKey(e); if (!e.repeat) sendPrompterControl('direction_reverse'); return true; }
  if (e.key === 'ArrowUp' && e.altKey)   { consumeRemoteKey(e); if (!e.repeat) sendPrompterControl('direction_forward'); return true; }
  if (e.repeat && !['ArrowUp','ArrowDown'].includes(e.key)) {
    if (['ArrowLeft','ArrowRight',' ','Space','f','F','e','E','r','R','h','H','m','M'].includes(e.key)) consumeRemoteKey(e);
    return true;
  }
  switch (e.key) {
    case ' ':
    case 'Space':      consumeRemoteKey(e); sendPrompterControl(ptPlaying ? 'pause' : 'resume'); return true;
    case 'ArrowUp':    consumeRemoteKey(e); if (!e.repeat) sendPrompterControl('boost_start'); return true;
    case 'ArrowDown':  consumeRemoteKey(e); if (!e.repeat) sendPrompterControl('brake_start'); return true;
    case 'ArrowLeft':  consumeRemoteKey(e); if (!e.repeat) sendPrompterControl('size_down'); return true;
    case 'ArrowRight': consumeRemoteKey(e); if (!e.repeat) sendPrompterControl('size_up'); return true;
    case 'f': case 'F': consumeRemoteKey(e); if (!e.repeat) sendPrompterControl('fullscreen'); return true;
    case 'e': case 'E': consumeRemoteKey(e); if (!e.repeat) openLiveScript(Math.max(lsIdx,0)); return true;
    case 'r': case 'R': consumeRemoteKey(e); if (!e.repeat) sendPrompterControl('reset'); return true;
    case 'h': case 'H': consumeRemoteKey(e); if (!e.repeat) sendPrompterControl('hide_interface'); return true;
    case 'm': case 'M': consumeRemoteKey(e); if (!e.repeat) sendPrompterControl('mirror'); return true;
    default: return false;
  }
}

function handleLiveRemoteKeyup(e) {
  const liveOn = document.getElementById('liveshow')?.classList.contains('on');
  if (!liveOn) return;
  if (promptOpMode || livePrompterOpen || isLiveScriptPanelTarget(e.target)) {
    if (e.key === 'ArrowUp')   { consumeRemoteKey(e); sendPrompterControl('boost_stop'); }
    if (e.key === 'ArrowDown') { consumeRemoteKey(e); sendPrompterControl('brake_stop'); }
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') consumeRemoteKey(e);
  }
}

// Arrow key navigation in live screen
document.addEventListener('keydown', e => {
  const liveOn = document.getElementById('liveshow')?.classList.contains('on');
  if (!liveOn) return;
  // Row preview pop-out open: arrows page through rows in the overlay (and Esc
  // closes it) instead of moving the live position underneath it.
  if (document.getElementById('lsRowPreviewOv')?.classList.contains('on')) {
    if (isTextEditingTarget(e.target)) return;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); previewRelativeRow(1); }
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); previewRelativeRow(-1); }
    else if (e.key === 'Escape') { e.preventDefault(); hideOverlay('lsRowPreviewOv'); }
    return;
  }
  if (handleLiveRemoteKeydown(e)) return;
  if (isTextEditingTarget(e.target)) return;
  if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); lsNext(); }
  else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); lsPrev(); }
});
document.addEventListener('keyup', handleLiveRemoteKeyup);

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
                title="Drag to reorder">${sfIcon(m.symbol)} ${m.label} <span style="font-size:7px;opacity:.35">⠿</span></th>`;
    }
    return `<th class="col-cue${type==='script'?' col-script-c':''}" style="color:${m.color}" data-col="${type}">${sfIcon(m.symbol)} ${m.label}</th>`;
  }).join('');
  const dragCol = editMode ? '<th class="col-drag" title="Drag rows to reorder">⠿</th>' : '<th class="col-drag"></th>';
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
function colDrop(e, targetType) {
  e.preventDefault();
  document.querySelectorAll('.col-drag-over').forEach(c=>c.classList.remove('col-drag-over'));
  if (!editMode || !colDragSrc || colDragSrc === targetType) { colDragSrc=null; return; }
  const fi = colOrder.indexOf(colDragSrc), ti = colOrder.indexOf(targetType);
  if (fi < 0 || ti < 0) { colDragSrc=null; return; }
  colOrder.splice(fi, 1); colOrder.splice(ti, 0, colDragSrc);
  localStorage.setItem('cueola_col_order', JSON.stringify(colOrder));
  colDragSrc = null;
  renderRundown();
}
function colDragEnd(e) {
  e.currentTarget.style.opacity = '';
  document.querySelectorAll('.col-drag-over').forEach(c=>c.classList.remove('col-drag-over'));
  colDragSrc = null;
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

  let offsetSecs = 0;
  let html = '';
  beats.forEach((b, i) => {
    const dur = fmtDur(b);
    const startStr = show.start ? clock(show.start, offsetSecs) : '—';
    offsetSecs += (b.min||0)*60+(b.sec||0);

    const editActions = editMode ? `
      <div class="row-edit-actions">
        <button class="row-ea-btn" onclick="moveRowUp(${b.id})"${i===0?' disabled style="opacity:.3;cursor:not-allowed"':''} title="Move up">▲ Up</button>
        <button class="row-ea-btn" onclick="moveRowDown(${b.id})"${i===beats.length-1?' disabled style="opacity:.3;cursor:not-allowed"':''} title="Move down">▼ Down</button>
        <button class="row-ea-btn row-ea-add-before" onclick="addRowAt(${i},'before')" title="Add row before">+ Before</button>
        <button class="row-ea-btn row-ea-del" onclick="removeRow(${b.id})" title="Remove row">${sfIcon('action.delete')} Remove</button>
        <button class="row-ea-btn row-ea-add-after" onclick="addRowAt(${i},'after')" title="Add row after">+ After</button>
      </div>` : '';
    html += `<tr class="cue-row${editMode?' edit-mode-row':''}" ${editMode?'draggable="true"':''} onclick="${editMode?'':'openEdit('+b.id+')'}" data-id="${b.id}">
      <td class="cd cd-drag" style="opacity:${editMode?'1':'.15'};cursor:${editMode?'grab':'default'}" title="${editMode?'Drag to reorder':'Enable edit mode to reorder'}">⠿</td>
      <td class="cd cd-num">${i+1}</td>
      <td class="cd" style="padding:8px 6px">
        <div class="cd-name">${esc(b.info||'—')}</div>
        ${b.notes?`<div class="cd-subnote">${esc(b.notes)}</div>`:''}
        <span class="style-pill style-${b.style||'flex'}" style="margin-top:3px;display:inline-block">${b.style==='timed'?'⏱':'⇔'} ${(b.style||'flex').toUpperCase()}</span>
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
  const isEmpty = !on && !off && (type !== 'script' || !d?.text);
  if (isEmpty) {
    return `<button class="cue-add-btn" onclick="event.stopPropagation();openCueConfig(${b.id},'${type}')" title="Add ${tc.label} cue"><span>+</span><span>${tc.label}</span></button>`;
  }
  const lines = [
    on  ? `<div class="cue-on-line"><span class="cue-on-dot">▶</span>${esc(on)}</div>`  : '',
    off ? `<div class="cue-off-line"><span class="cue-off-dot">■</span>${esc(off)}</div>` : '',
  ].filter(Boolean).join('');
  const scriptMeta = type === 'script' && d?.text
    ? `<div class="script-present-line">Script · ${scriptLineLabel(d.text)}</div>`
    : '';
  return `<div class="cue-cell-filled" style="--cue-clr:${tc.color}" onclick="event.stopPropagation();openCueConfig(${b.id},'${type}')">
    <div class="cue-cell-icon" style="color:${tc.color}">${sfIcon(tc.symbol)}</div>
    <div class="cue-cell-info">${lines}${scriptMeta}</div>
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

function removeRow(id) {
  if (!confirm('Remove this row?')) return;
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
  if (freeTextMode) {
    insertAddRowBeat();
    hideOverlay('addRowOv');
    renderRundown();
    syncToFirestore();
    toast('Row added.');
    return;
  }
  arCueType = null;
  const grid = document.getElementById('arTypeGrid');
  grid.innerHTML = Object.keys(CT).map(type => {
    const tc = CT[type];
    return `<div class="opt-card" id="artype-${type}"
        style="--oc:${tc.color};--ob:${tc.bg}"
        onclick="arSelectCueType('${type}')">
      <div class="opt-icon" style="font-size:24px">${sfIcon(tc.symbol)}</div>
      <div class="opt-name" style="color:${tc.color}">${tc.label}</div>
      <div class="opt-desc">${AR_TYPE_DESC[type]||''}</div>
    </div>`;
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
  document.getElementById(`opt-${s}`).classList.add('sel');
  const durWrap = document.getElementById('ar-dur-wrap');
  if (durWrap) durWrap.style.display = s==='timed' ? '' : 'none';
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
  _sOnType='Script';_sOnSrc='';_sOffSrc='';_sOffHow='';
  _sOnTags = [...(beats.find(x=>x.id===beatId)?.cues?.script?.scriptTags||[])];
  const b = beats.find(x=>x.id===beatId); if (!b) return;
  const existing = b.cues?.[type] || null;
  const tc = CT[type];
  document.getElementById('cueConfigTitle').innerHTML = `${sfIcon(tc.symbol)} ${tc.label}`;
  document.getElementById('cueConfigFields').innerHTML = freeTextMode ? buildFreeTextCueFields(type, existing) : buildCueConfigFields(type, existing);
  document.getElementById('cueConfigRemoveBtn').style.display = existing ? '' : 'none';
  showModal('cueConfigModal');
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
    const val = (c.v !== undefined ? c.v : c).toString().replace(/'/g, "\\'");
    const lbl = c.label || c;
    return `<button type="button" class="cc-chip" onclick="${fn}('${val}')">${lbl}</button>`;
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

// ══ SCRIPT Off helpers ══════════════════════════════
let _sOffSrc='',_sOffHow='';
function ccSOffSrc(v){
  _sOffSrc=v; ccSelChip('sOff-src',v);
  _ccSOffBuild();
}
function ccSOffHow(v){ _sOffHow=v; ccSelChip('sOff-how',v); _ccSOffBuild(); }
function _ccSOffBuild(){
  const src=document.getElementById('cc-s-off-custom')?.style.display!=='none'
    ? (document.getElementById('cc-s-off-custom')?.value||_sOffSrc) : _sOffSrc;
  const el=document.getElementById('cc-off-text'); if(!el) return;
  const parts=[src,_sOffHow].filter(Boolean);
  el.value=parts.join(' — ')||_sOffHow;
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
      d.text        = document.getElementById('cc-s-text')?.value||'';
      d.dialogueNote= document.getElementById('cc-s-dialogue')?.value?.trim()||'';
      d.scriptTags  = [..._sOnTags];
      break;
  }
  b.cues[cueConfigType] = d;
  hideModal('cueConfigModal');
  renderRundown(); syncToFirestore(); toast('Cue saved.');
}

function removeCueCfg() {
  if (!confirm('Remove this cue type from the row?')) return;
  const b = beats.find(x=>x.id===cueConfigBeatId); if (!b||!b.cues) return;
  delete b.cues[cueConfigType];
  hideModal('cueConfigModal');
  renderRundown(); syncToFirestore(); toast('Cue removed.');
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

function chipField(id, label, options, allowCustom=false) {
  const opts = options.map(o=>`<button class="chip" onclick="chipSel('${id}',this,'${esc(o)}')">${esc(o)}</button>`).join('');
  const custom = allowCustom ? `<button class="chip" onclick="chipCustom('${id}',this)">+ Custom</button>` : '';
  return `<div class="field" style="margin-bottom:10px">
    <label class="field-lbl">${label}</label>
    <input type="hidden" id="${id}-val">
    <div class="chip-grid">${opts}${custom}</div>
  </div>`;
}

function chipSel(id, el, val) {
  el.closest('.chip-grid').querySelectorAll('.chip').forEach(c=>c.classList.remove('sel'));
  el.classList.add('sel');
  document.getElementById(`${id}-val`).value = val;
  if (id==='cc-l-action') {
    const wrap = document.getElementById('cc-l-int-wrap');
    if (wrap) wrap.style.display = val==='At' ? '' : 'none';
  }
}

function chipCustom(id, el) {
  const val = prompt('Enter custom value:');
  if (!val||!val.trim()) return;
  el.closest('.chip-grid').querySelectorAll('.chip').forEach(c=>c.classList.remove('sel'));
  // Create temp chip
  const tmp = document.createElement('button');
  tmp.className='chip sel';
  tmp.textContent=val.trim();
  tmp.onclick=()=>chipSel(id,tmp,val.trim());
  el.closest('.chip-grid').insertBefore(tmp, el);
  document.getElementById(`${id}-val`).value = val.trim();
}

// loadScriptFile defined above (async, supports PDF)

// ─────────────────────────────────────────────────────────────
// EDIT
// ─────────────────────────────────────────────────────────────
function openEdit(id) {
  const b = beats.find(x=>x.id===id); if (!b) return;
  editId = id;
  editStyle = b.style||'flex';
  document.getElementById('editTitle').textContent = 'Edit Row';
  let h = `
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
        <button class="chip ${editStyle==='timed'?'sel':''}" id="ed-s-timed" onclick="edSetStyle('timed',this)">⏱ Timed</button>
        <button class="chip ${editStyle==='flex'?'sel':''}" id="ed-s-flex" onclick="edSetStyle('flex',this)">⇔ Flex</button>
      </div></div>`;
  document.getElementById('editFields').innerHTML = h;
  document.getElementById('editOv').classList.add('on');
}

function edSetStyle(s, el) {
  editStyle = s;
  document.querySelectorAll('#editFields .chip').forEach(c=>c.classList.remove('sel'));
  el.classList.add('sel');
}

function edChipField(id, label, options, current, allowCustom=false) {
  const opts = options.map(o=>`<button class="chip ${o===current?'sel':''}" onclick="chipSel('${id}',this,'${esc(o)}')">${esc(o)}</button>`).join('');
  const custom = allowCustom ? `<button class="chip ${!options.includes(current)&&current?'sel':''}" onclick="chipCustom('${id}',this)">${!options.includes(current)&&current ? esc(current) : '+ Custom'}</button>` : '';
  return `<div class="field" style="margin-bottom:10px"><label class="field-lbl">${label}</label><input type="hidden" id="${id}-val" value="${esc(current||'')}"><div class="chip-grid">${opts}${custom}</div></div>`;
}

function closeEdit(e) {
  if (e && e.target!==document.getElementById('editOv')) return;
  document.getElementById('editOv').classList.remove('on');
}

function saveEdit() {
  const b = beats.find(x=>x.id===editId); if (!b) return;
  b.info  = document.getElementById('ed-info').value.trim()||b.info;
  b.notes = document.getElementById('ed-notes').value.trim();
  b.min   = parseInt(document.getElementById('ed-min').value)||0;
  b.sec   = parseInt(document.getElementById('ed-sec').value)||0;
  if (editStyle) b.style = editStyle;
  document.getElementById('editOv').classList.remove('on');
  renderRundown(); syncToFirestore(); toast('Saved.');
}

function v(id) { return document.getElementById(id)?.value?.trim()||''; }

function deleteCue() {
  if (!confirm('Remove this row?')) return;
  beats = beats.filter(b=>b.id!==editId);
  document.getElementById('editOv').classList.remove('on');
  renderRundown(); syncToFirestore(); toast('Row removed.');
}

function _removedLoadEditScriptFile(input) {
  const file = input.files[0]; if (!file) return;
  const reader = new FileReader();
  reader.onload = e => { const ta=document.getElementById('ed-s-text'); if(ta) ta.value=e.target.result; };
  reader.readAsText(file);
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

function confirmGoLive() {
  const c = preLiveCheck();
  const rows = [
    { key:'Script',           ok:c.script.ok, detail:c.script.label },
    { key:'Talent prompter',  ok:c.talent.ok, detail:c.talent.label },
    { key:'Cloud sync',       ok:c.cloud.ok,  detail:c.cloud.label  },
  ];
  const container = document.getElementById('goLiveCheckRows');
  if (container) {
    container.innerHTML = rows.map(r => `
      <div class="precheck-row ${r.ok?'ok':'warn'}">
        <div class="precheck-icon">${r.ok?'✓':'!'}</div>
        <div class="precheck-body">
          <div class="precheck-label">${esc(r.key)}</div>
          <div class="precheck-detail">${esc(r.detail)}</div>
        </div>
      </div>`).join('');
  }
  const goBtn = document.getElementById('goLiveCheckGo');
  if (goBtn) goBtn.textContent = c.allGreen ? 'Go Live' : 'Continue Anyway';
  const note = document.getElementById('goLiveCheckNote');
  if (note) note.textContent = c.allGreen
    ? 'Everything looks set. You\'re clear to go live.'
    : 'A couple of things aren\'t set yet — review before going live.';
  showOverlay('goLiveCheckOv');
}

function confirmedGoLive() {
  hideOverlay('goLiveCheckOv');
  goLive();
}

function goLive() {
  if (lsIdx<0) lsIdx=0;
  document.getElementById('rundown').classList.remove('on');
  document.getElementById('liveshow').classList.add('on');
  document.getElementById('liveshow').classList.toggle('prompt-op-active', promptOpMode);
  document.getElementById('tabLive').classList.add('on');
  document.getElementById('tabBuild').classList.remove('on');
  sessionStorage.setItem('cueola_screen','live');
  pushSessionHistoryState('live');
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
  if (!confirm('Restart the show? This stops the clock, resets it to 0:00, and jumps back to the first row.')) return;
  stopTimer(false);
  liveClockRunning = false;
  elapsedSecs = 0;
  liveTimerStartMs = null;
  lsIdx = beats.length ? 0 : -1;
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

function scriptSpeakerLabel(d) {
  const explicit = d?.customSrc || d?.speaker || d?.who || '';
  if (explicit) return explicit;
  const cue = getCueOff(d) || getCueOn(d);
  return String(cue || '').replace(/\s+—\s*Begin\s*$/i, '').trim();
}

function assemblePrompterScriptFromBeats(list=beats) {
  const scripts = (Array.isArray(list) ? list : []).filter(b => b?.cues?.script?.text);
  return cleanPrompterText(scripts.map((b, idx) => {
    const d = b.cues.script;
    const header = b.info ? `\n[${idx + 1}] ${b.info}\n` : `\n[${idx + 1}]\n`;
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
  }
  if (resizer) resizer.classList.toggle('on', livePrompterOpen);
  if (btn) {
    setSymbolButtonLabel(btn, 'content.script', livePrompterOpen ? 'Hide Script Op' : 'Script Op');
    btn.style.color = livePrompterOpen ? 'var(--cyan)' : '';
    btn.style.borderColor = livePrompterOpen ? 'rgba(34,211,211,.35)' : '';
  }
}

function toggleLivePrompterPanel() {
  livePrompterOpen = !livePrompterOpen;
  applyLivePrompterPanelState();
}

function startLivePanelResize(e) {
  e.preventDefault();
  const startX = e.clientX;
  const startW = liveSidebarWidth;
  const move = ev => {
    liveSidebarWidth = Math.min(620, Math.max(260, startW + (startX - ev.clientX)));
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
  return `<div class="live-cue-cell${isScript?' live-script-cell':''}" style="border-left-color:${tc.color}" ${isScript?`onclick="event.stopPropagation();openLiveScript(${beatIdx})" title="Open full script"`:''}>
    ${on  ? `<div class="live-cue-rdy">○ ${esc(on)}</div>` : ''}
    ${off ? `<div class="live-cue-go" style="color:${tc.color}">▶ ${esc(off)}</div>` : ''}
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
    return `<div class="lf-cue" style="--cue-clr:${tc.color}">
      <div class="lf-cue-dept">${sfIcon(COL_META[type].symbol)} ${COL_META[type].label}</div>
      <div class="lf-cue-lines">${lines}</div>
    </div>`;
  }).join('') + `</div>`;
}

// Focus view: one dominant NOW, a clear NEXT, and a dim coming-up list.
function renderLiveFocus() {
  const body = document.getElementById('lsBody');
  const curIdx = Math.max(0, Math.min(lsIdx, beats.length - 1));
  const cur = beats[curIdx];
  const next = beats[curIdx + 1];
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
    html += `<div class="lf-next" onclick="liveRowPreview(${curIdx + 1})">
      <span class="lf-next-badge">NEXT</span>
      <span class="lf-next-name">${esc(next.info || '—')}</span>
      <span class="lf-next-time">${fmtDur(next)}</span>
    </div>`;
  } else {
    html += `<div class="lf-next lf-next-last"><span class="lf-next-badge">END</span><span class="lf-next-name">Last row — show ends after this</span></div>`;
  }

  const rest = beats.slice(curIdx + 2);
  if (rest.length) {
    html += `<div class="lf-up-lbl">Coming up</div><div class="lf-up">` + rest.map((b, j) => {
      const i = curIdx + 2 + j;
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
      ${showCols.map(type=>`<th class="${type==='script'?'live-col-script':'live-col-cue'}" style="color:${CT[type].color}">${sfIcon(COL_META[type].symbol)} ${COL_META[type].label}</th>`).join('')}
    </tr></thead><tbody>`;

  beats.forEach((b, i) => {
    const isCur  = i === lsIdx;
    const isNext = i === lsIdx + 1;
    const isDone = i < lsIdx;
    const handler = canJump ? `jumpToLsCue(${i})` : `liveRowPreview(${i})`;
    const startStr = show.start ? clock(show.start, offsetSecs) : '—';
    const durSecs = (b.min||0)*60+(b.sec||0);
    offsetSecs += durSecs;
    const statusClass = isCur ? 'now' : isNext ? 'next' : isDone ? 'done' : 'later';
    const statusText = isCur ? 'On Air' : isNext ? 'Next' : isDone ? 'Done' : 'Later';
    const rowClass = isCur ? 'live-row-current' : isNext ? 'live-row-next' : isDone ? 'live-row-done' : '';
    html += `<tr class="${rowClass}" onclick="${handler}">
      <td><div class="live-num">${i+1}</div></td>
      <td><span class="live-status ${statusClass}">${statusText}</span></td>
      <td>
        <div class="live-name">${esc(b.info||'—')}</div>
        ${b.notes?`<div class="live-note">${esc(b.notes)}</div>`:''}
      </td>
      <td><div class="live-time"><strong>${fmtDur(b)}</strong>${startStr}</div></td>
      ${showCols.map(type=>`<td>${liveCellForBeat(b,type,i)}</td>`).join('')}
    </tr>`;
  });
  html += `</tbody></table></div>`;

  body.innerHTML = html;
  const cur = body.querySelector('.live-row-current');
  if (cur) cur.scrollIntoView({behavior:'smooth', block:'center'});
  applyLivePrompterPanelState();
  renderFollowChips();
  updateLiveOverview();
  updateLsPrompter();
  renderLivePrompterControls();
}

function liveQuick(b, type) {
  const d = b.cues?.[type];
  if (!d) return '<span style="color:var(--text3);font-size:10px">—</span>';
  const tc = CT[type];
  let s = '';
  switch(type) {
    case 'video':    s=d.state||d.source||''; break;
    case 'audio':    s=d.action||d.source||''; break;
    case 'playback': s=d.state||d.clipName||''; break;
    case 'gfx':      s=d.gfxType||d.source||''; break;
    case 'lighting': s=d.action||d.fixture||''; break;
  }
  return `<div class="ltr-cue-quick" style="border-left-color:${tc.color};color:${tc.color}">${esc(s)}</div>`;
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
function wrapLivePanelSelection(pre, post) {
  const el = document.getElementById('lsPrompterText');
  if (!el) return;
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
  const el = document.getElementById('lsPrompterText');
  if (!el) return;
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
  b.cues.script.text = document.getElementById('lsScriptEditText').value;
  prompterText = assemblePrompterScriptFromBeats();
  sendToPrompter();
  hideOverlay('lsScriptEditOv');
  renderLive(); syncToFirestore(); toast('Script saved & pushed.');
}

function jumpToLsCue(i) {
  if (session.role==='student') return;
  if (isStandardShowCaller()) return; // standard show callers may only advance sequentially
  lsIdx = i;
  renderLive();
  sendToPrompter(false);
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
  if (lsIdx < beats.length-1) {
    lsIdx++;
    updatePrompterOnAdvance(prev, beats[lsIdx]);
    renderLive();
    syncLiveIdx();
  }
}

function lsPrev() {
  detachIfFollowing();
  if (lsIdx > 0) { lsIdx--; renderLive(); sendToPrompter(false); syncLiveIdx(); }
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
  window._updateDoc(window._doc(window._db,'sessions',session.code), {
    forceCmd: { type:'followMe', name:session.userName, role:session.role, ts:Date.now() }
  }).catch(()=>{});
  toast('Forcing all users to follow you.');
}

// Admin: force everyone live and following a specific person
function adminForceLive(followName) {
  if (!adminSession || !session.code) return;
  if (!followName || followName === 'No users online') { toast('No live users to follow.'); return; }
  window._updateDoc(window._doc(window._db,'sessions',session.code), {
    forceCmd: { type:'forceLive', name:followName, ts:Date.now() }
  }).catch(()=>{});
  toast(`Forcing everyone live, following ${followName}.`);
  closeAdminPanel();
}

// ─────────────────────────────────────────────────────────────
// PROMPTER
// ─────────────────────────────────────────────────────────────
function buildPromptFromRundown() {
  prompterText = assemblePrompterScriptFromBeats();
  const el = document.getElementById('lsPrompterText');
  if (el) el.textContent = prompterText;
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

function _handlePrompterControlAck(msg) {
  if (!msg || msg.type !== 'control_ack') return;
  if (isPrompterSelfSender(msg.sender)) return;
  if (msg.target && msg.target !== FLOWMINGO_ENDPOINT_ID) return;
  const ackId = msg.controlId || msg.mid || `${msg.sender || ''}:${msg.controlTs || msg.ts || ''}:${msg.action || ''}`;
  if (!ackId || ackId === _lastPrompterAckId) return;
  _lastPrompterAckId = ackId;
  _notePrompterTalentSeen(msg);
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
  sendToPrompter();
}

async function sendToPrompter(isInit=false) {
  const el = document.getElementById('lsPrompterText');
  if (el && livePrompterDraftDirty) {
    prompterText = cleanPrompterText(el.innerText || el.textContent || '');
  } else {
    prompterText = cleanPrompterText(prompterText);
  }
  if (el) el.textContent = prompterText;
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
        'prompter.updatedAt':Date.now(),
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
  const el = document.getElementById('lsPrompterText');
  if (el && !livePrompterDraftDirty && document.activeElement !== el) {
    el.textContent = prompterText;
  }
}

function renderLivePrompterControls() {
  const el = document.getElementById('lsPrompterRemote');
  if (el) el.innerHTML = promptOpControlsHTML();
}

async function pushToPrompter() {
  const el = document.getElementById('lsPrompterText');
  if (el) prompterText = cleanPrompterText(el.innerText || el.textContent || '');
  const draftVersion = livePrompterDraftVersion;
  const pushed = await sendToPrompter();
  if (pushed && draftVersion === livePrompterDraftVersion) livePrompterDraftDirty = false;
  if (promptOpMode) renderLivePromptOp();
  if (pushed) toast('Pushed to Flowmingo');
}

function queueLivePrompterDraftPush() {
  livePrompterDraftDirty = true;
  livePrompterDraftVersion += 1;
  markLivePrompterStatus('Draft changes...', 'busy');
  clearTimeout(livePrompterDraftTimer);
  livePrompterDraftTimer = setTimeout(() => {
    pushToPrompter();
  }, 900);
}

function clearPrompter() {
  if (!confirm('Clear Flowmingo text?')) return;
  prompterText = '';
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

function sendPrompterControl(action) {
  if (livePrompterOpen && Date.now() < flowmingoRemoteOverrideUntil) {
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
      'prompter.control': { ...control, sender:FLOWMINGO_ENDPOINT_ID, senderClient:CLIENT_ID }
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
let _lastAppliedControlSig = ''; // dedup the same control across every transport (BC, storage, Firestore)
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
const FLOWMINGO_AUTO_PAUSE_RE = /\[(?:BREAK|AUTO PAUSE|PAUSE|STOP HERE|HOLD)(?:[^\]]*)\]/i;

const PT_THEMES = {
  warm:     { bg:'#130803', text:'#f5ead8', accent:'#c8843f', uiBg:'rgba(24,11,4,.92)',     uiBorder:'rgba(200,132,63,.25)' },
  cool:     { bg:'#08090f', text:'#d6e8f0', accent:'#7eb8c8', uiBg:'rgba(15,15,25,.92)',    uiBorder:'rgba(126,184,200,.25)' },
  white:    { bg:'#ffffff', text:'#000000', accent:'#e50000', uiBg:'rgba(255,255,255,.95)', uiBorder:'rgba(229,0,0,.20)' },
  green:    { bg:'#040d05', text:'#e8f5d5', accent:'#7ddb33', uiBg:'rgba(7,19,8,.92)',      uiBorder:'rgba(125,219,51,.25)' },
  koala:    { bg:'#1f1f1e', text:'#ffffff', accent:'#ffffff', uiBg:'rgba(38,38,38,.92)',    uiBorder:'rgba(255,255,255,.28)' },
  panda:    { bg:'#000000', text:'#ffffff', accent:'#ffffff', uiBg:'rgba(10,10,10,.92)',    uiBorder:'rgba(255,255,255,.28)' },
  flamingo: { bg:'#330512', text:'#ffffff', accent:'#de4b9a', uiBg:'rgba(59,20,41,.88)',    uiBorder:'rgba(222,75,154,.34)' },
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
    prompterText = msg.text || '';
    ptInitScriptFromCueola(prompterText);
    ptPostPing();
  }
  if (msg.type === 'script_update' && msg.text != null) {
    ptAdoptCueolaBridgeMessage(msg);
    prompterText = msg.text || '';
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

function promptOpControlsHTML() {
  const playAction = ptPlaying ? 'pause' : 'resume';
  const playLabel = ptPlaying ? 'PAUSE' : 'PLAY';
  const playIcon = ptPlaying ? PT_SVG_PAUSE : PT_SVG_PLAY;
  return `<div class="prompt-op-panel">
    <div class="pt-ctrl-group">
      <button class="pt-btn${ptPlaying?' active':''}" id="po-play-btn" onclick="sendPrompterControl('${playAction}')">${playIcon} ${playLabel}</button>
    </div>
    <div class="pt-ctrl-group">
      <span class="pt-ctrl-label">Speed</span>
      <button class="pt-btn" onclick="sendPrompterControl('speed_down')">−</button>
      <input type="range" class="pt-range" min="5" max="200" value="${ptTargetSpeed}" oninput="ptSetSpeed(this.value);sendPrompterControl('speed_set_'+this.value)">
      <button class="pt-btn" onclick="sendPrompterControl('speed_up')">+</button>
    </div>
    <div class="pt-ctrl-group">
      <span class="pt-ctrl-label">Size</span>
      <button class="pt-btn" onclick="sendPrompterControl('size_down')">−</button>
      <input type="range" class="pt-range" min="24" max="120" value="${ptFontSize}" oninput="ptSetSize(this.value);sendPrompterControl('size_set_'+this.value)">
      <button class="pt-btn" onclick="sendPrompterControl('size_up')">+</button>
    </div>
    <div class="pt-ctrl-group">
      <span class="pt-ctrl-label">Align</span>
      <button class="pt-btn${ptAlign==='left'?' active':''}" onclick="sendPrompterControl('align_left')"><svg width="14" height="12" viewBox="0 0 14 12" fill="currentColor"><rect x="0" y="0" width="14" height="2" rx="1"/><rect x="0" y="5" width="9" height="2" rx="1"/><rect x="0" y="10" width="12" height="2" rx="1"/></svg></button>
      <button class="pt-btn${ptAlign==='center'?' active':''}" onclick="sendPrompterControl('align_center')"><svg width="14" height="12" viewBox="0 0 14 12" fill="currentColor"><rect x="0" y="0" width="14" height="2" rx="1"/><rect x="2.5" y="5" width="9" height="2" rx="1"/><rect x="1" y="10" width="12" height="2" rx="1"/></svg></button>
      <button class="pt-btn${ptAlign==='right'?' active':''}" onclick="sendPrompterControl('align_right')"><svg width="14" height="12" viewBox="0 0 14 12" fill="currentColor"><rect x="0" y="0" width="14" height="2" rx="1"/><rect x="5" y="5" width="9" height="2" rx="1"/><rect x="2" y="10" width="12" height="2" rx="1"/></svg></button>
    </div>
    <div class="pt-ctrl-group">
      <span class="pt-ctrl-label">Theme</span>
      ${CUEOLA_THEMES.map(name => `<div class="pt-theme-dot${ptThemeName===name?' active':''}" style="background:${PT_THEMES[name].bg}" onclick="sendPrompterControl('theme_${name}')" title="${CUEOLA_THEME_LABELS[name] || name}"></div>`).join('')}
    </div>
    <div class="pt-ctrl-group">
      <button class="pt-btn" onpointerdown="sendPrompterControl('brake_start')" onpointerup="sendPrompterControl('brake_stop')" onpointerleave="sendPrompterControl('brake_stop')">Brake</button>
      <button class="pt-btn" onpointerdown="sendPrompterControl('boost_start')" onpointerup="sendPrompterControl('boost_stop')" onpointerleave="sendPrompterControl('boost_stop')">Boost</button>
      <button class="pt-btn" onclick="sendPrompterControl('direction_reverse')">Reverse</button>
      <button class="pt-btn" onclick="sendPrompterControl('direction_forward')">Forward</button>
    </div>
    <div class="pt-ctrl-group">
      <button class="pt-btn" onclick="openLiveScript(${Math.max(lsIdx,0)})">Script</button>
      <button class="pt-btn" onclick="sendPrompterControl('reset')">Reset</button>
      <button class="pt-btn" onclick="sendPrompterControl('hide_interface')">Hide UI</button>
      <button class="pt-btn" onclick="sendPrompterControl('mirror')">Mirror</button>
      <button class="pt-btn" onclick="sendPrompterControl('fullscreen')">Full</button>
    </div>
  </div>`;
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
        : name === 'prepbear'
          ? 'linear-gradient(135deg,#080912 0%,#14172a 50%,#2f357c 100%)'
          : t.bg;
  document.documentElement.style.setProperty('--pt-bg', t.bg);
  document.documentElement.style.setProperty('--pt-text', t.text);
  document.documentElement.style.setProperty('--pt-accent', t.accent);
  document.documentElement.style.setProperty('--pt-ui-bg', t.uiBg);
  document.documentElement.style.setProperty('--pt-ui-border', t.uiBorder);
  try { localStorage.setItem('promptypus_theme', name); } catch {}
  document.querySelectorAll('.pt-theme-dot').forEach(d => d.classList.remove('active'));
  const dot = ptEl('pt-t-' + name);
  if (dot) dot.classList.add('active');
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

// Called by sendPrompterControl to mirror controls into the native prompter
// Apply a remote control exactly once, no matter how many transports deliver it
// or how often a Firestore snapshot re-fires. Dedup by a signature instead of a
// monotonic timestamp so clock skew between devices can't permanently wedge it.
function applyRemoteControlOnce(action, ts, sender, controlId='') {
  if (!action) return false;
  if (isPrompterSelfSender(sender)) return false;
  const sig = controlId || `${sender || ''}:${ts || 0}:${action}`;
  if (sig === _lastAppliedControlSig) return false;
  _lastAppliedControlSig = sig;
  ptHandleRemoteControl(action);
  ptPostControlAck(controlId, action, ts, sender);
  return true;
}

function ptHandleRemoteControl(action) {
  if (action?.startsWith('speed_set_')) { ptSetSpeed(action.replace('speed_set_', '')); return; }
  if (action?.startsWith('size_set_')) { ptSetSize(action.replace('size_set_', '')); return; }
  switch (action) {
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
    boost_start:'Boost', boost_stop:'Boost release'
  };
  if (action?.startsWith('theme_')) return `${CUEOLA_THEME_LABELS[action.replace('theme_', '')] || 'Theme'} theme`;
  if (action?.startsWith('speed_set_')) return `Speed ${action.replace('speed_set_', '')}`;
  if (action?.startsWith('size_set_')) return `Size ${action.replace('size_set_', '')}`;
  return labels[action] || action || 'Control';
}

function flowOpApplyControlPreview(action, quiet=false) {
  if (!action) return;
  if (action.startsWith('speed_set_')) {
    flowOpSetSpeed(action.replace('speed_set_', ''));
  } else if (action.startsWith('size_set_')) {
    flowOpSetSize(action.replace('size_set_', ''));
  } else if (action.startsWith('theme_')) {
    flowOpSetTheme(action.replace('theme_', ''));
  } else {
    switch (action) {
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

function flowOpControlsHTML(disabled=false) {
  const dis = disabled ? ' disabled' : '';
  const playAction = flowOpPlaying ? 'pause' : 'resume';
  const playLabel = flowOpPlaying ? 'PAUSE' : 'PLAY';
  const playIcon = flowOpPlaying ? PT_SVG_PAUSE : PT_SVG_PLAY;
  return `<div class="flowop-controls">
    <div class="pt-ctrl-group">
      <button class="pt-btn${flowOpPlaying?' active':''}" id="flowOpPlayBtn" onclick="flowOpSendControl('${playAction}')"${dis}>${playIcon} ${playLabel}</button>
    </div>
    <div class="pt-ctrl-group">
      <span class="pt-ctrl-label">Speed</span>
      <button class="pt-btn" onclick="flowOpSendControl('speed_down')"${dis}>−</button>
      <input type="range" class="pt-range" id="flowOpSpeedRange" min="5" max="200" value="${ptTargetSpeed}" oninput="flowOpApplyControlPreview('speed_set_'+this.value,true)" onchange="flowOpSendControl('speed_set_'+this.value,true)"${dis}>
      <button class="pt-btn" onclick="flowOpSendControl('speed_up')"${dis}>+</button>
    </div>
    <div class="pt-ctrl-group">
      <span class="pt-ctrl-label">Size</span>
      <button class="pt-btn" onclick="flowOpSendControl('size_down')"${dis}>−</button>
      <input type="range" class="pt-range" id="flowOpSizeRange" min="24" max="120" value="${ptFontSize}" oninput="flowOpApplyControlPreview('size_set_'+this.value,true)" onchange="flowOpSendControl('size_set_'+this.value,true)"${dis}>
      <button class="pt-btn" onclick="flowOpSendControl('size_up')"${dis}>+</button>
    </div>
    <div class="pt-ctrl-group">
      <span class="pt-ctrl-label">Align</span>
      <button class="pt-btn${ptAlign==='left'?' active':''}" data-flowop-align="left" onclick="flowOpSendControl('align_left')"${dis}><svg width="14" height="12" viewBox="0 0 14 12" fill="currentColor"><rect x="0" y="0" width="14" height="2" rx="1"/><rect x="0" y="5" width="9" height="2" rx="1"/><rect x="0" y="10" width="12" height="2" rx="1"/></svg></button>
      <button class="pt-btn${ptAlign==='center'?' active':''}" data-flowop-align="center" onclick="flowOpSendControl('align_center')"${dis}><svg width="14" height="12" viewBox="0 0 14 12" fill="currentColor"><rect x="0" y="0" width="14" height="2" rx="1"/><rect x="2.5" y="5" width="9" height="2" rx="1"/><rect x="1" y="10" width="12" height="2" rx="1"/></svg></button>
      <button class="pt-btn${ptAlign==='right'?' active':''}" data-flowop-align="right" onclick="flowOpSendControl('align_right')"${dis}><svg width="14" height="12" viewBox="0 0 14 12" fill="currentColor"><rect x="0" y="0" width="14" height="2" rx="1"/><rect x="5" y="5" width="9" height="2" rx="1"/><rect x="2" y="10" width="12" height="2" rx="1"/></svg></button>
    </div>
    <div class="pt-ctrl-group">
      <span class="pt-ctrl-label">Theme</span>
      ${CUEOLA_THEMES.map(name => `<button type="button" class="flowop-theme-dot${ptThemeName===name?' active':''}" data-flowop-theme="${name}" style="background:${PT_THEMES[name].bg}" onclick="flowOpSendControl('theme_${name}')" title="${CUEOLA_THEME_LABELS[name] || name}"${dis}></button>`).join('')}
    </div>
    <div class="pt-ctrl-group">
      <button class="pt-btn" onpointerdown="flowOpSendControl('brake_start')" onpointerup="flowOpSendControl('brake_stop')" onpointerleave="flowOpSendControl('brake_stop')"${dis}>Brake</button>
      <button class="pt-btn" onpointerdown="flowOpSendControl('boost_start')" onpointerup="flowOpSendControl('boost_stop')" onpointerleave="flowOpSendControl('boost_stop')"${dis}>Boost</button>
      <button class="pt-btn" onclick="flowOpSendControl('direction_reverse')"${dis}>Reverse</button>
      <button class="pt-btn" onclick="flowOpSendControl('direction_forward')"${dis}>Forward</button>
    </div>
    <div class="pt-ctrl-group">
      <button class="pt-btn" onclick="flowOpSendControl('reset')"${dis}>Reset</button>
      <button class="pt-btn" onclick="flowOpSendControl('hide_interface')"${dis}>Hide UI</button>
      <button class="pt-btn" onclick="flowOpSendControl('mirror')"${dis}>Mirror</button>
      <button class="pt-btn" onclick="flowOpSendControl('fullscreen')"${dis}>Full</button>
      <button class="pt-btn" onclick="openPrompterFromFlowOp()"${dis}>Talent</button>
    </div>
  </div>`;
}

function flowOpRenderControls(disabled=false) {
  const el = flowOpEl('flowOpControls');
  if (el) el.innerHTML = flowOpControlsHTML(disabled);
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
  });
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
  if (data?.prompter?.text && data.prompter.text.trim()) return data.prompter.text;
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
        if (text.trim()) {
          prompterText = text;
          // Only rebuild the talent script when the SOURCE actually changed. This
          // snapshot fires on EVERY session-doc write (talent heartbeats, presence,
          // clock, control acks), and ptSetScriptText() resets the scroll to the top.
          // The old render→source round-trip comparison was lossy, so it rebuilt on
          // nearly every write — the script appeared to load, then restart every
          // couple of seconds. Compare the stable source string instead.
          if (text !== ptLastCueolaScript) {
            ptLastCueolaScript = text;
            ptSetScriptText(text);
          }
          const ta = ptEl('pt-script-input');
          if (ta) ta.value = text.trim();
          ptSetCueolaStatus(`READY · ${code}`);
          ptUpdateSyncLabel();
          if (!loadedOnce) {
            loadedOnce = true;
            setTimeout(ptCloseEdit, 550);
            toast(`Flowmingo ready for ${code}`);
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
  document.getElementById('liveshow')?.classList.toggle('prompt-op-active', promptOpMode);
  const btn = document.getElementById('promptOpBtn');
  if (btn) {
    if (promptOpMode) {
      btn.style.color = 'var(--cyan)';
      btn.style.borderColor = 'var(--cyan)';
      btn.style.background = 'color-mix(in srgb,var(--cyan) 12%,transparent)';
      setSymbolButtonLabel(btn, 'action.grid', 'Rundown View');
    } else {
      btn.style.color = '';
      btn.style.borderColor = '';
      btn.style.background = '';
      btn.textContent = '🦩 Flowmingo Op';
    }
  }
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
      <div class="prompt-op-text">${script ? scriptToFormattedHTML(script) : 'No script loaded.\n\nUse Script, add script in Build, or push from the live Flowmingo text.'}</div>
    </div>
    ${promptOpControlsHTML()}
  </div>`;
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
function applyTheme(t) { document.documentElement.setAttribute('data-theme', normalizeCueolaTheme(t)); }

function applyPlandaBearTheme(t) {
  plandaBearTheme = normalizePlandaBearTheme(t);
  document.documentElement.setAttribute('data-plandabear-theme', plandaBearTheme);
  document.querySelectorAll('[data-plandabear-theme-choice]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.plandabearThemeChoice === plandaBearTheme);
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
  document.querySelectorAll('#modal-settings .theme-swatch').forEach(s=>s.classList.toggle('active', s.dataset.theme===t));
  applyTheme(currentTheme); // live preview — reverted on Cancel, saved on Save
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
    document.querySelectorAll('#modal-settings .theme-swatch').forEach(s=>s.classList.toggle('active', s.dataset.theme===saved));
  }
  document.getElementById(id).classList.add('on');
};

// ─────────────────────────────────────────────────────────────
// CALL SHEET
// ─────────────────────────────────────────────────────────────
const PAPERWORK_ITEMS = [
  { order:1, id:'call-sheet', title:'Call Sheet', sub:'Production details, crew, talent, location, and schedule.' },
  { order:2, id:'production-scheduler', title:'Production Schedule', sub:'Setup day, show day, and the final ready-before-show checklist.' },
  { order:3, id:'safety-plan', title:'Safety Plan', sub:'Emergency contacts, safety locations, weather, and equipment.' },
  { order:4, id:'rundown', title:'Full Rendered Rundown', sub:'The complete show rundown with every cue rendered out.' },
  { order:5, id:'video-patch', title:'Video Patch Sheet', sub:'Editable row grid for label, destination, source, cabling, and notes.' },
  { order:6, id:'audio-comms-patch', title:'Audio and Comms Patch Sheets', sub:'Editable audio routing and comms assignment grids.' },
  { order:7, id:'production-notes', title:'Production Notes', sub:'Team discussion board — post notes, tag departments, reply in threads, export anything.' },
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
  window._updateDoc(ref, { prePro:data }).catch(()=>{});
  if (section && !_pbSuppressActivity && window._arrayUnion) {
    const entry = { section, by: preProActor(), clientId: CLIENT_ID, at: Date.now() };
    window._updateDoc(ref, { preProActivity: window._arrayUnion(entry) }).catch(()=>{});
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
    const avatar = p => `<span class="pb-collab-avatar ${p.role === 'instructor' ? 'inst' : 'stud'}" title="${esc(p.name)}${p.pbPage && p.pbPage !== pageId ? ' — ' + esc(PB_PAGE_LABELS[p.pbPage] || p.pbPage) : ' — on this page'}">${esc(pbInitials(p.name))}</span>`;
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

// Update a scalar field from the latest cloud data, unless the user is in it.
function pbSetFieldIfIdle(id, val) {
  const el = document.getElementById(id);
  if (!el || el === document.activeElement) return;
  if (el.value !== val) el.value = val;
}

function pbRefreshSafetyFields() {
  const data = loadPreProData();
  const safety = data.safety || {};
  const wxNote = typeof safety.weather === 'string' ? safety.weather : '';
  pbSetFieldIfIdle('sp-hospital', safety.hospital || data.hospital || '');
  pbSetFieldIfIdle('sp-weather', wxNote || weatherCuteSummary(activeCallSheetWeather(data)) || (typeof data.weather === 'string' ? data.weather : '') || '');
  pbSetFieldIfIdle('sp-first-aid', safety.firstAid || '');
  pbSetFieldIfIdle('sp-fire', safety.fire || '');
  pbSetFieldIfIdle('sp-emergency', safety.emergency || '');
  pbSetFieldIfIdle('sp-nonemergency', safety.nonemergency || '');
  pbSetFieldIfIdle('sp-security', safety.security || '8822');
  pbSetFieldIfIdle('sp-late', safety.late || data.late || '');
  pbSetFieldIfIdle('sp-equipment', safety.equipment || data.equipment || '');
  pbSetFieldIfIdle('sp-notes', safety.notes || '');
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
    modal.addEventListener('input', e => {
      if (!pbIsCollabField(e.target)) return;
      paperworkDirty = true;
      clearTimeout(_pbFieldSaveTimer);
      _pbFieldSaveTimer = setTimeout(() => {
        // Merge in collaborators' latest values before saving so two people on
        // the same page editing different fields don't overwrite each other.
        pbRefreshOpenPaperworkFields();
        _pbSuppressActivity = true;
        try { saveOpenPaperworkSection(false); } finally { _pbSuppressActivity = false; }
      }, 650);
    });
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
  const saveButton = id === 'rundown' ? '' : `<button type="button" class="save" onclick="savePaperworkItem('${item.id}',true)">Save Progress</button>`;
  const previewButton = slotId === 'pbNavPreview' ? '' : `<button type="button" onclick="previewPaperworkItem('${item.id}')">Preview</button>`;
  slot.innerHTML = `
    <div class="paperwork-flow-left">
      <button type="button" onclick="returnToPaperworkHub()">Back to Planda Bear</button>
      <button type="button" onclick="openPaperworkRelative(-1)" ${isFirst ? 'disabled' : ''}>Previous</button>
    </div>
    <div class="pb-step-pill">Step ${item.order} of ${PAPERWORK_ITEMS.length}</div>
    <div class="paperwork-flow-right">
      ${saveButton}
      ${previewButton}
      <button type="button" class="primary" onclick="openPaperworkRelative(1)">${isLast ? 'Finish' : 'Next'}</button>
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
    showModal('modal-prepro-join');
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
  window._updateDoc(ref, { preProComments: plandaBearComments }).catch(()=>{});
  if (activitySection && window._arrayUnion) {
    const entry = { section:activitySection, by:preProActor(), clientId:CLIENT_ID, at:Date.now() };
    window._updateDoc(ref, { preProActivity: window._arrayUnion(entry) }).catch(()=>{});
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
      ? 'Review instructor feedback and mark comments reviewed after you have made changes or talked through the note.'
      : 'No instructor comments yet.';
    const instructorCopy = 'Leave feedback for students without changing their paperwork.';
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
        }).join('') : `<div class="pb-comment-empty">${canComment ? 'No comments yet. Add one for students when you review this work.' : 'No instructor comments have been added for this section.'}</div>`}
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
const pbNoteFileCache = new Map(); // fileId -> dataURL

const PB_NOTE_TAGS = {
  general:  { label:'General',  symbol:'content.note' },
  audio:    { label:'Audio',    symbol:'department.audio' },
  video:    { label:'Video',    symbol:'department.video' },
  lighting: { label:'Lighting', symbol:'department.lighting' },
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
    fileId: String(a?.fileId || ''),
    name: String(a?.name || 'file').slice(0, 120),
    type: String(a?.type || ''),
    size: Number(a?.size) || 0,
    isImage: Boolean(a?.isImage),
    w: Number(a?.w) || 0,
    h: Number(a?.h) || 0,
  };
}

function normalizePlandaBearNote(n) {
  // `kind:'todo'` is the legacy field from the chat-style log — map it to a tag.
  const tag = PB_NOTE_TAGS[n?.tag] ? n.tag : (n?.kind === 'todo' ? 'todo' : 'general');
  return {
    id: n?.id || `pbn_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,7)}`,
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
    likes: Array.isArray(n?.likes) ? Array.from(new Set(n.likes.filter(x => typeof x === 'string'))) : [],
    attachments: Array.isArray(n?.attachments) ? n.attachments.map(pbNormalizeNoteAttachment).filter(a => a.fileId) : [],
  };
}

function pbNoteHasContent(n) {
  return Boolean(n && (n.text || (n.attachments && n.attachments.length)));
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
  } catch {
    plandaBearNotes = localPlandaBearNotes();
  }
  return plandaBearNotes;
}

async function writePlandaBearNotes(notes, activitySection='Production Note') {
  plandaBearNotes = notes.map(normalizePlandaBearNote).filter(pbNoteHasContent);
  saveLocalPlandaBearNotes(plandaBearNotes);
  if (!window._firebaseReady || !session.code || session.isDemo || session.isExpert) return;
  const ref = window._doc(window._db, 'sessions', session.code);
  window._updateDoc(ref, { preProNotes: plandaBearNotes }).catch(()=>{});
  if (activitySection && window._arrayUnion) {
    const entry = { section:activitySection, by:preProActor(), clientId:CLIENT_ID, at:Date.now() };
    window._updateDoc(ref, { preProActivity: window._arrayUnion(entry) }).catch(()=>{});
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
  return html;
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
  const mod = e.metaKey || e.ctrlKey;
  if (mod && e.key === 'Enter') { e.preventDefault(); publishPlandaBearNote(); return; }
  if (mod && (e.key === 'b' || e.key === 'B')) { e.preventDefault(); pbFmtWrap('**', '**'); return; }
  if (mod && (e.key === 'i' || e.key === 'I')) { e.preventDefault(); pbFmtWrap('*', '*'); return; }
  // plain Enter inserts a new line (default textarea behavior)
}

function openProductionNotes() {
  activePaperworkItemId = 'production-notes';
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
  board.classList.add('composing');
  const input = document.getElementById('pbNoteInput');
  if (input) {
    requestAnimationFrame(() => { pbAutosizeNoteInput(input); input.focus(); });
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
  return { fileId, name: file.name || 'file', type: file.type || '', size: file.size || 0, isImage: false, w: 0, h: 0, dataUrl };
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
      ${a.isImage ? `<img src="${a.dataUrl}" alt="">` : `<span class="pb-file-ico">${sfIcon(pbFileSymbol(a))}</span>`}
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

// Names we can assign a To-Do to: everyone present + everyone on the roster.
function pbAssigneeOptions() {
  const names = new Set();
  try { getActivePresencePeople().forEach(p => p?.name && names.add(p.name.trim())); } catch {}
  (sessionParticipantNames || []).forEach(n => n && names.add(String(n).trim()));
  const me = (session.userName || '').trim();
  if (me) names.add(me);
  return Array.from(names).filter(Boolean);
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
  pbRenderComposerTags();
}

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
  if (!text && !atts.length) { input?.focus(); toast('Type a note or attach a file first.'); return; }
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
      attachments: atts.map(({ fileId, name, type, size, isImage, w, h }) => ({ fileId, name, type, size, isImage, w, h })),
    });
    await writePlandaBearNotes([...plandaBearNotes, note], pbComposerTag === 'todo' ? 'To-Do Posted' : 'Production Note');
    if (input) { input.value = ''; pbAutosizeNoteInput(input); }
    pbPendingAttachments = [];
    pbRenderAttachTray('main');
    pbComposerTag = 'general';
    pbComposerAssignee = '';
    pbRenderComposerTags();
    try { localStorage.removeItem(productionNoteDraftKey()); } catch {}
    pbCloseComposer();
    renderPlandaBearNotes();
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
  if (!confirm(msg)) return;
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
  return `<button type="button" class="pb-file-chip" onclick="pbDownloadNoteFile('${att.fileId}')" title="Download this file">
    <span class="pb-file-ico">${sfIcon(pbFileSymbol(att))}</span>
    <span class="pb-file-meta"><span class="pb-file-name">${esc(att.name)}</span><span class="pb-file-size">${esc(pbFileSize(att.size))}</span></span>
    <span class="pb-file-dl">${sfIcon('action.download')}</span>
  </button>`;
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
    <span class="pb-note-avatar" style="background:${pbAvatarColor(note)}">${esc(pbInitials(note.by))}</span>
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

function pbNoteBodyHTML(note) {
  if (note.id === pbEditingNoteId) return `<div class="pb-note-body">${pbEditBoxHTML(note)}</div>`;
  const check = note.tag === 'todo' ? pbTodoCheckHTML(note) : '';
  const text = note.text ? `<div class="pb-note-text">${pbRenderRichText(note.text)}</div>` : '';
  const atts = (note.attachments || []).length
    ? `<div class="pb-note-attachments">${note.attachments.map(pbAttachmentHTML).join('')}</div>`
    : '';
  return `<div class="pb-note-body">${check}<div class="pb-note-main">${text}${atts}</div></div>`;
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
    ${pbIsInstructor() ? `<button type="button" class="pb-note-act" onclick="pbTogglePin('${note.id}')">${note.pinned ? '📌 Unpin' : '📌 Pin'}</button>` : ''}
    <button type="button" class="pb-note-act" onclick="exportProductionNoteById('${note.id}')">${sfIcon('action.download')} PDF</button>
    ${pbCanManageNote(note) ? `<button type="button" class="pb-note-act danger" onclick="deletePlandaBearNote('${note.id}')">${sfIcon('action.delete')} Delete</button>` : ''}
  </footer>`;
}

function pbReplyHTML(reply) {
  const mine = reply.clientId && reply.clientId === CLIENT_ID;
  const avatar = `<span class="pb-reply-avatar" style="background:${pbAvatarColor(reply)}">${esc(pbInitials(reply.by))}</span>`;
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
      <textarea id="pbReplyInput" rows="1" placeholder="Reply to ${esc(root.by)}…" oninput="pbAutosizeNoteInput(this)" onkeydown="pbReplyKeydown(event,'${root.id}')" onpaste="pbNotePaste(event,'reply')"></textarea>
      <button type="button" class="pb-reply-attach" onclick="document.getElementById('pbReplyFileInput').click()" title="Attach to reply" aria-label="Attach to reply">${sfIcon('action.attach')}</button>
      <input type="file" id="pbReplyFileInput" hidden multiple accept="image/*,.pdf,.doc,.docx,.txt,.md,.csv,.rtf,.pages,.key,.numbers,.xls,.xlsx,.ppt,.pptx" onchange="pbHandleNoteFiles(this,'reply')">
      <button type="button" class="pb-post-btn small" onclick="pbPostReply('${root.id}')"><span>Reply</span>${sfIcon('action.forward')}</button>
      <button type="button" class="pb-note-act" onclick="pbCancelReply()">Cancel</button>
    </div>
  </div>`;
}

function pbThreadHTML(t) {
  const root = t.root;
  const repliesOpen = t.replies.length || pbReplyTargetId === root.id;
  const classes = ['pb-thread'];
  if (root.pinned) classes.push('pinned');
  if (root.tag === 'todo' && root.done) classes.push('done');
  return `<article class="${classes.join(' ')}" data-note-id="${root.id}">
    ${root.pinned ? '<div class="pb-pin-flag">📌 Pinned</div>' : ''}
    ${pbNoteHeadHTML(root)}
    ${pbNoteBodyHTML(root)}
    ${pbNoteFootHTML(root, t.replies.length)}
    ${repliesOpen ? `<div class="pb-replies">${t.replies.map(pbReplyHTML).join('')}${pbReplyComposerHTML(root)}</div>` : ''}
  </article>`;
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
    slot.innerHTML = `<div class="pb-note-empty"><span class="pb-note-empty-ico">${sfIcon('content.note')}</span><b>No notes yet</b><span>Start the board — post the first note, share a photo, or drop in a document. Everyone on this session sees the same board, live.</span></div>`;
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

function toggleNotifCenter(e) {
  e?.stopPropagation?.();
  const panel = document.getElementById('notifPanel');
  if (!panel) return;
  if (panel.hidden) {
    notifPanelSince = pbGetLastRead();      // freeze the unread cutoff while the panel is open
    renderNotifCenter(notifPanelSince);     // highlight what was unread before this open
    panel.hidden = false;
    // The panel is position:fixed (so the toolbar's overflow can't clip it) — anchor it under the bell.
    const bell = document.getElementById('notifBellBtn');
    if (bell) {
      const r = bell.getBoundingClientRect();
      panel.style.top = `${Math.round(r.bottom + 8)}px`;
      panel.style.right = `${Math.round(Math.max(8, window.innerWidth - r.right))}px`;
    }
    document.getElementById('notifBellBtn')?.classList.add('on');
    pbMarkNotesRead();                       // clears the badge (panel keeps its highlight)
    setTimeout(() => document.addEventListener('click', notifOutside, { once: true }), 0);
  } else {
    closeNotifCenter();
  }
}

function notifOutside(e) {
  if (e.target.closest?.('#notifCenter')) {
    document.addEventListener('click', notifOutside, { once: true });
    return;
  }
  closeNotifCenter();
}

function closeNotifCenter() {
  const panel = document.getElementById('notifPanel');
  if (panel) panel.hidden = true;
  document.getElementById('notifBellBtn')?.classList.remove('on');
}

function markAllNotifsRead() {
  pbMarkNotesRead();
  renderNotifCenter(Date.now());
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

function pbNoteNotifyText(note) {
  const who = note.by || 'Someone';
  const snippet = pbStripMarkdown(note.text || '').replace(/\s+/g, ' ').trim().slice(0, 80);
  const tail = snippet ? `: “${snippet}”` : '';
  const repliesToMine = note.replyTo && plandaBearNotes.some(p => p.id === note.replyTo && pbIsMine(p));
  if (repliesToMine) return `${who} replied to your note${tail}`;
  if (note.replyTo) return `${who} replied in Production Notes${tail}`;
  const tag = PB_NOTE_TAGS[note.tag];
  const kind = tag && note.tag !== 'general' ? ` a ${tag.label} note` : '';
  return `${who} posted${kind}${tail}`;
}

function pbFireNoteNotifications(fresh) {
  if (!fresh.length || pbNotesBoardOpen()) return;
  const replyToYou = fresh.find(n => n.replyTo && plandaBearNotes.some(p => p.id === n.replyTo && pbIsMine(p)));
  const lead = replyToYou || fresh[fresh.length - 1];
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
      const dataUrl = pbNoteFileCache.get(a.fileId) || '';
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
  primary.textContent = primaryLabel;
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
  const rows = beats.map((b,i) => {
    const start = show.start ? clock(show.start, offsetSecs) : '-';
    offsetSecs += (b.min||0)*60+(b.sec||0);
    return `<tr>
      <td>${i+1}</td>
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
  setTimeInputValue('pp-call', data.call, show.start);
  const showNA = data.showStart === 'N/A';
  setShowNotApplicable(showNA);
  if (!showNA) setTimeInputValue('pp-show-start', data.showStart, show.start);
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

// Cute one-liner with weather icons — for on-screen use (HTML preview, the
// safety-plan field, the html2canvas package PDF where emoji render fine).
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

// The active call sheet's weather object (used to auto-fill the safety plan).
function activeCallSheetWeather(data) {
  const sheets = getCallSheets(data);
  const idx = Math.max(0, Math.min(Number(data?.activeCallSheetIndex ?? activeCallSheetIndex) || 0, sheets.length - 1));
  return sheets[idx]?.weather || null;
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

async function fetchCallSheetWeather() {
  const btn = document.getElementById('pp-weather-fetch-btn');
  const location = document.getElementById('pp-location')?.value?.trim() || '';
  const date = document.getElementById('pp-date')?.value || '';
  if (!location) { setWeatherStatus('Add a location first, then get the forecast.', true); document.getElementById('pp-location')?.focus(); return; }
  if (!date) { setWeatherStatus('Add a shoot date first, then get the forecast.', true); document.getElementById('pp-date')?.focus(); return; }
  if (btn) btn.disabled = true;
  setWeatherStatus('Finding location…');
  try {
    // The geocoder matches plain place names only — "Austin, TX" finds nothing.
    // Try the full string first, then fall back to the part before the comma.
    const geoQueries = [location];
    const beforeComma = location.split(',')[0].trim();
    if (beforeComma && beforeComma !== location) geoQueries.push(beforeComma);
    let place = null;
    for (const q of geoQueries) {
      const geoRes = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=1&language=en&format=json`);
      if (!geoRes.ok) throw new Error('geo');
      place = (await geoRes.json())?.results?.[0];
      if (place) break;
    }
    if (!place) { setWeatherStatus(`Couldn't find "${location}". Check the spelling or enter weather manually below.`, true); return; }
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
  const legacyTopWeather = typeof data.weather === 'string' ? data.weather : '';
  document.getElementById('sp-weather').value = safetyWeatherNote || weatherCuteSummary(activeCallSheetWeather(data)) || legacyTopWeather || '';
  document.getElementById('sp-first-aid').value = safety.firstAid || '';
  document.getElementById('sp-fire').value = safety.fire || '';
  document.getElementById('sp-emergency').value = safety.emergency || '';
  document.getElementById('sp-nonemergency').value = safety.nonemergency || '';
  document.getElementById('sp-security').value = safety.security || '8822';
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
  const wxVal = document.getElementById('sp-weather')?.value?.trim() ?? existingWeather ?? '';
  const wxAuto = weatherCuteSummary(activeCallSheetWeather(data));
  return {
    hospital: document.getElementById('sp-hospital')?.value?.trim() ?? existing.hospital ?? '',
    weather: (wxAuto && wxVal === wxAuto) ? '' : wxVal,
    firstAid: document.getElementById('sp-first-aid')?.value?.trim() ?? existing.firstAid ?? '',
    fire: document.getElementById('sp-fire')?.value?.trim() ?? existing.fire ?? '',
    emergency: document.getElementById('sp-emergency')?.value?.trim() ?? existing.emergency ?? '',
    nonemergency: document.getElementById('sp-nonemergency')?.value?.trim() ?? existing.nonemergency ?? '',
    security: document.getElementById('sp-security')?.value?.trim() || existing.security || '8822',
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
  return `
    <h1>3. Safety Plan</h1>
    <div>Item 3</div>
    <table><tbody>
      <tr><th>Local Hospital</th><td>${esc(safety.hospital || '')}</td></tr>
      <tr><th>Weather</th><td>${esc(safety.weather || weatherCuteSummary(activeCallSheetWeather(loadPreProData())))}</td></tr>
      <tr><th>First Aid Kit Location</th><td>${esc(safety.firstAid || '')}</td></tr>
      <tr><th>Fire Extinguisher Location</th><td>${esc(safety.fire || '')}</td></tr>
      <tr><th>Emergency Numbers</th><td>${esc(safety.emergency || '')}</td></tr>
      <tr><th>Non-Emergency Numbers</th><td>${esc(safety.nonemergency || '')}</td></tr>
      <tr><th>Security</th><td>${esc(safety.security || '8822')}</td></tr>
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
    call: normalizeTimeValue(base.call) || normalizeTimeValue(callSheet.call),
    show: normalizeTimeValue(base.show) || normalizeTimeValue(callSheet.showStart) || normalizeTimeValue(show.start),
    doors: base.doors || callSheet.doors || '',
    location: base.location || callSheet.location || '',
    address: base.address || callSheet.address || '',
    checklist: base.checklist.map(normalizeProductionChecklistRow),
  };
}

function productionChecklistGuideOptions() {
  return PRODUCTION_CHECKLIST_GUIDES
    .map(row => `<option value="${esc(row.area)}">${esc(row.area)}</option>`)
    .join('');
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
    <button class="call-add-btn" onclick="addProductionChecklistRow()">+ Add checklist item</button>
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

function addProductionChecklistGuidedRow() {
  const current = getProductionScheduleData();
  const selected = document.getElementById('ps-guide-select')?.value || '';
  const used = new Set((current.checklist || []).map(row => String(row.area || '').toLowerCase()));
  const guide = guideForProductionArea(selected) ||
    PRODUCTION_CHECKLIST_GUIDES.find(row => !used.has(row.area.toLowerCase())) ||
    PRODUCTION_CHECKLIST_GUIDES[0];
  current.checklist.push({ area:guide.area, item:'', hint:guide.hint, done:false });
  renderProductionChecklist(current.checklist);
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
  return `<input class="field-in" data-patch-kind="${kind}" data-patch-row="${row}" data-patch-field="${field}" value="${esc(value || '')}" placeholder="${field === 'label' ? 'Label' : field}">`;
}

function renderPatchTable(kind, title) {
  const rows = getPatchRows(kind);
  const isComms = kind === 'comms';
  const heads = isComms ? ['Position','Out','Gear','Notes'] : ['Label','Destination','Source','Cabling','Notes'];
  return `
    <div class="field">
      <label class="field-lbl">${title}</label>
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
      <button class="call-add-btn" onclick="addPatchRow('${kind}')">+ Add row</button>
      <input class="field-in" type="file" accept=".csv,.tsv,.txt" onchange="importPatchRows('${kind}',this)" style="margin-top:8px">
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

function savePatchRows(kind, rows) {
  persistPreProData({ [`${kind}PatchRows`]: rows.length ? rows : defaultPatchRows(kind) }, kind === 'video' ? 'Video Patch' : 'Audio & Comms Patch');
}

function openPatchSheetEditor(kind) {
  activePatchKind = kind;
  activePaperworkItemId = kind === 'video' ? 'video-patch' : 'audio-comms-patch';
  hideModal('paperworkHubModal');
  const isVideo = kind === 'video';
  document.getElementById('patchSheetTitle').textContent = isVideo ? 'Video Patch Sheet' : 'Audio and Comms Patch Sheets';
  document.getElementById('patchSheetSub').textContent = 'Add rows manually or upload a CSV/TSV. Imported columns fill left to right.';
  const saveBtn = document.getElementById('patchSheetSaveBtn');
  if (saveBtn) saveBtn.textContent = isVideo ? 'Save Video Patch Sheet' : 'Save Audio and Comms Patch Sheets';
  document.getElementById('patchSheetBody').innerHTML = isVideo
    ? renderPatchTable('video', 'Video Patch Sheet')
    : renderPatchTable('audio', 'Audio Patch Sheet') + renderPatchTable('comms', 'Comms Patch Sheet');
  renderPaperworkNav(activePaperworkItemId);
  renderPlandaBearComments(isVideo ? 'Video Patch' : 'Audio & Comms Patch', 'pbCommentsPatch');
  showModal('patchSheetModal');
}

function addPatchRow(kind) {
  savePatchRows(kind, collectPatchRows(kind, true).concat(defaultPatchRows(kind)));
  openPatchSheetEditor(activePatchKind || kind);
}

function removePatchRow(kind, idx) {
  const rows = collectPatchRows(kind, true);
  rows.splice(idx, 1);
  savePatchRows(kind, rows);
  openPatchSheetEditor(activePatchKind || kind);
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
    const rows = lines.map(line => {
      const cols = line.includes('\t') ? line.split('\t') : line.split(',');
      if (kind === 'comms') return { position:cols[0]||'', out:cols[1]||'', gear:cols[2]||'', notes:cols.slice(3).join(', ')||'' };
      return { label:cols[0]||'', destination:cols[1]||'', source:cols[2]||'', cabling:cols[3]||'', notes:cols.slice(4).join(', ')||'' };
    });
    savePatchRows(kind, rows);
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

function showPreProPackagePreview() {
  loadPlandaBearNotes().then(() => {
    showPaperPreview('PDF Package Preview', preProPackageHTML(), 'Export One PDF Package', 'exportPreProPackagePDF()', null);
  });
}

function preProPackageHTML() {
  const data = loadPreProData();
  const safety = data.safety || {};
  const schedule = productionScheduleWithCallSheet(data.productionSchedule || {}, data);
  const callSheets = getCallSheets(data);
  const callSheetSections = callSheets.map((sheet, i) => `
    ${i > 0 ? '<div class="paper-page-break"></div>' : ''}
    <section>${callSheetPreviewHTML(sheet)}</section>
  `).join('');
  return `
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
    <div class="paper-page-break"></div>
    <section>${productionNotesThreadHTML()}</section>
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
  if (showToastOnSave) toast('Call sheet saved.');
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
  syncCallSheetPeopleFromDOM();
  callSheetPeople.splice(idx, 1);
  if (!callSheetPeople.length) callSheetPeople.push({ name:'', position:'', email:'', phone:'', call:'' });
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
      await exportPaperHTMLAsPDF(preProPackageHTML(), `${cleanPreviewName}-plandabear-package.pdf`);
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
      field(labels[key], safety[key] || (key === 'security' ? '8822' : ''));
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
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
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

(function autoJoinFromDashboard() {
  const params = new URLSearchParams(window.location.search);
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
