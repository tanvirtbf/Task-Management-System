import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import {
    Button,
    Empty,
    Dropdown,
    App as AntApp,
} from "antd";
import {
    Inbox,
    Check,
    CheckCheck,
    Clock,
    Archive,
    AtSign,
    UserPlus,
    MessageCircle,
    AlertTriangle,
    CalendarClock,
    Zap,
    FileText,
    RotateCcw,
    MoreHorizontal,
} from "lucide-react";
import { mockApi } from "../../lib/mock-api";
import { useAuthStore } from "../../stores/auth";
import { LoadingState } from "../../components/shared/LoadingState";
import { usersById } from "../../mocks/users";
import { tokens } from "../../theme";
import type { Notification, NotificationType } from "../../types";

const TYPE_ICONS: Record<
    NotificationType,
    { icon: React.ComponentType<{ size?: number; strokeWidth?: number }>; color: string }
> = {
    assigned: { icon: UserPlus, color: "#4F46E5" },
    mentioned: { icon: AtSign, color: "#EC4899" },
    comment: { icon: MessageCircle, color: "#06B6D4" },
    status_change: { icon: RotateCcw, color: "#10B981" },
    due_soon: { icon: CalendarClock, color: "#F59E0B" },
    overdue: { icon: AlertTriangle, color: "#E11D48" },
    form_submitted: { icon: FileText, color: "#8B5CF6" },
    automation_failed: { icon: Zap, color: "#E11D48" },
    reminder_due: { icon: Clock, color: "#F59E0B" },
};

type FilterKey = "all" | "unread" | "mentions" | "assigned";

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

const groupByDay = (notifications: Notification[]) => {
    const groups: Record<string, Notification[]> = {};
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const yesterday = new Date(today);
    yesterday.setDate(today.getDate() - 1);
    const weekAgo = new Date(today);
    weekAgo.setDate(today.getDate() - 7);

    notifications.forEach((n) => {
        const d = new Date(n.createdAt);
        let key: string;
        if (d >= today) key = "Today";
        else if (d >= yesterday) key = "Yesterday";
        else if (d >= weekAgo) key = "This week";
        else key = "Earlier";
        (groups[key] ??= []).push(n);
    });
    return ["Today", "Yesterday", "This week", "Earlier"].filter(
        (k) => groups[k] && groups[k].length > 0,
    ).map((k) => ({ label: k, items: groups[k] }));
};

const InboxPage = () => {
    const user = useAuthStore((s) => s.user);
    const navigate = useNavigate();
    const qc = useQueryClient();
    const { message } = AntApp.useApp();
    const [filter, setFilter] = useState<FilterKey>("all");

    const { data: notifications = [], isLoading } = useQuery({
        queryKey: ["notifications", user?.id],
        queryFn: () =>
            user ? mockApi.notifications.list(user.id) : Promise.resolve([]),
        enabled: !!user,
    });

    const filtered = useMemo(() => {
        return notifications.filter((n) => {
            if (filter === "unread" && n.isRead) return false;
            if (filter === "mentions" && n.type !== "mentioned") return false;
            if (filter === "assigned" && n.type !== "assigned") return false;
            return true;
        });
    }, [notifications, filter]);

    const groups = useMemo(() => groupByDay(filtered), [filtered]);

    const counts = useMemo(() => {
        return {
            all: notifications.length,
            unread: notifications.filter((n) => !n.isRead).length,
            mentions: notifications.filter((n) => n.type === "mentioned").length,
            assigned: notifications.filter((n) => n.type === "assigned").length,
        };
    }, [notifications]);

    const markAsRead = useMutation({
        mutationFn: (id: string) => mockApi.notifications.markAsRead(id),
        onMutate: async (id) => {
            await qc.cancelQueries({ queryKey: ["notifications", user?.id] });
            const prev = qc.getQueryData<Notification[]>([
                "notifications",
                user?.id,
            ]);
            qc.setQueryData<Notification[]>(
                ["notifications", user?.id],
                (old = []) =>
                    old.map((n) =>
                        n.id === id ? { ...n, isRead: true } : n,
                    ),
            );
            return { prev };
        },
        onError: (_e, _v, ctx) => {
            if (ctx?.prev)
                qc.setQueryData(["notifications", user?.id], ctx.prev);
        },
        onSuccess: () => {
            qc.invalidateQueries({
                queryKey: ["notifications", "unread-count"],
            });
        },
    });

    const markUnread = useMutation({
        mutationFn: (id: string) => mockApi.notifications.markAsUnread(id),
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ["notifications"] });
        },
    });

    const markAll = useMutation({
        mutationFn: () =>
            user ? mockApi.notifications.markAllAsRead(user.id) : Promise.reject(),
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ["notifications"] });
            message.success("All notifications marked as read");
        },
    });

    const snooze = useMutation({
        mutationFn: ({ id, hours }: { id: string; hours: number }) =>
            mockApi.notifications.snooze(
                id,
                new Date(Date.now() + hours * 3600_000).toISOString(),
            ),
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ["notifications"] });
            message.success("Snoozed");
        },
    });

    const archive = useMutation({
        mutationFn: (id: string) => mockApi.notifications.archive(id),
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ["notifications"] });
            message.success("Archived");
        },
    });

    const handleClick = (n: Notification) => {
        if (!n.isRead) markAsRead.mutate(n.id);
        if (n.entityType === "task") navigate(`/t/${n.entityId}`);
    };

    if (!user) return <div>Not signed in</div>;

    return (
        <div
            style={{
                padding: tokens.spacing[6],
                maxWidth: 880,
                margin: "0 auto",
            }}
        >
            <div
                style={{
                    display: "flex",
                    alignItems: "center",
                    gap: tokens.spacing[3],
                    marginBottom: tokens.spacing[5],
                }}
            >
                <div
                    style={{
                        width: 44,
                        height: 44,
                        borderRadius: tokens.radius.lg,
                        background: tokens.colors.primarySubtle,
                        color: tokens.colors.primary,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                    }}
                >
                    <Inbox size={22} strokeWidth={1.75} />
                </div>
                <div style={{ flex: 1 }}>
                    <h1
                        style={{
                            margin: 0,
                            fontSize: tokens.typography.fontSize["3xl"],
                            fontWeight: 700,
                            letterSpacing: "-0.02em",
                        }}
                    >
                        Inbox
                    </h1>
                    <p
                        style={{
                            margin: 0,
                            marginTop: 2,
                            color: tokens.colors.textSecondary,
                            fontSize: tokens.typography.fontSize.sm,
                        }}
                    >
                        {counts.unread > 0
                            ? `${counts.unread} unread`
                            : "All caught up"}
                    </p>
                </div>
                {counts.unread > 0 && (
                    <Button
                        icon={<CheckCheck size={14} strokeWidth={1.75} />}
                        onClick={() => markAll.mutate()}
                        loading={markAll.isPending}
                    >
                        Mark all as read
                    </Button>
                )}
            </div>

            {/* Filter chips */}
            <div
                style={{
                    display: "flex",
                    gap: 6,
                    marginBottom: tokens.spacing[3],
                }}
            >
                {(
                    [
                        ["all", "All", counts.all],
                        ["unread", "Unread", counts.unread],
                        ["mentions", "@Mentions", counts.mentions],
                        ["assigned", "Assigned to me", counts.assigned],
                    ] as const
                ).map(([key, label, count]) => {
                    const active = filter === key;
                    return (
                        <button
                            key={key}
                            onClick={() => setFilter(key as FilterKey)}
                            style={{
                                display: "inline-flex",
                                alignItems: "center",
                                gap: 6,
                                padding: "5px 11px",
                                background: active
                                    ? tokens.colors.primary
                                    : tokens.colors.bgSurface,
                                border: `1px solid ${
                                    active
                                        ? tokens.colors.primary
                                        : tokens.colors.border
                                }`,
                                borderRadius: tokens.radius.full,
                                color: active
                                    ? "#fff"
                                    : tokens.colors.textPrimary,
                                fontSize: 12,
                                fontWeight: active ? 600 : 500,
                                cursor: "pointer",
                            }}
                        >
                            {label}
                            <span
                                style={{
                                    fontSize: 10,
                                    fontFamily:
                                        tokens.typography.fontFamilyMono,
                                    color: active
                                        ? "rgba(255,255,255,0.8)"
                                        : tokens.colors.textMuted,
                                }}
                            >
                                {count}
                            </span>
                        </button>
                    );
                })}
            </div>

            {isLoading ? (
                <LoadingState />
            ) : groups.length === 0 ? (
                <Empty
                    image={
                        <Inbox
                            size={48}
                            strokeWidth={1.25}
                            color={tokens.colors.textMuted}
                        />
                    }
                    description={
                        filter === "all"
                            ? "Your inbox is empty."
                            : "Nothing matches this filter."
                    }
                />
            ) : (
                <div
                    style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: tokens.spacing[4],
                    }}
                >
                    {groups.map((group) => (
                        <div key={group.label}>
                            <div
                                style={{
                                    fontSize: 11,
                                    fontWeight: 700,
                                    color: tokens.colors.textMuted,
                                    textTransform: "uppercase",
                                    letterSpacing: "0.08em",
                                    marginBottom: 8,
                                }}
                            >
                                {group.label}
                            </div>
                            <div
                                style={{
                                    background: tokens.colors.bgSurface,
                                    border: `1px solid ${tokens.colors.border}`,
                                    borderRadius: tokens.radius.lg,
                                    overflow: "hidden",
                                }}
                            >
                                {group.items.map((n, idx) => (
                                    <NotificationRow
                                        key={n.id}
                                        notification={n}
                                        isLast={idx === group.items.length - 1}
                                        onClick={() => handleClick(n)}
                                        onMarkRead={() =>
                                            markAsRead.mutate(n.id)
                                        }
                                        onMarkUnread={() =>
                                            markUnread.mutate(n.id)
                                        }
                                        onSnooze={(hours) =>
                                            snooze.mutate({
                                                id: n.id,
                                                hours,
                                            })
                                        }
                                        onArchive={() => archive.mutate(n.id)}
                                    />
                                ))}
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};

const NotificationRow = ({
    notification: n,
    isLast,
    onClick,
    onMarkRead,
    onMarkUnread,
    onSnooze,
    onArchive,
}: {
    notification: Notification;
    isLast: boolean;
    onClick: () => void;
    onMarkRead: () => void;
    onMarkUnread: () => void;
    onSnooze: (hours: number) => void;
    onArchive: () => void;
}) => {
    const actor = n.actorId ? usersById.get(n.actorId) : null;
    const { icon: Icon, color } = TYPE_ICONS[n.type];

    return (
        <div
            onClick={onClick}
            style={{
                display: "flex",
                alignItems: "flex-start",
                gap: 12,
                padding: tokens.spacing[3],
                borderBottom: isLast
                    ? "none"
                    : `1px solid ${tokens.colors.borderSubtle}`,
                background: n.isRead ? "transparent" : tokens.colors.primarySubtle,
                cursor: "pointer",
                transition: "background var(--transition-fast)",
            }}
            onMouseEnter={(e) => {
                if (n.isRead)
                    e.currentTarget.style.background = tokens.colors.bgHover;
            }}
            onMouseLeave={(e) => {
                if (n.isRead)
                    e.currentTarget.style.background = "transparent";
            }}
        >
            {!n.isRead && (
                <span
                    style={{
                        width: 6,
                        height: 6,
                        borderRadius: "50%",
                        background: tokens.colors.primary,
                        marginTop: 8,
                        flexShrink: 0,
                    }}
                />
            )}
            {n.isRead && <span style={{ width: 6, flexShrink: 0 }} />}

            <div
                style={{
                    width: 32,
                    height: 32,
                    borderRadius: tokens.radius.md,
                    background: `${color}1A`,
                    color,
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                }}
            >
                <Icon size={16} strokeWidth={1.75} />
            </div>

            <div style={{ flex: 1, minWidth: 0 }}>
                <div
                    style={{
                        fontSize: tokens.typography.fontSize.sm,
                        fontWeight: n.isRead ? 500 : 600,
                        color: tokens.colors.textPrimary,
                    }}
                >
                    {actor && (
                        <strong style={{ marginRight: 4 }}>
                            {actor.firstName} {actor.lastName}
                        </strong>
                    )}
                    {n.title}
                </div>
                {n.body && (
                    <div
                        style={{
                            fontSize: 12,
                            color: tokens.colors.textMuted,
                            marginTop: 2,
                            lineHeight: 1.4,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            display: "-webkit-box",
                            WebkitLineClamp: 2,
                            WebkitBoxOrient: "vertical",
                        }}
                    >
                        {n.body}
                    </div>
                )}
                <div
                    style={{
                        fontSize: 11,
                        color: tokens.colors.textMuted,
                        marginTop: 4,
                        fontFamily: tokens.typography.fontFamilyMono,
                    }}
                >
                    {formatTime(n.createdAt)}
                    {n.snoozedUntil && (
                        <span
                            style={{
                                marginLeft: 6,
                                color: tokens.colors.warning,
                            }}
                        >
                            · snoozed until{" "}
                            {new Date(n.snoozedUntil).toLocaleString()}
                        </span>
                    )}
                </div>
            </div>

            <div
                style={{
                    display: "flex",
                    gap: 4,
                    flexShrink: 0,
                }}
                onClick={(e) => e.stopPropagation()}
            >
                {!n.isRead ? (
                    <Button
                        size="small"
                        type="text"
                        title="Mark as read"
                        icon={<Check size={13} strokeWidth={1.75} />}
                        onClick={onMarkRead}
                    />
                ) : (
                    <Button
                        size="small"
                        type="text"
                        title="Mark as unread"
                        icon={
                            <span
                                style={{
                                    display: "inline-block",
                                    width: 7,
                                    height: 7,
                                    borderRadius: "50%",
                                    background: tokens.colors.primary,
                                }}
                            />
                        }
                        onClick={onMarkUnread}
                    />
                )}
                <Dropdown
                    trigger={["click"]}
                    menu={{
                        items: [
                            {
                                key: "snooze-1",
                                icon: <Clock size={13} strokeWidth={1.75} />,
                                label: "Snooze 1 hour",
                                onClick: () => onSnooze(1),
                            },
                            {
                                key: "snooze-4",
                                icon: <Clock size={13} strokeWidth={1.75} />,
                                label: "Snooze 4 hours",
                                onClick: () => onSnooze(4),
                            },
                            {
                                key: "snooze-24",
                                icon: <Clock size={13} strokeWidth={1.75} />,
                                label: "Snooze 1 day",
                                onClick: () => onSnooze(24),
                            },
                            { type: "divider" },
                            {
                                key: "archive",
                                icon: (
                                    <Archive size={13} strokeWidth={1.75} />
                                ),
                                label: "Archive",
                                danger: true,
                                onClick: onArchive,
                            },
                        ],
                    }}
                >
                    <Button
                        size="small"
                        type="text"
                        icon={
                            <MoreHorizontal
                                size={14}
                                strokeWidth={1.75}
                            />
                        }
                    />
                </Dropdown>
            </div>
        </div>
    );
};

export default InboxPage;
