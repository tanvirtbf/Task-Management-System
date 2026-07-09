import { DatePicker } from "antd";
import dayjs from "dayjs";
import type { CustomField } from "../../../types/custom-fields";

interface Props {
    field: CustomField;
    value: unknown;
    onChange: (next: unknown) => void;
    disabled?: boolean;
    autoFocus?: boolean;
}

const getDate = (value: unknown): string | null => {
    if (value && typeof value === "object" && "date" in value) {
        return (value as { date?: string }).date ?? null;
    }
    if (typeof value === "string") return value;
    return null;
};

export const DateFieldRenderer = ({
    field,
    value,
    onChange,
    disabled,
    autoFocus,
}: Props) => {
    const includeTime = Boolean(
        (field.config as { include_time?: boolean })?.include_time,
    );
    const date = getDate(value);

    return (
        <DatePicker
            value={date ? dayjs(date) : undefined}
            onChange={(v) =>
                onChange(
                    v
                        ? {
                              date: v.toISOString(),
                              include_time: includeTime,
                          }
                        : null,
                )
            }
            showTime={includeTime ? { format: "HH:mm" } : false}
            format={includeTime ? "MMM D, YYYY HH:mm" : "MMM D, YYYY"}
            disabled={disabled}
            autoFocus={autoFocus}
            allowClear
            style={{ width: "100%" }}
            placeholder={`Pick ${field.name.toLowerCase()}...`}
        />
    );
};
