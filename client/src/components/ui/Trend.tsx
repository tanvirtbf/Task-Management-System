import { ArrowUpRight, ArrowDownRight, Minus } from "lucide-react";
import { tokens } from "../../theme";

interface TrendProps {
    value: number; // percent change
    direction: "up" | "down" | "flat";
    /** If true, "up" is good. If false, "up" is bad (e.g., complaints). */
    isPositive: boolean;
    size?: "sm" | "md";
}

export const Trend = ({
    value,
    direction,
    isPositive,
    size = "sm",
}: TrendProps) => {
    const isGood =
        direction === "flat"
            ? null
            : direction === "up"
              ? isPositive
              : !isPositive;

    let color = tokens.colors.textMuted;
    if (isGood === true) color = tokens.colors.success;
    if (isGood === false) color = tokens.colors.danger;

    const Icon =
        direction === "up"
            ? ArrowUpRight
            : direction === "down"
              ? ArrowDownRight
              : Minus;

    return (
        <span
            style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 2,
                fontSize: size === "sm" ? 11 : tokens.typography.fontSize.sm,
                fontWeight: 500,
                fontFamily: tokens.typography.fontFamilyMono,
                color,
            }}
        >
            <Icon size={12} strokeWidth={2.5} />
            {Math.abs(value).toFixed(1)}%
        </span>
    );
};
