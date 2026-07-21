import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [app, css, html, worker, bump, contracts] = await Promise.all([
  readFile(new URL('../../outrangutan/outrangutan.js', import.meta.url), 'utf8'),
  readFile(new URL('../../outrangutan/outrangutan.css', import.meta.url), 'utf8'),
  readFile(new URL('../../index.html', import.meta.url), 'utf8'),
  readFile(new URL('../../sw.js', import.meta.url), 'utf8'),
  readFile(new URL('../bump-cache.mjs', import.meta.url), 'utf8'),
  readFile(new URL('../check-contracts.mjs', import.meta.url), 'utf8'),
]);

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

test('the Stream Deck + is a first-class model: keys, dials, and touch strip', () => {
  // control metadata: gen-2 offsets/commands with four encoders declared
  assert.match(app, /0x0084: \{ name: 'Stream Deck \+',\s+keys: 8,\s+cols: 4,\s+stateOffset: 3,\s+imageProductId: 0x0084,\s+reset: \[0x03, 0x02\],\s+bright: \[0x03, 0x08\],\s+encoders: 4 \}/);
  // input reports multiplex through byte 0 only on encoder models
  const input = app.slice(app.indexOf('function onSdInput('), app.indexOf('function sdDialRotate('));
  assert.match(input, /if \(sd\.model\.encoders\) \{/);
  assert.match(input, /data\[0\] === 0x03/);
  assert.match(input, /data\[0\] === 0x02/);
  // rotation is a signed detent count; presses fire on the rising edge
  assert.match(input, /raw > 127 \? raw - 256 : raw/);
  assert.match(input, /if \(pressed && !was\) fireSurfaceAction\(sdDialMap\[i\]\)/);
  // strip taps map to the tapped segment's dial; swipes stay unmapped
  assert.match(input, /data\[3\] !== 0x01 && data\[3\] !== 0x02/);
  assert.match(input, /Math\.floor\(x \/ lcd\.segmentWidth\)/);
});

test('dial mappings persist, paint the touch strip, and surface in the panel', () => {
  assert.match(app, /settings\.sdDialMap = settings\.sdDialMap \|\| defaultDialMap\(\)/);
  assert.match(app, /const SD_DIAL_FUNCTIONS = \{ select: 'Standby cue', master: 'Master level', scrub: 'Scrub playhead', bright: 'Deck brightness' \}/);
  // the physical strip repaints inside the same serialized repaint owner
  assert.match(app, /if \(target\.model\.encoders\) success = \(await sdPaintLcd\(target\)\) && success;/);
  assert.match(app, /renderAndPacketizeLcd\(target\.device\.productId, sdDialDescriptors\(target\.device\.productId\)\)/);
  assert.match(app, /Touch strip label failed:/);
  // panel: per-dial turn/press mapping plus a simulated strip preview
  for (const token of ['og-sdd-rot', 'og-sdd-act', 'og-sdd-ref', 'og-sd-lcd-preview', 'og-sd-dials']) {
    assert.match(app, new RegExp(token));
    if (token !== 'og-sd-lcd-preview') assert.match(css, new RegExp(token.replace('og-sdd-rot', 'og-sdd').replace('og-sdd-act', 'og-sdd').replace('og-sdd-ref', 'og-sdd')));
  }
  assert.match(css, /og-sd-lcd-preview/);
  assert.match(app, /renderLcdStrip\(productId, sdDialDescriptors\(productId\)\)/);
});

test('initial and later paints share one device-bound repaint owner', () => {
  const connect = app.slice(app.indexOf('async function sdConnect()'), app.indexOf('function onSdDisconnect'));
  assert.match(connect, /await scheduleStreamDeckRefresh\(\)/);
  assert.doesNotMatch(connect, /sdPaintAll\(/);
  assert.match(app, /async function sdPaintAll\(target = sd\)/);
  assert.match(app, /async function sdPaintKey\(i, target = sd\)/);
  assert.match(app, /if \(!target \|\| target !== sd\) return false;/);
  assert.match(app, /for \(const packet of rendered\.packets\) \{[\s\S]*if \(target !== sd\) return false;[\s\S]*target\.device\.sendReport/);
  assert.match(app, /input only — no image profile/);
});

for (const { name, run } of tests) {
  await run();
  console.log('PASS', name);
}
console.log(`PASS ${tests.length} Stream Deck integration tests`);
