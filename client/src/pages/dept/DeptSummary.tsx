import { useQuery } from "@tanstack/react-query";
import { Alert, Avatar, Button, Empty, Skeleton, Table, Tooltip } from "antd";
import type { ColumnsType } from "antd/es/table";
import {
    AlertTriangle,
    CalendarClock,
    ClipboardCheck,
    Flag,
} from "lucide-react";
import { reviewsApi } from "../../http/api";
import { CountUp } from "../../components/ui/CountUp";
import { tokens } from "../../theme";
import type { ReviewSummary, ReviewSummaryMember } from "../../types";

/**
 * Dept Review V1 — P14: the summary tiles + per-member rollup for /dept.
 *
 * Tiles read `totals` (task-level DEDUPED — never the sum of member rows);
 * the table shows PER-ASSIGNEE rows with the synthetic "Unassigned" row last
 * and deactivated members muted. Clicking a named member toggles the
 * `member` filter the review queue (P15) consumes.
 */

const relTime = (iso: string): string => {
    const diff = Date.now() - new Date(iso).getTime();
    const m = Math.floor(diff / 60000);
    if (m < 1) return "just now";
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    const d = Math.floor(h / 24);
    if (d < 7) return `${d}d ago`;
    return new Date(iso).toLocaleDateString();
};

interface TileProps {
    label: string;
    value: number;
    color: string;
    icon: React.ComponentType<{ size?: number; strokeWidth?: number }>;
}

const DeptTile = ({ label, value, color, icon: Icon }: TileProps) => (
    <div
        style={{
            background: tokens.colors.bgSurface,
            border: `1px solid ${tokens.colors.border}`,
            borderRadius: tokens.radius.lg,
            padding: tokens.spacing[4],
            display: "flex",
            flexDirection: "column",
            gap: tokens.spacing[2],
        }}
    >
        <div
            style={{
                display: "flex",
                alignItems: "center",
                gap: tokens.spacing[2],
                fontSize: tokens.typography.fontSize.sm,
                color: tokens.colors.textSecondary,
                fontWeight: 500,
            }}
        >
            <span style={{ color, display: "inline-flex" }}>
                <Icon size={15} strokeWidth={1.75} />
            </span>
            {label}
        </div>
        <div
            style={{
                fontFamily: tokens.typography.fontFamilyMono,
                fontSize: tokens.typography.fontSize["3xl"],
                fontWeight: 700,
                color: tokens.colors.textPrimary,
                lineHeight: 1,
                letterSpacing: "-0.03em",
            }}
        >
            <CountUp value={value} />
        </div>
    </div>
);

const memberKey = (m: ReviewSummaryMember): string =>
    m.user?.id ?? "unassigned";

interface DeptSummaryProps {
    spaceId: string;
    selectedMemberId: string | null;
    onSelectMember: (userId: string | null) => void;
}

export const DeptSummary = ({
    spaceId,
    selectedMemberId,
    onSelectMember,
}: DeptSummaryProps) => {
    const { data, isLoading, isError, refetch } = useQuery<ReviewSummary>({
        queryKey: ["review-summary", spaceId],
        queryFn: () => reviewsApi.summary(spaceId),
    });

    if (isLoading) {
        return (
            <div
                style={{
                    display: "grid",
                    gridTemplateColumns:
                        "repeat(auto-fit, minmax(180px, 1fr))",
                    gap: tokens.spacing[4],
                }}
            >
                {[1, 2, 3, 4].map((i) => (
                    <div
                        key={i}
                        style={{
                            background: tokens.colors.bgSurface,
                            border: `1px solid ${tokens.colors.border}`,
                            borderRadius: tokens.radius.lg,
                            padding: tokens.spacing[4],
                        }}
                    >
                        <Skeleton active paragraph={{ rows: 1 }} />
                    </div>
                ))}
            </div>
        );
    }
    if (isError || !data) {
        return (
            <Alert
                type="error"
                showIcon
                message="Couldn't load the department summary"
                action={
                    <Button size="small" onClick={() => refetch()}>
                        Retry
                    </Button>
                }
            />
        );
    }

    const columns: ColumnsType<ReviewSummaryMember> = [
        {
            title: "Member",
            key: "member",
            render: (_, m) => {
                if (!m.user) {
                    return (
                        <span style={{ color: tokens.colors.textMuted }}>
                            Unassigned tasks
                        </span>
                    );
                }
                const deactivated = m.user.status === "deactivated";
                return (
                    <div
                        style={{
                            display: "flex",
                            alignItems: "center",
                            gap: tokens.spacing[2],
                            opacity: deactivated ? 0.55 : 1,
                        }}
                    >
                        <Avatar
                            size="small"
                            src={m.user.avatarUrl ?? undefined}
                        >
                            {(m.user.firstName?.[0] ?? "") +
                                (m.user.lastName?.[0] ?? "")}
                        </Avatar>
                        <span
                            style={{
                                fontWeight: 500,
                                color: tokens.colors.textPrimary,
                            }}
                        >
                            {m.user.firstName} {m.user.lastName}
                        </span>
                        {deactivated && (
                            <span
                                style={{
                                    fontSize: tokens.typography.fontSize.xs,
                                    color: tokens.colors.textMuted,
                                }}
                            >
                                (deactivated)
                            </span>
                        )}
                    </div>
                );
            },
        },
        { title: "Open", dataIndex: "open", align: "right", width: 84 },
        {
            title: "Due today",
            dataIndex: "dueToday",
            align: "right",
            width: 100,
        },
        { title: "Overdue", dataIndex: "overdue", align: "right", width: 96 },
        {
            title: "Needs review",
            dataIndex: "doneUnreviewed",
            align: "right",
            width: 120,
        },
        { title: "Flagged", dataIndex: "flagged", align: "right", width: 92 },
        {
            title: "Last activity",
            key: "lastActivity",
            width: 130,
            render: (_, m) =>
                m.lastActivity ? (
                    <Tooltip
                        title={new Date(m.lastActivity).toLocaleString()}
                    >
                        <span style={{ color: tokens.colors.textSecondary }}>
                            {relTime(m.lastActivity)}
                        </span>
                    </Tooltip>
                ) : (
                    <span style={{ color: tokens.colors.textMuted }}>—</span>
                ),
        },
    ];

    return (
        <div
            style={{
                display: "flex",
                flexDirection: "column",
                gap: tokens.spacing[5],
            }}
        >
            {/* Tiles — task-level deduped totals */}
            <div
                data-testid="dept-tiles"
                style={{
                    display: "grid",
                    gridTemplateColumns:
                        "repeat(auto-fit, minmax(180px, 1fr))",
                    gap: tokens.spacing[4],
                }}
            >
                <DeptTile
                    label="Needs review"
                    value={data.totals.doneUnreviewed}
                    color={tokens.colors.primary}
                    icon={ClipboardCheck}
                />
                <DeptTile
                    label="Flagged"
                    value={data.totals.flagged}
                    color={tokens.colors.danger}
                    icon={Flag}
                />
                <DeptTile
                    label="Overdue"
                    value={data.totals.overdue}
                    color={tokens.colors.danger}
                    icon={AlertTriangle}
                />
                <DeptTile
                    label="Due today"
                    value={data.totals.dueToday}
                    color={tokens.colors.warning}
                    icon={CalendarClock}
                />
            </div>

            {/* Per-member rollup */}
            <div
                data-testid="dept-members"
                style={{
                    background: tokens.colors.bgSurface,
                    border: `1px solid ${tokens.colors.border}`,
                    borderRadius: tokens.radius.lg,
                    overflow: "hidden",
                }}
            >
                {data.members.length === 0 ? (
                    <div style={{ padding: tokens.spacing[6] }}>
                        <Empty description="No task activity in this department yet." />
                    </div>
                ) : (
                    <Table<ReviewSummaryMember>
                        size="small"
                        rowKey={memberKey}
                        columns={columns}
                        dataSource={data.members}
                        pagination={false}
                        onRow={(m) => {
                            const clickable = !!m.user;
                            const selected =
                                clickable &&
                                m.user!.id === selectedMemberId;
                            return {
                                onClick: clickable
                                    ? () =>
                                          onSelectMember(
                                              selected ? null : m.user!.id,
                                          )
                                    : undefined,
                                style: {
                                    cursor: clickable
                                        ? "pointer"
                                        : "default",
                                    background: selected
                                        ? `${tokens.colors.primary}14`
                                        : undefined,
                                },
                            };
                        }}
                    />
                )}
            </div>
            {selectedMemberId && (
                <div
                    style={{
                        fontSize: tokens.typography.fontSize.sm,
                        color: tokens.colors.textSecondary,
                    }}
                >
                    Queue filtered to one member —{" "}
                    <Button
                        size="small"
                        type="link"
                        style={{ padding: 0 }}
                        onClick={() => onSelectMember(null)}
                    >
                        clear filter
                    </Button>
                </div>
            )}
        </div>
    );
};
