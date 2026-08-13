"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.UserService = void 0;
const drizzle_orm_1 = require("drizzle-orm");
const bootstrap_1 = require("../rbac/bootstrap");
const pagination_1 = require("../utils/pagination");
const can_1 = require("../rbac/can");
const context_1 = require("../rbac/context");
const scopeGuard_1 = require("../rbac/scopeGuard");
const schema = __importStar(require("../db/schema"));
const config_1 = require("../config");
const errors_1 = require("../errors");
const utils_1 = require("../utils");
const TeamMembershipService_1 = require("./TeamMembershipService");
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
 * MySQL 1451: the row is still referenced by an `ON DELETE RESTRICT` foreign
 * key. The race-safe backstop behind `hardDelete`'s content probe (the
 * `isDuplicateKeyError` shape, one error code over).
 */
const isReferencedError = (err) => {
    const e = err;
    return e?.code === "ER_ROW_IS_REFERENCED_2" || e?.errno === 1451;
};
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
        // 1b. Team-access P1 (B3): the invited-into team must exist and be
        //     live. Body input → 422 (mirrors `space.head_invalid`), before
        //     any write.
        if (input.spaceId) {
            const space = await this.spaces.findByIdInWorkspace(input.spaceId, input.workspaceId);
            if (!space || space.archivedAt) {
                throw errors_1.AppError.unprocessable("team.space_invalid", "space_id must be an existing, non-archived space", [{ field: "space_id", issue: "unknown or archived space" }]);
            }
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
                    // Team-access P1: home team from day one (validated
                    // in 1b; the FK backstops it).
                    primarySpaceId: input.spaceId ?? null,
                }, tx);
                // RBAC (L13): give the invited row its system-role assignment
                // now, so the account is correctly powered the moment the
                // invite is accepted — no separate accept-time step to forget.
                await (0, bootstrap_1.syncUserSystemRole)(tx, input.workspaceId, userId, input.role, { bump: false });
                // Team-access P1: and the matching space membership. Same
                // `bump:false` rationale as above — a fresh account has no
                // cached actor, and the workspace-row lock inside racing
                // invite transactions would deadlock.
                if (input.spaceId) {
                    await (0, TeamMembershipService_1.teamMembership)().ensureSpaceMembership(userId, input.spaceId, input.workspaceId, { exec: tx, bump: false, grantedBy: input.actorId });
                }
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
                        space_id: input.spaceId ?? null,
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
            // The invite goes out AS THE INVITER (name on the From, their
            // mailbox on Reply-To) — it is a person-to-person message, and
            // dressing it as one is what keeps Gmail from filing it under
            // Promotions (see MailService.sendInvitation). A failed lookup
            // only costs the personalisation, never the invite.
            const inviter = await this.users
                .findByIdInWorkspace(input.actorId, input.workspaceId)
                .catch(() => null);
            await this.mail.sendInvitation(input.email, acceptUrl, {
                inviterName: inviter
                    ? `${inviter.firstName} ${inviter.lastName}`.trim()
                    : null,
                inviterEmail: inviter?.email ?? null,
                inviteeFirstName: input.firstName,
                refId: invitationId,
            });
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
        // F7 / D3.1 compose: editing your OWN profile is feature logic and
        // stays free; editing SOMEONE ELSE's now requires the legacy admin
        // floor AND the `member.edit_profile` grant — the roles-grid toggle
        // becomes real. Compose cannot widen access.
        // F10 (ISS-021): the floor reads the LIVE role, not the token claim.
        const actorRole = await (0, scopeGuard_1.liveLegacyRole)(input.actorRole);
        const isAdmin = (actorRole === "owner" || actorRole === "admin") &&
            (0, can_1.holds)(await (0, context_1.currentActor)(), "member.edit_profile");
        if (!isSelf && !isAdmin) {
            throw errors_1.AppError.forbidden("user.forbidden_edit", "You can only edit your own profile");
        }
        // F12 (ISS-030): changing the LOGIN IDENTITY is an admin action.
        //
        // A member could move their own account to any address with no
        // verification and no notice to anyone. Three consequences, all real:
        // the original holder is never told; the old corporate address is
        // freed, so a later invite to it silently creates a SECOND account
        // (this happened by accident during testing and had to be untangled by
        // hand); and combined with forgot-password it is a persistence
        // primitive — a minute at an unlocked laptop moves the account to an
        // attacker's mailbox and survives every later password reset.
        //
        // The issue's own Expected line offers two acceptable outcomes:
        // verify the new address, or make it admin-only. Admin-only is what
        // ships here — it needs no schema column and no mail round-trip, and
        // these are corporate addresses created by invite, so self-service
        // email change was never a needed capability. A same-value no-op is
        // still allowed so a plain profile PATCH that echoes the current email
        // does not start failing.
        if (input.patch.email !== undefined && !isAdmin) {
            const unchanged = input.patch.email.toLowerCase() === current.email.toLowerCase();
            if (!unchanged) {
                throw errors_1.AppError.forbidden("user.email_change_forbidden", "Only an admin can change a login email address", [{ field: "email", issue: "admin only" }]);
            }
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
            // F22 (ISS-020): demoting the LAST active admin-capable account is
            // a lockout, not a role change. Same backstop as deactivate();
            // unreachable while an active owner exists (the owner cannot be
            // demoted here), so it guards the imported/hand-edited workspace.
            // (newRole is member|guest by the validator, so any change away
            // from admin is a demotion; the owner cannot reach here.)
            if (current.role === "admin" && current.status === "active") {
                const others = await this.users.countActiveAdminCapable(input.workspaceId, input.userId, tx);
                if (others === 0) {
                    throw errors_1.AppError.conflict("role.last_admin", "This is the workspace's last active admin — demoting them would leave nobody able to administer it");
                }
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
            // F22 (ISS-020): the last-admin backstop, mirroring the rule the
            // dynamic-RBAC path already enforces (`RolesAdminService`). The
            // owner guards above make this unreachable while an active owner
            // exists — it protects the workspace whose owner is somehow
            // inactive (imports, direct SQL): the final admin-capable account
            // cannot be deactivated into a lockout. (The owner guard above
            // already threw, so only "admin" can reach here.)
            if (current.role === "admin") {
                const others = await this.users.countActiveAdminCapable(input.workspaceId, input.userId, tx);
                if (others === 0) {
                    throw errors_1.AppError.conflict("role.last_admin", "This is the workspace's last active admin — deactivating them would leave nobody able to administer it");
                }
            }
            await this.users.update(input.userId, { status: "deactivated" }, tx);
            await this.tokens.revokeAllForUser(input.userId, tx);
            // F22 (ISS-019): headship SURVIVES a deactivation now. The old
            // clearHeadships call silently orphaned the department — P4 proved
            // it: Marketing lost its head, the weekly HR report generated with
            // no head, /dept access was gone, nobody was told, and
            // reactivation did NOT give it back. A deactivated head cannot log
            // in anyway (every session is revoked above), so keeping the
            // pointer costs nothing and a returning head finds their
            // department intact. Replacing them remains a one-PATCH admin act.
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
     * What would block a PERMANENT delete of this member
     * (`GET /api/v1/users/:id/deletion-preflight`, 👑 admin/owner).
     *
     * Read-only. The UI calls it before offering the irreversible action, so a
     * person is told "3 tasks, 5 comments — deactivate instead" in a dialog
     * rather than by a 409 after they typed a confirmation.
     */
    async deletionPreflight(input) {
        const target = await this.users.findByIdInWorkspace(input.userId, input.workspaceId);
        if (!target) {
            throw errors_1.AppError.notFound("user.not_found", `User ${input.userId} does not exist`);
        }
        const blockers = await this.users.countOwnedContent(input.userId);
        const reason = target.role === "owner"
            ? "The workspace owner can never be deleted."
            : input.actorId === input.userId
                ? "You cannot delete your own account."
                : Object.keys(blockers).length > 0
                    ? "This person has already created work in the workspace. Deleting them would destroy it, so deactivate them instead."
                    : null;
        return { user: target, blockers, deletable: reason === null, reason };
    }
    /**
     * PERMANENTLY delete a member (`DELETE /api/v1/users/:id`, 👑 admin/owner).
     *
     * The office's case: someone added by mistake. Deactivation keeps the row
     * forever, which is right for a person who did work and wrong for a typo.
     *
     * The rule that keeps this safe on a lived-in workspace: **a member is
     * deletable only while they have left NOTHING behind.** Thirteen relations
     * are `ON DELETE RESTRICT` (tasks, comments, attachments, lists, spaces,
     * custom fields, forms, templates, dependencies, reviews, on-call shifts,
     * invitations they sent) — if any of them still points here the delete is
     * refused with a per-kind breakdown (409 `user.has_content`) and the admin
     * is pointed at deactivate. Everything else the schema already handles:
     * their sessions, notifications, prefs, push devices, watches, assignee
     * rows, assignment requests and chat are CASCADE (personal state, goes
     * with them); attribution columns are SET NULL.
     *
     * Guards, in the order a caller meets them: 404 outside the workspace ·
     * 403 the workspace owner · 403 yourself · 409 the last admin-capable
     * account (the `deactivate` backstop, so a delete cannot lock the
     * workspace out either) · 409 content. The audit row is written BEFORE the
     * delete — `workspace_activity.entity_id` carries no FK, so the trace
     * survives the person (their email + name ride in the context, since the
     * row they name is about to vanish).
     *
     * The FK itself is the race backstop: if a task is created against this
     * user between the probe and the DELETE, MySQL rejects it with
     * `ER_ROW_IS_REFERENCED_2` and that becomes the same 409, never a 500.
     */
    async hardDelete(input) {
        const legacy = await (0, scopeGuard_1.liveLegacyRole)(input.actorRole);
        if (legacy !== "owner" && legacy !== "admin") {
            // Deleting a person outranks every other member action, so it stays
            // owner/admin even if a custom role carries `member.deactivate`.
            throw errors_1.AppError.forbidden("auth.forbidden", "Only an owner or admin can permanently delete a member");
        }
        if (input.actorId === input.userId) {
            throw errors_1.AppError.forbidden("user.cannot_self_delete", "You cannot delete your own account");
        }
        const blockers = await this.users.countOwnedContent(input.userId);
        try {
            await this.db.transaction(async (tx) => {
                // Row lock: a concurrent delete/deactivate of the same person
                // serialises here, and the second call re-reads and 404s.
                const current = await this.users.findByIdForUpdate(input.userId, input.workspaceId, tx);
                if (!current) {
                    throw errors_1.AppError.notFound("user.not_found", `User ${input.userId} does not exist`);
                }
                if (current.role === "owner") {
                    throw errors_1.AppError.forbidden("user.cannot_delete_owner", "The workspace owner cannot be deleted");
                }
                if (current.role === "admin") {
                    const others = await this.users.countActiveAdminCapable(input.workspaceId, input.userId, tx);
                    if (others === 0) {
                        throw errors_1.AppError.conflict("role.last_admin", "This is the workspace's last active admin — deleting them would leave nobody able to administer it");
                    }
                }
                if (Object.keys(blockers).length > 0) {
                    // The breakdown rides the MESSAGE (409 carries no details
                    // in this taxonomy) so the admin sees exactly what holds
                    // the row — the preflight endpoint serves it structured.
                    const summary = Object.entries(blockers)
                        .map(([kind, n]) => `${n} ${kind.replace(/_/g, " ")}`)
                        .join(", ");
                    throw errors_1.AppError.conflict("user.has_content", `This person has already created work in this workspace (${summary}), so they cannot be deleted — deactivate them instead`);
                }
                // The trace, written while the row still exists to describe.
                await this.activity.record({
                    workspaceId: input.workspaceId,
                    actorId: input.actorId,
                    entityType: "user",
                    entityId: input.userId,
                    action: "deleted",
                    context: {
                        email: current.email,
                        name: `${current.firstName} ${current.lastName}`.trim(),
                        role: current.role,
                        status: current.status,
                    },
                }, tx);
                // A pending invite for that address must not outlive them —
                // the link would resolve to a user that no longer exists.
                await this.users.deleteInvitationsForEmail(current.email, input.workspaceId, tx);
                await this.users.hardDelete(input.userId, input.workspaceId, tx);
                // Their `user_roles` rows went with them (CASCADE); bump the
                // workspace stamp so no cached actor outlives the row.
                await tx
                    .update(schema.workspaces)
                    .set({
                    permissionsVersion: (0, drizzle_orm_1.sql) `${schema.workspaces.permissionsVersion} + 1`,
                })
                    .where((0, drizzle_orm_1.eq)(schema.workspaces.id, input.workspaceId));
            });
        }
        catch (err) {
            if (isReferencedError(err)) {
                // A RESTRICT relation appeared between the probe and the
                // delete (someone created work as them mid-flight).
                throw errors_1.AppError.conflict("user.has_content", "This person created work in this workspace while the deletion was being processed — deactivate them instead");
            }
            throw err;
        }
        this.logger.info("users.hard_delete.ok", {
            workspaceId: input.workspaceId,
            actorId: input.actorId,
            userId: input.userId,
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
// F23 (ISS-008): the lenient decode accepted cursors the server never
// issued — `garbage` is base64url-alphabet, decoded to mojibake, and silently
// restarted pagination at page 1 WITH a fresh next_cursor (a retrying client
// looped forever); a tampered `<cursor>XX` shifted the window. The shared
// strict decoder round-trips the bytes and refuses everything else.
const decodeCursor = (cursor) => {
    const decoded = (0, pagination_1.strictDecodeCursor)(cursor);
    // An issued users cursor wraps a user id — id-alphabet only. Printable
    // junk that happens to round-trip ("not json or id") is still foreign.
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(decoded)) {
        throw errors_1.AppError.badRequest("pagination.invalid_cursor", "The pagination cursor is malformed.");
    }
    return decoded;
};
