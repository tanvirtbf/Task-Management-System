import { useMemo } from "react";
import dayjs from "dayjs";
import { heatmapData } from "./widget-data";
import { tokens } from "../../theme";
import type { DashboardWidget } from "../../types/dashboard";

interface Props {
    widget: DashboardWidget;
}

export const CalendarHeatmapWidget = ({ widget }: Props) => {
    const data = heatmapData(widget.config);
    const max = Math.max(...data.map((d) => d.count), 1);
    const accent = widget.config.chartColor ?? tokens.colors.primary;

    const cells = useMemo(() => {
        // Group into 7-row weeks (Sun-Sat)
        const out: Array<Array<typeof data[number] | null>> = [];
        const first = dayjs(data[0]?.date);
        if (!first.isValid()) return [];
        const leading = first.day(); // 0-6, Sun=0
        let week: Array<typeof data[number] | null> = Array(leading).fill(
            null,
        );
        data.forEach((d) => {
            week.push(d);
            if (week.length === 7) {
                out.push(week);
                week = [];
            }
        });
        if (week.length) {
            while (week.length < 7) week.push(null);
            out.push(week);
        }
        return out;
    }, [data]);

    const intensity = (c: number) =>
        c === 0
            ? tokens.colors.bgMuted
            : `${accent}${Math.min(255, Math.floor((c / max) * 200 + 55))
                  .toString(16)
                  .padStart(2, "0")}`;

    return (
        <div
            style={{
                display: "flex",
                gap: 6,
                alignItems: "center",
                height: "100%",
                overflow: "auto",
            }}
        >
            <div
                style={{
                    display: "grid",
                    gridTemplateRows: "repeat(7, 14px)",
                    gridAutoFlow: "column",
                    gridAutoColumns: "14px",
                    gap: 3,
                }}
            >
                {cells.map((week, wi) =>
                    week.map((d, di) =>
                        d ? (
                            <div
                                key={`${wi}-${di}`}
                                title={`${d.date}: ${d.count}`}
                                style={{
                                    width: 14,
                                    height: 14,
                                    borderRadius: 3,
                                    background: intensity(d.count),
                                    cursor: "default",
                                }}
                            />
                        ) : (
                            <div
                                key={`${wi}-${di}`}
                                style={{ width: 14, height: 14 }}
                            />
                        ),
                    ),
                )}
            </div>

            <div
                style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 4,
                    marginLeft: 12,
                    fontSize: 10,
                    color: tokens.colors.textMuted,
                }}
            >
                <div
                    style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 4,
                    }}
                >
                    <span>Less</span>
                    {[0, 0.25, 0.5, 0.75, 1].map((p) => (
                        <span
                            key={p}
                            style={{
                                width: 10,
                                height: 10,
                                borderRadius: 2,
                                background:
                                    p === 0
                                        ? tokens.colors.bgMuted
                                        : intensity(max * p),
                            }}
                        />
                    ))}
                    <span>More</span>
                </div>
                <span style={{ fontFamily: tokens.typography.fontFamilyMono }}>
                    Total: {data.reduce((s, d) => s + d.count, 0)}
                </span>
            </div>
        </div>
    );
};
