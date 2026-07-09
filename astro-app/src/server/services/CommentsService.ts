import { MySql2Database } from "../db/client";
import * as schema from "../db/schema";
import { AppError } from "../errors";
import { Roles, type Role } from "../constants";
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
        await this.comments.updateBody(comment.id, input.body, editedAt);
        return toWireComment({ ...comment, body: input.body, editedAt });
    }

    /** DELETE — soft-delete (author or admin/owner); idempotent tombstone. */
    async delete(input: DeleteCommentInput): Promise<void> {
        const comment = await this.requireLiveComment(
            input.id,
            input.workspaceId,
        );
        const isAuthor = comment.authorId === input.actorId;
        const isAdmin =
            input.role === Roles.OWNER || input.role === Roles.ADMIN;
        if (!isAuthor && !isAdmin) {
            throw AppError.forbidden(
                "comment.forbidden_delete",
                "Only the author or an admin can delete a comment",
            );
        }
        await this.comments.softDelete(comment.id, new Date());
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
     * `#CUSTOM-ID` → OTHER task ids in the workspace (deduped, host task
     * excluded). Unmatched / cross-workspace refs are ignored.
     */
    private async resolveTaskRefs(
        body: string,
        workspaceId: string,
        hostTaskId: string,
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
            if (t && t.id !== hostTaskId) ids.add(t.id);
        }
        return [...ids];
    }
}
