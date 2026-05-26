import { Flag } from "lucide-react";
import { Tooltip } from "antd";
import { tokens } from "../../theme";
import type { Priority } from "../../types";
import { PRIORITY_LABELS } from "../../types";

interface PriorityFlagProps {
    priority: Priority;
    size?: number;
    showLabel?: boolean;
}

const colorMap: Record<Priority, string> = {
    0: tokens.colors.textMuted,
    1: tokens.colors.priorityUrgent,
    2: tokens.colors.priorityHigh,
    3: tokens.colors.priorityNormal,
    4: tokens.colors.priorityLow,
};

export const PriorityFlag = ({
    priority,
    size = 14,
    showLabel = false,
}: PriorityFlagProps) => {
    const color = colorMap[priority];
    const isNone = priority === 0;
    const label = PRIORITY_LABELS[priority];

    const icon = (
        <Flag
            size={size}
            strokeWidth={isNone ? 1.5 : 2}
            fill={isNone ? "transparent" : color}
            color={color}
            style={{ flexShrink: 0 }}
        />
    );

    if (showLabel) {
        return (
            <span
                style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    color: tokens.colors.textPrimary,
                    fontSize: tokens.typography.fontSize.sm,
                }}
            >
                {icon}
                <span>{label}</span>
            </span>
        );
    }

    return <Tooltip title={label}>{icon}</Tooltip>;
};
