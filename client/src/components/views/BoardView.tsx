import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
    DndContext,
    DragOverlay,
    PointerSensor,
    useSensor,
    useSensors,
    closestCorners,
    type DragEndEvent,
    type DragStartEvent,
} from "@dnd-kit/core";
import { LayoutGrid } from "lucide-react";
import { tasksApi } from "../../http/api";
import {
    useStatuses,
    useUserMap,
    useWorkspace,
} from "../../hooks/useReferenceData";
import { useAuthStore } from "../../stores/auth";
import { useBoardStore } from "../../stores/board";
import { useUpdateTask } from "../../hooks/useTaskMutations";
import { BoardColumn } from "./BoardColumn";
import { BoardCard } from "./BoardCard";
import { BoardToolbar } from "./BoardToolbar";
import { BoardSwimlane } from "./BoardSwimlane";
import { EmptyState } from "../ui/EmptyState";
import {
    EMPTY_TASK_FILTERS,
    applyTaskFilters,
    type TaskFilterState,
} from "./taskFilters";
import { tokens } from "../../theme";
import type { Priority, Status, Task, User } from "../../types";
import { PRIORITY_LABELS } from "../../types";

interface BoardViewProps {
    listId: string;
}

export const BoardView = ({ listId }: BoardViewProps) => {
    const user = useAuthStore((s) => s.user);
    const [search, setSearch] = useState("");
    const [meMode, setMeMode] = useState(false);
    const [showClosedTasks, setShowClosedTasks] = useState(false);
    const [filters, setFilters] = useState<TaskFilterState>(
        EMPTY_TASK_FILTERS,
    );
    const [activeTask, setActiveTask] = useState<Task | null>(null);

    const density =
        useBoardStore((s) => s.cardDensity[listId]) ?? "compact";
    const subgroupBy = useBoardStore((s) => s.subgroupBy[listId]) ?? "none";

    const { data: tasks = [], isLoading } = useQuery({
        queryKey: ["tasks-by-list", listId],
        queryFn: () => tasksApi.listByList(listId),
    });

    const { data: statuses = [] } = useStatuses(listId);
    const { data: ws } = useWorkspace();
    const userMap = useUserMap();
    const update = useUpdateTask(listId);

    // Filter tasks: search + me-mode + closed + the shared filter set
    const filtered = useMemo(() => {
        let result = tasks;
        if (!showClosedTasks) {
            result = result.filter((t) => {
                const s = statuses.find((x) => x.id === t.statusId);
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
    }, [tasks, statuses, showClosedTasks, meMode, search, user, filters]);

    const sensors = useSensors(
        useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    );

    const handleDragStart = (event: DragStartEvent) => {
        const task = tasks.find((t) => t.id === event.active.id);
        setActiveTask(task ?? null);
    };

    const handleDragEnd = (event: DragEndEvent) => {
        setActiveTask(null);
        const { active, over } = event;
        if (!over) return;

        const draggedTask = tasks.find((t) => t.id === active.id);
        if (!draggedTask) return;

        const overId = String(over.id);

        if (overId.startsWith("column:")) {
            const newStatusId = overId.slice("column:".length);
            if (draggedTask.statusId !== newStatusId) {
                update.mutate({
                    id: draggedTask.id,
                    patch: { statusId: newStatusId },
                });
            }
            return;
        }

        // Dropped on another task — match its status
        const targetTask = tasks.find((t) => t.id === overId);
        if (targetTask && draggedTask.statusId !== targetTask.statusId) {
            update.mutate({
                id: draggedTask.id,
                patch: { statusId: targetTask.statusId },
            });
        }
    };

    // Determine swimlanes (subgroups) — declared BEFORE any early return
    // to keep hook order stable across renders.
    const swimlanes = useMemo(() => {
        if (subgroupBy === "none") {
            return [{ key: "all", label: "", count: filtered.length }];
        }
        if (subgroupBy === "assignee") {
            const buckets = new Map<string, Task[]>();
            for (const t of filtered) {
                if (t.assignees.length === 0) {
                    const arr = buckets.get("unassigned") ?? [];
                    arr.push(t);
                    buckets.set("unassigned", arr);
                } else {
                    for (const uid of t.assignees) {
                        const arr = buckets.get(uid) ?? [];
                        arr.push(t);
                        buckets.set(uid, arr);
                    }
                }
            }
            return Array.from(buckets.entries()).map(([key, ts]) => ({
                key,
                label:
                    key === "unassigned"
                        ? "Unassigned"
                        : userMap.get(key)
                          ? `${userMap.get(key)!.firstName} ${userMap.get(key)!.lastName}`
                          : "Unknown",
                user: key === "unassigned" ? undefined : userMap.get(key),
                count: ts.length,
                tasks: ts,
            }));
        }
        if (subgroupBy === "priority") {
            const buckets = new Map<Priority, Task[]>();
            for (const t of filtered) {
                const arr = buckets.get(t.priority) ?? [];
                arr.push(t);
                buckets.set(t.priority, arr);
            }
            const order: Priority[] = [1, 2, 3, 4, 0];
            return order
                .filter((p) => buckets.has(p))
                .map((p) => ({
                    key: String(p),
                    label: PRIORITY_LABELS[p],
                    priority: p,
                    count: buckets.get(p)!.length,
                    tasks: buckets.get(p)!,
                }));
        }
        return [];
    }, [filtered, subgroupBy, userMap]);

    if (isLoading) {
        return (
            <div style={{ padding: tokens.spacing[8], textAlign: "center" }}>
                Loading board...
            </div>
        );
    }

    const hasAnyTasks = tasks.length > 0;
    const hasFilteredTasks = filtered.length > 0;

    return (
        <>
            <BoardToolbar
                listId={listId}
                search={search}
                onSearchChange={setSearch}
                meMode={meMode}
                onMeModeChange={setMeMode}
                showClosedTasks={showClosedTasks}
                onShowClosedChange={setShowClosedTasks}
                filters={filters}
                onFiltersChange={setFilters}
                statusOptions={statuses.map((s) => ({
                    value: s.id,
                    label: s.name,
                    color: s.color,
                }))}
                weekStartsOn={ws?.settings.weekStartsOn ?? 0}
            />

            {!hasAnyTasks ? (
                <EmptyState
                    icon={LayoutGrid}
                    title="No tasks in this list"
                    description="Add tasks to columns below to populate the board."
                />
            ) : !hasFilteredTasks ? (
                <EmptyState
                    icon={LayoutGrid}
                    title="No tasks match your filters"
                    description="Clear search or toggle Me Mode."
                />
            ) : (
                <DndContext
                    sensors={sensors}
                    collisionDetection={closestCorners}
                    onDragStart={handleDragStart}
                    onDragEnd={handleDragEnd}
                >
                    <div
                        style={{
                            flex: 1,
                            overflow: "auto",
                            padding: tokens.spacing[5],
                            minHeight: 0,
                        }}
                    >
                        {subgroupBy === "none" ? (
                            <BoardColumns
                                listId={listId}
                                statuses={statuses}
                                tasks={filtered}
                                density={density}
                            />
                        ) : (
                            <div
                                style={{
                                    display: "flex",
                                    flexDirection: "column",
                                    gap: tokens.spacing[3],
                                }}
                            >
                                {(swimlanes as Array<{
                                    key: string;
                                    label: string;
                                    count: number;
                                    user?: User;
                                    priority?: Priority;
                                    tasks?: Task[];
                                }>).map((lane) => (
                                    <BoardSwimlane
                                        key={lane.key}
                                        subgroupBy={subgroupBy}
                                        key_={lane.key}
                                        label={lane.label}
                                        user={lane.user}
                                        priority={lane.priority}
                                        count={lane.count}
                                    >
                                        <BoardColumns
                                            listId={listId}
                                            statuses={statuses}
                                            tasks={lane.tasks ?? []}
                                            density={density}
                                        />
                                    </BoardSwimlane>
                                ))}
                            </div>
                        )}
                    </div>

                    <DragOverlay>
                        {activeTask && (
                            <div
                                style={{ width: 280, cursor: "grabbing" }}
                            >
                                <BoardCard
                                    task={activeTask}
                                    density={density}
                                    isOverlay
                                />
                            </div>
                        )}
                    </DragOverlay>
                </DndContext>
            )}
        </>
    );
};

const BoardColumns = ({
    listId,
    statuses,
    tasks,
    density,
}: {
    listId: string;
    statuses: Status[];
    tasks: Task[];
    density: "compact" | "comfortable";
}) => (
    <div
        style={{
            display: "flex",
            gap: tokens.spacing[3],
            alignItems: "stretch",
            minHeight: 200,
        }}
    >
        {statuses.map((status) => {
            const columnTasks = tasks.filter((t) => t.statusId === status.id);
            return (
                <BoardColumn
                    key={status.id}
                    listId={listId}
                    status={status}
                    tasks={columnTasks}
                    density={density}
                />
            );
        })}
    </div>
);
