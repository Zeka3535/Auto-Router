// Service Worker для оффлайн работы.

const CACHE_VERSION = 'v4';
const CACHE_NAME = `router-cache-${CACHE_VERSION}`;

// Список ресурсов для кэширования при установке
const CACHE_RESOURCES = [
    './',
    './index.html',
    './styles.css',
    './app.js',
    './i18n/i18n.js',
    './i18n/ru.json',
    './i18n/en.json',
    './data/router-db.json',
    './site.webmanifest',
    './favicon.svg',
    './favicon.ico',
    './favicon-16x16.png',
    './favicon-32x32.png',
    './apple-touch-icon.png',
    './android-chrome-192x192.png',
    './android-chrome-512x512.png',
    './assets/svg/router.svg',
    './assets/svg/huawei.svg',
    './assets/svg/zte.svg',
    './assets/svg/routericon.svg',
    './assets/svg/routerlogo.svg',
    './assets/svg/YandexInt/Yanintlogo1.svg',
    './assets/svg/YandexInt/Yanintlogo2.svg',
    './assets/svg/YandexInt/Yanintlogo3.svg'
];

// Установка Service Worker и кэширование ресурсов 
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => {
                return cache.addAll(CACHE_RESOURCES).catch((err) => {
                    console.warn('Не удалось закэшировать некоторые ресурсы:', err);
                });
            })
            .then(() => {
                return self.skipWaiting();
            })
    );
});

// Активация Service Worker и очистка старых кэшей
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys()
            .then((cacheNames) => {
                return Promise.all(
                    cacheNames
                        .filter((name) => {
                            return name.startsWith('router-cache-') && name !== CACHE_NAME;
                        })
                        .map((name) => {
                            return caches.delete(name);
                        })
                );
            })
            .then(() => {
                return self.clients.claim();
            })
    );
});

// Обработка запросов с стратегией Stale While Revalidate
self.addEventListener('fetch', (event) => {
    const { request } = event;
    const url = new URL(request.url);

    // Пропускаем запросы к внешним ресурсам
    if (url.origin !== location.origin) {
        return;
    }

    // Пропускаем не-GET запросы
    if (request.method !== 'GET') {
        return;
    }

    event.respondWith(
        caches.open(CACHE_NAME)
            .then((cache) => {
                return cache.match(request)
                    .then((cachedResponse) => {
                        // Пытаемся получить свежую версию из сети
                        const fetchPromise = fetch(request)
                            .then((networkResponse) => {
                                // Обновляем кэш свежим ответом
                                if (networkResponse.ok) {
                                    cache.put(request, networkResponse.clone());
                                }
                                return networkResponse;
                            })
                            .catch(() => {
                                // Если сеть недоступна, возвращаем кэш или ошибку
                                if (cachedResponse) {
                                    return cachedResponse;
                                }
                                return new Response('Оффлайн', { status: 503, statusText: 'Service Unavailable' });
                            });

                        // Возвращаем кэшированный ответ сразу, если он есть
                        if (cachedResponse) {
                            return cachedResponse;
                        }

                        // Если кэша нет, ждем ответа из сети
                        return fetchPromise;
                    });
            })
    );
});

