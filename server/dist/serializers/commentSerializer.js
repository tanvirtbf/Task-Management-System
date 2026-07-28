"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.toCommentTree = exports.toWireComment = void 0;
const DELETED_BODY = "[deleted]";
const toWireComment = (c) => ({
    id: c.id,
    task_id: c.taskId,
    parent_comment_id: c.parentCommentId,
    author_id: c.authorId,
    body: c.deletedAt ? DELETED_BODY : c.body,
    edited_at: c.editedAt ? c.editedAt.toISOString() : null,
    deleted_at: c.deletedAt ? c.deletedAt.toISOString() : null,
    created_at: c.createdAt.toISOString(),
});
exports.toWireComment = toWireComment;
/**
 * Build the §14 read shape from a flat, oldest-first row list: top-level
 * comments, each with its `replies` nested (also oldest-first). 1-level only —
 * a reply's own `parent_comment_id` is always a top-level comment by the create
 * rule, so replies are never re-bucketed under another reply.
 */
const toCommentTree = (rows) => {
    const repliesByParent = new Map();
    for (const row of rows) {
        if (row.parentCommentId) {
            const arr = repliesByParent.get(row.parentCommentId) ?? [];
            arr.push((0, exports.toWireComment)(row));
            repliesByParent.set(row.parentCommentId, arr);
        }
    }
    const tops = [];
    for (const row of rows) {
        if (!row.parentCommentId) {
            const wire = (0, exports.toWireComment)(row);
            wire.replies = repliesByParent.get(row.id) ?? [];
            tops.push(wire);
        }
    }
    return tops;
};
exports.toCommentTree = toCommentTree;
