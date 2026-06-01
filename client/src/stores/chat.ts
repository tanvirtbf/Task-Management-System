import { create } from "zustand";
import { devtools, persist } from "zustand/middleware";
import { streamChat, type ChatTurn } from "../http/assistant";

/** A chat message shown in the assistant widget. */
export interface ChatMessage {
    id: string;
    role: "user" | "assistant";
    content: string;
    /** Epoch ms; optional so older persisted messages still load. */
    createdAt?: number;
}

interface ChatState {
    isOpen: boolean;
    messages: ChatMessage[];
    isStreaming: boolean;
    error: string | null;
    /** Server conversation id this thread persists to (Phase 6). */
    conversationId: string | null;
    open: () => void;
    close: () => void;
    toggle: () => void;
    clear: () => void;
    stop: () => void;
    sendMessage: (text: string) => Promise<void>;
}

// The in-flight stream's controller — kept outside the store (not serialisable).
let activeController: AbortController | null = null;

const newId = (): string =>
    Math.random().toString(36).slice(2) + Date.now().toString(36);

/**
 * AI Help Assistant chat store (see AI_ASSISTANT_PLAN.md, Phase 4). Drives the
 * floating widget; streams replies via `streamChat`. The conversation
 * (`messages`) is persisted to localStorage so it survives reloads/navigation.
 */
export const useChatStore = create<ChatState>()(
    devtools(
        persist(
            (set, get) => ({
                isOpen: false,
                messages: [],
                isStreaming: false,
                error: null,
                conversationId: null,

                open: () => set({ isOpen: true }),
                close: () => set({ isOpen: false }),
                toggle: () => set({ isOpen: !get().isOpen }),

                stop: () => {
                    activeController?.abort();
                    activeController = null;
                    set({ isStreaming: false });
                },

                clear: () => {
                    get().stop();
                    set({ messages: [], error: null, conversationId: null });
                },

                sendMessage: async (text) => {
                    const content = text.trim();
                    if (!content || get().isStreaming) return;

                    // History = the conversation so far (before this new turn).
                    const history: ChatTurn[] = get().messages.map((m) => ({
                        role: m.role,
                        content: m.content,
                    }));
                    const now = Date.now();
                    const userMsg: ChatMessage = {
                        id: newId(),
                        role: "user",
                        content,
                        createdAt: now,
                    };
                    const assistantMsg: ChatMessage = {
                        id: newId(),
                        role: "assistant",
                        content: "",
                        createdAt: now,
                    };
                    set({
                        messages: [...get().messages, userMsg, assistantMsg],
                        isStreaming: true,
                        error: null,
                    });

                    activeController = new AbortController();
                    try {
                        await streamChat({
                            message: content,
                            history,
                            conversationId: get().conversationId,
                            signal: activeController.signal,
                            onConversationId: (id) =>
                                set({ conversationId: id }),
                            onDelta: (delta) =>
                                set((state) => ({
                                    messages: state.messages.map((m) =>
                                        m.id === assistantMsg.id
                                            ? {
                                                  ...m,
                                                  content: m.content + delta,
                                              }
                                            : m,
                                    ),
                                })),
                        });
                    } catch (err) {
                        const aborted =
                            err instanceof DOMException &&
                            err.name === "AbortError";
                        if (!aborted) {
                            const msg =
                                err instanceof Error
                                    ? err.message
                                    : "Something went wrong. Please try again.";
                            set((state) => ({
                                error: msg,
                                // If nothing streamed, show the error in the bubble.
                                messages: state.messages.map((m) =>
                                    m.id === assistantMsg.id && m.content === ""
                                        ? { ...m, content: `⚠️ ${msg}` }
                                        : m,
                                ),
                            }));
                        }
                    } finally {
                        activeController = null;
                        set({ isStreaming: false });
                    }
                },
            }),
            {
                name: "th-chat",
                // Persist only the conversation; UI/stream flags reset each load.
                partialize: (s) => ({
                    messages: s.messages,
                    conversationId: s.conversationId,
                }),
            },
        ),
        { name: "ChatStore" },
    ),
);
