import { Calendar, AlertCircle } from "lucide-react";
import { tokens } from "../../theme";

interface DueDateBadgeProps {
    dueDate: string | null;
    size?: "sm" | "md";
    showIcon?: boolean;
}

const formatDueDate = (date: Date): string => {
    const now = new Date();
    const today = new Date(now);
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(today.getDate() + 1);
    const yesterday = new Date(today);
    yesterday.setDate(today.getDate() - 1);

    const dateOnly = new Date(date);
    dateOnly.setHours(0, 0, 0, 0);

    if (dateOnly.getTime() === today.getTime()) return "Today";
    if (dateOnly.getTime() === tomorrow.getTime()) return "Tomorrow";
    if (dateOnly.getTime() === yesterday.getTime()) return "Yesterday";

    const diff = Math.round(
        (dateOnly.getTime() - today.getTime()) / (1000 * 60 * 60 * 24),
    );
    if (diff > 0 && diff < 7) {
        return date.toLocaleDateString("en-US", { weekday: "short" });
    }
    return date.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
    });
};

export const DueDateBadge = ({
    dueDate,
    size = "sm",
    showIcon = true,
}: DueDateBadgeProps) => {
    if (!dueDate) {
        return (
            <span
                style={{
                    fontSize: tokens.typography.fontSize.xs,
                    color: tokens.colors.textMuted,
                }}
            >
                —
            </span>
        );
    }

    const date = new Date(dueDate);
    const now = new Date();
    const isOverdue = date < now && date.toDateString() !== now.toDateString();
    const isToday = date.toDateString() === now.toDateString();

    let color: string;
    let bg: string;
    if (isOverdue) {
        color = tokens.colors.danger;
        bg = tokens.colors.dangerSubtle;
    } else if (isToday) {
        color = tokens.colors.warning;
        bg = tokens.colors.warningSubtle;
    } else {
        color = tokens.colors.textSecondary;
        bg = "transparent";
    }

    const fontSize = size === "sm" ? 11 : tokens.typography.fontSize.sm;
    const iconSize = size === "sm" ? 11 : 13;

    return (
        <span
            style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                padding: bg === "transparent" ? 0 : "2px 6px",
                borderRadius: tokens.radius.sm,
                background: bg,
                color,
                fontSize,
                fontWeight: 500,
                whiteSpace: "nowrap",
            }}
        >
            {showIcon &&
                (isOverdue ? (
                    <AlertCircle size={iconSize} strokeWidth={2} />
                ) : (
                    <Calendar size={iconSize} strokeWidth={1.75} />
                ))}
            {formatDueDate(date)}
        </span>
    );
};
