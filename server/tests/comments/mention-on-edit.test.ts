import { and, eq } from "drizzle-orm";
import {
    makeLoggedInClient,
    makeTask,
    makeUser,
    makeWorkspace,
} from "../test-utils/factories";
import { getDb } from "../../src/db/client";
import { notifications, taskActivity } from "../../src/db/schema";

/**
 * `PATCH /api/v1/comments/:id` — the mention DIFF (mention feature, 2026-08-19).
 *
 * The rule the service states: people @mentioned by the EDIT — added since the
 * original text — get the full mention treatment, and diffing against the old
 * body means nobody is pinged twice for one comment. That rule was implemented
 * and never tested. It is the half of the feature a person actually notices
 * when it breaks: re-pinging on every typo fix is spam, and not pinging at all
 * makes editing-to-mention silently useless.
 *
 * The create side is covered in `comments.test.ts`; this file only exercises
 * what the edit adds.
 */

jest.setTimeout(30_000);

const onePath = (id: string) => `/api/v1/comments/${id}`;
const listPath = (taskId: string) => `/api/v1/tasks/${taskId}/comments`;

/** An author with a client, a task, and two colleagues to mention. */
const scene = async () => {
    const ws = await makeWorkspace();
    const author = await makeUser({
        workspaceId: ws.id,
        role: "member",
        email: "author@example.test",
    });
    const alice = await makeUser({
        workspaceId: ws.id,
        email: "alice@example.test",
    });
    const bob = await makeUser({
        workspaceId: ws.id,
        email: "bob@example.test",
    });
    const client = await makeLoggedInClient(author);
    const task = await makeTask({ workspaceId: ws.id, createdBy: author.id });
    return { ws, author, alice, bob, client, task };
};

const mentionsFor = async (userId: string) =>
    getDb()
        .select()
        .from(notifications)
        .where(
            and(
                eq(notifications.userId, userId),
                eq(notifications.type, "mentioned"),
            ),
        );

describe("PATCH /api/v1/comments/:id — mention diff", () => {
    describe("Newly added mentions", () => {
        it("notifies someone the EDIT mentioned who was not mentioned before", async () => {
            const s = await scene();
            const created = await s.client
                .post(listPath(s.task.id))
                .send({ body: "starting on this" });
            expect(created.status).toBe(201);
            expect(await mentionsFor(s.alice.id)).toHaveLength(0);

            const res = await s.client
                .patch(onePath(created.body.id))
                .send({ body: "starting on this — @alice can you review?" });

            expect(res.status).toBe(200);
            const notifs = await mentionsFor(s.alice.id);
            expect(notifs).toHaveLength(1);
            // Same shape the create path produces: the entity is the TASK, so
            // the inbox deep-link opens something that exists.
            expect(notifs[0].entityType).toBe("task");
            expect(notifs[0].entityId).toBe(s.task.id);
            expect(notifs[0].actorId).toBe(s.author.id);
        });

        it("notifies every newly added mention, not just the first", async () => {
            const s = await scene();
            const created = await s.client
                .post(listPath(s.task.id))
                .send({ body: "draft" });

            await s.client
                .patch(onePath(created.body.id))
                .send({ body: "draft — @alice and @bob please look" });

            expect(await mentionsFor(s.alice.id)).toHaveLength(1);
            expect(await mentionsFor(s.bob.id)).toHaveLength(1);
        });
    });

    describe("Mentions that were already there", () => {
        it("does NOT re-notify someone the original body already mentioned", async () => {
            const s = await scene();
            const created = await s.client
                .post(listPath(s.task.id))
                .send({ body: "@alice starting on this" });
            expect(await mentionsFor(s.alice.id)).toHaveLength(1);

            // A typo fix that keeps the mention. This is the one that would
            // spam somebody if the diff were dropped.
            const res = await s.client
                .patch(onePath(created.body.id))
                .send({ body: "@alice starting on this today" });

            expect(res.status).toBe(200);
            expect(await mentionsFor(s.alice.id)).toHaveLength(1);
        });

        it("notifies only the ADDED person when an edit keeps one and adds another", async () => {
            const s = await scene();
            const created = await s.client
                .post(listPath(s.task.id))
                .send({ body: "@alice starting" });

            await s.client
                .patch(onePath(created.body.id))
                .send({ body: "@alice starting, @bob joining" });

            expect(await mentionsFor(s.alice.id)).toHaveLength(1); // not 2
            expect(await mentionsFor(s.bob.id)).toHaveLength(1);
        });
    });

    describe("Mentions the edit removes", () => {
        it("notifies nobody and leaves the earlier notification standing", async () => {
            const s = await scene();
            const created = await s.client
                .post(listPath(s.task.id))
                .send({ body: "@alice can you look" });
            expect(await mentionsFor(s.alice.id)).toHaveLength(1);

            const res = await s.client
                .patch(onePath(created.body.id))
                .send({ body: "never mind, handled it" });

            expect(res.status).toBe(200);
            // The ping already happened and the person may have acted on it;
            // an edit is not a retraction.
            expect(await mentionsFor(s.alice.id)).toHaveLength(1);
            expect(await mentionsFor(s.bob.id)).toHaveLength(0);
        });
    });

    describe("Self-mention", () => {
        it("does not notify the author who @mentions themselves in an edit", async () => {
            const s = await scene();
            const created = await s.client
                .post(listPath(s.task.id))
                .send({ body: "draft" });

            await s.client
                .patch(onePath(created.body.id))
                .send({ body: "draft — note to @author" });

            expect(await mentionsFor(s.author.id)).toHaveLength(0);
        });
    });

    describe("Side effects that must happen either way", () => {
        it("records comment_updated whether or not the edit added a mention", async () => {
            const s = await scene();
            const plain = await s.client
                .post(listPath(s.task.id))
                .send({ body: "one" });
            const mentioning = await s.client
                .post(listPath(s.task.id))
                .send({ body: "two" });

            await s.client
                .patch(onePath(plain.body.id))
                .send({ body: "one edited" });
            await s.client
                .patch(onePath(mentioning.body.id))
                .send({ body: "two edited @alice" });

            const updates = await getDb()
                .select()
                .from(taskActivity)
                .where(
                    and(
                        eq(taskActivity.taskId, s.task.id),
                        eq(taskActivity.action, "comment_updated"),
                    ),
                );
            expect(updates).toHaveLength(2);
        });

        it("an unknown @handle is not an error — the edit still succeeds", async () => {
            const s = await scene();
            const created = await s.client
                .post(listPath(s.task.id))
                .send({ body: "draft" });

            const res = await s.client
                .patch(onePath(created.body.id))
                .send({ body: "draft — @nobody-by-that-name please look" });

            expect(res.status).toBe(200);
            expect(res.body.body).toContain("@nobody-by-that-name");
        });
    });
});
