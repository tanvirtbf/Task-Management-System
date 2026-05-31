import { eq } from "drizzle-orm";
import { oneOff } from "../test-utils/app";
import { makeUser } from "../test-utils/factories";
import { getDb } from "../../src/db/client";
import { notifications } from "../../src/db/schema";
import { fakeId } from "../../src/utils";
import { BASE, seed, insertNotification, idsOf } from "./_helpers";

/**
 * Tests for `DELETE /api/v1/notifications/:id` (§19 #7) — soft-delete: stamps
 * `deleted_at`, hides the row from the feed + counts, and returns 204. Owner-only;
 * a re-delete of an already-deleted row reads as 404 (gone).
 */

const delPath = (id: string) => `${BASE}/${id}`;
const rowById = async (id: string) =>
    (
        await getDb()
            .select()
            .from(notifications)
            .where(eq(notifications.id, id))
    )[0];

describe("DELETE /api/v1/notifications/:id", () => {
    it("soft-deletes an own notification (204) and stamps deleted_at", async () => {
        const { user, client } = await seed();
        const id = await insertNotification({ userId: user.id });

        const res = await client.delete(delPath(id));
        expect(res.status).toBe(204);
        expect(res.body).toEqual({});
        expect((await rowById(id)).deletedAt).not.toBeNull();
    });

    it("removes the notification from the feed and the unread count", async () => {
        const { user, client } = await seed();
        const keep = await insertNotification({ userId: user.id });
        const drop = await insertNotification({ userId: user.id });

        await client.delete(delPath(drop));

        const feed = await client.get(BASE);
        expect(idsOf(feed.body)).toEqual([keep]);
        expect(feed.body.pagination.total_estimate).toBe(1);

        const count = await client.get(`${BASE}/unread-count`);
        expect(count.body).toEqual({ unread_count: 1 });
    });

    it("is a 404 on re-delete (an already-deleted row reads as gone)", async () => {
        const { user, client } = await seed();
        const id = await insertNotification({ userId: user.id });
        const first = await client.delete(delPath(id));
        expect(first.status).toBe(204);
        const second = await client.delete(delPath(id));
        expect(second.status).toBe(404);
        expect(second.body.error.code).toBe("notification.not_found");
    });

    it("403 notification.not_owner for another user's notification (left intact)", async () => {
        const { ws, client } = await seed();
        const other = await makeUser({ workspaceId: ws.id });
        const id = await insertNotification({ userId: other.id });

        const res = await client.delete(delPath(id));
        expect(res.status).toBe(403);
        expect(res.body.error.code).toBe("notification.not_owner");
        expect((await rowById(id)).deletedAt).toBeNull();
    });

    it("404 notification.not_found for a non-existent id", async () => {
        const { client } = await seed();
        const res = await client.delete(delPath(fakeId("ntf")));
        expect(res.status).toBe(404);
        expect(res.body.error.code).toBe("notification.not_found");
    });

    it("422 when the :id param exceeds 64 chars", async () => {
        const { client } = await seed();
        const res = await client.delete(delPath("a".repeat(65)));
        expect(res.status).toBe(422);
        expect(res.body.error.code).toBe("validation.failed");
    });

    it("401 auth.missing_token with no credentials", async () => {
        const { user } = await seed();
        const id = await insertNotification({ userId: user.id });
        const http = await oneOff();
        const res = await http.delete(delPath(id));
        expect(res.status).toBe(401);
        expect(res.body.error.code).toBe("auth.missing_token");
    });

    it("leaves the user's other notifications untouched", async () => {
        const { user, client } = await seed();
        const target = await insertNotification({ userId: user.id });
        const other = await insertNotification({ userId: user.id });
        await client.delete(delPath(target));
        expect((await rowById(other)).deletedAt).toBeNull();
    });
});
