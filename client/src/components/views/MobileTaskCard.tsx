import { memo } from "react";
import { Dropdown, type MenuProps } from "antd";
import { MoreVertical } from "lucide-react";
import { StatusPill } from "../ui/StatusPill";
import { DueDateBadge } from "../ui/DueDateBadge";
import { PriorityFlag } from "../ui/PriorityFlag";
import { AssigneeStack } from "../ui/AssigneeStack";
import { tokens } from "../../theme";
import type { Status, Task, User } from "../../types";

/**
 * P4 of MOBILE_REBUILD_PLAN.md — one task, as a phone shows it.
 *
 * The list view crushed the task name to 12px because every other slot carried
 * `flexShrink: 0` and the name was the only thing that could give. The board's
 * cards, by contrast, already read perfectly at 390px with no work done to them
 * — which is why the mobile view is card-shaped rather than row-shaped (U1).
 *
 * The name gets the full width and two lines. Everything else sits underneath
 * on a second line, where it can be read instead of competing.
 *
 * ⚠️ CARD_HEIGHT is load-bearing: the list is virtualised (D10) and computes
 * every row's offset from it. Change the card's padding or type sizes and this
 * number has to move with them, or rows will drift out of place.
 */
export const CARD_HEIGHT = 84;
export const CARD_GAP = 8;

interface Props {
    task: Task;
    status?: Status;
    members: User[];
    onOpen: (task: Task) => void;
    /** Status / assignee / due changes — what replaced drag on a phone (D5). */
    menu: MenuProps;
}

export const MobileTaskCard = memo(
    ({ task, status, members, onOpen, menu }: Props) => {
        const assignees = members.filter((m) => task.assignees.includes(m.id));
        return (
            <div
                style={{
                    height: CARD_HEIGHT,
                    display: "flex",
                    alignItems: "stretch",
                    background: tokens.colors.bgSurface,
                    border: `1px solid ${tokens.colors.border}`,
                    borderRadius: tokens.radius.lg,
                    overflow: "hidden",
                }}
            >
                {/* The whole card is the tap target — 84px tall, so a thumb
                    cannot miss it, and it is the only gesture the card needs
                    now that drag is gone on mobile (D5). */}
                <button
                    onClick={() => onOpen(task)}
                    style={{
                        flex: 1,
                        minWidth: 0,
                        display: "flex",
                        flexDirection: "column",
                        justifyContent: "space-between",
                        alignItems: "stretch",
                        gap: 6,
                        padding: `${tokens.spacing[3]}px ${tokens.spacing[1]}px ${tokens.spacing[3]}px ${tokens.spacing[3]}px`,
                        background: "none",
                        border: "none",
                        cursor: "pointer",
                        textAlign: "left",
                        color: tokens.colors.textPrimary,
                    }}
                >
                    <span
                        style={{
                            display: "flex",
                            alignItems: "flex-start",
                            gap: 6,
                            minWidth: 0,
                        }}
                    >
                        {task.priority > 0 && (
                            <span style={{ flexShrink: 0, paddingTop: 1 }}>
                                <PriorityFlag priority={task.priority} size={13} />
                            </span>
                        )}
                        <span
                            style={{
                                flex: 1,
                                minWidth: 0,
                                fontSize: 15,
                                lineHeight: "19px",
                                fontWeight: 500,
                                display: "-webkit-box",
                                WebkitLineClamp: 2,
                                WebkitBoxOrient: "vertical",
                                overflow: "hidden",
                            }}
                        >
                            {task.name}
                        </span>
                    </span>

                    <span
                        style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 8,
                            minWidth: 0,
                        }}
                    >
                        {status && (
                            <span style={{ flexShrink: 0 }}>
                                <StatusPill status={status} size="sm" />
                            </span>
                        )}
                        {task.dueDate && (
                            <span style={{ flexShrink: 0 }}>
                                <DueDateBadge dueDate={task.dueDate} size="sm" />
                            </span>
                        )}
                        <span style={{ flex: 1 }} />
                        {assignees.length > 0 && (
                            <span style={{ flexShrink: 0 }}>
                                <AssigneeStack users={assignees} size={22} max={2} />
                            </span>
                        )}
                    </span>
                </button>

                {/* Status, assignee and due date used to change by dragging.
                    D5 removed drag on phones, so this menu is the replacement —
                    and at 44px wide it is the first control on this screen a
                    thumb can actually hit. */}
                <Dropdown menu={menu} trigger={["click"]} placement="bottomRight">
                <button
                    aria-label={`Actions for ${task.name}`}
                    onClick={(e) => e.stopPropagation()}
                    style={{
                        width: 44,
                        flexShrink: 0,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        background: "none",
                        border: "none",
                        borderLeft: `1px solid ${tokens.colors.borderSubtle}`,
                        cursor: "pointer",
                        color: tokens.colors.textMuted,
                    }}
                >
                    <MoreVertical size={18} strokeWidth={1.9} />
                </button>
                </Dropdown>
            </div>
        );
    },
);

MobileTaskCard.displayName = "MobileTaskCard";
