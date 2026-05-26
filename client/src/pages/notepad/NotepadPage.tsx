import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
    Button,
    Input,
    Empty,
    Dropdown,
    App as AntApp,
    Modal,
} from "antd";
import {
    Plus,
    Pin,
    PinOff,
    Search,
    StickyNote,
    Trash2,
    MoreHorizontal,
    Eye,
    Pencil,
    Palette,
} from "lucide-react";
import { mockApi } from "../../lib/mock-api";
import { useAuthStore } from "../../stores/auth";
import { MarkdownRenderer } from "../../components/notepad/MarkdownRenderer";
import { LoadingState } from "../../components/shared/LoadingState";
import { tokens } from "../../theme";
import type { Note } from "../../types/note";

const COLORS = [
    "#4F46E5",
    "#10B981",
    "#F59E0B",
    "#E11D48",
    "#8B5CF6",
    "#06B6D4",
    "#EC4899",
    "#64748B",
];

const formatTime = (iso: string): string => {
    const diff = Date.now() - new Date(iso).getTime();
    const m = Math.floor(diff / 60000);
    if (m < 1) return "just now";
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    return new Date(iso).toLocaleDateString();
};

const NotepadPage = () => {
    const user = useAuthStore((s) => s.user);
    const qc = useQueryClient();
    const { message } = AntApp.useApp();
    const [query, setQuery] = useState("");
    const [activeId, setActiveId] = useState<string | null>(null);
    const [previewMode, setPreviewMode] = useState(false);

    const { data: notes = [], isLoading } = useQuery({
        queryKey: ["notes", user?.id],
        queryFn: () =>
            user ? mockApi.notes.list(user.id) : Promise.resolve([]),
        enabled: !!user,
    });

    useEffect(() => {
        if (!activeId && notes.length > 0) setActiveId(notes[0].id);
    }, [notes, activeId]);

    const filtered = useMemo(() => {
        const q = query.trim().toLowerCase();
        if (!q) return notes;
        return notes.filter(
            (n) =>
                n.title.toLowerCase().includes(q) ||
                n.body.toLowerCase().includes(q),
        );
    }, [notes, query]);

    const pinned = filtered.filter((n) => n.isPinned);
    const others = filtered.filter((n) => !n.isPinned);
    const active = notes.find((n) => n.id === activeId) ?? null;

    const create = useMutation({
        mutationFn: () =>
            user
                ? mockApi.notes.create({ userId: user.id })
                : Promise.reject(),
        onSuccess: (n) => {
            qc.invalidateQueries({ queryKey: ["notes", user?.id] });
            setActiveId(n.id);
            setPreviewMode(false);
        },
    });

    const togglePin = useMutation({
        mutationFn: (id: string) => mockApi.notes.togglePin(id),
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ["notes", user?.id] });
        },
    });

    const remove = useMutation({
        mutationFn: (id: string) => mockApi.notes.delete(id),
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ["notes", user?.id] });
            if (activeId) {
                const remaining = notes.filter((n) => n.id !== activeId);
                setActiveId(remaining[0]?.id ?? null);
            }
            message.success("Note deleted");
        },
    });

    if (!user) return <div>Not signed in</div>;

    return (
        <div
            style={{
                display: "grid",
                gridTemplateColumns: "320px 1fr",
                height: "calc(100vh - 48px)",
                background: tokens.colors.bgPage,
            }}
        >
            {/* Note list */}
            <aside
                style={{
                    background: tokens.colors.bgSurface,
                    borderRight: `1px solid ${tokens.colors.border}`,
                    display: "flex",
                    flexDirection: "column",
                    overflow: "hidden",
                }}
            >
                <div
                    style={{
                        padding: tokens.spacing[3],
                        borderBottom: `1px solid ${tokens.colors.border}`,
                        display: "flex",
                        flexDirection: "column",
                        gap: 8,
                    }}
                >
                    <div
                        style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 8,
                        }}
                    >
                        <h2
                            style={{
                                margin: 0,
                                fontSize: tokens.typography.fontSize.lg,
                                fontWeight: 700,
                                flex: 1,
                            }}
                        >
                            Notepad
                        </h2>
                        <Button
                            type="primary"
                            size="small"
                            icon={<Plus size={13} strokeWidth={2} />}
                            onClick={() => create.mutate()}
                            loading={create.isPending}
                        >
                            New note
                        </Button>
                    </div>
                    <Input
                        prefix={
                            <Search
                                size={12}
                                strokeWidth={1.75}
                                color={tokens.colors.textMuted}
                            />
                        }
                        placeholder="Search notes..."
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        size="small"
                    />
                </div>

                <div
                    style={{
                        flex: 1,
                        overflow: "auto",
                        padding: `${tokens.spacing[2]}px ${tokens.spacing[2]}px`,
                    }}
                >
                    {isLoading ? (
                        <LoadingState minHeight={120} />
                    ) : filtered.length === 0 ? (
                        <Empty
                            image={
                                <StickyNote
                                    size={36}
                                    strokeWidth={1.25}
                                    color={tokens.colors.textMuted}
                                />
                            }
                            description={
                                query
                                    ? "No matching notes."
                                    : "No notes yet."
                            }
                        />
                    ) : (
                        <>
                            {pinned.length > 0 && (
                                <>
                                    <SectionLabel>Pinned</SectionLabel>
                                    {pinned.map((n) => (
                                        <NoteRow
                                            key={n.id}
                                            note={n}
                                            active={n.id === activeId}
                                            onClick={() => {
                                                setActiveId(n.id);
                                                setPreviewMode(false);
                                            }}
                                        />
                                    ))}
                                </>
                            )}
                            {others.length > 0 && (
                                <>
                                    {pinned.length > 0 && (
                                        <SectionLabel>Notes</SectionLabel>
                                    )}
                                    {others.map((n) => (
                                        <NoteRow
                                            key={n.id}
                                            note={n}
                                            active={n.id === activeId}
                                            onClick={() => {
                                                setActiveId(n.id);
                                                setPreviewMode(false);
                                            }}
                                        />
                                    ))}
                                </>
                            )}
                        </>
                    )}
                </div>
            </aside>

            {/* Editor */}
            <main
                style={{
                    overflow: "hidden",
                    display: "flex",
                    flexDirection: "column",
                }}
            >
                {active ? (
                    <NoteEditor
                        note={active}
                        previewMode={previewMode}
                        onTogglePreview={() => setPreviewMode((p) => !p)}
                        onTogglePin={() => togglePin.mutate(active.id)}
                        onDelete={() => remove.mutate(active.id)}
                    />
                ) : (
                    <div
                        style={{
                            display: "flex",
                            flexDirection: "column",
                            alignItems: "center",
                            justifyContent: "center",
                            height: "100%",
                            gap: 8,
                            color: tokens.colors.textMuted,
                        }}
                    >
                        <StickyNote
                            size={48}
                            strokeWidth={1.25}
                            color={tokens.colors.textMuted}
                        />
                        <span>Pick a note or create a new one.</span>
                    </div>
                )}
            </main>
        </div>
    );
};

const NoteEditor = ({
    note,
    previewMode,
    onTogglePreview,
    onTogglePin,
    onDelete,
}: {
    note: Note;
    previewMode: boolean;
    onTogglePreview: () => void;
    onTogglePin: () => void;
    onDelete: () => void;
}) => {
    const qc = useQueryClient();
    const user = useAuthStore((s) => s.user);
    const [title, setTitle] = useState(note.title);
    const [body, setBody] = useState(note.body);
    const [color, setColor] = useState(note.color);
    const [saving, setSaving] = useState(false);
    const debounceRef = useRef<number | null>(null);

    // Reset local state when active note changes
    useEffect(() => {
        setTitle(note.title);
        setBody(note.body);
        setColor(note.color);
    }, [note.id, note.title, note.body, note.color]);

    const save = useMutation({
        mutationFn: (patch: Partial<Pick<Note, "title" | "body" | "color">>) =>
            mockApi.notes.update(note.id, patch),
        onMutate: () => setSaving(true),
        onSettled: () => {
            setSaving(false);
            qc.invalidateQueries({ queryKey: ["notes", user?.id] });
        },
    });

    const scheduleSave = (patch: Partial<Pick<Note, "title" | "body" | "color">>) => {
        if (debounceRef.current) window.clearTimeout(debounceRef.current);
        debounceRef.current = window.setTimeout(() => {
            save.mutate(patch);
        }, 500);
    };

    const handleTitleChange = (v: string) => {
        setTitle(v);
        scheduleSave({ title: v });
    };
    const handleBodyChange = (v: string) => {
        setBody(v);
        scheduleSave({ body: v });
    };
    const handleColorChange = (c: string) => {
        setColor(c);
        save.mutate({ color: c });
    };

    return (
        <>
            <div
                style={{
                    padding: `${tokens.spacing[3]}px ${tokens.spacing[5]}px`,
                    borderBottom: `1px solid ${tokens.colors.border}`,
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    background: tokens.colors.bgSurface,
                }}
            >
                {color && (
                    <span
                        style={{
                            width: 10,
                            height: 10,
                            borderRadius: "50%",
                            background: color,
                            flexShrink: 0,
                        }}
                    />
                )}
                <Input
                    variant="borderless"
                    value={title}
                    onChange={(e) => handleTitleChange(e.target.value)}
                    placeholder="Untitled note"
                    style={{
                        flex: 1,
                        fontWeight: 700,
                        fontSize: tokens.typography.fontSize.lg,
                        padding: 0,
                    }}
                />
                <span
                    style={{
                        fontSize: 11,
                        color: tokens.colors.textMuted,
                        fontFamily: tokens.typography.fontFamilyMono,
                    }}
                >
                    {saving ? "Saving..." : `Saved ${formatTime(note.updatedAt)}`}
                </span>
                <Button
                    size="small"
                    icon={
                        previewMode ? (
                            <Pencil size={13} strokeWidth={1.75} />
                        ) : (
                            <Eye size={13} strokeWidth={1.75} />
                        )
                    }
                    onClick={onTogglePreview}
                >
                    {previewMode ? "Edit" : "Preview"}
                </Button>
                <Dropdown
                    trigger={["click"]}
                    menu={{
                        items: [
                            {
                                key: "pin",
                                icon: note.isPinned ? (
                                    <PinOff size={13} strokeWidth={1.75} />
                                ) : (
                                    <Pin size={13} strokeWidth={1.75} />
                                ),
                                label: note.isPinned
                                    ? "Unpin"
                                    : "Pin to top",
                                onClick: onTogglePin,
                            },
                            {
                                key: "color",
                                icon: <Palette size={13} strokeWidth={1.75} />,
                                label: "Set color",
                                children: COLORS.map((c) => ({
                                    key: c,
                                    label: (
                                        <span
                                            style={{
                                                display: "inline-flex",
                                                alignItems: "center",
                                                gap: 8,
                                            }}
                                        >
                                            <span
                                                style={{
                                                    width: 12,
                                                    height: 12,
                                                    borderRadius: "50%",
                                                    background: c,
                                                }}
                                            />
                                            <span
                                                style={{
                                                    fontFamily:
                                                        tokens.typography
                                                            .fontFamilyMono,
                                                    fontSize: 11,
                                                }}
                                            >
                                                {c}
                                            </span>
                                        </span>
                                    ),
                                    onClick: () => handleColorChange(c),
                                })),
                            },
                            { type: "divider" as const },
                            {
                                key: "delete",
                                icon: <Trash2 size={13} strokeWidth={1.75} />,
                                label: "Delete note",
                                danger: true,
                            },
                        ],
                        onClick: ({ key }) => {
                            if (key === "delete") {
                                Modal.confirm({
                                    title: `Delete “${note.title}”?`,
                                    content: "This cannot be undone.",
                                    okType: "danger",
                                    onOk: onDelete,
                                });
                            }
                        },
                    }}
                >
                    <Button
                        size="small"
                        type="text"
                        icon={
                            <MoreHorizontal
                                size={14}
                                strokeWidth={1.75}
                            />
                        }
                    />
                </Dropdown>
            </div>

            <div
                style={{
                    flex: 1,
                    overflow: "auto",
                    padding: `${tokens.spacing[5]}px ${tokens.spacing[6]}px`,
                    maxWidth: 760,
                    width: "100%",
                    margin: "0 auto",
                }}
            >
                {previewMode ? (
                    <MarkdownRenderer markdown={body} />
                ) : (
                    <textarea
                        value={body}
                        onChange={(e) => handleBodyChange(e.target.value)}
                        placeholder="Start typing... (Markdown supported)"
                        style={{
                            width: "100%",
                            minHeight: "70vh",
                            border: 0,
                            outline: "none",
                            resize: "none",
                            background: "transparent",
                            fontFamily: tokens.typography.fontFamily,
                            fontSize: tokens.typography.fontSize.base,
                            lineHeight: 1.7,
                            color: tokens.colors.textPrimary,
                        }}
                    />
                )}
            </div>
        </>
    );
};

const NoteRow = ({
    note,
    active,
    onClick,
}: {
    note: Note;
    active: boolean;
    onClick: () => void;
}) => {
    const preview =
        note.body
            .replace(/[#*`>\-_]/g, "")
            .replace(/\s+/g, " ")
            .trim()
            .slice(0, 80) || "No content";
    return (
        <button
            onClick={onClick}
            style={{
                display: "flex",
                flexDirection: "column",
                width: "100%",
                padding: `${tokens.spacing[2]}px ${tokens.spacing[3]}px`,
                marginBottom: 2,
                background: active
                    ? tokens.colors.primarySubtle
                    : "transparent",
                border: 0,
                borderLeft: `3px solid ${note.color ?? "transparent"}`,
                borderRadius: tokens.radius.sm,
                cursor: "pointer",
                textAlign: "left",
                transition: "background var(--transition-fast)",
            }}
            onMouseEnter={(e) => {
                if (!active)
                    e.currentTarget.style.background = tokens.colors.bgHover;
            }}
            onMouseLeave={(e) => {
                if (!active)
                    e.currentTarget.style.background = "transparent";
            }}
        >
            <div
                style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    width: "100%",
                }}
            >
                <span
                    style={{
                        flex: 1,
                        fontSize: tokens.typography.fontSize.sm,
                        fontWeight: 600,
                        color: tokens.colors.textPrimary,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                    }}
                >
                    {note.title || "Untitled"}
                </span>
                {note.isPinned && (
                    <Pin
                        size={11}
                        strokeWidth={2}
                        color={tokens.colors.warning}
                        fill={tokens.colors.warning}
                    />
                )}
            </div>
            <div
                style={{
                    fontSize: 11,
                    color: tokens.colors.textMuted,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    marginTop: 2,
                }}
            >
                {preview}
            </div>
            <div
                style={{
                    fontSize: 10,
                    color: tokens.colors.textMuted,
                    fontFamily: tokens.typography.fontFamilyMono,
                    marginTop: 2,
                }}
            >
                {formatTime(note.updatedAt)}
            </div>
        </button>
    );
};

const SectionLabel = ({ children }: { children: React.ReactNode }) => (
    <div
        style={{
            fontSize: 10,
            fontWeight: 700,
            color: tokens.colors.textMuted,
            textTransform: "uppercase",
            letterSpacing: "0.08em",
            padding: `${tokens.spacing[2]}px ${tokens.spacing[3]}px ${tokens.spacing[1]}px`,
        }}
    >
        {children}
    </div>
);

export default NotepadPage;
