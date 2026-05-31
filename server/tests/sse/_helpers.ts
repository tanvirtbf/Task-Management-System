import { eq } from "drizzle-orm";
import type { Test } from "supertest";
import { getDb } from "../../src/db/client";
import { notifications } from "../../src/db/schema";
import type { Notification } from "../../src/db/schema";
import { fakeId } from "../../src/utils";
import type { Role } from "../../src/constants";
import type { LoggedInClient } from "../test-utils/app";
import { makeLoggedInClient, makeUser } from "../test-utils/factories";

/** One parsed SSE frame. */
export interface SseFrame {
    event?: string;
    data: string;
    id?: string;
}

/**
 * Parse a full SSE body (the buffered text of a finite, idle-closed stream) into
 * its frames. Blank-line-delimited blocks; the single leading space after each
 * field colon is stripped per the SSE spec; pure-comment lines (`:`-prefixed)
 * are ignored.
 */
export const parseFrames = (text: string): SseFrame[] => {
    const frames: SseFrame[] = [];
    for (const block of text.split("\n\n")) {
        if (block.trim() === "") continue;
        const frame: SseFrame = { data: "" };
        const dataLines: string[] = [];
        for (const line of block.split("\n")) {
            if (line === "" || line.startsWith(":")) continue;
            const idx = line.indexOf(":");
            const field = idx === -1 ? line : line.slice(0, idx);
            let value = idx === -1 ? "" : line.slice(idx + 1);
            if (value.startsWith(" ")) value = value.slice(1);
            if (field === "event") frame.event = value;
            else if (field === "data") dataLines.push(value);
            else if (field === "id") frame.id = value;
        }
        frame.data = dataLines.join("\n");
        if (frame.event !== undefined || frame.data !== "") frames.push(frame);
    }
    return frames;
};

export const framesOfType = (text: string, event: string): SseFrame[] =>
    parseFrames(text).filter((f) => f.event === event);

/**
 * Open the SSE stream and resolve with the buffered response once the test-only
 * idle timer auto-closes it. `.buffer(true)` forces superagent to collect the
 * (now finite) `text/event-stream` body into `res.text`. Returns the pending
 * promise WITHOUT awaiting — for a live-publish test, hold it, trigger an insert,
 * then await.
 */
export const openStream = (
    client: LoggedInClient,
    opts: { idleMs: number; lastEventId?: string } = { idleMs: 200 },
): Promise<import("supertest").Response> => {
    let test: Test = client
        .get(`/api/v1/stream/inbox?_test_idle_close_ms=${opts.idleMs}`)
        .buffer(true);
    if (opts.lastEventId !== undefined) {
        test = test.set("Last-Event-Id", opts.lastEventId);
    }
    return test.then((r) => r);
};

export interface InsertNotificationInput {
    userId: string;
    type?: Notification["type"];
    entityType?: Notification["entityType"];
    entityId?: string;
    actorId?: string | null;
    title?: string;
    body?: string | null;
}

/**
 * Insert a notification row directly (§19 exposes no create endpoint), then
 * re-read it so the caller gets the DB-assigned `internal_id`.
 */
export const insertNotification = async (input: InsertNotificationInput) => {
    const db = getDb();
    const id = fakeId("ntf");
    await db.insert(notifications).values({
        id,
        userId: input.userId,
        type: input.type ?? "assigned",
        entityType: input.entityType ?? "task",
        entityId: input.entityId ?? fakeId("t"),
        actorId: input.actorId ?? null,
        title: input.title ?? "You were assigned a task",
        body: input.body ?? null,
    });
    const [row] = await db
        .select()
        .from(notifications)
        .where(eq(notifications.id, id));
    return row;
};

export const seed = async (role: Role = "member") => {
    const user = await makeUser({ role });
    const client = await makeLoggedInClient(user);
    return { user, client };
};

export const sleep = (ms: number): Promise<void> =>
    new Promise((resolve) => setTimeout(resolve, ms));
