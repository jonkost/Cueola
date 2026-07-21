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
  function normalizeAvatar(a) {
    var m = window.CueolaAvatarProfile;
    return (m && m.normalizeAvatar(a, animals(), avatarIcons())) || { type: 'initials' };
  }

  /* ── local device identity ── */
  function identity() {
    try {
      var raw = JSON.parse(localStorage.getItem(IDENTITY_KEY) || 'null');
      return raw && typeof raw.username === 'string' ? raw : null;
    } catch (e) { return null; }
  }
  function rememberIdentity(username, profile) {
    var value = { username: username };
    if (profile) value.profileId = canonicalProfileId(profile);
    try { localStorage.setItem(IDENTITY_KEY, JSON.stringify(value)); } catch (e) {}
  }
  function signOut() {
    portalRequestGeneration++;
    try { localStorage.removeItem(IDENTITY_KEY); } catch (e) {}
    cachedProfile = null;
    say('Signed out on this device.');
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

  async function signIn(rawUsername) {
    var username = normalizeUsername(rawUsername);
    if (!username) return { ok: false, msg: 'Usernames are 3 to 40 characters: letters, numbers, dots, dashes.' };
    var w = fb(); if (!w) return { ok: false, msg: 'Cloud connection is not ready. Try again in a moment.' };
    var p;
    try { p = await fetchProfile(username); }
    catch (e) { return { ok: false, msg: 'Could not reach the profile service. Check the connection.' }; }
    if (!p) return { ok: false, msg: 'No profile with that username. Check the spelling, or create one with your class login code.' };
    if (p.renamedTo) return { ok: false, msg: 'This username was renamed. Sign in as “' + esc(p.renamedTo) + '”.' };
    if (p.mergedInto) return { ok: false, msg: 'This profile was merged into “' + esc(p.mergedInto) + '”. Use that username.' };
    if (p.active === false) return { ok: false, msg: 'This profile was deactivated by an instructor.' };
    rememberIdentity(username, p);
    cachedProfile = p;
    adoptProfileLocally(p);
    bumpLastSeen(username, p);
    return { ok: true, profile: p };
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
    if (!id || !w || !w._updateDoc) return;
    var normalized = normalizeAvatar(avatar);
    w._updateDoc(w._doc(w._db, 'profiles', id.username), { avatar: normalized, lastSeen: Date.now() })
      .then(function () { if (cachedProfile) cachedProfile.avatar = normalized; })
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

    var doc = {
      username: username,
      profileId: newProfileId(),
      profileAliases: [],
      fullName: fullName,
      role: codeDoc.role === 'admin' ? 'admin' : 'student',   // rules verify this matches the code doc
      avatar: normalizeAvatar(input.avatar),
      theme: themeIds().indexOf(input.theme) >= 0 ? input.theme : 'cool',
      sessions: sessions.slice(0, 100),
      codeUsed: code,
      createdAt: Date.now(),
      lastSeen: Date.now(),
    };
    try {
      await w._setDoc(w._doc(w._db, 'profiles', username), doc);
    } catch (e) {
      return { ok: false, msg: e && e.code === 'permission-denied'
        ? 'The profile was rejected. The login code may have just been revoked.'
        : 'Could not save the profile. Check the connection and try again.' };
    }
    rememberIdentity(username, doc);
    cachedProfile = doc;
    adoptProfileLocally(doc);
    return { ok: true, profile: doc };
  }

  async function attachSessions(codes) {
    var id = identity(); var w = fb();
    if (!id || !w || !w._updateDoc) return { ok: false };
    var p = cachedProfile || await fetchProfile(id.username);
    if (!p) return { ok: false };
    var merged = (p.sessions || []).slice();
    var added = [];
    (codes || []).forEach(function (raw) {
      var s = String(raw || '').trim().toUpperCase();
      if (s && SESSION_CODE_RE.test(s) && merged.indexOf(s) < 0 && merged.length < 100) { merged.push(s); added.push(s); }
    });
    if (!added.length) return { ok: true, added: [] };
    try {
      await w._updateDoc(w._doc(w._db, 'profiles', id.username), { sessions: merged, lastSeen: Date.now() });
      p.sessions = merged; cachedProfile = p;
      return { ok: true, added: added };
    } catch (e) { return { ok: false, msg: 'Could not save the session to your profile.' }; }
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
      var p = cachedProfile || await fetchProfile(id.username).catch(function () { return null; });
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
  var afterSignIn = null;   // 'stud' | 'pp' | null — return to a join modal after sign-in
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
    afterSignIn = returnTo || null;
    if (returnTo) close(returnTo === 'stud' ? 'modal-stud' : 'modal-prepro-join');
    open('identityModal');
    renderSignIn();
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
    var res = await signIn(el && el.value);
    if (!res.ok) { if (err) { err.innerHTML = res.msg; err.classList.add('on'); } return; }
    say('Signed in as ' + res.profile.fullName + '.');
    if (afterSignIn) {
      var kind = afterSignIn; afterSignIn = null;
      close('identityModal');
      if (kind === 'stud') { try { window.openJoinSession(); } catch (e) {} }
      else { try { window.openPreProJoinModal('hub'); } catch (e) {} }
      return;
    }
    renderPortal();
  }

  /* ── create-profile wizard ── */
  function startCreate() {
    wizard = { step: 0, code: '', fullName: '', username: '', avatar: { type: 'initials' }, theme: themeIds()[0] || 'cool', sessions: '' };
    open('identityModal');
    renderCreate();
  }
  function renderCreate() {
    var w = wizard; if (!w) return startCreate();
    var steps = ['Login code', 'Name & username', 'Look & theme', 'Your sessions'];
    var dots = steps.map(function (s, i) {
      return '<span class="id-step' + (i === w.step ? ' on' : i < w.step ? ' done' : '') + '">' + esc(s) + '</span>';
    }).join('');
    var html = '<div class="id-steps">' + dots + '</div>';

    if (w.step === 0) {
      setTitle('Create your profile', 'Step 1: the login code your instructor gave the class.');
      html +=
        '<div class="field"><label class="field-lbl">Class login code</label>' +
        '<input class="field-in id-code-in" id="id-create-code" type="text" maxlength="80" placeholder="e.g. FALL26TV" autocapitalize="characters" autocomplete="off" value="' + esc(w.code) + '"></div>' +
        '<div class="modal-err" id="id-create-err"></div>' +
        '<button class="btn-primary" onclick="CueolaIdentity.wizardNext()">Continue</button>' +
        '<button class="btn-secondary" onclick="CueolaIdentity.renderHub()">Back</button>';
    } else if (w.step === 1) {
      setTitle('Create your profile', 'Step 2: how you appear to the crew, and your username.');
      html +=
        '<div class="field"><label class="field-lbl">Full name</label>' +
        '<input class="field-in" id="id-create-fullname" type="text" maxlength="120" placeholder="e.g. Alex Johnson" value="' + esc(w.fullName) + '"></div>' +
        '<div class="field"><label class="field-lbl">Username</label>' +
        '<input class="field-in" id="id-create-username" type="text" maxlength="40" placeholder="e.g. alex.j" autocapitalize="none" autocomplete="off" value="' + esc(w.username) + '">' +
        '<div class="id-field-hint">Lowercase letters, numbers, dots and dashes. This is what you type to sign in.</div></div>' +
        '<div class="modal-err" id="id-create-err"></div>' +
        '<button class="btn-primary" onclick="CueolaIdentity.wizardNext()">Continue</button>' +
        '<button class="btn-secondary" onclick="CueolaIdentity.wizardBack()">Back</button>';
    } else if (w.step === 2) {
      setTitle('Create your profile', 'Step 3: pick your look and theme (changeable later).');
      var av = animals();
      var initialSel = w.avatar.type === 'initials';
      var grid = '<button type="button" class="id-av' + (initialSel ? ' sel' : '') + '" onclick="CueolaIdentity.wizardPickAvatar(\'initials\')">' +
        '<span class="id-av-chip">' + esc((w.fullName || 'You').split(/\s+/).map(function (p) { return p[0] || ''; }).join('').slice(0, 2).toUpperCase() || '?') + '</span><span>Initials</span></button>';
      Object.keys(av).forEach(function (k) {
        var sel = w.avatar.type === 'animal' && w.avatar.value === k;
        grid += '<button type="button" class="id-av' + (sel ? ' sel' : '') + '" onclick="CueolaIdentity.wizardPickAvatar(\'animal\',' + JSON.stringify(k).replace(/"/g, '&quot;') + ')">' +
          '<span class="id-av-chip" style="background:' + esc(av[k].bg) + '"><img src="' + esc(av[k].src) + '" alt=""></span><span>' + esc(av[k].label) + '</span></button>';
      });
      // v2.1 D7: icon avatars — same manifest as the Planda Bear portal.
      var icons = avatarIcons();
      Object.keys(icons).forEach(function (k) {
        var sel = w.avatar.type === 'icon' && w.avatar.value === k;
        var inner = icons[k].src
          ? '<img src="' + esc(icons[k].src) + '" alt="">'
          : '<span class="sf-symbol" data-symbol="' + esc(icons[k].symbol) + '" aria-hidden="true"></span>';
        grid += '<button type="button" class="id-av' + (sel ? ' sel' : '') + '" onclick="CueolaIdentity.wizardPickAvatar(\'icon\',' + JSON.stringify(k).replace(/"/g, '&quot;') + ')">' +
          '<span class="id-av-chip">' + inner + '</span><span>' + esc(icons[k].label) + '</span></button>';
      });
      var themes = themeIds().map(function (t) {
        return '<option value="' + esc(t) + '"' + (w.theme === t ? ' selected' : '') + '>' + esc(THEME_LABELS[t] || t) + '</option>';
      }).join('');
      html +=
        '<div class="id-av-grid">' + grid + '</div>' +
        '<div class="field"><label class="field-lbl">Theme</label>' +
        '<select class="field-in" id="id-create-theme">' + themes + '</select></div>' +
        '<button class="btn-primary" onclick="CueolaIdentity.wizardNext()">Continue</button>' +
        '<button class="btn-secondary" onclick="CueolaIdentity.wizardBack()">Back</button>';
    } else {
      setTitle('Create your profile', 'Step 4: the session codes you have been given (optional).');
      html +=
        '<div class="field"><label class="field-lbl">Session codes</label>' +
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
    if (w.step === 0) {
      var code = normalizeCode((document.getElementById('id-create-code') || {}).value);
      if (!code) return wizardErr('Enter the login code your instructor gave you.');
      var codeDoc = await fetchCode(code).catch(function () { return null; });
      if (!codeDoc) return wizardErr('That login code does not exist. Check it with your instructor.');
      if (codeDoc.active !== true) return wizardErr('That login code has been revoked. Ask your instructor for the current one.');
      w.code = code; w.codeRole = codeDoc.role; w.codeLabel = codeDoc.label;
      w.step = 1;
    } else if (w.step === 1) {
      w.fullName = String((document.getElementById('id-create-fullname') || {}).value || '').trim().replace(/\s+/g, ' ');
      var u = normalizeUsername((document.getElementById('id-create-username') || {}).value);
      if (!w.fullName) return wizardErr('Enter your full name.');
      if (!u) return wizardErr('Usernames are 3 to 40 characters: lowercase letters, numbers, dots and dashes.');
      var taken = await fetchProfile(u).catch(function () { return null; });
      if (taken) return wizardErr('“' + esc(u) + '” is taken. Pick another username.');
      w.username = u;
      w.step = 2;
    } else if (w.step === 2) {
      var sel = document.getElementById('id-create-theme');
      if (sel) w.theme = sel.value;
      w.step = 3;
    }
    renderCreate();
  }
  function wizardBack() { if (wizard && wizard.step > 0) { wizard.step--; renderCreate(); } else renderHub(); }
  function wizardPickAvatar(type, value) {
    if (!wizard) return;
    wizard.avatar = normalizeAvatar(type === 'animal' || type === 'icon'
      ? { type: type, value: value } : { type: 'initials' });
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
    var retry = entry.sessionStatus !== 'deleted'
      ? '<div class="id-card-actions"><button type="button" class="jis-btn" onclick="CueolaIdentity.renderPortal()">Retry</button></div>' : '';
    return '<div class="id-card gone"><div class="id-card-head"><span class="id-card-code">' + esc(entry.code) + '</span>' +
      '<span class="id-card-name">' + esc(name) + '</span></div>' + retry + '</div>';
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
                    : '<div class="id-portal-empty">No sessions on your profile yet. Add a session code below.</div>') +
      '</div>' +
      '<div class="id-addcode-row"><input class="field-in" id="id-portal-addcode" type="text" placeholder="Add a session code…" autocapitalize="characters">' +
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

  window.CueolaIdentity = {
    identity: identity, profile: function () { return cachedProfile; },
    profileIdentity: function () { return canonicalProfileIdentity(cachedProfile); },
    profileIdentityForJoin: profileIdentityForJoin,
    signIn: signIn, signOut: signOut, createProfile: createProfile,
    attachSessions: attachSessions, noteJoin: noteJoin,
    entrySatisfied: entrySatisfied, revealEntryCodeRow: revealEntryCodeRow,
    onDeviceAvatarSaved: onDeviceAvatarSaved,
    decorateJoin: decorateJoin, pickSession: pickSession,
    openHub: openHub, openSignIn: openSignIn, renderHub: renderHub, renderSignIn: renderSignIn,
    submitSignIn: submitSignIn, startCreate: startCreate,
    wizardNext: wizardNext, wizardBack: wizardBack, wizardPickAvatar: wizardPickAvatar, wizardFinish: wizardFinish,
    renderPortal: renderPortal, portalAddCode: portalAddCode, enterSession: enterSession,
    deviceOnlyLook: deviceOnlyLook,
    _normalizeUsername: normalizeUsername, _normalizeCode: normalizeCode,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = window.CueolaIdentity;
})();
