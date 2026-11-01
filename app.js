import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY, GOOGLE_CLIENT_ID } from './config.js';

const db = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const $ = id => document.getElementById(id);
const MAX_FILE = 50 * 1024 * 1024;
const AUTO_KEY = 'codeqDrop.autoCopy';

const D = {
    ru: {
        w_h1a: 'Отправьте себе.', w_h1b: 'Без мессенджера.',
        lead: 'Ссылка, текст или файл с телефона на компьютер за секунду. Никакого «Избранного», писем самому себе и заметок вроде «статья, потом прочитать».',
        f1: 'Мгновенно', f1d: 'Запись приходит на другое устройство, пока вы тянетесь за ним. Страницу обновлять не нужно.',
        f2: 'Самоуничтожение', f2d: 'Таймер или режим «один раз». Пароль от Wi-Fi не должен жить вечно.',
        f3: 'Автокопирование', f3d: 'Включите, и всё входящее само попадёт в буфер обмена. Останется нажать Ctrl+V.',
        f4: 'Превью', f4d: 'Картинки видно сразу, у ссылок есть значок сайта. Файлы до 50 МБ.',
        f5: 'Меню «Поделиться»', f5d: 'Установите приложение и отправляйте прямо из браузера или галереи (Android и компьютер).',
        f6: 'Только ваше', f6d: 'Записи видите только вы. Файлы лежат в закрытом хранилище и отдаются по временной ссылке.',
        dm_k: 'попробуйте', dm_t: 'Отправьте с «телефона», заберите на «компьютере»', dm_d: 'Это демонстрация: напишите что-нибудь или выберите пример. Попробуйте режим «Один раз»: запись исчезнет после копирования. Ничего не сохраняется.',
        dm_a: 'Телефон', dm_b: 'Компьютер', dm_ph: 'Что отправить?', dm_c1: 'Ссылка', dm_c2: 'Пароль', dm_c3: 'Фото',
        a_k: 'простая авторизация', a_t: 'Два клика до первой записи', a_d: 'Выберите провайдера: аккаунт будет создан сам, если вы здесь впервые.',
        agree: 'Продолжая, вы соглашаетесь с', terms_l: 'условиями использования', and: 'и', privacy_l: 'политикой конфиденциальности',
        foot_terms: 'Условия использования', foot_priv: 'Политика конфиденциальности',
        new_t: 'Новая запись', list_t: 'Мои записи', ph: 'Вставьте текст или ссылку', file: 'Файл', send: 'Отправить',
        keep: 'Хранить', t1h: '1 ч', t1d: '1 д', tonce: 'Один раз', auto: 'Копировать входящее',
        fl_t: 'Разделы', fl_all: 'Все записи', fl_text: 'Текст', fl_link: 'Ссылки', fl_file: 'Файлы', fl_pin: 'Закреплённые',
        q_ph: 'Найти запись', dv_t: 'Устройства', dv_e: 'Пока никого',
        st_t: 'Статистика', st_n: 'записей', st_s: 'в файлах',
        kb_t: 'Горячие клавиши', k_search: 'Поиск', k_send: 'Отправить', k_paste: 'Файл или скриншот', k_esc: 'Сбросить поиск',
        tip_t: 'Совет', tip_d: 'Установите приложение: тогда «Поделиться» появится прямо в системном меню (Android и компьютер).',
        drop_t: 'Отпустите, чтобы отправить',
        empty: 'Пока пусто. Всё, что вы отправите, появится здесь.', nores: 'Ничего не найдено.',
        copied: 'Скопировано', autocopied: 'Новая запись скопирована в буфер', big: 'Файл больше 50 МБ',
        err: 'Не удалось отправить. Попробуйте ещё раз.', state: 'Не удалось проверить вход. Попробуйте ещё раз.',
        now: 'только что', m_min: '2 мин назад', m_hour: '1 ч назад', once: 'один раз',
        th_light: 'Светлая тема', th_dark: 'Тёмная тема', th_system: 'Системная тема', o_light: 'Светлая', o_dark: 'Тёмная', o_system: 'Системная'
    },
    en: {
        w_h1a: 'Send it to yourself.', w_h1b: 'No messenger.',
        lead: 'A link, text or file from your phone to your computer in a second. No “Saved messages”, no emails to yourself, no notes like “article, read later”.',
        f1: 'Instant', f1d: 'It reaches your other device while you are still reaching for it. No refreshing.',
        f2: 'Self-destruct', f2d: 'A timer or “once” mode. A Wi-Fi password should not live forever.',
        f3: 'Auto-copy', f3d: 'Turn it on and everything incoming lands in your clipboard. Just press Ctrl+V.',
        f4: 'Previews', f4d: 'Images show up right away, links get the site icon. Files up to 50 MB.',
        f5: 'Share menu', f5d: 'Install the app and send straight from your browser or gallery (Android and desktop).',
        f6: 'Only yours', f6d: 'Only you can see your drops. Files sit in a private bucket and are served by temporary links.',
        dm_k: 'try it', dm_t: 'Send from the “phone”, pick up on the “computer”', dm_d: 'This is a demo: type something or pick an example. Try “Once”: the drop disappears after you copy it. Nothing is saved.',
        dm_a: 'Phone', dm_b: 'Computer', dm_ph: 'What to send?', dm_c1: 'Link', dm_c2: 'Password', dm_c3: 'Photo',
        a_k: 'simple sign-in', a_t: 'Two clicks to your first drop', a_d: 'Pick a provider: your account is created automatically if you are new here.',
        agree: 'By continuing, you agree to the', terms_l: 'Terms of Use', and: 'and', privacy_l: 'Privacy Policy',
        foot_terms: 'Terms of Use', foot_priv: 'Privacy Policy',
        new_t: 'New drop', list_t: 'My drops', ph: 'Paste text or a link', file: 'File', send: 'Send',
        keep: 'Keep for', t1h: '1 h', t1d: '1 d', tonce: 'Once', auto: 'Copy incoming',
        fl_t: 'Sections', fl_all: 'All drops', fl_text: 'Text', fl_link: 'Links', fl_file: 'Files', fl_pin: 'Pinned',
        q_ph: 'Find a drop', dv_t: 'Devices', dv_e: 'Nobody yet',
        st_t: 'Statistics', st_n: 'drops', st_s: 'in files',
        kb_t: 'Shortcuts', k_search: 'Search', k_send: 'Send', k_paste: 'File or screenshot', k_esc: 'Clear search',
        tip_t: 'Tip', tip_d: 'Install the app and the share menu shows up in your system (Android and desktop).',
        drop_t: 'Drop to send',
        empty: 'Nothing here yet. Whatever you send will appear here.', nores: 'Nothing found.',
        copied: 'Copied', autocopied: 'New drop copied to clipboard', big: 'File is larger than 50 MB',
        err: 'Could not send. Please try again.', state: 'Could not verify the sign-in. Please try again.',
        now: 'just now', m_min: '2 min ago', m_hour: '1 h ago', once: 'once',
        th_light: 'Light theme', th_dark: 'Dark theme', th_system: 'System theme', o_light: 'Light', o_dark: 'Dark', o_system: 'System'
    }
};
const LANG_KEY = 'codeqDrop.lang';
const THEME_KEY = 'codeqDrop.theme';
const LANG_NAMES = { ru: 'Русский', en: 'English' };
const ICONS = { light: 'bx-sun', dark: 'bx-moon', system: 'bx-desktop' };
const store = {
    get: k => { try { return localStorage.getItem(k); } catch { return null; } },
    set: (k, v) => { try { localStorage.setItem(k, v); } catch { } }
};

let lang = store.get(LANG_KEY);
if (!D[lang]) lang = (navigator.language || 'en').startsWith('ru') ? 'ru' : 'en';
let themePref = store.get(THEME_KEY);
if (!ICONS[themePref]) themePref = 'system';
let rtf = new Intl.RelativeTimeFormat(lang, { numeric: 'auto' });
const t = k => D[lang][k];
const mq = matchMedia('(prefers-color-scheme: dark)');

const controlsHtml = `
<div class="theme-menu">
    <button type="button" class="ctl" data-act="lang"><i class="bx bx-globe"></i><span class="ctl-label"><span data-ctl="lang"></span></span></button>
    <button type="button" class="ctl" data-act="theme"><i class="bx" data-ctl="icon"></i><span class="ctl-label"><span data-ctl="theme"></span></span></button>
    <div class="theme-menu-list">
        ${['light', 'dark', 'system'].map(k => `<button type="button" class="opt" data-theme-choice="${k}"><i class="bx ${ICONS[k]}"></i><span data-ctl="o_${k}"></span><i class="bx bx-check ck"></i></button>`).join('')}
    </div>
</div>`;

function paintControls() {
    document.querySelectorAll('[data-ctl="lang"]').forEach(n => { n.textContent = LANG_NAMES[lang]; });
    document.querySelectorAll('[data-ctl="theme"]').forEach(n => { n.textContent = t('th_' + themePref); });
    document.querySelectorAll('[data-ctl="icon"]').forEach(n => { n.className = 'bx ' + ICONS[themePref]; });
    ['light', 'dark', 'system'].forEach(k => {
        document.querySelectorAll(`[data-ctl="o_${k}"]`).forEach(n => { n.textContent = t('o_' + k); });
    });
    document.querySelectorAll('[data-theme-choice]').forEach(b => {
        b.classList.toggle('on', b.dataset.themeChoice === themePref);
    });
}

function applyLang() {
    rtf = new Intl.RelativeTimeFormat(lang, { numeric: 'auto' });
    document.documentElement.lang = lang;
    document.querySelectorAll('[data-i]').forEach(n => { n.textContent = t(n.dataset.i); });
    document.querySelectorAll('[data-ip]').forEach(n => { n.placeholder = t(n.dataset.ip); });
    document.querySelectorAll('[data-phi]').forEach(n => { n.dataset.ph = t(n.dataset.phi); });
    paintControls();
    render();
}

function applyTheme() {
    const dark = themePref === 'dark' || (themePref === 'system' && mq.matches);
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    paintControls();
}

let uid = null;
let items = [];
let ttl = '';
let autoCopy = false;
let gState = '';
const mine = new Set();
const thumbs = {};
const seen = new Set();
let enterTimer = null;
let filter = 'all';
let query = '';

try { autoCopy = localStorage.getItem(AUTO_KEY) === '1'; } catch (e) { }
$('auto').setAttribute('aria-checked', String(autoCopy));

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const size = n => !n ? '0 KB' : n < 1048576 ? Math.max(1, Math.round(n / 1024)) + ' KB' : (n / 1048576).toFixed(1) + ' MB';
const isImage = i => i.kind === 'file' && /\.(png|jpe?g|gif|webp|avif|svg)$/i.test(i.content);
const hostOf = u => { try { return new URL(u).hostname; } catch { return ''; } };

function device() {
    const u = navigator.userAgent;
    if (/iPhone/.test(u)) return 'iPhone';
    if (/iPad/.test(u)) return 'iPad';
    if (/Android/.test(u)) return 'Android';
    if (/Mac/.test(u)) return 'Mac';
    if (/Windows/.test(u)) return 'Windows';
    if (/Linux/.test(u)) return 'Linux';
    return 'Web';
}

function ago(iso) {
    const s = (new Date(iso) - Date.now()) / 1000;
    const a = Math.abs(s);
    if (a < 45) return t('now');
    if (a < 3600) return rtf.format(Math.round(s / 60), 'minute');
    if (a < 86400) return rtf.format(Math.round(s / 3600), 'hour');
    return rtf.format(Math.round(s / 86400), 'day');
}

function note(text) {
    const el = $('msg');
    el.textContent = text;
    el.classList.add('show');
    clearTimeout(note.timer);
    note.timer = setTimeout(() => el.classList.remove('show'), 2600);
}

function loadThumb(row) {
    thumbs[row.id] = '';
    db.storage.from('drops').createSignedUrl(row.file_path, 3600).then(({ data }) => {
        if (data) {
            thumbs[row.id] = data.signedUrl;
            render();
        }
    });
}

const devIcon = d => /iPhone|iPad|Android/.test(d) ? 'bx-mobile' : /Mac|Windows|Linux/.test(d) ? 'bx-laptop' : 'bx-globe';

function setNum(el, to) {
    const from = Number(el.textContent) || 0;
    if (from === to) return;
    const start = performance.now();
    const step = now => {
        const p = Math.min(1, (now - start) / 400);
        el.textContent = Math.round(from + (to - from) * p);
        if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
}

function visible() {
    const q = query.trim().toLowerCase();
    return items
        .filter(i => filter === 'all' || (filter === 'pinned' ? i.pinned : i.kind === filter))
        .filter(i => !q || i.content.toLowerCase().includes(q) || (i.device || '').toLowerCase().includes(q))
        .sort((a, b) => (Number(!!b.pinned) - Number(!!a.pinned)) || b.created_at.localeCompare(a.created_at));
}

function paintSide() {
    const c = { all: items.length, text: 0, link: 0, file: 0, pinned: 0 };
    const dev = {};
    let bytes = 0;
    items.forEach(i => {
        c[i.kind]++;
        if (i.pinned) c.pinned++;
        bytes += i.file_size || 0;
        const d = i.device || 'Web';
        dev[d] = dev[d] || { n: 0, last: i.created_at };
        dev[d].n++;
        if (i.created_at > dev[d].last) dev[d].last = i.created_at;
    });
    Object.keys(c).forEach(k => { $('c_' + k).textContent = c[k]; });
    setNum($('stN'), items.length);
    $('stS').textContent = size(bytes);
    const rows = Object.entries(dev).sort((a, b) => b[1].last.localeCompare(a[1].last));
    $('devices').innerHTML = rows.length
        ? rows.map(([d, v]) => `<li><i class="bx ${devIcon(d)}"></i><span>${esc(d)}</span><small>${v.n} · ${ago(v.last)}</small></li>`).join('')
        : `<li><span class="muted">${t('dv_e')}</span></li>`;
}

function render() {
    const list = visible();
    $('empty').hidden = list.length > 0;
    $('empty').textContent = t(items.length ? 'nores' : 'empty');
    let n = 0;
    $('list').innerHTML = list.map(i => {
        const host = i.kind === 'link' ? hostOf(i.content) : '';
        const icon = i.kind === 'file' ? 'bx-file' : i.kind === 'link' ? 'bx-link' : 'bx-text';
        const lead = host
            ? `<img class="fav" src="https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=64" alt="">`
            : `<i class="bx ${icon}"></i>`;
        const main = i.kind === 'link'
            ? `<a href="${esc(i.content)}" target="_blank" rel="noopener">${esc(i.content)}</a>`
            : `<span class="${i.kind}">${esc(i.content)}</span>`;
        if (isImage(i) && !(i.id in thumbs)) loadThumb(i);
        const img = thumbs[i.id] ? `<img class="thumb" src="${thumbs[i.id]}" alt="">` : '';
        const life = i.burn ? t('once') : i.expires_at ? ago(i.expires_at) : '';
        const meta = [i.device, ago(i.created_at), i.file_size ? size(i.file_size) : '', life].filter(Boolean).join(' · ');
        const act = i.kind === 'file'
            ? '<button class="icon-btn" data-a="dl"><i class="bx bx-download"></i></button>'
            : '<button class="icon-btn" data-a="copy"><i class="bx bx-copy"></i></button>';
        const pin = `<button class="icon-btn ${i.pinned ? 'on' : ''}" data-a="pin"><i class="bx ${i.pinned ? 'bxs-pin' : 'bx-pin'}"></i></button>`;
        const cls = seen.has(i.id) ? '' : ` class="enter" style="--n:${Math.min(n++, 12)}"`;
        return `<li data-id="${i.id}"${cls}>${lead}<div class="body">${main}${img}<small>${esc(meta)}</small></div><div class="acts">${pin}${act}<button class="icon-btn" data-a="del"><i class="bx bx-trash"></i></button></div></li>`;
    }).join('');
    list.forEach(i => seen.add(i.id));
    paintSide();
}

function put(row) {
    if (items.some(i => i.id === row.id)) return;
    items.push(row);
    items.sort((a, b) => b.created_at.localeCompare(a.created_at));
    render();
}

async function remove(row) {
    const li = document.querySelector(`#list li[data-id="${row.id}"]`);
    if (li) {
        li.style.height = li.offsetHeight + 'px';
        li.offsetHeight;
        li.classList.add('leaving');
        await new Promise(r => setTimeout(r, 280));
    }
    items = items.filter(i => i.id !== row.id);
    render();
    if (row.file_path) await db.storage.from('drops').remove([row.file_path]);
    await db.from('drops').delete().eq('id', row.id);
}

async function purge() {
    const now = Date.now();
    for (const r of items.filter(i => i.expires_at && new Date(i.expires_at) < now)) await remove(r);
}

function life() {
    if (ttl === 'burn') return { burn: true };
    if (ttl) return { expires_at: new Date(Date.now() + Number(ttl) * 1000).toISOString() };
    return {};
}

async function add(row) {
    const { data, error } = await db.from('drops').insert({ ...row, ...life(), device: device() }).select().single();
    if (error) return note(t('err'));
    mine.add(data.id);
    put(data);
}

async function sendText(text) {
    text = (text || '').trim();
    if (!uid || !text) return;
    await add({ kind: /^https?:\/\/\S+$/i.test(text) ? 'link' : 'text', content: text });
}

async function sendFile(file) {
    if (!uid) return;
    if (file.size > MAX_FILE) return note(t('big'));
    const path = `${uid}/${crypto.randomUUID()}`;
    const { error } = await db.storage.from('drops').upload(path, file, { contentType: file.type || 'application/octet-stream' });
    if (error) return note(t('err'));
    await add({ kind: 'file', content: file.name, file_path: path, file_size: file.size });
}

async function load() {
    const { data } = await db.from('drops').select('*').order('created_at', { ascending: false }).limit(100);
    items = data || [];
    render();
    purge();
}

function listen() {
    db.channel('drops')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'drops' }, p => {
            if (p.eventType === 'INSERT') {
                put(p.new);
                if (autoCopy && !mine.has(p.new.id) && p.new.kind !== 'file') {
                    navigator.clipboard.writeText(p.new.content).then(() => note(t('autocopied'))).catch(() => { });
                }
            }
            if (p.eventType === 'UPDATE') {
                items = items.map(i => i.id === p.new.id ? p.new : i);
                render();
            }
            if (p.eventType === 'DELETE') {
                items = items.filter(i => i.id !== p.old.id);
                render();
            }
        })
        .subscribe();
}

async function takeShared() {
    const cache = await caches.open('drop-share');
    for (const req of await cache.keys()) {
        const res = await cache.match(req);
        await cache.delete(req);
        if (req.url.endsWith('/shared-text')) {
            await sendText(await res.text());
        }
        else {
            const blob = await res.blob();
            const name = decodeURIComponent(res.headers.get('x-name') || 'file');
            await sendFile(new File([blob], name, { type: blob.type }));
        }
    }
}

async function boot(session) {
    if (!session) {
        uid = null;
        items = [];
        db.removeAllChannels();
        $('app').hidden = true;
        $('auth').hidden = false;
        document.documentElement.classList.remove('auth-pending');
        return;
    }
    if (uid === session.user.id) return;
    uid = session.user.id;
    $('auth').hidden = true;
    $('app').hidden = false;
    document.documentElement.classList.remove('auth-pending');
    playAppEnter();
    $('who').textContent = session.user.email || '';
    await load();
    listen();
    await takeShared();
}

db.auth.onAuthStateChange((_event, session) => { boot(session); });

const back = location.origin + location.pathname;
const oauth = provider => db.auth.signInWithOAuth({ provider, options: { redirectTo: back } });

// Google: popup Google Identity Services -> code -> Edge Function -> ID token -> Supabase.
// Если popup заблокирован, скрипт Google не загрузился или функция недоступна, идёт обычный Supabase OAuth.
function googleLogin() {
    const gsi = window.google?.accounts?.oauth2;
    if (!gsi || !GOOGLE_CLIENT_ID) return oauth('google');

    gState = crypto.randomUUID();
    const expected = gState;

    gsi.initCodeClient({
        client_id: GOOGLE_CLIENT_ID,
        scope: 'openid email profile',
        ux_mode: 'popup',
        state: expected,
        callback: async res => {
            if (res.error || !res.code) return;
            if (res.state !== expected || gState !== expected) {
                $('hint').textContent = t('state');
                return;
            }
            gState = '';
            try {
                const r = await fetch(`${SUPABASE_URL}/functions/v1/google-code`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ code: res.code })
                });
                const j = await r.json();
                if (!r.ok || !j.id_token) throw new Error('exchange');
                const { error } = await db.auth.signInWithIdToken({ provider: 'google', token: j.id_token });
                if (error) throw error;
            }
            catch {
                oauth('google');
            }
        },
        error_callback: e => {
            if (e?.type === 'popup_failed_to_open') oauth('google');
        }
    }).requestCode();
}

document.querySelectorAll('[data-provider]').forEach(b => {
    b.onclick = () => (b.dataset.provider === 'google' ? googleLogin() : oauth(b.dataset.provider));
});

$('out').onclick = () => db.auth.signOut();
$('pick').onclick = () => $('file').click();
$('file').onchange = async e => {
    for (const f of e.target.files) await sendFile(f);
    e.target.value = '';
};
$('send').onclick = async () => {
    const v = $('text').value;
    $('text').value = '';
    await sendText(v);
};
$('text').addEventListener('keydown', e => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) $('send').click();
});

$('ttl').addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    ttl = b.dataset.ttl;
    [...$('ttl').children].forEach(x => x.classList.toggle('on', x === b));
});

$('auto').onclick = () => {
    autoCopy = !autoCopy;
    $('auto').setAttribute('aria-checked', String(autoCopy));
    try { localStorage.setItem(AUTO_KEY, autoCopy ? '1' : '0'); } catch (e) { }
};

document.addEventListener('paste', e => {
    const files = [...(e.clipboardData?.files || [])];
    if (!files.length) return;
    e.preventDefault();
    files.forEach(sendFile);
});
let dragDepth = 0;
const hideDrop = () => { dragDepth = 0; $('drop').classList.remove('on'); };
addEventListener('dragenter', e => {
    if (!uid || !e.dataTransfer?.types?.includes('Files')) return;
    dragDepth++;
    $('drop').classList.add('on');
});
addEventListener('dragleave', () => { if (--dragDepth <= 0) hideDrop(); });
addEventListener('dragover', e => e.preventDefault());
addEventListener('drop', e => {
    e.preventDefault();
    hideDrop();
    [...e.dataTransfer.files].forEach(sendFile);
});
document.addEventListener('visibilitychange', () => { if (!document.hidden && uid) load(); });
setInterval(() => { purge(); render(); }, 30000);

$('list').addEventListener('click', async e => {
    const li = e.target.closest('li');
    const row = li && items.find(i => i.id === li.dataset.id);
    if (!row) return;

    if (e.target.closest('a')) {
        if (row.burn) setTimeout(() => remove(row), 500);
        return;
    }

    const b = e.target.closest('button');
    if (!b) return;

    if (b.dataset.a === 'copy') {
        await navigator.clipboard.writeText(row.content);
        note(t('copied'));
        if (row.burn) remove(row);
    }
    if (b.dataset.a === 'dl') {
        const { data } = await db.storage.from('drops').createSignedUrl(row.file_path, 60, { download: row.content });
        if (data) location.href = data.signedUrl;
        if (row.burn) setTimeout(() => remove(row), 3000);
    }
    if (b.dataset.a === 'pin') {
        row.pinned = !row.pinned;
        render();
        await db.from('drops').update({ pinned: row.pinned }).eq('id', row.id);
    }
    if (b.dataset.a === 'del') remove(row);
});

mq.addEventListener('change', () => { if (themePref === 'system') applyTheme(); });

document.addEventListener('click', e => {
    const langBtn = e.target.closest('[data-act="lang"]');
    const themeBtn = e.target.closest('[data-act="theme"]');
    const choice = e.target.closest('[data-theme-choice]');
    const own = themeBtn && themeBtn.closest('.theme-menu');

    document.querySelectorAll('.theme-menu.open').forEach(m => { if (m !== own) m.classList.remove('open'); });

    if (langBtn) {
        lang = lang === 'ru' ? 'en' : 'ru';
        store.set(LANG_KEY, lang);
        applyLang();
    }
    if (themeBtn) own.classList.toggle('open');
    if (choice) {
        themePref = choice.dataset.themeChoice;
        store.set(THEME_KEY, themePref);
        applyTheme();
        choice.closest('.theme-menu').classList.remove('open');
    }
});

document.addEventListener('keydown', e => {
    if (e.key === 'Escape') document.querySelectorAll('.theme-menu.open').forEach(m => m.classList.remove('open'));
});

$('newBtn').onclick = () => { $('text').focus(); $('text').scrollIntoView({ block: 'center', behavior: 'smooth' }); };

$('filters').addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    filter = b.dataset.f;
    [...$('filters').children].forEach(x => x.classList.toggle('on', x === b));
    render();
});

$('q').addEventListener('input', e => { query = e.target.value; render(); });

document.addEventListener('keydown', e => {
    const typing = /^(INPUT|TEXTAREA)$/.test(document.activeElement.tagName);
    if (e.key === '/' && !typing && uid) {
        e.preventDefault();
        $('q').focus();
    }
    if (e.key === 'Escape' && document.activeElement === $('q')) {
        $('q').value = '';
        query = '';
        $('q').blur();
        render();
    }
});

// демо на welcome-странице: «телефон» отправляет, «компьютер» принимает
const demo = { ttl: '', auto: true };
const demoFeed = $('demoFeed');

function demoToast(text) {
    const toast = $('demoToast');
    toast.textContent = text;
    toast.classList.add('show');
    clearTimeout(demoToast.timer);
    demoToast.timer = setTimeout(() => toast.classList.remove('show'), 1800);
}

function demoSend(kind, content) {
    const life = demo.ttl === 'burn' ? ` · <span data-i="once">${t('once')}</span>` : demo.ttl === '3600' ? ` · <span data-i="t1h">${t('t1h')}</span>` : '';
    const icon = kind === 'file' ? 'bx-image' : kind === 'link' ? 'bx-link' : 'bx-text';
    const li = document.createElement('li');
    li.className = 'dm-row enter';
    if (demo.ttl === 'burn') li.dataset.burn = '1';
    li.innerHTML = `<i class="bx ${icon}"></i><div><b>${esc(content)}</b>${kind === 'file' ? '<div class="fake"></div>' : ''}<small>iPhone · <span data-i="now">${t('now')}</span>${life}</small></div><button class="icon-btn" data-dm="copy"><i class="bx bx-copy"></i></button>`;
    demoFeed.prepend(li);
    while (demoFeed.children.length > 4) demoFeed.lastElementChild.remove();
    const arrow = $('demoArrow');
    arrow.classList.remove('tick');
    void arrow.offsetWidth;
    arrow.classList.add('tick');
    if (demo.auto && kind !== 'file') demoToast(t('autocopied'));
}

const demoSamples = { link: 'https://www.figma.com/design/k3Xq-handoff', pass: 'wi-fi: sunny-fox-4417' };

document.querySelectorAll('[data-chip]').forEach(b => {
    b.onclick = () => {
        if (b.dataset.chip === 'photo') return demoSend('file', 'IMG_2042.jpg');
        $('demoIn').value = demoSamples[b.dataset.chip];
        $('demoIn').focus();
    };
});

$('demoSend').onclick = () => {
    const text = $('demoIn').value.trim();
    if (!text) return $('demoIn').focus();
    demoSend(/^https?:\/\/\S+$/i.test(text) ? 'link' : 'text', text);
    $('demoIn').value = '';
};
$('demoIn').addEventListener('keydown', e => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) $('demoSend').click();
});
$('demoTtl').addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    demo.ttl = b.dataset.ttl;
    [...$('demoTtl').children].forEach(x => x.classList.toggle('on', x === b));
});
$('demoAuto').onclick = () => {
    demo.auto = !demo.auto;
    $('demoAuto').setAttribute('aria-checked', String(demo.auto));
};
demoFeed.addEventListener('click', e => {
    const b = e.target.closest('[data-dm="copy"]');
    if (!b) return;
    const li = b.closest('li');
    demoToast(t('copied'));
    if (li.dataset.burn) {
        li.classList.remove('enter');
        li.classList.add('out');
        setTimeout(() => li.remove(), 600);
    }
});

// стеклянные панели при прокрутке и переход в приложение, как в заметках
const onScroll = () => {
    $('auth').classList.toggle('scrolled', scrollY > 8);
    $('topbar').classList.toggle('scrolled', $('main').scrollTop > 8 || scrollY > 8);
};
addEventListener('scroll', onScroll, { passive: true });
$('main').addEventListener('scroll', onScroll, { passive: true });

function playAppEnter() {
    const b = document.body;
    b.classList.remove('app-enter');
    void b.offsetWidth;
    b.classList.add('app-enter');
    clearTimeout(enterTimer);
    enterTimer = setTimeout(() => b.classList.remove('app-enter'), 1400);
}

const reveal = new IntersectionObserver(entries => entries.forEach(en => {
    if (en.isIntersecting) {
        en.target.classList.add('in');
        reveal.unobserve(en.target);
    }
}), { threshold: 0.12 });
document.querySelectorAll('.rv').forEach(n => reveal.observe(n));

// стартовая отрисовка: после объявления всех функций и констант
document.querySelectorAll('[data-controls]').forEach(n => { n.innerHTML = controlsHtml; });
applyLang();
applyTheme();
