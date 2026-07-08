import { and, eq, inArray, sql } from "drizzle-orm";
import { MySql2Database } from "drizzle-orm/mysql2";
import * as schema from "../db/schema";
import { taskAssignees, taskTags, taskWatchers } from "../db/schema";
import type { DbExecutor } from "./types";

/**
 * Data access for a task's membership junctions (`task_assignees`,
 * `task_watchers`, `task_tags`). Used by the §10 task writes (create / update /
 * bulk) and the §11 membership endpoints.
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
     * Stop watching a task for a single user (the `/watchers/self` DELETE).
     * Idempotent: a no-op (returns `false`) when the user is not currently
     * watching. Mirrors `addWatcher`'s boolean contract (`true` = a row was
     * actually removed) so the service can report whether anything changed.
     */
    async removeWatcher(
        taskId: string,
        userId: string,
        exec: DbExecutor = this.db,
    ): Promise<boolean> {
        const [result] = await exec
            .delete(taskWatchers)
            .where(
                and(
                    eq(taskWatchers.taskId, taskId),
                    eq(taskWatchers.userId, userId),
                ),
            );
        return result.affectedRows > 0;
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

    /** Bulk-remove assignees (used by #5 update / #10 bulk assignee diffs). */
    async removeAssignees(
        taskId: string,
        userIds: string[],
        exec: DbExecutor = this.db,
    ): Promise<void> {
        if (userIds.length === 0) return;
        await exec
            .delete(taskAssignees)
            .where(
                and(
                    eq(taskAssignees.taskId, taskId),
                    inArray(taskAssignees.userId, userIds),
                ),
            );
    }

    /** Current tag ids on a task. Pass `exec` to read inside a tx. */
    async getTagIds(
        taskId: string,
        exec: DbExecutor = this.db,
    ): Promise<string[]> {
        const rows = await exec
            .select({ tagId: taskTags.tagId })
            .from(taskTags)
            .where(eq(taskTags.taskId, taskId));
        return rows.map((r) => r.tagId);
    }

    /**
     * Insert task↔tag rows. Idempotent via the `(task_id, tag_id)` primary key —
     * a concurrent re-insert of the same pair is a harmless no-op.
     */
    async addTags(
        taskId: string,
        tagIds: string[],
        exec: DbExecutor = this.db,
    ): Promise<void> {
        if (tagIds.length === 0) return;
        await exec
            .insert(taskTags)
            .values(tagIds.map((tagId) => ({ taskId, tagId })))
            .onDuplicateKeyUpdate({
                set: { addedAt: sql`${taskTags.addedAt}` },
            });
    }

    /** Bulk-remove task↔tag rows (used by #5 update / #10 bulk tag diffs). */
    async removeTags(
        taskId: string,
        tagIds: string[],
        exec: DbExecutor = this.db,
    ): Promise<void> {
        if (tagIds.length === 0) return;
        await exec
            .delete(taskTags)
            .where(
                and(
                    eq(taskTags.taskId, taskId),
                    inArray(taskTags.tagId, tagIds),
                ),
            );
    }

    // ─── Bulk operations (multiple tasks at once) ─────────────────────────────

    /** Add assignees to multiple tasks in one query (avoid N+1 in bulk updates). */
    async addAssigneesBulk(
        taskIds: string[],
        userIds: string[],
        assignedBy: string,
        exec: DbExecutor = this.db,
    ): Promise<void> {
        if (taskIds.length === 0 || userIds.length === 0) return;
        const values = taskIds.flatMap((taskId) =>
            userIds.map((userId) => ({ taskId, userId, assignedBy })),
        );
        await exec
            .insert(taskAssignees)
            .values(values)
            .onDuplicateKeyUpdate({
                set: { assignedBy: sql`${taskAssignees.assignedBy}` },
            });
    }

    /** Add watchers to multiple tasks in one query (avoid N+1 in bulk updates). */
    async addWatchersBulk(
        taskIds: string[],
        userIds: string[],
        exec: DbExecutor = this.db,
    ): Promise<void> {
        if (taskIds.length === 0 || userIds.length === 0) return;
        const values = taskIds.flatMap((taskId) =>
            userIds.map((userId) => ({ taskId, userId })),
        );
        await exec
            .insert(taskWatchers)
            .values(values)
            .onDuplicateKeyUpdate({
                set: { startedAt: sql`${taskWatchers.startedAt}` },
            });
    }

    /** Add tags to multiple tasks in one query (avoid N+1 in bulk updates). */
    async addTagsBulk(
        taskIds: string[],
        tagIds: string[],
        exec: DbExecutor = this.db,
    ): Promise<void> {
        if (taskIds.length === 0 || tagIds.length === 0) return;
        const values = taskIds.flatMap((taskId) =>
            tagIds.map((tagId) => ({ taskId, tagId })),
        );
        await exec
            .insert(taskTags)
            .values(values)
            .onDuplicateKeyUpdate({
                set: { addedAt: sql`${taskTags.addedAt}` },
            });
    }

    /** Remove assignees from multiple tasks in one query (avoid N+1 in bulk updates). */
    async removeAssigneesBulk(
        taskIds: string[],
        userIds: string[],
        exec: DbExecutor = this.db,
    ): Promise<void> {
        if (taskIds.length === 0 || userIds.length === 0) return;
        await exec
            .delete(taskAssignees)
            .where(
                and(
                    inArray(taskAssignees.taskId, taskIds),
                    inArray(taskAssignees.userId, userIds),
                ),
            );
    }

    /** Remove tags from multiple tasks in one query (avoid N+1 in bulk updates). */
    async removeTagsBulk(
        taskIds: string[],
        tagIds: string[],
        exec: DbExecutor = this.db,
    ): Promise<void> {
        if (taskIds.length === 0 || tagIds.length === 0) return;
        await exec
            .delete(taskTags)
            .where(
                and(
                    inArray(taskTags.taskId, taskIds),
                    inArray(taskTags.tagId, tagIds),
                ),
            );
    }
}
