import {
    useMemo,
    useRef,
    useState,
    type KeyboardEvent,
    type CSSProperties,
} from "react";
import { Input } from "antd";
import type { TextAreaRef } from "antd/es/input/TextArea";
import { useUsers } from "../../hooks/useReferenceData";
import { Avatar } from "../ui/Avatar";
import { tokens } from "../../theme";

interface MentionTextAreaProps {
    value: string;
    onChange: (value: string) => void;
    placeholder?: string;
    autoFocus?: boolean;
    autoSize?: { minRows: number; maxRows: number };
    /** Runs AFTER the mention dropdown has had first claim on the key —
     *  when a suggestion is picked with Enter, this never fires. */
    onKeyDown?: (e: KeyboardEvent<HTMLTextAreaElement>) => void;
}

interface Suggestion {
    id: string;
    handle: string; // email local-part — the token the SERVER resolves
    name: string;
    avatarUrl: string | null;
}

const MAX_SUGGESTIONS = 6;

/**
 * A comment textarea with Facebook-style @mention autocomplete.
 *
 * Typing `@` (at the start or after whitespace) opens a picker of active
 * workspace members, filtered live as you type; ↑/↓ move, Enter/Tab insert,
 * Esc closes. Picking inserts `@<email-local-part>` — the one token the
 * server's mention resolver matches unambiguously (first names can collide;
 * email local-parts cannot). The server then notifies the mentioned person
 * in-app + email + web push.
 */
export const MentionTextArea = ({
    value,
    onChange,
    placeholder,
    autoFocus,
    autoSize,
    onKeyDown,
}: MentionTextAreaProps) => {
    const { data: users = [] } = useUsers();
    const inputRef = useRef<TextAreaRef>(null);
    // The active "@query" token, or null when the picker is closed.
    const [query, setQuery] = useState<string | null>(null);
    const [tokenStart, setTokenStart] = useState(0); // index of the "@"
    const [activeIdx, setActiveIdx] = useState(0);

    const candidates: Suggestion[] = useMemo(
        () =>
            users
                .filter((u) => u.status === "active")
                .map((u) => ({
                    id: u.id,
                    handle: u.email.split("@")[0].toLowerCase(),
                    name: `${u.firstName} ${u.lastName}`.trim(),
                    avatarUrl: u.avatarUrl,
                })),
        [users],
    );

    const suggestions: Suggestion[] = useMemo(() => {
        if (query === null) return [];
        const q = query.toLowerCase();
        const scored = candidates
            .map((c) => {
                const name = c.name.toLowerCase();
                const starts =
                    c.handle.startsWith(q) ||
                    name.startsWith(q) ||
                    name.split(/\s+/).some((w) => w.startsWith(q));
                const contains = c.handle.includes(q) || name.includes(q);
                return { c, rank: starts ? 0 : contains ? 1 : 2 };
            })
            .filter((s) => q.length === 0 || s.rank < 2)
            .sort(
                (a, b) => a.rank - b.rank || a.c.name.localeCompare(b.c.name),
            );
        return scored.slice(0, MAX_SUGGESTIONS).map((s) => s.c);
    }, [candidates, query]);

    const open = query !== null && suggestions.length > 0;

    const textareaEl = (): HTMLTextAreaElement | null =>
        inputRef.current?.resizableTextArea?.textArea ?? null;

    /** Re-derive the active @token from the text before the caret. */
    const syncQuery = (text: string, caret: number) => {
        const before = text.slice(0, caret);
        const m = /(^|[\s(])@([a-zA-Z0-9._-]*)$/.exec(before);
        if (m) {
            setTokenStart(caret - m[2].length - 1);
            setQuery(m[2]);
            setActiveIdx(0);
        } else {
            setQuery(null);
        }
    };

    const handleChange = (text: string) => {
        onChange(text);
        const el = textareaEl();
        // selectionStart is already updated inside the change event.
        syncQuery(text, el ? el.selectionStart : text.length);
    };

    const pick = (s: Suggestion) => {
        const el = textareaEl();
        const caret = el ? el.selectionStart : value.length;
        const inserted = `@${s.handle} `;
        const next = value.slice(0, tokenStart) + inserted + value.slice(caret);
        onChange(next);
        setQuery(null);
        // Put the caret right after the inserted mention once React re-renders.
        const pos = tokenStart + inserted.length;
        requestAnimationFrame(() => {
            const t = textareaEl();
            if (t) {
                t.focus();
                t.setSelectionRange(pos, pos);
            }
        });
    };

    const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
        if (open) {
            if (e.key === "ArrowDown") {
                e.preventDefault();
                setActiveIdx((i) => (i + 1) % suggestions.length);
                return;
            }
            if (e.key === "ArrowUp") {
                e.preventDefault();
                setActiveIdx(
                    (i) => (i - 1 + suggestions.length) % suggestions.length,
                );
                return;
            }
            if (e.key === "Enter" || e.key === "Tab") {
                e.preventDefault();
                pick(suggestions[activeIdx]);
                return;
            }
            if (e.key === "Escape") {
                // Consume it: closing the picker must not also cancel a reply
                // composer that treats Escape as "discard".
                e.preventDefault();
                e.stopPropagation();
                setQuery(null);
                return;
            }
        }
        onKeyDown?.(e);
    };

    return (
        <div style={{ position: "relative", flex: 1, minWidth: 0 }}>
            <Input.TextArea
                ref={inputRef}
                value={value}
                onChange={(e) => handleChange(e.target.value)}
                placeholder={placeholder}
                autoFocus={autoFocus}
                autoSize={autoSize}
                onKeyDown={handleKeyDown}
                onClick={() => {
                    const el = textareaEl();
                    if (el) syncQuery(value, el.selectionStart);
                }}
                onBlur={() => {
                    // Delay so an option's onMouseDown can win the race.
                    setTimeout(() => setQuery(null), 150);
                }}
                aria-expanded={open}
                aria-haspopup="listbox"
            />
            {open && (
                <div
                    role="listbox"
                    aria-label="Mention a teammate"
                    style={dropdownStyle}
                >
                    {suggestions.map((s, i) => (
                        <div
                            key={s.id}
                            role="option"
                            aria-selected={i === activeIdx}
                            // mousedown (not click) so the textarea keeps focus
                            onMouseDown={(e) => {
                                e.preventDefault();
                                pick(s);
                            }}
                            onMouseEnter={() => setActiveIdx(i)}
                            style={{
                                display: "flex",
                                alignItems: "center",
                                gap: 8,
                                padding: "6px 10px",
                                cursor: "pointer",
                                background:
                                    i === activeIdx
                                        ? tokens.colors.primarySubtle
                                        : "transparent",
                            }}
                        >
                            <Avatar
                                name={s.name}
                                src={s.avatarUrl}
                                size={22}
                            />
                            <span
                                style={{
                                    fontSize: tokens.typography.fontSize.sm,
                                    fontWeight: 500,
                                    color: tokens.colors.textPrimary,
                                    overflow: "hidden",
                                    textOverflow: "ellipsis",
                                    whiteSpace: "nowrap",
                                }}
                            >
                                {s.name}
                            </span>
                            <span
                                style={{
                                    marginLeft: "auto",
                                    fontSize: 11,
                                    color: tokens.colors.textMuted,
                                    fontFamily:
                                        tokens.typography.fontFamilyMono,
                                    flexShrink: 0,
                                }}
                            >
                                @{s.handle}
                            </span>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};

const dropdownStyle: CSSProperties = {
    position: "absolute",
    top: "100%",
    left: 0,
    right: 0,
    marginTop: 4,
    background: tokens.colors.bgSurface,
    border: `1px solid ${tokens.colors.border}`,
    borderRadius: tokens.radius.md,
    boxShadow: tokens.shadows.lg,
    zIndex: 1080,
    overflow: "hidden",
    maxHeight: 240,
    overflowY: "auto",
};
