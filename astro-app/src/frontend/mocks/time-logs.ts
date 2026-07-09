// @ts-nocheck — dead mock layer; excluded from typecheck in the original client tsconfig (exclude: src/mocks, src/lib/mock-api.ts)
import type { TimeLog } from "../types/time-tracking";

export const timeLogs: TimeLog[] = [];

export const timeLogsByTask = (taskId: string): TimeLog[] =>
    timeLogs.filter((l) => l.taskId === taskId);

export const timeLogsByUser = (userId: string): TimeLog[] =>
    timeLogs.filter((l) => l.userId === userId);
