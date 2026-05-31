import { eq } from "drizzle-orm";
import { oneOff } from "../test-utils/app";
import { makeUser } from "../test-utils/factories";
import { getDb } from "../../src/db/client";
import { notifications } from "../../src/db/schema";
import { fakeId } from "../../src/utils";
import { BASE, seed, insertNotification } from "./_helpers";

/**
 * Tests for `POST /api/v1/notifications/:id/snooze` (§19 #6). Sets a future
 * `snoozed_until` AND marks the row read (so it leaves the unread badge until
 * the §28 worker revives it). Owner-only; `snoozed_until` must be a future ISO.
 */

const snoozePath = (id: string) => `${BASE}/${id}/snooze`;
const future = (ms = 3_600_000) => new Date(Date.now() + ms).toISOString();
const rowById = async (id: string) =>
    (
        await getDb()
            .select()
            .from(notifications)
            .where(eq(notifications.id, id))
    )[0];

describe("POST /api/v1/notifications/:id/snooze", () => {
    it("snoozes an own notification (200): sets snoozed_until + marks read", async () => {
        const { user, client } = await seed();
        const id = await insertNotification({ userId: user.id, isRead: false });
        const until = future();

        const res = await client.post(snoozePath(id)).send({
            snoozed_until: until,
        });
        expect(res.status).toBe(200);
        expect(res.body.id).toBe(id);
        expect(res.body.is_read).toBe(true);
        expect(new Date(res.body.snoozed_until).getTime()).toBe(
            new Date(until).getTime(),
        );

        const row = await rowById(id);
        expect(row.isRead).toBe(true);
        expect(row.snoozedUntil).not.toBeNull();
    });

    it("drops the snoozed row out of the unread count", async () => {
        const { user, client } = await seed();
        const id = await insertNotification({ userId: user.id, isRead: false });
        await client.post(snoozePath(id)).send({ snoozed_until: future() });

        const res = await client.get(`${BASE}/unread-count`);
        expect(res.body).toEqual({ unread_count: 0 });
    });

    describe("Validation", () => {
        it("422 when snoozed_until is missing", async () => {
            const { user, client } = await seed();
            const id = await insertNotification({ userId: user.id });
            const res = await client.post(snoozePath(id)).send({});
            expect(res.status).toBe(422);
            expect(res.body.error.code).toBe("validation.failed");
        });

        it("422 when snoozed_until is not an ISO-8601 timestamp", async () => {
            const { user, client } = await seed();
            const id = await insertNotification({ userId: user.id });
            const res = await client
                .post(snoozePath(id))
                .send({ snoozed_until: "not-a-date" });
            expect(res.status).toBe(422);
            expect(res.body.error.code).toBe("validation.failed");
        });

        it("422 when snoozed_until is in the past", async () => {
            const { user, client } = await seed();
            const id = await insertNotification({ userId: user.id });
            const past = new Date(Date.now() - 3_600_000).toISOString();
            const res = await client
                .post(snoozePath(id))
                .send({ snoozed_until: past });
            expect(res.status).toBe(422);
            expect(res.body.error.code).toBe("validation.failed");
        });
    });

    it("403 notification.not_owner for another user's notification", async () => {
        const { ws, client } = await seed();
        const other = await makeUser({ workspaceId: ws.id });
        const id = await insertNotification({ userId: other.id });
        const res = await client
            .post(snoozePath(id))
            .send({ snoozed_until: future() });
        expect(res.status).toBe(403);
        expect(res.body.error.code).toBe("notification.not_owner");
    });

    it("404 notification.not_found for a non-existent id", async () => {
        const { client } = await seed();
        const res = await client
            .post(snoozePath(fakeId("ntf")))
            .send({ snoozed_until: future() });
        expect(res.status).toBe(404);
        expect(res.body.error.code).toBe("notification.not_found");
    });

    it("401 auth.missing_token with no credentials", async () => {
        const { user } = await seed();
        const id = await insertNotification({ userId: user.id });
        const http = await oneOff();
        const res = await http
            .post(snoozePath(id))
            .send({ snoozed_until: future() });
        expect(res.status).toBe(401);
        expect(res.body.error.code).toBe("auth.missing_token");
    });
});
