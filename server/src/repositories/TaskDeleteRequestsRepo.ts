import { and, desc, eq, inArray } from "drizzle-orm";
import { MySql2Database } from "drizzle-orm/mysql2";
import * as schema from "../db/schema";
import { taskDeleteRequests } from "../db/schema";
import type { TaskDeleteRequest } from "../db/schema";
import type { DbExecutor } from "./types";

/**
 * Data access for `task_delete_requests` (upgrades/023).
 *
 * Deliberately dumb: every rule (who may ask, who may approve, what approval
 * actually does) lives in `TaskDeleteRequestsService`. The one thing that is
 * here rather than there is the ATOMIC CLAIM — a decision has to be a single
 * conditional UPDATE, or two admins clicking Approve at the same moment both
 * "win" and the second one tries to delete a task that is already gone.
 */
export class TaskDeleteRequestsRepo {
    constructor(private db: MySql2Database<typeof schema>) {}

    async insert(
        row: {
            id: string;
            workspaceId: string;
            spaceId: string;
            taskId: string;
            taskName: string;
            requestedBy: string;
            reason: string | null;
        },
        exec: DbExecutor = this.db,
    ): Promise<void> {
        const now = new Date();
        await exec.insert(taskDeleteRequests).values({
            ...row,
            status: "pending",
            createdAt: now,
            updatedAt: now,
        });
    }

    /**
     * The pending request for a task, if any.
     *
     * ⚠️ Callers that are about to INSERT must run this inside the same
     * transaction, under the task's row lock. `ON DUPLICATE KEY` cannot be used
     * to detect the duplicate here: with mysql2's CLIENT_FOUND_ROWS flag
     * `affectedRows` is ambiguous, which is exactly how the assignment-request
     * build (P8) shipped a bug. Pre-SELECT, then insert.
     */
    async findPendingByTask(
        taskId: string,
        exec: DbExecutor = this.db,
    ): Promise<TaskDeleteRequest | null> {
        const [row] = await exec
            .select()
            .from(taskDeleteRequests)
            .where(
                and(
                    eq(taskDeleteRequests.taskId, taskId),
                    eq(taskDeleteRequests.status, "pending"),
                ),
            )
            .limit(1);
        return row ?? null;
    }

    /** Which of these tasks have a live request — for the list/board flag. */
    async pendingTaskIds(taskIds: string[]): Promise<Set<string>> {
        if (taskIds.length === 0) return new Set();
        const rows = await this.db
            .select({ taskId: taskDeleteRequests.taskId })
            .from(taskDeleteRequests)
            .where(
                and(
                    inArray(taskDeleteRequests.taskId, taskIds),
                    eq(taskDeleteRequests.status, "pending"),
                ),
            );
        return new Set(rows.map((r) => r.taskId));
    }

    async findByIdInWorkspace(
        id: string,
        workspaceId: string,
        exec: DbExecutor = this.db,
    ): Promise<TaskDeleteRequest | null> {
        const [row] = await exec
            .select()
            .from(taskDeleteRequests)
            .where(
                and(
                    eq(taskDeleteRequests.id, id),
                    eq(taskDeleteRequests.workspaceId, workspaceId),
                ),
            )
            .limit(1);
        return row ?? null;
    }

    /**
     * THE ATOMIC CLAIM. Moves a request out of `pending` only if it is still
     * pending; returns false when someone else got there first. Every decision
     * path (approve, reject, cancel) goes through this — a double-click, two
     * admins, or a retry can never decide the same request twice.
     */
    async claim(
        input: {
            id: string;
            status: "approved" | "rejected" | "cancelled";
            decidedBy: string;
            note: string | null;
        },
        exec: DbExecutor = this.db,
    ): Promise<boolean> {
        // Drizzle+mysql2 returns [ResultSetHeader, FieldPacket[]] — the count
        // lives on the FIRST element. Reading `.affectedRows` off the array
        // itself yields `undefined`, which silently reads as "someone else
        // decided first" and makes every decision 409. Destructure.
        const [result] = await exec
            .update(taskDeleteRequests)
            .set({
                status: input.status,
                decidedBy: input.decidedBy,
                decidedAt: new Date(),
                decisionNote: input.note,
                updatedAt: new Date(),
            })
            .where(
                and(
                    eq(taskDeleteRequests.id, input.id),
                    eq(taskDeleteRequests.status, "pending"),
                ),
            );
        // With CLIENT_FOUND_ROWS, affectedRows counts MATCHED rows — but the
        // WHERE cannot match a non-pending row at all, so 0 here unambiguously
        // means "already decided".
        return result.affectedRows > 0;
    }

    /** Every live request in the workspace, newest first (the admin queue). */
    async listPending(
        workspaceId: string,
        limit = 50,
    ): Promise<TaskDeleteRequest[]> {
        return this.db
            .select()
            .from(taskDeleteRequests)
            .where(
                and(
                    eq(taskDeleteRequests.workspaceId, workspaceId),
                    eq(taskDeleteRequests.status, "pending"),
                ),
            )
            .orderBy(desc(taskDeleteRequests.internalId))
            .limit(limit);
    }

    /** The caller's own requests, any status — "what happened to my ask?" */
    async listByRequester(
        userId: string,
        workspaceId: string,
        limit = 50,
    ): Promise<TaskDeleteRequest[]> {
        return this.db
            .select()
            .from(taskDeleteRequests)
            .where(
                and(
                    eq(taskDeleteRequests.workspaceId, workspaceId),
                    eq(taskDeleteRequests.requestedBy, userId),
                ),
            )
            .orderBy(desc(taskDeleteRequests.internalId))
            .limit(limit);
    }
}
