import { Button, Input } from "antd";
import {
    ChevronLeft,
    ChevronRight,
    Search,
    UserCheck,
    PanelRight,
    PanelRightClose,
    Eye,
    EyeOff,
} from "lucide-react";
import { formatRangeLabel, formatMonthLabel } from "../../lib/date-utils";
import { tokens } from "../../theme";
import { TaskFilterPopover, type StatusOption } from "./TaskFilterPopover";
import type { TaskFilterState } from "./taskFilters";

export type CalendarMode = "month" | "week" | "day";

interface CalendarToolbarProps {
    mode: CalendarMode;
    onModeChange: (m: CalendarMode) => void;
    anchor: Date;
    rangeStart: Date;
    rangeEnd: Date;
    onPrev: () => void;
    onNext: () => void;
    onToday: () => void;
    search: string;
    onSearchChange: (s: string) => void;
    meMode: boolean;
    onMeModeChange: (v: boolean) => void;
    showClosedTasks: boolean;
    onShowClosedChange: (v: boolean) => void;
    showUnscheduled: boolean;
    onShowUnscheduledChange: (v: boolean) => void;
    filters: TaskFilterState;
    onFiltersChange: (f: TaskFilterState) => void;
    statusOptions: StatusOption[];
    weekStartsOn?: number;
}

export const CalendarToolbar = ({
    mode,
    onModeChange,
    anchor,
    rangeStart,
    rangeEnd,
    onPrev,
    onNext,
    onToday,
    search,
    onSearchChange,
    meMode,
    onMeModeChange,
    showClosedTasks,
    onShowClosedChange,
    showUnscheduled,
    onShowUnscheduledChange,
    filters,
    onFiltersChange,
    statusOptions,
    weekStartsOn,
}: CalendarToolbarProps) => {
    const label =
        mode === "month"
            ? formatMonthLabel(anchor)
            : formatRangeLabel(rangeStart, rangeEnd);

    return (
        <div
            style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                padding: `${tokens.spacing[3]}px ${tokens.spacing[6]}px`,
                background: tokens.colors.bgSurface,
                borderBottom: `1px solid ${tokens.colors.border}`,
                flexWrap: "wrap",
            }}
        >
            <Button size="small" onClick={onToday}>
                Today
            </Button>
            <div
                style={{
                    display: "inline-flex",
                    background: tokens.colors.bgMuted,
                    borderRadius: tokens.radius.md,
                    padding: 2,
                }}
            >
                <button onClick={onPrev} style={navBtnStyle} title="Previous">
                    <ChevronLeft size={14} strokeWidth={2} />
                </button>
                <button onClick={onNext} style={navBtnStyle} title="Next">
                    <ChevronRight size={14} strokeWidth={2} />
                </button>
            </div>
            <span
                style={{
                    fontSize: tokens.typography.fontSize.lg,
                    fontWeight: 600,
                    color: tokens.colors.textPrimary,
                    marginLeft: 4,
                    minWidth: 200,
                }}
            >
                {label}
            </span>

            <div
                style={{
                    marginLeft: "auto",
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                }}
            >
                {/* Mode toggle */}
                <div
                    style={{
                        display: "inline-flex",
                        background: tokens.colors.bgMuted,
                        borderRadius: tokens.radius.md,
                        padding: 2,
                    }}
                >
                    {(["month", "week", "day"] as CalendarMode[]).map((m) => (
                        <button
                            key={m}
                            onClick={() => onModeChange(m)}
                            style={modeBtnStyle(mode === m)}
                        >
                            {m === "month"
                                ? "Month"
                                : m === "week"
                                  ? "Week"
                                  : "Day"}
                        </button>
                    ))}
                </div>

                <TaskFilterPopover
                    filters={filters}
                    onChange={onFiltersChange}
                    statusOptions={statusOptions}
                    weekStartsOn={weekStartsOn}
                    extraActiveCount={meMode ? 1 : 0}
                    onClearExtras={() => onMeModeChange(false)}
                />

                <Button
                    type="text"
                    size="small"
                    icon={
                        showClosedTasks ? (
                            <Eye size={13} strokeWidth={1.75} />
                        ) : (
                            <EyeOff size={13} strokeWidth={1.75} />
                        )
                    }
                    onClick={() => onShowClosedChange(!showClosedTasks)}
                >
                    {showClosedTasks ? "Hide closed" : "Show closed"}
                </Button>

                <Button
                    type={meMode ? "primary" : "text"}
                    size="small"
                    icon={<UserCheck size={13} strokeWidth={1.75} />}
                    onClick={() => onMeModeChange(!meMode)}
                >
                    Me Mode
                </Button>

                <Input
                    value={search}
                    onChange={(e) => onSearchChange(e.target.value)}
                    placeholder="Search..."
                    prefix={
                        <Search
                            size={13}
                            strokeWidth={1.75}
                            color={tokens.colors.textMuted}
                        />
                    }
                    size="small"
                    style={{ width: 200 }}
                    allowClear
                />

                <Button
                    type="text"
                    size="small"
                    icon={
                        showUnscheduled ? (
                            <PanelRightClose
                                size={14}
                                strokeWidth={1.75}
                            />
                        ) : (
                            <PanelRight size={14} strokeWidth={1.75} />
                        )
                    }
                    onClick={() => onShowUnscheduledChange(!showUnscheduled)}
                    title={
                        showUnscheduled
                            ? "Hide unscheduled panel"
                            : "Show unscheduled panel"
                    }
                />
            </div>
        </div>
    );
};

const navBtnStyle: React.CSSProperties = {
    padding: "4px 6px",
    background: "transparent",
    border: 0,
    borderRadius: tokens.radius.sm,
    cursor: "pointer",
    color: tokens.colors.textSecondary,
    display: "inline-flex",
    alignItems: "center",
};

const modeBtnStyle = (active: boolean): React.CSSProperties => ({
    padding: "4px 10px",
    background: active ? tokens.colors.bgSurface : "transparent",
    border: 0,
    borderRadius: tokens.radius.sm,
    cursor: "pointer",
    fontSize: tokens.typography.fontSize.sm,
    fontWeight: active ? 600 : 500,
    color: active ? tokens.colors.textPrimary : tokens.colors.textSecondary,
    boxShadow: active ? tokens.shadows.sm : "none",
    transition: "all var(--transition-base)",
});
