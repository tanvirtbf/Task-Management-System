import { InputNumber, Rate, Progress } from "antd";
import { Star, Heart, ThumbsUp } from "lucide-react";
import type { CustomField } from "../../../types/custom-fields";
import { tokens } from "../../../theme";

interface Props {
    field: CustomField;
    value: unknown;
    onChange: (next: unknown) => void;
    disabled?: boolean;
    autoFocus?: boolean;
}

const getNumber = (value: unknown): number | null => {
    if (typeof value === "number") return value;
    if (value && typeof value === "object" && "number" in value) {
        const n = (value as { number?: unknown }).number;
        return typeof n === "number" ? n : null;
    }
    return null;
};

const getAmount = (value: unknown): number | null => {
    if (value && typeof value === "object" && "amount" in value) {
        const a = (value as { amount?: unknown }).amount;
        return typeof a === "number" ? a : null;
    }
    return null;
};

export const NumberFieldRenderer = ({
    field,
    value,
    onChange,
    disabled,
    autoFocus,
}: Props) => {
    const config = field.config as {
        precision?: number;
        min?: number;
        max?: number;
        unit?: string;
    };
    return (
        <InputNumber
            value={getNumber(value)}
            onChange={(v) => onChange(v === null ? null : { number: v })}
            precision={config.precision ?? 0}
            min={config.min}
            max={config.max}
            disabled={disabled}
            autoFocus={autoFocus}
            addonAfter={config.unit}
            placeholder="0"
            style={{ width: "100%" }}
        />
    );
};

export const MoneyFieldRenderer = ({
    field,
    value,
    onChange,
    disabled,
    autoFocus,
}: Props) => {
    const config = field.config as { currency?: string; precision?: number };
    const currency = config.currency ?? "BDT";
    const symbol = currency === "BDT" ? "৳" : currency;
    const amount = getAmount(value);
    const displayValue = amount !== null ? amount / 100 : null;

    return (
        <InputNumber
            value={displayValue}
            onChange={(v) =>
                onChange(
                    v === null
                        ? null
                        : {
                              amount: Math.round(Number(v) * 100),
                              currency,
                          },
                )
            }
            precision={config.precision ?? 2}
            min={0}
            disabled={disabled}
            autoFocus={autoFocus}
            addonBefore={symbol}
            placeholder="0.00"
            style={{ width: "100%" }}
            formatter={(v) =>
                String(v ?? "").replace(/\B(?=(\d{3})+(?!\d))/g, ",")
            }
            parser={(v) => Number(String(v ?? "").replace(/,/g, "")) as never}
        />
    );
};

export const RatingFieldRenderer = ({
    field,
    value,
    onChange,
    disabled,
}: Props) => {
    const config = field.config as {
        max?: number;
        icon?: "star" | "heart" | "thumbs";
    };
    const max = config.max ?? 5;
    const current =
        value && typeof value === "object" && "value" in value
            ? ((value as { value?: number }).value ?? 0)
            : 0;

    const characterFor = (icon?: string) => {
        if (icon === "heart")
            return <Heart size={16} strokeWidth={1.75} fill="currentColor" />;
        if (icon === "thumbs")
            return <ThumbsUp size={16} strokeWidth={1.75} fill="currentColor" />;
        return <Star size={16} strokeWidth={1.75} fill="currentColor" />;
    };

    return (
        <Rate
            value={current}
            onChange={(v) => onChange({ value: v })}
            count={max}
            disabled={disabled}
            character={characterFor(config.icon)}
            style={{ color: tokens.colors.warning, fontSize: 16 }}
        />
    );
};

export const ProgressFieldRenderer = ({
    field,
    value,
    onChange,
    disabled,
}: Props) => {
    const config = field.config as {
        method?: "manual" | "automatic";
        start?: number;
        end?: number;
    };
    const start = config.start ?? 0;
    const end = config.end ?? 100;
    const current =
        value && typeof value === "object" && "current" in value
            ? ((value as { current?: number }).current ?? start)
            : start;
    const percent = Math.round(((current - start) / (end - start)) * 100);

    if (config.method === "automatic") {
        return (
            <div>
                <Progress
                    percent={percent}
                    strokeColor={tokens.colors.success}
                    size="small"
                />
                <div
                    style={{
                        fontSize: 11,
                        color: tokens.colors.textMuted,
                        marginTop: 4,
                    }}
                >
                    Computed from subtasks (read-only)
                </div>
            </div>
        );
    }

    return (
        <div
            style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
            }}
        >
            <Progress
                percent={percent}
                strokeColor={tokens.colors.success}
                size="small"
                style={{ flex: 1, margin: 0 }}
                showInfo={false}
            />
            <InputNumber
                value={current}
                onChange={(v) =>
                    onChange({ current: v ?? start, start, end })
                }
                min={start}
                max={end}
                disabled={disabled}
                style={{ width: 90 }}
                size="small"
                suffix={`/ ${end}`}
            />
        </div>
    );
};
