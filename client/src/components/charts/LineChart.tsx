import { useState } from "react";
import { tokens } from "../../theme";

export interface LinePoint {
    label: string;
    value: number;
}

interface Props {
    data: LinePoint[];
    color?: string;
    /** Fill area under line */
    area?: boolean;
    /** Show x-axis labels (every nth label only, to avoid clutter) */
    showXLabels?: boolean;
    /** Show value at hovered point */
    interactive?: boolean;
}

export const LineChart = ({
    data,
    color = tokens.colors.primary,
    area = true,
    showXLabels = true,
    interactive = true,
}: Props) => {
    const [hover, setHover] = useState<number | null>(null);

    if (data.length === 0) {
        return (
            <div
                style={{
                    height: 120,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: tokens.colors.textMuted,
                    fontSize: 12,
                    fontStyle: "italic",
                }}
            >
                No data
            </div>
        );
    }

    const W = 600;
    const H = 200;
    const paddingX = 8;
    const paddingTop = 12;
    const paddingBottom = 24;
    const max = Math.max(...data.map((d) => d.value), 1);
    const min = Math.min(...data.map((d) => d.value), 0);
    const span = max - min || 1;
    const innerH = H - paddingTop - paddingBottom;
    const stepX = (W - paddingX * 2) / Math.max(data.length - 1, 1);

    const points = data.map((d, i) => ({
        x: paddingX + i * stepX,
        y: paddingTop + innerH - ((d.value - min) / span) * innerH,
        value: d.value,
        label: d.label,
    }));

    const pathD = points
        .map((p, i) => (i === 0 ? `M ${p.x} ${p.y}` : `L ${p.x} ${p.y}`))
        .join(" ");

    const areaD = `${pathD} L ${points[points.length - 1].x} ${
        paddingTop + innerH
    } L ${points[0].x} ${paddingTop + innerH} Z`;

    const labelStep = Math.max(1, Math.floor(data.length / 8));

    return (
        <div
            style={{
                width: "100%",
                height: "100%",
                position: "relative",
                userSelect: "none",
            }}
        >
            <svg
                viewBox={`0 0 ${W} ${H}`}
                preserveAspectRatio="none"
                style={{
                    width: "100%",
                    height: "100%",
                    display: "block",
                }}
                onMouseLeave={() => setHover(null)}
                onMouseMove={(e) => {
                    if (!interactive) return;
                    const rect = e.currentTarget.getBoundingClientRect();
                    const xPct = (e.clientX - rect.left) / rect.width;
                    const xSvg = xPct * W;
                    const idx = Math.round(
                        (xSvg - paddingX) / stepX,
                    );
                    if (idx >= 0 && idx < data.length) setHover(idx);
                }}
            >
                {/* Grid lines */}
                {[0.25, 0.5, 0.75].map((pct) => (
                    <line
                        key={pct}
                        x1={paddingX}
                        x2={W - paddingX}
                        y1={paddingTop + innerH * (1 - pct)}
                        y2={paddingTop + innerH * (1 - pct)}
                        stroke={tokens.colors.borderSubtle}
                        strokeDasharray="2 3"
                        strokeWidth={1}
                    />
                ))}

                {area && (
                    <path d={areaD} fill={color} opacity={0.12} />
                )}
                <path
                    d={pathD}
                    fill="none"
                    stroke={color}
                    strokeWidth={2}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                />

                {/* Dots — only for small datasets, or hover */}
                {points.map((p, i) => {
                    const showDot = data.length <= 12 || hover === i;
                    if (!showDot) return null;
                    return (
                        <circle
                            key={i}
                            cx={p.x}
                            cy={p.y}
                            r={hover === i ? 4 : 2.5}
                            fill={color}
                            stroke="#fff"
                            strokeWidth={1.5}
                        />
                    );
                })}

                {/* Hover vertical line */}
                {hover !== null && (
                    <line
                        x1={points[hover].x}
                        x2={points[hover].x}
                        y1={paddingTop}
                        y2={paddingTop + innerH}
                        stroke={color}
                        strokeWidth={1}
                        opacity={0.4}
                        strokeDasharray="2 2"
                    />
                )}

                {/* X labels */}
                {showXLabels &&
                    points.map((p, i) =>
                        i % labelStep === 0 ? (
                            <text
                                key={i}
                                x={p.x}
                                y={H - 6}
                                fontSize={9}
                                textAnchor="middle"
                                fill={tokens.colors.textMuted}
                            >
                                {p.label}
                            </text>
                        ) : null,
                    )}
            </svg>

            {/* Tooltip */}
            {hover !== null && interactive && (
                <div
                    style={{
                        position: "absolute",
                        left: `${(points[hover].x / W) * 100}%`,
                        top: `${(points[hover].y / H) * 100}%`,
                        transform: "translate(-50%, -130%)",
                        background: tokens.colors.textPrimary,
                        color: "#fff",
                        padding: "4px 8px",
                        borderRadius: tokens.radius.sm,
                        fontSize: 11,
                        fontFamily: tokens.typography.fontFamilyMono,
                        fontWeight: 600,
                        pointerEvents: "none",
                        whiteSpace: "nowrap",
                        boxShadow: tokens.shadows.md,
                    }}
                >
                    {points[hover].label}: {points[hover].value}
                </div>
            )}
        </div>
    );
};
