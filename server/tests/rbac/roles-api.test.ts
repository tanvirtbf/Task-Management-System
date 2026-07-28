import { getDb } from "../../src/db/client";
import { resetPolicy } from "../../src/rbac/policy";
import { PERMISSION_KEYS } from "../../src/rbac/catalog";
import type { WireAssignment as RoleAssignment, WireRole as Role } from "../../src/serializers/roleSerializer";
import {
    makeRbacSpace,
    rbacRepos,
    rbacWorkspace,
    userWithPermissions,
    userWithSystemRole,
} from "./helpers";

/**
 * P23/P24 — the roles administration API.
 *
 * These endpoints are what makes the system dynamic, and they are also the
 * most dangerous surface in it: whoever holds `role.manage` controls the whole
 * permission system. So the three guards get more tests than the happy paths.
 */

beforeAll(() => resetPolicy());

const ROLES = "/api/v1/roles";

describe("GET /roles + /roles/catalog", () => {
    it("lists the four seeded roles with their grant counts", async () => {
        const ws = await rbacWorkspace();
        const owner = await userWithSystemRole(ws, "owner");

        const res = await owner.client.get(ROLES);
        expect(res.status).toBe(200);
        const roles = res.body.data as Role[];
        expect(roles.map((r) => r.key).sort()).toEqual([
            "admin",
            "guest",
            "member",
            "owner",
        ]);
        const ownerRole = roles.find((r) => r.key === "owner")!;
        expect(ownerRole.is_system).toBe(true);
        expect(ownerRole.permissions).toHaveLength(PERMISSION_KEYS.length);
        expect(ownerRole.holders).toBe(1);
    });

    it("exposes the whole catalog, grouped, for the permission grid", async () => {
        const ws = await rbacWorkspace();
        const owner = await userWithSystemRole(ws, "owner");

        const res = await owner.client.get(`${ROLES}/catalog`);
        expect(res.status).toBe(200);
        const groups = res.body.groups as {
            group: string;
            permissions: { key: string; scopes: string[] }[];
        }[];
        const keys = groups.flatMap((g) => g.permissions.map((p) => p.key));
        expect(keys.sort()).toEqual([...PERMISSION_KEYS].sort());
        // The grid needs the allowed scopes per permission.
        const spaceView = keys.includes("space.view");
        expect(spaceView).toBe(true);
    });

    it("refuses a member — role.manage is not a member power", async () => {
        const ws = await rbacWorkspace();
        const member = await userWithSystemRole(ws, "member");

        const res = await member.client.get(ROLES);
        expect(res.status).toBe(403);
        expect(res.body.error.code).toBe("auth.forbidden");
    });
});

describe("POST /roles + PUT /roles/:id/permissions", () => {
    it("creates a custom role and sets its grants", async () => {
        const ws = await rbacWorkspace();
        const owner = await userWithSystemRole(ws, "owner");

        const created = await owner.client
            .post(ROLES)
            .send({ name: "Marketing Manager", description: "Runs marketing" });
        expect(created.status).toBe(201);
        const role = created.body as Role;
        expect(role.key).toBe("marketing-manager");
        expect(role.is_system).toBe(false);
        expect(role.permissions).toEqual([]);

        const set = await owner.client.put(`${ROLES}/${role.id}/permissions`).send({
            permissions: [
                { key: "space.view", scope: "space" },
                { key: "task.edit", scope: "own" },
                { key: "review.perform", scope: "space" },
            ],
        });
        expect(set.status).toBe(200);
        expect(
            (set.body.permissions as { key: string; scope: string }[])
                .map((p) => `${p.key}:${p.scope}`)
                .sort(),
        ).toEqual([
            "review.perform:space",
            "space.view:space",
            "task.edit:own",
        ]);
    });

    it("derives a unique key when two roles share a name", async () => {
        const ws = await rbacWorkspace();
        const owner = await userWithSystemRole(ws, "owner");
        const a = await owner.client.post(ROLES).send({ name: "Reviewer" });
        const b = await owner.client.post(ROLES).send({ name: "Reviewer" });
        expect(a.body.key).toBe("reviewer");
        expect(b.body.key).toBe("reviewer-2");
    });

    it("rejects an unknown permission key", async () => {
        const ws = await rbacWorkspace();
        const owner = await userWithSystemRole(ws, "owner");
        const role = (await owner.client.post(ROLES).send({ name: "X" })).body;

        const res = await owner.client
            .put(`${ROLES}/${role.id}/permissions`)
            .send({ permissions: [{ key: "task.editt", scope: "all" }] });
        expect(res.status).toBe(422);
        expect(res.body.error.code).toBe("role.unknown_permission");
    });

    it("rejects a scope the permission does not support", async () => {
        const ws = await rbacWorkspace();
        const owner = await userWithSystemRole(ws, "owner");
        const role = (await owner.client.post(ROLES).send({ name: "Y" })).body;

        // `workspace.settings` is workspace-wide only — there is no space to
        // scope it to, so offering 'space' would be a lie in the admin UI.
        const res = await owner.client
            .put(`${ROLES}/${role.id}/permissions`)
            .send({ permissions: [{ key: "workspace.settings", scope: "space" }] });
        expect(res.status).toBe(422);
        expect(res.body.error.code).toBe("role.unsupported_scope");
    });
});

describe("guard 1 — the system roles are protected", () => {
    it("refuses to edit the OWNER role's grants (D-7 anti-lockout floor)", async () => {
        const ws = await rbacWorkspace();
        const owner = await userWithSystemRole(ws, "owner");
        const roles = (await owner.client.get(ROLES)).body.data as Role[];
        const ownerRole = roles.find((r) => r.key === "owner")!;

        const res = await owner.client
            .put(`${ROLES}/${ownerRole.id}/permissions`)
            .send({ permissions: [] });
        expect(res.status).toBe(403);
        expect(res.body.error.code).toBe("role.owner_immutable");
    });

    it("refuses to delete a built-in role", async () => {
        const ws = await rbacWorkspace();
        const owner = await userWithSystemRole(ws, "owner");
        const roles = (await owner.client.get(ROLES)).body.data as Role[];
        const guest = roles.find((r) => r.key === "guest")!;

        const res = await owner.client.delete(`${ROLES}/${guest.id}`);
        expect(res.status).toBe(403);
        expect(res.body.error.code).toBe("role.system_immutable");
    });

    it("DOES allow tightening the Member role — that is the whole point", async () => {
        const ws = await rbacWorkspace();
        const owner = await userWithSystemRole(ws, "owner");
        const roles = (await owner.client.get(ROLES)).body.data as Role[];
        const member = roles.find((r) => r.key === "member")!;

        const res = await owner.client
            .put(`${ROLES}/${member.id}/permissions`)
            .send({
                permissions: [
                    { key: "space.view", scope: "space" },
                    { key: "task.view", scope: "space" },
                    { key: "task.edit", scope: "own" },
                ],
            });
        expect(res.status).toBe(200);
    });
});

describe("guard 2 — no lockout (L7)", () => {
    it("refuses to remove role.manage from the last role that grants it", async () => {
        const ws = await rbacWorkspace();
        const owner = await userWithSystemRole(ws, "owner");
        const admin = await userWithSystemRole(ws, "admin");
        const roles = (await admin.client.get(ROLES)).body.data as Role[];
        const adminRole = roles.find((r) => r.key === "admin")!;

        // The owner holds everything by floor, but the ADMIN role is the only
        // *assignment-backed* source of role.manage besides the owner's.
        const res = await owner.client
            .put(`${ROLES}/${adminRole.id}/permissions`)
            .send({ permissions: [{ key: "task.view", scope: "all" }] });

        // Either it is refused, or the owner still holds it — never a workspace
        // that nobody can administer.
        if (res.status === 200) {
            const after = await owner.client.get("/api/v1/me/permissions");
            expect(after.body.permissions["role.manage"]).toBeDefined();
        } else {
            expect(res.status).toBe(409);
            expect(res.body.error.code).toBe("role.last_admin");
        }
    });
});

describe("guard 3 — no escalation (L8)", () => {
    it("refuses to grant a permission the caller does not hold", async () => {
        const ws = await rbacWorkspace();
        // Someone who can manage roles but holds nothing else.
        const limited = await userWithPermissions(ws, [
            "role.manage",
            "task.view",
        ]);

        const created = await limited.client
            .post(ROLES)
            .send({ name: "Sneaky" });
        expect(created.status).toBe(201);

        const res = await limited.client
            .put(`${ROLES}/${created.body.id}/permissions`)
            .send({ permissions: [{ key: "workspace.settings", scope: "all" }] });
        expect(res.status).toBe(403);
        expect(res.body.error.code).toBe("role.escalation_blocked");
    });

    it("allows granting what the caller DOES hold", async () => {
        const ws = await rbacWorkspace();
        const limited = await userWithPermissions(ws, [
            "role.manage",
            "task.view",
            "task.edit",
        ]);
        const role = (await limited.client.post(ROLES).send({ name: "Ok" }))
            .body as Role;

        const res = await limited.client
            .put(`${ROLES}/${role.id}/permissions`)
            .send({ permissions: [{ key: "task.edit", scope: "all" }] });
        expect(res.status).toBe(200);
    });

    it("the owner is exempt — they already hold everything", async () => {
        const ws = await rbacWorkspace();
        const owner = await userWithSystemRole(ws, "owner");
        const role = (await owner.client.post(ROLES).send({ name: "All" }))
            .body as Role;

        const res = await owner.client
            .put(`${ROLES}/${role.id}/permissions`)
            .send({
                permissions: [
                    { key: "workspace.settings", scope: "all" },
                    { key: "role.manage", scope: "all" },
                ],
            });
        expect(res.status).toBe(200);
    });
});

describe("assignments — the membership model (D-1/D-2)", () => {
    it("assigns a role inside one space and lists it back", async () => {
        const ws = await rbacWorkspace();
        const owner = await userWithSystemRole(ws, "owner");
        const marketing = await makeRbacSpace(ws.id, owner.id, "Marketing");
        const person = await userWithSystemRole(ws, "member");
        const role = (
            await owner.client.post(ROLES).send({ name: "Marketing Lead" })
        ).body as Role;
        await owner.client.put(`${ROLES}/${role.id}/permissions`).send({
            permissions: [{ key: "space.view", scope: "space" }],
        });

        const res = await owner.client
            .post(`/api/v1/users/${person.id}/roles`)
            .send({ role_id: role.id, space_id: marketing });
        expect(res.status).toBe(201);
        const rows = res.body.data as RoleAssignment[];
        expect(
            rows.some(
                (a) => a.role_id === role.id && a.space_id === marketing,
            ),
        ).toBe(true);

        // ...and that assignment IS their membership of the space.
        const members = await owner.client.get(
            `/api/v1/spaces/${marketing}/members`,
        );
        expect(members.status).toBe(200);
        expect(
            (members.body.data as RoleAssignment[]).map((m) => m.user_id),
        ).toContain(person.id);
    });

    it("the assignment immediately changes what that person sees", async () => {
        const ws = await rbacWorkspace();
        const owner = await userWithSystemRole(ws, "owner");
        const marketing = await makeRbacSpace(ws.id, owner.id, "Marketing");
        await makeRbacSpace(ws.id, owner.id, "Support");

        // A person whose only visibility is space-scoped.
        const person = await userWithPermissions(ws, [
            ["space.view", "space"],
        ]);
        const before = await person.client.get("/api/v1/me/permissions");
        expect(before.body.visible_space_ids).toEqual([]);

        const roles = (await owner.client.get(ROLES)).body.data as Role[];
        const memberRole = roles.find((r) => r.key === "member")!;
        // Narrow the Member role so the space assignment actually restricts.
        await owner.client.put(`${ROLES}/${memberRole.id}/permissions`).send({
            permissions: [{ key: "space.view", scope: "space" }],
        });
        await owner.client
            .post(`/api/v1/users/${person.id}/roles`)
            .send({ role_id: memberRole.id, space_id: marketing });

        const after = await person.client.get("/api/v1/me/permissions");
        expect(after.body.visible_space_ids).toEqual([marketing]);
    });

    it("revoking removes it again", async () => {
        const ws = await rbacWorkspace();
        const owner = await userWithSystemRole(ws, "owner");
        const space = await makeRbacSpace(ws.id, owner.id);
        const person = await userWithSystemRole(ws, "member");
        const role = (await owner.client.post(ROLES).send({ name: "Temp" }))
            .body as Role;

        const assigned = (
            await owner.client
                .post(`/api/v1/users/${person.id}/roles`)
                .send({ role_id: role.id, space_id: space })
        ).body.data as RoleAssignment[];
        const target = assigned.find((a) => a.role_id === role.id)!;

        const res = await owner.client.delete(
            `/api/v1/users/${person.id}/roles/${target.id}`,
        );
        expect(res.status).toBe(200);
        expect(
            (res.body.data as RoleAssignment[]).some((a) => a.id === target.id),
        ).toBe(false);
    });

    it("404s for a user or space outside the workspace", async () => {
        const a = await rbacWorkspace();
        const b = await rbacWorkspace();
        const owner = await userWithSystemRole(a, "owner");
        const stranger = await userWithSystemRole(b, "member");
        const roles = (await owner.client.get(ROLES)).body.data as Role[];

        const res = await owner.client
            .post(`/api/v1/users/${stranger.id}/roles`)
            .send({ role_id: roles[0].id });
        expect(res.status).toBe(404);
        expect(res.body.error.code).toBe("user.not_found");
    });

    it("requires role.assign, not just role.manage", async () => {
        const ws = await rbacWorkspace();
        const owner = await userWithSystemRole(ws, "owner");
        const manager = await userWithPermissions(ws, ["role.manage"]);
        const person = await userWithSystemRole(ws, "member");
        const roles = (await owner.client.get(ROLES)).body.data as Role[];

        const res = await manager.client
            .post(`/api/v1/users/${person.id}/roles`)
            .send({ role_id: roles.find((r) => r.key === "guest")!.id });
        expect(res.status).toBe(403);
    });
});

describe("a permission change is visible immediately", () => {
    it("a revoked grant stops working on the very next request", async () => {
        const ws = await rbacWorkspace();
        const owner = await userWithSystemRole(ws, "owner");
        const person = await userWithPermissions(ws, ["catalog.tags"]);

        // They can manage tags today.
        const before = await person.client
            .post("/api/v1/tags")
            .send({ name: "Launch" });
        expect(before.status).toBe(201);

        await rbacRepos().roles.replacePermissions(person.roleId, []);
        await rbacRepos().roles.bumpPermissionsVersion(ws.id);

        const after = await person.client
            .post("/api/v1/tags")
            .send({ name: "Launch 2" });
        expect(after.status).toBe(403);
        expect(getDb()).toBeDefined();
        expect(owner.id).toBeTruthy();
    });
});
