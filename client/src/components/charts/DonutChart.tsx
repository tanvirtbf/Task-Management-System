import { useState } from "react";
import { tokens } from "../../theme";

export interface DonutDatum {
    label: string;
    value: number;
    color: string;
}

interface Props {
    data: DonutDatum[];
    showLegend?: boolean;
    /** Center label (typically total) */
    centerLabel?: string;
    centerValue?: string | number;
    /** Donut hole size (0..1) */
    innerRadius?: number;
}

export const DonutChart = ({
    data,
    showLegend = true,
    centerLabel,
    centerValue,
    innerRadius = 0.6,
}: Props) => {
    const [hover, setHover] = useState<number | null>(null);
    const total = data.reduce((s, d) => s + d.value, 0);

    if (data.length === 0 || total === 0) {
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

    const size = 140;
    const cx = size / 2;
    const cy = size / 2;
    const r = size / 2 - 2;
    const ri = r * innerRadius;

    let angleStart = -Math.PI / 2;
    const slices = data.map((d, idx) => {
        const angle = (d.value / total) * Math.PI * 2;
        const angleEnd = angleStart + angle;
        const x1 = cx + r * Math.cos(angleStart);
        const y1 = cy + r * Math.sin(angleStart);
        const x2 = cx + r * Math.cos(angleEnd);
        const y2 = cy + r * Math.sin(angleEnd);
        const xi1 = cx + ri * Math.cos(angleEnd);
        const yi1 = cy + ri * Math.sin(angleEnd);
        const xi2 = cx + ri * Math.cos(angleStart);
        const yi2 = cy + ri * Math.sin(angleStart);
        const largeArc = angle > Math.PI ? 1 : 0;
        const path = [
            `M ${x1} ${y1}`,
            `A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2}`,
            `L ${xi1} ${yi1}`,
            `A ${ri} ${ri} 0 ${largeArc} 0 ${xi2} ${yi2}`,
            "Z",
        ].join(" ");
        const result = { ...d, idx, path, pct: (d.value / total) * 100 };
        angleStart = angleEnd;
        return result;
    });

    return (
        <div
            style={{
                display: "flex",
                alignItems: "center",
                gap: 16,
                width: "100%",
                height: "100%",
                justifyContent: showLegend ? "flex-start" : "center",
            }}
        >
            <div style={{ position: "relative", flexShrink: 0 }}>
                <svg width={size} height={size}>
                    {slices.map((s) => (
                        <path
                            key={s.idx}
                            d={s.path}
                            fill={s.color}
                            opacity={
                                hover === null || hover === s.idx ? 1 : 0.4
                            }
                            stroke="#fff"
                            strokeWidth={1.5}
                            onMouseEnter={() => setHover(s.idx)}
                            onMouseLeave={() => setHover(null)}
                            style={{
                                cursor: "default",
                                transition: "opacity var(--transition-fast)",
                            }}
                        >
                            <title>{`${s.label}: ${s.value} (${s.pct.toFixed(1)}%)`}</title>
                        </path>
                    ))}
                </svg>
                {(centerLabel || centerValue !== undefined) && (
                    <div
                        style={{
                            position: "absolute",
                            inset: 0,
                            display: "flex",
                            flexDirection: "column",
                            alignItems: "center",
                            justifyContent: "center",
                            pointerEvents: "none",
                        }}
                    >
                        {centerValue !== undefined && (
                            <span
                                style={{
                                    fontFamily:
                                        tokens.typography.fontFamilyMono,
                                    fontWeight: 700,
                                    fontSize: 20,
                                    color: tokens.colors.textPrimary,
                                    lineHeight: 1,
                                }}
                            >
                                {centerValue}
                            </span>
                        )}
                        {centerLabel && (
                            <span
                                style={{
                                    fontSize: 10,
                                    color: tokens.colors.textMuted,
                                    marginTop: 2,
                                    textTransform: "uppercase",
                                    letterSpacing: "0.04em",
                                }}
                            >
                                {centerLabel}
                            </span>
                        )}
                    </div>
                )}
            </div>
            {showLegend && (
                <div
                    style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: 4,
                        flex: 1,
                        minWidth: 0,
                        overflow: "hidden",
                    }}
                >
                    {slices.map((s) => (
                        <div
                            key={s.idx}
                            onMouseEnter={() => setHover(s.idx)}
                            onMouseLeave={() => setHover(null)}
                            style={{
                                display: "flex",
                                alignItems: "center",
                                gap: 6,
                                fontSize: 12,
                                opacity:
                                    hover === null || hover === s.idx
                                        ? 1
                                        : 0.5,
                                transition: "opacity var(--transition-fast)",
                            }}
                        >
                            <span
                                style={{
                                    width: 10,
                                    height: 10,
                                    borderRadius: 2,
                                    background: s.color,
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
                                {s.label}
                            </span>
                            <span
                                style={{
                                    fontFamily:
                                        tokens.typography.fontFamilyMono,
                                    fontWeight: 600,
                                    color: tokens.colors.textPrimary,
                                }}
                            >
                                {s.value}
                            </span>
                            <span
                                style={{
                                    fontFamily:
                                        tokens.typography.fontFamilyMono,
                                    color: tokens.colors.textMuted,
                                    fontSize: 10,
                                    minWidth: 36,
                                    textAlign: "right",
                                }}
                            >
                                {s.pct.toFixed(0)}%
                            </span>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};
