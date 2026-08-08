import { PERMISSION_KEYS } from "../../src/rbac/catalog";
import { SYSTEM_ROLE_GRANTS } from "../../src/rbac/bootstrap";
import { resetPolicy } from "../../src/rbac/policy";
import type { WireMyPermissions } from "../../src/types/rbac";
import { oneOff } from "../test-utils/app";
import { makeLoggedInClient, makeUser } from "../test-utils/factories";
import {
    makeRbacSpace,
    rbacRepos,
    rbacWorkspace,
    setGrants,
    userWithPermissions,
    userWithSystemRole,
} from "./helpers";

/**
 * P10 — `GET /api/v1/me/permissions`, the first RBAC wire contract.
 *
 * This is what the client's `can()` is built on (P25), so the shape is pinned
 * here as tightly as `/auth/me` pins the Appendix-A User.
 */

const PATH = "/api/v1/me/permissions";

// The route module holds a process-wide PolicyService; each test file gets its
// own private database, so drop any instance bound to a previous handle.
beforeAll(() => resetPolicy());

const body = (res: { body: unknown }): WireMyPermissions =>
    res.body as WireMyPermissions;

describe("GET /me/permissions — shape", () => {
    it("returns exactly the five documented keys", async () => {
        const ws = await rbacWorkspace();
        const u = await userWithSystemRole(ws, "member");

        const res = await u.client.get(PATH);
        expect(res.status).toBe(200);
        expect(Object.keys(res.body).sort()).toEqual(
            [
                "is_owner",
                "permissions",
                "role",
                "version",
                "visible_space_ids",
            ].sort(),
        );
    });

    it("each entry mirrors PermissionEntry in snake_case", async () => {
        const ws = await rbacWorkspace();
        const admin = await userWithSystemRole(ws, "admin");
        const marketing = await makeRbacSpace(ws.id, admin.id, "Marketing");
        const u = await userWithPermissions(
            ws,
            [["task.edit", "space"], ["task.view", "own"]],
            { spaceId: marketing },
        );

        const res = await u.client.get(PATH);
        const b = body(res);
        expect(b.permissions["task.edit"]).toEqual({
            all: false,
            space_ids: [marketing],
            own: false,
            own_space_ids: [],
        });
        expect(b.permissions["task.view"]).toEqual({
            all: false,
            space_ids: [],
            own: false,
            own_space_ids: [marketing],
        });
    });

    it("omits permissions that grant nothing", async () => {
        const ws = await rbacWorkspace();
        const u = await userWithPermissions(ws, ["task.view"]);

        const b = body(await u.client.get(PATH));
        expect(Object.keys(b.permissions)).toEqual(["task.view"]);
        expect(b.permissions["task.edit"]).toBeUndefined();
    });

    it("a role-less user gets an empty, valid payload (never a 500)", async () => {
        const ws = await rbacWorkspace();
        const u = await makeUser({ workspaceId: ws.id, role: "member" });
        // Strip the system-role assignment the factory gives every user, so
        // this really is the "authenticated but powerless" case.
        await rbacRepos().grants.revokeAllForUser(u.id, ws.id);
        const client = await makeLoggedInClient({
            id: u.id,
            workspaceId: ws.id,
            role: "member",
        });

        const res = await client.get(PATH);
        expect(res.status).toBe(200);
        expect(body(res).permissions).toEqual({});
        expect(body(res).is_owner).toBe(false);
    });
});

describe("GET /me/permissions — the seeded roles", () => {
    it("gives the member exactly today's member powers", async () => {
        const ws = await rbacWorkspace();
        const u = await userWithSystemRole(ws, "member");

        const b = body(await u.client.get(PATH));
        expect(Object.keys(b.permissions).sort()).toEqual(
            [...SYSTEM_ROLE_GRANTS.member].sort(),
        );
        expect(b.role).toBe("member");
        expect(b.is_owner).toBe(false);
        // Every seeded grant is workspace-wide today.
        for (const entry of Object.values(b.permissions)) {
            expect(entry.all).toBe(true);
        }
    });

    it("MATERIALISES the owner floor — all 56 keys, so the client needs no special case", async () => {
        const ws = await rbacWorkspace();
        const owner = await userWithSystemRole(ws, "owner");

        const b = body(await owner.client.get(PATH));
        expect(Object.keys(b.permissions).sort()).toEqual(
            [...PERMISSION_KEYS].sort(),
        );
        expect(b.is_owner).toBe(true);
        expect(b.permissions["role.manage"].all).toBe(true);
    });

    /**
     * F28 / D12.1. This used to assert that a guest holds `task.edit` — the
     * seeded Guest role was a member minus file upload. It now carries exactly
     * the seven read-and-comment keys, and this is the wire proof: the client
     * gates its buttons on this payload, so a key missing here is a button the
     * guest never sees.
     */
    it("the guest gets seven read-and-comment keys and no writes", async () => {
        const ws = await rbacWorkspace();
        const guest = await userWithSystemRole(ws, "guest");

        const b = body(await guest.client.get(PATH));
        expect(Object.keys(b.permissions).sort()).toEqual(
            [
                "activity.view",
                "assistant.use",
                "bug.report",
                "comment.create",
                "member.view",
                "space.view",
                "task.view",
            ].sort(),
        );
        expect(b.permissions["task.view"].all).toBe(true);
        for (const k of [
            "attachment.upload",
            "task.edit",
            "task.delete",
            "form.view_submissions",
            "sprint.assign_tasks",
            "postmortem.manage",
        ]) {
            expect(b.permissions[k]).toBeUndefined();
        }
    });
});

describe("GET /me/permissions — visibility", () => {
    it("null means every space", async () => {
        const ws = await rbacWorkspace();
        const u = await userWithSystemRole(ws, "member");
        expect(body(await u.client.get(PATH)).visible_space_ids).toBeNull();
    });

    it("lists the spaces a scoped person can see", async () => {
        const ws = await rbacWorkspace();
        const admin = await userWithSystemRole(ws, "admin");
        const marketing = await makeRbacSpace(ws.id, admin.id, "Marketing");
        await makeRbacSpace(ws.id, admin.id, "Support");
        const u = await userWithPermissions(ws, [["space.view", "space"]], {
            spaceId: marketing,
        });

        expect(body(await u.client.get(PATH)).visible_space_ids).toEqual([
            marketing,
        ]);
    });

    it("an empty array means none", async () => {
        const ws = await rbacWorkspace();
        const u = await userWithPermissions(ws, ["task.edit"]);
        expect(body(await u.client.get(PATH)).visible_space_ids).toEqual([]);
    });
});

describe("GET /me/permissions — freshness", () => {
    it("reflects a revocation on the very next call (no 15-minute window)", async () => {
        const ws = await rbacWorkspace();
        const u = await userWithPermissions(ws, [
            "workspace.settings",
            "task.edit",
        ]);
        expect(
            body(await u.client.get(PATH)).permissions["workspace.settings"],
        ).toBeDefined();

        await setGrants(u.roleId, ["task.edit"]);
        await rbacRepos().roles.bumpPermissionsVersion(ws.id);

        const after = body(await u.client.get(PATH));
        expect(after.permissions["workspace.settings"]).toBeUndefined();
        expect(after.permissions["task.edit"]).toBeDefined();
    });

    it("the version increments so the client can purge its caches", async () => {
        const ws = await rbacWorkspace();
        const u = await userWithPermissions(ws, ["task.edit"]);
        const before = body(await u.client.get(PATH)).version;

        await rbacRepos().roles.bumpPermissionsVersion(ws.id);

        expect(body(await u.client.get(PATH)).version).toBe(before + 1);
    });
});

describe("GET /me/permissions — auth", () => {
    it("401 without a token", async () => {
        const res = await (await oneOff()).get(PATH);
        expect(res.status).toBe(401);
    });
});
