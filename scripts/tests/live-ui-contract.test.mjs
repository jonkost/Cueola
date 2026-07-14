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
