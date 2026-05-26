import { useQuery } from "@tanstack/react-query";
import { Skeleton } from "antd";
import { GripVertical, Sparkles } from "lucide-react";
import { mockApi } from "../../lib/mock-api";
import { useAuthStore } from "../../stores/auth";
import { statusesById } from "../../mocks/statuses";
import { EmptyState } from "../../components/ui/EmptyState";
import { PriorityFlag } from "../../components/ui/PriorityFlag";
import { StatusPill } from "../../components/ui/StatusPill";
import { tokens } from "../../theme";

/**
 * LineUp = a curated personal queue. For Phase 2 we pre-seed it with the
 * user's Today + Overdue tasks. Drag-to-reorder will come in Phase 3.
 */
export const LineupCard = () => {
    const user = useAuthStore((s) => s.user);
    const { data, isLoading } = useQuery({
        queryKey: ["my-work", user?.id],
        queryFn: () =>
            user ? mockApi.tasks.myWork(user.id) : Promise.resolve(null),
        enabled: !!user,
    });

    const lineup = [...(data?.overdue ?? []), ...(data?.today ?? [])].slice(
        0,
        6,
    );

    return (
        <div
            style={{
                background: tokens.colors.bgSurface,
                border: `1px solid ${tokens.colors.border}`,
                borderRadius: tokens.radius.lg,
                minHeight: 280,
                display: "flex",
                flexDirection: "column",
            }}
        >
            <div
                style={{
                    padding: `${tokens.spacing[4]}px ${tokens.spacing[5]}px`,
                    borderBottom: `1px solid ${tokens.colors.borderSubtle}`,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                }}
            >
                <div
                    style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                    }}
                >
                    <Sparkles
                        size={14}
                        strokeWidth={1.75}
                        color={tokens.colors.primary}
                    />
                    <h3
                        style={{
                            margin: 0,
                            fontSize: tokens.typography.fontSize.base,
                            fontWeight: 600,
                            color: tokens.colors.textPrimary,
                        }}
                    >
                        LineUp
                    </h3>
                </div>
                <span
                    style={{
                        fontSize: 11,
                        color: tokens.colors.textMuted,
                    }}
                >
                    Your focus queue
                </span>
            </div>

            <div
                style={{
                    flex: 1,
                    overflowY: "auto",
                    padding: tokens.spacing[2],
                }}
            >
                {isLoading ? (
                    <Skeleton active paragraph={{ rows: 4 }} />
                ) : lineup.length === 0 ? (
                    <EmptyState
                        icon={Sparkles}
                        title="Your queue is empty"
                        description="Drag tasks here from My Work to focus your day."
                        compact
                    />
                ) : (
                    lineup.map((task, idx) => {
                        const status = statusesById.get(task.statusId);
                        return (
                            <div
                                key={task.id}
                                style={{
                                    display: "flex",
                                    alignItems: "center",
                                    gap: tokens.spacing[2],
                                    padding: "8px 10px",
                                    borderRadius: tokens.radius.md,
                                    cursor: "grab",
                                    transition: "background var(--transition-base)",
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
                                <GripVertical
                                    size={14}
                                    strokeWidth={1.5}
                                    color={tokens.colors.textMuted}
                                    style={{ cursor: "grab", flexShrink: 0 }}
                                />
                                <span
                                    style={{
                                        width: 18,
                                        fontFamily:
                                            tokens.typography.fontFamilyMono,
                                        fontSize: 11,
                                        color: tokens.colors.textMuted,
                                        flexShrink: 0,
                                    }}
                                >
                                    {idx + 1}.
                                </span>
                                <PriorityFlag priority={task.priority} size={12} />
                                <div
                                    style={{
                                        flex: 1,
                                        fontSize: tokens.typography.fontSize.sm,
                                        color: tokens.colors.textPrimary,
                                        overflow: "hidden",
                                        textOverflow: "ellipsis",
                                        whiteSpace: "nowrap",
                                    }}
                                >
                                    {task.name}
                                </div>
                                {status && (
                                    <StatusPill
                                        status={status}
                                        variant="dot"
                                        size="sm"
                                    />
                                )}
                            </div>
                        );
                    })
                )}
            </div>
        </div>
    );
};
