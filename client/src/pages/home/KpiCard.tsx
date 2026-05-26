import type { HomeKpi } from "../../types";
import { CountUp } from "../../components/ui/CountUp";
import { Sparkline } from "../../components/ui/Sparkline";
import { Trend } from "../../components/ui/Trend";
import { tokens } from "../../theme";

interface KpiCardProps {
    kpi: HomeKpi;
    color?: string;
}

export const KpiCard = ({ kpi, color = tokens.colors.primary }: KpiCardProps) => (
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
        }}
    >
        <div
            style={{
                display: "flex",
                alignItems: "flex-start",
                justifyContent: "space-between",
            }}
        >
            <span
                style={{
                    fontSize: tokens.typography.fontSize.sm,
                    color: tokens.colors.textSecondary,
                    fontWeight: 500,
                }}
            >
                {kpi.label}
            </span>
            <Trend
                value={kpi.trend}
                direction={kpi.trendDirection}
                isPositive={kpi.isPositive}
            />
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

        <div style={{ marginTop: "auto" }}>
            <Sparkline data={kpi.sparkline} width={220} height={36} color={color} />
        </div>
    </div>
);
