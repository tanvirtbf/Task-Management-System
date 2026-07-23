import crypto from "crypto";
import { Config } from "../config";

const ALGORITHM = "aes-256-gcm";
const ENCODING = "utf8";
const HEX = "hex";

/**
 * True when ENCRYPTION_KEY holds a usable 256-bit key (64 hex chars).
 * Callers that persist encrypted data must check this BEFORE creating any
 * sibling rows (gap-scan C4: a mid-flow crypto crash used to orphan the
 * intake task) so a misconfigured box fails clean, not cryptic.
 */
export const encryptionReady = (): boolean =>
    /^[0-9a-fA-F]{64}$/.test(Config.ENCRYPTION_KEY);

const keyOrThrow = (): Buffer => {
    if (!encryptionReady()) {
        throw new Error(
            "ENCRYPTION_KEY is missing or malformed (need 64 hex chars) — at-rest encryption unavailable",
        );
    }
    return Buffer.from(Config.ENCRYPTION_KEY, HEX);
};

/**
 * Encrypts a JSON-serializable value using AES-256-GCM.
 * Returns a JSON string with ciphertext, iv, and authTag.
 */
export const encryptJSON = (data: unknown): string => {
    const key = keyOrThrow();
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

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

/**
 * Decrypts a JSON value encrypted by encryptJSON.
 * Returns the original data or throws if authentication fails.
 */
export const decryptJSON = (encrypted: string): unknown => {
    const key = keyOrThrow();
    const { ciphertext, iv, authTag } = JSON.parse(encrypted) as {
        ciphertext: string;
        iv: string;
        authTag: string;
    };

    const decipher = crypto.createDecipheriv(
        ALGORITHM,
        key,
        Buffer.from(iv, HEX),
    );
    decipher.setAuthTag(Buffer.from(authTag, HEX));

    let decrypted = decipher.update(ciphertext, HEX, ENCODING);
    decrypted += decipher.final(ENCODING);

    return JSON.parse(decrypted) as unknown;
};
