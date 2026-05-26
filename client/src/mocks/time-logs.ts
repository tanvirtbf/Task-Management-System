import type { TimeLog } from "../types/time-tracking";

const now = new Date();
const isoBefore = (msAgo: number) =>
    new Date(now.getTime() - msAgo).toISOString();

export const timeLogs: TimeLog[] = [
    {
        id: "tl-001",
        taskId: "t-5001",
        userId: "u-001",
        durationSeconds: 35 * 60,
        note: "Phone call with customer",
        startedAt: isoBefore(2 * 60 * 60 * 1000),
        endedAt: isoBefore(2 * 60 * 60 * 1000 - 35 * 60 * 1000),
        createdAt: isoBefore(2 * 60 * 60 * 1000),
    },
    {
        id: "tl-002",
        taskId: "t-5001",
        userId: "u-002",
        durationSeconds: 50 * 60,
        note: "Packed + shipped",
        startedAt: isoBefore(24 * 60 * 60 * 1000),
        endedAt: isoBefore(24 * 60 * 60 * 1000 - 50 * 60 * 1000),
        createdAt: isoBefore(24 * 60 * 60 * 1000),
    },
    {
        id: "tl-003",
        taskId: "t-5005",
        userId: "u-003",
        durationSeconds: 90 * 60,
        note: "Festival campaign brief drafting",
        startedAt: isoBefore(36 * 60 * 60 * 1000),
        endedAt: isoBefore(36 * 60 * 60 * 1000 - 90 * 60 * 1000),
        createdAt: isoBefore(36 * 60 * 60 * 1000),
    },
];

export const timeLogsByTask = (taskId: string): TimeLog[] =>
    timeLogs
        .filter((l) => l.taskId === taskId)
        .sort((a, b) => b.startedAt.localeCompare(a.startedAt));

export const timeLogsByUser = (userId: string): TimeLog[] =>
    timeLogs
        .filter((l) => l.userId === userId)
        .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
