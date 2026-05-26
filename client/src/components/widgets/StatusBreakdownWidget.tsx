import { statusBreakdown } from "./widget-data";
import { tokens } from "../../theme";
import type { DashboardWidget } from "../../types/dashboard";

interface Props {
    widget: DashboardWidget;
}

export const StatusBreakdownWidget = ({ widget }: Props) => {
    const data = statusBreakdown(widget.config);
    const total = data[0]?.total ?? 0;
    if (total === 0) {
        return (
            <div
                style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    height: "100%",
                    color: tokens.colors.textMuted,
                    fontStyle: "italic",
                    fontSize: 12,
                }}
            >
                No tasks in scope
            </div>
        );
    }
    return (
        <div
            style={{
                display: "flex",
                flexDirection: "column",
                gap: 12,
                width: "100%",
            }}
        >
            {/* Stacked horizontal bar */}
            <div
                style={{
                    display: "flex",
                    height: 18,
                    borderRadius: tokens.radius.sm,
                    overflow: "hidden",
                    background: tokens.colors.bgMuted,
                }}
            >
                {data.map((d) => {
                    const pct = (d.value / total) * 100;
                    if (pct === 0) return null;
                    return (
                        <div
                            key={d.group}
                            style={{
                                width: `${pct}%`,
                                background: d.color,
                            }}
                            title={`${d.label}: ${d.value}`}
                        />
                    );
                })}
            </div>

            <div
                style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr",
                    gap: 8,
                }}
            >
                {data.map((d) => {
                    const pct = total > 0 ? (d.value / total) * 100 : 0;
                    return (
                        <div
                            key={d.group}
                            style={{
                                display: "flex",
                                alignItems: "center",
                                gap: 6,
                                fontSize: 12,
                            }}
                        >
                            <span
                                style={{
                                    width: 8,
                                    height: 8,
                                    borderRadius: 2,
                                    background: d.color,
                                    flexShrink: 0,
                                }}
                            />
                            <span
                                style={{
                                    flex: 1,
                                    color: tokens.colors.textSecondary,
                                    overflow: "hidden",
                                    textOverflow: "ellipsis",
                                    whiteSpace: "nowrap",
                                }}
                            >
                                {d.label}
                            </span>
                            <span
                                style={{
                                    fontFamily:
                                        tokens.typography.fontFamilyMono,
                                    fontWeight: 600,
                                    color: tokens.colors.textPrimary,
                                }}
                            >
                                {d.value}
                            </span>
                            <span
                                style={{
                                    fontFamily:
                                        tokens.typography.fontFamilyMono,
                                    fontSize: 10,
                                    color: tokens.colors.textMuted,
                                    minWidth: 36,
                                    textAlign: "right",
                                }}
                            >
                                {pct.toFixed(0)}%
                            </span>
                        </div>
                    );
                })}
            </div>
        </div>
    );
};
