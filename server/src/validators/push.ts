import { body } from "express-validator";

/**
 * Validators for the §29c Web Push endpoints. Pair each chain with the shared
 * `validate` middleware (422 envelope on failure).
 *
 * The request body is exactly what `PushSubscription.toJSON()` produces in the
 * browser: `{ endpoint, keys: { p256dh, auth } }`.
 *
 * The endpoint MUST be an `https://` URL. Push services are TLS-only, and an
 * unchecked endpoint is a stored-SSRF foothold — `PushService` POSTs to that
 * URL on every dispatch, so whatever a client stores here is a request this
 * server will later make on its own.
 */

const endpointField = body("endpoint")
    .isString()
    .withMessage("endpoint must be a string")
    .bail()
    .trim()
    .isLength({ min: 1, max: 1000 })
    .withMessage("endpoint must be 1–1000 characters")
    .bail()
    .custom((value: string) => /^https:\/\/[^\s]+$/i.test(value))
    .withMessage("endpoint must be an https:// URL");

/** base64url — the charset the browser emits for both encryption keys. */
const keyField = (field: string, max: number) =>
    body(field)
        .isString()
        .withMessage(`${field} must be a string`)
        .bail()
        .trim()
        .isLength({ min: 1, max })
        .withMessage(`${field} must be 1–${max} characters`)
        .bail()
        .custom((value: string) => /^[A-Za-z0-9_-]+={0,2}$/.test(value))
        .withMessage(`${field} must be base64url`);

export const subscribeValidator = [
    endpointField,
    keyField("keys.p256dh", 255),
    keyField("keys.auth", 191),
];

export const unsubscribeValidator = [endpointField];
