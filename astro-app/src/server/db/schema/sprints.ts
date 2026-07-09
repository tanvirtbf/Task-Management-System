// =============================================================================
// Engineering — sprints + on-call rotation (2 tables)
//   Mirrors `database/schema.sql §11 + §30`.
// =============================================================================
import { sql } from "drizzle-orm";
import {
    check,
    foreignKey,
    index,
    integer,
    sqliteTable,
    text,
    uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { NOW_MS, sprintStatuses, timestampMs } from "./_shared";
import { workspaces, users } from "./auth";

export const sprints = sqliteTable(
    "sprints",
    {
        id: text("id").primaryKey(),
        workspaceId: text("workspace_id")
            .notNull()
            .references(() => workspaces.id, {
                onDelete: "cascade",
                onUpdate: "cascade",
            }),
        name: text("name").notNull(),
        goal: text("goal"),
        startDate: text("start_date").notNull(), // conv: was DATE(Date-mode)
        endDate: text("end_date").notNull(), // conv: was DATE(Date-mode)
        status: text("status", { enum: sprintStatuses })
            .notNull()
            .default("planned"),
        committedPoints: integer("committed_points").notNull().default(0),
        createdAt: timestampMs("created_at").notNull().default(NOW_MS),
        updatedAt: timestampMs("updated_at")
            .notNull()
            .default(NOW_MS)
            .$onUpdate(() => new Date()),
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

export const onCallShifts = sqliteTable(
    "on_call_shifts",
    {
        id: text("id").primaryKey(),
        workspaceId: text("workspace_id")
            .notNull()
            .references(() => workspaces.id, {
                onDelete: "cascade",
                onUpdate: "cascade",
            }),
        weekStart: text("week_start").notNull(), // conv: was DATE(Date-mode)
        weekEnd: text("week_end").notNull(), // conv: was DATE(Date-mode)
        engineerId: text("engineer_id").notNull(),
        createdBy: text("created_by").notNull(),
        createdAt: timestampMs("created_at").notNull().default(NOW_MS),
        updatedAt: timestampMs("updated_at")
            .notNull()
            .default(NOW_MS)
            .$onUpdate(() => new Date()),
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
