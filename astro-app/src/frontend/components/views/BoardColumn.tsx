import { useRef, useState } from "react";
import { useDroppable } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { Plus } from "lucide-react";
import type { Status, Task } from "../../types";
import { BoardCard } from "./BoardCard";
import { BoardColumnHeader } from "./BoardColumnHeader";
import { useBoardStore, type CardDensity } from "../../stores/board";
import { useCreateTask } from "../../hooks/useTaskMutations";
import { tokens } from "../../theme";

// Stable reference returned by the Zustand selector when the per-list
// entry is missing — re-using a module-level constant prevents the
// "getSnapshot should be cached to avoid an infinite loop" warning
// that fires when a selector returns a fresh `[]` on every call.
const EMPTY_COLLAPSED: string[] = [];

interface BoardColumnProps {
    listId: string;
    status: Status;
    tasks: Task[];
    density: CardDensity;
}

export const BoardColumn = ({
    listId,
    status,
    tasks,
    density,
}: BoardColumnProps) => {
    const collapsedList = useBoardStore(
        (s) => s.collapsedColumns[listId] ?? EMPTY_COLLAPSED,
    );
    const toggleColumnCollapse = useBoardStore((s) => s.toggleColumnCollapse);
    const collapsed = collapsedList.includes(status.id);

    const { setNodeRef, isOver } = useDroppable({
        id: `column:${status.id}`,
        data: { type: "column", statusId: status.id },
    });

    const [adding, setAdding] = useState(false);
    const [draft, setDraft] = useState("");
    const inputRef = useRef<HTMLInputElement>(null);
    const create = useCreateTask(listId);

    const commit = () => {
        const v = draft.trim();
        if (v) {
            create.mutate({
                primaryListId: listId,
                statusId: status.id,
                name: v,
            });
            setDraft("");
            // chain create
            requestAnimationFrame(() => inputRef.current?.focus());
        } else {
            setAdding(false);
        }
    };

    if (collapsed) {
        return (
            <div
                style={{
                    width: 56,
                    flexShrink: 0,
                    background: tokens.colors.bgPage,
                    border: `1px solid ${tokens.colors.border}`,
                    borderRadius: tokens.radius.lg,
                    cursor: "pointer",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    padding: "10px 0",
                    gap: 8,
                }}
                onClick={() => toggleColumnCollapse(listId, status.id)}
                title={`${status.name} — click to expand`}
            >
                <span
                    style={{
                        width: 8,
                        height: 8,
                        borderRadius: "50%",
                        background: status.color,
                    }}
                />
                <span
                    style={{
                        writingMode: "vertical-rl" as const,
                        textOrientation: "mixed" as const,
                        fontSize: tokens.typography.fontSize.sm,
                        fontWeight: 600,
                        color: tokens.colors.textPrimary,
                        textTransform: "uppercase",
                        letterSpacing: "0.05em",
                    }}
                >
                    {status.name}
                </span>
                <span
                    style={{
                        fontSize: 11,
                        fontWeight: 600,
                        fontFamily: tokens.typography.fontFamilyMono,
                        color: tokens.colors.textMuted,
                        background: tokens.colors.bgMuted,
                        padding: "1px 6px",
                        borderRadius: 9,
                        marginTop: "auto",
                    }}
                >
                    {tasks.length}
                </span>
            </div>
        );
    }

    return (
        <div
            style={{
                width: 288,
                flexShrink: 0,
                background: tokens.colors.bgPage,
                border: `1px solid ${
                    isOver ? tokens.colors.primary : tokens.colors.border
                }`,
                borderRadius: tokens.radius.lg,
                display: "flex",
                flexDirection: "column",
                maxHeight: "100%",
                transition: "border-color var(--transition-base)",
            }}
        >
            <BoardColumnHeader
                status={status}
                count={tasks.length}
                listId={listId}
                onAddTask={() => {
                    setAdding(true);
                    requestAnimationFrame(() => inputRef.current?.focus());
                }}
                collapsed={false}
                onToggleCollapse={() => toggleColumnCollapse(listId, status.id)}
            />

            <div
                ref={setNodeRef}
                style={{
                    flex: 1,
                    minHeight: 60,
                    overflowY: "auto",
                    padding: 6,
                    display: "flex",
                    flexDirection: "column",
                    gap: 6,
                    background: isOver
                        ? tokens.colors.primarySubtle
                        : "transparent",
                    transition: "background var(--transition-base)",
                }}
            >
                <SortableContext
                    items={tasks.map((t) => t.id)}
                    strategy={verticalListSortingStrategy}
                >
                    {tasks.map((task) => (
                        <BoardCard
                            key={task.id}
                            task={task}
                            density={density}
                        />
                    ))}
                </SortableContext>

                {tasks.length === 0 && !adding && (
                    <div
                        style={{
                            padding: "20px 8px",
                            textAlign: "center",
                            fontSize: tokens.typography.fontSize.sm,
                            color: tokens.colors.textMuted,
                            border: `1px dashed ${tokens.colors.border}`,
                            borderRadius: tokens.radius.md,
                        }}
                    >
                        Drop tasks here
                    </div>
                )}

                {adding && (
                    <div
                        style={{
                            background: tokens.colors.bgSurface,
                            border: `1px solid ${tokens.colors.primary}`,
                            borderRadius: tokens.radius.md,
                            padding: 8,
                        }}
                    >
                        <textarea
                            ref={inputRef as unknown as React.RefObject<HTMLTextAreaElement>}
                            value={draft}
                            onChange={(e) => setDraft(e.target.value)}
                            onBlur={commit}
                            onKeyDown={(e) => {
                                if (e.key === "Enter" && !e.shiftKey) {
                                    e.preventDefault();
                                    commit();
                                } else if (e.key === "Escape") {
                                    setDraft("");
                                    setAdding(false);
                                }
                            }}
                            placeholder="Task name (Enter to save)"
                            rows={2}
                            style={{
                                width: "100%",
                                border: 0,
                                outline: "none",
                                resize: "none",
                                fontFamily: tokens.typography.fontFamily,
                                fontSize: tokens.typography.fontSize.sm,
                                color: tokens.colors.textPrimary,
                                background: "transparent",
                            }}
                        />
                    </div>
                )}
            </div>

            {!adding && (
                <button
                    onClick={() => {
                        setAdding(true);
                        requestAnimationFrame(() => inputRef.current?.focus());
                    }}
                    style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                        padding: "8px 12px",
                        background: "none",
                        border: 0,
                        borderTop: `1px solid ${tokens.colors.borderSubtle}`,
                        cursor: "pointer",
                        color: tokens.colors.textMuted,
                        fontSize: tokens.typography.fontSize.sm,
                        borderRadius: `0 0 ${tokens.radius.lg}px ${tokens.radius.lg}px`,
                        transition: "all var(--transition-base)",
                    }}
                    onMouseEnter={(e) => {
                        e.currentTarget.style.background =
                            tokens.colors.bgHover;
                        e.currentTarget.style.color =
                            tokens.colors.textSecondary;
                    }}
                    onMouseLeave={(e) => {
                        e.currentTarget.style.background = "transparent";
                        e.currentTarget.style.color = tokens.colors.textMuted;
                    }}
                >
                    <Plus size={13} strokeWidth={1.75} />
                    Add task
                </button>
            )}
        </div>
    );
};
