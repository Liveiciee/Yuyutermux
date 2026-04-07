const CACHE = 'yuyutermux-v27'; // naikin versi
const MAX_CACHE_ENTRIES = 200;

// Asset prioritization
const STATIC_ASSETS = [
    '/',
    '/docs',
    '/static/manifest.json',
    '/static/css/base.css',
    '/static/css/layout.css',
    '/static/css/ui.css',
    '/static/css/animation.css'
];

// Extensions yang penting (prioritas)
const IMPORTANT_EXT = ['.css', '.js', '.json', '.html', '.wasm'];

self.addEventListener('install', (e) => {
    e.waitUntil(
        caches.open(CACHE).then((c) => c.addAll(STATIC_ASSETS)).then(() => self.skipWaiting())
    );
});

function isImportant(url) {
    return IMPORTANT_EXT.some(ext => url.pathname.endsWith(ext));
}

async function smartCachePut(cache, request, response) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) return;
    
    const isStatic = isImportant(url);
    const keys = await cache.keys();
    
    if (keys.length >= MAX_CACHE_ENTRIES && !isStatic) {
        const toDelete = keys.slice(0, 10);
        await Promise.all(toDelete.map(k => cache.delete(k)));
    }
    
    const headers = new Headers(response.headers);
    headers.set('X-Cache-Time', Date.now().toString());
    const newRes = new Response(response.body, { status: response.status, headers });
    await cache.put(request, newRes);
}

self.addEventListener('fetch', (e) => {
    const url = new URL(e.request.url);
    
    if (url.pathname.startsWith('/api/')) {
        e.respondWith(fetch(e.request));
        return;
    }
    
    if (url.search.includes('cache=no-store')) {
        e.respondWith(fetch(e.request));
        return;
    }
    
    if (url.protocol === 'file:' || url.protocol === 'data:') return;
    
    if (isImportant(url)) {
        e.respondWith(
            caches.match(e.request).then((cached) => {
                const fetchPromise = fetch(e.request).then((networkRes) => {
                    if (networkRes && networkRes.ok) {
                        caches.open(CACHE).then(cache => smartCachePut(cache, e.request, networkRes));
                    }
                    return networkRes.clone();
                }).catch(() => null);
                
                if (cached) {
                    fetchPromise.catch(() => {});
                    return cached;
                }
                return fetchPromise;
            })
        );
        return;
    }
    
    e.respondWith(
        caches.match(e.request).then((cached) => {
            if (cached) return cached;
            return fetch(e.request).then((res) => {
                if (res && res.ok) {
                    caches.open(CACHE).then(cache => smartCachePut(cache, e.request, res));
                }
                return res.clone();
            }).catch(() => {
                if (e.request.mode === 'navigate') {
                    return caches.match('/');
                }
                return new Response('Offline - Yuyutermux tidak dapat menjangkau server', { status: 503 });
            });
        })
    );
});

self.addEventListener('activate', (e) => {
    e.waitUntil(
        caches.keys().then((keys) => Promise.all(
            keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))
        )).then(() => self.clients.claim())
    );
);
