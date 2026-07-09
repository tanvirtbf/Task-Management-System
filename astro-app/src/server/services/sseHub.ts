import type { Response } from "express";

/**
 * §27 SSE shared plumbing: the open-connection registry (for graceful
 * shutdown), the env-driven cadence knobs, and the frame writer. Kept tiny and
 * dependency-free so both the controller and `server.ts` can import it.
 */

/**
 * Every currently-open SSE response → its full per-connection disposer. An SSE
 * response never finishes on its own, so `server.close()` would hang forever
 * waiting for it — graceful shutdown must tear them down explicitly via
 * `closeAllSseStreams()`. Storing the disposer (not just the response) lets
 * shutdown run the SAME cleanup the client-disconnect path does — clearing the
 * heartbeat/poll timers IMMEDIATELY rather than waiting for the 'close' event,
 * which would otherwise leave timers firing writes onto a just-ended socket.
 */
const openStreams = new Map<Response, () => void>();

export const registerStream = (res: Response, dispose: () => void): void => {
    openStreams.set(res, dispose);
};

export const unregisterStream = (res: Response): void => {
    openStreams.delete(res);
};

/** Tear down every open SSE stream — called from `server.ts` graceful shutdown. */
export const closeAllSseStreams = (): void => {
    // Snapshot first: each disposer calls `unregisterStream`, mutating the map.
    const disposers = [...openStreams.values()];
    openStreams.clear();
    for (const dispose of disposers) {
        try {
            dispose();
        } catch {
            /* already torn down */
        }
    }
};

export const openStreamCount = (): number => openStreams.size;

/**
 * Heartbeat cadence in ms (spec: 30s). Read from `SSE_HEARTBEAT_MS` at call time
 * so a test can shrink it (e.g. 50ms) by setting the env before the app loads.
 * Read directly from `process.env` (not `Config`) so §27 needs no edit to the
 * concurrently-maintained `config/index.ts`.
 */
export const heartbeatMs = (): number =>
    Number(process.env.SSE_HEARTBEAT_MS) || 30_000;

/** Poll cadence in ms for picking up new notifications. Tests shrink via `SSE_POLL_MS`. */
export const pollMs = (): number => Number(process.env.SSE_POLL_MS) || 3_000;

/**
 * Write one SSE frame: `event:` / `data:` / (optional) `id:` lines + the blank
 * separator. Per §27 the `id:` line carries the notification `internal_id` (the
 * Last-Event-Id resume token); heartbeats/hellos omit it so they never move the
 * resume cursor. `data` is JSON-encoded onto a single line.
 */
export const writeSseEvent = (
    res: Response,
    event: string,
    data: unknown,
    id?: string,
): void => {
    // A server-initiated end (the test idle-close, or graceful shutdown) can race
    // an in-flight write. Writing after `res.end()` does NOT throw in Node — it
    // emits an unhandled 'error' on the response, which with no listener crashes
    // the whole process. Bail if the socket is already gone so no caller can
    // trip that (the controller also re-checks `closed` + registers res.on
    // ("error")).
    if (res.writableEnded || res.destroyed) return;
    let frame = `event: ${event}\n`;
    frame += `data: ${JSON.stringify(data)}\n`;
    if (id !== undefined) frame += `id: ${id}\n`;
    frame += "\n";
    res.write(frame);
};
