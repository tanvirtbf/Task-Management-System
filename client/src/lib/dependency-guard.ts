import { mockApi } from "./mock-api";
import { statusesById } from "../mocks/statuses";

/**
 * Returns the list of incomplete blockers for a task, given a target status.
 * Returns an empty array if the move is fine or the task isn't blocked.
 *
 * A "blocker" is a task that:
 *  - this task is `blocked_by` (or another task `blocks` it), AND
 *  - whose current status is NOT in the "done" or "closed" status groups.
 */
export const getBlockingTasksForCompletion = async (
    taskId: string,
    targetStatusId: string,
): Promise<Array<{ id: string; name: string; customId?: string }>> => {
    const targetStatus = statusesById.get(targetStatusId);
    const isCompleting =
        targetStatus?.statusGroup === "done" ||
        targetStatus?.statusGroup === "closed";
    if (!isCompleting) return [];

    const deps = await mockApi.taskDependencies.byTask(taskId);
    const blockers = deps.filter(
        (d) => d.type === "blocked_by" || d.type === "waiting_on",
    );
    if (blockers.length === 0) return [];

    const out: Array<{ id: string; name: string; customId?: string }> = [];
    for (const dep of blockers) {
        const other = await mockApi.tasks.getById(dep.otherTaskId);
        if (!other) continue;
        const otherStatus = statusesById.get(other.statusId);
        const otherDone =
            otherStatus?.statusGroup === "done" ||
            otherStatus?.statusGroup === "closed";
        if (!otherDone) {
            out.push({
                id: other.id,
                name: other.name,
                customId: other.customId,
            });
        }
    }
    return out;
};
