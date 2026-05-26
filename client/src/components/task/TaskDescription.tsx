import { useEffect, useRef, useState } from "react";
import { Input } from "antd";
import { FileText } from "lucide-react";
import { MentionRenderer } from "./MentionRenderer";
import { tokens } from "../../theme";

interface TaskDescriptionProps {
    description: string;
    onSave: (next: string) => void;
}

export const TaskDescription = ({
    description,
    onSave,
}: TaskDescriptionProps) => {
    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState(description);
    const ref = useRef<HTMLTextAreaElement>(null);

    useEffect(() => {
        setDraft(description);
    }, [description]);

    const commit = () => {
        if (draft !== description) onSave(draft);
        setEditing(false);
    };

    return (
        <div
            style={{
                padding: `${tokens.spacing[4]}px ${tokens.spacing[5]}px`,
                borderBottom: `1px solid ${tokens.colors.borderSubtle}`,
            }}
        >
            <div
                style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    marginBottom: tokens.spacing[2],
                    fontSize: 11,
                    fontWeight: 600,
                    textTransform: "uppercase",
                    letterSpacing: "0.05em",
                    color: tokens.colors.textMuted,
                }}
            >
                <FileText size={11} strokeWidth={1.75} />
                Description
            </div>
            {editing ? (
                <Input.TextArea
                    ref={ref}
                    autoFocus
                    autoSize={{ minRows: 4, maxRows: 16 }}
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onBlur={commit}
                    onKeyDown={(e) => {
                        if (e.key === "Escape") {
                            setDraft(description);
                            setEditing(false);
                        }
                        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                            commit();
                        }
                    }}
                    placeholder="Add a description... (Cmd+Enter to save)"
                />
            ) : (
                <div
                    onClick={() => setEditing(true)}
                    style={{
                        minHeight: 60,
                        padding: tokens.spacing[3],
                        borderRadius: tokens.radius.md,
                        border: `1px dashed ${tokens.colors.border}`,
                        cursor: "text",
                        color: description
                            ? tokens.colors.textPrimary
                            : tokens.colors.textMuted,
                        fontSize: tokens.typography.fontSize.sm,
                        lineHeight: 1.6,
                        whiteSpace: "pre-wrap",
                        background: tokens.colors.bgPage,
                        transition: "border var(--transition-base)",
                    }}
                    onMouseEnter={(e) =>
                        (e.currentTarget.style.borderColor =
                            tokens.colors.borderStrong)
                    }
                    onMouseLeave={(e) =>
                        (e.currentTarget.style.borderColor =
                            tokens.colors.border)
                    }
                >
                    {description ? (
                        <MentionRenderer text={description} />
                    ) : (
                        "Click to add a description. Use @name to mention a teammate."
                    )}
                </div>
            )}
        </div>
    );
};
