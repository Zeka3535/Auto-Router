// Простая система i18n на JSON-файлах. Комментарии — на русском.

(() => {
    const I18N = {
        lang: 'ru',
        dict: {},
        loaded: new Set(),
    };

    function getStoredLang() {
        try { return localStorage.getItem('lang:v1'); } catch { return null; }
    }

    function detectLang() {
        const stored = getStoredLang();
        if (stored) return stored;
        const nav = (navigator.language || 'ru').slice(0, 2);
        return ['ru','en'].includes(nav) ? nav : 'ru';
    }

    async function loadLang(lang) {
        const url = `./i18n/${lang}.json`;
        const res = await fetch(url);
        if (!res.ok) throw new Error('i18n-load-failed');
        return res.json();
    }

    function applyI18n() {
        const elements = document.querySelectorAll('[data-i18n]');
        elements.forEach(el => {
            const key = el.getAttribute('data-i18n');
            const txt = I18N.dict[key];
            if (typeof txt === 'string') el.textContent = txt;
        });
        const attrMaps = [
            { selector: '[data-i18n-title]', attr: 'title', keyAttr: 'data-i18n-title' },
            { selector: '[data-i18n-aria]', attr: 'aria-label', keyAttr: 'data-i18n-aria' },
            { selector: '[data-i18n-placeholder]', attr: 'placeholder', keyAttr: 'data-i18n-placeholder' }
        ];
        attrMaps.forEach(({ selector, attr, keyAttr }) => {
            document.querySelectorAll(selector).forEach(el => {
                const key = el.getAttribute(keyAttr);
                const txt = I18N.dict[key];
                if (typeof txt === 'string') el.setAttribute(attr, txt);
            });
        });
    }

    async function setLang(lang) {
        I18N.lang = lang;
        try { localStorage.setItem('lang:v1', lang); } catch {}
        I18N.dict = await loadLang(lang);
        applyI18n();
        updateLangControls(lang);
    }

    async function initI18n() {
        const lang = detectLang();
        await setLang(lang);
        initLangMenu();
    }

    // Экспорт в глобальную область (аккуратно)
    function updateLangControls(lang) {
        const toggle = document.getElementById('lang-toggle');
        if (toggle) toggle.dataset.lang = lang;
        const label = document.querySelector('.lang-btn-label');
        if (label) label.textContent = lang === 'ru' ? 'RU' : 'EN';
        document.querySelectorAll('#lang-menu button[data-lang]').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.lang === lang);
        });
    }

    function initLangMenu() {
        const toggle = document.getElementById('lang-toggle');
        const menu = document.getElementById('lang-menu');
        if (!toggle || !menu) return;

        function openMenu() {
            menu.hidden = false;
            toggle.setAttribute('aria-expanded', 'true');
        }

        function closeMenu() {
            menu.hidden = true;
            toggle.setAttribute('aria-expanded', 'false');
        }

        toggle.addEventListener('click', (evt) => {
            evt.stopPropagation();
            const expanded = toggle.getAttribute('aria-expanded') === 'true';
            expanded ? closeMenu() : openMenu();
        });

        menu.querySelectorAll('button[data-lang]').forEach(btn => {
            btn.addEventListener('click', (evt) => {
                evt.stopPropagation();
                const lang = btn.dataset.lang;
                setLang(lang);
                closeMenu();
            });
        });

        document.addEventListener('click', (evt) => {
            if (!menu.contains(evt.target) && evt.target !== toggle && !toggle.contains(evt.target)) {
                closeMenu();
            }
        });

        closeMenu();
    }

    window.__I18N__ = { setLang, apply: applyI18n, getDict: () => I18N.dict };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initI18n);
    } else {
        initI18n();
    }
})();


