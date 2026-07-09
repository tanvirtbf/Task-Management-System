import { eq } from "drizzle-orm";
import { MySql2Database } from "../db/client";
import * as schema from "../db/schema";
import { userNotificationPrefs } from "../db/schema";
import type { Notification, UserNotificationPref } from "../db/schema";
import type { DbExecutor } from "./types";

/**
 * Data access for `user_notification_prefs` (§19 #8/#9).
 *
 * A MISSING (user_id, type) row means "all channels on" (the spec default), so
 * this repo never materialises defaults — the service fills them in. Reads
 * return only the rows that exist; the write is an idempotent per-type upsert
 * keyed on the composite PK `(user_id, type)`.
 */

export interface PrefUpsert {
    type: Notification["type"];
    inAppEnabled: boolean;
    emailEnabled: boolean;
}

export class NotificationPrefsRepo {
    constructor(private db: MySql2Database<typeof schema>) {}

    /** Every stored preference row for the user (types with no row are absent). */
    async findByUser(userId: string): Promise<UserNotificationPref[]> {
        return this.db
            .select()
            .from(userNotificationPrefs)
            .where(eq(userNotificationPrefs.userId, userId));
    }

    /**
     * Upsert the supplied per-type preferences for one user. Each row INSERTs or,
     * on the `(user_id, type)` PK conflict, overwrites the two channel flags
     * (`updated_at` bumps via the column's `$onUpdate`). Done one row at a
     * time so the SET clause carries literal values (no `excluded.*` refs),
     * and wrapped by the caller in a transaction for all-or-nothing semantics.
     */
    async upsertMany(
        userId: string,
        prefs: PrefUpsert[],
        exec: DbExecutor = this.db,
    ): Promise<void> {
        for (const p of prefs) {
            await exec
                .insert(userNotificationPrefs)
                .values({
                    userId,
                    type: p.type,
                    inAppEnabled: p.inAppEnabled,
                    emailEnabled: p.emailEnabled,
                })
                .onConflictDoUpdate({
                    target: [
                        userNotificationPrefs.userId,
                        userNotificationPrefs.type,
                    ],
                    set: {
                        inAppEnabled: p.inAppEnabled,
                        emailEnabled: p.emailEnabled,
                    },
                });
        }
    }
}
