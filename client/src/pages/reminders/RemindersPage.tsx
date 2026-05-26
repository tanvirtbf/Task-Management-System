import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import {
    Button,
    Modal,
    Input,
    DatePicker,
    Select,
    App as AntApp,
    Empty,
    Dropdown,
} from "antd";
import dayjs from "dayjs";
import {
    Clock,
    Plus,
    Check,
    Trash2,
    AlertTriangle,
    CalendarClock,
    MoreHorizontal,
    LinkIcon,
} from "lucide-react";
import { mockApi } from "../../lib/mock-api";
import { useAuthStore } from "../../stores/auth";
import { users as allUsers } from "../../mocks/users";
import { tokens } from "../../theme";
import type { Reminder } from "../../types";

type Bucket = "overdue" | "today" | "tomorrow" | "upcoming" | "completed";

const BUCKETS: Array<{ key: Bucket; label: string; tone: string; icon: React.ComponentType<{ size?: number; strokeWidth?: number }> }> = [
    {
        key: "overdue",
        label: "Past due",
        tone: "#E11D48",
        icon: AlertTriangle,
    },
    { key: "today", label: "Today", tone: "#4F46E5", icon: Clock },
    { key: "tomorrow", label: "Tomorrow", tone: "#06B6D4", icon: Clock },
    {
        key: "upcoming",
        label: "Upcoming",
        tone: "#8B5CF6",
        icon: CalendarClock,
    },
    {
        key: "completed",
        label: "Completed",
        tone: "#10B981",
        icon: Check,
    },
];

const bucketize = (r: Reminder, now: dayjs.Dayjs): Bucket => {
    if (r.isCompleted) return "completed";
    const due = dayjs(r.dueAt);
    if (due.isBefore(now, "day")) return "overdue";
    if (due.isSame(now, "day")) return "today";
    if (due.isSame(now.add(1, "day"), "day")) return "tomorrow";
    return "upcoming";
};

const RemindersPage = () => {
    const user = useAuthStore((s) => s.user);
    const qc = useQueryClient();
    const { message } = AntApp.useApp();
    const [createOpen, setCreateOpen] = useState(false);
    const [showCompleted, setShowCompleted] = useState(false);

    const { data: reminders = [], isLoading } = useQuery({
        queryKey: ["reminders", user?.id],
        queryFn: () =>
            user ? mockApi.reminders.all(user.id) : Promise.resolve([]),
        enabled: !!user,
    });

    const grouped = useMemo(() => {
        const now = dayjs();
        const out: Record<Bucket, Reminder[]> = {
            overdue: [],
            today: [],
            tomorrow: [],
            upcoming: [],
            completed: [],
        };
        reminders.forEach((r) => {
            out[bucketize(r, now)].push(r);
        });
        Object.values(out).forEach((arr) =>
            arr.sort((a, b) => a.dueAt.localeCompare(b.dueAt)),
        );
        return out;
    }, [reminders]);

    const toggleComplete = useMutation({
        mutationFn: (id: string) => mockApi.reminders.toggleComplete(id),
        onMutate: async (id) => {
            await qc.cancelQueries({ queryKey: ["reminders", user?.id] });
            const prev = qc.getQueryData<Reminder[]>([
                "reminders",
                user?.id,
            ]);
            qc.setQueryData<Reminder[]>(
                ["reminders", user?.id],
                (old = []) =>
                    old.map((r) =>
                        r.id === id
                            ? {
                                  ...r,
                                  isCompleted: !r.isCompleted,
                                  completedAt: !r.isCompleted
                                      ? new Date().toISOString()
                                      : null,
                              }
                            : r,
                    ),
            );
            return { prev };
        },
        onError: (_e, _v, ctx) => {
            if (ctx?.prev) qc.setQueryData(["reminders", user?.id], ctx.prev);
        },
    });

    const remove = useMutation({
        mutationFn: (id: string) => mockApi.reminders.delete(id),
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ["reminders", user?.id] });
            message.success("Reminder deleted");
        },
    });

    const snooze = useMutation({
        mutationFn: ({ id, hours }: { id: string; hours: number }) =>
            mockApi.reminders.snooze(
                id,
                dayjs().add(hours, "hour").toISOString(),
            ),
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ["reminders", user?.id] });
            message.success("Snoozed");
        },
    });

    if (!user) return <div>Not signed in</div>;

    const activeCount =
        grouped.overdue.length +
        grouped.today.length +
        grouped.tomorrow.length +
        grouped.upcoming.length;

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
                    <Clock size={22} strokeWidth={1.75} />
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
                        Reminders
                    </h1>
                    <p
                        style={{
                            margin: 0,
                            marginTop: 2,
                            color: tokens.colors.textSecondary,
                            fontSize: tokens.typography.fontSize.sm,
                        }}
                    >
                        {activeCount === 0
                            ? "Nothing pending"
                            : `${activeCount} active`}
                    </p>
                </div>
                <Button
                    type="primary"
                    icon={<Plus size={14} strokeWidth={2} />}
                    onClick={() => setCreateOpen(true)}
                >
                    New reminder
                </Button>
            </div>

            {isLoading ? (
                <div>Loading...</div>
            ) : reminders.length === 0 ? (
                <Empty
                    image={
                        <Clock
                            size={48}
                            strokeWidth={1.25}
                            color={tokens.colors.textMuted}
                        />
                    }
                    description="No reminders yet."
                >
                    <Button
                        type="primary"
                        icon={<Plus size={14} strokeWidth={2} />}
                        onClick={() => setCreateOpen(true)}
                    >
                        Create first reminder
                    </Button>
                </Empty>
            ) : (
                <div
                    style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: tokens.spacing[4],
                    }}
                >
                    {BUCKETS.filter(
                        (b) =>
                            (b.key !== "completed" && grouped[b.key].length > 0) ||
                            (b.key === "completed" &&
                                showCompleted &&
                                grouped.completed.length > 0),
                    ).map((b) => {
                        const Icon = b.icon;
                        return (
                            <div key={b.key}>
                                <div
                                    style={{
                                        display: "flex",
                                        alignItems: "center",
                                        gap: 6,
                                        marginBottom: 6,
                                    }}
                                >
                                    <Icon
                                        size={13}
                                        strokeWidth={1.75}
                                        color={b.tone}
                                    />
                                    <span
                                        style={{
                                            fontSize: 11,
                                            fontWeight: 700,
                                            color: b.tone,
                                            textTransform: "uppercase",
                                            letterSpacing: "0.08em",
                                        }}
                                    >
                                        {b.label}
                                    </span>
                                    <span
                                        style={{
                                            fontSize: 11,
                                            color: tokens.colors.textMuted,
                                            fontFamily:
                                                tokens.typography.fontFamilyMono,
                                        }}
                                    >
                                        {grouped[b.key].length}
                                    </span>
                                </div>
                                <div
                                    style={{
                                        background: tokens.colors.bgSurface,
                                        border: `1px solid ${tokens.colors.border}`,
                                        borderRadius: tokens.radius.lg,
                                        overflow: "hidden",
                                    }}
                                >
                                    {grouped[b.key].map((r, idx) => (
                                        <ReminderRow
                                            key={r.id}
                                            reminder={r}
                                            isLast={
                                                idx ===
                                                grouped[b.key].length - 1
                                            }
                                            bucket={b.key}
                                            onToggle={() =>
                                                toggleComplete.mutate(r.id)
                                            }
                                            onSnooze={(hours) =>
                                                snooze.mutate({
                                                    id: r.id,
                                                    hours,
                                                })
                                            }
                                            onDelete={() =>
                                                remove.mutate(r.id)
                                            }
                                        />
                                    ))}
                                </div>
                            </div>
                        );
                    })}
                    {grouped.completed.length > 0 && (
                        <Button
                            type="text"
                            size="small"
                            onClick={() =>
                                setShowCompleted((s) => !s)
                            }
                            style={{
                                alignSelf: "flex-start",
                                color: tokens.colors.textMuted,
                            }}
                        >
                            {showCompleted ? "Hide" : "Show"}{" "}
                            {grouped.completed.length} completed
                        </Button>
                    )}
                </div>
            )}

            {createOpen && (
                <ReminderCreateModal
                    onClose={() => setCreateOpen(false)}
                />
            )}
        </div>
    );
};

const ReminderRow = ({
    reminder,
    isLast,
    bucket,
    onToggle,
    onSnooze,
    onDelete,
}: {
    reminder: Reminder;
    isLast: boolean;
    bucket: Bucket;
    onToggle: () => void;
    onSnooze: (hours: number) => void;
    onDelete: () => void;
}) => {
    const navigate = useNavigate();
    const due = dayjs(reminder.dueAt);
    return (
        <div
            style={{
                display: "flex",
                alignItems: "flex-start",
                gap: 10,
                padding: tokens.spacing[3],
                borderBottom: isLast
                    ? "none"
                    : `1px solid ${tokens.colors.borderSubtle}`,
                opacity: reminder.isCompleted ? 0.55 : 1,
            }}
        >
            <button
                onClick={onToggle}
                style={{
                    width: 18,
                    height: 18,
                    marginTop: 2,
                    borderRadius: "50%",
                    border: `2px solid ${
                        reminder.isCompleted
                            ? tokens.colors.success
                            : tokens.colors.border
                    }`,
                    background: reminder.isCompleted
                        ? tokens.colors.success
                        : "transparent",
                    color: "#fff",
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    cursor: "pointer",
                    flexShrink: 0,
                    transition: "all var(--transition-fast)",
                }}
            >
                {reminder.isCompleted && (
                    <Check size={11} strokeWidth={3} />
                )}
            </button>

            <div style={{ flex: 1, minWidth: 0 }}>
                <div
                    style={{
                        fontSize: tokens.typography.fontSize.sm,
                        fontWeight: 600,
                        color: tokens.colors.textPrimary,
                        textDecoration: reminder.isCompleted
                            ? "line-through"
                            : "none",
                    }}
                >
                    {reminder.title}
                </div>
                {reminder.notes && (
                    <div
                        style={{
                            fontSize: 12,
                            color: tokens.colors.textMuted,
                            marginTop: 2,
                            lineHeight: 1.4,
                        }}
                    >
                        {reminder.notes}
                    </div>
                )}
                <div
                    style={{
                        marginTop: 4,
                        display: "flex",
                        gap: 10,
                        alignItems: "center",
                        fontSize: 11,
                        color:
                            bucket === "overdue"
                                ? tokens.colors.danger
                                : tokens.colors.textMuted,
                        fontFamily: tokens.typography.fontFamilyMono,
                    }}
                >
                    <span>
                        {due.format("MMM D, h:mm A")}
                    </span>
                    {reminder.taskId && (
                        <button
                            onClick={() => navigate(`/t/${reminder.taskId}`)}
                            style={{
                                background: "transparent",
                                border: 0,
                                cursor: "pointer",
                                color: tokens.colors.primary,
                                display: "inline-flex",
                                alignItems: "center",
                                gap: 3,
                                fontSize: 11,
                                fontFamily: tokens.typography.fontFamilyMono,
                            }}
                        >
                            <LinkIcon size={10} strokeWidth={2} />
                            Linked task
                        </button>
                    )}
                </div>
            </div>

            {!reminder.isCompleted && (
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
                            { type: "divider" as const },
                            {
                                key: "delete",
                                icon: (
                                    <Trash2 size={13} strokeWidth={1.75} />
                                ),
                                label: "Delete",
                                danger: true,
                                onClick: onDelete,
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
            )}
        </div>
    );
};

const ReminderCreateModal = ({ onClose }: { onClose: () => void }) => {
    const qc = useQueryClient();
    const user = useAuthStore((s) => s.user);
    const { message } = AntApp.useApp();
    const [title, setTitle] = useState("");
    const [notes, setNotes] = useState("");
    const [dueAt, setDueAt] = useState<dayjs.Dayjs | null>(
        dayjs().add(1, "hour"),
    );
    const [assignedTo, setAssignedTo] = useState<string>(
        user?.id ?? "u-001",
    );

    const create = useMutation({
        mutationFn: () =>
            mockApi.reminders.create({
                title,
                notes: notes || undefined,
                dueAt: (dueAt ?? dayjs().add(1, "hour")).toISOString(),
                assignedTo,
            }),
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ["reminders"] });
            message.success("Reminder created");
            onClose();
        },
    });

    const setQuickDate = (
        type: "30m" | "1h" | "tomorrow" | "monday",
    ) => {
        let d = dayjs();
        if (type === "30m") d = d.add(30, "minute");
        if (type === "1h") d = d.add(1, "hour");
        if (type === "tomorrow") d = d.add(1, "day").hour(9).minute(0);
        if (type === "monday") d = d.day(8).hour(9).minute(0);
        setDueAt(d);
    };

    return (
        <Modal
            open
            onCancel={onClose}
            onOk={() => create.mutate()}
            okText="Create reminder"
            okButtonProps={{
                disabled: !title.trim() || !dueAt,
                loading: create.isPending,
            }}
            title="New reminder"
        >
            <div
                style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 12,
                    paddingTop: 8,
                }}
            >
                <div>
                    <Label>Title</Label>
                    <Input
                        value={title}
                        onChange={(e) => setTitle(e.target.value)}
                        placeholder="e.g. Follow up with Karim about pricing"
                        autoFocus
                    />
                </div>
                <div>
                    <Label>Notes (optional)</Label>
                    <Input.TextArea
                        value={notes}
                        onChange={(e) => setNotes(e.target.value)}
                        autoSize={{ minRows: 2, maxRows: 4 }}
                        placeholder="Additional context"
                    />
                </div>
                <div>
                    <Label>Due at</Label>
                    <DatePicker
                        showTime={{ format: "HH:mm" }}
                        format="MMM D, YYYY · HH:mm"
                        value={dueAt}
                        onChange={setDueAt}
                        style={{ width: "100%" }}
                    />
                    <div
                        style={{
                            display: "flex",
                            gap: 6,
                            marginTop: 8,
                        }}
                    >
                        {(
                            [
                                ["30m", "In 30 min"],
                                ["1h", "In 1 hour"],
                                ["tomorrow", "Tomorrow 9am"],
                                ["monday", "Next Monday"],
                            ] as const
                        ).map(([k, label]) => (
                            <Button
                                key={k}
                                size="small"
                                onClick={() => setQuickDate(k)}
                            >
                                {label}
                            </Button>
                        ))}
                    </div>
                </div>
                <div>
                    <Label>Remind</Label>
                    <Select
                        value={assignedTo}
                        onChange={setAssignedTo}
                        style={{ width: "100%" }}
                        options={allUsers.map((u) => ({
                            value: u.id,
                            label: `${u.firstName} ${u.lastName}${u.id === user?.id ? " (me)" : ""}`,
                        }))}
                    />
                </div>
            </div>
        </Modal>
    );
};

const Label = ({ children }: { children: React.ReactNode }) => (
    <label
        style={{
            display: "block",
            fontSize: 11,
            fontWeight: 600,
            color: tokens.colors.textMuted,
            textTransform: "uppercase",
            letterSpacing: "0.05em",
            marginBottom: 4,
        }}
    >
        {children}
    </label>
);

export default RemindersPage;
