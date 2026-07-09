import { useState } from "react";
import { Input, Tooltip } from "antd";
import { Phone, AlertCircle, PhoneCall } from "lucide-react";
import type { CustomField } from "../../../types/custom-fields";
import { tokens } from "../../../theme";
import { isValidBdPhone, formatBdPhone } from "../../../lib/bd-phone";

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

export const PhoneFieldRenderer = ({
    value,
    onChange,
    disabled,
    autoFocus,
}: Props) => {
    const text = getText(value);
    const [touched, setTouched] = useState(false);
    const isValid = !text || isValidBdPhone(text);
    const showError = touched && !!text && !isValid;

    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <Input
                type="tel"
                value={text}
                onChange={(e) =>
                    onChange({ text: e.target.value.replace(/[^\d+\s-]/g, "") })
                }
                onBlur={() => setTouched(true)}
                disabled={disabled}
                autoFocus={autoFocus}
                status={showError ? "error" : undefined}
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
                        <span style={{ fontSize: 11 }}>BD</span>
                    </span>
                }
                suffix={
                    isValid && text ? (
                        <Tooltip title={`Call ${formatBdPhone(text)}`}>
                            <a
                                href={`tel:+88${text.replace(/\D/g, "")}`}
                                style={{
                                    color: tokens.colors.primary,
                                    display: "inline-flex",
                                }}
                                onClick={(e) => e.stopPropagation()}
                            >
                                <PhoneCall size={13} strokeWidth={1.75} />
                            </a>
                        </Tooltip>
                    ) : null
                }
                placeholder="01712345678"
            />
            {showError && (
                <span
                    style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 4,
                        fontSize: 11,
                        color: tokens.colors.danger,
                    }}
                >
                    <AlertCircle size={11} strokeWidth={1.75} />
                    Enter a valid Bangladesh mobile (01[3-9]XXXXXXXX)
                </span>
            )}
        </div>
    );
};
