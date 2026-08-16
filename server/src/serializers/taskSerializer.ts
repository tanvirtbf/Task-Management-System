import type { Task as TaskRow } from "../db/schema";

/**
 * Wire-format `Task` per API_DESIGN.md §10 + Appendix A. snake_case;
 * `assignees` / `watchers` / `tags` are ID arrays and `custom_field_values` is
 * keyed by custom-field id (the hydration the controller passes in). The
 * `internal_id` column is never exposed — it only travels inside the opaque
 * pagination cursor. `sla_due_at` is included to match the DB column and the
 * frontend's `slaDueAt` (Appendix A's prose omits it).
 *
 * Single source for the `Task` response shape, shared by every §10–§14 endpoint
 * that returns a task — the same role `userSerializer` plays for `User`.
 */
export interface WireTask {
    id: string;
    custom_id: string | null;
    task_number: number;
    workspace_id: string;
    primary_list_id: string;
    name: string;
    description: string | null;
    status_id: string;
    priority: number;
    task_type_id: string;
    parent_task_id: string | null;
    nesting_depth: number;
    is_milestone: boolean;
    start_date: string | null;
    due_date: string | null;
    completed_at: string | null;
    /** Dept Review V1 — current review verdict (denorm trio; null until the
     *  space's head reviews a completed task; auto-reset on reopen). */
    review_status: "approved" | "flagged" | null;
    reviewed_at: string | null;
    reviewed_by: string | null;
    sla_due_at: string | null;
    recurrence_pattern: string;
    recurrence_days: string[] | null;
    recurrence_ends_at: string | null;
    time_estimate_seconds: number | null;
    time_tracked_seconds: number;
    subtasks_count: number;
    subtasks_completed: number;
    comments_count: number;
    attachments_count: number;
    /** upgrades/022 — items across ALL the task's checklists (rollup). */
    checklist_items_total: number;
    checklist_items_done: number;
    /** upgrades/023 — a permanent delete is waiting on an admin's decision. */
    delete_request_pending: boolean;
    sprint_id: string | null;
    story_points: number | null;
    reviewer_id: string | null;
    branch_name: string | null;
    pr_url: string | null;
    pr_status: string | null;
    bug_severity: string | null;
    bug_reproducibility: string | null;
    bug_environment: string | null;
    bug_browser: string | null;
    reporter_team: string | null;
    deployed_at: string | null;
    rollback_reason: string | null;
    assignees: string[];
    watchers: string[];
    tags: string[];
    custom_field_values: Record<string, unknown>;
    archived_at: string | null;
    created_by: string;
    created_at: string;
    updated_at: string;
}

/** The inline collections a task row is hydrated with before serialisation. */
export interface TaskHydration {
    assignees: string[];
    watchers: string[];
    tags: string[];
    customFieldValues: Record<string, unknown>;
    /**
     * upgrades/023 — someone has asked for this task to be permanently deleted
     * and an admin has not decided yet. Optional because only the read paths
     * that feed a list view or the drawer look it up; everywhere else it is
     * false, which is the honest default (no request is known about).
     */
    deleteRequestPending?: boolean;
}

/**
 * Format a MySQL DATE to the `YYYY-MM-DD` wire form using **UTC** components.
 *
 * A DATE is a calendar day with no timezone, so the formatting must not depend
 * on one. Drizzle's `MySqlDate.mapFromDriverValue` does `new Date("YYYY-MM-DD")`,
 * which is UTC midnight, and F3's `toDateOnly` writes UTC midnight — so reading
 * back the UTC components is exact and identical under any process TZ.
 *
 * (This previously used LOCAL components. That was correct only while the
 * process TZ had a non-negative offset: under Dhaka, UTC midnight is 06:00 the
 * same day, so the day survived by luck. In, say, New York it would have
 * rendered the previous day.) Accepts a pre-formatted string defensively.
 */
const toWireDate = (value: Date | string | null): string | null => {
    if (value === null) return null;
    if (typeof value === "string") return value.slice(0, 10);
    const year = value.getUTCFullYear();
    const month = String(value.getUTCMonth() + 1).padStart(2, "0");
    const day = String(value.getUTCDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
};

/** Format a nullable TIMESTAMP to ISO-8601 UTC (`…Z`). */
const toWireTimestamp = (value: Date | null): string | null =>
    value ? value.toISOString() : null;

export const toWireTask = (t: TaskRow, h: TaskHydration): WireTask => ({
    id: t.id,
    custom_id: t.customId,
    task_number: t.taskNumber,
    workspace_id: t.workspaceId,
    primary_list_id: t.primaryListId,
    name: t.name,
    description: t.description,
    status_id: t.statusId,
    priority: t.priority,
    task_type_id: t.taskTypeId,
    parent_task_id: t.parentTaskId,
    nesting_depth: t.nestingDepth,
    is_milestone: t.isMilestone,
    start_date: toWireDate(t.startDate),
    due_date: toWireDate(t.dueDate),
    completed_at: toWireTimestamp(t.completedAt),
    review_status: t.reviewStatus,
    reviewed_at: toWireTimestamp(t.reviewedAt),
    reviewed_by: t.reviewedBy,
    sla_due_at: toWireTimestamp(t.slaDueAt),
    recurrence_pattern: t.recurrencePattern,
    recurrence_days:
        t.recurrenceDays && t.recurrenceDays.length > 0
            ? t.recurrenceDays
            : null,
    recurrence_ends_at: toWireDate(t.recurrenceEndsAt),
    time_estimate_seconds: t.timeEstimateSeconds,
    time_tracked_seconds: t.timeTrackedSeconds,
    subtasks_count: t.subtasksCount,
    subtasks_completed: t.subtasksCompleted,
    comments_count: t.commentsCount,
    attachments_count: t.attachmentsCount,
    checklist_items_total: t.checklistItemsTotal,
    checklist_items_done: t.checklistItemsDone,
    delete_request_pending: h.deleteRequestPending ?? false,
    sprint_id: t.sprintId,
    story_points: t.storyPoints,
    reviewer_id: t.reviewerId,
    branch_name: t.branchName,
    pr_url: t.prUrl,
    pr_status: t.prStatus,
    bug_severity: t.bugSeverity,
    bug_reproducibility: t.bugReproducibility,
    bug_environment: t.bugEnvironment,
    bug_browser: t.bugBrowser,
    reporter_team: t.reporterTeam,
    deployed_at: toWireTimestamp(t.deployedAt),
    rollback_reason: t.rollbackReason,
    assignees: h.assignees,
    watchers: h.watchers,
    tags: h.tags,
    custom_field_values: h.customFieldValues,
    archived_at: toWireTimestamp(t.archivedAt),
    created_by: t.createdBy,
    created_at: t.createdAt.toISOString(),
    updated_at: t.updatedAt.toISOString(),
});
