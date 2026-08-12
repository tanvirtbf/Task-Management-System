"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.taskActivity = exports.taskDependencies = exports.taskTags = exports.taskWatchers = exports.taskAssignees = exports.tasks = void 0;
// =============================================================================
// Tasks — the central table + M2M junctions + dependencies + activity
//   Mirrors `database/schema.sql §13-17 + §20`.
//
// 6 tables: tasks, task_assignees, task_watchers, task_tags, task_dependencies,
//           task_activity
//
// The `tasks` table holds operational fields (status, priority, due_date) AND
// engineering fields (sprint_id, story_points, reviewer_id, branch_name,
// pr_url, bug_severity, …). The latter are NULL for non-dev task types and
// gated by `task_types.is_dev_type` in the application layer.
// =============================================================================
const drizzle_orm_1 = require("drizzle-orm");
const mysql_core_1 = require("drizzle-orm/mysql-core");
const _shared_1 = require("./_shared");
const auth_1 = require("./auth");
const hierarchy_1 = require("./hierarchy");
const sprints_1 = require("./sprints");
// ─── tasks ────────────────────────────────────────────────────────────────────
exports.tasks = (0, mysql_core_1.mysqlTable)("tasks", {
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
    primaryListId: (0, mysql_core_1.varchar)("primary_list_id", { length: _shared_1.ID_LENGTH })
        .notNull()
        .references(() => hierarchy_1.lists.id, {
        onDelete: "restrict",
        onUpdate: "cascade",
    }),
    taskNumber: (0, mysql_core_1.int)("task_number", { unsigned: true }).notNull(),
    customId: (0, mysql_core_1.varchar)("custom_id", { length: 40 }),
    name: (0, mysql_core_1.varchar)("name", { length: 500 }).notNull(),
    description: (0, mysql_core_1.mediumtext)("description"),
    statusId: (0, mysql_core_1.varchar)("status_id", { length: _shared_1.ID_LENGTH })
        .notNull()
        .references(() => hierarchy_1.statuses.id, {
        onDelete: "restrict",
        onUpdate: "cascade",
    }),
    priority: (0, mysql_core_1.tinyint)("priority", { unsigned: true }).notNull().default(0),
    taskTypeId: (0, mysql_core_1.varchar)("task_type_id", { length: _shared_1.ID_LENGTH })
        .notNull()
        .references(() => hierarchy_1.taskTypes.id, {
        onDelete: "restrict",
        onUpdate: "cascade",
    }),
    parentTaskId: (0, mysql_core_1.varchar)("parent_task_id", { length: _shared_1.ID_LENGTH }),
    nestingDepth: (0, mysql_core_1.tinyint)("nesting_depth", { unsigned: true })
        .notNull()
        .default(0),
    isMilestone: (0, mysql_core_1.boolean)("is_milestone").notNull().default(false),
    startDate: (0, mysql_core_1.date)("start_date"),
    dueDate: (0, mysql_core_1.date)("due_date"),
    completedAt: (0, mysql_core_1.timestamp)("completed_at"),
    // Overdue-alert claim (upgrades/014): set by the overdue-alert job in
    // the same tx as its `overdue` notification fanout (exactly once per
    // due_date); TaskWriteService clears it whenever due_date changes so a
    // moved deadline re-arms the alert.
    overdueNotifiedAt: (0, mysql_core_1.timestamp)("overdue_notified_at"),
    // ─── Dept Review V1 — current review state (denorm; app-maintained in
    // the same tx as the task_reviews insert — NO triggers). reviewedAt is
    // app-written UTC. Cleared whenever the task leaves a done group. ─────
    reviewStatus: (0, mysql_core_1.mysqlEnum)("review_status", _shared_1.reviewStatuses),
    reviewedAt: (0, mysql_core_1.timestamp)("reviewed_at"),
    reviewedBy: (0, mysql_core_1.varchar)("reviewed_by", { length: _shared_1.ID_LENGTH }),
    // ─── SLA (P0) ────────────────────────────────────────────────────────
    slaDueAt: (0, mysql_core_1.timestamp)("sla_due_at"),
    // ─── Recurrence (simple per spec) ────────────────────────────────────
    recurrencePattern: (0, mysql_core_1.mysqlEnum)("recurrence_pattern", _shared_1.recurrencePatterns)
        .notNull()
        .default("none"),
    recurrenceDays: (0, _shared_1.mysqlSet)("recurrence_days", _shared_1.weekDays),
    recurrenceEndsAt: (0, mysql_core_1.date)("recurrence_ends_at"),
    timeEstimateSeconds: (0, mysql_core_1.int)("time_estimate_seconds", { unsigned: true }),
    timeTrackedSeconds: (0, mysql_core_1.int)("time_tracked_seconds", { unsigned: true })
        .notNull()
        .default(0),
    // ─── Denormalised counters (maintained by triggers) ──────────────────
    subtasksCount: (0, mysql_core_1.int)("subtasks_count", { unsigned: true })
        .notNull()
        .default(0),
    subtasksCompleted: (0, mysql_core_1.int)("subtasks_completed", { unsigned: true })
        .notNull()
        .default(0),
    commentsCount: (0, mysql_core_1.int)("comments_count", { unsigned: true })
        .notNull()
        .default(0),
    attachmentsCount: (0, mysql_core_1.int)("attachments_count", { unsigned: true })
        .notNull()
        .default(0),
    // Checklist rollup (upgrades/022) — items across ALL the task's
    // checklists, app-maintained per item write (absolute recompute).
    checklistItemsTotal: (0, mysql_core_1.int)("checklist_items_total", { unsigned: true })
        .notNull()
        .default(0),
    checklistItemsDone: (0, mysql_core_1.int)("checklist_items_done", { unsigned: true })
        .notNull()
        .default(0),
    // ─── Engineering-only fields (NULL for operational tasks) ────────────
    sprintId: (0, mysql_core_1.varchar)("sprint_id", { length: _shared_1.ID_LENGTH }),
    storyPoints: (0, mysql_core_1.tinyint)("story_points", { unsigned: true }),
    reviewerId: (0, mysql_core_1.varchar)("reviewer_id", { length: _shared_1.ID_LENGTH }),
    branchName: (0, mysql_core_1.varchar)("branch_name", { length: 200 }),
    prUrl: (0, mysql_core_1.varchar)("pr_url", { length: _shared_1.URL_LENGTH }),
    prStatus: (0, mysql_core_1.mysqlEnum)("pr_status", _shared_1.prStatuses),
    bugSeverity: (0, mysql_core_1.mysqlEnum)("bug_severity", _shared_1.bugSeverities),
    bugReproducibility: (0, mysql_core_1.mysqlEnum)("bug_reproducibility", _shared_1.bugReproducibilities),
    bugEnvironment: (0, mysql_core_1.mysqlEnum)("bug_environment", _shared_1.bugEnvironments),
    bugBrowser: (0, mysql_core_1.varchar)("bug_browser", { length: 120 }),
    reporterTeam: (0, mysql_core_1.mysqlEnum)("reporter_team", _shared_1.reporterTeams),
    deployedAt: (0, mysql_core_1.timestamp)("deployed_at"),
    rollbackReason: (0, mysql_core_1.varchar)("rollback_reason", { length: 500 }),
    archivedAt: (0, mysql_core_1.timestamp)("archived_at"),
    createdBy: (0, mysql_core_1.varchar)("created_by", { length: _shared_1.ID_LENGTH }).notNull(),
    createdAt: (0, mysql_core_1.timestamp)("created_at").notNull().defaultNow(),
    updatedAt: (0, mysql_core_1.timestamp)("updated_at").notNull().defaultNow().onUpdateNow(),
}, (t) => ({
    internalIdUq: (0, mysql_core_1.uniqueIndex)("uq_tasks_internal_id").on(t.internalId),
    customIdUq: (0, mysql_core_1.uniqueIndex)("uq_tasks_custom_id").on(t.workspaceId, t.customId),
    listNumberUq: (0, mysql_core_1.uniqueIndex)("uq_tasks_list_number").on(t.primaryListId, t.taskNumber),
    parentFk: (0, mysql_core_1.foreignKey)({
        columns: [t.parentTaskId],
        foreignColumns: [t.id],
        name: "fk_tasks_parent",
    })
        .onDelete("cascade")
        .onUpdate("cascade"),
    sprintFk: (0, mysql_core_1.foreignKey)({
        columns: [t.sprintId],
        foreignColumns: [sprints_1.sprints.id],
        name: "fk_tasks_sprint",
    })
        .onDelete("set null")
        .onUpdate("cascade"),
    reviewerFk: (0, mysql_core_1.foreignKey)({
        columns: [t.reviewerId],
        foreignColumns: [auth_1.users.id],
        name: "fk_tasks_reviewer",
    })
        .onDelete("set null")
        .onUpdate("cascade"),
    reviewedByFk: (0, mysql_core_1.foreignKey)({
        columns: [t.reviewedBy],
        foreignColumns: [auth_1.users.id],
        name: "fk_tasks_reviewed_by",
    })
        .onDelete("set null")
        .onUpdate("cascade"),
    createdByFk: (0, mysql_core_1.foreignKey)({
        columns: [t.createdBy],
        foreignColumns: [auth_1.users.id],
        name: "fk_tasks_created_by",
    })
        .onDelete("restrict")
        .onUpdate("cascade"),
    priorityCk: (0, mysql_core_1.check)("ck_tasks_priority", (0, drizzle_orm_1.sql) `${t.priority} BETWEEN 0 AND 4`),
    nestingCk: (0, mysql_core_1.check)("ck_tasks_nesting", (0, drizzle_orm_1.sql) `${t.nestingDepth} <= 2`),
    datesCk: (0, mysql_core_1.check)("ck_tasks_dates", (0, drizzle_orm_1.sql) `${t.startDate} IS NULL OR ${t.dueDate} IS NULL OR ${t.startDate} <= ${t.dueDate}`),
    // Hot indexes — every one mirrors a query path in the frontend.
    listActiveIdx: (0, mysql_core_1.index)("idx_tasks_list_active").on(t.primaryListId, t.archivedAt, t.statusId, t.dueDate),
    sprintIdx: (0, mysql_core_1.index)("idx_tasks_sprint").on(t.sprintId, t.statusId),
    reviewerIdx: (0, mysql_core_1.index)("idx_tasks_reviewer").on(t.reviewerId, t.prStatus),
    statusUpdatedIdx: (0, mysql_core_1.index)("idx_tasks_status_updated").on(t.statusId, t.updatedAt),
    customIdIdx: (0, mysql_core_1.index)("idx_tasks_custom_id").on(t.customId),
    parentIdx: (0, mysql_core_1.index)("idx_tasks_parent").on(t.parentTaskId),
    severityIdx: (0, mysql_core_1.index)("idx_tasks_severity").on(t.bugSeverity, t.statusId),
    recurrenceIdx: (0, mysql_core_1.index)("idx_tasks_recurrence").on(t.recurrencePattern, t.dueDate),
    slaIdx: (0, mysql_core_1.index)("idx_tasks_sla").on(t.slaDueAt, t.completedAt, t.archivedAt),
    // F30 (ISS-088): list pagination orders by `internal_id` while every
    // index above ends in a status/date column, so the page was found by
    // index and then FILESORTED. This matches the actual ORDER BY of
    // `TasksRepo.listByList` and removes the sort at any list size.
    listInternalIdx: (0, mysql_core_1.index)("idx_tasks_list_internal").on(t.primaryListId, t.internalId),
    // upgrades/014: the overdue-alert job's every-10-min scan.
    overdueScanIdx: (0, mysql_core_1.index)("idx_tasks_overdue_scan").on(t.dueDate, t.completedAt, t.archivedAt, t.overdueNotifiedAt),
}));
// ─── task_assignees ─ M2M users ↔ tasks ───────────────────────────────────────
exports.taskAssignees = (0, mysql_core_1.mysqlTable)("task_assignees", {
    taskId: (0, mysql_core_1.varchar)("task_id", { length: _shared_1.ID_LENGTH })
        .notNull()
        .references(() => exports.tasks.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
    }),
    userId: (0, mysql_core_1.varchar)("user_id", { length: _shared_1.ID_LENGTH })
        .notNull()
        .references(() => auth_1.users.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
    }),
    assignedAt: (0, mysql_core_1.timestamp)("assigned_at").notNull().defaultNow(),
    assignedBy: (0, mysql_core_1.varchar)("assigned_by", { length: _shared_1.ID_LENGTH }),
}, (t) => ({
    pk: (0, mysql_core_1.primaryKey)({ columns: [t.taskId, t.userId] }),
    assignedByFk: (0, mysql_core_1.foreignKey)({
        columns: [t.assignedBy],
        foreignColumns: [auth_1.users.id],
        name: "fk_task_assignees_assigned_by",
    })
        .onDelete("set null")
        .onUpdate("cascade"),
    userIdx: (0, mysql_core_1.index)("idx_task_assignees_user").on(t.userId, t.taskId),
}));
// ─── task_watchers ────────────────────────────────────────────────────────────
exports.taskWatchers = (0, mysql_core_1.mysqlTable)("task_watchers", {
    taskId: (0, mysql_core_1.varchar)("task_id", { length: _shared_1.ID_LENGTH })
        .notNull()
        .references(() => exports.tasks.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
    }),
    userId: (0, mysql_core_1.varchar)("user_id", { length: _shared_1.ID_LENGTH })
        .notNull()
        .references(() => auth_1.users.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
    }),
    startedAt: (0, mysql_core_1.timestamp)("started_at").notNull().defaultNow(),
}, (t) => ({
    pk: (0, mysql_core_1.primaryKey)({ columns: [t.taskId, t.userId] }),
    userIdx: (0, mysql_core_1.index)("idx_task_watchers_user").on(t.userId),
}));
// ─── task_tags ────────────────────────────────────────────────────────────────
exports.taskTags = (0, mysql_core_1.mysqlTable)("task_tags", {
    taskId: (0, mysql_core_1.varchar)("task_id", { length: _shared_1.ID_LENGTH })
        .notNull()
        .references(() => exports.tasks.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
    }),
    tagId: (0, mysql_core_1.varchar)("tag_id", { length: _shared_1.ID_LENGTH })
        .notNull()
        .references(() => hierarchy_1.tags.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
    }),
    addedAt: (0, mysql_core_1.timestamp)("added_at").notNull().defaultNow(),
}, (t) => ({
    pk: (0, mysql_core_1.primaryKey)({ columns: [t.taskId, t.tagId] }),
    tagIdx: (0, mysql_core_1.index)("idx_task_tags_tag").on(t.tagId),
}));
// ─── task_dependencies ─ blocks / blocked-by ──────────────────────────────────
// The CHECK constraint `task_id <> related_task_id` cannot live in the table
// (MySQL 8 forbids it because both columns are in cascading FKs); it is
// enforced by `trg_task_dependencies_no_self_*` in `_post.sql`.
exports.taskDependencies = (0, mysql_core_1.mysqlTable)("task_dependencies", {
    id: (0, mysql_core_1.varchar)("id", { length: _shared_1.ID_LENGTH }).primaryKey(),
    taskId: (0, mysql_core_1.varchar)("task_id", { length: _shared_1.ID_LENGTH })
        .notNull()
        .references(() => exports.tasks.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
    }),
    relatedTaskId: (0, mysql_core_1.varchar)("related_task_id", { length: _shared_1.ID_LENGTH })
        .notNull()
        .references(() => exports.tasks.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
    }),
    depType: (0, mysql_core_1.mysqlEnum)("dep_type", _shared_1.dependencyTypes)
        .notNull()
        .default("blocks"),
    createdAt: (0, mysql_core_1.timestamp)("created_at").notNull().defaultNow(),
    createdBy: (0, mysql_core_1.varchar)("created_by", { length: _shared_1.ID_LENGTH }).notNull(),
}, (t) => ({
    uq: (0, mysql_core_1.uniqueIndex)("uq_task_dependencies").on(t.taskId, t.relatedTaskId, t.depType),
    createdByFk: (0, mysql_core_1.foreignKey)({
        columns: [t.createdBy],
        foreignColumns: [auth_1.users.id],
        name: "fk_task_dependencies_created_by",
    })
        .onDelete("restrict")
        .onUpdate("cascade"),
    relatedIdx: (0, mysql_core_1.index)("idx_task_dependencies_related").on(t.relatedTaskId),
}));
// ─── task_activity ─ per-task audit feed ──────────────────────────────────────
exports.taskActivity = (0, mysql_core_1.mysqlTable)("task_activity", {
    id: (0, mysql_core_1.varchar)("id", { length: _shared_1.ID_LENGTH }).primaryKey(),
    internalId: (0, mysql_core_1.bigint)("internal_id", { mode: "bigint", unsigned: true })
        .notNull()
        .autoincrement(),
    taskId: (0, mysql_core_1.varchar)("task_id", { length: _shared_1.ID_LENGTH })
        .notNull()
        .references(() => exports.tasks.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
    }),
    actorId: (0, mysql_core_1.varchar)("actor_id", { length: _shared_1.ID_LENGTH }),
    action: (0, mysql_core_1.varchar)("action", { length: 60 }).notNull(),
    context: (0, mysql_core_1.json)("context").$type(),
    createdAt: (0, mysql_core_1.timestamp)("created_at").notNull().defaultNow(),
}, (t) => ({
    internalIdUq: (0, mysql_core_1.uniqueIndex)("uq_task_activity_internal_id").on(t.internalId),
    actorFk: (0, mysql_core_1.foreignKey)({
        columns: [t.actorId],
        foreignColumns: [auth_1.users.id],
        name: "fk_task_activity_actor",
    })
        .onDelete("set null")
        .onUpdate("cascade"),
    taskTimeIdx: (0, mysql_core_1.index)("idx_task_activity_task_time").on(t.taskId, t.createdAt),
    // F30 (ISS-088): the feed orders by `internal_id` DESC; the time index
    // above cannot serve that order, so every page filesorted.
    taskInternalIdx: (0, mysql_core_1.index)("idx_task_activity_task_internal").on(t.taskId, t.internalId),
}));
