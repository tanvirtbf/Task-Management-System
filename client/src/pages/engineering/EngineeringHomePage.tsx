import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Skeleton, Tag } from "antd";
import { Bug, Eye, AlertOctagon, Sparkles, Zap, Code, Shield, GitPullRequest } from "lucide-react";
import { engineeringApi } from "../../http/api";
import { useAuthStore } from "../../stores/auth";
import { Avatar } from "../../components/ui/Avatar";
import { BugSeverityBadge } from "../../components/task/BugSeverityBadge";
import { StoryPointsBadge } from "../../components/task/StoryPointsBadge";
import { tokens } from "../../theme";
import { useListMap } from "../../hooks/useReferenceData";

const EngineeringHomePage = () => {
    const user = useAuthStore((s) => s.user);
    const navigate = useNavigate();
    const listMap = useListMap();
    // One rollup call replaces the old 3 hardcoded-list fetches + mock derivations.
    const { data: home, isLoading } = useQuery({
        queryKey: ["eng-home"],
        queryFn: () => engineeringApi.home(),
    });

    const onCall = home?.currentOnCall ?? null;
    const openBugs = home?.openBugs.top ?? [];
    const openIncidents = home?.openIncidents.top ?? [];
    const mySprintTasks = home?.mySprintTasks ?? [];
    const prsAwaitingMe = home?.prsAwaitingMe ?? [];
    const stale = home?.staleTickets ?? [];

    // KI-13 fix: the eng dashboard used to link to hardcoded seed ids
    // (`sp-eng`/`l-bug-triage`/`l-incidents`/`l-sprint`) that don't exist in a
    // real workspace. Resolve the actual list from a representative task instead,
    // and open individual tasks through the canonical `/t/:id` redirect.
    const goToList = (task?: { primaryListId: string }) => {
        const list = task && listMap.get(task.primaryListId);
        if (list) navigate(`/s/${list.spaceId}/l/${list.id}`);
    };
    const goToTask = (t: { id: string; customId?: string }) =>
        navigate(`/t/${t.customId ?? t.id}`);

    return (
        <div
            style={{
                padding: tokens.spacing[6],
                maxWidth: 1280,
                margin: "0 auto",
                display: "flex",
                flexDirection: "column",
                gap: tokens.spacing[5],
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
                        width: 40,
                        height: 40,
                        borderRadius: tokens.radius.md,
                        background: "#0EA5E91A",
                        color: "#0EA5E9",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                    }}
                >
                    <Code size={20} strokeWidth={1.75} />
                </div>
                <div style={{ flex: 1 }}>
                    <h1
                        style={{
                            margin: 0,
                            fontSize: tokens.typography.fontSize["2xl"],
                            fontWeight: 700,
                            letterSpacing: "-0.02em",
                        }}
                    >
                        Engineering
                    </h1>
                    <div
                        style={{
                            fontSize: tokens.typography.fontSize.sm,
                            color: tokens.colors.textSecondary,
                            marginTop: 2,
                        }}
                    >
                        Bug triage, active sprint, incidents — all in one view.
                    </div>
                </div>
                {onCall && (
                    <div
                        style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 8,
                            padding: "6px 12px",
                            background: tokens.colors.bgSurface,
                            border: `1px solid ${tokens.colors.border}`,
                            borderRadius: tokens.radius.md,
                        }}
                    >
                        <Shield
                            size={14}
                            strokeWidth={1.75}
                            color={tokens.colors.warning}
                        />
                        <span
                            style={{
                                fontSize: 11,
                                color: tokens.colors.textMuted,
                                fontWeight: 600,
                                textTransform: "uppercase",
                                letterSpacing: "0.05em",
                            }}
                        >
                            On-call
                        </span>
                        <Avatar
                            name={`${onCall.firstName} ${onCall.lastName}`}
                            src={onCall.avatarUrl}
                            size={22}
                        />
                        <span
                            style={{
                                fontSize: tokens.typography.fontSize.sm,
                                fontWeight: 600,
                            }}
                        >
                            {onCall.firstName}
                        </span>
                    </div>
                )}
            </div>

            {/* KPI tiles */}
            <div
                style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
                    gap: tokens.spacing[3],
                }}
            >
                <KpiTile
                    label="Open bugs"
                    value={home?.openBugs.count ?? 0}
                    icon={Bug}
                    color="#E11D48"
                    onClick={() => goToList(openBugs[0])}
                />
                <KpiTile
                    label="In sprint (mine)"
                    value={mySprintTasks.length}
                    icon={Zap}
                    color="#0EA5E9"
                    onClick={() => navigate("/eng/sprint")}
                />
                <KpiTile
                    label="PRs awaiting me"
                    value={prsAwaitingMe.length}
                    icon={GitPullRequest}
                    color="#10B981"
                />
                <KpiTile
                    label="Open incidents"
                    value={home?.openIncidents.count ?? 0}
                    icon={AlertOctagon}
                    color="#DC2626"
                    onClick={() => goToList(openIncidents[0])}
                />
                <KpiTile
                    label="Stale tickets"
                    value={stale.length}
                    icon={Sparkles}
                    color="#F59E0B"
                />
            </div>

            {/* Two columns: open bugs + my sprint tasks */}
            <div
                style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr",
                    gap: tokens.spacing[4],
                }}
                className="eng-home-grid"
            >
                <Card
                    icon={Bug}
                    color="#E11D48"
                    title="Open bugs (top 6)"
                    onSeeAll={() => goToList(openBugs[0])}
                >
                    {isLoading ? (
                        <Skeleton active paragraph={{ rows: 4 }} />
                    ) : openBugs.length === 0 ? (
                        <Empty />
                    ) : (
                        openBugs.slice(0, 6).map((t) => (
                            <button
                                key={t.id}
                                onClick={() => goToTask(t)}
                                style={rowBtn}
                            >
                                <span
                                    style={{
                                        fontFamily:
                                            tokens.typography.fontFamilyMono,
                                        fontSize: 11,
                                        color: tokens.colors.textMuted,
                                        marginRight: 8,
                                    }}
                                >
                                    {t.customId}
                                </span>
                                <BugSeverityBadge
                                    severity={t.bugSeverity}
                                    compact
                                />
                                <span
                                    style={{
                                        flex: 1,
                                        fontSize: tokens.typography.fontSize.sm,
                                        color: tokens.colors.textPrimary,
                                        overflow: "hidden",
                                        textOverflow: "ellipsis",
                                        whiteSpace: "nowrap",
                                        marginLeft: 8,
                                    }}
                                >
                                    {t.name}
                                </span>
                                {t.reporterTeam && (
                                    <Tag
                                        style={{
                                            margin: 0,
                                            fontSize: 10,
                                            border: 0,
                                        }}
                                    >
                                        {t.reporterTeam}
                                    </Tag>
                                )}
                            </button>
                        ))
                    )}
                </Card>

                <Card
                    icon={Zap}
                    color={tokens.colors.primary}
                    title="My sprint tasks"
                    onSeeAll={() => navigate("/eng/sprint")}
                >
                    {isLoading ? (
                        <Skeleton active paragraph={{ rows: 4 }} />
                    ) : mySprintTasks.length === 0 ? (
                        <Empty />
                    ) : (
                        mySprintTasks.slice(0, 6).map((t) => {
                            const isReviewer = t.reviewerId === user?.id;
                            return (
                                <button
                                    key={t.id}
                                    onClick={() => goToTask(t)}
                                    style={rowBtn}
                                >
                                    <span
                                        style={{
                                            fontFamily:
                                                tokens.typography
                                                    .fontFamilyMono,
                                            fontSize: 11,
                                            color: tokens.colors.textMuted,
                                            marginRight: 8,
                                        }}
                                    >
                                        {t.customId}
                                    </span>
                                    <span
                                        style={{
                                            flex: 1,
                                            fontSize:
                                                tokens.typography.fontSize.sm,
                                            color: tokens.colors.textPrimary,
                                            overflow: "hidden",
                                            textOverflow: "ellipsis",
                                            whiteSpace: "nowrap",
                                        }}
                                    >
                                        {t.name}
                                    </span>
                                    {isReviewer && (
                                        <Tag
                                            color="purple"
                                            style={{ margin: 0, fontSize: 10 }}
                                        >
                                            <Eye
                                                size={10}
                                                strokeWidth={1.75}
                                                style={{
                                                    verticalAlign: "middle",
                                                }}
                                            />{" "}
                                            Review
                                        </Tag>
                                    )}
                                    <StoryPointsBadge points={t.storyPoints} />
                                </button>
                            );
                        })
                    )}
                </Card>
            </div>
            <style>{`
                @media (max-width: 1024px) {
                    .eng-home-grid { grid-template-columns: 1fr !important; }
                }
            `}</style>
        </div>
    );
};

const KpiTile = ({
    label,
    value,
    icon: Icon,
    color,
    onClick,
}: {
    label: string;
    value: number;
    icon: React.ComponentType<{ size?: number; strokeWidth?: number; color?: string }>;
    color: string;
    onClick?: () => void;
}) => (
    <button
        onClick={onClick}
        disabled={!onClick}
        style={{
            background: tokens.colors.bgSurface,
            border: `1px solid ${tokens.colors.border}`,
            borderRadius: tokens.radius.lg,
            padding: tokens.spacing[4],
            display: "flex",
            flexDirection: "column",
            gap: 4,
            cursor: onClick ? "pointer" : "default",
            textAlign: "left",
        }}
    >
        <div
            style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                color: tokens.colors.textMuted,
                fontSize: 11,
                fontWeight: 600,
                textTransform: "uppercase",
                letterSpacing: "0.05em",
            }}
        >
            <Icon size={12} strokeWidth={1.75} color={color} />
            {label}
        </div>
        <div
            style={{
                fontFamily: tokens.typography.fontFamilyMono,
                fontSize: 26,
                fontWeight: 700,
                color: tokens.colors.textPrimary,
                lineHeight: 1,
            }}
        >
            {value}
        </div>
    </button>
);

const Card = ({
    icon: Icon,
    color,
    title,
    children,
    onSeeAll,
}: {
    icon: React.ComponentType<{ size?: number; strokeWidth?: number; color?: string }>;
    color: string;
    title: string;
    children: React.ReactNode;
    onSeeAll?: () => void;
}) => (
    <div
        style={{
            background: tokens.colors.bgSurface,
            border: `1px solid ${tokens.colors.border}`,
            borderRadius: tokens.radius.lg,
            display: "flex",
            flexDirection: "column",
        }}
    >
        <div
            style={{
                padding: `${tokens.spacing[3]}px ${tokens.spacing[4]}px`,
                borderBottom: `1px solid ${tokens.colors.borderSubtle}`,
                display: "flex",
                alignItems: "center",
                gap: 6,
            }}
        >
            <Icon size={14} strokeWidth={1.75} color={color} />
            <h3
                style={{
                    margin: 0,
                    fontSize: tokens.typography.fontSize.base,
                    fontWeight: 600,
                    color: tokens.colors.textPrimary,
                }}
            >
                {title}
            </h3>
            {onSeeAll && (
                <button
                    onClick={onSeeAll}
                    style={{
                        marginLeft: "auto",
                        background: "transparent",
                        border: 0,
                        color: tokens.colors.primary,
                        fontSize: 12,
                        fontWeight: 600,
                        cursor: "pointer",
                    }}
                >
                    See all →
                </button>
            )}
        </div>
        <div style={{ padding: tokens.spacing[2] }}>{children}</div>
    </div>
);

const Empty = () => (
    <div
        style={{
            padding: tokens.spacing[5],
            textAlign: "center",
            color: tokens.colors.textMuted,
            fontSize: 12,
        }}
    >
        Nothing here yet.
    </div>
);

const rowBtn: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    width: "100%",
    background: "transparent",
    border: 0,
    padding: "8px 10px",
    borderRadius: tokens.radius.sm,
    cursor: "pointer",
    textAlign: "left",
    gap: 4,
};

export default EngineeringHomePage;
