import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
    Button,
    Input,
    Modal,
    Tag,
    Popconfirm,
    Select,
    Switch,
    App as AntApp,
    Alert,
} from "antd";
import {
    Plus,
    Trash2,
    Copy,
    Play,
    Webhook as WebhookIcon,
    KeyRound,
    Eye,
    EyeOff,
} from "lucide-react";
import dayjs from "dayjs";

const fromNow = (iso: string): string => {
    const diff = Date.now() - new Date(iso).getTime();
    const m = Math.floor(diff / 60000);
    if (m < 1) return "just now";
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    return `${Math.floor(h / 24)}d ago`;
};
import { mockApi } from "../../lib/mock-api";
import {
    SettingsHeader,
    SettingsSection,
} from "../../components/settings/SettingsHeader";
import { tokens } from "../../theme";
import type {
    Webhook,
    WebhookEvent,
    ApiKey,
    ApiScope,
} from "../../types/settings";

const EVENT_OPTIONS: WebhookEvent[] = [
    "task.created",
    "task.updated",
    "task.completed",
    "task.deleted",
    "comment.created",
    "automation.run",
    "form.submitted",
];

const WebhooksSettings = () => {
    const [webhookModal, setWebhookModal] = useState<
        Webhook | "new" | null
    >(null);
    const [apiKeyModal, setApiKeyModal] = useState(false);

    return (
        <div>
            <SettingsHeader
                title="Webhooks & API"
                description="Send real-time event notifications to external services, or use API keys to integrate programmatically."
            />

            <WebhooksSection
                onAdd={() => setWebhookModal("new")}
                onEdit={setWebhookModal}
            />
            <ApiKeysSection onAdd={() => setApiKeyModal(true)} />

            {webhookModal && (
                <WebhookEditor
                    webhook={webhookModal === "new" ? null : webhookModal}
                    onClose={() => setWebhookModal(null)}
                />
            )}
            {apiKeyModal && (
                <ApiKeyCreateModal onClose={() => setApiKeyModal(false)} />
            )}
        </div>
    );
};

const WebhooksSection = ({
    onAdd,
    onEdit,
}: {
    onAdd: () => void;
    onEdit: (w: Webhook) => void;
}) => {
    const qc = useQueryClient();
    const { message } = AntApp.useApp();
    const [revealedSecret, setRevealedSecret] = useState<string | null>(null);

    const { data: webhooks = [] } = useQuery({
        queryKey: ["webhooks"],
        queryFn: () => mockApi.webhooks.list(),
    });

    const remove = useMutation({
        mutationFn: (id: string) => mockApi.webhooks.delete(id),
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ["webhooks"] });
            message.success("Webhook deleted");
        },
    });

    const test = useMutation({
        mutationFn: (id: string) => mockApi.webhooks.test(id),
        onSuccess: (result) => {
            qc.invalidateQueries({ queryKey: ["webhooks"] });
            if (result.status === "success") {
                message.success(`Delivered in ${result.durationMs}ms`);
            } else {
                message.error(`Delivery failed (${result.durationMs}ms)`);
            }
        },
    });

    const toggleActive = useMutation({
        mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
            mockApi.webhooks.update(id, { isActive }),
        onSuccess: () => qc.invalidateQueries({ queryKey: ["webhooks"] }),
    });

    return (
        <SettingsSection
            title="Webhooks"
            description={`${webhooks.length} configured. Webhooks let external services receive event payloads as they happen.`}
        >
            <div style={{ marginBottom: 12 }}>
                <Button
                    type="primary"
                    size="small"
                    icon={<Plus size={13} strokeWidth={2} />}
                    onClick={onAdd}
                >
                    New webhook
                </Button>
            </div>
            {webhooks.length === 0 ? (
                <div
                    style={{
                        padding: 16,
                        textAlign: "center",
                        color: tokens.colors.textMuted,
                    }}
                >
                    No webhooks yet.
                </div>
            ) : (
                <div
                    style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: 8,
                    }}
                >
                    {webhooks.map((w) => (
                        <div
                            key={w.id}
                            style={{
                                background: tokens.colors.bgMuted,
                                border: `1px solid ${tokens.colors.borderSubtle}`,
                                borderRadius: tokens.radius.md,
                                padding: tokens.spacing[3],
                                opacity: w.isActive ? 1 : 0.6,
                            }}
                        >
                            <div
                                style={{
                                    display: "flex",
                                    alignItems: "center",
                                    gap: 10,
                                }}
                            >
                                <WebhookIcon
                                    size={16}
                                    strokeWidth={1.75}
                                    color={tokens.colors.primary}
                                />
                                <div style={{ flex: 1, minWidth: 0 }}>
                                    <div
                                        style={{
                                            display: "flex",
                                            alignItems: "center",
                                            gap: 6,
                                            fontWeight: 600,
                                            fontSize:
                                                tokens.typography.fontSize.sm,
                                        }}
                                    >
                                        {w.name}
                                        {!w.isActive && <Tag>Paused</Tag>}
                                    </div>
                                    <div
                                        style={{
                                            fontSize: 11,
                                            color: tokens.colors.textMuted,
                                            fontFamily:
                                                tokens.typography.fontFamilyMono,
                                            overflow: "hidden",
                                            textOverflow: "ellipsis",
                                            whiteSpace: "nowrap",
                                        }}
                                    >
                                        {w.url}
                                    </div>
                                </div>
                                <Switch
                                    size="small"
                                    checked={w.isActive}
                                    onChange={(v) =>
                                        toggleActive.mutate({
                                            id: w.id,
                                            isActive: v,
                                        })
                                    }
                                />
                                <Button
                                    size="small"
                                    icon={<Play size={11} strokeWidth={1.75} />}
                                    onClick={() => test.mutate(w.id)}
                                    loading={test.isPending}
                                >
                                    Test
                                </Button>
                                <Button
                                    size="small"
                                    onClick={() => onEdit(w)}
                                >
                                    Edit
                                </Button>
                                <Popconfirm
                                    title={`Delete “${w.name}”?`}
                                    okType="danger"
                                    onConfirm={() => remove.mutate(w.id)}
                                >
                                    <Button
                                        size="small"
                                        type="text"
                                        danger
                                        icon={
                                            <Trash2
                                                size={11}
                                                strokeWidth={1.75}
                                            />
                                        }
                                    />
                                </Popconfirm>
                            </div>
                            <div
                                style={{
                                    marginTop: 8,
                                    display: "flex",
                                    gap: 6,
                                    flexWrap: "wrap",
                                }}
                            >
                                {w.events.map((ev) => (
                                    <Tag
                                        key={ev}
                                        style={{ margin: 0, fontSize: 10 }}
                                    >
                                        {ev}
                                    </Tag>
                                ))}
                            </div>
                            <div
                                style={{
                                    marginTop: 8,
                                    display: "flex",
                                    alignItems: "center",
                                    gap: 12,
                                    fontSize: 11,
                                    color: tokens.colors.textMuted,
                                    fontFamily:
                                        tokens.typography.fontFamilyMono,
                                }}
                            >
                                <span>
                                    Delivered{" "}
                                    <strong>{w.deliveryCount}</strong>
                                </span>
                                <span>
                                    Failures{" "}
                                    <strong style={{ color: w.failureCount > 0 ? tokens.colors.danger : "inherit" }}>
                                        {w.failureCount}
                                    </strong>
                                </span>
                                <span>
                                    Last:{" "}
                                    {w.lastTriggeredAt
                                        ? fromNow(w.lastTriggeredAt)
                                        : "never"}
                                </span>
                            </div>
                            <div
                                style={{
                                    marginTop: 8,
                                    display: "flex",
                                    alignItems: "center",
                                    gap: 6,
                                    fontSize: 11,
                                    fontFamily:
                                        tokens.typography.fontFamilyMono,
                                    color: tokens.colors.textSecondary,
                                }}
                            >
                                <span>Secret:</span>
                                <code
                                    style={{
                                        background:
                                            tokens.colors.bgSurface,
                                        padding: "2px 6px",
                                        borderRadius: 3,
                                        fontSize: 10,
                                    }}
                                >
                                    {revealedSecret === w.id
                                        ? w.secret
                                        : `${w.secret.slice(0, 8)}••••••`}
                                </code>
                                <button
                                    onClick={() =>
                                        setRevealedSecret(
                                            revealedSecret === w.id
                                                ? null
                                                : w.id,
                                        )
                                    }
                                    style={{
                                        background: "transparent",
                                        border: 0,
                                        cursor: "pointer",
                                        padding: 2,
                                        color: tokens.colors.textMuted,
                                        display: "inline-flex",
                                    }}
                                >
                                    {revealedSecret === w.id ? (
                                        <EyeOff size={11} strokeWidth={1.75} />
                                    ) : (
                                        <Eye size={11} strokeWidth={1.75} />
                                    )}
                                </button>
                                <button
                                    onClick={() => {
                                        navigator.clipboard.writeText(w.secret);
                                        message.success("Secret copied");
                                    }}
                                    style={{
                                        background: "transparent",
                                        border: 0,
                                        cursor: "pointer",
                                        padding: 2,
                                        color: tokens.colors.textMuted,
                                        display: "inline-flex",
                                    }}
                                >
                                    <Copy size={11} strokeWidth={1.75} />
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </SettingsSection>
    );
};

const ApiKeysSection = ({ onAdd }: { onAdd: () => void }) => {
    const qc = useQueryClient();
    const { message } = AntApp.useApp();

    const { data: keys = [] } = useQuery({
        queryKey: ["api-keys"],
        queryFn: () => mockApi.apiKeys.list(),
    });

    const remove = useMutation({
        mutationFn: (id: string) => mockApi.apiKeys.delete(id),
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ["api-keys"] });
            message.success("API key revoked");
        },
    });

    return (
        <SettingsSection
            title="API keys"
            description="Personal access tokens for programmatic API access. Keep these secret."
        >
            <div style={{ marginBottom: 12 }}>
                <Button
                    type="primary"
                    size="small"
                    icon={<Plus size={13} strokeWidth={2} />}
                    onClick={onAdd}
                >
                    Generate API key
                </Button>
            </div>
            {keys.length === 0 ? (
                <div
                    style={{
                        padding: 16,
                        textAlign: "center",
                        color: tokens.colors.textMuted,
                    }}
                >
                    No API keys yet.
                </div>
            ) : (
                <div
                    style={{
                        display: "flex",
                        flexDirection: "column",
                    }}
                >
                    {keys.map((k) => (
                        <ApiKeyRow
                            key={k.id}
                            apiKey={k}
                            onRevoke={() => remove.mutate(k.id)}
                        />
                    ))}
                </div>
            )}
        </SettingsSection>
    );
};

const ApiKeyRow = ({
    apiKey,
    onRevoke,
}: {
    apiKey: ApiKey;
    onRevoke: () => void;
}) => (
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
                width: 32,
                height: 32,
                borderRadius: tokens.radius.sm,
                background: tokens.colors.bgMuted,
                color: tokens.colors.textSecondary,
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
            }}
        >
            <KeyRound size={16} strokeWidth={1.5} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
            <div
                style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                }}
            >
                <span
                    style={{
                        fontSize: tokens.typography.fontSize.sm,
                        fontWeight: 600,
                    }}
                >
                    {apiKey.name}
                </span>
                {apiKey.scopes.map((s) => (
                    <Tag
                        key={s}
                        style={{ margin: 0, fontSize: 10 }}
                        color={s === "admin" ? "red" : s === "write" ? "blue" : "default"}
                    >
                        {s}
                    </Tag>
                ))}
            </div>
            <div
                style={{
                    fontSize: 11,
                    color: tokens.colors.textMuted,
                    fontFamily: tokens.typography.fontFamilyMono,
                }}
            >
                sk_live_••••{apiKey.last4} · created{" "}
                {dayjs(apiKey.createdAt).format("MMM D, YYYY")}
                {apiKey.lastUsedAt &&
                    ` · last used ${fromNow(apiKey.lastUsedAt)}`}
                {apiKey.expiresAt &&
                    ` · expires ${dayjs(apiKey.expiresAt).format("MMM D, YYYY")}`}
            </div>
        </div>
        <Popconfirm
            title={`Revoke “${apiKey.name}”?`}
            description="Any service using this key will immediately lose access."
            okType="danger"
            onConfirm={onRevoke}
        >
            <Button size="small" danger>
                Revoke
            </Button>
        </Popconfirm>
    </div>
);

const WebhookEditor = ({
    webhook,
    onClose,
}: {
    webhook: Webhook | null;
    onClose: () => void;
}) => {
    const qc = useQueryClient();
    const { message } = AntApp.useApp();
    const [name, setName] = useState(webhook?.name ?? "");
    const [url, setUrl] = useState(webhook?.url ?? "");
    const [events, setEvents] = useState<WebhookEvent[]>(
        webhook?.events ?? ["task.created"],
    );
    const [isActive, setIsActive] = useState(webhook?.isActive ?? true);

    const save = useMutation({
        mutationFn: () =>
            webhook
                ? mockApi.webhooks.update(webhook.id, {
                      name,
                      url,
                      events,
                      isActive,
                  })
                : mockApi.webhooks.create({ name, url, events, isActive }),
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ["webhooks"] });
            message.success(webhook ? "Webhook updated" : "Webhook created");
            onClose();
        },
    });

    return (
        <Modal
            open
            onCancel={onClose}
            onOk={() => save.mutate()}
            okText={webhook ? "Save" : "Create"}
            okButtonProps={{
                disabled: !name.trim() || !url.trim() || events.length === 0,
                loading: save.isPending,
            }}
            title={webhook ? "Edit webhook" : "New webhook"}
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
                    <Label>Name</Label>
                    <Input
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="e.g. Slack #ops"
                        autoFocus
                    />
                </div>
                <div>
                    <Label>URL</Label>
                    <Input
                        value={url}
                        onChange={(e) => setUrl(e.target.value)}
                        placeholder="https://hooks.example.com/..."
                        style={{
                            fontFamily: tokens.typography.fontFamilyMono,
                        }}
                    />
                </div>
                <div>
                    <Label>Events</Label>
                    <Select
                        mode="multiple"
                        value={events}
                        onChange={(v) => setEvents(v as WebhookEvent[])}
                        style={{ width: "100%" }}
                        options={EVENT_OPTIONS.map((e) => ({
                            value: e,
                            label: e,
                        }))}
                    />
                </div>
                <div
                    style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                    }}
                >
                    <Switch checked={isActive} onChange={setIsActive} />
                    <span style={{ fontSize: 13 }}>Active</span>
                </div>
            </div>
        </Modal>
    );
};

const ApiKeyCreateModal = ({ onClose }: { onClose: () => void }) => {
    const qc = useQueryClient();
    const { message } = AntApp.useApp();
    const [name, setName] = useState("");
    const [scopes, setScopes] = useState<ApiScope[]>(["read"]);
    const [createdSecret, setCreatedSecret] = useState<string | null>(null);

    const create = useMutation({
        mutationFn: () => mockApi.apiKeys.create({ name, scopes }),
        onSuccess: (result) => {
            qc.invalidateQueries({ queryKey: ["api-keys"] });
            setCreatedSecret(result.fullSecret);
        },
    });

    return (
        <Modal
            open
            onCancel={() => {
                onClose();
                setCreatedSecret(null);
            }}
            onOk={() => {
                if (createdSecret) {
                    onClose();
                    setCreatedSecret(null);
                } else {
                    create.mutate();
                }
            }}
            okText={createdSecret ? "Done" : "Generate key"}
            okButtonProps={{
                disabled: !name.trim() || scopes.length === 0,
                loading: create.isPending,
            }}
            title="Generate API key"
            cancelButtonProps={{ style: { display: createdSecret ? "none" : undefined } }}
        >
            {createdSecret ? (
                <>
                    <Alert
                        type="warning"
                        showIcon
                        message="Copy this key now — it won't be shown again."
                        style={{ marginBottom: 12 }}
                    />
                    <div
                        style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 6,
                            background: tokens.colors.bgMuted,
                            padding: 12,
                            borderRadius: tokens.radius.sm,
                            fontFamily: tokens.typography.fontFamilyMono,
                            fontSize: 12,
                            wordBreak: "break-all",
                        }}
                    >
                        <code style={{ flex: 1 }}>{createdSecret}</code>
                        <Button
                            size="small"
                            icon={<Copy size={13} strokeWidth={1.75} />}
                            onClick={() => {
                                navigator.clipboard.writeText(createdSecret);
                                message.success("Key copied");
                            }}
                        />
                    </div>
                </>
            ) : (
                <div
                    style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: 12,
                        paddingTop: 8,
                    }}
                >
                    <div>
                        <Label>Name</Label>
                        <Input
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            placeholder="e.g. Analytics service"
                            autoFocus
                        />
                    </div>
                    <div>
                        <Label>Scopes</Label>
                        <Select
                            mode="multiple"
                            value={scopes}
                            onChange={(v) => setScopes(v as ApiScope[])}
                            style={{ width: "100%" }}
                            options={[
                                { value: "read", label: "Read — list & view" },
                                { value: "write", label: "Write — create & update" },
                                { value: "admin", label: "Admin — full access" },
                            ]}
                        />
                    </div>
                </div>
            )}
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

export default WebhooksSettings;
