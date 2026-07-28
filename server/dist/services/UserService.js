"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.UserService = void 0;
const bootstrap_1 = require("../rbac/bootstrap");
const config_1 = require("../config");
const errors_1 = require("../errors");
const utils_1 = require("../utils");
/**
 * §4 Users domain logic. The read paths (`list`, `getUser`) delegate straight
 * to the repository; `invite` owns the transaction that pairs the invited-user
 * row with its `invitations` token and `workspace_activity` audit row.
 */
const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 200;
/** mysql2 transient lock errors worth retrying a transaction on (gap-scan M7 —
 *  admin reset-password gets the same deadlock protection as forgot-password). */
const isRetryableTxError = (err) => {
    const e = err;
    return e?.errno === 1213 || e?.errno === 1205; // ER_LOCK_DEADLOCK / ER_LOCK_WAIT_TIMEOUT
};
const MAX_RESET_TX_ATTEMPTS = 3;
/** Invitations are valid for 7 days (spec is silent; reset tokens are ≤30 min). */
const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/**
 * Admin-initiated password resets reuse the §2 forgot-password contract: a
 * single-use token valid for 30 minutes. Mirror of `AuthService`'s
 * `RESET_TOKEN_TTL_MS` — keep the two in sync (the emailed link lands on the
 * same shared `POST /auth/reset-password` consume endpoint).
 */
const RESET_TOKEN_TTL_MS = 30 * 60 * 1000;
/**
 * `password_hash` is NOT NULL but an invited user has no password until they
 * accept (§2 #10 sets it). Login gates on `status === 'active'` BEFORE any
 * bcrypt compare, so this sentinel is never verified; an empty string keeps the
 * column satisfied without minting a throwaway bcrypt hash on every invite.
 */
const INVITED_PLACEHOLDER_HASH = "";
const isDuplicateKeyError = (err) => {
    const e = err;
    return e?.code === "ER_DUP_ENTRY" || e?.errno === 1062;
};
class UserService {
    db;
    users;
    invitations;
    activity;
    mail;
    tokens;
    resetTokens;
    spaces;
    logger;
    constructor(db, users, invitations, activity, mail, tokens, resetTokens, spaces, logger) {
        this.db = db;
        this.users = users;
        this.invitations = invitations;
        this.activity = activity;
        this.mail = mail;
        this.tokens = tokens;
        this.resetTokens = resetTokens;
        this.spaces = spaces;
        this.logger = logger;
    }
    /**
     * Read a single member of `workspaceId` by id (`GET /api/v1/users/:id`).
     *
     * Workspace-scoped at the query level: an id outside the caller's workspace
     * resolves to `null` and surfaces as 404 `user.not_found` — never a 403 and
     * never a cross-tenant read. Returns regardless of `status` (an `invited` or
     * `deactivated` member is still a readable profile); the optional status
     * filter belongs to the list endpoint, not the by-id read.
     */
    async getUser(input) {
        const user = await this.users.findByIdInWorkspace(input.userId, input.workspaceId);
        if (!user) {
            throw errors_1.AppError.notFound("user.not_found", `User ${input.userId} does not exist`);
        }
        return user;
    }
    /**
     * Invite a person to the caller's workspace (`POST /api/v1/users/invite`,
     * 👑 admin/owner — the role gate runs in the route's `canAccess`).
     *
     * Creates a pending `users` row (`status: 'invited'`, no password yet), an
     * `invitations` token row, and a `workspace_activity` audit row in ONE
     * transaction (all-or-nothing). The `invitations` table has no name columns,
     * so the names live on the user row from the start; the §2 accept flow later
     * sets the password and flips the same row to `active`.
     *
     * Email is treated as globally unique (the app-wide invariant `findByEmail`
     * relies on): a pre-check yields a friendly 409, and the per-workspace
     * `uq_users_workspace_email` index is the race-free backstop, also mapped to
     * 409. `workspace_id` and `invited_by` come from `req.auth`, never the body,
     * so this can never touch another tenant. The invite email carries the raw
     * token and is sent best-effort AFTER commit — a mail hiccup must not roll
     * back a persisted invitation (the admin can resend).
     */
    async invite(input) {
        // 1. Friendly duplicate check before any write (global, case-insensitive).
        const existing = await this.users.findByEmail(input.email);
        if (existing) {
            throw errors_1.AppError.conflict("user.email_already_exists", `A user with email ${input.email} already exists`);
        }
        // 2. Mint ids + the single-use invite token. Only `sha256(token)` is
        //    persisted; the raw token lives only in the emailed link.
        const userId = (0, utils_1.fakeId)("u");
        const invitationId = (0, utils_1.fakeId)("inv");
        const rawToken = (0, utils_1.randomToken)();
        const tokenHash = (0, utils_1.sha256)(rawToken);
        const expiresAt = new Date(Date.now() + INVITATION_TTL_MS);
        // 3. Atomic: invited user + invitation + activity. A duplicate email
        //    racing two invites trips `uq_users_workspace_email` → 409.
        try {
            await this.db.transaction(async (tx) => {
                await this.users.create({
                    id: userId,
                    workspaceId: input.workspaceId,
                    firstName: input.firstName,
                    lastName: input.lastName,
                    email: input.email,
                    passwordHash: INVITED_PLACEHOLDER_HASH,
                    role: input.role,
                    status: "invited",
                }, tx);
                // RBAC (L13): give the invited row its system-role assignment
                // now, so the account is correctly powered the moment the
                // invite is accepted — no separate accept-time step to forget.
                await (0, bootstrap_1.syncUserSystemRole)(tx, input.workspaceId, userId, input.role, { bump: false });
                await this.invitations.create({
                    id: invitationId,
                    workspaceId: input.workspaceId,
                    email: input.email,
                    role: input.role,
                    tokenHash,
                    invitedBy: input.actorId,
                    expiresAt,
                }, tx);
                await this.activity.record({
                    workspaceId: input.workspaceId,
                    actorId: input.actorId,
                    entityType: "user",
                    entityId: userId,
                    action: "invited",
                    context: {
                        email: input.email,
                        role: input.role,
                        invitation_id: invitationId,
                    },
                }, tx);
            });
        }
        catch (err) {
            if (isDuplicateKeyError(err)) {
                throw errors_1.AppError.conflict("user.email_already_exists", `A user with email ${input.email} already exists`);
            }
            throw err;
        }
        // 4. Re-read the committed row so the response carries the authoritative
        //    DB `created_at` (same shape the list / by-id reads return).
        const created = await this.users.findByIdInWorkspace(userId, input.workspaceId);
        if (!created) {
            // Just committed; absence would mean a concurrent hard-delete, which
            // V1 never does. Surface as an internal inconsistency, not a 404.
            throw errors_1.AppError.internal("Invited user could not be loaded after creation");
        }
        // 5. Best-effort invite email (after commit). A failure never undoes the
        //    invitation — log and return 201.
        const acceptUrl = `${config_1.Config.FRONTEND_URL ?? ""}/invitation/${rawToken}`;
        try {
            await this.mail.sendInvitation(input.email, acceptUrl);
        }
        catch (err) {
            this.logger.warn("users.invite.email_failed", {
                userId,
                email: input.email,
                error: err instanceof Error ? err.message : String(err),
            });
        }
        return created;
    }
    /**
     * Update a member's profile fields (`PATCH /api/v1/users/:id`).
     *
     * Authorization is the §4 "self OR admin/owner" rule: a member may edit only
     * their own profile, an owner/admin may edit anyone in the workspace. The
     * target is loaded workspace-scoped first, so a cross-tenant id resolves to a
     * 404 `user.not_found` — never a 403 leak. `role` and `status` are not part
     * of the patch (privilege/lifecycle live in #5/#6/#7), so this can never
     * escalate. An `email` change re-checks the app-wide uniqueness invariant
     * (a friendly 409 pre-check, with the per-workspace `uq_users_workspace_email`
     * index as the race-free backstop). The field write and the
     * `workspace_activity` audit row commit atomically.
     */
    async updateProfile(input) {
        const current = await this.users.findByIdInWorkspace(input.userId, input.workspaceId);
        if (!current) {
            throw errors_1.AppError.notFound("user.not_found", `User ${input.userId} does not exist`);
        }
        const isSelf = input.actorId === input.userId;
        const isAdmin = input.actorRole === "owner" || input.actorRole === "admin";
        if (!isSelf && !isAdmin) {
            throw errors_1.AppError.forbidden("user.forbidden_edit", "You can only edit your own profile");
        }
        // Email is treated as globally unique (the app-wide `findByEmail`
        // invariant). A friendly pre-check; the unique index is the race-free
        // backstop in the catch below. A same-email no-op resolves to the same
        // row (id === userId) and is allowed.
        if (input.patch.email !== undefined) {
            const existing = await this.users.findByEmail(input.patch.email);
            if (existing && existing.id !== input.userId) {
                throw errors_1.AppError.conflict("user.email_already_exists", `A user with email ${input.patch.email} already exists`);
            }
        }
        try {
            await this.db.transaction(async (tx) => {
                await this.users.update(input.userId, input.patch, tx);
                await this.activity.record({
                    workspaceId: input.workspaceId,
                    actorId: input.actorId,
                    entityType: "user",
                    entityId: input.userId,
                    action: "profile_updated",
                    context: { fields: Object.keys(input.patch) },
                }, tx);
            });
        }
        catch (err) {
            if (isDuplicateKeyError(err)) {
                throw errors_1.AppError.conflict("user.email_already_exists", `A user with email ${input.patch.email ?? ""} already exists`);
            }
            throw err;
        }
        // Re-read the committed row so the response carries the authoritative
        // shape (same projection the list / by-id reads return).
        const updated = await this.users.findByIdInWorkspace(input.userId, input.workspaceId);
        if (!updated) {
            throw errors_1.AppError.internal("Updated user could not be loaded");
        }
        return updated;
    }
    /**
     * Promote / demote a member between admin ↔ member ↔ guest
     * (`PATCH /api/v1/users/:id/role`, 👑 admin/owner — the coarse role gate
     * runs in the route's `canAccess`).
     *
     * The validator already rejected `owner`, so this can never create a second
     * workspace owner. Two row-level rules are enforced here (mirroring the
     * `TaskTypeService` in-service `AppError.forbidden` precedent):
     *   - the workspace owner's role is immutable via this endpoint — a 403
     *     `user.cannot_change_owner_role` (this also blocks an owner demoting
     *     themselves, per the spec, and an admin demoting the owner);
     *   - you cannot change your OWN role — a 403 `user.cannot_change_own_role`
     *     (the spec forbids owner self-demotion; we extend it to every caller to
     *     avoid accidental self-lockout).
     * A change to the role the user already holds is an idempotent 200 no-op
     * (no audit row). The role write and the `workspace_activity` row commit
     * atomically.
     */
    async changeRole(input) {
        return this.db.transaction(async (tx) => {
            // Row lock + workspace scope: a second identical concurrent call
            // blocks here, then re-reads the post-change row, so the no-op guard
            // below holds atomically — one transition, one audit row.
            const current = await this.users.findByIdForUpdate(input.userId, input.workspaceId, tx);
            if (!current) {
                throw errors_1.AppError.notFound("user.not_found", `User ${input.userId} does not exist`);
            }
            if (current.role === "owner") {
                throw errors_1.AppError.forbidden("user.cannot_change_owner_role", "The workspace owner's role cannot be changed here");
            }
            if (input.actorId === input.userId) {
                throw errors_1.AppError.forbidden("user.cannot_change_own_role", "You cannot change your own role");
            }
            // No-op: already the requested role → return as-is, write no audit row.
            if (current.role === input.newRole) {
                return current;
            }
            await this.users.update(input.userId, { role: input.newRole }, tx);
            // RBAC (landmine L13): `users.role` is only the mirror — the
            // authority lives in `user_roles`. Swapping the system-role
            // assignment inside the SAME transaction keeps the two from ever
            // drifting, and the version bump makes the new role effective on
            // the person's very next request instead of in ≤15 minutes.
            await (0, bootstrap_1.syncUserSystemRole)(tx, input.workspaceId, input.userId, input.newRole);
            await this.activity.record({
                workspaceId: input.workspaceId,
                actorId: input.actorId,
                entityType: "user",
                entityId: input.userId,
                action: "role_changed",
                context: { from: current.role, to: input.newRole },
            }, tx);
            // Only `role` changed; the rest of the locked row is authoritative.
            return { ...current, role: input.newRole };
        });
    }
    /**
     * Deactivate a member (`POST /api/v1/users/:id/deactivate`, 👑 admin/owner
     * — the coarse gate runs in the route's `canAccess`).
     *
     * Flips `status` to `deactivated` AND revokes every active refresh session in
     * ONE transaction, so a half-deactivated state (status flipped but sessions
     * still live, or vice-versa) can never be observed. Their tasks/comments are
     * untouched (no cascade). Two row-level rules (in-service `AppError.forbidden`,
     * per the `TaskTypeService` precedent): the workspace owner can never be
     * deactivated (would orphan the workspace), and you cannot deactivate
     * yourself (self-lockout guard). Re-deactivating an already-deactivated user
     * is an idempotent no-op (no audit row, no redundant revoke). The live access
     * token (≤15 min) is intentionally NOT killed — only refresh is revoked, so
     * the user is locked out within ≤15 min when refresh fails (API_DESIGN §2/§4).
     */
    async deactivate(input) {
        await this.db.transaction(async (tx) => {
            // Row lock so two concurrent deactivations of the same user collapse
            // to a single transition + audit row (the second blocks, re-reads
            // `deactivated`, and short-circuits).
            const current = await this.users.findByIdForUpdate(input.userId, input.workspaceId, tx);
            if (!current) {
                throw errors_1.AppError.notFound("user.not_found", `User ${input.userId} does not exist`);
            }
            if (current.role === "owner") {
                throw errors_1.AppError.forbidden("user.cannot_deactivate_owner", "The workspace owner cannot be deactivated");
            }
            if (input.actorId === input.userId) {
                throw errors_1.AppError.forbidden("user.cannot_self_deactivate", "You cannot deactivate your own account");
            }
            if (current.status === "deactivated") {
                return; // idempotent no-op (re-checked under the row lock)
            }
            await this.users.update(input.userId, { status: "deactivated" }, tx);
            await this.tokens.revokeAllForUser(input.userId, tx);
            // Dept Review V1 — a deactivated user must not remain a department
            // head. Users are soft-deactivated (never deleted), so the FK's
            // ON DELETE SET NULL can never fire; this app-side null is the only
            // mechanism. Reactivation deliberately does NOT restore headships.
            await this.spaces.clearHeadships(input.userId, input.workspaceId, tx);
            await this.activity.record({
                workspaceId: input.workspaceId,
                actorId: input.actorId,
                entityType: "user",
                entityId: input.userId,
                action: "deactivated",
                context: { from: current.status },
            }, tx);
        });
    }
    /**
     * Reactivate a member (`POST /api/v1/users/:id/reactivate`, 👑 admin/owner)
     * — the inverse of `deactivate`. Flips `status` back to `active`.
     *
     * Rules:
     *   - you cannot reactivate yourself (403 `user.cannot_self_reactivate`) —
     *     symmetric with the self-deactivate guard, and it closes the window in
     *     which a just-deactivated admin holding a still-valid ≤15-min access
     *     token could otherwise revive their own account;
     *   - an already-`active` user is an idempotent 204 no-op;
     *   - a still-`invited` user is NOT "deactivated" — reactivation does not
     *     apply (409 `user.not_deactivated`); a pending invite must be accepted
     *     via the §2 invite-accept flow (which sets the password), never forced
     *     to `active` here (that would mint a password-less active member).
     * Only the `deactivated → active` transition writes (status + audit row, one
     * transaction). Sessions are NOT restored — the user signs in afresh.
     */
    async reactivate(input) {
        await this.db.transaction(async (tx) => {
            // Row lock so two concurrent reactivations collapse to one
            // transition + audit row (the second blocks, re-reads `active`, and
            // short-circuits).
            const current = await this.users.findByIdForUpdate(input.userId, input.workspaceId, tx);
            if (!current) {
                throw errors_1.AppError.notFound("user.not_found", `User ${input.userId} does not exist`);
            }
            if (input.actorId === input.userId) {
                throw errors_1.AppError.forbidden("user.cannot_self_reactivate", "You cannot reactivate your own account");
            }
            if (current.status === "active") {
                return; // idempotent no-op (re-checked under the row lock)
            }
            if (current.status === "invited") {
                throw errors_1.AppError.conflict("user.not_deactivated", "Only a deactivated user can be reactivated; a pending invitation must be accepted, not reactivated");
            }
            await this.users.update(input.userId, { status: "active" }, tx);
            await this.activity.record({
                workspaceId: input.workspaceId,
                actorId: input.actorId,
                entityType: "user",
                entityId: input.userId,
                action: "reactivated",
                context: { from: current.status },
            }, tx);
        });
    }
    /**
     * Admin-initiated password reset (`POST /api/v1/users/:id/reset-password`,
     * 👑 admin/owner). Mirrors the §2 self-service forgot-password MINT half,
     * just triggered by an admin: it mints a fresh single-use reset token
     * (invalidating any prior unconsumed link) and emails the standard
     * `/reset-password/<token>` link; that link lands on the shared §2
     * `POST /auth/reset-password` consume endpoint, which is what actually sets
     * the new password + revokes sessions. Like forgot-password, only an ACTIVE
     * user can be reset — an `invited` user must accept their invitation (which
     * sets the first password) and a `deactivated` user must be reactivated
     * first; either is a 409 `user.not_active` (no enumeration concern here — the
     * admin already knows the user exists). The token write + audit row commit
     * atomically; the email is best-effort after commit (a mail hiccup never
     * undoes a persisted token — the admin can retry). The controller returns 202.
     */
    async resetPassword(input) {
        const target = await this.users.findByIdInWorkspace(input.userId, input.workspaceId);
        if (!target) {
            throw errors_1.AppError.notFound("user.not_found", `User ${input.userId} does not exist`);
        }
        if (target.status !== "active") {
            throw errors_1.AppError.conflict("user.not_active", "Only an active user can be sent a password reset");
        }
        const rawToken = (0, utils_1.randomToken)();
        const tokenHash = (0, utils_1.sha256)(rawToken);
        const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MS);
        // M7: mirror forgotPassword's deadlock guard — take the user-row lock
        // FIRST (lock-ordering), then bounded-retry the DELETE+INSERT pair that
        // can otherwise deadlock on the password_reset_tokens `user_id` gap
        // locks (1213) when an admin reset races a user's own forgot-password.
        let lastErr;
        for (let attempt = 0; attempt < MAX_RESET_TX_ATTEMPTS; attempt++) {
            try {
                await this.db.transaction(async (tx) => {
                    await this.users.findByIdForUpdate(input.userId, input.workspaceId, tx);
                    await this.resetTokens.deleteActiveForUser(input.userId, tx);
                    await this.resetTokens.create({
                        id: (0, utils_1.fakeId)("prt"),
                        userId: input.userId,
                        tokenHash,
                        expiresAt,
                    }, tx);
                    await this.activity.record({
                        workspaceId: input.workspaceId,
                        actorId: input.actorId,
                        entityType: "user",
                        entityId: input.userId,
                        action: "password_reset_requested",
                    }, tx);
                });
                lastErr = undefined;
                break;
            }
            catch (err) {
                if (isRetryableTxError(err)) {
                    lastErr = err;
                    continue;
                }
                throw err;
            }
        }
        if (lastErr) {
            throw lastErr instanceof Error
                ? lastErr
                : errors_1.AppError.internal("Password reset token persist failed");
        }
        const resetUrl = `${config_1.Config.FRONTEND_URL ?? ""}/reset-password/${rawToken}`;
        try {
            await this.mail.sendPasswordResetEmail(target.email, resetUrl);
        }
        catch (err) {
            this.logger.warn("users.reset_password.email_failed", {
                userId: input.userId,
                error: err instanceof Error ? err.message : String(err),
            });
        }
    }
    async listUsers(input) {
        const limit = clampLimit(input.limit);
        // A malformed cursor throws AppError 400 from `decodeCursor`.
        const afterId = input.cursor ? decodeCursor(input.cursor) : undefined;
        const filters = {
            workspaceId: input.workspaceId,
            status: input.status,
            role: input.role,
            q: input.q,
        };
        // Fetch one row beyond `limit` so `has_more` needs no extra round-trip;
        // the exact count runs concurrently.
        const [rows, total] = await Promise.all([
            this.users.listByWorkspace({
                ...filters,
                afterId,
                limit: limit + 1,
            }),
            this.users.countByWorkspace(filters),
        ]);
        const hasMore = rows.length > limit;
        const page = hasMore ? rows.slice(0, limit) : rows;
        const last = page[page.length - 1];
        const nextCursor = hasMore && last ? encodeCursor(last.id) : null;
        return { rows: page, nextCursor, hasMore, total };
    }
}
exports.UserService = UserService;
/** Apply the spec's users pagination window: default 100, max 200, min 1. */
const clampLimit = (raw) => {
    if (raw === undefined)
        return DEFAULT_LIMIT;
    if (raw < 1)
        return 1;
    if (raw > MAX_LIMIT)
        return MAX_LIMIT;
    return Math.floor(raw);
};
// Opaque cursor codec. Kept local to the service because `users` is the first
// (and, so far, only) cursor-paginated list and the codebase has no shared
// pagination helper; lift this into a shared util when a second one appears.
const encodeCursor = (value) => Buffer.from(value, "utf8").toString("base64url");
/**
 * Decode an opaque cursor to its keyset value. A malformed cursor is a bad
 * request *parameter* (400 `pagination.invalid_cursor`), not a 422 — the client
 * cannot "fix" an opaque token, only drop it and restart paging.
 */
const decodeCursor = (cursor) => {
    if (!/^[A-Za-z0-9_-]+$/.test(cursor)) {
        throw errors_1.AppError.badRequest("pagination.invalid_cursor", "The pagination cursor is malformed.");
    }
    const decoded = Buffer.from(cursor, "base64url").toString("utf8");
    if (decoded.length === 0) {
        throw errors_1.AppError.badRequest("pagination.invalid_cursor", "The pagination cursor is malformed.");
    }
    return decoded;
};
