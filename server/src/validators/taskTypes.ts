import { checkSchema } from "express-validator";

/**
 * Validators for §8 Task types endpoints. Pair each `checkSchema(...)` with the
 * `validate` middleware so failures are translated into the spec envelope
 * (422 / `validation.failed`).
 */

const MAX_ID_LENGTH = 64; // VARCHAR(64) primary keys
const MAX_NAME_LENGTH = 80; // task_types.name VARCHAR(80)
const MAX_ICON_LENGTH = 64; // task_types.icon VARCHAR(64)
const MAX_DESCRIPTION_LENGTH = 300; // task_types.description VARCHAR(300)

// task_types.color is CHAR(7); the DB has no CHECK on it (unlike spaces.color),
// so the format is enforced here. Full `#RRGGBB` only — no 3-digit shorthand.
const HEX_COLOR_RE = /^#[0-9A-Fa-f]{6}$/;

/**
 * `POST /api/v1/task-types`.
 *
 * `name` is required; `icon` / `color` / `description` are optional and fall
 * back to the column DEFAULT when omitted (the controller forwards `undefined`,
 * not `null`). The `is_*` flags must be real JSON booleans. `is_system`,
 * `position`, and `id` are NOT accepted here — they are server-assigned.
 */
export const createTaskTypeValidator = checkSchema({
    name: {
        in: ["body"],
        trim: true,
        notEmpty: { errorMessage: "name is required" },
        isString: { errorMessage: "name must be a string" },
        isLength: {
            options: { max: MAX_NAME_LENGTH },
            errorMessage: "name is too long (max 80 chars)",
        },
    },
    icon: {
        in: ["body"],
        optional: true,
        trim: true,
        isString: { errorMessage: "icon must be a string" },
        isLength: {
            options: { max: MAX_ICON_LENGTH },
            errorMessage: "icon is too long (max 64 chars)",
        },
    },
    color: {
        in: ["body"],
        optional: true,
        trim: true,
        matches: {
            options: HEX_COLOR_RE,
            errorMessage: "color must be a hex value like #6B7280",
        },
    },
    description: {
        in: ["body"],
        // `null` is accepted (treated as "not provided") so a client may clear
        // the field explicitly; a blank string is normalised to NULL downstream.
        optional: { options: { values: "null" } },
        trim: true,
        isString: { errorMessage: "description must be a string" },
        isLength: {
            options: { max: MAX_DESCRIPTION_LENGTH },
            errorMessage: "description is too long (max 300 chars)",
        },
    },
    is_milestone_type: {
        in: ["body"],
        optional: true,
        isBoolean: {
            options: { strict: true },
            errorMessage: "is_milestone_type must be a boolean",
        },
    },
    is_dev_type: {
        in: ["body"],
        optional: true,
        isBoolean: {
            options: { strict: true },
            errorMessage: "is_dev_type must be a boolean",
        },
    },
});

/**
 * `PATCH /api/v1/task-types/:id`.
 *
 * Every body field is optional (partial update) but, when present, obeys the
 * same rules as create — `name` non-empty ≤80, `color` a 6-digit hex, etc.
 * `description` additionally accepts `null` to clear the field. The "at least
 * one field" rule is enforced in the service (so the empty-patch error shares
 * the `validation.failed` envelope). `is_system`, `position`, and `id` (body)
 * are not accepted — they are server-owned.
 */
export const updateTaskTypeValidator = checkSchema({
    id: {
        in: ["params"],
        trim: true,
        notEmpty: { errorMessage: "id is required" },
        isLength: {
            options: { max: MAX_ID_LENGTH },
            errorMessage: "id is too long (max 64 chars)",
        },
    },
    name: {
        in: ["body"],
        optional: true,
        trim: true,
        notEmpty: { errorMessage: "name must not be empty" },
        isString: { errorMessage: "name must be a string" },
        isLength: {
            options: { max: MAX_NAME_LENGTH },
            errorMessage: "name is too long (max 80 chars)",
        },
    },
    icon: {
        in: ["body"],
        optional: true,
        trim: true,
        isString: { errorMessage: "icon must be a string" },
        isLength: {
            options: { max: MAX_ICON_LENGTH },
            errorMessage: "icon is too long (max 64 chars)",
        },
    },
    color: {
        in: ["body"],
        optional: true,
        trim: true,
        matches: {
            options: HEX_COLOR_RE,
            errorMessage: "color must be a hex value like #6B7280",
        },
    },
    description: {
        in: ["body"],
        // `null` clears the field; `undefined` (absent) leaves it unchanged.
        optional: { options: { values: "null" } },
        trim: true,
        isString: { errorMessage: "description must be a string" },
        isLength: {
            options: { max: MAX_DESCRIPTION_LENGTH },
            errorMessage: "description is too long (max 300 chars)",
        },
    },
    is_milestone_type: {
        in: ["body"],
        optional: true,
        isBoolean: {
            options: { strict: true },
            errorMessage: "is_milestone_type must be a boolean",
        },
    },
    is_dev_type: {
        in: ["body"],
        optional: true,
        isBoolean: {
            options: { strict: true },
            errorMessage: "is_dev_type must be a boolean",
        },
    },
});
