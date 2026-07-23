import { eq } from "drizzle-orm";
import { getDb } from "../../src/db/client";
import { tasks } from "../../src/db/schema";
import { oneOff } from "../test-utils/app";
import { makeLoggedInClient, makeUser } from "../test-utils/factories";
import {
    makeDeptList,
    makeDoneTask,
    makeSpaceWithHead,
} from "./helpers";
import { fakeId } from "../../src/utils";

/**
 * Dept Review V1 — P10: `GET /api/v1/tasks/:id/reviews` (A-5).
 *
 * History newest-first with hydrated reviewers; readable by owner/admin, the
 * space's head, and the task's ASSIGNEES (D-5); everyone else 403
 * `review.forbidden`. Archived tasks stay readable (history is history).
 */

const reviewsPath = (idOrKey: string) => `/api/v1/tasks/${idOrKey}/reviews`;
const reviewPath = (idOrKey: string) => `/api/v1/tasks/${idOrKey}/review`;

const ROW_KEYS = [
    "id",
    "task_id",
    "space_id",
    "status",
    "note",
    "reviewer_id",
    "created_at",
    "reviewer",
].sort();

/** Owner + head + assignee + a done task, with two reviews (approve → flag). */
const seed = async (opts: { assigneeRole?: "member" | "guest" } = {}) => {
    const owner = await makeUser({ role: "owner" });
    const head = await makeUser({
        workspaceId: owner.workspaceId,
        role: "member",
    });
    const assignee = await makeUser({
        workspaceId: owner.workspaceId,
        role: opts.assigneeRole ?? "member",
    });
    const sp = await makeSpaceWithHead({
        workspaceId: owner.workspaceId,
        headUserId: head.id,
        createdBy: owner.id,
    });
    const dl = await makeDeptList({
        workspaceId: owner.workspaceId,
        spaceId: sp.id,
        createdBy: owner.id,
    });
    const task = await makeDoneTask({
        workspaceId: owner.workspaceId,
        listId: dl.listId,
        doneStatusId: dl.doneStatusId,
        assigneeIds: [assignee.id],
        createdBy: owner.id,
    });
    const headClient = await makeLoggedInClient({ ...head, role: "member" });
    await headClient
        .post(reviewPath(task.id))
        .send({ status: "approved", note: "first pass ok" });
    await headClient
        .post(reviewPath(task.id))
        .send({ status: "flagged", note: "totals mismatch" });
    return { owner, head, assignee, sp, dl, task, headClient };
};

describe("GET /api/v1/tasks/:id/reviews (Dept Review V1)", () => {
    describe("Happy path", () => {
        it("head reads the history newest-first with hydrated reviewers", async () => {
            const { head, sp, task, headClient } = await seed();

            const res = await headClient.get(reviewsPath(task.id));

            expect(res.status).toBe(200);
            expect(res.body).toHaveProperty("data");
            expect(res.body.data).toHaveLength(2);
            expect(Object.keys(res.body.data[0]).sort()).toEqual(ROW_KEYS);

            // Newest first: the flag came second.
            expect(res.body.data[0]).toMatchObject({
                task_id: task.id,
                space_id: sp.id,
                status: "flagged",
                note: "totals mismatch",
                reviewer_id: head.id,
            });
            expect(res.body.data[1].status).toBe("approved");

            const reviewer = res.body.data[0].reviewer;
            expect(reviewer).toMatchObject({ id: head.id, role: "member" });
            expect(reviewer).not.toHaveProperty("password_hash");
        });

        it("owner and admin read it; a task with no reviews reads {data: []}", async () => {
            const { owner, dl } = await seed();
            const bare = await makeDoneTask({
                workspaceId: owner.workspaceId,
                listId: dl.listId,
                doneStatusId: dl.doneStatusId,
                createdBy: owner.id,
            });
            const ownerClient = await makeLoggedInClient({
                ...owner,
                role: "owner",
            });
            const admin = await makeUser({
                workspaceId: owner.workspaceId,
                role: "admin",
            });
            const adminClient = await makeLoggedInClient({
                ...admin,
                role: "admin",
            });

            const a = await ownerClient.get(reviewsPath(bare.id));
            expect(a.status).toBe(200);
            expect(a.body.data).toEqual([]);

            const b = await adminClient.get(reviewsPath(bare.id));
            expect(b.status).toBe(200);
        });

        it("the task's ASSIGNEE reads it — including a guest assignee (D-5 transparency)", async () => {
            const { assignee, task } = await seed({ assigneeRole: "guest" });
            const client = await makeLoggedInClient({
                ...assignee,
                role: "guest",
            });

            const res = await client.get(reviewsPath(task.id));

            expect(res.status).toBe(200);
            expect(res.body.data).toHaveLength(2);
            expect(res.body.data[0].note).toBe("totals mismatch");
        });

        it("custom_id addressing resolves", async () => {
            const { task, headClient } = await seed();
            await getDb()
                .update(tasks)
                .set({ customId: "HIST-9" })
                .where(eq(tasks.id, task.id));

            const res = await headClient.get(reviewsPath("HIST-9"));
            expect(res.status).toBe(200);
            expect(res.body.data).toHaveLength(2);
        });

        it("an archived task's history stays readable (history is history)", async () => {
            const { task, headClient } = await seed();
            await getDb()
                .update(tasks)
                .set({ archivedAt: new Date("2026-01-02T03:04:05.000Z") })
                .where(eq(tasks.id, task.id));

            const res = await headClient.get(reviewsPath(task.id));
            expect(res.status).toBe(200);
            expect(res.body.data).toHaveLength(2);
        });
    });

    describe("403 review.forbidden", () => {
        it("a plain member (not head, not assignee) cannot read", async () => {
            const { owner, task } = await seed();
            const outsider = await makeUser({
                workspaceId: owner.workspaceId,
                role: "member",
            });
            const client = await makeLoggedInClient({
                ...outsider,
                role: "member",
            });

            const res = await client.get(reviewsPath(task.id));
            expect(res.status).toBe(403);
            expect(res.body.error.code).toBe("review.forbidden");
        });

        it("a non-assignee guest and another space's head cannot read", async () => {
            const { owner, task } = await seed();
            const guest = await makeUser({
                workspaceId: owner.workspaceId,
                role: "guest",
            });
            const otherHead = await makeUser({
                workspaceId: owner.workspaceId,
                role: "member",
            });
            await makeSpaceWithHead({
                workspaceId: owner.workspaceId,
                headUserId: otherHead.id,
                createdBy: owner.id,
            });

            for (const u of [guest, otherHead]) {
                const client = await makeLoggedInClient({ ...u, role: u.role });
                const res = await client.get(reviewsPath(task.id));
                expect(res.status).toBe(403);
                expect(res.body.error.code).toBe("review.forbidden");
            }
        });
    });

    describe("404 / 401", () => {
        it("404 task.not_found for unknown and cross-workspace ids", async () => {
            const { headClient } = await seed();
            const foreign = await seed();

            const unknown = await headClient.get(reviewsPath(fakeId("t")));
            expect(unknown.status).toBe(404);
            expect(unknown.body.error.code).toBe("task.not_found");

            const cross = await headClient.get(reviewsPath(foreign.task.id));
            expect(cross.status).toBe(404);
        });

        it("401 without a token", async () => {
            const http = await oneOff();
            const res = await http.get(reviewsPath("t-anything"));
            expect(res.status).toBe(401);
            expect(res.body.error.code).toBe("auth.missing_token");
        });

        it("422 for an over-long id", async () => {
            const { headClient } = await seed();
            const res = await headClient.get(reviewsPath("x".repeat(65)));
            expect(res.status).toBe(422);
            expect(res.body.error.code).toBe("validation.failed");
        });
    });
});
