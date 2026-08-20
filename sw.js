// Daly Recovery — service worker
// Bump CACHE_VERSION whenever you ship an updated app shell.
const CACHE_VERSION = 'daly-recovery-v2';
const APP_SHELL = [
  '/',
  '/index.html',
  '/dashboard.html',
  '/manifest.webmanifest',
  '/css/nocturne.css',
  '/js/firebase-config.js',
  '/js/app.js',
  '/js/dashboard.js',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Network-first for HTML (so residents always see the latest UI when online),
// cache-first for static assets (fast, works offline).
// Skip caching for Firebase & Stripe API calls.
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Don't cache Firebase, Stripe, or Google APIs
  if (url.hostname.includes('googleapis.com') ||
      url.hostname.includes('firebaseio.com') ||
      url.hostname.includes('stripe.com') ||
      url.hostname.includes('gstatic.com') ||
      url.hostname.includes('cloudfunctions.net')) {
    return;
  }

  const isHTML = req.mode === 'navigate' || (req.headers.get('accept') || '').includes('text/html');

  if (isHTML) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE_VERSION).then((c) => c.put(req, copy));
          return res;
        })
        .catch(() => caches.match(req).then((hit) => hit || caches.match('/')))
    );
    return;
  }

  event.respondWith(
    caches.match(req).then((hit) => {
      if (hit) return hit;
      return fetch(req).then((res) => {
        if (res.ok && url.origin === self.location.origin) {
          const copy = res.clone();
          caches.open(CACHE_VERSION).then((c) => c.put(req, copy));
        }
        return res;
      });
    })
  );
});
