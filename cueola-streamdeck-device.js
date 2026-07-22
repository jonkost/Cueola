/* Cueola Stream Deck device core (pure protocol layer).
 *
 * Every byte-level fact about talking to an Elgato Stream Deck over WebHID lives
 * here, with ZERO dependence on the DOM, navigator.hid, or the Cueola app. That
 * keeps the hard part (input-report parsing, image packetization, probe-descriptor
 * reading, per-model geometry) testable in Node against synthetic byte arrays,
 * so the driver can be trusted before the hardware is ever plugged in.
 *
 * WebHID note that reconciles the offsets with Elgato's published HID spec:
 * navigator.hid delivers the report id OUT OF BAND (event.reportId), so the
 * DataView the browser hands us starts at what the spec calls offset +0x01.
 * Every offset below is therefore "spec offset minus one". That is exactly why
 * the classic decks read key state at data[3] (spec +0x04) and not data[4].
 *
 * Reference: https://docs.elgato.com/streamdeck/hid/
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.CueolaDeckDevice = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var ELGATO_VID = 0x0fd9;

  // Input report id is always 0x01; the first payload byte (data[0]) is the
  // command that tells keys from dials from touch on dial/touch decks.
  var CMD_KEYS = 0x00;    // data[0] on a key-state report
  var CMD_TOUCH = 0x02;   // data[0] on a touchscreen report
  var CMD_ENCODER = 0x03; // data[0] on a dial (encoder) report

  var ENCODER_PRESS = 0x00; // data[3] contents type: dial press/release
  var ENCODER_ROTATE = 0x01; // data[3] contents type: dial rotation ticks

  var TOUCH_TAP = 0x01;   // data[3] gesture: short tap
  var TOUCH_LONG = 0x02;  // data[3] gesture: long press
  var TOUCH_FLICK = 0x03; // data[3] gesture: swipe/flick

  // Feature reports (WebHID sendFeatureReport(reportId, data-without-id)).
  var FEATURE_SET = 0x03; // setter feature report id
  var SET_BRIGHTNESS = 0x08;
  var SET_RESET = 0x02;
  var FEATURE_UNIT_INFO = 0x08; // getter feature report id: matrix + image dims

  // Output image reports.
  var IMG_REPORT = 0x02;
  var IMG_KEY_CMD = 0x07;    // update a key image (classic + XL + Plus keys)
  var IMG_LCD_REGION = 0x0c; // draw a region of the touch LCD strip
  var PACKET_SIZE = 1024;
  var KEY_HEADER = 8;        // report,cmd,keyIndex,done,len(2),page(2) then payload
  var LCD_HEADER = 16;       // report,cmd,x(2),y(2),w(2),h(2),done,index(2),len(2),pad

  function u8(value) { return value & 0xff; }
  function i8(byte) { return byte > 127 ? byte - 256 : byte; }
  function clampInt(value, lo, hi) {
    var n = Math.round(Number(value));
    if (!Number.isFinite(n)) return lo;
    return n < lo ? lo : (n > hi ? hi : n);
  }
  function toBytes(value) {
    if (value instanceof Uint8Array) return value;
    if (value instanceof ArrayBuffer) return new Uint8Array(value);
    if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    if (value && typeof value.length === 'number') return Uint8Array.from(value);
    throw new TypeError('Stream Deck device layer expected image/report bytes.');
  }

  // ── Per-model base facts ──────────────────────────────────────────────────
  // Keyboard-only decks reuse the same numbers Outrangutan already ships. The
  // Plus family adds dials + a touch LCD. Product ids for brand-new hardware
  // (Stream Deck + XL) are not yet public, so an unknown Elgato device is
  // treated as an "adaptive Plus": modern report framing, geometry filled in
  // from the on-device Unit Information descriptor (or the owner's confirmation
  // in Connect & Learn) rather than guessed blindly.
  var KNOWN_MODELS = {
    0x0060: { name: 'Stream Deck (2017)', keys: 15, cols: 5, keyPx: 72, stateOffset: 0, rotation: 0,   reset: [0x0b, 0x63], bright: [0x05, 0x55, 0xaa, 0xd1, 0x01], dials: 0, strip: null },
    0x0063: { name: 'Stream Deck Mini',   keys: 6,  cols: 3, keyPx: 80, stateOffset: 0, rotation: 0,   reset: [0x0b, 0x63], bright: [0x05, 0x55, 0xaa, 0xd1, 0x01], dials: 0, strip: null },
    0x006d: { name: 'Stream Deck (v2)',   keys: 15, cols: 5, keyPx: 72, stateOffset: 3, rotation: 180, reset: [0x03, 0x02], bright: [0x03, 0x08], dials: 0, strip: null },
    0x0080: { name: 'Stream Deck MK.2',   keys: 15, cols: 5, keyPx: 72, stateOffset: 3, rotation: 180, reset: [0x03, 0x02], bright: [0x03, 0x08], dials: 0, strip: null },
    0x006c: { name: 'Stream Deck XL',     keys: 32, cols: 8, keyPx: 96, stateOffset: 3, rotation: 180, reset: [0x03, 0x02], bright: [0x03, 0x08], dials: 0, strip: null },
    0x0084: { name: 'Stream Deck +',      keys: 8,  cols: 4, keyPx: 120, stateOffset: 3, rotation: 0,  reset: [0x03, 0x02], bright: [0x03, 0x08], dials: 4, strip: { w: 800, h: 100, zones: 4 } }
  };

  // The Stream Deck + XL the owner is building against: 36 keys, 6 dials, a
  // 6-zone touch strip. Used when the connected Elgato device reports a product
  // id we do not recognise (the likely case until the id is published), refined
  // by the Unit Information descriptor and by Connect & Learn.
  var PLUS_XL_DEFAULT = {
    name: 'Stream Deck + XL', keys: 36, cols: 9, keyPx: 96, stateOffset: 3, rotation: 180,
    reset: [0x03, 0x02], bright: [0x03, 0x08], dials: 6,
    strip: { w: 1200, h: 100, zones: 6 }
  };

  // ── Unit Information descriptor (getter feature report 0x08) ───────────────
  // The device reports its own matrix and image dimensions. The exact layout
  // varies across firmware, so this is best-effort and self-validating: it only
  // returns a field when the number it read is sane, and the caller keeps the
  // profile default for anything missing. Never trust a zero or an absurd size.
  function parseUnitInfo(value) {
    var out = {};
    var d;
    try { d = toBytes(value); } catch (e) { return out; }
    if (!d || d.length < 8) return out;
    // Layout observed on the Plus/XL family: after the report id/echo the
    // descriptor carries small integer fields for rows, cols, key px and LCD
    // px. We scan defensively rather than hard-coding one firmware's offsets.
    var sane = function (n, lo, hi) { return Number.isFinite(n) && n >= lo && n <= hi; };
    var rd16 = function (i) { return d[i] | (d[i + 1] << 8); };
    // Rows/cols are single bytes in the low part of the descriptor.
    for (var i = 2; i < Math.min(d.length - 1, 10); i++) {
      if (!out.cols && sane(d[i], 3, 12) && sane(d[i + 1], 2, 8) && d[i] * d[i + 1] >= 6 && d[i] * d[i + 1] <= 64) {
        out.cols = d[i]; out.rows = d[i + 1]; out.keys = d[i] * d[i + 1];
        break;
      }
    }
    // Key pixel size and LCD width appear as 16-bit fields further in.
    for (var j = 8; j + 1 < d.length; j += 2) {
      var v = rd16(j);
      if (!out.keyPx && sane(v, 60, 200)) out.keyPx = v;
      else if (!out.stripW && sane(v, 400, 2000)) out.stripW = v;
    }
    return out;
  }

  // ── Profile resolution ─────────────────────────────────────────────────────
  // Fold the model base, any Unit Information the device volunteered, and any
  // learned/owner overrides into one frozen profile the rest of the driver uses.
  function makeProfile(productId, opts) {
    opts = opts || {};
    var base = KNOWN_MODELS[productId];
    var adaptive = !base;
    if (!base) base = PLUS_XL_DEFAULT;
    var info = opts.unitInfo || {};
    var ov = opts.overrides || {};
    var pick = function (key, lo, hi) {
      if (ov[key] != null && Number.isFinite(Number(ov[key]))) return Number(ov[key]);
      if (info[key] != null && Number.isFinite(Number(info[key])) && (lo == null || (info[key] >= lo && info[key] <= hi))) return Number(info[key]);
      return base[key];
    };
    var keys = pick('keys', 6, 64);
    var cols = pick('cols', 3, 12);
    var rows = Math.max(1, Math.ceil(keys / cols));
    var dials = ov.dials != null ? Number(ov.dials) : base.dials;
    var stripBase = base.strip || (adaptive ? PLUS_XL_DEFAULT.strip : null);
    var strip = null;
    if (stripBase && (ov.strip !== null)) {
      strip = {
        w: (ov.stripW || info.stripW || stripBase.w),
        h: (ov.stripH || stripBase.h),
        zones: (ov.stripZones || stripBase.zones || Math.max(dials, 1)),
        reportId: IMG_REPORT, command: IMG_LCD_REGION, packetSize: PACKET_SIZE, headerSize: LCD_HEADER
      };
    }
    return Object.freeze({
      productId: productId,
      name: ov.name || base.name,
      adaptive: adaptive,
      keys: keys, cols: cols, rows: rows,
      keyPx: pick('keyPx', 48, 240),
      stateOffset: ov.stateOffset != null ? Number(ov.stateOffset) : base.stateOffset,
      rotation: ov.rotation != null ? Number(ov.rotation) : base.rotation,
      reset: base.reset, bright: base.bright,
      dials: dials,
      strip: strip,
      keyImage: Object.freeze({ reportId: IMG_REPORT, command: IMG_KEY_CMD, packetSize: PACKET_SIZE, headerSize: KEY_HEADER })
    });
  }

  // ── Input report parsing ───────────────────────────────────────────────────
  // Turn one WebHID input report into a normalised event. reportId is accepted
  // for completeness (Elgato uses 0x01 for all input) but the discriminator we
  // trust is data[0], the command byte.
  function parseInputReport(reportId, value, profile) {
    var d;
    try { d = toBytes(value); } catch (e) { return { type: 'unknown' }; }
    if (!d.length) return { type: 'unknown' };
    var cmd = d[0];
    if (cmd === CMD_ENCODER && profile && profile.dials) {
      var contents = d[3];
      var n = profile.dials;
      if (contents === ENCODER_ROTATE) {
        var ticks = [];
        for (var r = 0; r < n; r++) ticks.push(i8(d[4 + r] || 0));
        return { type: 'dials', kind: 'rotate', ticks: ticks };
      }
      var press = [];
      for (var p = 0; p < n; p++) press.push((d[4 + p] || 0) === 1);
      return { type: 'dials', kind: 'press', press: press };
    }
    if (cmd === CMD_TOUCH && profile && profile.strip) {
      var g = d[3];
      var rd = function (i) { return (d[i] || 0) | ((d[i + 1] || 0) << 8); };
      var evt = { type: 'touch', x: rd(5), y: rd(7) };
      evt.gesture = g === TOUCH_LONG ? 'long' : (g === TOUCH_FLICK ? 'flick' : 'tap');
      if (g === TOUCH_FLICK) { evt.x2 = rd(9); evt.y2 = rd(11); }
      if (profile.strip.zones && profile.strip.w) {
        evt.zone = clampInt(Math.floor(evt.x / (profile.strip.w / profile.strip.zones)), 0, profile.strip.zones - 1);
      }
      return evt;
    }
    // Default: a key-state report. Compare against caller-held prior state.
    var off = profile ? profile.stateOffset : 3;
    var count = profile ? profile.keys : (d.length - off);
    var states = [];
    for (var k = 0; k < count; k++) states.push(d[off + k] === 1);
    return { type: 'keys', states: states };
  }

  // Diff a fresh key-state array against the previous one → rising/falling edges.
  function keyEdges(prev, next) {
    var downs = [], ups = [];
    for (var i = 0; i < next.length; i++) {
      var was = !!(prev && prev[i]);
      if (next[i] && !was) downs.push(i);
      else if (!next[i] && was) ups.push(i);
    }
    return { downs: downs, ups: ups };
  }

  // ── Image packetization ─────────────────────────────────────────────────────
  function keyImagePackets(profile, keyIndex, imageBytes) {
    var cfg = profile.keyImage;
    var bytes = toBytes(imageBytes);
    if (!bytes.length) throw new Error('Cannot send an empty key image.');
    var payloadMax = cfg.packetSize - cfg.headerSize;
    var packets = [];
    var sent = 0, page = 0;
    while (sent < bytes.length) {
      var len = Math.min(payloadMax, bytes.length - sent);
      var last = sent + len >= bytes.length;
      var packet = new Uint8Array(cfg.packetSize);
      packet[0] = cfg.reportId;
      packet[1] = cfg.command;
      packet[2] = u8(keyIndex);
      packet[3] = last ? 1 : 0;
      packet[4] = len & 0xff;
      packet[5] = (len >> 8) & 0xff;
      packet[6] = page & 0xff;
      packet[7] = (page >> 8) & 0xff;
      packet.set(bytes.subarray(sent, sent + len), cfg.headerSize);
      packets.push({ reportId: cfg.reportId, data: packet.subarray(1), page: page, last: last, length: len });
      sent += len; page += 1;
    }
    return packets;
  }

  // Draw one rectangular region of the touch LCD. The whole strip is one region
  // (x=0,y=0,w,h); a single zone is a narrower slice. Header layout follows the
  // shipping Stream Deck + protocol (report 0x02 / cmd 0x0C).
  function stripImagePackets(profile, imageBytes, region) {
    if (!profile.strip) throw new Error('This device has no touch strip.');
    var cfg = profile.strip;
    var bytes = toBytes(imageBytes);
    if (!bytes.length) throw new Error('Cannot send an empty strip image.');
    region = region || { x: 0, y: 0, w: cfg.w, h: cfg.h };
    var payloadMax = cfg.packetSize - cfg.headerSize;
    var packets = [];
    var sent = 0, index = 0;
    var w16 = function (packet, at, v) { packet[at] = v & 0xff; packet[at + 1] = (v >> 8) & 0xff; };
    while (sent < bytes.length) {
      var len = Math.min(payloadMax, bytes.length - sent);
      var last = sent + len >= bytes.length;
      var packet = new Uint8Array(cfg.packetSize);
      packet[0] = cfg.reportId;
      packet[1] = cfg.command;
      w16(packet, 2, region.x | 0);
      w16(packet, 4, region.y | 0);
      w16(packet, 6, region.w | 0);
      w16(packet, 8, region.h | 0);
      packet[10] = last ? 1 : 0;
      w16(packet, 11, index);
      w16(packet, 13, len);
      packet.set(bytes.subarray(sent, sent + len), cfg.headerSize);
      packets.push({ reportId: cfg.reportId, data: packet.subarray(1), index: index, last: last, length: len });
      sent += len; index += 1;
    }
    return packets;
  }

  function brightnessReport(profile, pct) {
    var b = profile.bright.slice();
    // Modern decks: [0x03, 0x08, level]. Classic: prebuilt vendor blob, level
    // rides where the blob expects it; we just append/replace the last byte.
    if (b[0] === FEATURE_SET && b[1] === SET_BRIGHTNESS) return { reportId: b[0], data: Uint8Array.from([b[1], clampInt(pct, 0, 100)]) };
    b.push(clampInt(pct, 0, 100));
    return { reportId: b[0], data: Uint8Array.from(b.slice(1)) };
  }
  function resetReport(profile) {
    var r = profile.reset;
    return { reportId: r[0], data: Uint8Array.from(r.slice(1)) };
  }

  return Object.freeze({
    ELGATO_VID: ELGATO_VID,
    KNOWN_MODELS: KNOWN_MODELS,
    PLUS_XL_DEFAULT: PLUS_XL_DEFAULT,
    CMD_KEYS: CMD_KEYS, CMD_TOUCH: CMD_TOUCH, CMD_ENCODER: CMD_ENCODER,
    makeProfile: makeProfile,
    parseUnitInfo: parseUnitInfo,
    parseInputReport: parseInputReport,
    keyEdges: keyEdges,
    keyImagePackets: keyImagePackets,
    stripImagePackets: stripImagePackets,
    brightnessReport: brightnessReport,
    resetReport: resetReport
  });
});
