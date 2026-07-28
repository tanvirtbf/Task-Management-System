import { getDb } from "../../src/db/client";
import { PermissionsRepo } from "../../src/repositories/PermissionsRepo";
import { RolesRepo } from "../../src/repositories/RolesRepo";
import { UserRolesRepo } from "../../src/repositories/UserRolesRepo";
import {
    SYSTEM_ROLES,
    SYSTEM_ROLE_GRANTS,
    bootstrapRbac,
} from "../../src/rbac/bootstrap";
import { PERMISSIONS } from "../../src/rbac/catalog";
import { makeSpace, makeUser, makeWorkspace } from "../test-utils/factories";
import { bareRbacWorkspace } from "./helpers";

/**
 * P4 — repository behaviour against a real database.
 *
 * Covers the three RBAC repos and the bootstrap that P3 introduced. The
 * per-test reset wipes every table (including the catalog), so each test seeds
 * exactly what it needs — which also proves the `role_permissions → permissions`
 * RESTRICT foreign key is doing its job.
 */

const repos = () => {
    const db = getDb();
    return {
        db,
        perms: new PermissionsRepo(db),
        roles: new RolesRepo(db),
        grants: new UserRolesRepo(db),
    };
};

describe("PermissionsRepo — the catalog mirror", () => {
    it("syncs every catalog entry and is idempotent", async () => {
        const { perms } = repos();

        const first = await perms.syncCatalog();
        expect(first).toBe(PERMISSIONS.length);
        expect((await perms.listAll()).length).toBe(PERMISSIONS.length);

        await perms.syncCatalog();
        await perms.syncCatalog();
        expect((await perms.listAll()).length).toBe(PERMISSIONS.length);
    });

    it("refreshes reference fields on re-sync (code is the source of truth)", async () => {
        const { db, perms } = repos();
        await perms.syncCatalog();

        // Simulate drift: someone edited the mirror directly.
        await db.execute(
            "UPDATE permissions SET label = 'STALE', position = 999 WHERE permission_key = 'task.edit'",
        );
        await perms.syncCatalog();

        const row = (await perms.listAll()).find(
            (p) => p.permissionKey === "task.edit",
        );
        expect(row?.label).not.toBe("STALE");
        expect(row?.position).not.toBe(999);
    });

    it("returns the catalog grouped in display order, with scopes as CSV", async () => {
        const { perms } = repos();
        await perms.syncCatalog();
        const all = await perms.listAll();

        const groups = all.map((p) => p.groupKey);
        expect(groups).toEqual([...groups].sort()); // ordered by group
        const spaceView = all.find((p) => p.permissionKey === "space.view");
        expect(spaceView?.scopes.split(",").sort()).toEqual(["all", "space"]);
        expect(
            all.find((p) => p.permissionKey === "space.delete")?.isDangerous,
        ).toBe(true);
        expect((await perms.listKeys()).length).toBe(PERMISSIONS.length);
    });
});

describe("RolesRepo — definable roles", () => {
    it("creates, finds and lists roles ordered by rank", async () => {
        const { perms, roles } = repos();
        const ws = { id: await bareRbacWorkspace() };

        const midId = await roles.create(ws.id, {
            roleKey: "cs-agent",
            name: "CS Agent",
            description: "Handles complaints",
            color: "#EC4899",
            rankOrder: 40,
        });
        await roles.create(ws.id, {
            roleKey: "intern",
            name: "Intern",
            rankOrder: 80,
        });

        const list = await roles.listByWorkspace(ws.id);
        expect(list.map((r) => r.roleKey)).toEqual(["cs-agent", "intern"]);
        expect(list[0].isSystem).toBe(false);
        expect(list[0].color).toBe("#EC4899");

        expect((await roles.findByIdInWorkspace(midId, ws.id))?.name).toBe(
            "CS Agent",
        );
        expect(
            (await roles.findByKeyInWorkspace("intern", ws.id))?.rankOrder,
        ).toBe(80);
    });

    it("is workspace-scoped: another tenant's role resolves to null", async () => {
        const { perms, roles } = repos();
        const a = { id: await bareRbacWorkspace() };
        const b = { id: await bareRbacWorkspace() };
        const id = await roles.create(a.id, { roleKey: "x", name: "X" });

        expect(await roles.findByIdInWorkspace(id, b.id)).toBeNull();
        expect(await roles.findByKeyInWorkspace("x", b.id)).toBeNull();
        expect(await roles.listByWorkspace(b.id)).toEqual([]);
    });

    it("hides archived roles unless asked", async () => {
        const { perms, roles } = repos();
        const ws = { id: await bareRbacWorkspace() };
        const id = await roles.create(ws.id, { roleKey: "old", name: "Old" });

        await roles.update(id, { archivedAt: new Date() });
        expect(await roles.listByWorkspace(ws.id)).toEqual([]);
        expect(
            (await roles.listByWorkspace(ws.id, { includeArchived: true }))
                .length,
        ).toBe(1);
    });

    it("replacePermissions swaps the whole grant set atomically", async () => {
        const { perms, roles } = repos();
        const ws = { id: await bareRbacWorkspace() };
        const id = await roles.create(ws.id, { roleKey: "r", name: "R" });

        await roles.replacePermissions(id, [
            { permissionKey: "task.view", scope: "all" },
            { permissionKey: "task.edit", scope: "space" },
        ]);
        expect(await roles.permissionsForRole(id)).toEqual([
            { permissionKey: "task.edit", scope: "space" },
            { permissionKey: "task.view", scope: "all" },
        ]);

        // Replace = the previous set is gone, not merged.
        await roles.replacePermissions(id, [
            { permissionKey: "comment.create", scope: "own" },
        ]);
        expect(await roles.permissionsForRole(id)).toEqual([
            { permissionKey: "comment.create", scope: "own" },
        ]);

        await roles.replacePermissions(id, []);
        expect(await roles.permissionsForRole(id)).toEqual([]);
    });

    it("REFUSES a grant for a key that is not in the catalog (FK RESTRICT)", async () => {
        const { perms, roles } = repos();
        const ws = { id: await bareRbacWorkspace() };
        const id = await roles.create(ws.id, { roleKey: "r", name: "R" });

        await expect(
            roles.replacePermissions(id, [
                { permissionKey: "totally.madeup", scope: "all" },
            ]),
        ).rejects.toThrow();
    });

    it("counts holders and users-with-a-permission", async () => {
        const { perms, roles, grants } = repos();
        const ws = { id: await bareRbacWorkspace() };
        const u1 = await makeUser({ workspaceId: ws.id });
        const u2 = await makeUser({ workspaceId: ws.id });
        const roleId = await roles.create(ws.id, { roleKey: "r", name: "R" });
        await roles.replacePermissions(roleId, [
            { permissionKey: "task.edit", scope: "all" },
        ]);

        await grants.assign({
            workspaceId: ws.id,
            userId: u1.id,
            roleId,
            scopeType: "workspace",
        });
        await grants.assign({
            workspaceId: ws.id,
            userId: u2.id,
            roleId,
            scopeType: "workspace",
        });

        expect(await roles.countHolders(roleId)).toBe(2);
        expect(
            await roles.countUsersWithPermission(ws.id, "task.edit"),
        ).toBe(2);
        expect(
            await roles.countUsersWithPermission(ws.id, "role.manage"),
        ).toBe(0);
    });

    it("an ARCHIVED role stops counting toward a permission", async () => {
        const { perms, roles, grants } = repos();
        const ws = { id: await bareRbacWorkspace() };
        const u = await makeUser({ workspaceId: ws.id });
        const roleId = await roles.create(ws.id, { roleKey: "r", name: "R" });
        await roles.replacePermissions(roleId, [
            { permissionKey: "role.manage", scope: "all" },
        ]);
        await grants.assign({
            workspaceId: ws.id,
            userId: u.id,
            roleId,
            scopeType: "workspace",
        });
        expect(
            await roles.countUsersWithPermission(ws.id, "role.manage"),
        ).toBe(1);

        await roles.update(roleId, { archivedAt: new Date() });
        expect(
            await roles.countUsersWithPermission(ws.id, "role.manage"),
        ).toBe(0);
    });

    it("bumps the permissions_version cache stamp", async () => {
        const { roles } = repos();
        const ws = await makeWorkspace();

        expect(await roles.getPermissionsVersion(ws.id)).toBe(1);
        await roles.bumpPermissionsVersion(ws.id);
        await roles.bumpPermissionsVersion(ws.id);
        expect(await roles.getPermissionsVersion(ws.id)).toBe(3);
    });
});

describe("UserRolesRepo — assignments and membership", () => {
    it("assigns workspace- and space-scoped roles, and is idempotent", async () => {
        const { perms, roles, grants } = repos();
        const ws = { id: await bareRbacWorkspace() };
        const u = await makeUser({ workspaceId: ws.id });
        const sp = await makeSpace({ workspaceId: ws.id, createdBy: u.id });
        const roleId = await roles.create(ws.id, { roleKey: "r", name: "R" });

        const a1 = await grants.assign({
            workspaceId: ws.id,
            userId: u.id,
            roleId,
            scopeType: "workspace",
        });
        // Repeat of the SAME grant must not create a second row (the NULL-safe
        // unique key is what makes this work).
        const a2 = await grants.assign({
            workspaceId: ws.id,
            userId: u.id,
            roleId,
            scopeType: "workspace",
        });
        expect(a2).toBe(a1);

        await grants.assign({
            workspaceId: ws.id,
            userId: u.id,
            roleId,
            scopeType: "space",
            scopeId: sp.id,
        });

        const mine = await grants.listForUser(u.id, ws.id);
        expect(mine.length).toBe(2);
        expect(mine.map((m) => m.scopeType).sort()).toEqual([
            "space",
            "workspace",
        ]);
        expect(await grants.spaceIdsForUser(u.id, ws.id)).toEqual([sp.id]);
    });

    it("listEffectiveGrants returns both scopes for the resolver", async () => {
        const { perms, roles, grants } = repos();
        const ws = { id: await bareRbacWorkspace() };
        const u = await makeUser({ workspaceId: ws.id });
        const sp = await makeSpace({ workspaceId: ws.id, createdBy: u.id });

        const wide = await roles.create(ws.id, { roleKey: "wide", name: "Wide" });
        await roles.replacePermissions(wide, [
            { permissionKey: "task.view", scope: "all" },
        ]);
        const local = await roles.create(ws.id, {
            roleKey: "local",
            name: "Local",
        });
        await roles.replacePermissions(local, [
            { permissionKey: "task.edit", scope: "space" },
        ]);

        await grants.assign({
            workspaceId: ws.id,
            userId: u.id,
            roleId: wide,
            scopeType: "workspace",
        });
        await grants.assign({
            workspaceId: ws.id,
            userId: u.id,
            roleId: local,
            scopeType: "space",
            scopeId: sp.id,
        });

        const rows = await grants.listEffectiveGrants(u.id, ws.id);
        expect(rows).toHaveLength(2);
        const view = rows.find((r) => r.permissionKey === "task.view");
        expect(view).toMatchObject({
            grantScope: "all",
            assignmentScopeType: "workspace",
            assignmentScopeId: null,
        });
        const edit = rows.find((r) => r.permissionKey === "task.edit");
        expect(edit).toMatchObject({
            grantScope: "space",
            assignmentScopeType: "space",
            assignmentScopeId: sp.id,
        });
    });

    it("an archived role disappears from the effective grants immediately", async () => {
        const { perms, roles, grants } = repos();
        const ws = { id: await bareRbacWorkspace() };
        const u = await makeUser({ workspaceId: ws.id });
        const roleId = await roles.create(ws.id, { roleKey: "r", name: "R" });
        await roles.replacePermissions(roleId, [
            { permissionKey: "task.view", scope: "all" },
        ]);
        await grants.assign({
            workspaceId: ws.id,
            userId: u.id,
            roleId,
            scopeType: "workspace",
        });
        expect(await grants.listEffectiveGrants(u.id, ws.id)).toHaveLength(1);

        await roles.update(roleId, { archivedAt: new Date() });
        expect(await grants.listEffectiveGrants(u.id, ws.id)).toHaveLength(0);
        expect(await grants.spaceIdsForUser(u.id, ws.id)).toEqual([]);
    });

    it("lists a space's members and revokes cleanly", async () => {
        const { perms, roles, grants } = repos();
        const ws = { id: await bareRbacWorkspace() };
        const u1 = await makeUser({ workspaceId: ws.id });
        const u2 = await makeUser({ workspaceId: ws.id });
        const sp = await makeSpace({ workspaceId: ws.id, createdBy: u1.id });
        const roleId = await roles.create(ws.id, { roleKey: "r", name: "R" });

        for (const u of [u1, u2]) {
            await grants.assign({
                workspaceId: ws.id,
                userId: u.id,
                roleId,
                scopeType: "space",
                scopeId: sp.id,
            });
        }
        expect((await grants.listBySpace(sp.id, ws.id)).length).toBe(2);

        await grants.revoke({
            workspaceId: ws.id,
            userId: u2.id,
            roleId,
            scopeType: "space",
            scopeId: sp.id,
        });
        expect((await grants.listBySpace(sp.id, ws.id)).length).toBe(1);

        await grants.revokeAllForUser(u1.id, ws.id);
        expect((await grants.listBySpace(sp.id, ws.id)).length).toBe(0);
    });

    it("revoking a workspace grant does not touch the space grant", async () => {
        const { perms, roles, grants } = repos();
        const ws = { id: await bareRbacWorkspace() };
        const u = await makeUser({ workspaceId: ws.id });
        const sp = await makeSpace({ workspaceId: ws.id, createdBy: u.id });
        const roleId = await roles.create(ws.id, { roleKey: "r", name: "R" });

        await grants.assign({
            workspaceId: ws.id,
            userId: u.id,
            roleId,
            scopeType: "workspace",
        });
        await grants.assign({
            workspaceId: ws.id,
            userId: u.id,
            roleId,
            scopeType: "space",
            scopeId: sp.id,
        });

        await grants.revoke({
            workspaceId: ws.id,
            userId: u.id,
            roleId,
            scopeType: "workspace",
        });
        const left = await grants.listForUser(u.id, ws.id);
        expect(left).toHaveLength(1);
        expect(left[0].scopeType).toBe("space");
    });
});

describe("bootstrapRbac — against a real database", () => {
    it("seeds the catalog, the four system roles and every user's assignment", async () => {
        const { perms, roles, grants } = repos();
        const ws = await makeWorkspace();
        const owner = await makeUser({ workspaceId: ws.id, role: "owner" });
        const admin = await makeUser({ workspaceId: ws.id, role: "admin" });
        const member = await makeUser({ workspaceId: ws.id, role: "member" });
        const guest = await makeUser({ workspaceId: ws.id, role: "guest" });

        const res = await bootstrapRbac(getDb(), ws.id);
        expect(res.permissions).toBe(PERMISSIONS.length);
        expect(res.roles).toBe(SYSTEM_ROLES.length);
        expect(res.workspaceGrants).toBe(4);

        const seeded = await roles.listByWorkspace(ws.id);
        expect(seeded.map((r) => r.roleKey)).toEqual([
            "owner",
            "admin",
            "member",
            "guest",
        ]);
        expect(seeded.every((r) => r.isSystem)).toBe(true);

        // grant counts match the pinned contract exactly
        for (const r of seeded) {
            const got = await roles.permissionsForRole(r.id);
            expect(got.length).toBe(SYSTEM_ROLE_GRANTS[r.roleKey].length);
            expect(got.every((g) => g.scope === "all")).toBe(true);
        }

        // every user got the assignment matching their legacy users.role
        for (const [u, key] of [
            [owner, "owner"],
            [admin, "admin"],
            [member, "member"],
            [guest, "guest"],
        ] as const) {
            const mine = await grants.listForUser(u.id, ws.id);
            expect(mine).toHaveLength(1);
            expect(mine[0].roleKey).toBe(key);
            expect(mine[0].scopeType).toBe("workspace");
        }

        expect((await perms.listAll()).length).toBe(PERMISSIONS.length);
    });

    it("is idempotent — re-running changes no counts", async () => {
        const { roles, grants } = repos();
        const ws = await makeWorkspace();
        const u = await makeUser({ workspaceId: ws.id, role: "member" });

        await bootstrapRbac(getDb(), ws.id);
        const before = (await roles.listByWorkspace(ws.id)).length;
        const beforeGrants = (await grants.listForUser(u.id, ws.id)).length;

        await bootstrapRbac(getDb(), ws.id);
        await bootstrapRbac(getDb(), ws.id);

        expect((await roles.listByWorkspace(ws.id)).length).toBe(before);
        expect((await grants.listForUser(u.id, ws.id)).length).toBe(
            beforeGrants,
        );
    });

    it("derives space membership from task assignees and space heads", async () => {
        const { grants } = repos();
        const ws = await makeWorkspace();
        const head = await makeUser({ workspaceId: ws.id, role: "member" });
        const sp = await makeSpace({ workspaceId: ws.id, createdBy: head.id });

        // Head with no assigned task still belongs to the space they lead.
        const db = getDb();
        await db.execute(
            `UPDATE spaces SET head_user_id = '${head.id}' WHERE id = '${sp.id}'`,
        );

        await bootstrapRbac(db, ws.id);
        expect(await grants.spaceIdsForUser(head.id, ws.id)).toEqual([sp.id]);
    });

    it("can skip the derived membership when asked", async () => {
        const { grants } = repos();
        const ws = await makeWorkspace();
        const u = await makeUser({ workspaceId: ws.id, role: "member" });
        const sp = await makeSpace({ workspaceId: ws.id, createdBy: u.id });
        const db = getDb();
        await db.execute(
            `UPDATE spaces SET head_user_id = '${u.id}' WHERE id = '${sp.id}'`,
        );

        const res = await bootstrapRbac(db, ws.id, {
            deriveSpaceMembership: false,
        });
        expect(res.spaceGrants).toBe(0);
        expect(await grants.spaceIdsForUser(u.id, ws.id)).toEqual([]);
    });
});
