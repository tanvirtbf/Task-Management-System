import { useMemo, useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Alert, Button, Input, Empty, Spin } from "antd";
import {
    Search,
    Hash,
    ListTodo,
    Folder,
    StickyNote,
    MessageCircle,
    User,
} from "lucide-react";
import { searchApi } from "../../http/api";
import { useListMap } from "../../hooks/useReferenceData";
import { tokens } from "../../theme";
import { useIsMobile } from "../../hooks/useIsMobile";

type Kind = "task" | "list" | "space" | "note" | "comment" | "user";

const KIND_META: Record<
    Kind,
    {
        icon: React.ComponentType<{
            size?: number;
            strokeWidth?: number;
            color?: string;
        }>;
        color: string;
        label: string;
    }
> = {
    task: { icon: ListTodo, color: "#4F46E5", label: "Tasks" },
    list: { icon: Hash, color: "#10B981", label: "Lists" },
    space: { icon: Folder, color: "#8B5CF6", label: "Spaces" },
    note: { icon: StickyNote, color: "#F59E0B", label: "Notes" },
    comment: { icon: MessageCircle, color: "#06B6D4", label: "Comments" },
    user: { icon: User, color: "#E11D48", label: "People" },
};

const SearchPage = () => {
    const isMobile = useIsMobile();
    const navigate = useNavigate();
    const [params, setParams] = useSearchParams();
    const [query, setQuery] = useState(params.get("q") ?? "");
    const [filter, setFilter] = useState<"all" | Kind>("all");
    // M13: debounce so we fire ONE request after typing stops, not per keystroke.
    const [debounced, setDebounced] = useState(query);

    useEffect(() => {
        if (query) setParams({ q: query });
        else setParams({});
        const t = setTimeout(() => setDebounced(query), 250);
        return () => clearTimeout(t);
    }, [query, setParams]);

    // M13: always fetch ALL types (filter is applied client-side for DISPLAY),
    // so the chip counts never collapse to 0 and switching chips is instant.
    const { data, isFetching, isError, refetch } = useQuery({
        queryKey: ["search-page", debounced],
        queryFn: () => searchApi.search({ query: debounced, limit: 30 }),
        enabled: debounced.trim().length > 0,
    });

    const counts: Record<Kind, number> = useMemo(() => {
        if (!data) {
            return {
                task: 0,
                list: 0,
                space: 0,
                note: 0,
                comment: 0,
                user: 0,
            };
        }
        return {
            task: data.tasks.length,
            list: data.lists.length,
            space: data.spaces.length,
            note: data.notes.length,
            comment: data.comments.length,
            user: data.users.length,
        };
    }, [data]);

    return (
        <div
            style={{
                padding: tokens.spacing[6],
                maxWidth: 900,
                margin: "0 auto",
            }}
        >
            <div
                style={{
                    display: "flex",
                    alignItems: "center",
                    gap: tokens.spacing[3],
                    marginBottom: tokens.spacing[4],
                }}
            >
                <div
                    style={{
                        width: 44,
                        height: 44,
                        borderRadius: tokens.radius.lg,
                        background: tokens.colors.primarySubtle,
                        color: tokens.colors.primary,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                    }}
                >
                    <Search size={22} strokeWidth={1.75} />
                </div>
                <div style={{ flex: 1 }}>
                    <h1
                        style={{
                            margin: 0,
                            fontSize: tokens.typography.fontSize["3xl"],
                            fontWeight: 700,
                            letterSpacing: "-0.02em",
                        }}
                    >
                        Search
                    </h1>
                    <p
                        style={{
                            margin: 0,
                            marginTop: 2,
                            color: tokens.colors.textSecondary,
                            fontSize: tokens.typography.fontSize.sm,
                        }}
                    >
                        Across tasks, lists, notes, comments, and people.{isMobile ? null : <>{" "}Press{" "}
                        <kbd
                            style={{
                                background: tokens.colors.bgMuted,
                                border: `1px solid ${tokens.colors.border}`,
                                borderRadius: 4,
                                padding: "1px 5px",
                                fontSize: 10,
                                fontFamily:
                                    tokens.typography.fontFamilyMono,
                            }}
                        >
                            ⌘K
                        </kbd>{" "}
                        anywhere to open the command palette.</>}
                    </p>
                </div>
            </div>

            <Input
                size="large"
                prefix={
                    isFetching ? (
                        <Spin size="small" />
                    ) : (
                        <Search
                            size={16}
                            strokeWidth={1.75}
                            color={tokens.colors.textMuted}
                        />
                    )
                }
                placeholder="Search everything..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                style={{
                    marginBottom: tokens.spacing[3],
                }}
                autoFocus
            />

            {/* Filter chips */}
            {query.trim() && data && (
                <div
                    style={{
                        display: "flex",
                        gap: 6,
                        flexWrap: "wrap",
                        marginBottom: tokens.spacing[4],
                    }}
                >
                    <Chip
                        active={filter === "all"}
                        onClick={() => setFilter("all")}
                        label="All"
                        count={data.total}
                    />
                    {(Object.keys(KIND_META) as Kind[]).map((k) => {
                        const meta = KIND_META[k];
                        return (
                            <Chip
                                key={k}
                                active={filter === k}
                                onClick={() => setFilter(k)}
                                label={meta.label}
                                count={counts[k]}
                                color={meta.color}
                            />
                        );
                    })}
                </div>
            )}

            {!query.trim() ? (
                <Empty
                    image={
                        <Search
                            size={48}
                            strokeWidth={1.25}
                            color={tokens.colors.textMuted}
                        />
                    }
                    description="Type to begin searching."
                />
            ) : isError ? (
                // M9: a search failure is NOT "no results".
                <Alert
                    type="error"
                    showIcon
                    message="Search failed"
                    description="Check your connection and try again."
                    action={
                        <Button size="small" onClick={() => void refetch()}>
                            Retry
                        </Button>
                    }
                />
            ) : !data || data.total === 0 ? (
                <Empty
                    description={`No results for “${query}”.`}
                />
            ) : (
                <div
                    style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: tokens.spacing[4],
                    }}
                >
                    {(
                        [
                            ["task", data.tasks],
                            ["list", data.lists],
                            ["space", data.spaces],
                            ["note", data.notes],
                            ["comment", data.comments],
                            ["user", data.users],
                        ] as const
                    ).map(([kind, items]) => {
                        if (items.length === 0) return null;
                        // M13: the selected chip filters which sections SHOW.
                        if (filter !== "all" && filter !== kind) return null;
                        const meta = KIND_META[kind];
                        const Icon = meta.icon;
                        return (
                            <section key={kind}>
                                <div
                                    style={{
                                        display: "flex",
                                        alignItems: "center",
                                        gap: 6,
                                        marginBottom: 6,
                                    }}
                                >
                                    <Icon
                                        size={14}
                                        strokeWidth={1.75}
                                        color={meta.color}
                                    />
                                    <span
                                        style={{
                                            fontSize: 11,
                                            fontWeight: 700,
                                            color: meta.color,
                                            textTransform: "uppercase",
                                            letterSpacing: "0.08em",
                                        }}
                                    >
                                        {meta.label}
                                    </span>
                                    <span
                                        style={{
                                            fontSize: 11,
                                            color: tokens.colors.textMuted,
                                            fontFamily:
                                                tokens.typography.fontFamilyMono,
                                        }}
                                    >
                                        {items.length}
                                    </span>
                                </div>
                                <div
                                    style={{
                                        background: tokens.colors.bgSurface,
                                        border: `1px solid ${tokens.colors.border}`,
                                        borderRadius: tokens.radius.lg,
                                        overflow: "hidden",
                                    }}
                                >
                                    {items.map((entity, idx) => (
                                        <ResultRow
                                            key={(entity as { id: string }).id}
                                            kind={kind}
                                            entity={entity as never}
                                            query={query}
                                            isLast={idx === items.length - 1}
                                            onClick={() => {
                                                if (kind === "task")
                                                    navigate(
                                                        `/t/${(entity as { id: string }).id}`,
                                                    );
                                                else if (kind === "list") {
                                                    const list = entity as {
                                                        id: string;
                                                        spaceId: string;
                                                    };
                                                    navigate(
                                                        `/s/${list.spaceId}/l/${list.id}`,
                                                    );
                                                } else if (kind === "space")
                                                    navigate(
                                                        `/s/${(entity as { id: string }).id}`,
                                                    );
                                                else if (kind === "note")
                                                    navigate(`/notepad`);
                                                else if (kind === "comment") {
                                                    const c = entity as {
                                                        taskId: string;
                                                    };
                                                    navigate(`/t/${c.taskId}`);
                                                } else if (kind === "user")
                                                    navigate(
                                                        `/settings/members`,
                                                    );
                                            }}
                                        />
                                    ))}
                                </div>
                            </section>
                        );
                    })}
                </div>
            )}
        </div>
    );
};

const Chip = ({
    active,
    onClick,
    label,
    count,
    color,
}: {
    active: boolean;
    onClick: () => void;
    label: string;
    count: number;
    color?: string;
}) => (
    <button
        onClick={onClick}
        style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 5,
            padding: "5px 11px",
            background: active
                ? color ?? tokens.colors.primary
                : tokens.colors.bgSurface,
            border: `1px solid ${
                active
                    ? color ?? tokens.colors.primary
                    : tokens.colors.border
            }`,
            borderRadius: tokens.radius.full,
            color: active ? "#fff" : tokens.colors.textPrimary,
            fontSize: 12,
            fontWeight: active ? 600 : 500,
            cursor: "pointer",
        }}
    >
        {label}
        <span
            style={{
                fontSize: 10,
                color: active
                    ? "rgba(255,255,255,0.8)"
                    : tokens.colors.textMuted,
                fontFamily: tokens.typography.fontFamilyMono,
            }}
        >
            {count}
        </span>
    </button>
);

const ResultRow = ({
    kind,
    entity,
    query,
    isLast,
    onClick,
}: {
    kind: Kind;
    entity: {
        id: string;
        name?: string;
        title?: string;
        firstName?: string;
        lastName?: string;
        email?: string;
        body?: string;
        customId?: string;
        taskNumber?: number;
        taskId?: string;
        spaceId?: string;
        primaryListId?: string;
    };
    query: string;
    isLast: boolean;
    onClick: () => void;
}) => {
    const meta = KIND_META[kind];
    const Icon = meta.icon;
    const listMap = useListMap();
    const title =
        kind === "user"
            ? `${entity.firstName} ${entity.lastName}`
            : kind === "note"
              ? entity.title ?? ""
              : kind === "comment"
                ? (entity.body ?? "").slice(0, 120)
                : entity.name ?? "";
    const sub =
        kind === "user"
            ? entity.email
            : kind === "task"
              ? `${entity.customId ?? `#${entity.taskNumber}`} · ${listMap.get(entity.primaryListId ?? "")?.name ?? ""}`
              : kind === "note"
                ? (entity.body ?? "").slice(0, 100).replace(/\n/g, " ")
                : kind === "comment"
                  ? "Comment"
                  : kind === "list"
                    ? "List"
                    : "Space";

    return (
        <div
            onClick={onClick}
            style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: tokens.spacing[3],
                borderBottom: isLast
                    ? "none"
                    : `1px solid ${tokens.colors.borderSubtle}`,
                cursor: "pointer",
                transition: "background var(--transition-fast)",
            }}
            onMouseEnter={(e) =>
                (e.currentTarget.style.background = tokens.colors.bgHover)
            }
            onMouseLeave={(e) =>
                (e.currentTarget.style.background = "transparent")
            }
        >
            <span
                style={{
                    width: 28,
                    height: 28,
                    borderRadius: tokens.radius.sm,
                    background: `${meta.color}1A`,
                    color: meta.color,
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
                    dangerouslySetInnerHTML={{ __html: highlight(title, query) }}
                />
                {sub && (
                    <div
                        style={{
                            fontSize: 11,
                            color: tokens.colors.textMuted,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                            fontFamily:
                                kind === "task"
                                    ? tokens.typography.fontFamilyMono
                                    : "inherit",
                        }}
                        dangerouslySetInnerHTML={{
                            __html: highlight(sub, query),
                        }}
                    />
                )}
            </div>
        </div>
    );
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

export default SearchPage;
