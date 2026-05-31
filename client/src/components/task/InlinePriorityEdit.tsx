import { useState } from "react";
import { Popover } from "antd";
import { Check } from "lucide-react";
import { PriorityFlag } from "../ui/PriorityFlag";
import { PRIORITY_LABELS, type Priority } from "../../types";
import { tokens } from "../../theme";

interface InlinePriorityEditProps {
    priority: Priority;
    onChange: (next: Priority) => void;
    size?: number;
}

const priorities: Priority[] = [1, 2, 3, 4, 0];

export const InlinePriorityEdit = ({
    priority,
    onChange,
    size = 14,
}: InlinePriorityEditProps) => {
    const [open, setOpen] = useState(false);

    const content = (
        <div
            style={{
                minWidth: 160,
                padding: 4,
                display: "flex",
                flexDirection: "column",
                gap: 2,
            }}
            onClick={(e) => e.stopPropagation()}
        >
            <div
                style={{
                    fontSize: 11,
                    color: tokens.colors.textMuted,
                    padding: "6px 8px 4px",
                    fontWeight: 500,
                    textTransform: "uppercase",
                    letterSpacing: "0.05em",
                }}
            >
                Priority
            </div>
            {priorities.map((p) => (
                <button
                    key={p}
                    onClick={() => {
                        onChange(p);
                        setOpen(false);
                    }}
                    style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        padding: "6px 8px",
                        background: "none",
                        border: 0,
                        borderRadius: tokens.radius.sm,
                        cursor: "pointer",
                        fontSize: tokens.typography.fontSize.sm,
                        textAlign: "left",
                        width: "100%",
                    }}
                    onMouseEnter={(e) =>
                        (e.currentTarget.style.background =
                            tokens.colors.bgHover)
                    }
                    onMouseLeave={(e) =>
                        (e.currentTarget.style.background = "transparent")
                    }
                >
                    <PriorityFlag priority={p} size={13} />
                    <span style={{ flex: 1 }}>{PRIORITY_LABELS[p]}</span>
                    {p === priority && (
                        <Check
                            size={14}
                            strokeWidth={2.25}
                            color={tokens.colors.primary}
                        />
                    )}
                </button>
            ))}
        </div>
    );

    return (
        <Popover
            content={content}
            trigger={["click"]}
            open={open}
            onOpenChange={setOpen}
            placement="bottomLeft"
            overlayInnerStyle={{ padding: 0 }}
        >
            <button
                onClick={(e) => {
                    e.stopPropagation();
                    setOpen(!open);
                }}
                style={{
                    background: "none",
                    border: 0,
                    padding: 4,
                    margin: -4,
                    borderRadius: tokens.radius.sm,
                    cursor: "pointer",
                    display: "inline-flex",
                    transition: "background var(--transition-base)",
                }}
                onMouseEnter={(e) =>
                    (e.currentTarget.style.background = tokens.colors.bgHover)
                }
                onMouseLeave={(e) =>
                    (e.currentTarget.style.background = "transparent")
                }
                title={`Priority: ${PRIORITY_LABELS[priority]}`}
            >
                <PriorityFlag priority={priority} size={size} />
            </button>
        </Popover>
    );
};
