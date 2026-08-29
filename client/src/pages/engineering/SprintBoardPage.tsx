import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { Select, Empty } from "antd";
import { Zap, Target, CalendarRange } from "lucide-react";
import { sprintsApi } from "../../http/api";
import { useTaskTypeMap, useUserMap } from "../../hooks/useReferenceData";
import { TaskDetailDrawer } from "../../components/task/TaskDetailDrawer";
import {
    BugSeverityRail,
    BugSeverityBadge,
} from "../../components/task/BugSeverityBadge";
import { StoryPointsBadge } from "../../components/task/StoryPointsBadge";
import { Avatar } from "../../components/ui/Avatar";
import { DynamicIcon } from "../../components/shared/DynamicIcon";
import { tokens } from "../../theme";

const SprintBoardPage = () => {
    const [searchParams, setSearchParams] = useSearchParams();
    const openTaskId = searchParams.get("task");
    const [sprintId, setSprintId] = useState<string>("");
    const typeMap = useTaskTypeMap();
    const userMap = useUserMap();

    const { data: sprintList = [] } = useQuery({
        queryKey: ["sprints"],
        queryFn: () => sprintsApi.list(),
    });
    // A sprint's tasks span lists — fetched cross-list via GET /sprints/:id/tasks
    // (each task's status pill is resolved in its detail drawer).
    const { data: sprintTasks = [] } = useQuery({
        queryKey: ["sprint-tasks", sprintId],
        queryFn: () =>
            sprintId ? sprintsApi.tasks(sprintId) : Promise.resolve([]),
        enabled: !!sprintId,
    });

    // Default the selector to the active sprint (or first) once sprints load.
    useEffect(() => {
        if (!sprintId && sprintList.length > 0) {
            setSprintId(
                sprintList.find((s) => s.status === "active")?.id ??
                    sprintList[0].id,
            );
        }
    }, [sprintId, sprintList]);

    const sprint = sprintList.find((s) => s.id === sprintId);
    const totalPoints = sprintTasks.reduce(
        (acc, t) => acc + (t.storyPoints ?? 0),
        0,
    );
    const committedPoints = sprint?.committedPoints ?? 0;
    const openTask = sprintTasks.find(
        (t) => t.id === openTaskId || t.customId === openTaskId,
    );

    return (
        <div
            style={{ display: "flex", flexDirection: "column", height: "100%" }}
        >
            {/* Sprint header */}
            <div
                style={{
                    padding: `${tokens.spacing[5]}px ${tokens.spacing[6]}px`,
                    background: tokens.colors.bgSurface,
                    borderBottom: `1px solid ${tokens.colors.border}`,
                }}
            >
                <div
                    style={{
                        display: "flex",
                        alignItems: "center",
                        gap: tokens.spacing[3],
                        marginBottom: tokens.spacing[3],
                    }}
                >
                    <div
                        style={{
                            width: 36,
                            height: 36,
                            borderRadius: tokens.radius.md,
                            background: `${tokens.colors.primary}1A`,
                            color: tokens.colors.primary,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                        }}
                    >
                        <Zap size={18} strokeWidth={1.75} />
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                        <h1
                            style={{
                                margin: 0,
                                fontSize: tokens.typography.fontSize["2xl"],
                                fontWeight: 700,
                                letterSpacing: "-0.02em",
                                color: tokens.colors.textPrimary,
                            }}
                        >
                            Sprint Board
                        </h1>
                        {sprint?.goal && (
                            <div
                                style={{
                                    fontSize: tokens.typography.fontSize.sm,
                                    color: tokens.colors.textSecondary,
                                    display: "flex",
                                    alignItems: "center",
                                    gap: 6,
                                    marginTop: 2,
                                }}
                            >
                                <Target size={12} strokeWidth={1.75} />
                                {sprint.goal}
                            </div>
                        )}
                    </div>
                    <Select
                        value={sprintId || undefined}
                        onChange={setSprintId}
                        placeholder="Select a sprint"
                        style={{ minWidth: 220 }}
                        options={sprintList.map((s) => ({
                            value: s.id,
                            label: `${s.name} ${
                                s.status === "active"
                                    ? "· active"
                                    : s.status === "planned"
                                      ? "· planned"
                                      : "· closed"
                            }`,
                        }))}
                    />
                </div>

                {sprint && (
                    <div
                        style={{
                            display: "flex",
                            alignItems: "center",
                            gap: tokens.spacing[6],
                            fontSize: tokens.typography.fontSize.sm,
                            color: tokens.colors.textSecondary,
                        }}
                    >
                        <span
                            style={{
                                display: "inline-flex",
                                alignItems: "center",
                                gap: 6,
                            }}
                        >
                            <CalendarRange size={13} strokeWidth={1.75} />
                            {new Date(sprint.startDate).toLocaleDateString()} —{" "}
                            {new Date(sprint.endDate).toLocaleDateString()}
                        </span>
                        <span
                            style={{
                                fontFamily: tokens.typography.fontFamilyMono,
                                fontWeight: 700,
                                color: tokens.colors.textPrimary,
                            }}
                        >
                            {sprintTasks.length} tasks · {totalPoints} pts
                        </span>
                        {committedPoints > 0 && (
                            <span style={{ color: tokens.colors.textMuted }}>
                                {committedPoints} pts committed
                            </span>
                        )}
                    </div>
                )}
            </div>

            {/* Sprint tasks — cross-list, so a flat grid (status pill lives in the
                detail drawer; cross-list kanban-by-status is not well-defined). */}
            <div
                style={{
                    flex: 1,
                    overflow: "auto",
                    padding: `${tokens.spacing[4]}px ${tokens.spacing[6]}px`,
                }}
            >
                {sprintTasks.length === 0 ? (
                    <Empty
                        description={
                            !sprint
                                ? "Select a sprint to see its tasks."
                                : sprint.status === "planned"
                                  ? "Plan tasks into this sprint."
                                  : sprint.status === "closed"
                                    ? "This sprint is closed."
                                    : "No tasks in this sprint yet."
                        }
                        style={{ marginTop: 60 }}
                    />
                ) : (
                    <div
                        style={{
                            display: "grid",
                            gridTemplateColumns:
                                "repeat(auto-fill, minmax(280px, 1fr))",
                            gap: tokens.spacing[3],
                        }}
                    >
                        {sprintTasks.map((t) => {
                            const type = typeMap.get(t.taskTypeId);
                            const assignee = t.assignees[0]
                                ? userMap.get(t.assignees[0])
                                : null;
                            return (
                                <button
                                    key={t.id}
                                    onClick={() => {
                                        const next = new URLSearchParams(
                                            searchParams,
                                        );
                                        next.set("task", t.id);
                                        setSearchParams(next, { replace: true });
                                    }}
                                    style={{
                                        position: "relative",
                                        background: tokens.colors.bgSurface,
                                        border: `1px solid ${tokens.colors.border}`,
                                        borderRadius: tokens.radius.md,
                                        padding: "8px 10px 8px 12px",
                                        cursor: "pointer",
                                        textAlign: "left",
                                        display: "flex",
                                        flexDirection: "column",
                                        gap: 6,
                                    }}
                                >
                                    <BugSeverityRail severity={t.bugSeverity} />
                                    <div
                                        style={{
                                            display: "flex",
                                            alignItems: "center",
                                            gap: 6,
                                            fontSize: 11,
                                            color: tokens.colors.textMuted,
                                            fontFamily:
                                                tokens.typography.fontFamilyMono,
                                        }}
                                    >
                                        {type && (
                                            <DynamicIcon
                                                name={type.icon}
                                                size={11}
                                                strokeWidth={1.75}
                                                color={type.color}
                                            />
                                        )}
                                        {t.customId ?? `T-${t.taskNumber}`}
                                        <BugSeverityBadge
                                            severity={t.bugSeverity}
                                            compact
                                        />
                                    </div>
                                    <div
                                        style={{
                                            fontSize:
                                                tokens.typography.fontSize.sm,
                                            color: tokens.colors.textPrimary,
                                            lineHeight: 1.35,
                                        }}
                                    >
                                        {t.name}
                                    </div>
                                    <div
                                        style={{
                                            display: "flex",
                                            alignItems: "center",
                                            gap: 6,
                                            marginTop: 2,
                                        }}
                                    >
                                        <StoryPointsBadge points={t.storyPoints} />
                                        {t.prStatus && (
                                            <span
                                                style={{
                                                    fontSize: 10,
                                                    fontWeight: 700,
                                                    color:
                                                        t.prStatus === "merged"
                                                            ? "#8B5CF6"
                                                            : t.prStatus ===
                                                                "open"
                                                              ? "#10B981"
                                                              : "#94A3B8",
                                                    background:
                                                        "rgba(0,0,0,0.04)",
                                                    padding: "1px 5px",
                                                    borderRadius: 3,
                                                }}
                                            >
                                                PR {t.prStatus.toUpperCase()}
                                            </span>
                                        )}
                                        <div style={{ marginLeft: "auto" }}>
                                            {assignee && (
                                                <Avatar
                                                    name={`${assignee.firstName} ${assignee.lastName}`}
                                                    src={assignee.avatarUrl}
                                                    size={20}
                                                />
                                            )}
                                        </div>
                                    </div>
                                </button>
                            );
                        })}
                    </div>
                )}
            </div>

            <TaskDetailDrawer
                taskId={openTaskId}
                listId={openTask?.primaryListId ?? ""}
                onClose={() => {
                    const next = new URLSearchParams(searchParams);
                    next.delete("task");
                    setSearchParams(next, { replace: true });
                }}
            />
        </div>
    );
};

export default SprintBoardPage;
