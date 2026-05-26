export const SALT_ROUNDS = 10;
export const DEFAULT_PAGE_SIZE = 10;
export const MAX_PAGE_SIZE = 100;

export const ADMIN_ROLE_SLUG = "admin";
export const MEMBER_ROLE_SLUG = "member";

export const TASK_STATUSES = ["todo", "in_progress", "done", "archived"] as const;
export const TASK_PRIORITIES = ["low", "medium", "high", "urgent"] as const;

export type TaskStatus = (typeof TASK_STATUSES)[number];
export type TaskPriority = (typeof TASK_PRIORITIES)[number];
