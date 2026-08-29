import { useCallback, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Input, Segmented } from "antd";
import { Search as SearchIcon } from "lucide-react";
import { tasksApi } from "../../http/api";
import { useStatuses, useUsers } from "../../hooks/useReferenceData";
import { useBulkUpdateTasks, useUpdateTask } from "../../hooks/useTaskMutations";
import { useAssignablePeople } from "../../hooks/useAssignablePeople";
import { EmptyState } from "../ui/EmptyState";
import { LoadingState } from "../shared/LoadingState";
import { CARD_GAP, CARD_HEIGHT, MobileTaskCard } from "./MobileTaskCard";
import { tokens } from "../../theme";
import type { Status, Task } from "../../types";

/**
 * P4 of MOBILE_REBUILD_PLAN.md — the one task view a phone gets.
 *
 * U1: List, Board and Calendar are desktop thinking. The scan measured what
 * each was worth at 390px — the list crushed names to 12px, the calendar grid
 * rendered at ZERO width, and only the board's cards read properly. Grouping
 * cards by status *is* the board; grouping by due date *is* the calendar. So
 * three broken surfaces collapse into one good one, with a Group-by control
 * doing the work the tabs used to. Desktop keeps all three tabs, untouched.
 *
 * ⚠️ D10 — VIRTUALISED FROM THE FIRST COMMIT. P0 measured the existing list at
 * 500 tasks: 22,826 DOM nodes, 13.4s to render and 7.4s for twenty scroll
 * frames. Building this view unvirtualised would have meant building it twice.
 * Rows are fixed-height on purpose so the windowing is arithmetic rather than
 * measurement; `CARD_HEIGHT` in MobileTaskCard is the load-bearing constant.
 */

const HEADER_HEIGHT = 40;
const ROW_HEIGHT = CARD_HEIGHT + CARD_GAP;
const OVERSCAN = 6; // rows rendered beyond the viewport, so a flick never shows a gap

type GroupKey = "status" | "assignee" | "due";

type Row =
    | { kind: "header"; key: string; label: string; count: number; offset: number }
    | { kind: "task"; key: string; task: Task; status?: Status; offset: number };

const dueBucket = (iso: string | null): { key: string; label: string; order: number } => {
    if (!iso) return { key: "none", label: "No date", order: 5 };
    const d = new Date(iso);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const day = new Date(d);
    day.setHours(0, 0, 0, 0);
    const diff = Math.round((day.getTime() - today.getTime()) / 86_400_000);
    if (diff < 0) return { key: "overdue", label: "Overdue", order: 0 };
    if (diff === 0) return { key: "today", label: "Today", order: 1 };
    if (diff === 1) return { key: "tomorrow", label: "Tomorrow", order: 2 };
    if (diff <= 7) return { key: "week", label: "Next 7 days", order: 3 };
    return { key: "later", label: "Later", order: 4 };
};

export const MobileTaskView = ({
    listId,
    onOpenTask,
    initialGroupBy = "status",
}: {
    listId: string;
    onOpenTask: (task: Task) => void;
    /** The desktop view the URL asked for, translated into a grouping (U1). */
    initialGroupBy?: GroupKey;
}) => {
    const [groupBy, setGroupBy] = useState<GroupKey>(initialGroupBy);
    const [search, setSearch] = useState("");
    const [scrollTop, setScrollTop] = useState(0);
    const [viewportH, setViewportH] = useState(600);
    const scrollRef = useRef<HTMLDivElement | null>(null);

    const { data: tasks = [], isLoading } = useQuery({
        queryKey: ["tasks-by-list", listId],
        queryFn: () => tasksApi.listByList(listId),
    });
    const { data: statuses = [] } = useStatuses(listId);
    const { data: users = [] } = useUsers();
    const update = useUpdateTask(listId);
    // Delta-based (assignee_add / assignee_remove), so taking a task never
    // wipes whoever else is on it. One mutation for the whole list — the menu
    // is built per row and cannot call a per-task hook.
    const bulkUpdate = useBulkUpdateTasks(listId);
    const { me } = useAssignablePeople(false);

    const statusById = useMemo(
        () => new Map(statuses.map((s) => [s.id, s])),
        [statuses],
    );

    const visible = useMemo(() => {
        let result = tasks.filter(
            (t) => statusById.get(t.statusId)?.statusGroup !== "closed",
        );
        const q = search.trim().toLowerCase();
        if (q) {
            result = result.filter(
                (t) =>
                    t.name.toLowerCase().includes(q) ||
                    t.customId?.toLowerCase().includes(q),
            );
        }
        return result;
    }, [tasks, statusById, search]);

    /** Groups flattened into one positioned row list — the whole virtualiser. */
    const { rows, totalHeight } = useMemo(() => {
        const groups: { key: string; label: string; order: number; tasks: Task[] }[] = [];
        const push = (key: string, label: string, order: number, task: Task) => {
            let g = groups.find((x) => x.key === key);
            if (!g) {
                g = { key, label, order, tasks: [] };
                groups.push(g);
            }
            g.tasks.push(task);
        };

        for (const t of visible) {
            if (groupBy === "status") {
                const s = statusById.get(t.statusId);
                push(s?.id ?? "none", s?.name ?? "No status", s?.position ?? 99, t);
            } else if (groupBy === "assignee") {
                if (t.assignees.length === 0) {
                    push("none", "Unassigned", 99, t);
                } else {
                    const u = users.find((x) => x.id === t.assignees[0]);
                    push(
                        t.assignees[0],
                        u ? `${u.firstName} ${u.lastName}` : "Someone",
                        1,
                        t,
                    );
                }
            } else {
                const b = dueBucket(t.dueDate);
                push(b.key, b.label, b.order, t);
            }
        }
        groups.sort((a, b) => a.order - b.order || a.label.localeCompare(b.label));

        const out: Row[] = [];
        let offset = 0;
        for (const g of groups) {
            if (g.tasks.length === 0) continue;
            out.push({
                kind: "header",
                key: `h:${g.key}`,
                label: g.label,
                count: g.tasks.length,
                offset,
            });
            offset += HEADER_HEIGHT;
            for (const t of g.tasks) {
                out.push({
                    kind: "task",
                    key: t.id,
                    task: t,
                    status: statusById.get(t.statusId),
                    offset,
                });
                offset += ROW_HEIGHT;
            }
        }
        return { rows: out, totalHeight: offset };
    }, [visible, groupBy, statusById, users]);

    // The window: first and last row that can be on screen, plus overscan.
    const firstVisible = Math.max(
        0,
        Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN,
    );
    const lastVisible = Math.min(
        rows.length,
        Math.ceil((scrollTop + viewportH) / ROW_HEIGHT) + OVERSCAN,
    );
    const windowRows = rows.slice(firstVisible, lastVisible);

    const measure = useCallback((el: HTMLDivElement | null) => {
        scrollRef.current = el;
        if (el) setViewportH(el.clientHeight || 600);
    }, []);

    // P4 gave this menu the job drag used to do, but only ever filled it with
    // statuses. Taking a task is the other thing you want from a list on a
    // phone, and hunting for yourself in a picker is not it — so it leads.
    const cardMenu = (task: Task) => {
        const mine = !!me && task.assignees.includes(me.id);
        return {
            items: [
                ...(me
                    ? [
                          {
                              key: "assign-me",
                              label: mine ? "Remove me" : "Assign to me",
                              onClick: () =>
                                  bulkUpdate.mutate({
                                      ids: [task.id],
                                      patch: mine
                                          ? { assigneeRemove: [me.id] }
                                          : { assigneeAdd: [me.id] },
                                  }),
                          },
                          { type: "divider" as const, key: "d1" },
                      ]
                    : []),
                ...statuses.map((s) => ({
                    key: s.id,
                    label: s.name,
                    onClick: () =>
                        update.mutate({ id: task.id, patch: { statusId: s.id } }),
                })),
            ],
        };
    };

    if (isLoading) return <LoadingState label="Loading tasks…" />;

    return (
        <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
            <div
                style={{
                    display: "flex",
                    alignItems: "center",
                    gap: tokens.spacing[2],
                    padding: `${tokens.spacing[2]}px ${tokens.spacing[3]}px`,
                    borderBottom: `1px solid ${tokens.colors.border}`,
                    background: tokens.colors.bgSurface,
                    flexShrink: 0,
                }}
            >
                <Segmented
                    size="small"
                    value={groupBy}
                    onChange={(v) => setGroupBy(v as GroupKey)}
                    options={[
                        { label: "Status", value: "status" },
                        { label: "Who", value: "assignee" },
                        { label: "Due", value: "due" },
                    ]}
                />
                <Input
                    allowClear
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search"
                    prefix={<SearchIcon size={14} strokeWidth={1.75} />}
                    style={{ flex: 1, minWidth: 0 }}
                />
            </div>

            <div
                ref={measure}
                onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
                style={{
                    flex: 1,
                    minHeight: 0,
                    overflowY: "auto",
                    overflowX: "hidden",
                    padding: `0 ${tokens.spacing[3]}px`,
                }}
            >
                {rows.length === 0 ? (
                    <EmptyState
                        title={search ? "No matching tasks" : "Nothing here yet"}
                        description={
                            search
                                ? "Try a different search."
                                : "Tasks in this list will show up here."
                        }
                    />
                ) : (
                    <div style={{ height: totalHeight, position: "relative" }}>
                        {windowRows.map((row) =>
                            row.kind === "header" ? (
                                <div
                                    key={row.key}
                                    style={{
                                        position: "absolute",
                                        top: row.offset,
                                        left: 0,
                                        right: 0,
                                        height: HEADER_HEIGHT,
                                        display: "flex",
                                        alignItems: "center",
                                        gap: 6,
                                        fontSize: 12,
                                        fontWeight: 700,
                                        letterSpacing: "0.06em",
                                        textTransform: "uppercase",
                                        color: tokens.colors.textMuted,
                                    }}
                                >
                                    {row.label}
                                    <span style={{ fontWeight: 500 }}>{row.count}</span>
                                </div>
                            ) : (
                                <div
                                    key={row.key}
                                    style={{
                                        position: "absolute",
                                        top: row.offset,
                                        left: 0,
                                        right: 0,
                                        height: CARD_HEIGHT,
                                    }}
                                >
                                    <MobileTaskCard
                                        task={row.task}
                                        status={row.status}
                                        members={users}
                                        onOpen={onOpenTask}
                                        menu={cardMenu(row.task)}
                                    />
                                </div>
                            ),
                        )}
                    </div>
                )}
            </div>
        </div>
    );
};
