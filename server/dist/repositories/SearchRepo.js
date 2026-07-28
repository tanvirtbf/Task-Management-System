"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SearchRepo = void 0;
const drizzle_orm_1 = require("drizzle-orm");
const schema_1 = require("../db/schema");
const context_1 = require("../rbac/context");
const ownEscape_1 = require("../rbac/ownEscape");
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
const escapeLike = (value) => value.replace(/[\\%_]/g, (ch) => `\\${ch}`);
class SearchRepo {
    db;
    constructor(db) {
        this.db = db;
    }
    /**
     * Tasks matching name (substring) OR custom_id (EXACT — so `ORD-1042`
     * resolves the task even when it is not in the name), live only, scoped to
     * the workspace. Returns FULL `TaskRow`s so the service can hydrate +
     * `toWireTask` them like any other §10 read.
     */
    async searchTasks(workspaceId, q, limit) {
        const pattern = `%${escapeLike(q)}%`;
        return this.db
            .select()
            .from(schema_1.tasks)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.tasks.workspaceId, workspaceId), (0, drizzle_orm_1.isNull)(schema_1.tasks.archivedAt), (0, drizzle_orm_1.or)((0, drizzle_orm_1.like)(schema_1.tasks.name, pattern), (0, drizzle_orm_1.eq)(schema_1.tasks.customId, q)), 
        // RBAC P18 — search was the single biggest leak in the
        // scan: task names, list names, space names and comment
        // bodies, workspace-wide, to anyone.
        await (0, context_1.listScopeFilter)(schema_1.tasks.primaryListId, await (0, ownEscape_1.taskOwnEscape)())))
            .orderBy((0, drizzle_orm_1.asc)(schema_1.tasks.internalId))
            .limit(limit);
    }
    /**
     * Lists matching name, live only. `lists` has no `workspace_id` — tenant
     * isolation is the `lists.space_id → spaces.workspace_id` join (same guard
     * `ListsRepo.listByWorkspace` uses).
     */
    async searchLists(workspaceId, q, limit) {
        return this.db
            .select({
            id: schema_1.lists.id,
            spaceId: schema_1.lists.spaceId,
            name: schema_1.lists.name,
            description: schema_1.lists.description,
            icon: schema_1.lists.icon,
            color: schema_1.lists.color,
            position: schema_1.lists.position,
            defaultTaskTypeId: schema_1.lists.defaultTaskTypeId,
            isPrivate: schema_1.lists.isPrivate,
            archivedAt: schema_1.lists.archivedAt,
            createdBy: schema_1.lists.createdBy,
            createdAt: schema_1.lists.createdAt,
        })
            .from(schema_1.lists)
            .innerJoin(schema_1.spaces, (0, drizzle_orm_1.eq)(schema_1.lists.spaceId, schema_1.spaces.id))
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.spaces.workspaceId, workspaceId), (0, drizzle_orm_1.isNull)(schema_1.lists.archivedAt), (0, drizzle_orm_1.like)(schema_1.lists.name, `%${escapeLike(q)}%`), await (0, context_1.spaceScopeFilter)(schema_1.lists.spaceId)))
            .orderBy((0, drizzle_orm_1.asc)(schema_1.lists.name), (0, drizzle_orm_1.asc)(schema_1.lists.id))
            .limit(limit);
    }
    /** Spaces matching name, live only, scoped directly by `workspace_id`. */
    async searchSpaces(workspaceId, q, limit) {
        return this.db
            .select({
            id: schema_1.spaces.id,
            name: schema_1.spaces.name,
            description: schema_1.spaces.description,
            icon: schema_1.spaces.icon,
            color: schema_1.spaces.color,
            isPrivate: schema_1.spaces.isPrivate,
            position: schema_1.spaces.position,
            archivedAt: schema_1.spaces.archivedAt,
            createdBy: schema_1.spaces.createdBy,
            createdAt: schema_1.spaces.createdAt,
        })
            .from(schema_1.spaces)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.spaces.workspaceId, workspaceId), (0, drizzle_orm_1.isNull)(schema_1.spaces.archivedAt), (0, drizzle_orm_1.like)(schema_1.spaces.name, `%${escapeLike(q)}%`), await (0, context_1.spaceScopeFilter)(schema_1.spaces.id)))
            .orderBy((0, drizzle_orm_1.asc)(schema_1.spaces.name), (0, drizzle_orm_1.asc)(schema_1.spaces.id))
            .limit(limit);
    }
    /**
     * Users matching first name / last name / email, scoped to the workspace.
     * No status filter — search finds every member (the wire `User` carries
     * `status` so the UI can mark deactivated/invited). The projection omits
     * `password_hash`; the inferred row satisfies `toWireUser`'s input.
     */
    async searchUsers(workspaceId, q, limit) {
        const pattern = `%${escapeLike(q)}%`;
        return this.db
            .select({
            id: schema_1.users.id,
            firstName: schema_1.users.firstName,
            lastName: schema_1.users.lastName,
            email: schema_1.users.email,
            role: schema_1.users.role,
            avatarUrl: schema_1.users.avatarUrl,
            status: schema_1.users.status,
            timezone: schema_1.users.timezone,
            createdAt: schema_1.users.createdAt,
            lastLoginAt: schema_1.users.lastLoginAt,
        })
            .from(schema_1.users)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.users.workspaceId, workspaceId), (0, drizzle_orm_1.or)((0, drizzle_orm_1.like)(schema_1.users.firstName, pattern), (0, drizzle_orm_1.like)(schema_1.users.lastName, pattern), (0, drizzle_orm_1.like)(schema_1.users.email, pattern))))
            .orderBy((0, drizzle_orm_1.asc)(schema_1.users.id))
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
    async searchComments(workspaceId, q, limit) {
        return this.db
            .select({
            id: schema_1.comments.id,
            taskId: schema_1.comments.taskId,
            parentCommentId: schema_1.comments.parentCommentId,
            authorId: schema_1.comments.authorId,
            body: schema_1.comments.body,
            editedAt: schema_1.comments.editedAt,
            createdAt: schema_1.comments.createdAt,
        })
            .from(schema_1.comments)
            .innerJoin(schema_1.tasks, (0, drizzle_orm_1.eq)(schema_1.comments.taskId, schema_1.tasks.id))
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.tasks.workspaceId, workspaceId), (0, drizzle_orm_1.isNull)(schema_1.tasks.archivedAt), // hide content of archived tasks (matches searchTasks)
        (0, drizzle_orm_1.isNull)(schema_1.comments.deletedAt), (0, drizzle_orm_1.like)(schema_1.comments.body, `%${escapeLike(q)}%`), 
        // RBAC P18 — a comment inherits its task's visibility.
        await (0, context_1.listScopeFilter)(schema_1.tasks.primaryListId, await (0, ownEscape_1.taskOwnEscape)())))
            .orderBy((0, drizzle_orm_1.desc)(schema_1.comments.createdAt))
            .limit(limit);
    }
}
exports.SearchRepo = SearchRepo;
