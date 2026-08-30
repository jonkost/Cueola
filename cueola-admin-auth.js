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
    var mintName = 'adminMint-' + Date.now();
    var mintApp = f.initializeApp(auth().app.options, mintName);
    var mintAuth = f.getAuth(mintApp);
    var cleanup = function () {
      var closeOut = f.deleteApp ? function () { f.deleteApp(mintApp).catch(function () {}); } : function () {};
      return f.signOut(mintAuth).catch(function () {}).then(closeOut, closeOut);
    };
    return f.createUserWithEmailAndPassword(mintAuth, usernameToEmail(username), password)
      .then(function (cred) {
        var newUid = cred.user.uid;
        return window._setDoc(window._doc(window._db, 'admins', newUid), {
          username: username,
          name: name,
          level: level,
          createdAt: Date.now(),
          createdBy: current().id,
        }).then(function () { return { uid: newUid, username: username, name: name, level: level }; })
          .catch(function (err) {
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
    current: current,
    onChange: onChange,
    ready: ready,
  };
})();
