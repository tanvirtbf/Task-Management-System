import { useQuery } from "@tanstack/react-query";
import { Skeleton } from "antd";
import { CalendarDays } from "lucide-react";
import { tasksApi } from "../../http/api";
import { useAuthStore } from "../../stores/auth";
import { EmptyState } from "../../components/ui/EmptyState";
import { tokens } from "../../theme";

/**
 * F24 (ISS-056): this card used to render `formatTime(due_date)`.
 *
 * `due_date` is a DATE column and reaches the client as "2026-07-30".
 * `new Date("2026-07-30")` parses as UTC midnight, so the "time" was really
 * the VIEWER'S OFFSET from midnight UTC — every row read "6:00 AM" in Dhaka,
 * "12:00 AM" in UTC, and "8:00 PM the previous day" in New York. The sort by
 * that value was a no-op for the same reason: every row carried the same
 * instant. `tasks` has no time-of-day column anywhere, so there is no time to
 * show; the column now carries the task's PRIORITY, which is real, and the
 * list sorts by it (urgent first) — a sort that actually orders the day.
 */
const PRIORITY_LABEL: Record<number, string> = {
    0: "—",
    1: "Urgent",
    2: "High",
    3: "Normal",
    4: "Low",
};

/** Urgent (1) first, then High, Normal, Low; "None" (0) last. */
const priorityRank = (p: number | null | undefined): number =>
    p === null || p === undefined || p === 0 ? 99 : p;

export const AgendaCard = () => {
    const user = useAuthStore((s) => s.user);
    const { data: myWork, isLoading: loadingWork } = useQuery({
        queryKey: ["my-work", user?.id],
        queryFn: () => tasksApi.myWork(),
        enabled: !!user,
    });

    const todayTasks = myWork?.today ?? [];

    const items: Array<{
        priority: number;
        title: string;
        id: string;
    }> = todayTasks
        .filter((t) => t.dueDate)
        .map((t) => ({
            priority: t.priority ?? 0,
            title: t.name,
            id: t.id,
        }))
        .sort(
            (a, b) =>
                priorityRank(a.priority) - priorityRank(b.priority) ||
                a.title.localeCompare(b.title),
        );

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
                                    {PRIORITY_LABEL[item.priority] ?? "—"}
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
