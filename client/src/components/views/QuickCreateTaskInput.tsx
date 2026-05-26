import { useState, useRef, useEffect } from "react";
import { Plus } from "lucide-react";
import { useCreateTask } from "../../hooks/useTaskMutations";
import { tokens } from "../../theme";

interface QuickCreateTaskInputProps {
    listId: string;
    statusId?: string;
    placeholder?: string;
}

export const QuickCreateTaskInput = ({
    listId,
    statusId,
    placeholder = "Add a task...",
}: QuickCreateTaskInputProps) => {
    const [active, setActive] = useState(false);
    const [value, setValue] = useState("");
    const inputRef = useRef<HTMLInputElement>(null);
    const create = useCreateTask(listId);

    useEffect(() => {
        if (active) inputRef.current?.focus();
    }, [active]);

    const commit = () => {
        const trimmed = value.trim();
        if (trimmed) {
            create.mutate({
                primaryListId: listId,
                statusId,
                name: trimmed,
            });
            setValue("");
            // keep focused for chained creation
            inputRef.current?.focus();
        } else {
            setActive(false);
        }
    };

    if (!active) {
        return (
            <button
                onClick={() => setActive(true)}
                style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    background: "none",
                    border: 0,
                    padding: "8px 12px",
                    margin: "2px 8px",
                    borderRadius: tokens.radius.md,
                    color: tokens.colors.textMuted,
                    fontSize: tokens.typography.fontSize.sm,
                    cursor: "pointer",
                    width: "calc(100% - 16px)",
                    textAlign: "left",
                    transition: "all var(--transition-base)",
                }}
                onMouseEnter={(e) => {
                    e.currentTarget.style.background = tokens.colors.bgHover;
                    e.currentTarget.style.color = tokens.colors.textSecondary;
                }}
                onMouseLeave={(e) => {
                    e.currentTarget.style.background = "transparent";
                    e.currentTarget.style.color = tokens.colors.textMuted;
                }}
            >
                <Plus size={14} strokeWidth={1.75} />
                {placeholder}
            </button>
        );
    }

    return (
        <div
            style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                padding: "6px 12px",
                margin: "2px 8px",
                borderRadius: tokens.radius.md,
                border: `1px solid ${tokens.colors.primary}`,
                background: tokens.colors.bgSurface,
                boxShadow: tokens.shadows.focus,
            }}
        >
            <Plus
                size={14}
                strokeWidth={1.75}
                color={tokens.colors.primary}
                style={{ flexShrink: 0 }}
            />
            <input
                ref={inputRef}
                value={value}
                onChange={(e) => setValue(e.target.value)}
                onBlur={commit}
                onKeyDown={(e) => {
                    if (e.key === "Enter") {
                        e.preventDefault();
                        commit();
                    } else if (e.key === "Escape") {
                        e.preventDefault();
                        setValue("");
                        setActive(false);
                    }
                }}
                placeholder={placeholder}
                style={{
                    flex: 1,
                    border: 0,
                    outline: "none",
                    background: "transparent",
                    fontSize: tokens.typography.fontSize.sm,
                    fontFamily: tokens.typography.fontFamily,
                    color: tokens.colors.textPrimary,
                    padding: 0,
                }}
            />
            <span
                style={{
                    fontSize: 10,
                    color: tokens.colors.textMuted,
                    fontFamily: tokens.typography.fontFamilyMono,
                }}
            >
                ↵ to save · Esc to cancel
            </span>
        </div>
    );
};
