import { Spin } from "antd";
import { tokens } from "../../theme";

interface Props {
    /** Defaults to "Loading..." */
    label?: string;
    /** "block" = full-area centered (default), "inline" = small spinner row */
    variant?: "block" | "inline";
    /** Min height for "block" variant */
    minHeight?: number | string;
}

/**
 * Standard loading state — replaces raw "Loading..." text across the app.
 * Theme-aware via Antd Spin, vertically centered.
 */
export const LoadingState = ({
    label = "Loading…",
    variant = "block",
    minHeight = 200,
}: Props) => {
    if (variant === "inline") {
        return (
            <span
                style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    color: tokens.colors.textMuted,
                    fontSize: tokens.typography.fontSize.sm,
                }}
            >
                <Spin size="small" />
                {label}
            </span>
        );
    }
    return (
        <div
            style={{
                minHeight,
                width: "100%",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: 10,
                color: tokens.colors.textMuted,
                fontSize: tokens.typography.fontSize.sm,
            }}
        >
            <Spin size="large" />
            <span>{label}</span>
        </div>
    );
};
