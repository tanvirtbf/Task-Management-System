import { useEffect } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import {
    Bold,
    Italic,
    Strikethrough,
    List,
    ListOrdered,
    Quote,
    Code,
    Link as LinkIcon,
    Heading1,
    Heading2,
    CheckSquare,
    Undo2,
    Redo2,
} from "lucide-react";
import { tokens } from "../../theme";

interface Props {
    /** TipTap JSON content (preferred) or HTML string. Empty string → blank doc. */
    content: unknown;
    onChange: (json: unknown, html: string) => void;
    placeholder?: string;
    autofocus?: boolean;
    /** Read-only render mode (no toolbar, not editable). */
    readonly?: boolean;
    /** Minimum editor body height. */
    minHeight?: number | string;
}

/**
 * Rich-text editor backed by TipTap. Stores TipTap JSON (preferred) but also
 * accepts an HTML string for migration from the legacy plain-text description.
 */
export const TiptapEditor = ({
    content,
    onChange,
    placeholder = "Write something...",
    autofocus = false,
    readonly = false,
    minHeight = 80,
}: Props) => {
    const initialContent = normaliseContent(content);

    const editor = useEditor({
        extensions: [
            StarterKit.configure({
                heading: { levels: [1, 2, 3] },
            }),
            Link.configure({
                openOnClick: false,
                autolink: true,
                HTMLAttributes: {
                    style: `color:${tokens.colors.primary};text-decoration:underline;`,
                },
            }),
            Placeholder.configure({ placeholder }),
        ],
        content: initialContent,
        editable: !readonly,
        autofocus,
        onUpdate: ({ editor: e }) => {
            onChange(e.getJSON(), e.getHTML());
        },
    });

    // Sync external content changes (e.g. switching between tasks)
    useEffect(() => {
        if (!editor) return;
        const next = normaliseContent(content);
        const current = editor.getJSON();
        if (JSON.stringify(current) !== JSON.stringify(next)) {
            editor.commands.setContent(next, { emitUpdate: false });
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [content]);

    if (!editor) return null;

    if (readonly) {
        return (
            <div className="tiptap-readonly">
                <EditorContent editor={editor} />
                <EditorStyles />
            </div>
        );
    }

    return (
        <div
            style={{
                border: `1px solid ${tokens.colors.border}`,
                borderRadius: tokens.radius.md,
                background: tokens.colors.bgSurface,
            }}
        >
            {/* Toolbar */}
            <div
                style={{
                    display: "flex",
                    flexWrap: "wrap",
                    gap: 2,
                    padding: 4,
                    borderBottom: `1px solid ${tokens.colors.borderSubtle}`,
                    background: tokens.colors.bgPage,
                    borderTopLeftRadius: tokens.radius.md,
                    borderTopRightRadius: tokens.radius.md,
                }}
            >
                <ToolBtn
                    onClick={() =>
                        editor.chain().focus().toggleHeading({ level: 1 }).run()
                    }
                    active={editor.isActive("heading", { level: 1 })}
                    label="Heading 1"
                >
                    <Heading1 size={14} strokeWidth={1.75} />
                </ToolBtn>
                <ToolBtn
                    onClick={() =>
                        editor.chain().focus().toggleHeading({ level: 2 }).run()
                    }
                    active={editor.isActive("heading", { level: 2 })}
                    label="Heading 2"
                >
                    <Heading2 size={14} strokeWidth={1.75} />
                </ToolBtn>
                <Divider />
                <ToolBtn
                    onClick={() => editor.chain().focus().toggleBold().run()}
                    active={editor.isActive("bold")}
                    label="Bold (⌘B)"
                >
                    <Bold size={14} strokeWidth={1.75} />
                </ToolBtn>
                <ToolBtn
                    onClick={() => editor.chain().focus().toggleItalic().run()}
                    active={editor.isActive("italic")}
                    label="Italic (⌘I)"
                >
                    <Italic size={14} strokeWidth={1.75} />
                </ToolBtn>
                <ToolBtn
                    onClick={() => editor.chain().focus().toggleStrike().run()}
                    active={editor.isActive("strike")}
                    label="Strikethrough"
                >
                    <Strikethrough size={14} strokeWidth={1.75} />
                </ToolBtn>
                <ToolBtn
                    onClick={() => editor.chain().focus().toggleCode().run()}
                    active={editor.isActive("code")}
                    label="Inline code"
                >
                    <Code size={14} strokeWidth={1.75} />
                </ToolBtn>
                <Divider />
                <ToolBtn
                    onClick={() =>
                        editor.chain().focus().toggleBulletList().run()
                    }
                    active={editor.isActive("bulletList")}
                    label="Bullet list"
                >
                    <List size={14} strokeWidth={1.75} />
                </ToolBtn>
                <ToolBtn
                    onClick={() =>
                        editor.chain().focus().toggleOrderedList().run()
                    }
                    active={editor.isActive("orderedList")}
                    label="Numbered list"
                >
                    <ListOrdered size={14} strokeWidth={1.75} />
                </ToolBtn>
                <ToolBtn
                    onClick={() =>
                        editor.chain().focus().toggleBlockquote().run()
                    }
                    active={editor.isActive("blockquote")}
                    label="Blockquote"
                >
                    <Quote size={14} strokeWidth={1.75} />
                </ToolBtn>
                <ToolBtn
                    onClick={() =>
                        editor.chain().focus().toggleCodeBlock().run()
                    }
                    active={editor.isActive("codeBlock")}
                    label="Code block"
                >
                    <CheckSquare size={14} strokeWidth={1.75} />
                </ToolBtn>
                <Divider />
                <ToolBtn
                    onClick={() => {
                        const url = window.prompt("Link URL", "https://");
                        if (url === null) return;
                        if (url === "") {
                            editor.chain().focus().unsetLink().run();
                            return;
                        }
                        editor
                            .chain()
                            .focus()
                            .extendMarkRange("link")
                            .setLink({ href: url })
                            .run();
                    }}
                    active={editor.isActive("link")}
                    label="Link"
                >
                    <LinkIcon size={14} strokeWidth={1.75} />
                </ToolBtn>
                <div style={{ flex: 1 }} />
                <ToolBtn
                    onClick={() => editor.chain().focus().undo().run()}
                    disabled={!editor.can().undo()}
                    label="Undo (⌘Z)"
                >
                    <Undo2 size={14} strokeWidth={1.75} />
                </ToolBtn>
                <ToolBtn
                    onClick={() => editor.chain().focus().redo().run()}
                    disabled={!editor.can().redo()}
                    label="Redo (⌘⇧Z)"
                >
                    <Redo2 size={14} strokeWidth={1.75} />
                </ToolBtn>
            </div>

            {/* Editor body */}
            <div
                onClick={() => editor.commands.focus()}
                style={{
                    padding: tokens.spacing[3],
                    minHeight,
                    cursor: "text",
                    fontSize: tokens.typography.fontSize.sm,
                    lineHeight: 1.6,
                    color: tokens.colors.textPrimary,
                }}
            >
                <EditorContent editor={editor} />
            </div>
            <EditorStyles />
        </div>
    );
};

const ToolBtn = ({
    onClick,
    active,
    disabled,
    label,
    children,
}: {
    onClick: () => void;
    active?: boolean;
    disabled?: boolean;
    label: string;
    children: React.ReactNode;
}) => (
    <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        title={label}
        aria-label={label}
        aria-pressed={active}
        style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: 26,
            height: 26,
            background: active ? tokens.colors.primarySubtle : "transparent",
            color: active
                ? tokens.colors.primary
                : disabled
                  ? tokens.colors.textDisabled
                  : tokens.colors.textSecondary,
            border: 0,
            borderRadius: tokens.radius.sm,
            cursor: disabled ? "not-allowed" : "pointer",
            transition: "all var(--transition-fast)",
        }}
        onMouseEnter={(e) => {
            if (!disabled && !active)
                e.currentTarget.style.background = tokens.colors.bgHover;
        }}
        onMouseLeave={(e) => {
            if (!active) e.currentTarget.style.background = "transparent";
        }}
    >
        {children}
    </button>
);

const Divider = () => (
    <div
        style={{
            width: 1,
            height: 18,
            margin: "4px 2px",
            background: tokens.colors.border,
        }}
    />
);

/** Editor stylesheet — applied globally because TipTap renders into shadow DOM-like structure */
const EditorStyles = () => (
    <style>{`
        .tiptap.ProseMirror { outline: none; min-height: inherit; }
        .tiptap.ProseMirror p { margin: 0 0 6px; }
        .tiptap.ProseMirror p:last-child { margin-bottom: 0; }
        .tiptap.ProseMirror h1 { font-size: 22px; font-weight: 700; margin: 12px 0 4px; }
        .tiptap.ProseMirror h2 { font-size: 18px; font-weight: 700; margin: 10px 0 4px; }
        .tiptap.ProseMirror h3 { font-size: 16px; font-weight: 600; margin: 8px 0 4px; }
        .tiptap.ProseMirror ul, .tiptap.ProseMirror ol { padding-left: 20px; margin: 4px 0 8px; }
        .tiptap.ProseMirror li { margin-bottom: 2px; }
        .tiptap.ProseMirror blockquote { border-left: 3px solid var(--color-border, #E5E7EB); padding-left: 10px; margin: 6px 0; color: var(--color-text-secondary, #475569); }
        .tiptap.ProseMirror code { background: var(--color-bg-muted, #F3F4F6); padding: 1px 5px; border-radius: 3px; font-family: ${tokens.typography.fontFamilyMono}; font-size: 0.9em; }
        .tiptap.ProseMirror pre { background: var(--color-bg-muted, #F3F4F6); padding: 10px; border-radius: 6px; font-family: ${tokens.typography.fontFamilyMono}; font-size: 0.9em; overflow-x: auto; }
        .tiptap.ProseMirror p.is-editor-empty:first-child::before {
            content: attr(data-placeholder);
            float: left;
            color: var(--color-text-muted, #94A3B8);
            pointer-events: none;
            height: 0;
        }
        .tiptap-readonly .tiptap.ProseMirror { cursor: default; }
    `}</style>
);

/** Accept either a TipTap JSON doc, an HTML string, or a plain string. */
const normaliseContent = (content: unknown): object | string => {
    if (!content) return "";
    if (typeof content === "string") return content;
    if (typeof content === "object" && (content as { type?: unknown }).type === "doc")
        return content as object;
    // Unknown shape — fall back to empty
    return "";
};
