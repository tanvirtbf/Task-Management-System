import type { NextFunction, Response } from "express";
import type { Logger } from "winston";
import type { ReviewsService } from "../services/ReviewsService";
import {
    toWireReview,
    toWireReviewWithReviewer,
} from "../serializers/reviewSerializer";
import type {
    CreateReviewRequest,
    ListReviewsRequest,
    ReviewQueueRequest,
    ReviewSummaryRequest,
} from "../types/reviews";
import type { QueueBucket } from "../repositories/ReviewsRepo";

/**
 * Dept Review V1 HTTP layer. Controllers translate request → service input and
 * service result → wire format; business logic and authorization live in
 * `ReviewsService`.
 */
export class ReviewsController {
    constructor(
        private reviewsService: ReviewsService,
        private logger: Logger,
    ) {}

    /**
     * POST /api/v1/tasks/:id/review — approve/flag a completed task (A-4).
     *
     * `:id` accepts the task id or its custom_id (same as the other task
     * routes). Identity comes from `req.auth`; head/admin authorization is
     * service-level (`review.not_head`). An empty/whitespace note normalises
     * to null. 201 with the created review row.
     */
    async create(req: CreateReviewRequest, res: Response, next: NextFunction) {
        try {
            const { sub: actorId, role, workspaceId } = req.auth;
            const note =
                typeof req.body.note === "string" &&
                req.body.note.trim().length > 0
                    ? req.body.note.trim()
                    : null;

            const review = await this.reviewsService.reviewTask({
                taskIdOrKey: req.params.id,
                workspaceId,
                actorId,
                role,
                status: req.body.status,
                note,
            });

            this.logger.info("reviews.create.ok", {
                requestId: req.requestId,
                workspaceId,
                actorId,
                reviewId: review.id,
                taskId: review.taskId,
                status: review.status,
            });

            res.status(201).json(toWireReview(review));
        } catch (err) {
            next(err);
        }
    }

    /**
     * GET /api/v1/tasks/:id/reviews — review history, newest-first (A-5).
     *
     * `:id` accepts the task id or its custom_id. Readable by owner/admin,
     * the space's head, and the task's assignees (service-enforced → 403
     * `review.forbidden`). Bare `{data}` envelope — the set is bounded (the
     * repo caps at 100), so there is no pagination block.
     */
    async listForTask(
        req: ListReviewsRequest,
        res: Response,
        next: NextFunction,
    ) {
        try {
            const { sub: userId, role, workspaceId } = req.auth;
            const rows = await this.reviewsService.listTaskReviews({
                taskIdOrKey: req.params.id,
                workspaceId,
                userId,
                role,
            });

            this.logger.debug("reviews.list.ok", {
                requestId: req.requestId,
                workspaceId,
                userId,
                count: rows.length,
            });

            res.status(200).json({
                data: rows.map(toWireReviewWithReviewer),
            });
        } catch (err) {
            next(err);
        }
    }

    /**
     * GET /api/v1/spaces/:id/review-summary — per-member rollup + task-level
     * totals (A-2). Head-of-space or owner/admin (service-enforced).
     */
    async summary(
        req: ReviewSummaryRequest,
        res: Response,
        next: NextFunction,
    ) {
        try {
            const { sub: userId, role, workspaceId } = req.auth;
            const summary = await this.reviewsService.reviewSummary({
                spaceId: req.params.id,
                workspaceId,
                userId,
                role,
            });

            this.logger.debug("reviews.summary.ok", {
                requestId: req.requestId,
                workspaceId,
                spaceId: req.params.id,
                members: summary.members.length,
            });

            res.status(200).json(summary);
        } catch (err) {
            next(err);
        }
    }

    /**
     * GET /api/v1/spaces/:id/review-queue — one keyset page of a bucket
     * (A-3). Head-of-space or owner/admin (service-enforced). Standard list
     * envelope `{data, pagination}`.
     */
    async queue(req: ReviewQueueRequest, res: Response, next: NextFunction) {
        try {
            const { sub: userId, role, workspaceId } = req.auth;
            const result = await this.reviewsService.reviewQueue({
                spaceId: req.params.id,
                workspaceId,
                userId,
                role,
                bucket: req.query.bucket as QueueBucket,
                memberId: (req.query.member_id as string | undefined) ?? undefined,
                cursor: (req.query.cursor as string | undefined) ?? undefined,
                limit:
                    req.query.limit !== undefined
                        ? Number(req.query.limit)
                        : undefined,
            });

            this.logger.debug("reviews.queue.ok", {
                requestId: req.requestId,
                workspaceId,
                spaceId: req.params.id,
                bucket: req.query.bucket,
                count: result.data.length,
            });

            res.status(200).json({
                data: result.data,
                pagination: {
                    next_cursor: result.nextCursor,
                    has_more: result.hasMore,
                    total_estimate: result.total,
                },
            });
        } catch (err) {
            next(err);
        }
    }
}
