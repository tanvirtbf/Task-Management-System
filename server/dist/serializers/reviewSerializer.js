"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.toWireReviewWithReviewer = exports.toWireReview = void 0;
const userSerializer_1 = require("./userSerializer");
const toWireReview = (r) => ({
    id: r.id,
    task_id: r.taskId,
    space_id: r.spaceId,
    status: r.status,
    note: r.note,
    reviewer_id: r.reviewerId,
    created_at: r.createdAt.toISOString(),
});
exports.toWireReview = toWireReview;
const toWireReviewWithReviewer = (r) => ({
    ...(0, exports.toWireReview)(r),
    reviewer: r.reviewer ? (0, userSerializer_1.toWireUser)(r.reviewer) : null,
});
exports.toWireReviewWithReviewer = toWireReviewWithReviewer;
