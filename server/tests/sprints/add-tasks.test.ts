import { and, eq } from "drizzle-orm";
import { oneOff } from "../test-utils/app";
import {
    makeLoggedInClient,
    makeSprint,
    makeTask,
    makeUser,
    makeWorkspace,
} from "../test-utils/factories";
import { getDb } from "../../src/db/client";
import { taskActivity, tasks, workspaceActivity } from "../../src/db/schema";
import type { Role } from "../../src/constants";

/**
 * §20 #8 — POST /api/v1/sprints/:id/tasks  (bulk attach)
 *
 * 🔐 any member. Sets `tasks.sprint_id` for each id in `{ task_ids }`. All ids
 * must be real tasks in the workspace (else 404 `task.not_found`, whole batch
 * rejected). Returns 204; records `task_activity` per newly-moved task +
 * one `workspace_activity` (`tasks_added`).
 */

const setup = async (role: Role = "member") => {
    const u = await makeUser({ role });
    const client = await makeLoggedInClient(u);
    return { u, client, workspaceId: u.workspaceId };
};

const sprintIdOf = async (taskId: string): Promise<string | null> => {
    const [r] = await getDb()
        .select({ sprintId: tasks.sprintId })
        .from(tasks)
        .where(eq(tasks.id, taskId));
    return r.sprintId;
};

const addedActsFor = async (taskId: string) =>
    (
        await getDb()
            .select()
            .from(taskActivity)
            .where(eq(taskActivity.taskId, taskId))
    ).filter((a) => a.action === "sprint_added");

const tasksAddedActivity = async (workspaceId: string, sprintId: string) =>
    getDb()
        .select()
        .from(workspaceActivity)
        .where(
            and(
                eq(workspaceActivity.workspaceId, workspaceId),
                eq(workspaceActivity.entityId, sprintId),
                eq(workspaceActivity.action, "tasks_added"),
            ),
        );

describe("POST /api/v1/sprints/:id/tasks", () => {
    describe("happy path", () => {
        it("attaches a single task and returns 204", async () => {
            const { client, workspaceId } = await setup();
            const s = await makeSprint({ workspaceId });
            const t = await makeTask({ workspaceId });

            const res = await client
                .post(`/api/v1/sprints/${s.id}/tasks`)
                .send({ task_ids: [t.id] });

            expect(res.status).toBe(204);
            expect(await sprintIdOf(t.id)).toBe(s.id);
        });

        it("attaches several tasks in one call", async () => {
            const { client, workspaceId } = await setup();
            const s = await makeSprint({ workspaceId });
            const t1 = await makeTask({ workspaceId });
            const t2 = await makeTask({ workspaceId });
            const t3 = await makeTask({ workspaceId });

            const res = await client
                .post(`/api/v1/sprints/${s.id}/tasks`)
                .send({ task_ids: [t1.id, t2.id, t3.id] });

            expect(res.status).toBe(204);
            expect(await sprintIdOf(t1.id)).toBe(s.id);
            expect(await sprintIdOf(t2.id)).toBe(s.id);
            expect(await sprintIdOf(t3.id)).toBe(s.id);
        });

        it("moves a task that was in another sprint", async () => {
            const { client, workspaceId } = await setup();
            const from = await makeSprint({ workspaceId, name: "From" });
            const to = await makeSprint({ workspaceId, name: "To" });
            const t = await makeTask({ workspaceId });
            await getDb()
                .update(tasks)
                .set({ sprintId: from.id })
                .where(eq(tasks.id, t.id));

            const res = await client
                .post(`/api/v1/sprints/${to.id}/tasks`)
                .send({ task_ids: [t.id] });

            expect(res.status).toBe(204);
            expect(await sprintIdOf(t.id)).toBe(to.id);
        });

        it("de-duplicates repeated ids in the payload", async () => {
            const { client, workspaceId } = await setup();
            const s = await makeSprint({ workspaceId });
            const t = await makeTask({ workspaceId });

            const res = await client
                .post(`/api/v1/sprints/${s.id}/tasks`)
                .send({ task_ids: [t.id, t.id, t.id] });

            expect(res.status).toBe(204);
            expect(await addedActsFor(t.id)).toHaveLength(1);
        });
    });

    describe("side effects", () => {
        it("records a 'sprint_added' task_activity row per task + one 'tasks_added' workspace_activity", async () => {
            const { client, workspaceId } = await setup();
            const s = await makeSprint({ workspaceId });
            const t1 = await makeTask({ workspaceId });
            const t2 = await makeTask({ workspaceId });

            await client
                .post(`/api/v1/sprints/${s.id}/tasks`)
                .send({ task_ids: [t1.id, t2.id] });

            expect(await addedActsFor(t1.id)).toHaveLength(1);
            expect(await addedActsFor(t2.id)).toHaveLength(1);
            const ws = await tasksAddedActivity(workspaceId, s.id);
            expect(ws).toHaveLength(1);
            expect(ws[0].context).toMatchObject({ count: 2 });
        });

        it("only newly-moved tasks get activity (already-in-sprint is a no-op)", async () => {
            const { client, workspaceId } = await setup();
            const s = await makeSprint({ workspaceId });
            const already = await makeTask({ workspaceId });
            await getDb()
                .update(tasks)
                .set({ sprintId: s.id })
                .where(eq(tasks.id, already.id));
            const fresh = await makeTask({ workspaceId });

            await client
                .post(`/api/v1/sprints/${s.id}/tasks`)
                .send({ task_ids: [already.id, fresh.id] });

            expect(await addedActsFor(already.id)).toHaveLength(0);
            expect(await addedActsFor(fresh.id)).toHaveLength(1);
            const ws = await tasksAddedActivity(workspaceId, s.id);
            expect(ws[0].context).toMatchObject({ count: 1 });
        });

        it("attaching only already-in-sprint tasks writes no activity (204 no-op)", async () => {
            const { client, workspaceId } = await setup();
            const s = await makeSprint({ workspaceId });
            const t = await makeTask({ workspaceId });
            await getDb()
                .update(tasks)
                .set({ sprintId: s.id })
                .where(eq(tasks.id, t.id));

            const res = await client
                .post(`/api/v1/sprints/${s.id}/tasks`)
                .send({ task_ids: [t.id] });

            expect(res.status).toBe(204);
            expect(await tasksAddedActivity(workspaceId, s.id)).toHaveLength(0);
        });
    });

    describe("validation (422)", () => {
        const post = async (body: Record<string, unknown>) => {
            const { client, workspaceId } = await setup();
            const s = await makeSprint({ workspaceId });
            return client.post(`/api/v1/sprints/${s.id}/tasks`).send(body);
        };

        it("rejects an empty task_ids array", async () => {
            const res = await post({ task_ids: [] });
            expect(res.status).toBe(422);
        });

        it("rejects a missing task_ids", async () => {
            const res = await post({});
            expect(res.status).toBe(422);
        });

        it("rejects a non-array task_ids", async () => {
            const res = await post({ task_ids: "t-1" });
            expect(res.status).toBe(422);
        });

        it("rejects an over-long task id", async () => {
            const res = await post({ task_ids: ["x".repeat(65)] });
            expect(res.status).toBe(422);
        });
    });

    describe("not found / atomic rejection", () => {
        it("404 sprint.not_found when the sprint is missing", async () => {
            const { client, workspaceId } = await setup();
            const t = await makeTask({ workspaceId });
            const res = await client
                .post("/api/v1/sprints/spr-nope/tasks")
                .send({ task_ids: [t.id] });
            expect(res.status).toBe(404);
            expect(res.body.error.code).toBe("sprint.not_found");
        });

        it("404 task.not_found and NO task attached when any id is invalid", async () => {
            const { client, workspaceId } = await setup();
            const s = await makeSprint({ workspaceId });
            const good = await makeTask({ workspaceId });

            const res = await client
                .post(`/api/v1/sprints/${s.id}/tasks`)
                .send({ task_ids: [good.id, "t-missing"] });

            expect(res.status).toBe(404);
            expect(res.body.error.code).toBe("task.not_found");
            expect(await sprintIdOf(good.id)).toBeNull(); // batch rolled back
        });

        it("404 when a task belongs to another workspace (no cross-tenant write)", async () => {
            const { client, workspaceId } = await setup();
            const s = await makeSprint({ workspaceId });
            const otherWs = await makeWorkspace();
            const theirs = await makeTask({ workspaceId: otherWs.id });

            const res = await client
                .post(`/api/v1/sprints/${s.id}/tasks`)
                .send({ task_ids: [theirs.id] });

            expect(res.status).toBe(404);
            expect(await sprintIdOf(theirs.id)).toBeNull();
        });
    });

    describe("status / archived guards", () => {
        it("409 sprint.invalid_status when adding to a closed sprint", async () => {
            const { client, workspaceId } = await setup();
            const s = await makeSprint({ workspaceId, status: "closed" });
            const t = await makeTask({ workspaceId });

            const res = await client
                .post(`/api/v1/sprints/${s.id}/tasks`)
                .send({ task_ids: [t.id] });

            expect(res.status).toBe(409);
            expect(res.body.error.code).toBe("sprint.invalid_status");
            expect(await sprintIdOf(t.id)).toBeNull();
        });

        it("404 task.not_found when attaching an archived task", async () => {
            const { client, workspaceId } = await setup();
            const s = await makeSprint({ workspaceId });
            const archived = await makeTask({
                workspaceId,
                archivedAt: new Date(),
            });

            const res = await client
                .post(`/api/v1/sprints/${s.id}/tasks`)
                .send({ task_ids: [archived.id] });

            expect(res.status).toBe(404);
            expect(res.body.error.code).toBe("task.not_found");
            expect(await sprintIdOf(archived.id)).toBeNull();
        });
    });

    describe("authorization (sprint.assign_tasks — internal roles)", () => {
        it.each<Role>(["owner", "admin", "member"])(
            "allows a %s to attach (204)",
            async (role) => {
                const { client, workspaceId } = await setup(role);
                const s = await makeSprint({ workspaceId });
                const t = await makeTask({ workspaceId });
                const res = await client
                    .post(`/api/v1/sprints/${s.id}/tasks`)
                    .send({ task_ids: [t.id] });
                expect(res.status).toBe(204);
            },
        );

        // F28 (ISS-094, D12.1): one of the two grants ISS-094 called out by
        // name — a guest could plan the engineering sprint. Revoked.
        it("REFUSES a guest (403) — sprint.assign_tasks revoked", async () => {
            const { client, workspaceId } = await setup("guest");
            const s = await makeSprint({ workspaceId });
            const t = await makeTask({ workspaceId });
            const res = await client
                .post(`/api/v1/sprints/${s.id}/tasks`)
                .send({ task_ids: [t.id] });
            expect(res.status).toBe(403);
            expect(await sprintIdOf(t.id)).toBeNull();
        });
    });

    describe("authentication", () => {
        it("rejects a request with no token (401)", async () => {
            const { workspaceId } = await setup();
            const s = await makeSprint({ workspaceId });
            const t = await makeTask({ workspaceId });
            const http = await oneOff();
            const res = await http
                .post(`/api/v1/sprints/${s.id}/tasks`)
                .send({ task_ids: [t.id] });
            expect(res.status).toBe(401);
        });
    });
});
