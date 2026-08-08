"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.workspaceActivity = void 0;
// =============================================================================
// Audit — workspace-wide light activity log (1 table)
//   Mirrors `database/schema.sql §31`.
//
// Per-task activity lives in `task_activity` (see `schema/tasks.ts`). This
// table captures workspace-level events: user invited, list archived, role
// changed, sprint started, etc.  Powers `GET /activity/recent` together with
// `task_activity` via a UNION query.
// =============================================================================
const mysql_core_1 = require("drizzle-orm/mysql-core");
const _shared_1 = require("./_shared");
const auth_1 = require("./auth");
exports.workspaceActivity = (0, mysql_core_1.mysqlTable)("workspace_activity", {
    id: (0, mysql_core_1.varchar)("id", { length: _shared_1.ID_LENGTH }).primaryKey(),
    internalId: (0, mysql_core_1.bigint)("internal_id", { mode: "bigint", unsigned: true })
        .notNull()
        .autoincrement(),
    workspaceId: (0, mysql_core_1.varchar)("workspace_id", { length: _shared_1.ID_LENGTH })
        .notNull()
        .references(() => auth_1.workspaces.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
    }),
    actorId: (0, mysql_core_1.varchar)("actor_id", { length: _shared_1.ID_LENGTH }),
    entityType: (0, mysql_core_1.mysqlEnum)("entity_type", _shared_1.workspaceActivityEntityTypes).notNull(),
    entityId: (0, mysql_core_1.varchar)("entity_id", { length: _shared_1.ID_LENGTH }).notNull(),
    action: (0, mysql_core_1.varchar)("action", { length: 60 }).notNull(),
    context: (0, mysql_core_1.json)("context").$type(),
    ipAddress: (0, mysql_core_1.varchar)("ip_address", { length: _shared_1.IP_LENGTH }),
    createdAt: (0, mysql_core_1.timestamp)("created_at").notNull().defaultNow(),
}, (t) => ({
    internalIdUq: (0, mysql_core_1.uniqueIndex)("uq_workspace_activity_internal_id").on(t.internalId),
    actorFk: (0, mysql_core_1.foreignKey)({
        columns: [t.actorId],
        foreignColumns: [auth_1.users.id],
        name: "fk_workspace_activity_actor",
    })
        .onDelete("set null")
        .onUpdate("cascade"),
    workspaceTimeIdx: (0, mysql_core_1.index)("idx_workspace_activity_workspace_time").on(t.workspaceId, t.createdAt),
    entityIdx: (0, mysql_core_1.index)("idx_workspace_activity_entity").on(t.entityType, t.entityId),
    // F30 (ISS-088): both feed reads order by `internal_id` DESC — the
    // time index cannot serve that order, so every page filesorted.
    workspaceInternalIdx: (0, mysql_core_1.index)("idx_workspace_activity_ws_internal").on(t.workspaceId, t.internalId),
}));
