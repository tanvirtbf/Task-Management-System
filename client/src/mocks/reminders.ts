import type { Reminder } from "../types";

const today = new Date();
const atHour = (h: number, m = 0) => {
    const d = new Date(today);
    d.setHours(h, m, 0, 0);
    return d.toISOString();
};

export const reminders: Reminder[] = [
    {
        id: "r-001",
        userId: "u-001",
        assignedTo: "u-001",
        taskId: null,
        title: "Call new supplier — Cosmo Trading",
        notes: "Discuss bulk pricing for Q3",
        dueAt: atHour(11, 30),
        isCompleted: false,
        completedAt: null,
    },
    {
        id: "r-002",
        userId: "u-001",
        assignedTo: "u-001",
        taskId: "t-1042",
        title: "Review COD reconciliation report",
        dueAt: atHour(14, 0),
        isCompleted: false,
        completedAt: null,
    },
    {
        id: "r-003",
        userId: "u-001",
        assignedTo: "u-001",
        taskId: null,
        title: "Team standup — Operations",
        dueAt: atHour(17, 0),
        isCompleted: false,
        completedAt: null,
    },
];

export const remindersForUser = (userId: string) =>
    reminders.filter(
        (r) =>
            r.assignedTo === userId &&
            !r.isCompleted &&
            new Date(r.dueAt).toDateString() === today.toDateString(),
    );
