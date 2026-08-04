// Race Krono — Service Worker mínimo para habilitar PWA (instalação)
// Estratégia network-first: nunca serve HTML velho.
const CACHE = 'racekrono-v1';

self.addEventListener('install', (e) => {
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // Nunca intercepta Firebase / APIs externas
  if (url.origin !== self.location.origin) return;

  event.respondWith((async () => {
    try {
      const fresh = await fetch(req);
      // Cacheia estáticos (imagens/icones) para offline básico
      if (/\.(png|jpg|jpeg|svg|webp|ico|json|css|js)$/i.test(url.pathname)) {
        const cache = await caches.open(CACHE);
        cache.put(req, fresh.clone()).catch(() => {});
      }
      return fresh;
    } catch (_) {
      const cached = await caches.match(req);
      if (cached) return cached;
      // Fallback: se pediu navegação HTML, devolve index em cache
      if (req.mode === 'navigate') {
        const idx = await caches.match('/index.html') || await caches.match('/');
        if (idx) return idx;
      }
      throw _;
    }
  })());
});
