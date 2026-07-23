import {
    type KeyboardEvent as ReactKeyboardEvent,
    useEffect,
    useMemo,
    useRef,
    useState,
} from "react";
import { useNavigate } from "react-router-dom";
import {
    Bot,
    X,
    Send,
    Square,
    RotateCcw,
    Sparkles,
    Lightbulb,
    Copy,
    Check,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useChatStore } from "../../stores/chat";
import { useAuthStore } from "../../stores/auth";
import { useUiStore } from "../../stores/ui";
import { useSpaces } from "../../hooks/useReferenceData";
import { makeAssistantMarkdownComponents } from "./mdLink";
import { pickSuggestions } from "./suggestions";
import "./AssistantWidget.css";

/**
 * Floating AI Help Assistant widget (see AI_ASSISTANT_PLAN.md, Phase 5 — the
 * polished, professional UI). Mounted once in the AppShell, so it is available
 * on every authenticated screen. Styling lives in AssistantWidget.css.
 */

const formatTime = (ts?: number): string =>
    ts
        ? new Date(ts).toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
          })
        : "";

export const AssistantWidget = () => {
    const user = useAuthStore((s) => s.user);
    const isOpen = useChatStore((s) => s.isOpen);
    const messages = useChatStore((s) => s.messages);
    const isStreaming = useChatStore((s) => s.isStreaming);
    const toggle = useChatStore((s) => s.toggle);
    const close = useChatStore((s) => s.close);
    const clear = useChatStore((s) => s.clear);
    const stop = useChatStore((s) => s.stop);
    const sendMessage = useChatStore((s) => s.sendMessage);
    const error = useChatStore((s) => s.error);
    const retryLast = useChatStore((s) => s.retryLast);
    const navigate = useNavigate();
    const { data: spaces = [] } = useSpaces();
    const nudgeSeen = useUiStore((s) => s.assistantNudgeSeen);
    const dismissNudge = useUiStore((s) => s.dismissAssistantNudge);

    const [input, setInput] = useState("");
    const [showSuggest, setShowSuggest] = useState(false);
    const [isMobile, setIsMobile] = useState(false);
    const [copiedId, setCopiedId] = useState<string | null>(null);
    const scrollRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLTextAreaElement>(null);
    const panelRef = useRef<HTMLDivElement>(null);
    const fabRef = useRef<HTMLButtonElement>(null);
    const wasOpenRef = useRef(false);

    // Links in answers navigate IN-APP (no full reload); external open a new
    // tab; unsafe hrefs render as plain text. On the mobile full-screen sheet
    // we close the widget after an in-app hop so the destination is visible.
    const mdComponents = useMemo(
        () =>
            makeAssistantMarkdownComponents(navigate, () => {
                if (window.matchMedia("(max-width: 520px)").matches) close();
            }),
        [navigate, close],
    );

    // Keep the view pinned to the latest message as content streams in.
    useEffect(() => {
        const el = scrollRef.current;
        if (el) el.scrollTop = el.scrollHeight;
    }, [messages, isOpen, isStreaming]);

    // Focus the input on open; close on Escape.
    useEffect(() => {
        if (!isOpen) return;
        inputRef.current?.focus();
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") close();
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [isOpen, close]);

    // Track the mobile full-screen breakpoint. A11y differs by viewport: the
    // sheet is a TRUE modal on mobile (trap focus + aria-modal); on desktop the
    // panel is a NON-modal popover so the app behind stays interactive — needed
    // for in-app link navigation (P6). We deliberately never `inert` the app.
    useEffect(() => {
        const mq = window.matchMedia("(max-width: 520px)");
        const update = () => setIsMobile(mq.matches);
        update();
        mq.addEventListener("change", update);
        return () => mq.removeEventListener("change", update);
    }, []);

    // Restore focus to the FAB when the widget closes (a11y).
    useEffect(() => {
        if (wasOpenRef.current && !isOpen) fabRef.current?.focus();
        wasOpenRef.current = isOpen;
    }, [isOpen]);

    // Only logged-in users see the assistant.
    if (!user) return null;

    // Department/Reports starter questions only for users who can reach them
    // (owner/admin or a Space Head) — mirrors the Sidebar's canSeeDept gate.
    const isAdmin = user.role === "owner" || user.role === "admin";
    const headsAny = spaces.some(
        (s) => !s.archivedAt && s.headUserId === user.id,
    );
    const suggestions = pickSuggestions(isAdmin || headsAny);

    const userInitial = (
        user.firstName?.[0] ??
        user.email?.[0] ??
        "U"
    ).toUpperCase();

    const submit = (text: string) => {
        const t = text.trim();
        if (!t || isStreaming) return;
        setInput("");
        if (inputRef.current) inputRef.current.style.height = "auto";
        void sendMessage(t);
    };

    // Copy an answer to the clipboard, with a brief "copied" state.
    const copyMsg = (id: string, text: string) => {
        if (!navigator.clipboard) return;
        void navigator.clipboard
            .writeText(text)
            .then(() => {
                setCopiedId(id);
                setTimeout(
                    () => setCopiedId((c) => (c === id ? null : c)),
                    1500,
                );
            })
            .catch(() => undefined);
    };

    // Keep Tab within the panel — only when it is a true modal (mobile).
    const trapFocus = (e: ReactKeyboardEvent<HTMLDivElement>) => {
        if (!isMobile || e.key !== "Tab" || !panelRef.current) return;
        const nodes = panelRef.current.querySelectorAll<HTMLElement>(
            'button:not([disabled]), textarea, a[href], [tabindex]:not([tabindex="-1"])',
        );
        if (nodes.length === 0) return;
        const first = nodes[0];
        const last = nodes[nodes.length - 1];
        if (e.shiftKey && document.activeElement === first) {
            e.preventDefault();
            last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
            e.preventDefault();
            first.focus();
        }
    };

    if (!isOpen) {
        const open = () => {
            dismissNudge();
            toggle();
        };
        return (
            <>
                {/* First-run onboarding nudge (P8) — one-time, dismissible. */}
                {!nudgeSeen && (
                    <div className="asst-nudge" data-testid="asst-nudge">
                        <button
                            type="button"
                            className="asst-nudge__body"
                            onClick={open}
                        >
                            👋 নতুন? এখানে যেকোনো প্রশ্ন করুন — আমি সাহায্য করব
                            🙂
                        </button>
                        <button
                            type="button"
                            className="asst-nudge__x"
                            onClick={dismissNudge}
                            title="বন্ধ করুন"
                            aria-label="Dismiss"
                        >
                            <X size={13} />
                        </button>
                    </div>
                )}
                <button
                    ref={fabRef}
                    type="button"
                    className={`asst-fab${!nudgeSeen ? " asst-fab--pulse" : ""}`}
                    onClick={open}
                    title="সহায়ক · Help"
                    aria-label="Open help assistant"
                >
                    <Bot size={26} strokeWidth={1.75} />
                </button>
            </>
        );
    }

    return (
        <div
            ref={panelRef}
            className="asst-panel"
            role="dialog"
            aria-modal={isMobile}
            aria-label="Help assistant"
            onKeyDown={trapFocus}
        >
            {/* Header */}
            <div className="asst-header">
                <div className="asst-header__avatar">
                    <Bot size={19} />
                </div>
                <div className="asst-header__meta">
                    <div className="asst-header__title">সহায়ক · Help Assistant</div>
                    <div className="asst-header__subtitle">
                        <span className="asst-online-dot" />
                        সিস্টেম নিয়ে যেকোনো প্রশ্ন করুন
                    </div>
                </div>
                {messages.length > 0 && (
                    <button
                        type="button"
                        className={`asst-iconbtn${
                            showSuggest ? " asst-iconbtn--active" : ""
                        }`}
                        onClick={() => setShowSuggest((v) => !v)}
                        title="সাধারণ প্রশ্ন"
                        aria-label="Suggested questions"
                    >
                        <Lightbulb size={16} />
                    </button>
                )}
                <button
                    type="button"
                    className="asst-iconbtn"
                    onClick={clear}
                    title="নতুন চ্যাট"
                    aria-label="New chat"
                >
                    <RotateCcw size={16} />
                </button>
                <button
                    type="button"
                    className="asst-iconbtn"
                    onClick={close}
                    title="বন্ধ করুন"
                    aria-label="Close"
                >
                    <X size={18} />
                </button>
            </div>

            {/* Messages */}
            <div className="asst-body" ref={scrollRef}>
                {messages.length === 0 && (
                    <div className="asst-welcome">
                        <div className="asst-welcome__icon">
                            <Sparkles size={22} />
                        </div>
                        <div>
                            <p className="asst-welcome__title">
                                👋 স্বাগতম! আমি আপনার সহায়ক।
                            </p>
                            <p className="asst-welcome__text">
                                এই সিস্টেমের কোথায় কী আছে, কীভাবে কাজ করবেন —
                                যেকোনো কিছু জিজ্ঞেস করুন। নিচের একটা বেছে নিন বা
                                নিজের প্রশ্ন লিখুন:
                            </p>
                        </div>
                        <div className="asst-chips">
                            {suggestions.map((s) => (
                                <button
                                    key={s}
                                    type="button"
                                    className="asst-chip"
                                    onClick={() => submit(s)}
                                >
                                    <Sparkles size={13} />
                                    {s}
                                </button>
                            ))}
                        </div>
                    </div>
                )}

                {messages.map((m, i) => {
                    const streamingThis =
                        isStreaming &&
                        i === messages.length - 1 &&
                        m.role === "assistant";
                    return (
                        <div key={m.id} className={`asst-row asst-row--${m.role}`}>
                            <div
                                className={`asst-avatar${
                                    m.role === "user" ? " asst-avatar--user" : ""
                                }`}
                            >
                                {m.role === "assistant" ? (
                                    <Bot size={15} />
                                ) : (
                                    userInitial
                                )}
                            </div>
                            <div className="asst-msg">
                                <div
                                    className={`asst-bubble asst-bubble--${m.role}`}
                                >
                                    {m.role === "assistant" ? (
                                        m.content ? (
                                            <>
                                                <ReactMarkdown
                                                    remarkPlugins={[remarkGfm]}
                                                    components={mdComponents}
                                                >
                                                    {m.content}
                                                </ReactMarkdown>
                                                {streamingThis && (
                                                    <span className="asst-cursor" />
                                                )}
                                            </>
                                        ) : (
                                            <span className="asst-typing">
                                                <span />
                                                <span />
                                                <span />
                                            </span>
                                        )
                                    ) : (
                                        m.content
                                    )}
                                </div>
                                <div className="asst-msgmeta">
                                    {m.createdAt && (
                                        <span className="asst-time">
                                            {formatTime(m.createdAt)}
                                        </span>
                                    )}
                                    {m.role === "assistant" &&
                                        m.content &&
                                        !streamingThis && (
                                            <button
                                                type="button"
                                                className={`asst-copy${
                                                    copiedId === m.id
                                                        ? " asst-copy--done"
                                                        : ""
                                                }`}
                                                onClick={() =>
                                                    copyMsg(m.id, m.content)
                                                }
                                                title="কপি করুন"
                                                aria-label="Copy message"
                                                data-testid="asst-copy"
                                            >
                                                {copiedId === m.id ? (
                                                    <Check size={12} />
                                                ) : (
                                                    <Copy size={12} />
                                                )}
                                            </button>
                                        )}
                                </div>
                            </div>
                        </div>
                    );
                })}
            </div>

            {/* Input */}
            <div className="asst-footer">
                {error && !isStreaming && (
                    <div className="asst-error" role="alert">
                        <span className="asst-error__msg">{error}</span>
                        <button
                            type="button"
                            className="asst-error__retry"
                            data-testid="asst-retry"
                            onClick={() => void retryLast()}
                        >
                            আবার চেষ্টা
                        </button>
                    </div>
                )}
                {showSuggest && messages.length > 0 && (
                    <div className="asst-suggestbar">
                        {suggestions.map((s) => (
                            <button
                                key={s}
                                type="button"
                                className="asst-chip"
                                onClick={() => {
                                    setShowSuggest(false);
                                    submit(s);
                                }}
                            >
                                <Sparkles size={13} />
                                {s}
                            </button>
                        ))}
                    </div>
                )}
                <div className="asst-inputrow">
                    <textarea
                        ref={inputRef}
                        className="asst-textarea"
                        value={input}
                        onChange={(e) => {
                            setInput(e.target.value);
                            e.target.style.height = "auto";
                            e.target.style.height = `${Math.min(
                                e.target.scrollHeight,
                                120,
                            )}px`;
                        }}
                        onKeyDown={(e) => {
                            if (e.key === "Enter" && !e.shiftKey) {
                                e.preventDefault();
                                submit(input);
                            }
                        }}
                        rows={1}
                        placeholder="আপনার প্রশ্ন লিখুন…"
                    />
                    {isStreaming ? (
                        <button
                            type="button"
                            className="asst-send asst-send--stop"
                            onClick={stop}
                            title="থামান"
                            aria-label="Stop generating"
                        >
                            <Square size={15} />
                        </button>
                    ) : (
                        <button
                            type="button"
                            className="asst-send"
                            onClick={() => submit(input)}
                            disabled={!input.trim()}
                            title="পাঠান"
                            aria-label="Send message"
                        >
                            <Send size={16} />
                        </button>
                    )}
                </div>
                <div className="asst-hint">
                    Enter — পাঠান · Shift+Enter — নতুন লাইন
                </div>
            </div>
        </div>
    );
};
