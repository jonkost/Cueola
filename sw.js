/* Cueola offline shell — dependency-free and intentionally same-origin only. */
const SHELL_ASSETS = [
  './',
  './index.html',
  './dashboard.html',
  './manifest.webmanifest',
  './assets/Brand/Cueola_Icon.svg',
  'assets/sf-symbols.css?v=127986b7a0',
  'cueola-entitlements.js?v=746c10a762',
  'cueola-avatar-profile.js?v=943c230239',
  'cueola-identity.js?v=cdbcf0c796',
  'cueola-app.js?v=31687e1dd4',
  'outrangutan/outrangutan.css?v=24804b1147',
  'outrangutan/outrangutan.js?v=7e7c8bd44a',
];

const versionSignature = SHELL_ASSETS
  .map(path => new URL(path, self.location.href).searchParams.get('v'))
  .filter(Boolean)
  .join('-');
const WORKER_SCHEMA = '1'; // bump only when cache behavior changes, not for assets
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
  if (url.origin !== self.location.origin || url.pathname.endsWith('/sw.js')) return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    if (request.mode === 'navigate') {
      const shellPage = url.pathname.endsWith('/dashboard.html') ? './dashboard.html' : './index.html';
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
