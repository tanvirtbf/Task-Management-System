import { eq } from "drizzle-orm";
import {
    makeWorkspace,
    makeUser,
    makeLoggedInClient,
    makeTask,
} from "../test-utils/factories";
import { getDb } from "../../src/db/client";
import { attachments, taskActivity } from "../../src/db/schema";
import { fakeId } from "../../src/utils";

/**
 * Team-access P3 (plan G13) — attachments finally show up in the task's audit
 * log. The service wrote NO `task_activity` at all: files appeared and
 * vanished with no trace of who did it.
 *
 *   - the FIRST finalize (pending→complete) writes `attachment_added`,
 *   - an idempotent re-finalize writes nothing more,
 *   - a delete writes `attachment_removed`.
 *
 * R2Service is the no-network stub under test (see finalize.test.ts).
 */

jest.setTimeout(30_000);

const db = () => getDb();
const activityFor = async (taskId: string) =>
    db().select().from(taskActivity).where(eq(taskActivity.taskId, taskId));

const seed = async () => {
    const ws = await makeWorkspace();
    const user = await makeUser({ workspaceId: ws.id, role: "member" });
    const client = await makeLoggedInClient(user);
    const task = await makeTask({ workspaceId: ws.id, createdBy: user.id });
    const insertPending = async () => {
        const id = fakeId("att");
        await db()
            .insert(attachments)
            .values({
                id,
                taskId: task.id,
                name: "spec.pdf",
                storageKey: `workspaces/${ws.id}/attachments/${id}.pdf`,
                mimeType: "application/pdf",
                sizeBytes: BigInt(1000),
                uploadedBy: user.id,
                uploadStatus: "pending",
            });
        return id;
    };
    return { ws, user, client, task, insertPending };
};

describe("P3 — attachment add/remove are audited", () => {
    it("the first finalize writes attachment_added; a re-finalize does not duplicate it", async () => {
        const { user, client, task, insertPending } = await seed();
        const id = await insertPending();

        const first = await client
            .post(`/api/v1/attachments/${id}/finalize`)
            .send({});
        expect(first.status).toBe(200);

        let rows = (await activityFor(task.id)).filter(
            (a) => a.action === "attachment_added",
        );
        expect(rows).toHaveLength(1);
        expect(rows[0].actorId).toBe(user.id);
        expect(rows[0].context).toMatchObject({
            attachment_id: id,
            name: "spec.pdf",
        });

        const again = await client
            .post(`/api/v1/attachments/${id}/finalize`)
            .send({});
        expect(again.status).toBe(200);
        rows = (await activityFor(task.id)).filter(
            (a) => a.action === "attachment_added",
        );
        expect(rows).toHaveLength(1); // idempotent re-verify — no second row
    });

    it("deleting an attachment writes attachment_removed with the file name", async () => {
        const { user, client, task, insertPending } = await seed();
        const id = await insertPending();
        await client.post(`/api/v1/attachments/${id}/finalize`).send({});

        const res = await client.delete(`/api/v1/attachments/${id}`);
        expect(res.status).toBe(204);

        const rows = (await activityFor(task.id)).filter(
            (a) => a.action === "attachment_removed",
        );
        expect(rows).toHaveLength(1);
        expect(rows[0].actorId).toBe(user.id);
        expect(rows[0].context).toMatchObject({
            attachment_id: id,
            name: "spec.pdf",
        });
    });
});
