"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RolesAdminService = void 0;
const errors_1 = require("../errors");
const can_1 = require("../rbac/can");
const catalog_1 = require("../rbac/catalog");
const bootstrap_1 = require("../rbac/bootstrap");
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
const CRITICAL_PERMISSIONS = ["role.manage", "role.assign"];
/** `Marketing Manager` → `marketing-manager`, uniquified by the caller. */
const slugify = (name) => name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50) || "role";
/** mysql2 surfaces a unique-violation as `ER_DUP_ENTRY` / errno 1062. */
const isDuplicateKeyError = (err) => {
    const e = err;
    return e?.code === "ER_DUP_ENTRY" || e?.errno === 1062;
};
class RolesAdminService {
    db;
    roles;
    assignments;
    users;
    spaces;
    policy;
    logger;
    constructor(db, roles, assignments, users, spaces, policy, logger) {
        this.db = db;
        this.roles = roles;
        this.assignments = assignments;
        this.users = users;
        this.spaces = spaces;
        this.policy = policy;
        this.logger = logger;
    }
    // ─── reads ───────────────────────────────────────────────────────────────
    async list(workspaceId) {
        const records = await this.roles.listByWorkspace(workspaceId);
        const out = [];
        for (const r of records) {
            out.push({
                ...r,
                grants: await this.roles.permissionsForRole(r.id),
                holders: await this.roles.countHolders(r.id),
            });
        }
        return out;
    }
    async holders(workspaceId, roleId) {
        await this.requireRole(workspaceId, roleId);
        const rows = await this.assignments.listByRole(roleId, workspaceId);
        return rows.map((r) => ({
            userId: r.userId,
            scopeType: r.scopeType,
            scopeId: r.scopeId,
        }));
    }
    // ─── writes ──────────────────────────────────────────────────────────────
    async create(input) {
        const grants = this.validateGrants(input.grants ?? []);
        this.assertNoEscalation(input.actor, grants);
        // `key` is the stable identifier that `role_permissions` rows hang off,
        // so it is derived once from the name and then never changes — renaming
        // a role must not rewrite data. Collisions get a numeric suffix.
        const base = slugify(input.name);
        let key = base;
        for (let i = 2; await this.roles.findByKeyInWorkspace(key, input.workspaceId); i++) {
            key = `${base}-${i}`;
            if (i > 50) {
                throw errors_1.AppError.conflict("role.key_taken", "Could not derive a unique role key from that name");
            }
        }
        // F27 (ISS-027): the display NAME is unique now (the key always was,
        // by silent suffixing — which is why `role.key_taken` never fired).
        const existingName = await this.roles.findByNameInWorkspace(input.name, input.workspaceId);
        if (existingName) {
            throw errors_1.AppError.conflict("role.name_taken", `A role called "${input.name}" already exists`);
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
    async update(input) {
        const role = await this.requireRole(input.workspaceId, input.roleId);
        this.assertEditable(role, "edit");
        this.assertRenamable(role, input.name);
        try {
            await this.roles.update(input.roleId, {
                ...(input.name !== undefined ? { name: input.name } : {}),
                ...(input.description !== undefined
                    ? { description: input.description }
                    : {}),
                ...(input.color !== undefined ? { color: input.color } : {}),
            });
        }
        catch (err) {
            // F27 (ISS-027): the new uq_roles_workspace_name index.
            if (isDuplicateKeyError(err)) {
                throw errors_1.AppError.conflict("role.name_taken", `A role called "${input.name}" already exists`);
            }
            throw err;
        }
        await this.roles.bumpPermissionsVersion(input.workspaceId);
        this.policy.clearCache();
        const updated = await this.requireRole(input.workspaceId, input.roleId);
        return {
            ...updated,
            grants: await this.roles.permissionsForRole(input.roleId),
            holders: await this.roles.countHolders(input.roleId),
        };
    }
    async setGrants(input) {
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
    async remove(input) {
        const role = await this.requireRole(input.workspaceId, input.roleId);
        if (role.isSystem) {
            throw errors_1.AppError.forbidden("role.system_immutable", "The built-in roles cannot be deleted");
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
    async assign(input) {
        const role = await this.requireRole(input.workspaceId, input.roleId);
        const user = await this.users.findByIdInWorkspace(input.userId, input.workspaceId);
        if (!user) {
            throw errors_1.AppError.notFound("user.not_found", "User not found");
        }
        if (input.spaceId) {
            const space = await this.spaces.findByIdInWorkspace(input.spaceId, input.workspaceId);
            if (!space) {
                throw errors_1.AppError.notFound("space.not_found", "Space not found");
            }
        }
        // Escalation guard: giving away a role is giving away its grants.
        this.assertNoEscalation(input.actor, await this.roles.permissionsForRole(role.id), input.spaceId ?? null);
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
            await this.users.update(input.userId, { role: role.roleKey });
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
    async revoke(input) {
        const held = await this.assignments.listForUser(input.userId, input.workspaceId);
        const target = held.find((a) => a.id === input.assignmentId);
        if (!target) {
            throw errors_1.AppError.notFound("assignment.not_found", "That role assignment does not exist");
        }
        await this.assertNoLockoutAfterRevoke(input.workspaceId, input.userId, target);
        await this.assignments.revokeById(input.assignmentId, input.workspaceId);
        // L13: losing the workspace-wide system role drops you to `guest` in
        // the mirror column, matching what the resolver now says you can do.
        if (target.scopeType === "workspace") {
            const remaining = (await this.assignments.listForUser(input.userId, input.workspaceId)).filter((a) => a.scopeType === "workspace");
            const stillSystem = remaining.find((a) => ["owner", "admin", "member", "guest"].includes(a.roleKey));
            if (!stillSystem) {
                await this.users.update(input.userId, {
                    role: "guest",
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
    async spaceMembers(workspaceId, spaceId) {
        const space = await this.spaces.findByIdInWorkspace(spaceId, workspaceId);
        if (!space)
            throw errors_1.AppError.notFound("space.not_found", "Space not found");
        return this.assignments.listBySpace(spaceId, workspaceId);
    }
    async assignmentsForUser(workspaceId, userId) {
        return this.assignments.listForUser(userId, workspaceId);
    }
    /** Re-sync the legacy mirror after any assignment write (used by tests). */
    async resyncLegacyRole(workspaceId, userId, role) {
        await (0, bootstrap_1.syncUserSystemRole)(this.db, workspaceId, userId, role);
    }
    // ─── guards ──────────────────────────────────────────────────────────────
    async requireRole(workspaceId, roleId) {
        const role = await this.roles.findByIdInWorkspace(roleId, workspaceId);
        if (!role) {
            throw errors_1.AppError.notFound("role.not_found", "Role not found");
        }
        return role;
    }
    assertEditable(role, what) {
        if (role.isSystem && role.roleKey === "owner") {
            throw errors_1.AppError.forbidden("role.owner_immutable", `The Owner role cannot be ${what}ed — it is the account that can never be locked out`);
        }
    }
    /**
     * F27 (ISS-026): a system role's NAME is immutable, the way its existence
     * already is. `DELETE` refused with `role.system_immutable` while
     * `PATCH {name}` returned 200 — so "Admin" could be renamed to anything
     * while every UI, every doc and the seeded grant matrix still called it
     * Admin. Description and colour stay editable: they are cosmetic, the name
     * is the identifier people navigate by.
     */
    assertRenamable(role, name) {
        if (name === undefined || name === role.name)
            return;
        if (role.isSystem) {
            throw errors_1.AppError.forbidden("role.system_immutable", "The built-in roles cannot be renamed");
        }
    }
    /** Reject unknown keys, unsupported scopes and duplicates. */
    validateGrants(grants) {
        const seen = new Map();
        for (const g of grants) {
            if (!(0, catalog_1.isPermissionKey)(g.permissionKey)) {
                throw errors_1.AppError.unprocessable("role.unknown_permission", `Unknown permission: ${g.permissionKey}`);
            }
            if (!(0, catalog_1.supportsScope)(g.permissionKey, g.scope)) {
                const def = (0, catalog_1.getPermission)(g.permissionKey);
                throw errors_1.AppError.unprocessable("role.unsupported_scope", `${g.permissionKey} does not support scope '${g.scope}' (allowed: ${def?.scopes.join(", ")})`);
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
    assertNoEscalation(actor, grants, spaceId = null) {
        if (actor.isOwner)
            return;
        for (const g of grants) {
            const held = (0, can_1.entryFor)(actor, g.permissionKey);
            const ok = held.all ||
                (g.scope === "own" && held.own) ||
                (spaceId !== null && held.spaceIds.has(spaceId)) ||
                (spaceId === null && g.scope !== "all" && held.spaceIds.size > 0);
            if (!ok) {
                throw errors_1.AppError.forbidden("role.escalation_blocked", `You cannot grant "${g.permissionKey}" because you do not hold it yourself`, [
                    { field: "permission", issue: g.permissionKey },
                    { field: "reason", issue: "escalation" },
                ]);
            }
        }
    }
    /**
     * L7 — refuse any change that would leave nobody able to administer roles.
     * Computed on the state AFTER the change: for each critical permission, if
     * removing it from this role would drop the workspace to zero holders, stop.
     */
    async assertNoLockout(workspaceId, roleId, nextGrants) {
        const nextKeys = new Set(nextGrants.map((g) => g.permissionKey));
        const current = await this.roles.permissionsForRole(roleId);
        const holders = await this.roles.countHolders(roleId);
        for (const key of CRITICAL_PERMISSIONS) {
            const losing = current.some((g) => g.permissionKey === key) &&
                !nextKeys.has(key);
            if (!losing || holders === 0)
                continue;
            const total = await this.roles.countUsersWithPermission(workspaceId, key);
            const stillHave = await this.countHoldersExcludingRole(workspaceId, key, roleId);
            if (total > 0 && stillHave === 0) {
                throw errors_1.AppError.conflict("role.last_admin", `Removing "${key}" from this role would leave nobody able to administer permissions`);
            }
        }
    }
    async assertNoLockoutAfterRevoke(workspaceId, userId, target) {
        const grants = await this.roles.permissionsForRole(target.roleId);
        for (const key of CRITICAL_PERMISSIONS) {
            if (!grants.some((g) => g.permissionKey === key))
                continue;
            const others = await this.roles.countUsersWithPermissionExcluding(workspaceId, key, userId);
            if (others === 0) {
                throw errors_1.AppError.conflict("role.last_admin", "That is the last person who can administer permissions");
            }
        }
    }
    async countHoldersExcludingRole(workspaceId, permissionKey, roleId) {
        return this.roles.countUsersWithPermissionExcludingRole(workspaceId, permissionKey, roleId);
    }
}
exports.RolesAdminService = RolesAdminService;
