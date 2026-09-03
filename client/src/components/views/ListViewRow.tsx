import { Checkbox, Dropdown } from "antd";
import {
    GripVertical,
    ListChecks,
    MessageSquare,
    Paperclip,
    MoreHorizontal,
    Copy,
    Archive,
    Trash2,
    ExternalLink,
} from "lucide-react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useNavigate, useSearchParams } from "react-router-dom";
import type { Task } from "../../types";
import { InlineNameEdit } from "../task/InlineNameEdit";
import { InlineStatusEdit } from "../task/InlineStatusEdit";
import { InlinePriorityEdit } from "../task/InlinePriorityEdit";
import { InlineAssigneeEdit } from "../task/InlineAssigneeEdit";
import { InlineDateEdit } from "../task/InlineDateEdit";
import { useTaskMembership, useUpdateTask } from "../../hooks/useTaskMutations";
import { tokens } from "../../theme";

interface ListViewRowProps {
    task: Task;
    listId: string;
    isSelected: boolean;
    onSelectToggle: (
        id: string,
        opts: { shift: boolean; ctrl: boolean },
    ) => void;
    onArchive: () => void;
    onDelete: () => void;
}

export const ListViewRow = ({
    task,
    listId,
    isSelected,
    onSelectToggle,
    onArchive,
    onDelete,
}: ListViewRowProps) => {
    const navigate = useNavigate();
    const [, setSearchParams] = useSearchParams();
    const update = useUpdateTask(listId);
    // Assignees are NOT a patchable field: the API answers a PATCH carrying
    // them with "assignees are managed via POST /tasks/:id/assignees and
    // DELETE /tasks/:id/assignees/:userId". This row sent the patch anyway,
    // so changing an assignee from the list view has never worked — it just
    // showed that sentence as a toast. setAssignees diffs the list and calls
    // the two real endpoints, exactly as the task drawer does.
    const { setAssignees } = useTaskMembership(task);

    const {
        attributes,
        listeners,
        setNodeRef,
        transform,
        transition,
        isDragging,
    } = useSortable({ id: task.id });

    const style = {
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.5 : 1,
    };

    const openDetail = () => {
        setSearchParams((prev) => {
            const next = new URLSearchParams(prev);
            next.set("task", task.id);
            return next;
        });
    };

    const menuItems = [
        {
            key: "open",
            label: "Open in new tab",
            icon: <ExternalLink size={13} strokeWidth={1.75} />,
            onClick: () => navigate(`/t/${task.customId ?? task.id}`),
        },
        {
            key: "duplicate",
            label: "Duplicate",
            icon: <Copy size={13} strokeWidth={1.75} />,
        },
        {
            key: "archive",
            label: "Archive",
            icon: <Archive size={13} strokeWidth={1.75} />,
            onClick: onArchive,
        },
        { type: "divider" as const },
        {
            key: "delete",
            label: "Delete",
            icon: <Trash2 size={13} strokeWidth={1.75} />,
            danger: true,
            onClick: onDelete,
        },
    ];

    return (
        <div
            ref={setNodeRef}
            style={{
                ...style,
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "0 12px 0 8px",
                height: 38,
                background: isSelected
                    ? tokens.colors.primarySubtle
                    : tokens.colors.bgSurface,
                borderTop: `1px solid ${tokens.colors.borderSubtle}`,
                cursor: "pointer",
                position: "relative",
            }}
            className="list-row"
            onClick={openDetail}
        >
            {/* Drag handle (visible on hover) */}
            <span
                {...attributes}
                {...listeners}
                style={{
                    cursor: "grab",
                    color: tokens.colors.textMuted,
                    display: "flex",
                    alignItems: "center",
                    opacity: 0,
                    transition: "opacity var(--transition-base)",
                }}
                className="row-drag-handle"
                aria-label="Drag to reorder"
                onClick={(e) => e.stopPropagation()}
                onPointerDown={(e) => e.stopPropagation()}
            >
                <GripVertical size={14} strokeWidth={1.5} />
            </span>

            {/* Multi-select checkbox */}
            <span
                onClick={(e) => {
                    e.stopPropagation();
                    onSelectToggle(task.id, {
                        shift: (e as React.MouseEvent).shiftKey,
                        ctrl:
                            (e as React.MouseEvent).ctrlKey ||
                            (e as React.MouseEvent).metaKey,
                    });
                }}
                className={isSelected ? "" : "row-checkbox"}
                style={{
                    opacity: isSelected ? 1 : 0,
                    transition: "opacity var(--transition-base)",
                    flexShrink: 0,
                }}
            >
                <Checkbox checked={isSelected} aria-label="Select task" />
            </span>

            {/* Priority */}
            <span
                onClick={(e) => e.stopPropagation()}
                style={{ flexShrink: 0 }}
            >
                <InlinePriorityEdit
                    priority={task.priority}
                    onChange={(p) =>
                        update.mutate({ id: task.id, patch: { priority: p } })
                    }
                />
            </span>

            {/* Custom ID (clickable, monospace) */}
            {task.customId && (
                <span
                    style={{
                        fontFamily: tokens.typography.fontFamilyMono,
                        fontSize: 11,
                        color: tokens.colors.textMuted,
                        flexShrink: 0,
                        width: 80,
                    }}
                >
                    {task.customId}
                </span>
            )}

            {/* Name (inline-editable) */}
            <div
                style={{
                    flex: 1,
                    minWidth: 0,
                    overflow: "hidden",
                }}
            >
                <InlineNameEdit
                    value={task.name}
                    onSave={(name) =>
                        update.mutate({ id: task.id, patch: { name } })
                    }
                />
            </div>

            {/* Only ever visible with the toolbar's "Show archived" on, and
                needed the moment it is: without it an archived task is
                indistinguishable from a live one in the same list. */}
            {task.archivedAt && (
                <span
                    title="Archived — open the task to restore it"
                    style={{
                        flexShrink: 0,
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 3,
                        fontSize: 10,
                        padding: "1px 6px",
                        borderRadius: 999,
                        color: tokens.colors.textMuted,
                        border: `1px solid ${tokens.colors.border}`,
                    }}
                >
                    Archived
                </span>
            )}

            {/* upgrades/023 — a permanent delete is waiting on an admin. The
                task itself is untouched, so this is a flag, not a state. */}
            {task.deleteRequestPending && (
                <span
                    title="Permanent delete requested — waiting for an admin"
                    style={{
                        flexShrink: 0,
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 3,
                        fontSize: 10,
                        padding: "1px 6px",
                        borderRadius: 999,
                        color: tokens.colors.danger,
                        border: `1px solid ${tokens.colors.danger}`,
                    }}
                >
                    <Trash2 size={10} strokeWidth={2} />
                    Delete pending
                </span>
            )}
            {/* Activity indicators */}
            {(task.commentsCount > 0 ||
                task.attachmentsCount > 0 ||
                task.checklistItemsTotal > 0) && (
                <div
                    style={{
                        display: "flex",
                        gap: 6,
                        color: tokens.colors.textMuted,
                        fontSize: 11,
                        flexShrink: 0,
                    }}
                >
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
                            <ListChecks size={11} strokeWidth={1.75} />
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

            {/* Status */}
            <div style={{ flexShrink: 0 }} onClick={(e) => e.stopPropagation()}>
                <InlineStatusEdit
                    listId={task.primaryListId}
                    statusId={task.statusId}
                    onChange={(statusId) =>
                        update.mutate({ id: task.id, patch: { statusId } })
                    }
                />
            </div>

            {/* Due date */}
            <div
                style={{ flexShrink: 0, minWidth: 80 }}
                onClick={(e) => e.stopPropagation()}
            >
                <InlineDateEdit
                    date={task.dueDate}
                    onChange={(dueDate) =>
                        update.mutate({ id: task.id, patch: { dueDate } })
                    }
                />
            </div>

            {/* Assignees */}
            <div style={{ flexShrink: 0 }} onClick={(e) => e.stopPropagation()}>
                <InlineAssigneeEdit
                    assigneeIds={task.assignees}
                    onChange={(assignees) => setAssignees.mutate(assignees)}
                />
            </div>

            {/* Row actions menu */}
            <Dropdown menu={{ items: menuItems }} trigger={["click"]}>
                <button
                    onClick={(e) => e.stopPropagation()}
                    className="row-actions"
                    aria-label="Task actions"
                    style={{
                        background: "none",
                        border: 0,
                        padding: 4,
                        borderRadius: tokens.radius.sm,
                        cursor: "pointer",
                        color: tokens.colors.textMuted,
                        display: "flex",
                        alignItems: "center",
                        flexShrink: 0,
                        opacity: 0,
                        transition: "opacity var(--transition-base)",
                    }}
                >
                    <MoreHorizontal size={14} strokeWidth={1.75} />
                </button>
            </Dropdown>

            <style>{`
                .list-row:hover .row-drag-handle,
                .list-row:hover .row-checkbox,
                .list-row:hover .row-actions {
                    opacity: 1 !important;
                }
            `}</style>
        </div>
    );
};
