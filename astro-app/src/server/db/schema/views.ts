// =============================================================================
// Views — read-only aggregates mirrored 1:1 with `database/schema.sql`.
//
// Drizzle's `sqliteView(...).existing()` declares the column shape so the
// query builder can SELECT from them, but does NOT create them.  The actual
// `CREATE VIEW` DDL lives in `db/migrations/_post.sql` because
// some of them use functions (`date('now')`, `unixepoch()` time math) that
// Drizzle's sqliteView builder can't express.
// =============================================================================
import { integer, sqliteView, text } from "drizzle-orm/sqlite-core";
import { statusGroups, timestampMs } from "./_shared";

// v_open_tasks — joins tasks + statuses, filters status_group not in done/closed
export const vOpenTasks = sqliteView("v_open_tasks", {
    id: text("id").notNull(),
    workspaceId: text("workspace_id").notNull(),
    primaryListId: text("primary_list_id").notNull(),
    name: text("name").notNull(),
    statusId: text("status_id").notNull(),
    statusGroup: text("status_group", { enum: statusGroups }).notNull(),
    dueDate: text("due_date"), // conv: was DATE(Date-mode)
    createdAt: timestampMs("created_at").notNull(),
    updatedAt: timestampMs("updated_at").notNull(),
}).existing();

// v_open_bugs — bugs not done/closed, with first-assignee hydrated
export const vOpenBugs = sqliteView("v_open_bugs", {
    workspaceId: text("workspace_id").notNull(),
    id: text("id").notNull(),
    customId: text("custom_id"),
    name: text("name").notNull(),
    bugSeverity: text("bug_severity"),
    reporterTeam: text("reporter_team"),
    createdAt: timestampMs("created_at").notNull(),
    updatedAt: timestampMs("updated_at").notNull(),
    assigneeId: text("assignee_id"),
}).existing();

// v_active_sprint — current active sprint per workspace
export const vActiveSprint = sqliteView("v_active_sprint", {
    id: text("id").notNull(),
    workspaceId: text("workspace_id").notNull(),
    name: text("name").notNull(),
    goal: text("goal"),
    startDate: text("start_date").notNull(), // conv: was DATE(Date-mode)
    endDate: text("end_date").notNull(), // conv: was DATE(Date-mode)
    committedPoints: integer("committed_points").notNull(),
}).existing();

// v_current_on_call — current week's on-call engineer
export const vCurrentOnCall = sqliteView("v_current_on_call", {
    id: text("id").notNull(),
    workspaceId: text("workspace_id").notNull(),
    weekStart: text("week_start").notNull(), // conv: was DATE(Date-mode)
    weekEnd: text("week_end").notNull(), // conv: was DATE(Date-mode)
    engineerId: text("engineer_id").notNull(),
}).existing();

// v_breached_sla — tasks past their SLA window that aren't done
export const vBreachedSla = sqliteView("v_breached_sla", {
    id: text("id").notNull(),
    workspaceId: text("workspace_id").notNull(),
    primaryListId: text("primary_list_id").notNull(),
    customId: text("custom_id"),
    name: text("name").notNull(),
    taskTypeId: text("task_type_id").notNull(),
    slaDueAt: timestampMs("sla_due_at").notNull(),
    minutesBreached: integer("minutes_breached").notNull(),
}).existing();
