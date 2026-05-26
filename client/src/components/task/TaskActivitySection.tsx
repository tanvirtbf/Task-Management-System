import { useQuery } from "@tanstack/react-query";
import { History } from "lucide-react";
import { mockApi } from "../../lib/mock-api";
import { usersById } from "../../mocks/users";
import { tokens } from "../../theme";
import type { ActivityLogEntry } from "../../types";

const formatTime = (iso: string): string => {
    const diff = Date.now() - new Date(iso).getTime();
    const m = Math.floor(diff / 60000);
    if (m < 1) return "just now";
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    const d = Math.floor(h / 24);
    if (d < 7) return `${d}d ago`;
    return new Date(iso).toLocaleDateString();
};

const formatAction = (a: ActivityLogEntry): React.ReactNode => {
    const action = a.action.replace(/_/g, " ");
    const ctx = a.context as Record<string, unknown>;
    if (a.action === "task_created") return <>created this task</>;
    if (a.action === "status_changed")
        return (
            <>
                changed status from{" "}
                <Pill>{String(ctx.fromName ?? ctx.from ?? "—")}</Pill> to{" "}
                <Pill>{String(ctx.toName ?? ctx.to ?? "—")}</Pill>
            </>
        );
    if (a.action === "priority_changed")
        return (
            <>
                changed priority from{" "}
                <Pill>{String(ctx.from ?? "—")}</Pill> to{" "}
                <Pill>{String(ctx.to ?? "—")}</Pill>
            </>
        );
    if (a.action === "assigned")
        return <>assigned to {String(ctx.assigneeName ?? "—")}</>;
    if (a.action === "due_date_changed")
        return (
            <>
                set due date to <Pill>{String(ctx.to ?? "—")}</Pill>
            </>
        );
    if (a.action === "comment_added") return <>added a comment</>;
    if (a.action === "attachment_added") return <>uploaded an attachment</>;
    if (a.action === "tag_added")
        return (
            <>
                added tag <Pill>{String(ctx.tagName ?? "—")}</Pill>
            </>
        );
    return <>{action}</>;
};

interface Props {
    taskId: string;
}

export const TaskActivitySection = ({ taskId }: Props) => {
    const { data: events = [] } = useQuery({
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
                <History size={11} strokeWidth={1.75} />
                Activity
                <span
                    style={{
                        color: tokens.colors.textSecondary,
                        fontFamily: tokens.typography.fontFamilyMono,
                    }}
                >
                    {events.length}
                </span>
            </div>
            {events.length === 0 ? (
                <div
                    style={{
                        padding: 12,
                        textAlign: "center",
                        color: tokens.colors.textMuted,
                        fontSize: tokens.typography.fontSize.sm,
                        fontStyle: "italic",
                    }}
                >
                    No activity recorded yet.
                </div>
            ) : (
                <div
                    style={{
                        position: "relative",
                        display: "flex",
                        flexDirection: "column",
                        gap: 10,
                        paddingLeft: 8,
                    }}
                >
                    {/* Vertical line */}
                    <div
                        style={{
                            position: "absolute",
                            left: 11,
                            top: 4,
                            bottom: 4,
                            width: 1,
                            background: tokens.colors.borderSubtle,
                        }}
                    />
                    {events.map((a) => {
                        const actor = usersById.get(a.actorId);
                        const fullName = actor
                            ? `${actor.firstName} ${actor.lastName}`
                            : "Unknown";
                        return (
                            <div
                                key={a.id}
                                style={{
                                    display: "flex",
                                    gap: 10,
                                    alignItems: "flex-start",
                                    position: "relative",
                                    zIndex: 1,
                                }}
                            >
                                <span
                                    style={{
                                        width: 22,
                                        height: 22,
                                        borderRadius: "50%",
                                        background:
                                            tokens.colors.primarySubtle,
                                        color: tokens.colors.primary,
                                        display: "inline-flex",
                                        alignItems: "center",
                                        justifyContent: "center",
                                        fontSize: 9,
                                        fontWeight: 700,
                                        flexShrink: 0,
                                        border: `2px solid ${tokens.colors.bgSurface}`,
                                        fontFamily:
                                            tokens.typography.fontFamilyMono,
                                    }}
                                >
                                    {actor
                                        ? `${actor.firstName.charAt(0)}${actor.lastName.charAt(0)}`
                                        : "?"}
                                </span>
                                <div
                                    style={{
                                        flex: 1,
                                        minWidth: 0,
                                        fontSize:
                                            tokens.typography.fontSize.sm,
                                        lineHeight: 1.5,
                                    }}
                                >
                                    <span
                                        style={{
                                            fontWeight: 600,
                                            color: tokens.colors.textPrimary,
                                        }}
                                    >
                                        {fullName}
                                    </span>{" "}
                                    <span
                                        style={{
                                            color: tokens.colors.textSecondary,
                                        }}
                                    >
                                        {formatAction(a)}
                                    </span>
                                    <div
                                        style={{
                                            fontSize: 11,
                                            color: tokens.colors.textMuted,
                                            fontFamily:
                                                tokens.typography
                                                    .fontFamilyMono,
                                            marginTop: 2,
                                        }}
                                    >
                                        {formatTime(a.createdAt)}
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

const Pill = ({ children }: { children: React.ReactNode }) => (
    <span
        style={{
            display: "inline-block",
            padding: "1px 6px",
            margin: "0 1px",
            fontSize: 11,
            background: tokens.colors.bgMuted,
            borderRadius: 3,
            color: tokens.colors.textPrimary,
            fontWeight: 500,
            fontFamily: tokens.typography.fontFamilyMono,
        }}
    >
        {children}
    </span>
);
