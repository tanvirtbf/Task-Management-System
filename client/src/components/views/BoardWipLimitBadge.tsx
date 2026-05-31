import { tokens } from "../../theme";

interface BoardWipLimitBadgeProps {
    current: number;
    limit: number | null;
}

/**
 * Shows `N` if no limit, `N/M` with color-coded background if limit set.
 * Red when over, amber when at limit, green when under.
 */
export const BoardWipLimitBadge = ({
    current,
    limit,
}: BoardWipLimitBadgeProps) => {
    if (limit === null || limit === undefined) {
        return (
            <span
                style={{
                    fontSize: 11,
                    fontWeight: 600,
                    fontFamily: tokens.typography.fontFamilyMono,
                    color: tokens.colors.textMuted,
                    background: tokens.colors.bgMuted,
                    padding: "1px 6px",
                    borderRadius: 9,
                }}
            >
                {current}
            </span>
        );
    }

    let color: string = tokens.colors.success;
    let bg: string = tokens.colors.successSubtle;
    if (current > limit) {
        color = tokens.colors.danger;
        bg = tokens.colors.dangerSubtle;
    } else if (current === limit) {
        color = tokens.colors.warning;
        bg = tokens.colors.warningSubtle;
    }

    return (
        <span
            style={{
                fontSize: 11,
                fontWeight: 600,
                fontFamily: tokens.typography.fontFamilyMono,
                color,
                background: bg,
                padding: "1px 6px",
                borderRadius: 9,
                display: "inline-flex",
                alignItems: "center",
                gap: 1,
            }}
            title={`${current} of ${limit} max`}
        >
            {current}
            <span style={{ opacity: 0.5 }}>/</span>
            {limit}
        </span>
    );
};
