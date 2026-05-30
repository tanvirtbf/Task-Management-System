import { and, eq, sql } from "drizzle-orm";
import { MySql2Database } from "drizzle-orm/mysql2";
import * as schema from "../db/schema";
import { taskAssignees, taskWatchers } from "../db/schema";
import type { DbExecutor } from "./types";

/**
 * Data access for a task's membership junctions (`task_assignees`,
 * `task_watchers`). Tag membership (`task_tags`) will join here when §11's tag
 * endpoints are built.
 */
export class TaskMembershipRepo {
    constructor(private db: MySql2Database<typeof schema>) {}

    /** Current assignee user ids for a task. Pass `exec` to read inside a tx. */
    async getAssigneeIds(
        taskId: string,
        exec: DbExecutor = this.db,
    ): Promise<string[]> {
        const rows = await exec
            .select({ userId: taskAssignees.userId })
            .from(taskAssignees)
            .where(eq(taskAssignees.taskId, taskId));
        return rows.map((r) => r.userId);
    }

    /**
     * Insert assignee rows. The `ON DUPLICATE KEY UPDATE` no-op makes a
     * concurrent re-insert of the same `(task_id, user_id)` a harmless no-op
     * instead of a duplicate-key error.
     */
    async addAssignees(
        taskId: string,
        userIds: string[],
        assignedBy: string,
        exec: DbExecutor = this.db,
    ): Promise<void> {
        if (userIds.length === 0) return;
        await exec
            .insert(taskAssignees)
            .values(userIds.map((userId) => ({ taskId, userId, assignedBy })))
            .onDuplicateKeyUpdate({
                set: { assignedBy: sql`${taskAssignees.assignedBy}` },
            });
    }

    /**
     * Auto-watch: assignees watch the task. Idempotent via the
     * `(task_id, user_id)` primary key.
     */
    async addWatchers(
        taskId: string,
        userIds: string[],
        exec: DbExecutor = this.db,
    ): Promise<void> {
        if (userIds.length === 0) return;
        await exec
            .insert(taskWatchers)
            .values(userIds.map((userId) => ({ taskId, userId })))
            .onDuplicateKeyUpdate({
                set: { startedAt: sql`${taskWatchers.startedAt}` },
            });
    }

    /**
     * Watch a task for a single user (the `/watchers/self` endpoint). Idempotent
     * via the `(task_id, user_id)` primary key. Returns `true` when a new row
     * was inserted, `false` on a re-watch no-op — MySQL reports `affectedRows`
     * of 1 for an insert and 0 when the `ON DUPLICATE KEY UPDATE` sets the
     * existing `started_at` to its current value.
     */
    async addWatcher(
        taskId: string,
        userId: string,
        exec: DbExecutor = this.db,
    ): Promise<boolean> {
        const [result] = await exec
            .insert(taskWatchers)
            .values({ taskId, userId })
            .onDuplicateKeyUpdate({
                set: { startedAt: sql`${taskWatchers.startedAt}` },
            });
        return result.affectedRows === 1;
    }

    /**
     * Delete a single assignee row. A no-op (zero rows affected) when the user
     * is not assigned — the caller decides whether anything actually changed by
     * checking the current set under the task lock first, mirroring how
     * `addAssignees` diffs against `getAssigneeIds`.
     */
    async removeAssignee(
        taskId: string,
        userId: string,
        exec: DbExecutor = this.db,
    ): Promise<void> {
        await exec
            .delete(taskAssignees)
            .where(
                and(
                    eq(taskAssignees.taskId, taskId),
                    eq(taskAssignees.userId, userId),
                ),
            );
    }
}
