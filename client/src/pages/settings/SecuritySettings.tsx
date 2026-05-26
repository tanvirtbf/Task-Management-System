import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
    Button,
    Tag,
    App as AntApp,
    Popconfirm,
    Switch,
} from "antd";
import {
    Monitor,
    Smartphone,
    Tablet,
    ShieldCheck,
    KeyRound,
    LogOut,
} from "lucide-react";
import { mockApi } from "../../lib/mock-api";
import { useAuthStore } from "../../stores/auth";
import {
    SettingsHeader,
    SettingsSection,
} from "../../components/settings/SettingsHeader";
import type { ActiveSession } from "../../types/settings";
import { tokens } from "../../theme";

const formatTime = (iso: string): string => {
    const diff = Date.now() - new Date(iso).getTime();
    const m = Math.floor(diff / 60000);
    if (m < 1) return "just now";
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    return `${Math.floor(h / 24)}d ago`;
};

const deviceIcon = (device: string) => {
    if (/iphone|android|mobile/i.test(device)) return Smartphone;
    if (/ipad|tablet/i.test(device)) return Tablet;
    return Monitor;
};

const SecuritySettings = () => {
    const user = useAuthStore((s) => s.user);
    const qc = useQueryClient();
    const { message } = AntApp.useApp();

    const { data: sessions = [] } = useQuery({
        queryKey: ["sessions", user?.id],
        queryFn: () =>
            user ? mockApi.sessions.list(user.id) : Promise.resolve([]),
        enabled: !!user,
    });

    const revoke = useMutation({
        mutationFn: (id: string) => mockApi.sessions.revoke(id),
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ["sessions"] });
            message.success("Session revoked");
        },
    });

    const revokeAll = useMutation({
        mutationFn: () =>
            user
                ? mockApi.sessions.revokeAllOthers(user.id)
                : Promise.reject(),
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ["sessions"] });
            message.success("All other sessions revoked");
        },
    });

    if (!user) return <div>Not signed in</div>;

    return (
        <div>
            <SettingsHeader
                title="Security & sessions"
                description="Manage two-factor authentication, password, and active sessions."
            />

            <SettingsSection
                title="Two-factor authentication"
                description="Add a second sign-in step using an authenticator app."
            >
                <div
                    style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: 12,
                    }}
                >
                    <div
                        style={{
                            display: "flex",
                            gap: 12,
                            alignItems: "center",
                        }}
                    >
                        <div
                            style={{
                                width: 36,
                                height: 36,
                                borderRadius: tokens.radius.md,
                                background: tokens.colors.successSubtle,
                                color: tokens.colors.success,
                                display: "inline-flex",
                                alignItems: "center",
                                justifyContent: "center",
                            }}
                        >
                            <ShieldCheck size={18} strokeWidth={1.75} />
                        </div>
                        <div>
                            <div
                                style={{
                                    fontSize:
                                        tokens.typography.fontSize.sm,
                                    fontWeight: 600,
                                }}
                            >
                                Authenticator app
                            </div>
                            <div
                                style={{
                                    fontSize: 12,
                                    color: tokens.colors.textMuted,
                                }}
                            >
                                Configured · last verified 12 days ago
                            </div>
                        </div>
                    </div>
                    <Button size="small">Manage 2FA</Button>
                </div>
            </SettingsSection>

            <SettingsSection
                title="Password"
                description="Change the password used to sign in."
            >
                <div
                    style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                    }}
                >
                    <div>
                        <div
                            style={{
                                fontSize: tokens.typography.fontSize.sm,
                                fontWeight: 500,
                            }}
                        >
                            Password
                        </div>
                        <div
                            style={{
                                fontSize: 12,
                                color: tokens.colors.textMuted,
                            }}
                        >
                            Last changed 3 months ago
                        </div>
                    </div>
                    <Button icon={<KeyRound size={14} strokeWidth={1.75} />}>
                        Change password
                    </Button>
                </div>
            </SettingsSection>

            <SettingsSection
                title="Login alerts"
                description="Email me when a new device signs in to my account."
            >
                <div
                    style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                    }}
                >
                    <div
                        style={{
                            fontSize: tokens.typography.fontSize.sm,
                            color: tokens.colors.textSecondary,
                        }}
                    >
                        New device sign-in alerts
                    </div>
                    <Switch defaultChecked />
                </div>
            </SettingsSection>

            <SettingsSection
                title="Active sessions"
                description="Devices currently signed in to your account."
            >
                <div
                    style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: 4,
                    }}
                >
                    {sessions.map((s) => (
                        <SessionRow
                            key={s.id}
                            session={s}
                            onRevoke={() => revoke.mutate(s.id)}
                        />
                    ))}
                    {sessions.filter((s) => !s.isCurrent).length > 0 && (
                        <Popconfirm
                            title="Revoke all other sessions?"
                            description="You will stay signed in here, but all other devices will be signed out."
                            okType="danger"
                            onConfirm={() => revokeAll.mutate()}
                        >
                            <Button
                                danger
                                style={{ marginTop: 8, alignSelf: "flex-start" }}
                                icon={<LogOut size={13} strokeWidth={1.75} />}
                            >
                                Sign out of all other sessions
                            </Button>
                        </Popconfirm>
                    )}
                </div>
            </SettingsSection>
        </div>
    );
};

const SessionRow = ({
    session,
    onRevoke,
}: {
    session: ActiveSession;
    onRevoke: () => void;
}) => {
    const Icon = deviceIcon(session.device);
    return (
        <div
            style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: "10px 0",
                borderBottom: `1px solid ${tokens.colors.borderSubtle}`,
            }}
        >
            <div
                style={{
                    width: 36,
                    height: 36,
                    borderRadius: tokens.radius.md,
                    background: tokens.colors.bgMuted,
                    color: tokens.colors.textSecondary,
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                }}
            >
                <Icon size={18} strokeWidth={1.5} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
                <div
                    style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                    }}
                >
                    <span
                        style={{
                            fontSize: tokens.typography.fontSize.sm,
                            fontWeight: 600,
                        }}
                    >
                        {session.device} · {session.browser}
                    </span>
                    {session.isCurrent && (
                        <Tag color="green" style={{ margin: 0 }}>
                            This device
                        </Tag>
                    )}
                </div>
                <div
                    style={{
                        fontSize: 12,
                        color: tokens.colors.textMuted,
                        fontFamily: tokens.typography.fontFamilyMono,
                    }}
                >
                    {session.location} · {session.ip} ·{" "}
                    {formatTime(session.lastSeenAt)}
                </div>
            </div>
            {!session.isCurrent && (
                <Button size="small" danger type="text" onClick={onRevoke}>
                    Revoke
                </Button>
            )}
        </div>
    );
};

export default SecuritySettings;
