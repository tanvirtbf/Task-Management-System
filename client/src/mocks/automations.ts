import type { Automation, AutomationRun } from "../types/automation";

const minutesAgo = (n: number) =>
    new Date(Date.now() - n * 60 * 1000).toISOString();
const hoursAgo = (n: number) =>
    new Date(Date.now() - n * 60 * 60 * 1000).toISOString();

export const automations: Automation[] = [
    {
        id: "auto-001",
        workspaceId: "ws-main",
        scopeType: "list",
        scopeId: "l-fb-orders",
        name: "Auto-assign confirmer on new Facebook order",
        description:
            "When a new order arrives, immediately assign it to the ops team for confirmation calls.",
        isActive: true,
        trigger: {
            type: "task_created",
            config: { listId: "l-fb-orders" },
        },
        conditions: { logic: "AND", rules: [] },
        actions: [
            {
                id: "act-1",
                type: "assign_user",
                config: { userIds: ["u-004", "u-005"], mode: "replace" },
            },
            {
                id: "act-2",
                type: "send_notification",
                config: {
                    userIds: ["u-002"],
                    messageTemplate:
                        "New Facebook order arrived: {{task.name}}",
                },
            },
        ],
        lastRunAt: minutesAgo(8),
        runCount: 142,
        createdBy: "u-001",
        createdAt: "2025-10-01T08:00:00Z",
        updatedAt: "2025-12-15T14:30:00Z",
    },
    {
        id: "auto-002",
        workspaceId: "ws-main",
        scopeType: "list",
        scopeId: "l-fb-orders",
        name: "Notify packing team on confirmation",
        description:
            "When an order moves to Confirmed, assign packing team and send notification.",
        isActive: true,
        trigger: {
            type: "task_status_changed",
            config: {
                toStatusId: "l-fb-orders-s-confirmed",
            },
        },
        conditions: { logic: "AND", rules: [] },
        actions: [
            {
                id: "act-1",
                type: "assign_user",
                config: { userIds: ["u-006"], mode: "add" },
            },
            {
                id: "act-2",
                type: "post_comment",
                config: {
                    bodyTemplate:
                        "Ready to pack. Customer: {{task.assignees | map(name) | join(', ')}}",
                },
            },
        ],
        lastRunAt: minutesAgo(22),
        runCount: 89,
        createdBy: "u-001",
        createdAt: "2025-10-05T08:00:00Z",
        updatedAt: "2025-11-10T11:15:00Z",
    },
    {
        id: "auto-003",
        workspaceId: "ws-main",
        scopeType: "list",
        scopeId: "l-stock",
        name: "Low-stock alert → create purchase order",
        description:
            "When stock drops to or below reorder level, mark item as Low and create a purchase task.",
        isActive: true,
        trigger: {
            type: "task_field_changed",
            config: { customFieldId: "cf_current_stock" },
        },
        conditions: {
            logic: "AND",
            rules: [
                {
                    id: "cond-1",
                    field: "cf:cf_current_stock",
                    operator: "lte",
                    value: "cf:cf_reorder_level",
                },
            ],
        },
        actions: [
            {
                id: "act-1",
                type: "set_custom_field",
                config: {
                    customFieldId: "cf_stock_status",
                    value: { option_id: "Low" },
                },
            } as never,
            {
                id: "act-2",
                type: "create_subtask",
                config: {
                    nameTemplate: "Reorder {{task.name}}",
                    assigneeIds: ["u-006"],
                },
            },
            {
                id: "act-3",
                type: "send_notification",
                config: {
                    userIds: ["u-001", "u-006"],
                    messageTemplate:
                        "Low stock: {{task.name}} — reorder needed",
                },
            },
        ],
        lastRunAt: hoursAgo(2),
        runCount: 23,
        createdBy: "u-001",
        createdAt: "2025-11-01T08:00:00Z",
        updatedAt: "2025-11-01T08:00:00Z",
    },
    {
        id: "auto-004",
        workspaceId: "ws-main",
        scopeType: "list",
        scopeId: "l-complaints",
        name: "Urgent complaint → escalate to founder",
        description:
            "If a new complaint has Urgent priority, immediately notify the founder.",
        isActive: true,
        trigger: { type: "task_created", config: { listId: "l-complaints" } },
        conditions: {
            logic: "AND",
            rules: [
                {
                    id: "cond-1",
                    field: "priority",
                    operator: "eq",
                    value: 1,
                },
            ],
        },
        actions: [
            {
                id: "act-1",
                type: "assign_user",
                config: { userIds: ["u-007"], mode: "replace" },
            },
            {
                id: "act-2",
                type: "add_tag",
                config: { tagId: "tag-urgent" },
            },
            {
                id: "act-3",
                type: "send_email",
                config: {
                    to: ["u-001"],
                    subjectTemplate: "🚨 Urgent complaint: {{task.name}}",
                    bodyTemplate:
                        "A new urgent complaint just came in. Please review immediately.\n\n{{task.url}}",
                },
            },
        ],
        lastRunAt: hoursAgo(6),
        runCount: 8,
        createdBy: "u-001",
        createdAt: "2025-11-15T08:00:00Z",
        updatedAt: "2025-11-15T08:00:00Z",
    },
    {
        id: "auto-005",
        workspaceId: "ws-main",
        scopeType: "list",
        scopeId: "l-fb-orders",
        name: "Overdue delivery → follow-up",
        description:
            "If a delivery is overdue, create a courier-check task and notify the assignee.",
        isActive: false,
        trigger: { type: "task_overdue", config: {} },
        conditions: {
            logic: "AND",
            rules: [
                {
                    id: "cond-1",
                    field: "status",
                    operator: "eq",
                    value: "l-fb-orders-s-out",
                },
            ],
        },
        actions: [
            {
                id: "act-1",
                type: "create_subtask",
                config: {
                    nameTemplate: "Check courier status for {{task.name}}",
                    assigneeIds: ["u-004"],
                },
            },
            {
                id: "act-2",
                type: "send_notification",
                config: {
                    userIds: ["u-002"],
                    messageTemplate:
                        "Delivery overdue: {{task.name}} (assigned to {{task.assignees | map(name)}})",
                },
            },
        ],
        lastRunAt: null,
        runCount: 0,
        createdBy: "u-001",
        createdAt: "2025-12-01T08:00:00Z",
        updatedAt: "2025-12-01T08:00:00Z",
    },
];

export const automationsById = new Map(automations.map((a) => [a.id, a]));

export const automationsByList = (listId: string) =>
    automations.filter((a) => a.scopeId === listId);

// ─── Run history ─────────────────────────────────────────
export const automationRuns: AutomationRun[] = [];

// Generate ~40 runs across all automations
let _seed = 7777;
const rng = () => {
    _seed = (_seed * 1664525 + 1013904223) % 4294967296;
    return _seed / 4294967296;
};

for (const auto of automations) {
    if (!auto.isActive) continue;
    const count = Math.min(auto.runCount, 12);
    for (let i = 0; i < count; i++) {
        const ageMin = Math.floor(rng() * 60 * 24 * 7); // up to 7 days
        const status = rng() > 0.92 ? "failed" : "success";
        const durationMs = 50 + Math.floor(rng() * 400);
        automationRuns.push({
            id: `run-${auto.id}-${i}`,
            automationId: auto.id,
            triggerEvent: { type: auto.trigger.type, taskId: `t-${1000 + i}` },
            status,
            actionsLog: auto.actions.map((a) => ({
                actionType: a.type,
                status: status === "failed" && rng() > 0.5 ? "failed" : "success",
                message:
                    status === "failed"
                        ? "Action skipped due to previous failure"
                        : "Completed",
                durationMs: Math.floor(durationMs / auto.actions.length),
            })),
            error:
                status === "failed"
                    ? "User not found in workspace"
                    : undefined,
            durationMs,
            startedAt: minutesAgo(ageMin + 1),
            finishedAt: minutesAgo(ageMin),
        });
    }
}

export const runsByAutomation = (automationId: string) =>
    automationRuns
        .filter((r) => r.automationId === automationId)
        .sort(
            (a, b) =>
                new Date(b.startedAt).getTime() -
                new Date(a.startedAt).getTime(),
        );
