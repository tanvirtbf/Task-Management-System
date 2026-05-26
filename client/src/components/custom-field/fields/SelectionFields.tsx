import { Select, Checkbox } from "antd";
import { Check } from "lucide-react";
import type { CustomField, CustomFieldOption } from "../../../types/custom-fields";
import { tokens } from "../../../theme";

interface Props {
    field: CustomField;
    value: unknown;
    onChange: (next: unknown) => void;
    disabled?: boolean;
    autoFocus?: boolean;
}

const optionsOf = (field: CustomField): CustomFieldOption[] =>
    field.options ?? [];

const getOptionId = (value: unknown): string | undefined => {
    if (typeof value === "string") return value;
    if (value && typeof value === "object" && "option_id" in value) {
        return (value as { option_id?: string }).option_id;
    }
    return undefined;
};

const getOptionIds = (value: unknown): string[] => {
    if (Array.isArray(value)) return value;
    if (value && typeof value === "object" && "option_ids" in value) {
        return (value as { option_ids?: string[] }).option_ids ?? [];
    }
    return [];
};

const renderOption = (opt: CustomFieldOption) => (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
        <span
            style={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                background: opt.color,
                display: "inline-block",
            }}
        />
        {opt.label}
    </span>
);

export const DropdownFieldRenderer = ({
    field,
    value,
    onChange,
    disabled,
    autoFocus,
}: Props) => {
    const opts = optionsOf(field);
    const current = getOptionId(value);

    return (
        <Select
            value={current}
            onChange={(v) => onChange(v ? { option_id: v } : null)}
            options={opts.map((o) => ({
                value: o.id,
                label: renderOption(o),
            }))}
            placeholder={`Select ${field.name.toLowerCase()}...`}
            allowClear
            disabled={disabled}
            autoFocus={autoFocus}
            style={{ width: "100%" }}
        />
    );
};

export const LabelsFieldRenderer = ({
    field,
    value,
    onChange,
    disabled,
    autoFocus,
}: Props) => {
    const opts = optionsOf(field);
    const current = getOptionIds(value);

    return (
        <Select
            mode="multiple"
            value={current}
            onChange={(v) => onChange({ option_ids: v })}
            options={opts.map((o) => ({
                value: o.id,
                label: o.label,
                color: o.color,
            }))}
            placeholder="Choose labels..."
            disabled={disabled}
            autoFocus={autoFocus}
            optionRender={({ data }) => {
                const opt = opts.find((o) => o.id === data.value);
                return opt ? (
                    renderOption(opt)
                ) : (
                    String(data.label)
                );
            }}
            tagRender={(p) => {
                const opt = opts.find((o) => o.id === p.value);
                if (!opt) return <span>{p.label}</span>;
                return (
                    <span
                        style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 4,
                            padding: "2px 8px",
                            margin: "2px 3px",
                            background: `${opt.color}1A`,
                            color: opt.color,
                            borderRadius: 4,
                            fontSize: 11,
                            fontWeight: 500,
                        }}
                    >
                        {opt.label}
                        {!disabled && (
                            <button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    p.onClose();
                                }}
                                style={{
                                    background: "none",
                                    border: 0,
                                    padding: 0,
                                    cursor: "pointer",
                                    color: "inherit",
                                    fontSize: 14,
                                    lineHeight: 1,
                                    marginLeft: 2,
                                }}
                            >
                                ×
                            </button>
                        )}
                    </span>
                );
            }}
            style={{ width: "100%" }}
        />
    );
};

export const CheckboxFieldRenderer = ({
    field,
    value,
    onChange,
    disabled,
}: Props) => {
    const checked =
        value && typeof value === "object" && "checked" in value
            ? Boolean((value as { checked?: boolean }).checked)
            : false;

    return (
        <Checkbox
            checked={checked}
            onChange={(e) => onChange({ checked: e.target.checked })}
            disabled={disabled}
        >
            <span
                style={{
                    fontSize: tokens.typography.fontSize.sm,
                    color: tokens.colors.textSecondary,
                }}
            >
                {field.name}
            </span>
            {checked && (
                <Check
                    size={12}
                    strokeWidth={2}
                    color={tokens.colors.success}
                    style={{ marginLeft: 4, verticalAlign: "middle" }}
                />
            )}
        </Checkbox>
    );
};
