'use strict';

// Production-readiness build (CUEOLA MASTER PLAN phases 0–8) — see CHANGELOG.md.
const CUEOLA_VERSION = '2.0.0';
window.CUEOLA_VERSION = CUEOLA_VERSION;
// The live session code, readable by sibling modules (Outrangutan's join
// prefill) — `session` is a top-level `let` in a classic script, so it never
// lands on window by itself.
Object.defineProperty(window, 'cueolaActiveSessionCode', {
  get() { try { return (session && session.code && !session.isDemo && !session.isExpert) ? session.code : ''; } catch { return ''; } },
});

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
let session = { code:'', role:'', userName:'', profileId:'', username:'', profileAliases:[], isDemo:false, isExpert:false };
let lsIdx = -1; // compatibility projection of liveSessionController.selectedCueIndex
let lastLiveStatusAnnouncement = '';
let cloudSyncProjection = { state:'off', detail:'No shared session code.' };

const LIVE_STATUS_SURFACES = Object.freeze({
  prompter:{ id:'ls-status-flowmingo', actions:'ls-status-flowmingo-actions', label:'Flowmingo' },
  playback:{ id:'ls-status-playback', actions:'ls-status-playback-actions', label:'Playback' },
  scriptOperator:{ id:'ls-status-script', actions:'ls-status-script-actions', label:'Script Operator' },
  sync:{ id:'ls-status-sync', actions:'ls-status-sync-actions', label:'Cloud sync' },
});

const liveSessionController = window.CueolaLiveSession.createController({
  onEnter: enterLiveSessionScreen,
  onLeave: leaveLiveSessionScreen,
  onStateChange: projectLiveSessionState,
  onError: (label, error) => containError(label, error),
});
window.CueolaLiveController = liveSessionController;

function signedInProfileForName(name='') {
  const profile = window.CueolaIdentity?.profile?.();
  if (!profile?.fullName) return null;
  return sameParticipantName(profile.fullName, name || profile.fullName) ? profile : null;
}

function sessionWithProfileIdentity(base, name='') {
  const profile = signedInProfileForName(name);
  if (!profile) return {
    ...base,
    profileId: base.profileId || '',
    username: base.username || '',
    profileAliases: Array.isArray(base.profileAliases) ? base.profileAliases.slice() : [],
  };
  const model = window.CueolaAssignmentModel;
  const profileId = model?.profileIdFor?.(profile) || profile.profileId || '';
  const profileAliases = model?.profileIdentityIds?.(profile)?.filter(id => id !== profileId)
    || (Array.isArray(profile.profileAliases) ? profile.profileAliases.slice() : []);
  return {
    ...base,
    userName: profile.fullName,
    profileId,
    username: profile.username || '',
    profileAliases,
  };
}

function projectLiveSessionState(state) {
  const live = document.getElementById('liveshow');
  if (!live) return;
  live.dataset.liveSessionState = state.lifecycle;
  live.classList.toggle('live-transitioning', !['builder','live'].includes(state.lifecycle));
  const returnButton = document.getElementById('liveReturnToRundownBtn');
  if (returnButton) {
    returnButton.disabled = state.lifecycle !== 'live';
    returnButton.setAttribute('aria-disabled', state.lifecycle === 'live' ? 'false' : 'true');
  }
  Object.entries(state.subsystems).forEach(([name, record]) => {
    live.dataset[`${name}Status`] = record.status;
  });
  renderLiveStatusRail(state);
  updateLiveGoControl(state);
}

function liveStatusNeedsRecovery(status) {
  return ['stalled','disconnected','error'].includes(status);
}

function liveStatusIsBusy(status) {
  return ['opening','connecting','recovering'].includes(status);
}

function liveStatusActionLabel(name, status) {
  if (name === 'sync') return liveStatusNeedsRecovery(status) || status === 'recovering' ? 'Retry cloud sync' : '';
  if (name === 'prompter') {
    if (liveStatusNeedsRecovery(status) || status === 'recovering') return 'Recover Flowmingo';
    return status === 'closed' ? 'Open Flowmingo' : '';
  }
  if (liveStatusIsBusy(status)) return '';
  if (name === 'playback') return liveStatusNeedsRecovery(status) ? 'Recover Playback' : status === 'closed' ? 'Open Playback' : '';
  if (name === 'scriptOperator') {
    if (session.isDemo || session.isExpert || !session.code) return '';
    return liveStatusNeedsRecovery(status) ? 'Recover Script Operator' : status === 'closed' ? 'Open Script Operator' : '';
  }
  return '';
}

function renderLiveStatusItem(name, record) {
  const surface = LIVE_STATUS_SURFACES[name];
  if (!surface) return;
  const item = document.getElementById(surface.id);
  if (!item) return;
  const status = String(record?.status || 'closed');
  const detail = String(record?.detail || (status === 'closed' ? `${surface.label} closed` : status));
  item.dataset.state = status;
  item.setAttribute('aria-label', `${surface.label}: ${detail}`);
  const detailEl = document.getElementById(`${surface.id}-detail`);
  if (detailEl) detailEl.textContent = detail;
  if (name === 'scriptOperator') {
    const overview = document.getElementById('ls-stat-script');
    if (overview) {
      const label = { active:'ACTIVE', ready:'READY', opening:'OPENING', connecting:'CONNECTING', recovering:'RECOVERING', disconnected:'DISCONNECTED', stalled:'STALLED', error:'ERROR', closed:'CLOSED' }[status] || status.toUpperCase();
      overview.textContent = `SCRIPT OP ${label}`;
      overview.title = detail;
      overview.classList.toggle('connected', ['active','ready'].includes(status));
      overview.classList.toggle('recovering', liveStatusIsBusy(status));
      overview.classList.toggle('error', liveStatusNeedsRecovery(status));
    }
  }
  const actions = document.getElementById(surface.actions);
  if (!actions) return;
  const actionLabel = liveStatusActionLabel(name, status);
  actions.hidden = !actionLabel;
  const existing = actions.querySelector('button');
  if (!actionLabel) {
    if (existing) actions.replaceChildren();
    return;
  }
  if (existing?.dataset.actionLabel === actionLabel) return;
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'ls-status-recovery';
  button.dataset.actionLabel = actionLabel;
  button.textContent = actionLabel;
  button.title = actionLabel;
  button.setAttribute('aria-label', actionLabel);
  button.addEventListener('click', () => recoverLiveSubsystem(name));
  actions.replaceChildren(button);
}

function liveSyncStatusRecord() {
  const reconnecting = document.getElementById('ls-stat-sync')?.hidden === false;
  if (reconnecting || navigator.onLine === false) {
    return {
      status:navigator.onLine === false ? 'disconnected' : 'recovering',
      detail:navigator.onLine === false ? 'Network offline — saved state is retained locally' : 'Reconnecting — showing the last confirmed state',
    };
  }
  if (session.isDemo || session.isExpert || !session.code) return { status:'ready', detail:'Local workspace' };
  const state = cloudSyncProjection.state;
  const detail = cloudSyncProjection.detail;
  if (state === 'synced') return { status:'ready', detail:detail || 'Cloud synchronized' };
  if (state === 'saving') return { status:'connecting', detail:detail || 'Cloud sync saving changes...' };
  if (state === 'error') return { status:'error', detail:detail || 'Cloud sync failed' };
  if (state === 'local') return { status:'disconnected', detail:detail || 'Cloud sync unavailable; saved locally' };
  return { status:'disconnected', detail:detail || 'Cloud sync is not connected' };
}

function renderLiveStatusRail(state=liveSessionController?.getState?.()) {
  if (!state) return;
  Object.entries(state.subsystems || {}).forEach(([name, record]) => renderLiveStatusItem(name, record));
  const syncRecord = liveSyncStatusRecord();
  renderLiveStatusItem('sync', syncRecord);
  const problems = [
    ...Object.entries(state.subsystems || {}),
    ['sync', syncRecord],
  ].filter(([, record]) => liveStatusNeedsRecovery(record?.status));
  const announcement = problems.map(([name, record]) => `${LIVE_STATUS_SURFACES[name]?.label || name}: ${record.detail || record.status}`).join('. ');
  if (announcement && announcement !== lastLiveStatusAnnouncement) {
    const liveRegion = document.getElementById('lsStatusAnnouncement');
    if (liveRegion) liveRegion.textContent = announcement;
  }
  lastLiveStatusAnnouncement = announcement;
}

async function recoverLiveSubsystem(name) {
  if (name === 'prompter') {
    projectPrompterSessionStatus('recovering', 'Opening a fresh Flowmingo output');
    return openFlowmingoTalentWindow({ replace:true });
  }
  if (name === 'playback') {
    setLiveSubsystemStatus('playback', 'recovering', 'Opening Playback controls');
    return window.Outrangutan?.enter?.(session.code && !session.isDemo && !session.isExpert ? 'session' : 'standalone');
  }
  if (name === 'scriptOperator') return openScriptOpPopout();
  if (name === 'sync') {
    setSyncReconnecting(true);
    try {
      if (typeof window._enableNetwork === 'function') await window._enableNetwork();
      const authoritative = await probeSharedSessionAuthority();
      if (authoritative) syncToFirestore();
    } catch (error) {
      setCloudSyncState('error', firebaseConnectionLabel(error, 'Cloud sync recovery failed'));
      containError('Cloud sync recovery', error);
    }
    renderLiveStatusRail();
  }
}

function liveSessionState() {
  return liveSessionController.getState();
}

function liveActiveCueIndex() {
  const state = liveSessionState();
  return state.activeCueIndex >= 0 ? state.activeCueIndex : state.selectedCueIndex;
}

function liveSelectedCueIndex() {
  return liveSessionState().selectedCueIndex;
}

function setLiveSelectedCue(index, options={}) {
  const activate = options.activate === true;
  if (activate) liveSessionController.setActiveCue(index, { select:true, reason:options.reason || 'local-cue' });
  else liveSessionController.setSelectedCue(index, { reason:options.reason || 'selected-cue' });
  lsIdx = liveSessionState().selectedCueIndex;
  return lsIdx;
}

function adoptLiveActiveCue(index, options={}) {
  liveSessionController.setActiveCue(index, {
    select: options.select === true,
    reason: options.reason || 'authoritative-cue',
  });
  if (options.select === true) lsIdx = liveSessionState().selectedCueIndex;
  return liveSessionState().activeCueIndex;
}

function canOwnLiveActiveCue() {
  // Solo surfaces — the demo, expert mode, and an unsynced local workspace —
  // have no shared show to protect, so the operator always drives. The student
  // gate only applies inside a real shared session (students must not move the
  // class's live cue). Without the solo carve-out, the demo (role:'student')
  // had GO permanently disabled and could never be run.
  if (session.isDemo || session.isExpert || !session.code) return isFollowingSelf();
  // An admin unlock outranks the joined role, same as hasInstructorPrivileges()
  // and isAdminShowCaller(): rejoining a session by code lands as 'student'
  // (TH2607 show-day incident — the operator's own device could not advance
  // the rundown), and the admin device must still be able to call the show.
  return (session.role !== 'student' || adminSession != null) && isFollowingSelf();
}

function setOperatorLiveCue(index, reason) {
  return setLiveSelectedCue(index, { activate:canOwnLiveActiveCue(), reason });
}

function liveBeatKey(beat, index) {
  return String(beat?.rowKey || beat?.id || `index:${index}`);
}

function ensureLiveRunLedger() {
  const state = liveSessionState();
  if (state.lifecycle === 'builder') return state.runLedger || {};
  const expected = beats.map(liveBeatKey);
  const configured = state.runOrder || [];
  const changed = expected.length !== configured.length || expected.some((key, index) => key !== configured[index]);
  if (changed) return liveSessionController.configureRunRows(beats, { preserve:true });
  return state.runLedger || {};
}

function liveCueExecution(index) {
  try { return liveSessionController.getCueExecution(index); }
  catch {
    const disabled = beats[index]?.disabled === true || beats[index]?.executionState === 'disabled' || beats[index]?.style === 'segment';
    return Object.freeze({ key:liveBeatKey(beats[index], index), index, status:disabled ? 'disabled' : 'upcoming', failure:null });
  }
}

function liveCueExecutionStatus(index) {
  return liveCueExecution(index).status;
}

function liveCueIsDisabled(index) {
  return liveCueExecutionStatus(index) === 'disabled';
}

function liveNextPlayableCueIndex(fromIndex) {
  let index = Number.isFinite(fromIndex) ? fromIndex + 1 : 0;
  while (index < beats.length && (beats[index]?.style === 'segment' || liveCueIsDisabled(index))) index += 1;
  return index < beats.length ? index : -1;
}

function livePreviousPlayableCueIndex(fromIndex) {
  let index = Number.isFinite(fromIndex) ? fromIndex - 1 : beats.length - 1;
  while (index >= 0 && (beats[index]?.style === 'segment' || liveCueIsDisabled(index))) index -= 1;
  return index;
}

function markLiveCueFailure(index, error, reason='live-cue-operation-failed') {
  try {
    liveSessionController.recordCueFailure(index, error, { reason });
    renderLive();
    return true;
  } catch (ledgerError) {
    containError('Live cue failure record', ledgerError);
    return false;
  }
}

function recoverLiveCueFailure(event, index) {
  event?.preventDefault?.();
  event?.stopPropagation?.();
  try {
    liveSessionController.recoverCueFailure(index, { status:'upcoming', reason:'operator-recover-cue' });
    setLiveSelectedCue(index, { reason:'operator-recover-cue-selection' });
    renderLive();
    return true;
  } catch (error) {
    containError('Live cue recovery', error);
    toast(String(error?.message || error));
    return false;
  }
}

function setLiveSubsystemStatus(name, status, detail='') {
  return liveSessionController.setSubsystemStatus(name, status, detail);
}
let browsingSelf = false;   // true = browse the rundown on my own (Following: Myself)
let followTarget = '';      // name of the person whose position I mirror ('' = self / show caller)
let followTargetId = '';    // presence id keeps duplicate/stale display names from hijacking follow
let editId = null;
let timerInterval = null;
let elapsedSecs = 0;
// True once the show clock has run in THIS page load. A stopped clock with
// leftover elapsedSecs on a fresh load means the session hydrated a parked
// rehearsal clock, not a live pause — that state must still offer the
// take-it-from-the-top chooser instead of silently resuming mid-rundown.
let _clockRanThisLoad = false;
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
const IS_PROMPTER_OUTPUT_BOOT = new URLSearchParams(location.search).get('prompter') === '1';
const prompterSessionController = window.CueolaPrompterSession.createController({
  instanceId: FLOWMINGO_ENDPOINT_ID,
  productionCode: session.code,
});
window.CueolaPrompterController = prompterSessionController;

function ensurePrompterProtocolIdentity(options={}) {
  const code = String(options.productionCode || session.code || '').trim().toUpperCase();
  const current = prompterSessionController.getState();
  let sessionId = options.sessionId || (current.productionCode === code ? current.sessionId : '');
  if (!sessionId && code && !IS_PROMPTER_OUTPUT_BOOT) {
    sessionId = `prompter_${code}_${Date.now().toString(36)}_${CLIENT_ID.slice(-8)}`;
  }
  const activeIndex = liveActiveCueIndex();
  const activeBeat = beats[activeIndex] || null;
  const scriptId = options.scriptId || `script_${Math.max(0, Number(prompterVersion) || 0)}`;
  return prompterSessionController.setIdentity({
    sessionId,
    productionCode:code,
    scriptId,
    activeCueId:activeBeat?.id == null ? '' : String(activeBeat.id),
  });
}

function currentPrompterSessionState() {
  ensurePrompterProtocolIdentity();
  return prompterSessionController.setTransport({
    running:ptPlaying,
    position:ptOffset,
    targetSpeed:ptTargetSpeed,
    effectiveSpeed:ptLiveSpeed,
    lastCommandId:prompterSessionController.getState().lastCommandId,
    status:ptPlaying ? 'running' : 'paused',
  });
}
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
  ensurePrompterProtocolIdentity({ sessionId:payload.sessionId, productionCode:payload.productionCode || payload.sessionCode });
  return {
    ...prompterSessionController.envelope(payload.type || 'message', payload),
    ...payload,
    ts,
    sender: FLOWMINGO_ENDPOINT_ID,
    senderInstanceId: FLOWMINGO_ENDPOINT_ID,
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
// Canonical theme-chip swatch colors — single source for every theme picker
// (settings modal, entry popover, PB bar, prompter/Flowmingo op panels).
const CUEOLA_THEME_SWATCHES = { cool:'#0a0d18', warm:'#ffc400', white:'#fafaf7', green:'#041208', koala:'#1c1c1b', panda:'#000000', flamingo:'#0e0410', outrangutan:'#ff6a00', prepbear:'#080a14' };
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
let localDraftLastKey = '';
let localDraftLastFingerprint = '';

function localDraftKey() {
  if (session.isDemo) return '';
  if (session.code) return `${LOCAL_DRAFT_PREFIX}${session.code}`;
  return `${LOCAL_DRAFT_PREFIX}expert`;
}

function saveLocalDraft() {
  const key = localDraftKey();
  if (!key) return;
  try {
    const content = {
      show:{ ...show, start:normalizeTimeValue(show.start) },
      beats,
      rundownAliases,
      customSources: sessionCustomSources,
      freeTextMode,
    };
    const fingerprint = JSON.stringify(content);
    if (key === localDraftLastKey && fingerprint === localDraftLastFingerprint) return;
    localStorage.setItem(key, JSON.stringify({ ...content, updatedAt:Date.now() }));
    localDraftLastKey = key;
    localDraftLastFingerprint = fingerprint;
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
    rundownAliases = draft.rundownAliases && typeof draft.rundownAliases === 'object'
      ? cloneRundownValue(draft.rundownAliases)
      : {};
    sessionCustomSources = draft.customSources || {};
    freeTextMode = Boolean(draft.freeTextMode);
    localDraftLastKey = key;
    localDraftLastFingerprint = JSON.stringify({
      show:{ ...show, start:normalizeTimeValue(show.start) },
      beats,
      rundownAliases,
      customSources:sessionCustomSources,
      freeTextMode,
    });
    return true;
  } catch {
    return false;
  }
}

// ── Local session snapshot history ────────────────────────────────────────
// Recovery copies stay on this device. They deliberately include the session
// document but restore only operator-owned content; presence, clocks, commands,
// and device heartbeats must never be rewound.
const SESSION_HISTORY_DB = 'cueola-session-history';
const SESSION_HISTORY_STORE = 'snapshots';
const SESSION_HISTORY_LIMIT = 20;
const SESSION_HISTORY_INTERVAL_MS = 120000;
const SESSION_RESTORABLE_FIELDS = ['customSources','prePro','preProNotes','roleAssignments','cues'];
let sessionSnapshotLatestDoc = null;
let sessionSnapshotLastAt = 0;
let sessionSnapshotCaptureRunning = false;
let sessionSnapshotPendingForceReason = '';

// D8 rule 6: every append log gets a cap — unbounded arrays are the #1 path to
// the 1MB session-doc limit. Appends stay arrayUnion (cheap, merge-safe); once
// the known log length passes cap+slack, the writer rewrites the trimmed tail
// instead. The slack keeps concurrent writers from constantly racing full-set
// writes; a trim losing a couple of interleaved feed entries is acceptable.
const PREPRO_ACTIVITY_CAP = 200;
const PREPRO_ACTIVITY_TRIM_SLACK = 20;
function preProActivityValue(entry, knownLog) {
  try {
    const log = Array.isArray(knownLog) ? knownLog
      : (sessionSnapshotLatestDoc && Array.isArray(sessionSnapshotLatestDoc.preProActivity)
        ? sessionSnapshotLatestDoc.preProActivity : null);
    if (log && log.length >= PREPRO_ACTIVITY_CAP + PREPRO_ACTIVITY_TRIM_SLACK) {
      return log.slice(-(PREPRO_ACTIVITY_CAP - 1)).concat([entry]);
    }
  } catch {}
  return window._arrayUnion(entry);
}

function openSessionHistoryDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(SESSION_HISTORY_DB, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(SESSION_HISTORY_STORE)) {
        const store = db.createObjectStore(SESSION_HISTORY_STORE, { keyPath:'id' });
        store.createIndex('sessionCode', 'sessionCode', { unique:false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function sessionHistoryList(code=session.code) {
  if (!code || !window.indexedDB) return [];
  const db = await openSessionHistoryDB();
  return new Promise(resolve => {
    const request = db.transaction(SESSION_HISTORY_STORE, 'readonly').objectStore(SESSION_HISTORY_STORE).index('sessionCode').getAll(code);
    request.onsuccess = () => resolve((request.result || []).sort((a,b) => b.createdAt - a.createdAt));
    request.onerror = () => resolve([]);
  });
}

async function sessionHistoryPut(record) {
  const db = await openSessionHistoryDB();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(SESSION_HISTORY_STORE, 'readwrite');
    tx.objectStore(SESSION_HISTORY_STORE).put(record);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
  const records = await sessionHistoryList(record.sessionCode);
  if (records.length <= SESSION_HISTORY_LIMIT) return;
  await new Promise(resolve => {
    const tx = db.transaction(SESSION_HISTORY_STORE, 'readwrite');
    records.slice(SESSION_HISTORY_LIMIT).forEach(item => tx.objectStore(SESSION_HISTORY_STORE).delete(item.id));
    tx.oncomplete = resolve;
    tx.onerror = resolve;
  });
}

async function encodeSessionSnapshot(doc) {
  const json = JSON.stringify(doc);
  if (typeof CompressionStream === 'undefined') return { encoding:'json', data:json, bytes:new Blob([json]).size };
  const blob = await new Response(new Blob([json]).stream().pipeThrough(new CompressionStream('gzip'))).blob();
  return { encoding:'gzip', data:blob, bytes:blob.size };
}

async function decodeSessionSnapshot(record) {
  if (record.encoding !== 'gzip') return JSON.parse(record.data);
  const json = await new Response(record.data.stream().pipeThrough(new DecompressionStream('gzip'))).text();
  return JSON.parse(json);
}

function sessionSnapshotSummary(doc, previousDoc) {
  const current = Array.isArray(doc?.beats) ? doc.beats : [];
  const previous = Array.isArray(previousDoc?.beats) ? previousDoc.beats : [];
  const before = new Map(previous.map(beat => [String(beat.id), beat]));
  const after = new Map(current.map(beat => [String(beat.id), beat]));
  let added = 0, removed = 0, changed = 0;
  after.forEach((beat,id) => { if (!before.has(id)) added++; else if (stableStringify(before.get(id)) !== stableStringify(beat)) changed++; });
  before.forEach((beat,id) => { if (!after.has(id)) removed++; });
  const parts = [`${current.length} row${current.length === 1 ? '' : 's'}`];
  if (added) parts.push(`+${added} added`);
  if (removed) parts.push(`−${removed} removed`);
  if (changed) parts.push(`${changed} changed`);
  if (previousDoc && (doc.showName !== previousDoc.showName || doc.startTime !== previousDoc.startTime || Boolean(doc.freeMode) !== Boolean(previousDoc.freeMode))) parts.push('show settings changed');
  const notes = Array.isArray(doc?.preProNotes) ? doc.preProNotes.length : 0;
  if (notes) parts.push(`${notes} production note${notes === 1 ? '' : 's'}`);
  return parts.join(' · ');
}

async function captureSessionSnapshot(reason='interval', force=false) {
  if (!window.indexedDB || !session.code || session.isDemo || session.isExpert || !sessionSnapshotLatestDoc) return;
  if (sessionSnapshotCaptureRunning) {
    if (force) sessionSnapshotPendingForceReason = reason;
    return;
  }
  const targetSessionCode = session.code;
  const now = Date.now();
  if (!force && now - sessionSnapshotLastAt < SESSION_HISTORY_INTERVAL_MS) return;
  sessionSnapshotCaptureRunning = true;
  try {
    const existing = await sessionHistoryList(targetSessionCode);
    const latest = existing[0];
    const doc = cloneRundownValue(sessionSnapshotLatestDoc);
    const fingerprint = stableStringify(doc);
    if (!force && latest?.fingerprint === fingerprint) { sessionSnapshotLastAt = now; return; }
    const previousDoc = latest ? await decodeSessionSnapshot(latest) : null;
    const encoded = await encodeSessionSnapshot(doc);
    await sessionHistoryPut({
      id:`${targetSessionCode}_${now}_${Math.random().toString(36).slice(2,7)}`,
      sessionCode:targetSessionCode, createdAt:now, reason, fingerprint,
      summary:sessionSnapshotSummary(doc, previousDoc), ...encoded,
    });
    sessionSnapshotLastAt = now;
  } catch (err) {
    console.warn('Session history snapshot unavailable', err);
  } finally {
    sessionSnapshotCaptureRunning = false;
    if (sessionSnapshotPendingForceReason) {
      const pendingReason = sessionSnapshotPendingForceReason;
      sessionSnapshotPendingForceReason = '';
      queueMicrotask(() => captureSessionSnapshot(pendingReason, true));
    }
  }
}

function sessionSnapshotReasonLabel(reason) {
  return ({
    joined:'Joined', interval:'Auto', live:'Go Live', leave:'Leave',
    'live-exit':'Live Exit', 'live-recovery':'Live Recovery', restored:'Restored'
  })[reason] || reason;
}

async function openSessionHistory() {
  showModal('modal-session-history');
  const list = document.getElementById('sessionHistoryList');
  const sub = document.getElementById('sessionHistorySub');
  list.innerHTML = '<div class="snap-empty">Loading local recovery snapshots…</div>';
  const records = await sessionHistoryList();
  const canRestoreLocal = Boolean(rundownSyncBlockedMissing && session.role === 'instructor' && session.code);
  sub.textContent = canRestoreLocal
    ? `${records.length} of ${SESSION_HISTORY_LIMIT} snapshots · current local copy has ${beats.length} row${beats.length === 1 ? '' : 's'}`
    : `${records.length} of ${SESSION_HISTORY_LIMIT} local recovery snapshots · newest first`;
  const restoreLocal = document.getElementById('sessionHistoryRestoreLocal');
  if (restoreLocal) restoreLocal.hidden = !canRestoreLocal;
  document.getElementById('sessionHistoryExportAll').disabled = !records.length;
  list.innerHTML = records.length ? records.map(record => `
    <div class="snap-row">
      <div class="snap-main"><div><span class="snap-time">${esc(new Date(record.createdAt).toLocaleString())}</span><span class="snap-reason">${esc(sessionSnapshotReasonLabel(record.reason))}</span></div><div class="snap-summary">${esc(record.summary || 'Session recovery snapshot')}</div></div>
      <div class="snap-actions"><button class="btn-secondary export-action" onclick="exportSessionSnapshot('${record.id}')">Export</button><button class="btn-secondary" onclick="restoreSessionSnapshot('${record.id}')">Restore</button></div>
    </div>`).join('') : '<div class="snap-empty">No snapshots yet. Cueola saves one when you join, every two minutes while the session changes, when you go live, and when you leave.</div>';
}

async function getSessionSnapshotRecord(id) {
  const db = await openSessionHistoryDB();
  return new Promise(resolve => {
    const request = db.transaction(SESSION_HISTORY_STORE, 'readonly').objectStore(SESSION_HISTORY_STORE).get(id);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => resolve(null);
  });
}

function downloadSessionHistoryJSON(value, filename) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type:'application/json' }));
  const a = document.createElement('a'); a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function exportSessionSnapshot(id) {
  const record = await getSessionSnapshotRecord(id);
  if (!record) { toast('Snapshot not found.'); return; }
  const doc = await decodeSessionSnapshot(record);
  downloadSessionHistoryJSON({ sessionCode:record.sessionCode, createdAt:record.createdAt, reason:record.reason, summary:record.summary, session:doc }, `Cueola Snapshot ${record.sessionCode} ${new Date(record.createdAt).toISOString().replace(/[:.]/g,'-')}.json`);
  toast('Snapshot exported.');
}

async function exportAllSessionSnapshots() {
  const records = await sessionHistoryList();
  const snapshots = await Promise.all(records.map(async record => ({ createdAt:record.createdAt, reason:record.reason, summary:record.summary, session:await decodeSessionSnapshot(record) })));
  downloadSessionHistoryJSON({ sessionCode:session.code, exportedAt:Date.now(), snapshots }, `Cueola History ${session.code} ${new Date().toISOString().slice(0,10)}.json`);
  toast('Session history exported.');
}

function buildCurrentLocalRecoveryPayload() {
  const payload = buildSessionBootstrapPayload({
    code:session.code,
    createdBy:session.userName,
    showName:show.name,
    startTime:show.start,
    beats,
    rundownAliases,
    customSources:sessionCustomSources,
    cues:[],
    freeMode:freeTextMode,
    createdAt:window._serverTimestamp(),
  });
  const prePro = loadPreProData();
  if (prePro && typeof prePro === 'object' && Object.keys(prePro).length) {
    payload.prePro = cloneRundownValue(prePro);
    if (Array.isArray(prePro.roleAssignments)) payload.roleAssignments = cloneRundownValue(prePro.roleAssignments);
  }
  const localNotes = localPlandaBearNotes();
  if (localNotes.length) payload.preProNotes = cloneRundownValue(localNotes);
  payload.rundownUpdatedAt = Date.now();
  payload.rundownUpdatedBy = session.userName || 'Cueola operator';
  return payload;
}

async function restoreCurrentLocalSessionToCloud() {
  if (!window._firebaseReady || !session.code || session.role !== 'instructor') return;
  if (!confirm(`Restore the current local copy of ${session.code} to the cloud?\n\nThis will recreate a missing or incomplete session with ${beats.length} rundown row${beats.length === 1 ? '' : 's'} and locally saved Planda Bear content. Live presence, clocks, commands, and device heartbeats are never restored.`)) return;
  const button = document.getElementById('sessionHistoryRestoreLocal');
  if (button) button.disabled = true;
  try {
    const ref = window._doc(window._db, 'sessions', session.code);
    const payload = buildCurrentLocalRecoveryPayload();
    const restored = await restoreMissingSessionDocument(ref, payload);
    if (!restored) {
      toast('A complete server copy now exists. Reload it before choosing what to keep.', 6000);
      return;
    }
    rundownPendingBatches.length = 0;
    rundownSyncBlockedMissing = false;
    rundownCloudBeats = cloneRundownValue(beats);
    rundownShadowBeats = cloneRundownValue(beats);
    rundownShadowShow = { name:show.name, start:normalizeTimeValue(show.start), freeMode:freeTextMode };
    missingSessionNoticeCode = '';
    setSyncReconnecting(false);
    setCloudSyncState('synced', `Cloud session restored · ${session.code}`);
    saveLocalDraft();
    hideModal('modal-session-history');
    joinPresence();
    toast(`Restored ${session.code} from this browser's local copy.`);
  } catch (err) {
    reportCloudWriteFailure('Local session recovery', err);
  } finally {
    if (button) button.disabled = false;
  }
}

async function restoreSessionSnapshot(id) {
  const record = await getSessionSnapshotRecord(id);
  if (!record) { toast('Snapshot not found.'); return; }
  if (!confirm(`Restore the ${new Date(record.createdAt).toLocaleString()} snapshot?\n\nCurrent rundown content will be replaced through normal cloud sync. A recovery copy of the current session will be saved first.`)) return;
  await captureSessionSnapshot('interval', true);
  const doc = await decodeSessionSnapshot(record);
  // Restored paperwork must WIN against every device's cached copy: re-stamp
  // prePro as newest, else a stale-but-newer-stamped local mirror silently
  // re-clobbers the restore within seconds (P2607 incident, 2026-07-15).
  if (doc.prePro && typeof doc.prePro === 'object') {
    const now = Date.now();
    const restamped = cloneRundownValue(doc.prePro);
    delete restamped._stamps;
    restamped.updatedAt = now;
    restamped._fieldUpdatedAt = {};
    for (const k of Object.keys(restamped)) {
      if (k !== 'updatedAt' && k !== '_fieldUpdatedAt' && k !== 'activeCallSheetIndex') restamped._fieldUpdatedAt[k] = now;
    }
    doc.prePro = restamped;
  }
  const sharedCloud = window._firebaseReady && session.code && !session.isDemo && !session.isExpert;
  let recreatedSession = false;
  if (sharedCloud) {
    try {
      const ref = window._doc(window._db,'sessions',session.code);
      const recoveryPayload = buildSnapshotRecoveryPayload(doc);
      recreatedSession = await restoreMissingSessionDocument(ref, recoveryPayload);
    } catch (err) {
      reportCloudWriteFailure('Snapshot restore', err);
      return;
    }
  }
  beats = (Array.isArray(doc.beats) ? doc.beats : []).map(migrateBeat);
  show.name = doc.showName || 'Untitled Show';
  show.start = normalizeTimeValue(doc.startTime);
  freeTextMode = Boolean(doc.freeMode);
  sessionCustomSources = doc.customSources || {};
  rundownAliases = doc.rundownAliases && typeof doc.rundownAliases === 'object'
    ? cloneRundownValue(doc.rundownAliases)
    : {};
  renderRundown();
  if (recreatedSession) {
    rundownPendingBatches.length = 0;
    rundownSyncBlockedMissing = false;
    rundownCloudBeats = cloneRundownValue(beats);
    rundownShadowBeats = cloneRundownValue(beats);
    rundownShadowShow = { name:show.name, start:show.start, freeMode:freeTextMode };
    missingSessionNoticeCode = '';
    setSyncReconnecting(false);
    setCloudSyncState('synced', `Cloud session restored · ${session.code}`);
    saveLocalDraft();
  } else {
    syncToFirestore();
  }
  if (sharedCloud && !recreatedSession) {
    const updates = {};
    SESSION_RESTORABLE_FIELDS.forEach(field => { updates[field] = doc[field] === undefined ? window._deleteField() : cloneRundownValue(doc[field]); });
    try { await window._updateDoc(window._doc(window._db,'sessions',session.code), updates); }
    catch (err) { reportCloudWriteFailure('Snapshot restore', err); return; }
  }
  hideModal('modal-session-history');
  sessionSnapshotLatestDoc = { ...(sessionSnapshotLatestDoc || {}), ...cloneRundownValue(doc) };
  await captureSessionSnapshot('restored', true);
  toast(`Restored snapshot from ${new Date(record.createdAt).toLocaleTimeString()}.`);
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
  const safe = (show.name || 'Rundown').replace(/[^\w \-]+/g, '').trim() || 'Rundown';
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
      profileId: session.profileId || '', username: session.username || '',
      profileAliases: Array.isArray(session.profileAliases) ? session.profileAliases : [],
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
  session = {
    code: r.code, role: r.role || 'instructor', userName: r.name || '',
    profileId: r.profileId || '', username: r.username || '',
    profileAliases: Array.isArray(r.profileAliases) ? r.profileAliases : [],
    isDemo: false, isExpert: false,
  };
  freeTextMode = false;
  rememberLastSession(r.code, r.name);
  restoreLocalDraftAsRundownBaseline();
  if (Number.isFinite(r.lsIdx)) setLiveSelectedCue(r.lsIdx, { activate:r.role !== 'student', reason:'resume-cue' });
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
          setLiveSelectedCue(r.lsIdx, { activate:r.role !== 'student', reason:'resume-cue-reassert' });
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
  captureSessionSnapshot('leave', true);
  logShow('session', 'Left session' + (session?.code ? ' ' + session.code : ''));
  try { liveSessionController.leave({ reason:'session-leave' }); }
  catch (error) { containError('Live session leave', error); }
  clearResumeState();   // P7: intentional leave — never offer to resume it (Decisions #14)
  stopTimer();
  liveSessionController.reset('session-left');
  setLiveSelectedCue(-1, { reason:'session-left' });
  leavePresence();      // drop our presence entry + stop the heartbeat — no ghost participants
  if (firestoreUnsub) { try { firestoreUnsub(); } catch {} firestoreUnsub = null; }
  pbStopNotesListener();
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
  // Reveal before writing text so the aria-live region announces the mutation.
  el.style.display = 'block';
  el.textContent = msg;
  clearTimeout(el._t);
  el._t = setTimeout(() => el.style.display='none', dur);
}

// ── Offline shell + operator-controlled updates ───────────────────────────
let cueolaWaitingWorker = null;
let cueolaUpdateApplying = false;

function showCueolaUpdate(worker) {
  cueolaWaitingWorker = worker;
  const banner = document.getElementById('appUpdateBanner');
  if (banner) banner.hidden = false;
  document.documentElement.dataset.swState = 'update-ready';
}

function dismissCueolaUpdate() {
  const banner = document.getElementById('appUpdateBanner');
  if (banner) banner.hidden = true;
}

function applyCueolaUpdate() {
  if (!cueolaWaitingWorker) { location.reload(); return; }
  cueolaUpdateApplying = true;
  document.documentElement.dataset.swState = 'updating';
  cueolaWaitingWorker.postMessage({ type:'SKIP_WAITING' });
}

function watchCueolaWorker(registration) {
  if (registration.waiting && navigator.serviceWorker.controller) showCueolaUpdate(registration.waiting);
  registration.addEventListener('updatefound', () => {
    const worker = registration.installing;
    if (!worker) return;
    worker.addEventListener('statechange', () => {
      if (worker.state === 'installed' && navigator.serviceWorker.controller) showCueolaUpdate(worker);
    });
  });
}

function initCueolaServiceWorker() {
  if (!('serviceWorker' in navigator) || !/^https?:$/.test(location.protocol)) return;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (cueolaUpdateApplying) location.reload();
  });
  navigator.serviceWorker.register('./sw.js', { scope:'./' }).then(registration => {
    watchCueolaWorker(registration);
    return navigator.serviceWorker.ready;
  }).then(() => {
    if (document.documentElement.dataset.swState !== 'update-ready') document.documentElement.dataset.swState = 'offline-ready';
  }).catch(err => {
    document.documentElement.dataset.swState = 'unavailable';
    console.warn('Cueola offline shell unavailable', err);
  });
}

window.addEventListener('load', initCueolaServiceWorker, { once:true });

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
  cloudSyncProjection = { state, detail };
  const dot = document.getElementById('syncDot');
  const badge = document.getElementById('topSessionBadge');
  if (dot) {
    dot.classList.remove('saving', 'error', 'off', 'local');
    if (state === 'saving') dot.classList.add('saving');
    else if (state === 'error') dot.classList.add('error');
    else if (state === 'local') dot.classList.add('local');
    else if (state === 'off') dot.classList.add('off');
  }
  if (badge) badge.title = detail;
  if (document.getElementById('liveshow')?.classList.contains('on')) renderLiveStatusRail();
}

function reportCloudWriteFailure(context='Cloud save', err=null) {
  // An unreachable backend is no longer a failure: plain writes queue in the
  // persistent cache and the transactional writers (rundown batches, notes)
  // keep their own retry queues. Show the quiet reconnecting state instead of
  // an error dot + toast; the next server snapshot clears it.
  const code = err?.code || '';
  if (code === 'unavailable' || code === 'deadline-exceeded' || !navigator.onLine) {
    if (!_syncReconnState) logShow('sync', context + ' queued — cloud unreachable' + (code ? ' (' + code + ')' : ''));
    setSyncReconnecting(true);
    return;
  }
  console.warn(`${context} failed.`, err);
  logShow('sync', context + ' failed — local draft kept' + (code ? ' (' + code + ')' : ''));
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
    time:'7 min',
    intro:'Planda Bear keeps the production paperwork and the crew conversation in the same workspace as the rundown — and with a profile, everything that needs you follows you.',
    navigation:[
      'Enter with your profile: tap the profile button on the front page, sign in with your username (no password — your class login code created it), and open a session from your list.',
      'Open Planda Bear from the home screen card or the topbar button; the notes button on the front page goes straight to the Production Notes board.',
      'Move through Call Sheet, Schedule, Safety Plan, patch sheets, comments, and export from the paperwork hub.'
    ],
    steps:[
      'First visit? Create your profile with the login code your instructor gave the class — pick a username, look, and theme. After that, entering any app is just your username.',
      'Start with the Call Sheet: production name, date, call time, location, contacts, access, crew, and talent.',
      'Fill the Production Schedule, Safety Plan, and the patch sheets before the room gets busy.',
      'Open Production Notes: post what changed, tag the department, and reply in threads. @-mention someone and they get notified; their position chip shows beside their name.',
      'Post a To-Do with an assignee, or add a checklist to one note and assign each item — assigned items land on that person’s profile portal, and instructors can open "Open items" to see who owes what.',
      'Pinned notes show instructors who has not read them yet — "Seen by" on every note tracks reads across devices.',
      'Preview or export the PDF package when the paperwork is ready to share.'
    ],
    callouts:[
      ['Profiles','One profile per person, created with a class login code — no passwords. Your portal lists your sessions, your position, open to-dos, and unseen notes.'],
      ['Notes that assign work','Department tags, threaded replies, likes, @mentions, per-item checklist owners, and read receipts — the board is the crew’s single source of truth.'],
      ['One package','Export PDF Package gathers the paperwork, production notes, and rendered rundown into one shareable file.']
    ],
    checks:['I can enter with my username.','I can post a note with a tagged department and an assigned checklist item.','I know where my open to-dos show up.'],
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
    id:'outrangutan',
    area:'Outrangutan',
    title:'Cue And Play Media',
    time:'6 min',
    intro:'Outrangutan is the playback deck: video and sound cues in a list, an SFX pad board, and an output window for the program display. It runs local-first — media lives on this machine, so dead venue Wi-Fi cannot stop playback.',
    navigation:[
      'Open Outrangutan from the home screen card — Session mode ties it to the rundown’s code, Standalone runs it alone.',
      'Playback tab is the cue list and transport; SFX Board is the pad grid; the gear opens outputs and settings.',
      'From the Cueola live screen you can drive it without switching: G / P / S and the pads keep working.'
    ],
    steps:[
      'Drop video, audio, or stills into the cue list — each file becomes a cue. Trim with the clip editor; audio shows its waveform so you can see where the hit lands.',
      'Set each cue’s Continue mode: Manual waits for GO, Continue rolls into the next cue, Follow starts it alongside.',
      'Build the SFX board: drop sounds on pads, name them, give them hotkeys. Trim a pad in its editor — the waveform shows there too.',
      'Open the output window onto the program display and use Identify to confirm the screen. If an output ever freezes, Cueola’s watchdog flags it and re-syncs it when it comes back.',
      'Link rundown rows to cues and pads in Cueola’s cue editor, with auto-fire when the row advances — the printed rundown shows those links in its Outrangutan column.',
      'Hook up a control surface: Stream Deck over WebHID, or any MIDI pad/fader box — arm “+ Learn a control”, touch the control, pick its action. A fader mapped to Master level rides the master gain.',
      'Save the show as an .ogshow (Cmd+S saves in place) and print the show pack — cue sheet plus pad map — before doors.'
    ],
    callouts:[
      ['PANIC','Esc on the Outrangutan screen (Shift+Esc from Cueola live) stops everything, instantly. It is always safe to hit.'],
      ['.ogshow files','One file carries the whole show — cues, pads, and the media itself — so it opens on any machine. Old .ogshow files still open.'],
      ['No hardware handy?','Outrangutan.midiInject(0x90, 60, 127) in the console fires a mapped control — rehearse the mapping before the box arrives.']
    ],
    checks:['I can add a cue and trim it.','I can fire a pad from its hotkey.','I know what PANIC does and where the output window lives.'],
    actions:[['Open Outrangutan','outrangutan']]
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
  else if (action === 'outrangutan') enterOutrangutan(session.code && !session.isDemo && !session.isExpert ? 'session' : 'standalone');
}

function markPaperworkDirty() {
  if (typeof currentPaperworkItemId === 'function' && currentPaperworkItemId()) paperworkDirty = true;
}

function confirmSaveUnsavedPaperwork() {
  // Paperwork autosaves as you type (queuePaperworkAutosave); "dirty" only ever
  // means a 650ms debounce is in flight. Flush it silently instead of
  // interrupting with a save dialog — the same path every export uses.
  flushPaperworkDraftForExport();
  return true;
}

window.addEventListener('beforeunload', e => {
  if (paperworkDirty) flushPaperworkDraftForExport();
  // The flush above lands in localStorage synchronously; only warn when a
  // cloud write is still in flight and closing now could strand collaborators
  // without this device's last edits.
  if (_pbPendingCloudKeys.size) {
    e.preventDefault();
    e.returnValue = '';
  }
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
// ADMIN SYSTEM — v2.1 (D1): Firebase Auth via cueola-admin-auth.js
// ─────────────────────────────────────────────────────────────
// The legacy codeHash system (admins/global list-doc, OWNER_BOOTSTRAP_HASH,
// cueola_admins_v2 / cueola_admin_sess localStorage mirrors) is retired.
// CueolaAdminAuth owns sign-in and session resolution; this adapter mirrors
// the published session into the legacy `adminSession` global so every
// existing consumer (script lock, session info, presence inspect,
// entitlements, assignment actor…) works unchanged. Auth's IndexedDB
// persistence carries the session across all same-origin surfaces.
function initAdminAuthAdapter() {
  if (!window.CueolaAdminAuth) return;
  CueolaAdminAuth.onChange(session => {
    adminSession = session ? { id:session.id, uid:session.uid, username:session.username, name:session.name, level:session.level } : null;
    updateAdminUI();
    try { renderPresence(currentPresence); } catch {}
  });
}

const SESSION_SOURCE_DEFAULTS = {
  video: ['CAM 1','CAM 2','CAM 3','CAM 4','CPU','PLBK','GFX','ME 1'],
  audio: ['Host','Guest 1','Guest 2','CPU','PLBK','VOU','SFX','Music','Mains'],
  gfx:   ['GFX','Media 1','Media 2','Media 3','Media 4','ME 1'],
  scriptWho: ['Host','Guest 1','Guest 2','VOU'],
};

function logoutAdmin() {
  if (window.CueolaAdminAuth) CueolaAdminAuth.signOut();  // adapter resets UI
  adminSession = null;
  updateAdminUI();
  try { renderPresence(currentPresence); } catch {}
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
// The in-app sign-in door (D1): script lock, session info, and presence
// inspect all funnel here when !adminSession — it must always offer a real
// sign-in path or the Live surface dead-ends.
function openAdminLogin() {
  document.getElementById('adminUserIn').value = '';
  document.getElementById('adminPassIn').value = '';
  document.getElementById('adminLoginErr').classList.remove('on');
  showModal('adminLoginModal');
  setTimeout(()=>document.getElementById('adminUserIn').focus(),100);
}

async function submitAdminLogin() {
  const username = document.getElementById('adminUserIn').value.trim();
  const password = document.getElementById('adminPassIn').value;
  const err = document.getElementById('adminLoginErr');
  const btn = document.getElementById('admin-login-btn');
  if (!username || !password) {
    err.textContent = 'Enter your username and password.';
    err.classList.add('on');
    return;
  }
  err.classList.remove('on');
  if (btn) { btn.disabled = true; btn.textContent = 'Signing in…'; }
  try {
    const result = await CueolaAdminAuth.signIn(username, password);
    hideModal('adminLoginModal');
    document.getElementById('adminPassIn').value = '';
    toast(`Welcome, ${result.name}`);
    if (document.getElementById('rundown').classList.contains('on')) openAdminPanel();
  } catch (e) {
    err.textContent = e?.message || 'Sign-in failed.';
    err.classList.add('on');
    document.getElementById('adminPassIn').value = '';
    document.getElementById('adminPassIn').focus();
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Sign In'; }
  }
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
  hydrateRoleAssignments({ force:true });
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
  const isSuper = adminSession.level==='super';   // 'full' level retired (plan decision 4)

  let html = '';

  // ── Admin management (accounts live on the dashboard now — D1) ──
  if (isSuper) {
    html += `<div class="admin-section">
      <div class="admin-section-label">Admin Management</div>
      ${session.code ? `<div class="admin-session-actions">
        <button class="admin-act-btn" onclick="copySessionCode()">Copy Session Code</button>
        <button class="admin-act-btn" onclick="copySessionLink()">Copy Session Link</button>
        <button class="admin-act-btn" onclick="shareSessionInvite()">Share Session</button>
        <button class="admin-act-btn" onclick="openPaperworkHub()">Open Planda Bear</button>
      </div>` : ''}
      <div style="font-size:12px;color:var(--text3);line-height:1.6;margin-top:8px">
        Signed in as <b>${esc(adminSession.name)}</b> (${esc(adminSession.username || '')}).
        Instructor accounts are managed on the <a href="dashboard.html#accounts" style="color:var(--accent)">Dashboard → Accounts</a> page.
      </div>
    </div>`;
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
      <div style="font-size:10.5px;color:var(--text3);line-height:1.5;margin-bottom:8px">Choose a saved profile, position, and required paperwork. Changes remain unsaved until Firestore confirms <b>Save Assignments</b>.</div>
      <div id="adminAssignmentSaveState">${assignmentSaveStateHTML()}</div>
      <div class="admin-src-row" style="margin-bottom:10px">
        <span class="admin-src-label">Positions</span>
        <div class="admin-src-chips">
          ${positionOptions.map(p => `<span class="admin-src-chip">${esc(p)}<button class="rm" onclick="removePositionOption(${JSON.stringify(p).replace(/"/g,'&quot;')})" title="Remove ${esc(p)} from this production">x</button></span>`).join('')}
          <button class="admin-src-add" onclick="addPositionOption()">+ Add</button>
        </div>
      </div>
      <div id="adminRoleAssignments" onchange="markRoleAssignmentsUnsaved()">${renderRoleAssignmentRows(pendingAssignments?.length ? pendingAssignments : undefined)}</div>
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

let assignmentProfiles = [];
let canonicalRoleAssignments = [];
let confirmedRoleAssignmentRows = [];
let assignmentRevision = 0;
let assignmentSaveState = 'loading';
let assignmentSaveDetail = 'Loading saved profiles and assignments…';
let assignmentHydratePromise = null;
let assignmentFromCache = false;
// True when the last canonical load was refused by the DEPLOYED rules (the
// staged rules that open profiles/assignments are still an owner errand).
// Exports degrade to the legacy prePro roster instead of hard-blocking.
let _assignmentLoadDenied = false;
// True when the canonical register is empty and the roster still lives on the
// legacy session fields. The Admin panel shows this as a migration to-do
// ('unsaved'/'conflict'), but it must not block paperwork exports: the printed
// register honestly says no canonical records exist, and the call sheet roster
// comes from prePro either way.
let _assignmentLegacyPending = false;

function assignmentModel() {
  return window.CueolaAssignmentModel || null;
}

function assignmentSaveStateHTML() {
  const state = assignmentSaveState || 'unsaved';
  const labels = { loading:'Loading', unsaved:'Unsaved', saving:'Saving', saved:'Saved', failed:'Failed', conflict:'Conflict' };
  const actions = state === 'failed'
    ? assignmentFromCache
      ? `<span class="admin-assignment-state-actions"><button class="admin-act-btn" onclick="retryRoleAssignmentLoad()">Retry connection</button></span>`
      : `<span class="admin-assignment-state-actions"><button class="admin-act-btn" onclick="saveRoleAssignmentsFromAdmin()">Retry</button><button class="admin-act-btn" onclick="revertRoleAssignments()">Revert draft</button></span>`
    : state === 'conflict'
      ? `<span class="admin-assignment-state-actions"><button class="admin-act-btn" onclick="reloadRoleAssignmentsAfterConflict()">Load server copy</button></span>`
      : '';
  return `<div class="admin-assignment-state is-${state}" role="status" aria-live="polite" data-assignment-save-state="${state}">
    <span class="admin-assignment-state-pill">${labels[state] || 'Unsaved'}</span>
    <span class="admin-assignment-state-detail">${esc(assignmentSaveDetail || '')}</span>${actions}
  </div>`;
}

function setAssignmentSaveState(state, detail='') {
  assignmentSaveState = state;
  assignmentSaveDetail = detail;
  const wrap = document.getElementById('adminAssignmentSaveState');
  if (wrap) wrap.innerHTML = assignmentSaveStateHTML();
}

function assignmentProfileById(profileId) {
  const model = assignmentModel();
  return assignmentProfiles.find(profile => model?.profileIdentityIds?.(profile)?.includes(profileId)
    || profile.profileId === profileId) || null;
}

function assignmentProfileOptions(selectedId='', legacyName='') {
  const model = assignmentModel();
  const options = assignmentProfiles.map(profile => {
    const id = model?.profileIdFor?.(profile) || profile.profileId || '';
    const selected = id && id === selectedId;
    const suffix = profile.username ? ` @${profile.username}` : '';
    return `<option value="${esc(id)}" ${selected ? 'selected' : ''}>${esc(profile.fullName || profile.username || id)}${esc(suffix)}</option>`;
  }).join('');
  const unresolved = legacyName && !selectedId
    ? `<option value="" selected>Unlinked legacy name: ${esc(legacyName)}</option>`
    : '<option value="">Select saved profile</option>';
  return unresolved + options;
}

function assignmentActor() {
  const profile = window.CueolaIdentity?.profile?.();
  const model = assignmentModel();
  if (profile) return {
    id: model?.profileIdFor?.(profile) || profile.profileId || `profile_${profile.username || 'unknown'}`,
    label: profile.fullName || profile.username || 'Instructor',
  };
  if (adminSession?.id) return { id:`admin_${String(adminSession.id).replace(/[^A-Za-z0-9_.-]/g, '_')}`, label:adminSession.name || 'Admin' };
  return { id:`session_${String(presenceId || CLIENT_ID).replace(/[^A-Za-z0-9_.-]/g, '_')}`, label:session.userName || 'Instructor' };
}

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

function paperworkIdForLabel(label='') {
  const positionId = assignmentModel()?.positionIdFor?.(label) || String(label).toLowerCase().replace(/[^a-z0-9]+/g, '-');
  return `paperwork_${String(positionId).replace(/^position_/, '').replace(/[^A-Za-z0-9_.-]/g, '_')}`.slice(0, 160);
}

function plandaBearAssignmentCatalog(data=loadPreProData()) {
  const sheets = getCallSheets(data);
  const catalog = sheets.map((sheet, i) => ({
    id: `paperwork_${String(sheet.id || `call_sheet_${i + 1}`).replace(/[^A-Za-z0-9_.-]/g, '_')}`.slice(0, 160),
    label: `Call Sheet: ${callSheetDisplayName(sheet, i)}`,
  }));
  catalog.push(
    { id:'paperwork_production_schedule', label:'Production Schedule' },
    { id:'paperwork_safety_plan', label:'Safety Plan' },
    { id:'paperwork_rundown', label:'Rundown' },
    { id:'paperwork_flowmingo_script', label:'Flowmingo Script' },
    { id:'paperwork_video_patch', label:'Video Patch Sheet' },
    { id:'paperwork_audio_comms_patch', label:'Audio & Comms Patch Sheet' },
    { id:'paperwork_tech_checklist', label:'Tech Checklist' },
  );
  if (Array.isArray(data.roleAssignments)) {
    data.roleAssignments.forEach(row => {
      const saved = row?.paperwork || row?.paperworkItems;
      if (Array.isArray(saved)) saved.forEach(item => {
        const label = String(item || '').trim();
        if (label && !catalog.some(opt => opt.label.toLowerCase() === label.toLowerCase())) {
          catalog.push({ id:paperworkIdForLabel(label), label });
        }
      });
    });
  }
  return catalog;
}

function basePlandaBearAssignmentOptions(data=loadPreProData()) {
  return plandaBearAssignmentCatalog(data).map(option => option.label);
}

function plandaBearAssignmentOptions(data=loadPreProData()) {
  return plandaBearAssignmentCatalog(data).map(option => option.label);
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
  const model = assignmentModel();
  const person = String(row.person || row.displayName || row.name || '').trim();
  let profileId = String(row.profileId || row.studentProfileId || '').trim();
  if (!profileId && person) {
    const matches = assignmentProfiles.filter(profile => sameParticipantName(profile.fullName, person));
    if (matches.length === 1) profileId = model?.profileIdFor?.(matches[0]) || matches[0].profileId || '';
  }
  const profile = assignmentProfileById(profileId);
  const position = String(row.position || row.positionLabel || row.role || '').trim();
  const positionId = String(row.positionId || (position ? model?.positionIdFor?.(position) : '') || '').trim();
  const paperwork = normalizePaperworkSelections(row.paperworkLabels || row.paperwork || row.paperworkItems || row.file, options);
  const catalog = plandaBearAssignmentCatalog();
  const rowIds = Array.isArray(row.paperworkIds) ? row.paperworkIds.map(String) : [];
  const paperworkIds = paperwork.map((label, index) => rowIds[index]
    || catalog.find(option => option.label.toLowerCase() === label.toLowerCase())?.id
    || paperworkIdForLabel(label));
  return {
    assignmentId: String(row.assignmentId || (profileId && positionId ? model?.assignmentIdFor?.(profileId, positionId) : '') || ''),
    profileId,
    username: String(row.username || profile?.username || '').trim(),
    person: String(profile?.fullName || person).trim(),
    positionId,
    position,
    paperworkIds,
    paperwork,
    status: row.status === 'completed' ? 'completed' : 'assigned',
    assignedBy: String(row.assignedBy || ''),
    assignedByLabel: String(row.assignedByLabel || ''),
    createdAt: Number(row.createdAt) || 0,
    updatedAt: Number(row.updatedAt) || 0,
    revision: Math.max(0, Number(row.revision) || 0),
  };
}

function getRoleAssignments() {
  if (canonicalRoleAssignments.length) {
    return canonicalRoleAssignments.map(record => normalizeRoleAssignment(record));
  }
  const data = loadPreProData();
  const options = plandaBearAssignmentOptions(data);
  const saved = Array.isArray(data.roleAssignments) ? data.roleAssignments.map(row => normalizeRoleAssignment(row, options)) : [];
  const rows = saved.filter(row => row.person || row.position || row.paperwork.length);
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

function rolePositionOptionsHTML(selected='', selectedId='') {
  const chosen = String(selected || '').trim();
  // Keep the chosen value selectable even if it was removed from this
  // production's list — an existing assignment must never silently change.
  const options = cleanUniqueStrings([...getRolePositionOptions(), chosen])
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity:'base' }));
  return `<option value="">Select position</option>` + options.map(opt => {
    const id = assignmentModel()?.positionIdFor?.(opt) || paperworkIdForLabel(opt).replace(/^paperwork_/, 'position_');
    return `<option value="${esc(id)}" data-position-label="${esc(opt)}" ${(selectedId && id === selectedId) || (!selectedId && opt.toLowerCase() === chosen.toLowerCase()) ? 'selected' : ''}>${esc(opt)}</option>`;
  }).join('');
}

function renderRoleAssignmentRows(rows=getRoleAssignments()) {
  const normalizedRows = (rows.length ? rows : defaultRoleAssignments()).map(row => normalizeRoleAssignment(row));
  const paperworkOptions = plandaBearAssignmentCatalog();
  return `<div class="admin-assignment-list">
    ${normalizedRows.map((row,i)=>{
      const selectedPaperwork = new Set(row.paperworkIds);
      const profile = assignmentProfileById(row.profileId);
      const profileMeta = row.profileId
        ? `${profile?.username ? '@' + profile.username + ' · ' : ''}${row.profileId}`
        : 'Choose a saved profile; display names are not identity.';
      const updated = row.updatedAt ? `Last saved ${new Date(row.updatedAt).toLocaleString()}` : 'Not saved canonically yet';
      const portalReady = profile && Array.isArray(profile.sessions) && profile.sessions.includes(session.code);
      return `<div class="admin-assignment-row" data-role-assignment-row="${i}"
        data-assignment-id="${esc(row.assignmentId)}" data-created-at="${row.createdAt || 0}" data-updated-at="${row.updatedAt || 0}"
        data-record-revision="${row.revision || 0}" data-status="${esc(row.status)}" data-assigned-by="${esc(row.assignedBy)}" data-assigned-by-label="${esc(row.assignedByLabel)}">
        <div class="admin-assignment-top">
          <div class="field">
            <label class="admin-add-label">Student profile</label>
            <select class="admin-in" data-role-field="profileId">${assignmentProfileOptions(row.profileId, row.person)}</select>
            <div class="admin-assignment-profile-id">${esc(profileMeta)}</div>
          </div>
          <div class="field">
            <label class="admin-add-label">Position</label>
            <select class="admin-in" data-role-field="positionId">${rolePositionOptionsHTML(row.position, row.positionId)}</select>
          </div>
          <button class="admin-assignment-remove" onclick="removeRoleAssignmentRow(${i})" title="Remove assignment">x</button>
        </div>
        <div class="field">
          <label class="admin-add-label">Planda Bear Paperwork</label>
          <div class="admin-paperwork-checks">
            ${paperworkOptions.map(option => `<label class="admin-paperwork-pill"><input type="checkbox" data-role-field="paperwork" value="${esc(option.id)}" data-paperwork-label="${esc(option.label)}" ${selectedPaperwork.has(option.id) ? 'checked' : ''}>${esc(option.label)}</label>`).join('')}
          </div>
        </div>
        <div class="admin-assignment-verify"><span>${esc(updated)}</span><span class="${portalReady ? 'portal-ready' : 'portal-not-ready'}">${portalReady ? 'Student portal linked' : 'Profile is not attached to this session'}</span>${row.assignedByLabel ? `<span>By ${esc(row.assignedByLabel)}</span>` : ''}</div>
      </div>`;
    }).join('')}
  </div>`;
}

function getRoleAssignmentsFromAdminDOM(includeBlank=false) {
  const rows = Array.from(document.querySelectorAll('[data-role-assignment-row]')).map(rowEl => {
    const profileId = rowEl.querySelector('[data-role-field="profileId"]')?.value?.trim() || '';
    const profile = assignmentProfileById(profileId);
    const positionSelect = rowEl.querySelector('[data-role-field="positionId"]');
    const positionId = positionSelect?.value?.trim() || '';
    const position = positionSelect?.selectedOptions?.[0]?.dataset?.positionLabel || positionSelect?.selectedOptions?.[0]?.textContent?.trim() || '';
    const paperworkInputs = Array.from(rowEl.querySelectorAll('[data-role-field="paperwork"]:checked'));
    const paperworkIds = paperworkInputs.map(input => input.value);
    const paperwork = paperworkInputs.map(input => input.dataset.paperworkLabel || input.value);
    return {
      assignmentId:rowEl.dataset.assignmentId || '', profileId,
      username:profile?.username || '', person:profile?.fullName || '',
      positionId, position, paperworkIds, paperwork,
      status:rowEl.dataset.status || 'assigned',
      assignedBy:rowEl.dataset.assignedBy || '', assignedByLabel:rowEl.dataset.assignedByLabel || '',
      createdAt:Number(rowEl.dataset.createdAt) || 0, updatedAt:Number(rowEl.dataset.updatedAt) || 0,
      revision:Number(rowEl.dataset.recordRevision) || 0,
    };
  });
  return includeBlank ? rows : rows.filter(row => row.profileId || row.positionId || row.paperworkIds.length);
}

function rerenderRoleAssignments(rows) {
  const wrap = document.getElementById('adminRoleAssignments');
  if (wrap) wrap.innerHTML = renderRoleAssignmentRows(rows.length ? rows : defaultRoleAssignments());
}

function addRoleAssignmentRow() {
  const rows = getRoleAssignmentsFromAdminDOM(true);
  rows.push({ profileId:'', person:'', positionId:'', position:'', paperworkIds:[], paperwork:[] });
  rerenderRoleAssignments(rows);
  markRoleAssignmentsUnsaved();
}

function removeRoleAssignmentRow(index) {
  const rows = getRoleAssignmentsFromAdminDOM(true);
  rows.splice(index, 1);
  rerenderRoleAssignments(rows);
  markRoleAssignmentsUnsaved();
}

function legacyAssignmentRowsFromSession(data={}) {
  const preProRows = data.prePro && Array.isArray(data.prePro.roleAssignments)
    ? data.prePro.roleAssignments : null;
  const topRows = Array.isArray(data.roleAssignments) ? data.roleAssignments : null;
  const rows = (preProRows !== null ? preProRows : (topRows || [])).map(row => ({ ...row }));
  const legacyMap = data.assignments && typeof data.assignments === 'object' ? data.assignments : {};
  for (const [person, position] of Object.entries(legacyMap)) {
    const existing = rows.find(row => sameParticipantName(row.person || row.name, person));
    if (existing) {
      if (!existing.position && !existing.role) existing.position = position;
    } else if (position) {
      rows.push({ person, position, paperwork:[] });
    }
  }
  return rows;
}

function assignmentProfilesForSession(profiles, records, legacyRows) {
  const model = assignmentModel();
  const recordIds = new Set(records.map(record => record.profileId));
  const legacyNames = legacyRows.map(row => String(row.person || row.name || '').trim()).filter(Boolean);
  return profiles.filter(profile => {
    if (!profile || profile.renamedTo || profile.mergedInto || profile.active === false) return false;
    const ids = model?.profileIdentityIds?.(profile) || [profile.profileId];
    return (Array.isArray(profile.sessions) && profile.sessions.includes(session.code))
      || ids.some(id => recordIds.has(id))
      || legacyNames.some(name => sameParticipantName(name, profile.fullName));
  }).sort((a, b) => String(a.fullName || a.username || '').localeCompare(String(b.fullName || b.username || ''), undefined, { sensitivity:'base' }));
}

async function loadAssignmentSnapshots(sessionRef, profileRef, assignmentRef) {
  const network = Promise.all([
    window._getDoc(sessionRef), window._getDocs(profileRef), window._getDocs(assignmentRef),
  ]).then(snapshots => ({ snapshots, forcedCache:false }));
  if (!window._getDocFromCache || !window._getDocsFromCache) return network;
  const timeoutToken = Symbol('assignment-load-timeout');
  let timer = 0;
  const first = await Promise.race([
    network,
    new Promise(resolve => { timer = setTimeout(() => resolve(timeoutToken), 4500); }),
  ]);
  clearTimeout(timer);
  if (first !== timeoutToken) return first;
  try {
    const snapshots = await Promise.all([
      window._getDocFromCache(sessionRef),
      window._getDocsFromCache(profileRef),
      window._getDocsFromCache(assignmentRef),
    ]);
    return { snapshots, forcedCache:true };
  } catch (cacheError) {
    const error = new Error('Firestore did not respond and no complete cached assignment copy is available.');
    error.code = 'unavailable';
    throw error;
  }
}

async function hydrateRoleAssignments({ force=false }={}) {
  if (assignmentHydratePromise && !force) return assignmentHydratePromise;
  if (!window._firebaseReady || !session.code || session.isDemo || session.isExpert || !assignmentModel()) {
    setAssignmentSaveState('failed', 'Canonical assignments need a shared session, Firebase, and the assignment model.');
    return null;
  }
  setAssignmentSaveState('loading', 'Loading saved profiles and assignments…');
  assignmentHydratePromise = (async () => {
    try {
      const sessionRef = window._doc(window._db, 'sessions', session.code);
      const profileRef = window._collection(window._db, 'profiles');
      const assignmentRef = window._collection(window._db, 'sessions', session.code, 'assignments');
      const loaded = await loadAssignmentSnapshots(sessionRef, profileRef, assignmentRef);
      const [sessionSnap, profileSnap, assignmentSnap] = loaded.snapshots;
      if (!sessionSnap.exists()) throw new Error('Production session no longer exists.');
      const sessionData = sessionSnap.data() || {};
      const fromCache = Boolean(loaded.forcedCache || sessionSnap.metadata?.fromCache
        || profileSnap.metadata?.fromCache || assignmentSnap.metadata?.fromCache);
      const records = [];
      assignmentSnap.forEach(docSnap => {
        const record = assignmentModel().normalizeAssignmentRecord({ assignmentId:docSnap.id, ...(docSnap.data() || {}) });
        if (record.productionSession === session.code) records.push(record);
      });
      const profiles = [];
      profileSnap.forEach(docSnap => profiles.push({ id:docSnap.id, ...(docSnap.data() || {}) }));
      const legacyRows = legacyAssignmentRowsFromSession(sessionData);
      assignmentProfiles = assignmentProfilesForSession(profiles, records, legacyRows);
      canonicalRoleAssignments = records;
      assignmentRevision = Math.max(0, Number(sessionData.assignmentRevision) || 0);
      assignmentFromCache = fromCache;
      _assignmentLoadDenied = false;

      _assignmentLegacyPending = !records.length && legacyRows.length > 0;
      let rows;
      if (records.length) {
        rows = records.map(record => normalizeRoleAssignment(record));
        confirmedRoleAssignmentRows = rows.map(row => ({ ...row, paperworkIds:row.paperworkIds.slice(), paperwork:row.paperwork.slice() }));
        setAssignmentSaveState(fromCache ? 'failed' : 'saved', fromCache
          ? `${records.length} cached assignment record${records.length === 1 ? '' : 's'} shown. Reconnect before saving; cached data is not a Firestore confirmation.`
          : `${records.length} assignment record${records.length === 1 ? '' : 's'} confirmed in Firestore · revision ${assignmentRevision}.`);
      } else if (legacyRows.length) {
        rows = legacyRows.map(row => normalizeRoleAssignment(row));
        confirmedRoleAssignmentRows = [];
        const unresolved = rows.filter(row => !row.profileId || !row.positionId).length;
        setAssignmentSaveState(fromCache ? 'failed' : (unresolved ? 'conflict' : 'unsaved'), fromCache
          ? 'Cached legacy assignments are shown, but cloud availability was not confirmed. Reconnect before migration.'
          : unresolved
            ? `${unresolved} legacy row${unresolved === 1 ? '' : 's'} cannot be linked uniquely to a saved profile and position.`
            : `${rows.length} legacy assignment${rows.length === 1 ? '' : 's'} linked. Review and save once to migrate them canonically.`);
      } else {
        rows = defaultRoleAssignments();
        confirmedRoleAssignmentRows = [];
        setAssignmentSaveState(fromCache ? 'failed' : 'saved', fromCache
          ? 'The cached assignment set is empty, but Firestore could not confirm that it is current.'
          : 'No assignments saved yet.');
      }
      rerenderRoleAssignments(rows);
      renderPlandaBearAssignmentsCard();
      return rows;
    } catch (error) {
      assignmentFromCache = false;
      const denied = error?.code === 'permission-denied';
      _assignmentLoadDenied = denied;
      setAssignmentSaveState('failed', denied
        ? 'Firestore denied profiles or assignments. The staged rules need an owner deploy before production can use this workflow.'
        : `${firebaseConnectionLabel(error, 'Could not load assignments')}. Existing local rows were not treated as confirmed.`);
      console.warn('Assignment hydration failed.', error);
      return null;
    } finally {
      assignmentHydratePromise = null;
    }
  })();
  return assignmentHydratePromise;
}

function markRoleAssignmentsUnsaved() {
  if (assignmentSaveState === 'saving') return;
  setAssignmentSaveState('unsaved', 'Draft changed. Save Assignments to confirm it in Firestore.');
}

function localizeConfirmedAssignmentProjection(rows, updatedAt) {
  const local = loadPreProData();
  const fieldTimes = { ...(local._fieldUpdatedAt || {}), roleAssignments:updatedAt };
  const next = { ...local, roleAssignments:rows, _fieldUpdatedAt:fieldTimes, updatedAt:Math.max(Number(local.updatedAt) || 0, updatedAt) };
  try { localStorage.setItem(preProKey(), JSON.stringify(next)); } catch {}
}

async function saveRoleAssignmentsFromAdmin() {
  if (assignmentSaveState === 'saving') return;
  const model = assignmentModel();
  if (!model || !window._runTransaction || !window._getDocs || !session.code || session.isDemo || session.isExpert) {
    setAssignmentSaveState('failed', 'Canonical cloud saving is unavailable in this workspace.');
    return false;
  }
  if (assignmentFromCache) {
    setAssignmentSaveState('failed', 'Assignments were loaded from offline cache. Reconnect and reload the server copy before saving; the draft remains unchanged.');
    return false;
  }
  const draft = getRoleAssignmentsFromAdminDOM().map(row => normalizeRoleAssignment(row));
  const incomplete = draft.find(row => !row.profileId || !row.positionId || !row.person || !row.position);
  if (incomplete) {
    setAssignmentSaveState('failed', 'Every assignment needs a saved student profile and a position.');
    return false;
  }
  const pairs = new Set();
  for (const row of draft) {
    const key = `${row.profileId}|${row.positionId}`;
    if (pairs.has(key)) {
      setAssignmentSaveState('failed', `${row.person} already has ${row.position}. Add a different position or edit the existing row.`);
      return false;
    }
    pairs.add(key);
  }

  setAssignmentSaveState('saving', 'Saving the canonical records and compatibility projection atomically…');
  const actor = assignmentActor();
  const now = Date.now();
  try {
    const collectionRef = window._collection(window._db, 'sessions', session.code, 'assignments');
    const existingSnap = await window._getDocs(collectionRef);
    const existingRecords = new Map();
    const existingDocIds = [];
    existingSnap.forEach(docSnap => {
      existingDocIds.push(docSnap.id);
      const record = model.normalizeAssignmentRecord({ assignmentId:docSnap.id, ...(docSnap.data() || {}) });
      existingRecords.set(record.assignmentId, record);
    });
    const records = draft.map(row => {
      const assignmentId = model.assignmentIdFor(row.profileId, row.positionId);
      return model.createAssignmentRecord({
        assignmentId,
        productionSession:session.code,
        profileId:row.profileId,
        displayName:row.person,
        positionId:row.positionId,
        positionLabel:row.position,
        paperworkIds:row.paperworkIds,
        paperworkLabels:row.paperwork,
        status:row.status || 'assigned',
        assignedBy:actor.id,
        assignedByLabel:actor.label,
      }, existingRecords.get(assignmentId) || null, now);
    });
    const recordIds = new Set(records.map(record => record.assignmentId));
    const compatibility = model.compatibilityRows(records).map((row, index) => ({
      ...row,
      assignmentId:records[index].assignmentId,
      profileId:records[index].profileId,
      positionId:records[index].positionId,
      paperworkIds:records[index].paperworkIds.slice(),
      status:records[index].status,
      assignedBy:records[index].assignedBy,
      assignedByLabel:records[index].assignedByLabel,
      createdAt:records[index].createdAt,
      updatedAt:records[index].updatedAt,
      revision:records[index].revision,
    }));
    const legacyPositionMap = {};
    records.forEach(record => { if (!legacyPositionMap[record.displayName]) legacyPositionMap[record.displayName] = record.positionLabel; });
    const expectedRevision = assignmentRevision;
    const sessionRef = window._doc(window._db, 'sessions', session.code);
    await window._runTransaction(window._db, async tx => {
      const sessionSnap = await tx.get(sessionRef);
      if (!sessionSnap.exists()) throw new Error('Production session no longer exists.');
      const actualRevision = Math.max(0, Number(sessionSnap.data().assignmentRevision) || 0);
      if (model.hasRevisionConflict(expectedRevision, actualRevision)) {
        const conflict = new Error(`Assignments changed on another device (server revision ${actualRevision}, editor revision ${expectedRevision}).`);
        conflict.code = 'assignment-conflict';
        throw conflict;
      }
      existingDocIds.forEach(id => {
        if (!recordIds.has(id)) tx.delete(window._doc(window._db, 'sessions', session.code, 'assignments', id));
      });
      records.forEach(record => tx.set(window._doc(window._db, 'sessions', session.code, 'assignments', record.assignmentId), record));
      tx.update(sessionRef, {
        assignmentRevision:actualRevision + 1,
        assignmentUpdatedAt:now,
        assignmentUpdatedBy:actor.id,
        assignments:legacyPositionMap,
        roleAssignments:compatibility,
        'prePro.roleAssignments':compatibility,
        'prePro._fieldUpdatedAt.roleAssignments':now,
        'prePro.updatedAt':now,
        preProActivity:preProActivityValue({ section:'Role Assignments', by:actor.label, clientId:CLIENT_ID, at:now }, sessionSnap.data().preProActivity),
      });
    });

    assignmentRevision = expectedRevision + 1;
    assignmentFromCache = false;
    canonicalRoleAssignments = records;
    confirmedRoleAssignmentRows = records.map(record => normalizeRoleAssignment(record));
    localizeConfirmedAssignmentProjection(compatibility, now);
    rerenderRoleAssignments(confirmedRoleAssignmentRows);
    renderPlandaBearAssignmentsCard();
    setAssignmentSaveState('saved', `${records.length} assignment record${records.length === 1 ? '' : 's'} confirmed in Firestore · revision ${assignmentRevision}.`);
    toast('Assignments saved to Firestore.');
    return true;
  } catch (error) {
    if (error?.code === 'assignment-conflict') {
      setAssignmentSaveState('conflict', `${error.message} Your draft is still here; load the server copy before deciding what to reapply.`);
    } else if (error?.code === 'permission-denied') {
      setAssignmentSaveState('failed', 'Firestore denied the assignment write. Nothing was labeled Saved; the draft remains for retry or revert.');
    } else {
      setAssignmentSaveState('failed', `${firebaseConnectionLabel(error, 'Assignment save failed')}. Nothing was labeled Saved; the draft remains for retry or revert.`);
    }
    console.warn('Assignment save failed.', error);
    return false;
  }
}

function revertRoleAssignments() {
  rerenderRoleAssignments(confirmedRoleAssignmentRows.length ? confirmedRoleAssignmentRows : defaultRoleAssignments());
  setAssignmentSaveState(assignmentFromCache ? 'failed' : 'saved', assignmentFromCache
    ? 'Reverted to the cached assignment copy. Reconnect before treating it as confirmed.'
    : confirmedRoleAssignmentRows.length
      ? `Reverted to ${confirmedRoleAssignmentRows.length} server-confirmed assignment record${confirmedRoleAssignmentRows.length === 1 ? '' : 's'}.`
      : 'Reverted to the confirmed empty assignment set.');
}

async function retryRoleAssignmentLoad() {
  return hydrateRoleAssignments({ force:true });
}

async function reloadRoleAssignmentsAfterConflict() {
  if (!confirm('Load the server assignment copy and discard this local draft?')) return false;
  return hydrateRoleAssignments({ force:true });
}

function onAssignmentRevisionSnapshot(data={}) {
  const incoming = Math.max(0, Number(data.assignmentRevision) || 0);
  if (incoming === assignmentRevision || assignmentSaveState === 'loading' || assignmentSaveState === 'saving') return;
  if (['unsaved','failed','conflict'].includes(assignmentSaveState)) {
    setAssignmentSaveState('conflict', `Another device saved assignment revision ${incoming} while this draft was open. Load the server copy before saving.`);
    return;
  }
  hydrateRoleAssignments({ force:true });
}

// Compatibility alias for any cached inline handler from the pre-Phase-6 shell.
function autoSaveRoleAssignments() { markRoleAssignmentsUnsaved(); }

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
let rundownSyncBlockedMissing = false;
let beatIdSequence = 0;
const RUNDOWN_HISTORY_LIMIT = 50;
let rundownUndoStack = [];
let rundownRedoStack = [];
const rundownLocalBatchIds = new Set();
let rundownLastSeenBatchId = '';
let rundownHistoryReplay = false;
let rundownHistorySessionCode = '';
let missingSessionNoticeCode = '';

function restoreLocalDraftAsRundownBaseline() {
  if (!restoreLocalDraft()) return false;
  rundownCloudBeats = [];
  rundownShadowBeats = cloneRundownValue(beats);
  rundownShadowShow = { name:show.name, start:normalizeTimeValue(show.start), freeMode:freeTextMode };
  return true;
}

// v2.1 D5: standardized on the shared two-letter format (YYMM + 2 letters
// from the 24-letter no-I/O alphabet = 576 codes/month). Collisions are the
// create-if-missing transaction's job, never this function's.
function genCode() {
  return window.CueolaSessionClone
    ? CueolaSessionClone.generateEpisodeCode()
    : `${String(new Date().getFullYear()).slice(-2)}${pad(new Date().getMonth() + 1)}AA`;
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
  session = sessionWithProfileIdentity({ code:(code || '').trim().toUpperCase(), role, userName:name || 'You', isDemo:false, isExpert:false }, name);
  show = { name:showName || 'Untitled Show', start:'' };
  beats = [];
  freeTextMode = true;
  rememberLastSession(session.code, session.userName);
  restoreLocalDraftAsRundownBaseline();
  enterRundown();
  toast('Opened local copy. Shared sync is unavailable while offline.');
}

function openLocalPlandaBear(code='', name='You') {
  session = sessionWithProfileIdentity({ code:(code || 'LOCAL').trim().toUpperCase(), role:'instructor', userName:name || 'You', isDemo:false, isExpert:false }, name);
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

async function createSession() {
  const name = document.getElementById('inst-name').value.trim();
  const showName = document.getElementById('inst-show').value.trim();
  const err = document.getElementById('inst-err');
  const btn = document.getElementById('inst-create-btn');
  if (!name) {
    err.textContent = 'Please enter your name.';
    err.classList.add('on');
    return;
  }
  err.classList.remove('on');
  if (btn) { btn.disabled = true; btn.textContent = 'Creating...'; }
  const ready = await waitForFirebaseReady();
  if (!ready) {
    err.textContent = 'Cueola cloud did not finish loading. Check the connection and try again.';
    err.classList.add('on');
    if (btn) { btn.disabled = false; btn.textContent = 'Create Session'; }
    return;
  }
  try {
    let code = '';
    let created = false;
    for (let attempt = 0; attempt < 12 && !created; attempt++) {
      code = genCode();
      const ref = window._doc(window._db, 'sessions', code);
      const payload = buildSessionBootstrapPayload({
        code,
        createdBy:name,
        ownerUid:adminSession?.id || '',
        showName:showName || 'Untitled Show',
        startTime:'',
        beats:[],
        rundownAliases:{},
        customSources:{},
        cues:[],
        freeMode:false,
        createdAt:window._serverTimestamp(),
      });
      created = await createSessionDocumentIfMissing(ref, payload);
    }
    if (!created) throw new Error('No unused session code was available.');
    session = sessionWithProfileIdentity({ code, role:'instructor', userName:name, isDemo:false, isExpert:false }, name);
    show = { name:showName || 'Untitled Show', start:'' };
    beats = [];
    rundownAliases = {};
    sessionCustomSources = {};
    freeTextMode = false;
    document.getElementById('code-display-val').textContent = session.code;
    hideModal('modal-inst');
    showModal('modal-code');
  } catch (createErr) {
    err.textContent = firebaseConnectionHint(createErr);
    err.classList.add('on');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Create Session'; }
  }
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
  window.CueolaIdentity?.decorateJoin('stud');
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
  window.CueolaIdentity?.decorateJoin('pp');
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
  const typedName = document.getElementById('stud-name').value.trim();
  const signedProfile = window.CueolaIdentity?.profile?.();
  const name = signedProfile?.fullName || typedName;
  const errEl = document.getElementById('stud-err');
  if (!code || !name) { errEl.textContent='Code and name required.'; errEl.classList.add('on'); return; }
  errEl.classList.remove('on');
  const btn = document.getElementById('stud-join-btn');
  if (btn) { btn.disabled=true; btn.textContent='Checking...'; }
  const ready = await waitForFirebaseReady();
  if (!ready) {
    errEl.textContent = 'Cueola cloud did not finish loading. Check the connection, then try again.';
    errEl.classList.add('on');
    if (btn) { btn.disabled=false; btn.textContent='Join Session'; }
    return;
  }
  try {
      const snap = await window._getDoc(window._doc(window._db,'sessions',code));
      // A soft-deleted session (dashboard Recently Deleted) reads as gone.
      if (!snap.exists() || snap.data()?.deletedAt) {
        errEl.textContent = 'Session not found. Check the code and try again.';
        errEl.classList.add('on');
        return;
      }
      const d = snap.data() || {};
      // Per-session admin toggle: entry may require an active class login code
      // (profiles whose own code is still active pass without extra friction).
      const gate = window.CueolaIdentity ? await CueolaIdentity.entrySatisfied(d, 'stud-entry-code') : { pass: true };
      if (!gate.pass) {
        if (gate.needsInput) CueolaIdentity.revealEntryCodeRow('stud-entrycode-row');
        errEl.textContent = gate.msg || 'This session requires a class login code.';
        errEl.classList.add('on');
        return;
      }
      // Joining by code always landed as 'student' — even for the teacher who
      // created the session — which silently removed the ability to advance
      // the live rundown (TH2607). A signed-in admin profile keeps the wheel.
      const joinRole = signedProfile?.role === 'admin' ? 'instructor' : 'student';
      session = sessionWithProfileIdentity({ code, role:joinRole, userName:name, isDemo:false, isExpert:false }, name);
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
      window.CueolaIdentity?.noteJoin(code, name);
  } catch (joinErr) {
    errEl.textContent = `${firebaseConnectionLabel(joinErr, 'Could not load session')}. Check the connection and try again.`;
    errEl.classList.add('on');
  } finally {
    if (btn) { btn.disabled=false; btn.textContent='Join Session'; }
  }
}

async function joinPreProSession() {
  const code = document.getElementById('pp-join-code').value.trim().toUpperCase();
  const typedName = document.getElementById('pp-join-name').value.trim();
  const signedProfile = window.CueolaIdentity?.profile?.();
  const name = signedProfile?.fullName || typedName;
  const errEl = document.getElementById('pp-join-err');
  if (!code || !name) { errEl.textContent='Code and name required.'; errEl.classList.add('on'); return; }
  errEl.classList.remove('on');
  const btn = document.getElementById('pp-join-btn');
  if (btn) { btn.disabled=true; btn.textContent='Checking…'; }
  const openLocal = snap => {
    const d = snap.data() || {};
    // Same role rule as joinSession: an admin profile keeps instructor standing.
    const joinRole = signedProfile?.role === 'admin' ? 'instructor' : 'student';
    session = sessionWithProfileIdentity({ code, role:joinRole, userName:name, isDemo:false, isExpert:false }, name);
    freeTextMode = false;
    show = { name:d.showName || 'Untitled Show', start:normalizeTimeValue(d.startTime) };
    if (Array.isArray(d.beats)) beats = d.beats.map(migrateBeat);
    // Merge shared work and recover any newer draft still on this device without
    // replacing unrelated cloud sections.
    mergePreProFromCloud(d.prePro && typeof d.prePro === 'object' ? d.prePro : {}, true);
    rememberLastSession(code, name);
    hideModal('modal-prepro-join');
    // joinPresence first: it SETS the whole presence entry, so the landing
    // page's pbPage announce (issued after, same client queue) survives it.
    joinPresence();
    if (preProJoinTarget === 'notes') openProductionNotes();
    else openPaperworkHub();
    window.CueolaIdentity?.noteJoin(code, name);
  };
  const ready = await waitForFirebaseReady();
  if (!ready) {
    errEl.textContent = 'Cueola cloud did not finish loading. Check the connection, then try again.';
    errEl.classList.add('on');
    if (btn) { btn.disabled=false; btn.textContent=preProJoinTarget === 'notes' ? 'Open Production Notes' : 'Open Planda Bear'; }
    return;
  }
  try {
      const snap = await window._getDoc(window._doc(window._db,'sessions',code));
      // A soft-deleted session (dashboard Recently Deleted) reads as gone.
      if (!snap.exists() || snap.data()?.deletedAt) {
        errEl.textContent = 'Session not found. Check the code and try again.';
        errEl.classList.add('on');
        return;
      }
      // Per-session admin toggle: entry may require an active class login code.
      const gate = window.CueolaIdentity ? await CueolaIdentity.entrySatisfied(snap.data() || {}, 'pp-entry-code') : { pass: true };
      if (!gate.pass) {
        if (gate.needsInput) CueolaIdentity.revealEntryCodeRow('pp-entrycode-row');
        errEl.textContent = gate.msg || 'This session requires a class login code.';
        errEl.classList.add('on');
        return;
      }
      openLocal(snap);
  } catch (joinErr) {
    errEl.textContent = `${firebaseConnectionLabel(joinErr, 'Could not load session')}. Check the connection and try again.`;
    errEl.classList.add('on');
  } finally {
    if (btn) { btn.disabled=false; btn.textContent=preProJoinTarget === 'notes' ? 'Open Production Notes' : 'Open Planda Bear'; }
  }
}

function loadExpert() {
  session = { code:'', role:'instructor', userName:'You', profileId:'', username:'', profileAliases:[], isDemo:false, isExpert:true };
  show = { name:'Untitled Show', start:'' };
  beats = [];
  freeTextMode = true;
  restoreLocalDraftAsRundownBaseline();
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
      ...(adminSession ? { ownerUid: adminSession.id } : {}),
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
    session = sessionWithProfileIdentity({ code, role:'instructor', userName:name, isDemo:false, isExpert:false }, name);
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
  session = { code:'DEMO1', role:'student', userName:'Demo', profileId:'', username:'', profileAliases:[], isDemo:true, isExpert:false };
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
    setCloudSyncState(session.isDemo ? 'local' : 'saving',
      session.isDemo ? 'Demo mode: same-browser sync only.' : (window._firebaseReady ? `Confirming cloud session · ${session.code}` : 'Connecting to cloud sync...'));
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

function isCompleteRundownSessionDocument(data) {
  return Boolean(data && typeof data === 'object' && Array.isArray(data.beats));
}

function buildSessionBootstrapPayload(source={}) {
  const sourceShowName = String(source.showName || '').trim();
  const sourceCreatedBy = String(source.createdBy || '').trim();
  const sourceAliases = source.rundownAliases && typeof source.rundownAliases === 'object'
    ? source.rundownAliases
    : {};
  const sourceCustomSources = source.customSources && typeof source.customSources === 'object'
    ? source.customSources
    : {};
  const payload = {
    code:String(source.code || '').trim().toUpperCase(),
    createdBy:sourceCreatedBy || 'Cueola operator',
    showName:sourceShowName || 'Untitled Show',
    startTime:normalizeTimeValue(source.startTime),
    beats:cloneRundownValue(Array.isArray(source.beats) ? source.beats : []),
    rundownAliases:cloneRundownValue(sourceAliases),
    customSources:cloneRundownValue(sourceCustomSources),
    cues:cloneRundownValue(Array.isArray(source.cues) ? source.cues : []),
    freeMode:Boolean(source.freeMode),
    activeIdx:0,
    status:'idle',
    participants:[],
  };
  if (source.createdAt !== undefined) payload.createdAt = source.createdAt;
  // v2.1 (D1): ownership by Auth uid, stamped when the creator is a signed-in
  // admin and preserved through snapshot recovery.
  if (typeof source.ownerUid === 'string' && source.ownerUid) payload.ownerUid = source.ownerUid;
  return payload;
}

function buildSnapshotRecoveryPayload(doc) {
  const payload = buildSessionBootstrapPayload({
    code:session.code,
    createdBy:session.userName,
    ownerUid:doc?.ownerUid,     // recovery keeps the original owner, never restamps
    showName:doc?.showName,
    startTime:doc?.startTime,
    beats:doc?.beats,
    rundownAliases:doc?.rundownAliases,
    customSources:doc?.customSources,
    cues:doc?.cues,
    freeMode:doc?.freeMode,
    createdAt:window._serverTimestamp(),
  });
  SESSION_RESTORABLE_FIELDS.forEach(field => {
    if (doc?.[field] !== undefined) payload[field] = cloneRundownValue(doc[field]);
  });
  payload.rundownUpdatedAt = Date.now();
  payload.rundownUpdatedBy = session.userName || 'Cueola operator';
  return payload;
}

async function createSessionDocumentIfMissing(ref, payload) {
  if (!window._runTransaction) throw new Error('Firestore transaction support is unavailable.');
  return window._runTransaction(window._db, async transaction => {
    const snap = await transaction.get(ref);
    if (snap.exists()) return false;
    transaction.set(ref, payload);
    return true;
  });
}

async function restoreMissingSessionDocument(ref, payload) {
  if (!window._runTransaction) throw new Error('Firestore transaction support is unavailable.');
  return window._runTransaction(window._db, async transaction => {
    const snap = await transaction.get(ref);
    if (snap.exists() && isCompleteRundownSessionDocument(snap.data())) return false;
    transaction.set(ref, payload);
    return true;
  });
}

function markSharedSessionUnavailable(kind='missing') {
  const incomplete = kind === 'incomplete';
  rundownSyncBlockedMissing = true;
  const detail = incomplete
    ? `Session ${session.code} is incomplete on the server. Local recovery copy kept; use Settings → File → History to restore it.`
    : `Session ${session.code} was not found on the server. Local recovery copy kept; use Settings → File → History to restore it.`;
  setSyncReconnecting(false, `Cloud server reached; session ${session.code} is ${incomplete ? 'incomplete' : 'missing'}`);
  setCloudSyncState('error', detail);
  if (missingSessionNoticeCode !== `${session.code}:${kind}`) {
    missingSessionNoticeCode = `${session.code}:${kind}`;
    logShow('sync', detail);
    toast(detail, 7000);
  }
}

async function probeSharedSessionAuthority() {
  if (!window._getDocFromServer || !session.code) return null;
  const snap = await window._getDocFromServer(window._doc(window._db, 'sessions', session.code));
  if (!snap.exists()) {
    markSharedSessionUnavailable('missing');
    return null;
  }
  if (!isCompleteRundownSessionDocument(snap.data())) {
    markSharedSessionUnavailable('incomplete');
    return null;
  }
  missingSessionNoticeCode = '';
  rundownSyncBlockedMissing = false;
  setSyncReconnecting(false);
  setCloudSyncState('synced', `Cloud sync connected · ${session.code}`);
  if (rundownPendingBatches.length) flushRundownSyncQueue();
  return snap;
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

function rundownBatchTouchedIds(batch) {
  return new Set([
    ...(batch.additions || []).map(beat => String(beat.id)),
    ...(batch.patches || []).map(item => String(item.id)),
    ...(batch.removals || []).map(String),
    ...(batch.order || []).map(String),
  ]);
}

function rundownBatchLabel(batch) {
  if (batch.additions.length) return batch.additions.length === 1 ? 'Add rundown row' : `Add ${batch.additions.length} rundown rows`;
  if (batch.removals.length) return batch.removals.length === 1 ? 'Delete rundown row' : `Delete ${batch.removals.length} rundown rows`;
  if (batch.order) return 'Reorder rundown rows';
  if (batch.patches.length) return batch.patches.length === 1 ? 'Edit rundown row' : `Edit ${batch.patches.length} rundown rows`;
  return 'Edit show settings';
}

function rememberRundownHistory(forward, inverse) {
  rundownUndoStack.push({ forward, inverse, label:rundownBatchLabel(forward), touchedIds:rundownBatchTouchedIds(forward) });
  if (rundownUndoStack.length > RUNDOWN_HISTORY_LIMIT) rundownUndoStack.shift();
  rundownRedoStack = [];
}

function invalidateConflictingRundownHistory(remoteBatch) {
  const touched = rundownBatchTouchedIds(remoteBatch);
  if (!touched.size) return;
  const keep = entry => ![...entry.touchedIds].some(id => touched.has(id));
  const before = rundownUndoStack.length + rundownRedoStack.length;
  rundownUndoStack = rundownUndoStack.filter(keep);
  rundownRedoStack = rundownRedoStack.filter(keep);
  if (before !== rundownUndoStack.length + rundownRedoStack.length) {
    toast('Undo history updated after a collaborator edited the same row.');
  }
}

function applyRundownHistoryBatch(batch) {
  beats = applyRundownBatch(beats, batch, rundownAliases);
  if (batch.showPatch.showName !== undefined) show.name = batch.showPatch.showName;
  if (batch.showPatch.startTime !== undefined) show.start = normalizeTimeValue(batch.showPatch.startTime);
  if (batch.showPatch.freeMode !== undefined) freeTextMode = Boolean(batch.showPatch.freeMode);
  renderRundown();
  rundownHistoryReplay = true;
  syncToFirestore();
  rundownHistoryReplay = false;
}

function undoRundownEdit() {
  const entry = rundownUndoStack.pop();
  if (!entry) { toast('Nothing to undo.'); return; }
  applyRundownHistoryBatch(entry.inverse);
  rundownRedoStack.push(entry);
  toast(`Undid: ${entry.label}`);
}

function redoRundownEdit() {
  const entry = rundownRedoStack.pop();
  if (!entry) { toast('Nothing to redo.'); return; }
  applyRundownHistoryBatch(entry.forward);
  rundownUndoStack.push(entry);
  toast(`Redid: ${entry.label}`);
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
  if (rundownSyncRunning || rundownSyncBlockedMissing || !rundownPendingBatches.length || !window._runTransaction) return;
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
      if (!snap.exists()) {
        const missingError = new Error(`Session ${targetSessionCode} was not found on the server.`);
        missingError.code = 'not-found';
        missingError.cueolaSessionAvailability = 'missing';
        throw missingError;
      }
      const data = snap.data() || {};
      if (!isCompleteRundownSessionDocument(data)) {
        const incompleteError = new Error(`Session ${targetSessionCode} is incomplete on the server.`);
        incompleteError.cueolaSessionAvailability = 'incomplete';
        throw incompleteError;
      }
      const mergedAliases = { ...(data.rundownAliases || {}) };
      committedBeats = applyRundownBatch(Array.isArray(data.beats) ? data.beats : [], batch, mergedAliases, mergedAliases);
      committedAliases = mergedAliases;
      const update = {
        beats: committedBeats,
        rundownAliases: mergedAliases,
        ...batch.showPatch,
        rundownUpdatedAt: Date.now(),
        rundownUpdatedBy: batch.by,
        rundownBatchId: batch.id,
      };
      transaction.update(ref, update);
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
    const unavailableKind = err?.cueolaSessionAvailability || (err?.code === 'not-found' ? 'missing' : '');
    if (unavailableKind) {
      markSharedSessionUnavailable(unavailableKind);
      return;
    }
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
    if (rundownHistorySessionCode !== session.code) {
      rundownHistorySessionCode = session.code;
      rundownUndoStack = [];
      rundownRedoStack = [];
      rundownLocalBatchIds.clear();
      rundownLastSeenBatchId = '';
      rundownSyncBlockedMissing = false;
      sessionSnapshotLastAt = 0;
      sessionSnapshotLatestDoc = null;
      sessionSnapshotPendingForceReason = '';
    }
    if (firestoreUnsub) firestoreUnsub();
    pbStartNotesListener();   // per-note live push (resets itself on session change)
    const ref = window._doc(window._db,'sessions',session.code);

    // includeMetadataChanges: with the persistent cache, coming back online can
    // deliver a metadata-only transition (fromCache→server, ack of a queued
    // write) with no data change — without it the RECONNECTING chip never
    // clears after an idle offline stretch.
    firestoreUnsub = window._onSnapshot(ref, { includeMetadataChanges: true }, snap => {
      if (!snap.exists()) {
        if (!snap.metadata?.fromCache) markSharedSessionUnavailable('missing');
        return;
      }
      const d = snap.data() || {};
      if (!isCompleteRundownSessionDocument(d)) {
        if (!snap.metadata?.fromCache) markSharedSessionUnavailable('incomplete');
        return;
      }
      rundownSyncBlockedMissing = false;
      missingSessionNoticeCode = '';
      // Only a server-confirmed snapshot may claim "connected"; a cached one
      // while offline keeps the reconnecting state (set by noteSnapshotArrived
      // below). Queued/in-flight local writes show as saving.
      const snapMeta = snap.metadata || {};
      if (rundownPendingBatches.length || snapMeta.hasPendingWrites) setCloudSyncState('saving', 'Cloud sync saving changes...');
      else if (!snapMeta.fromCache) setCloudSyncState('synced', `Cloud sync connected · ${session.code}`);
      try {
        sessionSnapshotLatestDoc = JSON.parse(JSON.stringify(d));
        captureSessionSnapshot(sessionSnapshotLastAt ? 'interval' : 'joined');
      } catch (err) {
        console.warn('Session history could not read this snapshot', err);
      }
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
      const incomingBatchId = typeof d.rundownBatchId === 'string' ? d.rundownBatchId : '';
      if (incomingBatchId && incomingBatchId !== rundownLastSeenBatchId && !rundownLocalBatchIds.has(incomingBatchId) && Array.isArray(d.beats)) {
        const remoteBatch = buildRundownBatch(rundownCloudBeats, d.beats.map(migrateBeat), rundownShadowShow, rundownShadowShow);
        invalidateConflictingRundownHistory(remoteBatch);
      }
      if (incomingBatchId) rundownLastSeenBatchId = incomingBatchId;
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
      saveLocalDraft();
      if (d.prePro && typeof d.prePro === 'object' && !groupActive()) {
        // D2: while a group is active, the parent-doc prePro is the frozen
        // master copy — the group subdoc listener owns paperwork merges.
        try { mergePreProFromCloud(d.prePro); } catch {}
      }
      pbEnsureGroupSubscription();   // groups config can appear/lock mid-session
      onAssignmentRevisionSnapshot(d);
      if (d.preProNotes !== undefined) onRemoteProductionNotes(d.preProNotes);
      // The shared show cue is authoritative independently of this device's
      // local/followed selection. Older code folded both values into lsIdx.
      if (Number.isFinite(d.activeIdx)) {
        // A parked or legacy doc can point the shared cue at a segment marker
        // or a disabled/deleted row (TH2607: activeIdx 0 on a leading segment
        // from session creation). The Live run ledger rightly refuses those —
        // resolve to the next playable row, and contain any residual throw so
        // one bad index cannot abort the rest of this snapshot handler
        // (presence, prompter, clock, and rundown updates all ride below).
        const remoteActiveIdx = liveCueIsDisabled(d.activeIdx)
          ? liveNextPlayableCueIndex(d.activeIdx)
          : d.activeIdx;
        if (remoteActiveIdx >= 0 && remoteActiveIdx < beats.length) {
          try { adoptLiveActiveCue(remoteActiveIdx, { select:false, reason:'firestore-active-cue' }); }
          catch (error) { containError('Remote active-cue adoption', error); }
        }
      }
      // Following: mirror the position of whoever I follow (their broadcast
      // presence.idx). Browsing self keeps my own position. A student who hasn't
      // chosen mirrors the show caller (first instructor).
      {
        const followedIdx = resolveFollowedIdx(d.presence, { followTarget, followTargetId, browsingSelf, role: session.role, myName: session.userName });
        const targetIdx = followedIdx != null ? followedIdx : (session.role === 'student' && Number.isFinite(d.activeIdx) && !browsingSelf && !followTarget ? d.activeIdx : null);
        if (targetIdx != null && targetIdx !== lsIdx) {
          setLiveSelectedCue(targetIdx, { reason:'followed-cue' });
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
      if (isFlowmingoTalentActive() && d.prompter?.control?.action && !isPrompterSelfSender(d.prompter.control.sender)) {
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
        _handlePrompterOperatorMessage({ type:'PROMPTER_HEARTBEAT', ..._hb });
      }
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
      if (rundownPendingBatches.length) flushRundownSyncQueue();
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
function setSyncReconnecting(on, restoredDetail='Cloud sync restored') {
  const chip = document.getElementById('ls-stat-sync');
  if (chip) chip.hidden = !on;
  if (on) setCloudSyncState('saving', 'Cloud sync reconnecting — showing last known state…');
  if (on !== _syncReconnState) {   // P7: log only the transitions, not every snapshot
    _syncReconnState = on;
    logShow('sync', on ? 'Cloud sync reconnecting — showing last known state' : restoredDetail);
  }
  renderLiveStatusRail();
}
window.addEventListener('offline', () => { if (session.code && !session.isDemo && !session.isExpert) setSyncReconnecting(true); });
window.addEventListener('online', () => { /* chip clears on the next server snapshot */ });

function syncToFirestore() {
  saveLocalDraft();
  const currentShow = { name:show.name, start:normalizeTimeValue(show.start), freeMode:freeTextMode };
  const batch = buildRundownBatch(rundownShadowBeats, beats, rundownShadowShow, currentShow);
  if (!rundownBatchHasChanges(batch)) return;
  if (!rundownHistoryReplay) {
    const inverse = buildRundownBatch(beats, rundownShadowBeats, currentShow, rundownShadowShow);
    rememberRundownHistory(batch, inverse);
  }
  rundownShadowBeats = cloneRundownValue(beats);
  rundownShadowShow = currentShow;
  if (!window._firebaseReady||!session.code||session.isDemo||session.isExpert) {
    if (!session.isDemo) setCloudSyncState('local', session.isExpert ? 'Local-only workspace. Saved in this browser.' : 'Saved locally. Cloud sync unavailable.');
    return;
  }
  rundownLocalBatchIds.add(batch.id);
  if (rundownLocalBatchIds.size > 100) rundownLocalBatchIds.delete(rundownLocalBatchIds.values().next().value);
  rundownPendingBatches.push(batch);
  if (rundownSyncBlockedMissing) {
    markSharedSessionUnavailable('missing');
    return;
  }
  setCloudSyncState('saving', 'Cloud sync saving changes...');
  flushRundownSyncQueue();
}

function syncLiveIdx() {
  markResumeState();   // P7: live position rides the resume record (Decisions #14)
  if (!window._firebaseReady||!session.code||session.isDemo||session.isExpert) return;
  const liveState = liveSessionState();
  const selectedIdx = liveState.selectedCueIndex;
  // Broadcast my own position into my presence record so anyone following me
  // mirrors it. (Your navigation only moves your followers, not the whole room.)
  // Only an instructor driving their own position publishes the shared active
  // cue. A follower/student browsing locally must never overwrite show state.
  const update = {
    [`presence.${presenceId}.idx`]: selectedIdx,
    [`presence.${presenceId}.lastSeen`]: Date.now(),
  };
  if (canOwnLiveActiveCue()) update.activeIdx = liveState.activeCueIndex;
  window._updateDoc(window._doc(window._db,'sessions',session.code), update).catch(()=>{});
}

// ─────────────────────────────────────────────────────────────
// PRESENCE
// ─────────────────────────────────────────────────────────────
async function joinPresence() {
  if (!session.code||session.isDemo||session.isExpert||!window._firebaseReady) return;
  pbStartNotesListener();   // hub/notes-only joins never run setupFirestore — this is their live push
  const name = session.role==='instructor' ? session.userName : (session.userName||'?');
  const identity = session.profileId ? {
    profileId: session.profileId,
    username: session.username || '',
    profileAliases: Array.isArray(session.profileAliases) ? session.profileAliases : [],
  } : {};
  try {
    await window._updateDoc(window._doc(window._db,'sessions',session.code),{
      [`presence.${presenceId}`]:{name,role:session.role,...identity,
        ...(groupActive() ? { groupId: activeGroupId } : {}),   // D2: group on the presence entry
        lastSeen:Date.now(),following:session.userName,followingId:'',idx:Math.max(lsIdx,0)}
    });
    clearInterval(presenceInterval);
    presenceInterval = setInterval(async()=>{
      try { await window._updateDoc(window._doc(window._db,'sessions',session.code),{[`presence.${presenceId}.lastSeen`]:Date.now()}); } catch {}
    },30000);
  } catch {}

  // Persist the canonical profile identity with the dashboard-visible roster.
  // A transaction upgrades an older name-only participant without dropping a
  // concurrent join, and a profile id wins over mutable display-name matching.
  try {
    const ref = window._doc(window._db,'sessions',session.code);
    await window._runTransaction(window._db, async tx => {
      const snap = await tx.get(ref);
      if (!snap.exists()) return;
      const existing = Array.isArray(snap.data().participants) ? snap.data().participants.slice() : [];
      const at = existing.findIndex(p => session.profileId
        ? p?.profileId === session.profileId || (!p?.profileId && sameParticipantName(p?.name, name))
        : sameParticipantName(p?.name, name));
      const participant = { ...(at >= 0 ? existing[at] : {}), name, role:session.role, ...identity, joinedAt: at >= 0 ? (existing[at]?.joinedAt || Date.now()) : Date.now() };
      if (at >= 0) existing[at] = participant;
      else existing.push(participant);
      tx.update(ref, { participants: existing });
    });
  } catch {}
}

async function leavePresence() {
  clearInterval(presenceInterval);
  presenceInterval = null;
  if (!session.code||!window._firebaseReady) return;
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
      const pos = pbPositionFor(p.name);
      const tip = `${esc(p.name)} · ${p.role==='instructor'?'Instructor':'Student'}${pos?` · ${esc(pos)}`:''}${canInspect?' · click for info':''}`;
      const click = canInspect ? ` onclick="openPersonInfo(${JSON.stringify(p.name).replace(/"/g,'&quot;')})"` : '';
      return `<div class="p-avatar ${p.role==='instructor'?'inst':'stud'}${canInspect?' pi-click':''}" data-fullname="${tip}"${click}>${initials(p.name)}</div>`;
    }).join('')+
    (extra>0?`<div class="p-avatar extra" data-fullname="${extra} more in session">+${extra}</div>`:'');
  document.getElementById('presenceTooltip').innerHTML =
    `<div style="font-size:10px;font-family:var(--mono);color:var(--text3);letter-spacing:.08em;margin-bottom:2px">IN SESSION</div>`+
    active.map(p=>{
      const col=p.role==='instructor'?'var(--accent)':'var(--green)';
      const pos = pbPositionFor(p.name);
      return `<div class="p-tip-row" title="${esc(p.name)}${pos?` — ${esc(pos)}`:''}"><div class="p-tip-dot" style="background:${col};color:${col}"></div><span class="p-tip-name">${esc(p.name)}</span>${pos?`<span class="p-tip-pos">${esc(pos)}</span>`:''}<span class="p-tip-label">${p.role==='instructor'?'INST':'STU'}</span></div>`;
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
window.addEventListener('pagehide', () => {
  if (isFlowmingoTalentActive()) stopPrompterTalentRuntime();
});

function isTextEditingTarget(target) {
  return target?.tagName === 'INPUT' ||
    target?.tagName === 'TEXTAREA' ||
    target?.isContentEditable ||
    Boolean(target?.closest?.('[contenteditable="true"]'));
}

function isInteractiveTarget(target) {
  if (!target || typeof target.closest !== 'function') return false;
  return Boolean(target.closest([
    'button', 'input', 'textarea', 'select', 'option', 'a', 'label', 'summary',
    '[role="button"]', '[role="slider"]', '[contenteditable="true"]',
    '[data-live-interactive]', '.ls-sidebar', '.prompt-op-panel',
    '.flowop-controls', '.modal', '.overlay', '.scrollable'
  ].join(',')));
}

function isInteractiveEventTarget(event) {
  return isInteractiveTarget(event?.target) || isInteractiveTarget(document.activeElement);
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
  { id: 'prompter.cue.current',scope: 'live', group: 'Prompter', keys: ['C'],      label: 'Cue prompter to current row',   run: () => sendPrompterControl('seek_row_' + (Math.max(liveActiveCueIndex(), 0) + 1)) },
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

function liveCommandDispatchAllowed(options={}) {
  const allowed = typeof liveSessionController.canDispatch === 'function'
    ? liveSessionController.canDispatch()
    : liveSessionState().lifecycle === 'live';
  if (!allowed && options.notify) {
    const status = document.getElementById('exitLiveStatus');
    if (status && document.getElementById('exitLiveOv')?.classList.contains('on')) {
      status.textContent = 'Live commands are paused while Cueola returns to the rundown.';
    }
  }
  return allowed;
}

function releaseLiveCommandHolds() {
  _keymapHolds.forEach(stop => sendPrompterControl(stop));
  _keymapHolds.clear();
}

function keymapDispatch(e, phase) {
  const scope = keymapScopeNow();
  if (!scope) return false;
  if (scope === 'build' && phase === 'down' && !e.repeat && !isTextEditingTarget(e.target) && (e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === 'z') {
    consumeRemoteKey(e);
    if (e.shiftKey) redoRundownEdit();
    else undoRundownEdit();
    return true;
  }
  if (scope === 'live' && !liveCommandDispatchAllowed()) {
    if (phase === 'up') releaseLiveCommandHolds();
    const matched = KEYMAP.some(action => action.scope === 'live' && keymapBindings(action).some(binding => keymapMatches(e, binding)));
    if (matched) consumeRemoteKey(e);
    return matched;
  }
  // Overlays own their keys before the map runs.
  if (document.getElementById('lsRowPreviewOv')?.classList.contains('on')) {
    if (phase !== 'down' || isTextEditingTarget(e.target)) return false;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { consumeRemoteKey(e); previewRelativeRow(1); }
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { consumeRemoteKey(e); previewRelativeRow(-1); }
    else if (e.key === 'Escape') { consumeRemoteKey(e); hideOverlay('lsRowPreviewOv'); }
    return true;
  }
  if (document.getElementById('lsStartChoiceOv')?.classList.contains('on')) {
    // The start-from chooser owns the keys — Space must not fire GO underneath.
    if (phase === 'down' && e.key === 'Escape') { consumeRemoteKey(e); hideOverlay('lsStartChoiceOv'); }
    return true;
  }
  if (typeof jogScrubHandleKey === 'function' && jogScrubHandleKey(e, phase)) return true;
  if (isInteractiveEventTarget(e)) {
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
    return false;   // controls and editable surfaces own their native keys
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
window.addEventListener('blur', releaseLiveCommandHolds);

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
  // Dialog-stack fallback: popovers/overlays keep priority (the defaultPrevented
  // guard above covers keymapRef/jog/lsRowPreview, which consume via
  // consumeRemoteKey). data-esc-hold preserves the Phase-6 explicit-dismiss
  // exemptions for panels with unsaved edits.
  const top = topDialog();
  if (!top || top.hasAttribute('data-esc-hold')) return;
  if (top.id === 'productionNotesModal' && document.getElementById('pbBoard')?.classList.contains('composing')) {
    e.preventDefault();
    pbCloseComposer();
    return;
  }
  if (top.id === 'paperPreviewModal') {
    // Esc on a Planda Bear preview returns to the workspace, not the front page.
    e.preventDefault();
    dismissPaperPreview();
    return;
  }
  e.preventDefault();
  closeDialog(top.id);
});
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
// Dialogue cues intentionally store a short rundown note instead of verbatim
// copy. Treat that note as script content everywhere the Script Op/Flowmingo
// feed asks whether a row has something to show.
function scriptCueText(d) {
  if (d?.scriptType === 'Dialogue') return cleanPrompterText(d.dialogueNote || d.text || '');
  return cleanPrompterText(d?.text || d?.dialogueNote || '');
}

function getCueCell(b, type) {
  const tc = CT[type];
  const d = b.cues?.[type];
  const on  = getCueOn(d);
  const off = getCueOff(d);
  const scriptText = type === 'script' ? scriptCueText(d) : '';
  const isEmpty = !on && !off && (type !== 'script' || !scriptText) && !(type === 'playback' && d?.outCueId) && !((type === 'playback' || type === 'audio') && d?.outPadId);
  if (isEmpty) {
    return `<button class="cue-add-btn" onclick="event.stopPropagation();openCueConfig(${b.id},'${type}')" title="Add ${tc.label} cue"><span>+</span><span>${tc.label}</span></button>`;
  }
  const lines = [
    on  ? `<div class="cue-on-line"><span class="cue-on-dot">${sfIcon('marker.go')}</span>${esc(on)}</div>`  : '',
    off ? `<div class="cue-off-line"><span class="cue-off-dot">${sfIcon('marker.stop')}</span>${esc(off)}</div>` : '',
  ].filter(Boolean).join('');
  const scriptMeta = scriptText
    ? `<div class="script-present-line">${d?.scriptType === 'Dialogue' ? 'Dialogue' : 'Script'} · ${scriptLineLabel(scriptText)}</div>`
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
  document.getElementById('cueConfigFields').innerHTML = bodyHTML + outrangutanCueFields(type, existing);
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
  // QLab integration removed 2026-07-13 (owner decision) — stale qlabCue/
  // qlabAction/qlabAuto fields on old rows are dropped whenever a cue is re-saved.
  delete d.qlabCue; delete d.qlabAction; delete d.qlabAuto;
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
// OUTRANGUTAN INTEGRATION (Cueola rundown ⇄ Outrangutan playback)
// A rundown `playback` cue can link to an Outrangutan cue. Firing it (manual GO
// or auto on live advance) writes sessions/<code>.outrangutan.command; the
// Outrangutan module (subscribed to the same session) plays it locally and
// publishes back sessions/<code>.outrangutan.{cues,live}, which we render into
// the cell. Transport: one command object, deduped by id on the receiver.
// ─────────────────────────────────────────────────────────────
let outrangutanState = { cues: {}, pads: {}, live: null };
let _outCmdSeq = 0;
let _ogLiveStamp = 0;   // last applied live seq/ts — receivers drop stale out-of-order packets (P3)

function syncOutrangutanControllerStatus(og=outrangutanState) {
  const transport = og?.live?.status || '';
  const cueCount = Object.keys(og?.cues || {}).length;
  const output = window.Outrangutan?.outputStatus?.() || og?.live?.outputs || null;
  const outputStatus = output?.status || '';
  let status = 'closed';
  let detail = 'No playout connected';
  if (['stalled','disconnected','recovering','degraded','error'].includes(outputStatus)) {
    status = outputStatus;
    detail = output?.detail || 'Playback output needs recovery';
  } else if (outputStatus === 'closed') {
    status = transport === 'play' || transport === 'pause' ? 'disconnected' : 'closed';
    detail = transport === 'play' || transport === 'pause' ? 'Media is active but no playback output is connected' : (output?.detail || 'No playback output connected');
  } else if (outputStatus === 'opening' || outputStatus === 'connecting') { status = outputStatus; detail = output?.detail || 'Connecting playback output'; }
  else if (transport === 'play') { status = 'active'; detail = og.live?.name || 'Media playing'; }
  else if (transport === 'pause') { status = 'paused'; detail = og.live?.name || 'Media paused'; }
  else if (transport === 'pre') { status = 'ready'; detail = og.live?.name || 'Media in preview'; }
  else if (transport === 'error') { status = 'error'; detail = og.live?.name || 'Playback error'; }
  else if (outputStatus === 'ready' || cueCount || window.Outrangutan?.isReady?.()) {
    status = 'ready';
    detail = output?.detail || (cueCount ? `${cueCount} media cues available` : 'Local playout ready');
  }
  // The Live controller deliberately exposes one bounded status vocabulary.
  // A partially available output group is operationally stalled, with the
  // detailed degradation retained beside Playback for recovery.
  if (status === 'degraded') status = 'stalled';
  setLiveSubsystemStatus('playback', status, detail);
  const chip = document.getElementById('ls-stat-playback');
  if (chip) {
    const label = { active:'RUNNING', paused:'PAUSED', ready:'READY', opening:'OPENING', connecting:'CONNECTING', stalled:'STALLED', disconnected:'DISCONNECTED', recovering:'RECOVERING', degraded:'DEGRADED', error:'ERROR', closed:'CLOSED' }[status] || 'CLOSED';
    chip.textContent = `PLAYOUT ${label}`;
    chip.title = detail;
    chip.classList.toggle('connected', ['active','paused','ready'].includes(status));
    chip.classList.toggle('recovering', ['opening','connecting','recovering'].includes(status));
    chip.classList.toggle('error', ['stalled','disconnected','degraded','error'].includes(status));
    chip.dataset.playbackStatus = status;
  }
}

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
  syncOutrangutanControllerStatus(outrangutanState);
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
      <div class="cc-trigger-row">
        <div class="cc-trigger-cue-field" style="flex:1">
          <label class="field-lbl">Link to an Outrangutan cue</label>
          <select class="field-in" id="cc-out-cue">${outrangutanCueOptions(d.outCueId || '')}</select>
          ${emptyCues ? `<div class="cc-out-hint">Open Outrangutan in this session to list its cues.</div>` : ''}
        </div>
      </div>
      <label class="cc-check cc-trigger-auto"><input type="checkbox" id="cc-out-auto" ${d.outAuto ? 'checked' : ''}> Auto-fire when this row advances live</label>`;
  const sfxPart = `
      <div class="cc-trigger-row">
        <div class="cc-trigger-cue-field" style="flex:1">
          <label class="field-lbl">SFX pad</label>
          <select class="field-in" id="cc-out-pad">${outrangutanPadOptions(d.outPadId || '')}</select>
          ${emptyPads ? `<div class="cc-out-hint">Assign pads on Outrangutan's SFX board to list them here.</div>` : ''}
        </div>
      </div>
      <label class="cc-check cc-trigger-auto"><input type="checkbox" id="cc-out-pad-auto" ${d.outPadAuto ? 'checked' : ''}> Auto-fire SFX when this row advances live</label>`;
  return `
    <div class="field cc-trigger cc-outrangutan">
      <div class="cc-section-lbl cc-trigger-head"><span class="cc-out-glyph"><svg class="brand-ico"><use href="#ic-outrangutan"/></svg></span> Outrangutan ${type === 'playback' ? 'playback' : 'SFX'} <span class="cc-trigger-optional">— optional</span></div>
      ${cuePart}
      ${sfxPart}
      <div class="cc-trigger-actions">
        ${type === 'playback' ? `<button type="button" class="cc-trigger-fire" id="cc-out-fire" onclick="fireOutrangutanFromModal()"><span class="cc-out-glyph"><svg class="brand-ico"><use href="#ic-outrangutan"/></svg></span> Fire in Outrangutan now</button>` : ''}
        <button type="button" class="cc-trigger-fire" id="cc-out-fire-sfx" onclick="fireOutrangutanSfxFromModal()"><span class="cc-out-glyph"><svg class="brand-ico"><use href="#ic-outrangutan"/></svg></span> Fire SFX now</button>
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

// Honest success copy: a command is a fire-and-forget session-doc write. When
// no playout has ever published into this session, say so instead of implying
// something played.
function outrangutanEverConnected() {
  if (window.Outrangutan && window.Outrangutan._local && window.Outrangutan._local.session?.() === session.code) return true;
  return Boolean(outrangutanState && (outrangutanState.live || Object.keys(outrangutanState.cues || {}).length));
}
function outrangutanSendToast(kind) {
  toast(outrangutanEverConnected()
    ? `Outrangutan: ${kind} sent.`
    : `${kind} queued — open Outrangutan on the playout machine to receive it.`);
}

function fireOutrangutanFromModal() {
  const outCue = document.getElementById('cc-out-cue')?.value || '';
  if (!outCue) { toast('Link an Outrangutan cue first.'); return; }
  if (fireOutrangutanCommand('cue', outCue)) outrangutanSendToast('GO');
}

function fireOutrangutanSfxFromModal() {
  const outPad = document.getElementById('cc-out-pad')?.value || '';
  if (!outPad) { toast('Link an SFX pad first.'); return; }
  if (fireOutrangutanCommand('pad', outPad)) outrangutanSendToast('SFX');
}

// P5: playout transport from the live-screen keymap — same-tab fast path first,
// session-doc command otherwise. Actions: go / pause / stop / fadeStop / panic.
function fireOutrangutanTransport(action) {
  if (!liveCommandDispatchAllowed({ notify:true })) return false;
  const local = window.Outrangutan && window.Outrangutan._local;
  if (local && local.transport && session.code && local.session() === session.code && local.transport(action)) {
    toast(`Playout: ${action === 'fadeStop' ? 'fade-stop' : action === 'panic' ? 'PANIC' : action.toUpperCase()}.`);
    return true;
  }
  return fireOutrangutanCommand(action, '');
}

// Manual SFX trigger on a live row (P4, Decisions #6: manual + optional auto).
function fireOutrangutanSfxCell(beatId, type) {
  if (!liveCommandDispatchAllowed({ notify:true })) return false;
  const b = beats.find(x => x.id === beatId);
  const d = b?.cues?.[type];
  if (!d || !d.outPadId) { toast('No SFX pad linked.'); return; }
  if (fireOutrangutanCommand('pad', d.outPadId)) outrangutanSendToast('SFX');
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
  return `<button type="button" class="lf-trigger-go lf-out-go lf-sfx-go" title="Fire the linked SFX pad" onclick="event.stopPropagation();fireOutrangutanSfxCell('${beatId}','${type}')"><span class="cc-out-glyph"><svg class="brand-ico"><use href="#ic-outrangutan"/></svg></span> SFX</button>`;
}

// Manual GO from a live cue card.
function fireOutrangutanCueCell(beatId) {
  if (!liveCommandDispatchAllowed({ notify:true })) return false;
  const d = beats.find(x => x.id === beatId)?.cues?.playback;
  if (!outrangutanCellLinked(d)) { toast('No Outrangutan cue linked.'); return; }
  if (fireOutrangutanCommand('cue', d.outCueId)) toast('Outrangutan: GO sent.');
}

// GO button for a live cue card (playback cells linked to an Outrangutan cue).
function outrangutanGoBtnHTML(beatId, d) {
  if (!outrangutanCellLinked(d)) return '';
  return `<button type="button" class="lf-trigger-go lf-out-go" title="Fire the linked Outrangutan cue" onclick="event.stopPropagation();fireOutrangutanCueCell('${beatId}')"><span class="cc-out-glyph"><svg class="brand-ico"><use href="#ic-outrangutan"/></svg></span> GO</button>`;
}

// Auto-fire linked Outrangutan cues/SFX when a row advances live (lsNext only).
function fireOutrangutanAutoForBeat(beat) {
  if (!liveCommandDispatchAllowed({ notify:true })) return false;
  const d = beat?.cues?.playback;
  if (d && d.outAuto && d.outCueId) fireOutrangutanCommand('cue', d.outCueId);
  // P4: SFX auto-fire (playback + audio cells; Decisions #6)
  ['playback', 'audio'].forEach(t => {
    const c = beat?.cues?.[t];
    if (c && c.outPadAuto && c.outPadId) fireOutrangutanCommand('pad', c.outPadId);
  });
  return true;
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
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'assets/vendor/pdf.worker.min.js';
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
  const cuesWithScript = beats.filter(b => scriptCueText(b?.cues?.script)).length;
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
  if (window.Outrangutan?.outputHealth) addPreflightRow({ key: 'Playout outputs', state: 'pend', detail: 'Checking output windows…' });
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

  // Playout outputs — the watchdog's live view of every output window.
  if (window.Outrangutan?.outputHealth) {
    let oh = null;
    try { oh = window.Outrangutan.outputHealth(); } catch (e) { oh = null; }
    if (!oh) {
      setPreflightRow('Playout outputs', { state: 'warn', detail: 'Could not read output status' });
    } else if (oh.dead.length) {
      setPreflightRow('Playout outputs', { state: 'fail', detail: oh.dead.join(', ') + ' not responding — the window may be frozen. Close and reopen it.' });
    } else if (oh.open === 0) {
      const showHasVideo = links.cues.length > 0 || hasLocal && deep.cues.length > 0;
      setPreflightRow('Playout outputs', { state: showHasVideo ? 'warn' : 'ok', detail: showHasVideo ? 'No output window open — open one before doors if this show plays video' : 'No output windows open' });
    } else {
      setPreflightRow('Playout outputs', { state: 'ok', detail: oh.healthy + ' of ' + oh.open + ' output window' + (oh.open === 1 ? '' : 's') + ' responding to the heartbeat' });
    }
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
  if (document.getElementById('liveshow')?.classList.contains('on')) {
    requestExitLive();
    toast('Return to the rundown before jumping to a preflight row.');
    return;
  }
  if (!document.getElementById('rundown')?.classList.contains('on')) return;
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
  const current = liveSessionState();
  return liveSessionController.enter({
    reason:'operator-enter-live',
    cues:beats,
    selectedCueIndex:lsIdx,
    activeCueIndex:current.activeCueIndex,
  });
}

function enterLiveSessionScreen(liveState) {
  captureSessionSnapshot('live', true);
  lsIdx = liveState.selectedCueIndex;
  try {
    const playbackAttach = window.Outrangutan?.reattachLiveControl?.();
    if (playbackAttach && !playbackAttach.ok) {
      setLiveSubsystemStatus('playback', 'recovering', playbackAttach.error || 'Reattaching playback control');
    }
  } catch (error) {
    containError('Playback Live reattach', error);
    setLiveSubsystemStatus('playback', 'error', String(error?.message || error));
  }
  liveSessionController.registerCleanup('live-clock', () => stopTimer(false));
  liveSessionController.registerCleanup('prompter-operator', stopPrompterOperatorRuntime);
  liveSessionController.registerCleanup('live-transients', clearLiveTransientRuntime);
  document.getElementById('rundown').classList.remove('on');
  document.getElementById('liveshow').classList.add('on');
  document.getElementById('liveshow').classList.toggle('prompt-op-active', promptOpMode);
  _lastLiveScrollIdx = null;
  sessionStorage.setItem('cueola_screen','live');
  pushSessionHistoryState('live');
  logShow('session', 'Went live · row ' + (lsIdx + 1) + rowLogLabel(beats[lsIdx]));
  markResumeState();
  buildPromptFromRundown();
  initPrompter();
  syncOutrangutanControllerStatus();
  syncScriptOperatorSubsystemStatus();
  sendToPrompter(true);
  renderLive();
  syncLiveIdx();
  resumeRemoteClockIfRunning();  // late joiner picks up a clock already running
  updateLiveClockButton();
  const timerEl = document.getElementById('ls-timer');
  if (timerEl) timerEl.textContent = fmtProductionClock(elapsedSecs * 1000);
  startWallClock();
}

function showRundown() {
  if (liveSessionState().lifecycle === 'live') return requestExitLive();
  return liveSessionState();
}

function leaveLiveSessionScreen(liveState, context={}) {
  if (context.failure) throw context.failure;
  stopWallClock();
  document.getElementById('liveshow').classList.remove('on');
  document.getElementById('liveshow').classList.remove('prompt-op-active');
  document.getElementById('rundown').classList.add('on');
  sessionStorage.setItem('cueola_screen','build');
  pushSessionHistoryState('build');
  logShow('session', 'Left live → build screen');
  markResumeState();
}

function isFollowingSelf() {
  if (browsingSelf) return true;        // explicitly browsing on my own
  if (followTarget) return false;       // mirroring someone else
  // Solo surfaces — the demo, expert mode, an unsynced local workspace — have
  // no show caller to follow: the operator IS the show. Without this, the
  // demo's student role defaulted to "following" a caller that doesn't exist,
  // which kept GO disabled and made the demo rundown unrunnable.
  if (session.isDemo || session.isExpert || !session.code) return true;
  // An admin unlock drives its own position by default, same as an instructor:
  // a device that rejoined by code (role 'student') but holds the admin session
  // must land with GO live, not parked behind a follow default (TH2607).
  return session.role !== 'student' || adminSession != null;
}

// Admin Show Caller = following self AND has any admin session
function isAdminShowCaller() {
  return isFollowingSelf() && adminSession != null;
}

// Standard Show Caller = following self, instructor, NO admin session
function isStandardShowCaller() {
  return isFollowingSelf() && session.role === 'instructor' && !adminSession;
}

let liveExitTransaction = null;

function classifyFlowmingoLiveExit() {
  const state = prompterSessionController.getState();
  const windowOpen = Boolean(_prompterTalentWin && !_prompterTalentWin.closed);
  const connected = _prompterHasRecentTalent() || ['connected','ready','running','paused','recovering'].includes(state.status);
  const active = Boolean(state.running || ptPlaying);
  return {
    active,
    open:windowOpen || connected,
    needsDisposition:active,
    status:state.status || (active ? 'running' : windowOpen ? 'open' : 'closed'),
    detail:active ? 'Talent script is scrolling' : connected ? 'Talent output is connected and paused' : windowOpen ? 'Talent window is open' : 'No talent output connected',
    outputInstanceId:_activePrompterOutputInstanceId || '',
    windowOpen,
  };
}

function classifyOutrangutanLiveExit() {
  if (typeof window.Outrangutan?.classifyLiveExit === 'function') {
    return window.Outrangutan.classifyLiveExit();
  }
  const output = window.Outrangutan?.outputStatus?.() || null;
  const transport = outrangutanState?.live || null;
  const active = Boolean(transport && ['play','pause','pre'].includes(transport.status));
  return {
    active,
    open:Boolean(output?.open),
    hasActiveOutputs:active,
    hasOpenOutputs:Boolean(output?.open),
    needsDisposition:active,
    transport:{ active, state:transport?.status || 'idle', cueName:transport?.name || '' },
    outputs:output || { open:0, items:[] },
  };
}

function classifyLiveExitOutputs() {
  const prompter = classifyFlowmingoLiveExit();
  const playback = classifyOutrangutanLiveExit();
  const scriptOperator = {
    open:Boolean(_scriptOpWin && !_scriptOpWin.closed),
    status:liveSessionState().subsystems.scriptOperator?.status || 'closed',
  };
  return {
    capturedAt:Date.now(),
    prompter,
    playback,
    scriptOperator,
    needsDisposition:Boolean(prompter.needsDisposition || playback.needsDisposition || playback.hasActiveOutputs),
  };
}

function liveExitOutputLines(outputs) {
  const prompter = outputs.prompter;
  const playback = outputs.playback;
  const playbackState = playback.transport?.state || playback.transport?.status || (playback.active ? 'active' : 'idle');
  const playbackOpen = Number(playback.outputs?.open ?? playback.open ?? 0);
  const scriptOp = outputs.scriptOperator?.open ? 'Script Operator open (closes when Live ends)' : 'Script Operator closed';
  return [
    `Flowmingo: ${prompter.active ? 'scrolling' : prompter.open ? 'open and paused' : 'closed'}`,
    `Outrangutan: ${playbackState}${playbackOpen ? ` · ${playbackOpen} output window${playbackOpen === 1 ? '' : 's'} open` : ''}`,
    scriptOp,
  ];
}

function renderLiveExitDecision(outputs) {
  const activeNames = [];
  if (outputs.prompter.active) activeNames.push('Flowmingo');
  if (outputs.playback.needsDisposition || outputs.playback.hasActiveOutputs) activeNames.push('Outrangutan');
  const summary = document.getElementById('exitLiveOutputSummary');
  const details = document.getElementById('exitLiveOutputDetails');
  const status = document.getElementById('exitLiveStatus');
  const recovery = document.getElementById('exitLiveRecovery');
  if (summary) summary.textContent = activeNames.length
    ? `${activeNames.join(' and ')} ${activeNames.length === 1 ? 'has an active output' : 'have active outputs'}.`
    : 'No active output needs a decision.';
  if (details) details.textContent = liveExitOutputLines(outputs).join('\n');
  if (status) status.textContent = 'Live GO and transport commands are paused until you choose.';
  if (recovery) recovery.hidden = true;
  liveExitDialogSetBusy(false);
}

function liveExitDialogSetBusy(busy) {
  ['exitLiveStopBtn','exitLiveDetachBtn','exitLiveCancelBtn'].forEach(id => {
    const button = document.getElementById(id);
    if (button) button.disabled = Boolean(busy);
  });
  const dialog = document.getElementById('exitLiveDialog');
  if (dialog) dialog.setAttribute('aria-busy', busy ? 'true' : 'false');
}

function presentLiveExitRecovery(message) {
  if (!document.getElementById('exitLiveOv')?.classList.contains('on')) showOverlay('exitLiveOv');
  const status = document.getElementById('exitLiveStatus');
  if (status) status.textContent = `Could not confirm a safe return: ${message}`;
  const recovery = document.getElementById('exitLiveRecovery');
  if (recovery) recovery.hidden = false;
  liveExitDialogSetBusy(false);
  ['exitLiveStopBtn','exitLiveDetachBtn','exitLiveCancelBtn'].forEach(id => {
    const button = document.getElementById(id);
    if (button) button.disabled = true;
  });
}

function requestExitLive() {
  if (liveSessionState().lifecycle !== 'live') return liveSessionState();
  releaseLiveCommandHolds();
  const outputs = classifyLiveExitOutputs();
  liveExitTransaction = { outputs, requestedAt:Date.now(), disposition:'' };
  const state = liveSessionController.prepareLeave({
    reason:'operator-return-to-rundown',
    outputSnapshot:outputs,
  });
  scriptOperatorPublishState(true);
  if (!outputs.needsDisposition) {
    return commitExitLive('detach', { automatic:true });
  }
  renderLiveExitDecision(outputs);
  showOverlay('exitLiveOv');
  return state;
}

function waitForPrompterControlAck(controlId) {
  const pending = _pendingPrompterControls[controlId];
  if (!pending) return Promise.resolve({ ok:false, acknowledged:false, error:'Flowmingo command was not tracked' });
  return new Promise(resolve => { pending.settle = resolve; });
}

async function applyFlowmingoLiveExit(disposition, before) {
  if (disposition === 'detach' || !before.active) {
    return { ok:true, acknowledged:true, disposition, before, detached:true, paused:false };
  }
  const control = buildPrompterControl('pause', 'live-exit');
  const sent = dispatchPrompterCommand(control, 'live-exit', false);
  if (!sent) return { ok:false, acknowledged:false, disposition, before, error:'Flowmingo pause could not be sent' };
  const ack = await waitForPrompterControlAck(control.controlId);
  return {
    ok:Boolean(ack.ok),
    acknowledged:Boolean(ack.acknowledged),
    disposition,
    before,
    paused:Boolean(ack.ok),
    error:ack.error || '',
  };
}

async function applyLiveExitOutputs(disposition, outputs) {
  const operations = [applyFlowmingoLiveExit(disposition, outputs.prompter)];
  if (typeof window.Outrangutan?.applyLiveExit === 'function') {
    operations.push(window.Outrangutan.applyLiveExit(disposition));
  }
  const settled = await Promise.allSettled(operations);
  const values = settled.map(result => result.status === 'fulfilled' ? result.value : ({ ok:false, error:String(result.reason?.message || result.reason) }));
  const failures = values.filter(result => result && result.ok === false);
  return { ok:!failures.length, disposition, values, failures };
}

function liveExitSavedStateLabel() {
  if (session.isDemo || session.isExpert || !window._firebaseReady) return 'Saved locally';
  const dot = document.getElementById('syncDot');
  if (rundownPendingBatches.length || _syncReconnState || dot?.classList.contains('saving')) return 'Saved locally · cloud sync pending';
  if (dot?.classList.contains('error') || dot?.classList.contains('off') || dot?.classList.contains('local')) return 'Saved locally · cloud sync unavailable';
  return 'Cloud saved';
}

async function commitExitLive(disposition='stop', options={}) {
  if (!['stop','detach'].includes(disposition)) throw new Error('Unknown Live output disposition: ' + disposition);
  if (liveSessionState().lifecycle !== 'leaving-live') return liveSessionState();
  const transaction = liveExitTransaction || { outputs:classifyLiveExitOutputs(), requestedAt:Date.now(), disposition:'' };
  transaction.disposition = disposition;
  liveExitDialogSetBusy(true);
  const status = document.getElementById('exitLiveStatus');
  if (status) status.textContent = disposition === 'stop' ? 'Stopping active outputs…' : 'Detaching this operator…';
  await captureSessionSnapshot('live-exit', true);
  const outputResult = await applyLiveExitOutputs(disposition, transaction.outputs);
  if (!outputResult.ok) {
    const detail = outputResult.failures.map(result => result.error || 'An output did not confirm').join(' · ');
    const failure = new Error(detail || 'An active output did not confirm the requested exit behavior.');
    try {
      liveSessionController.commitLeave({ reason:'operator-return-to-rundown-failed', disposition, outputResult, failure });
    } catch (error) {
      containError('Return to Rundown', error);
    }
    presentLiveExitRecovery(failure.message);
    return liveSessionState();
  }
  let state;
  try {
    state = liveSessionController.commitLeave({
      reason:'operator-return-to-rundown',
      disposition,
      outputResult,
    });
  } catch (error) {
    containError('Return to Rundown', error);
    presentLiveExitRecovery(String(error?.message || error));
    return liveSessionState();
  }
  followSelf();
  hideOverlay('exitLiveOv');
  const saveLabel = liveExitSavedStateLabel();
  logShow('session', `Returned to rundown · outputs ${disposition} · ${saveLabel.toLowerCase()}`);
  toast(`Returned to rundown · ${saveLabel}`, 4200);
  liveExitTransaction = null;
  return state;
}

function cancelExitLive() {
  if (liveSessionState().lifecycle !== 'leaving-live') return liveSessionState();
  const state = liveSessionController.cancelLeave({ reason:'operator-cancel-return' });
  liveExitTransaction = null;
  hideOverlay('exitLiveOv');
  scriptOperatorPublishState(true);
  toast('Staying in Live mode.');
  return state;
}

async function recoverLiveToBuilder() {
  const status = document.getElementById('exitLiveStatus');
  if (status) status.textContent = 'Preserving the production and cleaning up Live controls…';
  liveExitDialogSetBusy(true);
  await captureSessionSnapshot('live-recovery', true);
  if (typeof window.Outrangutan?.applyLiveExit === 'function') {
    try { await window.Outrangutan.applyLiveExit('detach'); }
    catch (error) { containError('Playback recovery detach', error); }
  }
  const state = liveSessionController.recoverToBuilder({
    reason:'operator-emergency-live-recovery',
    outputSnapshot:liveExitTransaction?.outputs || classifyLiveExitOutputs(),
  });
  followSelf();
  hideOverlay('exitLiveOv');
  const saveLabel = liveExitSavedStateLabel();
  logShow('recovery', `Emergency Live recovery → rundown · ${saveLabel.toLowerCase()}`);
  toast(`Recovered to rundown · ${saveLabel}`, 4800);
  liveExitTransaction = null;
  return state;
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
  if (!liveCommandDispatchAllowed({ notify:true })) return false;
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

// "Start Show" pressed before the clock has ever run: if the session is parked
// mid-rundown (a restored snapshot or a previous rehearsal left the shared cue
// on row N), the caller chooses between taking it from the top and starting
// where the session is parked. Before this, the only way back to row 1 was
// Admin → Restart Show Clock with a typed RESTART confirm.
function liveStartShowPressed() {
  if (!liveCommandDispatchAllowed({ notify:true })) return false;
  if (!canDriveShowClock()) {
    toast('The show caller controls the clock for everyone.');
    return false;
  }
  const activeIdx = liveActiveCueIndex();
  const firstIdx = liveNextPlayableCueIndex(-1);
  if (!liveClockRunning && (!elapsedSecs || !_clockRanThisLoad) && firstIdx >= 0 && activeIdx > firstIdx && canOwnLiveActiveCue()) {
    const hereEl = document.getElementById('lsStartChoiceRow');
    if (hereEl) hereEl.textContent = `Row ${activeIdx + 1} — ${beats[activeIdx]?.info || 'Untitled'}`;
    const topEl = document.getElementById('lsStartChoiceTopLbl');
    if (topEl) topEl.textContent = `Row ${firstIdx + 1}`;
    const hereLbl = document.getElementById('lsStartChoiceHereLbl');
    if (hereLbl) hereLbl.textContent = `Row ${activeIdx + 1}`;
    showOverlay('lsStartChoiceOv');
    return true;
  }
  return toggleShowClock();
}

function lsStartFromTop() {
  hideOverlay('lsStartChoiceOv');
  const firstIdx = liveNextPlayableCueIndex(-1);
  if (firstIdx < 0) return false;
  stopTimer(false);
  elapsedSecs = 0;
  liveTimerStartMs = null;
  setOperatorLiveCue(firstIdx, 'start-from-top');
  logShow('cue', 'Show start → from the top · row ' + (firstIdx + 1) + rowLogLabel(beats[firstIdx]));
  renderLive();
  sendToPrompter(false);
  syncLiveIdx();
  startTimer();
  updateLiveClockButton();
  updateLiveOverview();
  updateLiveRemain();
  broadcastShowClock();
  toast(`Show started from the top — Row ${firstIdx + 1}.`);
  return true;
}

function lsStartFromHere() {
  hideOverlay('lsStartChoiceOv');
  return toggleShowClock();
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
  let restartIdx = beats.length ? 0 : -1;
  // Same as goLive: never park the live position on a leading segment marker
  while (restartIdx >= 0 && restartIdx < beats.length && beats[restartIdx]?.style === 'segment') restartIdx++;
  if (restartIdx >= beats.length) restartIdx = beats.length ? beats.length - 1 : -1;
  setOperatorLiveCue(restartIdx, 'restart-show');
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
  const activeIdx = liveActiveCueIndex();
  const cur = beats[activeIdx] || null;
  const next = beats[activeIdx+1] || null;
  return {
    type: isInit ? 'script_init' : 'script_update',
    text: prompterText,
    version: prompterVersion,
    source: prompterSource,
    sessionCode: session.code,
    showName: show.name || 'Untitled Show',
    activeIdx,
    currentRow: cur ? { index:activeIdx, name:cur.info||'', notes:cur.notes||'', duration:fmtDur(cur) } : null,
    nextRow: next ? { index:activeIdx+1, name:next.info||'', duration:fmtDur(next) } : null,
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
    .filter(({ b }) => scriptCueText(b?.cues?.script));
  return cleanPrompterText(scripts.map(({ b, rowIdx }) => {
    const d = b.cues.script;
    const copy = scriptCueText(d);
    const rowNum = rowIdx + 1;
    const header = b.info ? `\n[${rowNum}] ${b.info}\n` : `\n[${rowNum}]\n`;
    const speaker = scriptSpeakerLabel(d);
    const dialogue = d.scriptType === 'Dialogue' ? '[DIALOGUE]\n' : '';
    return header + (speaker ? `${speaker.toUpperCase()}:\n` : '') + dialogue + copy;
  }).join('\n\n'));
}

function markLivePrompterStatus(text, tone='ok') {
  const el = document.getElementById('lsPrompterUpdateStatus');
  if (!el) return;
  el.textContent = text;
  el.className = `ls-prompter-update ${tone}`;
  clearTimeout(livePrompterStatusTimer);
  // Failures are production state, not transient feedback. They remain beside
  // Flowmingo until a later successful controller projection replaces them.
  if (tone === 'error') {
    livePrompterStatusTimer = null;
    return;
  }
  livePrompterStatusTimer = setTimeout(() => {
    const status = prompterSessionController.getState().status;
    if (el.textContent === text) el.textContent = prompterStatusLabel(status);
    el.className = `ls-prompter-update ${status === 'error' || status === 'recovering' ? 'error' : 'ok'}`;
  }, 2200);
}

const PROMPTER_STATUS_LABELS = Object.freeze({
  closed:'Closed', opening:'Opening', connected:'Connected', ready:'Ready',
  running:'Running', paused:'Paused', recovering:'Recovering', error:'Error'
});

function prompterStatusLabel(status) {
  return PROMPTER_STATUS_LABELS[status] || 'Closed';
}

function projectPrompterSessionStatus(status, detail='') {
  if (!PROMPTER_STATUS_LABELS[status]) status = 'error';
  const state = prompterSessionController.setStatus(status, status === 'error' ? (detail || 'Prompter error') : '');
  const normalized = {
    closed:'closed', opening:'opening', connected:'connecting', ready:'ready',
    running:'active', paused:'paused', recovering:'recovering', error:'error'
  }[status];
  setLiveSubsystemStatus('prompter', normalized, detail || prompterStatusLabel(status));
  const dot = document.getElementById('prompterDot');
  const txt = document.getElementById('prompterStatusTxt');
  const stat = document.getElementById('ls-stat-prompter');
  const update = document.getElementById('lsPrompterUpdateStatus');
  const healthy = ['ready','running','paused'].includes(status);
  if (dot) dot.className = `ls-prompter-dot${healthy ? '' : ' off'}`;
  if (txt) txt.textContent = detail || prompterStatusLabel(status);
  if (stat) {
    stat.textContent = `FLOWMINGO ${status === 'recovering' ? 'RECOVERING' : prompterStatusLabel(status).toUpperCase()}`;
    stat.title = detail || `Flowmingo ${prompterStatusLabel(status).toLowerCase()}`;
    stat.classList.toggle('connected', healthy);
    stat.dataset.prompterStatus = status;
  }
  if (update && status === 'error') {
    clearTimeout(livePrompterStatusTimer);
    livePrompterStatusTimer = null;
    update.textContent = detail || 'Flowmingo error';
    update.className = 'ls-prompter-update error';
  } else if (update && healthy && update.classList.contains('error')) {
    update.textContent = prompterStatusLabel(status);
    update.className = 'ls-prompter-update ok';
  }
  return state;
}

function updateLiveOverview() {
  const activeIdx = liveActiveCueIndex();
  const cur = beats[activeIdx] || null;
  const nextIdx = liveNextPlayableCueIndex(activeIdx);
  const next = nextIdx >= 0 ? beats[nextIdx] : null;
  const total = totalSecs();
  const remain = liveRemainingSecs();
  const progress = total ? Math.min(100, Math.max(0, elapsedSecs / total * 100)) : (beats.length ? (activeIdx+1)/beats.length*100 : 0);
  const setText = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  setText('ls-show-title', show.name || 'Untitled Show');
  setText('ls-show-sub', `${beats.length ? `Row ${Math.min(activeIdx+1, beats.length)} of ${beats.length}` : 'No rows'}${session.code&&!session.isExpert ? ` · ${session.code}` : ''}`);
  setText('ls-stat-now', cur ? cur.info || `Row ${activeIdx+1}` : '—');
  setText('ls-stat-next', next ? next.info || `Row ${nextIdx+1}` : 'End');
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
  const scriptResizer = document.getElementById('lsScriptResizer');
  const scrim = document.getElementById('lsSidebarScrim');
  const btn = document.getElementById('prompterPanelBtn');
  const drawerMode = window.matchMedia?.('(max-width: 900px)')?.matches === true;
  const drawerOpen = Boolean(livePrompterOpen && drawerMode);
  if (sidebar) {
    sidebar.classList.toggle('open', livePrompterOpen);
    sidebar.style.width = `${liveSidebarWidth}px`;
    if (livePrompterOpen) { try { const h = parseFloat(localStorage.getItem('cueola_scriptOpHeight')); if (h) applyScriptOpHeight(h); } catch (e) {} }
  }
  if (resizer) {
    resizer.classList.toggle('on', livePrompterOpen && !drawerMode);
    resizer.setAttribute('aria-valuenow', String(Math.round(liveSidebarWidth)));
    resizer.tabIndex = livePrompterOpen && !drawerMode ? 0 : -1;
  }
  if (scriptResizer) {
    const editorHeight = Math.round(document.getElementById('lsPrompterText')?.getBoundingClientRect?.().height || 120);
    scriptResizer.setAttribute('aria-valuenow', String(editorHeight));
  }
  if (scrim) scrim.tabIndex = drawerOpen ? 0 : -1;
  document.querySelectorAll('#liveshow > .ls-bar, #liveshow > .follow-bar, #liveshow > .ls-overview, #liveshow > .ls-status-rail, #liveshow .ls-main, #liveshow > .ls-bot')
    .forEach(element => { element.inert = drawerOpen; });
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
  const drawerMode = window.matchMedia?.('(max-width: 900px)')?.matches === true;
  if (drawerMode) {
    const focusTarget = livePrompterOpen
      ? document.querySelector('#lsSidebar .ls-sidebar-close')
      : document.getElementById('prompterPanelBtn');
    setTimeout(() => focusTarget?.focus(), 0);
  }
  markResumeState();   // P7: Script Op open/closed is part of the resume snapshot
}

let _livePanelResizeCleanup = null;

function stopLivePanelResize() {
  if (_livePanelResizeCleanup) _livePanelResizeCleanup();
  _livePanelResizeCleanup = null;
}

function startLivePanelResize(e) {
  e.preventDefault();
  stopLivePanelResize();
  const startX = e.clientX;
  const startW = liveSidebarWidth;
  const move = ev => {
    liveSidebarWidth = Math.min(620, Math.max(340, startW + (startX - ev.clientX)));
    applyLivePrompterPanelState();
  };
  const up = () => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    if (_livePanelResizeCleanup === up) _livePanelResizeCleanup = null;
  };
  _livePanelResizeCleanup = up;
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up, {once:true});
}

function resizeLivePanelByKey(event) {
  if (!['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) return;
  event.preventDefault();
  if (event.key === 'Home') liveSidebarWidth = 340;
  else if (event.key === 'End') liveSidebarWidth = 620;
  else liveSidebarWidth = Math.min(620, Math.max(340, liveSidebarWidth + (event.key === 'ArrowLeft' ? 20 : -20)));
  applyLivePrompterPanelState();
}

function resizeLiveScriptByKey(event) {
  if (!['ArrowUp','ArrowDown','Home','End'].includes(event.key)) return;
  const editor = document.getElementById('lsPrompterText');
  if (!editor) return;
  event.preventDefault();
  const sidebar = editor.closest('.ls-sidebar');
  const maxHeight = sidebar ? Math.max(180, sidebar.getBoundingClientRect().height - 200) : 1400;
  const current = editor.getBoundingClientRect().height;
  const height = event.key === 'Home' ? 120
    : event.key === 'End' ? maxHeight
    : Math.min(maxHeight, Math.max(120, current + (event.key === 'ArrowDown' ? 20 : -20)));
  applyScriptOpHeight(height);
  event.currentTarget?.setAttribute('aria-valuenow', String(Math.round(height)));
}

const liveDrawerMediaQuery = window.matchMedia?.('(max-width: 900px)');
if (liveDrawerMediaQuery?.addEventListener) liveDrawerMediaQuery.addEventListener('change', applyLivePrompterPanelState);
else liveDrawerMediaQuery?.addListener?.(applyLivePrompterPanelState);

function clearLiveTransientRuntime() {
  releaseLiveCommandHolds();
  stopLivePanelResize();
  _scriptHeightEnd();
  closeJogScrub();
  const keymap = document.getElementById('keymapRefOv');
  if (keymap) keymap.hidden = true;
  ['lsRowPreviewOv','lsScriptEditOv'].forEach(id => {
    if (document.getElementById(id)?.classList.contains('on')) hideOverlay(id);
  });
  clearTimeout(livePrompterDraftTimer);
  livePrompterDraftTimer = null;
  clearTimeout(livePrompterStatusTimer);
  livePrompterStatusTimer = null;
  clearTimeout(_sfxChipTimer);
  _sfxChipTimer = null;
  const sfx = document.getElementById('ls-stat-sfx');
  if (sfx) sfx.hidden = true;
  document.body.style.userSelect = '';
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
      ${liveCueOperationLine('ready', on, 'lv-cue-ready')}
      ${liveCueOperationLine('take', off, 'lv-cue-take')}
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
    ${scriptCueText(sd)?`<div class="lv-cur-script">${esc(scriptCueText(sd))}</div>`:''}
    ${sd&&adminCaller?`<button class="ltr-edit-btn" style="margin-top:8px" onclick="openLiveScript(${i})">${sfIcon('action.edit')} Edit &amp; Push</button>`:''}
  </div>`;
}

function renderLiveNext(b, i, isRunner) {
  const types = Object.keys(b.cues||{}).filter(t=>CT[t]&&t!=='script');
  const cueSmall = types.map(t => {
    const d = b.cues[t], tc = CT[t];
    const on  = getCueOn(d);
    const off = getCueOff(d);
    return `<div class="lv-next-cue" style="border-left-color:${tc.color}">
      <span style="color:${tc.color}">${sfIcon(tc.symbol)}</span>
      ${liveCueOperationLine('ready', on, 'lv-next-cue-line')}
      ${liveCueOperationLine('take', off, 'lv-next-cue-line muted')}
    </div>`;
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
      ${liveCueOperationLine('ready', on, 'live-preview-cue-line')}
      ${liveCueOperationLine('take', off, 'live-preview-cue-line emphasized')}
      ${t==='script'&&scriptCueText(d)?`<div style="font-size:13px;line-height:1.7;color:var(--text);margin-top:8px;white-space:pre-wrap;border-top:1px solid var(--border);padding-top:8px">${esc(scriptCueText(d))}</div>`:''}
    </div>`;
  });
  if (!types.length) html = '<div class="empty-rundown"><div class="empty-rundown-sub">No cues configured for this row.</div></div>';
  bodyEl.innerHTML = html;
  const prevBtn = document.getElementById('lrpPrevBtn');
  const nextBtn = document.getElementById('lrpNextBtn');
  if (prevBtn) prevBtn.disabled = idx <= 0;
  if (nextBtn) nextBtn.disabled = idx >= beats.length - 1;
  // "Cue here": offered to any driving operator (same gate as GO), hidden on
  // the current row, segments, disabled and failed rows.
  const cueBtn = document.getElementById('lrpCueBtn');
  const cueHint = document.getElementById('lrpCueHint');
  if (cueBtn) {
    const canCue = canOwnLiveActiveCue()
      && b.style !== 'segment'
      && !liveCueIsDisabled(idx)
      && liveCueExecutionStatus(idx) !== 'failed'
      && liveActiveCueIndex() !== idx;
    cueBtn.hidden = !canCue;
    if (cueHint) cueHint.hidden = !canCue;
    const lbl = document.getElementById('lrpCueBtnLabel');
    if (lbl) lbl.textContent = `Cue to Row ${idx + 1}`;
  }
  showOverlay('lsRowPreviewOv');
}

function lrpCueHere() {
  const idx = previewRowIdx;
  hideOverlay('lsRowPreviewOv');
  if (jumpToLsCue(idx, { confirmed:true })) {
    toast(`Cued to Row ${idx + 1} — ${beats[idx]?.info || ''}`.trim());
  }
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
  const scriptText = isScript ? scriptCueText(d) : '';
  const scriptMeta = scriptText ? `<div class="live-script-action">${scriptLineLabel(scriptText)} · tap to open</div>` : '';
  if (!on && !off && !scriptMeta) return `<div class="live-cue-empty">·</div>`;
  // Ready (the "on"/standby cue) sits calm on top; Take (the "off"/go cue) is the
  // bold, department-coloured action line. "Ready one… take one."
  return `<div class="live-cue-cell${isScript?' live-script-cell':''}" style="--cue-clr:${tc.color}" ${isScript?`onclick="event.stopPropagation();openLiveScript(${beatIdx})" title="Open full script"`:''}>
    ${liveCueOperationLine('ready', on, 'live-cue-rdy')}
    ${liveCueOperationLine('take', off, 'live-cue-go', `color:${tc.color}`)}
    ${isScript ? (scriptMeta || '<div class="live-script-action">Tap to open script</div>') : ''}
  </div>`;
}

const LIVE_CUE_OPERATION = Object.freeze({
  ready:{ label:'READY', title:'Stand by this cue before taking it' },
  take:{ label:'TAKE', title:'Execute this programmed cue' },
});

function liveCueOperationLine(operation, text, className='', style='') {
  if (!text) return '';
  const meta = LIVE_CUE_OPERATION[operation] || LIVE_CUE_OPERATION.ready;
  // Quiet marker icons (the original cue-line look) carry the READY/TAKE
  // vocabulary in the title/aria label instead of a boxed verb chip.
  return `<div class="${className}"${style ? ` style="${style}"` : ''} title="${meta.title}" aria-label="${meta.label}: ${esc(text)}">${sfIcon(operation === 'take' ? 'marker.go' : 'marker.ready')} <span>${esc(text)}</span></div>`;
}

// Clean cue chips for the Focus view — only the row's programmed departments.
function focusCuesForBeat(b) {
  const filled = colOrder.filter(type => {
    const d = b.cues?.[type];
    return d && (getCueOn(d) || getCueOff(d) || (type === 'script' && scriptCueText(d)));
  });
  if (!filled.length) return '<div class="lf-nocue">No cues on this row</div>';
  return `<div class="lf-cues">` + filled.map(type => {
    const d = b.cues[type], tc = CT[type];
    const on = getCueOn(d), off = getCueOff(d);
    let lines = '';
    if (type === 'script') {
      const text = scriptCueText(d);
      lines = `<div class="lf-cue-take">${sfIcon('content.script')} ${d.scriptType === 'Dialogue' ? 'Dialogue' : 'Script'} ready · ${scriptLineLabel(text)}</div>`;
    } else {
      // All Live representations use the same operation vocabulary: the `on`
      // field is READY/standby and the `off` field is TAKE/execute.
      if (on)  lines += liveCueOperationLine('ready', on, 'lf-cue-ready');
      if (off) lines += liveCueOperationLine('take', off, 'lf-cue-take');
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

const LIVE_ROW_STATE_LABEL = Object.freeze({
  completed:'Done', skipped:'Skipped', failed:'Failed', disabled:'Disabled',
});

// One quiet pill per row, in the original show vocabulary: the active row is
// On Air, the next playable row is Next, everything else Later — with the run
// ledger's terminal states (Done / Skipped / Failed / Disabled) kept intact.
// Selection stays a row-level highlight (aria-selected + .live-row-selected),
// not a second chip.
function liveRowStateChips(index, options={}) {
  const state = liveSessionState();
  const execution = liveCueExecution(index);
  const chips = [];
  const isActive = index === state.activeCueIndex;
  const failureTitle = execution.failure ? ` title="${esc(execution.failure)}"` : '';
  if (isActive) {
    chips.push('<span class="live-status now">On Air</span>');
  } else if (LIVE_ROW_STATE_LABEL[execution.status]) {
    const cls = execution.status === 'completed' ? 'done' : execution.status;
    chips.push(`<span class="live-status ${cls}"${failureTitle}>${LIVE_ROW_STATE_LABEL[execution.status]}</span>`);
  } else if (index === liveNextPlayableCueIndex(state.activeCueIndex)) {
    chips.push('<span class="live-status next">Next</span>');
  } else {
    chips.push('<span class="live-status later">Later</span>');
  }
  if (execution.status === 'failed' && options.recovery !== false) {
    chips.push(`<button type="button" class="live-row-recover" onclick="recoverLiveCueFailure(event,${index})" title="Recover row ${index + 1}" aria-label="Recover failed row ${index + 1}">Recover</button>`);
  }
  return chips.join('');
}

function updateLiveGoControl(projectedState=null) {
  const button = document.getElementById('lsGoBtn');
  const label = document.getElementById('lsGoLabel');
  if (!button || !label) return;
  const state = projectedState || liveSessionState();
  const activeIndex = state.activeCueIndex >= 0 ? state.activeCueIndex : state.selectedCueIndex;
  const nextIndex = liveNextPlayableCueIndex(activeIndex);
  const failed = nextIndex >= 0 && liveCueExecutionStatus(nextIndex) === 'failed';
  const dispatchable = state.lifecycle === 'live' && nextIndex >= 0 && !failed && canOwnLiveActiveCue();
  const nextBeat = nextIndex >= 0 ? beats[nextIndex] : null;
  const text = nextBeat ? `${failed ? 'Recover ' : ''}Row ${nextIndex + 1} — ${nextBeat.info || 'Untitled cue'}` : 'End of rundown';
  label.textContent = text;
  button.disabled = !dispatchable;
  button.setAttribute('aria-disabled', dispatchable ? 'false' : 'true');
  const studentLocked = !canOwnLiveActiveCue() && session.code && !session.isDemo && !session.isExpert && session.role === 'student';
  button.title = dispatchable ? `GO to ${text}`
    : failed ? `Recover failed row ${nextIndex + 1} before GO`
    : studentLocked ? 'Joined as a student — only the show caller (instructor or admin) advances the rundown'
    : nextBeat ? 'Follow the active show caller to use GO'
    : 'No upcoming cue';
  button.setAttribute('aria-label', button.title);
}

// Focus view: one dominant NOW, a clear NEXT, and a dim coming-up list.
function renderLiveFocus() {
  const body = document.getElementById('lsBody');
  const curIdx = Math.max(0, Math.min(liveActiveCueIndex(), beats.length - 1));
  const cur = beats[curIdx];
  // find next non-segment beat
  const nextBeatIdx = liveNextPlayableCueIndex(curIdx);
  const next = nextBeatIdx >= 0 ? beats[nextBeatIdx] : null;
  const total = beats.length;
  const remainSecs = beats.slice(curIdx).reduce((a, b) => a + (b.min || 0) * 60 + (b.sec || 0), 0);
  const startStr = show.start ? clock(show.start, beats.slice(0, curIdx).reduce((a, b) => a + (b.min || 0) * 60 + (b.sec || 0), 0)) : '';
  const canJump = isFollowingSelf() && isAdminShowCaller();

  let html = `<div class="lf-wrap">
    <div class="lf-now" onclick="liveRowPreview(${curIdx})">
      <div class="lf-now-head">
        <span class="lf-now-badge"><span class="lf-dot"></span> ON AIR</span>
        <span class="lf-now-meta">Row ${curIdx + 1} of ${total} · ${fmtSecs(remainSecs)} left</span>
      </div>
      <div class="lf-now-title">
        <span class="lf-now-name">${esc(cur.info || '—')}</span>
        <span class="lf-now-dur">${fmtDur(cur)}</span>
        ${startStr ? `<span class="lf-now-clock">starts ${startStr}</span>` : ''}
      </div>
      ${cur.notes ? `<div class="lf-now-note">${esc(cur.notes)}</div>` : ''}
      <div class="lf-row-state" aria-label="Current row state">${liveRowStateChips(curIdx)}</div>
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

  const restStart = nextBeatIdx >= 0 ? nextBeatIdx + 1 : beats.length;
  const rest = beats.slice(restStart);
  if (rest.length) {
    html += `<div class="lf-up-lbl">Coming up</div><div class="lf-up">` + rest.map((b, j) => {
      const i = restStart + j;
      if (b.style === 'segment') {
        return `<div class="lf-up-seg">${esc(b.info || 'Segment')}</div>`;
      }
      const execution = liveCueExecutionStatus(i);
      return `<div class="lf-up-row live-row-${execution}${i === liveSelectedCueIndex() ? ' live-row-selected' : ''}" onclick="selectLiveRundownRow(event,${i})" onkeydown="selectLiveRundownRow(event,${i})" role="button" tabindex="0" aria-label="Select row ${i + 1}; ${execution}">
        <span class="lf-up-num">${i + 1}</span>
        <span class="lf-up-name">${esc(b.info || '—')}</span>
        <span class="lf-up-time">${fmtDur(b)}</span>
        <span class="lf-up-state">${liveRowStateChips(i)}</span>
      </div>`;
    }).join('') + `</div>`;
  }
  html += `</div>`;
  body.innerHTML = html;
  updateLiveGoControl();
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
  if (!beats.length) {
    body.innerHTML='<div class="empty-rundown"><div class="empty-rundown-title">No cues in rundown</div><div class="empty-rundown-sub">Build rows in the Rundown tab, then run the show from here.</div></div>';
    updateLiveOverview();
    updateLiveGoControl();
    applyLivePrompterPanelState();
    renderFollowChips();
    return;
  }
  ensureLiveRunLedger();

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
  const usedCols = colOrder.filter(type => beats.some(b => { const d=b.cues?.[type]; return d && (getCueOn(d)||getCueOff(d)||(type==='script'&&scriptCueText(d))); }));
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

    const activeIdx = liveActiveCueIndex();
    const selectedIdx = liveSelectedCueIndex();
    const isCur = i === activeIdx;
    const execution = liveCueExecution(i);
    const isDisabled = execution.status === 'disabled';
    const rowClass = [
      `live-row-${execution.status}`,
      isCur ? 'live-row-active live-row-current' : '',
      i === selectedIdx ? 'live-row-selected' : '',
    ].filter(Boolean).join(' ');
    const goButton = canJump && !isCur && !isDisabled && execution.status !== 'failed'
      ? `<button type="button" class="live-row-go" onclick="activateLiveRundownRow(event,${i})" title="Activate row ${i + 1}" aria-label="GO row ${i + 1}">GO</button>`
      : '';
    html += `<tr class="${rowClass}" onclick="selectLiveRundownRow(event,${i})" onkeydown="selectLiveRundownRow(event,${i})" tabindex="${isDisabled ? '-1' : '0'}" aria-selected="${i === selectedIdx ? 'true' : 'false'}" aria-disabled="${isDisabled ? 'true' : 'false'}" aria-label="Row ${i + 1}, ${esc(b.info || 'untitled')}, ${execution.status}${isCur ? ', active' : ''}${i === selectedIdx ? ', selected' : ''}">
      <td><div class="live-num">${i + 1}</div></td>
      <td><div class="live-row-states">${liveRowStateChips(i)}</div>${goButton}</td>
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
  const activeScrollIdx = liveActiveCueIndex();
  if (cur && _lastLiveScrollIdx !== activeScrollIdx) {
    _lastLiveScrollIdx = activeScrollIdx;
    cur.scrollIntoView({behavior:'auto', block:'center'});
  } else {
    body.scrollTop = prevScroll;
  }
  applyLivePrompterPanelState();
  renderFollowChips();
  updateLiveOverview();
  updateLiveGoControl();
  updateLsPrompter();
  renderLivePrompterControls();
}

function openLiveScript(beatIdx) {
  const b = beats[beatIdx]; if (!b) return;
  liveScriptEditIdx = beatIdx;
  const d = b.cues?.script||{};
  document.getElementById('lsScriptEditTitle').textContent = `Script • ${b.info||`Row ${beatIdx+1}`}`;
  document.getElementById('lsScriptEditText').value = scriptCueText(d);
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
  const edited = cleanPrompterText(document.getElementById('lsScriptEditText').value);
  if (b.cues.script.scriptType === 'Dialogue') b.cues.script.dialogueNote = edited;
  else b.cues.script.text = edited;
  adoptPrompterText(assemblePrompterScriptFromBeats(), { forceEditor:true, source:'assembled' });
  livePrompterDraftDirty = false;
  sendToPrompter();
  hideOverlay('lsScriptEditOv');
  renderLive(); syncToFirestore(); toast('Script saved & pushed.');
}

function jumpToLsCue(i, opts = {}) {
  if (!liveCommandDispatchAllowed({ notify:true })) return false;
  // Same gate as GO (canOwnLiveActiveCue): blocks students in shared sessions
  // but keeps the solo/demo carve-out where the operator always drives.
  if (!canOwnLiveActiveCue()) return false;
  // Standard show callers advance sequentially UNLESS they explicitly confirmed
  // a jump (the row-preview "Cue here" ask) — that confirm IS the safety rail.
  if (isStandardShowCaller() && !opts.confirmed) return false;
  if (liveCueIsDisabled(i)) {
    toast(`Row ${i + 1} is disabled and cannot go active.`);
    return false;
  }
  if (liveCueExecutionStatus(i) === 'failed') {
    toast(`Recover failed row ${i + 1} before making it active.`);
    return false;
  }
  try { setOperatorLiveCue(i, 'jump-cue'); }
  catch (error) {
    containError('Live row activation', error);
    return false;
  }
  renderLive();
  sendToPrompter(false).then(pushed => { if (pushed) cuePrompterToLiveRow(); });
  syncLiveIdx();
  return liveActiveCueIndex() === i;
}

function selectLiveRundownRow(event, i) {
  if (!liveCommandDispatchAllowed({ notify:true })) return false;
  if (event?.type === 'keydown') {
    if (!['Enter',' '].includes(event.key)) return false;
    event.preventDefault();
  }
  if (event?.target !== event?.currentTarget && isInteractiveTarget(event?.target)) {
    const currentOwnsButtonRole = event.currentTarget?.matches?.('[role="button"]')
      && event.target?.closest?.('[role="button"]') === event.currentTarget;
    if (!currentOwnsButtonRole) return false;
  }
  if (!Number.isFinite(i) || !beats[i] || beats[i]?.style === 'segment' || liveCueIsDisabled(i)) return false;
  setLiveSelectedCue(i, { reason:'live-row-selection' });
  renderLive();
  // Clicking a row opens its preview card, which carries the "Cue here" ask —
  // the supported way to cue the show to any row (incl. back to the top).
  liveRowPreview(i);
  return true;
}

function activateLiveRundownRow(event, i) {
  event?.preventDefault?.();
  event?.stopPropagation?.();
  if (!liveCommandDispatchAllowed({ notify:true })) return false;
  if (!Number.isFinite(i) || !beats[i] || beats[i]?.style === 'segment' || liveCueIsDisabled(i)) return false;
  return jumpToLsCue(i);
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
  if (!liveCommandDispatchAllowed({ notify:true })) return false;
  detachIfFollowing();
  const activeIdx = liveActiveCueIndex();
  const prev = beats[activeIdx];
  const ni = liveNextPlayableCueIndex(activeIdx);
  if (ni < 0) { updateLiveGoControl(); return false; }
  if (liveCueExecutionStatus(ni) === 'failed') {
    toast(`Recover failed row ${ni + 1} before GO.`);
    updateLiveGoControl();
    return false;
  }
  try {
    setOperatorLiveCue(ni, 'advance-cue');
    updatePrompterOnAdvance(prev, beats[lsIdx]);
    if (fireOutrangutanAutoForBeat(beats[lsIdx]) === false) throw new Error('Automatic playback dispatch was rejected');
    logShow('cue', 'Advance → row ' + (lsIdx + 1) + rowLogLabel(beats[lsIdx]));
    renderLive();
    syncLiveIdx();
    return true;
  } catch (error) {
    markLiveCueFailure(ni, error, 'advance-cue-failed');
    containError('Live GO', error);
    return false;
  }
}
// P7: short human label for a row in the show log.
function rowLogLabel(b) {
  const name = String(b?.info || b?.cues?.script?.who || '').trim();
  return name ? ' · ' + name.slice(0, 60) : '';
}

function lsPrev() {
  if (!liveCommandDispatchAllowed({ notify:true })) return false;
  detachIfFollowing();
  const ni = livePreviousPlayableCueIndex(liveActiveCueIndex());
  if (ni >= 0) {
    try { setOperatorLiveCue(ni, 'previous-cue'); }
    catch (error) { containError('Previous Live cue', error); return false; }
    logShow('cue', 'Back → row ' + (lsIdx + 1) + rowLogLabel(beats[lsIdx]));
    renderLive();
    sendToPrompter(false).then(pushed => { if (pushed) cuePrompterToLiveRow(); });
    syncLiveIdx();
    return true;
  }
  return false;
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
  let html = `<button type="button" class="follow-chip follow-self ${activeName===session.userName?'active':''}" onclick="followSelf()" aria-pressed="${activeName===session.userName?'true':'false'}">Myself</button>`;
  others.forEach(([id, p])=>{
    const isActive = followTargetId ? followTargetId === id : sameParticipantName(activeName, p.name);
    html+=`<button type="button" class="follow-chip ${isActive?'active':''}" data-follow-id="${esc(id)}" data-follow-name="${esc(p.name)}" onclick="followPerson(this)" aria-pressed="${isActive?'true':'false'}">${esc(p.name)}<span class="p-tip-label" style="margin-left:5px">${p.role==='instructor'?'INST':'STU'}</span></button>`;
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
    setLiveSelectedCue(target.idx, { reason:'follow-person' });
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
  if (target && Number.isFinite(target.idx)) setLiveSelectedCue(target.idx, { reason:'forced-follow' });
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
  if (!liveCommandDispatchAllowed({ notify:true })) return false;
  const ownIdx = currentPresence?.[presenceId]?.idx;
  browsingSelf = true;
  followTarget = '';
  followTargetId = '';
  if (Number.isFinite(ownIdx)) setOperatorLiveCue(ownIdx, 'return-to-own-cue');
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
let _prompterOperatorRuntimeActive = false;
let _prompterTalentWin = null;
let lastTalentPingTs = 0;        // operator-side: when did we last hear from a talent
let _lastSeenTalentHeartbeatTs = 0; // dedup: last Firestore heartbeat ts we counted
let _talentWatchdog = null;       // interval that flips FLOWMINGO status if the talent goes silent
let _lastTalentInitSendBySender = {};
let _pendingPrompterControls = {};
let _lastPrompterAckId = '';
let _seenPrompterOperatorMsgIds = [];
let _activePrompterOutputInstanceId = '';
let _lastAppliedPrompterSnapshotId = '';
let _prompterHandshakeTimer = null;
let _prompterMissCount = 0;
let _prompterRecoveryAnnounced = false;
const PROMPTER_HEARTBEAT_MS = 2000;
const PROMPTER_MISS_THRESHOLD = 3;
const PROMPTYPUS_CHANNEL = 'promptypus';
const PROMPTYPUS_STORAGE_MSG = 'promptypus_msg';
const PROMPTYPUS_STORAGE_PING = 'promptypus_ping';
const PROMPTYPUS_LEGACY_CHANNEL = 'prompt_up_the_jam';
const PROMPTYPUS_LEGACY_STORAGE_MSG = 'prompt_up_the_jam_msg';
const PROMPTYPUS_LEGACY_STORAGE_PING = 'prompt_up_the_jam_ping';

function buildCompletePrompterState() {
  const state = currentPrompterSessionState();
  return {
    state,
    script: {
      id:state.scriptId,
      text:prompterText,
      version:prompterVersion,
      source:prompterSource,
      updatedAt:prompterUpdatedAt,
    },
    display: {
      size:ptFontSize,
      align:ptAlign,
      theme:ptThemeName,
      mirrored:ptMirrored,
      panelVisible:ptPanelVisible,
    }
  };
}

function sendPrompterStateSnapshot(outputInstanceId, reason='ready') {
  outputInstanceId = String(outputInstanceId || _activePrompterOutputInstanceId || '').trim();
  if (!outputInstanceId) return null;
  _activePrompterOutputInstanceId = outputInstanceId;
  prompterSessionController.noteOutput(outputInstanceId, 'connected');
  const complete = buildCompletePrompterState();
  const message = {
    ...prompterSessionController.buildSnapshot({ outputInstanceId, state:complete.state }),
    script:complete.script,
    display:complete.display,
    reason,
  };
  projectPrompterSessionStatus('connected', reason === 'recovery' ? 'Output returned · restoring state' : 'Output connected · applying state');
  _postPrompterMessage(message);
  if (window._firebaseReady && session.code && !session.isDemo && window._updateDoc) {
    window._updateDoc(window._doc(window._db, 'sessions', session.code), {
      'prompter.stateMessage':message,
      'prompter.protocolVersion':message.protocolVersion,
      'prompter.sessionId':message.sessionId,
      'prompter.snapshotId':message.snapshotId,
      'prompter.state':message.state,
      'prompter.updatedAt':message.ts,
    }).catch(err => {
      projectPrompterSessionStatus('error', firebaseConnectionLabel(err, 'Flowmingo state sync failed'));
    });
  }
  clearTimeout(_prompterHandshakeTimer);
  _prompterHandshakeTimer = setTimeout(() => {
    if (!prompterSessionController.isReady(outputInstanceId)) {
      projectPrompterSessionStatus('recovering', 'Output did not acknowledge the state snapshot');
    }
  }, PROMPTER_HEARTBEAT_MS * PROMPTER_MISS_THRESHOLD);
  return message;
}

function applyCompletePrompterState(message) {
  if (!message?.state || !message.snapshotId) return false;
  if (!prompterSessionController.accepts(message)) return false;
  const outputId = String(message.targetOutputInstanceId || message.outputInstanceId || FLOWMINGO_ENDPOINT_ID);
  if (message.targetOutputInstanceId && message.targetOutputInstanceId !== FLOWMINGO_ENDPOINT_ID) return false;
  if (message.snapshotId === _lastAppliedPrompterSnapshotId) {
    ptPostOperatorMessage(prompterSessionController.buildStateApplied(message.snapshotId));
    return true;
  }
  const state = prompterSessionController.applySnapshot(message.state, outputId);
  if (state.productionCode) {
    ptLinkedCueolaCode = state.productionCode;
    session.code = state.productionCode;
    session.isDemo = false;
    session.isExpert = false;
  }
  const script = message.script || {};
  if (typeof script.text === 'string') {
    const nextText = script.text;
    adoptPrompterText(nextText, {
      version:Number(script.version)||0,
      updatedAt:Number(script.updatedAt)||Number(message.ts)||0,
      source:script.source || 'snapshot',
    });
    if (nextText !== ptLastCueolaScript) {
      const hadScript = ptHasScript();
      ptLastCueolaScript = nextText;
      if (hadScript) ptApplyCueolaLiveUpdate(nextText);
      else ptSetScriptText(nextText);
    }
  }
  const display = message.display || {};
  if (Number.isFinite(Number(display.size))) ptSetSize(Number(display.size));
  if (['left','center','right'].includes(display.align)) ptSetAlign(display.align);
  if (display.theme && PT_THEMES[display.theme]) ptSetTheme(display.theme);
  if (typeof display.mirrored === 'boolean' && display.mirrored !== ptMirrored) ptToggleMirror();
  if (Number.isFinite(Number(state.position))) {
    ptOffset = Math.max(0, Number(state.position));
    requestAnimationFrame(() => {
      const track = ptEl('pt-track');
      if (track) track.style.transform = `translateY(-${ptOffset}px)`;
      ptUpdateProgress();
    });
  }
  ptTargetSpeed = state.targetSpeed;
  ptLiveSpeed = state.effectiveSpeed;
  if (state.running && !ptPlaying) ptStartPlay();
  else if (!state.running && ptPlaying) ptStopPlay();
  _lastAppliedPrompterSnapshotId = message.snapshotId;
  ptConnState = 'connected';
  ptConnMessage = '';
  ptUpdateReady();
  ptPostOperatorMessage(prompterSessionController.buildStateApplied(message.snapshotId));
  ptTalentHeartbeat();
  return true;
}

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
  return !!lastTalentPingTs && (Date.now() - lastTalentPingTs) < (PROMPTER_HEARTBEAT_MS * PROMPTER_MISS_THRESHOLD + 1000);
}

function _notePrompterTalentSeen(msg={}) {
  if (isPrompterSelfSender(msg.sender)) return false;
  if (!_prompterOperatorRuntimeActive) return false;
  const wasSilent = !_prompterHasRecentTalent();
  lastTalentPingTs = Date.now();
  _prompterMissCount = 0;
  const outputId = String(msg.outputInstanceId || msg.senderInstanceId || msg.sender || '').trim();
  if (outputId && (!_activePrompterOutputInstanceId || outputId === _activePrompterOutputInstanceId)) {
    _activePrompterOutputInstanceId = outputId;
  }
  if (prompterSessionController.isReady(_activePrompterOutputInstanceId)) {
    const state = msg.state || prompterSessionController.getState();
    projectPrompterSessionStatus(state.running ? 'running' : 'paused', state.running ? 'Talent scrolling' : 'Talent paused');
  } else {
    projectPrompterSessionStatus('connected', 'Talent connected · applying state');
  }
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
  const observedPlaying = typeof state.running === 'boolean' ? state.running : state.playing;
  if (typeof observedPlaying === 'boolean') {
    ptPlaying = observedPlaying;
    flowOpPlaying = observedPlaying;
    ptSyncPlayIcons(ptPlaying);
    if (_prompterHasRecentTalent()) {
      setLiveSubsystemStatus('prompter', ptPlaying ? 'active' : 'paused', ptPlaying ? 'Talent scrolling' : 'Talent paused');
    }
  }
  const observedSpeed = state.targetSpeed ?? state.speed;
  if (Number.isFinite(Number(observedSpeed))) {
    ptTargetSpeed = Math.max(5, Math.min(200, Number(observedSpeed)));
    ptLiveSpeed = Number.isFinite(Number(state.effectiveSpeed)) ? Number(state.effectiveSpeed) : ptTargetSpeed;
  }
  if (Number.isFinite(Number(state.position))) ptOffset = Math.max(0, Number(state.position));
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
  prompterSessionController.setTransport({
    running:ptPlaying,
    position:ptOffset,
    targetSpeed:ptTargetSpeed,
    effectiveSpeed:ptLiveSpeed,
    lastCommandId:state.lastCommandId,
    status:ptPlaying ? 'running' : 'paused',
  });
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
  if (msg.state) {
    adoptPrompterTalentState(msg.state);
    projectPrompterSessionStatus(msg.state.running || msg.state.playing ? 'running' : 'paused', msg.state.running || msg.state.playing ? 'Talent scrolling' : 'Talent paused');
  }
  const pending = _pendingPrompterControls[msg.controlId];
  if (pending) {
    clearTimeout(pending.waitTimer);
    clearTimeout(pending.failTimer);
    delete _pendingPrompterControls[msg.controlId];
    pending.settle?.({ ok:true, acknowledged:true, state:msg.state || null });
    const label = flowOpControlLabel(pending.action);
    if (pending.origin === 'flowop') flowOpSetStatus(`${label} applied`);
    else markLivePrompterStatus(`${label} applied`, 'ok');
  }
}

// Split-brain recovery (TH2607 show-day incident): a talent output heartbeating
// for OUR production but on a different prompter sessionId was dropped by
// accepts() forever — operator and talent each rejected the other's session, so
// the handshake never completed and every control queued while the talent
// looked "connected" in the doc. This happens whenever a second operator
// surface (or a talent reload) re-seeds the talent's session. The surface
// actually calling the show adopts the talent's session and re-publishes its
// own state into it; the talent then accepts that snapshot (sessionId matches),
// its next heartbeat carries our snapshotId, and readiness + queued commands
// converge through the normal path.
let _lastPrompterSessionReclaimTs = 0;
function _maybeReclaimPrompterTalentSession(msg) {
  if (!['PROMPTER_HEARTBEAT', 'PROMPTER_READY'].includes(msg?.type)) return false;
  if (Number(msg.protocolVersion) !== window.CueolaPrompterSession?.PROTOCOL_VERSION) return false;
  const code = String(msg.productionCode || '').trim().toUpperCase();
  if (!code || !session.code || code !== String(session.code).toUpperCase()) return false;
  const remoteSession = String(msg.sessionId || '').trim();
  const localSession = String(prompterSessionController.getState().sessionId || '').trim();
  if (!remoteSession || !localSession || remoteSession === localSession) return false;
  // Only the surface actually calling the show may reclaim, and never in a
  // tight loop — two live operator windows must not snapshot-war over talent.
  if (!document.getElementById('liveshow')?.classList.contains('on')) return false;
  if (!canOwnLiveActiveCue()) return false;
  const now = Date.now();
  if (now - _lastPrompterSessionReclaimTs < 10000) return false;
  const outputId = String(msg.outputInstanceId || msg.senderInstanceId || msg.sender || '').trim();
  if (!outputId) return false;
  _lastPrompterSessionReclaimTs = now;
  prompterSessionController.setIdentity({ sessionId: remoteSession });
  _activePrompterOutputInstanceId = outputId;
  prompterSessionController.noteOutput(outputId, 'connected');
  _notePrompterTalentSeen(msg);
  logShow('prompter', `Reclaimed talent output ${outputId} — adopted prompter session ${remoteSession} (was ${localSession}) and re-sent state`);
  sendPrompterStateSnapshot(outputId, 'recovery');
  return true;
}

function _handlePrompterOperatorMessage(msg) {
  if (!msg || isPrompterSelfSender(msg.sender)) return;
  if (_maybeReclaimPrompterTalentSession(msg)) return;
  if (!prompterSessionController.accepts(msg, { allowLegacy:true })) return;
  // Talent messages are mirrored over BroadcastChannel, legacy channel,
  // localStorage, and sometimes Firestore. Process one logical message once;
  // duplicate READY messages used to create several paused snapshots, one of
  // which could arrive after a queued PLAY and stop the renderer again.
  const messageId = msg.mid || `${msg.senderInstanceId || msg.sender || ''}:${msg.ts || 0}:${msg.type || ''}`;
  if (_seenPrompterOperatorMsgIds.includes(messageId)) return;
  _seenPrompterOperatorMsgIds.push(messageId);
  if (_seenPrompterOperatorMsgIds.length > 160) _seenPrompterOperatorMsgIds = _seenPrompterOperatorMsgIds.slice(-80);
  if (msg.type === 'PROMPTER_READY') {
    const outputId = String(msg.outputInstanceId || msg.senderInstanceId || msg.sender || '').trim();
    if (!outputId) return;
    if (_activePrompterOutputInstanceId === outputId
        && (prompterSessionController.isReady(outputId) || _prompterHandshakeTimer)) {
      _notePrompterTalentSeen(msg);
      return;
    }
    const replacing = _activePrompterOutputInstanceId && _activePrompterOutputInstanceId !== outputId;
    _activePrompterOutputInstanceId = outputId;
    prompterSessionController.noteOutput(outputId, 'connected');
    _notePrompterTalentSeen(msg);
    sendPrompterStateSnapshot(outputId, replacing ? 'recovery' : 'ready');
    return;
  }
  if (msg.type === 'PROMPTER_STATE_APPLIED') {
    const outputId = String(msg.outputInstanceId || msg.senderInstanceId || msg.sender || '').trim();
    if (!outputId || outputId !== _activePrompterOutputInstanceId) return;
    if (!prompterSessionController.markStateApplied(outputId, msg.snapshotId, msg.state)) return;
    clearTimeout(_prompterHandshakeTimer);
    _prompterHandshakeTimer = null;
    _prompterRecoveryAnnounced = false;
    _notePrompterTalentSeen(msg);
    const state = msg.state || prompterSessionController.getState();
    adoptPrompterTalentState(state);
    projectPrompterSessionStatus(state.running ? 'running' : 'ready', state.running ? 'Talent scrolling' : 'Talent ready');
    flushPrompterCommandQueue(outputId);
    return;
  }
  if (msg.type === 'PROMPTER_HEARTBEAT') {
    const outputId = String(msg.outputInstanceId || msg.senderInstanceId || msg.sender || '').trim();
    if (_activePrompterOutputInstanceId && outputId !== _activePrompterOutputInstanceId) return;
    if (!_activePrompterOutputInstanceId) {
      _activePrompterOutputInstanceId = outputId;
      prompterSessionController.noteOutput(outputId, 'connected');
    }
    const wasSilent = _notePrompterTalentSeen(msg);
    if (msg.snapshotId && prompterSessionController.markStateApplied(outputId, msg.snapshotId, msg.state)) {
      clearTimeout(_prompterHandshakeTimer);
      _prompterHandshakeTimer = null;
      adoptPrompterTalentState(msg.state || {});
      flushPrompterCommandQueue(outputId);
    }
    if (wasSilent) sendPrompterStateSnapshot(outputId, 'recovery');
    return;
  }
  if (msg.type === 'ping') {
    const wasSilent = _notePrompterTalentSeen(msg);
    if (Number(msg.protocolVersion) >= 2) return;
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
    _prompterMissCount = Math.floor(age / PROMPTER_HEARTBEAT_MS);
    if (_prompterMissCount >= PROMPTER_MISS_THRESHOLD) {
      if (!_prompterRecoveryAnnounced) {
        _prompterRecoveryAnnounced = true;
        prompterSessionController.markDisconnected(_activePrompterOutputInstanceId, 'Missed talent heartbeats');
        projectPrompterSessionStatus('recovering', `Talent unresponsive · missed ${_prompterMissCount} heartbeats`);
        console.warn('Flowmingo heartbeat missed', { outputInstanceId:_activePrompterOutputInstanceId, age });
      }
    }
  }, PROMPTER_HEARTBEAT_MS);
}

function initPrompter() {
  _prompterOperatorRuntimeActive = true;
  ensurePrompterProtocolIdentity();
  projectPrompterSessionStatus(_prompterHasRecentTalent() ? 'connected' : 'opening', _prompterHasRecentTalent() ? 'Talent connected · applying state' : 'Waiting for Flowmingo output');
  startTalentWatchdog();
  _ensurePrompterOperatorBridge(true);
  _setPrompterStatus(_prompterHasRecentTalent());
}

function stopPrompterOperatorRuntime() {
  _prompterOperatorRuntimeActive = false;
  clearInterval(_prompterPingInterval);
  _prompterPingInterval = null;
  clearInterval(_talentWatchdog);
  _talentWatchdog = null;
  if (_prompterStorageHandler) {
    window.removeEventListener('storage', _prompterStorageHandler);
    _prompterStorageHandler = null;
  }
  Object.values(_pendingPrompterControls).forEach(pending => {
    clearTimeout(pending?.waitTimer);
    clearTimeout(pending?.failTimer);
    pending?.settle?.({ ok:false, acknowledged:false, error:'Flowmingo operator bridge closed before acknowledgement' });
  });
  _pendingPrompterControls = {};
  clearTimeout(_prompterHandshakeTimer);
  _prompterHandshakeTimer = null;
  [prompterChannel, prompterLegacyChannel].forEach(channel => {
    try { channel?.close(); } catch (error) { containError('Flowmingo channel cleanup', error); }
  });
  prompterChannel = null;
  prompterLegacyChannel = null;
  lastTalentPingTs = 0;
  _lastSeenTalentHeartbeatTs = 0;
  _lastTalentInitSendBySender = {};
  _seenPrompterOperatorMsgIds = [];
  _activePrompterOutputInstanceId = '';
  _prompterMissCount = 0;
  _prompterRecoveryAnnounced = false;
  projectPrompterSessionStatus('closed', 'Live operator bridge closed');
}

function _setPrompterStatus(connected, unavailable=false) {
  if (unavailable) {
    projectPrompterSessionStatus('closed', 'Flowmingo unavailable');
    return;
  }
  if (connected) {
    const ready = prompterSessionController.isReady(_activePrompterOutputInstanceId);
    projectPrompterSessionStatus(ready ? (ptPlaying ? 'running' : 'paused') : 'connected', ready ? (ptPlaying ? 'Talent scrolling' : 'Talent paused') : 'Talent connected · applying state');
  } else {
    projectPrompterSessionStatus(lastTalentPingTs ? 'recovering' : 'opening', lastTalentPingTs ? 'Talent heartbeat expired' : 'Waiting for Flowmingo output');
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
  const rowNum = liveActiveCueIndex() + 1;
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
  if (_activePrompterOutputInstanceId) sendPrompterStateSnapshot(_activePrompterOutputInstanceId, isInit ? 'initial-state' : 'update');
  // Also update the native built-in Flowmingo screen
  if (isFlowmingoTalentActive()) {
    if (isInit) ptInitScriptFromCueola(prompterText);
    else ptUpdateFromCueola(prompterText);
  }
  try {
    if (window._firebaseReady && session.code && !session.isDemo) {
      const activeIdx = liveActiveCueIndex();
      const cur = beats[activeIdx] || null;
      const next = beats[activeIdx+1] || null;
      const protocolState = currentPrompterSessionState();
      await window._updateDoc(window._doc(window._db,'sessions',session.code),{
        'prompter.text':prompterText,
        'prompter.version':version,
        'prompter.updatedAt':updatedAt,
        'prompter.source':prompterSource || 'live',
        'prompter.sender':FLOWMINGO_ENDPOINT_ID,
        'prompter.senderClient':CLIENT_ID,
        'prompter.protocolVersion':window.CueolaPrompterSession.PROTOCOL_VERSION,
        'prompter.sessionId':protocolState.sessionId,
        'prompter.state':protocolState,
        'prompter.snapshotId':protocolState.snapshotId,
        'prompter.showName':show.name||'Untitled Show',
        'prompter.activeIdx':activeIdx,
        'prompter.currentRow':cur ? { index:activeIdx, name:cur.info||'', duration:fmtDur(cur) } : null,
        'prompter.nextRow':next ? { index:activeIdx+1, name:next.info||'', duration:fmtDur(next) } : null
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

const SCRIPT_OP_REGION_VERSION = '2';

function scriptOpRegionHasInteraction(region) {
  if (!region) return false;
  if (region.contains(document.activeElement)) return true;
  return Boolean(region.querySelector('[data-control-dragging="1"],[data-seek-dragging="1"]'));
}

function mountScriptOpRegion(region, name, buildHTML) {
  if (!region) return false;
  const version = `${name}-${SCRIPT_OP_REGION_VERSION}`;
  const needsMount = region.dataset.renderVersion !== version || !region.firstElementChild;
  if (!needsMount || scriptOpRegionHasInteraction(region)) return false;
  region.innerHTML = buildHTML();
  region.dataset.renderVersion = version;
  region.dataset.renderCount = String((parseInt(region.dataset.renderCount || '0', 10) || 0) + 1);
  return true;
}

function scriptOpInputCanPatch(input, dragField='controlDragging') {
  return Boolean(input && document.activeElement !== input && input.dataset[dragField] !== '1');
}

function patchScriptOpPrompterControls(region) {
  if (!region) return;
  patchPrompterPlayButton(region.querySelector('[data-prompter-play]'), ptPlaying);
  const speed = region.querySelector('[data-prompter-speed]');
  if (scriptOpInputCanPatch(speed)) speed.value = String(ptTargetSpeed);
  const size = region.querySelector('[data-prompter-size]');
  if (scriptOpInputCanPatch(size)) size.value = String(ptFontSize);
  region.querySelectorAll('[data-prompter-align]').forEach(button => {
    const active = button.dataset.prompterAlign === ptAlign;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', active ? 'true' : 'false');
  });
  region.querySelectorAll('[data-prompter-theme]').forEach(button => {
    const active = button.dataset.prompterTheme === ptThemeName;
    button.classList.toggle('active', active);
    button.classList.toggle('on', active);
    button.setAttribute('aria-pressed', active ? 'true' : 'false');
  });
}

function scriptOpNextCueIndex() {
  let index = liveActiveCueIndex();
  do { index += 1; } while (index < beats.length && beats[index]?.style === 'segment');
  return index < beats.length ? index : -1;
}

function patchScriptOpLiveActions(region) {
  if (!region) return;
  const activeIndex = liveActiveCueIndex();
  const nowButton = region.querySelector('[data-script-op-cue="now"]');
  if (nowButton) {
    const row = Math.max(activeIndex, 0) + 1;
    nowButton.setAttribute('onclick', `sendPrompterControl('seek_row_${row}')`);
    nowButton.disabled = beats.length === 0;
  }
  const nextButton = region.querySelector('[data-script-op-cue="next"]');
  if (nextButton) {
    const nextIndex = scriptOpNextCueIndex();
    nextButton.setAttribute('onclick', `sendPrompterControl('seek_row_${nextIndex + 1}')`);
    nextButton.disabled = nextIndex < 0;
  }
  const seek = region.querySelector('#lsq-seek');
  if (scriptOpInputCanPatch(seek, 'seekDragging') && ptGetMaxScroll() > 0) {
    seek.value = String(ptProgressPct());
  }
  const tech = region.querySelector('#lsq-tech-btn');
  if (tech) tech.setAttribute('onclick', 'toggleTechDifficulty()');
  const bars = region.querySelector('#lsq-bars-btn');
  if (bars) bars.setAttribute('onclick', 'toggleColorBars()');
  syncTechButtons();
}

function patchScriptOpClockControls(region) {
  if (!region) return;
  const state = ptClockState || {};
  const mode = state.mode || 'off';
  region.querySelectorAll('[data-clock-mode]').forEach(button => {
    const active = button.dataset.clockMode === mode;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', active ? 'true' : 'false');
  });
  const question = region.querySelector('[data-clock-question]');
  if (question) {
    patchIconLabelButton(question, ptQuestionOn ? 'notification.unread' : 'notification.default', ptQuestionOn ? 'Clear question' : 'Question');
    question.classList.toggle('active', ptQuestionOn);
    question.setAttribute('aria-pressed', ptQuestionOn ? 'true' : 'false');
    question.setAttribute('onclick', "toggleQuestionIndicator('lsq')");
  }
  const size = region.querySelector('[data-clock-size]');
  if (size) size.textContent = ['S','M','L','XL','MAX'][Math.max(0, Math.min(4, state.size ?? 1))];
  [
    ['#lsq-duration-min', flowClockDurationMin],
    ['#lsq-clock-time', flowClockCountTime],
    ['#lsq-wrap-min', flowWrapCustomMin],
  ].forEach(([selector, value]) => {
    const input = region.querySelector(selector);
    if (input && document.activeElement !== input) input.value = String(value ?? '');
  });
}

function renderLivePrompterControls() {
  // The docked Script Op structure is stable. Heartbeats and Live renders patch
  // state in place so focus, slider capture, textarea selection, and caret survive.
  const live = document.getElementById('lsLiveActions');
  const clocks = document.getElementById('lsClockActions');
  const remote = document.getElementById('lsPrompterRemote');
  mountScriptOpRegion(live, 'live', () => liveActionsHTML('lsq'));
  mountScriptOpRegion(clocks, 'clock', () => clockAndAlertControlsHTML('lsq'));
  mountScriptOpRegion(remote, 'prompter', () => promptOpControlsHTML(false));
  patchScriptOpLiveActions(live);
  patchScriptOpClockControls(clocks);
  patchScriptOpPrompterControls(remote);
  renderPromptOpClockPreview();
  lsInspRestoreTab();   // keep the remembered inspector tab active across re-renders
  scriptOperatorPublishState();
}

// ── Script Op pop-out controls ─────────────────────────────────────────────
// The popout is a projection of this controller, never a second Cueola client.
// It owns no Firebase listener or prompter protocol identity: one identified
// host sends complete snapshots and executes allowlisted popup intents through
// the same sendPrompterControl()/sendToPrompter() paths used by the docked UI.
const SCRIPT_OPERATOR_CONTROLLER_ID = 'sop_' + FLOWMINGO_ENDPOINT_ID;
const SCRIPT_OPERATOR_CONTROL_ACTIONS = new Set([
  'pause','resume','speed_up','speed_down','size_up','size_down','reset',
  'hide_interface','mirror','fullscreen','direction_reverse','direction_forward',
  'brake_start','brake_stop','boost_start','boost_stop',
  'align_left','align_center','align_right','slate_tech_on','slate_tech_off',
  'slate_bars_on','slate_bars_off','clock_timeofday','clock_off',
  'clock_size_up','clock_size_down','question_on','question_off'
]);
let _scriptOpWin = null;
let _scriptOpHost = null;
let _scriptOpChannel = null;
let _scriptOpWindowMessageHandler = null;
let _scriptOpWatchdog = null;
let _scriptOpActiveOperatorId = '';
let _scriptOpLastStateFingerprint = '';
let _scriptOpDisconnectAnnounced = false;

function toggleScriptOpPopout() { openScriptOpPopout(); }

function scriptOperatorIdentity() {
  const state = currentPrompterSessionState();
  return {
    productionCode:String(session.code || state.productionCode || '').trim().toUpperCase(),
    sessionId:String(state.sessionId || '').trim(),
    controllerInstanceId:SCRIPT_OPERATOR_CONTROLLER_ID,
  };
}

function scriptOperatorNextCueIndex() {
  let index = liveActiveCueIndex();
  do { index += 1; } while (index < beats.length && beats[index]?.style === 'segment');
  return index < beats.length ? index : -1;
}

function scriptOperatorSnapshot() {
  const activeIdx = liveActiveCueIndex();
  const nextIdx = scriptOperatorNextCueIndex();
  const activeBeat = beats[activeIdx] || null;
  const nextBeat = beats[nextIdx] || null;
  // Read the controller here; do not call currentPrompterSessionState(), whose
  // transport reconciliation intentionally advances stateVersion/timestamps.
  // An idle Script Operator watchdog must not create new prompter state.
  const prompterState = prompterSessionController.getState();
  const liveState = liveSessionState();
  let inspectorTab = 'prompter';
  try { inspectorTab = localStorage.getItem('cueola_script_operator_tab') || 'prompter'; } catch {}
  return {
    productionCode:session.code,
    showName:show.name || 'Untitled Show',
    liveLifecycle:liveState.lifecycle,
    controlsEnabled:liveState.lifecycle === 'live',
    activeIdx,
    nextRowIndex:nextIdx,
    currentRow:activeBeat ? { index:activeIdx, id:String(activeBeat.id || ''), name:activeBeat.info || '' } : null,
    nextRow:nextBeat ? { index:nextIdx, id:String(nextBeat.id || ''), name:nextBeat.info || '' } : null,
    prompterText,
    draft:{ text:prompterText, version:livePrompterDraftVersion, dirty:livePrompterDraftDirty },
    playing:Boolean(ptPlaying),
    running:Boolean(ptPlaying),
    speed:Number(ptTargetSpeed),
    targetSpeed:Number(ptTargetSpeed),
    effectiveSpeed:Number(ptLiveSpeed),
    size:Number(ptFontSize),
    fontSize:Number(ptFontSize),
    align:ptAlign,
    progressPct:ptProgressPct(),
    position:Number(ptOffset),
    reversing:Boolean(ptReversing),
    mirrored:Boolean(ptMirrored),
    techSlateOn:Boolean(ptTechSlateOn),
    colorBarsOn:Boolean(ptColorBarsOn),
    questionOn:Boolean(ptQuestionOn),
    clockState:{ ...ptClockState },
    clockDurationMinutes:flowClockDurationMin,
    clockCountTime:flowClockCountTime,
    wrapMinutes:flowWrapCustomMin,
    prompterTheme:ptThemeName,
    uiTheme:currentTheme,
    inspectorTab,
    prompter:{
      sessionId:prompterState.sessionId,
      productionCode:prompterState.productionCode,
      scriptId:prompterState.scriptId,
      activeCueId:prompterState.activeCueId,
      outputInstanceId:prompterState.outputInstanceId,
      status:prompterState.status,
      error:prompterState.error,
      text:prompterText,
      playing:Boolean(ptPlaying),
      speed:Number(ptTargetSpeed),
      size:Number(ptFontSize),
      align:ptAlign,
      progress:ptProgressPct(),
      mirrored:Boolean(ptMirrored),
      theme:ptThemeName,
      techSlateOn:Boolean(ptTechSlateOn),
      colorBarsOn:Boolean(ptColorBarsOn),
      questionOn:Boolean(ptQuestionOn),
      clockState:{ ...ptClockState },
    }
  };
}

function scriptOperatorSetButton(active, label='Pop out Script Operator') {
  const button = document.getElementById('lsPopoutBtn');
  if (!button) return;
  button.classList.toggle('active', Boolean(active));
  button.title = label;
  button.setAttribute('aria-label', label);
  const icon = button.querySelector('.sf-symbol');
  if (icon) icon.setAttribute('data-symbol', active ? 'content.display' : 'action.fullscreen');
}

function scriptOperatorSend(message) {
  if (!message) return false;
  let sent = false;
  if (_scriptOpChannel) {
    try { _scriptOpChannel.postMessage(message); sent = true; }
    catch (error) { containError('Script Operator channel send', error); }
  }
  if (_scriptOpWin && !_scriptOpWin.closed) {
    try { _scriptOpWin.postMessage(message, location.origin); sent = true; }
    catch (error) { containError('Script Operator window send', error); }
  }
  return sent;
}

function scriptOperatorPublishState(force=false) {
  if (!_scriptOpHost) return false;
  const status = _scriptOpHost.getStatus();
  if (!status.operatorInstanceId || !status.connected) return false;
  const snapshot = scriptOperatorSnapshot();
  const fingerprint = JSON.stringify(snapshot);
  if (!force && fingerprint === _scriptOpLastStateFingerprint) {
    return scriptOperatorSend(_scriptOpHost.buildHeartbeat());
  }
  _scriptOpLastStateFingerprint = fingerprint;
  return scriptOperatorSend(_scriptOpHost.buildState(snapshot));
}

function scriptOperatorControlAllowed(action) {
  action = String(action || '');
  if (SCRIPT_OPERATOR_CONTROL_ACTIONS.has(action)) return true;
  if (/^theme_(cool|warm|white|green|koala|panda|flamingo|outrangutan|prepbear)$/.test(action)) return true;
  let match = action.match(/^(speed_set|size_set|seek_set|seek_row|clock_duration|wrapup)_(-?\d+(?:\.\d+)?)$/);
  if (match) {
    const value = Number(match[2]);
    if (!Number.isFinite(value)) return false;
    if (match[1] === 'speed_set') return value >= 5 && value <= 200;
    if (match[1] === 'size_set') return value >= 24 && value <= 120;
    if (match[1] === 'seek_set') return value >= 0 && value <= 100;
    if (match[1] === 'seek_row') return Number.isInteger(value) && value >= 1 && value <= Math.max(1, beats.length);
    return value >= 1 && value <= 999 * 60;
  }
  match = action.match(/^clock_until_(\d+)_label_([A-Za-z0-9%.-]{1,160})$/);
  return Boolean(match && Number(match[1]) >= Date.now() - 60000 && Number(match[1]) <= Date.now() + 8 * 86400000);
}

function scriptOperatorApplyPreview(action) {
  if (action.startsWith('speed_set_')) ptSetSpeed(action.slice('speed_set_'.length));
  else if (action.startsWith('size_set_')) ptSetSize(action.slice('size_set_'.length));
  else if (action.startsWith('seek_set_')) lsScrubPreviewScript(action.slice('seek_set_'.length));
  return sendPrompterPreviewControl(action);
}

async function scriptOperatorExecuteCommand(command) {
  const kind = String(command?.commandType || '');
  const data = command?.data && typeof command.data === 'object' ? command.data : {};
  if (liveSessionState().lifecycle !== 'live') {
    throw new Error('Live controls are paused while Cueola changes mode.');
  }
  if (kind === 'control' || kind === 'preview') {
    const action = String(data.action || '');
    if (!scriptOperatorControlAllowed(action)) throw new Error('Rejected Script Operator action: ' + action);
    if (kind === 'preview') {
      const applied = scriptOperatorApplyPreview(action);
      return { ok:true, detail:applied === false ? 'Preview held until talent is ready' : 'Preview applied' };
    }
    if (livePrompterOpen && Date.now() < flowmingoRemoteOverrideUntil && !isCollaborativePrompterControl(action)) {
      return { ok:false, error:'Flowmingo Op currently owns transport controls' };
    }
    const durationMatch = action.match(/^clock_duration_(\d+(?:\.\d+)?)$/);
    const wrapMatch = action.match(/^wrapup_(\d+(?:\.\d+)?)$/);
    const countToMatch = action.match(/^clock_until_(\d+)_label_/);
    if (durationMatch) setFlowClockDuration(Number(durationMatch[1]) / 60);
    if (wrapMatch) setFlowWrapCustomMin(Number(wrapMatch[1]) / 60);
    if (countToMatch) {
      const target = new Date(Number(countToMatch[1]));
      setFlowClockCountTime(`${String(target.getHours()).padStart(2, '0')}:${String(target.getMinutes()).padStart(2, '0')}`);
    }
    if (action === 'slate_tech_on' && !ptTechSlateOn) recordTechDifficultyMarker();
    const sent = sendPrompterControl(action);
    return { ok:true, queued:sent === false, detail:sent === false ? 'Queued until talent is ready' : flowOpControlLabel(action) + ' sent' };
  }
  if (kind === 'draft') {
    const text = String(data.text || '').slice(0, 500000);
    livePrompterDraftDirty = true;
    livePrompterDraftVersion += 1;
    adoptPrompterText(text, { forceEditor:true, source:'script-op-popout' });
    markLivePrompterStatus('Draft held', 'busy');
    return { ok:true, detail:'Draft synchronized' };
  }
  if (kind === 'push') {
    const text = String(data.text || '').slice(0, 500000);
    livePrompterDraftDirty = true;
    livePrompterDraftVersion += 1;
    adoptPrompterText(text, { forceEditor:true, source:'script-op-popout' });
    const pushed = await pushToPrompter();
    return { ok:Boolean(pushed), detail:pushed ? 'Pushed to Flowmingo' : 'Flowmingo push failed', error:pushed ? '' : 'Flowmingo push failed' };
  }
  if (kind === 'clear') {
    if (data.confirmed !== true) throw new Error('Clear requires confirmation in the Script Operator window.');
    adoptPrompterText('', { forceEditor:true, source:'cleared' });
    livePrompterDraftDirty = false;
    const pushed = await sendToPrompter(true);
    return { ok:Boolean(pushed), detail:pushed ? 'Flowmingo script cleared' : 'Clear failed', error:pushed ? '' : 'Clear failed' };
  }
  if (kind === 'edit-script') {
    try { window.focus(); } catch {}
    openLiveScript(Math.max(liveActiveCueIndex(), 0));
    return { ok:true, detail:'Editor opened in Cueola Live' };
  }
  throw new Error('Rejected Script Operator command type: ' + kind);
}

function scriptOperatorFinishCommand(command, result) {
  if (!_scriptOpHost) return;
  const ack = _scriptOpHost.completeCommand(command, result);
  scriptOperatorSend(ack);
  scriptOperatorPublishState(true);
}

function scriptOperatorHandleMessage(message, source=null, origin='') {
  if (!_scriptOpHost || !message || typeof message !== 'object') return;
  if (origin && origin !== location.origin) return;
  const type = String(message.type || '').toUpperCase();
  if (type === 'READY' && !_scriptOpHost.accepts(message, { allowReplacement:true })) return;
  if (type === 'READY' && source && source !== _scriptOpWin) {
    if (_scriptOpWin && !_scriptOpWin.closed) { try { _scriptOpWin.close(); } catch {} }
    _scriptOpWin = source;
  }
  if (type === 'READY') {
    const previous = _scriptOpHost.getStatus().operatorInstanceId;
    const accepted = _scriptOpHost.noteReady(message);
    if (!accepted) return;
    if (previous && previous !== accepted.operatorInstanceId) {
      try { prompterSessionController.noteOperator(previous, false); } catch {}
    }
    _scriptOpActiveOperatorId = accepted.operatorInstanceId;
    _scriptOpDisconnectAnnounced = false;
    try { prompterSessionController.noteOperator(_scriptOpActiveOperatorId, true); } catch {}
    setLiveSubsystemStatus('scriptOperator', 'connecting', 'Applying current Script Operator state');
    scriptOperatorSetButton(true, 'Focus Script Operator window');
    scriptOperatorPublishState(true);
    return;
  }
  if (type === 'STATE_APPLIED') {
    if (!_scriptOpHost.markStateApplied(message)) return;
    _scriptOpDisconnectAnnounced = false;
    setLiveSubsystemStatus('scriptOperator', 'ready', 'Script Operator synchronized');
    scriptOperatorSetButton(true, 'Focus Script Operator window');
    logShow('script-operator', 'Script Operator ready · ' + _scriptOpActiveOperatorId);
    return;
  }
  if (type === 'HEARTBEAT') {
    const focused = Boolean(message.payload?.focused);
    if (!_scriptOpHost.noteHeartbeat(message)) return;
    _scriptOpDisconnectAnnounced = false;
    const ready = _scriptOpHost.isReady();
    setLiveSubsystemStatus('scriptOperator', ready && focused ? 'active' : ready ? 'ready' : 'connecting', ready ? (focused ? 'Script Operator active' : 'Script Operator synchronized') : 'Restoring Script Operator state');
    scriptOperatorSend(_scriptOpHost.buildHeartbeat());
    return;
  }
  if (type === 'CLOSING') {
    if (!_scriptOpHost.noteClosing(message)) return;
    stopScriptOperatorHost({ reason:'operator-window-closed', closeWindow:false, clearWindow:true, notify:false });
    return;
  }
  if (type === 'COMMAND') {
    const begun = _scriptOpHost.beginCommand(message);
    if (begun.ack) { scriptOperatorSend(begun.ack); return; }
    if (!begun.accepted) return;
    Promise.resolve(scriptOperatorExecuteCommand(begun.command))
      .then(result => scriptOperatorFinishCommand(begun.command, result))
      .catch(error => {
        console.error('[Script Operator] Command failed', { command:begun.command, error });
        logShow('error', 'Script Operator command failed · ' + String(error?.message || error));
        scriptOperatorFinishCommand(begun.command, { ok:false, error:String(error?.message || error) });
      });
  }
}

function startScriptOperatorHost(identity) {
  const P = window.CueolaScriptOperatorProtocol;
  if (!P) throw new Error('Script Operator protocol is unavailable.');
  _scriptOpHost = P.createHost(identity);
  _scriptOpLastStateFingerprint = '';
  _scriptOpDisconnectAnnounced = false;
  try {
    _scriptOpChannel = new BroadcastChannel(_scriptOpHost.channelName);
    _scriptOpChannel.addEventListener('message', event => scriptOperatorHandleMessage(event.data));
  } catch (error) {
    _scriptOpChannel = null;
    console.warn('[Script Operator] BroadcastChannel unavailable; using window messaging', error);
  }
  _scriptOpWindowMessageHandler = event => scriptOperatorHandleMessage(event.data, event.source, event.origin);
  window.addEventListener('message', _scriptOpWindowMessageHandler);
  _scriptOpWatchdog = setInterval(() => {
    if (_scriptOpWin && _scriptOpWin.closed) {
      stopScriptOperatorHost({ reason:'operator-window-closed', closeWindow:false, clearWindow:true, notify:false });
      return;
    }
    const status = _scriptOpHost?.getStatus();
    if (!status?.operatorInstanceId) return;
    if (!_scriptOpHost.checkHeartbeat()) {
      if (!_scriptOpDisconnectAnnounced) {
        _scriptOpDisconnectAnnounced = true;
        setLiveSubsystemStatus('scriptOperator', 'disconnected', 'Script Operator missed three heartbeats');
        logShow('error', 'Script Operator disconnected · missed three heartbeats');
        console.warn('[Script Operator] Heartbeat lost', status);
      }
      return;
    }
    scriptOperatorPublishState(false);
  }, P.HEARTBEAT_INTERVAL_MS || 2000);
  liveSessionController.registerCleanup('script-operator-popout', () => {
    stopScriptOperatorHost({ reason:'Live mode closed', closeWindow:true, clearWindow:true, notify:true });
  });
}

function stopScriptOperatorHost(options={}) {
  const reason = options.reason || 'Script Operator closed';
  if (_scriptOpHost && options.notify !== false) scriptOperatorSend(_scriptOpHost.close(reason));
  else if (_scriptOpHost) _scriptOpHost.close(reason);
  clearInterval(_scriptOpWatchdog);
  _scriptOpWatchdog = null;
  if (_scriptOpWindowMessageHandler) window.removeEventListener('message', _scriptOpWindowMessageHandler);
  _scriptOpWindowMessageHandler = null;
  if (_scriptOpChannel) {
    try { _scriptOpChannel.close(); } catch (error) { containError('Script Operator channel cleanup', error); }
  }
  _scriptOpChannel = null;
  if (_scriptOpActiveOperatorId) {
    try { prompterSessionController.noteOperator(_scriptOpActiveOperatorId, false); } catch {}
  }
  _scriptOpActiveOperatorId = '';
  _scriptOpHost = null;
  _scriptOpLastStateFingerprint = '';
  _scriptOpDisconnectAnnounced = false;
  if (options.closeWindow && _scriptOpWin && !_scriptOpWin.closed) {
    try { _scriptOpWin.close(); } catch (error) { containError('Script Operator window cleanup', error); }
  }
  if (options.clearWindow !== false) _scriptOpWin = null;
  setLiveSubsystemStatus('scriptOperator', 'closed', reason);
  scriptOperatorSetButton(false, 'Pop out Script Operator');
}

function syncScriptOperatorSubsystemStatus() {
  const status = _scriptOpHost?.getStatus();
  if (!status) {
    setLiveSubsystemStatus('scriptOperator', 'closed', 'Script Operator window closed');
    return;
  }
  if (status.timedOut) setLiveSubsystemStatus('scriptOperator', 'disconnected', 'Script Operator heartbeat lost');
  else if (status.ready) setLiveSubsystemStatus('scriptOperator', 'ready', 'Script Operator synchronized');
  else if (status.connected) setLiveSubsystemStatus('scriptOperator', 'connecting', 'Applying Script Operator state');
  else setLiveSubsystemStatus('scriptOperator', 'opening', 'Opening Script Operator window');
}

function openScriptOpPopout() {
  const code = (session.code || '').trim();
  if (!code || session.isDemo) { toast('Script Op pop-out needs a live (non-demo) session.'); return; }
  if (_scriptOpWin && !_scriptOpWin.closed) {
    if (!_scriptOpHost) {
      try { _scriptOpWin.close(); } catch {}
      _scriptOpWin = null;
    } else {
      try { _scriptOpWin.focus(); } catch {}
      syncScriptOperatorSubsystemStatus();
      scriptOperatorPublishState(true);
      return _scriptOpWin;
    }
  }
  const identity = scriptOperatorIdentity();
  if (!identity.sessionId) { toast('Start the live prompter session before opening Script Op.'); return; }
  stopScriptOperatorHost({ reason:'Replacing Script Operator host', closeWindow:false, clearWindow:false, notify:false });
  try { startScriptOperatorHost(identity); }
  catch (error) {
    setLiveSubsystemStatus('scriptOperator', 'error', String(error?.message || error));
    containError('Script Operator startup', error);
    toast('Script Operator could not start.');
    return;
  }
  setLiveSubsystemStatus('scriptOperator', 'opening', 'Opening Script Operator window');
  const url = new URL('script-operator.html', location.href);
  url.search = '';
  url.searchParams.set('code', identity.productionCode);
  url.searchParams.set('session', identity.sessionId);
  url.searchParams.set('controller', identity.controllerInstanceId);
  url.searchParams.set('theme', currentTheme);
  url.searchParams.set('launch', Date.now().toString(36));
  const w = Math.min(620, (screen.availWidth || 1280) - 40);
  const h = Math.min(940, (screen.availHeight || 900) - 40);
  _scriptOpWin = window.open(url.toString(), 'cueolaScriptOp_' + code + '_' + SCRIPT_OPERATOR_CONTROLLER_ID, `width=${w},height=${h},menubar=no,toolbar=no,location=no,status=no`);
  if (!_scriptOpWin) {
    stopScriptOperatorHost({ reason:'Popup blocked', closeWindow:false, clearWindow:true, notify:false });
    setLiveSubsystemStatus('scriptOperator', 'error', 'Popup blocked');
    toast('Pop-out blocked — allow pop-ups for Cueola.');
    return;
  }
  const button = document.getElementById('lsPopoutBtn');
  if (button) button.dataset.popupUrl = url.toString();
  setLiveSubsystemStatus('scriptOperator', 'connecting', 'Waiting for Script Operator ready');
  scriptOperatorSetButton(true, 'Focus Script Operator window');
  toast('Script Op opened in a new window — drag it to another monitor.');
  return _scriptOpWin;
}

function dockScriptOpPopout() {
  stopScriptOperatorHost({ reason:'Script Operator window closed', closeWindow:true, clearWindow:true, notify:true });
}

window.addEventListener('pagehide', () => {
  stopScriptOperatorHost({ reason:'Main Cueola window closed', closeWindow:true, clearWindow:true, notify:true });
});

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
  const h = Math.max(120, Math.min(maxH, _scriptHeightDrag.startH + (e.clientY - _scriptHeightDrag.startY)));
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
  return pushed;
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
  ensurePrompterProtocolIdentity({ productionCode:source === 'flowmingo-op' ? flowOpCode : session.code });
  const command = prompterSessionController.buildCommand(action);
  return {
    ...command,
    type:'PROMPTER_COMMAND',
    controlId:command.commandId,
    source,
  };
}

function dispatchPrompterCommand(control, origin='live', quiet=false, codeOverride='') {
  if (!control?.action) return false;
  _postPrompterMessage(control);
  trackPrompterControl(control, origin, quiet);
  const code = String(codeOverride || control.productionCode || session.code || flowOpCode || '').trim().toUpperCase();
  if (window._firebaseReady && code) {
    window._updateDoc(window._doc(window._db, 'sessions', code), {
      'prompter.control': { ...control, sender:FLOWMINGO_ENDPOINT_ID, senderClient:CLIENT_ID },
      'prompter.updatedAt':control.ts,
    }).catch(err => {
      if (origin === 'flowop') flowOpSetStatus(firebaseConnectionLabel(err, 'Send failed'), true);
      else markLivePrompterStatus(firebaseConnectionLabel(err, 'Send failed'), 'error');
    });
  }
  return true;
}

function flushPrompterCommandQueue(outputId) {
  const queued = prompterSessionController.takeQueuedCommands(outputId);
  queued.forEach(control => {
    const origin = control.source === 'flowmingo-op' ? 'flowop' : 'live';
    dispatchPrompterCommand(control, origin, isQuietPrompterControl(control.action), control.productionCode);
  });
  return queued.length;
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
    const pending = _pendingPrompterControls[control.controlId];
    delete _pendingPrompterControls[control.controlId];
    pending?.settle?.({ ok:false, acknowledged:false, error:`Flowmingo talent did not acknowledge ${label.toLowerCase()}` });
    if (origin === 'flowop') flowOpSetStatus(`${label} sent · no talent ack`, true);
    else markLivePrompterStatus('No talent ack', 'busy');
  }, 5000);
  _pendingPrompterControls[control.controlId] = { action:control.action, origin, waitTimer, failTimer };
}

function openPrompterApp() {
  // Preserve where the operator came from — stamping 'entry' here made the
  // Guide's "Open Talent Display" action exit back to the front page instead
  // of the rundown/Live screen it was opened from.
  const cur = sessionStorage.getItem('cueola_screen');
  if (!cur || cur === 'entry') sessionStorage.setItem('cueola_screen', 'entry');
  enterPrompter();
}

function openFlowmingoTalentWindow({ replace=false }={}) {
  if (replace) {
    try { _prompterTalentWin?.close(); } catch {}
    _prompterTalentWin = null;
    clearTimeout(_prompterHandshakeTimer);
    _prompterHandshakeTimer = null;
    lastTalentPingTs = 0;
    _activePrompterOutputInstanceId = '';
    _prompterMissCount = 0;
    _prompterRecoveryAnnounced = false;
  }
  initPrompter(); // make sure this window answers the new tab's pings with the current script
  if (_prompterTalentWin && !_prompterTalentWin.closed) {
    projectPrompterSessionStatus(prompterSessionController.isReady(_activePrompterOutputInstanceId) ? 'ready' : 'connected', 'Flowmingo output window open');
    try { _prompterTalentWin.focus(); } catch {}
    return _prompterTalentWin;
  }
  projectPrompterSessionStatus('opening', 'Opening Flowmingo output');
  const url = new URL(location.href);
  url.searchParams.set('prompter', '1');
  if (session.code) url.searchParams.set('code', session.code);
  url.hash = 'flowmingo';
  _prompterTalentWin = window.open(url.toString(), 'cueola-flowmingo-talent');
  if (!_prompterTalentWin) {
    projectPrompterSessionStatus('error', 'Popup blocked');
    toast('Allow pop-ups to open Flowmingo in a new window.');
    enterPrompter();
  }
  return _prompterTalentWin;
}

function sendPrompterPreviewControl(action) {
  _ensurePrompterOperatorBridge();
  const control = buildPrompterControl(action, 'script-op-preview');
  if (!prompterSessionController.isReady(_activePrompterOutputInstanceId)) return false;
  return dispatchPrompterCommand(control, 'live', true);
}

function sendPrompterControl(action) {
  if (livePrompterOpen && Date.now() < flowmingoRemoteOverrideUntil && !isCollaborativePrompterControl(action)) {
    markLivePrompterStatus('Flowmingo Op has control', 'busy');
    return;
  }
  _ensurePrompterOperatorBridge();
  const control = buildPrompterControl(action, 'script-op');
  if (!prompterSessionController.isReady(_activePrompterOutputInstanceId)) {
    prompterSessionController.queueCommand(control);
    projectPrompterSessionStatus(_activePrompterOutputInstanceId ? 'connected' : 'opening', _activePrompterOutputInstanceId ? 'Waiting for talent to apply state' : 'Waiting for Flowmingo output');
    markLivePrompterStatus(`${flowOpControlLabel(action)} queued`, 'busy');
    return false;
  }
  return dispatchPrompterCommand(control, 'live', isQuietPrompterControl(action));
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
// cueola_* is the storage standard (docs/NAMING.md): read new key, fall back to
// the legacy promptypus_* key once, write only the new key.
let ptThemeName = normalizeCueolaTheme(localStorage.getItem('cueola_prompter_theme') || localStorage.getItem('promptypus_theme') || 'cool');
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
let flowOpSessionRenderFingerprint = '';
let flowOpControlsRenderFingerprint = '';
let flowOpDeferredControlsDisabled = null;
let flowOpControlsRenderCount = 0;
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

const PT_SVG_PLAY  = sfIcon('media.play');
const PT_SVG_PAUSE = sfIcon('media.pause');

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

function ptPostReady(reason='ready') {
  if (_lastAppliedPrompterSnapshotId) {
    ptPostOperatorMessage(prompterSessionController.buildHeartbeat());
    return;
  }
  ensurePrompterProtocolIdentity({ productionCode:ptLinkedCueolaCode || session.code || '' });
  ptPostOperatorMessage(prompterSessionController.buildReady(reason));
  ptPostPing(reason); // Phase 2 compatibility for an older operator tab.
}

// Ping a few times right after connecting so the operator answers fast, instead
// of waiting up to 5s for the next hello cycle.
let ptPingBurstTimers = [];
function ptPingBurst() {
  ptPingBurstTimers.forEach(clearTimeout);
  ptPingBurstTimers = [0, 250, 750, 1500, 3000].map(d => setTimeout(() => ptPostReady('ready'), d));
}

function ptAdoptCueolaBridgeMessage(msg={}) {
  const code = String(msg.productionCode || msg.sessionCode || '').trim().toUpperCase();
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
  if (!prompterSessionController.accepts(msg, { allowLegacy:true })) return;
  // Dedup: each message is sent over BroadcastChannel AND localStorage, so it
  // arrives twice. Skip repeats by id instead of dropping by timestamp (which
  // broke across devices with skewed clocks and re-applied relative controls).
  const mid = msg.mid || `${msg.sender || ''}-${msg.ts || 0}-${msg.type || ''}`;
  if (_seenPrompterMsgIds.includes(mid)) return;
  _seenPrompterMsgIds.push(mid);
  if (_seenPrompterMsgIds.length > 120) _seenPrompterMsgIds = _seenPrompterMsgIds.slice(-60);
  if (msg.type === 'PROMPTER_STATE') {
    applyCompletePrompterState(msg);
    return;
  }
  if (msg.type === 'PROMPTER_COMMAND' && msg.action) {
    applyRemoteControlOnce(msg.action, msg.ts, msg.sender, msg.commandId || msg.controlId);
    return;
  }
  if (msg.type === 'cueola_hello') {
    ptAdoptCueolaBridgeMessage(msg);
    ptPostPing('ready');
    ptUpdateSyncLabel();
  }
  if (msg.type === 'script_init' && msg.text != null) {
    ptAdoptCueolaBridgeMessage(msg);
    adoptPrompterText(msg.text || '', { version:Number(msg.version)||0, updatedAt:Number(msg.ts)||0, source:msg.source || 'bridge' });
    if (prompterText !== ptLastCueolaScript) {
      const hadScript = ptHasScript();
      ptLastCueolaScript = prompterText;
      if (hadScript) ptUpdateFromCueola(prompterText);
      else ptInitScriptFromCueola(prompterText);
    }
    ptPostPing();
  }
  if (msg.type === 'script_update' && msg.text != null) {
    ptAdoptCueolaBridgeMessage(msg);
    adoptPrompterText(msg.text || '', { version:Number(msg.version)||0, updatedAt:Number(msg.ts)||0, source:msg.source || 'bridge' });
    if (prompterText !== ptLastCueolaScript) {
      ptLastCueolaScript = prompterText;
      ptUpdateFromCueola(prompterText);
    }
  }
  if (msg.type === 'prompter_control' && msg.action) {
    applyRemoteControlOnce(msg.action, msg.ts, msg.sender, msg.controlId);
  }
}

function ptLoadSavedOrDefault() {
  const textEl = ptEl('pt-text');
  if (!textEl || textEl.textContent.trim()) return;
  const saved = (() => { try { return localStorage.getItem('cueola_prompter_script_html') || localStorage.getItem('promptypus_script_html'); } catch { return null; } })();
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

// Talent heartbeat: a state-bearing ping every two seconds so the operator can
// tell whether the renderer is responsive and recover one complete state.
// whether the talent screen is alive (BroadcastChannel for same browser,
// Firestore prompter.talentHeartbeat for cross-device).
let ptHeartbeatInterval = null;
function ptTalentHeartbeat() {
  // Publish "talent online" only while the talent screen is actually up —
  // otherwise operators see a phantom talent long after this tab left the screen.
  if (!document.getElementById('promptypus')?.classList.contains('on')) return;
  currentPrompterSessionState();
  const heartbeat = ptPostOperatorMessage(prompterSessionController.buildHeartbeat());
  ptPostPing('heartbeat'); // compatibility for older operator tabs
  if (window._firebaseReady && ptLinkedCueolaCode && window._updateDoc && window._doc && window._db) {
    try {
      window._updateDoc(window._doc(window._db, 'sessions', ptLinkedCueolaCode), {
        'prompter.talentHeartbeat': {
          ts:Date.now(), sender:FLOWMINGO_ENDPOINT_ID, senderClient:CLIENT_ID,
          senderInstanceId:FLOWMINGO_ENDPOINT_ID,
          outputInstanceId:FLOWMINGO_ENDPOINT_ID,
          protocolVersion:heartbeat.protocolVersion,
          sessionId:heartbeat.sessionId,
          productionCode:heartbeat.productionCode,
          snapshotId:heartbeat.snapshotId || '',
          state:heartbeat.state,
        }
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
  if (!ptHeartbeatInterval) ptHeartbeatInterval = setInterval(ptTalentHeartbeat, PROMPTER_HEARTBEAT_MS);
}

function stopPrompterTalentRuntime() {
  ptStopPlay();
  clearInterval(ptHeartbeatInterval);
  ptHeartbeatInterval = null;
  ptPingBurstTimers.forEach(clearTimeout);
  ptPingBurstTimers = [];
  ptReceiverChannels.forEach(channel => { try { channel.close(); } catch {} });
  ptReceiverChannels = [];
  if (ptReceiverStorageHandler) window.removeEventListener('storage', ptReceiverStorageHandler);
  ptReceiverStorageHandler = null;
  if (ptCueolaSub) { try { ptCueolaSub(); } catch {} ptCueolaSub = null; }
  if (ptKeydownHandler) document.removeEventListener('keydown', ptKeydownHandler);
  if (ptKeyupHandler) document.removeEventListener('keyup', ptKeyupHandler);
  ptKeydownHandler = null;
  ptKeyupHandler = null;
  clearTimeout(ptIdleTimer);
  ptIdleTimer = null;
  clearInterval(ptClockInterval);
  ptClockInterval = null;
  _seenPrompterMsgIds = [];
  _lastAppliedPrompterSnapshotId = '';
  prompterSessionController.setStatus('closed');
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
  ['pt-play-btn', 'po-play-btn', 'lsq-play-btn'].forEach(id => {
    const btn = document.getElementById(id);
    if (!btn) return;
    patchPrompterPlayButton(btn, isPlaying);
  });
  if (icon) icon.dataset.symbol = isPlaying ? 'media.pause' : 'media.play';
}

function patchPrompterPlayButton(btn, isPlaying) {
  if (!btn) return;
  const playIcon = btn.querySelector('[data-prompter-play-icon="play"]');
  const pauseIcon = btn.querySelector('[data-prompter-play-icon="pause"]');
  const label = btn.querySelector('[data-prompter-play-label]');
  if (playIcon && pauseIcon && label) {
    playIcon.hidden = Boolean(isPlaying);
    pauseIcon.hidden = !isPlaying;
    label.textContent = isPlaying ? 'PAUSE' : 'PLAY';
  } else {
    // Talent and older overlay markup do not carry the mount-once hooks.
    btn.innerHTML = `${isPlaying ? PT_SVG_PAUSE : PT_SVG_PLAY} ${isPlaying ? 'PAUSE' : 'PLAY'}`;
  }
  btn.classList.toggle('active', isPlaying);
  btn.setAttribute('aria-pressed', isPlaying ? 'true' : 'false');
  if (btn.hasAttribute('data-prompter-play')) {
    btn.setAttribute('onclick', `sendPrompterControl('${isPlaying ? 'pause' : 'resume'}')`);
  }
}

function promptOpControlsHTML(includeLiveActions = true) {
  const playAction = ptPlaying ? 'pause' : 'resume';
  const playLabel = ptPlaying ? 'PAUSE' : 'PLAY';
  const scope = includeLiveActions ? 'po' : 'lsq';
  const transport = `<div class="flow-control-section flow-control-transport">
      <div class="flow-control-title">Transport</div>
      <div class="flow-control-grid one">
        <button class="pt-btn${ptPlaying?' active':''}" id="${scope}-play-btn" data-prompter-play data-prompter-scope="${scope}" onclick="sendPrompterControl('${playAction}')" aria-pressed="${ptPlaying ? 'true' : 'false'}"><span class="sf-symbol" data-symbol="media.play" data-prompter-play-icon="play" aria-hidden="true"${ptPlaying ? ' hidden' : ''}></span><span class="sf-symbol" data-symbol="media.pause" data-prompter-play-icon="pause" aria-hidden="true"${ptPlaying ? '' : ' hidden'}></span><span data-prompter-play-label>${playLabel}</span></button>
      </div>
      <div class="flow-control-grid four">
        <button class="pt-btn" onpointerdown="sendPrompterControl('brake_start')" onpointerup="sendPrompterControl('brake_stop')" onpointerleave="sendPrompterControl('brake_stop')" onpointercancel="sendPrompterControl('brake_stop')" onlostpointercapture="sendPrompterControl('brake_stop')">Brake</button>
        <button class="pt-btn" onpointerdown="sendPrompterControl('boost_start')" onpointerup="sendPrompterControl('boost_stop')" onpointerleave="sendPrompterControl('boost_stop')" onpointercancel="sendPrompterControl('boost_stop')" onlostpointercapture="sendPrompterControl('boost_stop')">Boost</button>
        <button class="pt-btn" onclick="sendPrompterControl('direction_reverse')">Reverse</button>
        <button class="pt-btn" onclick="sendPrompterControl('direction_forward')">Forward</button>
      </div>
    </div>`;
  const display = `<div class="flow-control-section flow-control-display">
      <div class="flow-control-title">Display</div>
      <div class="pt-ctrl-group flow-control-slider">
        <span class="pt-ctrl-label">Speed</span>
      <button class="pt-btn" onclick="sendPrompterControl('speed_down')">−</button>
      <input type="range" class="pt-range" id="${scope}-speed-range" data-prompter-speed min="5" max="200" value="${ptTargetSpeed}" onpointerdown="this.dataset.controlDragging='1'" onpointerup="this.dataset.controlDragging=''" onpointercancel="this.dataset.controlDragging=''" onlostpointercapture="this.dataset.controlDragging=''" oninput="ptSetSpeed(this.value);sendPrompterPreviewControl('speed_set_'+this.value)" onchange="sendPrompterControl('speed_set_'+this.value);this.dataset.controlDragging=''">
      <button class="pt-btn" onclick="sendPrompterControl('speed_up')">+</button>
      </div>
      <div class="pt-ctrl-group flow-control-slider">
        <span class="pt-ctrl-label">Size</span>
      <button class="pt-btn" onclick="sendPrompterControl('size_down')">−</button>
      <input type="range" class="pt-range" id="${scope}-size-range" data-prompter-size min="24" max="120" value="${ptFontSize}" onpointerdown="this.dataset.controlDragging='1'" onpointerup="this.dataset.controlDragging=''" onpointercancel="this.dataset.controlDragging=''" onlostpointercapture="this.dataset.controlDragging=''" oninput="ptSetSize(this.value);sendPrompterPreviewControl('size_set_'+this.value)" onchange="sendPrompterControl('size_set_'+this.value);this.dataset.controlDragging=''">
      <button class="pt-btn" onclick="sendPrompterControl('size_up')">+</button>
      </div>
      <div class="pt-ctrl-group flow-control-segment">
        <span class="pt-ctrl-label">Align</span>
        <button class="pt-btn${ptAlign==='left'?' active':''}" data-prompter-align="left" onclick="sendPrompterControl('align_left')" aria-label="Align left" aria-pressed="${ptAlign === 'left' ? 'true' : 'false'}">Left</button>
        <button class="pt-btn${ptAlign==='center'?' active':''}" data-prompter-align="center" onclick="sendPrompterControl('align_center')" aria-label="Align center" aria-pressed="${ptAlign === 'center' ? 'true' : 'false'}">Center</button>
        <button class="pt-btn${ptAlign==='right'?' active':''}" data-prompter-align="right" onclick="sendPrompterControl('align_right')" aria-label="Align right" aria-pressed="${ptAlign === 'right' ? 'true' : 'false'}">Right</button>
      </div>
    </div>`;
  const theme = `<div class="flow-control-section flow-theme-section">
      <div class="flow-control-title">Theme</div>
      <div class="pt-ctrl-group flow-theme-grid ui-theme-grid">
        ${CUEOLA_THEMES.map(name => `<button type="button" class="ui-theme-tile pt-theme-dot${ptThemeName===name?' on active':''}" data-prompter-theme="${name}" onclick="sendPrompterControl('theme_${name}')" title="${CUEOLA_THEME_LABELS[name] || name}" aria-label="${CUEOLA_THEME_LABELS[name] || name}"><span class="tt-prev" style="background:${CUEOLA_THEME_SWATCHES[name]}"></span><span class="tt-name">${CUEOLA_THEME_LABELS[name] || name}</span></button>`).join('')}
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
  if (ptPlaying && ptAnimFrame) return;
  ptPlaying = true;
  ptLastTime = null;
  prompterSessionController.setTransport({ running:true, position:ptOffset, targetSpeed:ptTargetSpeed, effectiveSpeed:ptLiveSpeed, status:'running' });
  ptSyncPlayIcons(true);
  ptAnimFrame = requestAnimationFrame(ptScrollLoop);
}

function ptStopPlay() {
  ptPlaying = false;
  if (ptAnimFrame) cancelAnimationFrame(ptAnimFrame);
  ptAnimFrame = null;
  prompterSessionController.setTransport({ running:false, position:ptOffset, targetSpeed:ptTargetSpeed, effectiveSpeed:ptLiveSpeed, status:'paused' });
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
  if (!Number.isFinite(n) || n < 1) return Promise.resolve(false);
  return new Promise(resolve => requestAnimationFrame(() => {
    const text = ptEl('pt-text');
    const track = ptEl('pt-track');
    if (!text || !track) { resolve(false); return; }
    const tag = `[${n}]`;
    const headers = Array.from(text.querySelectorAll('.scr-header'));
    const target = headers.find(h => String(h.textContent || '').trim().startsWith(tag));
    if (!target) { resolve(false); return; }
    const readY = window.innerHeight / 2 + 24;
    const fontSize = parseFloat(getComputedStyle(target).fontSize) || 22;
    const targetY = readY - Math.max(34, fontSize * 1.8);
    const delta = target.getBoundingClientRect().top - targetY;
    ptApplyScrollOffset(ptOffset + delta);
    resolve(true);
  }));
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

function patchIconLabelButton(button, symbol, label) {
  if (!button) return;
  const icon = button.querySelector('.sf-symbol');
  const text = Array.from(button.children).find(child => child.tagName === 'SPAN' && !child.classList.contains('sf-symbol'));
  if (!icon || !text) {
    setSymbolButtonLabel(button, symbol, label);
    return;
  }
  icon.setAttribute('data-symbol', symbol);
  text.textContent = label;
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
    patchIconLabelButton(b, 'state.warning', techOn ? 'Back on air' : 'Tech Difficulty');
    b.classList.toggle('active', techOn);
    b.classList.toggle('muted', anyOn && !techOn);
    b.setAttribute('aria-pressed', techOn ? 'true' : 'false');
  });
  ['lsq-bars-btn', 'po-bars-btn', 'flow-bars-btn'].forEach(id => {
    const b = document.getElementById(id);
    if (!b) return;
    const isFlow = id.startsWith('flow');
    const barsOn = isFlow ? flowOpColorBarsOn : ptColorBarsOn;
    const anyOn = isFlow ? flowSlateOn : talentSlateOn;
    patchIconLabelButton(b, 'content.display', barsOn ? 'Back on air' : 'NTSC Bars');
    b.classList.toggle('active', barsOn);
    b.classList.toggle('muted', anyOn && !barsOn);
    b.setAttribute('aria-pressed', barsOn ? 'true' : 'false');
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
    let i = liveActiveCueIndex();
    do { i++; } while (i < beats.length && beats[i]?.style === 'segment');
    return i < beats.length ? i : -1;
  })();
  const rowCue = isFlow ? '' : `<div class="flow-control-section flow-control-rowcue">
      <div class="flow-control-title">Cue</div>
      <div class="pt-ctrl-group pt-live-rowcue flow-control-grid two">
        <button class="pt-btn" data-script-op-cue="now" onclick="sendPrompterControl('seek_row_${Math.max(liveActiveCueIndex(), 0) + 1}')" title="Cue Flowmingo to the current rundown row"${dis}>${sfIcon('marker.active')}<span>Cue Now</span></button>
        <button class="pt-btn" data-script-op-cue="next" onclick="sendPrompterControl('seek_row_${nextRowIdx + 1}')" title="Cue Flowmingo to the next rundown row"${nextRowIdx < 0 || disabled ? ' disabled' : ''}>${sfIcon('action.forward')}<span>Cue Next</span></button>
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
  try { localStorage.setItem('cueola_prompter_theme', name); } catch {}
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
  try { localStorage.setItem('cueola_prompter_script_html', el.innerHTML); } catch {}
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
  try { localStorage.setItem('cueola_prompter_script_html', scriptToFormattedHTML(text || '')); } catch {}
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
  await ptLoadLibrary('assets/vendor/pdf.min.js');
  pdfjsLib.GlobalWorkerOptions.workerSrc = 'assets/vendor/pdf.worker.min.js';
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
  await ptLoadLibrary('assets/vendor/mammoth.browser.min.js');
  const result = await mammoth.convertToHtml({ arrayBuffer });
  return result.value.replace(/<p>\s*<\/p>/g, '<p> </p>');
}

async function ptExtractFromPages(arrayBuffer) {
  await ptLoadLibrary('assets/vendor/jszip.min.js');
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
  await ptLoadLibrary('assets/vendor/jspdf.umd.min.js');
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
  downloadBlobFile(doc.output('blob'), 'flowmingo-script.pdf');
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
  const protocol = currentPrompterSessionState();
  return {
    ...protocol,
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
    let mini = el.querySelector('[data-clock-preview-mini]');
    if (!mini) {
      mini = document.createElement('div');
      mini.setAttribute('data-clock-preview-mini', '');
      const labelEl = document.createElement('span');
      labelEl.setAttribute('data-clock-preview-label', '');
      const valueEl = document.createElement('strong');
      valueEl.setAttribute('data-clock-preview-value', '');
      const questionEl = document.createElement('em');
      questionEl.setAttribute('data-clock-preview-question', '');
      questionEl.textContent = 'Question in chat';
      mini.append(labelEl, valueEl, questionEl);
      el.replaceChildren(mini);
    }
    const state = ptClockState || {};
    const clockOn = state.mode && state.mode !== 'off';
    const left = (Number(state.targetTs) || 0) - Date.now();
    const value = !clockOn ? 'Off'
      : state.mode === 'timeofday' ? formatTimeOfDay()
        : fmtClockOverlay(left, state.mode !== 'wrap');
    const label = !clockOn ? 'Clock' : (state.label || 'Clock');
    el.classList.toggle('off', !clockOn);
    mini.className = `flowop-clock-mini ${state.mode || 'off'}`;
    mini.classList.toggle('expired', Boolean(clockOn && state.mode !== 'timeofday' && left <= 0));
    const labelEl = mini.querySelector('[data-clock-preview-label]');
    const valueEl = mini.querySelector('[data-clock-preview-value]');
    const questionEl = mini.querySelector('[data-clock-preview-question]');
    if (labelEl) labelEl.textContent = label;
    if (valueEl) valueEl.textContent = value;
    if (questionEl) questionEl.hidden = !ptQuestionOn;
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
  if (action.startsWith('seek_row_')) {
    ptSeekToRow(action.replace('seek_row_', '')).then(() => {
      prompterSessionController.setTransport({ running:ptPlaying, position:ptOffset, targetSpeed:ptTargetSpeed, effectiveSpeed:ptLiveSpeed, lastCommandId:controlId, status:ptPlaying ? 'running' : 'paused' });
      ptPostControlAck(controlId, action, ts, sender);
    });
    return true;
  }
  ptHandleRemoteControl(action);
  prompterSessionController.setTransport({ running:ptPlaying, position:ptOffset, targetSpeed:ptTargetSpeed, effectiveSpeed:ptLiveSpeed, lastCommandId:controlId, status:ptPlaying ? 'running' : 'paused' });
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
  try { localStorage.setItem('cueola_prompter_theme', name); } catch {}
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
  if (flowOpCode) flowOpRenderControls(false);
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
  const btn = (symbol, label, onclick, active=false, className='', attrs='') =>
    `<button class="pt-btn${className ? ` ${className}` : ''}${active ? ' active' : ''}" onclick="${onclick}" aria-pressed="${active ? 'true' : 'false'}"${attrs ? ` ${attrs}` : ''}${dis}>${sfIcon(symbol)}<span>${label}</span></button>`;
  return `<div class="flow-clock-stack">
    <div class="flow-clock-preview" id="${scope === 'flow' ? 'flowOpClockPreview' : `${scope}ClockPreview`}"></div>
    <div class="flow-control-section flow-clock-section">
      <div class="flow-control-title">Clock</div>
      <div class="flow-clock-grid flow-clock-modes flow-control-grid four">
        ${btn('state.timed', 'Time', send('clock_timeofday'), mode === 'timeofday', '', 'data-clock-mode="timeofday"')}
        ${btn('state.timed', 'Duration', `sendDurationClock('${scope}')`, mode === 'duration', '', 'data-clock-mode="duration"')}
        ${btn('time.clock', 'To Time', `sendCountdownClock('${scope}')`, mode === 'countdown', '', 'data-clock-mode="countdown"')}
        ${btn('media.stop', 'Hide', send('clock_off'), false, '', 'data-clock-mode="off"')}
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
        ${btn(questionOn ? 'notification.unread' : 'notification.default', questionOn ? 'Clear question' : 'Question', `toggleQuestionIndicator('${scope}')`, questionOn, 'pt-question-btn', 'data-clock-question')}
      </div>
      <div class="ui-row" style="border:0">
        <span class="ui-row-lbl">Overlay size</span>
        <div class="ui-stepper">
          <button type="button" class="ui-step-btn" onclick="${send('clock_size_down')}" aria-label="Overlay smaller"${dis}>−</button>
          <span class="ui-step-val" data-clock-size>${['S','M','L','XL','MAX'][Math.max(0, Math.min(4, state?.size ?? 1))]}</span>
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
        <button class="pt-btn" onpointerdown="flowOpSendControl('brake_start')" onpointerup="flowOpSendControl('brake_stop')" onpointerleave="flowOpSendControl('brake_stop')" onpointercancel="flowOpSendControl('brake_stop')" onlostpointercapture="flowOpSendControl('brake_stop')"${dis}>Brake</button>
        <button class="pt-btn" onpointerdown="flowOpSendControl('boost_start')" onpointerup="flowOpSendControl('boost_stop')" onpointerleave="flowOpSendControl('boost_stop')" onpointercancel="flowOpSendControl('boost_stop')" onlostpointercapture="flowOpSendControl('boost_stop')"${dis}>Boost</button>
        <button class="pt-btn" onclick="flowOpSendControl('direction_reverse')"${dis}>Reverse</button>
        <button class="pt-btn" onclick="flowOpSendControl('direction_forward')"${dis}>Forward</button>
      </div>
    </div>`;
  const display = `<div class="flow-control-section flow-control-display">
      <div class="flow-control-title">Display</div>
      <div class="pt-ctrl-group flow-control-slider">
        <span class="pt-ctrl-label">Speed</span>
        <button class="pt-btn" onclick="flowOpSendControl('speed_down')"${dis}>−</button>
        <input type="range" class="pt-range" id="flowOpSpeedRange" min="5" max="200" value="${ptTargetSpeed}" onpointerdown="this.dataset.controlDragging='1'" onpointerup="this.dataset.controlDragging=''" onpointercancel="this.dataset.controlDragging=''" oninput="flowOpApplyControlPreview('speed_set_'+this.value,true)" onchange="flowOpSendControl('speed_set_'+this.value,true);this.dataset.controlDragging=''"${dis}>
        <button class="pt-btn" onclick="flowOpSendControl('speed_up')"${dis}>+</button>
      </div>
      <div class="pt-ctrl-group flow-control-slider">
        <span class="pt-ctrl-label">Size</span>
        <button class="pt-btn" onclick="flowOpSendControl('size_down')"${dis}>−</button>
        <input type="range" class="pt-range" id="flowOpSizeRange" min="24" max="120" value="${ptFontSize}" onpointerdown="this.dataset.controlDragging='1'" onpointerup="this.dataset.controlDragging=''" onpointercancel="this.dataset.controlDragging=''" oninput="flowOpApplyControlPreview('size_set_'+this.value,true)" onchange="flowOpSendControl('size_set_'+this.value,true);this.dataset.controlDragging=''"${dis}>
        <button class="pt-btn" onclick="flowOpSendControl('size_up')"${dis}>+</button>
      </div>
      <div class="pt-ctrl-group flow-control-segment">
        <span class="pt-ctrl-label">Align</span>
        <button class="pt-btn${ptAlign==='left'?' active':''}" data-flowop-align="left" onclick="flowOpSendControl('align_left')" aria-label="Align left"${dis}>Left</button>
        <button class="pt-btn${ptAlign==='center'?' active':''}" data-flowop-align="center" onclick="flowOpSendControl('align_center')" aria-label="Align center"${dis}>Center</button>
        <button class="pt-btn${ptAlign==='right'?' active':''}" data-flowop-align="right" onclick="flowOpSendControl('align_right')" aria-label="Align right"${dis}>Right</button>
      </div>
    </div>`;
  const theme = `<div class="flow-control-section flow-theme-section">
      <div class="flow-control-title">Theme</div>
      <div class="pt-ctrl-group flow-theme-grid ui-theme-grid">
        ${CUEOLA_THEMES.map(name => `<button type="button" class="ui-theme-tile flowop-theme-dot${ptThemeName===name?' on active':''}" data-flowop-theme="${name}" onclick="flowOpSendControl('theme_${name}')" title="${CUEOLA_THEME_LABELS[name] || name}" aria-label="${CUEOLA_THEME_LABELS[name] || name}"${dis}><span class="tt-prev" style="background:${CUEOLA_THEME_SWATCHES[name]}"></span><span class="tt-name">${CUEOLA_THEME_LABELS[name] || name}</span></button>`).join('')}
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
  if (!el) return false;
  const fingerprint = stableStringify({
    disabled:Boolean(disabled),
    question:flowOpQuestionOn,
    clockMode:flowOpClockState?.mode || 'off',
    clockSize:flowOpClockState?.size ?? 1,
  });
  if (fingerprint === flowOpControlsRenderFingerprint) {
    flowOpSyncControls();
    return false;
  }
  // A focused control owns its DOM until blur. This protects keyboard focus,
  // typed clock values, and a range thumb that is currently being dragged.
  if (el.contains(document.activeElement)) {
    flowOpDeferredControlsDisabled = disabled;
    el.onfocusout = () => queueMicrotask(() => {
      if (!el.contains(document.activeElement) && flowOpDeferredControlsDisabled !== null) {
        const pending = flowOpDeferredControlsDisabled;
        flowOpDeferredControlsDisabled = null;
        flowOpRenderControls(pending);
      }
    });
    flowOpSyncControls();
    return false;
  }
  el.innerHTML = flowOpControlsHTML(disabled);
  flowOpControlsRenderFingerprint = fingerprint;
  flowOpControlsRenderCount += 1;
  el.dataset.renderCount = String(flowOpControlsRenderCount);
  opInspRestoreTab('flow');   // keep the remembered inspector tab active across re-renders
  flowOpSyncControls();
  return true;
}

function flowOpSyncControls() {
  const playBtn = flowOpEl('flowOpPlayBtn');
  if (playBtn) {
    playBtn.innerHTML = `${flowOpPlaying ? PT_SVG_PAUSE : PT_SVG_PLAY} ${flowOpPlaying ? 'PAUSE' : 'PLAY'}`;
    playBtn.classList.toggle('active', flowOpPlaying);
    playBtn.setAttribute('onclick', `flowOpSendControl('${flowOpPlaying ? 'pause' : 'resume'}')`);
  }
  const speed = flowOpEl('flowOpSpeedRange');
  if (speed && document.activeElement !== speed && !speed.dataset.controlDragging) speed.value = ptTargetSpeed;
  const size = flowOpEl('flowOpSizeRange');
  if (size && document.activeElement !== size && !size.dataset.controlDragging) size.value = ptFontSize;
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
  const fingerprint = data ? stableStringify({
    showName:data.show?.name || data.showName || data.name || '',
    beats:Array.isArray(data.beats) ? data.beats : [],
    prompterText:typeof data.prompter?.text === 'string' ? data.prompter.text : null,
    activeIdx:data.prompter?.activeIdx,
    currentRow:data.prompter?.currentRow || null,
    nextRow:data.prompter?.nextRow || null,
  }) : 'empty';
  if (fingerprint === flowOpSessionRenderFingerprint) return false;
  flowOpSessionRenderFingerprint = fingerprint;
  if (!data) {
    if (titleEl) titleEl.textContent = 'Flowmingo Op';
    if (meta) meta.innerHTML = `<div class="flowop-session-title">No session loaded</div><div class="flowop-note">Enter the same code used on the talent Flowmingo screen.</div>`;
    if (preview) preview.innerHTML = `<div class="flowop-empty">Load a session code to control Flowmingo remotely.</div>`;
    return true;
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
  return true;
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
  flowOpSessionRenderFingerprint = '';
  flowOpControlsRenderFingerprint = '';
  flowOpDeferredControlsDisabled = null;
  flowOpRenderControls(true);
  flowOpSetStatus('Loading...');
  _prompterOperatorRuntimeActive = true;
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
        ensurePrompterProtocolIdentity({ productionCode:code, sessionId:flowOpData.prompter?.sessionId || '' });
        if (flowOpData.prompter?.state) {
          prompterSessionController.update(flowOpData.prompter.state, { preserveVersion:true });
        }
        flowOpRenderSession(flowOpData);
        flowOpRenderControls(false);
        const heartbeat = flowOpData.prompter?.talentHeartbeat;
        const talentOnline = heartbeat?.ts && !isPrompterSelfSender(heartbeat.sender) && (Date.now() - heartbeat.ts) < 20000;
        if (talentOnline) {
          _handlePrompterOperatorMessage({ type:'PROMPTER_HEARTBEAT', ...heartbeat });
          const status = prompterSessionController.getState().status;
          flowOpSetStatus(`${prompterStatusLabel(status).toUpperCase()} · ${code} · talent online`);
        } else {
          flowOpSetStatus(`OPENING · ${code} · waiting for talent`);
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
  if (!document.getElementById('liveshow')?.classList.contains('on')) stopPrompterOperatorRuntime();
}

function flowOpSendControl(action, quiet=false) {
  if (!flowOpCode) {
    flowOpSetStatus('Load a session first', true);
    flowOpEl('flowOpCodeInput')?.focus();
    return;
  }
  _ensurePrompterOperatorBridge(true);
  const control = buildPrompterControl(action, 'flowmingo-op');
  if (!prompterSessionController.isReady(_activePrompterOutputInstanceId)) {
    prompterSessionController.queueCommand(control);
    flowOpSetStatus(`${flowOpControlLabel(action)} queued · waiting for talent`);
    return false;
  }
  return dispatchPrompterCommand(control, 'flowop', quiet, flowOpCode);
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
    if (isInteractiveEventTarget(e)) return;
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
        ensurePrompterProtocolIdentity({ productionCode:code });
        ptConnState = 'connected';
        ptConnMessage = '';
        const stateMessage = data.prompter?.stateMessage;
        if (stateMessage?.type === 'PROMPTER_STATE') applyCompletePrompterState(stateMessage);
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
            // A protocol snapshot can win the READY handshake before the
            // Firestore listener delivers its initial cached/server snapshot.
            // In that ordering the renderer is already positioned (and a
            // queued recovery command may already be running), so treating the
            // cloud callback as a fresh load would call ptResetScroll() and
            // stop playback again. Only the first source in a renderer with no
            // applied protocol state is allowed to reset to the top.
            if (firstApply && !_lastAppliedPrompterSnapshotId) ptSetScriptText(text);
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
        if (control?.action && !isPrompterSelfSender(control.sender)
            && prompterSessionController.accepts(control, { allowLegacy:true })) {
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
    if (isInteractiveEventTarget(e)) return;
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

  // One pointer model for mouse, trackpad, pen, and touch. Interactive controls
  // own their gestures; only the bare talent stage can toggle or change speed.
  const stage = ptEl('pt-stage');
  if (stage && !stage._ptPointer) {
    stage._ptPointer = true;
    let pointerId = null, startY = 0, startedAt = 0, dragged = false;
    const release = (e, allowTap=false) => {
      if (pointerId == null || (e?.pointerId != null && e.pointerId !== pointerId)) return;
      const dy = Number(e?.clientY || startY) - startY;
      const tap = allowTap && !dragged && Date.now() - startedAt < 350 && Math.abs(dy) < 18;
      try { if (stage.hasPointerCapture(pointerId)) stage.releasePointerCapture(pointerId); } catch {}
      pointerId = null;
      dragged = false;
      ptBraking = false;
      ptBoosting = false;
      if (tap) ptTogglePlay();
    };
    stage.addEventListener('pointerdown', e => {
      if (!e.isPrimary || isInteractiveTarget(e.target)) return;
      pointerId = e.pointerId;
      startY = e.clientY;
      startedAt = Date.now();
      dragged = false;
      try { stage.setPointerCapture(pointerId); } catch {}
      e.preventDefault();
    });
    stage.addEventListener('pointermove', e => {
      if (e.pointerId !== pointerId) return;
      const dy = e.clientY - startY;
      if (dy > 20) { ptBraking = true; ptBoosting = false; dragged = true; }
      else if (dy < -20) { ptBoosting = true; ptBraking = false; ptLiveSpeed = Math.min(ptTargetSpeed * 2.5, 300); dragged = true; }
      else { ptBraking = false; ptBoosting = false; }
      e.preventDefault();
    });
    stage.addEventListener('pointerup', e => release(e, true));
    stage.addEventListener('pointercancel', e => release(e, false));
    stage.addEventListener('lostpointercapture', e => release(e, false));
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
  stopPrompterTalentRuntime();
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
    body.innerHTML = '<div class="empty-rundown"><div class="empty-rundown-title">No cues in rundown</div><div class="empty-rundown-sub">Build rows in the Rundown tab, then run the show from here.</div></div>';
    return;
  }
  const activeIdx = liveActiveCueIndex();
  const cur  = beats[activeIdx] || null;
  const next = beats[activeIdx + 1] || null;
  const sd   = cur?.cues?.script;
  const script = cleanPrompterText((prompterText && prompterText.trim()) || scriptCueText(sd));
  body.innerHTML = `<div class="prompt-op-stage" tabindex="0" aria-label="Flowmingo operator controls">
    <div class="prompt-op-info">Now · ${esc(cur?.info || '—')} · Row ${activeIdx + 1} of ${beats.length}${next ? ` · Next: ${esc(next.info || '—')}` : ''}</div>
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
  _clockRanThisLoad = true;
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

// The wall clock previously only ticked inside the show-clock interval, so it
// sat frozen (or "—") until Start Show was pressed. Time of day must run the
// whole time the live screen is up (owner directive 2026-07-20).
let wallClockInterval = null;
function startWallClock() {
  clearInterval(wallClockInterval);
  wallClockInterval = setInterval(updateWallClock, 1000);
  updateWallClock();
}
function stopWallClock() {
  clearInterval(wallClockInterval);
  wallClockInterval = null;
}

function stopTimer(stopPrompter=true) {
  clearInterval(timerInterval); timerInterval=null;
  liveTimerStartMs = null;
  liveClockRunning = false;
  updateLiveClockButton();
  if (!stopPrompter) return;
  stopPrompterOperatorRuntime();
}

// ─────────────────────────────────────────────────────────────
// SETTINGS & THEME
// ─────────────────────────────────────────────────────────────
function applyTheme(t) {
  const root = document.documentElement;
  root.classList.add('theme-switching');
  root.setAttribute('data-theme', normalizeCueolaTheme(t));
  requestAnimationFrame(() => requestAnimationFrame(() => root.classList.remove('theme-switching')));
  scriptOperatorPublishState();
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
// ── v2.1 D6: per-session paperwork config (sparse override map on the parent
// session doc's prePro — identifier-safe underscore keys, MISSING = ENABLED,
// so new paperwork types appear by default with zero migration). Disabling
// hides everywhere but never deletes; re-enable restores everything.
function paperworkConfigKey(itemId) { return String(itemId || '').replace(/-/g, '_'); }
function paperworkEnabledMapLive() {
  // SESSION-LEVEL: the parent session doc wins (grouped clients still read the
  // parent — the groups phase re-verifies this); local prePro is the fallback
  // for solo/offline workspaces.
  const parent = sessionSnapshotLatestDoc?.prePro?.paperworkEnabled;
  if (parent && typeof parent === 'object') return parent;
  const local = loadPreProData()?.paperworkEnabled;
  return (local && typeof local === 'object') ? local : {};
}
function paperworkTypeEnabled(itemId) {
  if (itemId === 'production-notes') return true;   // exempt from the config (decision 10)
  return paperworkEnabledMapLive()[paperworkConfigKey(itemId)] !== false;
}
function enabledPaperworkItems() {
  return PAPERWORK_ITEMS.filter(item => paperworkTypeEnabled(item.id));
}
// Only-disabled projection for snapshot options — MUST ride inside
// snapshot.options so the export fingerprint changes when the config does.
function disabledPaperworkOptions() {
  const out = {};
  PAPERWORK_ITEMS.forEach(item => {
    if (!paperworkTypeEnabled(item.id)) out[paperworkConfigKey(item.id)] = false;
  });
  return out;
}

// ── v2.1 D6: numbered-section builder — the ONLY source of package section
// numbers, shared by the full package AND every per-item preview. The call
// sheet keeps its document-style header (no printed number) but still owns
// slot 1, so downstream numbers match today's package when nothing is
// disabled and renumber coherently when something is.
const PAPERWORK_PACKAGE_SECTION_ORDER = ['call-sheet', 'production-scheduler', 'safety-plan',
  'assignment-register', 'rundown', 'video-patch', 'audio-comms-patch', 'production-notes'];
function paperworkSectionNumbers(snapshot=null) {
  const disabled = snapshot?.options?.paperwork || null;
  const isOn = id => {
    if (id === 'assignment-register' || id === 'production-notes') return true;
    return disabled ? disabled[paperworkConfigKey(id)] !== false : paperworkTypeEnabled(id);
  };
  const numbers = new Map();
  let n = 0;
  PAPERWORK_PACKAGE_SECTION_ORDER.forEach(id => { if (isOn(id)) numbers.set(id, ++n); });
  return numbers;
}
function paperworkSectionNumber(id, snapshot=null) {
  return paperworkSectionNumbers(snapshot).get(id) || null;
}
function paperSectionTitle(num, title) {
  return num ? `${num}. ${title}` : title;
}

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
let _pbPendingNoteWrites = 0;
let _pbNoteSaveSerial = 0;
let _pbLastNoteSaveError = null;

function pbBeginNoteSave() {
  _pbPendingNoteWrites += 1;
  _pbNoteSaveSerial += 1;
  return _pbNoteSaveSerial;
}

function pbNoteSaveSucceeded(token) {
  if (!_pbLastNoteSaveError || token >= _pbLastNoteSaveError.token) _pbLastNoteSaveError = null;
}

function pbNoteSaveFailed(error, token) {
  if (!_pbLastNoteSaveError || token >= _pbLastNoteSaveError.token) {
    _pbLastNoteSaveError = {
      token,
      code:error?.code || 'failed',
      message:error?.message || String(error || 'Production note save failed.'),
    };
  }
}

function pbEndNoteSave() {
  _pbPendingNoteWrites = Math.max(0, _pbPendingNoteWrites - 1);
}

// ── v2.1 Phase 6 (D2): group workspaces ──────────────────────
// One paperwork subdocument per group at sessions/{code}/groups/{gid}; the
// legacy sync spine reads/writes the group doc instead of the session doc
// when a group is active. Rundown and Live stay SHARED on the parent doc —
// paperwork-per-group, show-per-class.
let activeGroupId = '';

function sessionGroups() {
  const list = sessionSnapshotLatestDoc?.groups;
  return Array.isArray(list)
    ? list.filter(g => g && typeof g.id === 'string' && /^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(g.id))
    : [];
}
function groupsLocked() { return sessionSnapshotLatestDoc?.groupsLocked === true; }
function activeGroupStorageKey() { return `cueola_group_${session.code || 'local'}`; }
function loadActiveGroupId() {
  try { return localStorage.getItem(activeGroupStorageKey()) || ''; } catch { return ''; }
}
function setActiveGroupId(gid) {
  activeGroupId = String(gid || '');
  try {
    if (activeGroupId) localStorage.setItem(activeGroupStorageKey(), activeGroupId);
    else localStorage.removeItem(activeGroupStorageKey());
  } catch {}
}
function groupActive() {
  return Boolean(activeGroupId && sessionGroups().some(g => g.id === activeGroupId));
}
function activeGroupName() {
  const group = sessionGroups().find(g => g.id === activeGroupId);
  return group ? String(group.name || group.id) : '';
}
// THE parameterization point: session doc when ungrouped, group subdoc when
// grouped. Every paperwork read/write flows through here.
function preProDocRef() {
  return groupActive()
    ? window._doc(window._db, 'sessions', session.code, 'groups', activeGroupId)
    : window._doc(window._db, 'sessions', session.code);
}

function preProKey() {
  const base = `cueola_prepro_${session.code || session.userName || 'local'}`;
  return groupActive() ? `${base}__${activeGroupId}` : base;
}

// Per-group inbound listener: feeds mergePreProFromCloud exactly like the main
// listener's prePro branch, but from the active group subdoc.
let _pbGroupUnsub = null;
let _pbGroupSubKey = '';
function pbEnsureGroupSubscription() {
  const wantKey = groupActive() ? `${session.code}/${activeGroupId}` : '';
  if (wantKey === _pbGroupSubKey) return;
  if (_pbGroupUnsub) { try { _pbGroupUnsub(); } catch {} _pbGroupUnsub = null; }
  _pbGroupSubKey = wantKey;
  if (!wantKey || !window._onSnapshot || !window._firebaseReady) return;
  _pbGroupUnsub = window._onSnapshot(preProDocRef(), snap => {
    const d = snap.exists() ? (snap.data() || {}) : {};
    if (d.prePro && typeof d.prePro === 'object') {
      try { mergePreProFromCloud(d.prePro); } catch {}
    }
  }, err => console.warn('group workspace listener failed', err?.code || err));
}

// Switch this device to a group workspace: re-key the local mirror, re-stamp
// presence, resubscribe, and re-hydrate. Students may switch freely until an
// instructor locks groups; instructors/admins always may.
function selectGroup(gid, opts = {}) {
  const groups = sessionGroups();
  if (gid && !groups.some(g => g.id === gid)) { toast('That group no longer exists.'); return false; }
  const isCrew = Boolean(adminSession) || session.role === 'instructor';
  if (!opts.force && !isCrew && groupsLocked() && groupActive() && gid !== activeGroupId) {
    toast('Groups are locked — ask your instructor to move you.');
    return false;
  }
  setActiveGroupId(gid);
  pbEnsureGroupSubscription();
  try { joinPresence(); } catch {}          // re-stamps groupId on the presence entry
  hydratePreProFromFirestore().then(() => {
    try { renderPlandaBearAssignmentsCard(); } catch {}
    try { renderPackageSheetPicker(); } catch {}
  });
  if (!opts.silent) toast(gid ? `Working in ${activeGroupName()}.` : 'Working on the whole-class paperwork.');
  return true;
}

// The hub's group bar: shows where you are; instructors get a switcher
// dropdown for per-group review + export, students a Switch button until
// groups lock. Hidden entirely for ungrouped sessions.
function renderPbGroupBar() {
  const bar = document.getElementById('pbGroupBar');
  if (!bar) return;
  const groups = sessionGroups();
  if (!groups.length) { bar.hidden = true; bar.innerHTML = ''; return; }
  const isCrew = Boolean(adminSession) || session.role === 'instructor';
  bar.hidden = false;
  if (isCrew) {
    bar.innerHTML = `
      <span class="pb-group-bar-label">Reviewing</span>
      <select class="field-in pb-group-select" onchange="selectGroup(this.value) && renderPbGroupBar()">
        ${groups.map(g => `<option value="${esc(g.id)}" ${g.id === activeGroupId ? 'selected' : ''}>${esc(g.name || g.id)}</option>`).join('')}
      </select>
      <span class="pb-group-bar-note">Each group has its own paperwork · exports follow this picker${groupsLocked() ? ' · groups are locked' : ''}</span>`;
  } else {
    bar.innerHTML = `
      <span class="pb-group-bar-label">Your group</span>
      <b>${esc(activeGroupName() || '—')}</b>
      ${groupsLocked() ? '<span class="pb-group-bar-note">Groups are locked</span>'
        : '<button type="button" class="btn-sm btn-ghost" onclick="openGroupPicker()">Switch group</button>'}`;
  }
}

// Group picker: chips modal shown at join (and reopenable from the hub until
// locked). Students must pick; instructors default to reviewing Group 1.
function openGroupPicker() {
  const groups = sessionGroups();
  if (!groups.length) return;
  const host = document.getElementById('groupPickerChips');
  if (!host) return;
  host.innerHTML = groups.map(g => `
    <button type="button" class="group-chip${g.id === activeGroupId ? ' sel' : ''}" onclick="pickGroupChip('${esc(g.id)}')">${esc(g.name || g.id)}</button>`).join('');
  const lockNote = document.getElementById('groupPickerLockNote');
  if (lockNote) lockNote.hidden = !groupsLocked();
  showModal('groupPickerModal');
}
function pickGroupChip(gid) {
  if (selectGroup(gid)) {
    hideModal('groupPickerModal');
    renderPbGroupBar();
    // A blocked hub open resumes now that the device has a group.
    if (!document.getElementById('paperworkHubModal')?.classList.contains('on')) openPaperworkHub();
  }
}
// Called when entering the Planda Bear hub: force a choice when groups are
// active and this device hasn't picked one yet.
function pbEnsureGroupChosen() {
  const groups = sessionGroups();
  if (!groups.length) { if (activeGroupId) setActiveGroupId(''); return true; }
  if (!activeGroupId) {
    const remembered = loadActiveGroupId();
    if (remembered && groups.some(g => g.id === remembered)) {
      activeGroupId = remembered;
      pbEnsureGroupSubscription();
      return true;
    }
    if (adminSession || session.role === 'instructor') {
      selectGroup(groups[0].id, { silent: true });   // instructors land in Group 1, switchable
      return true;
    }
    openGroupPicker();
    return false;
  }
  pbEnsureGroupSubscription();
  return true;
}

function activeCallSheetKey() {
  const base = `cueola_call_sheet_index_${session.code || session.userName || 'local'}`;
  return groupActive() ? `${base}__${activeGroupId}` : base;   // D2: per-group selection
}

// v2.1 D6 selection hardening: the stored selection is {id, index}, and the id
// wins — a remote delete or sanitizer collapse can renumber the array, but it
// can never silently swap a different sheet into an open form.
let activeCallSheetId = '';

function loadActiveCallSheetIndex(sheets=null) {
  try {
    const raw = localStorage.getItem(activeCallSheetKey());
    if (raw == null) return 0;
    let parsed = null;
    try { parsed = JSON.parse(raw); } catch { parsed = null; }
    if (parsed && typeof parsed === 'object') {
      const list = sheets || getCallSheets();
      const byId = parsed.id ? list.findIndex(sheet => sheet.id === parsed.id) : -1;
      if (byId >= 0) { activeCallSheetId = parsed.id; return byId; }
      return Math.max(0, Math.min(Number(parsed.index) || 0, Math.max(0, list.length - 1)));
    }
    return Math.max(0, Number(raw) || 0);   // legacy numeric value (read-old)
  } catch { return 0; }
}

function storeActiveCallSheetIndex(index, sheets=null) {
  activeCallSheetIndex = Math.max(0, Number(index) || 0);
  const list = sheets || getCallSheets();
  activeCallSheetId = list[activeCallSheetIndex]?.id || '';
  try { localStorage.setItem(activeCallSheetKey(), JSON.stringify({ id: activeCallSheetId, index: activeCallSheetIndex })); } catch {}
  return activeCallSheetIndex;
}

// Resolve the device's selection against the CURRENT sheet list, id-first.
function resolveActiveCallSheetIndex(sheets=getCallSheets()) {
  const byId = activeCallSheetId ? sheets.findIndex(sheet => sheet.id === activeCallSheetId) : -1;
  const idx = byId >= 0 ? byId : Math.max(0, Math.min(Number(activeCallSheetIndex) || 0, Math.max(0, sheets.length - 1)));
  activeCallSheetIndex = idx;
  activeCallSheetId = sheets[idx]?.id || activeCallSheetId;
  return idx;
}

function loadPreProData() {
  try { return JSON.parse(localStorage.getItem(preProKey()) || '{}') || {}; } catch { return {}; }
}

function preProActor() {
  const n = (session.userName || '').trim();
  if (n) return n;
  return session.role === 'instructor' ? 'Instructor' : 'Someone';
}

const _pbPendingCloudKeys = new Set();
const _pbPendingCloudCounts = new Map();
let _pbLastCloudSaveError = null;

function pbBeginCloudSave(keys) {
  keys.forEach(key => {
    const count = (_pbPendingCloudCounts.get(key) || 0) + 1;
    _pbPendingCloudCounts.set(key, count);
    _pbPendingCloudKeys.add(key);
  });
  updatePbSaveStatus();
}

function pbEndCloudSave(keys) {
  keys.forEach(key => {
    const count = Math.max(0, (_pbPendingCloudCounts.get(key) || 0) - 1);
    if (count) _pbPendingCloudCounts.set(key, count);
    else {
      _pbPendingCloudCounts.delete(key);
      _pbPendingCloudKeys.delete(key);
    }
  });
  updatePbSaveStatus();
}

// Google-Docs-style save state for the paperwork nav: the bottom bar shows a
// live status chip instead of a manual save button (paperwork autosaves as
// you type — queuePaperworkAutosave — so a Save button only sowed doubt).
function pbSaveStatusState() {
  if (_pbFieldSaveTimer || _pbPendingCloudKeys.size) return 'saving';
  if (!window._firebaseReady || !session.code || session.code === 'LOCAL' || session.isDemo || session.isExpert) return 'local';
  if (_pbLastCloudSaveError) return 'offline';
  return 'saved';
}

function updatePbSaveStatus() {
  const chips = document.querySelectorAll('[data-pb-save-status]');
  if (!chips.length) return;
  const state = pbSaveStatusState();
  const label = state === 'saving' ? 'Saving…'
    : state === 'offline' ? 'Saved on this device — reconnecting'
    : state === 'local' ? 'Saved on this device'
    : 'All changes saved';
  const icon = state === 'saving' ? sfIcon('time.clock')
    : state === 'offline' ? sfIcon('state.warning')
    : sfIcon('state.success');
  chips.forEach(chip => {
    chip.classList.remove('is-saving', 'is-offline', 'is-local', 'is-saved');
    chip.classList.add(`is-${state}`);
    chip.innerHTML = `${icon}<span>${label}</span>`;
  });
}

function preProValuesEqual(a, b) {
  if (a === b) return true;
  try { return JSON.stringify(a) === JSON.stringify(b); } catch { return false; }
}

function preProSyncEngine() { return window.CueolaPreProSync || null; }

// Bridge for DOM collectors that rebuild row objects without ids: adopt the
// previous save's row ids (and ord) by position so leaf diffs stay row-stable.
// Rows that already carry an id keep it; extra new rows get fresh ids later
// (rowsToMap). Applies to every known collection incl. per-sheet crew.
function pbAdoptRowIdentity(previous, next) {
  const Sync = preProSyncEngine();
  if (!Sync) return next;
  const adopt = (prevRows, nextRows) => {
    if (!Array.isArray(nextRows)) return nextRows;
    const prevList = Sync.rowsToList(prevRows || []);
    return nextRows.map((row, i) => {
      if (!row || typeof row !== 'object' || row.id) return row;
      const prev = prevList[i];
      return prev ? { ...row, id: prev.id, ord: prev.ord } : row;
    });
  };
  const out = { ...next };
  for (const k of ['people', 'videoPatchRows', 'audioPatchRows', 'commsPatchRows']) {
    if (out[k] !== undefined) out[k] = adopt(previous?.[k], out[k]);
  }
  if (out.productionSchedule && Array.isArray(out.productionSchedule.checklist)) {
    out.productionSchedule = { ...out.productionSchedule, checklist: adopt(previous?.productionSchedule?.checklist, out.productionSchedule.checklist) };
  }
  if (Array.isArray(out.callSheets)) {
    const prevSheets = Sync.rowsToList(previous?.callSheets || []);
    out.callSheets = out.callSheets.map((sheet, i) => {
      if (!sheet || typeof sheet !== 'object') return sheet;
      const prev = sheet.id ? prevSheets.find(s => s.id === sheet.id) : prevSheets[i];
      const withId = sheet.id || !prev ? { ...sheet } : { ...sheet, id: prev.id, ord: prev.ord };
      if (Array.isArray(withId.people)) withId.people = adopt(prev?.people, withId.people);
      return withId;
    });
  }
  return out;
}

// Known row collections come back out of the merge as ordered maps; the rest
// of the app (renders, exports, PDF) keeps consuming arrays, so convert at the
// boundary. Rows keep their id/ord fields — that is what makes them stable.
function pbCollectionsToArrays(doc) {
  const Sync = preProSyncEngine();
  if (!Sync || !doc || typeof doc !== 'object') return doc;
  const out = { ...doc };
  for (const k of ['people', 'videoPatchRows', 'audioPatchRows', 'commsPatchRows']) {
    if (out[k] && typeof out[k] === 'object' && !Array.isArray(out[k])) out[k] = Sync.rowsToList(out[k]);
  }
  if (out.productionSchedule?.checklist && typeof out.productionSchedule.checklist === 'object' && !Array.isArray(out.productionSchedule.checklist)) {
    out.productionSchedule = { ...out.productionSchedule, checklist: Sync.rowsToList(out.productionSchedule.checklist) };
  }
  if (out.callSheets && typeof out.callSheets === 'object' && !Array.isArray(out.callSheets)) {
    out.callSheets = Sync.rowsToList(out.callSheets).map(sheet => {
      if (sheet?.people && typeof sheet.people === 'object' && !Array.isArray(sheet.people)) {
        return { ...sheet, people: Sync.rowsToList(sheet.people) };
      }
      return sheet;
    });
  }
  return out;
}

// Leaf-granular wire writes stay DARK until every client ships the engine:
// a leaf-writing client puts map-shaped collections on the wire that the
// deployed array-reading build cannot see, and mixed-version saves accumulate
// orphan rows (P2607 incident, 2026-07-15). Flip to true only as part of a
// coordinated deploy (with a WORKER_SCHEMA bump so cached clients refresh).
window.CUEOLA_PB_LEAF_SYNC = false;

function persistPreProData(patch, section) {
  const Sync = preProSyncEngine();
  const previous = loadPreProData();
  const now = Date.now();
  if (!Sync || window.CUEOLA_PB_LEAF_SYNC !== true) return persistPreProDataLegacy(previous, patch, section, now);
  const nextRaw = pbAdoptRowIdentity(previous, { ...previous, ...(patch || {}) });
  delete nextRaw.activeCallSheetIndex; // selected sheet is device-local, never shared
  const prevNorm = Sync.normalizeDoc(previous).doc;
  const nextNorm = Sync.normalizeDoc(nextRaw).doc;
  const diff = Sync.diffLeaves(prevNorm, nextNorm, now);
  // record stamps + tombstones on the doc we keep locally
  const stamped = JSON.parse(JSON.stringify(nextNorm));
  if (!stamped._stamps || typeof stamped._stamps !== 'object' || Array.isArray(stamped._stamps)) stamped._stamps = {};
  for (const [dotted, stamp] of Object.entries(diff.stampWrites)) {
    const path = dotted.replace(/^_stamps\./, '').split('.');
    let cur = stamped._stamps;
    for (let i = 0; i < path.length - 1; i++) {
      if (typeof cur[path[i]] !== 'object' || cur[path[i]] === null || Array.isArray(cur[path[i]])) cur[path[i]] = {};
      cur = cur[path[i]];
    }
    cur[path[path.length - 1]] = stamp;
  }
  Sync.gcTombstones(stamped, now);
  stamped.updatedAt = now;
  const toStore = pbCollectionsToArrays(stamped);
  delete toStore.activeCallSheetIndex;
  try { localStorage.setItem(preProKey(), JSON.stringify(toStore)); } catch {}
  syncPreProLeavesToFirestore(diff, section, now);
  return toStore;
}

// Legacy top-level-key persist, kept as a fallback if the sync engine script
// ever fails to load — paperwork must save no matter what.
function persistPreProDataLegacy(previous, patch, section, now) {
  const changed = {};
  for (const [key, value] of Object.entries(patch || {})) {
    if (key === 'updatedAt' || key === '_fieldUpdatedAt' || key === 'activeCallSheetIndex') continue;
    if (!preProValuesEqual(previous[key], value)) changed[key] = value;
  }
  const fieldUpdatedAt = { ...(previous._fieldUpdatedAt || {}) };
  const baseline = Number(previous.updatedAt) || 0;
  for (const key of Object.keys(previous)) {
    if (key !== 'updatedAt' && key !== '_fieldUpdatedAt' && key !== 'activeCallSheetIndex' && fieldUpdatedAt[key] == null) {
      fieldUpdatedAt[key] = baseline;
    }
  }
  for (const key of Object.keys(changed)) fieldUpdatedAt[key] = now;
  const next = { ...previous, ...(patch || {}), _fieldUpdatedAt:fieldUpdatedAt, updatedAt:now };
  delete next.activeCallSheetIndex;
  try { localStorage.setItem(preProKey(), JSON.stringify(next)); } catch {}
  syncPreProToFirestore(changed, section, now);
  return next;
}

let _pbSuppressActivity = false;  // debounced live-typing saves shouldn't log an activity entry each keystroke
function syncPreProToFirestore(changed={}, section, updatedAt=Date.now()) {
  // 'LOCAL' is the no-session sentinel (openLocalPlandaBear/openLocalOutrangutan):
  // there is no sessions/LOCAL doc, so a write can only fail with not-found.
  if (!window._firebaseReady || !session.code || session.code === 'LOCAL' || session.isDemo || session.isExpert) return;
  // D2: writes land on the ACTIVE workspace — the group subdoc when grouped.
  const ref = preProDocRef();
  const grouped = groupActive();
  const changedKeys = Object.keys(changed).filter(key => /^[A-Za-z_][A-Za-z0-9_]*$/.test(key));
  if (changedKeys.length) {
    const updates = { 'prePro.updatedAt':updatedAt };
    for (const key of changedKeys) {
      // All current Planda Bear top-level keys are Firestore-safe identifiers.
      // Field-path writes prevent one stale section from replacing the package.
      updates[`prePro.${key}`] = changed[key];
      updates[`prePro._fieldUpdatedAt.${key}`] = updatedAt;
    }
    pbBeginCloudSave(changedKeys);
    _pbLastCloudSaveError = null;
    // D2: the FIRST save to a group whose subdoc doesn't exist yet retries as
    // a setDoc merge (updateDoc requires an existing doc).
    const groupSeedFallback = err => {
      if (!grouped || err?.code !== 'not-found') return Promise.reject(err);
      const seed = { prePro: { updatedAt: updatedAt, _fieldUpdatedAt: {} }, updatedAt: updatedAt };
      changedKeys.forEach(key => {
        seed.prePro[key] = changed[key];
        seed.prePro._fieldUpdatedAt[key] = updatedAt;
      });
      return window._setDoc(ref, seed, { merge: true });
    };
    window._updateDoc(ref, updates).catch(groupSeedFallback).then(() => {
      pbEndCloudSave(changedKeys);
    }).catch(err => {
      // Record the failure before pbEndCloudSave re-renders the save-status
      // chip, so the chip never reports "saved" over a failed write.
      _pbLastCloudSaveError = err;
      pbEndCloudSave(changedKeys);
      reportCloudWriteFailure('Planda Bear cloud save', err);
    });
  }
  if (section && !_pbSuppressActivity && window._arrayUnion) {
    const entry = { section, by: preProActor(), clientId: CLIENT_ID, at: Date.now() };
    window._updateDoc(ref, { preProActivity: preProActivityValue(entry) })
      .catch(err => (grouped && err?.code === 'not-found')
        ? window._setDoc(ref, { preProActivity: [entry] }, { merge: true })
        : Promise.reject(err))
      .catch(err => reportCloudWriteFailure('Planda Bear activity save', err));
  }
}

function pbLeafPathSafe(dotted) {
  return String(dotted).split('.').every(seg => /^[A-Za-z_][A-Za-z0-9_]*$/.test(seg));
}

// Render-equality for row collections: compares the ORDERED sequence of row
// contents while ignoring the sync bookkeeping fields (id/ord) — stored rows
// carry them, freshly-collected DOM rows may not, and a reorder still shows up
// as a different sequence. Prevents idle refreshes from re-rendering forever.
function pbRowsRenderEqual(a, b) {
  const Sync = preProSyncEngine();
  const list = v => (Sync ? Sync.rowsToList(v || []) : (Array.isArray(v) ? v : []));
  const strip = rows => list(rows).map(r => { const { ord, id, ...rest } = (r && typeof r === 'object') ? r : {}; return rest; });
  try { return JSON.stringify(strip(a)) === JSON.stringify(strip(b)); } catch { return false; }
}

// Leaf-granular outbound writer: masked field-path updates per changed leaf
// (see PB_COLLAB_PLAN.md). The pending-key set now holds LEAF paths, so the
// snapshot merge protects exactly the fields in flight, nothing coarser.
function syncPreProLeavesToFirestore(diff, section, now = Date.now()) {
  if (!window._firebaseReady || !session.code || session.code === 'LOCAL' || session.isDemo || session.isExpert) return;
  const Sync = preProSyncEngine();
  const ref = preProDocRef();   // D2: the dark engine stays group-compatible
  const changedPaths = (diff.changedPaths || []).filter(pbLeafPathSafe);
  if (changedPaths.length && Sync) {
    const updates = Sync.buildFirestoreUpdates(diff, { base:'prePro', now, deleteField: window._deleteField() });
    for (const key of Object.keys(updates)) {
      if (!pbLeafPathSafe(key.replace(/^prePro\./, ''))) delete updates[key];
    }
    pbBeginCloudSave(changedPaths);
    _pbLastCloudSaveError = null;
    window._updateDoc(ref, updates).then(() => {
      pbEndCloudSave(changedPaths);
    }).catch(err => {
      _pbLastCloudSaveError = err;
      pbEndCloudSave(changedPaths);
      reportCloudWriteFailure('Planda Bear cloud save', err);
    });
  }
  if (section && !_pbSuppressActivity && window._arrayUnion) {
    const entry = { section, by: preProActor(), clientId: CLIENT_ID, at: Date.now() };
    window._updateDoc(ref, { preProActivity: preProActivityValue(entry) }).catch(err => reportCloudWriteFailure('Planda Bear activity save', err));
  }
}

function mergePreProFromCloud(server, recoverNewerLocal=false) {
  if (!server || typeof server !== 'object') return loadPreProData();
  const Sync = preProSyncEngine();
  // Engine merge reads BOTH wire shapes; it is needed to digest any map-shaped
  // data already on the wire, but its recovery pushes must also stay legacy
  // while CUEOLA_PB_LEAF_SYNC is dark — mergePreProFromCloudLegacy handles that.
  if (!Sync || window.CUEOLA_PB_LEAF_SYNC !== true) {
    const digestible = Sync ? pbCollectionsToArrays(Sync.normalizeDoc(server).doc) : server;
    return mergePreProFromCloudLegacy(digestible, recoverNewerLocal);
  }
  const local = loadPreProData();
  const { merged, recovery } = Sync.mergeDocs(local, server, { pendingPaths:_pbPendingCloudKeys, recoverNewerLocal });
  const toStore = pbCollectionsToArrays(merged);
  delete toStore.activeCallSheetIndex;
  try { localStorage.setItem(preProKey(), JSON.stringify(toStore)); } catch {}
  const recKeys = Object.keys(recovery || {});
  if (recoverNewerLocal && recKeys.length
      && window._firebaseReady && session.code && session.code !== 'LOCAL' && !session.isDemo && !session.isExpert) {
    // Device came back with newer local leaves — re-push just those.
    const now = Date.now();
    const localNorm = Sync.normalizeDoc(local).doc;
    const updates = { 'prePro.updatedAt': now };
    const changed = [];
    for (const dotted of recKeys) {
      if (dotted.startsWith('__delete__.')) {
        const p = dotted.slice('__delete__.'.length);
        if (!pbLeafPathSafe(p)) continue;
        updates[`prePro.${p}`] = window._deleteField();
        updates[`prePro._stamps.${p}`] = { [Sync.DEL]: now };
        changed.push(p);
      } else {
        if (!pbLeafPathSafe(dotted)) continue;
        updates[`prePro.${dotted}`] = recovery[dotted];
        updates[`prePro._stamps.${dotted}`] = Sync.stampFor(localNorm, dotted.split('.')).at || now;
        changed.push(dotted);
      }
    }
    if (changed.length) {
      const ref = window._doc(window._db, 'sessions', session.code);
      pbBeginCloudSave(changed);
      window._updateDoc(ref, updates).then(() => pbEndCloudSave(changed)).catch(err => {
        _pbLastCloudSaveError = err;
        pbEndCloudSave(changed);
        reportCloudWriteFailure('Planda Bear draft recovery', err);
      });
      logShow('sync', `Recovering ${changed.length} newer Planda Bear field(s) from this device`);
    }
  }
  return toStore;
}

function mergePreProFromCloudLegacy(server, recoverNewerLocal=false) {
  const local = loadPreProData();
  const localTimes = local._fieldUpdatedAt || {};
  const serverTimes = server._fieldUpdatedAt || {};
  const merged = { ...local };
  const recoveryPatch = {};
  const keys = new Set([...Object.keys(local), ...Object.keys(server)]);
  keys.delete('updatedAt');
  keys.delete('_fieldUpdatedAt');
  keys.delete('activeCallSheetIndex');
  for (const key of keys) {
    if (_pbPendingCloudKeys.has(key) && Object.prototype.hasOwnProperty.call(local, key)) continue;
    if (!Object.prototype.hasOwnProperty.call(server, key)) {
      if (recoverNewerLocal && Object.prototype.hasOwnProperty.call(local, key)) recoveryPatch[key] = local[key];
      continue;
    }
    const localAt = Number(localTimes[key] ?? local.updatedAt) || 0;
    const serverAt = Number(serverTimes[key] ?? server.updatedAt) || 0;
    if (!Object.prototype.hasOwnProperty.call(local, key) || serverAt >= localAt) merged[key] = server[key];
    else if (recoverNewerLocal) recoveryPatch[key] = local[key];
  }
  merged._fieldUpdatedAt = { ...localTimes };
  for (const [key, value] of Object.entries(serverTimes)) {
    if ((Number(value) || 0) >= (Number(merged._fieldUpdatedAt[key]) || 0)) merged._fieldUpdatedAt[key] = value;
  }
  merged.updatedAt = Math.max(Number(local.updatedAt) || 0, Number(server.updatedAt) || 0);
  delete merged.activeCallSheetIndex;
  try { localStorage.setItem(preProKey(), JSON.stringify(merged)); } catch {}
  if (recoverNewerLocal && Object.keys(recoveryPatch).length) {
    syncPreProToFirestore(recoveryPatch, null, Date.now());
    logShow('sync', `Recovering ${Object.keys(recoveryPatch).length} newer Planda Bear draft field(s) from this device`);
  }
  return merged;
}

// Pull shared Planda Bear work saved by others (cloud → local) so every
// device in the session sees the latest package.
async function hydratePreProFromFirestore() {
  if (!window._firebaseReady || !session.code || session.isDemo || session.isExpert) return;
  try {
    // D2: hydrate from the active workspace (group subdoc when grouped). A
    // group doc that doesn't exist yet is a legitimately blank workspace.
    const snap = await window._getDoc(preProDocRef());
    if (!snap.exists()) return;
    const server = snap.data().prePro;
    if (!server || typeof server !== 'object') return;
    mergePreProFromCloud(server);
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
      chip.innerHTML = `${sfIcon('action.edit')} ${esc(p.name || 'Someone')}`;
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
  pbSetFieldIfIdle('sp-hospital-address', safety.hospitalAddress || '');
  pbSetFieldIfIdle('sp-hospital-phone', safety.hospitalPhone || '');
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
  // D9.6: ps-doors is a time input now — normalize legacy free-text values
  // ("7pm") so they hydrate instead of blanking; unparseable text is dropped.
  pbSetFieldIfIdle('ps-doors', timeTo24(schedule.doors || '') || '');
  pbSetFieldIfIdle('ps-location', schedule.location || '');
  pbSetFieldIfIdle('ps-address', schedule.address || '');
  pbSetFieldIfIdle('ps-setup-notes', schedule.setupNotes || '');
  pbSetFieldIfIdle('ps-show-notes', schedule.showNotes || '');
  // Setup-N/A and the Ready Before Show checklist ride the same shared object —
  // if the refresh skips them, this client's next autosave rebuilds the whole
  // schedule from its stale DOM and silently reverts collaborators' ticks.
  if (!pbFieldRecentlyEdited('ps-setup-na')) setSetupNotApplicable(schedule.setupNA);
  if (!document.activeElement?.closest?.('#ps-checklist') && !pbFieldRecentlyEdited('ps-checklist')) {
    const domRows = collectProductionChecklistRows(false);
    if (!pbRowsRenderEqual(schedule.checklist, domRows)) renderProductionChecklist(schedule.checklist);
  }
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
  const idx = resolveActiveCallSheetIndex(sheets);
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
  pbSetFieldIfIdle('pp-meal-time', sheet.mealTime || '');
  pbSetFieldIfIdle('pp-notes', sheet.notes || '');
  // Times with N/A toggles, venue, and the weather block ride the same shared
  // sheet — if the refresh skips them, this client's next autosave rebuilds the
  // sheet from its stale DOM/module vars and silently reverts collaborators'
  // edits (the exact overwrite the debounced-merge comment promises to prevent).
  const idle = id => { const el = document.getElementById(id); return el && el !== document.activeElement && !pbFieldRecentlyEdited(id); };
  if (idle('pp-show-start')) {
    const showNA = sheet.showStart === 'N/A';
    setShowNotApplicable(showNA);
    if (!showNA) pbSetFieldIfIdle('pp-show-start', timeTo24(sheet.showStart));
  }
  if (idle('pp-wrap')) {
    const wrapNA = sheet.wrap === 'N/A';
    setWrapNotApplicable(wrapNA);
    if (!wrapNA) pbSetFieldIfIdle('pp-wrap', timeTo24(sheet.wrap));
  }
  if (idle('pp-doors')) {
    const doorsNA = sheet.doors === 'N/A';
    setDoorsNotApplicable(doorsNA);
    pbSetFieldIfIdle('pp-doors', doorsNA ? '' : timeTo24(sheet.doors));
  }
  if (!pbFieldRecentlyEdited('pp-venue-group')) {
    const remoteVenue = normalizeCallSheetVenue(sheet.venue);
    if (remoteVenue !== callSheetVenue) { callSheetVenue = remoteVenue; renderCallSheetVenue(); }
  }
  const wxIds = ['pp-wx-conditions','pp-wx-high','pp-wx-low','pp-wx-precip','pp-wx-wind','pp-wx-sunrise','pp-wx-sunset'];
  const wxBusy = wxIds.some(id => { const el = document.getElementById(id); return (el && el === document.activeElement) || pbFieldRecentlyEdited(id); });
  if (!wxBusy) {
    const remoteWx = normalizeCallSheetWeather(sheet.weather);
    if (JSON.stringify(remoteWx) !== JSON.stringify(normalizeCallSheetWeather(callSheetWeather))) {
      callSheetWeather = remoteWx;
      renderCallSheetWeatherCard();
    }
  }
  // A remotely added/renamed sheet must show up in the selector too.
  const select = document.getElementById('pp-call-sheet-select');
  if (select && select !== document.activeElement) {
    const names = sheets.map((s, i) => callSheetDisplayName(s, i));
    const current = [...select.options].map(o => o.textContent);
    if (JSON.stringify(names) !== JSON.stringify(current)) renderCallSheetSelector(sheets);
  }
  // Crew grid is an array — re-render it (so adds/removes sync) only when nobody
  // is typing in it, then keep the local roster in step for the next save.
  const people = Array.isArray(sheet.people) && sheet.people.length ? sheet.people : [{ name:'', position:'', email:'', phone:'', call:'' }];
  if (!document.activeElement?.closest?.('#pp-crew-grid') && !pbFieldRecentlyEdited('pp-crew-grid') && !pbRowsRenderEqual(people, callSheetPeople)) {
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
  // Just-typed cells (not only the focused one) must survive the merge — the
  // 650ms autosave runs THROUGH this refresh, so without the recently-edited
  // guard it reverted every unsaved cell except the one holding the caret.
  const anyRecent = [...document.querySelectorAll('[data-patch-kind]')].some(i => pbFieldRecentlyEdited(i.id));
  if (editingInGrid || anyRecent) {
    kinds.forEach(kind => {
      const rows = data[`${kind}PatchRows`];
      if (!Array.isArray(rows)) return;
      document.querySelectorAll(`[data-patch-kind="${kind}"]`).forEach(input => {
        if (input === document.activeElement || pbFieldRecentlyEdited(input.id)) return;
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
    return !pbRowsRenderEqual(rows, collectPatchRows(kind, true));
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
  if (pbOpenPageId() === 'hub') renderPlandaBearAssignmentsCard();
  pbRenderFieldPresence();
  pbRenderPagePresence();
}

function pbIsCollabField(el) {
  return el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') && el.id;
}

// Autosave must also cover the dynamic-row widgets whose inputs carry data-*
// keys instead of ids (crew grid, checklist rows, patch cells) — presence
// stays id-based, but every edit has to reach the debounced save.
function pbIsAutosaveField(el) {
  if (!el || (el.tagName !== 'INPUT' && el.tagName !== 'TEXTAREA' && el.tagName !== 'SELECT')) return false;
  return !!(el.id || el.dataset.callField || el.dataset.psField || el.dataset.patchField);
}

// Guard key for the 10s recent-edit hold: id when the field has one, else the
// containing widget so the whole-grid re-render guards cover just-blurred rows.
function pbAutosaveGuardKey(el) {
  if (el.id) return el.id;
  if (el.dataset.callField) return 'pp-crew-grid';
  if (el.dataset.psField) return 'ps-checklist';
  return '';
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
      if (!pbIsAutosaveField(e.target)) return;
      paperworkDirty = true;
      const guardKey = pbAutosaveGuardKey(e.target);
      if (guardKey) pbNoteLocalEdit(guardKey);
      clearTimeout(_pbFieldSaveTimer);
      _pbFieldSaveTimer = setTimeout(() => {
        _pbFieldSaveTimer = null;
        // Merge in collaborators' latest values before saving so two people on
        // the same page editing different fields don't overwrite each other.
        pbRefreshOpenPaperworkFields();
        _pbSuppressActivity = true;
        try {
          saveOpenPaperworkSection(false);
          paperworkDirty = false;
        } finally { _pbSuppressActivity = false; }
        updatePbSaveStatus();
      }, 650);
      updatePbSaveStatus();
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
  // D6: navigation runs over the ENABLED items only — steps renumber when a
  // type is disabled, and Previous/Next skip hidden editors.
  const items = enabledPaperworkItems();
  const idx = items.findIndex(item => item.id === id);
  const item = items[idx] || items[0];
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
  const isLast = idx >= items.length - 1;
  // Notes post instantly and the rundown page renders itself — the live
  // save-status chip and "Preview" only make sense on the form pages.
  const saveStatus = (id === 'rundown' || id === 'production-notes') ? '' : `<span class="pb-save-status" data-pb-save-status role="status" aria-live="polite"></span>`;
  const previewButton = (slotId === 'pbNavPreview' || id === 'production-notes') ? '' : `<button type="button" onclick="previewPaperworkItem('${item.id}')">Preview</button>`;
  slot.innerHTML = `
    <div class="paperwork-flow-left">
      <button type="button" onclick="returnToPaperworkHub()">${sfIcon('chevron.left')}<span>Planda Bear</span></button>
    </div>
    <div class="pb-step-pill">Step ${idx + 1} of ${items.length}</div>
    <div class="paperwork-flow-right">
      ${saveStatus}
      ${previewButton}
      <button type="button" onclick="openPaperworkRelative(-1)" ${isFirst ? 'disabled' : ''}>${sfIcon('chevron.left')}<span>Previous</span></button>
      <button type="button" class="primary" onclick="openPaperworkRelative(1)"><span>${isLast ? 'Finish' : 'Next'}</span>${sfIcon('chevron.right')}</button>
    </div>`;
  updatePbSaveStatus();
}

function openPaperworkRelative(delta) {
  const current = currentPaperworkItemId();
  savePaperworkItem(current, false);
  const items = enabledPaperworkItems();   // D6: skip disabled editors
  const idx = items.findIndex(item => item.id === current);
  const nextIdx = idx + delta;
  if (nextIdx < 0 || nextIdx >= items.length) return returnToPaperworkHub();
  hidePaperworkEditors();
  openPaperworkItem(items[nextIdx].id);
}

function openPaperworkHub() {
  if (!confirmSaveUnsavedPaperwork()) return;
  if (!session.code && !session.isDemo && !session.isExpert) {
    openPreProJoinModal('hub');
    return;
  }
  if (!pbEnsureGroupChosen()) return;   // D2: grouped sessions require a pick
  renderPbGroupBar();
  applyPlandaBearTheme(plandaBearTheme);
  hydratePreProFromFirestore().then(() => renderPlandaBearAssignmentsCard());
  // Assignments otherwise hydrate only when the Admin panel opens; warm them
  // here so Export PDF Package never dead-ends on "still loading its saved
  // state" for a crew member who never touches Admin.
  if (paperworkExportAuthority() === 'server' && assignmentSaveState === 'loading') hydrateRoleAssignments();
  const grid = document.getElementById('paperworkGrid');
  if (grid) {
    // Production Notes lives in its own wide bar above the grid, not in the
    // numbered list. D6: only enabled types render, numbered sequentially.
    grid.innerHTML = enabledPaperworkItems().filter(item => item.id !== 'production-notes').map((item, i) => `<button class="paperwork-card" data-pb-section="${PB_SECTION_FOR_ITEM[item.id]||''}" onclick="openPaperworkItem('${item.id}')">
      <div class="paperwork-card-num">${i + 1}</div>
      <div>
        <div class="paperwork-card-title">${esc(item.title)}</div>
        <div class="paperwork-card-sub">${esc(item.sub)}</div>
      </div>
      <div class="paperwork-card-by" data-pb-by hidden></div>
    </button>`).join('');
  }
  renderPackageSheetPicker();   // D9.1: honest call-sheet count + picker
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
    window._updateDoc(ref, { preProActivity: preProActivityValue(entry) }).catch(err => reportCloudWriteFailure('Planda Bear activity save', err));
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
    seenBy: pbNormalizeSeenBy(n?.seenBy),
  };
}

// Read receipts (Phase 4 item 3): { [sanitizedKey]: { name, at } } on the note
// doc. Keys are dot-free so a receipt is one masked field-path patch — two
// people opening the board at once never clobber each other's map entries.
function pbNormalizeSeenBy(m) {
  if (!m || typeof m !== 'object' || Array.isArray(m)) return {};
  const out = {};
  for (const k of Object.keys(m).slice(0, 200)) {
    const v = m[k];
    const name = String(v?.name || '').trim().slice(0, 60);
    const key = String(k).replace(/[^\w-]/g, '').slice(0, 48);
    if (!name || !key) continue;
    out[key] = { name, at: Number(v?.at) || 0 };
  }
  return out;
}

// Receipt keys must be valid unquoted field-path segments ([a-zA-Z_][a-zA-Z_0-9]*)
// so `seenBy.<key>` works as a masked updateDoc path — no dots, no hyphens,
// and never starting with a digit.
function pbSeenKey(name) {
  const base = String(name || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 48);
  if (!base) return '';
  return /^[a-z_]/.test(base) ? base : 'u_' + base;
}

// A single To-Do checklist item inside a note (a post can carry several).
// `assignee` (Phase 4 item 2) is the crew member who owes it — same name pool
// as @mentions, so portal aggregation keys off the profile's full name.
function pbNormalizeChecklistItem(it) {
  const text = String(it?.text || '').trim().slice(0, 300);
  if (!text) return null;
  return {
    id: String(it?.id || '').replace(/[^\w.-]/g, '') || `ci_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    text,
    assignee: String(it?.assignee || '').slice(0, 60),
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

/* ── Per-note subcollection store (Phase 4 item 1) ──
 * Primary store: sessions/{code}/notes/{noteId} — one doc per note, so a like
 * or checkbox tick writes one small doc instead of rewriting the whole board
 * array against the session doc's 1 MiB ceiling. Plain per-note writes also
 * queue offline, which the old whole-array transaction never could.
 * The DEPLOYED production rules may predate the subcollection: the first
 * permission-denied drops this session to 'legacy' mode (the original
 * whole-array pipeline below, kept intact as the fallback), and the next
 * page load probes again — the owner's staged-rules deploy upgrades every
 * client with no further code change.
 * Read-both window (this release): loads merge the legacy preProNotes array
 * with the subcollection (subcollection wins per id); legacy-only notes are
 * lazily backfilled into the subcollection, idempotently by note id. The
 * array itself is left in place for not-yet-reloaded clients. */
let pbNotesMode = 'probe';        // 'probe' | 'sub' | 'legacy' — resolved per session
let pbNotesSessionCode = null;    // which session the mode + caches belong to
let pbNotesUnsub = null;          // subcollection listener teardown
let _pbSubNotes = new Map();      // noteId -> normalized note (subcollection copy)
let _pbLegacyNotes = [];          // normalized notes from the legacy array
let _pbBackfilledIds = new Set(); // legacy ids this client already backfilled
let _pbEverInSub = new Set();     // ids ever observed in the subcollection — an id
                                  // that WAS here and is gone was deleted; the
                                  // backfill must never resurrect it from a stale
                                  // legacy-array copy (own-listener races included)
let _pbSeenMarkedIds = new Set(); // note ids whose read receipt is written (or in flight)

function pbNotesCloudSession() {
  return Boolean(window._firebaseReady && session.code && !session.isDemo && !session.isExpert);
}

function pbNotesResetForSession() {
  if (pbNotesSessionCode === (session.code || null)) return;
  pbNotesSessionCode = session.code || null;
  pbNotesMode = 'probe';
  _pbSubNotes = new Map();
  _pbLegacyNotes = [];
  _pbBackfilledIds = new Set();
  _pbEverInSub = new Set();
  _pbSeenMarkedIds = new Set();
  pbStopNotesListener();
}

function pbNoteDocRef(id) {
  return window._doc(window._db, 'sessions', session.code, 'notes', id);
}

function pbNotesCollectionRef() {
  return window._collection(window._db, 'sessions', session.code, 'notes');
}

function pbIsPermissionDenied(err) {
  return Boolean(err && (err.code === 'permission-denied' || /insufficient permission/i.test(String(err.message || ''))));
}

function pbDropToLegacyNotes(err, what) {
  if (pbNotesMode === 'legacy') return;
  pbNotesMode = 'legacy';
  pbStopNotesListener();
  console.info(`[notes] ${what}: per-note store denied by the deployed rules — using the legacy array path this session.`, err?.code || err);
}

// The board the operator sees: legacy array ∪ subcollection, subcollection
// winning per id (a per-note edit is always newer than its array-era copy).
function pbMergedNotes() {
  if (pbNotesMode !== 'sub') return _pbLegacyNotes.slice();
  const out = new Map(_pbLegacyNotes.map(n => [n.id, n]));
  for (const [id, n] of _pbSubNotes) out.set(id, n);
  return [...out.values()];
}

// The wire format: empty-string/default fields are omitted from the cloud doc
// (the staged rules treat a PRESENT string as meaningful — '' is invalid) and
// normalizePlandaBearNote re-defaults them on read. Keeps note docs small too.
function pbCompactNote(n) {
  const out = { id: n.id, by: n.by, role: n.role, tag: n.tag, at: n.at };
  if (n.text) out.text = n.text;
  if (n.assignee) out.assignee = n.assignee;
  if (n.done) out.done = true;
  if (n.doneBy) out.doneBy = n.doneBy;
  if (n.doneAt) out.doneAt = n.doneAt;
  if (n.clientId) out.clientId = n.clientId;
  if (n.replyTo) out.replyTo = n.replyTo;
  if (n.editedAt) out.editedAt = n.editedAt;
  if (n.pinned) out.pinned = true;
  if (n.avatar && n.avatar.type !== 'initials') out.avatar = n.avatar;
  if (n.likes && n.likes.length) out.likes = n.likes;
  if (n.mentions && n.mentions.length) out.mentions = n.mentions;
  if (n.checklist && n.checklist.length) out.checklist = n.checklist;
  if (n.attachments && n.attachments.length) out.attachments = n.attachments;
  if (n.seenBy && Object.keys(n.seenBy).length) out.seenBy = n.seenBy;   // a full-doc rewrite must never wipe receipts
  return out;
}

// Lazy idempotent migration: copy legacy-array notes the subcollection doesn't
// have yet. Same id + same content, so any number of clients can race this.
function pbBackfillLegacyNotes() {
  if (pbNotesMode !== 'sub' || !pbNotesCloudSession()) return;
  for (const n of _pbLegacyNotes) {
    // _pbEverInSub, not _pbSubNotes: an id that was in the subcollection and
    // vanished was DELETED — a stale array copy must not bring it back.
    if (_pbEverInSub.has(n.id) || _pbBackfilledIds.has(n.id)) continue;
    _pbBackfilledIds.add(n.id);
    _pbEverInSub.add(n.id);
    window._setDoc(pbNoteDocRef(n.id), pbCompactNote(n)).catch(err => {
      _pbBackfilledIds.delete(n.id);
      if (pbIsPermissionDenied(err)) pbDropToLegacyNotes(err, 'backfill');
    });
  }
}

async function loadPlandaBearNotes() {
  pbNotesResetForSession();
  if (!pbNotesCloudSession()) {
    plandaBearNotes = localPlandaBearNotes();
    return plandaBearNotes;
  }
  try {
    const snap = await window._getDoc(window._doc(window._db, 'sessions', session.code));
    const raw = snap.exists() && Array.isArray(snap.data().preProNotes) ? snap.data().preProNotes : [];
    _pbLegacyNotes = raw.map(normalizePlandaBearNote).filter(pbNoteHasContent);
    if (pbNotesMode !== 'legacy' && window._getDocs && window._collection) {
      try {
        const subSnap = await window._getDocs(pbNotesCollectionRef());
        const fresh = new Map();
        subSnap.forEach(docSnap => {
          const n = normalizePlandaBearNote(docSnap.data());
          if (pbNoteHasContent(n)) { fresh.set(n.id, n); _pbEverInSub.add(n.id); }
        });
        _pbSubNotes = fresh;
        pbNotesMode = 'sub';
        pbBackfillLegacyNotes();
      } catch (err) {
        if (pbIsPermissionDenied(err)) pbDropToLegacyNotes(err, 'load');
        else throw err;
      }
    }
    plandaBearNotes = pbMergedNotes();
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
  const noteSaveToken = pbBeginNoteSave();
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
    pbNoteSaveSucceeded(noteSaveToken);
  } catch (err) {
    pbNoteSaveFailed(err, noteSaveToken);
    reportCloudWriteFailure('Production notes cloud save', err);
  } finally {
    pbEndNoteSave();
  }
  pbNotesActivity(activitySection);
}

function pbNotesActivity(section) {
  if (!section || !window._arrayUnion || !pbNotesCloudSession()) return;
  const entry = { section, by: preProActor(), clientId: CLIENT_ID, at: Date.now() };
  window._updateDoc(window._doc(window._db, 'sessions', session.code), { preProActivity: preProActivityValue(entry) })
    .catch(err => reportCloudWriteFailure('Planda Bear activity save', err));
}

/* Every board mutation funnels through here. `next` is the full intended list
 * (exactly what the legacy path always took); `change` names the one per-note
 * operation so 'sub' mode writes a single small doc instead:
 *   { set: note }                         — post / reply (full doc)
 *   { like: { id, add } }                 — arrayUnion/arrayRemove of CLIENT_ID
 *   { patch: { id, fields } }             — masked field update (pin/edit/done/checklist)
 *   { remove: [ids] }                     — delete a thread
 * A permission-denied mid-flight drops to legacy and REPLAYS the same intent
 * through the old transaction, so the operator's action never gets lost. */
async function pbApplyNoteMutation(next, change, activitySection) {
  const intended = next.map(normalizePlandaBearNote).filter(pbNoteHasContent);
  if (pbNotesMode !== 'sub' || !pbNotesCloudSession()) {
    return writePlandaBearNotes(intended, activitySection);
  }
  plandaBearNotes = intended;
  saveLocalPlandaBearNotes(plandaBearNotes);
  _pbNotesBaseline = new Set(plandaBearNotes.map(n => n.id));
  const noteSaveToken = pbBeginNoteSave();
  try {
    if (change.set) {
      const clean = normalizePlandaBearNote(change.set);
      _pbEverInSub.add(clean.id);
      await window._setDoc(pbNoteDocRef(clean.id), pbCompactNote(clean));
      _pbSubNotes.set(clean.id, clean);
    } else if (change.like) {
      const op = change.like.add ? window._arrayUnion(CLIENT_ID) : window._arrayRemove(CLIENT_ID);
      await pbPatchNoteDocOrUpsert(change.like.id, { likes: op }, intended);
    } else if (change.patch) {
      await pbPatchNoteDocOrUpsert(change.patch.id, change.patch.fields, intended);
    } else if (change.remove) {
      const drop = new Set(change.remove);
      // Bookkeeping BEFORE the awaits: our own listener snapshot fires mid-await
      // (latency compensation) and runs the backfill — the legacy cache must
      // already be filtered or it would resurrect the note we are deleting.
      const hadLegacyCopies = _pbLegacyNotes.some(n => drop.has(n.id));
      _pbLegacyNotes = _pbLegacyNotes.filter(n => !drop.has(n.id));
      await Promise.all(change.remove.map(id =>
        window._deleteDoc(pbNoteDocRef(id)).then(() => { _pbSubNotes.delete(id); })));
      // Purge the same ids from the legacy array too — otherwise the read-both
      // merge (and any not-yet-upgraded client) resurrects the deleted thread.
      if (hadLegacyCopies) await pbPurgeLegacyArray(drop);
    }
    pbNoteSaveSucceeded(noteSaveToken);
  } catch (err) {
    if (pbIsPermissionDenied(err)) {
      pbDropToLegacyNotes(err, 'mutation');
      return writePlandaBearNotes(intended, activitySection);
    }
    // Transient (offline/unavailable): the plain per-note write is queued by
    // the persistent cache and flushes on reconnect — no legacy double-write.
    pbNoteSaveFailed(err, noteSaveToken);
    reportCloudWriteFailure('Production note cloud save', err);
  } finally {
    pbEndNoteSave();
  }
  pbNotesActivity(activitySection);
}

// Masked patch with upsert: the note doc may not exist yet if the backfill
// hasn't landed — fall back to writing the full local copy. Empty strings in
// a patch become field deletes (the rules treat '' as invalid; absent = default).
async function pbPatchNoteDocOrUpsert(id, fields, intended) {
  const local = intended.find(n => n.id === id);
  const patch = {};
  for (const key of Object.keys(fields)) {
    patch[key] = (fields[key] === '' && window._deleteField) ? window._deleteField() : fields[key];
  }
  try {
    await window._updateDoc(pbNoteDocRef(id), patch);
  } catch (err) {
    if (err?.code === 'not-found') {
      if (local) {
        _pbEverInSub.add(id);
        await window._setDoc(pbNoteDocRef(id), pbCompactNote(normalizePlandaBearNote(local)));
      }
      return;
    }
    throw err;
  }
  if (local) { _pbSubNotes.set(id, normalizePlandaBearNote(local)); _pbEverInSub.add(id); }
}

async function pbPurgeLegacyArray(dropIds) {
  if (!window._runTransaction) return;
  const ref = window._doc(window._db, 'sessions', session.code);
  try {
    await window._runTransaction(window._db, async (tx) => {
      const snap = await tx.get(ref);
      const raw = snap.exists() && Array.isArray(snap.data().preProNotes) ? snap.data().preProNotes : [];
      const kept = raw.filter(n => !dropIds.has(String(n?.id || '')));
      if (kept.length !== raw.length) tx.set(ref, { preProNotes: kept }, { merge: true });
    });
  } catch (err) {
    reportCloudWriteFailure('Legacy note cleanup', err);
  }
}

/* Live push for the whole crew — including hub/notes-only joins, which never
 * run setupFirestore's session listener. Attached optimistically; the error
 * callback downgrades to legacy mode (where the session-doc listener, when
 * present, keeps feeding the board exactly as before this migration). */
function pbStartNotesListener() {
  pbNotesResetForSession();
  if (!pbNotesCloudSession() || pbNotesUnsub || pbNotesMode === 'legacy') return;
  if (!window._collection || !window._onSnapshot) return;
  const listenerCode = session.code;
  try {
    pbNotesUnsub = window._onSnapshot(pbNotesCollectionRef(), (snap) => {
      if (session.code !== listenerCode) return;
      pbNotesMode = 'sub';
      const fresh = new Map();
      snap.forEach(docSnap => {
        const n = normalizePlandaBearNote(docSnap.data());
        if (pbNoteHasContent(n)) { fresh.set(n.id, n); _pbEverInSub.add(n.id); }
      });
      _pbSubNotes = fresh;
      pbBackfillLegacyNotes();   // the array may still carry notes we haven't copied
      pbIngestRemoteNotes();
    }, (err) => {
      pbNotesUnsub = null;
      if (pbIsPermissionDenied(err)) pbDropToLegacyNotes(err, 'listener');
    });
  } catch {}
}

function pbStopNotesListener() {
  if (pbNotesUnsub) { try { pbNotesUnsub(); } catch {} pbNotesUnsub = null; }
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
// v2.1 D7: FROZEN icon-avatar manifest (decision 11: ~24 launch icons; brand
// animals above stay). Every symbol name is verified against the generated
// sf-symbols runtime; the stored avatar value is the manifest id only. Ids are
// append-only — removing or renaming one orphans saved profiles (they fall
// back to initials, harmless but rude).
const PB_AVATAR_ICONS = {
  play:        { label: 'Play',        symbol: 'media.play' },
  playpause:   { label: 'Play/Pause',  symbol: 'media.playpause' },
  waveform:    { label: 'Waveform',    symbol: 'media.waveform' },
  camera:      { label: 'Camera',      symbol: 'department.video' },
  audio:       { label: 'Audio',       symbol: 'department.audio' },
  gfx:         { label: 'Graphics',    symbol: 'department.graphics' },
  lighting:    { label: 'Lighting',    symbol: 'department.lighting' },
  playback:    { label: 'Playback',    symbol: 'department.playback' },
  script:      { label: 'Script',      symbol: 'department.script' },
  pages:       { label: 'Pages',       symbol: 'content.script' },
  clock:       { label: 'Clock',       symbol: 'time.clock' },
  calendar:    { label: 'Calendar',    symbol: 'content.calendar' },
  checklist:   { label: 'Checklist',   symbol: 'content.checklist' },
  bookmark:    { label: 'Bookmark',    symbol: 'action.bookmark' },
  bell:        { label: 'Bell',        symbol: 'notification.default' },
  star:        { label: 'Star',        symbol: 'state.favorite' },
  bolt:        { label: 'Flex',        symbol: 'state.flex' },
  go:          { label: 'GO!',         symbol: 'marker.go' },
  standby:     { label: 'Standby',     symbol: 'marker.ready' },
  sunshine:    { label: 'Sunshine',    symbol: 'weather.clear' },
  storm:       { label: 'Storm',       symbol: 'weather.thunderstorm' },
  snow:        { label: 'Snow',        symbol: 'weather.snow' },
  wind:        { label: 'Wind',        symbol: 'weather.wind' },
  tree:        { label: 'Tree',        symbol: 'nature.tree' },
  // The fun picks (owner-approved 2026-07-18): vendored Twemoji 15.1.0 SVGs
  // (CC-BY 4.0 — assets/avatars/LICENSE.txt). `src` entries render full-color
  // like the brand animals; stored values stay manifest ids either way.
  trex:        { label: 'T-Rex',       src: 'assets/avatars/trex.svg' },
  unicorn:     { label: 'Unicorn',     src: 'assets/avatars/unicorn.svg' },
  frog:        { label: 'Frog',        src: 'assets/avatars/frog.svg' },
  turtle:      { label: 'Turtle',      src: 'assets/avatars/turtle.svg' },
  bunny:       { label: 'Bunny',       src: 'assets/avatars/bunny.svg' },
  flamingo2:   { label: 'Flamingo',    src: 'assets/avatars/flamingo2.svg' },
  orangutan2:  { label: 'Orangutan',   src: 'assets/avatars/orangutan2.svg' },
  koala2:      { label: 'Koala',       src: 'assets/avatars/koala2.svg' },
  panda2:      { label: 'Panda',       src: 'assets/avatars/panda2.svg' },
  robot:       { label: 'Robot',       src: 'assets/avatars/robot.svg' },
  ghost:       { label: 'Ghost',       src: 'assets/avatars/ghost.svg' },
  alien:       { label: 'Alien',       src: 'assets/avatars/alien.svg' },
  pizza:       { label: 'Pizza',       src: 'assets/avatars/pizza.svg' },
  taco:        { label: 'Taco',        src: 'assets/avatars/taco.svg' },
  popcorn:     { label: 'Popcorn',     src: 'assets/avatars/popcorn.svg' },
  cupcake:     { label: 'Cupcake',     src: 'assets/avatars/cupcake.svg' },
  coffee:      { label: 'Coffee',      src: 'assets/avatars/coffee.svg' },
  guitar:      { label: 'Guitar',      src: 'assets/avatars/guitar.svg' },
  headphones:  { label: 'Headphones',  src: 'assets/avatars/headphones.svg' },
  clapper:     { label: 'Clapper',     src: 'assets/avatars/clapper.svg' },
  paint:       { label: 'Paint',       src: 'assets/avatars/paint.svg' },
  shades:      { label: 'Shades',      src: 'assets/avatars/shades.svg' },
  crown:       { label: 'Crown',       src: 'assets/avatars/crown.svg' },
  rocket:      { label: 'Rocket',      src: 'assets/avatars/rocket.svg' },
  rainbow:     { label: 'Rainbow',     src: 'assets/avatars/rainbow.svg' },
  fire:        { label: 'Fire',        src: 'assets/avatars/fire.svg' },
  dice:        { label: 'Dice',        src: 'assets/avatars/dice.svg' },
  ninja:       { label: 'Ninja',       src: 'assets/avatars/ninja.svg' },
};

// One renderer for a manifest icon's inner content: full-color art when the
// entry ships an SVG, theme-tinted SF mask otherwise.
function pbIconEntryInner(entry) {
  if (entry && entry.src) return `<img class="pb-av-img pb-av-art" src="${esc(entry.src)}" alt="" draggable="false">`;
  return `<span class="pb-av-ico">${sfIcon(entry.symbol)}</span>`;
}
const PB_PROFILE_KEY = 'cueola_profile';
const pbProfileModel = CueolaAvatarProfile.createProfileModel({
  storage: localStorage,
  profileKey: PB_PROFILE_KEY,
  approvedAnimals: PB_AVATAR_ANIMALS,
  iconManifest: PB_AVATAR_ICONS,
});

function pbGetProfile() {
  return pbProfileModel.getProfile();
}
function pbSetProfileAvatar(avatar) {
  return pbProfileModel.setAvatar(avatar);
}

// Coerce any avatar blob to a safe shape: an approved animal key, a manifest
// icon id, a data:image URL, else initials.
function pbNormalizeAvatar(a) {
  return CueolaAvatarProfile.normalizeAvatar(a, PB_AVATAR_ANIMALS, PB_AVATAR_ICONS);
}

// The avatar chip's inner content for a note/reply author (falls back to initials).
function pbAvatarInner(note) {
  const a = pbNormalizeAvatar(note && note.avatar);
  if (a && a.type === 'animal') { const an = PB_AVATAR_ANIMALS[a.value]; return `<img class="pb-av-img" src="${an.src}" alt="" draggable="false">`; }
  // D7: symbol icons ride the SF-Symbols mask pipeline (theme-tinted); the
  // fun picks are full-color vendored art.
  if (a && a.type === 'icon') return pbIconEntryInner(PB_AVATAR_ICONS[a.value]);
  if (a && a.type === 'image') return `<img class="pb-av-img" src="${esc(a.value)}" alt="" draggable="false">`;
  return esc(pbInitials(note && note.by));
}
// Background for the avatar chip: brand bg for animals, transparent for photos,
// else the hashed personal color (icons sit on it too — stable per user).
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
  // D7: icon avatars — theme-tinted masks on the user's stable hashed color.
  const iconBtns = Object.entries(PB_AVATAR_ICONS).map(([k, v]) =>
    `<button type="button" class="pb-av-choice${_pbPortalDraft && _pbPortalDraft.type === 'icon' && _pbPortalDraft.value === k ? ' sel' : ''}" onclick="pbPortalPick('icon','${k}')" title="${esc(v.label)}">
      <span class="pb-av-chip" style="background:${pbAvatarColor(me)}">${pbIconEntryInner(v)}</span><span class="pb-av-choice-lbl">${esc(v.label)}</span>
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
      ${iconBtns}
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
  // A signed-in profile carries its look to every device.
  window.CueolaIdentity?.onDeviceAvatarSaved?.(_pbPortalDraft || { type: 'initials' });
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
  const model = paperworkExportModel();
  if (!model) { toast('The export model is unavailable. Reload Cueola before exporting.'); return; }
  const snapshot = model.createSnapshot({
    authority:'unpublished',
    readiness:model.assessReadiness({ authority:'unpublished' }),
    production:{
      sessionCode:session.code || (session.isDemo ? 'DEMO' : 'LOCAL'),
      name:show.name || 'Cueola',
      identity:session.code || 'local',
    },
    exportedAt:Date.now(),
    revisions:{ notesFingerprint:model.fingerprint([draft]) },
    show:{ name:show.name || 'Cueola', start:normalizeTimeValue(show.start), freeMode:freeTextMode },
    notes:[draft],
    labels:{ document:'Production note draft' },
    options:{ includeNotes:true, includeAssignments:false, documentType:'production-note-draft' },
  });
  const frozenDraft = snapshot.notes[0];
  const html = productionNoteDocHTML(frozenDraft, snapshot.notes, snapshot.production.name);
  const options = paperExportOptionsForSnapshot(snapshot, { orientation:'portrait', allowMixedOrientation:false });
  try {
    toast('Building note PDF...');
    const stamp = new Date(snapshot.exportedAt).toISOString().slice(0, 10);
    const result = await exportPaperHTMLAsPDF(html, `cueola-production-note-draft-${stamp}.pdf`, options);
    toast(`Unpublished note PDF downloaded · ${result.pageCount} pages.`);
  } catch (error) {
    if (error?.code === 'export-cancelled') { toast('Export canceled.'); return; }
    console.warn('Paged PDF renderer unavailable; opening the identical unpublished-note print representation.', error);
    try {
      const result = await printPaperHTML(html, options);
      toast(`PDF renderer unavailable. Print preview opened · ${result.pageCount} pages.`);
    } catch (printError) {
      toast(`Could not render the unpublished note: ${paperworkExportFailureMessage(printError)}`);
    }
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
  const owesBtn = document.getElementById('pbOwesBtn');
  if (owesBtn) owesBtn.hidden = !pbIsInstructor();   // "who owes what" is an instructor tool
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
   payload is chunked into `sessions/{code}/files/*`. Legacy `pbfile_*` sibling
   docs remain readable for one migration window. ── */
function pbFileDocId(fileId, chunk=0) {
  const base = `pbfile_${session.code || 'local'}_${fileId}`;
  return chunk ? `${base}_c${chunk}` : base;
}

function pbStoredFileDocId(fileId, chunk=0) {
  return chunk ? `${fileId}.chunk.${chunk}` : fileId;
}

function pbStoredFileRef(fileId, chunk=0) {
  return window._doc(window._db, 'sessions', session.code, 'files', pbStoredFileDocId(fileId, chunk));
}

function pbLegacyFileRef(fileId, chunk=0) {
  return window._doc(window._db, 'sessions', pbFileDocId(fileId, chunk));
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
  // firestore.rules caps file-doc names at 240 chars — trim pathological
  // filenames here instead of letting the cloud write bounce.
  const safeName = raw => String(raw || '').slice(0, 240);
  if (isImage) {
    const img = await pbCompressNoteImage(file);
    return {
      fileId, name: safeName(file.name) || 'image', type: img.type,
      size: Math.round(img.dataUrl.length * 0.75), isImage: true,
      w: img.w, h: img.h, dataUrl: img.dataUrl,
    };
  }
  const dataUrl = await pbReadFileAsDataURL(file);
  const isAudio = /^audio\//i.test(file.type || '') || /\.(mp3|wav|m4a|aac|ogg|opus|weba)$/i.test(file.name || '');
  return { fileId, name: safeName(file.name) || 'file', type: (file.type || '').slice(0, 160), size: file.size || 0, isImage: false, isAudio, w: 0, h: 0, dataUrl };
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
    const writeAll = async (makeRef, makeId) => {
      await window._setDoc(makeRef(att.fileId), {
        kind: 'pbNoteFile', fileId: att.fileId, session: session.code, name: att.name, type: att.type,
        size: att.size, chunkCount: chunks.length, data: chunks[0] || '', at: Date.now(),
      });
      for (let i = 1; i < chunks.length; i++) {
        await window._setDoc(makeRef(att.fileId, i), {
          kind: 'pbNoteFileChunk', fileId: makeId(att.fileId, i), parentFileId: att.fileId,
          session: session.code, chunkIndex: i, data: chunks[i],
        });
      }
    };
    try {
      await writeAll(pbStoredFileRef, pbStoredFileDocId);
    } catch (err) {
      // The deployed rules can predate the files subcollection (the staged
      // firestore.rules add it). Fall back to the legacy sibling docs so
      // attachments keep working; this branch self-retires once the staged
      // rules are deployed and the subcollection write succeeds again.
      if (err?.code !== 'permission-denied') throw err;
      logShow('sync', 'Attachment stored via legacy path — deploy the staged firestore.rules to finish the files migration');
      await writeAll(pbLegacyFileRef, pbFileDocId);
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
  const readChunks = async refForChunk => {
    const snap = await window._getDoc(refForChunk(0));
    if (!snap.exists()) return null;
    const d = snap.data() || {};
    let dataUrl = d.data || '';
    const chunkCount = Math.max(1, Math.min(8, Number(d.chunkCount) || 1));
    for (let i = 1; i < chunkCount; i++) {
      const chunk = await window._getDoc(refForChunk(i));
      if (!chunk.exists()) return null;
      dataUrl += chunk.data().data || '';
    }
    return dataUrl;
  };
  try {
    const current = await readChunks(chunk => pbStoredFileRef(fileId, chunk));
    if (current !== null) {
      pbNoteFileCache.set(fileId, current);
      return current;
    }
  } catch {}
  try {
    const legacy = await readChunks(chunk => pbLegacyFileRef(fileId, chunk));
    if (legacy !== null) {
      pbNoteFileCache.set(fileId, legacy);
      return legacy;
    }
  } catch {}
  return '';
}

function pbDeleteNoteFiles(note) {
  (note?.attachments || []).forEach(att => {
    pbNoteFileCache.delete(att.fileId);
    try { localStorage.removeItem(pbLocalFileKey(att.fileId)); } catch {}
    if (window._firebaseReady && window._deleteDoc && session.code && !session.isDemo && !session.isExpert) {
      // chunkCount may be unknown here — sweep both current and legacy layouts.
      for (let i = 0; i < 8; i++) {
        window._deleteDoc(pbStoredFileRef(att.fileId, i)).catch(()=>{});
        window._deleteDoc(pbLegacyFileRef(att.fileId, i)).catch(()=>{});
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

function pbBuildThreads(notes=plandaBearNotes) {
  const all = (Array.isArray(notes) ? notes : []).slice().sort((a,b)=>(a.at||0)-(b.at||0));
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
  if (btn) setSymbolButtonLabel(btn, pbNotesNewestFirst ? 'action.down' : 'action.up', pbNotesNewestFirst ? 'Newest' : 'Oldest');
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
  // Role-assignment people too — post-Phase 3 these are the profile-fed crew
  // roster, so checklist owners resolve even before someone has entered today.
  try { getRoleAssignments().forEach(r => r?.person && names.add(r.person.trim())); } catch {}
  const me = (session.userName || '').trim();
  if (me) names.add(me);
  return Array.from(names).filter(Boolean);
}

/* ── Position chips (Phase 4 item 4) ──
 * A person's crew position from the roster (prePro.roleAssignments). Rendered
 * as a muted chip beside authors, in mention rows (disambiguates two Sams),
 * and in presence tooltips — read-only garnish, so '' simply renders nothing. */
function pbPositionFor(name) {
  if (!name) return '';
  try {
    const row = getRoleAssignments().find(r => r.person && sameParticipantName(r.person, name));
    return row ? String(row.position || '').trim() : '';
  } catch { return ''; }
}

function pbPositionChipHTML(name) {
  const pos = pbPositionFor(name);
  return pos ? `<span class="pb-note-pos" title="Crew position">${esc(pos)}</span>` : '';
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
  menu.innerHTML = _pbMention.items.map((n, i) => {
    const pos = pbPositionFor(n);
    return `<button type="button" class="pb-mention-item${i === _pbMention.sel ? ' sel' : ''}" data-i="${i}" onmousedown="event.preventDefault();pbMentionPick(${i})">
      <span class="pb-mention-av">${esc(pbInitials(n))}</span><span class="pb-mention-name">${esc(n)}</span>${pos ? `<span class="pb-mention-pos">${esc(pos)}</span>` : ''}
    </button>`;
  }).join('');
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
    pbComposerChecklist.push({ id: pbNewChecklistId(), text: '', done: false, assignee: '' });
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
  const people = pbAssigneeOptions();
  const rows = pbComposerChecklist.map((it, i) => {
    const opts = people.includes(it.assignee) || !it.assignee ? people : [it.assignee, ...people];
    return `
    <div class="pb-cl-row">
      <span class="pb-cl-box" aria-hidden="true"></span>
      <input class="pb-cl-input" type="text" value="${esc(it.text)}" placeholder="To-do item ${i + 1}" oninput="pbChecklistEdit(${i}, this.value)" onkeydown="pbChecklistKeydown(event, ${i})" aria-label="Checklist item ${i + 1}">
      <select class="pb-cl-assign" onchange="pbChecklistAssign(${i}, this.value)" title="Who owes this item" aria-label="Assign checklist item ${i + 1}">
        <option value="">Anyone</option>
        ${opts.map(n => `<option value="${esc(n)}"${it.assignee === n ? ' selected' : ''}>${esc(n)}</option>`).join('')}
      </select>
      <button type="button" class="pb-cl-del" onclick="pbChecklistRemove(${i})" title="Remove item" aria-label="Remove item">${sfIcon('action.close')}</button>
    </div>`;
  }).join('');
  slot.innerHTML = `
    <div class="pb-checklist-head"><span>${sfIcon('content.checklist')} Checklist</span><span class="pb-cl-count">${pbComposerChecklist.length} item${pbComposerChecklist.length === 1 ? '' : 's'}</span></div>
    <div class="pb-cl-rows">${rows}</div>
    <button type="button" class="pb-cl-add" onclick="pbChecklistAdd()">${sfIcon('action.add')} Add item</button>`;
}

function pbToggleChecklistBuilder() {
  pbChecklistOpen = !pbChecklistOpen;
  if (pbChecklistOpen && !pbComposerChecklist.length) pbComposerChecklist.push({ id: pbNewChecklistId(), text: '', done: false, assignee: '' });
  pbRenderComposerChecklist();
  if (pbChecklistOpen) setTimeout(() => document.querySelector('.pb-cl-input')?.focus({ preventScroll: true }), 0);
}

function pbNewChecklistId() { return `ci_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`; }
function pbChecklistAdd() { pbComposerChecklist.push({ id: pbNewChecklistId(), text: '', done: false, assignee: '' }); pbRenderComposerChecklist(); setTimeout(() => { const rows = document.querySelectorAll('.pb-cl-input'); rows[rows.length - 1]?.focus({ preventScroll: true }); }, 0); }
function pbChecklistEdit(i, val) { if (pbComposerChecklist[i]) pbComposerChecklist[i].text = val; }
function pbChecklistAssign(i, val) { if (pbComposerChecklist[i]) pbComposerChecklist[i].assignee = val || ''; }
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
  else if (e.key === 'Escape') { e.preventDefault(); pbCancelReply(); }
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
  await pbApplyNoteMutation([...plandaBearNotes, reply], { set: reply }, 'Production Note Reply');
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
  // likes ride arrayUnion/arrayRemove so two hearts at once never clobber; no activity entry
  await pbApplyNoteMutation(next, { like: { id, add: !liked } }, null);
  renderPlandaBearNotes();
}

/* ── Pinning (instructors) ── */
async function pbTogglePin(id) {
  if (!pbIsInstructor()) { toast('Only instructors can pin notes.'); return; }
  await loadPlandaBearNotes();
  const note = plandaBearNotes.find(n => n.id === id);
  if (!note) return;
  const next = plandaBearNotes.map(n => n.id === id ? { ...n, pinned: !n.pinned } : n);
  await pbApplyNoteMutation(next, { patch: { id, fields: { pinned: !note.pinned } } }, note.pinned ? 'Note Unpinned' : 'Note Pinned');
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
  else if (e.key === 'Escape') { e.preventDefault(); pbCancelEditNote(); }
}

async function pbSaveEditNote(id) {
  const ta = document.getElementById('pbEditInput');
  const text = ta?.value.trim() || '';
  await loadPlandaBearNotes();
  const original = plandaBearNotes.find(n => n.id === id);
  if (!original) { pbCancelEditNote(); return; }
  if (!text && !(original.attachments || []).length) { toast('A note needs some text — or delete it instead.'); return; }
  const editedAt = text !== original.text ? Date.now() : original.editedAt;
  const next = plandaBearNotes.map(n => n.id === id ? { ...n, text, editedAt } : n);
  pbEditingNoteId = null;
  await pbApplyNoteMutation(next, { patch: { id, fields: { text, editedAt } } }, 'Production Note Edited');
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
    await pbApplyNoteMutation([...plandaBearNotes, note], { set: note }, pbComposerTag === 'todo' ? 'To-Do Posted' : 'Production Note');
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
  const done = !note.done;
  // Record who completed it and when (accountability), cleared if reopened.
  const fields = { done, doneBy: done ? preProActor() : '', doneAt: done ? Date.now() : 0 };
  const next = plandaBearNotes.map(n => n.id === id ? { ...n, ...fields } : n);
  await pbApplyNoteMutation(next, { patch: { id, fields } }, 'To-Do Updated');
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
  await pbApplyNoteMutation(plandaBearNotes.filter(n => !ids.has(n.id)), { remove: [...ids] }, 'Production Note Removed');
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
        ${pbPositionChipHTML(note.by)}
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
  const me = (session.userName || '').trim();
  const rows = items.map(it => {
    const box = canManage
      ? `<button type="button" class="pb-clitem-check${it.done ? ' done' : ''}" onclick="pbToggleChecklistItem('${note.id}','${it.id}')" title="${it.done ? 'Reopen' : 'Mark done'}" aria-pressed="${it.done}">${it.done ? '✓' : ''}</button>`
      : `<span class="pb-clitem-check static${it.done ? ' done' : ''}">${it.done ? '✓' : ''}</span>`;
    const mine = !it.done && it.assignee && me && sameParticipantName(it.assignee, me);
    const owner = !it.done && it.assignee
      ? `<span class="pb-clitem-assign${mine ? ' mine' : ''}" title="Assigned to">→ ${esc(it.assignee)}</span>` : '';
    const meta = it.done && it.doneBy ? `<span class="pb-clitem-by">${esc(it.doneBy)}</span>` : '';
    return `<li class="pb-clitem${it.done ? ' done' : ''}${mine ? ' mine' : ''}">${box}<span class="pb-clitem-text">${esc(it.text)}</span>${owner}${meta}</li>`;
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
  const checklist = (note.checklist || []).map(it => it.id === itemId
    ? { ...it, done: !it.done, doneBy: !it.done ? preProActor() : '', doneAt: !it.done ? Date.now() : 0 }
    : it);
  const next = plandaBearNotes.map(n => n.id === noteId ? { ...n, checklist } : n);
  await pbApplyNoteMutation(next, { patch: { id: noteId, fields: { checklist } } }, 'Checklist Updated');
  renderPlandaBearNotes();
}

/* ── Who owes what (Phase 4 item 2): instructors' per-person open-items view ──
 * One screen answering "who still owes something": every open single to-do and
 * every open checklist item, grouped by assignee, biggest debtors first, with
 * an Unassigned bucket at the bottom. Rows jump to (and flash) the note. */
function pbCollectOpenItems() {
  const buckets = new Map();   // lowercased name -> { name, items: [{noteId, text}] }
  const add = (rawName, noteId, text, itemId) => {
    const name = String(rawName || '').trim();
    const key = name ? name.toLowerCase() : '·unassigned';
    if (!buckets.has(key)) buckets.set(key, { name: name || 'Unassigned', items: [] });
    buckets.get(key).items.push({ noteId, itemId: itemId || '', text: String(text || '').trim() || 'To-do' });
  };
  for (const n of plandaBearNotes) {
    // A todo-tagged note that carries a checklist delegates to its items.
    if (n.tag === 'todo' && !n.done && !(n.checklist || []).length) add(n.assignee, n.id, n.text);
    (n.checklist || []).forEach(it => { if (!it.done) add(it.assignee, n.id, it.text, it.id); });
  }
  return [...buckets.values()].sort((a, b) => {
    if (a.name === 'Unassigned') return 1;
    if (b.name === 'Unassigned') return -1;
    return b.items.length - a.items.length || a.name.localeCompare(b.name);
  });
}

/* ── Push a to-do onto the Production Schedule ──
 * Appends an open to-do (a todo note or one checklist item) to the schedule's
 * "Ready Before Show" checklist at the data level, so it works whether or not
 * the Production Schedule modal is open. Duplicate items (same text) are
 * skipped, so pushing twice is safe. */
function pushTodoToProductionSchedule(itemText, sourceName) {
  const item = String(itemText || '').trim();
  if (!item) { toast('Nothing to add — the to-do has no text.'); return false; }
  const data = loadPreProData();
  const raw = { ...(data.productionSchedule || {}) };
  const rows = (Array.isArray(raw.checklist) && raw.checklist.length ? raw.checklist : defaultProductionSchedule().checklist)
    .map(normalizeProductionChecklistRow);
  if (rows.some(r => r.item.trim().toLowerCase() === item.toLowerCase())) {
    toast('Already on the Ready Before Show checklist.');
    return false;
  }
  rows.push(normalizeProductionChecklistRow({
    area: 'Production Notes',
    item,
    hint: sourceName ? `From a Production Notes to-do assigned to ${sourceName}.` : 'From a Production Notes to-do.',
    done: false,
  }));
  raw.checklist = rows;
  persistPreProData({ productionSchedule: raw }, 'Production Schedule');
  if (document.getElementById('productionScheduleModal')?.classList.contains('on')) renderProductionChecklist(rows);
  toast('Added to the Production Schedule — Ready Before Show.');
  return true;
}

// Who-owes rows carry ids only (never raw text in onclick), so quoting is safe.
function pbPushOwesItem(noteId, itemId) {
  const note = plandaBearNotes.find(n => n.id === noteId);
  if (!note) { toast('That note is no longer on the board.'); return; }
  if (itemId) {
    const it = (note.checklist || []).find(x => x.id === itemId);
    if (!it) { toast('That checklist item is gone.'); return; }
    pushTodoToProductionSchedule(it.text, it.assignee);
  } else {
    pushTodoToProductionSchedule(note.text, note.assignee);
  }
}

// Footer action: push a todo note (or every open item of its checklist) onto
// the schedule in one tap. Instructor-only — they own the schedule.
function pbPushNoteToSchedule(noteId) {
  const note = plandaBearNotes.find(n => n.id === noteId);
  if (!note) return;
  const open = (note.checklist || []).filter(it => !it.done);
  if (open.length) {
    let added = 0;
    open.forEach(it => { if (pushTodoToProductionSchedule(it.text, it.assignee)) added++; });
    if (added > 1) toast(`${added} items added to Ready Before Show.`);
  } else {
    pushTodoToProductionSchedule(note.text, note.assignee);
  }
}

function pbOpenOwes() {
  if (!pbIsInstructor()) { toast('Only instructors can open the who-owes-what view.'); return; }
  showModal('pbOwesModal');
  pbRenderOwes();                                   // instant, from local state
  loadPlandaBearNotes().then(pbRenderOwes);         // then refreshed from the cloud
}

function pbRenderOwes() {
  const slot = document.getElementById('pbOwesList');
  if (!slot || !document.getElementById('pbOwesModal')?.classList.contains('on')) return;
  const rows = pbCollectOpenItems();
  if (!rows.length) {
    slot.innerHTML = '<div class="pb-owes-empty">Nothing open — every to-do and checklist item is checked off.</div>';
    return;
  }
  slot.innerHTML = rows.map(r => `
    <div class="pb-owes-person">
      <div class="pb-owes-head">
        <span class="pb-owes-ava${r.name === 'Unassigned' ? ' unassigned' : ''}">${esc(pbInitials(r.name))}</span>
        <span class="pb-owes-name">${esc(r.name)}</span>
        <span class="pb-owes-count">${r.items.length} open</span>
      </div>
      <ul class="pb-owes-items">${r.items.map(it => `
        <li><button type="button" class="pb-owes-jump" onclick="pbOwesJump('${it.noteId}')" title="Jump to this note">${esc(it.text.slice(0, 120))}</button><button type="button" class="pb-owes-push" onclick="pbPushOwesItem('${it.noteId}','${it.itemId}')" title="Add to the Production Schedule's Ready Before Show checklist">${sfIcon('content.calendar')} Schedule</button></li>`).join('')}</ul>
    </div>`).join('');
}

function pbOwesJump(noteId) {
  hideModal('pbOwesModal');
  pbPendingFlashId = noteId;
  if (pbNotesBoardOpen()) renderPlandaBearNotes();
  else openProductionNotes();
}

function pbLikeButtonHTML(note) {
  const liked = pbHasLiked(note);
  const n = (note.likes || []).length;
  return `<button type="button" class="pb-like${liked ? ' liked' : ''}" onclick="pbToggleLike('${note.id}')" title="${liked ? 'Remove your like' : 'Like this note'}" aria-pressed="${liked}">
    <span class="pb-like-ico">${sfIcon('state.favorite')}</span>${n ? `<span class="pb-like-count">${n}</span>` : ''}
  </button>`;
}

// "Seen by N" — quiet count on the right of the footer; the names live in the
// tooltip so the row stays calm (Clarity/Deference: detail on demand).
function pbSeenByHTML(note) {
  const names = Object.values(note.seenBy || {}).map(e => e && e.name).filter(Boolean);
  if (!names.length) return '';
  return `<span class="pb-note-seen" title="${esc('Seen by ' + names.join(', '))}">Seen by ${names.length}</span>`;
}

// On a pinned note, instructors see who on the crew roster HASN'T read it yet
// — the whole point of pinning is that everyone sees it.
function pbUnseenByHTML(note) {
  if (!note.pinned || !pbIsInstructor()) return '';
  let roster = [];
  try { roster = getRoleAssignments().map(r => r.person).filter(Boolean); } catch {}
  if (!roster.length) return '';
  const seenNames = Object.values(note.seenBy || {}).map(e => e && e.name).filter(Boolean);
  const missing = roster.filter(p =>
    !sameParticipantName(p, note.by) && !seenNames.some(s => sameParticipantName(s, p)));
  if (!missing.length) return `<div class="pb-note-unseen all">${sfIcon('state.success')} Everyone on the roster has seen this.</div>`;
  return `<div class="pb-note-unseen">${sfIcon('notification.unread')} Hasn't seen this yet: ${missing.map(esc).join(', ')}</div>`;
}

function pbNoteFootHTML(note, replyCount) {
  const mine = note.clientId && note.clientId === CLIENT_ID;
  return `${pbUnseenByHTML(note)}<footer class="pb-note-foot">
    ${pbLikeButtonHTML(note)}
    <button type="button" class="pb-note-act" onclick="pbOpenReply('${note.id}')">${sfIcon('content.note')} Reply${replyCount ? ` (${replyCount})` : ''}</button>
    ${mine ? `<button type="button" class="pb-note-act" onclick="pbStartEditNote('${note.id}')">${sfIcon('action.edit')} Edit</button>` : ''}
    ${pbIsInstructor() ? `<button type="button" class="pb-note-act" onclick="pbTogglePin('${note.id}')">${sfIcon('action.pin')} ${note.pinned ? 'Unpin' : 'Pin'}</button>` : ''}
    ${pbIsInstructor() && ((note.tag === 'todo' && !note.done) || (note.checklist || []).some(it => !it.done)) ? `<button type="button" class="pb-note-act" onclick="pbPushNoteToSchedule('${note.id}')" title="Add the open to-dos to the Production Schedule's Ready Before Show checklist">${sfIcon('content.calendar')} Schedule</button>` : ''}
    <button type="button" class="pb-note-act export-action" onclick="exportProductionNoteById('${note.id}')">${sfIcon('action.export')} PDF</button>
    ${pbCanManageNote(note) ? `<button type="button" class="pb-note-act danger" onclick="deletePlandaBearNote('${note.id}')">${sfIcon('action.delete')} Delete</button>` : ''}
    ${pbSeenByHTML(note)}
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
        ${pbPositionChipHTML(reply.by)}
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
    slot.innerHTML = `<div class="pb-note-empty"><span class="pb-note-empty-ico">${sfIcon('action.filter')}</span><b>No matching notes</b><span>Nothing matches that search or tag.</span><button type="button" class="pb-chat-tool" onclick="pbClearNotesFilters()">Clear filters</button></div>`;
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
let pbPendingFlashId = null;         // note to scroll-to + flash on the next board render
let pbNotifyLeadId = null;           // note the visible notify toast is about — clicking it flashes that note
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
  pbMarkNotesSeen();   // board open = eyes on the board → cloud read receipts
}

/* Read receipts: one masked field-path patch per note the operator has now
 * seen (sub mode only — receipts activate with the rules deploy, like every
 * other per-note write). Own notes are skipped; a receipt that fails stays
 * unmarked and retries on the next board-open. */
function pbMarkNotesSeen() {
  if (pbNotesMode !== 'sub' || !pbNotesCloudSession()) return;
  const me = (session.userName || '').trim();
  const key = pbSeenKey(me);
  if (!me || !key) return;
  for (const n of plandaBearNotes) {
    if (pbIsMine(n) || _pbSeenMarkedIds.has(n.id)) continue;
    if (n.seenBy && n.seenBy[key]) { _pbSeenMarkedIds.add(n.id); continue; }
    _pbSeenMarkedIds.add(n.id);
    const receipt = { name: me, at: Date.now() };
    n.seenBy = { ...(n.seenBy || {}), [key]: receipt };
    const sub = _pbSubNotes.get(n.id);
    if (sub) sub.seenBy = n.seenBy;
    window._updateDoc(pbNoteDocRef(n.id), { [`seenBy.${key}`]: receipt }).catch(err => {
      _pbSeenMarkedIds.delete(n.id);
      if (pbIsPermissionDenied(err)) pbDropToLegacyNotes(err, 'seen-by');
    });
  }
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
  pbNotifyLeadId = lead.id;
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
  if (pbNotifyLeadId) { pbPendingFlashId = pbNotifyLeadId; pbNotifyLeadId = null; }
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
  pbNotesResetForSession();
  _pbLegacyNotes = raw.map(normalizePlandaBearNote).filter(pbNoteHasContent);
  if (pbNotesMode === 'sub') pbBackfillLegacyNotes();   // an old client may have posted into the array
  pbIngestRemoteNotes();
}

// Shared tail for both live sources (subcollection listener + legacy array
// pushes): merge, notify once per note id, refresh whatever surface is open.
// The first delivery per session only seeds known ids — history must not toast.
function pbIngestRemoteNotes() {
  if (pbNotifySessionCode !== (session?.code || null)) {
    pbNotifySessionCode = session?.code || null;
    pbNotifySeeded = false;
    pbKnownNoteIds.clear();
  }
  plandaBearNotes = pbMergedNotes();
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
      // Attachment blobs live in separate documents and are not part of the
      // revision-fenced note snapshot. List the authoritative metadata rather
      // than silently embedding a mutable cache/localStorage payload.
      return `<div style="font-size:11px;color:#777;margin-top:6px">Image attachment: ${esc(a.name)} (open the saved original in Cueola)</div>`;
    }
    return `<div style="font-size:11px;color:#777;margin-top:6px">Attached document: ${esc(a.name)} (${esc(pbFileSize(a.size))})</div>`;
  }).join('');
}

function pbTagLabel(note) {
  if (note.tag === 'todo') return note.done ? 'To-Do (Completed)' : 'To-Do';
  return (PB_NOTE_TAGS[note.tag] || PB_NOTE_TAGS.general).label;
}

// A note's tasks belong on paper too: the To-Do assignee and every checklist
// item (with its owner and sign-off) — a checklist-only note used to print as
// an empty body.
function pbNotePaperTasksHTML(note) {
  const parts = [];
  const items = note.checklist || [];
  if (note.tag === 'todo' && (note.assignee || '').trim() && !items.length) {
    parts.push(`<div class="cue-muted" style="margin-top:4px">Assigned to: ${esc(note.assignee)}</div>`);
  }
  if (items.length) {
    parts.push(`<div style="margin-top:6px">${items.map(it => `
      <div style="font-size:12px;margin:2px 0">${it.done ? '&#9745;' : '&#9744;'} ${esc(it.text || '')}${(it.assignee || '').trim() ? ` <span class="cue-muted">&rarr; ${esc(it.assignee)}</span>` : ''}${it.done && it.doneBy ? ` <span class="cue-muted">(done by ${esc(it.doneBy)})</span>` : ''}</div>`).join('')}</div>`);
  }
  return parts.join('');
}

function productionNoteDocHTML(note, notes=plandaBearNotes, productionName=show.name) {
  // Pull in the thread's replies so an exported note carries its whole conversation.
  const thread = pbBuildThreads(notes).find(t => t.root.id === note.id);
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
    <div>${esc(productionName || 'Cueola')} · Production Notes</div>
    <table><tbody>
      <tr><th>Tag</th><td>${esc(pbTagLabel(note))}${note.pinned ? ' · Pinned' : ''}</td></tr>
      <tr><th>Author</th><td>${esc(note.by || preProActor())}</td></tr>
      <tr><th>Time</th><td>${esc(new Date(note.at || Date.now()).toLocaleString())}</td></tr>
      ${likeLine}
    </tbody></table>
    ${note.text ? `<div class="paper-note-body">${pbRenderRichText(note.text)}</div>` : ''}
    ${pbNotePaperTasksHTML(note)}
    ${pbAttachmentsPaperHTML(note)}
    ${repliesHTML}
  `;
}

function productionNotesThreadHTML(notes=plandaBearNotes, productionName=show.name, sectionNumber=8) {
  const threads = pbBuildThreads(notes).sort((a,b)=>(a.root.at||0)-(b.root.at||0));
  const attHTML = (n) => (n.attachments || []).map(a => {
    if (a.isImage) {
      return `<div class="cue-muted">Image attachment: ${esc(a.name)} (open the saved original in Cueola)</div>`;
    }
    return `<div class="cue-muted">Document: ${esc(a.name)} (${esc(pbFileSize(a.size))})</div>`;
  }).join('');
  const row = (n, isReply) => `<tr>
    <td>${esc(n.at ? new Date(n.at).toLocaleString() : '')}</td>
    <td>${esc(n.by)}${n.role === 'instructor' ? '<br><span class="cue-muted">Instructor</span>' : ''}</td>
    <td>${esc(pbTagLabel(n))}${n.pinned ? ' (Pinned)' : ''}</td>
    <td>${isReply ? '<div style="padding-left:16px;border-left:3px solid #ddd"><span class="cue-muted">Reply</span><br>' : ''}${pbRenderRichText(n.text)}${n.editedAt ? ' <span class="cue-muted">(edited)</span>' : ''}${pbNotePaperTasksHTML(n)}${attHTML(n)}${isReply ? '</div>' : ''}</td>
  </tr>`;
  const rows = threads.flatMap(t => [row(t.root, false), ...t.replies.map(r => row(r, true))]).join('');
  return `
    <h1 class="psec-h psec-notes">${Number(sectionNumber) || 8}. Production Notes</h1>
    <div>${esc(productionName || 'Cueola')} · Shared discussion board</div>
    <table><thead><tr><th>Time</th><th>By</th><th>Tag</th><th>Note</th></tr></thead>
    <tbody>${rows || '<tr><td colspan="4">No production notes yet.</td></tr>'}</tbody></table>
  `;
}

async function exportProductionNoteById(id) {
  let snapshot;
  try {
    snapshot = await preparePaperworkExportSnapshot({
      includeAssignments:false,
      includeNotes:true,
      documentType:'production-note',
    });
    const note = snapshot.notes.find(n => n.id === id);
    if (!note) throw new Error('That note is not present in the confirmed production snapshot. Reload notes and try again.');
    toast('Building note PDF...');
    const stamp = new Date(note.at || Date.now()).toISOString().slice(0,10);
    const html = productionNoteDocHTML(note, snapshot.notes, snapshot.production.name);
    const options = paperExportOptionsForSnapshot(snapshot, { orientation:'portrait', allowMixedOrientation:false });
    try {
      const result = await exportPaperHTMLAsPDF(html, `cueola-production-note-${stamp}.pdf`, options);
      toast(`Production note PDF downloaded · ${result.pageCount} pages.`);
    } catch (error) {
      if (error?.code === 'export-cancelled') { toast('Export canceled.'); return; }
      console.warn('Paged PDF renderer unavailable; opening the identical production-note print representation.', error);
      const result = await printPaperHTML(html, options);
      toast(`PDF renderer unavailable. Print preview opened · ${result.pageCount} pages.`);
    }
  } catch (error) {
    toast(`Note export blocked: ${paperworkExportFailureMessage(error)}`);
  }
}

let lastProductionNotesExportSnapshot = null;
async function showProductionNotesPreview() {
  activePaperworkItemId = 'production-notes';
  try {
    const snapshot = await preparePaperworkExportSnapshot({
      includeAssignments:false,
      includeNotes:true,
      documentType:'production-notes-log',
    });
    lastProductionNotesExportSnapshot = snapshot;
    const options = paperExportOptionsForSnapshot(snapshot, { orientation:'portrait', allowMixedOrientation:false });
    showPaperPreview('Production Notes Preview', productionNotesThreadHTML(snapshot.notes, snapshot.production.name),
      'Export Notes Log PDF', 'exportProductionNotesPDF()', 'production-notes', options);
  } catch (error) {
    lastProductionNotesExportSnapshot = null;
    toast(`Notes preview blocked: ${paperworkExportFailureMessage(error)}`);
  }
}

async function exportProductionNotesPDF() {
  let snapshot;
  try {
    const previewIsOpen = document.getElementById('paperPreviewModal')?.classList.contains('on')
      && lastPaperPreview?.options?.snapshotFingerprint === lastProductionNotesExportSnapshot?.fingerprint;
    snapshot = previewIsOpen ? lastProductionNotesExportSnapshot : await preparePaperworkExportSnapshot({
      includeAssignments:false,
      includeNotes:true,
      documentType:'production-notes-log',
    });
    toast('Building notes log PDF...');
    const stamp = new Date(snapshot.exportedAt).toISOString().slice(0,10);
    const html = productionNotesThreadHTML(snapshot.notes, snapshot.production.name);
    const options = paperExportOptionsForSnapshot(snapshot, { orientation:'portrait', allowMixedOrientation:false });
    try {
      const result = await exportPaperHTMLAsPDF(html, `cueola-production-notes-${stamp}.pdf`, options);
      toast(`Notes log PDF downloaded · ${result.pageCount} pages.`);
    } catch (error) {
      if (error?.code === 'export-cancelled') { toast('Export canceled.'); return; }
      console.warn('Paged PDF renderer unavailable; opening the identical notes-log print representation.', error);
      const result = await printPaperHTML(html, options);
      toast(`PDF renderer unavailable. Print preview opened · ${result.pageCount} pages.`);
    }
  } catch (error) {
    toast(`Notes export blocked: ${paperworkExportFailureMessage(error)}`);
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
  // D6: disabled types are hidden for everyone — deep links, presence opens,
  // and stale buttons all bounce here instead of opening a hidden editor.
  if (!paperworkTypeEnabled(id)) {
    toast('That paperwork type is turned off for this session.');
    return;
  }
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

// ── Phase 7: one authority boundary for every formal paperwork export. ──
const PAPER_EXPORT_WAIT_MS = 8000;
// Server downloads get their own, longer budget: the show-day session document
// is large (full rundown + legacy notes + presence) and school Wi-Fi is slow —
// the 8s local-wait budget was killing legitimate exports mid-download.
const PAPER_EXPORT_READ_MS = 20000;

function paperworkExportModel() {
  return window.CueolaExportModel || null;
}

function paperworkExportTimeout(promise, ms=PAPER_EXPORT_WAIT_MS, message='The saved production did not confirm in time.') {
  let timer;
  return Promise.race([
    Promise.resolve(promise).finally(() => clearTimeout(timer)),
    new Promise((_, reject) => {
      timer = setTimeout(() => {
        const error = new Error(message);
        error.code = 'export-timeout';
        reject(error);
      }, ms);
    }),
  ]);
}

function paperworkExportAuthority() {
  // 'LOCAL' is the no-session sentinel — there is no sessions/LOCAL doc to
  // confirm against, so local storage is the authority (same rule as
  // syncPreProToFirestore / pbSaveStatusState).
  return session.code && session.code !== 'LOCAL' && !session.isDemo && !session.isExpert ? 'server' : 'local';
}

function flushPaperworkDraftForExport() {
  if (_pbFieldSaveTimer) {
    clearTimeout(_pbFieldSaveTimer);
    _pbFieldSaveTimer = null;
    try { pbRefreshOpenPaperworkFields(); } catch {}
  }
  if (paperworkDirty || document.querySelector('#preProModal.on,#productionScheduleModal.on,#safetyPlanModal.on,#patchSheetModal.on')) {
    _pbSuppressActivity = true;
    try {
      saveOpenPaperworkSection(false);
      paperworkDirty = false;
    } finally { _pbSuppressActivity = false; }
  }
}

function paperworkExportReadiness(options={}) {
  const model = paperworkExportModel();
  if (!model) {
    const error = new Error('The paperwork export model is unavailable. Reload Cueola before exporting.');
    error.code = 'export-model-unavailable';
    throw error;
  }
  const serverAuthority = paperworkExportAuthority() === 'server';
  // Two situations must not dead-end everyone's paperwork behind the
  // canonical-assignments gate, because the export is deterministic without it
  // (the register prints "no canonical records", the call sheet roster comes
  // from prePro): (1) rules denying the canonical reads — the same 'server
  // legacy fallback' contract the production-notes read uses — and (2) a
  // legacy roster that predates canonical migration ('unsaved'/'conflict'
  // Admin to-dos; with no student profiles minted yet it cannot even be
  // migrated, so blocking would strand every export).
  const assignmentsLegacyFallback = (assignmentSaveState === 'failed' && _assignmentLoadDenied)
    || (['unsaved', 'conflict'].includes(assignmentSaveState) && _assignmentLegacyPending);
  const assignmentState = options.includeAssignments === false || !serverAuthority || assignmentsLegacyFallback
    ? 'saved'
    : assignmentSaveState || 'unsaved';
  return model.assessReadiness({
    authority:serverAuthority ? 'server' : 'local',
    paperworkDirty,
    debouncePending:Boolean(_pbFieldSaveTimer),
    rundown:{ pendingCount:rundownPendingBatches.length + (rundownSyncRunning ? 1 : 0) },
    prePro:{
      pendingCount:_pbPendingCloudKeys.size,
      saveState:serverAuthority && _pbLastCloudSaveError ? 'failed' : 'saved',
      error:serverAuthority ? _pbLastCloudSaveError : null,
    },
    assignments:{ saveState:assignmentState, fromCache:serverAuthority && assignmentFromCache },
    notes:{
      pendingCount:serverAuthority ? _pbPendingNoteWrites : 0,
      saveState:serverAuthority && _pbLastNoteSaveError ? 'failed' : 'saved',
      error:serverAuthority ? _pbLastNoteSaveError : null,
    },
  });
}

function paperworkExportReadinessMessage(readiness) {
  const messages = (readiness?.issues || []).map(issue => issue.message).filter(Boolean);
  return messages.join(' ') || 'Saved production data is not ready to export.';
}

async function waitForPaperworkSaves(options={}) {
  flushPaperworkDraftForExport();
  // Assignments hydrate lazily (Admin panel or hub open). If an export gates on
  // them while they still sit in their initial 'loading' state, start — or join
  // — that load instead of polling a state nothing else is going to change.
  if (options.includeAssignments !== false && paperworkExportAuthority() === 'server'
      && assignmentSaveState === 'loading') {
    try { await paperworkExportTimeout(hydrateRoleAssignments()); } catch {}
  }
  const started = Date.now();
  let readiness = paperworkExportReadiness(options);
  while (!readiness.canExport && Date.now() - started < PAPER_EXPORT_WAIT_MS) {
    if (readiness.blockingCount) break;
    await new Promise(resolve => setTimeout(resolve, 80));
    readiness = paperworkExportReadiness(options);
  }
  if (!readiness.canExport) {
    const error = new Error(paperworkExportReadinessMessage(readiness));
    error.code = 'export-not-ready';
    error.readiness = readiness;
    throw error;
  }
  if (paperworkExportAuthority() === 'server' && typeof window._waitForPendingWrites === 'function') {
    // Network-bound like the server reads — the local 8s budget was too tight
    // for a slow connection flushing this client's own queued writes.
    await paperworkExportTimeout(window._waitForPendingWrites(), PAPER_EXPORT_READ_MS,
      'Cloud saves are still pending. Reconnect and wait for Cloud saved before exporting.');
    readiness = paperworkExportReadiness(options);
    if (!readiness.canExport) {
      const error = new Error(paperworkExportReadinessMessage(readiness));
      error.code = 'export-not-ready';
      error.readiness = readiness;
      throw error;
    }
  }
  return readiness;
}

function paperworkRevisionFence(data={}, notes=[]) {
  const model = paperworkExportModel();
  const prePro = data.prePro && typeof data.prePro === 'object' ? data.prePro : {};
  return {
    rundownBatchId:String(data.rundownBatchId || ''),
    rundownUpdatedAt:Number(data.rundownUpdatedAt) || 0,
    preProUpdatedAt:Number(prePro.updatedAt) || 0,
    assignmentRevision:Math.max(0, Number(data.assignmentRevision) || 0),
    assignmentUpdatedAt:Number(data.assignmentsUpdatedAt || data.assignmentUpdatedAt) || 0,
    notesUpdatedAt:Number(data.notesUpdatedAt || 0),
    notesFingerprint:model?.fingerprint?.(notes) || '',
  };
}

function firestoreDocuments(snapshot) {
  const rows = [];
  snapshot?.forEach?.(docSnap => rows.push({ id:docSnap.id, ...(docSnap.data() || {}) }));
  return rows;
}

function mergeExportNotes(legacyNotes, canonicalNotes) {
  const merged = new Map((Array.isArray(legacyNotes) ? legacyNotes : []).map(note => [note.id, note]));
  (Array.isArray(canonicalNotes) ? canonicalNotes : []).forEach(note => merged.set(note.id, note));
  return [...merged.values()];
}

async function readServerPaperworkSnapshot(options={}) {
  if (!window._getDocFromServer || !window._getDocsFromServer) {
    const error = new Error('Server-confirmed export reads are unavailable. Reload Cueola before exporting.');
    error.code = 'export-server-reader-unavailable';
    throw error;
  }
  const model = paperworkExportModel();
  const sessionRef = window._doc(window._db, 'sessions', session.code);
  const assignmentsRef = window._collection(window._db, 'sessions', session.code, 'assignments');
  const notesRef = window._collection(window._db, 'sessions', session.code, 'notes');
  const readTimeoutMsg = 'The saved production did not download in time. Check the connection and try again.';
  for (let attempt = 0; attempt < 2; attempt++) {
    const beforeSnap = await paperworkExportTimeout(window._getDocFromServer(sessionRef), PAPER_EXPORT_READ_MS, readTimeoutMsg);
    if (!beforeSnap.exists()) {
      const error = new Error('This production no longer exists on the server.');
      error.code = 'export-session-missing';
      throw error;
    }
    const before = beforeSnap.data() || {};
    let assignments = [];
    let assignmentsMode = options.includeAssignments === false ? 'excluded' : 'canonical';
    if (options.includeAssignments !== false) {
      try {
        assignments = firestoreDocuments(await paperworkExportTimeout(window._getDocsFromServer(assignmentsRef), PAPER_EXPORT_READ_MS, readTimeoutMsg));
      } catch (error) {
        if (!pbIsPermissionDenied(error)) throw error;
        // Same degradation as notes below: rules predating the staged deploy
        // deny the subcollection — the package falls back to the legacy roster
        // already carried on the session document (prePro.roleAssignments).
        assignmentsMode = 'server legacy fallback';
      }
    }
    let canonicalNotes = [];
    let notesMode = 'excluded';
    if (options.includeNotes === true) {
      try {
        canonicalNotes = firestoreDocuments(await paperworkExportTimeout(window._getDocsFromServer(notesRef), PAPER_EXPORT_READ_MS, readTimeoutMsg));
        notesMode = 'canonical';
      } catch (error) {
        if (!pbIsPermissionDenied(error)) throw error;
        notesMode = 'server legacy fallback';
      }
    }
    const notes = options.includeNotes === true
      ? mergeExportNotes(Array.isArray(before.preProNotes) ? before.preProNotes : [], canonicalNotes)
      : [];
    // The session document arrives in ONE atomic server read — beats, prePro,
    // and the legacy roster cannot be torn against each other, so re-reading
    // the whole document to prove "stability" is unnecessary. (The old
    // before/after fence compared live-edit stamps across two sequential
    // downloads of a large document: every export raced the classroom's
    // typing and died with "the production changed…". Notes merge by id, so a
    // note posted mid-export is merely newer, never inconsistent.) The one
    // thing a re-read CAN prove is cross-document consistency: when canonical
    // assignment records were captured, confirm the register revision on the
    // document did not move while the subcollection downloaded.
    if (assignmentsMode === 'canonical' && assignments.length) {
      const checkSnap = await paperworkExportTimeout(window._getDocFromServer(sessionRef), PAPER_EXPORT_READ_MS, readTimeoutMsg);
      const revBefore = Math.max(0, Number(before.assignmentRevision) || 0);
      const revAfter = checkSnap.exists() ? Math.max(0, Number(checkSnap.data()?.assignmentRevision) || 0) : revBefore;
      if (revBefore !== revAfter) {
        if (attempt === 0) continue;
        const error = new Error('Assignments were being saved while Cueola prepared the export. Try again in a moment.');
        error.code = 'export-revision-race';
        throw error;
      }
    }
    const readiness = model.assessReadiness({ authority:'server', serverConfirmed:true });
    return model.createSnapshot({
      authority:'server',
      readiness,
      production:{ sessionCode:session.code, name:before.showName || show.name, identity:session.code },
      exportedAt:Date.now(),
      revisions:{ ...paperworkRevisionFence(before, notes), notesMode, assignmentsMode },
      show:{
        name:before.showName || show.name,
        start:normalizeTimeValue(before.startTime || show.start),
        freeMode:Boolean(before.freeMode),
        outrangutan:before.outrangutan || {},
      },
      beats:Array.isArray(before.beats) ? before.beats : [],
      prePro:before.prePro && typeof before.prePro === 'object' ? before.prePro : {},
      canonicalAssignments:assignments,
      notes,
      options:{
        includeNotes:options.includeNotes === true,
        includeAssignments:options.includeAssignments !== false,
        documentType:options.documentType || 'package',
      },
    });
  }
  throw new Error('Could not capture one stable production revision.');
}

function localPaperworkAssignments() {
  return getRoleAssignments().filter(row => row.profileId && row.positionId).map(row => ({
    assignmentId:row.assignmentId || `local_${row.profileId}_${row.positionId}`,
    productionSession:session.code || 'LOCAL',
    profileId:row.profileId,
    displayName:row.person,
    positionId:row.positionId,
    positionLabel:row.position,
    paperworkIds:row.paperworkIds || [],
    paperworkLabels:row.paperwork || [],
    status:row.status || 'assigned',
    assignedBy:row.assignedBy || 'local-operator',
    assignedByLabel:row.assignedByLabel || session.userName || 'Local operator',
    createdAt:row.createdAt || Date.now(),
    updatedAt:row.updatedAt || Date.now(),
    revision:Math.max(1, Number(row.revision) || 1),
  }));
}

function readLocalPaperworkSnapshot(options={}) {
  const model = paperworkExportModel();
  const readiness = model.assessReadiness({ authority:'local' });
  return model.createSnapshot({
    authority:'local',
    readiness,
    production:{ sessionCode:session.code || (session.isDemo ? 'DEMO' : 'LOCAL'), name:show.name, identity:session.code || 'local' },
    exportedAt:Date.now(),
    revisions:{
      rundownBatchId:rundownLastSeenBatchId || '',
      preProUpdatedAt:Number(loadPreProData().updatedAt) || 0,
      assignmentRevision,
      notesFingerprint:model.fingerprint(plandaBearNotes),
    },
    show:{ name:show.name, start:normalizeTimeValue(show.start), freeMode:freeTextMode, outrangutan:outrangutanState || {} },
    beats,
    prePro:loadPreProData(),
    canonicalAssignments:options.includeAssignments === false ? [] : localPaperworkAssignments(),
    notes:options.includeNotes === true ? plandaBearNotes : [],
    options:{
      includeNotes:options.includeNotes === true,
      includeAssignments:options.includeAssignments !== false,
      documentType:options.documentType || 'package',
    },
  });
}

async function preparePaperworkExportSnapshot(options={}) {
  await waitForPaperworkSaves(options);
  const snapshot = paperworkExportAuthority() === 'server'
    ? readServerPaperworkSnapshot(options)
    : readLocalPaperworkSnapshot(options);
  const resolved = await snapshot;
  const readiness = paperworkExportReadiness(options);
  if (!readiness.canExport) {
    const error = new Error(paperworkExportReadinessMessage(readiness));
    error.code = 'export-not-ready';
    error.readiness = readiness;
    throw error;
  }
  return resolved;
}

const PAPER_EXPORT_DOCUMENT_TITLES = {
  'plandabear-package':'Production Paperwork',
  'rundown':'Rundown',
  'call-sheet':'Call Sheet',
  'production-notes':'Production Notes',
};

function paperExportOptionsForSnapshot(snapshot, options={}) {
  const revisions = snapshot.revisions || {};
  // D9.3: the printed footer carries only a small revision stamp — revision
  // integrity still matters for classrooms, branding does not.
  const revBits = [];
  if (Number.isFinite(Number(revisions.assignmentRevision))) revBits.push(`Rev r${Number(revisions.assignmentRevision) || 0}`);
  revBits.push(paperExportDateOnlyLabel(revisions.preProUpdatedAt || snapshot.exportedAt));
  return {
    ...options,
    exportMeta:{
      productionName:snapshot.production.name,
      productionCode:snapshot.production.sessionCode || snapshot.production.productionId || 'LOCAL',
      // D2: grouped exports carry the group name in the printed header.
      documentTitle:[PAPER_EXPORT_DOCUMENT_TITLES[snapshot.options?.documentType] || '',
        snapshot.options?.groupName || ''].filter(Boolean).join(' — '),
      exportedAt:new Date(snapshot.exportedAt).toISOString(),
      sourceLabel:snapshot.labels.authority,
      revisionLabel:revBits.join(' · '),
      draftLabel:snapshot.authoritative ? '' : snapshot.labels.document || snapshot.labels.authority,
    },
    snapshotFingerprint:snapshot.fingerprint,
  };
}

function paperworkExportFailureMessage(error) {
  if (error?.readiness) return paperworkExportReadinessMessage(error.readiness);
  if (error?.code === 'permission-denied') return 'Firestore denied the saved paperwork. The staged rules need an owner deploy before production export can continue.';
  if (error?.code === 'unavailable' || error?.code === 'export-timeout') return error.message || 'The saved production is unavailable. Reconnect before exporting.';
  return error?.message || 'Could not prepare the saved paperwork export.';
}

let paperPreviewBuildSequence = 0;
let lastPaperPreview = null;

// Closing the paper preview (Done / Esc) reopens the Planda Bear hub when the
// preview replaced a Planda Bear surface — showPaperPreview hides the hub, so
// a plain hideModal would strand the user on whatever screen sits underneath.
function dismissPaperPreview() {
  hideModal('paperPreviewModal');
  if (!lastPaperPreview?.fromPlandaBear) return;
  const pbStillOpen = ['paperworkHubModal','preProModal','productionScheduleModal','safetyPlanModal','patchSheetModal','productionNotesModal']
    .some(id => document.getElementById(id)?.classList.contains('on'));
  if (!pbStillOpen) openPaperworkHub();
}

function showPaperPreview(title, html, primaryLabel='Done', primaryAction="dismissPaperPreview()", flowId=null, exportOptions={}) {
  document.getElementById('paperPreviewTitle').textContent = title;
  const previewBody = document.getElementById('paperPreviewBody');
  const sequence = ++paperPreviewBuildSequence;
  const staging = document.createElement('div');
  staging.innerHTML = String(html || '');
  const controls = [...staging.querySelectorAll('.no-print')].map(node => node.outerHTML).join('');
  staging.querySelectorAll('.no-print').forEach(node => node.remove());
  const printableHTML = staging.innerHTML;
  // Captured BEFORE the hub/editors get hidden below: dismissing the preview
  // must land back on the Planda Bear workspace it replaced, not the front page.
  const fromPlandaBear = Boolean(flowId)
    || ['paperworkHubModal','preProModal','productionScheduleModal','safetyPlanModal','patchSheetModal','productionNotesModal']
      .some(id => document.getElementById(id)?.classList.contains('on'));
  lastPaperPreview = { title, html:printableHTML, options:{...exportOptions}, flowId, sequence, fromPlandaBear };
  previewBody.style.background = 'transparent';
  previewBody.style.padding = '0';
  previewBody.innerHTML = `${controls}<div class="paper-export-loading" role="status">Building fixed-page preview…</div>`;
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
  buildPaperExportDocument(printableHTML, exportOptions).then(root => {
    if (sequence !== paperPreviewBuildSequence || !document.getElementById('paperPreviewModal')?.classList.contains('on')) {
      root.remove();
      return;
    }
    releasePaperExportDocument(root);
    const preservedControls = [...previewBody.children].filter(node => node.matches?.('.no-print'));
    previewBody.replaceChildren(...preservedControls, root);
  }).catch(error => {
    if (sequence !== paperPreviewBuildSequence) return;
    previewBody.innerHTML = `${controls}<div class="paper-export-preview-error" role="alert">Could not build the fixed-page preview. ${esc(error?.message || 'Unknown export error')}</div>`;
  });
}

let lastRundownExportSnapshot = null;
async function showRundownPaperPreview() {
  activePaperworkItemId = 'rundown';
  try {
    const snapshot = await preparePaperworkExportSnapshot({ includeAssignments:false, includeNotes:false, documentType:'rundown' });
    lastRundownExportSnapshot = snapshot;
    const options = paperExportOptionsForSnapshot(snapshot, { orientation:'landscape', allowMixedOrientation:false });
    showPaperPreview('Rundown Planda Bear Preview', `
      <h1>Full Rendered Rundown</h1>
      <p>${esc(snapshot.production.name)}</p>
      ${rundownPreviewTableHTML(snapshot)}
    `, 'Download Rundown PDF', 'exportPDF()', 'rundown', options);
  } catch (error) {
    lastRundownExportSnapshot = null;
    toast(`Rundown preview blocked: ${paperworkExportFailureMessage(error)}`);
  }
}

// Every Outrangutan link programmed on a row, for the printed rundown's
// Outrangutan column (V2 Phase 5 item 5). Names resolve from the live state
// the Outrangutan module publishes; ids print as-is when it isn't open.
function outrangutanRowSummary(b, savedState=outrangutanState) {
  const parts = [];
  for (const type of Object.keys(b.cues || {})) {
    const d = b.cues[type];
    if (d?.outCueId) { const c = savedState?.cues?.[d.outCueId]; parts.push(`Cue: ${c?.name || d.outCueId}${d.outAuto ? ' (auto)' : ''}`); }
    if (d?.outPadId) { const p = savedState?.pads?.[d.outPadId]; parts.push(`SFX pad: ${p?.name || d.outPadId}${d.outPadAuto ? ' (auto)' : ''}`); }
  }
  return parts;
}

// v2.1 D9.5: student-friendly rundown print. Reduced broadcast columns are
// the DEFAULT (all-columns stays one toggle away), the Outrangutan column is
// gone from print (stays in-app — D9.3), widths are proportional via
// <colgroup>, and every page carries a running total + total-runtime footer,
// a READY/TAKE legend, and numbered segments.
let rundownExportColumns = (() => {
  try { return localStorage.getItem('cueola_rundown_export_columns') === 'all' ? 'all' : 'broadcast'; }
  catch { return 'broadcast'; }
})();
function setRundownExportColumns(mode) {
  rundownExportColumns = mode === 'all' ? 'all' : 'broadcast';
  try { localStorage.setItem('cueola_rundown_export_columns', rundownExportColumns); } catch {}
  // Refresh whichever preview is open so the toggle answers immediately.
  if (document.getElementById('paperPreviewModal')?.classList.contains('on')) {
    if (activePaperworkItemId === 'rundown') showRundownPaperPreview();
    else showPreProPackagePreview();
  }
}

function rundownFmtTotal(secs) {
  const s = Math.max(0, Math.round(secs));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return h ? `${h}:${String(m).padStart(2,'0')}:${String(r).padStart(2,'0')}` : `${m}:${String(r).padStart(2,'0')}`;
}

function rundownPreviewTableHTML(snapshot=null) {
  const rundownBeats = Array.isArray(snapshot?.beats) ? snapshot.beats : beats;
  const rundownShow = snapshot?.show || show;
  const allColumns = rundownExportColumns === 'all';
  const cueParts = (b, type) => {
    const d = b.cues?.[type];
    const on = getCueOn(d), off = getCueOff(d);
    const scriptText = type === 'script' ? scriptCueText(d) : '';
    const script = scriptText ? `${d?.scriptType === 'Dialogue' ? 'Dialogue' : 'Script'} ${scriptLineLabel(scriptText)}` : '';
    // Same operation vocabulary as the editor and Live: on = READY (standby), off = TAKE (go).
    return [on && `<span class="cue-type">READY</span> ${esc(on)}`, off && `<span class="cue-type">TAKE</span> ${esc(off)}`, script && `<span class="cue-muted">${esc(script)}</span>`].filter(Boolean);
  };
  const cellFor = (b, type) => {
    const parts = cueParts(b, type);
    return parts.length ? parts.join('<br>') : '<span class="cue-muted">-</span>';
  };
  // Broadcast preset folds the five department columns into one labeled list.
  const combinedCues = b => {
    const lines = ['video','audio','playback','gfx','lighting'].flatMap(type => {
      const parts = cueParts(b, type);
      return parts.length ? [`<span class="cue-${type}"><span class="cue-dept">${type.toUpperCase()}</span> ${parts.join(' · ')}</span>`] : [];
    });
    return lines.length ? lines.join('<br>') : '<span class="cue-muted">-</span>';
  };
  const columnCount = allColumns ? 11 : 7;
  let offsetSecs = 0;
  let pdfCueNum = 0;
  let segmentNum = 0;
  const rows = rundownBeats.map(b => {
    const start = rundownShow.start ? clock(rundownShow.start, offsetSecs) : '-';
    offsetSecs += (b.min||0)*60+(b.sec||0);
    if (b.style === 'segment') {
      segmentNum++;
      return `<tr><td colspan="${columnCount}" style="background:#f4f5f7;font-weight:800;padding:8px 6px;font-size:10px;text-transform:uppercase;border-left:3px solid #4e5664">Segment ${segmentNum}: ${esc(b.info||'Untitled')}</td></tr>`;
    }
    pdfCueNum++;
    const total = rundownFmtTotal(offsetSecs);
    const lead = `
      <td>${pdfCueNum}</td>
      <td><strong>${esc(b.info||'-')}</strong>${b.notes?`<br><span class="cue-muted">${esc(b.notes)}</span>`:''}</td>
      <td>${start}</td>
      <td>${fmtDur(b)}</td>
      <td class="cue-total">${total}</td>`;
    if (!allColumns) {
      return `<tr>${lead}
      <td>${combinedCues(b)}</td>
      <td class="cue-script">${cellFor(b,'script')}</td>
    </tr>`;
    }
    return `<tr>${lead}
      <td class="cue-video">${cellFor(b,'video')}</td>
      <td class="cue-audio">${cellFor(b,'audio')}</td>
      <td class="cue-playback">${cellFor(b,'playback')}</td>
      <td class="cue-gfx">${cellFor(b,'gfx')}</td>
      <td class="cue-lighting">${cellFor(b,'lighting')}</td>
      <td class="cue-script">${cellFor(b,'script')}</td>
    </tr>`;
  }).join('');
  const colgroup = allColumns
    ? '<colgroup><col style="width:3%"><col style="width:15%"><col style="width:6%"><col style="width:5%"><col style="width:6%"><col style="width:11%"><col style="width:11%"><col style="width:11%"><col style="width:10%"><col style="width:10%"><col style="width:12%"></colgroup>'
    : '<colgroup><col style="width:4%"><col style="width:21%"><col style="width:7%"><col style="width:6%"><col style="width:7%"><col style="width:38%"><col style="width:17%"></colgroup>';
  const headCells = allColumns
    ? '<th>#</th><th>Row</th><th>Start</th><th>Dur</th><th>Total</th><th class="cue-video">Video</th><th class="cue-audio">Audio</th><th class="cue-playback">Playback</th><th class="cue-gfx">GFX</th><th class="cue-lighting">Lighting</th><th class="cue-script">Script</th>'
    : '<th>#</th><th>Row</th><th>Start</th><th>Dur</th><th>Total</th><th>Cues</th><th class="cue-script">Script</th>';
  const legend = `<div class="paper-rundown-legend"><b>READY</b> = standby the source · <b>TAKE</b> = go · Total = running show time</div>`;
  const columnsToggle = `
    <label class="pb-pkg-optin no-print">
      <input type="checkbox" ${allColumns ? 'checked' : ''} onchange="setRundownExportColumns(this.checked ? 'all' : 'broadcast')">
      <span>Show all department columns (broadcast preset is the default)</span>
    </label>`;
  const totalFooter = `<tfoot><tr><td colspan="4" style="text-align:right;font-weight:800">Total runtime</td><td class="cue-total" style="font-weight:800">${rundownFmtTotal(offsetSecs)}</td><td colspan="${columnCount - 5}"></td></tr></tfoot>`;
  return `<div class="paper-landscape">${columnsToggle}${legend}<table class="paper-rundown-grid">${colgroup}<thead><tr>${headCells}</tr></thead><tbody>${rows || `<tr><td colspan="${columnCount}">No rows yet.</td></tr>`}</tbody>${totalFooter}</table></div>`;
}

let lastCallSheetExportSnapshot = null;
let lastCallSheetExportIndex = 0;
async function showCallSheetPreview() {
  try {
    const snapshot = await preparePaperworkExportSnapshot({ includeAssignments:false, includeNotes:false, documentType:'call-sheet' });
    const sheets = getCallSheets(snapshot.prePro);
    const index = resolveActiveCallSheetIndex(sheets);
    lastCallSheetExportSnapshot = snapshot;
    lastCallSheetExportIndex = index;
    const options = paperExportOptionsForSnapshot(snapshot, { orientation:'portrait', allowMixedOrientation:false });
    showPaperPreview('Call Sheet Preview', callSheetPreviewHTML(normalizeCallSheet(sheets[index], index)),
      'Export Call Sheet PDF', 'downloadCallSheetPDF()', 'call-sheet', options);
  } catch (error) {
    lastCallSheetExportSnapshot = null;
    toast(`Call sheet preview blocked: ${paperworkExportFailureMessage(error)}`);
  }
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
  const label = sheet.label || sheet.sheetLabel || fallback.label || `Call Sheet ${i + 1}`;
  const generatedId = assignmentModel()?.paperworkIdFor?.(`Call Sheet: ${label}`) || `call_sheet_${i + 1}`;
  return {
    id: String(sheet.id || fallback.id || generatedId).replace(/[^A-Za-z0-9_.-]/g, '_').slice(0, 150),
    label,
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
    mealTime: normalizeTimeValue(sheet.mealTime) || normalizeTimeValue(fallback.mealTime) || '',
    people: Array.isArray(sheet.people) ? sheet.people : (Array.isArray(fallback.people) ? fallback.people : []),
    notes: sheet.notes || fallback.notes || '',
  };
}

// P2607 incident residue (2026-07-15): mixed-version saves accumulated dozens
// of orphan one-person call sheets and duplicated crew rows. These sanitizers
// run at the getCallSheets boundary, so every render, export, AND save flows
// through them — any healthy client that saves the call sheet republishes the
// cleaned array, healing the shared doc instead of re-spreading the damage.
function dedupeCallSheetPeople(people) {
  if (!Array.isArray(people)) return [];
  const seen = new Set();
  return people.filter(p => {
    if (!p || typeof p !== 'object') return false;
    const key = ['name', 'position', 'email', 'phone', 'call']
      .map(k => String(p[k] || '').trim().toLowerCase()).join('|');
    if (!key.replace(/\|/g, '')) return false;   // fully blank row
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// Content identity ignores generated ids/ord and auto-numbered "Call Sheet N"
// labels — two sheets that differ only by those are the same sheet duplicated,
// never two intentional days (a real second day differs by date/times/label).
function callSheetContentKey(sheet) {
  const label = String(sheet.label || '').trim();
  return JSON.stringify([
    /^call sheet\s*\d*$/i.test(label) ? '' : label.toLowerCase(),
    ...['production', 'date', 'call', 'showStart', 'wrap', 'doors', 'location', 'address',
      'venue', 'parking', 'entrance', 'late', 'stream', 'dress', 'meals', 'notes']
      .map(k => String(sheet[k] || '').trim().toLowerCase()),
    weatherSummaryLine(sheet.weather),
    (sheet.people || []).map(p => ['name', 'position', 'email', 'phone', 'call']
      .map(k => String(p?.[k] || '').trim().toLowerCase()).join('|')),
  ]);
}

// v2.1 D9.1 — the "52 pages" root cause. Exact-key dedupe missed P2607-style
// NEAR-duplicates (one weather refetch, one crew tweak, a custom label), so a
// corrupted doc could carry ~40 survivors into a ~52-page package. Two sheets
// are near-duplicates ONLY when no schedule field actively disagrees (two
// intentional days always differ by date/times, so they can never collapse)
// and their crews overlap. The most contentful sheet wins; ties go to the
// later (newer) entry. Runs at the getCallSheets boundary, so any healthy
// client's next save republishes the healed array.
function callSheetNearDuplicates(a, b) {
  const fields = ['date', 'call', 'showStart', 'wrap', 'doors', 'location', 'address', 'notes'];
  for (const key of fields) {
    const va = String(a[key] || '').trim().toLowerCase();
    const vb = String(b[key] || '').trim().toLowerCase();
    if (va && vb && va !== vb) return false;   // active disagreement = two real sheets
  }
  const names = sheet => new Set((sheet.people || [])
    .map(p => String(p?.name || '').trim().toLowerCase()).filter(Boolean));
  const na = names(a), nb = names(b);
  if (!na.size || !nb.size) return true;       // an empty/orphan stub folds into the fuller sheet
  let shared = 0;
  na.forEach(n => { if (nb.has(n)) shared++; });
  const jaccard = shared / (na.size + nb.size - shared);
  const subset = shared === Math.min(na.size, nb.size);
  return jaccard >= 0.5 || subset;
}

function callSheetContentScore(sheet) {
  const fields = ['label', 'date', 'call', 'showStart', 'wrap', 'doors', 'location', 'address',
    'parking', 'entrance', 'late', 'stream', 'dress', 'meals', 'notes'];
  return fields.reduce((n, key) => n + (String(sheet[key] || '').trim() ? 1 : 0), 0)
    + (sheet.people || []).length;
}

function sanitizeCallSheets(sheets) {
  const seen = new Set();
  const out = [];
  for (const sheet of sheets) {
    const clean = { ...sheet, people: dedupeCallSheetPeople(sheet.people) };
    const key = callSheetContentKey(clean);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(clean);
  }
  // Near-duplicate collapse (D9.1). Greedy single pass: each sheet either
  // beats an existing keeper (replaces it) or folds into one.
  const keepers = [];
  for (const sheet of out) {
    const matchIdx = keepers.findIndex(k => callSheetNearDuplicates(k, sheet));
    if (matchIdx < 0) { keepers.push(sheet); continue; }
    // Later entry wins ties — it's the newer save.
    if (callSheetContentScore(sheet) >= callSheetContentScore(keepers[matchIdx])) {
      keepers[matchIdx] = sheet;
    }
  }
  // Real sheets (any schedule/venue content) ahead of crew-only leftovers, so
  // a fresh device's default active sheet is never an orphaned stub.
  const hasSchedule = s => Boolean(s.date || s.call || s.showStart || s.wrap || s.location || s.address || s.venue);
  const ranked = [...keepers.filter(hasSchedule), ...keepers.filter(s => !hasSchedule(s))];
  return ranked.length ? ranked : sheets;
}

// v2.1 D6: per-workspace delete tombstones ({sheetId: deletedAtMs}) filtered
// on EVERY read. Deletion is convergent under whole-array LWW: a stale client
// that resurrects a deleted sheet is healed by the next save from any current
// client, because that save flows back through this filter.
const CALL_SHEET_TOMBSTONE_MAX_AGE_MS = 30 * 24 * 3600 * 1000;
const CALL_SHEET_TOMBSTONE_MAX_ENTRIES = 20;
function callSheetTombstones(data=loadPreProData()) {
  const map = data?.callSheetTombstones;
  return (map && typeof map === 'object' && !Array.isArray(map)) ? map : {};
}
function pruneCallSheetTombstones(map) {
  const now = Date.now();
  const entries = Object.entries(map || {})
    .filter(([, at]) => Number.isFinite(Number(at)) && now - Number(at) < CALL_SHEET_TOMBSTONE_MAX_AGE_MS)
    .sort((a, b) => Number(b[1]) - Number(a[1]))
    .slice(0, CALL_SHEET_TOMBSTONE_MAX_ENTRIES);
  return Object.fromEntries(entries);
}

function getCallSheets(data=loadPreProData()) {
  const legacy = legacyCallSheetFromData(data);
  const rawSheets = Array.isArray(data.callSheets) && data.callSheets.length ? data.callSheets : [legacy];
  const tombstones = callSheetTombstones(data);
  // Each sheet is self-contained — do NOT inherit empty fields from another sheet
  // (the shared top-level "legacy" values), which used to bleed times across days.
  const normalized = rawSheets.map((sheet, i) => normalizeCallSheet(sheet, i))
    .filter(sheet => !tombstones[sheet.id]);
  const sheets = sanitizeCallSheets(normalized);
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
  setTimeInputValue('pp-meal-time', data.mealTime || '');
  document.getElementById('pp-notes').value = data.notes || '';
  callSheetPeople = Array.isArray(data.people) && data.people.length ? data.people : [{ name:'', position:'', email:'', phone:'', call:'' }];
  renderCallSheetPeople();
}

function currentCallSheetFromForm() {
  syncCallSheetPeopleFromDOM();
  const currentId = getCallSheets()[activeCallSheetIndex]?.id || '';
  return normalizeCallSheet({
    id: currentId,
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
    mealTime: timeInputValue('pp-meal-time'),
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
  if (/partly|mostly clear|partial/.test(text)) return 'weather.partly-cloudy'; // before the generic cloudy test — "partly cloudy" is not overcast
  if (/overcast|cloudy|clouds/.test(text)) return 'weather.overcast';
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
  // Say which DAY this forecast is for — a sheet dated Friday prints Friday's
  // storm, and without the label that reads as "wrong weather" on show day.
  if (w.forecastDate) parts.push(`Forecast for ${callSheetDayLabel(w.forecastDate) || w.forecastDate}`);
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
  const idx = resolveActiveCallSheetIndex(sheets);
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
  pbNoteLocalEdit('pp-venue-group');   // hold the collab refresh off this click briefly
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
    // An auto forecast fetched for a different date than the current shoot date
    // is stale — say so loudly instead of quietly showing the wrong day's weather.
    if (w.source === 'auto' && w.forecastDate && date && w.forecastDate !== date) {
      setWeatherStatus(`This forecast is for ${callSheetDayLabel(w.forecastDate) || w.forecastDate} — tap Get forecast to refresh it for the new shoot date.`, true);
    } else {
      setWeatherStatus([w.source === 'auto' ? 'Auto forecast' : 'Manual entry', w.place, w.forecastDate].filter(Boolean).join(' · '));
    }
  } else {
    setWeatherStatus('Auto-fills from your location and shoot date. You can edit anything below.');
  }
}

function onCallSheetWeatherInput(field, value) {
  if (!callSheetWeather) {
    callSheetWeather = { conditions:'', high:'', low:'', precip:'', wind:'', sunrise:'', sunset:'', emoji:'', source:'manual', forecastDate:'', place:'', updatedAt:0 };
  }
  callSheetWeather[field] = value;
  // A hand edit makes the entry manual — and a rewritten conditions line must
  // drop the fetched icon/emoji so the symbol re-infers from the new text
  // instead of showing the old forecast's picture next to corrected words.
  callSheetWeather.source = 'manual';
  if (field === 'conditions') { callSheetWeather.symbol = ''; callSheetWeather.emoji = ''; }
  callSheetWeather.updatedAt = Date.now();
  const icoEl = document.getElementById('pp-weather-ico');
  if (icoEl) icoEl.innerHTML = sfIcon(weatherSymbolFor(callSheetWeather));
  setWeatherStatus(['Manual entry', callSheetWeather.place, callSheetWeather.forecastDate].filter(Boolean).join(' · '));
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
    const segs = s.split(',').map(x => x.trim()).filter(Boolean);
    // A zip is a 5-digit group at the END of a comma segment ("PA 19530",
    // "…, 62704") — never a leading street number ("15200 Kutztown Rd" once
    // geocoded 15200 as a French postal code and forecast the wrong country).
    const zipSeg = [...segs].reverse().find(seg => /\d{5}(?:-\d{4})?$/.test(seg));
    const zip = zipSeg ? zipSeg.match(/(\d{5})(?:-\d{4})?$/)[1] : '';
    if (zip) push(zip);
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

// When the location/address clearly names a US state ("…, PA 19530",
// "Austin, TX"), only a US geocode result is acceptable — postal-code and
// fuzzy name matches otherwise land in other countries (a 5-digit street
// number once forecast a French village). No state named → no restriction.
const US_STATE_ABBRS = new Set(['AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY','DC','PR']);
function weatherCountryHint(...sources) {
  const s = sources.map(x => String(x || '')).join(', ');
  const m = s.match(/\b([A-Z]{2})\.?\s+\d{5}(?:-\d{4})?\b/) || s.match(/,\s*([A-Z]{2})\.?\s*(?:,|$)/);
  return m && US_STATE_ABBRS.has(m[1]) ? 'US' : '';
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
    const countryHint = weatherCountryHint(location, address);
    let place = null;
    for (const q of geoQueries) {
      const geoRes = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=${countryHint ? 5 : 1}&language=en&format=json`);
      if (!geoRes.ok) throw new Error('geo');
      const results = (await geoRes.json())?.results || [];
      place = countryHint ? (results.find(r => r.country_code === countryHint) || null) : (results[0] || null);
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
  storeActiveCallSheetIndex(Math.max(0, Math.min(nextIndex, sheets.length - 1)), sheets);
  renderCallSheetSelector(sheets);
  hydrateCallSheetForm(sheets[activeCallSheetIndex]);
}

function updateActiveCallSheetLabel(value) {
  const select = document.getElementById('pp-call-sheet-select');
  if (!select?.options?.[activeCallSheetIndex]) return;
  select.options[activeCallSheetIndex].textContent = (value || '').trim() || `Call Sheet ${activeCallSheetIndex + 1}`;
}

// Structure changes (add/delete sheets) stay with instructors/admins; a solo
// local workspace (no shared code) is always the operator's own to edit.
function canManageCallSheetStructure() {
  return Boolean(adminSession || session.role === 'instructor' || session.isDemo || session.isExpert || !session.code);
}

// v2.1 D6: instructor/admin-gated hard delete with a per-workspace tombstone
// so the deletion converges across stale clients. Never deletes the last
// sheet (the min-1 guard avoids the legacy-field ghost). Assignment rows
// pointing at this sheet's paperwork label are stripped with a toast naming
// the affected students. Session History remains the undo of last resort.
function deleteCallSheet(index=resolveActiveCallSheetIndex()) {
  if (!canManageCallSheetStructure()) { toast('Only an instructor or admin can delete a call sheet.'); return; }
  const data = saveCallSheetStateLocally(false);
  const sheets = getCallSheets(data);
  if (sheets.length <= 1) { toast('A session always keeps at least one call sheet.'); return; }
  const idx = Math.max(0, Math.min(Number(index) || 0, sheets.length - 1));
  const sheet = sheets[idx];
  const sheetLabel = `Call Sheet: ${callSheetDisplayName(sheet, idx)}`.toLowerCase();
  const savedRows = Array.isArray(data.roleAssignments) ? data.roleAssignments : [];
  const affected = savedRows.filter(row => (Array.isArray(row?.paperwork) ? row.paperwork : [])
    .some(item => String(item || '').trim().toLowerCase() === sheetLabel));
  const affectedNames = cleanUniqueStrings(affected.map(row => row?.person || row?.name)).filter(Boolean);
  const detail = affectedNames.length
    ? `Assigned to: ${affectedNames.join(', ')}. Their call-sheet assignment will be removed.`
    : 'No students are assigned to this sheet.';
  if (!dangerConfirm(`Delete "${callSheetDisplayName(sheet, idx)}"?`, `${detail} Session History remains the undo of last resort.`, { requireText:'DELETE' })) return;
  const remaining = sheets.filter((_, i) => i !== idx);
  const tombstones = pruneCallSheetTombstones({ ...callSheetTombstones(data), [sheet.id]: Date.now() });
  const strippedRows = savedRows.map(row => {
    if (!Array.isArray(row?.paperwork)) return row;
    const kept = row.paperwork.filter(item => String(item || '').trim().toLowerCase() !== sheetLabel);
    return kept.length === row.paperwork.length ? row : { ...row, paperwork: kept };
  });
  const nextIdx = Math.max(0, Math.min(idx, remaining.length - 1));
  storeActiveCallSheetIndex(nextIdx, remaining);
  persistPreProData({
    ...data,
    callSheets: remaining,
    callSheetTombstones: tombstones,
    roleAssignments: strippedRows,
    updatedAt: Date.now(),
  }, 'Call Sheet');
  renderCallSheetSelector(remaining);
  hydrateCallSheetForm(remaining[nextIdx]);
  renderPackageSheetPicker();
  toast(affectedNames.length
    ? `Call sheet deleted. Removed from: ${affectedNames.join(', ')}.`
    : 'Call sheet deleted.');
}

function addAnotherCallSheet() {
  const data = saveCallSheetStateLocally(false);
  const sheets = getCallSheets(data);
  const source = sheets[resolveActiveCallSheetIndex(sheets)] || sheets[0] || legacyCallSheetFromData(data);
  // Copy the venue + crew roster, but start the schedule fresh so the new day's
  // sheet doesn't inherit the previous day's call/show/wrap times.
  const nextSheet = normalizeCallSheet({
    ...source,
    id: '',   // never inherit the source's paperwork id — a duplicate id makes the two sheets inseparable in role assignments
    label: `Call Sheet ${sheets.length + 1}`,
    date: '', call: '', showStart: '', wrap: '', doors: '',
    weather: null, // new day → fetch fresh forecast; venue carries over from source
    people: (Array.isArray(source.people) ? source.people : []).map(p => ({ ...p, call:'' })),
  }, sheets.length);
  sheets.push(nextSheet);
  storeActiveCallSheetIndex(sheets.length - 1, sheets);
  // Re-creating a sheet whose generated id collides with a tombstoned one
  // clears that tombstone — otherwise the new sheet would vanish on next read.
  const tombstones = { ...callSheetTombstones(data) };
  delete tombstones[nextSheet.id];
  const next = { ...data, ...nextSheet, callSheets:sheets, callSheetTombstones:pruneCallSheetTombstones(tombstones), updatedAt:Date.now() };
  persistPreProData(next, 'Call Sheet');
  renderCallSheetSelector(sheets);
  hydrateCallSheetForm(nextSheet);
  renderPackageSheetPicker();
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
    return saveCallSheet(false);
  }
  const data = loadPreProData();
  const sheets = getCallSheets(data);
  const idx = resolveActiveCallSheetIndex(sheets);
  return normalizeCallSheet(sheets[idx], idx);
}

function showPatchSheetPreview(kind) {
  openPatchSheetEditor(kind);
}

// Paper-friendly formats: the editors store ISO dates and 24-hour times (native
// date/time inputs), but paperwork reads better as 'Friday, Aug 1, 2026' and
// '7:30 PM' — matching the rundown pages in the same package. Non-date/non-time
// text (free-text doors, 'N/A') passes through untouched.
function paperDate(v) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(v || '').trim());
  if (!m) return v || '';
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return isNaN(d) ? (v || '') : d.toLocaleDateString(undefined, { weekday:'long', year:'numeric', month:'short', day:'numeric' });
}
// v2.1 D9.6: the single print choke point for times — an empty time prints
// '--:--' (matching what the type=time inputs show on screen); an explicit
// 'N/A' passes through untouched.
function paperTime(v) {
  const s = String(v || '').trim();
  if (!s) return '--:--';
  if (s === 'N/A') return s;
  const t = timeTo24(s);
  if (!t) return s;
  let [h, mm] = t.split(':').map(Number);
  const ap = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${h}:${String(mm).padStart(2, '0')} ${ap}`;
}

// v2.1 D9.7: day-of-days over the sheet set (chronological, dated sheets only).
function callSheetDayOfDays(sheet, prePro) {
  try {
    const dated = getCallSheets(prePro).filter(s => s.date).sort((a, b) => a.date.localeCompare(b.date));
    if (dated.length < 2 || !sheet.date) return '';
    const idx = dated.findIndex(s => s.id === sheet.id);
    return idx >= 0 ? `Day ${idx + 1} of ${dated.length}` : '';
  } catch { return ''; }
}

function callSheetPreviewHTML(data, prePro=loadPreProData()) {
  const title = callSheetTitle(data);
  const people = (data.people || []).filter(p => p.name || p.position || p.role || p.email || p.phone || p.call);
  const peopleRows = people.map(p => `<tr><td>${esc(p.name || '')}</td><td>${esc(p.position || p.role || '')}</td><td>${esc(p.email || '')}</td><td>${esc(p.phone || '')}</td><td>${esc(paperTime(p.call || data.call || ''))}</td></tr>`).join('');
  const notes = (data.notes || '').trim();
  const dayOfDays = callSheetDayOfDays(data, prePro);
  // D9.7: nearest hospital single-sourced with the Safety Plan — enter it once.
  const safety = prePro?.safety || {};
  const hospitalBits = [safety.hospital, safety.hospitalAddress, safety.hospitalPhone]
    .map(v => String(v || '').trim()).filter(Boolean);
  const meals = [data.mealTime ? paperTime(data.mealTime) : '', String(data.meals || '').trim()]
    .filter(Boolean).join(' — ');
  return `
    <h1 class="psec-h psec-callsheet">${esc(title)}</h1>
    ${dayOfDays ? `<div class="paper-day-of-days">${esc(dayOfDays)}</div>` : ''}
    <table><tbody>
      <tr><th>Production</th><td>${esc(data.production || show.name || '')}</td></tr>
      <tr><th>Shoot Date</th><td>${esc(paperDate(data.date))}${dayOfDays ? ` · ${esc(dayOfDays)}` : ''}</td></tr>
      <tr><th>Call Time</th><td>${esc(paperTime(data.call))}</td></tr>
      <tr><th>Doors Open</th><td>${esc(paperTime(data.doors))}</td></tr>
      <tr><th>Show Start</th><td>${esc(paperTime(data.showStart))}</td></tr>
      <tr><th>Estimated Wrap</th><td>${esc(paperTime(data.wrap))}</td></tr>
      <tr><th>Location</th><td>${esc(data.location || '')}</td></tr>
      <tr><th>Address</th><td>${esc(data.address || '')}</td></tr>
      <tr><th>Venue</th><td>${esc(venueLabel(data.venue))}</td></tr>
      <tr><th>Weather</th><td>${esc(weatherSummaryLine(data.weather))}</td></tr>
      <tr><th>Parking</th><td>${esc(data.parking || '')}</td></tr>
      <tr><th>Entrance</th><td>${esc(data.entrance || '')}</td></tr>
      <tr><th>Late / Lost Contact</th><td>${esc(data.late || '')}</td></tr>
      <tr><th>Stream Information</th><td>${esc(data.stream || '')}</td></tr>
      <tr><th>Dress Code</th><td>${esc(data.dress || '')}</td></tr>
      <tr><th>Meals</th><td>${esc(meals)}</td></tr>
      ${hospitalBits.length ? `<tr><th>Nearest Hospital</th><td>${hospitalBits.map(esc).join(' · ')}</td></tr>` : ''}
    </tbody></table>
    <h2>Crew / Talent</h2>
    <table><thead><tr><th>Name</th><th>Position</th><th>Email</th><th>Phone</th><th>Call</th></tr></thead><tbody>${peopleRows || '<tr><td colspan="5">No crew or talent entered yet.</td></tr>'}</tbody></table>
    ${notes ? `<h2>General Notes</h2>
    <table><tbody><tr><td>${esc(notes)}</td></tr></tbody></table>` : ''}`;
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
  `, 'Done', 'dismissPaperPreview()', null);
}

function openSafetyPlan() {
  activePaperworkItemId = 'safety-plan';
  hideModal('paperworkHubModal');
  const data = loadPreProData();
  const safety = data.safety || {};
  document.getElementById('sp-hospital').value = safety.hospital || data.hospital || '';
  document.getElementById('sp-hospital-address').value = safety.hospitalAddress || '';
  document.getElementById('sp-hospital-phone').value = safety.hospitalPhone || '';
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
  // When the field is on screen its value is the truth — including an
  // intentionally cleared '' (which returns the note to the call-sheet auto
  // weather). Only fall back to the stored note when the modal isn't open.
  const wxEl = document.getElementById('sp-weather');
  const wxVal = wxEl ? wxEl.value.trim() : existingWeather;
  const wxAuto = safetyPlanWeatherAutoText(data);
  return {
    hospital: document.getElementById('sp-hospital')?.value?.trim() ?? existing.hospital ?? '',
    hospitalAddress: document.getElementById('sp-hospital-address')?.value?.trim() ?? existing.hospitalAddress ?? '',
    hospitalPhone: document.getElementById('sp-hospital-phone')?.value?.trim() ?? existing.hospitalPhone ?? '',
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

function safetyPlanHTML(safety, data=loadPreProData(), sectionNumber=paperworkSectionNumber('safety-plan')) {
  const safetyWeather = typeof safety.weather === 'string' ? safety.weather : '';
  return `
    <h1 class="psec-h psec-safety">${paperSectionTitle(sectionNumber, 'Safety Plan')}</h1>
    <table><tbody>
      <tr><th>Local Hospital</th><td>${esc([safety.hospital, safety.hospitalAddress, safety.hospitalPhone].map(v => String(v || '').trim()).filter(Boolean).join(' · '))}</td></tr>
      <tr><th>Weather</th><td>${esc(safetyWeather || safetyPlanWeatherAutoText(data))}</td></tr>
      <tr><th>First Aid Kit Location</th><td>${esc(safety.firstAid || '')}</td></tr>
      <tr><th>Fire Extinguisher Location</th><td>${esc(safety.fire || '')}</td></tr>
      <tr><th>Emergency Numbers</th><td>${esc(safety.emergency || '')}</td></tr>
      <tr><th>Non-Emergency Numbers</th><td>${esc(safety.nonemergency || '')}</td></tr>
      <tr><th>Security</th><td>${esc(safetySecurityValue(safety.security) || '')}</td></tr>
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
    // Stable row identity for leaf-granular sync (PB_COLLAB_PLAN.md).
    ...(row?.id ? { id: String(row.id) } : {}),
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
  document.getElementById('ps-doors').value = timeTo24(schedule.doors || '') || '';
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
  // -1 = no positional guide fallback: rendering a user-added empty row with
  // its array index used to stamp a default check's text into it.
  const rows = (Array.isArray(items) && items.length ? items : defaultProductionSchedule().checklist).map(row => normalizeProductionChecklistRow(row, -1));
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
        <input type="hidden" data-ps-row="${i}" data-ps-field="id" value="${esc(row.id||'')}">
        <input type="hidden" data-ps-row="${i}" data-ps-field="area" value="${esc(row.area||'')}">
        <input type="hidden" data-ps-row="${i}" data-ps-field="hint" value="${esc(row.hint||'')}">
        <input type="hidden" data-ps-row="${i}" data-ps-field="doneBy" value="${esc(row.doneBy||'')}">
        <input type="hidden" data-ps-row="${i}" data-ps-field="doneAt" value="${esc(String(row.doneAt||0))}">
      </div>
    `).join('')}
    <button class="call-add-btn" onclick="addProductionChecklistRow()">${sfIcon('action.add')}<span>Add checklist item</span></button>
  </div>`;
}

// Collect the checklist exactly as typed. -1 disables the positional guide
// fallback in normalizeProductionChecklistRow — that fallback exists to repair
// legacy saves of the DEFAULT rows, but applied to a user-added row it used to
// FABRICATE a default item into a row the user left empty.
function collectProductionChecklistRows(keepBlank=false) {
  const rows = [];
  document.querySelectorAll('[data-ps-row]').forEach(input => {
    const idx = Number(input.dataset.psRow);
    const field = input.dataset.psField;
    if (!rows[idx]) rows[idx] = {};
    rows[idx][field] = field === 'done' ? input.checked : input.value.trim();
  });
  const mapped = rows.filter(Boolean).map(row => normalizeProductionChecklistRow(row, -1));
  return keepBlank ? mapped : mapped.filter(row => row.area || row.item || row.done);
}

function addProductionChecklistRow() {
  const rows = collectProductionChecklistRows(true);
  rows.push({ area:'', item:'', hint:'', done:false });
  renderProductionChecklist(rows);
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
  renderProductionChecklist(collectProductionChecklistRows(true)); // show the sign-off line, keep in-progress blank rows
  paperworkDirty = false;   // the toggle already persisted — don't leave a stale dirty flag
}

function removeProductionChecklistRow(idx) {
  const rows = collectProductionChecklistRows(true);
  rows.splice(idx, 1);
  renderProductionChecklist(rows.length ? rows : [{ area:'', item:'', hint:'', done:false }]);
  saveProductionSchedule(false);   // a deletion is a real edit — persist it like the tick box does
  paperworkDirty = false;
}

function getProductionScheduleData() {
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
    checklist: collectProductionChecklistRows(false),
  };
}

function saveProductionSchedule(showToastOnSave=true) {
  persistPreProData({ productionSchedule: getProductionScheduleData() }, 'Production Schedule');
  if (showToastOnSave) toast('Production schedule saved.');
}

function productionScheduleHTML(schedule, data=loadPreProData(), sectionNumber=paperworkSectionNumber('production-scheduler')) {
  const s = productionScheduleWithCallSheet(schedule || {}, data);
  const rows = (s.checklist || []).map(normalizeProductionChecklistRow).map(row => `<tr><td>${row.done ? 'Yes' : 'No'}</td><td>${esc(row.item || '')}</td><td>${row.done && row.doneBy ? esc(row.doneBy) + (row.doneAt ? ` (${esc(new Date(row.doneAt).toLocaleString())})` : '') : '—'}</td></tr>`).join('');
  const setupBody = s.setupNA
    ? `<tr><td>No separate setup day — setup happens on show day.</td></tr>`
    : `<tr><th>Setup Date</th><td>${esc(paperDate(s.date))}</td></tr>
      <tr><th>Setup Start</th><td>${esc(paperTime(s.setup))}</td></tr>
      <tr><th>Setup Wrap</th><td>${esc(paperTime(s.wrap))}</td></tr>
      <tr><th>Setup Notes</th><td>${esc(s.setupNotes || '')}</td></tr>`;
  return `
    <h1 class="psec-h psec-schedule">${paperSectionTitle(sectionNumber, 'Production Schedule')}</h1>
    <h2>Setup Day${s.setupNA ? ' — N/A' : ''}</h2>
    <table><tbody>
      ${setupBody}
    </tbody></table>
    <h2>Show Day</h2>
    <table><tbody>
      <tr><th>Show Day</th><td>${esc(paperDate(s.showDate || s.date))}</td></tr>
      <tr><th>Crew Call</th><td>${esc(paperTime(s.call))}</td></tr>
      <tr><th>Doors Open</th><td>${esc(paperTime(s.doors))}</td></tr>
      <tr><th>Show Start</th><td>${esc(paperTime(s.show))}</td></tr>
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

// D9.9: real example placeholders, not key echoes — students copy the shape.
const PATCH_FIELD_PLACEHOLDERS = {
  video: { label:'e.g. CAM 2', destination:'e.g. TX1 · SDI in 2', source:'e.g. Sony FX6 on tripod', cabling:'e.g. 50ft SDI via floor run', notes:'e.g. Shading from CCU 2' },
  audio: { label:'e.g. Host mic', destination:'e.g. Board ch 1', source:'e.g. SM7B on boom', cabling:'e.g. XLR snake ch 1', notes:'e.g. Backup lav on ch 5' },
  comms: { position:'e.g. Show Caller', out:'e.g. Channel A', gear:'e.g. Wired beltpack 3', notes:'e.g. Talks to camera + playback' },
};
function patchInput(value, kind, row, field) {
  const id = `pb-patch-${kind}-${row}-${field}`;
  const label = `${kind === 'comms' ? 'Comms' : kind === 'audio' ? 'Audio' : 'Video'} row ${Number(row) + 1} ${field}`;
  const placeholder = PATCH_FIELD_PLACEHOLDERS[kind]?.[field] || field.charAt(0).toUpperCase() + field.slice(1);
  return `<input id="${esc(id)}" class="field-in" data-patch-kind="${kind}" data-patch-row="${row}" data-patch-field="${field}" value="${esc(value || '')}" placeholder="${esc(placeholder)}" aria-label="${esc(label)}">`;
}

function renderPatchTable(kind, title) {
  const rows = getPatchRows(kind);
  const isComms = kind === 'comms';
  const heads = isComms ? ['Position','Out','Gear','Notes'] : ['Label','Destination','Source','Cabling','Notes'];
  const moveCell = (i) => `<div class="patch-move">
          <button class="patch-move-btn" onclick="movePatchRow('${kind}',${i},-1)" title="Move row up" aria-label="Move ${kind} row ${i + 1} up" ${i === 0 ? 'disabled' : ''}>${sfIcon('chevron.up')}</button>
          <button class="patch-move-btn" onclick="movePatchRow('${kind}',${i},1)" title="Move row down" aria-label="Move ${kind} row ${i + 1} down" ${i === rows.length - 1 ? 'disabled' : ''}>${sfIcon('chevron.down')}</button>
        </div>`;
  return `
    <div class="field">
      <label class="field-lbl">${title}</label>
      <div class="field-hint">Type directly in the first row. Use Add row for another line, or import a CSV/TSV. The arrows reorder rows.</div>
      <div class="patch-table ${isComms ? 'comms' : kind}" id="${kind}-patch-table">
        ${heads.map(h => `<div class="patch-head">${h}</div>`).join('')}<div class="patch-head"></div><div class="patch-head"></div>
        ${rows.map((row,i) => (row.id ? `<input type="hidden" data-patch-kind="${kind}" data-patch-row="${i}" data-patch-field="id" value="${esc(row.id)}">` : '') + (isComms ? `
          ${patchInput(row.position, kind, i, 'position')}
          ${patchInput(row.out, kind, i, 'out')}
          ${patchInput(row.gear, kind, i, 'gear')}
          ${patchInput(row.notes, kind, i, 'notes')}
          ${moveCell(i)}
          <button class="patch-remove" onclick="removePatchRow('${kind}',${i})" title="Remove row" aria-label="Remove ${kind} row ${i + 1}">x</button>
        ` : `
          ${patchInput(row.label, kind, i, 'label')}
          ${patchInput(row.destination, kind, i, 'destination')}
          ${patchInput(row.source, kind, i, 'source')}
          ${patchInput(row.cabling, kind, i, 'cabling')}
          ${patchInput(row.notes, kind, i, 'notes')}
          ${moveCell(i)}
          <button class="patch-remove" onclick="removePatchRow('${kind}',${i})" title="Remove row" aria-label="Remove ${kind} row ${i + 1}">x</button>
        `)).join('')}
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
  // Row identity rides a hidden id cell (PB_COLLAB_PLAN.md); an id alone does
  // not make a row non-blank, and empty ids are dropped so fresh rows get one.
  rows.forEach(row => { if (row && !row.id) delete row.id; });
  return keepBlank ? rows.filter(Boolean) : rows.filter(row => Object.entries(row).some(([k, v]) => k !== 'id' && Boolean(v)));
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

// Reorder a patch row (the ▲/▼ arrows). Reads the grid as typed (blanks kept),
// swaps, persists, and re-renders — then puts focus back on the same arrow at
// the row's new index so keyboard users can keep stepping it.
function movePatchRow(kind, idx, delta) {
  const rows = collectPatchRows(kind, true);
  const to = idx + delta;
  if (to < 0 || to >= rows.length) return;
  [rows[idx], rows[to]] = [rows[to], rows[idx]];
  saveVisiblePatchRows({ [kind]: rows }, kind);
  pbRenderPatchBody();
  setTimeout(() => {
    const table = document.getElementById(`${kind}-patch-table`);
    const btn = table?.querySelectorAll('.patch-move')[to]?.children[delta < 0 ? 0 : 1];
    if (btn && !btn.disabled) btn.focus();
  }, 0);
}

function savePatchSheet(showToastOnSave=true) {
  const editingCell = document.activeElement?.closest?.('.patch-table');
  if (activePatchKind === 'video') {
    savePatchRows('video', collectPatchRows('video'));
    if (showToastOnSave) toast('Video patch sheet saved.');
  } else {
    savePatchRows('audio', collectPatchRows('audio'));
    savePatchRows('comms', collectPatchRows('comms'));
    if (showToastOnSave) toast('Audio and comms patch sheets saved.');
  }
  // Saving drops all-blank rows and compacts indices — re-render so the DOM's
  // data-patch-row indices line up with the stored array again (unless the user
  // is mid-keystroke in a cell; the next idle refresh reconciles then).
  if (!editingCell) pbRenderPatchBody();
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
    // RFC-4180-aware split: spreadsheet exports quote any cell containing the
    // delimiter ("Vocal, lead") and escape quotes by doubling them — a bare
    // split(',') shears those cells apart and leaks stray quote characters.
    const splitDelimited = (line, sep) => {
      const cols = [];
      let cur = '', inQ = false;
      for (let c = 0; c < line.length; c++) {
        const ch = line[c];
        if (inQ) {
          if (ch === '"') { if (line[c + 1] === '"') { cur += '"'; c++; } else inQ = false; }
          else cur += ch;
        } else if (ch === '"' && cur === '') inQ = true;
        else if (ch === sep) { cols.push(cur); cur = ''; }
        else cur += ch;
      }
      cols.push(cur);
      return cols.map(v => v.trim());
    };
    const rows = lines.map(line => {
      const cols = splitDelimited(line, line.includes('\t') ? '\t' : ',');
      if (kind === 'comms') return { position:cols[0]||'', out:cols[1]||'', gear:cols[2]||'', notes:cols.slice(3).join(', ')||'' };
      return { label:cols[0]||'', destination:cols[1]||'', source:cols[2]||'', cabling:cols[3]||'', notes:cols.slice(4).join(', ')||'' };
    });
    saveVisiblePatchRows({ [kind]: rows }, kind);
    openPatchSheetEditor(activePatchKind || kind);
    toast('Patch rows imported.');
  };
  reader.readAsText(file);
}

function patchTableHTML(kind, title, data=null) {
  const key = `${kind}PatchRows`;
  const sourceRows = data && Array.isArray(data[key]) ? data[key] : getPatchRows(kind);
  const rows = sourceRows.filter(row => Object.values(row).some(Boolean));
  const isComms = kind === 'comms';
  const body = rows.map(row => isComms
    ? `<tr><td>${esc(row.position || '')}</td><td>${esc(row.out || '')}</td><td>${esc(row.gear || '')}</td><td>${esc(row.notes || '')}</td></tr>`
    : `<tr><td>${esc(row.label || '')}</td><td>${esc(row.destination || '')}</td><td>${esc(row.source || '')}</td><td>${esc(row.cabling || '')}</td><td>${esc(row.notes || '')}</td></tr>`
  ).join('');
  return `<h2>${title}</h2><table><thead><tr>${isComms ? '<th>Position</th><th>Out</th><th>Gear</th><th>Notes</th>' : '<th>Label</th><th>Destination</th><th>Source</th><th>Cabling</th><th>Notes</th>'}</tr></thead><tbody>${body || `<tr><td colspan="${isComms ? 4 : 5}">No rows saved yet.</td></tr>`}</tbody></table>`;
}

function showPatchSheetPaperPreview(kind=activePatchKind || 'video') {
  savePatchSheet(false);
  // Section numbers come from the shared builder (D6) so a single-sheet
  // preview and the full package can never disagree.
  if (kind === 'video') {
    showPaperPreview('Video Patch Sheet Preview', `
      <h1 class="psec-h psec-video">${paperSectionTitle(paperworkSectionNumber('video-patch'), 'Video Patch Sheet')}</h1>
      ${patchTableHTML('video', 'Video Patch Sheet')}
    `, 'Back to Editor', "hideModal('paperPreviewModal');openPatchSheetEditor('video')", 'video-patch');
    return;
  }
  showPaperPreview('Audio and Comms Patch Sheet Preview', `
    <h1 class="psec-h psec-audio">${paperSectionTitle(paperworkSectionNumber('audio-comms-patch'), 'Audio and Comms Patch Sheets')}</h1>
    ${patchTableHTML('audio', 'Audio Patch Sheet')}
    ${patchTableHTML('comms', 'Comms Patch Sheet')}
  `, 'Back to Editor', "hideModal('paperPreviewModal');openPatchSheetEditor('audio-comms')", 'audio-comms-patch');
}

// Production Notes are a working discussion board, not deliverable paperwork —
// so they're EXCLUDED from the exported package unless the user opts in here.
let pbPackageIncludeNotes = false;
let lastPackageExportSnapshot = null;

// D9.1: export-time call-sheet picker. Device-local exclude set; the export
// snapshot carries the resulting INCLUDED ids inside its fingerprinted
// options, so preview reuse can never serve a stale sheet selection. At least
// one sheet always stays included.
let pbPackageSheetExcludes = new Set();
function packageIncludedCallSheetIds(sheets=getCallSheets()) {
  const included = sheets.filter(sheet => !pbPackageSheetExcludes.has(sheet.id)).map(sheet => sheet.id);
  return (included.length ? included : sheets.slice(0, 1).map(sheet => sheet.id)).sort();
}
function pbToggleExportSheet(id, on) {
  if (on) pbPackageSheetExcludes.delete(id);
  else pbPackageSheetExcludes.add(id);
  renderPackageSheetPicker();
}
function renderPackageSheetPicker() {
  const host = document.getElementById('packageExportOptions');
  if (!host) return;
  const sheets = getCallSheets();
  if (sheets.length <= 1) { host.innerHTML = ''; host.hidden = true; return; }
  // Prune excludes for sheets that no longer exist (sanitizer collapse, delete).
  const ids = new Set(sheets.map(sheet => sheet.id));
  pbPackageSheetExcludes.forEach(id => { if (!ids.has(id)) pbPackageSheetExcludes.delete(id); });
  const includedCount = sheets.filter(sheet => !pbPackageSheetExcludes.has(sheet.id)).length || 1;
  // An unusual sheet count is the honest tell for a corrupted doc (D9.1).
  const warning = sheets.length > 6
    ? `<div class="pb-pkg-sheet-warning">This package includes ${sheets.length} call sheets — that is unusually many. Uncheck any that should not print.</div>`
    : '';
  host.hidden = false;
  host.innerHTML = `
    <div class="pb-pkg-sheet-picker">
      <div class="pb-pkg-sheet-picker-title">Call sheets in the package · ${includedCount} of ${sheets.length}</div>
      ${warning}
      ${sheets.map((sheet, i) => `
        <label class="pb-pkg-optin">
          <input type="checkbox" ${pbPackageSheetExcludes.has(sheet.id) ? '' : 'checked'}
            onchange="pbToggleExportSheet('${esc(sheet.id)}', this.checked)">
          <span>${esc(callSheetDisplayName(sheet, i))}${sheet.date ? ` · ${esc(sheet.date)}` : ''}</span>
        </label>`).join('')}
    </div>`;
}

async function showPreProPackagePreview() {
  try {
    if (paperworkExportAuthority() === 'local' && pbPackageIncludeNotes) await loadPlandaBearNotes();
    const snapshot = await preparePaperworkExportSnapshot({
      includeNotes:pbPackageIncludeNotes,
      includeAssignments:true,
      documentType:'plandabear-package',
      callSheetIds:packageIncludedCallSheetIds(),
      paperwork:disabledPaperworkOptions(),
      ...(groupActive() ? { groupId: activeGroupId, groupName: activeGroupName() } : {}),
    });
    lastPackageExportSnapshot = snapshot;
    const options = paperExportOptionsForSnapshot(snapshot, { orientation:'portrait', allowMixedOrientation:true });
    showPaperPreview('PDF Package Preview', preProPackageHTML(false, snapshot), 'Export PDF Package', 'exportPreProPackagePDF()', null, options);
  } catch (error) {
    lastPackageExportSnapshot = null;
    toast(`Package preview blocked: ${paperworkExportFailureMessage(error)}`);
  }
}
function pbTogglePackageNotes(on) {
  pbPackageIncludeNotes = !!on;
  showPreProPackagePreview();
}

function assignmentRegisterHTML(snapshot, sectionNumber=paperworkSectionNumber('assignment-register', snapshot)) {
  const groups = Array.isArray(snapshot?.assignmentGroups) ? snapshot.assignmentGroups : [];
  const rows = groups.flatMap(group => group.roles.map((role, index) => `
    <tr>
      <td><strong>${esc(group.displayName || 'Unnamed student')}</strong><br><span class="cue-muted">${esc(group.profileId)}</span></td>
      <td>${esc(role.positionLabel || role.positionId)}</td>
      <td>${role.status === 'completed' ? 'Completed' : 'Assigned'}</td>
      <td>${role.paperwork.length ? role.paperwork.map(item => esc(item.paperworkLabel)).join('<br>') : 'None required'}</td>
      <td>${esc(role.assignedByLabel || role.assignedBy || 'Unknown')}</td>
      <td>${role.updatedAt ? esc(new Date(role.updatedAt).toLocaleString()) : 'Not recorded'}</td>
    </tr>`));
  return `
    <h1 class="psec-h psec-register">${paperSectionTitle(sectionNumber, 'Student Positions and Required Paperwork')}</h1>
    <p>Who holds each position, and the paperwork that position owns.</p>
    <table class="paper-assignment-register">
      <thead><tr><th>Student profile</th><th>Position</th><th>Status</th><th>Required paperwork</th><th>Assigned by</th><th>Updated</th></tr></thead>
      <tbody>${rows.join('') || '<tr><td colspan="6">No canonical assignments were saved for this production.</td></tr>'}</tbody>
    </table>`;
}

function preProPackageHTML(forExport=false, snapshot=null) {
  const data = snapshot?.prePro || loadPreProData();
  // D6: one numbering map drives which sections render AND what number each
  // gets — a disabled type renumbers the package and the per-item previews
  // identically because both consult the same builder.
  const numbers = paperworkSectionNumbers(snapshot);
  const allSheets = getCallSheets(data);
  // D9.1: export-time sheet picker — the snapshot's fingerprinted options
  // carry the included sheet ids; absent means every sheet.
  const pickedIds = Array.isArray(snapshot?.options?.callSheetIds) ? snapshot.options.callSheetIds : null;
  const pickedSheets = pickedIds ? allSheets.filter(sheet => pickedIds.includes(sheet.id)) : allSheets;
  const callSheets = pickedSheets.length ? pickedSheets : allSheets.slice(0, 1);
  const includePackageNotes = snapshot ? snapshot.options?.includeNotes === true : pbPackageIncludeNotes;
  const noteCount = Array.isArray(snapshot?.notes) ? snapshot.notes.length : plandaBearNotes.length;
  const notesToggle = forExport ? '' : `
    <label class="pb-pkg-optin no-print">
      <input type="checkbox" ${includePackageNotes ? 'checked' : ''} onchange="pbTogglePackageNotes(this.checked)">
      <span>Include Production Notes in this package${noteCount ? ` (${noteCount} note${noteCount === 1 ? '' : 's'})` : ''}</span>
    </label>`;
  const sections = [];
  if (numbers.has('call-sheet')) {
    sections.push(callSheets.map((sheet, i) => `
      ${i > 0 ? '<div class="paper-page-break"></div>' : ''}
      <section>${callSheetPreviewHTML(sheet, data)}</section>`).join(''));
  }
  if (numbers.has('production-scheduler')) {
    const schedule = productionScheduleWithCallSheet(data.productionSchedule || {}, data);
    sections.push(`<section>${productionScheduleHTML(schedule, data, numbers.get('production-scheduler'))}</section>`);
  }
  if (numbers.has('safety-plan')) {
    sections.push(`<section>${safetyPlanHTML(data.safety || {}, data, numbers.get('safety-plan'))}</section>`);
  }
  sections.push(`<section>
    ${assignmentRegisterHTML(snapshot || { production:{sessionCode:session.code}, assignmentGroups:[] }, numbers.get('assignment-register'))}
    </section>`);
  if (numbers.has('rundown')) {
    sections.push(`<section><div class="paper-landscape">
      <h1 class="psec-h psec-rundown">${paperSectionTitle(numbers.get('rundown'), 'Full Rendered Rundown')}</h1>
      <div>${esc(snapshot?.production?.name || show.name || 'Rundown')}</div>
      ${rundownPreviewTableHTML(snapshot)}
    </div>
    </section>`);
  }
  if (numbers.has('video-patch')) {
    sections.push(`<section>
    <h1 class="psec-h psec-video">${paperSectionTitle(numbers.get('video-patch'), 'Video Patch Sheet')}</h1>
    ${patchTableHTML('video', 'Video Patch Sheet', data)}
    </section>`);
  }
  if (numbers.has('audio-comms-patch')) {
    sections.push(`<section>
    <h1 class="psec-h psec-audio">${paperSectionTitle(numbers.get('audio-comms-patch'), 'Audio and Comms Patch Sheets')}</h1>
    ${patchTableHTML('audio', 'Audio Patch Sheet', data)}
    ${patchTableHTML('comms', 'Comms Patch Sheet', data)}
    </section>`);
  }
  if (includePackageNotes) {
    sections.push(`<section>${productionNotesThreadHTML(snapshot?.notes, snapshot?.production?.name, numbers.get('production-notes'))}</section>`);
  }
  return `
    ${notesToggle}
    ${sections.join('\n    <div class="paper-page-break"></div>\n    ')}
  `;
}

function paperExportMeta(opts={}) {
  const supplied = opts.exportMeta || {};
  const hasSourceLabel = Object.prototype.hasOwnProperty.call(supplied, 'sourceLabel');
  const hasDraftLabel = Object.prototype.hasOwnProperty.call(supplied, 'draftLabel');
  const exportedAt = supplied.exportedAt || new Date().toISOString();
  const productionName = supplied.productionName || show.name || 'Cueola Production';
  const productionCode = supplied.productionCode || session.code || (session.isDemo ? 'DEMO' : 'LOCAL');
  return {
    productionName:String(productionName).slice(0,240),
    productionCode:String(productionCode).slice(0,80),
    documentTitle:String(supplied.documentTitle || '').slice(0,120),
    exportedAt,
    sourceLabel:String(hasSourceLabel ? supplied.sourceLabel : 'UNVERIFIED PREVIEW — NOT A SAVED EXPORT').slice(0,240),
    revisionLabel:String(supplied.revisionLabel || '').slice(0,240),
    draftLabel:String(hasDraftLabel ? supplied.draftLabel : 'PREVIEW ONLY').slice(0,80),
  };
}

function paperExportDateLabel(value) {
  const parsed = new Date(value || Date.now());
  return Number.isNaN(parsed.getTime()) ? String(value || '') : parsed.toLocaleString();
}

// D9.3: printed pages carry a date, never an export timestamp.
function paperExportDateOnlyLabel(value) {
  const parsed = new Date(value || Date.now());
  return Number.isNaN(parsed.getTime()) ? String(value || '') : parsed.toLocaleDateString();
}

function paperExportMarkup(html) {
  const source = document.createElement('div');
  source.innerHTML = String(html || '');
  source.querySelectorAll('script,style,link,iframe,object,embed,.no-print').forEach(node => node.remove());
  source.querySelectorAll('[onload],[onerror],[onclick],[onchange],[oninput]').forEach(node => {
    ['onload','onerror','onclick','onchange','oninput'].forEach(name => node.removeAttribute(name));
  });
  // UI masks and pseudo-elements are not deterministic inside html2canvas.
  // Export templates use words; this is a fail-safe for a future missed icon.
  source.querySelectorAll('.sf-symbol').forEach(node => {
    const replacement = document.createElement('span');
    replacement.className = 'paper-export-symbol-fallback';
    replacement.textContent = node.getAttribute('aria-label') || '';
    node.replaceWith(replacement);
  });
  return source;
}

function paperExportTokens(source, defaultOrientation='portrait') {
  const tokens = [];
  const walk = (node, inheritedOrientation) => {
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    if (node.classList.contains('paper-page-break')) {
      tokens.push({ kind:'break' });
      return;
    }
    const orientation = node.classList.contains('paper-landscape') || node.dataset.paperOrientation === 'landscape'
      ? 'landscape'
      : node.dataset.paperOrientation === 'portrait' ? 'portrait' : inheritedOrientation;
    if (node.matches('section,.paper-landscape,[data-paper-section]')) {
      [...node.children].forEach(child => walk(child, orientation));
      return;
    }
    tokens.push({ kind:'node', orientation, node });
  };
  [...source.children].forEach(node => walk(node, defaultOrientation));
  return tokens;
}

// v2.1 D9.3 de-branding: production-title-led header (production name, sheet
// title, date, Page N of M), small revision-stamp footer only. No wordmark,
// session code, export timestamps, or authority bands on the printed body —
// the fingerprint/authority system stays INTERNAL (it still gates what gets
// exported; it just stops printing itself on every page).
function createPaperExportPage(root, orientation, meta) {
  const page = document.createElement('article');
  page.className = `paper-export-page is-${orientation}`;
  page.dataset.orientation = orientation;
  page.innerHTML = `
    <header class="paper-export-header">
      <div class="paper-export-heading">
        <div class="paper-export-title">${esc(meta.productionName)}</div>
        ${meta.documentTitle ? `<div class="paper-export-doc">${esc(meta.documentTitle)}</div>` : ''}
      </div>
      <div class="paper-export-meta">${esc(paperExportDateOnlyLabel(meta.exportedAt))}<br><span class="paper-export-page-number"></span></div>
    </header>
    <main class="paper-export-body"></main>
    <footer class="paper-export-footer">
      <span class="paper-export-footer-main">${esc(meta.revisionLabel || '')}</span>
    </footer>`;
  root.appendChild(page);
  return { page, body:page.querySelector('.paper-export-body'), orientation };
}

function paperExportBodyOverflow(body) {
  return body.scrollHeight > body.clientHeight + 2;
}

function paperExportBodyHasContent(body) {
  return [...body.childNodes].some(node =>
    node.nodeType === Node.ELEMENT_NODE || String(node.textContent || '').trim());
}

function paperExportReadableText(node) {
  const clone = node.cloneNode(true);
  clone.querySelectorAll('br').forEach(br => br.replaceWith(document.createTextNode('\n')));
  clone.querySelectorAll('img').forEach(img => {
    const label = img.getAttribute('alt') || img.getAttribute('title') || 'Image';
    img.replaceWith(document.createTextNode(`[${label}]`));
  });
  clone.querySelectorAll('input,textarea,select').forEach(control => {
    const value = control.value || control.getAttribute('value') || control.textContent || '';
    control.replaceWith(document.createTextNode(value));
  });
  return clone.textContent || '';
}

function paperExportPreferredUnitCut(units, maximum) {
  const limit = Math.max(1, Math.min(units.length, maximum));
  if (limit >= units.length) return units.length;
  const floor = Math.max(1, Math.floor(limit * 0.65));
  for (let index = limit; index > floor; index--) {
    if (/\s|[-/.,;:!?)]/.test(units[index - 1])) return index;
  }
  return limit;
}

// v2.1 D9.4: 9px is the export font FLOOR — content flows to more pages
// instead of shrinking below it. The old 8px/6px compact path is gone.
function paperExportPlainBlock(text, sourceTag='DIV') {
  const block = document.createElement('div');
  block.className = 'paper-export-oversize-block';
  block.dataset.sourceTag = String(sourceTag || 'DIV').toLowerCase();
  block.style.cssText = [
    'font-size:9px',
    'line-height:1.28',
    'white-space:pre-wrap',
    'overflow-wrap:anywhere',
    'word-break:break-word',
    'height:auto',
    'min-height:0',
    'max-height:none',
    'overflow:visible',
    'position:static',
    'transform:none',
  ].join(';');
  block.textContent = text;
  return block;
}

function paperExportFitTextFragment(target, sourceNode, units) {
  let low = 1;
  let high = units.length;
  let best = 0;
  const probe = count => {
    const block = paperExportPlainBlock(units.slice(0, count).join(''), sourceNode.tagName);
    target.body.appendChild(block);
    const fits = !paperExportBodyOverflow(target.body);
    block.remove();
    return fits;
  };
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    if (probe(middle)) { best = middle; low = middle + 1; }
    else high = middle - 1;
  }
  // D9.4: never shrink below the floor — force minimal progress instead so the
  // loop always advances (a 9px unit on a fresh page fits for any real content).
  if (!best) best = 1;
  const cut = paperExportPreferredUnitCut(units, best);
  target.body.appendChild(paperExportPlainBlock(units.slice(0, cut).join(''), sourceNode.tagName));
  return cut;
}

function paperExportRowCells(row) {
  return [...row.children].filter(cell => cell.tagName === 'TD' || cell.tagName === 'TH');
}

function paperExportPlainRow(sourceRow, unitLists, budget, fontSize='9px', preferBreak=false) {
  const row = sourceRow.cloneNode(false);
  row.removeAttribute('id');
  row.removeAttribute('style');
  row.classList.add('paper-export-oversize-row');
  row.style.fontSize = fontSize;
  const cuts = [];
  const sourceCells = paperExportRowCells(sourceRow);
  sourceCells.forEach((sourceCell, index) => {
    const units = unitLists[index] || [];
    const maximum = Math.min(units.length, budget);
    const cut = maximum && preferBreak ? paperExportPreferredUnitCut(units, maximum) : maximum;
    const cell = sourceCell.cloneNode(false);
    cell.removeAttribute('id');
    cell.removeAttribute('style');
    cell.removeAttribute('rowspan');
    cell.style.padding = '3px';
    cell.style.lineHeight = '1.2';
    cell.style.height = 'auto';
    cell.style.minHeight = '0';
    cell.style.maxHeight = 'none';
    cell.style.whiteSpace = 'pre-wrap';
    cell.style.overflowWrap = 'anywhere';
    cell.style.wordBreak = 'break-word';
    cell.textContent = units.slice(0, cut).join('');
    cuts.push(cut);
    row.appendChild(cell);
  });
  if (!sourceCells.length) {
    const cell = document.createElement('td');
    cell.textContent = unitLists[0]?.slice(0, budget).join('') || '';
    row.appendChild(cell);
    cuts.push(Math.min(unitLists[0]?.length || 0, budget));
  }
  return { row, cuts };
}

// v2.1 D9.4: oversize rows FLOW across pages at the 9px floor. The old
// character-fragmenting path (7px → 5px cells under a 6px compacted header)
// is deleted — a row that outgrows its page continues on the next page under
// a repeated normal-size header.
function paperExportFitRowFragment(target, tableParts, sourceRow, unitLists) {
  const maximum = Math.max(0, ...unitLists.map(units => units.length));
  if (!maximum) {
    const blank = paperExportPlainRow(sourceRow, unitLists, 0);
    tableParts.body.appendChild(blank.row);
    return blank.cuts;
  }
  let low = 1;
  let high = maximum;
  let best = 0;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const probe = paperExportPlainRow(sourceRow, unitLists, middle);
    tableParts.body.appendChild(probe.row);
    const fits = !paperExportBodyOverflow(target.body);
    probe.row.remove();
    if (fits) { best = middle; low = middle + 1; }
    else high = middle - 1;
  }
  // Never shrink below the floor — force minimal progress so the flow loop
  // always advances (one 9px unit under a header fits on any fresh page).
  if (!best) best = 1;
  const fragment = paperExportPlainRow(sourceRow, unitLists, best, '9px', true);
  tableParts.body.appendChild(fragment.row);
  return fragment.cuts;
}

function paperExportTableShell(table, continued=false) {
  const shell = table.cloneNode(false);
  shell.classList.add('paper-export-table');
  [...table.children].forEach(child => {
    const tag = child.tagName;
    if (tag === 'CAPTION' || tag === 'COLGROUP' || tag === 'THEAD') shell.appendChild(child.cloneNode(true));
  });
  // D9.4: a section that flows onto another page says so, with its headers
  // repeated at normal size.
  if (continued && !shell.querySelector('caption')) {
    const caption = document.createElement('caption');
    caption.className = 'paper-export-cont';
    caption.textContent = '(continued)';
    shell.prepend(caption);
  }
  const body = document.createElement('tbody');
  shell.appendChild(body);
  return { shell, body };
}

async function waitForPaperExportAssets(root) {
  try { await document.fonts?.ready; } catch {}
  const waits = [...root.querySelectorAll('img')].map(img => {
    if (img.complete) return typeof img.decode === 'function' ? img.decode().catch(()=>{}) : Promise.resolve();
    return new Promise(resolve => {
      const done = () => resolve();
      img.addEventListener('load', done, {once:true});
      img.addEventListener('error', done, {once:true});
      setTimeout(done, 3000);
    });
  });
  await Promise.all(waits);
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
}

async function buildPaperExportDocument(html, opts={}) {
  const meta = paperExportMeta(opts);
  const defaultOrientation = opts.orientation === 'landscape' ? 'landscape' : 'portrait';
  const source = paperExportMarkup(html);
  // Fonts and source images must be settled before any fit decision. Clones
  // then reuse decoded assets, and a second check below catches late relayouts.
  await waitForPaperExportAssets(source);
  const tokens = paperExportTokens(source, defaultOrientation);
  const root = document.createElement('div');
  root.className = 'paper-export-document';
  root.dataset.exportedAt = meta.exportedAt;
  root.dataset.productionCode = meta.productionCode;
  root.style.position = 'fixed';
  root.style.left = '-20000px';
  root.style.top = '0';
  root.style.zIndex = '-1';
  root.setAttribute('aria-hidden','true');
  document.body.appendChild(root);

  let current = null;
  const discardEmptyCurrent = () => {
    if (current?.page?.isConnected && !paperExportBodyHasContent(current.body)) current.page.remove();
  };
  const nextPage = orientation => {
    discardEmptyCurrent();
    current = createPaperExportPage(root, orientation || defaultOrientation, meta);
    return current;
  };
  const ensurePage = orientation => {
    if (!current || current.orientation !== orientation) return nextPage(orientation);
    return current;
  };

  const renderTokens = () => {
    current = null;
    for (const token of tokens) {
      if (token.kind === 'break') { current = null; continue; }
      const orientation = opts.allowMixedOrientation === false ? defaultOrientation : token.orientation;
      if (token.node.tagName === 'TABLE') {
        const sourceRows = [...token.node.tBodies].flatMap(body => [...body.rows]);
        let target = ensurePage(orientation);
        let tableParts = paperExportTableShell(token.node);
        target.body.appendChild(tableParts.shell);
        // D9.4: a header that doesn't fit the remaining space moves to a fresh
        // page at normal size — headers are never compacted to 5–6px anymore.
        if (paperExportBodyOverflow(target.body)) {
          tableParts.shell.remove();
          target = nextPage(orientation);
          tableParts = paperExportTableShell(token.node);
          target.body.appendChild(tableParts.shell);
        }
        for (const sourceRow of sourceRows) {
          let row = sourceRow.cloneNode(true);
          tableParts.body.appendChild(row);
          if (!paperExportBodyOverflow(target.body)) continue;
          row.remove();
          if (tableParts.body.children.length) {
            target = nextPage(orientation);
            tableParts = paperExportTableShell(token.node, true);
            target.body.appendChild(tableParts.shell);
          }
          tableParts.body.appendChild(row);
          if (!paperExportBodyOverflow(target.body)) continue;
          // D9.4: gentle step stops at the 9px floor, then the row FLOWS.
          row.classList.add('paper-export-oversize-row');
          row.style.fontSize = '9px';
          row.querySelectorAll('td,th').forEach(cell => { cell.style.padding = '3px'; });
          if (!paperExportBodyOverflow(target.body)) continue;
          row.remove();
          let remaining = paperExportRowCells(sourceRow).map(cell =>
            Array.from(paperExportReadableText(cell)));
          if (!remaining.length) remaining = [Array.from(paperExportReadableText(sourceRow))];
          let firstFragment = true;
          while (firstFragment || remaining.some(units => units.length)) {
            if (!firstFragment) {
              target = nextPage(orientation);
              tableParts = paperExportTableShell(token.node, true);
              target.body.appendChild(tableParts.shell);
            }
            firstFragment = false;
            const cuts = paperExportFitRowFragment(target, tableParts, sourceRow, remaining);
            remaining = remaining.map((units, index) => units.slice(cuts[index] || 0));
          }
        }
        continue;
      }

      let target = ensurePage(orientation);
      let clone = token.node.cloneNode(true);
      target.body.appendChild(clone);
      if (paperExportBodyOverflow(target.body) && target.body.children.length > 1) {
        clone.remove();
        target = nextPage(orientation);
        clone = token.node.cloneNode(true);
        target.body.appendChild(clone);
      }
      if (!paperExportBodyOverflow(target.body)) continue;
      clone.classList.add('paper-export-oversize-block');
      clone.style.fontSize = '9px';   // D9.4 floor
      clone.style.overflowWrap = 'anywhere';
      if (!paperExportBodyOverflow(target.body)) continue;
      clone.remove();
      let remaining = Array.from(paperExportReadableText(token.node));
      if (!remaining.length) remaining = Array.from('[Visual content]');
      let firstFragment = true;
      while (remaining.length) {
        if (!firstFragment) target = nextPage(orientation);
        firstFragment = false;
        const cut = paperExportFitTextFragment(target, token.node, remaining);
        remaining = remaining.slice(cut);
      }
    }
    discardEmptyCurrent();
    [...root.querySelectorAll('.paper-export-page')].forEach(page => {
      const body = page.querySelector('.paper-export-body');
      if (body && !paperExportBodyHasContent(body)) page.remove();
    });
    if (!root.querySelector('.paper-export-page')) nextPage(defaultOrientation);
  };

  renderTokens();
  await waitForPaperExportAssets(root);
  if ([...root.querySelectorAll('.paper-export-body')].some(paperExportBodyOverflow)) {
    root.querySelectorAll('.paper-export-page').forEach(page => page.remove());
    renderTokens();
    await waitForPaperExportAssets(root);
  }
  // D9.4: the abort is gone — flow-first pagination makes clipping impossible
  // by construction for well-formed sections; a pathological layout ships with
  // a console warning instead of stranding the operator with no export.
  if ([...root.querySelectorAll('.paper-export-body')].some(paperExportBodyOverflow)) {
    console.warn('Paper export: a page still reports overflow after relayout — exporting anyway (content flows, nothing is dropped).');
  }
  const pages = [...root.querySelectorAll('.paper-export-page')];
  pages.forEach((page, index) => {
    const label = page.querySelector('.paper-export-page-number');
    if (label) label.textContent = `Page ${index + 1} of ${pages.length}`;
  });
  root.dataset.pageCount = String(pages.length);
  return root;
}

function releasePaperExportDocument(root) {
  root.style.position = '';
  root.style.left = '';
  root.style.top = '';
  root.style.zIndex = '';
  root.removeAttribute('aria-hidden');
  return root;
}

async function printPaperHTML(html, opts={}) {
  const area = document.getElementById('printArea');
  if (!area) throw new Error('Print area unavailable');
  const root = releasePaperExportDocument(await buildPaperExportDocument(html, opts));
  area.replaceChildren(root);
  const cleanup = () => { if (root.parentNode === area) area.replaceChildren(); };
  window.addEventListener('afterprint', cleanup, {once:true});
  window.print();
  return { pageCount:Number(root.dataset.pageCount) || 1, printed:true };
}

// PDF renderer libraries are vendored same-origin (assets/vendor/) so exports
// work offline and behind blocked CDNs — show-critical. No CDN fallback: the
// v2.1 CSP no longer allows cdnjs, so a fallback would fail anyway.
async function loadPdfExportLibraries() {
  const load = (local) =>
    paperworkExportTimeout(ptLoadLibrary(local), 12000, 'The PDF renderer took too long to load.');
  await load('assets/vendor/jspdf.umd.min.js');
  await load('assets/vendor/html2canvas.min.js');
}

// Explicit blob + anchor download: jsPDF's doc.save() can be silently dropped
// after async work (no longer a trusted gesture in some browsers/webviews) —
// the operator saw a "downloaded" toast with no file. Anchor-with-download
// attribute is not gesture-gated and works everywhere the app runs.
function downloadBlobFile(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  if (typeof a.download === 'undefined') {
    window.open(url, '_blank');
  } else {
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

// ── v2.1 D9.2: export progress sheet ─────────────────────────
// Determinate "Rendering page N of M" during the per-page raster loop, an
// indeterminate "Laying out pages…" stage during layout, and a Cancel that
// aborts between pages (never mid-page).
let _paperExportCancelled = false;
function showPaperProgress(title='Exporting PDF') {
  _paperExportCancelled = false;
  const titleEl = document.getElementById('paperProgressTitle');
  if (titleEl) titleEl.textContent = title;
  setPaperProgress('Preparing…', null);
  showModal('paperProgressSheet');
}
function setPaperProgress(status, fraction) {
  const statusEl = document.getElementById('paperProgressStatus');
  if (statusEl) statusEl.textContent = status;
  const bar = document.getElementById('paperProgressBar');
  if (!bar) return;
  if (fraction == null) {
    bar.classList.add('indeterminate');
  } else {
    bar.classList.remove('indeterminate');
    bar.style.width = `${Math.round(Math.max(0, Math.min(1, fraction)) * 100)}%`;
  }
}
function hidePaperProgress() { hideModal('paperProgressSheet'); }
function cancelPaperExport() {
  _paperExportCancelled = true;
  setPaperProgress('Canceling…', null);
}
function paperExportCancelledError() {
  return Object.assign(new Error('Export canceled.'), { code:'export-cancelled' });
}

async function exportPaperHTMLAsPDF(html, fileName, opts={}) {
  showPaperProgress('Exporting PDF');
  setPaperProgress('Laying out pages…', null);
  let root;
  try {
    root = await buildPaperExportDocument(html, opts);
  } catch (error) {
    hidePaperProgress();
    throw error;
  }
  try {
    await loadPdfExportLibraries();
    const { jsPDF } = window.jspdf || {};
    if (!jsPDF || !window.html2canvas) throw new Error('PDF renderer unavailable');
    const pages = [...root.querySelectorAll('.paper-export-page')];
    const firstOrientation = pages[0]?.dataset.orientation || 'portrait';
    const doc = new jsPDF({ unit:'pt', format:'letter', orientation:firstOrientation, compress:true });
    const meta = paperExportMeta(opts);
    // D9.3: neutral document metadata — no app branding in the PDF file.
    doc.setProperties({
      title:meta.documentTitle ? `${meta.productionName} — ${meta.documentTitle}` : meta.productionName,
      subject:meta.documentTitle || 'Production paperwork',
      author:meta.productionName,
      creator:meta.productionName,
      keywords:'',
    });
    for (let index = 0; index < pages.length; index++) {
      if (_paperExportCancelled) throw paperExportCancelledError();
      setPaperProgress(`Rendering page ${index + 1} of ${pages.length}`, index / pages.length);
      const page = pages[index];
      const orientation = page.dataset.orientation || 'portrait';
      if (index > 0) doc.addPage('letter', orientation);
      const canvas = await paperworkExportTimeout(window.html2canvas(page, {
        scale:opts.scale || 1.6,
        backgroundColor:'#ffffff',
        useCORS:true,
        logging:false,
      }), 15000, `Rendering page ${index + 1} took too long.`);
      const pageW = orientation === 'landscape' ? 792 : 612;
      const pageH = orientation === 'landscape' ? 612 : 792;
      doc.addImage(canvas.toDataURL('image/jpeg', opts.jpegQuality || 0.9), 'JPEG', 0, 0, pageW, pageH, undefined, 'FAST');
    }
    setPaperProgress('Saving file…', 1);
    downloadBlobFile(doc.output('blob'), fileName);
    return { pageCount:pages.length, fileName, exportedAt:meta.exportedAt };
  } finally {
    hidePaperProgress();
    root.remove();
  }
}

window.buildPaperExportDocument = buildPaperExportDocument;
window.printPaperHTML = printPaperHTML;

function openPrePro() {
  activePaperworkItemId = 'call-sheet';
  hideModal('paperworkHubModal');
  const data = loadPreProData();
  const sheets = getCallSheets(data);
  storeActiveCallSheetIndex(Math.max(0, Math.min(loadActiveCallSheetIndex(sheets), sheets.length - 1)), sheets);
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
  pbNoteLocalEdit('ps-setup-na');   // hold the collab refresh off this toggle briefly
  paperworkDirty = true;
}
window.setSetupNotApplicable = setSetupNotApplicable;
window.toggleSetupNotApplicable = toggleSetupNotApplicable;

function getPreProData() {
  const existing = loadPreProData();
  const sheets = getCallSheets(existing);
  // D6 selection hardening: resolve by remembered id so a remote delete that
  // renumbers the array can't make the open form overwrite a different sheet.
  resolveActiveCallSheetIndex(sheets);
  const active = currentCallSheetFromForm();
  sheets[activeCallSheetIndex] = active;
  return {
    ...active,
    callSheets: sheets,
    updatedAt: Date.now(),
  };
}

function saveCallSheet(showToastOnSave=true) {
  const saved = persistPreProData(getPreProData(), 'Call Sheet');
  applyPlandaShowStartToRundown();
  if (showToastOnSave) toast('Call sheet saved.');
  const sheets = getCallSheets(saved);
  const idx = resolveActiveCallSheetIndex(sheets);
  return normalizeCallSheet(sheets[idx], idx);
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
    // Stable row identity for the leaf-granular sync (PB_COLLAB_PLAN.md):
    // rows carry their id through the DOM so edits/deletes stay row-exact.
    ...(row.dataset.rowId ? { id: row.dataset.rowId } : {}),
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
  // D9.9: position is free text backed by the session's position catalog.
  const positionOptions = `<datalist id="ppPositionOptions">${getRolePositionOptions().map(p => `<option value="${esc(p)}"></option>`).join('')}</datalist>`;
  grid.innerHTML = `${positionOptions}
    <div class="call-grid-head call-grid-head-grip"></div>
    <div class="call-grid-head">Name</div>
    <div class="call-grid-head">Position</div>
    <div class="call-grid-head">Email</div>
    <div class="call-grid-head">Phone</div>
    <div class="call-grid-head">Call</div>
    <div class="call-grid-head"></div>
    ${rows.map((p,i)=>`
      <div class="call-person-row" data-idx="${i}"${p.id ? ` data-row-id="${esc(p.id)}"` : ''} style="display:contents">
        <div class="call-drag-handle" onpointerdown="callPointerDown(event, ${i})" title="Drag to reorder" aria-label="Drag to reorder">⠿</div>
        <input class="field-in" data-call-field="name" value="${esc(p.name||'')}" placeholder="Name" oninput="syncCallSheetPeopleFromDOM()">
        <input class="field-in" data-call-field="position" list="ppPositionOptions" value="${esc(p.position||p.role||'')}" placeholder="Position" oninput="syncCallSheetPeopleFromDOM()">
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

// v2.1 D9.7: one-tap crew fill from the saved role assignments — the app
// already knows person + position; stop making students retype them.
function fillCallSheetCrewFromRoster() {
  syncCallSheetPeopleFromDOM();
  const roster = getRoleAssignments().filter(row => String(row?.person || '').trim());
  if (!roster.length) { toast('No saved role assignments yet — assign positions in Admin first.'); return; }
  const have = new Set(callSheetPeople.map(p => String(p?.name || '').trim().toLowerCase()).filter(Boolean));
  const defaultCall = timeInputValue('pp-call');
  let added = 0;
  roster.forEach(row => {
    const name = String(row.person).trim();
    const key = name.toLowerCase();
    if (have.has(key)) return;
    have.add(key);
    callSheetPeople.push({ name, position: String(row.position || '').trim(), email:'', phone:'', call: defaultCall });
    added++;
  });
  // Drop placeholder blank rows once real people exist.
  if (added) callSheetPeople = callSheetPeople.filter(p => Object.values(p).some(v => String(v || '').trim()));
  renderCallSheetPeople();
  toast(added ? `Added ${added} ${added === 1 ? 'person' : 'people'} from the roster.` : 'Everyone on the roster is already on this sheet.');
}

// v2.1 D9.7: estimated wrap = show start (or call) + the rundown's total
// runtime. One tap, still editable.
function estimateWrapFromRundown() {
  const totalSecs = beats.reduce((n, b) => n + (b.min||0)*60 + (b.sec||0), 0);
  if (!totalSecs) { toast('The rundown has no timed rows yet.'); return; }
  const startVal = timeInputValue('pp-show-start') || timeInputValue('pp-call');
  if (!startVal) { toast('Set a show start or call time first.'); return; }
  const [h, m] = startVal.split(':').map(Number);
  const endMins = (h * 60 + m + Math.ceil(totalSecs / 60)) % (24 * 60);
  const wrap = `${String(Math.floor(endMins / 60)).padStart(2,'0')}:${String(endMins % 60).padStart(2,'0')}`;
  setWrapNotApplicable(false);
  setTimeInputValue('pp-wrap', wrap);
  toast(`Estimated wrap ${paperTime(wrap)} (start + ${rundownFmtTotal(totalSecs)} runtime).`);
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
  let snapshot;
  try {
    const previewIsOpen = document.getElementById('paperPreviewModal')?.classList.contains('on')
      && lastPaperPreview?.options?.snapshotFingerprint === lastCallSheetExportSnapshot?.fingerprint;
    snapshot = previewIsOpen ? lastCallSheetExportSnapshot : await preparePaperworkExportSnapshot({
      includeAssignments:false,
      includeNotes:false,
      documentType:'call-sheet',
    });
  } catch (error) {
    toast(`Export blocked: ${paperworkExportFailureMessage(error)}`);
    return;
  }
  const sheets = getCallSheets(snapshot.prePro);
  const index = document.getElementById('paperPreviewModal')?.classList.contains('on')
    ? Math.max(0, Math.min(lastCallSheetExportIndex, sheets.length - 1))
    : resolveActiveCallSheetIndex(sheets);
  const savedCallSheetData = normalizeCallSheet(sheets[index], index);
  const html = callSheetPreviewHTML(savedCallSheetData);
  const savedCallSheetFileName = `${cleanPdfName(callSheetTitle(savedCallSheetData), 'cueola-call-sheet')}.pdf`;
  const options = paperExportOptionsForSnapshot(snapshot, { orientation:'portrait', allowMixedOrientation:false });
  try {
    const result = await exportPaperHTMLAsPDF(html, savedCallSheetFileName, options);
    toast(`Call sheet PDF downloaded · ${result.pageCount} pages.`);
  } catch (error) {
    if (error?.code === 'export-cancelled') { toast('Export canceled.'); return; }
    console.warn('Paged PDF renderer unavailable; opening the identical print representation.', error);
    try {
      const result = await printPaperHTML(html, options);
      toast(`PDF renderer unavailable. Print preview opened · ${result.pageCount} pages.`);
    } catch (printError) {
      toast(`Could not render the saved call sheet: ${paperworkExportFailureMessage(printError)}`);
    }
  }
  return;
}

async function exportPreProPackagePDF() {
  let snapshot;
  try {
    const previewIsOpen = document.getElementById('paperPreviewModal')?.classList.contains('on')
      && lastPaperPreview?.options?.snapshotFingerprint === lastPackageExportSnapshot?.fingerprint;
    const selectionMatches = JSON.stringify(lastPackageExportSnapshot?.options?.callSheetIds || null)
      === JSON.stringify(packageIncludedCallSheetIds())
      && JSON.stringify(lastPackageExportSnapshot?.options?.paperwork || {})
      === JSON.stringify(disabledPaperworkOptions());
    snapshot = previewIsOpen && selectionMatches && lastPackageExportSnapshot?.options?.includeNotes === pbPackageIncludeNotes
      ? lastPackageExportSnapshot
      : await preparePaperworkExportSnapshot({
        includeNotes:pbPackageIncludeNotes,
        includeAssignments:true,
        documentType:'plandabear-package',
        callSheetIds:packageIncludedCallSheetIds(),
        paperwork:disabledPaperworkOptions(),
        ...(groupActive() ? { groupId: activeGroupId, groupName: activeGroupName() } : {}),
      });
  } catch (error) {
    toast(`Export blocked: ${paperworkExportFailureMessage(error)}`);
    return;
  }
  const html = preProPackageHTML(true, snapshot);
  const options = paperExportOptionsForSnapshot(snapshot, { orientation:'portrait', allowMixedOrientation:true });
  const cleanFileName = (snapshot.production.name || 'cueola-plandabear-package').replace(/[^\w\-]+/g,'-').replace(/-+/g,'-').replace(/^-|-$/g,'').toLowerCase() || 'cueola-plandabear-package';
  try {
    const result = await exportPaperHTMLAsPDF(html, `${cleanFileName}-plandabear-package.pdf`, options);
    toast(`Planda Bear package PDF downloaded · ${result.pageCount} pages.`);
  } catch (error) {
    if (error?.code === 'export-cancelled') { toast('Export canceled.'); return; }
    console.warn('Paged PDF renderer unavailable; opening the identical print representation.', error);
    try {
      const result = await printPaperHTML(html, options);
      toast(`PDF renderer unavailable. Print preview opened · ${result.pageCount} pages.`);
    } catch (printError) {
      toast(`Could not render the saved package: ${paperworkExportFailureMessage(printError)}`);
    }
  }
  return;
}

// ─────────────────────────────────────────────────────────────
// PDF EXPORT
// ─────────────────────────────────────────────────────────────
async function exportPDF() {
  let snapshot;
  try {
    const previewIsOpen = document.getElementById('paperPreviewModal')?.classList.contains('on')
      && lastPaperPreview?.options?.snapshotFingerprint === lastRundownExportSnapshot?.fingerprint;
    snapshot = previewIsOpen ? lastRundownExportSnapshot : await preparePaperworkExportSnapshot({
      includeAssignments:false,
      includeNotes:false,
      documentType:'rundown',
    });
  } catch (error) {
    toast(`Export blocked: ${paperworkExportFailureMessage(error)}`);
    return;
  }
  const cleanFileName = `${(snapshot.production.name || 'cueola-rundown').replace(/[^\w\-]+/g,'-').replace(/-+/g,'-').replace(/^-|-$/g,'').toLowerCase() || 'cueola-rundown'}.pdf`;
  const html = `
    <h1>Full Rendered Rundown</h1>
    <p>${esc(snapshot.production.name)}</p>
    ${rundownPreviewTableHTML(snapshot)}
  `;
  const options = paperExportOptionsForSnapshot(snapshot, { orientation:'landscape', allowMixedOrientation:false });
  try {
    const result = await exportPaperHTMLAsPDF(html, cleanFileName, options);
    toast(`Rundown PDF downloaded · ${result.pageCount} pages.`);
  } catch (error) {
    if (error?.code === 'export-cancelled') { toast('Export canceled.'); return; }
    console.warn('Paged PDF renderer unavailable; opening the identical print representation.', error);
    try {
      const result = await printPaperHTML(html, options);
      toast(`PDF renderer unavailable. Print preview opened · ${result.pageCount} pages.`);
    } catch (printError) {
      toast(`Could not render the saved rundown: ${paperworkExportFailureMessage(printError)}`);
    }
  }
  return;
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
// Admin session restores through CueolaAdminAuth's persisted Auth state; the
// adapter updates the UI whenever the session resolves or changes.
initAdminAuthAdapter();
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
    document.getElementById('outrangutan')?.classList.contains('on') ||
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
// (v2.1) admins/global listener removed — CueolaAdminAuth binds itself on
// firebaseReady and the adapter registered at boot mirrors the session.

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

// ── v2.1 Phase 5 (decision 12a): ONE entry gate for every door ──────────────
// The main join modals already call CueolaIdentity.entrySatisfied; the side
// entrances (Outrangutan join, #flowop, #flowmingo, dashboard auto-join and
// ?code= links) historically bypassed it. This helper closes them all: when a
// session requires a class key and the visitor has no signed-in profile with
// an active key, they are routed through the front-door join modal (which owns
// the key input and the sign-up wizard) instead of slipping in sideways.
// Signed-in admins pass — the gate is about anonymous students.
async function cueolaEntryGateAllows(code, doorLabel = 'This session') {
  const clean = String(code || '').trim().toUpperCase();
  if (!clean || !window._firebaseReady) return true;   // local/offline flows keep working
  if (adminSession) return true;
  let docData = null;
  try {
    const snap = await window._getDoc(window._doc(window._db, 'sessions', clean));
    docData = snap.exists() ? snap.data() : null;
  } catch { return true; }   // unreadable → let the flow surface its own error
  if (!docData || docData.requireLoginCode !== true) return true;
  const gate = window.CueolaIdentity ? await CueolaIdentity.entrySatisfied(docData, '') : { pass: true };
  if (gate.pass) return true;
  toast(`${doorLabel} needs a class key for this session. Sign in or enter your key to continue.`);
  try {
    const inp = document.getElementById('stud-code');
    if (inp) inp.value = clean;
    showModal('modal-stud');
    CueolaIdentity?.revealEntryCodeRow?.('stud-entrycode-row');
  } catch {}
  return false;
}
window.cueolaEntryGateAllows = cueolaEntryGateAllows;   // Outrangutan's module calls this

(function autoJoinFromDashboard() {
  const params = new URLSearchParams(window.location.search);
  // Retire legacy ?scriptop= links without ever booting a second full Cueola
  // controller. Current links include the parent/session identities; an old
  // bookmark lands on the dedicated document's explicit disconnected state.
  if (params.has('scriptop')) {
    const code = (params.get('scriptop') || params.get('code') || '').trim().toUpperCase();
    const url = new URL('script-operator.html', location.href);
    url.search = '';
    if (code) url.searchParams.set('code', code);
    ['session','controller','theme'].forEach(key => {
      const value = params.get(key);
      if (value) url.searchParams.set(key, value);
    });
    location.replace(url.toString());
    return;
  }
  if (location.hash === '#flowmingo-op' || location.hash === '#flowop' || params.has('flowop') || params.has('operator')) {
    sessionStorage.setItem('cueola_screen', 'entry');
    setTimeout(async () => {
      const code = params.get('code') || '';
      // Phase 5: the operator side door honors the class-key gate.
      if (code && !(await cueolaEntryGateAllows(code, 'The Flowmingo operator'))) return;
      openFlowmingoOperator(code);
    }, 0);
    return;
  }
  if (location.hash === '#flowmingo' || location.hash === '#promptypus' || params.has('flowmingo') || params.has('prompter') || params.has('promptypus')) {
    sessionStorage.setItem('cueola_screen', 'entry');
    setTimeout(async () => {
      enterPrompter();
      const code = (params.get('code') || '').trim().toUpperCase();
      if (code) {
        // Phase 5: the talent-link side door honors the class-key gate.
        if (!(await cueolaEntryGateAllows(code, 'Flowmingo'))) return;
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

  const doJoin = async () => {
    // Phase 5: student-side auto-joins honor the class-key gate (instructor
    // launches from the signed-in dashboard pass through).
    if (role !== 'instructor' && !(await cueolaEntryGateAllows(code, 'This link'))) return;
    if (name) {
      session = sessionWithProfileIdentity({
        code, role, userName:name,
        profileId: stored?.profileId || '', username: stored?.username || '',
        profileAliases: Array.isArray(stored?.profileAliases) ? stored.profileAliases : [],
        isDemo:false, isExpert:false,
      }, name);
      freeTextMode = false;
      restoreLocalDraftAsRundownBaseline();
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
