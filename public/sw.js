/**
 * Minimal service worker so Chromium treats this site as an installable PWA
 * (manifest + SW with fetch handler → beforeinstallprompt can fire).
 * Pass-through fetch — no offline cache; keeps behavior identical to no SW.
 */
self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  event.respondWith(fetch(event.request));
});
