"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WorkspaceActivityRepo = void 0;
const drizzle_orm_1 = require("drizzle-orm");
const schema_1 = require("../db/schema");
const utils_1 = require("../utils");
const READ_COLUMNS = {
    id: schema_1.workspaceActivity.id,
    internalId: schema_1.workspaceActivity.internalId,
    actorId: schema_1.workspaceActivity.actorId,
    entityType: schema_1.workspaceActivity.entityType,
    entityId: schema_1.workspaceActivity.entityId,
    action: schema_1.workspaceActivity.action,
    context: schema_1.workspaceActivity.context,
    createdAt: schema_1.workspaceActivity.createdAt,
};
class WorkspaceActivityRepo {
    db;
    constructor(db) {
        this.db = db;
    }
    /** Append a single workspace-level activity row (write-side fanout). */
    async record(row, exec = this.db) {
        await exec.insert(schema_1.workspaceActivity).values({
            id: (0, utils_1.fakeId)("wsa"),
            workspaceId: row.workspaceId,
            actorId: row.actorId,
            entityType: row.entityType,
            entityId: row.entityId,
            action: row.action,
            context: row.context ?? null,
        });
    }
    /**
     * The most recent `limit` events for a workspace (newest-first), for the
     * §26 #1 home activity card. No filters, no cursor — a small fixed slice.
     */
    async listRecent(workspaceId, limit) {
        return this.db
            .select(READ_COLUMNS)
            .from(schema_1.workspaceActivity)
            .where((0, drizzle_orm_1.eq)(schema_1.workspaceActivity.workspaceId, workspaceId))
            .orderBy((0, drizzle_orm_1.desc)(schema_1.workspaceActivity.internalId))
            .limit(limit);
    }
    /**
     * One filtered, newest-first page of a workspace's feed (§26 #2), ordered by
     * `internal_id` DESC. The caller passes `limit + 1` and uses the extra row to
     * derive `has_more`.
     */
    async listFeed(params) {
        return this.db
            .select(READ_COLUMNS)
            .from(schema_1.workspaceActivity)
            .where(this.feedWhere(params))
            .orderBy((0, drizzle_orm_1.desc)(schema_1.workspaceActivity.internalId))
            .limit(params.limit);
    }
    /** Exact count for the same filter set — feeds `pagination.total_estimate`. */
    async countFeed(params) {
        const [row] = await this.db
            .select({ value: (0, drizzle_orm_1.count)() })
            .from(schema_1.workspaceActivity)
            .where(this.feedWhere(params));
        return row?.value ?? 0;
    }
    /**
     * Shared WHERE for the feed page + count. `workspace_id` is always present
     * (tenant isolation); the optional filters and the keyset cursor are appended
     * only when supplied (Drizzle's `and()` drops `undefined` entries).
     */
    feedWhere(params) {
        return (0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.workspaceActivity.workspaceId, params.workspaceId), params.entityType
            ? (0, drizzle_orm_1.eq)(schema_1.workspaceActivity.entityType, params.entityType)
            : undefined, params.actorId
            ? (0, drizzle_orm_1.eq)(schema_1.workspaceActivity.actorId, params.actorId)
            : undefined, params.from
            ? (0, drizzle_orm_1.gte)(schema_1.workspaceActivity.createdAt, params.from)
            : undefined, params.to ? (0, drizzle_orm_1.lte)(schema_1.workspaceActivity.createdAt, params.to) : undefined, params.afterInternalId
            ? (0, drizzle_orm_1.lt)(schema_1.workspaceActivity.internalId, BigInt(params.afterInternalId))
            : undefined);
    }
}
exports.WorkspaceActivityRepo = WorkspaceActivityRepo;
