import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import {
    Button,
    Input,
    Empty,
    App as AntApp,
    Popconfirm,
    Dropdown,
    Modal,
    Select,
} from "antd";
import {
    BarChart3,
    Plus,
    Search,
    Star,
    Copy,
    Trash2,
    MoreHorizontal,
    Globe,
    Folder,
    List as ListIcon,
} from "lucide-react";
import { mockApi } from "../../lib/mock-api";
import { DynamicIcon } from "../../components/shared/DynamicIcon";
import { LoadingState } from "../../components/shared/LoadingState";
import { tokens } from "../../theme";
import type { Dashboard } from "../../types/dashboard";

const DashboardsListPage = () => {
    const navigate = useNavigate();
    const qc = useQueryClient();
    const { message } = AntApp.useApp();
    const [query, setQuery] = useState("");
    const [createOpen, setCreateOpen] = useState(false);

    const { data: dashboards = [], isLoading } = useQuery({
        queryKey: ["dashboards"],
        queryFn: () => mockApi.dashboards.list(),
    });

    const filtered = useMemo(() => {
        const q = query.trim().toLowerCase();
        if (!q) return dashboards;
        return dashboards.filter((d) => d.name.toLowerCase().includes(q));
    }, [dashboards, query]);

    const toggleFavorite = useMutation({
        mutationFn: ({ id, isFavorite }: { id: string; isFavorite: boolean }) =>
            mockApi.dashboards.update(id, { isFavorite }),
        onSuccess: () => qc.invalidateQueries({ queryKey: ["dashboards"] }),
    });

    const duplicate = useMutation({
        mutationFn: (id: string) => mockApi.dashboards.duplicate(id),
        onSuccess: (d) => {
            qc.invalidateQueries({ queryKey: ["dashboards"] });
            message.success(`Duplicated as “${d.name}”`);
        },
    });

    const remove = useMutation({
        mutationFn: (id: string) => mockApi.dashboards.delete(id),
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ["dashboards"] });
            message.success("Dashboard deleted");
        },
    });

    return (
        <div
            style={{
                padding: tokens.spacing[6],
                maxWidth: 1200,
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
                    <BarChart3 size={22} strokeWidth={1.75} />
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
                        Dashboards
                    </h1>
                    <p
                        style={{
                            margin: 0,
                            marginTop: 2,
                            color: tokens.colors.textSecondary,
                            fontSize: tokens.typography.fontSize.sm,
                        }}
                    >
                        KPI snapshots, charts, and live task lists.
                    </p>
                </div>
                <Input
                    prefix={
                        <Search
                            size={13}
                            strokeWidth={1.75}
                            color={tokens.colors.textMuted}
                        />
                    }
                    placeholder="Search dashboards..."
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    style={{ width: 240 }}
                />
                <Button
                    type="primary"
                    icon={<Plus size={14} strokeWidth={2} />}
                    onClick={() => setCreateOpen(true)}
                >
                    New dashboard
                </Button>
            </div>

            {isLoading ? (
                <LoadingState />
            ) : filtered.length === 0 ? (
                <Empty
                    image={
                        <BarChart3
                            size={48}
                            strokeWidth={1.25}
                            color={tokens.colors.textMuted}
                        />
                    }
                    description={
                        query
                            ? "No dashboards match your search."
                            : "No dashboards yet."
                    }
                >
                    {!query && (
                        <Button
                            type="primary"
                            onClick={() => setCreateOpen(true)}
                            icon={<Plus size={14} strokeWidth={2} />}
                        >
                            Create the first dashboard
                        </Button>
                    )}
                </Empty>
            ) : (
                <div
                    style={{
                        display: "grid",
                        gridTemplateColumns:
                            "repeat(auto-fill, minmax(280px, 1fr))",
                        gap: tokens.spacing[3],
                    }}
                >
                    {filtered.map((d) => (
                        <DashboardCard
                            key={d.id}
                            dashboard={d}
                            onOpen={() => navigate(`/dashboards/${d.id}`)}
                            onToggleFavorite={() =>
                                toggleFavorite.mutate({
                                    id: d.id,
                                    isFavorite: !d.isFavorite,
                                })
                            }
                            onDuplicate={() => duplicate.mutate(d.id)}
                            onDelete={() => remove.mutate(d.id)}
                        />
                    ))}
                </div>
            )}

            {createOpen && (
                <CreateDashboardModal
                    onClose={() => setCreateOpen(false)}
                    onCreated={(d) => {
                        setCreateOpen(false);
                        navigate(`/dashboards/${d.id}`);
                    }}
                />
            )}
        </div>
    );
};

const DashboardCard = ({
    dashboard,
    onOpen,
    onToggleFavorite,
    onDuplicate,
    onDelete,
}: {
    dashboard: Dashboard;
    onOpen: () => void;
    onToggleFavorite: () => void;
    onDuplicate: () => void;
    onDelete: () => void;
}) => {
    const ScopeIcon =
        dashboard.scope.type === "workspace"
            ? Globe
            : dashboard.scope.type === "space"
              ? Folder
              : ListIcon;

    return (
        <div
            onClick={onOpen}
            style={{
                background: tokens.colors.bgSurface,
                border: `1px solid ${tokens.colors.border}`,
                borderRadius: tokens.radius.lg,
                padding: tokens.spacing[4],
                cursor: "pointer",
                transition: "all var(--transition-base)",
                display: "flex",
                flexDirection: "column",
                gap: tokens.spacing[3],
            }}
            onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = dashboard.color;
                e.currentTarget.style.boxShadow = tokens.shadows.md;
            }}
            onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = tokens.colors.border;
                e.currentTarget.style.boxShadow = "none";
            }}
        >
            <div
                style={{
                    display: "flex",
                    alignItems: "flex-start",
                    gap: tokens.spacing[3],
                }}
            >
                <div
                    style={{
                        width: 40,
                        height: 40,
                        borderRadius: tokens.radius.md,
                        background: `${dashboard.color}1A`,
                        color: dashboard.color,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        flexShrink: 0,
                    }}
                >
                    <DynamicIcon
                        name={dashboard.icon}
                        size={20}
                        strokeWidth={1.75}
                    />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                    <h3
                        style={{
                            margin: 0,
                            fontSize: tokens.typography.fontSize.base,
                            fontWeight: 600,
                            color: tokens.colors.textPrimary,
                        }}
                    >
                        {dashboard.name}
                    </h3>
                    <p
                        style={{
                            margin: 0,
                            marginTop: 2,
                            fontSize: 11,
                            color: tokens.colors.textMuted,
                            lineHeight: 1.4,
                            display: "-webkit-box",
                            WebkitLineClamp: 2,
                            WebkitBoxOrient: "vertical",
                            overflow: "hidden",
                        }}
                    >
                        {dashboard.description ?? "No description."}
                    </p>
                </div>
                <div
                    style={{ display: "flex", gap: 4, flexShrink: 0 }}
                    onClick={(e) => e.stopPropagation()}
                >
                    <button
                        onClick={onToggleFavorite}
                        title={dashboard.isFavorite ? "Unfavorite" : "Favorite"}
                        style={{
                            background: "transparent",
                            border: 0,
                            cursor: "pointer",
                            padding: 4,
                            color: dashboard.isFavorite
                                ? tokens.colors.warning
                                : tokens.colors.textMuted,
                            display: "inline-flex",
                        }}
                    >
                        <Star
                            size={14}
                            strokeWidth={1.75}
                            fill={
                                dashboard.isFavorite
                                    ? tokens.colors.warning
                                    : "none"
                            }
                        />
                    </button>
                    <Dropdown
                        menu={{
                            items: [
                                {
                                    key: "duplicate",
                                    icon: <Copy size={13} strokeWidth={1.75} />,
                                    label: "Duplicate",
                                    onClick: onDuplicate,
                                },
                                { type: "divider" },
                                {
                                    key: "delete",
                                    icon: <Trash2 size={13} strokeWidth={1.75} />,
                                    label: "Delete",
                                    danger: true,
                                },
                            ],
                            onClick: ({ key, domEvent }) => {
                                domEvent.stopPropagation();
                                if (key === "delete") {
                                    Modal.confirm({
                                        title: `Delete “${dashboard.name}”?`,
                                        okType: "danger",
                                        onOk: onDelete,
                                    });
                                }
                            },
                        }}
                        trigger={["click"]}
                    >
                        <button
                            style={{
                                background: "transparent",
                                border: 0,
                                cursor: "pointer",
                                padding: 4,
                                color: tokens.colors.textMuted,
                                display: "inline-flex",
                            }}
                        >
                            <MoreHorizontal
                                size={14}
                                strokeWidth={1.75}
                            />
                        </button>
                    </Dropdown>
                </div>
            </div>

            <div
                style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    paddingTop: 6,
                    borderTop: `1px dashed ${tokens.colors.borderSubtle}`,
                    fontSize: 11,
                    color: tokens.colors.textMuted,
                    fontFamily: tokens.typography.fontFamilyMono,
                }}
            >
                <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                    <ScopeIcon size={11} strokeWidth={1.75} />
                    {dashboard.scope.type}
                </span>
                <span>{dashboard.widgets.length} widgets</span>
                <span style={{ marginLeft: "auto" }}>{dashboard.sharing}</span>
            </div>
        </div>
    );
};

const CreateDashboardModal = ({
    onClose,
    onCreated,
}: {
    onClose: () => void;
    onCreated: (d: Dashboard) => void;
}) => {
    const [name, setName] = useState("");
    const [icon] = useState("BarChart3");
    const [color, setColor] = useState("#4F46E5");
    const [sharing, setSharing] = useState<Dashboard["sharing"]>("members");

    const create = useMutation({
        mutationFn: () =>
            mockApi.dashboards.create({
                name: name.trim() || "Untitled dashboard",
                icon,
                color,
                sharing,
                scope: { type: "workspace" },
                widgets: [],
            }),
        onSuccess: onCreated,
    });

    return (
        <Modal
            open
            onCancel={onClose}
            onOk={() => create.mutate()}
            okText="Create"
            okButtonProps={{
                disabled: !name.trim(),
                loading: create.isPending,
            }}
            title="New dashboard"
        >
            <div
                style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 12,
                }}
            >
                <div>
                    <label
                        style={{
                            display: "block",
                            fontSize: 11,
                            fontWeight: 600,
                            color: tokens.colors.textMuted,
                            textTransform: "uppercase",
                            letterSpacing: "0.05em",
                            marginBottom: 6,
                        }}
                    >
                        Name
                    </label>
                    <Input
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="e.g. Sales Overview"
                        autoFocus
                    />
                </div>
                <div>
                    <label
                        style={{
                            display: "block",
                            fontSize: 11,
                            fontWeight: 600,
                            color: tokens.colors.textMuted,
                            textTransform: "uppercase",
                            letterSpacing: "0.05em",
                            marginBottom: 6,
                        }}
                    >
                        Color
                    </label>
                    <div style={{ display: "flex", gap: 6 }}>
                        {[
                            "#4F46E5",
                            "#10B981",
                            "#F59E0B",
                            "#E11D48",
                            "#8B5CF6",
                            "#06B6D4",
                            "#EC4899",
                        ].map((c) => (
                            <button
                                key={c}
                                onClick={() => setColor(c)}
                                style={{
                                    width: 28,
                                    height: 28,
                                    borderRadius: "50%",
                                    border:
                                        color === c
                                            ? `2px solid ${tokens.colors.textPrimary}`
                                            : "2px solid transparent",
                                    background: c,
                                    cursor: "pointer",
                                }}
                            />
                        ))}
                    </div>
                </div>
                <div>
                    <label
                        style={{
                            display: "block",
                            fontSize: 11,
                            fontWeight: 600,
                            color: tokens.colors.textMuted,
                            textTransform: "uppercase",
                            letterSpacing: "0.05em",
                            marginBottom: 6,
                        }}
                    >
                        Sharing
                    </label>
                    <Select
                        value={sharing}
                        onChange={setSharing}
                        style={{ width: "100%" }}
                        options={[
                            { value: "private", label: "Private (just me)" },
                            { value: "members", label: "All workspace members" },
                            { value: "admins", label: "Admins only" },
                        ]}
                    />
                </div>
            </div>
        </Modal>
    );
};

export default DashboardsListPage;
