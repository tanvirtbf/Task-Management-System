"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.vBreachedSla = exports.vCurrentOnCall = exports.vActiveSprint = exports.vOpenBugs = exports.vOpenTasks = void 0;
// =============================================================================
// Views — read-only aggregates mirrored 1:1 with `database/schema.sql`.
//
// Drizzle's `mysqlView(...).existing()` declares the column shape so the
// query builder can SELECT from them, but does NOT create them.  The actual
// `CREATE OR REPLACE VIEW` DDL lives in `db/migrations/_post.sql` because
// some of them use functions (`CURDATE()`, `TIMESTAMPDIFF`, `NOW()`) that
// Drizzle's mysqlView builder can't express.
// =============================================================================
const mysql_core_1 = require("drizzle-orm/mysql-core");
const _shared_1 = require("./_shared");
// v_open_tasks — joins tasks + statuses, filters status_group not in done/closed
exports.vOpenTasks = (0, mysql_core_1.mysqlView)("v_open_tasks", {
    id: (0, mysql_core_1.varchar)("id", { length: _shared_1.ID_LENGTH }).notNull(),
    workspaceId: (0, mysql_core_1.varchar)("workspace_id", { length: _shared_1.ID_LENGTH }).notNull(),
    primaryListId: (0, mysql_core_1.varchar)("primary_list_id", { length: _shared_1.ID_LENGTH }).notNull(),
    name: (0, mysql_core_1.varchar)("name", { length: 500 }).notNull(),
    statusId: (0, mysql_core_1.varchar)("status_id", { length: _shared_1.ID_LENGTH }).notNull(),
    statusGroup: (0, mysql_core_1.mysqlEnum)("status_group", _shared_1.statusGroups).notNull(),
    dueDate: (0, mysql_core_1.date)("due_date"),
    createdAt: (0, mysql_core_1.timestamp)("created_at").notNull(),
    updatedAt: (0, mysql_core_1.timestamp)("updated_at").notNull(),
}).existing();
// v_open_bugs — bugs not done/closed, with first-assignee hydrated
exports.vOpenBugs = (0, mysql_core_1.mysqlView)("v_open_bugs", {
    workspaceId: (0, mysql_core_1.varchar)("workspace_id", { length: _shared_1.ID_LENGTH }).notNull(),
    id: (0, mysql_core_1.varchar)("id", { length: _shared_1.ID_LENGTH }).notNull(),
    customId: (0, mysql_core_1.varchar)("custom_id", { length: 40 }),
    name: (0, mysql_core_1.varchar)("name", { length: 500 }).notNull(),
    bugSeverity: (0, mysql_core_1.varchar)("bug_severity", { length: 4 }),
    reporterTeam: (0, mysql_core_1.varchar)("reporter_team", { length: 20 }),
    createdAt: (0, mysql_core_1.timestamp)("created_at").notNull(),
    updatedAt: (0, mysql_core_1.timestamp)("updated_at").notNull(),
    assigneeId: (0, mysql_core_1.varchar)("assignee_id", { length: _shared_1.ID_LENGTH }),
}).existing();
// v_active_sprint — current active sprint per workspace
exports.vActiveSprint = (0, mysql_core_1.mysqlView)("v_active_sprint", {
    id: (0, mysql_core_1.varchar)("id", { length: _shared_1.ID_LENGTH }).notNull(),
    workspaceId: (0, mysql_core_1.varchar)("workspace_id", { length: _shared_1.ID_LENGTH }).notNull(),
    name: (0, mysql_core_1.varchar)("name", { length: 80 }).notNull(),
    goal: (0, mysql_core_1.varchar)("goal", { length: 300 }),
    startDate: (0, mysql_core_1.date)("start_date").notNull(),
    endDate: (0, mysql_core_1.date)("end_date").notNull(),
    committedPoints: (0, mysql_core_1.int)("committed_points", { unsigned: true }).notNull(),
}).existing();
// v_current_on_call — current week's on-call engineer
exports.vCurrentOnCall = (0, mysql_core_1.mysqlView)("v_current_on_call", {
    id: (0, mysql_core_1.varchar)("id", { length: _shared_1.ID_LENGTH }).notNull(),
    workspaceId: (0, mysql_core_1.varchar)("workspace_id", { length: _shared_1.ID_LENGTH }).notNull(),
    weekStart: (0, mysql_core_1.date)("week_start").notNull(),
    weekEnd: (0, mysql_core_1.date)("week_end").notNull(),
    engineerId: (0, mysql_core_1.varchar)("engineer_id", { length: _shared_1.ID_LENGTH }).notNull(),
}).existing();
// v_breached_sla — tasks past their SLA window that aren't done
exports.vBreachedSla = (0, mysql_core_1.mysqlView)("v_breached_sla", {
    id: (0, mysql_core_1.varchar)("id", { length: _shared_1.ID_LENGTH }).notNull(),
    workspaceId: (0, mysql_core_1.varchar)("workspace_id", { length: _shared_1.ID_LENGTH }).notNull(),
    primaryListId: (0, mysql_core_1.varchar)("primary_list_id", { length: _shared_1.ID_LENGTH }).notNull(),
    customId: (0, mysql_core_1.varchar)("custom_id", { length: 40 }),
    name: (0, mysql_core_1.varchar)("name", { length: 500 }).notNull(),
    taskTypeId: (0, mysql_core_1.varchar)("task_type_id", { length: _shared_1.ID_LENGTH }).notNull(),
    slaDueAt: (0, mysql_core_1.timestamp)("sla_due_at").notNull(),
    minutesBreached: (0, mysql_core_1.int)("minutes_breached").notNull(),
}).existing();
