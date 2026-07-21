/* Cueola offline shell — dependency-free and intentionally same-origin only. */
const SHELL_ASSETS = [
  './',
  './index.html',
  './dashboard.html',
  './script-operator.html',
  './outrangutan/output.html',
  './manifest.webmanifest',
  './assets/Brand/Cueola_Icon.svg',
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
  './design-system/apple/symbols/runtime/light-small/objectsandtools/info.circle.svg',
  './design-system/apple/symbols/runtime/light-small/time/timer.svg',
  './design-system/apple/symbols/runtime/light-small/privacyandsecurity/exclamationmark.triangle.svg',
  './design-system/apple/symbols/runtime/light-small/objectsandtools/clock.svg',
  'assets/sf-symbols.css?v=4adcd0fd7c',
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
  'cueola-entitlements.js?v=746c10a762',
  'cueola-avatar-profile.js?v=e56e5e6cd7',
  'cueola-assignment-model.js?v=d81e0cf353',
  'cueola-session-clone.js?v=fe05f41dfc',
  'cueola-export-model.js?v=3e21300eb6',
  'cueola-prepro-sync.js?v=98291546f4',
  'cueola-identity.js?v=d5f452410b',
  'cueola-admin-auth.js?v=de859c513b',
  'cueola-live-session.js?v=2352bc00d1',
  'cueola-link-state.js?v=effa089bdc',
  'cueola-prompter-session.js?v=1002259f73',
  'cueola-script-operator-protocol.js?v=209555b4d7',
  'script-operator.js?v=02e366509b',
  'script-operator.css?v=c455a9dec9',
  'outrangutan/output-protocol.js?v=515bfb5721',
  'outrangutan/output-command-queue.js?v=d3ef82b3a4',
  'outrangutan/stream-deck-label.js?v=c7c4b7128a',
  'cueola-app.js?v=7894264a15',
  'outrangutan/outrangutan.css?v=47e5f195bf',
  'outrangutan/outrangutan.js?v=74b64a7c45',
];

const versionSignature = SHELL_ASSETS
  .map(path => new URL(path, self.location.href).searchParams.get('v'))
  .filter(Boolean)
  .join('-');
// Bumped for cache-policy OR page-HTML-only releases: the shell caches
// index.html/dashboard.html, whose content never feeds versionSignature —
// an HTML-only change must roll the cache name here (V2 Phase 3 learning d).
const WORKER_SCHEMA = '6';
const CACHE_NAME = `cueola-shell-${WORKER_SCHEMA}-${versionSignature || 'dev'}`;
const CACHE_PREFIX = 'cueola-shell-';

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(SHELL_ASSETS)));
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
  // restore-p2607.html is a recovery utility that must never be shell-cached.
  if (url.origin !== self.location.origin || url.pathname.endsWith('/sw.js') || url.pathname.endsWith('/restore-p2607.html')) return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    if (request.mode === 'navigate') {
      const shellPage = url.pathname.endsWith('/dashboard.html')
        ? './dashboard.html'
        : url.pathname.endsWith('/script-operator.html')
          ? './script-operator.html'
        : url.pathname.endsWith('/outrangutan/output.html')
          ? './outrangutan/output.html'
          : './index.html';
      return (await cache.match(shellPage)) || fetch(request);
    }
    const cached = await cache.match(request);
    if (cached) return cached;
    try {
      const response = await fetch(request);
      if (response.ok && response.type === 'basic') cache.put(request, response.clone());
      return response;
    } catch (err) {
      throw err;
    }
  })());
});
