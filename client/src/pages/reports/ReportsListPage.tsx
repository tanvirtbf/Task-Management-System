import { useMemo } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { Navigate, useNavigate } from "react-router-dom";
import { Alert, Avatar, Button, Empty, Skeleton, Tag } from "antd";
import { BarChart3, Check } from "lucide-react";
import { reportsApi } from "../../http/api";
import { useSpaceMap, useSpaces } from "../../hooks/useReferenceData";
import { useAuthStore } from "../../stores/auth";
import { tokens } from "../../theme";
import type { DeptReportListItem } from "../../types";

/**
 * Dept Review V1 — P24: the /reports inbox for HR (owner/admin see every
 * department; a head sees their own — the M-5/H-12 gate, mirrored from the
 * server). Reports arrive newest-week-first from the cursor API and are
 * grouped into week sections of department cards; P25 adds the detail page
 * behind each card.
 */

const fmtWeek = (weekStart: string, weekEnd: string): string => {
    const opts: Intl.DateTimeFormatOptions = {
        day: "numeric",
        month: "short",
    };
    const s = new Date(`${weekStart}T00:00:00`).toLocaleDateString(
        undefined,
        opts,
    );
    const e = new Date(`${weekEnd}T00:00:00`).toLocaleDateString(
        undefined,
        opts,
    );
    return `Week of ${s} – ${e}`;
};

const ReportsListPage = () => {
    const navigate = useNavigate();
    const me = useAuthStore((s) => s.user);
    const { data: spaces = [], isLoading: spacesLoading } = useSpaces();
    const spaceMap = useSpaceMap();

    const isAdmin = me?.role === "owner" || me?.role === "admin";
    const headsAny = spaces.some(
        (s) => !s.archivedAt && s.headUserId === me?.id,
    );
    const canSee = isAdmin || headsAny;

    const query = useInfiniteQuery({
        queryKey: ["reports"],
        queryFn: ({ pageParam }) =>
            reportsApi.list({ cursor: pageParam, limit: 50 }),
        initialPageParam: undefined as string | undefined,
        getNextPageParam: (last) =>
            last.pagination.hasMore
                ? (last.pagination.nextCursor ?? undefined)
                : undefined,
        enabled: canSee,
    });

    const rows = useMemo(
        () => (query.data?.pages ?? []).flatMap((p) => p.data),
        [query.data],
    );
    const weeks = useMemo(() => {
        const grouped = new Map<string, DeptReportListItem[]>();
        for (const r of rows) {
            const list = grouped.get(r.weekStart) ?? [];
            list.push(r);
            grouped.set(r.weekStart, list);
        }
        return [...grouped.entries()]; // API order = newest week first
    }, [rows]);

    if (spacesLoading) {
        return (
            <div style={{ padding: tokens.spacing[8], textAlign: "center" }}>
                <Skeleton active paragraph={{ rows: 4 }} />
            </div>
        );
    }
    if (!canSee) return <Navigate to="/" replace />;

    return (
        <div
            data-testid="reports-page"
            style={{
                padding: tokens.spacing[6],
                maxWidth: 1000,
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
                        width: 44,
                        height: 44,
                        borderRadius: tokens.radius.lg,
                        background: `${tokens.colors.primary}1A`,
                        color: tokens.colors.primary,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                    }}
                >
                    <BarChart3 size={22} strokeWidth={1.75} />
                </div>
                <div>
                    <h1
                        style={{
                            margin: 0,
                            fontSize: tokens.typography.fontSize["2xl"],
                            fontWeight: 700,
                            letterSpacing: "-0.02em",
                            color: tokens.colors.textPrimary,
                        }}
                    >
                        Department reports
                    </h1>
                    <p
                        style={{
                            margin: 0,
                            marginTop: 2,
                            color: tokens.colors.textSecondary,
                            fontSize: tokens.typography.fontSize.sm,
                        }}
                    >
                        Weekly review summaries
                        {isAdmin
                            ? " across every department."
                            : " for your departments."}
                    </p>
                </div>
            </div>

            {query.isLoading ? (
                <Skeleton active paragraph={{ rows: 6 }} />
            ) : query.isError ? (
                <Alert
                    type="error"
                    showIcon
                    message="Couldn't load the reports"
                    action={
                        <Button size="small" onClick={() => query.refetch()}>
                            Retry
                        </Button>
                    }
                />
            ) : rows.length === 0 ? (
                <Empty description="No weekly reports yet — the first one arrives automatically on Monday morning, covering last week." />
            ) : (
                <>
                    {weeks.map(([weekStart, items]) => (
                        <div key={weekStart}>
                            <h2
                                style={{
                                    fontSize: tokens.typography.fontSize.sm,
                                    fontWeight: 600,
                                    textTransform: "uppercase",
                                    letterSpacing: "0.05em",
                                    color: tokens.colors.textMuted,
                                    margin: 0,
                                    marginBottom: tokens.spacing[3],
                                }}
                            >
                                {fmtWeek(weekStart, items[0].weekEnd)}
                            </h2>
                            <div
                                style={{
                                    display: "grid",
                                    gridTemplateColumns:
                                        "repeat(auto-fill, minmax(300px, 1fr))",
                                    gap: tokens.spacing[3],
                                }}
                            >
                                {items.map((r) => {
                                    const space = spaceMap.get(r.spaceId);
                                    const acked = !!r.acknowledgedAt;
                                    return (
                                        <button
                                            key={r.id}
                                            data-testid="report-card"
                                            onClick={() =>
                                                navigate(`/reports/${r.id}`)
                                            }
                                            style={{
                                                textAlign: "left",
                                                background:
                                                    tokens.colors.bgSurface,
                                                border: `1px solid ${tokens.colors.border}`,
                                                borderRadius:
                                                    tokens.radius.lg,
                                                padding: tokens.spacing[4],
                                                cursor: "pointer",
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
                                                }}
                                            >
                                                <span
                                                    style={{
                                                        fontWeight: 600,
                                                        color: tokens.colors
                                                            .textPrimary,
                                                        flex: 1,
                                                        overflow: "hidden",
                                                        textOverflow:
                                                            "ellipsis",
                                                        whiteSpace: "nowrap",
                                                    }}
                                                >
                                                    {space?.name ??
                                                        "Department"}
                                                </span>
                                                {acked ? (
                                                    <Tag
                                                        color="success"
                                                        icon={
                                                            <Check
                                                                size={11}
                                                                strokeWidth={
                                                                    2.5
                                                                }
                                                                style={{
                                                                    verticalAlign:
                                                                        -1,
                                                                }}
                                                            />
                                                        }
                                                    >
                                                        Seen
                                                    </Tag>
                                                ) : (
                                                    <Tag color="processing">
                                                        New
                                                    </Tag>
                                                )}
                                            </div>
                                            <div
                                                style={{
                                                    display: "flex",
                                                    alignItems: "center",
                                                    gap: tokens.spacing[2],
                                                    fontSize:
                                                        tokens.typography
                                                            .fontSize.sm,
                                                    color: tokens.colors
                                                        .textSecondary,
                                                }}
                                            >
                                                {r.head ? (
                                                    <>
                                                        <Avatar
                                                            size={18}
                                                            src={
                                                                r.head
                                                                    .avatarUrl ??
                                                                undefined
                                                            }
                                                        >
                                                            {(r.head
                                                                .firstName?.[0] ??
                                                                "") +
                                                                (r.head
                                                                    .lastName?.[0] ??
                                                                    "")}
                                                        </Avatar>
                                                        {r.head.firstName}{" "}
                                                        {r.head.lastName}
                                                    </>
                                                ) : (
                                                    <span
                                                        style={{
                                                            color: tokens
                                                                .colors
                                                                .textMuted,
                                                        }}
                                                    >
                                                        No head assigned
                                                    </span>
                                                )}
                                            </div>
                                            {r.totals && (
                                                <div
                                                    style={{
                                                        display: "flex",
                                                        gap: tokens
                                                            .spacing[3],
                                                        fontSize:
                                                            tokens.typography
                                                                .fontSize.sm,
                                                        color: tokens.colors
                                                            .textSecondary,
                                                        flexWrap: "wrap",
                                                    }}
                                                >
                                                    <span>
                                                        ✅{" "}
                                                        {r.totals.completed}{" "}
                                                        done
                                                    </span>
                                                    <span
                                                        style={{
                                                            color:
                                                                r.totals
                                                                    .flagged >
                                                                0
                                                                    ? tokens
                                                                          .colors
                                                                          .danger
                                                                    : undefined,
                                                        }}
                                                    >
                                                        ⚑ {r.totals.flagged}{" "}
                                                        flagged
                                                    </span>
                                                    <span>
                                                        ⏰{" "}
                                                        {
                                                            r.totals
                                                                .overdueNow
                                                        }{" "}
                                                        overdue
                                                    </span>
                                                </div>
                                            )}
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                    ))}
                    {query.hasNextPage && (
                        <Button
                            loading={query.isFetchingNextPage}
                            onClick={() => query.fetchNextPage()}
                        >
                            Load older weeks
                        </Button>
                    )}
                </>
            )}
        </div>
    );
};

export default ReportsListPage;
