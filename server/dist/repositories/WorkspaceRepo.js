"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WorkspaceRepo = void 0;
const drizzle_orm_1 = require("drizzle-orm");
const schema_1 = require("../db/schema");
/** Projection shared by every read so the wire shape can't drift between them. */
const workspaceColumns = {
    id: schema_1.workspaces.id,
    name: schema_1.workspaces.name,
    logoUrl: schema_1.workspaces.logoUrl,
    timezone: schema_1.workspaces.timezone,
    defaultLocale: schema_1.workspaces.defaultLocale,
    weekStartsOn: schema_1.workspaces.weekStartsOn,
    workingDays: schema_1.workspaces.workingDays,
    businessHoursStart: schema_1.workspaces.businessHoursStart,
    businessHoursEnd: schema_1.workspaces.businessHoursEnd,
};
class WorkspaceRepo {
    db;
    constructor(db) {
        this.db = db;
    }
    /**
     * Look up the single workspace row by primary key. Returns the tight
     * `WorkspaceRecord` projection (never the raw row, so `created_at` /
     * `updated_at` don't leak into a response shape). `null` when no row
     * matches — the service maps that to a 404.
     *
     * `working_days` is a MySQL SET; the Drizzle `mysqlSet` custom type returns
     * it already split into an array of day-name literals (`["sun","mon",…]`),
     * matching the wire shape directly.
     */
    async findById(workspaceId, exec = this.db) {
        const [row] = await exec
            .select(workspaceColumns)
            .from(schema_1.workspaces)
            .where((0, drizzle_orm_1.eq)(schema_1.workspaces.id, workspaceId))
            .limit(1);
        return row ?? null;
    }
    /**
     * Every workspace's id + timezone — the overdue-alert job's outer loop
     * ("today" is per-workspace, F5 rule). V1 is single-tenant so this is one
     * row in practice; test databases hold many.
     */
    async listAll() {
        return this.db
            .select({ id: schema_1.workspaces.id, timezone: schema_1.workspaces.timezone })
            .from(schema_1.workspaces);
    }
    /**
     * Same projection as `findById`, but takes a `FOR UPDATE` row lock so a
     * service can read-merge-write inside one transaction without a lost-update
     * race (used by the PATCH business-hours merge check). Must run inside a
     * transaction — pass the `tx` executor.
     */
    async findByIdForUpdate(workspaceId, exec) {
        const [row] = await exec
            .select(workspaceColumns)
            .from(schema_1.workspaces)
            .where((0, drizzle_orm_1.eq)(schema_1.workspaces.id, workspaceId))
            .limit(1)
            .for("update");
        return row ?? null;
    }
    /**
     * Apply a partial update and return the refreshed projection. Only the
     * whitelisted `WorkspaceUpdateColumns` are written. The caller guarantees
     * `patch` is non-empty and the row exists (the service runs the 404 guard
     * under the same lock first).
     */
    async update(workspaceId, patch, exec = this.db) {
        await exec
            .update(schema_1.workspaces)
            .set(patch)
            .where((0, drizzle_orm_1.eq)(schema_1.workspaces.id, workspaceId));
        const updated = await this.findById(workspaceId, exec);
        if (!updated) {
            // The service proved the row exists under the same lock just above,
            // so a miss here is an unreachable invariant violation, not a 404.
            throw new Error(`Workspace ${workspaceId} disappeared mid-update`);
        }
        return updated;
    }
}
exports.WorkspaceRepo = WorkspaceRepo;
