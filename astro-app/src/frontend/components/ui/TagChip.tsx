import { tokens } from "../../theme";
import type { Tag } from "../../types";

interface TagChipProps {
    tag: Pick<Tag, "name" | "color">;
    size?: "sm" | "md";
}

export const TagChip = ({ tag, size = "sm" }: TagChipProps) => (
    <span
        style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
            padding: size === "sm" ? "1px 6px" : "2px 8px",
            background: `${tag.color}1A`,
            color: tag.color,
            borderRadius: tokens.radius.sm,
            fontSize: size === "sm" ? 11 : tokens.typography.fontSize.sm,
            fontWeight: 500,
            lineHeight: 1.4,
            whiteSpace: "nowrap",
        }}
    >
        {tag.name}
    </span>
);
