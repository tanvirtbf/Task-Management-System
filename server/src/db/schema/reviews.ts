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
import {
    bigint,
    foreignKey,
    index,
    mysqlEnum,
    mysqlTable,
    timestamp,
    uniqueIndex,
    varchar,
} from "drizzle-orm/mysql-core";
import { ID_LENGTH, reviewStatuses } from "./_shared";
import { users, workspaces } from "./auth";
import { spaces } from "./hierarchy";
import { tasks } from "./tasks";

export const taskReviews = mysqlTable(
    "task_reviews",
    {
        id: varchar("id", { length: ID_LENGTH }).primaryKey(),
        // Keyset-cursor / deterministic-ordering column (repo convention —
        // never exposed on the wire).
        internalId: bigint("internal_id", { mode: "bigint", unsigned: true })
            .notNull()
            .autoincrement(),
        workspaceId: varchar("workspace_id", { length: ID_LENGTH }).notNull(),
        spaceId: varchar("space_id", { length: ID_LENGTH }).notNull(),
        taskId: varchar("task_id", { length: ID_LENGTH }).notNull(),
        reviewerId: varchar("reviewer_id", { length: ID_LENGTH }).notNull(),
        status: mysqlEnum("status", reviewStatuses).notNull(),
        note: varchar("note", { length: 500 }),
        // App-written UTC — no DB default (see header).
        createdAt: timestamp("created_at").notNull(),
    },
    (t) => ({
        internalIdUq: uniqueIndex("uq_task_reviews_internal_id").on(
            t.internalId,
        ),
        wsFk: foreignKey({
            columns: [t.workspaceId],
            foreignColumns: [workspaces.id],
            name: "fk_task_reviews_ws",
        })
            .onDelete("cascade")
            .onUpdate("cascade"),
        spaceFk: foreignKey({
            columns: [t.spaceId],
            foreignColumns: [spaces.id],
            name: "fk_task_reviews_space",
        })
            .onDelete("cascade")
            .onUpdate("cascade"),
        taskFk: foreignKey({
            columns: [t.taskId],
            foreignColumns: [tasks.id],
            name: "fk_task_reviews_task",
        })
            .onDelete("cascade")
            .onUpdate("cascade"),
        // RESTRICT (not CASCADE/SET NULL): the ledger is an accountability
        // record — users are soft-deactivated in this system, never deleted,
        // and a hard delete must not silently destroy review history.
        reviewerFk: foreignKey({
            columns: [t.reviewerId],
            foreignColumns: [users.id],
            name: "fk_task_reviews_reviewer",
        })
            .onDelete("restrict")
            .onUpdate("cascade"),
        spaceTimeIdx: index("idx_task_reviews_space_time").on(
            t.spaceId,
            t.internalId,
        ),
        taskTimeIdx: index("idx_task_reviews_task_time").on(
            t.taskId,
            t.internalId,
        ),
    }),
);

export type TaskReview = typeof taskReviews.$inferSelect;
export type NewTaskReview = typeof taskReviews.$inferInsert;
