"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.userRoleGrants = exports.rolePermissions = exports.roles = exports.permissions = void 0;
// =============================================================================
// Dynamic RBAC — permissions, roles, role_permissions, user_roles (4 tables)
//   Mirrors `database/schema.sql §38-41` 1:1.
//   Plan: RBAC_DYNAMIC_PLAN.md Part 2.2 · Build log: RBAC_BUILD_LOG.md P2
//
// MODEL
//   permissions       — the CATALOG. Reference data, synced from
//                       `src/rbac/catalog.ts` on boot (P4). Never user-editable.
//   roles             — per-workspace, USER-DEFINABLE. Four are seeded as
//                       `is_system` (owner/admin/member/guest) reproducing
//                       today's behaviour exactly (P3); admins add their own.
//   role_permissions  — which permissions a role grants, and at what SCOPE
//                       ('all' | 'space' | 'own'). Absence of a row = not
//                       granted; there is no explicit deny (plan D-4).
//   user_roles        — assignments. `scope_type='workspace'` applies
//                       everywhere; `scope_type='space'` applies inside one
//                       space — and holding ANY space-scoped role IS that
//                       user's membership of the space (plan D-1/D-2).
//
// NAMING NOTES (deliberate, not stylistic drift)
//   · `permission_key`, not `key`   — `KEY` is a MySQL reserved word.
//   · `role_key`,       not `key`   — same reason, and keeps the two readable.
//   · `rank_order`,     not `rank`  — `RANK` is reserved in MySQL 8 (window fn).
//
// The `user_roles.scope_key` VIRTUAL generated column exists ONLY to make the
// grant UNIQUE key NULL-safe: MySQL treats NULLs as distinct, so a unique key
// over a nullable `scope_id` would happily allow the same workspace-wide grant
// twice. It is never read or written by the app, so it is intentionally NOT
// modelled here (Drizzle builds explicit column lists, so it stays invisible).
// It must be VIRTUAL: MySQL rejects an ON UPDATE CASCADE foreign key on a base
// column of a STORED generated column (error 1215), and `scope_id` is both the
// FK to `spaces` and this expression's base — verified against MySQL 8.0.43.
// =============================================================================
const drizzle_orm_1 = require("drizzle-orm");
const mysql_core_1 = require("drizzle-orm/mysql-core");
const _shared_1 = require("./_shared");
const auth_1 = require("./auth");
const hierarchy_1 = require("./hierarchy");
// ─── permissions ─ the catalog (reference data, synced from code) ─────────────
exports.permissions = (0, mysql_core_1.mysqlTable)("permissions", {
    permissionKey: (0, mysql_core_1.varchar)("permission_key", { length: 64 }).primaryKey(),
    groupKey: (0, mysql_core_1.varchar)("group_key", { length: 40 }).notNull(),
    label: (0, mysql_core_1.varchar)("label", { length: 120 }).notNull(),
    description: (0, mysql_core_1.varchar)("description", { length: 400 }).notNull(),
    /** CSV of the scopes an admin may pick, e.g. "all,space,own". */
    scopes: (0, mysql_core_1.varchar)("scopes", { length: 60 }).notNull(),
    isDangerous: (0, mysql_core_1.boolean)("is_dangerous").notNull().default(false),
    position: (0, mysql_core_1.int)("position", { unsigned: true }).notNull().default(0),
}, (t) => ({
    groupIdx: (0, mysql_core_1.index)("idx_permissions_group").on(t.groupKey, t.position),
}));
// ─── roles ─ per-workspace, user-definable ────────────────────────────────────
exports.roles = (0, mysql_core_1.mysqlTable)("roles", {
    id: (0, mysql_core_1.varchar)("id", { length: _shared_1.ID_LENGTH }).primaryKey(),
    workspaceId: (0, mysql_core_1.varchar)("workspace_id", { length: _shared_1.ID_LENGTH }).notNull(),
    /** Stable slug, unique per workspace. System roles use owner/admin/member/guest. */
    roleKey: (0, mysql_core_1.varchar)("role_key", { length: 60 }).notNull(),
    name: (0, mysql_core_1.varchar)("name", { length: 80 }).notNull(),
    description: (0, mysql_core_1.varchar)("description", { length: 300 }),
    color: (0, mysql_core_1.varchar)("color", { length: _shared_1.HEX_COLOR_LENGTH })
        .notNull()
        .default("#6B7280"),
    /** Seeded roles: cannot be deleted; `owner` cannot be edited at all. */
    isSystem: (0, mysql_core_1.boolean)("is_system").notNull().default(false),
    /** Lower = more powerful (owner=0). Drives the escalation guard in P23. */
    rankOrder: (0, mysql_core_1.int)("rank_order", { unsigned: true }).notNull().default(100),
    createdBy: (0, mysql_core_1.varchar)("created_by", { length: _shared_1.ID_LENGTH }),
    archivedAt: (0, mysql_core_1.timestamp)("archived_at"),
    createdAt: (0, mysql_core_1.timestamp)("created_at").notNull().defaultNow(),
    updatedAt: (0, mysql_core_1.timestamp)("updated_at").notNull().defaultNow().onUpdateNow(),
}, (t) => ({
    workspaceKeyUq: (0, mysql_core_1.uniqueIndex)("uq_roles_workspace_key").on(t.workspaceId, t.roleKey),
    wsFk: (0, mysql_core_1.foreignKey)({
        columns: [t.workspaceId],
        foreignColumns: [auth_1.workspaces.id],
        name: "fk_roles_ws",
    })
        .onDelete("cascade")
        .onUpdate("cascade"),
    createdByFk: (0, mysql_core_1.foreignKey)({
        columns: [t.createdBy],
        foreignColumns: [auth_1.users.id],
        name: "fk_roles_created_by",
    })
        .onDelete("set null")
        .onUpdate("cascade"),
    colorCk: (0, mysql_core_1.check)("ck_roles_color", (0, drizzle_orm_1.sql) `${t.color} REGEXP '^#[0-9A-Fa-f]{6}$'`),
    workspaceIdx: (0, mysql_core_1.index)("idx_roles_workspace").on(t.workspaceId, t.archivedAt, t.rankOrder),
}));
// ─── role_permissions ─ what a role grants, at what scope ─────────────────────
exports.rolePermissions = (0, mysql_core_1.mysqlTable)("role_permissions", {
    roleId: (0, mysql_core_1.varchar)("role_id", { length: _shared_1.ID_LENGTH }).notNull(),
    permissionKey: (0, mysql_core_1.varchar)("permission_key", { length: 64 }).notNull(),
    scope: (0, mysql_core_1.mysqlEnum)("scope", _shared_1.permissionScopes).notNull().default("all"),
    createdAt: (0, mysql_core_1.timestamp)("created_at").notNull().defaultNow(),
}, (t) => ({
    pk: (0, mysql_core_1.primaryKey)({ columns: [t.roleId, t.permissionKey] }),
    roleFk: (0, mysql_core_1.foreignKey)({
        columns: [t.roleId],
        foreignColumns: [exports.roles.id],
        name: "fk_role_permissions_role",
    })
        .onDelete("cascade")
        .onUpdate("cascade"),
    // RESTRICT: a catalog key that roles still reference must not vanish —
    // the boot-time sync (P4) adds keys, it never silently drops granted ones.
    permFk: (0, mysql_core_1.foreignKey)({
        columns: [t.permissionKey],
        foreignColumns: [exports.permissions.permissionKey],
        name: "fk_role_permissions_perm",
    })
        .onDelete("restrict")
        .onUpdate("cascade"),
    permIdx: (0, mysql_core_1.index)("idx_role_permissions_perm").on(t.permissionKey),
}));
// ─── user_roles ─ assignments AND space membership ────────────────────────────
exports.userRoleGrants = (0, mysql_core_1.mysqlTable)("user_roles", {
    id: (0, mysql_core_1.varchar)("id", { length: _shared_1.ID_LENGTH }).primaryKey(),
    workspaceId: (0, mysql_core_1.varchar)("workspace_id", { length: _shared_1.ID_LENGTH }).notNull(),
    userId: (0, mysql_core_1.varchar)("user_id", { length: _shared_1.ID_LENGTH }).notNull(),
    roleId: (0, mysql_core_1.varchar)("role_id", { length: _shared_1.ID_LENGTH }).notNull(),
    scopeType: (0, mysql_core_1.mysqlEnum)("scope_type", _shared_1.roleScopeTypes)
        .notNull()
        .default("workspace"),
    /** spaces.id when scope_type='space'; NULL for workspace-wide grants. */
    scopeId: (0, mysql_core_1.varchar)("scope_id", { length: _shared_1.ID_LENGTH }),
    grantedBy: (0, mysql_core_1.varchar)("granted_by", { length: _shared_1.ID_LENGTH }),
    createdAt: (0, mysql_core_1.timestamp)("created_at").notNull().defaultNow(),
}, (t) => ({
    wsFk: (0, mysql_core_1.foreignKey)({
        columns: [t.workspaceId],
        foreignColumns: [auth_1.workspaces.id],
        name: "fk_user_roles_ws",
    })
        .onDelete("cascade")
        .onUpdate("cascade"),
    userFk: (0, mysql_core_1.foreignKey)({
        columns: [t.userId],
        foreignColumns: [auth_1.users.id],
        name: "fk_user_roles_user",
    })
        .onDelete("cascade")
        .onUpdate("cascade"),
    roleFk: (0, mysql_core_1.foreignKey)({
        columns: [t.roleId],
        foreignColumns: [exports.roles.id],
        name: "fk_user_roles_role",
    })
        .onDelete("cascade")
        .onUpdate("cascade"),
    // A deleted space takes its space-scoped grants with it.
    spaceFk: (0, mysql_core_1.foreignKey)({
        columns: [t.scopeId],
        foreignColumns: [hierarchy_1.spaces.id],
        name: "fk_user_roles_space",
    })
        .onDelete("cascade")
        .onUpdate("cascade"),
    grantedByFk: (0, mysql_core_1.foreignKey)({
        columns: [t.grantedBy],
        foreignColumns: [auth_1.users.id],
        name: "fk_user_roles_granted_by",
    })
        .onDelete("set null")
        .onUpdate("cascade"),
    // The hot lookup: "every grant this user holds" (P6 actor resolution).
    userIdx: (0, mysql_core_1.index)("idx_user_roles_user").on(t.userId, t.scopeType),
    // "who is in this space" (P24/P27 membership panel).
    scopeIdx: (0, mysql_core_1.index)("idx_user_roles_scope").on(t.scopeId),
    roleIdx: (0, mysql_core_1.index)("idx_user_roles_role").on(t.roleId),
}));
