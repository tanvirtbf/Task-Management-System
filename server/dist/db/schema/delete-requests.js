"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.taskDeleteRequests = void 0;
// =============================================================================
// Permanent-delete approval (upgrades/023, 2026-08-16)
//   Mirrors `database/schema.sql §45` 1:1.
//
// One row per request to destroy a task for good. Anyone whose `task.delete`
// reach covers the task may raise one; only an Owner/Admin holding
// `task.delete_hard` may approve. While it is pending the task is COMPLETELY
// unchanged — a request must never be a way to make someone's work disappear.
//
// `task_name` is denormalised on purpose. The task FK cascades, so approving
// destroys this row along with the task; the name has to survive in the audit
// entry and in the requester's notification, both written BEFORE the delete.
// (Same rule the permanent MEMBER delete follows: the evidence outlives the
// thing it describes.)
//
// The SQL table also carries `pending_flag`, a VIRTUAL generated column used
// only by `uq_tdr_one_pending` (at most ONE live request per task; decided
// history stacks freely because NULLs are distinct). Like `user_roles.scope_key`
// and the 021 flag it is deliberately NOT modelled here — the app never reads
// or writes it, and a racing duplicate insert surfaces as ER_DUP_ENTRY, which
// the service reports as "someone has already asked".
//
// Every timestamp is APP-WRITTEN UTC (bound JS Date) — no `.defaultNow()`, per
// the task_reviews clock rule: the DB clock runs ~6h ahead of app-written UTC
// on this deployment.
// =============================================================================
const mysql_core_1 = require("drizzle-orm/mysql-core");
const _shared_1 = require("./_shared");
const auth_1 = require("./auth");
const hierarchy_1 = require("./hierarchy");
const tasks_1 = require("./tasks");
exports.taskDeleteRequests = (0, mysql_core_1.mysqlTable)("task_delete_requests", {
    id: (0, mysql_core_1.varchar)("id", { length: _shared_1.ID_LENGTH }).primaryKey(),
    internalId: (0, mysql_core_1.bigint)("internal_id", { mode: "bigint", unsigned: true })
        .notNull()
        .autoincrement(),
    workspaceId: (0, mysql_core_1.varchar)("workspace_id", { length: _shared_1.ID_LENGTH }).notNull(),
    /** Owning space AT REQUEST TIME (snapshot annotation). */
    spaceId: (0, mysql_core_1.varchar)("space_id", { length: _shared_1.ID_LENGTH }).notNull(),
    taskId: (0, mysql_core_1.varchar)("task_id", { length: _shared_1.ID_LENGTH }).notNull(),
    /** Survives the task, for the audit row and the decision notice. */
    taskName: (0, mysql_core_1.varchar)("task_name", { length: 500 }).notNull(),
    requestedBy: (0, mysql_core_1.varchar)("requested_by", { length: _shared_1.ID_LENGTH }).notNull(),
    reason: (0, mysql_core_1.varchar)("reason", { length: 500 }),
    status: (0, mysql_core_1.mysqlEnum)("status", _shared_1.deleteRequestStatuses)
        .notNull()
        .default("pending"),
    decidedBy: (0, mysql_core_1.varchar)("decided_by", { length: _shared_1.ID_LENGTH }),
    decidedAt: (0, mysql_core_1.timestamp)("decided_at"),
    decisionNote: (0, mysql_core_1.varchar)("decision_note", { length: 500 }),
    createdAt: (0, mysql_core_1.timestamp)("created_at").notNull(),
    updatedAt: (0, mysql_core_1.timestamp)("updated_at").notNull(),
}, (t) => ({
    internalIdUq: (0, mysql_core_1.uniqueIndex)("uq_tdr_internal_id").on(t.internalId),
    wsFk: (0, mysql_core_1.foreignKey)({
        columns: [t.workspaceId],
        foreignColumns: [auth_1.workspaces.id],
        name: "fk_tdr_ws",
    })
        .onDelete("cascade")
        .onUpdate("cascade"),
    spaceFk: (0, mysql_core_1.foreignKey)({
        columns: [t.spaceId],
        foreignColumns: [hierarchy_1.spaces.id],
        name: "fk_tdr_space",
    })
        .onDelete("cascade")
        .onUpdate("cascade"),
    taskFk: (0, mysql_core_1.foreignKey)({
        columns: [t.taskId],
        foreignColumns: [tasks_1.tasks.id],
        name: "fk_tdr_task",
    })
        .onDelete("cascade")
        .onUpdate("cascade"),
    requesterFk: (0, mysql_core_1.foreignKey)({
        columns: [t.requestedBy],
        foreignColumns: [auth_1.users.id],
        name: "fk_tdr_requested_by",
    })
        .onDelete("cascade")
        .onUpdate("cascade"),
    deciderFk: (0, mysql_core_1.foreignKey)({
        columns: [t.decidedBy],
        foreignColumns: [auth_1.users.id],
        name: "fk_tdr_decided_by",
    })
        .onDelete("set null")
        .onUpdate("cascade"),
    byWorkspace: (0, mysql_core_1.index)("idx_tdr_workspace").on(t.workspaceId, t.status, t.internalId),
    byRequester: (0, mysql_core_1.index)("idx_tdr_requester").on(t.requestedBy, t.status, t.internalId),
    byTask: (0, mysql_core_1.index)("idx_tdr_task").on(t.taskId, t.internalId),
}));
