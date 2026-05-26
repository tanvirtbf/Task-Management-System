import { Input } from "antd";
import { Link2, Mail, Phone } from "lucide-react";
import type { CustomField } from "../../../types/custom-fields";
import { tokens } from "../../../theme";

interface Props {
    field: CustomField;
    value: unknown;
    onChange: (next: unknown) => void;
    disabled?: boolean;
    autoFocus?: boolean;
}

const getText = (value: unknown): string => {
    if (typeof value === "string") return value;
    if (value && typeof value === "object" && "text" in value)
        return String((value as { text?: string }).text ?? "");
    return "";
};

export const TextFieldRenderer = ({
    field,
    value,
    onChange,
    disabled,
    autoFocus,
}: Props) => (
    <Input
        value={getText(value)}
        onChange={(e) => onChange({ text: e.target.value })}
        maxLength={(field.config?.max_length as number) ?? 500}
        disabled={disabled}
        autoFocus={autoFocus}
        placeholder={`Enter ${field.name.toLowerCase()}...`}
    />
);

export const LongTextFieldRenderer = ({
    field,
    value,
    onChange,
    disabled,
    autoFocus,
}: Props) => (
    <Input.TextArea
        value={getText(value)}
        onChange={(e) => onChange({ text: e.target.value })}
        maxLength={(field.config?.max_length as number) ?? 5000}
        disabled={disabled}
        autoFocus={autoFocus}
        autoSize={{ minRows: 2, maxRows: 8 }}
        placeholder={`Enter ${field.name.toLowerCase()}...`}
    />
);

export const EmailFieldRenderer = ({
    value,
    onChange,
    disabled,
    autoFocus,
}: Props) => (
    <Input
        type="email"
        value={getText(value)}
        onChange={(e) => onChange({ text: e.target.value })}
        disabled={disabled}
        autoFocus={autoFocus}
        prefix={
            <Mail
                size={14}
                strokeWidth={1.75}
                color={tokens.colors.textMuted}
            />
        }
        placeholder="name@example.com"
    />
);

export const UrlFieldRenderer = ({
    value,
    onChange,
    disabled,
    autoFocus,
}: Props) => (
    <Input
        type="url"
        value={getText(value)}
        onChange={(e) => onChange({ text: e.target.value })}
        onBlur={(e) => {
            const v = e.target.value.trim();
            if (v && !/^https?:\/\//i.test(v)) {
                onChange({ text: `https://${v}` });
            }
        }}
        disabled={disabled}
        autoFocus={autoFocus}
        prefix={
            <Link2
                size={14}
                strokeWidth={1.75}
                color={tokens.colors.textMuted}
            />
        }
        placeholder="https://example.com"
    />
);

export const PhoneFieldRenderer = ({
    value,
    onChange,
    disabled,
    autoFocus,
}: Props) => {
    const text = getText(value);
    return (
        <Input
            type="tel"
            value={text}
            onChange={(e) => onChange({ text: e.target.value })}
            disabled={disabled}
            autoFocus={autoFocus}
            prefix={
                <span
                    style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 4,
                        color: tokens.colors.textMuted,
                    }}
                >
                    <Phone size={14} strokeWidth={1.75} />
                    <span style={{ fontSize: 11 }}>🇧🇩</span>
                </span>
            }
            placeholder="017XXXXXXXX"
        />
    );
};
