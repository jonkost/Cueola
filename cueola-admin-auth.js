/* ============================================================================
 * cueola-admin-auth.js — v2.1 Phase 2 (design D1): admin accounts on
 * Firebase Auth, username + password, admins only.
 *
 * Usernames map to deterministic synthetic emails
 * (<username>@admins.cueola.app) so sign-in is literally username + password.
 * Authorization is the uid-keyed admins/{uid} doc ({username, name, level});
 * firestore.rules checks existence via isAdmin(). Students never touch Auth —
 * codes + profiles stay exactly as shipped (university no-password rule).
 *
 * Classic global script (no build): attaches window.CueolaAdminAuth. Loaded
 * before cueola-app.js / dashboard page script in both index.html and
 * dashboard.html. The page's module bootstrap exposes the Auth SDK handles as
 * window._adminAuth + window._authFns after `firebaseReady`; everything here
 * resolves those lazily, so load order stays flexible.
 *
 * Dark-build note: until the release-day rules deploy, admins/{uid} reads are
 * permission-denied on production. resolveSession() treats that as "signed in
 * but not authorized yet" and publishes a null session with a console warning
 * instead of throwing — the legacy honor-system UI keeps working meanwhile.
 * ==========================================================================*/
(function () {
  'use strict';

  var ADMIN_EMAIL_DOMAIN = 'admins.cueola.app';
  // Mirrors cueola-identity.js USERNAME_RE / firestore.rules validUsername.
  var USERNAME_RE = /^[a-z0-9][a-z0-9._-]{2,39}$/;
  var LEVELS = ['super', 'standard'];   // plan decision 4: 'full' dropped

  var adminSession = null;        // {id: uid, uid, username, name, level} | null
  var sessionResolved = false;    // first auth state + admins-doc read finished
  var readyResolvers = [];
  var changeCallbacks = [];
  var unsubscribeAuth = null;
  var resolveGeneration = 0;

  function auth() { return window._adminAuth || null; }
  function fns() { return window._authFns || null; }

  function validUsername(username) {
    return USERNAME_RE.test(String(username || ''));
  }

  function normalizeUsername(username) {
    return String(username || '').trim().toLowerCase();
  }

  function usernameToEmail(username) {
    return normalizeUsername(username) + '@' + ADMIN_EMAIL_DOMAIN;
  }

  function usernameFromEmail(email) {
    var raw = String(email || '');
    var at = raw.indexOf('@');
    return at > 0 ? raw.slice(0, at) : raw;
  }

  function notifyChange() {
    var frozen = adminSession ? {
      id: adminSession.id, uid: adminSession.uid, username: adminSession.username,
      name: adminSession.name, level: adminSession.level,
    } : null;
    changeCallbacks.forEach(function (cb) {
      try { cb(frozen); } catch (err) { console.warn('admin-auth onChange callback failed', err); }
    });
    try {
      window.dispatchEvent(new CustomEvent('cueolaAdminSessionChanged', { detail: { session: frozen } }));
    } catch (err) {}
  }

  function settleReady() {
    if (sessionResolved) return;
    sessionResolved = true;
    readyResolvers.forEach(function (resolve) { resolve(current()); });
    readyResolvers = [];
  }

  function publish(session) {
    var before = JSON.stringify(adminSession);
    adminSession = session || null;
    settleReady();
    if (JSON.stringify(adminSession) !== before) notifyChange();
  }

  // user → admins/{uid} doc → adminSession. Generation-guarded: a sign-out
  // during a slow doc read must never resurrect the stale session afterwards.
  // One in-flight resolve per uid: interactive signIn() and the
  // onAuthStateChanged echo of that same sign-in used to EACH run the token
  // check plus the admins/{uid} read, paying a duplicated sequential network
  // round trip on the sign-in critical path. The second caller now joins the
  // first read instead of racing it.
  var inflightResolve = null;   // { uid, promise } | null
  function resolveSession(user) {
    if (!user) {
      // Invalidate any in-flight authorization read: its late completion must
      // never resurrect a session that signed out underneath it.
      ++resolveGeneration;
      inflightResolve = null;
      publish(null);
      return Promise.resolve(null);
    }
    if (!window._db || !window._doc || !window._getDoc) { publish(null); return Promise.resolve(null); }
    if (inflightResolve && inflightResolve.uid === user.uid) return inflightResolve.promise;
    var generation = ++resolveGeneration;
    // A student custom-token session (cueolaStudent claim, minted by the
    // signInWithPin Cloud Function) is never an admin. Resolve it quietly, with
    // no admins/{uid} read and no warning, so student sign-ins do not look like
    // failed admin logins.
    var base = Promise.resolve(user.getIdTokenResult ? user.getIdTokenResult().catch(function () { return null; }) : null).then(function (tok) {
      if (generation !== resolveGeneration) return current();
      if (tok && tok.claims && tok.claims.cueolaStudent) { publish(null); return null; }
      return resolveAdminDoc(user, generation);
    });
    var entry = { uid: user.uid, promise: null };
    var clear = function () { if (inflightResolve === entry) inflightResolve = null; };
    entry.promise = base.then(
      function (value) { clear(); return value; },
      function (err) { clear(); throw err; }
    );
    inflightResolve = entry;
    return entry.promise;
  }
  function resolveAdminDoc(user, generation) {
    return window._getDoc(window._doc(window._db, 'admins', user.uid)).then(function (snap) {
      if (generation !== resolveGeneration) return current();
      if (!snap.exists()) {
        console.warn('Signed in, but no admins/' + user.uid + ' doc — not an authorized admin.');
        publish(null);
        return null;
      }
      var data = snap.data() || {};
      var level = LEVELS.indexOf(data.level) >= 0 ? data.level : 'standard';
      publish({
        id: user.uid,               // adminSession.id === uid everywhere downstream
        uid: user.uid,
        username: String(data.username || usernameFromEmail(user.email)),
        name: String(data.name || data.username || usernameFromEmail(user.email)),
        level: level,
      });
      // An instructor account needs a profile too (the front page, the show
      // list and "assign to a show" all read profiles). Make it if missing.
      ensureProfile(current()).then(function (res) {
        if (res && !res.ok && res.reason === 'student-username') {
          console.warn('Instructor @' + res.username + ' shares a username with a student profile, so it has no instructor profile.');
        }
      });
      return current();
    }).catch(function (err) {
      if (generation !== resolveGeneration) return current();
      // Pre-release production: admins/{uid} reads are denied until the
      // release-day rules deploy. Fail closed but keep the app usable.
      console.warn('admins/{uid} read failed (expected before the v2.1 rules deploy):', err && err.code || err);
      publish(null);
      // A fast connectivity failure is not an authorization verdict. The
      // sentinel lets interactive signIn() say "check the connection" instead
      // of "not an authorized admin"; the passive onAuthStateChanged path
      // ignores the return value, so its quiet fail-closed behavior stands.
      var code = (err && err.code) || '';
      if (code.indexOf('unavailable') >= 0 || code.indexOf('deadline-exceeded') >= 0 || code.indexOf('cancelled') >= 0) {
        return { transient: true };
      }
      return null;
    });
  }

  function bind() {
    if (unsubscribeAuth || !auth() || !fns()) return;
    unsubscribeAuth = fns().onAuthStateChanged(auth(), function (user) {
      resolveSession(user);
    });
  }

  if (window._adminAuth) bind();
  window.addEventListener('firebaseReady', bind);
  // Always settle ready() eventually. Two hang paths end here: Firebase never
  // comes up (offline shell), or a restored session's admins/{uid} read never
  // answers (offline cache stall, rules regression). The dashboard sign-in
  // button waits on ready(), so an unsettled promise means a permanently
  // disabled "Connecting…" button. settleReady is idempotent, and a session
  // that resolves after this still lands through onChange.
  setTimeout(function () { settleReady(); }, 8000);

  function friendlyAuthError(err) {
    var code = err && err.code || '';
    if (code.indexOf('invalid-credential') >= 0 || code.indexOf('wrong-password') >= 0 ||
        code.indexOf('user-not-found') >= 0 || code.indexOf('invalid-email') >= 0) {
      return 'Wrong username or password.';
    }
    if (code.indexOf('too-many-requests') >= 0) return 'Too many attempts. Wait a minute and try again.';
    if (code.indexOf('network-request-failed') >= 0) return 'No connection to the sign-in service.';
    if (code.indexOf('operation-not-allowed') >= 0) return 'Sign-in is not enabled yet (console errand pending).';
    return (err && err.message) || 'Sign-in failed.';
  }

  // Interactive sign-in must never strand the button: if the admins/{uid}
  // authorization read hangs, fail with a truthful message after 10s. Should
  // the read answer later anyway, resolveSession's publish() still lands the
  // session through onChange, so the UI self-heals. On timeout the cached
  // in-flight read is dropped: a hung Firestore channel otherwise pins the
  // stuck promise, and every retry would rejoin it and time out again until
  // the page reloads. The generation guard already stales the old read, so a
  // fresh click gets a fresh getDoc while a late answer stays harmless.
  function resolveSessionWithTimeout(user, ms) {
    var timer = null;
    var main = resolveSession(user);
    // Promise.race never cancels the loser: without this, the timer body ran
    // 10s after every SUCCESSFUL sign-in too, cycling the Firestore network
    // under the live session and clearing a newer same-uid resolve.
    var cancel = function () { if (timer !== null) { clearTimeout(timer); timer = null; } };
    main.then(cancel, cancel);
    return Promise.race([
      main,
      new Promise(function (ignore, reject) {
        timer = setTimeout(function () {
          // Drop only the exact read this attempt raced, so a stale timer can
          // never null a newer in-flight resolve for the same uid.
          if (inflightResolve && inflightResolve.promise === main) inflightResolve = null;
          // A read that hangs this long usually means the Firestore stream is
          // a zombie (sleep/wake, network switch). Cycling the network forces
          // a fresh channel so the retry actually reaches the server. Pages
          // that don't expose the handles just skip the kick.
          if (window._disableNetwork && window._enableNetwork) {
            Promise.resolve(window._disableNetwork()).catch(function () {})
              .then(function () { return window._enableNetwork(); })
              .catch(function () {});
          }
          reject(new Error('The sign-in service is not responding. Check the connection and try again.'));
        }, ms);
      }),
    ]);
  }

  function signIn(username, password) {
    var clean = normalizeUsername(username);
    if (!validUsername(clean)) return Promise.reject(new Error('Usernames are 3 to 40 characters: letters, numbers, dots, dashes.'));
    if (!auth() || !fns()) return Promise.reject(new Error('Sign-in service is still loading. Try again in a moment.'));
    return fns().signInWithEmailAndPassword(auth(), usernameToEmail(clean), String(password || ''))
      .then(function (cred) { return resolveSessionWithTimeout(cred.user, 10000); })
      .then(function (session) {
        if (session && session.transient) throw new Error('Could not reach the authorization service. Check the connection and try again.');
        if (!session) throw new Error('Signed in, but this account is not an authorized admin.');
        return session;
      })
      .catch(function (err) {
        if (err && err.code) throw new Error(friendlyAuthError(err));
        throw err;
      });
  }

  function signOutAdmin() {
    ++resolveGeneration;
    inflightResolve = null;
    publish(null);
    if (!auth() || !fns()) return Promise.resolve();
    return fns().signOut(auth()).catch(function (err) { console.warn('signOut failed', err); });
  }

  function changePassword(currentPassword, newPassword) {
    var user = auth() && auth().currentUser;
    if (!user) return Promise.reject(new Error('Sign in first.'));
    if (String(newPassword || '').length < 8) return Promise.reject(new Error('New password needs at least 8 characters.'));
    var credential = fns().EmailAuthProvider.credential(user.email, String(currentPassword || ''));
    return fns().reauthenticateWithCredential(user, credential)
      .then(function () { return fns().updatePassword(user, String(newPassword)); })
      .catch(function (err) {
        if (err && err.code) throw new Error(friendlyAuthError(err));
        throw err;
      });
  }

  // Super-only: mint an instructor account without disturbing the signed-in
  // session. A secondary app instance does the createUser (which would
  // otherwise sign the page in as the new user); the signed-in super then
  // writes admins/{newUid} with the primary handles (rules: write is super).
  function createInstructor(options) {
    var opts = options || {};
    var username = normalizeUsername(opts.username);
    var name = String(opts.name || '').trim() || username;
    var level = LEVELS.indexOf(opts.level) >= 0 ? opts.level : 'standard';
    var password = String(opts.password || '');
    if (!current() || current().level !== 'super') return Promise.reject(new Error('Only a super admin can create accounts.'));
    if (!validUsername(username)) return Promise.reject(new Error('Usernames are 3 to 40 characters: letters, numbers, dots, dashes.'));
    if (password.length < 8) return Promise.reject(new Error('Temporary password needs at least 8 characters.'));
    var f = fns();
    if (!f || !f.initializeApp || !f.getAuth || !f.createUserWithEmailAndPassword) {
      return Promise.reject(new Error('Sign-in service is still loading. Try again in a moment.'));
    }
    var mintApp = null;
    var mintAuth = null;
    var cleanup = function () {
      if (!mintApp) return Promise.resolve();
      var closeOut = f.deleteApp ? function () { f.deleteApp(mintApp).catch(function () {}); } : function () {};
      return f.signOut(mintAuth).catch(function () {}).then(closeOut, closeOut);
    };
    // The instructor's profile lives at profiles/<username>. If a student
    // already holds that username the instructor could never get a profile,
    // so stop here, before any account exists.
    return readProfile(username).catch(function () { return null; })
      .then(function (taken) {
        if (taken && taken.role !== 'admin') throw new Error('A student profile already uses that username. Pick another one.');
        mintApp = f.initializeApp(auth().app.options, 'adminMint-' + Date.now());
        mintAuth = f.getAuth(mintApp);
        return f.createUserWithEmailAndPassword(mintAuth, usernameToEmail(username), password);
      })
      .then(function (cred) {
        var newUid = cred.user.uid;
        return window._setDoc(window._doc(window._db, 'admins', newUid), {
          username: username,
          name: name,
          level: level,
          createdAt: Date.now(),
          createdBy: current().id,
        }).then(function () {
          // The profile is what puts this instructor on the front page and
          // lets a show be assigned to them. A miss here is not fatal: their
          // first log in makes it.
          return ensureProfile({ username: username, name: name }).then(function (made) {
            return { uid: newUid, username: username, name: name, level: level, profile: !!(made && made.ok) };
          });
        }, function (err) {
            // The Auth user exists but the directory write failed: without a
            // rollback the account can never sign in as an admin, and every
            // retry reports the username as taken. Delete while the fresh
            // user is still signed in on the mint instance.
            return cred.user.delete().then(
              function () { throw err; },
              function () {
                throw new Error('The account directory write failed and the sign-in account could not be rolled back. The username needs a cleanup in the Firebase console before it can be reused.');
              }
            );
          });
      })
      .then(function (result) { return cleanup().then(function () { return result; }); })
      .catch(function (err) {
        return cleanup().then(function () {
          if (err && err.code === 'auth/email-already-in-use') throw new Error('That username is taken.');
          if (err && err.code) throw new Error(friendlyAuthError(err));
          throw err;
        });
      });
  }

  /* ── Instructor profiles and show lists ─────────────────────────────────
   * Every instructor account (admins/{uid}) is paired with a profile at
   * profiles/<username>, role 'admin'. The profile is what the front page
   * signs in, what "assign to a show" looks up, and where the instructor's
   * list of shows lives (profile.sessions). Accounts made before 2026-11-23
   * never got one, so it is made here: when the account is created, and
   * again on log in for accounts that are still missing it. */
  var SHOW_CODE_RE = /^[A-Z0-9_.-]{3,24}$/;
  var profileEnsured = {};   // username -> promise of a successful ensure

  function cloudReady() {
    return !!(window._db && window._doc && window._getDoc && window._setDoc && window._updateDoc
      && window._getDocs && window._collection);
  }
  function profileRef(username) { return window._doc(window._db, 'profiles', username); }
  function readProfile(username) {
    if (!cloudReady()) return Promise.reject(new Error('not-ready'));
    return window._getDoc(profileRef(username)).then(function (snap) { return snap.exists() ? (snap.data() || {}) : null; });
  }
  function newKeyCode() {
    var alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
    var rand = new Uint32Array(6);
    crypto.getRandomValues(rand);
    var code = '';
    for (var i = 0; i < 6; i++) code += alphabet[rand[i] % alphabet.length];
    return code;
  }
  // The rules only accept a new profile that names an active class key of the
  // same role. Reuse an active instructor key; make one if there is none.
  function activeInstructorKey() {
    return window._getDocs(window._collection(window._db, 'accessCodes')).then(function (snap) {
      var hit = '';
      snap.forEach(function (d) {
        var data = d.data() || {};
        if (!hit && data.role === 'admin' && data.active === true) hit = d.id;
      });
      if (hit) return hit;
      var code = newKeyCode();
      var me = current();
      return window._setDoc(window._doc(window._db, 'accessCodes', code), {
        role: 'admin', label: 'Instructor accounts', active: true,
        createdBy: (me && (me.name || me.username)) || 'admin', createdAt: Date.now(),
      }).then(function () { return code; });
    });
  }
  function profileIdForUsername(username) {
    var model = window.CueolaAssignmentModel;
    var id = model && typeof model.profileIdFor === 'function' ? model.profileIdFor(username) : '';
    return id || ('profile_' + username.replace(/[^a-z0-9]/g, '_') + '_' + Date.now().toString(36));
  }

  // account: { username, name }. Resolves { ok, username, profile, created } or
  // { ok:false, reason }. Never rejects.
  function ensureProfile(account) {
    var username = normalizeUsername(account && account.username);
    if (!validUsername(username)) return Promise.resolve({ ok: false, reason: 'bad-username', username: username });
    if (!current()) return Promise.resolve({ ok: false, reason: 'signed-out', username: username });
    if (!cloudReady()) return Promise.resolve({ ok: false, reason: 'not-ready', username: username });
    if (profileEnsured[username]) return profileEnsured[username];
    var name = String((account && account.name) || '').trim() || username;
    var attempt = readProfile(username).then(function (existing) {
      if (existing) {
        if (existing.role !== 'admin') return { ok: false, reason: 'student-username', username: username };
        if (existing.renamedTo || existing.mergedInto) return { ok: false, reason: 'moved', username: username };
        return { ok: true, username: username, profile: existing, created: false };
      }
      return activeInstructorKey().then(function (key) {
        var now = Date.now();
        var doc = {
          username: username, profileId: profileIdForUsername(username), profileAliases: [],
          fullName: name.slice(0, 120), role: 'admin', avatar: { type: 'initials' }, theme: 'cool',
          sessions: [], codeUsed: key, createdAt: now, lastSeen: now,
        };
        return window._setDoc(profileRef(username), doc).then(function () {
          return { ok: true, username: username, profile: doc, created: true };
        });
      });
    }).catch(function (err) {
      return { ok: false, reason: (err && err.code) || (err && err.message) || 'failed', username: username };
    }).then(function (res) {
      if (!res.ok) delete profileEnsured[username];   // let the next call try again
      return res;
    });
    profileEnsured[username] = attempt;
    return attempt;
  }

  function cleanShowCodes(codes) {
    var out = [];
    (Array.isArray(codes) ? codes : [codes]).forEach(function (raw) {
      var c = String(raw || '').trim().toUpperCase();
      if (SHOW_CODE_RE.test(c) && out.indexOf(c) < 0) out.push(c);
    });
    return out;
  }

  // Put show codes on an instructor's own list of shows (their profile), so
  // they show on that instructor's front page. Resolves { ok, added } or
  // { ok:false, reason }. Never rejects.
  function addShowsToProfile(account, codes) {
    var list = cleanShowCodes(codes);
    if (!list.length) return Promise.resolve({ ok: false, reason: 'bad-code' });
    return ensureProfile(account).then(function (res) {
      if (!res.ok) return res;
      // Fresh read: the list may have changed since the profile was checked.
      return readProfile(res.username).then(function (p) {
        var stored = Array.isArray(p && p.sessions) ? p.sessions : [];
        var have = stored.map(function (c) { return String(c).toUpperCase(); });
        var missing = list.filter(function (c) { return have.indexOf(c) < 0; });
        var room = Math.max(0, 100 - have.length);   // the rules cap a profile at 100 shows
        var add = missing.slice(0, room);
        if (!add.length) return { ok: true, added: [], full: missing.length > 0 };
        var value = window._arrayUnion ? window._arrayUnion.apply(null, add) : stored.concat(add);
        return window._updateDoc(profileRef(res.username), { sessions: value }).then(function () {
          return { ok: true, added: add, full: add.length < missing.length };
        });
      }).catch(function (err) { return { ok: false, reason: (err && err.code) || 'failed' }; });
    });
  }

  function removeShowFromProfile(account, code) {
    var c = cleanShowCodes(code)[0];
    var username = normalizeUsername(account && account.username);
    if (!c || !validUsername(username) || !cloudReady()) return Promise.resolve({ ok: false, reason: 'bad-code' });
    return readProfile(username).then(function (p) {
      if (!p) return { ok: true };
      // arrayRemove matches exact values: drop the stored spelling.
      var stored = (p.sessions || []).filter(function (s) { return String(s).toUpperCase() === c; });
      if (!stored.length) return { ok: true };
      var value = window._arrayRemove ? window._arrayRemove.apply(null, stored)
        : (p.sessions || []).filter(function (s) { return String(s).toUpperCase() !== c; });
      return window._updateDoc(profileRef(username), { sessions: value }).then(function () { return { ok: true }; });
    }).catch(function (err) { return { ok: false, reason: (err && err.code) || 'failed' }; });
  }

  // Every instructor account: [{ uid, username, name, level }], by name.
  function listAdmins() {
    if (!cloudReady()) return Promise.reject(new Error('The cloud is not ready yet.'));
    return window._getDocs(window._collection(window._db, 'admins')).then(function (snap) {
      var out = [];
      snap.forEach(function (d) {
        if (d.id === 'global') return;   // legacy list-doc, ignored
        var data = d.data() || {};
        out.push({ uid: d.id, username: String(data.username || ''), name: String(data.name || data.username || ''), level: data.level === 'super' ? 'super' : 'standard' });
      });
      out.sort(function (a, b) { return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }); });
      return out;
    });
  }

  // Push a show to another instructor: it goes on their list of shows, and the
  // show remembers who it was shared with (sessions/<code>.sharedWith, a list
  // of instructor uids) so the dashboard can put it under "Your shows" too.
  function shareShow(code, target) {
    var c = cleanShowCodes(code)[0];
    var docId = String(code || '').trim();   // the show's own spelling of its code
    if (!c || !target || !target.uid) return Promise.resolve({ ok: false, reason: 'bad-code' });
    return addShowsToProfile(target, [c]).then(function (res) {
      if (!res.ok) return res;
      if (res.full) return { ok: false, full: true, reason: 'list-full' };
      return window._updateDoc(window._doc(window._db, 'sessions', docId), { sharedWith: window._arrayUnion(target.uid) })
        .then(function () { return { ok: true }; },
              function (err) { return { ok: false, reason: (err && err.code) || 'failed' }; });
    });
  }
  function unshareShow(code, target) {
    var c = cleanShowCodes(code)[0];
    var docId = String(code || '').trim();
    if (!c || !target || !target.uid) return Promise.resolve({ ok: false, reason: 'bad-code' });
    return window._updateDoc(window._doc(window._db, 'sessions', docId), { sharedWith: window._arrayRemove(target.uid) })
      .then(function () { return removeShowFromProfile(target, c); },
            function (err) { return { ok: false, reason: (err && err.code) || 'failed' }; });
  }

  function current() {
    return adminSession ? {
      id: adminSession.id, uid: adminSession.uid, username: adminSession.username,
      name: adminSession.name, level: adminSession.level,
    } : null;
  }

  function onChange(callback) {
    if (typeof callback !== 'function') return function () {};
    changeCallbacks.push(callback);
    if (sessionResolved) { try { callback(current()); } catch (err) {} }
    return function () {
      var index = changeCallbacks.indexOf(callback);
      if (index >= 0) changeCallbacks.splice(index, 1);
    };
  }

  function ready() {
    if (sessionResolved) return Promise.resolve(current());
    return new Promise(function (resolve) { readyResolvers.push(resolve); });
  }

  window.CueolaAdminAuth = {
    ADMIN_EMAIL_DOMAIN: ADMIN_EMAIL_DOMAIN,
    LEVELS: LEVELS.slice(),
    validUsername: validUsername,
    usernameToEmail: usernameToEmail,
    usernameFromEmail: usernameFromEmail,
    signIn: signIn,
    signOut: signOutAdmin,
    changePassword: changePassword,
    createInstructor: createInstructor,
    ensureProfile: ensureProfile,
    addShowsToProfile: addShowsToProfile,
    removeShowFromProfile: removeShowFromProfile,
    listAdmins: listAdmins,
    shareShow: shareShow,
    unshareShow: unshareShow,
    current: current,
    onChange: onChange,
    ready: ready,
  };
})();
