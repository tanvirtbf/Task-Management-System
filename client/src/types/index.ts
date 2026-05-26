import type { TaskPriority, TaskStatus } from "@/lib/constants";

export interface User {
    id: number;
    email: string;
    first_name: string;
    last_name: string | null;
    avatar_url: string | null;
    role: "admin" | "member";
    is_active: boolean;
    last_login_at: string | null;
}

export interface Task {
    id: number;
    title: string;
    description: string | null;
    status: TaskStatus;
    priority: TaskPriority;
    due_date: string | null;
    creator_id: number;
    assignee_id: number | null;
    is_archived: boolean;
    completed_at: string | null;
    created_at: string;
    updated_at: string;
}

export interface Pagination {
    page: number;
    perPage: number;
    total: number;
    totalPages: number;
}

export interface PaginatedResponse<T> {
    data: T[];
    pagination: Pagination;
}

export interface DataResponse<T> {
    data: T;
}
