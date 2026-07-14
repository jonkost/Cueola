import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createQueue } = require('../../outrangutan/output-command-queue.js');

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

async function flush() {
  await Promise.resolve();
  await Promise.resolve();
}

test('commands apply in submission order even when handlers are asynchronous', async () => {
  const gate = deferred();
  const events = [];
  const queue = createQueue({
    apply:async command => {
      events.push(`start:${command.commandId}`);
      if (command.commandId === 'one') await gate.promise;
      events.push(`finish:${command.commandId}`);
      return command.commandId;
    },
  });

  const first = queue.submit({ commandId:'one' });
  const second = queue.submit({ commandId:'two' });
  await flush();
  assert.deepEqual(events, ['start:one']);
  gate.resolve();
  assert.equal((await first).status, 'applied');
  assert.equal((await second).status, 'applied');
  assert.deepEqual(events, ['start:one', 'finish:one', 'start:two', 'finish:two']);
});

test('destructive submission invalidates an older async load immediately', async () => {
  const gate = deferred();
  const mutations = [];
  const invalidations = [];
  const queue = createQueue({
    isDestructive:command => command.type === 'load',
    onInvalidate:event => invalidations.push(event),
    apply:async (command, context) => {
      if (command.commandId === 'old') await gate.promise;
      if (context.isCurrent()) mutations.push(command.commandId);
    },
  });

  const oldLoad = queue.submit({ commandId:'old', type:'load' });
  await flush();
  assert.equal(queue.getState().generation, 1);
  const newLoad = queue.submit({ commandId:'new', type:'load' });
  assert.equal(queue.getState().generation, 2, 'generation changes synchronously during submit');
  assert.equal(invalidations.length, 2);
  gate.resolve();

  assert.equal((await oldLoad).status, 'cancelled');
  assert.equal((await newLoad).status, 'applied');
  assert.deepEqual(mutations, ['new']);
});

test('a destructive STOP is not blocked behind an unresolved destructive load', async () => {
  const gate = deferred();
  const mutations = [];
  const queue = createQueue({
    isDestructive:() => true,
    apply:async (command, context) => {
      if (command.commandId === 'hung-play') await gate.promise;
      if (context.isCurrent()) mutations.push(command.commandId);
    },
  });

  const hung = queue.submit({ commandId:'hung-play' });
  await flush();
  const stop = queue.submit({ commandId:'stop-now' });
  assert.equal((await hung).status, 'cancelled', 'superseded command resolves without waiting for its hung operation');
  assert.equal((await stop).status, 'applied');
  assert.deepEqual(mutations, ['stop-now']);
  gate.resolve();
});

test('duplicate IDs execute once and reuse the same cached result', async () => {
  const gate = deferred();
  let calls = 0;
  const invalidations = [];
  const queue = createQueue({
    onInvalidate:event => invalidations.push(event),
    apply:async () => { calls += 1; await gate.promise; return 'done'; },
  });

  const first = queue.submit({ commandId:'same', destructive:true });
  const duplicatePending = queue.submit({ commandId:'same', destructive:true });
  assert.strictEqual(duplicatePending, first);
  assert.equal(invalidations.length, 1, 'duplicate destructive command does not invalidate twice');
  gate.resolve();
  const result = await first;
  const duplicateCached = await queue.submit({ commandId:'same', destructive:true });
  assert.strictEqual(duplicateCached, result);
  assert.equal(calls, 1);
  assert.equal(invalidations.length, 1);
});

test('result cache is bounded and evicted IDs may execute again', async () => {
  let calls = 0;
  const queue = createQueue({ maxResults:2, apply:async () => { calls += 1; return calls; } });
  await queue.submit({ commandId:'one' });
  await queue.submit({ commandId:'two' });
  await queue.submit({ commandId:'three' });
  assert.equal(queue.getState().cachedResults, 2);
  await queue.submit({ commandId:'one' });
  assert.equal(calls, 4);
  assert.equal(queue.getState().cachedResults, 2);
});

test('handler errors return structured failures without wedging later commands', async () => {
  const queue = createQueue({
    apply:async command => {
      if (command.commandId === 'bad') {
        const error = new Error('decoder exploded');
        error.code = 'DECODE';
        throw error;
      }
      return 'visible';
    },
  });

  const failed = await queue.submit({ commandId:'bad' });
  assert.deepEqual(failed.error, { name:'Error', message:'decoder exploded', code:'DECODE' });
  assert.equal(failed.ok, false);
  assert.equal(failed.status, 'failed');
  const recovered = await queue.submit({ commandId:'good' });
  assert.equal(recovered.ok, true);
  assert.equal(recovered.status, 'applied');
});

test('cancel invalidates running and pending work but permits a new generation', async () => {
  const gate = deferred();
  const started = [];
  const queue = createQueue({
    apply:async (command, context) => {
      started.push(command.commandId);
      if (command.commandId === 'running') await gate.promise;
      if (context.isCurrent()) return command.commandId;
    },
  });

  const running = queue.submit({ commandId:'running' });
  const pending = queue.submit({ commandId:'pending' });
  await flush();
  const before = queue.getState().generation;
  queue.cancel('operator reset');
  assert.equal(queue.getState().generation, before + 1);
  gate.resolve();
  assert.equal((await running).status, 'cancelled');
  assert.equal((await pending).status, 'cancelled');
  assert.deepEqual(started, ['running']);
  assert.equal((await queue.submit({ commandId:'replacement' })).status, 'applied');
});

test('close invalidates once, drains pending work, and rejects future application', async () => {
  const gate = deferred();
  let calls = 0;
  const invalidations = [];
  const queue = createQueue({
    onInvalidate:event => invalidations.push(event),
    apply:async command => {
      calls += 1;
      if (command.commandId === 'running') await gate.promise;
    },
  });

  const running = queue.submit({ commandId:'running' });
  const pending = queue.submit({ commandId:'pending' });
  await flush();
  const closed = queue.close('output unloaded');
  queue.close('ignored duplicate close');
  assert.equal(invalidations.length, 1);
  assert.equal(queue.getState().closed, true);
  gate.resolve();
  await closed;
  assert.equal((await running).status, 'cancelled');
  assert.equal((await pending).status, 'cancelled');
  const future = await queue.submit({ commandId:'after-close' });
  assert.equal(future.status, 'cancelled');
  assert.equal(future.reason, 'output unloaded');
  assert.equal(calls, 1);
});

test('missing command IDs fail before entering the queue', async () => {
  const queue = createQueue({ apply:async () => {} });
  await assert.rejects(queue.submit({ type:'play' }), /requires a commandId/);
  assert.equal(queue.getState().pending, 0);
});

for (const { name, fn } of tests) {
  await fn();
  console.log('PASS', name);
}
console.log(`PASS ${tests.length} Outrangutan output command queue tests`);
