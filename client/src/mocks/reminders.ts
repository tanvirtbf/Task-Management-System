import type { Reminder } from "../types";

export const reminders: Reminder[] = [];

export const remindersForUser = (userId: string): Reminder[] =>
    reminders.filter((r) => r.assignedTo === userId);
