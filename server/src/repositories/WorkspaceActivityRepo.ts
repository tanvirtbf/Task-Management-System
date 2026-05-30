import { MySql2Database } from "drizzle-orm/mysql2";
import * as schema from "../db/schema";
import { workspaceActivity } from "../db/schema";
import { workspaceActivityEntityTypes } from "../db/schema/_shared";
import { fakeId } from "../utils";
import type { DbExecutor } from "./types";

/**
 * Append-only writer for the workspace-level audit feed (`workspace_activity`,
 * surfaced by §26). Every mutating 👑 endpoint — tag/space/list create,
 * role change, sprint start, … — records here, in the same transaction as the
 * change it describes. Per-task changes live in `task_activity` instead (see
 * `TaskActivityRepo`).
 */

export type WorkspaceActivityEntityType =
    (typeof workspaceActivityEntityTypes)[number];

export interface NewWorkspaceActivity {
    workspaceId: string;
    /** `null` for system events (cron, webhook). */
    actorId: string | null;
    /** Which kind of entity the event is about. */
    entityType: WorkspaceActivityEntityType;
    entityId: string;
    /** Stable code the UI switches on, e.g. `created`. */
    action: string;
    /** Optional structured payload (name, from/to, …). */
    context?: Record<string, unknown> | null;
}

export class WorkspaceActivityRepo {
    constructor(private db: MySql2Database<typeof schema>) {}

    /** Append a single workspace-level activity row. */
    async record(
        row: NewWorkspaceActivity,
        exec: DbExecutor = this.db,
    ): Promise<void> {
        await exec.insert(workspaceActivity).values({
            id: fakeId("wsa"),
            workspaceId: row.workspaceId,
            actorId: row.actorId,
            entityType: row.entityType,
            entityId: row.entityId,
            action: row.action,
            context: row.context ?? null,
        });
    }
}
