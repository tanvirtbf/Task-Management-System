import { checkSchema } from "express-validator";

/**
 * Validators for §6 Lists endpoints. Pair each `checkSchema(...)` with the
 * `validate` middleware so failures are translated into the spec envelope
 * (422 / `validation.failed`).
 */

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
