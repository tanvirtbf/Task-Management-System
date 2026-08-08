import jwt from "jsonwebtoken";
import { eq } from "drizzle-orm";
import { oneOff } from "../test-utils/app";
import {
    makeUser,
    makeTask,
    makeTag,
    makeLoggedInClient,
} from "../test-utils/factories";
import { getDb } from "../../src/db/client";
import {
    taskTags,
    taskActivity,
    notifications,
    tasks,
} from "../../src/db/schema";
import { Config } from "../../src/config";
import { fakeId } from "../../src/utils";

/**
 * Tests for `DELETE /api/v1/tasks/:id/tags/:tagId` (§11 #6 — newly built).
 *
 * Shared-state membership write (mirrors removeAssignee): in one txn locks the
 * task, diffs the current set, deletes the junction row, writes a `tag_removed`
 * activity row, bumps the ETag. Idempotent (removing a not-applied/absent/
 * foreign tag is a 204 no-op — never an oracle). No notification. Runs on the
 * isolated `tms_membership_test` DB. ⚠️ ONE FILE PER JEST PROCESS.
 */
jest.setTimeout(30000);

const PAST = new Date("2020-01-01T00:00:00.000Z");
const tagPath = (taskId: string, tagId: string) =>
    `/api/v1/tasks/${taskId}/tags/${tagId}`;

const seedTaskTag = async (taskId: string, tagId: string) => {
    await getDb().insert(taskTags).values({ taskId, tagId });
};
const getTags = async (taskId: string) =>
    (
        await getDb()
            .select({ tagId: taskTags.tagId })
            .from(taskTags)
            .where(eq(taskTags.taskId, taskId))
    ).map((r) => r.tagId);
const getActivity = async (taskId: string) =>
    getDb()
        .select({
            action: taskActivity.action,
            actorId: taskActivity.actorId,
            context: taskActivity.context,
        })
        .from(taskActivity)
        .where(eq(taskActivity.taskId, taskId));
const countNotifications = async () =>
    (await getDb().select({ id: notifications.id }).from(notifications)).length;
const setUpdatedAtPast = async (taskId: string) => {
    await getDb()
        .update(tasks)
        .set({ updatedAt: PAST })
        .where(eq(tasks.id, taskId));
};
const getUpdatedAt = async (taskId: string) => {
    const [row] = await getDb()
        .select({ updatedAt: tasks.updatedAt })
        .from(tasks)
        .where(eq(tasks.id, taskId));
    return row?.updatedAt ?? null;
};
const signAccess = (
    user: { id: string; workspaceId: string; role: string },
    secret: string,
    opts: jwt.SignOptions = { algorithm: "HS256", expiresIn: "15m" },
) =>
    jwt.sign(
        {
            sub: user.id,
            role: user.role,
            workspaceId: user.workspaceId,
            id: fakeId("ses"),
        },
        secret,
        opts,
    );

/** Seed a task with one applied tag; returns {task, tag, user, client-ready user}. */
const seedTaggedTask = async (
    role: "owner" | "admin" | "member" | "guest" = "member",
) => {
    const u = await makeUser({ role });
    const t = await makeTask({ workspaceId: u.workspaceId, createdBy: u.id });
    const tag = await makeTag({ workspaceId: u.workspaceId });
    await seedTaskTag(t.id, tag.id);
    return { u, t, tag };
};

// ════════════════════════════════════════════════════════════════════════════
describe("DELETE /api/v1/tasks/:id/tags/:tagId", () => {
    describe("Happy path", () => {
        it("removes a tag, returns 204, writes a tag_removed activity row, bumps updated_at", async () => {
            const { u, t, tag } = await seedTaggedTask("admin");
            await setUpdatedAtPast(t.id);
            const client = await makeLoggedInClient(u);

            const res = await client.delete(tagPath(t.id, tag.id));

            expect(res.status).toBe(204);
            expect(await getTags(t.id)).not.toContain(tag.id);

            const acts = await getActivity(t.id);
            expect(acts).toHaveLength(1);
            expect(acts[0]).toMatchObject({
                action: "tag_removed",
                actorId: u.id,
            });
            expect((acts[0].context as { tag_id?: string }).tag_id).toBe(
                tag.id,
            );

            expect((await getUpdatedAt(t.id))!.getTime()).toBeGreaterThan(
                PAST.getTime(),
            );
        });

        it("fires NO notification", async () => {
            const { u, t, tag } = await seedTaggedTask();
            const client = await makeLoggedInClient(u);

            const before = await countNotifications();
            await client.delete(tagPath(t.id, tag.id));
            expect(await countNotifications()).toBe(before);
        });

        it("carries an X-Request-Id header on the 204", async () => {
            const { u, t, tag } = await seedTaggedTask();
            const client = await makeLoggedInClient(u);

            const res = await client.delete(tagPath(t.id, tag.id));
            expect(res.get("X-Request-Id")).toMatch(/^req_/);
        });
    });

    describe("Idempotency", () => {
        it("removing a tag that is not applied is a 204 no-op (no activity, no bump)", async () => {
            const u = await makeUser({ role: "member" });
            const t = await makeTask({
                workspaceId: u.workspaceId,
                createdBy: u.id,
            });
            const tag = await makeTag({ workspaceId: u.workspaceId }); // exists but not applied
            await setUpdatedAtPast(t.id);
            const client = await makeLoggedInClient(u);

            const res = await client.delete(tagPath(t.id, tag.id));

            expect(res.status).toBe(204);
            expect(await getActivity(t.id)).toHaveLength(0);
            expect((await getUpdatedAt(t.id))!.getTime()).toBe(PAST.getTime());
        });

        it("removing a nonexistent/foreign tagId is a 204 no-op (never an oracle)", async () => {
            const u = await makeUser({ role: "member" });
            const t = await makeTask({
                workspaceId: u.workspaceId,
                createdBy: u.id,
            });
            const client = await makeLoggedInClient(u);

            const res = await client.delete(tagPath(t.id, fakeId("tag")));
            expect(res.status).toBe(204);
        });

        it("a second delete of the same tag is a 204 no-op (one activity row total)", async () => {
            const { u, t, tag } = await seedTaggedTask();
            const client = await makeLoggedInClient(u);

            const r1 = await client.delete(tagPath(t.id, tag.id));
            const r2 = await client.delete(tagPath(t.id, tag.id));
            expect(r1.status).toBe(204);
            expect(r2.status).toBe(204);
            expect(await getActivity(t.id)).toHaveLength(1);
        });
    });

    describe("Validation", () => {
        it("returns 422 for a task id longer than 64 chars", async () => {
            const u = await makeUser({ role: "member" });
            const client = await makeLoggedInClient(u);
            const res = await client.delete(tagPath("x".repeat(65), "tag-1"));
            expect(res.status).toBe(422);
            expect(res.body.error.code).toBe("validation.failed");
        });

        it("returns 422 for a tagId longer than 64 chars", async () => {
            const u = await makeUser({ role: "member" });
            const t = await makeTask({
                workspaceId: u.workspaceId,
                createdBy: u.id,
            });
            const client = await makeLoggedInClient(u);
            const res = await client.delete(tagPath(t.id, "x".repeat(65)));
            expect(res.status).toBe(422);
        });
    });

    describe("Authentication", () => {
        it("returns 401 auth.missing_token without a token", async () => {
            const http = await oneOff();
            const res = await http.delete(tagPath("t-x", "tag-x"));
            expect(res.status).toBe(401);
            expect(res.body.error.code).toBe("auth.missing_token");
        });

        it("returns 401 auth.expired_token for an expired access token", async () => {
            const u = await makeUser({ role: "member" });
            const expired = signAccess(u, Config.ACCESS_TOKEN_SECRET!, {
                algorithm: "HS256",
                expiresIn: -10,
            });
            const http = await oneOff();
            const res = await http
                .delete(tagPath("t-x", "tag-x"))
                .set("Authorization", `Bearer ${expired}`);
            expect(res.status).toBe(401);
            expect(res.body.error.code).toBe("auth.expired_token");
        });
    });

    describe("Authorization (task.edit — every internal role holds it)", () => {
        for (const role of ["owner", "admin", "member"] as const) {
            it(`allows a ${role} to remove a tag (204)`, async () => {
                const { u, t, tag } = await seedTaggedTask(role);
                const client = await makeLoggedInClient(u);

                const res = await client.delete(tagPath(t.id, tag.id));
                expect(res.status).toBe(204);
            });
        }

        // F34 (ISS-095): same gate as applying one — see tags.add.test.ts.
        it("REFUSES a guest (403) — tagging rides task.edit now", async () => {
            const { u, t, tag } = await seedTaggedTask("guest");
            const client = await makeLoggedInClient(u);

            const res = await client.delete(tagPath(t.id, tag.id));
            expect(res.status).toBe(403);
        });
    });

    describe("Resource lifecycle", () => {
        it("returns 404 task.not_found for an absent task", async () => {
            const u = await makeUser({ role: "member" });
            const client = await makeLoggedInClient(u);

            const res = await client.delete(
                tagPath(fakeId("t"), fakeId("tag")),
            );
            expect(res.status).toBe(404);
            expect(res.body.error.code).toBe("task.not_found");
        });

        it("returns 409 task.archived for an archived task", async () => {
            const u = await makeUser({ role: "member" });
            const t = await makeTask({
                workspaceId: u.workspaceId,
                createdBy: u.id,
                archivedAt: new Date(),
            });
            const tag = await makeTag({ workspaceId: u.workspaceId });
            await seedTaskTag(t.id, tag.id);
            const client = await makeLoggedInClient(u);

            const res = await client.delete(tagPath(t.id, tag.id));
            expect(res.status).toBe(409);
            expect(res.body.error.code).toBe("task.archived");
        });
    });

    describe("Tenant isolation", () => {
        it("returns 404 when the task is in another workspace and leaves the tag intact", async () => {
            const ua = await makeUser({ role: "member" });
            const ub = await makeUser({ role: "member" });
            const aTask = await makeTask({
                workspaceId: ua.workspaceId,
                createdBy: ua.id,
            });
            const aTag = await makeTag({ workspaceId: ua.workspaceId });
            await seedTaskTag(aTask.id, aTag.id);

            const clientB = await makeLoggedInClient(ub);
            const res = await clientB.delete(tagPath(aTask.id, aTag.id));

            expect(res.status).toBe(404);
            expect(res.body.error.code).toBe("task.not_found");
            expect(await getTags(aTask.id)).toContain(aTag.id);
        });
    });

    describe("Concurrency", () => {
        it("10 parallel deletes of the same tag write exactly one activity row", async () => {
            const { u, t, tag } = await seedTaggedTask();
            const client = await makeLoggedInClient(u);

            const results = await Promise.all(
                Array.from({ length: 10 }, () =>
                    client.delete(tagPath(t.id, tag.id)),
                ),
            );

            for (const r of results) expect(r.status).toBe(204);
            expect(await getActivity(t.id)).toHaveLength(1);
            expect(await getTags(t.id)).not.toContain(tag.id);
        });
    });
});
