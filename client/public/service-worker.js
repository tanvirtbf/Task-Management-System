/**
 * Service worker for ShutkiHut Tasks.
 *
 * Responsibilities:
 *  - Cache the app shell for offline boot.
 *  - Listen for `push` events and show notifications.
 *  - Handle notification clicks (navigate to the relevant URL).
 *
 * No fancy strategies — small, predictable, easy to debug. The bundler
 * handles asset hashing, so this file just intercepts navigations.
 */

const CACHE_NAME = "tms-shell-v1";
const PRECACHE_URLS = ["/", "/manifest.webmanifest"];

self.addEventListener("install", (event) => {
    event.waitUntil(
        caches
            .open(CACHE_NAME)
            .then((cache) => cache.addAll(PRECACHE_URLS))
            .catch(() => {
                // Network-only fallback in dev; nothing to do.
            }),
    );
    self.skipWaiting();
});

self.addEventListener("activate", (event) => {
    event.waitUntil(
        caches
            .keys()
            .then((keys) =>
                Promise.all(
                    keys
                        .filter((k) => k !== CACHE_NAME)
                        .map((k) => caches.delete(k)),
                ),
            )
            .then(() => self.clients.claim()),
    );
});

/**
 * Network-first for navigations so the user always sees the latest app,
 * with a cached fallback when offline.
 */
self.addEventListener("fetch", (event) => {
    const req = event.request;
    if (req.method !== "GET" || req.mode !== "navigate") return;
    event.respondWith(
        fetch(req).catch(() =>
            caches.match("/").then((res) => res ?? Response.error()),
        ),
    );
});

/**
 * Push payload contract (matches the dispatcher in `lib/push.ts`):
 *   {
 *     title: string,
 *     body?: string,
 *     icon?: string,
 *     tag?: string,        // dedupe identical notifications
 *     url?: string,        // open this when clicked
 *     data?: unknown
 *   }
 */
self.addEventListener("push", (event) => {
    let payload = {};
    try {
        payload = event.data ? event.data.json() : {};
    } catch {
        payload = { title: "Tasks", body: event.data?.text() ?? "" };
    }
    const title = payload.title || "ShutkiHut Tasks";
    const options = {
        body: payload.body,
        icon: payload.icon || "/icon.svg",
        badge: "/icon.svg",
        tag: payload.tag,
        data: {
            url: payload.url || "/",
            ...payload.data,
        },
    };
    event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
    event.notification.close();
    const target = event.notification.data?.url || "/";
    event.waitUntil(
        self.clients
            .matchAll({ type: "window", includeUncontrolled: true })
            .then((clientList) => {
                // Focus an existing tab if we can; otherwise open a new one.
                for (const client of clientList) {
                    if ("focus" in client) {
                        client.navigate(target).catch(() => {});
                        return client.focus();
                    }
                }
                if (self.clients.openWindow)
                    return self.clients.openWindow(target);
            }),
    );
});
