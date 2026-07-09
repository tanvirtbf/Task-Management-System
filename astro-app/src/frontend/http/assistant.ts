import { useAuthStore } from "../stores/auth";
import { refreshAccessToken } from "./client";

/**
 * Streaming client for the AI Help Assistant (see AI_ASSISTANT_PLAN.md, Phase 4).
 *
 * The shared axios instance can't stream a response, so this uses native fetch +
 * a ReadableStream reader to consume the backend's SSE (`data: {"delta"}` …
 * `data: [DONE]`). It reuses the same Bearer token + 401→refresh-once flow.
 */

// Same-origin API (see http/client.ts) — an explicit VITE_BACKEND_API_URL wins.
const BASE_URL: string =
    import.meta.env.VITE_BACKEND_API_URL?.trim() ||
    `${window.location.origin}/api/v1`;

export interface ChatTurn {
    role: "user" | "assistant";
    content: string;
}

export interface StreamChatParams {
    message: string;
    history: ChatTurn[];
    /** Existing conversation to continue (Phase 6); omitted starts a new one. */
    conversationId?: string | null;
    onDelta: (delta: string) => void;
    /** Called with the server-assigned conversation id (from the response). */
    onConversationId?: (id: string) => void;
    signal?: AbortSignal;
}

/** Shape of a single SSE `data:` payload from the assistant endpoint. */
interface SseEvent {
    delta?: string;
    error?: string;
    message?: string;
}

const postChat = (
    body: string,
    token: string | null,
    signal?: AbortSignal,
): Promise<Response> =>
    fetch(`${BASE_URL}/assistant/chat`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Accept: "text/event-stream",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        credentials: "include",
        body,
        signal,
    });

/**
 * Stream a reply: calls `onDelta` for each text chunk and resolves when the
 * stream ends. Rejects with a friendly Error on failure; if `signal` is aborted
 * it rejects with an AbortError (the caller treats that as a clean stop).
 */
export async function streamChat(params: StreamChatParams): Promise<void> {
    const {
        message,
        history,
        conversationId,
        onDelta,
        onConversationId,
        signal,
    } = params;
    const body = JSON.stringify({
        message,
        history,
        conversationId: conversationId ?? undefined,
    });

    let res = await postChat(body, useAuthStore.getState().accessToken, signal);

    // 401 → refresh the access token once → retry.
    if (res.status === 401) {
        try {
            await refreshAccessToken();
        } catch {
            useAuthStore.getState().logout();
            throw new Error("Your session has expired. Please sign in again.");
        }
        res = await postChat(body, useAuthStore.getState().accessToken, signal);
    }

    if (!res.ok || !res.body) {
        let msg = "The assistant is unavailable right now. Please try again.";
        try {
            const data = (await res.json()) as { error?: { message?: string } };
            if (data?.error?.message) msg = data.error.message;
        } catch {
            /* response body was not JSON — keep the default message */
        }
        throw new Error(msg);
    }

    // The server returns the conversation id it persisted to (Phase 6).
    const cid = res.headers.get("X-Conversation-Id");
    if (cid && onConversationId) onConversationId(cid);

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    let chunk = await reader.read();
    while (!chunk.done) {
        buffer += decoder.decode(chunk.value, { stream: true });

        // SSE events are separated by a blank line; keep the trailing partial.
        const events = buffer.split("\n\n");
        buffer = events.pop() ?? "";

        for (const evt of events) {
            const line = evt.trim();
            if (!line.startsWith("data:")) continue;
            const payload = line.slice(5).trim();
            if (payload === "[DONE]") return;

            let obj: SseEvent | null = null;
            try {
                obj = JSON.parse(payload) as SseEvent;
            } catch {
                obj = null; // ignore a malformed / partial event
            }
            if (!obj) continue;
            if (obj.error) {
                throw new Error(
                    obj.message ?? "The assistant ran into a problem.",
                );
            }
            if (obj.delta) onDelta(obj.delta);
        }

        chunk = await reader.read();
    }
}
