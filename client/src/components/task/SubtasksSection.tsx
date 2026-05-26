import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Skeleton, Progress } from "antd";
import { ChevronDown, ChevronRight, GitBranch, Plus } from "lucide-react";
import { mockApi } from "../../lib/mock-api";
import { useCreateTask, useUpdateTask } from "../../hooks/useTaskMutations";
import { statusesById } from "../../mocks/statuses";
import { StatusPill } from "../ui/StatusPill";
import { PriorityFlag } from "../ui/PriorityFlag";
import { tokens } from "../../theme";
import type { Task } from "../../types";

export const SubtasksSection = ({ task }: { task: Task }) => {
    const [collapsed, setCollapsed] = useState(false);
    const [addingValue, setAddingValue] = useState("");
    const [adding, setAdding] = useState(false);

    const { data: subtasks = [], isLoading } = useQuery({
        queryKey: ["subtasks", task.id],
        queryFn: () => mockApi.tasks.subtasks(task.id),
    });

    const create = useCreateTask(task.primaryListId);
    const update = useUpdateTask(task.primaryListId);

    const done = subtasks.filter((s) => {
        const status = statusesById.get(s.statusId);
        return status?.statusGroup === "done" || status?.statusGroup === "closed";
    }).length;
    const total = subtasks.length;
    const percent = total > 0 ? Math.round((done / total) * 100) : 0;

    const handleAdd = () => {
        const v = addingValue.trim();
        if (!v) {
            setAdding(false);
            return;
        }
        create.mutate({
            primaryListId: task.primaryListId,
            parentTaskId: task.id,
            name: v,
        });
        setAddingValue("");
    };

    return (
        <div
            style={{
                padding: `${tokens.spacing[4]}px ${tokens.spacing[5]}px`,
                borderBottom: `1px solid ${tokens.colors.borderSubtle}`,
            }}
        >
            <button
                onClick={() => setCollapsed(!collapsed)}
                style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    background: "none",
                    border: 0,
                    padding: 0,
                    cursor: "pointer",
                    color: tokens.colors.textMuted,
                    fontSize: 11,
                    fontWeight: 600,
                    textTransform: "uppercase",
                    letterSpacing: "0.05em",
                    width: "100%",
                }}
            >
                {collapsed ? (
                    <ChevronRight size={11} strokeWidth={2} />
                ) : (
                    <ChevronDown size={11} strokeWidth={2} />
                )}
                <GitBranch size={11} strokeWidth={1.75} />
                Subtasks
                {total > 0 && (
                    <>
                        <span
                            style={{
                                marginLeft: 6,
                                fontFamily: tokens.typography.fontFamilyMono,
                                color: tokens.colors.textSecondary,
                            }}
                        >
                            {done}/{total}
                        </span>
                        <Progress
                            percent={percent}
                            showInfo={false}
                            size="small"
                            strokeWidth={4}
                            style={{
                                marginLeft: 8,
                                marginBottom: 0,
                                width: 80,
                                lineHeight: 1,
                            }}
                            strokeColor={tokens.colors.success}
                        />
                    </>
                )}
            </button>

            {!collapsed && (
                <div style={{ marginTop: tokens.spacing[2] }}>
                    {isLoading ? (
                        <Skeleton active paragraph={{ rows: 2 }} />
                    ) : (
                        <>
                            {subtasks.map((sub) => {
                                const status = statusesById.get(sub.statusId);
                                return (
                                    <div
                                        key={sub.id}
                                        style={{
                                            display: "flex",
                                            alignItems: "center",
                                            gap: 8,
                                            padding: "6px 8px",
                                            borderRadius: tokens.radius.md,
                                            cursor: "pointer",
                                        }}
                                        onMouseEnter={(e) =>
                                            (e.currentTarget.style.background =
                                                tokens.colors.bgHover)
                                        }
                                        onMouseLeave={(e) =>
                                            (e.currentTarget.style.background =
                                                "transparent")
                                        }
                                    >
                                        <PriorityFlag
                                            priority={sub.priority}
                                            size={12}
                                        />
                                        <span
                                            style={{
                                                flex: 1,
                                                fontSize: tokens.typography
                                                    .fontSize.sm,
                                                color:
                                                    status?.statusGroup === "done" ||
                                                    status?.statusGroup === "closed"
                                                        ? tokens.colors.textMuted
                                                        : tokens.colors.textPrimary,
                                                textDecoration:
                                                    status?.statusGroup === "done" ||
                                                    status?.statusGroup === "closed"
                                                        ? "line-through"
                                                        : "none",
                                            }}
                                        >
                                            {sub.name}
                                        </span>
                                        {status && (
                                            <StatusPill
                                                status={status}
                                                variant="dot"
                                                size="sm"
                                            />
                                        )}
                                    </div>
                                );
                            })}

                            {adding ? (
                                <div
                                    style={{
                                        display: "flex",
                                        alignItems: "center",
                                        gap: 6,
                                        padding: "6px 8px",
                                        border: `1px solid ${tokens.colors.primary}`,
                                        borderRadius: tokens.radius.md,
                                        marginTop: 4,
                                    }}
                                >
                                    <Plus
                                        size={13}
                                        strokeWidth={1.75}
                                        color={tokens.colors.primary}
                                    />
                                    <input
                                        autoFocus
                                        value={addingValue}
                                        onChange={(e) =>
                                            setAddingValue(e.target.value)
                                        }
                                        onBlur={handleAdd}
                                        onKeyDown={(e) => {
                                            if (e.key === "Enter") handleAdd();
                                            if (e.key === "Escape") {
                                                setAddingValue("");
                                                setAdding(false);
                                            }
                                        }}
                                        placeholder="Subtask name..."
                                        style={{
                                            flex: 1,
                                            border: 0,
                                            outline: "none",
                                            fontSize:
                                                tokens.typography.fontSize.sm,
                                            background: "transparent",
                                            color: tokens.colors.textPrimary,
                                        }}
                                    />
                                </div>
                            ) : (
                                <button
                                    onClick={() => setAdding(true)}
                                    style={{
                                        display: "flex",
                                        alignItems: "center",
                                        gap: 4,
                                        padding: "6px 8px",
                                        background: "none",
                                        border: 0,
                                        cursor: "pointer",
                                        fontSize: tokens.typography.fontSize.sm,
                                        color: tokens.colors.textMuted,
                                        borderRadius: tokens.radius.md,
                                        marginTop: 4,
                                    }}
                                    onMouseEnter={(e) =>
                                        (e.currentTarget.style.background =
                                            tokens.colors.bgHover)
                                    }
                                    onMouseLeave={(e) =>
                                        (e.currentTarget.style.background =
                                            "transparent")
                                    }
                                >
                                    <Plus size={12} strokeWidth={1.75} />
                                    Add subtask
                                </button>
                            )}
                        </>
                    )}
                </div>
            )}
        </div>
    );
};
