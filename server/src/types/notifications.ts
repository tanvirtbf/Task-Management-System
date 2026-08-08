import type { AuthRequest } from "./index";

/**
 * Endpoint-specific request shapes for the Notifications resource family (§19).
 *
 * Per the project convention these live alongside the feature, not in
 * `types/index.ts` (which is reserved for framework-level types such as
 * `AuthRequest`). Every §19 endpoint is authenticated and user-scoped — the
 * owning user is always `req.auth.sub`, never client input.
 */

/** `GET /api/v1/notifications` — `?cursor` / `?limit` query; identity from `req.auth`. */
export type NotificationFeedRequest = AuthRequest;

/** `GET /api/v1/notifications/unread-count`. No params; identity from `req.auth`. */
export type UnreadCountRequest = AuthRequest;

/** `POST /api/v1/notifications/mark-all-read`. No params; identity from `req.auth`. */
export type MarkAllReadRequest = AuthRequest;

/**
 * `POST /api/v1/notifications/:id/read`, `.../unread`, and
 * `DELETE /api/v1/notifications/:id`. The `:id` is a path param; ownership is
 * checked in the service against `req.auth.sub`.
 */
export type NotificationIdRequest = AuthRequest;

/** `GET /api/v1/notifications/preferences`. Identity from `req.auth`. */
export type GetPreferencesRequest = AuthRequest;

/** `POST /api/v1/notifications/:id/snooze` body — push the snooze to a future instant. */
export interface SnoozeNotificationBody {
    /** ISO-8601 timestamp strictly in the future (validated). */
    snoozed_until: string;
}

export interface SnoozeNotificationRequest extends AuthRequest {
    body: SnoozeNotificationBody;
}

/**
 * One type's preference in the `PUT /preferences` body. F19 (D8): the
 * `email_enabled` channel was removed — it promised delivery that had no
 * implementation.
 */
export interface NotificationPrefInput {
    in_app_enabled: boolean;
}

/**
 * `PUT /api/v1/notifications/preferences` body — a partial map of notification
 * type → channel flags. Only the types present are upserted; the validator
 * guarantees every key is a known type and every value carries both booleans.
 */
export interface UpdatePreferencesBody {
    [type: string]: NotificationPrefInput;
}

export interface UpdatePreferencesRequest extends AuthRequest {
    body: UpdatePreferencesBody;
}
