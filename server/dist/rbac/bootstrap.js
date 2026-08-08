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
exports.syncUserSystemRole = exports.bootstrapRbac = exports.backfillSpaceMembership = exports.backfillUserRoles = exports.seedSystemRoles = exports.syncPermissionCatalog = exports.SYSTEM_ROLE_GRANTS = exports.SYSTEM_ROLES = void 0;
// =============================================================================
// RBAC BOOTSTRAP — the permission catalog sync + the four SYSTEM ROLES.
//   Plan: RBAC_DYNAMIC_PLAN.md P3 · Contract: RBAC_BUILD_LOG.md §0.4
//
// ⚠️ THE CONTRACT THIS FILE IMPLEMENTS
// The seeded roles must reproduce the PRE-RBAC behaviour exactly, so that
// turning the system on changes nothing until an admin tightens it ("dormant
// until configured", plan D-8). Concretely:
//
//   · every seeded grant is scope `all` — because today every capability is
//     workspace-wide;
//   · the four roles mirror the old `users.role` enum 1:1;
//   · the finer IN-SERVICE rules that exist today (head-of-space, snapshot
//     head, comment author, attachment uploader, self-profile, 15-minute edit
//     window, owner immutability) are NOT replaced by permissions. They stay
//     exactly where they are and act as ADDITIONAL allow-paths. A permission
//     grant is therefore always additive, never a narrowing.
//
// That is what makes P11–P15 mechanical: `canAccess([OWNER, ADMIN])` becomes
// `requirePermission('x')` where owner+admin already hold `x`.
//
// ── SCOPE SEMANTICS (defined here, implemented by the resolver in P6) ────────
// A user's effective grant is the combination of the ROLE's declared scope and
// the ASSIGNMENT's scope. A space-scoped assignment can never reach outside its
// space — that is the escalation guard:
//
//   assignment=workspace + grant 'all'    → everywhere
//   assignment=workspace + grant 'space'  → no spaces (an explicit assignment
//                                            is what "space" means; the admin
//                                            UI warns about this combination)
//   assignment=workspace + grant 'own'    → own items, anywhere
//   assignment=space(S)  + grant 'all'    → DOWNGRADED to space {S}
//   assignment=space(S)  + grant 'space'  → space {S}
//   assignment=space(S)  + grant 'own'    → own items within {S}
//
// Because every seeded grant is `all` and every backfilled system assignment is
// workspace-wide, the seed resolves to "everything, everywhere" for everyone —
// i.e. today.
// =============================================================================
const drizzle_orm_1 = require("drizzle-orm");
const schema = __importStar(require("../db/schema"));
const utils_1 = require("../utils");
const catalog_1 = require("./catalog");
exports.SYSTEM_ROLES = [
    {
        key: "owner",
        name: "Owner",
        description: "The workspace founder. Always has every permission and can never be locked out.",
        color: "#7C3AED",
        rankOrder: 0,
    },
    {
        key: "admin",
        name: "Admin",
        description: "Runs the workspace: people, spaces, lists, settings and the catalog.",
        color: "#4F46E5",
        rankOrder: 10,
    },
    {
        key: "member",
        name: "Member",
        description: "Everyday teammate. Creates and works on tasks.",
        color: "#10B981",
        rankOrder: 50,
    },
    {
        key: "guest",
        name: "Guest",
        description: "External collaborator. Reads the workspace, comments, and reports bugs.",
        color: "#94A3B8",
        rankOrder: 90,
    },
];
/**
 * What ANY authenticated user could do BEFORE RBAC was enforced (verified
 * against §0.4). This is the **member** baseline: members get this list plus
 * `attachment.upload`.
 *
 * ⚠️ Guests no longer receive it. Until F28 they did, and the role's own
 * description said so — *"Same as a member today, except uploading files"*. That
 * was a faithful copy of a product with no guest concept, and while the toggles
 * were dormant it cost nothing. F7 made all 56 real, and the faithfulness became
 * a hole: a guest could delete any task in the workspace and read every
 * public-form submission. See `GUEST_GRANTS` and D12.1 in `fixing/DECISIONS.md`.
 */
const EVERYONE = [
    // read the whole workspace
    "space.view",
    "task.view",
    "member.view",
    "activity.view",
    "assistant.use",
    "form.view_submissions",
    // work on tasks
    "task.create",
    "task.edit",
    "task.assign",
    "task.archive",
    "task.delete",
    "comment.create",
    "checklist.manage",
    "dependency.manage",
    "customfield.set_value",
    "template.apply",
    // engineering surfaces that are open to all today
    "sprint.assign_tasks",
    "bug.report",
    "postmortem.manage",
];
/** Member = the pre-RBAC baseline + file upload. */
const MEMBER_EXTRA = ["attachment.upload"];
/**
 * A guest is an **external collaborator**: read the workspace, join the
 * conversation, report a bug. No writes to tasks, checklists, dependencies,
 * custom-field values or templates; no engineering writes; and specifically
 * **not** `form.view_submissions`, which returns the contact details customers
 * typed into a public form.
 *
 * Deliberately **not** derived from `EVERYONE` by subtraction. A subset
 * expressed as a filter re-widens silently the day somebody appends a key to the
 * baseline — which is exactly how this role acquired nineteen grants. This list
 * is the whole grant, and the snapshot test pins it. (D12.1)
 */
const GUEST_GRANTS = [
    // read the workspace
    "space.view",
    "task.view",
    "member.view",
    "activity.view",
    // take part
    "comment.create",
    "assistant.use",
    "bug.report",
];
/** Everything the `canAccess([OWNER, ADMIN])` gates protect today. */
const ADMIN_EXTRA = [
    // destructive / elevated task powers
    "task.delete_hard",
    "task.sla_override",
    "comment.delete_any",
    "attachment.delete_any",
    // structure
    "space.create",
    "space.edit",
    "space.archive",
    "space.head_assign",
    "space.members_manage",
    "list.create",
    "list.edit",
    "list.archive",
    "status.manage",
    // catalog + forms
    "catalog.task_types",
    "catalog.tags",
    "catalog.custom_fields",
    "catalog.templates",
    "form.manage",
    // people + workspace
    "member.invite",
    "member.role_change",
    "member.deactivate",
    "member.reset_password",
    "member.edit_profile",
    "workspace.settings",
    // engineering admin
    "sprint.manage",
    "oncall.manage",
    // department review (today: admins bypass the head check)
    "review.perform",
    "review.read",
    "report.view",
    "report.generate",
    "report.ack",
    // the new capability this feature introduces — it has to live somewhere
    "role.manage",
    "role.assign",
];
/** Owner-only today: `DELETE /spaces/:id` and `DELETE /lists/:id`. */
const OWNER_EXTRA = ["space.delete", "list.delete"];
/**
 * `report.note` is granted ONLY to the owner.
 *
 * Today the head note is snapshot-head-only — even an admin is refused (403
 * `report.forbidden`). That in-service rule stays, so admins/members/guests are
 * unaffected. The owner receives it because D-7 defines the owner as holding
 * every permission (the anti-lockout floor), which means the owner may now also
 * write a head note. This is the ONE intentional, non-destructive widening in
 * the seeded default, and it applies to exactly one account.
 */
const OWNER_ONLY_EXTRA = ["report.note"];
const MEMBER_GRANTS = [...EVERYONE, ...MEMBER_EXTRA];
const ADMIN_GRANTS = [...MEMBER_GRANTS, ...ADMIN_EXTRA];
const OWNER_GRANTS = [...ADMIN_GRANTS, ...OWNER_EXTRA, ...OWNER_ONLY_EXTRA];
/**
 * roleKey → the permission keys it grants. Every grant is scope `all` (see the
 * contract at the top of this file). Pinned by a snapshot test.
 */
exports.SYSTEM_ROLE_GRANTS = {
    owner: OWNER_GRANTS,
    admin: ADMIN_GRANTS,
    member: MEMBER_GRANTS,
    guest: [...GUEST_GRANTS],
};
// ─── 1. catalog sync ──────────────────────────────────────────────────────────
/**
 * Upsert every catalog entry into `permissions`. Idempotent, and safe to run on
 * every boot: rows are reference data, so labels/descriptions/scopes are
 * refreshed from code while `role_permissions` rows (which reference the key)
 * are untouched. Keys are never deleted here — the FK is RESTRICT precisely so
 * a key someone has granted cannot silently vanish.
 */
const syncPermissionCatalog = async (db) => {
    if (catalog_1.PERMISSIONS.length === 0)
        return 0;
    const rows = catalog_1.PERMISSIONS.map((p, i) => ({
        permissionKey: p.key,
        groupKey: p.group,
        label: p.label,
        description: p.description,
        scopes: p.scopes.join(","),
        isDangerous: p.dangerous ?? false,
        position: i,
    }));
    await db
        .insert(schema.permissions)
        .values(rows)
        .onDuplicateKeyUpdate({
        set: {
            groupKey: (0, drizzle_orm_1.sql) `VALUES(group_key)`,
            label: (0, drizzle_orm_1.sql) `VALUES(label)`,
            description: (0, drizzle_orm_1.sql) `VALUES(description)`,
            scopes: (0, drizzle_orm_1.sql) `VALUES(scopes)`,
            isDangerous: (0, drizzle_orm_1.sql) `VALUES(is_dangerous)`,
            position: (0, drizzle_orm_1.sql) `VALUES(position)`,
        },
    });
    return rows.length;
};
exports.syncPermissionCatalog = syncPermissionCatalog;
// ─── 2. system roles ──────────────────────────────────────────────────────────
/**
 * Create the four system roles for a workspace and (re)apply their grants.
 * Idempotent: existing roles keep their id, and grants are re-asserted so a
 * half-applied seed self-heals. An admin's OWN edits to a system role's grants
 * are NOT preserved by a re-run — that is deliberate for a repair operation and
 * it never runs automatically after the first bootstrap (see `bootstrapRbac`).
 */
const seedSystemRoles = async (db, workspaceId) => {
    const idByKey = {};
    for (const def of exports.SYSTEM_ROLES) {
        const existing = await db
            .select({ id: schema.roles.id })
            .from(schema.roles)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema.roles.workspaceId, workspaceId), (0, drizzle_orm_1.eq)(schema.roles.roleKey, def.key)))
            .limit(1);
        let roleId = existing[0]?.id;
        if (!roleId) {
            roleId = (0, utils_1.fakeId)("rol");
            await db.insert(schema.roles).values({
                id: roleId,
                workspaceId,
                roleKey: def.key,
                name: def.name,
                description: def.description,
                color: def.color,
                isSystem: true,
                rankOrder: def.rankOrder,
            });
        }
        idByKey[def.key] = roleId;
        const keys = exports.SYSTEM_ROLE_GRANTS[def.key] ?? [];
        if (keys.length > 0) {
            await db
                .insert(schema.rolePermissions)
                .values(keys.map((permissionKey) => ({
                roleId,
                permissionKey,
                scope: "all",
            })))
                .onDuplicateKeyUpdate({ set: { scope: (0, drizzle_orm_1.sql) `VALUES(scope)` } });
        }
    }
    return idByKey;
};
exports.seedSystemRoles = seedSystemRoles;
// ─── 3. backfill assignments from the legacy `users.role` column ──────────────
/**
 * Give every active-or-invited user a workspace-scoped assignment of the system
 * role matching their `users.role`. Idempotent (the grant UNIQUE key absorbs
 * re-runs). Deactivated users are included: reactivation must not silently lose
 * their role, and the auth layer already blocks them.
 */
const backfillUserRoles = async (db, workspaceId, roleIdByKey) => {
    const people = await db
        .select({ id: schema.users.id, role: schema.users.role })
        .from(schema.users)
        .where((0, drizzle_orm_1.eq)(schema.users.workspaceId, workspaceId));
    if (people.length === 0)
        return 0;
    const rows = people
        .filter((u) => roleIdByKey[u.role])
        .map((u) => ({
        id: (0, utils_1.fakeId)("urol"),
        workspaceId,
        userId: u.id,
        roleId: roleIdByKey[u.role],
        scopeType: "workspace",
        scopeId: null,
    }));
    if (rows.length === 0)
        return 0;
    await db
        .insert(schema.userRoleGrants)
        .values(rows)
        // The grant already exists → keep it (no-op update on its own column).
        .onDuplicateKeyUpdate({ set: { scopeType: (0, drizzle_orm_1.sql) `VALUES(scope_type)` } });
    return rows.length;
};
exports.backfillUserRoles = backfillUserRoles;
/**
 * One-time convenience: derive a starting space-membership map from who is
 * already assigned tasks (plan D-2). Everyone keeps their workspace-wide grant,
 * so this changes NOTHING today — it just means that when an admin later
 * narrows `space.view` to `space`, people already sit in the right departments
 * instead of losing access all at once.
 *
 * Space heads are included even with no assigned task: they demonstrably belong
 * to the department they lead.
 */
const backfillSpaceMembership = async (db, workspaceId, memberRoleId) => {
    const pairs = await db
        .selectDistinct({
        userId: schema.taskAssignees.userId,
        spaceId: schema.lists.spaceId,
    })
        .from(schema.taskAssignees)
        .innerJoin(schema.tasks, (0, drizzle_orm_1.eq)(schema.tasks.id, schema.taskAssignees.taskId))
        .innerJoin(schema.lists, (0, drizzle_orm_1.eq)(schema.lists.id, schema.tasks.primaryListId))
        .innerJoin(schema.spaces, (0, drizzle_orm_1.eq)(schema.spaces.id, schema.lists.spaceId))
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema.tasks.workspaceId, workspaceId), (0, drizzle_orm_1.isNull)(schema.spaces.archivedAt), (0, drizzle_orm_1.isNull)(schema.lists.archivedAt)));
    const heads = await db
        .select({ userId: schema.spaces.headUserId, spaceId: schema.spaces.id })
        .from(schema.spaces)
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema.spaces.workspaceId, workspaceId), (0, drizzle_orm_1.isNull)(schema.spaces.archivedAt)));
    const seen = new Set();
    const rows = [];
    const add = (userId, spaceId) => {
        if (!userId)
            return;
        const k = `${userId}|${spaceId}`;
        if (seen.has(k))
            return;
        seen.add(k);
        rows.push({
            id: (0, utils_1.fakeId)("urol"),
            workspaceId,
            userId,
            roleId: memberRoleId,
            scopeType: "space",
            scopeId: spaceId,
        });
    };
    for (const p of pairs)
        add(p.userId, p.spaceId);
    for (const h of heads)
        add(h.userId, h.spaceId);
    if (rows.length === 0)
        return 0;
    await db
        .insert(schema.userRoleGrants)
        .values(rows)
        .onDuplicateKeyUpdate({ set: { scopeType: (0, drizzle_orm_1.sql) `VALUES(scope_type)` } });
    return rows.length;
};
exports.backfillSpaceMembership = backfillSpaceMembership;
/**
 * Idempotent full bootstrap for one workspace: catalog → system roles →
 * assignments → derived space membership. Safe to re-run.
 */
const bootstrapRbac = async (db, workspaceId, opts = {}) => {
    const permissions = await (0, exports.syncPermissionCatalog)(db);
    const roleIdByKey = await (0, exports.seedSystemRoles)(db, workspaceId);
    const workspaceGrants = await (0, exports.backfillUserRoles)(db, workspaceId, roleIdByKey);
    const spaceGrants = opts.deriveSpaceMembership === false
        ? 0
        : await (0, exports.backfillSpaceMembership)(db, workspaceId, roleIdByKey.member);
    return {
        permissions,
        roles: exports.SYSTEM_ROLES.length,
        workspaceGrants,
        spaceGrants,
    };
};
exports.bootstrapRbac = bootstrapRbac;
// ─── 5. keeping `users.role` and `user_roles` in step (landmine L13) ──────────
/** Bump the workspace's permission cache stamp. */
const bumpVersion = async (db, workspaceId) => {
    await db
        .update(schema.workspaces)
        .set({
        permissionsVersion: (0, drizzle_orm_1.sql) `${schema.workspaces.permissionsVersion} + 1`,
    })
        .where((0, drizzle_orm_1.eq)(schema.workspaces.id, workspaceId));
};
/**
 * Make the user's workspace-scoped SYSTEM-role assignment match `role`.
 *
 * `users.role` stays the denormalized mirror (D-6), so every path that writes
 * it — invite, accept, change-role — must call this or the two would drift and
 * a promotion would grant nothing (landmine L13).
 *
 * Only the WORKSPACE-scoped assignments of SYSTEM roles are replaced: a custom
 * role, and anything assigned inside a space, is that person's own
 * configuration and survives a promotion untouched.
 *
 * No-ops (returns false) when the workspace has not been bootstrapped, so the
 * function is safe to call unconditionally.
 */
const syncUserSystemRole = async (db, workspaceId, userId, role, opts = {}) => {
    const systemRoles = await db
        .select({ id: schema.roles.id, roleKey: schema.roles.roleKey })
        .from(schema.roles)
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema.roles.workspaceId, workspaceId), (0, drizzle_orm_1.eq)(schema.roles.isSystem, true)));
    if (systemRoles.length === 0)
        return false;
    const target = systemRoles.find((r) => r.roleKey === role);
    await db.delete(schema.userRoleGrants).where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema.userRoleGrants.workspaceId, workspaceId), (0, drizzle_orm_1.eq)(schema.userRoleGrants.userId, userId), (0, drizzle_orm_1.eq)(schema.userRoleGrants.scopeType, "workspace"), (0, drizzle_orm_1.inArray)(schema.userRoleGrants.roleId, systemRoles.map((r) => r.id))));
    if (target) {
        await db
            .insert(schema.userRoleGrants)
            .values({
            id: (0, utils_1.fakeId)("urol"),
            workspaceId,
            userId,
            roleId: target.id,
            scopeType: "workspace",
            scopeId: null,
        })
            .onDuplicateKeyUpdate({
            set: { scopeType: (0, drizzle_orm_1.sql) `VALUES(scope_type)` },
        });
    }
    // The bump is what makes a change effective immediately. Skip it when the
    // account cannot possibly have a cached actor yet (a fresh invite): the
    // UPDATE takes an exclusive lock on the workspace row, and two invites
    // racing inside their own transactions would deadlock on it.
    if (opts.bump !== false)
        await bumpVersion(db, workspaceId);
    return true;
};
exports.syncUserSystemRole = syncUserSystemRole;
