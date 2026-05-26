import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";
import type { DataResponse, PaginatedResponse, Task } from "@/types";
import type { TaskPriority, TaskStatus } from "@/lib/constants";

interface TaskFilters {
    page?: number;
    perPage?: number;
    status?: TaskStatus;
    priority?: TaskPriority;
    assigneeId?: number;
}

function buildQueryString(filters: TaskFilters): string {
    const params = new URLSearchParams();
    if (filters.page) params.set("page", String(filters.page));
    if (filters.perPage) params.set("perPage", String(filters.perPage));
    if (filters.status) params.set("status", filters.status);
    if (filters.priority) params.set("priority", filters.priority);
    if (filters.assigneeId) params.set("assigneeId", String(filters.assigneeId));
    const q = params.toString();
    return q ? `?${q}` : "";
}

export function useTasks(filters: TaskFilters = {}) {
    return useQuery({
        queryKey: ["tasks", filters],
        queryFn: () =>
            apiClient.get<PaginatedResponse<Task>>(`/tasks${buildQueryString(filters)}`),
    });
}

export function useTask(id: number | null) {
    return useQuery({
        queryKey: ["tasks", id],
        queryFn: () => apiClient.get<DataResponse<Task>>(`/tasks/${id}`),
        enabled: id != null,
    });
}
