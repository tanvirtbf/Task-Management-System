import { ListChecks, MessageSquare, Paperclip, Trash2 } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { AssigneeStack } from "../ui/AssigneeStack";
import { DueDateBadge } from "../ui/DueDateBadge";
import { PriorityFlag } from "../ui/PriorityFlag";
import { StatusPill } from "../ui/StatusPill";
import type { Status, Task, User } from "../../types";
import { useUserMap, useStatusMap } from "../../hooks/useReferenceData";
import { tokens } from "../../theme";

interface TaskRowProps {
    task: Task;
    /** Show status pill. */
    showStatus?: boolean;
    /** Show priority flag. */
    showPriority?: boolean;
    /** Show due date badge. */
    showDueDate?: boolean;
    /** Show assignee stack. */
    showAssignees?: boolean;
    /** Show comments/attachments counts. */
    showMeta?: boolean;
    /** Click handler — defaults to navigating to task. */
    onClick?: () => void;
    /** Density. */
    density?: "compact" | "comfortable";
}

export const TaskRow = ({
    task,
    showStatus = true,
    showPriority = true,
    showDueDate = true,
    showAssignees = true,
    showMeta = true,
    onClick,
    density = "compact",
}: TaskRowProps) => {
    const navigate = useNavigate();
    const userMap = useUserMap();
    const statusMap = useStatusMap(task.primaryListId);
    const status = statusMap.get(task.statusId) as Status | undefined;
    const assignees = task.assignees
        .map((id) => userMap.get(id))
        .filter((u): u is User => !!u);

    const handleClick = () => {
        if (onClick) onClick();
        else navigate(`/t/${task.customId ?? task.id}`);
    };

    const padY = density === "compact" ? 6 : 10;

    return (
        <div
            role="button"
            tabIndex={0}
            aria-label={`Open task: ${task.name}`}
            onClick={handleClick}
            onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    handleClick();
                }
            }}
            style={{
                display: "flex",
                alignItems: "center",
                gap: tokens.spacing[3],
                padding: `${padY}px ${tokens.spacing[3]}px`,
                borderRadius: tokens.radius.md,
                cursor: "pointer",
                transition: "background var(--transition-base)",
                border: "1px solid transparent",
            }}
            onMouseEnter={(e) => {
                e.currentTarget.style.background = tokens.colors.bgHover;
            }}
            onMouseLeave={(e) => {
                e.currentTarget.style.background = "transparent";
            }}
        >
            {showPriority && (
                <PriorityFlag priority={task.priority} size={13} />
            )}

            <div
                style={{
                    flex: 1,
                    minWidth: 0,
                    display: "flex",
                    flexDirection: "column",
                    gap: 2,
                }}
            >
                <div
                    style={{
                        fontSize: tokens.typography.fontSize.sm,
                        fontWeight: 500,
                        color: tokens.colors.textPrimary,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                    }}
                >
                    {task.name}
                </div>
                {showMeta &&
                    (task.commentsCount > 0 ||
                        task.attachmentsCount > 0 ||
                        task.checklistItemsTotal > 0) && (
                        <div
                            style={{
                                display: "flex",
                                gap: 8,
                                fontSize: 11,
                                color: tokens.colors.textMuted,
                            }}
                        >
                            {/* upgrades/023 — waiting on an admin's decision. */}
                            {task.deleteRequestPending && (
                                <span
                                    title="Permanent delete requested — waiting for an admin"
                                    style={{
                                        display: "inline-flex",
                                        alignItems: "center",
                                        gap: 3,
                                        color: tokens.colors.danger,
                                    }}
                                >
                                    <Trash2 size={11} strokeWidth={2} />
                                    delete pending
                                </span>
                            )}
                            {task.checklistItemsTotal > 0 && (
                                <span
                                    title="Checklist items done"
                                    style={{
                                        display: "inline-flex",
                                        alignItems: "center",
                                        gap: 3,
                                        color:
                                            task.checklistItemsDone ===
                                            task.checklistItemsTotal
                                                ? tokens.colors.success
                                                : undefined,
                                    }}
                                >
                                    <ListChecks
                                        size={11}
                                        strokeWidth={1.75}
                                    />
                                    {task.checklistItemsDone}/
                                    {task.checklistItemsTotal}
                                </span>
                            )}
                            {task.commentsCount > 0 && (
                                <span
                                    style={{
                                        display: "inline-flex",
                                        alignItems: "center",
                                        gap: 3,
                                    }}
                                >
                                    <MessageSquare size={11} strokeWidth={1.75} />
                                    {task.commentsCount}
                                </span>
                            )}
                            {task.attachmentsCount > 0 && (
                                <span
                                    style={{
                                        display: "inline-flex",
                                        alignItems: "center",
                                        gap: 3,
                                    }}
                                >
                                    <Paperclip size={11} strokeWidth={1.75} />
                                    {task.attachmentsCount}
                                </span>
                            )}
                        </div>
                    )}
            </div>

            {showStatus && status && (
                <StatusPill status={status} variant="subtle" size="sm" />
            )}
            {showDueDate && task.dueDate && (
                <DueDateBadge dueDate={task.dueDate} size="sm" />
            )}
            {showAssignees && (
                <AssigneeStack users={assignees} size={20} max={3} />
            )}
        </div>
    );
};
