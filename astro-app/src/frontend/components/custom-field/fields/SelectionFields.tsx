import { Select } from "antd";
import type { CustomField, CustomFieldOption } from "../../../types/custom-fields";

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
