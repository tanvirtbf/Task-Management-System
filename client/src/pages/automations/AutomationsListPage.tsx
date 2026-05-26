import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import {
    Button,
    Switch,
    App as AntApp,
    Empty,
    Popconfirm,
    Tag,
    Dropdown,
} from "antd";
import {
    Plus,
    Zap,
    Pencil,
    Trash2,
    History,
    MoreHorizontal,
    Play,
} from "lucide-react";
import { mockApi } from "../../lib/mock-api";
import { listsById } from "../../mocks/lists";
import { AutomationPreview } from "../../components/automation/AutomationPreview";
import { tokens } from "../../theme";

const formatLastRun = (iso: string | null): string => {
    if (!iso) return "Never";
    const diff = Date.now() - new Date(iso).getTime();
    const m = Math.floor(diff / 60000);
    if (m < 1) return "just now";
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    return `${Math.floor(h / 24)}d ago`;
};

const AutomationsListPage = () => {
    const navigate = useNavigate();
    const qc = useQueryClient();
    const { message } = AntApp.useApp();

    const { data: automations = [], isLoading } = useQuery({
        queryKey: ["automations"],
        queryFn: () => mockApi.automations.list(),
    });

    const toggleActive = useMutation({
        mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
            mockApi.automations.update(id, { isActive }),
        onSuccess: (auto) => {
            qc.invalidateQueries({ queryKey: ["automations"] });
            message.success(
                auto.isActive
                    ? `“${auto.name}” turned on`
                    : `“${auto.name}” paused`,
            );
        },
    });

    const deleteMutation = useMutation({
        mutationFn: (id: string) => mockApi.automations.delete(id),
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ["automations"] });
            message.success("Automation deleted");
        },
    });

    const testRun = useMutation({
        mutationFn: (id: string) => mockApi.automations.test(id),
        onSuccess: (run) => {
            qc.invalidateQueries({ queryKey: ["automation-runs"] });
            message.success(
                `Test run completed in ${run.durationMs}ms — ${run.actionsLog.length} actions simulated`,
            );
        },
    });

    return (
        <div
            style={{
                padding: tokens.spacing[6],
                maxWidth: 1100,
                margin: "0 auto",
            }}
        >
            <div
                style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    marginBottom: tokens.spacing[6],
                }}
            >
                <div
                    style={{
                        display: "flex",
                        alignItems: "center",
                        gap: tokens.spacing[3],
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
                        <Zap size={22} strokeWidth={1.75} />
                    </div>
                    <div>
                        <h1
                            style={{
                                margin: 0,
                                fontSize: tokens.typography.fontSize["3xl"],
                                fontWeight: 700,
                                letterSpacing: "-0.02em",
                            }}
                        >
                            Automations
                        </h1>
                        <p
                            style={{
                                margin: 0,
                                marginTop: 2,
                                color: tokens.colors.textSecondary,
                                fontSize: tokens.typography.fontSize.sm,
                            }}
                        >
                            No-code rules — trigger, conditions, actions.
                        </p>
                    </div>
                </div>
                <Button
                    type="primary"
                    icon={<Plus size={14} strokeWidth={2} />}
                    onClick={() => navigate("/automations/new")}
                >
                    New automation
                </Button>
            </div>

            {isLoading ? (
                <div>Loading...</div>
            ) : automations.length === 0 ? (
                <Empty
                    image={
                        <Zap
                            size={48}
                            strokeWidth={1.25}
                            color={tokens.colors.textMuted}
                        />
                    }
                    description="No automations yet."
                >
                    <Button
                        type="primary"
                        onClick={() => navigate("/automations/new")}
                        icon={<Plus size={14} strokeWidth={2} />}
                    >
                        Create the first automation
                    </Button>
                </Empty>
            ) : (
                <div
                    style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: tokens.spacing[3],
                    }}
                >
                    {automations.map((auto) => {
                        const list = listsById.get(auto.scopeId);
                        return (
                            <div
                                key={auto.id}
                                style={{
                                    background: tokens.colors.bgSurface,
                                    border: `1px solid ${tokens.colors.border}`,
                                    borderRadius: tokens.radius.lg,
                                    padding: tokens.spacing[4],
                                    display: "flex",
                                    flexDirection: "column",
                                    gap: tokens.spacing[3],
                                    opacity: auto.isActive ? 1 : 0.65,
                                    transition: "opacity var(--transition-base)",
                                }}
                            >
                                <div
                                    style={{
                                        display: "flex",
                                        alignItems: "flex-start",
                                        gap: tokens.spacing[3],
                                    }}
                                >
                                    <Switch
                                        checked={auto.isActive}
                                        onChange={(v) =>
                                            toggleActive.mutate({
                                                id: auto.id,
                                                isActive: v,
                                            })
                                        }
                                        size="small"
                                        style={{ marginTop: 4 }}
                                    />
                                    <div style={{ flex: 1, minWidth: 0 }}>
                                        <div
                                            style={{
                                                display: "flex",
                                                alignItems: "center",
                                                gap: 8,
                                                marginBottom: 2,
                                            }}
                                        >
                                            <h3
                                                style={{
                                                    margin: 0,
                                                    fontSize:
                                                        tokens.typography.fontSize
                                                            .base,
                                                    fontWeight: 600,
                                                    color: tokens.colors.textPrimary,
                                                }}
                                            >
                                                {auto.name}
                                            </h3>
                                            {!auto.isActive && <Tag>Paused</Tag>}
                                        </div>
                                        <div
                                            style={{
                                                fontSize: 11,
                                                color: tokens.colors.textMuted,
                                                display: "flex",
                                                gap: 12,
                                                fontFamily:
                                                    tokens.typography.fontFamilyMono,
                                            }}
                                        >
                                            <span>
                                                In: <strong>{list?.name ?? "—"}</strong>
                                            </span>
                                            <span>
                                                Ran <strong>{auto.runCount}×</strong>
                                            </span>
                                            <span>
                                                Last:{" "}
                                                <strong>
                                                    {formatLastRun(auto.lastRunAt)}
                                                </strong>
                                            </span>
                                        </div>
                                    </div>

                                    <div
                                        style={{
                                            display: "flex",
                                            gap: 4,
                                            flexShrink: 0,
                                        }}
                                    >
                                        <Button
                                            size="small"
                                            icon={
                                                <Play
                                                    size={12}
                                                    strokeWidth={1.75}
                                                />
                                            }
                                            onClick={() => testRun.mutate(auto.id)}
                                            loading={testRun.isPending}
                                        >
                                            Test
                                        </Button>
                                        <Button
                                            size="small"
                                            icon={
                                                <Pencil
                                                    size={12}
                                                    strokeWidth={1.75}
                                                />
                                            }
                                            onClick={() =>
                                                navigate(
                                                    `/automations/${auto.id}/edit`,
                                                )
                                            }
                                        >
                                            Edit
                                        </Button>
                                        <Dropdown
                                            menu={{
                                                items: [
                                                    {
                                                        key: "runs",
                                                        label: "View run history",
                                                        icon: (
                                                            <History
                                                                size={13}
                                                                strokeWidth={1.75}
                                                            />
                                                        ),
                                                        onClick: () =>
                                                            navigate(
                                                                `/automations/${auto.id}/runs`,
                                                            ),
                                                    },
                                                ],
                                            }}
                                            trigger={["click"]}
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
                                        <Popconfirm
                                            title="Delete this automation?"
                                            okType="danger"
                                            onConfirm={() =>
                                                deleteMutation.mutate(auto.id)
                                            }
                                        >
                                            <Button
                                                size="small"
                                                type="text"
                                                danger
                                                icon={
                                                    <Trash2
                                                        size={12}
                                                        strokeWidth={1.75}
                                                    />
                                                }
                                            />
                                        </Popconfirm>
                                    </div>
                                </div>

                                <AutomationPreview automation={auto} />
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
};

export default AutomationsListPage;
