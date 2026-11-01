(() => {
    const get = k => { try { return localStorage.getItem(k); } catch { return null; } };
    const set = (k, v) => { try { localStorage.setItem(k, v); } catch { } };
    const root = document.documentElement;
    const mq = matchMedia('(prefers-color-scheme: dark)');

    const theme = () => {
        const pref = get('codeqDrop.theme') || 'system';
        return pref === 'dark' || (pref === 'system' && mq.matches) ? 'dark' : 'light';
    };
    const pickLang = () => {
        const l = get('codeqDrop.lang');
        if (l === 'ru' || l === 'en') return l;
        return (navigator.language || 'en').startsWith('ru') ? 'ru' : 'en';
    };
    const paint = () => {
        const toggle = document.getElementById('lang');
        const title = document.querySelector('title');
        if (toggle) toggle.textContent = root.lang === 'ru' ? 'English' : 'Русский';
        if (title && title.dataset[root.lang]) document.title = title.dataset[root.lang];
    };

    root.dataset.theme = theme();
    root.lang = pickLang();

    mq.addEventListener('change', () => { root.dataset.theme = theme(); });
    addEventListener('storage', () => {
        root.dataset.theme = theme();
        root.lang = pickLang();
        paint();
    });

    document.addEventListener('DOMContentLoaded', () => {
        paint();
        const head = document.querySelector('.lg-head');
        const glass = () => head && head.classList.toggle('scrolled', scrollY > 8);
        addEventListener('scroll', glass, { passive: true });
        glass();
        const toggle = document.getElementById('lang');
        if (!toggle) return;
        toggle.addEventListener('click', e => {
            e.preventDefault();
            root.lang = root.lang === 'ru' ? 'en' : 'ru';
            set('codeqDrop.lang', root.lang);
            paint();
        });
    });
})();
