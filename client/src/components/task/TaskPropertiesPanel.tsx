import { Modal } from "antd";
import { AlertTriangle, Clock, Timer, Eye, Calendar as CalIcon, Flag, Repeat } from "lucide-react";
import { useUpdateTask } from "../../hooks/useTaskMutations";
import { InlineAssigneeEdit } from "./InlineAssigneeEdit";
import { InlineDateEdit } from "./InlineDateEdit";
import { InlinePriorityEdit } from "./InlinePriorityEdit";
import { InlineTagEdit } from "./InlineTagEdit";
import { InlineStatusEdit } from "./InlineStatusEdit";
import { RecurrenceConfig } from "./RecurrenceConfig";
import { TimeTrackingControl } from "./TimeTrackingControl";
import type { Task } from "../../types";
import { listsById } from "../../mocks/lists";
import { getBlockingTasksForCompletion } from "../../lib/dependency-guard";
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

    const handleStatusChange = async (statusId: string) => {
        const blockers = await getBlockingTasksForCompletion(
            task.id,
            statusId,
        );
        if (blockers.length === 0) {
            update.mutate({ id: task.id, patch: { statusId } });
            return;
        }
        Modal.confirm({
            title: "Open blockers",
            icon: (
                <AlertTriangle
                    size={20}
                    strokeWidth={1.75}
                    color={tokens.colors.warning}
                />
            ),
            content: (
                <div>
                    <p style={{ marginTop: 0 }}>
                        This task is still blocked by{" "}
                        {blockers.length} open task
                        {blockers.length > 1 ? "s" : ""}:
                    </p>
                    <ul
                        style={{
                            margin: 0,
                            paddingLeft: 20,
                            color: tokens.colors.textSecondary,
                            fontSize: 13,
                        }}
                    >
                        {blockers.map((b) => (
                            <li key={b.id}>
                                <code
                                    style={{
                                        fontSize: 11,
                                        fontFamily:
                                            tokens.typography.fontFamilyMono,
                                        color: tokens.colors.textMuted,
                                        marginRight: 4,
                                    }}
                                >
                                    {b.customId ?? b.id.slice(0, 8)}
                                </code>
                                {b.name}
                            </li>
                        ))}
                    </ul>
                    <p style={{ marginBottom: 0, marginTop: 8 }}>
                        Mark this task complete anyway?
                    </p>
                </div>
            ),
            okText: "Yes, complete it",
            okType: "danger",
            cancelText: "Cancel",
            onOk: () => update.mutate({ id: task.id, patch: { statusId } }),
        });
    };

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
                    onChange={handleStatusChange}
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

            <PropLabel icon={<Repeat size={11} strokeWidth={1.75} />}>
                Recurrence
            </PropLabel>
            <PropValue>
                <RecurrenceConfig
                    value={task.recurrence}
                    onChange={(recurrence) =>
                        update.mutate({
                            id: task.id,
                            patch: { recurrence },
                        })
                    }
                />
            </PropValue>

            <PropLabel icon={<Timer size={11} strokeWidth={1.75} />}>
                Estimate
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
                <TimeTrackingControl task={task} />
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
                <InlineAssigneeEdit
                    assigneeIds={task.watchers}
                    onChange={(watchers) =>
                        update.mutate({ id: task.id, patch: { watchers } })
                    }
                />
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
