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
import { sql } from "drizzle-orm";
import {
    boolean,
    check,
    foreignKey,
    index,
    int,
    mysqlEnum,
    mysqlTable,
    primaryKey,
    timestamp,
    uniqueIndex,
    varchar,
} from "drizzle-orm/mysql-core";
import {
    HEX_COLOR_LENGTH,
    ID_LENGTH,
    permissionScopes,
    roleScopeTypes,
} from "./_shared";
import { users, workspaces } from "./auth";
import { spaces } from "./hierarchy";

// ─── permissions ─ the catalog (reference data, synced from code) ─────────────
export const permissions = mysqlTable(
    "permissions",
    {
        permissionKey: varchar("permission_key", { length: 64 }).primaryKey(),
        groupKey: varchar("group_key", { length: 40 }).notNull(),
        label: varchar("label", { length: 120 }).notNull(),
        description: varchar("description", { length: 400 }).notNull(),
        /** CSV of the scopes an admin may pick, e.g. "all,space,own". */
        scopes: varchar("scopes", { length: 60 }).notNull(),
        isDangerous: boolean("is_dangerous").notNull().default(false),
        position: int("position", { unsigned: true }).notNull().default(0),
    },
    (t) => ({
        groupIdx: index("idx_permissions_group").on(t.groupKey, t.position),
    }),
);

// ─── roles ─ per-workspace, user-definable ────────────────────────────────────
export const roles = mysqlTable(
    "roles",
    {
        id: varchar("id", { length: ID_LENGTH }).primaryKey(),
        workspaceId: varchar("workspace_id", { length: ID_LENGTH }).notNull(),
        /** Stable slug, unique per workspace. System roles use owner/admin/member/guest. */
        roleKey: varchar("role_key", { length: 60 }).notNull(),
        name: varchar("name", { length: 80 }).notNull(),
        description: varchar("description", { length: 300 }),
        color: varchar("color", { length: HEX_COLOR_LENGTH })
            .notNull()
            .default("#6B7280"),
        /** Seeded roles: cannot be deleted; `owner` cannot be edited at all. */
        isSystem: boolean("is_system").notNull().default(false),
        /** Lower = more powerful (owner=0). Drives the escalation guard in P23. */
        rankOrder: int("rank_order", { unsigned: true }).notNull().default(100),
        createdBy: varchar("created_by", { length: ID_LENGTH }),
        archivedAt: timestamp("archived_at"),
        createdAt: timestamp("created_at").notNull().defaultNow(),
        updatedAt: timestamp("updated_at").notNull().defaultNow().onUpdateNow(),
    },
    (t) => ({
        workspaceKeyUq: uniqueIndex("uq_roles_workspace_key").on(
            t.workspaceId,
            t.roleKey,
        ),
        /** F27 (ISS-027): `role_key` was deduped by silently SUFFIXING it, so
         *  `role.key_taken` never fired and two roles could carry the same
         *  display name. The name is unique now; the key stays as it was. */
        workspaceNameUq: uniqueIndex("uq_roles_workspace_name").on(
            t.workspaceId,
            t.name,
        ),
        wsFk: foreignKey({
            columns: [t.workspaceId],
            foreignColumns: [workspaces.id],
            name: "fk_roles_ws",
        })
            .onDelete("cascade")
            .onUpdate("cascade"),
        createdByFk: foreignKey({
            columns: [t.createdBy],
            foreignColumns: [users.id],
            name: "fk_roles_created_by",
        })
            .onDelete("set null")
            .onUpdate("cascade"),
        colorCk: check(
            "ck_roles_color",
            sql`${t.color} REGEXP '^#[0-9A-Fa-f]{6}$'`,
        ),
        workspaceIdx: index("idx_roles_workspace").on(
            t.workspaceId,
            t.archivedAt,
            t.rankOrder,
        ),
    }),
);

// ─── role_permissions ─ what a role grants, at what scope ─────────────────────
export const rolePermissions = mysqlTable(
    "role_permissions",
    {
        roleId: varchar("role_id", { length: ID_LENGTH }).notNull(),
        permissionKey: varchar("permission_key", { length: 64 }).notNull(),
        scope: mysqlEnum("scope", permissionScopes).notNull().default("all"),
        createdAt: timestamp("created_at").notNull().defaultNow(),
    },
    (t) => ({
        pk: primaryKey({ columns: [t.roleId, t.permissionKey] }),
        roleFk: foreignKey({
            columns: [t.roleId],
            foreignColumns: [roles.id],
            name: "fk_role_permissions_role",
        })
            .onDelete("cascade")
            .onUpdate("cascade"),
        // RESTRICT: a catalog key that roles still reference must not vanish —
        // the boot-time sync (P4) adds keys, it never silently drops granted ones.
        permFk: foreignKey({
            columns: [t.permissionKey],
            foreignColumns: [permissions.permissionKey],
            name: "fk_role_permissions_perm",
        })
            .onDelete("restrict")
            .onUpdate("cascade"),
        permIdx: index("idx_role_permissions_perm").on(t.permissionKey),
    }),
);

// ─── user_roles ─ assignments AND space membership ────────────────────────────
export const userRoleGrants = mysqlTable(
    "user_roles",
    {
        id: varchar("id", { length: ID_LENGTH }).primaryKey(),
        workspaceId: varchar("workspace_id", { length: ID_LENGTH }).notNull(),
        userId: varchar("user_id", { length: ID_LENGTH }).notNull(),
        roleId: varchar("role_id", { length: ID_LENGTH }).notNull(),
        scopeType: mysqlEnum("scope_type", roleScopeTypes)
            .notNull()
            .default("workspace"),
        /** spaces.id when scope_type='space'; NULL for workspace-wide grants. */
        scopeId: varchar("scope_id", { length: ID_LENGTH }),
        grantedBy: varchar("granted_by", { length: ID_LENGTH }),
        createdAt: timestamp("created_at").notNull().defaultNow(),
    },
    (t) => ({
        wsFk: foreignKey({
            columns: [t.workspaceId],
            foreignColumns: [workspaces.id],
            name: "fk_user_roles_ws",
        })
            .onDelete("cascade")
            .onUpdate("cascade"),
        userFk: foreignKey({
            columns: [t.userId],
            foreignColumns: [users.id],
            name: "fk_user_roles_user",
        })
            .onDelete("cascade")
            .onUpdate("cascade"),
        roleFk: foreignKey({
            columns: [t.roleId],
            foreignColumns: [roles.id],
            name: "fk_user_roles_role",
        })
            .onDelete("cascade")
            .onUpdate("cascade"),
        // A deleted space takes its space-scoped grants with it.
        spaceFk: foreignKey({
            columns: [t.scopeId],
            foreignColumns: [spaces.id],
            name: "fk_user_roles_space",
        })
            .onDelete("cascade")
            .onUpdate("cascade"),
        grantedByFk: foreignKey({
            columns: [t.grantedBy],
            foreignColumns: [users.id],
            name: "fk_user_roles_granted_by",
        })
            .onDelete("set null")
            .onUpdate("cascade"),
        // The hot lookup: "every grant this user holds" (P6 actor resolution).
        userIdx: index("idx_user_roles_user").on(t.userId, t.scopeType),
        // "who is in this space" (P24/P27 membership panel).
        scopeIdx: index("idx_user_roles_scope").on(t.scopeId),
        roleIdx: index("idx_user_roles_role").on(t.roleId),
    }),
);

// ─── space_visibility_grants ─ "team A can also SEE team B" (P4) ──────────────
// Mirrors `database/schema.sql §42` 1:1. Consumed at actor-fold time
// (PolicyService): a space-scoped `space.view` entry gains the granted
// targets, so every read follows through the one visibility choke point.
// Single hop by design; `viewer <> target` is enforced app-side (MySQL 8
// forbids a CHECK on columns used in cascading FKs).
export const spaceVisibilityGrants = mysqlTable(
    "space_visibility_grants",
    {
        id: varchar("id", { length: ID_LENGTH }).primaryKey(),
        workspaceId: varchar("workspace_id", { length: ID_LENGTH })
            .notNull()
            .references(() => workspaces.id, {
                onDelete: "cascade",
                onUpdate: "cascade",
            }),
        /** The team that GAINS sight. */
        viewerSpaceId: varchar("viewer_space_id", { length: ID_LENGTH })
            .notNull(),
        /** The team that becomes visible to it. */
        targetSpaceId: varchar("target_space_id", { length: ID_LENGTH })
            .notNull(),
        grantedBy: varchar("granted_by", { length: ID_LENGTH }),
        createdAt: timestamp("created_at").notNull().defaultNow(),
    },
    (t) => ({
        pairUq: uniqueIndex("uq_svg_pair").on(
            t.viewerSpaceId,
            t.targetSpaceId,
        ),
        viewerFk: foreignKey({
            columns: [t.viewerSpaceId],
            foreignColumns: [spaces.id],
            name: "fk_svg_viewer",
        })
            .onDelete("cascade")
            .onUpdate("cascade"),
        targetFk: foreignKey({
            columns: [t.targetSpaceId],
            foreignColumns: [spaces.id],
            name: "fk_svg_target",
        })
            .onDelete("cascade")
            .onUpdate("cascade"),
        grantedByFk: foreignKey({
            columns: [t.grantedBy],
            foreignColumns: [users.id],
            name: "fk_svg_granted_by",
        })
            .onDelete("set null")
            .onUpdate("cascade"),
        workspaceIdx: index("idx_svg_workspace").on(t.workspaceId),
        targetIdx: index("idx_svg_target").on(t.targetSpaceId),
    }),
);

export type Permission = typeof permissions.$inferSelect;
export type NewPermission = typeof permissions.$inferInsert;
export type Role = typeof roles.$inferSelect;
export type NewRole = typeof roles.$inferInsert;
export type RolePermission = typeof rolePermissions.$inferSelect;
export type NewRolePermission = typeof rolePermissions.$inferInsert;
export type UserRoleGrant = typeof userRoleGrants.$inferSelect;
export type NewUserRoleGrant = typeof userRoleGrants.$inferInsert;
export type SpaceVisibilityGrant = typeof spaceVisibilityGrants.$inferSelect;
export type NewSpaceVisibilityGrant =
    typeof spaceVisibilityGrants.$inferInsert;
