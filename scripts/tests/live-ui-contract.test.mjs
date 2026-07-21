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

test('selected and active are independent states with visible affordances', () => {
  // Active is announced with the original On Air pill; selection is a row-level
  // affordance (aria-selected + .live-row-selected styling), never a second pill
  // and never an alias for activation.
  assert.match(app, /On Air<\/span>/);
  assert.match(app, /aria-selected="\$\{i === selectedIdx \? 'true' : 'false'\}"/);
  assert.match(app, /setLiveSelectedCue\(i, \{ reason:'live-row-selection' \}\)/);
  assert.match(app, /activateLiveRundownRow\(event,\$\{i\}\)/);
  assert.match(html, /\.live-row-selected:not\(\.live-row-current\) td/);
  assert.match(html, /\.live-status\.now/);
});

test('every execution history state has a model and a visible text style', () => {
  // Controller states keep their model names; presentation uses the original
  // show vocabulary (upcoming rows read Next/Later, completed reads Done).
  const presentation = { upcoming:['next','later'], completed:['done'], skipped:['skipped'], failed:['failed'], disabled:['disabled'] };
  for (const [state, classes] of Object.entries(presentation)) {
    assert.match(liveController, new RegExp(`['"]${state}['"]`));
    for (const cls of classes) assert.match(html, new RegExp(`\\.live-status\\.${cls}`));
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
  // D12.1: silence detection moved to the shared link model — replacing the
  // talent window resets the 'talent' link instead of a local watchdog flag.
  assert.match(open, /liveLinkState\.noteOff\('talent'/);
});

test('connection truth: displayed link status renders only from the model', () => {
  // The model exists, every link is configured, and one owned ticker
  // evaluates hysteresis (D12.1).
  assert.match(app, /const liveLinkState = window\.CueolaLinkState\.createModel/);
  for (const key of ['cloud', 'talent', 'playout', 'scriptop']) {
    assert.match(app, new RegExp(`liveLinkState\\.configure\\('${key}'`));
  }
  assert.match(app, /function ensureLiveLinkTicker\(\)/);
  assert.match(app, /liveLinkState\.tick\(\)/);
  // The talent heartbeat path acks the model and never flips displayed
  // status directly; the old watchdog is gone.
  const seen = app.slice(app.indexOf('function _notePrompterTalentSeen('), app.indexOf('function _shouldSendInitForTalent('));
  assert.match(seen, /liveLinkState\.noteAck\('talent'/);
  assert.doesNotMatch(seen, /projectPrompterSessionStatus\(/);
  assert.doesNotMatch(app, /startTalentWatchdog/);
  assert.doesNotMatch(app, /_prompterRecoveryAnnounced/);
  // A closed talent window is a definitive loss, not a heartbeat gap.
  assert.match(app, /noteLost\('talent', 'Talent window closed'\)/);
});

test('prompter single-authority: talent never mints, doc session is adopted, takeover is visible', () => {
  // D12.2: every talent boot door is a no-mint surface.
  assert.match(app, /const IS_PROMPTER_TALENT_BOOT = IS_PROMPTER_OUTPUT_BOOT \|\|/);
  assert.match(app, /\['#flowmingo', '#promptypus'\]\.includes\(location\.hash\)/);
  assert.match(app, /params\.has\('flowmingo'\) \|\| params\.has\('promptypus'\)/);
  // Minting is reserved for a surface that may call the show.
  assert.match(app, /!IS_PROMPTER_TALENT_BOOT && isShowCaller\(\)/);
  // The in-page talent joins the doc's session (the Jul 20 split-brain seed).
  assert.match(app, /ensurePrompterProtocolIdentity\(\{ productionCode:code, sessionId:data\.prompter\?\.sessionId \|\| '' \}\)/);
  // Every surface adopts the seeded doc session; foreign re-seeds are a
  // visible takeover, never a silent fork.
  assert.match(app, /_adoptDocPrompterSession\(d\)/);
  const adopt = app.slice(app.indexOf('function _adoptDocPrompterSession('), app.indexOf('let _lastPrompterSessionReclaimTs'));
  assert.match(adopt, /senderClient === CLIENT_ID/);
  assert.match(adopt, /toast\('Another operator window took the prompter/);
  // The 46e4fc8 reclaim recovery path keeps its guards: only a show-calling
  // surface with the live screen open, rate-limited against snapshot wars.
  const reclaim = app.slice(app.indexOf('function _maybeReclaimPrompterTalentSession('), app.indexOf('function _handlePrompterOperatorMessage('));
  assert.match(reclaim, /isShowCaller\(\)/);
  assert.match(reclaim, /liveshow'\)\?\.classList\.contains\('on'\)/);
  assert.match(reclaim, /_lastPrompterSessionReclaimTs < 10000/);
  // Seed writes carry their writer so takeover detection can compare clients.
  const seed = app.slice(app.indexOf('function sendPrompterStateSnapshot('), app.indexOf('function buildPrompterControl'));
  assert.match(seed, /'prompter\.senderClient':CLIENT_ID/);
});

test('overlay discipline: bounded band, off-commands always pass, toggles are acked', () => {
  // D12.5 / decision 16c: banners live in a ~20% band; only the stand-by
  // slate is full-screen.
  assert.match(html, /\.pt-clock-overlay\{[^}]*max-height:20vh/);
  assert.match(html, /#pt-question-overlay\{[^}]*max-height:20vh/);
  // Discrete state toggles (incl. every off-command) bypass the readiness
  // queue on BOTH operator surfaces — the show-day "can't turn off tech
  // issues / bars / question" swallow.
  const send = app.slice(app.indexOf('function sendPrompterControl('), app.indexOf('// ─────────────────────────────────────────────────────────────\n// PROMPTYPUS'));
  assert.match(send, /isCollaborativePrompterControl\(action\)[\s\S]*?dispatchPrompterCommand\(control, 'live'/);
  const flowSend = app.slice(app.indexOf('function flowOpSendControl('), app.indexOf('function flowOpToggleTechDifficulty'));
  assert.match(flowSend, /isCollaborativePrompterControl\(action\)[\s\S]*?dispatchPrompterCommand\(control, 'flowop'/);
  // Toggle UI rides the ack path: pending on send, confirmed on control_ack,
  // failed after the no-ack timeout.
  assert.match(app, /markPrompterToggleState\(control\.action, 'pending'\)/);
  assert.match(app, /markPrompterToggleState\(pending\.action, 'confirmed'\)/);
  assert.match(app, /markPrompterToggleState\(control\.action, 'failed'\)/);
  assert.match(html, /\.pt-ack-pending\{/);
});

test('first GO fires like the tenth: resume-after-sync, arming, and unlock (D12.4)', async () => {
  // A pre-handshake GO leaves the module playing while the safe snapshot loads
  // paused — syncOutput must arm the post-handshake resume from program truth.
  const sync = playbackJs.slice(playbackJs.indexOf('function syncOutput('), playbackJs.indexOf('function handleOutputMessage('));
  assert.match(sync, /desired\.playbackStatus === 'playing'\) rec\.resumeAfterSync = true/);
  // Gesture-time arming: audio engine resumed and the FIRST armed cue staged
  // (cue-ahead preload only ever staged "next after fired").
  assert.match(playbackJs, /async function armPlayback\(\)/);
  assert.match(playbackJs, /function playoutArmed\(\)/);
  assert.match(playbackJs, /armPlayback,/);
  // The operator arms on entering live and the preflight proves it.
  assert.match(app, /window\.Outrangutan\?\.armPlayback\?\.\(\)/);
  assert.match(app, /'Playout first GO'/);
  // The output window retries a NotAllowedError play on its first gesture.
  const outputHtml = await readFile(new URL('../../outrangutan/output.html', import.meta.url), 'utf8');
  assert.match(outputHtml, /_blockedPlayRetry = \(\) =>/);
  assert.match(outputHtml, /addEventListener\('pointerdown', retryBlockedPlayback/);
});

test('questions lane replaces push-paste: QUESTION card in, script pollution out (D12.6)', () => {
  // The broken Paste/Paste-Push path is deleted, not kept alongside.
  assert.doesNotMatch(app, /pasteClipboardToPrompter/);
  assert.doesNotMatch(html, /pasteClipboardToPrompter/);
  assert.doesNotMatch(app, /\[CHAT\]\\n/);
  // The lane: paste box, Enter pushes, Esc clears; both operator scopes send
  // through the ack'd command path with the text as command payload.
  assert.match(app, /function questionLaneKeydown\(event, scope\)/);
  assert.match(app, /function pushChatQuestion\(scope\)/);
  assert.match(app, /sendPrompterControl\('question_on', \{ text \}\)/);
  assert.match(app, /flowOpSendControl\('question_on', false, \{ text \}\)/);
  assert.match(app, /-question-input/);
  // The talent renders a QUESTION-labeled card (signage, not script) and a
  // bare legacy question_on still shows the generic card.
  assert.match(app, /pt-question-tag/);
  assert.match(app, /ptQuestionText \|\| 'Question in chat'/);
  assert.match(html, /\.pt-question-tag\{/);
  // Payload rides the existing command envelope end-to-end.
  assert.match(app, /function buildPrompterControl\(action, source='script-op', payload=null\)/);
  assert.match(app, /applyRemoteControlOnce\(control\.action, control\.ts, control\.sender, control\.controlId, control\.payload\)/);
});

test('runtime stays slim: no boot vendor libs, owned timers, recorded budgets (D12.7)', async () => {
  // No vendor library rides boot — everything loads on first use.
  assert.doesNotMatch(html, /<script src="assets\/vendor/);
  assert.match(app, /await ptLoadLibrary\('assets\/vendor\/pdf\.min\.js'\)/);
  // The census wrapper exists and installs before any app timer is created.
  const perfAt = app.indexOf('window.CueolaPerf');
  assert.ok(perfAt > 0 && perfAt < app.indexOf('setInterval(', perfAt + 2000) || perfAt < 3000,
    'CueolaPerf must wrap setInterval at the very top of the app');
  assert.match(app, /window\.CueolaPerf/);
  assert.match(app, /intervalCount: intervals\.size/);
  // Budgets are recorded in the repo for the Phase 12 gate.
  const budgets = JSON.parse(await readFile(new URL('../perf-budget/budgets.json', import.meta.url), 'utf8'));
  assert.ok(budgets.maxima.bootToInteractiveMs > 0);
  assert.equal(budgets.maxima.vendorLibsAtBoot, 0);
  assert.ok(Array.isArray(budgets.intervalOwners.expected) && budgets.intervalOwners.expected.length >= 5);
});

test('one keycommand system on every surface (D11.1)', async () => {
  // The Live surface delegates binding grammar, overrides, and hold mechanics
  // to the shared engine.
  assert.match(app, /window\.CueolaKeymap\.effectiveBindings/);
  assert.match(app, /window\.CueolaKeymap\.createHoldTracker/);
  assert.match(app, /window\.CueolaKeymap\.sectionsForScope\(KEYMAP/);
  // The Script Operator window registers a real scope — including the owner's
  // direct ask, J/L hold-to-Brake/Boost — with blur hold-safety.
  const scriptOp = await readFile(new URL('../../script-operator.js', import.meta.url), 'utf8');
  assert.match(scriptOp, /hold: \['brake_start', 'brake_stop'\]/);
  assert.match(scriptOp, /hold: \['boost_start', 'boost_stop'\]/);
  assert.match(scriptOp, /operatorHolds\?\.releaseAll\(\)/);
  assert.match(scriptOp, /operatorKeymapDispatch\(e, 'down'\)/);
  const scriptOpHtml = await readFile(new URL('../../script-operator.html', import.meta.url), 'utf8');
  assert.match(scriptOpHtml, /cueola-keymap\.js/);
  // The printed operator cheat card rides the show pack, generated from the
  // same registry as dispatch and the "?" overlay.
  assert.match(app, /'operator-card'\]/);
  assert.match(app, /function operatorCheatCardHTML/);
  assert.match(app, /KEYMAP\.filter\(a => a\.scope === 'live'\)\.forEach\(a => \{ \(liveGroups/);
});

test('cue advance never moves the prompter; the op lines it up deliberately (D11.2)', () => {
  // The auto-seek is gone from every advance path…
  const advance = app.slice(app.indexOf('function updatePrompterOnAdvance('), app.indexOf('function cuePrompterToLiveRow('));
  assert.doesNotMatch(advance, /seek_row/);
  assert.doesNotMatch(app, /sendToPrompter\(false\)\.then\(pushed => \{ if \(pushed\) cuePrompterToLiveRow\(\); \}\)/);
  // …while the manual line-up tools stay: C (cue current row), T (top),
  // Cue Now / Cue Next, and the seek_row validation.
  assert.match(app, /Cue prompter to current row/);
  assert.match(app, /function cuePrompterToLiveRow\(\)/);
  assert.match(app, /data-script-op-cue="now"/);
  assert.match(app, /data-script-op-cue="next"/);
  // The ▶ talent-position rail renders from adopted talent state and the
  // editor follows it unless the op is editing.
  assert.match(app, /function renderTalentPositionIndicator\(\)/);
  assert.match(app, /renderTalentPositionIndicator\(\);\s+\/\/ D11\.2/);
  assert.match(html, /id="lsTalentPos"/);
  assert.match(html, /id="lsTalentPosFollow"/);
  // Cue-to-top preflight affordance: a parked talent script warns before doors.
  assert.match(app, /parked mid-scroll/);
});

test('Ready·Track·Roll·Take: armed call with an abort window, published for all (D11.3)', () => {
  // GO on a linked-playout row starts the visible call — never an instant fire.
  const auto = app.slice(app.indexOf('function fireOutrangutanAutoForBeat('), app.indexOf('function outrangutanCellBadge('));
  assert.match(auto, /return beginPlayoutCall\(beat, rowIdx\)/);
  assert.doesNotMatch(auto, /d\.outAuto && d\.outCueId\) fireOutrangutanCommand/);
  // The 3-second window steps READY → TRACK → ROLL, then TAKE; the browsing
  // path (selectLiveRundownRow) never begins a call.
  assert.match(app, /const RTRT_STAGES = \['ready', 'track', 'roll'\]/);
  assert.match(app, /const RTRT_STAGE_MS = 1000/);
  const select = app.slice(app.indexOf('function selectLiveRundownRow('), app.indexOf('function lsNext('));
  assert.doesNotMatch(select, /beginPlayoutCall|fireOutrangutanAutoForBeat/);
  // G is TAKE-now, S aborts, click buttons exist, leaving live aborts.
  assert.match(app, /if \(action === 'go'\) return takePlayoutCall\('take-now'\)/);
  assert.match(app, /return abortPlayoutCall\(action\)/);
  assert.match(html, /onclick="takePlayoutCall\('button'\)"/);
  assert.match(html, /onclick="abortPlayoutCall\('button'\)"/);
  assert.match(app, /abortPlayoutCall\('left-live'\)/);
  // Every stage publishes on the session doc (additive field) and every
  // viewer renders it; stale calls are discarded.
  assert.match(app, /liveCall: \{/);
  assert.match(app, /applyRemoteLiveCall\(d\.liveCall\)/);
  assert.match(app, /stageAt > 15000\b|stageAt < |Date\.now\(\) - liveCall\.stageAt > 15000/);
  // Manual armed-call mode is a show-level setting.
  assert.match(app, /cueola_rtrt_manual/);
  assert.match(app, /setLiveCallManualArm/);
});

test('playout countdown publishes once per start and ticks locally everywhere (D11.4)', () => {
  // Outrangutan publishes ONE additive write per clip start — no per-second writes.
  assert.match(playbackJs, /function publishPlayingStart\(cue\)/);
  assert.match(playbackJs, /'outrangutan\.playingStart'/);
  const starts = playbackJs.match(/publishPlayingStart\(cue\)/g) || [];
  assert.ok(starts.length >= 2, 'both beginMedia and beginImage publish the start');
  // Every client ingests it stamp-guarded and ticks locally with an owned timer.
  assert.match(app, /outrangutanState\.playingStart = og\.playingStart/);
  assert.match(app, /function outCountdownText\(cueId\)/);
  assert.match(app, /function syncOutCountdownTicker\(\)/);
  assert.match(app, /data-outremain/);
  assert.match(html, /\.cue-out-remain\{/);
});

test('controls never lie, never move, never silently refuse (D11.5)', () => {
  // Every guarded refusal in the GO/row-activation paths surfaces why.
  const activate = app.slice(app.indexOf('function activateLiveRundownRow('), app.indexOf('function detachIfFollowing('));
  assert.match(activate, /toast\('That row no longer exists\.'\)/);
  assert.match(activate, /Segment headers organize the rundown/);
  assert.match(activate, /is disabled — enable it in the rundown/);
  const next = app.slice(app.indexOf('function lsNext('), app.indexOf('function rowLogLabel('));
  assert.match(next, /toast\('End of rundown — there is no next row\.'\)/);
  assert.match(app, /Live commands are paused — the show screen is still settling/);
  // Fixed geometry: the GO control has a fixed width and its label ellipsizes.
  assert.match(html, /\.ls-go-primary\{[^}]*width:min\(38vw,380px\)/);
  assert.match(html, /\.ls-go-primary \.ls-go-label\{[^}]*text-overflow:ellipsis/);
  assert.match(html, /\.ls-start-btn\{[^}]*min-width:112px/);
  // Click-row-to-cue is independent of the show clock — no clock state feeds
  // the activation path.
  assert.doesNotMatch(activate, /liveClockRunning|_clockRanThisLoad|elapsedSecs/);
});

test('playout live reorder is an order-only write that respects the playing clip (D11.6)', async () => {
  assert.match(playbackJs, /function reorderCue\(dragId, targetId, before\)/);
  const reorder = playbackJs.slice(playbackJs.indexOf('function reorderCue('), playbackJs.indexOf('function renderInspector('));
  // Order-only: splice + renumber; the active deck is never touched, and the
  // TRUE next cue is restaged after the order changes.
  assert.match(reorder, /cues\.splice\(from, 1\)/);
  assert.match(reorder, /renumber\(\)/);
  assert.match(reorder, /if \(active\) preloadNext\(active\.cue\)/);
  assert.doesNotMatch(reorder, /stopDeck|active =|active\.cue =/);
  // Drag affordances exist on the cue list.
  assert.match(playbackJs, /el\.draggable = true/);
  assert.match(playbackJs, /og-drop-before/);
  const ogCss = await readFile(new URL('../../outrangutan/outrangutan.css', import.meta.url), 'utf8');
  assert.match(ogCss, /\.og-cue\.og-drop-before/);
});

test('pop-outs cannot die quietly: chip + auto-reconnect + one-click reopen (D11.8)', () => {
  // Connection chips: both pop-outs ride the D12.1 link model permanently.
  assert.match(html, /id="ls-link-talent"/);
  assert.match(html, /id="ls-link-scriptop"/);
  // Automatic reconnect attempts on loss, one per announcement.
  assert.match(app, /automatic resync attempt/);
  assert.match(app, /try \{ scriptOperatorPublishState\(true\); \} catch \{\}/);
  assert.match(app, /automatic reconnect attempt'\);\s*\n\s*try \{ _postPrompterHello\(\); \} catch \{\}/);
  // One-click reopen with full state resync stays wired to the rail.
  assert.match(app, /if \(name === 'scriptOperator'\) return openScriptOpPopout\(\)/);
  assert.match(app, /return openFlowmingoTalentWindow\(\{ replace:true \}\)/);
});

test('one Stream Deck drives the whole rig over the session control bus (D11.7)', () => {
  // The deck's chokepoint gains target-qualified actions with a same-tab fast
  // path and a Firestore command doc for cross-machine targets.
  assert.match(playbackJs, /const CONTROL_BUS_ACTIONS = \{/);
  assert.match(playbackJs, /window\.cueolaControlBus === 'function'/);
  assert.match(playbackJs, /controlBus: \{ target: cmd\.target/);
  assert.match(playbackJs, /rundown_go: 'Rundown GO'/);
  // Cueola executes only on the show-calling surface with live open, dedupes
  // by id, and discards stale commands so a reconnect never replays a GO.
  assert.match(app, /function runControlBusAction\(target, action/);
  assert.match(app, /if \(!isShowCaller\(\)\) return false/);
  assert.match(app, /cmd\.id === _lastControlBusId/);
  assert.match(app, /Date\.now\(\) - cmd\.ts > 5000/);
  assert.match(app, /applyControlBusCommand\(d\.controlBus\)/);
});

test('cloud snapshots: group-aware capture, hashed dedupe, merged history, one restore body (Phase 7/D3)', async () => {
  // Capture wraps session doc + /groups subdocs + per-note subcollection and
  // fingerprints ALL of it (a group-only edit must advance the trail).
  assert.match(app, /kind:'sessionSnapshot\.v2', session:doc, groups, notes/);
  assert.match(app, /captureSessionGroupDocs\(targetSessionCode, doc\)/);
  assert.match(app, /const fpHash = await snapshotFpHash\(fingerprint\)/);
  // Decode accepts every encoding ever shipped, forever.
  ['gzip', 'gzip-b64', 'json-b64'].forEach(tag => assert.match(app, new RegExp(`record\\.encoding === '${tag}'`)));
  // The cloud mirror is fire-and-forget, chunked at the deployed files
  // ceiling, capped at 8 chunks, content-hash ids for idempotent dedupe.
  assert.match(app, /cloudSnapshotPut\(cloudMeta, cloudData\)/);
  assert.match(app, /i \+= PB_FILE_CHUNK_CHARS/);
  assert.match(app, /chunks\.length > 8/);
  assert.match(app, /snap_\$\{meta\.fpHash\}/);
  // Merged history with origin badges; ONE resolver serves both trails.
  assert.match(app, /function mergedSessionHistoryRows/);
  assert.match(app, /snap-origin-\$\{record\.origin\}/);
  assert.match(app, /startsWith\('cloud:'\)/);
  // ONE restore body: the shared re-stamp helper covers the session doc AND
  // every captured group doc (P2607 discipline can never fork).
  assert.match(app, /function restampPreProForRestore/);
  const restoreBody = app.slice(app.indexOf('async function restoreSessionSnapshot('), app.indexOf('// Save / open a rundown as a file'));
  assert.match(restoreBody, /restampPreProForRestore\(restoredGroup\.prePro\)/);
  assert.match(restoreBody, /liveIds\.has\(nid\)/);   // notes recreate-only, never overwrite
  // Cache clears on session change; Delete Forever sweeps /snapshots.
  assert.match(app, /_cloudSnapshotCache = \{ code: '', rows: null \};   \/\/ D3/);
  const dash = await readFile(new URL('../../dashboard.html', import.meta.url), 'utf8');
  assert.match(dash, /'groups', 'snapshots'\]/);
  // Rules: admin-gated /snapshots with shape checks, additive-first deploy.
  const rules = await readFile(new URL('../../firestore.rules', import.meta.url), 'utf8');
  assert.match(rules, /match \/snapshots\/\{snapId\}/);
  assert.match(rules, /function validSnapshotDocument/);
  assert.match(rules, /'sessionSnapshot', 'sessionSnapshotChunk'/);
  assert.match(rules, /allow read, delete: if validSessionId\(code\) && isAdmin\(\)/);
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
  const autoJoin = app.slice(app.indexOf("const doJoin = async () => {"), app.indexOf('waitForFirebaseReady().then(ready => {', app.indexOf("const doJoin = async () => {")));
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

test('Phase 10: list tightening is admin-gated and the profiles residual stays documented', async () => {
  const rules = await readFile(new URL('../../firestore.rules', import.meta.url), 'utf8');
  const sessionsBlock = rules.slice(rules.indexOf('match /sessions/{code} {'), rules.indexOf('match /files/{fileId}'));
  assert.match(sessionsBlock, /allow list: if isAdmin\(\);/);
  const codesBlock = rules.slice(rules.indexOf('match /accessCodes/{code} {'), rules.indexOf('match /profiles/{username}'));
  assert.match(codesBlock, /allow list: if isAdmin\(\);/);
  // profiles list is deliberately open: student crew exports and roster
  // hydration read it without Auth. The rationale comment must survive —
  // a silent "cleanup" to isAdmin() breaks student exports.
  const profilesBlock = rules.slice(rules.indexOf('match /profiles/{username} {'), rules.indexOf('match /{document=**}'));
  assert.match(profilesBlock, /allow list: if true;/);
  assert.match(rules, /Phase 10 residual/);
});

for (const { name, run } of tests) {
  await run();
  console.log('PASS', name);
}
console.log(`PASS ${tests.length} Live UI contract tests`);
