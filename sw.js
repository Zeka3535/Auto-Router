// Service Worker для оффлайн работы.

const CACHE_VERSION = 'v7';
const CACHE_NAME = `router-cache-${CACHE_VERSION}`;
const BASE_URL = new URL('.', self.location.href);

// Пути приложения относительно корня (без ./)
const PRECACHE_PATHS = [
    'index.html',
    'styles.css',
    'app.js',
    'sw.js',
    'i18n/i18n.js',
    'i18n/ru.json',
    'i18n/en.json',
    'data/router-db.json',
    'site.webmanifest',
    'favicon.svg',
    'favicon.ico',
    'favicon-16x16.png',
    'favicon-32x32.png',
    'apple-touch-icon.png',
    'android-chrome-192x192.png',
    'android-chrome-512x512.png',
    'ogimage.png',
    'ogimage-mobile.png',
    'assets/svg/router.svg',
    'assets/svg/huawei.svg',
    'assets/svg/zte.svg',
    'assets/svg/routericon.svg',
    'assets/svg/routerlogo.svg',
    'assets/svg/YandexInt/Yanintlogo1.svg',
    'assets/svg/YandexInt/Yanintlogo2.svg',
    'assets/svg/YandexInt/Yanintlogo3.svg'
];

function resolveUrl(path) {
    return new URL(path, BASE_URL).href;
}

const INDEX_URL = resolveUrl('index.html');
const PRECACHE_URLS = [BASE_URL.href, INDEX_URL, ...PRECACHE_PATHS.map(resolveUrl)];

// Установка: прекэш оболочки приложения
self.addEventListener('install', (event) => {
    event.waitUntil(
        (async () => {
            const cache = await caches.open(CACHE_NAME);
            await Promise.allSettled(
                PRECACHE_URLS.map(async (url) => {
                    const response = await fetch(url);
                    if (response.ok) {
                        await cache.put(url, response);
                    }
                })
            );
            await self.skipWaiting();
        })()
    );
});

// Активация: удаление устаревших кэшей
self.addEventListener('activate', (event) => {
    event.waitUntil(
        (async () => {
            const names = await caches.keys();
            await Promise.all(
                names
                    .filter((name) => name.startsWith('router-cache-') && name !== CACHE_NAME)
                    .map((name) => caches.delete(name))
            );
            await self.clients.claim();
        })()
    );
});

self.addEventListener('message', (event) => {
    if (event.data?.type === 'SKIP_WAITING') {
        self.skipWaiting();
    }
});

function pathnameKey(pathname) {
    const trimmed = pathname.replace(/^\/+/, '');
    return trimmed || 'index.html';
}

// Кандидаты URL для поиска в кэше
function cacheLookupUrls(request) {
    const url = new URL(request.url);
    const urls = new Set([request.url, url.href]);

    const key = pathnameKey(url.pathname);
    urls.add(resolveUrl(key));

    if (request.mode === 'navigate' || url.pathname === '/' || url.pathname.endsWith('/')) {
        urls.add(BASE_URL.href);
        urls.add(INDEX_URL);
    }

    return [...urls];
}

async function matchInCache(cache, request) {
    const direct = await cache.match(request, { ignoreSearch: true });
    if (direct) {
        return direct;
    }

    for (const url of cacheLookupUrls(request)) {
        const hit = await cache.match(url, { ignoreSearch: true });
        if (hit) {
            return hit;
        }
    }

    return null;
}

async function putInCache(cache, request, response) {
    if (!response || !response.ok) {
        return;
    }
    const url = new URL(request.url);
    await cache.put(request.url, response.clone());
    await cache.put(resolveUrl(pathnameKey(url.pathname)), response.clone());
}

// Фоновое обновление кэша при наличии сети
function revalidateInBackground(cache, request) {
    fetch(request)
        .then((response) => putInCache(cache, request, response))
        .catch(() => {});
}

async function respondCacheFirst(request, { allowRevalidate = true } = {}) {
    const cache = await caches.open(CACHE_NAME);
    const cached = await matchInCache(cache, request);

    if (cached) {
        if (allowRevalidate && request.cache !== 'no-store') {
            revalidateInBackground(cache, request);
        }
        return cached;
    }

    try {
        const response = await fetch(request);
        await putInCache(cache, request, response);
        return response;
    } catch {
        const fallback = await matchInCache(cache, request);
        if (fallback) {
            return fallback;
        }
        if (request.mode === 'navigate') {
            const shell = await cache.match(INDEX_URL, { ignoreSearch: true });
            if (shell) {
                return shell;
            }
        }
        return new Response('Оффлайн', {
            status: 503,
            statusText: 'Service Unavailable',
            headers: { 'Content-Type': 'text/plain; charset=utf-8' }
        });
    }
}

async function respondNavigate(request) {
    const cache = await caches.open(CACHE_NAME);
    const cached = await matchInCache(cache, request);

    if (cached) {
        revalidateInBackground(cache, request);
        return cached;
    }

    try {
        const response = await fetch(request);
        await putInCache(cache, request, response);
        return response;
    } catch {
        const shell =
            (await cache.match(INDEX_URL, { ignoreSearch: true })) ||
            (await cache.match(BASE_URL.href, { ignoreSearch: true }));
        if (shell) {
            return shell;
        }
        return new Response('Оффлайн', {
            status: 503,
            statusText: 'Service Unavailable',
            headers: { 'Content-Type': 'text/html; charset=utf-8' }
        });
    }
}

async function respondNetworkOnly(request) {
    try {
        return await fetch(request);
    } catch {
        if (request.mode === 'navigate') {
            const cache = await caches.open(CACHE_NAME);
            const shell =
                (await cache.match(INDEX_URL, { ignoreSearch: true })) ||
                (await cache.match(BASE_URL.href, { ignoreSearch: true }));
            if (shell) {
                return shell;
            }
        }
        return new Response('Оффлайн', {
            status: 503,
            statusText: 'Service Unavailable',
            headers: { 'Content-Type': 'text/plain; charset=utf-8' }
        });
    }
}

self.addEventListener('fetch', (event) => {
    const { request } = event;

    if (request.method !== 'GET') {
        return;
    }

    const url = new URL(request.url);
    if (url.origin !== self.location.origin) {
        return;
    }

    // Проверки доступности сети не подменяем кэшем
    if (request.cache === 'no-store') {
        event.respondWith(respondNetworkOnly(request));
        return;
    }

    if (request.mode === 'navigate') {
        event.respondWith(respondNavigate(request));
        return;
    }

    event.respondWith(respondCacheFirst(request));
});
