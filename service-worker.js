const CACHE_NAME = 'robos-v6';
const SHELL = [
  '/',
  '/index.html',
  '/style.css',
  '/config.js',
  '/saved-data.js',
  '/store.js',
  '/event-bus.js',
  '/utils.js',
  '/ws-source.js',
  '/robot.js',
  '/robot-engine.js',
  '/ia-inteligente.js',
  '/filters.js',
  '/telegram.js',
  '/app.js',
  '/monitoramento.html',
  '/monitoramento.css',
  '/robos.html',
  '/robo.html',
  '/horarios.html',
  '/analise.html',
  '/analise-config.html',
  '/analise-engine.js',
  '/analise-telegram.js',
  '/ia-inteligente.html',
  '/configuracoes.html',
  '/estatisticas.html',
  '/logs.html',
  '/historico-wheel.html',
  '/historico-double.html',
  '/mensagens.html',
  '/help.html',
  '/news.html',
  '/news.js',
  '/chart.js',
  '/ws-background.html',
  '/ws-worker.js',
  '/scheduler.js',
  '/manifest.json',
  '/icon-192.svg',
  '/icon-512.svg'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);

  if (e.request.method !== 'GET') return;

  if (url.pathname.startsWith('/ws/')) return;

  if (url.hostname === 'api.inout.games') return;

  e.respondWith(
    caches.match(e.request).then((cached) => {
      const fetching = fetch(e.request).then((response) => {
        if (response && response.status === 200) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(e.request, clone));
        }
        return response;
      }).catch(() => cached);

      return cached || fetching;
    })
  );
});
