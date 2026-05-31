import { and, eq } from "drizzle-orm";
import { oneOff } from "../test-utils/app";
import {
    makeList,
    makeLoggedInClient,
    makeSprint,
    makeStatus,
    makeTask,
    makeUser,
    makeWorkspace,
} from "../test-utils/factories";
import { getDb } from "../../src/db/client";
import { sprints, taskActivity, tasks, workspaceActivity } from "../../src/db/schema";
import type { Role } from "../../src/constants";

/**
 * §20 #7 — POST /api/v1/sprints/:id/close  (active → closed)
 *
 * 👑 Owner/Admin. Snapshots completed-points into the audit row, rolls the
 * sprint's UNFINISHED tasks into the next planned sprint (if any), and returns
 * `{ rolled_over: N }`. Already-closed is an idempotent `{ rolled_over: 0 }`; a
 * planned sprint cannot be closed (409).
 */

const setup = async (role: Role = "owner") => {
    const u = await makeUser({ role });
    const client = await makeLoggedInClient(u);
    const workspaceId = u.workspaceId;
    const list = await makeList({ workspaceId, createdBy: u.id });
    const done = await makeStatus({ scopeId: list.id, statusGroup: "done" });
    const closed = await makeStatus({ scopeId: list.id, statusGroup: "closed" });
    const todo = await makeStatus({ scopeId: list.id, statusGroup: "not_started" });
    return { u, client, workspaceId, list, done, closed, todo };
};

/** Create a task in `list`, then place it in `sprintId` with `storyPoints`. */
const placeTask = async (opts: {
    workspaceId: string;
    listId: string;
    statusId: string;
    sprintId: string;
    storyPoints?: number | null;
}) => {
    const t = await makeTask({
        workspaceId: opts.workspaceId,
        listId: opts.listId,
        statusId: opts.statusId,
    });
    await getDb()
        .update(tasks)
        .set({ sprintId: opts.sprintId, storyPoints: opts.storyPoints ?? null })
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

const statusOf = async (id: string): Promise<string> => {
    const [row] = await getDb().select().from(sprints).where(eq(sprints.id, id));
    return row.status;
};

const closedActivity = async (workspaceId: string, sprintId: string) => {
    const rows = await getDb()
        .select()
        .from(workspaceActivity)
        .where(
            and(
                eq(workspaceActivity.workspaceId, workspaceId),
                eq(workspaceActivity.entityId, sprintId),
                eq(workspaceActivity.action, "closed"),
            ),
        );
    return rows;
};

describe("POST /api/v1/sprints/:id/close", () => {
    describe("happy path", () => {
        it("closes an active sprint with no tasks → 200 { rolled_over: 0 }", async () => {
            const { client, workspaceId } = await setup();
            const s = await makeSprint({ workspaceId, status: "active" });

            const res = await client.post(`/api/v1/sprints/${s.id}/close`);

            expect(res.status).toBe(200);
            expect(res.body).toEqual({ rolled_over: 0 });
            expect(await statusOf(s.id)).toBe("closed");
        });

        it("records a 'closed' workspace_activity row with the completed-points snapshot", async () => {
            const { client, workspaceId, list, done, closed, todo } =
                await setup();
            const s = await makeSprint({ workspaceId, status: "active" });
            // 8 + 5 completed; 3 unfinished (not counted); no planned sprint to roll into.
            await placeTask({
                workspaceId,
                listId: list.id,
                statusId: done.id,
                sprintId: s.id,
                storyPoints: 8,
            });
            await placeTask({
                workspaceId,
                listId: list.id,
                statusId: closed.id,
                sprintId: s.id,
                storyPoints: 5,
            });
            await placeTask({
                workspaceId,
                listId: list.id,
                statusId: todo.id,
                sprintId: s.id,
                storyPoints: 3,
            });

            const res = await client.post(`/api/v1/sprints/${s.id}/close`);

            expect(res.status).toBe(200);
            const rows = await closedActivity(workspaceId, s.id);
            expect(rows).toHaveLength(1);
            expect(rows[0].context).toMatchObject({
                completed_points: 13,
                rolled_over: 0,
            });
        });
    });

    describe("rollover", () => {
        it("rolls unfinished tasks into the next planned sprint, leaving finished ones", async () => {
            const { client, workspaceId, list, done, todo } = await setup();
            const active = await makeSprint({
                workspaceId,
                name: "Active",
                status: "active",
                startDate: "2026-06-01",
                endDate: "2026-06-14",
            });
            const next = await makeSprint({
                workspaceId,
                name: "Next",
                status: "planned",
                startDate: "2026-06-15",
                endDate: "2026-06-28",
            });

            const unfinished = await placeTask({
                workspaceId,
                listId: list.id,
                statusId: todo.id,
                sprintId: active.id,
                storyPoints: 3,
            });
            const finished = await placeTask({
                workspaceId,
                listId: list.id,
                statusId: done.id,
                sprintId: active.id,
                storyPoints: 8,
            });

            const res = await client.post(`/api/v1/sprints/${active.id}/close`);

            expect(res.status).toBe(200);
            expect(res.body).toEqual({ rolled_over: 1 });
            expect(await sprintIdOf(unfinished)).toBe(next.id);
            expect(await sprintIdOf(finished)).toBe(active.id);
        });

        it("rolls into the EARLIEST planned sprint by start_date", async () => {
            const { client, workspaceId, list, todo } = await setup();
            const active = await makeSprint({
                workspaceId,
                name: "Active",
                status: "active",
                startDate: "2026-06-01",
                endDate: "2026-06-14",
            });
            const later = await makeSprint({
                workspaceId,
                name: "Later",
                status: "planned",
                startDate: "2026-08-01",
                endDate: "2026-08-14",
            });
            const earlier = await makeSprint({
                workspaceId,
                name: "Earlier",
                status: "planned",
                startDate: "2026-07-01",
                endDate: "2026-07-14",
            });

            const unfinished = await placeTask({
                workspaceId,
                listId: list.id,
                statusId: todo.id,
                sprintId: active.id,
            });

            await client.post(`/api/v1/sprints/${active.id}/close`);

            expect(await sprintIdOf(unfinished)).toBe(earlier.id);
            expect(later).toBeTruthy(); // (later sprint is untouched)
        });

        it("does NOT roll over when there is no planned sprint (tasks stay)", async () => {
            const { client, workspaceId, list, todo } = await setup();
            const active = await makeSprint({ workspaceId, status: "active" });
            const stuck = await placeTask({
                workspaceId,
                listId: list.id,
                statusId: todo.id,
                sprintId: active.id,
            });

            const res = await client.post(`/api/v1/sprints/${active.id}/close`);

            expect(res.body).toEqual({ rolled_over: 0 });
            expect(await sprintIdOf(stuck)).toBe(active.id);
        });

        it("writes a 'sprint_rolled_over' task_activity row per moved task", async () => {
            const { client, workspaceId, list, todo } = await setup();
            const active = await makeSprint({ workspaceId, status: "active" });
            const next = await makeSprint({
                workspaceId,
                status: "planned",
                startDate: "2026-09-01",
                endDate: "2026-09-14",
            });
            const moved = await placeTask({
                workspaceId,
                listId: list.id,
                statusId: todo.id,
                sprintId: active.id,
            });

            await client.post(`/api/v1/sprints/${active.id}/close`);

            const acts = await getDb()
                .select()
                .from(taskActivity)
                .where(eq(taskActivity.taskId, moved));
            const rollovers = acts.filter(
                (a) => a.action === "sprint_rolled_over",
            );
            expect(rollovers).toHaveLength(1);
            expect(rollovers[0].context).toMatchObject({
                from_sprint_id: active.id,
                to_sprint_id: next.id,
            });
        });
    });

    describe("archived (soft-deleted) tasks", () => {
        it("does NOT roll over an archived open-status task", async () => {
            const { client, workspaceId, list, todo } = await setup();
            const active = await makeSprint({ workspaceId, status: "active" });
            const next = await makeSprint({
                workspaceId,
                status: "planned",
                startDate: "2026-09-01",
                endDate: "2026-09-14",
            });
            const archived = await makeTask({
                workspaceId,
                listId: list.id,
                statusId: todo.id,
                archivedAt: new Date(),
            });
            await getDb()
                .update(tasks)
                .set({ sprintId: active.id })
                .where(eq(tasks.id, archived.id));

            const res = await client.post(`/api/v1/sprints/${active.id}/close`);

            expect(res.body).toEqual({ rolled_over: 0 });
            // not resurrected into the next planned sprint
            expect(await sprintIdOf(archived.id)).toBe(active.id);
            expect(next).toBeTruthy();
        });

        it("excludes an archived done task from the completed-points snapshot", async () => {
            const { client, workspaceId, list, done } = await setup();
            const s = await makeSprint({ workspaceId, status: "active" });
            await placeTask({
                workspaceId,
                listId: list.id,
                statusId: done.id,
                sprintId: s.id,
                storyPoints: 8,
            });
            const archivedDone = await makeTask({
                workspaceId,
                listId: list.id,
                statusId: done.id,
                archivedAt: new Date(),
            });
            await getDb()
                .update(tasks)
                .set({ sprintId: s.id, storyPoints: 5 })
                .where(eq(tasks.id, archivedDone.id));

            await client.post(`/api/v1/sprints/${s.id}/close`);

            const rows = await closedActivity(workspaceId, s.id);
            expect(rows[0].context).toMatchObject({ completed_points: 8 });
        });
    });

    describe("idempotency / invalid transition", () => {
        it("closing an already-closed sprint is a 200 no-op", async () => {
            const { client, workspaceId } = await setup();
            const s = await makeSprint({ workspaceId, status: "closed" });

            const res = await client.post(`/api/v1/sprints/${s.id}/close`);

            expect(res.status).toBe(200);
            expect(res.body).toEqual({ rolled_over: 0 });
            expect(await closedActivity(workspaceId, s.id)).toHaveLength(0);
        });

        it("409 sprint.invalid_status when closing a planned sprint", async () => {
            const { client, workspaceId } = await setup();
            const s = await makeSprint({ workspaceId, status: "planned" });

            const res = await client.post(`/api/v1/sprints/${s.id}/close`);

            expect(res.status).toBe(409);
            expect(res.body.error.code).toBe("sprint.invalid_status");
            expect(await statusOf(s.id)).toBe("planned");
        });
    });

    describe("not found", () => {
        it("404 for an unknown id", async () => {
            const { client } = await setup();
            const res = await client.post("/api/v1/sprints/spr-nope/close");
            expect(res.status).toBe(404);
            expect(res.body.error.code).toBe("sprint.not_found");
        });

        it("404 for a sprint in another workspace", async () => {
            const { client } = await setup();
            const otherWs = await makeWorkspace();
            const theirs = await makeSprint({
                workspaceId: otherWs.id,
                status: "active",
            });

            const res = await client.post(`/api/v1/sprints/${theirs.id}/close`);

            expect(res.status).toBe(404);
            expect(await statusOf(theirs.id)).toBe("active");
        });
    });

    describe("authorization (👑 owner/admin)", () => {
        it.each<Role>(["owner", "admin"])("allows a %s (200)", async (role) => {
            const { client, workspaceId } = await setup(role);
            const s = await makeSprint({ workspaceId, status: "active" });
            const res = await client.post(`/api/v1/sprints/${s.id}/close`);
            expect(res.status).toBe(200);
        });

        it.each<Role>(["member", "guest"])(
            "forbids a %s (403)",
            async (role) => {
                const { client, workspaceId } = await setup(role);
                const s = await makeSprint({ workspaceId, status: "active" });
                const res = await client.post(`/api/v1/sprints/${s.id}/close`);
                expect(res.status).toBe(403);
                expect(res.body.error.code).toBe("auth.forbidden");
                expect(await statusOf(s.id)).toBe("active");
            },
        );
    });

    describe("authentication", () => {
        it("rejects a request with no token (401)", async () => {
            const { workspaceId } = await setup();
            const s = await makeSprint({ workspaceId, status: "active" });
            const http = await oneOff();
            const res = await http.post(`/api/v1/sprints/${s.id}/close`);
            expect(res.status).toBe(401);
        });
    });
});
