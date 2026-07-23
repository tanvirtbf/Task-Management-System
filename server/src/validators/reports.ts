import { checkSchema, type Meta } from "express-validator";

/**
 * Validators for the Dept Review V1 reports endpoints (A-6…A-10). Pair with
 * the `validate` middleware (422 / `validation.failed`).
 */

const notRepeated = (field: string) => ({
    options: (_value: unknown, { req }: Meta): boolean => {
        if (Array.isArray(req.query?.[field])) {
            throw new Error(`${field} must not be repeated`);
        }
        return true;
    },
});

/** `GET /api/v1/reports` (A-6). */
export const listReportsValidator = checkSchema({
    space_id: {
        in: ["query"],
        optional: true,
        custom: notRepeated("space_id"),
        isString: { errorMessage: "space_id must be a string", bail: true },
        trim: true,
        notEmpty: { errorMessage: "space_id must not be empty" },
        isLength: {
            options: { max: 64 },
            errorMessage: "space_id is too long (max 64 chars)",
        },
    },
    cursor: {
        in: ["query"],
        optional: true,
        custom: notRepeated("cursor"),
        isString: { errorMessage: "cursor must be a string", bail: true },
        notEmpty: { errorMessage: "cursor must not be empty" },
    },
    limit: {
        in: ["query"],
        optional: true,
        custom: notRepeated("limit"),
        isInt: {
            options: { min: 1 },
            errorMessage: "limit must be a positive integer",
        },
        toInt: true,
    },
});

/** `GET /api/v1/reports/:id` (A-7) — the `:id` path param only. */
export const getReportValidator = checkSchema({
    id: {
        in: ["params"],
        trim: true,
        notEmpty: { errorMessage: "id is required" },
        isLength: {
            options: { max: 64 },
            errorMessage: "id is too long (max 64 chars)",
        },
    },
});

/**
 * `POST /api/v1/reports/generate` (A-8). `week_start` format is checked here;
 * the Dhaka-Monday + strictly-past rules live in the service (422
 * `report.invalid_week`).
 */
export const generateReportValidator = checkSchema({
    space_id: {
        in: ["body"],
        isString: { errorMessage: "space_id must be a string", bail: true },
        trim: true,
        notEmpty: { errorMessage: "space_id is required" },
        isLength: {
            options: { max: 64 },
            errorMessage: "space_id is too long (max 64 chars)",
        },
    },
    week_start: {
        in: ["body"],
        optional: true,
        isString: { errorMessage: "week_start must be a string", bail: true },
        matches: {
            options: /^\d{4}-\d{2}-\d{2}$/,
            errorMessage: "week_start must be YYYY-MM-DD",
        },
    },
});

/**
 * `PATCH /api/v1/reports/:id` (A-9). `head_note` must be present — a string
 * (≤1000) or `null` to clear (the logo_url nullable pattern).
 */
export const headNoteValidator = checkSchema({
    id: {
        in: ["params"],
        trim: true,
        notEmpty: { errorMessage: "id is required" },
        isLength: {
            options: { max: 64 },
            errorMessage: "id is too long (max 64 chars)",
        },
    },
    head_note: {
        in: ["body"],
        optional: { options: { nullable: true } },
        custom: {
            options: (value: unknown): boolean => {
                if (typeof value !== "string") {
                    throw new Error("head_note must be a string or null");
                }
                if (value.length > 1000) {
                    throw new Error(
                        "head_note must be at most 1000 characters",
                    );
                }
                return true;
            },
        },
    },
});

/** `POST /api/v1/reports/:id/ack` (A-10) — the `:id` path param only. */
export const ackReportValidator = checkSchema({
    id: {
        in: ["params"],
        trim: true,
        notEmpty: { errorMessage: "id is required" },
        isLength: {
            options: { max: 64 },
            errorMessage: "id is too long (max 64 chars)",
        },
    },
});
