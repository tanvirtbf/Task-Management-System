"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.toWireTask = void 0;
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
const toWireDate = (value) => {
    if (value === null)
        return null;
    if (typeof value === "string")
        return value.slice(0, 10);
    const year = value.getUTCFullYear();
    const month = String(value.getUTCMonth() + 1).padStart(2, "0");
    const day = String(value.getUTCDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
};
/** Format a nullable TIMESTAMP to ISO-8601 UTC (`…Z`). */
const toWireTimestamp = (value) => value ? value.toISOString() : null;
const toWireTask = (t, h) => ({
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
    recurrence_days: t.recurrenceDays && t.recurrenceDays.length > 0
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
exports.toWireTask = toWireTask;
