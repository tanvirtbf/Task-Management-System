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
    check,
    foreignKey,
    index,
    integer,
    primaryKey,
    sqliteTable,
    text,
    uniqueIndex,
} from "drizzle-orm/sqlite-core";
import {
    NOW_MS,
    bugEnvironments,
    bugReproducibilities,
    bugSeverities,
    dependencyTypes,
    mysqlSet,
    prStatuses,
    recurrencePatterns,
    reporterTeams,
    timestampMs,
    weekDays,
    ciText,
} from "./_shared";
import { workspaces, users } from "./auth";
import { lists, statuses, taskTypes, tags } from "./hierarchy";
import { sprints } from "./sprints";

// ─── tasks ────────────────────────────────────────────────────────────────────
export const tasks = sqliteTable(
    "tasks",
    {
        // conv: SQLite auto-increment requires INTEGER PRIMARY KEY, so
        // internal_id became the real PK and id was demoted to NOT NULL UNIQUE.
        id: text("id").notNull().unique(),
        internalId: integer("internal_id", { mode: "number" })
            .primaryKey({ autoIncrement: true }),
        workspaceId: text("workspace_id")
            .notNull()
            .references(() => workspaces.id, {
                onDelete: "cascade",
                onUpdate: "cascade",
            }),
        primaryListId: text("primary_list_id")
            .notNull()
            .references(() => lists.id, {
                onDelete: "restrict",
                onUpdate: "cascade",
            }),
        taskNumber: integer("task_number").notNull(),
        customId: ciText("custom_id"),

        name: text("name").notNull(),
        description: text("description"),

        statusId: text("status_id")
            .notNull()
            .references(() => statuses.id, {
                onDelete: "restrict",
                onUpdate: "cascade",
            }),
        priority: integer("priority").notNull().default(0),
        taskTypeId: text("task_type_id")
            .notNull()
            .references(() => taskTypes.id, {
                onDelete: "restrict",
                onUpdate: "cascade",
            }),

        parentTaskId: text("parent_task_id"),
        nestingDepth: integer("nesting_depth")
            .notNull()
            .default(0),
        isMilestone: integer("is_milestone", { mode: "boolean" })
            .notNull()
            .default(false),

        startDate: text("start_date"), // conv: was DATE(Date-mode)
        dueDate: text("due_date"), // conv: was DATE(Date-mode)
        completedAt: timestampMs("completed_at"),

        // ─── SLA (P0) ────────────────────────────────────────────────────────
        slaDueAt: timestampMs("sla_due_at"),

        // ─── Recurrence (simple per spec) ────────────────────────────────────
        recurrencePattern: text("recurrence_pattern", { enum: recurrencePatterns })
            .notNull()
            .default("none"),
        recurrenceDays: mysqlSet("recurrence_days", weekDays),
        recurrenceEndsAt: text("recurrence_ends_at"), // conv: was DATE(Date-mode)

        timeEstimateSeconds: integer("time_estimate_seconds"),
        timeTrackedSeconds: integer("time_tracked_seconds")
            .notNull()
            .default(0),

        // ─── Denormalised counters (maintained by triggers) ──────────────────
        subtasksCount: integer("subtasks_count")
            .notNull()
            .default(0),
        subtasksCompleted: integer("subtasks_completed")
            .notNull()
            .default(0),
        commentsCount: integer("comments_count")
            .notNull()
            .default(0),
        attachmentsCount: integer("attachments_count")
            .notNull()
            .default(0),

        // ─── Engineering-only fields (NULL for operational tasks) ────────────
        sprintId: text("sprint_id"),
        storyPoints: integer("story_points"),
        reviewerId: text("reviewer_id"),
        branchName: text("branch_name"),
        prUrl: text("pr_url"),
        prStatus: text("pr_status", { enum: prStatuses }),
        bugSeverity: text("bug_severity", { enum: bugSeverities }),
        bugReproducibility: text("bug_reproducibility", {
            enum: bugReproducibilities,
        }),
        bugEnvironment: text("bug_environment", { enum: bugEnvironments }),
        bugBrowser: text("bug_browser"),
        reporterTeam: text("reporter_team", { enum: reporterTeams }),
        deployedAt: timestampMs("deployed_at"),
        rollbackReason: text("rollback_reason"),

        archivedAt: timestampMs("archived_at"),
        createdBy: text("created_by").notNull(),
        createdAt: timestampMs("created_at").notNull().default(NOW_MS),
        updatedAt: timestampMs("updated_at")
            .notNull()
            .default(NOW_MS)
            .$onUpdate(() => new Date()),
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
export const taskAssignees = sqliteTable(
    "task_assignees",
    {
        taskId: text("task_id")
            .notNull()
            .references(() => tasks.id, {
                onDelete: "cascade",
                onUpdate: "cascade",
            }),
        userId: text("user_id")
            .notNull()
            .references(() => users.id, {
                onDelete: "cascade",
                onUpdate: "cascade",
            }),
        assignedAt: timestampMs("assigned_at").notNull().default(NOW_MS),
        assignedBy: text("assigned_by"),
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
export const taskWatchers = sqliteTable(
    "task_watchers",
    {
        taskId: text("task_id")
            .notNull()
            .references(() => tasks.id, {
                onDelete: "cascade",
                onUpdate: "cascade",
            }),
        userId: text("user_id")
            .notNull()
            .references(() => users.id, {
                onDelete: "cascade",
                onUpdate: "cascade",
            }),
        startedAt: timestampMs("started_at").notNull().default(NOW_MS),
    },
    (t) => ({
        pk: primaryKey({ columns: [t.taskId, t.userId] }),
        userIdx: index("idx_task_watchers_user").on(t.userId),
    }),
);

// ─── task_tags ────────────────────────────────────────────────────────────────
export const taskTags = sqliteTable(
    "task_tags",
    {
        taskId: text("task_id")
            .notNull()
            .references(() => tasks.id, {
                onDelete: "cascade",
                onUpdate: "cascade",
            }),
        tagId: text("tag_id")
            .notNull()
            .references(() => tags.id, {
                onDelete: "cascade",
                onUpdate: "cascade",
            }),
        addedAt: timestampMs("added_at").notNull().default(NOW_MS),
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
export const taskDependencies = sqliteTable(
    "task_dependencies",
    {
        id: text("id").primaryKey(),
        taskId: text("task_id")
            .notNull()
            .references(() => tasks.id, {
                onDelete: "cascade",
                onUpdate: "cascade",
            }),
        relatedTaskId: text("related_task_id")
            .notNull()
            .references(() => tasks.id, {
                onDelete: "cascade",
                onUpdate: "cascade",
            }),
        depType: text("dep_type", { enum: dependencyTypes })
            .notNull()
            .default("blocks"),
        createdAt: timestampMs("created_at").notNull().default(NOW_MS),
        createdBy: text("created_by").notNull(),
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
export const taskActivity = sqliteTable(
    "task_activity",
    {
        // conv: SQLite auto-increment requires INTEGER PRIMARY KEY, so
        // internal_id became the real PK and id was demoted to NOT NULL UNIQUE.
        id: text("id").notNull().unique(),
        internalId: integer("internal_id", { mode: "number" })
            .primaryKey({ autoIncrement: true }),
        taskId: text("task_id")
            .notNull()
            .references(() => tasks.id, {
                onDelete: "cascade",
                onUpdate: "cascade",
            }),
        actorId: text("actor_id"),
        action: text("action").notNull(),
        context: text("context", { mode: "json" }).$type<Record<
            string,
            unknown
        > | null>(),
        createdAt: timestampMs("created_at").notNull().default(NOW_MS),
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
