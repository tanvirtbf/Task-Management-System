import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Input, Button, Skeleton, Progress } from "antd";
import { ListTree, Plus, ChevronRight } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { mockApi } from "../../lib/mock-api";
import { statusesById } from "../../mocks/statuses";
import { usersById } from "../../mocks/users";
import { Avatar } from "../ui/Avatar";
import { tokens } from "../../theme";
import type { Task } from "../../types";

interface Props {
    task: Task;
}

export const SubtasksSection = ({ task }: Props) => {
    const qc = useQueryClient();
    const navigate = useNavigate();
    const [showInput, setShowInput] = useState(false);
    const [draft, setDraft] = useState("");

    const { data: subtasks = [], isLoading } = useQuery({
        queryKey: ["subtasks", task.id],
        queryFn: () => mockApi.tasks.subtasks(task.id),
    });

    const create = useMutation({
        mutationFn: (name: string) =>
            mockApi.tasks.create({
                primaryListId: task.primaryListId,
                name,
                parentTaskId: task.id,
                taskTypeId: task.taskTypeId,
            }),
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ["subtasks", task.id] });
            qc.invalidateQueries({ queryKey: ["task", task.id] });
            setDraft("");
        },
    });

    const handleAdd = () => {
        const lines = draft
            .split("\n")
            .map((l) => l.trim())
            .filter(Boolean);
        for (const line of lines) create.mutate(line);
        setShowInput(false);
    };

    const total = subtasks.length;
    const done = subtasks.filter((s) => {
        const status = statusesById.get(s.statusId);
        return (
            status?.statusGroup === "done" || status?.statusGroup === "closed"
        );
    }).length;
    const percent = total > 0 ? Math.round((done / total) * 100) : 0;

    return (
        <div
            style={{
                padding: `${tokens.spacing[4]}px ${tokens.spacing[5]}px`,
                borderBottom: `1px solid ${tokens.colors.borderSubtle}`,
            }}
        >
            <div
                style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    marginBottom: tokens.spacing[3],
                    fontSize: 11,
                    fontWeight: 600,
                    textTransform: "uppercase",
                    letterSpacing: "0.05em",
                    color: tokens.colors.textMuted,
                }}
            >
                <ListTree size={11} strokeWidth={1.75} />
                Subtasks
                <span
                    style={{
                        color: tokens.colors.textSecondary,
                        fontFamily: tokens.typography.fontFamilyMono,
                    }}
                >
                    {done}/{total}
                </span>
                <Button
                    type="text"
                    size="small"
                    icon={<Plus size={12} strokeWidth={2} />}
                    onClick={() => setShowInput((v) => !v)}
                    style={{ marginLeft: "auto" }}
                >
                    Add
                </Button>
            </div>

            {total > 0 && (
                <Progress
                    percent={percent}
                    size="small"
                    strokeColor={tokens.colors.success}
                    style={{ marginBottom: tokens.spacing[2] }}
                />
            )}

            {isLoading ? (
                <Skeleton active paragraph={{ rows: 2 }} />
            ) : (
                <div
                    style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: 2,
                    }}
                >
                    {subtasks.map((s) => {
                        const status = statusesById.get(s.statusId);
                        const assignee = s.assignees[0]
                            ? usersById.get(s.assignees[0])
                            : null;
                        const isDone =
                            status?.statusGroup === "done" ||
                            status?.statusGroup === "closed";
                        return (
                            <button
                                key={s.id}
                                onClick={() => {
                                    const url = new URL(window.location.href);
                                    url.searchParams.set("task", s.id);
                                    navigate(
                                        `${url.pathname}${url.search}`,
                                    );
                                }}
                                style={{
                                    display: "flex",
                                    alignItems: "center",
                                    gap: 8,
                                    padding: "6px 8px",
                                    border: 0,
                                    background: "transparent",
                                    borderRadius: tokens.radius.sm,
                                    cursor: "pointer",
                                    textAlign: "left",
                                    width: "100%",
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
                                <ChevronRight
                                    size={11}
                                    strokeWidth={1.75}
                                    color={tokens.colors.textMuted}
                                />
                                <span
                                    style={{
                                        width: 8,
                                        height: 8,
                                        borderRadius: "50%",
                                        background: status?.color ?? "#94A3B8",
                                        flexShrink: 0,
                                    }}
                                />
                                <span
                                    style={{
                                        flex: 1,
                                        fontSize:
                                            tokens.typography.fontSize.sm,
                                        color: isDone
                                            ? tokens.colors.textMuted
                                            : tokens.colors.textPrimary,
                                        textDecoration: isDone
                                            ? "line-through"
                                            : "none",
                                        overflow: "hidden",
                                        textOverflow: "ellipsis",
                                        whiteSpace: "nowrap",
                                    }}
                                >
                                    {s.name}
                                </span>
                                {assignee && (
                                    <Avatar
                                        name={`${assignee.firstName} ${assignee.lastName}`}
                                        src={assignee.avatarUrl}
                                        size={18}
                                    />
                                )}
                            </button>
                        );
                    })}
                </div>
            )}

            {showInput && (
                <div style={{ marginTop: tokens.spacing[3] }}>
                    <Input.TextArea
                        autoFocus
                        autoSize={{ minRows: 2, maxRows: 6 }}
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        placeholder="One subtask per line. Press ⌘+Enter to add."
                        onKeyDown={(e) => {
                            if (
                                e.key === "Enter" &&
                                (e.metaKey || e.ctrlKey) &&
                                draft.trim()
                            ) {
                                handleAdd();
                            }
                            if (e.key === "Escape") {
                                setDraft("");
                                setShowInput(false);
                            }
                        }}
                    />
                </div>
            )}
        </div>
    );
};
