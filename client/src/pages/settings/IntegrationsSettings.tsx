import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Input, Tag, App as AntApp } from "antd";
import { CheckCircle2, Plug, Search, X } from "lucide-react";
import { mockApi } from "../../lib/mock-api";
import { DynamicIcon } from "../../components/shared/DynamicIcon";
import {
    SettingsHeader,
    SettingsSection,
} from "../../components/settings/SettingsHeader";
import { tokens } from "../../theme";
import type { Integration, IntegrationCategory } from "../../types/settings";

const CATEGORIES: Array<{ value: "all" | IntegrationCategory; label: string }> = [
    { value: "all", label: "All" },
    { value: "communication", label: "Communication" },
    { value: "email", label: "Email" },
    { value: "files", label: "Files" },
    { value: "dev", label: "Developer" },
    { value: "automation", label: "Automation" },
];

const IntegrationsSettings = () => {
    const qc = useQueryClient();
    const { message } = AntApp.useApp();
    const [filter, setFilter] = useState<"all" | IntegrationCategory>("all");
    const [query, setQuery] = useState("");

    const { data: integrations = [] } = useQuery({
        queryKey: ["integrations"],
        queryFn: () => mockApi.integrations.list(),
    });

    const filtered = useMemo(() => {
        const q = query.trim().toLowerCase();
        return integrations.filter((i) => {
            if (filter !== "all" && i.category !== filter) return false;
            if (
                q &&
                !(
                    i.name.toLowerCase().includes(q) ||
                    i.description.toLowerCase().includes(q)
                )
            )
                return false;
            return true;
        });
    }, [integrations, filter, query]);

    const connect = useMutation({
        mutationFn: (id: string) =>
            mockApi.integrations.connect(id, {
                account: "ops@shutkihut.com",
            }),
        onSuccess: (i) => {
            qc.invalidateQueries({ queryKey: ["integrations"] });
            message.success(`${i.name} connected`);
        },
    });

    const disconnect = useMutation({
        mutationFn: (id: string) => mockApi.integrations.disconnect(id),
        onSuccess: (i) => {
            qc.invalidateQueries({ queryKey: ["integrations"] });
            message.success(`${i.name} disconnected`);
        },
    });

    const connectedCount = integrations.filter((i) => i.isConnected).length;

    return (
        <div>
            <SettingsHeader
                title="Integrations"
                description={`Connect external apps to your workspace. ${connectedCount} active.`}
            />

            <div
                style={{
                    display: "flex",
                    gap: 8,
                    marginBottom: tokens.spacing[3],
                }}
            >
                <Input
                    prefix={
                        <Search
                            size={13}
                            strokeWidth={1.75}
                            color={tokens.colors.textMuted}
                        />
                    }
                    placeholder="Search integrations..."
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    style={{ flex: 1 }}
                />
            </div>

            <div
                style={{
                    display: "flex",
                    flexWrap: "wrap",
                    gap: 6,
                    marginBottom: tokens.spacing[3],
                }}
            >
                {CATEGORIES.map((c) => {
                    const active = filter === c.value;
                    return (
                        <button
                            key={c.value}
                            onClick={() => setFilter(c.value)}
                            style={{
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
                            {c.label}
                        </button>
                    );
                })}
            </div>

            <div
                style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
                    gap: tokens.spacing[3],
                }}
            >
                {filtered.map((i) => (
                    <IntegrationCard
                        key={i.id}
                        integration={i}
                        onConnect={() => connect.mutate(i.id)}
                        onDisconnect={() => disconnect.mutate(i.id)}
                        busy={connect.isPending || disconnect.isPending}
                    />
                ))}
            </div>
        </div>
    );
};

const IntegrationCard = ({
    integration,
    onConnect,
    onDisconnect,
    busy,
}: {
    integration: Integration;
    onConnect: () => void;
    onDisconnect: () => void;
    busy: boolean;
}) => (
    <div
        style={{
            background: tokens.colors.bgSurface,
            border: `1px solid ${tokens.colors.border}`,
            borderRadius: tokens.radius.lg,
            padding: tokens.spacing[3],
            display: "flex",
            flexDirection: "column",
            gap: tokens.spacing[2],
            minHeight: 150,
        }}
    >
        <div
            style={{
                display: "flex",
                alignItems: "flex-start",
                gap: 10,
            }}
        >
            <div
                style={{
                    width: 40,
                    height: 40,
                    borderRadius: tokens.radius.md,
                    background: `${integration.color}1A`,
                    color: integration.color,
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                }}
            >
                <DynamicIcon
                    name={integration.icon}
                    size={20}
                    strokeWidth={1.75}
                />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
                <div
                    style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                    }}
                >
                    <h3
                        style={{
                            margin: 0,
                            fontSize: tokens.typography.fontSize.base,
                            fontWeight: 600,
                        }}
                    >
                        {integration.name}
                    </h3>
                    {integration.isConnected && (
                        <CheckCircle2
                            size={13}
                            strokeWidth={2}
                            color={tokens.colors.success}
                        />
                    )}
                </div>
                <Tag
                    style={{
                        margin: 0,
                        marginTop: 2,
                        fontSize: 10,
                    }}
                >
                    {integration.category}
                </Tag>
            </div>
        </div>
        <p
            style={{
                margin: 0,
                fontSize: tokens.typography.fontSize.sm,
                color: tokens.colors.textSecondary,
                lineHeight: 1.5,
                flex: 1,
            }}
        >
            {integration.description}
        </p>
        {integration.isConnected && integration.meta && (
            <div
                style={{
                    padding: 6,
                    background: tokens.colors.successSubtle,
                    color: tokens.colors.success,
                    borderRadius: tokens.radius.sm,
                    fontSize: 11,
                    fontFamily: tokens.typography.fontFamilyMono,
                }}
            >
                {Object.entries(integration.meta)
                    .map(([k, v]) => `${k}: ${v}`)
                    .join(" · ")}
            </div>
        )}
        <div style={{ paddingTop: 4 }}>
            {integration.isConnected ? (
                <Button
                    size="small"
                    danger
                    icon={<X size={13} strokeWidth={1.75} />}
                    onClick={onDisconnect}
                    loading={busy}
                >
                    Disconnect
                </Button>
            ) : (
                <Button
                    size="small"
                    type="primary"
                    icon={<Plug size={13} strokeWidth={1.75} />}
                    onClick={onConnect}
                    loading={busy}
                >
                    Connect
                </Button>
            )}
        </div>
    </div>
);

export default IntegrationsSettings;
