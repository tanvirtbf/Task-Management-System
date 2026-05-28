import { Select } from "antd";
import { STORY_POINT_OPTIONS } from "../../types/sprint";
import { tokens } from "../../theme";

interface Props {
    points: number | null | undefined;
    onChange: (next: number | null) => void;
}

export const InlineStoryPointsEdit = ({ points, onChange }: Props) => (
    <Select
        size="small"
        value={points ?? undefined}
        onChange={(v) => onChange(v ?? null)}
        placeholder={
            <span
                style={{
                    color: tokens.colors.textMuted,
                    fontFamily: tokens.typography.fontFamilyMono,
                }}
            >
                ?
            </span>
        }
        allowClear
        style={{ width: 96 }}
        variant="borderless"
        options={STORY_POINT_OPTIONS.map((p) => ({
            value: p,
            label: `${p} pt${p === 1 ? "" : "s"}`,
        }))}
    />
);
