import { eq } from "drizzle-orm";
import { getDb } from "../../src/db/client";
import { tasks, taskActivity } from "../../src/db/schema";
import {
    makeUser,
    makeLoggedInClient,
    makeTask,
} from "../test-utils/factories";
import { oneOff, type LoggedInClient } from "../test-utils/app";
import type { Role } from "../../src/constants";

/**
 * §29 #2 — PATCH /api/v1/tasks/:id/sla
 *
 * Manually set/clear sla_due_at on a task (override). 👑 owner/admin. Body
 * { sla_due_at: ISO | null }; a set value must be in the future (422
 * sla.invalid_due_at). Returns the updated Task; writes a task_activity row.
 */

const path = (id: string) => `/api/v1/tasks/${id}/sla`;
const FUTURE = "2030-06-01T12:00:00.000Z";
const PAST = "2020-01-01T00:00:00.000Z";

interface Fixture {
    ws: string;
    actorId: string;
    taskId: string;
    client: LoggedInClient;
}

/** A workspace with a task and a logged-in client of the given role. */
const setup = async (role: Role = "admin"): Promise<Fixture> => {
    const actor = await makeUser({ role });
    const ws = actor.workspaceId;
    const task = await makeTask({ workspaceId: ws, createdBy: actor.id });
    const client = await makeLoggedInClient({
        id: actor.id,
        workspaceId: ws,
        role: actor.role,
    });
    return { ws, actorId: actor.id, taskId: task.id, client };
};

describe("PATCH /api/v1/tasks/:id/sla", () => {
    describe("Auth / role", () => {
        it("401 without a token", async () => {
            const f = await setup();
            const res = await (await oneOff())
                .patch(path(f.taskId))
                .send({ sla_due_at: FUTURE });
            expect(res.status).toBe(401);
        });

        it("403 for a non-admin member (👑 only)", async () => {
            const f = await setup("admin");
            const member = await makeUser({
                workspaceId: f.ws,
                role: "member",
            });
            const memberClient = await makeLoggedInClient({
                id: member.id,
                workspaceId: f.ws,
                role: member.role,
            });
            const res = await memberClient
                .patch(path(f.taskId))
                .send({ sla_due_at: FUTURE });
            expect(res.status).toBe(403);
        });
    });

    describe("Happy path", () => {
        it("sets a future SLA and returns the updated Task (200)", async () => {
            const f = await setup();
            const res = await f.client
                .patch(path(f.taskId))
                .send({ sla_due_at: FUTURE });

            expect(res.status).toBe(200);
            expect(res.body.id).toBe(f.taskId);
            expect(new Date(res.body.sla_due_at).getTime()).toBe(
                new Date(FUTURE).getTime(),
            );

            const db = getDb();
            const rows = await db
                .select()
                .from(tasks)
                .where(eq(tasks.id, f.taskId));
            expect(rows[0].slaDueAt).not.toBeNull();
            expect(rows[0].slaDueAt?.getTime()).toBe(
                new Date(FUTURE).getTime(),
            );
        });

        it("clears the SLA with null", async () => {
            const f = await setup();
            await f.client.patch(path(f.taskId)).send({ sla_due_at: FUTURE });
            const res = await f.client
                .patch(path(f.taskId))
                .send({ sla_due_at: null });

            expect(res.status).toBe(200);
            expect(res.body.sla_due_at).toBeNull();

            const db = getDb();
            const rows = await db
                .select()
                .from(tasks)
                .where(eq(tasks.id, f.taskId));
            expect(rows[0].slaDueAt).toBeNull();
        });

        it("writes a sla_overridden task_activity row", async () => {
            const f = await setup();
            await f.client.patch(path(f.taskId)).send({ sla_due_at: FUTURE });

            const db = getDb();
            const rows = await db
                .select()
                .from(taskActivity)
                .where(eq(taskActivity.taskId, f.taskId));
            const actions = rows.map((r) => r.action);
            expect(actions).toContain("sla_overridden");
        });
    });

    describe("Validation (422)", () => {
        it("422 sla.invalid_due_at for a past timestamp", async () => {
            const f = await setup();
            const res = await f.client
                .patch(path(f.taskId))
                .send({ sla_due_at: PAST });
            expect(res.status).toBe(422);
            expect(res.body.error.code).toBe("sla.invalid_due_at");
        });

        it("422 validation.failed when sla_due_at is absent", async () => {
            const f = await setup();
            const res = await f.client.patch(path(f.taskId)).send({});
            expect(res.status).toBe(422);
            expect(res.body.error.code).toBe("validation.failed");
        });

        it.each([
            ["a non-date string", "not-a-date"],
            ["a number", 123],
        ])(
            "422 validation.failed when sla_due_at is %s",
            async (_label, value) => {
                const f = await setup();
                const res = await f.client
                    .patch(path(f.taskId))
                    .send({ sla_due_at: value });
                expect(res.status).toBe(422);
                expect(res.body.error.code).toBe("validation.failed");
            },
        );
    });

    describe("Not found / archived / isolation", () => {
        it("404 task.not_found for an unknown id", async () => {
            const f = await setup();
            const res = await f.client
                .patch(path("t-nope"))
                .send({ sla_due_at: FUTURE });
            expect(res.status).toBe(404);
            expect(res.body.error.code).toBe("task.not_found");
        });

        it("404 for a task in another workspace", async () => {
            const a = await setup();
            const b = await setup("admin"); // different workspace, admin caller
            const res = await b.client
                .patch(path(a.taskId))
                .send({ sla_due_at: FUTURE });
            expect(res.status).toBe(404);
            expect(res.body.error.code).toBe("task.not_found");
        });

        it("409 task.archived for an archived task", async () => {
            const actor = await makeUser({ role: "admin" });
            const task = await makeTask({
                workspaceId: actor.workspaceId,
                createdBy: actor.id,
                archivedAt: new Date(),
            });
            const client = await makeLoggedInClient({
                id: actor.id,
                workspaceId: actor.workspaceId,
                role: actor.role,
            });
            const res = await client
                .patch(path(task.id))
                .send({ sla_due_at: FUTURE });
            expect(res.status).toBe(409);
            expect(res.body.error.code).toBe("task.archived");
        });
    });
});
