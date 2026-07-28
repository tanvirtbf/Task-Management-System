"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.commentIdParamValidator = exports.updateCommentValidator = exports.createCommentValidator = exports.listCommentsValidator = void 0;
const express_validator_1 = require("express-validator");
/**
 * Validators for §14 Comments. Pair each `checkSchema(...)` with the `validate`
 * middleware so a failure renders the spec envelope (422 / `validation.failed`).
 * Shape-only here — ownership, the 15-minute edit window, and the
 * "reply-to-a-reply" rule are row-dependent and live in the service.
 */
const MAX_ID = 64;
const MAX_BODY = 10000; // comments.body is TEXT; a defensive cap (no DB CHECK).
const idParam = () => ({
    in: ["params"],
    trim: true,
    notEmpty: { errorMessage: "id is required" },
    isLength: {
        options: { max: MAX_ID },
        errorMessage: `id is too long (max ${MAX_ID} chars)`,
    },
});
const bodyField = {
    in: ["body"],
    isString: { errorMessage: "body must be a string", bail: true },
    trim: true,
    notEmpty: { errorMessage: "body is required" },
    isLength: {
        options: { max: MAX_BODY },
        errorMessage: `body is too long (max ${MAX_BODY} chars)`,
    },
};
/** `GET /api/v1/tasks/:id/comments`. */
exports.listCommentsValidator = (0, express_validator_1.checkSchema)({ id: idParam() });
/** `POST /api/v1/tasks/:id/comments`. */
exports.createCommentValidator = (0, express_validator_1.checkSchema)({
    id: idParam(),
    body: bodyField,
    parent_comment_id: {
        in: ["body"],
        optional: { options: { nullable: true } },
        isString: {
            errorMessage: "parent_comment_id must be a string or null",
        },
        trim: true,
        isLength: {
            options: { max: MAX_ID },
            errorMessage: `parent_comment_id is too long (max ${MAX_ID} chars)`,
        },
    },
});
/** `PATCH /api/v1/comments/:id`. */
exports.updateCommentValidator = (0, express_validator_1.checkSchema)({
    id: idParam(),
    body: bodyField,
});
/** `DELETE /api/v1/comments/:id`. */
exports.commentIdParamValidator = (0, express_validator_1.checkSchema)({ id: idParam() });
