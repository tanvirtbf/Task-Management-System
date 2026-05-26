import { useState } from "react";
import {
    Popover,
    Select,
    InputNumber,
    DatePicker,
    Switch,
    Input,
    Button,
} from "antd";
import dayjs from "dayjs";
import { Repeat, X } from "lucide-react";
import { tokens } from "../../theme";
import type {
    RecurrencePattern,
    TaskRecurrence,
} from "../../types";

interface Props {
    value: TaskRecurrence | null | undefined;
    onChange: (next: TaskRecurrence | null) => void;
}

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const summarise = (r: TaskRecurrence): string => {
    const every =
        r.interval === 1 ? "Every" : `Every ${r.interval}`;
    if (r.pattern === "daily") return `${every} day${r.interval > 1 ? "s" : ""}`;
    if (r.pattern === "weekly") {
        const days = (r.daysOfWeek ?? []).map((d) => DAY_LABELS[d]).join(", ");
        return `${every} week${r.interval > 1 ? "s" : ""}${days ? ` · ${days}` : ""}`;
    }
    if (r.pattern === "monthly") {
        const d = r.dayOfMonth ?? 1;
        return `${every} month${r.interval > 1 ? "s" : ""} · day ${d === -1 ? "last" : d}`;
    }
    return `Custom · ${r.cron ?? "0 9 * * MON"}`;
};

const defaultFor = (pattern: RecurrencePattern): TaskRecurrence => {
    if (pattern === "daily") {
        return { pattern, interval: 1, spawnOnComplete: true };
    }
    if (pattern === "weekly") {
        return {
            pattern,
            interval: 1,
            daysOfWeek: [new Date().getDay()],
            spawnOnComplete: true,
        };
    }
    if (pattern === "monthly") {
        return {
            pattern,
            interval: 1,
            dayOfMonth: new Date().getDate(),
            spawnOnComplete: true,
        };
    }
    return {
        pattern,
        interval: 1,
        cron: "0 9 * * MON",
        spawnOnComplete: true,
    };
};

export const RecurrenceConfig = ({ value, onChange }: Props) => {
    const [open, setOpen] = useState(false);
    const [draft, setDraft] = useState<TaskRecurrence>(
        value ?? defaultFor("weekly"),
    );

    const apply = (next: TaskRecurrence | null) => {
        if (next) setDraft(next);
        onChange(next);
        if (next === null) setOpen(false);
    };

    const content = (
        <div
            style={{
                width: 280,
                display: "flex",
                flexDirection: "column",
                gap: 10,
            }}
        >
            <div>
                <Label>Repeats</Label>
                <Select
                    value={draft.pattern}
                    onChange={(p) =>
                        setDraft(defaultFor(p as RecurrencePattern))
                    }
                    style={{ width: "100%" }}
                    size="small"
                    options={[
                        { value: "daily", label: "Daily" },
                        { value: "weekly", label: "Weekly" },
                        { value: "monthly", label: "Monthly" },
                        { value: "custom", label: "Custom (cron)" },
                    ]}
                />
            </div>
            <div>
                <Label>Every</Label>
                <InputNumber
                    min={1}
                    max={365}
                    value={draft.interval}
                    onChange={(v) =>
                        setDraft({ ...draft, interval: Number(v) || 1 })
                    }
                    size="small"
                    style={{ width: "100%" }}
                    addonAfter={
                        draft.pattern === "daily"
                            ? "day(s)"
                            : draft.pattern === "weekly"
                              ? "week(s)"
                              : draft.pattern === "monthly"
                                ? "month(s)"
                                : ""
                    }
                />
            </div>

            {draft.pattern === "weekly" && (
                <div>
                    <Label>On days</Label>
                    <div style={{ display: "flex", gap: 4 }}>
                        {DAY_LABELS.map((d, idx) => {
                            const active = (draft.daysOfWeek ?? []).includes(
                                idx,
                            );
                            return (
                                <button
                                    key={idx}
                                    type="button"
                                    onClick={() => {
                                        const cur = draft.daysOfWeek ?? [];
                                        setDraft({
                                            ...draft,
                                            daysOfWeek: active
                                                ? cur.filter((x) => x !== idx)
                                                : [...cur, idx].sort(),
                                        });
                                    }}
                                    style={{
                                        flex: 1,
                                        height: 28,
                                        background: active
                                            ? tokens.colors.primary
                                            : tokens.colors.bgMuted,
                                        color: active
                                            ? "#fff"
                                            : tokens.colors.textSecondary,
                                        border: 0,
                                        borderRadius: tokens.radius.sm,
                                        cursor: "pointer",
                                        fontSize: 10,
                                        fontFamily:
                                            tokens.typography.fontFamilyMono,
                                        fontWeight: 600,
                                    }}
                                >
                                    {d.charAt(0)}
                                </button>
                            );
                        })}
                    </div>
                </div>
            )}

            {draft.pattern === "monthly" && (
                <div>
                    <Label>Day of month</Label>
                    <Select
                        value={draft.dayOfMonth ?? 1}
                        onChange={(v) =>
                            setDraft({ ...draft, dayOfMonth: v as number })
                        }
                        style={{ width: "100%" }}
                        size="small"
                        options={[
                            ...Array.from({ length: 31 }, (_, i) => ({
                                value: i + 1,
                                label: `Day ${i + 1}`,
                            })),
                            { value: -1, label: "Last day of month" },
                        ]}
                    />
                </div>
            )}

            {draft.pattern === "custom" && (
                <div>
                    <Label>Cron expression</Label>
                    <Input
                        value={draft.cron ?? ""}
                        onChange={(e) =>
                            setDraft({ ...draft, cron: e.target.value })
                        }
                        placeholder="0 9 * * MON"
                        size="small"
                        style={{
                            fontFamily: tokens.typography.fontFamilyMono,
                        }}
                    />
                </div>
            )}

            <div>
                <Label>Ends on (optional)</Label>
                <DatePicker
                    value={draft.endsAt ? dayjs(draft.endsAt) : null}
                    onChange={(d) =>
                        setDraft({
                            ...draft,
                            endsAt: d ? d.toISOString() : null,
                        })
                    }
                    style={{ width: "100%" }}
                    size="small"
                    format="MMM D, YYYY"
                    allowClear
                />
            </div>

            <div
                style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 8,
                }}
            >
                <span style={{ fontSize: 12 }}>
                    Auto-create on complete
                </span>
                <Switch
                    checked={draft.spawnOnComplete}
                    onChange={(v) =>
                        setDraft({ ...draft, spawnOnComplete: v })
                    }
                    size="small"
                />
            </div>

            <div
                style={{
                    display: "flex",
                    gap: 6,
                    justifyContent: "flex-end",
                    paddingTop: 6,
                    borderTop: `1px solid ${tokens.colors.borderSubtle}`,
                }}
            >
                {value && (
                    <Button
                        size="small"
                        danger
                        type="text"
                        icon={<X size={12} strokeWidth={1.75} />}
                        onClick={() => apply(null)}
                    >
                        Remove
                    </Button>
                )}
                <Button size="small" onClick={() => setOpen(false)}>
                    Cancel
                </Button>
                <Button
                    size="small"
                    type="primary"
                    onClick={() => {
                        apply(draft);
                        setOpen(false);
                    }}
                >
                    Save
                </Button>
            </div>
        </div>
    );

    return (
        <Popover
            open={open}
            onOpenChange={setOpen}
            trigger="click"
            placement="bottomLeft"
            content={content}
            title="Recurrence"
        >
            <button
                style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    padding: "4px 8px",
                    background: value
                        ? tokens.colors.primarySubtle
                        : tokens.colors.bgMuted,
                    color: value
                        ? tokens.colors.primary
                        : tokens.colors.textMuted,
                    border: 0,
                    borderRadius: tokens.radius.sm,
                    cursor: "pointer",
                    fontSize: 12,
                    fontWeight: 500,
                    transition: "background var(--transition-fast)",
                }}
                aria-label="Recurrence"
            >
                <Repeat size={12} strokeWidth={1.75} />
                {value ? summarise(value) : "Set recurrence"}
            </button>
        </Popover>
    );
};

const Label = ({ children }: { children: React.ReactNode }) => (
    <label
        style={{
            display: "block",
            fontSize: 10,
            fontWeight: 700,
            color: tokens.colors.textMuted,
            textTransform: "uppercase",
            letterSpacing: "0.05em",
            marginBottom: 4,
        }}
    >
        {children}
    </label>
);
