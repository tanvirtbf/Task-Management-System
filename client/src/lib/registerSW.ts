/**
 * P8 of MOBILE_REBUILD_PLAN.md — register the service worker unconditionally.
 *
 * It used to be registered inside `ensurePushSubscription()`, which returns
 * early unless the user has already granted notification permission. So anyone
 * who tapped "Not now" on the push prompt had **no service worker at all**,
 * permanently: no offline shell, and — because Chrome requires a registered
 * worker with a fetch handler before it will offer installation — no way to
 * install the app either. Two capabilities gated behind an unrelated choice.
 *
 * Registration is deferred to `load` so it never competes with the first paint,
 * and every failure is swallowed: a browser without service workers, or a page
 * served over plain HTTP in some dev setup, must not break the app.
 */
export const registerServiceWorker = (): void => {
    if (!("serviceWorker" in navigator)) return;
    window.addEventListener("load", () => {
        navigator.serviceWorker.register("/sw.js").catch(() => {
            /* unsupported, blocked, or insecure context — the app works without it */
        });
    });
};
