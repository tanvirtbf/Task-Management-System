import { oneOff } from "../test-utils/app";
import { makeUser, makeWorkspace, makeLoggedInClient } from "../test-utils/factories";
import { getDb } from "../../src/db/client";
import { notifications } from "../../src/db/schema";
import { fakeId } from "../../src/utils";
import { Config } from "../../src/config";
import { BASE, seed, insertNotification, signAccess, idsOf } from "./_helpers";

/**
 * Tests for `GET /api/v1/notifications` (§19 #1) — the per-user inbox feed:
 * unread-first, then newest-first (internal_id DESC), soft-deleted excluded,
 * compound `(is_read, internal_id)` keyset cursor, `{data,pagination}` envelope.
 *
 * The suite does NOT truncate between tests (see `setup-each-notifications.ts`):
 * every test mints a fresh user and all queries are user-scoped, and notification
 * ids are unique (captured from `insertNotification`), so accumulated rows from
 * earlier tests never collide or leak into a fresh user's feed.
 */

const WIRE_KEYS = [
    "actor_id",
    "body",
    "created_at",
    "entity_id",
    "entity_type",
    "id",
    "is_read",
    "snoozed_until",
    "title",
    "type",
].sort();

describe("GET /api/v1/notifications", () => {
    describe("Happy path", () => {
        it("returns the {data,pagination} envelope (200)", async () => {
            const { user, client } = await seed();
            await insertNotification({ userId: user.id });

            const res = await client.get(BASE);
            expect(res.status).toBe(200);
            expect(Array.isArray(res.body.data)).toBe(true);
            expect(res.body.pagination).toEqual({
                next_cursor: null,
                has_more: false,
                total_estimate: 1,
            });
        });

        it("each row carries exactly the 10 wire keys (no internal_id/user_id/deleted_at leak)", async () => {
            const { user, client } = await seed();
            await insertNotification({ userId: user.id });

            const res = await client.get(BASE);
            expect(Object.keys(res.body.data[0]).sort()).toEqual(WIRE_KEYS);
            const raw = JSON.stringify(res.body.data[0]);
            expect(raw).not.toContain("internal_id");
            expect(raw).not.toContain("user_id");
            expect(raw).not.toContain("deleted_at");
            expect(raw).not.toContain("email_sent_at");
        });

        it("echoes the stored fields verbatim with ISO timestamps", async () => {
            const { user, client } = await seed();
            await insertNotification({
                userId: user.id,
                type: "mentioned",
                entityType: "comment",
                entityId: "c-123",
                title: "Rina mentioned you",
                body: "See the latest note",
                isRead: false,
            });

            const row = (await client.get(BASE)).body.data[0];
            expect(row.type).toBe("mentioned");
            expect(row.entity_type).toBe("comment");
            expect(row.entity_id).toBe("c-123");
            expect(row.title).toBe("Rina mentioned you");
            expect(row.body).toBe("See the latest note");
            expect(row.is_read).toBe(false);
            expect(row.snoozed_until).toBeNull();
            expect(row.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
        });

        it("returns an empty page (not 404) for a user with no notifications", async () => {
            const { client } = await seed();
            const res = await client.get(BASE);
            expect(res.status).toBe(200);
            expect(res.body.data).toEqual([]);
            expect(res.body.pagination).toEqual({
                next_cursor: null,
                has_more: false,
                total_estimate: 0,
            });
        });
    });

    describe("Ordering (unread-first, then newest-first)", () => {
        it("lists unread before read, each group by internal_id DESC", async () => {
            const { user, client } = await seed();
            // insertion order = ascending internal_id
            const n1 = await insertNotification({ userId: user.id, isRead: true });
            const n2 = await insertNotification({ userId: user.id, isRead: false });
            const n3 = await insertNotification({ userId: user.id, isRead: true });
            const n4 = await insertNotification({ userId: user.id, isRead: false });

            const res = await client.get(BASE);
            // unread newest-first (n4,n2) then read newest-first (n3,n1)
            expect(idsOf(res.body)).toEqual([n4, n2, n3, n1]);
        });
    });

    describe("Soft-delete exclusion", () => {
        it("omits soft-deleted notifications from the feed and the total", async () => {
            const { user, client } = await seed();
            const live = await insertNotification({ userId: user.id });
            await insertNotification({ userId: user.id, deletedAt: new Date() });

            const res = await client.get(BASE);
            expect(idsOf(res.body)).toEqual([live]);
            expect(res.body.pagination.total_estimate).toBe(1);
        });
    });

    describe("Workspace / user isolation", () => {
        it("returns only the caller's own notifications", async () => {
            const ws = await makeWorkspace();
            const me = await makeUser({ workspaceId: ws.id });
            const other = await makeUser({ workspaceId: ws.id });
            const client = await makeLoggedInClient(me);

            const mine = await insertNotification({ userId: me.id });
            await insertNotification({
                userId: other.id,
                title: "secret-other-user",
            });

            const res = await client.get(BASE);
            expect(idsOf(res.body)).toEqual([mine]);
            expect(JSON.stringify(res.body)).not.toContain("secret-other-user");
        });
    });

    describe("Pagination", () => {
        /** Insert n notifications for the user; return ids in insertion order. */
        const seedN = async (userId: string, n: number): Promise<string[]> => {
            const ids: string[] = [];
            for (let i = 0; i < n; i++) {
                ids.push(await insertNotification({ userId }));
            }
            return ids;
        };

        it("walks first→last with a stable cursor: no dups, no skips", async () => {
            const { user, client } = await seed();
            const ids = await seedN(user.id, 5); // all unread → newest-first

            const seen: string[] = [];
            let cursor: string | null = null;
            for (let guard = 0; guard < 10; guard++) {
                const url =
                    BASE + `?limit=2${cursor ? `&cursor=${cursor}` : ""}`;
                const res = await client.get(url);
                expect(res.status).toBe(200);
                seen.push(...idsOf(res.body));
                cursor = res.body.pagination.next_cursor;
                if (!cursor) break;
            }
            expect(seen).toEqual([...ids].reverse());
            expect(new Set(seen).size).toBe(5);
        });

        it("crosses the unread→read boundary with a single cursor walk", async () => {
            const { user, client } = await seed();
            const r1 = await insertNotification({ userId: user.id, isRead: true });
            const u1 = await insertNotification({ userId: user.id, isRead: false });
            const r2 = await insertNotification({ userId: user.id, isRead: true });
            const u2 = await insertNotification({ userId: user.id, isRead: false });

            const seen: string[] = [];
            let cursor: string | null = null;
            for (let guard = 0; guard < 10; guard++) {
                const res = await client.get(
                    BASE + `?limit=1${cursor ? `&cursor=${cursor}` : ""}`,
                );
                seen.push(...idsOf(res.body));
                cursor = res.body.pagination.next_cursor;
                if (!cursor) break;
            }
            // unread newest-first (u2,u1) then read newest-first (r2,r1)
            expect(seen).toEqual([u2, u1, r2, r1]);
        });

        it("sets has_more + a base64url next_cursor on a partial page", async () => {
            const { user, client } = await seed();
            await seedN(user.id, 3);

            const res = await client.get(`${BASE}?limit=1`);
            expect(res.body.data).toHaveLength(1);
            expect(res.body.pagination.has_more).toBe(true);
            expect(res.body.pagination.next_cursor).toMatch(/^[A-Za-z0-9_-]+$/);
        });

        it("total_estimate is the full count regardless of page size", async () => {
            const { user, client } = await seed();
            await seedN(user.id, 7);
            const res = await client.get(`${BASE}?limit=2`);
            expect(res.body.pagination.total_estimate).toBe(7);
        });

        it("applies a default page size when limit is omitted", async () => {
            const { user, client } = await seed();
            await seedN(user.id, 3);
            const res = await client.get(BASE);
            expect(res.body.data).toHaveLength(3);
            expect(res.body.pagination.has_more).toBe(false);
        });

        it("clamps an over-max limit to 200", async () => {
            const { user, client } = await seed();
            await getDb()
                .insert(notifications)
                .values(
                    Array.from({ length: 201 }, () => ({
                        id: fakeId("ntf"),
                        userId: user.id,
                        type: "assigned" as const,
                        entityType: "task" as const,
                        entityId: "t-x",
                        actorId: null,
                        title: "cap",
                    })),
                );

            const res = await client.get(`${BASE}?limit=10000`);
            expect(res.status).toBe(200);
            expect(res.body.data).toHaveLength(200);
            expect(res.body.pagination.has_more).toBe(true);
            expect(res.body.pagination.total_estimate).toBe(201);
        });

        it("is cursor-stable: a row inserted mid-pagination never pollutes an older page", async () => {
            const { user, client } = await seed();
            const ids = await seedN(user.id, 4); // newest = ids[3]

            const page1 = await client.get(`${BASE}?limit=2`);
            expect(idsOf(page1.body)).toEqual([ids[3], ids[2]]);
            const cursor = page1.body.pagination.next_cursor;

            const fresh = await insertNotification({ userId: user.id }); // highest id

            const page2 = await client.get(`${BASE}?limit=2&cursor=${cursor}`);
            expect(idsOf(page2.body)).toEqual([ids[1], ids[0]]);
            expect(idsOf(page2.body)).not.toContain(fresh);
        });

        it("a cursor past the end of the read group yields an empty page", async () => {
            const { user, client } = await seed();
            await insertNotification({ userId: user.id, isRead: false });
            // cursor = (is_read=1, internal_id=1): the only row is unread
            // (is_read=0), which satisfies neither `is_read > 1` nor
            // `is_read = 1 AND internal_id < 1` → empty, regardless of the row's
            // actual internal_id.
            const past = Buffer.from("1.1", "utf8").toString("base64url");
            const res = await client.get(`${BASE}?cursor=${past}`);
            expect(res.status).toBe(200);
            expect(res.body.data).toEqual([]);
            expect(res.body.pagination.has_more).toBe(false);
            expect(res.body.pagination.next_cursor).toBeNull();
        });
    });

    describe("Validation", () => {
        it.each(["0", "-1", "abc", "2.5"])(
            "422 when limit=%s",
            async (bad) => {
                const { client } = await seed();
                const res = await client.get(`${BASE}?limit=${bad}`);
                expect(res.status).toBe(422);
                expect(res.body.error.code).toBe("validation.failed");
            },
        );

        it("422 when ?cursor is present but empty", async () => {
            const { client } = await seed();
            const res = await client.get(`${BASE}?cursor=`);
            expect(res.status).toBe(422);
            expect(res.body.error.code).toBe("validation.failed");
        });

        it("422 when ?limit is repeated", async () => {
            const { client } = await seed();
            const res = await client.get(`${BASE}?limit=1&limit=2`);
            expect(res.status).toBe(422);
            expect(res.body.error.code).toBe("validation.failed");
        });

        it("400 pagination.invalid_cursor for a non-base64url cursor", async () => {
            const { client } = await seed();
            const res = await client.get(`${BASE}?cursor=!!!bad`);
            expect(res.status).toBe(400);
            expect(res.body.error.code).toBe("pagination.invalid_cursor");
        });

        it("400 pagination.invalid_cursor when the cursor decodes to a bad shape", async () => {
            const { client } = await seed();
            const bad = Buffer.from("not-a-cursor", "utf8").toString(
                "base64url",
            );
            const res = await client.get(`${BASE}?cursor=${bad}`);
            expect(res.status).toBe(400);
            expect(res.body.error.code).toBe("pagination.invalid_cursor");
        });
    });

    describe("Authentication", () => {
        it("401 auth.missing_token with no credentials", async () => {
            const http = await oneOff();
            const res = await http.get(BASE);
            expect(res.status).toBe(401);
            expect(res.body.error.code).toBe("auth.missing_token");
        });

        it("401 auth.invalid_token for a garbage bearer token", async () => {
            const http = await oneOff();
            const res = await http
                .get(BASE)
                .set("Authorization", "Bearer not-a-jwt");
            expect(res.status).toBe(401);
            expect(res.body.error.code).toBe("auth.invalid_token");
        });

        it("401 auth.expired_token for an expired token", async () => {
            const { user } = await seed();
            const token = signAccess(user, Config.ACCESS_TOKEN_SECRET!, {
                expiresIn: -10,
            });
            const http = await oneOff();
            const res = await http
                .get(BASE)
                .set("Authorization", `Bearer ${token}`);
            expect(res.status).toBe(401);
            expect(res.body.error.code).toBe("auth.expired_token");
        });
    });

    describe("Side effects & cross-cutting", () => {
        it("a read inserts no notification rows", async () => {
            const { user, client } = await seed();
            await insertNotification({ userId: user.id });
            const count = async () =>
                (await getDb().select().from(notifications)).length;
            const before = await count();
            await client.get(BASE);
            expect(await count()).toBe(before);
        });

        it("responds as application/json with an X-Request-Id header", async () => {
            const { client } = await seed();
            const res = await client.get(BASE);
            expect(res.headers["content-type"]).toMatch(/application\/json/);
            expect(res.get("X-Request-Id")).toMatch(/^req_/);
        });

        it("404 route.not_found for POST on the collection path", async () => {
            const { client } = await seed();
            const res = await client.post(BASE);
            expect(res.status).toBe(404);
            expect(res.body.error.code).toBe("route.not_found");
        });
    });
});
