import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useSearchParams } from "react-router-dom";
import { MessageSquare, Paperclip, GitBranch } from "lucide-react";
import type { Task } from "../../types";
import { usersById } from "../../mocks/users";
import { tagsById } from "../../mocks/tags";
import { taskTypesById } from "../../mocks/task-types";
import { AssigneeStack } from "../ui/AssigneeStack";
import { DueDateBadge } from "../ui/DueDateBadge";
import { PriorityFlag } from "../ui/PriorityFlag";
import { TagChip } from "../ui/TagChip";
import { DynamicIcon } from "../shared/DynamicIcon";
import { tokens } from "../../theme";
import type { CardDensity } from "../../stores/board";

interface BoardCardProps {
    task: Task;
    density: CardDensity;
    isOverlay?: boolean;
}

export const BoardCard = ({
    task,
    density,
    isOverlay = false,
}: BoardCardProps) => {
    const [, setSearchParams] = useSearchParams();

    const {
        attributes,
        listeners,
        setNodeRef,
        transform,
        transition,
        isDragging,
    } = useSortable({ id: task.id, disabled: isOverlay });

    const style = {
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.4 : 1,
    };

    const taskType = taskTypesById.get(task.taskTypeId);
    const assignees = task.assignees
        .map((id) => usersById.get(id))
        .filter((u): u is NonNullable<typeof u> => !!u);
    const taskTags = task.tags
        .map((id) => tagsById.get(id))
        .filter((t): t is NonNullable<typeof t> => !!t);

    const openDetail = () => {
        setSearchParams((prev) => {
            const next = new URLSearchParams(prev);
            next.set("task", task.id);
            return next;
        });
    };

    const isComfortable = density === "comfortable";

    return (
        <div
            ref={setNodeRef}
            style={{
                ...style,
                background: tokens.colors.bgSurface,
                border: `1px solid ${tokens.colors.border}`,
                borderRadius: tokens.radius.md,
                padding: isComfortable ? 12 : 10,
                cursor: isOverlay ? "grabbing" : "pointer",
                boxShadow: isOverlay
                    ? tokens.shadows.lg
                    : tokens.shadows.sm,
                display: "flex",
                flexDirection: "column",
                gap: isComfortable ? 8 : 6,
                userSelect: "none",
                transition:
                    "border-color var(--transition-base), box-shadow var(--transition-base)",
            }}
            className="board-card"
            onClick={openDetail}
            {...attributes}
            {...listeners}
        >
            {/* Top row — task type pill + custom ID */}
            {(taskType || task.customId) && (
                <div
                    style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                        fontSize: 11,
                        color: tokens.colors.textMuted,
                    }}
                >
                    {taskType && (
                        <span
                            style={{
                                display: "inline-flex",
                                alignItems: "center",
                                gap: 3,
                                color: taskType.color,
                                fontWeight: 500,
                            }}
                        >
                            <DynamicIcon
                                name={taskType.icon}
                                size={11}
                                strokeWidth={1.75}
                            />
                            {taskType.name}
                        </span>
                    )}
                    {task.customId && (
                        <span
                            style={{
                                fontFamily: tokens.typography.fontFamilyMono,
                                color: tokens.colors.textMuted,
                                marginLeft: "auto",
                            }}
                        >
                            {task.customId}
                        </span>
                    )}
                </div>
            )}

            {/* Title row */}
            <div
                style={{
                    display: "flex",
                    alignItems: "flex-start",
                    gap: 6,
                }}
            >
                <PriorityFlag priority={task.priority} size={13} />
                <div
                    style={{
                        flex: 1,
                        fontSize: tokens.typography.fontSize.sm,
                        fontWeight: 500,
                        color: tokens.colors.textPrimary,
                        lineHeight: 1.4,
                        display: "-webkit-box",
                        WebkitLineClamp: isComfortable ? 3 : 2,
                        WebkitBoxOrient: "vertical",
                        overflow: "hidden",
                    }}
                >
                    {task.name}
                </div>
            </div>

            {/* Tags (only in comfortable) */}
            {isComfortable && taskTags.length > 0 && (
                <div
                    style={{
                        display: "flex",
                        flexWrap: "wrap",
                        gap: 3,
                    }}
                >
                    {taskTags.slice(0, 4).map((t) => (
                        <TagChip key={t.id} tag={t} size="sm" />
                    ))}
                    {taskTags.length > 4 && (
                        <span
                            style={{
                                fontSize: 10,
                                color: tokens.colors.textMuted,
                                fontFamily: tokens.typography.fontFamilyMono,
                            }}
                        >
                            +{taskTags.length - 4}
                        </span>
                    )}
                </div>
            )}

            {/* Footer row */}
            <div
                style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    marginTop: 2,
                }}
            >
                <DueDateBadge dueDate={task.dueDate} size="sm" />

                {/* Activity counts */}
                {(task.commentsCount > 0 ||
                    task.attachmentsCount > 0 ||
                    task.subtasksCount > 0) && (
                    <div
                        style={{
                            display: "flex",
                            gap: 6,
                            fontSize: 10,
                            color: tokens.colors.textMuted,
                            marginLeft: 4,
                        }}
                    >
                        {task.subtasksCount > 0 && (
                            <span
                                style={{
                                    display: "inline-flex",
                                    alignItems: "center",
                                    gap: 2,
                                }}
                            >
                                <GitBranch size={10} strokeWidth={1.75} />
                                {task.subtasksCompleted}/{task.subtasksCount}
                            </span>
                        )}
                        {task.commentsCount > 0 && (
                            <span
                                style={{
                                    display: "inline-flex",
                                    alignItems: "center",
                                    gap: 2,
                                }}
                            >
                                <MessageSquare size={10} strokeWidth={1.75} />
                                {task.commentsCount}
                            </span>
                        )}
                        {task.attachmentsCount > 0 && (
                            <span
                                style={{
                                    display: "inline-flex",
                                    alignItems: "center",
                                    gap: 2,
                                }}
                            >
                                <Paperclip size={10} strokeWidth={1.75} />
                                {task.attachmentsCount}
                            </span>
                        )}
                    </div>
                )}

                <div style={{ marginLeft: "auto" }}>
                    <AssigneeStack users={assignees} size={20} max={3} />
                </div>
            </div>

            <style>{`
                .board-card:hover {
                    border-color: ${tokens.colors.borderStrong};
                    box-shadow: ${tokens.shadows.md};
                }
            `}</style>
        </div>
    );
};
