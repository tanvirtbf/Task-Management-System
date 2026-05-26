import { tokens } from "../../theme";
import type { Status } from "../../types";

interface StatusPillProps {
    status: Pick<Status, "name" | "color">;
    /** Filled pill (with bg) or just dot + name */
    variant?: "filled" | "subtle" | "dot";
    size?: "sm" | "md";
}

export const StatusPill = ({
    status,
    variant = "subtle",
    size = "md",
}: StatusPillProps) => {
    const isFilled = variant === "filled";
    const isDot = variant === "dot";

    const styleBase: React.CSSProperties = {
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        fontSize: size === "sm" ? 11 : tokens.typography.fontSize.sm,
        fontWeight: 500,
        lineHeight: 1,
        padding: isDot ? 0 : size === "sm" ? "3px 8px" : "4px 10px",
        borderRadius: tokens.radius.full,
        background: isFilled
            ? status.color
            : isDot
              ? "transparent"
              : `${status.color}1A`,
        color: isFilled
            ? "#FFFFFF"
            : isDot
              ? tokens.colors.textPrimary
              : status.color,
        whiteSpace: "nowrap",
    };

    return (
        <span style={styleBase}>
            {!isFilled && (
                <span
                    style={{
                        width: 6,
                        height: 6,
                        borderRadius: "50%",
                        background: status.color,
                        flexShrink: 0,
                    }}
                />
            )}
            {status.name}
        </span>
    );
};
