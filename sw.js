/**
 * Service worker de Nexo (prototipo de un solo archivo).
 *
 * Estrategia deliberadamente conservadora:
 *   · El HTML se sirve con "network first": si hay conexión, siempre ves la
 *     última versión; si no, la copia guardada.
 *   · Los recursos externos (Tailwind, Supabase, tipografía) se guardan con
 *     "stale while revalidate".
 *   · Nada de datos del usuario pasa por acá: tus registros viven en
 *     localStorage y en Supabase, no en la caché del service worker.
 */
const VERSION = 'nexo-v1';
const ESENCIALES = ['./nexo.html', './manifest.webmanifest', './icono.svg'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(ESENCIALES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((claves) => Promise.all(claves.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;

  /* Nunca se cachean las llamadas a la base de datos ni a la autenticación. */
  const url = new URL(req.url);
  if (url.pathname.startsWith('/rest/') || url.pathname.startsWith('/auth/') ||
      url.pathname.startsWith('/functions/')) return;

  if (req.mode === 'navigate' || req.destination === 'document') {
    e.respondWith(
      fetch(req).then((r) => {
        const copia = r.clone();
        caches.open(VERSION).then((c) => c.put(req, copia));
        return r;
      }).catch(() => caches.match(req).then((r) => r || caches.match('./nexo.html')))
    );
    return;
  }

  e.respondWith(
    caches.match(req).then((guardada) => {
      const red = fetch(req).then((r) => {
        if (r && r.status === 200) {
          const copia = r.clone();
          caches.open(VERSION).then((c) => c.put(req, copia));
        }
        return r;
      }).catch(() => guardada);
      return guardada || red;
    })
  );
});
