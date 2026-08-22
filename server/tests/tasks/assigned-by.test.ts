import { readFileSync } from "node:fs";
import path from "node:path";
import { eq, inArray } from "drizzle-orm";
import {
    makeWorkspace,
    makeUser,
    makeList,
    makeStatus,
    makeTaskType,
    makeTask,
} from "../test-utils/factories";
import { getDb } from "../../src/db/client";
import { tasks, taskAssignees } from "../../src/db/schema";

/**
 * ASSIGNED_BY_PLAN P1 — `tasks.assigned_by` (upgrades/025).
 *
 * Two things are pinned here.
 *
 * 1. The COLUMN reaches the app: it is on the Drizzle table, so it is on
 *    `TaskRow`, so every one of the eight services that feed `toWireTask` can
 *    read it in P3 without touching a query.
 *
 * 2. The BACKFILL RULE (decision D2): the earliest real assigner wins, and
 *    `created_by` is the fallback. This matters far more than it looks — the
 *    office has been assigning work since V1 and `task_assignees.assigned_by`
 *    has quietly recorded WHO all along (46/46 rows populated in dev, zero
 *    nulls). Getting the rule wrong would not "miss a feature", it would
 *    rewrite real history as "the creator did it".
 *
 * The backfill is not re-typed here: the UPDATE is EXTRACTED FROM THE SHIPPED
 * SCRIPT, so these tests exercise the statement production will actually run,
 * and editing the script without re-reading these expectations breaks the
 * build rather than silently changing what the office sees.
 */

jest.setTimeout(60_000);

// ─── the statement under test, taken from the real upgrade file ─────────────

const UPGRADE_PATH = path.join(
    __dirname,
    "../../../database/upgrades/025_assigned_by.sql",
);

/** The single UPDATE from `025_assigned_by.sql`, comments stripped. */
const backfillStatement = (): string => {
    const raw = readFileSync(UPGRADE_PATH, "utf8");
    const body = raw
        .split("\n")
        .filter((line) => !line.trim().startsWith("--"))
        .join("\n");
    const update = body
        .split(";")
        .map((s) => s.trim())
        .find((s) => s.toUpperCase().startsWith("UPDATE TASKS"));
    if (!update) {
        throw new Error(
            "025_assigned_by.sql no longer contains an `UPDATE tasks` statement — " +
                "if the backfill moved, move this test with it.",
        );
    }
    return update;
};

const runBackfill = async (): Promise<void> => {
    await getDb().execute(backfillStatement());
};

/** Read the column straight back through Drizzle (i.e. through `TaskRow`). */
const assignedByOf = async (taskId: string): Promise<string | null> => {
    const [row] = await getDb()
        .select({ assignedBy: tasks.assignedBy })
        .from(tasks)
        .where(eq(tasks.id, taskId));
    return row?.assignedBy ?? null;
};

const clearAssignedBy = async (ids: string[]): Promise<void> => {
    await getDb()
        .update(tasks)
        .set({ assignedBy: null })
        .where(inArray(tasks.id, ids));
};

/**
 * One workspace with a list/status/type ready to hang tasks off, plus three
 * people: the person who creates records, the manager who hands work out, and
 * someone to receive it.
 */
const scene = async () => {
    const ws = await makeWorkspace();
    const creator = await makeUser({ workspaceId: ws.id });
    const manager = await makeUser({ workspaceId: ws.id });
    const worker = await makeUser({ workspaceId: ws.id });
    const list = await makeList({ workspaceId: ws.id, createdBy: creator.id });
    const status = await makeStatus({ scopeId: list.id });
    const type = await makeTaskType({ workspaceId: ws.id });
    const newTask = async () =>
        makeTask({
            workspaceId: ws.id,
            createdBy: creator.id,
            listId: list.id,
            statusId: status.id,
            taskTypeId: type.id,
        });
    const assign = async (
        taskId: string,
        userId: string,
        assignedBy: string | null,
        assignedAt?: Date,
    ) => {
        await getDb()
            .insert(taskAssignees)
            .values({
                taskId,
                userId,
                assignedBy,
                ...(assignedAt ? { assignedAt } : {}),
            });
    };
    return { ws, creator, manager, worker, list, status, type, newTask, assign };
};

// ════════════════════════════════════════════════════════════════════════════
describe("tasks.assigned_by (upgrades/025)", () => {
    // ─── a. the column is real and reaches the app ───────────────────────────
    describe("the column", () => {
        it("is selectable through Drizzle, so it is on TaskRow", async () => {
            const s = await scene();
            const task = await s.newTask();

            // Not `undefined` — the property exists. Null is the correct value
            // for a factory-inserted row until P2 teaches the write path.
            expect(await assignedByOf(task.id)).toBeNull();
        });

        it("accepts a value and reads it back unchanged", async () => {
            const s = await scene();
            const task = await s.newTask();

            await getDb()
                .update(tasks)
                .set({ assignedBy: s.manager.id })
                .where(eq(tasks.id, task.id));

            expect(await assignedByOf(task.id)).toBe(s.manager.id);
        });
    });

    // ─── b. the backfill rule (D2) ───────────────────────────────────────────
    describe("backfill", () => {
        it("keeps the REAL assigner when it is not the creator", async () => {
            const s = await scene();
            const task = await s.newTask();
            // The manager handed the work to the worker — the creator of the
            // record was somebody else entirely. This is the whole point.
            await s.assign(task.id, s.worker.id, s.manager.id);
            await clearAssignedBy([task.id]);

            await runBackfill();

            expect(await assignedByOf(task.id)).toBe(s.manager.id);
            expect(await assignedByOf(task.id)).not.toBe(task.createdBy);
        });

        it("takes the EARLIEST assigner when a task was handed on twice", async () => {
            const s = await scene();
            const task = await s.newTask();
            const later = await makeUser({ workspaceId: s.ws.id });
            await s.assign(
                task.id,
                s.worker.id,
                s.manager.id,
                new Date("2026-01-01T10:00:00Z"),
            );
            await s.assign(
                task.id,
                later.id,
                s.creator.id,
                new Date("2026-06-01T10:00:00Z"),
            );
            await clearAssignedBy([task.id]);

            await runBackfill();

            // Who STARTED the hand-off, not who touched it last.
            expect(await assignedByOf(task.id)).toBe(s.manager.id);
        });

        it("falls back to created_by when the task was never assigned", async () => {
            const s = await scene();
            const task = await s.newTask();
            await clearAssignedBy([task.id]);

            await runBackfill();

            expect(await assignedByOf(task.id)).toBe(task.createdBy);
        });

        it("falls back to created_by when the assignee row has no assigner", async () => {
            const s = await scene();
            const task = await s.newTask();
            // Legacy shape: `assigned_by` is NULLable and old rows may predate
            // it being written. The COALESCE has to see through that.
            await s.assign(task.id, s.worker.id, null);
            await clearAssignedBy([task.id]);

            await runBackfill();

            expect(await assignedByOf(task.id)).toBe(task.createdBy);
        });

        it("leaves NOTHING unattributed (doctrine #2)", async () => {
            const s = await scene();
            const assigned = await s.newTask();
            const bare = await s.newTask();
            const nullAssigner = await s.newTask();
            await s.assign(assigned.id, s.worker.id, s.manager.id);
            await s.assign(nullAssigner.id, s.worker.id, null);
            const ids = [assigned.id, bare.id, nullAssigner.id];
            await clearAssignedBy(ids);

            await runBackfill();

            const rows = await getDb()
                .select({ id: tasks.id, assignedBy: tasks.assignedBy })
                .from(tasks)
                .where(inArray(tasks.id, ids));
            expect(rows).toHaveLength(3);
            expect(rows.filter((r) => r.assignedBy === null)).toHaveLength(0);
        });

        it("never overwrites a value that is already set", async () => {
            const s = await scene();
            const task = await s.newTask();
            // A correction someone made by hand (what P5 will do properly).
            // The backfill's WHERE clause must not undo it — which is what
            // makes re-running the upgrade script safe.
            await s.assign(task.id, s.worker.id, s.manager.id);
            await getDb()
                .update(tasks)
                .set({ assignedBy: s.creator.id })
                .where(eq(tasks.id, task.id));

            await runBackfill();
            await runBackfill();

            expect(await assignedByOf(task.id)).toBe(s.creator.id);
        });
    });

    // ─── c. the foreign key's shape ──────────────────────────────────────────
    describe("the foreign key", () => {
        it("NULLs the attribution when the assigner is deleted, keeping the task", async () => {
            const s = await scene();
            const task = await s.newTask();
            await getDb()
                .update(tasks)
                .set({ assignedBy: s.manager.id })
                .where(eq(tasks.id, task.id));

            // A manager leaves. `created_by` is RESTRICT and would block this;
            // attribution must never be the reason a leaver cannot be removed.
            await getDb().execute(
                `DELETE FROM users WHERE id = '${s.manager.id}'`,
            );

            const [row] = await getDb()
                .select({ id: tasks.id, assignedBy: tasks.assignedBy })
                .from(tasks)
                .where(eq(tasks.id, task.id));
            expect(row).toBeDefined();
            expect(row.assignedBy).toBeNull();
        });
    });
});
