/**
 * Client-side helpers for push notifications + service worker registration.
 *
 * Usage:
 *   await registerServiceWorker();
 *   const ok = await enablePush();   // call from a button click
 *   await disablePush();
 *
 * In production these would talk to a real VAPID-keyed push server; here we
 * just stand the plumbing up so the client side is wired and ready.
 */

const SW_PATH = "/service-worker.js";

let registrationPromise: Promise<ServiceWorkerRegistration | null> | null =
    null;

export const isPushSupported = (): boolean =>
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window;

export const registerServiceWorker = (): Promise<ServiceWorkerRegistration | null> => {
    if (!isPushSupported()) return Promise.resolve(null);
    if (registrationPromise) return registrationPromise;
    registrationPromise = navigator.serviceWorker
        .register(SW_PATH, { scope: "/" })
        .then((reg) => reg)
        .catch((err) => {
            // eslint-disable-next-line no-console
            console.warn("[push] SW registration failed", err);
            return null;
        });
    return registrationPromise;
};

export const enablePush = async (): Promise<{
    ok: boolean;
    reason?: string;
}> => {
    if (!isPushSupported()) return { ok: false, reason: "unsupported" };

    const permission = await Notification.requestPermission();
    if (permission !== "granted")
        return { ok: false, reason: "denied" };

    const reg = await registerServiceWorker();
    if (!reg) return { ok: false, reason: "no-registration" };

    try {
        const sub = await reg.pushManager.subscribe({
            userVisibleOnly: true,
            // applicationServerKey would come from your VAPID public key in production.
        });
        // Real app: POST sub.toJSON() to your backend so it can target this device.
        // eslint-disable-next-line no-console
        console.info("[push] subscribed", sub.toJSON());
        return { ok: true };
    } catch (err) {
        // eslint-disable-next-line no-console
        console.warn("[push] subscribe failed", err);
        return { ok: false, reason: "subscribe-failed" };
    }
};

export const disablePush = async (): Promise<boolean> => {
    const reg = await registerServiceWorker();
    if (!reg) return false;
    const sub = await reg.pushManager.getSubscription();
    if (!sub) return true;
    return sub.unsubscribe();
};

export const currentPermission = (): NotificationPermission | "unsupported" => {
    if (!isPushSupported()) return "unsupported";
    return Notification.permission;
};

/** Show a local notification for testing (without push server). */
export const showTestNotification = async (
    title: string,
    body: string,
): Promise<boolean> => {
    if (!isPushSupported()) return false;
    if (Notification.permission !== "granted") return false;
    const reg = await registerServiceWorker();
    if (!reg) return false;
    await reg.showNotification(title, {
        body,
        icon: "/icon.svg",
        badge: "/icon.svg",
    });
    return true;
};
