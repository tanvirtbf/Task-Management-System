"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SpaceVisibilityGrantsRepo = void 0;
const drizzle_orm_1 = require("drizzle-orm");
const schema_1 = require("../db/schema");
const utils_1 = require("../utils");
const grantColumns = {
    id: schema_1.spaceVisibilityGrants.id,
    viewerSpaceId: schema_1.spaceVisibilityGrants.viewerSpaceId,
    targetSpaceId: schema_1.spaceVisibilityGrants.targetSpaceId,
    grantedBy: schema_1.spaceVisibilityGrants.grantedBy,
    createdAt: schema_1.spaceVisibilityGrants.createdAt,
};
class SpaceVisibilityGrantsRepo {
    db;
    constructor(db) {
        this.db = db;
    }
    /**
     * THE fold query: every target visible to any of `viewerSpaceIds`, one
     * indexed lookup. Distinct, order irrelevant (the caller unions into a
     * Set).
     */
    async targetsForViewers(viewerSpaceIds, workspaceId, exec = this.db) {
        if (viewerSpaceIds.length === 0)
            return [];
        const rows = await exec
            .selectDistinct({
            targetSpaceId: schema_1.spaceVisibilityGrants.targetSpaceId,
        })
            .from(schema_1.spaceVisibilityGrants)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.spaceVisibilityGrants.workspaceId, workspaceId), (0, drizzle_orm_1.inArray)(schema_1.spaceVisibilityGrants.viewerSpaceId, [...viewerSpaceIds])));
        return rows.map((r) => r.targetSpaceId);
    }
    /** Every grant in the workspace — the Teams directory's `can_also_see`. */
    async listByWorkspace(workspaceId, exec = this.db) {
        return exec
            .select(grantColumns)
            .from(schema_1.spaceVisibilityGrants)
            .where((0, drizzle_orm_1.eq)(schema_1.spaceVisibilityGrants.workspaceId, workspaceId))
            .orderBy((0, drizzle_orm_1.asc)(schema_1.spaceVisibilityGrants.createdAt));
    }
    /**
     * Grant sight. Idempotent: `uq_svg_pair` absorbs a repeat (no-op update),
     * so callers do not have to pre-check. Returns true when a NEW row landed
     * (callers bump the permissions version / write audit only then).
     */
    async grant(input, exec = this.db) {
        const existing = await exec
            .select({ id: schema_1.spaceVisibilityGrants.id })
            .from(schema_1.spaceVisibilityGrants)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.spaceVisibilityGrants.viewerSpaceId, input.viewerSpaceId), (0, drizzle_orm_1.eq)(schema_1.spaceVisibilityGrants.targetSpaceId, input.targetSpaceId)))
            .limit(1);
        if (existing.length > 0)
            return false;
        await exec
            .insert(schema_1.spaceVisibilityGrants)
            .values({
            id: (0, utils_1.fakeId)("svg"),
            workspaceId: input.workspaceId,
            viewerSpaceId: input.viewerSpaceId,
            targetSpaceId: input.targetSpaceId,
            grantedBy: input.grantedBy ?? null,
        })
            .onDuplicateKeyUpdate({
            // A racing duplicate is absorbed rather than thrown.
            set: { workspaceId: input.workspaceId },
        });
        return true;
    }
    /** Revoke sight. Idempotent; returns true when a row was removed. */
    async revoke(input, exec = this.db) {
        const [result] = await exec
            .delete(schema_1.spaceVisibilityGrants)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.spaceVisibilityGrants.workspaceId, input.workspaceId), (0, drizzle_orm_1.eq)(schema_1.spaceVisibilityGrants.viewerSpaceId, input.viewerSpaceId), (0, drizzle_orm_1.eq)(schema_1.spaceVisibilityGrants.targetSpaceId, input.targetSpaceId)));
        return result.affectedRows > 0;
    }
}
exports.SpaceVisibilityGrantsRepo = SpaceVisibilityGrantsRepo;
