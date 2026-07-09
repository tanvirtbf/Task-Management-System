import { Tooltip } from "antd";
import { tokens } from "../../theme";

interface Props {
    points: number | null | undefined;
}

/**
 * Tiny circular badge for story points. Renders nothing if undefined.
 */
export const StoryPointsBadge = ({ points }: Props) => {
    if (points === null || points === undefined) return null;
    return (
        <Tooltip title={`${points} story points`}>
            <span
                style={{
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    minWidth: 22,
                    height: 22,
                    borderRadius: 11,
                    background: tokens.colors.primarySubtle,
                    color: tokens.colors.primary,
                    fontFamily: tokens.typography.fontFamilyMono,
                    fontSize: 11,
                    fontWeight: 700,
                    padding: "0 6px",
                }}
            >
                {points}
            </span>
        </Tooltip>
    );
};
