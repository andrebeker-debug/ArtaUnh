const CACHE = "artaunh-v1.5.6";

const APP_SHELL = [
    "./",
    "./index.html",
    "./manifest.json",
    "./css/styles.css",
    "./js/supabase-config.js",
    "./js/storage.js",
    "./js/auth.js",
    "./js/icons.js",
    "./js/charts.js",
    "./js/app.js",
    "./assets/logo-icon.webp",
    "./assets/fonts/source-sans-3-latin.woff2",
    "./assets/fonts/space-grotesk-latin.woff2",
    "./assets/icon-192.png",
    "./assets/icon-512.png",
    "./assets/apple-touch-icon.png",
];

self.addEventListener("install", (event) => {
    event.waitUntil(
        caches.open(CACHE)
            .then((cache) => cache.addAll(APP_SHELL).catch(() => undefined))
            .then(() => self.skipWaiting())
    );
});

self.addEventListener("activate", (event) => {
    event.waitUntil(
        caches.keys()
            .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
            .then(() => self.clients.claim())
    );
});

self.addEventListener("fetch", (event) => {
    const req = event.request;
    if (req.method !== "GET") return;

    const url = new URL(req.url);

    if (url.origin === self.location.origin) {
        event.respondWith(
            caches.match(req).then((cached) => {
                if (cached) return cached;
                return fetch(req)
                    .then((res) => {
                        const copy = res.clone();
                        caches.open(CACHE).then((cache) => cache.put(req, copy)).catch(() => undefined);
                        return res;
                    })
                    .catch(() => caches.match("./index.html"));
            })
        );
        return;
    }

    event.respondWith(
        caches.match(req).then((cached) => {
            const network = fetch(req)
                .then((res) => {
                    const copy = res.clone();
                    caches.open(CACHE).then((cache) => cache.put(req, copy)).catch(() => undefined);
                    return res;
                })
                .catch(() => cached);
            return cached || network;
        })
    );
});
