import jwt from "jsonwebtoken";
import { eq } from "drizzle-orm";
import { oneOff } from "../test-utils/app";
import {
    makeWorkspace,
    makeUser,
    makeLoggedInClient,
    makeList,
    makeStatus,
    makeTaskType,
    makeTask,
} from "../test-utils/factories";
import { getDb } from "../../src/db/client";
import { tasks, taskActivity } from "../../src/db/schema";
import { Config } from "../../src/config";
import type { Role } from "../../src/constants";

/**
 * Tests for `PATCH /api/v1/tasks/:id` (§10 #5) — partial scalar update + ETag.
 *
 * N/A categories (documented): pagination.
 *
 * Null-to-clear of nullable fields IS supported (2026-07-14 fix): a PATCH like
 * `{ due_date: null }` clears the column (the controller re-includes explicit
 * nulls that `matchedData` drops, restricted to genuinely-nullable columns) —
 * this matches the client's date-picker `allowClear`. Partial date-order is
 * also guard-checked against the stored counterpart (start>due → 422, not a raw
 * `ck_tasks_dates` 500).
 */

jest.setTimeout(30_000);

const PATH = (id: string) => `/api/v1/tasks/${id}`;

const signAccess = (
    user: { id: string; workspaceId: string; role: Role },
    secret: string,
    opts: jwt.SignOptions = {},
): string =>
    jwt.sign(
        { sub: user.id, role: user.role, workspaceId: user.workspaceId },
        secret,
        { algorithm: "HS256", ...opts },
    );

const db = () => getDb();
const taskRow = async (id: string) => {
    const [row] = await db().select().from(tasks).where(eq(tasks.id, id));
    return row;
};
const etagOf = async (id: string): Promise<string> =>
    (await taskRow(id)).updatedAt.toISOString();
const activityFor = async (taskId: string) =>
    db().select().from(taskActivity).where(eq(taskActivity.taskId, taskId));

const seed = async (role: Role = "member", typeName?: string) => {
    const ws = await makeWorkspace();
    const user = await makeUser({ workspaceId: ws.id, role });
    const client = await makeLoggedInClient(user);
    const list = await makeList({ workspaceId: ws.id, createdBy: user.id });
    const taskType = await makeTaskType({ workspaceId: ws.id, name: typeName });
    const status = await makeStatus({
        scopeId: list.id,
        statusGroup: "not_started",
    });
    const task = await makeTask({
        workspaceId: ws.id,
        createdBy: user.id,
        listId: list.id,
        statusId: status.id,
        taskTypeId: taskType.id,
    });
    return { ws, user, client, list, taskType, status, task };
};

// ════════════════════════════════════════════════════════════════════════════
describe("PATCH /api/v1/tasks/:id", () => {
    // ─── a. Happy path ──────────────────────────────────────────────────────
    describe("Happy path", () => {
        it("addressed by CUSTOM_ID actually persists (gap-scan C5 — was a silent 0-row no-op)", async () => {
            const ctx = await seed();
            await db()
                .update(tasks)
                .set({ customId: "BUG-77" })
                .where(eq(tasks.id, ctx.task.id));

            const res = await ctx.client
                .patch(PATH("BUG-77"))
                .send({ name: "Renamed via custom id", priority: 3 });

            expect(res.status).toBe(200);
            expect(res.body.name).toBe("Renamed via custom id");

            // The regression was response-200-but-DB-unchanged — assert the ROW.
            const row = await taskRow(ctx.task.id);
            expect(row.name).toBe("Renamed via custom id");
            expect(row.priority).toBe(3);
        });
        it("updates scalar fields (200 + fresh ETag)", async () => {
            const ctx = await seed();

            const res = await ctx.client.patch(PATH(ctx.task.id)).send({
                name: "Renamed",
                priority: 4,
                description: "now with detail",
            });

            expect(res.status).toBe(200);
            expect(res.body.name).toBe("Renamed");
            expect(res.body.priority).toBe(4);
            expect(res.body.description).toBe("now with detail");
            expect(res.headers.etag).toBe(res.body.updated_at);
        });

        it("writes a task_updated activity row with the changed fields", async () => {
            const ctx = await seed();

            await ctx.client.patch(PATH(ctx.task.id)).send({ name: "X" });

            const acts = await activityFor(ctx.task.id);
            const updated = acts.find((a) => a.action === "task_updated");
            expect(updated).toBeDefined();
            expect(updated?.context).toMatchObject({ fields: ["name"] });
        });

        it("records status_changed and moves into a done group sets completed_at", async () => {
            const ctx = await seed();
            const done = await makeStatus({
                scopeId: ctx.list.id,
                statusGroup: "done",
            });

            const res = await ctx.client
                .patch(PATH(ctx.task.id))
                .send({ status_id: done.id });

            expect(res.status).toBe(200);
            expect(res.body.status_id).toBe(done.id);
            expect(res.body.completed_at).not.toBeNull();
            const acts = await activityFor(ctx.task.id);
            const sc = acts.find((a) => a.action === "status_changed");
            expect(sc?.context).toMatchObject({
                from: ctx.status.id,
                to: done.id,
            });
        });

        it("clears completed_at when moving back out of a done group", async () => {
            const ctx = await seed();
            const done = await makeStatus({
                scopeId: ctx.list.id,
                statusGroup: "done",
            });
            await ctx.client.patch(PATH(ctx.task.id)).send({ status_id: done.id });

            const res = await ctx.client
                .patch(PATH(ctx.task.id))
                .send({ status_id: ctx.status.id });

            expect(res.status).toBe(200);
            expect(res.body.completed_at).toBeNull();
        });

        it("recomputes sla_due_at when a Bug task's severity changes", async () => {
            const ctx = await seed("member", "Bug");

            const res = await ctx.client
                .patch(PATH(ctx.task.id))
                .send({ bug_severity: "S0" });

            expect(res.status).toBe(200);
            expect(res.body.bug_severity).toBe("S0");
            const sla = new Date(res.body.sla_due_at).getTime();
            expect(Math.abs(sla - (Date.now() + 2 * 3600 * 1000))).toBeLessThan(
                5 * 60 * 1000,
            );
        });
    });

    // ─── ETag / optimistic concurrency ─────────────────────────────────────────
    describe("ETag / If-Match", () => {
        it("succeeds when If-Match equals the current ETag", async () => {
            const ctx = await seed();
            const etag = await etagOf(ctx.task.id);

            const res = await ctx.client
                .patch(PATH(ctx.task.id))
                .set("If-Match", etag)
                .send({ name: "Matched" });

            expect(res.status).toBe(200);
        });

        it("409 task.conflict when If-Match is stale", async () => {
            const ctx = await seed();

            const res = await ctx.client
                .patch(PATH(ctx.task.id))
                .set("If-Match", "2020-01-01T00:00:00.000Z")
                .send({ name: "Stale" });

            expect(res.status).toBe(409);
            expect(res.body.error.code).toBe("task.conflict");
        });

        it("skips the check when no If-Match header is sent", async () => {
            const ctx = await seed();

            const res = await ctx.client
                .patch(PATH(ctx.task.id))
                .send({ name: "NoEtag" });

            expect(res.status).toBe(200);
        });
    });

    // ─── b. Validation (422) ────────────────────────────────────────────────
    describe("Validation", () => {
        it("422 for an empty body (no fields)", async () => {
            const ctx = await seed();
            const res = await ctx.client.patch(PATH(ctx.task.id)).send({});
            expect(res.status).toBe(422);
            expect(res.body.error.code).toBe("validation.failed");
        });

        it("422 for an out-of-range priority", async () => {
            const ctx = await seed();
            const res = await ctx.client
                .patch(PATH(ctx.task.id))
                .send({ priority: 9 });
            expect(res.status).toBe(422);
            expect(res.body.error.code).toBe("validation.failed");
        });

        it("422 task.invalid_status for a status not in the task's list", async () => {
            const ctx = await seed();
            const otherList = await makeList({
                workspaceId: ctx.ws.id,
                createdBy: ctx.user.id,
            });
            const foreign = await makeStatus({ scopeId: otherList.id });
            const res = await ctx.client
                .patch(PATH(ctx.task.id))
                .send({ status_id: foreign.id });
            expect(res.status).toBe(422);
            expect(res.body.error.code).toBe("task.invalid_status");
        });

        it("422 task.invalid_task_type for a bad task_type_id", async () => {
            const ctx = await seed();
            const res = await ctx.client
                .patch(PATH(ctx.task.id))
                .send({ task_type_id: "tt-nope" });
            expect(res.status).toBe(422);
            expect(res.body.error.code).toBe("task.invalid_task_type");
        });
    });

    // ─── c. Authentication (401) ──────────────────────────────────────────────
    describe("Authentication", () => {
        it("401 when no token is supplied", async () => {
            const http = await oneOff();
            const res = await http.patch(PATH("t-x")).send({ name: "x" });
            expect(res.status).toBe(401);
            expect(res.body.error.code).toBe("auth.missing_token");
        });
    });

    // ─── e. Not found / archived ───────────────────────────────────────────────
    describe("Resource lifecycle", () => {
        it("404 task.not_found for an id that exists nowhere", async () => {
            const ctx = await seed();
            const res = await ctx.client
                .patch(PATH("t-nope"))
                .send({ name: "x" });
            expect(res.status).toBe(404);
            expect(res.body.error.code).toBe("task.not_found");
        });

        it("409 task.archived for an archived task", async () => {
            const ctx = await seed();
            await db()
                .update(tasks)
                .set({ archivedAt: new Date() })
                .where(eq(tasks.id, ctx.task.id));
            const res = await ctx.client
                .patch(PATH(ctx.task.id))
                .send({ name: "x" });
            expect(res.status).toBe(409);
            expect(res.body.error.code).toBe("task.archived");
        });
    });

    // ─── g. Workspace isolation ────────────────────────────────────────────────
    describe("Workspace isolation", () => {
        it("404 for a task in another workspace", async () => {
            const ctx = await seed();
            const ws2 = await makeWorkspace();
            const u2 = await makeUser({ workspaceId: ws2.id, role: "member" });
            const other = await makeTask({
                workspaceId: ws2.id,
                createdBy: u2.id,
            });
            const res = await ctx.client
                .patch(PATH(other.id))
                .send({ name: "x" });
            expect(res.status).toBe(404);
            expect(res.body.error.code).toBe("task.not_found");
        });
    });

    // ─── n. Cross-cutting ──────────────────────────────────────────────────────
    describe("Cross-cutting", () => {
        it("responds json with X-Request-Id + ETag", async () => {
            const ctx = await seed();
            const res = await ctx.client
                .patch(PATH(ctx.task.id))
                .send({ name: "x" });
            expect(res.headers["content-type"]).toMatch(/application\/json/);
            expect(res.headers["x-request-id"]).toMatch(/^req_/);
            expect(res.headers.etag).toBeDefined();
        });
    });
});
