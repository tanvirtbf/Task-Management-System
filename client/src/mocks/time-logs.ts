import type { TimeLog } from "../types/time-tracking";

export const timeLogs: TimeLog[] = [];

export const timeLogsByTask = (taskId: string): TimeLog[] =>
    timeLogs.filter((l) => l.taskId === taskId);

export const timeLogsByUser = (userId: string): TimeLog[] =>
    timeLogs.filter((l) => l.userId === userId);
