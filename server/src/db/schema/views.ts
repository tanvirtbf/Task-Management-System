// =============================================================================
// Views — read-only aggregates mirrored 1:1 with `database/schema.sql`.
//
// Drizzle's `mysqlView(...).existing()` declares the column shape so the
// query builder can SELECT from them, but does NOT create them.  The actual
// `CREATE OR REPLACE VIEW` DDL lives in `db/migrations/_post.sql` because
// some of them use functions (`CURDATE()`, `TIMESTAMPDIFF`, `NOW()`) that
// Drizzle's mysqlView builder can't express.
// =============================================================================
import {
    date,
    int,
    mysqlEnum,
    mysqlView,
    timestamp,
    varchar,
} from "drizzle-orm/mysql-core";
import { ID_LENGTH, statusGroups } from "./_shared";

// v_open_tasks — joins tasks + statuses, filters status_group not in done/closed
export const vOpenTasks = mysqlView("v_open_tasks", {
    id: varchar("id", { length: ID_LENGTH }).notNull(),
    workspaceId: varchar("workspace_id", { length: ID_LENGTH }).notNull(),
    primaryListId: varchar("primary_list_id", { length: ID_LENGTH }).notNull(),
    name: varchar("name", { length: 500 }).notNull(),
    statusId: varchar("status_id", { length: ID_LENGTH }).notNull(),
    statusGroup: mysqlEnum("status_group", statusGroups).notNull(),
    dueDate: date("due_date"),
    createdAt: timestamp("created_at").notNull(),
    updatedAt: timestamp("updated_at").notNull(),
}).existing();

// v_open_bugs — bugs not done/closed, with first-assignee hydrated
export const vOpenBugs = mysqlView("v_open_bugs", {
    workspaceId: varchar("workspace_id", { length: ID_LENGTH }).notNull(),
    id: varchar("id", { length: ID_LENGTH }).notNull(),
    customId: varchar("custom_id", { length: 40 }),
    name: varchar("name", { length: 500 }).notNull(),
    bugSeverity: varchar("bug_severity", { length: 4 }),
    reporterTeam: varchar("reporter_team", { length: 20 }),
    createdAt: timestamp("created_at").notNull(),
    updatedAt: timestamp("updated_at").notNull(),
    assigneeId: varchar("assignee_id", { length: ID_LENGTH }),
}).existing();

// v_active_sprint — current active sprint per workspace
export const vActiveSprint = mysqlView("v_active_sprint", {
    id: varchar("id", { length: ID_LENGTH }).notNull(),
    workspaceId: varchar("workspace_id", { length: ID_LENGTH }).notNull(),
    name: varchar("name", { length: 80 }).notNull(),
    goal: varchar("goal", { length: 300 }),
    startDate: date("start_date").notNull(),
    endDate: date("end_date").notNull(),
    committedPoints: int("committed_points", { unsigned: true }).notNull(),
}).existing();

// v_current_on_call — current week's on-call engineer
export const vCurrentOnCall = mysqlView("v_current_on_call", {
    id: varchar("id", { length: ID_LENGTH }).notNull(),
    workspaceId: varchar("workspace_id", { length: ID_LENGTH }).notNull(),
    weekStart: date("week_start").notNull(),
    weekEnd: date("week_end").notNull(),
    engineerId: varchar("engineer_id", { length: ID_LENGTH }).notNull(),
}).existing();

// v_breached_sla — tasks past their SLA window that aren't done
export const vBreachedSla = mysqlView("v_breached_sla", {
    id: varchar("id", { length: ID_LENGTH }).notNull(),
    workspaceId: varchar("workspace_id", { length: ID_LENGTH }).notNull(),
    primaryListId: varchar("primary_list_id", { length: ID_LENGTH }).notNull(),
    customId: varchar("custom_id", { length: 40 }),
    name: varchar("name", { length: 500 }).notNull(),
    taskTypeId: varchar("task_type_id", { length: ID_LENGTH }).notNull(),
    slaDueAt: timestamp("sla_due_at").notNull(),
    minutesBreached: int("minutes_breached").notNull(),
}).existing();
