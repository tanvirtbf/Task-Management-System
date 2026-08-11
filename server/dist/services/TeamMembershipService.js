"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.resetTeamMembership = exports.teamMembership = exports.TeamMembershipService = void 0;
const client_1 = require("../db/client");
const logger_1 = __importDefault(require("../config/logger"));
const errors_1 = require("../errors");
const can_1 = require("../rbac/can");
const context_1 = require("../rbac/context");
const policy_1 = require("../rbac/policy");
const scopeGuard_1 = require("../rbac/scopeGuard");
const RolesRepo_1 = require("../repositories/RolesRepo");
const SpaceVisibilityGrantsRepo_1 = require("../repositories/SpaceVisibilityGrantsRepo");
const UserRolesRepo_1 = require("../repositories/UserRolesRepo");
const UsersRepo_1 = require("../repositories/UsersRepo");
const SpacesRepo_1 = require("../repositories/SpacesRepo");
const WorkspaceActivityRepo_1 = require("../repositories/WorkspaceActivityRepo");
class TeamMembershipService {
    db;
    roles;
    assignments;
    users;
    spaces;
    activity;
    grants;
    policy;
    logger;
    constructor(db, roles, assignments, users, spaces, activity, 
    /** Team-access P4: team → team sight rows. */
    grants, policy, logger) {
        this.db = db;
        this.roles = roles;
        this.assignments = assignments;
        this.users = users;
        this.spaces = spaces;
        this.activity = activity;
        this.grants = grants;
        this.policy = policy;
        this.logger = logger;
    }
    // ─── reads ───────────────────────────────────────────────────────────────
    /** The org chart: every (non-archived) team, its head, its people. */
    async directory(workspaceId) {
        const [spaceRows, assignmentRows, usersWithPrimary, grantRows] = await Promise.all([
            this.spaces.listByWorkspace(workspaceId, {
                includeArchived: false,
            }),
            this.assignments.listSpaceAssignments(workspaceId),
            this.users.listWithPrimaryByWorkspace(workspaceId),
            this.grants.listByWorkspace(workspaceId),
        ]);
        const usersById = new Map(usersWithPrimary.map((u) => [u.id, u]));
        const spaceById = new Map(spaceRows.map((s) => [s.id, s]));
        const bySpace = new Map();
        for (const a of assignmentRows) {
            if (!a.scopeId)
                continue;
            const list = bySpace.get(a.scopeId);
            if (list)
                list.push(a);
            else
                bySpace.set(a.scopeId, [a]);
        }
        const teams = spaceRows.map((space) => {
            const seen = new Set();
            const members = [];
            for (const a of bySpace.get(space.id) ?? []) {
                // One entry per person; rows arrive rank-ordered, so the
                // strongest role wins the display slot.
                if (seen.has(a.userId))
                    continue;
                const user = usersById.get(a.userId);
                // Deactivation revokes all grants (P24) — the guard is
                // belt-and-braces against rows written before that rule.
                if (!user || user.status === "deactivated")
                    continue;
                seen.add(a.userId);
                members.push({
                    assignmentId: a.id,
                    user,
                    roleKey: a.roleKey,
                    roleName: a.roleName,
                    isHead: space.headUserId === a.userId,
                    isPrimary: user.primarySpaceId === space.id,
                });
            }
            const head = space.headUserId
                ? (usersById.get(space.headUserId) ?? null)
                : null;
            // P4: sight grants, hydrated to live space names. A grant whose
            // target has since been archived is real but moot (its lists are
            // archived too) — filtered from display, kept in the table.
            const canAlsoSee = grantRows
                .filter((g) => g.viewerSpaceId === space.id)
                .flatMap((g) => {
                const target = spaceById.get(g.targetSpaceId);
                return target
                    ? [{ id: target.id, name: target.name }]
                    : [];
            });
            return { space, head, members, canAlsoSee };
        });
        const unassigned = usersWithPrimary.filter((u) => u.primarySpaceId === null && u.status !== "deactivated");
        return { teams, unassigned };
    }
    // ─── membership core (shared with SpacesService + UserService.invite) ────
    /**
     * Make sure the person holds SOME role scoped to the space; grant the
     * seeded Member role if not. Idempotent. Returns true when a row was
     * actually added (callers bump/log only then).
     *
     * `bump:false` is for callers already inside a transaction that cannot
     * take the workspace-row lock (invite) — they own the post-commit bump,
     * or can skip it when no cached actor can exist yet.
     */
    async ensureSpaceMembership(userId, spaceId, workspaceId, opts = {}) {
        const exec = opts.exec ?? this.db;
        const already = await this.assignments.hasSpaceMembership(userId, spaceId, workspaceId, exec);
        if (already)
            return false;
        const memberRole = await this.roles.findByKeyInWorkspace("member", workspaceId, exec);
        if (!memberRole) {
            // Bootstrap seeds it on every boot; absence = half-provisioned DB.
            throw errors_1.AppError.internal("The seeded Member role is missing — RBAC bootstrap has not run");
        }
        await this.assignments.assign({
            workspaceId,
            userId,
            roleId: memberRole.id,
            scopeType: "space",
            scopeId: spaceId,
            grantedBy: opts.grantedBy ?? null,
        }, exec);
        if (opts.bump !== false) {
            await this.roles.bumpPermissionsVersion(workspaceId, exec);
            this.policy.clearCache();
        }
        return true;
    }
    /**
     * The G2 fix, callable from inside `SpacesService`'s create/update
     * transaction: the (new) head becomes a member of their own space, and if
     * they have no home team yet this space becomes it. Runs with `bump:false`
     * — the caller invokes `commitMembershipBump` AFTER its commit when this
     * returned true (a bump inside the space tx would hold the workspace-row
     * lock for the whole transaction).
     */
    async syncHeadMembership(headUserId, spaceId, workspaceId, opts = {}) {
        const exec = opts.exec ?? this.db;
        const added = await this.ensureSpaceMembership(headUserId, spaceId, workspaceId, { exec, bump: false, grantedBy: opts.grantedBy ?? null });
        const primary = await this.users.primarySpaceIdOf(headUserId, workspaceId, exec);
        if (primary === null) {
            await this.users.update(headUserId, { primarySpaceId: spaceId }, exec);
        }
        return added;
    }
    /** Post-commit half of `syncHeadMembership` — cache stamp + policy cache. */
    async commitMembershipBump(workspaceId) {
        await this.roles.bumpPermissionsVersion(workspaceId);
        this.policy.clearCache();
    }
    // ─── roster writes ───────────────────────────────────────────────────────
    /** Put a person on a team. Idempotent — re-adding is a silent no-op. */
    async addMember(input) {
        const space = await this.requireSpace(input.spaceId, input.workspaceId);
        await this.assertTeamManager(space, input.actorId, input.actorRole);
        if (space.archivedAt) {
            throw errors_1.AppError.conflict("space.archived", "This team is archived — unarchive it before changing members");
        }
        const user = await this.users.findByIdInWorkspace(input.userId, input.workspaceId);
        if (!user) {
            throw errors_1.AppError.notFound("user.not_found", "User not found");
        }
        if (user.status === "deactivated") {
            throw errors_1.AppError.unprocessable("team.member_invalid", "A deactivated user cannot be added to a team", [{ field: "user_id", issue: "user is deactivated" }]);
        }
        let added = false;
        await this.db.transaction(async (tx) => {
            added = await this.ensureSpaceMembership(input.userId, input.spaceId, input.workspaceId, { exec: tx, bump: false, grantedBy: input.actorId });
            if (!added)
                return; // already on the team — idempotent, no audit row
            // First team automatically becomes the home team.
            const primary = await this.users.primarySpaceIdOf(input.userId, input.workspaceId, tx);
            if (primary === null) {
                await this.users.update(input.userId, { primarySpaceId: input.spaceId }, tx);
            }
            await this.activity.record({
                workspaceId: input.workspaceId,
                actorId: input.actorId,
                entityType: "space",
                entityId: input.spaceId,
                action: "member_added",
                context: { user_id: input.userId },
            }, tx);
            await this.roles.bumpPermissionsVersion(input.workspaceId, tx);
        });
        if (added) {
            this.policy.clearCache();
            this.logger.info("teams.member_added", {
                workspaceId: input.workspaceId,
                spaceId: input.spaceId,
                userId: input.userId,
                actorId: input.actorId,
            });
        }
    }
    /**
     * Take a person off a team: every role they hold scoped to that space.
     * The current head cannot be removed (409) — assign a new head first, or
     * the "every head is a member of their own space" invariant breaks.
     */
    async removeMember(input) {
        const space = await this.requireSpace(input.spaceId, input.workspaceId);
        await this.assertTeamManager(space, input.actorId, input.actorRole);
        if (space.archivedAt) {
            throw errors_1.AppError.conflict("space.archived", "This team is archived — unarchive it before changing members");
        }
        if (space.headUserId === input.userId) {
            throw errors_1.AppError.conflict("team.head_locked", "This person heads the team — assign a new head before removing them");
        }
        const user = await this.users.findByIdInWorkspace(input.userId, input.workspaceId);
        if (!user) {
            throw errors_1.AppError.notFound("user.not_found", "User not found");
        }
        let removed = false;
        await this.db.transaction(async (tx) => {
            const isMember = await this.assignments.hasSpaceMembership(input.userId, input.spaceId, input.workspaceId, tx);
            if (!isMember)
                return; // not on the team — idempotent no-op
            removed = true;
            await this.assignments.revokeSpaceMemberships(input.userId, input.spaceId, input.workspaceId, tx);
            // A home team you are no longer on is a lie — clear it.
            const primary = await this.users.primarySpaceIdOf(input.userId, input.workspaceId, tx);
            if (primary === input.spaceId) {
                await this.users.update(input.userId, { primarySpaceId: null }, tx);
            }
            await this.activity.record({
                workspaceId: input.workspaceId,
                actorId: input.actorId,
                entityType: "space",
                entityId: input.spaceId,
                action: "member_removed",
                context: { user_id: input.userId },
            }, tx);
            await this.roles.bumpPermissionsVersion(input.workspaceId, tx);
        });
        if (removed) {
            this.policy.clearCache();
            this.logger.info("teams.member_removed", {
                workspaceId: input.workspaceId,
                spaceId: input.spaceId,
                userId: input.userId,
                actorId: input.actorId,
            });
        }
    }
    /**
     * Set (or clear) a person's home team. Setting a team also ensures
     * membership — your home team is always one of your teams. Clearing only
     * clears the pointer; membership stays. 🔐 the route gates on
     * `member.role_change` (org-structure management, admin+).
     */
    async setHomeTeam(input) {
        const user = await this.users.findByIdInWorkspace(input.userId, input.workspaceId);
        if (!user) {
            throw errors_1.AppError.notFound("user.not_found", "User not found");
        }
        if (user.status === "deactivated") {
            throw errors_1.AppError.unprocessable("team.member_invalid", "A deactivated user cannot be assigned to a team", [{ field: "user_id", issue: "user is deactivated" }]);
        }
        if (input.spaceId === null) {
            await this.db.transaction(async (tx) => {
                await this.users.update(input.userId, { primarySpaceId: null }, tx);
                await this.activity.record({
                    workspaceId: input.workspaceId,
                    actorId: input.actorId,
                    entityType: "user",
                    entityId: input.userId,
                    action: "team_changed",
                    context: { space_id: null },
                }, tx);
            });
            return;
        }
        const space = await this.spaces.findByIdInWorkspace(input.spaceId, input.workspaceId);
        // Body input → 422 (like space.head_invalid), never a 404 oracle.
        if (!space || space.archivedAt) {
            throw errors_1.AppError.unprocessable("team.space_invalid", "space_id must be an existing, non-archived space", [{ field: "space_id", issue: "unknown or archived space" }]);
        }
        let added = false;
        await this.db.transaction(async (tx) => {
            added = await this.ensureSpaceMembership(input.userId, input.spaceId, input.workspaceId, { exec: tx, bump: false, grantedBy: input.actorId });
            await this.users.update(input.userId, { primarySpaceId: input.spaceId }, tx);
            await this.activity.record({
                workspaceId: input.workspaceId,
                actorId: input.actorId,
                entityType: "user",
                entityId: input.userId,
                action: "team_changed",
                context: {
                    space_id: input.spaceId,
                    membership_added: added,
                },
            }, tx);
            if (added) {
                await this.roles.bumpPermissionsVersion(input.workspaceId, tx);
            }
        });
        if (added)
            this.policy.clearCache();
    }
    // ─── team → team sight (P4) ──────────────────────────────────────────────
    /**
     * Grant team `viewerSpaceId` sight of team `targetSpaceId`. 🔐 the route
     * gates on `space.members_manage` (admin/owner) — deliberately NO head
     * branch here, unlike the roster methods: a head must not be able to
     * self-expand what their own team can see. Idempotent. Dormant while
     * `space.view` is `all` everywhere; once teams are scoped (plan P6), the
     * fold picks the row up on the very next request via the version bump.
     */
    async grantVisibility(input) {
        const viewer = await this.requireSpace(input.viewerSpaceId, input.workspaceId);
        if (viewer.archivedAt) {
            throw errors_1.AppError.conflict("space.archived", "This team is archived — unarchive it before changing what it sees");
        }
        if (input.viewerSpaceId === input.targetSpaceId) {
            throw errors_1.AppError.unprocessable("team.grant_invalid", "A team always sees itself — pick a different team", [{ field: "target_space_id", issue: "same as the viewer" }]);
        }
        // Body input → 422 (mirrors team.space_invalid), never a 404 oracle.
        const target = await this.spaces.findByIdInWorkspace(input.targetSpaceId, input.workspaceId);
        if (!target || target.archivedAt) {
            throw errors_1.AppError.unprocessable("team.space_invalid", "target_space_id must be an existing, non-archived space", [
                {
                    field: "target_space_id",
                    issue: "unknown or archived space",
                },
            ]);
        }
        let added = false;
        await this.db.transaction(async (tx) => {
            added = await this.grants.grant({
                workspaceId: input.workspaceId,
                viewerSpaceId: input.viewerSpaceId,
                targetSpaceId: input.targetSpaceId,
                grantedBy: input.actorId,
            }, tx);
            if (!added)
                return; // already granted — idempotent, no audit row
            await this.activity.record({
                workspaceId: input.workspaceId,
                actorId: input.actorId,
                entityType: "space",
                entityId: input.viewerSpaceId,
                action: "visibility_granted",
                context: { target_space_id: input.targetSpaceId },
            }, tx);
            // The fold caches grants with the permission set — invalidate.
            await this.roles.bumpPermissionsVersion(input.workspaceId, tx);
        });
        if (added) {
            this.policy.clearCache();
            this.logger.info("teams.visibility_granted", {
                workspaceId: input.workspaceId,
                viewerSpaceId: input.viewerSpaceId,
                targetSpaceId: input.targetSpaceId,
                actorId: input.actorId,
            });
        }
    }
    /** Revoke sight. Idempotent 204 — revoking a grant that never existed is a no-op. */
    async revokeVisibility(input) {
        await this.requireSpace(input.viewerSpaceId, input.workspaceId);
        let removed = false;
        await this.db.transaction(async (tx) => {
            removed = await this.grants.revoke({
                workspaceId: input.workspaceId,
                viewerSpaceId: input.viewerSpaceId,
                targetSpaceId: input.targetSpaceId,
            }, tx);
            if (!removed)
                return;
            await this.activity.record({
                workspaceId: input.workspaceId,
                actorId: input.actorId,
                entityType: "space",
                entityId: input.viewerSpaceId,
                action: "visibility_revoked",
                context: { target_space_id: input.targetSpaceId },
            }, tx);
            await this.roles.bumpPermissionsVersion(input.workspaceId, tx);
        });
        if (removed) {
            this.policy.clearCache();
            this.logger.info("teams.visibility_revoked", {
                workspaceId: input.workspaceId,
                viewerSpaceId: input.viewerSpaceId,
                targetSpaceId: input.targetSpaceId,
                actorId: input.actorId,
            });
        }
    }
    // ─── guards ──────────────────────────────────────────────────────────────
    async requireSpace(spaceId, workspaceId) {
        const space = await this.spaces.findByIdInWorkspace(spaceId, workspaceId);
        if (!space) {
            throw errors_1.AppError.notFound("space.not_found", "Space not found");
        }
        return space;
    }
    /**
     * owner/admin (live role) OR the team's own head OR a grant reaching
     * `space.members_manage` in this space. Everyone else: the taxonomy 403.
     */
    async assertTeamManager(space, actorId, actorRoleFallback) {
        const legacy = await (0, scopeGuard_1.liveLegacyRole)(actorRoleFallback);
        if (legacy === "owner" || legacy === "admin")
            return;
        if (space.headUserId === actorId)
            return;
        const actor = await (0, context_1.currentActor)();
        if (actor && actor.kind === "user") {
            (0, can_1.assertCan)(actor, "space.members_manage", { spaceId: space.id });
            return;
        }
        throw errors_1.AppError.forbidden("auth.forbidden", "You don't have enough permissions");
    }
}
exports.TeamMembershipService = TeamMembershipService;
// ─── lazy singleton (the `pushSvc()` pattern) ────────────────────────────────
// `SpacesService` (head sync) and `UserService` (invite) call in from inside
// their own flows; a constructor-injected instance at every wiring site would
// grow three DI lists for one always-identical dependency graph.
let instance = null;
const teamMembership = () => {
    if (!instance) {
        const db = (0, client_1.getDb)();
        instance = new TeamMembershipService(db, new RolesRepo_1.RolesRepo(db), new UserRolesRepo_1.UserRolesRepo(db), new UsersRepo_1.UsersRepo(db), new SpacesRepo_1.SpacesRepo(db), new WorkspaceActivityRepo_1.WorkspaceActivityRepo(db), new SpaceVisibilityGrantsRepo_1.SpaceVisibilityGrantsRepo(db), (0, policy_1.getPolicy)(), logger_1.default);
    }
    return instance;
};
exports.teamMembership = teamMembership;
/** Test hook — mirrors PushService's reset so suites can re-seed cleanly. */
const resetTeamMembership = () => {
    instance = null;
};
exports.resetTeamMembership = resetTeamMembership;
