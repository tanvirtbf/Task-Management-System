"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.taskAssignmentRequestEvents = exports.taskAssignmentRequests = void 0;
// =============================================================================
// Team-access P8 — cross-team assignment approval (2 tables)
//   Mirrors `database/schema.sql §43 / §44` (upgrades/021) 1:1.
//
// `task_assignment_requests` holds the CURRENT state of one negotiation —
// created when an assignment targets someone who is not a member of the space
// owning the task (Q11). `task_assignment_request_events` is the append-only
// ledger of every action (the task_reviews shape), so the drawer panel can
// show the whole back-and-forth.
//
// The SQL table also carries `pending_flag`, a VIRTUAL generated column used
// only by `uq_tar_one_pending` (at most one PENDING request per (task, user);
// decided history stacks freely because NULLs are distinct). Like user_roles'
// `scope_key`, it is deliberately NOT modelled here — the app never reads or
// writes it; the racing-duplicate insert surfaces as an ER_DUP_ENTRY the
// service treats as "someone already asked".
//
// Every timestamp is APP-WRITTEN UTC (bound JS Date) — deliberately NO
// `.defaultNow()` (the task_reviews clock rule): request rows are
// window-compared against `expires_at` and DB-clock defaults run ~6h ahead of
// app-written UTC on this deployment.
// =============================================================================
const mysql_core_1 = require("drizzle-orm/mysql-core");
const _shared_1 = require("./_shared");
const auth_1 = require("./auth");
const hierarchy_1 = require("./hierarchy");
const tasks_1 = require("./tasks");
exports.taskAssignmentRequests = (0, mysql_core_1.mysqlTable)("task_assignment_requests", {
    id: (0, mysql_core_1.varchar)("id", { length: _shared_1.ID_LENGTH }).primaryKey(),
    internalId: (0, mysql_core_1.bigint)("internal_id", { mode: "bigint", unsigned: true })
        .notNull()
        .autoincrement(),
    workspaceId: (0, mysql_core_1.varchar)("workspace_id", { length: _shared_1.ID_LENGTH }).notNull(),
    // Owning space AT REQUEST TIME (snapshot annotation — live bucketing
    // always derives via primary_list_id → lists.space_id).
    spaceId: (0, mysql_core_1.varchar)("space_id", { length: _shared_1.ID_LENGTH }).notNull(),
    taskId: (0, mysql_core_1.varchar)("task_id", { length: _shared_1.ID_LENGTH }).notNull(),
    targetUserId: (0, mysql_core_1.varchar)("target_user_id", {
        length: _shared_1.ID_LENGTH,
    }).notNull(),
    requestedBy: (0, mysql_core_1.varchar)("requested_by", { length: _shared_1.ID_LENGTH }).notNull(),
    status: (0, mysql_core_1.mysqlEnum)("status", _shared_1.assignmentRequestStatuses)
        .notNull()
        .default("pending"),
    requestNote: (0, mysql_core_1.varchar)("request_note", { length: 500 }),
    queryNote: (0, mysql_core_1.varchar)("query_note", { length: 500 }),
    // Same calendar-day domain as tasks.due_date.
    proposedDueDate: (0, mysql_core_1.date)("proposed_due_date", { mode: "string" }),
    decidedBy: (0, mysql_core_1.varchar)("decided_by", { length: _shared_1.ID_LENGTH }),
    decidedAt: (0, mysql_core_1.timestamp)("decided_at"),
    expiresAt: (0, mysql_core_1.timestamp)("expires_at").notNull(),
    createdAt: (0, mysql_core_1.timestamp)("created_at").notNull(),
    updatedAt: (0, mysql_core_1.timestamp)("updated_at").notNull(),
}, (t) => ({
    internalIdUq: (0, mysql_core_1.uniqueIndex)("uq_tar_internal_id").on(t.internalId),
    wsFk: (0, mysql_core_1.foreignKey)({
        columns: [t.workspaceId],
        foreignColumns: [auth_1.workspaces.id],
        name: "fk_tar_ws",
    })
        .onDelete("cascade")
        .onUpdate("cascade"),
    spaceFk: (0, mysql_core_1.foreignKey)({
        columns: [t.spaceId],
        foreignColumns: [hierarchy_1.spaces.id],
        name: "fk_tar_space",
    })
        .onDelete("cascade")
        .onUpdate("cascade"),
    taskFk: (0, mysql_core_1.foreignKey)({
        columns: [t.taskId],
        foreignColumns: [tasks_1.tasks.id],
        name: "fk_tar_task",
    })
        .onDelete("cascade")
        .onUpdate("cascade"),
    // CASCADE (not RESTRICT): a negotiation is meaningless without its
    // people, and users are soft-deactivated in practice anyway.
    targetFk: (0, mysql_core_1.foreignKey)({
        columns: [t.targetUserId],
        foreignColumns: [auth_1.users.id],
        name: "fk_tar_target",
    })
        .onDelete("cascade")
        .onUpdate("cascade"),
    requestedByFk: (0, mysql_core_1.foreignKey)({
        columns: [t.requestedBy],
        foreignColumns: [auth_1.users.id],
        name: "fk_tar_requested_by",
    })
        .onDelete("cascade")
        .onUpdate("cascade"),
    decidedByFk: (0, mysql_core_1.foreignKey)({
        columns: [t.decidedBy],
        foreignColumns: [auth_1.users.id],
        name: "fk_tar_decided_by",
    })
        .onDelete("set null")
        .onUpdate("cascade"),
    targetIdx: (0, mysql_core_1.index)("idx_tar_target").on(t.targetUserId, t.status, t.internalId),
    requesterIdx: (0, mysql_core_1.index)("idx_tar_requester").on(t.requestedBy, t.status, t.internalId),
    taskTimeIdx: (0, mysql_core_1.index)("idx_tar_task_time").on(t.taskId, t.internalId),
    expiryIdx: (0, mysql_core_1.index)("idx_tar_expiry").on(t.status, t.expiresAt),
    workspaceIdx: (0, mysql_core_1.index)("idx_tar_workspace").on(t.workspaceId, t.status),
}));
exports.taskAssignmentRequestEvents = (0, mysql_core_1.mysqlTable)("task_assignment_request_events", {
    id: (0, mysql_core_1.varchar)("id", { length: _shared_1.ID_LENGTH }).primaryKey(),
    internalId: (0, mysql_core_1.bigint)("internal_id", { mode: "bigint", unsigned: true })
        .notNull()
        .autoincrement(),
    requestId: (0, mysql_core_1.varchar)("request_id", { length: _shared_1.ID_LENGTH }).notNull(),
    // NULL = the system (the expiry janitor).
    actorId: (0, mysql_core_1.varchar)("actor_id", { length: _shared_1.ID_LENGTH }),
    action: (0, mysql_core_1.mysqlEnum)("action", _shared_1.assignmentRequestEventActions).notNull(),
    note: (0, mysql_core_1.varchar)("note", { length: 500 }),
    // For 'queried': the proposal. For 'answered': the date applied.
    proposedDueDate: (0, mysql_core_1.date)("proposed_due_date", { mode: "string" }),
    createdAt: (0, mysql_core_1.timestamp)("created_at").notNull(),
}, (t) => ({
    internalIdUq: (0, mysql_core_1.uniqueIndex)("uq_tare_internal_id").on(t.internalId),
    requestFk: (0, mysql_core_1.foreignKey)({
        columns: [t.requestId],
        foreignColumns: [exports.taskAssignmentRequests.id],
        name: "fk_tare_request",
    })
        .onDelete("cascade")
        .onUpdate("cascade"),
    actorFk: (0, mysql_core_1.foreignKey)({
        columns: [t.actorId],
        foreignColumns: [auth_1.users.id],
        name: "fk_tare_actor",
    })
        .onDelete("set null")
        .onUpdate("cascade"),
    requestTimeIdx: (0, mysql_core_1.index)("idx_tare_request_time").on(t.requestId, t.internalId),
}));
