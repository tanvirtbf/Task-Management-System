// =============================================================================
// Audit — workspace-wide light activity log (1 table)
//   Mirrors `database/schema.sql §31`.
//
// Per-task activity lives in `task_activity` (see `schema/tasks.ts`). This
// table captures workspace-level events: user invited, list archived, role
// changed, sprint started, etc.  Powers `GET /activity/recent` together with
// `task_activity` via a UNION query.
// =============================================================================
import {
    foreignKey,
    index,
    integer,
    sqliteTable,
    text,
    uniqueIndex,
} from "drizzle-orm/sqlite-core";
import {
    NOW_MS,
    timestampMs,
    workspaceActivityEntityTypes,
} from "./_shared";
import { workspaces, users } from "./auth";

export const workspaceActivity = sqliteTable(
    "workspace_activity",
    {
        // conv: AUTO_INCREMENT flip — SQLite only auto-increments INTEGER
        // PRIMARY KEY, so `internal_id` became the PK and the public varchar
        // `id` was demoted to NOT NULL UNIQUE.
        id: text("id").notNull().unique(),
        internalId: integer("internal_id", { mode: "number" }).primaryKey({
            autoIncrement: true,
        }),
        workspaceId: text("workspace_id")
            .notNull()
            .references(() => workspaces.id, {
                onDelete: "cascade",
                onUpdate: "cascade",
            }),
        actorId: text("actor_id"),
        entityType: text("entity_type", {
            enum: workspaceActivityEntityTypes,
        }).notNull(),
        entityId: text("entity_id").notNull(),
        action: text("action").notNull(),
        context: text("context", { mode: "json" }).$type<Record<
            string,
            unknown
        > | null>(),
        ipAddress: text("ip_address"),
        createdAt: timestampMs("created_at").notNull().default(NOW_MS),
    },
    (t) => ({
        internalIdUq: uniqueIndex("uq_workspace_activity_internal_id").on(
            t.internalId,
        ),
        actorFk: foreignKey({
            columns: [t.actorId],
            foreignColumns: [users.id],
            name: "fk_workspace_activity_actor",
        })
            .onDelete("set null")
            .onUpdate("cascade"),
        workspaceTimeIdx: index("idx_workspace_activity_workspace_time").on(
            t.workspaceId,
            t.createdAt,
        ),
        entityIdx: index("idx_workspace_activity_entity").on(
            t.entityType,
            t.entityId,
        ),
    }),
);

export type WorkspaceActivity = typeof workspaceActivity.$inferSelect;
export type NewWorkspaceActivity = typeof workspaceActivity.$inferInsert;
