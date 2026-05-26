/**
 * Phase 8 — Automation Engine types.
 */

export type TriggerType =
    | "task_created"
    | "task_status_changed"
    | "task_assigned"
    | "task_priority_changed"
    | "task_due_soon"
    | "task_overdue"
    | "task_field_changed"
    | "task_tag_added"
    | "comment_posted"
    | "form_submitted"
    | "recurring_schedule";

export type ActionType =
    | "set_status"
    | "assign_user"
    | "set_priority"
    | "set_due_date"
    | "add_tag"
    | "remove_tag"
    | "move_to_list"
    | "archive_task"
    | "create_subtask"
    | "post_comment"
    | "send_notification"
    | "send_email"
    | "call_webhook"
    | "apply_template";

export type ConditionOperator =
    | "eq"
    | "neq"
    | "in"
    | "not_in"
    | "gt"
    | "gte"
    | "lt"
    | "lte"
    | "contains"
    | "is_empty"
    | "is_not_empty";

export interface AutomationCondition {
    id: string;
    field: string; // e.g., "status", "priority", "assignee", "cf:<field_id>"
    operator: ConditionOperator;
    value: unknown;
}

export interface AutomationAction {
    id: string;
    type: ActionType;
    config: Record<string, unknown>;
}

export interface Automation {
    id: string;
    workspaceId: string;
    scopeType: "space" | "folder" | "list";
    scopeId: string;
    name: string;
    description?: string;
    isActive: boolean;
    trigger: {
        type: TriggerType;
        config: Record<string, unknown>;
    };
    conditions: {
        logic: "AND" | "OR";
        rules: AutomationCondition[];
    };
    actions: AutomationAction[];
    lastRunAt: string | null;
    runCount: number;
    createdBy: string;
    createdAt: string;
    updatedAt: string;
}

export interface AutomationRun {
    id: string;
    automationId: string;
    triggerEvent: Record<string, unknown>;
    status: "success" | "failed" | "skipped" | "conditions_not_met";
    actionsLog: Array<{
        actionType: ActionType;
        status: "success" | "failed";
        message: string;
        durationMs: number;
    }>;
    error?: string;
    durationMs: number;
    startedAt: string;
    finishedAt: string;
}
