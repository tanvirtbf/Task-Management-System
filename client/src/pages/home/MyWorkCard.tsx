import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Skeleton } from "antd";
import { CheckCircle2, CalendarClock } from "lucide-react";
import { tasksApi } from "../../http/api";
import { useAuthStore } from "../../stores/auth";
import type { MyWorkBucket } from "../../types";
import { TaskRow } from "../../components/task/TaskRow";
import { EmptyState } from "../../components/ui/EmptyState";
import { tokens } from "../../theme";

type Tab = keyof MyWorkBucket;

const tabs: { key: Tab; label: string }[] = [
    { key: "today", label: "Today" },
    { key: "overdue", label: "Overdue" },
    { key: "next", label: "Next 7 days" },
    { key: "unscheduled", label: "Unscheduled" },
    { key: "done", label: "Done" },
];

export const MyWorkCard = () => {
    const user = useAuthStore((s) => s.user);
    const [active, setActive] = useState<Tab>("today");

    const { data, isLoading } = useQuery({
        queryKey: ["my-work", user?.id],
        queryFn: () => tasksApi.myWork(),
        enabled: !!user,
    });

    const tasks = data?.[active] ?? [];

    return (
        <div
            style={{
                background: tokens.colors.bgSurface,
                border: `1px solid ${tokens.colors.border}`,
                borderRadius: tokens.radius.lg,
                display: "flex",
                flexDirection: "column",
                minHeight: 380,
            }}
        >
            {/* Header */}
            <div
                style={{
                    padding: `${tokens.spacing[4]}px ${tokens.spacing[5]}px ${tokens.spacing[2]}px`,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    borderBottom: `1px solid ${tokens.colors.borderSubtle}`,
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
                    My Work
                </h3>
                <div
                    style={{
                        display: "flex",
                        // P5: without this the last two buckets ("Unscheduled",
                        // "Done") ran off a phone screen with nothing to scroll.
                        flexWrap: "wrap",
                        gap: 2,
                        background: tokens.colors.bgMuted,
                        borderRadius: tokens.radius.md,
                        padding: 2,
                    }}
                >
                    {tabs.map((tab) => {
                        const count = data?.[tab.key].length ?? 0;
                        const isActive = active === tab.key;
                        return (
                            <button
                                key={tab.key}
                                onClick={() => setActive(tab.key)}
                                style={{
                                    padding: "5px 10px",
                                    background: isActive
                                        ? tokens.colors.bgSurface
                                        : "transparent",
                                    border: 0,
                                    borderRadius: tokens.radius.sm,
                                    cursor: "pointer",
                                    fontSize: 12,
                                    fontWeight: isActive ? 600 : 500,
                                    color: isActive
                                        ? tokens.colors.textPrimary
                                        : tokens.colors.textSecondary,
                                    boxShadow: isActive ? tokens.shadows.sm : "none",
                                    transition: "all var(--transition-base)",
                                    display: "inline-flex",
                                    alignItems: "center",
                                    gap: 4,
                                }}
                            >
                                {tab.label}
                                {count > 0 && (
                                    <span
                                        style={{
                                            fontSize: 10,
                                            color: isActive
                                                ? tokens.colors.textMuted
                                                : tokens.colors.textMuted,
                                            fontFamily:
                                                tokens.typography.fontFamilyMono,
                                            background: tokens.colors.bgMuted,
                                            padding: "0 4px",
                                            borderRadius: 3,
                                            border: isActive
                                                ? `1px solid ${tokens.colors.border}`
                                                : "none",
                                        }}
                                    >
                                        {count}
                                    </span>
                                )}
                            </button>
                        );
                    })}
                </div>
            </div>

            {/* List */}
            <div
                style={{
                    flex: 1,
                    overflowY: "auto",
                    padding: tokens.spacing[2],
                }}
            >
                {isLoading ? (
                    <div style={{ padding: tokens.spacing[3] }}>
                        <Skeleton active paragraph={{ rows: 6 }} />
                    </div>
                ) : tasks.length === 0 ? (
                    <EmptyState
                        icon={active === "done" ? CheckCircle2 : CalendarClock}
                        title={
                            active === "today"
                                ? "Nothing due today"
                                : active === "overdue"
                                  ? "No overdue tasks 🎉"
                                  : active === "next"
                                    ? "Nothing scheduled for next 7 days"
                                    : active === "unscheduled"
                                      ? "All your tasks have dates"
                                      : "Nothing completed in the last 7 days"
                        }
                        description={
                            active === "today"
                                ? "You're all caught up. Take a moment."
                                : active === "overdue"
                                  ? "You're staying on top of everything."
                                  : undefined
                        }
                    />
                ) : (
                    tasks.map((task) => <TaskRow key={task.id} task={task} />)
                )}
            </div>
        </div>
    );
};
