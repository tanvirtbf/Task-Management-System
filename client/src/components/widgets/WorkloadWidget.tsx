import { computeWorkload } from "./widget-data";
import { tokens } from "../../theme";
import type { DashboardWidget } from "../../types/dashboard";

interface Props {
    widget: DashboardWidget;
}

export const WorkloadWidget = ({ widget }: Props) => {
    const data = computeWorkload(widget.config);
    const max = Math.max(...data.map((d) => d.total), 1);

    if (data.length === 0) {
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
                No assigned tasks
            </div>
        );
    }

    return (
        <div
            style={{
                display: "flex",
                flexDirection: "column",
                gap: 8,
                overflow: "auto",
            }}
        >
            {data.map((d) => {
                const inProgressPct = (d.inProgress / max) * 100;
                const overduePct = (d.overdue / max) * 100;
                const remainingPct =
                    ((d.total - d.inProgress - d.overdue) / max) * 100;
                return (
                    <div
                        key={d.userId}
                        style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 8,
                            fontSize: 12,
                        }}
                    >
                        <span
                            style={{
                                width: 24,
                                height: 24,
                                borderRadius: "50%",
                                background: tokens.colors.primarySubtle,
                                color: tokens.colors.primary,
                                display: "inline-flex",
                                alignItems: "center",
                                justifyContent: "center",
                                fontSize: 10,
                                fontWeight: 700,
                                flexShrink: 0,
                            }}
                        >
                            {d.name
                                .split(" ")
                                .map((n) => n.charAt(0))
                                .join("")
                                .slice(0, 2)
                                .toUpperCase()}
                        </span>
                        <span
                            style={{
                                flex: "0 0 110px",
                                color: tokens.colors.textSecondary,
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                whiteSpace: "nowrap",
                            }}
                        >
                            {d.name}
                        </span>
                        <div
                            style={{
                                flex: 1,
                                display: "flex",
                                height: 14,
                                background: tokens.colors.bgMuted,
                                borderRadius: tokens.radius.sm,
                                overflow: "hidden",
                            }}
                        >
                            {d.overdue > 0 && (
                                <div
                                    style={{
                                        width: `${overduePct}%`,
                                        background: tokens.colors.danger,
                                    }}
                                    title={`${d.overdue} overdue`}
                                />
                            )}
                            {d.inProgress > 0 && (
                                <div
                                    style={{
                                        width: `${inProgressPct}%`,
                                        background: tokens.colors.primary,
                                    }}
                                    title={`${d.inProgress} in progress`}
                                />
                            )}
                            {remainingPct > 0 && (
                                <div
                                    style={{
                                        width: `${remainingPct}%`,
                                        background:
                                            tokens.colors.borderSubtle,
                                    }}
                                    title={`${d.total - d.inProgress - d.overdue} other`}
                                />
                            )}
                        </div>
                        <span
                            style={{
                                flex: "0 0 40px",
                                textAlign: "right",
                                fontFamily:
                                    tokens.typography.fontFamilyMono,
                                fontWeight: 600,
                                color: tokens.colors.textPrimary,
                            }}
                        >
                            {d.total}
                        </span>
                    </div>
                );
            })}
        </div>
    );
};
