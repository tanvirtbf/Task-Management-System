import type { TaskReviewRecord } from "../repositories/ReviewsRepo";
import type { WireTask } from "./taskSerializer";
import {
    toWireUser,
    type WireUser,
    type WireUserSource,
} from "./userSerializer";

/**
 * Wire shape for a task review (Dept Review V1). snake_case per the API
 * convention; `internal_id` never leaves the server. `reviewer_id` stays a
 * scalar here — the A-5 history read (P10) hydrates reviewers batch-wise and
 * layers `reviewer` on top of this base shape.
 */
export interface WireReview {
    id: string;
    task_id: string;
    space_id: string;
    status: "approved" | "flagged";
    note: string | null;
    reviewer_id: string;
    created_at: string;
}

export const toWireReview = (r: TaskReviewRecord): WireReview => ({
    id: r.id,
    task_id: r.taskId,
    space_id: r.spaceId,
    status: r.status,
    note: r.note,
    reviewer_id: r.reviewerId,
    created_at: r.createdAt.toISOString(),
});

/** A-5 history rows carry the hydrated reviewer (batched in the service). */
export interface WireReviewWithReviewer extends WireReview {
    reviewer: WireUser | null;
}

export const toWireReviewWithReviewer = (
    r: TaskReviewRecord & { reviewer: WireUserSource | null },
): WireReviewWithReviewer => ({
    ...toWireReview(r),
    reviewer: r.reviewer ? toWireUser(r.reviewer) : null,
});

// ─── A-3 review-queue wire shapes ────────────────────────────────────────────

/** The task's CURRENT review state (denorm trio), attached to queue rows. */
export interface WireQueueReview {
    status: "approved" | "flagged";
    reviewed_at: string | null;
    reviewed_by: string | null;
}

/**
 * A queue row = the standard wire `Task` (P15's drawer needs
 * `primary_list_id` + `assignees`) plus the current review and, for subtasks,
 * a parent breadcrumb (v1.1 H-5).
 */
export interface WireQueueRow extends WireTask {
    review: WireQueueReview | null;
    parent_task: { id: string; name: string } | null;
}

// ─── A-2 review-summary wire shapes ──────────────────────────────────────────

/**
 * One member row. `user: null` = the synthetic "Unassigned" row (H-4).
 * Deactivated members surface through `user.status` (assignee rows persist —
 * they are history, not actionable members). `last_activity` is DB-clock
 * domain — display-only, never compared against app-UTC instants (H-7e).
 */
export interface WireSummaryMember {
    user: WireUser | null;
    open: number;
    due_today: number;
    overdue: number;
    done_unreviewed: number;
    flagged: number;
    last_activity: string | null;
}

export interface WireReviewSummary {
    space_id: string;
    members: WireSummaryMember[];
    /** Task-level DEDUPED numbers — NOT the sum of the per-assignee member
     *  rows (H-3); includes unassigned tasks by construction. */
    totals: {
        open: number;
        due_today: number;
        overdue: number;
        done_unreviewed: number;
        flagged: number;
    };
}
