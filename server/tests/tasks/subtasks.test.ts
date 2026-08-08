import jwt from "jsonwebtoken";
import { eq } from "drizzle-orm";
import { oneOff } from "../test-utils/app";
import {
    makeWorkspace,
    makeUser,
    makeLoggedInClient,
    makeTask,
} from "../test-utils/factories";
import { getDb } from "../../src/db/client";
import { tasks, taskActivity } from "../../src/db/schema";
import { Config } from "../../src/config";
import type { Role } from "../../src/constants";

/**
 * Tests for `GET /api/v1/tasks/:id/subtasks` (§10 #3) — the parent's DIRECT
 * children as a bare `Task[]`. Built already (TasksController.getSubtasks);
 * this suite is the Prompt-4 coverage it was missing.
 *
 * These tests insert top-level then UPDATE `parent_task_id`+`nesting_depth`
 * (a harmless legacy workaround). As of 2026-07-14 the MySQL-incompatible
 * subtask counter triggers were REMOVED (a `tasks` trigger cannot UPDATE
 * `tasks` — error 1442 — which crashed subtask status changes), so the direct
 * path also works now. `subtasks_count`/`subtasks_completed` keep their 0
 * default (accurate app-side maintenance is a tracked gate follow-up) —
 * irrelevant to this read endpoint.
 *
 * N/A categories (documented): pagination (bare array, no envelope); body
 * validation (only the :id param + include_archived query); conflict/idempotency.
 */

jest.setTimeout(30_000);

const PATH = (id: string) => `/api/v1/tasks/${id}/subtasks`;

const signAccess = (
    user: { id: string; workspaceId: string; role: Role },
    secret: string,
    opts: jwt.SignOptions = {},
): string =>
    jwt.sign(
        { sub: user.id, role: user.role, workspaceId: user.workspaceId },
        secret,
        { algorithm: "HS256", expiresIn: "15m", ...opts },
    );

const seed = async (role: Role = "member") => {
    const ws = await makeWorkspace();
    const user = await makeUser({ workspaceId: ws.id, role });
    const client = await makeLoggedInClient(user);
    const parent = await makeTask({ workspaceId: ws.id, createdBy: user.id });
    return { ws, user, client, parent };
};

/** Attach a fresh top-level task to `parentId` (the 1442 workaround). */
const makeChild = async (
    ctx: { ws: { id: string }; user: { id: string }; parent: { listId: string } },
    parentId: string,
    opts: { archivedAt?: Date | null; nestingDepth?: number } = {},
) => {
    const child = await makeTask({
        workspaceId: ctx.ws.id,
        createdBy: ctx.user.id,
        listId: ctx.parent.listId,
        archivedAt: opts.archivedAt ?? null,
    });
    await getDb()
        .update(tasks)
        .set({ parentTaskId: parentId, nestingDepth: opts.nestingDepth ?? 1 })
        .where(eq(tasks.id, child.id));
    return child;
};

const setCustomId = async (taskId: string, customId: string) => {
    await getDb().update(tasks).set({ customId }).where(eq(tasks.id, taskId));
};
const countActivity = async (taskId: string): Promise<number> =>
    (
        await getDb()
            .select({ id: taskActivity.id })
            .from(taskActivity)
            .where(eq(taskActivity.taskId, taskId))
    ).length;

// ════════════════════════════════════════════════════════════════════════════
describe("GET /api/v1/tasks/:id/subtasks", () => {
    // ─── a. Happy path ──────────────────────────────────────────────────────
    describe("Happy path", () => {
        it("returns 200 with a bare array of the parent's direct children", async () => {
            const ctx = await seed();
            const c1 = await makeChild(ctx, ctx.parent.id);
            const c2 = await makeChild(ctx, ctx.parent.id);

            const res = await ctx.client.get(PATH(ctx.parent.id));

            expect(res.status).toBe(200);
            expect(Array.isArray(res.body)).toBe(true);
            expect(res.body).not.toHaveProperty("data");
            expect(res.body.map((t: { id: string }) => t.id)).toEqual([
                c1.id,
                c2.id,
            ]);
        });

        it("returns an empty array (not 404) when the parent has no children", async () => {
            const ctx = await seed();

            const res = await ctx.client.get(PATH(ctx.parent.id));

            expect(res.status).toBe(200);
            expect(res.body).toEqual([]);
        });

        it("hydrates each child (assignees/watchers/tags/custom_field_values inline)", async () => {
            const ctx = await seed();
            await makeChild(ctx, ctx.parent.id);

            const res = await ctx.client.get(PATH(ctx.parent.id));

            const child = res.body[0];
            expect(child.parent_task_id).toBe(ctx.parent.id);
            expect(child.nesting_depth).toBe(1);
            expect(child.assignees).toEqual([]);
            expect(child.watchers).toEqual([]);
            expect(child.tags).toEqual([]);
            expect(child.custom_field_values).toEqual({});
            expect(child).not.toHaveProperty("internal_id");
        });

        it("returns only DIRECT children, not grandchildren", async () => {
            const ctx = await seed();
            const child = await makeChild(ctx, ctx.parent.id);
            const grandchild = await makeChild(ctx, child.id, {
                nestingDepth: 2,
            });

            const parentKids = await ctx.client.get(PATH(ctx.parent.id));
            const childKids = await ctx.client.get(PATH(child.id));

            expect(parentKids.body.map((t: { id: string }) => t.id)).toEqual([
                child.id,
            ]);
            expect(childKids.body.map((t: { id: string }) => t.id)).toEqual([
                grandchild.id,
            ]);
        });

        it("resolves the parent by custom_id too", async () => {
            const ctx = await seed();
            await setCustomId(ctx.parent.id, "ORD-7");
            const c1 = await makeChild(ctx, ctx.parent.id);

            const res = await ctx.client.get(PATH("ORD-7"));

            expect(res.status).toBe(200);
            expect(res.body.map((t: { id: string }) => t.id)).toEqual([c1.id]);
        });
    });

    // ─── Archived children ───────────────────────────────────────────────────
    describe("Archived children", () => {
        it("excludes archived children by default", async () => {
            const ctx = await seed();
            const live = await makeChild(ctx, ctx.parent.id);
            await makeChild(ctx, ctx.parent.id, { archivedAt: new Date() });

            const res = await ctx.client.get(PATH(ctx.parent.id));

            expect(res.body.map((t: { id: string }) => t.id)).toEqual([live.id]);
        });

        it("includes archived children when ?include_archived=true", async () => {
            const ctx = await seed();
            const live = await makeChild(ctx, ctx.parent.id);
            const archived = await makeChild(ctx, ctx.parent.id, {
                archivedAt: new Date(),
            });

            const res = await ctx.client.get(
                `${PATH(ctx.parent.id)}?include_archived=true`,
            );

            expect(res.body.map((t: { id: string }) => t.id).sort()).toEqual(
                [live.id, archived.id].sort(),
            );
        });
    });

    // ─── b. Validation (422) ────────────────────────────────────────────────
    describe("Validation", () => {
        it("returns 422 for an over-length id (65 chars)", async () => {
            const ctx = await seed();

            const res = await ctx.client.get(PATH("a".repeat(65)));

            expect(res.status).toBe(422);
            expect(res.body.error.code).toBe("validation.failed");
        });

        it("returns 422 for a non-boolean include_archived", async () => {
            const ctx = await seed();

            const res = await ctx.client.get(
                `${PATH(ctx.parent.id)}?include_archived=maybe`,
            );

            expect(res.status).toBe(422);
            expect(res.body.error.code).toBe("validation.failed");
        });
    });

    // ─── c. Authentication (401) ──────────────────────────────────────────────
    describe("Authentication", () => {
        it("returns 401 auth.missing_token when no token is supplied", async () => {
            const http = await oneOff();

            const res = await http.get(PATH("t-anything"));

            expect(res.status).toBe(401);
            expect(res.body.error.code).toBe("auth.missing_token");
        });

        it("returns 401 auth.expired_token for an expired token", async () => {
            const { user } = await seed();
            const token = signAccess(
                { id: user.id, workspaceId: user.workspaceId, role: user.role },
                Config.ACCESS_TOKEN_SECRET!,
                { expiresIn: -10 },
            );
            const http = await oneOff();

            const res = await http
                .get(PATH("t-anything"))
                .set("Authorization", `Bearer ${token}`);

            expect(res.status).toBe(401);
            expect(res.body.error.code).toBe("auth.expired_token");
        });
    });

    // ─── d. Authorization (🔐 any member, incl. guest) ───────────────────────
    describe("Authorization", () => {
        it("allows a guest to read subtasks (200)", async () => {
            const ctx = await seed();
            await makeChild(ctx, ctx.parent.id);
            const guest = await makeUser({
                workspaceId: ctx.ws.id,
                role: "guest",
            });
            const guestClient = await makeLoggedInClient(guest);

            const res = await guestClient.get(PATH(ctx.parent.id));

            expect(res.status).toBe(200);
            expect(res.body).toHaveLength(1);
        });
    });

    // ─── e. Not found ──────────────────────────────────────────────────────────
    describe("Not found", () => {
        it("returns 404 task.not_found for a parent that exists nowhere", async () => {
            const ctx = await seed();

            const res = await ctx.client.get(PATH("t-nope"));

            expect(res.status).toBe(404);
            expect(res.body.error.code).toBe("task.not_found");
        });

        it("returns 404 for a parent in another workspace", async () => {
            const ctx = await seed();
            const ws2 = await makeWorkspace();
            const u2 = await makeUser({ workspaceId: ws2.id, role: "member" });
            const otherParent = await makeTask({
                workspaceId: ws2.id,
                createdBy: u2.id,
            });

            const res = await ctx.client.get(PATH(otherParent.id));

            expect(res.status).toBe(404);
            expect(res.body.error.code).toBe("task.not_found");
        });
    });

    // ─── l. Side-effects ─────────────────────────────────────────────────────────
    describe("Side-effects", () => {
        it("writes no task_activity row on a successful read", async () => {
            const ctx = await seed();
            await makeChild(ctx, ctx.parent.id);

            await ctx.client.get(PATH(ctx.parent.id));

            expect(await countActivity(ctx.parent.id)).toBe(0);
        });
    });

    // ─── n. Cross-cutting ──────────────────────────────────────────────────────
    describe("Cross-cutting", () => {
        it("responds as application/json with an X-Request-Id header", async () => {
            const ctx = await seed();

            const res = await ctx.client.get(PATH(ctx.parent.id));

            expect(res.headers["content-type"]).toMatch(/application\/json/);
            expect(res.headers["x-request-id"]).toMatch(/^req_/);
        });
    });
});
