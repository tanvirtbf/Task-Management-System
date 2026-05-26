import type { Priority } from "./index";

/**
 * Per-list saved view configuration.
 * Persisted in the UI store (localStorage) until a backend lands.
 */
export interface ViewConfig {
    id: string;
    listId: string;
    /** Human-readable name */
    name: string;
    /** Visible to all members? (For now everything's personal — no sharing yet.) */
    isShared: boolean;
    createdAt: string;
    /** Snapshot of List view state at save time. */
    state: {
        groupBy: "status" | "assignee" | "priority" | "task_type" | "none";
        sortBy:
            | "default"
            | "name"
            | "priority"
            | "due_date"
            | "created_at"
            | "updated_at";
        sortDir: "asc" | "desc";
        meMode: boolean;
        showClosedTasks: boolean;
        filters: {
            match: "all" | "any";
            priorities: Priority[];
            assigneeIds: string[];
        };
    };
}
