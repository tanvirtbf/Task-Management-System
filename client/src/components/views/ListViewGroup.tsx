import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { useDroppable } from "@dnd-kit/core";
import type { Status, Task } from "../../types";
import { ListViewRow } from "./ListViewRow";
import { QuickCreateTaskInput } from "./QuickCreateTaskInput";
import { StatusPill } from "../ui/StatusPill";
import { tokens } from "../../theme";

interface ListViewGroupProps {
    status: Status;
    tasks: Task[];
    listId: string;
    selectedIds: Set<string>;
    onSelectToggle: (
        id: string,
        opts: { shift: boolean; ctrl: boolean },
    ) => void;
    onArchive: (id: string) => void;
    onDelete: (id: string) => void;
}

export const ListViewGroup = ({
    status,
    tasks,
    listId,
    selectedIds,
    onSelectToggle,
    onArchive,
    onDelete,
}: ListViewGroupProps) => {
    const [collapsed, setCollapsed] = useState(false);
    const { setNodeRef, isOver } = useDroppable({
        id: `group:${status.id}`,
        data: { type: "group", statusId: status.id },
    });
    const taskIds = tasks.map((t) => t.id);

    return (
        <div
            style={{
                display: "flex",
                flexDirection: "column",
            }}
        >
            {/* Group header */}
            <div
                style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    padding: "10px 12px 6px",
                    background: tokens.colors.bgPage,
                    position: "sticky",
                    top: 0,
                    zIndex: 1,
                }}
            >
                <button
                    onClick={() => setCollapsed(!collapsed)}
                    aria-label={collapsed ? "Expand group" : "Collapse group"}
                    style={{
                        background: "none",
                        border: 0,
                        padding: 2,
                        borderRadius: tokens.radius.sm,
                        cursor: "pointer",
                        color: tokens.colors.textMuted,
                        display: "flex",
                    }}
                >
                    {collapsed ? (
                        <ChevronRight size={14} strokeWidth={2} />
                    ) : (
                        <ChevronDown size={14} strokeWidth={2} />
                    )}
                </button>
                <StatusPill status={status} variant="filled" size="sm" />
                <span
                    style={{
                        fontSize: 11,
                        color: tokens.colors.textMuted,
                        fontFamily: tokens.typography.fontFamilyMono,
                        fontWeight: 600,
                    }}
                >
                    {tasks.length}
                </span>
            </div>

            {/* Rows */}
            {!collapsed && (
                <div
                    ref={setNodeRef}
                    style={{
                        background: tokens.colors.bgSurface,
                        border: `1px solid ${
                            isOver ? tokens.colors.primary : tokens.colors.border
                        }`,
                        borderRadius: tokens.radius.lg,
                        margin: "0 12px",
                        overflow: "hidden",
                        transition: "border-color var(--transition-base)",
                    }}
                >
                    <SortableContext
                        items={taskIds}
                        strategy={verticalListSortingStrategy}
                    >
                        {tasks.map((task) => (
                            <ListViewRow
                                key={task.id}
                                task={task}
                                listId={listId}
                                isSelected={selectedIds.has(task.id)}
                                onSelectToggle={onSelectToggle}
                                onArchive={() => onArchive(task.id)}
                                onDelete={() => onDelete(task.id)}
                            />
                        ))}
                    </SortableContext>
                    <QuickCreateTaskInput
                        listId={listId}
                        statusId={status.id}
                        placeholder={`Add task in ${status.name}`}
                    />
                </div>
            )}
        </div>
    );
};
