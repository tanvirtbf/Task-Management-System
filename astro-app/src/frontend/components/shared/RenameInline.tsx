import { useEffect, useRef, useState } from "react";
import { tokens } from "../../theme";

interface Props {
    initial: string;
    onSave: (next: string) => void;
    onCancel: () => void;
    placeholder?: string;
    size?: "sm" | "md";
}

/**
 * Compact inline rename input. Auto-selects on mount, submits on
 * Enter or blur, cancels on Esc.
 */
export const RenameInline = ({
    initial,
    onSave,
    onCancel,
    placeholder,
    size = "sm",
}: Props) => {
    const [value, setValue] = useState(initial);
    const ref = useRef<HTMLInputElement>(null);

    useEffect(() => {
        ref.current?.focus();
        ref.current?.select();
    }, []);

    const commit = () => {
        const v = value.trim();
        if (!v || v === initial) {
            onCancel();
            return;
        }
        onSave(v);
    };

    return (
        <input
            ref={ref}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={placeholder}
            onBlur={commit}
            onKeyDown={(e) => {
                if (e.key === "Enter") commit();
                else if (e.key === "Escape") onCancel();
                e.stopPropagation();
            }}
            style={{
                flex: 1,
                minWidth: 0,
                background: tokens.colors.bgSurface,
                border: `1px solid ${tokens.colors.primary}`,
                outline: "none",
                borderRadius: tokens.radius.sm,
                padding: size === "sm" ? "2px 6px" : "4px 8px",
                fontSize:
                    size === "sm"
                        ? tokens.typography.fontSize.sm
                        : tokens.typography.fontSize.base,
                color: tokens.colors.textPrimary,
                fontFamily: tokens.typography.fontFamily,
            }}
        />
    );
};
