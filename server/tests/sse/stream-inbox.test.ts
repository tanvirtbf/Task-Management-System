import { oneOff } from "../test-utils/app";
import {
    framesOfType,
    insertNotification,
    openStream,
    parseFrames,
    seed,
    sleep,
} from "./_helpers";

/**
 * §27 #1 — GET /api/v1/stream/inbox
 *
 * Long-lived SSE stream of the caller's notifications. 🔐 cookie auth. Emits a
 * `connected` hello, `notification` events (data = §19 wire Notification, id =
 * internal_id), and a `heartbeat` every (test: 50ms). Resumes from Last-Event-Id.
 *
 * Tests use a test-only `?_test_idle_close_ms=N` so the otherwise-infinite stream
 * auto-closes and supertest can buffer + resolve the body.
 */

const WIRE_KEYS = [
    "id",
    "type",
    "entity_type",
    "entity_id",
    "actor_id",
    "title",
    "body",
    "is_read",
    "snoozed_until",
    "created_at",
].sort();

describe("GET /api/v1/stream/inbox", () => {
    describe("authentication", () => {
        it("rejects a request with no token (401, pre-stream JSON error)", async () => {
            const http = await oneOff();
            const res = await http.get("/api/v1/stream/inbox");
            expect(res.status).toBe(401);
            expect(res.body.error).toBeDefined();
        });
    });

    describe("headers + hello", () => {
        it("responds 200 with text/event-stream headers", async () => {
            const { client } = await seed();
            const res = await openStream(client, { idleMs: 150 });

            expect(res.status).toBe(200);
            expect(res.headers["content-type"]).toContain("text/event-stream");
            expect(res.headers["cache-control"]).toContain("no-cache");
        });

        it("opens with a `connected` hello frame", async () => {
            const { client } = await seed();
            const res = await openStream(client, { idleMs: 150 });

            const hello = parseFrames(res.text)[0];
            expect(hello.event).toBe("connected");
            expect(JSON.parse(hello.data)).toHaveProperty("now");
        });
    });

    describe("heartbeat", () => {
        it("emits at least one heartbeat frame", async () => {
            const { client } = await seed();
            const res = await openStream(client, { idleMs: 260 }); // ~5 × 50ms

            const beats = framesOfType(res.text, "heartbeat");
            expect(beats.length).toBeGreaterThanOrEqual(1);
            expect(JSON.parse(beats[0].data)).toHaveProperty("now");
            expect(beats[0].id).toBeUndefined(); // heartbeats never carry a resume id
        });
    });

    describe("fresh connect (no Last-Event-Id)", () => {
        it("does NOT replay the historical backlog", async () => {
            const { user, client } = await seed();
            await insertNotification({ userId: user.id, title: "Old 1" });
            await insertNotification({ userId: user.id, title: "Old 2" });

            const res = await openStream(client, { idleMs: 200 });

            expect(framesOfType(res.text, "notification")).toHaveLength(0);
        });
    });

    describe("live delivery", () => {
        it("pushes a notification created after the connection opens", async () => {
            const { user, client } = await seed();

            const pending = openStream(client, { idleMs: 700 });
            await sleep(160); // let the stream open + first poll establish the cursor
            const row = await insertNotification({
                userId: user.id,
                title: "Live ping",
                body: "hello",
            });
            const res = await pending;

            const notifs = framesOfType(res.text, "notification");
            expect(notifs).toHaveLength(1);
            const payload = JSON.parse(notifs[0].data);
            expect(payload.title).toBe("Live ping");
            expect(payload.body).toBe("hello");
            // id: line is the internal_id (the Last-Event-Id resume token)
            expect(notifs[0].id).toBe(row.internalId.toString());
        });

        it("emits the §19 snake_case Notification shape and leaks no internals", async () => {
            const { user, client } = await seed();

            const pending = openStream(client, { idleMs: 600 });
            await sleep(160);
            await insertNotification({ userId: user.id, title: "Shape check" });
            const res = await pending;

            const payload = JSON.parse(
                framesOfType(res.text, "notification")[0].data,
            );
            expect(Object.keys(payload).sort()).toEqual(WIRE_KEYS);
            expect(payload).not.toHaveProperty("internal_id");
            expect(payload).not.toHaveProperty("user_id");
            expect(payload).not.toHaveProperty("deleted_at");
        });
    });

    describe("Last-Event-Id resume", () => {
        it("replays missed notifications since the id, ascending (header)", async () => {
            const { user, client } = await seed();
            const n1 = await insertNotification({ userId: user.id, title: "n1" });
            const n2 = await insertNotification({ userId: user.id, title: "n2" });
            const n3 = await insertNotification({ userId: user.id, title: "n3" });

            const res = await openStream(client, {
                idleMs: 250,
                lastEventId: n1.internalId.toString(),
            });

            const notifs = framesOfType(res.text, "notification");
            expect(notifs.map((f) => JSON.parse(f.data).title)).toEqual([
                "n2",
                "n3",
            ]);
            expect(notifs.map((f) => f.id)).toEqual([
                n2.internalId.toString(),
                n3.internalId.toString(),
            ]);
        });

        it("supports the ?last_event_id query param as a fallback", async () => {
            const { user, client } = await seed();
            const n1 = await insertNotification({ userId: user.id, title: "q1" });
            const n2 = await insertNotification({ userId: user.id, title: "q2" });

            const test = client
                .get(
                    `/api/v1/stream/inbox?_test_idle_close_ms=200&last_event_id=${n1.internalId.toString()}`,
                )
                .buffer(true);
            const res = await test.then((r) => r);

            const notifs = framesOfType(res.text, "notification");
            expect(notifs.map((f) => JSON.parse(f.data).title)).toEqual(["q2"]);
            expect(n2).toBeTruthy();
        });
    });

    describe("per-user isolation", () => {
        it("never delivers another user's notifications", async () => {
            const { user: userA, client: clientA } = await seed();
            const { user: userB } = await seed();

            const pending = openStream(clientA, { idleMs: 600 });
            await sleep(160);
            await insertNotification({ userId: userB.id, title: "For B only" });
            const mine = await insertNotification({
                userId: userA.id,
                title: "For A",
            });
            const res = await pending;

            const notifs = framesOfType(res.text, "notification");
            expect(notifs).toHaveLength(1);
            expect(JSON.parse(notifs[0].data).title).toBe("For A");
            expect(notifs[0].id).toBe(mine.internalId.toString());
        });
    });

    describe("robustness", () => {
        it("treats an out-of-range Last-Event-Id as a fresh connect (no crash)", async () => {
            const { user, client } = await seed();
            await insertNotification({ userId: user.id, title: "Backlog" });

            const res = await openStream(client, {
                idleMs: 180,
                lastEventId: "9".repeat(30), // far above the BIGINT UNSIGNED ceiling
            });

            expect(res.status).toBe(200);
            // a bogus cursor degrades to "go live" — no backlog replay
            expect(framesOfType(res.text, "notification")).toHaveLength(0);
        });

        it("survives the stream closing around a delivery (no write-after-end crash)", async () => {
            const { user, client } = await seed();
            // Rapid connect → insert-during-open → idle-close cycles. If the
            // write-after-end guard regressed, an unhandled response 'error' would
            // crash the worker and fail the whole run.
            for (let i = 0; i < 4; i++) {
                const pending = openStream(client, { idleMs: 90 });
                await sleep(45);
                await insertNotification({ userId: user.id, title: `race ${i}` });
                const res = await pending;
                expect(res.status).toBe(200);
            }
        });
    });
});
