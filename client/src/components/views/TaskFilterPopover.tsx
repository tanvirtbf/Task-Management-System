import { Button, Checkbox, DatePicker, Popover, Select } from "antd";
import dayjs, { type Dayjs } from "dayjs";
import { ListFilter } from "lucide-react";
import { useUsers } from "../../hooks/useReferenceData";
import { tokens } from "../../theme";
import { PRIORITY_LABELS, type Priority } from "../../types";
import {
    DUE_DATE_PRESETS,
    UNASSIGNED,
    countActiveTaskFilters,
    hasDateFilter,
    type TaskFilterState,
} from "./taskFilters";

export interface StatusOption {
    value: string;
    label: string;
    color?: string;
}

interface TaskFilterPopoverProps {
    filters: TaskFilterState;
    onChange: (f: TaskFilterState) => void;
    /** Per-list: status ids. Space level: name-keys the caller resolves. */
    statusOptions: StatusOption[];
    /** Workspace week start (0=Sun … 6=Sat) — drives the "This week" preset. */
    weekStartsOn?: number;
    /** Extra state the "Clear all" button should also reset (e.g. Me Mode). */
    onClearExtras?: () => void;
    /** Counted into the badge alongside the popover's own filters. */
    extraActiveCount?: number;
}

const DATE_FMT = "YYYY-MM-DD";

/**
 * The one Filter control every task surface shares — status, person
 * (including Unassigned), priority, and a due-date window with quick
 * presets. Views keep their own search / Me Mode / Show-closed toggles;
 * this popover owns everything that narrows by task fields.
 */
export const TaskFilterPopover = ({
    filters,
    onChange,
    statusOptions,
    weekStartsOn = 0,
    onClearExtras,
    extraActiveCount = 0,
}: TaskFilterPopoverProps) => {
    const { data: allUsers = [] } = useUsers();

    const ownCount = countActiveTaskFilters(filters);
    const badgeCount = ownCount + extraActiveCount;
    const dateActive = hasDateFilter(filters);

    const rangeValue: [Dayjs | null, Dayjs | null] = [
        filters.dueFrom ? dayjs(filters.dueFrom, DATE_FMT) : null,
        filters.dueTo ? dayjs(filters.dueTo, DATE_FMT) : null,
    ];

    const setRange = (from: string | null, to: string | null) =>
        onChange({
            ...filters,
            dueFrom: from,
            dueTo: to,
            // Leaving the window OFF resets the undated companion toggle so a
            // stale checkbox can't silently change the next date filter.
            includeUndated:
                from === null && to === null ? false : filters.includeUndated,
        });

    const activePresetKey = DUE_DATE_PRESETS.find((p) => {
        const [f, t] = p.range(weekStartsOn);
        return f === filters.dueFrom && t === filters.dueTo;
    })?.key;

    const assigneeOptions = [
        { value: UNASSIGNED, label: "Unassigned" },
        ...allUsers
            .filter((u) => u.status === "active")
            .map((u) => ({
                value: u.id,
                label: `${u.firstName} ${u.lastName}`.trim(),
            })),
    ];

    const content = (
        <div
            style={{
                width: 288,
                display: "flex",
                flexDirection: "column",
                gap: 12,
            }}
        >
            {statusOptions.length > 0 && (
                <div>
                    <FieldLabel>Status</FieldLabel>
                    <Select
                        mode="multiple"
                        value={filters.statusIds}
                        onChange={(v) =>
                            onChange({ ...filters, statusIds: v })
                        }
                        placeholder="Any status"
                        style={{ width: "100%" }}
                        size="small"
                        showSearch
                        optionFilterProp="label"
                        options={statusOptions.map((s) => ({
                            value: s.value,
                            label: (
                                <span
                                    style={{
                                        display: "inline-flex",
                                        alignItems: "center",
                                        gap: 6,
                                    }}
                                >
                                    <span
                                        aria-hidden
                                        style={{
                                            width: 8,
                                            height: 8,
                                            borderRadius: "50%",
                                            background:
                                                s.color ??
                                                tokens.colors.border,
                                            flexShrink: 0,
                                        }}
                                    />
                                    {s.label}
                                </span>
                            ),
                            // Plain-text mirror so showSearch matches on it.
                            title: s.label,
                        }))}
                        filterOption={(input, option) =>
                            (option?.title ?? "")
                                .toLowerCase()
                                .includes(input.toLowerCase())
                        }
                    />
                </div>
            )}

            <div>
                <FieldLabel>Assignee</FieldLabel>
                <Select
                    mode="multiple"
                    value={filters.assigneeIds}
                    onChange={(v) => onChange({ ...filters, assigneeIds: v })}
                    placeholder="Anyone"
                    style={{ width: "100%" }}
                    size="small"
                    showSearch
                    optionFilterProp="label"
                    options={assigneeOptions}
                />
            </div>

            <div>
                <FieldLabel>Priority</FieldLabel>
                <Select
                    mode="multiple"
                    value={filters.priorities}
                    onChange={(v) => onChange({ ...filters, priorities: v })}
                    placeholder="Any priority"
                    style={{ width: "100%" }}
                    size="small"
                    options={([1, 2, 3, 4, 0] as Priority[]).map((p) => ({
                        value: p,
                        label: PRIORITY_LABELS[p],
                    }))}
                />
            </div>

            <div>
                <FieldLabel>Due date</FieldLabel>
                <DatePicker.RangePicker
                    size="small"
                    style={{ width: "100%" }}
                    value={rangeValue}
                    allowEmpty={[true, true]}
                    // With a fully-empty controlled value, rc-picker's panel
                    // does not land on today by itself — pin it explicitly.
                    defaultPickerValue={[dayjs(), dayjs()]}
                    format={DATE_FMT}
                    onChange={(vals) =>
                        setRange(
                            vals?.[0] ? vals[0].format(DATE_FMT) : null,
                            vals?.[1] ? vals[1].format(DATE_FMT) : null,
                        )
                    }
                />
                <div
                    style={{
                        display: "flex",
                        flexWrap: "wrap",
                        gap: 4,
                        marginTop: 6,
                    }}
                >
                    {DUE_DATE_PRESETS.map((p) => {
                        const active = p.key === activePresetKey;
                        return (
                            <button
                                key={p.key}
                                type="button"
                                onClick={() => {
                                    if (active) {
                                        setRange(null, null);
                                        return;
                                    }
                                    const [f, t] = p.range(weekStartsOn);
                                    setRange(f, t);
                                }}
                                style={{
                                    border: `1px solid ${
                                        active
                                            ? tokens.colors.primary
                                            : tokens.colors.border
                                    }`,
                                    background: active
                                        ? tokens.colors.primarySubtle
                                        : tokens.colors.bgSurface,
                                    color: active
                                        ? tokens.colors.primary
                                        : tokens.colors.textSecondary,
                                    fontSize: 11,
                                    fontWeight: 500,
                                    padding: "1px 8px",
                                    borderRadius: 999,
                                    cursor: "pointer",
                                }}
                            >
                                {p.label}
                            </button>
                        );
                    })}
                </div>
                {dateActive && (
                    <Checkbox
                        checked={filters.includeUndated}
                        onChange={(e) =>
                            onChange({
                                ...filters,
                                includeUndated: e.target.checked,
                            })
                        }
                        style={{ marginTop: 6, fontSize: 12 }}
                    >
                        <span style={{ fontSize: 12 }}>
                            Include tasks without a due date
                        </span>
                    </Checkbox>
                )}
            </div>

            {badgeCount > 0 && (
                <Button
                    size="small"
                    type="link"
                    style={{ alignSelf: "flex-start", padding: 0 }}
                    onClick={() => {
                        onChange({
                            statusIds: [],
                            assigneeIds: [],
                            priorities: [],
                            dueFrom: null,
                            dueTo: null,
                            includeUndated: false,
                        });
                        onClearExtras?.();
                    }}
                >
                    Clear all filters
                </Button>
            )}
        </div>
    );

    return (
        <Popover
            content={content}
            trigger="click"
            placement="bottomLeft"
            title="Filters"
        >
            <Button
                type={badgeCount > 0 ? "primary" : "text"}
                size="small"
                icon={<ListFilter size={13} strokeWidth={1.75} />}
            >
                Filter
                {badgeCount > 0 && (
                    <span
                        style={{
                            background: "rgba(255,255,255,0.25)",
                            color: "#fff",
                            fontSize: 10,
                            fontWeight: 600,
                            padding: "1px 5px",
                            borderRadius: 9,
                            marginLeft: 4,
                            fontFamily: tokens.typography.fontFamilyMono,
                        }}
                    >
                        {badgeCount}
                    </span>
                )}
            </Button>
        </Popover>
    );
};

const FieldLabel = ({ children }: { children: React.ReactNode }) => (
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
