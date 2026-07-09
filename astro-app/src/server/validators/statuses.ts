import { checkSchema } from "express-validator";
import { statusGroups } from "../db/schema/_shared";

/**
 * Validators for §7 Statuses endpoints. Pair each `checkSchema(...)` with the
 * `validate` middleware so failures are translated into the spec envelope
 * (422 / `validation.failed`).
 */

export const listStatusesValidator = checkSchema({
    listId: {
        in: ["params"],
        trim: true,
        notEmpty: {
            errorMessage: "listId is required",
        },
        isLength: {
            options: { max: 64 },
            errorMessage: "listId is too long (max 64 chars)",
        },
    },
});

/**
 * `POST /api/v1/lists/:listId/statuses`.
 *
 * `name` + `status_group` are required; `color` defaults to the column default
 * (`#94A3B8`) when omitted; `position` is optional — the service appends the
 * status to the end of the list when it is absent. `scope_type` / `scope_id`
 * are never client input: the service pins them to the list in the path.
 */
export const createStatusValidator = checkSchema({
    listId: {
        in: ["params"],
        trim: true,
        notEmpty: {
            errorMessage: "listId is required",
        },
        isLength: {
            options: { max: 64 },
            errorMessage: "listId is too long (max 64 chars)",
        },
    },
    name: {
        in: ["body"],
        trim: true,
        notEmpty: {
            errorMessage: "name is required",
        },
        isLength: {
            options: { max: 80 },
            errorMessage: "name is too long (max 80 chars)",
        },
    },
    status_group: {
        in: ["body"],
        notEmpty: {
            errorMessage: "status_group is required",
        },
        isIn: {
            options: [[...statusGroups]],
            errorMessage: `status_group must be one of: ${statusGroups.join(", ")}`,
        },
    },
    color: {
        in: ["body"],
        optional: true,
        trim: true,
        matches: {
            options: /^#[0-9A-Fa-f]{6}$/,
            errorMessage: "color must be a hex code like #RRGGBB",
        },
    },
    position: {
        in: ["body"],
        optional: true,
        isInt: {
            options: { min: 0 },
            errorMessage: "position must be a non-negative integer",
        },
        toInt: true,
    },
});

/**
 * `PATCH /api/v1/statuses/:id`.
 *
 * Every body field is optional; the controller enforces that at least one of
 * `name` / `color` / `status_group` is present (422 otherwise). `scope_type` /
 * `scope_id` / `position` are not accepted here — §7 PATCH covers name/color/
 * group only (position is owned by the reorder endpoint).
 */
export const updateStatusValidator = checkSchema({
    id: {
        in: ["params"],
        trim: true,
        notEmpty: {
            errorMessage: "id is required",
        },
        isLength: {
            options: { max: 64 },
            errorMessage: "id is too long (max 64 chars)",
        },
    },
    name: {
        in: ["body"],
        optional: true,
        trim: true,
        notEmpty: {
            errorMessage: "name must not be empty",
        },
        isLength: {
            options: { max: 80 },
            errorMessage: "name is too long (max 80 chars)",
        },
    },
    status_group: {
        in: ["body"],
        optional: true,
        isIn: {
            options: [[...statusGroups]],
            errorMessage: `status_group must be one of: ${statusGroups.join(", ")}`,
        },
    },
    color: {
        in: ["body"],
        optional: true,
        trim: true,
        matches: {
            options: /^#[0-9A-Fa-f]{6}$/,
            errorMessage: "color must be a hex code like #RRGGBB",
        },
    },
});

/**
 * `DELETE /api/v1/statuses/:id`.
 *
 * Validates only the `:id` path param (no body). The service resolves the id
 * within the caller's workspace and applies the `in_use` / `last_in_group`
 * guards.
 */
export const deleteStatusValidator = checkSchema({
    id: {
        in: ["params"],
        trim: true,
        notEmpty: {
            errorMessage: "id is required",
        },
        isLength: {
            options: { max: 64 },
            errorMessage: "id is too long (max 64 chars)",
        },
    },
});

/**
 * `PATCH /api/v1/lists/:listId/statuses/reorder`.
 *
 * Validates only the `:listId` path param. The request body is a bare top-level
 * JSON array (`[{ id, position }, …]`), which `checkSchema` cannot validate
 * cleanly (it targets named body fields) — so the array's structure is validated
 * in `StatusesController.reorder` and surfaced as `422 validation.failed`.
 */
export const reorderStatusesValidator = checkSchema({
    listId: {
        in: ["params"],
        trim: true,
        notEmpty: {
            errorMessage: "listId is required",
        },
        isLength: {
            options: { max: 64 },
            errorMessage: "listId is too long (max 64 chars)",
        },
    },
});
