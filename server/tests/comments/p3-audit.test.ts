import { eq } from "drizzle-orm";
import {
    makeWorkspace,
    makeUser,
    makeLoggedInClient,
    makeTask,
} from "../test-utils/factories";
import { getDb } from "../../src/db/client";
import { taskActivity } from "../../src/db/schema";

/**
 * Team-access P3 (plan G13) — comment EDIT and DELETE finally leave audit
 * rows. Before this, the create was logged (`comment_posted`) and every later
 * change to the record was invisible — including an admin deleting someone
 * else's words.
 */

jest.setTimeout(30_000);

const listPath = (taskId: string) => `/api/v1/tasks/${taskId}/comments`;
const onePath = (id: string) => `/api/v1/comments/${id}`;
const db = () => getDb();

const activityFor = async (taskId: string) =>
    db().select().from(taskActivity).where(eq(taskActivity.taskId, taskId));

const seed = async () => {
    const ws = await makeWorkspace();
    const user = await makeUser({ workspaceId: ws.id, role: "member" });
    const client = await makeLoggedInClient(user);
    const task = await makeTask({ workspaceId: ws.id, createdBy: user.id });
    return { ws, user, client, task };
};

describe("P3 — comment edit/delete are audited", () => {
    it("PATCH writes a comment_updated row in the same transaction", async () => {
        const { user, client, task } = await seed();
        const c = (await client.post(listPath(task.id)).send({ body: "v1" }))
            .body;
        const res = await client.patch(onePath(c.id)).send({ body: "v2" });
        expect(res.status).toBe(200);

        const rows = (await activityFor(task.id)).filter(
            (a) => a.action === "comment_updated",
        );
        expect(rows).toHaveLength(1);
        expect(rows[0].actorId).toBe(user.id);
        expect(rows[0].context).toMatchObject({ comment_id: c.id });
    });

    it("author delete writes comment_deleted with author_id", async () => {
        const { user, client, task } = await seed();
        const c = (await client.post(listPath(task.id)).send({ body: "bye" }))
            .body;
        const res = await client.delete(onePath(c.id));
        expect(res.status).toBe(204);

        const rows = (await activityFor(task.id)).filter(
            (a) => a.action === "comment_deleted",
        );
        expect(rows).toHaveLength(1);
        expect(rows[0].actorId).toBe(user.id);
        expect(rows[0].context).toMatchObject({
            comment_id: c.id,
            author_id: user.id,
        });
    });

    it("an ADMIN deleting someone else's comment is attributable (actor ≠ author)", async () => {
        const { ws, user, client, task } = await seed();
        const admin = await makeUser({ workspaceId: ws.id, role: "admin" });
        const adminClient = await makeLoggedInClient(admin);
        const c = (
            await client.post(listPath(task.id)).send({ body: "controversial" })
        ).body;

        const res = await adminClient.delete(onePath(c.id));
        expect(res.status).toBe(204);

        const rows = (await activityFor(task.id)).filter(
            (a) => a.action === "comment_deleted",
        );
        expect(rows).toHaveLength(1);
        expect(rows[0].actorId).toBe(admin.id); // WHO deleted
        expect(rows[0].context).toMatchObject({ author_id: user.id }); // WHOSE words
    });
});
