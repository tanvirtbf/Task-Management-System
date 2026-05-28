import { useEffect } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import Link from "@tiptap/extension-link";
import {
    Bold,
    Italic,
    Code,
    Code2,
    List,
    ListOrdered,
    Quote,
    Link2,
} from "lucide-react";
import { tokens } from "../../theme";

interface Props {
    value: string;
    onChange: (next: string) => void;
    placeholder?: string;
    autoFocus?: boolean;
    minHeight?: number;
}

/**
 * Lightweight rich-text editor for dev task descriptions + comments.
 * Markdown shortcuts via TipTap's StarterKit (`# heading`, `**bold**`,
 * `` ` `` for inline code, `` ``` `` for code block, `- ` for list, etc.).
 */
export const TiptapEditor = ({
    value,
    onChange,
    placeholder = "Write something…  Markdown shortcuts work: ** for bold, ` for code, ``` for code block.",
    autoFocus,
    minHeight = 120,
}: Props) => {
    const editor = useEditor({
        extensions: [
            StarterKit.configure({
                heading: { levels: [2, 3] },
            }),
            Placeholder.configure({ placeholder }),
            Link.configure({
                openOnClick: false,
                autolink: true,
                HTMLAttributes: {
                    style: `color: ${tokens.colors.primary}; text-decoration: underline;`,
                },
            }),
        ],
        content: value || "",
        autofocus: autoFocus,
        onUpdate: ({ editor: ed }) => onChange(ed.getHTML()),
    });

    useEffect(() => {
        if (editor && value !== editor.getHTML() && !editor.isFocused) {
            editor.commands.setContent(value || "");
        }
    }, [value, editor]);

    if (!editor) return null;

    const btn = (active: boolean): React.CSSProperties => ({
        background: active ? tokens.colors.primarySubtle : "transparent",
        color: active ? tokens.colors.primary : tokens.colors.textSecondary,
        border: 0,
        padding: 4,
        borderRadius: tokens.radius.sm,
        cursor: "pointer",
        display: "inline-flex",
        alignItems: "center",
    });

    return (
        <div
            style={{
                border: `1px solid ${tokens.colors.border}`,
                borderRadius: tokens.radius.md,
                background: tokens.colors.bgSurface,
                display: "flex",
                flexDirection: "column",
            }}
        >
            <div
                style={{
                    display: "flex",
                    gap: 2,
                    padding: 4,
                    borderBottom: `1px solid ${tokens.colors.borderSubtle}`,
                    flexWrap: "wrap",
                }}
            >
                <button
                    type="button"
                    title="Bold (⌘B)"
                    style={btn(editor.isActive("bold"))}
                    onClick={() => editor.chain().focus().toggleBold().run()}
                >
                    <Bold size={13} strokeWidth={1.75} />
                </button>
                <button
                    type="button"
                    title="Italic (⌘I)"
                    style={btn(editor.isActive("italic"))}
                    onClick={() => editor.chain().focus().toggleItalic().run()}
                >
                    <Italic size={13} strokeWidth={1.75} />
                </button>
                <button
                    type="button"
                    title="Inline code"
                    style={btn(editor.isActive("code"))}
                    onClick={() => editor.chain().focus().toggleCode().run()}
                >
                    <Code size={13} strokeWidth={1.75} />
                </button>
                <button
                    type="button"
                    title="Code block"
                    style={btn(editor.isActive("codeBlock"))}
                    onClick={() =>
                        editor.chain().focus().toggleCodeBlock().run()
                    }
                >
                    <Code2 size={13} strokeWidth={1.75} />
                </button>
                <button
                    type="button"
                    title="Bullet list"
                    style={btn(editor.isActive("bulletList"))}
                    onClick={() =>
                        editor.chain().focus().toggleBulletList().run()
                    }
                >
                    <List size={13} strokeWidth={1.75} />
                </button>
                <button
                    type="button"
                    title="Numbered list"
                    style={btn(editor.isActive("orderedList"))}
                    onClick={() =>
                        editor.chain().focus().toggleOrderedList().run()
                    }
                >
                    <ListOrdered size={13} strokeWidth={1.75} />
                </button>
                <button
                    type="button"
                    title="Quote"
                    style={btn(editor.isActive("blockquote"))}
                    onClick={() =>
                        editor.chain().focus().toggleBlockquote().run()
                    }
                >
                    <Quote size={13} strokeWidth={1.75} />
                </button>
                <button
                    type="button"
                    title="Link"
                    style={btn(editor.isActive("link"))}
                    onClick={() => {
                        const url = window.prompt(
                            "URL",
                            editor.getAttributes("link").href ?? "https://",
                        );
                        if (url === null) return;
                        if (url === "") {
                            editor
                                .chain()
                                .focus()
                                .extendMarkRange("link")
                                .unsetLink()
                                .run();
                        } else {
                            editor
                                .chain()
                                .focus()
                                .extendMarkRange("link")
                                .setLink({ href: url })
                                .run();
                        }
                    }}
                >
                    <Link2 size={13} strokeWidth={1.75} />
                </button>
            </div>
            <EditorContent
                editor={editor}
                className="tiptap-editor"
                style={{
                    padding: `${tokens.spacing[3]}px ${tokens.spacing[3]}px`,
                    minHeight,
                    fontSize: tokens.typography.fontSize.sm,
                    lineHeight: 1.5,
                }}
            />
            <style>{`
                .tiptap-editor .ProseMirror { outline: none; }
                .tiptap-editor .ProseMirror p.is-editor-empty:first-child::before {
                    content: attr(data-placeholder);
                    color: ${tokens.colors.textMuted};
                    float: left;
                    height: 0;
                    pointer-events: none;
                }
                .tiptap-editor .ProseMirror code {
                    background: ${tokens.colors.bgMuted};
                    padding: 1px 5px;
                    border-radius: 3px;
                    font-family: ${tokens.typography.fontFamilyMono};
                    font-size: 0.92em;
                }
                .tiptap-editor .ProseMirror pre {
                    background: #0F172A;
                    color: #E2E8F0;
                    padding: 10px 12px;
                    border-radius: 6px;
                    font-family: ${tokens.typography.fontFamilyMono};
                    font-size: 0.88em;
                    overflow-x: auto;
                }
                .tiptap-editor .ProseMirror pre code {
                    background: transparent;
                    color: inherit;
                    padding: 0;
                }
                .tiptap-editor .ProseMirror blockquote {
                    border-left: 3px solid ${tokens.colors.border};
                    padding-left: 12px;
                    margin: 8px 0;
                    color: ${tokens.colors.textSecondary};
                }
                .tiptap-editor .ProseMirror ul, .tiptap-editor .ProseMirror ol {
                    padding-left: 22px;
                    margin: 4px 0;
                }
                .tiptap-editor .ProseMirror h2 { font-size: 18px; font-weight: 700; margin: 12px 0 6px; }
                .tiptap-editor .ProseMirror h3 { font-size: 15px; font-weight: 700; margin: 10px 0 4px; }
            `}</style>
        </div>
    );
};

/**
 * Read-only renderer for displaying TipTap HTML output without editor chrome.
 */
export const TiptapReadOnly = ({ html }: { html: string }) => (
    <div
        className="tiptap-readonly"
        dangerouslySetInnerHTML={{ __html: html }}
        style={{
            fontSize: tokens.typography.fontSize.sm,
            lineHeight: 1.5,
            color: tokens.colors.textPrimary,
        }}
    />
);
