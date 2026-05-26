import { useState, useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Switch, Button, TimePicker, App as AntApp } from "antd";
import dayjs from "dayjs";
import { Save } from "lucide-react";
import { mockApi } from "../../lib/mock-api";
import { useAuthStore } from "../../stores/auth";
import {
    SettingsHeader,
    SettingsSection,
} from "../../components/settings/SettingsHeader";
import type { NotificationPreferences } from "../../types/settings";
import { tokens } from "../../theme";

const EVENTS: Array<{
    key: keyof NotificationPreferences["events"];
    label: string;
    hint: string;
}> = [
    {
        key: "assigned",
        label: "Assigned to me",
        hint: "When you're added as an assignee on a task",
    },
    {
        key: "mentioned",
        label: "Mentioned",
        hint: "When someone @-mentions you in a comment or description",
    },
    {
        key: "commentReply",
        label: "Comment replies",
        hint: "When someone replies to your comment thread",
    },
    {
        key: "statusChange",
        label: "Status changes",
        hint: "When a task you're watching changes status",
    },
    {
        key: "dueSoon",
        label: "Due soon",
        hint: "A reminder before a task's due date",
    },
    {
        key: "overdue",
        label: "Overdue tasks",
        hint: "When an assigned task passes its due date",
    },
    {
        key: "dailyDigest",
        label: "Daily digest",
        hint: "A morning email summarizing your day",
    },
    {
        key: "weeklyDigest",
        label: "Weekly digest",
        hint: "A Monday recap of last week's activity",
    },
];

const NotificationsSettings = () => {
    const user = useAuthStore((s) => s.user);
    const qc = useQueryClient();
    const { message } = AntApp.useApp();
    const [draft, setDraft] = useState<NotificationPreferences | null>(null);

    const { data } = useQuery({
        queryKey: ["notification-prefs", user?.id],
        queryFn: () =>
            user
                ? mockApi.notificationPreferences.get(user.id)
                : Promise.resolve(null),
        enabled: !!user,
    });

    useEffect(() => {
        if (data) setDraft(data);
    }, [data]);

    const save = useMutation({
        mutationFn: () =>
            user && draft
                ? mockApi.notificationPreferences.update(user.id, draft)
                : Promise.reject(new Error("No data")),
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ["notification-prefs"] });
            message.success("Notification preferences saved");
        },
    });

    if (!user || !draft) return <div>Loading...</div>;

    const setChannel = (
        ch: keyof NotificationPreferences["channels"],
        v: boolean,
    ) =>
        setDraft({
            ...draft,
            channels: { ...draft.channels, [ch]: v },
        });

    const setEvent = (
        ev: keyof NotificationPreferences["events"],
        ch: "inApp" | "email",
        v: boolean,
    ) =>
        setDraft({
            ...draft,
            events: {
                ...draft.events,
                [ev]: { ...draft.events[ev], [ch]: v },
            },
        });

    return (
        <div>
            <SettingsHeader
                title="Notifications"
                description="Choose which events you'd like to be notified about, and through which channel."
                actions={
                    <Button
                        type="primary"
                        icon={<Save size={14} strokeWidth={1.75} />}
                        loading={save.isPending}
                        onClick={() => save.mutate()}
                    >
                        Save changes
                    </Button>
                }
            />

            <SettingsSection
                title="Channels"
                description="Turn entire channels on or off."
            >
                <div
                    style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: 8,
                    }}
                >
                    {(
                        [
                            ["inApp", "In-app", "Bell icon in the top bar"],
                            ["email", "Email", "To your account email"],
                            [
                                "push",
                                "Push (mobile)",
                                "Requires mobile app — coming soon",
                            ],
                        ] as const
                    ).map(([key, label, hint]) => (
                        <div
                            key={key}
                            style={{
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "space-between",
                                padding: "8px 0",
                                borderBottom: `1px solid ${tokens.colors.borderSubtle}`,
                            }}
                        >
                            <div>
                                <div
                                    style={{
                                        fontSize:
                                            tokens.typography.fontSize.sm,
                                        fontWeight: 500,
                                    }}
                                >
                                    {label}
                                </div>
                                <div
                                    style={{
                                        fontSize: 12,
                                        color: tokens.colors.textMuted,
                                    }}
                                >
                                    {hint}
                                </div>
                            </div>
                            <Switch
                                checked={draft.channels[key]}
                                onChange={(v) => setChannel(key, v)}
                            />
                        </div>
                    ))}
                </div>
            </SettingsSection>

            <SettingsSection
                title="Per-event"
                description="Fine-tune which events trigger which channel."
            >
                <div style={{ display: "flex", flexDirection: "column" }}>
                    <div
                        style={{
                            display: "grid",
                            gridTemplateColumns: "1fr 80px 80px",
                            padding: "0 0 8px 0",
                            borderBottom: `1px solid ${tokens.colors.border}`,
                            fontSize: 11,
                            fontWeight: 700,
                            color: tokens.colors.textMuted,
                            textTransform: "uppercase",
                            letterSpacing: "0.05em",
                        }}
                    >
                        <span>Event</span>
                        <span style={{ textAlign: "center" }}>In-app</span>
                        <span style={{ textAlign: "center" }}>Email</span>
                    </div>
                    {EVENTS.map((ev) => (
                        <div
                            key={ev.key}
                            style={{
                                display: "grid",
                                gridTemplateColumns: "1fr 80px 80px",
                                alignItems: "center",
                                padding: "10px 0",
                                borderBottom: `1px solid ${tokens.colors.borderSubtle}`,
                            }}
                        >
                            <div>
                                <div
                                    style={{
                                        fontSize:
                                            tokens.typography.fontSize.sm,
                                        fontWeight: 500,
                                    }}
                                >
                                    {ev.label}
                                </div>
                                <div
                                    style={{
                                        fontSize: 11,
                                        color: tokens.colors.textMuted,
                                    }}
                                >
                                    {ev.hint}
                                </div>
                            </div>
                            <div style={{ textAlign: "center" }}>
                                <Switch
                                    size="small"
                                    checked={
                                        draft.events[ev.key].inApp
                                    }
                                    onChange={(v) =>
                                        setEvent(ev.key, "inApp", v)
                                    }
                                />
                            </div>
                            <div style={{ textAlign: "center" }}>
                                <Switch
                                    size="small"
                                    checked={
                                        draft.events[ev.key].email
                                    }
                                    onChange={(v) =>
                                        setEvent(ev.key, "email", v)
                                    }
                                />
                            </div>
                        </div>
                    ))}
                </div>
            </SettingsSection>

            <SettingsSection
                title="Quiet hours"
                description="Don't send any notifications during this window."
            >
                <div
                    style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: 12,
                        padding: "4px 0",
                    }}
                >
                    <div>
                        <div
                            style={{
                                fontSize: tokens.typography.fontSize.sm,
                                fontWeight: 500,
                            }}
                        >
                            Enable quiet hours
                        </div>
                        <div
                            style={{
                                fontSize: 12,
                                color: tokens.colors.textMuted,
                            }}
                        >
                            Currently{" "}
                            {draft.quietHours.enabled
                                ? `${draft.quietHours.start} – ${draft.quietHours.end}`
                                : "off"}
                        </div>
                    </div>
                    <Switch
                        checked={draft.quietHours.enabled}
                        onChange={(v) =>
                            setDraft({
                                ...draft,
                                quietHours: { ...draft.quietHours, enabled: v },
                            })
                        }
                    />
                </div>
                {draft.quietHours.enabled && (
                    <div
                        style={{
                            display: "flex",
                            gap: 12,
                            marginTop: 12,
                        }}
                    >
                        <TimePicker
                            value={dayjs(draft.quietHours.start, "HH:mm")}
                            format="HH:mm"
                            onChange={(t) =>
                                t &&
                                setDraft({
                                    ...draft,
                                    quietHours: {
                                        ...draft.quietHours,
                                        start: t.format("HH:mm"),
                                    },
                                })
                            }
                        />
                        <span style={{ alignSelf: "center" }}>to</span>
                        <TimePicker
                            value={dayjs(draft.quietHours.end, "HH:mm")}
                            format="HH:mm"
                            onChange={(t) =>
                                t &&
                                setDraft({
                                    ...draft,
                                    quietHours: {
                                        ...draft.quietHours,
                                        end: t.format("HH:mm"),
                                    },
                                })
                            }
                        />
                    </div>
                )}
            </SettingsSection>
        </div>
    );
};

export default NotificationsSettings;
