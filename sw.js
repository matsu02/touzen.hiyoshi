'use strict';

// Bump this version when changing the shell or the offline behavior.
const CACHE_VERSION = 'v5';
const APP_ROOT = new URL('./', self.registration.scope);
const CACHE_PREFIX = `hiyoshi-pwa-${APP_ROOT.pathname}-`;
const CACHE_NAME = `${CACHE_PREFIX}${CACHE_VERSION}`;
const SHELL_FILES = [
  'index.html',
  'app.html',
  'manifest.webmanifest',
  'assets/style.css',
  'assets/journal.css',
  'assets/hero.css',
  'assets/schedule.css',
  'assets/pwa.css',
  'assets/site-config.js',
  'assets/announcement.js',
  'assets/journal-data.js',
  'assets/site.js',
  'assets/calendar-data.js',
  'assets/calendar.js',
  'assets/pwa.js',
  'assets/icons/icon-192.png',
  'assets/icons/icon-512.png',
  'assets/icons/apple-touch-icon.png',
  'assets/qr/hiyoshi-schedule-iphone.png'
];
const SHELL_URLS = SHELL_FILES.map(path => new URL(path, APP_ROOT).href);
const SHELL_PATHS = new Set(SHELL_URLS.map(url => new URL(url).pathname));
const INDEX_URL = new URL('index.html', APP_ROOT).href;

self.addEventListener('install', event => {
  // A new worker waits for existing pages to close before taking over.
  // All shell files must be available before this offline cache is accepted.
  event.waitUntil(caches.open(CACHE_NAME).then(cache =>
    cache.addAll(SHELL_URLS.map(url => new Request(url, { cache: 'reload' })))
  ));
});

self.addEventListener('activate', event => {
  // Leave other apps on the same GitHub Pages origin and scope alone.
  event.waitUntil(caches.keys().then(names => Promise.all(names
    .filter(name => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME)
    .map(name => caches.delete(name))
  )));
});

async function networkFirst(request, cacheKey) {
  const cache = await caches.open(CACHE_NAME).catch(() => null);
  try {
    // Revalidate online so announcements, scripts, and packaged dates can update.
    const response = await fetch(request, { cache: 'no-cache' });
    if (cache && response.status === 200 && !response.redirected) {
      // Cache storage failures must not prevent a working network response.
      try { await cache.put(cacheKey, response.clone()); } catch { /* e.g. quota */ }
    }
    return response;
  } catch (error) {
    const saved = cache && await cache.match(cacheKey);
    if (saved) return saved;
    throw error;
  }
}

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== APP_ROOT.origin) return;

  // Only cache this fixed shell. In particular, never intercept calendar.json:
  // calendar.js needs its network error to label the packaged dates as saved data.
  // Photos, other pages, and Google Calendar requests keep normal browser behavior.
  const isHomeNavigation = request.mode === 'navigate' && url.pathname === APP_ROOT.pathname;
  if (!isHomeNavigation && !SHELL_PATHS.has(url.pathname)) return;
  const cacheKey = isHomeNavigation ? INDEX_URL : new URL(url.pathname, APP_ROOT.origin).href;
  event.respondWith(networkFirst(request, cacheKey));
});
