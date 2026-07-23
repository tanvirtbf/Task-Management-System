import type { ReviewQueueBucket } from "../../types";

/** The four review-queue tabs (order = display order). Kept outside the
 *  component files so fast-refresh stays clean (react-refresh rule). */
export const QUEUE_BUCKETS: {
    key: ReviewQueueBucket;
    label: string;
}[] = [
    { key: "needs_review", label: "Needs review" },
    { key: "flagged", label: "Flagged" },
    { key: "overdue", label: "Overdue" },
    { key: "due_today", label: "Due today" },
];
