import { eq } from "drizzle-orm";
import { getDb } from "../../src/db/client";
import * as schema from "../../src/db/schema";
import { resetPolicy } from "../../src/rbac/policy";
import { makeTask } from "../test-utils/factories";
import {
    makeRbacList,
    makeRbacSpace,
    rbacWorkspace,
    userWithPermissions,
    userWithSystemRole,
} from "./helpers";

/**
 * Team-access P4 — team → team visibility grants ("Supply Chain can also SEE
 * Software"). The rows are consumed at the PolicyService actor fold, so ONE
 * grant makes spaces, lists and tasks in the target team readable through
 * every normal endpoint — and nothing else:
 *
 *   - sight is NOT touch: write keys stay exactly as narrow as before,
 *   - a grant is a single hop and only for the granted team,
 *   - grant/revoke bite on the very next request (permissions_version bump),
 *   - the endpoints are admin-only — a HEAD cannot self-expand their team.
 *
 * All of it is DORMANT today (every seeded role's `space.view` is `all`) —
 * the full-module regressions are the dormancy proof.
 */

beforeAll(() => resetPolicy());

const db = () => getDb();

const setHeadDirect = async (spaceId: string, userId: string | null) => {
    await db()
        .update(schema.spaces)
        .set({ headUserId: userId })
        .where(eq(schema.spaces.id, spaceId));
};

/** Two teams; a task in each; an admin to operate the grants. */
const seed = async () => {
    const ws = await rbacWorkspace();
    const admin = await userWithSystemRole(ws, "admin");
    const teamA = await makeRbacSpace(ws.id, admin.id, "Supply Chain");
    const teamB = await makeRbacSpace(ws.id, admin.id, "Software");
    const listA = await makeRbacList(ws.id, teamA, admin.id);
    const listB = await makeRbacList(ws.id, teamB, admin.id);
    const taskB = await makeTask({
        workspaceId: ws.id,
        listId: listB,
        createdBy: admin.id,
    });
    // The B1 team-role shape: sees own team; tasks reach = own (+ edit own,
    // so the sight-is-not-touch assertion exercises the SERVICE scope, not
    // just a missing route key).
    const viewer = await userWithPermissions(
        ws,
        [
            ["space.view", "space"],
            ["task.view", "own"],
            ["task.edit", "own"],
        ],
        { spaceId: teamA },
    );
    return { ws, admin, teamA, teamB, listA, listB, taskB, viewer };
};

const GRANTS = (viewerId: string) =>
    `/api/v1/spaces/${viewerId}/visibility-grants`;

describe("P4 — the grant turns sight on through every normal read", () => {
    it("before: invisible; after grant: space + task readable; after revoke: invisible again", async () => {
        const { admin, teamA, teamB, taskB, viewer } = await seed();

        // Before — the other team does not exist for this viewer.
        expect(
            (await viewer.client.get(`/api/v1/spaces/${teamB}`)).status,
        ).toBe(404);
        expect(
            (await viewer.client.get(`/api/v1/tasks/${taskB.id}`)).status,
        ).toBe(404);

        // Admin grants: Supply Chain can also see Software.
        const grant = await admin.client
            .post(GRANTS(teamA))
            .send({ target_space_id: teamB });
        expect(grant.status).toBe(204);

        // After — readable through the NORMAL endpoints, next request.
        expect(
            (await viewer.client.get(`/api/v1/spaces/${teamB}`)).status,
        ).toBe(200);
        expect(
            (await viewer.client.get(`/api/v1/tasks/${taskB.id}`)).status,
        ).toBe(200);
        const spaceList = await viewer.client.get("/api/v1/spaces");
        expect(
            (spaceList.body.data as { id: string }[]).map((s) => s.id),
        ).toContain(teamB);
        // The task's history follows the task (P2's reach rule).
        expect(
            (await viewer.client.get(`/api/v1/tasks/${taskB.id}/activity`))
                .status,
        ).toBe(200);

        // Revoke — sight gone on the very next request.
        const revoke = await admin.client.delete(
            `${GRANTS(teamA)}/${teamB}`,
        );
        expect(revoke.status).toBe(204);
        expect(
            (await viewer.client.get(`/api/v1/spaces/${teamB}`)).status,
        ).toBe(404);
    });

    it("sight is NOT touch: the granted team's tasks stay read-only for an own-scoped editor", async () => {
        const { admin, teamA, teamB, taskB, viewer } = await seed();
        await admin.client
            .post(GRANTS(teamA))
            .send({ target_space_id: teamB });

        const read = await viewer.client.get(`/api/v1/tasks/${taskB.id}`);
        expect(read.status).toBe(200);

        const write = await viewer.client
            .patch(`/api/v1/tasks/${taskB.id}`)
            .send({ priority: 1 });
        expect(write.status).toBe(403); // task.edit=own does not reach it
    });

    it("a grant reaches only the granted team — a third team stays invisible, and other viewers gain nothing", async () => {
        const { ws, admin, teamA, teamB, viewer } = await seed();
        const teamC = await makeRbacSpace(ws.id, admin.id, "Finance");
        const bystander = await userWithPermissions(
            ws,
            [["space.view", "space"]],
            { spaceId: teamC },
        );

        await admin.client
            .post(GRANTS(teamA))
            .send({ target_space_id: teamB });

        // The viewer got B, not C.
        expect(
            (await viewer.client.get(`/api/v1/spaces/${teamC}`)).status,
        ).toBe(404);
        // The bystander (team C) got nothing at all.
        expect(
            (await bystander.client.get(`/api/v1/spaces/${teamB}`)).status,
        ).toBe(404);
    });
});

describe("P4 — endpoint guards", () => {
    it("admin-only: a plain member AND a team head are both refused", async () => {
        const { ws, teamA, teamB } = await seed();
        const member = await userWithSystemRole(ws, "member");
        const head = await userWithSystemRole(ws, "member");
        await setHeadDirect(teamA, head.id);

        const asMember = await member.client
            .post(GRANTS(teamA))
            .send({ target_space_id: teamB });
        expect(asMember.status).toBe(403);

        // Deliberate: heads manage their roster, but must NOT be able to
        // self-expand what their own team can see.
        const asHead = await head.client
            .post(GRANTS(teamA))
            .send({ target_space_id: teamB });
        expect(asHead.status).toBe(403);
    });

    it("validates: self-grant 422, unknown/archived target 422, unknown viewer 404, idempotent both ways", async () => {
        const { ws, admin, teamA, teamB } = await seed();

        const self = await admin.client
            .post(GRANTS(teamA))
            .send({ target_space_id: teamA });
        expect(self.status).toBe(422);
        expect(self.body.error.code).toBe("team.grant_invalid");

        const unknown = await admin.client
            .post(GRANTS(teamA))
            .send({ target_space_id: "sp-missing" });
        expect(unknown.status).toBe(422);
        expect(unknown.body.error.code).toBe("team.space_invalid");

        const archived = await makeRbacSpace(ws.id, admin.id, "Old Dept");
        await db()
            .update(schema.spaces)
            .set({ archivedAt: new Date() })
            .where(eq(schema.spaces.id, archived));
        const toArchived = await admin.client
            .post(GRANTS(teamA))
            .send({ target_space_id: archived });
        expect(toArchived.status).toBe(422);

        const noViewer = await admin.client
            .post(GRANTS("sp-missing"))
            .send({ target_space_id: teamB });
        expect(noViewer.status).toBe(404);

        // Idempotent: double grant + double revoke are 204 no-ops.
        expect(
            (
                await admin.client
                    .post(GRANTS(teamA))
                    .send({ target_space_id: teamB })
            ).status,
        ).toBe(204);
        expect(
            (
                await admin.client
                    .post(GRANTS(teamA))
                    .send({ target_space_id: teamB })
            ).status,
        ).toBe(204);
        const rows = await db()
            .select()
            .from(schema.spaceVisibilityGrants)
            .where(eq(schema.spaceVisibilityGrants.viewerSpaceId, teamA));
        expect(rows).toHaveLength(1);
        expect(
            (await admin.client.delete(`${GRANTS(teamA)}/${teamB}`)).status,
        ).toBe(204);
        expect(
            (await admin.client.delete(`${GRANTS(teamA)}/${teamB}`)).status,
        ).toBe(204);
    });

    it("the Teams directory shows can_also_see", async () => {
        const { admin, teamA, teamB } = await seed();
        await admin.client
            .post(GRANTS(teamA))
            .send({ target_space_id: teamB });

        const res = await admin.client.get("/api/v1/teams");
        expect(res.status).toBe(200);
        const entry = (
            res.body.data as {
                space: { id: string };
                can_also_see: { id: string; name: string }[];
            }[]
        ).find((t) => t.space.id === teamA)!;
        expect(entry.can_also_see).toEqual([
            { id: teamB, name: "Software" },
        ]);
    });
});
