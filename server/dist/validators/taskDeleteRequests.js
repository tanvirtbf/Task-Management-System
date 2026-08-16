"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.decideDeleteRequestValidator = exports.createDeleteRequestValidator = exports.deleteRequestParamValidator = exports.taskIdParamValidator = void 0;
const express_validator_1 = require("express-validator");
/**
 * Validators for the permanent-delete approval endpoints (upgrades/023). Pair
 * each with the `validate` middleware so failures become the spec envelope
 * (422 / `validation.failed`). Free-text fields share the 500-char column width
 * of `reason` / `decision_note`.
 */
const TEXT_MAX = 500;
/** `:id` of a task — matched so `matchedData` can read it. */
exports.taskIdParamValidator = (0, express_validator_1.checkSchema)({
    id: {
        in: ["params"],
        isString: true,
        notEmpty: { errorMessage: "id is required" },
    },
});
/** `:id` of a delete request. */
exports.deleteRequestParamValidator = (0, express_validator_1.checkSchema)({
    id: {
        in: ["params"],
        isString: true,
        notEmpty: { errorMessage: "id is required" },
    },
});
/** POST /tasks/:id/delete-request — an optional reason for the ask. */
exports.createDeleteRequestValidator = (0, express_validator_1.checkSchema)({
    id: {
        in: ["params"],
        isString: true,
        notEmpty: { errorMessage: "id is required" },
    },
    reason: {
        in: ["body"],
        optional: { options: { nullable: true } },
        isString: { errorMessage: "reason must be a string" },
        isLength: {
            options: { max: TEXT_MAX },
            errorMessage: `reason must be at most ${TEXT_MAX} characters`,
        },
    },
});
/** POST approve/reject — an optional note the requester will read. */
exports.decideDeleteRequestValidator = (0, express_validator_1.checkSchema)({
    id: {
        in: ["params"],
        isString: true,
        notEmpty: { errorMessage: "id is required" },
    },
    note: {
        in: ["body"],
        optional: { options: { nullable: true } },
        isString: { errorMessage: "note must be a string" },
        isLength: {
            options: { max: TEXT_MAX },
            errorMessage: `note must be at most ${TEXT_MAX} characters`,
        },
    },
});
