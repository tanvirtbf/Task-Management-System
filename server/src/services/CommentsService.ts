import { MySql2Database } from "drizzle-orm/mysql2";
import * as schema from "../db/schema";
import { AppError } from "../errors";
import { Roles, type Role } from "../constants";
import { holds } from "../rbac/can";
import { liveLegacyRole } from "../rbac/scopeGuard";
import { currentActor } from "../rbac/context";
import { CommentsRepo, type CommentRow } from "../repositories/CommentsRepo";
import { TasksRepo } from "../repositories/TasksRepo";
import { TaskActivityRepo } from "../repositories/TaskActivityRepo";
import { NotificationsRepo } from "../repositories/NotificationsRepo";
import {
    toCommentTree,
    toWireComment,
    type WireComment,
} from "../serializers/commentSerializer";

/**
 * §14 Comments domain logic. Owns workspace isolation (via the task / the
 * comment's task), the 1-level threading rule, the author-only 15-minute edit
 * window, soft-delete, and the create-time side effects (`comment_posted`
 * activity, `@handle` mention notifications, `#TASK-ID` cross-references) — all
 * written in one transaction with the comment insert.
 */

/** Author edit window: 15 min after creation (API_DESIGN.md §14). */
const EDIT_WINDOW_MS = 15 * 60 * 1000;
/** `@handle` and `#TASK-ID` tokens parsed from a comment body. */
const MENTION_RE = /@([a-zA-Z0-9._-]+)/g;
const TASK_REF_RE = /#([A-Za-z][A-Za-z0-9]*-\d+)/g;

export interface ListCommentsInput {
    idOrKey: string;
    workspaceId: string;
}
export interface CreateCommentInput {
    idOrKey: string;
    workspaceId: string;
    authorId: string;
    body: string;
    parentCommentId: string | null;
}
export interface UpdateCommentInput {
    id: string;
    workspaceId: string;
    actorId: string;
    body: string;
}
export interface DeleteCommentInput {
    id: string;
    workspaceId: string;
    actorId: string;
    role: Role;
}

export class CommentsService {
    constructor(
        private db: MySql2Database<typeof schema>,
        private comments: CommentsRepo,
        private tasks: TasksRepo,
        private activity: TaskActivityRepo,
        private notifications: NotificationsRepo,
    ) {}

    /** GET — the full comment tree (top-level + nested replies) for a task. */
    async list(input: ListCommentsInput): Promise<WireComment[]> {
        const task = await this.requireTask(input.idOrKey, input.workspaceId);
        const rows = await this.comments.listByTask(task.id);
        return toCommentTree(rows);
    }

    /** POST — add a comment or a (1-level) reply, with create-time side effects. */
    async create(input: CreateCommentInput): Promise<WireComment> {
        const task = await this.requireTask(input.idOrKey, input.workspaceId);

        // F22 (ISS-051): the archived-state machine, applied evenly. Edits and
        // assignment were already 409 task.archived; comments slipped through,
        // so discussion could continue on a task the workspace considers
        // deleted (and DELETE is a soft archive — ISS-050).
        if (task.archivedAt) {
            throw AppError.conflict(
                "task.archived",
                "This task is archived — unarchive it to comment",
            );
        }

        // A reply must target a real, non-deleted, TOP-LEVEL comment on this task.
        if (input.parentCommentId) {
            const parent = await this.comments.findById(input.parentCommentId);
            if (!parent || parent.taskId !== task.id || parent.deletedAt) {
                throw AppError.unprocessable(
                    "comment.parent_not_found",
                    "The comment you are replying to does not exist",
                );
            }
            if (parent.parentCommentId !== null) {
                throw AppError.unprocessable(
                    "comment.reply_to_reply",
                    "Replies are one level deep — you cannot reply to a reply",
                );
            }
        }

        // @mentions + #TASK-ID refs read pre-existing rows, so resolve them BEFORE
        // the write; the rows that point at the NEW comment are built in-tx once
        // its id exists.
        const mentionedIds = await this.resolveMentions(
            input.body,
            input.workspaceId,
            input.authorId,
        );
        const refTaskIds = await this.resolveTaskRefs(
            input.body,
            input.workspaceId,
            task.id,
            task.primaryListId,
        );

        const comment = await this.db.transaction(async (tx) => {
            const created = await this.comments.insert(
                {
                    taskId: task.id,
                    parentCommentId: input.parentCommentId,
                    authorId: input.authorId,
                    body: input.body,
                },
                tx,
            );
            await this.activity.recordMany(
                [
                    {
                        taskId: task.id,
                        actorId: input.authorId,
                        action: "comment_posted",
                        context: { comment_id: created.id },
                    },
                ],
                tx,
            );
            if (mentionedIds.length > 0) {
                await this.notifications.createMany(
                    mentionedIds.map((userId) => ({
                        userId,
                        type: "mentioned",
                        entityType: "comment",
                        entityId: created.id,
                        actorId: input.authorId,
                        title: "mentioned you in a comment",
                        body: input.body.slice(0, 140),
                    })),
                    tx,
                );
            }

            // F19 (ISS-064): the people ATTACHED to the task learn it was
            // commented on. Before this, a plain comment notified nobody — the
            // only way to reach anyone was to @mention them by name, so the
            // watcher feature maintained rows nothing ever read. Recipients:
            // assignees + watchers, minus the author (their own comment) and
            // minus anyone already notified as `mentioned` (one event, one
            // notification). Preference suppression happens inside createMany.
            const [assigneeMap, watcherMap] = await Promise.all([
                this.tasks.assigneesByTask([task.id]),
                this.tasks.watchersByTask([task.id]),
            ]);
            const already = new Set([input.authorId, ...mentionedIds]);
            const attached = [
                ...new Set([
                    ...(assigneeMap.get(task.id) ?? []),
                    ...(watcherMap.get(task.id) ?? []),
                ]),
            ].filter((id) => !already.has(id));
            if (attached.length > 0) {
                await this.notifications.createMany(
                    attached.map((userId) => ({
                        userId,
                        type: "comment" as const,
                        entityType: "comment" as const,
                        entityId: created.id,
                        actorId: input.authorId,
                        title: `commented on "${task.name}"`,
                        body: input.body.slice(0, 140),
                    })),
                    tx,
                );
            }
            if (refTaskIds.length > 0) {
                await this.activity.recordMany(
                    refTaskIds.map((refTaskId) => ({
                        taskId: refTaskId,
                        actorId: input.authorId,
                        action: "comment_referenced",
                        context: {
                            comment_id: created.id,
                            from_task: task.id,
                        },
                    })),
                    tx,
                );
            }
            return created;
        });

        return toWireComment(comment);
    }

    /** PATCH — author edits within the 15-minute window. */
    async update(input: UpdateCommentInput): Promise<WireComment> {
        const comment = await this.requireLiveComment(
            input.id,
            input.workspaceId,
        );
        if (comment.authorId !== input.actorId) {
            throw AppError.forbidden(
                "comment.not_author",
                "Only the author can edit a comment",
            );
        }
        if (Date.now() - comment.createdAt.getTime() > EDIT_WINDOW_MS) {
            throw AppError.forbidden(
                "comment.edit_window_expired",
                "The 15-minute edit window for this comment has passed",
            );
        }
        const editedAt = new Date();
        // Team-access P3 (plan G13): an edit used to leave NO trace — the
        // audit log claimed the original text was never touched. Same-tx row,
        // like create's `comment_posted`.
        await this.db.transaction(async (tx) => {
            await this.comments.updateBody(
                comment.id,
                input.body,
                editedAt,
                tx,
            );
            await this.activity.recordMany(
                [
                    {
                        taskId: comment.taskId,
                        actorId: input.actorId,
                        action: "comment_updated",
                        context: { comment_id: comment.id },
                    },
                ],
                tx,
            );
        });
        return toWireComment({ ...comment, body: input.body, editedAt });
    }

    /** DELETE — soft-delete (author or admin/owner); idempotent tombstone. */
    async delete(input: DeleteCommentInput): Promise<void> {
        const comment = await this.requireLiveComment(
            input.id,
            input.workspaceId,
        );
        const isAuthor = comment.authorId === input.actorId;
        // F7 / D3.1 compose: the author branch is feature logic and stays free;
        // the admin branch now ALSO requires the `comment.delete_any` grant, so
        // the roles-grid toggle stops being inert (ISS-024 special case #2).
        // Compose cannot widen: granting the key to a non-admin does nothing.
        // F10 (ISS-021): the role is the LIVE one, not the token claim.
        const role = await liveLegacyRole(input.role);
        const isAdmin =
            (role === Roles.OWNER || role === Roles.ADMIN) &&
            holds(await currentActor(), "comment.delete_any");
        if (!isAuthor && !isAdmin) {
            throw AppError.forbidden(
                "comment.forbidden_delete",
                "Only the author or an admin can delete a comment",
            );
        }
        // Team-access P3 (plan G13): a deletion — especially an ADMIN deleting
        // someone else's words — must be attributable. `author_id` rides in
        // the context so "whose comment" survives the tombstone.
        await this.db.transaction(async (tx) => {
            await this.comments.softDelete(comment.id, new Date(), tx);
            await this.activity.recordMany(
                [
                    {
                        taskId: comment.taskId,
                        actorId: input.actorId,
                        action: "comment_deleted",
                        context: {
                            comment_id: comment.id,
                            author_id: comment.authorId,
                        },
                    },
                ],
                tx,
            );
        });
    }

    // ─── helpers ──────────────────────────────────────────────────────────────

    /** Resolve `:id` (internal id or custom_id) to a task in the workspace. */
    private async requireTask(idOrKey: string, workspaceId: string) {
        const task = await this.tasks.findByIdOrCustomIdInWorkspace(
            idOrKey,
            workspaceId,
        );
        if (!task) {
            throw AppError.notFound(
                "task.not_found",
                `Task ${idOrKey} does not exist`,
            );
        }
        return task;
    }

    /**
     * A live (non-deleted) comment whose task is in the caller's workspace, or
     * `404 comment.not_found`. Missing id + soft-deleted tombstone + cross-tenant
     * all collapse to one 404 (never an existence oracle).
     */
    private async requireLiveComment(
        id: string,
        workspaceId: string,
    ): Promise<CommentRow> {
        const comment = await this.comments.findById(id);
        if (!comment || comment.deletedAt) {
            throw AppError.notFound(
                "comment.not_found",
                `Comment ${id} does not exist`,
            );
        }
        const task = await this.tasks.findByIdInWorkspace(
            comment.taskId,
            workspaceId,
        );
        if (!task) {
            throw AppError.notFound(
                "comment.not_found",
                `Comment ${id} does not exist`,
            );
        }
        return comment;
    }

    /**
     * `@handle` → workspace-member ids (deduped, author excluded). A handle
     * matches a member's email local-part OR first name, case-insensitive — the
     * closest stable "@username" the schema offers (no dedicated handle column).
     * Unmatched tokens are ignored.
     */
    private async resolveMentions(
        body: string,
        workspaceId: string,
        authorId: string,
    ): Promise<string[]> {
        const handles = [
            ...new Set(
                [...body.matchAll(MENTION_RE)].map((m) => m[1].toLowerCase()),
            ),
        ];
        if (handles.length === 0) return [];
        const members = await this.comments.membersForMention(workspaceId);
        const byHandle = new Map<string, string>();
        for (const m of members) {
            byHandle.set(m.email.split("@")[0].toLowerCase(), m.id);
            byHandle.set(m.firstName.toLowerCase(), m.id);
        }
        const ids = new Set<string>();
        for (const h of handles) {
            const id = byHandle.get(h);
            if (id && id !== authorId) ids.add(id);
        }
        return [...ids];
    }

    /**
     * `#CUSTOM-ID` **or `#T-<n>`** → OTHER task ids (deduped, host excluded).
     * Unmatched / cross-workspace refs are ignored.
     *
     * F25 (ISS-066): `T-<n>` resolves now. The client renders a task's key as
     * `custom_id ?? "T-" + task_number`, and 43 of the 46 live tasks have no
     * `custom_id` — so the identifier people READ, and therefore TYPE, was the
     * one the resolver did not understand. `custom_id` is tried first
     * (workspace-unique); `T-<n>` is then resolved **inside the host task's
     * list**, because `task_number` is unique per list only — thirteen tasks
     * in this workspace are "T-1", so a workspace-wide lookup would have to
     * guess. A `T-<n>` from a different list stays unresolved, which is the
     * honest outcome.
     */
    private async resolveTaskRefs(
        body: string,
        workspaceId: string,
        hostTaskId: string,
        hostListId: string,
    ): Promise<string[]> {
        const refs = [
            ...new Set([...body.matchAll(TASK_REF_RE)].map((m) => m[1])),
        ];
        if (refs.length === 0) return [];
        const ids = new Set<string>();
        for (const ref of refs) {
            const t = await this.tasks.findByIdOrCustomIdInWorkspace(
                ref,
                workspaceId,
            );
            if (t) {
                if (t.id !== hostTaskId) ids.add(t.id);
                continue;
            }
            const tn = /^[Tt]-(\d+)$/.exec(ref);
            if (!tn) continue;
            const sibling = await this.tasks.findByTaskNumberInList(
                hostListId,
                Number(tn[1]),
            );
            if (sibling && sibling.id !== hostTaskId) ids.add(sibling.id);
        }
        return [...ids];
    }
}
