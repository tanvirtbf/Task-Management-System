import { eq } from "drizzle-orm";
import { getDb, getPool } from "../../src/db/client";
import { Config } from "../../src/config";
import {
    departmentReports,
    spaces,
    taskAssignees,
    taskReviews,
    tasks,
} from "../../src/db/schema";
import { makeUser } from "../test-utils/factories";
import {
    makeDeptList,
    makeDoneTask,
    makeReport,
    makeReview,
    makeSpaceWithHead,
    setTaskReviewDenorm,
} from "./helpers";

/**
 * Dept Review V1 — harness smoke suite (plan P4).
 *
 * Proves the 4-file jest kit + private DB + factories work BEFORE any feature
 * code exists: provisioning carries the P1–P3 schema, the helpers produce
 * coherent rows through the real FK/enum chains, timestamps round-trip in the
 * app-UTC domain, the (space_id, week_start) upsert key holds, and the
 * per-test reset isolates state. Later phases build on exactly these fixtures.
 */

describe("Dept Review harness smoke", () => {
    it("provisions the private DB with all P1–P3 schema objects", async () => {
        expect(Config.DB_NAME).toBe("tms_deptreview_test");

        const pool = getPool();
        const [tablesRaw] = await pool.query(
            `SELECT TABLE_NAME FROM information_schema.TABLES
             WHERE TABLE_SCHEMA = ? AND TABLE_NAME IN ('task_reviews','department_reports')`,
            [Config.DB_NAME],
        );
        const tableNames = (tablesRaw as Array<{ TABLE_NAME: string }>)
            .map((r) => r.TABLE_NAME)
            .sort();
        expect(tableNames).toEqual(["department_reports", "task_reviews"]);

        const [colsRaw] = await pool.query(
            `SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA = ?
               AND ((TABLE_NAME = 'spaces' AND COLUMN_NAME = 'head_user_id')
                 OR (TABLE_NAME = 'tasks' AND COLUMN_NAME IN ('review_status','reviewed_at','reviewed_by'))
                 OR (TABLE_NAME = 'notifications' AND COLUMN_NAME = 'type'))`,
            [Config.DB_NAME],
        );
        const cols = colsRaw as Array<{
            TABLE_NAME: string;
            COLUMN_NAME: string;
            COLUMN_TYPE: string;
        }>;
        expect(cols).toHaveLength(5);
        const notifType = cols.find((c) => c.TABLE_NAME === "notifications");
        expect(notifType?.COLUMN_TYPE).toContain("'task_reviewed'");
        expect(notifType?.COLUMN_TYPE).toContain("'report_ready'");
    });

    it("space-with-head + done-task factories produce coherent rows", async () => {
        const owner = await makeUser({ role: "owner" });
        const member = await makeUser({
            workspaceId: owner.workspaceId,
            role: "member",
        });
        const sp = await makeSpaceWithHead({
            workspaceId: owner.workspaceId,
            createdBy: owner.id,
        });
        const dl = await makeDeptList({
            workspaceId: owner.workspaceId,
            spaceId: sp.id,
            createdBy: owner.id,
        });
        const done = await makeDoneTask({
            workspaceId: owner.workspaceId,
            listId: dl.listId,
            doneStatusId: dl.doneStatusId,
            assigneeIds: [member.id],
            createdBy: owner.id,
        });

        const db = getDb();
        const [spaceRow] = await db
            .select({ headUserId: spaces.headUserId })
            .from(spaces)
            .where(eq(spaces.id, sp.id));
        expect(spaceRow.headUserId).toBe(sp.headUserId);

        const [taskRow] = await db
            .select({
                statusId: tasks.statusId,
                completedAt: tasks.completedAt,
                reviewStatus: tasks.reviewStatus,
            })
            .from(tasks)
            .where(eq(tasks.id, done.id));
        expect(taskRow.statusId).toBe(dl.doneStatusId);
        expect(taskRow.completedAt).not.toBeNull();
        expect(taskRow.reviewStatus).toBeNull();

        const assignees = await db
            .select({ userId: taskAssignees.userId })
            .from(taskAssignees)
            .where(eq(taskAssignees.taskId, done.id));
        expect(assignees.map((a) => a.userId)).toEqual([member.id]);
    });

    it("task_reviews round-trips through the enum + FK chain in the app-UTC domain", async () => {
        const owner = await makeUser({ role: "owner" });
        const sp = await makeSpaceWithHead({
            workspaceId: owner.workspaceId,
            createdBy: owner.id,
        });
        const dl = await makeDeptList({
            workspaceId: owner.workspaceId,
            spaceId: sp.id,
            createdBy: owner.id,
        });
        const done = await makeDoneTask({
            workspaceId: owner.workspaceId,
            listId: dl.listId,
            doneStatusId: dl.doneStatusId,
            createdBy: owner.id,
        });

        const written = new Date();
        const rev = await makeReview({
            workspaceId: owner.workspaceId,
            spaceId: sp.id,
            taskId: done.id,
            reviewerId: sp.headUserId,
            status: "flagged",
            note: "needs a re-check",
            createdAt: written,
        });
        await setTaskReviewDenorm(done.id, {
            reviewStatus: "flagged",
            reviewedAt: written,
            reviewedBy: sp.headUserId,
        });

        const db = getDb();
        const [row] = await db
            .select()
            .from(taskReviews)
            .where(eq(taskReviews.id, rev.id));
        expect(row.status).toBe("flagged");
        expect(row.note).toBe("needs a re-check");
        expect(row.reviewerId).toBe(sp.headUserId);
        // App-written bound Date must round-trip as the same instant (±2s for
        // second-precision truncation) — proves we are NOT in the DB-clock
        // domain (+6h would fail this hard).
        expect(
            Math.abs(row.createdAt.getTime() - written.getTime()),
        ).toBeLessThan(2000);

        const [taskRow] = await db
            .select({
                reviewStatus: tasks.reviewStatus,
                reviewedBy: tasks.reviewedBy,
            })
            .from(tasks)
            .where(eq(tasks.id, done.id));
        expect(taskRow.reviewStatus).toBe("flagged");
        expect(taskRow.reviewedBy).toBe(sp.headUserId);
    });

    it("department_reports round-trips JSON payload + string week dates, and the (space, week) unique key holds", async () => {
        const owner = await makeUser({ role: "owner" });
        const sp = await makeSpaceWithHead({
            workspaceId: owner.workspaceId,
            createdBy: owner.id,
        });

        const payload = {
            members: [{ user: null, completed: 2, flagged: 1 }],
            totals: { completed: 2, flagged: 1 },
        };
        const rep = await makeReport({
            workspaceId: owner.workspaceId,
            spaceId: sp.id,
            weekStart: "2026-07-13",
            weekEnd: "2026-07-19",
            headUserId: sp.headUserId,
            payload,
        });

        const db = getDb();
        const [row] = await db
            .select()
            .from(departmentReports)
            .where(eq(departmentReports.id, rep.id));
        expect(row.weekStart).toBe("2026-07-13");
        expect(row.weekEnd).toBe("2026-07-19");
        expect(row.payload).toEqual(payload);
        expect(row.notifiedAt).toBeNull();

        // Same (space, week) again → ER_DUP_ENTRY (the P19/P20 upsert key).
        await expect(
            makeReport({
                workspaceId: owner.workspaceId,
                spaceId: sp.id,
                weekStart: "2026-07-13",
                weekEnd: "2026-07-19",
            }),
        ).rejects.toMatchObject({ code: "ER_DUP_ENTRY" });

        // A different week for the same space is fine.
        await makeReport({
            workspaceId: owner.workspaceId,
            spaceId: sp.id,
            weekStart: "2026-07-20",
            weekEnd: "2026-07-26",
        });
    });

    it("starts empty — the per-test reset covers the new feature tables", async () => {
        const db = getDb();
        const reviews = await db
            .select({ id: taskReviews.id })
            .from(taskReviews);
        const reports = await db
            .select({ id: departmentReports.id })
            .from(departmentReports);
        expect(reviews).toHaveLength(0);
        expect(reports).toHaveLength(0);
    });
});
