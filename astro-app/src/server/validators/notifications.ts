import { body, checkSchema, type Meta } from "express-validator";
import { ID_LENGTH, notificationTypes } from "../db/schema/_shared";

/**
 * Validators for the §19 Notifications endpoints. Pair each `checkSchema(...)`
 * (or the `body()` chain) with the shared `validate` middleware so failures
 * render as 422 `validation.failed`.
 */

/**
 * Reject a repeated query param. A duplicated key (`?limit=1&limit=2`) arrives
 * as an array, which express-validator otherwise validates element-by-element
 * (so it passes) and then flows into a scalar — producing a `NaN` limit or a
 * 500 from the query builder. Mirrors the `users` / `task-activity` validators.
 */
const notRepeated = (field: string) => ({
    options: (_value: unknown, { req }: Meta): boolean => {
        if (Array.isArray(req.query?.[field])) {
            throw new Error(`${field} must not be repeated`);
        }
        return true;
    },
});

/** Query validator for `GET /api/v1/notifications` (cursor + limit). */
export const listNotificationsValidator = checkSchema({
    cursor: {
        in: ["query"],
        optional: true,
        custom: notRepeated("cursor"),
        isString: { errorMessage: "cursor must be a string" },
        notEmpty: { errorMessage: "cursor must not be empty" },
    },
    limit: {
        in: ["query"],
        optional: true,
        custom: notRepeated("limit"),
        isInt: {
            options: { min: 1 },
            errorMessage: "limit must be a positive integer",
        },
        toInt: true,
    },
});

/**
 * Path-param validator for the by-id endpoints (`/:id/read`, `/:id/unread`,
 * `DELETE /:id`). The id is client input, so trim it, reject empty, and cap it
 * at the `notifications.id` column width — an over-long id can never match a
 * row, so a clean 422 beats a pointless query. Ownership is checked in service.
 */
export const notificationIdValidator = checkSchema({
    id: {
        in: ["params"],
        trim: true,
        notEmpty: { errorMessage: "id must not be empty" },
        isLength: {
            options: { max: ID_LENGTH },
            errorMessage: `id must be at most ${ID_LENGTH} characters`,
        },
    },
});

/**
 * Param + body validator for `POST /api/v1/notifications/:id/snooze`.
 * `snoozed_until` is required, must be an ISO-8601 timestamp, and must be
 * strictly in the future (snoozing into the past is meaningless — 422).
 */
export const snoozeNotificationValidator = checkSchema({
    id: {
        in: ["params"],
        trim: true,
        notEmpty: { errorMessage: "id must not be empty" },
        isLength: {
            options: { max: ID_LENGTH },
            errorMessage: `id must be at most ${ID_LENGTH} characters`,
        },
    },
    snoozed_until: {
        in: ["body"],
        notEmpty: { errorMessage: "snoozed_until is required", bail: true },
        isISO8601: {
            errorMessage: "snoozed_until must be an ISO-8601 timestamp",
            bail: true,
        },
        custom: {
            options: (value: string): boolean => {
                if (new Date(value).getTime() <= Date.now()) {
                    throw new Error("snoozed_until must be in the future");
                }
                return true;
            },
        },
    },
});

/**
 * Body validator for `PUT /api/v1/notifications/preferences`. The body is a map
 * of `notificationType → { in_app_enabled, email_enabled }`. express-validator
 * is field-oriented, so the whole body is validated in one custom check: it must
 * be a non-empty plain object whose every key is a known notification type and
 * whose every value carries exactly the two boolean channel flags. Unknown
 * types and unknown keys are rejected (no silent drops).
 */
export const updatePreferencesValidator = [
    body().custom((value: unknown): boolean => {
        if (typeof value !== "object" || value === null || Array.isArray(value)) {
            throw new Error(
                "Body must be an object mapping a notification type to { in_app_enabled, email_enabled }",
            );
        }
        const entries = Object.entries(value as Record<string, unknown>);
        if (entries.length === 0) {
            throw new Error(
                "Provide at least one notification-type preference to update",
            );
        }
        const allowed = new Set<string>(notificationTypes);
        for (const [type, pref] of entries) {
            if (!allowed.has(type)) {
                throw new Error(`Unknown notification type: ${type}`);
            }
            if (
                typeof pref !== "object" ||
                pref === null ||
                Array.isArray(pref)
            ) {
                throw new Error(
                    `Preference for "${type}" must be an object with in_app_enabled and email_enabled`,
                );
            }
            const p = pref as Record<string, unknown>;
            if (
                typeof p.in_app_enabled !== "boolean" ||
                typeof p.email_enabled !== "boolean"
            ) {
                throw new Error(
                    `Preference for "${type}" must have boolean in_app_enabled and email_enabled`,
                );
            }
            const extra = Object.keys(p).filter(
                (k) => k !== "in_app_enabled" && k !== "email_enabled",
            );
            if (extra.length > 0) {
                throw new Error(
                    `Preference for "${type}" has unknown keys: ${extra.join(", ")}`,
                );
            }
        }
        return true;
    }),
];
