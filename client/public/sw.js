/* eslint-disable no-undef */
/**
 * BeautyBooth Tasks — service worker (Web Push receiver only).
 *
 * Deliberately TINY: no caching, no offline shell, and crucially NO `fetch`
 * handler — the SPA's network behaviour is exactly what it was before this
 * file existed, so a stale worker can never serve a stale app. Its only job is
 * to let the browser deliver notifications while the app tab is CLOSED, and to
 * route the click back into the app.
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

// A new worker version takes over immediately instead of waiting for every
// tab to close — otherwise a payload-shape change could sit unused for days.
self.addEventListener("install", () => {
    self.skipWaiting();
});

self.addEventListener("activate", (event) => {
    event.waitUntil(self.clients.claim());
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
