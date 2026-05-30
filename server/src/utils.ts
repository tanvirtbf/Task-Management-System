import { randomBytes, createHash } from "crypto";

/**
 * Generate a VARCHAR(64)-compatible ID with a 3-letter prefix.
 * Format: `<prefix>-<22-char base64url>` → ~26 chars, fits VARCHAR(64).
 *
 * Examples:
 *   fakeId("u")   → "u-aBc123XyZ45_abCdef-Ghi"   (user)
 *   fakeId("ws")  → "ws-aBc123XyZ45_abCdef-Ghi"  (workspace)
 *   fakeId("ses") → "ses-aBc123XyZ45_abCdef-Ghi" (session)
 */
export const fakeId = (prefix = "id"): string => {
    return `${prefix}-${randomBytes(16).toString("base64url")}`;
};

/**
 * SHA-256 hash of a string — returns 64-char hex.
 * Used for storing refresh-token hashes in `sessions.token_hash`.
 */
export const sha256 = (input: string): string =>
    createHash("sha256").update(input).digest("hex");

/**
 * Cryptographically-random, URL-safe secret token (default 256 bits).
 *
 * Used for single-use links such as password-reset and invitation tokens: the
 * raw value is emailed to the user and placed in a URL, while only its
 * `sha256(token)` is persisted. Distinct from `fakeId` — that mints a
 * prefixed row identifier, this mints an unguessable secret.
 */
export const randomToken = (bytes = 32): string =>
    randomBytes(bytes).toString("base64url");
