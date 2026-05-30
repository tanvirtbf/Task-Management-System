import bcrypt from "bcrypt";

// Work factor for newly-hashed passwords. 10 matches the dummy-compare cost
// and the project's documented bcrypt rounds. The cost is embedded in the
// stored hash, so `comparePassword` keeps working if this is raised later.
const BCRYPT_ROUNDS = 10;

export class CredentialService {
    /**
     * Lazily-computed dummy bcrypt hash used by `dummyCompare`. We bake the
     * promise so the first call pays the ~100 ms work-factor cost; every
     * subsequent call reuses the same hash. The hashed value (`__noop__`) is
     * never a real password.
     */
    private dummyHashPromise: Promise<string> | null = null;

    async comparePassword(userPassword: string, passwordHash: string) {
        return await bcrypt.compare(userPassword, passwordHash);
    }

    /**
     * Hash a plaintext password for storage. Used by the password-reset flow
     * (and future change-password / signup). Returns the full bcrypt hash
     * (algorithm + cost + salt + digest) for `users.password_hash`.
     */
    async hashPassword(plainPassword: string): Promise<string> {
        return await bcrypt.hash(plainPassword, BCRYPT_ROUNDS);
    }

    /**
     * Run a bcrypt compare against a precomputed dummy hash so the wall-clock
     * time of an "email not found" branch matches the "wrong password" branch.
     * Closes the timing-oracle email-enumeration channel on `/auth/login`.
     *
     * The result is intentionally discarded — the caller has already decided
     * to fail.
     */
    async dummyCompare(userPassword: string): Promise<void> {
        if (this.dummyHashPromise === null) {
            this.dummyHashPromise = bcrypt.hash("__noop__", 10);
        }
        const hash = await this.dummyHashPromise;
        await bcrypt.compare(userPassword, hash);
    }
}
