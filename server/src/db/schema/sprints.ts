// =============================================================================
// Engineering — sprints + on-call rotation (2 tables)
//   Mirrors `database/schema.sql §11 + §30`.
// =============================================================================
import { sql } from "drizzle-orm";
import {
    check,
    date,
    foreignKey,
    index,
    int,
    mysqlEnum,
    mysqlTable,
    timestamp,
    uniqueIndex,
    varchar,
} from "drizzle-orm/mysql-core";
import {
    ID_LENGTH,
    NAME_LENGTH,
    SHORT_NAME_LENGTH,
    sprintStatuses,
} from "./_shared";
import { workspaces, users } from "./auth";

export const sprints = mysqlTable(
    "sprints",
    {
        id: varchar("id", { length: ID_LENGTH }).primaryKey(),
        workspaceId: varchar("workspace_id", { length: ID_LENGTH })
            .notNull()
            .references(() => workspaces.id, {
                onDelete: "cascade",
                onUpdate: "cascade",
            }),
        name: varchar("name", { length: SHORT_NAME_LENGTH }).notNull(),
        goal: varchar("goal", { length: 300 }),
        startDate: date("start_date").notNull(),
        endDate: date("end_date").notNull(),
        status: mysqlEnum("status", sprintStatuses).notNull().default("planned"),
        committedPoints: int("committed_points", { unsigned: true })
            .notNull()
            .default(0),
        createdAt: timestamp("created_at").notNull().defaultNow(),
        updatedAt: timestamp("updated_at").notNull().defaultNow().onUpdateNow(),
    },
    (t) => ({
        workspaceNameUq: uniqueIndex("uq_sprints_workspace_name").on(
            t.workspaceId,
            t.name,
        ),
        datesCk: check("ck_sprints_dates", sql`${t.startDate} <= ${t.endDate}`),
        workspaceStatusIdx: index("idx_sprints_workspace_status").on(
            t.workspaceId,
            t.status,
            t.startDate,
        ),
    }),
);

export const onCallShifts = mysqlTable(
    "on_call_shifts",
    {
        id: varchar("id", { length: ID_LENGTH }).primaryKey(),
        workspaceId: varchar("workspace_id", { length: ID_LENGTH })
            .notNull()
            .references(() => workspaces.id, {
                onDelete: "cascade",
                onUpdate: "cascade",
            }),
        weekStart: date("week_start").notNull(),
        weekEnd: date("week_end").notNull(),
        engineerId: varchar("engineer_id", { length: ID_LENGTH }).notNull(),
        createdBy: varchar("created_by", { length: ID_LENGTH }).notNull(),
        createdAt: timestamp("created_at").notNull().defaultNow(),
        updatedAt: timestamp("updated_at").notNull().defaultNow().onUpdateNow(),
    },
    (t) => ({
        weekUq: uniqueIndex("uq_on_call_shifts_week").on(
            t.workspaceId,
            t.weekStart,
        ),
        engineerFk: foreignKey({
            columns: [t.engineerId],
            foreignColumns: [users.id],
            name: "fk_on_call_shifts_engineer",
        })
            .onDelete("restrict")
            .onUpdate("cascade"),
        createdByFk: foreignKey({
            columns: [t.createdBy],
            foreignColumns: [users.id],
            name: "fk_on_call_shifts_created_by",
        })
            .onDelete("restrict")
            .onUpdate("cascade"),
        weekCk: check(
            "ck_on_call_shifts_week",
            sql`${t.weekStart} <= ${t.weekEnd}`,
        ),
        engineerWeekIdx: index("idx_on_call_shifts_engineer").on(
            t.engineerId,
            t.weekStart,
        ),
    }),
);

export type Sprint = typeof sprints.$inferSelect;
export type NewSprint = typeof sprints.$inferInsert;
export type OnCallShift = typeof onCallShifts.$inferSelect;
export type NewOnCallShift = typeof onCallShifts.$inferInsert;
