import { db } from "./backend.js";
import { auth, login, logout, onUserChanged } from "./auth.js";
import { t, lang, locale, translateDom, setLanguage, LANGUAGE_EVENT } from "./i18n.js";
import { collection, getDocs, setDoc, doc, deleteDoc } from "./database.js";
import {
    createVault,
    unlockVault,
    changeVaultPassword,
    addVaultPasskey,
    unlockVaultWithPasskey,
    removeVaultPasskey,
    passkeysAvailable,
    passkeyPrfSupport,
    encryptJSON,
    decryptJSON
} from "./vault-crypto.js";
(() => {
    'use strict';
    translateDom(document.body);
    const APP_VERSION = '5.10.23';
    const APP_BUILD = new Date(2026, 9, 23);
    function appBuildDate() {
        return APP_BUILD.toLocaleDateString(locale, { day: 'numeric', month: 'long', year: 'numeric' }).replace(' г.', '');
    }
    const THEME_KEY = 'startNotes.theme';
    const FONT_KEY = 'startNotes.fontSize';
    const SEARCH_FILTER_KEY = 'startNotes.searchFilter';
    const TRASH_TTL = 15 * 24 * 60 * 60 * 1000;
    const VALID_SEARCH_FILTERS = new Set(['all', 'title', 'content', 'tags']);
    let searchFilter = 'all';
    try {
        const savedSearchFilter = localStorage.getItem(SEARCH_FILTER_KEY);
        searchFilter = VALID_SEARCH_FILTERS.has(savedSearchFilter) ? savedSearchFilter : 'all';
    }
    catch (e) { }
    let notes = [];
    let trashedNotes = [];
    let otherNotes = [];
    let otherTrash = [];
    let separateBySignIn = false;
    let spaceSettingsPromise = null;
    let activeNoteId = null;
    let isLoading = false;
    let selectedNoteIds = new Set();
    let selectionBarEl = null;
    let bulkDeleteNotificationHide = null;
    const $ = sel => document.querySelector(sel);
    const $$ = sel => Array.from(document.querySelectorAll(sel));
    const el = {
        settingsBtn: $('#settingsBtn'),
        settingsPanel: $('#settingsPanel'),
        closeSettingsBtn: $('#closeSettingsBtn'),
        loginBtn: $('#loginBtn'),
        welcomeScreen: $('#welcomeScreen'),
        welcomeActionArea: $('#welcomeActionArea'),
        newNoteBtn: $('#newNoteBtn'),
        searchInput: $('#searchInput'),
        pinnedHeader: $('#pinnedHeader'),
        pinnedBody: $('#pinnedBody'),
        pinnedNotes: $('#pinnedNotes'),
        pinnedCount: $('#pinnedCount'),
        allNotesCount: $('#allNotesCount'),
        notesList: $('#notesList'),
        noteTitle: $('#noteTitle'),
        fullscreenBtn: $('#fullscreenBtn'),
        fullscreenIcon: $('#fullscreenBtn img'),
        pinNoteBtn: $('#pinNoteBtn'),
        secretNoteBtn: $('#secretNoteBtn'),
        deleteNoteBtn: $('#deleteNoteBtn'),
        noteContent: $('#noteContent'),
        addTagBtn: $('#addTagBtn'),
        noteTags: $('#noteTags'),
        fontSize: $('#fontSize'),
        fontPreview: $('#fontPreview'),
        themeOptions: $$('.theme-option[data-theme]'),
        formatButtons: $$('.toolbar-group [data-action]'),
        codeBtn: $('#codeBtn'),
        sidebar: $('.sidebar'),
        trashHeader: $('#trashHeader'),
        trashList: $('#trashList'),
        trashCount: $('#trashCount'),
        body: document.body,
        h1Btn: $('#h1Btn'),
        h2Btn: $('#h2Btn'),
        h3Btn: $('#h3Btn'),
        quoteBtn: $('#quote'),
        listULBtn: $('#listUL'),
        underlineBtns: $$('[data-underline-style]'),
        strikeBtn: $('#strikeBtn'),
        listOLBtn: $('#listOL'),
        checklistBtn: $('#checklistBtn'),
        linkBtn: $('#link'),
        tableBtn: $('#tableBtn'),
        formulaBtn: $('#formulaBtn'),
        findHeaderBtn: $('#findHeaderBtn'),
        findBar: $('#findBar'),
        findInput: $('#findInput'),
        findCount: $('#findCount'),
        findCaseBtn: $('#findCaseBtn'),
        findPrevBtn: $('#findPrevBtn'),
        findNextBtn: $('#findNextBtn'),
        findCloseBtn: $('#findCloseBtn'),
        replaceInput: $('#replaceInput'),
        replaceBtn: $('#replaceBtn'),
        replaceAllBtn: $('#replaceAllBtn'),
        linkToolbarSection: $('#linkToolbarSection'),
        searchFilterBtn: $('#searchFilterBtn'),
        noteSaveStatus: $('#noteSaveStatus'),
        noteSaveRetry: $('#noteSaveRetry'),
        saveStatusToggle: $('#saveStatusToggle'),
        googleSansBtn: $('#googleSansBtn'),
        googleSansToggle: $('#googleSansToggle'),
        spaceSetting: $('#spaceSetting'),
        spaceToggle: $('#spaceToggle'),
        spaceCurrent: $('#spaceCurrent'),
        secretSection: $('#secretSection'),
        secretList: $('#secretList'),
        secretCount: $('#secretCount'),
        secretLockBtn: $('#secretLockBtn'),
        secretHeader: $('#secretHeader'),
        secretBody: $('#secretBody'),
        allNotesHeader: $('#allNotesHeader'),
        allNotesBody: $('#allNotesBody'),
        secretBadge: $('#secretBadge'),
    };
    let currentUser = null;
    let vaultKey = null;
    let vaultMeta = null;
    let vaultMetaLoaded = false;
    let autoLockTimer = null;
    let activeVaultModal = null;
    let passkeySupport = passkeysAvailable();
    const PASSKEY_PRF_KEY = 'startNotes.passkeyPrf';
    function canUsePasskey() {
        return !!(passkeySupport && vaultMeta && vaultMeta.v === 2 && vaultMeta.prfSalt &&
            Array.isArray(vaultMeta.passkeys) && vaultMeta.passkeys.length);
    }
    let authErrorNotification = null;
    const AUTO_LOCK_KEY = 'startNotes.autoLock';
    const AUTO_LOCK_DEFAULT = { enabled: true, minutes: 5 };
    const AUTO_LOCK_PRESETS = [1, 5, 15, 30, 60, 240, 1440];
    function nearestAutoLockPreset(minutes) {
        return AUTO_LOCK_PRESETS.reduce((best, value) => (Math.abs(value - minutes) < Math.abs(best - minutes) ? value : best));
    }
    function loadAutoLockSettings() {
        try {
            const raw = JSON.parse(localStorage.getItem(AUTO_LOCK_KEY));
            if (raw && typeof raw === 'object') {
                const minutes = Math.round(Number(raw.minutes));
                return {
                    enabled: raw.enabled !== false,
                    minutes: Number.isFinite(minutes)
                        ? nearestAutoLockPreset(minutes)
                        : AUTO_LOCK_DEFAULT.minutes
                };
            }
        }
        catch (e) { }
        return { ...AUTO_LOCK_DEFAULT };
    }
    let autoLockSettings = loadAutoLockSettings();
    function autoLockMs() {
        return autoLockSettings.minutes * 60 * 1000;
    }
    function saveAutoLockSettings() {
        try {
            localStorage.setItem(AUTO_LOCK_KEY, JSON.stringify(autoLockSettings));
        }
        catch (e) { }
        if (!vaultKey)
            return;
        if (autoLockSettings.enabled)
            scheduleAutoLock(autoLockMs());
        else
            clearTimeout(autoLockTimer);
    }
    function formatDuration(minutes) {
        const h = Math.floor(minutes / 60);
        const m = minutes % 60;
        if (!h)
            return t('{m} мин', { m });
        if (!m)
            return t('{h} ч', { h });
        return t('{h} ч {m} мин', { h, m });
    }
    function updateAutoLockSummary() {
        const value = document.querySelector('#autoLockPicker .autolock-select-value');
        if (value)
            value.textContent = formatDuration(autoLockSettings.minutes);
        document.querySelectorAll('#autoLockPicker [data-minutes]').forEach(option => {
            option.classList.toggle('active', Number(option.dataset.minutes) === autoLockSettings.minutes);
        });
    }
    function setupAutoLockSettings() {
        const toggle = $('#autoLockToggle');
        const body = $('#autoLockBody');
        const picker = $('#autoLockPicker');
        if (!toggle || !body || !picker)
            return;
        const applyToggleState = () => {
            toggle.classList.toggle('active', autoLockSettings.enabled);
            toggle.setAttribute('aria-pressed', String(autoLockSettings.enabled));
            body.classList.toggle('open', autoLockSettings.enabled);
        };
        renderAutoLockPresets();
        let detach = null;
        const close = () => {
            picker.classList.remove('open');
            if (detach) {
                detach();
                detach = null;
            }
        };
        picker.addEventListener('click', e => {
            if (e.target.closest('.autolock-select')) {
                if (picker.classList.contains('open')) {
                    close();
                    return;
                }
                picker.classList.add('open');
                detach = closeMenuOnOutside(picker, close);
                return;
            }
            const option = e.target.closest('[data-minutes]');
            if (!option)
                return;
            autoLockSettings.minutes = Number(option.dataset.minutes);
            saveAutoLockSettings();
            updateAutoLockSummary();
            close();
        });
        applyToggleState();
        toggle.addEventListener('click', () => {
            autoLockSettings.enabled = !autoLockSettings.enabled;
            applyToggleState();
            saveAutoLockSettings();
            if (!autoLockSettings.enabled)
                close();
        });
    }
    function renderAutoLockPresets() {
        const picker = $('#autoLockPicker');
        if (!picker)
            return;
        picker.innerHTML = `
            <button type="button" class="autolock-select">
                <span class="autolock-select-value"></span>
                <span class="autolock-select-arrow"></span>
            </button>
            <div class="theme-menu-list autolock-list">
                ${AUTO_LOCK_PRESETS.map(minutes => `
                    <button type="button" class="theme-menu-option" data-minutes="${minutes}">
                        <span>${formatDuration(minutes)}</span>
                        <span class="theme-menu-check"></span>
                    </button>
                `).join('')}
            </div>
        `;
        updateAutoLockSummary();
    }
    const COLLAPSE_KEY = 'startNotes.collapsed';
    let collapsedSections = {};
    try {
        collapsedSections = JSON.parse(localStorage.getItem(COLLAPSE_KEY)) || {};
    }
    catch (e) { }
    const COLLAPSIBLE_SECTIONS = {
        pinned: () => [el.pinnedHeader, el.pinnedBody],
        secret: () => [el.secretHeader, el.secretBody],
        all: () => [el.allNotesHeader, el.allNotesBody]
    };
    function setSectionCollapsed(name, collapsed) {
        const [header, body] = COLLAPSIBLE_SECTIONS[name]();
        if (!header || !body)
            return;
        collapsedSections[name] = collapsed;
        header.classList.toggle('collapsed', collapsed);
        body.classList.toggle('collapsed', collapsed);
        try {
            localStorage.setItem(COLLAPSE_KEY, JSON.stringify(collapsedSections));
        }
        catch (e) { }
    }
    function expandSection(name) {
        if (collapsedSections[name])
            setSectionCollapsed(name, false);
    }
    function setupCollapsibleSections() {
        Object.keys(COLLAPSIBLE_SECTIONS).forEach(name => {
            const [header, body] = COLLAPSIBLE_SECTIONS[name]();
            if (!header || !body)
                return;
            body.style.transition = 'none';
            setSectionCollapsed(name, !!collapsedSections[name]);
            void body.offsetHeight;
            body.style.transition = '';
            header.addEventListener('click', e => {
                if (e.target.closest('button'))
                    return;
                setSectionCollapsed(name, !collapsedSections[name]);
            });
        });
    }
    function resetVaultState() {
        vaultKey = null;
        vaultMeta = null;
        vaultMetaLoaded = false;
        clearTimeout(autoLockTimer);
        closeVaultModal();
    }
    function firstOpenNoteId() {
        const note = notes.find(n => !n.secret);
        return note ? note.id : null;
    }
    function pickNextNoteId() {
        const open = notes.filter(n => !n.secret);
        if (!open.length)
            return null;
        return [...open].sort((a, b) => b.updatedAt - a.updatedAt)[0].id;
    }
    function normalizeStoredNote(id, data) {
        const note = { id, ...data };
        if (note.secret) {
            note.pinned = false;
            note.title = '';
            note.content = '';
            note.tags = [];
            note.locked = true;
        }
        return note;
    }
    function scrubSecretNote(note) {
        if (!note.secret)
            return;
        note.title = '';
        note.content = '';
        note.tags = [];
        note.locked = true;
    }
    async function hydrateSecretNotes(list) {
        if (!vaultKey)
            return;
        const key = vaultKey;
        await Promise.all(list.map(async (note) => {
            if (!note.secret || !note.locked || !note.enc)
                return;
            try {
                const payload = await decryptJSON(key, note.enc, note.id);
                note.title = String(payload.title || '');
                note.content = String(payload.content || '');
                note.tags = Array.isArray(payload.tags) ? payload.tags.map(String) : [];
                note.locked = false;
            }
            catch (error) {
                console.error('Не удалось расшифровать заметку', note.id);
                scrubSecretNote(note);
            }
        }));
    }
    async function toStoredNote(note) {
        if (!note.secret)
            return note;
        if (!vaultKey || note.locked) {
            throw new Error('vault-locked');
        }
        const stored = {
            id: note.id,
            secret: true,
            pinned: false,
            createdAt: note.createdAt,
            updatedAt: note.updatedAt,
            ...(note.font ? { font: note.font } : {}),
            ...(note.space ? { space: note.space } : {}),
            enc: await encryptJSON(vaultKey, {
                title: note.title || '',
                content: note.content || '',
                tags: Array.isArray(note.tags) ? note.tags : []
            }, note.id)
        };
        if (note.deletedAt)
            stored.deletedAt = note.deletedAt;
        note.enc = stored.enc;
        return stored;
    }
    async function trashWrite(note) {
        await setDoc(doc(db, "users", currentUser.uid, "trash", note.id), await toStoredNote(note));
    }
    async function loadVaultMeta() {
        if (!currentUser) {
            vaultMeta = null;
            vaultMetaLoaded = false;
            return;
        }
        const snapshot = await getDocs(collection(db, "users", currentUser.uid, "vault"));
        const metaDoc = snapshot.docs.find(d => d.id === 'meta');
        vaultMeta = metaDoc ? metaDoc.data() : null;
        vaultMetaLoaded = true;
    }
    async function saveVaultMeta(meta) {
        await setDoc(doc(db, "users", currentUser.uid, "vault", "meta"), meta);
    }
    function showToast(title, text, ms = 4500) {
        const toast = showNotification(`
            <div class="notification-title">${escapeHtml(title)}</div>
            ${text ? `<div class="notification-text">${escapeHtml(text)}</div>` : ''}
        `);
        setTimeout(toast.hide, ms);
        return toast;
    }
    function showAuthErrorNotification() {
        if (authErrorNotification)
            return;
        const { el: n, hide } = showNotification(`
            <div class="notification-title">${t('Нужно войти заново')}</div>
            <div class="notification-text">${t('Сессия истекла или нет доступа к заметкам. Войдите в аккаунт ещё раз.')}</div>
            <div class="notification-actions">
                <button class="notification-cancel" type="button">${t('Закрыть')}</button>
                <button class="notification-confirm" type="button">${t('Войти')}</button>
            </div>
        `);
        n.classList.add('notification-auth');
        authErrorNotification = { el: n, hide };
        const dismiss = () => {
            hide();
            authErrorNotification = null;
        };
        n.querySelector('.notification-cancel').addEventListener('click', dismiss);
        n.querySelector('.notification-confirm').addEventListener('click', () => {
            dismiss();
            openAccountPanel('login', { title: t('Нужно войти заново') });
        });
    }
    function updateSecretBadge(note, inTrash = false) {
        const isSecret = !!(note && note.secret);
        el.secretBadge.hidden = !isSecret;
        el.pinNoteBtn.hidden = !note || isSecret || inTrash;
        el.secretNoteBtn.hidden = !note || isSecret || inTrash;
        el.deleteNoteBtn.hidden = !note || inTrash;
        el.findHeaderBtn.hidden = !note;
    }
    function scheduleAutoLock(ms) {
        clearTimeout(autoLockTimer);
        autoLockTimer = setTimeout(() => lockVault({ auto: true }), ms);
    }
    function bumpAutoLock() {
        if (vaultKey && autoLockSettings.enabled)
            scheduleAutoLock(autoLockMs());
    }
    async function lockVault({ auto = false } = {}) {
        if (!vaultKey)
            return true;
        clearTimeout(autosaveTimer);
        const active = getNote(activeNoteId);
        if (active && active.secret && !active.locked) {
            const saved = await persistActiveNote();
            if (!saved) {
                showToast(t('Хранилище не заблокировано'), t('Не удалось сохранить секретную заметку. Проверьте подключение и попробуйте ещё раз.'), 6000);
                if (auto)
                    scheduleAutoLock(30 * 1000);
                return false;
            }
        }
        const secretWasOpen = !!(active && active.secret) ||
            !!(getTrashedNote(activeNoteId) && getTrashedNote(activeNoteId).secret);
        vaultKey = null;
        clearTimeout(autoLockTimer);
        [notes, trashedNotes, otherNotes, otherTrash].forEach(list => list.forEach(scrubSecretNote));
        document.querySelectorAll('.notification-undo').forEach(btn => {
            const n = btn.closest('.notification');
            if (n)
                n.remove();
        });
        if (secretWasOpen) {
            activeNoteId = pickNextNoteId();
            removeTrashBanner();
            renderEditor();
        }
        renderNotesList();
        renderTrash();
        if (auto) {
            showToast(t('Хранилище заблокировано'), t('Секретные заметки закрыты из-за неактивности.'));
        }
        return true;
    }
    function afterVaultUnlocked() {
        if (autoLockSettings.enabled)
            scheduleAutoLock(autoLockMs());
        renderNotesList();
        renderTrash();
    }
    async function requestUnlock(options = {}) {
        if (vaultKey)
            return true;
        if (!currentUser)
            return false;
        if (!vaultMetaLoaded) {
            try {
                await loadVaultMeta();
            }
            catch (error) {
                handleFirebaseError(error);
                showToast(t('Не удалось открыть хранилище'), t('Проверьте подключение к интернету и попробуйте ещё раз.'));
                return false;
            }
        }
        return openVaultModal(vaultMeta ? 'unlock' : 'setup', options);
    }
    async function resetVault() {
        const uid = currentUser.uid;
        const noteIds = [...notes, ...otherNotes].filter(n => n.secret).map(n => n.id);
        const trashIds = [...trashedNotes, ...otherTrash].filter(n => n.secret).map(n => n.id);
        await Promise.all([
            ...noteIds.map(id => deleteDoc(doc(db, "users", uid, "notes", id))),
            ...trashIds.map(id => deleteDoc(doc(db, "users", uid, "trash", id)))
        ]);
        await deleteDoc(doc(db, "users", uid, "vault", "meta"));
        notes = notes.filter(n => !n.secret);
        trashedNotes = trashedNotes.filter(n => !n.secret);
        otherNotes = otherNotes.filter(n => !n.secret);
        otherTrash = otherTrash.filter(n => !n.secret);
        vaultKey = null;
        vaultMeta = null;
        vaultMetaLoaded = true;
        clearTimeout(autoLockTimer);
        if (!getNote(activeNoteId) && !getTrashedNote(activeNoteId)) {
            activeNoteId = pickNextNoteId();
        }
        removeTrashBanner();
        renderEditor();
        renderNotesList();
        renderTrash();
    }
    function closeVaultModal() {
        if (activeVaultModal)
            activeVaultModal.close(false, false);
    }
    const COMMON_PASSWORDS = new Set([
        '12345678', '123456789', '1234567890', '87654321', '11111111', '00000000',
        '12341234', '11223344', '12121212', '123123123', '11112222', '88888888',
        'password', 'password1', 'password123', 'passw0rd', 'qwerty123', 'qwertyuiop',
        'iloveyou', 'sunshine', 'princess', 'football', 'baseball', 'superman',
        'trustno1', 'welcome1', 'admin123', 'abc12345', 'abcd1234', 'aa123456',
        'qwe12345', 'q1w2e3r4', '1q2w3e4r', '1qaz2wsx', 'zaq12wsx', 'asdf1234',
        'qwerty12', 'letmein1', 'parol123', 'пароль12', 'пароль123', 'йцукенгш'
    ]);
    const PASSWORD_SEQUENCES = [
        '01234567890',
        'abcdefghijklmnopqrstuvwxyz',
        'абвгдеёжзийклмнопрстуфхцчшщъыьэюя',
        'qwertyuiopasdfghjklzxcvbnm',
        'йцукенгшщзхъфывапролджэячсмитьбю',
        '1q2w3e4r5t6y7u8i9o0p',
        '1qaz2wsx3edc4rfv5tgb6yhn7ujm'
    ];
    function isSequence(s) {
        return PASSWORD_SEQUENCES.some(seq => seq.includes(s) || [...seq].reverse().join('').includes(s));
    }
    function passwordAdvice(password) {
        const p = String(password).normalize('NFKC');
        if (p.length < 8)
            return '';
        const lower = p.toLowerCase();
        if (COMMON_PASSWORDS.has(lower)) {
            return t('Это один из самых распространённых паролей: его проверяют первым.');
        }
        if (/^(.)\1+$/u.test(p)) {
            return t('Пароль из одного повторяющегося символа подбирается за секунды.');
        }
        if (/^(.{2,4})\1+$/u.test(p)) {
            return t('Пароль из повторяющегося фрагмента легко подобрать.');
        }
        if (isSequence(lower)) {
            return t('Последовательности вроде 12345678, abcdefgh или qwertyui подбирают одними из первых.');
        }
        if (/^\d+$/.test(p) && p.length < 12) {
            return t('Пароль только из цифр подбирается быстро. Стоит добавить другие символы.');
        }
        const kinds = [/[\p{Ll}\p{Lo}]/u, /\p{Lu}/u, /\p{N}/u, /[^\p{L}\p{N}]/u]
            .filter(re => re.test(p)).length;
        if (p.length < 12 && kinds < 3) {
            return t('Пароль коротковат. Надёжнее — от 12 символов или фраза из нескольких слов.');
        }
        return '';
    }
    const EYE_ICON = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg>';
    const EYE_OFF_ICON = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3l18 18"/><path d="M10.6 5.1A10.4 10.4 0 0 1 12 5c6.4 0 10 7 10 7a17.6 17.6 0 0 1-3.2 4.2"/><path d="M6.6 6.6C3.8 8.4 2 12 2 12s3.6 7 10 7a9.8 9.8 0 0 0 5.4-1.6"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/></svg>';
    function passwordFieldHtml(name, placeholder, autocomplete, group = name) {
        return `
            <div class="secret-inline-input">
                <input class="secret-inline-field" type="password" name="${name}" data-group="${group}" placeholder="${placeholder}" autocomplete="${autocomplete}" autocapitalize="off" spellcheck="false">
                <button type="button" class="secret-eye-btn" data-eye="${group}">${EYE_ICON}</button>
            </div>
        `;
    }
    function openVaultModal(initialMode, options = {}) {
        return new Promise(resolve => {
            closeVaultModal();
            closeSettings();
            closeAccountPanel();
            expandSection('secret');
            const screen = !!options.forNote && el.body.classList.contains('editor-fullscreen') && window.innerWidth <= 760;
            const returnToEditor = !screen && el.body.classList.contains('editor-fullscreen');
            if (returnToEditor) {
                el.body.classList.remove('editor-fullscreen');
                updateFullscreenIcon();
            }
            const panel = document.createElement('div');
            panel.className = 'secret-inline-panel';
            panel.innerHTML = '<div class="secret-inline-card"></div>';
            const card = panel.firstElementChild;
            let busy = false;
            let settled = false;
            let pendingPassword = '';
            let failCount = 0;
            let blockedUntil = 0;
            let countdownTimer = null;
            const currentCheck = { token: 0, value: '', result: undefined };
            function close(result, restore = true) {
                if (settled)
                    return;
                settled = true;
                pendingPassword = '';
                currentCheck.token++;
                stopCountdown();
                activeVaultModal = null;
                document.removeEventListener('keydown', onKeydown, true);
                if (screen) {
                    renderSecretSection();
                    const leave = () => {
                        resolve(result);
                        host.classList.remove('visible');
                        setTimeout(() => host.remove(), 260);
                    };
                    if (result && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
                        host.classList.add('sealed');
                        setTimeout(leave, 650);
                    }
                    else
                        leave();
                    return;
                }
                const finish = () => {
                    panel.remove();
                    renderSecretSection();
                    if (restore && returnToEditor && (getNote(activeNoteId) || getTrashedNote(activeNoteId))) {
                        el.body.classList.add('editor-fullscreen');
                        updateFullscreenIcon();
                    }
                    resolve(result);
                };
                const animate = restore && panel.isConnected &&
                    !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
                if (!animate) {
                    finish();
                    return;
                }
                panel.style.height = `${panel.offsetHeight}px`;
                void panel.offsetHeight;
                panel.classList.add('closing');
                setTimeout(finish, 320);
            }
            function onKeydown(e) {
                if (e.key === 'Escape' && !busy) {
                    e.preventDefault();
                    close(false);
                }
            }
            function setError(message) {
                const box = card.querySelector('.secret-inline-error');
                if (box)
                    box.textContent = message || '';
            }
            function setHint(message) {
                const box = card.querySelector('.secret-inline-hint');
                if (box)
                    box.textContent = message || '';
            }
            function setBusy(value, label) {
                busy = value;
                card.querySelectorAll('input, button').forEach(x => {
                    x.disabled = value;
                });
                const confirmBtn = card.querySelector('.notification-confirm');
                if (!confirmBtn)
                    return;
                if (value) {
                    confirmBtn.dataset.label = confirmBtn.textContent;
                    confirmBtn.textContent = label;
                }
                else if (confirmBtn.dataset.label) {
                    confirmBtn.textContent = confirmBtn.dataset.label;
                }
            }
            function shake() {
                card.classList.remove('shake');
                void card.offsetWidth;
                card.classList.add('shake');
            }
            function stopCountdown() {
                clearInterval(countdownTimer);
                countdownTimer = null;
            }
            function startCountdown() {
                stopCountdown();
                const submitBtn = card.querySelector('.notification-confirm');
                const tick = () => {
                    const left = Math.ceil((blockedUntil - Date.now()) / 1000);
                    if (left <= 0) {
                        stopCountdown();
                        setError('');
                        if (submitBtn && !busy)
                            submitBtn.disabled = false;
                        return;
                    }
                    setError(t('Слишком много попыток. Подождите {left} сек.', { left }));
                    if (submitBtn)
                        submitBtn.disabled = true;
                };
                tick();
                countdownTimer = setInterval(tick, 250);
            }
            function submitNext(form) {
                const password = form.elements.password.value;
                const repeat = form.elements.confirm.value;
                if (password.length < 8) {
                    setError(t('Пароль должен быть не короче 8 символов.'));
                    form.elements.password.focus();
                    return;
                }
                if (password !== repeat) {
                    setError(t('Пароли не совпадают.'));
                    form.elements.confirm.focus();
                    return;
                }
                pendingPassword = password;
                show('confirm');
            }
            async function submitCreate() {
                if (!pendingPassword) {
                    show('setup');
                    return;
                }
                if (!navigator.onLine) {
                    setError(t('Нет подключения к интернету.'));
                    return;
                }
                setError('');
                setBusy(true, t('Создание…'));
                try {
                    await loadVaultMeta();
                    if (vaultMeta) {
                        pendingPassword = '';
                        setBusy(false);
                        show('unlock', t('Хранилище уже создано на другом устройстве. Введите его пароль.'));
                        return;
                    }
                    const { meta, key } = await createVault(pendingPassword);
                    await saveVaultMeta(meta);
                    pendingPassword = '';
                    vaultMeta = meta;
                    vaultMetaLoaded = true;
                    vaultKey = key;
                    afterVaultUnlocked();
                    close(true);
                }
                catch (error) {
                    console.error(error);
                    setBusy(false);
                    setError(t('Не удалось создать хранилище. Проверьте подключение и попробуйте ещё раз.'));
                }
            }
            async function submitUnlock(form) {
                const input = form.elements.password;
                const password = input.value;
                if (!password) {
                    setError(t('Введите пароль.'));
                    return;
                }
                if (Date.now() < blockedUntil) {
                    startCountdown();
                    return;
                }
                setError('');
                setBusy(true, t('Проверка…'));
                let result = null;
                try {
                    result = await unlockVault(password, vaultMeta);
                }
                catch (error) {
                    console.error(error);
                    setBusy(false);
                    setError(t('Данные хранилища повреждены.'));
                    return;
                }
                if (!result) {
                    failCount++;
                    if (failCount >= 3) {
                        blockedUntil = Date.now() + Math.min(2000 * 2 ** (failCount - 3), 30000);
                    }
                    setBusy(false);
                    input.value = '';
                    shake();
                    input.focus();
                    if (Date.now() < blockedUntil)
                        startCountdown();
                    else
                        setError(t('Неверный пароль.'));
                    return;
                }
                if (result.upgradedMeta) {
                    try {
                        await loadVaultMeta();
                        if (vaultMeta && vaultMeta.v === 1) {
                            await saveVaultMeta(result.upgradedMeta);
                            vaultMeta = result.upgradedMeta;
                        }
                    }
                    catch (error) {
                        console.error(error);
                    }
                }
                await finishUnlock(result.key);
            }
            async function submitReset() {
                setError('');
                setBusy(true, t('Удаление…'));
                try {
                    await resetVault();
                    if (screen && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
                        host.classList.add('wiping');
                        await new Promise(r => setTimeout(r, 1000));
                    }
                    close(false);
                    showToast(t('Хранилище сброшено'), t('Секретные заметки удалены. Можно создать новое.'));
                }
                catch (error) {
                    console.error(error);
                    setBusy(false);
                    setError(t('Не удалось удалить. Проверьте подключение и попробуйте ещё раз.'));
                }
            }
            function setFieldState(input, state, message) {
                input.classList.toggle('is-valid', state === 'valid');
                input.classList.toggle('is-invalid', state === 'invalid');
                const note = card.querySelector(`[data-note="${input.name}"]`);
                if (note) {
                    note.textContent = message || '';
                    note.dataset.state = state || '';
                }
            }
            async function verifyCurrentPassword(input) {
                const value = input.value;
                if (!value || !vaultMeta)
                    return null;
                if (currentCheck.value === value && currentCheck.result !== undefined) {
                    setFieldState(input, currentCheck.result ? 'valid' : 'invalid', currentCheck.result ? '' : t('Текущий пароль неверный.'));
                    return currentCheck.result;
                }
                const token = ++currentCheck.token;
                setFieldState(input, 'checking', t('Проверка…'));
                let result = null;
                try {
                    result = await unlockVault(value, vaultMeta);
                }
                catch (error) {
                    console.error(error);
                }
                if (token !== currentCheck.token || input.value !== value)
                    return result;
                currentCheck.value = value;
                currentCheck.result = result;
                setFieldState(input, result ? 'valid' : 'invalid', result ? '' : t('Текущий пароль неверный.'));
                if (!result)
                    shake();
                return result;
            }
            async function submitChangePassword(form) {
                const currentPassword = form.elements.currentPassword.value;
                const nextPassword = form.elements.newPassword.value;
                const repeatPassword = form.elements.confirm.value;
                if (!currentPassword) {
                    setError(t('Введите текущий пароль.'));
                    form.elements.currentPassword.focus();
                    return;
                }
                if (nextPassword.length < 8) {
                    setError(t('Новый пароль должен быть не короче 8 символов.'));
                    form.elements.newPassword.focus();
                    return;
                }
                if (nextPassword !== repeatPassword) {
                    setError(t('Новые пароли не совпадают.'));
                    form.elements.confirm.focus();
                    return;
                }
                if (nextPassword === currentPassword) {
                    setError(t('Новый пароль должен отличаться от текущего.'));
                    form.elements.newPassword.focus();
                    return;
                }
                if (!navigator.onLine) {
                    setError(t('Нет подключения к интернету.'));
                    return;
                }
                if (currentCheck.value === currentPassword && currentCheck.result === null) {
                    setFieldState(form.elements.currentPassword, 'invalid', t('Текущий пароль неверный.'));
                    shake();
                    form.elements.currentPassword.focus();
                    return;
                }
                setError('');
                setBusy(true, t('Изменение…'));
                try {
                    await loadVaultMeta();
                    const verified = vaultMeta ? await unlockVault(currentPassword, vaultMeta) : null;
                    if (!verified) {
                        setBusy(false);
                        currentCheck.value = currentPassword;
                        currentCheck.result = null;
                        setFieldState(form.elements.currentPassword, 'invalid', t('Текущий пароль неверный.'));
                        shake();
                        form.elements.currentPassword.focus();
                        return;
                    }
                    const base = verified.upgradedMeta || vaultMeta;
                    const nextMeta = await changeVaultPassword(base, vaultKey, nextPassword);
                    await saveVaultMeta(nextMeta);
                    vaultMeta = nextMeta;
                    close(true);
                    showToast(t('Пароль изменён'));
                }
                catch (error) {
                    console.error(error);
                    setBusy(false);
                    setError(t('Не удалось сменить пароль. Проверьте подключение и попробуйте ещё раз.'));
                }
            }
            async function finishUnlock(key) {
                vaultKey = key;
                try {
                    await hydrateSecretNotes([...notes, ...trashedNotes, ...otherNotes, ...otherTrash]);
                }
                catch (error) {
                    console.error(error);
                }
                afterVaultUnlocked();
                close(true);
            }
            async function submitPasskeyUnlock() {
                setError('');
                setBusy(true, t('Ожидание ключа доступа…'));
                let key = null;
                try {
                    key = await unlockVaultWithPasskey(vaultMeta);
                }
                catch (error) {
                    setBusy(false);
                    const name = error && error.name;
                    const message = error && error.message;
                    if (name !== 'NotAllowedError' && name !== 'AbortError')
                        console.error(error);
                    if (message === 'vault: prf unsupported') {
                        try {
                            localStorage.setItem(PASSKEY_PRF_KEY, 'no');
                        }
                        catch (e) { }
                        passkeySupport = false;
                        card.querySelector('[data-act="passkey"]')?.remove();
                        setError(t('Этот браузер не умеет открывать хранилище ключом доступа. Откройте его паролем.'));
                    }
                    else if (name === 'NotAllowedError' || name === 'AbortError')
                        setError(t('Подходящий ключ доступа не найден или вход отменён. Если ключ сохранён в другом браузере, откройте хранилище паролем.'));
                    else if (message === 'vault: unknown passkey')
                        setError(t('Этот ключ доступа не добавлен к хранилищу. Откройте хранилище паролем и добавьте его.'));
                    else
                        setError(t('Не удалось открыть хранилище ключом доступа. Попробуйте пароль.'));
                    return;
                }
                await finishUnlock(key);
            }
            async function submitAddPasskey() {
                if (!navigator.onLine) {
                    setError(t('Нет подключения к интернету.'));
                    return;
                }
                setError('');
                setBusy(true, t('Ожидание ключа доступа…'));
                try {
                    await loadVaultMeta();
                    if (!vaultMeta || vaultMeta.v !== 2) {
                        throw new Error('vault: bad meta');
                    }
                    const nextMeta = await addVaultPasskey(vaultMeta, vaultKey, {
                        id: currentUser.uid,
                        name: currentUser.email || currentUser.displayName || 'Заметки',
                        displayName: currentUser.displayName || currentUser.email || 'Заметки'
                    });
                    await saveVaultMeta(nextMeta);
                    vaultMeta = nextMeta;
                    setBusy(false);
                    show('passkeys');
                    showToast(t('Ключ доступа добавлен'), t('Теперь хранилище можно открыть без пароля.'));
                }
                catch (error) {
                    setBusy(false);
                    const name = error && error.name;
                    if (name === 'NotAllowedError' || name === 'AbortError')
                        return;
                    console.error(error);
                    if (name === 'InvalidStateError')
                        setError(t('Этот ключ доступа уже добавлен.'));
                    else if (name === 'SecurityError')
                        setError(t('Ключи доступа работают только на домене сервиса по https или на localhost, а не по IP-адресу.'));
                    else if (error && error.message === 'vault: prf unsupported')
                        setError(t('Этот браузер или менеджер паролей не умеет шифровать ключом доступа. Хранилище по-прежнему открывается паролем.'));
                    else
                        setError(t('Не удалось добавить ключ доступа. Попробуйте ещё раз.'));
                }
            }
            async function removePasskey(id) {
                setError('');
                setBusy(true, t('Сохранение…'));
                try {
                    await loadVaultMeta();
                    const nextMeta = removeVaultPasskey(vaultMeta, id);
                    await saveVaultMeta(nextMeta);
                    vaultMeta = nextMeta;
                    setBusy(false);
                    show('passkeys');
                    showToast(t('Ключ доступа убран'), t('С устройства его можно удалить в настройках системы или менеджера паролей.'), 6000);
                }
                catch (error) {
                    console.error(error);
                    setBusy(false);
                    setError(t('Не удалось убрать ключ доступа. Проверьте подключение и попробуйте ещё раз.'));
                }
            }
            function show(mode, notice) {
                stopCountdown();
                if (mode === 'setup') {
                    card.innerHTML = `
                        <div class="secret-inline-step">${t('шаг 1 из 2')}</div>
                        <h3 class="secret-inline-title" tabindex="-1">${t('Создать секретное хранилище')}</h3>
                        <p class="secret-inline-text">${t('Секретные заметки шифруются на этом устройстве ещё до отправки на сервер. Без пароля их не прочитать.')}</p>
                        <form class="secret-inline-form" novalidate>
                            ${passwordFieldHtml('password', t('Пароль (от 8 символов)'), 'new-password', 'new')}
                            <div class="secret-inline-hint" aria-live="polite"></div>
                            ${passwordFieldHtml('confirm', t('Повторите пароль'), 'new-password', 'new')}
                            <div class="secret-inline-error" role="alert"></div>
                            <div class="notification-actions secret-inline-actions">
                                <button type="button" class="notification-cancel" data-act="cancel">${t('Отмена')}</button>
                                <button type="submit" class="notification-confirm">${t('Далее')}</button>
                            </div>
                        </form>
                    `;
                }
                else if (mode === 'confirm') {
                    card.innerHTML = `
                        <div class="secret-inline-step">${t('шаг 2 из 2')}</div>
                        <h3 class="secret-inline-title" tabindex="-1">${t('Запомните пароль')}</h3>
                        <div class="secret-inline-callout">${t('Если вы забудете пароль, доступ к секретным заметкам будет потерян. Сохраните его в менеджере паролей или запишите.')}</div>
                        <form class="secret-inline-form" novalidate>
                            <div class="secret-inline-hint" aria-live="polite"></div>
                            <div class="secret-inline-error" role="alert"></div>
                            <div class="notification-actions secret-inline-actions">
                                <button type="button" class="notification-cancel" data-act="back-setup">${t('Назад')}</button>
                                <button type="submit" class="notification-confirm">${t('Подтвердить')}</button>
                            </div>
                        </form>
                    `;
                    const advice = passwordAdvice(pendingPassword);
                    if (advice)
                        setHint(`${advice} ${t('Чтобы сменить пароль, вернитесь назад.')}`);
                }
                else if (mode === 'unlock') {
                    card.innerHTML = `
                        <h3 class="secret-inline-title" tabindex="-1">${t('Разблокировать хранилище')}</h3>
                        <p class="secret-inline-text"></p>
                        ${canUsePasskey() ? '<button type="button" class="secret-passkey-btn" data-act="passkey">' + t('Открыть ключом доступа') + '</button>' : ''}
                        <form class="secret-inline-form" novalidate>
                            ${passwordFieldHtml('password', t('Пароль'), 'current-password')}
                            <button type="button" class="secret-link-btn secret-forgot-btn" data-act="forgot">${t('Забыли пароль?')}</button>
                            <div class="secret-inline-error" role="alert"></div>
                            <div class="notification-actions secret-inline-actions">
                                <button type="button" class="notification-cancel" data-act="cancel">${t('Отмена')}</button>
                                <button type="submit" class="notification-confirm">${screen ? t('Далее') : t('Открыть')}</button>
                            </div>
                        </form>
                    `;
                    const noticeEl = card.querySelector('.secret-inline-text');
                    if (!notice && screen)
                        notice = t('После разблокировки заметка станет секретной.');
                    if (notice)
                        noticeEl.textContent = notice;
                    else
                        noticeEl.remove();
                }
                else if (mode === 'change-password') {
                    card.innerHTML = `
                        <h3 class="secret-inline-title" tabindex="-1">${t('Сменить пароль хранилища')}</h3>
                        <form class="secret-inline-form" novalidate>
                            ${passwordFieldHtml('currentPassword', t('Текущий пароль'), 'current-password', 'current')}
                            <div class="secret-field-note" data-note="currentPassword"></div>
                            ${passwordFieldHtml('newPassword', t('Новый пароль (от 8 символов)'), 'new-password', 'new')}
                            <div class="secret-inline-hint" aria-live="polite"></div>
                            ${passwordFieldHtml('confirm', t('Повторите новый пароль'), 'new-password', 'new')}
                            <div class="secret-inline-error" role="alert"></div>
                            <div class="notification-actions secret-inline-actions">
                                <button type="button" class="notification-cancel" data-act="cancel">${t('Отмена')}</button>
                                <button type="submit" class="notification-confirm">${t('Сменить пароль')}</button>
                            </div>
                        </form>
                    `;
                }
                else if (mode === 'passkeys') {
                    const passkeys = (vaultMeta && vaultMeta.passkeys) || [];
                    card.innerHTML = `
                        <h3 class="secret-inline-title" tabindex="-1">${t('Вход по ключу доступа')}</h3>
                        <p class="secret-inline-text">${t('Хранилище открывается через Face ID, Touch ID или PIN устройства. Пароль остаётся запасным способом.')}</p>
                        ${passkeys.length ? `<div class="secret-passkey-list">${passkeys.map(p => `
                            <div class="secret-passkey-item">
                                <div class="secret-passkey-info">
                                    <strong>${escapeHtml(p.label || t('Ключ доступа'))}</strong>
                                    <span>${formatDate(p.createdAt)}</span>
                                </div>
                                <button type="button" class="secret-link-btn" data-remove-passkey="${escapeHtml(p.id)}">${t('убрать')}</button>
                            </div>
                        `).join('')}</div>` : ''}
                        <form class="secret-inline-form" novalidate>
                            <div class="secret-inline-error" role="alert"></div>
                            <div class="notification-actions secret-inline-actions">
                                <button type="button" class="notification-cancel" data-act="cancel">${t('Закрыть')}</button>
                                <button type="submit" class="notification-confirm">${t('Добавить ключ доступа')}</button>
                            </div>
                        </form>
                    `;
                }
                else {
                    card.innerHTML = `
                        <h3 class="secret-inline-title" tabindex="-1">${t('Сбросить хранилище?')}</h3>
                        <p class="secret-inline-text">${t('Все секретные заметки, включая корзину, будут удалены навсегда, а пароль сброшен. Восстановить их невозможно.')}</p>
                        <form class="secret-inline-form" novalidate>
                            <div class="secret-inline-error" role="alert"></div>
                            <div class="notification-actions secret-inline-actions">
                                <button type="button" class="notification-cancel" data-act="back-unlock">${t('Назад')}</button>
                                <button type="submit" class="notification-confirm danger">${t('Удалить всё')}</button>
                            </div>
                        </form>
                    `;
                }
                card.classList.remove('swap');
                void card.offsetWidth;
                card.classList.add('swap');
                const form = card.querySelector('form');
                form.addEventListener('submit', e => {
                    e.preventDefault();
                    if (busy)
                        return;
                    if (mode === 'setup')
                        submitNext(form);
                    if (mode === 'confirm')
                        submitCreate();
                    if (mode === 'unlock')
                        submitUnlock(form);
                    if (mode === 'change-password')
                        submitChangePassword(form);
                    if (mode === 'reset')
                        submitReset();
                    if (mode === 'passkeys')
                        submitAddPasskey();
                });
                card.querySelectorAll('[data-remove-passkey]').forEach(btn => {
                    btn.addEventListener('click', () => {
                        if (!busy)
                            removePasskey(btn.dataset.removePasskey);
                    });
                });
                card.querySelectorAll('[data-act]').forEach(btn => {
                    btn.addEventListener('click', () => {
                        if (busy)
                            return;
                        const act = btn.dataset.act;
                        if (act === 'cancel')
                            close(false);
                        if (act === 'forgot')
                            show('reset');
                        if (act === 'passkey')
                            submitPasskeyUnlock();
                        if (act === 'back-unlock')
                            show('unlock');
                        if (act === 'back-setup')
                            show('setup');
                    });
                });
                card.querySelectorAll('[data-eye]').forEach(eye => {
                    eye.addEventListener('mousedown', e => e.preventDefault());
                    eye.addEventListener('click', () => {
                        const group = eye.dataset.eye;
                        const fields = card.querySelectorAll(`.secret-inline-field[data-group="${group}"]`);
                        const reveal = fields[0].type === 'password';
                        fields.forEach(f => { f.type = reveal ? 'text' : 'password'; });
                        card.querySelectorAll(`[data-eye="${group}"]`).forEach(b => {
                            b.innerHTML = reveal ? EYE_OFF_ICON : EYE_ICON;
                            b.classList.toggle('active', reveal);
                        });
                    });
                });
                if (mode === 'setup') {
                    const pwd = form.elements.password;
                    const rep = form.elements.confirm;
                    if (pendingPassword) {
                        pwd.value = pendingPassword;
                        rep.value = pendingPassword;
                        pendingPassword = '';
                    }
                    const updateAdvice = () => setHint(passwordAdvice(pwd.value));
                    pwd.addEventListener('input', updateAdvice);
                    updateAdvice();
                }
                else if (mode === 'change-password') {
                    const pwd = form.elements.newPassword;
                    const updateAdvice = () => setHint(passwordAdvice(pwd.value));
                    pwd.addEventListener('input', updateAdvice);
                    updateAdvice();
                    const current = form.elements.currentPassword;
                    let checkTimer = null;
                    const runCheck = () => {
                        clearTimeout(checkTimer);
                        verifyCurrentPassword(current);
                    };
                    current.addEventListener('input', () => {
                        clearTimeout(checkTimer);
                        setFieldState(current, '', '');
                        if (current.value)
                            checkTimer = setTimeout(runCheck, 700);
                    });
                    current.addEventListener('blur', () => {
                        if (current.value && current.value !== currentCheck.value)
                            runCheck();
                    });
                }
                card.querySelectorAll('input').forEach(input => {
                    input.addEventListener('input', () => {
                        if (!countdownTimer)
                            setError('');
                    });
                });
                const focusTarget = mode === 'confirm' || mode === 'reset' || mode === 'passkeys'
                    ? card.querySelector('.secret-inline-title')
                    : card.querySelector('input');
                if (focusTarget)
                    focusTarget.focus({ preventScroll: true });
                if (mode === 'unlock' && Date.now() < blockedUntil)
                    startCountdown();
                if (screen)
                    setHero(mode === 'reset' ? 'reset' : 'note');
                else
                    requestAnimationFrame(() => panel.scrollIntoView({ block: 'nearest', behavior: 'smooth' }));
            }
            document.addEventListener('keydown', onKeydown, true);
            const host = screen ? document.createElement('div') : null;
            let heroMode = '';
            function setHero(next) {
                if (next === heroMode)
                    return;
                const first = !heroMode;
                heroMode = next;
                const hero = host.querySelector('.vault-screen-hero');
                host.classList.toggle('danger', next === 'reset');
                if (next === 'reset') {
                    const count = [...notes, ...trashedNotes, ...otherNotes, ...otherTrash].filter(n => n.secret).length;
                    const fan = Math.min(36, (count - 1) * 9);
                    const spread = Math.min(120, (count - 1) * 26);
                    const step = Math.min(70, 500 / Math.max(count, 1));
                    hero.innerHTML = `
                        <div class="vault-pile">
                            ${Array.from({ length: count }, (_, i) => {
                                const t = count > 1 ? i / (count - 1) - 0.5 : 0;
                                return `
                                    <div class="vault-pile-card" style="--x:${(t * spread).toFixed(1)}px;--y:${(Math.abs(t) * 14).toFixed(1)}px;--r:${(count > 1 ? t * fan : -3).toFixed(1)}deg;--d:${Math.round(i * step)}ms">
                                        <span></span><span></span><span></span>
                                    </div>
                                `;
                            }).join('')}
                        </div>
                    `;
                }
                else {
                    const target = getNote(activeNoteId);
                    const title = target && target.title.trim() ? target.title.trim() : t('Без названия');
                    const preview = target ? stripHtml(target.content).slice(0, 160) : '';
                    hero.innerHTML = `
                        <div class="vault-note">
                            <div class="vault-note-title">${escapeHtml(title)}</div>
                            <div class="vault-note-text">${escapeHtml(preview)}</div>
                            <span class="vault-note-lock"></span>
                        </div>
                    `;
                }
                if (!first) {
                    hero.classList.remove('swap');
                    void hero.offsetWidth;
                    hero.classList.add('swap');
                }
            }
            if (screen) {
                host.className = 'vault-screen';
                host.innerHTML = '<div class="vault-screen-hero"></div>';
                host.appendChild(panel);
                document.body.appendChild(host);
                requestAnimationFrame(() => host.classList.add('visible'));
            }
            else {
                el.secretList.innerHTML = '';
                el.secretList.appendChild(panel);
            }
            activeVaultModal = { close, panel, screen };
            show(initialMode);
        });
    }
    function renderSecretCard(note) {
        const card = document.createElement('div');
        card.dataset.id = note.id;
        if (note.locked) {
            card.className = 'note-card secret-card secret-card-broken';
            card.innerHTML = `
                <div class="note-card-main">
                    <div class="note-card-title">${t('Не удалось расшифровать')}</div>
                    <div class="note-card-preview">${t('Заметка повреждена или зашифрована другим паролем.')}</div>
                    <div class="note-card-date">${formatDate(note.updatedAt)}</div>
                </div>
            `;
            return card;
        }
        const title = note.title.trim() || t('Секретная заметка');
        const preview = stripHtml(note.content).slice(0, 140);
        const tags = note.tags && note.tags.length
            ? `<div class="note-card-tags">${note.tags.map(t => `<span class="note-card-tag">${escapeHtml(t)}</span>`).join('')}</div>`
            : '';
        card.className = 'note-card secret-card' + (note.id === activeNoteId ? ' active' : '');
        card.innerHTML = `
            <div class="note-card-main">
                <div class="note-card-title">${escapeHtml(title)}</div>
                ${preview ? `<div class="note-card-preview">${escapeHtml(preview)}</div>` : ''}
                ${tags}
                <div class="note-card-date">${formatDate(note.updatedAt)}</div>
            </div>
        `;
        card.addEventListener('click', () => selectNote(note.id));
        return card;
    }
    function emptyState({ icon, title, text, actionLabel, onAction, compact = false }) {
        const box = document.createElement('div');
        box.className = 'empty-state' + (compact ? ' compact' : '');
        box.innerHTML = `
            <span class="empty-state-icon"></span>
            <div class="empty-state-body">
                <div class="empty-state-title"></div>
                <div class="empty-state-text"></div>
            </div>
        `;
        box.querySelector('.empty-state-icon').style.setProperty('--empty-icon', `url('${icon}')`);
        box.querySelector('.empty-state-title').textContent = title;
        const textEl = box.querySelector('.empty-state-text');
        if (text instanceof Node)
            textEl.appendChild(text);
        else if (text)
            textEl.textContent = text;
        else
            textEl.remove();
        if (actionLabel && onAction) {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'empty-state-action';
            btn.textContent = actionLabel;
            btn.addEventListener('click', onAction);
            (compact ? box.querySelector('.empty-state-body') : box).appendChild(btn);
        }
        return box;
    }
    function settleEmptyAnimation(container) {
        if (!container)
            return;
        const box = container.querySelector(':scope > .empty-state');
        if (!box) {
            delete container.dataset.emptyKey;
            return;
        }
        const key = box.textContent.replace(/\s+/g, ' ').trim();
        if (container.dataset.emptyKey === key)
            box.classList.add('static');
        container.dataset.emptyKey = key;
    }
    function createSecretBox(title, text, buttonLabel, onClick) {
        return emptyState({ icon: 'lock.svg', title, text, actionLabel: buttonLabel, onAction: onClick, compact: true });
    }
    function searchScopeText() {
        if (searchFilter === 'title')
            return t(' в названиях');
        if (searchFilter === 'content')
            return t(' в тексте');
        if (searchFilter === 'tags')
            return t(' в тегах');
        return '';
    }
    function resetSearch() {
        el.searchInput.value = '';
        renderNotesList();
        el.searchInput.focus();
    }
    function renderSecretSection() {
        renderSecretSectionInner();
        settleEmptyAnimation(el.secretList);
    }
    function renderSecretSectionInner() {
        if (!el.secretSection)
            return;
        el.secretSection.hidden = !currentUser;
        if (!currentUser)
            return;
        const unlocked = !!vaultKey;
        const secretNotes = notes.filter(n => n.secret);
        el.secretLockBtn.hidden = !unlocked;
        setListCount(el.secretCount, isLoading ? 0 : secretNotes.length);
        const list = el.secretList;
        if (activeVaultModal && !activeVaultModal.screen) {
            if (!list.contains(activeVaultModal.panel)) {
                list.innerHTML = '';
                list.appendChild(activeVaultModal.panel);
            }
            return;
        }
        list.innerHTML = '';
        if (isLoading) {
            list.innerHTML = skeletonCards(1);
            return;
        }
        if (!vaultMetaLoaded) {
            list.appendChild(createSecretBox(t('Хранилище не отвечает'), t('Похоже, интернет решил отдохнуть. Проверьте подключение.'), t('Повторить'), async () => {
                try {
                    await loadVaultMeta();
                }
                catch (error) {
                    handleFirebaseError(error);
                }
                renderSecretSection();
            }));
            return;
        }
        if (!vaultMeta) {
            list.appendChild(createSecretBox(t('Заметки под паролем'), t('Для секретов. Шифруются прямо в браузере.'), t('Создать хранилище'), () => requestUnlock()));
            return;
        }
        if (!unlocked) {
            list.appendChild(createSecretBox(t('Хранилище заблокировано'), t('Разблокируйте, чтобы увидеть скрытые заметки'), t('Разблокировать'), () => requestUnlock()));
            return;
        }
        const query = el.searchInput.value.trim().toLowerCase();
        const matches = n => {
            if (n.locked)
                return !query;
            if (!query)
                return true;
            const inTitle = n.title.toLowerCase().includes(query);
            const inContent = stripHtml(n.content).toLowerCase().includes(query);
            const inTags = (n.tags || []).some(t => t.toLowerCase().includes(query));
            if (searchFilter === 'title')
                return inTitle;
            if (searchFilter === 'content')
                return inContent;
            if (searchFilter === 'tags')
                return inTags;
            return inTitle || inContent || inTags;
        };
        const addBtn = document.createElement('button');
        addBtn.type = 'button';
        addBtn.className = 'secret-action-btn secret-new-btn';
        addBtn.innerHTML = '<span class="secret-action-icon"></span><span>' + t('Добавить секретную заметку') + '</span>';
        addBtn.addEventListener('click', () => createNote(true));
        list.appendChild(addBtn);
        const links = document.createElement('div');
        links.className = 'secret-links';
        const passwordBtn = document.createElement('button');
        passwordBtn.type = 'button';
        passwordBtn.className = 'secret-password-btn';
        passwordBtn.textContent = t('Сменить пароль');
        passwordBtn.addEventListener('click', () => openVaultModal('change-password'));
        links.appendChild(passwordBtn);
        if (passkeySupport) {
            const passkeyBtn = document.createElement('button');
            passkeyBtn.type = 'button';
            passkeyBtn.className = 'secret-password-btn';
            passkeyBtn.textContent = t('Вход по ключу доступа');
            passkeyBtn.addEventListener('click', () => openVaultModal('passkeys'));
            links.appendChild(passkeyBtn);
        }
        list.appendChild(links);
        const visible = secretNotes
            .filter(matches)
            .sort((a, b) => b.createdAt - a.createdAt);
        if (!visible.length) {
            list.appendChild(query
                ? emptyState({ icon: 'search.svg', title: t('Здесь мимо'), compact: true })
                : emptyState({
                    icon: 'lock.svg',
                    title: t('Секретов пока нет'),
                    text: '',
                    compact: true
                }));
            return;
        }
        visible.forEach(n => list.appendChild(renderSecretCard(n)));
    }
    function uid() {
        return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    }
    function escapeHtml(str) {
        const d = document.createElement('div');
        d.textContent = str;
        return d.innerHTML;
    }
    function stripHtml(html) {
        const d = document.createElement('div');
        d.innerHTML = String(html || '').replace(/(<\/(?:p|div|li|h[1-6]|blockquote|pre|td|tr)>|<br\s*\/?>)/gi, '$1 ');
        return (d.textContent || '').replace(/\s+/g, ' ').trim();
    }
    function formatDate(ts) {
        const d = new Date(ts);
        const now = new Date();
        if (d.toDateString() === now.toDateString()) {
            return d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
        }
        const day = d.toLocaleDateString(locale, { day: 'numeric', month: 'short' });
        const time = d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
        return `${day}, ${time}`;
    }
    function pluralDays(n) {
        if (lang !== 'ru')
            return n === 1 ? 'day' : 'days';
        if (n % 10 === 1 && n % 100 !== 11)
            return t('день');
        if ([2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100))
            return t('дня');
        return t('дней');
    }
    function pluralNotes(n) {
        if (lang !== 'ru')
            return n === 1 ? 'note' : 'notes';
        if (n % 10 === 1 && n % 100 !== 11)
            return t('заметку');
        if ([2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100))
            return t('заметки');
        return t('заметок');
    }
    function daysLeft(note) {
        return Math.max(0, Math.ceil((TRASH_TTL - (Date.now() - note.deletedAt)) / 86400000));
    }
    async function loadNotes() {
        if (!currentUser) {
            notes = [];
            otherNotes = [];
            return;
        }
        const snapshot = await getDocs(collection(db, "users", currentUser.uid, "notes"));
        if (snapshot.metadata.fromCache) {
            showSyncNotification();
        }
        else {
            hideSyncNotification();
        }
        const all = snapshot.docs.map(d => normalizeStoredNote(d.id, d.data()));
        await hydrateSecretNotes(all);
        await ensureSpaceSettings();
        [notes, otherNotes] = splitBySpace(all);
    }
    function skeletonCards(count) {
        return Array.from({ length: count }, (_, i) => `
        <div class="note-skeleton" style="--i: ${i}">
            <span class="sk sk-title"></span>
            <span class="sk sk-line"></span>
            <span class="sk sk-line sk-short"></span>
            <span class="sk sk-date"></span>
        </div>
    `).join('');
    }
    function renderNotesLoader() {
        if (!isLoading)
            return;
        el.pinnedNotes.innerHTML = skeletonCards(1);
        el.notesList.innerHTML = skeletonCards(4);
        el.trashList.innerHTML = skeletonCards(3);
        el.notesList.setAttribute('aria-busy', 'true');
        el.trashList.setAttribute('aria-busy', 'true');
        setListCount(el.pinnedCount, 0);
        setListCount(el.allNotesCount, 0);
    }
    function setListCount(node, count) {
        if (!node)
            return;
        const text = count > 0 ? String(count) : '';
        if (node.textContent === text)
            return;
        node.textContent = text;
        if (text) {
            node.classList.remove('bump');
            void node.offsetWidth;
            node.classList.add('bump');
        }
    }
    function clearNotesLoader() {
        if (el.notesList)
            el.notesList.removeAttribute('aria-busy');
        if (el.trashList)
            el.trashList.removeAttribute('aria-busy');
    }
    async function saveNote(note) {
        if (!currentUser)
            return;
        await setDoc(doc(db, "users", currentUser.uid, "notes", note.id), await toStoredNote(note));
    }
    function getNote(id) {
        const note = notes.find(n => n.id === id) || null;
        if (note && !Array.isArray(note.tags))
            note.tags = [];
        return note;
    }
    async function loadTrash() {
        if (!currentUser) {
            trashedNotes = [];
            otherTrash = [];
            return;
        }
        const snapshot = await getDocs(collection(db, "users", currentUser.uid, "trash"));
        let all = snapshot.docs.map(d => normalizeStoredNote(d.id, d.data()));
        await hydrateSecretNotes(all);
        const expired = all.filter(note => Date.now() - note.deletedAt > TRASH_TTL);
        await Promise.all(expired.map(note => deleteDoc(doc(db, "users", currentUser.uid, "trash", note.id))));
        all = all.filter(note => Date.now() - note.deletedAt <= TRASH_TTL);
        await ensureSpaceSettings();
        [trashedNotes, otherTrash] = splitBySpace(all);
    }
    function currentSpace() {
        return currentUser && currentUser.provider ? currentUser.provider : null;
    }
    function inCurrentSpace(note) {
        const space = currentSpace();
        return !separateBySignIn || !space || !note.space || note.space === space;
    }
    function splitBySpace(all) {
        return [all.filter(inCurrentSpace), all.filter(note => !inCurrentSpace(note))];
    }
    function ensureSpaceSettings() {
        if (!currentUser)
            return Promise.resolve();
        if (!spaceSettingsPromise) {
            const user = currentUser;
            spaceSettingsPromise = getDocs(collection(db, "users", user.uid, "vault"))
                .then(snapshot => {
                    if (currentUser !== user)
                        return;
                    const settings = snapshot.docs.find(d => d.id === 'settings');
                    separateBySignIn = !!(settings && settings.data().separateBySignIn);
                    updateSpaceSetting();
                })
                .catch(error => {
                    spaceSettingsPromise = null;
                    console.error(error);
                });
        }
        return spaceSettingsPromise;
    }
    function applySpaces() {
        [notes, otherNotes] = splitBySpace([...notes, ...otherNotes]);
        [trashedNotes, otherTrash] = splitBySpace([...trashedNotes, ...otherTrash]);
        selectedNoteIds.clear();
        if (!getNote(activeNoteId) && !getTrashedNote(activeNoteId)) {
            removeTrashBanner();
            activeNoteId = pickNextNoteId();
        }
        renderNotesList();
        renderTrash();
        renderEditor();
        renderSelectionBar();
    }
    const PROVIDER_NAMES = { google: 'Google', github: 'GitHub', discord: 'Discord', figma: 'Figma' };
    function updateSpaceSetting() {
        if (!el.spaceSetting)
            return;
        const multiple = !!(currentUser && currentUser.providers && currentUser.providers.length > 1);
        el.spaceSetting.hidden = !multiple;
        el.spaceToggle.classList.toggle('active', separateBySignIn);
        el.spaceToggle.setAttribute('aria-pressed', String(separateBySignIn));
        const space = currentSpace();
        el.spaceCurrent.textContent = space ? t('Вы вошли через {name}', { name: PROVIDER_NAMES[space] || space }) : '';
    }
    async function toggleSeparateBySignIn() {
        if (!currentUser)
            return;
        await ensureSpaceSettings();
        await persistActiveNote();
        const previous = separateBySignIn;
        separateBySignIn = !separateBySignIn;
        updateSpaceSetting();
        applySpaces();
        try {
            await setDoc(doc(db, "users", currentUser.uid, "vault", "settings"), { separateBySignIn });
        }
        catch (error) {
            separateBySignIn = previous;
            updateSpaceSetting();
            applySpaces();
            handleFirebaseError(error);
            showToast(t('Не удалось сохранить настройку'), t('Проверьте подключение и попробуйте ещё раз.'));
            return;
        }
        if (!navigator.onLine)
            return;
        const user = currentUser;
        try {
            await persistActiveNote();
            await Promise.all([loadNotes(), loadTrash()]);
        }
        catch (error) {
            console.error(error);
            return;
        }
        if (currentUser !== user)
            return;
        applySpaces();
    }
    function getTrashedNote(id) {
        return trashedNotes.find(n => n.id === id) || null;
    }
    function updateSaveStatusToggle() {
        if (!el.saveStatusToggle)
            return;
        el.saveStatusToggle.classList.toggle('active', saveStatusVisible);
        el.saveStatusToggle.setAttribute('aria-pressed', String(saveStatusVisible));
    }
    function toggleSaveStatusVisibility() {
        setSaveStatusVisible(!saveStatusVisible);
        updateSaveStatusToggle();
    }
    function renderNoteCard(note) {
        const title = note.title.trim() || t('Заметка');
        const preview = stripHtml(note.content).slice(0, 140);
        const tags = note.tags && note.tags.length
            ? `<div class="note-card-tags">${note.tags.map(t => `<span class="note-card-tag">${escapeHtml(t)}</span>`).join('')}</div>`
            : '';
        const isChecked = selectedNoteIds.has(note.id);
        const card = document.createElement('div');
        card.className = 'note-card note-card-selectable' + (note.id === activeNoteId ? ' active' : '');
        card.dataset.id = note.id;
        card.innerHTML = `
        <button type="button" class="note-card-checkbox${isChecked ? ' checked' : ''}"></button>
        <div class="note-card-main">
            <div class="note-card-title">${escapeHtml(title)}</div>
            ${preview ? `<div class="note-card-preview">${escapeHtml(preview)}</div>` : ''}
            ${tags}
            <div class="note-card-date">${formatDate(note.updatedAt)}</div>
        </div>
    `;
        let pressTimer = null;
        let longPressTriggered = false;
        const startLongPress = () => {
            longPressTriggered = false;
            pressTimer = setTimeout(() => {
                longPressTriggered = true;
                if (!selectedNoteIds.has(note.id)) {
                    selectedNoteIds.add(note.id);
                }
                renderNotesList();
                renderSelectionBar();
            }, 600);
        };
        const cancelLongPress = () => {
            if (pressTimer) {
                clearTimeout(pressTimer);
                pressTimer = null;
            }
        };
        card.addEventListener('pointerdown', e => {
            if (e.pointerType === 'mouse' && e.button !== 0)
                return;
            if (e.target.closest('.note-card-checkbox'))
                return;
            startLongPress();
        });
        card.addEventListener('pointerup', cancelLongPress);
        card.addEventListener('pointercancel', cancelLongPress);
        card.addEventListener('pointerleave', cancelLongPress);
        card.addEventListener('click', e => {
            if (e.target.closest('.note-card-checkbox')) {
                e.stopPropagation();
                toggleNoteSelection(note.id);
                return;
            }
            if (longPressTriggered) {
                longPressTriggered = false;
                return;
            }
            if (selectedNoteIds.size > 0) {
                toggleNoteSelection(note.id);
                return;
            }
            selectNote(note.id);
        });
        return card;
    }
    function renderNotesList() {
        if (isLoading) {
            renderNotesLoader();
            renderSecretSection();
            return;
        }
        clearNotesLoader();
        const query = el.searchInput.value.trim().toLowerCase();
        const byDate = (a, b) => b.createdAt - a.createdAt;
        const filtered = notes.filter(n => {
            if (n.secret)
                return false;
            if (!query)
                return true;
            const inTitle = n.title.toLowerCase().includes(query);
            const inContent = stripHtml(n.content).toLowerCase().includes(query);
            const inTags = (n.tags || []).some(t => t.toLowerCase().includes(query));
            if (searchFilter === 'title')
                return inTitle;
            if (searchFilter === 'content')
                return inContent;
            if (searchFilter === 'tags')
                return inTags;
            return inTitle || inContent || inTags;
        });
        const pinned = filtered.filter(n => n.pinned).sort(byDate);
        const regular = filtered.filter(n => !n.pinned).sort(byDate);
        const openNotesCount = notes.filter(n => !n.secret).length;
        el.pinnedNotes.innerHTML = '';
        el.notesList.innerHTML = '';
        if (pinned.length) {
            pinned.forEach(n => el.pinnedNotes.appendChild(renderNoteCard(n)));
        }
        else if (query) {
            el.pinnedNotes.appendChild(emptyState({ icon: 'search.svg', title: t('Здесь мимо'), compact: true }));
        }
        else {
            el.pinnedNotes.appendChild(emptyState({
                icon: 'pin.svg',
                title: t('Ничего не закреплено'),
                text: '',
                compact: true
            }));
        }
        if (regular.length) {
            regular.forEach(n => el.notesList.appendChild(renderNoteCard(n)));
        }
        else if (query && !pinned.length) {
            const text = document.createDocumentFragment();
            const q = document.createElement('span');
            q.className = 'empty-state-query';
            q.textContent = `«${el.searchInput.value.trim()}»`;
            text.append(t('Искали '), q, `${searchScopeText()}${t(' — честно, везде. Пусто.')}`);
            el.notesList.appendChild(emptyState({
                icon: 'search.svg',
                title: t('Ничего не нашлось'),
                text,
                actionLabel: t('Сбросить поиск'),
                onAction: resetSearch
            }));
        }
        else if (query) {
            el.notesList.appendChild(emptyState({ icon: 'search.svg', title: t('Здесь мимо'), compact: true }));
        }
        else if (openNotesCount) {
            el.notesList.appendChild(emptyState({
                icon: 'pin.svg',
                title: t('Все заметки закреплены'),
                text: '',
                compact: true
            }));
        }
        else {
            el.notesList.appendChild(emptyState({
                icon: 'plus.svg',
                title: t('Тут пока пусто'),
                text: '',
                actionLabel: t('Новая заметка'),
                onAction: () => createNote()
            }));
        }
        setListCount(el.pinnedCount, pinned.length);
        setListCount(el.allNotesCount, regular.length);
        settleEmptyAnimation(el.pinnedNotes);
        settleEmptyAnimation(el.notesList);
        renderSecretSection();
    }
    function toggleNoteSelection(id) {
        if (selectedNoteIds.has(id)) {
            selectedNoteIds.delete(id);
        }
        else {
            selectedNoteIds.add(id);
        }
        renderNotesList();
        renderSelectionBar();
    }
    function clearSelection() {
        if (selectedNoteIds.size === 0)
            return;
        selectedNoteIds.clear();
        if (bulkDeleteNotificationHide) {
            bulkDeleteNotificationHide();
            bulkDeleteNotificationHide = null;
        }
        renderNotesList();
        renderSelectionBar();
    }
    function renderSelectionBar() {
        const container = document.querySelector('.notes-list');
        if (!container)
            return;
        container.classList.toggle('select-mode', selectedNoteIds.size > 0);
        if (selectedNoteIds.size === 0) {
            if (selectionBarEl) {
                const bar = selectionBarEl;
                bar.classList.remove('visible');
                bar.classList.add('hiding');
                setTimeout(() => {
                    if (selectionBarEl === bar && selectedNoteIds.size === 0) {
                        bar.remove();
                        selectionBarEl = null;
                    }
                }, 280);
            }
            return;
        }
        const selectedNotes = notes.filter(n => selectedNoteIds.has(n.id));
        const allPinned = selectedNotes.length > 0 && selectedNotes.every(n => n.pinned);
        if (!selectionBarEl) {
            selectionBarEl = document.createElement('div');
            selectionBarEl.className = 'selection-bar';
            container.insertBefore(selectionBarEl, container.firstChild);
            requestAnimationFrame(() => {
                if (selectionBarEl) {
                    selectionBarEl.classList.add('visible');
                }
            });
        }
        selectionBarEl.innerHTML = `
        <div class="selection-bar-count">${t('Выбрано: {n}', { n: selectedNoteIds.size })}</div>
        <div class="selection-bar-actions">
            <button type="button" class="selection-bar-btn" id="selectionPinBtn">
                <img src="${allPinned ? 'pinned.svg' : 'pin.svg'}">
            </button>
            <button type="button" class="selection-bar-btn danger" id="selectionDeleteBtn">
                <img src="trash-bin.svg">
            </button>
            <button type="button" class="selection-bar-btn" id="selectionCancelBtn">
                <img src="close.svg">
            </button>
        </div>
    `;
        selectionBarEl.querySelector('#selectionPinBtn').addEventListener('click', () => {
            bulkTogglePin(!allPinned);
        });
        selectionBarEl.querySelector('#selectionDeleteBtn').addEventListener('click', showBulkDeleteConfirmNotification);
        selectionBarEl.querySelector('#selectionCancelBtn').addEventListener('click', clearSelection);
    }
    async function bulkTogglePin(makePinned) {
        const ids = Array.from(selectedNoteIds);
        ids.forEach(id => {
            const note = getNote(id);
            if (!note)
                return;
            note.pinned = makePinned;
            note.updatedAt = Date.now();
        });
        renderNotesList();
        renderSelectionBar();
        try {
            await Promise.all(ids.map(id => {
                const note = getNote(id);
                return note ? saveNote(note) : Promise.resolve();
            }));
        }
        catch (error) {
            handleFirebaseError(error);
        }
    }
    function showBulkDeleteConfirmNotification() {
        const count = selectedNoteIds.size;
        if (bulkDeleteNotificationHide) {
            bulkDeleteNotificationHide();
            bulkDeleteNotificationHide = null;
        }
        const { el: n, hide } = showNotification(`
        <div class="notification-title">${t('Удалить {count} {notes}?', { count, notes: pluralNotes(count) })}</div>
        <div class="notification-text">${t('Заметки будут в корзине 15 дней, после чего удалятся автоматически.')}</div>
        <div class="notification-actions">
            <button class="notification-cancel" type="button">${t('Отмена')}</button>
            <button class="notification-confirm danger" type="button">${t('Удалить')}</button>
        </div>
    `);
        bulkDeleteNotificationHide = hide;
        n.querySelector('.notification-cancel').addEventListener('click', () => {
            hide();
            bulkDeleteNotificationHide = null;
        });
        n.querySelector('.notification-confirm').addEventListener('click', () => {
            hide();
            bulkDeleteNotificationHide = null;
            bulkMoveToTrash(Array.from(selectedNoteIds));
        });
    }
    async function bulkMoveToTrash(ids) {
        const backups = [];
        ids.forEach(id => {
            const index = notes.findIndex(n => n.id === id);
            if (index === -1)
                return;
            const backup = JSON.parse(JSON.stringify(notes[index]));
            backup.deletedAt = Date.now();
            notes.splice(index, 1);
            trashedNotes.unshift(backup);
            backups.push(backup);
            if (activeNoteId === id) {
                activeNoteId = firstOpenNoteId();
                removeTrashBanner();
                renderEditor();
            }
        });
        clearSelection();
        renderNotesList();
        renderTrash();
        showBulkUndoNotification(backups);
        try {
            await Promise.all(backups.map(async (backup) => {
                await trashWrite(backup);
                await deleteDoc(doc(db, "users", currentUser.uid, "notes", backup.id));
            }));
        }
        catch (error) {
            handleFirebaseError(error);
        }
    }
    function showBulkUndoNotification(backups) {
        const DELAY = 5000;
        const count = backups.length;
        const { el: n, hide } = showNotification(`
            <div class="notification-title">
                ${t('Удалено {count} {notes}', { count, notes: pluralNotes(count) })}
                <span class="notification-timer">5</span>
            </div>
            <div class="notification-actions">
                <button class="notification-undo" type="button">${t('Отменить')}</button>
            </div>
            <div class="notification-progress">
                <div class="notification-progress-bar"></div>
            </div>
        `, notifEl => {
            const bar = notifEl.querySelector('.notification-progress-bar');
            requestAnimationFrame(() => {
                bar.style.transition = `width ${DELAY}ms linear`;
                requestAnimationFrame(() => { bar.style.width = '0%'; });
            });
        });
        const timerEl = n.querySelector('.notification-timer');
        let secondsLeft = 5;
        const ticker = setInterval(() => {
            secondsLeft--;
            if (timerEl)
                timerEl.textContent = secondsLeft;
            if (secondsLeft <= 0)
                clearInterval(ticker);
        }, 1000);
        function hideWithCleanup() { clearInterval(ticker); hide(); }
        n.querySelector('.notification-undo').addEventListener('click', async () => {
            backups.forEach(backup => {
                const trashIdx = trashedNotes.findIndex(t => t.id === backup.id);
                if (trashIdx !== -1)
                    trashedNotes.splice(trashIdx, 1);
                const restored = { ...backup };
                delete restored.deletedAt;
                notes.unshift(restored);
            });
            renderNotesList();
            renderTrash();
            renderEditor();
            try {
                await Promise.all(backups.map(async (backup) => {
                    const restored = { ...backup };
                    delete restored.deletedAt;
                    await saveNote(restored);
                    await deleteDoc(doc(db, "users", currentUser.uid, "trash", backup.id));
                }));
            }
            catch (error) {
                handleFirebaseError(error);
            }
            hideWithCleanup();
        });
        setTimeout(() => { hideWithCleanup(); }, DELAY);
    }
    function renderTrash() {
        el.trashList.removeAttribute('aria-busy');
        renderTrashInner();
        settleEmptyAnimation(el.trashList);
    }
    function renderTrashInner() {
        el.trashList.innerHTML = '';
        if (trashedNotes.length === 0) {
            el.trashList.appendChild(emptyState({
                icon: 'trash-bin.svg',
                title: t('Корзина пуста'),
                text: t('Заметки сидят в корзине 15 дней. Сейчас тут никого нет.'),
                compact: true
            }));
            if (el.trashCount)
                el.trashCount.textContent = '';
            return;
        }
        if (el.trashCount)
            el.trashCount.textContent = trashedNotes.length;
        [...trashedNotes].sort((a, b) => b.deletedAt - a.deletedAt).forEach(note => {
            const days = daysLeft(note);
            const hidden = note.secret && note.locked;
            const title = hidden ? t('Секретная заметка') : (note.title.trim() || t('Заметка'));
            const preview = hidden ? '' : stripHtml(note.content).slice(0, 100);
            const urgent = days <= 3;
            const card = document.createElement('div');
            card.className = 'note-card trash-card' + (note.id === activeNoteId ? ' active' : '');
            card.dataset.id = note.id;
            card.innerHTML = `
                <div class="note-card-title">${escapeHtml(title)}</div>
                ${preview ? `<div class="note-card-preview">${escapeHtml(preview)}</div>` : ''}
                <div class="note-card-days${urgent ? ' urgent' : ''}">
                    ${days === 0 ? t('удаляется сегодня') : t('осталось {days} {unit} до удаления', { days, unit: pluralDays(days) })}
                </div>
            `;
            card.addEventListener('click', () => openTrashedNote(note.id));
            el.trashList.appendChild(card);
        });
        const clearBtn = document.createElement('button');
        clearBtn.type = 'button';
        clearBtn.className = 'trash-clear-btn';
        clearBtn.textContent = t('Очистить корзину');
        clearBtn.addEventListener('click', showClearTrashConfirmNotification);
        el.trashList.appendChild(clearBtn);
    }
    let lastRenderedNoteId = null;
    let noteEnterTimer = null;
    let appEnterTimer = null;
    let lastNoteSwitchAt = 0;
    const NOTE_ENTER_COOLDOWN = 1500;
    function animateNoteEnter() {
        const editor = document.querySelector('.editor');
        if (!editor)
            return;
        const now = Date.now();
        const rapid = now - lastNoteSwitchAt < NOTE_ENTER_COOLDOWN;
        lastNoteSwitchAt = now;
        if (rapid && !el.body.classList.contains('app-enter')) {
            clearTimeout(noteEnterTimer);
            editor.classList.remove('note-enter');
            return;
        }
        editor.classList.remove('note-enter');
        void editor.offsetWidth;
        editor.classList.add('note-enter');
        clearTimeout(noteEnterTimer);
        noteEnterTimer = setTimeout(() => editor.classList.remove('note-enter'), 1000);
    }
    let appRevealTimer = null;
    function revealApp() {
        if (!el.body.classList.contains('app-loading'))
            return;
        el.body.classList.remove('app-loading');
        el.body.classList.add('app-reveal', 'list-enter');
        clearTimeout(appRevealTimer);
        appRevealTimer = setTimeout(() => el.body.classList.remove('app-reveal', 'list-enter'), 900);
    }
    function playAppEnter() {
        el.body.classList.remove('app-enter');
        void el.body.offsetWidth;
        el.body.classList.add('app-enter');
        clearTimeout(appEnterTimer);
        appEnterTimer = setTimeout(() => el.body.classList.remove('app-enter'), 1400);
    }
    function renderEditor() {
        removeTrashBanner();
        let note = getNote(activeNoteId);
        if (note && note.secret && (note.locked || !vaultKey)) {
            activeNoteId = pickNextNoteId();
            note = getNote(activeNoteId);
        }
        updateSecretBadge(note);
        if (!note) {
            el.noteTitle.value = '';
            el.noteContent.innerHTML = '';
            el.noteTitle.disabled = true;
            el.noteContent.contentEditable = 'false';
            updatePinButton(false);
            renderTags({ tags: [] });
            closeFind();
            applyGoogleSans();
            lastRenderedNoteId = null;
            return;
        }
        el.noteTitle.disabled = false;
        el.noteContent.contentEditable = 'true';
        el.noteTitle.value = note.title;
        el.noteContent.innerHTML = note.content;
        updatePinButton(note.pinned);
        applyGoogleSans();
        renderTags(note);
        renderFormulas();
        updateFormatButtonsState();
        refreshFind(true);
        if (note.id !== lastRenderedNoteId)
            animateNoteEnter();
        lastRenderedNoteId = note.id;
    }
    function showMakeSecretConfirmNotification() {
        const note = getNote(activeNoteId);
        if (!note || note.secret)
            return;
        const { el: n, hide } = showNotification(`
            <div class="notification-title">${t('Засекретить заметку?')}</div>
            <div class="notification-text">${t('Заметка переместится в раздел «Секретные» и исчезнет из обычного списка.')}</div>
            <div class="notification-actions">
                <button class="notification-cancel" type="button">${t('Отмена')}</button>
                <button class="notification-confirm" type="button">${t('Засекретить')}</button>
            </div>
        `);
        n.querySelector('.notification-cancel').addEventListener('click', hide);
        n.querySelector('.notification-confirm').addEventListener('click', async () => {
            hide();
            await makeActiveNoteSecret();
        });
    }
    async function makeActiveNoteSecret() {
        let note = getNote(activeNoteId);
        if (!note || note.secret || !currentUser)
            return;
        if (!vaultKey) {
            const unlocked = await requestUnlock({ forNote: true });
            if (!unlocked)
                return;
            note = getNote(activeNoteId);
            if (!note || note.secret)
                return;
        }
        const saved = await persistActiveNote(true);
        if (!saved) {
            showToast(t('Не удалось сохранить заметку'), t('Сначала восстановите подключение и попробуйте ещё раз.'));
            return;
        }
        const wasPinned = !!note.pinned;
        note.secret = true;
        note.locked = false;
        note.pinned = false;
        try {
            await saveNote(note);
            expandSection('secret');
            renderNotesList();
            renderEditor();
            renderSecretSection();
            showToast(t('Заметка засекречена'));
        }
        catch (error) {
            note.secret = false;
            note.locked = false;
            note.pinned = wasPinned;
            delete note.enc;
            renderNotesList();
            renderEditor();
            handleFirebaseError(error);
            showToast(t('Не удалось засекретить'), t('Заметка осталась обычной. Попробуйте ещё раз.'));
        }
    }
    async function createNote(isSecret = false) {
        isSecret = isSecret === true;
        if (!currentUser)
            return;
        if (isSecret)
            expandSection('secret');
        if (isSecret && !vaultKey) {
            const unlocked = await requestUnlock();
            if (!unlocked)
                return;
        }
        persistActiveNote();
        const note = {
            id: uid(),
            title: '',
            content: '',
            pinned: false,
            tags: [],
            createdAt: Date.now(),
            updatedAt: Date.now(),
        };
        if (currentSpace())
            note.space = currentSpace();
        if (isSecret) {
            note.secret = true;
            note.locked = false;
        }
        notes.unshift(note);
        activeNoteId = note.id;
        if (window.innerWidth <= 760) {
            el.body.classList.add('editor-fullscreen');
        }
        updateFullscreenIcon();
        renderNotesList();
        renderEditor();
        el.noteTitle.focus();
        try {
            await saveNote(note);
        }
        catch (error) {
            handleFirebaseError(error);
        }
    }
    function renderTags(note) {
        el.noteTags.querySelectorAll('.tag').forEach(t => t.remove());
        note.tags.forEach((tag, index) => {
            const span = document.createElement('span');
            span.className = 'tag';
            span.innerHTML = `${escapeHtml(tag)}<button type="button" data-remove-tag="${index}">×</button>`;
            el.noteTags.insertBefore(span, el.addTagBtn);
        });
        el.noteTags.querySelectorAll('[data-remove-tag]').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const current = getNote(activeNoteId);
                if (!current)
                    return;
                current.tags.splice(Number(btn.dataset.removeTag), 1);
                current.updatedAt = Date.now();
                renderTags(current);
                try {
                    await saveNote(current);
                }
                catch (error) {
                    handleFirebaseError(error);
                }
            });
        });
    }
    function updatePinButton(isPinned) {
        el.pinNoteBtn.classList.toggle('active', !!isPinned);
        const img = el.pinNoteBtn.querySelector('img');
        img.src = isPinned ? 'pinned.svg' : 'pin.svg';
    }
    function renderTrashBanner(note) {
        removeTrashBanner();
        const days = daysLeft(note);
        const banner = document.createElement('div');
        banner.id = 'trashBanner';
        banner.className = 'trash-banner';
        banner.innerHTML = `
            <span class="trash-banner-text">${t('в корзине · до удаления {days} {unit}', { days, unit: pluralDays(days) })}</span>
            <div class="trash-banner-actions">
                <button class="trash-banner-restore" type="button">${t('Восстановить')}</button>
                <button class="trash-banner-delete" type="button">${t('Удалить навсегда')}</button>
            </div>
        `;
        document.querySelector('.toolbar').before(banner);
        banner.querySelector('.trash-banner-restore').addEventListener('click', () => restoreNote(note.id));
        banner.querySelector('.trash-banner-delete').addEventListener('click', () => {
            showPermanentDeleteConfirmNotification(note.id);
        });
    }
    function removeTrashBanner() {
        const banner = document.getElementById('trashBanner');
        if (banner)
            banner.remove();
        el.noteTitle.disabled = false;
        el.noteContent.contentEditable = 'true';
    }
    async function selectNote(id) {
        if (activeNoteId !== id) {
            await persistActiveNote();
            activeNoteId = id;
        }
        if (window.innerWidth <= 760) {
            el.body.classList.add('editor-fullscreen');
        }
        updateFullscreenIcon();
        renderEditor();
        renderNotesList();
    }
    async function persistActiveNote(force = false) {
        const note = getNote(activeNoteId);
        if (!note)
            return false;
        if (note.secret && (note.locked || !vaultKey))
            return false;
        const newTitle = el.noteTitle.value.trim();
        const newContent = el.noteContent.innerHTML;
        const changed = note.title !== newTitle ||
            note.content !== newContent;
        if (!changed && !force) {
            setNoteSaveStatus('saved');
            return true;
        }
        if (!currentUser) {
            setNoteSaveStatus('error');
            return false;
        }
        const requestId = ++saveRequestId;
        note.title = newTitle;
        note.content = newContent;
        note.updatedAt = Date.now();
        setNoteSaveStatus('saving');
        try {
            await saveNote(note);
            if (requestId !== saveRequestId) {
                return false;
            }
            setNoteSaveStatus(navigator.onLine ? 'saved' : 'local');
            return true;
        }
        catch (error) {
            if (requestId === saveRequestId) {
                setNoteSaveStatus('error');
            }
            handleFirebaseError(error);
            return false;
        }
    }
    let autosaveTimer = null;
    const SAVE_STATUS_KEY = 'startNotes.saveStatusVisible';
    let saveStatusVisible = true;
    let saveRequestId = 0;
    function loadSaveStatusVisibility() {
        try {
            saveStatusVisible =
                localStorage.getItem(SAVE_STATUS_KEY) !== 'false';
        }
        catch (e) {
            saveStatusVisible = true;
        }
        applySaveStatusVisibility();
        updateSaveStatusToggle();
    }
    function applySaveStatusVisibility() {
        if (!el.noteSaveStatus)
            return;
        el.noteSaveStatus.hidden = !saveStatusVisible;
    }
    function setNoteSaveStatus(status) {
        if (!el.noteSaveStatus)
            return;
        el.noteSaveStatus.dataset.status = status;
        const text = el.noteSaveStatus.querySelector('.note-save-text');
        if (!text)
            return;
        if (status === 'saving') {
            text.textContent = t('Сохранение…');
        }
        else if (status === 'error') {
            text.textContent = t('Не сохранено');
        }
        else if (status === 'local') {
            text.textContent = t('На устройстве');
        }
        else {
            text.textContent = t('Сохранено');
        }
    }
    function setSaveStatusVisible(visible) {
        saveStatusVisible = visible;
        try {
            localStorage.setItem(SAVE_STATUS_KEY, String(visible));
        }
        catch (e) { }
        applySaveStatusVisibility();
    }
    function debouncedAutosave() {
        clearTimeout(autosaveTimer);
        autosaveTimer = setTimeout(() => {
            persistActiveNote();
            renderNotesList();
        }, 500);
    }
    async function togglePin() {
        const note = getNote(activeNoteId);
        if (!note || note.secret)
            return;
        note.pinned = !note.pinned;
        note.updatedAt = Date.now();
        updatePinButton(note.pinned);
        renderNotesList();
        try {
            await saveNote(note);
        }
        catch (error) {
            handleFirebaseError(error);
        }
    }
    async function moveToTrash(id) {
        const index = notes.findIndex(n => n.id === id);
        if (index === -1)
            return;
        const backup = JSON.parse(JSON.stringify(notes[index]));
        backup.deletedAt = Date.now();
        notes.splice(index, 1);
        trashedNotes.unshift(backup);
        if (activeNoteId === id) {
            activeNoteId = firstOpenNoteId();
            removeTrashBanner();
            renderEditor();
        }
        renderNotesList();
        renderTrash();
        showUndoNotification(backup, index);
        try {
            await trashWrite(backup);
            await deleteDoc(doc(db, "users", currentUser.uid, "notes", id));
        }
        catch (error) {
            handleFirebaseError(error);
        }
    }
    async function openTrashedNote(id) {
        const note = getTrashedNote(id);
        if (!note)
            return;
        if (note.secret && note.locked) {
            const unlocked = await requestUnlock();
            if (!unlocked || note.locked)
                return;
        }
        await persistActiveNote();
        activeNoteId = id;
        if (window.innerWidth <= 760) {
            el.body.classList.add('editor-fullscreen');
        }
        updateFullscreenIcon();
        el.noteTitle.value = note.title || '';
        el.noteTitle.disabled = true;
        el.noteContent.innerHTML = note.content;
        setNoteSaveStatus('saved');
        el.noteContent.contentEditable = 'false';
        updateSecretBadge(note, true);
        updatePinButton(note.pinned);
        applyGoogleSans();
        renderTags(note);
        renderFormulas();
        updateFormatButtonsState();
        renderTrashBanner(note);
        refreshFind(true);
        if (note.id !== lastRenderedNoteId)
            animateNoteEnter();
        lastRenderedNoteId = note.id;
        renderNotesList();
        renderTrash();
    }
    async function restoreNote(id) {
        const idx = trashedNotes.findIndex(n => n.id === id);
        if (idx === -1)
            return;
        if (trashedNotes[idx].secret && trashedNotes[idx].locked)
            return;
        const note = { ...trashedNotes[idx] };
        delete note.deletedAt;
        trashedNotes.splice(idx, 1);
        notes.unshift(note);
        activeNoteId = note.id;
        removeTrashBanner();
        renderNotesList();
        renderTrash();
        renderEditor();
        try {
            await saveNote(note);
            await deleteDoc(doc(db, "users", currentUser.uid, "trash", id));
        }
        catch (error) {
            handleFirebaseError(error);
        }
    }
    async function permanentlyDeleteNote(id) {
        const idx = trashedNotes.findIndex(n => n.id === id);
        if (idx === -1)
            return;
        const backup = { ...trashedNotes[idx] };
        trashedNotes.splice(idx, 1);
        if (activeNoteId === id) {
            activeNoteId = pickNextNoteId();
            removeTrashBanner();
            renderEditor();
        }
        renderNotesList();
        renderTrash();
        try {
            await deleteDoc(doc(db, "users", currentUser.uid, "trash", id));
        }
        catch (error) {
            handleFirebaseError(error);
            return;
        }
        showPermanentDeleteUndoNotification(backup, idx);
    }
    const COMMAND_MAP = {
        bold: 'bold',
        italic: 'italic',
    };
    const EMPTY_FORMAT_TAGS = { bold: ['B', 'STRONG'], italic: ['I', 'EM'] };
    function applyFormat(action) {
        const command = COMMAND_MAP[action];
        if (!command)
            return;
        el.noteContent.focus();
        if (!(queryState(command) && unwrapEmptyFormatting(EMPTY_FORMAT_TAGS[action]))) {
            document.execCommand(command, false, null);
        }
        updateFormatButtonsState();
        debouncedAutosave();
    }
    function toggleCode() {
        el.noteContent.focus();
        const sel = window.getSelection();
        if (!sel || sel.rangeCount === 0)
            return;
        const range = sel.getRangeAt(0);
        const pre = getAncestorTag(range.startContainer, 'PRE');
        if (pre) {
            const p = document.createElement('p');
            p.innerHTML = pre.textContent || '<br>';
            pre.replaceWith(p);
            placeCursorAtEnd(p);
            updateFormatButtonsState();
            debouncedAutosave();
            return;
        }
        let block = getAncestorBlock(range.startContainer);
        if (block && block.tagName !== 'P' && block.tagName !== 'DIV') {
            const plain = exitToParagraph(block);
            placeCursorAtEnd(plain);
        }
        const currentRange = sel.getRangeAt(0);
        const newPre = document.createElement('pre');
        const code = document.createElement('code');
        if (currentRange.collapsed) {
            code.innerHTML = '<br>';
        }
        else {
            code.appendChild(currentRange.extractContents());
        }
        newPre.appendChild(code);
        currentRange.insertNode(newPre);
        const p = document.createElement('p');
        p.innerHTML = '<br>';
        newPre.after(p);
        const r = document.createRange();
        r.selectNodeContents(code);
        r.collapse(currentRange.collapsed);
        sel.removeAllRanges();
        sel.addRange(r);
        updateFormatButtonsState();
        debouncedAutosave();
    }
    function showFormulaPopoverForElement(formulaElement) {
        closeAllDropdowns('formula-edit');
        const savedFormula = formulaElement.dataset.formula || '';
        const popover = document.createElement('div');
        popover.className = 'link-popover formula-popover';
        popover.innerHTML = `
        <div class="notification-title">${t('Изменить формулу')}</div>

        <input
            type="text"
            class="link-popover-input formula-input"
            value="${escapeHtml(savedFormula)}"
            autocomplete="off"
            spellcheck="false"
        >

        <div class="formula-preview-label">${t('Предпросмотр')}</div>

        <div class="formula-preview">
        </div>

        <div class="notification-actions">
            <button class="notification-cancel" type="button">
                ${t('Отмена')}
            </button>

            <button class="notification-confirm apply" type="button">
                ${t('Применить')}
            </button>
        </div>
    `;
        document.body.appendChild(popover);
        const input = popover.querySelector('.formula-input');
        const preview = popover.querySelector('.formula-preview');
        input.focus();
        input.select();
        const renderPreview = () => {
            const value = input.value.trim();
            preview.textContent = '';
            if (!value) {
                preview.textContent = '';
                return;
            }
            if (window.katex) {
                try {
                    window.katex.render(value, preview, {
                        displayMode: false,
                        throwOnError: false
                    });
                }
                catch {
                    preview.textContent = value;
                }
            }
        };
        input.addEventListener('input', renderPreview);
        renderPreview();
        placeDropdown(popover, formulaElement);
        requestAnimationFrame(() => {
            popover.classList.add('visible');
        });
        function apply() {
            const value = input.value.trim();
            if (!value)
                return;
            formulaElement.dataset.formula = value;
            closeFormulaEditPopover();
            renderFormulas();
            debouncedAutosave();
        }
        popover.querySelector('.apply').addEventListener('click', apply);
        popover.querySelector('.notification-cancel').addEventListener('click', closeFormulaEditPopover);
        input.addEventListener('keydown', e => {
            if (e.key === 'Enter') {
                e.preventDefault();
                apply();
            }
            if (e.key === 'Escape') {
                e.preventDefault();
                closeFormulaEditPopover();
            }
        });
        activeFormulaEditPopover = popover;
        setTimeout(() => {
            document.addEventListener('mousedown', handleFormulaEditOutsideClick);
        }, 0);
    }
    let activeFormulaEditPopover = null;
    function closeFormulaEditPopover() {
        if (!activeFormulaEditPopover)
            return;
        dismissDropdown(activeFormulaEditPopover);
        activeFormulaEditPopover = null;
        document.removeEventListener('mousedown', handleFormulaEditOutsideClick);
    }
    function handleFormulaEditOutsideClick(e) {
        if (activeFormulaEditPopover &&
            !activeFormulaEditPopover.contains(e.target)) {
            closeFormulaEditPopover();
        }
    }
    function updateLinkButtonVisibility() {
        const sel = window.getSelection();
        let show = false;
        if (sel && sel.rangeCount > 0) {
            const range = sel.getRangeAt(0);
            const inEditor = el.noteContent.contains(range.commonAncestorContainer);
            if (inEditor) {
                if (!sel.isCollapsed) {
                    show = true;
                }
                else if (getAncestorTag(range.startContainer, 'A')) {
                    show = true;
                }
            }
        }
        el.linkToolbarSection.classList.add('visible');
    }
    function getAncestorTag(node, tag) {
        tag = tag.toUpperCase();
        let cur = node.nodeType === 3 ? node.parentElement : node;
        while (cur && cur !== el.noteContent) {
            if (cur.tagName === tag) {
                return cur;
            }
            cur = cur.parentElement;
        }
        return null;
    }
    function getAncestorBlock(node) {
        let cur = node.nodeType === 3 ? node.parentElement : node;
        while (cur && cur !== el.noteContent) {
            const style = window.getComputedStyle(cur);
            if (style.display === 'block' ||
                /^H[1-6]$/.test(cur.tagName) ||
                cur.tagName === 'P' ||
                cur.tagName === 'DIV' ||
                cur.tagName === 'LI' ||
                cur.tagName === 'BLOCKQUOTE') {
                return cur;
            }
            cur = cur.parentElement;
        }
        return null;
    }
    function updateFormatButtonsState() {
        updateLinkButtonVisibility();
        el.formatButtons.forEach(btn => {
            let active = false;
            try {
                active = document.queryCommandState(COMMAND_MAP[btn.dataset.action]);
            }
            catch (e) { }
            btn.classList.toggle('active', active);
        });
        const sel = window.getSelection();
        const codeActive = sel && sel.rangeCount > 0
            ? !!getAncestorTag(sel.getRangeAt(0).startContainer, 'PRE')
            : false;
        el.codeBtn.classList.toggle('active', codeActive);
        const block = sel && sel.rangeCount
            ? getAncestorBlock(sel.getRangeAt(0).startContainer)
            : null;
        el.h1Btn.classList.toggle('active', block?.tagName === 'H1');
        el.h2Btn.classList.toggle('active', block?.tagName === 'H2');
        el.h3Btn.classList.toggle('active', block?.tagName === 'H3');
        el.quoteBtn.classList.toggle('active', block?.tagName === 'BLOCKQUOTE');
        const isChecklistBlock = block?.tagName === 'LI' && block.classList.contains('checklist-item');
        el.listULBtn.classList.toggle('active', block?.tagName === 'LI' && block.parentElement?.tagName === 'UL' && !isChecklistBlock);
        el.listOLBtn.classList.toggle('active', block?.tagName === 'LI' && block.parentElement?.tagName === 'OL');
        if (el.checklistBtn)
            el.checklistBtn.classList.toggle('active', isChecklistBlock);
        const linkActive = sel && sel.rangeCount > 0
            ? !!getAncestorTag(sel.getRangeAt(0).startContainer, 'A')
            : false;
        el.linkBtn.classList.toggle('active', linkActive);
        const activeU = selectionUnderline();
        const activeUnderlineStyle = queryState('underline')
            ? ((activeU && activeU.dataset.style) || pendingUnderlineStyle)
            : null;
        el.underlineBtns.forEach(btn => {
            btn.classList.toggle('active', btn.dataset.underlineStyle === activeUnderlineStyle);
        });
        el.strikeBtn.classList.toggle('active', queryState('strikeThrough'));
    }
    function knownTags(exclude = []) {
        const counts = new Map();
        const skip = new Set(exclude.map(t => t.toLowerCase()));
        notes.forEach(note => {
            if (note.secret && note.locked)
                return;
            (note.tags || []).forEach(tag => {
                const key = tag.toLowerCase();
                if (skip.has(key))
                    return;
                const entry = counts.get(key) || { tag, count: 0 };
                entry.count++;
                counts.set(key, entry);
            });
        });
        return [...counts.values()]
            .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag, lang))
            .map(entry => entry.tag);
    }
    function addTag() {
        const note = getNote(activeNoteId);
        if (!note)
            return;
        if (el.noteTags.querySelector('.tag-input-wrap'))
            return;
        closeAllDropdowns();
        const wrap = document.createElement('span');
        wrap.className = 'tag-input-wrap';
        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'tag-input';
        input.placeholder = t('название тега');
        input.maxLength = 24;
        wrap.appendChild(input);
        el.noteTags.insertBefore(wrap, el.addTagBtn);
        let done = false;
        const strip = document.createElement('div');
        strip.className = 'tag-suggest-strip';
        el.noteTags.parentElement.classList.add('tagging');
        el.noteTags.after(strip);
        let options = [];
        let highlighted = -1;
        function closeSuggest() {
            el.noteTags.parentElement.classList.remove('tagging');
            strip.remove();
            options = [];
            highlighted = -1;
        }
        function renderSuggest() {
            const query = input.value.trim().toLowerCase();
            options = knownTags(note.tags).filter(tag => !query || tag.toLowerCase().includes(query));
            highlighted = -1;
            strip.innerHTML = options
                .map((tag, i) => `<button type="button" class="tag-suggestion" data-i="${i}" style="--i:${Math.min(i, 8)}">${escapeHtml(tag)}</button>`)
                .join('');
            strip.classList.toggle('empty', !options.length);
            strip.scrollLeft = 0;
            strip.querySelectorAll('.tag-suggestion').forEach(btn => {
                btn.addEventListener('mousedown', e => e.preventDefault());
                btn.addEventListener('click', () => {
                    input.value = options[Number(btn.dataset.i)];
                    commit();
                });
            });
        }
        function moveHighlight(step) {
            if (!options.length)
                return;
            highlighted = (highlighted + step + options.length) % options.length;
            strip.querySelectorAll('.tag-suggestion').forEach((btn, i) => {
                btn.classList.toggle('active', i === highlighted);
                if (i === highlighted)
                    btn.scrollIntoView({ block: 'nearest', inline: 'nearest' });
            });
        }
        function finish() {
            if (done)
                return;
            done = true;
            closeSuggest();
            wrap.remove();
        }
        async function commit() {
            if (done)
                return;
            let val = input.value.trim();
            const known = knownTags().find(tag => tag.toLowerCase() === val.toLowerCase());
            if (known)
                val = known;
            finish();
            if (!val || note.tags.some(tag => tag.toLowerCase() === val.toLowerCase()))
                return;
            note.tags.push(val);
            note.updatedAt = Date.now();
            renderTags(note);
            renderNotesList();
            try {
                await saveNote(note);
            }
            catch (error) {
                handleFirebaseError(error);
            }
        }
        input.addEventListener('keydown', e => {
            if (['ArrowDown', 'ArrowUp', 'ArrowRight', 'ArrowLeft'].includes(e.key) && (e.key === 'ArrowDown' || e.key === 'ArrowUp' || highlighted >= 0)) {
                e.preventDefault();
                moveHighlight(e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : -1);
            }
            if (e.key === 'Enter') {
                e.preventDefault();
                if (highlighted >= 0)
                    input.value = options[highlighted];
                commit();
            }
            if (e.key === 'Escape') {
                e.preventDefault();
                finish();
            }
        });
        input.addEventListener('input', renderSuggest);
        input.addEventListener('blur', () => {
            setTimeout(() => commit(), 100);
        });
        input.focus();
        renderSuggest();
    }
    function getNotificationContainer() {
        let c = document.getElementById('notificationContainer');
        if (!c) {
            c = document.createElement('div');
            c.id = 'notificationContainer';
            c.className = 'notification-container';
            document.body.appendChild(c);
        }
        return c;
    }
    function showNotification(html, onMount) {
        const n = document.createElement('div');
        n.className = 'notification';
        n.innerHTML = html;
        getNotificationContainer().appendChild(n);
        requestAnimationFrame(() => n.classList.add('visible'));
        if (onMount)
            onMount(n);
        function hide() {
            n.classList.remove('visible');
            setTimeout(() => n.remove(), 300);
        }
        return { el: n, hide };
    }
    function showPermanentDeleteConfirmNotification(noteId) {
        const { el: n, hide } = showNotification(`
        <div class="notification-title">${t('Удалить заметку навсегда?')}</div>
        <div class="notification-text">
            ${t('Это действие нельзя отменить.')}
        </div>
        <div class="notification-actions">
            <button class="notification-cancel" type="button">${t('Отмена')}</button>
            <button class="notification-confirm danger" type="button">${t('Удалить')}</button>
        </div>
    `);
        n.querySelector('.notification-cancel').addEventListener('click', hide);
        n.querySelector('.notification-confirm').addEventListener('click', async () => {
            hide();
            await permanentlyDeleteNote(noteId);
        });
    }
    let clearTrashNotificationHide = null;
    function showClearTrashConfirmNotification() {
        const count = trashedNotes.length;
        if (!count || clearTrashNotificationHide)
            return;
        const hasSecret = trashedNotes.some(n => n.secret);
        const { el: n, hide } = showNotification(`
            <div class="notification-title">${t('Очистить корзину?')}</div>
            <div class="notification-text">
            ${t('Все заметки из корзины будут удалены навсегда и без возможности глянуть ещё раз 👀')}
            </div>
            <div class="notification-actions">
                <button class="notification-cancel" type="button">${t('Отмена')}</button>
                <button class="notification-confirm danger" type="button">${t('Очистить')}</button>
            </div>
        `);
        const close = () => {
            hide();
            clearTrashNotificationHide = null;
        };
        clearTrashNotificationHide = close;
        n.querySelector('.notification-cancel').addEventListener('click', close);
        n.querySelector('.notification-confirm').addEventListener('click', () => {
            close();
            emptyTrash();
        });
    }
    async function emptyTrash() {
        if (!currentUser || !trashedNotes.length)
            return;
        const ids = trashedNotes.map(n => n.id);
        const openedFromTrash = ids.includes(activeNoteId);
        trashedNotes = [];
        if (openedFromTrash) {
            activeNoteId = pickNextNoteId();
            removeTrashBanner();
            renderEditor();
        }
        renderTrash();
        renderNotesList();
        try {
            await Promise.all(ids.map(id => deleteDoc(doc(db, "users", currentUser.uid, "trash", id))));
            showToast(t('Корзина очищена'), t('Заметки отправились в далёкий путь: в вечную корзину 🫡'), 3000);
        }
        catch (error) {
            handleFirebaseError(error);
            showToast(t('Не всё удалилось'), t('Возможно, проблемы с интернетом.'));
            try {
                await loadTrash();
                renderTrash();
            }
            catch (e) {
                console.error(e);
            }
        }
    }
    function showDeleteConfirmNotification(noteId) {
        const { el: n, hide } = showNotification(`
            <div class="notification-title">${t('Удалить заметку?')}</div>
            <div class="notification-text">${t('Заметка будет перемещена в корзину. Её можно восстановить в течение 15 дней.')}</div>
            <div class="notification-actions">
                <button class="notification-cancel" type="button">${t('Отмена')}</button>
                <button class="notification-confirm danger" type="button">${t('Удалить')}</button>
            </div>
        `);
        n.querySelector('.notification-cancel').addEventListener('click', hide);
        n.querySelector('.notification-confirm').addEventListener('click', () => { hide(); moveToTrash(noteId); });
    }
    function showUndoNotification(noteBackup, originalIndex) {
        const DELAY = 5000;
        const { el: n, hide } = showNotification(`
            <div class="notification-title">
                ${t('Заметка удалена')}
                <span class="notification-timer">5</span>
            </div>
            <div class="notification-actions">
                <button class="notification-undo" type="button">${t('Отменить')}</button>
            </div>
            <div class="notification-progress">
                <div class="notification-progress-bar"></div>
            </div>
        `, notifEl => {
            const bar = notifEl.querySelector('.notification-progress-bar');
            requestAnimationFrame(() => {
                bar.style.transition = `width ${DELAY}ms linear`;
                requestAnimationFrame(() => { bar.style.width = '0%'; });
            });
        });
        const timerEl = n.querySelector('.notification-timer');
        let secondsLeft = 5;
        const ticker = setInterval(() => {
            secondsLeft--;
            if (timerEl)
                timerEl.textContent = secondsLeft;
            if (secondsLeft <= 0)
                clearInterval(ticker);
        }, 1000);
        function hideWithCleanup() { clearInterval(ticker); hide(); }
        n.querySelector('.notification-undo').addEventListener('click', async () => {
            const trashIdx = trashedNotes.findIndex(t => t.id === noteBackup.id);
            if (trashIdx !== -1)
                trashedNotes.splice(trashIdx, 1);
            const restored = { ...noteBackup };
            delete restored.deletedAt;
            notes.splice(Math.min(originalIndex, notes.length), 0, restored);
            activeNoteId = restored.id;
            removeTrashBanner();
            renderNotesList();
            renderTrash();
            renderEditor();
            hideWithCleanup();
            try {
                await saveNote(restored);
                await deleteDoc(doc(db, "users", currentUser.uid, "trash", noteBackup.id));
            }
            catch (error) {
                handleFirebaseError(error);
            }
        });
        setTimeout(() => { hideWithCleanup(); }, DELAY);
    }
    function showPermanentDeleteUndoNotification(noteBackup, originalIndex) {
        const DELAY = 5000;
        const { el: n, hide } = showNotification(`
        <div class="notification-title">
            ${t('Заметка удалена навсегда')}
            <span class="notification-timer">5</span>
        </div>

        <div class="notification-actions">
            <button class="notification-undo" type="button">
                ${t('Отменить')}
            </button>
        </div>

        <div class="notification-progress">
            <div class="notification-progress-bar"></div>
        </div>
    `, notifEl => {
            const bar = notifEl.querySelector('.notification-progress-bar');
            requestAnimationFrame(() => {
                bar.style.transition = `width ${DELAY}ms linear`;
                requestAnimationFrame(() => {
                    bar.style.width = '0%';
                });
            });
        });
        const timerEl = n.querySelector('.notification-timer');
        let secondsLeft = 5;
        const ticker = setInterval(() => {
            secondsLeft--;
            if (timerEl) {
                timerEl.textContent = secondsLeft;
            }
            if (secondsLeft <= 0) {
                clearInterval(ticker);
            }
        }, 1000);
        function hideWithCleanup() {
            clearInterval(ticker);
            hide();
        }
        n.querySelector('.notification-undo').addEventListener('click', async () => {
            trashedNotes.splice(Math.min(originalIndex, trashedNotes.length), 0, noteBackup);
            try {
                await trashWrite(noteBackup);
            }
            catch (error) {
                handleFirebaseError(error);
                return;
            }
            activeNoteId = noteBackup.id;
            renderNotesList();
            renderTrash();
            await openTrashedNote(noteBackup.id);
            hideWithCleanup();
        });
        setTimeout(() => {
            hideWithCleanup();
        }, DELAY);
    }
    let syncNotification = null;
    function handleFirebaseError(error) {
        console.error(error);
        if (error.code === "permission-denied" ||
            error.code === "unauthenticated" ||
            error.code === "auth/user-token-expired") {
            showAuthErrorNotification();
        }
    }
    function applyHeading(tag) {
        el.noteContent.focus();
        const sel = window.getSelection();
        if (!sel.rangeCount)
            return;
        let block = getAncestorBlock(sel.getRangeAt(0).startContainer);
        if (!block) {
            block = document.createElement('p');
            block.innerHTML = '<br>';
            el.noteContent.appendChild(block);
        }
        if (block.tagName === tag) {
            const p = exitToParagraph(block);
            placeCursorAtEnd(p);
            debouncedAutosave();
            updateFormatButtonsState();
            return;
        }
        const plain = exitToParagraph(block);
        const newBlock = document.createElement(tag);
        newBlock.innerHTML = plain.innerHTML || '<br>';
        plain.replaceWith(newBlock);
        placeCursorAtEnd(newBlock);
        debouncedAutosave();
        updateFormatButtonsState();
    }
    let activeLinkPopover = null;
    function normalizeUrl(raw) {
        let url = (raw || '').trim();
        if (!url)
            return null;
        if (!/^[a-z][a-z0-9+.-]*:/i.test(url)) {
            url = 'https://' + url;
        }
        try {
            const parsed = new URL(url);
            if (!['http:', 'https:', 'mailto:'].includes(parsed.protocol))
                return null;
            return parsed.href;
        }
        catch {
            return null;
        }
    }
    function closeLinkPopover() {
        if (!activeLinkPopover)
            return;
        dismissDropdown(activeLinkPopover);
        activeLinkPopover = null;
        document.removeEventListener('mousedown', handleLinkPopoverOutsideClick);
    }
    function handleLinkPopoverOutsideClick(e) {
        if (activeLinkPopover && !activeLinkPopover.contains(e.target) &&
            !(activeLinkPopover._anchor && activeLinkPopover._anchor.contains(e.target))) {
            closeLinkPopover();
        }
    }
    let accountPanel = null;
    const GOOGLE_ICON = '<svg viewBox="0 0 24 24" width="26" height="26" fill="currentColor"><path d="M20.283 10.356h-8.327v3.451h4.792c-.446 2.193-2.313 3.453-4.792 3.453a5.27 5.27 0 0 1-5.279-5.28 5.27 5.27 0 0 1 5.279-5.279c1.259 0 2.397.447 3.29 1.178l2.6-2.599c-1.584-1.381-3.615-2.233-5.89-2.233a8.908 8.908 0 0 0-8.934 8.934 8.907 8.907 0 0 0 8.934 8.934c4.467 0 8.529-3.249 8.529-8.934 0-.528-.081-1.097-.202-1.625z"/></svg>';
    const GITHUB_ICON = '<svg viewBox="0 0 24 24" width="26" height="26" fill="currentColor"><path fill-rule="evenodd" clip-rule="evenodd" d="M12.026 2c-5.509 0-9.974 4.465-9.974 9.974 0 4.406 2.857 8.145 6.821 9.465.499.09.679-.217.679-.481 0-.237-.008-.865-.011-1.696-2.775.602-3.361-1.338-3.361-1.338-.452-1.152-1.107-1.459-1.107-1.459-.905-.619.069-.605.069-.605 1.002.07 1.527 1.028 1.527 1.028.89 1.524 2.336 1.084 2.902.829.091-.645.351-1.085.635-1.334-2.214-.251-4.542-1.107-4.542-4.93 0-1.087.389-1.979 1.024-2.675-.101-.253-.446-1.268.099-2.64 0 0 .837-.269 2.742 1.021a9.582 9.582 0 0 1 2.496-.336 9.554 9.554 0 0 1 2.496.336c1.906-1.291 2.742-1.021 2.742-1.021.545 1.372.203 2.387.099 2.64.64.696 1.024 1.587 1.024 2.675 0 3.833-2.33 4.675-4.552 4.922.355.308.675.916.675 1.846 0 1.334-.012 2.41-.012 2.737 0 .267.178.577.687.479C19.146 20.115 22 16.379 22 11.974 22 6.465 17.535 2 12.026 2z"/></svg>';
    const DISCORD_ICON = '<svg viewBox="0 0 24 24" width="26" height="26" fill="currentColor"><path d="M14.82 4.26a10.14 10.14 0 0 0-.53 1.1 14.66 14.66 0 0 0-4.58 0 10.14 10.14 0 0 0-.53-1.1 16 16 0 0 0-4.13 1.3 17.33 17.33 0 0 0-3 11.59 16.6 16.6 0 0 0 5.07 2.59A12.89 12.89 0 0 0 8.23 18a9.65 9.65 0 0 1-1.71-.83 3.39 3.39 0 0 0 .42-.33 11.66 11.66 0 0 0 10.12 0q.21.18.42.33a10.84 10.84 0 0 1-1.71.84 12.41 12.41 0 0 0 1.08 1.78 16.44 16.44 0 0 0 5.06-2.59 17.22 17.22 0 0 0-3-11.59 16.09 16.09 0 0 0-4.09-1.35zM8.68 14.81a1.94 1.94 0 0 1-1.8-2 1.93 1.93 0 0 1 1.8-2 1.93 1.93 0 0 1 1.8 2 1.93 1.93 0 0 1-1.8 2zm6.64 0a1.94 1.94 0 0 1-1.8-2 1.93 1.93 0 0 1 1.8-2 1.92 1.92 0 0 1 1.8 2 1.92 1.92 0 0 1-1.8 2z"/></svg>';
    const FIGMA_ICON = '<svg viewBox="0 0 24 24" width="26" height="26" fill="currentColor"><path d="M15.332 8.668a3.333 3.333 0 0 0 0-6.663H8.668a3.333 3.333 0 0 0 0 6.663 3.333 3.333 0 0 0 0 6.665 3.333 3.333 0 0 0 0 6.664A3.334 3.334 0 0 0 12 18.664V8.668h3.332z"/><circle cx="15.332" cy="12" r="3.332"/></svg>';
    const PROVIDERS = [
        ['google', GOOGLE_ICON],
        ['github', GITHUB_ICON],
        ['discord', DISCORD_ICON],
        // ['figma', FIGMA_ICON],
    ];
    function providerButtonsHtml(className) {
        return PROVIDERS.map(([provider, icon]) => `
        <button type="button" class="${className}" data-provider="${provider}">
            <span class="provider-icon">${icon}</span>
            <span class="provider-label"></span>
            <span class="provider-spinner"></span>
        </button>
    `).join('');
    }
    async function loginWith(provider, scope) {
        const buttons = scope ? Array.from(scope.querySelectorAll('[data-provider]')) : [];
        const clicked = buttons.find(b => b.dataset.provider === provider);
        buttons.forEach(b => { b.disabled = true; });
        if (clicked)
            clicked.classList.add('is-loading');
        if (currentUser)
            await saveBeforeLeaving();
        try {
            await login(provider);
            closeAccountPanel();
        }
        catch (error) {
            handleFirebaseError(error);
            const code = error && error.code;
            if (code === 'auth/account-exists-with-different-credential') {
                showToast(t('Не получилось войти'), t('Этот адрес уже связан с другим способом входа. Попробуйте тот, через который создавался аккаунт.'), 6000);
            }
            else if (code !== 'auth/popup-closed-by-user' && code !== 'auth/cancelled-popup-request') {
                showToast(t('Не получилось войти'), t('Похоже, вход не завершился. Проверьте подключение и попробуйте ещё раз.'));
            }
        }
        finally {
            buttons.forEach(b => { b.disabled = false; });
            if (clicked)
                clicked.classList.remove('is-loading');
        }
    }
    function bindProviderButtons(scope) {
        scope.querySelectorAll('[data-provider]').forEach(btn => {
            btn.addEventListener('click', () => loginWith(btn.dataset.provider, scope));
        });
    }
    async function saveBeforeLeaving() {
        clearTimeout(autosaveTimer);
        try {
            await persistActiveNote();
        }
        catch (error) {
            console.error(error);
        }
    }
    function handleAccountPanelOutsideClick(e) {
        const footer = el.loginBtn.closest('.sidebar-footer');
        if (footer && footer.contains(e.target))
            return;
        closeAccountPanel();
    }
    function handleAccountPanelKeydown(e) {
        if (e.key !== 'Escape')
            return;
        e.preventDefault();
        closeAccountPanel();
        el.loginBtn.focus();
    }
    function closeAccountPanel() {
        if (!accountPanel)
            return;
        const panel = accountPanel.el;
        accountPanel = null;
        el.loginBtn.classList.remove('open');
        el.loginBtn.setAttribute('aria-expanded', 'false');
        document.removeEventListener('mousedown', handleAccountPanelOutsideClick);
        document.removeEventListener('keydown', handleAccountPanelKeydown, true);
        panel.classList.remove('open');
        setTimeout(() => panel.remove(), 240);
    }
    function toggleAccountPanel() {
        if (accountPanel) {
            closeAccountPanel();
            return;
        }
        openAccountPanel(currentUser ? 'account' : 'login');
    }
    function openAccountPanel(mode, options = {}) {
        if (el.body.classList.contains('editor-fullscreen')) {
            el.body.classList.remove('editor-fullscreen');
            updateFullscreenIcon();
        }
        closeSettings();
        let panel = accountPanel && accountPanel.el;
        if (!panel) {
            panel = document.createElement('div');
            panel.className = 'account-panel';
            panel.innerHTML = '<div class="account-panel-inner"><div class="account-panel-card"></div></div>';
            el.loginBtn.before(panel);
            void panel.offsetHeight;
            panel.classList.add('open');
            document.addEventListener('mousedown', handleAccountPanelOutsideClick);
            document.addEventListener('keydown', handleAccountPanelKeydown, true);
        }
        accountPanel = { el: panel, mode };
        el.loginBtn.classList.add('open');
        el.loginBtn.setAttribute('aria-expanded', 'true');
        const card = panel.querySelector('.account-panel-card');
        if (mode === 'switch' && currentUser) {
            renderLoginCard(card, {
                title: t('Сменить аккаунт'),
                text: t('Выберите способ входа'),
                back: true
            });
        }
        else if (mode === 'login' || !currentUser)
            renderLoginCard(card, options);
        else if (mode === 'logout')
            renderLogoutCard(card);
        else
            renderAccountCard(card);
    }
    function renderLoginCard(card, options) {
        card.innerHTML = `
        <div class="account-panel-title"></div>
        <p class="account-panel-text"></p>
        <div class="account-panel-providers">${providerButtonsHtml('provider-btn provider-btn-sm')}</div>
        <p class="account-panel-terms">
            ${t('Продолжая, вы соглашаетесь с')} <a href="/terms" target="_blank" rel="noopener noreferrer">${t('условиями использования')}</a> ${t('и')} <a href="/privacy" target="_blank" rel="noopener noreferrer">${t('политикой конфиденциальности')}</a>
        </p>
    `;
        if (options.back) {
            const actions = document.createElement('div');
            actions.className = 'notification-actions account-panel-actions account-panel-actions-top';
            actions.innerHTML = '<button type="button" class="notification-cancel" data-act="back">' + t('Назад') + '</button>';
            actions.querySelector('button').addEventListener('click', () => openAccountPanel('account'));
            card.querySelector('.account-panel-providers').after(actions);
        }
        card.querySelector('.account-panel-title').textContent = options.title || t('Вход без церемоний');
        card.querySelector('.account-panel-text').textContent =
            options.text || t('Выберите способ входа. При первом входе аккаунт создастся автоматически — без анкет и лишних шагов.');
        bindProviderButtons(card);
        card.querySelector('[data-provider]').focus();
    }
    function renderAccountCard(card) {
        card.innerHTML = `
        <div class="account-panel-user">
            <div class="account-panel-avatar" aria-hidden="true"></div>
            <div class="account-panel-info">
                <strong></strong>
                <span></span>
            </div>
        </div>
        <div class="account-panel-list">
            <button type="button" class="account-panel-option" data-act="switch">
                <img class="account-panel-option-icon" src="enter.svg">
                <span>${t('Сменить аккаунт')}</span>
            </button>
            <button type="button" class="account-panel-option danger" data-act="logout">
                <img class="account-panel-option-icon" src="exit.svg">
                <span>${t('Выйти из аккаунта')}</span>
            </button>
        </div>
    `;
        const name = currentUser.displayName || t('Пользователь');
        const avatar = card.querySelector('.account-panel-avatar');
        avatar.textContent = (currentUser.displayName || currentUser.email || '?').trim().charAt(0).toUpperCase();
        if (currentUser.photoURL) {
            const img = new Image();
            img.referrerPolicy = 'no-referrer';
            img.onload = () => {
                avatar.textContent = '';
                avatar.appendChild(img);
            };
            img.src = currentUser.photoURL;
        }
        card.querySelector('.account-panel-info strong').textContent = name;
        card.querySelector('.account-panel-info span').textContent = currentUser.email || '';
        card.querySelector('[data-act="switch"]').addEventListener('click', () => openAccountPanel('switch'));
        card.querySelector('[data-act="logout"]').addEventListener('click', () => openAccountPanel('logout'));
        card.querySelector('[data-act="switch"]').focus();
    }
    function renderLogoutCard(card) {
        card.innerHTML = `
        <div class="account-panel-title">${t('Выйти из аккаунта?')}</div>
        <p class="account-panel-text">${t('Заметки никуда не убегут. Войти обратно можно в любой момент.')}</p>
        <div class="notification-actions account-panel-actions">
            <button type="button" class="notification-cancel" data-act="back">${t('Остаться')}</button>
            <button type="button" class="notification-confirm danger" data-act="confirm">${t('Выйти')}</button>
        </div>
    `;
        const backBtn = card.querySelector('[data-act="back"]');
        const confirmBtn = card.querySelector('[data-act="confirm"]');
        backBtn.addEventListener('click', () => openAccountPanel('account'));
        confirmBtn.addEventListener('click', async () => {
            confirmBtn.disabled = true;
            backBtn.disabled = true;
            await saveBeforeLeaving();
            try {
                await logout();
            }
            catch (error) {
                confirmBtn.disabled = false;
                backBtn.disabled = false;
                handleFirebaseError(error);
            }
        });
        backBtn.focus();
    }
    let activeFilterDropdown = null;
    const SEARCH_FILTER_LABELS = {
        all: 'везде',
        title: 'по названию',
        content: 'по тексту',
        tags: 'по тегам',
    };
    function closeFilterDropdown() {
        if (!activeFilterDropdown)
            return;
        const dropdown = activeFilterDropdown;
        activeFilterDropdown = null;
        dropdown.classList.remove('visible');
        el.searchFilterBtn.setAttribute('aria-expanded', 'false');
        el.searchFilterBtn.removeAttribute('aria-controls');
        document.removeEventListener('pointerdown', handleFilterDropdownOutsideClick, true);
        document.removeEventListener('keydown', handleFilterDropdownKeydown);
        window.setTimeout(() => dropdown.remove(), 240);
    }
    function handleFilterDropdownOutsideClick(event) {
        if (activeFilterDropdown &&
            !activeFilterDropdown.contains(event.target) &&
            !el.searchFilterBtn.contains(event.target)) {
            closeFilterDropdown();
        }
    }
    function handleFilterDropdownKeydown(event) {
        if (!activeFilterDropdown)
            return;
        if (event.key === 'Escape') {
            event.preventDefault();
            closeFilterDropdown();
            el.searchFilterBtn.focus();
            return;
        }
        const options = Array.from(activeFilterDropdown.querySelectorAll('.search-filter-option'));
        if (!options.length)
            return;
        const currentIndex = options.indexOf(document.activeElement);
        let nextIndex = currentIndex;
        if (event.key === 'ArrowDown')
            nextIndex = currentIndex < 0 ? 0 : (currentIndex + 1) % options.length;
        else if (event.key === 'ArrowUp')
            nextIndex = currentIndex < 0 ? options.length - 1 : (currentIndex - 1 + options.length) % options.length;
        else if (event.key === 'Home')
            nextIndex = 0;
        else if (event.key === 'End')
            nextIndex = options.length - 1;
        else
            return;
        event.preventDefault();
        options[nextIndex].focus();
    }
    function showFilterDropdown() {
        if (activeFilterDropdown) {
            closeFilterDropdown();
            return;
        }
        const sidebarTop = el.searchFilterBtn.closest('.sidebar-top');
        if (!sidebarTop)
            return;

        const dropdown = document.createElement('div');
        dropdown.className = 'search-filter-dropdown';
        dropdown.id = 'searchFilterDropdown';
        dropdown.setAttribute('role', 'menu');
        dropdown.innerHTML = Object.entries(SEARCH_FILTER_LABELS).map(([key, label]) => `
            <button
                type="button"
                role="menuitemradio"
                aria-checked="${key === searchFilter}"
                class="search-filter-option${key === searchFilter ? ' active' : ''}"
                data-filter="${key}"
                tabindex="${key === searchFilter ? '0' : '-1'}">
                <span>${t(label)}</span>
                <span class="search-filter-check" aria-hidden="true"></span>
            </button>
        `).join('');
        sidebarTop.appendChild(dropdown);
        activeFilterDropdown = dropdown;
        el.searchFilterBtn.setAttribute('aria-expanded', 'true');
        el.searchFilterBtn.setAttribute('aria-controls', dropdown.id);

        requestAnimationFrame(() => {
            if (activeFilterDropdown === dropdown) {
                dropdown.classList.add('visible');
                const selected = dropdown.querySelector('.search-filter-option.active');
                if (selected)
                    selected.focus({ preventScroll: true });
            }
        });

        dropdown.querySelectorAll('.search-filter-option').forEach(button => {
            button.addEventListener('click', () => {
                const nextFilter = button.dataset.filter;
                if (!VALID_SEARCH_FILTERS.has(nextFilter))
                    return;
                searchFilter = nextFilter;
                try {
                    localStorage.setItem(SEARCH_FILTER_KEY, searchFilter);
                }
                catch (e) { }
                el.searchFilterBtn.classList.toggle('active', searchFilter !== 'all');
                closeFilterDropdown();
                renderNotesList();
            });
        });
        document.addEventListener('pointerdown', handleFilterDropdownOutsideClick, true);
        document.addEventListener('keydown', handleFilterDropdownKeydown);
    }
    function unwrapLink(a) {
        const parent = a.parentNode;
        while (a.firstChild)
            parent.insertBefore(a.firstChild, a);
        parent.removeChild(a);
        updateFormatButtonsState();
        debouncedAutosave();
    }
    function placeCursorAtEnd(node) {
        const sel = window.getSelection();
        const r = document.createRange();
        r.selectNodeContents(node);
        r.collapse(false);
        sel.removeAllRanges();
        sel.addRange(r);
    }
    function exitToParagraph(block) {
        if (!block)
            return null;
        if (block.tagName === 'PRE') {
            const p = document.createElement('p');
            p.textContent = block.textContent || '';
            block.replaceWith(p);
            return p;
        }
        if (block.tagName === 'LI') {
            return block.classList.contains('checklist-item')
                ? exitChecklistItem(block)
                : exitListItem(block);
        }
        if (block.tagName === 'BLOCKQUOTE' || /^H[1-6]$/.test(block.tagName)) {
            const p = document.createElement('p');
            p.innerHTML = block.innerHTML || '<br>';
            block.replaceWith(p);
            return p;
        }
        return block;
    }
    function unwrapElement(node) {
        const parent = node.parentNode;
        while (node.firstChild)
            parent.insertBefore(node.firstChild, node);
        parent.removeChild(node);
    }
    let pendingUnderlineStyle = 'solid';
    function setUnderlineClass(u, style) {
        u.dataset.style = style;
        u.className = 'u-' + style;
    }
    function normalizeUnderlines() {
        el.noteContent.querySelectorAll('u:not([data-style])').forEach(u => {
            setUnderlineClass(u, pendingUnderlineStyle);
        });
        el.noteContent.querySelectorAll('[data-style]:not(u)').forEach(node => {
            node.removeAttribute('data-style');
            node.classList.remove('u-solid', 'u-dashed', 'u-dotted', 'u-wavy');
            if (!node.getAttribute('class'))
                node.removeAttribute('class');
            if (node.getAttribute('style') === '')
                node.removeAttribute('style');
            if (node.tagName === 'SPAN' && !node.attributes.length)
                unwrapKeepingCaret(node);
        });
    }
    function unwrapKeepingCaret(node) {
        const sel = window.getSelection();
        const range = sel && sel.rangeCount ? sel.getRangeAt(0) : null;
        const hadCaret = range && node.contains(range.startContainer);
        const offset = hadCaret ? range.startOffset : 0;
        const container = hadCaret ? range.startContainer : null;
        unwrapElement(node);
        if (hadCaret && container.isConnected) {
            const r = document.createRange();
            r.setStart(container, Math.min(offset, container.length ?? container.childNodes.length));
            r.collapse(true);
            sel.removeAllRanges();
            sel.addRange(r);
        }
    }
    function unwrapEmptyFormatting(tags) {
        const sel = window.getSelection();
        if (!sel || !sel.rangeCount || !sel.isCollapsed)
            return false;
        let wrapper = null;
        let cur = sel.getRangeAt(0).startContainer;
        cur = cur.nodeType === 3 ? cur.parentElement : cur;
        while (cur && cur !== el.noteContent) {
            if (tags.includes(cur.tagName)) {
                wrapper = cur;
                break;
            }
            cur = cur.parentElement;
        }
        if (!wrapper || wrapper.textContent.replace(/\u200B/g, '') !== '')
            return false;
        let target = wrapper.firstChild;
        while (target && target.nodeType === 1 && target.tagName !== 'BR' && target.firstChild) {
            target = target.firstChild;
        }
        const parent = wrapper.parentNode;
        const next = wrapper.nextSibling;
        unwrapElement(wrapper);
        const r = document.createRange();
        if (target && target.isConnected)
            r.setStartBefore(target);
        else if (next)
            r.setStartBefore(next);
        else
            r.setStart(parent, parent.childNodes.length);
        r.collapse(true);
        sel.removeAllRanges();
        sel.addRange(r);
        return true;
    }
    function selectionUnderline() {
        const sel = window.getSelection();
        if (!sel || !sel.rangeCount)
            return null;
        return getAncestorTag(sel.getRangeAt(0).startContainer, 'U');
    }
    function queryState(command) {
        try {
            return document.queryCommandState(command);
        }
        catch (e) {
            return false;
        }
    }
    function toggleStrike() {
        el.noteContent.focus();
        if (!(queryState('strikeThrough') && unwrapEmptyFormatting(['STRIKE', 'S']))) {
            document.execCommand('strikeThrough', false, null);
        }
        updateFormatButtonsState();
        debouncedAutosave();
    }
    function toggleUnderlineStyle(style) {
        el.noteContent.focus();
        const sel = window.getSelection();
        const u = selectionUnderline();
        const underlined = queryState('underline');
        if (underlined && u && u.dataset.style !== style &&
            (sel.isCollapsed || u.contains(sel.getRangeAt(0).endContainer))) {
            setUnderlineClass(u, style);
            pendingUnderlineStyle = style;
            updateFormatButtonsState();
            debouncedAutosave();
            return;
        }
        if (underlined && !u && pendingUnderlineStyle !== style) {
            pendingUnderlineStyle = style;
            updateFormatButtonsState();
            return;
        }
        pendingUnderlineStyle = style;
        if (!(underlined && unwrapEmptyFormatting(['U']))) {
            document.execCommand('underline', false, null);
        }
        normalizeUnderlines();
        updateFormatButtonsState();
        debouncedAutosave();
    }
    function toggleQuote() {
        el.noteContent.focus();
        const sel = window.getSelection();
        if (!sel.rangeCount)
            return;
        const range = sel.getRangeAt(0);
        if (getAncestorTag(range.startContainer, "PRE"))
            return;
        let block = getAncestorBlock(range.startContainer);
        if (!block) {
            block = document.createElement('p');
            block.innerHTML = '<br>';
            el.noteContent.appendChild(block);
        }
        if (block.tagName === 'BLOCKQUOTE') {
            const p = exitToParagraph(block);
            placeCursorAtEnd(p);
            updateFormatButtonsState();
            debouncedAutosave();
            return;
        }
        const plain = exitToParagraph(block);
        const quote = document.createElement('blockquote');
        quote.innerHTML = plain.innerHTML || '<br>';
        plain.replaceWith(quote);
        placeCursorAtEnd(quote);
        updateFormatButtonsState();
        debouncedAutosave();
    }
    function exitListItem(li) {
        const list = li.parentElement;
        const p = document.createElement('p');
        p.innerHTML = (li.innerHTML.trim() === '' || li.innerHTML.trim() === '<br>')
            ? '<br>'
            : li.innerHTML;
        const items = Array.from(list.children);
        const idx = items.indexOf(li);
        const before = items.slice(0, idx);
        const after = items.slice(idx + 1);
        const parent = list.parentElement;
        const toInsert = [];
        if (before.length) {
            const listBefore = document.createElement(list.tagName.toLowerCase());
            before.forEach(item => listBefore.appendChild(item));
            toInsert.push(listBefore);
        }
        toInsert.push(p);
        if (after.length) {
            const listAfter = document.createElement(list.tagName.toLowerCase());
            after.forEach(item => listAfter.appendChild(item));
            toInsert.push(listAfter);
        }
        toInsert.forEach(node => parent.insertBefore(node, list));
        list.remove();
        return p;
    }
    function getAncestorClass(node, className) {
        let cur = node.nodeType === 3 ? node.parentElement : node;
        while (cur && cur !== el.noteContent) {
            if (cur.classList && cur.classList.contains(className))
                return cur;
            cur = cur.parentElement;
        }
        return null;
    }
    function buildChecklistItem(innerHtml, checked) {
        const li = document.createElement('li');
        li.className = 'checklist-item';
        li.dataset.checked = checked ? 'true' : 'false';
        const text = document.createElement('span');
        text.className = 'checklist-text';
        text.innerHTML = innerHtml || '<br>';
        li.appendChild(text);
        return li;
    }
    function exitChecklistItem(li) {
        const list = li.parentElement;
        const p = document.createElement('p');
        const text = li.querySelector('.checklist-text');
        p.innerHTML = (text.innerHTML.trim() === '' || text.innerHTML.trim() === '<br>')
            ? '<br>'
            : text.innerHTML;
        const items = Array.from(list.children);
        const idx = items.indexOf(li);
        const before = items.slice(0, idx);
        const after = items.slice(idx + 1);
        const parent = list.parentElement;
        const toInsert = [];
        if (before.length) {
            const listBefore = document.createElement('ul');
            listBefore.className = 'checklist';
            before.forEach(item => listBefore.appendChild(item));
            toInsert.push(listBefore);
        }
        toInsert.push(p);
        if (after.length) {
            const listAfter = document.createElement('ul');
            listAfter.className = 'checklist';
            after.forEach(item => listAfter.appendChild(item));
            toInsert.push(listAfter);
        }
        toInsert.forEach(node => parent.insertBefore(node, list));
        list.remove();
        return p;
    }
    function saveSelection() {
        const sel = window.getSelection();
        if (!sel || !sel.rangeCount)
            return null;
        const range = sel.getRangeAt(0);
        if (!el.noteContent.contains(range.commonAncestorContainer)) {
            return null;
        }
        return range.cloneRange();
    }
    function restoreSelection(range) {
        if (!range)
            return;
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
    }
    function closeAllDropdowns(except) {
        if (except !== 'link')
            closeLinkPopover();
        if (except !== 'table')
            closeTablePopover();
        if (except !== 'formula')
            closeFormulaPopover();
        if (except !== 'formula-edit')
            closeFormulaEditPopover();
    }
    function placeDropdown(popover, anchor) {
        popover.classList.add('tool-dropdown');
        const margin = 12;
        const gap = 10;
        const a = anchor.getBoundingClientRect();
        const p = popover.getBoundingClientRect();
        const center = a.left + a.width / 2;
        let left = center - Math.min(28, p.width / 2);
        left = Math.max(margin, Math.min(left, window.innerWidth - p.width - margin));
        let top = a.bottom + gap;
        let above = false;
        if (top + p.height > window.innerHeight - margin && a.top - p.height - gap > margin) {
            top = a.top - p.height - gap;
            above = true;
        }
        const arrow = Math.max(16, Math.min(center - left, p.width - 16));
        popover.style.left = `${left}px`;
        popover.style.top = `${top}px`;
        popover.style.setProperty('--arrow-x', `${arrow}px`);
        popover.classList.toggle('above', above);
        if (anchor.tagName === 'BUTTON') {
            anchor.classList.add('open');
            popover._anchor = anchor;
        }
    }
    function dismissDropdown(popover) {
        if (!popover)
            return;
        if (popover._anchor)
            popover._anchor.classList.remove('open');
        popover.classList.remove('visible');
        popover.classList.add('leaving');
        setTimeout(() => popover.remove(), 160);
    }
    function showLinkPopover({ url = '', withText = false, editing = false, anchor = el.linkBtn, onConfirm, onRemove }) {
        closeAllDropdowns();
        const popover = document.createElement('div');
        popover.className = 'link-popover';
        popover.innerHTML = `
        <div class="notification-title">${editing ? t('Изменить ссылку') : t('Добавить ссылку')}</div>
        ${withText ? '<input type="text" class="link-popover-input link-text-input" placeholder="' + t('Текст ссылки') + '">' : ''}
        <input type="text" class="link-popover-input link-url-input" placeholder="example.com" inputmode="url" autocapitalize="off" spellcheck="false">
        <div class="notification-actions">
            ${editing
            ? '<button class="notification-cancel link-remove" type="button">' + t('Удалить') + '</button>'
            : '<button class="notification-cancel" type="button">' + t('Отмена') + '</button>'}
            <button class="notification-confirm apply" type="button">${t('Применить')}</button>
        </div>
    `;
        document.body.appendChild(popover);
        placeDropdown(popover, anchor);
        requestAnimationFrame(() => popover.classList.add('visible'));
        const urlInput = popover.querySelector('.link-url-input');
        const textInput = popover.querySelector('.link-text-input');
        urlInput.value = url;
        const first = textInput || urlInput;
        first.focus();
        first.select();
        function confirm() {
            const value = normalizeUrl(urlInput.value);
            if (!value) {
                urlInput.focus();
                urlInput.classList.add('invalid');
                return;
            }
            const text = textInput ? textInput.value.trim() : '';
            closeLinkPopover();
            onConfirm(value, text);
        }
        popover.querySelector('.apply').addEventListener('click', confirm);
        if (editing) {
            popover.querySelector('.link-remove').addEventListener('click', () => {
                closeLinkPopover();
                onRemove();
            });
        }
        else {
            popover.querySelector('.notification-cancel').addEventListener('click', closeLinkPopover);
        }
        popover.querySelectorAll('.link-popover-input').forEach(input => {
            input.addEventListener('input', () => input.classList.remove('invalid'));
            input.addEventListener('keydown', e => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    if (input === textInput)
                        urlInput.focus();
                    else
                        confirm();
                }
                if (e.key === 'Escape') {
                    e.preventDefault();
                    closeLinkPopover();
                }
            });
        });
        setTimeout(() => document.addEventListener('mousedown', handleLinkPopoverOutsideClick), 0);
        activeLinkPopover = popover;
    }
    function linkHref(a) {
        return normalizeUrl(a.getAttribute('href') || '') || '';
    }
    function openLink(a) {
        const href = linkHref(a);
        if (href)
            window.open(href, '_blank', 'noopener,noreferrer');
    }
    function editLink(a) {
        showLinkPopover({
            url: a.getAttribute('href') || '',
            editing: true,
            anchor: a,
            onConfirm: url => {
                a.setAttribute('href', url);
                a.target = '_blank';
                a.rel = 'noopener noreferrer';
                debouncedAutosave();
            },
            onRemove: () => unwrapLink(a)
        });
    }
    function showLinkBubble(a) {
        closeAllDropdowns();
        const href = linkHref(a);
        const popover = document.createElement('div');
        popover.className = 'link-popover link-bubble';
        popover.innerHTML = `
        <a class="link-bubble-url" target="_blank" rel="noopener noreferrer"></a>
        <div class="notification-actions">
            <button class="notification-cancel" type="button" data-act="edit">${t('Изменить')}</button>
            <button class="notification-confirm" type="button" data-act="open">${t('Открыть')}</button>
        </div>
    `;
        const urlEl = popover.querySelector('.link-bubble-url');
        urlEl.textContent = href.replace(/^https?:\/\//, '').replace(/\/$/, '') || a.getAttribute('href') || '';
        if (href)
            urlEl.href = href;
        document.body.appendChild(popover);
        placeDropdown(popover, a);
        requestAnimationFrame(() => popover.classList.add('visible'));
        popover.querySelector('[data-act="open"]').addEventListener('click', () => {
            closeLinkPopover();
            openLink(a);
        });
        popover.querySelector('[data-act="edit"]').addEventListener('click', () => editLink(a));
        urlEl.addEventListener('click', () => closeLinkPopover());
        setTimeout(() => document.addEventListener('mousedown', handleLinkPopoverOutsideClick), 0);
        activeLinkPopover = popover;
    }
    function handleNoteLinkClick(e) {
        const a = e.target.closest('a');
        if (!a || !el.noteContent.contains(a))
            return;
        if (!el.noteContent.isContentEditable) {
            e.preventDefault();
            openLink(a);
            return;
        }
        if (e.ctrlKey || e.metaKey) {
            e.preventDefault();
            openLink(a);
            return;
        }
        const sel = window.getSelection();
        if (sel && !sel.isCollapsed)
            return;
        showLinkBubble(a);
    }
    function toggleLink() {
        if (activeLinkPopover && activeLinkPopover._anchor === el.linkBtn) {
            closeLinkPopover();
            return;
        }
        const sel = window.getSelection();
        let range = sel && sel.rangeCount ? sel.getRangeAt(0) : null;
        if (!range || !el.noteContent.contains(range.commonAncestorContainer)) {
            if (!el.noteContent.isContentEditable)
                return;
            range = document.createRange();
            range.selectNodeContents(el.noteContent);
            range.collapse(false);
        }
        const existingLink = getAncestorTag(range.startContainer, 'A');
        if (existingLink) {
            editLink(existingLink);
            return;
        }
        const savedRange = range.cloneRange();
        const collapsed = savedRange.collapsed;
        showLinkPopover({
            withText: collapsed,
            onConfirm: (url, text) => {
                const a = document.createElement('a');
                a.href = url;
                a.target = '_blank';
                a.rel = 'noopener noreferrer';
                if (collapsed) {
                    a.textContent = text || url.replace(/^https?:\/\//, '').replace(/\/$/, '');
                }
                else {
                    try {
                        a.appendChild(savedRange.extractContents());
                    }
                    catch {
                        return;
                    }
                }
                el.noteContent.focus({ preventScroll: true });
                savedRange.insertNode(a);
                const s = window.getSelection();
                const r = document.createRange();
                r.setStartAfter(a);
                r.collapse(true);
                s.removeAllRanges();
                s.addRange(r);
                updateFormatButtonsState();
                debouncedAutosave();
            }
        });
    }
    function showTablePopover() {
        if (activeTablePopover) {
            closeTablePopover();
            return;
        }
        closeAllDropdowns('table');
        const savedRange = saveSelection();
        const popover = document.createElement('div');
        popover.className = 'link-popover table-popover';
        popover.innerHTML = `
        <div class="notification-title">${t('Вставить таблицу')}</div>

        <div class="table-size-grid" id="tableSizeGrid">
            ${Array.from({ length: 36 }, (_, index) => {
            const row = Math.floor(index / 6) + 1;
            const col = index % 6 + 1;
            return `
                    <button
                        type="button"
                        class="table-size-cell"
                        data-rows="${row}"
                        data-cols="${col}"
                    ></button>
                `;
        }).join('')}
        </div>

        <div class="table-size-label" id="tableSizeLabel">
            1 × 1
        </div>
    `;
        document.body.appendChild(popover);
        requestAnimationFrame(() => {
            popover.classList.add('visible');
        });
        const grid = popover.querySelector('#tableSizeGrid');
        const cells = [...popover.querySelectorAll('.table-size-cell')];
        const touch = window.matchMedia('(hover: none)').matches;
        let size = { rows: 0, cols: 0 };
        function select(rows, cols) {
            size = { rows, cols };
            popover.querySelector('#tableSizeLabel').textContent = `${rows} × ${cols}`;
            cells.forEach(item => {
                item.classList.toggle('selected', Number(item.dataset.rows) <= rows && Number(item.dataset.cols) <= cols);
            });
        }
        function insert(rows, cols) {
            closeTablePopover();
            restoreSelection(savedRange);
            insertTable(rows, cols);
        }
        if (touch) {
            popover.classList.add('touch');
            popover.querySelector('#tableSizeLabel').classList.add('hidden-label');
            grid.insertAdjacentHTML('beforebegin', `
                <div class="table-steppers">
                    ${[['rows', t('Строки')], ['cols', t('Столбцы')]].map(([key, title]) => `
                        <div class="table-stepper" data-key="${key}">
                            <span class="table-stepper-title">${title}</span>
                            <div class="table-stepper-controls">
                                <button type="button" data-step="-1">−</button>
                                <span class="table-stepper-value" id="tableSize${key}"></span>
                                <button type="button" data-step="1">+</button>
                            </div>
                        </div>
                    `).join('')}
                </div>
            `);
            popover.insertAdjacentHTML('beforeend', `
                <button type="button" class="notification-confirm table-size-insert">${t('Вставить')}</button>
            `);
            function refresh() {
                popover.querySelector('#tableSizerows').textContent = size.rows;
                popover.querySelector('#tableSizecols').textContent = size.cols;
                popover.querySelectorAll('.table-stepper').forEach(stepper => {
                    const value = size[stepper.dataset.key];
                    stepper.querySelector('[data-step="-1"]').disabled = value <= 1;
                    stepper.querySelector('[data-step="1"]').disabled = value >= 6;
                });
            }
            popover.querySelectorAll('.table-stepper').forEach(stepper => {
                stepper.querySelectorAll('button').forEach(btn => {
                    btn.addEventListener('click', () => {
                        const next = { ...size };
                        next[stepper.dataset.key] = Math.min(6, Math.max(1, next[stepper.dataset.key] + Number(btn.dataset.step)));
                        select(next.rows, next.cols);
                        refresh();
                    });
                });
            });
            popover.querySelector('.table-size-insert').addEventListener('click', () => insert(size.rows, size.cols));
            select(3, 3);
            refresh();
        }
        else {
            cells.forEach(cell => {
                cell.addEventListener('mouseenter', () => select(Number(cell.dataset.rows), Number(cell.dataset.cols)));
                cell.addEventListener('click', () => insert(Number(cell.dataset.rows), Number(cell.dataset.cols)));
            });
        }
        placeDropdown(popover, el.tableBtn);
        setTimeout(() => {
            document.addEventListener('pointerdown', handleTablePopoverOutsideClick);
        }, 0);
        activeTablePopover = popover;
    }
    let activeTablePopover = null;
    function closeTablePopover() {
        if (!activeTablePopover)
            return;
        dismissDropdown(activeTablePopover);
        activeTablePopover = null;
        document.removeEventListener('pointerdown', handleTablePopoverOutsideClick);
    }
    function handleTablePopoverOutsideClick(e) {
        if (activeTablePopover &&
            !activeTablePopover.contains(e.target) &&
            !el.tableBtn.contains(e.target)) {
            closeTablePopover();
        }
    }
    function insertTable(rows, cols) {
        el.noteContent.focus();
        const sel = window.getSelection();
        if (!sel || !sel.rangeCount)
            return;
        const range = sel.getRangeAt(0);
        if (!el.noteContent.contains(range.commonAncestorContainer)) {
            return;
        }
        const table = document.createElement('table');
        table.className = 'note-table';
        const tbody = document.createElement('tbody');
        for (let row = 0; row < rows; row++) {
            const tr = document.createElement('tr');
            for (let col = 0; col < cols; col++) {
                const td = document.createElement('td');
                td.innerHTML = '<br>';
                tr.appendChild(td);
            }
            tbody.appendChild(tr);
        }
        table.appendChild(tbody);
        range.deleteContents();
        range.insertNode(table);
        const paragraph = document.createElement('p');
        paragraph.innerHTML = '<br>';
        table.after(paragraph);
        const newRange = document.createRange();
        newRange.selectNodeContents(table.rows[0].cells[0]);
        newRange.collapse(true);
        sel.removeAllRanges();
        sel.addRange(newRange);
        debouncedAutosave();
    }
    function showFormulaPopover() {
        if (activeFormulaPopover) {
            closeFormulaPopover();
            return;
        }
        closeAllDropdowns('formula');
        const savedRange = saveSelection();
        const popover = document.createElement('div');
        popover.className = 'link-popover formula-popover';
        popover.innerHTML = `
        <div class="notification-title">${t('Вставить формулу')}</div>

        <input
            type="text"
            class="link-popover-input formula-input"
            placeholder="x^2 + y^2 = z^2"
            autocomplete="off"
            spellcheck="false"
        >

        <div class="formula-preview-label">${t('Предпросмотр')}</div>

        <div class="formula-preview">
        </div>

        <div class="notification-actions">
            <button class="notification-cancel" type="button">
                ${t('Отмена')}
            </button>

            <button class="notification-confirm apply" type="button">
                ${t('Вставить')}
            </button>
        </div>
    `;
        document.body.appendChild(popover);
        const input = popover.querySelector('.formula-input');
        const preview = popover.querySelector('.formula-preview');
        placeDropdown(popover, el.formulaBtn);
        const renderPreview = () => {
            const value = input.value.trim();
            preview.innerHTML = '';
            if (!value) {
                preview.textContent = '';
                return;
            }
            if (!window.katex) {
                preview.textContent = value;
                return;
            }
            window.katex.render(value, preview, {
                displayMode: false,
                throwOnError: false,
                output: 'htmlAndMathml'
            });
        };
        function confirm() {
            const formula = input.value.trim();
            if (!formula) {
                input.focus();
                return;
            }
            closeFormulaPopover();
            restoreSelection(savedRange);
            insertFormula(formula);
        }
        input.addEventListener('input', renderPreview);
        popover.querySelector('.apply').addEventListener('click', confirm);
        popover
            .querySelector('.notification-cancel')
            .addEventListener('click', closeFormulaPopover);
        input.addEventListener('keydown', e => {
            if (e.key === 'Enter') {
                e.preventDefault();
                confirm();
            }
            if (e.key === 'Escape') {
                e.preventDefault();
                closeFormulaPopover();
            }
        });
        activeFormulaPopover = popover;
        setTimeout(() => {
            document.addEventListener('mousedown', handleFormulaPopoverOutsideClick);
        }, 0);
        requestAnimationFrame(() => {
            popover.classList.add('visible');
            input.focus();
        });
        renderPreview();
    }
    let activeFormulaPopover = null;
    function closeFormulaPopover() {
        if (!activeFormulaPopover)
            return;
        dismissDropdown(activeFormulaPopover);
        activeFormulaPopover = null;
        document.removeEventListener('mousedown', handleFormulaPopoverOutsideClick);
    }
    function handleFormulaPopoverOutsideClick(e) {
        if (activeFormulaPopover &&
            !activeFormulaPopover.contains(e.target) &&
            !el.formulaBtn.contains(e.target)) {
            closeFormulaPopover();
        }
    }
    function insertFormula(formula) {
        el.noteContent.focus();
        const sel = window.getSelection();
        if (!sel || !sel.rangeCount)
            return;
        const range = sel.getRangeAt(0);
        if (!el.noteContent.contains(range.commonAncestorContainer)) {
            return;
        }
        const formulaElement = document.createElement('span');
        formulaElement.className = 'note-formula';
        formulaElement.dataset.formula = formula;
        formulaElement.contentEditable = 'false';
        formulaElement.textContent = '';
        range.deleteContents();
        range.insertNode(formulaElement);
        const after = document.createTextNode('\u200B');
        formulaElement.after(after);
        const newRange = document.createRange();
        newRange.setStartAfter(after);
        newRange.collapse(true);
        sel.removeAllRanges();
        sel.addRange(newRange);
        renderFormulas();
        debouncedAutosave();
    }
    function renderFormulas() {
        if (!window.katex || !el.noteContent)
            return;
        const formulas = el.noteContent.querySelectorAll('.note-formula');
        formulas.forEach(formulaElement => {
            const formula = formulaElement.dataset.formula;
            if (!formula)
                return;
            try {
                window.katex.render(formula, formulaElement, {
                    displayMode: false,
                    throwOnError: false
                });
            }
            catch {
                formulaElement.textContent = formula;
            }
        });
    }
    function toggleChecklist() {
        el.noteContent.focus();
        const sel = window.getSelection();
        if (!sel.rangeCount)
            return;
        const range = sel.getRangeAt(0);
        if (getAncestorTag(range.startContainer, "PRE"))
            return;
        const item = getAncestorTag(range.startContainer, "LI");
        if (item && item.classList.contains('checklist-item')) {
            const p = exitChecklistItem(item);
            placeCursorAtEnd(p);
            updateFormatButtonsState();
            debouncedAutosave();
            return;
        }
        if (item) {
            const list = item.parentElement;
            const checklist = document.createElement('ul');
            checklist.className = 'checklist';
            Array.from(list.children).forEach(li => {
                checklist.appendChild(buildChecklistItem(li.innerHTML, false));
            });
            list.replaceWith(checklist);
            const firstText = checklist.querySelector('.checklist-text');
            if (firstText)
                placeCursorAtEnd(firstText);
            updateFormatButtonsState();
            debouncedAutosave();
            return;
        }
        let block = getAncestorBlock(range.startContainer);
        if (!block) {
            block = document.createElement('p');
            block.innerHTML = '<br>';
            el.noteContent.appendChild(block);
        }
        const plain = exitToParagraph(block);
        const checklist = document.createElement('ul');
        checklist.className = 'checklist';
        const newItem = buildChecklistItem(plain.innerHTML || '<br>', false);
        checklist.appendChild(newItem);
        plain.replaceWith(checklist);
        placeCursorAtEnd(newItem.querySelector('.checklist-text'));
        updateFormatButtonsState();
        debouncedAutosave();
    }
    function toggleList(tag) {
        el.noteContent.focus();
        const sel = window.getSelection();
        if (!sel.rangeCount)
            return;
        const range = sel.getRangeAt(0);
        if (getAncestorTag(range.startContainer, "PRE"))
            return;
        const li = getAncestorTag(range.startContainer, "LI");
        if (li) {
            const list = li.parentElement;
            const isChecklist = li.classList.contains('checklist-item');
            if (!isChecklist && list.tagName === tag) {
                const p = exitListItem(li);
                placeCursorAtEnd(p);
            }
            else {
                const newList = document.createElement(tag.toLowerCase());
                Array.from(list.children).forEach(oldItem => {
                    const newLi = document.createElement('li');
                    const textSpan = oldItem.querySelector('.checklist-text');
                    newLi.innerHTML = textSpan ? textSpan.innerHTML : oldItem.innerHTML;
                    newList.appendChild(newLi);
                });
                list.replaceWith(newList);
                placeCursorAtEnd(newList.querySelector('li') || newList);
            }
            updateFormatButtonsState();
            debouncedAutosave();
            return;
        }
        let block = getAncestorBlock(range.startContainer);
        if (!block) {
            block = document.createElement('p');
            block.innerHTML = '<br>';
            el.noteContent.appendChild(block);
        }
        const plain = exitToParagraph(block);
        const list = document.createElement(tag.toLowerCase());
        const newLi = document.createElement('li');
        newLi.innerHTML = plain.innerHTML || '<br>';
        list.appendChild(newLi);
        plain.replaceWith(list);
        placeCursorAtEnd(newLi);
        updateFormatButtonsState();
        debouncedAutosave();
    }
    function handleMarkdownShortcuts() {
        const sel = window.getSelection();
        if (!sel.rangeCount)
            return;
        const range = sel.getRangeAt(0);
        if (!range.collapsed)
            return;
        if (getAncestorTag(range.startContainer, "PRE"))
            return;
        let block = getAncestorBlock(range.startContainer);
        if (!block) {
            block = ensureBlockWrapping(range);
            if (!block)
                return;
        }
        if (['LI', 'BLOCKQUOTE', 'H1', 'H2', 'H3', 'H4'].includes(block.tagName))
            return;
        const preRange = document.createRange();
        preRange.selectNodeContents(block);
        preRange.setEnd(range.startContainer, range.startOffset);
        const text = preRange.toString();
        if (/^[-*]\s$/.test(text)) {
            convertBlockToList('UL', block, range);
            return;
        }
        if (/^\d+\.\s$/.test(text)) {
            convertBlockToList('OL', block, range);
        }
    }
    function ensureBlockWrapping(range) {
        let top = range.startContainer;
        while (top.parentElement && top.parentElement !== el.noteContent && top !== el.noteContent) {
            top = top.parentElement;
        }
        if (top === el.noteContent || top.parentElement !== el.noteContent)
            return null;
        const p = document.createElement('p');
        el.noteContent.insertBefore(p, top);
        p.appendChild(top);
        return p;
    }
    function convertBlockToList(tag, block, caretRange) {
        const markerRange = document.createRange();
        markerRange.selectNodeContents(block);
        markerRange.setEnd(caretRange.startContainer, caretRange.startOffset);
        markerRange.deleteContents();
        const list = document.createElement(tag.toLowerCase());
        const li = document.createElement('li');
        while (block.firstChild)
            li.appendChild(block.firstChild);
        if (!li.hasChildNodes())
            li.innerHTML = '<br>';
        list.appendChild(li);
        block.replaceWith(list);
        const sel = window.getSelection();
        const r = document.createRange();
        r.selectNodeContents(li);
        r.collapse(true);
        sel.removeAllRanges();
        sel.addRange(r);
        updateFormatButtonsState();
        debouncedAutosave();
    }
    function handleEditorKeydown(e) {
        if (e.key === "Enter" && !e.shiftKey) {
            const sel = window.getSelection();
            if (!sel.rangeCount)
                return;
            const range = sel.getRangeAt(0);
            const checkText = getAncestorClass(range.startContainer, 'checklist-text');
            if (checkText) {
                e.preventDefault();
                const li = checkText.closest('.checklist-item');
                if (checkText.innerHTML.trim() === '' || checkText.innerHTML.trim() === '<br>') {
                    const p = exitChecklistItem(li);
                    const r = document.createRange();
                    r.selectNodeContents(p);
                    r.collapse(true);
                    sel.removeAllRanges();
                    sel.addRange(r);
                    updateFormatButtonsState();
                    debouncedAutosave();
                    return;
                }
                const afterRange = range.cloneRange();
                afterRange.setEnd(checkText, checkText.childNodes.length);
                const afterFragment = afterRange.extractContents();
                const newItem = buildChecklistItem('', false);
                const newText = newItem.querySelector('.checklist-text');
                newText.innerHTML = '';
                newText.appendChild(afterFragment);
                if (!newText.hasChildNodes())
                    newText.innerHTML = '<br>';
                li.after(newItem);
                const r = document.createRange();
                r.selectNodeContents(newText);
                r.collapse(true);
                sel.removeAllRanges();
                sel.addRange(r);
                updateFormatButtonsState();
                debouncedAutosave();
                return;
            }
            const block = getAncestorBlock(range.startContainer);
            if (block?.tagName === "BLOCKQUOTE") {
                e.preventDefault();
                const p = document.createElement("p");
                p.innerHTML = "<br>";
                block.after(p);
                const newRange = document.createRange();
                newRange.setStart(p, 0);
                newRange.collapse(true);
                sel.removeAllRanges();
                sel.addRange(newRange);
                debouncedAutosave();
                updateFormatButtonsState();
            }
            return;
        }
        if (e.key === "Backspace") {
            const sel = window.getSelection();
            if (!sel.rangeCount)
                return;
            const range = sel.getRangeAt(0);
            if (!range.collapsed)
                return;
            const li = getAncestorTag(range.startContainer, "LI");
            if (!li)
                return;
            const isChecklist = li.classList.contains('checklist-item');
            const measureNode = isChecklist ? li.querySelector('.checklist-text') : li;
            const preRange = document.createRange();
            preRange.selectNodeContents(measureNode);
            preRange.setEnd(range.startContainer, range.startOffset);
            if (preRange.toString().length > 0)
                return;
            e.preventDefault();
            const p = isChecklist ? exitChecklistItem(li) : exitListItem(li);
            const r = document.createRange();
            r.selectNodeContents(p);
            r.collapse(true);
            sel.removeAllRanges();
            sel.addRange(r);
            updateFormatButtonsState();
            debouncedAutosave();
        }
    }
    function insertPlainText(text) {
        const sel = window.getSelection();
        if (!sel || !sel.rangeCount)
            return;
        const range = sel.getRangeAt(0);
        range.deleteContents();
        const lines = text.split(/\r\n|\r|\n/);
        const fragment = document.createDocumentFragment();
        lines.forEach((line, i) => {
            fragment.appendChild(document.createTextNode(line));
            if (i < lines.length - 1)
                fragment.appendChild(document.createElement('br'));
        });
        const lastNode = fragment.lastChild;
        range.insertNode(fragment);
        if (lastNode) {
            const newRange = document.createRange();
            newRange.setStartAfter(lastNode);
            newRange.collapse(true);
            sel.removeAllRanges();
            sel.addRange(newRange);
        }
    }
    function handlePaste(e) {
        e.preventDefault();
        const text = (e.clipboardData || window.clipboardData).getData('text/plain');
        if (!text)
            return;
        insertPlainText(text);
        updateFormatButtonsState();
        debouncedAutosave();
    }
    function showSyncNotification() {
        if (syncNotification)
            return;
        const { el: n, hide } = showNotification(`
        <div class="notification-title">${t('Нет подключения к интернету.')}</div>
        <div class="notification-text">
            ${t('Некоторые заметки могут быть временно недоступны.')}
            ${t('Рекомендуем проверить подключение к интернету и обновить страницу.')}
        </div>
        <div class="notification-actions">
            <button class="notification-confirm sync-reload-btn" type="button">
                ${t('Обновить страницу')}
            </button>
        </div>
    `);
        n.classList.add('notification-auth');
        syncNotification = { el: n, hide };
        n.querySelector('.sync-reload-btn').addEventListener('click', () => {
            window.location.reload();
        });
    }
    function hideSyncNotification() {
        if (!syncNotification)
            return;
        syncNotification.hide();
        syncNotification = null;
    }
    function openSettings() {
        el.settingsPanel.classList.add('open');
        el.body.classList.add('settings-open');
    }
    function closeSettings() {
        el.settingsPanel.classList.remove('open');
        el.body.classList.remove('settings-open');
    }
    function applyTheme(theme) {
        const actualTheme = theme === "system"
            ? (window.matchMedia("(prefers-color-scheme: dark)").matches
                ? "dark"
                : "light")
            : theme;
        document.documentElement.setAttribute("data-theme", actualTheme);
        el.themeOptions.forEach(btn => btn.classList.toggle("active", btn.dataset.theme === theme));
        try {
            localStorage.setItem(THEME_KEY, theme);
        }
        catch (e) { }
        const themeColor = document.querySelector('meta[name="theme-color"]');
        if (themeColor) {
            const panel = getComputedStyle(document.documentElement).getPropertyValue('--panel').trim();
            themeColor.content = panel || (actualTheme === 'dark' ? '#000000' : '#ffffff');
        }
        updateWelcomeThemeIcon();
    }
    function loadTheme() {
        applyTheme(themeSetting());
    }
    const THEME_LABELS = { light: 'Светлая тема', dark: 'Тёмная тема', system: 'Системная тема' };
    const THEME_ICONS = { light: 'sun.svg', dark: 'moon.svg', system: 'device.svg' };
    function themeSetting() {
        try {
            const saved = localStorage.getItem(THEME_KEY);
            return THEME_LABELS[saved] ? saved : 'system';
        }
        catch (e) {
            return 'system';
        }
    }
    function updateWelcomeThemeIcon() {
        const menu = $('#welcomeTheme');
        if (!menu)
            return;
        const theme = themeSetting();
        menu.querySelector('.theme-menu-icon').src = THEME_ICONS[theme];
        menu.querySelector('.theme-menu-label-text').textContent = t(THEME_LABELS[theme]);
        menu.querySelectorAll('[data-theme-choice]').forEach(option => {
            option.classList.toggle('active', option.dataset.themeChoice === theme);
        });
    }
    function closeMenuOnOutside(menu, close) {
        const onDown = e => { if (!menu.contains(e.target))
            close(); };
        const onKey = e => { if (e.key === 'Escape')
            close(); };
        document.addEventListener('mousedown', onDown);
        document.addEventListener('keydown', onKey);
        return () => {
            document.removeEventListener('mousedown', onDown);
            document.removeEventListener('keydown', onKey);
        };
    }
    function setupWelcomeThemeMenu() {
        const menu = $('#welcomeTheme');
        if (!menu)
            return;
        const button = menu.querySelector('.theme-menu-btn');
        let detach = null;
        const close = () => {
            menu.classList.remove('open');
            if (detach) {
                detach();
                detach = null;
            }
        };
        button.addEventListener('click', () => {
            if (menu.classList.contains('open')) {
                close();
                return;
            }
            menu.classList.add('open');
            detach = closeMenuOnOutside(menu, close);
        });
        menu.querySelectorAll('[data-theme-choice]').forEach(option => {
            option.addEventListener('click', () => {
                applyTheme(option.dataset.themeChoice);
                close();
            });
        });
        updateWelcomeThemeIcon();
    }
    function setupTechInfo() {
        document.querySelectorAll('[data-app-version]').forEach(n => { n.textContent = APP_VERSION; });
        document.querySelectorAll('[data-app-build]').forEach(n => { n.textContent = appBuildDate(); });
        const wrap = $('#techInfo');
        if (!wrap)
            return;
        let detach = null;
        const close = () => {
            wrap.classList.remove('open');
            if (detach) {
                detach();
                detach = null;
            }
        };
        wrap.querySelector('.tech-info-btn').addEventListener('click', () => {
            if (wrap.classList.contains('open')) {
                close();
                return;
            }
            wrap.classList.add('open');
            detach = closeMenuOnOutside(wrap, close);
        });
    }
    function applyFontSize(size) {
        document.documentElement.style.setProperty('--font-size-base', size + 'px');
        if (el.fontPreview)
            el.fontPreview.style.fontSize = size + 'px';
        if (el.fontSize)
            el.fontSize.value = size;
        try {
            localStorage.setItem(FONT_KEY, String(size));
        }
        catch (e) { }
    }
    function loadFontSize() {
        let size = 16;
        try {
            const s = localStorage.getItem(FONT_KEY);
            if (s)
                size = Number(s);
        }
        catch (e) { }
        applyFontSize(size);
    }
    onUserChanged(async (user) => {
        closeAccountPanel();
        if ((user ? user.uid : null) !== (currentUser ? currentUser.uid : null))
            resetVaultState();
        currentUser = user;
        spaceSettingsPromise = null;
        separateBySignIn = false;
        updateSpaceSetting();
        const img = el.loginBtn.querySelector('img');
        const title = el.loginBtn.querySelector('strong');
        if (user) {
            el.welcomeScreen.classList.remove('visible');
            stopWelcomeIntro();
            el.body.classList.add('app-loading');
            isLoading = true;
            renderNotesList();
            document.documentElement.classList.remove('auth-pending');
            playAppEnter();
            img.src = 'exit.svg';
            title.textContent = user.displayName || t('Пользователь');
            try {
                await Promise.all([
                    loadNotes(),
                    loadTrash(),
                    loadVaultMeta().catch(metaError => console.error(metaError))
                ]);
            }
            catch (error) {
                handleFirebaseError(error);
            }
            finally {
                isLoading = false;
                clearNotesLoader();
            }
            if (currentUser !== user)
                return;
            activeNoteId = pickNextNoteId();
            await importWelcomeDraft();
            revealApp();
        }
        else {
            notes = [];
            trashedNotes = [];
            otherNotes = [];
            otherTrash = [];
            activeNoteId = null;
            isLoading = false;
            clearNotesLoader();
            selectedNoteIds.clear();
            img.src = 'enter.svg';
            title.textContent = t('Войти');
            el.body.classList.remove('app-loading');
            el.welcomeScreen.classList.add('visible');
            startWelcomeIntro();
            document.documentElement.classList.remove('auth-pending');
        }
        renderNotesList();
        renderTrash();
        renderEditor();
        renderSelectionBar();
    });
    function toggleFullscreen() {
        el.body.classList.toggle('editor-fullscreen');
        updateFullscreenIcon();
    }
    function updateFullscreenIcon() {
        if (!el.fullscreenIcon)
            return;
        const isMobile = window.innerWidth <= 760;
        const isFullscreen = el.body.classList.contains('editor-fullscreen');
        if (isMobile) {
            el.fullscreenIcon.src = 'left.svg';
        }
        else {
            el.fullscreenIcon.src = isFullscreen
                ? 'minimize.svg'
                : 'maximize.svg';
        }
    }
    const FIND_LIMIT = 5000;
    const FIND_BLOCK_TAGS = new Set(['P', 'DIV', 'LI', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'BLOCKQUOTE', 'PRE', 'TD', 'TH', 'TR', 'BR', 'UL', 'OL', 'TABLE']);
    const findHighlights = typeof CSS !== 'undefined' && CSS.highlights && typeof Highlight === 'function';
    const findState = { open: false, matches: [], index: -1, caseSensitive: false };
    let findRefreshTimer = null;
    function escapeRegExp(str) {
        return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
    function buildFindIndex() {
        let text = '';
        const segments = [];
        const walker = document.createTreeWalker(el.noteContent, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, {
            acceptNode(node) {
                return node.nodeType === 1 && node.classList.contains('note-formula')
                    ? NodeFilter.FILTER_REJECT
                    : NodeFilter.FILTER_ACCEPT;
            }
        });
        let node;
        while ((node = walker.nextNode())) {
            if (node.nodeType === 1) {
                if (FIND_BLOCK_TAGS.has(node.tagName))
                    text += '\n';
                continue;
            }
            segments.push({ node, start: text.length, end: text.length + node.data.length });
            text += node.data;
        }
        return { text, segments };
    }
    function findBoundary(segments, offset, isEnd) {
        for (const seg of segments) {
            if (isEnd ? (offset > seg.start && offset <= seg.end) : (offset >= seg.start && offset < seg.end)) {
                return [seg.node, offset - seg.start];
            }
        }
        return null;
    }
    function canReplace() {
        return !!(getNote(activeNoteId) && el.noteContent.isContentEditable);
    }
    function paintFind() {
        const { matches, index } = findState;
        if (findHighlights) {
            CSS.highlights.delete('find-match');
            CSS.highlights.delete('find-current');
            if (findState.open && matches.length) {
                CSS.highlights.set('find-match', new Highlight(...matches.filter((_, i) => i !== index)));
                if (matches[index])
                    CSS.highlights.set('find-current', new Highlight(matches[index]));
            }
        }
        const query = el.findInput.value;
        el.findCount.classList.toggle('empty', !!query && !matches.length);
        el.findCount.textContent = matches.length
            ? t('{n} из {total}', { n: index + 1, total: `${matches.length}${matches.length >= FIND_LIMIT ? '+' : ''}` })
            : (query ? t('нет совпадений') : '');
        const replaceable = canReplace();
        el.replaceInput.disabled = !replaceable;
        el.replaceBtn.disabled = !replaceable || !matches.length;
        el.replaceAllBtn.disabled = !replaceable || !matches.length;
        el.findPrevBtn.disabled = matches.length < 2;
        el.findNextBtn.disabled = matches.length < 2;
    }
    function scrollToMatch(range) {
        if (!range)
            return;
        const rect = range.getBoundingClientRect();
        const box = el.noteContent.getBoundingClientRect();
        if (rect.top < box.top + 16 || rect.bottom > box.bottom - 16) {
            el.noteContent.scrollTop += rect.top - box.top - box.height / 3;
        }
    }
    function collectMatches() {
        const query = el.findInput.value;
        const matches = [];
        if (query && (getNote(activeNoteId) || getTrashedNote(activeNoteId))) {
            const { text, segments } = buildFindIndex();
            const re = new RegExp(escapeRegExp(query), findState.caseSensitive ? 'gu' : 'giu');
            let m;
            while ((m = re.exec(text)) && matches.length < FIND_LIMIT) {
                if (!m[0].length) {
                    re.lastIndex++;
                    continue;
                }
                const start = findBoundary(segments, m.index, false);
                const end = findBoundary(segments, m.index + m[0].length, true);
                if (!start || !end)
                    continue;
                const range = document.createRange();
                range.setStart(start[0], start[1]);
                range.setEnd(end[0], end[1]);
                matches.push(range);
            }
        }
        return matches;
    }
    function refreshFind(reset = false, after = null) {
        clearTimeout(findRefreshTimer);
        if (!findState.open)
            return;
        const previous = findState.index;
        findState.matches = collectMatches();
        const total = findState.matches.length;
        if (!total) {
            findState.index = -1;
        }
        else if (after) {
            const next = findState.matches.findIndex(r => r.compareBoundaryPoints(Range.START_TO_START, after) >= 0);
            findState.index = next === -1 ? 0 : next;
        }
        else {
            findState.index = reset || previous < 0 ? 0 : Math.min(previous, total - 1);
        }
        paintFind();
        if (reset || after)
            scrollToMatch(findState.matches[findState.index]);
    }
    function scheduleFindRefresh() {
        if (!findState.open)
            return;
        clearTimeout(findRefreshTimer);
        findRefreshTimer = setTimeout(() => refreshFind(), 150);
    }
    function stepFind(delta) {
        const total = findState.matches.length;
        if (!total)
            return;
        findState.index = (findState.index + delta + total) % total;
        paintFind();
        scrollToMatch(findState.matches[findState.index]);
    }
    function openFind(replace = false) {
        if (!getNote(activeNoteId) && !getTrashedNote(activeNoteId))
            return;
        const sel = window.getSelection();
        if (sel && sel.rangeCount && !sel.isCollapsed && el.noteContent.contains(sel.getRangeAt(0).commonAncestorContainer)) {
            const picked = sel.toString();
            if (picked.trim() && picked.length <= 200 && !/\n/.test(picked))
                el.findInput.value = picked;
        }
        findState.open = true;
        el.findBar.hidden = false;
        el.findHeaderBtn.classList.add('active');
        refreshFind(true);
        const target = replace && canReplace() ? el.replaceInput : el.findInput;
        target.focus();
        target.select();
    }
    function closeFind(selectCurrent = false) {
        if (!findState.open)
            return;
        const current = findState.matches[findState.index];
        findState.open = false;
        findState.matches = [];
        findState.index = -1;
        clearTimeout(findRefreshTimer);
        el.findBar.hidden = true;
        el.findHeaderBtn.classList.remove('active');
        if (findHighlights) {
            CSS.highlights.delete('find-match');
            CSS.highlights.delete('find-current');
        }
        if (selectCurrent && current && window.innerWidth > 760) {
            el.noteContent.focus({ preventScroll: true });
            const sel = window.getSelection();
            sel.removeAllRanges();
            sel.addRange(current);
        }
    }
    function selectRangeInEditor(range) {
        el.noteContent.focus({ preventScroll: true });
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
    }
    function insertReplacement(value) {
        if (value)
            document.execCommand('insertText', false, value);
        else
            document.execCommand('delete', false, null);
    }
    function replaceCurrent() {
        const range = findState.matches[findState.index];
        if (!range || !canReplace())
            return;
        selectRangeInEditor(range);
        insertReplacement(el.replaceInput.value);
        const sel = window.getSelection();
        const caret = sel.rangeCount ? sel.getRangeAt(0).cloneRange() : null;
        refreshFind(false, caret);
        el.replaceInput.focus();
    }
    function replaceAll() {
        const matches = findState.matches.slice();
        if (!matches.length || !canReplace())
            return;
        const value = el.replaceInput.value;
        for (let i = matches.length - 1; i >= 0; i--) {
            selectRangeInEditor(matches[i]);
            insertReplacement(value);
        }
        refreshFind(true);
        el.replaceInput.focus();
        showToast(t('Заменено: {n}', { n: matches.length }), '', 2500);
    }
    function findShortcutAllowed(e) {
        if (!currentUser || (!getNote(activeNoteId) && !getTrashedNote(activeNoteId)))
            return false;
        if (e.target instanceof Element && e.target.closest('.sidebar, .notification, .link-popover'))
            return false;
        if (window.innerWidth <= 760 && !el.body.classList.contains('editor-fullscreen'))
            return false;
        return true;
    }
    function setupFind() {
        el.findHeaderBtn.addEventListener('click', () => {
            if (findState.open)
                closeFind();
            else
                openFind();
        });
        el.findInput.addEventListener('input', () => refreshFind(true));
        el.findInput.addEventListener('keydown', e => {
            if (e.key === 'Enter') {
                e.preventDefault();
                stepFind(e.shiftKey ? -1 : 1);
            }
        });
        el.replaceInput.addEventListener('keydown', e => {
            if (e.key !== 'Enter')
                return;
            e.preventDefault();
            if (e.metaKey || e.ctrlKey)
                replaceAll();
            else
                replaceCurrent();
        });
        el.findCaseBtn.addEventListener('click', () => {
            findState.caseSensitive = !findState.caseSensitive;
            el.findCaseBtn.classList.toggle('active', findState.caseSensitive);
            refreshFind(true);
        });
        el.findPrevBtn.addEventListener('click', () => stepFind(-1));
        el.findNextBtn.addEventListener('click', () => stepFind(1));
        el.replaceBtn.addEventListener('click', replaceCurrent);
        el.replaceAllBtn.addEventListener('click', replaceAll);
        el.findCloseBtn.addEventListener('click', () => closeFind());
        el.findBar.addEventListener('keydown', e => {
            if (e.key === 'Escape') {
                e.preventDefault();
                closeFind(true);
            }
        });
        document.addEventListener('keydown', e => {
            const mod = e.metaKey || e.ctrlKey;
            if (!mod)
                return;
            const isReplace = (e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey && e.code === 'KeyH') ||
                (e.metaKey && e.altKey && !e.shiftKey && e.code === 'KeyF');
            const isFind = !isReplace && !e.altKey && !e.shiftKey && e.code === 'KeyF';
            const isNext = findState.open && !e.altKey && e.code === 'KeyG';
            if (isNext) {
                e.preventDefault();
                stepFind(e.shiftKey ? -1 : 1);
                return;
            }
            if ((isFind || isReplace) && findShortcutAllowed(e)) {
                e.preventDefault();
                openFind(isReplace);
            }
        });
        el.noteContent.addEventListener('keydown', e => {
            if (e.key === 'Escape' && findState.open) {
                e.preventDefault();
                closeFind();
            }
        });
    }
    const CIPHER_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    let welcomeTimers = [];
    function welcomeLater(fn, ms) {
        welcomeTimers.push(setTimeout(fn, ms));
    }
    function stopWelcomeIntro() {
        welcomeTimers.forEach(clearTimeout);
        welcomeTimers = [];
    }
    function randomCipher(length) {
        const bytes = crypto.getRandomValues(new Uint8Array(length));
        return Array.from(bytes, b => CIPHER_CHARS[b % CIPHER_CHARS.length]).join('');
    }
    let securityKey = null;
    let securitySeq = 0;
    function securityBase64(bytes) {
        let binary = '';
        bytes.forEach(b => { binary += String.fromCharCode(b); });
        return btoa(binary);
    }
    function securityRandomFallback(text) {
        return text ? randomCipher(Math.ceil((new TextEncoder().encode(text).length + 28) * 4 / 3)) : '';
    }
    async function encryptSecurityDemo(text) {
        if (!text)
            return '';
        if (!(window.crypto && crypto.subtle))
            return securityRandomFallback(text);
        const data = new TextEncoder().encode(text);
        if (!securityKey)
            securityKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt']);
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, securityKey, data));
        const box = new Uint8Array(iv.length + sealed.length);
        box.set(iv);
        box.set(sealed, iv.length);
        return securityBase64(box);
    }
    const SECURITY_LIMIT = 300;
    const SECURITY_PAUSE = 650;
    let securityIdle = null;
    async function updateSecurityCipher() {
        const root = document.getElementById('welcomeSecurity');
        if (!root)
            return;
        const input = root.querySelector('.cipher-input');
        const output = root.querySelector('.cipher-output');
        const arrow = root.querySelector('.cipher-arrow');
        const seq = ++securitySeq;
        let cipher = '';
        try {
            cipher = await encryptSecurityDemo(input.value);
        }
        catch (error) {
            cipher = securityRandomFallback(input.value);
        }
        if (seq !== securitySeq)
            return;
        output.textContent = cipher;
        output.classList.remove('stale');
        arrow.classList.remove('busy');
        [output, arrow].forEach(node => {
            node.classList.remove('tick', 'pulse');
            void node.offsetWidth;
        });
        if (cipher) {
            output.classList.add('tick');
            arrow.classList.add('pulse');
        }
    }
    function scheduleSecurityCipher() {
        const root = document.getElementById('welcomeSecurity');
        clearTimeout(securityIdle);
        securitySeq++;
        const output = root.querySelector('.cipher-output');
        root.querySelector('.cipher-arrow').classList.add('busy');
        if (output.textContent)
            output.classList.add('stale');
        securityIdle = setTimeout(updateSecurityCipher, SECURITY_PAUSE);
    }
    function updateSecurityLimit() {
        const root = document.getElementById('welcomeSecurity');
        const input = root.querySelector('.cipher-input');
        root.querySelector('.cipher-limit').hidden = input.value.length < SECURITY_LIMIT;
    }
    function setupWelcomeSecurity() {
        const root = document.getElementById('welcomeSecurity');
        if (!root)
            return;
        const input = root.querySelector('.cipher-input');
        input.maxLength = SECURITY_LIMIT;
        input.addEventListener('input', () => {
            updateSecurityLimit();
            scheduleSecurityCipher();
        });
        root.querySelector('.cipher-limit-link').addEventListener('click', () => {
            const auth = el.welcomeScreen.querySelector('.welcome-auth');
            if (auth)
                auth.scrollIntoView({ behavior: 'smooth', block: 'start' });
        });
    }
    function setupWelcomeReveal() {
        const screen = el.welcomeScreen;
        const items = [...screen.querySelectorAll('.welcome-feature, .welcome-demo-head, .welcome-demo-card, .welcome-security > .welcome-section-kicker, .welcome-security > .welcome-section-title, .welcome-security > .welcome-section-text, .cipher-pane, .cipher-arrow, .cipher-note')];
        items.forEach(node => node.classList.add('reveal'));
        if (!('IntersectionObserver' in window)) {
            items.forEach(node => node.classList.add('revealed'));
            return;
        }
        const started = performance.now();
        const observer = new IntersectionObserver(entries => {
            const shown = entries
                .filter(entry => entry.isIntersecting)
                .map(entry => entry.target)
                .sort((x, y) => {
                    const a = x.getBoundingClientRect();
                    const b = y.getBoundingClientRect();
                    return a.top - b.top || a.left - b.left;
                });
            const wait = Math.max(0, 1250 - (performance.now() - started));
            shown.forEach((node, i) => {
                node.style.setProperty('--rd', `${Math.round(wait + i * 90)}ms`);
                node.classList.add('revealed');
                observer.unobserve(node);
            });
        }, { root: screen, threshold: 0.15, rootMargin: '0px 0px -6% 0px' });
        items.forEach(node => observer.observe(node));
    }
    const DRAFT_KEY = 'startNotes.welcomeDraft';
    const DRAFT_TAGS = new Set(['P', 'DIV', 'BR', 'B', 'STRONG', 'I', 'EM', 'S', 'STRIKE', 'U', 'UL', 'OL', 'LI', 'SPAN']);
    function sanitizeDraft(html) {
        const doc = new DOMParser().parseFromString(`<body>${html || ''}</body>`, 'text/html');
        const clean = node => {
            [...node.childNodes].forEach(child => {
                if (child.nodeType === Node.TEXT_NODE)
                    return;
                if (child.nodeType !== Node.ELEMENT_NODE || !DRAFT_TAGS.has(child.tagName)) {
                    if (child.nodeType === Node.ELEMENT_NODE) {
                        clean(child);
                        child.replaceWith(...child.childNodes);
                    }
                    else {
                        child.remove();
                    }
                    return;
                }
                const keepClass = (child.tagName === 'UL' && child.classList.contains('checklist')) ? 'checklist'
                    : (child.tagName === 'LI' && child.classList.contains('checklist-item')) ? 'checklist-item'
                        : (child.tagName === 'SPAN' && child.classList.contains('checklist-text')) ? 'checklist-text' : '';
                const checked = child.tagName === 'LI' && child.dataset.checked === 'true';
                [...child.attributes].forEach(attr => child.removeAttribute(attr.name));
                if (keepClass)
                    child.className = keepClass;
                if (keepClass === 'checklist-item')
                    child.dataset.checked = checked ? 'true' : 'false';
                clean(child);
            });
        };
        clean(doc.body);
        return doc.body.innerHTML;
    }
    function readWelcomeDraft() {
        try {
            const draft = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null');
            if (draft && typeof draft === 'object')
                return { title: String(draft.title || ''), content: sanitizeDraft(draft.content) };
        }
        catch (e) { }
        return null;
    }
    function draftIsEmpty(draft) {
        return !draft || (!draft.title.trim() && !stripHtml(draft.content).trim() && !/<li/i.test(draft.content));
    }
    async function importWelcomeDraft() {
        const draft = readWelcomeDraft();
        if (draftIsEmpty(draft) || !currentUser)
            return;
        const note = {
            id: uid(),
            title: draft.title.trim(),
            content: draft.content,
            pinned: false,
            tags: [],
            createdAt: Date.now(),
            updatedAt: Date.now()
        };
        if (currentSpace())
            note.space = currentSpace();
        try {
            await saveNote(note);
        }
        catch (error) {
            handleFirebaseError(error);
            return;
        }
        notes.unshift(note);
        activeNoteId = note.id;
        try {
            localStorage.removeItem(DRAFT_KEY);
        }
        catch (e) { }
        resetWelcomeDemo();
        showToast(t('Черновик стал заметкой'), t('Заметка с главной страницы теперь в вашем списке.'));
    }
    let demoSaveTimer = null;
    function resetWelcomeDemo() {
        const root = $('#welcomeDemo');
        if (!root)
            return;
        root.querySelector('.welcome-demo-name').value = '';
        root.querySelector('.welcome-demo-body').innerHTML = '';
        root.classList.remove('has-draft');
    }
    function setupWelcomeDemo() {
        const root = $('#welcomeDemo');
        if (!root)
            return;
        const name = root.querySelector('.welcome-demo-name');
        const body = root.querySelector('.welcome-demo-body');
        const draft = readWelcomeDraft();
        if (!draftIsEmpty(draft)) {
            name.value = draft.title;
            body.innerHTML = draft.content;
            root.classList.add('has-draft');
        }
        const save = () => {
            clearTimeout(demoSaveTimer);
            demoSaveTimer = setTimeout(() => {
                const next = { title: name.value, content: sanitizeDraft(body.innerHTML) };
                const empty = draftIsEmpty(next);
                try {
                    if (empty)
                        localStorage.removeItem(DRAFT_KEY);
                    else
                        localStorage.setItem(DRAFT_KEY, JSON.stringify(next));
                }
                catch (e) { }
                root.classList.toggle('has-draft', !empty);
            }, 300);
        };
        const updateButtons = () => {
            const sel = window.getSelection();
            const inside = sel.rangeCount && body.contains(sel.anchorNode);
            root.querySelectorAll('[data-demo]').forEach(btn => {
                const cmd = btn.dataset.demo;
                let active = false;
                if (inside) {
                    if (cmd === 'checklist')
                        active = !!(sel.anchorNode.parentElement || sel.anchorNode).closest('.checklist-item');
                    else if (cmd === 'insertUnorderedList')
                        active = !!(sel.anchorNode.parentElement || sel.anchorNode).closest('ul:not(.checklist)');
                    else {
                        try {
                            active = document.queryCommandState(cmd);
                        }
                        catch (e) { }
                    }
                }
                btn.classList.toggle('active', active);
            });
        };
        const toggleDemoChecklist = () => {
            const sel = window.getSelection();
            if (!sel.rangeCount || !body.contains(sel.anchorNode))
                return;
            const start = sel.anchorNode.nodeType === Node.TEXT_NODE ? sel.anchorNode.parentElement : sel.anchorNode;
            const item = start.closest('.checklist-item');
            if (item) {
                const p = document.createElement('p');
                const text = item.querySelector('.checklist-text');
                p.innerHTML = (text ? text.innerHTML : item.innerHTML) || '<br>';
                const list = item.parentElement;
                list.replaceWith(...[...list.children].map(li => li === item ? p : (() => {
                    const ul = document.createElement('ul');
                    ul.className = 'checklist';
                    ul.appendChild(li);
                    return ul;
                })()));
                placeCursorAtEnd(p);
                return;
            }
            let block = start === body ? null : start.closest('p, div, li');
            if (!block || !body.contains(block) || block === body) {
                block = document.createElement('p');
                const loose = sel.anchorNode.nodeType === Node.TEXT_NODE && sel.anchorNode.parentElement === body ? sel.anchorNode : null;
                if (loose) {
                    loose.before(block);
                    block.appendChild(loose);
                }
                else {
                    block.innerHTML = '<br>';
                    body.appendChild(block);
                }
            }
            const list = document.createElement('ul');
            list.className = 'checklist';
            const li = buildChecklistItem(block.innerHTML || '<br>', false);
            list.appendChild(li);
            block.replaceWith(list);
            placeCursorAtEnd(li.querySelector('.checklist-text'));
        };
        root.querySelectorAll('[data-demo]').forEach(btn => {
            btn.addEventListener('mousedown', e => e.preventDefault());
            btn.addEventListener('click', () => {
                if (!body.contains(window.getSelection().anchorNode))
                    placeCursorAtEnd(body.lastElementChild || body);
                body.focus();
                const cmd = btn.dataset.demo;
                if (cmd === 'checklist')
                    toggleDemoChecklist();
                else
                    document.execCommand(cmd, false, null);
                updateButtons();
                save();
            });
        });
        body.addEventListener('focus', () => {
            try {
                document.execCommand('defaultParagraphSeparator', false, 'p');
            }
            catch (e) { }
        });
        body.addEventListener('paste', e => {
            e.preventDefault();
            const text = (e.clipboardData || window.clipboardData).getData('text/plain');
            if (text)
                document.execCommand('insertText', false, text);
        });
        body.addEventListener('click', e => {
            const item = e.target.closest('.checklist-item');
            if (!item || e.clientX - item.getBoundingClientRect().left > 26)
                return;
            e.preventDefault();
            item.dataset.checked = item.dataset.checked === 'true' ? 'false' : 'true';
            save();
        });
        body.addEventListener('keydown', e => {
            if (e.key !== 'Enter' || e.shiftKey || e.isComposing)
                return;
            const sel = window.getSelection();
            if (!sel.rangeCount)
                return;
            const start = sel.anchorNode.nodeType === Node.TEXT_NODE ? sel.anchorNode.parentElement : sel.anchorNode;
            const item = start && start.closest('.checklist-item');
            if (!item || !body.contains(item))
                return;
            e.preventDefault();
            const text = item.querySelector('.checklist-text') || item;
            const list = item.parentElement;
            if (!text.textContent.trim()) {
                const p = document.createElement('p');
                p.innerHTML = '<br>';
                const rest = [...list.children].slice([...list.children].indexOf(item) + 1);
                list.after(p);
                if (rest.length) {
                    const tail = document.createElement('ul');
                    tail.className = 'checklist';
                    rest.forEach(li => tail.appendChild(li));
                    p.after(tail);
                }
                item.remove();
                if (!list.children.length)
                    list.remove();
                placeCursorAtEnd(p);
            }
            else {
                const range = sel.getRangeAt(0);
                range.deleteContents();
                range.setEnd(text, text.childNodes.length);
                const moved = range.extractContents();
                const next = buildChecklistItem('', false);
                const nextText = next.querySelector('.checklist-text');
                if (moved.textContent) {
                    nextText.innerHTML = '';
                    nextText.appendChild(moved);
                }
                if (!text.textContent)
                    text.innerHTML = '<br>';
                item.after(next);
                const caret = document.createRange();
                caret.setStart(nextText, 0);
                caret.collapse(true);
                sel.removeAllRanges();
                sel.addRange(caret);
            }
            save();
        });
        body.addEventListener('input', save);
        name.addEventListener('input', save);
        name.addEventListener('keydown', e => {
            if (e.key === 'Enter') {
                e.preventDefault();
                body.focus();
                placeCursorAtEnd(body.lastElementChild || body);
            }
        });
        document.addEventListener('selectionchange', updateButtons);
        root.querySelector('.welcome-demo-clear').addEventListener('click', () => {
            resetWelcomeDemo();
            try {
                localStorage.removeItem(DRAFT_KEY);
            }
            catch (e) { }
            name.focus();
        });
    }
    function setupWelcomeHeader() {
        const screen = el.welcomeScreen;
        const auth = $('.welcome-auth-side');
        const login = $('#welcomeHeaderLogin');
        screen.addEventListener('scroll', () => {
            screen.classList.toggle('scrolled', screen.scrollTop > 8);
        }, { passive: true });
        if (auth && 'IntersectionObserver' in window) {
            new IntersectionObserver(([entry]) => {
                screen.classList.toggle('auth-passed', !entry.isIntersecting && entry.boundingClientRect.top < 0);
            }, { root: screen }).observe(auth);
        }
        if (login && auth) {
            login.addEventListener('click', () => auth.scrollIntoView({ behavior: 'smooth', block: 'start' }));
        }
    }
    function startWelcomeIntro() {
        el.welcomeScreen.scrollTop = 0;
        el.welcomeScreen.classList.remove('scrolled', 'auth-passed');
        runPreviewAnimation(1500);
    }
    function runPreviewAnimation(typeStart) {
        stopWelcomeIntro();
        const root = $('#welcomePreview');
        if (!root)
            return;
        const titleEl = root.querySelector('[data-type]');
        const secretEl = root.querySelector('[data-secret]');
        const secretBox = root.querySelector('.preview-secret');
        const title = titleEl.dataset.type;
        const plain = secretEl.dataset.secret;
        const cipher = randomCipher(plain.length);
        root.classList.add('preview-reset');
        root.classList.remove('is-checked', 'is-typing');
        secretBox.classList.remove('encrypted');
        titleEl.textContent = '';
        secretEl.textContent = plain;
        void root.offsetWidth;
        root.classList.remove('preview-reset');
        if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
            titleEl.textContent = title;
            root.classList.add('is-checked');
            secretEl.textContent = cipher;
            secretBox.classList.add('encrypted');
            return;
        }
        const typeStep = 90;
        welcomeLater(() => root.classList.add('is-typing'), typeStart - 300);
        [...title].forEach((_, i) => {
            welcomeLater(() => {
                titleEl.textContent = title.slice(0, i + 1);
            }, typeStart + i * typeStep);
        });
        const typed = typeStart + title.length * typeStep;
        welcomeLater(() => root.classList.remove('is-typing'), typed + 500);
        welcomeLater(() => root.classList.add('is-checked'), typed + 300);
        const scrambleStart = typed + 2100;
        const frames = 22;
        for (let f = 1; f <= frames; f++) {
            welcomeLater(() => {
                const done = Math.floor(plain.length * f / frames);
                secretEl.textContent =
                    cipher.slice(0, done) +
                    randomCipher(plain.length - done);
                if (f === frames)
                    secretBox.classList.add('encrypted');
            }, scrambleStart + f * 40);
        }
        const cycleEnd = scrambleStart + frames * 40;
        welcomeLater(() => {
            root.classList.add('preview-reset');
            root.classList.remove('is-checked', 'is-typing');
            secretBox.classList.remove('encrypted');
            titleEl.textContent = '';
            secretEl.textContent = plain;
            void root.offsetWidth;
            root.classList.remove('preview-reset');
            runPreviewAnimation(900);
        }, cycleEnd + 1800);
    }
    const GOOGLE_SANS_KEY = 'startNotes.googleSans';
    const GOOGLE_FONTS = [
        ['https://fonts.googleapis.com/css2?family=Google+Sans+Flex:wght@100..1000&display=swap', 'https://fonts.googleapis.com/css2?family=Google+Sans+Flex&display=swap'],
        ['https://fonts.googleapis.com/css2?family=Google+Sans:ital,wght@0,400;0,500;0,700;1,400;1,700&display=swap', 'https://fonts.googleapis.com/css2?family=Google+Sans&display=swap']
    ];
    let googleSans = loadGoogleSansSettings();
    let googleSansLoaded = false;
    let googleSansSwapTimer = null;
    function loadGoogleSansSettings() {
        try {
            const raw = JSON.parse(localStorage.getItem(GOOGLE_SANS_KEY));
            if (raw && typeof raw === 'object')
                return { allowed: raw.allowed !== false };
        }
        catch (e) { }
        return { allowed: true };
    }
    function saveGoogleSansSettings() {
        try {
            localStorage.setItem(GOOGLE_SANS_KEY, JSON.stringify(googleSans));
        }
        catch (e) { }
    }
    function loadGoogleSansFont() {
        if (googleSansLoaded)
            return;
        googleSansLoaded = true;
        GOOGLE_FONTS.forEach(([href, fallback]) => {
            const link = document.createElement('link');
            link.rel = 'stylesheet';
            link.href = href;
            link.addEventListener('error', () => {
                if (link.href !== fallback)
                    link.href = fallback;
            });
            document.head.appendChild(link);
        });
    }
    function shownNote() {
        return getNote(activeNoteId) || getTrashedNote(activeNoteId);
    }
    function applyGoogleSans() {
        const note = shownNote();
        const on = !!(googleSans.allowed && note && note.font === 'google-sans');
        if (on)
            loadGoogleSansFont();
        el.body.classList.toggle('google-sans', on);
        el.body.classList.toggle('google-sans-hidden', !googleSans.allowed);
        if (el.googleSansBtn)
            el.googleSansBtn.classList.toggle('active', on);
        if (el.googleSansToggle) {
            el.googleSansToggle.classList.toggle('active', googleSans.allowed);
            el.googleSansToggle.setAttribute('aria-pressed', String(googleSans.allowed));
        }
    }
    function swapEditorFont() {
        const editor = document.querySelector('.editor');
        if (!editor || window.matchMedia('(prefers-reduced-motion: reduce)').matches)
            return;
        editor.classList.remove('font-swap');
        void editor.offsetWidth;
        editor.classList.add('font-swap');
        clearTimeout(googleSansSwapTimer);
        googleSansSwapTimer = setTimeout(() => editor.classList.remove('font-swap'), 500);
    }
    function setupGoogleSans() {
        applyGoogleSans();
        if (el.googleSansBtn) {
            el.googleSansBtn.addEventListener('mousedown', e => e.preventDefault());
            el.googleSansBtn.addEventListener('click', async () => {
                const note = getNote(activeNoteId);
                if (!note || (note.secret && (note.locked || !vaultKey)))
                    return;
                if (note.font === 'google-sans')
                    delete note.font;
                else
                    note.font = 'google-sans';
                applyGoogleSans();
                swapEditorFont();
                await persistActiveNote(true);
            });
        }
        if (el.spaceToggle) {
            el.spaceToggle.addEventListener('click', toggleSeparateBySignIn);
        }
        if (el.googleSansToggle) {
            el.googleSansToggle.addEventListener('click', () => {
                googleSans.allowed = !googleSans.allowed;
                saveGoogleSansSettings();
                applyGoogleSans();
            });
        }
    }
    function updateLanguageControls() {
        document.querySelectorAll('.lang-option').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.lang === lang);
        });
        const welcomeLabel = document.querySelector('#welcomeLang .welcome-lang-label-text');
        if (welcomeLabel)
            welcomeLabel.textContent = lang === 'ru' ? 'Switch to English' : 'Переключиться на русский';
    }
    const LANG_FADE_MS = 150;
    let languageSwitching = false;
    function switchLanguage(next) {
        if (next === lang || languageSwitching)
            return;
        if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
            setLanguage(next);
            return;
        }
        languageSwitching = true;
        el.body.classList.add('lang-fade', 'lang-out');
        setTimeout(() => {
            setLanguage(next);
            requestAnimationFrame(() => requestAnimationFrame(() => {
                el.body.classList.remove('lang-out');
                setTimeout(() => {
                    el.body.classList.remove('lang-fade');
                    languageSwitching = false;
                }, LANG_FADE_MS + 40);
            }));
        }, LANG_FADE_MS);
    }
    function relabelNotesList() {
        const lists = [el.pinnedNotes, el.notesList];
        if (isLoading || el.searchInput.value.trim() || lists.some(list => list.querySelector('.empty-state'))) {
            renderNotesList();
            return;
        }
        lists.forEach(list => {
            list.querySelectorAll('.note-card[data-id]').forEach(card => {
                const note = getNote(card.dataset.id);
                if (!note)
                    return;
                const date = card.querySelector('.note-card-date');
                if (date)
                    date.textContent = formatDate(note.updatedAt);
                const title = card.querySelector('.note-card-title');
                if (title && !note.title.trim())
                    title.textContent = t('Заметка');
            });
        });
        renderSecretSection();
    }
    function applyLanguage() {
        updateLanguageControls();
        closeAllDropdowns();
        closeAccountPanel();
        updateWelcomeThemeIcon();
        updateAutoLockSummary(false);
        renderAutoLockPresets();
        document.querySelectorAll('[data-app-build]').forEach(n => { n.textContent = appBuildDate(); });
        updateSpaceSetting();
        const title = el.loginBtn.querySelector('strong');
        if (!currentUser)
            title.textContent = t('Войти');
        else if (!currentUser.displayName)
            title.textContent = t('Пользователь');
        if (el.noteSaveStatus && el.noteSaveStatus.dataset.status)
            setNoteSaveStatus(el.noteSaveStatus.dataset.status);
        if (currentUser) {
            relabelNotesList();
            renderTrash();
            renderSelectionBar();
            const banner = document.getElementById('trashBanner');
            const trashed = getTrashedNote(activeNoteId);
            if (banner && trashed) {
                const days = daysLeft(trashed);
                banner.querySelector('.trash-banner-text').textContent = t('в корзине · до удаления {days} {unit}', { days, unit: pluralDays(days) });
                banner.querySelector('.trash-banner-restore').textContent = t('Восстановить');
                banner.querySelector('.trash-banner-delete').textContent = t('Удалить навсегда');
            }
        }
        else if (el.welcomeScreen.classList.contains('visible')) {
            runPreviewAnimation(300);
        }
    }
    function init() {
        loadTheme();
        loadFontSize();
        loadSaveStatusVisibility();
        window.matchMedia("(prefers-color-scheme: dark)")
            .addEventListener("change", () => {
            if (themeSetting() === "system") {
                applyTheme("system");
            }
        });
        window.addEventListener("offline", showSyncNotification);
        window.addEventListener("online", hideSyncNotification);
        activeNoteId = pickNextNoteId();
        renderNotesList();
        renderTrash();
        renderEditor();
        renderSelectionBar();
        el.newNoteBtn.addEventListener('click', () => createNote());
        if (el.secretNoteBtn)
            el.secretNoteBtn.addEventListener('click', showMakeSecretConfirmNotification);
        el.searchInput.addEventListener('input', () => renderNotesList());
        el.searchFilterBtn.classList.toggle('active', searchFilter !== 'all');
        el.searchFilterBtn.addEventListener('click', showFilterDropdown);
        el.trashHeader.addEventListener('click', e => {
            if (e.target.closest('button'))
                return;
            el.trashHeader.classList.toggle('collapsed');
            el.trashList.classList.toggle('collapsed');
        });
        el.settingsBtn.addEventListener('click', openSettings);
        el.closeSettingsBtn.addEventListener('click', closeSettings);
        el.themeOptions.forEach(btn => btn.addEventListener('click', () => applyTheme(btn.dataset.theme)));
        document.querySelectorAll('.lang-option').forEach(btn => {
            btn.addEventListener('click', () => switchLanguage(btn.dataset.lang));
        });
        const welcomeLang = $('#welcomeLang');
        if (welcomeLang)
            welcomeLang.addEventListener('click', () => switchLanguage(lang === 'ru' ? 'en' : 'ru'));
        updateLanguageControls();
        document.addEventListener(LANGUAGE_EVENT, applyLanguage);
        el.fontSize.addEventListener('input', e => applyFontSize(e.target.value));
        el.noteTitle.addEventListener('input', debouncedAutosave);
        el.noteTitle.addEventListener('blur', () => { persistActiveNote(); renderNotesList(); });
        el.noteContent.addEventListener('input', normalizeUnderlines);
        el.noteContent.addEventListener('input', debouncedAutosave);
        el.noteContent.addEventListener('input', scheduleFindRefresh);
        document.querySelector('.toolbar').addEventListener('mousedown', e => {
            if (e.target.closest('button'))
                e.preventDefault();
        });
        el.noteContent.addEventListener('click', handleNoteLinkClick);
        el.noteContent.addEventListener('click', e => {
            const formula = e.target.closest('.note-formula');
            if (formula) {
                e.preventDefault();
                showFormulaPopoverForElement(formula);
            }
        });
        el.noteContent.addEventListener('blur', () => { persistActiveNote(); renderNotesList(); });
        el.noteContent.addEventListener('keyup', updateFormatButtonsState);
        el.noteContent.addEventListener('mouseup', updateFormatButtonsState);
        el.formatButtons.forEach(btn => btn.addEventListener('click', () => applyFormat(btn.dataset.action)));
        el.underlineBtns.forEach(btn => btn.addEventListener('click', () => toggleUnderlineStyle(btn.dataset.underlineStyle)));
        el.strikeBtn.addEventListener('click', toggleStrike);
        el.codeBtn.addEventListener('click', toggleCode);
        el.h1Btn.addEventListener('click', () => applyHeading('H1'));
        el.h2Btn.addEventListener('click', () => applyHeading('H2'));
        el.h3Btn.addEventListener('click', () => applyHeading('H3'));
        el.quoteBtn.addEventListener('click', toggleQuote);
        el.noteContent.addEventListener('keydown', handleEditorKeydown);
        el.listULBtn.addEventListener('click', () => toggleList('UL'));
        el.listOLBtn.addEventListener('click', () => toggleList('OL'));
        el.checklistBtn.addEventListener('click', toggleChecklist);
        el.tableBtn.addEventListener('click', showTablePopover);
        el.formulaBtn.addEventListener('click', showFormulaPopover);
        el.noteContent.addEventListener('input', handleMarkdownShortcuts);
        el.noteContent.addEventListener('paste', handlePaste);
        el.noteContent.addEventListener('click', e => {
            const item = e.target.closest('.checklist-item');
            if (!item)
                return;
            const rect = item.getBoundingClientRect();
            const clickX = e.clientX - rect.left;
            if (clickX > 26)
                return;
            e.preventDefault();
            item.dataset.checked = item.dataset.checked === 'true' ? 'false' : 'true';
            debouncedAutosave();
        });
        el.linkBtn.addEventListener('click', toggleLink);
        document.addEventListener('selectionchange', updateLinkButtonVisibility);
        el.pinNoteBtn.addEventListener('click', togglePin);
        el.deleteNoteBtn.addEventListener('click', () => {
            if (activeNoteId)
                showDeleteConfirmNotification(activeNoteId);
        });
        el.loginBtn.addEventListener('click', toggleAccountPanel);
        setupAutoLockSettings();
        setupGoogleSans();
        setupFind();
        passkeyPrfSupport().then(supported => {
            try {
                if (localStorage.getItem(PASSKEY_PRF_KEY) === 'no')
                    supported = false;
            }
            catch (e) { }
            if (supported === passkeySupport)
                return;
            passkeySupport = supported;
            renderSecretSection();
        });
        setupCollapsibleSections();
        el.welcomeActionArea.innerHTML = providerButtonsHtml('provider-btn');
        bindProviderButtons(el.welcomeActionArea);
        setupWelcomeThemeMenu();
        setupWelcomeHeader();
        setupWelcomeDemo();
        setupWelcomeSecurity();
        setupWelcomeReveal();
        setupTechInfo();
        el.fullscreenBtn.addEventListener('click', toggleFullscreen);
        el.secretLockBtn.addEventListener('click', () => lockVault());
        document.addEventListener('pointerdown', bumpAutoLock, { passive: true, capture: true });
        document.addEventListener('keydown', bumpAutoLock, true);
        el.addTagBtn.addEventListener('click', addTag);
        el.saveStatusToggle.addEventListener('click', toggleSaveStatusVisibility);
        el.noteSaveRetry.addEventListener('click', () => {
            persistActiveNote(true);
        });
        window.addEventListener('beforeunload', () => { persistActiveNote(); });
        window.addEventListener('online', async () => {
            if (!currentUser)
                return;
            const keepId = activeNoteId;
            try {
                await persistActiveNote();
                await loadNotes();
                await loadTrash();
                if (!vaultMetaLoaded) {
                    try {
                        await loadVaultMeta();
                    }
                    catch (metaError) {
                        console.error(metaError);
                    }
                }
                activeNoteId = getNote(keepId) ? keepId : pickNextNoteId();
            }
            catch (error) {
                handleFirebaseError(error);
            }
            finally {
                renderNotesList();
                renderTrash();
                renderEditor();
            }
        });
    }
    document.addEventListener('DOMContentLoaded', init);
    if ('serviceWorker' in navigator && window.isSecureContext) {
        window.addEventListener('load', () => {
            navigator.serviceWorker.register('sw.js').catch(error => console.error(error));
        });
    }
    updateFullscreenIcon();
    window.addEventListener('resize', updateFullscreenIcon);
})();
