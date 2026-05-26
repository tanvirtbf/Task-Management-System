import { useQuery } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router-dom";
import { Button, Tag, Empty } from "antd";
import { ArrowLeft, CheckCircle2, XCircle, History, Clock } from "lucide-react";
import { mockApi } from "../../lib/mock-api";
import { tokens } from "../../theme";
import type { AutomationRun } from "../../types/automation";

const formatTime = (iso: string): string => {
    const diff = Date.now() - new Date(iso).getTime();
    const m = Math.floor(diff / 60000);
    if (m < 1) return "just now";
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    return `${Math.floor(h / 24)}d ago`;
};

const AutomationRunsPage = () => {
    const navigate = useNavigate();
    const { automationId } = useParams();
    const { data: auto } = useQuery({
        queryKey: ["automation", automationId],
        queryFn: () =>
            automationId
                ? mockApi.automations.getById(automationId)
                : Promise.resolve(null),
        enabled: !!automationId,
    });
    const { data: runs = [], isLoading } = useQuery({
        queryKey: ["automation-runs", automationId],
        queryFn: () =>
            automationId
                ? mockApi.automations.runs(automationId)
                : Promise.resolve([]),
        enabled: !!automationId,
    });

    return (
        <div
            style={{
                padding: tokens.spacing[6],
                maxWidth: 900,
                margin: "0 auto",
            }}
        >
            <Button
                type="text"
                size="small"
                icon={<ArrowLeft size={14} strokeWidth={1.75} />}
                onClick={() => navigate("/automations")}
                style={{ marginBottom: tokens.spacing[4] }}
            >
                Automations
            </Button>

            <div
                style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    marginBottom: tokens.spacing[5],
                }}
            >
                <History size={28} strokeWidth={1.5} color={tokens.colors.primary} />
                <div>
                    <h1
                        style={{
                            margin: 0,
                            fontSize: tokens.typography.fontSize["2xl"],
                            fontWeight: 700,
                        }}
                    >
                        Run history
                    </h1>
                    <p
                        style={{
                            margin: 0,
                            color: tokens.colors.textSecondary,
                            fontSize: tokens.typography.fontSize.sm,
                        }}
                    >
                        {auto?.name ?? ""}
                    </p>
                </div>
            </div>

            {isLoading ? (
                <div>Loading...</div>
            ) : runs.length === 0 ? (
                <Empty
                    description="No runs yet. Trigger the automation manually or wait for an event."
                />
            ) : (
                <div
                    style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: tokens.spacing[2],
                    }}
                >
                    {runs.map((run) => (
                        <RunCard key={run.id} run={run} />
                    ))}
                </div>
            )}
        </div>
    );
};

const RunCard = ({ run }: { run: AutomationRun }) => {
    const isSuccess = run.status === "success";
    return (
        <div
            style={{
                background: tokens.colors.bgSurface,
                border: `1px solid ${tokens.colors.border}`,
                borderRadius: tokens.radius.lg,
                padding: tokens.spacing[3],
            }}
        >
            <div
                style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    marginBottom: 4,
                }}
            >
                {isSuccess ? (
                    <CheckCircle2
                        size={16}
                        strokeWidth={1.75}
                        color={tokens.colors.success}
                    />
                ) : (
                    <XCircle
                        size={16}
                        strokeWidth={1.75}
                        color={tokens.colors.danger}
                    />
                )}
                <span
                    style={{
                        fontSize: tokens.typography.fontSize.sm,
                        fontWeight: 600,
                        color: isSuccess
                            ? tokens.colors.success
                            : tokens.colors.danger,
                        textTransform: "capitalize",
                    }}
                >
                    {run.status}
                </span>
                <Tag>
                    Trigger: {String(run.triggerEvent.type ?? "—")}
                </Tag>
                <div style={{ flex: 1 }} />
                <span
                    style={{
                        fontSize: 11,
                        color: tokens.colors.textMuted,
                        fontFamily: tokens.typography.fontFamilyMono,
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 4,
                    }}
                >
                    <Clock size={11} strokeWidth={1.75} />
                    {run.durationMs}ms
                </span>
                <span
                    style={{
                        fontSize: 11,
                        color: tokens.colors.textMuted,
                    }}
                >
                    {formatTime(run.startedAt)}
                </span>
            </div>
            {run.error && (
                <div
                    style={{
                        padding: 8,
                        background: "#FEF2F2",
                        borderRadius: tokens.radius.sm,
                        fontSize: 12,
                        color: tokens.colors.danger,
                        marginTop: 6,
                    }}
                >
                    {run.error}
                </div>
            )}
            <div
                style={{
                    marginTop: 6,
                    paddingLeft: 26,
                    fontSize: 12,
                    color: tokens.colors.textSecondary,
                }}
            >
                {run.actionsLog.map((log, idx) => (
                    <div
                        key={idx}
                        style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 6,
                            padding: "2px 0",
                        }}
                    >
                        {log.status === "success" ? (
                            <CheckCircle2
                                size={11}
                                strokeWidth={2}
                                color={tokens.colors.success}
                            />
                        ) : (
                            <XCircle
                                size={11}
                                strokeWidth={2}
                                color={tokens.colors.danger}
                            />
                        )}
                        <span style={{ fontFamily: tokens.typography.fontFamilyMono, fontSize: 11 }}>
                            {log.actionType.replace(/_/g, " ")}
                        </span>
                        <span style={{ color: tokens.colors.textMuted }}>
                            — {log.message}
                        </span>
                    </div>
                ))}
            </div>
        </div>
    );
};

export default AutomationRunsPage;
