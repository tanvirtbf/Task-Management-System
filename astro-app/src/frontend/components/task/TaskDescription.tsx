import { useEffect, useRef, useState } from "react";
import { Input, type GetRef } from "antd";
import { FileText } from "lucide-react";
import { TiptapEditor, TiptapReadOnly } from "../editor/TiptapEditor";
import { tokens } from "../../theme";

interface TaskDescriptionProps {
    description: string;
    onSave: (next: string) => void;
    /** When true, use rich-text editor (TipTap). Default: plain textarea. */
    rich?: boolean;
}

export const TaskDescription = ({
    description,
    onSave,
    rich,
}: TaskDescriptionProps) => {
    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState(description ?? "");
    const ref = useRef<GetRef<typeof Input.TextArea>>(null);

    useEffect(() => {
        setDraft(description ?? "");
    }, [description]);

    const commit = () => {
        if (draft !== description) onSave(draft);
        setEditing(false);
    };

    const cancel = () => {
        setDraft(description ?? "");
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
                rich ? (
                    <div>
                        <TiptapEditor
                            value={draft}
                            onChange={setDraft}
                            autoFocus
                        />
                        <div
                            style={{
                                display: "flex",
                                gap: 6,
                                justifyContent: "flex-end",
                                marginTop: 6,
                            }}
                        >
                            <button
                                onClick={cancel}
                                style={ghostBtn}
                            >
                                Cancel
                            </button>
                            <button
                                onClick={commit}
                                style={primaryBtn}
                            >
                                Save
                            </button>
                        </div>
                    </div>
                ) : (
                    <Input.TextArea
                        ref={ref}
                        autoFocus
                        autoSize={{ minRows: 4, maxRows: 16 }}
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        onBlur={commit}
                        onKeyDown={(e) => {
                            if (e.key === "Escape") cancel();
                            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                                commit();
                            }
                        }}
                        placeholder="Add a description... (Cmd+Enter to save)"
                    />
                )
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
                        whiteSpace: rich ? "normal" : "pre-wrap",
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
                        rich ? (
                            <TiptapReadOnly html={description} />
                        ) : (
                            description
                        )
                    ) : (
                        "Click to add a description."
                    )}
                </div>
            )}
        </div>
    );
};

const ghostBtn: React.CSSProperties = {
    background: "transparent",
    border: `1px solid ${tokens.colors.border}`,
    padding: "4px 12px",
    borderRadius: tokens.radius.sm,
    fontSize: tokens.typography.fontSize.sm,
    cursor: "pointer",
};

const primaryBtn: React.CSSProperties = {
    background: tokens.colors.primary,
    color: "#fff",
    border: 0,
    padding: "4px 12px",
    borderRadius: tokens.radius.sm,
    fontSize: tokens.typography.fontSize.sm,
    fontWeight: 600,
    cursor: "pointer",
};
