import { oneOff } from "../test-utils/app";
import { makeUser } from "../test-utils/factories";
import { getDb } from "../../src/db/client";
import { notifications } from "../../src/db/schema";
import { Config } from "../../src/config";
import { BASE, seed, insertNotification, signAccess } from "./_helpers";

/**
 * Tests for `GET /api/v1/notifications/unread-count` (§19 #2) — the bell badge.
 * Counts the caller's unread, non-deleted notifications only.
 */

const PATH = `${BASE}/unread-count`;

describe("GET /api/v1/notifications/unread-count", () => {
    describe("Happy path", () => {
        it("returns { unread_count } counting only unread, non-deleted rows", async () => {
            const { user, client } = await seed();
            await insertNotification({ userId: user.id, isRead: false });
            await insertNotification({ userId: user.id, isRead: false });
            await insertNotification({ userId: user.id, isRead: true }); // read
            await insertNotification({
                userId: user.id,
                isRead: false,
                deletedAt: new Date(),
            }); // deleted

            const res = await client.get(PATH);
            expect(res.status).toBe(200);
            expect(res.body).toEqual({ unread_count: 2 });
        });

        it("returns 0 when the user has no unread notifications", async () => {
            const { user, client } = await seed();
            await insertNotification({ userId: user.id, isRead: true });
            const res = await client.get(PATH);
            expect(res.body).toEqual({ unread_count: 0 });
        });
    });

    describe("Isolation", () => {
        it("counts only the caller's notifications", async () => {
            const { ws, user, client } = await seed();
            const other = await makeUser({ workspaceId: ws.id });
            await insertNotification({ userId: user.id, isRead: false });
            await insertNotification({ userId: other.id, isRead: false });
            await insertNotification({ userId: other.id, isRead: false });

            const res = await client.get(PATH);
            expect(res.body).toEqual({ unread_count: 1 });
        });
    });

    describe("Authentication", () => {
        it("401 auth.missing_token with no credentials", async () => {
            const http = await oneOff();
            const res = await http.get(PATH);
            expect(res.status).toBe(401);
            expect(res.body.error.code).toBe("auth.missing_token");
        });

        it("401 auth.expired_token for an expired token", async () => {
            const { user } = await seed();
            const token = signAccess(user, Config.ACCESS_TOKEN_SECRET!, {
                expiresIn: -10,
            });
            const http = await oneOff();
            const res = await http
                .get(PATH)
                .set("Authorization", `Bearer ${token}`);
            expect(res.status).toBe(401);
            expect(res.body.error.code).toBe("auth.expired_token");
        });
    });

    describe("Side effects", () => {
        it("a read inserts nothing", async () => {
            const { user, client } = await seed();
            await insertNotification({ userId: user.id });
            const count = async () =>
                (await getDb().select().from(notifications)).length;
            const before = await count();
            await client.get(PATH);
            expect(await count()).toBe(before);
        });
    });
});
