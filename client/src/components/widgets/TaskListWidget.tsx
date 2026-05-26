import { Link } from "react-router-dom";
import dayjs from "dayjs";
import { AlertTriangle, ArrowUp, Minus, ChevronUp, ChevronDown } from "lucide-react";
import { listTasksForWidget } from "./widget-data";
import { statusesById } from "../../mocks/statuses";
import { listsById } from "../../mocks/lists";
import { usersById } from "../../mocks/users";
import { tokens } from "../../theme";
import type { DashboardWidget } from "../../types/dashboard";
import type { Priority } from "../../types";

interface Props {
    widget: DashboardWidget;
}

const PRIORITY_ICONS: Record<Priority, { icon: React.ReactNode; color: string }> = {
    0: { icon: <Minus size={11} strokeWidth={2} />, color: "#94A3B8" },
    1: { icon: <AlertTriangle size={11} strokeWidth={2} />, color: "#E11D48" },
    2: { icon: <ChevronUp size={11} strokeWidth={2} />, color: "#F59E0B" },
    3: { icon: <ArrowUp size={11} strokeWidth={2} />, color: "#4F46E5" },
    4: { icon: <ChevronDown size={11} strokeWidth={2} />, color: "#10B981" },
};

export const TaskListWidget = ({ widget }: Props) => {
    const tasks = listTasksForWidget(widget.config);

    if (tasks.length === 0) {
        return (
            <div
                style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    height: "100%",
                    color: tokens.colors.textMuted,
                    fontStyle: "italic",
                    fontSize: 12,
                }}
            >
                No matching tasks
            </div>
        );
    }

    return (
        <div
            style={{
                display: "flex",
                flexDirection: "column",
                gap: 4,
                overflow: "auto",
            }}
        >
            {tasks.map((t) => {
                const status = statusesById.get(t.statusId);
                const list = listsById.get(t.primaryListId);
                const overdue =
                    t.dueDate && !t.completedAt && dayjs(t.dueDate).isBefore(dayjs(), "day");
                const priority = PRIORITY_ICONS[t.priority];
                const firstAssignee = t.assignees[0]
                    ? usersById.get(t.assignees[0])
                    : null;
                return (
                    <Link
                        key={t.id}
                        to={`/t/${t.id}`}
                        style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 8,
                            padding: "6px 8px",
                            borderRadius: tokens.radius.sm,
                            textDecoration: "none",
                            transition: "background var(--transition-fast)",
                            color: "inherit",
                        }}
                        onMouseEnter={(e) =>
                            (e.currentTarget.style.background =
                                tokens.colors.bgHover)
                        }
                        onMouseLeave={(e) =>
                            (e.currentTarget.style.background = "transparent")
                        }
                    >
                        <span style={{ color: priority.color, display: "inline-flex" }}>
                            {priority.icon}
                        </span>
                        <span
                            style={{
                                width: 8,
                                height: 8,
                                borderRadius: "50%",
                                background: status?.color ?? "#94A3B8",
                                flexShrink: 0,
                            }}
                        />
                        <span
                            style={{
                                flex: 1,
                                fontSize: 13,
                                color: tokens.colors.textPrimary,
                                fontWeight: 500,
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                whiteSpace: "nowrap",
                            }}
                        >
                            {t.name}
                        </span>
                        <span
                            style={{
                                fontSize: 10,
                                color: tokens.colors.textMuted,
                                fontFamily: tokens.typography.fontFamilyMono,
                                flexShrink: 0,
                            }}
                        >
                            {list?.name}
                        </span>
                        {t.dueDate && (
                            <span
                                style={{
                                    fontSize: 11,
                                    color: overdue
                                        ? tokens.colors.danger
                                        : tokens.colors.textMuted,
                                    fontWeight: overdue ? 600 : 500,
                                    fontFamily:
                                        tokens.typography.fontFamilyMono,
                                    flexShrink: 0,
                                }}
                            >
                                {dayjs(t.dueDate).format("MMM D")}
                            </span>
                        )}
                        {firstAssignee && (
                            <span
                                style={{
                                    width: 20,
                                    height: 20,
                                    borderRadius: "50%",
                                    background: tokens.colors.primarySubtle,
                                    color: tokens.colors.primary,
                                    display: "inline-flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    fontSize: 9,
                                    fontWeight: 700,
                                    flexShrink: 0,
                                }}
                            >
                                {firstAssignee.firstName.charAt(0)}
                                {firstAssignee.lastName.charAt(0)}
                            </span>
                        )}
                    </Link>
                );
            })}
        </div>
    );
};
