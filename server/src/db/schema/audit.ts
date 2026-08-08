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
    bigint,
    foreignKey,
    index,
    json,
    mysqlEnum,
    mysqlTable,
    timestamp,
    uniqueIndex,
    varchar,
} from "drizzle-orm/mysql-core";
import {
    ID_LENGTH,
    IP_LENGTH,
    workspaceActivityEntityTypes,
} from "./_shared";
import { workspaces, users } from "./auth";

export const workspaceActivity = mysqlTable(
    "workspace_activity",
    {
        id: varchar("id", { length: ID_LENGTH }).primaryKey(),
        internalId: bigint("internal_id", { mode: "bigint", unsigned: true })
            .notNull()
            .autoincrement(),
        workspaceId: varchar("workspace_id", { length: ID_LENGTH })
            .notNull()
            .references(() => workspaces.id, {
                onDelete: "cascade",
                onUpdate: "cascade",
            }),
        actorId: varchar("actor_id", { length: ID_LENGTH }),
        entityType: mysqlEnum(
            "entity_type",
            workspaceActivityEntityTypes,
        ).notNull(),
        entityId: varchar("entity_id", { length: ID_LENGTH }).notNull(),
        action: varchar("action", { length: 60 }).notNull(),
        context: json("context").$type<Record<string, unknown> | null>(),
        ipAddress: varchar("ip_address", { length: IP_LENGTH }),
        createdAt: timestamp("created_at").notNull().defaultNow(),
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
        // F30 (ISS-088): both feed reads order by `internal_id` DESC — the
        // time index cannot serve that order, so every page filesorted.
        workspaceInternalIdx: index("idx_workspace_activity_ws_internal").on(
            t.workspaceId,
            t.internalId,
        ),
    }),
);

export type WorkspaceActivity = typeof workspaceActivity.$inferSelect;
export type NewWorkspaceActivity = typeof workspaceActivity.$inferInsert;
