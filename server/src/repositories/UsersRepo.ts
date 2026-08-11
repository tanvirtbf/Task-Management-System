import { and, asc, count, eq, gt, inArray, like, ne, or } from "drizzle-orm";
import { MySql2Database } from "drizzle-orm/mysql2";
import * as schema from "../db/schema";
import { users } from "../db/schema";
import type { Role } from "../constants";
import type { DbExecutor } from "./types";

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

/** Filters accepted by the workspace user-list query (`GET /api/v1/users`). */
export interface UserListFilters {
    status?: UserStatus;
    role?: Role;
    q?: string;
}

/**
 * Row shape returned by `listByWorkspace`. Mirrors the camelCase source fields
 * of the wire `User` and — unlike `UserRecord` — never includes `passwordHash`.
 */
export interface UserListRow {
    id: string;
    firstName: string;
    lastName: string;
    email: string;
    role: Role;
    avatarUrl: string | null;
    status: UserStatus;
    timezone: string;
    lastLoginAt: Date | null;
    createdAt: Date;
}

/**
 * Escape LIKE wildcards so a user's `q` matches literally. MySQL's default
 * escape character is backslash; without this, a search for "50%" or "a_b"
 * would behave as a wildcard pattern.
 */
const escapeLike = (input: string): string =>
    input.replace(/[\\%_]/g, (ch) => `\\${ch}`);

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
            // across workspaces — oldest account wins, with `id` as a final
            // tie-break so the result is stable even when two rows share the
            // same second-precision created_at. The application layer is meant
            // to keep emails globally unique (Open Question #4); this ordering
            // just makes the V1 fallback predictable.
            .orderBy(asc(users.createdAt), asc(users.id))
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
     * Workspace-scoped single-user lookup for `GET /api/v1/users/:id`.
     *
     * Returns the same non-sensitive projection as `listByWorkspace` (no
     * `password_hash` / `workspace_id` / `updated_at`), so a hash never leaves
     * the data layer for a read response. The `workspace_id` predicate is the
     * tenant-isolation control: an id that belongs to another workspace returns
     * `null` — indistinguishable from a non-existent id, so there is no
     * cross-tenant existence oracle. Unlike `findById` (used by the auth flow,
     * which trusts the token's own user and needs `passwordHash`), this method
     * is safe to back a member-facing read.
     */
    async findByIdInWorkspace(
        userId: string,
        workspaceId: string,
    ): Promise<UserListRow | null> {
        const [row] = await this.db
            .select({
                id: users.id,
                firstName: users.firstName,
                lastName: users.lastName,
                email: users.email,
                role: users.role,
                avatarUrl: users.avatarUrl,
                status: users.status,
                timezone: users.timezone,
                lastLoginAt: users.lastLoginAt,
                createdAt: users.createdAt,
            })
            .from(users)
            .where(
                and(eq(users.id, userId), eq(users.workspaceId, workspaceId)),
            )
            .limit(1);
        return row ?? null;
    }

    /**
     * Workspace-scoped single-user read that takes a `FOR UPDATE` row lock — same
     * projection as `findByIdInWorkspace`, but it MUST run inside a transaction
     * (pass the `tx` executor). It serializes concurrent mutations of the SAME
     * user so a guarded no-op (already at the target role/status) is re-checked
     * atomically: a second identical concurrent writer blocks here, then re-reads
     * the post-change row and short-circuits — one logical transition, one audit
     * row. Mirrors the `.for("update")` lock pattern used by
     * `TasksRepo`/`PasswordResetTokensRepo`.
     */
    async findByIdForUpdate(
        userId: string,
        workspaceId: string,
        exec: DbExecutor,
    ): Promise<UserListRow | null> {
        const [row] = await exec
            .select({
                id: users.id,
                firstName: users.firstName,
                lastName: users.lastName,
                email: users.email,
                role: users.role,
                avatarUrl: users.avatarUrl,
                status: users.status,
                timezone: users.timezone,
                lastLoginAt: users.lastLoginAt,
                createdAt: users.createdAt,
            })
            .from(users)
            .where(
                and(eq(users.id, userId), eq(users.workspaceId, workspaceId)),
            )
            .limit(1)
            .for("update");
        return row ?? null;
    }

    /**
     * Workspace+email lookup that takes a `FOR UPDATE` row lock — used by the
     * invitation-accept flow to atomically flip the invited user to `active`.
     * Must run inside a transaction (pass `exec`). `(workspace_id, email)` is
     * UNIQUE so this resolves at most one row; returns the minimal shape the
     * accept flow needs to validate status and mint the session.
     */
    async findByWorkspaceEmailForUpdate(
        workspaceId: string,
        email: string,
        exec: DbExecutor,
    ): Promise<{ id: string; role: Role; status: UserStatus } | null> {
        const [row] = await exec
            .select({
                id: users.id,
                role: users.role,
                status: users.status,
            })
            .from(users)
            .where(
                and(eq(users.workspaceId, workspaceId), eq(users.email, email)),
            )
            .limit(1)
            .for("update");
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

    /**
     * Replace a user's password hash, addressed by primary key. Takes an
     * optional `exec` so the password-reset flow can run it inside the same
     * transaction as the token-consume + session-revoke (all-or-nothing). The
     * caller hashes the plaintext (bcrypt) before calling — this repo only
     * persists the final hash, never the raw password.
     */
    async updatePassword(
        userId: string,
        passwordHash: string,
        exec: DbExecutor = this.db,
    ): Promise<void> {
        await exec
            .update(users)
            .set({ passwordHash })
            .where(eq(users.id, userId));
    }

    /**
     * Insert a user row. Takes an optional `exec` so the invite flow can run it
     * in the same transaction as the matching `invitations` + `workspace_activity`
     * rows (all-or-nothing). The caller builds the row explicitly — fields like
     * `status` / `password_hash` are never copied from client input — so this is
     * not a mass-assignment surface. A duplicate `(workspace_id, email)` raises
     * `ER_DUP_ENTRY`, which the service maps to 409.
     */
    async create(
        values: typeof users.$inferInsert,
        exec: DbExecutor = this.db,
    ): Promise<void> {
        await exec.insert(users).values(values);
    }

    /**
     * Patch a user row by primary key with an explicit, whitelisted field set —
     * never a spread of raw client input, so this is not a mass-assignment
     * surface (the caller maps only the fields its endpoint permits). `role` and
     * `status` are accepted here because §4 #5/#6/#7 set them, but each caller
     * passes only what its endpoint allows. `updated_at` is bumped explicitly
     * (mirroring `TasksRepo.touchUpdatedAt`) so the audit timestamp moves even on
     * a same-value write where `ON UPDATE CURRENT_TIMESTAMP` would not fire.
     * Takes an optional `exec` so the write enlists in the same transaction as
     * the `workspace_activity` audit row (all-or-nothing).
     */
    async update(
        userId: string,
        values: Partial<{
            firstName: string;
            lastName: string;
            email: string;
            timezone: string;
            avatarUrl: string | null;
            role: Role;
            status: UserStatus;
            /** Home team (team-access P1) — set only by the team endpoints. */
            primarySpaceId: string | null;
        }>,
        exec: DbExecutor = this.db,
    ): Promise<void> {
        await exec
            .update(users)
            .set({ ...values, updatedAt: new Date() })
            .where(eq(users.id, userId));
    }

    /**
     * Return the subset of `userIds` that are ACTIVE members of `workspaceId`.
     * Used to validate assignee / membership writes: callers compare the
     * returned set against the requested ids and reject the difference, so an
     * id from another workspace is indistinguishable from a non-existent one
     * (no cross-tenant existence oracle).
     */
    async findActiveIdsInWorkspace(
        userIds: string[],
        workspaceId: string,
    ): Promise<Set<string>> {
        if (userIds.length === 0) return new Set();
        const rows = await this.db
            .select({ id: users.id })
            .from(users)
            .where(
                and(
                    eq(users.workspaceId, workspaceId),
                    eq(users.status, "active"),
                    inArray(users.id, userIds),
                ),
            );
        return new Set(rows.map((r) => r.id));
    }

    /**
     * Batch-fetch the non-sensitive row for several users in one workspace, for
     * hydrating an `actor` / `user` object onto a feed without an N+1. Returns
     * only the ids that exist in `workspaceId` (a missing or cross-workspace id
     * is simply absent), in no particular order — callers index the result by
     * `id`. Same projection as `findByIdInWorkspace` (no `password_hash`).
     */
    async findManyByIdsInWorkspace(
        userIds: string[],
        workspaceId: string,
    ): Promise<UserListRow[]> {
        if (userIds.length === 0) return [];
        return this.db
            .select({
                id: users.id,
                firstName: users.firstName,
                lastName: users.lastName,
                email: users.email,
                role: users.role,
                avatarUrl: users.avatarUrl,
                status: users.status,
                timezone: users.timezone,
                lastLoginAt: users.lastLoginAt,
                createdAt: users.createdAt,
            })
            .from(users)
            .where(
                and(
                    eq(users.workspaceId, workspaceId),
                    inArray(users.id, userIds),
                ),
            );
    }

    /**
     * Every user of the workspace with their home team attached (team-access
     * P1) — the ONE query the Settings → Teams directory needs to compute
     * `is_primary` badges and the "no home team yet" section. Deliberately a
     * separate projection: the canonical wire `User` (and the ~dozen tests
     * that pin its exact key set) stays untouched.
     */
    async listWithPrimaryByWorkspace(
        workspaceId: string,
        exec: DbExecutor = this.db,
    ): Promise<(UserListRow & { primarySpaceId: string | null })[]> {
        return exec
            .select({
                id: users.id,
                firstName: users.firstName,
                lastName: users.lastName,
                email: users.email,
                role: users.role,
                avatarUrl: users.avatarUrl,
                status: users.status,
                timezone: users.timezone,
                lastLoginAt: users.lastLoginAt,
                createdAt: users.createdAt,
                primarySpaceId: users.primarySpaceId,
            })
            .from(users)
            .where(eq(users.workspaceId, workspaceId))
            .orderBy(asc(users.firstName), asc(users.lastName), asc(users.id));
    }

    /**
     * One user's home team. `undefined` = no such user in this workspace
     * (caller 404s), `null` = user exists with no home team.
     */
    async primarySpaceIdOf(
        userId: string,
        workspaceId: string,
        exec: DbExecutor = this.db,
    ): Promise<string | null | undefined> {
        const rows = await exec
            .select({ primarySpaceId: users.primarySpaceId })
            .from(users)
            .where(
                and(eq(users.id, userId), eq(users.workspaceId, workspaceId)),
            )
            .limit(1);
        if (rows.length === 0) return undefined;
        return rows[0].primarySpaceId ?? null;
    }

    /**
     * Active owner/admin ids of a workspace — the `report_ready` fan-out set
     * (Dept Review V1 P20, D-1). The caller dedupes the head into this set.
     */
    async findActiveAdminIds(workspaceId: string): Promise<string[]> {
        const rows = await this.db
            .select({ id: users.id })
            .from(users)
            .where(
                and(
                    eq(users.workspaceId, workspaceId),
                    eq(users.status, "active"),
                    inArray(users.role, ["owner", "admin"]),
                ),
            );
        return rows.map((r) => r.id);
    }

    /**
     * Workspace-scoped, filtered page of users for `GET /api/v1/users`.
     *
     * Keyset pagination on the primary key `id` ASC — `users` has no
     * `internal_id`, so `id` is the documented stable sort key (API_DESIGN.md
     * §1: "primary key … ASC unless documented otherwise"). Callers pass
     * `limit + 1` and use the extra row to derive `has_more`.
     *
     * The projection omits `password_hash` (and `workspace_id` / `updated_at`)
     * so a hash never leaves the data layer for a list response.
     */
    async listByWorkspace(
        params: UserListFilters & {
            workspaceId: string;
            afterId?: string;
            limit: number;
        },
    ): Promise<UserListRow[]> {
        return this.db
            .select({
                id: users.id,
                firstName: users.firstName,
                lastName: users.lastName,
                email: users.email,
                role: users.role,
                avatarUrl: users.avatarUrl,
                status: users.status,
                timezone: users.timezone,
                lastLoginAt: users.lastLoginAt,
                createdAt: users.createdAt,
            })
            .from(users)
            .where(this.filterWhere(params))
            .orderBy(asc(users.id))
            .limit(params.limit);
    }

    /** Exact count for the same filter set — feeds `pagination.total_estimate`. */
    /**
     * F22 (ISS-020): the ACTIVE admin-capable accounts (role owner|admin)
     * other than  — the last-admin guards refuse any transition
     * that would drive this to zero.
     */
    async countActiveAdminCapable(
        workspaceId: string,
        excludeId: string,
        exec: DbExecutor = this.db,
    ): Promise<number> {
        const [row] = await exec
            .select({ n: count() })
            .from(users)
            .where(
                and(
                    eq(users.workspaceId, workspaceId),
                    eq(users.status, "active"),
                    inArray(users.role, ["owner", "admin"]),
                    ne(users.id, excludeId),
                ),
            );
        return row?.n ?? 0;
    }

    async countByWorkspace(
        params: UserListFilters & { workspaceId: string },
    ): Promise<number> {
        const [row] = await this.db
            .select({ value: count() })
            .from(users)
            .where(this.filterWhere(params));
        return row?.value ?? 0;
    }

    /**
     * Shared WHERE for the list + count queries. All clauses are ANDed;
     * `workspace_id` is always present (tenant isolation). Optional filters and
     * the keyset cursor are appended only when supplied — Drizzle's `and()`
     * ignores `undefined` entries.
     */
    private filterWhere(
        params: UserListFilters & { workspaceId: string; afterId?: string },
    ) {
        const pattern =
            params.q && params.q.length > 0
                ? `%${escapeLike(params.q)}%`
                : undefined;
        return and(
            eq(users.workspaceId, params.workspaceId),
            params.status ? eq(users.status, params.status) : undefined,
            params.role ? eq(users.role, params.role) : undefined,
            pattern
                ? or(
                      like(users.firstName, pattern),
                      like(users.lastName, pattern),
                      like(users.email, pattern),
                  )
                : undefined,
            params.afterId ? gt(users.id, params.afterId) : undefined,
        );
    }
}
