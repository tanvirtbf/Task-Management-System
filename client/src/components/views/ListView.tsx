import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
    DndContext,
    DragOverlay,
    PointerSensor,
    useSensor,
    useSensors,
    closestCenter,
    type DragEndEvent,
    type DragStartEvent,
} from "@dnd-kit/core";
import { ListChecks } from "lucide-react";
import { mockApi } from "../../lib/mock-api";
import { useAuthStore } from "../../stores/auth";
import { statusesByList } from "../../mocks/statuses";
import { useMultiSelect } from "../../hooks/useMultiSelect";
import {
    useArchiveTask,
    useDeleteTask,
    useUpdateTask,
} from "../../hooks/useTaskMutations";
import { EmptyState } from "../ui/EmptyState";
import { ListViewToolbar, type GroupBy } from "./ListViewToolbar";
import { ListViewGroup } from "./ListViewGroup";
import { ListViewRow } from "./ListViewRow";
import { BulkActionToolbar } from "../task/BulkActionToolbar";
import { tokens } from "../../theme";
import type { Task } from "../../types";

interface ListViewProps {
    listId: string;
}

export const ListView = ({ listId }: ListViewProps) => {
    const user = useAuthStore((s) => s.user);
    const [groupBy, setGroupBy] = useState<GroupBy>("status");
    const [search, setSearch] = useState("");
    const [meMode, setMeMode] = useState(false);
    const [showClosedTasks, setShowClosedTasks] = useState(false);
    const [activeDragTask, setActiveDragTask] = useState<Task | null>(null);

    const { data: tasks = [], isLoading } = useQuery({
        queryKey: ["tasks-by-list", listId],
        queryFn: () => mockApi.tasks.listByList(listId),
    });

    const statuses = useMemo(() => statusesByList(listId), [listId]);
    const update = useUpdateTask(listId);
    const archive = useArchiveTask(listId);
    const del = useDeleteTask(listId);

    // Apply filters: search, me-mode, closed
    const filteredTasks = useMemo(() => {
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
        if (search.trim()) {
            const q = search.toLowerCase();
            result = result.filter(
                (t) =>
                    t.name.toLowerCase().includes(q) ||
                    t.customId?.toLowerCase().includes(q),
            );
        }
        return result;
    }, [tasks, statuses, showClosedTasks, meMode, search, user]);

    // Group tasks
    const grouped = useMemo(() => {
        if (groupBy === "none") {
            return [{ status: statuses[0], tasks: filteredTasks }];
        }
        if (groupBy === "status") {
            return statuses.map((status) => ({
                status,
                tasks: filteredTasks.filter((t) => t.statusId === status.id),
            }));
        }
        // Other groupings — keep simple for Phase 3
        return statuses.map((status) => ({
            status,
            tasks: filteredTasks.filter((t) => t.statusId === status.id),
        }));
    }, [filteredTasks, statuses, groupBy]);

    const allVisibleIds = useMemo(
        () => filteredTasks.map((t) => t.id),
        [filteredTasks],
    );
    const selection = useMultiSelect(allVisibleIds);

    const sensors = useSensors(
        useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    );

    const handleDragStart = (event: DragStartEvent) => {
        const task = tasks.find((t) => t.id === event.active.id);
        setActiveDragTask(task ?? null);
    };

    const handleDragEnd = (event: DragEndEvent) => {
        setActiveDragTask(null);
        const { active, over } = event;
        if (!over) return;

        const draggedTask = tasks.find((t) => t.id === active.id);
        if (!draggedTask) return;

        // Dropped on a group? Change status.
        const overId = String(over.id);
        if (overId.startsWith("group:")) {
            const newStatusId = overId.slice("group:".length);
            if (draggedTask.statusId !== newStatusId) {
                update.mutate({
                    id: draggedTask.id,
                    patch: { statusId: newStatusId },
                });
            }
            return;
        }

        // Dropped on another task — if different status, move groups
        const targetTask = tasks.find((t) => t.id === overId);
        if (targetTask && draggedTask.statusId !== targetTask.statusId) {
            update.mutate({
                id: draggedTask.id,
                patch: { statusId: targetTask.statusId },
            });
        }
    };

    if (isLoading) {
        return (
            <div style={{ padding: tokens.spacing[8], textAlign: "center" }}>
                Loading tasks...
            </div>
        );
    }

    const hasAnyTasks = tasks.length > 0;
    const hasFilteredTasks = filteredTasks.length > 0;

    return (
        <>
            <ListViewToolbar
                groupBy={groupBy}
                onGroupByChange={setGroupBy}
                search={search}
                onSearchChange={setSearch}
                meMode={meMode}
                onMeModeChange={setMeMode}
                showClosedTasks={showClosedTasks}
                onShowClosedChange={setShowClosedTasks}
                activeFilterCount={meMode ? 1 : 0}
            />

            <div
                style={{
                    padding: `${tokens.spacing[3]}px 0 ${tokens.spacing[10]}px`,
                    display: "flex",
                    flexDirection: "column",
                    gap: tokens.spacing[3],
                }}
            >
                {!hasAnyTasks ? (
                    <EmptyState
                        icon={ListChecks}
                        title="No tasks yet"
                        description="Create your first task by typing in the inputs below each status."
                    />
                ) : !hasFilteredTasks ? (
                    <EmptyState
                        icon={ListChecks}
                        title="No tasks match your filters"
                        description="Try clearing search or toggling Me Mode."
                    />
                ) : (
                    <DndContext
                        sensors={sensors}
                        collisionDetection={closestCenter}
                        onDragStart={handleDragStart}
                        onDragEnd={handleDragEnd}
                    >
                        {grouped
                            .filter((g) => g.tasks.length > 0 || groupBy === "status")
                            .map(({ status, tasks: groupTasks }) =>
                                status ? (
                                    <ListViewGroup
                                        key={status.id}
                                        status={status}
                                        tasks={groupTasks}
                                        listId={listId}
                                        selectedIds={selection.selected}
                                        onSelectToggle={selection.toggle}
                                        onArchive={(id) => archive.mutate(id)}
                                        onDelete={(id) => del.mutate(id)}
                                    />
                                ) : null,
                            )}

                        <DragOverlay>
                            {activeDragTask && (
                                <div
                                    style={{
                                        background: tokens.colors.bgSurface,
                                        border: `1px solid ${tokens.colors.primary}`,
                                        borderRadius: tokens.radius.md,
                                        boxShadow: tokens.shadows.lg,
                                        cursor: "grabbing",
                                    }}
                                >
                                    <ListViewRow
                                        task={activeDragTask}
                                        listId={listId}
                                        isSelected={false}
                                        onSelectToggle={() => {}}
                                        onArchive={() => {}}
                                        onDelete={() => {}}
                                    />
                                </div>
                            )}
                        </DragOverlay>
                    </DndContext>
                )}
            </div>

            {selection.count > 0 && (
                <BulkActionToolbar
                    listId={listId}
                    selectedIds={selection.ids}
                    onClear={selection.clear}
                />
            )}
        </>
    );
};
