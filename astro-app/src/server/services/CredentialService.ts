import { timingSafeEqual } from "node:crypto";

// PBKDF2-SHA256 parameters for newly-hashed passwords (WebCrypto — bcrypt has
// no Workers-compatible build). The iteration count is embedded in the stored
// string, so `comparePassword` keeps working if this is raised later.
const PBKDF2_ITERATIONS = 100_000;
const SALT_BYTES = 16;
const KEY_BYTES = 32;

/** base64url (unpadded) helpers — `Buffer` is available under nodejs_compat. */
const b64url = (bytes: Uint8Array): string =>
    Buffer.from(bytes).toString("base64url");
// Copies into a fresh `Uint8Array<ArrayBuffer>` — WebCrypto's `BufferSource`
// rejects Node's `Buffer<ArrayBufferLike>` typing.
const fromB64url = (text: string): Uint8Array<ArrayBuffer> =>
    new Uint8Array(Buffer.from(text, "base64url"));

/** Derive the PBKDF2-SHA256 key for `password` with the given salt/cost. */
const deriveKey = async (
    password: string,
    salt: Uint8Array<ArrayBuffer>,
    iterations: number,
): Promise<Buffer> => {
    const keyMaterial = await crypto.subtle.importKey(
        "raw",
        new TextEncoder().encode(password),
        "PBKDF2",
        false,
        ["deriveBits"],
    );
    const bits = await crypto.subtle.deriveBits(
        { name: "PBKDF2", hash: "SHA-256", salt, iterations },
        keyMaterial,
        KEY_BYTES * 8,
    );
    return Buffer.from(bits);
};

/**
 * Parse the stored format `pbkdf2$v1$<iterations>$<salt-b64url>$<hash-b64url>`.
 * Returns `null` for anything malformed (treated as a non-match, never a throw).
 */
const parseStoredHash = (
    stored: string,
): {
    iterations: number;
    salt: Uint8Array<ArrayBuffer>;
    hash: Uint8Array<ArrayBuffer>;
} | null => {
    const parts = stored.split("$");
    if (parts.length !== 5 || parts[0] !== "pbkdf2" || parts[1] !== "v1") {
        return null;
    }
    const iterations = Number(parts[2]);
    if (!Number.isInteger(iterations) || iterations <= 0) return null;
    const salt = fromB64url(parts[3]);
    const hash = fromB64url(parts[4]);
    if (salt.length === 0 || hash.length === 0) return null;
    return { iterations, salt, hash };
};

export class CredentialService {
    /**
     * Lazily-computed dummy hash used by `dummyCompare`. We bake the promise
     * so the first call pays the derivation cost; every subsequent call
     * reuses the same hash. The hashed value (`__noop__`) is never a real
     * password.
     */
    private dummyHashPromise: Promise<string> | null = null;

    async comparePassword(userPassword: string, passwordHash: string) {
        const parsed = parseStoredHash(passwordHash);
        if (parsed === null) return false;
        const candidate = await deriveKey(
            userPassword,
            parsed.salt,
            parsed.iterations,
        );
        if (candidate.length !== parsed.hash.length) return false;
        // Constant-time digest comparison — no early-exit timing channel.
        return timingSafeEqual(candidate, parsed.hash);
    }

    /**
     * Hash a plaintext password for storage. Used by the password-reset flow
     * (and future change-password / signup). Returns the full self-describing
     * string (algorithm + version + cost + salt + digest) for
     * `users.password_hash`.
     */
    async hashPassword(plainPassword: string): Promise<string> {
        const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
        const hash = await deriveKey(plainPassword, salt, PBKDF2_ITERATIONS);
        return `pbkdf2$v1$${PBKDF2_ITERATIONS}$${b64url(salt)}$${b64url(hash)}`;
    }

    /**
     * Run a compare against a precomputed dummy hash so the wall-clock time of
     * an "email not found" branch matches the "wrong password" branch. Closes
     * the timing-oracle email-enumeration channel on `/auth/login`.
     *
     * The result is intentionally discarded — the caller has already decided
     * to fail.
     */
    async dummyCompare(userPassword: string): Promise<void> {
        if (this.dummyHashPromise === null) {
            this.dummyHashPromise = this.hashPassword("__noop__");
        }
        const hash = await this.dummyHashPromise;
        await this.comparePassword(userPassword, hash);
    }
}
