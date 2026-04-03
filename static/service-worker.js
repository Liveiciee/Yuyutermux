const CACHE = 'yuyutermux-v9';

// Hanya cache halaman HTML & CSS utama
// JS Modules (app.js, dll) biar browser yang handle graph-nya, jangan di-hardcode
const ASSETS = [
    '/',
    '/docs',
    '/static/manifest.json',
    '/static/css/base.css',
    '/static/css/layout.css',
    '/static/css/ui.css',
    '/static/css/animation.css'   // FIX Bug #3: sebelumnya salah ketik 'animations.css'
];

self.addEventListener('install', (e) => {
    e.waitUntil(
        caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting())
    );
});

self.addEventListener('fetch', (e) => {
    const url = e.request.url;

    // 1. LARANGAN MUTLAK: Jangan pernah cache API request
    if (url.includes('/api/')) {
        e.respondWith(fetch(e.request));
        return;
    }

    // 2. LARANGAN KEDUA: Jangan intercept request yang explicit minta no-store (dari docs.html)
    if (url.includes('cache=no-store')) {
        e.respondWith(fetch(e.request));
        return;
    }

    e.respondWith(
        caches.match(e.request).then((cached) => {
            if (cached) return cached;

            return fetch(e.request).then((res) => {
                // Cache dynamic assets (JS modules, fonts CDN) secara runtime
                if (res?.ok && (res.type === 'basic' || res.type === 'cors')) {
                    const clone = res.clone();
                    caches.open(CACHE).then((c) => c.put(e.request, clone));
                }
                return res;
            }).catch(() => {
                // Fallback aman: kalau offline dan gak ada cache, kasih halaman kosong
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
