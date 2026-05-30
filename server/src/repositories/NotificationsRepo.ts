import { MySql2Database } from "drizzle-orm/mysql2";
import * as schema from "../db/schema";
import { notifications } from "../db/schema";
import type { Notification } from "../db/schema";
import { fakeId } from "../utils";
import type { DbExecutor } from "./types";

/**
 * Writer for the per-user inbox (`notifications`, surfaced by §19).
 *
 * V1 scope here is the minimal row insert needed by the endpoints that fan out
 * notifications (e.g. assigning a task). Delivery preferences, email, snooze
 * and dedupe are owned by §19 and will compose over this repo.
 */

export interface NewNotification {
    userId: string;
    type: Notification["type"];
    entityType: Notification["entityType"];
    entityId: string;
    actorId: string | null;
    title: string;
    body?: string | null;
}

export class NotificationsRepo {
    constructor(private db: MySql2Database<typeof schema>) {}

    /** Insert one or more notification rows. */
    async createMany(
        rows: NewNotification[],
        exec: DbExecutor = this.db,
    ): Promise<void> {
        if (rows.length === 0) return;
        await exec.insert(notifications).values(
            rows.map((r) => ({
                id: fakeId("ntf"),
                userId: r.userId,
                type: r.type,
                entityType: r.entityType,
                entityId: r.entityId,
                actorId: r.actorId,
                title: r.title,
                body: r.body ?? null,
            })),
        );
    }
}
