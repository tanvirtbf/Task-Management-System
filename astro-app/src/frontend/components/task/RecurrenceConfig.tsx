import { useState } from "react";
import { Popover, DatePicker, Button, Radio, Checkbox } from "antd";
import { Repeat, X } from "lucide-react";
import dayjs from "dayjs";
import type { TaskRecurrence } from "../../types";
import { tokens } from "../../theme";

interface Props {
    value: TaskRecurrence | null | undefined;
    onChange: (next: TaskRecurrence | null) => void;
}

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const formatRecurrence = (r: TaskRecurrence): string => {
    if (r.pattern === "daily") return r.interval > 1 ? `Every ${r.interval} days` : "Daily";
    if (r.pattern === "weekly") {
        const days = (r.daysOfWeek ?? []).map((d) => DAY_LABELS[d]).join(", ");
        return days ? `Weekly · ${days}` : "Weekly";
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
