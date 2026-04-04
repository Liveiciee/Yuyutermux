const CACHE = 'yuyutermux-v25';

// Only cache main HTML & CSS
const ASSETS = [
    '/',
    '/docs',
    '/static/manifest.json',
    '/static/css/base.css',
    '/static/css/layout.css',
    '/static/css/ui.css',
    '/static/css/animation.css'
];

// SECURITY: Maximum number of dynamic cache entries to prevent cache flooding
const MAX_CACHE_ENTRIES = 100;

self.addEventListener('install', (e) => {
    e.waitUntil(
        caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting())
    );
});

self.addEventListener('fetch', (e) => {
    const url = e.request.url;

    // 1. NEVER cache API requests
    if (url.includes('/api/')) {
        e.respondWith(fetch(e.request));
        return;
    }

    // 2. Never intercept explicit no-cache requests
    if (url.includes('cache=no-store')) {
        e.respondWith(fetch(e.request));
        return;
    }

    // 3. SECURITY: Block requests to internal/private URLs
    if (url.startsWith('file://') || url.startsWith('data:text/html')) {
        return;
    }

    e.respondWith(
        caches.match(e.request).then((cached) => {
            if (cached) return cached;

            return fetch(e.request).then((res) => {
                // Cache dynamic assets (JS modules, fonts CDN) at runtime
                if (res?.ok && (res.type === 'basic' || res.type === 'cors')) {
                    const clone = res.clone();
                    caches.open(CACHE).then(async (c) => {
                        // SECURITY: Limit cache size to prevent flooding
                        const keys = await c.keys();
                        if (keys.length >= MAX_CACHE_ENTRIES) {
                            // Delete oldest entries
                            await c.delete(keys[0]);
                        }
                        c.put(e.request, clone);
                    });
                }
                return res;
            }).catch(() => {
                // Safe fallback for offline navigation
                if (e.request.mode === 'navigate') {
                    return caches.match('/');
                }
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
});
