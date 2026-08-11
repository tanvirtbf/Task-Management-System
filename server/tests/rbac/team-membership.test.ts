import { and, eq } from "drizzle-orm";
import { getDb } from "../../src/db/client";
import * as schema from "../../src/db/schema";
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
 * Team-access P1 — the teams & membership endpoints.
 *
 *   GET    /teams                        the org-chart directory
 *   POST   /spaces/:id/members           add a person to a team
 *   DELETE /spaces/:id/members/:userId   remove them
 *   PATCH  /users/:id/team               set/clear the home team
 *
 * The management guard is the interesting part: admins everywhere, the team's
 * OWN head without any admin key, a `space.members_manage` grant only where
 * it reaches — everyone else 403.
 */

beforeAll(() => resetPolicy());

const db = () => getDb();

/** The user's space-scoped assignment rows in one space. */
const spaceRows = async (userId: string, spaceId: string) =>
    db()
        .select({
            id: schema.userRoleGrants.id,
            roleId: schema.userRoleGrants.roleId,
        })
        .from(schema.userRoleGrants)
        .where(
            and(
                eq(schema.userRoleGrants.userId, userId),
                eq(schema.userRoleGrants.scopeType, "space"),
                eq(schema.userRoleGrants.scopeId, spaceId),
            ),
        );

const primaryOf = async (userId: string): Promise<string | null> => {
    const rows = await db()
        .select({ p: schema.users.primarySpaceId })
        .from(schema.users)
        .where(eq(schema.users.id, userId));
    return rows[0]?.p ?? null;
};

const setHeadDirect = async (spaceId: string, userId: string | null) => {
    await db()
        .update(schema.spaces)
        .set({ headUserId: userId })
        .where(eq(schema.spaces.id, spaceId));
};

describe("GET /teams", () => {
    it("returns every team with head, members, home-team badges and the unassigned list", async () => {
        const ws = await rbacWorkspace();
        const owner = await userWithSystemRole(ws, "owner");
        const head = await userWithSystemRole(ws, "member");
        const member = await userWithSystemRole(ws, "member");
        const drifting = await userWithSystemRole(ws, "member");
        const spaceId = await makeRbacSpace(ws.id, owner.id, "Supply Chain");
        await setHeadDirect(spaceId, head.id);

        // Put both on the team through the real endpoint (owner acts).
        for (const u of [head, member]) {
            const res = await owner.client
                .post(`/api/v1/spaces/${spaceId}/members`)
                .send({ user_id: u.id });
            expect(res.status).toBe(204);
        }

        const res = await owner.client.get("/api/v1/teams");
        expect(res.status).toBe(200);
        const team = (
            res.body.data as {
                space: { id: string; name: string; head_user_id: string | null };
                head: { id: string } | null;
                members: {
                    user: { id: string; email: string };
                    role_key: string;
                    is_head: boolean;
                    is_primary: boolean;
                }[];
            }[]
        ).find((t) => t.space.id === spaceId)!;

        expect(team).toBeDefined();
        expect(team.space.name).toBe("Supply Chain");
        expect(team.space.head_user_id).toBe(head.id);
        expect(team.head?.id).toBe(head.id);

        const ids = team.members.map((m) => m.user.id).sort();
        expect(ids).toEqual([head.id, member.id].sort());
        const headRow = team.members.find((m) => m.user.id === head.id)!;
        expect(headRow.is_head).toBe(true);
        expect(headRow.role_key).toBe("member");
        // First team became home automatically → the badge is on.
        expect(headRow.is_primary).toBe(true);

        // Someone on no team at all shows up in the to-do list.
        const unassigned = (res.body.unassigned as { id: string }[]).map(
            (u) => u.id,
        );
        expect(unassigned).toContain(drifting.id);
        expect(unassigned).not.toContain(member.id);
    });

    it("is readable by a plain member (member.view), like the members list", async () => {
        const ws = await rbacWorkspace();
        const member = await userWithSystemRole(ws, "member");
        const res = await member.client.get("/api/v1/teams");
        expect(res.status).toBe(200);
        expect(Array.isArray(res.body.data)).toBe(true);
    });
});

describe("POST /spaces/:id/members", () => {
    it("admin adds a member: assignment row + first team becomes home", async () => {
        const ws = await rbacWorkspace();
        const admin = await userWithSystemRole(ws, "admin");
        const target = await userWithSystemRole(ws, "member");
        const spaceId = await makeRbacSpace(ws.id, admin.id);

        const res = await admin.client
            .post(`/api/v1/spaces/${spaceId}/members`)
            .send({ user_id: target.id });
        expect(res.status).toBe(204);

        const rows = await spaceRows(target.id, spaceId);
        expect(rows).toHaveLength(1);
        expect(rows[0].roleId).toBe(ws.systemRoleIds.member);
        expect(await primaryOf(target.id)).toBe(spaceId);
    });

    it("is idempotent, and a SECOND team never steals the home team", async () => {
        const ws = await rbacWorkspace();
        const admin = await userWithSystemRole(ws, "admin");
        const target = await userWithSystemRole(ws, "member");
        const first = await makeRbacSpace(ws.id, admin.id);
        const second = await makeRbacSpace(ws.id, admin.id);

        await admin.client
            .post(`/api/v1/spaces/${first}/members`)
            .send({ user_id: target.id });
        const again = await admin.client
            .post(`/api/v1/spaces/${first}/members`)
            .send({ user_id: target.id });
        expect(again.status).toBe(204);
        expect(await spaceRows(target.id, first)).toHaveLength(1);

        await admin.client
            .post(`/api/v1/spaces/${second}/members`)
            .send({ user_id: target.id });
        expect(await primaryOf(target.id)).toBe(first);
    });

    it("the team's OWN head manages their roster without any admin key", async () => {
        const ws = await rbacWorkspace();
        const owner = await userWithSystemRole(ws, "owner");
        const head = await userWithSystemRole(ws, "member");
        const target = await userWithSystemRole(ws, "member");
        const spaceId = await makeRbacSpace(ws.id, owner.id);
        await setHeadDirect(spaceId, head.id);

        const res = await head.client
            .post(`/api/v1/spaces/${spaceId}/members`)
            .send({ user_id: target.id });
        expect(res.status).toBe(204);
        expect(await spaceRows(target.id, spaceId)).toHaveLength(1);
    });

    it("a plain member is refused (403), and a head only rules their OWN team", async () => {
        const ws = await rbacWorkspace();
        const owner = await userWithSystemRole(ws, "owner");
        const head = await userWithSystemRole(ws, "member");
        const target = await userWithSystemRole(ws, "member");
        const theirs = await makeRbacSpace(ws.id, owner.id);
        const otherTeam = await makeRbacSpace(ws.id, owner.id);
        await setHeadDirect(theirs, head.id);

        const asMember = await target.client
            .post(`/api/v1/spaces/${theirs}/members`)
            .send({ user_id: target.id });
        expect(asMember.status).toBe(403);

        const outsideOwnTeam = await head.client
            .post(`/api/v1/spaces/${otherTeam}/members`)
            .send({ user_id: target.id });
        expect(outsideOwnTeam.status).toBe(403);
    });

    it("a space-scoped `space.members_manage` grant reaches exactly its space", async () => {
        const ws = await rbacWorkspace();
        const owner = await userWithSystemRole(ws, "owner");
        const target = await userWithSystemRole(ws, "member");
        const inside = await makeRbacSpace(ws.id, owner.id);
        const outside = await makeRbacSpace(ws.id, owner.id);
        // Realistic manager: sees the workspace (`space.view` all), manages
        // rosters only where granted. A manager with NO view grant gets 404
        // before the guard — the space resolves through the scope-filtered
        // repo, deliberately (no existence oracle).
        const manager = await userWithPermissions(ws, ["space.view"]);
        const mgrRole = await makeRole(ws.id, {
            grants: [["space.members_manage", "space"]],
        });
        await assignRole({
            workspaceId: ws.id,
            userId: manager.id,
            roleId: mgrRole,
            spaceId: inside,
        });

        const ok = await manager.client
            .post(`/api/v1/spaces/${inside}/members`)
            .send({ user_id: target.id });
        expect(ok.status).toBe(204);

        const blocked = await manager.client
            .post(`/api/v1/spaces/${outside}/members`)
            .send({ user_id: target.id });
        expect(blocked.status).toBe(403);
    });

    it("refuses an archived team (409), unknown space/user (404), deactivated target (422)", async () => {
        const ws = await rbacWorkspace();
        const admin = await userWithSystemRole(ws, "admin");
        const target = await userWithSystemRole(ws, "member");
        const spaceId = await makeRbacSpace(ws.id, admin.id);

        const noSpace = await admin.client
            .post("/api/v1/spaces/sp-missing/members")
            .send({ user_id: target.id });
        expect(noSpace.status).toBe(404);

        const noUser = await admin.client
            .post(`/api/v1/spaces/${spaceId}/members`)
            .send({ user_id: "u-missing" });
        expect(noUser.status).toBe(404);

        await db()
            .update(schema.users)
            .set({ status: "deactivated" })
            .where(eq(schema.users.id, target.id));
        const gone = await admin.client
            .post(`/api/v1/spaces/${spaceId}/members`)
            .send({ user_id: target.id });
        expect(gone.status).toBe(422);
        expect(gone.body.error.code).toBe("team.member_invalid");

        await db()
            .update(schema.spaces)
            .set({ archivedAt: new Date() })
            .where(eq(schema.spaces.id, spaceId));
        const other = await userWithSystemRole(ws, "member");
        const archived = await admin.client
            .post(`/api/v1/spaces/${spaceId}/members`)
            .send({ user_id: other.id });
        expect(archived.status).toBe(409);
        expect(archived.body.error.code).toBe("space.archived");
    });
});

describe("DELETE /spaces/:id/members/:userId", () => {
    it("removes every space-scoped role and clears a home team that pointed here", async () => {
        const ws = await rbacWorkspace();
        const admin = await userWithSystemRole(ws, "admin");
        const target = await userWithSystemRole(ws, "member");
        const spaceId = await makeRbacSpace(ws.id, admin.id);

        await admin.client
            .post(`/api/v1/spaces/${spaceId}/members`)
            .send({ user_id: target.id });
        expect(await primaryOf(target.id)).toBe(spaceId);

        const res = await admin.client.delete(
            `/api/v1/spaces/${spaceId}/members/${target.id}`,
        );
        expect(res.status).toBe(204);
        expect(await spaceRows(target.id, spaceId)).toHaveLength(0);
        expect(await primaryOf(target.id)).toBeNull();
    });

    it("never removes the current head (409 team.head_locked)", async () => {
        const ws = await rbacWorkspace();
        const admin = await userWithSystemRole(ws, "admin");
        const head = await userWithSystemRole(ws, "member");
        const spaceId = await makeRbacSpace(ws.id, admin.id);
        await admin.client
            .post(`/api/v1/spaces/${spaceId}/members`)
            .send({ user_id: head.id });
        await setHeadDirect(spaceId, head.id);

        const res = await admin.client.delete(
            `/api/v1/spaces/${spaceId}/members/${head.id}`,
        );
        expect(res.status).toBe(409);
        expect(res.body.error.code).toBe("team.head_locked");
        expect(await spaceRows(head.id, spaceId)).toHaveLength(1);
    });

    it("removing a non-member is an idempotent 204; a plain member is 403", async () => {
        const ws = await rbacWorkspace();
        const admin = await userWithSystemRole(ws, "admin");
        const bystander = await userWithSystemRole(ws, "member");
        const spaceId = await makeRbacSpace(ws.id, admin.id);

        const idem = await admin.client.delete(
            `/api/v1/spaces/${spaceId}/members/${bystander.id}`,
        );
        expect(idem.status).toBe(204);

        const forbidden = await bystander.client.delete(
            `/api/v1/spaces/${spaceId}/members/${admin.id}`,
        );
        expect(forbidden.status).toBe(403);
    });
});

describe("PATCH /users/:id/team", () => {
    it("admin sets a home team — membership is ensured with it", async () => {
        const ws = await rbacWorkspace();
        const admin = await userWithSystemRole(ws, "admin");
        const target = await userWithSystemRole(ws, "member");
        const spaceId = await makeRbacSpace(ws.id, admin.id);

        const res = await admin.client
            .patch(`/api/v1/users/${target.id}/team`)
            .send({ space_id: spaceId });
        expect(res.status).toBe(204);
        expect(await primaryOf(target.id)).toBe(spaceId);
        expect(await spaceRows(target.id, spaceId)).toHaveLength(1);
    });

    it("null clears the pointer but membership stays", async () => {
        const ws = await rbacWorkspace();
        const admin = await userWithSystemRole(ws, "admin");
        const target = await userWithSystemRole(ws, "member");
        const spaceId = await makeRbacSpace(ws.id, admin.id);
        await admin.client
            .patch(`/api/v1/users/${target.id}/team`)
            .send({ space_id: spaceId });

        const res = await admin.client
            .patch(`/api/v1/users/${target.id}/team`)
            .send({ space_id: null });
        expect(res.status).toBe(204);
        expect(await primaryOf(target.id)).toBeNull();
        expect(await spaceRows(target.id, spaceId)).toHaveLength(1);
    });

    it("guards: member 403; missing body key, unknown or archived space 422; unknown user 404", async () => {
        const ws = await rbacWorkspace();
        const admin = await userWithSystemRole(ws, "admin");
        const member = await userWithSystemRole(ws, "member");
        const archived = await makeRbacSpace(ws.id, admin.id);
        await db()
            .update(schema.spaces)
            .set({ archivedAt: new Date() })
            .where(eq(schema.spaces.id, archived));

        const asMember = await member.client
            .patch(`/api/v1/users/${admin.id}/team`)
            .send({ space_id: null });
        expect(asMember.status).toBe(403);

        const noKey = await admin.client
            .patch(`/api/v1/users/${member.id}/team`)
            .send({});
        expect(noKey.status).toBe(422);

        const unknown = await admin.client
            .patch(`/api/v1/users/${member.id}/team`)
            .send({ space_id: "sp-missing" });
        expect(unknown.status).toBe(422);
        expect(unknown.body.error.code).toBe("team.space_invalid");

        const toArchived = await admin.client
            .patch(`/api/v1/users/${member.id}/team`)
            .send({ space_id: archived });
        expect(toArchived.status).toBe(422);

        const noUser = await admin.client
            .patch("/api/v1/users/u-missing/team")
            .send({ space_id: null });
        expect(noUser.status).toBe(404);
    });
});
