import { useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import {
    DndContext,
    PointerSensor,
    useSensor,
    useSensors,
    useDraggable,
    type DragEndEvent,
} from "@dnd-kit/core";
import { mockApi } from "../../lib/mock-api";
import { useAuthStore } from "../../stores/auth";
import { useUpdateTask } from "../../hooks/useTaskMutations";
import { statusesById } from "../../mocks/statuses";
import { usersById } from "../../mocks/users";
import {
    addDays,
    addMonths,
    daysBetween,
    formatRangeLabel,
    MS_PER_DAY,
    startOfDay,
    startOfMonth,
} from "../../lib/date-utils";
import { GanttToolbar, type GanttZoom } from "./GanttToolbar";
import { PriorityFlag } from "../ui/PriorityFlag";
import { AssigneeStack } from "../ui/AssigneeStack";
import { tokens } from "../../theme";
import type { Status, Task } from "../../types";
import { Diamond } from "lucide-react";

interface GanttViewProps {
    listId: string;
}

const ZOOM_PX_PER_DAY: Record<GanttZoom, number> = {
    day: 56,
    week: 16,
    month: 5,
};

const LEFT_PANEL_WIDTH = 320;
const ROW_HEIGHT = 36;

export const GanttView = ({ listId }: GanttViewProps) => {
    const user = useAuthStore((s) => s.user);
    const [zoom, setZoom] = useState<GanttZoom>("week");
    const [search, setSearch] = useState("");
    const [meMode, setMeMode] = useState(false);
    const [showClosedTasks, setShowClosedTasks] = useState(false);
    const [showCriticalPath, setShowCriticalPath] = useState(false);
    const [showMilestones, setShowMilestones] = useState(true);
    const [viewStartDate, setViewStartDate] = useState(() =>
        startOfMonth(new Date()),
    );

    const scrollRef = useRef<HTMLDivElement>(null);
    const update = useUpdateTask(listId);

    const { data: tasks = [] } = useQuery({
        queryKey: ["tasks-by-list", listId],
        queryFn: () => mockApi.tasks.listByList(listId),
    });

    const { data: dependencies = [] } = useQuery({
        queryKey: ["task-deps-by-list", listId],
        queryFn: () => mockApi.taskDependencies.byList(listId),
    });

    // Filter
    const filtered = useMemo(() => {
        let r = tasks;
        if (!showClosedTasks) {
            r = r.filter((t) => {
                const s = statusesById.get(t.statusId);
                return s?.statusGroup !== "closed";
            });
        }
        if (meMode && user) {
            r = r.filter((t) => t.assignees.includes(user.id));
        }
        if (search.trim()) {
            const q = search.toLowerCase();
            r = r.filter(
                (t) =>
                    t.name.toLowerCase().includes(q) ||
                    t.customId?.toLowerCase().includes(q),
            );
        }
        return r;
    }, [tasks, showClosedTasks, meMode, search, user]);

    // Tasks with at least one date
    const dated = useMemo(
        () => filtered.filter((t) => t.startDate || t.dueDate),
        [filtered],
    );

    // Sort by start date (or due if no start)
    const sortedTasks = useMemo(() => {
        return [...dated].sort((a, b) => {
            const aDate = a.startDate ?? a.dueDate!;
            const bDate = b.startDate ?? b.dueDate!;
            return new Date(aDate).getTime() - new Date(bDate).getTime();
        });
    }, [dated]);

    // Compute the actual critical path through the dependency DAG.
    // Edges considered: "blocks" + "blocked_by" (both contribute to scheduling).
    const criticalPathIds = useMemo(() => {
        if (!showCriticalPath) return new Set<string>();
        const taskMap = new Map(sortedTasks.map((t) => [t.id, t]));
        const blocksAdj = new Map<string, string[]>();
        dependencies.forEach((d) => {
            if (d.type === "blocks") {
                const arr = blocksAdj.get(d.taskId) ?? [];
                arr.push(d.relatedTaskId);
                blocksAdj.set(d.taskId, arr);
            } else if (d.type === "blocked_by") {
                const arr = blocksAdj.get(d.relatedTaskId) ?? [];
                arr.push(d.taskId);
                blocksAdj.set(d.relatedTaskId, arr);
            }
        });
        const duration = (id: string): number => {
            const t = taskMap.get(id);
            if (!t || !t.startDate || !t.dueDate) return 1;
            return Math.max(
                1,
                daysBetween(
                    new Date(t.startDate),
                    new Date(t.dueDate),
                ),
            );
        };
        // Memoized longest path from each node
        const memo = new Map<string, { length: number; next: string | null }>();
        const longest = (id: string): { length: number; next: string | null } => {
            if (memo.has(id)) return memo.get(id)!;
            const children = blocksAdj.get(id) ?? [];
            let best: { length: number; next: string | null } = {
                length: duration(id),
                next: null,
            };
            for (const c of children) {
                if (!taskMap.has(c)) continue;
                const childPath = longest(c);
                const total = duration(id) + childPath.length;
                if (total > best.length) {
                    best = { length: total, next: c };
                }
            }
            memo.set(id, best);
            return best;
        };
        let startId: string | null = null;
        let max = 0;
        sortedTasks.forEach((t) => {
            const l = longest(t.id);
            if (l.length > max) {
                max = l.length;
                startId = t.id;
            }
        });
        const path = new Set<string>();
        let cur: string | null = startId;
        while (cur) {
            path.add(cur);
            cur = memo.get(cur)?.next ?? null;
        }
        return path;
    }, [showCriticalPath, sortedTasks, dependencies]);

    // Auto-compute range
    const range = useMemo(() => {
        const start = startOfDay(viewStartDate);
        const days = zoom === "day" ? 30 : zoom === "week" ? 90 : 365;
        const end = addDays(start, days);
        return { start, end, days };
    }, [viewStartDate, zoom]);

    const pxPerDay = ZOOM_PX_PER_DAY[zoom];
    const timelineWidth = range.days * pxPerDay;

    const handlePrev = () => {
        const delta = zoom === "day" ? -7 : zoom === "week" ? -28 : -90;
        setViewStartDate(addDays(viewStartDate, delta));
    };
    const handleNext = () => {
        const delta = zoom === "day" ? 7 : zoom === "week" ? 28 : 90;
        setViewStartDate(addDays(viewStartDate, delta));
    };
    const handleToday = () => setViewStartDate(startOfMonth(new Date()));

    const sensors = useSensors(
        useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    );

    const handleDragEnd = (event: DragEndEvent) => {
        const taskId = String(event.active.id).replace(/^gantt-bar:/, "");
        const task = tasks.find((t) => t.id === taskId);
        if (!task || !event.delta) return;

        const dayShift = Math.round(event.delta.x / pxPerDay);
        if (dayShift === 0) return;

        const patch: Partial<Task> = {};
        if (task.startDate) {
            patch.startDate = new Date(
                new Date(task.startDate).getTime() + dayShift * MS_PER_DAY,
            ).toISOString();
        }
        if (task.dueDate) {
            patch.dueDate = new Date(
                new Date(task.dueDate).getTime() + dayShift * MS_PER_DAY,
            ).toISOString();
        }
        update.mutate({ id: task.id, patch });
    };

    return (
        <>
            <GanttToolbar
                zoom={zoom}
                onZoomChange={setZoom}
                onPrev={handlePrev}
                onNext={handleNext}
                onToday={handleToday}
                rangeLabel={formatRangeLabel(range.start, range.end)}
                search={search}
                onSearchChange={setSearch}
                meMode={meMode}
                onMeModeChange={setMeMode}
                showClosedTasks={showClosedTasks}
                onShowClosedChange={setShowClosedTasks}
                showCriticalPath={showCriticalPath}
                onShowCriticalPathChange={setShowCriticalPath}
                showMilestones={showMilestones}
                onShowMilestonesChange={setShowMilestones}
            />

            <DndContext
                sensors={sensors}
                onDragEnd={handleDragEnd}
                modifiers={[
                    (args) => ({
                        ...args.transform,
                        y: 0, // lock vertical dragging
                    }),
                ]}
            >
                <div
                    style={{
                        flex: 1,
                        display: "flex",
                        background: tokens.colors.bgSurface,
                        overflow: "hidden",
                        margin: tokens.spacing[5],
                        border: `1px solid ${tokens.colors.border}`,
                        borderRadius: tokens.radius.lg,
                    }}
                >
                    {/* Left panel — task list */}
                    <div
                        style={{
                            width: LEFT_PANEL_WIDTH,
                            flexShrink: 0,
                            borderRight: `1px solid ${tokens.colors.border}`,
                            display: "flex",
                            flexDirection: "column",
                            overflow: "hidden",
                        }}
                    >
                        <div
                            style={{
                                height: 44,
                                padding: "0 12px",
                                display: "flex",
                                alignItems: "center",
                                borderBottom: `1px solid ${tokens.colors.border}`,
                                background: tokens.colors.bgPage,
                                fontSize: 11,
                                fontWeight: 600,
                                color: tokens.colors.textMuted,
                                textTransform: "uppercase",
                                letterSpacing: "0.05em",
                                flexShrink: 0,
                            }}
                        >
                            Task ({sortedTasks.length})
                        </div>
                        <div
                            style={{
                                flex: 1,
                                overflowY: "auto",
                            }}
                            id="gantt-left-scroll"
                            onScroll={(e) => {
                                const right =
                                    document.getElementById("gantt-right-scroll");
                                if (right)
                                    right.scrollTop = e.currentTarget.scrollTop;
                            }}
                        >
                            {sortedTasks.map((task) => (
                                <GanttRowLabel
                                    key={task.id}
                                    task={task}
                                    status={statusesById.get(task.statusId)}
                                    isCritical={
                                        showCriticalPath &&
                                        task.priority === 1
                                    }
                                />
                            ))}
                            {sortedTasks.length === 0 && (
                                <div
                                    style={{
                                        padding: tokens.spacing[6],
                                        color: tokens.colors.textMuted,
                                        fontSize: tokens.typography.fontSize.sm,
                                        textAlign: "center",
                                    }}
                                >
                                    No tasks with dates. Set start &amp; due
                                    dates in the List view to see them here.
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Right panel — timeline */}
                    <div
                        ref={scrollRef}
                        id="gantt-right-scroll"
                        style={{
                            flex: 1,
                            overflow: "auto",
                            position: "relative",
                        }}
                        onScroll={(e) => {
                            const left =
                                document.getElementById("gantt-left-scroll");
                            if (left)
                                left.scrollTop = e.currentTarget.scrollTop;
                        }}
                    >
                        {/* Time axis (sticky header) */}
                        <TimeAxis
                            range={range}
                            zoom={zoom}
                            pxPerDay={pxPerDay}
                            timelineWidth={timelineWidth}
                        />

                        {/* Body */}
                        <div
                            style={{
                                position: "relative",
                                width: timelineWidth,
                            }}
                        >
                            {/* Today line */}
                            <TodayLine
                                rangeStart={range.start}
                                pxPerDay={pxPerDay}
                                height={sortedTasks.length * ROW_HEIGHT}
                            />

                            {/* Dependency arrows overlay */}
                            <DependencyArrows
                                tasks={sortedTasks}
                                dependencies={dependencies}
                                rangeStart={range.start}
                                pxPerDay={pxPerDay}
                                rowHeight={ROW_HEIGHT}
                                timelineWidth={timelineWidth}
                                criticalPathIds={criticalPathIds}
                            />

                            {/* Bars */}
                            {sortedTasks.map((task, idx) => (
                                <GanttRow
                                    key={task.id}
                                    task={task}
                                    rowIndex={idx}
                                    rangeStart={range.start}
                                    pxPerDay={pxPerDay}
                                    timelineWidth={timelineWidth}
                                    status={statusesById.get(task.statusId)}
                                    isCritical={
                                        showCriticalPath &&
                                        criticalPathIds.has(task.id)
                                    }
                                    showMilestone={showMilestones}
                                />
                            ))}
                        </div>
                    </div>
                </div>
            </DndContext>
        </>
    );
};

// ─────────────────────────────────────────────────────────
// Time axis
// ─────────────────────────────────────────────────────────
const TimeAxis = ({
    range,
    zoom,
    pxPerDay,
    timelineWidth,
}: {
    range: { start: Date; end: Date; days: number };
    zoom: GanttZoom;
    pxPerDay: number;
    timelineWidth: number;
}) => {
    const cells = [];
    if (zoom === "day") {
        for (let i = 0; i < range.days; i++) {
            const day = addDays(range.start, i);
            cells.push({
                left: i * pxPerDay,
                width: pxPerDay,
                primary: day.toLocaleDateString("en-US", {
                    weekday: "short",
                }),
                secondary: String(day.getDate()),
                isWeekend: day.getDay() === 0 || day.getDay() === 6,
            });
        }
    } else if (zoom === "week") {
        // Weekly cells (7 days each)
        for (let i = 0; i < range.days; i += 7) {
            const day = addDays(range.start, i);
            cells.push({
                left: i * pxPerDay,
                width: 7 * pxPerDay,
                primary: day.toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                }),
                secondary: "",
                isWeekend: false,
            });
        }
    } else {
        // Monthly cells
        let cursor = startOfMonth(range.start);
        while (cursor < range.end) {
            const daysFromStart = daysBetween(range.start, cursor);
            const nextMonth = addMonths(cursor, 1);
            const monthDays = daysBetween(cursor, nextMonth);
            cells.push({
                left: daysFromStart * pxPerDay,
                width: monthDays * pxPerDay,
                primary: cursor.toLocaleDateString("en-US", {
                    month: "short",
                    year: "2-digit",
                }),
                secondary: "",
                isWeekend: false,
            });
            cursor = nextMonth;
        }
    }

    return (
        <div
            style={{
                position: "sticky",
                top: 0,
                zIndex: 2,
                background: tokens.colors.bgPage,
                borderBottom: `1px solid ${tokens.colors.border}`,
                height: 44,
                width: timelineWidth,
            }}
        >
            {cells.map((cell, idx) => (
                <div
                    key={idx}
                    style={{
                        position: "absolute",
                        left: cell.left,
                        width: cell.width,
                        height: 44,
                        borderRight: `1px solid ${tokens.colors.borderSubtle}`,
                        display: "flex",
                        flexDirection: "column",
                        justifyContent: "center",
                        alignItems: "center",
                        gap: 2,
                        background: cell.isWeekend
                            ? tokens.colors.bgPage
                            : "transparent",
                    }}
                >
                    <div
                        style={{
                            fontSize: 10,
                            color: tokens.colors.textMuted,
                            fontWeight: 500,
                            textTransform: "uppercase",
                            letterSpacing: "0.03em",
                        }}
                    >
                        {cell.primary}
                    </div>
                    {cell.secondary && (
                        <div
                            style={{
                                fontSize: 13,
                                fontWeight: 600,
                                color: tokens.colors.textPrimary,
                                fontFamily: tokens.typography.fontFamilyMono,
                            }}
                        >
                            {cell.secondary}
                        </div>
                    )}
                </div>
            ))}
        </div>
    );
};

// ─────────────────────────────────────────────────────────
// Today vertical line
// ─────────────────────────────────────────────────────────
const TodayLine = ({
    rangeStart,
    pxPerDay,
    height,
}: {
    rangeStart: Date;
    pxPerDay: number;
    height: number;
}) => {
    const today = startOfDay(new Date());
    const left = daysBetween(rangeStart, today) * pxPerDay;
    if (left < 0) return null;
    return (
        <div
            style={{
                position: "absolute",
                left,
                top: 0,
                bottom: 0,
                width: 2,
                background: tokens.colors.danger,
                opacity: 0.5,
                pointerEvents: "none",
                zIndex: 1,
                minHeight: height,
            }}
            title="Today"
        />
    );
};

// ─────────────────────────────────────────────────────────
// Left panel row label
// ─────────────────────────────────────────────────────────
const GanttRowLabel = ({
    task,
    status,
    isCritical,
}: {
    task: Task;
    status: Status | undefined;
    isCritical: boolean;
}) => {
    const [, setSearchParams] = useSearchParams();
    const assignees = task.assignees
        .map((id) => usersById.get(id))
        .filter((u): u is NonNullable<typeof u> => !!u);

    return (
        <div
            onClick={() =>
                setSearchParams((prev) => {
                    const next = new URLSearchParams(prev);
                    next.set("task", task.id);
                    return next;
                })
            }
            style={{
                height: ROW_HEIGHT,
                padding: "0 12px",
                display: "flex",
                alignItems: "center",
                gap: 6,
                borderBottom: `1px solid ${tokens.colors.borderSubtle}`,
                cursor: "pointer",
                background: isCritical
                    ? tokens.colors.dangerSubtle
                    : "transparent",
            }}
            onMouseEnter={(e) =>
                (e.currentTarget.style.background = isCritical
                    ? tokens.colors.dangerSubtle
                    : tokens.colors.bgHover)
            }
            onMouseLeave={(e) =>
                (e.currentTarget.style.background = isCritical
                    ? tokens.colors.dangerSubtle
                    : "transparent")
            }
        >
            <PriorityFlag priority={task.priority} size={11} />
            <span
                style={{
                    flex: 1,
                    fontSize: tokens.typography.fontSize.sm,
                    color: tokens.colors.textPrimary,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    fontWeight: isCritical ? 600 : 500,
                }}
            >
                {task.name}
            </span>
            <AssigneeStack users={assignees} size={18} max={2} />
        </div>
    );
};

// ─────────────────────────────────────────────────────────
// Single row with bar
// ─────────────────────────────────────────────────────────
const GanttRow = ({
    task,
    rowIndex,
    rangeStart,
    pxPerDay,
    timelineWidth,
    status,
    isCritical,
    showMilestone,
}: {
    task: Task;
    rowIndex: number;
    rangeStart: Date;
    pxPerDay: number;
    timelineWidth: number;
    status: Status | undefined;
    isCritical: boolean;
    showMilestone: boolean;
}) => {
    const [, setSearchParams] = useSearchParams();

    const openDetail = () =>
        setSearchParams((prev) => {
            const next = new URLSearchParams(prev);
            next.set("task", task.id);
            return next;
        });

    return (
        <div
            style={{
                position: "relative",
                height: ROW_HEIGHT,
                width: timelineWidth,
                borderBottom: `1px solid ${tokens.colors.borderSubtle}`,
                background:
                    rowIndex % 2 === 0
                        ? "transparent"
                        : tokens.colors.bgPage,
            }}
        >
            {task.isMilestone && showMilestone ? (
                <MilestoneMarker
                    task={task}
                    rangeStart={rangeStart}
                    pxPerDay={pxPerDay}
                    onClick={openDetail}
                />
            ) : (
                <GanttBar
                    task={task}
                    rangeStart={rangeStart}
                    pxPerDay={pxPerDay}
                    status={status}
                    isCritical={isCritical}
                    onClick={openDetail}
                />
            )}
        </div>
    );
};

// ─────────────────────────────────────────────────────────
// Draggable bar
// ─────────────────────────────────────────────────────────
const GanttBar = ({
    task,
    rangeStart,
    pxPerDay,
    status,
    isCritical,
    onClick,
}: {
    task: Task;
    rangeStart: Date;
    pxPerDay: number;
    status: Status | undefined;
    isCritical: boolean;
    onClick: () => void;
}) => {
    const start = task.startDate
        ? new Date(task.startDate)
        : task.dueDate
          ? new Date(task.dueDate)
          : new Date();
    const end = task.dueDate
        ? new Date(task.dueDate)
        : task.startDate
          ? addDays(new Date(task.startDate), 1)
          : new Date();

    const left = daysBetween(rangeStart, start) * pxPerDay;
    const duration = Math.max(1, daysBetween(start, end) + 1);
    const width = duration * pxPerDay;

    const { attributes, listeners, setNodeRef, transform, isDragging } =
        useDraggable({
            id: `gantt-bar:${task.id}`,
        });

    const progress =
        task.subtasksCount > 0
            ? task.subtasksCompleted / task.subtasksCount
            : 0;

    const color = status?.color ?? tokens.colors.textMuted;

    return (
        <div
            ref={setNodeRef}
            style={{
                position: "absolute",
                left,
                top: 6,
                width: Math.max(20, width - 2),
                height: ROW_HEIGHT - 12,
                background: color,
                borderRadius: 4,
                cursor: isDragging ? "grabbing" : "grab",
                opacity: isDragging ? 0.6 : 1,
                transform: transform
                    ? `translate3d(${transform.x}px, 0, 0)`
                    : undefined,
                display: "flex",
                alignItems: "center",
                padding: "0 6px",
                overflow: "hidden",
                userSelect: "none",
                boxShadow: isCritical
                    ? `0 0 0 2px ${tokens.colors.danger}`
                    : "none",
                zIndex: isDragging ? 5 : 1,
            }}
            {...attributes}
            {...listeners}
            onClick={(e) => {
                e.stopPropagation();
                onClick();
            }}
            title={`${task.name} · ${start.toLocaleDateString()} → ${end.toLocaleDateString()}`}
        >
            {/* Progress fill */}
            {progress > 0 && (
                <div
                    style={{
                        position: "absolute",
                        left: 0,
                        top: 0,
                        bottom: 0,
                        width: `${progress * 100}%`,
                        background: "rgba(0,0,0,0.18)",
                    }}
                />
            )}
            {/* Label inside bar */}
            <span
                style={{
                    position: "relative",
                    fontSize: 11,
                    color: "#FFFFFF",
                    fontWeight: 500,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    textShadow: "0 1px 1px rgba(0,0,0,0.15)",
                }}
            >
                {task.name}
            </span>
        </div>
    );
};

// ─────────────────────────────────────────────────────────
// Milestone diamond
// ─────────────────────────────────────────────────────────
const MilestoneMarker = ({
    task,
    rangeStart,
    pxPerDay,
    onClick,
}: {
    task: Task;
    rangeStart: Date;
    pxPerDay: number;
    onClick: () => void;
}) => {
    const date = task.dueDate
        ? new Date(task.dueDate)
        : task.startDate
          ? new Date(task.startDate)
          : new Date();
    const left = daysBetween(rangeStart, date) * pxPerDay - 8;

    return (
        <div
            onClick={onClick}
            style={{
                position: "absolute",
                left,
                top: ROW_HEIGHT / 2 - 8,
                width: 16,
                height: 16,
                cursor: "pointer",
                color: tokens.colors.warning,
            }}
            title={task.name}
        >
            <Diamond size={16} strokeWidth={2} fill={tokens.colors.warning} />
        </div>
    );
};

// ─────────────────────────────────────────────────────────
// Dependency arrows overlay
// ─────────────────────────────────────────────────────────
const DependencyArrows = ({
    tasks,
    dependencies,
    rangeStart,
    pxPerDay,
    rowHeight,
    timelineWidth,
    criticalPathIds,
}: {
    tasks: Task[];
    dependencies: Array<{
        id: string;
        taskId: string;
        relatedTaskId: string;
        type: string;
    }>;
    rangeStart: Date;
    pxPerDay: number;
    rowHeight: number;
    timelineWidth: number;
    criticalPathIds: Set<string>;
}) => {
    const idxById = useMemo(() => {
        const m = new Map<string, number>();
        tasks.forEach((t, i) => m.set(t.id, i));
        return m;
    }, [tasks]);

    const taskById = useMemo(() => {
        const m = new Map(tasks.map((t) => [t.id, t]));
        return m;
    }, [tasks]);

    /** Get x-coordinate (left edge in px) of bar start. */
    const barStartX = (task: Task) => {
        const d = task.startDate
            ? new Date(task.startDate)
            : new Date(task.dueDate!);
        return daysBetween(rangeStart, d) * pxPerDay;
    };
    const barEndX = (task: Task) => {
        const start = task.startDate
            ? new Date(task.startDate)
            : new Date(task.dueDate!);
        const end = task.dueDate
            ? new Date(task.dueDate)
            : addDays(start, 1);
        const duration = Math.max(1, daysBetween(start, end) + 1);
        return barStartX(task) + duration * pxPerDay;
    };

    /** Normalize each dep to predecessor → successor (predecessor must finish before successor starts). */
    const edges = useMemo(() => {
        const out: Array<{
            from: string;
            to: string;
            isCritical: boolean;
        }> = [];
        dependencies.forEach((d) => {
            let from = "";
            let to = "";
            if (d.type === "blocks") {
                from = d.taskId;
                to = d.relatedTaskId;
            } else if (d.type === "blocked_by") {
                from = d.relatedTaskId;
                to = d.taskId;
            } else {
                // skip linked/waiting_on — only "blocks" semantics drive arrows
                return;
            }
            if (!taskById.has(from) || !taskById.has(to)) return;
            out.push({
                from,
                to,
                isCritical:
                    criticalPathIds.has(from) && criticalPathIds.has(to),
            });
        });
        return out;
    }, [dependencies, taskById, criticalPathIds]);

    if (edges.length === 0) return null;

    const totalHeight = tasks.length * rowHeight;

    return (
        <svg
            width={timelineWidth}
            height={totalHeight}
            style={{
                position: "absolute",
                top: 0,
                left: 0,
                pointerEvents: "none",
                zIndex: 2,
            }}
        >
            <defs>
                <marker
                    id="gantt-arrow"
                    viewBox="0 0 10 10"
                    refX="9"
                    refY="5"
                    markerWidth="6"
                    markerHeight="6"
                    orient="auto-start-reverse"
                >
                    <path d="M 0 0 L 10 5 L 0 10 z" fill="#64748B" />
                </marker>
                <marker
                    id="gantt-arrow-critical"
                    viewBox="0 0 10 10"
                    refX="9"
                    refY="5"
                    markerWidth="6"
                    markerHeight="6"
                    orient="auto-start-reverse"
                >
                    <path d="M 0 0 L 10 5 L 0 10 z" fill="#E11D48" />
                </marker>
            </defs>
            {edges.map(({ from, to, isCritical }) => {
                const fromTask = taskById.get(from)!;
                const toTask = taskById.get(to)!;
                const fromIdx = idxById.get(from)!;
                const toIdx = idxById.get(to)!;

                const x1 = barEndX(fromTask);
                const y1 = fromIdx * rowHeight + rowHeight / 2;
                const x2 = barStartX(toTask);
                const y2 = toIdx * rowHeight + rowHeight / 2;

                // Right-angle elbow: from x1,y1 → right-step → down to y2 → into x2
                const elbow = Math.max(x1 + 8, x2 - 8);
                const path = `M ${x1} ${y1} L ${elbow} ${y1} L ${elbow} ${y2} L ${x2 - 4} ${y2}`;

                return (
                    <path
                        key={`${from}-${to}`}
                        d={path}
                        fill="none"
                        stroke={isCritical ? "#E11D48" : "#64748B"}
                        strokeWidth={isCritical ? 2 : 1.5}
                        opacity={0.85}
                        markerEnd={`url(#${isCritical ? "gantt-arrow-critical" : "gantt-arrow"})`}
                    />
                );
            })}
        </svg>
    );
};
