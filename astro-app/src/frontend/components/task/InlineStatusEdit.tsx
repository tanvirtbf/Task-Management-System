import { useState } from "react";
import { Popover } from "antd";
import { Check } from "lucide-react";
import { useStatuses } from "../../hooks/useReferenceData";
import { StatusPill } from "../ui/StatusPill";
import { tokens } from "../../theme";

interface InlineStatusEditProps {
    listId: string;
    statusId: string;
    onChange: (newStatusId: string) => void;
    size?: "sm" | "md";
}

export const InlineStatusEdit = ({
    listId,
    statusId,
    onChange,
    size = "sm",
}: InlineStatusEditProps) => {
    const [open, setOpen] = useState(false);
    const { data: options = [] } = useStatuses(listId);
    const current = options.find((s) => s.id === statusId);

    if (!current) return null;

    const content = (
        <div
            style={{
                minWidth: 200,
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
                Status
            </div>
            {options.map((s) => (
                <button
                    key={s.id}
                    onClick={() => {
                        onChange(s.id);
                        setOpen(false);
                    }}
                    style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
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
                    <StatusPill status={s} variant="subtle" size="sm" />
                    {s.id === statusId && (
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
                    padding: 0,
                    cursor: "pointer",
                    display: "inline-flex",
                }}
            >
                <StatusPill status={current} variant="subtle" size={size} />
            </button>
        </Popover>
    );
};
