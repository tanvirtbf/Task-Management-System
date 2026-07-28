"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TaskMembershipRepo = void 0;
const drizzle_orm_1 = require("drizzle-orm");
const schema_1 = require("../db/schema");
/**
 * Data access for a task's membership junctions (`task_assignees`,
 * `task_watchers`, `task_tags`). Used by the §10 task writes (create / update /
 * bulk) and the §11 membership endpoints.
 */
class TaskMembershipRepo {
    db;
    constructor(db) {
        this.db = db;
    }
    /** Current assignee user ids for a task. Pass `exec` to read inside a tx. */
    async getAssigneeIds(taskId, exec = this.db) {
        const rows = await exec
            .select({ userId: schema_1.taskAssignees.userId })
            .from(schema_1.taskAssignees)
            .where((0, drizzle_orm_1.eq)(schema_1.taskAssignees.taskId, taskId));
        return rows.map((r) => r.userId);
    }
    /**
     * Insert assignee rows. The `ON DUPLICATE KEY UPDATE` no-op makes a
     * concurrent re-insert of the same `(task_id, user_id)` a harmless no-op
     * instead of a duplicate-key error.
     */
    async addAssignees(taskId, userIds, assignedBy, exec = this.db) {
        if (userIds.length === 0)
            return;
        await exec
            .insert(schema_1.taskAssignees)
            .values(userIds.map((userId) => ({ taskId, userId, assignedBy })))
            .onDuplicateKeyUpdate({
            set: { assignedBy: (0, drizzle_orm_1.sql) `${schema_1.taskAssignees.assignedBy}` },
        });
    }
    /**
     * Auto-watch: assignees watch the task. Idempotent via the
     * `(task_id, user_id)` primary key.
     */
    async addWatchers(taskId, userIds, exec = this.db) {
        if (userIds.length === 0)
            return;
        await exec
            .insert(schema_1.taskWatchers)
            .values(userIds.map((userId) => ({ taskId, userId })))
            .onDuplicateKeyUpdate({
            set: { startedAt: (0, drizzle_orm_1.sql) `${schema_1.taskWatchers.startedAt}` },
        });
    }
    /**
     * Watch a task for a single user (the `/watchers/self` endpoint). Idempotent
     * via the `(task_id, user_id)` primary key. Returns `true` when a new row
     * was inserted, `false` on a re-watch no-op — MySQL reports `affectedRows`
     * of 1 for an insert and 0 when the `ON DUPLICATE KEY UPDATE` sets the
     * existing `started_at` to its current value.
     */
    async addWatcher(taskId, userId, exec = this.db) {
        const [result] = await exec
            .insert(schema_1.taskWatchers)
            .values({ taskId, userId })
            .onDuplicateKeyUpdate({
            set: { startedAt: (0, drizzle_orm_1.sql) `${schema_1.taskWatchers.startedAt}` },
        });
        return result.affectedRows === 1;
    }
    /**
     * Stop watching a task for a single user (the `/watchers/self` DELETE).
     * Idempotent: a no-op (returns `false`) when the user is not currently
     * watching. Mirrors `addWatcher`'s boolean contract (`true` = a row was
     * actually removed) so the service can report whether anything changed.
     */
    async removeWatcher(taskId, userId, exec = this.db) {
        const [result] = await exec
            .delete(schema_1.taskWatchers)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.taskWatchers.taskId, taskId), (0, drizzle_orm_1.eq)(schema_1.taskWatchers.userId, userId)));
        return result.affectedRows > 0;
    }
    /**
     * Delete a single assignee row. A no-op (zero rows affected) when the user
     * is not assigned — the caller decides whether anything actually changed by
     * checking the current set under the task lock first, mirroring how
     * `addAssignees` diffs against `getAssigneeIds`.
     */
    async removeAssignee(taskId, userId, exec = this.db) {
        await exec
            .delete(schema_1.taskAssignees)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.taskAssignees.taskId, taskId), (0, drizzle_orm_1.eq)(schema_1.taskAssignees.userId, userId)));
    }
    /** Bulk-remove assignees (used by #5 update / #10 bulk assignee diffs). */
    async removeAssignees(taskId, userIds, exec = this.db) {
        if (userIds.length === 0)
            return;
        await exec
            .delete(schema_1.taskAssignees)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.taskAssignees.taskId, taskId), (0, drizzle_orm_1.inArray)(schema_1.taskAssignees.userId, userIds)));
    }
    /** Current tag ids on a task. Pass `exec` to read inside a tx. */
    async getTagIds(taskId, exec = this.db) {
        const rows = await exec
            .select({ tagId: schema_1.taskTags.tagId })
            .from(schema_1.taskTags)
            .where((0, drizzle_orm_1.eq)(schema_1.taskTags.taskId, taskId));
        return rows.map((r) => r.tagId);
    }
    /**
     * Insert task↔tag rows. Idempotent via the `(task_id, tag_id)` primary key —
     * a concurrent re-insert of the same pair is a harmless no-op.
     */
    async addTags(taskId, tagIds, exec = this.db) {
        if (tagIds.length === 0)
            return;
        await exec
            .insert(schema_1.taskTags)
            .values(tagIds.map((tagId) => ({ taskId, tagId })))
            .onDuplicateKeyUpdate({
            set: { addedAt: (0, drizzle_orm_1.sql) `${schema_1.taskTags.addedAt}` },
        });
    }
    /** Bulk-remove task↔tag rows (used by #5 update / #10 bulk tag diffs). */
    async removeTags(taskId, tagIds, exec = this.db) {
        if (tagIds.length === 0)
            return;
        await exec
            .delete(schema_1.taskTags)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.taskTags.taskId, taskId), (0, drizzle_orm_1.inArray)(schema_1.taskTags.tagId, tagIds)));
    }
    // ─── Bulk operations (multiple tasks at once) ─────────────────────────────
    /** Add assignees to multiple tasks in one query (avoid N+1 in bulk updates). */
    async addAssigneesBulk(taskIds, userIds, assignedBy, exec = this.db) {
        if (taskIds.length === 0 || userIds.length === 0)
            return;
        const values = taskIds.flatMap((taskId) => userIds.map((userId) => ({ taskId, userId, assignedBy })));
        await exec
            .insert(schema_1.taskAssignees)
            .values(values)
            .onDuplicateKeyUpdate({
            set: { assignedBy: (0, drizzle_orm_1.sql) `${schema_1.taskAssignees.assignedBy}` },
        });
    }
    /** Add watchers to multiple tasks in one query (avoid N+1 in bulk updates). */
    async addWatchersBulk(taskIds, userIds, exec = this.db) {
        if (taskIds.length === 0 || userIds.length === 0)
            return;
        const values = taskIds.flatMap((taskId) => userIds.map((userId) => ({ taskId, userId })));
        await exec
            .insert(schema_1.taskWatchers)
            .values(values)
            .onDuplicateKeyUpdate({
            set: { startedAt: (0, drizzle_orm_1.sql) `${schema_1.taskWatchers.startedAt}` },
        });
    }
    /** Add tags to multiple tasks in one query (avoid N+1 in bulk updates). */
    async addTagsBulk(taskIds, tagIds, exec = this.db) {
        if (taskIds.length === 0 || tagIds.length === 0)
            return;
        const values = taskIds.flatMap((taskId) => tagIds.map((tagId) => ({ taskId, tagId })));
        await exec
            .insert(schema_1.taskTags)
            .values(values)
            .onDuplicateKeyUpdate({
            set: { addedAt: (0, drizzle_orm_1.sql) `${schema_1.taskTags.addedAt}` },
        });
    }
    /** Remove assignees from multiple tasks in one query (avoid N+1 in bulk updates). */
    async removeAssigneesBulk(taskIds, userIds, exec = this.db) {
        if (taskIds.length === 0 || userIds.length === 0)
            return;
        await exec
            .delete(schema_1.taskAssignees)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.inArray)(schema_1.taskAssignees.taskId, taskIds), (0, drizzle_orm_1.inArray)(schema_1.taskAssignees.userId, userIds)));
    }
    /** Remove tags from multiple tasks in one query (avoid N+1 in bulk updates). */
    async removeTagsBulk(taskIds, tagIds, exec = this.db) {
        if (taskIds.length === 0 || tagIds.length === 0)
            return;
        await exec
            .delete(schema_1.taskTags)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.inArray)(schema_1.taskTags.taskId, taskIds), (0, drizzle_orm_1.inArray)(schema_1.taskTags.tagId, tagIds)));
    }
}
exports.TaskMembershipRepo = TaskMembershipRepo;
