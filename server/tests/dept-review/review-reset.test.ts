import { eq } from "drizzle-orm";
import { getDb } from "../../src/db/client";
import { tasks, taskReviews } from "../../src/db/schema";
import {
    makeLoggedInClient,
    makeStatus,
    makeUser,
} from "../test-utils/factories";
import {
    makeDeptList,
    makeDoneTask,
    makeSpaceWithHead,
} from "./helpers";

/**
 * Dept Review V1 — P9: the review-reset invariant.
 *
 * NO done→not-done transition may keep a review verdict. The three verified
 * bypass paths are each closed and tested here:
 *   1. single `PATCH /tasks/:id` status change (reset added),
 *   2. `POST /tasks/bulk` status change (reset added + its two pre-existing
 *      holes fixed: completed_at is now COALESCE-preserved on re-done, and
 *      archived targets are rejected unless the patch operates on
 *      `archived_at`),
 *   3. `PATCH /statuses/:id` re-grouping across the done boundary while tasks
 *      sit on the status (now 409 `status.in_use`).
 * Plus the reopen-vs-review RACE invariant deferred from P8.
 */

const db = () => getDb();

const taskPath = (id: string) => `/api/v1/tasks/${id}`;
const reviewPath = (id: string) => `/api/v1/tasks/${id}/review`;
const statusPath = (id: string) => `/api/v1/statuses/${id}`;

const fetchTask = async (taskId: string) => {
    const [row] = await db()
        .select({
            reviewStatus: tasks.reviewStatus,
            reviewedAt: tasks.reviewedAt,
            reviewedBy: tasks.reviewedBy,
            completedAt: tasks.completedAt,
        })
        .from(tasks)
        .where(eq(tasks.id, taskId))
        .limit(1);
    return row;
};

const countLedger = async (taskId: string) =>
    (
        await db()
            .select({ id: taskReviews.id })
            .from(taskReviews)
            .where(eq(taskReviews.taskId, taskId))
    ).length;

/** Owner + head + reviewed done-task, plus clients for both. */
const seed = async () => {
    const owner = await makeUser({ role: "owner" });
    const head = await makeUser({
        workspaceId: owner.workspaceId,
        role: "member",
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
        createdBy: owner.id,
    });
    const ownerClient = await makeLoggedInClient({ ...owner, role: "owner" });
    const headClient = await makeLoggedInClient({ ...head, role: "member" });
    return { owner, head, sp, dl, task, ownerClient, headClient };
};

describe("Review reset on done→not-done (Dept Review V1, P9)", () => {
    describe("Path 1 — single PATCH", () => {
        it("reopening a reviewed task clears the denorm trio; the ledger survives; re-completing does NOT restore the verdict", async () => {
            const { dl, task, ownerClient, headClient } = await seed();
            await headClient
                .post(reviewPath(task.id))
                .send({ status: "approved", note: "ok" });
            expect((await fetchTask(task.id)).reviewStatus).toBe("approved");

            const reopen = await ownerClient
                .patch(taskPath(task.id))
                .send({ status_id: dl.activeStatusId });
            expect(reopen.status).toBe(200);

            const afterReopen = await fetchTask(task.id);
            expect(afterReopen.reviewStatus).toBeNull();
            expect(afterReopen.reviewedAt).toBeNull();
            expect(afterReopen.reviewedBy).toBeNull();
            expect(afterReopen.completedAt).toBeNull();
            expect(await countLedger(task.id)).toBe(1); // history kept

            const redo = await ownerClient
                .patch(taskPath(task.id))
                .send({ status_id: dl.doneStatusId });
            expect(redo.status).toBe(200);
            const afterRedo = await fetchTask(task.id);
            expect(afterRedo.completedAt).not.toBeNull();
            expect(afterRedo.reviewStatus).toBeNull(); // needs a FRESH review
        });

        it("a done→done move (same boundary side) keeps the verdict AND the original completed_at", async () => {
            const { owner, dl, task, ownerClient, headClient } = await seed();
            void owner;
            await headClient
                .post(reviewPath(task.id))
                .send({ status: "flagged" });
            const before = await fetchTask(task.id);

            // Second done-group status on the same list.
            const done2 = await makeStatus({
                scopeId: dl.listId,
                statusGroup: "closed",
                name: "Shipped",
            });
            const res = await ownerClient
                .patch(taskPath(task.id))
                .send({ status_id: done2.id });
            expect(res.status).toBe(200);

            const after = await fetchTask(task.id);
            expect(after.reviewStatus).toBe("flagged");
            expect(after.completedAt?.getTime()).toBe(
                before.completedAt?.getTime(),
            );
        });
    });

    describe("Path 2 — bulk", () => {
        it("bulk reopen clears the denorm trio on every target", async () => {
            const { owner, dl, task, ownerClient, headClient } = await seed();
            const task2 = await makeDoneTask({
                workspaceId: owner.workspaceId,
                listId: dl.listId,
                doneStatusId: dl.doneStatusId,
                createdBy: owner.id,
            });
            await headClient
                .post(reviewPath(task.id))
                .send({ status: "approved" });
            await headClient
                .post(reviewPath(task2.id))
                .send({ status: "flagged" });

            const res = await ownerClient.post("/api/v1/tasks/bulk").send({
                ids: [task.id, task2.id],
                patch: { status_id: dl.activeStatusId },
            });
            expect(res.status).toBe(200);

            for (const id of [task.id, task2.id]) {
                const row = await fetchTask(id);
                expect(row.reviewStatus).toBeNull();
                expect(row.reviewedBy).toBeNull();
                expect(row.completedAt).toBeNull();
            }
        });

        it("bulk re-done PRESERVES an existing completed_at (COALESCE) while stamping fresh ones", async () => {
            const { owner, dl, task, ownerClient } = await seed();
            const oldInstant = new Date("2026-07-01T05:00:00.000Z");
            await db()
                .update(tasks)
                .set({ completedAt: oldInstant })
                .where(eq(tasks.id, task.id));
            // A second, NOT-yet-done task.
            const fresh = await makeDoneTask({
                workspaceId: owner.workspaceId,
                listId: dl.listId,
                doneStatusId: dl.activeStatusId, // active status
                createdBy: owner.id,
            });
            await db()
                .update(tasks)
                .set({ completedAt: null })
                .where(eq(tasks.id, fresh.id));

            const res = await ownerClient.post("/api/v1/tasks/bulk").send({
                ids: [task.id, fresh.id],
                patch: { status_id: dl.doneStatusId },
            });
            expect(res.status).toBe(200);

            const keeper = await fetchTask(task.id);
            expect(keeper.completedAt?.getTime()).toBe(oldInstant.getTime());
            const stamped = await fetchTask(fresh.id);
            expect(stamped.completedAt).not.toBeNull();
            expect(stamped.completedAt!.getTime()).toBeGreaterThan(
                oldInstant.getTime(),
            );
        });

        it("bulk EDIT of an archived task is 409 task.archived; a patch providing archived_at may target it", async () => {
            const { owner, dl, task, ownerClient } = await seed();
            const archived = await makeDoneTask({
                workspaceId: owner.workspaceId,
                listId: dl.listId,
                doneStatusId: dl.doneStatusId,
                createdBy: owner.id,
                archivedAt: new Date("2026-01-02T03:04:05.000Z"),
            });

            const blocked = await ownerClient.post("/api/v1/tasks/bulk").send({
                ids: [task.id, archived.id],
                patch: { priority: 2 },
            });
            expect(blocked.status).toBe(409);
            expect(blocked.body.error.code).toBe("task.archived");

            const unarchive = await ownerClient
                .post("/api/v1/tasks/bulk")
                .send({
                    ids: [archived.id],
                    patch: { archived_at: null },
                });
            expect(unarchive.status).toBe(200);
        });
    });

    describe("Path 3 — status re-grouping guard", () => {
        it("409 status.in_use when re-grouping ACROSS the done boundary with tasks on the status", async () => {
            const { dl, ownerClient } = await seed(); // seed's task sits on doneStatusId

            const res = await ownerClient
                .patch(statusPath(dl.doneStatusId))
                .send({ status_group: "active" });

            expect(res.status).toBe(409);
            expect(res.body.error.code).toBe("status.in_use");
        });

        it("same-side re-grouping with tasks is allowed; cross-boundary with ZERO tasks is allowed", async () => {
            const { dl, ownerClient } = await seed();

            // done → closed: both on the done side; tasks sit on it — allowed.
            const sameSide = await ownerClient
                .patch(statusPath(dl.doneStatusId))
                .send({ status_group: "closed" });
            expect(sameSide.status).toBe(200);

            // activeStatus has no tasks → cross-boundary re-group is allowed.
            const empty = await ownerClient
                .patch(statusPath(dl.activeStatusId))
                .send({ status_group: "done" });
            expect(empty.status).toBe(200);
        });
    });

    describe("Race invariant (deferred from P8)", () => {
        it("concurrent review + reopen can never leave a verdict on a not-done task", async () => {
            const { dl, task, ownerClient, headClient } = await seed();

            const [reviewRes, reopenRes] = await Promise.all([
                headClient
                    .post(reviewPath(task.id))
                    .send({ status: "approved" }),
                ownerClient
                    .patch(taskPath(task.id))
                    .send({ status_id: dl.activeStatusId }),
            ]);

            // Either order is legal (review-then-reopen → reset wins; reopen-
            // then-review → 409). The INVARIANT: never an approved verdict on
            // a task that is no longer done.
            expect([201, 409]).toContain(reviewRes.status);
            expect(reopenRes.status).toBe(200);

            const row = await fetchTask(task.id);
            const verdictOnReopened =
                row.reviewStatus !== null && row.completedAt === null;
            expect(verdictOnReopened).toBe(false);
        });
    });
});
