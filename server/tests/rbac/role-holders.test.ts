import { resetPolicy } from "../../src/rbac/policy";
import {
    assignRole,
    makeRbacSpace,
    makeRole,
    rbacWorkspace,
    userWithPermissions,
    userWithSystemRole,
} from "./helpers";

/**
 * `GET /api/v1/roles/:id/holders` — who actually holds this role.
 *
 * Written because a P3 audit of the route table against the test suite found
 * this endpoint had **no test at all**: not a happy path, not a guard, nothing.
 * Its neighbours in `roles.ts` are covered by `roles-api.test.ts`, and the LIST
 * endpoint's `holders` COUNT is asserted there — which is probably how it went
 * unnoticed, since "holders" appears in the suite and looks covered.
 *
 * It matters more than its size suggests. This is the endpoint a
 * role-assignment UI calls before letting someone delete or re-grant a role, so
 * it is the answer to "who will this affect?" — and it reports on the
 * permission system itself, which makes any scoping mistake in it a disclosure
 * of who holds power in a workspace.
 */

beforeAll(() => resetPolicy());

const holdersUrl = (roleId: string): string =>
    `/api/v1/roles/${roleId}/holders`;

interface WireHolder {
    user_id: string;
    scope_type: string;
    space_id: string | null;
}

const holdersOf = (body: unknown): WireHolder[] =>
    (body as { data: WireHolder[] }).data;

describe("GET /roles/:id/holders", () => {
    describe("Happy path", () => {
        it("lists a workspace-wide holder with a null space", async () => {
            const ws = await rbacWorkspace();
            const owner = await userWithSystemRole(ws, "owner");
            const member = await userWithSystemRole(ws, "member");

            const res = await owner.client.get(
                holdersUrl(ws.systemRoleIds.member),
            );

            expect(res.status).toBe(200);
            expect(holdersOf(res.body)).toEqual([
                {
                    user_id: member.id,
                    scope_type: "workspace",
                    space_id: null,
                },
            ]);
        });

        it("reports the SPACE a scoped grant is limited to", async () => {
            // The distinction the caller needs: "holds this everywhere" and
            // "holds this in Marketing only" are very different answers to
            // "who will deleting this role affect?".
            const ws = await rbacWorkspace();
            const owner = await userWithSystemRole(ws, "owner");
            const spaceId = await makeRbacSpace(ws.id, owner.id, "Marketing");
            const roleId = await makeRole(ws.id, { grants: ["task.view"] });
            const scoped = await userWithSystemRole(ws, "member");

            await assignRole({
                workspaceId: ws.id,
                userId: scoped.id,
                roleId,
                spaceId,
            });

            const res = await owner.client.get(holdersUrl(roleId));

            expect(res.status).toBe(200);
            expect(holdersOf(res.body)).toEqual([
                { user_id: scoped.id, scope_type: "space", space_id: spaceId },
            ]);
        });

        it("returns an empty list for a role nobody holds", async () => {
            const ws = await rbacWorkspace();
            const owner = await userWithSystemRole(ws, "owner");
            const roleId = await makeRole(ws.id, { grants: ["task.view"] });

            const res = await owner.client.get(holdersUrl(roleId));

            expect(res.status).toBe(200);
            expect(holdersOf(res.body)).toEqual([]);
        });

        it("lists every holder when one role is held by several people", async () => {
            const ws = await rbacWorkspace();
            const owner = await userWithSystemRole(ws, "owner");
            const a = await userWithSystemRole(ws, "member");
            const b = await userWithSystemRole(ws, "member");
            const c = await userWithSystemRole(ws, "guest");

            const res = await owner.client.get(
                holdersUrl(ws.systemRoleIds.member),
            );

            expect(res.status).toBe(200);
            const ids = holdersOf(res.body)
                .map((h) => h.user_id)
                .sort();
            expect(ids).toEqual([a.id, b.id].sort());
            expect(ids).not.toContain(c.id);
        });

        it("counts one person twice when they hold the role in two spaces", async () => {
            // A grant is per scope, so the same user legitimately appears once
            // per space. A caller deduplicating by user_id would under-report
            // the blast radius of removing the role from one space.
            const ws = await rbacWorkspace();
            const owner = await userWithSystemRole(ws, "owner");
            const mkt = await makeRbacSpace(ws.id, owner.id, "Marketing");
            const cs = await makeRbacSpace(ws.id, owner.id, "Customer Service");
            const roleId = await makeRole(ws.id, { grants: ["task.view"] });
            const person = await userWithSystemRole(ws, "member");

            await assignRole({
                workspaceId: ws.id,
                userId: person.id,
                roleId,
                spaceId: mkt,
            });
            await assignRole({
                workspaceId: ws.id,
                userId: person.id,
                roleId,
                spaceId: cs,
            });

            const res = await owner.client.get(holdersUrl(roleId));

            expect(res.status).toBe(200);
            const rows = holdersOf(res.body);
            expect(rows).toHaveLength(2);
            expect(rows.map((r) => r.space_id).sort()).toEqual(
                [mkt, cs].sort(),
            );
            expect(new Set(rows.map((r) => r.user_id))).toEqual(
                new Set([person.id]),
            );
        });
    });

    describe("Authorization — `role.manage`", () => {
        it("allows a non-owner who holds role.manage", async () => {
            // The gate is the permission, not the legacy role tier: this is a
            // dynamic-RBAC endpoint and a custom role carrying `role.manage`
            // must reach it.
            const ws = await rbacWorkspace();
            const actor = await userWithPermissions(ws, ["role.manage"]);

            const res = await actor.client.get(
                holdersUrl(ws.systemRoleIds.member),
            );

            expect(res.status).toBe(200);
        });

        it("refuses a member with no role.manage (403)", async () => {
            const ws = await rbacWorkspace();
            const member = await userWithSystemRole(ws, "member");

            const res = await member.client.get(
                holdersUrl(ws.systemRoleIds.member),
            );

            expect(res.status).toBe(403);
        });

        it("refuses a guest (403)", async () => {
            const ws = await rbacWorkspace();
            const guest = await userWithSystemRole(ws, "guest");

            const res = await guest.client.get(
                holdersUrl(ws.systemRoleIds.member),
            );

            expect(res.status).toBe(403);
        });

        it("requires authentication (401)", async () => {
            const ws = await rbacWorkspace();
            const { oneOff } = await import("../test-utils/app");
            const res = await (await oneOff()).get(
                holdersUrl(ws.systemRoleIds.member),
            );

            expect(res.status).toBe(401);
        });
    });

    describe("Unknown and foreign roles", () => {
        it("returns 404 role.not_found for an id that does not exist", async () => {
            const ws = await rbacWorkspace();
            const owner = await userWithSystemRole(ws, "owner");

            const res = await owner.client.get(holdersUrl("rl-does-not-exist"));

            expect(res.status).toBe(404);
            expect((res.body as { error: { code: string } }).error.code).toBe(
                "role.not_found",
            );
        });

        it("returns 404 for a role belonging to another workspace", async () => {
            // Not 403: a role id you cannot see does not exist, or the status
            // code itself becomes a way to discover another workspace's roles.
            const mine = await rbacWorkspace("Us Ltd");
            const theirs = await rbacWorkspace("Neighbour Ltd");
            const owner = await userWithSystemRole(mine, "owner");

            const res = await owner.client.get(
                holdersUrl(theirs.systemRoleIds.admin),
            );

            expect(res.status).toBe(404);
        });

        it("never reports a holder from another workspace", async () => {
            // The rows are keyed by (role, workspace). If the workspace half of
            // that filter were ever dropped, this is where it would show.
            const mine = await rbacWorkspace("Us Ltd");
            const theirs = await rbacWorkspace("Neighbour Ltd");
            const owner = await userWithSystemRole(mine, "owner");
            const myMember = await userWithSystemRole(mine, "member");
            await userWithSystemRole(theirs, "member");

            const res = await owner.client.get(
                holdersUrl(mine.systemRoleIds.member),
            );

            expect(res.status).toBe(200);
            expect(holdersOf(res.body).map((h) => h.user_id)).toEqual([
                myMember.id,
            ]);
        });
    });
});
