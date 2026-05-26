import { Calculator } from "lucide-react";
import type { CustomField } from "../../../types/custom-fields";
import { tokens } from "../../../theme";

interface Props {
    field: CustomField;
    value: unknown;
}

export const FormulaFieldRenderer = ({ field, value }: Props) => {
    const config = field.config as { expression?: string };
    const computed =
        value && typeof value === "object" && "value" in value
            ? (value as { value?: unknown }).value
            : null;

    return (
        <div
            style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                padding: "6px 10px",
                background: tokens.colors.bgMuted,
                border: `1px dashed ${tokens.colors.border}`,
                borderRadius: tokens.radius.sm,
            }}
        >
            <Calculator
                size={14}
                strokeWidth={1.75}
                color={tokens.colors.textMuted}
            />
            <span
                style={{
                    fontSize: tokens.typography.fontSize.sm,
                    color: tokens.colors.textPrimary,
                    fontFamily: tokens.typography.fontFamilyMono,
                    fontWeight: 600,
                    flex: 1,
                }}
            >
                {computed !== null && computed !== undefined
                    ? String(computed)
                    : "—"}
            </span>
            {config.expression && (
                <code
                    style={{
                        fontSize: 10,
                        color: tokens.colors.textMuted,
                        fontFamily: tokens.typography.fontFamilyMono,
                    }}
                    title={config.expression}
                >
                    fx
                </code>
            )}
        </div>
    );
};
