import { useQuery } from "@tanstack/react-query";
import { Skeleton } from "antd";
import { Activity } from "lucide-react";
import { mockApi } from "../../lib/mock-api";
import { usersById } from "../../mocks/users";
import { Avatar } from "../ui/Avatar";
import { tokens } from "../../theme";

const timeAgo = (iso: string): string => {
    const diff = Date.now() - new Date(iso).getTime();
    const m = Math.floor(diff / (1000 * 60));
    if (m < 1) return "just now";
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    return `${Math.floor(h / 24)}d ago`;
};

const verb = (action: string): string => {
    switch (action) {
        case "created":
            return "created this task";
        case "status_changed":
            return "moved status";
        case "assigned":
            return "assigned this task";
        case "branch_created":
            return "created branch";
        case "pr_opened":
            return "opened pull request";
        case "pr_merged":
            return "merged pull request";
        case "comment_posted":
            return "commented";
        case "priority_changed":
            return "changed priority";
        case "completed":
            return "marked done";
        default:
            return action.replace(/_/g, " ");
    }
};

export const TaskActivitySection = ({ taskId }: { taskId: string }) => {
    const { data = [], isLoading } = useQuery({
        queryKey: ["task-activity", taskId],
        queryFn: () => mockApi.activity.byTask(taskId),
    });

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
                <Activity size={11} strokeWidth={1.75} />
                Activity
                <span
                    style={{
                        color: tokens.colors.textSecondary,
                        fontFamily: tokens.typography.fontFamilyMono,
                    }}
                >
                    {data.length}
                </span>
            </div>

            {isLoading ? (
                <Skeleton active paragraph={{ rows: 3 }} />
            ) : data.length === 0 ? (
                <div
                    style={{
                        fontSize: 12,
                        color: tokens.colors.textMuted,
                    }}
                >
                    No activity yet.
                </div>
            ) : (
                <div
                    style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: 8,
                    }}
                >
                    {data.map((entry) => {
                        const actor = usersById.get(entry.actorId);
                        return (
                            <div
                                key={entry.id}
                                style={{
                                    display: "flex",
                                    gap: 8,
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
                                    size={22}
                                />
                                <div
                                    style={{
                                        flex: 1,
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
                                    {verb(entry.action)}
                                    {entry.context.taskName && (
                                        <>
                                            {" — "}
                                            <span
                                                style={{
                                                    fontFamily:
                                                        tokens.typography
                                                            .fontFamilyMono,
                                                    fontSize: 12,
                                                    color: tokens.colors
                                                        .textPrimary,
                                                }}
                                            >
                                                {entry.context.taskName}
                                            </span>
                                        </>
                                    )}
                                    <div
                                        style={{
                                            fontSize: 11,
                                            color: tokens.colors.textMuted,
                                            marginTop: 1,
                                        }}
                                    >
                                        {timeAgo(entry.createdAt)}
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
};
