import { supabase } from "./backend.js";
import { forgetUser } from "./database.js";

export const auth = supabase.auth;

const PROVIDER_OPTIONS = {
    google: { queryParams: { prompt: "select_account" } },
    github: {},
    discord: {},
    figma: { queryParams: { scope: "current_user:read" } }
};

const GOOGLE_CLIENT_ID = "377364054650-odpgjoa8h2huu9lrgfo9ok6m7bjh3jpr.apps.googleusercontent.com";
const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_ORIGINS = ["https://codeqnotes.onrender.com"];
const GOOGLE_STATE_KEY = "startNotes.googleState";
const GOOGLE_STATE_TTL = 15 * 60 * 1000;
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

function googleEnabled() {
    return GOOGLE_ORIGINS.includes(location.origin) && !GOOGLE_CLIENT_ID.startsWith("YOUR-") && !!(window.crypto && crypto.subtle);
}

function googleRedirectUri() {
    return location.origin + "/";
}

function base64url(bytes) {
    let binary = "";
    bytes.forEach(b => { binary += String.fromCharCode(b); });
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function randomToken(length) {
    return base64url(crypto.getRandomValues(new Uint8Array(length)));
}

async function sha256(text) {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
    return base64url(new Uint8Array(digest));
}

function readSession(key) {
    try {
        return JSON.parse(sessionStorage.getItem(key) || "null");
    }
    catch (error) {
        return null;
    }
}

function writeSession(key, value) {
    try {
        if (value === null) {
            sessionStorage.removeItem(key);
        }
        else {
            sessionStorage.setItem(key, JSON.stringify(value));
        }
    }
    catch (error) { }
}

function clearSupabaseVerifier() {
    try {
        Object.keys(localStorage)
            .filter(key => key.startsWith("sb-") && key.endsWith("-code-verifier"))
            .forEach(key => localStorage.removeItem(key));
    }
    catch (error) { }
}

async function startGoogleRedirect() {
    const state = randomToken(24);
    const verifier = randomToken(48);
    const challenge = await sha256(verifier);

    writeSession(GOOGLE_STATE_KEY, { state, verifier, at: Date.now() });
    clearSupabaseVerifier();

    const params = new URLSearchParams({
        client_id: GOOGLE_CLIENT_ID,
        redirect_uri: googleRedirectUri(),
        response_type: "code",
        scope: "openid email profile",
        state,
        code_challenge: challenge,
        code_challenge_method: "S256",
        prompt: "select_account"
    });

    location.assign(`${GOOGLE_AUTH_URL}?${params}`);
    await new Promise(() => {});
}

async function supabaseRedirect(provider) {
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

let googleInFlight = false;

async function finishGoogleRedirect() {
    const url = new URL(location.href);
    const state = url.searchParams.get("state");
    const saved = readSession(GOOGLE_STATE_KEY);

    if (!state || !saved || saved.state !== state || Date.now() - saved.at > GOOGLE_STATE_TTL) {
        return null;
    }

    googleInFlight = true;
    writeSession(GOOGLE_STATE_KEY, null);

    const code = url.searchParams.get("code");
    const failure = url.searchParams.get("error");
    ["code", "state", "scope", "authuser", "prompt", "hd", "error", "error_description"].forEach(name => url.searchParams.delete(name));
    history.replaceState(history.state, "", url.pathname + url.search + url.hash);

    try {
        if (failure || !code) {
            writeStorage(PENDING_KEY, null);
            return { cancelled: true };
        }

        const { data, error } = await supabase.functions.invoke("google-code", {
            body: { code, verifier: saved.verifier, redirect_uri: googleRedirectUri() }
        });

        if (error || !data || !data.id_token) {
            throw error || new Error("google: token exchange failed");
        }

        const { error: signInError } = await supabase.auth.signInWithIdToken({
            provider: "google",
            token: data.id_token
        });

        if (signInError) {
            throw signInError;
        }

        return { ok: true };
    }
    catch (error) {
        console.error("Вход через Google с вашим доменом не удался, переходим на обычный вход.", error);
        writeStorage(PENDING_KEY, JSON.stringify({ provider: "google", at: Date.now() }));

        try {
            await supabaseRedirect("google");
        }
        catch (redirectError) {
            writeStorage(PENDING_KEY, null);
        }

        return { error };
    }
    finally {
        googleInFlight = false;
    }
}

const googleCallback = finishGoogleRedirect();

export async function login(provider) {
    if (!PROVIDER_OPTIONS[provider]) {
        throw new Error(`auth: unknown provider ${provider}`);
    }

    writeStorage(PENDING_KEY, JSON.stringify({ provider, at: Date.now() }));

    if (provider === "google" && googleEnabled()) {
        await startGoogleRedirect();
        return;
    }

    await supabaseRedirect(provider);
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
    let latest = null;

    const deliver = () => {
        const user = latest;
        const id = user ? user.uid : null;

        if (id === lastId) {
            return;
        }

        lastId = id;
        setTimeout(() => callback(user), 0);
    };

    supabase.auth.onAuthStateChange((event, session) => {
        latest = mapUser(session && session.user);

        if (!latest && googleInFlight) {
            googleCallback.finally(deliver);
            return;
        }

        deliver();
    });
}
