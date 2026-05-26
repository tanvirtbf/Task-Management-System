import { Tooltip } from "antd";
import { Clock, Timer, Eye, Calendar as CalIcon, Flag } from "lucide-react";
import { useUpdateTask } from "../../hooks/useTaskMutations";
import { InlineAssigneeEdit } from "./InlineAssigneeEdit";
import { InlineDateEdit } from "./InlineDateEdit";
import { InlinePriorityEdit } from "./InlinePriorityEdit";
import { InlineTagEdit } from "./InlineTagEdit";
import { InlineStatusEdit } from "./InlineStatusEdit";
import type { Task } from "../../types";
import { listsById } from "../../mocks/lists";
import { tokens } from "../../theme";

const formatSeconds = (s: number) => {
    if (!s) return "—";
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
};

export const TaskPropertiesPanel = ({ task }: { task: Task }) => {
    const list = listsById.get(task.primaryListId);
    const update = useUpdateTask(task.primaryListId);

    return (
        <div
            style={{
                display: "grid",
                gridTemplateColumns: "120px 1fr",
                rowGap: tokens.spacing[2],
                columnGap: tokens.spacing[3],
                fontSize: tokens.typography.fontSize.sm,
                padding: `${tokens.spacing[4]}px ${tokens.spacing[5]}px`,
                borderBottom: `1px solid ${tokens.colors.borderSubtle}`,
            }}
        >
            <PropLabel>Status</PropLabel>
            <PropValue>
                <InlineStatusEdit
                    listId={task.primaryListId}
                    statusId={task.statusId}
                    onChange={(statusId) =>
                        update.mutate({ id: task.id, patch: { statusId } })
                    }
                    size="md"
                />
            </PropValue>

            <PropLabel icon={<Flag size={11} strokeWidth={1.75} />}>
                Priority
            </PropLabel>
            <PropValue>
                <InlinePriorityEdit
                    priority={task.priority}
                    onChange={(p) =>
                        update.mutate({ id: task.id, patch: { priority: p } })
                    }
                />
            </PropValue>

            <PropLabel>Assignees</PropLabel>
            <PropValue>
                <InlineAssigneeEdit
                    assigneeIds={task.assignees}
                    onChange={(assignees) =>
                        update.mutate({ id: task.id, patch: { assignees } })
                    }
                />
            </PropValue>

            <PropLabel icon={<CalIcon size={11} strokeWidth={1.75} />}>
                Start date
            </PropLabel>
            <PropValue>
                <InlineDateEdit
                    date={task.startDate}
                    onChange={(d) =>
                        update.mutate({ id: task.id, patch: { startDate: d } })
                    }
                />
            </PropValue>

            <PropLabel icon={<CalIcon size={11} strokeWidth={1.75} />}>
                Due date
            </PropLabel>
            <PropValue>
                <InlineDateEdit
                    date={task.dueDate}
                    onChange={(d) =>
                        update.mutate({ id: task.id, patch: { dueDate: d } })
                    }
                />
            </PropValue>

            <PropLabel icon={<Timer size={11} strokeWidth={1.75} />}>
                Time estimate
            </PropLabel>
            <PropValue>
                <span style={{ color: tokens.colors.textSecondary }}>
                    {formatSeconds(task.timeEstimateSeconds ?? 0)}
                </span>
            </PropValue>

            <PropLabel icon={<Clock size={11} strokeWidth={1.75} />}>
                Time tracked
            </PropLabel>
            <PropValue>
                <span
                    style={{
                        color: tokens.colors.textSecondary,
                        fontFamily: tokens.typography.fontFamilyMono,
                    }}
                >
                    {formatSeconds(task.timeTrackedSeconds)}
                </span>
            </PropValue>

            <PropLabel>Tags</PropLabel>
            <PropValue>
                {list && (
                    <InlineTagEdit
                        spaceId={list.spaceId}
                        tagIds={task.tags}
                        onChange={(tags) =>
                            update.mutate({ id: task.id, patch: { tags } })
                        }
                    />
                )}
            </PropValue>

            <PropLabel icon={<Eye size={11} strokeWidth={1.75} />}>
                Watchers
            </PropLabel>
            <PropValue>
                <Tooltip
                    title={`${task.watchers.length} watching this task`}
                >
                    <span style={{ color: tokens.colors.textSecondary }}>
                        {task.watchers.length}
                    </span>
                </Tooltip>
            </PropValue>
        </div>
    );
};

const PropLabel = ({
    children,
    icon,
}: {
    children: React.ReactNode;
    icon?: React.ReactNode;
}) => (
    <div
        style={{
            display: "flex",
            alignItems: "center",
            gap: 4,
            color: tokens.colors.textMuted,
            fontSize: tokens.typography.fontSize.sm,
            fontWeight: 500,
            paddingTop: 4,
        }}
    >
        {icon}
        {children}
    </div>
);

const PropValue = ({ children }: { children: React.ReactNode }) => (
    <div
        style={{
            display: "flex",
            alignItems: "center",
            minHeight: 26,
            color: tokens.colors.textPrimary,
        }}
    >
        {children}
    </div>
);
