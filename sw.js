const CACHE_NAME = 'facelink-prod-v2';
const ASSETS_TO_CACHE = [
  '/',
  '/index.html',
  '/style.css',
  '/script.js',
  '/manifest.json',
  '/favicon.ico',
  '/assets/favicon.png'
];

// 1. INSTALL EVENT - Cache assets & force immediate takeover
self.addEventListener('install', (event) => {
  self.skipWaiting(); // Forces this new worker to activate instantly instead of waiting for tabs to close
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS_TO_CACHE))
  );
});

// 2. ACTIVATE EVENT - Clean up old caches & take control of the page
self.addEventListener('activate', (event) => {
  event.waitUntil(clients.claim()); // Instantly controls all open FaceLink tabs
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) return caches.delete(key);
        })
      );
    })
  );
});

// 3. FETCH EVENT - Network First, Fallback to Cache
self.addEventListener('fetch', (event) => {
  // Ignore non-GET requests and WebRTC/Socket.io traffic
  if (event.request.method !== 'GET' || event.request.url.includes('socket.io') || event.request.url.includes('peerjs')) {
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then((networkResponse) => {
        // If the network request is successful, update the cache invisibly in the background
        const responseClone = networkResponse.clone();
        caches.open(CACHE_NAME).then((cache) => {
          cache.put(event.request, responseClone);
        });
        return networkResponse; // Serve the fresh file to the user
      })
      .catch(() => {
        // If the user is offline or the network fails, serve the local cached version
        return caches.match(event.request);
      })
  );
});
