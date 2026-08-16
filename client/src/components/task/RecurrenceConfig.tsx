import { useState } from "react";
import { Popover, DatePicker, TimePicker, Button, Radio, Checkbox } from "antd";
import { Repeat, X } from "lucide-react";
import dayjs from "dayjs";
import type { TaskRecurrence } from "../../types";
import { tokens } from "../../theme";

interface Props {
    value: TaskRecurrence | null | undefined;
    onChange: (next: TaskRecurrence | null) => void;
}

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** upgrades/024 — what the job assumes when no time was picked. */
const DEFAULT_TIME = "09:00";

/** "09:00" → "9:00 AM", the way the chip should read. */
const prettyTime = (hhmm: string): string => {
    const [h, m] = hhmm.split(":").map(Number);
    const suffix = h < 12 ? "AM" : "PM";
    const hour = h % 12 === 0 ? 12 : h % 12;
    return `${hour}:${String(m).padStart(2, "0")} ${suffix}`;
};

const formatRecurrence = (r: TaskRecurrence): string => {
    const at = ` at ${prettyTime(r.time ?? DEFAULT_TIME)}`;
    if (r.pattern === "daily") return `Daily${at}`;
    if (r.pattern === "weekly") {
        const days = (r.daysOfWeek ?? []).map((d) => DAY_LABELS[d]).join(", ");
        return days ? `${days}${at}` : `Weekly${at}`;
    }
    return r.pattern;
};

export const RecurrenceConfig = ({ value, onChange }: Props) => {
    const [open, setOpen] = useState(false);
    const [draft, setDraft] = useState<TaskRecurrence>(
        value ?? {
            pattern: "daily",
            interval: 1,
            daysOfWeek: [],
            time: DEFAULT_TIME,
            endsAt: null,
            spawnOnComplete: true,
        },
    );

    const apply = () => {
        onChange(draft);
        setOpen(false);
    };

    const clear = () => {
        onChange(null);
        setOpen(false);
    };

    const content = (
        <div style={{ width: 280, padding: 4 }}>
            <div style={{ marginBottom: 12 }}>
                <div
                    style={{
                        fontSize: 11,
                        color: tokens.colors.textMuted,
                        marginBottom: 6,
                        fontWeight: 500,
                    }}
                >
                    Repeats
                </div>
                <Radio.Group
                    size="small"
                    value={draft.pattern}
                    onChange={(e) =>
                        setDraft({ ...draft, pattern: e.target.value })
                    }
                >
                    <Radio.Button value="daily">Daily</Radio.Button>
                    <Radio.Button value="weekly">Weekly</Radio.Button>
                </Radio.Group>
            </div>

            {draft.pattern === "weekly" && (
                <div style={{ marginBottom: 12 }}>
                    <div
                        style={{
                            fontSize: 11,
                            color: tokens.colors.textMuted,
                            marginBottom: 6,
                            fontWeight: 500,
                        }}
                    >
                        On days
                    </div>
                    <Checkbox.Group
                        value={draft.daysOfWeek ?? []}
                        onChange={(days) =>
                            setDraft({
                                ...draft,
                                daysOfWeek: days as number[],
                            })
                        }
                        options={DAY_LABELS.map((label, i) => ({
                            label,
                            value: i,
                        }))}
                    />
                </div>
            )}

            {/* upgrades/024 — the time is the whole point now: this is when
                the next task is actually created, on the office's clock. */}
            <div style={{ marginBottom: 12 }}>
                <div
                    style={{
                        fontSize: 11,
                        color: tokens.colors.textMuted,
                        marginBottom: 6,
                        fontWeight: 500,
                    }}
                >
                    At what time
                </div>
                <TimePicker
                    size="small"
                    format="h:mm A"
                    minuteStep={15}
                    allowClear={false}
                    value={dayjs(draft.time ?? DEFAULT_TIME, "HH:mm")}
                    onChange={(t) =>
                        setDraft({
                            ...draft,
                            time: t ? t.format("HH:mm") : DEFAULT_TIME,
                        })
                    }
                    style={{ width: "100%" }}
                />
            </div>

            <div style={{ marginBottom: 12 }}>
                <div
                    style={{
                        fontSize: 11,
                        color: tokens.colors.textMuted,
                        marginBottom: 6,
                        fontWeight: 500,
                    }}
                >
                    Ends on (optional)
                </div>
                <DatePicker
                    size="small"
                    value={draft.endsAt ? dayjs(draft.endsAt) : null}
                    onChange={(d) =>
                        setDraft({
                            ...draft,
                            endsAt: d ? d.toISOString() : null,
                        })
                    }
                    style={{ width: "100%" }}
                />
            </div>

            {/* Say plainly what will happen — this used to save a setting that
                did nothing, so the promise has to be legible. */}
            <div
                style={{
                    fontSize: 11,
                    color: tokens.colors.textMuted,
                    background: tokens.colors.bgPage,
                    borderRadius: tokens.radius.sm,
                    padding: "6px 8px",
                    marginBottom: 10,
                    lineHeight: 1.5,
                }}
            >
                A fresh copy of this task is created{" "}
                {draft.pattern === "daily" ? "every day" : "on those days"} at{" "}
                <b>{prettyTime(draft.time ?? DEFAULT_TIME)}</b>, named with that
                date. Nothing else is copied — no assignee, no dates.
            </div>

            <div
                style={{
                    display: "flex",
                    gap: 6,
                    justifyContent: "space-between",
                    paddingTop: 8,
                    borderTop: `1px solid ${tokens.colors.borderSubtle}`,
                }}
            >
                {value ? (
                    <Button size="small" danger onClick={clear}>
                        Clear
                    </Button>
                ) : (
                    <span />
                )}
                <div style={{ display: "flex", gap: 6 }}>
                    <Button size="small" onClick={() => setOpen(false)}>
                        Cancel
                    </Button>
                    <Button size="small" type="primary" onClick={apply}>
                        Save
                    </Button>
                </div>
            </div>
        </div>
    );

    return (
        <Popover
            content={content}
            trigger="click"
            placement="bottomLeft"
            open={open}
            onOpenChange={setOpen}
        >
            <button
                style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    padding: "2px 8px",
                    borderRadius: tokens.radius.md,
                    border: `1px solid ${value ? tokens.colors.primary : tokens.colors.border}`,
                    background: value
                        ? `${tokens.colors.primary}1A`
                        : tokens.colors.bgSurface,
                    color: value
                        ? tokens.colors.primary
                        : tokens.colors.textSecondary,
                    fontSize: tokens.typography.fontSize.sm,
                    cursor: "pointer",
                }}
            >
                <Repeat size={12} strokeWidth={1.75} />
                {value ? formatRecurrence(value) : "Add recurrence"}
                {value && (
                    <X
                        size={11}
                        strokeWidth={2}
                        onClick={(e) => {
                            e.stopPropagation();
                            onChange(null);
                        }}
                        style={{ marginLeft: 2 }}
                    />
                )}
            </button>
        </Popover>
    );
};
