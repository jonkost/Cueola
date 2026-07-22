/* Outrangutan Stream Deck label renderer.
 *
 * Rendering is deliberately split into two stages: a canonical, upright key
 * image and a model-owned device frame. The complete canonical image is
 * rotated exactly once while producing the device frame, immediately before
 * JPEG encoding. Canvas creation and encoding are injected so the contract is
 * testable without a DOM or third-party dependency.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.CueolaStreamDeckLabel = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var JPEG_TYPE = 'image/jpeg';
  var REPORT_ID = 0x02;
  var PACKET_SIZE = 1024;
  var HEADER_SIZE = 8;
  var PAYLOAD_SIZE = PACKET_SIZE - HEADER_SIZE;

  function profile(productId, name, keys, columns, imageSize) {
    return Object.freeze({
      productId: productId,
      name: name,
      keys: keys,
      columns: columns,
      rows: Math.ceil(keys / columns),
      imageWidth: imageSize,
      imageHeight: imageSize,
      imageType: JPEG_TYPE,
      imageQuality: 0.9,
      deviceRotationDegrees: 180,
      inputStateOffset: 3,
      packet: Object.freeze({
        reportId: REPORT_ID,
        command: 0x07,
        packetSize: PACKET_SIZE,
        headerSize: HEADER_SIZE,
        payloadSize: PAYLOAD_SIZE
      })
    });
  }

  // These are the JPEG/report-0x02 devices already supported by Outrangutan.
  // Older BMP devices intentionally remain unsupported: silently applying the
  // JPEG framing to an unknown or incompatible device is worse than refusing.
  var MODEL_PROFILES = Object.freeze({
    0x006d: profile(0x006d, 'Stream Deck (v2)', 15, 5, 72),
    0x0080: profile(0x0080, 'Stream Deck MK.2', 15, 5, 72),
    0x006c: profile(0x006c, 'Stream Deck XL', 32, 8, 96)
  });
  var SUPPORTED_PRODUCT_IDS = Object.freeze([0x006d, 0x0080, 0x006c]);

  // Runtime-registered models (e.g. a probed Stream Deck + XL whose product id
  // is newer than this table). These are consulted before the static table and
  // never mutate it, so Outrangutan's built-in devices are unaffected.
  var RUNTIME_PROFILES = {};
  function registerModel(spec) {
    if (!spec || !Number.isInteger(spec.productId)) throw new TypeError('registerModel needs an integer productId.');
    var columns = spec.columns || spec.cols || 5;
    var keys = spec.keys || 15;
    var size = spec.imageWidth || spec.imageSize || 72;
    var pkt = spec.packet || {};
    var packetSize = pkt.packetSize || PACKET_SIZE;
    var headerSize = pkt.headerSize || HEADER_SIZE;
    var prof = Object.freeze({
      productId: spec.productId,
      name: spec.name || ('Stream Deck 0x' + spec.productId.toString(16)),
      keys: keys, columns: columns, rows: Math.ceil(keys / columns),
      imageWidth: size, imageHeight: spec.imageHeight || size,
      imageType: spec.imageType || JPEG_TYPE,
      imageQuality: spec.imageQuality || 0.9,
      deviceRotationDegrees: spec.deviceRotationDegrees == null ? 180 : spec.deviceRotationDegrees,
      inputStateOffset: spec.inputStateOffset == null ? 3 : spec.inputStateOffset,
      packet: Object.freeze({
        reportId: pkt.reportId || REPORT_ID,
        command: pkt.command || 0x07,
        packetSize: packetSize,
        headerSize: headerSize,
        payloadSize: packetSize - headerSize
      })
    });
    RUNTIME_PROFILES[spec.productId] = prof;
    return prof;
  }

  function productIdOf(value) {
    if (typeof value === 'number' && Number.isInteger(value)) return value;
    if (value && typeof value === 'object' && Number.isInteger(value.productId)) return value.productId;
    return NaN;
  }

  function supportsModel(value) {
    var pid = productIdOf(value);
    return Object.prototype.hasOwnProperty.call(RUNTIME_PROFILES, pid)
      || Object.prototype.hasOwnProperty.call(MODEL_PROFILES, pid);
  }

  function getModelProfile(value) {
    var productId = productIdOf(value);
    var result = RUNTIME_PROFILES[productId] || MODEL_PROFILES[productId];
    if (!result) {
      var printable = Number.isFinite(productId) ? '0x' + productId.toString(16).padStart(4, '0') : String(value);
      throw new Error('Unsupported Stream Deck model: ' + printable + '. No device image was sent.');
    }
    return result;
  }

  function assertKeyIndex(model, keyIndex) {
    if (!Number.isInteger(keyIndex) || keyIndex < 0 || keyIndex >= model.keys) {
      throw new RangeError('Stream Deck key index ' + String(keyIndex) + ' is outside ' + model.name + ' (0-' + (model.keys - 1) + ').');
    }
    return keyIndex;
  }

  function finite(value, fallback) {
    var number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  function resetContext(ctx, width, height) {
    if (!ctx || typeof ctx.setTransform !== 'function' || typeof ctx.clearRect !== 'function') {
      throw new Error('Stream Deck label rendering requires a 2D canvas context.');
    }
    // This pair must be the first canvas operations on every render target.
    // It makes repeated rendering deterministic even if a supplied canvas was
    // previously left with a transform by unrelated code.
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, width, height);
  }

  function splitLongToken(ctx, token, maxWidth) {
    var chunks = [];
    var current = '';
    Array.from(token).forEach(function (character) {
      var candidate = current + character;
      if (current && ctx.measureText(candidate).width > maxWidth) {
        chunks.push(current);
        current = character;
      } else {
        current = candidate;
      }
    });
    if (current) chunks.push(current);
    return chunks.length ? chunks : [''];
  }

  function ellipsize(ctx, text, maxWidth) {
    var suffix = '\u2026';
    var value = String(text == null ? '' : text);
    while (value && ctx.measureText(value + suffix).width > maxWidth) {
      value = Array.from(value).slice(0, -1).join('');
    }
    return value + suffix;
  }

  function wrapText(ctx, text, maxWidth, maxLines) {
    var width = Math.max(1, finite(maxWidth, 1));
    var limit = Math.max(1, Math.floor(finite(maxLines, 1)));
    var allLines = [];
    String(text == null ? '' : text).split(/\r?\n/).forEach(function (paragraph) {
      var words = paragraph.trim().split(/\s+/).filter(Boolean);
      var current = '';
      if (!words.length) {
        allLines.push('');
        return;
      }
      words.forEach(function (word) {
        var pieces = ctx.measureText(word).width > width ? splitLongToken(ctx, word, width) : [word];
        pieces.forEach(function (piece, pieceIndex) {
          var joinWithSpace = current && pieceIndex === 0;
          var candidate = current ? current + (joinWithSpace ? ' ' : '') + piece : piece;
          if (current && ctx.measureText(candidate).width > width) {
            allLines.push(current);
            current = piece;
          } else {
            current = candidate;
          }
          if (pieceIndex < pieces.length - 1) {
            allLines.push(current);
            current = '';
          }
        });
      });
      if (current || !allLines.length) allLines.push(current);
    });

    var overflowed = allLines.length > limit;
    var lines = allLines.slice(0, limit);
    if (overflowed) lines[lines.length - 1] = ellipsize(ctx, lines[lines.length - 1], width);
    return Object.freeze({ lines: Object.freeze(lines), overflowed: overflowed });
  }

  function createRenderer(options) {
    options = options || {};
    if (typeof options.createCanvas !== 'function') throw new TypeError('createCanvas(width, height) is required.');
    if (typeof options.encode !== 'function') throw new TypeError('encode(canvas, options) is required.');
    var createCanvas = options.createCanvas;
    var encode = options.encode;

    function canvasFor(model) {
      var canvas = createCanvas(model.imageWidth, model.imageHeight);
      if (!canvas || typeof canvas.getContext !== 'function') throw new Error('createCanvas() must return a canvas-like object.');
      canvas.width = model.imageWidth;
      canvas.height = model.imageHeight;
      return canvas;
    }

    function drawIcon(ctx, icon, x, y, size) {
      if (icon == null || icon === '') return false;
      if (typeof icon === 'string' || typeof icon === 'number') {
        ctx.font = '700 ' + Math.round(size) + 'px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
        ctx.fillText(String(icon), x, y);
        return true;
      }
      var source = icon && icon.image ? icon.image : icon;
      if (source && typeof ctx.drawImage === 'function') {
        ctx.drawImage(source, x - size / 2, y - size / 2, size, size);
        return true;
      }
      throw new TypeError('A Stream Deck icon must be text or a canvas image source.');
    }

    function renderCanonical(modelValue, descriptor) {
      var model = getModelProfile(modelValue);
      var data = descriptor && typeof descriptor === 'object' ? descriptor : {};
      var width = model.imageWidth;
      var height = model.imageHeight;
      var canvas = canvasFor(model);
      var ctx = canvas.getContext('2d');
      resetContext(ctx, width, height);

      var active = data.active === true;
      var text = String(data.text == null ? '' : data.text).trim();
      var hasIcon = data.icon != null && data.icon !== '';
      var background = data.backgroundColor || (active ? '#17653a' : '#101418');
      var foreground = data.color || '#ffffff';
      var padding = Math.max(4, Math.round(width * 0.08));
      var maxTextWidth = width - (padding * 2);
      var fontSize = Math.max(9, Math.round(width * (hasIcon ? 0.145 : 0.16)));
      var lineHeight = Math.round(fontSize * 1.16);
      var maxLines = Math.max(1, Math.floor(finite(data.maxLines, hasIcon ? 2 : 3)));
      var wrapped = Object.freeze({ lines: Object.freeze([]), overflowed: false });

      ctx.save();
      try {
        ctx.fillStyle = background;
        ctx.fillRect(0, 0, width, height);
        if (active && typeof ctx.strokeRect === 'function') {
          ctx.strokeStyle = data.accentColor || '#6ff0a5';
          ctx.lineWidth = Math.max(2, Math.round(width * 0.04));
          var inset = ctx.lineWidth / 2;
          ctx.strokeRect(inset, inset, width - ctx.lineWidth, height - ctx.lineWidth);
        }

        ctx.fillStyle = foreground;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        if (hasIcon) {
          var iconSize = width * (text ? 0.28 : 0.43);
          var iconY = text ? height * 0.28 : height * 0.5;
          drawIcon(ctx, data.icon, width / 2, iconY, iconSize);
        }
        if (text) {
          ctx.font = '700 ' + fontSize + 'px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
          wrapped = wrapText(ctx, text, maxTextWidth, maxLines);
          var centerY = hasIcon ? height * 0.69 : height * 0.5;
          var firstY = centerY - ((wrapped.lines.length - 1) * lineHeight / 2);
          wrapped.lines.forEach(function (line, index) {
            ctx.fillText(line, width / 2, firstY + (index * lineHeight), maxTextWidth);
          });
        }
      } finally {
        ctx.restore();
      }

      return { canvas: canvas, layout: wrapped, active: active, model: model };
    }

    function createDeviceFrame(modelValue, canonicalCanvas) {
      var model = getModelProfile(modelValue);
      if (!canonicalCanvas || typeof canonicalCanvas.getContext !== 'function') {
        throw new TypeError('A canonical canvas is required for Stream Deck device conversion.');
      }
      var width = model.imageWidth;
      var height = model.imageHeight;
      var canvas = canvasFor(model);
      var ctx = canvas.getContext('2d');
      resetContext(ctx, width, height);
      ctx.save();
      try {
        // The device orientation belongs to the model profile. Apply it once to
        // the completed canonical image; label/layout code never rotates.
        ctx.translate(width, height);
        ctx.rotate(model.deviceRotationDegrees * Math.PI / 180);
        ctx.drawImage(canonicalCanvas, 0, 0, width, height);
      } finally {
        ctx.restore();
      }
      return { canvas: canvas, model: model };
    }

    async function encodedBytes(canvas, model) {
      var encoded = await encode(canvas, {
        type: model.imageType,
        quality: model.imageQuality,
        productId: model.productId,
        profile: model
      });
      if (encoded && typeof encoded.arrayBuffer === 'function') encoded = await encoded.arrayBuffer();
      var bytes;
      if (encoded instanceof Uint8Array) bytes = new Uint8Array(encoded);
      else if (encoded instanceof ArrayBuffer) bytes = new Uint8Array(encoded.slice(0));
      else if (ArrayBuffer.isView(encoded)) bytes = new Uint8Array(encoded.buffer.slice(encoded.byteOffset, encoded.byteOffset + encoded.byteLength));
      else throw new TypeError('encode() must resolve to bytes, an ArrayBuffer, or a Blob-like value.');
      if (!bytes.length) throw new Error('Stream Deck JPEG encoder returned an empty image.');
      return bytes;
    }

    async function renderKeyImage(modelValue, keyIndex, descriptor) {
      var model = getModelProfile(modelValue);
      assertKeyIndex(model, keyIndex);
      var canonical = renderCanonical(model.productId, descriptor);
      var deviceFrame = createDeviceFrame(model.productId, canonical.canvas);
      var bytes = await encodedBytes(deviceFrame.canvas, model);
      return {
        model: model,
        keyIndex: keyIndex,
        canonicalCanvas: canonical.canvas,
        deviceCanvas: deviceFrame.canvas,
        layout: canonical.layout,
        active: canonical.active,
        bytes: bytes
      };
    }

    async function renderAndPacketize(modelValue, keyIndex, descriptor) {
      var rendered = await renderKeyImage(modelValue, keyIndex, descriptor);
      rendered.packets = packetize(rendered.model.productId, keyIndex, rendered.bytes);
      return rendered;
    }

    return Object.freeze({
      renderCanonical: renderCanonical,
      createDeviceFrame: createDeviceFrame,
      renderKeyImage: renderKeyImage,
      renderAndPacketize: renderAndPacketize
    });
  }

  function toBytes(value) {
    if (value instanceof Uint8Array) return value;
    if (value instanceof ArrayBuffer) return new Uint8Array(value);
    if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    throw new TypeError('Stream Deck packetization requires encoded image bytes.');
  }

  function packetize(modelValue, keyIndex, encodedImage) {
    var model = getModelProfile(modelValue);
    assertKeyIndex(model, keyIndex);
    var bytes = toBytes(encodedImage);
    if (!bytes.length) throw new Error('Cannot packetize an empty Stream Deck image.');
    var config = model.packet;
    var packets = [];
    var page = 0;
    var sent = 0;
    while (sent < bytes.length) {
      var chunkLength = Math.min(config.payloadSize, bytes.length - sent);
      var last = sent + chunkLength >= bytes.length;
      var packet = new Uint8Array(config.packetSize);
      packet[0] = config.reportId;
      packet[1] = config.command;
      packet[2] = keyIndex;
      packet[3] = last ? 1 : 0;
      packet[4] = chunkLength & 0xff;
      packet[5] = (chunkLength >> 8) & 0xff;
      packet[6] = page & 0xff;
      packet[7] = (page >> 8) & 0xff;
      packet.set(bytes.subarray(sent, sent + chunkLength), config.headerSize);
      packets.push(Object.freeze({
        reportId: config.reportId,
        data: packet.subarray(1),
        packet: packet,
        keyIndex: keyIndex,
        page: page,
        last: last,
        payloadLength: chunkLength
      }));
      sent += chunkLength;
      page += 1;
    }
    return Object.freeze(packets);
  }

  return Object.freeze({
    JPEG_TYPE: JPEG_TYPE,
    MODEL_PROFILES: MODEL_PROFILES,
    SUPPORTED_PRODUCT_IDS: SUPPORTED_PRODUCT_IDS,
    supportsModel: supportsModel,
    getModelProfile: getModelProfile,
    registerModel: registerModel,
    wrapText: wrapText,
    packetize: packetize,
    createRenderer: createRenderer
  });
});
