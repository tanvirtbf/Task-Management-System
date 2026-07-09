import { useEffect, useRef, useState } from "react";
import { Bot, X, Send, Square, RotateCcw, Sparkles } from "lucide-react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { useChatStore } from "../../stores/chat";
import { useAuthStore } from "../../stores/auth";
import "./AssistantWidget.css";

/**
 * Floating AI Help Assistant widget (see AI_ASSISTANT_PLAN.md, Phase 5 — the
 * polished, professional UI). Mounted once in the AppShell, so it is available
 * on every authenticated screen. Styling lives in AssistantWidget.css.
 */

const SUGGESTIONS = [
    "কীভাবে একটা নতুন task বানাবো?",
    "Board view টা কী?",
    "পাসওয়ার্ড কীভাবে বদলাবো?",
    "কাউকে task assign করব কীভাবে?",
];

// Only override links (open in a new tab); the rest is styled via CSS.
const mdComponents: Components = {
    a: (props) => (
        <a href={props.href} target="_blank" rel="noreferrer">
            {props.children}
        </a>
    ),
};

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

    const [input, setInput] = useState("");
    const scrollRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLTextAreaElement>(null);

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

    // Only logged-in users see the assistant.
    if (!user) return null;

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

    if (!isOpen) {
        return (
            <button
                type="button"
                className="asst-fab"
                onClick={toggle}
                title="Help Assistant"
                aria-label="Open help assistant"
            >
                <Bot size={26} strokeWidth={1.75} />
            </button>
        );
    }

    return (
        <div
            className="asst-panel"
            role="dialog"
            aria-modal="true"
            aria-label="Help assistant"
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
                <button
                    type="button"
                    className="asst-iconbtn"
                    onClick={clear}
                    title="New chat"
                    aria-label="New chat"
                >
                    <RotateCcw size={16} />
                </button>
                <button
                    type="button"
                    className="asst-iconbtn"
                    onClick={close}
                    title="Close"
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
                            {SUGGESTIONS.map((s) => (
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
                                {m.createdAt && (
                                    <span className="asst-time">
                                        {formatTime(m.createdAt)}
                                    </span>
                                )}
                            </div>
                        </div>
                    );
                })}
            </div>

            {/* Input */}
            <div className="asst-footer">
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
                            title="Stop"
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
                            title="Send"
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
