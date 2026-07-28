import type { MySql2Database } from "drizzle-orm/mysql2";
import type { Logger } from "winston";
import * as schema from "../db/schema";
import { AppError } from "../errors";
import { entryFor } from "../rbac/can";
import {
    getPermission,
    isPermissionKey,
    supportsScope,
    type PermissionScope,
} from "../rbac/catalog";
import { syncUserSystemRole } from "../rbac/bootstrap";
import type { ActorPermissions } from "../rbac/types";
import type { RoleGrant, RoleRecord, RolesRepo } from "../repositories/RolesRepo";
import type { SpacesRepo } from "../repositories/SpacesRepo";
import type { UsersRepo } from "../repositories/UsersRepo";
import type {
    AssignmentRecord,
    UserRolesRepo,
} from "../repositories/UserRolesRepo";
import type { PolicyService } from "./PolicyService";

/**
 * ROLES ADMINISTRATION (RBAC_DYNAMIC_PLAN.md P23-P24).
 *
 * The endpoints that make the system *dynamic*: create a role, choose exactly
 * what it grants and at what scope, and give it to people workspace-wide or
 * inside one space.
 *
 * ── THE THREE GUARDS ─────────────────────────────────────────────────────────
 * Everything dangerous about a permission system lives here, so all three
 * guards are in one file where they can be read together:
 *
 *  1. SYSTEM-ROLE PROTECTION — the four seeded roles cannot be deleted, and the
 *     OWNER role cannot be edited at all (D-7: it is the anti-lockout floor, so
 *     an admin must not be able to hollow it out). Admin/Member/Guest may have
 *     their grants tuned, which is exactly how "tighten from the default" works.
 *
 *  2. NO LOCKOUT (landmine L7) — a change that would leave the workspace with
 *     nobody who can administer roles is refused. Checked against the number of
 *     people who would still hold `role.manage` AFTER the change, not before.
 *
 *  3. NO ESCALATION (landmine L8) — you cannot grant a permission you do not
 *     hold yourself, and you cannot grant it at a wider scope than you hold. An
 *     admin scoped to Marketing cannot mint a role that reaches Engineering.
 *     The owner is exempt: they already hold everything.
 */

/** Permissions that, if nobody holds them, make the workspace unadministrable. */
const CRITICAL_PERMISSIONS = ["role.manage", "role.assign"] as const;

export interface RoleWithGrants extends RoleRecord {
    grants: RoleGrant[];
    holders: number;
}

export interface CreateRoleInput {
    workspaceId: string;
    actor: ActorPermissions;
    name: string;
    description?: string | null;
    color?: string;
    grants?: RoleGrant[];
}

export interface UpdateRoleInput {
    workspaceId: string;
    actor: ActorPermissions;
    roleId: string;
    name?: string;
    description?: string | null;
    color?: string;
}

export interface SetGrantsInput {
    workspaceId: string;
    actor: ActorPermissions;
    roleId: string;
    grants: RoleGrant[];
}

export interface AssignInput {
    workspaceId: string;
    actor: ActorPermissions;
    userId: string;
    roleId: string;
    spaceId?: string | null;
}

export interface RevokeInput {
    workspaceId: string;
    actor: ActorPermissions;
    userId: string;
    assignmentId: string;
}

/** `Marketing Manager` → `marketing-manager`, uniquified by the caller. */
const slugify = (name: string): string =>
    name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 50) || "role";

export class RolesAdminService {
    constructor(
        private db: MySql2Database<typeof schema>,
        private roles: RolesRepo,
        private assignments: UserRolesRepo,
        private users: UsersRepo,
        private spaces: SpacesRepo,
        private policy: PolicyService,
        private logger: Logger,
    ) {}

    // ─── reads ───────────────────────────────────────────────────────────────

    async list(workspaceId: string): Promise<RoleWithGrants[]> {
        const records = await this.roles.listByWorkspace(workspaceId);
        const out: RoleWithGrants[] = [];
        for (const r of records) {
            out.push({
                ...r,
                grants: await this.roles.permissionsForRole(r.id),
                holders: await this.roles.countHolders(r.id),
            });
        }
        return out;
    }

    async holders(
        workspaceId: string,
        roleId: string,
    ): Promise<{ userId: string; scopeType: string; scopeId: string | null }[]> {
        await this.requireRole(workspaceId, roleId);
        const rows = await this.assignments.listByRole(roleId, workspaceId);
        return rows.map((r) => ({
            userId: r.userId,
            scopeType: r.scopeType,
            scopeId: r.scopeId,
        }));
    }

    // ─── writes ──────────────────────────────────────────────────────────────

    async create(input: CreateRoleInput): Promise<RoleWithGrants> {
        const grants = this.validateGrants(input.grants ?? []);
        this.assertNoEscalation(input.actor, grants);

        // `key` is the stable identifier that `role_permissions` rows hang off,
        // so it is derived once from the name and then never changes — renaming
        // a role must not rewrite data. Collisions get a numeric suffix.
        const base = slugify(input.name);
        let key = base;
        for (
            let i = 2;
            await this.roles.findByKeyInWorkspace(key, input.workspaceId);
            i++
        ) {
            key = `${base}-${i}`;
            if (i > 50) {
                throw AppError.conflict(
                    "role.key_taken",
                    "Could not derive a unique role key from that name",
                );
            }
        }

        const roleId = await this.roles.create(input.workspaceId, {
            roleKey: key,
            name: input.name,
            description: input.description ?? null,
            ...(input.color !== undefined ? { color: input.color } : {}),
            // Custom roles rank below every system role so the escalation guard
            // and the display order both stay sane.
            rankOrder: 100,
            createdBy: input.actor.userId,
        });
        if (grants.length > 0) {
            await this.roles.replacePermissions(roleId, grants);
        }
        await this.roles.bumpPermissionsVersion(input.workspaceId);
        this.policy.clearCache();
        this.logger.info("rbac.role.created", {
            workspaceId: input.workspaceId,
            roleId,
            actorId: input.actor.userId,
            grants: grants.length,
        });
        const record = await this.requireRole(input.workspaceId, roleId);
        return { ...record, grants, holders: 0 };
    }

    async update(input: UpdateRoleInput): Promise<RoleWithGrants> {
        const role = await this.requireRole(input.workspaceId, input.roleId);
        this.assertEditable(role, "edit");

        await this.roles.update(input.roleId, {
            ...(input.name !== undefined ? { name: input.name } : {}),
            ...(input.description !== undefined
                ? { description: input.description }
                : {}),
            ...(input.color !== undefined ? { color: input.color } : {}),
        });
        await this.roles.bumpPermissionsVersion(input.workspaceId);
        this.policy.clearCache();
        const updated = await this.requireRole(input.workspaceId, input.roleId);
        return {
            ...updated,
            grants: await this.roles.permissionsForRole(input.roleId),
            holders: await this.roles.countHolders(input.roleId),
        };
    }

    async setGrants(input: SetGrantsInput): Promise<RoleGrant[]> {
        const role = await this.requireRole(input.workspaceId, input.roleId);
        this.assertEditable(role, "edit");
        const grants = this.validateGrants(input.grants);
        this.assertNoEscalation(input.actor, grants);
        await this.assertNoLockout(input.workspaceId, input.roleId, grants);

        await this.roles.replacePermissions(input.roleId, grants);
        await this.roles.bumpPermissionsVersion(input.workspaceId);
        this.policy.clearCache();
        this.logger.info("rbac.role.grants_set", {
            workspaceId: input.workspaceId,
            roleId: input.roleId,
            actorId: input.actor.userId,
            count: grants.length,
        });
        return grants;
    }

    async remove(input: {
        workspaceId: string;
        actor: ActorPermissions;
        roleId: string;
    }): Promise<void> {
        const role = await this.requireRole(input.workspaceId, input.roleId);
        if (role.isSystem) {
            throw AppError.forbidden(
                "role.system_immutable",
                "The built-in roles cannot be deleted",
            );
        }
        // Deleting a role removes everyone's grant of it (FK CASCADE), so the
        // lockout check has to run as if its grants were empty.
        await this.assertNoLockout(input.workspaceId, input.roleId, []);
        await this.roles.deleteById(input.roleId);
        await this.roles.bumpPermissionsVersion(input.workspaceId);
        this.policy.clearCache();
        this.logger.info("rbac.role.deleted", {
            workspaceId: input.workspaceId,
            roleId: input.roleId,
            actorId: input.actor.userId,
        });
    }

    async assign(input: AssignInput): Promise<AssignmentRecord[]> {
        const role = await this.requireRole(input.workspaceId, input.roleId);
        const user = await this.users.findByIdInWorkspace(
            input.userId,
            input.workspaceId,
        );
        if (!user) {
            throw AppError.notFound("user.not_found", "User not found");
        }
        if (input.spaceId) {
            const space = await this.spaces.findByIdInWorkspace(
                input.spaceId,
                input.workspaceId,
            );
            if (!space) {
                throw AppError.notFound("space.not_found", "Space not found");
            }
        }
        // Escalation guard: giving away a role is giving away its grants.
        this.assertNoEscalation(
            input.actor,
            await this.roles.permissionsForRole(role.id),
            input.spaceId ?? null,
        );

        await this.assignments.assign({
            workspaceId: input.workspaceId,
            userId: input.userId,
            roleId: input.roleId,
            scopeType: input.spaceId ? "space" : "workspace",
            scopeId: input.spaceId ?? null,
            grantedBy: input.actor.userId,
        });
        // L13: a workspace-wide SYSTEM role is also the `users.role` mirror.
        if (role.isSystem && !input.spaceId) {
            await this.users.update(input.userId, { role: role.roleKey as never });
        }
        await this.roles.bumpPermissionsVersion(input.workspaceId);
        this.policy.clearCache();
        this.logger.info("rbac.role.assigned", {
            workspaceId: input.workspaceId,
            roleId: input.roleId,
            userId: input.userId,
            spaceId: input.spaceId ?? null,
            actorId: input.actor.userId,
        });
        return this.assignments.listForUser(input.userId, input.workspaceId);
    }

    async revoke(input: RevokeInput): Promise<AssignmentRecord[]> {
        const held = await this.assignments.listForUser(
            input.userId,
            input.workspaceId,
        );
        const target = held.find((a) => a.id === input.assignmentId);
        if (!target) {
            throw AppError.notFound(
                "assignment.not_found",
                "That role assignment does not exist",
            );
        }
        await this.assertNoLockoutAfterRevoke(
            input.workspaceId,
            input.userId,
            target,
        );
        await this.assignments.revokeById(
            input.assignmentId,
            input.workspaceId,
        );
        // L13: losing the workspace-wide system role drops you to `guest` in
        // the mirror column, matching what the resolver now says you can do.
        if (target.scopeType === "workspace") {
            const remaining = (
                await this.assignments.listForUser(
                    input.userId,
                    input.workspaceId,
                )
            ).filter((a) => a.scopeType === "workspace");
            const stillSystem = remaining.find((a) =>
                ["owner", "admin", "member", "guest"].includes(a.roleKey),
            );
            if (!stillSystem) {
                await this.users.update(input.userId, {
                    role: "guest" as never,
                });
            }
        }
        await this.roles.bumpPermissionsVersion(input.workspaceId);
        this.policy.clearCache();
        this.logger.info("rbac.role.revoked", {
            workspaceId: input.workspaceId,
            assignmentId: input.assignmentId,
            userId: input.userId,
            actorId: input.actor.userId,
        });
        return this.assignments.listForUser(input.userId, input.workspaceId);
    }

    /** Everyone holding a role scoped to this space — the members panel. */
    async spaceMembers(
        workspaceId: string,
        spaceId: string,
    ): Promise<AssignmentRecord[]> {
        const space = await this.spaces.findByIdInWorkspace(
            spaceId,
            workspaceId,
        );
        if (!space) throw AppError.notFound("space.not_found", "Space not found");
        return this.assignments.listBySpace(spaceId, workspaceId);
    }

    async assignmentsForUser(
        workspaceId: string,
        userId: string,
    ): Promise<AssignmentRecord[]> {
        return this.assignments.listForUser(userId, workspaceId);
    }

    /** Re-sync the legacy mirror after any assignment write (used by tests). */
    async resyncLegacyRole(
        workspaceId: string,
        userId: string,
        role: string,
    ): Promise<void> {
        await syncUserSystemRole(this.db, workspaceId, userId, role);
    }

    // ─── guards ──────────────────────────────────────────────────────────────

    private async requireRole(
        workspaceId: string,
        roleId: string,
    ): Promise<RoleRecord> {
        const role = await this.roles.findByIdInWorkspace(roleId, workspaceId);
        if (!role) {
            throw AppError.notFound("role.not_found", "Role not found");
        }
        return role;
    }

    private assertEditable(role: RoleRecord, what: string): void {
        if (role.isSystem && role.roleKey === "owner") {
            throw AppError.forbidden(
                "role.owner_immutable",
                `The Owner role cannot be ${what}ed — it is the account that can never be locked out`,
            );
        }
    }

    /** Reject unknown keys, unsupported scopes and duplicates. */
    private validateGrants(grants: RoleGrant[]): RoleGrant[] {
        const seen = new Map<string, PermissionScope>();
        for (const g of grants) {
            if (!isPermissionKey(g.permissionKey)) {
                throw AppError.unprocessable(
                    "role.unknown_permission",
                    `Unknown permission: ${g.permissionKey}`,
                );
            }
            if (!supportsScope(g.permissionKey, g.scope)) {
                const def = getPermission(g.permissionKey);
                throw AppError.unprocessable(
                    "role.unsupported_scope",
                    `${g.permissionKey} does not support scope '${g.scope}' (allowed: ${def?.scopes.join(", ")})`,
                );
            }
            seen.set(g.permissionKey, g.scope);
        }
        return [...seen].map(([permissionKey, scope]) => ({
            permissionKey,
            scope,
        }));
    }

    /**
     * L8 — you cannot hand out more than you hold. Compared per permission:
     * the actor must be able to exercise it at the scope being granted, in the
     * place it is being granted.
     */
    private assertNoEscalation(
        actor: ActorPermissions,
        grants: RoleGrant[],
        spaceId: string | null = null,
    ): void {
        if (actor.isOwner) return;
        for (const g of grants) {
            const held = entryFor(actor, g.permissionKey as never);
            const ok =
                held.all ||
                (g.scope === "own" && held.own) ||
                (spaceId !== null && held.spaceIds.has(spaceId)) ||
                (spaceId === null && g.scope !== "all" && held.spaceIds.size > 0);
            if (!ok) {
                throw AppError.forbidden(
                    "role.escalation_blocked",
                    `You cannot grant "${g.permissionKey}" because you do not hold it yourself`,
                    [
                        { field: "permission", issue: g.permissionKey },
                        { field: "reason", issue: "escalation" },
                    ],
                );
            }
        }
    }

    /**
     * L7 — refuse any change that would leave nobody able to administer roles.
     * Computed on the state AFTER the change: for each critical permission, if
     * removing it from this role would drop the workspace to zero holders, stop.
     */
    private async assertNoLockout(
        workspaceId: string,
        roleId: string,
        nextGrants: RoleGrant[],
    ): Promise<void> {
        const nextKeys = new Set(nextGrants.map((g) => g.permissionKey));
        const current = await this.roles.permissionsForRole(roleId);
        const holders = await this.roles.countHolders(roleId);
        for (const key of CRITICAL_PERMISSIONS) {
            const losing =
                current.some((g) => g.permissionKey === key) &&
                !nextKeys.has(key);
            if (!losing || holders === 0) continue;
            const total = await this.roles.countUsersWithPermission(
                workspaceId,
                key,
            );
            const stillHave = await this.countHoldersExcludingRole(
                workspaceId,
                key,
                roleId,
            );
            if (total > 0 && stillHave === 0) {
                throw AppError.conflict(
                    "role.last_admin",
                    `Removing "${key}" from this role would leave nobody able to administer permissions`,
                );
            }
        }
    }

    private async assertNoLockoutAfterRevoke(
        workspaceId: string,
        userId: string,
        target: AssignmentRecord,
    ): Promise<void> {
        const grants = await this.roles.permissionsForRole(target.roleId);
        for (const key of CRITICAL_PERMISSIONS) {
            if (!grants.some((g) => g.permissionKey === key)) continue;
            const others = await this.roles.countUsersWithPermissionExcluding(
                workspaceId,
                key,
                userId,
            );
            if (others === 0) {
                throw AppError.conflict(
                    "role.last_admin",
                    "That is the last person who can administer permissions",
                );
            }
        }
    }

    private async countHoldersExcludingRole(
        workspaceId: string,
        permissionKey: string,
        roleId: string,
    ): Promise<number> {
        return this.roles.countUsersWithPermissionExcludingRole(
            workspaceId,
            permissionKey,
            roleId,
        );
    }
}
