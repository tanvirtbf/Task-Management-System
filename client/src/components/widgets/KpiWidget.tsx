import { ArrowUpRight, ArrowDownRight, Minus } from "lucide-react";
import { Sparkline } from "../charts/Sparkline";
import { computeMetric, computeTrend } from "./widget-data";
import type { DashboardWidget } from "../../types/dashboard";
import { tokens } from "../../theme";

interface Props {
    widget: DashboardWidget;
}

export const KpiWidget = ({ widget }: Props) => {
    const { value, sparkline } = computeMetric(widget.config);
    const trend = computeTrend(widget.config);

    const trendColor =
        trend.direction === "up"
            ? tokens.colors.success
            : trend.direction === "down"
              ? tokens.colors.danger
              : tokens.colors.textMuted;

    const TrendIcon =
        trend.direction === "up"
            ? ArrowUpRight
            : trend.direction === "down"
              ? ArrowDownRight
              : Minus;

    return (
        <div
            style={{
                display: "flex",
                flexDirection: "column",
                justifyContent: "space-between",
                height: "100%",
            }}
        >
            <div
                style={{
                    fontFamily: tokens.typography.fontFamilyMono,
                    fontSize: 32,
                    fontWeight: 700,
                    color: tokens.colors.textPrimary,
                    lineHeight: 1,
                    letterSpacing: "-0.02em",
                }}
            >
                {widget.config.kpiPrefix ?? ""}
                {value.toLocaleString()}
                {widget.config.kpiSuffix ?? ""}
            </div>

            <div
                style={{
                    display: "flex",
                    alignItems: "flex-end",
                    justifyContent: "space-between",
                    gap: 8,
                    marginTop: 8,
                }}
            >
                {widget.config.kpiCompareTo === "prev_period" && (
                    <div
                        style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 3,
                            background: `${trendColor}1A`,
                            color: trendColor,
                            padding: "2px 7px",
                            borderRadius: tokens.radius.full,
                            fontSize: 11,
                            fontWeight: 600,
                            fontFamily: tokens.typography.fontFamilyMono,
                        }}
                    >
                        <TrendIcon size={11} strokeWidth={2} />
                        {Math.abs(trend.pct).toFixed(0)}%
                    </div>
                )}
                <Sparkline
                    data={sparkline}
                    color={widget.config.chartColor ?? tokens.colors.primary}
                    width={90}
                    height={28}
                />
            </div>
        </div>
    );
};
