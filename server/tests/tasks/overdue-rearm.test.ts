import { eq } from "drizzle-orm";
import { makeLoggedInClient, makeTask, makeUser, makeWorkspace } from "../test-utils/factories";
import { getDb } from "../../src/db/client";
import { tasks } from "../../src/db/schema";
import { MailService } from "../../src/services/MailService";

/**
 * Two write-path halves of the assignment/overdue email feature (2026-08-08):
 *
 *   1. `POST /api/v1/tasks` with initial `assignees` emails each of them
 *      (minus the actor) — the same recipient set as the in-app `assigned`
 *      fanout, dispatched fire-and-forget after the create tx commits.
 *   2. `PATCH /api/v1/tasks/:id` re-arms the overdue alert: any change to
 *      `due_date` clears `tasks.overdue_notified_at`, so the overdue-alert
 *      job treats the new deadline as fresh. Non-date patches leave the
 *      claim alone.
 */

const waitForCalls = async (
    spy: jest.SpyInstance,
    times: number,
): Promise<void> => {
    for (let i = 0; i < 40; i += 1) {
        if (spy.mock.calls.length >= times) return;
        await new Promise((r) => setTimeout(r, 25));
    }
};

const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 200));

const taskRow = async (taskId: string) =>
    (await getDb().select().from(tasks).where(eq(tasks.id, taskId)))[0];

let mailSpy: jest.SpyInstance;

beforeEach(() => {
    mailSpy = jest
        .spyOn(MailService.prototype, "sendTaskAssignedEmail")
        .mockResolvedValue(undefined);
});

afterEach(() => {
    mailSpy.mockRestore();
});

describe("POST /api/v1/tasks — initial-assignee email", () => {
    it("emails each initial assignee except the actor, with the due date", async () => {
        const ws = await makeWorkspace();
        const actor = await makeUser({ workspaceId: ws.id, role: "admin" });
        const a = await makeUser({ workspaceId: ws.id });
        // Materialise a full list/status/type chain to create through.
        const seed = await makeTask({ workspaceId: ws.id, createdBy: actor.id });
        const client = await makeLoggedInClient(actor);

        const res = await client.post("/api/v1/tasks").send({
            primary_list_id: seed.listId,
            name: "Prepare Eid campaign brief",
            due_date: "2026-09-01",
            assignees: [actor.id, a.id],
        });
        expect(res.status).toBe(201);

        await waitForCalls(mailSpy, 1);
        await settle();
        expect(mailSpy).toHaveBeenCalledTimes(1); // actor excluded
        expect(mailSpy.mock.calls[0][0]).toBe(a.email);
        const payload = mailSpy.mock.calls[0][1] as {
            taskName: string;
            taskUrl: string;
            dueYmd: string | null;
        };
        expect(payload.taskName).toBe("Prepare Eid campaign brief");
        expect(payload.taskUrl).toContain(`/t/${res.body.id}`);
        expect(payload.dueYmd).toBe("2026-09-01");
    });

    it("sends nothing when the only assignee is the actor", async () => {
        const ws = await makeWorkspace();
        const actor = await makeUser({ workspaceId: ws.id, role: "admin" });
        const seed = await makeTask({ workspaceId: ws.id, createdBy: actor.id });
        const client = await makeLoggedInClient(actor);

        const res = await client.post("/api/v1/tasks").send({
            primary_list_id: seed.listId,
            name: "Self-assigned",
            assignees: [actor.id],
        });
        expect(res.status).toBe(201);

        await settle();
        expect(mailSpy).not.toHaveBeenCalled();
    });
});

describe("PATCH /api/v1/tasks/:id — overdue re-arm", () => {
    it("clears overdue_notified_at when due_date changes", async () => {
        const ws = await makeWorkspace();
        const actor = await makeUser({ workspaceId: ws.id, role: "admin" });
        const t = await makeTask({ workspaceId: ws.id, createdBy: actor.id });
        await getDb()
            .update(tasks)
            .set({ overdueNotifiedAt: new Date() })
            .where(eq(tasks.id, t.id));
        const client = await makeLoggedInClient(actor);

        const res = await client
            .patch(`/api/v1/tasks/${t.id}`)
            .send({ due_date: "2026-12-01" });
        expect(res.status).toBe(200);

        expect((await taskRow(t.id)).overdueNotifiedAt).toBeNull();
    });

    it("clears the claim when due_date is removed (set null)", async () => {
        const ws = await makeWorkspace();
        const actor = await makeUser({ workspaceId: ws.id, role: "admin" });
        const t = await makeTask({ workspaceId: ws.id, createdBy: actor.id });
        await getDb()
            .update(tasks)
            .set({
                dueDate: new Date("2026-01-01T00:00:00Z"),
                overdueNotifiedAt: new Date(),
            })
            .where(eq(tasks.id, t.id));
        const client = await makeLoggedInClient(actor);

        const res = await client
            .patch(`/api/v1/tasks/${t.id}`)
            .send({ due_date: null });
        expect(res.status).toBe(200);

        expect((await taskRow(t.id)).overdueNotifiedAt).toBeNull();
    });

    it("leaves the claim alone on a non-date patch", async () => {
        const ws = await makeWorkspace();
        const actor = await makeUser({ workspaceId: ws.id, role: "admin" });
        const t = await makeTask({ workspaceId: ws.id, createdBy: actor.id });
        const claimed = new Date();
        await getDb()
            .update(tasks)
            .set({ overdueNotifiedAt: claimed })
            .where(eq(tasks.id, t.id));
        const client = await makeLoggedInClient(actor);

        const res = await client
            .patch(`/api/v1/tasks/${t.id}`)
            .send({ name: "Renamed only" });
        expect(res.status).toBe(200);

        expect((await taskRow(t.id)).overdueNotifiedAt).not.toBeNull();
    });

    it("bulk due_date change re-arms every target", async () => {
        const ws = await makeWorkspace();
        const actor = await makeUser({ workspaceId: ws.id, role: "admin" });
        const t1 = await makeTask({ workspaceId: ws.id, createdBy: actor.id });
        const t2 = await makeTask({
            workspaceId: ws.id,
            createdBy: actor.id,
            listId: t1.listId,
            statusId: t1.statusId,
            taskTypeId: t1.taskTypeId,
        });
        await getDb()
            .update(tasks)
            .set({ overdueNotifiedAt: new Date() })
            .where(eq(tasks.workspaceId, ws.id));
        const client = await makeLoggedInClient(actor);

        const res = await client.post("/api/v1/tasks/bulk").send({
            ids: [t1.id, t2.id],
            patch: { due_date: "2026-12-15" },
        });
        expect(res.status).toBe(200);

        expect((await taskRow(t1.id)).overdueNotifiedAt).toBeNull();
        expect((await taskRow(t2.id)).overdueNotifiedAt).toBeNull();
    });
});
