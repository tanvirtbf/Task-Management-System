import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
    DndContext,
    PointerSensor,
    pointerWithin,
    useSensor,
    useSensors,
    type DragEndEvent,
} from "@dnd-kit/core";
import { tasksApi } from "../../http/api";
import { useAuthStore } from "../../stores/auth";
import { useUpdateTask, useCreateTask } from "../../hooks/useTaskMutations";
import { useStatusMap, useWorkspace } from "../../hooks/useReferenceData";
import {
    addDays,
    addMonths,
    dayKey,
    startOfDay,
    startOfMonth,
    endOfMonth,
} from "../../lib/date-utils";
import { App as AntApp, Modal, Input } from "antd";
import { tokens } from "../../theme";
import type { Task } from "../../types";
import { CalendarToolbar, type CalendarMode } from "./CalendarToolbar";
import { CalendarMonthGrid } from "./CalendarMonthGrid";
import { CalendarUnscheduledPanel } from "./CalendarUnscheduledPanel";
import {
    EMPTY_TASK_FILTERS,
    applyTaskFilters,
    type TaskFilterState,
} from "./taskFilters";

interface CalendarViewProps {
    listId: string;
}

export const CalendarView = ({ listId }: CalendarViewProps) => {
    const user = useAuthStore((s) => s.user);
    const [anchor, setAnchor] = useState<Date>(() => startOfDay(new Date()));
    const [mode, setMode] = useState<CalendarMode>("month");
    const [search, setSearch] = useState("");
    const [meMode, setMeMode] = useState(false);
    const [showClosedTasks, setShowClosedTasks] = useState(false);
    const [showUnscheduled, setShowUnscheduled] = useState(true);
    const [filters, setFilters] = useState<TaskFilterState>(
        EMPTY_TASK_FILTERS,
    );
    const [quickCreateDate, setQuickCreateDate] = useState<Date | null>(null);
    const [quickCreateName, setQuickCreateName] = useState("");

    const { message } = AntApp.useApp();
    const update = useUpdateTask(listId);
    const create = useCreateTask(listId);

    const { data: tasks = [] } = useQuery({
        queryKey: ["tasks-by-list", listId],
        queryFn: () => tasksApi.listByList(listId),
    });

    const { data: ws } = useWorkspace();
    const statusMap = useStatusMap(listId);

    // Filter tasks
    const filteredTasks = useMemo(() => {
        let result = tasks;
        if (!showClosedTasks) {
            result = result.filter((t) => {
                const s = statusMap.get(t.statusId);
                return s?.statusGroup !== "closed";
            });
        }
        if (meMode && user) {
            result = result.filter((t) => t.assignees.includes(user.id));
        }
        result = applyTaskFilters(result, filters);
        if (search.trim()) {
            const q = search.toLowerCase();
            result = result.filter(
                (t) =>
                    t.name.toLowerCase().includes(q) ||
                    t.customId?.toLowerCase().includes(q),
            );
        }
        return result;
    }, [tasks, showClosedTasks, meMode, search, user, statusMap, filters]);

    // Group filteredTasks by day
    const { tasksByDay, unscheduledTasks } = useMemo(() => {
        const byDay = new Map<string, Task[]>();
        const unscheduled: Task[] = [];
        for (const t of filteredTasks) {
            if (!t.dueDate) {
                unscheduled.push(t);
                continue;
            }
            const key = dayKey(t.dueDate);
            const arr = byDay.get(key) ?? [];
            arr.push(t);
            byDay.set(key, arr);
        }
        return { tasksByDay: byDay, unscheduledTasks: unscheduled };
    }, [filteredTasks]);

    const rangeStart =
        mode === "month" ? startOfMonth(anchor) : startOfDay(anchor);
    const rangeEnd =
        mode === "month"
            ? endOfMonth(anchor)
            : mode === "week"
              ? addDays(anchor, 7)
              : startOfDay(anchor);

    const handlePrev = () => {
        if (mode === "month") setAnchor(addMonths(anchor, -1));
        else if (mode === "week") setAnchor(addDays(anchor, -7));
        else setAnchor(addDays(anchor, -1));
    };
    const handleNext = () => {
        if (mode === "month") setAnchor(addMonths(anchor, 1));
        else if (mode === "week") setAnchor(addDays(anchor, 7));
        else setAnchor(addDays(anchor, 1));
    };
    const handleToday = () => setAnchor(startOfDay(new Date()));

    const sensors = useSensors(
        useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    );

    const handleDragEnd = (event: DragEndEvent) => {
        const { active, over } = event;
        if (!over) return;
        const taskId = String(active.id).replace(/^event:/, "");
        const overId = String(over.id);
        if (overId.startsWith("day:")) {
            const targetDateStr = overId.slice("day:".length);
            const [y, m, d] = targetDateStr.split("-").map(Number);
            const newDue = new Date(y, m - 1, d, 12, 0, 0); // noon UTC-ish
            update.mutate({
                id: taskId,
                patch: { dueDate: newDue.toISOString() },
            });
            message.success("Task rescheduled");
        }
    };

    const handleCellClick = (date: Date) => {
        setQuickCreateDate(date);
        setQuickCreateName("");
    };

    // Create a task due on a given day. Shared by the empty-cell quick-create
    // modal and the "+N more" day panel, so both add a task the same way.
    const createTaskOnDay = (date: Date, name: string) => {
        const trimmed = name.trim();
        if (!trimmed) return;
        create.mutate({
            primaryListId: listId,
            name: trimmed,
            dueDate: new Date(
                date.getFullYear(),
                date.getMonth(),
                date.getDate(),
                12,
                0,
            ).toISOString(),
        });
    };

    const handleQuickCreate = () => {
        if (quickCreateDate && quickCreateName.trim()) {
            createTaskOnDay(quickCreateDate, quickCreateName);
            setQuickCreateDate(null);
            setQuickCreateName("");
        }
    };

    return (
        <>
            <CalendarToolbar
                mode={mode}
                onModeChange={setMode}
                anchor={anchor}
                rangeStart={rangeStart}
                rangeEnd={rangeEnd}
                onPrev={handlePrev}
                onNext={handleNext}
                onToday={handleToday}
                search={search}
                onSearchChange={setSearch}
                meMode={meMode}
                onMeModeChange={setMeMode}
                showClosedTasks={showClosedTasks}
                onShowClosedChange={setShowClosedTasks}
                showUnscheduled={showUnscheduled}
                onShowUnscheduledChange={setShowUnscheduled}
                filters={filters}
                onFiltersChange={setFilters}
                statusOptions={[...statusMap.values()].map((s) => ({
                    value: s.id,
                    label: s.name,
                    color: s.color,
                }))}
                weekStartsOn={ws?.settings.weekStartsOn ?? 0}
            />

            {/*
              * P10: `collisionDetection` was never set here, so dnd-kit fell
              * back to `rectIntersection` — which picks the day cell that
              * overlaps the DRAGGED CHIP's rectangle most, not the day under
              * the pointer. A chip is wider than it is tall and is dragged in
              * from the unscheduled panel on the left, so aiming at the 15th
              * and releasing scheduled the task for the **14th**. Measured:
              * dropped on day 15, stored as 14, on the dev server and the
              * production bundle alike.
              *
              * `pointerWithin` is what a calendar means: the day you are
              * pointing at. The two sibling surfaces had both already chosen —
              * BoardView `closestCorners`, ListView `closestCenter` — and this
              * was the one drag surface that never did, which is exactly why it
              * was the one putting work on the wrong day.
              */}
            <DndContext
                sensors={sensors}
                collisionDetection={pointerWithin}
                onDragEnd={handleDragEnd}
            >
                <div
                    style={{
                        flex: 1,
                        display: "flex",
                        gap: tokens.spacing[4],
                        padding: tokens.spacing[5],
                        minHeight: 0,
                        overflow: "hidden",
                    }}
                >
                    {mode === "month" ? (
                        <CalendarMonthGrid
                            anchor={anchor}
                            tasksByDay={tasksByDay}
                            statusMap={statusMap}
                            weekStartsOn={ws?.settings.weekStartsOn ?? 0}
                            onCellClick={handleCellClick}
                            onCreateTask={createTaskOnDay}
                        />
                    ) : (
                        <div
                            style={{
                                flex: 1,
                                background: tokens.colors.bgSurface,
                                border: `1px solid ${tokens.colors.border}`,
                                borderRadius: tokens.radius.lg,
                                padding: tokens.spacing[8],
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                color: tokens.colors.textMuted,
                                fontSize: tokens.typography.fontSize.sm,
                            }}
                        >
                            <div style={{ textAlign: "center" }}>
                                <div
                                    style={{
                                        fontSize: tokens.typography.fontSize.lg,
                                        fontWeight: 600,
                                        color: tokens.colors.textPrimary,
                                        marginBottom: 6,
                                    }}
                                >
                                    {mode === "week" ? "Week" : "Day"} view
                                </div>
                                <div>Coming with finer time slots in Phase 12 polish.</div>
                                <div style={{ marginTop: 8 }}>
                                    For now, use the <strong>Month</strong> mode.
                                </div>
                            </div>
                        </div>
                    )}

                    {showUnscheduled && (
                        <CalendarUnscheduledPanel
                            tasks={unscheduledTasks}
                            statusMap={statusMap}
                        />
                    )}
                </div>
            </DndContext>

            <Modal
                open={quickCreateDate !== null}
                title={
                    quickCreateDate
                        ? `New task on ${quickCreateDate.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}`
                        : ""
                }
                onCancel={() => setQuickCreateDate(null)}
                onOk={handleQuickCreate}
                okText="Create"
                okButtonProps={{ disabled: !quickCreateName.trim() }}
                width={420}
            >
                <Input
                    autoFocus
                    value={quickCreateName}
                    onChange={(e) => setQuickCreateName(e.target.value)}
                    onPressEnter={handleQuickCreate}
                    placeholder="Task name..."
                />
            </Modal>
        </>
    );
};
