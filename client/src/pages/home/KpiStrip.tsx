import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Skeleton } from "antd";
import { homeApi } from "../../http/api";
import { tokens } from "../../theme";
import type { HomeKpi } from "../../types";

/**
 * P5 of MOBILE_REBUILD_PLAN.md — the six KPIs, as a phone should show them.
 *
 * The desktop `KpiRow` is a `repeat(auto-fit, minmax(200px, 1fr))` grid, which
 * on a phone resolves to one 230px-tall card per row. The scan measured the
 * result: Home was **2,512px of tower and the first screenful was two numbers**
 * — you scrolled past three cards to reach any actual work.
 *
 * Six numbers do not need six screens. They need one glanceable line, which is
 * what this is: a horizontally scrollable strip of chips, ~72px tall, in the
 * same order and with the same meanings. The SLA chip keeps its link, because
 * it is still the only tile with a real queue behind it (F28/ISS-082).
 */

const Chip = ({ kpi, color, to }: { kpi?: HomeKpi; color: string; to?: string }) => {
    // A KPI the server did not send should leave a gap, not take the page down.
    // (The desktop KpiRow has the same exposure — worth the same guard when
    // someone next touches it.)
    if (!kpi) return null;
    const body = (
        <div
            style={{
                minWidth: 108,
                flexShrink: 0,
                background: tokens.colors.bgSurface,
                border: `1px solid ${tokens.colors.border}`,
                borderRadius: tokens.radius.lg,
                padding: `${tokens.spacing[2]}px ${tokens.spacing[3]}px`,
                display: "flex",
                flexDirection: "column",
                gap: 2,
                height: 68,
                justifyContent: "center",
            }}
        >
            <span
                style={{
                    fontSize: 22,
                    fontWeight: 700,
                    lineHeight: 1,
                    color,
                    fontVariantNumeric: "tabular-nums",
                }}
            >
                {kpi.valueDisplay}
            </span>
            <span
                style={{
                    fontSize: 11,
                    lineHeight: "13px",
                    color: tokens.colors.textMuted,
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                }}
            >
                {kpi.label}
            </span>
        </div>
    );
    return to ? (
        <Link to={to} style={{ textDecoration: "none", flexShrink: 0 }}>
            {body}
        </Link>
    ) : (
        body
    );
};

export const KpiStrip = () => {
    const { data, isLoading } = useQuery({
        queryKey: ["home", "kpis"],
        queryFn: () => homeApi.kpis(),
    });

    if (isLoading || !data) {
        return (
            <div style={{ height: 68 }}>
                <Skeleton.Input active block style={{ height: 68 }} />
            </div>
        );
    }

    return (
        <div
            style={{
                display: "flex",
                gap: tokens.spacing[2],
                overflowX: "auto",
                overflowY: "hidden",
                // Bleed to the screen edges so the strip reads as scrollable
                // rather than as a row that happens to be cut off.
                margin: `0 -${tokens.spacing[4]}px`,
                padding: `0 ${tokens.spacing[4]}px`,
                scrollSnapType: "x proximity",
            }}
        >
            <Chip kpi={data.myTasks} color={tokens.colors.primary} />
            <Chip kpi={data.dueToday} color={tokens.colors.warning} />
            <Chip kpi={data.overdue} color={tokens.colors.danger} />
            <Chip kpi={data.awaitingReview} color={tokens.colors.primary} />
            <Chip kpi={data.openTeamTasks} color={tokens.colors.success} />
            <Chip kpi={data.slaBreaches} color={tokens.colors.danger} to="/sla" />
        </div>
    );
};
