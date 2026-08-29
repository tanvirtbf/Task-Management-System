/* eslint-disable no-undef */
/**
 * BeautyBooth Tasks — service worker (Web Push receiver only).
 *
 * Two jobs: receive Web Push while the app tab is CLOSED, and keep the app
 * shell available offline (P8 of MOBILE_REBUILD_PLAN.md).
 *
 * The original file had NO `fetch` handler, on the reasoning that a stale
 * worker can never serve a stale app. That reasoning is sound and is why the
 * handler below is written the way it is:
 *
 *   /api/*        never cached, never intercepted. Stale task data is worse
 *                 than no task data, and D8 chose a read-cache of the SHELL,
 *                 not of the content.
 *   navigations   network first, cache only as the offline fallback — so a
 *                 deploy is picked up on the next online load, and a stale
 *                 shell can never reference chunks that no longer exist.
 *   /assets/*     cache first. These filenames are content-hashed, so a hit is
 *                 by definition the right bytes.
 *
 * Chrome also requires a fetch handler before it will treat the app as
 * installable, which is why "no offline story" and "cannot be installed" were
 * the same bug.
 *
 * Payload contract (server `PushService.PushPayload`):
 *   { title, body, url, tag }
 *     url — SPA path to open on click (e.g. "/t/<taskId>")
 *     tag — collapse key; the in-tab (SSE) path uses the SAME tag for one
 *           event, so the OS shows one bubble, never two.
 *
 * Served from client/public/ → `/sw.js` at the site root (root scope) by Vite
 * in dev and by nginx from client/dist in production.
 */

const SHELL_CACHE = "bb-shell-v1";
const SHELL_URLS = [
    "/",
    "/icon.svg",
    "/icon-192.png",
    "/apple-touch-icon.png",
    "/manifest.webmanifest",
];

// A new worker version takes over immediately instead of waiting for every
// tab to close — otherwise a payload-shape change could sit unused for days.
self.addEventListener("install", (event) => {
    event.waitUntil(
        caches
            .open(SHELL_CACHE)
            // One bad URL must not fail the whole install, so each is added
            // on its own and allowed to fail.
            .then((c) => Promise.all(SHELL_URLS.map((u) => c.add(u).catch(() => {}))))
            .then(() => self.skipWaiting()),
    );
});

self.addEventListener("activate", (event) => {
    event.waitUntil(
        (async () => {
            const names = await caches.keys();
            await Promise.all(
                names.filter((n) => n !== SHELL_CACHE).map((n) => caches.delete(n)),
            );
            await self.clients.claim();
        })(),
    );
});

self.addEventListener("fetch", (event) => {
    const { request } = event;
    if (request.method !== "GET") return;
    const url = new URL(request.url);
    if (url.origin !== self.location.origin) return; // fonts etc. — leave alone
    if (url.pathname.startsWith("/api/")) return; // never cache task data
    if (url.pathname === "/sw.js") return;

    // Content-hashed bundles: a cache hit is the right bytes by definition.
    if (url.pathname.startsWith("/assets/")) {
        event.respondWith(
            caches.match(request).then(
                (hit) =>
                    hit ||
                    fetch(request).then((res) => {
                        if (res.ok) {
                            const copy = res.clone();
                            caches.open(SHELL_CACHE).then((c) => c.put(request, copy));
                        }
                        return res;
                    }),
            ),
        );
        return;
    }

    // Everything else — the HTML shell included — is network first, so a deploy
    // lands on the next online load and the cache is purely an offline safety net.
    if (request.mode === "navigate" || url.pathname === "/") {
        event.respondWith(
            fetch(request)
                .then((res) => {
                    if (res.ok) {
                        const copy = res.clone();
                        caches.open(SHELL_CACHE).then((c) => c.put("/", copy));
                    }
                    return res;
                })
                .catch(async () => (await caches.match("/")) || Response.error()),
        );
    }
});

self.addEventListener("push", (event) => {
    let data = {};
    try {
        data = event.data ? event.data.json() : {};
    } catch {
        /* non-JSON payload — fall through to the generic bubble */
    }
    // `userVisibleOnly: true` is a promise to the browser: every push shows a
    // notification. Breaking it burns the origin's push budget, so there is no
    // "silent" branch here even when the app is focused — the shared `tag`
    // handles the duplicate case instead.
    event.waitUntil(
        self.registration.showNotification(data.title || "BeautyBooth Tasks", {
            body: data.body || "",
            tag: data.tag || undefined,
            icon: "/icon.svg",
            badge: "/icon.svg",
            data: { url: data.url || "/inbox" },
        }),
    );
});

self.addEventListener("notificationclick", (event) => {
    event.notification.close();
    const url =
        (event.notification.data && event.notification.data.url) || "/inbox";
    event.waitUntil(
        (async () => {
            const wins = await self.clients.matchAll({
                type: "window",
                includeUncontrolled: true,
            });
            // Reuse an already-open app window rather than opening a duplicate.
            for (const win of wins) {
                if ("focus" in win) {
                    await win.focus();
                    if ("navigate" in win) {
                        try {
                            await win.navigate(url);
                            return;
                        } catch {
                            /* navigate can reject — fall through to openWindow */
                        }
                    } else {
                        return;
                    }
                }
            }
            await self.clients.openWindow(url);
        })(),
    );
});
