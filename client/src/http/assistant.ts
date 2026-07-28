import { useAuthStore } from "../stores/auth";
import { BASE_URL, refreshAccessToken } from "./client";

/**
 * Streaming client for the AI Help Assistant (see AI_ASSISTANT_PLAN.md, Phase 4).
 *
 * The shared axios instance can't stream a response, so this uses native fetch +
 * a ReadableStream reader to consume the backend's SSE (`data: {"delta"}` …
 * `data: [DONE]`). It reuses the same Bearer token + 401→refresh-once flow.
 */

// KI-5 fix: reuse client.ts's BASE_URL (env override → else derive
// `http://<host>:5501/api/v1`). Previously read VITE_BACKEND_API_URL directly,
// so an empty .env made `BASE_URL` undefined and the widget POSTed to the Vite
// origin (:5173) instead of the backend — broken locally.

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
            // Refresh failed — the session is gone; purge locally only.
            useAuthStore.getState().logout({ revoke: false });
            throw new Error(
                "আপনার সেশন শেষ হয়ে গেছে — আবার সাইন ইন করুন।",
            );
        }
        res = await postChat(body, useAuthStore.getState().accessToken, signal);
    }

    if (!res.ok || !res.body) {
        // Bangla, status-appropriate — never surface the server's raw English.
        let msg = "কিছু একটা সমস্যা হয়েছে — একটু পরে আবার চেষ্টা করুন।";
        if (res.status === 503) {
            msg = "সহায়ক এখন ব্যস্ত বা বন্ধ আছে — একটু পরে আবার চেষ্টা করুন 🙏।";
        } else if (res.status === 504) {
            msg = "উত্তর আসতে বেশি সময় লাগছে — আবার চেষ্টা করুন।";
        } else if (res.status === 403) {
            // RBAC (§34): `assistant.use` is a real permission now. Retrying
            // will never help, so say why instead of offering "try again" —
            // otherwise the panel just looks broken.
            msg =
                "সহায়ক ব্যবহারের অনুমতি আপনার রোলে দেওয়া নেই। ওয়ার্কস্পেস Owner বা Admin-কে বলুন।";
        } else if (res.status === 429) {
            msg =
                "একটু বেশি দ্রুত প্রশ্ন করা হচ্ছে — এক মিনিট পরে আবার চেষ্টা করুন।";
        }
        try {
            await res.text(); // drain the body
        } catch {
            /* ignore */
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
                    "সহায়ক একটা সমস্যায় পড়েছে — আবার চেষ্টা করুন।",
                );
            }
            if (obj.delta) onDelta(obj.delta);
        }

        chunk = await reader.read();
    }
}
