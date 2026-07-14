import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [app, html, liveController, playbackJs, playbackCss] = await Promise.all([
  readFile(new URL('../../cueola-app.js', import.meta.url), 'utf8'),
  readFile(new URL('../../index.html', import.meta.url), 'utf8'),
  readFile(new URL('../../cueola-live-session.js', import.meta.url), 'utf8'),
  readFile(new URL('../../outrangutan/outrangutan.js', import.meta.url), 'utf8'),
  readFile(new URL('../../outrangutan/outrangutan.css', import.meta.url), 'utf8'),
]);

const tests = [];
function test(name, run) { tests.push({ name, run }); }

test('Live exposes one dominant, explicitly named GO control', () => {
  assert.match(html, /<button(?=[^>]*id="lsGoBtn")(?=[^>]*\bls-go-primary\b)[^>]*>/);
  assert.match(html, /id="lsGoLabel"[^>]*>Next cue</);
  assert.match(app, /function updateLiveGoControl\(projectedState=null\)/);
  assert.match(app, /GO to \$\{text\}/);
  assert.match(
    app.slice(app.indexOf('function renderLive()'), app.indexOf('function openLiveScript')),
    /if \(!beats\.length\)[\s\S]*updateLiveGoControl\(\);[\s\S]*return;/,
  );
});

test('selected and active are independent text states', () => {
  assert.match(app, /ACTIVE<\/span>/);
  assert.match(app, /SELECTED<\/span>/);
  assert.match(app, /setLiveSelectedCue\(i, \{ reason:'live-row-selection' \}\)/);
  assert.match(app, /activateLiveRundownRow\(event,\$\{i\}\)/);
  assert.match(html, /\.live-status\.selected/);
  assert.match(html, /\.live-status\.active/);
});

test('every execution history state has a model and a visible text style', () => {
  for (const state of ['upcoming', 'completed', 'skipped', 'failed', 'disabled']) {
    assert.match(liveController, new RegExp(`['"]${state}['"]`));
    assert.match(html, new RegExp(`\\.live-status\\.${state}`));
  }
  assert.match(app, /recoverLiveCueFailure/);
});

test('row selection is keyboard-operable and never aliases GO', () => {
  assert.match(app, /onkeydown="selectLiveRundownRow\(event,\$\{i\}\)"/);
  assert.match(app, /\['Enter',' '\]\.includes\(event\.key\)/);
  assert.match(app, /event\?\.stopPropagation\?\.\(\)/);
});

test('Live cue renderers share READY and TAKE vocabulary', () => {
  assert.match(app, /ready:\{ label:'READY'/);
  assert.match(app, /take:\{ label:'TAKE'/);
  assert.match(app, /function liveCueOperationLine/);
  assert.doesNotMatch(app.slice(app.indexOf('function renderLiveCurrent'), app.indexOf('function liveRowPreview')), />[▶■○]\s*\$\{esc/);
});

test('subsystem failures have persistent local recovery surfaces', () => {
  for (const id of ['ls-status-flowmingo', 'ls-status-playback', 'ls-status-script', 'ls-status-sync']) {
    assert.match(html, new RegExp(`id="${id}"`));
    assert.match(html, new RegExp(`id="${id}-actions"`));
  }
  assert.match(app, /function recoverLiveSubsystem\(name\)/);
  assert.match(app, /if \(tone === 'error'\)/);
  assert.match(html, /id="lsStatusAnnouncement"[^>]*aria-live="polite"/);
});

test('the Live cloud rail consumes the same status owner as the builder badge', () => {
  assert.match(app, /let cloudSyncProjection = \{ state:'off'/);
  assert.match(app, /function setCloudSyncState\(state='synced', detail=''\) \{\s*cloudSyncProjection = \{ state, detail \}/);
  const record = app.slice(app.indexOf('function liveSyncStatusRecord()'), app.indexOf('function renderLiveStatusRail'));
  assert.match(record, /const state = cloudSyncProjection\.state/);
  assert.match(record, /state === 'saving'[\s\S]*status:'connecting'/);
  assert.match(record, /state === 'error'[\s\S]*status:'error'/);
  assert.match(record, /state === 'local'[\s\S]*status:'disconnected'/);
  assert.doesNotMatch(record, /return \{ status:'ready', detail:'Cloud synchronized' \}/);
});

test('a missed Flowmingo heartbeat exposes a fresh-output recovery path', () => {
  assert.match(app, /status === 'recovering'\) return 'Recover Flowmingo'/);
  assert.match(app, /openFlowmingoTalentWindow\(\{ replace:true \}\)/);
  const open = app.slice(app.indexOf('function openFlowmingoTalentWindow('), app.indexOf('function sendPrompterPreviewControl'));
  assert.match(open, /\{ replace=false \}=\{\}/);
  assert.match(open, /_prompterTalentWin\?\.close\(\)/);
  assert.match(open, /_activePrompterOutputInstanceId = ''/);
  assert.match(open, /_prompterRecoveryAnnounced = false/);
});

test('explicit create and ordinary join have separate Firestore authority', () => {
  const create = app.slice(app.indexOf('async function createSession()'), app.indexOf('function enterAsInstructor'));
  const createOnly = app.slice(app.indexOf('async function createSessionDocumentIfMissing'), app.indexOf('async function restoreMissingSessionDocument'));
  const setup = app.slice(app.indexOf('function setupFirestore()'), app.indexOf('// ── P3: snapshot render gating'));
  assert.match(create, /await createSessionDocumentIfMissing\(ref, payload\)/);
  assert.match(createOnly, /const snap = await transaction\.get\(ref\)/);
  assert.match(createOnly, /if \(snap\.exists\(\)\) return false/);
  assert.match(createOnly, /transaction\.set\(ref, payload\)/);
  assert.doesNotMatch(setup, /_setDoc\(|createSessionDocumentIfMissing\(/);
});

test('a missing or incomplete joined session fails closed without a partial write', () => {
  const setup = app.slice(app.indexOf('function setupFirestore()'), app.indexOf('// ── P3: snapshot render gating'));
  const flush = app.slice(app.indexOf('async function flushRundownSyncQueue()'), app.indexOf('function setupFirestore()'));
  assert.match(setup, /if \(!snap\.exists\(\)\)[\s\S]*markSharedSessionUnavailable\('missing'\)/);
  assert.match(setup, /!isCompleteRundownSessionDocument\(d\)[\s\S]*markSharedSessionUnavailable\('incomplete'\)/);
  assert.match(flush, /if \(!snap\.exists\(\)\)[\s\S]*missingError\.code = 'not-found'/);
  assert.match(flush, /!isCompleteRundownSessionDocument\(data\)[\s\S]*cueolaSessionAvailability = 'incomplete'/);
  const missingGuard = flush.indexOf('if (!snap.exists())');
  const incompleteGuard = flush.indexOf('if (!isCompleteRundownSessionDocument(data))');
  const firstPatch = flush.indexOf('committedBeats = applyRundownBatch');
  const write = flush.indexOf('transaction.update(ref, update)');
  assert.ok(missingGuard >= 0 && incompleteGuard > missingGuard && firstPatch > incompleteGuard && write > firstPatch,
    'missing and incomplete guards must both run before applying or writing a rundown batch');
  assert.match(flush, /markSharedSessionUnavailable\(unavailableKind\)/);
  assert.match(flush, /transaction\.update\(ref, update\)/);
  assert.doesNotMatch(flush, /else transaction\.set/);
});

test('History recovery can explicitly recreate only durable session state', () => {
  const payload = app.slice(app.indexOf('function buildSnapshotRecoveryPayload'), app.indexOf('async function createSessionDocumentIfMissing'));
  const restore = app.slice(app.indexOf('async function restoreSessionSnapshot'), app.indexOf('// Save / open a rundown'));
  for (const field of ['showName', 'startTime', 'beats', 'rundownAliases', 'customSources', 'cues', 'freeMode']) {
    assert.match(payload, new RegExp(field));
  }
  for (const volatile of ['presence', 'prompter', 'outrangutan', 'showClock', 'forceCmd', 'kicked', 'movedTo']) {
    assert.doesNotMatch(payload, new RegExp(`doc\\?\\.${volatile}`));
  }
  assert.match(restore, /await restoreMissingSessionDocument\(ref, recoveryPayload\)/);
  assert.match(restore, /if \(recreatedSession\)[\s\S]*rundownPendingBatches\.length = 0/);
});

test('a missing session exposes confirmed recovery of the current local copy', () => {
  const current = app.slice(app.indexOf('function buildCurrentLocalRecoveryPayload'), app.indexOf('async function restoreSessionSnapshot'));
  assert.match(html, /id="sessionHistoryRestoreLocal"[^>]*onclick="restoreCurrentLocalSessionToCloud\(\)"[^>]*hidden/);
  assert.match(current, /showName:show\.name/);
  assert.match(current, /beats,/);
  assert.match(current, /rundownAliases,/);
  assert.match(current, /customSources:sessionCustomSources/);
  assert.match(current, /loadPreProData\(\)/);
  assert.match(current, /localPlandaBearNotes\(\)/);
  assert.match(current, /await restoreMissingSessionDocument\(ref, payload\)/);
  assert.match(current, /if \(!confirm\(/);
  for (const volatile of ['presence', 'prompter', 'outrangutan', 'showClock', 'forceCmd']) {
    assert.doesNotMatch(current, new RegExp(`${volatile}:`));
  }
});

test('cloud retry performs a server probe and local recovery keeps aliases', () => {
  const retry = app.slice(app.indexOf('async function recoverLiveSubsystem'), app.indexOf('function liveSessionState'));
  const probe = app.slice(app.indexOf('async function probeSharedSessionAuthority'), app.indexOf('function nextBeatId'));
  const draft = app.slice(app.indexOf('function saveLocalDraft'), app.indexOf('// ── Local session snapshot history'));
  const autoJoin = app.slice(app.indexOf("const doJoin = () => {"), app.indexOf('waitForFirebaseReady().then(ready => {', app.indexOf("const doJoin = () => {")));
  assert.match(retry, /await probeSharedSessionAuthority\(\)/);
  assert.match(probe, /window\._getDocFromServer/);
  assert.match(draft, /rundownAliases/);
  assert.match(draft, /fingerprint === localDraftLastFingerprint/);
  assert.match(autoJoin, /restoreLocalDraftAsRundownBaseline\(\)/);
});

test('drawer and drag handles are safe for pointer and keyboard operation', () => {
  assert.match(html, /id="lsSidebarScrim"/);
  assert.match(html, /id="lsResizer"[^>]*onkeydown="resizeLivePanelByKey\(event\)"[^>]*role="separator"/);
  assert.match(html, /id="lsScriptResizer"[^>]*onkeydown="resizeLiveScriptByKey\(event\)"[^>]*role="separator"/);
  assert.match(app, /element\.inert = drawerOpen/);
});

test('follow targets use native buttons with pressed state', () => {
  assert.match(app, /<button type="button" class="follow-chip follow-self/);
  assert.match(app, /aria-pressed="\$\{isActive\?'true':'false'\}"/);
});

test('Outrangutan has reachable narrow, medium, and wide modes', () => {
  assert.match(playbackJs, /LAYOUT_NARROW_MAX = 720, LAYOUT_MEDIUM_MAX = 1180/);
  assert.match(playbackJs, /if \(width <= LAYOUT_NARROW_MAX\) return 'narrow';[\s\S]*if \(width <= LAYOUT_MEDIUM_MAX\) return 'medium';[\s\S]*return 'wide';/);
  for (const mode of ['narrow', 'medium', 'wide']) {
    assert.match(playbackJs, new RegExp(`og-lay-${mode}`));
    assert.match(playbackCss, new RegExp(`\\.og-lay-${mode}`));
  }
  assert.match(playbackJs, /ResizeObserver/);
});

for (const { name, run } of tests) {
  await run();
  console.log('PASS', name);
}
console.log(`PASS ${tests.length} Live UI contract tests`);
