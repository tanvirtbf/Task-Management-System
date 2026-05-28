import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { Progress, Select, Empty } from "antd";
import { Zap, Target, CalendarRange } from "lucide-react";
import { mockApi } from "../../lib/mock-api";
import { sprints } from "../../mocks/sprints";
import { statusesByList } from "../../mocks/statuses";
import { taskTypesById } from "../../mocks/task-types";
import { usersById } from "../../mocks/users";
import { TaskDetailDrawer } from "../../components/task/TaskDetailDrawer";
import { BugSeverityRail, BugSeverityBadge } from "../../components/task/BugSeverityBadge";
import { StoryPointsBadge } from "../../components/task/StoryPointsBadge";
import { Avatar } from "../../components/ui/Avatar";
import { DynamicIcon } from "../../components/shared/DynamicIcon";
import { tokens } from "../../theme";

const SPRINT_LIST_ID = "l-sprint";

const SprintBoardPage = () => {
    const [searchParams, setSearchParams] = useSearchParams();
    const openTaskId = searchParams.get("task");
    const [sprintId, setSprintId] = useState<string>(
        sprints.find((s) => s.status === "active")?.id ?? sprints[0]?.id ?? "",
    );

    const sprint = sprints.find((s) => s.id === sprintId);
    const statuses = statusesByList(SPRINT_LIST_ID);

    const { data: tasks = [] } = useQuery({
        queryKey: ["tasks-by-list", SPRINT_LIST_ID],
        queryFn: () => mockApi.tasks.listByList(SPRINT_LIST_ID),
    });

    const sprintTasks = tasks.filter((t) => t.sprintId === sprintId);
    const tasksByStatus = new Map<string, typeof tasks>();
    for (const s of statuses) tasksByStatus.set(s.id, []);
    for (const t of sprintTasks) {
        tasksByStatus.get(t.statusId)?.push(t);
    }

    const totalPoints = sprintTasks.reduce(
        (acc, t) => acc + (t.storyPoints ?? 0),
        0,
    );
    const donePoints = sprintTasks
        .filter((t) => {
            const s = statuses.find((x) => x.id === t.statusId);
            return s?.statusGroup === "done" || s?.statusGroup === "closed";
        })
        .reduce((acc, t) => acc + (t.storyPoints ?? 0), 0);

    const committedPoints = sprint?.committedPoints ?? 0;
    const percent =
        committedPoints > 0
            ? Math.min(100, Math.round((donePoints / committedPoints) * 100))
            : 0;

    return (
        <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
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
                    <div style={{ flex: 1 }}>
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
                        {sprint && (
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
                        value={sprintId}
                        onChange={setSprintId}
                        style={{ minWidth: 220 }}
                        options={sprints.map((s) => ({
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
                                flex: 1,
                                display: "flex",
                                alignItems: "center",
                                gap: 6,
                            }}
                        >
                            <span
                                style={{
                                    fontFamily:
                                        tokens.typography.fontFamilyMono,
                                    fontWeight: 700,
                                    color: tokens.colors.textPrimary,
                                }}
                            >
                                {donePoints}/{committedPoints} pts
                            </span>
                            <span style={{ color: tokens.colors.textMuted }}>
                                done · {totalPoints} pts planned
                            </span>
                            <Progress
                                percent={percent}
                                size="small"
                                strokeColor={tokens.colors.success}
                                style={{ flex: 1, margin: 0, marginLeft: 12 }}
                                showInfo={false}
                            />
                        </span>
                    </div>
                )}
            </div>

            {/* Kanban board */}
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
                            sprint?.status === "planned"
                                ? "Plan tasks into this sprint from the Backlog."
                                : sprint?.status === "closed"
                                  ? "This sprint is closed."
                                  : "No tasks in this sprint yet."
                        }
                        style={{ marginTop: 60 }}
                    />
                ) : (
                    <div
                        style={{
                            display: "grid",
                            gridAutoFlow: "column",
                            gridAutoColumns: "minmax(260px, 1fr)",
                            gap: tokens.spacing[3],
                        }}
                    >
                        {statuses.map((s) => {
                            const items = tasksByStatus.get(s.id) ?? [];
                            return (
                                <div
                                    key={s.id}
                                    style={{
                                        background: tokens.colors.bgPage,
                                        borderRadius: tokens.radius.md,
                                        padding: tokens.spacing[2],
                                        display: "flex",
                                        flexDirection: "column",
                                        minHeight: 200,
                                    }}
                                >
                                    <div
                                        style={{
                                            display: "flex",
                                            alignItems: "center",
                                            gap: 6,
                                            padding: "6px 6px 10px",
                                        }}
                                    >
                                        <span
                                            style={{
                                                width: 8,
                                                height: 8,
                                                borderRadius: "50%",
                                                background: s.color,
                                            }}
                                        />
                                        <span
                                            style={{
                                                fontSize: 11,
                                                fontWeight: 700,
                                                color: tokens.colors.textPrimary,
                                                textTransform: "uppercase",
                                                letterSpacing: "0.05em",
                                            }}
                                        >
                                            {s.name}
                                        </span>
                                        <span
                                            style={{
                                                marginLeft: "auto",
                                                fontSize: 11,
                                                color: tokens.colors.textMuted,
                                                fontFamily:
                                                    tokens.typography
                                                        .fontFamilyMono,
                                            }}
                                        >
                                            {items.length}
                                        </span>
                                    </div>
                                    <div
                                        style={{
                                            display: "flex",
                                            flexDirection: "column",
                                            gap: 6,
                                        }}
                                    >
                                        {items.map((t) => {
                                            const type = taskTypesById.get(
                                                t.taskTypeId,
                                            );
                                            const assignee = t.assignees[0]
                                                ? usersById.get(t.assignees[0])
                                                : null;
                                            return (
                                                <button
                                                    key={t.id}
                                                    onClick={() => {
                                                        const next =
                                                            new URLSearchParams(
                                                                searchParams,
                                                            );
                                                        next.set("task", t.id);
                                                        setSearchParams(next, {
                                                            replace: true,
                                                        });
                                                    }}
                                                    style={{
                                                        position: "relative",
                                                        background:
                                                            tokens.colors.bgSurface,
                                                        border: `1px solid ${tokens.colors.border}`,
                                                        borderRadius:
                                                            tokens.radius.md,
                                                        padding:
                                                            "8px 10px 8px 12px",
                                                        cursor: "pointer",
                                                        textAlign: "left",
                                                        display: "flex",
                                                        flexDirection: "column",
                                                        gap: 6,
                                                    }}
                                                >
                                                    <BugSeverityRail
                                                        severity={t.bugSeverity}
                                                    />
                                                    <div
                                                        style={{
                                                            display: "flex",
                                                            alignItems:
                                                                "center",
                                                            gap: 6,
                                                            fontSize: 11,
                                                            color: tokens.colors
                                                                .textMuted,
                                                            fontFamily:
                                                                tokens.typography
                                                                    .fontFamilyMono,
                                                        }}
                                                    >
                                                        {type && (
                                                            <DynamicIcon
                                                                name={type.icon}
                                                                size={11}
                                                                strokeWidth={1.75}
                                                                color={
                                                                    type.color
                                                                }
                                                            />
                                                        )}
                                                        {t.customId ??
                                                            `T-${t.taskNumber}`}
                                                        <BugSeverityBadge
                                                            severity={t.bugSeverity}
                                                            compact
                                                        />
                                                    </div>
                                                    <div
                                                        style={{
                                                            fontSize:
                                                                tokens.typography
                                                                    .fontSize.sm,
                                                            color: tokens.colors
                                                                .textPrimary,
                                                            lineHeight: 1.35,
                                                        }}
                                                    >
                                                        {t.name}
                                                    </div>
                                                    <div
                                                        style={{
                                                            display: "flex",
                                                            alignItems:
                                                                "center",
                                                            gap: 6,
                                                            marginTop: 2,
                                                        }}
                                                    >
                                                        <StoryPointsBadge
                                                            points={
                                                                t.storyPoints
                                                            }
                                                        />
                                                        {t.prStatus && (
                                                            <span
                                                                style={{
                                                                    fontSize: 10,
                                                                    fontWeight: 700,
                                                                    color:
                                                                        t.prStatus ===
                                                                        "merged"
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
                                                                PR{" "}
                                                                {t.prStatus.toUpperCase()}
                                                            </span>
                                                        )}
                                                        <div
                                                            style={{
                                                                marginLeft:
                                                                    "auto",
                                                            }}
                                                        >
                                                            {assignee && (
                                                                <Avatar
                                                                    name={`${assignee.firstName} ${assignee.lastName}`}
                                                                    src={
                                                                        assignee.avatarUrl
                                                                    }
                                                                    size={20}
                                                                />
                                                            )}
                                                        </div>
                                                    </div>
                                                </button>
                                            );
                                        })}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>

            <TaskDetailDrawer
                taskId={openTaskId}
                listId={SPRINT_LIST_ID}
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
