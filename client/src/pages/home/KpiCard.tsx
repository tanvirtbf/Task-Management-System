import { Link } from "react-router-dom";
import type { HomeKpi } from "../../types";
import { CountUp } from "../../components/ui/CountUp";
import { tokens } from "../../theme";

interface KpiCardProps {
    /**
     * KI-23: optional on purpose. `KpiRow` spreads six named fields straight
     * out of the KPI payload, so a server that omits one — an older build, a
     * partial response, a field renamed on the API side — used to reach
     * `kpi.label` with `undefined` and throw during render.
     *
     * That is not a Home-page bug. `main.tsx` wraps the whole `RouterProvider`
     * in the one ErrorBoundary, so the throw replaced the ENTIRE APP with the
     * error screen until the person reloaded. One absent number, every route
     * gone.
     *
     * The mobile `KpiStrip` already guards this way ("a KPI the server did not
     * send should leave a gap, not take the page down") and left a note saying
     * the desktop row had the same exposure. The guard lives HERE rather than
     * at each call site so both callers — and the next one — inherit it.
     */
    kpi?: HomeKpi;
    color?: string;
    /**
     * F28 (ISS-082, D12.4): where this number can be inspected. F24 made these
     * tiles truthful; a truthful number that cannot be opened is still a dead
     * end, so `slaBreaches` now points at `/sla`. Tiles with no queue behind
     * them stay plain `div`s rather than getting an invented destination.
     */
    to?: string;
}

export const KpiCard = ({
    kpi,
    color = tokens.colors.primary,
    to,
}: KpiCardProps) => {
    // Leave a gap, not a white screen. See the note on `kpi` above.
    if (!kpi) return null;

    const card = (
    <div
        style={{
            background: tokens.colors.bgSurface,
            border: `1px solid ${tokens.colors.border}`,
            borderRadius: tokens.radius.lg,
            padding: tokens.spacing[5],
            display: "flex",
            flexDirection: "column",
            gap: tokens.spacing[3],
            transition: "all var(--transition-base)",
            cursor: to ? "pointer" : undefined,
            height: "100%",
        }}
    >
        {/* F24 (ISS-057): no Trend badge. It rendered "— 0.0%" on every card
            from server values hardcoded to 0/flat/false, which reads as a
            measured "no change" rather than "not computed". */}
        <span
            style={{
                fontSize: tokens.typography.fontSize.sm,
                color: tokens.colors.textSecondary,
                fontWeight: 500,
            }}
        >
            {kpi.label}
        </span>

        <div
            style={{
                fontFamily: tokens.typography.fontFamilyMono,
                fontSize: tokens.typography.fontSize["3xl"],
                fontWeight: 700,
                // The per-tile accent used to colour the sparkline (removed in
                // F24). Kept on the number, so each caller's intent — danger
                // for Overdue and SLA, success for the team total — survives
                // without carrying any invented data.
                color,
                lineHeight: 1,
                letterSpacing: "-0.03em",
            }}
        >
            {kpi.valueDisplay.startsWith("৳") ? (
                <>
                    <span style={{ color: tokens.colors.textSecondary, fontSize: "0.75em" }}>
                        ৳
                    </span>
                    <CountUp
                        value={kpi.value}
                        format={(n) =>
                            n >= 100000
                                ? `${Math.round(n / 1000)}k`
                                : n >= 1000
                                  ? `${(n / 1000).toFixed(1)}k`
                                  : Math.round(n).toLocaleString()
                        }
                    />
                </>
            ) : (
                <CountUp value={kpi.value} />
            )}
        </div>

    </div>
    );

    return to ? (
        <Link to={to} style={{ textDecoration: "none", display: "block" }}>
            {card}
        </Link>
    ) : (
        card
    );
};
