import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Input, Spin } from "antd";
import {
    Search,
    Hash,
    ListTodo,
    Folder,
    StickyNote,
    MessageCircle,
    User,
    ArrowRight,
    Clock,
    X,
} from "lucide-react";
import { mockApi } from "../../lib/mock-api";
import { tokens } from "../../theme";
import type { Task, List, Space, User as UserType } from "../../types";
import type { Note } from "../../types/note";
import type { Comment } from "../../types/extras";

const RECENT_KEY = "tms.search.recent";

const getRecent = (): string[] => {
    try {
        const raw = localStorage.getItem(RECENT_KEY);
        return raw ? (JSON.parse(raw) as string[]) : [];
    } catch {
        return [];
    }
};
const setRecent = (queries: string[]) => {
    try {
        localStorage.setItem(RECENT_KEY, JSON.stringify(queries.slice(0, 8)));
    } catch {
        // ignore
    }
};

type FlatResult =
    | { kind: "task"; entity: Task }
    | { kind: "list"; entity: List }
    | { kind: "space"; entity: Space }
    | { kind: "note"; entity: Note }
    | { kind: "comment"; entity: Comment }
    | { kind: "user"; entity: UserType };

export const CommandPalette = ({
    open,
    onClose,
}: {
    open: boolean;
    onClose: () => void;
}) => {
    const navigate = useNavigate();
    const [query, setQuery] = useState("");
    const [activeIdx, setActiveIdx] = useState(0);
    const [recent, setRecentState] = useState<string[]>(getRecent());
    const inputRef = useRef<HTMLInputElement>(null);

    const { data, isFetching } = useQuery({
        queryKey: ["search", query],
        queryFn: () =>
            mockApi.search.global({ query, limit: 6 }),
        enabled: open && query.trim().length > 0,
        staleTime: 30_000,
    });

    const flat: FlatResult[] = useMemo(() => {
        if (!data) return [];
        return [
            ...data.tasks.map((e) => ({ kind: "task" as const, entity: e })),
            ...data.lists.map((e) => ({ kind: "list" as const, entity: e })),
            ...data.spaces.map((e) => ({ kind: "space" as const, entity: e })),
            ...data.notes.map((e) => ({ kind: "note" as const, entity: e })),
            ...data.comments.map((e) => ({ kind: "comment" as const, entity: e })),
            ...data.users.map((e) => ({ kind: "user" as const, entity: e })),
        ];
    }, [data]);

    useEffect(() => {
        setActiveIdx(0);
    }, [query]);

    useEffect(() => {
        if (open) {
            setTimeout(() => inputRef.current?.focus(), 50);
        }
    }, [open]);

    const handleSelect = (r: FlatResult) => {
        const updated = [
            query.trim(),
            ...recent.filter((x) => x !== query.trim()),
        ].filter(Boolean);
        setRecent(updated);
        setRecentState(updated);

        if (r.kind === "task") navigate(`/t/${r.entity.id}`);
        else if (r.kind === "list") navigate(`/s/${r.entity.spaceId}/l/${r.entity.id}`);
        else if (r.kind === "space") navigate(`/s/${r.entity.id}`);
        else if (r.kind === "note") navigate(`/notepad`);
        else if (r.kind === "user") navigate(`/settings/members`);
        else if (r.kind === "comment") navigate(`/t/${r.entity.taskId}`);
        onClose();
    };

    const handleKey = (e: React.KeyboardEvent) => {
        if (e.key === "Escape") {
            onClose();
            return;
        }
        if (e.key === "ArrowDown") {
            e.preventDefault();
            setActiveIdx((i) => Math.min(i + 1, flat.length - 1));
        } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActiveIdx((i) => Math.max(i - 1, 0));
        } else if (e.key === "Enter" && flat[activeIdx]) {
            e.preventDefault();
            handleSelect(flat[activeIdx]);
        }
    };

    if (!open) return null;

    return (
        <div
            style={{
                position: "fixed",
                inset: 0,
                background: "rgba(15, 23, 42, 0.45)",
                backdropFilter: "blur(4px)",
                zIndex: 2000,
                display: "flex",
                alignItems: "flex-start",
                justifyContent: "center",
                paddingTop: "10vh",
            }}
            onClick={onClose}
        >
            <div
                onClick={(e) => e.stopPropagation()}
                style={{
                    width: 640,
                    maxWidth: "calc(100vw - 32px)",
                    background: tokens.colors.bgSurface,
                    borderRadius: tokens.radius.lg,
                    boxShadow: tokens.shadows.xl,
                    overflow: "hidden",
                    display: "flex",
                    flexDirection: "column",
                    maxHeight: "70vh",
                }}
            >
                {/* Search input */}
                <div
                    style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        padding: `${tokens.spacing[3]}px ${tokens.spacing[4]}px`,
                        borderBottom: `1px solid ${tokens.colors.border}`,
                    }}
                >
                    {isFetching ? (
                        <Spin size="small" />
                    ) : (
                        <Search
                            size={16}
                            strokeWidth={1.75}
                            color={tokens.colors.textMuted}
                        />
                    )}
                    <Input
                        ref={inputRef}
                        variant="borderless"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        onKeyDown={handleKey}
                        placeholder="Search tasks, lists, notes, people..."
                        style={{
                            flex: 1,
                            fontSize: tokens.typography.fontSize.lg,
                            padding: 0,
                        }}
                    />
                    {query && (
                        <button
                            onClick={() => setQuery("")}
                            style={{
                                background: "transparent",
                                border: 0,
                                cursor: "pointer",
                                color: tokens.colors.textMuted,
                                padding: 4,
                                display: "inline-flex",
                            }}
                        >
                            <X size={14} strokeWidth={1.75} />
                        </button>
                    )}
                    <kbd
                        style={{
                            background: tokens.colors.bgMuted,
                            border: `1px solid ${tokens.colors.border}`,
                            borderRadius: 4,
                            padding: "1px 6px",
                            fontSize: 10,
                            color: tokens.colors.textMuted,
                            fontFamily: tokens.typography.fontFamilyMono,
                        }}
                    >
                        Esc
                    </kbd>
                </div>

                {/* Results */}
                <div style={{ flex: 1, overflow: "auto" }}>
                    {!query.trim() ? (
                        <RecentSection
                            recent={recent}
                            onPick={(q) => setQuery(q)}
                            onClear={() => {
                                setRecent([]);
                                setRecentState([]);
                            }}
                        />
                    ) : flat.length === 0 ? (
                        <div
                            style={{
                                padding: tokens.spacing[6],
                                textAlign: "center",
                                color: tokens.colors.textMuted,
                                fontSize: tokens.typography.fontSize.sm,
                            }}
                        >
                            No results for{" "}
                            <strong>“{query}”</strong>
                        </div>
                    ) : (
                        <ResultsList
                            results={flat}
                            activeIdx={activeIdx}
                            onSelect={handleSelect}
                            onHover={setActiveIdx}
                            query={query}
                        />
                    )}
                </div>

                {/* Footer hints */}
                <div
                    style={{
                        padding: `6px ${tokens.spacing[4]}px`,
                        borderTop: `1px solid ${tokens.colors.border}`,
                        display: "flex",
                        alignItems: "center",
                        gap: 14,
                        fontSize: 11,
                        color: tokens.colors.textMuted,
                        background: tokens.colors.bgMuted,
                    }}
                >
                    <Hint k="↑↓" label="Navigate" />
                    <Hint k="↵" label="Open" />
                    <Hint k="esc" label="Close" />
                    <span style={{ marginLeft: "auto" }}>
                        {flat.length > 0 && `${flat.length} results`}
                    </span>
                </div>
            </div>
        </div>
    );
};

const Hint = ({ k, label }: { k: string; label: string }) => (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
        <kbd
            style={{
                background: tokens.colors.bgSurface,
                border: `1px solid ${tokens.colors.border}`,
                borderRadius: 3,
                padding: "1px 5px",
                fontSize: 10,
                fontFamily: tokens.typography.fontFamilyMono,
            }}
        >
            {k}
        </kbd>
        <span>{label}</span>
    </span>
);

const RecentSection = ({
    recent,
    onPick,
    onClear,
}: {
    recent: string[];
    onPick: (q: string) => void;
    onClear: () => void;
}) => {
    if (recent.length === 0) {
        return (
            <div
                style={{
                    padding: tokens.spacing[6],
                    textAlign: "center",
                    color: tokens.colors.textMuted,
                    fontSize: tokens.typography.fontSize.sm,
                }}
            >
                Start typing to search across tasks, lists, notes, and more.
            </div>
        );
    }
    return (
        <div>
            <div
                style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: `8px ${tokens.spacing[4]}px 4px`,
                }}
            >
                <span
                    style={{
                        fontSize: 11,
                        fontWeight: 700,
                        color: tokens.colors.textMuted,
                        textTransform: "uppercase",
                        letterSpacing: "0.08em",
                    }}
                >
                    Recent
                </span>
                <button
                    onClick={onClear}
                    style={{
                        background: "transparent",
                        border: 0,
                        cursor: "pointer",
                        fontSize: 11,
                        color: tokens.colors.textMuted,
                    }}
                >
                    Clear
                </button>
            </div>
            {recent.map((q) => (
                <button
                    key={q}
                    onClick={() => onPick(q)}
                    style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 10,
                        width: "100%",
                        padding: `8px ${tokens.spacing[4]}px`,
                        background: "transparent",
                        border: 0,
                        cursor: "pointer",
                        textAlign: "left",
                        fontSize: tokens.typography.fontSize.sm,
                        color: tokens.colors.textPrimary,
                    }}
                    onMouseEnter={(e) =>
                        (e.currentTarget.style.background =
                            tokens.colors.bgHover)
                    }
                    onMouseLeave={(e) =>
                        (e.currentTarget.style.background = "transparent")
                    }
                >
                    <Clock
                        size={13}
                        strokeWidth={1.75}
                        color={tokens.colors.textMuted}
                    />
                    {q}
                </button>
            ))}
        </div>
    );
};

const ResultsList = ({
    results,
    activeIdx,
    onSelect,
    onHover,
    query,
}: {
    results: FlatResult[];
    activeIdx: number;
    onSelect: (r: FlatResult) => void;
    onHover: (i: number) => void;
    query: string;
}) => {
    let lastKind: FlatResult["kind"] | null = null;
    return (
        <div>
            {results.map((r, i) => {
                const header =
                    r.kind !== lastKind ? (
                        <div
                            key={`h-${r.kind}`}
                            style={{
                                padding: `8px ${tokens.spacing[4]}px 4px`,
                                fontSize: 11,
                                fontWeight: 700,
                                color: tokens.colors.textMuted,
                                textTransform: "uppercase",
                                letterSpacing: "0.08em",
                            }}
                        >
                            {KIND_LABELS[r.kind]}
                        </div>
                    ) : null;
                lastKind = r.kind;
                return (
                    <div key={`row-${i}`}>
                        {header}
                        <ResultRow
                            result={r}
                            active={i === activeIdx}
                            query={query}
                            onClick={() => onSelect(r)}
                            onMouseEnter={() => onHover(i)}
                        />
                    </div>
                );
            })}
        </div>
    );
};

const KIND_LABELS: Record<FlatResult["kind"], string> = {
    task: "Tasks",
    list: "Lists",
    space: "Spaces",
    note: "Notes",
    comment: "Comments",
    user: "People",
};

const KIND_META: Record<
    FlatResult["kind"],
    { icon: React.ComponentType<{ size?: number; strokeWidth?: number }>; color: string }
> = {
    task: { icon: ListTodo, color: "#4F46E5" },
    list: { icon: Hash, color: "#10B981" },
    space: { icon: Folder, color: "#8B5CF6" },
    note: { icon: StickyNote, color: "#F59E0B" },
    comment: { icon: MessageCircle, color: "#06B6D4" },
    user: { icon: User, color: "#E11D48" },
};

const ResultRow = ({
    result,
    active,
    query,
    onClick,
    onMouseEnter,
}: {
    result: FlatResult;
    active: boolean;
    query: string;
    onClick: () => void;
    onMouseEnter: () => void;
}) => {
    const { icon: Icon, color } = KIND_META[result.kind];
    const { title, subtitle } = describeResult(result);
    return (
        <button
            onClick={onClick}
            onMouseEnter={onMouseEnter}
            style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                width: "100%",
                padding: `8px ${tokens.spacing[4]}px`,
                background: active ? tokens.colors.primarySubtle : "transparent",
                border: 0,
                borderLeft: active
                    ? `3px solid ${tokens.colors.primary}`
                    : "3px solid transparent",
                cursor: "pointer",
                textAlign: "left",
                transition: "background var(--transition-fast)",
            }}
        >
            <span
                style={{
                    width: 26,
                    height: 26,
                    borderRadius: tokens.radius.sm,
                    background: `${color}1A`,
                    color,
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                }}
            >
                <Icon size={14} strokeWidth={1.75} />
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
                <div
                    style={{
                        fontSize: tokens.typography.fontSize.sm,
                        fontWeight: 600,
                        color: tokens.colors.textPrimary,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                    }}
                    dangerouslySetInnerHTML={{
                        __html: highlight(title, query),
                    }}
                />
                {subtitle && (
                    <div
                        style={{
                            fontSize: 11,
                            color: tokens.colors.textMuted,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                        }}
                        dangerouslySetInnerHTML={{
                            __html: highlight(subtitle, query),
                        }}
                    />
                )}
            </div>
            {active && (
                <ArrowRight
                    size={13}
                    strokeWidth={1.75}
                    color={tokens.colors.textMuted}
                />
            )}
        </button>
    );
};

const describeResult = (r: FlatResult): { title: string; subtitle?: string } => {
    switch (r.kind) {
        case "task":
            return {
                title: r.entity.name,
                subtitle:
                    r.entity.customId ?? `#${r.entity.taskNumber}`,
            };
        case "list":
            return { title: r.entity.name, subtitle: "List" };
        case "space":
            return { title: r.entity.name, subtitle: "Space" };
        case "note":
            return {
                title: r.entity.title,
                subtitle: r.entity.body.slice(0, 80).replace(/\n/g, " "),
            };
        case "comment":
            return {
                title: r.entity.body?.slice(0, 100) ?? "",
                subtitle: "Comment",
            };
        case "user":
            return {
                title: `${r.entity.firstName} ${r.entity.lastName}`,
                subtitle: r.entity.email,
            };
    }
};

const highlight = (text: string, q: string): string => {
    if (!q.trim()) return escapeHtml(text);
    const escaped = escapeHtml(text);
    const safe = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return escaped.replace(
        new RegExp(`(${safe})`, "gi"),
        `<mark style="background:#FEF3C7;color:#92400E;padding:0 1px;border-radius:2px;">$1</mark>`,
    );
};

const escapeHtml = (s: string): string =>
    s
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
