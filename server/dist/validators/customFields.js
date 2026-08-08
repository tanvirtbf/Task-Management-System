"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.taskFieldParamsValidator = exports.customFieldIdParamValidator = exports.updateCustomFieldValidator = exports.createCustomFieldValidator = exports.listForListValidator = exports.listCustomFieldsValidator = void 0;
const express_validator_1 = require("express-validator");
const _shared_1 = require("../db/schema/_shared");
/**
 * Validators for §17 Custom Fields. Pair each `checkSchema(...)` with the
 * `validate` middleware so failures become the spec envelope (422 /
 * `validation.failed`).
 *
 * NOTE: `type` is deliberately NOT enum-restricted here — the service checks it
 * against the 6 supported values and throws `422 custom_field.unsupported_type`
 * (the spec's marquee code), which a generic `isIn` 422 would pre-empt.
 */
const ID_MAX = 64;
const NAME_MAX = 120; // custom_fields.name VARCHAR(120)
const TYPE_MAX = 20;
const POSITION_MAX = 4294967295; // INT UNSIGNED
const HEX_COLOR = /^#[0-9A-Fa-f]{6}$/;
const idParam = {
    in: ["params"],
    trim: true,
    notEmpty: { errorMessage: "id is required" },
    isLength: {
        options: { max: ID_MAX },
        errorMessage: `id is too long (max ${ID_MAX} chars)`,
    },
};
exports.listCustomFieldsValidator = (0, express_validator_1.checkSchema)({
    scope_type: {
        in: ["query"],
        optional: true,
        isIn: {
            options: [[..._shared_1.customFieldScopeTypes]],
            errorMessage: `scope_type must be one of: ${_shared_1.customFieldScopeTypes.join(", ")}`,
        },
    },
    scope_id: {
        in: ["query"],
        optional: true,
        isString: { errorMessage: "scope_id must be a string" },
        trim: true,
        isLength: {
            options: { max: ID_MAX },
            errorMessage: `scope_id is too long (max ${ID_MAX} chars)`,
        },
    },
});
exports.listForListValidator = (0, express_validator_1.checkSchema)({
    listId: {
        in: ["params"],
        trim: true,
        notEmpty: { errorMessage: "listId is required" },
        isLength: {
            options: { max: ID_MAX },
            errorMessage: `listId is too long (max ${ID_MAX} chars)`,
        },
    },
});
exports.createCustomFieldValidator = (0, express_validator_1.checkSchema)({
    scope_type: {
        in: ["body"],
        isIn: {
            options: [[..._shared_1.customFieldScopeTypes]],
            errorMessage: `scope_type must be one of: ${_shared_1.customFieldScopeTypes.join(", ")}`,
        },
    },
    scope_id: {
        in: ["body"],
        optional: { options: { nullable: true } },
        isString: { errorMessage: "scope_id must be a string", bail: true },
        trim: true,
        notEmpty: { errorMessage: "scope_id must not be empty" },
        isLength: {
            options: { max: ID_MAX },
            errorMessage: `scope_id is too long (max ${ID_MAX} chars)`,
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
    type: {
        in: ["body"],
        isString: { errorMessage: "type must be a string", bail: true },
        trim: true,
        notEmpty: { errorMessage: "type is required" },
        isLength: {
            options: { max: TYPE_MAX },
            errorMessage: `type is too long (max ${TYPE_MAX} chars)`,
        },
    },
    config: {
        in: ["body"],
        optional: true,
        custom: {
            options: (value) => typeof value === "object" &&
                value !== null &&
                !Array.isArray(value),
            errorMessage: "config must be an object",
        },
    },
    is_required: {
        in: ["body"],
        optional: true,
        custom: {
            options: (value) => typeof value === "boolean",
            errorMessage: "is_required must be a boolean",
        },
    },
    // F26 (ISS-042): the guest-redaction flag reaches the API at last — the
    // redaction logic has always worked (TasksRepo filters on it), but the
    // column appeared in no validator and no serializer, so the one control
    // the product implements could only be switched on by hand in SQL.
    hidden_from_guests: {
        in: ["body"],
        optional: true,
        custom: {
            options: (value) => typeof value === "boolean",
            errorMessage: "hidden_from_guests must be a boolean",
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
    options: {
        in: ["body"],
        optional: { options: { nullable: true } },
        isArray: {
            options: { max: 100 },
            errorMessage: "options must be an array of at most 100 entries",
        },
    },
    "options.*.label": {
        in: ["body"],
        isString: {
            errorMessage: "each option label must be a string",
            bail: true,
        },
        trim: true,
        notEmpty: { errorMessage: "each option label is required" },
        isLength: {
            options: { max: NAME_MAX },
            errorMessage: `each option label must be at most ${NAME_MAX} characters`,
        },
    },
    "options.*.color": {
        in: ["body"],
        optional: true,
        matches: {
            options: HEX_COLOR,
            errorMessage: "option color must be a hex code like #RRGGBB",
        },
    },
    "options.*.position": {
        in: ["body"],
        optional: true,
        isInt: {
            options: { min: 0, max: POSITION_MAX },
            errorMessage: "option position must be a non-negative integer",
        },
        toInt: true,
    },
});
/**
 * `PATCH /api/v1/custom-fields/:id`. Only name/config/is_required/position are
 * updatable. `type`, `scope_type`, `scope_id` are IMMUTABLE — supplying any of
 * them is rejected (422) rather than silently ignored, so a client never thinks
 * a type/scope change succeeded.
 */
exports.updateCustomFieldValidator = (0, express_validator_1.checkSchema)({
    id: idParam,
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
    config: {
        in: ["body"],
        optional: true,
        custom: {
            options: (value) => typeof value === "object" &&
                value !== null &&
                !Array.isArray(value),
            errorMessage: "config must be an object",
        },
    },
    is_required: {
        in: ["body"],
        optional: true,
        custom: {
            options: (value) => typeof value === "boolean",
            errorMessage: "is_required must be a boolean",
        },
    },
    // F26 (ISS-042): the guest-redaction flag reaches the API at last — the
    // redaction logic has always worked (TasksRepo filters on it), but the
    // column appeared in no validator and no serializer, so the one control
    // the product implements could only be switched on by hand in SQL.
    hidden_from_guests: {
        in: ["body"],
        optional: true,
        custom: {
            options: (value) => typeof value === "boolean",
            errorMessage: "hidden_from_guests must be a boolean",
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
    type: {
        in: ["body"],
        custom: {
            options: (value) => value === undefined,
            errorMessage: "type is immutable and cannot be changed",
        },
    },
    scope_type: {
        in: ["body"],
        custom: {
            options: (value) => value === undefined,
            errorMessage: "scope_type is immutable and cannot be changed",
        },
    },
    scope_id: {
        in: ["body"],
        custom: {
            options: (value) => value === undefined,
            errorMessage: "scope_id is immutable and cannot be changed",
        },
    },
});
exports.customFieldIdParamValidator = (0, express_validator_1.checkSchema)({ id: idParam });
/**
 * `PUT` / `DELETE /api/v1/tasks/:id/custom-fields/:fieldId`. Path params only;
 * the PUT value envelope's shape is validated against the field's type in the
 * service (it depends on the field row, which the validator can't see).
 */
exports.taskFieldParamsValidator = (0, express_validator_1.checkSchema)({
    id: idParam,
    fieldId: {
        in: ["params"],
        trim: true,
        notEmpty: { errorMessage: "fieldId is required" },
        isLength: {
            options: { max: ID_MAX },
            errorMessage: `fieldId is too long (max ${ID_MAX} chars)`,
        },
    },
});
