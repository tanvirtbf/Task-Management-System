import { useQuery } from "@tanstack/react-query";
import { Skeleton } from "antd";
import { Activity } from "lucide-react";
import { activityApi } from "../../http/api";
import { Avatar } from "../../components/ui/Avatar";
import { EmptyState } from "../../components/ui/EmptyState";
import { tokens } from "../../theme";

const timeAgo = (iso: string): string => {
    const diff = Date.now() - new Date(iso).getTime();
    const m = Math.floor(diff / (1000 * 60));
    if (m < 1) return "just now";
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    const d = Math.floor(h / 24);
    return `${d}d ago`;
};

const actionVerb = (action: string): string => {
    switch (action) {
        case "created":
            return "created";
        case "status_changed":
            return "moved";
        case "assigned":
            return "assigned";
        case "completed":
            return "completed";
        case "comment_posted":
            return "commented on";
        case "moved":
            return "moved";
        case "priority_changed":
            return "changed priority on";
        // upgrades/017 + /023 — the two rows a permanent task delete leaves
        // behind. Without these they rendered as "task hard deleted an item".
        case "task_hard_deleted":
        case "deleted":
            return "permanently deleted";
        default:
            return action.replace(/_/g, " ");
    }
};

export const RecentActivityCard = () => {
    const { data, isLoading } = useQuery({
        queryKey: ["recent-activity"],
        queryFn: () => activityApi.recent(8),
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
                    gap: 6,
                }}
            >
                <Activity
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
                    Recent Activity
                </h3>
            </div>

            <div
                style={{
                    flex: 1,
                    overflowY: "auto",
                    padding: tokens.spacing[3],
                }}
            >
                {isLoading ? (
                    <Skeleton active paragraph={{ rows: 5 }} avatar />
                ) : !data || data.length === 0 ? (
                    <EmptyState
                        icon={Activity}
                        title="No recent activity"
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
                        {data.map((entry) => {
                            const actor = entry.actor;
                            return (
                                <div
                                    key={entry.id}
                                    style={{
                                        display: "flex",
                                        gap: tokens.spacing[2],
                                        alignItems: "flex-start",
                                    }}
                                >
                                    <Avatar
                                        name={
                                            actor
                                                ? `${actor.firstName} ${actor.lastName}`
                                                : "?"
                                        }
                                        src={actor?.avatarUrl}
                                        size={24}
                                    />
                                    <div
                                        style={{
                                            flex: 1,
                                            minWidth: 0,
                                            fontSize: tokens.typography.fontSize.sm,
                                            color: tokens.colors.textSecondary,
                                            lineHeight: 1.4,
                                        }}
                                    >
                                        <span
                                            style={{
                                                fontWeight: 600,
                                                color: tokens.colors.textPrimary,
                                            }}
                                        >
                                            {actor?.firstName ?? "Someone"}
                                        </span>{" "}
                                        {actionVerb(entry.action)}{" "}
                                        <span style={{ fontWeight: 500 }}>
                                            {/* `taskName` is what the task
                                                rows carry; the workspace-level
                                                rows (a hard delete, a member
                                                removal) carry `name` — reading
                                                only the first rendered every
                                                one of them as "an item". */}
                                            {(entry.context?.taskName as
                                                | string
                                                | undefined) ??
                                                (entry.context?.name as
                                                    | string
                                                    | undefined) ??
                                                "an item"}
                                        </span>
                                        <div
                                            style={{
                                                fontSize: 11,
                                                color: tokens.colors.textMuted,
                                                marginTop: 1,
                                            }}
                                        >
                                            {timeAgo(entry.createdAt)}
                                            {entry.context?.listName &&
                                                ` · in ${entry.context.listName}`}
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        </div>
    );
};
