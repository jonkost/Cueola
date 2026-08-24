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

test('playback rows speak ROLL and OUT; guided helper rows are real whitelisted beats (R1)', () => {
  // Playback-only chip overrides; every other cue type keeps READY/TAKE above.
  assert.match(app, /ready:\{ label:'ROLL'/);
  assert.match(app, /take:\{ label:'OUT'/);
  assert.match(app, /LIVE_CUE_OPERATION_OVERRIDES\[cueType\]/);
  assert.match(app, /function liveCueOperationLine\(operation, text, className='', style='', cueType=''\)/);
  // helperFor/helperRole survive patch-sync: the buildBeatPatch whitelist
  // silently drops every beat field it does not list.
  assert.match(app, /\['style','info','notes','min','sec','done','helperFor','helperRole','_createdAt','_createdBy'\]/);
  // saveCueConfig is the single chokepoint that generates PREP/OUT rows.
  const save = app.slice(app.indexOf('function saveCueConfig()'), app.indexOf('function syncPlaybackHelperRows('));
  assert.match(save, /syncPlaybackHelperRows\(b, prevCell, d\)/);
  const sync = app.slice(app.indexOf('function syncPlaybackHelperRows('), app.indexOf('function removeCueCfg()'));
  assert.match(sync, /helperFor: String\(parent\.id\), helperRole: role/);
  assert.match(sync, /beats\.splice\(role === 'prep' \? pIdx : pIdx \+ 1, 0, row\)/);
  // The wizard offers the guided rows as opt-in checkboxes.
  assert.match(app, /id="cc-guided-prep"/);
  assert.match(app, /id="cc-guided-out"/);
  // Helper rows render with role tags in the builder table and the live grid.
  assert.match(app, /rundown-row-helper helper-\$\{b\.helperRole\}/);
  assert.match(app, /live-row-helper helper-\$\{b\.helperRole\}/);
  assert.match(html, /\.helper-tag-prep/);
  assert.match(html, /\.helper-tag-out/);
  // Deleting a parent playback row sweeps its helpers in the same pass.
  assert.match(app, /Removed the row and its PREP\/OUT helper rows\./);
  // The printed rundown legend teaches the playback vocabulary too.
  assert.match(app, /For playback rows: <b>ROLL<\/b> = start the clip · <b>OUT<\/b> = the plan for getting out/);
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
  // 8/19: the launcher passes a code before this tab joins, opts out of the
  // in-page fallback (the launcher tab is about to join the rundown), and a
  // saved display choice places the window Outrangutan-style.
  assert.match(open, /\{ replace=false, code='', fallbackInPage=true \}=\{\}/);
  assert.match(open, /cueolaScreenFeatures\(savedTalentScreen\(\)\)/);
  assert.match(open, /if \(fallbackInPage\) enterPrompter\(\)/);
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

test('Script Operator pop-out parity: question lane, numeric readouts, in-app tab grouping (3.5)', async () => {
  const scriptOp = await readFile(new URL('../../script-operator.js', import.meta.url), 'utf8');
  const scriptOpHtml = await readFile(new URL('../../script-operator.html', import.meta.url), 'utf8');
  // The pop-out question lane rides the allowlisted command channel with the
  // card text as payload; the host forwards it with the same 280-char cap.
  assert.match(scriptOpHtml, /id="questionLaneInput"/);
  assert.match(scriptOpHtml, /id="questionLaneCards"/);
  assert.match(scriptOp, /function pushQuestionLane\(\)/);
  assert.match(scriptOp, /sendIntent\('control', \{ action: 'question_on', text \}\)/);
  assert.match(app, /'clock_size_up','clock_size_down','question_on','question_off','overlays_clear'/);
  // The host forwards command payloads: question text and the find query.
  assert.match(app, /questionText \? sendPrompterControl\(action, \{ text: questionText \}\)/);
  assert.match(app, /findQuery \? sendPrompterControl\(action, \{ q: findQuery \}\)/);
  // Find-in-script parity: the pop-out sends seek_text through the same
  // allowlisted channel, and the host validates the query length.
  assert.match(scriptOp, /sendIntent\('control', \{ action: 'seek_text', q \}\)/);
  assert.match(app, /action === 'seek_text' && findQuery\.length < 3/);
  // The [CHAT] Paste-Push path stays dead in the pop-out too (D12.6).
  assert.doesNotMatch(scriptOp, /pasteIntoEditor\(/);
  assert.doesNotMatch(scriptOpHtml, /data-paste/);
  // Prepared question cards reach the pop-out datalist through the snapshot.
  assert.match(app, /questionCards:\(sessionQuestionCards \|\| \[\]\)\.slice\(0, 30\)/);
  assert.match(scriptOp, /function patchQuestionCards\(cards\)/);
  // In-app speed/size slider rows carry the pop-out's live numeric readouts.
  assert.match(app, /data-prompter-speed-value/);
  assert.match(app, /data-prompter-size-value/);
  assert.match(app, /function syncPrompterSliderReadouts\(\)/);
  // Tab names and grouping mirror OP_INSP_LABELS within the 4-tab layout, and
  // remembered pre-regroup tab keys map onto their new homes.
  assert.match(scriptOp, /transport: 'Transport',\s*\n\s*live: 'Cue & On Air',\s*\n\s*clocks: 'Clocks & Alerts',\s*\n\s*display: 'Display & Theme'/);
  assert.match(scriptOp, /LEGACY_TAB_KEYS = \{ prompter: 'transport', formatting: 'display' \}/);
  assert.match(scriptOpHtml, /data-pane="transport"/);
  assert.match(scriptOpHtml, /data-pane="display"/);
  assert.doesNotMatch(scriptOpHtml, /data-pane="prompter"|data-pane="formatting"/);
});

test('Production Notes SFX bridge: taggable uploads and a pull API for Outrangutan (3.3)', () => {
  // The pull surface Outrangutan's Import from Production Notes consumes:
  // list() rows for every isAudio attachment, getFile() through the chunked
  // loader. Pull-only, so the closed-Outrangutan anti-clobber rule holds.
  assert.match(app, /window\.CueolaPBSfx = \{/);
  assert.match(app, /async list\(\)/);
  assert.match(app, /async getFile\(item\)/);
  // SFX is a first-class board tag, and the composer states the audio cap.
  assert.match(app, /sfx:\s+\{ label:'SFX',\s+symbol:'media\.waveform' \}/);
  assert.match(html, /Audio uploads cap at 4MB\. Use mp3 or m4a for SFX\./);
  // The closed-Outrangutan hand-off toast points at the pull path too.
  assert.match(app, /Import from Production Notes/);
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
  // The printed operator cheat card left the pack entirely (owner 2026-08-19:
  // the exported keyboard sheets read as clutter). The on-screen "?" overlay
  // remains the shortcut reference.
  assert.doesNotMatch(app, /operator-card/);
  assert.doesNotMatch(app, /operatorCheatCardHTML/);
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
  // G is TAKE-now. S aborts the armed call AND falls through to the normal
  // transport stop, so panic always silences playing media (INC-19 decision).
  assert.match(app, /if \(action === 'go'\) return takePlayoutCall\('take-now'\)/);
  assert.match(app, /if \(action === 'stop' \|\| action === 'fadeStop' \|\| action === 'panic'\) abortPlayoutCall\(action\)/);
  assert.doesNotMatch(app, /return abortPlayoutCall\(action\)/);
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
  assert.match(playbackJs, /function publishPlayingStart\(cue, opts\)/);
  assert.match(playbackJs, /'outrangutan\.playingStart'/);
  const starts = playbackJs.match(/publishPlayingStart\(cue\)/g) || [];
  assert.ok(starts.length >= 2, 'both beginMedia and beginImage publish the start');
  // Resume re-anchors the countdown from the real media position, and a
  // recovery start publishes only the remaining play length.
  assert.match(playbackJs, /publishPlayingStart\(active\.cue, \{ elapsedMs/);
  assert.match(playbackJs, /publishPlayingStart\(cue, \{ durMs/);
  // Every client ingests it stamp-guarded and ticks locally with an owned timer.
  assert.match(app, /outrangutanState\.playingStart = og\.playingStart/);
  assert.match(app, /function outCountdownText\(cueId\)/);
  assert.match(app, /function syncOutCountdownTicker\(\)/);
  assert.match(app, /data-outremain/);
  assert.match(html, /\.cue-out-remain\{/);
});

test('the always-on playout strip rides the Live screen outside the rebuilt grid (R2)', () => {
  // The strip lives OUTSIDE #lsBody, so renderLive rebuilds never touch it.
  const stripAt = html.indexOf('id="lsPlayoutStrip"');
  const bodyAt = html.indexOf('id="lsBody"');
  assert.ok(stripAt >= 0 && bodyAt > stripAt, 'strip markup sits above (outside) #lsBody');
  assert.match(html, /\.ls-playout-strip\{/);
  assert.match(html, /\.ls-playout-fill\{/);
  // One shared accessor answers "what is playout doing": same-tab progress
  // first, playingStart wall-clock math next, published remaining last.
  assert.match(app, /function playoutNow\(\)/);
  assert.match(app, /function _playoutNowCue\(\)/);
  assert.match(app, /function _playoutNowPad\(\)/);
  // The countdown pass patches the strip in place (P3), and the owned ticker
  // runs whenever playout is active, linked to a rundown row or not.
  const render = app.slice(app.indexOf('function renderOutCountdowns()'), app.indexOf('function syncOutCountdownTicker()'));
  assert.match(render, /renderPlayoutStrip\(\)/);
  const sync = app.slice(app.indexOf('function syncOutCountdownTicker()'), app.indexOf('function applySfxFireEvent('));
  assert.match(sync, /playoutNow\(\) != null/);
  const strip = app.slice(app.indexOf('function renderPlayoutStrip()'), app.indexOf('function outCountdownText('));
  assert.match(strip, /textContent !== /);
  // Pad fires remember their timing so followers can count them down too.
  assert.match(app, /_sfxLast = \{/);
  // Row badge chips are styled states (ON AIR red, PAUSE amber, PRE neutral).
  assert.match(html, /\.cue-out-badge\{/);
  assert.match(html, /\.cue-out-play\{/);
  assert.match(html, /\.cue-out-pause\{/);
  assert.match(html, /\.cue-out-pre\{/);
});

test('controls never lie, never move, never silently refuse (D11.5)', () => {
  // Every guarded refusal in the GO/row-activation paths surfaces why.
  const activate = app.slice(app.indexOf('function activateLiveRundownRow('), app.indexOf('function detachIfFollowing('));
  assert.match(activate, /toast\('That row no longer exists\.'\)/);
  assert.match(activate, /Segment headers organize the rundown/);
  assert.match(activate, /is disabled\. Enable it in the rundown/);
  const next = app.slice(app.indexOf('function lsNext('), app.indexOf('function rowLogLabel('));
  assert.match(next, /toast\('End of rundown\. There is no next row\.'\)/);
  assert.match(app, /Live commands are paused\. The show screen is still settling/);
  // Fixed geometry: Previous and GO share one even min-width and the next-cue
  // preview text stays out of the button (hover tip/aria carry it instead).
  assert.match(html, /\.ls-nav \.ls-btn\{[^}]*min-width:116px/);
  assert.match(html, /\.ls-go-primary \.ls-go-label\{display:none\}/);
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

test('pop-outs cannot die quietly: chip + auto-reconnect + one-click reopen (D11.8)', async () => {
  const scriptOp = await readFile(new URL('../../script-operator.js', import.meta.url), 'utf8');
  // Connection chips: both pop-outs ride the D12.1 link model permanently.
  assert.match(html, /id="ls-link-talent"/);
  assert.match(html, /id="ls-link-scriptop"/);
  // Automatic reconnect attempts on loss, one per announcement. The old
  // in-branch republish was dead code (checkHeartbeat clears `connected`
  // first, so the publish guard always bailed); recovery is now split: the
  // loss branch resets the state fingerprint, and the heartbeat handler's
  // not-ready branch pushes a full STATE the moment beats resume.
  assert.match(app, /automatic resync attempt/);
  assert.match(app, /_scriptOpLastStateFingerprint = '';\s*\n\s*\}\s*\n\s*return;/);
  assert.match(app, /if \(!ready\) \{[\s\S]{0,700}?scriptOperatorPublishState\(true\);/);
  // Both heartbeat loops ride worker timers (background-tab throttling was
  // the idle-timeout killer), and the popout re-requests state on wake.
  assert.match(app, /_scriptOpWatchdog = P\.createSteadyInterval\(/);
  assert.match(scriptOp, /protocolApi\.createSteadyInterval\(heartbeatTick/);
  assert.match(scriptOp, /sendReady\('operator-resync'\)/);
  assert.match(scriptOp, /function wakeResync\(\)/);
  // Sept-show update: the single hello grew into a backoff ladder — an
  // open-but-silent talent window gets nudged repeatedly (hello every 8s,
  // capped) until the link recovers or the window closes.
  assert.match(app, /Automatic reconnect attempt'\);\s*\n\s*_beginTalentReconnectNudges\(\);/);
  assert.match(app, /function _beginTalentReconnectNudges\(\)/);
  assert.match(app, /try \{ _postPrompterHello\(\); \} catch \{\}/);
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
  // The explicit create path on the entry page is Blank Slate (the legacy
  // Create-a-Session modal was dead code, removed 2026-08-03; dashboard.html
  // owns instructor session creation).
  const create = app.slice(app.indexOf('async function startBlankSlate()'), app.indexOf('function loadDemo'));
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

test('same-tab control-surface probe, repaint push, and liveRowInfo honor the bridge contract', () => {
  // Probe: strict booleans from LOCAL state only (no Firestore reads), and the
  // exact verb map the deck expects: prompter toggle, RTRT take/abort, clock.
  const probeAt = app.indexOf('window.cueolaControlSurfaceState');
  const probe = app.slice(probeAt, app.indexOf('function notifyControlSurfaceState', probeAt));
  assert.ok(probeAt >= 0);
  assert.match(probe, /action === 'toggle' \? !!ptPlaying : false/);
  assert.match(probe, /\(action === 'take' \|\| action === 'abort'\) \? !!_rtrtCall : false/);
  assert.match(probe, /if \(target === 'clock'\) return !!liveClockRunning;/);
  assert.match(probe, /catch \(e\) \{ return false; \}/);
  assert.doesNotMatch(probe, /_getDoc|_updateDoc|_onSnapshot|_db\b/);
  // Outrangutan's key lamp consumes exactly this probe, with === true strictness.
  assert.match(playbackJs, /window\.cueolaControlSurfaceState/);
  assert.match(playbackJs, /probe\(cmd\.target, cmd\.action\) === true/);
  // Push: every deck-visible state mutator dispatches the cheap repaint event.
  assert.match(app, /new Event\('cueola-surface-state'\)/);
  const fnBody = (name) => {
    const at = app.indexOf(`function ${name}(`);
    assert.ok(at >= 0, `${name} exists`);
    const end = app.indexOf('\nfunction ', at + 1);
    return app.slice(at, end < 0 ? app.length : end);
  };
  for (const name of ['ptStartPlay', 'ptStopPlay', 'startTimer', 'stopTimer', 'beginPlayoutCall', 'takePlayoutCall', 'abortPlayoutCall', 'setLiveSelectedCue', 'adoptLiveActiveCue']) {
    assert.match(fnBody(name), /notifyControlSurfaceState\(\)/, `${name} pushes 'cueola-surface-state'`);
  }
  // Bridge payload: additive liveRowInfo carries current and next row {index, title}.
  assert.match(app, /liveRowInfo: \{/);
  assert.match(app, /current: _sdSafe\(\(\) => _sdRowInfo\(ai\), null\)/);
  assert.match(app, /next: _sdSafe\(\(\) => _sdRowInfo\(liveNextPlayableCueIndex\(ai\)\), null\)/);
  assert.match(app, /return \{ index, title: _sdBeatName\(b\) \|\| b\.info \|\| '' \};/);
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
  // Phase 2 (2026-08-12) CLOSED the Phase 10 open-profiles-list residual:
  // students authenticate now, so the roster no longer has to be world
  // readable. It stays collection-wide for signed-in callers (presence chips,
  // note authorship and paperwork exports all render other people), which is
  // why this is isSignedIn() and not a self-only rule.
  const profilesBlock = rules.slice(rules.indexOf('match /profiles/{username} {'), rules.indexOf('match /{document=**}'));
  assert.match(profilesBlock, /allow list: if isSignedIn\(\);/);
  assert.doesNotMatch(profilesBlock, /allow list: if true;/);
  assert.match(rules, /Phase 10 residual/);
});

test('Phase 2: the authenticated write floor is in place across shared show data', async () => {
  const rules = await readFile(new URL('../../firestore.rules', import.meta.url), 'utf8');
  // The claim check must come first in isCueolaPrincipal: it is free, while
  // isAdmin() costs a document read on every high-frequency write.
  assert.match(rules, /function isCueolaStudent\(\)[\s\S]*?request\.auth\.token\.cueolaStudent == true/);
  assert.match(rules, /function isCueolaPrincipal\(\)\s*\{\s*return isCueolaStudent\(\) \|\| isAdmin\(\);/);
  // Every shared-show write path carries the floor. Slice ONLY the sessions
  // block (it is followed by admins/accessCodes/profiles, whose write rules are
  // gated differently).
  const sessionsBlock = rules.slice(rules.indexOf('match /sessions/{code} {'), rules.indexOf('match /admins/{docId} {'));
  const writeRules = sessionsBlock.split('\n').filter(l => /allow (create|update|create, update)/.test(l));
  assert.ok(writeRules.length >= 5, `expected the session write rules, found ${writeRules.length}`);
  for (const line of writeRules) {
    assert.ok(/isCueolaPrincipal\(\)|isAdmin\(\)/.test(line), `unguarded session write rule: ${line.trim()}`);
  }
  // A student may only write their OWN profile, matched on profileId (the auth
  // uid), never on the {username} doc id.
  const profilesBlock = rules.slice(rules.indexOf('match /profiles/{username} {'), rules.indexOf('match /{document=**}'));
  assert.match(profilesBlock, /request\.auth\.uid == resource\.data\.profileId/);
  assert.match(profilesBlock, /allow create: if isAdmin\(\)/);
  // A student must not be able to enumerate instructor accounts.
  const adminsBlock = rules.slice(rules.indexOf('match /admins/{docId} {'), rules.indexOf('match /accessCodes/{code} {'));
  assert.match(adminsBlock, /request\.auth\.uid == docId \|\| isAdmin\(\)/);
});

test('8/19 round: strip keeps its slot, rail is damped, Script Op surfaces mirror and share prefs', async () => {
  const scriptOp = await readFile(new URL('../../script-operator.js', import.meta.url), 'utf8');
  const scriptOpHtml = await readFile(new URL('../../script-operator.html', import.meta.url), 'utf8');
  const prefs = await readFile(new URL('../../cueola-scriptop-prefs.js', import.meta.url), 'utf8');
  // Playout strip: the 34px slot never leaves the flow; idle is a quiet
  // placeholder, so playback starting or stopping cannot shove the rundown.
  const stripFn = app.slice(app.indexOf('function renderPlayoutStrip'), app.indexOf('function outCountdownText'));
  assert.match(stripFn, /strip\.dataset\.status !== 'idle'/);
  assert.doesNotMatch(stripFn, /strip\.hidden = true/);
  assert.match(html, /id="lsPlayoutStrip"[^>]*data-status="idle"/);
  // Status rail: JS-damped class visibility (confirm before open, hold before
  // close) replaces the instant :has() toggle, and the sync chip is debounced.
  assert.match(app, /LS_RAIL_OPEN_CONFIRM_MS = 1500/);
  assert.match(app, /LS_RAIL_CLOSE_HOLD_MS = 6000/);
  assert.match(app, /function updateLiveStatusRailVisibility/);
  assert.match(html, /\.ls-status-rail:not\(\.ls-rail-open\)/);
  assert.doesNotMatch(html, /\.ls-status-rail:not\(:has\(/);
  assert.match(app, /SYNC_RECONN_CONFIRM_MS/);
  assert.match(app, /SYNC_RECONN_MIN_SHOW_MS/);
  // Built-in Script Op mirrors the pop-out (the reference surface): same tab
  // keys and captions, and a generated Display & Theme pane.
  assert.match(app, /LS_INSP_LABELS = \{ transport: 'Transport', live: 'Cue & On Air', clock: 'Clocks & Alerts', display: 'Display & Theme' \}/);
  assert.match(app, /function scriptOpDisplayPaneHTML/);
  assert.match(html, /data-insp-pane="display"><div id="lsDisplayControls">/);
  assert.doesNotMatch(html, /data-insp-pane="format"/);
  // The arrange + favorites engine loads on BOTH surfaces and shares its
  // storage keys, so an order or a star made in one window applies in both.
  assert.match(html, /cueola-scriptop-prefs\.js\?v=/);
  assert.match(scriptOpHtml, /cueola-scriptop-prefs\.js\?v=/);
  assert.match(prefs, /cueola_scriptop_section_order/);
  assert.match(prefs, /cueola_scriptop_favs/);
  assert.match(app, /CueolaScriptOpPrefs\.init\(/);
  assert.match(scriptOp, /CueolaScriptOpPrefs\.init\(/);
  // The builder's notes panel can expand any production note to full text.
  assert.match(app, /function pnToggleNote/);
  assert.match(app, /Show full note/);
});

test('8/19 round: per-app addresses, workspace launcher, talent display placement', async () => {
  const identityJs = await readFile(new URL('../../cueola-identity.js', import.meta.url), 'utf8');
  const deckJs = await readFile(new URL('../../cueola-streamdeck.js', import.meta.url), 'utf8');
  const hosting = await readFile(new URL('../../firebase.json', import.meta.url), 'utf8');
  const notFound = await readFile(new URL('../../404.html', import.meta.url), 'utf8');
  // Per-app addresses: one client-side resolver, honored by the router, the
  // talent-boot no-mint guard, and the deck's aux-window abstention.
  assert.match(app, /function cueolaAppPath\(\)/);
  assert.match(app, /\['plandabear', 'flowmingo', 'outrangutan', 'keywibird'\]/);
  assert.match(app, /cueolaAppPath\(\) === 'flowmingo'/);
  assert.match(deckJs, /seg === 'flowmingo'/);
  // Hosting rewrites name all four (the catch-all covers them anyway), and
  // the GitHub Pages 404 fallback carries the app into ?app=.
  ['/plandabear', '/keywibird', '/flowmingo', '/outrangutan'].forEach(p => assert.match(hosting, new RegExp(`"source": "${p}"`)));
  assert.match(notFound, /params\.set\('app', seg\)/);
  // Workspace launcher: modal, gesture-first window opens, the deferred
  // Script Op arm (it needs the live in-tab host), and the ?prepro=1 tab
  // hand-off that replaces the racy localStorage flag for launcher opens.
  assert.match(html, /id="modal-workspace"/);
  assert.match(app, /function launchWorkspace\(\)/);
  assert.match(app, /function armWorkspaceScriptop\(\)/);
  assert.match(app, /params\.get\('prepro'\) === '1'/);
  assert.match(identityJs, /openWorkspaceLauncher\(\)/);
  // Talent display placement mirrors Outrangutan's outputs: detected screens,
  // a remembered choice, features-string placement.
  assert.match(app, /function cueolaDetectScreens\(opts = \{\}\)/);
  // Sept-show update: silent re-detect when permission is already granted,
  // and a live screenschange watchdog so saved placements survive replugs.
  assert.match(app, /function cueolaDetectScreensIfPermitted\(\)/);
  assert.match(app, /screenschange/);
  assert.match(app, /getScreenDetails\(\)/);
  assert.match(app, /TALENT_SCREEN_KEY = 'cueola_talent_screen'/);
});

test('prompter scrub eases toward an accumulating target instead of teleporting', () => {
  // seek_line rides the jog smoother: each command moves the target, one rAF
  // loop eases the screen toward it, and the text never jumps under the
  // talent's eye. A command arriving mid-travel extends the SAME travel.
  const seek = app.slice(app.indexOf('function ptSeekByLines(lines)'), app.indexOf('function ptNoteLiveRow'));
  assert.match(seek, /ptJogBy\(n \* lineHeight\)/);
  assert.doesNotMatch(seek.slice(0, seek.indexOf('function ptJogBy')), /ptApplyScrollOffset/);
  assert.match(seek, /const base = ptJog \? ptJog\.target : ptOffset/);
  assert.match(seek, /if \(ptJog\) \{ ptJog\.target = target; return; \}/);
  assert.match(seek, /Math\.exp\(-dt \/ 80\)/);
  // Hidden/occluded windows get no animation frames: a watchdog lands the
  // move instantly there, and ONLY there. A visible window's stall (script
  // push re-layout, heavy shared-thread work) re-arms instead of teleporting.
  assert.match(seek, /ptJog\.watchdog = setTimeout\(ptJogWatchdog, 350\)/);
  assert.match(seek, /function ptJogLand\(\)/);
  const watchdog = seek.slice(seek.indexOf('function ptJogWatchdog'), seek.indexOf('function ptJogBy'));
  assert.match(watchdog, /visibilityState === 'hidden'\) \{ ptJogLand\(\); return; \}/);
  assert.match(watchdog, /setTimeout\(ptJogWatchdog, 350\)/);
  // Settling publishes the landed position, and mid-ease reporting carries the
  // jog TARGET (acks and heartbeats must not park the operator rail short).
  assert.match(seek, /function ptReportedOffset\(\) \{ return ptJog \? ptJog\.target : ptOffset; \}/);
  assert.match(app.slice(app.indexOf('function ptJogLand'), app.indexOf('function ptReportedOffset')), /setTransport\(/);
  assert.match(app, /position:ptReportedOffset\(\), targetSpeed:ptTargetSpeed, effectiveSpeed:ptLiveSpeed, lastCommandId:controlId/);
  assert.match(app, /offset: Math\.round\(ptReportedOffset\(\)\)/);
  // Pause freezes a mid-ease scrub where the screen is; a boot prime never
  // replays a stale RELATIVE scrub; a seeded position outranks in-flight travel.
  assert.match(app.slice(app.indexOf('function ptStopPlay()'), app.indexOf('function ptTogglePlay')), /ptCancelJog\(\)/);
  assert.match(app.slice(app.indexOf('function unseenPrompterQueueControls'), app.indexOf('function applyRemoteControlOnce')), /startsWith\('seek_line_'\)\) fresh\.push\(newest\)/);
  const seedBlock = app.slice(app.indexOf('const seedPct = Number(message.positionPct)'), app.indexOf('ptTargetSpeed = state.targetSpeed'));
  assert.ok((seedBlock.match(/ptCancelJog\(\)/g) || []).length >= 2);
  // The scrub write queue holds 24 commands: at the dial's 10 writes/s, an
  // 8-deep queue lost relative moves after any 0.8s listener gap.
  assert.match(app, /_prompterControlQueue = \[\..._prompterControlQueue, stamped\]\.slice\(-24\)/);
  // Scrub keeps the established repositioning contract: it overrides travel
  // in flight, drops a superseded advance's auto-resume, and re-baselines the
  // row holds once, on landing.
  assert.match(seek, /ptCancelGlide\(\)/);
  assert.match(seek, /ptPendingHoldResume = false/);
  assert.match(seek, /ptRecalcRowHolds\(\)/);
  // Mutual exclusion mirrors ptGlide everywhere position is owned or reset.
  assert.match(app, /if \(ptGlide \|\| ptJog\) \{/);                        // free-run defers
  assert.match(app, /ptCancelGlide\(\);   \/\/ an explicit position set overrides any travel in flight\n  ptCancelJog\(\);/);
  assert.match(app, /ptCancelJog\(\);   \/\/ an explicit destination \(row cue, find\) outranks a scrub/);
  assert.match(app.slice(app.indexOf('function ptResetScroll()'), app.indexOf('function ptProgressPct')), /ptCancelJog\(\)/);
  // A mid-scrub script push shifts the jog target with the content, both in
  // the anchor-preserving path and the proportional fallback.
  assert.match(app, /if \(ptJog\) ptJog\.target = Math\.max\(0, Math\.min\(max, ptJog\.target \+ delta\)\)/);
  assert.match(app, /if \(ptJog\) ptJog\.target \*= ratio/);
});

test('a parked manual playback call resumes when Manual TAKE turns off, from the banner or any machine', () => {
  // The resume: same call, same abort window, countdown starts now.
  const resume = app.slice(app.indexOf('function resumeParkedPlayoutCall'), app.indexOf('function resumePlayoutCallAuto'));
  assert.match(resume, /_rtrtCall\.stage !== 'ready' \|\| _rtrtCall\.timer\) return false/);
  assert.match(resume, /_rtrtCall\.manual = false/);
  assert.match(resume, /setTimeout\(\(\) => stepPlayoutCall\(\), RTRT_STAGE_MS\)/);
  // Both manual-off paths land there: the local checkbox/AUTO button, and a
  // flip adopted from another machine. The REMOTE flip is gated: only a fresh
  // park on the current live row auto-fires; a stale or moved-past park stays
  // parked (the flipping operator may not even see this machine's banner).
  assert.match(app.slice(app.indexOf('function setLiveCallManualArm'), app.indexOf('function adoptRtrtManual')), /resumeParkedPlayoutCall\('manual-off'\)/);
  const remoteFlip = app.slice(app.indexOf('function adoptRtrtManual'), app.indexOf('function resumeParkedPlayoutCall'));
  assert.match(remoteFlip, /Date\.now\(\) - \(_rtrtCall\.parkAt \|\| 0\) <= 15000/);
  assert.match(remoteFlip, /_rtrtCall\.rowIdx === liveActiveCueIndex\(\)/);
  assert.match(remoteFlip, /resumeParkedPlayoutCall\('manual-off-remote'\)/);
  assert.match(app, /stage: 'ready', timer: null, manual, parkAt: Date\.now\(\)/);
  // The banner explains the park and offers AUTO right where the op is stuck.
  assert.match(html, /id="lsCallAuto" onclick="resumePlayoutCallAuto\(\)"/);
  assert.match(html, /\.ls-call-auto\{background:color-mix/);
  const banner = app.slice(app.indexOf('function renderLiveCallBanner'), app.indexOf('function beginPlayoutCall'));
  assert.match(banner, /const parkedManual = stage === 'ready' && !!call\?\.manual/);
  assert.match(banner, /autoBtn\.hidden = autoBtn\.hidden \|\| !parkedManual/);
  assert.match(banner, /stageEl\.setAttribute\('data-tip'/);
});

test('the KeyWi window joins the show session the launcher hands it (?code=)', () => {
  const boot = app.slice(app.indexOf("if (appPath === 'plandabear' || appPath === 'outrangutan' || appPath === 'keywibird')"), app.indexOf("if (appPath === 'flowmingo'"));
  // Cold-boot reality: profile() restores asynchronously, so the gate is the
  // SYNCHRONOUS identity() marker plus an awaited firebase-ready + profile
  // wait; a profile() check at setTimeout(0) is null on every real launch.
  assert.match(boot, /window\.CueolaIdentity\?\.identity\?\.\(\)/);
  assert.match(boot, /await waitForFirebaseReady\(\)/);
  assert.match(boot, /!window\.CueolaIdentity\.profile\?\.\(\); waited \+= 250/);
  assert.match(boot, /cueolaEntryGateAllows\(kwCode, 'KeyWi Bird'\)/);
  assert.match(boot, /await joinSession\(\)/);
  // A failed join must not strand its modal over the deck.
  assert.match(boot, /hideModal\('modal-stud'\)/);
  // The surface opens either way: a signed-out or code-less window still gets
  // the KeyWi screen (and its own sign-in gate).
  assert.match(boot, /openControlSurface\(\);   \/\/ the KeyWi screen goes on top either way/);
});

test('the bridge overlay verbs toggle against the operator mirrors and reuse the Live senders', () => {
  const ov = app.slice(app.indexOf('function _sdPrompterOverlay'), app.indexOf('window.cueolaSurfaceBridge = {'));
  assert.match(ov, /mode === 'timeofday' \? 'clock_off' : 'clock_timeofday'/);
  assert.match(ov, /sendDurationClock\('po'\)/);
  assert.match(ov, /buildCountdownActionFromInput\('po'\)/);
  assert.match(ov, /sendWrapUp\('po', mins\)/);
  assert.match(ov, /toggleQuestionIndicator\('po'\)/);
  assert.match(ov, /'overlays_clear'/);
  // PUSH carries the desk's sync-scope semantics: a seed snapshot would
  // teleport and could STOP a rolling talent.
  assert.match(ov, /pushToPrompter\(\)/);
  assert.doesNotMatch(ov, /sendToPrompter\(true\)/);
  // The same wrap key toggles off; the other switches. The length is read
  // from the MIRRORED state (wrapSec), never a window-local memo, so it is
  // truthful across machines and reloads.
  assert.match(ov, /mode === 'wrap' && Number\(ptClockState\?\.wrapSec\) === mins \* 60/);
  assert.match(app, /targetTs:Date\.now\(\) \+ sec \* 1000, size:2, wrapSec:sec/);
  // Acks converge the talent-state mirrors in EVERY operator window: the
  // adoption runs before the pending-control target check.
  const ack = app.slice(app.indexOf('function _handlePrompterControlAck'), app.indexOf('// Split-brain recovery'));
  assert.ok(ack.indexOf('adoptPrompterTalentState(msg.state)') < ack.indexOf("msg.target && msg.target !== FLOWMINGO_ENDPOINT_ID"));
  // The bridge exposes the mirrored overlay state for the deck's lamps.
  assert.match(app, /prompterOverlay: \(op\) => \{ try \{ _sdPrompterOverlay\(op\); \} catch \(e\) \{\} \}/);
  assert.match(app, /clockMode: _sdSafe\(\(\) => \(ptClockState && ptClockState\.mode\) \|\| 'off', 'off'\)/);
  assert.match(app, /questionOn: _sdSafe\(\(\) => !!ptQuestionOn, false\)/);
});

test('deck strip monitors ride show truth in every window, not just the Live one', () => {
  // Talent position and transport adopt BEFORE the operator-runtime gate.
  const seen = app.slice(app.indexOf('function _notePrompterTalentSeen'), app.indexOf('function _shouldSendInitForTalent'));
  const pctAt = seen.indexOf('_talentReportedPct = Math.max');
  const playAt = seen.indexOf('_talentReportedPlaying = msg.state.running');
  const gateAt = seen.indexOf('if (!_prompterOperatorRuntimeActive) return false');
  assert.ok(pctAt >= 0 && playAt >= 0 && gateAt >= 0 && pctAt < gateAt && playAt < gateAt);
  // The bridge reports the talent's transport while a talent is alive, local
  // ptPlaying otherwise (the talent window itself, or a solo op). Freshness
  // keys off ADOPTED mirrors, never the raw sighting map (which the doc path
  // bumps before the protocol accepts() runs), and the indicator's clear
  // branch honors the same recency so gated windows keep their mirrors.
  assert.match(app, /function _sdPrompterPlayingTruth\(\)/);
  assert.match(app, /_talentMirrorSeenAt && \(Date\.now\(\) - _talentMirrorSeenAt\)/);
  assert.doesNotMatch(app.slice(app.indexOf('function _sdPrompterPlayingTruth'), app.indexOf('window.cueolaSurfaceBridge')), /_latestTalentSightingTs/);
  assert.match(app.slice(app.indexOf('function renderTalentPositionIndicator'), app.indexOf('const pct = Number.isFinite(_talentReportedPct)')), /_talentMirrorSeenAt/);
  assert.ok((app.match(/_sdSafe\(\(\) => _sdPrompterPlayingTruth\(\), false\)/g) || []).length >= 2);
  // Playout feed health rides the bridge so the strip can tell "linked and
  // idle" from "no playout linked to this session".
  assert.match(app, /fresh: !!nowPlaying \|\| !!\(Number\(live\.ts\) && Date\.now\(\) - Number\(live\.ts\) < 12000\)/);
});

for (const { name, run } of tests) {
  await run();
  console.log('PASS', name);
}
console.log(`PASS ${tests.length} Live UI contract tests`);
