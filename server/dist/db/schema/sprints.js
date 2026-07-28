"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.onCallShifts = exports.sprints = void 0;
// =============================================================================
// Engineering — sprints + on-call rotation (2 tables)
//   Mirrors `database/schema.sql §11 + §30`.
// =============================================================================
const drizzle_orm_1 = require("drizzle-orm");
const mysql_core_1 = require("drizzle-orm/mysql-core");
const _shared_1 = require("./_shared");
const auth_1 = require("./auth");
exports.sprints = (0, mysql_core_1.mysqlTable)("sprints", {
    id: (0, mysql_core_1.varchar)("id", { length: _shared_1.ID_LENGTH }).primaryKey(),
    workspaceId: (0, mysql_core_1.varchar)("workspace_id", { length: _shared_1.ID_LENGTH })
        .notNull()
        .references(() => auth_1.workspaces.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
    }),
    name: (0, mysql_core_1.varchar)("name", { length: _shared_1.SHORT_NAME_LENGTH }).notNull(),
    goal: (0, mysql_core_1.varchar)("goal", { length: 300 }),
    startDate: (0, mysql_core_1.date)("start_date").notNull(),
    endDate: (0, mysql_core_1.date)("end_date").notNull(),
    status: (0, mysql_core_1.mysqlEnum)("status", _shared_1.sprintStatuses).notNull().default("planned"),
    committedPoints: (0, mysql_core_1.int)("committed_points", { unsigned: true })
        .notNull()
        .default(0),
    createdAt: (0, mysql_core_1.timestamp)("created_at").notNull().defaultNow(),
    updatedAt: (0, mysql_core_1.timestamp)("updated_at").notNull().defaultNow().onUpdateNow(),
}, (t) => ({
    workspaceNameUq: (0, mysql_core_1.uniqueIndex)("uq_sprints_workspace_name").on(t.workspaceId, t.name),
    datesCk: (0, mysql_core_1.check)("ck_sprints_dates", (0, drizzle_orm_1.sql) `${t.startDate} <= ${t.endDate}`),
    workspaceStatusIdx: (0, mysql_core_1.index)("idx_sprints_workspace_status").on(t.workspaceId, t.status, t.startDate),
}));
exports.onCallShifts = (0, mysql_core_1.mysqlTable)("on_call_shifts", {
    id: (0, mysql_core_1.varchar)("id", { length: _shared_1.ID_LENGTH }).primaryKey(),
    workspaceId: (0, mysql_core_1.varchar)("workspace_id", { length: _shared_1.ID_LENGTH })
        .notNull()
        .references(() => auth_1.workspaces.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
    }),
    weekStart: (0, mysql_core_1.date)("week_start").notNull(),
    weekEnd: (0, mysql_core_1.date)("week_end").notNull(),
    engineerId: (0, mysql_core_1.varchar)("engineer_id", { length: _shared_1.ID_LENGTH }).notNull(),
    createdBy: (0, mysql_core_1.varchar)("created_by", { length: _shared_1.ID_LENGTH }).notNull(),
    createdAt: (0, mysql_core_1.timestamp)("created_at").notNull().defaultNow(),
    updatedAt: (0, mysql_core_1.timestamp)("updated_at").notNull().defaultNow().onUpdateNow(),
}, (t) => ({
    weekUq: (0, mysql_core_1.uniqueIndex)("uq_on_call_shifts_week").on(t.workspaceId, t.weekStart),
    engineerFk: (0, mysql_core_1.foreignKey)({
        columns: [t.engineerId],
        foreignColumns: [auth_1.users.id],
        name: "fk_on_call_shifts_engineer",
    })
        .onDelete("restrict")
        .onUpdate("cascade"),
    createdByFk: (0, mysql_core_1.foreignKey)({
        columns: [t.createdBy],
        foreignColumns: [auth_1.users.id],
        name: "fk_on_call_shifts_created_by",
    })
        .onDelete("restrict")
        .onUpdate("cascade"),
    weekCk: (0, mysql_core_1.check)("ck_on_call_shifts_week", (0, drizzle_orm_1.sql) `${t.weekStart} <= ${t.weekEnd}`),
    engineerWeekIdx: (0, mysql_core_1.index)("idx_on_call_shifts_engineer").on(t.engineerId, t.weekStart),
}));
