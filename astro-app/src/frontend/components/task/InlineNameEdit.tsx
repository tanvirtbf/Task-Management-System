import { useEffect, useRef, useState } from "react";
import { tokens } from "../../theme";

interface InlineNameEditProps {
    value: string;
    onSave: (value: string) => void;
    size?: "sm" | "md" | "lg";
    placeholder?: string;
}

export const InlineNameEdit = ({
    value,
    onSave,
    size = "sm",
    placeholder,
}: InlineNameEditProps) => {
    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState(value);
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (!editing) setDraft(value);
    }, [value, editing]);

    useEffect(() => {
        if (editing) inputRef.current?.focus();
    }, [editing]);

    const commit = () => {
        const trimmed = draft.trim();
        if (trimmed && trimmed !== value) {
            onSave(trimmed);
        } else {
            setDraft(value);
        }
        setEditing(false);
    };

    const cancel = () => {
        setDraft(value);
        setEditing(false);
    };

    const fontSize =
        size === "lg"
            ? tokens.typography.fontSize["2xl"]
            : size === "md"
              ? tokens.typography.fontSize.lg
              : tokens.typography.fontSize.sm;
    const fontWeight = size === "lg" ? 600 : 500;

    if (editing) {
        return (
            <input
                ref={inputRef}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={commit}
                onKeyDown={(e) => {
                    if (e.key === "Enter") {
                        e.preventDefault();
                        commit();
                    } else if (e.key === "Escape") {
                        e.preventDefault();
                        cancel();
                    }
                    e.stopPropagation();
                }}
                onClick={(e) => e.stopPropagation()}
                placeholder={placeholder}
                style={{
                    width: "100%",
                    fontSize,
                    fontWeight,
                    color: tokens.colors.textPrimary,
                    border: `1px solid ${tokens.colors.primary}`,
                    borderRadius: tokens.radius.sm,
                    padding: "2px 6px",
                    outline: "none",
                    background: tokens.colors.bgSurface,
                    fontFamily: tokens.typography.fontFamily,
                    letterSpacing: size === "lg" ? "-0.02em" : "normal",
                }}
            />
        );
    }

    return (
        <span
            role="button"
            tabIndex={0}
            aria-label="Edit task name"
            onClick={(e) => {
                e.stopPropagation();
                setEditing(true);
            }}
            onKeyDown={(e) => {
                if (e.key === "Enter") {
                    e.preventDefault();
                    e.stopPropagation();
                    setEditing(true);
                }
            }}
            style={{
                fontSize,
                fontWeight,
                color: tokens.colors.textPrimary,
                cursor: "text",
                padding: "2px 6px",
                margin: "-2px -6px",
                borderRadius: tokens.radius.sm,
                transition: "background var(--transition-base)",
                display: "inline-block",
                maxWidth: "100%",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                letterSpacing: size === "lg" ? "-0.02em" : "normal",
                lineHeight: 1.3,
            }}
            onMouseEnter={(e) =>
                (e.currentTarget.style.background = tokens.colors.bgHover)
            }
            onMouseLeave={(e) =>
                (e.currentTarget.style.background = "transparent")
            }
            title="Click to edit"
        >
            {value || placeholder}
        </span>
    );
};
