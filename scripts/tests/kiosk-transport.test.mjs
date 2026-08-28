import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  DEFAULT_HELPER_HOST,
  helperBase,
  eventsUrl,
  sendBody,
  buildKioskLaunchUrl,
  neededIds
} = require('../../outrangutan/kiosk-transport.js');

function test(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

test('helperBase accepts loopback only', () => {
  assert.equal(helperBase('127.0.0.1:17845'), 'http://127.0.0.1:17845');
  assert.equal(helperBase('127.0.0.1'), 'http://' + DEFAULT_HELPER_HOST);
  assert.equal(helperBase(''), '');
  assert.equal(helperBase(null), '');
  assert.equal(helperBase('evil.example:17845'), '');
  assert.equal(helperBase('192.168.1.4:17845'), '');
  assert.equal(helperBase('127.0.0.1.evil.example:17845'), '');
});

test('eventsUrl carries role, session, output, instance', () => {
  const url = eventsUrl('http://127.0.0.1:17845', { role: 'output', session: 'session_A B', output: 2, instance: 'ogout_x' });
  assert.equal(url, 'http://127.0.0.1:17845/events?role=output&session=session_A%20B&output=2&instance=ogout_x');
});

test('sendBody frames the relay POST payload', () => {
  const body = JSON.parse(sendBody('s1', 'ctrl-1', { commandId: 'c1', payload: { a: 1 } }));
  assert.deepEqual(body, { session: 's1', senderInstance: 'ctrl-1', envelope: { commandId: 'c1', payload: { a: 1 } } });
});

test('buildKioskLaunchUrl produces an absolute url with launch token and helper param', () => {
  const url = buildKioskLaunchUrl(
    'https://cueola.live',
    'outrangutan/output.html#out=2&session=session_X&controller=ogc_1',
    '127.0.0.1:17845',
    'tok123'
  );
  assert.equal(url, 'https://cueola.live/outrangutan/output.html?launch=tok123#out=2&session=session_X&controller=ogc_1&helper=127.0.0.1%3A17845');
  const parsed = new URL(url);
  assert.equal(parsed.origin, 'https://cueola.live');
  const hash = new URLSearchParams(parsed.hash.slice(1));
  assert.equal(hash.get('out'), '2');
  assert.equal(hash.get('helper'), '127.0.0.1:17845');
});

test('buildKioskLaunchUrl works for localhost dev origins', () => {
  const url = buildKioskLaunchUrl('http://localhost:3001', 'outrangutan/output.html#out=1&session=s&controller=c', '127.0.0.1:17845', 't');
  assert.ok(url.startsWith('http://localhost:3001/outrangutan/output.html?launch=t#'));
});

test('neededIds dedupes cue media and ignores pads/empties', () => {
  const cues = [
    { id: 'c1', mediaId: 'm_a' },
    { id: 'c2', mediaId: 'm_b' },
    { id: 'c3', mediaId: 'm_a' },
    { id: 'c4', mediaId: '' },
    { id: 'c5' }
  ];
  assert.deepEqual(neededIds(cues), ['m_a', 'm_b']);
  assert.deepEqual(neededIds(null), []);
});

console.log('PASS 6 kiosk transport tests');
