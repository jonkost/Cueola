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

  var LCD_HEADER_SIZE = 16;

  function profile(productId, name, keys, columns, imageSize, extras) {
    extras = extras || {};
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
      deviceRotationDegrees: extras.rotationDegrees == null ? 180 : extras.rotationDegrees,
      inputStateOffset: 3,
      encoders: extras.encoders || 0,
      lcd: extras.lcd || null,
      packet: Object.freeze({
        reportId: REPORT_ID,
        command: 0x07,
        packetSize: PACKET_SIZE,
        headerSize: HEADER_SIZE,
        payloadSize: PAYLOAD_SIZE
      })
    });
  }

  // The Stream Deck + touch strip: one 800×100 JPEG panel over four dials.
  // Uploads use report 0x02 command 0x0c with a 16-byte region header; the
  // strip renders upright (no device rotation, unlike gen-2 key images).
  function lcdProfile(width, height, segments) {
    return Object.freeze({
      width: width,
      height: height,
      segments: segments,
      segmentWidth: width / segments,
      imageType: JPEG_TYPE,
      imageQuality: 0.9,
      packet: Object.freeze({
        reportId: REPORT_ID,
        command: 0x0c,
        packetSize: PACKET_SIZE,
        headerSize: LCD_HEADER_SIZE,
        payloadSize: PACKET_SIZE - LCD_HEADER_SIZE
      })
    });
  }

  // These are the JPEG/report-0x02 devices already supported by Outrangutan.
  // Older BMP devices intentionally remain unsupported: silently applying the
  // JPEG framing to an unknown or incompatible device is worse than refusing.
  var MODEL_PROFILES = Object.freeze({
    0x006d: profile(0x006d, 'Stream Deck (v2)', 15, 5, 72),
    0x0080: profile(0x0080, 'Stream Deck MK.2', 15, 5, 72),
    0x006c: profile(0x006c, 'Stream Deck XL', 32, 8, 96),
    0x0084: profile(0x0084, 'Stream Deck +', 8, 4, 120, {
      rotationDegrees: 0,
      encoders: 4,
      lcd: lcdProfile(800, 100, 4)
    })
  });
  var SUPPORTED_PRODUCT_IDS = Object.freeze([0x006d, 0x0080, 0x006c, 0x0084]);

  function productIdOf(value) {
    if (typeof value === 'number' && Number.isInteger(value)) return value;
    if (value && typeof value === 'object' && Number.isInteger(value.productId)) return value.productId;
    return NaN;
  }

  function supportsModel(value) {
    return Object.prototype.hasOwnProperty.call(MODEL_PROFILES, productIdOf(value));
  }

  function getModelProfile(value) {
    var productId = productIdOf(value);
    var result = MODEL_PROFILES[productId];
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
        // the completed canonical image; label/layout code never rotates. A 0°
        // model (Stream Deck +) copies the canonical frame untransformed.
        if (model.deviceRotationDegrees % 360 !== 0) {
          ctx.translate(width, height);
          ctx.rotate(model.deviceRotationDegrees * Math.PI / 180);
        }
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

    // The touch strip is one canvas of `lcd.segments` equal cells, one per
    // dial: a small title, a large value, and an accent bar when active. The
    // strip is upright on the device — no rotation stage exists for it.
    function renderLcdStrip(modelValue, segments) {
      var model = getModelProfile(modelValue);
      var lcd = getLcdProfile(model.productId);
      var list = Array.isArray(segments) ? segments : [];
      var canvas = createCanvas(lcd.width, lcd.height);
      if (!canvas || typeof canvas.getContext !== 'function') throw new Error('createCanvas() must return a canvas-like object.');
      canvas.width = lcd.width;
      canvas.height = lcd.height;
      var ctx = canvas.getContext('2d');
      resetContext(ctx, lcd.width, lcd.height);
      var cellWidth = lcd.segmentWidth;
      ctx.save();
      try {
        ctx.fillStyle = '#080b10';
        ctx.fillRect(0, 0, lcd.width, lcd.height);
        for (var i = 0; i < lcd.segments; i++) {
          var data = list[i] && typeof list[i] === 'object' ? list[i] : {};
          var active = data.active === true;
          var x = i * cellWidth;
          var pad = Math.round(cellWidth * 0.06);
          var maxWidth = cellWidth - pad * 2;
          ctx.fillStyle = data.backgroundColor || (active ? '#17653a' : '#101418');
          ctx.fillRect(x + 2, 2, cellWidth - 4, lcd.height - 4);
          if (active) {
            ctx.fillStyle = data.accentColor || '#6ff0a5';
            ctx.fillRect(x + 2, lcd.height - 8, cellWidth - 4, 6);
          }
          ctx.fillStyle = data.color || '#ffffff';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          var title = String(data.title == null ? '' : data.title).trim();
          var value = String(data.value == null ? '' : data.value).trim();
          if (title) {
            ctx.font = '600 18px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
            if (ctx.measureText(title).width > maxWidth) title = ellipsize(ctx, title, maxWidth);
            ctx.fillText(title, x + cellWidth / 2, value ? lcd.height * 0.26 : lcd.height * 0.5, maxWidth);
          }
          if (value) {
            ctx.font = '700 32px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
            if (ctx.measureText(value).width > maxWidth) value = ellipsize(ctx, value, maxWidth);
            ctx.fillText(value, x + cellWidth / 2, title ? lcd.height * 0.64 : lcd.height * 0.5, maxWidth);
          }
        }
      } finally {
        ctx.restore();
      }
      return { canvas: canvas, model: model, lcd: lcd };
    }

    async function renderAndPacketizeLcd(modelValue, segments) {
      var strip = renderLcdStrip(modelValue, segments);
      var encoded = await encode(strip.canvas, {
        type: strip.lcd.imageType,
        quality: strip.lcd.imageQuality,
        productId: strip.model.productId,
        profile: strip.model
      });
      if (encoded && typeof encoded.arrayBuffer === 'function') encoded = await encoded.arrayBuffer();
      var bytes = toBytes(encoded instanceof ArrayBuffer ? new Uint8Array(encoded) : encoded);
      if (!bytes.length) throw new Error('Stream Deck touch strip JPEG encoder returned an empty image.');
      strip.bytes = bytes;
      strip.packets = packetizeLcd(strip.model.productId, { x: 0, y: 0, width: strip.lcd.width, height: strip.lcd.height }, bytes);
      return strip;
    }

    return Object.freeze({
      renderCanonical: renderCanonical,
      createDeviceFrame: createDeviceFrame,
      renderKeyImage: renderKeyImage,
      renderAndPacketize: renderAndPacketize,
      renderLcdStrip: renderLcdStrip,
      renderAndPacketizeLcd: renderAndPacketizeLcd
    });
  }

  function toBytes(value) {
    if (value instanceof Uint8Array) return value;
    if (value instanceof ArrayBuffer) return new Uint8Array(value);
    if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    throw new TypeError('Stream Deck packetization requires encoded image bytes.');
  }

  function getLcdProfile(value) {
    var model = getModelProfile(value);
    if (!model.lcd) throw new Error(model.name + ' has no touch strip. No LCD image was sent.');
    return model.lcd;
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

  // Touch strip upload framing (verified against Elgato's published protocol):
  // 1024-byte packets, 16-byte header — 0x02, 0x0c, x u16LE, y u16LE,
  // width u16LE, height u16LE, isLast u8, page u16LE, payloadLength u16LE, 0.
  function packetizeLcd(modelValue, region, encodedImage) {
    var model = getModelProfile(modelValue);
    var lcd = getLcdProfile(model.productId);
    var rect = region && typeof region === 'object' ? region : {};
    var x = finite(rect.x, 0), y = finite(rect.y, 0);
    var width = finite(rect.width, lcd.width), height = finite(rect.height, lcd.height);
    if (x < 0 || y < 0 || width < 1 || height < 1 || x + width > lcd.width || y + height > lcd.height) {
      throw new RangeError('Touch strip region ' + width + 'x' + height + '@' + x + ',' + y + ' is outside the ' + model.name + ' LCD (' + lcd.width + 'x' + lcd.height + ').');
    }
    var bytes = toBytes(encodedImage);
    if (!bytes.length) throw new Error('Cannot packetize an empty Stream Deck touch strip image.');
    var config = lcd.packet;
    var packets = [];
    var page = 0;
    var sent = 0;
    while (sent < bytes.length) {
      var chunkLength = Math.min(config.payloadSize, bytes.length - sent);
      var last = sent + chunkLength >= bytes.length;
      var packet = new Uint8Array(config.packetSize);
      packet[0] = config.reportId;
      packet[1] = config.command;
      packet[2] = x & 0xff;
      packet[3] = (x >> 8) & 0xff;
      packet[4] = y & 0xff;
      packet[5] = (y >> 8) & 0xff;
      packet[6] = width & 0xff;
      packet[7] = (width >> 8) & 0xff;
      packet[8] = height & 0xff;
      packet[9] = (height >> 8) & 0xff;
      packet[10] = last ? 1 : 0;
      packet[11] = page & 0xff;
      packet[12] = (page >> 8) & 0xff;
      packet[13] = chunkLength & 0xff;
      packet[14] = (chunkLength >> 8) & 0xff;
      packet.set(bytes.subarray(sent, sent + chunkLength), config.headerSize);
      packets.push(Object.freeze({
        reportId: config.reportId,
        data: packet.subarray(1),
        packet: packet,
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
    getLcdProfile: getLcdProfile,
    wrapText: wrapText,
    packetize: packetize,
    packetizeLcd: packetizeLcd,
    createRenderer: createRenderer
  });
});
