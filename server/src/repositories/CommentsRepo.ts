import { and, asc, eq } from "drizzle-orm";
import { MySql2Database } from "drizzle-orm/mysql2";
import * as schema from "../db/schema";
import { comments, users } from "../db/schema";
import { fakeId } from "../utils";
import type { DbExecutor } from "./types";

/**
 * Data access for §14 Comments (`comments`). The `tasks.comments_count` counter
 * is trigger-maintained (`trg_comments_*`), so this repo never touches it.
 * Workspace isolation is enforced one level up (the service resolves the task /
 * the comment's task in the caller's workspace before any write).
 */

export interface CommentRow {
    id: string;
    taskId: string;
    parentCommentId: string | null;
    authorId: string;
    body: string;
    editedAt: Date | null;
    deletedAt: Date | null;
    createdAt: Date;
}

export interface NewComment {
    taskId: string;
    parentCommentId: string | null;
    authorId: string;
    body: string;
}

/** A workspace member, projected for @mention resolution by handle/email. */
export interface MentionableUser {
    id: string;
    firstName: string;
    email: string;
}

const READ_COLUMNS = {
    id: comments.id,
    taskId: comments.taskId,
    parentCommentId: comments.parentCommentId,
    authorId: comments.authorId,
    body: comments.body,
    editedAt: comments.editedAt,
    deletedAt: comments.deletedAt,
    createdAt: comments.createdAt,
} as const;

export class CommentsRepo {
    constructor(private db: MySql2Database<typeof schema>) {}

    /**
     * Every comment on a task — including soft-deleted tombstones (kept so the
     * reply tree survives) — oldest-first. `internal_id` is the stable tie-break
     * for same-second bursts.
     */
    async listByTask(taskId: string): Promise<CommentRow[]> {
        return this.db
            .select(READ_COLUMNS)
            .from(comments)
            .where(eq(comments.taskId, taskId))
            .orderBy(asc(comments.createdAt), asc(comments.internalId));
    }

    /** One comment by primary key, regardless of owner / soft-delete state. */
    async findById(id: string): Promise<CommentRow | null> {
        const [row] = await this.db
            .select(READ_COLUMNS)
            .from(comments)
            .where(eq(comments.id, id))
            .limit(1);
        return row ?? null;
    }

    /** Insert a comment and return the persisted row (re-read via `exec`). */
    async insert(
        input: NewComment,
        exec: DbExecutor = this.db,
    ): Promise<CommentRow> {
        const id = fakeId("c");
        await exec.insert(comments).values({
            id,
            taskId: input.taskId,
            parentCommentId: input.parentCommentId,
            authorId: input.authorId,
            body: input.body,
        });
        const [row] = await exec
            .select(READ_COLUMNS)
            .from(comments)
            .where(eq(comments.id, id))
            .limit(1);
        if (!row) throw new Error("comment insert did not persist");
        return row;
    }

    async updateBody(
        id: string,
        body: string,
        editedAt: Date,
        exec: DbExecutor = this.db,
    ): Promise<void> {
        await exec
            .update(comments)
            .set({ body, editedAt })
            .where(eq(comments.id, id));
    }

    async softDelete(
        id: string,
        deletedAt: Date,
        exec: DbExecutor = this.db,
    ): Promise<void> {
        await exec
            .update(comments)
            .set({ deletedAt })
            .where(eq(comments.id, id));
    }

    /**
     * Active members of a workspace projected to `{id, firstName, email}` — the
     * candidate set for resolving `@handle` mentions in a comment body. Bounded
     * per-workspace, so the whole set is returned (the service matches in memory).
     */
    async membersForMention(workspaceId: string): Promise<MentionableUser[]> {
        return this.db
            .select({
                id: users.id,
                firstName: users.firstName,
                email: users.email,
            })
            .from(users)
            .where(
                and(
                    eq(users.workspaceId, workspaceId),
                    eq(users.status, "active"),
                ),
            );
    }
}
