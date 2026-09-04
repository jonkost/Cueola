// Contract pins for the 9/3 round, slice D (outrangutan/outrangutan.js):
// stills hold vs timer vs pre-wait, the fixRequests receiver, and the
// detached-exit answer. Regex pins against the source, same style as
// live-ui-contract.test.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const js = await readFile(new URL('../../outrangutan/outrangutan.js', import.meta.url), 'utf8');
const notes = await readFile(new URL('../../outrangutan/NOTES.md', import.meta.url), 'utf8');
const app = await readFile(new URL('../../cueola-app.js', import.meta.url), 'utf8');
const slice = (from, to) => { const a = js.indexOf(from); const b = js.indexOf(to, a); assert.ok(a >= 0 && b > a, from + ' .. ' + to); return js.slice(a, b); };

test('publishLive: a held still publishes remaining null + hold true, a timer publishes a number, and live.armed rides every packet', () => {
  const pub = slice('function publishLive(force)', 'function drawScopes');
  assert.match(pub, /const timed = active\.remainMs > 0 && !active\.held;/);
  assert.match(pub, /remaining: timed \? Math\.round\(left\) : null, hold: !timed/);
  assert.match(pub, /dur: Math\.round\(active\.cue\.duration \|\| 0\)/);
  assert.match(pub, /live\.armed = playoutArmed\(\)/);
});

test('renderClock: a held still reads HOLD in the big slot on a neutral face, elapsed in the meta slot, frozen while paused', () => {
  const clock = slice('function renderClock()', 'function formatWallClock');
  assert.match(clock, /timeEl\.textContent = 'HOLD';/);
  assert.match(clock, /timeEl\.style\.color = '#aeb6c4'/);
  assert.match(clock, /durEl\.textContent = 'UP ' \+ fmtClock\(heldFor\)/);
  assert.match(clock, /active\.paused && active\.pausedAt \? active\.pausedAt : performance\.now\(\)/);
  assert.match(clock, /if \(!active\.held && \(active\.remainMs > 0 \|\| c\.duration > 0\)\)/);
  const pause = slice('function pauseResume()', 'function fadeStopAll()');
  assert.match(pause, /active\.pausedAt = performance\.now\(\);/);
  assert.match(pause, /active\.shownAt \+= performance\.now\(\) - active\.pausedAt; active\.pausedAt = 0;/);
});

test('handleEnded: an expired still on manual continue parks, never cuts to black; timer arm and expiry are logged', () => {
  const ended = slice('function handleEnded(cue)', 'function cueToTop()');
  assert.match(ended, /if \(deck && cue\.type === 'image' && m === 'manual' && cue\.endAction === 'stop'\) \{ if \(active\) active\.held = true; setStatus\('idle'\); renderCueList\(\); return; \}/);
  assert.match(ended, /slog\('cue', 'Still timer ended: /);
  const begin = slice('async function beginImage(cue)', 'function armImageTimer()');
  assert.match(begin, /slog\('cue', 'Still timer armed: /);
  const fire = slice('function fireCue(cue)', 'async function beginMedia(cue)');
  assert.match(fire, /if \(cue\.type === 'image'\) slog\('cue', 'Pre-wait ' \+ cue\.preWait \+ 's before still/);
  // New stills default to hold on end; the Inspector no longer offers Cut for a still.
  assert.match(js, /endAction: o\.type === 'image' \? 'hold' : 'stop'/);
  const insp = slice('function renderInspector()', 'function field(label, inner)');
  assert.doesNotMatch(insp, /opt\('stop', 'Cut', c\.endAction\)/);
  assert.match(insp, /opt\('hold', 'Hold', c\.endAction === 'stop' \? 'hold' : c\.endAction\)/);
});

test('Inspector + cue list: live badges beside Pre-wait and Duration, PRE chip, one-time toast', () => {
  assert.match(js, /id="og-i-prewait-badge">' \+ stillBadge\(c, 'preWait'\)/);
  assert.match(js, /id="og-i-imgdur-badge">' \+ stillBadge\(c, 'duration'\)/);
  assert.match(js, /refreshStillBadge\(c, 'preWait'\)/);
  assert.match(js, /refreshStillBadge\(c, 'duration'\)/);
  const badge = slice('function stillBadge(c, which)', 'function opt(val, label, cur)');
  assert.match(badge, /return v > 0 \? 'auto: ' \+ v \+ 's' : 'HOLD';/);
  assert.match(badge, /return v > 0 \? 'pre-wait: ' \+ v \+ 's' : 'none';/);
  assert.match(badge, /_stillTimerToasted\.has\(key\)\) return;/);
  assert.match(badge, /' after ' \+ v \+ 's\. Set 0 to hold\.'/);
  const list = slice('function renderCueList()', 'let _dragCueId');
  assert.match(list, /PRE ' \+ fmtPre\(c\.preWait\)/);
  assert.match(list, /c\.duration > 0 \? fmtClock\(c\.duration\) : 'HOLD'/);
});

test('fixRequests receiver runs before the first-snapshot baseline and answers by id with field-path patches', () => {
  const doc = slice('function onSessionDoc(d)', 'const _cmdOrigSeen = [];');
  const fixAt = doc.indexOf('handleFixRequests(fx)');
  const primedAt = doc.indexOf('if (!sessionDocPrimed) {');
  assert.ok(fixAt >= 0 && primedAt > fixAt, 'fix requests are read before the baseline return');
  const lane = slice('const FIX_STALE_MS', 'function applyRemoteCommand(cmd)');
  assert.match(lane, /FIX_AUTORUN = \{ rejoin: 1, republish: 1, preflight: 1, syncMedia: 1 \}/);
  assert.match(lane, /r\.target !== 'playout' \|\| r\.status !== 'open'/);
  assert.match(lane, /\^\[A-Za-z0-9_\]\{1,120\}\$/);                      // identifier-safe ids only
  assert.match(lane, /p\['fixRequests\.' \+ id \+ '\.' \+ k\] = patch\[k\]/); // field-path patch, never a map set
  assert.match(lane, /fixPatch\(r\.id, \{ status: 'ack', ackTs: Date\.now\(\), ackBy: OG_SENDER \}\)/);
  assert.match(lane, /if \(r\.toEndpoint\) \{ if \(r\.toEndpoint !== OG_SENDER\) return; \}/);
  assert.match(lane, /else if \(!isOpen\(\)\) return;/);
  assert.match(lane, /case 'openOutput':/);
  assert.match(lane, /case 'arm': case 'armPlayback':/);
  assert.match(lane, /'outrangutan\.preflight': \{ ts: Date\.now\(\), sender: OG_SENDER, fixId: r\.id, cues: rep\.cues\.length, pads: rep\.pads\.length, bad, badPads \}/);
  assert.match(lane, /\.slice\(0, 50\)\.map/);
  assert.match(lane, /result = 'Kiosk helper offline on the Air'/);
  assert.match(lane, /fixPatch\(r\.id, \{ status: ok \? 'done' : 'failed', doneTs: Date\.now\(\), result \}\)/);
  assert.match(lane, /The director asks: ' \+ esc\(verb\)/);
  assert.match(lane, /class="og-bar-btn og-capsule og-fix-do">Do it</);
  assert.match(lane, /og-fix-dismiss">Dismiss</);
  assert.match(lane, /if \(doBtn\) doBtn\.onclick = \(\) => \{ if \(card\.dataset\.busy\) return; runFix\(r\); \}/);   // gesture kinds run inside the click
});

test('C23: a GO clears the outgoing still timer before the swap, and the timer closure fires only for the object that armed it', () => {
  const media = slice('async function beginMedia(cue)', 'async function beginImage(cue)');
  assert.match(media, /async function beginMedia\(cue\) \{\n\s*clearPrevImageTimer\(\);/);           // top of beginMedia, before the image dispatch
  const begin = slice('async function beginImage(cue)', 'function armImageTimer()');
  assert.match(begin, /clearPrevImageTimer\(\);\n\s*const prev = active;/);                       // and again once the still's media is in hand
  const arm = slice('function armImageTimer()', 'function clearPrevImageTimer()');
  assert.match(arm, /const self = active;/);
  assert.match(arm, /self\.imgTimer = setTimeout\(\(\) => \{ self\.imgTimer = null; if \(active === self && !self\.paused\) handleEnded\(self\.cue\); \}, self\.remainMs\);/);
  assert.doesNotMatch(arm, /if \(active && active\.kind === 'image'\) handleEnded\(active\.cue\)/);   // the cue-blind guard is gone
  assert.match(js, /function clearPrevImageTimer\(\) \{ const prev = active; if \(prev && prev\.imgTimer\) \{ clearTimeout\(prev\.imgTimer\); prev\.imgTimer = null; \} \}/);
});

test('C26: a Duration edit on a held (timer-done) still applies next play only and says so; a running or paused still still re-times', () => {
  const insp = slice("bind('og-i-imgdur', 'onchange'", "bind('og-i-fit', 'onchange'");
  assert.match(insp, /if \(active\.held\) \{/);
  assert.match(insp, /toast\('Duration applies the next time this still plays\. GO fires the next cue\.', 4000\);/);
  assert.match(insp, /\} else \{\n\s*active\.remainMs = c\.duration > 0 \? c\.duration \* 1000 : 0;\n\s*if \(active\.paused \|\| !\(active\.remainMs > 0\)\) clearImageTimer\(\); else armImageTimer\(\);/);
  assert.doesNotMatch(insp, /active\.held = false/);   // option A: never un-hold from the Inspector
  assert.doesNotMatch(insp, /[\u2014\u2013]/);
});

test('C12: cueProgress carries kind on every branch so the strip and deck can tell a held still from a rolling video with no length', () => {
  const cp = slice('function cueProgress()', 'function renderClock()');
  assert.match(cp, /cueId: preInfo\.cue\.id, kind: preInfo\.cue\.type \|\| null \}/);
  assert.match(cp, /if \(!active\) return \{ phase: 'idle', playing: false, frac: 0, remainMs: 0, cueId: null, kind: null \};/);
  assert.match(cp, /const cueId = active\.cue\.id, kind = active\.kind \|\| null;/);
  const returns = cp.match(/return \{ phase:[^\n]*\};/g) || [];
  assert.ok(returns.length >= 7, 'every branch returns a progress object: ' + returns.length);
  for (const r of returns) assert.match(r, /kind(: [^,}]+)? \}/, r);
});

test('C24: an addressed gesture request while the screen is not up acks then fails at once instead of parking a card nobody sees', () => {
  const lane = slice('function handleFixRequests(map)', 'async function runFix(r)');
  const ackAt = lane.indexOf("fixPatch(r.id, { status: 'ack'");
  const gateAt = lane.indexOf('if (!FIX_AUTORUN[kind] && !isOpen()) {');
  const cardAt = lane.indexOf('showFixCard(r);');
  assert.ok(ackAt >= 0 && gateAt > ackAt && cardAt > gateAt, 'ack, then the not-on-screen gate, then the card');
  assert.match(lane, /fixPatch\(r\.id, \{ status: 'failed', doneTs: Date\.now\(\), result: 'Outrangutan is not on screen on this Mac' \}\);\n\s*slog\([^\n]*\);\n\s*return;/);
  assert.match(lane, /if \(r\.toEndpoint\) \{ if \(r\.toEndpoint !== OG_SENDER\) return; \}\n\s*else if \(!isOpen\(\)\) return;/);   // unaddressed requests still need the screen
  assert.doesNotMatch(lane, /[\u2014\u2013]/);
});

test('applyLiveExit: a detached instance with nothing active and nothing open answers ok to stop; otherwise the error stays', () => {
  const exit = slice('async function applyLiveExit(disposition)', "if (disposition === 'detach') {\n      preserveOutputRuntimeForReattach();");
  assert.match(exit, /if \(!before\.active && !before\.open\) \{/);
  assert.match(exit, /ok: true, acknowledged: true, alreadyDetached: true,\s*local: \{ programStopped: true, sfxStopped: true, sfxVoicesStopped: 0 \}/);
  assert.match(exit, /base\.error = 'Live control is detached while something is still open here\. Reattach before requesting STOP\.'/);
});

test('no em or en dashes in operator-facing strings touched this round', () => {
  for (const line of [
    "kioskSync.error = 'Media sync failed. Is the helper still running?';",
    "' not cached, Sync media'",
    "Kiosk helper offline, kiosk outputs run on their own until it restarts",
    "node scripts/kiosk-helper.mjs, or turn off Kiosk to open a popup",
  ]) assert.ok(js.includes(line), line);
  const lane = slice('const FIX_STALE_MS', 'function applyRemoteCommand(cmd)');
  assert.doesNotMatch(lane, /[—–]/);
  const badge = slice('function stillBadge(c, which)', 'function opt(val, label, cur)');
  assert.doesNotMatch(badge, /[—–]/);
  assert.doesNotMatch(notes.slice(notes.indexOf('## Stills: hold vs timer vs pre-wait'), notes.indexOf('## Kiosk outputs')), /[—–]/);
});

test('NOTES.md documents stills and fix requests', () => {
  assert.match(notes, /## Stills: hold vs timer vs pre-wait/);
  assert.match(notes, /## Fix requests from the rundown/);
  assert.match(notes, /clearPrevImageTimer/);
  assert.match(notes, /Duration applies the next time this still plays/);
  assert.match(notes, /Outrangutan is not on screen on this Mac/);
  assert.match(notes, /cueProgress\(\)[^\n]*kind/);
});

test('output window: an orphaned renderer is reported, and a detached runtime never swallows a fire (9/4 night)', () => {
  // A renderer binds to the controllerInstanceId baked into its URL and
  // announces READY once, so reloading the controller page orphans it. The
  // controller now names that state instead of saying "Output window closed".
  assert.match(js, /const foreignOutputSeen = new Map\(\);/);
  assert.match(js, /function foreignOutputFresh\(id\)/);
  assert.match(js, /normalized\.controllerInstanceId !== OUTPUT_CONTROLLER_ID/);
  assert.match(js, /foreignOutputSeen\.set\(id, \{ at: Date\.now\(\), controllerInstanceId: normalized\.controllerInstanceId \}\)/);
  assert.match(js, /foreignOutputSeen\.delete\(id\)/);
  assert.match(js, /foreignWindow: \(!rec \|\| rec\.status === 'closed'\) && foreignOutputFresh\(o\.id\)/);
  assert.match(js, /An output window from an earlier page load is still open and cannot hear this page\. Close that window, then press Open\./);

  // Leaving Live detaches the local runtime and leaves the windows open, so
  // every same-tab fire reclaims first; sendOut would otherwise be a no-op.
  assert.ok(js.includes('reclaim: () => { try { return outputRuntimeDetached ? reattachLiveControl() : null; }'), 'reclaim only when detached');
  assert.match(js, /attached: \(\) => !outputRuntimeDetached,/);
  assert.ok(js.includes('if (p && p.mediaId) { if (outputRuntimeDetached) reattachLiveControl(); firePad(p);'), 'firePad reclaims when detached');
  assert.ok(js.includes('if (c) { if (outputRuntimeDetached) reattachLiveControl();'), 'fireCue reclaims when detached');

  // And the rundown refuses the same-tab fast path when it still cannot deliver.
  assert.ok(app.includes('function _ogLocalCanDeliver(local) {'), 'delivery predicate is module level');
  assert.ok(app.includes("!remoteAirDriving() && _ogLocalCanDeliver(local)"), 'cue fast path checks delivery');

  // Copy rule: no em or en dashes in the lines these fixes added.
  const added = js.split('\n').filter(line => /foreignOutputSeen|foreignWindow|earlier page load|reclaim: \(\)|attached: \(\)/.test(line));
  assert.ok(added.length > 0, 'expected the new lines to be present');
  added.forEach(line => assert.ok(!/[\u2014\u2013]/.test(line), 'no dashes: ' + line));
});

test('a joined playout machine survives a standalone tap, and every same-tab fast path checks delivery (9/4 night)', () => {
  // enterOutrangutan('standalone') used to null sessionCode, which changes the
  // output channel identity and makes ensureChannel close the live output
  // window. The hub tile, the Live rail recovery and the preflight fix all
  // pass 'standalone' when the rundown has no code, which is the Air's normal
  // state, so a joined show must survive it.
  assert.ok(js.includes("else if (mode === 'session' && sessionCode) { /* keep the joined show */ }"), 'joined show is kept');
  assert.ok(js.indexOf("else if (mode === 'session' && sessionCode)") < js.indexOf("else { mode = 'standalone'; sessionCode = null; }"), 'the guard precedes the reset');

  // The transport fast paths carry the same delivery guard as the cue path;
  // local.transport('go') otherwise returns true with no check at all.
  const guarded = app.split('\n').filter(line => line.includes('local.transport(action)') && line.includes('_ogLocalCanDeliver(local)'));
  assert.equal(guarded.length, 2, 'both transport fast paths are guarded');

  // Reclaim only in the states the reattach gate already trusts, so an idle
  // hidden instance on the rundown Mac never re-subscribes and publishes.
  assert.ok(app.includes('if (_ogLocalRuntimeReattachable()) local.reclaim?.();'), 'reclaim is gated');
});
