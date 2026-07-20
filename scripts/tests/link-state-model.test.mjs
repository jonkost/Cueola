import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { STATUSES, createModel } = require('../../cueola-link-state.js');

function clock(start = 1000) {
  let value = start;
  return { now: () => value, tick: (amount = 1) => { value += amount; } };
}

function test(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

test('links start off and promote instantly on ack', () => {
  const time = clock();
  const model = createModel({ now: time.now });
  model.configure('talent', { label: 'Talent', ackIntervalMs: 2000 });
  assert.equal(model.getLink('talent').status, 'off');
  model.noteAck('talent');
  assert.equal(model.getLink('talent').status, 'connected');
  assert.equal(model.getLink('talent').lastAckAt, 1000);
});

test('demotion needs N consecutive missed windows, not one gap', () => {
  const time = clock();
  const model = createModel({ now: time.now });
  model.configure('talent', { ackIntervalMs: 2000, degradeMisses: 2, lostMisses: 5 });
  model.noteAck('talent');
  // One missed window: still connected (this is the anti-flap hysteresis).
  time.tick(2100);
  assert.deepEqual(model.tick(), []);
  assert.equal(model.getLink('talent').status, 'connected');
  // Second missed window: degraded.
  time.tick(2000);
  assert.equal(model.tick().length, 1);
  assert.equal(model.getLink('talent').status, 'degraded');
  // Five missed windows total: lost.
  time.tick(6000);
  model.tick();
  assert.equal(model.getLink('talent').status, 'lost');
});

test('recovery from lost shows immediately on any ack', () => {
  const time = clock();
  const model = createModel({ now: time.now });
  model.configure('scriptop', { ackIntervalMs: 1000, lostMisses: 3 });
  model.noteAck('scriptop');
  time.tick(60000);
  model.tick();
  assert.equal(model.getLink('scriptop').status, 'lost');
  model.noteAck('scriptop');
  assert.equal(model.getLink('scriptop').status, 'connected');
});

test('noteLost is instant — window closed must look dead now', () => {
  const time = clock();
  const model = createModel({ now: time.now });
  model.configure('talent', {});
  model.noteAck('talent');
  model.noteLost('talent', 'Talent window closed');
  const link = model.getLink('talent');
  assert.equal(link.status, 'lost');
  assert.equal(link.detail, 'Talent window closed');
  // tick() must not resurrect a definitively-lost link.
  time.tick(10);
  model.tick();
  assert.equal(model.getLink('talent').status, 'lost');
});

test('listeners fire only on transitions, with previous status', () => {
  const time = clock();
  const model = createModel({ now: time.now });
  model.configure('cloud', { ackIntervalMs: 5000, degradeMisses: 2, lostMisses: 4 });
  const seen = [];
  model.subscribe((link, prev) => seen.push(`${prev}>${link.status}`));
  model.noteAck('cloud');
  model.noteAck('cloud'); // same status, same detail — no event
  time.tick(11000);
  model.tick();
  assert.deepEqual(seen, ['off>connected', 'connected>degraded']);
});

test('off links are ignored by tick and report no stale ack', () => {
  const time = clock();
  const model = createModel({ now: time.now });
  model.configure('playout', {});
  model.noteAck('playout');
  model.noteOff('playout', 'No playout window');
  time.tick(120000);
  assert.deepEqual(model.tick(), []);
  assert.equal(model.getLink('playout').status, 'off');
});

test('meta merges and emits without changing status', () => {
  const time = clock();
  const model = createModel({ now: time.now });
  model.configure('playout', {});
  model.noteAck('playout');
  const seen = [];
  model.subscribe((link) => seen.push(link.meta.armed));
  model.noteMeta('playout', { armed: true });
  model.noteMeta('playout', { armed: true }); // no change, no event
  assert.deepEqual(seen, [true]);
  assert.equal(model.getLink('playout').status, 'connected');
  assert.equal(model.getLink('playout').meta.armed, true);
});

test('a listener that throws never wedges the model', () => {
  const time = clock();
  const model = createModel({ now: time.now });
  model.configure('cloud', {});
  model.subscribe(() => { throw new Error('boom'); });
  const seen = [];
  model.subscribe((link) => seen.push(link.status));
  model.noteAck('cloud');
  assert.deepEqual(seen, ['connected']);
});

test('watchdog:false links never demote from tick, only explicitly', () => {
  const time = clock();
  const model = createModel({ now: time.now });
  model.configure('cloud', { watchdog: false });
  model.noteAck('cloud');
  time.tick(600000); // ten quiet minutes with no writes is not an outage
  assert.deepEqual(model.tick(), []);
  assert.equal(model.getLink('cloud').status, 'connected');
  model.noteDegraded('cloud', 'Reconnecting — showing the last confirmed state');
  assert.equal(model.getLink('cloud').status, 'degraded');
  model.noteAck('cloud');
  assert.equal(model.getLink('cloud').status, 'connected');
});

test('noteDegraded never resurrects a lost link', () => {
  const time = clock();
  const model = createModel({ now: time.now });
  model.configure('cloud', { watchdog: false });
  model.noteLost('cloud', 'Network offline');
  model.noteDegraded('cloud', 'Reconnecting');
  assert.equal(model.getLink('cloud').status, 'lost');
});

test('statuses are the D12.1 vocabulary', () => {
  assert.deepEqual([...STATUSES], ['off', 'connected', 'degraded', 'lost']);
});

console.log('link-state-model: all tests passed');
