import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Avatar } from "../ui/Avatar";
import { PriorityFlag } from "../ui/PriorityFlag";
import { tokens } from "../../theme";
import type { SubgroupBy } from "../../stores/board";
import type { Priority, User } from "../../types";

interface BoardSwimlaneProps {
    subgroupBy: SubgroupBy;
    /** Key — "u-001" (user id) | "1" (priority) | "unassigned" | "none" */
    key_: string;
    label: string;
    user?: User;
    priority?: Priority;
    count: number;
    children: React.ReactNode;
}

export const BoardSwimlane = ({
    subgroupBy,
    label,
    user,
    priority,
    count,
    children,
}: BoardSwimlaneProps) => {
    const [collapsed, setCollapsed] = useState(false);

    return (
        <div
            style={{
                display: "flex",
                flexDirection: "column",
                gap: 8,
                paddingBottom: tokens.spacing[4],
            }}
        >
            <button
                onClick={() => setCollapsed(!collapsed)}
                aria-label={collapsed ? "Expand swimlane" : "Collapse swimlane"}
                style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "6px 8px",
                    background: tokens.colors.bgMuted,
                    border: 0,
                    borderRadius: tokens.radius.md,
                    cursor: "pointer",
                    position: "sticky",
                    left: tokens.spacing[6],
                    width: "fit-content",
                    zIndex: 1,
                    minWidth: 200,
                }}
            >
                {collapsed ? (
                    <ChevronRight
                        size={14}
                        strokeWidth={2}
                        color={tokens.colors.textMuted}
                    />
                ) : (
                    <ChevronDown
                        size={14}
                        strokeWidth={2}
                        color={tokens.colors.textMuted}
                    />
                )}

                {subgroupBy === "assignee" && user && (
                    <Avatar
                        name={`${user.firstName} ${user.lastName}`}
                        src={user.avatarUrl}
                        size={20}
                    />
                )}
                {subgroupBy === "priority" && priority !== undefined && (
                    <PriorityFlag priority={priority} size={13} />
                )}

                <span
                    style={{
                        fontWeight: 600,
                        fontSize: tokens.typography.fontSize.sm,
                        color: tokens.colors.textPrimary,
                    }}
                >
                    {label}
                </span>
                <span
                    style={{
                        fontSize: 11,
                        fontWeight: 600,
                        fontFamily: tokens.typography.fontFamilyMono,
                        color: tokens.colors.textMuted,
                        background: tokens.colors.bgSurface,
                        padding: "1px 6px",
                        borderRadius: 9,
                    }}
                >
                    {count}
                </span>
            </button>

            {!collapsed && children}
        </div>
    );
};

