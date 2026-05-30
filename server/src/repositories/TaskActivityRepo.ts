import { MySql2Database } from "drizzle-orm/mysql2";
import * as schema from "../db/schema";
import { taskActivity } from "../db/schema";
import { fakeId } from "../utils";
import type { DbExecutor } from "./types";

/**
 * Append-only writer for the per-task audit feed (`task_activity`, surfaced by
 * §13). Every mutating task endpoint records here, in the same transaction as
 * the change it describes.
 */

export interface NewActivity {
    taskId: string;
    /** `null` for system events (cron, webhook). */
    actorId: string | null;
    /** Stable code the UI switches on, e.g. `assignee_added`. */
    action: string;
    /** Optional structured payload (from/to, user_id, …). */
    context?: Record<string, unknown> | null;
}

export class TaskActivityRepo {
    constructor(private db: MySql2Database<typeof schema>) {}

    /** Append one or more activity rows. */
    async recordMany(
        rows: NewActivity[],
        exec: DbExecutor = this.db,
    ): Promise<void> {
        if (rows.length === 0) return;
        await exec.insert(taskActivity).values(
            rows.map((r) => ({
                id: fakeId("act"),
                taskId: r.taskId,
                actorId: r.actorId,
                action: r.action,
                context: r.context ?? null,
            })),
        );
    }
}
