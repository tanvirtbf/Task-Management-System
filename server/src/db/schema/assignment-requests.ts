// =============================================================================
// Team-access P8 — cross-team assignment approval (2 tables)
//   Mirrors `database/schema.sql §43 / §44` (upgrades/021) 1:1.
//
// `task_assignment_requests` holds the CURRENT state of one negotiation —
// created when an assignment targets someone who is not a member of the space
// owning the task (Q11). `task_assignment_request_events` is the append-only
// ledger of every action (the task_reviews shape), so the drawer panel can
// show the whole back-and-forth.
//
// The SQL table also carries `pending_flag`, a VIRTUAL generated column used
// only by `uq_tar_one_pending` (at most one PENDING request per (task, user);
// decided history stacks freely because NULLs are distinct). Like user_roles'
// `scope_key`, it is deliberately NOT modelled here — the app never reads or
// writes it; the racing-duplicate insert surfaces as an ER_DUP_ENTRY the
// service treats as "someone already asked".
//
// Every timestamp is APP-WRITTEN UTC (bound JS Date) — deliberately NO
// `.defaultNow()` (the task_reviews clock rule): request rows are
// window-compared against `expires_at` and DB-clock defaults run ~6h ahead of
// app-written UTC on this deployment.
// =============================================================================
import {
    bigint,
    date,
    foreignKey,
    index,
    mysqlEnum,
    mysqlTable,
    timestamp,
    uniqueIndex,
    varchar,
} from "drizzle-orm/mysql-core";
import {
    ID_LENGTH,
    assignmentRequestEventActions,
    assignmentRequestStatuses,
} from "./_shared";
import { users, workspaces } from "./auth";
import { spaces } from "./hierarchy";
import { tasks } from "./tasks";

export const taskAssignmentRequests = mysqlTable(
    "task_assignment_requests",
    {
        id: varchar("id", { length: ID_LENGTH }).primaryKey(),
        internalId: bigint("internal_id", { mode: "bigint", unsigned: true })
            .notNull()
            .autoincrement(),
        workspaceId: varchar("workspace_id", { length: ID_LENGTH }).notNull(),
        // Owning space AT REQUEST TIME (snapshot annotation — live bucketing
        // always derives via primary_list_id → lists.space_id).
        spaceId: varchar("space_id", { length: ID_LENGTH }).notNull(),
        taskId: varchar("task_id", { length: ID_LENGTH }).notNull(),
        targetUserId: varchar("target_user_id", {
            length: ID_LENGTH,
        }).notNull(),
        requestedBy: varchar("requested_by", { length: ID_LENGTH }).notNull(),
        status: mysqlEnum("status", assignmentRequestStatuses)
            .notNull()
            .default("pending"),
        requestNote: varchar("request_note", { length: 500 }),
        queryNote: varchar("query_note", { length: 500 }),
        // Same calendar-day domain as tasks.due_date.
        proposedDueDate: date("proposed_due_date", { mode: "string" }),
        decidedBy: varchar("decided_by", { length: ID_LENGTH }),
        decidedAt: timestamp("decided_at"),
        expiresAt: timestamp("expires_at").notNull(),
        createdAt: timestamp("created_at").notNull(),
        updatedAt: timestamp("updated_at").notNull(),
    },
    (t) => ({
        internalIdUq: uniqueIndex("uq_tar_internal_id").on(t.internalId),
        wsFk: foreignKey({
            columns: [t.workspaceId],
            foreignColumns: [workspaces.id],
            name: "fk_tar_ws",
        })
            .onDelete("cascade")
            .onUpdate("cascade"),
        spaceFk: foreignKey({
            columns: [t.spaceId],
            foreignColumns: [spaces.id],
            name: "fk_tar_space",
        })
            .onDelete("cascade")
            .onUpdate("cascade"),
        taskFk: foreignKey({
            columns: [t.taskId],
            foreignColumns: [tasks.id],
            name: "fk_tar_task",
        })
            .onDelete("cascade")
            .onUpdate("cascade"),
        // CASCADE (not RESTRICT): a negotiation is meaningless without its
        // people, and users are soft-deactivated in practice anyway.
        targetFk: foreignKey({
            columns: [t.targetUserId],
            foreignColumns: [users.id],
            name: "fk_tar_target",
        })
            .onDelete("cascade")
            .onUpdate("cascade"),
        requestedByFk: foreignKey({
            columns: [t.requestedBy],
            foreignColumns: [users.id],
            name: "fk_tar_requested_by",
        })
            .onDelete("cascade")
            .onUpdate("cascade"),
        decidedByFk: foreignKey({
            columns: [t.decidedBy],
            foreignColumns: [users.id],
            name: "fk_tar_decided_by",
        })
            .onDelete("set null")
            .onUpdate("cascade"),
        targetIdx: index("idx_tar_target").on(
            t.targetUserId,
            t.status,
            t.internalId,
        ),
        requesterIdx: index("idx_tar_requester").on(
            t.requestedBy,
            t.status,
            t.internalId,
        ),
        taskTimeIdx: index("idx_tar_task_time").on(t.taskId, t.internalId),
        expiryIdx: index("idx_tar_expiry").on(t.status, t.expiresAt),
        workspaceIdx: index("idx_tar_workspace").on(t.workspaceId, t.status),
    }),
);

export type TaskAssignmentRequest = typeof taskAssignmentRequests.$inferSelect;
export type NewTaskAssignmentRequest =
    typeof taskAssignmentRequests.$inferInsert;

export const taskAssignmentRequestEvents = mysqlTable(
    "task_assignment_request_events",
    {
        id: varchar("id", { length: ID_LENGTH }).primaryKey(),
        internalId: bigint("internal_id", { mode: "bigint", unsigned: true })
            .notNull()
            .autoincrement(),
        requestId: varchar("request_id", { length: ID_LENGTH }).notNull(),
        // NULL = the system (the expiry janitor).
        actorId: varchar("actor_id", { length: ID_LENGTH }),
        action: mysqlEnum("action", assignmentRequestEventActions).notNull(),
        note: varchar("note", { length: 500 }),
        // For 'queried': the proposal. For 'answered': the date applied.
        proposedDueDate: date("proposed_due_date", { mode: "string" }),
        createdAt: timestamp("created_at").notNull(),
    },
    (t) => ({
        internalIdUq: uniqueIndex("uq_tare_internal_id").on(t.internalId),
        requestFk: foreignKey({
            columns: [t.requestId],
            foreignColumns: [taskAssignmentRequests.id],
            name: "fk_tare_request",
        })
            .onDelete("cascade")
            .onUpdate("cascade"),
        actorFk: foreignKey({
            columns: [t.actorId],
            foreignColumns: [users.id],
            name: "fk_tare_actor",
        })
            .onDelete("set null")
            .onUpdate("cascade"),
        requestTimeIdx: index("idx_tare_request_time").on(
            t.requestId,
            t.internalId,
        ),
    }),
);

export type TaskAssignmentRequestEvent =
    typeof taskAssignmentRequestEvents.$inferSelect;
export type NewTaskAssignmentRequestEvent =
    typeof taskAssignmentRequestEvents.$inferInsert;
