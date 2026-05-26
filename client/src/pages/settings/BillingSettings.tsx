import { useQuery } from "@tanstack/react-query";
import { Alert, Tag } from "antd";
import { CheckCircle2, Heart, Server, Users, Zap } from "lucide-react";
import { mockApi } from "../../lib/mock-api";
import {
    SettingsHeader,
    SettingsSection,
} from "../../components/settings/SettingsHeader";
import { tokens } from "../../theme";

const BillingSettings = () => {
    const { data: users = [] } = useQuery({
        queryKey: ["users"],
        queryFn: () => mockApi.users.list(),
    });
    const activeUsers = users.filter((u) => u.status === "active").length;

    return (
        <div>
            <SettingsHeader
                title="Billing & usage"
                description="Your plan, usage, and billing details."
            />

            <Alert
                type="success"
                showIcon
                icon={<Heart size={14} strokeWidth={1.75} />}
                message="You're on the Self-Hosted Free Tier"
                description="This deployment is owned by your team — unlimited members, unlimited storage, no monthly fee."
                style={{ marginBottom: tokens.spacing[3] }}
            />

            <SettingsSection
                title="Current plan"
                description="Self-hosted, BYO infrastructure."
            >
                <div
                    style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 16,
                        paddingBottom: 12,
                        borderBottom: `1px solid ${tokens.colors.borderSubtle}`,
                    }}
                >
                    <div
                        style={{
                            width: 52,
                            height: 52,
                            borderRadius: tokens.radius.lg,
                            background: tokens.colors.successSubtle,
                            color: tokens.colors.success,
                            display: "inline-flex",
                            alignItems: "center",
                            justifyContent: "center",
                        }}
                    >
                        <Server size={24} strokeWidth={1.5} />
                    </div>
                    <div style={{ flex: 1 }}>
                        <h3
                            style={{
                                margin: 0,
                                fontSize: tokens.typography.fontSize.lg,
                                fontWeight: 700,
                            }}
                        >
                            Self-Hosted Free Tier
                        </h3>
                        <p
                            style={{
                                margin: 0,
                                marginTop: 2,
                                fontSize: tokens.typography.fontSize.sm,
                                color: tokens.colors.textMuted,
                            }}
                        >
                            Self-managed deployment · No vendor billing
                        </p>
                    </div>
                    <Tag color="green" style={{ fontSize: 12 }}>
                        Active
                    </Tag>
                </div>
                <div
                    style={{
                        marginTop: 12,
                        display: "grid",
                        gridTemplateColumns: "repeat(2, 1fr)",
                        gap: 8,
                    }}
                >
                    {[
                        "Unlimited members",
                        "Unlimited tasks & lists",
                        "Unlimited automations",
                        "Unlimited dashboards",
                        "All views (Board, Gantt, Map, etc.)",
                        "Custom fields, forms, templates",
                        "API + Webhooks",
                        "Self-hosted — your data stays put",
                    ].map((feature) => (
                        <div
                            key={feature}
                            style={{
                                display: "flex",
                                alignItems: "center",
                                gap: 6,
                                fontSize: tokens.typography.fontSize.sm,
                                color: tokens.colors.textSecondary,
                            }}
                        >
                            <CheckCircle2
                                size={13}
                                strokeWidth={2}
                                color={tokens.colors.success}
                            />
                            {feature}
                        </div>
                    ))}
                </div>
            </SettingsSection>

            <SettingsSection
                title="Usage"
                description="Counters for this workspace."
            >
                <div
                    style={{
                        display: "grid",
                        gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
                        gap: 8,
                    }}
                >
                    <UsageStat
                        icon={Users}
                        label="Active members"
                        value={activeUsers}
                        cap="∞"
                    />
                    <UsageStat
                        icon={Zap}
                        label="Automations"
                        value="5"
                        cap="∞"
                    />
                    <UsageStat
                        icon={Server}
                        label="Storage"
                        value="2.4 GB"
                        cap="self-managed"
                    />
                </div>
            </SettingsSection>

            <SettingsSection
                title="Need cloud hosting?"
                description="Considering a managed cloud version with backup, scaling, and support? We're not selling one yet — this is a fully self-hosted product."
            >
                <p
                    style={{
                        margin: 0,
                        fontSize: tokens.typography.fontSize.sm,
                        color: tokens.colors.textSecondary,
                    }}
                >
                    Documentation, deployment guides, and infrastructure
                    sizing recommendations are part of the README.
                </p>
            </SettingsSection>
        </div>
    );
};

const UsageStat = ({
    icon: Icon,
    label,
    value,
    cap,
}: {
    icon: React.ComponentType<{ size?: number; strokeWidth?: number }>;
    label: string;
    value: number | string;
    cap: string;
}) => (
    <div
        style={{
            padding: 12,
            background: tokens.colors.bgMuted,
            borderRadius: tokens.radius.md,
            display: "flex",
            flexDirection: "column",
            gap: 4,
        }}
    >
        <div
            style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                fontSize: 11,
                color: tokens.colors.textMuted,
                textTransform: "uppercase",
                letterSpacing: "0.05em",
                fontWeight: 600,
            }}
        >
            <Icon size={11} strokeWidth={1.75} />
            {label}
        </div>
        <div
            style={{
                fontFamily: tokens.typography.fontFamilyMono,
                fontSize: 20,
                fontWeight: 700,
                color: tokens.colors.textPrimary,
                lineHeight: 1,
            }}
        >
            {value}
        </div>
        <div
            style={{
                fontSize: 10,
                color: tokens.colors.textMuted,
                fontFamily: tokens.typography.fontFamilyMono,
            }}
        >
            of {cap}
        </div>
    </div>
);

export default BillingSettings;
