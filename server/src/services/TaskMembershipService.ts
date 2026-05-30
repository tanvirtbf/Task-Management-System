import { MySql2Database } from "drizzle-orm/mysql2";
import * as schema from "../db/schema";
import { AppError, type ErrorDetail } from "../errors";
import { UsersRepo } from "../repositories/UsersRepo";
import { TasksRepo } from "../repositories/TasksRepo";
import { TaskMembershipRepo } from "../repositories/TaskMembershipRepo";
import { TaskActivityRepo } from "../repositories/TaskActivityRepo";
import { NotificationsRepo } from "../repositories/NotificationsRepo";
import { TagsRepo } from "../repositories/TagsRepo";

export interface AddAssigneesInput {
    taskId: string;
    workspaceId: string;
    actorId: string;
    /** Deduped, trimmed list of candidate assignee ids (validated upstream). */
    userIds: string[];
}

export interface AddAssigneesResult {
    /** How many users were newly assigned (0 on an idempotent no-op). */
    added: number;
}

export interface RemoveAssigneeInput {
    taskId: string;
    workspaceId: string;
    actorId: string;
    /** The assignee to remove. */
    userId: string;
}

export interface RemoveAssigneeResult {
    /** 1 when an assignment was removed, 0 on an idempotent no-op. */
    removed: number;
}

export interface WatchSelfInput {
    taskId: string;
    workspaceId: string;
    /** The caller — taken from `req.auth.sub`, never the request body. */
    userId: string;
}

export interface WatchSelfResult {
    /** 1 when a new watch was created, 0 on an idempotent no-op. */
    watched: number;
}

export interface UnwatchSelfResult {
    /** 1 when a watch was removed, 0 on an idempotent no-op. */
    unwatched: number;
}

export interface AddTagsInput {
    taskId: string;
    workspaceId: string;
    actorId: string;
    /** Deduped, trimmed list of candidate tag ids (validated upstream). */
    tagIds: string[];
}

export interface AddTagsResult {
    /** How many tags were newly applied (0 on an idempotent no-op). */
    added: number;
}

export interface RemoveTagInput {
    taskId: string;
    workspaceId: string;
    actorId: string;
    /** The tag to remove. */
    tagId: string;
}

export interface RemoveTagResult {
    /** 1 when a tag was removed, 0 on an idempotent no-op. */
    removed: number;
}

const NOTIFICATION_TITLE_MAX = 300; // notifications.title VARCHAR(300)
const ASSIGNED_TITLE_PREFIX = "You were assigned to ";

export class TaskMembershipService {
    constructor(
        private db: MySql2Database<typeof schema>,
        private tasks: TasksRepo,
        private membership: TaskMembershipRepo,
        private users: UsersRepo,
        private activity: TaskActivityRepo,
        private notifications: NotificationsRepo,
        private tags: TagsRepo,
    ) {}

    /**
     * Add one or more assignees to a task.
     *
     * Idempotent: re-adding an already-assigned user writes nothing, logs no
     * activity, fires no notification, and does not bump the task ETag. All
     * eligibility checks run before the transaction, so an invalid request
     * never produces a partial assignment.
     */
    async addAssignees(input: AddAssigneesInput): Promise<AddAssigneesResult> {
        const { taskId, workspaceId, actorId, userIds } = input;

        // 1. Task must live in the caller's workspace (404 otherwise — no
        //    cross-tenant existence oracle).
        const task = await this.tasks.findByIdInWorkspace(taskId, workspaceId);
        if (!task) {
            throw AppError.notFound(
                "task.not_found",
                `Task ${taskId} does not exist`,
            );
        }

        // 2. Archived tasks are read-only for membership changes.
        if (task.archivedAt) {
            throw AppError.conflict(
                "task.archived",
                "Cannot modify an archived task",
            );
        }

        // 3. Every candidate must be an ACTIVE member of THIS workspace.
        //    Reject the whole request if any id is invalid — no partial writes,
        //    and a foreign-workspace id is indistinguishable from a missing one.
        const validIds = await this.users.findActiveIdsInWorkspace(
            userIds,
            workspaceId,
        );
        const invalid = userIds.filter((id) => !validIds.has(id));
        if (invalid.length > 0) {
            const details: ErrorDetail[] = invalid.map((id) => ({
                field: "user_ids",
                issue: `${id} is not an active member of this workspace`,
            }));
            throw AppError.unprocessable(
                "task.invalid_assignee",
                "One or more assignees are not active members of this workspace",
                details,
            );
        }

        // 4. Critical section. Lock the task row so concurrent assigns to the
        //    SAME task serialize — this removes the InnoDB deadlock between each
        //    writer's child-row inserts and the shared `updated_at` bump, and
        //    lets us recompute the "not already assigned" diff race-free, so a
        //    concurrent re-add writes nothing (exactly-once side effects).
        //    All writes are one transaction: all-or-nothing.
        return this.db.transaction(async (tx) => {
            await this.tasks.lockById(taskId, tx);

            const existing = new Set(
                await this.membership.getAssigneeIds(taskId, tx),
            );
            const newIds = userIds.filter((id) => !existing.has(id));
            if (newIds.length === 0) {
                return { added: 0 };
            }

            await this.membership.addAssignees(taskId, newIds, actorId, tx);
            await this.membership.addWatchers(taskId, newIds, tx);
            await this.activity.recordMany(
                newIds.map((userId) => ({
                    taskId,
                    actorId,
                    action: "assignee_added",
                    context: { user_id: userId },
                })),
                tx,
            );
            // Never notify the actor about their own self-assignment.
            const recipients = newIds.filter((id) => id !== actorId);
            await this.notifications.createMany(
                recipients.map((userId) => ({
                    userId,
                    type: "assigned" as const,
                    entityType: "task" as const,
                    entityId: taskId,
                    actorId,
                    title: this.assignedTitle(task.name),
                })),
                tx,
            );
            await this.tasks.touchUpdatedAt(taskId, tx);

            return { added: newIds.length };
        });
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
    async removeAssignee(
        input: RemoveAssigneeInput,
    ): Promise<RemoveAssigneeResult> {
        const { taskId, workspaceId, actorId, userId } = input;

        // 1. Task must live in the caller's workspace (404 otherwise — no
        //    cross-tenant existence oracle).
        const task = await this.tasks.findByIdInWorkspace(taskId, workspaceId);
        if (!task) {
            throw AppError.notFound(
                "task.not_found",
                `Task ${taskId} does not exist`,
            );
        }

        // 2. Archived tasks are read-only for membership changes.
        if (task.archivedAt) {
            throw AppError.conflict(
                "task.archived",
                "Cannot modify an archived task",
            );
        }

        // 3. Critical section. Take the task lock FIRST — the same order every
        //    membership writer uses — so a concurrent add/remove on the SAME
        //    task serializes (no InnoDB deadlock) and the "currently assigned?"
        //    check is race-free, yielding exactly-once side effects. The whole
        //    removal is one transaction: all-or-nothing.
        return this.db.transaction(async (tx) => {
            await this.tasks.lockById(taskId, tx);

            const existing = new Set(
                await this.membership.getAssigneeIds(taskId, tx),
            );
            if (!existing.has(userId)) {
                return { removed: 0 };
            }

            await this.membership.removeAssignee(taskId, userId, tx);
            await this.activity.recordMany(
                [
                    {
                        taskId,
                        actorId,
                        action: "assignee_removed",
                        context: { user_id: userId },
                    },
                ],
                tx,
            );
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
    async watchSelf(input: WatchSelfInput): Promise<WatchSelfResult> {
        const { taskId, workspaceId, userId } = input;

        // 1. Task must live in the caller's workspace (404 otherwise — no
        //    cross-tenant existence oracle).
        const task = await this.tasks.findByIdInWorkspace(taskId, workspaceId);
        if (!task) {
            throw AppError.notFound(
                "task.not_found",
                `Task ${taskId} does not exist`,
            );
        }

        // 2. Archived tasks are read-only for membership changes.
        if (task.archivedAt) {
            throw AppError.conflict(
                "task.archived",
                "Cannot modify an archived task",
            );
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
    async unwatchSelf(input: WatchSelfInput): Promise<UnwatchSelfResult> {
        const { taskId, workspaceId, userId } = input;

        const task = await this.tasks.findByIdInWorkspace(taskId, workspaceId);
        if (!task) {
            throw AppError.notFound(
                "task.not_found",
                `Task ${taskId} does not exist`,
            );
        }
        if (task.archivedAt) {
            throw AppError.conflict(
                "task.archived",
                "Cannot modify an archived task",
            );
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
    async addTags(input: AddTagsInput): Promise<AddTagsResult> {
        const { taskId, workspaceId, actorId, tagIds } = input;

        const task = await this.tasks.findByIdInWorkspace(taskId, workspaceId);
        if (!task) {
            throw AppError.notFound(
                "task.not_found",
                `Task ${taskId} does not exist`,
            );
        }
        if (task.archivedAt) {
            throw AppError.conflict(
                "task.archived",
                "Cannot modify an archived task",
            );
        }

        const validIds = await this.tags.findIdsInWorkspace(
            tagIds,
            workspaceId,
        );
        const invalid = tagIds.filter((id) => !validIds.has(id));
        if (invalid.length > 0) {
            const details: ErrorDetail[] = invalid.map((id) => ({
                field: "tag_ids",
                issue: `${id} does not exist in this workspace`,
            }));
            throw AppError.unprocessable(
                "task.invalid_tag",
                "One or more tags do not exist in this workspace",
                details,
            );
        }

        return this.db.transaction(async (tx) => {
            await this.tasks.lockById(taskId, tx);

            const existing = new Set(
                await this.membership.getTagIds(taskId, tx),
            );
            const newIds = tagIds.filter((id) => !existing.has(id));
            if (newIds.length === 0) {
                return { added: 0 };
            }

            await this.membership.addTags(taskId, newIds, tx);
            await this.activity.recordMany(
                newIds.map((tagId) => ({
                    taskId,
                    actorId,
                    action: "tag_added",
                    context: { tag_id: tagId },
                })),
                tx,
            );
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
    async removeTag(input: RemoveTagInput): Promise<RemoveTagResult> {
        const { taskId, workspaceId, actorId, tagId } = input;

        const task = await this.tasks.findByIdInWorkspace(taskId, workspaceId);
        if (!task) {
            throw AppError.notFound(
                "task.not_found",
                `Task ${taskId} does not exist`,
            );
        }
        if (task.archivedAt) {
            throw AppError.conflict(
                "task.archived",
                "Cannot modify an archived task",
            );
        }

        return this.db.transaction(async (tx) => {
            await this.tasks.lockById(taskId, tx);

            const existing = new Set(
                await this.membership.getTagIds(taskId, tx),
            );
            if (!existing.has(tagId)) {
                return { removed: 0 };
            }

            await this.membership.removeTags(taskId, [tagId], tx);
            await this.activity.recordMany(
                [
                    {
                        taskId,
                        actorId,
                        action: "tag_removed",
                        context: { tag_id: tagId },
                    },
                ],
                tx,
            );
            await this.tasks.touchUpdatedAt(taskId, tx);

            return { removed: 1 };
        });
    }

    /** Build the `assigned` notification title, capped to the column width. */
    private assignedTitle(taskName: string): string {
        const room = NOTIFICATION_TITLE_MAX - ASSIGNED_TITLE_PREFIX.length;
        const name =
            taskName.length > room
                ? `${taskName.slice(0, room - 1)}…`
                : taskName;
        return `${ASSIGNED_TITLE_PREFIX}${name}`;
    }
}
