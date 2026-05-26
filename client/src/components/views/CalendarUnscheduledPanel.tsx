import { useDraggable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { useSearchParams } from "react-router-dom";
import { GripVertical, CalendarPlus } from "lucide-react";
import type { Status, Task } from "../../types";
import { PriorityFlag } from "../ui/PriorityFlag";
import { EmptyState } from "../ui/EmptyState";
import { tokens } from "../../theme";

interface CalendarUnscheduledPanelProps {
    tasks: Task[];
    statusMap: Map<string, Status>;
}

export const CalendarUnscheduledPanel = ({
    tasks,
    statusMap,
}: CalendarUnscheduledPanelProps) => (
    <aside
        style={{
            width: 280,
            background: tokens.colors.bgSurface,
            border: `1px solid ${tokens.colors.border}`,
            borderRadius: tokens.radius.lg,
            display: "flex",
            flexDirection: "column",
            flexShrink: 0,
            overflow: "hidden",
        }}
    >
        <div
            style={{
                padding: `${tokens.spacing[3]}px ${tokens.spacing[4]}px`,
                borderBottom: `1px solid ${tokens.colors.borderSubtle}`,
            }}
        >
            <div
                style={{
                    fontSize: 11,
                    fontWeight: 600,
                    textTransform: "uppercase",
                    letterSpacing: "0.05em",
                    color: tokens.colors.textMuted,
                    marginBottom: 2,
                }}
            >
                Unscheduled
            </div>
            <div
                style={{
                    fontSize: 12,
                    color: tokens.colors.textSecondary,
                }}
            >
                {tasks.length} task{tasks.length === 1 ? "" : "s"} without dates
                · drag to schedule
            </div>
        </div>

        <div
            style={{
                flex: 1,
                overflowY: "auto",
                padding: tokens.spacing[2],
                display: "flex",
                flexDirection: "column",
                gap: 4,
            }}
        >
            {tasks.length === 0 ? (
                <EmptyState
                    icon={CalendarPlus}
                    title="All scheduled"
                    description="Every task has a date."
                    compact
                />
            ) : (
                tasks.map((task) => (
                    <UnscheduledRow
                        key={task.id}
                        task={task}
                        status={statusMap.get(task.statusId)}
                    />
                ))
            )}
        </div>
    </aside>
);

interface UnscheduledRowProps {
    task: Task;
    status: Status | undefined;
}

const UnscheduledRow = ({ task, status }: UnscheduledRowProps) => {
    const [, setSearchParams] = useSearchParams();
    const { attributes, listeners, setNodeRef, transform, isDragging } =
        useDraggable({
            id: `event:${task.id}`,
            data: { type: "event", taskId: task.id },
        });

    return (
        <div
            ref={setNodeRef}
            style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                padding: "6px 8px",
                background: tokens.colors.bgSurface,
                border: `1px solid ${tokens.colors.borderSubtle}`,
                borderLeft: `3px solid ${status?.color ?? tokens.colors.border}`,
                borderRadius: tokens.radius.sm,
                cursor: isDragging ? "grabbing" : "grab",
                opacity: isDragging ? 0.4 : 1,
                transform: CSS.Translate.toString(transform),
                userSelect: "none",
                transition: "background var(--transition-base)",
            }}
            {...attributes}
            {...listeners}
            onClick={() =>
                setSearchParams((prev) => {
                    const next = new URLSearchParams(prev);
                    next.set("task", task.id);
                    return next;
                })
            }
            onMouseEnter={(e) =>
                (e.currentTarget.style.background = tokens.colors.bgHover)
            }
            onMouseLeave={(e) =>
                (e.currentTarget.style.background = tokens.colors.bgSurface)
            }
        >
            <GripVertical
                size={12}
                strokeWidth={1.5}
                color={tokens.colors.textMuted}
            />
            <PriorityFlag priority={task.priority} size={11} />
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
                {task.name}
            </span>
        </div>
    );
};
