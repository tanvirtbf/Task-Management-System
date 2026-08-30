import { oneOff } from "../test-utils/app";
import { makeUser, makeWorkspace, makeLoggedInClient } from "../test-utils/factories";
import { getDb } from "../../src/db/client";
import { workspaceActivity } from "../../src/db/schema";
import { fakeId } from "../../src/utils";
import {
    BASE,
    seed,
    insertActivity,
    idsOf,
    USER_KEYS,
} from "./_helpers";

/**
 * Tests for `GET /api/v1/activity` (§26 #2) — the filtered, cursor-paginated
 * workspace feed: newest-first (internal_id DESC), `{data,pagination}` envelope,
 * filters (entity_type / actor_id / from / to), actor hydrated, workspace-scoped.
 *
 * The suite does not truncate between tests; every test mints a fresh workspace
 * and uses unique (captured) activity ids, so accumulated rows never leak.
 */

describe("GET /api/v1/activity", () => {
    describe("Happy path", () => {
        it("returns the {data,pagination} envelope (200)", async () => {
            const { ws, client } = await seed();
            await insertActivity({ workspaceId: ws.id });

            const res = await client.get(BASE);
            expect(res.status).toBe(200);
            expect(Array.isArray(res.body.data)).toBe(true);
            expect(res.body.pagination).toEqual({
                next_cursor: null,
                has_more: false,
                total_estimate: 1,
            });
        });

        it("orders newest-first by internal_id DESC", async () => {
            const { ws, client } = await seed();
            const a = await insertActivity({ workspaceId: ws.id });
            const b = await insertActivity({ workspaceId: ws.id });
            const c = await insertActivity({ workspaceId: ws.id });

            const res = await client.get(BASE);
            expect(idsOf(res.body)).toEqual([c, b, a]);
        });

        it("hydrates the actor (and returns null for a system event)", async () => {
            const ws = await makeWorkspace();
            const actor = await makeUser({ workspaceId: ws.id, firstName: "Karim" });
            const client = await makeLoggedInClient(actor);
            await insertActivity({ workspaceId: ws.id, actorId: actor.id });
            await insertActivity({ workspaceId: ws.id, actorId: null });

            const data = (await client.get(BASE)).body.data;
            // newest first: [system(null), actor]
            expect(data[0].actor).toBeNull();
            expect(Object.keys(data[1].actor).sort()).toEqual(USER_KEYS);
            expect(data[1].actor.first_name).toBe("Karim");
        });
    });

    describe("Filters", () => {
        it("?entity_type returns only rows of that type", async () => {
            const { ws, client } = await seed();
            const sp = await insertActivity({ workspaceId: ws.id, entityType: "space" });
            await insertActivity({ workspaceId: ws.id, entityType: "tag" });
            const sp2 = await insertActivity({ workspaceId: ws.id, entityType: "space" });

            const res = await client.get(`${BASE}?entity_type=space`);
            expect(idsOf(res.body)).toEqual([sp2, sp]);
            expect(res.body.pagination.total_estimate).toBe(2);
        });

        it("?actor_id returns only that actor's rows", async () => {
            const { ws, user, client } = await seed();
            const other = await makeUser({ workspaceId: ws.id });
            const mine = await insertActivity({ workspaceId: ws.id, actorId: user.id });
            await insertActivity({ workspaceId: ws.id, actorId: other.id });

            const res = await client.get(`${BASE}?actor_id=${user.id}`);
            expect(idsOf(res.body)).toEqual([mine]);
        });

        it("?from/?to bound the created_at range (inclusive)", async () => {
            const { ws, client } = await seed();
            await insertActivity({
                workspaceId: ws.id,
                createdAt: new Date("2020-01-01T00:00:00Z"),
            });
            const mid = await insertActivity({
                workspaceId: ws.id,
                createdAt: new Date("2020-06-01T00:00:00Z"),
            });
            await insertActivity({
                workspaceId: ws.id,
                createdAt: new Date("2020-12-01T00:00:00Z"),
            });

            const res = await client.get(
                `${BASE}?from=2020-05-01T00:00:00Z&to=2020-07-01T00:00:00Z`,
            );
            expect(idsOf(res.body)).toEqual([mid]);
        });

        it("composes a filter with pagination (total reflects the filter)", async () => {
            const { ws, client } = await seed();
            for (let i = 0; i < 3; i++)
                await insertActivity({ workspaceId: ws.id, entityType: "list" });
            await insertActivity({ workspaceId: ws.id, entityType: "tag" });

            const res = await client.get(`${BASE}?entity_type=list&limit=2`);
            expect(res.body.data).toHaveLength(2);
            expect(res.body.pagination.has_more).toBe(true);
            expect(res.body.pagination.total_estimate).toBe(3);
        });
    });

    describe("Pagination", () => {
        const seedN = async (workspaceId: string, n: number): Promise<string[]> => {
            const ids: string[] = [];
            for (let i = 0; i < n; i++)
                ids.push(await insertActivity({ workspaceId }));
            return ids;
        };

        it("walks first→last with a stable cursor: no dups, no skips", async () => {
            const { ws, client } = await seed();
            const ids = await seedN(ws.id, 5);

            const seen: string[] = [];
            let cursor: string | null = null;
            for (let guard = 0; guard < 10; guard++) {
                const res = await client.get(
                    BASE + `?limit=2${cursor ? `&cursor=${cursor}` : ""}`,
                );
                expect(res.status).toBe(200);
                seen.push(...idsOf(res.body));
                cursor = res.body.pagination.next_cursor;
                if (!cursor) break;
            }
            expect(seen).toEqual([...ids].reverse());
            expect(new Set(seen).size).toBe(5);
        });

        it("sets has_more + a base64url next_cursor on a partial page", async () => {
            const { ws, client } = await seed();
            await seedN(ws.id, 3);
            const res = await client.get(`${BASE}?limit=1`);
            expect(res.body.data).toHaveLength(1);
            expect(res.body.pagination.has_more).toBe(true);
            expect(res.body.pagination.next_cursor).toMatch(/^[A-Za-z0-9_-]+$/);
        });

        it("total_estimate is the full count regardless of page size", async () => {
            const { ws, client } = await seed();
            await seedN(ws.id, 7);
            const res = await client.get(`${BASE}?limit=2`);
            expect(res.body.pagination.total_estimate).toBe(7);
        });

        it("clamps an over-max limit to 200", async () => {
            const { ws, client } = await seed();
            await getDb()
                .insert(workspaceActivity)
                .values(
                    Array.from({ length: 201 }, () => ({
                        id: fakeId("wsa"),
                        workspaceId: ws.id,
                        actorId: null,
                        entityType: "space" as const,
                        entityId: "sp-x",
                        action: "created",
                    })),
                );
            const res = await client.get(`${BASE}?limit=10000`);
            expect(res.body.data).toHaveLength(200);
            expect(res.body.pagination.has_more).toBe(true);
            expect(res.body.pagination.total_estimate).toBe(201);
        });

        it("is cursor-stable: a row inserted mid-pagination never pollutes an older page", async () => {
            const { ws, client } = await seed();
            const ids = await seedN(ws.id, 4); // newest = ids[3]

            const page1 = await client.get(`${BASE}?limit=2`);
            expect(idsOf(page1.body)).toEqual([ids[3], ids[2]]);
            const cursor = page1.body.pagination.next_cursor;

            const fresh = await insertActivity({ workspaceId: ws.id });

            const page2 = await client.get(`${BASE}?limit=2&cursor=${cursor}`);
            expect(idsOf(page2.body)).toEqual([ids[1], ids[0]]);
            expect(idsOf(page2.body)).not.toContain(fresh);
        });

        it("a cursor below the smallest internal_id yields an empty page", async () => {
            const { ws, client } = await seed();
            await seedN(ws.id, 2);
            const tiny = Buffer.from("1", "utf8").toString("base64url");
            const res = await client.get(`${BASE}?cursor=${tiny}`);
            expect(res.status).toBe(200);
            expect(res.body.data).toEqual([]);
            expect(res.body.pagination.has_more).toBe(false);
            expect(res.body.pagination.next_cursor).toBeNull();
        });
    });

    describe("Validation", () => {
        it("422 for an unknown entity_type", async () => {
            const { client } = await seed();
            const res = await client.get(`${BASE}?entity_type=nope`);
            expect(res.status).toBe(422);
            expect(res.body.error.code).toBe("validation.failed");
        });

        it("422 for a non-ISO from / to", async () => {
            const { client } = await seed();
            for (const q of ["from=not-a-date", "to=nope"]) {
                const res = await client.get(`${BASE}?${q}`);
                expect(res.status).toBe(422);
                expect(res.body.error.code).toBe("validation.failed");
            }
        });

        it.each(["0", "-1", "abc"])("422 when limit=%s", async (bad) => {
            const { client } = await seed();
            const res = await client.get(`${BASE}?limit=${bad}`);
            expect(res.status).toBe(422);
        });

        it("422 when ?cursor is present but empty", async () => {
            const { client } = await seed();
            const res = await client.get(`${BASE}?cursor=`);
            expect(res.status).toBe(422);
        });

        it("400 pagination.invalid_cursor for a non-base64url cursor", async () => {
            const { client } = await seed();
            const res = await client.get(`${BASE}?cursor=!!!bad`);
            expect(res.status).toBe(400);
            expect(res.body.error.code).toBe("pagination.invalid_cursor");
        });

        it("400 pagination.invalid_cursor when the cursor decodes to non-digits", async () => {
            const { client } = await seed();
            const bad = Buffer.from("not-a-number", "utf8").toString("base64url");
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
    });

    describe("Isolation & cross-cutting", () => {
        it("returns only the caller's workspace events", async () => {
            const { ws, client } = await seed();
            const wsB = await makeWorkspace();
            const mine = await insertActivity({ workspaceId: ws.id });
            await insertActivity({ workspaceId: wsB.id, action: "secret-other-ws" });

            const res = await client.get(BASE);
            expect(idsOf(res.body)).toEqual([mine]);
            expect(JSON.stringify(res.body)).not.toContain("secret-other-ws");
        });

        it("never hydrates a foreign-workspace actor", async () => {
            const { ws, client } = await seed();
            const wsB = await makeWorkspace();
            const foreign = await makeUser({
                workspaceId: wsB.id,
                email: "foreign@other.test",
            });
            await insertActivity({ workspaceId: ws.id, actorId: foreign.id });

            const res = await client.get(BASE);
            expect(res.body.data[0].actor).toBeNull();
            expect(JSON.stringify(res.body)).not.toContain("foreign@other.test");
        });

        it("a read inserts no rows", async () => {
            const { ws, client } = await seed();
            await insertActivity({ workspaceId: ws.id });
            const count = async () =>
                (await getDb().select().from(workspaceActivity)).length;
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
    });
});
