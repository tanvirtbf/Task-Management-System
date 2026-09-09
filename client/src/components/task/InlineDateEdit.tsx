import { useRef, useState } from "react";
import { DatePicker } from "antd";
import dayjs from "dayjs";
import { CalendarPlus, X } from "lucide-react";
import { DueDateBadge } from "../ui/DueDateBadge";
import { TimeOfDayPicker } from "../ui/TimeOfDayPicker";
import { tokens } from "../../theme";

interface InlineDateEditProps {
    date: string | null;
    /** `"HH:MM"` or null — null means end of day for `due`, start for `start`. */
    time?: string | null;
    /**
     * Both halves at once, deliberately.
     *
     * Clearing the date clears the time, so the two are one edit, not two. A
     * pair of independent callbacks would fire two PATCHes for that, and the
     * intermediate state between them is the orphaned time the server now
     * refuses (`task.time_without_date`).
     */
    onChange: (next: { date: string | null; time: string | null }) => void;
    label?: string;
    /** Which end of the range this is — it decides what a blank time means. */
    kind?: "start" | "due";
}

export const InlineDateEdit = ({
    date,
    time = null,
    onChange,
    label,
    kind = "due",
}: InlineDateEditProps) => {
    const [open, setOpen] = useState(false);
    /**
     * Set for the instant between picking a date and antd closing the panel.
     *
     * antd fires `onChange` and then `onOpenChange(false)` synchronously in
     * the same click, so this is deterministic rather than a race.
     */
    const justPickedDate = useRef(false);

    if (open) {
        return (
            <DatePicker
                open
                value={date ? dayjs(date) : undefined}
                size="small"
                allowClear
                onChange={(v) => {
                    // A pick, not a clear: hold the panel open (see below).
                    justPickedDate.current = !!v;
                    // Clearing the date drops the time with it. Keeping it would
                    // strand a time on a task with no deadline, which is exactly
                    // the orphan the server refuses.
                    onChange(
                        v
                            ? { date: v.toISOString(), time }
                            : { date: null, time: null },
                    );
                }}
                onOpenChange={(o) => {
                    // ⛔ antd closes the panel the moment a date is selected, and
                    // the time control lives in that panel's footer -- so
                    // honouring this particular close would strand it, and
                    // setting a time on the date you just picked would need a
                    // second trip through the editor. §B5 asked for the opposite.
                    //
                    // This was MEASURED, not assumed: InlineDateEdit.test.tsx has
                    // a case that fails without these three lines, written before
                    // them precisely because the docs read as though the panel
                    // stays put when `open` is controlled. It does not.
                    if (!o && justPickedDate.current) {
                        justPickedDate.current = false;
                        return;
                    }
                    // Anything else -- Escape, a click outside -- ends the edit.
                    setOpen(o);
                }}
                format="MMM D, YYYY"
                onClick={(e) => e.stopPropagation()}
                // §B5 says the time is always visible. In a table row there is
                // no horizontal space for a second permanent control without
                // pushing the assignee off the end (P11's metric guard), so it
                // rides in the calendar's own footer: no wider row, and the
                // control is there the instant the date is.
                renderExtraFooter={() => (
                    <div
                        onClick={(e) => e.stopPropagation()}
                        style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 8,
                            padding: "4px 0",
                        }}
                    >
                        <span
                            style={{
                                fontSize: 11,
                                color: tokens.colors.textMuted,
                                whiteSpace: "nowrap",
                            }}
                        >
                            Time
                        </span>
                        <TimeOfDayPicker
                            value={time}
                            kind={kind}
                            hasDate={!!date}
                            onChange={(t) => onChange({ date, time: t })}
                            style={{ width: "100%" }}
                        />
                    </div>
                )}
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
                    <DueDateBadge dueDate={date} dueTime={time} size="sm" />
                    <X
                        size={11}
                        strokeWidth={1.75}
                        color={tokens.colors.textMuted}
                        onClick={(e) => {
                            e.stopPropagation();
                            onChange({ date: null, time: null });
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
