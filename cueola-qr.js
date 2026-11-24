/* Cueola QR code.
 *
 * Draws the square code a phone or iPad camera can read, so a device can
 * link to a show by pointing at a screen instead of typing a code
 * ("Scan to link"). Nothing is sent anywhere: the picture is worked out
 * right here from the text.
 *
 * It makes one kind of code on purpose: plain bytes, medium error
 * correction, sizes 1 to 9 (up to 180 characters, plenty for a link).
 * No DOM in here, so Node can test it. svg() only builds a string.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.CueolaQR = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // Per size (version): error-correction bytes per block, then the blocks as
  // [how many, data bytes each]. Medium level.
  var BLOCKS = [null,
    { ec: 10, groups: [[1, 16]] },
    { ec: 16, groups: [[1, 28]] },
    { ec: 26, groups: [[1, 44]] },
    { ec: 18, groups: [[2, 32]] },
    { ec: 24, groups: [[2, 43]] },
    { ec: 16, groups: [[4, 27]] },
    { ec: 18, groups: [[4, 31]] },
    { ec: 22, groups: [[2, 38], [2, 39]] },
    { ec: 22, groups: [[3, 36], [2, 37]] }
  ];
  var ALIGN = [null, [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46]];
  var MAX_VERSION = 9;

  function dataCapacity(v) {
    return BLOCKS[v].groups.reduce(function (n, g) { return n + g[0] * g[1]; }, 0);
  }

  function utf8(text) {
    var s = unescape(encodeURIComponent(String(text == null ? '' : text)));
    var out = [];
    for (var i = 0; i < s.length; i++) out.push(s.charCodeAt(i));
    return out;
  }

  // Arithmetic the error correction needs (a field of 256 values).
  var EXP = [], LOG = [];
  (function () {
    var x = 1;
    for (var i = 0; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 0x100) x ^= 0x11D; }
    for (var j = 255; j < 512; j++) EXP[j] = EXP[j - 255];
  })();
  function mul(a, b) { return a && b ? EXP[LOG[a] + LOG[b]] : 0; }
  function generator(degree) {
    var g = [1];
    for (var i = 0; i < degree; i++) {
      var next = [];
      for (var j = 0; j <= g.length; j++) next[j] = (j < g.length ? mul(g[j], EXP[i]) : 0) ^ (j > 0 ? g[j - 1] : 0);
      g = next;
    }
    return g; // low power first, length degree + 1
  }
  function remainder(data, degree) {
    var gen = generator(degree);
    var rem = [];
    for (var i = 0; i < degree; i++) rem.push(0);
    data.forEach(function (b) {
      var factor = b ^ rem[degree - 1];
      for (var j = degree - 1; j > 0; j--) rem[j] = rem[j - 1] ^ mul(gen[j], factor);
      rem[0] = mul(gen[0], factor);
    });
    return rem.reverse();
  }

  // The text as the full run of bytes the code carries: data, then padding,
  // split into blocks, each with its error correction, woven together.
  function codewords(bytes, v) {
    var cap = dataCapacity(v);
    var bits = [];
    function push(value, len) { for (var i = len - 1; i >= 0; i--) bits.push((value >>> i) & 1); }
    push(4, 4);
    push(bytes.length, 8);
    bytes.forEach(function (b) { push(b, 8); });
    for (var t = 0; t < 4 && bits.length < cap * 8; t++) bits.push(0);
    while (bits.length % 8) bits.push(0);
    var data = [];
    for (var i = 0; i < bits.length; i += 8) {
      var b = 0;
      for (var k = 0; k < 8; k++) b = (b << 1) | bits[i + k];
      data.push(b);
    }
    for (var pad = 0xEC; data.length < cap; pad ^= 0xEC ^ 0x11) data.push(pad);

    var spec = BLOCKS[v], blocks = [], at = 0;
    spec.groups.forEach(function (g) {
      for (var n = 0; n < g[0]; n++) {
        var d = data.slice(at, at + g[1]);
        at += g[1];
        blocks.push({ d: d, e: remainder(d, spec.ec) });
      }
    });
    var out = [], longest = 0;
    blocks.forEach(function (bl) { longest = Math.max(longest, bl.d.length); });
    for (var c = 0; c < longest; c++) blocks.forEach(function (bl) { if (c < bl.d.length) out.push(bl.d[c]); });
    for (var e = 0; e < spec.ec; e++) blocks.forEach(function (bl) { out.push(bl.e[e]); });
    return out;
  }

  // The finished square: rows of true (dark) and false (light).
  function matrix(text) {
    var bytes = utf8(text);
    var v = 0;
    for (var n = 1; n <= MAX_VERSION; n++) { if (bytes.length + 2 <= dataCapacity(n)) { v = n; break; } }
    if (!v) return null; // too long for a code a camera reads easily
    var size = 17 + 4 * v;
    var dark = [], fixed = [];
    for (var r = 0; r < size; r++) { dark.push(new Array(size).fill(false)); fixed.push(new Array(size).fill(false)); }
    function set(x, y, on) { dark[y][x] = !!on; fixed[y][x] = true; }

    // Timing lines.
    for (var i = 0; i < size; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
    // The three corner squares, each with a light border.
    [[3, 3], [size - 4, 3], [3, size - 4]].forEach(function (c) {
      for (var dy = -4; dy <= 4; dy++) for (var dx = -4; dx <= 4; dx++) {
        var x = c[0] + dx, y = c[1] + dy;
        if (x < 0 || x >= size || y < 0 || y >= size) continue;
        var dist = Math.max(Math.abs(dx), Math.abs(dy));
        set(x, y, dist !== 2 && dist !== 4);
      }
    });
    // The small squares.
    var al = ALIGN[v];
    for (var a = 0; a < al.length; a++) for (var b2 = 0; b2 < al.length; b2++) {
      if ((a === 0 && b2 === 0) || (a === 0 && b2 === al.length - 1) || (a === al.length - 1 && b2 === 0)) continue;
      for (var ey = -2; ey <= 2; ey++) for (var ex = -2; ex <= 2; ex++) {
        set(al[a] + ex, al[b2] + ey, Math.max(Math.abs(ex), Math.abs(ey)) !== 1);
      }
    }
    // Format bits (medium level, mask 0), kept clear of data and drawn below.
    function format(mask) {
      var d = mask; // medium level is 00
      var rem = d;
      for (var k = 0; k < 10; k++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
      var bits = ((d << 10) | rem) ^ 0x5412;
      function bit(n) { return ((bits >>> n) & 1) === 1; }
      for (var p = 0; p <= 5; p++) set(8, p, bit(p));
      set(8, 7, bit(6)); set(8, 8, bit(7)); set(7, 8, bit(8));
      for (var q = 9; q < 15; q++) set(14 - q, 8, bit(q));
      for (var s = 0; s < 8; s++) set(size - 1 - s, 8, bit(s));
      for (var u = 8; u < 15; u++) set(8, size - 15 + u, bit(u));
      set(8, size - 8, true);
    }
    format(0);
    // Size bits (sizes 7 and up).
    if (v >= 7) {
      var rem2 = v;
      for (var w = 0; w < 12; w++) rem2 = (rem2 << 1) ^ ((rem2 >>> 11) * 0x1F25);
      var vbits = (v << 12) | rem2;
      for (var z = 0; z < 18; z++) {
        var on = ((vbits >>> z) & 1) === 1;
        var aa = size - 11 + (z % 3), bb = Math.floor(z / 3);
        set(aa, bb, on); set(bb, aa, on);
      }
    }
    // The data, in a zigzag from the bottom right corner.
    var data = codewords(bytes, v);
    var idx = 0;
    for (var right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (var vert = 0; vert < size; vert++) {
        for (var j = 0; j < 2; j++) {
          var x2 = right - j;
          var upward = ((right + 1) & 2) === 0;
          var y2 = upward ? size - 1 - vert : vert;
          if (fixed[y2][x2]) continue;
          var value = idx < data.length * 8 ? ((data[idx >>> 3] >>> (7 - (idx & 7))) & 1) === 1 : false;
          idx++;
          // Mask 0: flip every other module so the picture has no big blobs.
          dark[y2][x2] = value !== ((x2 + y2) % 2 === 0);
        }
      }
    }
    return dark;
  }

  // The code as an SVG picture. Dark on white with the quiet border a camera
  // needs. opts: { size: pixels, label: text for screen readers }
  function svg(text, opts) {
    opts = opts || {};
    var m = matrix(text);
    if (!m) return '';
    var n = m.length, quiet = 4, total = n + quiet * 2;
    var path = '';
    for (var y = 0; y < n; y++) for (var x = 0; x < n; x++) if (m[y][x]) path += 'M' + (x + quiet) + ' ' + (y + quiet) + 'h1v1h-1z';
    var px = Number(opts.size) || 220;
    var label = String(opts.label || 'Code to scan').replace(/[<>&"]/g, '');
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + total + ' ' + total + '" width="' + px + '" height="' + px +
      '" role="img" aria-label="' + label + '" shape-rendering="crispEdges"><rect width="' + total + '" height="' + total +
      '" fill="#fff"/><path d="' + path + '" fill="#000"/></svg>';
  }

  return { matrix: matrix, svg: svg, MAX_CHARS: dataCapacity(MAX_VERSION) - 2 };
});
