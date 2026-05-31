import { and, eq } from "drizzle-orm";
import { oneOff } from "../test-utils/app";
import { makeUser } from "../test-utils/factories";
import { getDb } from "../../src/db/client";
import { notifications } from "../../src/db/schema";
import { BASE, seed, insertNotification } from "./_helpers";

/**
 * Tests for `POST /api/v1/notifications/mark-all-read` (§19 #5) — bulk-flip every
 * unread, non-deleted notification of the caller to read.
 */

const PATH = `${BASE}/mark-all-read`;

const unreadCount = async (userId: string): Promise<number> =>
    (
        await getDb()
            .select()
            .from(notifications)
            .where(
                and(
                    eq(notifications.userId, userId),
                    eq(notifications.isRead, false),
                ),
            )
    ).length;

describe("POST /api/v1/notifications/mark-all-read", () => {
    it("marks every unread row read and returns the count flipped", async () => {
        const { user, client } = await seed();
        await insertNotification({ userId: user.id, isRead: false });
        await insertNotification({ userId: user.id, isRead: false });
        await insertNotification({ userId: user.id, isRead: true }); // already read

        const res = await client.post(PATH);
        expect(res.status).toBe(200);
        expect(res.body).toEqual({ marked_read: 2 });
        expect(await unreadCount(user.id)).toBe(0);
    });

    it("does not flip soft-deleted notifications", async () => {
        const { user, client } = await seed();
        await insertNotification({ userId: user.id, isRead: false });
        const deleted = await insertNotification({
            userId: user.id,
            isRead: false,
            deletedAt: new Date(),
        });

        const res = await client.post(PATH);
        expect(res.body).toEqual({ marked_read: 1 });
        const row = (
            await getDb()
                .select()
                .from(notifications)
                .where(eq(notifications.id, deleted))
        )[0];
        expect(row.isRead).toBe(false); // tombstone untouched
    });

    it("is idempotent — a second call flips nothing (marked_read 0)", async () => {
        const { user, client } = await seed();
        await insertNotification({ userId: user.id, isRead: false });
        await client.post(PATH);
        const res = await client.post(PATH);
        expect(res.body).toEqual({ marked_read: 0 });
    });

    it("does not touch another user's notifications", async () => {
        const { ws, user, client } = await seed();
        const other = await makeUser({ workspaceId: ws.id });
        await insertNotification({ userId: user.id, isRead: false });
        await insertNotification({ userId: other.id, isRead: false });

        await client.post(PATH);
        expect(await unreadCount(other.id)).toBe(1);
    });

    it("401 auth.missing_token with no credentials", async () => {
        const http = await oneOff();
        const res = await http.post(PATH);
        expect(res.status).toBe(401);
        expect(res.body.error.code).toBe("auth.missing_token");
    });
});
