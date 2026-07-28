"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.NotificationPrefsRepo = void 0;
const drizzle_orm_1 = require("drizzle-orm");
const schema_1 = require("../db/schema");
class NotificationPrefsRepo {
    db;
    constructor(db) {
        this.db = db;
    }
    /** Every stored preference row for the user (types with no row are absent). */
    async findByUser(userId) {
        return this.db
            .select()
            .from(schema_1.userNotificationPrefs)
            .where((0, drizzle_orm_1.eq)(schema_1.userNotificationPrefs.userId, userId));
    }
    /**
     * Upsert the supplied per-type preferences for one user. Each row INSERTs or,
     * on the `(user_id, type)` PK conflict, overwrites the two channel flags
     * (`updated_at` bumps via `ON UPDATE CURRENT_TIMESTAMP`). Done one row at a
     * time so the SET clause carries literal values (no deprecated `VALUES()`),
     * and wrapped by the caller in a transaction for all-or-nothing semantics.
     */
    async upsertMany(userId, prefs, exec = this.db) {
        for (const p of prefs) {
            await exec
                .insert(schema_1.userNotificationPrefs)
                .values({
                userId,
                type: p.type,
                inAppEnabled: p.inAppEnabled,
                emailEnabled: p.emailEnabled,
            })
                .onDuplicateKeyUpdate({
                set: {
                    inAppEnabled: p.inAppEnabled,
                    emailEnabled: p.emailEnabled,
                },
            });
        }
    }
}
exports.NotificationPrefsRepo = NotificationPrefsRepo;
