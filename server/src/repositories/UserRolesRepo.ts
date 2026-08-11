import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { MySql2Database } from "drizzle-orm/mysql2";
import * as schema from "../db/schema";
import {
    rolePermissions,
    roles,
    userRoleGrants,
    users,
    workspaces,
} from "../db/schema";
import type { PermissionScope } from "../rbac/catalog";
import { fakeId } from "../utils";
import type { DbExecutor } from "./types";

/**
 * Data access for `user_roles` — who holds which role, and where.
 *
 * A row with `scope_type='space'` IS that user's membership of the space
 * (plan D-1/D-2: there is deliberately no separate members table).
 */

/** One assignment row, with its role's display fields joined in. */
export interface AssignmentRecord {
    id: string;
    userId: string;
    roleId: string;
    roleKey: string;
    roleName: string;
    scopeType: "workspace" | "space";
    scopeId: string | null;
    createdAt: Date;
}

/**
 * One (permission, grant-scope, assignment-scope) tuple — the raw input the
 * P6 resolver folds into a user's effective permission set.
 */
export interface EffectiveGrantRow {
    permissionKey: string;
    grantScope: PermissionScope;
    assignmentScopeType: "workspace" | "space";
    assignmentScopeId: string | null;
}

/**
 * The per-request facts the resolver needs BEFORE it decides whether its cache
 * is still valid: the workspace's cache stamp, and the legacy `users.role`
 * (which anchors the owner floor — see `PolicyService`).
 */
export interface ActorContextRow {
    legacyRole: string;
    status: string;
    permissionsVersion: number;
}

export class UserRolesRepo {
    constructor(private db: MySql2Database<typeof schema>) {}

    /**
     * One indexed lookup returning the user's legacy role + status and the
     * workspace's `permissions_version`. This is the ONLY query a cache HIT
     * costs, so it is deliberately a single PK-join.
     *
     * Returns null when the user does not exist in that workspace (which the
     * caller turns into "no permissions", never into an error).
     */
    async getActorContext(
        userId: string,
        workspaceId: string,
        exec: DbExecutor = this.db,
    ): Promise<ActorContextRow | null> {
        const rows = await exec
            .select({
                legacyRole: users.role,
                status: users.status,
                permissionsVersion: workspaces.permissionsVersion,
            })
            .from(users)
            .innerJoin(workspaces, eq(workspaces.id, users.workspaceId))
            .where(and(eq(users.id, userId), eq(users.workspaceId, workspaceId)))
            .limit(1);
        const row = rows[0];
        if (!row) return null;
        return {
            legacyRole: row.legacyRole,
            status: row.status,
            permissionsVersion: Number(row.permissionsVersion),
        };
    }

    /**
     * THE HOT QUERY. Every grant a user holds, with both scopes, in one join.
     *
     * Backed by `idx_user_roles_user (user_id, scope_type)`. Archived roles are
     * excluded so archiving a role instantly removes its power without having
     * to touch every assignment. The result also carries the user's space
     * membership (`assignmentScopeId` where the type is 'space'), so the
     * visibility resolver needs no second query.
     */
    async listEffectiveGrants(
        userId: string,
        workspaceId: string,
        exec: DbExecutor = this.db,
    ): Promise<EffectiveGrantRow[]> {
        return exec
            .select({
                permissionKey: rolePermissions.permissionKey,
                grantScope: rolePermissions.scope,
                assignmentScopeType: userRoleGrants.scopeType,
                assignmentScopeId: userRoleGrants.scopeId,
            })
            .from(userRoleGrants)
            .innerJoin(roles, eq(roles.id, userRoleGrants.roleId))
            .innerJoin(
                rolePermissions,
                eq(rolePermissions.roleId, userRoleGrants.roleId),
            )
            .where(
                and(
                    eq(userRoleGrants.userId, userId),
                    eq(userRoleGrants.workspaceId, workspaceId),
                    isNull(roles.archivedAt),
                ),
            );
    }

    /** A user's assignments (for the profile / members UI). */
    async listForUser(
        userId: string,
        workspaceId: string,
        exec: DbExecutor = this.db,
    ): Promise<AssignmentRecord[]> {
        return exec
            .select({
                id: userRoleGrants.id,
                userId: userRoleGrants.userId,
                roleId: userRoleGrants.roleId,
                roleKey: roles.roleKey,
                roleName: roles.name,
                scopeType: userRoleGrants.scopeType,
                scopeId: userRoleGrants.scopeId,
                createdAt: userRoleGrants.createdAt,
            })
            .from(userRoleGrants)
            .innerJoin(roles, eq(roles.id, userRoleGrants.roleId))
            .where(
                and(
                    eq(userRoleGrants.userId, userId),
                    eq(userRoleGrants.workspaceId, workspaceId),
                ),
            )
            .orderBy(asc(roles.rankOrder), asc(userRoleGrants.createdAt));
    }

    /** Everyone assigned inside one space — the space-members panel (P27). */
    async listBySpace(
        spaceId: string,
        workspaceId: string,
        exec: DbExecutor = this.db,
    ): Promise<AssignmentRecord[]> {
        return exec
            .select({
                id: userRoleGrants.id,
                userId: userRoleGrants.userId,
                roleId: userRoleGrants.roleId,
                roleKey: roles.roleKey,
                roleName: roles.name,
                scopeType: userRoleGrants.scopeType,
                scopeId: userRoleGrants.scopeId,
                createdAt: userRoleGrants.createdAt,
            })
            .from(userRoleGrants)
            .innerJoin(roles, eq(roles.id, userRoleGrants.roleId))
            .where(
                and(
                    eq(userRoleGrants.scopeId, spaceId),
                    eq(userRoleGrants.workspaceId, workspaceId),
                    eq(userRoleGrants.scopeType, "space"),
                ),
            )
            .orderBy(asc(roles.rankOrder), asc(userRoleGrants.createdAt));
    }

    /**
     * Every space-scoped assignment in the workspace, one query — the
     * Settings → Teams directory (team-access P1). Same projection/order as
     * `listBySpace`; the service groups by `scopeId`.
     */
    async listSpaceAssignments(
        workspaceId: string,
        exec: DbExecutor = this.db,
    ): Promise<AssignmentRecord[]> {
        return exec
            .select({
                id: userRoleGrants.id,
                userId: userRoleGrants.userId,
                roleId: userRoleGrants.roleId,
                roleKey: roles.roleKey,
                roleName: roles.name,
                scopeType: userRoleGrants.scopeType,
                scopeId: userRoleGrants.scopeId,
                createdAt: userRoleGrants.createdAt,
            })
            .from(userRoleGrants)
            .innerJoin(roles, eq(roles.id, userRoleGrants.roleId))
            .where(
                and(
                    eq(userRoleGrants.workspaceId, workspaceId),
                    eq(userRoleGrants.scopeType, "space"),
                ),
            )
            .orderBy(asc(roles.rankOrder), asc(userRoleGrants.createdAt));
    }

    /**
     * Does the user hold ANY role scoped to this space? Holding one (whatever
     * the role) IS membership (plan D-1/D-2) — `ensureSpaceMembership` must
     * not stack a second row on top of e.g. a custom department role.
     */
    async hasSpaceMembership(
        userId: string,
        spaceId: string,
        workspaceId: string,
        exec: DbExecutor = this.db,
    ): Promise<boolean> {
        const rows = await exec
            .select({ id: userRoleGrants.id })
            .from(userRoleGrants)
            .where(
                and(
                    eq(userRoleGrants.userId, userId),
                    eq(userRoleGrants.workspaceId, workspaceId),
                    eq(userRoleGrants.scopeType, "space"),
                    eq(userRoleGrants.scopeId, spaceId),
                ),
            )
            .limit(1);
        return rows.length > 0;
    }

    /**
     * Remove the person from a team: EVERY role they hold scoped to that
     * space (removing membership while leaving a space-scoped custom role
     * behind would silently keep them inside). Workspace-scoped grants are
     * untouched.
     */
    async revokeSpaceMemberships(
        userId: string,
        spaceId: string,
        workspaceId: string,
        exec: DbExecutor = this.db,
    ): Promise<void> {
        await exec
            .delete(userRoleGrants)
            .where(
                and(
                    eq(userRoleGrants.userId, userId),
                    eq(userRoleGrants.workspaceId, workspaceId),
                    eq(userRoleGrants.scopeType, "space"),
                    eq(userRoleGrants.scopeId, spaceId),
                ),
            );
    }

    /** Everyone holding one role, anywhere — the "who has this?" panel. */
    async listByRole(
        roleId: string,
        workspaceId: string,
        exec: DbExecutor = this.db,
    ): Promise<AssignmentRecord[]> {
        return exec
            .select({
                id: userRoleGrants.id,
                userId: userRoleGrants.userId,
                roleId: userRoleGrants.roleId,
                roleKey: roles.roleKey,
                roleName: roles.name,
                scopeType: userRoleGrants.scopeType,
                scopeId: userRoleGrants.scopeId,
                createdAt: userRoleGrants.createdAt,
            })
            .from(userRoleGrants)
            .innerJoin(roles, eq(roles.id, userRoleGrants.roleId))
            .where(
                and(
                    eq(userRoleGrants.roleId, roleId),
                    eq(userRoleGrants.workspaceId, workspaceId),
                ),
            )
            .orderBy(asc(userRoleGrants.createdAt));
    }

    /**
     * Grant a role. Idempotent: the `uq_user_roles_grant` unique key (which is
     * NULL-safe via the generated `scope_key`) absorbs a repeat, so callers do
     * not have to check first. Returns the new row's id (or the existing one).
     */
    async assign(
        input: {
            workspaceId: string;
            userId: string;
            roleId: string;
            scopeType: "workspace" | "space";
            scopeId?: string | null;
            grantedBy?: string | null;
        },
        exec: DbExecutor = this.db,
    ): Promise<string> {
        const id = fakeId("urol");
        await exec
            .insert(userRoleGrants)
            .values({
                id,
                workspaceId: input.workspaceId,
                userId: input.userId,
                roleId: input.roleId,
                scopeType: input.scopeType,
                scopeId: input.scopeId ?? null,
                grantedBy: input.grantedBy ?? null,
            })
            .onDuplicateKeyUpdate({
                // No-op update so a duplicate grant is absorbed rather than throwing.
                set: { scopeType: sql`VALUES(scope_type)` },
            });

        const existing = await exec
            .select({ id: userRoleGrants.id })
            .from(userRoleGrants)
            .where(
                and(
                    eq(userRoleGrants.userId, input.userId),
                    eq(userRoleGrants.roleId, input.roleId),
                    eq(userRoleGrants.scopeType, input.scopeType),
                    input.scopeId
                        ? eq(userRoleGrants.scopeId, input.scopeId)
                        : isNull(userRoleGrants.scopeId),
                ),
            )
            .limit(1);
        return existing[0]?.id ?? id;
    }

    /** Remove one assignment by id, scoped to the workspace. */
    async revokeById(
        assignmentId: string,
        workspaceId: string,
        exec: DbExecutor = this.db,
    ): Promise<void> {
        await exec
            .delete(userRoleGrants)
            .where(
                and(
                    eq(userRoleGrants.id, assignmentId),
                    eq(userRoleGrants.workspaceId, workspaceId),
                ),
            );
    }

    /** Remove a specific (user, role, scope) grant. */
    async revoke(
        input: {
            workspaceId: string;
            userId: string;
            roleId: string;
            scopeType: "workspace" | "space";
            scopeId?: string | null;
        },
        exec: DbExecutor = this.db,
    ): Promise<void> {
        await exec
            .delete(userRoleGrants)
            .where(
                and(
                    eq(userRoleGrants.workspaceId, input.workspaceId),
                    eq(userRoleGrants.userId, input.userId),
                    eq(userRoleGrants.roleId, input.roleId),
                    eq(userRoleGrants.scopeType, input.scopeType),
                    input.scopeId
                        ? eq(userRoleGrants.scopeId, input.scopeId)
                        : isNull(userRoleGrants.scopeId),
                ),
            );
    }

    /** Drop every assignment a user holds (used when deactivating, P24). */
    async revokeAllForUser(
        userId: string,
        workspaceId: string,
        exec: DbExecutor = this.db,
    ): Promise<void> {
        await exec
            .delete(userRoleGrants)
            .where(
                and(
                    eq(userRoleGrants.userId, userId),
                    eq(userRoleGrants.workspaceId, workspaceId),
                ),
            );
    }

    /**
     * Does the workspace row exist at all? One PK lookup, used only on the
     * error path where a JWT names a workspace we could not resolve an actor
     * in — it decides between "the workspace is gone" (let the handler 404, as
     * it did before RBAC) and "you are not in it" (403).
     */
    async workspaceExists(
        workspaceId: string,
        exec: DbExecutor = this.db,
    ): Promise<boolean> {
        const rows = await exec
            .select({ id: workspaces.id })
            .from(workspaces)
            .where(eq(workspaces.id, workspaceId))
            .limit(1);
        return rows.length > 0;
    }

    /** Space ids where this user holds ANY role — their membership set. */
    async spaceIdsForUser(
        userId: string,
        workspaceId: string,
        exec: DbExecutor = this.db,
    ): Promise<string[]> {
        const rows = await exec
            .selectDistinct({ spaceId: userRoleGrants.scopeId })
            .from(userRoleGrants)
            .innerJoin(roles, eq(roles.id, userRoleGrants.roleId))
            .where(
                and(
                    eq(userRoleGrants.userId, userId),
                    eq(userRoleGrants.workspaceId, workspaceId),
                    eq(userRoleGrants.scopeType, "space"),
                    isNull(roles.archivedAt),
                ),
            );
        return rows
            .map((r) => r.spaceId)
            .filter((s): s is string => s !== null);
    }
}
