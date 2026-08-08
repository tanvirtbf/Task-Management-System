import type { NotificationRow } from "../repositories/NotificationsRepo";
import type { UserNotificationPref } from "../db/schema";
import { notificationTypes } from "../db/schema/_shared";

/**
 * Wire-format `Notification` per API_DESIGN.md §19. snake_case; timestamps are
 * ISO-8601 UTC. `internal_id` (the cursor keyset), `user_id` (always the
 * caller), `deleted_at` (a tombstone — a deleted row is never serialised), and
 * `email_sent_at` (delivery bookkeeping) are deliberately NOT exposed.
 *
 * Single source for the `Notification` response shape, shared by every §19
 * endpoint that returns a notification — the role `taskSerializer` plays for
 * `Task`.
 */
export interface WireNotification {
    id: string;
    type: string;
    entity_type: string;
    entity_id: string;
    actor_id: string | null;
    title: string;
    body: string | null;
    is_read: boolean;
    snoozed_until: string | null;
    created_at: string;
}

/** Format a nullable TIMESTAMP to ISO-8601 UTC (`…Z`). */
const toWireTimestamp = (value: Date | null): string | null =>
    value ? value.toISOString() : null;

export const toWireNotification = (n: NotificationRow): WireNotification => ({
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

/**
 * One type's delivery preference in the wire shape (§19 #8/#9).
 * F19 (D8): `email_enabled` is gone — it promised a channel that had no
 * implementation (MailService sends exactly two transactional mails).
 */
export interface WireNotificationPref {
    in_app_enabled: boolean;
}

/** The full preferences object: every notification type → its channel flags. */
export type WireNotificationPrefs = Record<string, WireNotificationPref>;

/**
 * Build the complete preferences map for the response. Starts from the spec
 * default (every type, all channels ON), then overlays whatever rows the user
 * has actually saved — so a type the user never touched still appears, on by
 * default, and the client always receives the full, stable set of types.
 */
export const toWirePrefs = (
    stored: UserNotificationPref[],
): WireNotificationPrefs => {
    const map: WireNotificationPrefs = {};
    for (const type of notificationTypes) {
        map[type] = { in_app_enabled: true };
    }
    for (const row of stored) {
        map[row.type] = {
            in_app_enabled: row.inAppEnabled,
        };
    }
    return map;
};
