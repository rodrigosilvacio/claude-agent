// Basic offline app-shell cache. Bump CACHE_NAME (and the file list below)
// every time the ?v=N of styles.css/app.js/supabaseClient.js changes, so
// the old versioned URLs get dropped instead of piling up forever.
var CACHE_NAME = 'pandafit-v29';
var APP_SHELL = [
  './index.html',
  './manifest.json',
  './assets/styles.css?v=29',
  './assets/app.js?v=29',
  './assets/supabaseClient.js?v=29',
  './assets/icon-192.png',
  './assets/icon-512.png',
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(function (cache) { return cache.addAll(APP_SHELL); })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys()
      .then(function (names) {
        return Promise.all(names.filter(function (n) { return n !== CACHE_NAME; }).map(function (n) { return caches.delete(n); }));
      })
      .then(function () { return self.clients.claim(); })
  );
});

// Same-origin GET only — Supabase (REST/Storage) and esm.sh requests are
// cross-origin and always go straight to the network, so the app's data
// is never served stale from cache.
self.addEventListener('fetch', function (event) {
  if (event.request.method !== 'GET') return;
  var url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    caches.match(event.request).then(function (cached) {
      var networkFetch = fetch(event.request).then(function (response) {
        if (response && response.status === 200) {
          var copy = response.clone();
          caches.open(CACHE_NAME).then(function (cache) { cache.put(event.request, copy); });
        }
        return response;
      }).catch(function () { return cached; });
      return cached || networkFetch;
    })
  );
});
