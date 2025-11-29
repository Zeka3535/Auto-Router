// Service Worker для оффлайн работы.

const CACHE_VERSION = 'v5';
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

// Критические ресурсы - Cache First стратегия
const CRITICAL_RESOURCES = [
    './',
    './index.html',
    './styles.css',
    './app.js',
    './i18n/i18n.js'
];

// Обработка запросов с улучшенной стратегией кэширования
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

    const requestPath = url.pathname;
    const isCritical = CRITICAL_RESOURCES.some(resource => 
        requestPath === resource || requestPath === resource.replace('./', '/')
    );

    event.respondWith(
        caches.open(CACHE_NAME)
            .then((cache) => {
                return cache.match(request)
                    .then((cachedResponse) => {
                        // Для критических ресурсов - Cache First
                        if (isCritical && cachedResponse) {
                            // Обновляем кэш в фоне, если есть сеть
                            fetch(request)
                                .then((networkResponse) => {
                                    if (networkResponse.ok) {
                                        cache.put(request, networkResponse.clone());
                                    }
                                })
                                .catch(() => {
                                    // Сеть недоступна, используем кэш
                                });
                            return cachedResponse;
                        }

                        // Для остальных - Network First с fallback на кэш
                        return fetch(request)
                            .then((networkResponse) => {
                                // Обновляем кэш свежим ответом
                                if (networkResponse.ok) {
                                    cache.put(request, networkResponse.clone());
                                }
                                return networkResponse;
                            })
                            .catch(() => {
                                // Если сеть недоступна, возвращаем кэш
                                if (cachedResponse) {
                                    return cachedResponse;
                                }
                                // Для критических ресурсов возвращаем кэш даже если он старый
                                if (isCritical) {
                                    return cache.match(request, { ignoreSearch: true });
                                }
                                // Fallback для некритических ресурсов
                                return new Response('Оффлайн', { 
                                    status: 503, 
                                    statusText: 'Service Unavailable',
                                    headers: { 'Content-Type': 'text/plain; charset=utf-8' }
                                });
                            });
                    });
            })
    );
});

