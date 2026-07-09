import { useMutation, useQueryClient } from "@tanstack/react-query";
import { App as AntApp } from "antd";
import type { Task } from "../types";
import { tasksApi } from "../http/api";
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
            qc.setQueryData<Task[] | undefined>(
                ["tasks-by-list", listId],
                (old) =>
                    old?.map((t) => (t.id === id ? { ...t, ...patch } : t)),
            );
            qc.setQueryData<Task | undefined>(["task", id], (old) =>
                old ? { ...old, ...patch } : old,
            );
            return { prev };
        },
        onError: (_err, _input, ctx) => {
            if (ctx?.prev) {
                qc.setQueryData(["tasks-by-list", listId], ctx.prev);
            }
            message.error("Could not update task");
        },
        onSettled: () => {
            qc.invalidateQueries({ queryKey: ["tasks-by-list", listId] });
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
            patch: Partial<Task>;
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

export const useDeleteTask = (listId?: string) => {
    const qc = useQueryClient();
    const { message } = AntApp.useApp();
    return useMutation({
        mutationFn: (id: string) => tasksApi.delete(id),
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ["tasks-by-list", listId] });
            message.success("Task deleted");
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
