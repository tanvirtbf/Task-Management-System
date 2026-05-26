import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
    DndContext,
    PointerSensor,
    useSensor,
    useSensors,
    type DragEndEvent,
} from "@dnd-kit/core";
import { mockApi } from "../../lib/mock-api";
import { useAuthStore } from "../../stores/auth";
import { useUpdateTask, useCreateTask } from "../../hooks/useTaskMutations";
import { workspace } from "../../mocks/workspace";
import { statusesById } from "../../mocks/statuses";
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
import type { Status, Task } from "../../types";
import { CalendarToolbar, type CalendarMode } from "./CalendarToolbar";
import { CalendarMonthGrid } from "./CalendarMonthGrid";
import { CalendarUnscheduledPanel } from "./CalendarUnscheduledPanel";

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
    const [quickCreateDate, setQuickCreateDate] = useState<Date | null>(null);
    const [quickCreateName, setQuickCreateName] = useState("");

    const { message } = AntApp.useApp();
    const update = useUpdateTask(listId);
    const create = useCreateTask(listId);

    const { data: tasks = [] } = useQuery({
        queryKey: ["tasks-by-list", listId],
        queryFn: () => mockApi.tasks.listByList(listId),
    });

    // Build status map
    const statusMap = useMemo(() => {
        const m = new Map<string, Status>();
        for (const t of tasks) {
            const s = statusesById.get(t.statusId);
            if (s) m.set(s.id, s);
        }
        return m;
    }, [tasks]);

    // Filter tasks
    const filteredTasks = useMemo(() => {
        let result = tasks;
        if (!showClosedTasks) {
            result = result.filter((t) => {
                const s = statusesById.get(t.statusId);
                return s?.statusGroup !== "closed";
            });
        }
        if (meMode && user) {
            result = result.filter((t) => t.assignees.includes(user.id));
        }
        if (search.trim()) {
            const q = search.toLowerCase();
            result = result.filter(
                (t) =>
                    t.name.toLowerCase().includes(q) ||
                    t.customId?.toLowerCase().includes(q),
            );
        }
        return result;
    }, [tasks, showClosedTasks, meMode, search, user]);

    // Group filteredTasks by day
    const { tasksByDay, unscheduledTasks } = useMemo(() => {
        const byDay = new Map<string, Task[]>();
        const unscheduled: Task[] = [];
        for (const t of filteredTasks) {
            if (!t.dueDate) {
                unscheduled.push(t);
                continue;
            }
            const key = dayKey(new Date(t.dueDate));
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

    const handleQuickCreate = () => {
        if (quickCreateDate && quickCreateName.trim()) {
            create.mutate({
                primaryListId: listId,
                name: quickCreateName.trim(),
                dueDate: new Date(
                    quickCreateDate.getFullYear(),
                    quickCreateDate.getMonth(),
                    quickCreateDate.getDate(),
                    12,
                    0,
                ).toISOString(),
            });
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
            />

            <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
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
                            weekStartsOn={workspace.settings.weekStartsOn}
                            onCellClick={handleCellClick}
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
