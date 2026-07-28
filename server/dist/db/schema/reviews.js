"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.taskReviews = void 0;
// =============================================================================
// Dept Review V1 — task_reviews (append-only head-verdict ledger)
//   Mirrors `database/schema.sql §36` 1:1.
//
// One row per review ACTION (approve ✓ / flag ⚑). The task's CURRENT review
// state is denormalised onto `tasks.review_status/reviewed_at/reviewed_by` and
// maintained app-side in the SAME transaction as the insert here (NO DB
// triggers — the 1442 lesson).
//
// `created_at` is APP-WRITTEN UTC (bound JS Date) — deliberately NO
// `.defaultNow()`: DB-clock defaults run ~6h ahead of app-written UTC
// timestamps on this deployment (the M8/KI-2 clock-domain rule), and review
// rows are window-filtered into weekly reports, so they must live in the
// app-UTC domain.
//
// `workspace_id`/`space_id` are historical snapshot ANNOTATIONS (report
// attribution). Live bucketing (queues/summaries) always derives a task's
// space via `primary_list_id → lists.space_id` — never from these columns.
// =============================================================================
const mysql_core_1 = require("drizzle-orm/mysql-core");
const _shared_1 = require("./_shared");
const auth_1 = require("./auth");
const hierarchy_1 = require("./hierarchy");
const tasks_1 = require("./tasks");
exports.taskReviews = (0, mysql_core_1.mysqlTable)("task_reviews", {
    id: (0, mysql_core_1.varchar)("id", { length: _shared_1.ID_LENGTH }).primaryKey(),
    // Keyset-cursor / deterministic-ordering column (repo convention —
    // never exposed on the wire).
    internalId: (0, mysql_core_1.bigint)("internal_id", { mode: "bigint", unsigned: true })
        .notNull()
        .autoincrement(),
    workspaceId: (0, mysql_core_1.varchar)("workspace_id", { length: _shared_1.ID_LENGTH }).notNull(),
    spaceId: (0, mysql_core_1.varchar)("space_id", { length: _shared_1.ID_LENGTH }).notNull(),
    taskId: (0, mysql_core_1.varchar)("task_id", { length: _shared_1.ID_LENGTH }).notNull(),
    reviewerId: (0, mysql_core_1.varchar)("reviewer_id", { length: _shared_1.ID_LENGTH }).notNull(),
    status: (0, mysql_core_1.mysqlEnum)("status", _shared_1.reviewStatuses).notNull(),
    note: (0, mysql_core_1.varchar)("note", { length: 500 }),
    // App-written UTC — no DB default (see header).
    createdAt: (0, mysql_core_1.timestamp)("created_at").notNull(),
}, (t) => ({
    internalIdUq: (0, mysql_core_1.uniqueIndex)("uq_task_reviews_internal_id").on(t.internalId),
    wsFk: (0, mysql_core_1.foreignKey)({
        columns: [t.workspaceId],
        foreignColumns: [auth_1.workspaces.id],
        name: "fk_task_reviews_ws",
    })
        .onDelete("cascade")
        .onUpdate("cascade"),
    spaceFk: (0, mysql_core_1.foreignKey)({
        columns: [t.spaceId],
        foreignColumns: [hierarchy_1.spaces.id],
        name: "fk_task_reviews_space",
    })
        .onDelete("cascade")
        .onUpdate("cascade"),
    taskFk: (0, mysql_core_1.foreignKey)({
        columns: [t.taskId],
        foreignColumns: [tasks_1.tasks.id],
        name: "fk_task_reviews_task",
    })
        .onDelete("cascade")
        .onUpdate("cascade"),
    // RESTRICT (not CASCADE/SET NULL): the ledger is an accountability
    // record — users are soft-deactivated in this system, never deleted,
    // and a hard delete must not silently destroy review history.
    reviewerFk: (0, mysql_core_1.foreignKey)({
        columns: [t.reviewerId],
        foreignColumns: [auth_1.users.id],
        name: "fk_task_reviews_reviewer",
    })
        .onDelete("restrict")
        .onUpdate("cascade"),
    spaceTimeIdx: (0, mysql_core_1.index)("idx_task_reviews_space_time").on(t.spaceId, t.internalId),
    taskTimeIdx: (0, mysql_core_1.index)("idx_task_reviews_task_time").on(t.taskId, t.internalId),
}));
