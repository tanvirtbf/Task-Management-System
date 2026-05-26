export const APP_NAME = "Task Management System";

export const API_BASE = import.meta.env.VITE_API_BASE_URL || "/api/v1";

export const TASK_STATUSES = ["todo", "in_progress", "done", "archived"] as const;
export const TASK_PRIORITIES = ["low", "medium", "high", "urgent"] as const;

export type TaskStatus = (typeof TASK_STATUSES)[number];
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

export const STATUS_LABELS: Record<TaskStatus, string> = {
    todo: "To Do",
    in_progress: "In Progress",
    done: "Done",
    archived: "Archived",
};

export const PRIORITY_LABELS: Record<TaskPriority, string> = {
    low: "Low",
    medium: "Medium",
    high: "High",
    urgent: "Urgent",
};
