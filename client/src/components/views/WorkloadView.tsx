import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
    DndContext,
    PointerSensor,
    useDraggable,
    useDroppable,
    useSensor,
    useSensors,
    type DragEndEvent,
} from "@dnd-kit/core";
import { Button, Popover, Input, InputNumber } from "antd";
import {
    Search,
    UserCheck,
    Eye,
    EyeOff,
    Settings2,
    Clock,
    Hash,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { mockApi } from "../../lib/mock-api";
import { useAuthStore } from "../../stores/auth";
import { useUpdateTask } from "../../hooks/useTaskMutations";
import { statusesById } from "../../mocks/statuses";
import { usersById } from "../../mocks/users";
import {
    addDays,
    dayKey,
    isSameDay,
    startOfDay,
} from "../../lib/date-utils";
import { Avatar } from "../ui/Avatar";
import { PriorityFlag } from "../ui/PriorityFlag";
import { StatusPill } from "../ui/StatusPill";
import { tokens } from "../../theme";
import type { Task, User } from "../../types";

interface WorkloadViewProps {
    listId: string;
}

type Period = "day" | "week";
type EffortUnit = "task_count" | "time_estimate";

const ROW_HEIGHT = 56;
const COL_DAY = 96;
const COL_WEEK = 130;
const LEFT_WIDTH = 220;

export const WorkloadView = ({ listId }: WorkloadViewProps) => {
    const user = useAuthStore((s) => s.user);
    const navigate = useNavigate();
    const [period, setPeriod] = useState<Period>("day");
    const [effortUnit, setEffortUnit] = useState<EffortUnit>("task_count");
    const [search, setSearch] = useState("");
    const [meMode, setMeMode] = useState(false);
    const [showClosedTasks, setShowClosedTasks] = useState(false);
    const [defaultCapacity, setDefaultCapacity] = useState(8); // hours/day or tasks/day
    const [viewStart] = useState(() => startOfDay(new Date()));

    const update = useUpdateTask(listId);

    const { data: tasks = [] } = useQuery({
        queryKey: ["tasks-by-list", listId],
        queryFn: () => mockApi.tasks.listByList(listId),
    });

    const filtered = useMemo(() => {
        let r = tasks.filter((t) => t.assignees.length > 0);
        if (!showClosedTasks) {
            r = r.filter((t) => {
                const s = statusesById.get(t.statusId);
                return s?.statusGroup !== "closed";
            });
        }
        if (meMode && user) r = r.filter((t) => t.assignees.includes(user.id));
        if (search.trim()) {
            const q = search.toLowerCase();
            r = r.filter((t) => t.name.toLowerCase().includes(q));
        }
        return r;
    }, [tasks, showClosedTasks, meMode, search, user]);

    // Unique users with tasks
    const userIds = useMemo(
        () => Array.from(new Set(filtered.flatMap((t) => t.assignees))),
        [filtered],
    );
    const usersInView = userIds
        .map((id) => usersById.get(id))
        .filter((u): u is User => !!u)
        .sort((a, b) =>
            `${a.firstName} ${a.lastName}`.localeCompare(
                `${b.firstName} ${b.lastName}`,
            ),
        );

    // Time buckets
    const buckets = useMemo(() => {
        const result: { date: Date; label: string; sublabel: string }[] = [];
        if (period === "day") {
            for (let i = 0; i < 14; i++) {
                const d = addDays(viewStart, i);
                result.push({
                    date: d,
                    label: d.toLocaleDateString("en-US", { weekday: "short" }),
                    sublabel: String(d.getDate()),
                });
            }
        } else {
            for (let i = 0; i < 8; i++) {
                const d = addDays(viewStart, i * 7);
                result.push({
                    date: d,
                    label: d.toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                    }),
                    sublabel: `Wk ${getWeekNumber(d)}`,
                });
            }
        }
        return result;
    }, [period, viewStart]);

    // Build cell map: `${userId}:${bucketKey}` → tasks
    const cellMap = useMemo(() => {
        const m = new Map<string, Task[]>();
        for (const t of filtered) {
            const day = t.dueDate ?? t.startDate;
            if (!day) continue;
            const taskDate = new Date(day);
            for (const uid of t.assignees) {
                for (const bucket of buckets) {
                    const inBucket =
                        period === "day"
                            ? isSameDay(taskDate, bucket.date)
                            : taskDate >= bucket.date &&
                              taskDate < addDays(bucket.date, 7);
                    if (inBucket) {
                        const key = `${uid}:${dayKey(bucket.date)}`;
                        const arr = m.get(key) ?? [];
                        arr.push(t);
                        m.set(key, arr);
                    }
                }
            }
        }
        return m;
    }, [filtered, buckets, period]);

    const sensors = useSensors(
        useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    );

    const handleDragEnd = (event: DragEndEvent) => {
        const { active, over } = event;
        if (!over) return;
        const taskId = String(active.id).replace(/^wl-task:/, "");
        const overId = String(over.id);
        if (!overId.startsWith("wl-cell:")) return;

        const [, , targetUserId] = overId.split(":");
        const task = tasks.find((t) => t.id === taskId);
        if (!task) return;
        if (!task.assignees.includes(targetUserId)) {
            update.mutate({
                id: task.id,
                patch: { assignees: [targetUserId] },
            });
        }
    };

    const colWidth = period === "day" ? COL_DAY : COL_WEEK;
    const periodLabel = period === "day" ? "days" : "weeks";

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
                {/* Period toggle */}
                <div
                    style={{
                        display: "inline-flex",
                        background: tokens.colors.bgMuted,
                        borderRadius: tokens.radius.md,
                        padding: 2,
                    }}
                >
                    {(["day", "week"] as Period[]).map((p) => (
                        <button
                            key={p}
                            onClick={() => setPeriod(p)}
                            style={toggleBtnStyle(period === p)}
                        >
                            {p === "day" ? "By Day" : "By Week"}
                        </button>
                    ))}
                </div>

                {/* Effort unit toggle */}
                <div
                    style={{
                        display: "inline-flex",
                        background: tokens.colors.bgMuted,
                        borderRadius: tokens.radius.md,
                        padding: 2,
                    }}
                >
                    <button
                        onClick={() => setEffortUnit("task_count")}
                        title="Count of tasks"
                        style={toggleBtnStyle(effortUnit === "task_count")}
                    >
                        <Hash size={12} strokeWidth={1.75} /> Tasks
                    </button>
                    <button
                        onClick={() => setEffortUnit("time_estimate")}
                        title="Sum of time estimates"
                        style={toggleBtnStyle(effortUnit === "time_estimate")}
                    >
                        <Clock size={12} strokeWidth={1.75} /> Hours
                    </button>
                </div>

                <Popover
                    trigger={["click"]}
                    placement="bottom"
                    content={
                        <div style={{ width: 240 }}>
                            <div
                                style={{
                                    fontSize: 12,
                                    color: tokens.colors.textSecondary,
                                    marginBottom: 6,
                                }}
                            >
                                Default capacity per {period}
                            </div>
                            <InputNumber
                                value={defaultCapacity}
                                min={1}
                                max={50}
                                onChange={(v) => v && setDefaultCapacity(v)}
                                style={{ width: "100%" }}
                                addonAfter={
                                    effortUnit === "task_count" ? "tasks" : "hrs"
                                }
                            />
                        </div>
                    }
                >
                    <Button
                        type="text"
                        size="small"
                        icon={<Settings2 size={13} strokeWidth={1.75} />}
                    >
                        Capacity: {defaultCapacity}/{period}
                    </Button>
                </Popover>

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
                    onClick={() => setShowClosedTasks(!showClosedTasks)}
                >
                    {showClosedTasks ? "Hide closed" : "Show closed"}
                </Button>

                <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
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

            <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
                <div
                    style={{
                        flex: 1,
                        overflow: "auto",
                        margin: tokens.spacing[5],
                        marginTop: tokens.spacing[3],
                        background: tokens.colors.bgSurface,
                        border: `1px solid ${tokens.colors.border}`,
                        borderRadius: tokens.radius.lg,
                    }}
                >
                    <table
                        style={{
                            borderCollapse: "separate",
                            borderSpacing: 0,
                            tableLayout: "fixed",
                            width: LEFT_WIDTH + buckets.length * colWidth,
                        }}
                    >
                        <thead>
                            <tr>
                                <th
                                    style={{
                                        position: "sticky",
                                        left: 0,
                                        top: 0,
                                        background: tokens.colors.bgPage,
                                        zIndex: 4,
                                        width: LEFT_WIDTH,
                                        padding: "10px 12px",
                                        textAlign: "left",
                                        fontSize: 11,
                                        fontWeight: 600,
                                        color: tokens.colors.textMuted,
                                        textTransform: "uppercase",
                                        letterSpacing: "0.05em",
                                        borderBottom: `1px solid ${tokens.colors.border}`,
                                        borderRight: `1px solid ${tokens.colors.borderSubtle}`,
                                    }}
                                >
                                    Team Member
                                </th>
                                {buckets.map((b) => (
                                    <th
                                        key={dayKey(b.date)}
                                        style={{
                                            position: "sticky",
                                            top: 0,
                                            background: tokens.colors.bgPage,
                                            zIndex: 3,
                                            width: colWidth,
                                            padding: "8px 6px",
                                            textAlign: "center",
                                            fontSize: 10,
                                            fontWeight: 600,
                                            color: tokens.colors.textMuted,
                                            borderBottom: `1px solid ${tokens.colors.border}`,
                                            borderRight: `1px solid ${tokens.colors.borderSubtle}`,
                                        }}
                                    >
                                        <div
                                            style={{
                                                textTransform: "uppercase",
                                                letterSpacing: "0.05em",
                                            }}
                                        >
                                            {b.label}
                                        </div>
                                        <div
                                            style={{
                                                fontSize: 12,
                                                fontWeight: 600,
                                                color: tokens.colors.textPrimary,
                                                fontFamily:
                                                    tokens.typography
                                                        .fontFamilyMono,
                                                marginTop: 2,
                                            }}
                                        >
                                            {b.sublabel}
                                        </div>
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {usersInView.length === 0 ? (
                                <tr>
                                    <td
                                        colSpan={buckets.length + 1}
                                        style={{
                                            padding: tokens.spacing[8],
                                            textAlign: "center",
                                            color: tokens.colors.textMuted,
                                        }}
                                    >
                                        No assignees match your filters.
                                    </td>
                                </tr>
                            ) : (
                                usersInView.map((u) => (
                                    <UserWorkloadRow
                                        key={u.id}
                                        user={u}
                                        buckets={buckets}
                                        cellMap={cellMap}
                                        effortUnit={effortUnit}
                                        capacity={defaultCapacity}
                                        colWidth={colWidth}
                                        onTaskClick={(taskId) =>
                                            navigate(`/t/${taskId}`)
                                        }
                                    />
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </DndContext>
        </>
    );
};

// ─────────────────────────────────────────────────────────
// User row with droppable cells
// ─────────────────────────────────────────────────────────
const UserWorkloadRow = ({
    user,
    buckets,
    cellMap,
    effortUnit,
    capacity,
    colWidth,
    onTaskClick,
}: {
    user: User;
    buckets: { date: Date; label: string; sublabel: string }[];
    cellMap: Map<string, Task[]>;
    effortUnit: EffortUnit;
    capacity: number;
    colWidth: number;
    onTaskClick: (taskId: string) => void;
}) => {
    return (
        <tr>
            <td
                style={{
                    position: "sticky",
                    left: 0,
                    background: tokens.colors.bgSurface,
                    width: LEFT_WIDTH,
                    padding: "10px 12px",
                    borderBottom: `1px solid ${tokens.colors.borderSubtle}`,
                    borderRight: `1px solid ${tokens.colors.borderSubtle}`,
                    zIndex: 2,
                    height: ROW_HEIGHT,
                }}
            >
                <div
                    style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                    }}
                >
                    <Avatar
                        name={`${user.firstName} ${user.lastName}`}
                        src={user.avatarUrl}
                        size={28}
                    />
                    <div style={{ minWidth: 0 }}>
                        <div
                            style={{
                                fontSize: tokens.typography.fontSize.sm,
                                fontWeight: 600,
                                color: tokens.colors.textPrimary,
                                whiteSpace: "nowrap",
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                            }}
                        >
                            {user.firstName} {user.lastName}
                        </div>
                        <div
                            style={{
                                fontSize: 11,
                                color: tokens.colors.textMuted,
                                textTransform: "capitalize",
                            }}
                        >
                            {user.role}
                        </div>
                    </div>
                </div>
            </td>
            {buckets.map((b) => (
                <WorkloadCell
                    key={dayKey(b.date)}
                    userId={user.id}
                    date={b.date}
                    tasks={cellMap.get(`${user.id}:${dayKey(b.date)}`) ?? []}
                    effortUnit={effortUnit}
                    capacity={capacity}
                    width={colWidth}
                    onTaskClick={onTaskClick}
                />
            ))}
        </tr>
    );
};

// ─────────────────────────────────────────────────────────
// Single cell (droppable)
// ─────────────────────────────────────────────────────────
const WorkloadCell = ({
    userId,
    date,
    tasks,
    effortUnit,
    capacity,
    width,
    onTaskClick,
}: {
    userId: string;
    date: Date;
    tasks: Task[];
    effortUnit: EffortUnit;
    capacity: number;
    width: number;
    onTaskClick: (taskId: string) => void;
}) => {
    const cellId = `wl-cell:${dayKey(date)}:${userId}`;
    const { setNodeRef, isOver } = useDroppable({ id: cellId });

    const value =
        effortUnit === "task_count"
            ? tasks.length
            : tasks.reduce(
                  (acc, t) => acc + (t.timeEstimateSeconds ?? 0) / 3600,
                  0,
              );

    const percent = capacity > 0 ? (value / capacity) * 100 : 0;

    let bg = "transparent";
    let textColor = tokens.colors.textPrimary;
    if (value > 0) {
        if (percent <= 80) {
            bg = tokens.colors.successSubtle;
            textColor = tokens.colors.success;
        } else if (percent <= 100) {
            bg = tokens.colors.warningSubtle;
            textColor = tokens.colors.warning;
        } else {
            bg = "#FEF2F2";
            textColor = tokens.colors.danger;
        }
    }

    return (
        <td
            ref={setNodeRef}
            style={{
                width,
                height: ROW_HEIGHT,
                padding: 4,
                borderBottom: `1px solid ${tokens.colors.borderSubtle}`,
                borderRight: `1px solid ${tokens.colors.borderSubtle}`,
                background: isOver ? tokens.colors.primarySubtle : bg,
                textAlign: "center",
                verticalAlign: "middle",
                position: "relative",
                transition: "background var(--transition-base)",
            }}
        >
            {value > 0 ? (
                <Popover
                    trigger={["click"]}
                    placement="bottom"
                    content={
                        <CellPopover
                            tasks={tasks}
                            onTaskClick={onTaskClick}
                        />
                    }
                    overlayInnerStyle={{ padding: 0 }}
                >
                    <div
                        style={{
                            cursor: "pointer",
                            padding: 4,
                            borderRadius: tokens.radius.sm,
                        }}
                    >
                        <div
                            style={{
                                fontSize: 16,
                                fontWeight: 700,
                                color: textColor,
                                fontFamily: tokens.typography.fontFamilyMono,
                                lineHeight: 1,
                            }}
                        >
                            {effortUnit === "task_count"
                                ? value
                                : `${value.toFixed(1)}h`}
                        </div>
                        <div
                            style={{
                                fontSize: 10,
                                color: textColor,
                                opacity: 0.7,
                                marginTop: 2,
                            }}
                        >
                            {Math.round(percent)}%
                        </div>
                    </div>
                </Popover>
            ) : (
                <span
                    style={{
                        fontSize: 11,
                        color: tokens.colors.textMuted,
                    }}
                >
                    —
                </span>
            )}
            {tasks.slice(0, 0).map((t) => (
                <DraggableMicroTask key={t.id} task={t} />
            ))}
        </td>
    );
};

// Hidden draggable handle (kept for future drag-task-to-reassign)
const DraggableMicroTask = ({ task }: { task: Task }) => {
    const { setNodeRef, listeners, attributes } = useDraggable({
        id: `wl-task:${task.id}`,
    });
    return <span ref={setNodeRef} {...listeners} {...attributes} />;
};

// ─────────────────────────────────────────────────────────
// Cell click popover — shows tasks
// ─────────────────────────────────────────────────────────
const CellPopover = ({
    tasks,
    onTaskClick,
}: {
    tasks: Task[];
    onTaskClick: (id: string) => void;
}) => (
    <div style={{ width: 320, padding: 8 }}>
        <div
            style={{
                fontSize: 11,
                fontWeight: 600,
                color: tokens.colors.textMuted,
                textTransform: "uppercase",
                letterSpacing: "0.05em",
                padding: "4px 8px 8px",
                borderBottom: `1px solid ${tokens.colors.borderSubtle}`,
                marginBottom: 4,
            }}
        >
            {tasks.length} task{tasks.length === 1 ? "" : "s"}
        </div>
        <div
            style={{
                maxHeight: 280,
                overflowY: "auto",
                display: "flex",
                flexDirection: "column",
                gap: 2,
            }}
        >
            {tasks.map((t) => {
                const status = statusesById.get(t.statusId);
                return (
                    <button
                        key={t.id}
                        onClick={() => onTaskClick(t.customId ?? t.id)}
                        style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 6,
                            padding: "6px 8px",
                            background: "none",
                            border: 0,
                            cursor: "pointer",
                            textAlign: "left",
                            width: "100%",
                            borderRadius: tokens.radius.sm,
                        }}
                        onMouseEnter={(e) =>
                            (e.currentTarget.style.background =
                                tokens.colors.bgHover)
                        }
                        onMouseLeave={(e) =>
                            (e.currentTarget.style.background = "transparent")
                        }
                    >
                        <PriorityFlag priority={t.priority} size={11} />
                        <span
                            style={{
                                flex: 1,
                                fontSize: tokens.typography.fontSize.sm,
                                color: tokens.colors.textPrimary,
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                whiteSpace: "nowrap",
                            }}
                        >
                            {t.name}
                        </span>
                        {status && (
                            <StatusPill
                                status={status}
                                variant="dot"
                                size="sm"
                            />
                        )}
                    </button>
                );
            })}
        </div>
    </div>
);

const toggleBtnStyle = (active: boolean): React.CSSProperties => ({
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    padding: "4px 10px",
    background: active ? tokens.colors.bgSurface : "transparent",
    border: 0,
    borderRadius: tokens.radius.sm,
    cursor: "pointer",
    fontSize: tokens.typography.fontSize.sm,
    fontWeight: active ? 600 : 500,
    color: active ? tokens.colors.textPrimary : tokens.colors.textSecondary,
    boxShadow: active ? tokens.shadows.sm : "none",
    transition: "all var(--transition-base)",
});

const getWeekNumber = (date: Date): number => {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() + 4 - (d.getDay() || 7));
    const yearStart = new Date(d.getFullYear(), 0, 1);
    return Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
};
