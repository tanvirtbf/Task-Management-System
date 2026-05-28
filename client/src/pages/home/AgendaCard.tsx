import { useQuery } from "@tanstack/react-query";
import { Skeleton } from "antd";
import { CalendarDays } from "lucide-react";
import { mockApi } from "../../lib/mock-api";
import { useAuthStore } from "../../stores/auth";
import { EmptyState } from "../../components/ui/EmptyState";
import { tokens } from "../../theme";

const formatTime = (iso: string) =>
    new Date(iso).toLocaleTimeString("en-US", {
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
    });

export const AgendaCard = () => {
    const user = useAuthStore((s) => s.user);
    const { data: myWork, isLoading: loadingWork } = useQuery({
        queryKey: ["my-work", user?.id],
        queryFn: () =>
            user ? mockApi.tasks.myWork(user.id) : Promise.resolve(null),
        enabled: !!user,
    });

    const todayTasks = myWork?.today ?? [];

    const items: Array<{
        time: string;
        title: string;
        id: string;
    }> = todayTasks
        .filter((t) => t.dueDate)
        .map((t) => ({
            time: t.dueDate!,
            title: t.name,
            id: t.id,
        }))
        .sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());

    const loading = loadingWork;

    return (
        <div
            style={{
                background: tokens.colors.bgSurface,
                border: `1px solid ${tokens.colors.border}`,
                borderRadius: tokens.radius.lg,
                minHeight: 380,
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
                <h3
                    style={{
                        margin: 0,
                        fontSize: tokens.typography.fontSize.lg,
                        fontWeight: 600,
                        color: tokens.colors.textPrimary,
                    }}
                >
                    Agenda
                </h3>
                <span
                    style={{
                        fontSize: 11,
                        color: tokens.colors.textMuted,
                        fontWeight: 500,
                        textTransform: "uppercase",
                        letterSpacing: "0.05em",
                    }}
                >
                    Today
                </span>
            </div>

            <div
                style={{
                    flex: 1,
                    overflowY: "auto",
                    padding: tokens.spacing[3],
                }}
            >
                {loading ? (
                    <Skeleton active paragraph={{ rows: 5 }} />
                ) : items.length === 0 ? (
                    <EmptyState
                        icon={CalendarDays}
                        title="No agenda today"
                        description="Tasks with a due date today show up here."
                        compact
                    />
                ) : (
                    <div
                        style={{
                            display: "flex",
                            flexDirection: "column",
                            gap: tokens.spacing[1],
                        }}
                    >
                        {items.map((item) => (
                            <div
                                key={item.id}
                                style={{
                                    display: "flex",
                                    gap: tokens.spacing[3],
                                    alignItems: "flex-start",
                                    padding: `${tokens.spacing[2]}px ${tokens.spacing[3]}px`,
                                    borderRadius: tokens.radius.md,
                                    transition:
                                        "background var(--transition-base)",
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
                                <div
                                    style={{
                                        fontFamily:
                                            tokens.typography.fontFamilyMono,
                                        fontSize: 11,
                                        color: tokens.colors.textMuted,
                                        width: 64,
                                        flexShrink: 0,
                                        paddingTop: 2,
                                    }}
                                >
                                    {formatTime(item.time)}
                                </div>
                                <div
                                    style={{
                                        width: 4,
                                        height: 4,
                                        borderRadius: "50%",
                                        background: tokens.colors.primary,
                                        marginTop: 8,
                                        flexShrink: 0,
                                    }}
                                />
                                <div
                                    style={{
                                        flex: 1,
                                        fontSize: tokens.typography.fontSize.sm,
                                        color: tokens.colors.textPrimary,
                                        lineHeight: 1.4,
                                        overflow: "hidden",
                                        textOverflow: "ellipsis",
                                        whiteSpace: "nowrap",
                                    }}
                                >
                                    {item.title}
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
};
