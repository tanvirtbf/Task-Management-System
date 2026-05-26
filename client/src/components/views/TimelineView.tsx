import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import {
    DndContext,
    PointerSensor,
    useSensor,
    useSensors,
    useDraggable,
    useDroppable,
    type DragEndEvent,
} from "@dnd-kit/core";
import { Button, Dropdown, Input } from "antd";
import {
    ChevronLeft,
    ChevronRight,
    Layers,
    Search,
    UserCheck,
} from "lucide-react";
import { mockApi } from "../../lib/mock-api";
import { useAuthStore } from "../../stores/auth";
import { useUpdateTask } from "../../hooks/useTaskMutations";
import { statusesById } from "../../mocks/statuses";
import { tagsById } from "../../mocks/tags";
import { usersById } from "../../mocks/users";
import {
    addDays,
    daysBetween,
    formatRangeLabel,
    MS_PER_DAY,
    startOfDay,
    startOfMonth,
} from "../../lib/date-utils";
import { Avatar } from "../ui/Avatar";
import { PriorityFlag } from "../ui/PriorityFlag";
import { PRIORITY_LABELS, type Priority, type Status, type Task, type User } from "../../types";
import { tokens } from "../../theme";

type SubgroupBy = "assignee" | "priority" | "tag";

interface TimelineViewProps {
    listId: string;
}

const LEFT_WIDTH = 240;
const ROW_HEIGHT = 36;

type ZoomLevel = "day" | "week" | "month";
const ZOOM_PX_PER_DAY: Record<ZoomLevel, number> = {
    day: 40,
    week: 18,
    month: 6,
};
/** How many days each grid column should span at a given zoom level. */
const ZOOM_COL_DAYS: Record<ZoomLevel, number> = {
    day: 1,
    week: 7,
    month: 30,
};

export const TimelineView = ({ listId }: TimelineViewProps) => {
    const user = useAuthStore((s) => s.user);
    const [subgroupBy, setSubgroupBy] = useState<SubgroupBy>("assignee");
    const [search, setSearch] = useState("");
    const [meMode, setMeMode] = useState(false);
    const [zoom, setZoom] = useState<ZoomLevel>("week");
    const pxPerDay = ZOOM_PX_PER_DAY[zoom];
    const colDays = ZOOM_COL_DAYS[zoom];
    const [viewStartDate, setViewStartDate] = useState(() =>
        startOfMonth(new Date()),
    );

    const update = useUpdateTask(listId);

    const { data: tasks = [] } = useQuery({
        queryKey: ["tasks-by-list", listId],
        queryFn: () => mockApi.tasks.listByList(listId),
    });

    const filtered = useMemo(() => {
        let r = tasks.filter((t) => t.startDate || t.dueDate);
        if (meMode && user) r = r.filter((t) => t.assignees.includes(user.id));
        if (search.trim()) {
            const q = search.toLowerCase();
            r = r.filter((t) => t.name.toLowerCase().includes(q));
        }
        return r;
    }, [tasks, meMode, search, user]);

    // Build swimlanes
    const swimlanes = useMemo(() => {
        const groups = new Map<string, Task[]>();
        for (const t of filtered) {
            if (subgroupBy === "assignee") {
                if (t.assignees.length === 0) {
                    const arr = groups.get("unassigned") ?? [];
                    arr.push(t);
                    groups.set("unassigned", arr);
                } else {
                    for (const a of t.assignees) {
                        const arr = groups.get(a) ?? [];
                        arr.push(t);
                        groups.set(a, arr);
                    }
                }
            } else if (subgroupBy === "priority") {
                const key = String(t.priority);
                const arr = groups.get(key) ?? [];
                arr.push(t);
                groups.set(key, arr);
            } else {
                // tag
                if (t.tags.length === 0) {
                    const arr = groups.get("untagged") ?? [];
                    arr.push(t);
                    groups.set("untagged", arr);
                } else {
                    for (const tagId of t.tags) {
                        const arr = groups.get(tagId) ?? [];
                        arr.push(t);
                        groups.set(tagId, arr);
                    }
                }
            }
        }
        return groups;
    }, [filtered, subgroupBy]);

    const range = useMemo(() => {
        const start = startOfDay(viewStartDate);
        const days = 90;
        return { start, end: addDays(start, days), days };
    }, [viewStartDate]);
    const timelineWidth = range.days * pxPerDay;

    const sensors = useSensors(
        useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    );

    const handleDragEnd = (event: DragEndEvent) => {
        const { active, over } = event;
        if (!over) return;

        const activeId = String(active.id);
        const overId = String(over.id);

        // Bar dragged within timeline → date shift
        if (activeId.startsWith("tl-bar:") && event.delta) {
            const taskId = activeId.replace(/^tl-bar:/, "");
            const task = tasks.find((t) => t.id === taskId);
            if (!task) return;
            const dayShift = Math.round(event.delta.x / pxPerDay);
            if (dayShift === 0) return;
            const patch: Partial<Task> = {};
            if (task.startDate)
                patch.startDate = new Date(
                    new Date(task.startDate).getTime() + dayShift * MS_PER_DAY,
                ).toISOString();
            if (task.dueDate)
                patch.dueDate = new Date(
                    new Date(task.dueDate).getTime() + dayShift * MS_PER_DAY,
                ).toISOString();
            update.mutate({ id: task.id, patch });
            return;
        }

        // Drop on a different swimlane → reassign
        if (activeId.startsWith("tl-bar:") && overId.startsWith("lane:")) {
            const taskId = activeId.replace(/^tl-bar:/, "");
            const laneKey = overId.replace(/^lane:/, "");
            const task = tasks.find((t) => t.id === taskId);
            if (!task) return;

            if (subgroupBy === "assignee") {
                if (laneKey === "unassigned") {
                    update.mutate({
                        id: task.id,
                        patch: { assignees: [] },
                    });
                } else if (!task.assignees.includes(laneKey)) {
                    update.mutate({
                        id: task.id,
                        patch: { assignees: [laneKey] },
                    });
                }
            } else if (subgroupBy === "priority") {
                update.mutate({
                    id: task.id,
                    patch: { priority: Number(laneKey) as Priority },
                });
            }
        }
    };

    return (
        <>
            <div
                style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    padding: `${tokens.spacing[3]}px ${tokens.spacing[6]}px`,
                    background: tokens.colors.bgSurface,
                    borderBottom: `1px solid ${tokens.colors.border}`,
                    flexWrap: "wrap",
                }}
            >
                <Button
                    size="small"
                    onClick={() => setViewStartDate(startOfMonth(new Date()))}
                >
                    Today
                </Button>
                <div
                    style={{
                        display: "inline-flex",
                        background: tokens.colors.bgMuted,
                        borderRadius: tokens.radius.md,
                        padding: 2,
                    }}
                >
                    <button
                        onClick={() =>
                            setViewStartDate(addDays(viewStartDate, -28))
                        }
                        style={navBtnStyle}
                    >
                        <ChevronLeft size={14} strokeWidth={2} />
                    </button>
                    <button
                        onClick={() =>
                            setViewStartDate(addDays(viewStartDate, 28))
                        }
                        style={navBtnStyle}
                    >
                        <ChevronRight size={14} strokeWidth={2} />
                    </button>
                </div>
                <span
                    style={{
                        fontSize: tokens.typography.fontSize.base,
                        fontWeight: 600,
                        marginLeft: 4,
                    }}
                >
                    {formatRangeLabel(range.start, range.end)}
                </span>

                <Dropdown
                    menu={{
                        items: [
                            { key: "assignee", label: "Assignee" },
                            { key: "priority", label: "Priority" },
                            { key: "tag", label: "Tag" },
                        ],
                        selectable: true,
                        selectedKeys: [subgroupBy],
                        onClick: (e) => setSubgroupBy(e.key as SubgroupBy),
                    }}
                    trigger={["click"]}
                >
                    <Button
                        size="small"
                        type="text"
                        icon={<Layers size={13} strokeWidth={1.75} />}
                    >
                        Swimlane by:{" "}
                        <span style={{ fontWeight: 500, marginLeft: 2 }}>
                            {subgroupBy === "assignee"
                                ? "Assignee"
                                : subgroupBy === "priority"
                                  ? "Priority"
                                  : "Tag"}
                        </span>
                    </Button>
                </Dropdown>

                {/* Zoom toggle */}
                <div
                    style={{
                        display: "inline-flex",
                        background: tokens.colors.bgMuted,
                        borderRadius: tokens.radius.sm,
                        padding: 2,
                        gap: 2,
                    }}
                    role="group"
                    aria-label="Zoom"
                >
                    {(["day", "week", "month"] as ZoomLevel[]).map((z) => (
                        <button
                            key={z}
                            onClick={() => setZoom(z)}
                            style={{
                                padding: "3px 10px",
                                fontSize: 11,
                                fontWeight: zoom === z ? 700 : 500,
                                background:
                                    zoom === z
                                        ? tokens.colors.bgSurface
                                        : "transparent",
                                color:
                                    zoom === z
                                        ? tokens.colors.textPrimary
                                        : tokens.colors.textMuted,
                                border: 0,
                                borderRadius: tokens.radius.sm,
                                cursor: "pointer",
                                textTransform: "capitalize",
                                fontFamily: tokens.typography.fontFamilyMono,
                                boxShadow:
                                    zoom === z ? tokens.shadows.sm : "none",
                            }}
                            aria-pressed={zoom === z}
                        >
                            {z}
                        </button>
                    ))}
                </div>

                <div
                    style={{
                        marginLeft: "auto",
                        display: "flex",
                        gap: 6,
                    }}
                >
                    <Button
                        type={meMode ? "primary" : "text"}
                        size="small"
                        icon={<UserCheck size={13} strokeWidth={1.75} />}
                        onClick={() => setMeMode(!meMode)}
                    >
                        Me Mode
                    </Button>
                    <Input
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder="Search..."
                        prefix={
                            <Search
                                size={13}
                                strokeWidth={1.75}
                                color={tokens.colors.textMuted}
                            />
                        }
                        size="small"
                        style={{ width: 200 }}
                        allowClear
                    />
                </div>
            </div>

            <DndContext
                sensors={sensors}
                onDragEnd={handleDragEnd}
                modifiers={[
                    // Allow horizontal & vertical drags
                ]}
            >
                <div
                    style={{
                        flex: 1,
                        display: "flex",
                        background: tokens.colors.bgSurface,
                        margin: tokens.spacing[5],
                        border: `1px solid ${tokens.colors.border}`,
                        borderRadius: tokens.radius.lg,
                        overflow: "hidden",
                    }}
                >
                    {/* Left labels column */}
                    <div
                        style={{
                            width: LEFT_WIDTH,
                            flexShrink: 0,
                            borderRight: `1px solid ${tokens.colors.border}`,
                            display: "flex",
                            flexDirection: "column",
                        }}
                    >
                        <div
                            style={{
                                height: 36,
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
                            {subgroupBy}
                        </div>
                        <div style={{ flex: 1, overflowY: "auto" }}>
                            {Array.from(swimlanes.keys()).map((key) => (
                                <SwimlaneLabel
                                    key={key}
                                    laneKey={key}
                                    subgroupBy={subgroupBy}
                                    count={swimlanes.get(key)!.length}
                                />
                            ))}
                        </div>
                    </div>

                    {/* Right timeline */}
                    <div
                        style={{
                            flex: 1,
                            overflow: "auto",
                            position: "relative",
                        }}
                    >
                        {/* Time axis (weekly cells) */}
                        <div
                            style={{
                                position: "sticky",
                                top: 0,
                                background: tokens.colors.bgPage,
                                borderBottom: `1px solid ${tokens.colors.border}`,
                                height: 36,
                                width: timelineWidth,
                                zIndex: 2,
                            }}
                        >
                            {Array.from({
                                length: Math.ceil(range.days / colDays),
                            }).map((_, idx) => {
                                const day = addDays(range.start, idx * colDays);
                                return (
                                    <div
                                        key={idx}
                                        style={{
                                            position: "absolute",
                                            left: idx * colDays * pxPerDay,
                                            width: colDays * pxPerDay,
                                            height: 36,
                                            display: "flex",
                                            alignItems: "center",
                                            justifyContent: "center",
                                            fontSize: 11,
                                            color: tokens.colors.textMuted,
                                            fontWeight: 500,
                                            borderRight: `1px solid ${tokens.colors.borderSubtle}`,
                                        }}
                                    >
                                        {day.toLocaleDateString("en-US", {
                                            month: "short",
                                            day:
                                                zoom === "month"
                                                    ? undefined
                                                    : "numeric",
                                        })}
                                    </div>
                                );
                            })}
                        </div>

                        {/* Today line */}
                        <TodayLine
                            rangeStart={range.start}
                            height={
                                Array.from(swimlanes.keys()).length * ROW_HEIGHT
                            }
                            pxPerDay={pxPerDay}
                        />

                        {/* Swimlane rows */}
                        <div style={{ width: timelineWidth }}>
                            {Array.from(swimlanes.entries()).map(
                                ([key, laneTasks]) => (
                                    <SwimlaneRow
                                        key={key}
                                        laneKey={key}
                                        tasks={laneTasks}
                                        rangeStart={range.start}
                                        timelineWidth={timelineWidth}
                                        pxPerDay={pxPerDay}
                                    />
                                ),
                            )}
                            {swimlanes.size === 0 && (
                                <div
                                    style={{
                                        padding: tokens.spacing[6],
                                        textAlign: "center",
                                        color: tokens.colors.textMuted,
                                        fontSize: tokens.typography.fontSize.sm,
                                    }}
                                >
                                    No tasks with dates. Use the List view to
                                    set start/due dates.
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </DndContext>
        </>
    );
};

// ─── Swimlane label (left column) ──────────────────────
const SwimlaneLabel = ({
    laneKey,
    subgroupBy,
    count,
}: {
    laneKey: string;
    subgroupBy: SubgroupBy;
    count: number;
}) => {
    let label = laneKey;
    let icon: React.ReactNode = null;

    if (subgroupBy === "assignee") {
        const user: User | undefined =
            laneKey === "unassigned" ? undefined : usersById.get(laneKey);
        label = user ? `${user.firstName} ${user.lastName}` : "Unassigned";
        icon = user ? (
            <Avatar name={label} src={user.avatarUrl} size={20} />
        ) : (
            <Avatar name="?" size={20} />
        );
    } else if (subgroupBy === "priority") {
        const p = Number(laneKey) as Priority;
        label = PRIORITY_LABELS[p];
        icon = <PriorityFlag priority={p} size={12} />;
    } else {
        const tag = tagsById.get(laneKey);
        label = tag?.name ?? "Untagged";
        icon = (
            <span
                style={{
                    width: 8,
                    height: 8,
                    borderRadius: "50%",
                    background: tag?.color ?? tokens.colors.textMuted,
                    display: "inline-block",
                }}
            />
        );
    }

    return (
        <div
            style={{
                height: ROW_HEIGHT,
                padding: "0 12px",
                display: "flex",
                alignItems: "center",
                gap: 8,
                borderBottom: `1px solid ${tokens.colors.borderSubtle}`,
            }}
        >
            {icon}
            <span
                style={{
                    flex: 1,
                    fontSize: tokens.typography.fontSize.sm,
                    color: tokens.colors.textPrimary,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    fontWeight: 500,
                }}
            >
                {label}
            </span>
            <span
                style={{
                    fontSize: 11,
                    color: tokens.colors.textMuted,
                    fontFamily: tokens.typography.fontFamilyMono,
                }}
            >
                {count}
            </span>
        </div>
    );
};

// ─── Swimlane row (a droppable lane with all its bars) ──
const SwimlaneRow = ({
    laneKey,
    tasks,
    rangeStart,
    timelineWidth,
    pxPerDay,
}: {
    laneKey: string;
    tasks: Task[];
    rangeStart: Date;
    timelineWidth: number;
    pxPerDay: number;
}) => {
    const { setNodeRef, isOver } = useDroppable({
        id: `lane:${laneKey}`,
    });

    return (
        <div
            ref={setNodeRef}
            style={{
                position: "relative",
                height: ROW_HEIGHT,
                width: timelineWidth,
                borderBottom: `1px solid ${tokens.colors.borderSubtle}`,
                background: isOver
                    ? tokens.colors.primarySubtle
                    : "transparent",
                transition: "background var(--transition-base)",
            }}
        >
            {tasks.map((task) => (
                <TimelineBar
                    key={task.id}
                    task={task}
                    rangeStart={rangeStart}
                    pxPerDay={pxPerDay}
                />
            ))}
        </div>
    );
};

// ─── Draggable bar ──────────────────────────────────────
const TimelineBar = ({
    task,
    rangeStart,
    pxPerDay,
}: {
    task: Task;
    rangeStart: Date;
    pxPerDay: number;
}) => {
    const [, setSearchParams] = useSearchParams();
    const status = statusesById.get(task.statusId);
    const { attributes, listeners, setNodeRef, transform, isDragging } =
        useDraggable({ id: `tl-bar:${task.id}` });

    const start = task.startDate
        ? new Date(task.startDate)
        : new Date(task.dueDate!);
    const end = task.dueDate
        ? new Date(task.dueDate)
        : addDays(start, 1);
    const left = daysBetween(rangeStart, start) * pxPerDay;
    const duration = Math.max(1, daysBetween(start, end) + 1);
    const width = Math.max(20, duration * pxPerDay - 2);

    const color = status?.color ?? tokens.colors.textMuted;

    return (
        <div
            ref={setNodeRef}
            style={{
                position: "absolute",
                left,
                top: 6,
                width,
                height: ROW_HEIGHT - 12,
                background: color,
                borderRadius: 4,
                cursor: isDragging ? "grabbing" : "grab",
                opacity: isDragging ? 0.6 : 1,
                transform: transform
                    ? `translate3d(${transform.x}px, ${transform.y}px, 0)`
                    : undefined,
                display: "flex",
                alignItems: "center",
                padding: "0 6px",
                overflow: "hidden",
                userSelect: "none",
                zIndex: isDragging ? 5 : 1,
            }}
            {...attributes}
            {...listeners}
            onClick={(e) => {
                e.stopPropagation();
                setSearchParams((prev) => {
                    const next = new URLSearchParams(prev);
                    next.set("task", task.id);
                    return next;
                });
            }}
            title={task.name}
        >
            <span
                style={{
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

// ─── Today vertical line ─────────────────────────────────
const TodayLine = ({
    rangeStart,
    height,
    pxPerDay,
}: {
    rangeStart: Date;
    height: number;
    pxPerDay: number;
}) => {
    const today = startOfDay(new Date());
    const left = daysBetween(rangeStart, today) * pxPerDay;
    if (left < 0) return null;
    return (
        <div
            style={{
                position: "absolute",
                left,
                top: 36,
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

const navBtnStyle: React.CSSProperties = {
    padding: "4px 6px",
    background: "transparent",
    border: 0,
    borderRadius: tokens.radius.sm,
    cursor: "pointer",
    color: tokens.colors.textSecondary,
    display: "inline-flex",
    alignItems: "center",
};
