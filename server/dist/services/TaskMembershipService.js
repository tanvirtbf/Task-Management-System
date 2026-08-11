"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TaskMembershipService = void 0;
const errors_1 = require("../errors");
const scopeGuard_1 = require("../rbac/scopeGuard");
const TaskEmailService_1 = require("./TaskEmailService");
const PushService_1 = require("./PushService");
const NOTIFICATION_TITLE_MAX = 300; // notifications.title VARCHAR(300)
const ASSIGNED_TITLE_PREFIX = "You were assigned to ";
class TaskMembershipService {
    db;
    tasks;
    membership;
    users;
    activity;
    notifications;
    tags;
    constructor(db, tasks, membership, users, activity, notifications, tags) {
        this.db = db;
        this.tasks = tasks;
        this.membership = membership;
        this.users = users;
        this.activity = activity;
        this.notifications = notifications;
        this.tags = tags;
    }
    /**
     * Add one or more assignees to a task.
     *
     * Idempotent: re-adding an already-assigned user writes nothing, logs no
     * activity, fires no notification, and does not bump the task ETag. All
     * eligibility checks run before the transaction, so an invalid request
     * never produces a partial assignment.
     */
    /** F8 (ISS-047): the `task.assign` grant's scope must reach this task. */
    async assertAssignScope(task) {
        if (await (0, scopeGuard_1.hasFullReach)("task.assign"))
            return;
        const [spaceIds, assignees] = await Promise.all([
            this.tasks.spaceIdsByTask([task.id]),
            this.tasks.assigneesByTask([task.id]),
        ]);
        await (0, scopeGuard_1.assertScoped)("task.assign", {
            spaceId: spaceIds.get(task.id) ?? null,
            createdBy: task.createdBy,
            assigneeIds: assignees.get(task.id) ?? [],
        });
    }
    async addAssignees(input) {
        const { taskId, workspaceId, actorId, userIds } = input;
        // 1. Task must live in the caller's workspace (404 otherwise — no
        //    cross-tenant existence oracle).
        const task = await this.tasks.findByIdInWorkspace(taskId, workspaceId);
        if (!task) {
            throw errors_1.AppError.notFound("task.not_found", `Task ${taskId} does not exist`);
        }
        // 2. Archived tasks are read-only for membership changes.
        if (task.archivedAt) {
            throw errors_1.AppError.conflict("task.archived", "Cannot modify an archived task");
        }
        await this.assertAssignScope(task); // F8
        // 3. Every candidate must be an ACTIVE member of THIS workspace.
        //    Reject the whole request if any id is invalid — no partial writes,
        //    and a foreign-workspace id is indistinguishable from a missing one.
        const validIds = await this.users.findActiveIdsInWorkspace(userIds, workspaceId);
        const invalid = userIds.filter((id) => !validIds.has(id));
        if (invalid.length > 0) {
            const details = invalid.map((id) => ({
                field: "user_ids",
                issue: `${id} is not an active member of this workspace`,
            }));
            throw errors_1.AppError.unprocessable("task.invalid_assignee", "One or more assignees are not active members of this workspace", details);
        }
        // 4. Critical section. Lock the task row so concurrent assigns to the
        //    SAME task serialize — this removes the InnoDB deadlock between each
        //    writer's child-row inserts and the shared `updated_at` bump, and
        //    lets us recompute the "not already assigned" diff race-free, so a
        //    concurrent re-add writes nothing (exactly-once side effects).
        //    All writes are one transaction: all-or-nothing.
        const outcome = await this.db.transaction(async (tx) => {
            await this.tasks.lockById(taskId, tx);
            const existing = new Set(await this.membership.getAssigneeIds(taskId, tx));
            const newIds = userIds.filter((id) => !existing.has(id));
            if (newIds.length === 0) {
                return { added: 0, recipients: [] };
            }
            await this.membership.addAssignees(taskId, newIds, actorId, tx);
            await this.membership.addWatchers(taskId, newIds, tx);
            await this.activity.recordMany(newIds.map((userId) => ({
                taskId,
                actorId,
                action: "assignee_added",
                context: { user_id: userId },
            })), tx);
            // Never notify the actor about their own self-assignment.
            const recipients = newIds.filter((id) => id !== actorId);
            await this.notifications.createMany(recipients.map((userId) => ({
                userId,
                type: "assigned",
                entityType: "task",
                entityId: taskId,
                actorId,
                title: this.assignedTitle(task.name),
            })), tx);
            await this.tasks.touchUpdatedAt(taskId, tx);
            return { added: newIds.length, recipients };
        });
        // Reach the same recipients the in-app fanout did on the out-of-app
        // channels — email AND Web Push. AFTER the commit, fire-and-forget:
        // the 204 never waits on SMTP or a push service, and a delivery
        // failure never fails the assignment (2026-08-08 notification
        // delivery).
        if (outcome.recipients.length > 0) {
            void (0, TaskEmailService_1.taskEmails)().taskAssigned({
                workspaceId,
                taskId,
                taskName: task.name,
                recipientIds: outcome.recipients,
                actorId,
            });
            void (0, PushService_1.pushSvc)().taskAssigned({
                workspaceId,
                taskId,
                taskName: task.name,
                recipientIds: outcome.recipients,
                actorId,
            });
        }
        return { added: outcome.added };
    }
    /**
     * Remove a single assignee from a task.
     *
     * Idempotent: removing a user who is not currently assigned writes nothing,
     * logs no activity, and does not bump the task ETag. An unknown or
     * foreign-workspace `userId` is the same idempotent no-op — the endpoint is
     * never a membership oracle. No notification is fired (there is no
     * `unassigned` type), and the auto-added watcher row is deliberately left
     * intact — watching has its own `/watchers/self` lifecycle.
     */
    async removeAssignee(input) {
        const { taskId, workspaceId, actorId, userId } = input;
        // 1. Task must live in the caller's workspace (404 otherwise — no
        //    cross-tenant existence oracle).
        const task = await this.tasks.findByIdInWorkspace(taskId, workspaceId);
        if (!task) {
            throw errors_1.AppError.notFound("task.not_found", `Task ${taskId} does not exist`);
        }
        // 2. Archived tasks are read-only for membership changes.
        if (task.archivedAt) {
            throw errors_1.AppError.conflict("task.archived", "Cannot modify an archived task");
        }
        await this.assertAssignScope(task); // F8
        // 3. Critical section. Take the task lock FIRST — the same order every
        //    membership writer uses — so a concurrent add/remove on the SAME
        //    task serializes (no InnoDB deadlock) and the "currently assigned?"
        //    check is race-free, yielding exactly-once side effects. The whole
        //    removal is one transaction: all-or-nothing.
        return this.db.transaction(async (tx) => {
            await this.tasks.lockById(taskId, tx);
            const existing = new Set(await this.membership.getAssigneeIds(taskId, tx));
            if (!existing.has(userId)) {
                return { removed: 0 };
            }
            await this.membership.removeAssignee(taskId, userId, tx);
            await this.activity.recordMany([
                {
                    taskId,
                    actorId,
                    action: "assignee_removed",
                    context: { user_id: userId },
                },
            ], tx);
            await this.tasks.touchUpdatedAt(taskId, tx);
            return { removed: 1 };
        });
    }
    /**
     * Subscribe the caller as a watcher of a task (§11). Self-only — the watcher
     * id comes from `req.auth.sub`, so a member can never watch on behalf of, or
     * surveil, anyone else.
     *
     * Idempotent: re-watching is a no-op. A self-watch is a personal
     * subscription, not a change to the task's shared state — so it writes no
     * `task_activity` row, fires no notification, and does NOT bump the task
     * ETag (`touchUpdatedAt` is scoped to assignee/tag changes). One idempotent
     * upsert; no transaction or row lock, since there is a single write and no
     * compound side effect to serialize.
     */
    async watchSelf(input) {
        const { taskId, workspaceId, userId } = input;
        // 1. Task must live in the caller's workspace (404 otherwise — no
        //    cross-tenant existence oracle).
        const task = await this.tasks.findByIdInWorkspace(taskId, workspaceId);
        if (!task) {
            throw errors_1.AppError.notFound("task.not_found", `Task ${taskId} does not exist`);
        }
        // 2. Archived tasks are read-only for membership changes.
        if (task.archivedAt) {
            throw errors_1.AppError.conflict("task.archived", "Cannot modify an archived task");
        }
        const inserted = await this.membership.addWatcher(taskId, userId);
        return { watched: inserted ? 1 : 0 };
    }
    /**
     * Unsubscribe the caller from watching a task (§11). Self-only — the watcher
     * id comes from `req.auth.sub`. The mirror of `watchSelf`: a personal
     * subscription change, so it writes NO task_activity, fires NO notification,
     * and does NOT bump the task ETag. Idempotent — un-watching a task you are
     * not watching is a no-op. One delete; no transaction or row lock, since
     * there is a single write and no compound side effect to serialize. The
     * archived-task guard mirrors `watchSelf` for symmetry.
     */
    async unwatchSelf(input) {
        const { taskId, workspaceId, userId } = input;
        const task = await this.tasks.findByIdInWorkspace(taskId, workspaceId);
        if (!task) {
            throw errors_1.AppError.notFound("task.not_found", `Task ${taskId} does not exist`);
        }
        if (task.archivedAt) {
            throw errors_1.AppError.conflict("task.archived", "Cannot modify an archived task");
        }
        const removed = await this.membership.removeWatcher(taskId, userId);
        return { unwatched: removed ? 1 : 0 };
    }
    /**
     * Apply one or more tags to a task (§11).
     *
     * Idempotent: re-applying an already-applied tag writes nothing, logs no
     * activity, and does not bump the task ETag. Every candidate tag must exist
     * in the caller's workspace — the whole request is rejected (422
     * `task.invalid_tag`) if any id is foreign/missing, so there are no partial
     * writes and a cross-tenant tag id is indistinguishable from a missing one.
     * A tag change IS a change to the task's shared state, so it follows the
     * full transactional template (lock → diff → junction write → `tag_added`
     * activity → ETag bump). No notification — there is no `tagged` type.
     */
    /**
     * F34 (ISS-095): the service half of the tag gate, mirroring
     * `assertAssignScope` — the route proved the `task.edit` verb; this proves
     * the grant's REACH covers the resolved task (F8's two-layer pattern).
     */
    async assertTagScope(task) {
        if (await (0, scopeGuard_1.hasFullReach)("task.edit"))
            return;
        const [spaceIds, assignees] = await Promise.all([
            this.tasks.spaceIdsByTask([task.id]),
            this.tasks.assigneesByTask([task.id]),
        ]);
        await (0, scopeGuard_1.assertScoped)("task.edit", {
            spaceId: spaceIds.get(task.id) ?? null,
            createdBy: task.createdBy,
            assigneeIds: assignees.get(task.id) ?? [],
        });
    }
    async addTags(input) {
        const { taskId, workspaceId, actorId, tagIds } = input;
        const task = await this.tasks.findByIdInWorkspace(taskId, workspaceId);
        if (!task) {
            throw errors_1.AppError.notFound("task.not_found", `Task ${taskId} does not exist`);
        }
        if (task.archivedAt) {
            throw errors_1.AppError.conflict("task.archived", "Cannot modify an archived task");
        }
        await this.assertTagScope(task);
        const validIds = await this.tags.findIdsInWorkspace(tagIds, workspaceId);
        const invalid = tagIds.filter((id) => !validIds.has(id));
        if (invalid.length > 0) {
            const details = invalid.map((id) => ({
                field: "tag_ids",
                issue: `${id} does not exist in this workspace`,
            }));
            throw errors_1.AppError.unprocessable("task.invalid_tag", "One or more tags do not exist in this workspace", details);
        }
        // Team-access P3: the tag NAME rides in the row (denormalised) — a
        // rename or delete later must not blank the history. Looked up BEFORE
        // the transaction: names don't depend on tx state, and a read inside
        // the row-lock window would stretch the critical section for nothing
        // (25 parallel applies serialize on that lock).
        const tagNames = new Map((await this.tags.listByWorkspace(workspaceId)).map((t) => [
            t.id,
            t.name,
        ]));
        return this.db.transaction(async (tx) => {
            await this.tasks.lockById(taskId, tx);
            const existing = new Set(await this.membership.getTagIds(taskId, tx));
            const newIds = tagIds.filter((id) => !existing.has(id));
            if (newIds.length === 0) {
                return { added: 0 };
            }
            await this.membership.addTags(taskId, newIds, tx);
            await this.activity.recordMany(newIds.map((tagId) => ({
                taskId,
                actorId,
                action: "tag_added",
                context: {
                    tag_id: tagId,
                    name: tagNames.get(tagId) ?? null,
                },
            })), tx);
            await this.tasks.touchUpdatedAt(taskId, tx);
            return { added: newIds.length };
        });
    }
    /**
     * Remove a single tag from a task (§11).
     *
     * Idempotent: removing a tag that is not applied (or does not exist / is
     * foreign-workspace) is the same no-op — never a membership oracle, writes
     * nothing, logs no activity, no ETag bump. A real removal follows the full
     * template (lock → diff → junction delete → `tag_removed` activity → ETag
     * bump). No notification.
     */
    async removeTag(input) {
        const { taskId, workspaceId, actorId, tagId } = input;
        const task = await this.tasks.findByIdInWorkspace(taskId, workspaceId);
        if (!task) {
            throw errors_1.AppError.notFound("task.not_found", `Task ${taskId} does not exist`);
        }
        if (task.archivedAt) {
            throw errors_1.AppError.conflict("task.archived", "Cannot modify an archived task");
        }
        // F34 (ISS-095): same gate as applying one.
        await this.assertTagScope(task);
        // Team-access P3: name denormalised, like tag_added — looked up
        // BEFORE the transaction (see addTags: no reads under the row lock).
        const removedName = (await this.tags.listByWorkspace(workspaceId)).find((t) => t.id === tagId)?.name ?? null;
        return this.db.transaction(async (tx) => {
            await this.tasks.lockById(taskId, tx);
            const existing = new Set(await this.membership.getTagIds(taskId, tx));
            if (!existing.has(tagId)) {
                return { removed: 0 };
            }
            await this.membership.removeTags(taskId, [tagId], tx);
            await this.activity.recordMany([
                {
                    taskId,
                    actorId,
                    action: "tag_removed",
                    context: { tag_id: tagId, name: removedName },
                },
            ], tx);
            await this.tasks.touchUpdatedAt(taskId, tx);
            return { removed: 1 };
        });
    }
    /** Build the `assigned` notification title, capped to the column width. */
    assignedTitle(taskName) {
        const room = NOTIFICATION_TITLE_MAX - ASSIGNED_TITLE_PREFIX.length;
        const name = taskName.length > room
            ? `${taskName.slice(0, room - 1)}…`
            : taskName;
        return `${ASSIGNED_TITLE_PREFIX}${name}`;
    }
}
exports.TaskMembershipService = TaskMembershipService;
