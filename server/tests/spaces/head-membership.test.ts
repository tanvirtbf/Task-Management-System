import { and, eq } from "drizzle-orm";
import {
    makeUser,
    makeSpace,
    makeWorkspace,
    makeLoggedInClient,
} from "../test-utils/factories";
import { getDb } from "../../src/db/client";
import { userRoleGrants, users } from "../../src/db/schema";

/**
 * Team-access P1 — the G2 fix at its source: installing a department head
 * (POST /spaces with `head_user_id`, or PATCH /spaces/:id) must ALSO make that
 * person a member of the space (`user_roles` scope row) and give them a home
 * team if they had none. `spaces.head_user_id` alone creates no membership —
 * that was the landmine that would lock every head out of their own
 * department when visibility narrows (plan P6).
 *
 * Harness mirrors `update.test.ts`: real factories, HTTP layer, per-test
 * truncation via setup-each-spaces. RUN ONE FILE PER JEST PROCESS.
 */
jest.setTimeout(30000);

const membershipRows = async (userId: string, spaceId: string) =>
    getDb()
        .select({ id: userRoleGrants.id })
        .from(userRoleGrants)
        .where(
            and(
                eq(userRoleGrants.userId, userId),
                eq(userRoleGrants.scopeType, "space"),
                eq(userRoleGrants.scopeId, spaceId),
            ),
        );

const primaryOf = async (userId: string): Promise<string | null> => {
    const rows = await getDb()
        .select({ p: users.primarySpaceId })
        .from(users)
        .where(eq(users.id, userId));
    return rows[0]?.p ?? null;
};

describe("head assignment syncs membership (G2)", () => {
    it("PATCH /spaces/:id {head_user_id} gives the head a membership row + home team", async () => {
        const ws = await makeWorkspace();
        const owner = await makeUser({ workspaceId: ws.id, role: "owner" });
        const head = await makeUser({ workspaceId: ws.id, role: "member" });
        const space = await makeSpace({
            workspaceId: ws.id,
            createdBy: owner.id,
        });
        const client = await makeLoggedInClient({
            id: owner.id,
            workspaceId: ws.id,
            role: "owner",
        });

        expect(await membershipRows(head.id, space.id)).toHaveLength(0);

        const res = await client
            .patch(`/api/v1/spaces/${space.id}`)
            .send({ head_user_id: head.id });
        expect(res.status).toBe(200);
        expect(res.body.head_user_id).toBe(head.id);

        expect(await membershipRows(head.id, space.id)).toHaveLength(1);
        expect(await primaryOf(head.id)).toBe(space.id);
    });

    it("POST /spaces with head_user_id does the same at creation", async () => {
        const ws = await makeWorkspace();
        const owner = await makeUser({ workspaceId: ws.id, role: "owner" });
        const head = await makeUser({ workspaceId: ws.id, role: "member" });
        const client = await makeLoggedInClient({
            id: owner.id,
            workspaceId: ws.id,
            role: "owner",
        });

        const res = await client.post("/api/v1/spaces").send({
            name: "Ops",
            head_user_id: head.id,
        });
        expect(res.status).toBe(201);
        const spaceId = res.body.id as string;

        expect(await membershipRows(head.id, spaceId)).toHaveLength(1);
        expect(await primaryOf(head.id)).toBe(spaceId);
    });

    it("changing the head keeps the OLD head's membership, and never steals an existing home team", async () => {
        const ws = await makeWorkspace();
        const owner = await makeUser({ workspaceId: ws.id, role: "owner" });
        const first = await makeUser({ workspaceId: ws.id, role: "member" });
        const second = await makeUser({ workspaceId: ws.id, role: "member" });
        const space = await makeSpace({
            workspaceId: ws.id,
            createdBy: owner.id,
        });
        const other = await makeSpace({
            workspaceId: ws.id,
            createdBy: owner.id,
        });
        const client = await makeLoggedInClient({
            id: owner.id,
            workspaceId: ws.id,
            role: "owner",
        });

        // `second` already calls another space home.
        await getDb()
            .update(users)
            .set({ primarySpaceId: other.id })
            .where(eq(users.id, second.id));

        await client
            .patch(`/api/v1/spaces/${space.id}`)
            .send({ head_user_id: first.id });
        await client
            .patch(`/api/v1/spaces/${space.id}`)
            .send({ head_user_id: second.id });

        // Old head: no longer head, still on the team.
        expect(await membershipRows(first.id, space.id)).toHaveLength(1);
        // New head: member of the space they now lead...
        expect(await membershipRows(second.id, space.id)).toHaveLength(1);
        // ...but their existing home team is untouched.
        expect(await primaryOf(second.id)).toBe(other.id);
    });

    it("re-asserting the same head is idempotent (no duplicate membership rows)", async () => {
        const ws = await makeWorkspace();
        const owner = await makeUser({ workspaceId: ws.id, role: "owner" });
        const head = await makeUser({ workspaceId: ws.id, role: "member" });
        const space = await makeSpace({
            workspaceId: ws.id,
            createdBy: owner.id,
        });
        const client = await makeLoggedInClient({
            id: owner.id,
            workspaceId: ws.id,
            role: "owner",
        });

        await client
            .patch(`/api/v1/spaces/${space.id}`)
            .send({ head_user_id: head.id });
        await client
            .patch(`/api/v1/spaces/${space.id}`)
            .send({ head_user_id: head.id });

        expect(await membershipRows(head.id, space.id)).toHaveLength(1);
    });
});
