const CACHE = "startNotes-v7";

const SHELL = [
    "./",
    "index.html",
    "app.js",
    "i18n.js",
    "auth.js",
    "backend.js",
    "database.js",
    "vault-crypto.js",
    "theme.css",
    "base.css",
    "secret.css",
    "welcome.css",
    "account-panel.css",
    "autolock.css",
    "manifest.json"
];

const CDN_HOSTS = new Set([
    "cdn.jsdelivr.net",
    "fonts.googleapis.com",
    "fonts.gstatic.com"
]);

self.addEventListener("install", event => {
    event.waitUntil(
        caches.open(CACHE)
            .then(cache => Promise.allSettled(SHELL.map(url => cache.add(url))))
            .then(() => self.skipWaiting())
    );
});

self.addEventListener("activate", event => {
    event.waitUntil(
        caches.keys()
            .then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key))))
            .then(() => self.clients.claim())
    );
});

function cacheable(request) {
    if (request.method !== "GET") {
        return false;
    }

    const url = new URL(request.url);

    if (url.origin === self.location.origin) {
        return !url.pathname.startsWith("/__/");
    }

    return CDN_HOSTS.has(url.hostname);
}

async function networkFirst(request) {
    const cache = await caches.open(CACHE);

    try {
        const response = await fetch(request);

        if (response.ok || response.type === "opaque") {
            cache.put(request, response.clone());
        }

        return response;
    }
    catch (error) {
        const cached = await cache.match(request, { ignoreSearch: request.mode === "navigate" });

        if (cached) {
            return cached;
        }

        if (request.mode === "navigate") {
            const shell = await cache.match("index.html");

            if (shell) {
                return shell;
            }
        }

        throw error;
    }
}

async function cacheFirst(request) {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(request);

    if (cached) {
        return cached;
    }

    const response = await fetch(request);

    if (response.ok || response.type === "opaque") {
        cache.put(request, response.clone());
    }

    return response;
}

self.addEventListener("fetch", event => {
    const { request } = event;

    if (!cacheable(request)) {
        return;
    }

    const url = new URL(request.url);
    const immutable = url.hostname === "fonts.gstatic.com" || /@\d+\.\d+\.\d+/.test(url.pathname);

    event.respondWith(immutable ? cacheFirst(request) : networkFirst(request));
});
