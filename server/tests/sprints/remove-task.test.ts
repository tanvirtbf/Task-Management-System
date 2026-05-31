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
 * §20 #9 — DELETE /api/v1/sprints/:id/tasks/:taskId
 *
 * 🔐 any member. Clears `tasks.sprint_id`. 404 if the sprint or task is
 * missing/cross-tenant, or if the task is not in THIS sprint. Returns 204;
 * records `task_activity` (`sprint_removed`) + `workspace_activity`
 * (`task_removed`).
 */

const setup = async (role: Role = "member") => {
    const u = await makeUser({ role });
    const client = await makeLoggedInClient(u);
    return { u, client, workspaceId: u.workspaceId };
};

/** Make a task already attached to `sprintId`. */
const taskInSprint = async (workspaceId: string, sprintId: string) => {
    const t = await makeTask({ workspaceId });
    await getDb()
        .update(tasks)
        .set({ sprintId })
        .where(eq(tasks.id, t.id));
    return t.id;
};

const sprintIdOf = async (taskId: string): Promise<string | null> => {
    const [r] = await getDb()
        .select({ sprintId: tasks.sprintId })
        .from(tasks)
        .where(eq(tasks.id, taskId));
    return r.sprintId;
};

describe("DELETE /api/v1/sprints/:id/tasks/:taskId", () => {
    describe("happy path", () => {
        it("detaches the task and returns 204", async () => {
            const { client, workspaceId } = await setup();
            const s = await makeSprint({ workspaceId });
            const taskId = await taskInSprint(workspaceId, s.id);

            const res = await client.delete(
                `/api/v1/sprints/${s.id}/tasks/${taskId}`,
            );

            expect(res.status).toBe(204);
            expect(await sprintIdOf(taskId)).toBeNull();
        });

        it("records 'sprint_removed' + 'task_removed' activity", async () => {
            const { client, workspaceId, u } = await setup();
            const s = await makeSprint({ workspaceId });
            const taskId = await taskInSprint(workspaceId, s.id);

            await client.delete(`/api/v1/sprints/${s.id}/tasks/${taskId}`);

            const taskActs = (
                await getDb()
                    .select()
                    .from(taskActivity)
                    .where(eq(taskActivity.taskId, taskId))
            ).filter((a) => a.action === "sprint_removed");
            expect(taskActs).toHaveLength(1);
            expect(taskActs[0].actorId).toBe(u.id);

            const wsActs = await getDb()
                .select()
                .from(workspaceActivity)
                .where(
                    and(
                        eq(workspaceActivity.entityId, s.id),
                        eq(workspaceActivity.action, "task_removed"),
                    ),
                );
            expect(wsActs).toHaveLength(1);
            expect(wsActs[0].context).toMatchObject({ task_id: taskId });
        });

        it("can detach a task that was archived after being added", async () => {
            const { client, workspaceId } = await setup();
            const s = await makeSprint({ workspaceId });
            const t = await makeTask({ workspaceId });
            await getDb()
                .update(tasks)
                .set({ sprintId: s.id, archivedAt: new Date() })
                .where(eq(tasks.id, t.id));

            const res = await client.delete(
                `/api/v1/sprints/${s.id}/tasks/${t.id}`,
            );

            expect(res.status).toBe(204);
            expect(await sprintIdOf(t.id)).toBeNull();
        });
    });

    describe("not found", () => {
        it("404 sprint.not_found when the sprint is missing", async () => {
            const { client, workspaceId } = await setup();
            const taskId = await taskInSprint(
                workspaceId,
                (await makeSprint({ workspaceId })).id,
            );
            const res = await client.delete(
                `/api/v1/sprints/spr-nope/tasks/${taskId}`,
            );
            expect(res.status).toBe(404);
            expect(res.body.error.code).toBe("sprint.not_found");
        });

        it("404 task.not_found when the task does not exist", async () => {
            const { client, workspaceId } = await setup();
            const s = await makeSprint({ workspaceId });
            const res = await client.delete(
                `/api/v1/sprints/${s.id}/tasks/t-missing`,
            );
            expect(res.status).toBe(404);
            expect(res.body.error.code).toBe("task.not_found");
        });

        it("404 sprint.task_not_in_sprint when the task is in a different sprint", async () => {
            const { client, workspaceId } = await setup();
            const target = await makeSprint({ workspaceId, name: "Target" });
            const other = await makeSprint({ workspaceId, name: "Other" });
            const taskId = await taskInSprint(workspaceId, other.id);

            const res = await client.delete(
                `/api/v1/sprints/${target.id}/tasks/${taskId}`,
            );

            expect(res.status).toBe(404);
            expect(res.body.error.code).toBe("sprint.task_not_in_sprint");
            // still attached to its real sprint — nothing mutated
            expect(await sprintIdOf(taskId)).toBe(other.id);
        });

        it("404 task.not_found when the task belongs to another workspace", async () => {
            const { client, workspaceId } = await setup();
            const s = await makeSprint({ workspaceId });
            const otherWs = await makeWorkspace();
            const theirSprint = await makeSprint({ workspaceId: otherWs.id });
            const theirTask = await taskInSprint(otherWs.id, theirSprint.id);

            const res = await client.delete(
                `/api/v1/sprints/${s.id}/tasks/${theirTask}`,
            );

            expect(res.status).toBe(404);
            expect(res.body.error.code).toBe("task.not_found");
        });
    });

    describe("authorization (🔐 any member)", () => {
        it.each<Role>(["owner", "admin", "member", "guest"])(
            "allows a %s to detach (204)",
            async (role) => {
                const { client, workspaceId } = await setup(role);
                const s = await makeSprint({ workspaceId });
                const taskId = await taskInSprint(workspaceId, s.id);
                const res = await client.delete(
                    `/api/v1/sprints/${s.id}/tasks/${taskId}`,
                );
                expect(res.status).toBe(204);
            },
        );
    });

    describe("authentication", () => {
        it("rejects a request with no token (401)", async () => {
            const { workspaceId } = await setup();
            const s = await makeSprint({ workspaceId });
            const taskId = await taskInSprint(workspaceId, s.id);
            const http = await oneOff();
            const res = await http.delete(
                `/api/v1/sprints/${s.id}/tasks/${taskId}`,
            );
            expect(res.status).toBe(401);
        });
    });
});
