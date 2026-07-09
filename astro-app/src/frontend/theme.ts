import type { ThemeConfig } from "antd";

/**
 * Design system tokens — single light theme.
 *
 * Use these via:
 *   - Antd ConfigProvider for component theming (themeConfig below)
 *   - CSS variables in :root for use in custom CSS (see index.css)
 *   - Direct import in TS for runtime values (tokens.colors.primary etc.)
 */

export const tokens = {
    colors: {
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
    },

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
    },
} as const;

export const antdTheme: ThemeConfig = {
    cssVar: {},
    hashed: false,
    token: {
        colorPrimary: tokens.colors.primary,
        colorPrimaryHover: tokens.colors.primaryHover,
        colorPrimaryActive: tokens.colors.primaryActive,
        colorSuccess: tokens.colors.success,
        colorWarning: tokens.colors.warning,
        colorError: tokens.colors.danger,
        colorInfo: tokens.colors.info,
        colorLink: tokens.colors.primary,

        colorBgLayout: tokens.colors.bgPage,
        colorBgContainer: tokens.colors.bgSurface,
        colorBgElevated: tokens.colors.bgSurface,

        colorText: tokens.colors.textPrimary,
        colorTextSecondary: tokens.colors.textSecondary,
        colorTextTertiary: tokens.colors.textMuted,
        colorTextQuaternary: tokens.colors.textDisabled,

        colorBorder: tokens.colors.border,
        colorBorderSecondary: tokens.colors.borderSubtle,

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
            siderBg: tokens.colors.bgSidebar,
            headerBg: tokens.colors.bgHeader,
            headerHeight: tokens.layout.headerHeight,
            headerPadding: `0 ${tokens.spacing[4]}px`,
            bodyBg: tokens.colors.bgPage,
        },
        Menu: {
            itemHeight: 32,
            itemBorderRadius: tokens.radius.md,
            itemMarginInline: 6,
            itemPaddingInline: 10,
            itemSelectedBg: tokens.colors.primarySubtle,
            itemSelectedColor: tokens.colors.primary,
            itemHoverBg: tokens.colors.bgHover,
            iconSize: 16,
            collapsedIconSize: 18,
        },
        Button: {
            fontWeight: 500,
            primaryShadow: "none",
            defaultShadow: "none",
        },
        Input: { paddingBlock: 6, paddingInline: 10 },
        Table: {
            cellPaddingBlock: 8,
            cellPaddingInline: 12,
            headerBg: tokens.colors.bgPage,
            headerSplitColor: "transparent",
            rowHoverBg: tokens.colors.bgHover,
        },
        Card: {
            paddingLG: tokens.spacing[5],
            colorBorderSecondary: tokens.colors.border,
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
            defaultBg: tokens.colors.bgMuted,
            defaultColor: tokens.colors.textSecondary,
        },
        Tooltip: {
            colorBgSpotlight: tokens.colors.textPrimary,
            borderRadius: tokens.radius.md,
        },
        Form: {
            itemMarginBottom: tokens.spacing[4],
            labelFontSize: tokens.typography.fontSize.sm,
        },
    },
};

export type AppTokens = typeof tokens;
