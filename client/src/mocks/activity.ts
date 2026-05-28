import type { ActivityLogEntry } from "../types";

const ago = (h: number) =>
    new Date(Date.now() - h * 60 * 60 * 1000).toISOString();

/**
 * Seeded per-task activity entries — focused on engineering tasks where
 * the audit trail matters most.
 */
export const activityLog: ActivityLogEntry[] = [
    {
        id: "act-1",
        workspaceId: "ws-main",
        entityType: "task",
        entityId: "t-90000",
        action: "created",
        actorId: "u-002",
        context: { taskName: "Checkout button unresponsive on mobile Safari", listName: "Bug Triage" },
        createdAt: ago(6),
    },
    {
        id: "act-2",
        workspaceId: "ws-main",
        entityType: "task",
        entityId: "t-90000",
        action: "status_changed",
        actorId: "u-003",
        context: { taskName: "Checkout button unresponsive on mobile Safari", listName: "Bug Triage" },
        createdAt: ago(5),
    },
    {
        id: "act-3",
        workspaceId: "ws-main",
        entityType: "task",
        entityId: "t-90000",
        action: "assigned",
        actorId: "u-002",
        context: { taskName: "Checkout button unresponsive on mobile Safari" },
        createdAt: ago(5),
    },
    {
        id: "act-4",
        workspaceId: "ws-main",
        entityType: "task",
        entityId: "t-90000",
        action: "branch_created",
        actorId: "u-003",
        context: { taskName: "BUG-1042-checkout-mobile" },
        createdAt: ago(4),
    },
    {
        id: "act-5",
        workspaceId: "ws-main",
        entityType: "task",
        entityId: "t-90000",
        action: "pr_opened",
        actorId: "u-003",
        context: { taskName: "PR #421" },
        createdAt: ago(2),
    },
    {
        id: "act-6",
        workspaceId: "ws-main",
        entityType: "task",
        entityId: "t-90007",
        action: "created",
        actorId: "u-002",
        context: { taskName: "Add SSLCommerz hosted checkout integration", listName: "Sprint Board" },
        createdAt: ago(8 * 24),
    },
    {
        id: "act-7",
        workspaceId: "ws-main",
        entityType: "task",
        entityId: "t-90007",
        action: "status_changed",
        actorId: "u-002",
        context: { taskName: "Add SSLCommerz hosted checkout integration" },
        createdAt: ago(5 * 24),
    },
];

export const recentActivity = (limit = 20): ActivityLogEntry[] =>
    [...activityLog]
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, limit);

export const activityForTask = (taskId: string): ActivityLogEntry[] =>
    activityLog
        .filter((a) => a.entityType === "task" && a.entityId === taskId)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
