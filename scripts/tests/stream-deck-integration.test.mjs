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
  assert.match(deck, /function queueDeviceWrite\(slotKey, job\)/);
  assert.match(deck, /async function drainDeviceWrites\(\)/);
  assert.match(deck, /hidWriteQueue\.splice\(i, 1\)\[0\]\.resolve\(false\)/);   // newer image drops the older
  // Key images (paintChanged AND animateKeys both go through paintKeyDevice).
  const painter = deckSlice('function paintKeyDevice(i, spec)', 'function mirrorCanvasFor');
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
  assert.match(draw, /spec\.progressStyle === 'wipe'/);
  assert.match(draw, /rgba\(t\.ring, 0\.34\)/);
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

test('KeyWi: six deck themes including Liquid Glass, and the chips render from the table', () => {
  const themes = deckSlice('var DECK_THEMES = {', 'function glyphFor');
  assert.equal((themes.match(/name: '/g) || []).length, 6);
  assert.match(themes, /liquidglass: \{/);
  assert.match(themes, /name: 'Liquid Glass'/);
  const lg = themes.slice(themes.indexOf('liquidglass: {'));
  assert.doesNotMatch(lg, /shadowBlur|shadowColor/);   // hairline rims and fills only
  assert.match(lg, /rgba\(sp\.color/);                 // accent tint
  // Toolbar and wizard chips iterate DECK_THEMES, so the sixth theme appears
  // in both automatically; the chip accent style exists in the page CSS.
  assert.match(deck, /Object\.keys\(DECK_THEMES\)\.map\(function \(id\)/);
  assert.match(html, /\.sd-th-liquidglass\.cur/);
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

for (const { name, run } of tests) {
  await run();
  console.log('PASS', name);
}
console.log(`PASS ${tests.length} Stream Deck integration tests`);
