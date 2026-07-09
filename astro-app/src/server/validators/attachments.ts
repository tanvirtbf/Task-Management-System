import { checkSchema } from "express-validator";

/**
 * Validators for §16 Attachments. Pair each `checkSchema(...)` with `validate`
 * so failures become the spec envelope (422 / `validation.failed`). Policy
 * limits that are NOT 422 — size > 25 MB (413), MIME not allow-listed (415),
 * unsupported scope (400) — are enforced in the SERVICE, since they carry
 * distinct status codes; the validator only checks shape/length here.
 */

const MAX_ID_LENGTH = 64;
const MAX_FILENAME_LENGTH = 255; // attachments.name VARCHAR(255)
const MAX_MIME_LENGTH = 120; // attachments.mime_type VARCHAR(120)
const MAX_KEY_LENGTH = 500; // attachments.storage_key/thumbnail_key VARCHAR(500)

/** Reusable `:id` path-param rule (a fresh object per validator). */
const idParam = () => ({
    in: ["params"] as ["params"],
    trim: true,
    notEmpty: { errorMessage: "id is required" },
    isLength: {
        options: { max: MAX_ID_LENGTH },
        errorMessage: "id is too long (max 64 chars)",
    },
});

/** `POST /api/v1/uploads/sign`. */
export const signUploadValidator = checkSchema({
    scope_type: {
        in: ["body"],
        trim: true,
        notEmpty: { errorMessage: "scope_type is required" },
        isString: { errorMessage: "scope_type must be a string" },
    },
    scope_id: {
        in: ["body"],
        trim: true,
        notEmpty: { errorMessage: "scope_id is required" },
        isLength: {
            options: { max: MAX_ID_LENGTH },
            errorMessage: "scope_id is too long (max 64 chars)",
        },
    },
    filename: {
        in: ["body"],
        // isString before trim so a non-string (e.g. number) is rejected, not
        // coerced (express-validator's trim stringifies its input).
        isString: { errorMessage: "filename must be a string" },
        trim: true,
        notEmpty: { errorMessage: "filename is required" },
        isLength: {
            options: { max: MAX_FILENAME_LENGTH },
            errorMessage: "filename is too long (max 255 chars)",
        },
    },
    mime_type: {
        in: ["body"],
        isString: { errorMessage: "mime_type must be a string" },
        trim: true,
        notEmpty: { errorMessage: "mime_type is required" },
        isLength: {
            options: { max: MAX_MIME_LENGTH },
            errorMessage: "mime_type is too long (max 120 chars)",
        },
    },
    size_bytes: {
        in: ["body"],
        isInt: {
            options: { min: 1 },
            errorMessage: "size_bytes must be a positive integer",
        },
        toInt: true,
    },
});

/** `POST /api/v1/attachments/:id/finalize`. */
export const finalizeValidator = checkSchema({
    id: idParam(),
    storage_key: {
        in: ["body"],
        optional: true,
        isString: { errorMessage: "storage_key must be a string" },
        trim: true,
        isLength: {
            options: { max: MAX_KEY_LENGTH },
            errorMessage: "storage_key is too long (max 500 chars)",
        },
    },
    thumbnail_key: {
        in: ["body"],
        optional: true,
        isString: { errorMessage: "thumbnail_key must be a string" },
        trim: true,
        isLength: {
            options: { max: MAX_KEY_LENGTH },
            errorMessage: "thumbnail_key is too long (max 500 chars)",
        },
    },
});

/** `GET /api/v1/tasks/:id/attachments`. */
export const listAttachmentsValidator = checkSchema({ id: idParam() });

/** `DELETE /api/v1/attachments/:id`. */
export const deleteAttachmentValidator = checkSchema({ id: idParam() });

/** `GET /api/v1/attachments/:id/download`. */
export const downloadAttachmentValidator = checkSchema({ id: idParam() });
