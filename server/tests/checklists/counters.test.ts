import {
    makeWorkspace,
    makeUser,
    makeLoggedInClient,
    makeTask,
} from "../test-utils/factories";

/**
 * upgrades/022 — the checklist ROLLUP on the task row
 * (`checklist_items_total` / `checklist_items_done`): the row/board "3/7"
 * chip and the drawer's aggregate % read these, so every item write must
 * keep them true. Maintained by `TasksRepo.recomputeChecklistCounters`
 * inside each ChecklistsService write transaction — this walks every
 * mutation through the REAL endpoints and reads the task wire back.
 */

jest.setTimeout(30_000);

const taskPath = (id: string) => `/api/v1/tasks/${id}`;
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

type Counts = { total: number; done: number };
const countsOf = async (
    client: Awaited<ReturnType<typeof makeLoggedInClient>>,
    taskId: string,
): Promise<Counts> => {
    const res = await client.get(taskPath(taskId));
    expect(res.status).toBe(200);
    return {
        total: res.body.checklist_items_total,
        done: res.body.checklist_items_done,
    };
};

describe("checklist rollup counters on the task (upgrades/022)", () => {
    it("starts at 0/0 and follows add → bulk → toggle → edit → delete → checklist-delete", async () => {
        const { client, task } = await seed();
        expect(await countsOf(client, task.id)).toEqual({ total: 0, done: 0 });

        // add one item
        const cl = (await client.post(listPath(task.id)).send({ name: "QA" }))
            .body;
        const item = (
            await client.post(itemsPath(cl.id)).send({ text: "step one" })
        ).body;
        expect(await countsOf(client, task.id)).toEqual({ total: 1, done: 0 });

        // bulk add three more
        const bulk = await client
            .post(bulkPath(cl.id))
            .send({ texts: ["a", "b", "c"] });
        expect(bulk.status).toBe(201);
        expect(await countsOf(client, task.id)).toEqual({ total: 4, done: 0 });

        // toggle done / undone
        await client.post(togglePath(item.id));
        expect(await countsOf(client, task.id)).toEqual({ total: 4, done: 1 });
        await client.post(togglePath(item.id));
        expect(await countsOf(client, task.id)).toEqual({ total: 4, done: 0 });

        // editing an item's TEXT round-trips and never moves the counters
        const edit = await client
            .patch(itemPath(item.id))
            .send({ text: "step one (fixed)" });
        expect(edit.status).toBe(200);
        expect(edit.body.text).toBe("step one (fixed)");
        expect(await countsOf(client, task.id)).toEqual({ total: 4, done: 0 });

        // deleting a DONE item drops both numbers
        await client.post(togglePath(item.id));
        expect(await countsOf(client, task.id)).toEqual({ total: 4, done: 1 });
        await client.delete(itemPath(item.id));
        expect(await countsOf(client, task.id)).toEqual({ total: 3, done: 0 });

        // deleting the checklist zeroes the rollup (items cascade)
        await client.delete(clPath(cl.id));
        expect(await countsOf(client, task.id)).toEqual({ total: 0, done: 0 });
    });

    it("aggregates across MULTIPLE checklists on the same task", async () => {
        const { client, task } = await seed();
        const a = (await client.post(listPath(task.id)).send({ name: "A" }))
            .body;
        const b = (await client.post(listPath(task.id)).send({ name: "B" }))
            .body;
        const a1 = (await client.post(itemsPath(a.id)).send({ text: "a1" }))
            .body;
        await client.post(itemsPath(a.id)).send({ text: "a2" });
        const b1 = (await client.post(itemsPath(b.id)).send({ text: "b1" }))
            .body;
        await client.post(togglePath(a1.id));
        await client.post(togglePath(b1.id));
        expect(await countsOf(client, task.id)).toEqual({ total: 3, done: 2 });

        // dropping ONE checklist keeps the other's contribution
        await client.delete(clPath(a.id));
        expect(await countsOf(client, task.id)).toEqual({ total: 1, done: 1 });
    });

    it("renaming a checklist round-trips and touches nothing else", async () => {
        const { client, task } = await seed();
        const cl = (
            await client.post(listPath(task.id)).send({ name: "Typo nmae" })
        ).body;
        await client.post(itemsPath(cl.id)).send({ text: "x" });

        const renamed = await client
            .patch(clPath(cl.id))
            .send({ name: "Fixed name" });
        expect(renamed.status).toBe(200);
        expect(renamed.body.name).toBe("Fixed name");
        expect(await countsOf(client, task.id)).toEqual({ total: 1, done: 0 });
    });

    it("the rollup rides the LIST read too (the row chip's data source)", async () => {
        const { client, task } = await seed();
        const cl = (await client.post(listPath(task.id)).send({ name: "L" }))
            .body;
        const i1 = (await client.post(itemsPath(cl.id)).send({ text: "1" }))
            .body;
        await client.post(itemsPath(cl.id)).send({ text: "2" });
        await client.post(togglePath(i1.id));

        const res = await client.get(
            `/api/v1/lists/${task.listId}/tasks?limit=200`,
        );
        expect(res.status).toBe(200);
        const row = (
            res.body.data as {
                id: string;
                checklist_items_total: number;
                checklist_items_done: number;
            }[]
        ).find((t) => t.id === task.id);
        expect(row).toBeDefined();
        expect(row!.checklist_items_total).toBe(2);
        expect(row!.checklist_items_done).toBe(1);
    });
});
