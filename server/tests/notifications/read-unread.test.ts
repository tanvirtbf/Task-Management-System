import { eq } from "drizzle-orm";
import { oneOff } from "../test-utils/app";
import { makeUser } from "../test-utils/factories";
import { getDb } from "../../src/db/client";
import { notifications } from "../../src/db/schema";
import { Config } from "../../src/config";
import { fakeId } from "../../src/utils";
import { BASE, seed, insertNotification, signAccess } from "./_helpers";

/**
 * Tests for `POST /api/v1/notifications/:id/read` (§19 #3) and
 * `.../:id/unread` (§19 #4) — single-row read-state flips. Owner-only:
 * another user's row is 403 `notification.not_owner`, a missing/soft-deleted row
 * is 404 `notification.not_found`.
 */

const readPath = (id: string) => `${BASE}/${id}/read`;
const unreadPath = (id: string) => `${BASE}/${id}/unread`;

const rowById = async (id: string) =>
    (
        await getDb()
            .select()
            .from(notifications)
            .where(eq(notifications.id, id))
    )[0];

describe("POST /api/v1/notifications/:id/read", () => {
    it("marks an unread notification read (200) and persists it", async () => {
        const { user, client } = await seed();
        const id = await insertNotification({ userId: user.id, isRead: false });

        const res = await client.post(readPath(id));
        expect(res.status).toBe(200);
        expect(res.body.id).toBe(id);
        expect(res.body.is_read).toBe(true);
        expect((await rowById(id)).isRead).toBe(true);
    });

    it("is idempotent — marking an already-read notification is a 200 no-op", async () => {
        const { user, client } = await seed();
        const id = await insertNotification({ userId: user.id, isRead: true });
        const res = await client.post(readPath(id));
        expect(res.status).toBe(200);
        expect(res.body.is_read).toBe(true);
    });

    it("403 notification.not_owner for another user's notification", async () => {
        const { ws, client } = await seed();
        const other = await makeUser({ workspaceId: ws.id });
        const id = await insertNotification({ userId: other.id });

        const res = await client.post(readPath(id));
        expect(res.status).toBe(403);
        expect(res.body.error.code).toBe("notification.not_owner");
        expect((await rowById(id)).isRead).toBe(false); // untouched
    });

    it("404 notification.not_found for a non-existent id", async () => {
        const { client } = await seed();
        const res = await client.post(readPath(fakeId("ntf")));
        expect(res.status).toBe(404);
        expect(res.body.error.code).toBe("notification.not_found");
    });

    it("404 notification.not_found for the caller's own soft-deleted notification", async () => {
        const { user, client } = await seed();
        const id = await insertNotification({
            userId: user.id,
            deletedAt: new Date(),
        });
        const res = await client.post(readPath(id));
        expect(res.status).toBe(404);
        expect(res.body.error.code).toBe("notification.not_found");
    });

    it("422 when the :id param exceeds 64 chars", async () => {
        const { client } = await seed();
        const res = await client.post(readPath("a".repeat(65)));
        expect(res.status).toBe(422);
        expect(res.body.error.code).toBe("validation.failed");
    });

    it("401 auth.missing_token with no credentials", async () => {
        const { user } = await seed();
        const id = await insertNotification({ userId: user.id });
        const http = await oneOff();
        const res = await http.post(readPath(id));
        expect(res.status).toBe(401);
        expect(res.body.error.code).toBe("auth.missing_token");
    });

    it("only flips the targeted row, not the user's others", async () => {
        const { user, client } = await seed();
        const target = await insertNotification({ userId: user.id });
        const other = await insertNotification({ userId: user.id });
        await client.post(readPath(target));
        expect((await rowById(other)).isRead).toBe(false);
    });
});

describe("POST /api/v1/notifications/:id/unread", () => {
    it("marks a read notification unread (200) and persists it", async () => {
        const { user, client } = await seed();
        const id = await insertNotification({ userId: user.id, isRead: true });

        const res = await client.post(unreadPath(id));
        expect(res.status).toBe(200);
        expect(res.body.is_read).toBe(false);
        expect((await rowById(id)).isRead).toBe(false);
    });

    it("clears any snooze when marking unread", async () => {
        const { user, client } = await seed();
        const id = await insertNotification({
            userId: user.id,
            isRead: true,
            snoozedUntil: new Date(Date.now() + 3_600_000),
        });

        const res = await client.post(unreadPath(id));
        expect(res.status).toBe(200);
        expect(res.body.snoozed_until).toBeNull();
        expect((await rowById(id)).snoozedUntil).toBeNull();
        expect((await rowById(id)).isRead).toBe(false);
    });

    it("403 notification.not_owner for another user's notification", async () => {
        const { ws, client } = await seed();
        const other = await makeUser({ workspaceId: ws.id });
        const id = await insertNotification({ userId: other.id, isRead: true });
        const res = await client.post(unreadPath(id));
        expect(res.status).toBe(403);
        expect(res.body.error.code).toBe("notification.not_owner");
    });

    it("404 notification.not_found for a non-existent id", async () => {
        const { client } = await seed();
        const res = await client.post(unreadPath(fakeId("ntf")));
        expect(res.status).toBe(404);
        expect(res.body.error.code).toBe("notification.not_found");
    });
});
