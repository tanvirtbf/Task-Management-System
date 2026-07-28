"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.UserRolesRepo = void 0;
const drizzle_orm_1 = require("drizzle-orm");
const schema_1 = require("../db/schema");
const utils_1 = require("../utils");
class UserRolesRepo {
    db;
    constructor(db) {
        this.db = db;
    }
    /**
     * One indexed lookup returning the user's legacy role + status and the
     * workspace's `permissions_version`. This is the ONLY query a cache HIT
     * costs, so it is deliberately a single PK-join.
     *
     * Returns null when the user does not exist in that workspace (which the
     * caller turns into "no permissions", never into an error).
     */
    async getActorContext(userId, workspaceId, exec = this.db) {
        const rows = await exec
            .select({
            legacyRole: schema_1.users.role,
            status: schema_1.users.status,
            permissionsVersion: schema_1.workspaces.permissionsVersion,
        })
            .from(schema_1.users)
            .innerJoin(schema_1.workspaces, (0, drizzle_orm_1.eq)(schema_1.workspaces.id, schema_1.users.workspaceId))
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.users.id, userId), (0, drizzle_orm_1.eq)(schema_1.users.workspaceId, workspaceId)))
            .limit(1);
        const row = rows[0];
        if (!row)
            return null;
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
    async listEffectiveGrants(userId, workspaceId, exec = this.db) {
        return exec
            .select({
            permissionKey: schema_1.rolePermissions.permissionKey,
            grantScope: schema_1.rolePermissions.scope,
            assignmentScopeType: schema_1.userRoleGrants.scopeType,
            assignmentScopeId: schema_1.userRoleGrants.scopeId,
        })
            .from(schema_1.userRoleGrants)
            .innerJoin(schema_1.roles, (0, drizzle_orm_1.eq)(schema_1.roles.id, schema_1.userRoleGrants.roleId))
            .innerJoin(schema_1.rolePermissions, (0, drizzle_orm_1.eq)(schema_1.rolePermissions.roleId, schema_1.userRoleGrants.roleId))
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.userRoleGrants.userId, userId), (0, drizzle_orm_1.eq)(schema_1.userRoleGrants.workspaceId, workspaceId), (0, drizzle_orm_1.isNull)(schema_1.roles.archivedAt)));
    }
    /** A user's assignments (for the profile / members UI). */
    async listForUser(userId, workspaceId, exec = this.db) {
        return exec
            .select({
            id: schema_1.userRoleGrants.id,
            userId: schema_1.userRoleGrants.userId,
            roleId: schema_1.userRoleGrants.roleId,
            roleKey: schema_1.roles.roleKey,
            roleName: schema_1.roles.name,
            scopeType: schema_1.userRoleGrants.scopeType,
            scopeId: schema_1.userRoleGrants.scopeId,
            createdAt: schema_1.userRoleGrants.createdAt,
        })
            .from(schema_1.userRoleGrants)
            .innerJoin(schema_1.roles, (0, drizzle_orm_1.eq)(schema_1.roles.id, schema_1.userRoleGrants.roleId))
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.userRoleGrants.userId, userId), (0, drizzle_orm_1.eq)(schema_1.userRoleGrants.workspaceId, workspaceId)))
            .orderBy((0, drizzle_orm_1.asc)(schema_1.roles.rankOrder), (0, drizzle_orm_1.asc)(schema_1.userRoleGrants.createdAt));
    }
    /** Everyone assigned inside one space — the space-members panel (P27). */
    async listBySpace(spaceId, workspaceId, exec = this.db) {
        return exec
            .select({
            id: schema_1.userRoleGrants.id,
            userId: schema_1.userRoleGrants.userId,
            roleId: schema_1.userRoleGrants.roleId,
            roleKey: schema_1.roles.roleKey,
            roleName: schema_1.roles.name,
            scopeType: schema_1.userRoleGrants.scopeType,
            scopeId: schema_1.userRoleGrants.scopeId,
            createdAt: schema_1.userRoleGrants.createdAt,
        })
            .from(schema_1.userRoleGrants)
            .innerJoin(schema_1.roles, (0, drizzle_orm_1.eq)(schema_1.roles.id, schema_1.userRoleGrants.roleId))
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.userRoleGrants.scopeId, spaceId), (0, drizzle_orm_1.eq)(schema_1.userRoleGrants.workspaceId, workspaceId), (0, drizzle_orm_1.eq)(schema_1.userRoleGrants.scopeType, "space")))
            .orderBy((0, drizzle_orm_1.asc)(schema_1.roles.rankOrder), (0, drizzle_orm_1.asc)(schema_1.userRoleGrants.createdAt));
    }
    /** Everyone holding one role, anywhere — the "who has this?" panel. */
    async listByRole(roleId, workspaceId, exec = this.db) {
        return exec
            .select({
            id: schema_1.userRoleGrants.id,
            userId: schema_1.userRoleGrants.userId,
            roleId: schema_1.userRoleGrants.roleId,
            roleKey: schema_1.roles.roleKey,
            roleName: schema_1.roles.name,
            scopeType: schema_1.userRoleGrants.scopeType,
            scopeId: schema_1.userRoleGrants.scopeId,
            createdAt: schema_1.userRoleGrants.createdAt,
        })
            .from(schema_1.userRoleGrants)
            .innerJoin(schema_1.roles, (0, drizzle_orm_1.eq)(schema_1.roles.id, schema_1.userRoleGrants.roleId))
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.userRoleGrants.roleId, roleId), (0, drizzle_orm_1.eq)(schema_1.userRoleGrants.workspaceId, workspaceId)))
            .orderBy((0, drizzle_orm_1.asc)(schema_1.userRoleGrants.createdAt));
    }
    /**
     * Grant a role. Idempotent: the `uq_user_roles_grant` unique key (which is
     * NULL-safe via the generated `scope_key`) absorbs a repeat, so callers do
     * not have to check first. Returns the new row's id (or the existing one).
     */
    async assign(input, exec = this.db) {
        const id = (0, utils_1.fakeId)("urol");
        await exec
            .insert(schema_1.userRoleGrants)
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
            set: { scopeType: (0, drizzle_orm_1.sql) `VALUES(scope_type)` },
        });
        const existing = await exec
            .select({ id: schema_1.userRoleGrants.id })
            .from(schema_1.userRoleGrants)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.userRoleGrants.userId, input.userId), (0, drizzle_orm_1.eq)(schema_1.userRoleGrants.roleId, input.roleId), (0, drizzle_orm_1.eq)(schema_1.userRoleGrants.scopeType, input.scopeType), input.scopeId
            ? (0, drizzle_orm_1.eq)(schema_1.userRoleGrants.scopeId, input.scopeId)
            : (0, drizzle_orm_1.isNull)(schema_1.userRoleGrants.scopeId)))
            .limit(1);
        return existing[0]?.id ?? id;
    }
    /** Remove one assignment by id, scoped to the workspace. */
    async revokeById(assignmentId, workspaceId, exec = this.db) {
        await exec
            .delete(schema_1.userRoleGrants)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.userRoleGrants.id, assignmentId), (0, drizzle_orm_1.eq)(schema_1.userRoleGrants.workspaceId, workspaceId)));
    }
    /** Remove a specific (user, role, scope) grant. */
    async revoke(input, exec = this.db) {
        await exec
            .delete(schema_1.userRoleGrants)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.userRoleGrants.workspaceId, input.workspaceId), (0, drizzle_orm_1.eq)(schema_1.userRoleGrants.userId, input.userId), (0, drizzle_orm_1.eq)(schema_1.userRoleGrants.roleId, input.roleId), (0, drizzle_orm_1.eq)(schema_1.userRoleGrants.scopeType, input.scopeType), input.scopeId
            ? (0, drizzle_orm_1.eq)(schema_1.userRoleGrants.scopeId, input.scopeId)
            : (0, drizzle_orm_1.isNull)(schema_1.userRoleGrants.scopeId)));
    }
    /** Drop every assignment a user holds (used when deactivating, P24). */
    async revokeAllForUser(userId, workspaceId, exec = this.db) {
        await exec
            .delete(schema_1.userRoleGrants)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.userRoleGrants.userId, userId), (0, drizzle_orm_1.eq)(schema_1.userRoleGrants.workspaceId, workspaceId)));
    }
    /**
     * Does the workspace row exist at all? One PK lookup, used only on the
     * error path where a JWT names a workspace we could not resolve an actor
     * in — it decides between "the workspace is gone" (let the handler 404, as
     * it did before RBAC) and "you are not in it" (403).
     */
    async workspaceExists(workspaceId, exec = this.db) {
        const rows = await exec
            .select({ id: schema_1.workspaces.id })
            .from(schema_1.workspaces)
            .where((0, drizzle_orm_1.eq)(schema_1.workspaces.id, workspaceId))
            .limit(1);
        return rows.length > 0;
    }
    /** Space ids where this user holds ANY role — their membership set. */
    async spaceIdsForUser(userId, workspaceId, exec = this.db) {
        const rows = await exec
            .selectDistinct({ spaceId: schema_1.userRoleGrants.scopeId })
            .from(schema_1.userRoleGrants)
            .innerJoin(schema_1.roles, (0, drizzle_orm_1.eq)(schema_1.roles.id, schema_1.userRoleGrants.roleId))
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.userRoleGrants.userId, userId), (0, drizzle_orm_1.eq)(schema_1.userRoleGrants.workspaceId, workspaceId), (0, drizzle_orm_1.eq)(schema_1.userRoleGrants.scopeType, "space"), (0, drizzle_orm_1.isNull)(schema_1.roles.archivedAt)));
        return rows
            .map((r) => r.spaceId)
            .filter((s) => s !== null);
    }
}
exports.UserRolesRepo = UserRolesRepo;
