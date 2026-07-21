import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const StreamDeckLabel = require('../../outrangutan/stream-deck-label.js');

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

function fakeCanvasFactory() {
  const canvases = [];
  function createCanvas(width, height) {
    const operations = [];
    const state = [];
    const context = {
      operations,
      fillStyle: '', strokeStyle: '', lineWidth: 1, font: '', textAlign: '', textBaseline: '',
      setTransform(...args) { operations.push(['setTransform', ...args]); },
      clearRect(...args) { operations.push(['clearRect', ...args]); },
      save() { state.push(true); operations.push(['save']); },
      restore() {
        assert.ok(state.length, 'restore must have a paired save');
        state.pop(); operations.push(['restore']);
      },
      fillRect(...args) { operations.push(['fillRect', ...args, this.fillStyle]); },
      strokeRect(...args) { operations.push(['strokeRect', ...args]); },
      fillText(...args) { operations.push(['fillText', ...args]); },
      drawImage(...args) { operations.push(['drawImage', ...args]); },
      translate(...args) { operations.push(['translate', ...args]); },
      rotate(...args) { operations.push(['rotate', ...args]); },
      measureText(value) { return { width: Array.from(String(value)).length * 7 }; },
      depth() { return state.length; }
    };
    const canvas = {
      width,
      height,
      operations,
      context,
      getContext(kind) { return kind === '2d' ? context : null; }
    };
    canvases.push(canvas);
    return canvas;
  }
  return { canvases, createCanvas };
}

function harness(encodedSize = 2200) {
  const fake = fakeCanvasFactory();
  const encodes = [];
  const renderer = StreamDeckLabel.createRenderer({
    createCanvas: fake.createCanvas,
    encode: async (canvas, options) => {
      encodes.push({ canvas, options });
      return new Uint8Array(encodedSize).map((_, index) => index & 0xff);
    }
  });
  return { ...fake, encodes, renderer };
}

function names(canvas) { return canvas.operations.map(operation => operation[0]); }
function calls(canvas, operation) { return canvas.operations.filter(entry => entry[0] === operation); }

test('publishes immutable, explicit JPEG profiles and fails closed for unknown models', () => {
  assert.deepEqual(Array.from(StreamDeckLabel.SUPPORTED_PRODUCT_IDS), [0x006d, 0x0080, 0x006c, 0x0084]);
  const expected = {
    0x006d: { keys: 15, columns: 5, imageWidth: 72, rotation: 180 },
    0x0080: { keys: 15, columns: 5, imageWidth: 72, rotation: 180 },
    0x006c: { keys: 32, columns: 8, imageWidth: 96, rotation: 180 },
    0x0084: { keys: 8, columns: 4, imageWidth: 120, rotation: 0 }
  };
  for (const productId of StreamDeckLabel.SUPPORTED_PRODUCT_IDS) {
    const model = StreamDeckLabel.getModelProfile(productId);
    assert.equal(model.productId, productId);
    assert.equal(model.keys, expected[productId].keys);
    assert.equal(model.columns, expected[productId].columns);
    assert.equal(model.imageWidth, expected[productId].imageWidth);
    assert.equal(model.imageType, 'image/jpeg');
    assert.equal(model.deviceRotationDegrees, expected[productId].rotation);
    assert.ok(Object.isFrozen(model));
    assert.ok(Object.isFrozen(model.packet));
    assert.equal(StreamDeckLabel.supportsModel({ productId }), true);
  }
  assert.equal(StreamDeckLabel.supportsModel(0x0060), false);
  assert.equal(StreamDeckLabel.supportsModel(0x9999), false);
  assert.throws(() => StreamDeckLabel.getModelProfile(0x0060), /unsupported.+no device image was sent/i);
  assert.throws(() => StreamDeckLabel.getModelProfile({ productId: 0x9999 }), /unsupported/i);
});

test('only the Stream Deck + declares dials and a touch strip, with a frozen LCD contract', () => {
  for (const productId of [0x006d, 0x0080, 0x006c]) {
    const model = StreamDeckLabel.getModelProfile(productId);
    assert.equal(model.encoders, 0);
    assert.equal(model.lcd, null);
    assert.throws(() => StreamDeckLabel.getLcdProfile(productId), /no touch strip/i);
  }
  const plus = StreamDeckLabel.getModelProfile(0x0084);
  assert.equal(plus.encoders, 4);
  const lcd = StreamDeckLabel.getLcdProfile(0x0084);
  assert.equal(lcd, plus.lcd);
  assert.ok(Object.isFrozen(lcd));
  assert.ok(Object.isFrozen(lcd.packet));
  assert.equal(lcd.width, 800);
  assert.equal(lcd.height, 100);
  assert.equal(lcd.segments, 4);
  assert.equal(lcd.segmentWidth, 200);
  assert.equal(lcd.imageType, 'image/jpeg');
  assert.deepEqual({ ...lcd.packet }, { reportId: 0x02, command: 0x0c, packetSize: 1024, headerSize: 16, payloadSize: 1008 });
});

test('requires dependency-injected canvas and encoder boundaries', () => {
  assert.throws(() => StreamDeckLabel.createRenderer(), /createCanvas/i);
  assert.throws(() => StreamDeckLabel.createRenderer({ createCanvas() {} }), /encode/i);
  assert.throws(
    () => StreamDeckLabel.createRenderer({ createCanvas: () => ({}), encode() {} }).renderCanonical(0x006d, {}),
    /canvas-like/i
  );
});

test('every render resets identity before clearing and repeated renders leak no transforms', () => {
  const { renderer } = harness();
  for (let iteration = 0; iteration < 3; iteration += 1) {
    const canonical = renderer.renderCanonical(0x006d, { text: `GO ${iteration}`, active: iteration === 1 });
    assert.deepEqual(canonical.canvas.operations[0], ['setTransform', 1, 0, 0, 1, 0, 0]);
    assert.deepEqual(canonical.canvas.operations[1], ['clearRect', 0, 0, 72, 72]);
    assert.equal(canonical.canvas.context.depth(), 0);
    assert.equal(calls(canonical.canvas, 'rotate').length, 0);

    const device = renderer.createDeviceFrame(0x006d, canonical.canvas);
    assert.deepEqual(device.canvas.operations[0], ['setTransform', 1, 0, 0, 1, 0, 0]);
    assert.deepEqual(device.canvas.operations[1], ['clearRect', 0, 0, 72, 72]);
    assert.equal(device.canvas.context.depth(), 0);
  }
});

test('canonical text-only, icon-only, and text-plus-icon labels have stable composition', () => {
  const { renderer } = harness();
  const textOnly = renderer.renderCanonical(0x006d, { text: 'GO' });
  assert.deepEqual(calls(textOnly.canvas, 'fillText').map(call => call[1]), ['GO']);
  assert.equal(calls(textOnly.canvas, 'drawImage').length, 0);

  const iconOnly = renderer.renderCanonical(0x006d, { icon: '\u25b6' });
  assert.deepEqual(calls(iconOnly.canvas, 'fillText').map(call => call[1]), ['\u25b6']);
  assert.equal(iconOnly.layout.lines.length, 0);

  const combined = renderer.renderCanonical(0x006d, { icon: '\u25b6', text: 'ROLL VIDEO' });
  assert.deepEqual(calls(combined.canvas, 'fillText').map(call => call[1]), ['\u25b6', 'ROLL', 'VIDEO']);
  assert.equal(combined.layout.lines.length, 2);

  const imageIcon = { image: { id: 'icon-image' } };
  const imageOnly = renderer.renderCanonical(0x006d, { icon: imageIcon });
  assert.equal(calls(imageOnly.canvas, 'drawImage').length, 1);
});

test('one line, explicit multiline, and long unbroken labels remain bounded', () => {
  const { renderer } = harness();
  const one = renderer.renderCanonical(0x006d, { text: 'PANIC' });
  assert.deepEqual(Array.from(one.layout.lines), ['PANIC']);
  assert.equal(one.layout.overflowed, false);

  const multiline = renderer.renderCanonical(0x006d, { text: 'FADE\nSTOP' });
  assert.deepEqual(Array.from(multiline.layout.lines), ['FADE', 'STOP']);

  const long = renderer.renderCanonical(0x006d, {
    text: 'SUPERCALIFRAGILISTICEXPIALIDOCIOUS',
    maxLines: 2
  });
  assert.equal(long.layout.lines.length, 2);
  assert.equal(long.layout.overflowed, true);
  assert.match(long.layout.lines[1], /\u2026$/);
  for (const line of long.layout.lines) assert.ok(line.length <= 9, `line ${line} should stay inside the key`);
});

test('active and inactive states use distinct backgrounds without changing label orientation', () => {
  const { renderer } = harness();
  const inactive = renderer.renderCanonical(0x0080, { text: 'GO', active: false });
  const active = renderer.renderCanonical(0x0080, { text: 'GO', active: true });
  assert.notEqual(calls(inactive.canvas, 'fillRect')[0][5], calls(active.canvas, 'fillRect')[0][5]);
  assert.equal(calls(inactive.canvas, 'strokeRect').length, 0);
  assert.equal(calls(active.canvas, 'strokeRect').length, 1);
  assert.equal(calls(inactive.canvas, 'rotate').length, 0);
  assert.equal(calls(active.canvas, 'rotate').length, 0);
});

test('device conversion applies exactly the model-owned transform to the complete image', () => {
  const { renderer } = harness();
  for (const productId of StreamDeckLabel.SUPPORTED_PRODUCT_IDS) {
    const model = StreamDeckLabel.getModelProfile(productId);
    const canonical = renderer.renderCanonical(productId, { icon: '\u25b6', text: 'GO', active: true });
    const device = renderer.createDeviceFrame(productId, canonical.canvas);
    assert.equal(calls(canonical.canvas, 'rotate').length, 0);
    if (model.deviceRotationDegrees === 180) {
      assert.deepEqual(calls(device.canvas, 'translate'), [['translate', model.imageWidth, model.imageHeight]]);
      assert.equal(calls(device.canvas, 'rotate').length, 1);
      assert.equal(calls(device.canvas, 'rotate')[0][1], Math.PI);
      assert.ok(names(device.canvas).indexOf('drawImage') > names(device.canvas).indexOf('rotate'));
    } else {
      // Stream Deck + keys upload upright \u2014 the device frame must not rotate.
      assert.equal(model.deviceRotationDegrees, 0);
      assert.equal(calls(device.canvas, 'translate').length, 0);
      assert.equal(calls(device.canvas, 'rotate').length, 0);
    }
    assert.equal(calls(device.canvas, 'drawImage').length, 1);
    assert.equal(calls(device.canvas, 'drawImage')[0][1], canonical.canvas);
    assert.equal(device.canvas.context.depth(), 0);
  }
});

test('renders and accepts every supported key index while rejecting out-of-range indices', async () => {
  const { renderer, encodes } = harness(100);
  for (const productId of StreamDeckLabel.SUPPORTED_PRODUCT_IDS) {
    const model = StreamDeckLabel.getModelProfile(productId);
    for (let keyIndex = 0; keyIndex < model.keys; keyIndex += 1) {
      const rendered = await renderer.renderKeyImage(productId, keyIndex, { text: `KEY ${keyIndex}` });
      assert.equal(rendered.keyIndex, keyIndex);
      assert.equal(rendered.bytes.length, 100);
      assert.equal(rendered.deviceCanvas.width, model.imageWidth);
    }
    assert.throws(() => StreamDeckLabel.packetize(productId, -1, new Uint8Array([1])), /outside/i);
    assert.throws(() => StreamDeckLabel.packetize(productId, model.keys, new Uint8Array([1])), /outside/i);
  }
  assert.equal(encodes.length, 70);
  assert.equal(encodes[0].options.type, 'image/jpeg');
  assert.equal(encodes[0].options.quality, 0.9);
});

test('renders the touch strip as one upright canvas of four dial segments', () => {
  const { renderer } = harness();
  const strip = renderer.renderLcdStrip(0x0084, [
    { title: 'MASTER', value: '80%' },
    { title: 'STANDBY CUE', value: '#2 Walk-in', active: true },
    {},
    { title: 'BRIGHT', value: '65%' }
  ]);
  assert.equal(strip.canvas.width, 800);
  assert.equal(strip.canvas.height, 100);
  assert.deepEqual(strip.canvas.operations[0], ['setTransform', 1, 0, 0, 1, 0, 0]);
  assert.deepEqual(strip.canvas.operations[1], ['clearRect', 0, 0, 800, 100]);
  assert.equal(calls(strip.canvas, 'rotate').length, 0);
  assert.equal(calls(strip.canvas, 'translate').length, 0);
  const texts = calls(strip.canvas, 'fillText').map(call => call[1]);
  assert.deepEqual(texts, ['MASTER', '80%', 'STANDBY CUE', '#2 Walk-in', 'BRIGHT', '65%']);
  // strip background + one cell per segment, plus the active segment's accent bar
  assert.equal(calls(strip.canvas, 'fillRect').length, 1 + 4 + 1);
  assert.equal(strip.canvas.context.depth(), 0);
  assert.throws(() => renderer.renderLcdStrip(0x006d, []), /no touch strip/i);
});

test('packetizes the touch strip with the 16-byte LCD region header', async () => {
  const encodedSize = 1008 + 100;
  const { renderer } = harness(encodedSize);
  const strip = await renderer.renderAndPacketizeLcd(0x0084, [{ title: 'MASTER', value: '100%' }]);
  assert.equal(strip.bytes.length, encodedSize);
  assert.equal(strip.packets.length, 2);
  strip.packets.forEach((entry, page) => {
    assert.equal(entry.packet.length, 1024);
    assert.equal(entry.data.length, 1023);
    assert.equal(entry.reportId, 0x02);
    assert.equal(entry.packet[0], 0x02);
    assert.equal(entry.packet[1], 0x0c);
    assert.equal(entry.packet[2] | (entry.packet[3] << 8), 0);      // x
    assert.equal(entry.packet[4] | (entry.packet[5] << 8), 0);      // y
    assert.equal(entry.packet[6] | (entry.packet[7] << 8), 800);    // width
    assert.equal(entry.packet[8] | (entry.packet[9] << 8), 100);    // height
    assert.equal(entry.packet[10], page === 1 ? 1 : 0);             // isLast
    assert.equal(entry.packet[11] | (entry.packet[12] << 8), page);
    assert.equal(entry.last, page === 1);
  });
  assert.deepEqual(strip.packets.map(packet => packet.payloadLength), [1008, 100]);
  assert.equal(strip.packets[1].packet[13] | (strip.packets[1].packet[14] << 8), 100);
  assert.equal(strip.packets[1].packet[15], 0);
  assert.throws(() => StreamDeckLabel.packetizeLcd(0x0084, {}, new Uint8Array()), /empty/i);
  assert.throws(() => StreamDeckLabel.packetizeLcd(0x006d, {}, new Uint8Array([1])), /no touch strip/i);
  assert.throws(
    () => StreamDeckLabel.packetizeLcd(0x0084, { x: 700, width: 200, height: 100 }, new Uint8Array([1])),
    /outside/i
  );
  assert.throws(
    () => StreamDeckLabel.packetizeLcd(0x0084, { y: 40, width: 800, height: 100 }, new Uint8Array([1])),
    /outside/i
  );
});

test('packetizes all bytes with the correct pages and an explicit final short chunk', async () => {
  const encodedSize = (1016 * 2) + 17;
  const { renderer } = harness(encodedSize);
  const rendered = await renderer.renderAndPacketize(0x006c, 31, { text: 'LAST KEY', active: true });
  assert.equal(rendered.packets.length, 3);
  rendered.packets.forEach((entry, page) => {
    assert.equal(entry.packet.length, 1024);
    assert.equal(entry.data.length, 1023);
    assert.equal(entry.reportId, 0x02);
    assert.equal(entry.packet[0], 0x02);
    assert.equal(entry.packet[1], 0x07);
    assert.equal(entry.packet[2], 31);
    assert.equal(entry.packet[6] | (entry.packet[7] << 8), page);
    assert.equal(entry.last, page === 2);
    assert.equal(entry.packet[3], page === 2 ? 1 : 0);
  });
  assert.deepEqual(rendered.packets.map(packet => packet.payloadLength), [1016, 1016, 17]);
  assert.equal(rendered.packets[2].packet[4] | (rendered.packets[2].packet[5] << 8), 17);
  assert.equal(rendered.packets[2].packet[8], 240);
  assert.equal(rendered.packets[2].packet[24], 0);
  assert.equal(rendered.packets[2].packet[25], 0);
  assert.equal(rendered.packets[2].packet[1023], 0);
  assert.throws(() => StreamDeckLabel.packetize(0x006d, 0, new Uint8Array()), /empty/i);
  assert.throws(() => StreamDeckLabel.packetize(0x9999, 0, new Uint8Array([1])), /unsupported/i);
});

let passed = 0;
for (const { name, fn } of tests) {
  try {
    await fn();
    passed += 1;
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}
console.log(`${passed} Stream Deck label tests passed.`);
