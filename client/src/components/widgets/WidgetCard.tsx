import { Dropdown, type MenuProps } from "antd";
import {
    MoreHorizontal,
    Pencil,
    Trash2,
    Copy,
    GripVertical,
} from "lucide-react";
import { tokens } from "../../theme";
import type { DashboardWidget } from "../../types/dashboard";

interface Props {
    widget: DashboardWidget;
    /** Editing mode shows drag handle + menu */
    editing?: boolean;
    dragHandleProps?: Record<string, unknown>;
    onEdit?: () => void;
    onDuplicate?: () => void;
    onRemove?: () => void;
    /** Hide title bar — for the text widget */
    bare?: boolean;
    children: React.ReactNode;
}

export const WidgetCard = ({
    widget,
    editing = false,
    dragHandleProps,
    onEdit,
    onDuplicate,
    onRemove,
    bare = false,
    children,
}: Props) => {
    const menu: MenuProps["items"] = [
        {
            key: "edit",
            icon: <Pencil size={13} strokeWidth={1.75} />,
            label: "Edit widget",
            onClick: onEdit,
        },
        {
            key: "duplicate",
            icon: <Copy size={13} strokeWidth={1.75} />,
            label: "Duplicate",
            onClick: onDuplicate,
        },
        { type: "divider" },
        {
            key: "remove",
            icon: <Trash2 size={13} strokeWidth={1.75} />,
            label: "Remove",
            danger: true,
            onClick: onRemove,
        },
    ];

    return (
        <div
            style={{
                background: tokens.colors.bgSurface,
                border: `1px solid ${
                    editing
                        ? tokens.colors.primarySubtle
                        : tokens.colors.border
                }`,
                borderRadius: tokens.radius.lg,
                padding: bare ? 0 : tokens.spacing[3],
                display: "flex",
                flexDirection: "column",
                gap: bare ? 0 : tokens.spacing[2],
                height: "100%",
                overflow: "hidden",
                position: "relative",
                transition: "border-color var(--transition-fast)",
            }}
        >
            {!bare && (
                <div
                    style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                        flexShrink: 0,
                    }}
                >
                    {editing && (
                        <span
                            {...(dragHandleProps as object)}
                            style={{
                                cursor: "grab",
                                color: tokens.colors.textMuted,
                                padding: "2px 4px",
                                margin: "-2px -4px",
                                display: "inline-flex",
                            }}
                        >
                            <GripVertical
                                size={13}
                                strokeWidth={1.75}
                            />
                        </span>
                    )}
                    <h3
                        style={{
                            margin: 0,
                            fontSize: tokens.typography.fontSize.sm,
                            fontWeight: 600,
                            color: tokens.colors.textPrimary,
                            flex: 1,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                        }}
                    >
                        {widget.title}
                    </h3>
                    {editing && (
                        <Dropdown
                            menu={{ items: menu }}
                            trigger={["click"]}
                            placement="bottomRight"
                        >
                            <button
                                style={{
                                    background: "transparent",
                                    border: 0,
                                    padding: 4,
                                    borderRadius: tokens.radius.sm,
                                    color: tokens.colors.textMuted,
                                    cursor: "pointer",
                                    display: "inline-flex",
                                }}
                            >
                                <MoreHorizontal
                                    size={14}
                                    strokeWidth={1.75}
                                />
                            </button>
                        </Dropdown>
                    )}
                </div>
            )}
            <div
                style={{
                    flex: 1,
                    minHeight: 0,
                    overflow: "hidden",
                    display: "flex",
                    flexDirection: "column",
                }}
            >
                {children}
            </div>
        </div>
    );
};
