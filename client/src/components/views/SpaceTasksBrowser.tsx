import { useMemo, useState } from "react";
import { useQueries } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { Button, Input } from "antd";
import { ClipboardList, Eye, EyeOff, Search, UserCheck } from "lucide-react";
import { statusesApi, tasksApi } from "../../http/api";
import { useUserMap, useWorkspace } from "../../hooks/useReferenceData";
import { useAuthStore } from "../../stores/auth";
import { AssigneeStack } from "../ui/AssigneeStack";
import { EmptyState } from "../ui/EmptyState";
import { TaskDetailDrawer } from "../task/TaskDetailDrawer";
import { dayKey, formatShortDate } from "../../lib/date-utils";
import { tokens } from "../../theme";
import type { List, Status, Task } from "../../types";
import { TaskFilterPopover } from "./TaskFilterPopover";
import {
    EMPTY_TASK_FILTERS,
    applyTaskFilters,
    type TaskFilterState,
} from "./taskFilters";

interface SpaceTasksBrowserProps {
    lists: List[];
}

/**
 * The space-level task browser — every task from every list in the space in
 * one filterable table, so a Head (or anyone on the team) can answer "what is
 * due this week?", "what is Sadia carrying?", "what is stuck in In Progress?"
 * across the whole department without opening lists one by one.
 *
 * Uses the SAME query keys as the list views (["tasks-by-list", id] /
 * ["statuses", id]), so the cache is shared and every task mutation's
 * invalidation refreshes this browser too.
 *
 * Status filtering happens by NAME here: statuses are per-list rows, and the
 * department thinks of "In Progress" as one thing, not five ids. The popover
 * gets one option per distinct name; applying maps names back to every
 * matching id.
 */
export const SpaceTasksBrowser = ({ lists }: SpaceTasksBrowserProps) => {
    const user = useAuthStore((s) => s.user);
    const userMap = useUserMap();
    const { data: ws } = useWorkspace();
    const [searchParams, setSearchParams] = useSearchParams();
    const openTaskId = searchParams.get("task");

    const [search, setSearch] = useState("");
    const [meMode, setMeMode] = useState(false);
    const [showClosedTasks, setShowClosedTasks] = useState(false);
    const [filters, setFilters] = useState<TaskFilterState>(
        EMPTY_TASK_FILTERS,
    );

    // `combine` gives back ONE stable object (react-query memoizes it by the
    // underlying results), so downstream useMemos get honest dependencies.
    const { allTasks, tasksLoading } = useQueries({
        queries: lists.map((l) => ({
            queryKey: ["tasks-by-list", l.id],
            queryFn: () => tasksApi.listByList(l.id),
        })),
        combine: (results) => ({
            allTasks: results.flatMap((r) => r.data ?? []),
            tasksLoading: results.some((r) => r.isLoading),
        }),
    });
    const { allStatuses, statusesLoading } = useQueries({
        queries: lists.map((l) => ({
            queryKey: ["statuses", l.id],
            queryFn: () => statusesApi.byList(l.id),
        })),
        combine: (results) => ({
            allStatuses: results.flatMap((r) => (r.data as Status[]) ?? []),
            statusesLoading: results.some((r) => r.isLoading),
        }),
    });

    const isLoading = tasksLoading || statusesLoading;

    const statusById = useMemo(
        () => new Map(allStatuses.map((s) => [s.id, s])),
        [allStatuses],
    );
    const listById = useMemo(
        () => new Map(lists.map((l) => [l.id, l])),
        [lists],
    );

    // One filter option per distinct status NAME across the space's lists.
    const { statusOptions, idsByNameKey } = useMemo(() => {
        const byKey = new Map<
            string,
            { label: string; color?: string; ids: string[] }
        >();
        for (const s of allStatuses) {
            const key = s.name.trim().toLowerCase();
            const entry = byKey.get(key);
            if (entry) entry.ids.push(s.id);
            else byKey.set(key, { label: s.name, color: s.color, ids: [s.id] });
        }
        return {
            statusOptions: [...byKey.entries()].map(([value, v]) => ({
                value,
                label: v.label,
                color: v.color,
            })),
            idsByNameKey: byKey,
        };
    }, [allStatuses]);

    const filteredTasks = useMemo(() => {
        let result = allTasks;
        if (!showClosedTasks) {
            result = result.filter(
                (t) => statusById.get(t.statusId)?.statusGroup !== "closed",
            );
        }
        if (meMode && user) {
            result = result.filter((t) => t.assignees.includes(user.id));
        }
        // The popover stored NAME keys — resolve them to real status ids.
        const resolved: TaskFilterState = {
            ...filters,
            statusIds: filters.statusIds.flatMap(
                (key) => idsByNameKey.get(key)?.ids ?? [],
            ),
        };
        result = applyTaskFilters(result, resolved);
        if (search.trim()) {
            const q = search.toLowerCase();
            result = result.filter(
                (t) =>
                    t.name.toLowerCase().includes(q) ||
                    t.customId?.toLowerCase().includes(q),
            );
        }
        // Due date first (undated last), then name — the reading order a
        // date-range filter naturally wants.
        return [...result].sort((a, b) => {
            if (a.dueDate && b.dueDate) {
                const cmp = a.dueDate.localeCompare(b.dueDate);
                if (cmp !== 0) return cmp;
            } else if (a.dueDate) return -1;
            else if (b.dueDate) return 1;
            return a.name.localeCompare(b.name);
        });
    }, [
        allTasks,
        statusById,
        showClosedTasks,
        meMode,
        user,
        filters,
        idsByNameKey,
        search,
    ]);

    const openTask = (task: Task) => {
        setSearchParams((prev) => {
            const next = new URLSearchParams(prev);
            next.set("task", task.id);
            return next;
        });
    };

    // The drawer needs the task's own list for its status map / mutations.
    const openedTask = openTaskId
        ? allTasks.find((t) => t.id === openTaskId)
        : undefined;

    const today = dayKey(new Date());

    return (
        <div
            style={{
                display: "flex",
                flexDirection: "column",
                background: tokens.colors.bgSurface,
                border: `1px solid ${tokens.colors.border}`,
                borderRadius: tokens.radius.lg,
                overflow: "hidden",
            }}
        >
            {/* Toolbar */}
            <div
                style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    padding: `${tokens.spacing[3]}px ${tokens.spacing[4]}px`,
                    borderBottom: `1px solid ${tokens.colors.border}`,
                    flexWrap: "wrap",
                }}
            >
                <TaskFilterPopover
                    filters={filters}
                    onChange={setFilters}
                    statusOptions={statusOptions}
                    weekStartsOn={ws?.settings.weekStartsOn ?? 0}
                    extraActiveCount={meMode ? 1 : 0}
                    onClearExtras={() => setMeMode(false)}
                />
                <Button
                    type="text"
                    size="small"
                    icon={
                        showClosedTasks ? (
                            <Eye size={13} strokeWidth={1.75} />
                        ) : (
                            <EyeOff size={13} strokeWidth={1.75} />
                        )
                    }
                    onClick={() => setShowClosedTasks((v) => !v)}
                >
                    {showClosedTasks ? "Hide closed" : "Show closed"}
                </Button>
                <span
                    style={{
                        fontSize: 12,
                        color: tokens.colors.textMuted,
                        fontFamily: tokens.typography.fontFamilyMono,
                        marginLeft: 4,
                    }}
                >
                    {filteredTasks.length} of {allTasks.length} tasks
                </span>
                <div
                    style={{
                        marginLeft: "auto",
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                    }}
                >
                    <Button
                        type={meMode ? "primary" : "text"}
                        size="small"
                        icon={<UserCheck size={13} strokeWidth={1.75} />}
                        onClick={() => setMeMode((v) => !v)}
                    >
                        Me Mode
                    </Button>
                    <Input
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder="Search tasks in this space..."
                        prefix={
                            <Search
                                size={13}
                                strokeWidth={1.75}
                                color={tokens.colors.textMuted}
                            />
                        }
                        size="small"
                        style={{ width: 230 }}
                        allowClear
                    />
                </div>
            </div>

            {/* Rows */}
            {isLoading ? (
                <div
                    style={{
                        padding: tokens.spacing[8],
                        color: tokens.colors.textMuted,
                        fontSize: tokens.typography.fontSize.sm,
                    }}
                >
                    Loading tasks…
                </div>
            ) : filteredTasks.length === 0 ? (
                <EmptyState
                    icon={ClipboardList}
                    title={
                        allTasks.length === 0
                            ? "No tasks in this space yet"
                            : "No tasks match your filters"
                    }
                    description={
                        allTasks.length === 0
                            ? "Tasks created in this space's lists will appear here."
                            : "Loosen the filters above, or clear them all."
                    }
                    compact
                />
            ) : (
                <div style={{ maxHeight: 560, overflowY: "auto" }}>
                    {filteredTasks.map((task) => {
                        const status = statusById.get(task.statusId);
                        const list = listById.get(task.primaryListId);
                        const assignees = task.assignees
                            .map((id) => userMap.get(id))
                            .filter((u): u is NonNullable<typeof u> => !!u);
                        const overdue =
                            !!task.dueDate &&
                            !task.completedAt &&
                            dayKey(new Date(task.dueDate)) < today;
                        return (
                            <button
                                key={task.id}
                                type="button"
                                onClick={() => openTask(task)}
                                style={{
                                    display: "flex",
                                    alignItems: "center",
                                    gap: 10,
                                    width: "100%",
                                    textAlign: "left",
                                    background: "transparent",
                                    border: 0,
                                    borderBottom: `1px solid ${tokens.colors.borderSubtle}`,
                                    padding: "7px 14px",
                                    cursor: "pointer",
                                    transition:
                                        "background var(--transition-base)",
                                }}
                                onMouseEnter={(e) => {
                                    e.currentTarget.style.background =
                                        tokens.colors.bgHover;
                                }}
                                onMouseLeave={(e) => {
                                    e.currentTarget.style.background =
                                        "transparent";
                                }}
                            >
                                <span
                                    aria-hidden
                                    title={status?.name}
                                    style={{
                                        width: 9,
                                        height: 9,
                                        borderRadius: "50%",
                                        background:
                                            status?.color ??
                                            tokens.colors.border,
                                        flexShrink: 0,
                                    }}
                                />
                                <span
                                    style={{
                                        flex: 1,
                                        minWidth: 0,
                                        overflow: "hidden",
                                        textOverflow: "ellipsis",
                                        whiteSpace: "nowrap",
                                        fontSize:
                                            tokens.typography.fontSize.sm,
                                        color: tokens.colors.textPrimary,
                                        fontWeight: 500,
                                    }}
                                >
                                    {task.name}
                                </span>
                                {list && (
                                    <span
                                        style={{
                                            fontSize: 11,
                                            fontWeight: 500,
                                            color:
                                                list.color ??
                                                tokens.colors.textSecondary,
                                            background: `${list.color ?? "#94A3B8"}14`,
                                            padding: "1px 8px",
                                            borderRadius: 999,
                                            whiteSpace: "nowrap",
                                            flexShrink: 0,
                                        }}
                                    >
                                        {list.name}
                                    </span>
                                )}
                                <span
                                    style={{
                                        fontSize: 11,
                                        color: tokens.colors.textMuted,
                                        whiteSpace: "nowrap",
                                        flexShrink: 0,
                                        width: 84,
                                    }}
                                >
                                    {status?.name ?? "—"}
                                </span>
                                <span style={{ flexShrink: 0 }}>
                                    <AssigneeStack
                                        users={assignees}
                                        size={20}
                                        max={3}
                                    />
                                </span>
                                <span
                                    style={{
                                        fontSize: 11,
                                        fontFamily:
                                            tokens.typography.fontFamilyMono,
                                        color: overdue
                                            ? tokens.colors.danger
                                            : tokens.colors.textMuted,
                                        fontWeight: overdue ? 600 : 400,
                                        whiteSpace: "nowrap",
                                        flexShrink: 0,
                                        width: 64,
                                        textAlign: "right",
                                    }}
                                >
                                    {task.dueDate
                                        ? formatShortDate(task.dueDate)
                                        : "—"}
                                </span>
                            </button>
                        );
                    })}
                </div>
            )}

            {openedTask && (
                <TaskDetailDrawer
                    taskId={openedTask.id}
                    listId={openedTask.primaryListId}
                    onClose={() => {
                        const next = new URLSearchParams(searchParams);
                        next.delete("task");
                        setSearchParams(next, { replace: true });
                    }}
                />
            )}
        </div>
    );
};
