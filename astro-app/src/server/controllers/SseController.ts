import type { NextFunction, Response } from "express";
import type { Logger } from "winston";
import { NotificationStreamRepo } from "../repositories/NotificationStreamRepo";
import { toWireNotification } from "../serializers/notificationSerializer";
import {
    heartbeatMs,
    pollMs,
    registerStream,
    unregisterStream,
    writeSseEvent,
} from "../services/sseHub";
import type { StreamInboxRequest } from "../types/sse";

/** Max notifications delivered per poll iteration (incl. the resume backlog). */
const MAX_BATCH = 200;
/** Upper bound on the test-only idle auto-close, so a test can never hang long. */
const MAX_TEST_IDLE_MS = 5_000;
/** `BIGINT UNSIGNED` ceiling — a Last-Event-Id above this is treated as bogus. */
const MAX_INTERNAL_ID = 18446744073709551615n;

/**
 * §27 Server-Sent Events. The single XL endpoint streams the caller's
 * notifications without polling on the client side.
 *
 * Delivery is a per-connection DB poll (NOT an in-process EventEmitter): the
 * sole notification-insert choke point (§19 `NotificationsRepo.createMany`) is a
 * concurrently-built file that returns void (no `internal_id`) and runs
 * pre-commit inside a transaction, so a correct, post-commit, id-carrying
 * publish would require invasive edits there. Polling is fully decoupled (zero
 * §19 edits), correct, and easy to isolate per test; an EventEmitter / Redis
 * fan-out is the documented upgrade path (same external behaviour).
 */
export class SseController {
    constructor(
        private repo: NotificationStreamRepo,
        private logger: Logger,
    ) {}

    /**
     * GET /api/v1/stream/inbox — long-lived `text/event-stream`. 🔐 cookie auth
     * (an `EventSource` cannot set an Authorization header). Emits a `connected`
     * hello, `notification` events (data = §19 wire Notification, `id:` =
     * `internal_id`), and a `heartbeat` every 30s. Resumes from `Last-Event-Id`
     * (replays missed notifications, ascending). Cleans up the timers + registry
     * on disconnect.
     */
    async streamInbox(
        req: StreamInboxRequest,
        res: Response,
        next: NextFunction,
    ): Promise<void> {
        const userId = req.auth.sub;

        // ── Pre-flush: resolve the resume cursor. A failure here CAN still flow
        // through the JSON error handler (headers not yet sent). ──
        let lastSeen: bigint;
        try {
            const headerId = req.headers["last-event-id"];
            const queryId = req.query.last_event_id;
            const raw =
                (typeof headerId === "string" ? headerId : undefined) ??
                (typeof queryId === "string" ? queryId : undefined);
            if (raw && /^\d+$/.test(raw)) {
                const parsed = BigInt(raw);
                // An absurd cursor above the BIGINT UNSIGNED ceiling can never
                // match a real internal_id — degrade to a fresh connect (go live)
                // rather than feed an out-of-range literal to the driver.
                lastSeen =
                    parsed > MAX_INTERNAL_ID
                        ? await this.repo.maxInternalIdForUser(userId)
                        : parsed; // resume — replay everything after this id
            } else {
                lastSeen = await this.repo.maxInternalIdForUser(userId); // fresh — go live
            }
        } catch (err) {
            return next(err);
        }

        let pollTimer: NodeJS.Timeout | undefined;
        let heartbeatTimer: NodeJS.Timeout | undefined;
        let idleTimer: NodeJS.Timeout | undefined;
        let closed = false;
        let polling = false;

        const cleanup = (): void => {
            if (closed) return;
            closed = true;
            if (pollTimer) clearInterval(pollTimer);
            if (heartbeatTimer) clearInterval(heartbeatTimer);
            if (idleTimer) clearTimeout(idleTimer);
            unregisterStream(res);
            try {
                res.end();
            } catch {
                /* already ended */
            }
        };

        // ── Post-flush: the response is committed. NEVER call next(err) now (the
        // global errorHandler has no headersSent guard and would crash); on any
        // error log + end the stream. ──
        try {
            res.writeHead(200, {
                "Content-Type": "text/event-stream; charset=utf-8",
                "Cache-Control": "no-cache, no-transform",
                Connection: "keep-alive",
                "X-Accel-Buffering": "no", // stop nginx buffering the stream
            });
            res.flushHeaders?.();
            req.socket?.setTimeout?.(0); // disable the idle-socket timeout

            registerStream(res, cleanup);
            req.on("close", cleanup);
            res.on("close", cleanup);
            // A stray write-after-end surfaces as a response 'error' event (not a
            // throw) — handle it so it can never become an uncaught exception.
            res.on("error", cleanup);

            writeSseEvent(res, "connected", { now: new Date().toISOString() });

            const pollOnce = async (): Promise<void> => {
                // Re-entrancy guard: if a poll runs longer than the interval, the
                // next tick must NOT overlap it — two concurrent polls would read
                // the same `lastSeen`, re-deliver the same rows (duplicate frames),
                // and race the cursor. Overlapping ticks simply skip.
                if (closed || polling) return;
                polling = true;
                try {
                    const rows = await this.repo.notificationsAfter(
                        userId,
                        lastSeen,
                        MAX_BATCH,
                    );
                    for (const row of rows) {
                        // cleanup() may have run during the await above; stop
                        // writing the moment the stream is closed.
                        if (closed) break;
                        writeSseEvent(
                            res,
                            "notification",
                            toWireNotification(row),
                            row.internalId.toString(),
                        );
                        lastSeen = row.internalId;
                    }
                } catch (err) {
                    this.logger.error("sse.inbox.poll_failed", {
                        requestId: req.requestId,
                        userId,
                        error:
                            err instanceof Error ? err.message : String(err),
                    });
                    // Keep the stream open; the next poll retries.
                } finally {
                    polling = false;
                }
            };

            // First poll replays the Last-Event-Id backlog (or nothing for a
            // fresh connect); the interval then picks up new notifications.
            await pollOnce();
            if (closed) return; // client disconnected during the first poll

            pollTimer = setInterval(() => void pollOnce(), pollMs());
            pollTimer.unref?.();
            heartbeatTimer = setInterval(() => {
                try {
                    writeSseEvent(res, "heartbeat", {
                        now: new Date().toISOString(),
                    });
                } catch {
                    /* socket gone; the close handler cleans up */
                }
            }, heartbeatMs());
            heartbeatTimer.unref?.();

            // Test-only: auto-close after N ms so supertest can buffer + resolve
            // the (otherwise infinite) response. Inert in production.
            if (process.env.NODE_ENV === "test") {
                const raw = req.query._test_idle_close_ms;
                const ms = typeof raw === "string" ? Number(raw) : NaN;
                if (Number.isFinite(ms) && ms > 0) {
                    idleTimer = setTimeout(cleanup, Math.min(ms, MAX_TEST_IDLE_MS));
                }
            }
        } catch (err) {
            this.logger.error("sse.inbox.stream_failed", {
                requestId: req.requestId,
                userId,
                error: err instanceof Error ? err.message : String(err),
            });
            cleanup();
        }
    }
}
