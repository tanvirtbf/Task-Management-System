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
import { tasksApi } from "../../http/api";
import {
    useStatusMap,
    useTaskTypeMap,
    useUserMap,
} from "../../hooks/useReferenceData";
import { DynamicIcon } from "../shared/DynamicIcon";
import { LoadingState } from "../shared/LoadingState";
import { InlineNameEdit } from "./InlineNameEdit";
import { TaskPropertiesPanel } from "./TaskPropertiesPanel";
import { TaskDescription } from "./TaskDescription";
import { ChecklistsSection } from "./ChecklistsSection";
import { CommentsSection } from "./CommentsSection";
import { AttachmentsSection } from "./AttachmentsSection";
import { SubtasksSection } from "./SubtasksSection";
import { DependenciesSection } from "./DependenciesSection";
import { TaskActivitySection } from "./TaskActivitySection";
import { BugFieldsSection } from "./BugFieldsSection";
import { GitIntegrationPanel } from "./GitIntegrationPanel";
import { PostmortemChecklist } from "./PostmortemChecklist";
import { SLABadge } from "./SLABadge";
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
    const typeMap = useTaskTypeMap();
    const userMap = useUserMap();
    const statusMap = useStatusMap(listId);

    const { data: task, isLoading } = useQuery({
        queryKey: ["task", taskId],
        queryFn: () =>
            taskId ? tasksApi.getById(taskId) : Promise.resolve(null),
        enabled: !!taskId,
    });

    const taskType = task ? typeMap.get(task.taskTypeId) : null;
    const creator = task ? userMap.get(task.createdBy) : null;
    const isDev = taskType?.isDevType ?? false;
    const isBug = task?.taskTypeId === "tt-bug";
    const isIncident = task?.taskTypeId === "tt-incident";
    const status = task ? statusMap.get(task.statusId) : null;
    const isIncidentResolved =
        isIncident &&
        (status?.statusGroup === "done" || status?.statusGroup === "closed");

    const duplicate = useMutation({
        mutationFn: () => {
            if (!task) return Promise.reject(new Error("No task"));
            return tasksApi.create({
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
                    tasksApi.archive(task.id).then(() => {
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
                    tasksApi.delete(task.id).then(() => {
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
            size="large"
            placement="right"
            closeIcon={null}
            styles={{
                body: { padding: 0 },
                header: { display: "none" },
                wrapper: { width: 720 },
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

                        {isBug && <BugFieldsSection task={task} />}

                        <CustomFieldsList task={task} />

                        <TaskDescription
                            description={
                                typeof task.description === "string"
                                    ? task.description
                                    : ""
                            }
                            rich={isDev}
                            onSave={(description) =>
                                update.mutate({
                                    id: task.id,
                                    patch: { description },
                                })
                            }
                        />

                        {isDev && <GitIntegrationPanel task={task} />}

                        {isDev && <SubtasksSection task={task} />}

                        {isDev && (
                            <DependenciesSection
                                taskId={task.id}
                                listId={task.primaryListId}
                            />
                        )}

                        <ChecklistsSection taskId={task.id} />

                        {isIncidentResolved && (
                            <PostmortemChecklist taskId={task.id} />
                        )}

                        <AttachmentsSection taskId={task.id} />

                        <CommentsSection taskId={task.id} />

                        {isDev && <TaskActivitySection taskId={task.id} />}
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
                        {task.deployedAt && (
                            <>
                                <span>·</span>
                                <span style={{ color: tokens.colors.success }}>
                                    Deployed{" "}
                                    {new Date(task.deployedAt).toLocaleDateString()}
                                </span>
                            </>
                        )}
                        {task.rollbackReason && (
                            <>
                                <span>·</span>
                                <span style={{ color: tokens.colors.danger }}>
                                    Rolled back: {task.rollbackReason}
                                </span>
                            </>
                        )}
                        {task.slaDueAt && (
                            <>
                                <span>·</span>
                                <SLABadge
                                    slaDueAt={task.slaDueAt}
                                    completedAt={task.completedAt}
                                    size="sm"
                                />
                            </>
                        )}
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
