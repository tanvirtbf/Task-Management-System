import { useMutation, useQueryClient } from "@tanstack/react-query";
import { App as AntApp } from "antd";
import type { Task } from "../types";
import { mockApi } from "../lib/mock-api";

/**
 * Centralised mutation hooks for tasks.
 * Optimistic updates so the UI feels instant.
 */
export const useUpdateTask = (listId?: string) => {
    const qc = useQueryClient();
    const { message } = AntApp.useApp();
    return useMutation({
        mutationFn: ({ id, patch }: { id: string; patch: Partial<Task> }) =>
            mockApi.tasks.update(id, patch),
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
        onError: (err, _input, ctx) => {
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

export const useCreateTask = (listId?: string) => {
    const qc = useQueryClient();
    const { message } = AntApp.useApp();
    return useMutation({
        mutationFn: (
            input: Partial<Task> & { name: string; primaryListId: string },
        ) => mockApi.tasks.create(input),
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
        }) => mockApi.tasks.bulkUpdate(ids, patch),
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
        mutationFn: (id: string) => mockApi.tasks.archive(id),
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
        mutationFn: (id: string) => mockApi.tasks.delete(id),
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ["tasks-by-list", listId] });
            message.success("Task deleted");
        },
    });
};
