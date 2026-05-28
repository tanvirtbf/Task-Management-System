import { Tooltip } from "antd";
import { AlertTriangle, Clock } from "lucide-react";
import { tokens } from "../../theme";

interface Props {
    slaDueAt: string;
    completedAt?: string | null;
    size?: "sm" | "md";
}

const formatRelative = (target: Date, now: Date): { text: string; breached: boolean } => {
    const diffMs = target.getTime() - now.getTime();
    const breached = diffMs < 0;
    const abs = Math.abs(diffMs);
    const h = Math.floor(abs / 3600000);
    const m = Math.floor((abs % 3600000) / 60000);
    const d = Math.floor(h / 24);

    let text: string;
    if (d > 0) text = `${d}d ${h % 24}h`;
    else if (h > 0) text = `${h}h ${m}m`;
    else text = `${m}m`;

    return {
        text: breached ? `SLA breached ${text} ago` : `SLA in ${text}`,
        breached,
    };
};

export const SLABadge = ({ slaDueAt, completedAt, size = "md" }: Props) => {
    const now = new Date();
    const target = new Date(slaDueAt);
    const { text, breached } = formatRelative(target, now);

    // If completed before SLA, show a met indicator
    if (completedAt && new Date(completedAt) <= target) {
        return (
            <Tooltip title={`SLA met (target was ${target.toLocaleString()})`}>
                <span
                    style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 4,
                        padding: size === "sm" ? "1px 6px" : "2px 8px",
                        borderRadius: tokens.radius.md,
                        background: `${tokens.colors.success}1A`,
                        color: tokens.colors.success,
                        fontSize: size === "sm" ? 10 : 11,
                        fontWeight: 600,
                    }}
                >
                    <Clock size={size === "sm" ? 10 : 12} strokeWidth={2} />
                    SLA met
                </span>
            </Tooltip>
        );
    }

    const color = breached ? tokens.colors.danger : tokens.colors.warning;
    return (
        <Tooltip title={`SLA target: ${target.toLocaleString()}`}>
            <span
                style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 4,
                    padding: size === "sm" ? "1px 6px" : "2px 8px",
                    borderRadius: tokens.radius.md,
                    background: `${color}1A`,
                    color,
                    fontSize: size === "sm" ? 10 : 11,
                    fontWeight: 600,
                }}
            >
                {breached ? (
                    <AlertTriangle
                        size={size === "sm" ? 10 : 12}
                        strokeWidth={2}
                    />
                ) : (
                    <Clock size={size === "sm" ? 10 : 12} strokeWidth={2} />
                )}
                {text}
            </span>
        </Tooltip>
    );
};
