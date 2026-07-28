"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CommentsRepo = void 0;
const drizzle_orm_1 = require("drizzle-orm");
const schema_1 = require("../db/schema");
const utils_1 = require("../utils");
const READ_COLUMNS = {
    id: schema_1.comments.id,
    taskId: schema_1.comments.taskId,
    parentCommentId: schema_1.comments.parentCommentId,
    authorId: schema_1.comments.authorId,
    body: schema_1.comments.body,
    editedAt: schema_1.comments.editedAt,
    deletedAt: schema_1.comments.deletedAt,
    createdAt: schema_1.comments.createdAt,
};
class CommentsRepo {
    db;
    constructor(db) {
        this.db = db;
    }
    /**
     * Every comment on a task — including soft-deleted tombstones (kept so the
     * reply tree survives) — oldest-first. `internal_id` is the stable tie-break
     * for same-second bursts.
     */
    async listByTask(taskId) {
        return this.db
            .select(READ_COLUMNS)
            .from(schema_1.comments)
            .where((0, drizzle_orm_1.eq)(schema_1.comments.taskId, taskId))
            .orderBy((0, drizzle_orm_1.asc)(schema_1.comments.createdAt), (0, drizzle_orm_1.asc)(schema_1.comments.internalId));
    }
    /** One comment by primary key, regardless of owner / soft-delete state. */
    async findById(id) {
        const [row] = await this.db
            .select(READ_COLUMNS)
            .from(schema_1.comments)
            .where((0, drizzle_orm_1.eq)(schema_1.comments.id, id))
            .limit(1);
        return row ?? null;
    }
    /** Insert a comment and return the persisted row (re-read via `exec`). */
    async insert(input, exec = this.db) {
        const id = (0, utils_1.fakeId)("c");
        await exec.insert(schema_1.comments).values({
            id,
            taskId: input.taskId,
            parentCommentId: input.parentCommentId,
            authorId: input.authorId,
            body: input.body,
        });
        const [row] = await exec
            .select(READ_COLUMNS)
            .from(schema_1.comments)
            .where((0, drizzle_orm_1.eq)(schema_1.comments.id, id))
            .limit(1);
        if (!row)
            throw new Error("comment insert did not persist");
        return row;
    }
    async updateBody(id, body, editedAt, exec = this.db) {
        await exec
            .update(schema_1.comments)
            .set({ body, editedAt })
            .where((0, drizzle_orm_1.eq)(schema_1.comments.id, id));
    }
    async softDelete(id, deletedAt, exec = this.db) {
        await exec
            .update(schema_1.comments)
            .set({ deletedAt })
            .where((0, drizzle_orm_1.eq)(schema_1.comments.id, id));
    }
    /**
     * Active members of a workspace projected to `{id, firstName, email}` — the
     * candidate set for resolving `@handle` mentions in a comment body. Bounded
     * per-workspace, so the whole set is returned (the service matches in memory).
     */
    async membersForMention(workspaceId) {
        return this.db
            .select({
            id: schema_1.users.id,
            firstName: schema_1.users.firstName,
            email: schema_1.users.email,
        })
            .from(schema_1.users)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.users.workspaceId, workspaceId), (0, drizzle_orm_1.eq)(schema_1.users.status, "active")));
    }
}
exports.CommentsRepo = CommentsRepo;
