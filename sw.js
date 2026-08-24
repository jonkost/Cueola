/* Cueola offline shell — dependency-free and intentionally same-origin only. */
const SHELL_ASSETS = [
  './',
  './index.html',
  './dashboard.html',
  './script-operator.html',
  './outrangutan/output.html',
  './manifest.webmanifest',
  './assets/Brand/Cueola_Icon.svg',
  './assets/Brand/Outrangutan_icon.svg',
  './assets/Brand/KeyWi_icon.svg',
  // PWA icon set (Phase 9 / D10.3) — PNG install + touch icons, unversioned
  // like the Brand SVGs: artwork changes ride a WORKER_SCHEMA bump.
  './assets/icons/app/cueola-32.png',
  './assets/icons/app/cueola-192.png',
  './assets/icons/app/cueola-512.png',
  './assets/icons/app/cueola-maskable-192.png',
  './assets/icons/app/cueola-maskable-512.png',
  './assets/icons/app/apple-touch-icon.png',
  './assets/icons/app/cueola-file-256.png',
  './assets/icons/app/outrangutan-file-256.png',
  './assets/icons/app/outrangutan-touch-180.png',
  // Script Operator controls must retain deterministic SF Symbol masks when
  // the dedicated window is opened for the first time while offline.
  './design-system/apple/symbols/runtime/light-small/objectsandtools/paperclip.svg',
  './design-system/apple/symbols/runtime/light-small/objectsandtools/xmark.svg',
  './design-system/apple/symbols/runtime/light-small/objectsandtools/trash.svg',
  './design-system/apple/symbols/runtime/light-small/editing/pencil.svg',
  './design-system/apple/symbols/runtime/light-small/arrows/arrowshape.turn.up.right.fill.svg',
  './design-system/apple/symbols/runtime/light-small/arrows/arrowshape.left.svg',
  './design-system/apple/symbols/runtime/light-small/arrows/arrowshape.right.svg',
  './design-system/apple/symbols/runtime/light-small/objectsandtools/repeat.svg',
  './design-system/apple/symbols/runtime/light-small/editing/scissors.svg',
  './design-system/apple/symbols/runtime/light-small/arrows/arrow.up.to.line.svg',
  './design-system/apple/symbols/runtime/light-small/media/display.svg',
  './design-system/apple/symbols/runtime/light-small/textformatting/list.bullet.svg',
  './design-system/apple/symbols/runtime/light-small/objectsandtools/circle.fill.svg',
  './design-system/apple/symbols/runtime/light-small/media/pause.svg',
  './design-system/apple/symbols/runtime/light-small/media/play.display.svg',
  './design-system/apple/symbols/runtime/light-small/media/stop.circle.svg',
  './design-system/apple/symbols/runtime/light-small/objectsandtools/bell.svg',
  './design-system/apple/symbols/runtime/light-small/objectsandtools/bell.badge.svg',
  './design-system/apple/symbols/runtime/light-small/objectsandtools/info.svg',
  './design-system/apple/symbols/runtime/light-small/time/timer.svg',
  './design-system/apple/symbols/runtime/light-small/privacyandsecurity/exclamationmark.triangle.svg',
  './design-system/apple/symbols/runtime/light-small/objectsandtools/clock.svg',
  'assets/sf-symbols.css?v=a5c5015e64',
  // Vendored libraries — same-origin so imports and paperwork exports never
  // depend on CDN reachability during a show (pinned jspdf 2.5.1 /
  // html2canvas 1.4.1 / pdf.js 3.11.174 / mammoth 1.6.0 / jszip 3.10.1).
  'assets/vendor/jspdf.umd.min.js',
  'assets/vendor/html2canvas.min.js',
  'assets/vendor/pdf.min.js',
  'assets/vendor/pdf.worker.min.js',
  'assets/vendor/mammoth.browser.min.js',
  'assets/vendor/jszip.min.js',
  // Fun avatar art (Twemoji, CC-BY 4.0) — precached so the portal grid
  // and note chips render offline during a show.
  'assets/avatars/alien.svg',
  'assets/avatars/bunny.svg',
  'assets/avatars/clapper.svg',
  'assets/avatars/coffee.svg',
  'assets/avatars/crown.svg',
  'assets/avatars/cupcake.svg',
  'assets/avatars/dice.svg',
  'assets/avatars/fire.svg',
  'assets/avatars/flamingo2.svg',
  'assets/avatars/frog.svg',
  'assets/avatars/ghost.svg',
  'assets/avatars/guitar.svg',
  'assets/avatars/headphones.svg',
  'assets/avatars/koala2.svg',
  'assets/avatars/ninja.svg',
  'assets/avatars/orangutan2.svg',
  'assets/avatars/paint.svg',
  'assets/avatars/panda2.svg',
  'assets/avatars/pizza.svg',
  'assets/avatars/popcorn.svg',
  'assets/avatars/rainbow.svg',
  'assets/avatars/robot.svg',
  'assets/avatars/rocket.svg',
  'assets/avatars/shades.svg',
  'assets/avatars/taco.svg',
  'assets/avatars/trex.svg',
  'assets/avatars/turtle.svg',
  'assets/avatars/unicorn.svg',
  // KeyWi podcast badge pack (original in-repo art) — precached so key art
  // renders offline; owner-added packs under assets/keywi-art/ load online.
  'assets/keywi-art/podcast/aura.svg',
  'assets/keywi-art/podcast/banger.svg',
  'assets/keywi-art/podcast/big-l.svg',
  'assets/keywi-art/podcast/big-w.svg',
  'assets/keywi-art/podcast/clip-that.svg',
  'assets/keywi-art/podcast/cooked.svg',
  'assets/keywi-art/podcast/goat.svg',
  'assets/keywi-art/podcast/hot-take.svg',
  'assets/keywi-art/podcast/lets-go.svg',
  'assets/keywi-art/podcast/locked-in.svg',
  'assets/keywi-art/podcast/mic-drop.svg',
  'assets/keywi-art/podcast/no-cap.svg',
  'assets/keywi-art/podcast/real.svg',
  'assets/keywi-art/podcast/rent-free.svg',
  'assets/keywi-art/manifest.js?v=a8af0e1bfe',
  // The Break Room demo playout media (break-room-show.js section 4):
  // precached unversioned like the avatar art so seedBreakRoomShow()
  // (outrangutan/outrangutan.js) can import the authored show even offline.
  // Artwork/content changes here ride a WORKER_SCHEMA bump.
  'demo-media/bars-16x9.mp4',
  'demo-media/bars-4x3.mp4',
  'demo-media/bars-9x16.mp4',
  'demo-media/still-16x9.png',
  'demo-media/still-4x3.jpg',
  'demo-media/sfx-ding.wav',
  'demo-media/demo-applause.wav',
  'demo-media/demo-aww.wav',
  'demo-media/demo-rimshot.wav',
  'demo-media/demo-airhorn.wav',
  'cueola-avatar-profile.js?v=564c2fe2eb',
  'cueola-assignment-model.js?v=d81e0cf353',
  'cueola-session-clone.js?v=4a94fe587e',
  'break-room-show.js?v=0d8b8b324b',
  'cueola-export-model.js?v=75dc3942e7',
  'cueola-prepro-sync.js?v=98291546f4',
  'cueola-pin.js?v=e599f35d21',
  'cueola-identity.js?v=6e8db95512',
  'cueola-admin-auth.js?v=680d495914',
  'cueola-live-session.js?v=fd0bc73200',
  'cueola-link-state.js?v=effa089bdc',
  'cueola-keymap.js?v=ffb4fb0e1a',
  'cueola-prompter-session.js?v=1002259f73',
  'cueola-script-operator-protocol.js?v=414e116aee',
  'cueola-scriptop-prefs.js?v=dfcf350611',
  'script-operator.js?v=59596116d0',
  'script-operator.css?v=6cafc1f059',
  'outrangutan/output-protocol.js?v=1137628cc7',
  'outrangutan/output-command-queue.js?v=d3ef82b3a4',
  'outrangutan/stream-deck-label.js?v=bef2fc8307',
  'cueola-app.js?v=a58d6551ee',
  'outrangutan/outrangutan.css?v=98c3501a8e',
  'outrangutan/outrangutan.js?v=904a221319',
  'cueola-streamdeck-device.js?v=48990ed663',
  'cueola-obs.js?v=53b3859b7c',
  'cueola-streamdeck.js?v=5e04c813d2',
];

const versionSignature = SHELL_ASSETS
  .map(path => new URL(path, self.location.href).searchParams.get('v'))
  .filter(Boolean)
  .join('-');
// Bumped for cache-policy OR page-HTML-only releases: the shell caches
// index.html/dashboard.html, whose content never feeds versionSignature —
// an HTML-only change must roll the cache name here (V2 Phase 3 learning d).
// 6→7: V2 brand icons — assets/Brand/*.svg are precached UNVERSIONED, so only
// a schema bump rolls the shell cache and delivers the new artwork.
// 7→8: Phase 9 PWA icons + manifest file_handlers — new unversioned PNGs and
// a manifest.webmanifest change (both precached unversioned) need the roll.
// 8→9: avatar-modal mouse-trap fix is page-HTML CSS — the shell serves
// index.html cache-first forever, so installed clients only get the fix when
// the cache name rolls (per this file's own HTML-only-change rule).
// 9→10: 2.1.0 version flip + shape-token sweep + em-dash copy sweep are
// page-HTML changes, and the info glyph moved to the unversioned info.svg.
// 10→11: Control Surface (Stream Deck + XL) — new #streamdeck screen markup +
// styles + launcher card in index.html (an HTML change the shell caches), plus
// two new precached modules (cueola-streamdeck-device.js / cueola-streamdeck.js).
// 11->12: KeyWi rounds 3-5 (streamer-deck key art, deck themes, preview mode,
// SF Symbols on keys) change index.html markup/CSS and cueola-app/streamdeck/obs
// JS; roll the shell so a plain reload picks it all up.
// 12->13: renamed to "KeyWi Bird" + new brand icon assets/Brand/KeyWi_icon.svg
// (precached unversioned) on the front-page card and the screen header.
// 13->14: KeyWi face-lift round — app-banded default layouts, Micochondria
// panel, setup wizard, deck shell + on-screen strip, PLBK vol, OBS stream
// volume. index.html markup/CSS changed (screen header, wizard mount, entry
// card, shared .app-back), so the shell must roll along with the JS bumps.
// 14->15: The Break Room test show: new precached break-room-show.js module
// plus index.html (front-door demo card) and dashboard.html (Create Test Show)
// markup changes the shell caches; roll so installed clients get all three.
// 15->16: v2.2 front page: instructor-gated Break Room button, 2-up app card
// grid + glass restyle, version flip to 2.2.0. index.html markup/CSS changed
// alongside the cueola-app/cueola-identity bumps, so the shell must roll.
// 17->18: assigned-session pickers on every join surface (Planda Bear,
// typed-code, Flowmingo Remote Op, Outrangutan). index.html grew the
// your-sessions containers + row CSS the shell caches, so the shell rolls
// with the identity/app/outrangutan JS bumps.
// 19->20: loose-ends round. Roll for three reasons at once: (1) the
// entitlement layer is gone (cueola-entitlements.js left the precache and
// index.html), (2) the runtime cache stops storing HTML — rolling purges any
// wrong-page entries the old poisoning bug already cached in installed
// clients, (3) index.html/dashboard.html page-HTML changes (dead
// Create-a-Session modal removed, focus/diag CSS) ride the shell cache.
// 25->26: v2.2.1. Three reasons at once, all of which the shell caches:
// (1) new Cueola + Flowmingo brand art re-inlined into the index.html /
// dashboard.html sprites AND sitting in assets/Brand/ (brand SVGs are
// precached UNVERSIONED, so artwork only reaches installed clients when the
// cache name rolls), (2) the project-wide stroke pass rewrote page CSS in
// index.html and dashboard.html, (3) Planda Bear's header lockup and the
// Production Notes move are page-HTML markup changes.
// 26->27: second Cueola app-icon revision (koala on the play triangle). It
// lands in three precached places at once: assets/Brand/Cueola_Icon.svg, the
// re-inlined #ic-cueola sprites in index.html/dashboard.html, and every PNG in
// assets/icons/app/ (all unversioned), so only a cache-name roll reaches
// installed clients. 26 was never shipped, but a local preview may already
// hold it, and same-schema art would be served stale from that shell.
// 27->28: owner punch list, all of it page HTML the shell caches: the
// Flowmingo Op Hotkeys panel back to key-first rows, Production Notes as a
// full-width card above the paperwork grid (header button retired), the
// Planda Bear gear menu gaining the export and preview actions, and the
// entry profile chip filling its circle. 27 never shipped either, but a
// local preview may hold its shell.
// 28->29: Stage Plot (D4) ships. The editor markup, its CSS (incl. the
// modal-id theme lists), and the paper sheet styles are all page HTML the
// shell caches, so the new paperwork page only reaches installed clients on
// a cache-name roll.
// 29->30: position assignments move to the Planda Bear hub. The gear menu's
// new Admin sign-in row is page HTML the shell caches, and a stale shell
// would pair old markup with the relocated editor's JS.
// 30->31: sign-in gate. Students now enter a 4 digit PIN and admins their
// password at the front door; a new precached module (cueola-pin.js) plus the
// gate markup in index.html and the Reset PIN control in dashboard.html are all
// shell-cached. A stale shell would serve the old passwordless card and never
// load cueola-pin.js, so the gate must ride a cache-name roll.
// 31->32: server-side auth Phase 1. index.html's Firebase bootstrap now loads
// the functions SDK and exposes the student sign-in callable path; the shell
// caches index.html, so installed clients need the roll to pick up the
// custom-token sign-in wiring. (The Cloud Function itself deploys separately;
// see docs/auth-migration-runbook.md.)
// 32->33: server-side auth Phase 2. The cloud entry gate (a signed-in profile
// is now required to join a session, open shared paperwork, drive a prompter,
// or create a SHARED blank slate) lives in cueola-app.js, and the pre-auth
// sign-in/create flows now route through Cloud Functions. A stale shell would
// keep the old code-only doors open and then fail every write once the Phase 2
// rules land, silently, mid-show. The fleet MUST be on this shell before those
// rules deploy: see docs/auth-migration-runbook.md.
// 33->34: server-side auth Phase 3. PIN salts and hashes moved to a
// client-unreadable pinSecrets collection, so setting or resetting a PIN is a
// Cloud Function call now. The set-PIN gate grew a class login code field
// (index.html markup) and the dashboard's Reset PIN calls a function, both of
// which the shell caches. A stale shell would keep trying to write a hash onto
// the profile doc, which the Phase 3 rules refuse.
// 40->41: prompter scrub feel. The scrub dial answers the first detent
// immediately and the talent screen eases toward the target instead of
// jumping (cueola-app.js + cueola-streamdeck.js), and Deck settings grew a
// per-deck dial direction flip whose chip styling (.sd-mini.cur) lives in the
// cached index.html shell.
// 41->42: a parked READY · MANUAL call grew an AUTO button in the call banner
// (index.html markup + CSS), the KeyWi window now joins the session the
// launcher hands it, and the deck strip monitors ride show truth.
const WORKER_SCHEMA = '42';
const CACHE_NAME = `cueola-shell-${WORKER_SCHEMA}-${versionSignature || 'dev'}`;
const CACHE_PREFIX = 'cueola-shell-';

self.addEventListener('install', event => {
  // cache:'reload' bypasses the browser HTTP cache at install. Without it,
  // unversioned entries (index.html, dashboard.html, brand SVGs, manifest)
  // can be precached from a stale HTTP-cache copy, and a schema roll would
  // ship the old shell anyway — the exact stale-shell trap this file's
  // changelog keeps relearning. Versioned ?v= URLs never hit that path.
  event.waitUntil(caches.open(CACHE_NAME).then(cache =>
    cache.addAll(SHELL_ASSETS.map(url => new Request(url, { cache: 'reload' })))));
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter(name => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME).map(name => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  // Firebase SDKs, Firestore, App Check, and the local emulator are different
  // origins and intentionally remain under their own networking/persistence.
  if (url.origin !== self.location.origin || url.pathname.endsWith('/sw.js')) return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    if (request.mode === 'navigate') {
      // Hosting serves clean URLs (firebase.json cleanUrls + rewrites), so the
      // address users actually hold is the SHORT one — match both spellings or
      // the dashboard/operator/output pages are unreachable offline. Bare
      // /outrangutan is deliberately NOT here: hosting rewrites it to the
      // front page (it is a screen inside index.html, not output.html).
      const p = url.pathname;
      const shellPage = (p.endsWith('/dashboard.html') || p.endsWith('/dashboard'))
        ? './dashboard.html'
        : (p.endsWith('/script-operator.html') || p.endsWith('/script-operator'))
          ? './script-operator.html'
        : (p.endsWith('/outrangutan/output.html') || p.endsWith('/outrangutan/output'))
          ? './outrangutan/output.html'
          : './index.html';
      return (await cache.match(shellPage)) || fetch(request);
    }
    const cached = await cache.match(request);
    if (cached) return cached;
    try {
      const response = await fetch(request);
      // Hosting's catch-all rewrite answers ANY missing same-origin file with
      // index.html + 200, and this cache is read cache-first — caching that
      // answer would serve the wrong page for that URL forever. No legitimate
      // runtime-cache target here is HTML (all HTML is precached and served
      // via the navigate branch above), so an HTML response means "missing
      // file": pass it through but never store it.
      const contentType = response.headers.get('content-type') || '';
      if (response.ok && response.type === 'basic' && !response.redirected && !contentType.includes('text/html')) {
        cache.put(request, response.clone());
      }
      return response;
    } catch (err) {
      throw err;
    }
  })());
});
