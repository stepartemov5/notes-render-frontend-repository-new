import { supabase } from "./backend.js";
import { forgetUser } from "./database.js";

export const auth = supabase.auth;

const PROVIDER_OPTIONS = {
    google: { queryParams: { prompt: "select_account" } },
    github: {},
    discord: {},
    figma: { queryParams: { scope: "current_user:read" } }
};

const PENDING_KEY = "startNotes.pendingProvider";
const PROVIDER_KEY = "startNotes.provider.";
const PENDING_TTL = 15 * 60 * 1000;

function readStorage(key) {
    try {
        return localStorage.getItem(key);
    }
    catch (error) {
        return null;
    }
}

function writeStorage(key, value) {
    try {
        if (value === null) {
            localStorage.removeItem(key);
        }
        else {
            localStorage.setItem(key, value);
        }
    }
    catch (error) { }
}

function resolveProvider(uid, providers) {
    let pending = null;

    try {
        pending = JSON.parse(readStorage(PENDING_KEY) || "null");
    }
    catch (error) { }

    if (pending && providers.includes(pending.provider) && Date.now() - pending.at < PENDING_TTL) {
        writeStorage(PROVIDER_KEY + uid, pending.provider);
        writeStorage(PENDING_KEY, null);
    }

    const saved = readStorage(PROVIDER_KEY + uid);
    return saved && providers.includes(saved) ? saved : providers[0] || null;
}

export function isUnsupportedBrowser() {
    const ua = navigator.userAgent.toLowerCase();

    return (
        ua.includes(" line/") ||
        ua.includes("fb_iab") ||
        ua.includes("instagram") ||
        ua.includes("; wv)")
    );
}

function mapUser(user) {
    if (!user) {
        return null;
    }

    const meta = user.user_metadata || {};
    const identities = [...(user.identities || [])]
        .filter(identity => identity.provider && identity.provider !== "email")
        .sort((a, b) => String(b.last_sign_in_at || "").localeCompare(String(a.last_sign_in_at || "")));
    const providers = [...new Set([
        ...identities.map(identity => identity.provider),
        ...((user.app_metadata && user.app_metadata.providers) || []).filter(p => p !== "email")
    ])];

    return {
        uid: user.id,
        providers,
        provider: resolveProvider(user.id, providers),
        email: user.email || meta.email || "",
        displayName: meta.full_name || meta.name || meta.user_name || meta.preferred_username || meta.handle || "",
        photoURL: meta.avatar_url || meta.picture || meta.img_url || ""
    };
}

export async function login(provider) {
    if (!PROVIDER_OPTIONS[provider]) {
        throw new Error(`auth: unknown provider ${provider}`);
    }

    writeStorage(PENDING_KEY, JSON.stringify({ provider, at: Date.now() }));

    const { error } = await supabase.auth.signInWithOAuth({
        provider,
        options: {
            redirectTo: location.origin + location.pathname,
            ...PROVIDER_OPTIONS[provider]
        }
    });

    if (error) {
        console.error(`Не удалось войти через ${provider}. Ошибка`, error);
        throw error;
    }

    await new Promise(() => {});
}

export async function logout() {
    const { data } = await supabase.auth.getSession();
    const uid = data && data.session ? data.session.user.id : null;

    const { error } = await supabase.auth.signOut({ scope: navigator.onLine ? "global" : "local" });

    if (error) {
        throw error;
    }

    if (uid) {
        await forgetUser(uid);
    }
}

export function onUserChanged(callback) {
    let lastId;

    supabase.auth.onAuthStateChange((event, session) => {
        const user = mapUser(session && session.user);
        const id = user ? user.uid : null;

        if (id === lastId) {
            return;
        }

        lastId = id;
        setTimeout(() => callback(user), 0);
    });
}
