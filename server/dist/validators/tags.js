"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.deleteTagValidator = exports.updateTagValidator = exports.createTagValidator = void 0;
const express_validator_1 = require("express-validator");
/**
 * Validators for the Tags resource family. Pair each `checkSchema(...)` with
 * the `validate` middleware so failures become the spec envelope (422 /
 * `validation.failed`).
 */
const NAME_MAX = 60; // tags.name VARCHAR(60)
const ID_MAX = 64; // tags.id VARCHAR(64)
// `tags.color` is CHAR(7) with NO DB CHECK constraint (unlike spaces), so the
// `#RRGGBB` shape must be enforced here or a malformed value would be padded /
// truncated silently by MySQL.
const HEX_COLOR = /^#[0-9A-Fa-f]{6}$/;
/**
 * Cross-field guard: at least one of the named body fields must be present
 * (non-null). Mirrors the `addAssignees` "provide one" rule — attach it to a
 * sentinel schema key so it runs even when every real field is absent (a key
 * marked `optional` would be skipped, defeating the check).
 */
const atLeastOne = (fields) => (_value, { req }) => {
    const body = (req.body ?? {});
    const present = fields.some((f) => body[f] !== undefined && body[f] !== null);
    if (!present) {
        throw new Error(`Provide at least one of: ${fields.join(", ")}`);
    }
    return true;
};
/**
 * `POST /api/v1/tags`.
 *
 * `name` is required (the `isString` bail makes a missing/non-string value fail
 * fast); `trim` + `notEmpty` reject whitespace-only names; `isLength` guards the
 * column width. `color` is optional — omit it to take the schema default — but
 * when present it must be a `#RRGGBB` hex code. Both fields are trimmed in place
 * so the controller reads the sanitised values.
 */
exports.createTagValidator = (0, express_validator_1.checkSchema)({
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
});
/**
 * `PATCH /api/v1/tags/:id`.
 *
 * Partial update: `name` and `color` are each optional but the `fields` guard
 * requires at least one. When present, `name` is trimmed and bounded to the
 * column width and `color` must be a `#RRGGBB` hex code (no DB CHECK backs it).
 * Sanitisers run in place so the controller reads the trimmed values.
 */
exports.updateTagValidator = (0, express_validator_1.checkSchema)({
    id: {
        in: ["params"],
        trim: true,
        notEmpty: { errorMessage: "Tag id is required" },
        isLength: {
            options: { max: ID_MAX },
            errorMessage: `Tag id is too long (max ${ID_MAX} chars)`,
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
    // Sentinel key (no such body field) — carries the cross-field rule so it
    // runs even for an empty body. NOT marked `optional`, or it would be skipped.
    fields: {
        in: ["body"],
        custom: { options: atLeastOne(["name", "color"]) },
    },
});
/**
 * `DELETE /api/v1/tags/:id`.
 *
 * Only the `:id` path param is validated (bounded to the column width); there is
 * no body. Mirrors `updateTagValidator`'s id block so the two id-keyed verbs
 * reject the same malformed ids identically.
 */
exports.deleteTagValidator = (0, express_validator_1.checkSchema)({
    id: {
        in: ["params"],
        trim: true,
        notEmpty: { errorMessage: "Tag id is required" },
        isLength: {
            options: { max: ID_MAX },
            errorMessage: `Tag id is too long (max ${ID_MAX} chars)`,
        },
    },
});
