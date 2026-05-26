import { Spin } from "antd";
import { tokens } from "../../theme";

/**
 * Suspense fallback for lazy-loaded routes. Subtle, full-area, theme-aware.
 */
export const RouteFallback = () => (
    <div
        style={{
            minHeight: "60vh",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: tokens.colors.textMuted,
            gap: 12,
            flexDirection: "column",
        }}
    >
        <Spin size="large" />
        <span style={{ fontSize: tokens.typography.fontSize.sm }}>
            Loading...
        </span>
    </div>
);
