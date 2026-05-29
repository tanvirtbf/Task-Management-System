import { asc, eq } from "drizzle-orm";
import { MySql2Database } from "drizzle-orm/mysql2";
import * as schema from "../db/schema";
import { users } from "../db/schema";
import type { Role } from "../constants";

/**
 * Data access for the `users` table. Owns the Drizzle queries; services compose
 * business logic over the rows this repo returns.
 *
 * Methods are intentionally tight: each returns the columns its caller needs,
 * never the full row (the schema includes `password_hash`, `updated_at`, etc.
 * that we never want to leak into a response shape).
 */

export type UserStatus = "active" | "invited" | "deactivated";

/**
 * Shape returned by `findByEmail` / `findById`. Includes everything an auth
 * flow needs (`passwordHash` to verify the credential, `workspaceId` to put in
 * the JWT) — but no `updated_at` and no fields that don't exist on the wire
 * `User` type defined in `API_DESIGN.md` Appendix A.
 */
export interface UserRecord {
    id: string;
    workspaceId: string;
    firstName: string;
    lastName: string;
    email: string;
    passwordHash: string;
    role: Role;
    avatarUrl: string | null;
    status: UserStatus;
    timezone: string;
    lastLoginAt: Date | null;
    createdAt: Date;
}

export class UsersRepo {
    constructor(private db: MySql2Database<typeof schema>) {}

    /**
     * Case-insensitive lookup. The `users.email` column carries the schema's
     * default `utf8mb4_unicode_ci` collation, so MySQL compares with the bound
     * literal case-insensitively and the `idx_users_email` index is used.
     *
     * Returns the first match. The schema's UNIQUE constraint is
     * `(workspace_id, email)` so duplicates across workspaces are technically
     * allowed; for V1 the application layer treats email as globally unique
     * (enforced by the invitation / user-create paths). Document this as a
     * known invariant when §4 Users is built.
     */
    async findByEmail(email: string): Promise<UserRecord | null> {
        const [row] = await this.db
            .select({
                id: users.id,
                workspaceId: users.workspaceId,
                firstName: users.firstName,
                lastName: users.lastName,
                email: users.email,
                passwordHash: users.passwordHash,
                role: users.role,
                avatarUrl: users.avatarUrl,
                status: users.status,
                timezone: users.timezone,
                lastLoginAt: users.lastLoginAt,
                createdAt: users.createdAt,
            })
            .from(users)
            .where(eq(users.email, email))
            // Deterministic tie-break for the edge case of duplicate emails
            // across workspaces — oldest account wins. The application layer
            // is meant to keep emails globally unique (Open Question #4); this
            // ordering just makes the V1 fallback predictable.
            .orderBy(asc(users.createdAt))
            .limit(1);
        return row ?? null;
    }

    /**
     * Lookup by primary key. Returns the same shape as `findByEmail` so the
     * auth flow can rebuild a fresh JWT payload (role, workspaceId, status)
     * during refresh-token rotation without trusting the claims in the
     * incoming cookie.
     */
    async findById(userId: string): Promise<UserRecord | null> {
        const [row] = await this.db
            .select({
                id: users.id,
                workspaceId: users.workspaceId,
                firstName: users.firstName,
                lastName: users.lastName,
                email: users.email,
                passwordHash: users.passwordHash,
                role: users.role,
                avatarUrl: users.avatarUrl,
                status: users.status,
                timezone: users.timezone,
                lastLoginAt: users.lastLoginAt,
                createdAt: users.createdAt,
            })
            .from(users)
            .where(eq(users.id, userId))
            .limit(1);
        return row ?? null;
    }

    /**
     * Bump `last_login_at` to NOW(). Best-effort: callers fire-and-forget so
     * a transient DB hiccup does not prevent a successful login from
     * returning to the user.
     */
    async touchLastLogin(userId: string): Promise<void> {
        await this.db
            .update(users)
            .set({ lastLoginAt: new Date() })
            .where(eq(users.id, userId));
    }
}
