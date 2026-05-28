import { Tag, Tooltip } from "antd";
import type { BugSeverity } from "../../types/sprint";
import { SEVERITY_META } from "../../types/sprint";

interface Props {
    severity: BugSeverity | null | undefined;
    compact?: boolean;
}

export const BugSeverityBadge = ({ severity, compact }: Props) => {
    if (!severity) return null;
    const meta = SEVERITY_META[severity];
    return (
        <Tooltip title={meta.description}>
            <Tag
                color={meta.color}
                style={{
                    margin: 0,
                    fontWeight: 700,
                    fontSize: 10,
                    lineHeight: "16px",
                    padding: compact ? "0 5px" : "1px 7px",
                    border: 0,
                }}
            >
                {compact ? severity : meta.label}
            </Tag>
        </Tooltip>
    );
};

/**
 * Thin coloured rail to drop on a board card's left edge. Renders nothing
 * if no severity set (operational tasks never get a rail).
 */
export const BugSeverityRail = ({ severity }: { severity: BugSeverity | null | undefined }) => {
    if (!severity) return null;
    return (
        <div
            style={{
                position: "absolute",
                top: 0,
                bottom: 0,
                left: 0,
                width: 3,
                background: SEVERITY_META[severity].color,
                borderTopLeftRadius: 6,
                borderBottomLeftRadius: 6,
            }}
        />
    );
};
