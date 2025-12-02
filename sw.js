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

// Нормализация пути для поиска в кэше
function normalizePath(pathname) {
    // Убираем начальный и конечный слэш
    let normalized = pathname.replace(/^\/+|\/+$/g, '');
    
    // Корневой путь или пустой путь маппим на index.html
    if (!normalized || normalized === '' || normalized === 'index.html') {
        return './index.html';
    }
    
    // Добавляем './' если его нет
    if (!normalized.startsWith('./')) {
        normalized = './' + normalized;
    }
    
    return normalized;
}

// Проверка, является ли ресурс критическим
function isCriticalResource(pathname) {
    const normalized = normalizePath(pathname);
    const pathVariants = [
        normalized,
        normalized.replace('./', '/'),
        normalized.replace('./', ''),
        pathname,
        pathname.replace(/^\/+/, './'),
        pathname.replace(/^\/+/, '')
    ];
    
    return CRITICAL_RESOURCES.some(resource => {
        const resourceVariants = [
            resource,
            resource.replace('./', '/'),
            resource.replace('./', '')
        ];
        return pathVariants.some(pv => resourceVariants.includes(pv));
    });
}

// Поиск ресурса в кэше с учетом различных вариантов путей
async function findInCache(cache, request, pathname) {
    // Сначала пробуем точное совпадение
    let response = await cache.match(request);
    if (response) return response;
    
    // Пробуем нормализованный путь
    const normalized = normalizePath(pathname);
    const normalizedRequest = new Request(normalized, { method: 'GET' });
    response = await cache.match(normalizedRequest);
    if (response) return response;
    
    // Для корневого пути пробуем найти index.html
    if (pathname === '/' || pathname === '' || pathname.endsWith('/')) {
        const indexRequest = new Request('./index.html', { method: 'GET' });
        response = await cache.match(indexRequest);
        if (response) return response;
    }
    
    // Пробуем все варианты критических ресурсов
    if (isCriticalResource(pathname)) {
        for (const resource of CRITICAL_RESOURCES) {
            const altRequest = new Request(resource, { method: 'GET' });
            response = await cache.match(altRequest);
            if (response) return response;
        }
    }
    
    return null;
}

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
    const isCritical = isCriticalResource(requestPath);

    event.respondWith(
        caches.open(CACHE_NAME)
            .then(async (cache) => {
                // Ищем в кэше с учетом различных вариантов путей
                const cachedResponse = await findInCache(cache, request, requestPath);
                
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
                try {
                    const networkResponse = await fetch(request);
                    // Обновляем кэш свежим ответом
                    if (networkResponse.ok) {
                        cache.put(request, networkResponse.clone());
                    }
                    return networkResponse;
                } catch (error) {
                    // Если сеть недоступна, возвращаем кэш
                    if (cachedResponse) {
                        return cachedResponse;
                    }
                    // Для критических ресурсов пробуем найти любой подходящий кэш
                    if (isCritical) {
                        const fallbackResponse = await findInCache(cache, request, requestPath);
                        if (fallbackResponse) {
                            return fallbackResponse;
                        }
                    }
                    // Fallback для некритических ресурсов
                    return new Response('Оффлайн', { 
                        status: 503, 
                        statusText: 'Service Unavailable',
                        headers: { 'Content-Type': 'text/plain; charset=utf-8' }
                    });
                }
            })
    );
});

