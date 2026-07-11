// Phase 1 compatibility tests for Cueola's current device-local avatar profile.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const AvatarProfile = require('../../cueola-avatar-profile.js');

const approvedAnimals = {
  plandabear: {},
  flowmingo: {},
  outrangutan: {},
  cueola: {},
};

function memoryStorage() {
  const values = new Map();
  return {
    getItem: key => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key),
    values,
  };
}

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

test('missing profile falls back to initials', () => {
  const model = AvatarProfile.createProfileModel({ storage: memoryStorage(), approvedAnimals });
  assert.deepEqual(model.getProfile(), { avatar: { type: 'initials' } });
});

test('malformed JSON falls back to initials', () => {
  const storage = memoryStorage();
  storage.setItem(AvatarProfile.PROFILE_KEY, '{bad json');
  const model = AvatarProfile.createProfileModel({ storage, approvedAnimals });
  assert.deepEqual(model.getProfile(), { avatar: { type: 'initials' } });
});

test('approved legacy brand animal round-trips and extra fields are removed', () => {
  const storage = memoryStorage();
  const model = AvatarProfile.createProfileModel({ storage, approvedAnimals });
  assert.deepEqual(model.setAvatar({ type: 'animal', value: 'cueola', path: '../../bad' }), { type: 'animal', value: 'cueola' });
  assert.deepEqual(model.getProfile(), { avatar: { type: 'animal', value: 'cueola' } });
});

test('unknown and inherited animal keys are rejected', () => {
  const inherited = Object.create({ inherited: {} });
  inherited.cueola = {};
  assert.equal(AvatarProfile.normalizeAvatar({ type: 'animal', value: 'unknown' }, approvedAnimals), null);
  assert.equal(AvatarProfile.normalizeAvatar({ type: 'animal', value: 'inherited' }, inherited), null);
});

test('supported uploaded image data URLs round-trip', () => {
  const storage = memoryStorage();
  const model = AvatarProfile.createProfileModel({ storage, approvedAnimals });
  for (const mime of ['png', 'jpg', 'jpeg', 'webp']) {
    const avatar = { type: 'image', value: `data:image/${mime};base64,AAAA` };
    assert.deepEqual(model.setAvatar(avatar), avatar);
    assert.deepEqual(model.getProfile().avatar, avatar);
  }
});

test('unsupported, oversized, and non-string uploads fall back safely', () => {
  const model = AvatarProfile.createProfileModel({ storage: memoryStorage(), approvedAnimals });
  assert.deepEqual(model.setAvatar({ type: 'image', value: 'https://example.com/avatar.png' }), { type: 'initials' });
  assert.deepEqual(model.setAvatar({ type: 'image', value: 'data:image/svg+xml;base64,AAAA' }), { type: 'initials' });
  assert.deepEqual(model.setAvatar({ type: 'image', value: 123 }), { type: 'initials' });
  const prefix = 'data:image/png;base64,';
  const exactLimit = prefix + 'A'.repeat(AvatarProfile.MAX_IMAGE_DATA_URL_LENGTH - prefix.length);
  assert.deepEqual(model.setAvatar({ type: 'image', value: exactLimit }), { type: 'initials' });
});

test('unknown shapes, arrays, and null fall back to initials', () => {
  const model = AvatarProfile.createProfileModel({ storage: memoryStorage(), approvedAnimals });
  for (const avatar of [null, [], {}, { type: 'library', avatarId: 'animal-fox-01' }, { type: 'initials', value: 'ignored' }]) {
    assert.deepEqual(model.setAvatar(avatar), { type: 'initials' });
  }
});

test('storage read and write failures do not break the live UI contract', () => {
  const storage = {
    getItem() { throw new Error('blocked'); },
    setItem() { throw new Error('full'); },
  };
  const model = AvatarProfile.createProfileModel({ storage, approvedAnimals });
  assert.deepEqual(model.getProfile(), { avatar: { type: 'initials' } });
  assert.deepEqual(model.setAvatar({ type: 'animal', value: 'flowmingo' }), { type: 'animal', value: 'flowmingo' });
});

let passed = 0;
console.log('avatar profile compatibility');
for (const { name, fn } of tests) {
  fn();
  passed += 1;
  console.log('  ✓ ' + name);
}
console.log(`\nAll ${passed} avatar profile tests passed.`);
