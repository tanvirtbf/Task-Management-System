"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.dependencyIdParamValidator = exports.createDependencyValidator = void 0;
const express_validator_1 = require("express-validator");
const _shared_1 = require("../db/schema/_shared");
/**
 * Validators for §12 Task dependencies. Pair each `checkSchema(...)` with the
 * `validate` middleware so failures become the spec envelope (422 /
 * `validation.failed`).
 */
const ID_MAX = 64; // VARCHAR(64) id columns
/**
 * `POST /api/v1/task-dependencies`. `task_id` + `related_task_id` are required
 * id strings; `type` is optional and, when present, must be `"blocks"` (the only
 * stored `dep_type`). The self-loop check (`task_id === related_task_id`) is NOT
 * here — it lives in the service so it returns the spec code `422 dep.self`
 * rather than a generic `validation.failed`.
 */
exports.createDependencyValidator = (0, express_validator_1.checkSchema)({
    task_id: {
        in: ["body"],
        isString: { errorMessage: "task_id must be a string", bail: true },
        trim: true,
        notEmpty: { errorMessage: "task_id is required" },
        isLength: {
            options: { max: ID_MAX },
            errorMessage: `task_id is too long (max ${ID_MAX} chars)`,
        },
    },
    related_task_id: {
        in: ["body"],
        isString: {
            errorMessage: "related_task_id must be a string",
            bail: true,
        },
        trim: true,
        notEmpty: { errorMessage: "related_task_id is required" },
        isLength: {
            options: { max: ID_MAX },
            errorMessage: `related_task_id is too long (max ${ID_MAX} chars)`,
        },
    },
    type: {
        in: ["body"],
        optional: true,
        isIn: {
            options: [[..._shared_1.dependencyTypes]],
            errorMessage: `type must be one of: ${_shared_1.dependencyTypes.join(", ")}`,
        },
    },
});
/**
 * Shared `:id` path-param guard for `GET /tasks/:id/dependencies` and
 * `DELETE /task-dependencies/:id` — bounded to the column width so a malformed
 * id is a clean 422 rather than reaching the DB.
 */
exports.dependencyIdParamValidator = (0, express_validator_1.checkSchema)({
    id: {
        in: ["params"],
        trim: true,
        notEmpty: { errorMessage: "id is required" },
        isLength: {
            options: { max: ID_MAX },
            errorMessage: `id is too long (max ${ID_MAX} chars)`,
        },
    },
});
