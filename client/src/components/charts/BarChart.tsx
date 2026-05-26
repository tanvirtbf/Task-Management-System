import { useState } from "react";
import { tokens } from "../../theme";

export interface BarDatum {
    label: string;
    value: number;
    color?: string;
    /** Optional secondary label (e.g., percentage) */
    sublabel?: string;
}

interface Props {
    data: BarDatum[];
    /** "vertical" = columns, "horizontal" = rows */
    orientation?: "vertical" | "horizontal";
    /** Single bar color (overridden by `data[i].color` if set) */
    color?: string;
    /** Hide axis labels */
    compact?: boolean;
    /** Tooltip formatter */
    formatTooltip?: (d: BarDatum) => string;
}

export const BarChart = ({
    data,
    orientation = "horizontal",
    color = tokens.colors.primary,
    compact = false,
    formatTooltip,
}: Props) => {
    const [hover, setHover] = useState<number | null>(null);
    const max = Math.max(...data.map((d) => d.value), 1);

    if (data.length === 0) {
        return <EmptyState />;
    }

    if (orientation === "horizontal") {
        return (
            <div
                style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 8,
                    width: "100%",
                }}
            >
                {data.map((d, idx) => {
                    const pct = (d.value / max) * 100;
                    const barColor = d.color ?? color;
                    return (
                        <div
                            key={`${d.label}-${idx}`}
                            onMouseEnter={() => setHover(idx)}
                            onMouseLeave={() => setHover(null)}
                            style={{
                                display: "flex",
                                alignItems: "center",
                                gap: 8,
                                fontSize: 12,
                            }}
                        >
                            {!compact && (
                                <span
                                    style={{
                                        flex: "0 0 110px",
                                        color: tokens.colors.textSecondary,
                                        overflow: "hidden",
                                        textOverflow: "ellipsis",
                                        whiteSpace: "nowrap",
                                    }}
                                >
                                    {d.label}
                                </span>
                            )}
                            <div
                                style={{
                                    flex: 1,
                                    height: 18,
                                    background: tokens.colors.bgMuted,
                                    borderRadius: tokens.radius.sm,
                                    overflow: "hidden",
                                    position: "relative",
                                }}
                            >
                                <div
                                    style={{
                                        width: `${pct}%`,
                                        height: "100%",
                                        background: barColor,
                                        opacity: hover === idx ? 1 : 0.85,
                                        transition:
                                            "all var(--transition-fast)",
                                        borderRadius: tokens.radius.sm,
                                    }}
                                    title={
                                        formatTooltip
                                            ? formatTooltip(d)
                                            : `${d.label}: ${d.value}`
                                    }
                                />
                            </div>
                            <span
                                style={{
                                    flex: "0 0 50px",
                                    textAlign: "right",
                                    fontFamily:
                                        tokens.typography.fontFamilyMono,
                                    fontWeight: 600,
                                    color: tokens.colors.textPrimary,
                                }}
                            >
                                {d.value}
                            </span>
                        </div>
                    );
                })}
            </div>
        );
    }

    // Vertical bars
    const width = 100;
    const height = 100;
    const padding = 8;
    const barWidth =
        (width - padding * 2) / data.length - 4;

    return (
        <div style={{ width: "100%", height: "100%", position: "relative" }}>
            <svg
                viewBox={`0 0 ${width} ${height}`}
                preserveAspectRatio="none"
                style={{ width: "100%", height: "100%", display: "block" }}
            >
                {data.map((d, idx) => {
                    const barHeight = (d.value / max) * (height - padding * 2);
                    const x =
                        padding + idx * (barWidth + 4);
                    const y = height - padding - barHeight;
                    return (
                        <rect
                            key={`${d.label}-${idx}`}
                            x={x}
                            y={y}
                            width={barWidth}
                            height={barHeight}
                            fill={d.color ?? color}
                            rx={1}
                            opacity={hover === idx ? 1 : 0.85}
                            onMouseEnter={() => setHover(idx)}
                            onMouseLeave={() => setHover(null)}
                        >
                            <title>
                                {formatTooltip
                                    ? formatTooltip(d)
                                    : `${d.label}: ${d.value}`}
                            </title>
                        </rect>
                    );
                })}
            </svg>
            {!compact && (
                <div
                    style={{
                        display: "flex",
                        justifyContent: "space-between",
                        marginTop: 4,
                        fontSize: 10,
                        color: tokens.colors.textMuted,
                    }}
                >
                    {data.map((d, idx) => (
                        <span
                            key={idx}
                            style={{
                                flex: 1,
                                textAlign: "center",
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                whiteSpace: "nowrap",
                            }}
                        >
                            {d.label}
                        </span>
                    ))}
                </div>
            )}
        </div>
    );
};

const EmptyState = () => (
    <div
        style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            height: 100,
            color: tokens.colors.textMuted,
            fontSize: 12,
            fontStyle: "italic",
        }}
    >
        No data
    </div>
);
