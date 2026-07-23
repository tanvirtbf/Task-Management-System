import { checkSchema } from "express-validator";

/**
 * Validators for §5 Spaces endpoints. Pair each `checkSchema(...)` with the
 * `validate` middleware so failures are translated into the spec envelope
 * (422 / `validation.failed`).
 */

const NAME_MAX = 120; // spaces.name VARCHAR(120)
const DESCRIPTION_MAX = 500; // spaces.description VARCHAR(500)
const ICON_MAX = 64; // spaces.icon VARCHAR(64)
const POSITION_MAX = 4294967295; // spaces.position INT UNSIGNED
// `spaces.color` is CHAR(7) and the DB enforces `ck_spaces_color`; we validate
// the same `#RRGGBB` shape here so a malformed value is a clean 422 rather than
// a 500 from the CHECK constraint.
const HEX_COLOR = /^#[0-9A-Fa-f]{6}$/;

export const listSpacesValidator = checkSchema({
    include_archived: {
        in: ["query"],
        optional: true,
        // Normalise casing first so `?include_archived=TRUE` is accepted, then
        // restrict to the two valid values.
        customSanitizer: {
            options: (value: unknown) =>
                typeof value === "string" ? value.toLowerCase() : value,
        },
        isIn: {
            options: [["true", "false"]],
            errorMessage: "include_archived must be 'true' or 'false'",
        },
    },
});

export const getSpaceValidator = checkSchema({
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
 * Shared `:id` path-param validator for the param-only space endpoints —
 * `POST /:id/archive`, `POST /:id/unarchive`, `DELETE /:id`. Same rule as
 * `getSpaceValidator` (trim, required, ≤64 chars); kept as its own export so
 * the read and the mutating routes read clearly at their call sites.
 */
export const spaceIdParamValidator = checkSchema({
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
 * `POST /api/v1/spaces`.
 *
 * `name` is required; everything else is optional and the controller applies
 * the schema defaults (`icon` → `Folder`, `color` → `#4F46E5`, `is_private` →
 * `false`, `position` → `0`) when omitted. `is_private` must be a real JSON
 * boolean (a typeof check rejects `1` / `"true"`), and `position` is bounded to
 * the `INT UNSIGNED` range. `workspace_id` / `created_by` are never read from
 * the body — they come from `req.auth` — so stray fields are simply ignored.
 */
export const createSpaceValidator = checkSchema({
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
    position: {
        in: ["body"],
        optional: true,
        isInt: {
            options: { min: 0, max: POSITION_MAX },
            errorMessage: `position must be an integer between 0 and ${POSITION_MAX}`,
        },
        toInt: true,
    },
});

/**
 * `PATCH /api/v1/spaces/:id`.
 *
 * Every body field is OPTIONAL (a partial update) but, when present, obeys the
 * same rules as create — so `name`, if sent, must still be a non-empty
 * ≤120-char string, `color` a `#RRGGBB` hex, `is_private` a real boolean, etc.
 * The `:id` param is validated like `getSpaceValidator`. A body with no
 * updatable fields is accepted and handled as a no-op by the service.
 * `workspace_id` / `created_by` are never read from the body.
 */
export const updateSpaceValidator = checkSchema({
    id: {
        in: ["params"],
        trim: true,
        notEmpty: { errorMessage: "id is required" },
        isLength: {
            options: { max: 64 },
            errorMessage: "id is too long (max 64 chars)",
        },
    },
    // Dept Review V1 — department head. `null` clears the head; any other value
    // must be a user id string (existence/role/status checks live in the
    // service → 422 `space.head_invalid`). Mirrors the workspace `logo_url`
    // nullable-clear pattern: `nullable: true` lets null through untouched.
    head_user_id: {
        in: ["body"],
        optional: { options: { nullable: true } },
        custom: {
            options: (value: unknown): boolean => {
                if (typeof value !== "string") {
                    throw new Error(
                        "head_user_id must be a user id string or null",
                    );
                }
                if (value.length === 0 || value.length > 64) {
                    throw new Error("head_user_id must be 1-64 characters");
                }
                return true;
            },
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
    position: {
        in: ["body"],
        optional: true,
        isInt: {
            options: { min: 0, max: POSITION_MAX },
            errorMessage: `position must be an integer between 0 and ${POSITION_MAX}`,
        },
        toInt: true,
    },
});
