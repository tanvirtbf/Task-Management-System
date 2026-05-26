import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";
import type { DataResponse, Task } from "@/types";
import type { TaskInput } from "@/lib/validation/task";

export function useCreateTask() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (input: TaskInput) =>
            apiClient.post<DataResponse<Task>>("/tasks", input),
        onSuccess: () => {
            void qc.invalidateQueries({ queryKey: ["tasks"] });
        },
    });
}

export function useUpdateTask(id: number) {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (input: Partial<TaskInput>) =>
            apiClient.patch<DataResponse<Task>>(`/tasks/${id}`, input),
        onSuccess: () => {
            void qc.invalidateQueries({ queryKey: ["tasks"] });
        },
    });
}

export function useDeleteTask() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (id: number) => apiClient.del<void>(`/tasks/${id}`),
        onSuccess: () => {
            void qc.invalidateQueries({ queryKey: ["tasks"] });
        },
    });
}
