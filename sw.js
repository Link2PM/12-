const CACHE_NAME = 'healthy-v7';
const ASSETS = ['./', './index.html', './plan.js?v=1.2.1'];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Network-first: 仅缓存页面导航与明确列出的静态资源。
// `/api/*` 和任何带 Authorization 的请求必须绕过 Service Worker，
// 避免把私人训练快照写入 Cache Storage 或离线返回过期云端数据。
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return;
  if (url.pathname === '/api' || url.pathname.startsWith('/api/')) return;
  if (e.request.headers.has('Authorization')) return;

  const isNavigation = e.request.mode === 'navigate';
  const isStaticAsset = url.pathname === '/' ||
    url.pathname === '/index.html' ||
    url.pathname === '/plan.js';
  if (!isNavigation && !isStaticAsset) return;

  e.respondWith(
    fetch(e.request)
      .then(res => {
        if (res.ok && res.type === 'basic') {
          const clone = res.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(e.request, clone));
        }
        return res;
      })
      .catch(async () => {
        const cached = await caches.match(e.request);
        if (cached) return cached;
        if (isNavigation) return (await caches.match('./index.html')) || Response.error();
        return Response.error();
      })
  );
});
