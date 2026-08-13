// Stage Plot wire-format contract. The normalizers ARE the format: every
// plot read or written passes through them, and the collab refresh guards
// compare their JSON output byte for byte (so idempotency is load-bearing).
// The block under test is extracted from cueola-app.js and evaluated in a
// bare sandbox, so these pins exercise the real shipping code.
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

const app = await readFile(new URL('../../cueola-app.js', import.meta.url), 'utf8');
const start = app.indexOf('const PLOT_PX_PER_FT');
const end = app.indexOf('// ── Editor state (device-local) ──');
assert.ok(start > 0 && end > start, 'stage plot model block markers must exist in cueola-app.js');
const sandbox = {};
vm.createContext(sandbox);
// Top-level const/let stay in the context's lexical scope, not on the global
// object, so the block exports what the tests need explicitly.
vm.runInContext(app.slice(start, end) + `
;globalThis.__model = { PLOT_LAYERS, PLOT_ITEM_COLORS, PLOT_ELEMENT_TYPES, PLOT_CONN_TYPES,
  PLOT_FLOOR_TEMPLATES, PLOT_DRAPE_PANEL_FT, plotLayerDef, plotLayerColor, plotConnDef,
  plotConnDefault, plotItemColor, plotItemLayer, plotTypeDef, plotFloorDef, plotStageBounds,
  normalizeStagePlot, normalizeStagePlotItem, normalizeStagePlotFlow, getStagePlots, plotDrapeSym };`, sandbox);
const S = sandbox.__model;

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

test('registries are internally consistent', () => {
  assert.equal(S.PLOT_LAYERS.length, 4);
  for (const layer of S.PLOT_LAYERS) {
    assert.ok(S.PLOT_ITEM_COLORS.some(c => c.key === layer.colorKey),
      `layer ${layer.key} colorKey must resolve to a color chip`);
    assert.ok(S.plotConnDef(S.plotConnDefault(layer.key)), `layer ${layer.key} needs a valid conn default`);
  }
  for (const def of S.PLOT_ELEMENT_TYPES) {
    assert.ok(S.plotLayerDef(def.layer), `type ${def.type} must live on a real layer`);
  }
  // The '' chip is a swatch gradient, never a usable color: nothing may fall
  // back to it (the plotItemColor regression this suite exists to pin).
  assert.match(S.PLOT_ITEM_COLORS[0].css, /gradient/);
  assert.equal(S.plotItemColor({ type: 'mic' }), 'var(--green)', 'audio gear defaults to the layer color');
  assert.equal(S.plotItemColor({ type: 'mic', color: 'ink' }), 'var(--text)', 'explicit ink wins');
  assert.equal(S.plotItemColor({ type: 'table' }), 'var(--text)', 'room gear stays ink');
});

const hostile = {
  id: 'p1', label: 'x', floor: 'fs4e-123', stage: { w_ft: 40.7, h_ft: 30 },
  items: [
    { id: 'a', type: 'camera', x_ft: 3.3, y_ft: 4.4, rot: 361.5, w_ft: 8, h_ft: 2, color: 'zzz', layer: 'video' },
    { id: 'b', type: 'pipe-drape', x_ft: 5, y_ft: 5, w_ft: 10 },
    { id: 'c', type: 'sound-console', x_ft: 1, y_ft: 1, w_ft: 5.1, h_ft: 9 },
    { id: 'a', type: 'mic', x_ft: 0, y_ft: 0 },
    { id: 'd', type: 'nonsense-type', x_ft: 2, y_ft: 2 },
  ],
  flows: [
    { id: 'f1', from: 'a', to: 'b', layer: 'audio', conn: 'weird' },
    { id: 'f1', from: 'b', to: 'c' },
    { id: 'f2', from: 'a', to: 'a', layer: 'video' },
    { id: 'f3', from: 'a', to: 'missing' },
    { id: 'f4', from: 'a', to: 'b', layer: 'audio' },
    { id: 'f5', from: 'a', to: 'b', layer: 'video' },
  ],
};

test('normalize is idempotent under hostile input', () => {
  const once = S.normalizeStagePlot(hostile, 0);
  const twice = S.normalizeStagePlot(JSON.parse(JSON.stringify(once)), 0);
  assert.equal(JSON.stringify(once), JSON.stringify(twice));
});

test('flow rules: dangling, self-loop, dup id, dup pair per layer, conn healing', () => {
  const plot = S.normalizeStagePlot(hostile, 0);
  const ids = plot.flows.map(f => f.id);
  assert.deepEqual(ids, ['f1', 'f5'], 'dup id, self-loop, dangling, and same-layer dup pair all drop');
  assert.equal(plot.flows[0].conn, 'xlr', 'invalid conn heals to the layer default');
  assert.equal(plot.flows[1].conn, 'bnc', 'video layer defaults to BNC');
});

test('sizing: uniform aspect with clamps, panels floor conversion, unknown types', () => {
  const plot = S.normalizeStagePlot(hostile, 0);
  const console_ = plot.items.find(i => i.id === 'c');
  assert.equal(console_.h_ft, Math.round(console_.w_ft * (2.5 / 4) * 100) / 100, 'uniform gear keeps its aspect');
  const drape = plot.items.find(i => i.id === 'b');
  assert.equal(drape.panels, 2, 'legacy 10 ft drape floors to 2 panels');
  assert.equal(drape.w_ft, 8, 'panel width derives from the count');
  assert.equal(plot.items.find(i => i.id === 'd').type, 'camera', 'unknown types fall back to camera');
  assert.equal(S.normalizeStagePlotItem({ type: 'projection-screen', w_ft: 0.5 }).h_ft, 0.5, 'auto depth honors the floor');
  assert.equal(S.normalizeStagePlotItem({ type: 'source-four', w_ft: 100 }).h_ft, 100, 'auto depth honors the cap');
  assert.equal(S.normalizeStagePlotItem({ type: 'pipe-drape', panels: 99 }).panels, 20, 'panel count caps at 20');
});

test('floor whitelist and wall insets', () => {
  assert.equal(S.normalizeStagePlot({ floor: 'not-a-room' }, 0).floor, 'blank');
  assert.equal(S.normalizeStagePlot(hostile, 0).floor, 'fs4e-123');
  const room = S.plotStageBounds({ floor: 'fs4e-123', stage: { w_ft: 40, h_ft: 30 } });
  assert.ok(room.y0 > 0 && room.x1 < 40 && room.y1 < 30, 'assigned rooms pull gear inside the walls');
  const blank = S.plotStageBounds({ floor: 'blank', stage: { w_ft: 40, h_ft: 30 } });
  assert.equal(JSON.stringify(blank), JSON.stringify({ x0: 0, y0: 0, x1: 40, y1: 30 }), 'blank floors keep the full rect');
});

test('tombstones filter reads and the min-1 fallback walks past them', () => {
  const data = {
    stagePlots: [S.normalizeStagePlot(hostile, 0)],
    stagePlotTombstones: { p1: 1, stage_plot_1: 2 },
  };
  const plots = S.getStagePlots(data);
  assert.equal(plots.length, 1, 'min-1 fallback after every stored plot is tombstoned');
  assert.equal(plots[0].id, 'stage_plot_1r', 'fallback id walks past its own tombstone');
});

test('drape waves fit their panels exactly', () => {
  for (const n of [1, 2, 6]) {
    const { vb, sym } = S.plotDrapeSym(n);
    const width = Number(vb.split(' ')[2]);
    assert.equal(width, 24 * n);
    const span = (width - 2.8) / n;
    const waves = [...sym.matchAll(/M([\d.]+) 4\.6c/g)].map(m => Number(m[1]));
    assert.equal(waves.length, n, 'one wave per panel');
    waves.forEach((x0, i) => {
      assert.ok(Math.abs(x0 - (1.4 + i * span)) < 0.05, 'waves start at their seam post');
    });
    // Each wave advances one c segment plus five s segments; the sum must be
    // one panel span (the overdraw bug this pins drew 10/6 of a span).
    const wavePaths = [...sym.matchAll(/M[\d. ]+c([^"]+)/g)].map(m => m[1]);
    for (const body of wavePaths) {
      const nums = body.replace(/s/g, ' ').trim().split(/\s+/).map(Number);
      let advance = nums[4];                       // c: dx is the 5th number
      for (let i = 6; i < nums.length; i += 4) advance += nums[i + 2];   // s: dx is the 3rd
      assert.ok(Math.abs(advance - span) < 0.15, `wave advance ${advance} must equal the panel span ${span}`);
    }
  }
});

let passed = 0;
console.log('stage plot wire-format contract');
for (const { name, fn } of tests) {
  fn();
  passed += 1;
  console.log('  ✓ ' + name);
}
console.log(`\nAll ${passed} stage plot model tests passed.`);
