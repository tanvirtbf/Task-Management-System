"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TaskDeleteRequestsRepo = void 0;
const drizzle_orm_1 = require("drizzle-orm");
const schema_1 = require("../db/schema");
/**
 * Data access for `task_delete_requests` (upgrades/023).
 *
 * Deliberately dumb: every rule (who may ask, who may approve, what approval
 * actually does) lives in `TaskDeleteRequestsService`. The one thing that is
 * here rather than there is the ATOMIC CLAIM — a decision has to be a single
 * conditional UPDATE, or two admins clicking Approve at the same moment both
 * "win" and the second one tries to delete a task that is already gone.
 */
class TaskDeleteRequestsRepo {
    db;
    constructor(db) {
        this.db = db;
    }
    async insert(row, exec = this.db) {
        const now = new Date();
        await exec.insert(schema_1.taskDeleteRequests).values({
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
    async findPendingByTask(taskId, exec = this.db) {
        const [row] = await exec
            .select()
            .from(schema_1.taskDeleteRequests)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.taskDeleteRequests.taskId, taskId), (0, drizzle_orm_1.eq)(schema_1.taskDeleteRequests.status, "pending")))
            .limit(1);
        return row ?? null;
    }
    /** Which of these tasks have a live request — for the list/board flag. */
    async pendingTaskIds(taskIds) {
        if (taskIds.length === 0)
            return new Set();
        const rows = await this.db
            .select({ taskId: schema_1.taskDeleteRequests.taskId })
            .from(schema_1.taskDeleteRequests)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.inArray)(schema_1.taskDeleteRequests.taskId, taskIds), (0, drizzle_orm_1.eq)(schema_1.taskDeleteRequests.status, "pending")));
        return new Set(rows.map((r) => r.taskId));
    }
    async findByIdInWorkspace(id, workspaceId, exec = this.db) {
        const [row] = await exec
            .select()
            .from(schema_1.taskDeleteRequests)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.taskDeleteRequests.id, id), (0, drizzle_orm_1.eq)(schema_1.taskDeleteRequests.workspaceId, workspaceId)))
            .limit(1);
        return row ?? null;
    }
    /**
     * THE ATOMIC CLAIM. Moves a request out of `pending` only if it is still
     * pending; returns false when someone else got there first. Every decision
     * path (approve, reject, cancel) goes through this — a double-click, two
     * admins, or a retry can never decide the same request twice.
     */
    async claim(input, exec = this.db) {
        // Drizzle+mysql2 returns [ResultSetHeader, FieldPacket[]] — the count
        // lives on the FIRST element. Reading `.affectedRows` off the array
        // itself yields `undefined`, which silently reads as "someone else
        // decided first" and makes every decision 409. Destructure.
        const [result] = await exec
            .update(schema_1.taskDeleteRequests)
            .set({
            status: input.status,
            decidedBy: input.decidedBy,
            decidedAt: new Date(),
            decisionNote: input.note,
            updatedAt: new Date(),
        })
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.taskDeleteRequests.id, input.id), (0, drizzle_orm_1.eq)(schema_1.taskDeleteRequests.status, "pending")));
        // With CLIENT_FOUND_ROWS, affectedRows counts MATCHED rows — but the
        // WHERE cannot match a non-pending row at all, so 0 here unambiguously
        // means "already decided".
        return result.affectedRows > 0;
    }
    /** Every live request in the workspace, newest first (the admin queue). */
    async listPending(workspaceId, limit = 50) {
        return this.db
            .select()
            .from(schema_1.taskDeleteRequests)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.taskDeleteRequests.workspaceId, workspaceId), (0, drizzle_orm_1.eq)(schema_1.taskDeleteRequests.status, "pending")))
            .orderBy((0, drizzle_orm_1.desc)(schema_1.taskDeleteRequests.internalId))
            .limit(limit);
    }
    /** The caller's own requests, any status — "what happened to my ask?" */
    async listByRequester(userId, workspaceId, limit = 50) {
        return this.db
            .select()
            .from(schema_1.taskDeleteRequests)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.taskDeleteRequests.workspaceId, workspaceId), (0, drizzle_orm_1.eq)(schema_1.taskDeleteRequests.requestedBy, userId)))
            .orderBy((0, drizzle_orm_1.desc)(schema_1.taskDeleteRequests.internalId))
            .limit(limit);
    }
}
exports.TaskDeleteRequestsRepo = TaskDeleteRequestsRepo;
