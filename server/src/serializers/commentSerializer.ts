import type { CommentRow } from "../repositories/CommentsRepo";

/**
 * Wire-format `Comment` per API_DESIGN.md §14. snake_case; `internal_id` (the
 * keyset) never crosses the wire. A soft-deleted comment KEEPS its place in the
 * thread (so reply structure survives) but its `body` is rendered as `[deleted]`
 * and never leaks the original text.
 */
export interface WireComment {
    id: string;
    task_id: string;
    parent_comment_id: string | null;
    author_id: string;
    body: string;
    edited_at: string | null;
    deleted_at: string | null;
    created_at: string;
    /** Present on top-level comments only (1-level threading). */
    replies?: WireComment[];
}

const DELETED_BODY = "[deleted]";

export const toWireComment = (c: CommentRow): WireComment => ({
    id: c.id,
    task_id: c.taskId,
    parent_comment_id: c.parentCommentId,
    author_id: c.authorId,
    body: c.deletedAt ? DELETED_BODY : c.body,
    edited_at: c.editedAt ? c.editedAt.toISOString() : null,
    deleted_at: c.deletedAt ? c.deletedAt.toISOString() : null,
    created_at: c.createdAt.toISOString(),
});

/**
 * Build the §14 read shape from a flat, oldest-first row list: top-level
 * comments, each with its `replies` nested (also oldest-first). 1-level only —
 * a reply's own `parent_comment_id` is always a top-level comment by the create
 * rule, so replies are never re-bucketed under another reply.
 */
export const toCommentTree = (rows: CommentRow[]): WireComment[] => {
    const repliesByParent = new Map<string, WireComment[]>();
    for (const row of rows) {
        if (row.parentCommentId) {
            const arr = repliesByParent.get(row.parentCommentId) ?? [];
            arr.push(toWireComment(row));
            repliesByParent.set(row.parentCommentId, arr);
        }
    }
    const tops: WireComment[] = [];
    for (const row of rows) {
        if (!row.parentCommentId) {
            const wire = toWireComment(row);
            wire.replies = repliesByParent.get(row.id) ?? [];
            tops.push(wire);
        }
    }
    return tops;
};
