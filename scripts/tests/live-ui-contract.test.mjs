import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [app, html, liveController, playbackJs, playbackCss, streamdeckJs] = await Promise.all([
  readFile(new URL('../../cueola-app.js', import.meta.url), 'utf8'),
  readFile(new URL('../../index.html', import.meta.url), 'utf8'),
  readFile(new URL('../../cueola-live-session.js', import.meta.url), 'utf8'),
  readFile(new URL('../../outrangutan/outrangutan.js', import.meta.url), 'utf8'),
  readFile(new URL('../../outrangutan/outrangutan.css', import.meta.url), 'utf8'),
  readFile(new URL('../../cueola-streamdeck.js', import.meta.url), 'utf8'),
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
  assert.match(app, /\['style','info','notes','min','sec','done','color','helperFor','helperRole','_createdAt','_createdBy'\]/);
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
  // Self-echo is the per-window sender only: the same-CLIENT_ID clause made a
  // sibling window (/keywibird) refuse the Live window's session forever.
  assert.doesNotMatch(adopt, /senderClient === CLIENT_ID/);
  assert.match(adopt, /if \(!senderClient \|\| isPrompterSelfSender\(d\.prompter\?\.sender\)\) return;/);
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
  assert.match(app, /function cuePrompterToLiveRow\(opts=\{\}\)/);
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
  // by id, and judges freshness by snapshot arrival gaps (sender-clock
  // staleness is gone: it dropped presses on skewed Macs).
  assert.match(app, /function runControlBusAction\(target, action/);
  assert.match(app, /if \(!isShowCaller\(\)\) return false/);
  assert.match(app, /cmd\.id === _lastControlBusId/);
  assert.match(app, /BUS_ARRIVAL_GAP_MS = 15000/);
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
  assert.match(app, /return \{ index, number: rowDisplayNumber\(index\), title: _sdBeatName\(b\) \|\| b\.info \|\| '' \};/);
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
  assert.match(seek, /ptJogBy\(n \* ptLinePitch\(\)\)/);   // measured pitch, not a 1.55em guess (9/4 A3)
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
  assert.match(app.slice(app.indexOf('function unseenPrompterQueueControls'), app.indexOf('function applyRemoteControlOnce')), /isCollaborativePrompterControl\(action\) && !action\.startsWith\('seek_line_'\) && !action\.startsWith\('seek_set_'\)\) fresh\.push\(newest\)/);
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
  // steadyTimeout, never setTimeout: a hidden tab's raw timers are throttled
  // to once a minute, which parked calls and fired TAKEs late (8/24 show).
  assert.match(resume, /steadyTimeout\(\(\) => stepPlayoutCall\(\), RTRT_STAGE_MS\)/);
  assert.doesNotMatch(resume, /[^y] setTimeout\(/);
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

test('every per-app window joins the show session the launcher hands it (?code=)', () => {
  const boot = app.slice(app.indexOf("if (appPath === 'plandabear' || appPath === 'outrangutan' || appPath === 'keywibird')"), app.indexOf("if (appPath === 'flowmingo'"));
  // Cold-boot reality: profile() restores asynchronously, so the gate is the
  // SYNCHRONOUS identity() marker plus an awaited firebase-ready + profile
  // wait; a profile() check at setTimeout(0) is null on every real launch.
  assert.match(boot, /window\.CueolaIdentity\?\.identity\?\.\(\)/);
  assert.match(boot, /await waitForFirebaseReady\(\)/);
  assert.match(boot, /!window\.CueolaIdentity\.profile\?\.\(\); waited \+= 250/);
  // 2026-08-24: /keywibird was the only per-app door that consumed ?code=.
  // Now all three do: KeyWi and Planda Bear join through the shared helper,
  // Outrangutan seeds its own join sheet with the handed code.
  assert.match(boot, /cueolaEntryGateAllows\(bootCode, surfaceLabel\)/);
  assert.match(boot, /joinHandedSession\('KeyWi Bird'\)/);
  assert.match(boot, /joinHandedSession\('Planda Bear'\)/);
  assert.match(boot, /openPaperworkHub\(\)/);
  assert.match(boot, /localStorage\.setItem\('cueola_outrangutan_code', bootCode\)/);
  assert.match(boot, /await joinSession\(\)/);
  // A failed join must not strand its modal over the app screen.
  assert.match(boot, /hideModal\('modal-stud'\)/);
  // The surface opens either way: a signed-out or code-less window still gets
  // the KeyWi screen (and its own sign-in gate).
  assert.match(boot, /openControlSurface\(\);   \/\/ the KeyWi screen goes on top either way/);
});

test('playout commands are confirmed, retried, and never swallowed silently (8/24 rebuild)', () => {
  // Sender: origId rides every command; unconfirmed commands retry on a
  // worker-backed timer; exhausted retries TELL the operator instead of
  // letting them discover it by dead air.
  assert.match(app, /command\.origId = command\.commandId/);
  assert.match(app, /_trackOutCommand\(command\)/);
  assert.match(app, /Playout did NOT confirm the last command/);
  assert.match(app, /applyOutrangutanCmdAck\(og\.cmdAck\)/);
  // TAKE-linked pads ride the SAME write as the cue fire (single-slot races).
  assert.match(app, /if \(takePads\.length\) opts\.pads = takePads/);
  // The vestigial local Outrangutan can never swallow fires while a REAL
  // playout machine is publishing: remoteAirDriving guards every fast path.
  assert.match(app, /local\.session\(\) === session\.code && !remoteAirDriving\(\)/);
  assert.match(app, /function remoteAirDriving\(\)/);
  // The show-critical one-shots ride worker timers, immune to hidden-tab
  // throttling: RTRT stages, the delayed arm, the rundown-to-prompter seek.
  assert.match(app, /function steadyTimeout\(fn, ms\)/);
  assert.match(app, /_pendingArmTimer = steadyTimeout\(/);
  assert.match(app, /steadyTimeout\(\(\) => sendPrompterControl\(`seek_row_\$\{rowNum\}`, payload\), 150\)/);
  // Air side: acks every command, dedupes retries by origId, fires pads that
  // ride a cue write, and stamps the ack-capable protocol version.
  assert.match(playbackJs, /ackRemoteCommand\(cmd\)/);
  assert.match(playbackJs, /cmdOrigSeen\(cmd\.origId\)/);
  assert.match(playbackJs, /live\.proto = 3/);
  assert.match(playbackJs, /Array\.isArray\(cmd\.pads\)/);
  // A deaf Air LOOKS deaf: the mode badge flips to NOT LISTENING.
  assert.match(playbackJs, /NOT LISTENING/);
});

test('PANIC rides its own overwrite-proof lane (proto 3, C.5)', () => {
  // Sender: the panic write carries the dedicated field alongside the legacy
  // slot, a panic purges every in-flight redelivery (a surviving pad retry
  // could restart audio after the kill), and a pending panic is never
  // superseded by a later command.
  assert.match(app, /payload\['outrangutan\.panic'\] = \{ id: command\.commandId, origId: command\.origId, ts: command\.ts, by: command\.by, sender: command\.sender \}/);
  assert.match(app, /if \(command\.action === 'panic'\) _ogPendingCmds = \[\];/);
  assert.match(app, /p\.command\.action === 'pad' \|\| p\.command\.action === 'panic'/);
  // A panic retry rewrites the field with a FRESH lane id (a resubscribed Air
  // baselined the previous id without executing).
  assert.match(app, /if \(p\.command\.action === 'panic'\) payload\['outrangutan\.panic'\] = \{ id: p\.command\.commandId, origId: p\.command\.origId/);
  // The pending cap must never evict the panic (it always sits at index 0,
  // where a plain shift() would silently drop it).
  assert.match(app, /findIndex\(p => p\.command\.action !== 'panic'\)/);
  // Every window observes panics: another window's pending GO retry would
  // rewrite the slot after the kill and restart audio (C.5 across surfaces).
  assert.match(app, /og\.panic\.sender !== FLOWMINGO_ENDPOINT_ID && _ogPendingCmds\.length/);
  // Air: own dedupe id, primed baseline on subscribe (a reconnect must never
  // replay a stale panic), reset on unsubscribe, shared origId memory with
  // the slot copy, and an ack so the sender's retry loop stands down.
  assert.match(playbackJs, /let lastPanicId = null;/);
  assert.match(playbackJs, /if \(pn && pn\.id\) lastPanicId = pn\.id;/);
  assert.match(playbackJs, /lastCmdId = null; lastGainId = null; lastPanicId = null;/);
  assert.match(playbackJs, /if \(!cmdOrigSeen\(orig\)\) \{ noteCmdOrig\(orig\); panic\(\); \}/);
  assert.match(playbackJs, /ackRemoteCommand\(\{ commandId: pn\.id, origId: orig \}\)/);
  // The lane must run BEFORE the command-slot early returns: a panic sharing
  // a snapshot with a stale or already-consumed command must still fire.
  const pnLane = playbackJs.indexOf("if (pn && pn.id && pn.id !== lastPanicId && pn.sender !== OG_SENDER)");
  const slotDedupe = playbackJs.indexOf("if (!cmd || !cmd.commandId || cmd.commandId === lastCmdId) return;");
  assert.ok(pnLane >= 0 && slotDedupe >= 0 && pnLane < slotDedupe, 'panic lane must be handled before the command-slot dedupe returns');
});

test('preflight reports this machine\'s control links honestly (plan item 6)', () => {
  // Rows only exist for systems with evidence on this machine: OBS needs a
  // saved config, talkback needs a daemon ever seen, and the deck row is
  // removed outright when no deck evidence exists.
  assert.match(app, /function obsSystemStatus\(\)/);
  assert.match(app, /if \(!configured\) return null;/);
  assert.match(app, /if \(!tb \|\| !tb\.seen\) return null;/);
  assert.match(app, /removePreflightRow\('Stream Deck'\);/);
  assert.match(app, /if \(granted === 0\) _sysChipNoteDeckGone\(\);/);
  // The deck verdict is the honest cross-window read: this window's device,
  // OR a fresh ownership beat from another window (vetoed by a probe that
  // proved zero decks plugged), OR a granted-but-idle deck as a warning.
  // Never the per-window flag alone.
  assert.match(app, /if \(st\.connectedHere\) setPreflightRow\('Stream Deck'/);
  assert.match(app, /else if \(st\.drivenElsewhere && granted !== 0\) setPreflightRow\('Stream Deck'/);
  assert.match(app, /else if \(granted > 0\) setPreflightRow\('Stream Deck'/);
  // KeyWi exports the snapshot getters, and the beat read follows the
  // watchdog's rule: a missing beat is unknown, never dead.
  assert.match(streamdeckJs, /talkbackStatus: function \(\)/);
  assert.match(streamdeckJs, /deckStatus: function \(\)/);
  assert.match(streamdeckJs, /grantedDecks: function \(\)/);
  assert.match(streamdeckJs, /drivenElsewhere: !device && beatFresh/);
  // The topbar chip: quiet by doctrine, damped by two-tick agreement, and a
  // click opens the full preflight.
  assert.match(html, /id="sysChip"[^>]*onclick="openPreflightPanel\(\)"/);
  assert.match(app, /raw\[k\] === _sysChip\.prev\[k\] && raw\[k\] !== _sysChip\.applied\[k\]/);
  assert.match(html, /\.cc-sys-item\[data-state="warn"\]/);
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
  assert.match(app, /targetTs:Date\.now\(\) \+ sec \* 1000, wrapSec:sec/);   // size is a display preference the merge carries (9/4 A3)
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
  // idle" from "no playout linked to this session". Liveness uses the
  // ARRIVAL clock (this window's), never the sender's ts: clock skew between
  // Macs must not make a healthy playout read as absent.
  assert.match(app, /fresh: !!nowPlaying \|\| !!\(_ogLiveSeenAt && Date\.now\(\) - _ogLiveSeenAt < 12000\)/);
  assert.match(app.slice(app.indexOf('function applyOutrangutanState'), app.indexOf('function playoutNow')), /_ogLiveSeenAt = Date\.now\(\)/);
  // Firing into a show with no playout listening warns the operator
  // (throttled) instead of leaving them to discover it by dead air.
  const fire = app.slice(app.indexOf('function fireOutrangutanCommand'), app.indexOf('function fireOutrangutanGain'));
  assert.match(fire, /no Outrangutan has checked in on this show/);
  assert.match(fire, /_ogNoListenerToastAt > 20000/);
});

test('control bus survives clock skew and non-executing windows never steal the claim', () => {
  // Arrival evidence, not clock comparison: a new command id during a
  // continuous snapshot stream executes with no clock math (the old 5s
  // sender-clock window dropped every press between drifted Macs); across a
  // delivery gap (first snapshot, reconnect) a bounded 30s admission applies,
  // so last class's GO can never fire hours late and a swallowed press logs.
  const bus = app.slice(app.indexOf('function applyControlBusCommand'), app.indexOf('// Auto-fire linked Outrangutan'));
  assert.match(bus, /arrivalGapMs < BUS_ARRIVAL_GAP_MS/);
  assert.match(bus, /Math\.abs\(Date\.now\(\) - cmd\.ts\) <= BUS_GAP_ADMIT_MS/);
  assert.match(bus, /ignored a command from across a sync gap/);
  assert.doesNotMatch(bus, /cmd\.ts > 5000/);
  assert.match(app, /applyControlBusCommand\(d\.controlBus, _lastBusSnapshotAt \? Date\.now\(\) - _lastBusSnapshotAt : Infinity\)/);
  // Bus state is per-session: ids and claims never carry across a rejoin.
  assert.match(app, /_lastControlBusId = '';\n      _lastBusSnapshotAt = 0;\n      _busExecutorClaim = null;\n      _busClaimSeenAt = 0;/);
  // Claim theft is gated on being able to execute: the KeyWi window and any
  // rundown-parked window used to grab the claim, run nothing, and black-hole
  // deck commands for 15s at a stretch.
  // (9/4 slice A2: the gate is the Live lifecycle, not the #liveshow class.)
  assert.match(bus, /if \(!liveRuntimeOn\(\) \|\| !isShowCaller\(\)\) return;/);
  // Foreign claim liveness is judged by heartbeat ARRIVAL; the stamp refreshes
  // only when the claim changed, and a claim already ancient at first sight
  // (dead holder) is left stale so the live caller takes over immediately.
  const stale = app.slice(app.indexOf('function _busClaimIsStale'), app.indexOf('function holdsBusExecutorClaim'));
  assert.match(stale, /_busClaimSeenAt/);
  assert.match(app, /deadOnArrival \? 0 : Date\.now\(\)/);
  // A ghost abort is a diagnosis now: the toast names the source, including
  // the same-machine deck path's 'deck' token.
  const abortFn = app.slice(app.indexOf('function abortPlayoutCall'), app.indexOf('function applyRemoteLiveCall'));
  assert.match(abortFn, /aborted \(\$\{why\}\)/);
  assert.match(abortFn, /source === 'deck' \? 'deck ABORT key'/);
});

test('talent overlay CSS: theme tokens, stage-relative banners, honest read line, mirror, doctrine (9/4 slice F)', () => {
  const styleStart = html.indexOf('<style');
  const styleEnd = html.indexOf('</style>');
  const css = html.slice(styleStart, styleEnd);
  const rule = (selector) => {
    const at = css.indexOf('\n' + selector + '{') + 1;   // rule at a line start (theme overrides repeat selectors mid-line)
    assert.notEqual(at, 0, `missing rule ${selector}`);
    return css.slice(at, css.indexOf('}', at));
  };
  // Overlay tokens live on #promptypus and follow the prompter theme; the
  // white theme gets a tinted glass (no stroke) and black copy.
  const screen = rule('#promptypus');
  assert.match(screen, /--pt-ovl-bg:color-mix\(in srgb,var\(--pt-bg,#0a0a0a\) 66%,transparent\)/);
  assert.match(screen, /--pt-ovl-fg:var\(--pt-text,#fff\)/);
  assert.match(screen, /--pt-ovl-fg-dim:/);
  const white = rule('#promptypus[data-pt-theme="white"]');
  assert.match(white, /--pt-ovl-fg:#000/);
  // Clock, label, value, question and the chips are driven by the tokens.
  const clock = rule('.pt-clock-overlay');
  assert.match(clock, /background:var\(--pt-ovl-bg\)/);
  assert.match(clock, /color:var\(--pt-ovl-fg\)/);
  assert.match(rule('.pt-clock-label'), /color:var\(--pt-ovl-fg-dim\)/);
  assert.match(rule('.pt-clock-value'), /color:var\(--pt-ovl-fg\)/);
  const question = rule('#pt-question-overlay');
  assert.match(question, /background:var\(--pt-ovl-bg\)/);
  assert.match(question, /color:var\(--pt-ovl-fg\)/);
  assert.match(rule('#pt-hold-chip,#pt-next-chip'), /background:var\(--pt-ovl-bg\)/);
  assert.match(css, /\.pt-chip-label\{/);
  assert.match(css, /\.pt-chip-row\{/);
  assert.match(css, /#pt-hold-chip\[hidden\],#pt-next-chip\[hidden\]\{display:none\}/);
  // Wrap stays red with white copy; expired copy is pinned white; the
  // QUESTION tag stays yellow on dark.
  assert.match(rule('.pt-clock-overlay.wrap'), /#b31322[^}]*color:#fff/);
  assert.match(rule('.pt-clock-overlay.wrap .pt-clock-label'), /color:#fff/);
  assert.match(css, /\.pt-clock-overlay\.expired:not\(\.timeofday\) :is\(\.pt-clock-label,\.pt-clock-value\)\{color:#fff\}/);
  assert.match(rule('.pt-question-tag'), /background:#ffd23c;color:#121212/);
  // Tech slate copy is pinned light on the fixed dark card.
  assert.match(rule('.pt-slate-title'), /color:#f0ead6/);
  assert.match(rule('.pt-slate-sub'), /color:#f0ead6/);
  assert.match(css, /#pt-slate\{background:#07090f/);
  // The drawn read line is the stage center, the same point JS readY uses.
  assert.match(rule('#pt-read-line'), /top:calc\(50% \+ var\(--pt-bar-h,48px\) \/ 2\)/);
  // Clock and question live inside #pt-stage: offsets are stage relative
  // (no bar-h term) and mirror flips only the slate on its own.
  assert.match(clock, /top:24px/);
  assert.doesNotMatch(clock, /--pt-bar-h/);
  assert.match(question, /top:26px/);
  assert.doesNotMatch(question, /--pt-bar-h/);
  assert.match(css, /#promptypus\.mirrored #pt-slate\{transform:scaleX\(-1\)\}/);
  assert.doesNotMatch(css, /#promptypus\.mirrored::before/);
  assert.doesNotMatch(css, /#promptypus\.mirrored \.pt-clock-overlay/);
  // Overlay size: buckets 0..4 stay, no px ceilings on the type, size 4 gets
  // a 24vh band, the question clamps to two lines at the two largest steps.
  assert.match(css, /\.pt-clock-overlay\.size-4,#pt-question-overlay\.size-4\{--pt-ovl-scale:1\.75;max-height:24vh\}/);
  assert.match(rule('.pt-clock-label'), /max\(12px,min\(1\.8vw,2\.1vh\)\)/);
  assert.match(rule('.pt-clock-value'), /max\(30px,min\(7vw,7\.5vh\)\)/);
  assert.match(rule('.pt-clock-overlay.wrap .pt-clock-value'), /max\(36px,min\(10vw,7vh\)\)/);
  assert.doesNotMatch(rule('.pt-clock-label'), /clamp\(/);
  assert.doesNotMatch(question, /clamp\(/);
  // Both XL (size-3) and MAX (size-4) clamp to two lines: three XL lines
  // plus the tag overrun the 20vh band on real displays.
  assert.match(css, /#pt-question-overlay\.size-3 \.pt-question-text,#pt-question-overlay\.size-4 \.pt-question-text\{-webkit-line-clamp:2\}/);
  assert.doesNotMatch(css, /\n#pt-question-overlay\.size-4 \.pt-question-text\{-webkit-line-clamp:2\}/, 'size-4-only clamp rule must not come back');
  assert.match(question, /max-width:min\(720px,34vw\)/);
  // Doctrine: no colored strokes or rings, no glow on bold script text, hold
  // chip pulses three times then holds, expired digits pulse four times.
  assert.doesNotMatch(rule('.pt-clock-overlay.wrap'), /border-color|box-shadow/);
  assert.doesNotMatch(rule('.pt-clock-overlay.expired:not(.timeofday)'), /border-color/);
  assert.match(rule('#pt-hold-chip'), /animation:ptHoldPulse 2\.4s ease-in-out 3/);
  assert.match(css, /\.pt-clock-overlay\.expired:not\(\.timeofday\) \.pt-clock-value\{animation:ptExpiredPulse 1s ease-in-out 4\}/);
  assert.match(rule('.pt-slate-mark'), /border:1px solid transparent/);
  assert.match(css, /#pt-text strong,\.prompt-op-text strong,\.flowop-script strong\{[^}]*text-shadow:none/);
  assert.match(clock, /border-radius:var\(--ui-radius-panel\)/);
  assert.match(question, /border-radius:var\(--ui-radius-group\)/);
  assert.match(rule('.pt-question-tag'), /border-radius:999px/);
  // Motion: banners and the slate fade (opacity + visibility), no display
  // toggle; chips keep display:none while hidden.
  for (const r of [clock, question, rule('#pt-slate')]) {
    assert.match(r, /opacity:0;visibility:hidden;transition:opacity/);
    assert.doesNotMatch(r, /display:none/);
  }
  assert.match(css, /\.pt-clock-overlay\.on\{opacity:1;visibility:visible/);
  assert.match(css, /#pt-question-overlay\.on\{opacity:1;visibility:visible/);
  assert.match(css, /#pt-slate\.on\{opacity:1;visibility:visible/);
  // Wrap lifts over the talent panel; fullscreen fades the bar until the
  // cursor comes back; the edit overlay sits under the sign-in modal (300).
  assert.match(css, /#promptypus:has\(#pt-panel:not\(\.hidden\)\) \.pt-clock-overlay\.wrap\{bottom:/);
  // Both fullscreen shapes fade the bar: the launcher fullscreens the root
  // (:fullscreen #promptypus), the F key fullscreens #promptypus itself.
  // Standard and -webkit- forms live in separate rules (an unsupported
  // pseudo-class drops the whole selector list), and the reveal targets
  // #pt-bar:not(.hidden) so an H-hidden bar never comes back on mouse move.
  assert.match(css, /:fullscreen #promptypus #pt-bar,#promptypus:fullscreen #pt-bar\{opacity:0;pointer-events:none\}/);
  assert.match(css, /:fullscreen #promptypus\.show-cursor #pt-bar:not\(\.hidden\),#promptypus:fullscreen\.show-cursor #pt-bar:not\(\.hidden\)\{opacity:1;pointer-events:auto\}/);
  assert.match(css, /:-webkit-full-screen #promptypus #pt-bar,#promptypus:-webkit-full-screen #pt-bar\{opacity:0;pointer-events:none\}/);
  assert.match(css, /:-webkit-full-screen #promptypus\.show-cursor #pt-bar:not\(\.hidden\),#promptypus:-webkit-full-screen\.show-cursor #pt-bar:not\(\.hidden\)\{opacity:1;pointer-events:auto\}/);
  assert.doesNotMatch(css, /[^-]:fullscreen[^{}]*-webkit-full-screen[^{}]*\{|-webkit-full-screen[^{}]*[^-]:fullscreen[^{}]*\{/, 'fullscreen and -webkit-full-screen must not share one selector list');
  assert.doesNotMatch(css, /show-cursor #pt-bar\{opacity:1/);
  // Narrow windows: chips drop into the bottom zone as compact pills, lift
  // above the talent panel, and yield to a WRAP banner.
  const narrow = css.match(/@media\(max-width:1000px\)\{\n#pt-hold-chip,#pt-next-chip\{[^}]*\}[\s\S]*?\n\}/);
  assert.ok(narrow, 'narrow-width chip media block');
  assert.match(narrow[0], /#pt-hold-chip,#pt-next-chip\{top:auto;bottom:calc\(72px \+ env\(safe-area-inset-bottom\)\);max-width:calc\(50vw - 40px\);flex-direction:row;align-items:baseline;gap:8px;padding:6px 10px\}/);
  assert.match(narrow[0], /#pt-hold-chip \.pt-chip-row,#pt-next-chip \.pt-chip-row\{font-size:18px\}/);
  assert.match(narrow[0], /#promptypus:has\(#pt-panel:not\(\.hidden\)\) #pt-hold-chip,#promptypus:has\(#pt-panel:not\(\.hidden\)\) #pt-next-chip\{bottom:calc\(140px \+ env\(safe-area-inset-bottom\)\)\}/);
  assert.match(narrow[0], /#promptypus:has\(\.pt-clock-overlay\.wrap\.on\) #pt-hold-chip,#promptypus:has\(\.pt-clock-overlay\.wrap\.on\) #pt-next-chip\{display:none\}/);
  // Source order: the narrow block must follow the base chip rule (same id
  // specificity, so order decides).
  assert.ok(css.indexOf('#pt-hold-chip,#pt-next-chip{position:absolute') < css.indexOf('@media(max-width:1000px){\n#pt-hold-chip'));
  assert.match(rule('#pt-edit-overlay'), /z-index:250/);
  // Size changes must not animate: the anchor math measures synchronously.
  assert.doesNotMatch(rule('#pt-text'), /transition:[^;]*font-size/);
});

test('preflight card always reaches its buttons; exit sheet and caller chip have styles to hang on', () => {
  const css = html.slice(html.indexOf('<style'), html.indexOf('</style>'));
  const rule = (selector) => {
    const at = css.indexOf('\n' + selector + '{') + 1;   // rule at a line start (theme overrides repeat selectors mid-line)
    assert.notEqual(at, 0, `missing rule ${selector}`);
    return css.slice(at, css.indexOf('}', at));
  };
  const card = rule('.precheck-card');
  assert.match(card, /max-height:min\(820px,calc\(100dvh - 48px\)\)/);
  assert.match(card, /overflow:hidden/);
  const rows = rule('#goLiveCheckRows');
  assert.match(rows, /flex:1 1 auto;min-height:0;overflow-y:auto/);
  assert.match(rows, /scrollbar-gutter:stable/);
  assert.match(rows, /padding:0 2px 6px 0/);
  assert.match(rule('.precheck-actions'), /flex:none/);
  assert.doesNotMatch(rule('.precheck-actions'), /sticky/);
  assert.doesNotMatch(css, /\.overlay\.u-overlay-center\{[^}]*overflow/);
  assert.match(css, /@media \(max-width:900px\),\(max-height:640px\)\{\s*\.precheck-card\{padding:18px 16px/);
  // Group header line and the fix capsule (same recipe as the jump link).
  assert.match(css, /\.precheck-group\{/);
  assert.match(css, /\.precheck-group\[data-state="fail"\] \.precheck-group-dot\{background:var\(--red\)\}/);
  assert.match(css, /\.precheck-group\[aria-expanded="false"\] \.precheck-group-chev\{transform:rotate\(-90deg\)\}/);
  assert.match(rule('.precheck-fix'), /color:var\(--accent\);background:color-mix\(in srgb,var\(--accent\) 12%,transparent\);border:1px solid transparent/);
  assert.match(rule('.precheck-body'), /flex:1 1 auto/);
  // Exit sheet list and toggles, Build toolbar caller chip and banner.
  assert.match(css, /\.live-exit-list\{list-style:none/);
  assert.match(css, /\.live-exit-item\{/);
  assert.match(css, /\.live-exit-toggle\{/);
  assert.match(css, /\.live-exit-toggle input\{[^}]*accent-color:var\(--accent\)/);
  assert.match(rule('#rdCallerBtn'), /border-radius:20px/);
  assert.match(css, /#rdCallerBtn\[data-state="caller"\]\{[^}]*color:var\(--green\)\}/);
  assert.match(css, /#rdCallerBtn\[data-state="granted"\]\{[^}]*color:var\(--accent\)\}/);
  assert.match(css, /\.rd-caller-banner\{/);
  assert.match(css, /\.rd-caller-banner\[hidden\]\{display:none\}/);
});

test('cross-device talent control: doc-path transport, rebind on evidence, doc seeds never play (9/4 slice A1)', async () => {
  const prompterSession = await readFile(new URL('../../cueola-prompter-session.js', import.meta.url), 'utf8');
  // Transport never waits on the handshake when the session doc can carry it;
  // the readiness queue survives only for the no-session-code case.
  const send = app.slice(app.indexOf('function sendPrompterControl('), app.indexOf('// ─────────────────────────────────────────────────────────────\n// PROMPTYPUS'));
  assert.match(send, /if \(!prompterControlDocPathAvailable\(control\) && !prompterSessionController\.isReady\(_activePrompterOutputInstanceId\)\)/);
  assert.match(app, /function prompterControlDocPathAvailable\(control, codeOverride=''\)/);
  assert.match(app, /return Boolean\(window\._firebaseReady && code\);/);
  const flowSend = app.slice(app.indexOf('function flowOpSendControl('), app.indexOf('function flowOpToggleTechDifficulty'));
  assert.match(flowSend, /if \(!prompterControlDocPathAvailable\(control, flowOpCode\) && !prompterSessionController\.isReady/);
  // Rebind on EVIDENCE (pinned talent silent, or the newcomer echoes our
  // snapshotId), never on a newer heartbeat ts; recovery rides sync scope.
  const handler = app.slice(app.indexOf('function _handlePrompterOperatorMessage('), app.indexOf('function _ensurePrompterOperatorBridge('));
  assert.match(handler, /const evidence = _shouldRebindToTalent\(msg\);   \/\/ '' \| 'silent' \| 'echo'\n      if \(!evidence\) return;/);
  assert.match(handler, /Talent output replaced/);
  assert.match(handler, /_noteTalentRegistry\(outputId, msg\)/);
  assert.match(handler, /sendPrompterStateSnapshot\(outputId, 'recovery'\);\n      \}\n      return;/);
  assert.doesNotMatch(handler, /msg\.ts >/);
  const rebind = app.slice(app.indexOf('function _shouldRebindToTalent('), app.indexOf('function _dropTalentTransportMirror('));
  assert.match(rebind, /\['degraded', 'lost'\]\.includes\(link\?\.status\)/);
  assert.match(rebind, /snapshotId !== String\(prompterSessionController\.getState\(\)\.snapshotId \|\| ''\)\) return '';/);
  // Doc-delivered seeds never start playback; a live renderer (rolling, or
  // mid-glide/jog) takes script/display/identity only.
  const apply = app.slice(app.indexOf('function applyCompletePrompterState('), app.indexOf('function _postPrompterMessage('));
  assert.match(apply, /const wantRunning = viaDoc \? false : Boolean\(state\.running\);/);
  assert.match(apply, /if \(wantRunning && !ptPlaying\) ptStartPlay\(\);/);
  assert.doesNotMatch(apply, /if \(state\.running && !ptPlaying\) ptStartPlay\(\)/);
  assert.match(apply, /const liveRenderer = ptHasScript\(\) && \(ptPlaying \|\| !!ptGlide \|\| !!ptJog\);/);
  assert.match(apply, /if \(seed && !liveRenderer\) \{/);
  assert.match(apply, /ptWriteTalentApplied\(applied\)/);
  // The talent door retargets the doc seed once (fresh boot) and applies it
  // as doc-delivered; both talent listeners gate doc controls with
  // accepts({ allowLegacy, ignoreTarget }).
  assert.match(app, /stateMessage = \{ \.\.\.stateMessage, targetOutputInstanceId:FLOWMINGO_ENDPOINT_ID \};/);
  assert.match(app, /applyCompletePrompterState\(stateMessage, \{ viaDoc:true \}\)/);
  assert.equal((app.match(/accepts\(control, \{ allowLegacy:true, ignoreTarget:true \}\)/g) || []).length, 2);
  assert.match(prompterSession, /if \(!options\.ignoreTarget && target && target !== instanceId/);
  // One-hop readiness over the doc, and sync re-sends before 'recovering'.
  assert.match(app, /'prompter\.talentApplied': \{/);
  assert.match(app, /_handlePrompterOperatorMessage\(\{ \.\.\._ta, type:'PROMPTER_STATE_APPLIED' \}\)/);
  assert.match(app, /_prompterHandshakeResends < 3/);
  assert.match(app, /sendPrompterStateSnapshot\(outputInstanceId, 'resend', 'sync'\)/);
  // Identity: mint only with the Live runtime on; never blank the doc's id.
  assert.match(app, /_prompterMayMintPrompterSession\(\) && !IS_PROMPTER_TALENT_BOOT && isShowCaller\(\)/);
  assert.equal((app.match(/\.\.\.\((?:message|protocolState)\.sessionId \? \{ 'prompter\.sessionId':/g) || []).length, 2);
  // Stale mirrors drop on degraded/lost; the deck reads mirror freshness and
  // talent truth; the doc seed is honest when no talent mirror exists.
  const transition = app.slice(app.indexOf('function projectTalentLinkTransition('), app.indexOf('let _talentNudgeTimer'));
  assert.match(transition, /_dropTalentTransportMirror\(\)/);
  assert.match(app, /connected: _sdSafe\(\(\) => _talentMirrorFresh\(\), false\)/);
  assert.doesNotMatch(app, /prompterTalentConnected/);
  // KEYMAP playpause + toggle, and the control bus 'toggle' verb (cross-machine deck).
  assert.equal((app.match(/sendPrompterControl\(_sdPrompterPlayingTruth\(\) \? 'pause' : 'resume'\)/g) || []).length, 3);
  assert.doesNotMatch(app, /run: \(\) => sendPrompterControl\(ptPlaying \? 'pause' : 'resume'\)/);
  assert.match(app, /docMessage\.positionPct = null;/);
  assert.match(app, /docMessage\.state\.running = false;/);
  // Honest status line, pop-out copy, and the talent's refused-write notice.
  assert.match(app, /function _talentStatusLine\(\)/);
  assert.match(app, /talent:\{ line:_talentStatusLine\(\), connected:_talentMirrorFresh\(\) \}/);
  assert.match(app, /'Sent to the session'/);
  assert.match(app, /ptSetCueolaStatus\('Cloud write refused: sign in again on this device', true\)/);
});

test('prompter follows the rundown by one rule per surface (9/4 slice A2)', async () => {
  const scriptOp = await readFile(new URL('../../script-operator.js', import.meta.url), 'utf8');
  // Follower gate: a non-caller Live window browses (selection only) on
  // arrows / Previous; nothing rides to the talent, the playout Air or the
  // show log, the toast is throttled, and the browse is never a refusal.
  const browse = app.slice(app.indexOf('function lsBrowseAsFollower('), app.indexOf('function lsNext('));
  assert.match(browse, /const from = liveSelectedCueIndex\(\);/);
  assert.match(browse, /setLiveSelectedCue\(target, \{ reason:'browse' \}\)/);
  assert.match(browse, /renderLive\(\);\s+syncLiveIdx\(\);/);
  assert.match(browse, /Date\.now\(\) - _browseToastAt > 8000/);
  assert.match(browse, /is calling the show\./);
  assert.doesNotMatch(browse, /updatePrompterOnAdvance|fireOutrangutanAutoForBeat|maybeArmNextPlayout|logShow/);
  assert.match(browse, /return true;\n\}/);
  const next = app.slice(app.indexOf('function lsNext('), app.indexOf('function rowLogLabel('));
  assert.match(next, /if \(!liveCommandDispatchAllowed\(\{ notify:true \}\)\) return false;\n  if \(!isShowCaller\(\)\) return lsBrowseAsFollower\(1\);/);
  const prev = app.slice(app.indexOf('function lsPrev('), app.indexOf('function resolveFollowedIdx('));
  assert.match(prev, /if \(!isShowCaller\(\)\) return lsBrowseAsFollower\(-1\);/);
  // Advance intent: only updatePrompterOnAdvance sends { advance:true }; the
  // payload reaches ptSeekToRow from both remote-control receivers.
  const advance = app.slice(app.indexOf('function updatePrompterOnAdvance('), app.indexOf('function cuePrompterToLiveRow('));
  assert.match(advance, /cuePrompterToLiveRow\(\{ advance: !!\(opts && opts\.advance === true\) \}\);/);
  assert.equal((app.match(/cuePrompterToLiveRow\(\{ advance:true \}\)/g) || []).length, 0);
  const cue = app.slice(app.indexOf('function cuePrompterToLiveRow('), app.indexOf('let _lastTalentPosPct'));
  assert.match(cue, /const payload = opts && opts\.advance === true \? \{ advance:true \} : null;/);
  assert.match(app, /ptSeekToRow\(action\.replace\('seek_row_', ''\), payload\)\.then/);
  assert.match(app, /if \(action\?\.startsWith\('seek_row_'\)\) \{ ptSeekToRow\(action\.replace\('seek_row_', ''\), payload\); return; \}/);
  // ptSeekToRow: an advance never travels backward. Inside the row (header n
  // at/above its landing spot, header n+1 below the read line) releases the
  // hold in place; past the row stays put, keeps a boundary hold at n+1, and
  // flags AHEAD beyond that. Explicit cues keep the unconditional glide.
  const seek = app.slice(app.indexOf('function ptSeekToRow(rowNum, payload=null)'), app.indexOf('function ptShowTechSlate'));
  assert.match(seek, /const advance = !!\(payload && payload\.advance === true\) && !backward;/);
  assert.match(seek, /if \(top <= targetY \+ 8 && afterTop > readY\) \{/);
  assert.match(seek, /const resume = !ptPlaying && \(ptAutoHeldRow != null \|\| ptPendingHoldResume\);/);
  assert.match(seek, /if \(resume\) ptStartPlay\(\);/);
  assert.match(seek, /if \(afterTop <= readY\) \{\n        if \(!ptGlide\) ptPendingHoldResume = false;\n        ptNoteLiveRow\(n\);\n        ptAheadOfLive = ptAutoHeldRow !== n \+ 1;/);
  assert.match(seek, /ptAheadOfLive = false;   \/\/ a seek that moves puts the talent back in step/);
  assert.match(seek, /ptGlideToOffset\(ptOffset \+ delta, \(\) => \{/);
  // A seek whose header is not rendered yet parks for ONE retry after the
  // next script render; the render also rebuilds the hold boundaries.
  assert.match(seek, /if \(n <= total && !\(payload && payload\.retry\)\) ptPendingSeekRow = \{ row:n, payload:\{ \.\.\.\(payload \|\| \{\}\), retry:true \} \};/);
  const update = app.slice(app.indexOf('function ptUpdateFromCueola('), app.indexOf('// Connection state for the talent setup/ready indicator.'));
  assert.match(update, /ptUpdateProgress\(\);\n    [^\n]*\n[^\n]*\n[^\n]*\n    ptRecalcRowHolds\(\);/);
  assert.match(update, /ptSeekToRow\(pending\.row, pending\.payload\)/);
  // Hold-release fallback lives in the two doc-adoption callers, never in
  // ptNoteLiveRow; the baseline adopts the live row when a caller is live.
  const note = app.slice(app.indexOf('function ptNoteLiveRow('), app.indexOf('// Hold-release fallback (owner 9/3)'));
  assert.doesNotMatch(note, /ptSeekToRow|ptStartPlay|ptGlideToOffset/);
  assert.match(note, /ptRenderNextChip\(\);/);
  const fallback = app.slice(app.indexOf('function ptArmHoldReleaseFallback('), app.indexOf('function ptCallerIsLiveOnDoc('));
  assert.match(fallback, /ptAutoHeldRow == null \|\| ptPlaying \|\| !\(ptAutoHeldRow <= n\)\) return;/);
  assert.match(fallback, /steadyTimeout\(\(\) => \{/);
  assert.match(fallback, /if \(ptAutoHeldRow !== held \|\| ptPlaying\) return;\n    ptSeekToRow\(n, \{ advance:true \}\);\n  \}, 600\);/);
  assert.match(app, /Math\.abs\(Date\.now\(\) - ts\) < 60000/);
  assert.equal((app.match(/if \(ptCallerIsLiveOnDoc\((?:d|data)\)\) ptNoteLiveRow\(rowDisplayNumber\(liveIdx(?:Doc)?, listDoc\)\);/g) || []).length, 2);
  assert.equal((app.match(/ptArmHoldReleaseFallback\(newRow\);/g) || []).length, 2);
  // ptReadY is the one read-line number: stage center, innerHeight fallback.
  assert.match(app, /function ptReadY\(\) \{\n  const stage = ptEl\('pt-stage'\);/);
  assert.match(app, /return r\.top \+ r\.height \/ 2;/);
  assert.equal((app.match(/window\.innerHeight \/ 2 \+ 24/g) || []).length, 1);
  assert.ok((app.match(/const readY = ptReadY\(\);/g) || []).length >= 7);
  // NEXT chip + HOLDING naming: markup inside #pt-stage, renderer hides while
  // holding or without a live row, names come from the [N] headers.
  assert.match(html, /<div id="pt-next-chip" hidden><span class="pt-chip-label">Next<\/span><span class="pt-chip-row"><\/span><\/div>/);
  assert.match(html, /<div id="pt-hold-chip" hidden><span class="pt-chip-label">Holding<\/span><span class="pt-chip-row"><\/span><\/div>/);
  assert.match(app, /function ptNextHeader\(\)/);
  assert.match(app, /function ptRowNameFromHeader\(el\)/);
  const nextChip = app.slice(app.indexOf('function ptRenderNextChip('), app.indexOf('function ptStartPlay('));
  assert.match(nextChip, /const next = \(Number\.isFinite\(ptLiveRowNum\) && ptAutoHeldRow == null\) \? ptNextHeader\(\) : null;/);
  assert.match(nextChip, /ptRowNameFromHeader\(next\.el\) \|\| `Row \$\{next\.row\}`/);
  const holdChip = app.slice(app.indexOf('function ptRenderHoldChip('), app.indexOf('function ptRenderNextChip('));
  assert.match(holdChip, /name \|\| `Row \$\{ptAutoHeldRow\}`/);
  assert.match(holdChip, /ptRenderNextChip\(\);/);
  assert.doesNotMatch(holdChip, /HOLDING · ROW/);
  const recalc = app.slice(app.indexOf('function ptRecalcRowHolds('), app.indexOf('function ptRenderHoldChip('));
  assert.match(recalc, /ptSeenRowHolds = seen;\n  ptRenderNextChip\(\);/);
  assert.match(app, /ptAheadOfLive = false;      \/\/ holding at the boundary IS in step with the rundown/);
  // Talent truth on the wire: heartbeat + ack carry rowNum/ahead; the
  // operator adopts them everywhere a heartbeat lands and prefers them.
  assert.match(app, /rowNum:ptCurrentRowNum\(\), ahead:!!ptAheadOfLive,/);
  assert.match(app, /rowNum: ptCurrentRowNum\(\),\n    ahead: !!ptAheadOfLive,/);
  assert.match(app, /function _adoptTalentRowTruth\(state=\{\}\)/);
  assert.match(app, /_adoptTalentRowTruth\(msg\.state \|\| \{\}\);   \/\/ display truth too/);
  assert.match(app, /const row = entry\.heldAtRow \|\| entry\.rowNum \|\| _talentRowAtPct\(entry\.pct\);/);
  assert.match(app, /if \(Number\.isFinite\(_talentRowNum\) && _talentRowNum >= 1\) return _talentRowNum;/);
  assert.match(app, /talent: _sdSafe\(\(\) => _sdTalentRowInfo\(\), null\)/);
  assert.match(app, /return \{ number, title: b \? \(_sdBeatName\(b\) \|\| b\.info \|\| ''\) : '', ahead: !!_talentAhead, holding \};/);
  // Executor gate on lifecycle, not the #liveshow class (KeyWi's screen swap
  // only toggles classes); publishing into a void is a refusal.
  assert.match(app, /function liveRuntimeOn\(\) \{\n  try \{ return liveSessionState\(\)\.lifecycle === 'live'; \}/);
  const bus = app.slice(app.indexOf('function runControlBusAction('), app.indexOf('function fireOutrangutanAutoForBeat('));
  assert.doesNotMatch(bus, /liveshow'\)\?\.classList\.contains\('on'\)/);
  assert.match(bus, /function runControlBusAction\(target, action, source='bus'\) \{\n  if \(!liveRuntimeOn\(\)\) return false;/);
  assert.match(bus, /if \(_busPublishWouldBlackHole\(\)\) return false;\n  _busCmdSeq \+= 1;/);
  // C8 + G3: an own claim is a void whenever this window cannot execute
  // (fresh or stale); a grant holder still on Build with no fresh claim
  // elsewhere is a void too; the follower + stale-claim rule stays.
  assert.match(bus, /if \(liveRuntimeOn\(\) && isShowCaller\(\)\) return false;\n    if \(_busClaimIsMine\(\)\) return true;\n    if \(isShowCaller\(\)\) return _busClaimIsStale\(\);/);
  assert.doesNotMatch(bus, /if \(_busClaimIsMine\(\)\) return !liveRuntimeOn\(\) && !_busClaimIsStale\(\);/);
  assert.match(bus, /return !!_callerStateInputs\(\)\.grantHeldElsewhere && _busClaimIsStale\(\);/);
  assert.match(bus, /function _releaseOwnBusExecutorClaim\(\) \{\n  try \{\n    if \(_busClaimExempt\(\) \|\| !_busClaimIsMine\(\)\) return;\n    _busExecutorClaim = null;\n[^\n]*\{ busExecutor: null \}/);
  assert.match(app, /markResumeState\(\);\n  \/\/ Off Live[^\n]*\n[^\n]*\n  _releaseOwnBusExecutorClaim\(\);/);
  assert.match(app, /_heldControlGrantBefore = held;\n[^\n]*\n[^\n]*\n  try \{ if \(!isShowCaller\(\)\) _releaseOwnBusExecutorClaim\(\); \} catch \{\}/);
  assert.match(bus, /if \(!liveRuntimeOn\(\)\) return;\n  if \(!isShowCaller\(\)\) return;/);
  assert.match(bus, /if \(!liveRuntimeOn\(\) \|\| !isShowCaller\(\)\) return;/);
  const avail = app.slice(app.indexOf('busAvailable: () => {'), app.indexOf('prompterStrip: () => {'));
  assert.match(avail, /if \(liveRuntimeOn\(\) && isShowCaller\(\)\) return 'exec';/);
  assert.match(avail, /!_busPublishWouldBlackHole\(\)\) return 'publish';/);
  // Bridge: session.role, live.on / live.caller, runAction returns the result.
  assert.match(app, /role: _sdSafe\(\(\) => session\.role \|\| '', ''\)/);
  assert.match(app, /on: _sdSafe\(\(\) => liveRuntimeOn\(\), false\), caller: _sdSafe\(\(\) => isShowCaller\(\), false\),/);
  assert.match(app, /if \(a && typeof a\.run === 'function'\) return a\.run\(\); return undefined; \}/);
  // Script Op popout: seek_row carries the host's display number.
  assert.match(app, /currentRow:activeBeat \? \{ index:activeIdx, number:rowDisplayNumber\(activeIdx\)/);
  assert.match(scriptOp, /const activeNumber = rowNumber\(currentRow, activeIndex\);/);
  assert.match(scriptOp, /`seek_row_\$\{activeNumber\}`/);
  assert.doesNotMatch(scriptOp, /seek_row_\$\{activeIndex \+ 1\}/);
  // Copy: no dashes anywhere in the new talent copy.
  for (const slice of [browse, nextChip, holdChip]) assert.doesNotMatch(slice, /[–—]/);
});

test('talent scroll engine invariants: no jumps, no lurches, no unasked resets (9/4 slice A3)', () => {
  // 1. Crawl delta is clamped and the clock restarts on visibility resume.
  const loop = app.slice(app.indexOf('function ptScrollLoop(ts)'), app.indexOf('function ptElementAtReadLine'));
  assert.match(loop, /const delta = Math\.min\(ts - ptLastTime, 100\);/);
  assert.match(loop, /const step = \(ptLiveSpeed \/ 60\) \* \(delta \/ 16\.67\);/);
  assert.match(loop, /Math\.exp\(-delta \/ 270\)/);
  assert.match(loop, /document\.addEventListener\('visibilitychange', \(\) => \{\n  if \(document\.visibilityState === 'visible'\) ptLastTime = null;/);
  assert.doesNotMatch(loop, /\* 0\.06/);
  // 2. No unrequested transport from a doc seed (pinned by A1's wantRunning).
  assert.match(app, /const wantRunning = viaDoc \? false : Boolean\(state\.running\);/);
  // 3. Only the first source in a renderer with no protocol state resets to top;
  //    live pushes never reset.
  assert.equal((app.match(/if \(firstApply && !_lastAppliedPrompterSnapshotId\) ptSetScriptText\(text\);/g) || []).length, 1);
  const liveUpdate = app.slice(app.indexOf('function ptApplyCueolaLiveUpdate('), app.indexOf('const _ptLibraryLoads'));
  assert.doesNotMatch(liveUpdate, /ptResetScroll/);
  // 4. Every relayout is anchor-preserving and rebaselines holds: size changes
  //    hold the element under the read line by reference; script pushes restore
  //    synchronously and ALWAYS write the transform; viewport changes restore
  //    from the continuously kept anchor.
  const setSize = app.slice(app.indexOf('function ptSetSize(val)'), app.indexOf('function ptAdjustSize('));
  assert.match(setSize, /const anchor = next !== ptFontSize \? ptSizeAnchorCapture\(\) : null;/);
  assert.match(setSize, /text\.style\.transition = 'none'/);
  assert.match(setSize, /const delta = ptAnchorDelta\(anchor\);\n    if \(delta != null\) ptShiftScrollBy\(delta\);/);
  const shift = app.slice(app.indexOf('function ptShiftScrollBy(delta)'), app.indexOf('let ptLastAnchor'));
  assert.match(shift, /track\.style\.transform = `translateY\(-\$\{ptOffset\}px\)`;\n  ptUpdateProgress\(\);\n  ptRecalcRowHolds\(\);/);
  assert.match(shift, /if \(ptGlide\) \{ ptGlide\.from \+= delta;/);
  const update = app.slice(app.indexOf('function ptUpdateFromCueola('), app.indexOf('// Connection state for the talent setup/ready indicator.'));
  assert.match(update, /const anchor = track && prevHeight > 0 \? ptCaptureLineAnchor\(el\) : null;/);
  assert.match(update, /const delta = anchor \? ptAnchorScreenDelta\(el, anchor\) : null;/);
  assert.match(update, /ptShiftScrollBy\(delta\);/);
  assert.match(update, /    track\.style\.transform = `translateY\(-\$\{ptOffset\}px\)`;\n    ptUpdateProgress\(\);/);
  assert.doesNotMatch(update, /if \(!ptPlaying && !ptGlide\) track\.style\.transform/);
  assert.doesNotMatch(update, /requestAnimationFrame/);
  const viewport = app.slice(app.indexOf('function ptOnViewportChange()'), app.indexOf("window.addEventListener('resize', ptOnViewportChange)"));
  assert.match(viewport, /const delta = ptAnchorDelta\(anchor\);/);
  assert.match(viewport, /ptShiftScrollBy\(delta \+ crawl\);/);
  for (const ev of ["window.addEventListener('resize', ptOnViewportChange)", "window.addEventListener('orientationchange', ptOnViewportChange)", "document.addEventListener('fullscreenchange', ptOnViewportChange)", "document.addEventListener('webkitfullscreenchange', ptOnViewportChange)"]) assert.ok(app.includes(ev), ev);
  assert.match(app, /function ptUpdateProgress\(\) \{[\s\S]{0,400}ptNoteAnchor\(\);/);
  // Pause markers re-derive from geometry (never a cleared set) and the
  // crossing test survives a bounded leap.
  const recalc = app.slice(app.indexOf('function ptRecalcRowHolds('), app.indexOf('function ptRenderHoldChip('));
  assert.match(recalc, /ptRecalcPauseMarkers\(\);/);
  const markers = app.slice(app.indexOf('function ptRecalcPauseMarkers()'), app.indexOf('let _ptProgPaintAt'));
  assert.match(markers, /if \(cand\.el\.getBoundingClientRect\(\)\.top <= readY \+ 2\) seen\.add\(cand\.key\);/);
  assert.match(markers, /if \(rect\.top <= readY\) \{/);
  assert.doesNotMatch(markers, /rect\.bottom >= readY/);
  // 5. Speed eases while rolling; a paused talent starts at the set speed.
  const speed = app.slice(app.indexOf('function ptSetSpeed(val)'), app.indexOf('function ptAdjustSpeed('));
  assert.match(speed, /if \(!ptPlaying\) ptLiveSpeed = ptTargetSpeed;/);
  assert.doesNotMatch(speed, /\n  ptLiveSpeed = ptTargetSpeed;/);
  // 6. Per-frame work stays cached; progress paint stays throttled.
  const frameWork = app.slice(app.indexOf('function ptCheckAutoPauseMarkers()'), app.indexOf('function ptSyncPlayIcons('));
  assert.ok((frameWork.match(/ptLoopCache\(\)/g) || []).length >= 2);
  assert.doesNotMatch(frameWork, /innerText|querySelectorAll/);
  assert.match(frameWork, /ts - _ptProgPaintAt > 100/);
  // 8. Heartbeat and ack batching ride worker timers, and the heartbeat says
  //    when the window is hidden instead of reporting a running crawl.
  assert.match(app, /ptHeartbeatInterval = P\?\.createSteadyInterval\n      \? P\.createSteadyInterval\(ptTalentHeartbeat, PROMPTER_HEARTBEAT_MS\)/);
  assert.match(app, /_ptAckTimer = steadyTimeout\(\(\) => \{[\s\S]{0,700}\}, 300\);/);
  assert.match(app, /visibility:document\.visibilityState,\n    stalled:!!\(ptPlaying && document\.visibilityState === 'hidden'\),/);
  // 10. Scrub never pauses or glides.
  const scrub = app.slice(app.indexOf('function ptSeekToProgress(pct)'), app.indexOf('// ── Jog smoother'));
  assert.doesNotMatch(scrub, /ptStopPlay|ptGlideToOffset/);
  const jogBy = app.slice(app.indexOf('function ptJogBy(deltaPx)'), app.indexOf('// The live-row context feeding the hold-at-next-cue behavior'));
  assert.doesNotMatch(jogBy, /ptStopPlay|ptGlideToOffset/);
  // 11. Recovery is sync scope; the doc seed is honest without a talent mirror.
  assert.match(app, /scope = scope \|\| \(\(reason === 'ready' \|\| reason === 'initial-state' \|\| reason === 'connect'\) \? 'seed' : 'sync'\);/);
  assert.match(app, /docMessage\.positionPct = null;/);
  // 12. In-app forward is change-gated and only re-renders a live talent.
  assert.match(app, /if \(adopted && prompterText !== _lastForwardedPrompterText\) \{\n          _lastForwardedPrompterText = prompterText;\n          _postPrompterMessage\(getPrompterPayload\(false\)\);\n          if \(isFlowmingoTalentActive\(\)\) ptUpdateFromCueola\(prompterText\);/);
  // 13. Talent listener errors never slate: Reconnecting + worker-timed backoff.
  const link = app.slice(app.indexOf('async function ptLoadFromCueolaCode('), app.indexOf('function ptResetIdle()'));
  const fail = link.slice(link.indexOf('const fail = err =>'), link.indexOf('const load = () =>'));
  assert.doesNotMatch(fail, /ptShowTechSlate/);
  assert.match(fail, /ptSetCueolaStatus\(loadedOnce \? 'Reconnecting' : label, true\);/);
  assert.match(fail, /const waits = \[2000, 5000, 10000\];/);
  assert.match(fail, /retryTimer = steadyTimeout\(\(\) => \{/);
  assert.match(fail, /if \(myLoad !== _ptLoadGen \|\| !isFlowmingoTalentActive\(\)\) return;/);
  assert.match(link, /\}, fail\);\n    \} catch \(err\) \{\n      fail\(err\);/);
  assert.equal((link.match(/ptShowTechSlate\(\)/g) || []).length, 1);   // the not-found branch only
  // 14. Line pitch is measured, not assumed.
  const lines = app.slice(app.indexOf('function ptSeekByLines(lines)'), app.indexOf('// ── Jog smoother'));
  assert.doesNotMatch(lines, /\* 1\.55/);
  assert.match(lines, /function ptLinePitch\(\)/);
  assert.match(lines, /if \(cache\) cache\.pitch = pitch;/);
  assert.match(setSize, /_ptLoopCache\.pitch = 0/);
  // 15. The same script pushed again is a no-op on both talent feeds.
  assert.match(link, /if \(text !== ptLastCueolaScript\) \{/);
  assert.match(app, /if \(prompterText !== ptLastCueolaScript\) \{/);
  // Skipped from the lane-9 checklist: item 2's queue prime age gate (refuted:
  // accepts() already drops stale targeted transport), item 9's ptGetMaxScroll
  // --pt-bar-h read (still the 48 literal; readY itself is one helper, A2).
});

test('talent door: your shows, signed-out link path, stale script honesty, launcher link (9/4 slice A3)', () => {
  // Markup: rows above the code row on the Connect card and in the overlay,
  // the keep-this-script dismiss, Link a show first, the bar button renamed.
  assert.match(html, /<div class="pt-setup-yours" id="pt-setup-yours" hidden><\/div>\n      <div class="pt-setup-row">/);
  assert.match(html, /<button class="pt-setup-alt" id="pt-setup-keep" hidden onclick="ptKeepLocalScript\(\)">Keep this script/);
  assert.match(html, /<h2>Link a show<\/h2>\n      <div class="pt-cueola-yours" id="pt-cueola-yours" hidden><\/div>\n      <div class="pt-cueola-bar">/);
  assert.ok(html.indexOf('<h2>Link a show</h2>') < html.indexOf('<h2>Edit / Load Script</h2>'));
  assert.ok(html.indexOf('<h2>Edit / Load Script</h2>') < html.indexOf('id="pt-upload-file-btn"'));
  assert.match(html, /onclick="ptOpenEdit\(\)">Link a show<\/button>/);
  assert.doesNotMatch(html, />Load Session</);
  // Rows: sessionChoices + renderSessionChoiceRows, guarded (linked or in
  // flight, generation counter), resume row from the device's last link,
  // signed-out line + sign-in button; the pick fills the code and connects.
  const door = app.slice(app.indexOf('// ── Talent door: your shows (9/4 A3)'), app.indexOf('function ptSetupConnect()'));
  assert.match(door, /if \(ptDoorLinkBusy\(\)\) \{ paint\(''\); return; \}/);
  assert.match(door, /if \(gen !== ptOfferGen\) return;/);
  assert.match(door, /choices = await idApi\.sessionChoices\(\);/);
  assert.match(door, /idApi\.renderSessionChoiceRows\(choices, 'ptPickAssignedSession'\)/);
  assert.match(door, /Sign in on this device to see your shows/);
  assert.match(door, /onclick="ptOpenSignInForLink\(\)">Sign in</);
  assert.match(door, /localStorage\.getItem\('cueola_flowmingo_last_code'\)/);
  assert.match(door, /localStorage\.setItem\('cueola_flowmingo_last_code', code\);\n    localStorage\.setItem\('cueola_last_code', code\);/);
  assert.match(door, /function ptPickAssignedSession\(code\) \{[\s\S]{0,300}ptSetupConnect\(\);/);
  assert.match(door, /return !!ptLinkedCueolaCode \|\| ptConnState === 'connecting' \|\| ptConnState === 'connected';/);
  // Identity hooks: both listeners call the door, and a pending code links
  // the moment an identity appears.
  assert.match(door, /if \(ptPendingLinkCode && ptDoorSignedIn\(\) && !ptLinkedCueolaCode\) \{/);
  assert.equal((app.match(/if \(isFlowmingoTalentActive\(\)\) ptOnIdentityMaybeChanged\(\);/g) || []).length, 2);
  // Signed-out link path: stash, card status, overlay closed and fullscreen
  // exited BEFORE the sign-in opens (no requireProfileForCloud toast-and-portal).
  const link = app.slice(app.indexOf('async function ptLoadFromCueolaCode('), app.indexOf('function ptResetIdle()'));
  assert.match(link, /if \(!ptDoorSignedIn\(\)\) \{\n    ptPendingLinkCode = code;/);
  assert.match(link, /ss\.textContent = 'Sign in on this device to link ' \+ code \+ '\.';/);
  assert.match(link, /ptOpenSignInForLink\(\);\n    return;/);
  assert.doesNotMatch(link, /requireProfileForCloud/);
  assert.match(door, /function ptOpenSignInForLink\(\) \{\n  ptCloseEdit\(\);\n  ptExitFullscreenForDialog\(\);\n  try \{ window\.CueolaIdentity\?\.openSignIn\?\.\(\{ returnTo:'promptypus' \}\); \} catch \{\}/);
  assert.match(link, /ss\.textContent = 'Class key needed for ' \+ code \+ '\.';/);
  // Success: remember the code, tell the card, close the overlay at once.
  assert.match(link, /ptLinkedCueolaCode = code;\n        ptRememberLinkedCode\(code\);/);
  assert.match(link, /ss\.textContent = 'Linked to ' \+ code; ss\.className = 'pt-setup-status'; \}/);
  assert.doesNotMatch(link, /setTimeout\(ptCloseEdit, \d+\)/);
  assert.equal((link.match(/toast\([^\n]*\);\n            ptCloseEdit\(\);/g) || []).length, 2);
  // Stale saved script: restored copy is a placeholder (card stays up), the
  // unlinked-with-script pill warns, Keep this script dismisses.
  const restore = app.slice(app.indexOf('function ptLoadSavedOrDefault()'), app.indexOf('// Talent heartbeat: a state-bearing ping'));
  assert.match(restore, /ptSetScriptHTML\(saved\);\n    ptScriptRestored = true;\n    ptScriptIsPlaceholder = true;\n    ptUpdateReady\(\);\n    return;/);
  assert.match(app, /else if \(hasScript\)                    \{ state = 'warn';       text = 'Local script, not linked'; \}/);
  assert.doesNotMatch(app, /text = 'Script loaded'/);
  assert.match(app, /if \(keep\) keep\.hidden = !\(ptScriptIsPlaceholder && ptScriptRestored\);/);
  assert.match(app, /function ptKeepLocalScript\(\) \{\n  ptScriptIsPlaceholder = false;\n  ptScriptRestored = false;\n  ptUpdateReady\(\);/);
  // enterPrompter prefills the last code and lists the shows; the overlay
  // re-lists on open.
  const enter = app.slice(app.indexOf('function enterPrompter()'), app.indexOf('ptKeydownHandler = (e) =>'));
  assert.match(enter, /if \(setupCode && !setupCode\.value\) setupCode\.value = ptLastLinkedCode\(\);\n  ptOfferAssignedSessions\(\);/);
  assert.match(app, /if \(ov\) ov\.classList\.add\('open'\);\n  ptOfferAssignedSessions\(\);/);
  // Launcher: read-only talent link for another machine, Copy, sign-in note.
  assert.match(html, /<label class="field-lbl" for="ws-talent-link">Talent display on another machine<\/label>/);
  assert.match(html, /<input class="field-in" id="ws-talent-link" type="text" readonly value="https:\/\/cueola\.live\/flowmingo"/);
  assert.match(html, /onclick="wsCopyTalentLink\(\)">Copy<\/button>/);
  assert.match(html, /Sign in on that device first\./);
  assert.match(app, /return 'https:\/\/cueola\.live\/flowmingo' \+ \(code \? '\?code=' \+ encodeURIComponent\(code\) : ''\);/);
  assert.match(app, /await navigator\.clipboard\.writeText\(link\);/);
  assert.match(app, /if \(manual\) manual\.hidden = !\(sel && sel\.value === '__other'\);\n  wsRenderTalentLink\(\);/);
  // Copy: no dashes in the new door copy.
  for (const slice of [door, restore, enter]) assert.doesNotMatch(slice, /[–—]/);
});

test('talent overlays: honest size buckets, size survives wraps, stage-parented, held stills read HOLD (9/4 slice A3)', () => {
  // Five '|| 1' -> '?? 1': S (0) renders and steps; countdown/duration/wrap
  // carry the size forward instead of forcing it.
  const clockRender = app.slice(app.indexOf('function ptRenderClockOverlay()'), app.indexOf('function renderPromptOpClockPreview()'));
  assert.match(clockRender, /size-\$\{Math\.max\(0, Math\.min\(4, state\.size \?\? 1\)\)\}/);
  assert.match(clockRender, /let value = '--:--';/);
  assert.doesNotMatch(clockRender, /'[^'\n]*[–—][^'\n]*'/);   // no dash in any overlay string literal
  const reducer = app.slice(app.indexOf('function applyClockActionToState('), app.indexOf('function questionLaneKeydown('));
  assert.match(reducer, /update\(\{ size:Math\.min\(4, \(current\.size \?\? 1\) \+ 1\) \}\)/);
  assert.match(reducer, /update\(\{ size:Math\.max\(0, \(current\.size \?\? 1\) - 1\) \}\)/);
  assert.doesNotMatch(reducer, /size:current\.size \|\| 1/);
  assert.doesNotMatch(reducer, /size:2,/);
  assert.doesNotMatch(reducer, /current\.size \|\| 1/);
  assert.match(reducer, /if \(next\.size !== current\.size && isFlowmingoTalentActive\(\)\) ptPersistOverlaySize\(next\.size\);/);
  // Overlays are created inside #pt-stage (mirror flips them with the copy).
  const ensure = app.slice(app.indexOf('function ptEnsureOverlayEls()'), app.indexOf('function ptStoredOverlaySize()'));
  assert.match(ensure, /const host = ptEl\('pt-stage'\) \|\| screen;/);
  assert.equal((ensure.match(/host\.appendChild\((clock|question)\)/g) || []).length, 2);
  assert.doesNotMatch(ensure, /screen\.appendChild/);
  // Persistence and the seed: localStorage per device, display.overlaySize
  // in the snapshot, applied in the seed branch.
  assert.match(app, /localStorage\.getItem\('cueola_prompter_overlay_size'\)/);
  assert.match(app, /localStorage\.setItem\('cueola_prompter_overlay_size', String\(size\)\)/);
  assert.match(app, /overlaySize:Math\.max\(0, Math\.min\(4, Number\(ptClockState\?\.size \?\? 1\)\)\),/);
  assert.match(app, /if \(Number\.isFinite\(Number\(display\.overlaySize\)\)\) ptSetOverlaySize\(Number\(display\.overlaySize\)\);/);
  assert.match(app, /if \(storedOverlay != null\) ptSetOverlaySize\(storedOverlay, \{ persist:false \}\);/);
  // The gear hides the bar with the controls (opacity only).
  const panel = app.slice(app.indexOf('function ptTogglePanel()'), app.indexOf('const PT_FLOAT_CARDS'));
  assert.match(panel, /if \(bar\) bar\.classList\.toggle\('hidden', !ptPanelVisible\);/);
  // Playout HOLD consumer side: no countdown anchor without a clock, a held
  // still returns hold with no remaining (play and pause), the strip prints
  // HOLD / PAUSED · HOLD, the bridge passes hold. Old (remaining 0) and new
  // (remaining null + hold) Air packets both land as HOLD.
  assert.match(app, /_ogLiveEndAt = \(og\.live\.status === 'play' && Number\.isFinite\(og\.live\.remaining\)\n          && \(og\.live\.remaining > 0 \|\| Number\(og\.live\.dur\) > 0\)\)/);
  const nowCue = app.slice(app.indexOf('function _playoutNowCue()'), app.indexOf('function _playoutNowPad()'));
  assert.match(nowCue, /const held = live\.hold === true \|\| \(live\.type === 'image' && !\(durMs > 0\) && !loop\);/);
  assert.match(nowCue, /if \(held && \(live\.status === 'play' \|\| live\.status === 'pause'\)\) \{\n    return \{ kind: 'cue', name, status: live\.status, remainMs: null, hold: true, loop: false, frac: null \};/);
  assert.match(nowCue, /hold: phase !== 'pre' && !loop && !Number\.isFinite\(cp\.remainMs\)\n          && \(cp\.kind !== undefined \? cp\.kind : outrangutanState\.live\?\.type\) === 'image',/);
  const strip = app.slice(app.indexOf('function renderPlayoutStrip()'), app.indexOf('function outCountdownText('));
  assert.match(strip, /if \(now\.hold\) t = 'HOLD';\n  if \(now\.status === 'pause'\) t = t \? 'PAUSED · ' \+ t : 'PAUSED';/);
  assert.match(app, /hold: !!\(nowPlaying && nowPlaying\.hold\),/);
});

test('leaving Live is one sheet: consequences, optional toggles, Stay/Leave, outputs before snapshot (9/4 slice A4)', () => {
  // Sheet markup: ids kept for openDialog focus/inert, two plain verbs, the
  // generated list, the two optional toggles, an inline warning with Leave
  // anyway, and the controller-failure block that only recoverLiveToBuilder
  // answers. No stop/detach pair anywhere.
  const sheet = html.slice(html.indexOf('<div class="overlay" id="exitLiveOv"'), html.indexOf('PRE-LIVE CHECK'));
  assert.match(sheet, /id="exitLiveDialog" tabindex="-1"/);
  assert.match(sheet, /id="exitLiveTitle">Leave the live show\?</);
  assert.match(sheet, /id="exitLiveIntro">You can come back any time\. The rundown stays where it is\.</);
  assert.match(sheet, /<ul class="live-exit-list" id="exitLiveList"/);
  assert.match(sheet, /id="exitLiveClockToggle" onchange="renderLiveExitDecision\(\)"/);
  assert.match(sheet, /id="exitLivePlayoutToggle" onchange="renderLiveExitDecision\(\)"/);
  assert.match(sheet, /id="exitLiveStayBtn" type="button" onclick="cancelExitLive\(\)">Stay live</);
  assert.match(sheet, /id="exitLiveLeaveBtn" type="button" onclick="commitExitLive\(\)">Leave live</);
  assert.match(sheet, /id="exitLiveLeaveAnywayBtn" type="button" onclick="commitExitLive\(\{ force:true \}\)">Leave anyway</);
  assert.match(sheet, /id="exitLiveRecoverBtn" type="button" onclick="recoverLiveToBuilder\(\)"/);
  assert.doesNotMatch(sheet, /commitExitLive\('stop'\)|commitExitLive\('detach'\)|Stop outputs and return|Leave outputs open/);
  assert.doesNotMatch(sheet, /[–—]/);
  // Consequence lines cover clock, talent, playout on the Air, Script Op, students.
  assert.match(app, /label:'Show clock:', text:'keeps running for everyone\.'/);
  assert.match(app, /label:'Show clock:', text:'is not running\.'/);
  assert.match(app, /text:`pauses at \$\{fmtProductionClock\(\(clock\.elapsedSecs \|\| 0\) \* 1000\)\} for everyone\.`/);
  assert.match(app, /label:'Talent screen:', text:'holds on the current line\. The script stays up\.'/);
  assert.match(app, /label:'Talent screen:', text:'not connected\.'/);
  assert.match(app, /const where = playback\.remote \? 'Playout on the Air:' : 'Playout on this Mac:';/);
  assert.match(app, /text:`keeps playing \$\{cue\}\.`/);
  assert.match(app, /text:'nothing is playing\.'/);
  assert.match(app, /text:'not reporting\.', state:'warn'/);
  assert.match(app, /label:'Script Op window:', text:'closes\.'/);
  assert.match(app, /label:'Students:', text:'keep their Live screen\. Nobody is signed out\.'/);
  // Toggles only when there is something to decide.
  assert.match(app, /clockRow\.hidden = !\(outputs\.clock\?\.running && outputs\.clock\?\.canDrive\);/);
  assert.match(app, /playoutRow\.hidden = !\(outputs\.playback\?\.active && \(outputs\.playback\?\.reporting \|\| !outputs\.playback\?\.remote\)\);/);
  // commitExitLive: no disposition argument; outputs FIRST, then the
  // snapshot, then the clock choice (direct broadcast, caller-gated), then
  // commitLeave. Output warnings stay inline; only a controller throw
  // reaches the recovery block.
  const commit = app.slice(app.indexOf('async function commitExitLive(options={})'), app.indexOf('function cancelExitLive()'));
  const outputsAt = commit.indexOf('await applyLiveExitOutputs(transaction.outputs, choices)');
  const snapshotAt = commit.indexOf("await captureSessionSnapshot('live-exit', true)");
  const leaveAt = commit.indexOf('liveSessionController.commitLeave({');
  assert.ok(outputsAt > 0 && snapshotAt > outputsAt && leaveAt > snapshotAt, 'outputs, then snapshot, then commitLeave');
  assert.match(commit, /if \(!outputResult\.ok\) \{\n      presentLiveExitWarning\(/);
  assert.match(commit, /if \(choices\.pauseClock && liveClockRunning && canDriveShowClock\(\)\) \{[\s\S]*broadcastShowClock\(\);/);
  assert.match(commit, /toast\(liveClockRunning \? 'Left the live show\. Clock still running\.' : 'Left the live show\.', 4200\);/);
  assert.doesNotMatch(commit, /presentLiveExitRecovery\(failure/);
  assert.match(app, /function presentLiveExitWarning\(message\)/);
  assert.doesNotMatch(app, /async function commitExitLive\(disposition/);
  // Stay live: no toast.
  const cancel = app.slice(app.indexOf('function cancelExitLive()'), app.indexOf('async function recoverLiveToBuilder()'));
  assert.doesNotMatch(cancel, /toast\(/);
  // Talent hold: gated on reachability (connected OR degraded OR recent
  // heartbeat OR open same-device window), capped wait, warning on no ack.
  assert.match(app, /return status === 'connected' \|\| status === 'degraded' \|\| _prompterHasRecentTalent\(\) \|\| Boolean\(windowOpen\);/);
  assert.match(app, /const capMs = before\.windowOpen \? LIVE_EXIT_TALENT_ACK_LOCAL_MS : LIVE_EXIT_TALENT_ACK_REMOTE_MS;/);
  assert.match(app, /if \(!before\.reachable\) return \{ ok:true, acknowledged:false, before, paused:false, note:'Talent screen not connected\. The hold was sent anyway\.' \};/);
  // Playout: the Air is never touched unless the toggle asks; the stop rides
  // the wire path and waits on cmdAck; the local instance is only touched
  // when playout is local AND something is open or active.
  const playoutExit = app.slice(app.indexOf('async function applyOutrangutanLiveExit('), app.indexOf('async function applyLiveExitOutputs('));
  assert.match(playoutExit, /if \(!stopRequested\) return \{ ok:true, before:playback, skipped:'remote-keep' \};/);
  assert.match(playoutExit, /const sent = fireOutrangutanCommand\('stop', ''\);/);
  assert.match(playoutExit, /await waitForOutrangutanCmdAck\(origId, LIVE_EXIT_PLAYOUT_ACK_MS\)/);
  assert.match(playoutExit, /if \(!\(playback\.active \|\| playback\.open \|\| playback\.hasOpenOutputs \|\| playback\.hasActiveOutputs\)\) return \{ ok:true, before:playback, skipped:'local-idle' \};/);
  // The classify asks the Air's packet when playout is remote.
  const classify = app.slice(app.indexOf('function classifyOutrangutanLiveExit()'), app.indexOf('function classifyLiveExitOutputs()'));
  assert.match(classify, /const remote = playoutIsRemote\(\);/);
  assert.match(classify, /const reporting = remote \? remotePlayoutFresh\(outrangutanState\) : Boolean\(window\.Outrangutan\);/);
  // Stale talent mirrors are dropped when the same-device window is observed closed.
  const ticker = app.slice(app.indexOf('function ensureLiveLinkTicker()'), app.indexOf('function stopLiveLinkTicker()'));
  assert.match(ticker, /if \(ptPlaying && !_prompterHasRecentTalent\(\)\) _dropTalentTransportMirror\(\);/);
});

test('show clock survives leaving Live; Back on Live is the same sheet; refusals name the Live screen (9/4 slice A4)', () => {
  // 'live-clock' cleanup clears the local tick only; re-entry restarts from
  // the preserved anchor before the remote resume check.
  const enter = app.slice(app.indexOf('function enterLiveSessionScreen(liveState)'), app.indexOf('function showRundown()'));
  assert.match(enter, /registerCleanup\('live-clock', \(\) => \{\n    clearInterval\(timerInterval\); timerInterval = null;/);
  assert.doesNotMatch(enter, /registerCleanup\('live-clock', \(\) => stopTimer\(false\)\)/);
  const restartAt = enter.indexOf('if (liveClockRunning && !timerInterval && liveTimerStartMs) startTimer(liveTimerStartMs);');
  const resumeAt = enter.indexOf('resumeRemoteClockIfRunning();');
  assert.ok(restartAt > 0 && resumeAt > restartAt, 'anchor restart runs before resumeRemoteClockIfRunning');
  // The senderId echo guard stays (a previous session's clock must not resume).
  assert.match(app, /if \(_remoteClockState\.senderId === presenceId\) return;/);
  // Leaving the session clears the remote clock mirror and the grant.
  const leaveSession = app.slice(app.indexOf('function leaveSessionForFrontPage()'), app.indexOf('// UTILS'));
  assert.match(leaveSession, /_remoteClockState = null;/);
  assert.match(leaveSession, /sessionControlGrant = null;/);
  assert.match(leaveSession, /renderCallerBanner\(\)/);
  // popstate: Live screen -> re-push 'live' then the sheet (only from 'live');
  // output screens stay; the front-page confirm survives for the builder.
  const pop = app.slice(app.indexOf("window.addEventListener('popstate', () => {"), app.indexOf('async function cueolaEntryGateAllows('));
  assert.match(pop, /if \(document\.getElementById\('liveshow'\)\?\.classList\.contains\('on'\)\) \{\n    pushSessionHistoryState\('live'\);\n    if \(liveSessionState\(\)\.lifecycle === 'live'\) requestExitLive\(\);\n    return;\n  \}/);
  const liveBranch = pop.indexOf("pushSessionHistoryState('live')");
  const outputBranch = pop.indexOf("document.getElementById('promptypus')?.classList.contains('on')\n    ||");
  const confirmAt = pop.indexOf("confirm('Leave this session and return to the front page?')");
  assert.ok(liveBranch > 0 && outputBranch > liveBranch && confirmAt > outputBranch, 'live, then output screens, then the builder confirm');
  // Refusal copy by lifecycle: builder says what to do.
  const gate = app.slice(app.indexOf('function liveCommandDispatchAllowed(options={})'), app.indexOf('function releaseLiveCommandHolds()'));
  assert.match(gate, /else if \(liveSessionState\(\)\.lifecycle === 'builder'\) \{[\s\S]*toast\('Cueola is not on the Live screen\. Press GO LIVE first\.'\);/);
  assert.match(gate, /toast\('Live commands are paused\. The show screen is still settling\.'\);/);
  assert.match(app, /throw new Error\(liveSessionState\(\)\.lifecycle === 'builder'\n      \? 'Cueola is not on the Live screen\. Press GO LIVE first\.'\n      : 'Live controls are paused while Cueola changes mode\.'\);/);
});

test('pre-live grant from the Build screen: chip, banner, union roster, presence-gated demotion (9/4 slice A4)', () => {
  // One model feeds the Live badge and the Build chip; the chip carries the
  // badge's picker gate and opens the same picker.
  assert.match(app, /function showCallerBadgeModel\(\)/);
  assert.match(app, /canPick: Boolean\(adminSession && session\.code && !session\.isDemo && !session\.isExpert\),/);
  assert.match(app, /model\.chipText = 'CALLER: You';/);
  assert.match(app, /model\.chipText = `CALLER: \$\{model\.holderName\}`;/);
  assert.match(app, /model\.chipText = `CALLER: \$\{model\.holderName\} \(not connected\)`;/);
  assert.match(app, /const chip = document\.getElementById\('rdCallerBtn'\);/);
  assert.match(html, /<button id="rdCallerBtn" type="button" style="display:none" data-state="viewer" onclick="openControlGrantPicker\(\)"/);
  const toolbar = html.slice(html.indexOf('<div class="screen" id="rundown">'), html.indexOf('<div class="show-strip">'));
  assert.match(toolbar, /id="rdCallerBtn"/);
  assert.match(toolbar, /id="rdCallerBanner" role="status" hidden/);
  assert.match(toolbar, /<strong>You are calling the show\.<\/strong> GO advances the rundown for everyone\./);
  assert.match(toolbar, /class="rd-caller-banner-deck" hidden>Your Stream Deck works while you hold control\./);
  assert.match(toolbar, /rd-caller-banner-cta" type="button" onclick="confirmGoLive\(\)"/);
  assert.doesNotMatch(toolbar, /rd-caller-banner-cta"[^>]*onclick="goLive\(\)"/);
  const live = html.slice(html.indexOf('<div class="screen" id="liveshow">'), html.indexOf('<div class="follow-bar">'));
  assert.match(live, /id="lsCallerBanner" role="status" hidden/);
  // Re-render hooks: grant transition, admin UI, presence, enter and leave Live.
  assert.match(app, /renderShowCallerBadge\(\);\n  renderCallerBanner\(\);\n  notifyControlSurfaceState\(\);\n\}/);
  const adminUi = app.slice(app.indexOf('function updateAdminUI()'), app.indexOf('function openAdminLogin()'));
  assert.match(adminUi, /renderShowCallerBadge\(\); renderCallerBanner\(\);/);
  const presence = app.slice(app.indexOf('function renderPresence(map)'), app.indexOf('const active = getActivePresencePeople();'));
  assert.match(presence, /refreshCallerPresenceState\(\);/);
  const enter = app.slice(app.indexOf('function enterLiveSessionScreen(liveState)'), app.indexOf('function showRundown()'));
  assert.match(enter, /renderShowCallerBadge\(\);\n  renderCallerBanner\(\);/);
  const leave = app.slice(app.indexOf('function leaveLiveSessionScreen(liveState, context={})'), app.indexOf('function isFollowingSelf()'));
  assert.match(leave, /renderShowCallerBadge\(\); renderCallerBanner\(\);/);
  // Banner: CTA only off Live, deck note from grantedDecks, CALLER role tag restored on revoke.
  const banner = app.slice(app.indexOf('function renderCallerBanner()'), app.indexOf('function renderFollowChips()'));
  assert.match(banner, /cta\.style\.display = \(lifecycle === 'live' \|\| id === 'lsCallerBanner'\) \? 'none' : '';/);
  assert.match(banner, /window\.CueolaStreamDeck\.grantedDecks\(\)/);
  assert.match(banner, /tag\.textContent = 'CALLER';/);
  assert.match(banner, /tag\.textContent = session\.role === 'instructor' \? 'INST' : 'STU';/);
  // Picker roster: presence + participant records + role assignments, deduped
  // on the lowercased username, Director button by position, grant shape.
  assert.match(app, /const GRANT_SUGGESTED_POSITION_RE = \/director\|show caller\|technical director\|\\btd\\b\/i;/);
  const roster = app.slice(app.indexOf('function controlGrantRosterRows()'), app.indexOf('function openControlGrantPicker()'));
  assert.match(roster, /activePresenceEntries\(currentPresence\)\.forEach/);
  assert.match(roster, /sessionParticipantRecords : \[\]\)\.forEach/);
  assert.match(roster, /roster\.forEach\(r => \{\n    if \(r\?\.username\) add\(/);
  assert.match(roster, /const username = String\(entry\.username \|\| ''\)\.trim\(\)\.toLowerCase\(\);/);
  assert.match(app, /Give control to the \$\{esc\(director\.position\)\}: \$\{esc\(director\.name\)\}/);
  assert.match(app, /<span class="ls-grant-pos">not connected<\/span>/);
  assert.match(app, /grantedFrom: document\.getElementById\('liveshow'\)\?\.classList\.contains\('on'\) \? 'live' : 'build',\n    position: String\(position \|\| ''\),/);
  // grantHeldElsewhere requires the holder to be PRESENT (pure rule in the controller module).
  assert.match(app, /grantHeldElsewhere: grantHeldByPresentOther\(\),/);
  assert.match(app, /return window\.CueolaLiveSession\.resolveGrantHeldElsewhere\(\{/);
  assert.match(liveController, /function resolveGrantHeldElsewhere\(input\)/);
  // Tooltip at the locked-GO site names the Build chip.
  assert.match(app, /from the CALLER chip on the Build screen or the caller badge here/);
});

test('Go Live preflight: grouped by machine, every failing row carries a fix verb (9/3 lane 14)', () => {
  // Row model + fixed group order; all-green groups collapse to one header
  // line, disclosure state is kept per group across reruns.
  assert.match(app, /const PREFLIGHT_GROUPS = \[\n  \{ id: 'mac',\s+name: 'This Mac' \},\n  \{ id: 'talent',\s+name: 'Talent display' \},\n  \{ id: 'playout',\s+name: 'Playout Air' \},\n  \{ id: 'cloud',\s+name: 'Cloud' \},\n\];/);
  const render = app.slice(app.indexOf('function renderPreflightRows()'), app.indexOf('function setPreflightRow(key, patch)'));
  assert.match(render, /container\.innerHTML = PREFLIGHT_GROUPS\.map\(g => \{/);
  assert.match(render, /<button type="button" class="precheck-group" data-group="\$\{g\.id\}" data-state="\$\{worst\}" aria-expanded="\$\{open \? 'true' : 'false'\}"/);
  assert.match(render, /<div class="precheck-rows" id="precheckRows-\$\{g\.id\}"\$\{open \? '' : ' hidden'\}>/);
  assert.match(app, /function preflightGroupIsOpen\(id, worst\) \{\n  if \(typeof _preflightGroupOpen\[id\] === 'boolean'\) return _preflightGroupOpen\[id\];\n  return worst !== 'ok';/);
  assert.match(app, /return n \+ ' check' \+ \(n === 1 \? '' : 's'\) \+ ' passed';/);
  // The fix capsule renders next to the jump link and runs inside the click.
  const rowHtml = app.slice(app.indexOf('function preflightRowHtml(r)'), app.indexOf('function renderPreflightRows()'));
  assert.match(rowHtml, /<button type="button" class="precheck-fix" onclick="preflightFix\('\$\{esc\(r\.key\)/);
  assert.match(rowHtml, /\$\{jumpBtn\}\$\{fixBtn\}/);
  const fix = app.slice(app.indexOf('function preflightFix(key)'), app.indexOf('window.preflightFix = preflightFix;'));
  assert.match(fix, /if \(fix\.remote\) \{\n    sendFixRequest\(key, fix\.remote\.target, fix\.remote\.kind, fix\.remote\.extra \|\| \{\}\);/);
  assert.match(fix, /const out = fix\.run\(r, run\);/);
  // Go button: the run's own pending checks lock it as Checking; a fix in
  // flight keeps Continue Anyway live.
  assert.match(render, /const checking = _preflightRows\.some\(r => r\.state === 'pend' && !r\.fixId\);/);
  assert.match(render, /goBtn\.disabled = !_preflightReviewOnly && checking;/);
  assert.match(render, /checking \? 'Checking' : \(fails \|\| warns \|\| fixing \? 'Continue Anyway' : 'Go Live'\)/);
  // Every row seeded with a group; playout rows follow the machine that owns them.
  const seed = app.slice(app.indexOf('function runPreflight(reviewOnly)'), app.indexOf('async function runPreflightAsync('));
  assert.match(seed, /const playoutGroup = playoutRemote \? 'playout' : 'mac';/);
  assert.match(seed, /\{ key: 'Talent prompter', group: 'talent'/);
  assert.match(seed, /\{ key: 'Cloud sync', group: 'cloud'/);
  assert.match(seed, /key: 'Playout media', group: playoutGroup/);
  assert.match(seed, /key: 'Cloud round-trip', group: 'cloud'/);
  // Prompter position judges the TALENT's reported percent (the operator's own
  // hidden track always reads 0 on the build screen) and carries Cue to top.
  assert.match(seed, /const parkedPct = _talentMirrorFresh\(\) && Number\.isFinite\(_talentReportedPct\) \? Math\.round\(_talentReportedPct\) : null;/);
  assert.match(seed, /fix: \{ label: 'Cue to top', run: _cueTalentToTopFix \}/);
  assert.doesNotMatch(seed, /Press T \(top\)/);
  // Verbs by row.
  for (const verb of ['Re-send script', 'Open talent display', 'Nudge talent', 'Reload talent display', 'Reopen talent display', 'Join a show', 'Reconnect', 'Retry',
    'Ask the Air to check in', 'Open output on the Air', 'Run the Air media check', 'Republish cue list', 'Sync media on the Air', 'Reopen output', 'Arm again',
    'Connect deck here', 'Connect OBS', 'Show how']) {
    assert.match(app, new RegExp("label: '" + verb.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + "'"), 'missing fix verb ' + verb);
  }
  // Talent nudge: local hello plus the fixRequests hello, never the snapshot path.
  const talentFix = app.slice(app.indexOf('function _talentRowFix()'), app.indexOf('function _cloudSyncRowFix()'));
  assert.match(talentFix, /_postPrompterHello\(\);\n    if \(fixSessionRef\(\)\) \{ sendFixRequest\(r\.key, 'talent', 'hello', _talentFixAddress\(\)\); return; \}/);
  assert.doesNotMatch(talentFix, /sendToPrompter\(/);
  // Remote playout rows read the Air's kiosk truth; dashes are scrubbed.
  const asyncRun = app.slice(app.indexOf('async function runPreflightAsync('), app.indexOf('function obsSystemStatus()'));
  assert.match(asyncRun, /fix: \{ label: 'Ask the Air to check in', remote: \{ target: 'playout', kind: 'rejoin' \} \}/);
  assert.match(asyncRun, /if \(Number\(out\?\.kioskMediaMissing \|\| 0\) > 0\) \{\n\s+extra\.push\(\{ key: 'Kiosk media', group: 'playout', state: 'fail'/);
  assert.match(asyncRun, /if \(out\?\.helper\?\.wanted && !out\.helper\.connected\) \{\n\s+extra\.push\(\{ key: 'Kiosk helper', group: 'playout', state: 'warn'/);
  assert.match(asyncRun, /fix: \{ label: 'Run the Air media check', remote: \{ target: 'playout', kind: 'preflight', extra: _airFixAddress\(\) \} \}/);
  assert.match(app, /function preflightCleanDetail\(s\) \{ return String\(s \|\| ''\)\.replace\(\/\\s\*\[—–\]\\s\*\/g, ', '\); \}/);
  assert.match(app, /if \(og\.preflight && typeof og\.preflight === 'object'\) outrangutanState\.preflight = og\.preflight;/);
  assert.match(app, /if \(rep && rep\.fixId === id\) \{ _applyRemoteMediaReport\(rep\); return true; \}/);
  // The Ready Before Show modal stays its own moment (owner decision pending).
  assert.match(app, /function maybeShowReadyBeforeShowPrompt\(proceed\)/);
  assert.match(app, /function confirmedGoLive\(\) \{\n  hideOverlay\('goLiveCheckOv'\);\n  if \(_preflightReviewOnly\) return;\n  maybeShowReadyBeforeShowPrompt\(goLive\);/);
});

test('fixRequests lane: field-path sender, evidence-gated consumer, talent receiver guards (9/3 lane 14)', () => {
  // Sender: identifier-safe id, one field-path write per request, never a map set.
  assert.match(app, /function sendFixRequest\(rowKey, target, kind, extra = \{\}\)/);
  assert.match(app, /return \('fx_' \+ CLIENT_ID \+ '_' \+ Date\.now\(\)\.toString\(36\) \+ '_' \+ _fixSeq\)\.replace\(\/\[\^A-Za-z0-9_\]\/g, '_'\);/);
  assert.match(app, /const req = \{ id, target, kind, detail: String\(row\?\.detail \|\| ''\)\.slice\(0, 240\), ts: Date\.now\(\), by: session\.userName \|\| '', byClient: CLIENT_ID, status: 'open', \.\.\.extra \};/);
  assert.match(app, /window\._updateDoc\(ref, \{ \['fixRequests\.' \+ id\]: req \}\)/);
  assert.doesNotMatch(app, /\{ fixRequests: \{/);
  assert.match(app, /const FIX_NO_ANSWER_MS = 20000;/);
  assert.match(app, /const FIX_CLEANUP_MS = 60000;/);
  assert.match(app, /const FIX_MAX_OPEN = 8;/);
  assert.match(app, /if \(fixOpenCount\(\) >= FIX_MAX_OPEN\) \{ toast\(/);
  assert.match(app, /entry\.timer = steadyTimeout\(\(\) => _fixNoAnswer\(id\), FIX_NO_ANSWER_MS\);/);
  assert.match(app, /r\.detail = 'No answer from ' \+ fixTargetLabel\(f\.target\) \+ '\. It may be closed, signed out, or on another code';/);
  assert.match(app, /window\._updateDoc\(ref, \{ \['fixRequests\.' \+ id\]: window\._deleteField\(\) \}\)/);
  // Consumer: ack shows progress, failed shows the result, done rechecks from
  // evidence; a late answer for a previous run is ignored.
  const consumer = app.slice(app.indexOf('function applyFixRequestUpdates(map)'), app.indexOf('function recheckPreflightRow(key, f, id)'));
  assert.match(consumer, /r\.detail = 'Received on the ' \+ fixTargetShort\(f\.target\) \+ ', working';/);
  assert.match(consumer, /if \(f\.run !== _preflightRun\) return;   \/\/ late answer for a previous run: ignore/);
  assert.match(consumer, /recheckPreflightRow\(r\.key, f, id\);/);
  const recheck = app.slice(app.indexOf('function recheckPreflightRow(key, f, id)'), app.indexOf('function _preflightNoteTalentSighting()'));
  assert.match(recheck, /const seenTs = _latestTalentSightingTs\(\);\n\s+const answered = seenTs > f\.ts;/);
  assert.match(recheck, /const fresh = remotePlayoutFresh\(outrangutanState\);/);
  assert.match(recheck, /const missing = Number\(out\?\.kioskMediaMissing \|\| 0\);/);
  // Wired into the session snapshot next to controlBus, and the heartbeat
  // sighting settles talent rechecks.
  assert.match(app, /_lastBusSnapshotAt = Date\.now\(\);\n[\s\S]{0,400}if \(d\.fixRequests && typeof d\.fixRequests === 'object'\) \{\n\s+try \{ applyFixRequestUpdates\(d\.fixRequests\); \}/);
  assert.match(app, /_recordTalentSighting\(_hb\.sender\);[^\n]*\n\s+_handlePrompterOperatorMessage\(\{ type:'PROMPTER_HEARTBEAT', \.\.\._hb \}\);\n\s+_preflightNoteTalentSighting\(\);/);
  // Talent addressing: the endpoint seen last, so a second door never answers.
  assert.match(app, /function _talentFixAddress\(\) \{\n  const sender = _latestTalentSightingSender\(\);\n  return sender \? \{ toEndpoint: sender \} : \{\};/);
  // Talent receiver inside ptLoadFromCueolaCode's snapshot: toEndpoint guard,
  // ack before run, reload marks done behind a sessionStorage guard, and the
  // seen set is seeded from sessionStorage at boot (no reload loop).
  const talentLoad = app.slice(app.indexOf('async function ptLoadFromCueolaCode('), app.indexOf('let _ptLoadGen = 0;'));
  assert.match(talentLoad, /ptHandleFixRequests\(code, data\.fixRequests\);/);
  const receiver = app.slice(app.indexOf('function ptHandleFixRequests(code, map)'), app.indexOf('function ptResetIdle()'));
  assert.match(receiver, /if \(r\.toEndpoint && r\.toEndpoint !== FLOWMINGO_ENDPOINT_ID\) return;/);
  assert.match(receiver, /_ptFixSeen\.add\(id\);\n\s+ptFixPatch\(code, id, \{ status:'ack', ackTs:Date\.now\(\), ackBy:FLOWMINGO_ENDPOINT_ID \}\);/);
  assert.match(receiver, /case 'hello':\n\s+ptPostPing\('ready'\);\n\s+ptUpdateSyncLabel\(\);\n\s+ptTalentHeartbeat\(\);/);
  assert.match(receiver, /case 'top':\n\s+ptResetScroll\(\);/);
  assert.match(receiver, /sessionStorage\.setItem\('cueola_fix_done_' \+ r\.id, '1'\)/);
  assert.match(receiver, /ptFixPatch\(code, id, \{ status:'done', doneTs:Date\.now\(\), result:'reloading' \}\)\.finally\(\(\) => \{ try \{ location\.reload\(\); \} catch \{\} \}\);/);
  assert.match(app, /if \(k && k\.startsWith\('cueola_fix_done_'\)\) _ptFixSeen\.add\(k\.slice\('cueola_fix_done_'\.length\)\);/);
  assert.match(app, /p\['fixRequests\.' \+ id \+ '\.' \+ k\] = patch\[k\];/);
  // KeyWi target: only the /keywibird window answers, via connectGranted when
  // KeyWi exports it; otherwise it reports that a click is needed there.
  const keywi = app.slice(app.indexOf('function handleKeywiFixRequests(map)'), app.indexOf('function confirmGoLive()'));
  assert.match(keywi, /if \(cueolaAppPath\(\) !== 'keywibird'\) return;/);
  assert.match(keywi, /if \(!sd \|\| typeof sd\.connectGranted !== 'function'\) \{/);
  // The Air's receiver ships alongside: same kinds, same field.
  assert.match(playbackJs, /const fx = d && d\.fixRequests; if \(fx && typeof fx === 'object'\) handleFixRequests\(fx\);/);
  assert.match(playbackJs, /case 'arm': case 'armPlayback':/);
});

test('9/4 review round, slice A1: rebind evidence, boot prime, direction intent, talent holds, viewport anchor, playout truth', () => {
  // C1: clause (b) needs the echo AND the pinned entry's senderClient (or no live entry).
  const rebind = app.slice(app.indexOf('function _shouldRebindToTalent('), app.indexOf('function _dropTalentTransportMirror('));
  assert.match(rebind, /\['degraded', 'lost'\]\.includes\(link\?\.status\)\) return 'silent';/);
  assert.match(rebind, /const pinned = _talentRegistryEntry\(_activePrompterOutputInstanceId\);\n  if \(!pinned\) return 'echo';/);
  assert.match(rebind, /return client && client === pinned\.senderClient \? 'echo' : '';/);
  // C3: echo = repoint + markStateApplied + (runtime) adopt/flush, zero doc writes;
  // silent = re-seed only from the Live runtime, 10s rate limit; log runtime-gated.
  const handler = app.slice(app.indexOf('function _handlePrompterOperatorMessage('), app.indexOf('function _ensurePrompterOperatorBridge('));
  const foreign = handler.slice(handler.indexOf('const evidence = _shouldRebindToTalent(msg);'), handler.indexOf('if (!_activePrompterOutputInstanceId) {'));
  assert.match(foreign, /if \(_prompterOperatorRuntimeActive\) logShow\('prompter', \x60Talent output replaced/);
  assert.match(foreign, /if \(evidence === 'echo'\) \{[\s\S]*?const applied = !!msg\.snapshotId && prompterSessionController\.markStateApplied\(outputId, msg\.snapshotId, msg\.state\);\n        if \(applied && _prompterOperatorRuntimeActive\) \{\n          adoptPrompterTalentState\(msg\.state \|\| \{\}\);\n          flushPrompterCommandQueue\(outputId\);\n        \}\n        return;/);
  assert.equal((foreign.match(/sendPrompterStateSnapshot\(/g) || []).length, 1);
  assert.match(foreign, /if \(_prompterOperatorRuntimeActive && Date\.now\(\) - _lastPrompterRebindSnapshotTs >= 10000\) \{\n        _lastPrompterRebindSnapshotTs = Date\.now\(\);\n        sendPrompterStateSnapshot\(outputId, 'recovery'\);/);
  assert.match(app, /let _lastPrompterRebindSnapshotTs = 0;/);
  // C2: the boot prime is a positive filter (collaborative, never a scrub).
  const queue = app.slice(app.indexOf('function unseenPrompterQueueControls'), app.indexOf('function applyRemoteControlOnce'));
  assert.match(queue, /const action = String\(newest\?\.action \|\| ''\);/);
  assert.doesNotMatch(queue, /Date\.now\(\)/);
  // C4: change-driven admission with a 60s skew-tolerant first sight; applied
  // receipts need a change (no clock); the Flowmingo Op reader follows suit;
  // both dedup stamps reset with the runtime.
  assert.match(app, /_hb\.ts !== _lastSeenTalentHeartbeatTs\n          && \(_lastSeenTalentHeartbeatTs !== 0 \|\| Math\.abs\(Date\.now\(\) - _hb\.ts\) < 60000\)\) \{/);
  assert.match(app, /const firstSight = _lastSeenTalentAppliedTs === 0;\n        _lastSeenTalentAppliedTs = _ta\.ts;\n        if \(!firstSight\) _handlePrompterOperatorMessage\(\{ \.\.\._ta, type:'PROMPTER_STATE_APPLIED' \}\);/);
  assert.doesNotMatch(app, /\(Date\.now\(\) - _ta\.ts\) < 20000/);
  assert.doesNotMatch(app, /\(Date\.now\(\) - _hb\.ts\) < 20000/);
  assert.doesNotMatch(app, /\(Date\.now\(\) - heartbeat\.ts\) < 20000/);
  assert.match(app, /hbTs !== _flowOpTalentHeartbeatTs\n            && \(_flowOpTalentHeartbeatTs !== 0 \|\| Math\.abs\(Date\.now\(\) - hbTs\) < 60000\)\) \{/);
  assert.match(app, /const talentOnline = hbFromTalent && !!_flowOpTalentSeenAt && \(Date\.now\(\) - _flowOpTalentSeenAt\) < 20000;/);
  const stop = app.slice(app.indexOf('function stopPrompterOperatorRuntime()'), app.indexOf('function updatePrompterOnAdvance('));
  assert.match(stop, /_lastSeenTalentHeartbeatTs = 0;\n  _lastSeenTalentAppliedTs = 0;/);
  // C5: intent keyed on direction at every caller; no bare { advance:true } literal.
  const advance = app.slice(app.indexOf('function updatePrompterOnAdvance('), app.indexOf('function cuePrompterToLiveRow('));
  assert.match(advance, /function updatePrompterOnAdvance\(prevBeat, newBeat, opts=\{\}\)/);
  const next = app.slice(app.indexOf('function lsNext('), app.indexOf('function rowLogLabel('));
  assert.match(next, /updatePrompterOnAdvance\(prev, beats\[lsIdx\], \{ advance: lsIdx > activeIdx \}\);/);
  const prev = app.slice(app.indexOf('function lsPrev('), app.indexOf('function resolveFollowedIdx('));
  assert.match(prev, /const fromIdx = liveActiveCueIndex\(\);\n  const ni = livePreviousPlayableCueIndex\(fromIdx\);/);
  assert.match(prev, /updatePrompterOnAdvance\(null, beats\[lsIdx\], \{ advance: lsIdx > fromIdx \}\);/);
  const jump = app.slice(app.indexOf('function jumpToLsCue('), app.indexOf('function lsNext('));
  assert.match(jump, /const fromIdx = liveActiveCueIndex\(\);[^\n]*\n  try \{ setOperatorLiveCue\(i, 'jump-cue'\); \}/);
  assert.match(jump, /updatePrompterOnAdvance\(null, beats\[i\], \{ advance: i > fromIdx \}\);/);
  const cue = app.slice(app.indexOf('function cuePrompterToLiveRow('), app.indexOf('let _lastTalentPosPct'));
  assert.match(cue, /Previous, a backward 'Cue here' and every explicit cue/);
  // C5 talent belt: an advance below the noted live row is explicit. C7: the
  // inside branch honors a superseded glide's pending resume.
  const seek = app.slice(app.indexOf('function ptSeekToRow(rowNum, payload=null)'), app.indexOf('function ptShowTechSlate'));
  assert.match(seek, /const backward = Number\.isFinite\(ptLiveRowNum\)\n    && \(n < ptLiveRowNum \|\| \(n === ptLiveRowNum && Number\.isFinite\(ptLiveRowPrev\) && n < ptLiveRowPrev\)\);/);
  assert.match(seek, /const advance = !!\(payload && payload\.advance === true\) && !backward;/);
  assert.match(seek, /const resume = !ptPlaying && \(ptAutoHeldRow != null \|\| ptPendingHoldResume\);\n        ptCancelGlide\(\);\n        ptPendingHoldResume = false;/);
  // C6: the seen-holds set rebuilds on every live-row CHANGE, without the
  // pause-marker re-baseline; ptRecalcRowHolds composes the two.
  const note = app.slice(app.indexOf('function ptNoteLiveRow('), app.indexOf('// Hold-release fallback (owner 9/3)'));
  assert.match(note, /if \(Number\.isFinite\(n\) && n >= 1 && n !== ptLiveRowNum\) \{\n    ptLiveRowPrev = ptLiveRowNum;\n    ptLiveRowNum = n;/);
  assert.match(note, /ptRecalcSeenRowHolds\(\);/);
  assert.doesNotMatch(note, /ptRecalcPauseMarkers|ptRecalcRowHolds\(\)/);
  const recalc = app.slice(app.indexOf('function ptRecalcRowHolds('), app.indexOf('function ptRenderHoldChip('));
  assert.match(recalc, /function ptRecalcRowHolds\(\) \{\n  ptRecalcSeenRowHolds\(\);\n  ptRecalcPauseMarkers\(\);\n\}/);
  assert.match(recalc, /function ptRecalcSeenRowHolds\(\) \{/);
  assert.match(app, /let ptLiveRowPrev = null;/);
  // C11: the restore uses the anchor VALUE snapshotted on the first event of
  // a burst, nulled on every exit path, with crawl-since-capture kept.
  const viewport = app.slice(app.indexOf('function ptOnViewportChange()'), app.indexOf("window.addEventListener('resize', ptOnViewportChange)"));
  assert.match(viewport, /if \(!_ptViewportTimer\) _ptViewportAnchor = ptLastAnchor;\n  clearTimeout\(_ptViewportTimer\);/);
  assert.match(viewport, /const anchor = _ptViewportAnchor;\n    _ptViewportAnchor = null;\n    if \(!isFlowmingoTalentActive\(\)\) return;/);
  assert.match(viewport, /const crawl = Number\.isFinite\(anchor\.offset\) \? ptOffset - anchor\.offset : 0;\n    ptShiftScrollBy\(delta \+ crawl\);/);
  assert.doesNotMatch(viewport, /ptAnchorDelta\(ptLastAnchor\)/);
  assert.match(app, /return \{ el, rel: el\.getBoundingClientRect\(\)\.top - readY, offset: ptOffset \};/);
  // C10: the linked code rides the URL (Flowmingo-routed); the reload verb
  // stashes a one-shot relink key the boot route honors and drops.
  const link = app.slice(app.indexOf('function ptWriteCodeIntoUrl('), app.indexOf('async function ptOfferAssignedSessions('));
  assert.match(link, /u\.searchParams\.set\('code', code\);\n    if \(!routed\) u\.searchParams\.set\('prompter', '1'\);/);
  assert.match(link, /history\.replaceState\(history\.state, '', u\);/);
  assert.match(app, /ptRememberLinkedCode\(code\);\n        ptWriteCodeIntoUrl\(code\);/);
  assert.match(app, /case 'reload': \{\n[^\n]*\n[^\n]*\n[^\n]*\n          try \{ sessionStorage\.setItem\('cueola_fix_relink', code\); \} catch \{\}/);
  assert.match(app, /const relink = String\(sessionStorage\.getItem\('cueola_fix_relink'\) \|\| ''\)\.trim\(\)\.toUpperCase\(\);\n        sessionStorage\.removeItem\('cueola_fix_relink'\);\n        if \(!code && relink\) code = relink;/);
  // C13: assigned rows come back after not-found and listener errors.
  const door = app.slice(app.indexOf('function ptLoadFromCueolaCode('), app.indexOf('function ptHandleFixRequests('));
  assert.match(door, /ptUpdateReady\(\);\n    ptOfferAssignedSessions\(\);   \/\/ the rows come back/);
  assert.match(door, /ptUpdateReady\(\);\n          ptOfferAssignedSessions\(\);   \/\/ a typo must not hide/);
  // C24: own-echo packets never refresh remote truth; remote freshness,
  // remoteAirDriving and fix addressing read the remote tracker; a hidden
  // local instance is never reattached from the Live screen.
  assert.match(app, /function _ogAdmitLivePacket\(live\)/);
  assert.match(app, /if \(og\.live && _ogAdmitLivePacket\(og\.live\)\) \{/);
  const fresh = app.slice(app.indexOf('function remotePlayoutFresh('), app.indexOf('function _ogRemoteSenderId('));
  assert.match(fresh, /if \(_ogRemoteLiveSeenAt\) return \(Date\.now\(\) - _ogRemoteLiveSeenAt\) < OG_REMOTE_FRESH_MS;\n  if \(_ogLiveSeenAt\) return false;/);
  assert.match(fresh, /if \(mine && sender === mine\) return false;/);
  const driving = app.slice(app.indexOf('function remoteAirDriving()'), app.indexOf('function syncOutrangutanControllerStatus('));
  assert.match(driving, /_ogRemoteLiveSeenAt && Date\.now\(\) - _ogRemoteLiveSeenAt < OG_REMOTE_FRESH_MS/);
  assert.match(driving, /const sender = _ogRemoteSender \|\| '';/);
  assert.doesNotMatch(driving, /outrangutanState\?\.live\?\.sender/);
  assert.match(app, /const sender = remotePlayoutFresh\(outrangutanState\) \? _ogRemoteSenderId\(\) : '';/);
  const enter = app.slice(app.indexOf('function enterLiveSessionScreen('), app.indexOf('function leaveLiveSessionScreen('));
  assert.match(enter, /if \(_ogLocalRuntimeReattachable\(\)\) \{\n      try \{\n        const playbackAttach = window\.Outrangutan\?\.reattachLiveControl\?\.\(\);\n        _ogLocalDetachedForReattach = false;/);
  assert.match(app, /if \(typeof og\?\.isOpen === 'function'\) return !!og\.isOpen\(\);/);
  assert.match(app, /if \(result && result\.ok !== false && result\.controller\?\.detached\) _ogLocalDetachedForReattach = true;/);
  assert.match(app, /if \(detached\?\.controller\?\.detached\) _ogLocalDetachedForReattach = true;/);
  // C31: no em dash in the playback-cue show-log line.
  assert.match(app, /is not in the loaded Outrangutan show\. Nothing fired\.\x60\)/);
  assert.doesNotMatch(app, /Outrangutan show — nothing fired/);
});

test('9/4 fix round slice A2: C9/G5 row numbers, C14 Esc = Stay live, C15/C16/C18 leave-live race guards, C17 fix-request counts, G2 follower exit, G4 remote first GO, G6 OBS reason, G7 admin door line', () => {
  // C9 + G5: every crew-facing row number is the display number (segments
  // never count): GO label, refusal toast, Recover chip, show-log lines.
  assert.match(app, /data-tip="Recover row \$\{rowDisplayNumber\(index\)\}" aria-label="Recover failed row \$\{rowDisplayNumber\(index\)\}"/);
  assert.match(app, /: failed \? \`Recover failed row \$\{rowDisplayNumber\(nextIndex\)\} before GO\`/);
  assert.match(app, /toast\(\`Recover failed row \$\{rowDisplayNumber\(ni\)\} before GO\.\`\);/);
  assert.match(app, /'Went live · row ' \+ rowDisplayNumber\(lsIdx\) \+ rowLogLabel/);
  assert.match(app, /'Advance → row ' \+ rowDisplayNumber\(lsIdx\) \+ rowLogLabel/);
  assert.match(app, /'Back → row ' \+ rowDisplayNumber\(lsIdx\) \+ rowLogLabel/);
  assert.match(app, /Playback call READY · row \$\{rowDisplayNumber\(rowIdx\)\}/);
  assert.match(app, /TAKE · row \$\{rowDisplayNumber\(call\.rowIdx\)\} \(\$\{source\}\)/);
  assert.match(app, /Playback call ABORTED · row \$\{rowDisplayNumber\(call\.rowIdx\)\}/);
  assert.doesNotMatch(app, /Recover (failed )?row \$\{(ni|index|nextIndex) \+ 1\}/);
  assert.doesNotMatch(app, /(Went live|Advance →|Back →) · row ' \+ \(lsIdx \+ 1\)/);
  assert.doesNotMatch(app, /(READY|TAKE|ABORTED) · row \$\{(call\.)?rowIdx \+ 1\}/);
  // C14: Escape on the leave-live sheet is Stay live, never a bare close;
  // the special case sits AFTER the data-esc-hold gate and the sheet has no
  // hold attribute, so it always runs.
  const esc = app.slice(app.indexOf("if (e.key !== 'Escape' || e.defaultPrevented) return;"), app.indexOf('uiDismissRegister(() => document.getElementById(\'entryThemePanel\')'));
  assert.match(esc, /if \(!top \|\| top\.hasAttribute\('data-esc-hold'\)\) return;\n  if \(top\.id === 'exitLiveOv'\) \{[\s\S]*?e\.preventDefault\(\);\n    if \(liveSessionState\(\)\.lifecycle === 'leaving-live'\) cancelExitLive\(\);\n    return;\n  \}/);
  assert.doesNotMatch(html, /id="exitLiveOv"[^>]*data-esc-hold/);
  // C15 + C16: one commit at a time, transaction identity checked at both
  // await boundaries before the warning branch, toggles locked while busy,
  // a re-render never re-enables Leave mid-flight, reopen resets the guard.
  const commit = app.slice(app.indexOf('async function commitExitLive(options={})'), app.indexOf('function cancelExitLive()'));
  assert.match(commit, /if \(_liveExitCommitting\) return liveSessionState\(\);/);
  assert.match(commit, /const commitToken = \+\+_liveExitCommitSeq;\n  _liveExitCommitting = commitToken;\n  try \{/);
  assert.match(commit, /const stale = \(\) => liveExitTransaction !== transaction \|\| liveSessionState\(\)\.lifecycle !== 'leaving-live';/);
  assert.match(commit, /transaction\.outputResult = outputResult;\n    if \(stale\(\)\) return liveSessionState\(\);[^\n]*\n    if \(!outputResult\.ok\) \{/);
  assert.match(commit, /await captureSessionSnapshot\('live-exit', true\);\n  if \(stale\(\)\) return liveSessionState\(\);/);
  assert.match(commit, /finally \{\n    if \(_liveExitCommitting === commitToken\) _liveExitCommitting = 0;\n  \}/);
  assert.match(app, /\['exitLiveLeaveBtn','exitLiveLeaveAnywayBtn','exitLiveClockToggle','exitLivePlayoutToggle'\]\.forEach\(id => \{\n    const button = document\.getElementById\(id\);\n    if \(button\) button\.disabled = Boolean\(busy\);/);
  assert.match(app, /function renderLiveExitDecision\(outputs\) \{\n[^\n]*\n[^\n]*\n  if \(_liveExitCommitting\) return;/);
  const request = app.slice(app.indexOf('function requestExitLive()'), app.indexOf('function waitForPrompterControlAck('));
  assert.match(request, /releaseLiveCommandHolds\(\);\n  _liveExitCommitting = 0;/);
  const cancel = app.slice(app.indexOf('function cancelExitLive()'), app.indexOf('async function recoverLiveToBuilder()'));
  assert.match(cancel, /liveExitTransaction = null;\n  _liveExitCommitting = 0;/);
  // C18: the playout note comes from the recorded result, not the checkbox.
  assert.match(commit, /const playoutResult = transaction\.outputResult\?\.values\?\.\[1\];/);
  assert.match(commit, /\(playoutResult\?\.stopped \|\| playoutResult\?\.acknowledged\) \? ' · playout stopped'/);
  assert.match(commit, /: playoutResult\?\.ok \? ' · stop sent to the Air'\n    : ' · playout stop NOT confirmed';/);
  assert.match(commit, /toast\('Left the live show\. The Air did not confirm the stop; check Outrangutan\.', 6000\);/);
  assert.doesNotMatch(commit, /choices\.stopPlayout \? ' · playout stopped'/);
  // C17: orphaned fix requests settle regardless of run, only the current
  // run counts toward FIX_MAX_OPEN, a rerun sweeps prior-run waits, and a
  // failed send schedules its own cleanup.
  assert.match(app, /return Object\.values\(_fixRequests\)\.filter\(f => f\.run === _preflightRun && \(f\.status === 'open' \|\| f\.status === 'ack'\)\)\.length;/);
  const noAnswer = app.slice(app.indexOf('function _fixNoAnswer(id)'), app.indexOf('function _fixScheduleCleanup(id)'));
  assert.match(noAnswer, /if \(!f\) return;\n[^\n]*\n[^\n]*\n  const current = f\.run === _preflightRun;\n  const r = current \? _fixRow\(id\) : null;/);
  assert.doesNotMatch(noAnswer, /f\.run !== _preflightRun\) return/);
  assert.match(noAnswer, /if \(current\) renderPreflightRows\(\);/);
  assert.match(noAnswer, /function _fixSweepPriorRuns\(\) \{[\s\S]*f\.status = f\.status === 'open' \? 'noanswer' : 'stalled';\n    _fixScheduleCleanup\(id\);/);
  assert.match(app, /const run = \+\+_preflightRun;\n  _fixSweepPriorRuns\(\);/);
  const sender = app.slice(app.indexOf('function sendFixRequest(rowKey, target, kind, extra = {})'), app.indexOf('window.sendFixRequest = sendFixRequest;'));
  assert.equal((sender.match(/_fixScheduleCleanup\(id\);/g) || []).length, 2);
  // G2: a follower's leave never holds the talent; the sheet names the caller.
  const classify = app.slice(app.indexOf('function classifyFlowmingoLiveExit()'), app.indexOf('function classifyOutrangutanLiveExit()'));
  assert.match(classify, /try \{ mine = isShowCaller\(\); \} catch \{ mine = true; \}/);
  assert.match(classify, /needsDisposition:active && reachable && mine,\n    notMine:!mine,\n    controlledBy,/);
  assert.match(app, /if \(before\.notMine\) return \{ ok:true, acknowledged:true, before, paused:false, skipped:'not-caller' \};\n  if \(!before\.active\)/);
  assert.match(app, /text:\`\$\{prompter\.active \? 'keeps running' : 'stays where it is'\}\. \$\{prompter\.controlledBy \|\| 'The show caller'\} controls it\.\`, state:'on'/);
  // G4: the remote Playout first GO row reads the Air's live.armed, fixes via
  // armPlayback addressed to the Air, and settles on the next packet.
  const asyncRun = app.slice(app.indexOf('async function runPreflightAsync('), app.indexOf('function obsSystemStatus()'));
  assert.match(asyncRun, /addPreflightRow\(\{ key: 'Playout first GO', group: 'playout', \.\.\._remoteFirstGoRow\(outrangutanState\.live\?\.armed\) \}\);/);
  const firstGo = app.slice(app.indexOf('function _remoteFirstGoRow(armed)'), app.indexOf('function _applyFirstGoArmed(armed)'));
  assert.match(firstGo, /const fix = \{ label: 'Arm on the Air', remote: \{ target: 'playout', kind: 'armPlayback', extra: _airFixAddress\(\) \} \};/);
  assert.match(firstGo, /if \(!armed \|\| typeof armed !== 'object'\) return \{ state: 'warn'/);
  assert.match(firstGo, /if \(armed\.armed && armed\.audio === 'running' && armed\.firstCueStaged !== false\) return \{ state: 'ok'/);
  assert.match(firstGo, /'Nobody has tapped the Air yet \(audio '/);
  assert.doesNotMatch(firstGo, /[–—]/);
  const recheck = app.slice(app.indexOf('function recheckPreflightRow(key, f, id)'), app.indexOf('function _preflightNoteTalentSighting()'));
  assert.match(recheck, /if \(kind === 'arm' \|\| kind === 'armPlayback'\) \{\n[^\n]*\n[^\n]*\n        const row = _remoteFirstGoRow\(outrangutanState\.live\?\.armed\);\n        if \(row\.state === 'ok'\) \{ Object\.assign\(r, row, \{ fixId: '' \}\); renderPreflightRows\(\); return true; \}\n        if \(!final\) return false;/);
  const packet = app.slice(app.indexOf('function _preflightNotePlayoutPacket()'), app.indexOf('function _talentFixAddress()'));
  assert.match(packet, /if \(firstGo && firstGo\.group === 'playout' && !firstGo\.fixId && firstGo\.state !== 'ok'\)/);
  assert.match(playbackJs, /armed: firstStaged && audio !== 'suspended'/);
  // G6: the OBS client's stop reason leads the warn row (dashes stripped).
  const obsStatus = app.slice(app.indexOf('function obsSystemStatus()'), app.indexOf('function talkbackSystemStatus()'));
  assert.match(obsStatus, /lastError = String\(obs\.lastError\?\.\(\) \|\| ''\)\.replace\(\/\\s\*\[\\u2014\\u2013\]\\s\*\/g, ', '\)\.trim\(\);/);
  assert.match(obsStatus, /if \(lastError\) return \{ state: 'warn', detail: lastError \};\n  return \{ state: 'warn', detail: 'OBS is set up but not connected/);
  // G7: an admin-password sign-in with no student identity gets a clear line.
  const offer = app.slice(app.indexOf('async function ptOfferAssignedSessions()'), app.indexOf('function ptPickAssignedSession(code)'));
  assert.match(offer, /else if \(adminSession && !idApi\?\.identity\?\.\(\)\) \{[\s\S]*Admin sign-in: type the show code below/);
  // No dashes in any copy this slice added.
  for (const slice of [commit, classify, firstGo, offer, noAnswer, esc]) assert.doesNotMatch(slice, /[–—]/);
});

for (const { name, run } of tests) {
  await run();
  console.log('PASS', name);
}
console.log(`PASS ${tests.length} Live UI contract tests`);
