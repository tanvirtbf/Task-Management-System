// =============================================================================
// Permanent-delete approval (upgrades/023, 2026-08-16)
//   Mirrors `database/schema.sql §45` 1:1.
//
// One row per request to destroy a task for good. Anyone whose `task.delete`
// reach covers the task may raise one; only an Owner/Admin holding
// `task.delete_hard` may approve. While it is pending the task is COMPLETELY
// unchanged — a request must never be a way to make someone's work disappear.
//
// `task_name` is denormalised on purpose. The task FK cascades, so approving
// destroys this row along with the task; the name has to survive in the audit
// entry and in the requester's notification, both written BEFORE the delete.
// (Same rule the permanent MEMBER delete follows: the evidence outlives the
// thing it describes.)
//
// The SQL table also carries `pending_flag`, a VIRTUAL generated column used
// only by `uq_tdr_one_pending` (at most ONE live request per task; decided
// history stacks freely because NULLs are distinct). Like `user_roles.scope_key`
// and the 021 flag it is deliberately NOT modelled here — the app never reads
// or writes it, and a racing duplicate insert surfaces as ER_DUP_ENTRY, which
// the service reports as "someone has already asked".
//
// Every timestamp is APP-WRITTEN UTC (bound JS Date) — no `.defaultNow()`, per
// the task_reviews clock rule: the DB clock runs ~6h ahead of app-written UTC
// on this deployment.
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
import { ID_LENGTH, deleteRequestStatuses } from "./_shared";
import { users, workspaces } from "./auth";
import { spaces } from "./hierarchy";
import { tasks } from "./tasks";

export const taskDeleteRequests = mysqlTable(
    "task_delete_requests",
    {
        id: varchar("id", { length: ID_LENGTH }).primaryKey(),
        internalId: bigint("internal_id", { mode: "bigint", unsigned: true })
            .notNull()
            .autoincrement(),
        workspaceId: varchar("workspace_id", { length: ID_LENGTH }).notNull(),
        /** Owning space AT REQUEST TIME (snapshot annotation). */
        spaceId: varchar("space_id", { length: ID_LENGTH }).notNull(),
        taskId: varchar("task_id", { length: ID_LENGTH }).notNull(),
        /** Survives the task, for the audit row and the decision notice. */
        taskName: varchar("task_name", { length: 500 }).notNull(),
        requestedBy: varchar("requested_by", { length: ID_LENGTH }).notNull(),
        reason: varchar("reason", { length: 500 }),
        status: mysqlEnum("status", deleteRequestStatuses)
            .notNull()
            .default("pending"),
        decidedBy: varchar("decided_by", { length: ID_LENGTH }),
        decidedAt: timestamp("decided_at"),
        decisionNote: varchar("decision_note", { length: 500 }),
        createdAt: timestamp("created_at").notNull(),
        updatedAt: timestamp("updated_at").notNull(),
    },
    (t) => ({
        internalIdUq: uniqueIndex("uq_tdr_internal_id").on(t.internalId),
        wsFk: foreignKey({
            columns: [t.workspaceId],
            foreignColumns: [workspaces.id],
            name: "fk_tdr_ws",
        })
            .onDelete("cascade")
            .onUpdate("cascade"),
        spaceFk: foreignKey({
            columns: [t.spaceId],
            foreignColumns: [spaces.id],
            name: "fk_tdr_space",
        })
            .onDelete("cascade")
            .onUpdate("cascade"),
        taskFk: foreignKey({
            columns: [t.taskId],
            foreignColumns: [tasks.id],
            name: "fk_tdr_task",
        })
            .onDelete("cascade")
            .onUpdate("cascade"),
        requesterFk: foreignKey({
            columns: [t.requestedBy],
            foreignColumns: [users.id],
            name: "fk_tdr_requested_by",
        })
            .onDelete("cascade")
            .onUpdate("cascade"),
        deciderFk: foreignKey({
            columns: [t.decidedBy],
            foreignColumns: [users.id],
            name: "fk_tdr_decided_by",
        })
            .onDelete("set null")
            .onUpdate("cascade"),
        byWorkspace: index("idx_tdr_workspace").on(
            t.workspaceId,
            t.status,
            t.internalId,
        ),
        byRequester: index("idx_tdr_requester").on(
            t.requestedBy,
            t.status,
            t.internalId,
        ),
        byTask: index("idx_tdr_task").on(t.taskId, t.internalId),
    }),
);

export type TaskDeleteRequest = typeof taskDeleteRequests.$inferSelect;
