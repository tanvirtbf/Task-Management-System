import { eq } from "drizzle-orm";
import { oneOff } from "../test-utils/app";
import {
    makeWorkspace,
    makeUser,
    makeLoggedInClient,
    makeTask,
} from "../test-utils/factories";
import { getDb } from "../../src/db/client";
import { comments, notifications, taskActivity, tasks } from "../../src/db/schema";

/**
 * Tests for §14 Comments — `GET/POST /tasks/:id/comments`, `PATCH/DELETE
 * /comments/:id`. These endpoints shipped WITHOUT any backend tests; this is the
 * new Layer-C coverage. Real DB + supertest via `makeLoggedInClient`;
 * `setup-each-collab.ts` truncates per test.
 */

jest.setTimeout(30_000);

const listPath = (taskId: string) => `/api/v1/tasks/${taskId}/comments`;
const onePath = (id: string) => `/api/v1/comments/${id}`;

const seed = async (role: "owner" | "admin" | "member" | "guest" = "member") => {
    const ws = await makeWorkspace();
    const user = await makeUser({ workspaceId: ws.id, role });
    const client = await makeLoggedInClient(user);
    const task = await makeTask({ workspaceId: ws.id, createdBy: user.id });
    return { ws, user, client, task };
};

const post = (client: Awaited<ReturnType<typeof makeLoggedInClient>>, taskId: string, body: object) =>
    client.post(listPath(taskId)).send(body);

const db = () => getDb();

describe("§14 Comments", () => {
    // ─── GET list ───────────────────────────────────────────────────────────
    describe("GET /tasks/:id/comments", () => {
        it("returns an empty array for a task with no comments", async () => {
            const { client, task } = await seed();
            const res = await client.get(listPath(task.id));
            expect(res.status).toBe(200);
            expect(res.body).toEqual([]);
        });

        it("nests replies under their top-level comment (1-level tree)", async () => {
            const { client, task } = await seed();
            const top = (await post(client, task.id, { body: "top" })).body;
            await post(client, task.id, { body: "second top" });
            await post(client, task.id, {
                body: "a reply",
                parent_comment_id: top.id,
            });

            const res = await client.get(listPath(task.id));
            expect(res.status).toBe(200);
            expect(res.body).toHaveLength(2); // two top-level
            const withReply = res.body.find((c: { id: string }) => c.id === top.id);
            expect(withReply.replies).toHaveLength(1);
            expect(withReply.replies[0].body).toBe("a reply");
        });

        it("returns 404 task.not_found for a task in another workspace", async () => {
            const { client } = await seed();
            const ws2 = await makeWorkspace();
            const u2 = await makeUser({ workspaceId: ws2.id });
            const foreign = await makeTask({ workspaceId: ws2.id, createdBy: u2.id });
            const res = await client.get(listPath(foreign.id));
            expect(res.status).toBe(404);
            expect(res.body.error.code).toBe("task.not_found");
        });
    });

    // ─── POST create ────────────────────────────────────────────────────────
    describe("POST /tasks/:id/comments", () => {
        it("creates a top-level comment (201) with the wire shape", async () => {
            const { client, task, user } = await seed();
            const res = await post(client, task.id, { body: "hello world" });
            expect(res.status).toBe(201);
            expect(res.body).toMatchObject({
                task_id: task.id,
                parent_comment_id: null,
                author_id: user.id,
                body: "hello world",
                edited_at: null,
                deleted_at: null,
            });
            expect(typeof res.body.id).toBe("string");
            expect(typeof res.body.created_at).toBe("string");
        });

        it("records a comment_posted task_activity row", async () => {
            const { client, task } = await seed();
            const c = (await post(client, task.id, { body: "x" })).body;
            const acts = await db()
                .select()
                .from(taskActivity)
                .where(eq(taskActivity.taskId, task.id));
            expect(acts.some((a) => a.action === "comment_posted")).toBe(true);
            expect(acts.length).toBeGreaterThanOrEqual(1);
            expect(c.id).toBeDefined();
        });

        it("creates a 1-level reply (201)", async () => {
            const { client, task } = await seed();
            const top = (await post(client, task.id, { body: "top" })).body;
            const res = await post(client, task.id, {
                body: "reply",
                parent_comment_id: top.id,
            });
            expect(res.status).toBe(201);
            expect(res.body.parent_comment_id).toBe(top.id);
        });

        it("rejects a reply to a reply (422 comment.reply_to_reply)", async () => {
            const { client, task } = await seed();
            const top = (await post(client, task.id, { body: "top" })).body;
            const reply = (
                await post(client, task.id, {
                    body: "reply",
                    parent_comment_id: top.id,
                })
            ).body;
            const res = await post(client, task.id, {
                body: "nested",
                parent_comment_id: reply.id,
            });
            expect(res.status).toBe(422);
            expect(res.body.error.code).toBe("comment.reply_to_reply");
        });

        it("rejects a parent comment on a different task (422 comment.parent_not_found)", async () => {
            const { ws, user, client, task } = await seed();
            const task2 = await makeTask({ workspaceId: ws.id, createdBy: user.id });
            const other = (await post(client, task2.id, { body: "elsewhere" })).body;
            const res = await post(client, task.id, {
                body: "reply",
                parent_comment_id: other.id,
            });
            expect(res.status).toBe(422);
            expect(res.body.error.code).toBe("comment.parent_not_found");
        });

        it("returns 404 task.not_found for a task in another workspace", async () => {
            const { client } = await seed();
            const ws2 = await makeWorkspace();
            const u2 = await makeUser({ workspaceId: ws2.id });
            const foreign = await makeTask({ workspaceId: ws2.id, createdBy: u2.id });
            const res = await post(client, foreign.id, { body: "x" });
            expect(res.status).toBe(404);
            expect(res.body.error.code).toBe("task.not_found");
        });

        it("rejects an empty body (422)", async () => {
            const { client, task } = await seed();
            const res = await post(client, task.id, { body: "   " });
            expect(res.status).toBe(422);
            expect(res.body.error.code).toBe("validation.failed");
        });

        it("notifies a mentioned active member (@handle → mentioned notification)", async () => {
            const ws = await makeWorkspace();
            const author = await makeUser({ workspaceId: ws.id, role: "member" });
            const alice = await makeUser({
                workspaceId: ws.id,
                email: "alice@example.test",
            });
            const client = await makeLoggedInClient(author);
            const task = await makeTask({ workspaceId: ws.id, createdBy: author.id });

            const res = await post(client, task.id, { body: "hey @alice look" });
            expect(res.status).toBe(201);

            const notifs = await db()
                .select()
                .from(notifications)
                .where(eq(notifications.userId, alice.id));
            expect(notifs).toHaveLength(1);
            expect(notifs[0].type).toBe("mentioned");
        });

        it("does not notify the author when they @mention themselves", async () => {
            const ws = await makeWorkspace();
            const author = await makeUser({
                workspaceId: ws.id,
                email: "self@example.test",
            });
            const client = await makeLoggedInClient(author);
            const task = await makeTask({ workspaceId: ws.id, createdBy: author.id });

            await post(client, task.id, { body: "note to @self" });
            const notifs = await db()
                .select()
                .from(notifications)
                .where(eq(notifications.userId, author.id));
            expect(notifs).toHaveLength(0);
        });

        it("logs comment_referenced activity on a #CUSTOM-ID-referenced task", async () => {
            const { ws, user, client, task } = await seed();
            const refTask = await makeTask({ workspaceId: ws.id, createdBy: user.id });
            await db()
                .update(tasks)
                .set({ customId: "REF-7" })
                .where(eq(tasks.id, refTask.id));

            await post(client, task.id, { body: "see #REF-7 for context" });

            const acts = await db()
                .select()
                .from(taskActivity)
                .where(eq(taskActivity.taskId, refTask.id));
            expect(acts.some((a) => a.action === "comment_referenced")).toBe(true);
        });
    });

    // ─── PATCH update ─────────────────────────────────────────────────────────
    describe("PATCH /comments/:id", () => {
        it("lets the author edit within the 15-minute window (200, edited_at set)", async () => {
            const { client, task } = await seed();
            const c = (await post(client, task.id, { body: "original" })).body;
            const res = await client.patch(onePath(c.id)).send({ body: "edited" });
            expect(res.status).toBe(200);
            expect(res.body.body).toBe("edited");
            expect(res.body.edited_at).not.toBeNull();
        });

        it("forbids a non-author from editing (403 comment.not_author)", async () => {
            const { ws, client, task } = await seed();
            const c = (await post(client, task.id, { body: "mine" })).body;
            const other = await makeUser({ workspaceId: ws.id, role: "admin" });
            const otherClient = await makeLoggedInClient(other);
            const res = await otherClient.patch(onePath(c.id)).send({ body: "hijack" });
            expect(res.status).toBe(403);
            expect(res.body.error.code).toBe("comment.not_author");
        });

        it("forbids editing after the 15-minute window (403 comment.edit_window_expired)", async () => {
            const { client, task } = await seed();
            const c = (await post(client, task.id, { body: "old" })).body;
            // Backdate the comment past the 15-min window.
            await db()
                .update(comments)
                .set({ createdAt: new Date(Date.now() - 16 * 60 * 1000) })
                .where(eq(comments.id, c.id));
            const res = await client.patch(onePath(c.id)).send({ body: "too late" });
            expect(res.status).toBe(403);
            expect(res.body.error.code).toBe("comment.edit_window_expired");
        });

        it("returns 404 for a non-existent comment", async () => {
            const { client } = await seed();
            const res = await client.patch(onePath("c-nope")).send({ body: "x" });
            expect(res.status).toBe(404);
            expect(res.body.error.code).toBe("comment.not_found");
        });
    });

    // ─── DELETE ───────────────────────────────────────────────────────────────
    describe("DELETE /comments/:id", () => {
        it("lets the author soft-delete (204); the thread keeps a [deleted] tombstone", async () => {
            const { client, task } = await seed();
            const c = (await post(client, task.id, { body: "secret" })).body;
            const res = await client.delete(onePath(c.id));
            expect(res.status).toBe(204);

            const list = await client.get(listPath(task.id));
            const row = list.body.find((x: { id: string }) => x.id === c.id);
            expect(row).toBeDefined();
            expect(row.body).toBe("[deleted]");
            expect(row.deleted_at).not.toBeNull();
        });

        it("lets an admin delete another member's comment (204)", async () => {
            const { ws, client, task } = await seed();
            const c = (await post(client, task.id, { body: "by member" })).body;
            const admin = await makeUser({ workspaceId: ws.id, role: "admin" });
            const adminClient = await makeLoggedInClient(admin);
            const res = await adminClient.delete(onePath(c.id));
            expect(res.status).toBe(204);
        });

        it("forbids a non-author member from deleting (403 comment.forbidden_delete)", async () => {
            const { ws, client, task } = await seed();
            const c = (await post(client, task.id, { body: "by member" })).body;
            const other = await makeUser({ workspaceId: ws.id, role: "member" });
            const otherClient = await makeLoggedInClient(other);
            const res = await otherClient.delete(onePath(c.id));
            expect(res.status).toBe(403);
            expect(res.body.error.code).toBe("comment.forbidden_delete");
        });

        it("returns 404 when deleting an already-deleted comment (tombstone is not live)", async () => {
            const { client, task } = await seed();
            const c = (await post(client, task.id, { body: "x" })).body;
            await client.delete(onePath(c.id));
            const res = await client.delete(onePath(c.id));
            expect(res.status).toBe(404);
            expect(res.body.error.code).toBe("comment.not_found");
        });

        it("requires authentication (401)", async () => {
            const { task, client } = await seed();
            const c = (await post(client, task.id, { body: "x" })).body;
            const res = await (await oneOff()).delete(onePath(c.id));
            expect(res.status).toBe(401);
        });
    });
});
