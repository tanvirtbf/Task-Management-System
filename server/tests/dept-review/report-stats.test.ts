import { eq } from "drizzle-orm";
import { getDb } from "../../src/db/client";
import logger from "../../src/config/logger";
import { lists, tasks } from "../../src/db/schema";
import { ReviewsRepo } from "../../src/repositories/ReviewsRepo";
import { TasksRepo } from "../../src/repositories/TasksRepo";
import { UsersRepo } from "../../src/repositories/UsersRepo";
import { ReportStatsService } from "../../src/services/ReportStatsService";
import {
    addDaysYmd,
    dhakaWeekOf,
    isDhakaMonday,
    previousWeekStart,
    weekBoundsUtc,
} from "../../src/utils/dhakaTime";
import { makeUser } from "../test-utils/factories";
import {
    makeDeptList,
    makeDoneTask,
    makeReview,
    makeSpaceWithHead,
    setTaskReviewDenorm,
} from "./helpers";

/**
 * Dept Review V1 — P18: week math + `ReportStatsService.computeWeek`.
 *
 * The unit matrix locks the §3 payload semantics: Dhaka-week UTC bounds (the
 * 6h band!), completed_late Dhaka-day math, per-assignee rows vs task-deduped
 * totals, distinct-task approved/flagged + flag ACTIONS, self_reviewed,
 * Unassigned row, archived rules, point-in-time vs window, isolation,
 * prev_week passthrough.
 */

const WEEK = "2026-07-13"; // a Dhaka Monday
const TODAY = "2026-07-22";

const service = () => {
    const db = getDb();
    return new ReportStatsService(
        new ReviewsRepo(db),
        new TasksRepo(db),
        new UsersRepo(db),
        logger,
    );
};

const compute = (
    spaceId: string,
    workspaceId: string,
    prevTotals: { completed: number; overdue_now: number } | null = null,
) =>
    service().computeWeek({
        spaceId,
        workspaceId,
        weekStart: WEEK,
        today: TODAY,
        prevTotals,
    });

/** Owner + head + members + a dept list, ready for scenarios. */
const seed = async () => {
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
    return { owner, ws, head, A, B, sp, dl };
};

const rowFor = (
    payload: Awaited<ReturnType<ReportStatsService["computeWeek"]>>,
    userId: string | null,
) =>
    payload.members.find((m) =>
        userId === null ? m.user === null : m.user?.id === userId,
    );

describe("Dhaka week math (pure)", () => {
    it("weekBoundsUtc pins the fixed +06:00 boundaries", () => {
        const { fromUtc, toUtcExclusive } = weekBoundsUtc(WEEK);
        expect(fromUtc.toISOString()).toBe("2026-07-12T18:00:00.000Z");
        expect(toUtcExclusive.toISOString()).toBe("2026-07-19T18:00:00.000Z");
    });

    it("dhakaWeekOf flips weeks exactly at the Dhaka midnight boundary", () => {
        expect(
            dhakaWeekOf(new Date("2026-07-19T17:59:59.000Z")).weekStart,
        ).toBe("2026-07-13");
        expect(
            dhakaWeekOf(new Date("2026-07-19T18:00:00.000Z")).weekStart,
        ).toBe("2026-07-20");
        expect(dhakaWeekOf(new Date("2026-07-15T05:00:00.000Z"))).toEqual({
            weekStart: "2026-07-13",
            weekEnd: "2026-07-19",
        });
    });

    it("isDhakaMonday / previousWeekStart / addDaysYmd (month-cross)", () => {
        expect(isDhakaMonday("2026-07-13")).toBe(true);
        expect(isDhakaMonday("2026-07-14")).toBe(false);
        expect(previousWeekStart("2026-07-13")).toBe("2026-07-06");
        expect(addDaysYmd("2026-07-31", 1)).toBe("2026-08-01");
        expect(addDaysYmd("2026-01-01", -1)).toBe("2025-12-31");
    });
});

describe("ReportStatsService.computeWeek", () => {
    it("window boundaries: the 6h band is honoured on both edges (per-assignee + deduped totals)", async () => {
        const { ws, owner, A, B, sp, dl } = await seed();
        const mk = (name: string, completedAt: Date, assignees: string[]) =>
            makeDoneTask({
                workspaceId: ws,
                listId: dl.listId,
                doneStatusId: dl.doneStatusId,
                createdBy: owner.id,
                name,
                completedAt,
                assigneeIds: assignees,
            });

        await mk("in-start", new Date("2026-07-12T18:00:00.000Z"), [A.id]); // inclusive start
        await mk("in-late-sunday", new Date("2026-07-19T17:30:00.000Z"), [
            A.id,
            B.id,
        ]); // multi-assignee, in-window
        await mk("out-before", new Date("2026-07-12T17:59:00.000Z"), [A.id]);
        await mk("out-after", new Date("2026-07-19T18:00:00.000Z"), [A.id]);

        const p = await compute(sp.id, ws);

        expect(p.totals.completed).toBe(2); // deduped: in-start + in-late-sunday
        expect(rowFor(p, A.id)?.completed).toBe(2); // per-assignee
        expect(rowFor(p, B.id)?.completed).toBe(1); // shares the multi-assignee task
    });

    it("completed_late uses the Dhaka calendar day — including the midnight band", async () => {
        const { ws, owner, A, sp, dl } = await seed();
        const mk = (name: string, completedAt: Date, dueDate?: string) =>
            makeDoneTask({
                workspaceId: ws,
                listId: dl.listId,
                doneStatusId: dl.doneStatusId,
                createdBy: owner.id,
                name,
                completedAt,
                dueDate,
                assigneeIds: [A.id],
            });

        await mk("late-clear", new Date("2026-07-15T10:00:00.000Z"), "2026-07-14");
        await mk("on-time", new Date("2026-07-14T17:00:00.000Z"), "2026-07-14"); // 23:00 Dhaka same day
        await mk("late-band", new Date("2026-07-14T18:30:00.000Z"), "2026-07-14"); // 00:30 Dhaka NEXT day
        await mk("no-due", new Date("2026-07-15T09:00:00.000Z"));

        const p = await compute(sp.id, ws);
        expect(p.totals.completed).toBe(4);
        expect(p.totals.completed_late).toBe(2); // late-clear + late-band
        expect(rowFor(p, A.id)?.completed_late).toBe(2);
    });

    it("distinct-task approved/flagged + flag ACTIONS + reviews_done + reviewer hydration (undo chain)", async () => {
        const { ws, owner, head, A, sp, dl } = await seed();
        const t = await makeDoneTask({
            workspaceId: ws,
            listId: dl.listId,
            doneStatusId: dl.doneStatusId,
            createdBy: owner.id,
            completedAt: new Date("2026-07-14T10:00:00.000Z"),
            assigneeIds: [A.id],
        });
        const at = (iso: string) => new Date(iso);
        await makeReview({
            workspaceId: ws,
            spaceId: sp.id,
            taskId: t.id,
            reviewerId: head.id,
            status: "approved",
            createdAt: at("2026-07-14T11:00:00.000Z"),
        });
        await makeReview({
            workspaceId: ws,
            spaceId: sp.id,
            taskId: t.id,
            reviewerId: head.id,
            status: "flagged",
            note: "recheck totals",
            createdAt: at("2026-07-14T12:00:00.000Z"),
        });
        await makeReview({
            workspaceId: ws,
            spaceId: sp.id,
            taskId: t.id,
            reviewerId: head.id,
            status: "approved",
            createdAt: at("2026-07-14T13:00:00.000Z"),
        });
        await setTaskReviewDenorm(t.id, {
            reviewStatus: "approved",
            reviewedAt: at("2026-07-14T13:00:00.000Z"),
            reviewedBy: head.id,
        });

        const p = await compute(sp.id, ws);
        expect(p.totals.approved).toBe(1); // distinct task
        expect(p.totals.flagged).toBe(1);
        expect(p.head_accountability.reviews_done).toBe(3); // every action
        expect(p.head_accountability.self_reviewed).toBe(0);

        const a = rowFor(p, A.id)!;
        expect(a.approved).toBe(1);
        expect(a.flagged).toBe(1);
        expect(a.flags).toHaveLength(1); // one flag ACTION
        expect(a.flags[0]).toMatchObject({
            task_id: t.id,
            note: "recheck totals",
        });
        expect(a.flags[0].reviewer?.id).toBe(head.id);
        expect(a.flags[0].reviewer).not.toHaveProperty("password_hash");
    });

    it("self_reviewed counts actions whose reviewer is an assignee of the task", async () => {
        const { ws, owner, head, sp, dl } = await seed();
        const own = await makeDoneTask({
            workspaceId: ws,
            listId: dl.listId,
            doneStatusId: dl.doneStatusId,
            createdBy: owner.id,
            completedAt: new Date("2026-07-14T10:00:00.000Z"),
            assigneeIds: [head.id], // the head's own task
        });
        await makeReview({
            workspaceId: ws,
            spaceId: sp.id,
            taskId: own.id,
            reviewerId: head.id,
            status: "approved",
            createdAt: new Date("2026-07-14T11:00:00.000Z"),
        });

        const p = await compute(sp.id, ws);
        expect(p.head_accountability.self_reviewed).toBe(1);
        expect(p.head_accountability.reviews_done).toBe(1);
    });

    it("unassigned work lands in the synthetic user:null row (sorted last), incl. flags; subtask flags carry the parent breadcrumb", async () => {
        const { ws, owner, head, A, sp, dl } = await seed();
        // A named member's completion keeps the members list non-trivial.
        await makeDoneTask({
            workspaceId: ws,
            listId: dl.listId,
            doneStatusId: dl.doneStatusId,
            createdBy: owner.id,
            completedAt: new Date("2026-07-14T09:00:00.000Z"),
            assigneeIds: [A.id],
        });
        const parent = await makeDoneTask({
            workspaceId: ws,
            listId: dl.listId,
            doneStatusId: dl.activeStatusId, // open parent
            createdBy: owner.id,
            name: "Parent story",
        });
        await getDb()
            .update(tasks)
            .set({ completedAt: null })
            .where(eq(tasks.id, parent.id));
        const sub = await makeDoneTask({
            workspaceId: ws,
            listId: dl.listId,
            doneStatusId: dl.doneStatusId,
            createdBy: owner.id,
            name: "orphan sub",
            completedAt: new Date("2026-07-14T10:00:00.000Z"),
        });
        await getDb()
            .update(tasks)
            .set({ parentTaskId: parent.id, nestingDepth: 1 })
            .where(eq(tasks.id, sub.id));
        await makeReview({
            workspaceId: ws,
            spaceId: sp.id,
            taskId: sub.id,
            reviewerId: head.id,
            status: "flagged",
            note: "who owns this?",
            createdAt: new Date("2026-07-14T11:00:00.000Z"),
        });

        const p = await compute(sp.id, ws);
        const last = p.members[p.members.length - 1];
        expect(last.user).toBeNull();
        expect(last.completed).toBe(1); // the unassigned sub
        expect(last.flagged).toBe(1);
        expect(last.flags[0].parent_task).toEqual({
            id: parent.id,
            name: "Parent story",
        });
    });

    it("archived rules: completed-then-archived still counts in the window; archived-list work vanishes; archived tasks leave the point-in-time stats", async () => {
        const { ws, owner, head, A, sp, dl } = await seed();
        // Completed in-window, then archived: counts in `completed`, NOT in
        // done_unreviewed (point-in-time excludes archived tasks).
        await makeDoneTask({
            workspaceId: ws,
            listId: dl.listId,
            doneStatusId: dl.doneStatusId,
            createdBy: owner.id,
            completedAt: new Date("2026-07-14T10:00:00.000Z"),
            assigneeIds: [A.id],
            archivedAt: new Date("2026-07-18T10:00:00.000Z"),
        });
        // A live done-unreviewed task for contrast.
        await makeDoneTask({
            workspaceId: ws,
            listId: dl.listId,
            doneStatusId: dl.doneStatusId,
            createdBy: owner.id,
            completedAt: new Date("2026-07-14T11:00:00.000Z"),
            assigneeIds: [A.id],
        });
        // Under an ARCHIVED list: completion AND review both vanish.
        const dl2 = await makeDeptList({
            workspaceId: ws,
            spaceId: sp.id,
            createdBy: owner.id,
        });
        const ghost = await makeDoneTask({
            workspaceId: ws,
            listId: dl2.listId,
            doneStatusId: dl2.doneStatusId,
            createdBy: owner.id,
            completedAt: new Date("2026-07-14T12:00:00.000Z"),
            assigneeIds: [A.id],
        });
        await makeReview({
            workspaceId: ws,
            spaceId: sp.id,
            taskId: ghost.id,
            reviewerId: head.id,
            status: "flagged",
            createdAt: new Date("2026-07-14T13:00:00.000Z"),
        });
        await getDb()
            .update(lists)
            .set({ archivedAt: new Date("2026-07-18T00:00:00.000Z") })
            .where(eq(lists.id, dl2.listId));

        const p = await compute(sp.id, ws);
        expect(p.totals.completed).toBe(2); // archived-task counts, ghost does not
        expect(p.totals.done_unreviewed).toBe(1); // only the live unreviewed one
        expect(p.totals.flagged).toBe(0); // ghost's flag vanished with its list
        expect(p.head_accountability.reviews_done).toBe(0);
    });

    it("point-in-time vs window: old completions stay in done_unreviewed; overdue_now snapshots against today", async () => {
        const { ws, owner, A, sp, dl } = await seed();
        await makeDoneTask({
            workspaceId: ws,
            listId: dl.listId,
            doneStatusId: dl.doneStatusId,
            createdBy: owner.id,
            completedAt: new Date("2026-06-01T10:00:00.000Z"), // way before the week
            assigneeIds: [A.id],
        });
        const open = await makeDoneTask({
            workspaceId: ws,
            listId: dl.listId,
            doneStatusId: dl.activeStatusId,
            createdBy: owner.id,
            dueDate: "2026-07-20", // < TODAY (2026-07-22)
            assigneeIds: [A.id],
        });
        await getDb()
            .update(tasks)
            .set({ completedAt: null })
            .where(eq(tasks.id, open.id));

        const p = await compute(sp.id, ws);
        expect(p.totals.completed).toBe(0); // nothing IN the window
        expect(p.totals.done_unreviewed).toBe(1); // the June completion, still unreviewed
        expect(p.totals.overdue_now).toBe(1);
        expect(rowFor(p, A.id)?.assigned_open).toBe(1);
        expect(rowFor(p, A.id)?.overdue_now).toBe(1);
    });

    it("cross-space isolation + empty department + prev_week passthrough", async () => {
        const { ws, owner, head, A, sp } = await seed();
        // Activity in a DIFFERENT space of the same workspace.
        const other = await makeSpaceWithHead({
            workspaceId: ws,
            headUserId: head.id,
            createdBy: owner.id,
        });
        const odl = await makeDeptList({
            workspaceId: ws,
            spaceId: other.id,
            createdBy: owner.id,
        });
        const ot = await makeDoneTask({
            workspaceId: ws,
            listId: odl.listId,
            doneStatusId: odl.doneStatusId,
            createdBy: owner.id,
            completedAt: new Date("2026-07-14T10:00:00.000Z"),
            assigneeIds: [A.id],
        });
        await makeReview({
            workspaceId: ws,
            spaceId: other.id,
            taskId: ot.id,
            reviewerId: head.id,
            status: "approved",
            createdAt: new Date("2026-07-14T11:00:00.000Z"),
        });

        const p = await compute(sp.id, ws, { completed: 9, overdue_now: 3 });
        expect(p.members).toEqual([]);
        expect(p.totals).toEqual({
            completed: 0,
            completed_late: 0,
            overdue_now: 0,
            approved: 0,
            flagged: 0,
            done_unreviewed: 0,
        });
        expect(p.head_accountability.reviews_done).toBe(0);
        expect(p.prev_week).toEqual({ completed: 9, overdue_now: 3 });

        const pNull = await compute(sp.id, ws, null);
        expect(pNull.prev_week).toBeNull();
    });
});
