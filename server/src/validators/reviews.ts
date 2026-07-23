import { checkSchema, type Meta } from "express-validator";

/**
 * Reject a repeated query param (`?limit=1&limit=2` arrives as an array and
 * would otherwise flow into scalar handling as NaN/garbage). Mirrors the
 * users-validator helper.
 */
const notRepeated = (field: string) => ({
    options: (_value: unknown, { req }: Meta): boolean => {
        if (Array.isArray(req.query?.[field])) {
            throw new Error(`${field} must not be repeated`);
        }
        return true;
    },
});

/**
 * Validators for Dept Review V1 endpoints (DEPARTMENT_REVIEW_PLAN.md §3).
 * Pair with the `validate` middleware (422 / `validation.failed`).
 */

const NOTE_MAX = 500; // task_reviews.note VARCHAR(500)

/**
 * `POST /api/v1/tasks/:id/review` (A-4). `status` is the head's verdict;
 * `note` is optional (≤500 chars; `null` and empty-after-trim are treated as
 * "no note" by the controller). Head/admin authorization and the done-check
 * live in the service (403 `review.not_head` / 409 `review.not_completed`).
 */
/** `GET /api/v1/spaces/:id/review-summary` (A-2) — the `:id` path param only. */
export const reviewSummaryValidator = checkSchema({
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
 * `GET /api/v1/spaces/:id/review-queue` (A-3). `bucket` is REQUIRED and closed
 * to the four queue tabs; `member_id`/`cursor`/`limit` are optional. The limit
 * is clamped 1–200 in the service (default 50).
 */
export const reviewQueueValidator = checkSchema({
    id: {
        in: ["params"],
        trim: true,
        notEmpty: { errorMessage: "id is required" },
        isLength: {
            options: { max: 64 },
            errorMessage: "id is too long (max 64 chars)",
        },
    },
    bucket: {
        in: ["query"],
        custom: notRepeated("bucket"),
        isString: { errorMessage: "bucket is required", bail: true },
        isIn: {
            options: [["needs_review", "flagged", "overdue", "due_today"]],
            errorMessage:
                "bucket must be one of needs_review, flagged, overdue, due_today",
        },
    },
    member_id: {
        in: ["query"],
        optional: true,
        custom: notRepeated("member_id"),
        isString: { errorMessage: "member_id must be a string", bail: true },
        trim: true,
        notEmpty: { errorMessage: "member_id must not be empty" },
        isLength: {
            options: { max: 64 },
            errorMessage: "member_id is too long (max 64 chars)",
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

/** `GET /api/v1/tasks/:id/reviews` (A-5) — the `:id` path param only. */
export const listReviewsValidator = checkSchema({
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

export const createReviewValidator = checkSchema({
    id: {
        in: ["params"],
        trim: true,
        notEmpty: { errorMessage: "id is required" },
        isLength: {
            options: { max: 64 },
            errorMessage: "id is too long (max 64 chars)",
        },
    },
    status: {
        in: ["body"],
        isString: { errorMessage: "status must be a string", bail: true },
        isIn: {
            options: [["approved", "flagged"]],
            errorMessage: "status must be 'approved' or 'flagged'",
        },
    },
    note: {
        in: ["body"],
        optional: { options: { nullable: true } },
        custom: {
            options: (value: unknown): boolean => {
                if (typeof value !== "string") {
                    throw new Error("note must be a string or null");
                }
                if (value.length > NOTE_MAX) {
                    throw new Error(
                        `note must be at most ${NOTE_MAX} characters`,
                    );
                }
                return true;
            },
        },
    },
});
