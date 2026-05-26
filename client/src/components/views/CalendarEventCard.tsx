import { useDraggable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { useSearchParams } from "react-router-dom";
import type { Status, Task } from "../../types";
import { tokens } from "../../theme";

interface CalendarEventCardProps {
    task: Task;
    status: Status | undefined;
    compact?: boolean;
}

export const CalendarEventCard = ({
    task,
    status,
    compact = true,
}: CalendarEventCardProps) => {
    const [, setSearchParams] = useSearchParams();
    const { attributes, listeners, setNodeRef, transform, isDragging } =
        useDraggable({
            id: `event:${task.id}`,
            data: { type: "event", taskId: task.id },
        });

    const style: React.CSSProperties = {
        transform: CSS.Translate.toString(transform),
        opacity: isDragging ? 0.4 : 1,
        background: status ? `${status.color}1A` : tokens.colors.bgMuted,
        color: status ? status.color : tokens.colors.textSecondary,
        borderLeft: `3px solid ${status ? status.color : tokens.colors.border}`,
        padding: compact ? "1px 4px" : "3px 6px",
        borderRadius: 3,
        fontSize: 11,
        fontWeight: 500,
        cursor: isDragging ? "grabbing" : "grab",
        display: "block",
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
        userSelect: "none",
    };

    return (
        <div
            ref={setNodeRef}
            style={style}
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
            {task.name}
        </div>
    );
};
