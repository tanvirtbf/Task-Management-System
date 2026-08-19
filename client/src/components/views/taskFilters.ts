import { addDays, dayKey, startOfDay } from "../../lib/date-utils";
import type { Priority, Task } from "../../types";

/**
 * The shared task-filter model used by every task surface — List, Board,
 * Calendar, and the space-level Tasks browser — so "filter by status /
 * person / date range" means exactly the same thing everywhere.
 *
 * Everything is client-side: the pages already hold the full (RBAC-scoped)
 * task array for their list/space, so filtering is a pure predicate pass.
 * An empty array / null field means "no constraint".
 */

/** Sentinel assignee id meaning "tasks with NO assignee". */
export const UNASSIGNED = "__unassigned__";

export interface TaskFilterState {
    /** Status ids to keep (empty = any). Space level resolves names → ids. */
    statusIds: string[];
    /** User ids to keep — a task matches if ANY of its assignees is selected.
     *  May contain the UNASSIGNED sentinel to match assignee-less tasks. */
    assigneeIds: string[];
    priorities: Priority[];
    /** Due-date window, inclusive, as local YYYY-MM-DD. Either side open. */
    dueFrom: string | null;
    dueTo: string | null;
    /** With a date window active, also keep tasks that have NO due date. */
    includeUndated: boolean;
}

export const EMPTY_TASK_FILTERS: TaskFilterState = {
    statusIds: [],
    assigneeIds: [],
    priorities: [],
    dueFrom: null,
    dueTo: null,
    includeUndated: false,
};

export const hasDateFilter = (f: TaskFilterState): boolean =>
    f.dueFrom !== null || f.dueTo !== null;

/** How many filter GROUPS are active — feeds the button badge. */
export const countActiveTaskFilters = (f: TaskFilterState): number =>
    (f.statusIds.length > 0 ? 1 : 0) +
    (f.assigneeIds.length > 0 ? 1 : 0) +
    (f.priorities.length > 0 ? 1 : 0) +
    (hasDateFilter(f) ? 1 : 0);

/**
 * Apply the shared filters. Deliberately does NOT handle search / Me Mode /
 * show-closed — those stay with each view, which already owns them.
 */
export const applyTaskFilters = (
    tasks: Task[],
    f: TaskFilterState,
): Task[] => {
    const byStatus = f.statusIds.length > 0;
    const byAssignee = f.assigneeIds.length > 0;
    const byPriority = f.priorities.length > 0;
    const byDate = hasDateFilter(f);
    if (!byStatus && !byAssignee && !byPriority && !byDate) return tasks;

    const wantUnassigned = f.assigneeIds.includes(UNASSIGNED);

    return tasks.filter((t) => {
        if (byStatus && !f.statusIds.includes(t.statusId)) return false;

        if (byAssignee) {
            const matchesPerson = t.assignees.some((id) =>
                f.assigneeIds.includes(id),
            );
            const matchesUnassigned =
                wantUnassigned && t.assignees.length === 0;
            if (!matchesPerson && !matchesUnassigned) return false;
        }

        if (byPriority && !f.priorities.includes(t.priority)) return false;

        if (byDate) {
            if (!t.dueDate) return f.includeUndated;
            // Same local-calendar-day reading the Calendar view uses, so a
            // task shown on the 20th is matched by a range that covers the
            // 20th — never off by a timezone.
            const day = dayKey(new Date(t.dueDate));
            if (f.dueFrom && day < f.dueFrom) return false;
            if (f.dueTo && day > f.dueTo) return false;
        }

        return true;
    });
};

// ─── Quick date-range presets ────────────────────────────────────────────────

export interface DueDatePreset {
    key: string;
    label: string;
    /** Compute [from, to] (either side may be null = open-ended). */
    range: (weekStartsOn: number) => [string | null, string | null];
}

const weekRange = (weekStartsOn: number): [string, string] => {
    const today = startOfDay(new Date());
    const back = (today.getDay() - weekStartsOn + 7) % 7;
    const start = addDays(today, -back);
    return [dayKey(start), dayKey(addDays(start, 6))];
};

export const DUE_DATE_PRESETS: DueDatePreset[] = [
    {
        key: "today",
        label: "Today",
        range: () => {
            const d = dayKey(new Date());
            return [d, d];
        },
    },
    {
        key: "week",
        label: "This week",
        range: (weekStartsOn) => weekRange(weekStartsOn),
    },
    {
        key: "month",
        label: "This month",
        range: () => {
            const now = new Date();
            const start = new Date(now.getFullYear(), now.getMonth(), 1);
            const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
            return [dayKey(start), dayKey(end)];
        },
    },
    {
        key: "overdue",
        label: "Overdue",
        // Everything due BEFORE today. Open start; completed/closed tasks are
        // governed by the view's own "Show closed" toggle, not by this filter.
        range: () => [null, dayKey(addDays(startOfDay(new Date()), -1))],
    },
];
