import { checkSchema } from "express-validator";

/**
 * Validators for §6 Lists endpoints. Pair each `checkSchema(...)` with the
 * `validate` middleware so failures are translated into the spec envelope
 * (422 / `validation.failed`).
 */

const NAME_MAX = 120; // lists.name VARCHAR(120)
const DESCRIPTION_MAX = 500; // lists.description VARCHAR(500)
const ICON_MAX = 64; // lists.icon VARCHAR(64)
const ID_MAX = 64; // VARCHAR(64) id columns
// `lists.color` is CHAR(7); validate the `#RRGGBB` shape here so a malformed
// value is a clean 422 rather than a 500 from the column width / CHECK.
const HEX_COLOR = /^#[0-9A-Fa-f]{6}$/;

export const listBySpaceValidator = checkSchema({
    spaceId: {
        in: ["params"],
        trim: true,
        notEmpty: {
            errorMessage: "spaceId is required",
        },
        isLength: {
            options: { max: 64 },
            errorMessage: "spaceId is too long (max 64 chars)",
        },
    },
    include_archived: {
        in: ["query"],
        optional: true,
        // Strict boolean check (validator.js default accepts
        // 'true' | 'false' | '0' | '1'). We deliberately do NOT sanitize to a
        // boolean — the controller reads the raw query string and coerces it,
        // keeping `req.query.include_archived` a string for the type checker.
        // Mirrors `listSpacesValidator` (§5) for cross-endpoint parity.
        isBoolean: {
            errorMessage: "include_archived must be a boolean (true or false)",
        },
    },
});

/**
 * `GET /api/v1/lists` — cross-space listing for the whole workspace. Both query
 * params are optional: `space_id` narrows to one space, `include_archived`
 * surfaces archived lists. The `include_archived` block is identical to
 * `listBySpaceValidator` so the two §6 read endpoints accept the exact same
 * boolean spellings.
 */
export const listAllValidator = checkSchema({
    space_id: {
        in: ["query"],
        optional: true,
        trim: true,
        notEmpty: {
            errorMessage: "space_id must not be empty",
        },
        isLength: {
            options: { max: 64 },
            errorMessage: "space_id is too long (max 64 chars)",
        },
    },
    include_archived: {
        in: ["query"],
        optional: true,
        // See `listBySpaceValidator`: validated, not sanitised — the controller
        // coerces the raw string (`"true" | "1"`) itself.
        isBoolean: {
            errorMessage: "include_archived must be a boolean (true or false)",
        },
    },
});

/**
 * `POST /api/v1/lists`.
 *
 * `space_id` + `name` are required; the controller applies the schema defaults
 * (`icon` → `ListChecks`, `color` → `#4F46E5`, `is_private` → `false`,
 * `default_task_type_id` → `null`) for the omitted optionals. `is_private` must
 * be a real JSON boolean (a typeof check rejects `1` / `"true"`).
 * `default_task_type_id` accepts a non-empty id string OR an explicit `null`
 * (clears the default). `workspace_id` / `created_by` / `position` are never
 * read from the body — identity comes from `req.auth` and position appends
 * server-side — so stray fields are simply ignored.
 */
export const createListValidator = checkSchema({
    space_id: {
        in: ["body"],
        isString: { errorMessage: "space_id must be a string", bail: true },
        trim: true,
        notEmpty: { errorMessage: "space_id is required" },
        isLength: {
            options: { max: ID_MAX },
            errorMessage: `space_id must be at most ${ID_MAX} characters`,
        },
    },
    name: {
        in: ["body"],
        isString: { errorMessage: "name must be a string", bail: true },
        trim: true,
        notEmpty: { errorMessage: "name is required" },
        isLength: {
            options: { max: NAME_MAX },
            errorMessage: `name must be at most ${NAME_MAX} characters`,
        },
    },
    description: {
        in: ["body"],
        optional: true,
        isString: { errorMessage: "description must be a string", bail: true },
        trim: true,
        isLength: {
            options: { max: DESCRIPTION_MAX },
            errorMessage: `description must be at most ${DESCRIPTION_MAX} characters`,
        },
    },
    icon: {
        in: ["body"],
        optional: true,
        isString: { errorMessage: "icon must be a string", bail: true },
        trim: true,
        notEmpty: { errorMessage: "icon must not be empty" },
        isLength: {
            options: { max: ICON_MAX },
            errorMessage: `icon must be at most ${ICON_MAX} characters`,
        },
    },
    color: {
        in: ["body"],
        optional: true,
        isString: { errorMessage: "color must be a string", bail: true },
        trim: true,
        matches: {
            options: HEX_COLOR,
            errorMessage: "color must be a hex code like #RRGGBB",
        },
    },
    is_private: {
        in: ["body"],
        optional: true,
        custom: {
            options: (value: unknown) => typeof value === "boolean",
            errorMessage: "is_private must be a boolean",
        },
    },
    default_task_type_id: {
        in: ["body"],
        // `optional: true` skips an absent (undefined) value; an explicit `null`
        // is NOT skipped and is accepted by the custom check below (clears the
        // default). A provided string is trimmed first, then length-checked.
        optional: true,
        customSanitizer: {
            options: (value: unknown) =>
                typeof value === "string" ? value.trim() : value,
        },
        custom: {
            options: (value: unknown) => {
                if (value === null) return true;
                if (
                    typeof value === "string" &&
                    value.length > 0 &&
                    value.length <= ID_MAX
                ) {
                    return true;
                }
                throw new Error(
                    `default_task_type_id must be a non-empty id string (max ${ID_MAX} chars) or null`,
                );
            },
        },
    },
});

/**
 * `PATCH /api/v1/lists/:id`.
 *
 * Every body field is optional; the controller enforces that at least one of
 * `name` / `description` / `icon` / `color` / `default_task_type_id` is present
 * (422 otherwise). `description` and `default_task_type_id` accept an explicit
 * `null` to clear the field. `space_id` / `is_private` / `position` are not
 * accepted here — §6 PATCH covers name / description / icon / color / default
 * task type only.
 */
export const updateListValidator = checkSchema({
    id: {
        in: ["params"],
        trim: true,
        notEmpty: { errorMessage: "id is required" },
        isLength: {
            options: { max: ID_MAX },
            errorMessage: `id must be at most ${ID_MAX} characters`,
        },
    },
    name: {
        in: ["body"],
        optional: true,
        isString: { errorMessage: "name must be a string", bail: true },
        trim: true,
        notEmpty: { errorMessage: "name must not be empty" },
        isLength: {
            options: { max: NAME_MAX },
            errorMessage: `name must be at most ${NAME_MAX} characters`,
        },
    },
    description: {
        in: ["body"],
        // Optional; an explicit `null` clears the field and is accepted by the
        // custom check below. A provided string is trimmed, then length-checked.
        optional: true,
        customSanitizer: {
            options: (value: unknown) =>
                typeof value === "string" ? value.trim() : value,
        },
        custom: {
            options: (value: unknown) => {
                if (value === null) return true;
                if (typeof value === "string" && value.length <= DESCRIPTION_MAX) {
                    return true;
                }
                throw new Error(
                    `description must be a string (max ${DESCRIPTION_MAX} chars) or null`,
                );
            },
        },
    },
    icon: {
        in: ["body"],
        optional: true,
        isString: { errorMessage: "icon must be a string", bail: true },
        trim: true,
        notEmpty: { errorMessage: "icon must not be empty" },
        isLength: {
            options: { max: ICON_MAX },
            errorMessage: `icon must be at most ${ICON_MAX} characters`,
        },
    },
    color: {
        in: ["body"],
        optional: true,
        isString: { errorMessage: "color must be a string", bail: true },
        trim: true,
        matches: {
            options: HEX_COLOR,
            errorMessage: "color must be a hex code like #RRGGBB",
        },
    },
    default_task_type_id: {
        in: ["body"],
        optional: true,
        customSanitizer: {
            options: (value: unknown) =>
                typeof value === "string" ? value.trim() : value,
        },
        custom: {
            options: (value: unknown) => {
                if (value === null) return true;
                if (
                    typeof value === "string" &&
                    value.length > 0 &&
                    value.length <= ID_MAX
                ) {
                    return true;
                }
                throw new Error(
                    `default_task_type_id must be a non-empty id string (max ${ID_MAX} chars) or null`,
                );
            },
        },
    },
    /**
     * F28 (ISS-036, decision D12.7) — MOVE a list to another space.
     *
     * A list created in the wrong department used to be stuck there: the only
     * route was to build a replacement in the right space and hand-move every
     * task, with no bulk move. For an 8-department workspace where complaint
     * work plausibly starts in Customer Service and belongs in the Complain
     * Department, that comes up.
     *
     * Unlike `default_task_type_id`, `null` is NOT accepted: a list must always
     * belong to a space. The target is resolved and guarded in the service
     * (404 unknown / 409 archived / 409 duplicate name).
     *
     * `is_private` is deliberately still absent from this schema — see the note
     * on `ListService.update`.
     */
    space_id: {
        in: ["body"],
        optional: true,
        isString: { errorMessage: "space_id must be a string", bail: true },
        trim: true,
        notEmpty: { errorMessage: "space_id must not be empty" },
        isLength: {
            options: { max: ID_MAX },
            errorMessage: `space_id must be at most ${ID_MAX} characters`,
        },
    },
});

/**
 * `GET /api/v1/lists/:id` — single-list read. Guards the `:id` path param the
 * same way `listBySpaceValidator` guards `spaceId`. `notEmpty` is defensive:
 * Express only matches `/lists/:id` when the segment is non-empty, so an empty
 * id is unreachable here, but the rule keeps the two §6 read validators uniform.
 */
export const getListValidator = checkSchema({
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
