import { and, asc, desc, eq, isNull, like, or, sql } from "drizzle-orm";
import { MySql2Database } from "drizzle-orm/mysql2";
import * as schema from "../db/schema";
import { comments, lists, spaces, tasks, users } from "../db/schema";
import type { Task as TaskRow } from "../db/schema";
import { listScopeFilter, spaceScopeFilter } from "../rbac/context";
import { taskOwnEscape } from "../rbac/ownEscape";

/**
 * §24 Search data access. Owns the workspace-scoped LIKE queries for all five
 * searchable resources. Deliberately self-contained: it does NOT touch the
 * other features' repos (no edits to the hot TasksRepo/ListsRepo/etc.) — the
 * search service reuses `TasksRepo`'s batched hydration separately to shape the
 * task rows this repo returns into full wire `Task`s.
 *
 * V1 uses plain `LIKE` (per §24 note — test/prod sets are < 10k rows); the
 * MySQL FULLTEXT ngram parser in `_post.sql` is the V2 upgrade path.
 */

/** Escape LIKE wildcards so a `q` containing `%`/`_`/`\` matches literally. */
const escapeLike = (value: string): string =>
    value.replace(/[\\%_]/g, (ch) => `\\${ch}`);

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
        const prefix = `${escapeLike(q)}%`;
        return this.db
            .select()
            .from(tasks)
            .where(
                and(
                    eq(tasks.workspaceId, workspaceId),
                    isNull(tasks.archivedAt),
                    or(
                        like(tasks.name, pattern),
                        // F20 (ISS-074): the DESCRIPTION joins the predicate.
                        // For the ops teams it is where the order number and
                        // SKU live — and comments were already searched, so
                        // its absence was an inconsistency, not a policy.
                        like(tasks.description, pattern),
                        eq(tasks.customId, q),
                    ),
                    // RBAC P18 — search was the single biggest leak in the
                    // scan: task names, list names, space names and comment
                    // bodies, workspace-wide, to anyone.
                    await listScopeFilter(
                        tasks.primaryListId,
                        await taskOwnEscape(),
                    ),
                ),
            )
            // F20 (ISS-075): relevance ladder instead of oldest-first. An
            // exact custom_id hit floats to the very top, then an exact name,
            // then a name prefix, then any name substring (so a name match
            // beats a description-only match), newest first within each band.
            // Before this, `ORDER BY internal_id ASC` meant that at a few
            // thousand tasks the limit filled with the OLDEST matches and the
            // wanted task was never on the page.
            .orderBy(
                desc(sql`(${tasks.customId} = ${q})`),
                desc(sql`(${tasks.name} = ${q})`),
                desc(sql`(${tasks.name} LIKE ${prefix})`),
                desc(sql`(${tasks.name} LIKE ${pattern})`),
                desc(tasks.internalId),
            )
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
                    like(lists.name, `%${escapeLike(q)}%`),
                    await spaceScopeFilter(lists.spaceId), // RBAC P18
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
                    like(spaces.name, `%${escapeLike(q)}%`),
                    await spaceScopeFilter(spaces.id), // RBAC P18
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
                        like(users.firstName, pattern),
                        like(users.lastName, pattern),
                        like(users.email, pattern),
                    ),
                ),
            )
            // F20 (ISS-075): a name/email PREFIX hit outranks a mid-string
            // one; alphabetical inside each band (was: insertion order).
            .orderBy(
                desc(sql`(${users.firstName} LIKE ${`${escapeLike(q)}%`})`),
                desc(sql`(${users.email} LIKE ${`${escapeLike(q)}%`})`),
                asc(users.firstName),
                asc(users.id),
            )
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
                    like(comments.body, `%${escapeLike(q)}%`),
                    // RBAC P18 — a comment inherits its task's visibility.
                    await listScopeFilter(
                        tasks.primaryListId,
                        await taskOwnEscape(),
                    ),
                ),
            )
            .orderBy(desc(comments.createdAt))
            .limit(limit);
    }
}
