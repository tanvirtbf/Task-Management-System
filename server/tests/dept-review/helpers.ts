import { eq } from "drizzle-orm";
import { getDb } from "../../src/db/client";
import {
    departmentReports,
    spaces,
    taskAssignees,
    taskReviews,
    tasks,
} from "../../src/db/schema";
import { fakeId } from "../../src/utils";
import {
    makeList,
    makeSpace,
    makeStatus,
    makeTask,
    makeUser,
} from "../test-utils/factories";
import { utcDate } from "../test-utils/dates";

/**
 * Dept Review V1 test helpers (DEPARTMENT_REVIEW_PLAN.md P4).
 *
 * Built ON TOP of the shared factories: every row is a real Drizzle insert (no
 * mocks). Direct column writes are used ONLY where the owning API phase has not
 * shipped yet (e.g. `spaces.head_user_id` before P5, review-denorm before P8) —
 * once those phases land, their endpoint tests exercise the real flows and
 * these helpers keep seeding read-side fixtures cheaply.
 *
 * Clock-domain rule (plan §5.3): every timestamp seeded here is an app-written
 * UTC `new Date()` bound param — never SQL NOW().
 */

// ─── space with a head ───────────────────────────────────────────────────────

export interface MakeSpaceWithHeadInput {
    workspaceId: string;
    /** Omit to create a fresh active member in the workspace as the head. */
    headUserId?: string;
    createdBy?: string;
    name?: string;
    archivedAt?: Date | null;
}

/**
 * Create a space and set its `head_user_id` (direct column write until the P5
 * PATCH endpoint ships). Returns the head's id alongside the space ids.
 */
export const makeSpaceWithHead = async (input: MakeSpaceWithHeadInput) => {
    const db = getDb();
    const headUserId =
        input.headUserId ??
        (await makeUser({ workspaceId: input.workspaceId })).id;
    const space = await makeSpace({
        workspaceId: input.workspaceId,
        createdBy: input.createdBy,
        name: input.name,
        archivedAt: input.archivedAt ?? null,
    });
    await db
        .update(spaces)
        .set({ headUserId })
        .where(eq(spaces.id, space.id));
    return { ...space, headUserId };
};

// ─── department list with a real status pair ─────────────────────────────────

export interface MakeDeptListInput {
    workspaceId: string;
    spaceId: string;
    createdBy?: string;
    name?: string;
}

/**
 * Create a list inside a department space with a REAL status pair (one
 * `active`-group + one `done`-group status), mirroring how production lists
 * resolve done-ness (live `statuses.status_group` — the D-4 authority). Tests
 * derive done-tasks from `doneStatusId`, never from a magic flag.
 */
export const makeDeptList = async (input: MakeDeptListInput) => {
    const list = await makeList({
        workspaceId: input.workspaceId,
        spaceId: input.spaceId,
        createdBy: input.createdBy,
        name: input.name,
    });
    const active = await makeStatus({
        scopeId: list.id,
        statusGroup: "active",
        name: `In Progress ${fakeId("x").slice(2, 8)}`,
    });
    const done = await makeStatus({
        scopeId: list.id,
        statusGroup: "done",
        name: `Done ${fakeId("x").slice(2, 8)}`,
    });
    return {
        listId: list.id,
        spaceId: input.spaceId,
        activeStatusId: active.id,
        doneStatusId: done.id,
    };
};

// ─── done task (real status flow) ────────────────────────────────────────────

export interface MakeDoneTaskInput {
    workspaceId: string;
    listId: string;
    /** A done-group status of `listId` (from makeDeptList). */
    doneStatusId: string;
    assigneeIds?: string[];
    createdBy?: string;
    name?: string;
    /** App-UTC completion instant; defaults to now. */
    completedAt?: Date;
    dueDate?: string; // YYYY-MM-DD
    archivedAt?: Date | null;
}

/**
 * Create a task sitting on a done-group status with `completed_at` set
 * (app-written UTC) — the state that enters the head's review queue. Optional
 * assignees are attached (department membership is assignee-derived, D-2).
 */
/** "YYYY-MM-DD" → UTC-midnight Date. See `test-utils/dates.ts` for why a DATE
 *  fixture must never be built at LOCAL midnight (F3). */
const toLocalDate = utcDate;

export const makeDoneTask = async (input: MakeDoneTaskInput) => {
    const db = getDb();
    const task = await makeTask({
        workspaceId: input.workspaceId,
        listId: input.listId,
        statusId: input.doneStatusId,
        createdBy: input.createdBy,
        name: input.name,
        archivedAt: input.archivedAt ?? null,
    });
    const completedAt = input.completedAt ?? new Date();
    await db
        .update(tasks)
        .set({
            completedAt,
            ...(input.dueDate !== undefined
                ? { dueDate: toLocalDate(input.dueDate) }
                : {}),
        })
        .where(eq(tasks.id, task.id));
    for (const userId of input.assigneeIds ?? []) {
        await db.insert(taskAssignees).values({ taskId: task.id, userId });
    }
    return { ...task, completedAt, assigneeIds: input.assigneeIds ?? [] };
};

// ─── review ledger rows ──────────────────────────────────────────────────────

export interface MakeReviewInput {
    workspaceId: string;
    spaceId: string;
    taskId: string;
    reviewerId: string;
    status?: "approved" | "flagged";
    note?: string | null;
    /** App-UTC review instant; defaults to now. */
    createdAt?: Date;
}

/**
 * Insert a `task_reviews` ledger row (history only — does NOT touch the task's
 * denorm columns; that is P8 service behaviour). Use `setTaskReviewDenorm` when
 * a read-side test needs the current-state columns too.
 */
export const makeReview = async (input: MakeReviewInput) => {
    const db = getDb();
    const id = fakeId("rev");
    const createdAt = input.createdAt ?? new Date();
    const status = input.status ?? "approved";
    await db.insert(taskReviews).values({
        id,
        workspaceId: input.workspaceId,
        spaceId: input.spaceId,
        taskId: input.taskId,
        reviewerId: input.reviewerId,
        status,
        note: input.note ?? null,
        createdAt,
    });
    return { id, status, createdAt };
};

/** Mirror the P8 denorm write for fixtures (same-tx in production). */
export const setTaskReviewDenorm = async (
    taskId: string,
    denorm: {
        reviewStatus: "approved" | "flagged" | null;
        reviewedAt?: Date | null;
        reviewedBy?: string | null;
    },
) => {
    const db = getDb();
    await db
        .update(tasks)
        .set({
            reviewStatus: denorm.reviewStatus,
            reviewedAt: denorm.reviewedAt ?? null,
            reviewedBy: denorm.reviewedBy ?? null,
        })
        .where(eq(tasks.id, taskId));
};

// ─── department reports ──────────────────────────────────────────────────────

export interface MakeReportInput {
    workspaceId: string;
    spaceId: string;
    /** Dhaka-calendar Monday, YYYY-MM-DD. */
    weekStart?: string;
    /** Dhaka-calendar Sunday, YYYY-MM-DD. */
    weekEnd?: string;
    headUserId?: string | null;
    headNote?: string | null;
    payload?: Record<string, unknown>;
    generatedBy?: string | null;
    generatedAt?: Date;
    notifiedAt?: Date | null;
    acknowledgedBy?: string | null;
    acknowledgedAt?: Date | null;
}

/**
 * Insert a `department_reports` row. Defaults to the 2026-07-13→19 week with an
 * empty payload. UNIQUE on (space_id, week_start) — pass distinct weeks to seed
 * several reports for one space.
 */
export const makeReport = async (input: MakeReportInput) => {
    const db = getDb();
    const id = fakeId("rep");
    const weekStart = input.weekStart ?? "2026-07-13";
    const weekEnd = input.weekEnd ?? "2026-07-19";
    await db.insert(departmentReports).values({
        id,
        workspaceId: input.workspaceId,
        spaceId: input.spaceId,
        weekStart,
        weekEnd,
        headUserId: input.headUserId ?? null,
        headNote: input.headNote ?? null,
        payload: input.payload ?? {},
        generatedBy: input.generatedBy ?? null,
        generatedAt: input.generatedAt ?? new Date(),
        notifiedAt: input.notifiedAt ?? null,
        acknowledgedBy: input.acknowledgedBy ?? null,
        acknowledgedAt: input.acknowledgedAt ?? null,
    });
    return { id, weekStart, weekEnd, spaceId: input.spaceId };
};
