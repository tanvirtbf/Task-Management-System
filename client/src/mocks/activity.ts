import type { ActivityLogEntry } from "../types";

const minutesAgo = (n: number) =>
    new Date(Date.now() - n * 60 * 1000).toISOString();

export const activityLog: ActivityLogEntry[] = [
    {
        id: "a-001",
        workspaceId: "ws-main",
        entityType: "task",
        entityId: "t-1042",
        action: "status_changed",
        actorId: "u-005",
        context: { taskName: "#1042 — Rahim Uddin", listName: "Facebook Orders" },
        createdAt: minutesAgo(4),
    },
    {
        id: "a-002",
        workspaceId: "ws-main",
        entityType: "task",
        entityId: "t-1051",
        action: "assigned",
        actorId: "u-002",
        context: { taskName: "ORD-1051 — Salma Begum", listName: "Facebook Orders" },
        createdAt: minutesAgo(8),
    },
    {
        id: "a-003",
        workspaceId: "ws-main",
        entityType: "task",
        entityId: "t-1064",
        action: "created",
        actorId: "u-004",
        context: { taskName: "Reorder Aloe Vera Gel", listName: "Purchase Orders" },
        createdAt: minutesAgo(12),
    },
    {
        id: "a-004",
        workspaceId: "ws-main",
        entityType: "comment",
        entityId: "c-002",
        actorId: "u-007",
        action: "comment_posted",
        context: { taskName: "Wrong Item — Karim Hossain", listName: "Complaints" },
        createdAt: minutesAgo(18),
    },
    {
        id: "a-005",
        workspaceId: "ws-main",
        entityType: "task",
        entityId: "t-1023",
        action: "completed",
        actorId: "u-005",
        context: { taskName: "ORD-1023 — Mukti Akter", listName: "Facebook Orders" },
        createdAt: minutesAgo(28),
    },
    {
        id: "a-006",
        workspaceId: "ws-main",
        entityType: "task",
        entityId: "t-1101",
        action: "moved",
        actorId: "u-006",
        context: { taskName: "Niacinamide Serum", listName: "Stock Master" },
        createdAt: minutesAgo(45),
    },
    {
        id: "a-007",
        workspaceId: "ws-main",
        entityType: "task",
        entityId: "t-1078",
        action: "priority_changed",
        actorId: "u-001",
        context: { taskName: "Damaged batch — Honey Lip Balm", listName: "Damaged Stock" },
        createdAt: minutesAgo(62),
    },
    {
        id: "a-008",
        workspaceId: "ws-main",
        entityType: "task",
        entityId: "t-1099",
        action: "created",
        actorId: "u-003",
        context: { taskName: "Instagram Reel — Eid Launch", listName: "Content Calendar" },
        createdAt: minutesAgo(95),
    },
];

export const recentActivity = (limit = 10) => activityLog.slice(0, limit);
