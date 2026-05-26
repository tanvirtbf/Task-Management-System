import dayjs from "dayjs";
import { activityForScope } from "./widget-data";
import { usersById } from "../../mocks/users";
import { tokens } from "../../theme";
import type { DashboardWidget } from "../../types/dashboard";

interface Props {
    widget: DashboardWidget;
}

const formatTime = (iso: string): string => {
    const diff = Date.now() - new Date(iso).getTime();
    const m = Math.floor(diff / 60000);
    if (m < 1) return "just now";
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    const d = Math.floor(h / 24);
    if (d < 30) return `${d}d ago`;
    return dayjs(iso).format("MMM D");
};

export const ActivityFeedWidget = ({ widget }: Props) => {
    const activity = activityForScope(widget.config);
    if (activity.length === 0) {
        return (
            <div
                style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    height: "100%",
                    color: tokens.colors.textMuted,
                    fontStyle: "italic",
                    fontSize: 12,
                }}
            >
                No recent activity
            </div>
        );
    }
    return (
        <div
            style={{
                display: "flex",
                flexDirection: "column",
                gap: 6,
                overflow: "auto",
            }}
        >
            {activity.map((a) => {
                const actor = usersById.get(a.actorId);
                return (
                    <div
                        key={a.id}
                        style={{
                            display: "flex",
                            gap: 8,
                            padding: "4px 0",
                            fontSize: 12,
                            color: tokens.colors.textSecondary,
                            borderBottom: `1px solid ${tokens.colors.borderSubtle}`,
                        }}
                    >
                        <span
                            style={{
                                width: 22,
                                height: 22,
                                borderRadius: "50%",
                                background: tokens.colors.primarySubtle,
                                color: tokens.colors.primary,
                                display: "inline-flex",
                                alignItems: "center",
                                justifyContent: "center",
                                fontSize: 9,
                                fontWeight: 700,
                                flexShrink: 0,
                            }}
                        >
                            {actor
                                ? `${actor.firstName.charAt(0)}${actor.lastName.charAt(0)}`
                                : "?"}
                        </span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                            <div
                                style={{
                                    overflow: "hidden",
                                    textOverflow: "ellipsis",
                                    whiteSpace: "nowrap",
                                }}
                            >
                                <strong
                                    style={{ color: tokens.colors.textPrimary }}
                                >
                                    {actor
                                        ? `${actor.firstName} ${actor.lastName}`
                                        : "Unknown"}
                                </strong>{" "}
                                {a.action.replace(/_/g, " ")}{" "}
                                {a.context.taskName && (
                                    <span
                                        style={{
                                            color: tokens.colors.textPrimary,
                                            fontWeight: 500,
                                        }}
                                    >
                                        {a.context.taskName}
                                    </span>
                                )}
                            </div>
                        </div>
                        <span
                            style={{
                                fontSize: 10,
                                color: tokens.colors.textMuted,
                                fontFamily: tokens.typography.fontFamilyMono,
                                flexShrink: 0,
                            }}
                        >
                            {formatTime(a.createdAt)}
                        </span>
                    </div>
                );
            })}
        </div>
    );
};
