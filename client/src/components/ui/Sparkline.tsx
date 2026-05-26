interface SparklineProps {
    data: number[];
    width?: number;
    height?: number;
    color?: string;
    fillColor?: string;
    showArea?: boolean;
    strokeWidth?: number;
}

/**
 * Minimal SVG sparkline. No dependencies.
 */
export const Sparkline = ({
    data,
    width = 120,
    height = 36,
    color = "#4F46E5",
    fillColor,
    showArea = true,
    strokeWidth = 1.75,
}: SparklineProps) => {
    if (data.length === 0) {
        return (
            <svg width={width} height={height}>
                <line
                    x1="0"
                    y1={height / 2}
                    x2={width}
                    y2={height / 2}
                    stroke="#E5E7EB"
                    strokeWidth="1"
                    strokeDasharray="2 2"
                />
            </svg>
        );
    }

    const min = Math.min(...data);
    const max = Math.max(...data);
    const range = Math.max(0.01, max - min);
    const padding = 2;
    const innerH = height - padding * 2;

    const points = data.map((v, i) => {
        const x = (i / Math.max(1, data.length - 1)) * width;
        const y = padding + (1 - (v - min) / range) * innerH;
        return [x, y] as const;
    });

    const pathD = points
        .map(([x, y], i) => (i === 0 ? `M${x},${y}` : `L${x},${y}`))
        .join(" ");

    const areaD = `${pathD} L${width},${height} L0,${height} Z`;

    return (
        <svg
            width={width}
            height={height}
            viewBox={`0 0 ${width} ${height}`}
            aria-hidden
        >
            {showArea && (
                <path
                    d={areaD}
                    fill={fillColor ?? `${color}1A`}
                    stroke="none"
                />
            )}
            <path
                d={pathD}
                fill="none"
                stroke={color}
                strokeWidth={strokeWidth}
                strokeLinecap="round"
                strokeLinejoin="round"
            />
            {/* Last point dot */}
            <circle
                cx={points[points.length - 1][0]}
                cy={points[points.length - 1][1]}
                r={2.5}
                fill={color}
            />
        </svg>
    );
};
