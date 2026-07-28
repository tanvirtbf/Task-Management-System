"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.randomToken = exports.sha256 = exports.fakeId = void 0;
const crypto_1 = require("crypto");
/**
 * Generate a VARCHAR(64)-compatible ID with a 3-letter prefix.
 * Format: `<prefix>-<22-char base64url>` → ~26 chars, fits VARCHAR(64).
 *
 * Examples:
 *   fakeId("u")   → "u-aBc123XyZ45_abCdef-Ghi"   (user)
 *   fakeId("ws")  → "ws-aBc123XyZ45_abCdef-Ghi"  (workspace)
 *   fakeId("ses") → "ses-aBc123XyZ45_abCdef-Ghi" (session)
 */
const fakeId = (prefix = "id") => {
    return `${prefix}-${(0, crypto_1.randomBytes)(16).toString("base64url")}`;
};
exports.fakeId = fakeId;
/**
 * SHA-256 hash of a string — returns 64-char hex.
 * Used for storing refresh-token hashes in `sessions.token_hash`.
 */
const sha256 = (input) => (0, crypto_1.createHash)("sha256").update(input).digest("hex");
exports.sha256 = sha256;
/**
 * Cryptographically-random, URL-safe secret token (default 256 bits).
 *
 * Used for single-use links such as password-reset and invitation tokens: the
 * raw value is emailed to the user and placed in a URL, while only its
 * `sha256(token)` is persisted. Distinct from `fakeId` — that mints a
 * prefixed row identifier, this mints an unguessable secret.
 */
const randomToken = (bytes = 32) => (0, crypto_1.randomBytes)(bytes).toString("base64url");
exports.randomToken = randomToken;
