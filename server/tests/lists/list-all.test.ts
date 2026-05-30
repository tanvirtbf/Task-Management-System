import jwt from "jsonwebtoken";
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
 * Tests for `GET /api/v1/lists` (§6 Lists #2) — every list in the caller's
 * workspace, across all spaces, with an optional `?space_id` filter.
 *
 * Patterns mirror `tests/lists/list-by-space.test.ts`:
 *   - Real DB writes via `tests/test-utils/factories` (no mocks).
 *   - `oneOff()` for unauthenticated cases; authed calls via `makeLoggedInClient`.
 *   - `setup-each.ts` truncates every table before each test → order-free.
 *
 * The endpoint returns the spec list envelope ({ data, pagination }) with the
 * whole bounded set in a single page (`lists` has no `internal_id`), grouped by
 * space then ordered by `position`. Archived lists are excluded unless
 * `?include_archived=true`. A supplied `?space_id` must resolve inside the
 * caller's workspace or it is `404 space.not_found`.
 */

const url = (query?: string): string =>
    `/api/v1/lists${query ? `?${query}` : ""}`;

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

/** Set-equality on names — for cross-space results whose interleave depends on
 * the generated `space_id` ordering. */
const nameSet = (body: unknown): string[] => namesOf(body).sort();

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

const countWorkspaceActivity = async (): Promise<number> => {
    const db = getDb();
    return (await db.select({ id: workspaceActivity.id }).from(workspaceActivity))
        .length;
};

const countAllLists = async (): Promise<number> => {
    const db = getDb();
    return (await db.select({ id: lists.id }).from(lists)).length;
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
        { algorithm: "HS256", ...opts },
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
describe("GET /api/v1/lists", () => {
    // ─── a. Happy path ──────────────────────────────────────────────────────
    describe("Happy path", () => {
        it("returns 200 with the spec list envelope across all spaces", async () => {
            const u = await makeUser();
            const spaceA = await makeSpace({
                workspaceId: u.workspaceId,
                createdBy: u.id,
            });
            const spaceB = await makeSpace({
                workspaceId: u.workspaceId,
                createdBy: u.id,
            });
            await seedLists(spaceA.id, u.id, [{ name: "Orders" }]);
            await seedLists(spaceB.id, u.id, [{ name: "Returns" }, { name: "RMA" }]);
            const client = await makeLoggedInClient(u);

            const res = await client.get(url());

            expect(res.status).toBe(200);
            expect(Array.isArray(res.body.data)).toBe(true);
            expect(res.body.data).toHaveLength(3);
            expect(nameSet(res.body)).toEqual(["Orders", "RMA", "Returns"]);
        });

        it("shapes each row as exactly the 12 wire fields — no extras", async () => {
            const { u, space, client } = await setup();
            await seedLists(space.id, u.id, [{ name: "Orders" }]);

            const [list] = dataOf((await client.get(url())).body);

            expect(Object.keys(list).sort()).toEqual(WIRE_LIST_KEYS);
        });

        it("never leaks workspace_id, updated_at, internal_id, or folder_id", async () => {
            const { u, space, client } = await setup();
            await seedLists(space.id, u.id, [{ name: "Orders" }]);

            const [list] = dataOf((await client.get(url())).body);

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

            const [list] = dataOf((await client.get(url())).body);

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

        it("orders lists within a space by position ascending", async () => {
            const { u, space, client } = await setup();
            await seedLists(space.id, u.id, [
                { name: "third", position: 2 },
                { name: "first", position: 0 },
                { name: "second", position: 1 },
            ]);

            expect(namesOf((await client.get(url())).body)).toEqual([
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

            const first = dataOf((await client.get(url())).body).map((l) => l.id);
            const second = dataOf((await client.get(url())).body).map((l) => l.id);

            expect(second).toEqual(first);
        });

        it("returns the full-page pagination block (no cursor, exact count)", async () => {
            const { u, space, client } = await setup();
            await seedLists(space.id, u.id, [{ name: "a" }, { name: "b" }]);

            const res = await client.get(url());

            expect(res.body.pagination).toEqual({
                next_cursor: null,
                has_more: false,
                total_estimate: 2,
            });
        });

        it("returns an empty list (not 404) when the workspace has no lists", async () => {
            const { client } = await setup();

            const res = await client.get(url());

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

            const [list] = dataOf((await client.get(url())).body);

            expect(list.default_task_type_id).toBe(ttId);
        });
    });

    // ─── b. space_id filter ──────────────────────────────────────────────────
    describe("space_id filter", () => {
        it("returns only the requested space's lists", async () => {
            const u = await makeUser();
            const spaceX = await makeSpace({
                workspaceId: u.workspaceId,
                createdBy: u.id,
            });
            const spaceY = await makeSpace({
                workspaceId: u.workspaceId,
                createdBy: u.id,
            });
            await seedLists(spaceX.id, u.id, [{ name: "x-1" }, { name: "x-2" }]);
            await seedLists(spaceY.id, u.id, [{ name: "y-1" }]);
            const client = await makeLoggedInClient(u);

            const res = await client.get(url(`space_id=${spaceX.id}`));

            expect(res.status).toBe(200);
            expect(nameSet(res.body)).toEqual(["x-1", "x-2"]);
        });

        it("returns an empty page for an in-workspace space with no lists", async () => {
            const { space, client } = await setup();

            const res = await client.get(url(`space_id=${space.id}`));

            expect(res.status).toBe(200);
            expect(res.body.data).toEqual([]);
            expect(res.body.pagination.total_estimate).toBe(0);
        });

        it("resolves an archived (but in-workspace) space and returns its lists", async () => {
            const u = await makeUser();
            const space = await makeSpace({
                workspaceId: u.workspaceId,
                createdBy: u.id,
                archivedAt: new Date(),
            });
            await seedLists(space.id, u.id, [{ name: "under-archived-space" }]);
            const client = await makeLoggedInClient(u);

            const res = await client.get(url(`space_id=${space.id}`));

            expect(res.status).toBe(200);
            expect(namesOf(res.body)).toEqual(["under-archived-space"]);
        });
    });

    // ─── c. Validation ────────────────────────────────────────────────────────
    describe("Validation", () => {
        it("returns 422 validation.failed for a non-boolean include_archived", async () => {
            const { client } = await setup();

            const res = await client.get(url("include_archived=maybe"));

            expect(res.status).toBe(422);
            expect(res.body.error.code).toBe("validation.failed");
            expect(
                res.body.error.details.some(
                    (d: { field?: string }) => d.field === "include_archived",
                ),
            ).toBe(true);
        });

        it("returns 422 for an empty include_archived value", async () => {
            const { client } = await setup();

            const res = await client.get(url("include_archived="));

            expect(res.status).toBe(422);
            expect(res.body.error.code).toBe("validation.failed");
        });

        it("rejects mixed-case include_archived=True (validator.js is case-sensitive)", async () => {
            const { client } = await setup();

            const res = await client.get(url("include_archived=True"));

            expect(res.status).toBe(422);
            expect(res.body.error.code).toBe("validation.failed");
        });

        it("returns 422 for a space_id longer than 64 chars", async () => {
            const { client } = await setup();

            const res = await client.get(url(`space_id=${"s".repeat(65)}`));

            expect(res.status).toBe(422);
            expect(res.body.error.code).toBe("validation.failed");
            expect(
                res.body.error.details.some(
                    (d: { field?: string }) => d.field === "space_id",
                ),
            ).toBe(true);
        });

        it("returns 422 for an empty space_id value", async () => {
            const { client } = await setup();

            const res = await client.get(url("space_id="));

            expect(res.status).toBe(422);
            expect(res.body.error.code).toBe("validation.failed");
            expect(
                res.body.error.details.some(
                    (d: { field?: string }) => d.field === "space_id",
                ),
            ).toBe(true);
        });

        it("accepts include_archived=1 and treats it as true", async () => {
            const { u, space, client } = await setup();
            await seedLists(space.id, u.id, [
                { name: "active", position: 0 },
                { name: "archived", position: 1, archivedAt: new Date() },
            ]);

            const res = await client.get(url("include_archived=1"));

            expect(res.status).toBe(200);
            expect(nameSet(res.body)).toEqual(["active", "archived"]);
        });

        it("treats include_archived=0 as false (archived excluded)", async () => {
            const { u, space, client } = await setup();
            await seedLists(space.id, u.id, [
                { name: "active", position: 0 },
                { name: "archived", position: 1, archivedAt: new Date() },
            ]);

            const res = await client.get(url("include_archived=0"));

            expect(namesOf(res.body)).toEqual(["active"]);
        });
    });

    // ─── d. Authentication ────────────────────────────────────────────────────
    describe("Authentication", () => {
        it("returns 401 auth.missing_token when no token is supplied", async () => {
            await setup();
            const http = await oneOff();

            const res = await http.get(url());

            expect(res.status).toBe(401);
            expect(res.body.error.code).toBe("auth.missing_token");
        });

        it("returns 401 auth.invalid_token for a malformed bearer token", async () => {
            await setup();
            const http = await oneOff();

            const res = await http
                .get(url())
                .set("Authorization", "Bearer not.a.real.jwt");

            expect(res.status).toBe(401);
            expect(res.body.error.code).toBe("auth.invalid_token");
        });

        it("returns 401 auth.invalid_token for a token signed with the wrong secret", async () => {
            const { u } = await setup();
            const token = signAccess(
                { id: u.id, workspaceId: u.workspaceId, role: u.role },
                "wrong-secret-not-the-real-one",
                { expiresIn: "15m" },
            );
            const http = await oneOff();

            const res = await http
                .get(url())
                .set("Authorization", `Bearer ${token}`);

            expect(res.status).toBe(401);
            expect(res.body.error.code).toBe("auth.invalid_token");
        });

        it("returns 401 auth.expired_token for an expired token", async () => {
            const { u } = await setup();
            const token = signAccess(
                { id: u.id, workspaceId: u.workspaceId, role: u.role },
                Config.ACCESS_TOKEN_SECRET!,
                { expiresIn: -10 },
            );
            const http = await oneOff();

            const res = await http
                .get(url())
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

            const res = await client.get(url());

            expect(res.status).toBe(200);
            expect(namesOf(res.body)).toEqual(["Visible"]);
        });
    });

    // ─── e. Authorization (🔐 any role; no forbidden tier) ─────────────────────
    describe("Authorization", () => {
        const roles: Role[] = ["owner", "admin", "member", "guest"];
        for (const role of roles) {
            it(`allows a ${role} to list the workspace's lists (200)`, async () => {
                const u = await makeUser({ role });
                const space = await makeSpace({
                    workspaceId: u.workspaceId,
                    createdBy: u.id,
                });
                await seedLists(space.id, u.id, [{ name: "Shared" }]);
                const client = await makeLoggedInClient(u);

                const res = await client.get(url());

                expect(res.status).toBe(200);
                expect(namesOf(res.body)).toEqual(["Shared"]);
            });
        }
    });

    // ─── f. Not found / archived ───────────────────────────────────────────────
    describe("Not found & archived", () => {
        it("returns 404 space.not_found for a non-existent space_id filter", async () => {
            const { client } = await setup();

            const res = await client.get(url("space_id=sp-does-not-exist"));

            expect(res.status).toBe(404);
            expect(res.body.error.code).toBe("space.not_found");
        });

        it("excludes archived lists by default", async () => {
            const { u, space, client } = await setup();
            await seedLists(space.id, u.id, [
                { name: "active", position: 0 },
                { name: "gone", position: 1, archivedAt: new Date() },
            ]);

            expect(namesOf((await client.get(url())).body)).toEqual(["active"]);
        });

        it("includes archived lists with ?include_archived=true and serialises archived_at as ISO", async () => {
            const { u, space, client } = await setup();
            await seedLists(space.id, u.id, [
                { name: "active", position: 0 },
                { name: "gone", position: 1, archivedAt: new Date() },
            ]);

            const data = dataOf(
                (await client.get(url("include_archived=true"))).body,
            );

            expect(data.map((l) => l.name)).toEqual(["active", "gone"]);
            const archived = data.find((l) => l.name === "gone");
            expect(typeof archived?.archived_at).toBe("string");
            expect(archived?.archived_at).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/);
            const active = data.find((l) => l.name === "active");
            expect(active?.archived_at).toBeNull();
        });

        it("counts total_estimate by visible (non-archived) lists by default", async () => {
            const { u, space, client } = await setup();
            await seedLists(space.id, u.id, [
                { name: "a", position: 0 },
                { name: "b", position: 1 },
                { name: "c", position: 2, archivedAt: new Date() },
            ]);

            const res = await client.get(url());

            expect(res.body.pagination.total_estimate).toBe(2);
        });
    });

    // ─── g. Tenant / workspace isolation ───────────────────────────────────────
    describe("Workspace isolation", () => {
        it("returns only the caller's workspace lists, never another workspace's", async () => {
            const userA = await makeUser();
            const spaceA = await makeSpace({
                workspaceId: userA.workspaceId,
                createdBy: userA.id,
            });
            await seedLists(spaceA.id, userA.id, [{ name: "mine" }]);

            const wsB = await makeWorkspace();
            const spaceB = await makeSpace({ workspaceId: wsB.id });
            await seedLists(spaceB.id, spaceB.createdBy, [{ name: "secret-B" }]);

            const client = await makeLoggedInClient(userA);
            const res = await client.get(url());

            expect(res.status).toBe(200);
            expect(namesOf(res.body)).toEqual(["mine"]);
        });

        it("returns 404 (not empty) for a space_id from another workspace [IDOR, no oracle]", async () => {
            const userA = await makeUser();
            const wsB = await makeWorkspace();
            const spaceB = await makeSpace({ workspaceId: wsB.id });
            await seedLists(spaceB.id, spaceB.createdBy, [{ name: "secret-B" }]);
            const client = await makeLoggedInClient(userA);

            const res = await client.get(url(`space_id=${spaceB.id}`));

            expect(res.status).toBe(404);
            expect(res.body.error.code).toBe("space.not_found");
        });

        it("aggregates lists from every space in the workspace", async () => {
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

            expect(nameSet((await client.get(url())).body)).toEqual([
                "x-1",
                "y-1",
                "y-2",
            ]);
        });
    });

    // ─── h. Concurrency (reads only) ────────────────────────────────────────────
    describe("Concurrency", () => {
        it("serves 50 parallel reads with identical, consistent results", async () => {
            const { u, space, client } = await setup();
            await seedLists(space.id, u.id, [
                { name: "a", position: 0 },
                { name: "b", position: 1 },
                { name: "c", position: 2 },
            ]);

            const results = await Promise.all(
                Array.from({ length: 50 }, () => client.get(url())),
            );

            for (const r of results) {
                expect(r.status).toBe(200);
                expect(namesOf(r.body)).toEqual(["a", "b", "c"]);
            }
        });
    });

    // ─── i. Pagination (collection mode — single complete page) ─────────────────
    describe("Collection pagination", () => {
        it("returns a large set in a single page with no hidden cap", async () => {
            const { u, space, client } = await setup();
            const rows = Array.from({ length: 250 }, (_, i) => ({
                name: `list-${String(i).padStart(3, "0")}`,
                position: i,
            }));
            await seedLists(space.id, u.id, rows);

            const res = await client.get(url());

            expect(res.body.data).toHaveLength(250);
            expect(res.body.pagination).toEqual({
                next_cursor: null,
                has_more: false,
                total_estimate: 250,
            });
            expect(dataOf(res.body)[0].name).toBe("list-000");
            expect(dataOf(res.body)[249].name).toBe("list-249");
        });

        it("returns the identical set on a repeated request (stability)", async () => {
            const { u, space, client } = await setup();
            await seedLists(space.id, u.id, [
                { name: "a", position: 0 },
                { name: "b", position: 1 },
            ]);

            const first = dataOf((await client.get(url())).body).map((l) => l.id);
            const second = dataOf((await client.get(url())).body).map((l) => l.id);

            expect(second).toEqual(first);
        });
    });

    // ─── j. Boundary values ─────────────────────────────────────────────────────
    describe("Boundary values", () => {
        it("returns unicode list names intact (Bangla, emoji, RTL Arabic)", async () => {
            const { u, space, client } = await setup();
            await seedLists(space.id, u.id, [
                { name: "ক্রয় আদেশ", position: 0 },
                { name: "🔥 Hotlist", position: 1 },
                { name: "قائمة", position: 2 },
            ]);

            expect(namesOf((await client.get(url())).body)).toEqual([
                "ক্রয় আদেশ",
                "🔥 Hotlist",
                "قائمة",
            ]);
        });

        it("returns a max-length (120-char) name untruncated", async () => {
            const { u, space, client } = await setup();
            const longName = "x".repeat(120);
            await seedLists(space.id, u.id, [{ name: longName }]);

            const [list] = dataOf((await client.get(url())).body);

            expect(list.name).toBe(longName);
            expect(list.name).toHaveLength(120);
        });

        it("returns a max-length (500-char) description untruncated", async () => {
            const { u, space, client } = await setup();
            const longDesc = "d".repeat(500);
            await seedLists(space.id, u.id, [{ name: "x", description: longDesc }]);

            const [list] = dataOf((await client.get(url())).body);

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

            const [list] = dataOf((await client.get(url())).body);

            expect(list.icon).toBe("ListChecks");
            expect(list.color).toBe("#4F46E5");
        });

        it("handles a single list (N=1)", async () => {
            const { u, space, client } = await setup();
            await seedLists(space.id, u.id, [{ name: "Solo" }]);

            const res = await client.get(url());

            expect(res.body.data).toHaveLength(1);
            expect(res.body.pagination.total_estimate).toBe(1);
        });

        it("orders position 0 before a very large position within a space", async () => {
            const { u, space, client } = await setup();
            await seedLists(space.id, u.id, [
                { name: "big", position: 1_000_000 },
                { name: "zero", position: 0 },
            ]);

            expect(namesOf((await client.get(url())).body)).toEqual([
                "zero",
                "big",
            ]);
        });
    });

    // ─── k. Side effects (a read must mutate nothing) ───────────────────────────
    describe("Side effects", () => {
        it("writes no workspace_activity rows", async () => {
            const { u, space, client } = await setup();
            await seedLists(space.id, u.id, [{ name: "a" }]);

            await client.get(url());

            expect(await countWorkspaceActivity()).toBe(0);
        });

        it("does not change the list row count", async () => {
            const { u, space, client } = await setup();
            await seedLists(space.id, u.id, [{ name: "a" }, { name: "b" }]);

            const before = await countAllLists();
            await client.get(url());

            expect(await countAllLists()).toBe(before);
        });
    });

    // ─── l. Cross-cutting ───────────────────────────────────────────────────────
    describe("Cross-cutting", () => {
        it("responds as application/json with an X-Request-Id header", async () => {
            const { client } = await setup();

            const res = await client.get(url());

            expect(res.headers["content-type"]).toMatch(/application\/json/);
            expect(res.get("X-Request-Id")).toMatch(/^req_/);
        });

        it("echoes a client-supplied X-Request-Id into the 404 error envelope", async () => {
            const { client } = await setup();

            const res = await client
                .get(url("space_id=sp-nope"))
                .set("X-Request-Id", "req_custom_123");

            expect(res.get("X-Request-Id")).toBe("req_custom_123");
            expect(res.body.error.request_id).toBe("req_custom_123");
        });

        it("renders the spec error envelope on 401 (request_id matches header)", async () => {
            await setup();
            const http = await oneOff();

            const res = await http.get(url());

            expect(res.body.error).toBeDefined();
            expect(typeof res.body.error.code).toBe("string");
            expect(typeof res.body.error.message).toBe("string");
            expect(res.body.error.request_id).toBe(res.get("X-Request-Id"));
        });

        it("returns 404 route.not_found for POST on the same path", async () => {
            const { client } = await setup();

            const res = await client.post(url());

            expect(res.status).toBe(404);
            expect(res.body.error.code).toBe("route.not_found");
        });
    });

    // ─── m. Exploratory probes ──────────────────────────────────────────────────
    describe("Exploratory", () => {
        it("handles duplicated include_archived params deterministically (no 500; safe default)", async () => {
            const { u, space, client } = await setup();
            await seedLists(space.id, u.id, [
                { name: "active", position: 0 },
                { name: "archived", position: 1, archivedAt: new Date() },
            ]);

            // Express parses a repeated query param into an array. The validator
            // accepts each element, and the controller's string coercion
            // (=== "true" | "1") then yields the safe default (false) → archived
            // excluded. Matches §5/§6's identical validator behaviour.
            const res = await client.get(
                url("include_archived=true&include_archived=false"),
            );

            expect(res.status).toBe(200);
            expect(namesOf(res.body)).toEqual(["active"]);
        });

        it("treats a duplicated space_id (array) as no filter → all lists", async () => {
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
            await seedLists(spaceY.id, u.id, [{ name: "y-1" }]);
            const client = await makeLoggedInClient(u);

            const res = await client.get(
                url(`space_id=${spaceX.id}&space_id=${spaceY.id}`),
            );

            expect(res.status).toBe(200);
            expect(nameSet(res.body)).toEqual(["x-1", "y-1"]);
        });

        it("returns 422 (not 500) for an absurdly long space_id", async () => {
            const { client } = await setup();

            const res = await client.get(url(`space_id=${"s".repeat(10000)}`));

            expect(res.status).toBe(422);
            expect(res.body.error.code).toBe("validation.failed");
        });

        it("treats an injection-shaped space_id as a literal id → 404", async () => {
            const { client } = await setup();

            const res = await client.get(
                url(`space_id=${encodeURIComponent("sp-1' OR '1'='1")}`),
            );

            expect(res.status).toBe(404);
            expect(res.body.error.code).toBe("space.not_found");
        });

        it("ignores a stray ?cursor and ?limit (collection mode)", async () => {
            const { u, space, client } = await setup();
            await seedLists(space.id, u.id, [{ name: "a" }, { name: "b" }]);

            const res = await client.get(url("cursor=whatever&limit=1"));

            expect(res.status).toBe(200);
            expect(res.body.data).toHaveLength(2);
            expect(res.body.pagination.next_cursor).toBeNull();
        });

        it("ignores a JSON body on GET and still returns the lists", async () => {
            const { u, space, client } = await setup();
            await seedLists(space.id, u.id, [{ name: "a" }]);

            const res = await client
                .get(url())
                .send({ deeply: { nested: { junk: true } } });

            expect(res.status).toBe(200);
            expect(namesOf(res.body)).toEqual(["a"]);
        });

        it("serves the request regardless of an exotic Accept header", async () => {
            const { u, space, client } = await setup();
            await seedLists(space.id, u.id, [{ name: "a" }]);

            const res = await client
                .get(url())
                .set("Accept", "text/plain, */*");

            expect(res.status).toBe(200);
            expect(res.headers["content-type"]).toMatch(/application\/json/);
        });
    });
});
