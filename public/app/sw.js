// Service worker: guarda la app para que abra rápido y funcione con mala señal.
// Los datos (/v1/...) siempre van a la red; si no hay señal, la app usa su cola interna.
const VERSION = 'app506-v2'; // cambiar la versión fuerza a los celulares a descargar la app nueva
const ARCHIVOS = ['/app/', '/app/index.html', '/app/app.css', '/app/app.js', '/app/manifest.webmanifest', '/app/icon-192.png', '/brand/logo-506-blanco.svg', '/brand/favicon.svg'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(ARCHIVOS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || !(url.pathname.startsWith('/app') || url.pathname.startsWith('/brand'))) return;
  // Red primero (para recibir actualizaciones); si falla, la copia guardada
  e.respondWith(
    fetch(e.request)
      .then((r) => { const copia = r.clone(); caches.open(VERSION).then((c) => c.put(e.request, copia)); return r; })
      .catch(() => caches.match(e.request).then((r) => r || caches.match('/app/index.html')))
  );
});
