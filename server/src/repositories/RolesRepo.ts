import { and, asc, eq, isNull, sql, type SQL, ne } from "drizzle-orm";
import { MySql2Database } from "drizzle-orm/mysql2";
import * as schema from "../db/schema";
import { rolePermissions, roles, userRoleGrants, workspaces } from "../db/schema";
import type { PermissionScope } from "../rbac/catalog";
import { fakeId } from "../utils";
import type { DbExecutor } from "./types";

/**
 * Data access for `roles` + `role_permissions` — the definable half of RBAC.
 *
 * The service layer owns the rules (system-role immutability, the anti-lockout
 * guard, the escalation guard); this repo only moves rows.
 */
export interface RoleRecord {
    id: string;
    roleKey: string;
    name: string;
    description: string | null;
    color: string;
    isSystem: boolean;
    rankOrder: number;
    archivedAt: Date | null;
    createdAt: Date;
}

export interface RoleGrant {
    permissionKey: string;
    scope: PermissionScope;
}

export interface NewRoleFields {
    roleKey: string;
    name: string;
    description?: string | null;
    color?: string;
    rankOrder?: number;
    createdBy?: string | null;
}

export interface RoleUpdateFields {
    name?: string;
    description?: string | null;
    color?: string;
    rankOrder?: number;
    archivedAt?: Date | null;
}

const roleColumns = {
    id: roles.id,
    roleKey: roles.roleKey,
    name: roles.name,
    description: roles.description,
    color: roles.color,
    isSystem: roles.isSystem,
    rankOrder: roles.rankOrder,
    archivedAt: roles.archivedAt,
    createdAt: roles.createdAt,
};

export class RolesRepo {
    constructor(private db: MySql2Database<typeof schema>) {}

    /** Roles of a workspace, most powerful first. Archived excluded by default. */
    async listByWorkspace(
        workspaceId: string,
        opts: { includeArchived?: boolean } = {},
        exec: DbExecutor = this.db,
    ): Promise<RoleRecord[]> {
        const where: SQL | undefined = opts.includeArchived
            ? eq(roles.workspaceId, workspaceId)
            : and(eq(roles.workspaceId, workspaceId), isNull(roles.archivedAt));
        return exec
            .select(roleColumns)
            .from(roles)
            .where(where)
            .orderBy(asc(roles.rankOrder), asc(roles.id));
    }

    /** One role, scoped to the workspace (null = not found / other tenant). */
    async findByIdInWorkspace(
        roleId: string,
        workspaceId: string,
        exec: DbExecutor = this.db,
    ): Promise<RoleRecord | null> {
        const rows = await exec
            .select(roleColumns)
            .from(roles)
            .where(
                and(eq(roles.id, roleId), eq(roles.workspaceId, workspaceId)),
            )
            .limit(1);
        return rows[0] ?? null;
    }

    /** Lookup by the stable slug — how the seeded system roles are addressed. */
    /**
     * F27 (ISS-027): the friendly pre-check for a duplicate DISPLAY name. The
     * `uq_roles_workspace_name` index is the race-free backstop (mapped to the
     * same 409 in the service); this exists so the common case gets a clean
     * message rather than an ER_DUP_ENTRY translation.
     */
    async findByNameInWorkspace(
        name: string,
        workspaceId: string,
        exec: DbExecutor = this.db,
    ): Promise<RoleRecord | null> {
        const rows = await exec
            .select(roleColumns)
            .from(roles)
            .where(
                and(eq(roles.name, name), eq(roles.workspaceId, workspaceId)),
            )
            .limit(1);
        return rows[0] ?? null;
    }

    async findByKeyInWorkspace(
        roleKey: string,
        workspaceId: string,
        exec: DbExecutor = this.db,
    ): Promise<RoleRecord | null> {
        const rows = await exec
            .select(roleColumns)
            .from(roles)
            .where(
                and(
                    eq(roles.roleKey, roleKey),
                    eq(roles.workspaceId, workspaceId),
                ),
            )
            .limit(1);
        return rows[0] ?? null;
    }

    async create(
        workspaceId: string,
        fields: NewRoleFields,
        exec: DbExecutor = this.db,
    ): Promise<string> {
        const id = fakeId("rol");
        await exec.insert(roles).values({
            id,
            workspaceId,
            roleKey: fields.roleKey,
            name: fields.name,
            description: fields.description ?? null,
            ...(fields.color !== undefined ? { color: fields.color } : {}),
            isSystem: false,
            ...(fields.rankOrder !== undefined
                ? { rankOrder: fields.rankOrder }
                : {}),
            createdBy: fields.createdBy ?? null,
        });
        return id;
    }

    async update(
        roleId: string,
        fields: RoleUpdateFields,
        exec: DbExecutor = this.db,
    ): Promise<void> {
        if (Object.keys(fields).length === 0) return;
        await exec.update(roles).set(fields).where(eq(roles.id, roleId));
    }

    /** Hard delete. The service must first refuse system roles + reassign holders. */
    async deleteById(roleId: string, exec: DbExecutor = this.db): Promise<void> {
        await exec.delete(roles).where(eq(roles.id, roleId));
    }

    // ─── grants ──────────────────────────────────────────────────────────────

    async permissionsForRole(
        roleId: string,
        exec: DbExecutor = this.db,
    ): Promise<RoleGrant[]> {
        return exec
            .select({
                permissionKey: rolePermissions.permissionKey,
                scope: rolePermissions.scope,
            })
            .from(rolePermissions)
            .where(eq(rolePermissions.roleId, roleId))
            .orderBy(asc(rolePermissions.permissionKey));
    }

    /**
     * REPLACE a role's whole grant set (the permission grid saves all at once).
     * Delete-then-insert inside the caller's transaction so a half-applied grid
     * can never be observed.
     */
    async replacePermissions(
        roleId: string,
        grants: RoleGrant[],
        exec: DbExecutor = this.db,
    ): Promise<void> {
        await exec
            .delete(rolePermissions)
            .where(eq(rolePermissions.roleId, roleId));
        if (grants.length === 0) return;
        await exec.insert(rolePermissions).values(
            grants.map((g) => ({
                roleId,
                permissionKey: g.permissionKey,
                scope: g.scope,
            })),
        );
    }

    /** How many people hold this role (any scope) — the reassignment guard. */
    async countHolders(
        roleId: string,
        exec: DbExecutor = this.db,
    ): Promise<number> {
        const rows = await exec
            .select({ n: sql<number>`COUNT(*)` })
            .from(userRoleGrants)
            .where(eq(userRoleGrants.roleId, roleId));
        return Number(rows[0]?.n ?? 0);
    }

    /**
     * How many DISTINCT users currently hold a given permission anywhere in the
     * workspace. The anti-lockout guard (P23) uses this before removing
     * `role.manage` / `member.role_change` from the last role that grants it.
     */
    async countUsersWithPermission(
        workspaceId: string,
        permissionKey: string,
        exec: DbExecutor = this.db,
    ): Promise<number> {
        const rows = await exec
            .select({ n: sql<number>`COUNT(DISTINCT ${userRoleGrants.userId})` })
            .from(userRoleGrants)
            .innerJoin(roles, eq(roles.id, userRoleGrants.roleId))
            .innerJoin(
                rolePermissions,
                eq(rolePermissions.roleId, userRoleGrants.roleId),
            )
            .where(
                and(
                    eq(userRoleGrants.workspaceId, workspaceId),
                    eq(rolePermissions.permissionKey, permissionKey),
                    isNull(roles.archivedAt),
                ),
            );
        return Number(rows[0]?.n ?? 0);
    }

    /** Same count, ignoring everyone who holds it only via `roleId`. */
    async countUsersWithPermissionExcludingRole(
        workspaceId: string,
        permissionKey: string,
        roleId: string,
        exec: DbExecutor = this.db,
    ): Promise<number> {
        const rows = await exec
            .select({ n: sql<number>`COUNT(DISTINCT ${userRoleGrants.userId})` })
            .from(userRoleGrants)
            .innerJoin(roles, eq(roles.id, userRoleGrants.roleId))
            .innerJoin(
                rolePermissions,
                eq(rolePermissions.roleId, userRoleGrants.roleId),
            )
            .where(
                and(
                    eq(userRoleGrants.workspaceId, workspaceId),
                    eq(rolePermissions.permissionKey, permissionKey),
                    isNull(roles.archivedAt),
                    ne(userRoleGrants.roleId, roleId),
                ),
            );
        return Number(rows[0]?.n ?? 0);
    }

    /** Same count, ignoring one user — "is this the last administrator?". */
    async countUsersWithPermissionExcluding(
        workspaceId: string,
        permissionKey: string,
        userId: string,
        exec: DbExecutor = this.db,
    ): Promise<number> {
        const rows = await exec
            .select({ n: sql<number>`COUNT(DISTINCT ${userRoleGrants.userId})` })
            .from(userRoleGrants)
            .innerJoin(roles, eq(roles.id, userRoleGrants.roleId))
            .innerJoin(
                rolePermissions,
                eq(rolePermissions.roleId, userRoleGrants.roleId),
            )
            .where(
                and(
                    eq(userRoleGrants.workspaceId, workspaceId),
                    eq(rolePermissions.permissionKey, permissionKey),
                    isNull(roles.archivedAt),
                    ne(userRoleGrants.userId, userId),
                ),
            );
        return Number(rows[0]?.n ?? 0);
    }

    // ─── cache stamp ─────────────────────────────────────────────────────────

    /**
     * Bump `workspaces.permissions_version`. EVERY RBAC mutation (role edit,
     * grant change, assignment change) must call this in the same transaction —
     * it is what invalidates the per-request permission cache, so a revoked
     * permission takes effect on the very next request instead of up to 15
     * minutes later. Lives here because roles are the primary trigger; the
     * assignment paths call the same method.
     */
    async bumpPermissionsVersion(
        workspaceId: string,
        exec: DbExecutor = this.db,
    ): Promise<void> {
        await exec
            .update(workspaces)
            .set({ permissionsVersion: sql`${workspaces.permissionsVersion} + 1` })
            .where(eq(workspaces.id, workspaceId));
    }

    async getPermissionsVersion(
        workspaceId: string,
        exec: DbExecutor = this.db,
    ): Promise<number> {
        const rows = await exec
            .select({ v: workspaces.permissionsVersion })
            .from(workspaces)
            .where(eq(workspaces.id, workspaceId))
            .limit(1);
        return Number(rows[0]?.v ?? 0);
    }
}
