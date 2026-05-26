/**
 * Phase 9 — Widget data resolution helpers.
 * Filters mock tasks/activity by widget scope + config and produces
 * shapes expected by chart primitives.
 */

import dayjs from "dayjs";
import { lists } from "../../mocks/lists";
import { statuses, statusesById } from "../../mocks/statuses";
import { tasks } from "../../mocks/tasks";
import { tags as allTags, tagsById } from "../../mocks/tags";
import { taskTypes } from "../../mocks/task-types";
import { users as allUsers, usersById } from "../../mocks/users";
import { activityLog } from "../../mocks/activity";
import type { Task, Priority } from "../../types";
import { PRIORITY_LABELS } from "../../types";
import type {
    WidgetConfig,
    WidgetGroupBy,
    WidgetMetric,
    WidgetScope,
} from "../../types/dashboard";

/** Returns the tasks that fall inside the widget's scope. */
export const tasksInScope = (scope?: WidgetScope): Task[] => {
    if (!scope || scope.type === "workspace") return tasks;
    if (scope.type === "list")
        return tasks.filter((t) => t.primaryListId === scope.id);
    if (scope.type === "space") {
        const listIds = new Set(
            lists.filter((l) => l.spaceId === scope.id).map((l) => l.id),
        );
        return tasks.filter((t) => listIds.has(t.primaryListId));
    }
    return tasks;
};

const isDone = (task: Task): boolean => {
    const status = statusesById.get(task.statusId);
    return !!task.completedAt || status?.statusGroup === "done" || status?.statusGroup === "closed";
};

const dueDate = (t: Task) => (t.dueDate ? dayjs(t.dueDate) : null);

/** Aggregate the requested metric into a single number. */
export const computeMetric = (
    config: WidgetConfig,
): { value: number; sparkline: number[] } => {
    const metric = config.metric ?? "task_count";
    const scoped = tasksInScope(config.scope);
    const now = dayjs();

    const inTimeWindow = (t: Task): boolean => {
        if (!config.timeRange || config.timeRange === "all") return true;
        const ref = metric === "task_count_completed"
            ? t.completedAt && dayjs(t.completedAt)
            : dayjs(t.createdAt);
        if (!ref) return false;
        if (config.timeRange === "today") return ref.isSame(now, "day");
        if (config.timeRange === "7d") return now.diff(ref, "day") <= 7;
        if (config.timeRange === "30d") return now.diff(ref, "day") <= 30;
        if (config.timeRange === "90d") return now.diff(ref, "day") <= 90;
        return true;
    };

    let value = 0;
    switch (metric) {
        case "task_count":
            value = scoped.filter((t) => !isDone(t) && inTimeWindow(t))
                .length;
            break;
        case "task_count_completed":
            value = scoped.filter((t) => isDone(t) && inTimeWindow(t))
                .length;
            break;
        case "task_count_overdue":
            value = scoped.filter((t) => {
                const d = dueDate(t);
                return d && !isDone(t) && d.isBefore(now, "day");
            }).length;
            break;
        case "task_count_due_today":
            value = scoped.filter((t) => {
                const d = dueDate(t);
                return d && !isDone(t) && d.isSame(now, "day");
            }).length;
            break;
        case "task_count_due_this_week":
            value = scoped.filter((t) => {
                const d = dueDate(t);
                return (
                    d && !isDone(t) && d.diff(now, "day") <= 7 && d.diff(now, "day") >= 0
                );
            }).length;
            break;
        case "comment_count":
            value = scoped.reduce((s, t) => s + t.commentsCount, 0);
            break;
        case "form_submission_count":
            value = 0;
            break;
        case "automation_run_count":
            value = 0;
            break;
        case "time_tracked":
            value = scoped.reduce(
                (s, t) => s + (t.timeTrackedSeconds ?? 0),
                0,
            );
            break;
    }

    // Sparkline: last 14 days of metric
    const sparkline: number[] = [];
    for (let i = 13; i >= 0; i--) {
        const day = now.subtract(i, "day");
        const count = scoped.filter((t) => {
            const ref =
                metric === "task_count_completed"
                    ? t.completedAt && dayjs(t.completedAt)
                    : dayjs(t.createdAt);
            return ref && ref.isSame(day, "day");
        }).length;
        sparkline.push(count);
    }
    return { value, sparkline };
};

/** Compute trend percentage vs previous period (positive = up). */
export const computeTrend = (
    config: WidgetConfig,
): { pct: number; direction: "up" | "down" | "flat" } => {
    if (config.kpiCompareTo !== "prev_period")
        return { pct: 0, direction: "flat" };
    const range = config.timeRange ?? "7d";
    const days = range === "30d" ? 30 : range === "today" ? 1 : 7;
    const scoped = tasksInScope(config.scope);
    const now = dayjs();
    const cutoff = now.subtract(days, "day");
    const prevCutoff = now.subtract(days * 2, "day");

    const current = scoped.filter((t) => {
        const d = dayjs(t.createdAt);
        return d.isAfter(cutoff);
    }).length;
    const previous = scoped.filter((t) => {
        const d = dayjs(t.createdAt);
        return d.isAfter(prevCutoff) && d.isBefore(cutoff);
    }).length;
    if (previous === 0) return { pct: current > 0 ? 100 : 0, direction: current > 0 ? "up" : "flat" };
    const pct = ((current - previous) / previous) * 100;
    return {
        pct,
        direction: pct > 1 ? "up" : pct < -1 ? "down" : "flat",
    };
};

/** Group tasks by attribute and return chart-ready data. */
export const groupTasks = (
    config: WidgetConfig,
): { label: string; value: number; color: string }[] => {
    const groupBy: WidgetGroupBy = config.groupBy ?? "status";
    const scoped = tasksInScope(config.scope).filter((t) => !isDone(t));

    if (groupBy === "status") {
        const map = new Map<string, number>();
        scoped.forEach((t) =>
            map.set(t.statusId, (map.get(t.statusId) ?? 0) + 1),
        );
        return Array.from(map.entries())
            .map(([id, value]) => {
                const s = statusesById.get(id);
                return {
                    label: s?.name ?? id,
                    value,
                    color: s?.color ?? "#94A3B8",
                };
            })
            .sort((a, b) => b.value - a.value);
    }

    if (groupBy === "priority") {
        const colors: Record<Priority, string> = {
            0: "#94A3B8",
            1: "#E11D48",
            2: "#F59E0B",
            3: "#4F46E5",
            4: "#10B981",
        };
        const map = new Map<Priority, number>();
        scoped.forEach((t) =>
            map.set(t.priority, (map.get(t.priority) ?? 0) + 1),
        );
        return Array.from(map.entries())
            .map(([p, value]) => ({
                label: PRIORITY_LABELS[p],
                value,
                color: colors[p],
            }))
            .sort((a, b) => b.value - a.value);
    }

    if (groupBy === "assignee") {
        const map = new Map<string, number>();
        scoped.forEach((t) => {
            t.assignees.forEach((id) => {
                map.set(id, (map.get(id) ?? 0) + 1);
            });
        });
        const palette = [
            "#4F46E5",
            "#10B981",
            "#F59E0B",
            "#E11D48",
            "#8B5CF6",
            "#06B6D4",
            "#EC4899",
        ];
        return Array.from(map.entries())
            .map(([id, value], idx) => {
                const u = usersById.get(id);
                return {
                    label: u
                        ? `${u.firstName} ${u.lastName.charAt(0)}.`
                        : id,
                    value,
                    color: palette[idx % palette.length],
                };
            })
            .sort((a, b) => b.value - a.value);
    }

    if (groupBy === "list") {
        const map = new Map<string, number>();
        scoped.forEach((t) =>
            map.set(t.primaryListId, (map.get(t.primaryListId) ?? 0) + 1),
        );
        const palette = [
            "#4F46E5",
            "#10B981",
            "#F59E0B",
            "#E11D48",
            "#8B5CF6",
            "#06B6D4",
        ];
        return Array.from(map.entries())
            .map(([id, value], idx) => {
                const l = lists.find((x) => x.id === id);
                return {
                    label: l?.name ?? id,
                    value,
                    color: palette[idx % palette.length],
                };
            })
            .sort((a, b) => b.value - a.value);
    }

    if (groupBy === "task_type") {
        const map = new Map<string, number>();
        scoped.forEach((t) =>
            map.set(t.taskTypeId, (map.get(t.taskTypeId) ?? 0) + 1),
        );
        return Array.from(map.entries())
            .map(([id, value]) => {
                const tt = taskTypes.find((x) => x.id === id);
                return {
                    label: tt?.name ?? id,
                    value,
                    color: tt?.color ?? "#94A3B8",
                };
            })
            .sort((a, b) => b.value - a.value);
    }

    if (groupBy === "tag") {
        const map = new Map<string, number>();
        scoped.forEach((t) =>
            t.tags.forEach((id) =>
                map.set(id, (map.get(id) ?? 0) + 1),
            ),
        );
        return Array.from(map.entries())
            .map(([id, value]) => {
                const tag = tagsById.get(id);
                return {
                    label: tag?.name ?? id,
                    value,
                    color: tag?.color ?? "#94A3B8",
                };
            })
            .sort((a, b) => b.value - a.value);
    }

    return [];
};

/** Compute a daily time-series for line chart (last 30/90 days). */
export const timeSeries = (
    config: WidgetConfig,
): { label: string; value: number }[] => {
    const metric = config.metric ?? "task_count_completed";
    const range = config.timeRange ?? "30d";
    const days =
        range === "today" ? 1 : range === "7d" ? 7 : range === "30d" ? 30 : range === "90d" ? 90 : 30;
    const scoped = tasksInScope(config.scope);
    const now = dayjs();
    const out: { label: string; value: number }[] = [];
    for (let i = days - 1; i >= 0; i--) {
        const day = now.subtract(i, "day");
        const count = scoped.filter((t) => {
            if (metric === "task_count_completed") {
                return t.completedAt && dayjs(t.completedAt).isSame(day, "day");
            }
            return dayjs(t.createdAt).isSame(day, "day");
        }).length;
        out.push({
            label: day.format(days > 14 ? "MMM D" : "ddd"),
            value: count,
        });
    }
    return out;
};

/** Workload — open tasks per assignee. */
export const computeWorkload = (
    config: WidgetConfig,
): {
    userId: string;
    name: string;
    avatarUrl: string | null;
    total: number;
    overdue: number;
    inProgress: number;
}[] => {
    const scoped = tasksInScope(config.scope).filter((t) => !isDone(t));
    const map = new Map<
        string,
        { total: number; overdue: number; inProgress: number }
    >();
    scoped.forEach((t) => {
        const overdue =
            t.dueDate && dayjs(t.dueDate).isBefore(dayjs(), "day");
        const status = statusesById.get(t.statusId);
        const inProgress = status?.statusGroup === "active";
        t.assignees.forEach((uid) => {
            const cur =
                map.get(uid) ?? { total: 0, overdue: 0, inProgress: 0 };
            cur.total++;
            if (overdue) cur.overdue++;
            if (inProgress) cur.inProgress++;
            map.set(uid, cur);
        });
    });
    return Array.from(map.entries())
        .map(([userId, counts]) => {
            const u = usersById.get(userId);
            return {
                userId,
                name: u ? `${u.firstName} ${u.lastName}` : userId,
                avatarUrl: u?.avatarUrl ?? null,
                ...counts,
            };
        })
        .sort((a, b) => b.total - a.total)
        .slice(0, config.limit ?? 8);
};

/** Filtered + sorted task list. */
export const listTasksForWidget = (config: WidgetConfig): Task[] => {
    let scoped = tasksInScope(config.scope);
    if (config.metric === "task_count_overdue") {
        scoped = scoped.filter((t) => {
            const d = dueDate(t);
            return d && !isDone(t) && d.isBefore(dayjs(), "day");
        });
    } else if (config.metric === "task_count_completed") {
        scoped = scoped.filter((t) => isDone(t));
    } else {
        scoped = scoped.filter((t) => !isDone(t));
    }

    const sortBy = config.sortBy ?? "priority";
    const sorted = [...scoped].sort((a, b) => {
        if (sortBy === "priority") {
            // 1=urgent (highest) → 4=low → 0=none
            const order = (p: Priority) => (p === 0 ? 5 : p);
            return order(a.priority) - order(b.priority);
        }
        if (sortBy === "due_date") {
            if (!a.dueDate) return 1;
            if (!b.dueDate) return -1;
            return a.dueDate.localeCompare(b.dueDate);
        }
        if (sortBy === "updated_at") {
            return b.updatedAt.localeCompare(a.updatedAt);
        }
        if (sortBy === "created_at") {
            return b.createdAt.localeCompare(a.createdAt);
        }
        return 0;
    });

    return sorted.slice(0, config.limit ?? 10);
};

/** Status breakdown — counts grouped by status group with example status names. */
export const statusBreakdown = (
    config: WidgetConfig,
): {
    group: string;
    label: string;
    color: string;
    value: number;
    total: number;
}[] => {
    const scoped = tasksInScope(config.scope);
    const total = scoped.length;
    const groups: Record<
        string,
        { label: string; color: string; value: number }
    > = {
        not_started: { label: "Not started", color: "#94A3B8", value: 0 },
        active: { label: "In progress", color: "#4F46E5", value: 0 },
        done: { label: "Done", color: "#10B981", value: 0 },
        closed: { label: "Closed", color: "#64748B", value: 0 },
    };
    scoped.forEach((t) => {
        const s = statusesById.get(t.statusId);
        const g = s?.statusGroup ?? "not_started";
        if (groups[g]) groups[g].value++;
    });
    return Object.entries(groups).map(([group, info]) => ({
        group,
        ...info,
        total,
    }));
};

/** Calendar heatmap data — daily counts for last N days. */
export const heatmapData = (
    config: WidgetConfig,
): { date: string; count: number }[] => {
    const range = config.timeRange ?? "90d";
    const days = range === "30d" ? 30 : range === "7d" ? 7 : 90;
    const scoped = tasksInScope(config.scope);
    const now = dayjs();
    const out: { date: string; count: number }[] = [];
    for (let i = days - 1; i >= 0; i--) {
        const day = now.subtract(i, "day");
        const count = scoped.filter((t) =>
            dayjs(t.createdAt).isSame(day, "day"),
        ).length;
        out.push({ date: day.format("YYYY-MM-DD"), count });
    }
    return out;
};

/** Filtered activity feed. */
export const activityForScope = (
    config: WidgetConfig,
): typeof activityLog => {
    const scoped = tasksInScope(config.scope);
    const taskIds = new Set(scoped.map((t) => t.id));
    return activityLog
        .filter(
            (a) =>
                !a.entityType ||
                a.entityType !== "task" ||
                taskIds.has(a.entityId),
        )
        .slice(0, config.limit ?? 10);
};
