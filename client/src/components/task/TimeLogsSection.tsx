import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import dayjs from "dayjs";
import { Clock, Trash2 } from "lucide-react";
import { App as AntApp, Popconfirm } from "antd";
import { mockApi } from "../../lib/mock-api";
import { usersById } from "../../mocks/users";
import { useAuthStore } from "../../stores/auth";
import { tokens } from "../../theme";

const formatHM = (s: number): string => {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    if (h === 0) return `${m}m`;
    return `${h}h ${m}m`;
};

interface Props {
    taskId: string;
}

export const TimeLogsSection = ({ taskId }: Props) => {
    const qc = useQueryClient();
    const { message } = AntApp.useApp();
    const user = useAuthStore((s) => s.user);

    const { data: logs = [] } = useQuery({
        queryKey: ["time-logs", taskId],
        queryFn: () => mockApi.timeTracking.byTask(taskId),
    });

    const remove = useMutation({
        mutationFn: (id: string) => mockApi.timeTracking.delete(id),
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ["time-logs", taskId] });
            qc.invalidateQueries({ queryKey: ["task", taskId] });
            message.success("Time log removed");
        },
    });

    const total = logs.reduce((s, l) => s + l.durationSeconds, 0);

    if (logs.length === 0) return null;

    return (
        <div
            style={{
                padding: `${tokens.spacing[3]}px ${tokens.spacing[5]}px`,
                borderBottom: `1px solid ${tokens.colors.borderSubtle}`,
            }}
        >
            <div
                style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    marginBottom: tokens.spacing[2],
                    fontSize: 11,
                    fontWeight: 600,
                    textTransform: "uppercase",
                    letterSpacing: "0.05em",
                    color: tokens.colors.textMuted,
                }}
            >
                <Clock size={11} strokeWidth={1.75} />
                Time logs
                <span
                    style={{
                        color: tokens.colors.textSecondary,
                        fontFamily: tokens.typography.fontFamilyMono,
                    }}
                >
                    {logs.length} · {formatHM(total)}
                </span>
            </div>
            <div
                style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 4,
                }}
            >
                {logs.map((l) => {
                    const author = usersById.get(l.userId);
                    const canDelete = user?.id === l.userId;
                    return (
                        <div
                            key={l.id}
                            style={{
                                display: "flex",
                                alignItems: "center",
                                gap: 8,
                                padding: "6px 10px",
                                background: tokens.colors.bgMuted,
                                borderRadius: tokens.radius.sm,
                                fontSize: 12,
                            }}
                        >
                            <span
                                style={{
                                    fontFamily:
                                        tokens.typography.fontFamilyMono,
                                    fontWeight: 700,
                                    color: tokens.colors.textPrimary,
                                    minWidth: 60,
                                }}
                            >
                                {formatHM(l.durationSeconds)}
                            </span>
                            <span
                                style={{
                                    color: tokens.colors.textSecondary,
                                    flex: 1,
                                    overflow: "hidden",
                                    textOverflow: "ellipsis",
                                    whiteSpace: "nowrap",
                                }}
                            >
                                {l.note || (
                                    <em
                                        style={{
                                            color: tokens.colors.textMuted,
                                        }}
                                    >
                                        no note
                                    </em>
                                )}
                            </span>
                            <span
                                style={{
                                    fontSize: 11,
                                    color: tokens.colors.textMuted,
                                    fontFamily:
                                        tokens.typography.fontFamilyMono,
                                }}
                            >
                                {author?.firstName} ·{" "}
                                {dayjs(l.startedAt).format("MMM D, HH:mm")}
                            </span>
                            {canDelete && (
                                <Popconfirm
                                    title="Remove this time log?"
                                    onConfirm={() => remove.mutate(l.id)}
                                    okType="danger"
                                >
                                    <button
                                        aria-label="Delete log"
                                        title="Delete"
                                        style={{
                                            background: "transparent",
                                            border: 0,
                                            cursor: "pointer",
                                            color: tokens.colors.textMuted,
                                            padding: 2,
                                            display: "inline-flex",
                                        }}
                                    >
                                        <Trash2
                                            size={11}
                                            strokeWidth={1.75}
                                        />
                                    </button>
                                </Popconfirm>
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
};
