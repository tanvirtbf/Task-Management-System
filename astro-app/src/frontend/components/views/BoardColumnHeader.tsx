import { Dropdown, InputNumber, Popover } from "antd";
import {
    ChevronDown,
    ChevronRight,
    MoreHorizontal,
    Plus,
    Target,
    EyeOff,
} from "lucide-react";
import type { Status } from "../../types";
import { useBoardStore } from "../../stores/board";
import { BoardWipLimitBadge } from "./BoardWipLimitBadge";
import { tokens } from "../../theme";
import { useState } from "react";

interface BoardColumnHeaderProps {
    status: Status;
    count: number;
    listId: string;
    onAddTask: () => void;
    collapsed: boolean;
    onToggleCollapse: () => void;
}

export const BoardColumnHeader = ({
    status,
    count,
    listId,
    onAddTask,
    collapsed,
    onToggleCollapse,
}: BoardColumnHeaderProps) => {
    const wipLimit = useBoardStore(
        (s) => s.wipLimits[`${listId}:${status.id}`] ?? null,
    );
    const setWipLimit = useBoardStore((s) => s.setWipLimit);

    const isOverLimit =
        wipLimit !== null && wipLimit !== undefined && count > wipLimit;

    return (
        <div
            style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                padding: "8px 6px",
                background: tokens.colors.bgSurface,
                borderRadius: `${tokens.radius.md}px ${tokens.radius.md}px 0 0`,
                borderBottom: isOverLimit
                    ? `2px solid ${tokens.colors.danger}`
                    : "2px solid transparent",
            }}
        >
            <button
                onClick={onToggleCollapse}
                style={{
                    background: "none",
                    border: 0,
                    padding: 2,
                    cursor: "pointer",
                    color: tokens.colors.textMuted,
                    display: "flex",
                    flexShrink: 0,
                }}
            >
                {collapsed ? (
                    <ChevronRight size={14} strokeWidth={2} />
                ) : (
                    <ChevronDown size={14} strokeWidth={2} />
                )}
            </button>

            <span
                style={{
                    width: 8,
                    height: 8,
                    borderRadius: "50%",
                    background: status.color,
                    flexShrink: 0,
                }}
            />

            <span
                style={{
                    fontSize: tokens.typography.fontSize.sm,
                    fontWeight: 600,
                    color: tokens.colors.textPrimary,
                    flex: 1,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    textTransform: "uppercase",
                    letterSpacing: "0.02em",
                }}
                title={status.name}
            >
                {status.name}
            </span>

            <BoardWipLimitBadge current={count} limit={wipLimit} />

            <WipLimitMenu
                listId={listId}
                statusId={status.id}
                currentLimit={wipLimit}
                onChange={(l) => setWipLimit(listId, status.id, l)}
            />

            <button
                onClick={onAddTask}
                style={{
                    background: "none",
                    border: 0,
                    padding: 3,
                    cursor: "pointer",
                    color: tokens.colors.textMuted,
                    display: "flex",
                    borderRadius: tokens.radius.sm,
                    flexShrink: 0,
                }}
                title="Add task"
                onMouseEnter={(e) =>
                    (e.currentTarget.style.background = tokens.colors.bgHover)
                }
                onMouseLeave={(e) =>
                    (e.currentTarget.style.background = "transparent")
                }
            >
                <Plus size={14} strokeWidth={2} />
            </button>

            <Dropdown
                menu={{
                    items: [
                        {
                            key: "collapse",
                            label: "Collapse column",
                            icon: <EyeOff size={13} strokeWidth={1.75} />,
                            onClick: onToggleCollapse,
                        },
                    ],
                }}
                trigger={["click"]}
            >
                <button
                    style={{
                        background: "none",
                        border: 0,
                        padding: 3,
                        cursor: "pointer",
                        color: tokens.colors.textMuted,
                        display: "flex",
                        borderRadius: tokens.radius.sm,
                        flexShrink: 0,
                    }}
                    title="Column options"
                    onMouseEnter={(e) =>
                        (e.currentTarget.style.background =
                            tokens.colors.bgHover)
                    }
                    onMouseLeave={(e) =>
                        (e.currentTarget.style.background = "transparent")
                    }
                >
                    <MoreHorizontal size={14} strokeWidth={1.75} />
                </button>
            </Dropdown>
        </div>
    );
};

const WipLimitMenu = ({
    listId,
    statusId,
    currentLimit,
    onChange,
}: {
    listId: string;
    statusId: string;
    currentLimit: number | null;
    onChange: (limit: number | null) => void;
}) => {
    const [open, setOpen] = useState(false);
    const [draft, setDraft] = useState<number | null>(currentLimit);
    void listId;
    void statusId;

    return (
        <Popover
            open={open}
            onOpenChange={(v) => {
                setOpen(v);
                if (v) setDraft(currentLimit);
            }}
            trigger={["click"]}
            placement="bottom"
            content={
                <div style={{ width: 220 }}>
                    <div
                        style={{
                            fontSize: 11,
                            fontWeight: 600,
                            color: tokens.colors.textMuted,
                            marginBottom: 6,
                            textTransform: "uppercase",
                            letterSpacing: "0.05em",
                        }}
                    >
                        WIP Limit
                    </div>
                    <p
                        style={{
                            fontSize: 12,
                            color: tokens.colors.textSecondary,
                            margin: 0,
                            marginBottom: 8,
                            lineHeight: 1.4,
                        }}
                    >
                        Cap the number of tasks allowed in this column. Header
                        turns red when exceeded.
                    </p>
                    <InputNumber
                        value={draft ?? undefined}
                        onChange={(v) => setDraft(typeof v === "number" ? v : null)}
                        min={1}
                        max={999}
                        placeholder="No limit"
                        style={{ width: "100%" }}
                        autoFocus
                    />
                    <div
                        style={{
                            display: "flex",
                            justifyContent: "space-between",
                            marginTop: 8,
                            gap: 4,
                        }}
                    >
                        <button
                            onClick={() => {
                                onChange(null);
                                setOpen(false);
                            }}
                            style={{
                                background: "none",
                                border: 0,
                                padding: "4px 8px",
                                cursor: "pointer",
                                fontSize: 12,
                                color: tokens.colors.textMuted,
                                borderRadius: tokens.radius.sm,
                            }}
                        >
                            Remove
                        </button>
                        <button
                            onClick={() => {
                                onChange(draft);
                                setOpen(false);
                            }}
                            style={{
                                background: tokens.colors.primary,
                                color: "#fff",
                                border: 0,
                                padding: "4px 12px",
                                cursor: "pointer",
                                fontSize: 12,
                                fontWeight: 500,
                                borderRadius: tokens.radius.sm,
                            }}
                        >
                            Save
                        </button>
                    </div>
                </div>
            }
        >
            <button
                style={{
                    background: "none",
                    border: 0,
                    padding: 3,
                    cursor: "pointer",
                    color:
                        currentLimit !== null
                            ? tokens.colors.primary
                            : tokens.colors.textMuted,
                    display: "flex",
                    borderRadius: tokens.radius.sm,
                    flexShrink: 0,
                }}
                title="Set WIP limit"
                onMouseEnter={(e) =>
                    (e.currentTarget.style.background = tokens.colors.bgHover)
                }
                onMouseLeave={(e) =>
                    (e.currentTarget.style.background = "transparent")
                }
            >
                <Target size={13} strokeWidth={1.75} />
            </button>
        </Popover>
    );
};
