import { Drawer, Dropdown, App as AntApp } from "antd";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
    X,
    Copy,
    Archive,
    Trash2,
    Maximize2,
    MoreHorizontal,
    Link2,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { mockApi } from "../../lib/mock-api";
import { taskTypesById } from "../../mocks/task-types";
import { usersById } from "../../mocks/users";
import { DynamicIcon } from "../shared/DynamicIcon";
import { LoadingState } from "../shared/LoadingState";
import { InlineNameEdit } from "./InlineNameEdit";
import { TaskPropertiesPanel } from "./TaskPropertiesPanel";
import { TaskDescription } from "./TaskDescription";
import { SubtasksSection } from "./SubtasksSection";
import { ChecklistsSection } from "./ChecklistsSection";
import { CommentsSection } from "./CommentsSection";
import { AttachmentsSection } from "./AttachmentsSection";
import { DependenciesSection } from "./DependenciesSection";
import { TimeLogsSection } from "./TimeLogsSection";
import { TaskActivitySection } from "./TaskActivitySection";
import { CustomFieldsList } from "../custom-field/CustomFieldsList";
import { useUpdateTask } from "../../hooks/useTaskMutations";
import { tokens } from "../../theme";

interface TaskDetailDrawerProps {
    taskId: string | null;
    listId: string;
    onClose: () => void;
}

export const TaskDetailDrawer = ({
    taskId,
    listId,
    onClose,
}: TaskDetailDrawerProps) => {
    const navigate = useNavigate();
    const qc = useQueryClient();
    const { message } = AntApp.useApp();
    const update = useUpdateTask(listId);

    const { data: task, isLoading } = useQuery({
        queryKey: ["task", taskId],
        queryFn: () =>
            taskId ? mockApi.tasks.getById(taskId) : Promise.resolve(null),
        enabled: !!taskId,
    });

    const taskType = task ? taskTypesById.get(task.taskTypeId) : null;
    const creator = task ? usersById.get(task.createdBy) : null;

    const duplicate = useMutation({
        mutationFn: () => {
            if (!task) return Promise.reject(new Error("No task"));
            return mockApi.tasks.create({
                primaryListId: task.primaryListId,
                name: `${task.name} (copy)`,
                statusId: task.statusId,
                priority: task.priority,
                taskTypeId: task.taskTypeId,
                assignees: [...task.assignees],
                tags: [...task.tags],
                startDate: task.startDate,
                dueDate: task.dueDate,
            });
        },
        onSuccess: (created) => {
            qc.invalidateQueries({
                queryKey: ["tasks-by-list", created.primaryListId],
            });
            message.success(`Duplicated as "${created.name}"`);
        },
    });

    const menuItems = [
        {
            key: "open",
            label: "Open as page",
            icon: <Maximize2 size={13} strokeWidth={1.75} />,
            onClick: () => {
                if (task) navigate(`/t/${task.customId ?? task.id}`);
            },
        },
        {
            key: "copy-link",
            label: "Copy link",
            icon: <Link2 size={13} strokeWidth={1.75} />,
            onClick: () => {
                if (task) {
                    navigator.clipboard
                        .writeText(
                            `${window.location.origin}/t/${task.customId ?? task.id}`,
                        )
                        .then(() => message.success("Link copied"))
                        .catch(() => message.error("Could not copy"));
                }
            },
        },
        {
            key: "duplicate",
            label: "Duplicate",
            icon: <Copy size={13} strokeWidth={1.75} />,
            onClick: () => duplicate.mutate(),
        },
        {
            key: "archive",
            label: "Archive",
            icon: <Archive size={13} strokeWidth={1.75} />,
            onClick: () => {
                if (task)
                    mockApi.tasks.archive(task.id).then(() => {
                        message.success("Task archived");
                        qc.invalidateQueries({
                            queryKey: ["tasks-by-list", listId],
                        });
                        onClose();
                    });
            },
        },
        { type: "divider" as const },
        {
            key: "delete",
            label: "Delete",
            icon: <Trash2 size={13} strokeWidth={1.75} />,
            danger: true,
            onClick: () => {
                if (task)
                    mockApi.tasks.delete(task.id).then(() => {
                        message.success("Task deleted");
                        qc.invalidateQueries({
                            queryKey: ["tasks-by-list", listId],
                        });
                        onClose();
                    });
            },
        },
    ];

    return (
        <Drawer
            open={!!taskId}
            onClose={onClose}
            width={720}
            placement="right"
            closeIcon={null}
            styles={{
                body: { padding: 0 },
                header: { display: "none" },
            }}
            destroyOnHidden
        >
            {isLoading || !task ? (
                <LoadingState label="Loading task…" />
            ) : (
                <div
                    style={{
                        display: "flex",
                        flexDirection: "column",
                        height: "100%",
                    }}
                >
                    {/* Sticky header */}
                    <div
                        style={{
                            display: "flex",
                            alignItems: "center",
                            gap: tokens.spacing[2],
                            padding: `${tokens.spacing[3]}px ${tokens.spacing[5]}px`,
                            borderBottom: `1px solid ${tokens.colors.border}`,
                            background: tokens.colors.bgSurface,
                            position: "sticky",
                            top: 0,
                            zIndex: 2,
                        }}
                    >
                        {taskType && (
                            <div
                                style={{
                                    width: 26,
                                    height: 26,
                                    borderRadius: tokens.radius.sm,
                                    background: `${taskType.color}1A`,
                                    color: taskType.color,
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    flexShrink: 0,
                                }}
                            >
                                <DynamicIcon
                                    name={taskType.icon}
                                    size={14}
                                    strokeWidth={1.75}
                                />
                            </div>
                        )}
                        <span
                            style={{
                                fontFamily: tokens.typography.fontFamilyMono,
                                fontSize: tokens.typography.fontSize.sm,
                                color: tokens.colors.textMuted,
                                fontWeight: 500,
                            }}
                        >
                            {task.customId ?? `T-${task.taskNumber}`}
                        </span>
                        <div style={{ flex: 1 }} />
                        <Dropdown menu={{ items: menuItems }} trigger={["click"]}>
                            <button
                                style={iconBtnStyle}
                                onMouseEnter={(e) =>
                                    (e.currentTarget.style.background =
                                        tokens.colors.bgHover)
                                }
                                onMouseLeave={(e) =>
                                    (e.currentTarget.style.background =
                                        "transparent")
                                }
                                title="More"
                            >
                                <MoreHorizontal size={16} strokeWidth={1.75} />
                            </button>
                        </Dropdown>
                        <button
                            onClick={onClose}
                            style={iconBtnStyle}
                            onMouseEnter={(e) =>
                                (e.currentTarget.style.background =
                                    tokens.colors.bgHover)
                            }
                            onMouseLeave={(e) =>
                                (e.currentTarget.style.background =
                                    "transparent")
                            }
                            title="Close (Esc)"
                        >
                            <X size={16} strokeWidth={1.75} />
                        </button>
                    </div>

                    {/* Body */}
                    <div style={{ flex: 1, overflowY: "auto" }}>
                        {/* Task name */}
                        <div
                            style={{
                                padding: `${tokens.spacing[5]}px ${tokens.spacing[5]}px ${tokens.spacing[3]}px`,
                                borderBottom: `1px solid ${tokens.colors.borderSubtle}`,
                            }}
                        >
                            <InlineNameEdit
                                value={task.name}
                                onSave={(name) =>
                                    update.mutate({
                                        id: task.id,
                                        patch: { name },
                                    })
                                }
                                size="lg"
                            />
                        </div>

                        <TaskPropertiesPanel task={task} />
                        <CustomFieldsList task={task} />
                        <TaskDescription
                            description={
                                typeof task.description === "string"
                                    ? task.description
                                    : ""
                            }
                            onSave={(description) =>
                                update.mutate({
                                    id: task.id,
                                    patch: { description },
                                })
                            }
                        />
                        <SubtasksSection task={task} />
                        <ChecklistsSection taskId={task.id} />
                        <DependenciesSection
                            taskId={task.id}
                            listId={task.primaryListId}
                        />
                        <AttachmentsSection taskId={task.id} />
                        <TimeLogsSection taskId={task.id} />
                        <CommentsSection taskId={task.id} />
                        <TaskActivitySection taskId={task.id} />
                    </div>

                    {/* Footer */}
                    <div
                        style={{
                            padding: `${tokens.spacing[2]}px ${tokens.spacing[5]}px`,
                            borderTop: `1px solid ${tokens.colors.borderSubtle}`,
                            background: tokens.colors.bgPage,
                            fontSize: 11,
                            color: tokens.colors.textMuted,
                            display: "flex",
                            gap: 6,
                        }}
                    >
                        <span>
                            Created by{" "}
                            {creator
                                ? `${creator.firstName} ${creator.lastName}`
                                : "Unknown"}
                        </span>
                        <span>·</span>
                        <span>
                            {new Date(task.createdAt).toLocaleDateString(
                                "en-US",
                                {
                                    month: "short",
                                    day: "numeric",
                                    year: "numeric",
                                },
                            )}
                        </span>
                        <span>·</span>
                        <span
                            style={{
                                fontFamily: tokens.typography.fontFamilyMono,
                            }}
                        >
                            {task.customId ?? `T-${task.taskNumber}`}
                        </span>
                    </div>
                </div>
            )}
        </Drawer>
    );
};

const iconBtnStyle: React.CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: 28,
    height: 28,
    border: 0,
    background: "transparent",
    borderRadius: tokens.radius.sm,
    cursor: "pointer",
    color: tokens.colors.textSecondary,
    transition: "background var(--transition-base)",
};
