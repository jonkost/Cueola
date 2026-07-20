/* ============================================================================
 * cueola-avatar-profile.js — pure compatibility model for Cueola avatars.
 *
 * Phase 1 intentionally models only the avatar shapes Cueola supports today:
 * initials, approved brand animals, and small uploaded data URLs. The future
 * built-in avatar manifest and v2 profile persistence belong to later phases.
 *
 * DOM-free and storage-injected so the contract can be tested in plain Node.
 * Loaded as a classic global script before cueola-app.js.
 * ==========================================================================*/
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.CueolaAvatarProfile = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const PROFILE_KEY = 'cueola_profile';
  const MAX_IMAGE_DATA_URL_LENGTH = 60000;
  const IMAGE_DATA_URL_RE = /^data:image\/(png|jpe?g|webp);base64,/;

  function normalizeAvatar(avatar, approvedAnimals, iconManifest) {
    if (!avatar || typeof avatar !== 'object' || Array.isArray(avatar)) return null;
    if (avatar.type === 'animal'
        && typeof avatar.value === 'string'
        && approvedAnimals
        && Object.prototype.hasOwnProperty.call(approvedAnimals, avatar.value)) {
      return { type: 'animal', value: avatar.value };
    }
    // v2.1 D7: icon avatars are manifest-lookup ONLY — the stored value is a
    // ~20-byte manifest id, never SVG markup or a path.
    if (avatar.type === 'icon'
        && typeof avatar.value === 'string'
        && iconManifest
        && Object.prototype.hasOwnProperty.call(iconManifest, avatar.value)) {
      return { type: 'icon', value: avatar.value };
    }
    if (avatar.type === 'image'
        && typeof avatar.value === 'string'
        && IMAGE_DATA_URL_RE.test(avatar.value)
        && avatar.value.length < MAX_IMAGE_DATA_URL_LENGTH) {
      return { type: 'image', value: avatar.value };
    }
    if (avatar.type === 'initials') return { type: 'initials' };
    return null;
  }

  function defaultAvatar() { return { type: 'initials' }; }

  function createProfileModel(options) {
    options = options || {};
    const storage = options.storage;
    const approvedAnimals = options.approvedAnimals || {};
    const iconManifest = options.iconManifest || {};
    const profileKey = options.profileKey || PROFILE_KEY;

    function getProfile() {
      try {
        const profile = JSON.parse(storage.getItem(profileKey) || 'null');
        return { avatar: normalizeAvatar(profile && profile.avatar, approvedAnimals, iconManifest) || defaultAvatar() };
      } catch {
        return { avatar: defaultAvatar() };
      }
    }

    function setAvatar(avatar) {
      const normalized = normalizeAvatar(avatar, approvedAnimals, iconManifest) || defaultAvatar();
      try { storage.setItem(profileKey, JSON.stringify({ avatar: normalized })); } catch {}
      return normalized;
    }

    return { getProfile, setAvatar };
  }

  return {
    PROFILE_KEY,
    MAX_IMAGE_DATA_URL_LENGTH,
    normalizeAvatar,
    createProfileModel,
  };
});
