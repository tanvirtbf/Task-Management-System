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
 * Team-access P3 (plan G13) — the checklist audit gaps:
 *   - rename gets a `checklist_renamed` row with the before/after,
 *   - a position-only shuffle stays silent (presentation, not history),
 *   - the bulk item path writes per-item rows like the single path,
 *   - item edits carry field-level detail (text before/after).
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
    const checklist = (
        await client
            .post(`/api/v1/tasks/${task.id}/checklists`)
            .send({ name: "QA pass" })
    ).body;
    return { ws, user, client, task, checklist };
};

describe("P3 — checklist audit gaps closed", () => {
    it("rename writes checklist_renamed {from,to}; a position-only patch stays silent", async () => {
        const { client, task, checklist } = await seed();

        const renamed = await client
            .patch(`/api/v1/checklists/${checklist.id}`)
            .send({ name: "Release checks" });
        expect(renamed.status).toBe(200);

        const rows = (await activityFor(task.id)).filter(
            (a) => a.action === "checklist_renamed",
        );
        expect(rows).toHaveLength(1);
        expect(rows[0].context).toMatchObject({
            checklist_id: checklist.id,
            from: "QA pass",
            to: "Release checks",
        });

        const moved = await client
            .patch(`/api/v1/checklists/${checklist.id}`)
            .send({ position: 3 });
        expect(moved.status).toBe(200);
        expect(
            (await activityFor(task.id)).filter(
                (a) => a.action === "checklist_renamed",
            ),
        ).toHaveLength(1); // still just the one — no noise for drags
    });

    it("bulk item add writes one checklist_item_added row per item, flagged bulk", async () => {
        const { client, task, checklist } = await seed();
        const res = await client
            .post(`/api/v1/checklists/${checklist.id}/items/bulk`)
            .send({ texts: ["one", "two", "three"] });
        expect(res.status).toBe(201);

        const rows = (await activityFor(task.id)).filter(
            (a) => a.action === "checklist_item_added",
        );
        expect(rows).toHaveLength(3);
        for (const row of rows) {
            expect(row.context).toMatchObject({
                checklist_id: checklist.id,
                bulk: true,
            });
            expect(
                typeof (row.context as { text?: string }).text,
            ).toBe("string");
        }
    });

    it("an item text edit records the before/after", async () => {
        const { client, task, checklist } = await seed();
        const item = (
            await client
                .post(`/api/v1/checklists/${checklist.id}/items`)
                .send({ text: "old wording" })
        ).body;

        const res = await client
            .patch(`/api/v1/checklist-items/${item.id}`)
            .send({ text: "new wording" });
        expect(res.status).toBe(200);

        const row = (await activityFor(task.id)).find(
            (a) => a.action === "checklist_item_updated",
        );
        expect(row?.context).toMatchObject({
            checklist_id: checklist.id,
            item_id: item.id,
            fields: ["text"],
            text_from: "old wording",
            text_to: "new wording",
        });
    });
});
