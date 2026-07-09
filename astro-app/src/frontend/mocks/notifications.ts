import type { Notification } from "../types";

const minutesAgo = (n: number) =>
    new Date(Date.now() - n * 60 * 1000).toISOString();
const hoursAgo = (n: number) =>
    new Date(Date.now() - n * 60 * 60 * 1000).toISOString();

export const notifications: Notification[] = [
    {
        id: "n-001",
        userId: "u-001",
        type: "assigned",
        entityType: "task",
        entityId: "t-1001",
        actorId: "u-002",
        title: "Saif assigned you to #1042 — Rahim Uddin",
        isRead: false,
        snoozedUntil: null,
        createdAt: minutesAgo(8),
    },
    {
        id: "n-002",
        userId: "u-001",
        type: "mentioned",
        entityType: "comment",
        entityId: "c-001",
        actorId: "u-007",
        title: "Sumi mentioned you in a complaint",
        body: "Need your approval on the refund @owner",
        isRead: false,
        snoozedUntil: null,
        createdAt: minutesAgo(34),
    },
    {
        id: "n-003",
        userId: "u-001",
        type: "due_soon",
        entityType: "task",
        entityId: "t-1003",
        actorId: null,
        title: "5 orders due to ship today",
        isRead: false,
        snoozedUntil: null,
        createdAt: hoursAgo(2),
    },
    {
        id: "n-004",
        userId: "u-001",
        type: "status_change",
        entityType: "task",
        entityId: "t-1004",
        actorId: "u-005",
        title: "Rashida moved ORD-1024 to Delivered",
        isRead: true,
        snoozedUntil: null,
        createdAt: hoursAgo(3),
    },
    {
        id: "n-005",
        userId: "u-001",
        type: "overdue",
        entityType: "task",
        entityId: "t-1005",
        actorId: null,
        title: "2 deliveries are overdue by more than 24 hours",
        isRead: true,
        snoozedUntil: null,
        createdAt: hoursAgo(5),
    },
    {
        id: "n-006",
        userId: "u-001",
        type: "form_submitted",
        entityType: "form",
        entityId: "f-complaint",
        actorId: null,
        title: "New complaint via Facebook intake form",
        isRead: true,
        snoozedUntil: null,
        createdAt: hoursAgo(8),
    },
];

export const notificationsByUser = (userId: string) =>
    notifications.filter((n) => n.userId === userId);

export const unreadCountForUser = (userId: string) =>
    notifications.filter((n) => n.userId === userId && !n.isRead).length;
