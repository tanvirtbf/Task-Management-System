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
    // F23 (ISS-040): one rule per resource — PATCH refuses the server-owned
    // fields (they fall out of matchedData and trip the empty-patch 422), so
    // CREATE must refuse them too instead of answering 201 and silently
    // storing `is_system=0`. P11 measured exactly that silence.
    is_system: {
        in: ["body"],
        custom: {
            options: (value: unknown): boolean => {
                if (value === undefined) return true;
                throw new Error(
                    "is_system is server-owned and cannot be set on create",
                );
            },
        },
    },
    position: {
        in: ["body"],
        custom: {
            options: (value: unknown): boolean => {
                if (value === undefined) return true;
                throw new Error(
                    "position is server-assigned and cannot be set on create",
                );
            },
        },
    },
    name: {
        in: ["body"],
        // `isString` runs BEFORE `trim`: the `trim` sanitizer stringifies its
        // input (`123` → `"123"`), so a type check placed after it would never
        // see a non-string. Order matters — type-guard first, then sanitize.
        isString: { errorMessage: "name must be a string" },
        trim: true,
        notEmpty: { errorMessage: "name is required" },
        isLength: {
            options: { max: MAX_NAME_LENGTH },
            errorMessage: "name is too long (max 80 chars)",
        },
    },
    icon: {
        in: ["body"],
        optional: true,
        isString: { errorMessage: "icon must be a string" },
        trim: true,
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
        // `isString` before `trim`: `trim` stringifies its input, so the type
        // guard must run first (same fix as name/icon).
        isString: { errorMessage: "description must be a string" },
        trim: true,
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
 * `DELETE /api/v1/task-types/:id`.
 *
 * Validates only the `:id` path param (no body). The service resolves the id
 * within the caller's workspace and applies the `system` / `in_use` guards.
 */
export const deleteTaskTypeValidator = checkSchema({
    id: {
        in: ["params"],
        trim: true,
        notEmpty: { errorMessage: "id is required" },
        isLength: {
            options: { max: MAX_ID_LENGTH },
            errorMessage: "id is too long (max 64 chars)",
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
        // `isString` before `trim` — see the create validator: `trim`
        // stringifies its input, so the type guard must run first.
        isString: { errorMessage: "name must be a string" },
        trim: true,
        notEmpty: { errorMessage: "name must not be empty" },
        isLength: {
            options: { max: MAX_NAME_LENGTH },
            errorMessage: "name is too long (max 80 chars)",
        },
    },
    icon: {
        in: ["body"],
        optional: true,
        isString: { errorMessage: "icon must be a string" },
        trim: true,
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
        // `isString` before `trim`: `trim` stringifies its input, so the type
        // guard must run first (same fix as name/icon).
        isString: { errorMessage: "description must be a string" },
        trim: true,
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
