const LANG_KEY = "startNotes.language";
const LEGAL_KEYS = ["startNotes.privacyLanguage", "startNotes.legalLanguage"];
const SUPPORTED = ["ru", "en"];
const ATTRIBUTES = ["placeholder", "data-placeholder", "data-type", "data-secret"];
export const LANGUAGE_EVENT = "notes:language";

function detect() {
    try {
        const saved = localStorage.getItem(LANG_KEY);
        if (SUPPORTED.includes(saved)) {
            return saved;
        }
    }
    catch (error) { }

    return (navigator.language || "").toLowerCase().startsWith("ru") ? "ru" : "en";
}

function localeOf(code) {
    return code === "ru" ? "ru-RU" : "en-US";
}

export let lang = detect();
export let locale = localeOf(lang);

function normalize(text) {
    return String(text).replace(/\s+/g, " ").trim();
}

function translated(text) {
    return lang === "ru" ? text : (EN[normalize(text)] ?? text);
}

export function t(text, vars) {
    let result = translated(text);

    if (vars) {
        result = result.replace(/\{(\w+)\}/g, (match, name) => (name in vars ? vars[name] : match));
    }

    return result;
}

const statics = { title: null, texts: [], attributes: [] };

function applyStatic() {
    document.documentElement.lang = lang;

    if (statics.title !== null) {
        document.title = translated(statics.title);
    }

    statics.texts.forEach(({ node, original, lead, tail }) => {
        if (node.isConnected) {
            node.nodeValue = lead + translated(original) + tail;
        }
    });

    statics.attributes.forEach(({ element, name, original }) => {
        element.setAttribute(name, translated(original));
    });
}

export function translateDom(root) {
    statics.title = document.title;

    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);

    while (walker.nextNode()) {
        const node = walker.currentNode;
        const key = normalize(node.nodeValue);

        if (key && key in EN) {
            statics.texts.push({
                node,
                original: key,
                lead: node.nodeValue.match(/^\s*/)[0],
                tail: node.nodeValue.match(/\s*$/)[0]
            });
        }
    }

    ATTRIBUTES.forEach(name => {
        root.querySelectorAll(`[${name}]`).forEach(element => {
            const key = normalize(element.getAttribute(name));

            if (key in EN) {
                statics.attributes.push({ element, name, original: key });
            }
        });
    });

    applyStatic();
}

export function setLanguage(next) {
    if (!SUPPORTED.includes(next) || next === lang) {
        return false;
    }

    lang = next;
    locale = localeOf(next);

    try {
        localStorage.setItem(LANG_KEY, next);
        LEGAL_KEYS.forEach(key => localStorage.setItem(key, next));
    }
    catch (error) { }

    applyStatic();
    document.dispatchEvent(new CustomEvent(LANGUAGE_EVENT, { detail: { lang: next } }));
    return true;
}

const EN = {
    "{m} мин": "{m} min",
    "{h} ч": "{h} h",
    "{h} ч {m} мин": "{h} h {m} min",
    "Нужно войти заново": "Please sign in again",
    "Сессия истекла или нет доступа к заметкам. Войдите в аккаунт ещё раз.": "Your session has expired or access to your notes was lost. Please sign in again.",
    "Закрыть": "Close",
    "Войти": "Sign in",
    "Хранилище не заблокировано": "Vault not locked",
    "Не удалось сохранить секретную заметку. Проверьте подключение и попробуйте ещё раз.": "Couldn't save the secret note. Check your connection and try again.",
    "Хранилище заблокировано": "Vault locked",
    "Секретные заметки закрыты из-за неактивности.": "Secret notes were locked due to inactivity.",
    "Не удалось открыть хранилище": "Couldn't open the vault",
    "Проверьте подключение к интернету и попробуйте ещё раз.": "Check your internet connection and try again.",
    "Это один из самых распространённых паролей: его проверяют первым.": "One of the most popular passwords out there — it's the first one anyone tries.",
    "Пароль из одного повторяющегося символа подбирается за секунды.": "A password made of one repeated character is cracked in seconds.",
    "Пароль из повторяющегося фрагмента легко подобрать.": "A password made of a repeated chunk is easy to guess.",
    "Последовательности вроде 12345678, abcdefgh или qwertyui подбирают одними из первых.": "Sequences like 12345678, abcdefgh or qwertyui are among the first to be tried.",
    "Пароль только из цифр подбирается быстро. Стоит добавить другие символы.": "A digits-only password is cracked quickly. Add some other characters.",
    "Пароль коротковат. Надёжнее — от 12 символов или фраза из нескольких слов.": "A bit on the short side. 12+ characters or a few words strung together is safer.",
    "Слишком много попыток. Подождите {left} сек.": "Too many attempts. Wait {left} s.",
    "Пароль должен быть не короче 8 символов.": "The password must be at least 8 characters.",
    "Пароли не совпадают.": "Passwords don't match.",
    "Нет подключения к интернету.": "No internet connection.",
    "Создание…": "Creating…",
    "Хранилище уже создано на другом устройстве. Введите его пароль.": "The vault was already created on another device. Enter its password.",
    "Не удалось создать хранилище. Проверьте подключение и попробуйте ещё раз.": "Couldn't create the vault. Check your connection and try again.",
    "Введите пароль.": "Enter the password.",
    "Проверка…": "Checking…",
    "Данные хранилища повреждены.": "Vault data is corrupted.",
    "Неверный пароль.": "Wrong password.",
    "Удаление…": "Deleting…",
    "Хранилище сброшено": "Vault reset",
    "Секретные заметки удалены. Можно создать новое.": "Secret notes were deleted. You can create a new vault.",
    "Не удалось удалить. Проверьте подключение и попробуйте ещё раз.": "Couldn't delete. Check your connection and try again.",
    "Текущий пароль неверный.": "Current password is wrong.",
    "Введите текущий пароль.": "Enter the current password.",
    "Новый пароль должен быть не короче 8 символов.": "The new password must be at least 8 characters.",
    "Новые пароли не совпадают.": "New passwords don't match.",
    "Новый пароль должен отличаться от текущего.": "The new password must differ from the current one.",
    "Изменение…": "Changing…",
    "Пароль изменён": "Password changed",
    "Не удалось сменить пароль. Проверьте подключение и попробуйте ещё раз.": "Couldn't change the password. Check your connection and try again.",
    "Ожидание ключа доступа…": "Waiting for passkey…",
    "Этот браузер не умеет открывать хранилище с ключом доступа. Откройте его с паролем.": "This browser can't open the vault with a passkey. Use your password.",
    "Подходящий ключ доступа не найден или вход отменён. Если ключ сохранён в другом браузере, откройте хранилище с паролем.": "No matching passkey found, or sign-in was cancelled. If the passkey is saved in another browser, open the vault with your password.",
    "Этот ключ доступа не добавлен к хранилищу. Откройте хранилище с паролем и добавьте его.": "This passkey isn't added to the vault. Open the vault with your password and add it.",
    "Не удалось открыть хранилище с ключом доступа. Попробуйте пароль.": "Couldn't open the vault with a passkey. Try your password.",
    "Ключ доступа добавлен": "Passkey added",
    "Теперь хранилище можно открыть без пароля.": "You can now open the vault without a password.",
    "Этот ключ доступа уже добавлен.": "This passkey is already added.",
    "Ключи доступа работают только на домене сервиса по https или на localhost, а не по IP-адресу.": "Passkeys only work on the service domain over https or on localhost, not via an IP address.",
    "Этот браузер или менеджер паролей не умеет шифровать с ключом доступа. Хранилище по-прежнему открывается с паролем.": "This browser or password manager can't encrypt with a passkey. The vault still opens with your password.",
    "Не удалось добавить ключ доступа. Попробуйте ещё раз.": "Couldn't add the passkey. Try again.",
    "Сохранение…": "Saving…",
    "Ключ доступа убран": "Passkey removed",
    "С устройства его можно удалить в настройках системы или менеджера паролей.": "You can delete it from the device in system or password manager settings.",
    "Не удалось убрать ключ доступа. Проверьте подключение и попробуйте ещё раз.": "Couldn't remove the passkey. Check your connection and try again.",
    "шаг 1 из 2": "step 1 of 2",
    "Создать секретное хранилище": "Create a secret vault",
    "Секретные заметки шифруются на этом устройстве ещё до отправки на сервер. Без пароля их не прочитать.": "Secret notes are encrypted on this device before they reach the server. Without the password, nobody can read them.",
    "Пароль (от 8 символов)": "Password (8+ characters)",
    "Повторите пароль": "Repeat password",
    "Отмена": "Cancel",
    "Далее": "Next",
    "шаг 2 из 2": "step 2 of 2",
    "Запомните пароль": "Remember the password",
    "Если вы забудете пароль, доступ к секретным заметкам будет потерян. Сохраните его в менеджере паролей или запишите.": "If you forget the password, your secret notes will be lost. Save it in a password manager or write it down.",
    "Назад": "Back",
    "Подтвердить": "Confirm",
    "Чтобы сменить пароль, вернитесь назад.": "To change the password, go back.",
    "Разблокировать хранилище": "Unlock the vault",
    "Открыть с ключом доступа": "Open with passkey",
    "Пароль": "Password",
    "Забыли пароль?": "Forgot password?",
    "Открыть": "Open",
    "После разблокировки заметка станет секретной.": "Once unlocked, the note becomes secret.",
    "Сменить пароль хранилища": "Change vault password",
    "Текущий пароль": "Current password",
    "Новый пароль (от 8 символов)": "New password (8+ characters)",
    "Повторите новый пароль": "Repeat new password",
    "Сменить пароль": "Change password",
    "Вход по ключу доступа": "Passkey sign-in",
    "Хранилище открывается через Face ID, Touch ID или PIN устройства. Пароль остаётся запасным способом.": "The vault opens with Face ID, Touch ID or your device PIN. The password stays as a backup.",
    "убрать": "remove",
    "Добавить ключ доступа": "Add passkey",
    "Сбросить хранилище?": "Reset the vault?",
    "Все секретные заметки, включая корзину, будут удалены навсегда, а пароль сброшен. Восстановить их невозможно.": "All secret notes, including the trash, will be deleted forever and the password reset. They can't be recovered.",
    "Удалить всё": "Delete everything",
    "Без названия": "Untitled",
    "Не удалось расшифровать": "Couldn't decrypt",
    "Заметка повреждена или зашифрована другим паролем.": "The note is corrupted or encrypted with a different password.",
    "Секретная заметка": "Secret note",
    "в названиях": " in titles",
    "в тексте": " in text",
    "в тегах": " in tags",
    "Хранилище не отвечает": "Vault isn't responding",
    "Похоже, интернет решил отдохнуть. Проверьте подключение.": "Looks like the internet stepped out for coffee. Check your connection.",
    "Повторить": "Retry",
    "Заметки под паролем": "Password-protected notes",
    "Для секретов. Шифруются прямо в браузере.": "For secrets. Encrypted right in your browser.",
    "Создать хранилище": "Create vault",
    "Разблокируйте, чтобы увидеть скрытые заметки": "Unlock to see hidden notes",
    "Разблокировать": "Unlock",
    "Добавить секретную заметку": "Add secret note",
    "Здесь мимо": "Swing and a miss",
    "Секретов пока нет": "No secrets yet. Suspiciously honest.",
    "Сейчас вход через {name}": "Signed in with {name}",
    "Не удалось сохранить настройку": "Couldn't save the setting",
    "Проверьте подключение и попробуйте ещё раз.": "Check your connection and try again.",
    "Заметка": "Note",
    "Ничего не закреплено": "Nothing pinned",
    "Искали": "Searched for ",
    "— честно, везде. Пусто.": " — checked under every rug. Nothing.",
    "Ничего не нашлось": "Nothing turned up",
    "Сбросить поиск": "Clear search",
    "Все заметки закреплены": "Everything's pinned. Bold move.",
    "Тут пока пусто": "A blank slate. The best kind.",
    "Новая заметка": "New note",
    "Выбрано: {n}": "Selected: {n}",
    "Удалить {count} {notes}?": "Delete {count} {notes}?",
    "Заметки будут в корзине 15 дней, после чего удалятся автоматически.": "Notes stay in the trash for 15 days, then get deleted automatically.",
    "Удалить": "Delete",
    "Удалено {count} {notes}": "Deleted {count} {notes}",
    "Отменить": "Undo",
    "Корзина пуста": "Trash is empty",
    "Заметки сидят в корзине 15 дней. Сейчас тут никого нет.": "Notes hang out here for 15 days. Right now it's just tumbleweeds.",
    "удаляется сегодня": "deleted today",
    "осталось {days} {unit} до удаления": "{days} {unit} until deletion",
    "Очистить корзину": "Empty trash",
    "Засекретить заметку?": "Make the note secret?",
    "Заметка переместится в раздел «Секретные» и исчезнет из обычного списка.": "The note moves to “Secret” and disappears from the regular list.",
    "Засекретить": "Make secret",
    "Не удалось сохранить заметку": "Couldn't save the note",
    "Сначала восстановите подключение и попробуйте ещё раз.": "Restore your connection first and try again.",
    "Заметка засекречена": "Note made secret",
    "Не удалось засекретить": "Couldn't make it secret",
    "Заметка осталась обычной. Попробуйте ещё раз.": "The note stayed regular. Try again.",
    "в корзине · до удаления {days} {unit}": "in trash · {days} {unit} until deletion",
    "Восстановить": "Restore",
    "Удалить навсегда": "Delete forever",
    "Не сохранено": "Not saved",
    "На устройстве": "On device",
    "Сохранено": "Saved",
    "Изменить формулу": "Edit formula",
    "Предпросмотр": "Preview",
    "Применить": "Apply",
    "название тега": "tag name",
    "Удалить заметку навсегда?": "Delete the note forever?",
    "Это действие нельзя отменить.": "This can't be undone.",
    "Очистить корзину?": "Empty the trash?",
    "Все заметки из корзины будут удалены навсегда и без возможности глянуть ещё раз 👀": "Everything in the trash will be deleted forever. No peeking afterwards 👀",
    "Очистить": "Empty",
    "Корзина очищена": "Trash emptied",
    "Заметки отправились в далёкий путь: в вечную корзину 🫡": "Your notes have left for the great recycle bin in the sky 🫡",
    "Не всё удалилось": "Not everything was deleted",
    "Возможно, проблемы с интернетом.": "The internet may be acting up.",
    "Удалить заметку?": "Delete the note?",
    "Заметка будет перемещена в корзину. Её можно восстановить в течение 15 дней.": "The note will move to the trash. You can restore it within 15 days.",
    "Заметка удалена": "Note deleted",
    "Заметка удалена навсегда": "Note deleted forever",
    "Не получилось войти": "Couldn't sign in",
    "Этот адрес уже связан с другим способом входа. Попробуйте тот, через который создавался аккаунт.": "This email is already linked to another sign-in method. Try the one you used to create the account.",
    "Похоже, вход не завершился. Проверьте подключение и попробуйте ещё раз.": "Looks like sign-in didn't finish. Check your connection and try again.",
    "Сменить аккаунт": "Switch account",
    "Выберите способ входа": "Choose a sign-in method",
    "Продолжая, вы соглашаетесь с": "By continuing, you agree to the",
    "условиями использования": "Terms of Use",
    "и": "and",
    "политикой конфиденциальности": "Privacy Policy",
    "Вход без церемоний": "Sign in, skip the paperwork",
    "Выберите способ входа. При первом входе аккаунт создастся автоматически — без анкет и лишних шагов.": "Choose a sign-in method. Your account appears on first sign-in — no forms, no hoops.",
    "Выйти из аккаунта": "Sign out",
    "Пользователь": "User",
    "Выйти из аккаунта?": "Sign out?",
    "Заметки никуда не убегут. Войти обратно можно в любой момент.": "Your notes will wait right here. Come back anytime.",
    "Остаться": "Stay",
    "Выйти": "Sign out",
    "везде": "everywhere",
    "по названию": "in titles",
    "по тексту": "in text",
    "по тегам": "in tags",
    "Изменить ссылку": "Edit link",
    "Добавить ссылку": "Add link",
    "Текст ссылки": "Link text",
    "Изменить": "Edit",
    "Вставить таблицу": "Insert table",
    "Строки": "Rows",
    "Столбцы": "Columns",
    "Вставить": "Insert",
    "Вставить формулу": "Insert formula",
    "Некоторые заметки могут быть временно недоступны.": "Some notes may be temporarily unavailable.",
    "Рекомендуем проверить подключение к интернету и обновить страницу.": "We recommend checking your internet connection and reloading the page.",
    "Обновить страницу": "Reload page",
    "Светлая тема": "Light theme",
    "Тёмная тема": "Dark theme",
    "Системная тема": "System theme",
    "{n} из {total}": "{n} of {total}",
    "нет совпадений": "no matches",
    "Заменено: {n}": "Replaced: {n}",
    "Светлая": "Light",
    "Тёмная": "Dark",
    "Системная": "System",
    "Место для мыслей.": "A place for thoughts.",
    "И не только.": "And more.",
    "Редактор для документов, работы, личных заметок и просто гениальных мыслей в 3 часа ночи.": "An editor for documents, work, personal notes and simply brilliant 3 a.m. thoughts.",
    "План на неделю": "Weekly plan",
    "сегодня": "today",
    "Встреча с клиентом": "Client meeting",
    "вчера": "yesterday",
    "Релиз 2.4": "Release 2.4",
    "23 окт.": "Oct 23",
    "отправить отчёт до 9:00": "send the report by 9:00",
    "ответить на письма": "reply to emails",
    "подготовить слайды к четвергу": "prepare slides for Thursday",
    "пароль от стенда: q7Lp-2fX9": "staging password: q7Lp-2fX9",
    "секретная": "secret",
    "Секретные заметки": "Secret notes",
    "Формулы прямо в тексте": "Formulas right in the text",
    "Нужно запомнить формулу? Введите её текстом и она появится в заметке в привычном математическом виде.": "Need to remember a formula? Type it as text and it appears in the note in familiar math notation.",
    "Редактор не только для текста": "An editor for more than text",
    "Заголовки, списки, чек-листы, таблицы, ссылки, код и четыре вида подчёркивания. Есть где развернуться.": "Headings, lists, checklists, tables, links, code and four kinds of underline. Plenty of room to work.",
    "простая авторизация": "simple sign-in",
    "Два клика до заметок": "Two clicks to your notes",
    "Выберите провайдера: аккаунт будет создан сам, если вы тут впервые.": "Pick a provider: your account is created automatically if you're new here.",
    "Политика конфиденциальности": "Privacy Policy",
    "Условия использования": "Terms of Use",
    "Настройки": "Settings",
    "Тема оформления": "Theme",
    "Язык": "Language",
    "Размер текста": "Text size",
    "Статус сохранения": "Save status",
    "Показывать статус сохранения": "Show save status",
    "Автоблокировка хранилища": "Vault auto-lock",
    "Шрифт Google": "Google font",
    "Кнопка Google Sans в панели": "Google Sans button in the toolbar",
    "Способы входа": "Sign-in methods",
    "Разделять заметки по способу входа": "Separate notes by sign-in method",
    "· сборка от": "· built",
    "Найти заметку": "Find a note",
    "Закреплённые": "Pinned",
    "Секретные": "Secret",
    "заблокировать": "lock",
    "Все заметки": "All notes",
    "Корзина": "Trash",
    "Название": "Title",
    "Найти": "Find",
    "Заменить на": "Replace with",
    "Заменить": "Replace",
    "Заменить всё": "Replace all",
    "Текст заметки": "Your note",
    "Теги": "Tags",
    "Добавить тег": "Add tag",
    "Заметка не сохранена": "Note not saved",
    "Не удалось сохранить изменения": "Couldn't save changes",
    "Попробовать ещё раз": "Try again",
    "Кот прошёлся по клавиатуре и написал роман. Сохранить, правда, забыл.": "The cat walked across the keyboard and wrote a novel. Then forgot to hit save.",
    "Закрывать после бездействия": "Lock after inactivity",
    "Ключ доступа": "Passkey",
    "попробуйте": "try it",
    "Напишите первую заметку прямо здесь": "Write your first note right here",
    "Без входа. Черновик сохранится в этом браузере, а после входа станет вашей первой заметкой.": "No sign-in needed. The draft stays in this browser and becomes your first note once you sign in.",
    "Список покупок, идея на миллион или план на выходные…": "A shopping list, a million-dollar idea or weekend plans…",
    "Черновик сохранён в браузере": "Draft saved in this browser",
    "Стереть": "Clear",
    "Черновик стал заметкой": "Your draft is now a note",
    "Заметка с главной страницы теперь в вашем списке.": "The note from the welcome page is now in your list.",
    "Отдельное хранилище, автоблокировка и шифрование до отправки на сервер. Открывается по Face ID или отпечатку.": "A separate vault, auto-lock and encryption before anything leaves your device. Opens with Face ID or a fingerprint.",
    "Работает без интернета": "Works offline",
    "Пишите в самолёте или в метро. Когда сеть вернётся, всё само уйдёт на сервер.": "Write on a plane or in the subway. Once you're back online, everything syncs on its own.",
    "безопасность": "security",
    "Как защищены секретные заметки": "How secret notes stay secret",
    "Шифрование происходит прямо в браузере. Напишите что-нибудь и посмотрите, что на самом деле уходит на сервер.": "Encryption happens right in your browser. Type something and see what actually reaches the server.",
    "Здесь появится шифр": "Gibberish will appear here",
    "Напишите какой-нибудь секрет": "Spill a secret",
    "Сервер получает": "What the server sees",
    "Ключ шифрования защищён вашим паролем и не покидает браузер. Каждое сохранение шифруется заново, поэтому даже одинаковый текст каждый раз выглядит по-разному.": "The encryption key is protected by your password and never leaves the browser. Every save is encrypted from scratch, so even the same text looks different every time.",
    "Хотите продолжить писать заметку? Войдите, чтобы увидеть все функции заметок.": "Want to keep writing? Sign in to unlock everything codeq notes can do.",
    "Войдите, чтобы продолжить писать.": "Sign in to continue writing."
};
