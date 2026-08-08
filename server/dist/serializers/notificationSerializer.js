"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.toWirePrefs = exports.toWireNotification = void 0;
const _shared_1 = require("../db/schema/_shared");
/** Format a nullable TIMESTAMP to ISO-8601 UTC (`…Z`). */
const toWireTimestamp = (value) => value ? value.toISOString() : null;
const toWireNotification = (n) => ({
    id: n.id,
    type: n.type,
    entity_type: n.entityType,
    entity_id: n.entityId,
    actor_id: n.actorId,
    title: n.title,
    body: n.body,
    is_read: n.isRead,
    snoozed_until: toWireTimestamp(n.snoozedUntil),
    created_at: n.createdAt.toISOString(),
});
exports.toWireNotification = toWireNotification;
/**
 * Build the complete preferences map for the response. Starts from the spec
 * default (every type, all channels ON), then overlays whatever rows the user
 * has actually saved — so a type the user never touched still appears, on by
 * default, and the client always receives the full, stable set of types.
 */
const toWirePrefs = (stored) => {
    const map = {};
    for (const type of _shared_1.notificationTypes) {
        map[type] = { in_app_enabled: true };
    }
    for (const row of stored) {
        map[row.type] = {
            in_app_enabled: row.inAppEnabled,
        };
    }
    return map;
};
exports.toWirePrefs = toWirePrefs;
