import { Config } from "../../src/config";
import { getPool } from "../../src/db/client";
import { PERMISSIONS } from "../../src/rbac/catalog";
import { SYSTEM_ROLE_GRANTS } from "../../src/rbac/bootstrap";
import {
    assignRole,
    bareRbacWorkspace,
    effectiveGrants,
    grantSignatures,
    makeRbacSpace,
    makeRole,
    rbacRepos,
    rbacWorkspace,
    setGrants,
    userWithPermissions,
    userWithSystemRole,
} from "./helpers";

/**
 * P5 — proves the RBAC test kit itself works, so later phases can trust it.
 * Mirrors `tests/dept-review/harness.smoke.test.ts`.
 */

describe("RBAC harness", () => {
    it("runs against the private database with the RBAC schema present", async () => {
        expect(Config.DB_NAME).toBe("tms_rbac_test");

        const [rows] = await getPool().query(
            `SELECT TABLE_NAME FROM information_schema.TABLES
             WHERE TABLE_SCHEMA = ?
               AND TABLE_NAME IN ('permissions','roles','role_permissions','user_roles')`,
            [Config.DB_NAME],
        );
        expect(
            (rows as Array<{ TABLE_NAME: string }>)
                .map((r) => r.TABLE_NAME)
                .sort(),
        ).toEqual([
            "permissions",
            "role_permissions",
            "roles",
            "user_roles",
        ]);

        const [cols] = await getPool().query(
            `SELECT COLUMN_NAME FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'workspaces'
               AND COLUMN_NAME = 'permissions_version'`,
            [Config.DB_NAME],
        );
        expect((cols as unknown[]).length).toBe(1);
    });

    it("starts every test from a clean database", async () => {
        const { roles } = rbacRepos();
        // Since P11 the shared factories bootstrap RBAC (a workspace with no
        // roles cannot exist in production), so "clean" means "no workspace of
        // MINE" — `bareRbacWorkspace` then strips the seeded roles back off.
        const ws = await bareRbacWorkspace();
        expect(await roles.listByWorkspace(ws)).toEqual([]);
    });
});

describe("RBAC harness — workspace factories", () => {
    it("rbacWorkspace seeds the catalog and the four system roles", async () => {
        const ws = await rbacWorkspace();
        const { permissions, roles } = rbacRepos();

        expect((await permissions.listAll()).length).toBe(PERMISSIONS.length);
        const seeded = await roles.listByWorkspace(ws.id);
        expect(seeded.map((r) => r.roleKey)).toEqual([
            "owner",
            "admin",
            "member",
            "guest",
        ]);
        expect(Object.keys(ws.systemRoleIds).sort()).toEqual([
            "admin",
            "guest",
            "member",
            "owner",
        ]);
    });

    it("rbacWorkspace does NOT derive space membership (tests control that)", async () => {
        const ws = await rbacWorkspace();
        const u = await userWithSystemRole(ws, "member");
        expect(await rbacRepos().grants.spaceIdsForUser(u.id, ws.id)).toEqual(
            [],
        );
    });

    it("bareRbacWorkspace gives the catalog only", async () => {
        const wsId = await bareRbacWorkspace();
        const { permissions, roles } = rbacRepos();
        expect((await permissions.listAll()).length).toBe(PERMISSIONS.length);
        expect(await roles.listByWorkspace(wsId)).toEqual([]);
    });
});

describe("RBAC harness — user factories", () => {
    it("userWithPermissions grants EXACTLY what was asked, workspace-wide", async () => {
        const ws = await rbacWorkspace();
        const u = await userWithPermissions(ws, [
            "task.view",
            ["task.edit", "own"],
        ]);

        expect(await grantSignatures(u.id, ws.id)).toEqual([
            "task.edit:own@workspace",
            "task.view:all@workspace",
        ]);
    });

    it("userWithPermissions defaults the LEGACY role to member (so old gates don't mask results)", async () => {
        const ws = await rbacWorkspace();
        const u = await userWithPermissions(ws, ["workspace.settings"]);

        const [rows] = await getPool().query(
            "SELECT role FROM users WHERE id = ?",
            [u.id],
        );
        expect((rows as Array<{ role: string }>)[0].role).toBe("member");
    });

    it("a space-scoped assignment is recorded as membership of that space", async () => {
        const ws = await rbacWorkspace();
        const creator = await userWithSystemRole(ws, "admin");
        const spaceId = await makeRbacSpace(ws.id, creator.id, "Marketing");

        const u = await userWithPermissions(ws, [["task.edit", "space"]], {
            spaceId,
        });

        expect(await grantSignatures(u.id, ws.id)).toEqual([
            `task.edit:space@space(${spaceId})`,
        ]);
        expect(await rbacRepos().grants.spaceIdsForUser(u.id, ws.id)).toEqual([
            spaceId,
        ]);
    });

    it("userWithSystemRole reproduces the seeded matrix", async () => {
        const ws = await rbacWorkspace();
        const guest = await userWithSystemRole(ws, "guest");
        const admin = await userWithSystemRole(ws, "admin");

        expect((await effectiveGrants(guest.id, ws.id)).length).toBe(
            SYSTEM_ROLE_GRANTS.guest.length,
        );
        expect((await effectiveGrants(admin.id, ws.id)).length).toBe(
            SYSTEM_ROLE_GRANTS.admin.length,
        );
    });

    it("each helper hands back a usable logged-in client", async () => {
        const ws = await rbacWorkspace();
        const u = await userWithSystemRole(ws, "admin");
        const res = await u.client.get("/api/v1/auth/me");
        expect(res.status).toBe(200);
        expect(res.body.id).toBe(u.id);
    });
});

describe("RBAC harness — role factories", () => {
    it("makeRole + setGrants replace the whole grant set", async () => {
        const ws = await rbacWorkspace();
        const roleId = await makeRole(ws.id, {
            key: "cs-agent",
            name: "CS Agent",
            grants: ["task.view", ["task.edit", "space"]],
        });

        expect(await rbacRepos().roles.permissionsForRole(roleId)).toEqual([
            { permissionKey: "task.edit", scope: "space" },
            { permissionKey: "task.view", scope: "all" },
        ]);

        await setGrants(roleId, ["comment.create"]);
        expect(await rbacRepos().roles.permissionsForRole(roleId)).toEqual([
            { permissionKey: "comment.create", scope: "all" },
        ]);
    });

    it("a user can hold several roles; grants union", async () => {
        const ws = await rbacWorkspace();
        const creator = await userWithSystemRole(ws, "admin");
        const spaceId = await makeRbacSpace(ws.id, creator.id);

        const u = await userWithPermissions(ws, ["task.view"]);
        const extra = await makeRole(ws.id, {
            grants: [["task.edit", "space"]],
        });
        await assignRole({
            workspaceId: ws.id,
            userId: u.id,
            roleId: extra,
            spaceId,
        });

        expect(await grantSignatures(u.id, ws.id)).toEqual([
            `task.edit:space@space(${spaceId})`,
            "task.view:all@workspace",
        ]);
    });

    it("role keys stay unique per workspace but may repeat across workspaces", async () => {
        const a = await rbacWorkspace();
        const b = await rbacWorkspace();
        await makeRole(a.id, { key: "shared-key" });
        await expect(
            makeRole(a.id, { key: "shared-key" }),
        ).rejects.toThrow();
        await expect(makeRole(b.id, { key: "shared-key" })).resolves.toEqual(
            expect.any(String),
        );
    });
});
