import type { ThemeConfig } from "antd";
import { theme as antdInternalTheme } from "antd";

/**
 * Design system tokens.
 *
 * Phase 12 — dark mode aware:
 * Colors are looked up at access time from the current theme palette, so
 * style-in-JS reads pick up the active theme on each render. Call
 * `setActiveTheme("dark")` and re-render the tree to switch.
 */

type ColorPalette = Record<string, string>;

const lightColors = {
    // Brand
    primary: "#4F46E5",
    primaryHover: "#4338CA",
    primaryActive: "#3730A3",
    primarySubtle: "#EEF2FF",

    // Semantic
    success: "#10B981",
    successSubtle: "#ECFDF5",
    warning: "#F59E0B",
    warningSubtle: "#FFFBEB",
    danger: "#E11D48",
    dangerSubtle: "#FFF1F2",
    info: "#0EA5E9",
    infoSubtle: "#F0F9FF",

    // Neutrals — backgrounds
    bgPage: "#FAFAFB",
    bgSurface: "#FFFFFF",
    bgSidebar: "#F4F4F6",
    bgHeader: "#FFFFFF",
    bgMuted: "#F3F4F6",
    bgHover: "#F9FAFB",

    // Neutrals — text
    textPrimary: "#0F172A",
    textSecondary: "#475569",
    textMuted: "#94A3B8",
    textDisabled: "#CBD5E1",
    textInverse: "#FFFFFF",

    // Borders
    border: "#E5E7EB",
    borderStrong: "#D1D5DB",
    borderSubtle: "#F1F5F9",

    // Status colors (Kanban / tasks)
    statusGray: "#94A3B8",
    statusBlue: "#3B82F6",
    statusViolet: "#8B5CF6",
    statusCyan: "#06B6D4",
    statusAmber: "#F59E0B",
    statusEmerald: "#10B981",
    statusRose: "#E11D48",

    // Priority colors (hardcoded per SRS)
    priorityUrgent: "#E11D48",
    priorityHigh: "#F59E0B",
    priorityNormal: "#3B82F6",
    priorityLow: "#94A3B8",
    priorityNone: "transparent",
} satisfies ColorPalette;

const darkColors = {
    // Brand — lighter indigos for contrast on dark
    primary: "#818CF8",
    primaryHover: "#A5B4FC",
    primaryActive: "#C7D2FE",
    primarySubtle: "#2E2E4F",

    // Semantic
    success: "#34D399",
    successSubtle: "#0F2F25",
    warning: "#FBBF24",
    warningSubtle: "#332416",
    danger: "#F87171",
    dangerSubtle: "#3A1418",
    info: "#38BDF8",
    infoSubtle: "#0E2A3B",

    // Backgrounds — slate-near-black layering
    bgPage: "#0B0C10",
    bgSurface: "#15171C",
    bgSidebar: "#0F1115",
    bgHeader: "#15171C",
    bgMuted: "#1C1F26",
    bgHover: "#1F232B",

    // Text
    textPrimary: "#E2E8F0",
    textSecondary: "#A5B4C3",
    textMuted: "#6B7280",
    textDisabled: "#3F4651",
    textInverse: "#0F172A",

    // Borders
    border: "#252A33",
    borderStrong: "#374151",
    borderSubtle: "#1B1F27",

    // Status colors — slightly desaturated for dark
    statusGray: "#94A3B8",
    statusBlue: "#60A5FA",
    statusViolet: "#A78BFA",
    statusCyan: "#22D3EE",
    statusAmber: "#FBBF24",
    statusEmerald: "#34D399",
    statusRose: "#FB7185",

    // Priority — slightly lighter for dark
    priorityUrgent: "#F87171",
    priorityHigh: "#FBBF24",
    priorityNormal: "#60A5FA",
    priorityLow: "#94A3B8",
    priorityNone: "transparent",
} satisfies ColorPalette;

let activeTheme: "light" | "dark" = "light";

export const getActiveTheme = (): "light" | "dark" => activeTheme;

export const setActiveTheme = (t: "light" | "dark") => {
    activeTheme = t;
    if (typeof document !== "undefined") {
        document.documentElement.setAttribute("data-theme", t);
    }
};

const colorsProxy = new Proxy({} as typeof lightColors, {
    get(_t, prop: string) {
        const palette = activeTheme === "dark" ? darkColors : lightColors;
        return palette[prop as keyof typeof lightColors];
    },
    has(_t, prop: string) {
        return prop in lightColors;
    },
    ownKeys() {
        return Reflect.ownKeys(lightColors);
    },
    getOwnPropertyDescriptor(_t, prop) {
        return Object.getOwnPropertyDescriptor(lightColors, prop);
    },
});

export const tokens = {
    colors: colorsProxy,

    typography: {
        fontFamily:
            'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
        fontFamilyMono:
            '"JetBrains Mono", "Fira Code", Consolas, Monaco, monospace',
        fontSize: {
            xs: 11,
            sm: 12,
            base: 14,
            md: 15,
            lg: 16,
            xl: 18,
            "2xl": 22,
            "3xl": 28,
            "4xl": 36,
        },
        fontWeight: {
            regular: 400,
            medium: 500,
            semibold: 600,
            bold: 700,
        },
        lineHeight: {
            tight: 1.2,
            normal: 1.5,
            relaxed: 1.7,
        },
    },

    spacing: {
        0: 0,
        1: 4,
        2: 8,
        3: 12,
        4: 16,
        5: 20,
        6: 24,
        8: 32,
        10: 40,
        12: 48,
        16: 64,
    },

    radius: {
        sm: 4,
        md: 6,
        lg: 8,
        xl: 10,
        "2xl": 14,
        full: 9999,
    },

    shadows: {
        sm: "0 1px 2px rgba(0,0,0,0.04)",
        md: "0 4px 12px rgba(0,0,0,0.08)",
        lg: "0 8px 24px rgba(0,0,0,0.10)",
        xl: "0 16px 40px rgba(0,0,0,0.16)",
        focus: "0 0 0 3px rgba(79, 70, 229, 0.18)",
    },

    transitions: {
        fast: "100ms cubic-bezier(0.4, 0, 0.2, 1)",
        base: "150ms cubic-bezier(0.4, 0, 0.2, 1)",
        slow: "200ms cubic-bezier(0.4, 0, 0.2, 1)",
    },

    layout: {
        sidebarWidth: 248,
        sidebarCollapsedWidth: 56,
        headerHeight: 48,
        contentMaxWidth: 1440,
    },

    zIndex: {
        dropdown: 1000,
        sticky: 1010,
        fixed: 1020,
        modal: 1040,
        popover: 1050,
        toast: 1060,
        commandPalette: 1080,
    },
} as const;

/**
 * Build the Antd ConfigProvider theme for the given mode.
 */
export const buildAntdTheme = (mode: "light" | "dark"): ThemeConfig => {
    const palette = mode === "dark" ? darkColors : lightColors;
    return {
        cssVar: true,
        hashed: false,
        algorithm:
            mode === "dark"
                ? antdInternalTheme.darkAlgorithm
                : antdInternalTheme.defaultAlgorithm,
        token: {
            colorPrimary: palette.primary,
            colorPrimaryHover: palette.primaryHover,
            colorPrimaryActive: palette.primaryActive,
            colorSuccess: palette.success,
            colorWarning: palette.warning,
            colorError: palette.danger,
            colorInfo: palette.info,
            colorLink: palette.primary,

            colorBgLayout: palette.bgPage,
            colorBgContainer: palette.bgSurface,
            colorBgElevated: palette.bgSurface,

            colorText: palette.textPrimary,
            colorTextSecondary: palette.textSecondary,
            colorTextTertiary: palette.textMuted,
            colorTextQuaternary: palette.textDisabled,

            colorBorder: palette.border,
            colorBorderSecondary: palette.borderSubtle,

            borderRadius: tokens.radius.md,
            borderRadiusLG: tokens.radius.lg,
            borderRadiusSM: tokens.radius.sm,
            borderRadiusXS: 3,

            fontFamily: tokens.typography.fontFamily,
            fontFamilyCode: tokens.typography.fontFamilyMono,
            fontSize: tokens.typography.fontSize.base,
            fontSizeLG: tokens.typography.fontSize.lg,
            fontSizeSM: tokens.typography.fontSize.sm,
            fontSizeXL: tokens.typography.fontSize.xl,

            controlHeight: 36,
            controlHeightSM: 28,
            controlHeightLG: 44,

            boxShadow: tokens.shadows.sm,
            boxShadowSecondary: tokens.shadows.md,
            boxShadowTertiary: tokens.shadows.sm,

            motionDurationFast: "0.1s",
            motionDurationMid: "0.15s",
            motionDurationSlow: "0.2s",

            wireframe: false,
        },
        components: {
            Layout: {
                siderBg: palette.bgSidebar,
                headerBg: palette.bgHeader,
                headerHeight: tokens.layout.headerHeight,
                headerPadding: `0 ${tokens.spacing[4]}px`,
                bodyBg: palette.bgPage,
            },
            Menu: {
                itemHeight: 32,
                itemBorderRadius: tokens.radius.md,
                itemMarginInline: 6,
                itemPaddingInline: 10,
                itemSelectedBg: palette.primarySubtle,
                itemSelectedColor: palette.primary,
                itemHoverBg: palette.bgHover,
                iconSize: 16,
                collapsedIconSize: 18,
            },
            Button: {
                fontWeight: 500,
                primaryShadow: "none",
                defaultShadow: "none",
            },
            Input: {
                paddingBlock: 6,
                paddingInline: 10,
            },
            Table: {
                cellPaddingBlock: 8,
                cellPaddingInline: 12,
                headerBg: palette.bgPage,
                headerSplitColor: "transparent",
                rowHoverBg: palette.bgHover,
            },
            Card: {
                paddingLG: tokens.spacing[5],
                colorBorderSecondary: palette.border,
            },
            Modal: {
                borderRadiusLG: tokens.radius.xl,
                paddingContentHorizontalLG: tokens.spacing[6],
            },
            Tabs: {
                cardPadding: `${tokens.spacing[2]}px ${tokens.spacing[4]}px`,
                horizontalItemPadding: `${tokens.spacing[2]}px ${tokens.spacing[3]}px`,
                horizontalItemGutter: 4,
            },
            Tag: {
                fontSizeSM: 12,
                defaultBg: palette.bgMuted,
                defaultColor: palette.textSecondary,
            },
            Tooltip: {
                colorBgSpotlight: palette.textPrimary,
                borderRadius: tokens.radius.md,
            },
            Form: {
                itemMarginBottom: tokens.spacing[4],
                labelFontSize: tokens.typography.fontSize.sm,
            },
        },
    };
};

/**
 * Light Antd theme — kept as a default export for backward compatibility.
 * Prefer `buildAntdTheme(mode)` when wiring ConfigProvider dynamically.
 */
export const antdTheme = buildAntdTheme("light");

export type AppTokens = typeof tokens;
