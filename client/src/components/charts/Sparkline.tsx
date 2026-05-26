import { tokens } from "../../theme";

interface Props {
    data: number[];
    color?: string;
    width?: number;
    height?: number;
    /** Fill area under line */
    area?: boolean;
}

export const Sparkline = ({
    data,
    color = tokens.colors.primary,
    width = 90,
    height = 28,
    area = true,
}: Props) => {
    if (data.length < 2) {
        return (
            <div style={{ width, height }}>
                <svg width={width} height={height} />
            </div>
        );
    }
    const max = Math.max(...data, 1);
    const min = Math.min(...data, 0);
    const span = max - min || 1;
    const stepX = width / (data.length - 1);
    const padY = 2;
    const innerH = height - padY * 2;

    const points = data.map((v, i) => ({
        x: i * stepX,
        y: padY + innerH - ((v - min) / span) * innerH,
    }));

    const pathD = points
        .map((p, i) => (i === 0 ? `M ${p.x} ${p.y}` : `L ${p.x} ${p.y}`))
        .join(" ");
    const areaD = `${pathD} L ${width} ${height} L 0 ${height} Z`;

    return (
        <svg width={width} height={height} style={{ display: "block" }}>
            {area && <path d={areaD} fill={color} opacity={0.12} />}
            <path
                d={pathD}
                fill="none"
                stroke={color}
                strokeWidth={1.5}
                strokeLinecap="round"
                strokeLinejoin="round"
            />
        </svg>
    );
};
