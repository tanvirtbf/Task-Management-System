import { Tooltip } from "antd";
import { Clock, Timer, Eye, Calendar as CalIcon, Flag, Zap, GitPullRequest, Repeat } from "lucide-react";
import { useUpdateTask, useTaskMembership } from "../../hooks/useTaskMutations";
import { InlineAssigneeEdit } from "./InlineAssigneeEdit";
import { InlineDateEdit } from "./InlineDateEdit";
import { InlinePriorityEdit } from "./InlinePriorityEdit";
import { InlineTagEdit } from "./InlineTagEdit";
import { InlineStatusEdit } from "./InlineStatusEdit";
import { InlineReviewerEdit } from "./InlineReviewerEdit";
import { InlineStoryPointsEdit } from "./InlineStoryPointsEdit";
import { BugSeverityBadge } from "./BugSeverityBadge";
import { RecurrenceConfig } from "./RecurrenceConfig";
import { useQuery } from "@tanstack/react-query";
import type { Task } from "../../types";
import { sprintsApi } from "../../http/api";
import { useListMap, useTaskTypeMap } from "../../hooks/useReferenceData";
import { tokens } from "../../theme";

const formatSeconds = (s: number) => {
    if (!s) return "—";
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
};

export const TaskPropertiesPanel = ({ task }: { task: Task }) => {
    const listMap = useListMap();
    const typeMap = useTaskTypeMap();
    const { setAssignees, setTags } = useTaskMembership(task);
    const list = listMap.get(task.primaryListId);
    const update = useUpdateTask(task.primaryListId);
    const isDev = typeMap.get(task.taskTypeId)?.isDevType ?? false;
    const isBug = typeMap.get(task.taskTypeId)?.name.toLowerCase() === "bug";
    const { data: sprints = [] } = useQuery({
        queryKey: ["sprints"],
        queryFn: () => sprintsApi.list(),
    });
    const sprint = task.sprintId
        ? (sprints.find((s) => s.id === task.sprintId) ?? null)
        : null;

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

            {isBug && (
                <>
                    <PropLabel>Severity</PropLabel>
                    <PropValue>
                        {task.bugSeverity ? (
                            <BugSeverityBadge severity={task.bugSeverity} />
                        ) : (
                            <span style={{ color: tokens.colors.textMuted }}>
                                Not set
                            </span>
                        )}
                    </PropValue>
                </>
            )}

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
                    onChange={(assignees) => setAssignees.mutate(assignees)}
                />
            </PropValue>

            {isDev && (
                <>
                    <PropLabel icon={<Eye size={11} strokeWidth={1.75} />}>
                        Reviewer
                    </PropLabel>
                    <PropValue>
                        <InlineReviewerEdit
                            reviewerId={task.reviewerId}
                            onChange={(id) =>
                                update.mutate({
                                    id: task.id,
                                    patch: { reviewerId: id },
                                })
                            }
                        />
                    </PropValue>

                    <PropLabel icon={<GitPullRequest size={11} strokeWidth={1.75} />}>
                        Story points
                    </PropLabel>
                    <PropValue>
                        <InlineStoryPointsEdit
                            points={task.storyPoints}
                            onChange={(p) =>
                                update.mutate({
                                    id: task.id,
                                    patch: { storyPoints: p },
                                })
                            }
                        />
                    </PropValue>

                    {sprint && (
                        <>
                            <PropLabel icon={<Zap size={11} strokeWidth={1.75} />}>
                                Sprint
                            </PropLabel>
                            <PropValue>
                                <span
                                    style={{
                                        fontWeight: 600,
                                        color: tokens.colors.primary,
                                    }}
                                >
                                    {sprint.name}
                                </span>
                                <span
                                    style={{
                                        marginLeft: 6,
                                        fontSize: 11,
                                        color: tokens.colors.textMuted,
                                    }}
                                >
                                    {sprint.goal}
                                </span>
                            </PropValue>
                        </>
                    )}
                </>
            )}

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

            {!isDev && (
                <>
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
                        <span
                            style={{
                                color: tokens.colors.textSecondary,
                                fontFamily: tokens.typography.fontFamilyMono,
                            }}
                        >
                            {formatSeconds(task.timeTrackedSeconds)}
                        </span>
                    </PropValue>
                </>
            )}

            <PropLabel icon={<Repeat size={11} strokeWidth={1.75} />}>
                Recurrence
            </PropLabel>
            <PropValue>
                <RecurrenceConfig
                    value={task.recurrence}
                    onChange={(r) =>
                        update.mutate({ id: task.id, patch: { recurrence: r } })
                    }
                />
            </PropValue>

            <PropLabel>Tags</PropLabel>
            <PropValue>
                {list && (
                    <InlineTagEdit
                        spaceId={list.spaceId}
                        tagIds={task.tags}
                        onChange={(tags) => setTags.mutate(tags)}
                    />
                )}
            </PropValue>

            <PropLabel icon={<Eye size={11} strokeWidth={1.75} />}>
                Watchers
            </PropLabel>
            <PropValue>
                <Tooltip title={`${task.watchers.length} watching`}>
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
