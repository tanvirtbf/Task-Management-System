import { eq, inArray } from "drizzle-orm";
import {
    makeLoggedInClient,
    makeTask,
    makeUser,
    makeWorkspace,
} from "../test-utils/factories";
import { getDb } from "../../src/db/client";
import { checklistItems, checklists, tasks } from "../../src/db/schema";

/**
 * The checklist rollup against RECOMPUTED TRUTH (upgrades/022).
 *
 * `counters.test.ts` walks a known sequence and checks the counter equals what
 * that sequence should produce. That catches a broken step in the sequence, but
 * not a step nobody put in the sequence — and the rollup is maintained by hand
 * inside every write transaction, which is exactly the shape that drifts when a
 * new write path forgets to call the recompute.
 *
 * So these ask the other question: after a mixed run of every mutating path,
 * does `tasks.checklist_items_total / _done` still equal a live COUNT over the
 * task's items? The counter is a cache; this asserts the cache has not gone
 * stale, without encoding what the answer should be.
 */

jest.setTimeout(30_000);

const listPath = (taskId: string) => `/api/v1/tasks/${taskId}/checklists`;
const clPath = (id: string) => `/api/v1/checklists/${id}`;
const itemsPath = (clId: string) => `/api/v1/checklists/${clId}/items`;
const bulkPath = (clId: string) => `/api/v1/checklists/${clId}/items/bulk`;
const itemPath = (id: string) => `/api/v1/checklist-items/${id}`;
const togglePath = (id: string) => `/api/v1/checklist-items/${id}/toggle`;

const seed = async () => {
    const ws = await makeWorkspace();
    const user = await makeUser({ workspaceId: ws.id, role: "member" });
    const client = await makeLoggedInClient(user);
    const task = await makeTask({ workspaceId: ws.id, createdBy: user.id });
    return { ws, user, client, task };
};

/** What the counter says. */
const stored = async (taskId: string) => {
    const [row] = await getDb()
        .select({
            total: tasks.checklistItemsTotal,
            done: tasks.checklistItemsDone,
        })
        .from(tasks)
        .where(eq(tasks.id, taskId));
    return { total: row.total, done: row.done };
};

/** What the item rows actually are, counted fresh. */
const recomputed = async (taskId: string) => {
    const db = getDb();
    const lists = await db
        .select({ id: checklists.id })
        .from(checklists)
        .where(eq(checklists.taskId, taskId));
    if (lists.length === 0) return { total: 0, done: 0 };
    const rows = await db
        .select({ isCompleted: checklistItems.isCompleted })
        .from(checklistItems)
        .where(
            inArray(
                checklistItems.checklistId,
                lists.map((l) => l.id),
            ),
        );
    return {
        total: rows.length,
        done: rows.filter((r) => r.isCompleted).length,
    };
};

/** The invariant, stated once. */
const expectCounterIsTruth = async (taskId: string, step: string) => {
    expect({ step, ...(await stored(taskId)) }).toEqual({
        step,
        ...(await recomputed(taskId)),
    });
};

describe("checklist rollup == a live count of the items (upgrades/022)", () => {
    it("holds after every mutating path in one mixed run", async () => {
        const s = await seed();
        const c = s.client;

        await expectCounterIsTruth(s.task.id, "no checklists at all");

        const one = await c.post(listPath(s.task.id)).send({ name: "Shoot" });
        expect(one.status).toBe(201);
        await expectCounterIsTruth(s.task.id, "empty checklist created");

        const a = await c.post(itemsPath(one.body.id)).send({ text: "Lights" });
        expect(a.status).toBe(201);
        await expectCounterIsTruth(s.task.id, "one item added");

        const bulk = await c
            .post(bulkPath(one.body.id))
            .send({ texts: ["Camera", "Backdrop", "Props"] });
        expect(bulk.status).toBe(201);
        await expectCounterIsTruth(s.task.id, "three added in bulk");

        expect((await c.post(togglePath(a.body.id))).status).toBe(200);
        await expectCounterIsTruth(s.task.id, "one toggled done");

        expect((await c.post(togglePath(a.body.id))).status).toBe(200);
        await expectCounterIsTruth(s.task.id, "toggled back undone");

        expect(
            (await c.patch(itemPath(a.body.id)).send({ text: "Key light" }))
                .status,
        ).toBe(200);
        await expectCounterIsTruth(s.task.id, "item text edited");

        // A second checklist on the same task — the rollup spans both.
        const two = await c.post(listPath(s.task.id)).send({ name: "Edit" });
        const t2 = await c.post(itemsPath(two.body.id)).send({ text: "Cull" });
        expect((await c.post(togglePath(t2.body.id))).status).toBe(200);
        await expectCounterIsTruth(s.task.id, "second checklist, one done");

        expect((await c.delete(itemPath(a.body.id))).status).toBe(204);
        await expectCounterIsTruth(s.task.id, "an item deleted");

        // Deleting a whole checklist takes its items with it.
        expect((await c.delete(clPath(one.body.id))).status).toBe(204);
        await expectCounterIsTruth(s.task.id, "a whole checklist deleted");

        expect((await c.delete(clPath(two.body.id))).status).toBe(204);
        await expectCounterIsTruth(s.task.id, "back to nothing");
    });

    it("holds when the DONE items are the ones removed", async () => {
        const s = await seed();
        const c = s.client;
        const cl = await c.post(listPath(s.task.id)).send({ name: "Pack" });
        await c
            .post(bulkPath(cl.body.id))
            .send({ texts: ["Boxes", "Tape", "Labels"] });

        const items = await c.get(listPath(s.task.id));
        const ids: string[] = items.body[0].items.map(
            (i: { id: string }) => i.id,
        );
        for (const id of ids) {
            expect((await c.post(togglePath(id))).status).toBe(200);
        }
        await expectCounterIsTruth(s.task.id, "all three done");

        // Deleting a COMPLETED item has to move both numbers, not just total.
        expect((await c.delete(itemPath(ids[0]))).status).toBe(204);
        await expectCounterIsTruth(s.task.id, "a completed item deleted");
    });

    it("holds per task — one task's items never count toward another's", async () => {
        const s = await seed();
        const other = await makeTask({
            workspaceId: s.ws.id,
            createdBy: s.user.id,
        });
        const c = s.client;

        const mine = await c.post(listPath(s.task.id)).send({ name: "Mine" });
        await c.post(bulkPath(mine.body.id)).send({ texts: ["a", "b"] });
        const theirs = await c.post(listPath(other.id)).send({ name: "Other" });
        const t = await c.post(itemsPath(theirs.body.id)).send({ text: "c" });
        await c.post(togglePath(t.body.id));

        await expectCounterIsTruth(s.task.id, "task one");
        await expectCounterIsTruth(other.id, "task two");
        expect(await stored(s.task.id)).toEqual({ total: 2, done: 0 });
        expect(await stored(other.id)).toEqual({ total: 1, done: 1 });
    });
});
