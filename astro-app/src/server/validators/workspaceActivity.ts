import { checkSchema, type Meta } from "express-validator";
import { workspaceActivityEntityTypes } from "../db/schema/_shared";

/**
 * Query validators for the §26 Workspace-activity endpoints. Pair each
 * `checkSchema(...)` with the shared `validate` middleware so failures render as
 * 422 `validation.failed`.
 */

/**
 * Reject a repeated query param. A duplicated key (`?limit=1&limit=2`) arrives
 * as an array, which express-validator otherwise validates element-by-element
 * (so it passes) and then flows into a scalar — producing a `NaN`/array. Mirrors
 * the `users` / `task-activity` / `notifications` validators.
 */
const notRepeated = (field: string) => ({
    options: (_value: unknown, { req }: Meta): boolean => {
        if (Array.isArray(req.query?.[field])) {
            throw new Error(`${field} must not be repeated`);
        }
        return true;
    },
});

/** `GET /api/v1/activity/recent` — only an optional `limit`. */
export const recentActivityValidator = checkSchema({
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

/** `GET /api/v1/activity` — entity_type / actor_id / from / to / cursor / limit. */
export const activityFeedValidator = checkSchema({
    entity_type: {
        in: ["query"],
        optional: true,
        custom: notRepeated("entity_type"),
        isIn: {
            options: [[...workspaceActivityEntityTypes]],
            errorMessage: `entity_type must be one of: ${workspaceActivityEntityTypes.join(", ")}`,
        },
    },
    actor_id: {
        in: ["query"],
        optional: true,
        custom: notRepeated("actor_id"),
        isString: { errorMessage: "actor_id must be a string" },
        trim: true,
        notEmpty: { errorMessage: "actor_id must not be empty" },
        isLength: {
            options: { max: 64 },
            errorMessage: "actor_id must be at most 64 characters",
        },
    },
    from: {
        in: ["query"],
        optional: true,
        custom: notRepeated("from"),
        isISO8601: { errorMessage: "from must be an ISO-8601 timestamp" },
    },
    to: {
        in: ["query"],
        optional: true,
        custom: notRepeated("to"),
        isISO8601: { errorMessage: "to must be an ISO-8601 timestamp" },
    },
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
