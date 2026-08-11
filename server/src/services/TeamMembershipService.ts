import type { MySql2Database } from "drizzle-orm/mysql2";
import type { Logger } from "winston";
import * as schema from "../db/schema";
import { getDb } from "../db/client";
import logger from "../config/logger";
import { AppError } from "../errors";
import { assertCan } from "../rbac/can";
import { currentActor } from "../rbac/context";
import { getPolicy } from "../rbac/policy";
import { liveLegacyRole } from "../rbac/scopeGuard";
import type { PolicyService } from "./PolicyService";
import { RolesRepo } from "../repositories/RolesRepo";
import {
    UserRolesRepo,
    type AssignmentRecord,
} from "../repositories/UserRolesRepo";
import { UsersRepo, type UserListRow } from "../repositories/UsersRepo";
import { SpacesRepo, type SpaceRecord } from "../repositories/SpacesRepo";
import { WorkspaceActivityRepo } from "../repositories/WorkspaceActivityRepo";
import type { DbExecutor } from "../repositories/types";

/**
 * TEAMS & MEMBERSHIP (TEAM_ACCESS_AND_AUDIT_PLAN.md Phase 1).
 *
 * A "team" IS a space, and being on a team IS holding a role scoped to that
 * space (`user_roles.scope_type='space'` — plan D-1/D-2; there is deliberately
 * no separate members table). This service makes that structure manageable:
 *
 *   - `directory()`        — the whole org chart in one read (Settings → Teams)
 *   - `addMember()`        — put a person on a team (seeded Member role,
 *                            space-scoped; deliberately NO role choice here —
 *                            granting stronger roles stays on the role.assign
 *                            surface with its escalation guard)
 *   - `removeMember()`     — take a person off a team (every space-scoped role)
 *   - `setHomeTeam()`      — `users.primary_space_id`
 *   - `ensureSpaceMembership()` / `syncHeadMembership()` — the G2 fix: a
 *     department head MUST also be a member of their own space, or the later
 *     visibility switch (plan P6) locks every head out of their own department.
 *
 * Who may manage a team's roster: workspace owner/admin (live role, F10), the
 * team's OWN head, or anyone whose grants reach `space.members_manage` in that
 * space. The head branch mirrors `ReviewsService.requireHeadOrAdmin` — heads
 * are Members and hold no admin key, so the rule is row-dependent and lives
 * here, not in route middleware.
 *
 * Cache stamp discipline: membership rows change what a user's grants reach,
 * so every membership write bumps `permissions_version` + clears the policy
 * cache — EXCEPT inside the invite transaction (`bump:false`), where a fresh
 * account cannot have a cached actor yet and the workspace-row lock would
 * deadlock racing invites (the `syncUserSystemRole` precedent).
 */

export interface TeamMemberEntry {
    assignmentId: string;
    user: UserListRow;
    roleKey: string;
    roleName: string;
    isHead: boolean;
    isPrimary: boolean;
}

export interface TeamEntry {
    space: SpaceRecord;
    head: UserListRow | null;
    members: TeamMemberEntry[];
}

export interface TeamDirectory {
    teams: TeamEntry[];
    /** People (not deactivated) with no home team yet — the admin to-do list. */
    unassigned: UserListRow[];
}

export class TeamMembershipService {
    constructor(
        private db: MySql2Database<typeof schema>,
        private roles: RolesRepo,
        private assignments: UserRolesRepo,
        private users: UsersRepo,
        private spaces: SpacesRepo,
        private activity: WorkspaceActivityRepo,
        private policy: PolicyService,
        private logger: Logger,
    ) {}

    // ─── reads ───────────────────────────────────────────────────────────────

    /** The org chart: every (non-archived) team, its head, its people. */
    async directory(workspaceId: string): Promise<TeamDirectory> {
        const [spaceRows, assignmentRows, usersWithPrimary] = await Promise.all([
            this.spaces.listByWorkspace(workspaceId, { includeArchived: false }),
            this.assignments.listSpaceAssignments(workspaceId),
            this.users.listWithPrimaryByWorkspace(workspaceId),
        ]);

        const usersById = new Map(usersWithPrimary.map((u) => [u.id, u]));
        const bySpace = new Map<string, AssignmentRecord[]>();
        for (const a of assignmentRows) {
            if (!a.scopeId) continue;
            const list = bySpace.get(a.scopeId);
            if (list) list.push(a);
            else bySpace.set(a.scopeId, [a]);
        }

        const teams: TeamEntry[] = spaceRows.map((space) => {
            const seen = new Set<string>();
            const members: TeamMemberEntry[] = [];
            for (const a of bySpace.get(space.id) ?? []) {
                // One entry per person; rows arrive rank-ordered, so the
                // strongest role wins the display slot.
                if (seen.has(a.userId)) continue;
                const user = usersById.get(a.userId);
                // Deactivation revokes all grants (P24) — the guard is
                // belt-and-braces against rows written before that rule.
                if (!user || user.status === "deactivated") continue;
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
            return { space, head, members };
        });

        const unassigned = usersWithPrimary.filter(
            (u) => u.primarySpaceId === null && u.status !== "deactivated",
        );
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
    async ensureSpaceMembership(
        userId: string,
        spaceId: string,
        workspaceId: string,
        opts: {
            exec?: DbExecutor;
            bump?: boolean;
            grantedBy?: string | null;
        } = {},
    ): Promise<boolean> {
        const exec = opts.exec ?? this.db;
        const already = await this.assignments.hasSpaceMembership(
            userId,
            spaceId,
            workspaceId,
            exec,
        );
        if (already) return false;

        const memberRole = await this.roles.findByKeyInWorkspace(
            "member",
            workspaceId,
            exec,
        );
        if (!memberRole) {
            // Bootstrap seeds it on every boot; absence = half-provisioned DB.
            throw AppError.internal(
                "The seeded Member role is missing — RBAC bootstrap has not run",
            );
        }
        await this.assignments.assign(
            {
                workspaceId,
                userId,
                roleId: memberRole.id,
                scopeType: "space",
                scopeId: spaceId,
                grantedBy: opts.grantedBy ?? null,
            },
            exec,
        );
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
    async syncHeadMembership(
        headUserId: string,
        spaceId: string,
        workspaceId: string,
        opts: { exec?: DbExecutor; grantedBy?: string | null } = {},
    ): Promise<boolean> {
        const exec = opts.exec ?? this.db;
        const added = await this.ensureSpaceMembership(
            headUserId,
            spaceId,
            workspaceId,
            { exec, bump: false, grantedBy: opts.grantedBy ?? null },
        );
        const primary = await this.users.primarySpaceIdOf(
            headUserId,
            workspaceId,
            exec,
        );
        if (primary === null) {
            await this.users.update(
                headUserId,
                { primarySpaceId: spaceId },
                exec,
            );
        }
        return added;
    }

    /** Post-commit half of `syncHeadMembership` — cache stamp + policy cache. */
    async commitMembershipBump(workspaceId: string): Promise<void> {
        await this.roles.bumpPermissionsVersion(workspaceId);
        this.policy.clearCache();
    }

    // ─── roster writes ───────────────────────────────────────────────────────

    /** Put a person on a team. Idempotent — re-adding is a silent no-op. */
    async addMember(input: {
        workspaceId: string;
        spaceId: string;
        userId: string;
        actorId: string;
        actorRole: string;
    }): Promise<void> {
        const space = await this.requireSpace(input.spaceId, input.workspaceId);
        await this.assertTeamManager(space, input.actorId, input.actorRole);
        if (space.archivedAt) {
            throw AppError.conflict(
                "space.archived",
                "This team is archived — unarchive it before changing members",
            );
        }
        const user = await this.users.findByIdInWorkspace(
            input.userId,
            input.workspaceId,
        );
        if (!user) {
            throw AppError.notFound("user.not_found", "User not found");
        }
        if (user.status === "deactivated") {
            throw AppError.unprocessable(
                "team.member_invalid",
                "A deactivated user cannot be added to a team",
                [{ field: "user_id", issue: "user is deactivated" }],
            );
        }

        let added = false;
        await this.db.transaction(async (tx) => {
            added = await this.ensureSpaceMembership(
                input.userId,
                input.spaceId,
                input.workspaceId,
                { exec: tx, bump: false, grantedBy: input.actorId },
            );
            if (!added) return; // already on the team — idempotent, no audit row
            // First team automatically becomes the home team.
            const primary = await this.users.primarySpaceIdOf(
                input.userId,
                input.workspaceId,
                tx,
            );
            if (primary === null) {
                await this.users.update(
                    input.userId,
                    { primarySpaceId: input.spaceId },
                    tx,
                );
            }
            await this.activity.record(
                {
                    workspaceId: input.workspaceId,
                    actorId: input.actorId,
                    entityType: "space",
                    entityId: input.spaceId,
                    action: "member_added",
                    context: { user_id: input.userId },
                },
                tx,
            );
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
    async removeMember(input: {
        workspaceId: string;
        spaceId: string;
        userId: string;
        actorId: string;
        actorRole: string;
    }): Promise<void> {
        const space = await this.requireSpace(input.spaceId, input.workspaceId);
        await this.assertTeamManager(space, input.actorId, input.actorRole);
        if (space.archivedAt) {
            throw AppError.conflict(
                "space.archived",
                "This team is archived — unarchive it before changing members",
            );
        }
        if (space.headUserId === input.userId) {
            throw AppError.conflict(
                "team.head_locked",
                "This person heads the team — assign a new head before removing them",
            );
        }
        const user = await this.users.findByIdInWorkspace(
            input.userId,
            input.workspaceId,
        );
        if (!user) {
            throw AppError.notFound("user.not_found", "User not found");
        }

        let removed = false;
        await this.db.transaction(async (tx) => {
            const isMember = await this.assignments.hasSpaceMembership(
                input.userId,
                input.spaceId,
                input.workspaceId,
                tx,
            );
            if (!isMember) return; // not on the team — idempotent no-op
            removed = true;
            await this.assignments.revokeSpaceMemberships(
                input.userId,
                input.spaceId,
                input.workspaceId,
                tx,
            );
            // A home team you are no longer on is a lie — clear it.
            const primary = await this.users.primarySpaceIdOf(
                input.userId,
                input.workspaceId,
                tx,
            );
            if (primary === input.spaceId) {
                await this.users.update(
                    input.userId,
                    { primarySpaceId: null },
                    tx,
                );
            }
            await this.activity.record(
                {
                    workspaceId: input.workspaceId,
                    actorId: input.actorId,
                    entityType: "space",
                    entityId: input.spaceId,
                    action: "member_removed",
                    context: { user_id: input.userId },
                },
                tx,
            );
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
    async setHomeTeam(input: {
        workspaceId: string;
        userId: string;
        spaceId: string | null;
        actorId: string;
    }): Promise<void> {
        const user = await this.users.findByIdInWorkspace(
            input.userId,
            input.workspaceId,
        );
        if (!user) {
            throw AppError.notFound("user.not_found", "User not found");
        }
        if (user.status === "deactivated") {
            throw AppError.unprocessable(
                "team.member_invalid",
                "A deactivated user cannot be assigned to a team",
                [{ field: "user_id", issue: "user is deactivated" }],
            );
        }

        if (input.spaceId === null) {
            await this.db.transaction(async (tx) => {
                await this.users.update(
                    input.userId,
                    { primarySpaceId: null },
                    tx,
                );
                await this.activity.record(
                    {
                        workspaceId: input.workspaceId,
                        actorId: input.actorId,
                        entityType: "user",
                        entityId: input.userId,
                        action: "team_changed",
                        context: { space_id: null },
                    },
                    tx,
                );
            });
            return;
        }

        const space = await this.spaces.findByIdInWorkspace(
            input.spaceId,
            input.workspaceId,
        );
        // Body input → 422 (like space.head_invalid), never a 404 oracle.
        if (!space || space.archivedAt) {
            throw AppError.unprocessable(
                "team.space_invalid",
                "space_id must be an existing, non-archived space",
                [{ field: "space_id", issue: "unknown or archived space" }],
            );
        }

        let added = false;
        await this.db.transaction(async (tx) => {
            added = await this.ensureSpaceMembership(
                input.userId,
                input.spaceId as string,
                input.workspaceId,
                { exec: tx, bump: false, grantedBy: input.actorId },
            );
            await this.users.update(
                input.userId,
                { primarySpaceId: input.spaceId },
                tx,
            );
            await this.activity.record(
                {
                    workspaceId: input.workspaceId,
                    actorId: input.actorId,
                    entityType: "user",
                    entityId: input.userId,
                    action: "team_changed",
                    context: {
                        space_id: input.spaceId,
                        membership_added: added,
                    },
                },
                tx,
            );
            if (added) {
                await this.roles.bumpPermissionsVersion(input.workspaceId, tx);
            }
        });
        if (added) this.policy.clearCache();
    }

    // ─── guards ──────────────────────────────────────────────────────────────

    private async requireSpace(
        spaceId: string,
        workspaceId: string,
    ): Promise<SpaceRecord> {
        const space = await this.spaces.findByIdInWorkspace(
            spaceId,
            workspaceId,
        );
        if (!space) {
            throw AppError.notFound("space.not_found", "Space not found");
        }
        return space;
    }

    /**
     * owner/admin (live role) OR the team's own head OR a grant reaching
     * `space.members_manage` in this space. Everyone else: the taxonomy 403.
     */
    private async assertTeamManager(
        space: SpaceRecord,
        actorId: string,
        actorRoleFallback: string,
    ): Promise<void> {
        const legacy = await liveLegacyRole(actorRoleFallback);
        if (legacy === "owner" || legacy === "admin") return;
        if (space.headUserId === actorId) return;
        const actor = await currentActor();
        if (actor && actor.kind === "user") {
            assertCan(actor, "space.members_manage", { spaceId: space.id });
            return;
        }
        throw AppError.forbidden(
            "auth.forbidden",
            "You don't have enough permissions",
        );
    }
}

// ─── lazy singleton (the `pushSvc()` pattern) ────────────────────────────────
// `SpacesService` (head sync) and `UserService` (invite) call in from inside
// their own flows; a constructor-injected instance at every wiring site would
// grow three DI lists for one always-identical dependency graph.
let instance: TeamMembershipService | null = null;

export const teamMembership = (): TeamMembershipService => {
    if (!instance) {
        const db = getDb();
        instance = new TeamMembershipService(
            db,
            new RolesRepo(db),
            new UserRolesRepo(db),
            new UsersRepo(db),
            new SpacesRepo(db),
            new WorkspaceActivityRepo(db),
            getPolicy(),
            logger,
        );
    }
    return instance;
};

/** Test hook — mirrors PushService's reset so suites can re-seed cleanly. */
export const resetTeamMembership = (): void => {
    instance = null;
};
