import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [app, css, html, worker, bump, contracts, identityJs, deck] = await Promise.all([
  readFile(new URL('../../outrangutan/outrangutan.js', import.meta.url), 'utf8'),
  readFile(new URL('../../outrangutan/outrangutan.css', import.meta.url), 'utf8'),
  readFile(new URL('../../index.html', import.meta.url), 'utf8'),
  readFile(new URL('../../sw.js', import.meta.url), 'utf8'),
  readFile(new URL('../bump-cache.mjs', import.meta.url), 'utf8'),
  readFile(new URL('../check-contracts.mjs', import.meta.url), 'utf8'),
  readFile(new URL('../../cueola-identity.js', import.meta.url), 'utf8'),
  readFile(new URL('../../cueola-streamdeck.js', import.meta.url), 'utf8'),
]);

// Named slice of cueola-streamdeck.js so each assertion tests the right function.
function deckSlice(from, to) {
  const start = deck.indexOf(from);
  const end = deck.indexOf(to, start + 1);
  if (start < 0 || end < 0) throw new Error('deck slice not found: ' + from + ' .. ' + to);
  return deck.slice(start, end);
}

const tests = [];
function test(name, run) { tests.push({ name, run }); }

test('the renderer is loaded before Outrangutan and managed by every no-build cache contract', () => {
  const rendererAt = html.indexOf('outrangutan/stream-deck-label.js?v=');
  const appAt = html.indexOf('outrangutan/outrangutan.js?v=');
  assert.ok(rendererAt >= 0 && rendererAt < appAt);
  for (const source of [worker, bump, contracts]) assert.match(source, /outrangutan\/stream-deck-label\.js/);
});

test('device orientation is explicit and dead flip metadata is gone', () => {
  assert.doesNotMatch(app, /\bflip\s*:/);
  assert.match(app, /imageProductId:\s*0x006d/);
  assert.match(app, /imageProductId:\s*0x0080/);
  assert.match(app, /imageProductId:\s*0x006c/);
  assert.match(app, /imageProductId:\s*null/);
});

test('HID delivery consumes renderer-owned bytes and packetization', () => {
  assert.match(app, /sdLabelRenderer\.renderAndPacketize\(target\.device\.productId, i,/);
  assert.match(app, /sendReport\(packet\.reportId, packet\.data\)/);
  assert.doesNotMatch(app, /const PKT = 1024/);
  assert.match(app, /Key ['"]? \+ \(i \+ 1\) \+ ['"]? label failed:/);
});

test('preview and proof use the canonical, upload, and simulated device frames without CSS cancellation', () => {
  assert.match(app, /const upload = sdLabelRenderer\.createDeviceFrame\(productId, canonical\.canvas\)/);
  assert.match(app, /const simulated = sdLabelRenderer\.createDeviceFrame\(productId, upload\.canvas\)/);
  assert.match(app, /SIMULATED PHYSICAL DISPLAY/);
  assert.match(app, /RAW HID JPEG FRAME/);
  assert.match(app, /Text only/);
  assert.match(app, /Icon only/);
  assert.match(app, /Text \+ icon/);
  assert.match(app, /Multiple lines/);
  assert.match(app, /Long label/);
  assert.match(app, /Active state/);
  const streamDeckCss = css.slice(css.indexOf('/* stream deck */'), css.indexOf('PHASE 4'));
  assert.doesNotMatch(streamDeckCss, /rotate\(/);
});

test('the operator surface exposes model simulation, per-key previews, errors, and proof export', () => {
  for (const token of ['og-sd-model', 'og-sdk-preview', 'og-sd-error', 'og-sd-export', 'og-sd-proof-preview']) {
    assert.match(app, new RegExp(token));
  }
  assert.match(app, /does not replace a physical-device check/);
  assert.match(css, /min-height:\s*44px/);
});

test('state-driven repaint is coalesced and serialized', () => {
  const refresh = app.slice(app.indexOf('function scheduleStreamDeckRefresh()'), app.indexOf('function buildStreamDeckProofCanvas'));
  assert.match(app, /if \(sdRefreshPromise\) return sdRefreshPromise;/);
  assert.match(refresh, /do \{/);
  assert.match(refresh, /await sdPaintAll\(target\)/);
  assert.match(refresh, /while \(sdRefreshAgain\)/);
  assert.match(app, /scheduleStreamDeckRefresh\(\);\s*\/\/ physical labels/);
  assert.match(app, /function renderPadLive\(id\)[\s\S]*scheduleStreamDeckRefresh\(\)/);
});

test('initial and later paints share one device-bound repaint owner', () => {
  const connect = app.slice(app.indexOf('async function sdConnect()'), app.indexOf('function onSdDisconnect'));
  assert.match(connect, /await scheduleStreamDeckRefresh\(\)/);
  assert.doesNotMatch(connect, /sdPaintAll\(/);
  assert.match(app, /async function sdPaintAll\(target = sd\)/);
  assert.match(app, /async function sdPaintKey\(i, target = sd\)/);
  assert.match(app, /if \(!target \|\| target !== sd\) return false;/);
  assert.match(app, /for \(const packet of rendered\.packets\) \{[\s\S]*if \(target !== sd\) return false;[\s\S]*target\.device\.sendReport/);
  assert.match(app, /input only, no image profile/);
});

test('reactive keys read local progress accessors, never Firestore', () => {
  assert.match(app, /function padProgress\(padId\)/);
  assert.match(app, /function cueProgress\(\)/);
  assert.match(app, /src\._ogStartedAt = ac\.currentTime/);
  assert.match(app, /phase: 'prewait'/);
  const padAccessor = app.slice(app.indexOf('function padProgress'), app.indexOf('function armCueSfxTie'));
  const cueAccessor = app.slice(app.indexOf('function cueProgress'), app.indexOf('function renderClock'));
  for (const accessor of [padAccessor, cueAccessor]) {
    assert.ok(accessor.length > 0);
    assert.doesNotMatch(accessor, /_updateDoc|sessionRef|firebase/i);
  }
  assert.match(app, /padProgress, cueProgress,/);   // same-tab surfaces read the public accessors
});

test('the meter tick repaints only changed keys through the per-key painter', () => {
  assert.match(app, /SD_PROGRESS_STEPS = 20/);
  assert.match(app, /SD_KEY_REPAINT_MS = 200/);
  assert.match(app, /paintMeters\(\); sdReactiveTick\(\);/);
  const tick = app.slice(app.indexOf('function sdKeySignature'), app.indexOf('function buildStreamDeckProofCanvas'));
  assert.match(tick, /sdPaintKey\(i\)/);
  assert.doesNotMatch(tick, /sdPaintAll/);
  assert.match(tick, /sdKeyBusy\[i\]/);
  assert.match(app, /sdHwSig\[i\] = sdKeySignature\(i, sdMap\[i\]\)/);   // painted keys stamp their signature
});

test('descriptors carry progress, phase, looping, and pressed for the renderer', () => {
  assert.match(app, /function sdKeyProgress\(index, mapping\)/);
  const descriptor = app.slice(app.indexOf('function sdKeyDescriptor'), app.indexOf('function sdActionLabel'));
  for (const field of ['progress', 'progressStyle', 'phase', 'looping', 'pressed']) {
    assert.match(descriptor, new RegExp(field + '[,:]'));   // shorthand or keyed
  }
});

test('pressed is a brief input flash, not the latched active state', () => {
  assert.match(app, /SD_PRESS_FLASH_MS = 150/);
  assert.match(app, /sdPressUntil\[i\] = performance\.now\(\) \+ SD_PRESS_FLASH_MS/);
  const activeFn = app.slice(app.indexOf('function sdKeyIsActive'), app.indexOf('function sdKeyPressed'));
  assert.doesNotMatch(activeFn, /sdState\[/);
  // Flash clearing must go through the retrying backstop, never a raw timeout:
  // a quick tap with no rAF loop running could otherwise latch the flash.
  assert.match(app, /function sdArmPressFlashClear/);
  assert.doesNotMatch(app, /setTimeout\(\(\) => sdReactiveTick\(\)/);
});

test('cross-surface actions have deck icons, department colors, and a local-state hook', () => {
  const crossActions = ['rundown_go', 'rundown_back', 'rtrt_take', 'rtrt_abort', 'prompter_toggle', 'prompter_top', 'prompter_cue'];
  for (const key of crossActions) {
    assert.match(app, new RegExp(key + ":\\s*'#"));
    assert.match(app, new RegExp("action === '" + key + "'"));
  }
  assert.match(app, /cueolaControlSurfaceState/);
});

test('the og join card rides the shared profile identity (INC-3)', () => {
  // Signed-in profile: name locked to the profile display name, with a switch
  // affordance into the identity portal.
  assert.match(app, /function ogJoinProfile\(\)/);
  assert.match(app, /nameEl\.readOnly = true; nameEl\.setAttribute\('aria-readonly', 'true'\)/);
  assert.match(app, /id="og-join-switch">Not you\? Switch<\/button>/);
  assert.match(app, /window\.CueolaIdentity\.openHub\(\)/);
  assert.match(app, /join-identity-strip" id="og-join-identity"/);
  // The join stamps profile identity the way cueola-app joinSession does, and
  // routes through noteJoin so the session auto-attaches to the profile.
  assert.match(app, /window\.CueolaIdentity\.noteJoin\(code, name\)/);
  assert.match(app, /identity: 'profile'/);
  // Guests keep the typed-name path but the join records identity:'guest'.
  assert.match(app, /identity: 'guest'/);
  assert.match(app, /sessionUserName = sessionIdentity\.userName/);
  // The entry gate stays in front of the join.
  assert.match(app, /window\.cueolaEntryGateAllows\(code, 'Outrangutan'\)/);
});

test('openSignIn accepts { returnTo } and routes back to a screen after sign-in', () => {
  // Options-object arg with string back-compat, and only join kinds close modals.
  assert.match(identityJs, /typeof returnTo === 'object'\) \? returnTo\.returnTo : returnTo/);
  assert.match(identityJs, /if \(target === 'stud' \|\| target === 'pp'\) close\(/);
  // 'keywi' returns through the control surface front door; screen ids switch
  // the single .screen.on the way the app routes screens.
  assert.match(identityJs, /function returnToScreen\(target\)/);
  assert.match(identityJs, /window\.openControlSurface === 'function'/);
  assert.match(identityJs, /classList\.contains\('screen'\)/);
  assert.match(identityJs, /if \(returnToScreen\(kind\)\) \{ close\('identityModal'\); return; \}/);
});

test('og close controls use the shared close glyph, not literal characters', () => {
  assert.doesNotMatch(app, /aria-label="Remove mapping">✕/);
  assert.doesNotMatch(app, /aria-label="Delete bank">×/);
  assert.match(app, /aria-label="Remove mapping">' \+ sym\('action\.close'\)/);
  assert.match(app, /aria-label="Delete bank">' \+ sym\('action\.close'\)/);
});

test('KeyWi: every device write rides one serialized queue, with per-slot coalescing', () => {
  // The queue exists once and is the only sendReport owner.
  assert.match(deck, /function queueDeviceWrite\(slotKey, job, lane\)/);
  assert.match(deck, /async function drainDeviceWrites\(\)/);
  assert.match(deck, /var old = hidWriteQueue\.splice\(i, 1\)\[0\]; old\.resolve\(false\);/);   // newer image drops the older
  // Key images (paintChanged AND animateKeys both go through paintKeyDevice).
  const painter = deckSlice('function paintKeyDevice(i, spec, lane)', 'function mirrorCanvasFor');
  assert.match(painter, /queueDeviceWrite\('key:' \+ i/);
  assert.match(deckSlice('async function paintChanged()', 'function startAnim'), /paintKeyDevice\(i, spec\)/);
  assert.match(deckSlice('function animateKeys()', 'async function hypeShow'), /paintKeyDevice\(i, spec\)/);
  // Strip, lightshow, brightness/reset features, and test patterns all queue.
  assert.match(deckSlice('async function paintStrip(force)', 'function drawStripMirrorCanvas'), /queueDeviceWrite\('strip'/);
  assert.match(deckSlice('async function connectLightShow()', 'function onDisconnect'), /queueDeviceWrite\('key:' \+ order\[k\]/);
  assert.match(deckSlice('function sendFeature(rep)', 'function setBrightness'), /queueDeviceWrite\(null/);
  assert.match(deckSlice('async function testPattern()', 'async function testStrip'), /queueDeviceWrite\('key:' \+ i/);
  assert.match(deckSlice('async function sendStripVariant(v)', 'async function stripProbe'), /queueDeviceWrite\(null/);
  assert.match(deckSlice('async function testStrip()', 'function deviceDiag'), /queueDeviceWrite\(null/);
  // No sendReport call sites outside the file's queued jobs: every occurrence
  // sits inside a function that was asserted queued above, so a new raw writer
  // must fail this count when it appears outside them.
  const raw = deck.match(/\.sendReport\(/g) || [];
  const queued = deck.match(/queueDeviceWrite\(/g) || [];
  assert.ok(queued.length >= 8, 'queue call sites present');
  assert.ok(raw.length <= 7, 'sendReport stays inside the queued jobs (found ' + raw.length + ')');
});

test('KeyWi: the paint tick pushes repaints unconditionally, sig-diffed', () => {
  const tick = deckSlice('function paintTick()', 'function refreshDialReadouts');
  assert.match(tick, /paintChanged\(\);/);
  assert.doesNotMatch(tick, /if \(paintScheduled\)/);
  // The signature carries the live state: progress (20 steps), pre-roll, phase,
  // pulse lamps, loop, flash, and the clock readout.
  const sig = deckSlice('function specSig(spec, i)', 'function drawKeyInto');
  for (const token of ['progress \\* 20', 'preroll \\* 20', 'spec\\.phase', 'spec\\.pulse', 'spec\\.looping', 'spec\\.flash', 'spec\\.clockText', 'spec\\.clockRunning']) {
    assert.match(sig, new RegExp(token));
  }
  // Same-tab Outrangutan accessors are the preferred progress truth.
  const progress = deckSlice('function ogAccessors()', 'function keyArtSpec');
  assert.match(progress, /og\.padProgress\(padId\)/);
  assert.match(progress, /og\.cueProgress\(\)/);
  assert.doesNotMatch(progress, /firebase|firestore|_updateDoc/i);
  // Animated predicate covers progress, pre-roll, phase, pulse, loop, flash.
  const anim = deckSlice('function specAnimated(spec)', 'function animateKeys');
  for (const token of ['spec\\.progress != null', 'spec\\.preroll != null', 'spec\\.phase', 'spec\\.pulse', 'spec\\.looping', 'spec\\.flash']) {
    assert.match(anim, new RegExp(token));
  }
});

test('KeyWi: wipe, pre-roll, and press flash painters follow the renderer conventions', () => {
  const draw = deckSlice('function drawKeyInto(canvas, spec, z)', '// ── Serialized HID write queue');
  // Duration wipe: translucent accent, left to right, behind the art, no glow.
  // 0.26 alpha is the contrast-audited value: labels stay >= 4.5:1 on every
  // theme's brightest wiped face while the wipe edge stays clearly visible.
  assert.match(draw, /spec\.progressStyle === 'wipe'/);
  assert.match(draw, /rgba\(t\.ring, 0\.26\)/);
  assert.doesNotMatch(draw, /shadowBlur/);
  // Pre-roll: thin bottom bar; loop: static corner marker.
  assert.match(draw, /spec\.preroll != null/);
  assert.match(draw, /spec\.looping/);
  // Press flash mirrors SD_PRESS_FLASH_MS and composes as an overlay.
  assert.match(deck, /SD_PRESS_FLASH_MS = 150/);
  assert.match(deck, /pressFlashUntil\[i\] = performance\.now\(\) \+ SD_PRESS_FLASH_MS/);
  assert.match(draw, /spec\.pressed \|\| spec\.flash/);
});

test('KeyWi: per-key appearance overrides are additive slot fields with safe defaults', () => {
  // keyArtSpec consumes every override; absent fields fall back to the old
  // behavior (auto look, wipe style, flash on, reactive on), so profiles saved
  // before this feature load unchanged with no migration.
  const spec = deckSlice('function keyArtSpec(i, s)', 'function specSig');
  assert.match(spec, /slot\.hideLabel \? '' : slotLabel/);
  assert.match(spec, /if \(slot\.flash === false\)/);
  assert.match(spec, /if \(slot\.symbol\)/);
  assert.match(spec, /if \(slot\.reactive !== false\)/);
  assert.match(spec, /if \(slot\.style && spec\.progress != null\) spec\.progressStyle = slot\.style/);
  // The reactive opt-out must gate BOTH playout progress and the pulse lamps.
  const reactiveBlock = spec.slice(spec.indexOf('slot.reactive !== false'));
  assert.match(reactiveBlock, /applyPlayoutProgress/);
  assert.match(reactiveBlock, /spec\.pulse = true/);
  // The signature carries the style so a mid-play style change repaints.
  assert.match(deckSlice('function specSig(spec, i)', 'function drawKeyInto'), /spec\.progressStyle \|\| ''/);
  // The editor exposes all of it, and reset clears every override field.
  const editor = deckSlice('function openKeyEditor(index, fromLearn)', 'function refreshKey');
  for (const token of ['sd-ed-hex', 'sd-ed-hidelabel', 'sd-ed-symsearch', 'sd-symgrid', 'sd-ed-style-seg', 'sd-ed-flash', 'sd-ed-reactive']) {
    assert.match(editor, new RegExp(token));
  }
  assert.match(editor, /delete slot\.label; delete slot\.hideLabel; delete slot\.color; delete slot\.icon; delete slot\.symbol; delete slot\.style; delete slot\.flash; delete slot\.reactive/);
  // Curated symbol picker rides the existing Path2D catalog, no new pipeline.
  assert.match(deck, /var SYMBOL_PICK = \[/);
  assert.match(editor, /function paintSymbolPicker/);
  assert.match(editor, /drawSymbolPath\(/);
});

test('KeyWi: painters render all three progress styles with sharp doctrine-clean edges', () => {
  const draw = deckSlice('function drawKeyInto(canvas, spec, z)', '// ── Serialized HID write queue');
  assert.match(draw, /spec\.progressStyle === 'wipe'/);
  assert.match(draw, /spec\.progressStyle === 'ring'/);
  assert.match(draw, /spec\.progressStyle !== 'wipe'/);   // bottom bar fallback
  assert.doesNotMatch(draw, /shadowBlur/);
});

test('KeyWi: seven deck themes including Liquid Glass and RGB Flow, chips render from the table', () => {
  const themes = deckSlice('var DECK_THEMES = {', 'function glyphFor');
  assert.equal((themes.match(/name: '/g) || []).length, 7);
  assert.match(themes, /liquidglass: \{/);
  assert.match(themes, /name: 'Liquid Glass'/);
  const lg = themes.slice(themes.indexOf('liquidglass: {'));
  assert.doesNotMatch(lg, /shadowBlur|shadowColor/);   // hairline rims and fills only
  assert.match(lg, /rgba\(sp\.color/);                 // accent tint
  // RGB Flow animates via the paint signature (spec.rgbPhase), never a free
  // timer: the phase is stepped/quantized so exactly one repaint per step,
  // and the step slows as hardware decks join (a full wave repaints EVERY
  // key, so the serialized HID queue must drain between waves).
  assert.match(themes, /rgbflow: \{/);
  const rf = themes.slice(themes.indexOf('rgbflow: {'), themes.indexOf('liquidglass: {'));
  assert.doesNotMatch(rf, /shadowBlur|shadowColor/);
  assert.match(rf, /sp\.rgbPhase/);
  assert.match(rf, /sp\.cols/);                                          // painted deck's grid, not the active-deck global
  assert.match(deck, /spec\.rgbPhase = Math\.floor\(performance\.now\(\) \/ rgbStepMs\(\)\)/);
  assert.match(deck, /function rgbStepMs\(\) \{ return decks\.length > 1 \? 1500 : decks\.length \? 900 : 500; \}/);
  assert.match(deck, /spec\.rgbPhase == null \? '' : spec\.rgbPhase/);   // rides specSig
  // Toolbar and wizard chips iterate DECK_THEMES, so new themes appear in
  // both automatically; the chip accent styles exist in the page CSS.
  assert.match(deck, /Object\.keys\(DECK_THEMES\)\.map\(function \(id\)/);
  assert.match(html, /\.sd-th-liquidglass\.cur/);
  assert.match(html, /\.sd-th-rgbflow\.cur/);
});

test('KeyWi: key images animate GIFs through the sig-diffed paint loop with taint-safe sources', () => {
  // Sources are validated at set time: data URLs or repo assets only, so the
  // shared offscreen canvas can never be tainted (toBlob must keep working).
  assert.match(deck, /SLOT_IMG_DATA_RE = \/\^data:image\\\/\(png\|jpe\?g\|webp\|gif\)/);
  assert.match(deck, /SLOT_IMG_ASSET_RE/);
  const toSlot = deckSlice('function toSlot(s)', 'function persist');
  assert.match(toSlot, /delete slot\.img/);
  // The GIF frame index is the ONE counter gifTick advances (anim.cur); every
  // spec builder reads it, and the state signature leaves it out, so the
  // 5 Hz pass and the 10 Hz GIF loop can never paint different frames.
  assert.match(deck, /spec\.gifFrame = gifFrameIndex\(gifAnim\(slot\.img\)\)/);
  assert.match(deck, /function gifFrameIndex\(anim\) \{ return anim && anim\.ok \? \(anim\.cur \|\| 0\) : 0; \}/);
  const face = deckSlice('function faceSig(spec)', '// Rundown info key');
  assert.doesNotMatch(face, /gifFrame/);
  assert.match(deck, /function specSig\(spec, i\) \{ return i \+ '\|' \+ faceSig\(spec\); \}/);
  assert.match(deck, /typeof ImageDecoder === 'undefined'/);
  // While a GIF decodes the face shows a neutral placeholder, never a plain
  // Image of a remote source (a non-CORS Image would taint the shared
  // offscreen canvas and kill toBlob for every key); only a failed decode
  // falls back to the static image, which loads remote sources with CORS.
  const drawImg = deckSlice('// Custom key image: fills the whole face', 'var ink = t.ink');
  assert.match(drawImg, /gifAnim\(spec\.img\)/);
  assert.match(drawImg, /pending = !\(ge && ge\.err\)/);
  assert.match(drawImg, /if \(!kim && !pending\) kim = keyImage\(spec\.img\)/);
  assert.match(drawImg, /else if \(pending\)/);
  assert.match(deckSlice('function keyImage(src)', 'function imgSig'), /img\.crossOrigin = 'anonymous'/);
});

test('KeyWi: GIF keys run on their own 10 fps cadence, behind state writes, from an encoded-frame cache', () => {
  // A worker-backed 100 ms loop advances every decoded GIF by elapsed time
  // (a late tick shows the next frame), paints only the keys whose GIF moved,
  // stamps lastPainted like animateKeys, and skips the hidden mirror.
  assert.match(deck, /var GIF_TICK_MS = 100, GIF_BURST_KEYS = 4, GIF_FREEZE_MS = 500;/);
  assert.match(deck, /gifTimer = steadyInterval\(gifTick, GIF_TICK_MS\)/);
  const tick = deckSlice('function gifTick()', '// ── Prompter strip smoothing');
  assert.match(tick, /if \(!profile \|\| hypeRunning \|\| \(!device && !vis\)\) return;/);
  assert.match(tick, /gifAdvance\(_keyGifs\[src\], dt\)/);
  assert.match(tick, /if \(canWrite\) \{ lastPainted\[i\] = specSig\(spec, i\); paintKeyDevice\(i, spec, 'gif'\); \}/);
  assert.match(tick, /dk\.lastPainted\[k\] = specSig\(sp2, k\); paintKeyDeviceFor\(dk, k, sp2, 'gif'\)/);
  const adv = deckSlice('function gifAdvance(e, dt)', '// Encoded-face cache');
  assert.match(adv, /e\.acc \+= dt;/);
  assert.match(adv, /e\.cur = \(e\.cur \+ 1\) % e\.frames\.length/);
  // Frame drops: no GIF write while a state write runs or waits, during the
  // strip probe, or for 500 ms after a burst of state repaints; the burst
  // freeze gates device writes only, so the on-screen mirror keeps moving.
  const allow = deckSlice('function gifWritesAllowed(now)', 'function gifTick()');
  assert.match(allow, /hidWriteBusy && hidWriteLane !== 'gif'/);
  assert.match(allow, /stateJobsQueued\(\) \|\| stripProbeActive/);
  assert.match(allow, /now >= gifFreezeUntil/);
  const pass = deckSlice('async function paintChangedPass()', 'function paintKeyDeviceFor');
  assert.match(pass, /if \(wrote >= GIF_BURST_KEYS\) gifFreezeUntil = performance\.now\(\) \+ GIF_FREEZE_MS;/);
  // The mirror draws only while the KeyWi screen is visible; showScreen marks
  // it dirty so the first pass after reopening catches the grid up.
  assert.match(pass, /if \(vis\) \{ var cv = mirrorCanvasFor\(i\); if \(cv\) drawKeyInto\(cv, spec, cv\.width\); \}/);
  assert.match(pass, /else mirrorDirty = true;/);
  assert.match(pass, /if \(vis && mirrorDirty\) paintMirror\(\);/);
  assert.match(deckSlice('function showScreen()', 'function hideScreen()'), /mirrorDirty = true;/);
  // Two lanes on one queue: state writes go ahead of waiting GIF frames, a
  // frame replacing a waiting lamp write inherits its priority.
  const q = deckSlice('function queueDeviceWrite(slotKey, job, lane)', 'async function drainDeviceWrites');
  assert.match(q, /if \(old\.lane === 'state'\) lane = 'state';/);
  assert.match(q, /if \(hidWriteQueue\[g\]\.lane === 'gif'\) \{ at = g; break; \}/);
  assert.match(deckSlice('async function drainDeviceWrites()', 'function flushDeviceWrites'), /hidWriteLane = next\.lane;/);
  // Encoded-frame cache: JPEG bytes per (src, frame, key px, rotation, face
  // signature minus the frame), packetized at send time, byte-budgeted,
  // bypassed for transient faces, dropped with the frames.
  assert.match(deck, /GIF_ENC_BUDGET = 8 \* 1024 \* 1024/);
  // C19: the key carries the decoded source's numeric id, never the (up to
  // 480k char) data URL, so the byte budget is the whole story again.
  assert.match(deck, /var _keyGifs = \{\}, _gifSrcSeq = 0;/);
  assert.match(deckSlice('function gifAnim(src)', 'function dropGifCache'), /dim: dim, id: \+\+_gifSrcSeq \};/);
  assert.match(deck, /function gifEncKey\(spec, z, deg\) \{ var ge = _keyGifs\[spec\.img\]; return \(\(ge && ge\.id\) \|\| 0\) \+ '\|' \+ \(spec\.gifFrame \|\| 0\) \+ '\|' \+ z \+ '\|' \+ deg \+ '\|' \+ faceSig\(spec\); \}/);
  assert.doesNotMatch(deck, /return spec\.img \+ '\|' \+ \(spec\.gifFrame/);
  assert.match(deck, /spec\.rgbPhase == null && !spec\.pulse && !spec\.clockRunning && gifAnim\(spec\.img\)/);
  const fb = deckSlice('async function faceBytes(spec, z, deg)', 'function drawCover');
  assert.match(fb, /var hit = _gifEnc\.get\(ck\); if \(hit\) return hit\.bytes;/);
  assert.match(fb, /if \(ck && bytes\) gifEncStore\(ck, spec\.img, bytes\);/);
  assert.match(deckSlice('function paintKeyDevice(i, spec, lane)', 'function mirrorCanvasFor'), /await faceBytes\(spec, z, keyDeg\(\)\)/);
  assert.match(deckSlice('function paintKeyDevice(i, spec, lane)', 'function mirrorCanvasFor'), /Device\.keyImagePackets\(profile, i, bytes\)/);
  assert.match(deckSlice('function paintKeyDeviceFor(deck, i, spec, lane)', '// ── GIF cadence'), /await faceBytes\(spec, z, deckDeg\(deck\.profile\)\)/);
  assert.match(deckSlice('function pruneKeyArtCaches()', 'function warmGifSlots'), /_gifEnc\.forEach\(function \(v, k\) \{ if \(!used\[v\.src\]\) gifEncDelete\(k\); \}\);/);
  // Frames decode at the largest attached key face (at least the mirror's
  // device-pixel backing size, C21) under a memory budget that scales with
  // the decode area so the frame count stays constant; a bigger deck
  // attaching decodes again.
  assert.match(deck, /GIF_MIRROR_DIM = 132, GIF_MEM_BUDGET = 6 \* 1024 \* 1024, GIF_MAX_FRAMES = 300/);
  assert.match(deck, /function gifMirrorPx\(\) \{ var dpr = 1; try \{ dpr = Math\.min\(window\.devicePixelRatio \|\| 1, 2\); \} catch \(e\) \{\} return Math\.round\(GIF_MIRROR_DIM \* dpr\); \}/);
  assert.match(deckSlice('function gifDecodeDim()', 'function gifMemBudget'), /return Math\.min\(GIF_MAX_DIM, Math\.max\(d, gifMirrorPx\(\)\)\);/);
  assert.match(deck, /function gifMemBudget\(dim\) \{ return Math\.round\(GIF_MEM_BUDGET \* Math\.pow\(Math\.max\(dim, GIF_MIRROR_DIM\) \/ GIF_MIRROR_DIM, 2\)\); \}/);
  assert.match(deck, /cap = Math\.max\(2, Math\.floor\(gifMemBudget\(dim\) \/ \(bw \* bh \* 4\)\)\)/);
  // The undersized sweep compares against the same gifDecodeDim().
  assert.match(deckSlice('function dropUndersizedGifs()', 'function pruneKeyArtCaches'), /var dim = gifDecodeDim\(\);\n\s+Object\.keys\(_keyGifs\)\.forEach\(function \(src\) \{ if \(\(_keyGifs\[src\]\.dim \|\| 0\) < dim\) dropGifCache\(src\); \}\);/);
  assert.match(deckSlice('async function connect(', 'async function connectLightShow'), /startGifLoop\(\);\n\s+dropUndersizedGifs\(\);/);
  assert.match(deckSlice('function teardownDevice()', 'function startPreview'), /stopGifLoop\(\)/);
  assert.match(deckSlice('function startPreview()', 'function stopPreview'), /startGifLoop\(\)/);
  assert.match(deckSlice('function stopPreview()', 'function onInputReport'), /stopGifLoop\(\)/);
});

test('KeyWi: GIPHY runs on the class key or the operator key, PG-13 only, and picks land as CDN references', async () => {
  const { readFile: rf } = await import('node:fs/promises');
  const fb = await rf(new URL('../../firebase.json', import.meta.url), 'utf8');
  // CSP allows the API and media hosts (search + thumbnail + decode).
  assert.match(fb, /https:\/\/api\.giphy\.com/);
  assert.match(fb, /img-src[^;]*https:\/\/\*\.giphy\.com/);
  assert.match(fb, /connect-src[^;]*https:\/\/\*\.giphy\.com/);
  // Lookup order: a key pasted on this device wins, else the class key from
  // config/giphy (read once after firebaseReady through the same handles
  // the profile save uses). No key literal in the repo, no search proxy.
  const giphy = deckSlice('var GIPHY_KEY_LS', '// Upload pipeline');
  assert.match(giphy, /localStorage\.getItem\(GIPHY_KEY_LS\)/);
  assert.match(giphy, /function giphyKey\(\) \{ return giphyLocalKey\(\) \|\| _sharedGiphyKey; \}/);
  assert.match(giphy, /window\._getDoc\(window\._doc\(window\._db, 'config', 'giphy'\)\)/);
  assert.doesNotMatch(deck, /api_key=[A-Za-z0-9]{10}/);
  assert.doesNotMatch(deck, /_httpsCallable\([^)]*giphy/i);
  assert.match(giphy, /https:\/\/api\.giphy\.com\/v1\/gifs\//);
  // Removing a pasted key only clears the local override; the class key is
  // written by an instructor with 'Use for the whole class' and a refusal
  // keeps the key on the device with a plain toast.
  assert.match(deck, /localStorage\.removeItem\(GIPHY_KEY_LS\)/);
  assert.match(giphy, /window\._setDoc\(window\._doc\(window\._db, 'config', 'giphy'\), \{ key: v, updatedAt: Date\.now\(\), updatedBy: /);
  assert.match(giphy, /id="sd-giphy-share" checked><span>Use for the whole class<\/span>/);
  assert.match(giphy, /e\.code === 'permission-denied'/);
  assert.match(giphy, /if \(!isInstructorHere\(\)\) \{ toast\('Only an instructor can share a class key\.'\); return; \}/);
  assert.match(giphy, /GIPHY_KEY_RE = \/\^\[A-Za-z0-9\]\{10,80\}\$\//);
  // Classroom rating cap rides every request, search and trending alike;
  // results and trending are cached per session and searches are debounced,
  // and trending is never fetched automatically on the shared class key.
  assert.match(giphy, /&limit=24&rating=pg-13/);
  assert.match(giphy, /var cached = q \? _giphyCache\[q\.toLowerCase\(\)\] : _giphyTrending;/);
  assert.match(deck, /GIPHY_DEBOUNCE_MS = 400/);
  assert.match(deckSlice('function wireKeyEditor(index)', 'function funArtEntries'), /else if \(giphyKeyIsOwn\(\)\) giphySearch\(index, ''\);/);
  assert.match(giphy, /Powered by GIPHY/);
  // Picks are stored as references: slot.gif = { id, url, w, h } with a
  // canonical query-free CDN url that toSlot validates against a strict
  // regex; no bytes in the layout, so a deck of GIFs fits any profile save.
  assert.match(giphy, /slot\.gif = \{ id: g\.id, url: url, w: g\.w \|\| 0, h: g\.h \|\| 0 \}; slot\.img = url;/);
  assert.doesNotMatch(giphy, /readAsDataURL/);
  assert.match(deck, /function giphyCanonicalUrl\(id\) \{ return 'https:\/\/media\.giphy\.com\/media\/' \+ id \+ '\/200w\.gif'; \}/);
  assert.match(deck, /SLOT_GIF_URL_RE = \/\^https:\\\/\\\/media\\d\*\\\.giphy\\\.com\\\/media\\\/\[A-Za-z0-9\]\+\\\/\(200w\|100w\|giphy\)\\\.gif\$\//);
  const toSlot = deckSlice('function toSlot(s)', 'function persist');
  assert.match(toSlot, /SLOT_GIF_URL_RE\.test\(g\.url\)/);
  assert.match(toSlot, /else \{ delete slot\.gif; if \(typeof slot\.img === 'string' && \/\^https\?:\/i\.test\(slot\.img\)\) delete slot\.img; \}/);
  // Result titles are escaped on the way into the DOM.
  assert.match(giphy, /data-tip="' \+ esc\(g\.title\)/);
  // Rules text for the shared key (orchestrator-owned): open get, admin write.
  const add = await rf(new URL('../../docs/rules-additive-2026-09-03-hiddensessions.rules', import.meta.url), 'utf8');
  assert.match(add, /match \/config\/\{docId\} \{\s*allow get: if docId == "giphy";/);
});

test('KeyWi: saved layouts come back from the profile as My layouts rows', () => {
  // Loader: profiles/{username}.keywiLayouts read on open, after a sign-in,
  // and from the deck service; every key passes toSlot before addProfile.
  const loader = deckSlice('function loadCloudLayouts()', 'function cloudLayoutRows');
  assert.match(loader, /window\._getDoc\(window\._doc\(window\._db, 'profiles', id\.username\)\)/);
  assert.match(loader, /var raw = d && d\.keywiLayouts/);
  const sheet = deckSlice('function openCloudLayoutsSheet()', '// ── Utilities');
  assert.match(sheet, /addProfile\(l\.name \|\| 'Layout', l\.keys\.map\(toSlot\)/);
  assert.match(deckSlice('function pagesBar()', 'function startPageRename'), /id="sd-pf-cloud"/);
  assert.match(deck, /bind\('sd-pf-cloud', openCloudLayoutsSheet\)/);
  assert.match(deckSlice('function open()', 'function close()'), /loadSharedGiphyKey\(\);[^\n]*\n\s*loadCloudLayouts\(\);/);
  assert.match(deckSlice("document.addEventListener('cueola-identity-change'", 'window.addEventListener'), /loadCloudLayouts\(\); loadSharedGiphyKey\(\);/);
  // A profile save records the new layout locally and tells a full document
  // from a refused write.
  const save = deckSlice('function saveLayoutToProfile(leaveAfter)', '// ── Saved layouts');
  assert.match(save, /_cloudLayouts\[key\] = layout;/);
  assert.match(save, /code === 'invalid-argument' \|\| \/too large\|exceeds\|maximum size\/i\.test\(msg\)/);
});

test('KeyWi: GIF decode is bomb-guarded, caches are pruned, and a full store warns instead of silently dropping edits', () => {
  // Decompression-bomb guard: frames land downscaled (longest side capped),
  // sub-20ms delays get the browser-style ~100ms substitution, and the
  // frame count is bounded by a memory budget.
  assert.match(deck, /GIF_MAX_DIM = 224/);
  assert.match(deck, /resizeQuality: 'medium'/);
  assert.match(deck, /if \(d < 20\) d = 100;/);
  assert.match(deck, /GIF_MEM_BUDGET = 6 \* 1024 \* 1024/);
  // Import-path parity: .keywi files and hand-edited stores obey the same
  // per-image length caps as the upload pipeline.
  assert.match(deck, /SLOT_IMG_MAX_CHARS = 90000/);
  assert.match(deck, /SLOT_GIF_MAX_CHARS = 480000/);
  // Cache lifecycle: every persist prunes bitmaps no slot references (across
  // all decks), and closes GIF frames on the way out.
  const prune = deckSlice('function pruneKeyArtCaches()', 'function warmGifSlots');
  assert.match(prune, /if \(!used\[src\]\) dropGifCache\(src\)/);
  assert.match(deckSlice('function dropGifCache(src)', 'function dropUndersizedGifs'), /b\.close\(\)/);
  assert.match(deckSlice('function persist(quiet)', 'function newId'), /pruneKeyArtCaches\(\)/);
  // A full localStorage toasts a clear warning instead of failing silently.
  assert.match(deckSlice('function writeStore(s)', 'function loadConfig'), /Layout storage is full/);
});

test('KeyWi: auto-dim drops to 20% after five idle minutes and restores on any input', () => {
  const dim = deckSlice('var AUTO_DIM_AFTER_MS', 'function registerLabelModel');
  assert.match(deck, /AUTO_DIM_AFTER_MS = 5 \* 60 \* 1000/);
  assert.match(deck, /AUTO_DIM_PCT = 20/);
  // Dim never raises brightness, and both writes ride the queued feature path.
  assert.match(dim, /sendFeature\(Device\.brightnessReport\(profile, Math\.min\(brightness, AUTO_DIM_PCT\)\)\)/);
  assert.match(dim, /function noteDeckInput\(\)/);
  assert.match(dim, /sendFeature\(Device\.brightnessReport\(profile, brightness\)\)/);
  // Every hardware input restores; teardown stops the timer.
  assert.match(deckSlice('function onInputReport(e)', 'function controllerForDial'), /noteDeckInput\(\)/);
  assert.match(deckSlice('function teardownDevice()', 'function startPreview'), /stopAutoDim\(\)/);
  // The slider counts as input too and the store keeps the operator preference.
  assert.match(deckSlice('function setBrightness(pctVal)', 'var AUTO_DIM_AFTER_MS'), /armAutoDim\(\)/);
});

test('KeyWi: the sign-in gate fails closed and passes returnTo (INC-4)', () => {
  const gate = deckSlice('function keyWiSignInGate()', 'function open()');
  assert.match(gate, /window\._firebaseReady/);
  assert.match(gate, /return false;/);
  assert.match(gate, /openSignIn\(\{ returnTo: 'keywi' \}\)/);
  assert.match(gate, /catch \(e\) \{ try \{ id\.openSignIn\(\); \}/);   // tolerant fallback
  assert.match(deckSlice('function open() {', 'function close()'), /if \(!keyWiSignInGate\(\)\) return false;/);
});

test('KeyWi: one window drives the hardware (Web Locks election; talent windows abstain)', () => {
  // Rival windows opening the same HID device tear the multi-packet key
  // writes (glitching art) and double-fire every press. The talent display
  // and the in-page talent doors never start the deck service at all.
  const aux = deckSlice('var AUX_OUTPUT_BOOT', 'var tbSocket');
  assert.match(aux, /get\('prompter'\) === '1'/);
  assert.match(aux, /flowmingo/);
  assert.match(aux, /promptypus/);
  assert.match(deckSlice('function bootDeckService()', 'if (window._firebaseReady)'), /if \(AUX_OUTPUT_BOOT\) return;/);
  // The service boots the election (winner silently re-attaches, losers queue
  // standby) and re-runs it when a granted deck is plugged in.
  const service = deckSlice('function startDeckService()', 'function bootDeckService()');
  assert.match(service, /electDeckOwner\(\)/);
  assert.match(service, /addEventListener\('connect', onHidConnect\)/);
  const elect = deckSlice('function electDeckOwner()', 'function onHidConnect()');
  assert.match(elect, /acquireDeckOwnership\(\{ ifAvailable: true \}\)/);
  assert.match(elect, /standbyForDeck\(\)/);
  assert.match(elect, /reattachGrantedDecks\(\)/);
  // An empty-handed winner gives the lock back and retries on the timer, so a
  // window that could open nothing (Elgato app holding the USB device, deck
  // unplugged) never parks the lock and blocks the other windows.
  assert.match(elect, /releaseDeckOwnership\(\); scheduleDeckElection\(\);/);
  assert.match(deckSlice('function standbyForDeck()', 'function scheduleDeckElection()'), /scheduleDeckElection\(\)/);
  assert.match(deckSlice('function connectCameUpEmpty()', 'async function addDeck()'), /releaseDeckOwnership\(\)/);
  // Only the lock request that BACKS current ownership may clear it: a null
  // ifAvailable probe must never clobber a standby-held lock.
  assert.match(deckSlice('function acquireDeckOwnership(opts)', 'function releaseDeckOwnership()'), /deckOwnerToken === token/);
  // Explicit Connect (and Add deck) in a non-owner window takes the deck over.
  assert.match(deckSlice('async function connect()', 'function connectCameUpEmpty()'), /await ensureDeckOwnership\(\)/);
  assert.match(deckSlice('async function addDeck()', 'var openInFlight'), /await ensureDeckOwnership\(\)/);
  assert.match(deckSlice('function ensureDeckOwnership()', 'function deckOwnershipLost()'), /steal: true/);
  // Concurrent opens of the same HIDDevice (standby re-attach racing Connect)
  // join the in-flight open instead of registering the deck twice.
  assert.match(deckSlice('var openInFlight', 'function deckOwnerNow()'), /openInFlight\.get\(dev\)/);
  // Ownership is re-checked across every await inside the open: a lock stolen
  // while the chooser was up or a USB round trip was in flight must close the
  // handle instead of registering a lockless deck.
  const openNow = deckSlice('async function openDeviceNow(dev, silent)', 'async function connectLightShow()');
  assert.ok((openNow.match(/deckOwnerNow\(\)/g) || []).length >= 3);
  assert.match(openNow, /await dev\.close\(\)/);
  // Losing the lock closes every handle (an open handle still receives input
  // reports), skips the goodbye reset, re-queues a standby claim, and never
  // freezes an active on-screen preview.
  const lost = deckSlice('function deckOwnershipLost()', 'function reattachGrantedDecks()');
  assert.match(lost, /oninputreport = null/);
  assert.match(lost, /d\.hid\.close\(\)/);
  assert.match(lost, /standbyForDeck\(\)/);
  assert.match(lost, /if \(!previewMode\) teardownDevice\(\);/);
  assert.doesNotMatch(lost, /resetReport/);
  // Hardware input (keys, dials, AND the touch strip) paints straight from the
  // event: a backgrounded window's 5Hz tick is throttled to 1Hz, HID is not.
  const primaryInput = deckSlice('function onInputReport(e)', 'function onSecondaryInput');
  assert.match(primaryInput, /touchFire\(evt\); paintNow\(\);/);
  assert.match(deckSlice('function onSecondaryInput(deck, e)', 'function controllerForDial'), /paintNow\(\)/);
  // The immediate paints make overlapping passes routine, so paintChanged is
  // single-flight with a queued re-run instead of interleaving stale state.
  assert.match(deckSlice('async function paintChanged()', 'async function paintChangedPass()'), /paintPassAgain = true/);
});

test('KeyWi: the scrub dial answers the hand instantly, batches mid-scrub, and scales with spin speed', () => {
  const jog = deckSlice('var jogPend = 0', 'function rundownTick');
  // Leading edge: a first detent from rest flushes NOW; only mid-scrub ticks
  // wait for the batch window (one seek_line per ~100ms over the session doc).
  assert.match(jog, /if \(since >= JOG_FLUSH_MS\) \{ jogFlush\(\); return; \}/);
  assert.match(jog, /JOG_FLUSH_MS - since/);
  assert.match(jog, /JOG_FLUSH_MS = 100/);
  // Velocity scaling: single detents stay a fine 2-line nudge, spins escalate.
  assert.match(jog, /JOG_LINES_PER_DETENT = 2/);
  assert.match(jog, /jogRecent\.length >= 10\) return 8/);
  assert.match(jog, /jogRecent\.length >= 5\) return 4/);
  assert.match(jog, /d \* jogLinesPerDetent\(\)/);
  // A reversal starts a new gesture at fine control: the corrective click
  // after an overshooting spin must not inherit the spin's velocity.
  assert.match(jog, /if \(dir !== jogRecentDir\) \{ jogRecent\.length = 0; jogRecentDir = dir; \}/);
  // The protocol clamp survives the rework.
  assert.match(jog, /Math\.max\(-200, Math\.min\(200, Math\.round\(jogPend\)\)\)/);
  assert.match(jog, /seek_line_/);
});

test('KeyWi: dial direction is a per-deck contract applied where encoder ticks enter', () => {
  // Both rotate entry points (active deck and secondary decks) flip through
  // dialDirFor; touch-strip flicks are a screen gesture and never flip.
  const primary = deckSlice('function onInputReport(e)', 'function onSecondaryInput');
  assert.match(primary, /dialTick\(i, t \* dialDirFor\(device\)\)/);
  const secondary = deckSlice('function onSecondaryInput(deck, e)', 'function controllerForDial');
  assert.match(secondary, /c\.tick\(t \* dialDirFor\(deck\)\)/);
  assert.doesNotMatch(secondary, /dialDirFor\(deck\).*x2 > evt\.x|x2 > evt\.x.*dialDirFor/);
  const dirFn = deckSlice('function dialDirFor(deck)', 'function paintNow()');
  assert.match(dirFn, /ov\.dialFlip \? -1 : 1/);
  // The setting lives in Deck settings, persists per device, and re-renders.
  const flip = deckSlice('function setDialFlip(on)', 'function renderDeckSettings');
  assert.match(flip, /overrides\.dialFlip = !!on/);
  assert.match(flip, /persist\(true\)/);
  const settings = deckSlice('function renderDeckSettings()', 'function surfaceGrid');
  assert.match(settings, /sd-dialdir-n/);
  assert.match(settings, /sd-dialdir-r/);
  // Diagnostics: dial turns are logged live so direction is verifiable on
  // real hardware, and the copyable report carries them.
  assert.match(deckSlice('function noteDiagDials(evt, deck)', 'function diagPanel'), /forward \/ up \/ more/);
  assert.match(deckSlice('function diagText()', 'function diagPanel'), /Dial check/);
  assert.match(primary, /noteDiagDials\(evt, device\)/);
  assert.match(secondary, /noteDiagDials\(evt, deck\)/);
  // A VISIBLE report captures test turns WITHOUT dispatching them (a test
  // turn must never scrub the live prompter), but a report left open
  // off-screen never eats dials (that read as dead hardware mid-show), and
  // leaving the KeyWi screen ends the capture entirely.
  assert.match(primary, /if \(diagCaptureActive\(\)\) noteDiagDials\(evt, device\); else evt\.ticks\.forEach/);
  assert.match(secondary, /if \(diagCaptureActive\(\)\) noteDiagDials\(evt, deck\); else evt\.ticks\.forEach/);
  assert.match(deck, /function diagCaptureActive\(\) \{ return !!diagInfo && isSurfaceVisible\(\); \}/);
  assert.match(deckSlice('function hideScreen()', 'window.addEventListener(\'blur\''), /diagInfo = null; clearTimeout\(diagDialRenderTimer\)/);
  assert.match(deckSlice('function noteDiagDials(evt, deck)', 'function diagPanel'), /deckName \+ ' dial '/);
  assert.match(deckSlice('async function runDiagnostics()', 'function diagText()'), /liveDials: !!device/);
  assert.match(deckSlice('function diagText()', 'function diagPanel'), /else if \(!d\.liveDials\)/);
  // Flipping dials on a deck that vanished mid-session refuses honestly
  // instead of toasting success over a write persist() silently dropped.
  assert.match(deckSlice('function setDialFlip(on)', 'function renderDeckSettings'), /if \(!profile\) \{ toast\('Deck disconnected/);
});

test('KeyWi: talent overlay keys cover the owner list, dispatch through the bridge, and lamp from mirrored state', () => {
  // One key per owner-requested control (8/24): time-of-day clock, duration,
  // count-to-time, wrap 5, wrap 10, question card, clear all, push script.
  for (const id of ['pt.clock', 'pt.duration', 'pt.totime', 'pt.wrap5', 'pt.wrap10', 'pt.question', 'pt.overlays.clear', 'pt.push']) {
    assert.match(deck, new RegExp("id: '" + id.replace(/\./g, '\\.') + "', kind: 'ptOverlay'"));
  }
  // Dispatch rides the bridge so toggle semantics stay app-side.
  assert.match(deck, /case 'ptOverlay': if \(phase === 'down'\)[\s\S]{0,120}prompterOverlay\(a\.op\)/);
  // Lamps read the mirrored overlay state from the surface bridge.
  assert.match(deck, /function ptClockLamp\(m\) \{ return function \(s\) \{ return !!\(s\.prompter && s\.prompter\.clockMode === m\); \}; \}/);
  assert.match(deck, /s\.prompter\.questionOn/);
  // Actions may carry their own symbol path, and the picker files the new
  // group under Flowmingo instead of dumping it below Fun and Blank.
  assert.match(deckSlice('function symbolFor(a)', 'function keyArtSpec(i, s)'), /if \(a\.symbol\) return a\.symbol/);
  assert.match(deck, /'Flowmingo', 'Flowmingo · talent overlays', 'Micochondria'/);
  // App-side: the bridge resolves each op against the operator mirrors.
  const appSrc = deck; // deck file only; the app side is asserted in live-ui-contract
});

test('KeyWi: app-family key rims paint by default and switch off per deck', () => {
  assert.match(deck, /APP_RIM_COLORS = \{ cueola: '#8a93a6', flowmingo: '#f06eb4', outrangutan: '#f97316', obs: '#5b8df8' \}/);
  assert.match(deck, /function appRimsOn\(ov\) \{ var o = ov \|\| overrides; return !o \|\| o\.appRims !== false; \}/);
  // Both spec builders stamp the rim color AND width (active deck and
  // secondary decks, each against its own overrides), and the paint
  // signature carries both, so a secondary deck repaints on the next tick.
  assert.match(deckSlice('function keyArtSpec(i, s)', 'function keyArtSpecFor'), /if \(appRimsOn\(\)\) \{ spec\.rim = appRimColor\(a\); spec\.rimW = rimWidthOf\(\); \}/);
  const forDeck = deckSlice('function keyArtSpecFor(deck, i, s)', 'function specSig');
  assert.match(forDeck, /var dov = \(deck\.cfg \|\| \{\}\)\.overrides;/);
  assert.match(forDeck, /if \(appRimsOn\(dov\)\) \{ spec\.rim = appRimColor\(a, dov\); spec\.rimW = rimWidthOf\(dov\); \}/);
  const sig = deckSlice('function specSig(spec, i)', '// Rundown info key');
  assert.match(sig, /spec\.rim \|\| '', spec\.rimW \|\| ''/);
  // The painter strokes it (rimStrokePx honors the no-overlay image opt-out).
  const painter = deckSlice('function drawKeyInto(canvas, spec, z)', '// ── Serialized HID write queue');
  assert.match(painter, /var rimIn = rimStrokePx\(spec, z\), rimX = Math\.max\(0, rimIn - z \* 0\.06\);/);
  assert.match(painter, /if \(rimIn > 0\) \{/);
  assert.match(deck, /function rimStrokePx\(spec, z\) \{\n    if \(!spec\.rim \|\| spec\.noOverlay\) return 0;/);
  // Deck settings expose the switch, on by default.
  assert.match(deckSlice('function rimsSection()', 'function wireRims'), /sd-rims-on/);
  assert.match(deckSlice('function setAppRims(on)', 'function setDialFlip'), /delete overrides\.appRims/);
});

test('KeyWi: rim width and per-app colors are per deck, ride the spec, and keep the default pixel-identical', () => {
  // Units: px on a 96px reference face, integer 1..12, ABSENT = the 8/24
  // formula (so an untouched deck paints exactly as before this round).
  assert.match(deck, /var RIM_REF_PX = 96, RIM_WIDTH_MIN = 1, RIM_WIDTH_MAX = 12;/);
  assert.match(deck, /var RIM_PRESETS = \{ thin: 2, regular: 0, bold: 7 \};/);
  const stroke = deckSlice('function rimStrokePx(spec, z)', 'function slotAt(i)');
  assert.match(stroke, /if \(rw\) return Math\.max\(1, z \* \(rw \/ RIM_REF_PX\) \* \(spec\.active \? 1\.33 : 1\)\);/);
  assert.match(stroke, /return Math\.max\(3, z \* \(spec\.active \? 0\.06 : 0\.045\)\);/);
  const painter = deckSlice('function drawKeyInto(canvas, spec, z)', '// ── Serialized HID write queue');
  assert.doesNotMatch(painter, /Math\.max\(3, z \* \(spec\.active \? 0\.06 : 0\.045\)\)/);
  // Corner dots, loop marker and pulse ring step inward by the EXCESS rim only.
  assert.match(painter, /ctx\.arc\(z \* 0\.86 - rimX, z \* 0\.14 \+ rimX, z \* 0\.055, 0, 7\)/);
  assert.match(painter, /ctx\.arc\(z \* 0\.14 \+ rimX, z \* 0\.14 \+ rimX, z \* 0\.055, 0, 7\)/);
  assert.match(painter, /ctx\.fillRect\(z - z \* 0\.08 - rimX - mk, z \* 0\.08 \+ rimX, mk, mk\)/);
  assert.match(painter, /rr\(ctx, z \* 0\.03 \+ rimX, z \* 0\.03 \+ rimX, z \* 0\.94 - 2 \* rimX, z \* 0\.94 - 2 \* rimX, z \* 0\.14\)/);
  // Colors: validated hex per app, defaults from APP_RIM_COLORS, overrides-aware
  // (the action tray's chips resolve against the active deck the same way).
  assert.match(deck, /var RIM_HEX_RE = \/\^#\(\[0-9a-f\]\{3\}\|\[0-9a-f\]\{6\}\)\$\/i;/);
  assert.match(deck, /function appRimColor\(a, ov\) \{ var key = rimAppKey\(a\); return key \? rimColorFor\(key, ov\) : null; \}/);
  assert.match(deckSlice('function rimWidthOf(ov)', 'function rimWidthShown'), /Math\.max\(RIM_WIDTH_MIN, Math\.min\(RIM_WIDTH_MAX, v\)\)/);
  assert.match(deckSlice('function actionTray()', 'function legendCard'), /appRimColor\(catalog\[it\.id\]\)/);
  // Setters follow setAppRims: profile guard, overrides, persist(true), paintAll.
  const setters = deckSlice('function setRimWidth(px, opts)', 'function rimEditBusy');
  assert.match(setters, /if \(px === RIM_WIDTH_REGULAR\) delete overrides\.rimWidth;/);
  assert.match(setters, /else overrides\.rimWidth = px;/);
  assert.match(setters, /overrides\.rimColors\[key\] = hex;/);
  assert.match(setters, /if \(!Object\.keys\(overrides\.rimColors\)\.length\) delete overrides\.rimColors;/);
  assert.match(setters, /function resetRims\(\)[\s\S]{0,200}delete overrides\.rimWidth; delete overrides\.rimColors; delete overrides\.appRims;/);
  assert.match(setters, /function recolorTrayChips\(\)/);
  // The slider updates the sheet IN PLACE: the input path never re-renders
  // the sheet (that would destroy the slider mid-drag); presets pass rerender.
  const widthFn = deckSlice('function setRimWidth(px, opts)', 'function setRimColor');
  assert.match(widthFn, /if \(opts && opts\.rerender\) \{ renderDeckSettings\(\); return; \}/);
  assert.equal((widthFn.match(/renderDeckSettings\(\)/g) || []).length, 1);
  const wire = deckSlice('function wireRims(o)', '// Flip is a fact about');
  assert.match(wire, /rw\.oninput = function \(\) \{ setRimWidth\(\+rw\.value\); \};/);
  assert.match(wire, /inp\.oninput = function \(\) \{ setRimColor\(/);
  assert.match(wire, /inp\.onchange = function \(\) \{[^\n]*renderDeckSettings\(\);/);
  // An OBS state flip re-renders the sheet; while the slider is held or a
  // color picker is open that re-render is deferred, not applied.
  assert.match(deckSlice('function renderDeckSettings()', 'function surfaceGrid'), /if \(rimEditBusy\(\)\) \{ settingsRerenderPending = true; return; \}/);
  // Markup: presets, slider, four color wells, Reset.
  const section = deckSlice('function rimsSection()', 'function wireRims');
  for (const id of ['sd-rim-thin', 'sd-rim-reg', 'sd-rim-bold', 'sd-rim-w', 'sd-rim-w-val', 'sd-rims-reset']) assert.match(section, new RegExp('id="' + id + '"'));
  assert.match(section, /\[\['cueola', 'Cueola'\], \['flowmingo', 'Flowmingo'\], \['outrangutan', 'Outrangutan'\], \['obs', 'OBS'\]\]/);
  assert.match(section, /data-rim-app="' \+ p\[0\] \+ '"/);
  assert.match(html, /\.sd-rim-color input\[type=color\]/);
  // Persistence: the v3 geometry wipe leaves the rim prefs alone.
  const wipe = deck.match(/\[('[a-zA-Z]+', )+'keyPx'\]\.forEach\(function \(k\) \{ delete overrides\[k\]; \}\);/);
  assert.ok(wipe, 'geometry wipe list present');
  assert.doesNotMatch(wipe[0], /rimWidth|rimColors|appRims/);
  // Copy: no em or en dashes in the new settings copy.
  assert.doesNotMatch(section, /[–—]/);
});

test('KeyWi: Director layouts keep playout transport off the student deck', () => {
  const layouts = deckSlice('var DIRECTOR_LAYOUTS = {', 'var LAYOUT_TEMPLATES');
  for (const size of [6, 8, 15]) assert.match(layouts, new RegExp('\\n    ' + size + ': +\\['));
  assert.doesNotMatch(layouts, /playout\.|pad:|cue:|obs\./);
  for (const id of ["'km:rundown.back'", "'km:rundown.next'", "'rundown.take'", "'rundown.abort'", "'info.rundown'", "'clock'"]) assert.ok(layouts.includes(id), id);
  assert.match(layouts, /'golive'/);
  assert.match(layouts, /'pt\.question',\n[^\n]*'pt\.wrap5', 'pt\.wrap10', 'pt\.overlays\.clear', 'layout\.prev', 'layout\.next'/);
  // Every id in the Director tables is a registered catalog action.
  for (const id of layouts.match(/'[a-z][a-z0-9.:]*'/g).map(s => s.slice(1, -1))) {
    const base = id.startsWith('km:') ? id.slice(3) : id;
    assert.ok(deck.includes("['" + base + "',") || deck.includes("id: '" + base + "'"), 'catalog has ' + id);
  }
  // The template picks from the bridge role (student = Director) as a hint,
  // and the Add-a-page sheet offers both templates for any deck.
  assert.match(deck, /function defaultTemplate\(\) \{ return sessionRole\(\) === 'student' \? 'director' : 'default'; \}/);
  assert.match(deckSlice('function defaultKeySlots(keys, template)', 'function defaultTouch'), /LAYOUT_TEMPLATES\[template \|\| defaultTemplate\(\)\] \|\| DEFAULT_LAYOUTS/);
  const sheet = deckSlice('function openNewPageSheet()', '// ── Import / export');
  assert.match(sheet, /data-tpl="director"/);
  assert.match(sheet, /defaultKeySlots\(profile\.keys, tpl\)/);
  assert.match(deck, /bind\('sd-pf-new', openNewPageSheet\)/);
  // C22: the auto-seeded page carries its provenance, and an untouched
  // Starter page becomes Director when the role turns student later (the
  // deck attached before the show code was typed). Never the reverse, never
  // an edited page, never a multi-page deck, never in preview or mid-edit.
  const seed = deckSlice('function ensureProfilesShape()', 'function switchProfile');
  assert.match(seed, /var tpl = defaultTemplate\(\);/);
  assert.match(seed, /keys: defaultKeySlots\(profile\.keys, tpl\), dials: defaultDialSet\(profile\), touch: defaultTouch\(profile\.strip \? profile\.strip\.zones : 0\), auto: \{ tpl: tpl, keys: profile\.keys \}/);
  const rec = deckSlice('function reconcileAutoPageFor(profs, prof)', 'function reconcileAutoPages()');
  assert.match(rec, /Object\.keys\(profs\)\.length !== 1\) return false;/);
  assert.match(rec, /if \(tpl !== 'default' \|\| !slotsMatchTemplate\(p\.keys, 'default', prof\.keys\)\) return false;/);
  assert.match(rec, /p\.keys = defaultKeySlots\(prof\.keys, 'director'\); p\.name = 'Director'; p\.auto = \{ tpl: 'director', keys: prof\.keys \};/);
  const match = deckSlice('function slotsMatchTemplate(keys, tpl, n)', 'function reconcileAutoPageFor');
  assert.match(match, /if \(k\.a !== def\[i\]\.a\) return false;/);
  assert.match(match, /Object\.keys\(k\)\.some\(function \(f\) \{ return f !== 'a' && k\[f\]; \}\)/);
  const run = deckSlice('function reconcileAutoPages()', 'function switchProfile');
  assert.match(run, /if \(role === lastAutoRole\) return;\n\s+lastAutoRole = role;\n\s+if \(role !== 'student' \|\| layoutDirty \|\| previewMode \|\| !decks\.length\) return;/);
  assert.match(run, /stashActiveDeck\(\);/);
  assert.match(run, /decks\.forEach\(function \(dk\) \{ if \(dk\.cfg && reconcileAutoPageFor\(dk\.cfg\.profiles, dk\.profile\)\) changed\.push\(dk\); \}\);/);
  assert.match(run, /changed\.forEach\(function \(dk\) \{ persistDeck\(dk\); if \(dk !== device\) repaintDeck\(dk\); \}\);/);
  assert.match(run, /toast\('Director page loaded for this show\.'\);/);
  assert.match(deckSlice('function paintTick()', 'function refreshDialReadouts'), /reconcileAutoPages\(\);/);
  // The Starter page itself is untouched: '' and every non-student role keep it.
  assert.match(deck, /function defaultTemplate\(\) \{ return sessionRole\(\) === 'student' \? 'director' : 'default'; \}/);
});

test('KeyWi: secondary decks animate too (pulse rings, RGB flow, clock dots)', () => {
  const anim = deckSlice('function animateKeys()', 'async function hypeShow');
  assert.match(anim, /for \(var di = 0; di < decks\.length; di\+\+\) \{\n      var dk = decks\[di\]; if \(dk === device \|\| !dk\.profile\) continue;/);
  assert.match(anim, /var sp2 = keyArtSpecFor\(dk, k, s\);\n        if \(!specAnimated\(sp2\)\) continue;\n        sp2\.pulsePhase = animPhase;/);
  assert.match(anim, /dk\.lastPainted\[k\] = specSig\(sp2, k\); paintKeyDeviceFor\(dk, k, sp2\);/);
});

test('KeyWi OBS keys: late refusals flash and speak, STARTING is a gate and a pulse, the strip loop rides a worker timer', () => {
  // fireSlot carries the key index and deck so an async rejection can still
  // stamp the right refusedFlashUntil array.
  assert.match(deck, /function fireSlot\(slot, phase, fromDeck, keyIdx\)/);
  assert.match(deck, /fireSlot\(mapping\(\)\.keys\[i\], 'down', null, i\)/);
  assert.match(deck, /fireSlot\(toSlot\(\(m\.keys \|\| \[\]\)\[i\] \|\| \{ a: 'none' \}\), 'down', deck, i\)/);
  const fire = deckSlice('function fireSlot(slot, phase, fromDeck, keyIdx)', 'function dispatchCloud');
  assert.match(fire, /octx = \{ key: keyIdx, deck: fromDeck, label: a\.label \|\| a\.full \|\| a\.id \}/);
  assert.match(fire, /obsDo\(a\.op, octx\)/);
  assert.match(fire, /obsSceneSlot\(a\.slot, octx\)/);
  assert.match(fire, /obsDo2\('setScene', slot\.ref, octx\)/);
  assert.match(fire, /obsDo2\('toggleMute', slot\.ref, octx\)/);
  const obs = deckSlice('var OBS_CONNECT_FIRST', 'var OBS_VOL_KEY');
  assert.match(obs, /p\.then\(null, function \(e\) \{ noteObsRefusal\(ctx, e\); \}\)/);
  assert.match(obs, /toast\('OBS refused ' \+ \(\(ctx && ctx\.label\) \|\| 'the request'\) \+ ': ' \+ msg\)/);
  assert.match(obs, /\(ctx\.deck\.refusedFlashUntil = ctx\.deck\.refusedFlashUntil \|\| \[\]\)\[ctx\.key\] = performance\.now\(\) \+ 900/);
  assert.match(obs, /else refusedFlashUntil\[ctx\.key\] = performance\.now\(\) \+ 900/);
  // Only STARTING refuses (a second press while STOPPING is OBS's force-stop).
  assert.match(obs, /if \(obsOutputStarting\(op\)\) \{ toast\('OBS is still starting the /);
  assert.doesNotMatch(obs, /OBS_WEBSOCKET_OUTPUT_STOPPING/);
  assert.match(obs, /if \(op === 'toggleStream'\) return st\.streamState === OBS_STARTING;/);
  assert.match(obs, /if \(op === 'toggleRecord'\) return st\.recordState === OBS_STARTING;/);
  // STARTING paints as a dimmer pulse in both spec builders.
  assert.match(deckSlice('function keyArtSpec(i, s)', 'function keyArtSpecFor'), /obsOutputStarting\(a\.op\)\) \{ spec\.pulse = true; spec\.pulseColor = \(a\.op === 'toggleRecord'\) \? '#8c6a20' : '#8c2626'; \}/);
  assert.match(deckSlice('function keyArtSpecFor(deck, i, s)', 'function specSig'), /obsOutputStarting\(a\.op\)\) \{ spec\.pulse = true;/);
  assert.match(deckSlice('function specSig(spec, i)', '// Rundown info key'), /spec\.pulseColor \|\| ''/);
  // The strip zone press shares the gate; its dot breathes while STARTING.
  const strip = deckSlice("obsProgram: { label: 'OBS program'", "ptProgram: { label: 'Prompter view'");
  assert.match(strip, /press: function \(\) \{ obsDo\('toggleStream', \{ label: 'STREAM' \}\); \}/);
  assert.match(strip, /st\.streaming \|\| st\.streamState === OBS_STARTING/);
  // Volume ticks catch rejections (throttled toast, no unhandledrejection noise).
  assert.match(deckSlice('function obsVolTick(d)', 'var obsWasReady'), /p\.then\(null, onErr\)/);
  // One 'Connect OBS first' string, pointing at the place that exists.
  assert.equal((deck.match(/Connect OBS first/g) || []).length, 1);
  assert.match(deck, /var OBS_CONNECT_FIRST = 'Connect OBS first: Deck settings \(gear\) > OBS Studio\.';/);
  // The strip's OBS program monitor loop is a worker interval, not a page setInterval.
  const loop = deckSlice('function ensureObsFrameLoop()', 'async function pollObsFrame');
  assert.match(loop, /obsFrameLoop = steadyInterval\(pollObsFrame, 250\)/);
  assert.doesNotMatch(loop, /= setInterval\(|clearInterval\(/);
  assert.match(deckSlice('async function pollObsFrame()', '// The strip is a glanceable dashboard'), /obsFrameLoop\.stop\(\)/);
});

test('KeyWi: honest playback HOLD, keymap refusals flash, rundown keymap keys dim for a non-caller, GO LIVE lamp reads live.on', () => {
  const og = deckSlice("ogProgram: { label: 'Playback view'", "micoStatus: { label: 'Micochondria'");
  assert.match(og, /if \(po\.hold\) return 'HOLD';/);
  assert.match(og, /bar: function \(s\) \{\n        var po = s\.playout \|\| \{\};\n        if \(po\.hold\) return null;/);
  // C12 deck side: HOLD only on po.hold; a rolling cue with no clock reads
  // PLAY (pause: nothing, the strip prints PAUSED itself), never 'idle'.
  assert.match(og, /if \(po\.status === 'play' \|\| po\.status === 'pause'\) return po\.remaining != null \? fmtClock\(po\.remaining\) : \(po\.status === 'play' \? 'PLAY' : ''\);\n\s+return 'idle';/);
  assert.equal((og.match(/'HOLD'/g) || []).length, 1);
  // runAction's own result comes back; a strict false is a refused press
  // for the local rundown keymap ids only (C20): a prompter command returns
  // false when it was QUEUED for an unlinked talent, and that is not refused.
  assert.match(deck, /function surfaceRun\(id\) \{ var b = bridge\(\); try \{ return b \? b\.runAction\(id\) : undefined; \}/);
  const fire = deckSlice('function fireSlot(slot, phase, fromDeck, keyIdx)', 'function dispatchCloud');
  assert.match(fire, /else if \(phase === 'down'\) \{ var kr = surfaceRun\(a\.keymapId\); refused = kr === false && \/\^rundown\\\.\/\.test\(a\.keymapId \|\| ''\); \} break;/);
  assert.doesNotMatch(fire, /refused = surfaceRun\(a\.keymapId\) === false/);
  const avail = deckSlice('function slotAvailability(a, s)', '// ── Rich key art');
  assert.match(avail, /if \(k === 'keymap' && \/\^rundown\\\.\/\.test\(a\.keymapId \|\| ''\) && s && s\.live && s\.live\.caller === false\) return 'off';/);
  assert.match(deck, /id: 'golive', kind: 'golive', machineLocal: true[^\n]*lamp: function \(s\) \{ return !!\(s\.live && s\.live\.on\); \}/);
  // ROW key: a second line for the talent's row when the bridge publishes it.
  const info = deckSlice('function applyRundownInfoSpec(spec, s)', '// Cache of decoded key images');
  assert.match(info, /else if \(tl && tl\.ahead\) spec\.infoTalent = 'AHEAD';/);
  assert.match(info, /spec\.infoTalent = 'TALENT ' \+ tn \+ \(tl\.title \? ' · ' \+ String\(tl\.title\)\.slice\(0, 24\) : ''\)/);
  assert.match(deckSlice('function specSig(spec, i)', '// Rundown info key'), /spec\.infoTalent \|\| ''/);
  const row = deckSlice("} else if (spec.widget === 'rowinfo') {", '} else {');
  assert.match(row, /var tight = !!spec\.infoTalent;/);
  assert.match(row, /z \* \(tight \? 0\.13 : 0\.16\)/);
  assert.match(row, /ctx\.fillText\(tt === spec\.infoTalent \? tt : tt \+ '…', z \/ 2, z \* 0\.26\);/);
});

test('Outrangutan cross-machine: baseline consumption, loud sync failures, no wall-clock drops', () => {
  // Commands and gain baseline on the FIRST snapshot after subscribe, then
  // apply every new id: the old sender-clock-vs-our-clock 30s window dropped
  // every cross-machine fire in silence when two Macs' clocks drifted.
  const doc = app.slice(app.indexOf('function onSessionDoc(d)'), app.indexOf('function applyRemoteCommand'));
  assert.match(doc, /if \(!sessionDocPrimed\) \{/);
  assert.match(doc, /lastCmdId = cmd\.commandId;\n        slog\('session'/);
  assert.doesNotMatch(doc, /Date\.now\(\) - cmd\.ts > 30000/);
  assert.doesNotMatch(doc, /Date\.now\(\) - g\.ts < 30000/);
  // A refused or dead session listener surfaces itself and retries: the rules
  // require sign-in even to READ, and a signed-out playout Mac used to look
  // joined while hearing nothing.
  const sub = app.slice(app.indexOf('function subscribeSession()'), app.indexOf('function unsubscribeSession()'));
  assert.match(sub, /not signed in\. Sign in on this Mac/);
  assert.match(sub, /subRetryTimer = setTimeout/);
  // Publish rejections surface once per subscribe instead of vanishing.
  assert.match(app, /function notePublishError\(err\)/);
  assert.match(app, /'outrangutan\.live': live \}\)\.catch\(notePublishError\)/);
  assert.match(app, /'outrangutan\.sender': OG_SENDER \}\)\.catch\(notePublishError\)/);
});

test('KeyWi: the Playback monitor distinguishes idle from not-linked', () => {
  // Feed health folds into the paint signature so the card flips live.
  assert.match(deckSlice('async function paintStrip(force)', 'function drawStripMirrorCanvas'), /cell\.ogFresh = !!\(s\.playout \|\| \{\}\)\.fresh/);
  const og = deckSlice('function drawStripOgProgram(ctx, cell, x0, zw, ch)', 'async function stripBytesFromContent');
  assert.match(og, /else if \(cell\.ogFresh\)/);
  assert.match(og, /Playback idle/);
  assert.match(og, /Playback not linked/);
  assert.match(og, /Open Outrangutan and join this show/);
});

for (const { name, run } of tests) {
  await run();
  console.log('PASS', name);
}
console.log(`PASS ${tests.length} Stream Deck integration tests`);
