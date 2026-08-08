import { eq } from "drizzle-orm";
import { oneOff } from "../test-utils/app";
import {
    makeWorkspace,
    makeUser,
    makeLoggedInClient,
    makeTask,
} from "../test-utils/factories";
import { getDb } from "../../src/db/client";
import { checklistItems, taskActivity } from "../../src/db/schema";

/**
 * Tests for §15 Checklists — checklist CRUD + item add/bulk/update/toggle/delete.
 * Shipped WITHOUT backend tests; this is the new Layer-C coverage. The
 * `assignee_id` / `parent_item_id` cases probe Issue #4 (the service accepts
 * these ids without validating them in-workspace / same-checklist).
 */

jest.setTimeout(30_000);

const listPath = (taskId: string) => `/api/v1/tasks/${taskId}/checklists`;
const clPath = (id: string) => `/api/v1/checklists/${id}`;
const itemsPath = (clId: string) => `/api/v1/checklists/${clId}/items`;
const bulkPath = (clId: string) => `/api/v1/checklists/${clId}/items/bulk`;
const itemPath = (id: string) => `/api/v1/checklist-items/${id}`;
const togglePath = (id: string) => `/api/v1/checklist-items/${id}/toggle`;

const db = () => getDb();

const seed = async () => {
    const ws = await makeWorkspace();
    const user = await makeUser({ workspaceId: ws.id, role: "member" });
    const client = await makeLoggedInClient(user);
    const task = await makeTask({ workspaceId: ws.id, createdBy: user.id });
    return { ws, user, client, task };
};

/** Create a checklist on the seeded task and return its wire object. */
const makeChecklist = async (
    client: Awaited<ReturnType<typeof makeLoggedInClient>>,
    taskId: string,
    name = "QA steps",
) => (await client.post(listPath(taskId)).send({ name })).body;

describe("§15 Checklists", () => {
    // ─── GET list ───────────────────────────────────────────────────────────
    describe("GET /tasks/:id/checklists", () => {
        it("returns an empty array when the task has none", async () => {
            const { client, task } = await seed();
            const res = await client.get(listPath(task.id));
            expect(res.status).toBe(200);
            expect(res.body).toEqual([]);
        });

        it("returns checklists with their items nested", async () => {
            const { client, task } = await seed();
            const cl = await makeChecklist(client, task.id);
            await client.post(itemsPath(cl.id)).send({ text: "item one" });
            const res = await client.get(listPath(task.id));
            expect(res.status).toBe(200);
            expect(res.body).toHaveLength(1);
            expect(res.body[0].items).toHaveLength(1);
            expect(res.body[0].items[0].text).toBe("item one");
        });

        it("returns 404 for a task in another workspace", async () => {
            const { client } = await seed();
            const ws2 = await makeWorkspace();
            const u2 = await makeUser({ workspaceId: ws2.id });
            const foreign = await makeTask({ workspaceId: ws2.id, createdBy: u2.id });
            const res = await client.get(listPath(foreign.id));
            expect(res.status).toBe(404);
            expect(res.body.error.code).toBe("task.not_found");
        });
    });

    // ─── checklist CRUD ───────────────────────────────────────────────────────
    describe("checklist create / update / delete", () => {
        it("creates a checklist (201) with the wire shape", async () => {
            const { client, task } = await seed();
            const res = await client.post(listPath(task.id)).send({ name: "Launch" });
            expect(res.status).toBe(201);
            expect(res.body).toMatchObject({
                task_id: task.id,
                name: "Launch",
                items: [],
            });
            expect(typeof res.body.position).toBe("number");
        });

        it("appends new checklists after existing ones (increasing position)", async () => {
            const { client, task } = await seed();
            const a = await makeChecklist(client, task.id, "A");
            const b = await makeChecklist(client, task.id, "B");
            expect(b.position).toBeGreaterThan(a.position);
        });

        it("404 when creating on a task in another workspace", async () => {
            const { client } = await seed();
            const ws2 = await makeWorkspace();
            const u2 = await makeUser({ workspaceId: ws2.id });
            const foreign = await makeTask({ workspaceId: ws2.id, createdBy: u2.id });
            const res = await client.post(listPath(foreign.id)).send({ name: "x" });
            expect(res.status).toBe(404);
        });

        it("422 on an empty checklist name", async () => {
            const { client, task } = await seed();
            const res = await client.post(listPath(task.id)).send({ name: "  " });
            expect(res.status).toBe(422);
        });

        it("renames a checklist (200)", async () => {
            const { client, task } = await seed();
            const cl = await makeChecklist(client, task.id, "old");
            const res = await client.patch(clPath(cl.id)).send({ name: "new" });
            expect(res.status).toBe(200);
            expect(res.body.name).toBe("new");
        });

        it("404 renaming a checklist in another workspace", async () => {
            const { client } = await seed();
            const ws2 = await makeWorkspace();
            const u2 = await makeUser({ workspaceId: ws2.id });
            const t2 = await makeTask({ workspaceId: ws2.id, createdBy: u2.id });
            const c2 = await makeLoggedInClient(u2);
            const foreignCl = await makeChecklist(c2, t2.id);
            const res = await client.patch(clPath(foreignCl.id)).send({ name: "x" });
            expect(res.status).toBe(404);
            expect(res.body.error.code).toBe("checklist.not_found");
        });

        it("deletes a checklist and cascades its items (204)", async () => {
            const { client, task } = await seed();
            const cl = await makeChecklist(client, task.id);
            await client.post(itemsPath(cl.id)).send({ text: "a" });
            await client.post(itemsPath(cl.id)).send({ text: "b" });

            const res = await client.delete(clPath(cl.id));
            expect(res.status).toBe(204);

            const list = await client.get(listPath(task.id));
            expect(list.body).toHaveLength(0);
            const leftover = await db()
                .select()
                .from(checklistItems)
                .where(eq(checklistItems.checklistId, cl.id));
            expect(leftover).toHaveLength(0);
        });
    });

    // ─── add item (incl. Issue #4 probes) ──────────────────────────────────────
    describe("POST /checklists/:id/items", () => {
        it("adds an item (201) with the wire shape", async () => {
            const { client, task } = await seed();
            const cl = await makeChecklist(client, task.id);
            const res = await client.post(itemsPath(cl.id)).send({ text: "do it" });
            expect(res.status).toBe(201);
            expect(res.body).toMatchObject({
                checklist_id: cl.id,
                text: "do it",
                is_completed: false,
                parent_item_id: null,
                assignee_id: null,
            });
        });

        it("accepts a valid in-workspace assignee_id (201)", async () => {
            const { ws, client, task } = await seed();
            const alice = await makeUser({ workspaceId: ws.id });
            const cl = await makeChecklist(client, task.id);
            const res = await client
                .post(itemsPath(cl.id))
                .send({ text: "assigned", assignee_id: alice.id });
            expect(res.status).toBe(201);
            expect(res.body.assignee_id).toBe(alice.id);
        });

        it("accepts a valid same-checklist parent_item_id as a sub-item (201)", async () => {
            const { client, task } = await seed();
            const cl = await makeChecklist(client, task.id);
            const parent = (
                await client.post(itemsPath(cl.id)).send({ text: "parent" })
            ).body;
            const res = await client
                .post(itemsPath(cl.id))
                .send({ text: "child", parent_item_id: parent.id });
            expect(res.status).toBe(201);
            expect(res.body.parent_item_id).toBe(parent.id);
        });

        // ── Issue #4 ──────────────────────────────────────────────────────────
        it("422 for a non-existent assignee_id (not a 500 FK error)", async () => {
            const { client, task } = await seed();
            const cl = await makeChecklist(client, task.id);
            const res = await client
                .post(itemsPath(cl.id))
                .send({ text: "x", assignee_id: "u-does-not-exist" });
            expect(res.status).toBe(422);
            expect(res.body.error.code).toBe("checklist_item.invalid_assignee");
        });

        it("422 for a cross-workspace assignee_id (no cross-tenant assignment)", async () => {
            const { client, task } = await seed();
            const ws2 = await makeWorkspace();
            const outsider = await makeUser({ workspaceId: ws2.id });
            const cl = await makeChecklist(client, task.id);
            const res = await client
                .post(itemsPath(cl.id))
                .send({ text: "x", assignee_id: outsider.id });
            expect(res.status).toBe(422);
            expect(res.body.error.code).toBe("checklist_item.invalid_assignee");
        });

        it("422 for a non-existent parent_item_id (not a 500 FK error)", async () => {
            const { client, task } = await seed();
            const cl = await makeChecklist(client, task.id);
            const res = await client
                .post(itemsPath(cl.id))
                .send({ text: "x", parent_item_id: "ci-does-not-exist" });
            expect(res.status).toBe(422);
            expect(res.body.error.code).toBe("checklist_item.invalid_parent");
        });

        it("422 for a parent_item_id that belongs to another checklist", async () => {
            const { client, task } = await seed();
            const clA = await makeChecklist(client, task.id, "A");
            const clB = await makeChecklist(client, task.id, "B");
            const parentInA = (
                await client.post(itemsPath(clA.id)).send({ text: "in A" })
            ).body;
            const res = await client
                .post(itemsPath(clB.id))
                .send({ text: "child", parent_item_id: parentInA.id });
            expect(res.status).toBe(422);
            expect(res.body.error.code).toBe("checklist_item.invalid_parent");
        });

        it("404 when the checklist is in another workspace", async () => {
            const { client } = await seed();
            const ws2 = await makeWorkspace();
            const u2 = await makeUser({ workspaceId: ws2.id });
            const t2 = await makeTask({ workspaceId: ws2.id, createdBy: u2.id });
            const c2 = await makeLoggedInClient(u2);
            const foreignCl = await makeChecklist(c2, t2.id);
            const res = await client.post(itemsPath(foreignCl.id)).send({ text: "x" });
            expect(res.status).toBe(404);
        });
    });

    // ─── bulk add ───────────────────────────────────────────────────────────
    describe("POST /checklists/:id/items/bulk", () => {
        it("inserts many items in one call (201)", async () => {
            const { client, task } = await seed();
            const cl = await makeChecklist(client, task.id);
            const res = await client
                .post(bulkPath(cl.id))
                .send({ texts: ["a", "b", "c"] });
            expect(res.status).toBe(201);
            expect(res.body).toHaveLength(3);
        });
    });

    // ─── update / toggle / delete item ─────────────────────────────────────────
    describe("item update / toggle / delete", () => {
        it("updates item text (200) and logs task_activity", async () => {
            const { client, task } = await seed();
            const cl = await makeChecklist(client, task.id);
            const item = (await client.post(itemsPath(cl.id)).send({ text: "a" })).body;
            const res = await client.patch(itemPath(item.id)).send({ text: "b" });
            expect(res.status).toBe(200);
            expect(res.body.text).toBe("b");
            const acts = await db()
                .select()
                .from(taskActivity)
                .where(eq(taskActivity.taskId, task.id));
            expect(acts.some((a) => a.action === "checklist_item_updated")).toBe(true);
        });

        it("422 updating an item to a cross-workspace assignee_id", async () => {
            const { client, task } = await seed();
            const ws2 = await makeWorkspace();
            const outsider = await makeUser({ workspaceId: ws2.id });
            const cl = await makeChecklist(client, task.id);
            const item = (await client.post(itemsPath(cl.id)).send({ text: "a" })).body;
            const res = await client
                .patch(itemPath(item.id))
                .send({ assignee_id: outsider.id });
            expect(res.status).toBe(422);
            expect(res.body.error.code).toBe("checklist_item.invalid_assignee");
        });

        it("toggles completion on and back off (200), stamping completed_by/at", async () => {
            const { client, task, user } = await seed();
            const cl = await makeChecklist(client, task.id);
            const item = (await client.post(itemsPath(cl.id)).send({ text: "a" })).body;

            const on = await client.post(togglePath(item.id));
            expect(on.status).toBe(200);
            expect(on.body.is_completed).toBe(true);
            expect(on.body.completed_at).not.toBeNull();
            expect(on.body.completed_by).toBe(user.id);

            const off = await client.post(togglePath(item.id));
            expect(off.body.is_completed).toBe(false);
            expect(off.body.completed_at).toBeNull();
            expect(off.body.completed_by).toBeNull();
        });

        it("deletes an item (204)", async () => {
            const { client, task } = await seed();
            const cl = await makeChecklist(client, task.id);
            const item = (await client.post(itemsPath(cl.id)).send({ text: "a" })).body;
            const res = await client.delete(itemPath(item.id));
            expect(res.status).toBe(204);
            const list = await client.get(listPath(task.id));
            expect(list.body[0].items).toHaveLength(0);
        });

        it("404 for a non-existent item", async () => {
            const { client } = await seed();
            const res = await client.post(togglePath("ci-nope"));
            expect(res.status).toBe(404);
            expect(res.body.error.code).toBe("checklist_item.not_found");
        });

        it("requires authentication (401)", async () => {
            const { client, task } = await seed();
            const cl = await makeChecklist(client, task.id);
            const item = (await client.post(itemsPath(cl.id)).send({ text: "a" })).body;
            const res = await (await oneOff()).post(togglePath(item.id));
            expect(res.status).toBe(401);
        });
    });
});

// ─── F29 (ISS-068): the bulk cap ─────────────────────────────────────────────
describe("POST /checklists/:id/items/bulk — the 200-item cap (F29)", () => {
    /**
     * `texts` was `isArray({min: 1})` with NO max — 5,000 items landed in one
     * transaction, and since `GET /tasks/:id/checklists` embeds items
     * unpaginated, every later read of that task paid for it forever. The cap
     * copies `bulkTasksValidator`'s 200, the only other bulk write in the API.
     */
    it("accepts exactly 200 items — the cap itself", async () => {
        const { client, task } = await seed();
        const cl = await makeChecklist(client, task.id);

        const res = await client.post(bulkPath(cl.id)).send({
            texts: Array.from({ length: 200 }, (_, i) => `Step ${i + 1}`),
        });

        expect(res.status).toBe(201);
        expect(res.body).toHaveLength(200);
    });

    it("REFUSES 201 items (422) and writes NOTHING", async () => {
        const { client, task } = await seed();
        const cl = await makeChecklist(client, task.id);

        const res = await client.post(bulkPath(cl.id)).send({
            texts: Array.from({ length: 201 }, (_, i) => `Step ${i + 1}`),
        });

        expect(res.status).toBe(422);
        expect(res.body.error.code).toBe("validation.failed");
        const rows = await db()
            .select()
            .from(checklistItems)
            .where(eq(checklistItems.checklistId, cl.id));
        expect(rows).toHaveLength(0);
    });
});
