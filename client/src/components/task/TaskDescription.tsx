import { useEffect, useState } from "react";
import { Button } from "antd";
import { FileText, Pencil, X, Check } from "lucide-react";
import { TiptapEditor } from "../editor/TiptapEditor";
import { tokens } from "../../theme";

interface TaskDescriptionProps {
    /** TipTap JSON or legacy string. */
    description: unknown;
    onSave: (next: unknown) => void;
}

const isEmpty = (description: unknown): boolean => {
    if (!description) return true;
    if (typeof description === "string") return description.trim() === "";
    if (typeof description === "object") {
        const doc = description as { content?: Array<{ content?: unknown[] }> };
        if (!doc.content || doc.content.length === 0) return true;
        const onlyEmptyPara = doc.content.every(
            (n) => !n.content || n.content.length === 0,
        );
        return onlyEmptyPara;
    }
    return true;
};

export const TaskDescription = ({
    description,
    onSave,
}: TaskDescriptionProps) => {
    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState<unknown>(description);

    useEffect(() => {
        setDraft(description);
    }, [description]);

    const commit = () => {
        if (JSON.stringify(draft) !== JSON.stringify(description)) {
            onSave(draft);
        }
        setEditing(false);
    };
    const cancel = () => {
        setDraft(description);
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
                {!editing && (
                    <Button
                        size="small"
                        type="text"
                        icon={<Pencil size={11} strokeWidth={1.75} />}
                        onClick={() => setEditing(true)}
                        style={{
                            marginLeft: "auto",
                            height: 20,
                            padding: "0 6px",
                        }}
                    >
                        Edit
                    </Button>
                )}
                {editing && (
                    <span
                        style={{
                            marginLeft: "auto",
                            display: "inline-flex",
                            gap: 4,
                        }}
                    >
                        <Button
                            size="small"
                            type="text"
                            icon={<X size={11} strokeWidth={1.75} />}
                            onClick={cancel}
                            style={{ height: 20, padding: "0 6px" }}
                        >
                            Cancel
                        </Button>
                        <Button
                            size="small"
                            type="primary"
                            icon={<Check size={11} strokeWidth={1.75} />}
                            onClick={commit}
                            style={{ height: 20, padding: "0 8px" }}
                        >
                            Save
                        </Button>
                    </span>
                )}
            </div>

            {editing ? (
                <TiptapEditor
                    content={draft}
                    onChange={(json) => setDraft(json)}
                    placeholder="Describe this task… **bold**, lists, links — Markdown shortcuts work."
                    autofocus
                    minHeight={120}
                />
            ) : isEmpty(description) ? (
                <div
                    onClick={() => setEditing(true)}
                    style={{
                        minHeight: 60,
                        padding: tokens.spacing[3],
                        borderRadius: tokens.radius.md,
                        border: `1px dashed ${tokens.colors.border}`,
                        cursor: "text",
                        color: tokens.colors.textMuted,
                        fontSize: tokens.typography.fontSize.sm,
                        lineHeight: 1.6,
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
                    Click to add a description. Use **bold**, lists, links, or
                    @-mention teammates.
                </div>
            ) : (
                <div
                    onClick={() => setEditing(true)}
                    style={{
                        cursor: "text",
                        padding: tokens.spacing[2],
                        borderRadius: tokens.radius.md,
                        transition: "background var(--transition-base)",
                    }}
                    onMouseEnter={(e) =>
                        (e.currentTarget.style.background =
                            tokens.colors.bgHover)
                    }
                    onMouseLeave={(e) =>
                        (e.currentTarget.style.background = "transparent")
                    }
                >
                    <TiptapEditor
                        content={description}
                        onChange={() => {}}
                        readonly
                    />
                </div>
            )}
        </div>
    );
};
