import { useMutation, useQueryClient } from "@tanstack/react-query";
import { App as AntApp } from "antd";
import type { Task } from "../types";
import { tasksApi, type BulkTaskPatch } from "../http/api";
import { useTaskTypes } from "./useReferenceData";

/**
 * Centralised mutation hooks for tasks.
 * Optimistic updates so the UI feels instant.
 */
export const useUpdateTask = (listId?: string) => {
    const qc = useQueryClient();
    const { message } = AntApp.useApp();
    return useMutation({
        mutationFn: ({ id, patch }: { id: string; patch: Partial<Task> }) =>
            tasksApi.update(id, patch),
        onMutate: async ({ id, patch }) => {
            const keys = [["tasks-by-list", listId], ["task", id]];
            for (const key of keys) {
                await qc.cancelQueries({ queryKey: key });
            }
            const prev = qc.getQueryData<Task[]>(["tasks-by-list", listId]);
            // M10: snapshot the single-task cache too, or a failed PATCH leaves
            // the drawer (which reads ["task", id]) showing the edit as applied.
            const prevTask = qc.getQueryData<Task>(["task", id]);
            qc.setQueryData<Task[] | undefined>(
                ["tasks-by-list", listId],
                (old) =>
                    old?.map((t) => (t.id === id ? { ...t, ...patch } : t)),
            );
            qc.setQueryData<Task | undefined>(["task", id], (old) =>
                old ? { ...old, ...patch } : old,
            );
            return { prev, prevTask, id };
        },
        onError: (_err, _input, ctx) => {
            if (ctx?.prev) {
                qc.setQueryData(["tasks-by-list", listId], ctx.prev);
            }
            if (ctx?.prevTask !== undefined) {
                qc.setQueryData(["task", ctx.id], ctx.prevTask);
            }
            message.error("Could not update task");
        },
        onSettled: (_data, _err, vars) => {
            qc.invalidateQueries({ queryKey: ["tasks-by-list", listId] });
            qc.invalidateQueries({ queryKey: ["task", vars.id] });
            qc.invalidateQueries({ queryKey: ["my-work"] });
        },
    });
};

export const useCreateTask = (_listId?: string) => {
    const qc = useQueryClient();
    const { message } = AntApp.useApp();
    // The backend requires a task_type_id (a freshly-created list has no
    // default), so quick-add UIs (board / list / calendar) that don't pick a
    // type fall back to the workspace's first task type here.
    const { data: taskTypes = [] } = useTaskTypes();
    return useMutation({
        mutationFn: (
            input: Partial<Task> & { name: string; primaryListId: string },
        ) =>
            tasksApi.create({
                ...input,
                taskTypeId: input.taskTypeId ?? taskTypes[0]?.id,
            }),
        onSuccess: (newTask) => {
            qc.invalidateQueries({
                queryKey: ["tasks-by-list", newTask.primaryListId],
            });
            qc.invalidateQueries({ queryKey: ["my-work"] });
            message.success(`Created “${newTask.name.slice(0, 40)}”`);
        },
        onError: () => message.error("Could not create task"),
    });
};

export const useBulkUpdateTasks = (listId?: string) => {
    const qc = useQueryClient();
    const { message } = AntApp.useApp();
    return useMutation({
        mutationFn: ({
            ids,
            patch,
        }: {
            ids: string[];
            patch: BulkTaskPatch;
        }) => tasksApi.bulkUpdate(ids, patch),
        onSuccess: (updated) => {
            qc.invalidateQueries({ queryKey: ["tasks-by-list", listId] });
            message.success(`Updated ${updated.length} tasks`);
        },
        onError: () => message.error("Bulk update failed"),
    });
};

export const useArchiveTask = (listId?: string) => {
    const qc = useQueryClient();
    const { message } = AntApp.useApp();
    return useMutation({
        mutationFn: (id: string) => tasksApi.archive(id),
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ["tasks-by-list", listId] });
            message.success("Task archived");
        },
    });
};

/** F25 (ISS-050): the inverse of archive — the client had no caller for it. */
export const useUnarchiveTask = (listId?: string) => {
    const qc = useQueryClient();
    const { message } = AntApp.useApp();
    return useMutation({
        mutationFn: (id: string) => tasksApi.unarchive(id),
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ["tasks-by-list", listId] });
            message.success("Task restored");
        },
    });
};

/**
 * F25 (ISS-050): PERMANENT delete (`?hard=true`). The plain
 * `DELETE /tasks/:id` is a soft delete — identical to archive — so offering
 * it as a second "Delete" button told the user their task was gone when it was
 * merely hidden and still readable by anyone with the id. Admin/owner only
 * server-side; a member gets a 403 the caller surfaces.
 */
export const useDeleteTask = (listId?: string) => {
    const qc = useQueryClient();
    const { message } = AntApp.useApp();
    return useMutation({
        mutationFn: (id: string) => tasksApi.delete(id, true),
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ["tasks-by-list", listId] });
            message.success("Task permanently deleted");
        },
    });
};

/**
 * Assignee/tag changes go through the §11 membership DELTA endpoints (the task
 * PATCH does NOT accept `assignees`/`tags`). Each setter diffs the submitted
 * `next[]` against the task's current array and fires the add/remove calls, then
 * refreshes the task + its list.
 */
export const useTaskMembership = (task: Task) => {
    const qc = useQueryClient();
    const { message } = AntApp.useApp();
    const invalidate = () => {
        qc.invalidateQueries({ queryKey: ["task", task.id] });
        qc.invalidateQueries({
            queryKey: ["tasks-by-list", task.primaryListId],
        });
    };
    const setAssignees = useMutation({
        mutationFn: async (next: string[]) => {
            const cur = task.assignees;
            const added = next.filter((id) => !cur.includes(id));
            const removed = cur.filter((id) => !next.includes(id));
            if (added.length) await tasksApi.addAssignees(task.id, added);
            for (const id of removed) await tasksApi.removeAssignee(task.id, id);
        },
        onSuccess: invalidate,
        onError: () => message.error("Could not update assignees"),
    });
    const setTags = useMutation({
        mutationFn: async (next: string[]) => {
            const cur = task.tags;
            const added = next.filter((id) => !cur.includes(id));
            const removed = cur.filter((id) => !next.includes(id));
            if (added.length) await tasksApi.addTags(task.id, added);
            for (const id of removed) await tasksApi.removeTag(task.id, id);
        },
        onSuccess: invalidate,
        onError: () => message.error("Could not update tags"),
    });
    return { setAssignees, setTags };
};
