import { eq } from "drizzle-orm";
import { getDb } from "../../src/db/client";
import { lists, tasks } from "../../src/db/schema";
import { dhakaToday } from "../../src/utils/dhakaTime";
import { oneOff } from "../test-utils/app";
import { makeLoggedInClient, makeUser } from "../test-utils/factories";
import {
    makeDeptList,
    makeDoneTask,
    makeSpaceWithHead,
} from "./helpers";
import { fakeId } from "../../src/utils";

/**
 * Dept Review V1 — P11: A-2 review-summary + A-3 review-queue.
 *
 * Covers: the §5 rule-4 traversal predicate (archived lists AND archived
 * tasks excluded), live done-group bucketing, per-assignee member rows vs
 * task-level DEDUPED totals (H-3), the synthetic Unassigned row (H-4),
 * deactivated members surfacing via user.status, last_activity, all four
 * buckets, member filter, keyset pagination, parent breadcrumbs (H-5), and
 * the guard/error matrix. Parity: tiles == queue total_estimate.
 */

const summaryPath = (id: string) => `/api/v1/spaces/${id}/review-summary`;
const queuePath = (id: string, q: string) =>
    `/api/v1/spaces/${id}/review-queue?${q}`;
const reviewPath = (id: string) => `/api/v1/tasks/${id}/review`;

const shiftDays = (ymd: string, days: number): string => {
    const [y, m, d] = ymd.split("-").map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d + days));
    return dt.toISOString().slice(0, 10);
};

/**
 * The full department scenario:
 *   A (member): t1 done-unreviewed · t2 done-approved (with B) · t4 due-today
 *               · t6 due-tomorrow · t11 done-unreviewed (with B)
 *   B (member): t2 · t3 done-FLAGGED · t5 overdue · t11
 *   C (deactivated): t10 open
 *   Unassigned: t7 done-unreviewed
 *   Excluded: t8 (archived task) · t9 (task under an ARCHIVED list)
 *   tSub: done-unreviewed subtask of tP (parent breadcrumb)
 */
const seedScenario = async () => {
    const today = dhakaToday();
    const owner = await makeUser({ role: "owner" });
    const ws = owner.workspaceId;
    const head = await makeUser({ workspaceId: ws, role: "member" });
    const A = await makeUser({
        workspaceId: ws,
        role: "member",
        firstName: "Aa",
        lastName: "Alpha",
    });
    const B = await makeUser({
        workspaceId: ws,
        role: "member",
        firstName: "Bb",
        lastName: "Beta",
    });
    const C = await makeUser({
        workspaceId: ws,
        role: "member",
        status: "deactivated",
        firstName: "Cc",
        lastName: "Gone",
    });
    const sp = await makeSpaceWithHead({
        workspaceId: ws,
        headUserId: head.id,
        createdBy: owner.id,
    });
    const dl = await makeDeptList({
        workspaceId: ws,
        spaceId: sp.id,
        createdBy: owner.id,
    });
    const mk = (over: Partial<Parameters<typeof makeDoneTask>[0]>) =>
        makeDoneTask({
            workspaceId: ws,
            listId: dl.listId,
            doneStatusId: dl.doneStatusId,
            createdBy: owner.id,
            ...over,
        });

    const t1 = await mk({ assigneeIds: [A.id], name: "t1 done unrev A" });
    const t2 = await mk({ assigneeIds: [A.id, B.id], name: "t2 approved AB" });
    const t3 = await mk({ assigneeIds: [B.id], name: "t3 flagged B" });
    const t4 = await mk({
        doneStatusId: dl.activeStatusId,
        assigneeIds: [A.id],
        dueDate: today,
        name: "t4 due today A",
    });
    const t5 = await mk({
        doneStatusId: dl.activeStatusId,
        assigneeIds: [B.id],
        dueDate: shiftDays(today, -1),
        name: "t5 overdue B",
    });
    const t6 = await mk({
        doneStatusId: dl.activeStatusId,
        assigneeIds: [A.id],
        dueDate: shiftDays(today, 1),
        name: "t6 tomorrow A",
    });
    const t7 = await mk({ name: "t7 done unrev unassigned" });
    const t8 = await mk({
        assigneeIds: [A.id],
        archivedAt: new Date("2026-01-02T03:04:05.000Z"),
        name: "t8 archived",
    });
    const t10 = await mk({
        doneStatusId: dl.activeStatusId,
        assigneeIds: [C.id],
        name: "t10 open C",
    });
    const t11 = await mk({
        assigneeIds: [A.id, B.id],
        name: "t11 done unrev AB",
    });

    // t9 lives under an ARCHIVED list of the same space — must vanish
    // everywhere (rule-4 traversal).
    const dl2 = await makeDeptList({
        workspaceId: ws,
        spaceId: sp.id,
        createdBy: owner.id,
    });
    const t9 = await makeDoneTask({
        workspaceId: ws,
        listId: dl2.listId,
        doneStatusId: dl2.doneStatusId,
        assigneeIds: [A.id],
        name: "t9 in archived list",
    });
    await getDb()
        .update(lists)
        .set({ archivedAt: new Date("2026-01-02T03:04:05.000Z") })
        .where(eq(lists.id, dl2.listId));

    // Subtask with a parent breadcrumb.
    const tP = await mk({
        doneStatusId: dl.activeStatusId,
        name: "Parent story",
    });
    const tSub = await mk({ name: "tSub done unrev child" });
    await getDb()
        .update(tasks)
        .set({ parentTaskId: tP.id, nestingDepth: 1 })
        .where(eq(tasks.id, tSub.id));

    const headClient = await makeLoggedInClient({ ...head, role: "member" });
    // Reviews via the real API: approve t2, flag t3.
    await headClient.post(reviewPath(t2.id)).send({ status: "approved" });
    await headClient
        .post(reviewPath(t3.id))
        .send({ status: "flagged", note: "redo" });

    // A acts once (rename t4) so their last_activity is non-null.
    const aClient = await makeLoggedInClient({ ...A, role: "member" });
    await aClient.patch(`/api/v1/tasks/${t4.id}`).send({ name: "t4 renamed" });

    return {
        owner, head, A, B, C, sp, dl, headClient,
        t1, t2, t3, t4, t5, t6, t7, t8, t9, t10, t11, tP, tSub,
    };
};

describe("A-2 GET /spaces/:id/review-summary + A-3 review-queue (Dept Review V1)", () => {
    it("summary: per-assignee member rows, Unassigned last, deduped totals, deactivated + last_activity surfaced", async () => {
        const s = await seedScenario();

        const res = await s.headClient.get(summaryPath(s.sp.id));
        expect(res.status).toBe(200);
        expect(res.body.space_id).toBe(s.sp.id);

        const members = res.body.members as Array<{
            user: { id: string; status: string } | null;
            open: number;
            due_today: number;
            overdue: number;
            done_unreviewed: number;
            flagged: number;
            last_activity: string | null;
        }>;

        // Unassigned row exists and sorts LAST.
        expect(members[members.length - 1].user).toBeNull();
        const un = members[members.length - 1];
        expect(un.done_unreviewed).toBe(2); // t7 + tSub (both unassigned)
        expect(un.open).toBe(1); // tP (unassigned active parent)

        const rowOf = (id: string) =>
            members.find((m) => m.user?.id === id)!;
        const a = rowOf(s.A.id);
        // A: open = t4, t6 (+t4 rename doesn't change status); done_unrev = t1, t11, tSub? tSub unassigned!
        expect(a).toMatchObject({
            open: 2,
            due_today: 1,
            overdue: 0,
            done_unreviewed: 2, // t1, t11
            flagged: 0,
        });
        expect(a.last_activity).not.toBeNull(); // renamed t4 via the API

        const b = rowOf(s.B.id);
        expect(b).toMatchObject({
            open: 1, // t5
            due_today: 0,
            overdue: 1,
            done_unreviewed: 1, // t11
            flagged: 1, // t3
        });
        expect(b.last_activity).toBeNull(); // B never acted

        const c = rowOf(s.C.id);
        expect(c.user?.status).toBe("deactivated"); // history, flagged via status
        expect(c.open).toBe(1); // t10

        // Task-level DEDUPED totals ≠ sum of per-assignee rows (H-3):
        // done_unreviewed tasks = t1, t7, t11, tSub = 4 (A+B+Un rows sum to 5).
        expect(res.body.totals).toMatchObject({
            open: 5, // t4, t5, t6, t10, tP
            due_today: 1,
            overdue: 1,
            done_unreviewed: 4,
            flagged: 1,
        });
        const memberDoneUnrevSum = members.reduce(
            (n, m) => n + m.done_unreviewed,
            0,
        );
        expect(memberDoneUnrevSum).toBeGreaterThan(
            res.body.totals.done_unreviewed,
        );
    });

    it("queue: needs_review bucket = live done-group ∧ unreviewed; archived task + archived-list task excluded; parity with totals", async () => {
        const s = await seedScenario();

        const res = await s.headClient.get(
            queuePath(s.sp.id, "bucket=needs_review"),
        );
        expect(res.status).toBe(200);

        const ids = res.body.data.map((r: { id: string }) => r.id);
        expect(ids).toEqual([s.t1.id, s.t7.id, s.t11.id, s.tSub.id]); // internal_id ASC
        expect(ids).not.toContain(s.t8.id); // archived task
        expect(ids).not.toContain(s.t9.id); // archived LIST
        expect(res.body.pagination).toMatchObject({
            next_cursor: null,
            has_more: false,
            total_estimate: 4,
        });

        // Parity: queue total == summary totals.done_unreviewed (H-4).
        const sum = await s.headClient.get(summaryPath(s.sp.id));
        expect(sum.body.totals.done_unreviewed).toBe(
            res.body.pagination.total_estimate,
        );

        // Row shape: wire Task + review + parent_task; assignees hydrated.
        const t1row = res.body.data.find(
            (r: { id: string }) => r.id === s.t1.id,
        );
        expect(t1row.primary_list_id).toBe(s.dl.listId);
        expect(t1row.assignees).toEqual([s.A.id]);
        expect(t1row.review).toBeNull();
        expect(t1row.parent_task).toBeNull();

        const subRow = res.body.data.find(
            (r: { id: string }) => r.id === s.tSub.id,
        );
        expect(subRow.parent_task).toEqual({
            id: s.tP.id,
            name: "Parent story",
        });
    });

    it("queue: flagged bucket carries the current review; overdue + due_today buckets use the Dhaka calendar", async () => {
        const s = await seedScenario();

        const flagged = await s.headClient.get(
            queuePath(s.sp.id, "bucket=flagged"),
        );
        expect(flagged.body.data.map((r: { id: string }) => r.id)).toEqual([
            s.t3.id,
        ]);
        expect(flagged.body.data[0].review).toMatchObject({
            status: "flagged",
            reviewed_by: s.head.id,
        });
        expect(flagged.body.data[0].review.reviewed_at).not.toBeNull();

        const overdue = await s.headClient.get(
            queuePath(s.sp.id, "bucket=overdue"),
        );
        expect(overdue.body.data.map((r: { id: string }) => r.id)).toEqual([
            s.t5.id,
        ]);

        const dueToday = await s.headClient.get(
            queuePath(s.sp.id, "bucket=due_today"),
        );
        expect(dueToday.body.data.map((r: { id: string }) => r.id)).toEqual([
            s.t4.id,
        ]);
    });

    it("queue: member_id filters to that assignee (unassigned rows drop out)", async () => {
        const s = await seedScenario();

        const res = await s.headClient.get(
            queuePath(s.sp.id, `bucket=needs_review&member_id=${s.A.id}`),
        );
        expect(res.body.data.map((r: { id: string }) => r.id)).toEqual([
            s.t1.id,
            s.t11.id,
        ]);
        expect(res.body.pagination.total_estimate).toBe(2);
    });

    it("queue: keyset pagination pages without overlap and keeps the exact total", async () => {
        const s = await seedScenario();

        const page1 = await s.headClient.get(
            queuePath(s.sp.id, "bucket=needs_review&limit=2"),
        );
        expect(page1.body.data).toHaveLength(2);
        expect(page1.body.pagination.has_more).toBe(true);
        expect(page1.body.pagination.total_estimate).toBe(4);
        const cursor = page1.body.pagination.next_cursor as string;
        expect(cursor).toBeTruthy();

        const page2 = await s.headClient.get(
            queuePath(
                s.sp.id,
                `bucket=needs_review&limit=2&cursor=${encodeURIComponent(cursor)}`,
            ),
        );
        expect(page2.body.data).toHaveLength(2);
        expect(page2.body.pagination.has_more).toBe(false);
        expect(page2.body.pagination.next_cursor).toBeNull();

        const all = [
            ...page1.body.data.map((r: { id: string }) => r.id),
            ...page2.body.data.map((r: { id: string }) => r.id),
        ];
        expect(new Set(all).size).toBe(4); // no overlap
        expect(all).toEqual([s.t1.id, s.t7.id, s.t11.id, s.tSub.id]);
    });

    it("empty department: summary = no members + zero totals; queue = clean empty page", async () => {
        const owner = await makeUser({ role: "owner" });
        const sp = await makeSpaceWithHead({
            workspaceId: owner.workspaceId,
            createdBy: owner.id,
        });
        const client = await makeLoggedInClient({ ...owner, role: "owner" });

        const sum = await client.get(summaryPath(sp.id));
        expect(sum.status).toBe(200);
        expect(sum.body.members).toEqual([]);
        expect(sum.body.totals).toMatchObject({
            open: 0,
            due_today: 0,
            overdue: 0,
            done_unreviewed: 0,
            flagged: 0,
        });

        const q = await client.get(queuePath(sp.id, "bucket=needs_review"));
        expect(q.status).toBe(200);
        expect(q.body.data).toEqual([]);
        expect(q.body.pagination).toMatchObject({
            next_cursor: null,
            has_more: false,
            total_estimate: 0,
        });
    });

    describe("Guards + validation", () => {
        it("owner reads any space; a plain member and another space's head get 403", async () => {
            const s = await seedScenario();
            const ownerClient = await makeLoggedInClient({
                ...s.owner,
                role: "owner",
            });
            expect(
                (await ownerClient.get(summaryPath(s.sp.id))).status,
            ).toBe(200);

            const outsider = await makeUser({
                workspaceId: s.owner.workspaceId,
                role: "member",
            });
            const otherHead = await makeUser({
                workspaceId: s.owner.workspaceId,
                role: "member",
            });
            await makeSpaceWithHead({
                workspaceId: s.owner.workspaceId,
                headUserId: otherHead.id,
                createdBy: s.owner.id,
            });
            for (const u of [outsider, otherHead]) {
                const c = await makeLoggedInClient({ ...u, role: "member" });
                const r1 = await c.get(summaryPath(s.sp.id));
                expect(r1.status).toBe(403);
                expect(r1.body.error.code).toBe("review.not_head");
                const r2 = await c.get(
                    queuePath(s.sp.id, "bucket=needs_review"),
                );
                expect(r2.status).toBe(403);
            }
        });

        it("404 for unknown/foreign space; 409 for an archived space", async () => {
            const s = await seedScenario();
            const foreignOwner = await makeUser({ role: "owner" });
            const foreignClient = await makeLoggedInClient({
                ...foreignOwner,
                role: "owner",
            });
            const cross = await foreignClient.get(summaryPath(s.sp.id));
            expect(cross.status).toBe(404);
            expect(cross.body.error.code).toBe("space.not_found");

            const unknown = await s.headClient.get(summaryPath(fakeId("sp")));
            expect(unknown.status).toBe(404);

            const archivedSp = await makeSpaceWithHead({
                workspaceId: s.owner.workspaceId,
                headUserId: s.head.id,
                createdBy: s.owner.id,
                archivedAt: new Date("2026-01-02T03:04:05.000Z"),
            });
            const arch = await s.headClient.get(
                queuePath(archivedSp.id, "bucket=needs_review"),
            );
            expect(arch.status).toBe(409);
            expect(arch.body.error.code).toBe("space.archived");
        });

        it("422 for a missing/invalid bucket; 400 for a malformed cursor; 401 without a token", async () => {
            const s = await seedScenario();

            const noBucket = await s.headClient.get(
                `/api/v1/spaces/${s.sp.id}/review-queue`,
            );
            expect(noBucket.status).toBe(422);
            expect(noBucket.body.error.code).toBe("validation.failed");

            const badBucket = await s.headClient.get(
                queuePath(s.sp.id, "bucket=everything"),
            );
            expect(badBucket.status).toBe(422);

            const badCursor = await s.headClient.get(
                queuePath(s.sp.id, "bucket=needs_review&cursor=%24%24bad"),
            );
            expect(badCursor.status).toBe(400);
            expect(badCursor.body.error.code).toBe(
                "pagination.invalid_cursor",
            );

            const http = await oneOff();
            const unauth = await http.get(
                queuePath("sp-anything", "bucket=needs_review"),
            );
            expect(unauth.status).toBe(401);
        });
    });
});
