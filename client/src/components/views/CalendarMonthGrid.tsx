import { useState } from "react";
import { useDroppable } from "@dnd-kit/core";
import { Popover } from "antd";
import {
    buildMonthGrid,
    dayKey,
    isSameDay,
    startOfDay,
    weekDayNames,
} from "../../lib/date-utils";
import type { Status, Task } from "../../types";
import { CalendarEventCard } from "./CalendarEventCard";
import { CalendarDayPopover } from "./CalendarDayPopover";
import { tokens } from "../../theme";

interface CalendarMonthGridProps {
    anchor: Date;
    tasksByDay: Map<string, Task[]>;
    statusMap: Map<string, Status>;
    weekStartsOn?: number;
    onCellClick?: (date: Date) => void;
    onCreateTask?: (date: Date, name: string) => void;
}

export const CalendarMonthGrid = ({
    anchor,
    tasksByDay,
    statusMap,
    weekStartsOn = 6,
    onCellClick,
    onCreateTask,
}: CalendarMonthGridProps) => {
    const days = buildMonthGrid(anchor, weekStartsOn);
    const dayNames = weekDayNames(weekStartsOn, true);
    const currentMonth = anchor.getMonth();
    const today = startOfDay(new Date());

    return (
        <div
            style={{
                display: "flex",
                flexDirection: "column",
                background: tokens.colors.bgSurface,
                border: `1px solid ${tokens.colors.border}`,
                borderRadius: tokens.radius.lg,
                overflow: "hidden",
                flex: 1,
                minHeight: 0,
            }}
        >
            {/* Day name row */}
            <div
                style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(7, 1fr)",
                    borderBottom: `1px solid ${tokens.colors.border}`,
                }}
            >
                {dayNames.map((name) => (
                    <div
                        key={name}
                        style={{
                            padding: "8px 10px",
                            fontSize: 11,
                            fontWeight: 600,
                            color: tokens.colors.textMuted,
                            textTransform: "uppercase",
                            letterSpacing: "0.05em",
                            textAlign: "center",
                        }}
                    >
                        {name}
                    </div>
                ))}
            </div>

            {/* Day cells (6 rows × 7 cols) */}
            <div
                style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(7, 1fr)",
                    gridTemplateRows: "repeat(6, 1fr)",
                    flex: 1,
                    minHeight: 0,
                }}
            >
                {days.map((day) => (
                    <DayCell
                        key={dayKey(day)}
                        day={day}
                        isToday={isSameDay(day, today)}
                        isCurrentMonth={day.getMonth() === currentMonth}
                        tasks={tasksByDay.get(dayKey(day)) ?? []}
                        statusMap={statusMap}
                        onClick={() => onCellClick?.(day)}
                        onCreateTask={onCreateTask}
                    />
                ))}
            </div>
        </div>
    );
};

interface DayCellProps {
    day: Date;
    isToday: boolean;
    isCurrentMonth: boolean;
    tasks: Task[];
    statusMap: Map<string, Status>;
    onClick: () => void;
    onCreateTask?: (date: Date, name: string) => void;
}

const DayCell = ({
    day,
    isToday,
    isCurrentMonth,
    tasks,
    statusMap,
    onClick,
    onCreateTask,
}: DayCellProps) => {
    const [dayPanelOpen, setDayPanelOpen] = useState(false);
    const { setNodeRef, isOver } = useDroppable({
        id: `day:${dayKey(day)}`,
        data: { type: "day", date: day.toISOString() },
    });

    const dayNum = day.getDate();
    const MAX_VISIBLE = 3;
    const visibleTasks = tasks.slice(0, MAX_VISIBLE);
    const overflow = tasks.length - visibleTasks.length;

    return (
        <div
            ref={setNodeRef}
            // Quick-create fires only for the cell's own empty space. A click on
            // the "+N more" panel trigger (a <button>) is ignored here — antd's
            // Popover can let that click slip past stopPropagation, so the cell
            // guards against it directly rather than trusting the event to stop.
            onClick={(e) => {
                if ((e.target as HTMLElement).closest("button")) return;
                onClick();
            }}
            data-testid={`day-${dayKey(day)}`}
            style={{
                padding: 4,
                borderRight: `1px solid ${tokens.colors.borderSubtle}`,
                borderBottom: `1px solid ${tokens.colors.borderSubtle}`,
                background: isOver
                    ? tokens.colors.primarySubtle
                    : isCurrentMonth
                      ? tokens.colors.bgSurface
                      : tokens.colors.bgPage,
                display: "flex",
                flexDirection: "column",
                gap: 2,
                cursor: "pointer",
                transition: "background var(--transition-base)",
                minHeight: 90,
                overflow: "hidden",
            }}
        >
            <div
                style={{
                    display: "flex",
                    justifyContent: "flex-end",
                    padding: "2px 4px",
                }}
            >
                <span
                    style={{
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        minWidth: 22,
                        height: 22,
                        borderRadius: "50%",
                        background: isToday
                            ? tokens.colors.primary
                            : "transparent",
                        color: isToday
                            ? "#FFFFFF"
                            : isCurrentMonth
                              ? tokens.colors.textPrimary
                              : tokens.colors.textMuted,
                        fontSize: 12,
                        fontWeight: isToday ? 700 : 500,
                        fontFamily: tokens.typography.fontFamilyMono,
                    }}
                >
                    {dayNum}
                </span>
            </div>
            <div
                style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 2,
                    flex: 1,
                    minHeight: 0,
                }}
            >
                {visibleTasks.map((task) => (
                    <CalendarEventCard
                        key={task.id}
                        task={task}
                        status={statusMap.get(task.statusId)}
                    />
                ))}
                {overflow > 0 && (
                    <Popover
                        open={dayPanelOpen}
                        onOpenChange={setDayPanelOpen}
                        trigger="click"
                        placement="bottomLeft"
                        content={
                            <CalendarDayPopover
                                day={day}
                                tasks={tasks}
                                statusMap={statusMap}
                                onCreateTask={(name) =>
                                    onCreateTask?.(day, name)
                                }
                                onClose={() => setDayPanelOpen(false)}
                            />
                        }
                    >
                        <button
                            type="button"
                            // stopPropagation keeps the click off the day cell
                            // (whose handler opens the quick-create modal — the
                            // bug this fixes). antd's own click handler is
                            // composed onto this same button, so the panel still
                            // toggles; only the cell is spared the event.
                            onClick={(e) => e.stopPropagation()}
                            style={{
                                alignSelf: "flex-start",
                                border: "none",
                                background: dayPanelOpen
                                    ? tokens.colors.bgHover
                                    : "transparent",
                                fontSize: 10,
                                color: tokens.colors.textMuted,
                                padding: "1px 4px",
                                borderRadius: tokens.radius.sm,
                                fontWeight: 500,
                                cursor: "pointer",
                            }}
                        >
                            +{overflow} more
                        </button>
                    </Popover>
                )}
            </div>
        </div>
    );
};
