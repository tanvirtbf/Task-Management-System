import type { TaskDependency } from "../types/extras";

/**
 * Dev-only seed: a few "blocks" / "blocked-by" relations between
 * engineering tasks so the DependenciesSection has realistic content.
 */
export const taskDependencies: TaskDependency[] = [
    {
        id: "dep-1",
        taskId: "t-90008", // SSLCommerz integration
        relatedTaskId: "t-90015", // bKash backlog
        type: "blocks",
        createdAt: new Date().toISOString(),
        createdBy: "u-001",
    },
    {
        id: "dep-2",
        taskId: "t-90010", // Pathao webhook
        relatedTaskId: "t-90001", // BUG-1043 Pathao tracking
        type: "blocks",
        createdAt: new Date().toISOString(),
        createdBy: "u-001",
    },
    {
        id: "dep-3",
        taskId: "t-90018", // Drizzle migration
        relatedTaskId: "t-90019", // JWT auth refactor
        type: "blocks",
        createdAt: new Date().toISOString(),
        createdBy: "u-001",
    },
];

export const dependenciesForTask = (
    taskId: string,
): Array<TaskDependency & { otherTaskId: string }> => {
    const out: Array<TaskDependency & { otherTaskId: string }> = [];
    for (const d of taskDependencies) {
        if (d.taskId === taskId) out.push({ ...d, otherTaskId: d.relatedTaskId });
        if (d.relatedTaskId === taskId)
            out.push({
                ...d,
                otherTaskId: d.taskId,
                type: d.type === "blocks" ? ("blocked_by" as never) : d.type,
            });
    }
    return out;
};
