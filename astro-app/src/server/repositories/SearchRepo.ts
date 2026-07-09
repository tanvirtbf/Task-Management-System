import {
    and,
    asc,
    desc,
    eq,
    isNull,
    or,
    sql,
    type SQL,
    type SQLWrapper,
} from "drizzle-orm";
import { MySql2Database } from "../db/client";
import * as schema from "../db/schema";
import { comments, lists, spaces, tasks, users } from "../db/schema";
import type { Task as TaskRow } from "../db/schema";

/**
 * §24 Search data access. Owns the workspace-scoped LIKE queries for all five
 * searchable resources. Deliberately self-contained: it does NOT touch the
 * other features' repos (no edits to the hot TasksRepo/ListsRepo/etc.) — the
 * search service reuses `TasksRepo`'s batched hydration separately to shape the
 * task rows this repo returns into full wire `Task`s.
 *
 * V1 uses plain `LIKE` (per §24 note — test/prod sets are < 10k rows); the V2
 * upgrade path is now SQLite FTS5 (was the MySQL FULLTEXT ngram parser in
 * `_post.sql`).
 */

/** Escape LIKE wildcards so a `q` containing `%`/`_`/`\` matches literally. */
const escapeLike = (value: string): string =>
    value.replace(/[\\%_]/g, (ch) => `\\${ch}`);

/**
 * `LIKE` with an explicit `ESCAPE '\'` clause — SQLite has no default escape
 * character (MySQL's was backslash), so `escapeLike`'s output needs one.
 */
const likeEscaped = (col: SQLWrapper, pattern: string): SQL =>
    sql`${col} LIKE ${pattern} ESCAPE '\\'`;

/** List row projection feeding the wire `List` (mirrors ListController.toWireList input). */
export interface SearchListRow {
    id: string;
    spaceId: string;
    name: string;
    description: string | null;
    icon: string;
    color: string;
    position: number;
    defaultTaskTypeId: string | null;
    isPrivate: boolean;
    archivedAt: Date | null;
    createdBy: string;
    createdAt: Date;
}

/** Space row projection feeding the wire `Space` (mirrors SpacesController.toWireSpace input). */
export interface SearchSpaceRow {
    id: string;
    name: string;
    description: string | null;
    icon: string;
    color: string;
    isPrivate: boolean;
    position: number;
    archivedAt: Date | null;
    createdBy: string;
    createdAt: Date;
}

/** Comment row projection feeding `WireSearchComment`. */
export interface SearchCommentRow {
    id: string;
    taskId: string;
    parentCommentId: string | null;
    authorId: string;
    body: string;
    editedAt: Date | null;
    createdAt: Date;
}

export class SearchRepo {
    constructor(private db: MySql2Database<typeof schema>) {}

    /**
     * Tasks matching name (substring) OR custom_id (EXACT — so `ORD-1042`
     * resolves the task even when it is not in the name), live only, scoped to
     * the workspace. Returns FULL `TaskRow`s so the service can hydrate +
     * `toWireTask` them like any other §10 read.
     */
    async searchTasks(
        workspaceId: string,
        q: string,
        limit: number,
    ): Promise<TaskRow[]> {
        const pattern = `%${escapeLike(q)}%`;
        return this.db
            .select()
            .from(tasks)
            .where(
                and(
                    eq(tasks.workspaceId, workspaceId),
                    isNull(tasks.archivedAt),
                    or(likeEscaped(tasks.name, pattern), eq(tasks.customId, q)),
                ),
            )
            .orderBy(asc(tasks.internalId))
            .limit(limit);
    }

    /**
     * Lists matching name, live only. `lists` has no `workspace_id` — tenant
     * isolation is the `lists.space_id → spaces.workspace_id` join (same guard
     * `ListsRepo.listByWorkspace` uses).
     */
    async searchLists(
        workspaceId: string,
        q: string,
        limit: number,
    ): Promise<SearchListRow[]> {
        return this.db
            .select({
                id: lists.id,
                spaceId: lists.spaceId,
                name: lists.name,
                description: lists.description,
                icon: lists.icon,
                color: lists.color,
                position: lists.position,
                defaultTaskTypeId: lists.defaultTaskTypeId,
                isPrivate: lists.isPrivate,
                archivedAt: lists.archivedAt,
                createdBy: lists.createdBy,
                createdAt: lists.createdAt,
            })
            .from(lists)
            .innerJoin(spaces, eq(lists.spaceId, spaces.id))
            .where(
                and(
                    eq(spaces.workspaceId, workspaceId),
                    isNull(lists.archivedAt),
                    likeEscaped(lists.name, `%${escapeLike(q)}%`),
                ),
            )
            .orderBy(asc(lists.name), asc(lists.id))
            .limit(limit);
    }

    /** Spaces matching name, live only, scoped directly by `workspace_id`. */
    async searchSpaces(
        workspaceId: string,
        q: string,
        limit: number,
    ): Promise<SearchSpaceRow[]> {
        return this.db
            .select({
                id: spaces.id,
                name: spaces.name,
                description: spaces.description,
                icon: spaces.icon,
                color: spaces.color,
                isPrivate: spaces.isPrivate,
                position: spaces.position,
                archivedAt: spaces.archivedAt,
                createdBy: spaces.createdBy,
                createdAt: spaces.createdAt,
            })
            .from(spaces)
            .where(
                and(
                    eq(spaces.workspaceId, workspaceId),
                    isNull(spaces.archivedAt),
                    likeEscaped(spaces.name, `%${escapeLike(q)}%`),
                ),
            )
            .orderBy(asc(spaces.name), asc(spaces.id))
            .limit(limit);
    }

    /**
     * Users matching first name / last name / email, scoped to the workspace.
     * No status filter — search finds every member (the wire `User` carries
     * `status` so the UI can mark deactivated/invited). The projection omits
     * `password_hash`; the inferred row satisfies `toWireUser`'s input.
     */
    async searchUsers(workspaceId: string, q: string, limit: number) {
        const pattern = `%${escapeLike(q)}%`;
        return this.db
            .select({
                id: users.id,
                firstName: users.firstName,
                lastName: users.lastName,
                email: users.email,
                role: users.role,
                avatarUrl: users.avatarUrl,
                status: users.status,
                timezone: users.timezone,
                createdAt: users.createdAt,
                lastLoginAt: users.lastLoginAt,
            })
            .from(users)
            .where(
                and(
                    eq(users.workspaceId, workspaceId),
                    or(
                        likeEscaped(users.firstName, pattern),
                        likeEscaped(users.lastName, pattern),
                        likeEscaped(users.email, pattern),
                    ),
                ),
            )
            .orderBy(asc(users.id))
            .limit(limit);
    }

    /**
     * Comments matching body, newest-first. `comments` has no `workspace_id` —
     * scope via the `comments.task_id → tasks.workspace_id` join. Soft-deleted
     * (tombstoned) comments are EXCLUDED (`deleted_at IS NULL`): §14 mandates
     * their body must never be returned. Comments on archived tasks are also
     * excluded (`tasks.archived_at IS NULL`) so search content stays consistent
     * with `searchTasks`, which omits archived tasks.
     */
    async searchComments(
        workspaceId: string,
        q: string,
        limit: number,
    ): Promise<SearchCommentRow[]> {
        return this.db
            .select({
                id: comments.id,
                taskId: comments.taskId,
                parentCommentId: comments.parentCommentId,
                authorId: comments.authorId,
                body: comments.body,
                editedAt: comments.editedAt,
                createdAt: comments.createdAt,
            })
            .from(comments)
            .innerJoin(tasks, eq(comments.taskId, tasks.id))
            .where(
                and(
                    eq(tasks.workspaceId, workspaceId),
                    isNull(tasks.archivedAt), // hide content of archived tasks (matches searchTasks)
                    isNull(comments.deletedAt),
                    likeEscaped(comments.body, `%${escapeLike(q)}%`),
                ),
            )
            .orderBy(desc(comments.createdAt))
            .limit(limit);
    }
}
