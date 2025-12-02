// Основная логика приложения. Комментарии — на русском.

(() => {
    const THEME_STORAGE_KEY = 'theme:v1';
    const MINE_STORAGE_KEY = 'userCreds:v1';
    const CUSTOM_ORDER_BASE = 10;
    const CUSTOM_THUMBNAIL = './assets/svg/router.svg';

    // Тема: автодетект + ручной переключатель
    function detectTheme() {
        try {
            const saved = localStorage.getItem(THEME_STORAGE_KEY);
            if (saved === 'light' || saved === 'dark') return saved;
        } catch {}
        const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
        return prefersDark ? 'dark' : 'light';
    }

    function applyTheme(theme) {
        document.documentElement.setAttribute('data-theme', theme);
        try { localStorage.setItem(THEME_STORAGE_KEY, theme); } catch {}
    }

    function initTheme() {
        applyTheme(detectTheme());
        const btn = document.getElementById('theme-toggle');
        if (btn) {
            btn.addEventListener('click', () => {
                const next = (document.documentElement.getAttribute('data-theme') === 'dark') ? 'light' : 'dark';
                applyTheme(next);
            });
        }
    }

    // Копирование в буфер
    async function copy(text) {
        // Сначала пробуем современный API (требует HTTPS/gesture)
        try {
            if (navigator.clipboard && window.isSecureContext) {
                await navigator.clipboard.writeText(text);
                return true;
            }
        } catch {}
        // Фолбэк для мобильных браузеров (iOS Safari и др.)
        try {
            const ta = document.createElement('textarea');
            ta.value = text || '';
            ta.setAttribute('readonly', '');
            ta.style.position = 'fixed';
            ta.style.top = '-1000px';
            ta.style.opacity = '0';
            document.body.appendChild(ta);
            ta.focus();
            ta.select();
            const ok = document.execCommand('copy');
            document.body.removeChild(ta);
            return ok;
        } catch {
            return false;
        }
    }

    const BRAND_IP = {
        huawei: 'http://192.168.100.1',
        zte: 'http://192.168.1.1'
    };
    const BRAND_GROUPS = [
        { id: 'huawei', titleKey: 'brand.huawei', fallback: 'Huawei' },
        { id: 'zte', titleKey: 'brand.zte', fallback: 'ZTE' }
    ];

    const DEFAULT_ORDER = 999;
    const CARD_REGISTRY = new Map();
    let cardIdCounter = 0;
    let activeCardId = null;
    let routerDbSnapshot = { defaultsCommon: [], models: [] };
    let credFieldIdCounter = 0;
    const CUSTOM_GROUP_PREFIX = 'custom:';

    // Toast-уведомления
    function showToast(message, type = 'success') {
        const container = document.getElementById('toast-container');
        if (!container) return;

        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        toast.setAttribute('role', 'alert');

        const icon = document.createElement('svg');
        icon.className = 'toast-icon';
        icon.setAttribute('viewBox', '0 0 24 24');
        icon.setAttribute('aria-hidden', 'true');
        if (type === 'success') {
            icon.innerHTML = '<path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" fill="currentColor"/>';
        } else {
            icon.innerHTML = '<path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" fill="currentColor"/>';
        }

        const messageEl = document.createElement('div');
        messageEl.className = 'toast-message';
        messageEl.textContent = message;

        toast.append(icon, messageEl);
        container.append(toast);

        setTimeout(() => {
            toast.classList.add('fade-out');
            setTimeout(() => toast.remove(), 200);
        }, 3000);
    }

    async function copyCombo(pair) {
        if (!pair) return;
        try {
            await copy(pair.password || '');
            showToast(getText('toast.copied_password', 'Пароль скопирован'));
            setTimeout(async () => {
                const success = await copy(pair.login || '');
                if (success) {
                    showToast(getText('toast.copied_login', 'Логин скопирован'));
                } else {
                    showToast(getText('toast.error', 'Ошибка при копировании'), 'error');
                }
            }, 250);
        } catch {
            showToast(getText('toast.error', 'Ошибка при копировании'), 'error');
        }
    }

    function createCopyIconButton(onClick) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'icon-btn cred-copy-btn';
        btn.setAttribute('data-i18n-title', 'action.copy_combo');
        btn.setAttribute('title', getText('action.copy_combo', 'Скопировать'));
        btn.innerHTML = `
            <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M8 3h9a3 3 0 0 1 3 3v10h-2V6a1 1 0 0 0-1-1H8V3zm-2 4h9a3 3 0 0 1 3 3v8a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V10a3 3 0 0 1 3-3zm0 2a1 1 0 0 0-1 1v8c0 .55.45 1 1 1h9a1 1 0 0 0 1-1v-8a1 1 0 0 0-1-1H6z"/>
            </svg>
            <span class="visually-hidden" data-i18n="action.copy_combo">Скопировать</span>
        `;
        btn.addEventListener('click', (event) => {
            event.stopPropagation();
            onClick?.(event);
        });
        return btn;
    }

    function getText(key, fallback = '') {
        try {
            const dict = window.__I18N__?.getDict?.();
            if (dict && typeof dict[key] === 'string') return dict[key];
        } catch {}
        return fallback;
    }

    function slugifyGroup(value) {
        if (!value) return '';
        return value
            .toLowerCase()
            .trim()
            .replace(/\s+/g, '-')
            .replace(/-+/g, '-');
    }

    function buildGroupDefinitions(models) {
        const defs = [];
        const seen = new Set();
        BRAND_GROUPS.forEach(group => {
            defs.push({ ...group });
            seen.add(group.id);
        });
        models.forEach(model => {
            const groupId = resolveGroup(model);
            if (!groupId || seen.has(groupId)) return;
            const title = (model.groupLabel || '').trim() || model.brand || groupId;
            defs.push({ id: groupId, title });
            seen.add(groupId);
        });
        return defs;
    }

    // Работа с базой моделей
    async function loadRouterDb() {
        try {
            const res = await fetch('./data/router-db.json');
            if (!res.ok) throw new Error('router-db-failed');
            return await res.json();
        } catch {
            return { defaultsCommon: [], models: [] };
        }
    }

    function getMergedDb() {
        return {
            defaultsCommon: Array.isArray(routerDbSnapshot.defaultsCommon) ? routerDbSnapshot.defaultsCommon : [],
            models: [
                ...(Array.isArray(routerDbSnapshot.models) ? routerDbSnapshot.models : []),
                ...readMine()
            ]
        };
    }

    function refreshRouterCards() {
        renderBrandGroups(getMergedDb());
    }

    function renderBrandGroups(db) {
        const container = document.getElementById('router-groups');
        if (!container) return;
        const models = Array.isArray(db.models) ? db.models : [];
        const fallback = Array.isArray(db.defaultsCommon) ? db.defaultsCommon : [];
        container.innerHTML = '';
        CARD_REGISTRY.clear();
        activeCardId = null;

        const groupDefs = buildGroupDefinitions(models);
        groupDefs.forEach(group => {
            const items = models.filter(model => matchesGroup(model, group.id));
            if (!items.length) return;
            container.append(createBrandRow(group, items, fallback));
        });

        if (!container.children.length) {
            const empty = document.createElement('p');
            empty.className = 'muted';
            empty.setAttribute('data-i18n', 'defaults.empty');
            empty.textContent = 'Пока нет сохранённых моделей.';
            container.append(empty);
        }
        window.__I18N__?.apply?.();
        autoSelectFirst();
    }

    function matchesGroup(model, groupId) {
        if (Array.isArray(model.group)) return model.group.includes(groupId);
        if (typeof model.group === 'string') return model.group === groupId;
        return resolveGroup(model) === groupId;
    }

    function resolveGroup(model) {
        if (Array.isArray(model.group)) {
            const match = model.group.find(item => typeof item === 'string' && item.trim());
            if (match) return match.trim();
        }
        if (typeof model.group === 'string' && model.group.trim()) return model.group.trim();
        const brand = (model.brand || '').toLowerCase();
        if (brand.includes('huawei')) return 'huawei';
        if (brand.includes('zte') || brand.includes('ts')) return 'zte';
        return 'zte';
    }

    function isHuawei(model) {
        return (model.brand || '').toLowerCase().includes('huawei');
    }

    function getOrder(model) {
        return typeof model.order === 'number' ? model.order : DEFAULT_ORDER;
    }

    function sortModels(a, b) {
        const orderDiff = getOrder(a) - getOrder(b);
        if (orderDiff !== 0) return orderDiff;
        return (a.model || '').localeCompare(b.model || '');
    }

    function createBrandRow(group, items, fallback) {
        const section = document.createElement('section');
        section.className = 'brand-row';

        const header = document.createElement('div');
        header.className = 'brand-row-header';

        const title = document.createElement('div');
        title.className = 'brand-row-title';
        if (group.titleKey) {
            title.setAttribute('data-i18n', group.titleKey);
            title.textContent = getText(group.titleKey, group.fallback || group.id.toUpperCase());
        } else {
            title.textContent = group.title || group.fallback || group.id;
        }
        header.append(title);

        const track = document.createElement('div');
        track.className = 'brand-row-track';
        track.setAttribute('data-group', group.id);

        const sortedItems = [...items].sort(sortModels);
        sortedItems.forEach(model => {
            track.append(createRouterCard(model, fallback));
        });

        section.append(header, track);
        return section;
    }

    function createRouterCard(model, fallback) {
        const card = document.createElement('article');
        card.className = 'router-card';
        card.setAttribute('role', 'button');
        card.setAttribute('tabindex', '0');
        card.setAttribute('aria-label', `${model.brand || ''} ${model.model || ''}`.trim() || 'Роутер');
        const header = document.createElement('div');
        header.className = 'router-header';

        const imgWrap = document.createElement('div');
        imgWrap.className = 'router-thumb-wrap';
        if (isHuawei(model)) {
            imgWrap.innerHTML = `
                <svg class="brand-icon brand-icon-huawei" viewBox="0 0 32 32" aria-hidden="true">
                    <path d="M4.896 8.188c0 0-2.469 2.359-2.604 4.854v0.464c0.109 2.016 1.63 3.203 1.63 3.203 2.438 2.385 8.344 5.385 9.729 6.063 0 0 0.083 0.042 0.135-0.010l0.026-0.052v-0.057c-3.786-8.25-8.917-14.464-8.917-14.464zM12.865 24.802c-0.026-0.109-0.13-0.109-0.13-0.109l-9.839 0.349c1.063 1.906 2.865 3.37 4.745 2.932 1.281-0.333 4.214-2.375 5.172-3.068 0.083-0.068 0.052-0.12 0.052-0.12zM12.974 23.76c-4.323-2.922-12.693-7.385-12.693-7.385-0.203 0.609-0.266 1.198-0.281 1.729v0.094c0 1.427 0.531 2.427 0.531 2.427 1.068 2.255 3.12 2.938 3.12 2.938 0.938 0.396 1.87 0.411 1.87 0.411 0.161 0.026 5.865 0 7.385 0 0.068 0 0.109-0.068 0.109-0.068v-0.078c0-0.042-0.042-0.068-0.042-0.068zM12.078 4.255c-1.938 0.495-3.328 2.198-3.427 4.198v0.547c0.042 0.802 0.214 1.401 0.214 1.401 0.88 3.865 5.151 10.198 6.068 11.531 0.068 0.068 0.135 0.042 0.135 0.042 0.052-0.021 0.083-0.078 0.078-0.135 1.417-14.13-1.479-17.891-1.479-17.891-0.427 0.026-1.589 0.307-1.589 0.307zM23.146 7.281c0 0-0.651-2.401-3.25-3.042 0 0-0.76-0.188-1.563-0.292 0 0-2.906 3.745-1.495 17.906 0.016 0.094 0.083 0.104 0.083 0.104 0.094 0.042 0.13-0.036 0.13-0.036 0.964-1.375 5.203-7.682 6.068-11.521 0 0 0.479-1.87 0.026-3.12zM19.255 24.708c0 0-0.094 0-0.12 0.063 0 0-0.016 0.094 0.036 0.135 0.932 0.682 3.802 2.667 5.177 3.068 0 0 0.214 0.068 0.573 0.078h0.182c0.922-0.026 2.536-0.49 4-3.010l-9.865-0.333zM29.693 13.495c0.188-2.75-2.589-5.297-2.589-5.307 0 0-5.13 6.214-8.891 14.401 0 0-0.042 0.104 0.026 0.172l0.052 0.010h0.083c1.411-0.703 7.276-3.693 9.703-6.052 0 0 1.536-1.24 1.615-3.224zM31.719 16.349c0 0-8.37 4.49-12.693 7.396 0 0-0.068 0.057-0.042 0.151 0 0 0.042 0.078 0.094 0.078 1.547 0 7.417 0 7.563-0.026 0 0 0.76-0.026 1.693-0.385 0 0 2.078-0.667 3.161-3.031 0 0 0.974-1.932 0.224-4.182z"/>
                </svg>`;
        } else {
            const img = document.createElement('img');
            img.className = 'router-thumb';
            img.loading = 'lazy';
            img.alt = `${model.brand || ''} ${model.model || ''}`.trim();
            img.src = model.thumbnail || './assets/svg/router.svg';
            imgWrap.append(img);
        }

        const meta = document.createElement('div');
        meta.className = 'router-meta';
        const brand = document.createElement('div');
        brand.className = 'router-brand';
        brand.textContent = model.brand || '—';
        const name = document.createElement('div');
        name.className = 'router-model';
        name.textContent = model.model || '';
        meta.append(brand, name);

        header.append(imgWrap, meta);

        const defaults = Array.isArray(model.defaults) && model.defaults.length ? model.defaults : fallback;
        card.append(header);
        const cardId = `card-${cardIdCounter++}`;
        card.dataset.cardId = cardId;
        CARD_REGISTRY.set(cardId, { model, defaults });
        
        let touchStartX = 0;
        let touchStartY = 0;
        let touchMoved = false;
        let touchStartTime = 0;
        
        card.addEventListener('touchstart', (e) => {
            touchStartX = e.touches[0].clientX;
            touchStartY = e.touches[0].clientY;
            touchStartTime = Date.now();
            touchMoved = false;
        }, { passive: true });
        
        card.addEventListener('touchmove', (e) => {
            if (!touchStartX || !touchStartY) return;
            const touchCurrentX = e.touches[0].clientX;
            const touchCurrentY = e.touches[0].clientY;
            const deltaX = Math.abs(touchCurrentX - touchStartX);
            const deltaY = Math.abs(touchCurrentY - touchStartY);
            if (deltaX > 10 || deltaY > 10) {
                touchMoved = true;
            }
        }, { passive: true });
        
        card.addEventListener('touchend', (e) => {
            const touchDuration = Date.now() - touchStartTime;
            if (!touchMoved && touchDuration < 300) {
                e.preventDefault();
                selectCard(cardId);
            }
            touchStartX = 0;
            touchStartY = 0;
            touchMoved = false;
            touchStartTime = 0;
        }, { passive: false });
        
        card.addEventListener('click', (e) => {
            if (!touchMoved) {
                selectCard(cardId);
            }
        });
        card.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                selectCard(cardId);
            }
        });
        return card;
    }

    function initDefaults(db) {
        routerDbSnapshot = {
            defaultsCommon: Array.isArray(db?.defaultsCommon) ? db.defaultsCommon : [],
            models: Array.isArray(db?.models) ? db.models : []
        };
        refreshRouterCards();
    }

    function autoSelectFirst() {
        const firstCard = document.querySelector('.router-card');
        if (firstCard) {
            selectCard(firstCard.dataset.cardId);
        } else {
            setSelected(null, []);
        }
    }

    function selectCard(cardId) {
        if (!cardId || !CARD_REGISTRY.has(cardId)) return;
        if (activeCardId !== cardId) {
            if (activeCardId) {
                const prev = document.querySelector(`[data-card-id="${activeCardId}"]`);
                prev?.classList.remove('active');
            }
            const nextEl = document.querySelector(`[data-card-id="${cardId}"]`);
            nextEl?.classList.add('active');
            activeCardId = cardId;
        }
        const data = CARD_REGISTRY.get(cardId);
        if (data) setSelected(data.model, data.defaults);
    }

    function setSelected(model, defaults) {
        const nameEl = document.getElementById('selected-name');
        const ipEl = document.getElementById('selected-ip');
        const openBtn = document.getElementById('selected-open');
        const credsWrap = document.getElementById('selected-creds');
        const placeholder = document.getElementById('selected-placeholder');
        const pingStatus = document.getElementById('ping-status');
        if (!nameEl || !ipEl || !openBtn || !credsWrap || !placeholder || !pingStatus) return;

        if (!model) {
            nameEl.textContent = '—';
            ipEl.textContent = '—';
            openBtn.href = '#';
            openBtn.setAttribute('aria-disabled', 'true');
            credsWrap.innerHTML = '';
            placeholder.hidden = false;
            pingStatus.hidden = true;
            return;
        }

        const title = [model.brand, model.model].filter(Boolean).join(' ') || '—';
        nameEl.textContent = title;

        const ip = deriveIp(model) || '';
        ipEl.textContent = ip ? ip.replace(/^https?:\/\//, '') : '—';
        if (ip) {
            openBtn.href = ip;
            openBtn.removeAttribute('aria-disabled');
            pingStatus.hidden = false;
            resetPingStatus();
        } else {
            openBtn.href = '#';
            openBtn.setAttribute('aria-disabled', 'true');
            pingStatus.hidden = true;
        }

        renderSelectedCreds(credsWrap, defaults);
        placeholder.hidden = !!(defaults && defaults.length);
    }

    function deriveIp(model) {
        if (model?.ip) return model.ip;
        const group = resolveGroup(model);
        return BRAND_IP[group] || '';
    }

    // Функция пинга роутера через HTTP
    let pingTimeout = null;
    let currentPingUrl = null;
    let currentPingImage = null;

    function resetPingStatus() {
        const pingBtn = document.getElementById('ping-btn');
        const pingText = document.getElementById('ping-text');
        if (!pingBtn || !pingText) return;
        
        pingBtn.classList.remove('pinging', 'success', 'error');
        pingText.textContent = getText('ping.check', 'Проверить');
        pingBtn.disabled = false;
        currentPingUrl = null;
        
        if (pingTimeout) {
            clearTimeout(pingTimeout);
            pingTimeout = null;
        }
        
        if (currentPingImage) {
            currentPingImage.onload = null;
            currentPingImage.onerror = null;
            currentPingImage.src = '';
            currentPingImage = null;
        }
    }

    async function pingRouter(url) {
        if (!url) return null;
        
        const pingBtn = document.getElementById('ping-btn');
        const pingText = document.getElementById('ping-text');
        if (!pingBtn || !pingText) return null;

        pingBtn.disabled = true;
        pingBtn.classList.add('pinging');
        pingBtn.classList.remove('success', 'error');
        pingText.textContent = getText('ping.checking', 'Проверка...');
        currentPingUrl = url;

        const startTime = performance.now();
        const timeout = 5000;

        try {
            const urlObj = new URL(url);
            const isLocalIP = /^192\.168\.|^10\.|^172\.(1[6-9]|2[0-9]|3[01])\.|^127\./.test(urlObj.hostname);
            
            let latency = null;
            latency = await pingLocalIP(url, startTime, timeout);

            if (currentPingUrl !== url) return null;

            if (latency !== null && latency >= 0) {
                pingBtn.classList.remove('pinging');
                pingBtn.classList.add('success');
                const successText = getText('ping.success', `${latency} мс`).replace(/\{latency\}/g, latency);
                pingText.textContent = successText;
                pingBtn.disabled = false;

                setTimeout(() => {
                    if (currentPingUrl === url) {
                        resetPingStatus();
                    }
                }, 3000);

                return latency;
            } else {
                throw new Error('Ping failed');
            }
        } catch (error) {
            if (currentPingUrl !== url) return null;

            const endTime = performance.now();
            const latency = Math.round(endTime - startTime);

            pingBtn.classList.remove('pinging');
            pingBtn.classList.add('error');
            pingText.textContent = getText('ping.error', 'Недоступен');
            pingBtn.disabled = false;

            setTimeout(() => {
                if (currentPingUrl === url) {
                    resetPingStatus();
                }
            }, 3000);

            return null;
        }
    }

    async function pingLocalIP(url, startTime, timeout) {
        return new Promise((resolve) => {
            const urlObj = new URL(url);
            const isLocalIP = /^192\.168\.|^10\.|^172\.(1[6-9]|2[0-9]|3[01])\.|^127\./.test(urlObj.hostname);
            
            let pingUrl;
            if (isLocalIP) {
                pingUrl = `${urlObj.protocol}//${urlObj.hostname}/favicon.ico?t=${Date.now()}`;
            } else {
                pingUrl = `${urlObj.protocol}//${urlObj.hostname}/favicon.ico?t=${Date.now()}`;
            }
            
            const img = new Image();
            currentPingImage = img;
            let resolved = false;

            const cleanup = () => {
                if (resolved) return;
                resolved = true;
                img.onload = null;
                img.onerror = null;
                if (pingTimeout) {
                    clearTimeout(pingTimeout);
                    pingTimeout = null;
                }
                if (currentPingImage === img) {
                    currentPingImage = null;
                }
            };

            img.onload = () => {
                cleanup();
                const endTime = performance.now();
                const latency = Math.round(endTime - startTime);
                resolve(latency);
            };

            img.onerror = () => {
                cleanup();
                const endTime = performance.now();
                const latency = Math.round(endTime - startTime);
                if (latency < timeout) {
                    resolve(latency);
                } else {
                    resolve(null);
                }
            };

            pingTimeout = setTimeout(() => {
                cleanup();
                resolve(null);
            }, timeout);

            img.src = pingUrl;
        });
    }

    async function pingRemoteIP(url, startTime, timeout) {
        try {
            const controller = new AbortController();
            pingTimeout = setTimeout(() => controller.abort(), timeout);

            const response = await fetch(url, {
                method: 'HEAD',
                signal: controller.signal,
                cache: 'no-store',
                credentials: 'omit'
            });

            clearTimeout(pingTimeout);
            pingTimeout = null;

            const endTime = performance.now();
            const latency = Math.round(endTime - startTime);
            return latency;
        } catch (error) {
            if (pingTimeout) {
                clearTimeout(pingTimeout);
                pingTimeout = null;
            }
            return null;
        }
    }

    function initPing() {
        const pingBtn = document.getElementById('ping-btn');
        if (!pingBtn) return;

        pingBtn.addEventListener('click', async () => {
            const ipEl = document.getElementById('selected-ip');
            if (!ipEl) return;

            const ipText = ipEl.textContent.trim();
            if (!ipText || ipText === '—') return;

            const isLocalIP = /^192\.168\.|^10\.|^172\.(1[6-9]|2[0-9]|3[01])\.|^127\./.test(ipText);
            let url = ipText;
            if (!url.startsWith('http://') && !url.startsWith('https://')) {
                url = isLocalIP ? `http://${url}` : `https://${url}`;
            } else if (!isLocalIP && url.startsWith('http://')) {
                url = url.replace(/^http:\/\//, 'https://');
            }

            await pingRouter(url);
        });
    }

    function initPingAdvanced() {
        const pingForm = document.getElementById('ping-form');
        if (!pingForm) return;

        pingForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            
            const targetInput = document.getElementById('ping-target');
            const packetsInput = document.getElementById('ping-packets');
            const startBtn = document.getElementById('ping-start');
            const resultsDiv = document.getElementById('ping-results');
            const progressDiv = document.getElementById('ping-progress');
            const statsDiv = document.getElementById('ping-stats');

            if (!targetInput || !packetsInput || !startBtn || !resultsDiv || !progressDiv) return;

            const target = targetInput.value.trim();
            const packets = Math.max(1, Math.min(100, parseInt(packetsInput.value) || 10));

            if (!target) {
                showToast(getText('tools.ping_target', 'Укажите IP адрес или домен'), 'error');
                return;
            }

            startBtn.disabled = true;
            resultsDiv.hidden = false;
            progressDiv.innerHTML = '';
            statsDiv.hidden = true;

            let url = target;
            const isLocalIP = /^192\.168\.|^10\.|^172\.(1[6-9]|2[0-9]|3[01])\.|^127\./.test(target);
            
            if (!url.startsWith('http://') && !url.startsWith('https://')) {
                url = isLocalIP ? `http://${url}` : `https://${url}`;
            } else if (!isLocalIP && url.startsWith('http://')) {
                url = url.replace(/^http:\/\//, 'https://');
            }

            const results = [];
            
            for (let i = 0; i < packets; i++) {
                const progressItem = document.createElement('div');
                progressItem.className = 'ping-progress-item pending';
                const packetLabel = getText('tools.ping_packet', `Пакет ${i + 1}/${packets}`).replace('{num}', i + 1).replace('{total}', packets);
                const waitingText = getText('ping.checking', 'Ожидание...');
                progressItem.innerHTML = `<span class="ping-packet-label">${packetLabel}</span> <span class="ping-status-text">${waitingText}</span>`;
                progressDiv.appendChild(progressItem);

                const startTime = performance.now();
                let latency = null;

                try {
                    latency = await pingLocalIP(url, startTime, 3000);
                } catch (error) {
                    latency = null;
                }

                const endTime = performance.now();
                const actualLatency = latency !== null ? latency : Math.round(endTime - startTime);

                if (latency !== null) {
                    progressItem.classList.remove('pending');
                    progressItem.classList.add('success');
                    const msText = getText('ping.success', `${actualLatency} мс`).replace(/\{latency\}/g, actualLatency);
                    progressItem.querySelector('.ping-status-text').textContent = msText;
                    results.push(actualLatency);
                } else {
                    progressItem.classList.remove('pending');
                    progressItem.classList.add('error');
                    progressItem.querySelector('.ping-status-text').textContent = getText('ping.error', 'Недоступен');
                }

                if (i < packets - 1) {
                    await new Promise(resolve => setTimeout(resolve, 500));
                }
            }

            if (results.length > 0) {
                const sorted = [...results].sort((a, b) => a - b);
                const min = sorted[0];
                const max = sorted[sorted.length - 1];
                const avg = Math.round(results.reduce((a, b) => a + b, 0) / results.length);
                const median = sorted.length % 2 === 0
                    ? Math.round((sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2)
                    : sorted[Math.floor(sorted.length / 2)];
                
                let jitter = 0;
                if (results.length > 1) {
                    const differences = [];
                    for (let i = 1; i < results.length; i++) {
                        differences.push(Math.abs(results[i] - results[i - 1]));
                    }
                    jitter = Math.round(differences.reduce((a, b) => a + b, 0) / differences.length);
                }
                
                const loss = Math.round(((packets - results.length) / packets) * 100);

                const msUnit = getText('ping.ms', 'мс');
                document.getElementById('ping-min').textContent = `${min} ${msUnit}`;
                document.getElementById('ping-max').textContent = `${max} ${msUnit}`;
                document.getElementById('ping-avg').textContent = `${avg} ${msUnit}`;
                document.getElementById('ping-median').textContent = `${median} ${msUnit}`;
                document.getElementById('ping-jitter').textContent = `${jitter} ${msUnit}`;
                document.getElementById('ping-loss').textContent = `${loss}%`;

                statsDiv.hidden = false;
            } else {
                statsDiv.hidden = true;
            }

            startBtn.disabled = false;
        });
    }

    function parseIPRange(range) {
        const ips = [];
        const parts = range.split(',');
        
        for (const part of parts) {
            const trimmed = part.trim();
            if (trimmed.includes('-')) {
                const [start, end] = trimmed.split('-').map(s => s.trim());
                const startParts = start.split('.');
                const base = startParts.slice(0, 3).join('.');
                const startNum = parseInt(startParts[3]);
                const endNum = parseInt(end);
                
                for (let i = startNum; i <= endNum; i++) {
                    ips.push(`${base}.${i}`);
                }
            } else {
                ips.push(trimmed);
            }
        }
        
        return ips;
    }

    async function scanDevice(ip, timeout, abortSignal = null) {
        const url = `http://${ip}/?t=${Date.now()}`;
        
        return new Promise((resolve) => {
            if (abortSignal && abortSignal.aborted) {
                resolve({ ip, success: false });
                return;
            }

            const img = new Image();
            let resolved = false;
            let timeoutId = null;
            
            const cleanup = () => {
                if (resolved) return;
                resolved = true;
                img.onload = null;
                img.onerror = null;
                if (timeoutId) {
                    clearTimeout(timeoutId);
                    timeoutId = null;
                }
                if (abortSignal) {
                    abortSignal.removeEventListener('abort', abortHandler);
                }
            };

            const abortHandler = () => {
                cleanup();
                resolve({ ip, success: false });
            };

            if (abortSignal) {
                abortSignal.addEventListener('abort', abortHandler);
            }
            
            timeoutId = setTimeout(() => {
                cleanup();
                resolve({ ip, success: false });
            }, timeout);
            
            img.onload = () => {
                cleanup();
                resolve({ ip, success: true });
            };
            
            img.onerror = () => {
                cleanup();
                resolve({ ip, success: true });
            };
            
            img.src = url;
        });
    }

    function initScanner() {
        const scannerForm = document.getElementById('scanner-form');
        if (!scannerForm) return;

        let isScanningCancelled = false;
        let currentScanAbortController = null;

        const stopBtn = document.getElementById('scanner-stop');
        if (stopBtn) {
            stopBtn.addEventListener('click', () => {
                isScanningCancelled = true;
                if (currentScanAbortController) {
                    currentScanAbortController.abort();
                }
            });
        }

        scannerForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            
            const rangeInput = document.getElementById('scanner-range');
            const timeoutInput = document.getElementById('scanner-timeout');
            const startBtn = document.getElementById('scanner-start');
            const resultsDiv = document.getElementById('scanner-results');
            const progressDiv = document.getElementById('scanner-progress');
            const devicesDiv = document.getElementById('scanner-devices');
            const progressText = document.getElementById('scanner-progress-text');

            if (!rangeInput || !timeoutInput || !startBtn || !resultsDiv || !progressDiv || !devicesDiv) return;

            const range = rangeInput.value.trim();
            const timeout = Math.max(200, Math.min(2000, parseInt(timeoutInput.value) || 200));

            if (!range) {
                showToast(getText('tools.scanner_range', 'Укажите диапазон IP адресов'), 'error');
                return;
            }

            let ips;
            try {
                ips = parseIPRange(range);
                if (ips.length === 0 || ips.length > 254) {
                    showToast(getText('tools.scanner_range', 'Диапазон должен содержать от 1 до 254 адресов'), 'error');
                    return;
                }
            } catch (error) {
                showToast(getText('tools.scanner_range', 'Неверный формат диапазона'), 'error');
                return;
            }

            isScanningCancelled = false;
            currentScanAbortController = new AbortController();
            
            startBtn.disabled = true;
            startBtn.hidden = true;
            if (stopBtn) {
                stopBtn.hidden = false;
            }
            resultsDiv.hidden = false;
            progressDiv.innerHTML = '';
            devicesDiv.innerHTML = '';
            progressText.textContent = '';

            const foundDevices = [];
            const total = ips.length;
            let scanned = 0;

            for (let i = 0; i < ips.length; i++) {
                if (isScanningCancelled || currentScanAbortController.signal.aborted) {
                    progressText.textContent = `${getText('tools.scanner_stopped', 'Сканирование остановлено')} - ${scanned}/${total} (${foundDevices.length} ${getText('tools.scanner_found', 'найдено')})`;
                    break;
                }

                const ip = ips[i];
                const progressItem = document.createElement('div');
                progressItem.className = 'scanner-progress-item';
                progressItem.innerHTML = `<span class="scanner-ip">${ip}</span> <span class="scanner-status">${getText('tools.scanner_scanning', 'Проверка...')}</span>`;
                progressDiv.appendChild(progressItem);

                const result = await scanDevice(ip, timeout, currentScanAbortController.signal);
                scanned++;

                if (isScanningCancelled || currentScanAbortController.signal.aborted) {
                    progressText.textContent = `${getText('tools.scanner_stopped', 'Сканирование остановлено')} - ${scanned}/${total} (${foundDevices.length} ${getText('tools.scanner_found', 'найдено')})`;
                    break;
                }

                if (result.success) {
                    progressItem.classList.add('success');
                    progressItem.querySelector('.scanner-status').textContent = getText('tools.scanner_found_device', 'Найдено');
                    foundDevices.push(result);
                } else {
                    progressItem.classList.add('error');
                    progressItem.querySelector('.scanner-status').textContent = getText('ping.error', 'Недоступен');
                }

                progressText.textContent = `${scanned}/${total} (${foundDevices.length} ${getText('tools.scanner_found', 'найдено')})`;

                if (i < ips.length - 1 && !isScanningCancelled && !currentScanAbortController.signal.aborted) {
                    await new Promise(resolve => setTimeout(resolve, 50));
                }
            }

            if (foundDevices.length > 0) {
                const devicesTitle = document.createElement('h4');
                devicesTitle.textContent = `${getText('tools.scanner_found', 'Найдено устройств')}: ${foundDevices.length}`;
                devicesDiv.appendChild(devicesTitle);

                const devicesList = document.createElement('div');
                devicesList.className = 'scanner-devices-list';
                
                foundDevices.forEach(device => {
                    const deviceItem = document.createElement('div');
                    deviceItem.className = 'scanner-device-item';
                    deviceItem.innerHTML = `
                        <div class="scanner-device-ip">${device.ip}</div>
                    `;
                    deviceItem.addEventListener('click', () => {
                        document.getElementById('ping-target').value = device.ip;
                        const pingTab = document.querySelector('.tools-tab[data-tab="ping"]');
                        if (pingTab) pingTab.click();
                    });
                    devicesList.appendChild(deviceItem);
                });
                
                devicesDiv.appendChild(devicesList);
            } else {
                const empty = document.createElement('p');
                empty.className = 'muted';
                empty.textContent = getText('tools.scanner_no_devices', 'Устройства не найдены');
                devicesDiv.appendChild(empty);
            }

            startBtn.disabled = false;
            startBtn.hidden = false;
            if (stopBtn) {
                stopBtn.hidden = true;
            }
            currentScanAbortController = null;
        });
    }

    function renderSelectedCreds(target, creds) {
        target.innerHTML = '';
        if (!Array.isArray(creds) || !creds.length) {
            const empty = document.createElement('p');
            empty.className = 'muted';
            empty.setAttribute('data-i18n', 'defaults.none');
            empty.textContent = 'Нет данных о логинах и паролях.';
            target.append(empty);
            window.__I18N__?.apply?.();
            return;
        }
        creds.forEach(pair => target.append(createInlineCred(pair)));
        window.__I18N__?.apply?.();
    }

    function createInlineCred(pair) {
        const chip = document.createElement('div');
        chip.className = 'cred-inline';

        const values = document.createElement('div');
        values.className = 'cred-inline-values';
        values.append(buildCredSpan('label.login', 'Логин', pair.login));
        values.append(buildCredSpan('label.password', 'Пароль', pair.password));
        if (pair.note) {
            const note = document.createElement('span');
            note.className = 'tag';
            note.textContent = pair.note;
            values.append(note);
        }

        const btn = createCopyIconButton(() => copyCombo(pair));

        chip.append(values, btn);
        return chip;
    }

    function cleanCred(data = {}) {
        return {
            login: (data.login || '').trim(),
            password: data.password ?? '',
            note: (data.note || '').trim()
        };
    }

    function hasCredData(cred) {
        return Boolean(cred && (cred.login || cred.password || cred.note));
    }

    function buildCredSpan(key, fallback, value) {
        const span = document.createElement('span');
        const label = document.createElement('span');
        label.setAttribute('data-i18n', key);
        label.textContent = fallback;
        const strong = document.createElement('strong');
        strong.textContent = value || '—';
        span.append(label, document.createTextNode(':'), strong);
        return span;
    }

    // Мои модемы (localStorage)
    function readMine() {
        try {
            const raw = JSON.parse(localStorage.getItem(MINE_STORAGE_KEY) || '[]');
            if (!Array.isArray(raw)) return [];
            return raw.map(normalizeMineEntry).filter(Boolean);
        } catch {
            return [];
        }
    }

    function writeMine(items) {
        try { localStorage.setItem(MINE_STORAGE_KEY, JSON.stringify(items)); } catch {}
    }

    function extractCreds(entry = {}) {
        const base = Array.isArray(entry.defaults) && entry.defaults.length
            ? entry.defaults
            : [{ login: entry.login, password: entry.password, note: entry.note }];
        return base.map(cleanCred).filter(hasCredData);
    }

    function createMineId() {
        return `mine-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    }

    function normalizeMineEntry(entry = {}) {
        if (!entry || typeof entry !== 'object') return null;
        const defaults = extractCreds(entry);
        if (!defaults.length) return null;
        const brand = (entry.brand || '').trim() || getText('label.brand', 'Бренд');
        const model = (entry.model || '').trim() || entry.note || getText('section.mine', 'Мой модем');
        const storedGroup = (entry.group || '').trim();
        const group = storedGroup && storedGroup !== 'auto' ? storedGroup : resolveGroup({ brand, model });
        const groupLabel = (entry.groupLabel || '').trim();
        return {
            id: entry.id || createMineId(),
            brand,
            model,
            group,
            groupLabel,
            ip: entry.ip || '',
            defaults,
            thumbnail: entry.thumbnail || CUSTOM_THUMBNAIL,
            createdAt: entry.createdAt || Date.now(),
            order: typeof entry.order === 'number' ? entry.order : CUSTOM_ORDER_BASE,
            custom: true
        };
    }

    function addMine(entry) {
        const items = readMine();
        const normalized = normalizeMineEntry(entry);
        if (!normalized) return items;
        items.unshift(normalized);
        writeMine(items);
        return items;
    }

    function removeMine(id) {
        const filtered = readMine().filter(item => item.id !== id);
        writeMine(filtered);
        return filtered;
    }

    // Диалог подтверждения
    function showConfirmDialog(message, onConfirm) {
        const dialog = document.getElementById('confirm-dialog');
        const messageEl = document.getElementById('confirm-dialog-message');
        const cancelBtn = document.getElementById('confirm-dialog-cancel');
        const okBtn = document.getElementById('confirm-dialog-ok');
        
        if (!dialog || !messageEl || !cancelBtn || !okBtn) return;

        messageEl.textContent = message;
        dialog.hidden = false;
        dialog.focus();

        const cleanup = () => {
            dialog.hidden = true;
            cancelBtn.onclick = null;
            okBtn.onclick = null;
        };

        cancelBtn.onclick = () => cleanup();
        okBtn.onclick = () => {
            cleanup();
            onConfirm?.();
        };

        const handleEscape = (e) => {
            if (e.key === 'Escape') {
                cleanup();
                document.removeEventListener('keydown', handleEscape);
            }
        };
        document.addEventListener('keydown', handleEscape);
    }

    let editingItemId = null;

    function renderMine() {
        const list = document.getElementById('mine-list');
        if (!list) return;
        const items = readMine();
        list.innerHTML = '';
        if (!items.length) {
            const empty = document.createElement('p');
            empty.className = 'muted list-empty';
            empty.setAttribute('data-i18n', 'mine.empty');
            empty.textContent = 'Добавьте свой модем, чтобы быстро переходить к нему.';
            list.append(empty);
            window.__I18N__?.apply?.();
            return;
        }
        items.forEach((item) => {
            const block = document.createElement('div');
            block.className = 'list-item';

            const title = document.createElement('div');
            title.className = 'list-title';
            title.textContent = `${item.brand || ''} ${item.model || ''}`.trim() || '—';
            block.append(title);

            if (item.ip) {
                const ip = document.createElement('div');
                ip.className = 'muted';
                ip.textContent = item.ip.replace(/^https?:\/\//, '');
                block.append(ip);
            }

            if (Array.isArray(item.defaults) && item.defaults.length) {
                const creds = document.createElement('div');
                creds.className = 'cred-inline-list';
                item.defaults.forEach(pair => creds.append(createInlineCred(pair)));
                block.append(creds);
            }

            const row = document.createElement('div');
            row.className = 'cred-row';

            const editBtn = document.createElement('button');
            editBtn.className = 'btn edit-btn';
            editBtn.type = 'button';
            editBtn.setAttribute('data-i18n', 'action.edit');
            editBtn.setAttribute('aria-label', `${getText('action.edit', 'Редактировать')} ${item.brand || ''} ${item.model || ''}`.trim());
            editBtn.textContent = 'Редактировать';
            editBtn.addEventListener('click', () => {
                editingItemId = item.id;
                fillMineForm(item);
            });

            const delBtn = document.createElement('button');
            delBtn.className = 'btn';
            delBtn.type = 'button';
            delBtn.setAttribute('data-i18n', 'action.delete');
            delBtn.setAttribute('aria-label', `${getText('action.delete', 'Удалить')} ${item.brand || ''} ${item.model || ''}`.trim());
            delBtn.textContent = 'Удалить';
            delBtn.addEventListener('click', () => {
                showConfirmDialog(
                    getText('confirm.delete', 'Вы уверены, что хотите удалить эту запись?'),
                    () => {
                        removeMine(item.id);
                        renderMine();
                        refreshRouterCards();
                    }
                );
            });

            row.append(editBtn, delBtn);
            block.append(row);
            list.append(block);
        });
        window.__I18N__?.apply?.();
    }

    function fillMineForm(item) {
        const brandInput = document.getElementById('mine-brand');
        const modelInput = document.getElementById('mine-model');
        const ipInput = document.getElementById('mine-ip');
        const groupInput = document.getElementById('mine-group');
        const customGroupInput = document.getElementById('mine-group-custom');
        const credList = document.getElementById('mine-creds');

        if (brandInput) brandInput.value = item.brand || '';
        if (modelInput) modelInput.value = item.model || '';
        if (ipInput) ipInput.value = item.ip || '';

        const group = item.group || 'auto';
        if (groupInput) {
            if (group.startsWith(CUSTOM_GROUP_PREFIX)) {
                groupInput.value = 'custom';
                if (customGroupInput) customGroupInput.value = item.groupLabel || '';
            } else {
                groupInput.value = group;
            }
        }

        if (credList) {
            credList.innerHTML = '';
            if (Array.isArray(item.defaults) && item.defaults.length) {
                item.defaults.forEach(pair => {
                    credList.append(createCredFieldRow(pair));
                });
            } else {
                credList.append(createCredFieldRow());
            }
        }

        const groupPicker = document.querySelector('[data-group-picker]');
        if (groupPicker) {
            const updateGroupFieldVisibility = () => {
                const customGroupWrap = document.getElementById('mine-group-custom-wrap');
                if (!customGroupWrap) return;
                const isCustom = groupInput?.value === 'custom';
                if (isCustom) {
                    customGroupWrap.removeAttribute('hidden');
                } else {
                    customGroupWrap.setAttribute('hidden', 'true');
                }
            };
            updateGroupFieldVisibility();
        }

        const submitBtn = document.getElementById('mine-submit');
        const cancelBtn = document.getElementById('mine-cancel-edit');
        if (submitBtn) {
            submitBtn.setAttribute('data-i18n', 'action.save_changes');
            submitBtn.textContent = getText('action.save_changes', 'Изменить');
        }
        if (cancelBtn) {
            cancelBtn.hidden = false;
        }

    }

    function isValidIP(ip) {
        if (!ip || !ip.trim()) return true;
        const ipRegex = /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;
        return ipRegex.test(ip.trim());
    }

    function collectMineFormData() {
        const brand = document.getElementById('mine-brand')?.value?.trim() || '';
        const model = document.getElementById('mine-model')?.value?.trim() || '';
        const ip = document.getElementById('mine-ip')?.value?.trim() || '';
        const groupSelect = document.getElementById('mine-group');
        const customGroupInput = document.getElementById('mine-group-custom');
        let group = groupSelect?.value || 'auto';
        let groupLabel = '';
        const defaults = collectCredRows(document.getElementById('mine-creds'));
        if (!brand || !model) {
            alert(getText('mine.validation_required', 'Укажите бренд и модель.'));
            return null;
        }
        if (!defaults.length) {
            alert(getText('mine.validation_creds', 'Добавьте хотя бы одну пару логин/пароль.'));
            return null;
        }
        if (ip && !isValidIP(ip)) {
            alert(getText('mine.validation_ip', 'Введите корректный IP-адрес (например, 192.168.1.1).'));
            return null;
        }
        if (group === 'custom') {
            const rawLabel = customGroupInput?.value?.trim() || '';
            if (!rawLabel) {
                alert(getText('mine.validation_group', 'Введите название новой группы.'));
                return null;
            }
            const slug = slugifyGroup(rawLabel) || Date.now().toString(36);
            group = `${CUSTOM_GROUP_PREFIX}${slug}`;
            groupLabel = rawLabel;
        }
        return {
            brand,
            model,
            ip,
            group,
            groupLabel,
            defaults,
            thumbnail: CUSTOM_THUMBNAIL,
            order: CUSTOM_ORDER_BASE - 1
        };
    }

    function collectCredRows(container) {
        if (!container) return [];
        const rows = Array.from(container.querySelectorAll('.cred-field-row'));
        return rows.map(row => {
            const login = row.querySelector('input[data-field="login"]')?.value?.trim() || '';
            const password = row.querySelector('input[data-field="password"]')?.value || '';
            return cleanCred({ login, password });
        }).filter(hasCredData);
    }

    function buildMineField(config) {
        const wrap = document.createElement('div');
        wrap.className = 'field';
        const inputId = `mine-${config.type}-${credFieldIdCounter++}`;
        const label = document.createElement('label');
        label.className = 'visually-hidden';
        label.setAttribute('for', inputId);
        label.setAttribute('data-i18n', config.labelKey);
        label.textContent = config.fallback;
        const input = document.createElement('input');
        input.id = inputId;
        input.dataset.field = config.type;
        input.type = config.inputType || 'text';
        input.placeholder = config.placeholder || '';
        input.autocomplete = config.autocomplete || 'off';
        input.value = config.value || '';
        wrap.append(label, input);
        return wrap;
    }

    function createCredFieldRow(values = {}) {
        const row = document.createElement('div');
        row.className = 'cred-field-row';

        row.append(
            buildMineField({
                type: 'login',
                labelKey: 'label.login',
                fallback: 'Логин',
                placeholder: 'admin',
                autocomplete: 'username',
                value: values.login || ''
            }),
            buildMineField({
                type: 'password',
                labelKey: 'label.password',
                fallback: 'Пароль',
                placeholder: 'admin',
                autocomplete: 'current-password',
                inputType: 'text',
                value: values.password || ''
            })
        );

        const removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.className = 'remove-cred-btn';
        removeBtn.setAttribute('aria-label', getText('action.delete', 'Удалить'));
        removeBtn.innerHTML = `
            <svg viewBox="0 0 20 20" aria-hidden="true">
                <path d="M5 5l10 10M15 5L5 15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
            </svg>
        `;
        removeBtn.addEventListener('click', () => {
            const parent = row.parentElement;
            row.remove();
            if (parent && !parent.querySelector('.cred-field-row')) {
                parent.append(createCredFieldRow());
            }
        });

        row.append(removeBtn);
        return row;
    }

    function resetCredFields(container) {
        if (!container) return;
        container.innerHTML = '';
        container.append(createCredFieldRow());
    }

    function initMine() {
        const form = document.getElementById('mine-form');
        const clearBtn = document.getElementById('mine-clear');
        const credList = document.getElementById('mine-creds');
        const addCredBtn = document.getElementById('mine-add-cred');
        const groupInput = document.getElementById('mine-group');
        const groupToggle = document.getElementById('mine-group-toggle');
        const groupMenu = document.getElementById('mine-group-menu');
        const groupLabelEl = document.getElementById('mine-group-current');
        const groupPicker = document.querySelector('[data-group-picker]');
        const customGroupWrap = document.getElementById('mine-group-custom-wrap');
        const customGroupInput = document.getElementById('mine-group-custom');

        resetCredFields(credList);

        if (groupMenu) {
            groupMenu.setAttribute('hidden', 'true');
        }
        if (groupToggle) {
            groupToggle.setAttribute('aria-expanded', 'false');
        }

        const updateGroupFieldVisibility = () => {
            if (!customGroupWrap) return;
            const isCustom = groupInput?.value === 'custom';
            if (isCustom) {
                customGroupWrap.removeAttribute('hidden');
            } else {
                customGroupWrap.setAttribute('hidden', 'true');
                if (customGroupInput && customGroupInput.value && (!groupInput || groupInput.value !== 'custom')) {
                    customGroupInput.value = '';
                }
            }
        };

        const syncGroupLabel = () => {
            if (!groupLabelEl) return;
            const currentValue = groupInput?.value || 'auto';
            let labelKey = null;
            let labelText = '';
            if (groupMenu) {
                groupMenu.querySelectorAll('button').forEach(btn => {
                    const isActive = btn.dataset.value === currentValue;
                    btn.classList.toggle('active', isActive);
                    if (isActive) {
                        labelKey = btn.dataset.labelKey || null;
                        labelText = btn.textContent.trim();
                    }
                });
            }
            if (!labelText) {
                labelKey = 'group.auto';
                labelText = getText('group.auto', 'Определить автоматически');
            }
            groupLabelEl.textContent = labelText;
            if (labelKey) {
                groupLabelEl.setAttribute('data-i18n', labelKey);
            } else {
                groupLabelEl.removeAttribute('data-i18n');
            }
        };

        const setGroupValue = (value) => {
            if (groupInput) groupInput.value = value;
            syncGroupLabel();
            updateGroupFieldVisibility();
        };

        const handleOptionClick = (event) => {
            const option = event.target.closest('button[data-value]');
            if (!option) return;
            const value = option.dataset.value || 'auto';
            setGroupValue(value);
            closeGroupMenu();
        };

        const handleOutsideClick = (event) => {
            if (!groupPicker) {
                closeGroupMenu();
                return;
            }
            if (groupPicker.contains(event.target)) return;
            closeGroupMenu();
        };

        const handleEscape = (event) => {
            if (event.key === 'Escape') {
                closeGroupMenu();
            }
        };

        const openGroupMenu = () => {
            if (!groupMenu || !groupToggle) return;
            if (groupMenu.hasAttribute('hidden') === false) return;
            groupMenu.removeAttribute('hidden');
            groupToggle.setAttribute('aria-expanded', 'true');
            document.addEventListener('click', handleOutsideClick);
            document.addEventListener('keydown', handleEscape);
        };

        const closeGroupMenu = () => {
            if (!groupMenu) return;
            if (groupMenu.hasAttribute('hidden')) return;
            groupMenu.setAttribute('hidden', 'true');
            groupToggle?.setAttribute('aria-expanded', 'false');
            document.removeEventListener('click', handleOutsideClick);
            document.removeEventListener('keydown', handleEscape);
        };

        groupMenu?.addEventListener('click', handleOptionClick);
        groupToggle?.addEventListener('click', (event) => {
            event.stopPropagation();
            if (groupMenu && groupMenu.hasAttribute('hidden')) {
                openGroupMenu();
            } else {
                closeGroupMenu();
            }
        });

        syncGroupLabel();
        updateGroupFieldVisibility();

        const ipInput = document.getElementById('mine-ip');
        if (ipInput) {
            ipInput.addEventListener('blur', () => {
                const ip = ipInput.value.trim();
                if (ip && !isValidIP(ip)) {
                    ipInput.setAttribute('aria-invalid', 'true');
                    ipInput.style.borderColor = '#ef4444';
                } else {
                    ipInput.removeAttribute('aria-invalid');
                    ipInput.style.borderColor = '';
                }
            });
            ipInput.addEventListener('input', () => {
                ipInput.removeAttribute('aria-invalid');
                ipInput.style.borderColor = '';
            });
        }

        addCredBtn?.addEventListener('click', () => {
            credList?.append(createCredFieldRow());
        });

        form?.addEventListener('submit', (e) => {
            e.preventDefault();
            const entry = collectMineFormData();
            if (!entry) return;
            
            if (editingItemId) {
                const items = readMine();
                const index = items.findIndex(item => item.id === editingItemId);
                if (index !== -1) {
                    const normalized = normalizeMineEntry({ ...entry, id: editingItemId });
                    if (normalized) {
                        items[index] = normalized;
                        writeMine(items);
                    }
                }
                editingItemId = null;
            } else {
                addMine(entry);
            }
            
            form.reset();
            editingItemId = null;
            closeGroupMenu();
            setGroupValue(groupInput?.value || 'auto');
            updateGroupFieldVisibility();
            resetCredFields(credList);
            updateEditMode(false);
            renderMine();
            refreshRouterCards();
        });

        clearBtn?.addEventListener('click', () => {
            form?.reset();
            editingItemId = null;
            closeGroupMenu();
            setGroupValue(groupInput?.value || 'auto');
            updateGroupFieldVisibility();
            resetCredFields(credList);
            updateEditMode(false);
        });

        const cancelEditBtn = document.getElementById('mine-cancel-edit');
        cancelEditBtn?.addEventListener('click', () => {
            form?.reset();
            editingItemId = null;
            closeGroupMenu();
            setGroupValue(groupInput?.value || 'auto');
            updateGroupFieldVisibility();
            resetCredFields(credList);
            updateEditMode(false);
        });

        function updateEditMode(isEditing) {
            const submitBtn = document.getElementById('mine-submit');
            const cancelBtn = document.getElementById('mine-cancel-edit');
            if (submitBtn) {
                submitBtn.setAttribute('data-i18n', isEditing ? 'action.save_changes' : 'action.save');
                submitBtn.textContent = getText(isEditing ? 'action.save_changes' : 'action.save', isEditing ? 'Изменить' : 'Сохранить');
            }
            if (cancelBtn) {
                cancelBtn.hidden = !isEditing;
            }
        }

        renderMine();
    }

    // Регистрация Service Worker для оффлайн работы с retry
    function registerServiceWorker(retries = 3) {
        if ('serviceWorker' in navigator) {
            navigator.serviceWorker.register('./sw.js')
                .then((registration) => {
                    // Проверка обновлений Service Worker
                    registration.addEventListener('updatefound', () => {
                        const newWorker = registration.installing;
                        if (newWorker) {
                            newWorker.addEventListener('statechange', () => {
                                if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                                    // Новый Service Worker установлен, можно обновить страницу
                                    if (navigator.onLine) {
                                        // Принудительное обновление при наличии обновлений SW
                                        window.location.reload();
                                    }
                                }
                            });
                        }
                    });
                    
                    // Периодическая проверка обновлений (каждые 60 секунд)
                    setInterval(() => {
                        if (navigator.onLine) {
                            registration.update();
                        }
                    }, 60000);

                    // Ждем активации Service Worker
                    if (registration.installing) {
                        registration.installing.addEventListener('statechange', (e) => {
                            if (e.target.state === 'activated') {
                                console.log('Service Worker активирован');
                            }
                        });
                    } else if (registration.waiting) {
                        console.log('Service Worker ожидает активации');
                    } else if (registration.active) {
                        console.log('Service Worker активен');
                    }
                })
                .catch((error) => {
                    console.warn('Ошибка регистрации Service Worker:', error);
                    // Retry при ошибке
                    if (retries > 0) {
                        setTimeout(() => {
                            registerServiceWorker(retries - 1);
                        }, 2000);
                    }
                });
        }
    }

    // Обработка офлайн/онлайн событий
    function initOfflineHandler() {
        const connectionStatusIcon = document.getElementById('connection-status-icon');
        let wasOffline = false;
        
        const updateOnlineStatus = () => {
            // Используем navigator.onLine, но если он false, проверяем дополнительно
            let isOnline = navigator.onLine;
            
            // Если navigator.onLine говорит что офлайн, но мы еще не были офлайн,
            // это может быть ложное срабатывание - игнорируем
            if (!isOnline && !wasOffline) {
                // Проверяем через небольшой таймаут - возможно это временная проблема
                setTimeout(() => {
                    if (!navigator.onLine) {
                        wasOffline = true;
                        updateOnlineStatus();
                    }
                }, 1000);
                return;
            }
            
            if (!isOnline) {
                wasOffline = true;
            } else {
                wasOffline = false;
            }
            
            document.documentElement.setAttribute('data-online', isOnline ? 'true' : 'false');
            
            if (connectionStatusIcon) {
                connectionStatusIcon.setAttribute('data-online', isOnline ? 'true' : 'false');
                connectionStatusIcon.setAttribute('title', isOnline ? 'Онлайн' : 'Офлайн');
                connectionStatusIcon.setAttribute('aria-label', isOnline ? 'Онлайн' : 'Офлайн');
            }
            
            if (isOnline) {
                // При восстановлении сети проверяем обновления
                if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
                    navigator.serviceWorker.controller.postMessage({ type: 'SKIP_WAITING' });
                }
            }
        };

        // Слушаем события браузера
        window.addEventListener('online', () => {
            wasOffline = false;
            updateOnlineStatus();
        });
        window.addEventListener('offline', () => {
            wasOffline = true;
            updateOnlineStatus();
        });
        
        // Устанавливаем начальное состояние - по умолчанию считаем что онлайн
        document.documentElement.setAttribute('data-online', 'true');
        if (connectionStatusIcon) {
            connectionStatusIcon.setAttribute('data-online', 'true');
            connectionStatusIcon.setAttribute('title', 'Онлайн');
            connectionStatusIcon.setAttribute('aria-label', 'Онлайн');
        }
        
        // Проверяем статус после небольшой задержки
        setTimeout(updateOnlineStatus, 100);
    }

    function initTraceroute() {
        const tracerouteForm = document.getElementById('traceroute-form');
        if (!tracerouteForm) return;

        tracerouteForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const targetInput = document.getElementById('traceroute-target');
            const startBtn = document.getElementById('traceroute-start');
            const resultsDiv = document.getElementById('traceroute-results');
            const pathDiv = document.getElementById('traceroute-path');

            if (!targetInput || !startBtn || !resultsDiv || !pathDiv) return;

            const target = targetInput.value.trim();
            if (!target) {
                showToast(getText('tools.traceroute_target', 'Укажите IP адрес или домен'), 'error');
                return;
            }

            startBtn.disabled = true;
            resultsDiv.hidden = false;
            pathDiv.innerHTML = '';

            try {
                const hops = await performTraceroute(target);
                if (hops.length === 0) {
                    pathDiv.innerHTML = '<p class="muted">Маршрут не найден</p>';
                } else {
                    hops.forEach((hop, index) => {
                        const hopDiv = document.createElement('div');
                        hopDiv.className = 'traceroute-hop';
                        hopDiv.innerHTML = `
                            <span class="traceroute-hop-number">${index + 1}</span>
                            <span class="traceroute-hop-ip">${hop.ip || '*'}</span>
                            <span class="traceroute-hop-time">${hop.time ? hop.time + ' мс' : 'timeout'}</span>
                        `;
                        pathDiv.appendChild(hopDiv);
                    });
                }
            } catch (error) {
                pathDiv.innerHTML = '<p class="muted">Ошибка при выполнении трассировки</p>';
            }

            startBtn.disabled = false;
        });
    }

    async function performTraceroute(target) {
        const hops = [];
        const maxHops = 15;
        
        for (let ttl = 1; ttl <= maxHops; ttl++) {
            try {
                const startTime = performance.now();
                const url = target.startsWith('http') ? target : `https://${target}`;
                await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(3000) });
                const endTime = performance.now();
                const time = Math.round(endTime - startTime);
                
                hops.push({ ip: target, time });
                if (ttl >= 3) break;
            } catch (error) {
                hops.push({ ip: '*', time: null });
            }
        }
        
        return hops;
    }

    function initSubnetCalculator() {
        const subnetForm = document.getElementById('subnet-form');
        if (!subnetForm) return;

        subnetForm.addEventListener('submit', (e) => {
            e.preventDefault();
            const ipInput = document.getElementById('subnet-ip');
            const maskInput = document.getElementById('subnet-mask');
            const resultsDiv = document.getElementById('subnet-results');
            const infoDiv = document.getElementById('subnet-info');

            if (!ipInput || !maskInput || !resultsDiv || !infoDiv) return;

            const ip = ipInput.value.trim();
            let mask = maskInput.value.trim();

            if (!ip || !mask) {
                showToast(getText('tools.subnet_ip', 'Укажите IP и маску'), 'error');
                return;
            }

            try {
                const result = calculateSubnet(ip, mask);
                resultsDiv.hidden = false;
                infoDiv.innerHTML = `
                    <div class="subnet-info-item">
                        <span class="subnet-info-label">${getText('tools.subnet_network', 'Сеть')}</span>
                        <span class="subnet-info-value">${result.network}</span>
                    </div>
                    <div class="subnet-info-item">
                        <span class="subnet-info-label">${getText('tools.subnet_broadcast', 'Broadcast')}</span>
                        <span class="subnet-info-value">${result.broadcast}</span>
                    </div>
                    <div class="subnet-info-item">
                        <span class="subnet-info-label">${getText('tools.subnet_hosts', 'Доступно хостов')}</span>
                        <span class="subnet-info-value">${result.hosts}</span>
                    </div>
                    <div class="subnet-info-item">
                        <span class="subnet-info-label">${getText('tools.subnet_range', 'Диапазон')}</span>
                        <span class="subnet-info-value">${result.range}</span>
                    </div>
                `;
            } catch (error) {
                showToast('Ошибка при расчёте подсети', 'error');
            }
        });
    }

    function calculateSubnet(ip, mask) {
        let cidr = 24;
        
        if (mask.startsWith('/')) {
            cidr = parseInt(mask.substring(1));
        } else {
            const maskParts = mask.split('.').map(Number);
            let bits = 0;
            for (const part of maskParts) {
                bits += part.toString(2).split('1').length - 1;
            }
            cidr = bits;
        }

        const ipParts = ip.split('.').map(Number);
        const hostBits = 32 - cidr;
        const hosts = Math.pow(2, hostBits) - 2;
        
        const networkParts = [...ipParts];
        const broadcastParts = [...ipParts];
        
        for (let i = 0; i < hostBits; i++) {
            const byteIndex = 3 - Math.floor(i / 8);
            const bitIndex = i % 8;
            networkParts[byteIndex] &= ~(1 << (7 - bitIndex));
            broadcastParts[byteIndex] |= (1 << (7 - bitIndex));
        }

        const network = networkParts.join('.');
        const broadcast = broadcastParts.join('.');
        const firstHost = networkParts.map((p, i) => i === 3 ? p + 1 : p).join('.');
        const lastHost = broadcastParts.map((p, i) => i === 3 ? p - 1 : p).join('.');
        const range = `${firstHost} - ${lastHost}`;

        return { network, broadcast, hosts, range };
    }

    async function checkConnection() {
        const resultsDiv = document.getElementById('connection-results');
        const infoDiv = document.getElementById('connection-info');

        if (!resultsDiv || !infoDiv) return;

        resultsDiv.hidden = false;
        infoDiv.innerHTML = '<p class="muted">Проверка...</p>';

        try {
            const online = navigator.onLine;
            let externalIP = 'Не определён';
            let location = 'Не определён';

            if (online) {
                try {
                    const ipResponse = await fetch('https://api.ipify.org?format=json', { signal: AbortSignal.timeout(5000) });
                    const ipData = await ipResponse.json();
                    externalIP = ipData.ip || 'Не определён';
                } catch (e) {}

                try {
                    const locResponse = await fetch(`https://ipapi.co/${externalIP}/json/`, { signal: AbortSignal.timeout(5000) });
                    const locData = await locResponse.json();
                    if (locData.city && locData.country_name) {
                        location = `${locData.city}, ${locData.country_name}`;
                    }
                } catch (e) {}
            }

            const statusClass = online ? 'online' : 'offline';
            const statusText = online ? getText('tools.connection_online', 'Онлайн') : getText('tools.connection_offline', 'Офлайн');

            infoDiv.innerHTML = `
                <div class="connection-info-item">
                    <span class="subnet-info-label">${getText('tools.connection_status', 'Статус')}</span>
                    <span class="connection-status ${statusClass}">
                        <span class="connection-status-dot"></span>
                        ${statusText}
                    </span>
                </div>
                <div class="connection-info-item">
                    <span class="subnet-info-label">${getText('tools.connection_ip', 'Внешний IP')}</span>
                    <span class="subnet-info-value">${externalIP}</span>
                </div>
                <div class="connection-info-item">
                    <span class="subnet-info-label">${getText('tools.connection_location', 'Местоположение')}</span>
                    <span class="subnet-info-value">${location}</span>
                </div>
            `;
        } catch (error) {
            infoDiv.innerHTML = '<p class="muted">Ошибка при проверке подключения</p>';
        }
    }

    function initExportImport() {
        const exportBtn = document.getElementById('export-btn');
        const importBtn = document.getElementById('import-btn');
        const importFile = document.getElementById('import-file');
        const importStatus = document.getElementById('import-status');

        if (exportBtn) {
            exportBtn.addEventListener('click', () => {
                try {
                    const routers = readMine();
                    const dataStr = JSON.stringify(routers, null, 2);
                    const dataBlob = new Blob([dataStr], { type: 'application/json' });
                    const url = URL.createObjectURL(dataBlob);
                    const link = document.createElement('a');
                    link.href = url;
                    link.download = `router-backup-${new Date().toISOString().split('T')[0]}.json`;
                    link.click();
                    URL.revokeObjectURL(url);
                } catch (error) {
                    showToast('Ошибка при экспорте', 'error');
                }
            });
        }

        if (importBtn && importFile) {
            importBtn.addEventListener('click', () => {
                importFile.click();
            });

            importFile.addEventListener('change', async (e) => {
                const file = e.target.files[0];
                if (!file) return;

                try {
                    const text = await file.text();
                    const routers = JSON.parse(text);
                    
                    if (!Array.isArray(routers)) {
                        throw new Error('Invalid format');
                    }

                    const existing = readMine();
                    const merged = [...existing, ...routers];
                    writeMine(merged);

                    if (importStatus) {
                        importStatus.hidden = false;
                        importStatus.className = 'import-status success';
                        importStatus.textContent = getText('tools.import_success', 'Настройки успешно импортированы');
                    }

                    showToast(getText('tools.import_success', 'Настройки успешно импортированы'), 'success');
                    
                    if (typeof renderMine === 'function') {
                        renderMine();
                    }
                } catch (error) {
                    if (importStatus) {
                        importStatus.hidden = false;
                        importStatus.className = 'import-status error';
                        importStatus.textContent = getText('tools.import_error', 'Ошибка при импорте настроек');
                    }
                    showToast(getText('tools.import_error', 'Ошибка при импорте настроек'), 'error');
                }

                importFile.value = '';
            });
        }
    }

    function initTools() {
        const toolsDialog = document.getElementById('tools-dialog');
        const toolsToggle = document.getElementById('tools-toggle');
        const toolsClose = document.getElementById('tools-dialog-close');
        const toolsTabs = document.querySelectorAll('.tools-tab');
        const toolsContent = document.querySelectorAll('.tools-tab-content');

        if (!toolsDialog || !toolsToggle) return;

        const openTools = () => {
            toolsDialog.hidden = false;
            document.body.style.overflow = 'hidden';
            window.__I18N__?.apply?.();
            initMine();
            
            const activeTab = document.querySelector('.tools-tab.active');
            if (activeTab && activeTab.dataset.tab === 'speedtest') {
                checkConnection();
            }
        };

        const closeTools = () => {
            toolsDialog.hidden = true;
            document.body.style.overflow = '';
        };

        toolsToggle.addEventListener('click', openTools);
        toolsClose?.addEventListener('click', closeTools);

        toolsDialog.addEventListener('click', (e) => {
            if (e.target === toolsDialog || e.target.classList.contains('tools-dialog-overlay')) {
                closeTools();
            }
        });

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && !toolsDialog.hidden) {
                closeTools();
            }
        });

        toolsTabs.forEach(tab => {
            tab.addEventListener('click', () => {
                const targetTab = tab.dataset.tab;
                
                toolsTabs.forEach(t => {
                    t.classList.remove('active');
                    t.setAttribute('aria-selected', 'false');
                });
                tab.classList.add('active');
                tab.setAttribute('aria-selected', 'true');

                toolsContent.forEach(content => {
                    content.classList.remove('active');
                    if (content.dataset.content === targetTab) {
                        content.classList.add('active');
                        if (targetTab === 'speedtest') {
                            checkConnection();
                        }
                    }
                });
                window.__I18N__?.apply?.();
            });
        });

        initMine();
        initSubnetCalculator();
        initExportImport();
    }

    // Принудительное обновление при первом открытии, если онлайн
    async function checkForUpdates() {
        // Проверяем доступность сети более надежным способом
        if (!navigator.onLine) {
            return false;
        }
        
        // Дополнительная проверка через попытку fetch (с таймаутом)
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 2000);
            await fetch('./', { 
                method: 'HEAD', 
                cache: 'no-store',
                signal: controller.signal 
            });
            clearTimeout(timeoutId);
        } catch (error) {
            // Сеть недоступна, не делаем редирект
            return false;
        }
        
        const FIRST_LOAD_KEY = 'router:firstLoad';
        const RELOAD_FLAG = 'router:reloaded';
        const isFirstLoad = !sessionStorage.getItem(FIRST_LOAD_KEY);
        
        if (isFirstLoad) {
            // Проверяем, не обновлялись ли мы уже
            if (sessionStorage.getItem(RELOAD_FLAG)) {
                sessionStorage.setItem(FIRST_LOAD_KEY, 'true');
                sessionStorage.removeItem(RELOAD_FLAG);
                return false;
            }
            
            // Проверяем наличие service worker перед редиректом
            if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
                // Помечаем, что мы обновляемся
                sessionStorage.setItem(RELOAD_FLAG, 'true');
                
                // Принудительное обновление с обходом кэша через добавление параметра
                const url = new URL(window.location.href);
                url.searchParams.set('_refresh', Date.now().toString());
                window.location.href = url.toString();
                return true;
            } else {
                // Если service worker не установлен, просто помечаем первую загрузку
                sessionStorage.setItem(FIRST_LOAD_KEY, 'true');
                return false;
            }
        }
        
        return false;
    }

    async function init() {
        // Проверка обновлений при первом открытии
        const shouldReload = await checkForUpdates();
        if (shouldReload) {
            return;
        }
        
        initTheme();
        initOfflineHandler();
        registerServiceWorker();
        
        try {
            const db = await loadRouterDb();
            initDefaults(db);
        } catch (error) {
            console.warn('Ошибка загрузки базы данных роутеров:', error);
            initDefaults({ defaultsCommon: [], models: [] });
        }
        
        initPing();
        initTools();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();


