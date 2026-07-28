"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RolesRepo = void 0;
const drizzle_orm_1 = require("drizzle-orm");
const schema_1 = require("../db/schema");
const utils_1 = require("../utils");
const roleColumns = {
    id: schema_1.roles.id,
    roleKey: schema_1.roles.roleKey,
    name: schema_1.roles.name,
    description: schema_1.roles.description,
    color: schema_1.roles.color,
    isSystem: schema_1.roles.isSystem,
    rankOrder: schema_1.roles.rankOrder,
    archivedAt: schema_1.roles.archivedAt,
    createdAt: schema_1.roles.createdAt,
};
class RolesRepo {
    db;
    constructor(db) {
        this.db = db;
    }
    /** Roles of a workspace, most powerful first. Archived excluded by default. */
    async listByWorkspace(workspaceId, opts = {}, exec = this.db) {
        const where = opts.includeArchived
            ? (0, drizzle_orm_1.eq)(schema_1.roles.workspaceId, workspaceId)
            : (0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.roles.workspaceId, workspaceId), (0, drizzle_orm_1.isNull)(schema_1.roles.archivedAt));
        return exec
            .select(roleColumns)
            .from(schema_1.roles)
            .where(where)
            .orderBy((0, drizzle_orm_1.asc)(schema_1.roles.rankOrder), (0, drizzle_orm_1.asc)(schema_1.roles.id));
    }
    /** One role, scoped to the workspace (null = not found / other tenant). */
    async findByIdInWorkspace(roleId, workspaceId, exec = this.db) {
        const rows = await exec
            .select(roleColumns)
            .from(schema_1.roles)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.roles.id, roleId), (0, drizzle_orm_1.eq)(schema_1.roles.workspaceId, workspaceId)))
            .limit(1);
        return rows[0] ?? null;
    }
    /** Lookup by the stable slug — how the seeded system roles are addressed. */
    async findByKeyInWorkspace(roleKey, workspaceId, exec = this.db) {
        const rows = await exec
            .select(roleColumns)
            .from(schema_1.roles)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.roles.roleKey, roleKey), (0, drizzle_orm_1.eq)(schema_1.roles.workspaceId, workspaceId)))
            .limit(1);
        return rows[0] ?? null;
    }
    async create(workspaceId, fields, exec = this.db) {
        const id = (0, utils_1.fakeId)("rol");
        await exec.insert(schema_1.roles).values({
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
    async update(roleId, fields, exec = this.db) {
        if (Object.keys(fields).length === 0)
            return;
        await exec.update(schema_1.roles).set(fields).where((0, drizzle_orm_1.eq)(schema_1.roles.id, roleId));
    }
    /** Hard delete. The service must first refuse system roles + reassign holders. */
    async deleteById(roleId, exec = this.db) {
        await exec.delete(schema_1.roles).where((0, drizzle_orm_1.eq)(schema_1.roles.id, roleId));
    }
    // ─── grants ──────────────────────────────────────────────────────────────
    async permissionsForRole(roleId, exec = this.db) {
        return exec
            .select({
            permissionKey: schema_1.rolePermissions.permissionKey,
            scope: schema_1.rolePermissions.scope,
        })
            .from(schema_1.rolePermissions)
            .where((0, drizzle_orm_1.eq)(schema_1.rolePermissions.roleId, roleId))
            .orderBy((0, drizzle_orm_1.asc)(schema_1.rolePermissions.permissionKey));
    }
    /**
     * REPLACE a role's whole grant set (the permission grid saves all at once).
     * Delete-then-insert inside the caller's transaction so a half-applied grid
     * can never be observed.
     */
    async replacePermissions(roleId, grants, exec = this.db) {
        await exec
            .delete(schema_1.rolePermissions)
            .where((0, drizzle_orm_1.eq)(schema_1.rolePermissions.roleId, roleId));
        if (grants.length === 0)
            return;
        await exec.insert(schema_1.rolePermissions).values(grants.map((g) => ({
            roleId,
            permissionKey: g.permissionKey,
            scope: g.scope,
        })));
    }
    /** How many people hold this role (any scope) — the reassignment guard. */
    async countHolders(roleId, exec = this.db) {
        const rows = await exec
            .select({ n: (0, drizzle_orm_1.sql) `COUNT(*)` })
            .from(schema_1.userRoleGrants)
            .where((0, drizzle_orm_1.eq)(schema_1.userRoleGrants.roleId, roleId));
        return Number(rows[0]?.n ?? 0);
    }
    /**
     * How many DISTINCT users currently hold a given permission anywhere in the
     * workspace. The anti-lockout guard (P23) uses this before removing
     * `role.manage` / `member.role_change` from the last role that grants it.
     */
    async countUsersWithPermission(workspaceId, permissionKey, exec = this.db) {
        const rows = await exec
            .select({ n: (0, drizzle_orm_1.sql) `COUNT(DISTINCT ${schema_1.userRoleGrants.userId})` })
            .from(schema_1.userRoleGrants)
            .innerJoin(schema_1.roles, (0, drizzle_orm_1.eq)(schema_1.roles.id, schema_1.userRoleGrants.roleId))
            .innerJoin(schema_1.rolePermissions, (0, drizzle_orm_1.eq)(schema_1.rolePermissions.roleId, schema_1.userRoleGrants.roleId))
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.userRoleGrants.workspaceId, workspaceId), (0, drizzle_orm_1.eq)(schema_1.rolePermissions.permissionKey, permissionKey), (0, drizzle_orm_1.isNull)(schema_1.roles.archivedAt)));
        return Number(rows[0]?.n ?? 0);
    }
    /** Same count, ignoring everyone who holds it only via `roleId`. */
    async countUsersWithPermissionExcludingRole(workspaceId, permissionKey, roleId, exec = this.db) {
        const rows = await exec
            .select({ n: (0, drizzle_orm_1.sql) `COUNT(DISTINCT ${schema_1.userRoleGrants.userId})` })
            .from(schema_1.userRoleGrants)
            .innerJoin(schema_1.roles, (0, drizzle_orm_1.eq)(schema_1.roles.id, schema_1.userRoleGrants.roleId))
            .innerJoin(schema_1.rolePermissions, (0, drizzle_orm_1.eq)(schema_1.rolePermissions.roleId, schema_1.userRoleGrants.roleId))
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.userRoleGrants.workspaceId, workspaceId), (0, drizzle_orm_1.eq)(schema_1.rolePermissions.permissionKey, permissionKey), (0, drizzle_orm_1.isNull)(schema_1.roles.archivedAt), (0, drizzle_orm_1.ne)(schema_1.userRoleGrants.roleId, roleId)));
        return Number(rows[0]?.n ?? 0);
    }
    /** Same count, ignoring one user — "is this the last administrator?". */
    async countUsersWithPermissionExcluding(workspaceId, permissionKey, userId, exec = this.db) {
        const rows = await exec
            .select({ n: (0, drizzle_orm_1.sql) `COUNT(DISTINCT ${schema_1.userRoleGrants.userId})` })
            .from(schema_1.userRoleGrants)
            .innerJoin(schema_1.roles, (0, drizzle_orm_1.eq)(schema_1.roles.id, schema_1.userRoleGrants.roleId))
            .innerJoin(schema_1.rolePermissions, (0, drizzle_orm_1.eq)(schema_1.rolePermissions.roleId, schema_1.userRoleGrants.roleId))
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.userRoleGrants.workspaceId, workspaceId), (0, drizzle_orm_1.eq)(schema_1.rolePermissions.permissionKey, permissionKey), (0, drizzle_orm_1.isNull)(schema_1.roles.archivedAt), (0, drizzle_orm_1.ne)(schema_1.userRoleGrants.userId, userId)));
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
    async bumpPermissionsVersion(workspaceId, exec = this.db) {
        await exec
            .update(schema_1.workspaces)
            .set({ permissionsVersion: (0, drizzle_orm_1.sql) `${schema_1.workspaces.permissionsVersion} + 1` })
            .where((0, drizzle_orm_1.eq)(schema_1.workspaces.id, workspaceId));
    }
    async getPermissionsVersion(workspaceId, exec = this.db) {
        const rows = await exec
            .select({ v: schema_1.workspaces.permissionsVersion })
            .from(schema_1.workspaces)
            .where((0, drizzle_orm_1.eq)(schema_1.workspaces.id, workspaceId))
            .limit(1);
        return Number(rows[0]?.v ?? 0);
    }
}
exports.RolesRepo = RolesRepo;
