"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.UsersRepo = void 0;
const drizzle_orm_1 = require("drizzle-orm");
const schema_1 = require("../db/schema");
/**
 * Escape LIKE wildcards so a user's `q` matches literally. MySQL's default
 * escape character is backslash; without this, a search for "50%" or "a_b"
 * would behave as a wildcard pattern.
 */
const escapeLike = (input) => input.replace(/[\\%_]/g, (ch) => `\\${ch}`);
class UsersRepo {
    db;
    constructor(db) {
        this.db = db;
    }
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
    async findByEmail(email) {
        const [row] = await this.db
            .select({
            id: schema_1.users.id,
            workspaceId: schema_1.users.workspaceId,
            firstName: schema_1.users.firstName,
            lastName: schema_1.users.lastName,
            email: schema_1.users.email,
            passwordHash: schema_1.users.passwordHash,
            role: schema_1.users.role,
            avatarUrl: schema_1.users.avatarUrl,
            status: schema_1.users.status,
            timezone: schema_1.users.timezone,
            lastLoginAt: schema_1.users.lastLoginAt,
            createdAt: schema_1.users.createdAt,
        })
            .from(schema_1.users)
            .where((0, drizzle_orm_1.eq)(schema_1.users.email, email))
            // Deterministic tie-break for the edge case of duplicate emails
            // across workspaces — oldest account wins, with `id` as a final
            // tie-break so the result is stable even when two rows share the
            // same second-precision created_at. The application layer is meant
            // to keep emails globally unique (Open Question #4); this ordering
            // just makes the V1 fallback predictable.
            .orderBy((0, drizzle_orm_1.asc)(schema_1.users.createdAt), (0, drizzle_orm_1.asc)(schema_1.users.id))
            .limit(1);
        return row ?? null;
    }
    /**
     * Lookup by primary key. Returns the same shape as `findByEmail` so the
     * auth flow can rebuild a fresh JWT payload (role, workspaceId, status)
     * during refresh-token rotation without trusting the claims in the
     * incoming cookie.
     */
    async findById(userId) {
        const [row] = await this.db
            .select({
            id: schema_1.users.id,
            workspaceId: schema_1.users.workspaceId,
            firstName: schema_1.users.firstName,
            lastName: schema_1.users.lastName,
            email: schema_1.users.email,
            passwordHash: schema_1.users.passwordHash,
            role: schema_1.users.role,
            avatarUrl: schema_1.users.avatarUrl,
            status: schema_1.users.status,
            timezone: schema_1.users.timezone,
            lastLoginAt: schema_1.users.lastLoginAt,
            createdAt: schema_1.users.createdAt,
        })
            .from(schema_1.users)
            .where((0, drizzle_orm_1.eq)(schema_1.users.id, userId))
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
    async findByIdInWorkspace(userId, workspaceId) {
        const [row] = await this.db
            .select({
            id: schema_1.users.id,
            firstName: schema_1.users.firstName,
            lastName: schema_1.users.lastName,
            email: schema_1.users.email,
            role: schema_1.users.role,
            avatarUrl: schema_1.users.avatarUrl,
            status: schema_1.users.status,
            timezone: schema_1.users.timezone,
            lastLoginAt: schema_1.users.lastLoginAt,
            createdAt: schema_1.users.createdAt,
        })
            .from(schema_1.users)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.users.id, userId), (0, drizzle_orm_1.eq)(schema_1.users.workspaceId, workspaceId)))
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
    async findByIdForUpdate(userId, workspaceId, exec) {
        const [row] = await exec
            .select({
            id: schema_1.users.id,
            firstName: schema_1.users.firstName,
            lastName: schema_1.users.lastName,
            email: schema_1.users.email,
            role: schema_1.users.role,
            avatarUrl: schema_1.users.avatarUrl,
            status: schema_1.users.status,
            timezone: schema_1.users.timezone,
            lastLoginAt: schema_1.users.lastLoginAt,
            createdAt: schema_1.users.createdAt,
        })
            .from(schema_1.users)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.users.id, userId), (0, drizzle_orm_1.eq)(schema_1.users.workspaceId, workspaceId)))
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
    async findByWorkspaceEmailForUpdate(workspaceId, email, exec) {
        const [row] = await exec
            .select({
            id: schema_1.users.id,
            role: schema_1.users.role,
            status: schema_1.users.status,
        })
            .from(schema_1.users)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.users.workspaceId, workspaceId), (0, drizzle_orm_1.eq)(schema_1.users.email, email)))
            .limit(1)
            .for("update");
        return row ?? null;
    }
    /**
     * Bump `last_login_at` to NOW(). Best-effort: callers fire-and-forget so
     * a transient DB hiccup does not prevent a successful login from
     * returning to the user.
     */
    async touchLastLogin(userId) {
        await this.db
            .update(schema_1.users)
            .set({ lastLoginAt: new Date() })
            .where((0, drizzle_orm_1.eq)(schema_1.users.id, userId));
    }
    /**
     * Replace a user's password hash, addressed by primary key. Takes an
     * optional `exec` so the password-reset flow can run it inside the same
     * transaction as the token-consume + session-revoke (all-or-nothing). The
     * caller hashes the plaintext (bcrypt) before calling — this repo only
     * persists the final hash, never the raw password.
     */
    async updatePassword(userId, passwordHash, exec = this.db) {
        await exec
            .update(schema_1.users)
            .set({ passwordHash })
            .where((0, drizzle_orm_1.eq)(schema_1.users.id, userId));
    }
    /**
     * Insert a user row. Takes an optional `exec` so the invite flow can run it
     * in the same transaction as the matching `invitations` + `workspace_activity`
     * rows (all-or-nothing). The caller builds the row explicitly — fields like
     * `status` / `password_hash` are never copied from client input — so this is
     * not a mass-assignment surface. A duplicate `(workspace_id, email)` raises
     * `ER_DUP_ENTRY`, which the service maps to 409.
     */
    async create(values, exec = this.db) {
        await exec.insert(schema_1.users).values(values);
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
    async update(userId, values, exec = this.db) {
        await exec
            .update(schema_1.users)
            .set({ ...values, updatedAt: new Date() })
            .where((0, drizzle_orm_1.eq)(schema_1.users.id, userId));
    }
    /**
     * Return the subset of `userIds` that are ACTIVE members of `workspaceId`.
     * Used to validate assignee / membership writes: callers compare the
     * returned set against the requested ids and reject the difference, so an
     * id from another workspace is indistinguishable from a non-existent one
     * (no cross-tenant existence oracle).
     */
    async findActiveIdsInWorkspace(userIds, workspaceId) {
        if (userIds.length === 0)
            return new Set();
        const rows = await this.db
            .select({ id: schema_1.users.id })
            .from(schema_1.users)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.users.workspaceId, workspaceId), (0, drizzle_orm_1.eq)(schema_1.users.status, "active"), (0, drizzle_orm_1.inArray)(schema_1.users.id, userIds)));
        return new Set(rows.map((r) => r.id));
    }
    /**
     * Batch-fetch the non-sensitive row for several users in one workspace, for
     * hydrating an `actor` / `user` object onto a feed without an N+1. Returns
     * only the ids that exist in `workspaceId` (a missing or cross-workspace id
     * is simply absent), in no particular order — callers index the result by
     * `id`. Same projection as `findByIdInWorkspace` (no `password_hash`).
     */
    async findManyByIdsInWorkspace(userIds, workspaceId) {
        if (userIds.length === 0)
            return [];
        return this.db
            .select({
            id: schema_1.users.id,
            firstName: schema_1.users.firstName,
            lastName: schema_1.users.lastName,
            email: schema_1.users.email,
            role: schema_1.users.role,
            avatarUrl: schema_1.users.avatarUrl,
            status: schema_1.users.status,
            timezone: schema_1.users.timezone,
            lastLoginAt: schema_1.users.lastLoginAt,
            createdAt: schema_1.users.createdAt,
        })
            .from(schema_1.users)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.users.workspaceId, workspaceId), (0, drizzle_orm_1.inArray)(schema_1.users.id, userIds)));
    }
    /**
     * Active owner/admin ids of a workspace — the `report_ready` fan-out set
     * (Dept Review V1 P20, D-1). The caller dedupes the head into this set.
     */
    async findActiveAdminIds(workspaceId) {
        const rows = await this.db
            .select({ id: schema_1.users.id })
            .from(schema_1.users)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.users.workspaceId, workspaceId), (0, drizzle_orm_1.eq)(schema_1.users.status, "active"), (0, drizzle_orm_1.inArray)(schema_1.users.role, ["owner", "admin"])));
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
    async listByWorkspace(params) {
        return this.db
            .select({
            id: schema_1.users.id,
            firstName: schema_1.users.firstName,
            lastName: schema_1.users.lastName,
            email: schema_1.users.email,
            role: schema_1.users.role,
            avatarUrl: schema_1.users.avatarUrl,
            status: schema_1.users.status,
            timezone: schema_1.users.timezone,
            lastLoginAt: schema_1.users.lastLoginAt,
            createdAt: schema_1.users.createdAt,
        })
            .from(schema_1.users)
            .where(this.filterWhere(params))
            .orderBy((0, drizzle_orm_1.asc)(schema_1.users.id))
            .limit(params.limit);
    }
    /** Exact count for the same filter set — feeds `pagination.total_estimate`. */
    async countByWorkspace(params) {
        const [row] = await this.db
            .select({ value: (0, drizzle_orm_1.count)() })
            .from(schema_1.users)
            .where(this.filterWhere(params));
        return row?.value ?? 0;
    }
    /**
     * Shared WHERE for the list + count queries. All clauses are ANDed;
     * `workspace_id` is always present (tenant isolation). Optional filters and
     * the keyset cursor are appended only when supplied — Drizzle's `and()`
     * ignores `undefined` entries.
     */
    filterWhere(params) {
        const pattern = params.q && params.q.length > 0
            ? `%${escapeLike(params.q)}%`
            : undefined;
        return (0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.users.workspaceId, params.workspaceId), params.status ? (0, drizzle_orm_1.eq)(schema_1.users.status, params.status) : undefined, params.role ? (0, drizzle_orm_1.eq)(schema_1.users.role, params.role) : undefined, pattern
            ? (0, drizzle_orm_1.or)((0, drizzle_orm_1.like)(schema_1.users.firstName, pattern), (0, drizzle_orm_1.like)(schema_1.users.lastName, pattern), (0, drizzle_orm_1.like)(schema_1.users.email, pattern))
            : undefined, params.afterId ? (0, drizzle_orm_1.gt)(schema_1.users.id, params.afterId) : undefined);
    }
}
exports.UsersRepo = UsersRepo;
