/**
 * Service worker de Nexo.
 *
 * Reglas, en orden de importancia:
 *
 *   1. NUNCA se guarda una respuesta de Supabase. Ni datos (`/rest/`), ni
 *      sesión (`/auth/`), ni tiempo real (`/realtime/`), ni Edge Functions
 *      (`/functions/`). Todo eso tiene que viajar siempre por la red: si se
 *      cacheara, verías información vieja o de otra sesión.
 *
 *   2. El HTML se sirve con "red primero". Si hay internet, siempre ves la
 *      última versión publicada. Si no lo hay, la última copia guardada.
 *      Así una versión antigua no queda atrapada en la caché.
 *
 *   3. Los recursos externos (Tailwind, la librería de Supabase, la tipografía)
 *      se sirven con "guardado mientras se revalida": responden al instante y
 *      se actualizan en segundo plano.
 *
 *   4. Al publicar una versión nueva basta con subir el número de VERSION.
 *      El service worker nuevo toma el control de inmediato, borra las cachés
 *      anteriores y la página se recarga sola.
 *
 * Tus registros no pasan por acá: viven en Supabase y, como copia de trabajo,
 * en el almacenamiento del navegador.
 */
const VERSION = 'nexo-v3-sync';
const ESENCIALES = ['./', './index.html', './nexo.html', './manifest.webmanifest', './icono.svg'];

/* Nada que venga de estas rutas se guarda jamás. */
const NUNCA_CACHE = ['/rest/', '/auth/', '/realtime/', '/functions/', '/storage/v1/object/sign'];

function esDeSupabase(url) {
  if (NUNCA_CACHE.some((p) => url.pathname.startsWith(p))) return true;
  /* Cualquier dominio de Supabase, por si cambia la forma de las rutas. */
  return /\.supabase\.(co|in)$/.test(url.hostname);
}

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(VERSION)
      /* `addAll` falla entero si un archivo no existe; se guardan uno a uno. */
      .then((c) => Promise.all(ESENCIALES.map((u) => c.add(u).catch(() => null))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((claves) => Promise.all(claves.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

/* La página puede pedir que una versión recién instalada tome el control ya. */
self.addEventListener('message', (e) => {
  if (e.data && (e.data.type === 'ACTIVAR_YA' || e.data.type === 'SKIP_WAITING')) self.skipWaiting();
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;

  let url;
  try { url = new URL(req.url); } catch (err) { return; }

  /* Regla 1: Supabase siempre por la red, sin tocar la caché. */
  if (esDeSupabase(url)) return;

  /* Los WebSocket de tiempo real no pasan por `fetch`, pero por si acaso. */
  if (req.headers.get('upgrade') === 'websocket') return;

  /* Regla 2: el documento, red primero. */
  if (req.mode === 'navigate' || req.destination === 'document') {
    e.respondWith(
      fetch(req)
        .then((r) => {
          if (r && r.ok) {
            const copia = r.clone();
            caches.open(VERSION).then((c) => c.put(req, copia)).catch(() => {});
          }
          return r;
        })
        .catch(() => caches.match(req)
          .then((r) => r || caches.match('./index.html'))
          .then((r) => r || caches.match('./nexo.html'))
          .then((r) => r || new Response(
            '<!doctype html><meta charset="utf-8"><title>Nexo sin conexión</title>' +
            '<p style="font:16px system-ui;padding:2rem">Nexo no pudo cargar y no hay una copia guardada. ' +
            'Vuelve a intentarlo cuando tengas conexión.</p>',
            { headers: { 'Content-Type': 'text/html; charset=utf-8' }, status: 503 }
          ))
        )
    );
    return;
  }

  /* Regla 3: el resto, guardado mientras se revalida. */
  e.respondWith(
    caches.match(req).then((guardada) => {
      const red = fetch(req)
        .then((r) => {
          if (r && r.status === 200 && (r.type === 'basic' || r.type === 'cors')) {
            const copia = r.clone();
            caches.open(VERSION).then((c) => c.put(req, copia)).catch(() => {});
          }
          return r;
        })
        .catch(() => guardada);
      return guardada || red;
    })
  );
});
