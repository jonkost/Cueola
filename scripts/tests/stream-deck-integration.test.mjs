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
  // GIF frames ride the paint signature (gifFrame), decoded once per source,
  // with a static-first-frame fallback when WebCodecs is missing.
  assert.match(deck, /spec\.gifFrame = gifFrameIndex\(gifAnim\(slot\.img\)\)/);
  assert.match(deck, /spec\.gifFrame == null \? '' : spec\.gifFrame/);
  assert.match(deck, /typeof ImageDecoder === 'undefined'/);
  const drawImg = deckSlice('// Custom key image: fills the whole face', 'var ink = t.ink');
  assert.match(drawImg, /gifAnim\(spec\.img\)/);
  assert.match(drawImg, /keyImage\(spec\.img\)/);
});

test('KeyWi: GIPHY rides the operator key, PG-13 only, and picks land as capped data URLs', async () => {
  const { readFile: rf } = await import('node:fs/promises');
  const fb = await rf(new URL('../../firebase.json', import.meta.url), 'utf8');
  // CSP allows the API and media hosts (search + thumbnail + download).
  assert.match(fb, /https:\/\/api\.giphy\.com/);
  assert.match(fb, /img-src[^;]*https:\/\/\*\.giphy\.com/);
  assert.match(fb, /connect-src[^;]*https:\/\/\*\.giphy\.com/);
  // The key is the operator's own, from localStorage only: no key literal in
  // the repo, and removing it is a first-class control.
  const giphy = deckSlice('var GIPHY_KEY_LS', '// Upload pipeline');
  assert.match(giphy, /localStorage\.getItem\(GIPHY_KEY_LS\)/);
  assert.doesNotMatch(deck, /api_key=[A-Za-z0-9]{10}/);
  assert.match(deck, /localStorage\.removeItem\(GIPHY_KEY_LS\)/);
  // Classroom rating cap rides every request, search and trending alike.
  assert.match(giphy, /&limit=24&rating=pg-13/);
  // Picks are downloaded and stored through the same caps as uploads: remote
  // URLs never reach a slot (the canvas-taint rule), oversize renditions are
  // skipped, and the final data URL obeys SLOT_GIF_MAX_CHARS.
  assert.match(giphy, /blob\.size > 300 \* 1024/);
  assert.match(giphy, /SLOT_GIF_MAX_CHARS/);
  assert.match(giphy, /readAsDataURL\(blob\)/);
  // Result titles are escaped on the way into the DOM.
  assert.match(giphy, /data-tip="' \+ esc\(g\.title\)/);
});

test('KeyWi: GIF decode is bomb-guarded, caches are pruned, and a full store warns instead of silently dropping edits', () => {
  // Decompression-bomb guard: frames land downscaled (longest side capped),
  // sub-20ms delays get the browser-style ~100ms substitution, and tiny loops
  // are stretched so the 5Hz tick shows every frame instead of strobing.
  assert.match(deck, /GIF_MAX_DIM = 224/);
  assert.match(deck, /resizeQuality: 'medium'/);
  assert.match(deck, /if \(d < 20\) d = 100;/);
  assert.match(deck, /GIF_MIN_TOTAL_MS = 600/);
  // Import-path parity: .keywi files and hand-edited stores obey the same
  // per-image length caps as the upload pipeline.
  assert.match(deck, /SLOT_IMG_MAX_CHARS = 90000/);
  assert.match(deck, /SLOT_GIF_MAX_CHARS = 480000/);
  // Cache lifecycle: every persist prunes bitmaps no slot references (across
  // all decks), and closes GIF frames on the way out.
  const prune = deckSlice('function pruneKeyArtCaches()', 'function drawCover');
  assert.match(prune, /b\.close\(\)/);
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

for (const { name, run } of tests) {
  await run();
  console.log('PASS', name);
}
console.log(`PASS ${tests.length} Stream Deck integration tests`);
