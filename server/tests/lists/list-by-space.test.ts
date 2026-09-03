import jwt from "jsonwebtoken";
import { eq } from "drizzle-orm";
import { oneOff } from "../test-utils/app";
import {
    makeLoggedInClient,
    makeSpace,
    makeUser,
    makeWorkspace,
} from "../test-utils/factories";
import { getDb } from "../../src/db/client";
import { lists, taskTypes, workspaceActivity } from "../../src/db/schema";
import { fakeId } from "../../src/utils";
import { Config } from "../../src/config";
import type { Role } from "../../src/constants";

/**
 * Tests for `GET /api/v1/spaces/:spaceId/lists` (§6 Lists #1).
 *
 * Patterns mirror `tests/tags/list.test.ts` and `tests/auth/login.test.ts`:
 *   - Real DB writes via `tests/test-utils/factories` (no mocks).
 *   - `oneOff()` for unauthenticated cases; authed calls via `makeLoggedInClient`.
 *   - `setup-each.ts` truncates every table before each test → order-free.
 *
 * The endpoint returns the spec list envelope ({ data, pagination }) with the
 * whole bounded per-space set in a single page (`lists` has no `internal_id`),
 * excluding archived lists unless `?include_archived=true`. The space must
 * resolve inside the caller's workspace or it is `404 space.not_found`.
 */

const url = (spaceId: string): string => `/api/v1/spaces/${spaceId}/lists`;

interface WireList {
    id: string;
    space_id: string;
    name: string;
    description: string | null;
    icon: string;
    color: string;
    position: number;
    default_task_type_id: string | null;
    is_private: boolean;
    archived_at: string | null;
    created_by: string;
    created_at: string;
}

const WIRE_LIST_KEYS = [
    "archived_at",
    "color",
    "created_at",
    "created_by",
    "default_task_type_id",
    "description",
    "icon",
    "id",
    "is_private",
    "name",
    "position",
    "space_id",
].sort();

const dataOf = (body: unknown): WireList[] => (body as { data: WireList[] }).data;

const namesOf = (body: unknown): string[] => dataOf(body).map((l) => l.name);

/** Bulk-insert lists into a space in one round-trip. `createdBy` must exist. */
const seedLists = async (
    spaceId: string,
    createdBy: string,
    rows: Array<{
        name: string;
        position?: number;
        description?: string | null;
        archivedAt?: Date | null;
        isPrivate?: boolean;
        icon?: string;
        color?: string;
    }>,
): Promise<void> => {
    const db = getDb();
    const values = rows.map((r, i) => {
        const row: typeof lists.$inferInsert = {
            id: fakeId("l"),
            spaceId,
            createdBy,
            name: r.name,
            position: r.position ?? i,
            description: r.description ?? null,
            archivedAt: r.archivedAt ?? null,
            isPrivate: r.isPrivate ?? false,
        };
        if (r.icon !== undefined) row.icon = r.icon;
        if (r.color !== undefined) row.color = r.color;
        return row;
    });
    await db.insert(lists).values(values);
};

/**
 * Activity rows FOR ONE WORKSPACE.
 *
 * Counting the whole table is order-dependent here: `setup-each-lists.ts`
 * deliberately runs NO per-test reset (every test is workspace-scoped, and a
 * truncate-all stalls on metadata locks), so rows left by earlier tests in the
 * file accumulate. `task-types` had the identical helper and it flaked in the
 * P6 gate — "expected 0, received 32" — which reads as machine noise. The claim
 * is about THIS workspace; scoped, it says so.
 */
const countWorkspaceActivity = async (workspaceId: string): Promise<number> => {
    const db = getDb();
    return (
        await db
            .select({ id: workspaceActivity.id })
            .from(workspaceActivity)
            .where(eq(workspaceActivity.workspaceId, workspaceId))
    ).length;
};

const countLists = async (spaceId: string): Promise<number> => {
    const db = getDb();
    return (
        await db
            .select({ id: lists.id })
            .from(lists)
            .where(eq(lists.spaceId, spaceId))
    ).length;
};

/** Mint a raw access token for the negative-auth cases. */
const signAccess = (
    user: { id: string; workspaceId: string; role: Role },
    secret: string,
    opts: jwt.SignOptions = {},
): string =>
    jwt.sign(
        { sub: user.id, role: user.role, workspaceId: user.workspaceId },
        secret,
        { algorithm: "HS256", expiresIn: "15m", ...opts },
    );

/** A user + a space in their workspace + a logged-in client. */
const setup = async (
    opts: { role?: Role; status?: "active" | "invited" | "deactivated" } = {},
) => {
    const u = await makeUser({ role: opts.role, status: opts.status });
    const space = await makeSpace({ workspaceId: u.workspaceId, createdBy: u.id });
    const client = await makeLoggedInClient(u);
    return { u, space, client };
};

// ════════════════════════════════════════════════════════════════════════════
describe("GET /api/v1/spaces/:spaceId/lists", () => {
    // ─── a. Happy path ──────────────────────────────────────────────────────
    describe("Happy path", () => {
        it("returns 200 with the spec list envelope for a space's lists", async () => {
            const { u, space, client } = await setup();
            await seedLists(space.id, u.id, [{ name: "Orders" }]);

            const res = await client.get(url(space.id));

            expect(res.status).toBe(200);
            expect(Array.isArray(res.body.data)).toBe(true);
            expect(res.body.data).toHaveLength(1);
        });

        it("shapes each row as exactly the 12 wire fields — no extras", async () => {
            const { u, space, client } = await setup();
            await seedLists(space.id, u.id, [{ name: "Orders" }]);

            const [list] = dataOf((await client.get(url(space.id))).body);

            expect(Object.keys(list).sort()).toEqual(WIRE_LIST_KEYS);
        });

        it("never leaks workspace_id, updated_at, internal_id, or folder_id", async () => {
            const { u, space, client } = await setup();
            await seedLists(space.id, u.id, [{ name: "Orders" }]);

            const [list] = dataOf((await client.get(url(space.id))).body);

            expect(list).not.toHaveProperty("workspace_id");
            expect(list).not.toHaveProperty("workspaceId");
            expect(list).not.toHaveProperty("updated_at");
            expect(list).not.toHaveProperty("updatedAt");
            expect(list).not.toHaveProperty("internal_id");
            expect(list).not.toHaveProperty("folder_id");
        });

        it("maps snake_case fields with correct values and types", async () => {
            const { u, space, client } = await setup();
            await seedLists(space.id, u.id, [
                {
                    name: "Orders",
                    position: 3,
                    isPrivate: true,
                    icon: "Inbox",
                    color: "#112233",
                },
            ]);

            const [list] = dataOf((await client.get(url(space.id))).body);

            expect(list.space_id).toBe(space.id);
            expect(list.name).toBe("Orders");
            expect(list.position).toBe(3);
            expect(list.is_private).toBe(true);
            expect(list.icon).toBe("Inbox");
            expect(list.color).toBe("#112233");
            expect(list.created_by).toBe(u.id);
            expect(list.id).toMatch(/^l-/);
            expect(typeof list.created_at).toBe("string");
            expect(list.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/);
            expect(list.archived_at).toBeNull();
            expect(list.description).toBeNull();
            expect(list.default_task_type_id).toBeNull();
        });

        it("orders lists by position ascending", async () => {
            const { u, space, client } = await setup();
            await seedLists(space.id, u.id, [
                { name: "third", position: 2 },
                { name: "first", position: 0 },
                { name: "second", position: 1 },
            ]);

            expect(namesOf((await client.get(url(space.id))).body)).toEqual([
                "first",
                "second",
                "third",
            ]);
        });

        it("breaks position ties deterministically (stable across calls)", async () => {
            const { u, space, client } = await setup();
            await seedLists(space.id, u.id, [
                { name: "a", position: 0 },
                { name: "b", position: 0 },
                { name: "c", position: 0 },
            ]);

            const first = dataOf((await client.get(url(space.id))).body).map(
                (l) => l.id,
            );
            const second = dataOf((await client.get(url(space.id))).body).map(
                (l) => l.id,
            );

            expect(second).toEqual(first);
        });

        it("returns the full-page pagination block (no cursor, exact count)", async () => {
            const { u, space, client } = await setup();
            await seedLists(space.id, u.id, [{ name: "a" }, { name: "b" }]);

            const res = await client.get(url(space.id));

            expect(res.body.pagination).toEqual({
                next_cursor: null,
                has_more: false,
                total_estimate: 2,
            });
        });

        it("returns an empty list (not 404) when the space has no lists", async () => {
            const { space, client } = await setup();

            const res = await client.get(url(space.id));

            expect(res.status).toBe(200);
            expect(res.body.data).toEqual([]);
            expect(res.body.pagination).toEqual({
                next_cursor: null,
                has_more: false,
                total_estimate: 0,
            });
        });

        it("echoes a non-null default_task_type_id", async () => {
            const { u, space, client } = await setup();
            const db = getDb();
            const ttId = fakeId("tt");
            await db
                .insert(taskTypes)
                .values({ id: ttId, workspaceId: u.workspaceId, name: "Bug" });
            await db.insert(lists).values({
                id: fakeId("l"),
                spaceId: space.id,
                createdBy: u.id,
                name: "Bugs",
                defaultTaskTypeId: ttId,
            });

            const [list] = dataOf((await client.get(url(space.id))).body);

            expect(list.default_task_type_id).toBe(ttId);
        });
    });

    // ─── b. Validation ────────────────────────────────────────────────────────
    describe("Validation", () => {
        it("returns 422 validation.failed for a non-boolean include_archived", async () => {
            const { space, client } = await setup();

            const res = await client.get(`${url(space.id)}?include_archived=maybe`);

            expect(res.status).toBe(422);
            expect(res.body.error.code).toBe("validation.failed");
            expect(
                res.body.error.details.some(
                    (d: { field?: string }) => d.field === "include_archived",
                ),
            ).toBe(true);
        });

        it("returns 422 for an empty include_archived value", async () => {
            const { space, client } = await setup();

            const res = await client.get(`${url(space.id)}?include_archived=`);

            expect(res.status).toBe(422);
            expect(res.body.error.code).toBe("validation.failed");
        });

        it("returns 422 for a spaceId longer than 64 chars", async () => {
            const { client } = await setup();

            const res = await client.get(url("s".repeat(65)));

            expect(res.status).toBe(422);
            expect(res.body.error.code).toBe("validation.failed");
            expect(
                res.body.error.details.some(
                    (d: { field?: string }) => d.field === "spaceId",
                ),
            ).toBe(true);
        });

        it("accepts include_archived=true", async () => {
            const { space, client } = await setup();
            const res = await client.get(`${url(space.id)}?include_archived=true`);
            expect(res.status).toBe(200);
        });

        it("accepts include_archived=false", async () => {
            const { space, client } = await setup();
            const res = await client.get(`${url(space.id)}?include_archived=false`);
            expect(res.status).toBe(200);
        });

        it("accepts include_archived=1 and treats it as true", async () => {
            const { u, space, client } = await setup();
            await seedLists(space.id, u.id, [
                { name: "active", position: 0 },
                { name: "archived", position: 1, archivedAt: new Date() },
            ]);

            const res = await client.get(`${url(space.id)}?include_archived=1`);

            expect(res.status).toBe(200);
            expect(namesOf(res.body).sort()).toEqual(["active", "archived"]);
        });

        it("treats include_archived=0 as false (archived excluded)", async () => {
            const { u, space, client } = await setup();
            await seedLists(space.id, u.id, [
                { name: "active", position: 0 },
                { name: "archived", position: 1, archivedAt: new Date() },
            ]);

            const res = await client.get(`${url(space.id)}?include_archived=0`);

            expect(namesOf(res.body)).toEqual(["active"]);
        });

        it("accepts a spaceId of exactly 64 chars (boundary) — 404, not 422", async () => {
            const { client } = await setup();

            const res = await client.get(url("s".repeat(64)));

            expect(res.status).toBe(404);
            expect(res.body.error.code).toBe("space.not_found");
        });
    });

    // ─── c. Authentication ────────────────────────────────────────────────────
    describe("Authentication", () => {
        it("returns 401 auth.missing_token when no token is supplied", async () => {
            const { space } = await setup();
            const http = await oneOff();

            const res = await http.get(url(space.id));

            expect(res.status).toBe(401);
            expect(res.body.error.code).toBe("auth.missing_token");
        });

        it("returns 401 auth.invalid_token for a malformed bearer token", async () => {
            const { space } = await setup();
            const http = await oneOff();

            const res = await http
                .get(url(space.id))
                .set("Authorization", "Bearer not.a.real.jwt");

            expect(res.status).toBe(401);
            expect(res.body.error.code).toBe("auth.invalid_token");
        });

        it("returns 401 auth.invalid_token for a token signed with the wrong secret", async () => {
            const { u, space } = await setup();
            const token = signAccess(
                { id: u.id, workspaceId: u.workspaceId, role: u.role },
                "wrong-secret-not-the-real-one",
                { expiresIn: "15m" },
            );
            const http = await oneOff();

            const res = await http
                .get(url(space.id))
                .set("Authorization", `Bearer ${token}`);

            expect(res.status).toBe(401);
            expect(res.body.error.code).toBe("auth.invalid_token");
        });

        it("returns 401 auth.expired_token for an expired token", async () => {
            const { u, space } = await setup();
            const token = signAccess(
                { id: u.id, workspaceId: u.workspaceId, role: u.role },
                Config.ACCESS_TOKEN_SECRET!,
                { expiresIn: -10 },
            );
            const http = await oneOff();

            const res = await http
                .get(url(space.id))
                .set("Authorization", `Bearer ${token}`);

            expect(res.status).toBe(401);
            expect(res.body.error.code).toBe("auth.expired_token");
        });

        it("still serves a deactivated user holding a valid access token (stateless JWT)", async () => {
            const u = await makeUser({ status: "deactivated" });
            const space = await makeSpace({
                workspaceId: u.workspaceId,
                createdBy: u.id,
            });
            await seedLists(space.id, u.id, [{ name: "Visible" }]);
            const client = await makeLoggedInClient(u);

            const res = await client.get(url(space.id));

            expect(res.status).toBe(200);
            expect(namesOf(res.body)).toEqual(["Visible"]);
        });
    });

    // ─── d. Authorization (🔐 any role; no forbidden tier) ─────────────────────
    describe("Authorization", () => {
        const roles: Role[] = ["owner", "admin", "member", "guest"];
        for (const role of roles) {
            it(`allows a ${role} to list a space's lists (200)`, async () => {
                const u = await makeUser({ role });
                const space = await makeSpace({
                    workspaceId: u.workspaceId,
                    createdBy: u.id,
                });
                await seedLists(space.id, u.id, [{ name: "Shared" }]);
                const client = await makeLoggedInClient(u);

                const res = await client.get(url(space.id));

                expect(res.status).toBe(200);
                expect(namesOf(res.body)).toEqual(["Shared"]);
            });
        }
    });

    // ─── e. Resource lifecycle (not found / archived) ──────────────────────────
    describe("Not found & archived", () => {
        it("returns 404 space.not_found for a non-existent spaceId", async () => {
            const { client } = await setup();

            const res = await client.get(url("sp-does-not-exist"));

            expect(res.status).toBe(404);
            expect(res.body.error.code).toBe("space.not_found");
        });

        it("excludes archived lists by default", async () => {
            const { u, space, client } = await setup();
            await seedLists(space.id, u.id, [
                { name: "active", position: 0 },
                { name: "gone", position: 1, archivedAt: new Date() },
            ]);

            expect(namesOf((await client.get(url(space.id))).body)).toEqual([
                "active",
            ]);
        });

        it("includes archived lists with ?include_archived=true and serialises archived_at as ISO", async () => {
            const { u, space, client } = await setup();
            await seedLists(space.id, u.id, [
                { name: "active", position: 0 },
                { name: "gone", position: 1, archivedAt: new Date() },
            ]);

            const data = dataOf(
                (await client.get(`${url(space.id)}?include_archived=true`)).body,
            );

            expect(data.map((l) => l.name)).toEqual(["active", "gone"]);
            const archived = data.find((l) => l.name === "gone");
            expect(typeof archived?.archived_at).toBe("string");
            expect(archived?.archived_at).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/);
            const active = data.find((l) => l.name === "active");
            expect(active?.archived_at).toBeNull();
        });

        it("resolves an archived space (still exists) and returns its active lists", async () => {
            const u = await makeUser();
            const space = await makeSpace({
                workspaceId: u.workspaceId,
                createdBy: u.id,
                archivedAt: new Date(),
            });
            await seedLists(space.id, u.id, [{ name: "under-archived-space" }]);
            const client = await makeLoggedInClient(u);

            const res = await client.get(url(space.id));

            expect(res.status).toBe(200);
            expect(namesOf(res.body)).toEqual(["under-archived-space"]);
        });

        it("counts total_estimate by visible (non-archived) lists by default", async () => {
            const { u, space, client } = await setup();
            await seedLists(space.id, u.id, [
                { name: "a", position: 0 },
                { name: "b", position: 1 },
                { name: "c", position: 2, archivedAt: new Date() },
            ]);

            const res = await client.get(url(space.id));

            expect(res.body.pagination.total_estimate).toBe(2);
        });
    });

    // ─── g. Tenant / workspace isolation ───────────────────────────────────────
    describe("Workspace isolation", () => {
        it("returns 404 (not the data) when the space belongs to another workspace [IDOR]", async () => {
            const userA = await makeUser();
            const wsB = await makeWorkspace();
            const spaceB = await makeSpace({ workspaceId: wsB.id });
            await seedLists(spaceB.id, spaceB.createdBy, [{ name: "secret-B" }]);
            const client = await makeLoggedInClient(userA);

            const res = await client.get(url(spaceB.id));

            expect(res.status).toBe(404);
            expect(res.body.error.code).toBe("space.not_found");
        });

        it("does not 200-with-empty for a cross-workspace space (no existence oracle)", async () => {
            const userA = await makeUser();
            const wsB = await makeWorkspace();
            const spaceB = await makeSpace({ workspaceId: wsB.id });
            const client = await makeLoggedInClient(userA);

            const res = await client.get(url(spaceB.id));

            expect(res.status).toBe(404);
        });

        it("returns only the requested space's lists, not sibling spaces in the same workspace", async () => {
            const u = await makeUser();
            const spaceX = await makeSpace({
                workspaceId: u.workspaceId,
                createdBy: u.id,
            });
            const spaceY = await makeSpace({
                workspaceId: u.workspaceId,
                createdBy: u.id,
            });
            await seedLists(spaceX.id, u.id, [{ name: "x-1" }]);
            await seedLists(spaceY.id, u.id, [{ name: "y-1" }, { name: "y-2" }]);
            const client = await makeLoggedInClient(u);

            expect(namesOf((await client.get(url(spaceX.id))).body)).toEqual([
                "x-1",
            ]);
        });
    });

    // ─── i. Concurrency (reads only) ────────────────────────────────────────────
    describe("Concurrency", () => {
        it("serves 50 parallel reads with identical, consistent results", async () => {
            const { u, space, client } = await setup();
            await seedLists(space.id, u.id, [
                { name: "a", position: 0 },
                { name: "b", position: 1 },
                { name: "c", position: 2 },
            ]);

            const results = await Promise.all(
                Array.from({ length: 50 }, () => client.get(url(space.id))),
            );

            for (const r of results) {
                expect(r.status).toBe(200);
                expect(namesOf(r.body)).toEqual(["a", "b", "c"]);
            }
        });
    });

    // ─── j. Pagination (collection mode — single complete page) ─────────────────
    describe("Collection pagination", () => {
        it("caps a large set at the default limit and pages through it", async () => {
            const { u, space, client } = await setup();
            const rows = Array.from({ length: 250 }, (_, i) => ({
                name: `list-${String(i).padStart(3, "0")}`,
                position: i,
            }));
            await seedLists(space.id, u.id, rows);

            // F23 (ISS-007) inverted this test's premise. This endpoint used to
            // return every row with has_more:false whatever `limit` said; it now
            // has a real DEFAULT_LIMIT of 100 and a working cursor. So "no hidden
            // cap" is precisely what must NOT be true any more — and the first
            // page is only half the contract. The half that matters to a client
            // is that following the cursor still yields EVERY row, in order,
            // exactly once (the H1 rule the views depend on).
            const first = await client.get(url(space.id));
            expect(first.status).toBe(200);
            expect(first.body.data).toHaveLength(100);
            expect(first.body.pagination.has_more).toBe(true);
            expect(first.body.pagination.total_estimate).toBe(250);
            expect(first.body.pagination.next_cursor).toEqual(
                expect.any(String),
            );
            expect(dataOf(first.body)[0].name).toBe("list-000");

            const seen: string[] = dataOf(first.body).map((l) => l.name);
            let cursor: string | null = first.body.pagination.next_cursor;
            let pages = 1;
            while (cursor) {
                const next = await client.get(`${url(space.id)}?${`cursor=${encodeURIComponent(cursor)}`}`);
                expect(next.status).toBe(200);
                expect(next.body.pagination.total_estimate).toBe(250);
                seen.push(...dataOf(next.body).map((l) => l.name));
                cursor = next.body.pagination.next_cursor;
                pages++;
                // 250 rows at 100/page is 3. A cursor that silently restarted
                // at page 1 (the ISS-008 bug) would loop here for ever, so the
                // bound is the assertion, not a safety net.
                expect(pages).toBeLessThanOrEqual(4);
            }
            expect(pages).toBe(3);
            expect(seen).toHaveLength(250);
            expect(new Set(seen).size).toBe(250);
            expect(seen[0]).toBe("list-000");
            expect(seen[249]).toBe("list-249");
        });

        it("returns the identical set on a repeated request (stability)", async () => {
            const { u, space, client } = await setup();
            await seedLists(space.id, u.id, [
                { name: "a", position: 0 },
                { name: "b", position: 1 },
            ]);

            const first = namesOf((await client.get(url(space.id))).body);
            const second = namesOf((await client.get(url(space.id))).body);

            expect(second).toEqual(first);
        });
    });

    // ─── k. Boundary values ─────────────────────────────────────────────────────
    describe("Boundary values", () => {
        it("returns unicode list names intact (Bangla, emoji, RTL Arabic)", async () => {
            const { u, space, client } = await setup();
            await seedLists(space.id, u.id, [
                { name: "ক্রয় আদেশ", position: 0 },
                { name: "🔥 Hotlist", position: 1 },
                { name: "قائمة", position: 2 },
            ]);

            expect(namesOf((await client.get(url(space.id))).body)).toEqual([
                "ক্রয় আদেশ",
                "🔥 Hotlist",
                "قائمة",
            ]);
        });

        it("returns a max-length (120-char) name untruncated", async () => {
            const { u, space, client } = await setup();
            const longName = "x".repeat(120);
            await seedLists(space.id, u.id, [{ name: longName }]);

            const [list] = dataOf((await client.get(url(space.id))).body);

            expect(list.name).toBe(longName);
            expect(list.name).toHaveLength(120);
        });

        it("returns a max-length (500-char) description untruncated", async () => {
            const { u, space, client } = await setup();
            const longDesc = "d".repeat(500);
            await seedLists(space.id, u.id, [{ name: "x", description: longDesc }]);

            const [list] = dataOf((await client.get(url(space.id))).body);

            expect(list.description).toBe(longDesc);
        });

        it("returns the schema default icon and color when not set", async () => {
            const u = await makeUser();
            const space = await makeSpace({
                workspaceId: u.workspaceId,
                createdBy: u.id,
            });
            const db = getDb();
            await db.insert(lists).values({
                id: fakeId("l"),
                spaceId: space.id,
                createdBy: u.id,
                name: "Defaults",
            });
            const client = await makeLoggedInClient(u);

            const [list] = dataOf((await client.get(url(space.id))).body);

            expect(list.icon).toBe("ListChecks");
            expect(list.color).toBe("#4F46E5");
        });

        it("handles a single list (N=1)", async () => {
            const { u, space, client } = await setup();
            await seedLists(space.id, u.id, [{ name: "Solo" }]);

            const res = await client.get(url(space.id));

            expect(res.body.data).toHaveLength(1);
            expect(res.body.pagination.total_estimate).toBe(1);
        });

        it("orders position 0 before a very large position", async () => {
            const { u, space, client } = await setup();
            await seedLists(space.id, u.id, [
                { name: "big", position: 1_000_000 },
                { name: "zero", position: 0 },
            ]);

            expect(namesOf((await client.get(url(space.id))).body)).toEqual([
                "zero",
                "big",
            ]);
        });
    });

    // ─── l. Side effects (a read must mutate nothing) ───────────────────────────
    describe("Side effects", () => {
        it("writes no workspace_activity rows", async () => {
            const { u, space, client } = await setup();
            await seedLists(space.id, u.id, [{ name: "a" }]);

            await client.get(url(space.id));

            expect(await countWorkspaceActivity(u.workspaceId)).toBe(0);
        });

        it("does not change the list row count", async () => {
            const { u, space, client } = await setup();
            await seedLists(space.id, u.id, [{ name: "a" }, { name: "b" }]);

            const before = await countLists(space.id);
            await client.get(url(space.id));

            expect(await countLists(space.id)).toBe(before);
        });
    });

    // ─── Cross-cutting ──────────────────────────────────────────────────────────
    describe("Cross-cutting", () => {
        it("responds as application/json with an X-Request-Id header", async () => {
            const { space, client } = await setup();

            const res = await client.get(url(space.id));

            expect(res.headers["content-type"]).toMatch(/application\/json/);
            expect(res.get("X-Request-Id")).toMatch(/^req_/);
        });

        it("echoes a client-supplied X-Request-Id into the 404 error envelope", async () => {
            const { client } = await setup();

            const res = await client
                .get(url("sp-nope"))
                .set("X-Request-Id", "req_custom_123");

            expect(res.get("X-Request-Id")).toBe("req_custom_123");
            expect(res.body.error.request_id).toBe("req_custom_123");
        });

        it("renders the spec error envelope on 401 (request_id matches header)", async () => {
            const { space } = await setup();
            const http = await oneOff();

            const res = await http.get(url(space.id));

            expect(res.body.error).toBeDefined();
            expect(typeof res.body.error.code).toBe("string");
            expect(typeof res.body.error.message).toBe("string");
            expect(res.body.error.request_id).toBe(res.get("X-Request-Id"));
        });

        it("returns 404 route.not_found for POST on the same path", async () => {
            const { space, client } = await setup();

            const res = await client.post(url(space.id));

            expect(res.status).toBe(404);
            expect(res.body.error.code).toBe("route.not_found");
        });

        it("returns 404 route.not_found for a bogus deeper path", async () => {
            const { space, client } = await setup();

            const res = await client.get(`${url(space.id)}/extra/segments`);

            expect(res.status).toBe(404);
            expect(res.body.error.code).toBe("route.not_found");
        });
    });

    // ─── Exploratory probes (Step 7) ────────────────────────────────────────────
    describe("Exploratory", () => {
        it("handles duplicated include_archived params deterministically (no 500; coerced to the safe default)", async () => {
            const { u, space, client } = await setup();
            await seedLists(space.id, u.id, [
                { name: "active", position: 0 },
                { name: "archived", position: 1, archivedAt: new Date() },
            ]);

            // Express parses a repeated query param into an array. The
            // `isBoolean` validator accepts each element, and the controller's
            // string coercion (=== "true" | "1") then yields the safe default
            // (false) → archived excluded. The contract guarantee is
            // "deterministic, never 500" — matching §5's identical validator.
            const res = await client.get(
                `${url(space.id)}?include_archived=true&include_archived=false`,
            );

            expect(res.status).toBe(200);
            expect(namesOf(res.body)).toEqual(["active"]);
        });

        it("rejects mixed-case include_archived=True (validator.js is case-sensitive)", async () => {
            const { space, client } = await setup();

            const res = await client.get(`${url(space.id)}?include_archived=True`);

            expect(res.status).toBe(422);
            expect(res.body.error.code).toBe("validation.failed");
        });

        it("returns 422 (not 500) for an absurdly long spaceId", async () => {
            const { client } = await setup();

            const res = await client.get(url("s".repeat(10000)));

            expect(res.status).toBe(422);
            expect(res.body.error.code).toBe("validation.failed");
        });

        it("treats an injection-shaped spaceId as a literal id → 404", async () => {
            const { client } = await setup();

            const res = await client.get(
                url(encodeURIComponent("sp-1' OR '1'='1")),
            );

            expect(res.status).toBe(404);
            expect(res.body.error.code).toBe("space.not_found");
        });

        it("trims surrounding whitespace in the spaceId path segment", async () => {
            const { u, space, client } = await setup();
            await seedLists(space.id, u.id, [{ name: "trimmed-ok" }]);

            const res = await client.get(url(`%20${space.id}%20`));

            expect(res.status).toBe(200);
            expect(namesOf(res.body)).toEqual(["trimmed-ok"]);
        });

        it("ignores a JSON body on GET and still returns the lists", async () => {
            const { u, space, client } = await setup();
            await seedLists(space.id, u.id, [{ name: "a" }]);

            const res = await client
                .get(url(space.id))
                .send({ deeply: { nested: { junk: true } } });

            expect(res.status).toBe(200);
            expect(namesOf(res.body)).toEqual(["a"]);
        });

        it("serves the request regardless of an exotic Accept header", async () => {
            const { u, space, client } = await setup();
            await seedLists(space.id, u.id, [{ name: "a" }]);

            const res = await client
                .get(url(space.id))
                .set("Accept", "text/plain, */*");

            expect(res.status).toBe(200);
            expect(res.headers["content-type"]).toMatch(/application\/json/);
        });

        it("refuses a ?cursor it never issued, and honours ?limit", async () => {
            const { u, space, client } = await setup();
            await seedLists(space.id, u.id, [{ name: "a" }, { name: "b" }]);

            // F23 (ISS-008) inverted this one too. `whatever` is alphanumeric,
            // so lenient base64 decoding used to produce mojibake that silently
            // restarted pagination at page 1 WITH a fresh next_cursor — a client
            // retrying a corrupted cursor looped for ever. Refusing every cursor
            // this server did not issue IS the fix, so "ignores a stray ?cursor"
            // is the pre-fix contract and must not come back.
            const bad = await client.get(`${url(space.id)}?${"cursor=whatever&limit=1"}`);
            expect(bad.status).toBe(400);
            expect(bad.body.error.code).toBe("pagination.invalid_cursor");

            // …and `limit` is honoured now rather than ignored.
            const limited = await client.get(`${url(space.id)}?${"limit=1"}`);
            expect(limited.status).toBe(200);
            expect(limited.body.data).toHaveLength(1);
            expect(limited.body.pagination.has_more).toBe(true);
            expect(limited.body.pagination.total_estimate).toBe(2);
        });
    });
});
