import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Input } from "antd";
import type { Status, Task } from "../../types";
import { tokens } from "../../theme";

interface CalendarDayPopoverProps {
    day: Date;
    tasks: Task[];
    statusMap: Map<string, Status>;
    /** Create a task on this day. The parent owns the mutation + query
     *  invalidation, so the list below refreshes on its own. */
    onCreateTask: (name: string) => void;
    /** Close the popover (called after a task is opened). */
    onClose: () => void;
}

/**
 * The "+N more" day panel (Google-Calendar style). Lists EVERY task due on the
 * day — not the 3 the cell can fit — so clicking "+N more" reveals the whole
 * day instead of, as it used to, opening the quick-create modal. Clicking a
 * task opens it in the drawer (the same `?task=` param the event chips use);
 * the footer input still lets the person add a task to this day without
 * leaving the panel.
 */
export const CalendarDayPopover = ({
    day,
    tasks,
    statusMap,
    onCreateTask,
    onClose,
}: CalendarDayPopoverProps) => {
    const [, setSearchParams] = useSearchParams();
    const [name, setName] = useState("");

    const openTask = (taskId: string) => {
        setSearchParams((prev) => {
            const next = new URLSearchParams(prev);
            next.set("task", taskId);
            return next;
        });
        onClose();
    };

    const submit = () => {
        const trimmed = name.trim();
        if (!trimmed) return;
        onCreateTask(trimmed);
        setName(""); // stay open so several tasks can be added in a row
    };

    return (
        // Stop clicks bubbling up the React tree to the day cell. antd renders
        // this content in a portal, but React still bubbles synthetic events
        // through the component tree — without this, opening a task or typing in
        // the footer would also fire the cell's quick-create handler.
        <div
            onClick={(e) => e.stopPropagation()}
            style={{ width: 300, display: "flex", flexDirection: "column" }}
        >
            {/* Header — the full date + how many tasks are due */}
            <div
                style={{
                    display: "flex",
                    alignItems: "baseline",
                    justifyContent: "space-between",
                    gap: 8,
                    padding: "2px 2px 8px",
                    borderBottom: `1px solid ${tokens.colors.borderSubtle}`,
                }}
            >
                <span
                    style={{
                        fontSize: tokens.typography.fontSize.sm,
                        fontWeight: 600,
                        color: tokens.colors.textPrimary,
                    }}
                >
                    {day.toLocaleDateString("en-US", {
                        weekday: "long",
                        month: "long",
                        day: "numeric",
                    })}
                </span>
                <span
                    style={{
                        fontSize: 11,
                        color: tokens.colors.textMuted,
                        fontFamily: tokens.typography.fontFamilyMono,
                        whiteSpace: "nowrap",
                    }}
                >
                    {tasks.length} {tasks.length === 1 ? "task" : "tasks"}
                </span>
            </div>

            {/* All tasks for the day — scrolls when there are many */}
            <div
                style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 2,
                    maxHeight: 280,
                    overflowY: "auto",
                    padding: "8px 0",
                }}
            >
                {tasks.length === 0 ? (
                    <div
                        style={{
                            fontSize: tokens.typography.fontSize.sm,
                            color: tokens.colors.textMuted,
                            padding: "6px 4px",
                        }}
                    >
                        No tasks on this day yet.
                    </div>
                ) : (
                    tasks.map((task) => {
                        const status = statusMap.get(task.statusId);
                        const color = status?.color ?? tokens.colors.border;
                        return (
                            <button
                                key={task.id}
                                type="button"
                                onClick={() => openTask(task.id)}
                                title={task.name}
                                style={{
                                    display: "flex",
                                    alignItems: "center",
                                    gap: 8,
                                    width: "100%",
                                    textAlign: "left",
                                    border: "none",
                                    background: "transparent",
                                    borderRadius: tokens.radius.sm,
                                    padding: "6px 8px",
                                    cursor: "pointer",
                                    fontSize: tokens.typography.fontSize.sm,
                                    color: tokens.colors.textPrimary,
                                    transition: "background var(--transition-base)",
                                }}
                                onMouseEnter={(e) => {
                                    e.currentTarget.style.background =
                                        tokens.colors.bgHover;
                                }}
                                onMouseLeave={(e) => {
                                    e.currentTarget.style.background =
                                        "transparent";
                                }}
                            >
                                <span
                                    aria-hidden
                                    style={{
                                        width: 8,
                                        height: 8,
                                        borderRadius: "50%",
                                        background: color,
                                        flexShrink: 0,
                                    }}
                                />
                                <span
                                    style={{
                                        overflow: "hidden",
                                        textOverflow: "ellipsis",
                                        whiteSpace: "nowrap",
                                        flex: 1,
                                        minWidth: 0,
                                    }}
                                >
                                    {task.name}
                                </span>
                                {status && (
                                    <span
                                        style={{
                                            fontSize: 10,
                                            color: tokens.colors.textMuted,
                                            whiteSpace: "nowrap",
                                            flexShrink: 0,
                                        }}
                                    >
                                        {status.name}
                                    </span>
                                )}
                            </button>
                        );
                    })
                )}
            </div>

            {/* Add a task to this day without leaving the panel */}
            <div
                style={{
                    paddingTop: 8,
                    borderTop: `1px solid ${tokens.colors.borderSubtle}`,
                }}
            >
                <Input
                    size="small"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    onPressEnter={submit}
                    placeholder="+ Add a task on this day…"
                    aria-label="Add a task on this day"
                />
            </div>
        </div>
    );
};
