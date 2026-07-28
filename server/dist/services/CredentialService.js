"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.CredentialService = void 0;
const bcrypt_1 = __importDefault(require("bcrypt"));
// Work factor for newly-hashed passwords. 10 matches the dummy-compare cost
// and the project's documented bcrypt rounds. The cost is embedded in the
// stored hash, so `comparePassword` keeps working if this is raised later.
const BCRYPT_ROUNDS = 10;
class CredentialService {
    /**
     * Lazily-computed dummy bcrypt hash used by `dummyCompare`. We bake the
     * promise so the first call pays the ~100 ms work-factor cost; every
     * subsequent call reuses the same hash. The hashed value (`__noop__`) is
     * never a real password.
     */
    dummyHashPromise = null;
    async comparePassword(userPassword, passwordHash) {
        return await bcrypt_1.default.compare(userPassword, passwordHash);
    }
    /**
     * Hash a plaintext password for storage. Used by the password-reset flow
     * (and future change-password / signup). Returns the full bcrypt hash
     * (algorithm + cost + salt + digest) for `users.password_hash`.
     */
    async hashPassword(plainPassword) {
        return await bcrypt_1.default.hash(plainPassword, BCRYPT_ROUNDS);
    }
    /**
     * Run a bcrypt compare against a precomputed dummy hash so the wall-clock
     * time of an "email not found" branch matches the "wrong password" branch.
     * Closes the timing-oracle email-enumeration channel on `/auth/login`.
     *
     * The result is intentionally discarded — the caller has already decided
     * to fail.
     */
    async dummyCompare(userPassword) {
        if (this.dummyHashPromise === null) {
            this.dummyHashPromise = bcrypt_1.default.hash("__noop__", 10);
        }
        const hash = await this.dummyHashPromise;
        await bcrypt_1.default.compare(userPassword, hash);
    }
}
exports.CredentialService = CredentialService;
