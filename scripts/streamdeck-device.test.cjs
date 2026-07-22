/* Pure-logic tests for cueola-streamdeck-device.js. Runs in Node, no hardware.
 * Validates the WebHID byte contracts against synthetic reports so the driver
 * can be trusted before a Stream Deck + XL is ever plugged in.
 */
const D = require('../cueola-streamdeck-device.js');
let pass = 0, fail = 0;
function ok(name, cond) { if (cond) { pass++; } else { fail++; console.error('  FAIL: ' + name); } }
function eq(name, a, b) { ok(name + ' (' + JSON.stringify(a) + ' == ' + JSON.stringify(b) + ')', JSON.stringify(a) === JSON.stringify(b)); }

// ── Profile resolution ──────────────────────────────────────────────────────
const xl = D.makeProfile(0x006c, {});
eq('XL keys', xl.keys, 32); eq('XL cols', xl.cols, 8); eq('XL dials', xl.dials, 0);
ok('XL has no strip', xl.strip === null);
ok('XL modern state offset', xl.stateOffset === 3);

// Unknown product id → adaptive Stream Deck + XL defaults (36/6/6).
const plusxl = D.makeProfile(0x00aa, {});
eq('+XL adaptive keys', plusxl.keys, 36);
eq('+XL adaptive dials', plusxl.dials, 6);
ok('+XL adaptive strip zones', plusxl.strip && plusxl.strip.zones === 6);
ok('+XL flagged adaptive', plusxl.adaptive === true);

// Unit-info + overrides refine geometry; overrides win over device + defaults.
const refined = D.makeProfile(0x00aa, { unitInfo: { keys: 32, cols: 8 }, overrides: { rotation: 0, cols: 6 } });
eq('override cols wins', refined.cols, 6);
eq('override rotation wins', refined.rotation, 0);

// ── Key input report (cmd 0x00, states at data[3]) ──────────────────────────
function keyReport(pressedIdx, total) {
  const d = new Uint8Array(4 + total);
  d[0] = 0x00; d[1] = total & 0xff; d[2] = (total >> 8) & 0xff;
  pressedIdx.forEach(i => { d[3 + i] = 1; });
  return d;
}
let ev = D.parseInputReport(0x01, keyReport([0, 5, 31], 36), plusxl);
eq('key report type', ev.type, 'keys');
ok('key 0 pressed', ev.states[0] === true);
ok('key 5 pressed', ev.states[5] === true);
ok('key 31 pressed', ev.states[31] === true);
ok('key 1 not pressed', ev.states[1] === false);

const edges = D.keyEdges([false, false, false], [true, false, true]);
eq('edge downs', edges.downs, [0, 2]);
eq('edge ups', D.keyEdges([true, true], [false, true]).ups, [0]);

// ── Dial reports (cmd 0x03) ─────────────────────────────────────────────────
// Rotate: type 0x01 at data[3], signed int8 ticks from data[4].
const rot = new Uint8Array(16); rot[0] = 0x03; rot[3] = 0x01; rot[4] = 3; rot[5] = 0xFD /* -3 */; rot[9] = 1;
ev = D.parseInputReport(0x01, rot, plusxl);
eq('dial event type', ev.type, 'dials');
eq('dial kind', ev.kind, 'rotate');
eq('dial 0 +3', ev.ticks[0], 3);
eq('dial 1 -3 (signed)', ev.ticks[1], -3);
eq('dial 5 +1', ev.ticks[5], 1);
// Press: type 0x00 at data[3], per-dial 0/1 from data[4].
const prs = new Uint8Array(16); prs[0] = 0x03; prs[3] = 0x00; prs[4 + 2] = 1;
ev = D.parseInputReport(0x01, prs, plusxl);
eq('dial press kind', ev.kind, 'press');
ok('dial 2 pressed', ev.press[2] === true);
ok('dial 0 not pressed', ev.press[0] === false);

// ── Touch report (cmd 0x02) ─────────────────────────────────────────────────
// gesture at data[3]; X u16 LE at data[5..6]; Y at data[7..8]. Strip is 1200 wide
// with 6 zones (200px each), so x=650 lands in zone 3.
const touch = new Uint8Array(16); touch[0] = 0x02; touch[3] = 0x01; touch[5] = 650 & 0xff; touch[6] = 650 >> 8; touch[7] = 40;
ev = D.parseInputReport(0x01, touch, plusxl);
eq('touch type', ev.type, 'touch');
eq('touch gesture', ev.gesture, 'tap');
eq('touch x', ev.x, 650);
eq('touch zone (650/200)', ev.zone, 3);

// ── Key image packetization (report 0x02 / cmd 0x07) ────────────────────────
const img = new Uint8Array(2600).map((_, i) => (i * 7) & 0xff);
const kp = D.keyImagePackets(plusxl, 12, img);
ok('multi-packet image', kp.length === 3);         // 2600 / (1024-8=1016) = 3 packets
// data is the packet WITHOUT the report id byte (WebHID sendReport takes id separately).
eq('packet cmd byte', kp[0].data[0], 0x07);
eq('packet key index', kp[0].data[1], 12);
eq('first packet not last', kp[0].data[2], 0);
eq('last packet done flag', kp[2].data[2], 1);
// Reassemble payloads and compare to original.
function reassemble(packets, headerless) {
  let out = [];
  packets.forEach(p => { for (let i = headerless; i < p.data.length && out.length < 999999; i++) out.push(p.data[i]); });
  return out;
}
// header (minus report id) is 7 bytes for keys; take declared length per packet.
let rebuilt = [];
kp.forEach(p => { const len = p.data[3] | (p.data[4] << 8); for (let i = 0; i < len; i++) rebuilt.push(p.data[7 + i]); });
ok('key image reassembles byte-exact', rebuilt.length === img.length && rebuilt.every((b, i) => b === img[i]));

// ── Strip image packetization (report 0x02 / cmd 0x0c) ──────────────────────
const strip = new Uint8Array(1500).map((_, i) => (i * 3) & 0xff);
const sp = D.stripImagePackets(plusxl, strip);
eq('strip cmd byte', sp[0].data[0], 0x0c);
// region x=0,y=0,w=1200,h=100 → width u16 at data[5..6] (offset 6 minus report id = 5).
eq('strip region width lo', sp[0].data[5], 1200 & 0xff);
eq('strip region width hi', sp[0].data[6], 1200 >> 8);
let sRebuilt = [];
sp.forEach(p => { const len = p.data[12] | (p.data[13] << 8); for (let i = 0; i < len; i++) sRebuilt.push(p.data[15 + i]); });
ok('strip image reassembles byte-exact', sRebuilt.length === strip.length && sRebuilt.every((b, i) => b === strip[i]));

// ── Feature reports ─────────────────────────────────────────────────────────
const br = D.brightnessReport(plusxl, 55);
eq('brightness report id', br.reportId, 0x03);
eq('brightness bytes', Array.from(br.data), [0x08, 55]);
const rs = D.resetReport(plusxl);
eq('reset report id', rs.reportId, 0x03);
eq('reset byte', Array.from(rs.data), [0x02]);

// ── Unit info parse (best effort, self-validating) ──────────────────────────
const ui = D.parseUnitInfo(new Uint8Array([0x08, 0x00, 9, 4, 0, 0, 0, 0, 96, 0, 0xB0, 0x04]));
ok('unit info cols read', ui.cols === 9);
ok('unit info keys derived', ui.keys === 36);

console.log('\nStream Deck device: ' + pass + ' passed, ' + fail + ' failed.');
process.exit(fail ? 1 : 0);
