import type { Template } from "../types/template";

const now = new Date().toISOString();

export const templates: Template[] = [
    {
        id: "tpl-eid-campaign",
        workspaceId: "ws-main",
        type: "task",
        name: "Eid Campaign — 12-step playbook",
        description:
            "Festival campaign with budget, creative, scheduling and post-launch review.",
        icon: "Sparkles",
        color: "#10B981",
        structure: {
            taskTypeId: "tt-campaign",
            priority: 2,
            tags: ["tag-eid"],
            checklistName: "Eid Campaign 12-step playbook",
            checklistItems: [
                { text: "Confirm budget with owner", dueOffsetDays: 0 },
                { text: "Pick hero products (5-8)", dueOffsetDays: 1 },
                { text: "Brief creative team — copy", dueOffsetDays: 2 },
                { text: "Photography / mockups", dueOffsetDays: 4 },
                { text: "Design social posts", dueOffsetDays: 6 },
                { text: "Schedule posts", dueOffsetDays: 7 },
                { text: "Set boost budget per post", dueOffsetDays: 7 },
                { text: "Coordinate with inventory team", dueOffsetDays: 8 },
                { text: "Brief CS team — expected spike", dueOffsetDays: 9 },
                { text: "Brief operations — packing schedule", dueOffsetDays: 9 },
                { text: "Launch — go live", dueOffsetDays: 10 },
                { text: "Post-campaign review", dueOffsetDays: 17 },
            ],
        },
        usageCount: 8,
        createdBy: "u-001",
        createdAt: now,
        updatedAt: now,
    },
    {
        id: "tpl-new-product-launch",
        workspaceId: "ws-main",
        type: "task",
        name: "New Product Launch — 7-step pipeline",
        description:
            "Source → Photo → Content → Price → Upload → FB Post → Live.",
        icon: "Package",
        color: "#8B5CF6",
        structure: {
            taskTypeId: "tt-product",
            priority: 3,
            tags: ["tag-new-arrival"],
            checklistName: "Product launch checklist",
            checklistItems: [
                { text: "Source supplier + confirm cost", dueOffsetDays: 0 },
                { text: "Photo shoot", dueOffsetDays: 2 },
                { text: "Write content + description", dueOffsetDays: 4 },
                { text: "Set price + SKU in inventory system", dueOffsetDays: 5 },
                { text: "Upload to website CMS", dueOffsetDays: 6 },
                { text: "Schedule Facebook post", dueOffsetDays: 7 },
                { text: "Go live + monitor first 48h", dueOffsetDays: 8 },
            ],
        },
        usageCount: 12,
        createdBy: "u-001",
        createdAt: now,
        updatedAt: now,
    },
    {
        id: "tpl-incident-response",
        workspaceId: "ws-main",
        type: "task",
        name: "Incident Response Runbook",
        description:
            "Detection → mitigation → resolution → postmortem for production incidents.",
        icon: "AlertOctagon",
        color: "#DC2626",
        structure: {
            taskTypeId: "tt-incident",
            priority: 1,
            checklistName: "Incident response steps",
            checklistItems: [
                { text: "Acknowledge alert + page on-call" },
                { text: "Open Slack war room channel" },
                { text: "Confirm scope + affected users" },
                { text: "Identify root cause hypothesis" },
                { text: "Apply mitigation (rollback / hotfix)" },
                { text: "Verify customer-facing recovery" },
                { text: "Update status page" },
                { text: "Schedule postmortem (within 48h)" },
            ],
        },
        usageCount: 3,
        createdBy: "u-002",
        createdAt: now,
        updatedAt: now,
    },
];

export const templatesById = new Map<string, Template>(
    templates.map((t) => [t.id, t]),
);

export const templatesByType = (type: Template["type"]): Template[] =>
    templates.filter((t) => t.type === type);
