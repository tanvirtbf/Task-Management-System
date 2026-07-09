import { useState } from "react";
import { DatePicker } from "antd";
import dayjs from "dayjs";
import { CalendarPlus, X } from "lucide-react";
import { DueDateBadge } from "../ui/DueDateBadge";
import { tokens } from "../../theme";

interface InlineDateEditProps {
    date: string | null;
    onChange: (next: string | null) => void;
    label?: string;
}

export const InlineDateEdit = ({
    date,
    onChange,
    label,
}: InlineDateEditProps) => {
    const [open, setOpen] = useState(false);

    if (open) {
        return (
            <DatePicker
                open
                value={date ? dayjs(date) : undefined}
                size="small"
                allowClear
                onChange={(v) => {
                    onChange(v ? v.toISOString() : null);
                    setOpen(false);
                }}
                onOpenChange={(o) => setOpen(o)}
                format="MMM D, YYYY"
                onClick={(e) => e.stopPropagation()}
            />
        );
    }

    return (
        <button
            onClick={(e) => {
                e.stopPropagation();
                setOpen(true);
            }}
            style={{
                background: "none",
                border: 0,
                padding: "2px 4px",
                margin: "-2px -4px",
                borderRadius: tokens.radius.sm,
                cursor: "pointer",
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                transition: "background var(--transition-base)",
            }}
            onMouseEnter={(e) =>
                (e.currentTarget.style.background = tokens.colors.bgHover)
            }
            onMouseLeave={(e) =>
                (e.currentTarget.style.background = "transparent")
            }
        >
            {date ? (
                <>
                    <DueDateBadge dueDate={date} size="sm" />
                    <X
                        size={11}
                        strokeWidth={1.75}
                        color={tokens.colors.textMuted}
                        onClick={(e) => {
                            e.stopPropagation();
                            onChange(null);
                        }}
                        style={{ cursor: "pointer", opacity: 0.5 }}
                    />
                </>
            ) : (
                <span
                    style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 3,
                        color: tokens.colors.textMuted,
                        fontSize: 11,
                    }}
                >
                    <CalendarPlus size={12} strokeWidth={1.5} />
                    {label ?? "Add date"}
                </span>
            )}
        </button>
    );
};
