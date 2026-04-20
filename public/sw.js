/**
 * Minimal service worker so Chromium treats this site as an installable PWA
 * (manifest + SW with fetch handler → beforeinstallprompt can fire).
 *
 * Do **not** call respondWith(fetch(...)): re-fetching inside the SW caused flaky
 * `Failed to fetch` / FetchEvent rejections for long POSTs (e.g. admin migration)
 * and some /api/* calls. Leaving the handler empty uses the default network path
 * (same as having no SW for those requests).
 */
self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", () => {
  /* default: browser handles the request */
});
