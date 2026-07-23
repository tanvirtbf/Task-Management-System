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
import { sql } from "drizzle-orm";
import {
    bigint,
    boolean,
    check,
    date,
    foreignKey,
    index,
    int,
    json,
    mediumtext,
    mysqlEnum,
    mysqlTable,
    primaryKey,
    timestamp,
    tinyint,
    uniqueIndex,
    varchar,
} from "drizzle-orm/mysql-core";
import {
    ID_LENGTH,
    URL_LENGTH,
    bugEnvironments,
    bugReproducibilities,
    bugSeverities,
    dependencyTypes,
    mysqlSet,
    prStatuses,
    recurrencePatterns,
    reporterTeams,
    reviewStatuses,
    weekDays,
} from "./_shared";
import { workspaces, users } from "./auth";
import { lists, statuses, taskTypes, tags } from "./hierarchy";
import { sprints } from "./sprints";

// ─── tasks ────────────────────────────────────────────────────────────────────
export const tasks = mysqlTable(
    "tasks",
    {
        id: varchar("id", { length: ID_LENGTH }).primaryKey(),
        internalId: bigint("internal_id", { mode: "bigint", unsigned: true })
            .notNull()
            .autoincrement(),
        workspaceId: varchar("workspace_id", { length: ID_LENGTH })
            .notNull()
            .references(() => workspaces.id, {
                onDelete: "cascade",
                onUpdate: "cascade",
            }),
        primaryListId: varchar("primary_list_id", { length: ID_LENGTH })
            .notNull()
            .references(() => lists.id, {
                onDelete: "restrict",
                onUpdate: "cascade",
            }),
        taskNumber: int("task_number", { unsigned: true }).notNull(),
        customId: varchar("custom_id", { length: 40 }),

        name: varchar("name", { length: 500 }).notNull(),
        description: mediumtext("description"),

        statusId: varchar("status_id", { length: ID_LENGTH })
            .notNull()
            .references(() => statuses.id, {
                onDelete: "restrict",
                onUpdate: "cascade",
            }),
        priority: tinyint("priority", { unsigned: true }).notNull().default(0),
        taskTypeId: varchar("task_type_id", { length: ID_LENGTH })
            .notNull()
            .references(() => taskTypes.id, {
                onDelete: "restrict",
                onUpdate: "cascade",
            }),

        parentTaskId: varchar("parent_task_id", { length: ID_LENGTH }),
        nestingDepth: tinyint("nesting_depth", { unsigned: true })
            .notNull()
            .default(0),
        isMilestone: boolean("is_milestone").notNull().default(false),

        startDate: date("start_date"),
        dueDate: date("due_date"),
        completedAt: timestamp("completed_at"),

        // ─── Dept Review V1 — current review state (denorm; app-maintained in
        // the same tx as the task_reviews insert — NO triggers). reviewedAt is
        // app-written UTC. Cleared whenever the task leaves a done group. ─────
        reviewStatus: mysqlEnum("review_status", reviewStatuses),
        reviewedAt: timestamp("reviewed_at"),
        reviewedBy: varchar("reviewed_by", { length: ID_LENGTH }),

        // ─── SLA (P0) ────────────────────────────────────────────────────────
        slaDueAt: timestamp("sla_due_at"),

        // ─── Recurrence (simple per spec) ────────────────────────────────────
        recurrencePattern: mysqlEnum("recurrence_pattern", recurrencePatterns)
            .notNull()
            .default("none"),
        recurrenceDays: mysqlSet("recurrence_days", weekDays),
        recurrenceEndsAt: date("recurrence_ends_at"),

        timeEstimateSeconds: int("time_estimate_seconds", { unsigned: true }),
        timeTrackedSeconds: int("time_tracked_seconds", { unsigned: true })
            .notNull()
            .default(0),

        // ─── Denormalised counters (maintained by triggers) ──────────────────
        subtasksCount: int("subtasks_count", { unsigned: true })
            .notNull()
            .default(0),
        subtasksCompleted: int("subtasks_completed", { unsigned: true })
            .notNull()
            .default(0),
        commentsCount: int("comments_count", { unsigned: true })
            .notNull()
            .default(0),
        attachmentsCount: int("attachments_count", { unsigned: true })
            .notNull()
            .default(0),

        // ─── Engineering-only fields (NULL for operational tasks) ────────────
        sprintId: varchar("sprint_id", { length: ID_LENGTH }),
        storyPoints: tinyint("story_points", { unsigned: true }),
        reviewerId: varchar("reviewer_id", { length: ID_LENGTH }),
        branchName: varchar("branch_name", { length: 200 }),
        prUrl: varchar("pr_url", { length: URL_LENGTH }),
        prStatus: mysqlEnum("pr_status", prStatuses),
        bugSeverity: mysqlEnum("bug_severity", bugSeverities),
        bugReproducibility: mysqlEnum("bug_reproducibility", bugReproducibilities),
        bugEnvironment: mysqlEnum("bug_environment", bugEnvironments),
        bugBrowser: varchar("bug_browser", { length: 120 }),
        reporterTeam: mysqlEnum("reporter_team", reporterTeams),
        deployedAt: timestamp("deployed_at"),
        rollbackReason: varchar("rollback_reason", { length: 500 }),

        archivedAt: timestamp("archived_at"),
        createdBy: varchar("created_by", { length: ID_LENGTH }).notNull(),
        createdAt: timestamp("created_at").notNull().defaultNow(),
        updatedAt: timestamp("updated_at").notNull().defaultNow().onUpdateNow(),
    },
    (t) => ({
        internalIdUq: uniqueIndex("uq_tasks_internal_id").on(t.internalId),
        customIdUq: uniqueIndex("uq_tasks_custom_id").on(
            t.workspaceId,
            t.customId,
        ),
        listNumberUq: uniqueIndex("uq_tasks_list_number").on(
            t.primaryListId,
            t.taskNumber,
        ),

        parentFk: foreignKey({
            columns: [t.parentTaskId],
            foreignColumns: [t.id],
            name: "fk_tasks_parent",
        })
            .onDelete("cascade")
            .onUpdate("cascade"),
        sprintFk: foreignKey({
            columns: [t.sprintId],
            foreignColumns: [sprints.id],
            name: "fk_tasks_sprint",
        })
            .onDelete("set null")
            .onUpdate("cascade"),
        reviewerFk: foreignKey({
            columns: [t.reviewerId],
            foreignColumns: [users.id],
            name: "fk_tasks_reviewer",
        })
            .onDelete("set null")
            .onUpdate("cascade"),
        reviewedByFk: foreignKey({
            columns: [t.reviewedBy],
            foreignColumns: [users.id],
            name: "fk_tasks_reviewed_by",
        })
            .onDelete("set null")
            .onUpdate("cascade"),
        createdByFk: foreignKey({
            columns: [t.createdBy],
            foreignColumns: [users.id],
            name: "fk_tasks_created_by",
        })
            .onDelete("restrict")
            .onUpdate("cascade"),

        priorityCk: check("ck_tasks_priority", sql`${t.priority} BETWEEN 0 AND 4`),
        nestingCk: check("ck_tasks_nesting", sql`${t.nestingDepth} <= 2`),
        datesCk: check(
            "ck_tasks_dates",
            sql`${t.startDate} IS NULL OR ${t.dueDate} IS NULL OR ${t.startDate} <= ${t.dueDate}`,
        ),

        // Hot indexes — every one mirrors a query path in the frontend.
        listActiveIdx: index("idx_tasks_list_active").on(
            t.primaryListId,
            t.archivedAt,
            t.statusId,
            t.dueDate,
        ),
        sprintIdx: index("idx_tasks_sprint").on(t.sprintId, t.statusId),
        reviewerIdx: index("idx_tasks_reviewer").on(t.reviewerId, t.prStatus),
        statusUpdatedIdx: index("idx_tasks_status_updated").on(
            t.statusId,
            t.updatedAt,
        ),
        customIdIdx: index("idx_tasks_custom_id").on(t.customId),
        parentIdx: index("idx_tasks_parent").on(t.parentTaskId),
        severityIdx: index("idx_tasks_severity").on(t.bugSeverity, t.statusId),
        recurrenceIdx: index("idx_tasks_recurrence").on(
            t.recurrencePattern,
            t.dueDate,
        ),
        slaIdx: index("idx_tasks_sla").on(
            t.slaDueAt,
            t.completedAt,
            t.archivedAt,
        ),
    }),
);

// ─── task_assignees ─ M2M users ↔ tasks ───────────────────────────────────────
export const taskAssignees = mysqlTable(
    "task_assignees",
    {
        taskId: varchar("task_id", { length: ID_LENGTH })
            .notNull()
            .references(() => tasks.id, {
                onDelete: "cascade",
                onUpdate: "cascade",
            }),
        userId: varchar("user_id", { length: ID_LENGTH })
            .notNull()
            .references(() => users.id, {
                onDelete: "cascade",
                onUpdate: "cascade",
            }),
        assignedAt: timestamp("assigned_at").notNull().defaultNow(),
        assignedBy: varchar("assigned_by", { length: ID_LENGTH }),
    },
    (t) => ({
        pk: primaryKey({ columns: [t.taskId, t.userId] }),
        assignedByFk: foreignKey({
            columns: [t.assignedBy],
            foreignColumns: [users.id],
            name: "fk_task_assignees_assigned_by",
        })
            .onDelete("set null")
            .onUpdate("cascade"),
        userIdx: index("idx_task_assignees_user").on(t.userId, t.taskId),
    }),
);

// ─── task_watchers ────────────────────────────────────────────────────────────
export const taskWatchers = mysqlTable(
    "task_watchers",
    {
        taskId: varchar("task_id", { length: ID_LENGTH })
            .notNull()
            .references(() => tasks.id, {
                onDelete: "cascade",
                onUpdate: "cascade",
            }),
        userId: varchar("user_id", { length: ID_LENGTH })
            .notNull()
            .references(() => users.id, {
                onDelete: "cascade",
                onUpdate: "cascade",
            }),
        startedAt: timestamp("started_at").notNull().defaultNow(),
    },
    (t) => ({
        pk: primaryKey({ columns: [t.taskId, t.userId] }),
        userIdx: index("idx_task_watchers_user").on(t.userId),
    }),
);

// ─── task_tags ────────────────────────────────────────────────────────────────
export const taskTags = mysqlTable(
    "task_tags",
    {
        taskId: varchar("task_id", { length: ID_LENGTH })
            .notNull()
            .references(() => tasks.id, {
                onDelete: "cascade",
                onUpdate: "cascade",
            }),
        tagId: varchar("tag_id", { length: ID_LENGTH })
            .notNull()
            .references(() => tags.id, {
                onDelete: "cascade",
                onUpdate: "cascade",
            }),
        addedAt: timestamp("added_at").notNull().defaultNow(),
    },
    (t) => ({
        pk: primaryKey({ columns: [t.taskId, t.tagId] }),
        tagIdx: index("idx_task_tags_tag").on(t.tagId),
    }),
);

// ─── task_dependencies ─ blocks / blocked-by ──────────────────────────────────
// The CHECK constraint `task_id <> related_task_id` cannot live in the table
// (MySQL 8 forbids it because both columns are in cascading FKs); it is
// enforced by `trg_task_dependencies_no_self_*` in `_post.sql`.
export const taskDependencies = mysqlTable(
    "task_dependencies",
    {
        id: varchar("id", { length: ID_LENGTH }).primaryKey(),
        taskId: varchar("task_id", { length: ID_LENGTH })
            .notNull()
            .references(() => tasks.id, {
                onDelete: "cascade",
                onUpdate: "cascade",
            }),
        relatedTaskId: varchar("related_task_id", { length: ID_LENGTH })
            .notNull()
            .references(() => tasks.id, {
                onDelete: "cascade",
                onUpdate: "cascade",
            }),
        depType: mysqlEnum("dep_type", dependencyTypes)
            .notNull()
            .default("blocks"),
        createdAt: timestamp("created_at").notNull().defaultNow(),
        createdBy: varchar("created_by", { length: ID_LENGTH }).notNull(),
    },
    (t) => ({
        uq: uniqueIndex("uq_task_dependencies").on(
            t.taskId,
            t.relatedTaskId,
            t.depType,
        ),
        createdByFk: foreignKey({
            columns: [t.createdBy],
            foreignColumns: [users.id],
            name: "fk_task_dependencies_created_by",
        })
            .onDelete("restrict")
            .onUpdate("cascade"),
        relatedIdx: index("idx_task_dependencies_related").on(t.relatedTaskId),
    }),
);

// ─── task_activity ─ per-task audit feed ──────────────────────────────────────
export const taskActivity = mysqlTable(
    "task_activity",
    {
        id: varchar("id", { length: ID_LENGTH }).primaryKey(),
        internalId: bigint("internal_id", { mode: "bigint", unsigned: true })
            .notNull()
            .autoincrement(),
        taskId: varchar("task_id", { length: ID_LENGTH })
            .notNull()
            .references(() => tasks.id, {
                onDelete: "cascade",
                onUpdate: "cascade",
            }),
        actorId: varchar("actor_id", { length: ID_LENGTH }),
        action: varchar("action", { length: 60 }).notNull(),
        context: json("context").$type<Record<string, unknown> | null>(),
        createdAt: timestamp("created_at").notNull().defaultNow(),
    },
    (t) => ({
        internalIdUq: uniqueIndex("uq_task_activity_internal_id").on(
            t.internalId,
        ),
        actorFk: foreignKey({
            columns: [t.actorId],
            foreignColumns: [users.id],
            name: "fk_task_activity_actor",
        })
            .onDelete("set null")
            .onUpdate("cascade"),
        taskTimeIdx: index("idx_task_activity_task_time").on(
            t.taskId,
            t.createdAt,
        ),
    }),
);

export type Task = typeof tasks.$inferSelect;
export type NewTask = typeof tasks.$inferInsert;
export type TaskAssignee = typeof taskAssignees.$inferSelect;
export type NewTaskAssignee = typeof taskAssignees.$inferInsert;
export type TaskWatcher = typeof taskWatchers.$inferSelect;
export type NewTaskWatcher = typeof taskWatchers.$inferInsert;
export type TaskTag = typeof taskTags.$inferSelect;
export type NewTaskTag = typeof taskTags.$inferInsert;
export type TaskDependency = typeof taskDependencies.$inferSelect;
export type NewTaskDependency = typeof taskDependencies.$inferInsert;
export type TaskActivity = typeof taskActivity.$inferSelect;
export type NewTaskActivity = typeof taskActivity.$inferInsert;
