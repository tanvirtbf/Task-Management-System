"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WorkspaceActivityRepo = void 0;
const drizzle_orm_1 = require("drizzle-orm");
const schema_1 = require("../db/schema");
const context_1 = require("../rbac/context");
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
    /**
     * F9 (ISS-060): what an audit row is ABOUT decides who may read it.
     *
     *   - `space` / `list` rows follow the caller's space visibility — the
     *     same rule every other read path applies.
     *   - everything else (`user`, `role`, `workspace`, and the workspace-wide
     *     catalogs: `task_type`, `tag`, `custom_field`, `sprint`) is
     *     people-management and configuration history — owner/admin material.
     *     Before this, a guest could reconstruct who was promoted, deactivated
     *     or invited, actor emails included.
     *
     * `undefined` = unrestricted: an owner/admin with full sight (today's
     * admins), and non-request contexts (jobs, direct-repo unit tests) where
     * there is no user to narrow — matching `visibilityScope`'s own defaults.
     */
    async auditVisibility() {
        const [scope, actor] = await Promise.all([
            (0, context_1.visibilityScope)(),
            (0, context_1.currentActor)(),
        ]);
        const legacyAdmin = !actor ||
            actor.kind !== "user" ||
            actor.legacyRole === "owner" ||
            actor.legacyRole === "admin";
        if (legacyAdmin && scope.kind === "all")
            return undefined;
        const SPACE_KINDS = ["space", "list"];
        const parts = [];
        // The space-context rows the caller may see.
        if (scope.kind === "all") {
            parts.push((0, drizzle_orm_1.inArray)(schema_1.workspaceActivity.entityType, [...SPACE_KINDS]));
        }
        else {
            const noRow = (0, drizzle_orm_1.sql) `1 = 0`;
            parts.push((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.workspaceActivity.entityType, "space"), scope.spaceIds.length > 0
                ? (0, drizzle_orm_1.inArray)(schema_1.workspaceActivity.entityId, [
                    ...scope.spaceIds,
                ])
                : noRow));
            parts.push((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.workspaceActivity.entityType, "list"), (0, drizzle_orm_1.or)(scope.listIds.length > 0
                ? (0, drizzle_orm_1.inArray)(schema_1.workspaceActivity.entityId, [
                    ...scope.listIds,
                ])
                : noRow, scope.spaceIds.length > 0
                ? (0, drizzle_orm_1.inArray)(schema_1.workspaceActivity.entityId, this.db
                    .select({ id: schema_1.lists.id })
                    .from(schema_1.lists)
                    .where((0, drizzle_orm_1.inArray)(schema_1.lists.spaceId, [
                    ...scope.spaceIds,
                ])))
                : noRow)));
        }
        // A space-narrowed ADMIN keeps the admin-material rows.
        if (legacyAdmin) {
            parts.push((0, drizzle_orm_1.notInArray)(schema_1.workspaceActivity.entityType, [...SPACE_KINDS]));
        }
        return (0, drizzle_orm_1.or)(...parts.filter((p) => p !== undefined));
    }
    async listRecent(workspaceId, limit) {
        return this.db
            .select(READ_COLUMNS)
            .from(schema_1.workspaceActivity)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.workspaceActivity.workspaceId, workspaceId), await this.auditVisibility()))
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
            .where((0, drizzle_orm_1.and)(this.feedWhere(params), await this.auditVisibility()))
            .orderBy((0, drizzle_orm_1.desc)(schema_1.workspaceActivity.internalId))
            .limit(params.limit);
    }
    /** Exact count for the same filter set — feeds `pagination.total_estimate`. */
    async countFeed(params) {
        const [row] = await this.db
            .select({ value: (0, drizzle_orm_1.count)() })
            .from(schema_1.workspaceActivity)
            .where((0, drizzle_orm_1.and)(this.feedWhere(params), await this.auditVisibility()));
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
