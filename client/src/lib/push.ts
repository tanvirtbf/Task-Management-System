import { pushApi } from "../http/api";

/**
 * Web Push (§29c) client plumbing — service-worker registration and the
 * subscription lifecycle. Framework-free on purpose so the auth store can call
 * the teardown on sign-out; the UI lives in `components/shared/PushPrompt.tsx`.
 *
 * The two levels of the 2026-08-08 notification-delivery feature:
 *   Level 1 (tab open)   — `hooks/useInboxStream.ts`, live SSE.
 *   Level 2 (tab closed) — THIS. The browser's push service wakes
 *                          `public/sw.js`, which shows the notification.
 *
 * Nothing here throws: every entry point resolves to a boolean/void so a
 * blocked permission, a missing service worker, an unconfigured server, or an
 * offline device degrades silently to the in-app + email channels.
 */

/**
 * Is Level 2 possible in this browser, right now?
 *
 * False on: iOS Safari in a normal tab (no `Notification` until the site is
 * installed to the Home Screen), any non-secure context (a LAN IP over plain
 * http — service workers need https or localhost), and private modes that
 * disable the Push API.
 */
export const isPushSupported = (): boolean =>
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window &&
    window.isSecureContext;

/**
 * True once this tab knows a push subscription is live, so Level 1 can stay
 * quiet and leave the OS bubble to the service worker (no double
 * notification). Deliberately in-memory: it describes THIS tab's knowledge,
 * not a durable fact.
 */
let pushActive = false;

export const isPushActive = (): boolean => pushActive;

/**
 * The `applicationServerKey` bytes `pushManager.subscribe()` expects.
 *
 * Backed by an explicit `ArrayBuffer` (not the `new Uint8Array(length)`
 * shorthand) because the DOM types require `Uint8Array<ArrayBuffer>` — the
 * shorthand widens to `ArrayBufferLike`, which also covers `SharedArrayBuffer`
 * and is therefore not a valid `BufferSource`.
 */
export const urlBase64ToUint8Array = (
    base64Url: string,
): Uint8Array<ArrayBuffer> => {
    const padding = "=".repeat((4 - (base64Url.length % 4)) % 4);
    const base64 = (base64Url + padding).replace(/-/g, "+").replace(/_/g, "/");
    const raw = window.atob(base64);
    const out = new Uint8Array(new ArrayBuffer(raw.length));
    for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
    return out;
};

/**
 * Ensure THIS browser has a live push subscription registered against the
 * CURRENT account. Call only when `Notification.permission === "granted"`.
 *
 * Safe — and intended — to call on every sign-in: re-registering an existing
 * subscription is an upsert server-side, which is exactly what re-binds a
 * shared computer to whoever just signed in.
 *
 * Returns true when a subscription is in place; false when the feature is off
 * (no VAPID keys server-side → 503) or anything failed. Never throws.
 */
export const ensurePushSubscription = async (): Promise<boolean> => {
    try {
        if (!isPushSupported()) return false;
        if (Notification.permission !== "granted") return false;

        let publicKey: string;
        try {
            publicKey = await pushApi.publicKey();
        } catch {
            pushActive = false;
            return false; // 503 push.not_configured, or offline — feature off
        }

        const reg = await navigator.serviceWorker.register("/sw.js");
        // Wait for a controlling worker; `subscribe()` on a freshly-registered
        // worker can otherwise race the activation.
        await navigator.serviceWorker.ready;

        const existing = await reg.pushManager.getSubscription();
        const sub =
            existing ??
            (await reg.pushManager.subscribe({
                userVisibleOnly: true,
                applicationServerKey: urlBase64ToUint8Array(publicKey),
            }));

        const json = sub.toJSON();
        if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) {
            return false;
        }
        await pushApi.subscribe({
            endpoint: json.endpoint,
            keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
        });
        pushActive = true;
        return true;
    } catch {
        return false;
    }
};

/**
 * Ask the browser for permission (must be called from a user gesture) and, on
 * a grant, register the device. Shared by the first-sign-in prompt and the
 * Profile → Notifications card so both doors behave identically.
 *
 *   granted     — permission given AND the device registered
 *   denied      — the person (or the browser) said no
 *   unsupported — this browser/context can't do Web Push at all
 *   failed      — permission given but registration did not complete
 */
export const requestPushPermission = async (): Promise<
    "granted" | "denied" | "unsupported" | "failed"
> => {
    if (!isPushSupported()) return "unsupported";
    const permission = await Notification.requestPermission();
    if (permission !== "granted") return "denied";
    return (await ensurePushSubscription()) ? "granted" : "failed";
};

/**
 * Sign-out teardown: drop the server row for this device, then unsubscribe the
 * browser, so a shared computer never keeps pushing the previous account's
 * tasks at the next person.
 *
 * MUST be awaited (or at least fired) BEFORE the access token is purged — the
 * DELETE is authenticated. Best-effort by contract: it never throws and never
 * blocks sign-out.
 */
export const teardownPushSubscription = async (): Promise<void> => {
    pushActive = false;
    try {
        if (!isPushSupported()) return;
        const reg = await navigator.serviceWorker.getRegistration("/sw.js");
        const sub = await reg?.pushManager.getSubscription();
        if (!sub) return;
        // Server first (the token is still alive), then the browser side.
        await pushApi.unsubscribe(sub.endpoint).catch(() => undefined);
        await sub.unsubscribe().catch(() => undefined);
    } catch {
        /* best-effort by contract */
    }
};
