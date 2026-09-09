import { TimePicker, Tooltip } from "antd";
import dayjs from "dayjs";

/**
 * The hour-and-minute control that sits beside every date field.
 *
 * P3 of DEADLINE_TIME_PLAN_2026-09-08, implementing decision §B5: the picker is
 * ALWAYS VISIBLE rather than hidden behind an "add time" affordance, because
 * the point of the feature is handing work out with an hourly deadline and a
 * control you have to go looking for does not get used.
 *
 * ── ⛔ blank is NOT midnight (§B1) ──────────────────────────────────────────
 * An always-visible empty box invites exactly one wrong reading: "it shows
 * nothing, so the time is 00:00". It is not. A due date with no time runs to
 * the END of that day; a start date with no time begins at the start of it.
 * That asymmetry is what keeps every task that already exists behaving as it
 * did, and the placeholder is where a person actually learns it — so the
 * placeholder says the rule rather than showing `--:--`.
 *
 * ── the wire is 24-hour, the human is not ───────────────────────────────────
 * The value in and out is `"HH:MM"`, which is what the server's validator
 * accepts. The DISPLAY is `h:mm A`, which is what the user asked for. Sending
 * what is displayed would be a 422 — `"5:00 PM"` is one of the malformed inputs
 * `deadline-time.test.ts` pins as refused, written down precisely because an
 * AM/PM picker is the thing most likely to send it.
 */

export interface TimeOfDayPickerProps {
    /** `"HH:MM"` (24h) or null for "no time picked". */
    value: string | null;
    onChange: (next: string | null) => void;
    /** Which end of the range this is — it decides what blank MEANS. */
    kind: "start" | "due";
    /**
     * The date this time hangs off. A time without a date is meaningless and
     * the server refuses it (`task.time_without_date`), so the control is
     * disabled rather than letting someone compose a request that cannot work.
     */
    hasDate: boolean;
    size?: "small" | "middle";
    style?: React.CSSProperties;
}

/** What an empty box means, stated where someone will actually read it. */
const PLACEHOLDER: Record<"start" | "due", string> = {
    due: "End of day",
    start: "Start of day",
};

export const TimeOfDayPicker = ({
    value,
    onChange,
    kind,
    hasDate,
    size = "small",
    style,
}: TimeOfDayPickerProps) => {
    const picker = (
        <TimePicker
            size={size}
            // 12-hour with AM/PM, which is how the deadline was asked for.
            format="h:mm A"
            use12Hours
            // Five-minute steps: enough for "3 PM" or "5:30 PM" without an
            // hour-long scroll to reach them, and it keeps the minute column
            // short enough to be usable with a thumb (P11's lesson).
            minuteStep={5}
            needConfirm={false}
            allowClear
            disabled={!hasDate}
            placeholder={PLACEHOLDER[kind]}
            // `"17:00"` and the `"17:00:00"` a TIME column hands back both
            // parse; only the first five characters are ever sent on.
            value={value ? dayjs(value.slice(0, 5), "HH:mm") : null}
            onChange={(t) => onChange(t ? t.format("HH:mm") : null)}
            style={{ width: 118, ...style }}
        />
    );

    if (hasDate) return picker;

    // A disabled control with no explanation is a dead end. antd will not fire
    // hover events on a disabled input, so the wrapper carries them.
    return (
        <Tooltip title={`Pick a ${kind} date first`}>
            <span style={{ display: "inline-block", cursor: "not-allowed" }}>
                {picker}
            </span>
        </Tooltip>
    );
};
