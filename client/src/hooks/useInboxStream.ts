import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { BASE_URL, refreshAccessToken } from "../http/client";
import { isPushActive } from "../lib/push";
import { useAuthStore } from "../stores/auth";

/**
 * Level 1 of the §29c notification-delivery feature: a live connection to
 * `GET /api/v1/stream/inbox` (§27 SSE) for as long as the app is open. Until
 * now that endpoint existed with no client consuming it — the bell only
 * refreshed on a 60-second poll.
 *
 * On every `notification` frame:
 *   1. Invalidate the `["notifications", …]` query family, so the bell badge
 *      and the Inbox update in about a second instead of up to a minute.
 *   2. Maybe show an OS bubble — but ONLY when Web Push is not already doing
 *      it (`isPushActive()`) and the tab is hidden. A visible tab needs no
 *      bubble (the badge is right there), and when push is live the service
 *      worker owns that job. Belt and braces: the `tag` matches the push
 *      payload's tag for the same event, so even if both fire the OS collapses
 *      them into one.
 *
 * Transport is fetch + ReadableStream (the assistant-stream pattern) rather
 * than `EventSource`, because `EventSource` cannot send an Authorization
 * header — this way the normal Bearer + refresh-once flow applies with no
 * cookie plumbing. Reconnects with capped exponential backoff and resumes from
 * `Last-Event-ID`, so a dropped connection loses nothing.
 */

/** Streamed §19 wire shape — SSE data bypasses the axios camelize adapter. */
interface WireStreamNotification {
    id?: string;
    type?: string;
    entity_type?: string;
    entity_id?: string;
    title?: string;
}

const RECONNECT_BASE_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;

/**
 * The session is gone — stop reconnecting entirely. Sign-out is owned by the
 * axios interceptor and the auth store; this hook just gets out of the way
 * instead of spinning a doomed retry loop.
 */
class SessionGone extends Error {}

const targetPathOf = (n: WireStreamNotification): string =>
    n.entity_type === "task" && n.entity_id ? `/t/${n.entity_id}` : "/inbox";

export const useInboxStream = (): void => {
    const userId = useAuthStore((s) => s.user?.id);
    const qc = useQueryClient();
    const navigate = useNavigate();

    useEffect(() => {
        if (!userId) return;
        const controller = new AbortController();
        const { signal } = controller;
        let lastEventId: string | null = null;

        const maybeShowBubble = (n: WireStreamNotification): void => {
            if (isPushActive()) return; // the service worker will show it
            if (document.visibilityState === "visible") return;
            if (!("Notification" in window)) return;
            if (Notification.permission !== "granted") return;
            try {
                const bubble = new Notification(
                    n.title || "BeautyBooth Tasks",
                    {
                        tag: `bb-${n.type ?? "event"}-${n.entity_id ?? n.id ?? ""}`,
                        icon: "/icon.svg",
                    },
                );
                bubble.onclick = () => {
                    window.focus();
                    navigate(targetPathOf(n));
                    bubble.close();
                };
            } catch {
                /* some engines only allow SW notifications — push covers those */
            }
        };

        const handleFrame = (frame: string): void => {
            let event = "message";
            let id: string | null = null;
            const dataLines: string[] = [];
            for (const line of frame.split("\n")) {
                if (line.startsWith("event:")) event = line.slice(6).trim();
                else if (line.startsWith("id:")) id = line.slice(3).trim();
                else if (line.startsWith("data:"))
                    dataLines.push(line.slice(5).trim());
            }
            if (id) lastEventId = id;
            if (event !== "notification") return; // `connected` / `heartbeat`

            let wire: WireStreamNotification = {};
            try {
                wire = JSON.parse(
                    dataLines.join("\n"),
                ) as WireStreamNotification;
            } catch {
                /* malformed frame — the refetch below still does its job */
            }
            void qc.invalidateQueries({ queryKey: ["notifications"] });
            maybeShowBubble(wire);
        };

        const open = (token: string | null): Promise<Response> =>
            fetch(`${BASE_URL}/stream/inbox`, {
                headers: {
                    Accept: "text/event-stream",
                    ...(token ? { Authorization: `Bearer ${token}` } : {}),
                    ...(lastEventId ? { "Last-Event-ID": lastEventId } : {}),
                },
                credentials: "include",
                signal,
            });

        /** One connection attempt. Resolves when the stream ends; throws to retry. */
        const connectOnce = async (): Promise<void> => {
            let res = await open(useAuthStore.getState().accessToken);
            if (res.status === 401) {
                try {
                    await refreshAccessToken();
                } catch {
                    throw new SessionGone();
                }
                res = await open(useAuthStore.getState().accessToken);
                if (res.status === 401) throw new SessionGone();
            }
            if (!res.ok || !res.body) {
                throw new Error(`inbox stream failed (${res.status})`);
            }

            const reader = res.body.getReader();
            const decoder = new TextDecoder();
            let buffer = "";
            let chunk = await reader.read();
            while (!chunk.done) {
                buffer += decoder.decode(chunk.value, { stream: true });
                const frames = buffer.split("\n\n");
                buffer = frames.pop() ?? "";
                for (const frame of frames) {
                    if (frame.trim()) handleFrame(frame);
                }
                chunk = await reader.read();
            }
        };

        void (async () => {
            let attempt = 0;
            while (!signal.aborted) {
                try {
                    await connectOnce();
                    attempt = 0; // a clean server-side end — reconnect fresh
                } catch (err) {
                    if (signal.aborted || err instanceof SessionGone) return;
                    attempt += 1; // transient: network drop, restart, 5xx
                }
                if (signal.aborted) return;
                const delay = Math.min(
                    RECONNECT_MAX_MS,
                    RECONNECT_BASE_MS * 2 ** Math.min(attempt, 5),
                );
                await new Promise((resolve) => setTimeout(resolve, delay));
            }
        })();

        return () => controller.abort();
    }, [userId, qc, navigate]);
};
