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
 * Tests for `POST /api/v1/tasks/:id/tags` (§11 #5 — newly built).
 *
 * Shared-state membership write (mirrors addAssignees, minus the notification):
 * validates each tag belongs to the workspace (422 task.invalid_tag), then in
 * one txn locks the task, diffs against the current set, writes new rows + a
 * `tag_added` activity row, bumps the ETag. Idempotent. Runs on the isolated
 * `tms_membership_test` DB. ⚠️ ONE FILE PER JEST PROCESS.
 */
jest.setTimeout(30000);

const PAST = new Date("2020-01-01T00:00:00.000Z");
const tagsPath = (taskId: string) => `/api/v1/tasks/${taskId}/tags`;

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

// ════════════════════════════════════════════════════════════════════════════
describe("POST /api/v1/tasks/:id/tags", () => {
    describe("Happy path", () => {
        it("applies a single tag_id, returns 204, writes a tag_added activity row, bumps updated_at", async () => {
            const u = await makeUser({ role: "member" });
            const t = await makeTask({
                workspaceId: u.workspaceId,
                createdBy: u.id,
            });
            const tag = await makeTag({ workspaceId: u.workspaceId });
            await setUpdatedAtPast(t.id);
            const client = await makeLoggedInClient(u);

            const res = await client
                .post(tagsPath(t.id))
                .send({ tag_id: tag.id });

            expect(res.status).toBe(204);
            expect(await getTags(t.id)).toEqual([tag.id]);

            const acts = await getActivity(t.id);
            expect(acts).toHaveLength(1);
            expect(acts[0]).toMatchObject({
                action: "tag_added",
                actorId: u.id,
            });
            expect((acts[0].context as { tag_id?: string }).tag_id).toBe(
                tag.id,
            );

            expect((await getUpdatedAt(t.id))!.getTime()).toBeGreaterThan(
                PAST.getTime(),
            );
        });

        it("applies a bulk tag_ids array", async () => {
            const u = await makeUser({ role: "member" });
            const t = await makeTask({
                workspaceId: u.workspaceId,
                createdBy: u.id,
            });
            const a = await makeTag({ workspaceId: u.workspaceId });
            const b = await makeTag({ workspaceId: u.workspaceId });
            const client = await makeLoggedInClient(u);

            const res = await client
                .post(tagsPath(t.id))
                .send({ tag_ids: [a.id, b.id] });

            expect(res.status).toBe(204);
            expect((await getTags(t.id)).sort()).toEqual([a.id, b.id].sort());
            expect(await getActivity(t.id)).toHaveLength(2);
        });

        it("fires NO notification (there is no 'tagged' type)", async () => {
            const u = await makeUser({ role: "member" });
            const t = await makeTask({
                workspaceId: u.workspaceId,
                createdBy: u.id,
            });
            const tag = await makeTag({ workspaceId: u.workspaceId });
            const client = await makeLoggedInClient(u);

            const before = await countNotifications();
            await client.post(tagsPath(t.id)).send({ tag_id: tag.id });
            expect(await countNotifications()).toBe(before);
        });

        it("carries an X-Request-Id header on the 204", async () => {
            const u = await makeUser({ role: "member" });
            const t = await makeTask({
                workspaceId: u.workspaceId,
                createdBy: u.id,
            });
            const tag = await makeTag({ workspaceId: u.workspaceId });
            const client = await makeLoggedInClient(u);

            const res = await client
                .post(tagsPath(t.id))
                .send({ tag_id: tag.id });
            expect(res.get("X-Request-Id")).toMatch(/^req_/);
        });
    });

    describe("Idempotency", () => {
        it("re-applying an existing tag is a 204 no-op (no extra row/activity, no bump)", async () => {
            const u = await makeUser({ role: "member" });
            const t = await makeTask({
                workspaceId: u.workspaceId,
                createdBy: u.id,
            });
            const tag = await makeTag({ workspaceId: u.workspaceId });
            const client = await makeLoggedInClient(u);

            await client.post(tagsPath(t.id)).send({ tag_id: tag.id });
            await setUpdatedAtPast(t.id);
            const res = await client
                .post(tagsPath(t.id))
                .send({ tag_id: tag.id });

            expect(res.status).toBe(204);
            expect(await getTags(t.id)).toEqual([tag.id]);
            expect(await getActivity(t.id)).toHaveLength(1);
            expect((await getUpdatedAt(t.id))!.getTime()).toBe(PAST.getTime());
        });

        it("a mixed new+existing batch only writes activity for the new tag", async () => {
            const u = await makeUser({ role: "member" });
            const t = await makeTask({
                workspaceId: u.workspaceId,
                createdBy: u.id,
            });
            const a = await makeTag({ workspaceId: u.workspaceId });
            const b = await makeTag({ workspaceId: u.workspaceId });
            const client = await makeLoggedInClient(u);

            await client.post(tagsPath(t.id)).send({ tag_id: a.id });
            await client.post(tagsPath(t.id)).send({ tag_ids: [a.id, b.id] });

            expect((await getTags(t.id)).sort()).toEqual([a.id, b.id].sort());
            expect(await getActivity(t.id)).toHaveLength(2); // a then b, not a twice
        });
    });

    describe("Validation", () => {
        const expect422 = (res: {
            status: number;
            body: { error: { code: string } };
        }) => {
            expect(res.status).toBe(422);
            expect(res.body.error.code).toBe("validation.failed");
        };

        it("rejects an empty body (neither tag_id nor tag_ids)", async () => {
            const u = await makeUser({ role: "member" });
            const t = await makeTask({
                workspaceId: u.workspaceId,
                createdBy: u.id,
            });
            const client = await makeLoggedInClient(u);
            expect422(await client.post(tagsPath(t.id)).send({}));
        });

        it("rejects an empty tag_ids array", async () => {
            const u = await makeUser({ role: "member" });
            const t = await makeTask({
                workspaceId: u.workspaceId,
                createdBy: u.id,
            });
            const client = await makeLoggedInClient(u);
            expect422(await client.post(tagsPath(t.id)).send({ tag_ids: [] }));
        });

        it("rejects a non-string tag_ids element", async () => {
            const u = await makeUser({ role: "member" });
            const t = await makeTask({
                workspaceId: u.workspaceId,
                createdBy: u.id,
            });
            const client = await makeLoggedInClient(u);
            expect422(
                await client.post(tagsPath(t.id)).send({ tag_ids: [123] }),
            );
        });

        it("rejects more than 50 tag_ids", async () => {
            const u = await makeUser({ role: "member" });
            const t = await makeTask({
                workspaceId: u.workspaceId,
                createdBy: u.id,
            });
            const client = await makeLoggedInClient(u);
            const ids = Array.from({ length: 51 }, (_, i) => `tag-${i}`);
            expect422(await client.post(tagsPath(t.id)).send({ tag_ids: ids }));
        });

        it("rejects a tag id longer than 64 chars", async () => {
            const u = await makeUser({ role: "member" });
            const t = await makeTask({
                workspaceId: u.workspaceId,
                createdBy: u.id,
            });
            const client = await makeLoggedInClient(u);
            expect422(
                await client
                    .post(tagsPath(t.id))
                    .send({ tag_id: "x".repeat(65) }),
            );
        });

        it("rejects a task id longer than 64 chars", async () => {
            const u = await makeUser({ role: "member" });
            const tag = await makeTag({ workspaceId: u.workspaceId });
            const client = await makeLoggedInClient(u);
            expect422(
                await client
                    .post(tagsPath("x".repeat(65)))
                    .send({ tag_id: tag.id }),
            );
        });
    });

    describe("Authentication", () => {
        it("returns 401 auth.missing_token without a token", async () => {
            const http = await oneOff();
            const res = await http
                .post(tagsPath("t-x"))
                .send({ tag_id: "tag-x" });
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
                .post(tagsPath("t-x"))
                .set("Authorization", `Bearer ${expired}`)
                .send({ tag_id: "tag-x" });
            expect(res.status).toBe(401);
            expect(res.body.error.code).toBe("auth.expired_token");
        });
    });

    describe("Authorization (task.edit — every internal role holds it)", () => {
        for (const role of ["owner", "admin", "member"] as const) {
            it(`allows a ${role} to apply a tag (204)`, async () => {
                const u = await makeUser({ role });
                const t = await makeTask({
                    workspaceId: u.workspaceId,
                    createdBy: u.id,
                });
                const tag = await makeTag({ workspaceId: u.workspaceId });
                const client = await makeLoggedInClient(u);

                const res = await client
                    .post(tagsPath(t.id))
                    .send({ tag_id: tag.id });
                expect(res.status).toBe(204);
            });
        }

        // F34 (ISS-095): this loop used to include the guest at 204 — these
        // routes carried NO permission gate at all (tagging never had a
        // catalog key, so F7 had nothing to attach), and the spec pinned the
        // hole as intended behaviour. Gated on task.edit now: a guest
        // re-tagging every task in the workspace rewrote saved filters and
        // board groupings and bumped everyone's ETags.
        it("REFUSES a guest (403) — tagging rides task.edit now", async () => {
            const u = await makeUser({ role: "guest" });
            const t = await makeTask({
                workspaceId: u.workspaceId,
                createdBy: u.id,
            });
            const tag = await makeTag({ workspaceId: u.workspaceId });
            const client = await makeLoggedInClient(u);

            const res = await client
                .post(tagsPath(t.id))
                .send({ tag_id: tag.id });
            expect(res.status).toBe(403);
        });
    });

    describe("Resource lifecycle", () => {
        it("returns 404 task.not_found for an absent task", async () => {
            const u = await makeUser({ role: "member" });
            const tag = await makeTag({ workspaceId: u.workspaceId });
            const client = await makeLoggedInClient(u);

            const res = await client
                .post(tagsPath(fakeId("t")))
                .send({ tag_id: tag.id });
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
            const client = await makeLoggedInClient(u);

            const res = await client
                .post(tagsPath(t.id))
                .send({ tag_id: tag.id });
            expect(res.status).toBe(409);
            expect(res.body.error.code).toBe("task.archived");
        });
    });

    describe("Tenant isolation", () => {
        it("returns 404 when the task is in another workspace", async () => {
            const ua = await makeUser({ role: "member" });
            const ub = await makeUser({ role: "member" });
            const aTask = await makeTask({
                workspaceId: ua.workspaceId,
                createdBy: ua.id,
            });
            const bTag = await makeTag({ workspaceId: ub.workspaceId });

            const clientB = await makeLoggedInClient(ub);
            const res = await clientB
                .post(tagsPath(aTask.id))
                .send({ tag_id: bTag.id });

            expect(res.status).toBe(404);
            expect(res.body.error.code).toBe("task.not_found");
        });

        it("returns 422 task.invalid_tag for a tag from another workspace (no partial write)", async () => {
            const ua = await makeUser({ role: "member" });
            const ub = await makeUser({ role: "member" });
            const t = await makeTask({
                workspaceId: ua.workspaceId,
                createdBy: ua.id,
            });
            const foreignTag = await makeTag({ workspaceId: ub.workspaceId });
            const client = await makeLoggedInClient(ua);

            const res = await client
                .post(tagsPath(t.id))
                .send({ tag_id: foreignTag.id });

            expect(res.status).toBe(422);
            expect(res.body.error.code).toBe("task.invalid_tag");
            expect(await getTags(t.id)).toHaveLength(0);
        });

        it("returns 422 task.invalid_tag for a nonexistent tag, rejecting the whole mixed batch", async () => {
            const u = await makeUser({ role: "member" });
            const t = await makeTask({
                workspaceId: u.workspaceId,
                createdBy: u.id,
            });
            const good = await makeTag({ workspaceId: u.workspaceId });
            const client = await makeLoggedInClient(u);

            const res = await client
                .post(tagsPath(t.id))
                .send({ tag_ids: [good.id, fakeId("tag")] });

            expect(res.status).toBe(422);
            expect(res.body.error.code).toBe("task.invalid_tag");
            expect(res.body.error.details.length).toBeGreaterThan(0);
            // All-or-nothing: the valid tag was NOT applied.
            expect(await getTags(t.id)).toHaveLength(0);
        });
    });

    describe("Concurrency", () => {
        it("25 parallel identical applies write exactly one tag row + one activity row", async () => {
            const u = await makeUser({ role: "member" });
            const t = await makeTask({
                workspaceId: u.workspaceId,
                createdBy: u.id,
            });
            const tag = await makeTag({ workspaceId: u.workspaceId });
            const client = await makeLoggedInClient(u);

            const results = await Promise.all(
                Array.from({ length: 25 }, () =>
                    client.post(tagsPath(t.id)).send({ tag_id: tag.id }),
                ),
            );

            for (const r of results) expect(r.status).toBe(204);
            expect(await getTags(t.id)).toEqual([tag.id]);
            expect(await getActivity(t.id)).toHaveLength(1);
        });
    });

    describe("Boundary values", () => {
        it("merges tag_id + tag_ids and dedupes (within and across)", async () => {
            const u = await makeUser({ role: "member" });
            const t = await makeTask({
                workspaceId: u.workspaceId,
                createdBy: u.id,
            });
            const a = await makeTag({ workspaceId: u.workspaceId });
            const b = await makeTag({ workspaceId: u.workspaceId });
            const client = await makeLoggedInClient(u);

            const res = await client
                .post(tagsPath(t.id))
                .send({ tag_id: a.id, tag_ids: [a.id, b.id, b.id] });

            expect(res.status).toBe(204);
            expect((await getTags(t.id)).sort()).toEqual([a.id, b.id].sort());
            expect(await getActivity(t.id)).toHaveLength(2);
        });
    });
});
