/* ============================================================================
 * cueola-identity.js — Phase 3: profiles & the login-code identity layer.
 *
 * One identity per person, admin-managed via login codes — deliberately NOT
 * username/password auth (university constraint). A profile is a Firestore doc
 * at profiles/{usernameLower}; creation requires an active accessCodes/{CODE}
 * doc and the profile's role is copied from that code (firestore.rules
 * enforces both). This is identity consistency + convenience, enforced
 * socially and by rules shape, not cryptographically.
 *
 * Classic global script (no build): attaches window.CueolaIdentity. Loaded
 * before cueola-app.js; every dependency on the app (toast, showModal, avatar
 * model, Firestore handles) is resolved lazily at call time.
 * ==========================================================================*/
(function () {
  'use strict';

  var IDENTITY_KEY = 'cueola_identity';
  // The device "this person proved who they are" marker. A stored identity is
  // LOCKED (reads as signed out everywhere) until the person clears the gate on
  // this device: a student enters their PIN, an admin enters their password.
  // Cleared on sign-out. See the gate section below.
  var PIN_OK_KEY = 'cueola_pin_ok';
  var USERNAME_RE = /^[a-z0-9][a-z0-9._-]{2,39}$/;      // mirrors firestore.rules validUsername
  var CODE_RE = /^[A-Za-z0-9_-]{4,80}$/;                // mirrors firestore.rules accessCodes id
  var SESSION_CODE_RE = /^[A-Za-z0-9_.-]{1,160}$/;
  var THEME_LABELS = {
    cool: 'Cool', warm: 'Warm', white: 'Daylight', green: 'Greenroom',
    koala: 'Koala', panda: 'Planda Bear', flamingo: 'Flowmingo',
    outrangutan: 'Outrangutan', prepbear: 'PrepBear',
  };

  var cachedProfile = null;   // last loaded profile doc data for the signed-in username
  var portalRequestGeneration = 0;

  function assignmentModel() {
    return window.CueolaAssignmentModel || {};
  }

  function cleanIdentityIds(values) {
    var seen = {};
    return (Array.isArray(values) ? values : []).map(function (value) {
      return String(value || '').trim();
    }).filter(function (value) {
      if (!value || seen[value]) return false;
      seen[value] = true;
      return true;
    }).slice(0, 100);
  }

  function persistedProfileAliases(values, currentProfileId) {
    var current = String(currentProfileId || '').trim();
    return cleanIdentityIds((Array.isArray(values) ? values : []).filter(function (value) {
      return typeof value === 'string';
    })).filter(function (id) {
      return id !== current;
    }).slice(0, 40);
  }

  function sameIdentityIds(left, right) {
    if (!Array.isArray(left) || left.length !== right.length) return false;
    for (var i = 0; i < right.length; i++) if (left[i] !== right[i]) return false;
    return true;
  }

  function fallbackProfileId(seed) {
    var input = String(seed || '').trim().toLowerCase();
    var h = 2166136261;
    for (var i = 0; i < input.length; i++) {
      h ^= input.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    return 'profile_legacy_' + h.toString(36);
  }

  function newProfileId() {
    var model = assignmentModel();
    if (typeof model.createProfileId === 'function') return model.createProfileId();
    var random = '';
    try {
      if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') random = crypto.randomUUID().replace(/-/g, '');
    } catch (error) {}
    return random ? 'profile_' + random : 'profile_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2);
  }

  function canonicalProfileId(profileOrUsername) {
    var model = assignmentModel();
    if (typeof model.profileIdFor === 'function') {
      var modelId = model.profileIdFor(profileOrUsername);
      if (modelId) return String(modelId);
    }
    if (profileOrUsername && typeof profileOrUsername === 'object' && profileOrUsername.profileId) {
      return String(profileOrUsername.profileId);
    }
    var username = typeof profileOrUsername === 'string'
      ? profileOrUsername
      : profileOrUsername && profileOrUsername.username;
    return fallbackProfileId(username);
  }

  function canonicalProfileIdentity(profile) {
    if (!profile) return null;
    var model = assignmentModel();
    var ids = typeof model.profileIdentityIds === 'function'
      ? model.profileIdentityIds(profile)
      : [profile.profileId].concat(profile.profileAliases || []);
    return {
      profileId: canonicalProfileId(profile),
      profileAliases: cleanIdentityIds(ids).filter(function (id) { return id !== canonicalProfileId(profile); }),
      username: String(profile.username || ''),
      fullName: String(profile.fullName || ''),
      displayName: String(profile.fullName || profile.username || ''),
    };
  }

  /* ── tiny bridges into the app (lazy — cueola-app.js loads after us) ── */
  function fb() {
    return (window._firebaseReady && window._db && window._doc && window._getDoc) ? window : null;
  }
  async function readWithCache(networkRead, cacheRead) {
    var network = Promise.resolve().then(networkRead);
    if (typeof cacheRead !== 'function') return network;
    var timeoutToken = {};
    var timer = 0;
    var first = await Promise.race([
      network,
      new Promise(function (resolve) { timer = setTimeout(function () { resolve(timeoutToken); }, 4500); }),
    ]);
    clearTimeout(timer);
    if (first !== timeoutToken) return first;
    try {
      return await cacheRead();
    } catch (cacheError) {
      var error = new Error('Firestore did not respond and this profile data is not available in cache.');
      error.code = 'unavailable';
      throw error;
    }
  }
  function say(msg) { try { if (typeof window.toast === 'function') return window.toast(msg); } catch (e) {} }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function open(id) { try { window.showModal(id); } catch (e) {} }
  function close(id) { try { window.hideModal(id); } catch (e) {} }
  // CUEOLA_THEMES / PB_AVATAR_ANIMALS are top-level consts in cueola-app.js —
  // global lexical bindings, reachable by bare identifier but NOT on window.
  function themeIds() {
    try { if (Array.isArray(CUEOLA_THEMES)) return CUEOLA_THEMES; } catch (e) {}
    return Object.keys(THEME_LABELS);
  }
  function animals() {
    try { if (PB_AVATAR_ANIMALS && typeof PB_AVATAR_ANIMALS === 'object') return PB_AVATAR_ANIMALS; } catch (e) {}
    return {};
  }
  // v2.1 D7: the icon manifest is a top-level const in cueola-app.js, read the
  // same bare-lexical way as PB_AVATAR_ANIMALS.
  function avatarIcons() {
    try { if (PB_AVATAR_ICONS && typeof PB_AVATAR_ICONS === 'object') return PB_AVATAR_ICONS; } catch (e) {}
    return {};
  }
  function avatarBgChoices() {
    try { if (Array.isArray(PB_AVATAR_BG_CHOICES)) return PB_AVATAR_BG_CHOICES; } catch (e) {}
    return [];
  }
  function normalizeAvatar(a) {
    var m = window.CueolaAvatarProfile;
    return (m && m.normalizeAvatar(a, animals(), avatarIcons())) || { type: 'initials' };
  }

  /* ── local device identity ── */
  // The raw stored record, ignoring the lock. Used only by the gate to know
  // WHOM to prompt; everything else must go through identity().
  function storedIdentity() {
    try {
      var raw = JSON.parse(localStorage.getItem(IDENTITY_KEY) || 'null');
      return raw && typeof raw.username === 'string' ? raw : null;
    } catch (e) { return null; }
  }
  // Signed-in identity, but ONLY once this device is unlocked for that username.
  // A stored identity with no matching unlock marker returns null, so every
  // consumer (join flows, toolbar, KeyWi gate, portal) reads it as signed out
  // until the person clears the PIN or password gate. This is what forces a
  // returning or migrated user through the gate before anything trusts them.
  function identity() {
    var raw = storedIdentity();
    if (!raw) return null;
    return deviceUnlocked(raw.username) ? raw : null;
  }
  function deviceUnlocked(username) {
    try {
      var m = JSON.parse(localStorage.getItem(PIN_OK_KEY) || 'null');
      return !!(m && m.username === username);
    } catch (e) { return false; }
  }
  function markUnlocked(username) {
    try { localStorage.setItem(PIN_OK_KEY, JSON.stringify({ username: username, at: Date.now() })); } catch (e) {}
  }
  function clearUnlocked() {
    try { localStorage.removeItem(PIN_OK_KEY); } catch (e) {}
  }
  function rememberIdentity(username, profile) {
    var value = { username: username };
    if (profile) value.profileId = canonicalProfileId(profile);
    try { localStorage.setItem(IDENTITY_KEY, JSON.stringify(value)); } catch (e) {}
  }
  // One dispatch point for every signed-in identity transition (sign-in,
  // sign-out, restore on boot). Listeners (cueola-app's instructor-only UI)
  // re-read CueolaIdentity.profile() when this fires.
  function announceIdentityChange() {
    try { document.dispatchEvent(new CustomEvent('cueola-identity-change')); } catch (e) {}
  }
  function signOut() {
    portalRequestGeneration++;
    try { localStorage.removeItem(IDENTITY_KEY); } catch (e) {}
    clearUnlocked();
    pendingGate = null;
    // Drop the real Firebase Auth session too, so neither an admin's instructor
    // standing nor a student's custom-token session lingers behind a signed-out
    // card. CueolaAdminAuth.signOut() also resets the admin UI state; the direct
    // signOut covers a student custom-token session (which has no admin doc, so
    // CueolaAdminAuth.current() is null for it).
    try { if (window.CueolaAdminAuth && window.CueolaAdminAuth.current()) window.CueolaAdminAuth.signOut(); } catch (e) {}
    try {
      var wOut = fb();
      if (wOut && wOut._adminAuth && wOut._adminAuth.currentUser && wOut._authFns && wOut._authFns.signOut) {
        wOut._authFns.signOut(wOut._adminAuth);
      }
    } catch (e) {}
    cachedProfile = null;
    announceIdentityChange();
    say('Signed out on this device.');
    renderFrontDoor();
    renderHub();
  }

  /* ── model ── */
  function normalizeUsername(raw) {
    var u = String(raw || '').trim().toLowerCase();
    return USERNAME_RE.test(u) ? u : null;
  }
  function normalizeCode(raw) {
    var c = String(raw || '').trim().toUpperCase().replace(/\s+/g, '');
    return CODE_RE.test(c) ? c : null;
  }
  async function ensureProfileIdentity(username, profile) {
    if (!profile || profile.renamedTo || profile.mergedInto) return profile;
    var proposedId = profile.profileId
      ? String(profile.profileId)
      : canonicalProfileId(profile.username ? profile : username);
    var aliases = persistedProfileAliases(profile.profileAliases || [], proposedId);
    if (profile.profileId && sameIdentityIds(profile.profileAliases, aliases)) return profile;
    var patch = { profileId: proposedId, profileAliases: aliases };
    var w = fb();
    if (!w || !w._updateDoc) return Object.assign({}, profile, patch, {
      _identityMigrationError: { code: 'unavailable', message: 'Cloud connection is not ready.' },
    });
    try {
      if (w._runTransaction) {
        var ref = w._doc(w._db, 'profiles', username);
        var migrated = null;
        var profileMissing = false;
        await w._runTransaction(w._db, async function (tx) {
          var latestSnap = await tx.get(ref);
          if (!latestSnap.exists()) { profileMissing = true; return; }
          var latest = latestSnap.data() || {};
          var latestId = latest.profileId || proposedId;
          var latestAliases = persistedProfileAliases(latest.profileAliases || aliases, latestId);
          if (!latest.profileId || !sameIdentityIds(latest.profileAliases, latestAliases)) {
            tx.update(ref, { profileId: latestId, profileAliases: latestAliases });
          }
          migrated = Object.assign({ username: username }, latest, {
            profileId: latestId,
            profileAliases: latestAliases,
          });
        });
        if (profileMissing) return null;
        if (migrated) return migrated;
      } else {
        await w._updateDoc(w._doc(w._db, 'profiles', username), patch);
      }
      return Object.assign({}, profile, patch);
    } catch (error) {
      return Object.assign({}, profile, patch, { _identityMigrationError: error });
    }
  }

  async function fetchProfile(username) {
    var w = fb(); if (!w) return null;
    var ref = w._doc(w._db, 'profiles', username);
    var snap = await readWithCache(
      function () { return w._getDoc(ref); },
      w._getDocFromCache ? function () { return w._getDocFromCache(ref); } : null
    );
    if (!snap.exists()) return null;
    var profile = Object.assign({ username: username }, snap.data() || {});
    if (snap.metadata && snap.metadata.fromCache) profile._profileReadStatus = 'offline';
    return ensureProfileIdentity(username, profile);
  }
  async function fetchCode(code) {
    var w = fb(); if (!w) return null;
    var ref = w._doc(w._db, 'accessCodes', code);
    var snap = await readWithCache(
      function () { return w._getDoc(ref); },
      w._getDocFromCache ? function () { return w._getDocFromCache(ref); } : null
    );
    return snap.exists() ? snap.data() : null;
  }

  /* ══════════════════════════ sign-in gate ══════════════════════════
   * Username alone no longer signs anyone in. resolveGate() fetches the
   * profile and decides which second factor the person must clear on this
   * device: a student enters their PIN ('pin'), a student with no PIN yet
   * sets one to continue ('setPin'), an admin enters their Firebase Auth
   * password ('password'). Only when that factor passes does finalizeSignIn()
   * write the unlock marker and adopt the identity. Because identity() reads
   * as null until the marker is set, a wrong username or an abandoned gate
   * never grants access, and every existing signed-in user is forced through
   * the gate the first time this ships (they have no marker yet). */
  var pendingGate = null;   // { username, profile, stage } while a gate is open

  // One factor check at a time: the signInWithPin callable can take seconds on
  // a cold start, and every extra click or Enter press during the wait counts
  // as a separate server-side attempt toward the 15 minute lockout. The busy
  // flag swallows repeats, and the button shows progress so nobody keeps
  // pressing. The button reference is captured up front because a successful
  // sign-in re-renders the card; restoring a detached node is harmless.
  var gateBusy = false;
  var gateAttempt = 0;
  async function gateGuarded(btnSelector, run) {
    if (gateBusy) return;
    gateBusy = true;
    var attempt = ++gateAttempt;
    var btn = null;
    try { btn = document.querySelector(btnSelector); } catch (e) {}
    var label = btn ? btn.textContent : '';
    if (btn) { btn.disabled = true; btn.textContent = 'Checking...'; }
    // The attempt token keeps a late-settling stale run() from clobbering a
    // newer attempt's state.
    var release = function () {
      if (attempt !== gateAttempt) return;
      gateBusy = false;
      if (btn) { btn.disabled = false; btn.textContent = label; }
    };
    // A Firestore write in the offline legacy path can pend forever, and a
    // stuck shared flag would silently swallow every later gate submit on the
    // page. Bound the wait and fail honestly instead.
    var timedOut = { gate: 'timeout' };
    var timer = null;
    var timeout = new Promise(function (resolve) {
      timer = setTimeout(function () { resolve(timedOut); }, 25000);
    });
    try {
      var result = await Promise.race([Promise.resolve().then(run), timeout]);
      if (result === timedOut) {
        release();
        var msg = 'Still trying to reach the cloud. Check the connection and try again.';
        try { gateErr(msg); } catch (e) {}
        try { modalGateErr(msg); } catch (e) {}
        return;
      }
      return result;
    } finally {
      if (timer !== null) clearTimeout(timer);
      release();
    }
  }

  // Call a Cloud Function, or return null when the functions SDK is not wired
  // up (so callers can fall back while Phase 1 rolls out).
  async function callFn(name, payload) {
    var w = fb();
    if (!w || !w._functions || !w._httpsCallable) return null;
    var res = await w._httpsCallable(w._functions, name)(payload || {});
    return (res && res.data) || {};
  }

  async function resolveGate(rawUsername) {
    var username = normalizeUsername(rawUsername);
    if (!username) return { ok: false, msg: 'Usernames are 3 to 40 characters: letters, numbers, dots, dashes.' };
    var w = fb(); if (!w) return { ok: false, msg: 'Cloud connection is not ready. Try again in a moment.' };

    // Which gate to show is decided by getSignInStage, a Cloud Function, because
    // this runs BEFORE the person has a token: once the Phase 2 rules land, an
    // unauthenticated client cannot read profiles at all. The callable returns
    // only the stage plus the display name and avatar, never the PIN hash.
    var p = null;
    try {
      var stageInfo = await callFn('getSignInStage', { username: username });
      if (stageInfo) {
        if (stageInfo.renamedTo) return { ok: false, msg: 'This username was renamed. Sign in as “' + esc(stageInfo.renamedTo) + '”.' };
        if (stageInfo.mergedInto) return { ok: false, msg: 'This profile was merged into “' + esc(stageInfo.mergedInto) + '”. Use that username.' };
        if (stageInfo.deactivated) return { ok: false, msg: 'This profile was deactivated by an instructor.' };
        if (!stageInfo.found) return { ok: false, msg: 'No profile with that username. Check the spelling, or create one with your class login code.' };
        p = { username: username, fullName: stageInfo.fullName, avatar: stageInfo.avatar, theme: stageInfo.theme };
        pendingGate = { username: username, profile: p, stage: stageInfo.stage };
        return { ok: true, profile: p, stage: stageInfo.stage, username: username };
      }
    } catch (e) { /* not deployed yet, or unreachable: fall through to the read */ }

    // Pre-Phase-2 path: read the profile directly. Still correct while the
    // rules allow it, and the only path when the functions are not yet live.
    try { p = await fetchProfile(username); }
    catch (e) { return { ok: false, msg: 'Could not reach the profile service. Check the connection.' }; }
    if (!p) return { ok: false, msg: 'No profile with that username. Check the spelling, or create one with your class login code.' };
    if (p.renamedTo) return { ok: false, msg: 'This username was renamed. Sign in as “' + esc(p.renamedTo) + '”.' };
    if (p.mergedInto) return { ok: false, msg: 'This profile was merged into “' + esc(p.mergedInto) + '”. Use that username.' };
    if (p.active === false) return { ok: false, msg: 'This profile was deactivated by an instructor.' };
    var stage = p.role === 'admin' ? 'password' : (p.pinHash ? 'pin' : 'setPin');
    pendingGate = { username: username, profile: p, stage: stage };
    return { ok: true, profile: p, stage: stage, username: username };
  }

  // Shared tail once a factor passes: persist who, unlock this device, adopt.
  function finalizeSignIn(username, p) {
    rememberIdentity(username, p);
    markUnlocked(username);
    pendingGate = null;
    cachedProfile = p;
    // The getSignInStage callable returns only {username, fullName, avatar,
    // theme}: no sessions, profileId, or codeUsed. Cache that stub as the
    // profile and every post-sign-in surface (front door session list, join
    // pickers, entrySatisfied) reads an empty profile until reload. Refetch
    // the real doc in the background; the double guard keeps a fresher
    // profile loaded meanwhile (e.g. by the portal) from being clobbered.
    if (!Array.isArray(p.sessions)) {
      fetchProfile(username).then(function (full) {
        var id = identity();
        if (full && id && id.username === username
            && cachedProfile && cachedProfile.username === username
            && !Array.isArray(cachedProfile.sessions)) {
          cachedProfile = full;
          announceIdentityChange();
          renderFrontDoor();
        }
      }).catch(function () {});
    }
    announceIdentityChange();
    adoptProfileLocally(p);
    bumpLastSeen(username, p);
    renderFrontDoor();
    return { ok: true, profile: p };
  }

  // Authenticate a student by PIN. The real check is the signInWithPin Cloud
  // Function: it verifies the PIN server-side (the hash never leaves the
  // server), rate-limits guessing, and returns a custom token the client
  // exchanges for a real Firebase Auth session (request.auth.uid = profileId).
  //
  // Graceful fallback: if the function is not reachable (not deployed yet, or a
  // transient infra/network error), fall back to the client-side hash check so
  // sign-in keeps working during the additive rollout, BEFORE the function is
  // live. A wrong PIN or a rate-limit lock is NEVER a fallback trigger, so the
  // server lock cannot be bypassed by going offline. Once the rules require
  // request.auth (Phase 2), this fallback is removed and the token is mandatory.
  // Returns { ok:true } or { ok:false, msg }.
  async function authenticateStudentPin(username, p, pin) {
    var w = fb();
    if (w && w._functions && w._httpsCallable) {
      try {
        var callable = w._httpsCallable(w._functions, 'signInWithPin');
        var res = await callable({ username: username, pin: String(pin) });
        var token = res && res.data && res.data.token;
        if (token && w._authFns && w._authFns.signInWithCustomToken) {
          await w._authFns.signInWithCustomToken(w._adminAuth, token);
        }
        return { ok: true };
      } catch (err) {
        var code = err && err.code ? String(err.code) : '';
        if (code === 'functions/permission-denied' || code === 'permission-denied'
          || code === 'functions/invalid-argument' || code === 'invalid-argument') {
          return { ok: false, msg: 'That PIN is not right. Try again, or ask your instructor to reset it.' };
        }
        if (code === 'functions/resource-exhausted' || code === 'resource-exhausted') {
          return { ok: false, msg: (err && err.message) || 'Too many tries. Wait a few minutes and try again.' };
        }
        // Anything else (not-found = not deployed, unavailable, internal,
        // network) falls through to the local check below.
      }
    }
    if (!window.CueolaPin) return { ok: false, msg: 'PIN check is not available. Reload and try again.' };
    // Once the server owns sign-in, the gate profile no longer carries the hash
    // (getSignInStage deliberately withholds it), so there is nothing to check
    // locally. Fail closed with an honest message rather than reporting a
    // correct PIN as wrong.
    if (!p || !p.pinSalt || !p.pinHash) {
      return { ok: false, msg: 'Could not reach the sign-in service. Check the connection and try again.' };
    }
    var good = false;
    try { good = await window.CueolaPin.verify(pin, p.pinSalt, p.pinHash); } catch (e) { good = false; }
    if (!good) return { ok: false, msg: 'That PIN is not right. Try again, or ask your instructor to reset it.' };
    return { ok: true };
  }

  // Student PIN check: server-verified, then adopt identity.
  async function enterWithPin(username, p, pin) {
    var auth = await authenticateStudentPin(username, p, pin);
    if (!auth.ok) return { ok: false, msg: auth.msg };
    return finalizeSignIn(username, p);
  }

  // Student sets a first PIN (a legacy profile with none, or after an
  // instructor reset).
  //
  // SECURITY (Phase 3): this used to be open. Anyone who knew a username could
  // arrive at the set-PIN gate and take the account, which was the original
  // impersonation hole surviving in a corner. Claiming a PIN now requires the
  // ACTIVE class login code, the same proof of class membership that creating a
  // profile requires, and the server refuses to overwrite a PIN that already
  // exists (that path is sign-in, or an instructor reset).
  async function enterWithNewPin(username, p, pin, confirmPin, code) {
    if (!window.CueolaPin) return { ok: false, msg: 'PIN setup is not available. Reload and try again.' };
    var v = window.CueolaPin.validate(pin);
    if (!v.ok) return { ok: false, msg: v.msg };
    if (String(pin) !== String(confirmPin)) return { ok: false, msg: 'The two PINs do not match.' };
    var cleanCode = normalizeCode(code);
    if (!cleanCode) return { ok: false, msg: 'Enter your class login code to set a PIN.' };
    var w = fb(); if (!w) return { ok: false, msg: 'Cloud connection is not ready. Try again in a moment.' };

    try {
      var res = await callFn('claimPin', { username: username, code: cleanCode, pin: pin });
      if (res && res.token && w._authFns && w._authFns.signInWithCustomToken) {
        await w._authFns.signInWithCustomToken(w._adminAuth, res.token);
      }
      if (res) return finalizeSignIn(username, p);
    } catch (err) {
      var c = err && err.code ? String(err.code) : '';
      if (c.indexOf('permission-denied') >= 0 || c.indexOf('failed-precondition') >= 0 || c.indexOf('invalid-argument') >= 0) {
        return { ok: false, msg: (err && err.message) || 'Could not set that PIN.' };
      }
      // Not deployed / unreachable: fall through to the legacy path below.
    }

    // Pre-Phase-3 path: write the hash onto the profile, then sign in.
    if (!w._updateDoc) return { ok: false, msg: 'Cloud connection is not ready. Try again in a moment.' };
    var fields;
    try { fields = await window.CueolaPin.make(pin, username); }
    catch (e) { return { ok: false, msg: (e && e.message) || 'That PIN is too easy to guess.' }; }
    try { await w._updateDoc(w._doc(w._db, 'profiles', username), fields); }
    catch (e) { return { ok: false, msg: 'Could not save your PIN. Check the connection and try again.' }; }
    p.pinSalt = fields.pinSalt; p.pinHash = fields.pinHash; p.pinSetAt = fields.pinSetAt;
    var auth = await authenticateStudentPin(username, p, pin);
    if (!auth.ok) return { ok: false, msg: auth.msg };
    return finalizeSignIn(username, p);
  }

  // Admin password gate. If a real Firebase Auth session is already live for
  // this username (persisted, or the dashboard signed in on this origin), it
  // stands in for the password; otherwise the password is required. No
  // password, no admin sign-in, so profile.role 'admin' alone never confers
  // instructor standing.
  async function enterAsAdmin(username, p, password) {
    var A = window.CueolaAdminAuth;
    if (!A) return { ok: false, msg: 'Admin sign-in is not available on this page.' };
    var existing = null;
    try { existing = A.current(); } catch (e) {}
    if (existing && existing.username === username) return finalizeSignIn(username, p);
    if (!password) return { ok: false, msg: 'needs-password', needsPassword: true };
    try { await A.signIn(username, password); }
    catch (e) { return { ok: false, msg: (e && e.message) || 'Wrong username or password.' }; }
    var sess = null; try { sess = A.current(); } catch (e2) {}
    if (!sess || sess.username !== username) return { ok: false, msg: 'Signed in, but this account is not an authorized admin.' };
    return finalizeSignIn(username, p);
  }

  // Pull the cloud profile's look and theme onto this device.
  function adoptProfileLocally(p) {
    try { if (typeof window.pbSetProfileAvatar === 'function') window.pbSetProfileAvatar(p.avatar); } catch (e) {}
    try {
      if (p.theme && themeIds().indexOf(p.theme) >= 0 && typeof window.applyTheme === 'function') {
        window.applyTheme(p.theme);
        localStorage.setItem('cueola_theme', p.theme);
      }
    } catch (e) {}
    try { if (p.fullName) localStorage.setItem('cueola_last_name', p.fullName); } catch (e) {}
  }

  // cueola-app calls this whenever the device avatar portal saves, so a
  // signed-in user's look follows them to every device via the cloud profile.
  function onDeviceAvatarSaved(avatar) {
    var id = identity(); var w = fb();
    if (!id) return;
    var normalized = normalizeAvatar(avatar);
    // Reflect the new look immediately (front door head + toolbar button);
    // the cloud write follows so it travels to other devices.
    if (cachedProfile && cachedProfile.username === id.username) cachedProfile.avatar = normalized;
    try { renderFrontDoor(); } catch (e) {}
    if (!w || !w._updateDoc) return;
    w._updateDoc(w._doc(w._db, 'profiles', id.username), { avatar: normalized, lastSeen: Date.now() })
      .catch(function () {});
  }

  function bumpLastSeen(username, p) {
    var w = fb(); if (!w || !w._updateDoc) return;
    // Masked update: rules validate the merged doc, so patching one field is fine.
    w._updateDoc(w._doc(w._db, 'profiles', username), { lastSeen: Date.now() }).catch(function () {});
    if (p) p.lastSeen = Date.now();
  }

  async function createProfile(input) {
    var w = fb(); if (!w) return { ok: false, msg: 'Cloud connection is not ready. Try again in a moment.' };
    var code = normalizeCode(input.code);
    if (!code) return { ok: false, msg: 'Enter the class login code your instructor gave you.' };
    var fullName = String(input.fullName || '').trim().replace(/\s+/g, ' ');
    if (!fullName || fullName.length > 120) return { ok: false, msg: 'Enter your full name (up to 120 characters).' };
    var username = normalizeUsername(input.username);
    if (!username) return { ok: false, msg: 'Pick a username: 3 to 40 characters, lowercase letters, numbers, dots or dashes, starting with a letter or number.' };

    // Server-side creation is the Phase 2 path: profiles/{username} create
    // becomes admin-only, and a brand-new student has no token to satisfy any
    // rule. createStudentProfile validates the code, checks the username
    // atomically, enforces PIN strength server-side, writes the doc with the
    // Admin SDK, and returns a token in the SAME call, which guarantees
    // uid === profileId (the invariant every self-write rule depends on).
    try {
      var made = await callFn('createStudentProfile', {
        code: code, username: username, fullName: fullName, pin: input.pin,
        avatar: normalizeAvatar(input.avatar),
        theme: themeIds().indexOf(input.theme) >= 0 ? input.theme : 'cool',
        sessions: String(input.sessions || ''),
      });
      if (made && made.profile) {
        if (made.token && w._authFns && w._authFns.signInWithCustomToken) {
          try { await w._authFns.signInWithCustomToken(w._adminAuth, made.token); } catch (e) {}
        }
        rememberIdentity(username, made.profile);
        markUnlocked(username);
        cachedProfile = made.profile;
        announceIdentityChange();
        adoptProfileLocally(made.profile);
        renderFrontDoor();
        return { ok: true, profile: made.profile };
      }
    } catch (err) {
      var c = err && err.code ? String(err.code) : '';
      // Real, actionable rejections stop here. Anything else (not deployed,
      // unavailable, network) falls through to the legacy client-side create.
      if (c.indexOf('already-exists') >= 0) return { ok: false, msg: 'That username is taken. Pick another one.' };
      if (c.indexOf('invalid-argument') >= 0 || c.indexOf('permission-denied') >= 0) {
        return { ok: false, msg: (err && err.message) || 'Could not create the profile.' };
      }
    }

    var codeDoc;
    try { codeDoc = await fetchCode(code); }
    catch (e) { return { ok: false, msg: 'Could not check that login code. Check the connection.' }; }
    if (!codeDoc) return { ok: false, msg: 'That login code does not exist. Check it with your instructor.' };
    if (codeDoc.active !== true) return { ok: false, msg: 'That login code has been revoked. Ask your instructor for the current one.' };

    var existing;
    try { existing = await fetchProfile(username); } catch (e) { existing = null; }
    if (existing) return { ok: false, msg: '“' + esc(username) + '” is taken. Pick another username.' };

    var sessions = [];
    String(input.sessions || '').split(/[\s,]+/).forEach(function (raw) {
      var s = raw.trim().toUpperCase();
      if (s && SESSION_CODE_RE.test(s) && sessions.indexOf(s) < 0) sessions.push(s);
    });

    var role = codeDoc.role === 'admin' ? 'admin' : 'student';
    var doc = {
      username: username,
      profileId: newProfileId(),
      profileAliases: [],
      fullName: fullName,
      role: role,   // rules verify this matches the code doc
      avatar: normalizeAvatar(input.avatar),
      theme: themeIds().indexOf(input.theme) >= 0 ? input.theme : 'cool',
      sessions: sessions.slice(0, 100),
      codeUsed: code,
      createdAt: Date.now(),
      lastSeen: Date.now(),
    };
    // Students carry a PIN from the wizard; admins authenticate with their
    // Firebase password, so their profile carries no PIN.
    if (role !== 'admin') {
      if (!window.CueolaPin) return { ok: false, msg: 'PIN setup is not available. Reload and try again.' };
      var pinFields;
      try { pinFields = await window.CueolaPin.make(input.pin, username); }
      catch (e) { return { ok: false, msg: (e && e.message) || 'Pick a 4 digit PIN that is not too easy to guess.' }; }
      doc.pinSalt = pinFields.pinSalt; doc.pinHash = pinFields.pinHash; doc.pinSetAt = pinFields.pinSetAt;
    }
    try {
      await w._setDoc(w._doc(w._db, 'profiles', username), doc);
    } catch (e) {
      return { ok: false, msg: e && e.code === 'permission-denied'
        ? 'The profile was rejected. The login code may have just been revoked.'
        : 'Could not save the profile. Check the connection and try again.' };
    }
    // A brand-new student authenticates through the same server path so they
    // leave the wizard already holding a real token (best-effort in Phase 1:
    // if the function is not live yet, they proceed with the local unlock and
    // pick up a token on their next PIN sign-in).
    if (role !== 'admin') { try { await authenticateStudentPin(username, doc, input.pin); } catch (e) {} }
    rememberIdentity(username, doc);
    markUnlocked(username);   // creating your profile proves who you are on this device
    cachedProfile = doc;
    announceIdentityChange();
    adoptProfileLocally(doc);
    renderFrontDoor();
    return { ok: true, profile: doc };
  }

  async function attachSessions(codes) {
    var id = identity(); var w = fb();
    if (!id || !w || !w._updateDoc) return { ok: false };
    // Fresh read, mirroring detachSessions: cachedProfile may be stale, or the
    // minimal getSignInStage stub with NO sessions field, and a full-array
    // write from either wipes sessions an instructor assigned meanwhile.
    var p;
    try { p = await fetchProfile(id.username); } catch (e) { p = null; }
    if (!p) return { ok: false, msg: 'Could not load your profile. Check the connection and try again.' };
    var merged = (p.sessions || []).slice();
    var added = [];
    (codes || []).forEach(function (raw) {
      var s = String(raw || '').trim().toUpperCase();
      if (s && SESSION_CODE_RE.test(s) && merged.indexOf(s) < 0 && merged.length < 100) { merged.push(s); added.push(s); }
    });
    if (!added.length) return { ok: true, added: [] };
    try {
      if (w._arrayUnion) {
        await w._updateDoc(w._doc(w._db, 'profiles', id.username), {
          sessions: w._arrayUnion.apply(null, added), lastSeen: Date.now(),
        });
      } else {
        await w._updateDoc(w._doc(w._db, 'profiles', id.username), { sessions: merged, lastSeen: Date.now() });
      }
      p.sessions = merged; cachedProfile = p;
      renderFrontDoor();
      return { ok: true, added: added };
    } catch (e) { return { ok: false, msg: 'Could not save the session to your profile.' }; }
  }

  // The remove half of attachSessions: drop codes from the profile's sessions
  // array. Rules allow shrinking the array (validProfile just checks the list
  // shape), so this works for self-service removal in the hub and for the
  // instructor-side unassign in the Admin panel (which edits other profiles
  // through its own writer, not this one).
  async function detachSessions(codes) {
    var id = identity(); var w = fb();
    if (!id || !w || !w._updateDoc) return { ok: false };
    // Fresh read, never cachedProfile: an instructor may have assigned a new
    // session since this device rendered, and a stale full-array write would
    // silently drop it. arrayRemove keeps the write itself atomic too.
    var p;
    try { p = await fetchProfile(id.username); } catch (e) { p = null; }
    if (!p) return { ok: false, msg: 'Could not load your profile. Check the connection and try again.' };
    var drop = (codes || []).map(function (raw) { return String(raw || '').trim().toUpperCase(); }).filter(Boolean);
    var kept = (p.sessions || []).filter(function (s) { return drop.indexOf(String(s).toUpperCase()) < 0; });
    // arrayRemove matches exact values, so drop the stored spellings, not the
    // normalized input (legacy lowercase codes would otherwise survive).
    var stored = (p.sessions || []).filter(function (s) { return drop.indexOf(String(s).toUpperCase()) >= 0; });
    var removed = stored.length;
    if (!removed) return { ok: true, removed: 0 };
    try {
      if (w._arrayRemove) {
        await w._updateDoc(w._doc(w._db, 'profiles', id.username), {
          sessions: w._arrayRemove.apply(null, stored), lastSeen: Date.now(),
        });
      } else {
        await w._updateDoc(w._doc(w._db, 'profiles', id.username), { sessions: kept, lastSeen: Date.now() });
      }
      p.sessions = kept; cachedProfile = p;
      renderFrontDoor();
      return { ok: true, removed: removed };
    } catch (e) { return { ok: false, msg: 'Could not remove the session from your profile.' }; }
  }

  // Called by the app after any successful session join. If the operator joined
  // under their profile's name, quietly attach the session to the profile.
  function profileIdentityForJoin(nameUsed) {
    if (!cachedProfile) return null;
    if (nameKey(nameUsed) !== nameKey(cachedProfile.fullName)) return null;
    return canonicalProfileIdentity(cachedProfile);
  }

  function decorateJoinNameInput(input, profile) {
    if (!input) return;
    var joined = profile && nameKey(input.value) === nameKey(profile.fullName)
      ? canonicalProfileIdentity(profile)
      : null;
    if (joined) {
      input.dataset.profileId = joined.profileId;
      input.dataset.profileUsername = joined.username;
      input.dataset.profileNameKey = nameKey(profile.fullName);
    } else {
      delete input.dataset.profileId;
      delete input.dataset.profileUsername;
      delete input.dataset.profileNameKey;
    }
    if (!input.dataset.profileIdentityBound) {
      input.dataset.profileIdentityBound = '1';
      input.addEventListener('input', function () {
        decorateJoinNameInput(input, cachedProfile);
      });
    }
  }

  function noteJoin(code, nameUsed) {
    var id = identity(); var joined = profileIdentityForJoin(nameUsed);
    if (!id || !joined) return null;
    attachSessions([code]);
    return joined;
  }

  /* ── per-session "require login code on entry" gate ──
   * Called from joinSession/joinPreProSession after the session doc is read.
   * Returns { pass, msg?, needsInput? }. A signed-in profile whose login code
   * is still active passes silently; everyone else must type an active code. */
  async function entrySatisfied(sessionDoc, inputId) {
    if (!sessionDoc || sessionDoc.requireLoginCode !== true) return { pass: true };
    var id = identity();
    if (id) {
      // A cachedProfile without a sessions array is the minimal sign-in stub
      // (no codeUsed either): refetch rather than wrongly re-demanding a code.
      var cp = (cachedProfile && Array.isArray(cachedProfile.sessions)) ? cachedProfile : null;
      var p = cp || await fetchProfile(id.username).catch(function () { return null; });
      if (p && p.codeUsed) {
        var own = await fetchCode(p.codeUsed).catch(function () { return null; });
        if (own && own.active === true) return { pass: true };
      }
    }
    var input = document.getElementById(inputId);
    var typed = normalizeCode(input && input.value);
    if (!typed) return { pass: false, needsInput: true, msg: 'This session requires your class login code to enter.' };
    var codeDoc = await fetchCode(typed).catch(function () { return null; });
    if (!codeDoc || codeDoc.active !== true) return { pass: false, needsInput: true, msg: 'That login code is not active. Check it with your instructor.' };
    return { pass: true };
  }
  function revealEntryCodeRow(rowId) {
    var row = document.getElementById(rowId);
    if (row) { row.hidden = false; var inEl = row.querySelector('input'); if (inEl) inEl.focus(); }
  }

  /* ── join-modal decoration: the profile strip ── */
  function decorateJoin(kind) {
    var stripId = kind === 'stud' ? 'stud-identity-strip' : 'pp-identity-strip';
    var nameId = kind === 'stud' ? 'stud-name' : 'pp-join-name';
    var strip = document.getElementById(stripId);
    var codeRow = document.getElementById(kind === 'stud' ? 'stud-entrycode-row' : 'pp-entrycode-row');
    if (codeRow) {
      codeRow.hidden = true;
      var codeIn = codeRow.querySelector('input');
      if (codeIn) codeIn.value = '';   // never carry a stale code between attempts
    }
    if (!strip) return;
    var id = identity();
    if (!id) {
      var anonymousName = document.getElementById(nameId);
      if (anonymousName) {
        delete anonymousName.dataset.profileId;
        delete anonymousName.dataset.profileUsername;
        delete anonymousName.dataset.profileNameKey;
      }
      strip.hidden = false;
      strip.innerHTML = '<span class="jis-hint">Have a profile?</span>' +
        '<button type="button" class="jis-btn" onclick="CueolaIdentity.openSignIn(&quot;' + kind + '&quot;)">Use my username</button>';
      return;
    }
    var label = cachedProfile ? cachedProfile.fullName : id.username;
    var chips = '';
    if (cachedProfile && Array.isArray(cachedProfile.sessions) && cachedProfile.sessions.length) {
      chips = '<div class="jis-codes">' + cachedProfile.sessions.slice(0, 6).map(function (c) {
        var arg = JSON.stringify(String(c)).replace(/"/g, '&quot;');
        return '<button type="button" class="jis-code" onclick="CueolaIdentity.pickSession(&quot;' + kind + '&quot;,' + arg + ')">' + esc(c) + '</button>';
      }).join('') + '</div>';
    }
    strip.hidden = false;
    strip.innerHTML = '<span class="jis-who">Joining as <b>' + esc(label) + '</b> <span class="jis-user">@' + esc(id.username) + '</span></span>' +
      '<button type="button" class="jis-btn" onclick="CueolaIdentity.openHub()">Profile</button>' + chips;
    var nameIn = document.getElementById(nameId);
    if (nameIn && !nameIn.value && cachedProfile) nameIn.value = cachedProfile.fullName;
    if (nameIn && cachedProfile) decorateJoinNameInput(nameIn, cachedProfile);
    if (!cachedProfile) {
      fetchProfile(id.username).then(function (p) {
        if (!p) return;
        cachedProfile = p;
        var el = document.getElementById(nameId);
        if (el && !el.value) el.value = p.fullName;
        decorateJoinNameInput(el, p);
        decorateJoin(kind);
      }).catch(function () {});
    }
  }

  // A saved-session chip in a join modal: fill the code (and name) for one tap.
  function pickSession(kind, code) {
    var codeIn = document.getElementById(kind === 'stud' ? 'stud-code' : 'pp-join-code');
    if (codeIn) codeIn.value = String(code || '');
    var nameIn = document.getElementById(kind === 'stud' ? 'stud-name' : 'pp-join-name');
    if (nameIn && !nameIn.value && cachedProfile) nameIn.value = cachedProfile.fullName;
    if (nameIn && cachedProfile) decorateJoinNameInput(nameIn, cachedProfile);
    if (nameIn && !nameIn.value) nameIn.focus();
  }


  /* ══════════════════════ UI: hub / sign-in / wizard / portal ══════════════ */
  // Where to land after a successful sign-in: 'stud' | 'pp' reopen their join
  // modals; any other value is a return target ('keywi' or a screen id) that
  // routes through returnToScreen. Null lands in the portal, as always.
  var afterSignIn = null;
  var wizard = null;        // create-profile state

  function body() { return document.getElementById('identityBody'); }
  function setTitle(t, sub) {
    var el = document.getElementById('identityTitle'); if (el) el.innerHTML = t;
    var s = document.getElementById('identitySub'); if (s) { s.textContent = sub || ''; s.style.display = sub ? '' : 'none'; }
  }

  function openHub() {
    open('identityModal');
    if (identity()) renderPortal(); else renderHub();
  }
  function openSignIn(returnTo) {
    // Accepts the legacy string kind ('stud' | 'pp') or an options object
    // { returnTo: 'keywi' | <screen id> }. No-arg behaves exactly as before.
    var target = (returnTo && typeof returnTo === 'object') ? returnTo.returnTo : returnTo;
    afterSignIn = target || null;
    if (target === 'stud' || target === 'pp') close(target === 'stud' ? 'modal-stud' : 'modal-prepro-join');
    open('identityModal');
    renderSignIn();
  }
  // Route a non-join returnTo target after sign-in. 'keywi' opens the KeyWi
  // Bird control surface through its own (login-gated) front door; any other
  // value is honored when it names a .screen element, switched the same way
  // the app routes screens (single .screen.on). Returns true when it navigated.
  function returnToScreen(target) {
    if (!target || typeof target !== 'string') return false;
    if (target === 'keywi') {
      try {
        if (typeof window.openControlSurface === 'function') { window.openControlSurface(); return true; }
      } catch (e) {}
      return false;
    }
    var el = document.getElementById(target);
    if (!el || !el.classList || !el.classList.contains('screen')) return false;
    try {
      var on = document.querySelectorAll('.screen.on');
      for (var i = 0; i < on.length; i++) on[i].classList.remove('on');
      el.classList.add('on');
      return true;
    } catch (e) { return false; }
  }

  function renderHub() {
    setTitle('Your Cueola profile', 'One profile for every session. No password, just your class login code.');
    body().innerHTML =
      '<div class="id-choice-grid">' +
      '  <button type="button" class="id-choice" onclick="CueolaIdentity.startCreate()">' +
      '    <span class="id-choice-title">Create profile</span>' +
      '    <span class="id-choice-sub">First time here. I have a login code from my instructor.</span></button>' +
      '  <button type="button" class="id-choice" onclick="CueolaIdentity.renderSignIn()">' +
      '    <span class="id-choice-title">I have a username</span>' +
      '    <span class="id-choice-sub">Sign in on this device. No password needed.</span></button>' +
      '  <button type="button" class="id-choice ghost" onclick="CueolaIdentity.deviceOnlyLook()">' +
      '    <span class="id-choice-title">Just pick an avatar</span>' +
      '    <span class="id-choice-sub">Device-only look for the notes board, no profile.</span></button>' +
      '</div>';
  }
  function deviceOnlyLook() {
    close('identityModal');
    try { window.openUserPortal(); } catch (e) {}
  }

  function renderSignIn() {
    setTitle('Sign in with your username', 'No password. Usernames are managed by your instructors.');
    body().innerHTML =
      '<div class="field"><label class="field-lbl">Username</label>' +
      '<input class="field-in" id="id-signin-username" type="text" maxlength="40" placeholder="e.g. alex.j" autocapitalize="none" autocomplete="off"></div>' +
      '<div class="modal-err" id="id-signin-err"></div>' +
      '<button class="btn-primary" onclick="CueolaIdentity.submitSignIn()">Sign in</button>' +
      '<button class="btn-secondary" onclick="CueolaIdentity.renderHub()">Back</button>';
    var el = document.getElementById('id-signin-username');
    if (el) { el.focus(); el.addEventListener('keydown', function (e) { if (e.key === 'Enter') submitSignIn(); }); }
  }
  async function submitSignIn() {
    var el = document.getElementById('id-signin-username');
    var err = document.getElementById('id-signin-err');
    var r = await resolveGate(el && el.value);
    if (!r.ok) { if (err) { err.innerHTML = r.msg; err.classList.add('on'); } return; }
    rememberIdentity(r.username, r.profile);   // persist WHO; device stays locked until the factor passes
    await renderModalGate();
  }
  // The same PIN / set-PIN / admin-password gate as the front door, rendered
  // inside the identity modal so the join flows keep working.
  async function renderModalGate() {
    var g = pendingGate; if (!g) return renderSignIn();
    if (g.stage === 'password') {
      var pre = await enterAsAdmin(g.username, g.profile, '');
      if (pre.ok) return afterModalSignIn(pre.profile);
      setTitle('Instructor sign-in', 'Enter your instructor password to continue as @' + esc(g.username) + '.');
      body().innerHTML =
        '<div class="field"><label class="field-lbl">Password</label>' +
        '<input class="field-in" id="id-gate-pw" type="password" autocomplete="current-password"></div>' +
        '<div class="modal-err" id="id-gate-err"></div>' +
        '<button class="btn-primary" onclick="CueolaIdentity.submitModalPassword()">Sign in</button>' +
        '<button class="btn-secondary" onclick="CueolaIdentity.frontDoorNotMe()">Not you?</button>';
      focusGate('id-gate-pw', submitModalPassword);
      return;
    }
    if (g.stage === 'setPin') {
      setTitle('Set a PIN to continue', 'Pick a 4 digit PIN so only you can sign in as @' + esc(g.username) + '. Your class login code confirms this account is yours.');
      body().innerHTML =
        '<div class="field"><label class="field-lbl">Class login code</label>' +
        '<input class="field-in id-code-in" id="id-gate-code" type="text" maxlength="80" autocapitalize="characters" autocomplete="off" placeholder="e.g. FALL26TV"></div>' +
        '<div class="field"><label class="field-lbl">New PIN</label>' +
        '<input class="field-in" id="id-gate-pin" type="password" inputmode="numeric" maxlength="4" autocomplete="off"></div>' +
        '<div class="field"><label class="field-lbl">Repeat PIN</label>' +
        '<input class="field-in" id="id-gate-pin2" type="password" inputmode="numeric" maxlength="4" autocomplete="off"></div>' +
        '<div class="modal-err" id="id-gate-err"></div>' +
        '<button class="btn-primary" onclick="CueolaIdentity.submitModalNewPin()">Save and continue</button>' +
        '<button class="btn-secondary" onclick="CueolaIdentity.frontDoorNotMe()">Not you?</button>';
      focusGate('id-gate-code', submitModalNewPin, 'id-gate-pin2');
      return;
    }
    setTitle('Enter your PIN', 'Enter your 4 digit PIN to continue as @' + esc(g.username) + '.');
    body().innerHTML =
      '<div class="field"><label class="field-lbl">PIN</label>' +
      '<input class="field-in" id="id-gate-pin" type="password" inputmode="numeric" maxlength="4" autocomplete="off"></div>' +
      '<div class="modal-err" id="id-gate-err"></div>' +
      '<button class="btn-primary" onclick="CueolaIdentity.submitModalPin()">Sign in</button>' +
      '<button class="btn-secondary" onclick="CueolaIdentity.frontDoorNotMe()">Not you?</button>';
    focusGate('id-gate-pin', submitModalPin);
  }
  function focusGate(id, onEnter, enterFromId) {
    var el = document.getElementById(id);
    if (el) el.focus();
    var trigger = document.getElementById(enterFromId || id);
    if (trigger) trigger.addEventListener('keydown', function (e) { if (e.key === 'Enter') onEnter(); });
  }
  function modalGateErr(msg) {
    var err = document.getElementById('id-gate-err');
    if (err) { err.innerHTML = esc(msg); err.classList.add('on'); }
  }
  function afterModalSignIn(profile) {
    say('Signed in as ' + (profile && profile.fullName ? profile.fullName : 'you') + '.');
    if (afterSignIn) {
      var kind = afterSignIn; afterSignIn = null;
      if (kind === 'stud') { close('identityModal'); try { window.openJoinSession(); } catch (e) {} return; }
      if (kind === 'pp') { close('identityModal'); try { window.openPreProJoinModal('hub'); } catch (e) {} return; }
      // Screen-return targets ('keywi', or a screen id): go back where the
      // user was headed instead of stranding them in the portal. An unknown
      // target falls through to the portal, the safe default.
      if (returnToScreen(kind)) { close('identityModal'); return; }
    }
    renderPortal();
  }
  async function submitModalPin() {
    return gateGuarded('#identityBody .btn-primary', async function () {
      var g = pendingGate; if (!g) return renderSignIn();
      var el = document.getElementById('id-gate-pin');
      var res = await enterWithPin(g.username, g.profile, el && el.value);
      if (!res.ok) return modalGateErr(res.msg);
      afterModalSignIn(res.profile);
    });
  }
  async function submitModalNewPin() {
    return gateGuarded('#identityBody .btn-primary', async function () {
      var g = pendingGate; if (!g) return renderSignIn();
      var a = document.getElementById('id-gate-pin'), b = document.getElementById('id-gate-pin2');
      var codeEl = document.getElementById('id-gate-code');
      var res = await enterWithNewPin(g.username, g.profile, a && a.value, b && b.value, codeEl && codeEl.value);
      if (!res.ok) return modalGateErr(res.msg);
      afterModalSignIn(res.profile);
    });
  }
  async function submitModalPassword() {
    return gateGuarded('#identityBody .btn-primary', async function () {
      var g = pendingGate; if (!g) return renderSignIn();
      var el = document.getElementById('id-gate-pw');
      var res = await enterAsAdmin(g.username, g.profile, (el && el.value) || '');
      if (!res.ok) return modalGateErr(res.msg === 'needs-password' ? 'Enter your password.' : res.msg);
      afterModalSignIn(res.profile);
    });
  }

  /* ── create-profile wizard ── */
  function startCreate() {
    wizard = { step: 0, code: '', fullName: '', username: '', pin: '', pin2: '', avatar: { type: 'initials' }, theme: themeIds()[0] || 'cool', sessions: '' };
    open('identityModal');
    renderCreate();
  }
  // The wizard walks an ordered list of step KEYS, not fixed indices, so the
  // student-only PIN step can slot in without renumbering. Admins authenticate
  // with a Firebase password, never a PIN, so their code skips it entirely.
  function wizardKeys() {
    var w = wizard;
    if (w && w.codeRole === 'admin') return ['code', 'name', 'look', 'sessions'];
    return ['code', 'name', 'pin', 'look', 'sessions'];
  }
  var WIZ_STEP_LABEL = { code: 'Login code', name: 'Name & username', pin: 'Your PIN', look: 'Look & theme', sessions: 'Your sessions' };
  function renderCreate() {
    var w = wizard; if (!w) return startCreate();
    var keys = wizardKeys();
    if (w.step >= keys.length) w.step = keys.length - 1;
    var key = keys[w.step];
    var n = keys.length;
    var dots = keys.map(function (k, i) {
      return '<span class="id-step' + (i === w.step ? ' on' : i < w.step ? ' done' : '') + '">' + esc(WIZ_STEP_LABEL[k]) + '</span>';
    }).join('');
    var html = '<div class="id-steps">' + dots + '</div>';
    var stepNo = w.step + 1;

    if (key === 'code') {
      setTitle('Create your profile', 'Step ' + stepNo + ' of ' + n + ': the login code your instructor gave the class.');
      html +=
        '<div class="field"><label class="field-lbl">Class login code</label>' +
        '<input class="field-in id-code-in" id="id-create-code" type="text" maxlength="80" placeholder="e.g. FALL26TV" autocapitalize="characters" autocomplete="off" value="' + esc(w.code) + '"></div>' +
        '<div class="modal-err" id="id-create-err"></div>' +
        '<button class="btn-primary" onclick="CueolaIdentity.wizardNext()">Continue</button>' +
        '<button class="btn-secondary" onclick="CueolaIdentity.renderHub()">Back</button>';
    } else if (key === 'name') {
      setTitle('Create your profile', 'Step ' + stepNo + ' of ' + n + ': how you appear to the crew, and your username.');
      html +=
        '<div class="field"><label class="field-lbl">Full name</label>' +
        '<input class="field-in" id="id-create-fullname" type="text" maxlength="120" placeholder="e.g. Alex Johnson" value="' + esc(w.fullName) + '"></div>' +
        '<div class="field"><label class="field-lbl">Username</label>' +
        '<input class="field-in" id="id-create-username" type="text" maxlength="40" placeholder="e.g. alex.j" autocapitalize="none" autocomplete="off" value="' + esc(w.username) + '">' +
        '<div class="id-field-hint">Lowercase letters, numbers, dots and dashes. This is what you type to sign in.</div></div>' +
        '<div class="modal-err" id="id-create-err"></div>' +
        '<button class="btn-primary" onclick="CueolaIdentity.wizardNext()">Continue</button>' +
        '<button class="btn-secondary" onclick="CueolaIdentity.wizardBack()">Back</button>';
    } else if (key === 'pin') {
      setTitle('Create your profile', 'Step ' + stepNo + ' of ' + n + ': a 4 digit PIN so only you can sign in.');
      html +=
        '<div class="field"><label class="field-lbl">PIN</label>' +
        '<input class="field-in" id="id-create-pin" type="password" inputmode="numeric" maxlength="4" autocomplete="off" placeholder="4 digits" value="' + esc(w.pin) + '"></div>' +
        '<div class="field"><label class="field-lbl">Repeat PIN</label>' +
        '<input class="field-in" id="id-create-pin2" type="password" inputmode="numeric" maxlength="4" autocomplete="off" placeholder="4 digits" value="' + esc(w.pin2) + '">' +
        '<div class="id-field-hint">You type this with your username to sign in. Avoid easy ones like 1234, 1111, or your birth year.</div></div>' +
        '<div class="modal-err" id="id-create-err"></div>' +
        '<button class="btn-primary" onclick="CueolaIdentity.wizardNext()">Continue</button>' +
        '<button class="btn-secondary" onclick="CueolaIdentity.wizardBack()">Back</button>';
    } else if (key === 'look') {
      setTitle('Create your profile', 'Step ' + stepNo + ' of ' + n + ': pick your look and theme (changeable later).');
      var initialSel = w.avatar.type === 'initials';
      var grid = '<button type="button" class="id-av' + (initialSel ? ' sel' : '') + '" onclick="CueolaIdentity.wizardPickAvatar(\'initials\')">' +
        '<span class="id-av-chip">' + esc((w.fullName || 'You').split(/\s+/).map(function (p) { return p[0] || ''; }).join('').slice(0, 2).toUpperCase() || '?') + '</span><span>Initials</span></button>';
      // Owner decision 2026-08-03: the picker offers the fun art only; symbols
      // and brand marks are gone. The chip shows the chosen background color.
      var icons = avatarIcons();
      Object.keys(icons).forEach(function (k) {
        var sel = w.avatar.type === 'icon' && w.avatar.value === k;
        var inner = icons[k].src
          ? '<img src="' + esc(icons[k].src) + '" alt="">'
          : '<span class="sf-symbol" data-symbol="' + esc(icons[k].symbol) + '" aria-hidden="true"></span>';
        var bg = sel && w.avatar.bg ? ' style="background:' + esc(w.avatar.bg) + '"' : '';
        grid += '<button type="button" class="id-av' + (sel ? ' sel' : '') + '" onclick="CueolaIdentity.wizardPickAvatar(\'icon\',' + JSON.stringify(k).replace(/"/g, '&quot;') + ')">' +
          '<span class="id-av-chip"' + bg + '>' + inner + '</span><span>' + esc(icons[k].label) + '</span></button>';
      });
      var bgRow = '';
      if (w.avatar.type === 'icon') {
        bgRow = '<div class="field"><label class="field-lbl">Background color</label><div class="id-av-bg-row">' +
          avatarBgChoices().map(function (c) {
            return '<button type="button" class="pb-av-bg' + (w.avatar.bg === c ? ' sel' : '') + '" style="background:' + esc(c) + '" aria-label="Background ' + esc(c) + '" onclick="CueolaIdentity.wizardPickAvatarBg(\'' + esc(c) + '\')"></button>';
          }).join('') + '</div></div>';
      }
      var themes = themeIds().map(function (t) {
        return '<option value="' + esc(t) + '"' + (w.theme === t ? ' selected' : '') + '>' + esc(THEME_LABELS[t] || t) + '</option>';
      }).join('');
      html +=
        '<div class="id-av-grid">' + grid + '</div>' + bgRow +
        '<div class="field"><label class="field-lbl">Theme</label>' +
        '<select class="field-in" id="id-create-theme">' + themes + '</select></div>' +
        '<button class="btn-primary" onclick="CueolaIdentity.wizardNext()">Continue</button>' +
        '<button class="btn-secondary" onclick="CueolaIdentity.wizardBack()">Back</button>';
    } else {
      setTitle('Create your profile', 'Step ' + stepNo + ' of ' + n + ': the show codes you have been given (optional).');
      html +=
        '<div class="field"><label class="field-lbl">Show codes</label>' +
        '<input class="field-in" id="id-create-sessions" type="text" placeholder="e.g. SHOW42, NEWS7 (optional)" autocapitalize="characters" value="' + esc(w.sessions) + '">' +
        '<div class="id-field-hint">Separate multiple codes with commas. You can always add more later.</div></div>' +
        '<div class="modal-err" id="id-create-err"></div>' +
        '<button class="btn-primary" id="id-create-go" onclick="CueolaIdentity.wizardFinish()">Create profile</button>' +
        '<button class="btn-secondary" onclick="CueolaIdentity.wizardBack()">Back</button>';
    }
    body().innerHTML = html;
    var first = body().querySelector('input');
    if (first) first.focus();
  }
  function wizardErr(msg) {
    var err = document.getElementById('id-create-err');
    if (err) { err.innerHTML = msg; err.classList.add('on'); }
  }
  async function wizardNext() {
    var w = wizard; if (!w) return;
    var key = wizardKeys()[w.step];
    if (key === 'code') {
      var code = normalizeCode((document.getElementById('id-create-code') || {}).value);
      if (!code) return wizardErr('Enter the login code your instructor gave you.');
      // checkAccessCode is a Cloud Function: a brand-new student has no token,
      // and once the Phase 2 rules land they cannot read accessCodes directly.
      // It returns only ok + role, so it cannot be used to harvest class labels
      // or instructor names. Falls back to the direct read until it is live.
      var checked = null;
      try { checked = await callFn('checkAccessCode', { code: code }); } catch (e) { checked = null; }
      if (checked) {
        if (!checked.ok) {
          return wizardErr(checked.reason === 'revoked'
            ? 'That login code has been revoked. Ask your instructor for the current one.'
            : 'That login code does not exist. Check it with your instructor.');
        }
        w.code = code; w.codeRole = checked.role;
      } else {
        var codeDoc = await fetchCode(code).catch(function () { return null; });
        if (!codeDoc) return wizardErr('That login code does not exist. Check it with your instructor.');
        if (codeDoc.active !== true) return wizardErr('That login code has been revoked. Ask your instructor for the current one.');
        w.code = code; w.codeRole = codeDoc.role; w.codeLabel = codeDoc.label;
      }
    } else if (key === 'name') {
      w.fullName = String((document.getElementById('id-create-fullname') || {}).value || '').trim().replace(/\s+/g, ' ');
      var u = normalizeUsername((document.getElementById('id-create-username') || {}).value);
      if (!w.fullName) return wizardErr('Enter your full name.');
      if (!u) return wizardErr('Usernames are 3 to 40 characters: lowercase letters, numbers, dots and dashes.');
      // Best-effort early "taken" check. It needs an unauthenticated profiles
      // read, which Phase 2 removes, so a miss here is not fatal: the authority
      // is createStudentProfile's atomic create(), which rejects a duplicate.
      var taken = await fetchProfile(u).catch(function () { return null; });
      if (taken) return wizardErr('“' + esc(u) + '” is taken. Pick another username.');
      w.username = u;
    } else if (key === 'pin') {
      var pin = String((document.getElementById('id-create-pin') || {}).value || '');
      var pin2 = String((document.getElementById('id-create-pin2') || {}).value || '');
      var v = window.CueolaPin ? window.CueolaPin.validate(pin) : { ok: false, msg: 'PIN setup is not available. Reload and try again.' };
      if (!v.ok) return wizardErr(v.msg);
      if (pin !== pin2) return wizardErr('The two PINs do not match.');
      w.pin = pin; w.pin2 = pin2;
    } else if (key === 'look') {
      var sel = document.getElementById('id-create-theme');
      if (sel) w.theme = sel.value;
    }
    w.step = Math.min(w.step + 1, wizardKeys().length - 1);
    renderCreate();
  }
  function wizardBack() {
    if (!wizard) return renderHub();
    // Persist the PIN fields before leaving the step so Back does not lose them.
    var key = wizardKeys()[wizard.step];
    if (key === 'pin') {
      wizard.pin = String((document.getElementById('id-create-pin') || {}).value || '');
      wizard.pin2 = String((document.getElementById('id-create-pin2') || {}).value || '');
    }
    if (wizard.step > 0) { wizard.step--; renderCreate(); } else renderHub();
  }
  function wizardPickAvatar(type, value) {
    if (!wizard) return;
    // Switching icons keeps the background the user already chose.
    var keepBg = wizard.avatar && wizard.avatar.bg;
    wizard.avatar = normalizeAvatar(type === 'animal' || type === 'icon'
      ? { type: type, value: value, bg: keepBg } : { type: 'initials' });
    renderCreate();
  }
  function wizardPickAvatarBg(color) {
    if (!wizard || !wizard.avatar || wizard.avatar.type !== 'icon') return;
    wizard.avatar = normalizeAvatar({ type: 'icon', value: wizard.avatar.value, bg: color });
    renderCreate();
  }
  async function wizardFinish() {
    var w = wizard; if (!w) return;
    w.sessions = (document.getElementById('id-create-sessions') || {}).value || '';
    var btn = document.getElementById('id-create-go');
    if (btn) { btn.disabled = true; btn.textContent = 'Creating…'; }
    var res = await createProfile(w);
    if (btn) { btn.disabled = false; btn.textContent = 'Create profile'; }
    if (!res.ok) return wizardErr(res.msg);
    wizard = null;
    say('Welcome, ' + res.profile.fullName + '. Profile created.');
    renderPortal();
  }

  /* ── portal ── */
  function pbLastReadFor(code) {
    try { return Number(localStorage.getItem('cueola_pb_lastread_' + code)) || 0; } catch (e) { return 0; }
  }
  function nameKey(s) { return String(s || '').trim().replace(/\s+/g, ' ').toLowerCase(); }
  function sameName(a, b) { return nameKey(a) === nameKey(b); }

  function uniqueStrings(values) {
    var seen = {};
    return (values || []).map(function (value) { return String(value || '').trim(); }).filter(function (value) {
      var key = value.toLowerCase();
      if (!value || seen[key]) return false;
      seen[key] = true;
      return true;
    });
  }

  function legacyAssignmentRows(doc) {
    // Current Planda Bear storage wins. The top-level array and Dashboard map are
    // migration inputs only and can never override a canonical assignment doc.
    if (doc.prePro && Array.isArray(doc.prePro.roleAssignments)) return doc.prePro.roleAssignments;
    if (Array.isArray(doc.roleAssignments)) return doc.roleAssignments;
    return [];
  }

  function legacyAssignmentSummary(doc, profile) {
    var positions = [];
    var paperwork = [];
    legacyAssignmentRows(doc).forEach(function (row) {
      row = row || {};
      if (!sameName(row.person || row.name, profile.fullName)) return;
      positions.push(row.position || row.role || '');
      var list = row.paperwork || row.paperworkItems || row.file || [];
      paperwork = paperwork.concat(Array.isArray(list) ? list : [list]);
    });
    if (!positions.length) {
      var oldMap = doc.assignments || {};
      for (var name in oldMap) {
        if (sameName(name, profile.fullName) && oldMap[name]) positions.push(oldMap[name]);
      }
    }
    return {
      positions: uniqueStrings(positions),
      paperwork: uniqueStrings(paperwork),
      source: positions.length || paperwork.length ? 'legacy' : 'empty',
    };
  }

  function canonicalAssignmentSummary(records, profile, doc, allowLegacyFallback) {
    var model = assignmentModel();
    var normalized = records.map(function (record) {
      return typeof model.normalizeAssignmentRecord === 'function'
        ? model.normalizeAssignmentRecord(record)
        : record;
    }).filter(Boolean);
    var profileMatches = typeof model.assignmentsForProfile === 'function'
      ? model.assignmentsForProfile(normalized, profile)
      : normalized.filter(function (record) {
          return cleanIdentityIds([profile.profileId].concat(profile.profileAliases || [])).indexOf(record.profileId) >= 0;
        });
    var matched = profileMatches.filter(function (record) {
      return (!record.productionSession || record.productionSession === doc.code)
        && record.status !== 'completed';
    });
    var compatibility = typeof model.compatibilityRows === 'function'
      ? model.compatibilityRows(matched)
      : [];
    var positions = matched.map(function (record) { return record.positionLabel; });
    var paperwork = [];
    matched.forEach(function (record) {
      paperwork = paperwork.concat(record.paperworkLabels || record.paperworkIds || []);
    });
    compatibility.forEach(function (row) {
      positions.push(row && (row.position || row.role));
      var oldPaper = row && (row.paperwork || row.paperworkItems || row.file) || [];
      paperwork = paperwork.concat(Array.isArray(oldPaper) ? oldPaper : [oldPaper]);
    });
    if (!matched.length) {
      // Canonical history for this profile (including completed work) is
      // authoritative. Do not resurrect its stale legacy projection.
      if (profileMatches.length) return { positions: [], paperwork: [], source: 'empty' };
      return allowLegacyFallback === false
        ? { positions: [], paperwork: [], source: 'unavailable' }
        : legacyAssignmentSummary(doc, profile);
    }
    return { positions: uniqueStrings(positions), paperwork: uniqueStrings(paperwork), source: 'canonical' };
  }

  function profileIdentitySet(profile) {
    var model = assignmentModel();
    var ids = typeof model.profileIdentityIds === 'function'
      ? model.profileIdentityIds(profile)
      : [profile.profileId].concat(profile.profileAliases || []);
    var set = {};
    cleanIdentityIds(ids).forEach(function (id) { set[id] = true; });
    return set;
  }

  function identityOwned(item, idFields, nameField, profile, ids) {
    var presentId = '';
    for (var i = 0; i < idFields.length; i++) {
      if (item && item[idFields[i]]) { presentId = String(item[idFields[i]]); break; }
    }
    if (presentId) return Boolean(ids[presentId]);
    return Boolean(item && item[nameField] && sameName(item[nameField], profile.fullName));
  }

  function summarizeSession(code, doc, profile, notesOverride, assignmentSummary) {
    var notes = Array.isArray(notesOverride) ? notesOverride
      : Array.isArray(doc.preProNotes) ? doc.preProNotes : [];
    var todos = 0, mentions = 0, unseen = 0;
    var lastRead = pbLastReadFor(code);
    var identityIds = profileIdentitySet(profile);
    notes.forEach(function (n) {
      if (!n) return;
      var tag = n.tag || (n.kind === 'todo' ? 'todo' : 'general');
      var checklist = Array.isArray(n.checklist) ? n.checklist : [];
      // A todo-tagged note that carries a checklist delegates to its items
      // (mirrors the board's who-owes-what view — no double counting).
      if (tag === 'todo' && !n.done && !checklist.length && identityOwned(n, ['assigneeProfileId'], 'assignee', profile, identityIds)) todos++;
      checklist.forEach(function (it) {
        if (it && !it.done && identityOwned(it, ['assigneeProfileId'], 'assignee', profile, identityIds)) todos++;
      });
      var mine = identityOwned(n, ['byProfileId', 'authorProfileId'], 'by', profile, identityIds);
      // Cloud read receipts win over the device-local lastRead heuristic —
      // reading the board on ANY device clears the note here (Phase 4 item 3).
      var seenByMe = false;
      if (n.seenBy && typeof n.seenBy === 'object') {
        for (var sk in n.seenBy) {
          var seen = n.seenBy[sk];
          if (seen && ((seen.profileId && identityIds[seen.profileId])
              || (!seen.profileId && sameName(seen.name, profile.fullName)))) { seenByMe = true; break; }
        }
      }
      if (!mine && !seenByMe && (n.at || 0) > lastRead) {
        unseen++;
        var mentionedById = Array.isArray(n.mentionProfileIds)
          && n.mentionProfileIds.some(function (id) { return identityIds[id]; });
        var mentionedByName = !Array.isArray(n.mentionProfileIds)
          && Array.isArray(n.mentions)
          && n.mentions.some(function (name) { return sameName(name, profile.fullName); });
        if (mentionedById || mentionedByName) mentions++;
      }
    });
    return {
      code: code,
      showName: doc.showName || 'Untitled Show',
      deleted: !!doc.deletedAt,
      positions: assignmentSummary.positions || [],
      paperwork: assignmentSummary.paperwork || [],
      assignmentSource: assignmentSummary.source,
      todos: todos, unseen: unseen, mentions: mentions,
    };
  }

  function portalReadStatus(error) {
    var code = String(error && error.code || '').toLowerCase();
    if (code === 'permission-denied') return 'denied';
    if (code === 'not-found') return 'missing';
    if (code === 'unavailable' || code === 'deadline-exceeded' || code === 'cancelled'
        || (typeof navigator !== 'undefined' && navigator.onLine === false)) return 'offline';
    return 'error';
  }

  function portalIssueLabel(subject, state, hasFallback) {
    if (state === 'denied') return subject + ' unavailable · access denied';
    if (state === 'offline') return hasFallback ? subject + ' may be out of date · offline' : subject + ' not checked · offline';
    return hasFallback ? subject + ' may be out of date' : 'Couldn’t load ' + subject.toLowerCase();
  }

  async function loadPortalSession(w, code, profile) {
    var entry = {
      code: code, doc: null, sessionStatus: 'ok', sessionError: null,
      assignmentStatus: 'pending', assignmentError: null, assignments: [],
      notesStatus: 'pending', notesError: null, notes: [], notesFallback: false,
    };
    var sessionSnap;
    try {
      var sessionRef = w._doc(w._db, 'sessions', code);
      sessionSnap = await readWithCache(
        function () { return w._getDoc(sessionRef); },
        w._getDocFromCache ? function () { return w._getDocFromCache(sessionRef); } : null
      );
    } catch (error) {
      entry.sessionStatus = portalReadStatus(error);
      entry.sessionError = error;
      return entry;
    }
    if (!sessionSnap.exists()) { entry.sessionStatus = 'missing'; return entry; }
    entry.doc = sessionSnap.data() || {};
    if (entry.doc.deletedAt) { entry.sessionStatus = 'deleted'; return entry; }
    if (sessionSnap.metadata && sessionSnap.metadata.fromCache) entry.sessionStatus = 'offline';

    if (!w._getDocs || !w._collection) {
      entry.assignmentStatus = 'error';
      entry.notesStatus = 'error';
      return entry;
    }

    var assignmentRef = w._collection(w._db, 'sessions', code, 'assignments');
    var assignmentPromise = readWithCache(
      function () { return w._getDocs(assignmentRef); },
      w._getDocsFromCache ? function () { return w._getDocsFromCache(assignmentRef); } : null
    ).then(function (snap) {
      entry.assignmentStatus = snap.metadata && snap.metadata.fromCache ? 'offline' : 'ok';
      snap.forEach(function (docSnap) {
        entry.assignments.push(Object.assign({ assignmentId: docSnap.id }, docSnap.data() || {}));
      });
    }).catch(function (error) {
      entry.assignmentStatus = portalReadStatus(error);
      entry.assignmentError = error;
    });

    var legacyNotes = Array.isArray(entry.doc.preProNotes) ? entry.doc.preProNotes : [];
    var notesRef = w._collection(w._db, 'sessions', code, 'notes');
    var notesPromise = readWithCache(
      function () { return w._getDocs(notesRef); },
      w._getDocsFromCache ? function () { return w._getDocsFromCache(notesRef); } : null
    ).then(function (snap) {
      var byId = {};
      legacyNotes.forEach(function (note) { if (note && note.id) byId[note.id] = note; });
      snap.forEach(function (docSnap) {
        var note = docSnap.data();
        if (note && note.id) byId[note.id] = note;
      });
      entry.notes = Object.keys(byId).map(function (id) { return byId[id]; });
      entry.notesStatus = snap.metadata && snap.metadata.fromCache ? 'offline' : 'ok';
      entry.notesFallback = legacyNotes.length > 0 && entry.notesStatus !== 'ok';
    }).catch(function (error) {
      entry.notesStatus = portalReadStatus(error);
      entry.notesError = error;
      entry.notes = legacyNotes.slice();
      entry.notesFallback = legacyNotes.length > 0;
    });
    await Promise.all([assignmentPromise, notesPromise]);

    if (entry.assignmentStatus === 'ok' || (entry.assignmentStatus === 'offline' && entry.assignments.length)) {
      entry.assignment = canonicalAssignmentSummary(
        entry.assignments,
        profile,
        Object.assign({}, entry.doc, { code: code }),
        entry.assignmentStatus === 'ok'
      );
    } else {
      // A failed canonical query is not an empty assignment. Legacy state is not
      // allowed to hide the failure; it is read only after a successful empty query.
      entry.assignment = { positions: [], paperwork: [], source: 'unavailable' };
    }
    return entry;
  }

  function renderPortalProfileProblem(username, state, detail) {
    var copy = state === 'missing'
      ? 'This saved profile no longer exists.'
      : state === 'denied'
        ? 'Cueola was denied access to this profile.'
        : state === 'offline'
          ? 'Cueola is offline and could not verify this profile.'
          : 'Cueola could not load this profile.';
    setTitle('Your Cueola profile', '@' + username);
    if (body()) body().innerHTML = '<div class="id-portal-empty">' + copy + (detail ? '<br>' + esc(detail) : '') + '</div>' +
      '<div class="id-portal-foot"><button type="button" class="btn-primary" onclick="CueolaIdentity.renderPortal()">Retry</button>' +
      '<button type="button" class="btn-secondary" onclick="CueolaIdentity.signOut()">Sign out on this device</button></div>';
  }

  function unavailableSessionCard(entry) {
    var name = entry.sessionStatus === 'deleted' ? 'Session deleted'
      : entry.sessionStatus === 'missing' ? 'Session not found'
        : entry.sessionStatus === 'denied' ? 'Session access denied'
          : entry.sessionStatus === 'offline' ? 'Session not checked · offline'
            : 'Couldn’t load session';
    var codeArg = JSON.stringify(String(entry.code)).replace(/"/g, '&quot;');
    var actions = '<div class="id-card-actions">'
      + (entry.sessionStatus !== 'deleted'
        ? '<button type="button" class="jis-btn" onclick="CueolaIdentity.renderPortal()">Retry</button>' : '')
      + '<button type="button" class="jis-btn jis-remove" onclick="CueolaIdentity.portalRemoveCode(' + codeArg + ')" data-tip="Remove this session from your profile" aria-label="Remove ' + esc(entry.code) + ' from your profile">Remove</button>'
      + '</div>';
    return '<div class="id-card gone"><div class="id-card-head"><span class="id-card-code">' + esc(entry.code) + '</span>' +
      '<span class="id-card-name">' + esc(name) + '</span></div>' + actions + '</div>';
  }

  async function renderPortal() {
    var requestId = ++portalRequestGeneration;
    var id = identity(); if (!id) return renderHub();
    if (!fb() && typeof window.waitForFirebaseReady === 'function') {
      setTitle('Your Cueola profile', '');
      if (body()) body().innerHTML = '<div class="id-portal-loading">Connecting…</div>';
      try { await window.waitForFirebaseReady(); } catch (error) {}
    }
    if (requestId !== portalRequestGeneration) return;
    var w = fb();
    if (!w) return renderPortalProfileProblem(id.username, 'offline');

    // Always refresh the profile when the portal opens. cachedProfile remains a
    // fast join-strip projection, never the portal's source of truth.
    var p;
    try { p = await fetchProfile(id.username); }
    catch (error) { return renderPortalProfileProblem(id.username, portalReadStatus(error), error && error.message); }
    if (requestId !== portalRequestGeneration) return;
    if (!p) return renderPortalProfileProblem(id.username, 'missing');
    if (p.renamedTo || p.mergedInto) {
      return renderPortalProfileProblem(id.username, 'missing', 'Use @' + (p.renamedTo || p.mergedInto) + ' instead.');
    }
    if (p.active === false) return renderPortalProfileProblem(id.username, 'denied', 'This profile was deactivated by an instructor.');
    cachedProfile = p;
    rememberIdentity(id.username, p);
    setTitle('Hi, ' + esc(p.fullName.split(' ')[0]), '@' + p.username + (p.role === 'admin' ? ' · admin' : '') + '. Your sessions and what needs you.');
    var codes = (p.sessions || []).slice(0, 30);
    var profileWarnings = p._profileReadStatus === 'offline'
      ? '<div class="id-portal-empty">This profile was loaded from offline cache and may be out of date. <button type="button" class="jis-btn" onclick="CueolaIdentity.renderPortal()">Retry</button></div>'
      : '';
    if (p._identityMigrationError) {
      profileWarnings += '<div class="id-portal-empty">Your stable profile identity could not be saved yet. Assignments may be unavailable until cloud access is restored. <button type="button" class="jis-btn" onclick="CueolaIdentity.renderPortal()">Retry</button></div>';
    }
    body().innerHTML = profileWarnings +
      '<div class="id-portal-cards" id="id-portal-cards">' +
      (codes.length ? '<div class="id-portal-loading">Checking your sessions…</div>'
                    : '<div class="id-portal-empty">No sessions on your profile yet. Add a show code below.</div>') +
      '</div>' +
      '<div class="id-addcode-row"><input class="field-in" id="id-portal-addcode" type="text" placeholder="Add a show code…" autocapitalize="characters">' +
      '<button type="button" class="jis-btn" onclick="CueolaIdentity.portalAddCode()">Add</button></div>' +
      '<div class="id-portal-foot">' +
      '  <button type="button" class="btn-secondary" onclick="CueolaIdentity.deviceOnlyLook()">Edit look</button>' +
      '  <button type="button" class="btn-secondary" onclick="CueolaIdentity.signOut()">Sign out on this device</button>' +
      '</div>';
    if (!codes.length) return;

    var docs = await Promise.all(codes.map(function (code) { return loadPortalSession(w, code, p); }));
    if (requestId !== portalRequestGeneration) return;
    var wrap = document.getElementById('id-portal-cards');
    if (!wrap) return;
    wrap.innerHTML = docs.map(function (entry) {
      if (!entry.doc || entry.sessionStatus === 'missing' || entry.sessionStatus === 'deleted'
          || entry.sessionStatus === 'denied' || entry.sessionStatus === 'error') return unavailableSessionCard(entry);
      var assignment = entry.assignment || { positions: [], paperwork: [], source: 'unavailable' };
      var summary = summarizeSession(entry.code, entry.doc, p, entry.notes, assignment);
      var codeArg = JSON.stringify(entry.code).replace(/"/g, '&quot;');
      var badges = '';
      summary.positions.forEach(function (position) { badges += '<span class="id-badge pos">' + esc(position) + '</span>'; });
      if (summary.todos) badges += '<span class="id-badge todo">' + summary.todos + ' to-do' + (summary.todos === 1 ? '' : 's') + '</span>';
      if (summary.unseen) badges += '<span class="id-badge unseen">' + summary.unseen + ' unseen note' + (summary.unseen === 1 ? '' : 's') + (summary.mentions ? ' · ' + summary.mentions + ' @you' : '') + '</span>';
      if (summary.paperwork.length) badges += '<span class="id-badge paper">' + esc(summary.paperwork.join(', ')) + '</span>';
      if (entry.sessionStatus === 'offline') badges += '<span class="id-badge unseen">Session may be out of date · offline</span>';
      if (entry.assignmentStatus !== 'ok') badges += '<span class="id-badge unseen">' + esc(portalIssueLabel('Assignments', entry.assignmentStatus, false)) + '</span>';
      else if (summary.assignmentSource === 'legacy') badges += '<span class="id-badge quiet">Legacy assignment · migration pending</span>';
      else if (summary.assignmentSource === 'empty') badges += '<span class="id-badge quiet">No crew assignment yet</span>';
      if (entry.notesStatus !== 'ok') badges += '<span class="id-badge unseen">' + esc(portalIssueLabel('Assigned actions', entry.notesStatus, entry.notesFallback)) + '</span>';
      else if (!summary.todos && !summary.unseen) badges += '<span class="id-badge quiet">No open actions or unseen notes</span>';
      var hasIssue = entry.sessionStatus !== 'ok' || entry.assignmentStatus !== 'ok' || entry.notesStatus !== 'ok';
      return '<div class="id-card">' +
        '<div class="id-card-head"><span class="id-card-code">' + esc(entry.code) + '</span>' +
        '<span class="id-card-name">' + esc(summary.showName) + '</span></div>' +
        '<div class="id-card-badges">' + badges + '</div>' +
        '<div class="id-card-actions">' +
        '<button type="button" class="jis-btn" onclick="CueolaIdentity.enterSession(' + codeArg + ',\'cueola\')">Open Cueola</button>' +
        '<button type="button" class="jis-btn" onclick="CueolaIdentity.enterSession(' + codeArg + ',\'notes\')">Notes</button>' +
        (hasIssue ? '<button type="button" class="jis-btn" onclick="CueolaIdentity.renderPortal()">Retry status</button>' : '') +
        (canHideSessions(p)
          ? (hiddenSessionsFor(p).indexOf(String(entry.code).toUpperCase()) >= 0
            ? '<button type="button" class="jis-btn" onclick="CueolaIdentity.unhideSession(' + codeArg + ')" data-tip="Put this session back in your front page and pickers" aria-label="Unhide ' + esc(entry.code) + '">Unhide</button>'
            : '<button type="button" class="jis-btn" onclick="CueolaIdentity.hideSession(' + codeArg + ')" data-tip="Hide this session from your front page and pickers on this device" aria-label="Hide ' + esc(entry.code) + '">Hide</button>')
          : '') +
        '<button type="button" class="jis-btn jis-remove" onclick="CueolaIdentity.portalRemoveCode(' + codeArg + ')" data-tip="Remove this session from your profile" aria-label="Remove ' + esc(entry.code) + ' from your profile">Remove</button>' +
        '</div></div>';
    }).join('');
  }

  async function portalAddCode() {
    var el = document.getElementById('id-portal-addcode');
    var res = await attachSessions([(el && el.value) || '']);
    if (!res.ok) { say(res.msg || 'Could not add that code.'); return; }
    if (!res.added || !res.added.length) { say('That code is already on your profile (or not a valid code).'); return; }
    say('Added ' + res.added.join(', ') + ' to your profile.');
    renderPortal();
  }

  async function portalRemoveCode(code) {
    var c = String(code || '').trim().toUpperCase();
    if (!c) return;
    if (!window.confirm('Remove ' + c + ' from your profile? The one-tap tile goes away on every device you sign in on. You can add it back any time with the code.')) return;
    var res = await detachSessions([c]);
    if (!res.ok) { say(res.msg || 'Could not remove that session.'); return; }
    say('Removed ' + c + ' from your profile.');
    renderPortal();
  }

  // Enter an app as this profile — drives the existing join flows so every
  // guard (soft-delete, requireLoginCode, offline fallback) applies untouched.
  function enterSession(code, target) {
    var p = cachedProfile; if (!p) return;
    close('identityModal');
    bumpLastSeen(p.username, p);
    if (target === 'notes') {
      try {
        window.openPreProJoinModal('notes');
        document.getElementById('pp-join-code').value = code;
        document.getElementById('pp-join-name').value = p.fullName;
        decorateJoinNameInput(document.getElementById('pp-join-name'), p);
        window.joinPreProSession();
      } catch (e) {}
      return;
    }
    try {
      window.openJoinSession();
      document.getElementById('stud-code').value = code;
      document.getElementById('stud-name').value = p.fullName;
      decorateJoinNameInput(document.getElementById('stud-name'), p);
      window.joinSession();
    } catch (e) {}
  }

  /* ══════════════════════ the front door (entry-page card) ═════════════════
   * The entry page's primary card, replacing type-a-code as the way in.
   * Signed out: username sign-in right on the page, plus create-profile.
   * Signed in: your assigned sessions (the profile's sessions array, the same
   * membership the portal uses), one tap to enter via enterSession so every
   * join guard still applies. The typed show code survives as a quiet
   * fallback link: guests and remote operators still arrive with only a code. */
  var frontDoorGen = 0;
  var FRONT_DOOR_MAX = 6;
  function frontDoorEl() { return document.getElementById('entryFrontDoor'); }

  /* ── Hidden sessions (owner request 2026-09-03, instructors only) ──
   * An admin's profile keeps every class session it ever ran, so the front
   * door and every session picker fill up with old classes. Hiding tucks a
   * code out of those lists. The list lives on the profile document
   * (profiles/{username}.hiddenSessions) so it follows the instructor to every
   * device; the profile's sessions array is untouched, the session itself is
   * untouched, and the code still works typed by hand. A per-device copy in
   * localStorage keeps the lists right offline and covers the window before
   * the additive rules deploy (docs/rules-additive-2026-09-03-hiddensessions.rules):
   * until then the cloud write is refused and the admin is told the change
   * stayed on this device. */
  var HIDDEN_SESSIONS_KEY = 'cueola_hidden_sessions_';
  var frontDoorShowHidden = false;
  function normalizeHiddenList(raw) {
    if (!Array.isArray(raw)) return [];
    var out = [];
    raw.forEach(function (c) {
      var s = String(c || '').trim().toUpperCase();
      if (s && out.indexOf(s) < 0) out.push(s);
    });
    return out;
  }
  function localHiddenSessions(username) {
    if (!username) return [];
    try {
      return normalizeHiddenList(JSON.parse(localStorage.getItem(HIDDEN_SESSIONS_KEY + String(username).toLowerCase()) || '[]'));
    } catch (e) { return []; }
  }
  function saveHiddenSessions(username, list) {
    if (!username) return;
    try {
      var key = HIDDEN_SESSIONS_KEY + String(username).toLowerCase();
      if (list.length) localStorage.setItem(key, JSON.stringify(list)); else localStorage.removeItem(key);
    } catch (e) {}
  }
  // The effective list for a profile: the cloud field when the profile carries
  // one (mirrored to this device), else whatever this device remembers.
  function hiddenSessionsFor(p) {
    if (!p) return [];
    if (typeof p === 'string') return localHiddenSessions(p);
    if (!canHideSessions(p)) return [];
    if (Array.isArray(p.hiddenSessions)) {
      var cloud = normalizeHiddenList(p.hiddenSessions);
      if (!p._hiddenLocalOnly) { p._hiddenSynced = true; saveHiddenSessions(p.username, cloud); }
      return cloud;
    }
    return localHiddenSessions(p.username);
  }
  function hiddenSessions() {
    var id = identity(); if (!id) return [];
    var p = (cachedProfile && cachedProfile.username === id.username) ? cachedProfile : null;
    return p ? hiddenSessionsFor(p) : localHiddenSessions(id.username);
  }
  function isSessionHidden(code) {
    return hiddenSessions().indexOf(String(code || '').toUpperCase()) >= 0;
  }
  // Instructors only: the rules accept hiddenSessions on admin profiles alone,
  // and a student's session list is curated by their instructor anyway.
  function canHideSessions(p) { return !!(p && p.role === 'admin'); }
  function rerenderHiddenSurfaces() {
    renderFrontDoor();
    renderEntryAccountRow();
    try { if (document.getElementById('identityModal') && document.getElementById('identityModal').classList.contains('on')) renderPortal(); } catch (e) {}
  }
  // Optimistic: the profile in memory and this device update first so every
  // list redraws at once, then the cloud write lands (arrayUnion/arrayRemove,
  // so two devices hiding different codes never clobber each other).
  async function writeHiddenSessions(list, change) {
    var id = identity(); if (!id) return { ok: false };
    var p = (cachedProfile && cachedProfile.username === id.username) ? cachedProfile : null;
    // Until the cloud has accepted a list from this profile once, the first
    // successful write carries the WHOLE device list (codes hidden before the
    // rules deploy or while offline would otherwise never reach the cloud).
    var synced = !!(p && p._hiddenSynced);
    if (p) { p.hiddenSessions = list.slice(); if (!synced) p._hiddenLocalOnly = true; }
    saveHiddenSessions(id.username, list);
    var w = fb();
    if (!w || !w._updateDoc) return { ok: false, offline: true };
    try {
      var patch = { lastSeen: Date.now() };
      if (synced && change && change.add && w._arrayUnion) patch.hiddenSessions = w._arrayUnion(change.add);
      else if (synced && change && change.remove && w._arrayRemove) patch.hiddenSessions = w._arrayRemove(change.remove);
      else patch.hiddenSessions = list.slice();
      await w._updateDoc(w._doc(w._db, 'profiles', id.username), patch);
      if (p) { p._hiddenSynced = true; delete p._hiddenLocalOnly; }
      return { ok: true };
    } catch (e) { return { ok: false, error: e }; }
  }
  async function setSessionHidden(code, hidden) {
    var id = identity(); if (!id) return;
    var p = (cachedProfile && cachedProfile.username === id.username) ? cachedProfile : null;
    if (!canHideSessions(p)) return;
    var c = String(code || '').trim().toUpperCase(); if (!c) return;
    var list = hiddenSessionsFor(p).filter(function (x) { return x !== c; });
    if (hidden) list.push(c);
    var res = await writeHiddenSessions(list, hidden ? { add: c } : { remove: c });
    if (res.ok) say(hidden ? 'Hidden ' + c + ' from your lists on every device.' : c + ' is back in your lists.');
    else if (res.offline) say((hidden ? 'Hidden ' + c : c + ' is back') + ' on this device. It will not follow you to other devices until the cloud is reachable.');
    else say((hidden ? 'Hidden ' + c : c + ' is back') + ' on this device only. The cloud did not accept the change (the hidden-sessions rules update may not be deployed yet).');
    rerenderHiddenSurfaces();
  }
  function hideSession(code) { setSessionHidden(code, true); }
  function unhideSession(code) { setSessionHidden(code, false); }
  async function unhideAllSessions() {
    var id = identity(); if (!id) return;
    frontDoorShowHidden = false;
    var res = await writeHiddenSessions([], null);
    if (res.ok) say('All sessions are back in your lists on every device.');
    else say('All sessions are back on this device. The cloud did not accept the change yet.');
    rerenderHiddenSurfaces();
  }
  function toggleHiddenSessions() {
    frontDoorShowHidden = !frontDoorShowHidden;
    renderFrontDoor();
  }

  function frontDoorLinks(signedIn, hiddenCount) {
    var hiddenLink = hiddenCount
      ? '<span>&middot;</span><button type="button" class="fd-link" onclick="CueolaIdentity.toggleHiddenSessions()">'
        + hiddenCount + ' hidden &middot; ' + (frontDoorShowHidden ? 'Tuck away' : 'Show') + '</button>'
      : '';
    return '<div class="fd-links">'
      + (signedIn
        ? '<button type="button" class="fd-link fd-link-setup" onclick="openWorkspaceLauncher()">Show setup</button><span>&middot;</span>'
          + '<button type="button" class="fd-link" onclick="CueolaIdentity.openHub()">All sessions &amp; notes</button><span>&middot;</span>'
        : '<button type="button" class="fd-link" onclick="CueolaIdentity.startCreate()">New here? Create your profile</button><span>&middot;</span>')
      + '<button type="button" class="fd-link" onclick="openJoinSession()">Have a show code?</button>'
      + (signedIn ? hiddenLink + '<span>&middot;</span><button type="button" class="fd-link" onclick="CueolaIdentity.signOut()">Sign out</button>' : '')
      + '</div>';
  }
  function frontDoorInitials(name) {
    return String(name || '').trim().split(/\s+/).slice(0, 2).map(function (s) { return s.charAt(0).toUpperCase(); }).join('') || '?';
  }
  // The signed-in user's custom look, reused wherever identity draws a person
  // bubble. Falls back to the classic initials chip when no art is chosen or
  // cueola-app.js has not loaded its helpers yet.
  function avatarChipHTML(p, cls) {
    cls = cls || 'fd-ava';
    try {
      var a = normalizeAvatar(p.avatar || (window.pbMyAvatar && window.pbMyAvatar()));
      if (a && a.type !== 'initials' && typeof window.pbAvatarInner === 'function') {
        var note = { by: p.fullName || p.username, clientId: p.username, avatar: a };
        return '<span class="' + cls + '" style="background:' + window.pbAvatarBg(note) + '">' + window.pbAvatarInner(note) + '</span>';
      }
    } catch (e) {}
    return '<span class="' + cls + '">' + esc(frontDoorInitials(p.fullName)) + '</span>';
  }
  // The toolbar profile button shows YOUR icon once you have one; the generic
  // person symbol is only for the signed-out state (owner decision 2026-08-03).
  function refreshEntryProfileBtn() {
    renderEntryAccountRow();
    var btn = document.getElementById('entryProfileBtn');
    if (!btn) return;
    var id = identity();
    var p = (id && cachedProfile && cachedProfile.username === id.username) ? cachedProfile : null;
    if (!p) {
      btn.innerHTML = '<span class="sf-symbol" data-symbol="action.profile" aria-hidden="true"></span>';
      var locked = !id && storedIdentity();
      btn.setAttribute('data-tip', locked ? 'Finish signing in' : 'Sign in');
      btn.setAttribute('aria-label', locked ? 'Finish signing in' : 'Sign in');
      return;
    }
    btn.innerHTML = avatarChipHTML(p, 'pb-note-avatar pb-av-sm');
    btn.setAttribute('data-tip', 'Open your profile');
    btn.setAttribute('aria-label', 'Your profile');
  }
  // The toolbar profile button (owner request 2026-09-03): signed out it opens
  // sign-in straight away instead of the create/sign-in chooser; a locked
  // device (stored identity, PIN or password still owed) jumps to the gate on
  // the front door card; signed in it opens the portal as before.
  function entryProfileTap() {
    if (identity()) { openHub(); return; }
    if (storedIdentity()) {
      var el = frontDoorEl();
      if (el) {
        try { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (e) {}
        var field = el.querySelector('input');
        if (field) { try { field.focus({ preventScroll: true }); } catch (e) { field.focus(); } }
        el.classList.add('fd-attention');
        setTimeout(function () { el.classList.remove('fd-attention'); }, 900);
      }
      return;
    }
    openSignIn();
  }
  // The account row inside the front-page settings panel: who is signed in,
  // with sign in / sign out right there, plus the hidden-session count for
  // admins. Re-rendered on every identity transition through
  // refreshEntryProfileBtn (which renderFrontDoor always calls).
  function renderEntryAccountRow() {
    var row = document.getElementById('entryAccountRow');
    if (!row) return;
    var id = identity();
    var p = (id && cachedProfile && cachedProfile.username === id.username) ? cachedProfile : null;
    var closeThen = function (fn) { return 'try{closeEntryThemes()}catch(e){};' + fn; };
    var html;
    if (p) {
      html = avatarChipHTML(p, 'fd-ava')
        + '<div class="entry-account-text"><div class="entry-account-name">' + esc(p.fullName || p.username) + '</div>'
        + '<div class="entry-account-sub">@' + esc(p.username) + (p.role === 'admin' ? ' &middot; admin' : '') + '</div></div>'
        + '<div class="entry-account-actions">'
        + '<button type="button" class="jis-btn" onclick="' + closeThen('CueolaIdentity.openHub()') + '">Profile</button>'
        + '<button type="button" class="jis-btn" onclick="' + closeThen('CueolaIdentity.signOut()') + '">Sign out</button>'
        + '</div>';
    } else if (id) {
      html = '<span class="sf-symbol ea-ico" data-symbol="action.profile" aria-hidden="true"></span>'
        + '<div class="entry-account-text"><div class="entry-account-name">@' + esc(id.username) + '</div>'
        + '<div class="entry-account-sub">Loading your profile&hellip;</div></div>'
        + '<div class="entry-account-actions"><button type="button" class="jis-btn" onclick="' + closeThen('CueolaIdentity.signOut()') + '">Sign out</button></div>';
    } else if (storedIdentity()) {
      html = '<span class="sf-symbol ea-ico" data-symbol="action.lock" aria-hidden="true"></span>'
        + '<div class="entry-account-text"><div class="entry-account-name">@' + esc(storedIdentity().username) + '</div>'
        + '<div class="entry-account-sub">Sign-in not finished on this device</div></div>'
        + '<div class="entry-account-actions">'
        + '<button type="button" class="jis-btn" onclick="' + closeThen('CueolaIdentity.entryProfileTap()') + '">Finish sign-in</button>'
        + '<button type="button" class="jis-btn" onclick="' + closeThen('CueolaIdentity.frontDoorNotMe()') + '">Not me</button>'
        + '</div>';
    } else {
      html = '<span class="sf-symbol ea-ico" data-symbol="action.profile" aria-hidden="true"></span>'
        + '<div class="entry-account-text"><div class="entry-account-name">Not signed in</div>'
        + '<div class="entry-account-sub">Sign in to see your sessions and notes</div></div>'
        + '<div class="entry-account-actions">'
        + '<button type="button" class="jis-btn" onclick="' + closeThen('CueolaIdentity.openSignIn()') + '">Sign in</button>'
        + '</div>';
    }
    row.innerHTML = html;
    // Admins only: how many sessions are tucked away on this device, with a
    // one-tap way back. Its own sibling element so the account row stays simple.
    var hiddenRow = document.getElementById('entryHiddenRow');
    if (hiddenRow) {
      if (canHideSessions(p)) {
        var n = hiddenSessionsFor(p).length;
        hiddenRow.innerHTML = '<span>Hidden sessions: <b>' + n + '</b>'
          + (n ? '' : '<br><span style="color:var(--text3)">Use Hide next to a session on the front page to tuck old classes away.</span>') + '</span>'
          + (n ? '<button type="button" class="jis-btn" onclick="' + closeThen('CueolaIdentity.unhideAllSessions()') + '">Show all</button>' : '');
        hiddenRow.hidden = false;
      } else {
        hiddenRow.innerHTML = '';
        hiddenRow.hidden = true;
      }
    }
  }
  function frontDoorSignedOut(el, note) {
    el.innerHTML = '<div class="ec-icon"><svg class="brand-ico"><use href="#ic-cueola"/></svg></div>'
      + '<div class="ec-title">Your sessions</div>'
      + '<div class="ec-desc">Sign in with your username and the sessions assigned to you are one tap away. No password.</div>'
      + '<div class="fd-row"><input class="field-in" id="fd-username" type="text" maxlength="40" placeholder="username" autocapitalize="none" autocomplete="username">'
      + '<button type="button" class="btn-primary fd-go" onclick="CueolaIdentity.frontDoorSignIn()">Sign in</button></div>'
      + '<div class="modal-err' + (note ? ' on' : '') + '" id="fd-err">' + esc(note || '') + '</div>'
      + frontDoorLinks(false);
    var input = document.getElementById('fd-username');
    if (input) input.addEventListener('keydown', function (e) { if (e.key === 'Enter') frontDoorSignIn(); });
  }
  function frontDoorHead(p) {
    return '<div class="fd-head">' + avatarChipHTML(p, 'fd-ava')
      + '<div><div class="fd-hi">Hi, ' + esc(String(p.fullName || '').split(' ')[0]) + '</div>'
      + '<div class="fd-user">@' + esc(p.username) + (p.role === 'admin' ? ' &middot; admin' : '') + '</div></div></div>';
  }
  async function frontDoorSessionMeta(w, code) {
    try {
      var ref = w._doc(w._db, 'sessions', code);
      var snap = await readWithCache(
        function () { return w._getDoc(ref); },
        w._getDocFromCache ? function () { return w._getDocFromCache(ref); } : null
      );
      if (!snap || !snap.exists()) return null;
      var d = snap.data() || {};
      if (d.deletedAt) return null;
      return { code: code, showName: String(d.showName || '') };
    } catch (e) { return { code: code, showName: '' }; }
  }
  async function renderFrontDoor() {
    var el = frontDoorEl(); if (!el) return;
    var gen = ++frontDoorGen;
    var id = identity();
    refreshEntryProfileBtn();
    if (!id) {
      // A stored identity with no unlock marker is LOCKED: resume the gate
      // (enter PIN, set a PIN, or admin password) instead of the generic card.
      var stored = storedIdentity();
      if (stored) { await renderLockGate(el, stored.username, gen); return; }
      frontDoorSignedOut(el, '');
      return;
    }
    var p = cachedProfile;
    if (!p || p.username !== id.username) {
      el.innerHTML = '<div class="ec-icon"><svg class="brand-ico"><use href="#ic-cueola"/></svg></div>'
        + '<div class="ec-title">Your sessions</div><div class="fd-loading">Loading your sessions&hellip;</div>';
      if (!fb() && typeof window.waitForFirebaseReady === 'function') { try { await window.waitForFirebaseReady(); } catch (e) {} }
      if (gen !== frontDoorGen) return;
      var wOff = fb();
      if (!wOff) {
        el.innerHTML = '<div class="ec-icon"><svg class="brand-ico"><use href="#ic-cueola"/></svg></div>'
          + '<div class="ec-title">Your sessions</div>'
          + '<div class="ec-desc">Signed in as @' + esc(id.username) + ', but the cloud is not reachable. Your sessions will appear when it is.</div>'
          + frontDoorLinks(true);
        return;
      }
      try { p = await fetchProfile(id.username); } catch (e) { p = null; }
      if (gen !== frontDoorGen) return;
      if (!p || p.renamedTo || p.mergedInto || p.active === false) {
        frontDoorSignedOut(el, p ? 'That profile changed. Sign in again' + (p.renamedTo || p.mergedInto ? ' as @' + (p.renamedTo || p.mergedInto) : '') + '.' : '');
        return;
      }
      cachedProfile = p;
      announceIdentityChange();  // restore-on-boot: profile is now known
    }
    // Hidden sessions drop out BEFORE the newest-six cut, so tucking old
    // classes away makes room for the ones that matter.
    var canHide = canHideSessions(p);
    var hidden = canHide ? hiddenSessionsFor(p) : [];
    var all = (p.sessions || []).slice();
    var visibleCodes = all.filter(function (c) { return hidden.indexOf(String(c).toUpperCase()) < 0; });
    var hiddenCodes = all.filter(function (c) { return hidden.indexOf(String(c).toUpperCase()) >= 0; }).reverse();
    var codes = visibleCodes.slice(-FRONT_DOOR_MAX).reverse();
    var showHiddenList = canHide && frontDoorShowHidden && hiddenCodes.length > 0;
    var emptyMsg = canHide && hiddenCodes.length
      ? '<div class="ec-desc">Every session on your profile is hidden. Use the hidden link below to bring one back.</div>'
      : '<div class="ec-desc">No sessions on your profile yet. Your instructor can assign them, or add one with its code.</div>';
    el.innerHTML = '<div class="ec-icon"><svg class="brand-ico"><use href="#ic-cueola"/></svg></div>'
      + frontDoorHead(p)
      + '<div class="fd-sessions" id="fd-sessions">'
      + (codes.length || showHiddenList ? '<div class="fd-loading">Checking your sessions&hellip;</div>' : emptyMsg)
      + '</div>'
      + frontDoorLinks(true, canHide ? hiddenCodes.length : 0);
    refreshEntryProfileBtn();
    if (!codes.length && !showHiddenList) return;
    var w = fb(); if (!w) return;
    var listed = showHiddenList ? codes.concat(hiddenCodes) : codes;
    var metas = await Promise.all(listed.map(function (code) { return frontDoorSessionMeta(w, code); }));
    if (gen !== frontDoorGen) return;
    var wrap = document.getElementById('fd-sessions'); if (!wrap) return;
    var sessionRow = function (m, isHidden) {
      var codeArg = JSON.stringify(m.code).replace(/"/g, '&quot;');
      var btn = '<button type="button" class="fd-session" onclick="CueolaIdentity.enterSession(' + codeArg + ',\'cueola\')" title="Open this session">'
        + '<span class="fd-code">' + esc(m.code) + '</span>'
        + '<span class="fd-show">' + esc(m.showName || 'Untitled show') + '</span>'
        + '<span class="fd-open">Open</span></button>';
      if (!canHide) return btn;
      var toggle = isHidden
        ? '<button type="button" class="fd-hide" onclick="CueolaIdentity.unhideSession(' + codeArg + ')" data-tip="Put this session back in your lists" aria-label="Unhide ' + esc(m.code) + '">Unhide</button>'
        : '<button type="button" class="fd-hide" onclick="CueolaIdentity.hideSession(' + codeArg + ')" data-tip="Hide this session from your lists on this device" aria-label="Hide ' + esc(m.code) + '">Hide</button>';
      return '<div class="fd-session-row' + (isHidden ? ' fd-hidden-row' : '') + '">' + btn + toggle + '</div>';
    };
    var rows = [];
    var hiddenHeaderDone = false;
    metas.forEach(function (m, i) {
      if (!m) return;
      var isHidden = i >= codes.length;
      if (isHidden && !hiddenHeaderDone) { rows.push('<div class="fd-hidden-note">Hidden on this device</div>'); hiddenHeaderDone = true; }
      rows.push(sessionRow(m, isHidden));
    });
    wrap.innerHTML = rows.length ? rows.join('') : emptyMsg;
  }
  async function frontDoorSignIn() {
    var el = document.getElementById('fd-username');
    var err = document.getElementById('fd-err');
    if (err) err.classList.remove('on');
    var r = await resolveGate(el && el.value);
    if (!r.ok) { if (err) { err.innerHTML = r.msg; err.classList.add('on'); } return; }
    // Persist WHO now; the device stays locked (no unlock marker) until the
    // second factor passes, so a reload resumes the same gate.
    rememberIdentity(r.username, r.profile);
    renderFrontDoor();
  }

  // The gate card shares the front-door shell: brand mark, a "continuing as"
  // line, one factor field, an error slot, submit, and a "not you" escape.
  function gateShell(username, title, sub, body) {
    return '<div class="ec-icon"><svg class="brand-ico"><use href="#ic-cueola"/></svg></div>'
      + '<div class="ec-title">' + esc(title) + '</div>'
      + '<div class="ec-desc">' + sub + '</div>'
      + body
      + '<div class="modal-err" id="fd-err"></div>'
      + '<div class="fd-links"><span class="fd-user">Continuing as @' + esc(username) + '</span>'
      + '<span>&middot;</span><button type="button" class="fd-link" onclick="CueolaIdentity.frontDoorNotMe()">Not you?</button></div>';
  }
  async function renderLockGate(el, username, gen) {
    var g = (pendingGate && pendingGate.username === username) ? pendingGate : null;
    if (!g) {
      el.innerHTML = '<div class="ec-icon"><svg class="brand-ico"><use href="#ic-cueola"/></svg></div>'
        + '<div class="ec-title">Welcome back</div><div class="fd-loading">Checking your profile&hellip;</div>';
      if (!fb() && typeof window.waitForFirebaseReady === 'function') { try { await window.waitForFirebaseReady(); } catch (e) {} }
      if (gen !== frontDoorGen) return;
      if (!fb()) {
        el.innerHTML = '<div class="ec-icon"><svg class="brand-ico"><use href="#ic-cueola"/></svg></div>'
          + '<div class="ec-title">Welcome back</div>'
          + '<div class="ec-desc">@' + esc(username) + ', the cloud is not reachable. Your sign-in will continue when it is.</div>'
          + '<div class="fd-links"><button type="button" class="fd-link" onclick="CueolaIdentity.frontDoorNotMe()">Not you?</button></div>';
        return;
      }
      var r = await resolveGate(username);
      if (gen !== frontDoorGen) return;
      if (!r.ok) {
        // Stored identity no longer resolvable (renamed, merged, deactivated,
        // or gone): forget it and fall back to the signed-out card.
        try { localStorage.removeItem(IDENTITY_KEY); } catch (e) {}
        clearUnlocked();
        frontDoorSignedOut(el, r.msg || '');
        return;
      }
      g = pendingGate;
    }
    if (g.stage === 'password') {
      // A live admin session (persisted or from the dashboard) stands in for
      // the password, so an already-authed admin is not asked twice.
      var pre = await enterAsAdmin(g.username, g.profile, '');
      if (gen !== frontDoorGen) return;
      if (pre.ok) return;   // finalizeSignIn re-rendered the front door
      el.innerHTML = gateShell(g.username, 'Instructor sign-in',
        'Enter your instructor password to continue.',
        '<div class="fd-row"><input class="field-in" id="fd-pw" type="password" autocomplete="current-password" placeholder="password">'
        + '<button type="button" class="btn-primary fd-go" onclick="CueolaIdentity.frontDoorSubmitPassword()">Sign in</button></div>');
      var pw = document.getElementById('fd-pw');
      if (pw) { pw.focus(); pw.addEventListener('keydown', function (e) { if (e.key === 'Enter') frontDoorSubmitPassword(); }); }
      return;
    }
    if (g.stage === 'setPin') {
      el.innerHTML = gateShell(g.username, 'Set a PIN to continue',
        'Pick a 4 digit PIN so only you can sign in as @' + esc(g.username) + '. Your class login code confirms this account is yours.',
        '<div class="fd-row"><input class="field-in id-code-in" id="fd-code" type="text" maxlength="80" autocapitalize="characters" autocomplete="off" placeholder="class login code"></div>'
        + '<div class="fd-row"><input class="field-in" id="fd-pin" type="password" inputmode="numeric" maxlength="4" autocomplete="off" placeholder="new PIN"></div>'
        + '<div class="fd-row"><input class="field-in" id="fd-pin2" type="password" inputmode="numeric" maxlength="4" autocomplete="off" placeholder="repeat PIN">'
        + '<button type="button" class="btn-primary fd-go" onclick="CueolaIdentity.frontDoorSubmitNewPin()">Save and continue</button></div>');
      var np = document.getElementById('fd-code');
      if (np) np.focus();
      var np2 = document.getElementById('fd-pin2');
      if (np2) np2.addEventListener('keydown', function (e) { if (e.key === 'Enter') frontDoorSubmitNewPin(); });
      return;
    }
    // stage 'pin'
    el.innerHTML = gateShell(g.username, 'Enter your PIN',
      'Enter your 4 digit PIN to continue as @' + esc(g.username) + '.',
      '<div class="fd-row"><input class="field-in" id="fd-pin" type="password" inputmode="numeric" maxlength="4" autocomplete="off" placeholder="PIN">'
      + '<button type="button" class="btn-primary fd-go" onclick="CueolaIdentity.frontDoorSubmitPin()">Sign in</button></div>');
    var pin = document.getElementById('fd-pin');
    if (pin) { pin.focus(); pin.addEventListener('keydown', function (e) { if (e.key === 'Enter') frontDoorSubmitPin(); }); }
  }
  function gateErr(msg) {
    var err = document.getElementById('fd-err');
    if (err) { err.innerHTML = esc(msg); err.classList.add('on'); }
  }
  async function frontDoorSubmitPin() {
    return gateGuarded('.fd-go', async function () {
      var g = pendingGate; if (!g) return renderFrontDoor();
      var el = document.getElementById('fd-pin');
      var res = await enterWithPin(g.username, g.profile, el && el.value);
      if (!res.ok) gateErr(res.msg);
    });
  }
  async function frontDoorSubmitNewPin() {
    return gateGuarded('.fd-go', async function () {
      var g = pendingGate; if (!g) return renderFrontDoor();
      var a = document.getElementById('fd-pin'), b = document.getElementById('fd-pin2');
      var codeEl = document.getElementById('fd-code');
      var res = await enterWithNewPin(g.username, g.profile, a && a.value, b && b.value, codeEl && codeEl.value);
      if (!res.ok) gateErr(res.msg);
    });
  }
  async function frontDoorSubmitPassword() {
    return gateGuarded('.fd-go', async function () {
      var g = pendingGate; if (!g) return renderFrontDoor();
      var el = document.getElementById('fd-pw');
      var res = await enterAsAdmin(g.username, g.profile, (el && el.value) || '');
      if (!res.ok) gateErr(res.msg === 'needs-password' ? 'Enter your password.' : res.msg);
    });
  }
  function frontDoorNotMe() { signOut(); }
  // The card follows identity wherever it changes; a zero-delay timer lets
  // cueola-app.js (which loads after us) finish defining the firebase bridge.
  setTimeout(function () { try { renderFrontDoor(); } catch (e) {} }, 0);
  // Firebase flips ready asynchronously, sometimes after waitForFirebaseReady's
  // own timeout has given up — re-render on its event so a slow cloud start can
  // never strand a signed-in card on the offline message.
  window.addEventListener('firebaseReady', function () { try { renderFrontDoor(); } catch (e) {} }, { once: true });

  /* ══════════════════ assigned-session picker (shared) ══════════════════
   * The owner directive behind the front-door hero applies app wide: a
   * signed-in user should never have to type a show code the app already
   * knows. Any join surface (Planda Bear, Flowmingo Remote Op, Outrangutan,
   * the typed-code modal) awaits sessionChoices() for the profile's assigned
   * sessions and leads with one-tap rows; the typed code stays as a fallback.
   *
   * Markup contract (mirrors the hero rows): a .fd-sessions column of
   * .fd-session buttons, each holding .fd-code (the code chip), .fd-show
   * (the show name), and .fd-open ("Open"). renderSessionChoiceRows builds
   * that markup; surfaces that render their own rows use the same classes.
   * Surfaces refresh on the existing 'cueola-identity-change' event when
   * they are open; nothing new is dispatched here.
   */
  async function sessionChoices() {
    var id = identity();
    if (!id) return [];
    var p = cachedProfile;
    if (!p || p.username !== id.username) {
      if (!fb() && typeof window.waitForFirebaseReady === 'function') { try { await window.waitForFirebaseReady(); } catch (e) {} }
      if (!fb()) return [];
      try { p = await fetchProfile(id.username); } catch (e) { p = null; }
      if (!p || p.renamedTo || p.mergedInto || p.active === false) return [];
      cachedProfile = p;
      announceIdentityChange();  // same restore-on-boot announce the hero makes
    }
    // Hidden sessions stay out of every picker too (Show setup, join modals,
    // Flowmingo op, Outrangutan); a typed code still works everywhere.
    var hiddenNow = canHideSessions(p) ? hiddenSessionsFor(p) : [];
    var codes = (p.sessions || []).filter(function (c) { return hiddenNow.indexOf(String(c).toUpperCase()) < 0; }).reverse();  // newest membership first, hero order
    if (!codes.length) return [];
    var w = fb();
    if (!w) return codes.map(function (code) { return { code: code, name: '' }; });
    var metas = await Promise.all(codes.map(function (code) { return frontDoorSessionMeta(w, code); }));
    return metas.filter(Boolean).map(function (m) { return { code: m.code, name: m.showName || '' }; });
  }
  function renderSessionChoiceRows(choices, onPickName) {
    if (!Array.isArray(choices) || !choices.length) return '';
    var pick = String(onPickName || 'CueolaIdentity.enterSession');
    return '<div class="fd-sessions">' + choices.map(function (c) {
      var codeArg = JSON.stringify(String(c.code || '')).replace(/"/g, '&quot;');
      return '<button type="button" class="fd-session" onclick="' + pick + '(' + codeArg + ')" title="Open this session">'
        + '<span class="fd-code">' + esc(c.code) + '</span>'
        + '<span class="fd-show">' + esc(c.name || 'Untitled show') + '</span>'
        + '<span class="fd-open">Open</span></button>';
    }).join('') + '</div>';
  }

  window.CueolaIdentity = {
    identity: identity, profile: function () { return cachedProfile; },
    profileIdentity: function () { return canonicalProfileIdentity(cachedProfile); },
    profileIdentityForJoin: profileIdentityForJoin,
    signOut: signOut, createProfile: createProfile,
    attachSessions: attachSessions, detachSessions: detachSessions, noteJoin: noteJoin,
    entrySatisfied: entrySatisfied, revealEntryCodeRow: revealEntryCodeRow,
    onDeviceAvatarSaved: onDeviceAvatarSaved,
    decorateJoin: decorateJoin, pickSession: pickSession,
    openHub: openHub, openSignIn: openSignIn, renderHub: renderHub, renderSignIn: renderSignIn,
    submitSignIn: submitSignIn, startCreate: startCreate,
    wizardNext: wizardNext, wizardBack: wizardBack, wizardPickAvatar: wizardPickAvatar, wizardPickAvatarBg: wizardPickAvatarBg, wizardFinish: wizardFinish,
    renderPortal: renderPortal, portalAddCode: portalAddCode, portalRemoveCode: portalRemoveCode, enterSession: enterSession,
    sessionChoices: sessionChoices, renderSessionChoiceRows: renderSessionChoiceRows,
    renderFrontDoor: renderFrontDoor, frontDoorSignIn: frontDoorSignIn,
    entryProfileTap: entryProfileTap, renderEntryAccountRow: renderEntryAccountRow,
    hideSession: hideSession, unhideSession: unhideSession, unhideAllSessions: unhideAllSessions,
    toggleHiddenSessions: toggleHiddenSessions, isSessionHidden: isSessionHidden, hiddenSessions: hiddenSessions,
    // Sign-in gate (student PIN, set-PIN, admin password) handlers, front door + modal.
    frontDoorNotMe: frontDoorNotMe,
    frontDoorSubmitPin: frontDoorSubmitPin, frontDoorSubmitNewPin: frontDoorSubmitNewPin, frontDoorSubmitPassword: frontDoorSubmitPassword,
    submitModalPin: submitModalPin, submitModalNewPin: submitModalNewPin, submitModalPassword: submitModalPassword,
    deviceOnlyLook: deviceOnlyLook,
    _normalizeUsername: normalizeUsername, _normalizeCode: normalizeCode,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = window.CueolaIdentity;
})();
