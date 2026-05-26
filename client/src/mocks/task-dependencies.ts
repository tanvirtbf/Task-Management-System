import type { TaskDependency } from "../types/extras";

const now = "2025-09-10T08:00:00Z";

/**
 * Seeded dependency edges between mock tasks.
 * Each edge is stored once, attached to the originating task. The reverse
 * direction is derived at query time via `inverseType`.
 */
export const taskDependencies: TaskDependency[] = [
    {
        id: "dep-001",
        taskId: "t-5001",
        relatedTaskId: "t-5002",
        type: "blocks",
        createdAt: now,
        createdBy: "u-001",
    },
    {
        id: "dep-002",
        taskId: "t-5003",
        relatedTaskId: "t-5001",
        type: "blocked_by",
        createdAt: now,
        createdBy: "u-001",
    },
    {
        id: "dep-003",
        taskId: "t-5005",
        relatedTaskId: "t-5006",
        type: "waiting_on",
        createdAt: now,
        createdBy: "u-003",
    },
    {
        id: "dep-004",
        taskId: "t-5010",
        relatedTaskId: "t-5012",
        type: "linked",
        createdAt: now,
        createdBy: "u-009",
    },
];

export const inverseType = (
    t: TaskDependency["type"],
): TaskDependency["type"] => {
    if (t === "blocks") return "blocked_by";
    if (t === "blocked_by") return "blocks";
    return t;
};

/**
 * Return all dependency edges touching this task (either direction),
 * normalized so the perspective is from `taskId`.
 */
export const dependenciesForTask = (
    taskId: string,
): Array<TaskDependency & { otherTaskId: string }> => {
    const out: Array<TaskDependency & { otherTaskId: string }> = [];
    taskDependencies.forEach((d) => {
        if (d.taskId === taskId) {
            out.push({ ...d, otherTaskId: d.relatedTaskId });
        } else if (d.relatedTaskId === taskId) {
            out.push({
                ...d,
                type: inverseType(d.type),
                otherTaskId: d.taskId,
            });
        }
    });
    return out;
};
