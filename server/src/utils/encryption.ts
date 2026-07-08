import crypto from "crypto";
import { Config } from "../config";

const ALGORITHM = "aes-256-gcm";
const ENCODING = "utf8";
const HEX = "hex";

/**
 * Encrypts a JSON-serializable object using AES-256-GCM.
 * Returns a JSON string with ciphertext, iv, and authTag.
 *
 * Requires ENCRYPTION_KEY env (256-bit hex string) at runtime.
 */
export const encryptJSON = (data: any): string => {
    const key = Buffer.from(Config.ENCRYPTION_KEY, HEX);
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
 * Decrypts a JSON object encrypted by encryptJSON.
 * Returns the original data or throws if authentication fails.
 *
 * Requires ENCRYPTION_KEY env (256-bit hex string) at runtime.
 */
export const decryptJSON = (encrypted: string): any => {
    const key = Buffer.from(Config.ENCRYPTION_KEY, HEX);
    const { ciphertext, iv, authTag } = JSON.parse(encrypted);

    const decipher = crypto.createDecipheriv(
        ALGORITHM,
        key,
        Buffer.from(iv, HEX),
    );
    decipher.setAuthTag(Buffer.from(authTag, HEX));

    let decrypted = decipher.update(ciphertext, HEX, ENCODING);
    decrypted += decipher.final(ENCODING);

    return JSON.parse(decrypted);
};
