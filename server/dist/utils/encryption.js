"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.decryptJSON = exports.encryptJSON = exports.encryptionReady = void 0;
const crypto_1 = __importDefault(require("crypto"));
const config_1 = require("../config");
const ALGORITHM = "aes-256-gcm";
const ENCODING = "utf8";
const HEX = "hex";
/**
 * True when ENCRYPTION_KEY holds a usable 256-bit key (64 hex chars).
 * Callers that persist encrypted data must check this BEFORE creating any
 * sibling rows (gap-scan C4: a mid-flow crypto crash used to orphan the
 * intake task) so a misconfigured box fails clean, not cryptic.
 */
const encryptionReady = () => /^[0-9a-fA-F]{64}$/.test(config_1.Config.ENCRYPTION_KEY);
exports.encryptionReady = encryptionReady;
const keyOrThrow = () => {
    if (!(0, exports.encryptionReady)()) {
        throw new Error("ENCRYPTION_KEY is missing or malformed (need 64 hex chars) — at-rest encryption unavailable");
    }
    return Buffer.from(config_1.Config.ENCRYPTION_KEY, HEX);
};
/**
 * Encrypts a JSON-serializable value using AES-256-GCM.
 * Returns a JSON string with ciphertext, iv, and authTag.
 */
const encryptJSON = (data) => {
    const key = keyOrThrow();
    const iv = crypto_1.default.randomBytes(16);
    const cipher = crypto_1.default.createCipheriv(ALGORITHM, key, iv);
    const json = JSON.stringify(data);
    let encrypted = cipher.update(json, ENCODING, HEX);
    encrypted += cipher.final(HEX);
    const authTag = cipher.getAuthTag();
    return JSON.stringify({
        ciphertext: encrypted,
        iv: iv.toString(HEX),
        authTag: authTag.toString(HEX),
    });
};
exports.encryptJSON = encryptJSON;
/**
 * Decrypts a JSON value encrypted by encryptJSON.
 * Returns the original data or throws if authentication fails.
 */
const decryptJSON = (encrypted) => {
    const key = keyOrThrow();
    const { ciphertext, iv, authTag } = JSON.parse(encrypted);
    const decipher = crypto_1.default.createDecipheriv(ALGORITHM, key, Buffer.from(iv, HEX));
    decipher.setAuthTag(Buffer.from(authTag, HEX));
    let decrypted = decipher.update(ciphertext, HEX, ENCODING);
    decrypted += decipher.final(ENCODING);
    return JSON.parse(decrypted);
};
exports.decryptJSON = decryptJSON;
