import { useQuery } from "@tanstack/react-query";
import { Skeleton, Button } from "antd";
import { Bell, Plus } from "lucide-react";
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

export const RemindersDueCard = () => {
    const user = useAuthStore((s) => s.user);
    const { data: reminders, isLoading } = useQuery({
        queryKey: ["reminders-due", user?.id],
        queryFn: () =>
            user ? mockApi.reminders.dueToday(user.id) : Promise.resolve([]),
        enabled: !!user,
    });

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
                    <Bell
                        size={14}
                        strokeWidth={1.75}
                        color={tokens.colors.warning}
                    />
                    <h3
                        style={{
                            margin: 0,
                            fontSize: tokens.typography.fontSize.base,
                            fontWeight: 600,
                            color: tokens.colors.textPrimary,
                        }}
                    >
                        Reminders
                    </h3>
                </div>
                <Button
                    type="text"
                    size="small"
                    icon={<Plus size={12} strokeWidth={2} />}
                >
                    New
                </Button>
            </div>

            <div
                style={{
                    flex: 1,
                    overflowY: "auto",
                    padding: tokens.spacing[3],
                }}
            >
                {isLoading ? (
                    <Skeleton active paragraph={{ rows: 3 }} />
                ) : !reminders || reminders.length === 0 ? (
                    <EmptyState
                        icon={Bell}
                        title="No reminders today"
                        description="You'll see what's coming up next here."
                        compact
                    />
                ) : (
                    <div
                        style={{
                            display: "flex",
                            flexDirection: "column",
                            gap: tokens.spacing[2],
                        }}
                    >
                        {reminders.map((r) => (
                            <div
                                key={r.id}
                                style={{
                                    display: "flex",
                                    gap: tokens.spacing[2],
                                    alignItems: "flex-start",
                                    padding: tokens.spacing[3],
                                    borderRadius: tokens.radius.md,
                                    background: tokens.colors.warningSubtle,
                                    border: `1px solid #FEF3C7`,
                                }}
                            >
                                <Bell
                                    size={14}
                                    strokeWidth={1.75}
                                    color={tokens.colors.warning}
                                    style={{ marginTop: 2, flexShrink: 0 }}
                                />
                                <div style={{ flex: 1, minWidth: 0 }}>
                                    <div
                                        style={{
                                            fontSize: tokens.typography.fontSize.sm,
                                            fontWeight: 500,
                                            color: tokens.colors.textPrimary,
                                            marginBottom: 2,
                                        }}
                                    >
                                        {r.title}
                                    </div>
                                    <div
                                        style={{
                                            fontFamily:
                                                tokens.typography.fontFamilyMono,
                                            fontSize: 11,
                                            color: tokens.colors.warning,
                                            fontWeight: 600,
                                        }}
                                    >
                                        {formatTime(r.dueAt)}
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
};
