/**
 * PuzzleHub Service Worker v2
 * Provides offline support and caching for the code-split production build.
 *
 * Strategy:
 *   • Precache the app shell + main bundle during install.
 *   • Stale-While-Revalidate for everything else → instant loads from cache
 *     while keeping assets fresh (immutable static assets are long-cached at
 *     the edge via _headers, so SW mainly serves offline).
 */

const CACHE_NAME = 'puzzlehub-v2';

const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/style.min.css?v=5e999e8d',
  '/script.min.js?v=130b9ef2',
  '/manifest.json',
  '/favicon.ico',
  '/assets/icons/icon-192.png',
  '/assets/icons/icon-512.png',
  '/assets/icons/icon-512.avif',
  'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Space+Grotesk:wght@500;600;700&family=JetBrains+Mono:wght@500;700&display=swap'
];

// Install — precache the app shell (best-effort; never block install on a
// single failed asset).
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      cache.addAll(STATIC_ASSETS).catch(() => Promise.resolve())
    )
  );
  self.skipWaiting();
});

// Activate — evict obsolete caches and claim clients immediately.
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(
        names.filter((name) => name !== CACHE_NAME).map((name) => caches.delete(name))
      )
    )
  );
  self.clients.claim();
});

// Fetch — Stale-While-Revalidate (skip cross-origin ad/analytics traffic).
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  const url = event.request.url;

  if (
    url.includes('pagead2.googlesyndication.com') ||
    url.includes('google-analytics.com') ||
    url.includes('googletagmanager.com') ||
    url.includes('cdn-cgi') ||
    url.includes('doubleclick.net')
  ) {
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      const fetchPromise = fetch(event.request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const responseClone = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, responseClone);
            });
          }
          return networkResponse;
        })
        .catch(() => cachedResponse);

      return cachedResponse || fetchPromise;
    })
  );
});
