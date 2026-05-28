import { InputNumber } from "antd";
import type { CustomField } from "../../../types/custom-fields";

interface Props {
    field: CustomField;
    value: unknown;
    onChange: (next: unknown) => void;
    disabled?: boolean;
    autoFocus?: boolean;
}

const getAmount = (value: unknown): number | null => {
    if (value && typeof value === "object" && "amount" in value) {
        const a = (value as { amount?: unknown }).amount;
        return typeof a === "number" ? a : null;
    }
    return null;
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
