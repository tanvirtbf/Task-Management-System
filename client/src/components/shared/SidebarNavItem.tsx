import { NavLink } from "react-router-dom";
import type { ReactNode } from "react";
import { tokens } from "../../theme";

interface SidebarNavItemProps {
    to?: string;
    icon: ReactNode;
    label: string;
    /** Right-aligned badge content (count, kbd hint, etc.) */
    rightSlot?: ReactNode;
    /** Indent for nested levels (folders/lists). */
    depth?: number;
    /** Render as button instead of link (for collapsible spaces/folders). */
    onClick?: () => void;
    /** Pre-computed active state for non-link mode. */
    isActive?: boolean;
    /** Collapsed mode — icon only. */
    collapsed?: boolean;
}

const baseStyle = (active: boolean, depth: number): React.CSSProperties => ({
    display: "flex",
    alignItems: "center",
    gap: 8,
    height: 30,
    paddingLeft: 10 + depth * 14,
    paddingRight: 10,
    borderRadius: tokens.radius.md,
    background: active ? tokens.colors.primarySubtle : "transparent",
    color: active ? tokens.colors.primary : tokens.colors.textSecondary,
    fontSize: tokens.typography.fontSize.sm,
    fontWeight: active ? 600 : 500,
    cursor: "pointer",
    border: "none",
    width: "100%",
    textAlign: "left" as const,
    textDecoration: "none",
    transition: "all var(--transition-base)",
    whiteSpace: "nowrap" as const,
    overflow: "hidden",
});

export const SidebarNavItem = ({
    to,
    icon,
    label,
    rightSlot,
    depth = 0,
    onClick,
    isActive,
    collapsed = false,
}: SidebarNavItemProps) => {
    if (collapsed) {
        const content = (
            <div
                style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    width: 40,
                    height: 32,
                    borderRadius: tokens.radius.md,
                    color: tokens.colors.textSecondary,
                    cursor: "pointer",
                    transition: "all var(--transition-base)",
                }}
                title={label}
            >
                {icon}
            </div>
        );
        if (to) {
            return (
                <NavLink to={to} style={{ textDecoration: "none" }}>
                    {content}
                </NavLink>
            );
        }
        return (
            <button onClick={onClick} style={{ background: "none", border: 0, padding: 0 }}>
                {content}
            </button>
        );
    }

    const inner = (active: boolean) => (
        <>
            <span style={{ display: "flex", flexShrink: 0, width: 16, height: 16, alignItems: "center", justifyContent: "center" }}>
                {icon}
            </span>
            <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis" }}>
                {label}
            </span>
            {rightSlot && (
                <span
                    style={{
                        flexShrink: 0,
                        fontSize: 11,
                        color: active
                            ? tokens.colors.primary
                            : tokens.colors.textMuted,
                    }}
                >
                    {rightSlot}
                </span>
            )}
        </>
    );

    if (to) {
        return (
            <NavLink
                to={to}
                end={to === "/"}
                style={({ isActive: a }) => baseStyle(a, depth)}
                onMouseEnter={(e) => {
                    if (!e.currentTarget.classList.contains("active")) {
                        e.currentTarget.style.background = tokens.colors.bgHover;
                    }
                }}
                onMouseLeave={(e) => {
                    if (!e.currentTarget.classList.contains("active")) {
                        e.currentTarget.style.background = "transparent";
                    }
                }}
            >
                {({ isActive: a }) => inner(a)}
            </NavLink>
        );
    }

    return (
        <button
            onClick={onClick}
            style={baseStyle(isActive ?? false, depth)}
            onMouseEnter={(e) => {
                if (!isActive)
                    e.currentTarget.style.background = tokens.colors.bgHover;
            }}
            onMouseLeave={(e) => {
                if (!isActive) e.currentTarget.style.background = "transparent";
            }}
        >
            {inner(isActive ?? false)}
        </button>
    );
};
