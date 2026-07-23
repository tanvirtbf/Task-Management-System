import type { AuthRequest } from "./index";

/**
 * Endpoint-specific request shapes for Dept Review V1 (per the project
 * convention these live alongside the feature, not in `types/index.ts`).
 */

/**
 * Body for `POST /api/v1/tasks/:id/review` (A-4). `createReviewValidator` has
 * already constrained `status` to the enum and `note` to ≤500 chars or null;
 * the controller normalises an empty/whitespace note to `null`.
 */
export interface CreateReviewBody {
    status: "approved" | "flagged";
    note?: string | null;
}

export interface CreateReviewRequest extends AuthRequest {
    body: CreateReviewBody;
}

/**
 * `GET /api/v1/tasks/:id/reviews` (A-5). No body/query; the `:id` param is
 * validated by `listReviewsValidator`.
 */
export type ListReviewsRequest = AuthRequest;

/** `GET /api/v1/spaces/:id/review-summary` (A-2). Param-only. */
export type ReviewSummaryRequest = AuthRequest;

/**
 * `GET /api/v1/spaces/:id/review-queue` (A-3). Query is validated by
 * `reviewQueueValidator`; the controller reads bucket/member_id/cursor/limit
 * off `req.query`.
 */
export type ReviewQueueRequest = AuthRequest;
