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
 * Tests for `GET /api/v1/lists/:id` (§6 Lists #3) — read one list by id.
 *
 * Patterns mirror `tests/lists/list-by-space.test.ts`:
 *   - Real DB writes via `tests/test-utils/factories` (no mocks).
 *   - `oneOff()` for unauthenticated cases; authed calls via `makeLoggedInClient`.
 *   - `setup-each.ts` truncates every table before each test → order-free.
 *
 * The endpoint returns the BARE wire `List` (single-resource convention — no
 * `{ data }` envelope, matching `GET /workspace` and `GET /auth/me`). A missing
 * or cross-workspace id is `404 list.not_found`. Archived lists resolve here
 * (soft-delete is still readable on a direct read).
 */

const url = (id: string): string => `/api/v1/lists/${id}`;

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

/** Insert one list with full column control; returns its id. `createdBy` must
 * exist. Omit `icon` / `color` to exercise the schema defaults. */
const seedList = async (
    spaceId: string,
    createdBy: string,
    overrides: {
        name?: string;
        position?: number;
        description?: string | null;
        archivedAt?: Date | null;
        isPrivate?: boolean;
        icon?: string;
        color?: string;
        defaultTaskTypeId?: string | null;
    } = {},
): Promise<string> => {
    const db = getDb();
    const id = fakeId("l");
    const row: typeof lists.$inferInsert = {
        id,
        spaceId,
        createdBy,
        name: overrides.name ?? "Orders",
        position: overrides.position ?? 0,
        description: overrides.description ?? null,
        archivedAt: overrides.archivedAt ?? null,
        isPrivate: overrides.isPrivate ?? false,
    };
    if (overrides.icon !== undefined) row.icon = overrides.icon;
    if (overrides.color !== undefined) row.color = overrides.color;
    if (overrides.defaultTaskTypeId !== undefined) {
        row.defaultTaskTypeId = overrides.defaultTaskTypeId;
    }
    await db.insert(lists).values(row);
    return id;
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
describe("GET /api/v1/lists/:id", () => {
    // ─── a. Happy path ──────────────────────────────────────────────────────
    describe("Happy path", () => {
        it("returns 200 with the requested list", async () => {
            const { u, space, client } = await setup();
            const id = await seedList(space.id, u.id, { name: "Orders" });

            const res = await client.get(url(id));

            expect(res.status).toBe(200);
            expect(res.body.id).toBe(id);
            expect(res.body.name).toBe("Orders");
        });

        it("returns a bare object — no { data } / pagination envelope", async () => {
            const { u, space, client } = await setup();
            const id = await seedList(space.id, u.id);

            const res = await client.get(url(id));

            expect(res.body.id).toBeDefined();
            expect(res.body.data).toBeUndefined();
            expect(res.body.pagination).toBeUndefined();
        });

        it("shapes the body as exactly the 12 wire fields — no extras", async () => {
            const { u, space, client } = await setup();
            const id = await seedList(space.id, u.id);

            const res = await client.get(url(id));

            expect(Object.keys(res.body).sort()).toEqual(WIRE_LIST_KEYS);
        });

        it("never leaks workspace_id, updated_at, internal_id, or folder_id", async () => {
            const { u, space, client } = await setup();
            const id = await seedList(space.id, u.id);

            const res = await client.get(url(id));

            expect(res.body).not.toHaveProperty("workspace_id");
            expect(res.body).not.toHaveProperty("workspaceId");
            expect(res.body).not.toHaveProperty("updated_at");
            expect(res.body).not.toHaveProperty("updatedAt");
            expect(res.body).not.toHaveProperty("internal_id");
            expect(res.body).not.toHaveProperty("folder_id");
        });

        it("maps snake_case fields with correct values and types", async () => {
            const { u, space, client } = await setup();
            const id = await seedList(space.id, u.id, {
                name: "Orders",
                position: 3,
                isPrivate: true,
                icon: "Inbox",
                color: "#112233",
            });

            const list: WireList = (await client.get(url(id))).body;

            expect(list.id).toBe(id);
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

        it("echoes a non-null default_task_type_id", async () => {
            const { u, space, client } = await setup();
            const db = getDb();
            const ttId = fakeId("tt");
            await db
                .insert(taskTypes)
                .values({ id: ttId, workspaceId: u.workspaceId, name: "Bug" });
            const id = await seedList(space.id, u.id, {
                name: "Bugs",
                defaultTaskTypeId: ttId,
            });

            const list: WireList = (await client.get(url(id))).body;

            expect(list.default_task_type_id).toBe(ttId);
        });
    });

    // ─── b. Validation ────────────────────────────────────────────────────────
    describe("Validation", () => {
        it("returns 422 validation.failed for an id longer than 64 chars", async () => {
            const { client } = await setup();

            const res = await client.get(url("l".repeat(65)));

            expect(res.status).toBe(422);
            expect(res.body.error.code).toBe("validation.failed");
            expect(
                res.body.error.details.some(
                    (d: { field?: string }) => d.field === "id",
                ),
            ).toBe(true);
        });

        it("accepts an id of exactly 64 chars (boundary) — 404, not 422", async () => {
            const { client } = await setup();

            const res = await client.get(url("l".repeat(64)));

            expect(res.status).toBe(404);
            expect(res.body.error.code).toBe("list.not_found");
        });

        it("returns 422 (not 500) for an absurdly long id", async () => {
            const { client } = await setup();

            const res = await client.get(url("l".repeat(10000)));

            expect(res.status).toBe(422);
            expect(res.body.error.code).toBe("validation.failed");
        });
    });

    // ─── c. Authentication ────────────────────────────────────────────────────
    describe("Authentication", () => {
        it("returns 401 auth.missing_token when no token is supplied", async () => {
            const { u, space } = await setup();
            const id = await seedList(space.id, u.id);
            const http = await oneOff();

            const res = await http.get(url(id));

            expect(res.status).toBe(401);
            expect(res.body.error.code).toBe("auth.missing_token");
        });

        it("returns 401 auth.invalid_token for a malformed bearer token", async () => {
            const { u, space } = await setup();
            const id = await seedList(space.id, u.id);
            const http = await oneOff();

            const res = await http
                .get(url(id))
                .set("Authorization", "Bearer not.a.real.jwt");

            expect(res.status).toBe(401);
            expect(res.body.error.code).toBe("auth.invalid_token");
        });

        it("returns 401 auth.invalid_token for a token signed with the wrong secret", async () => {
            const { u, space } = await setup();
            const id = await seedList(space.id, u.id);
            const token = signAccess(
                { id: u.id, workspaceId: u.workspaceId, role: u.role },
                "wrong-secret-not-the-real-one",
                { expiresIn: "15m" },
            );
            const http = await oneOff();

            const res = await http
                .get(url(id))
                .set("Authorization", `Bearer ${token}`);

            expect(res.status).toBe(401);
            expect(res.body.error.code).toBe("auth.invalid_token");
        });

        it("returns 401 auth.expired_token for an expired token", async () => {
            const { u, space } = await setup();
            const id = await seedList(space.id, u.id);
            const token = signAccess(
                { id: u.id, workspaceId: u.workspaceId, role: u.role },
                Config.ACCESS_TOKEN_SECRET!,
                { expiresIn: -10 },
            );
            const http = await oneOff();

            const res = await http
                .get(url(id))
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
            const id = await seedList(space.id, u.id, { name: "Visible" });
            const client = await makeLoggedInClient(u);

            const res = await client.get(url(id));

            expect(res.status).toBe(200);
            expect(res.body.name).toBe("Visible");
        });
    });

    // ─── d. Authorization (🔐 any role; no forbidden tier) ─────────────────────
    describe("Authorization", () => {
        const roles: Role[] = ["owner", "admin", "member", "guest"];
        for (const role of roles) {
            it(`allows a ${role} to read a list in their workspace (200)`, async () => {
                const u = await makeUser({ role });
                const space = await makeSpace({
                    workspaceId: u.workspaceId,
                    createdBy: u.id,
                });
                const id = await seedList(space.id, u.id, { name: "Shared" });
                const client = await makeLoggedInClient(u);

                const res = await client.get(url(id));

                expect(res.status).toBe(200);
                expect(res.body.name).toBe("Shared");
            });
        }
    });

    // ─── e. Not found / archived ───────────────────────────────────────────────
    describe("Not found & archived", () => {
        it("returns 404 list.not_found for a non-existent id", async () => {
            const { client } = await setup();

            const res = await client.get(url("l-does-not-exist"));

            expect(res.status).toBe(404);
            expect(res.body.error.code).toBe("list.not_found");
        });

        it("returns an archived list (soft-delete is still readable) with archived_at as ISO", async () => {
            const { u, space, client } = await setup();
            const archivedAt = new Date();
            const id = await seedList(space.id, u.id, {
                name: "gone",
                archivedAt,
            });

            const res = await client.get(url(id));

            expect(res.status).toBe(200);
            expect(res.body.name).toBe("gone");
            expect(typeof res.body.archived_at).toBe("string");
            expect(res.body.archived_at).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/);
        });

        it("resolves a list under an archived space", async () => {
            const u = await makeUser();
            const space = await makeSpace({
                workspaceId: u.workspaceId,
                createdBy: u.id,
                archivedAt: new Date(),
            });
            const id = await seedList(space.id, u.id, {
                name: "under-archived-space",
            });
            const client = await makeLoggedInClient(u);

            const res = await client.get(url(id));

            expect(res.status).toBe(200);
            expect(res.body.name).toBe("under-archived-space");
        });
    });

    // ─── f. Tenant / workspace isolation ───────────────────────────────────────
    describe("Workspace isolation", () => {
        it("returns 404 (not the data) for a list in another workspace [IDOR]", async () => {
            const userA = await makeUser();
            const wsB = await makeWorkspace();
            const spaceB = await makeSpace({ workspaceId: wsB.id });
            const idB = await seedList(spaceB.id, spaceB.createdBy, {
                name: "secret-B",
            });
            const client = await makeLoggedInClient(userA);

            const res = await client.get(url(idB));

            expect(res.status).toBe(404);
            expect(res.body.error.code).toBe("list.not_found");
        });

        it("leaks no list fields in the cross-workspace 404 (no existence oracle)", async () => {
            const userA = await makeUser();
            const wsB = await makeWorkspace();
            const spaceB = await makeSpace({ workspaceId: wsB.id });
            const idB = await seedList(spaceB.id, spaceB.createdBy, {
                name: "secret-B",
            });
            const client = await makeLoggedInClient(userA);

            const res = await client.get(url(idB));

            expect(res.body).not.toHaveProperty("name");
            expect(res.body).not.toHaveProperty("space_id");
            expect(res.body.error.code).toBe("list.not_found");
        });

        it("resolves only the caller's own list when two workspaces hold lookalikes", async () => {
            const userA = await makeUser();
            const spaceA = await makeSpace({
                workspaceId: userA.workspaceId,
                createdBy: userA.id,
            });
            const idA = await seedList(spaceA.id, userA.id, { name: "mine" });

            const wsB = await makeWorkspace();
            const spaceB = await makeSpace({ workspaceId: wsB.id });
            await seedList(spaceB.id, spaceB.createdBy, { name: "theirs" });

            const client = await makeLoggedInClient(userA);
            const res = await client.get(url(idA));

            expect(res.status).toBe(200);
            expect(res.body.name).toBe("mine");
        });
    });

    // ─── g. Concurrency (reads only) ────────────────────────────────────────────
    describe("Concurrency", () => {
        it("serves 50 parallel reads with identical, consistent results", async () => {
            const { u, space, client } = await setup();
            const id = await seedList(space.id, u.id, { name: "Solo" });

            const results = await Promise.all(
                Array.from({ length: 50 }, () => client.get(url(id))),
            );

            for (const r of results) {
                expect(r.status).toBe(200);
                expect(r.body.id).toBe(id);
                expect(r.body.name).toBe("Solo");
            }
        });
    });

    // ─── h. Boundary values ─────────────────────────────────────────────────────
    describe("Boundary values", () => {
        it("returns a unicode list name intact (Bangla, emoji, RTL Arabic)", async () => {
            const { u, space, client } = await setup();
            const name = "ক্রয় 🔥 قائمة";
            const id = await seedList(space.id, u.id, { name });

            const res = await client.get(url(id));

            expect(res.body.name).toBe(name);
        });

        it("returns a max-length (120-char) name untruncated", async () => {
            const { u, space, client } = await setup();
            const longName = "x".repeat(120);
            const id = await seedList(space.id, u.id, { name: longName });

            const res = await client.get(url(id));

            expect(res.body.name).toBe(longName);
            expect(res.body.name).toHaveLength(120);
        });

        it("returns a max-length (500-char) description untruncated", async () => {
            const { u, space, client } = await setup();
            const longDesc = "d".repeat(500);
            const id = await seedList(space.id, u.id, { description: longDesc });

            const res = await client.get(url(id));

            expect(res.body.description).toBe(longDesc);
        });

        it("returns the schema default icon and color when not set", async () => {
            const { u, space, client } = await setup();
            const id = await seedList(space.id, u.id, { name: "Defaults" });

            const res = await client.get(url(id));

            expect(res.body.icon).toBe("ListChecks");
            expect(res.body.color).toBe("#4F46E5");
        });

        it("returns an is_private=true list with the flag set", async () => {
            const { u, space, client } = await setup();
            const id = await seedList(space.id, u.id, { isPrivate: true });

            const res = await client.get(url(id));

            expect(res.body.is_private).toBe(true);
        });
    });

    // ─── i. Side effects (a read must mutate nothing) ───────────────────────────
    describe("Side effects", () => {
        it("writes no workspace_activity rows", async () => {
            const { u, space, client } = await setup();
            const id = await seedList(space.id, u.id);

            await client.get(url(id));

            expect(await countWorkspaceActivity()).toBe(0);
        });

        it("does not change the list row count", async () => {
            const { u, space, client } = await setup();
            const id = await seedList(space.id, u.id);

            const before = await countAllLists();
            await client.get(url(id));

            expect(await countAllLists()).toBe(before);
        });
    });

    // ─── j. Cross-cutting ───────────────────────────────────────────────────────
    describe("Cross-cutting", () => {
        it("responds as application/json with an X-Request-Id header", async () => {
            const { u, space, client } = await setup();
            const id = await seedList(space.id, u.id);

            const res = await client.get(url(id));

            expect(res.headers["content-type"]).toMatch(/application\/json/);
            expect(res.get("X-Request-Id")).toMatch(/^req_/);
        });

        it("echoes a client-supplied X-Request-Id into the 404 error envelope", async () => {
            const { client } = await setup();

            const res = await client
                .get(url("l-nope"))
                .set("X-Request-Id", "req_custom_123");

            expect(res.get("X-Request-Id")).toBe("req_custom_123");
            expect(res.body.error.request_id).toBe("req_custom_123");
        });

        it("renders the spec error envelope on 401 (request_id matches header)", async () => {
            const { u, space } = await setup();
            const id = await seedList(space.id, u.id);
            const http = await oneOff();

            const res = await http.get(url(id));

            expect(res.body.error).toBeDefined();
            expect(typeof res.body.error.code).toBe("string");
            expect(typeof res.body.error.message).toBe("string");
            expect(res.body.error.request_id).toBe(res.get("X-Request-Id"));
        });

        it("returns 404 route.not_found for POST on the same path", async () => {
            const { u, space, client } = await setup();
            const id = await seedList(space.id, u.id);

            const res = await client.post(url(id));

            expect(res.status).toBe(404);
            expect(res.body.error.code).toBe("route.not_found");
        });

        it("returns 404 route.not_found for a bogus deeper path", async () => {
            const { u, space, client } = await setup();
            const id = await seedList(space.id, u.id);

            const res = await client.get(`${url(id)}/extra/segments`);

            expect(res.status).toBe(404);
            expect(res.body.error.code).toBe("route.not_found");
        });
    });

    // ─── k. Exploratory probes ──────────────────────────────────────────────────
    describe("Exploratory", () => {
        it("treats an injection-shaped id as a literal id → 404", async () => {
            const { client } = await setup();

            const res = await client.get(
                url(encodeURIComponent("l-1' OR '1'='1")),
            );

            expect(res.status).toBe(404);
            expect(res.body.error.code).toBe("list.not_found");
        });

        it("trims surrounding whitespace in the id path segment", async () => {
            const { u, space, client } = await setup();
            const id = await seedList(space.id, u.id, { name: "trimmed-ok" });

            const res = await client.get(url(`%20${id}%20`));

            expect(res.status).toBe(200);
            expect(res.body.name).toBe("trimmed-ok");
        });

        it("ignores a JSON body on GET and still returns the list", async () => {
            const { u, space, client } = await setup();
            const id = await seedList(space.id, u.id, { name: "a" });

            const res = await client
                .get(url(id))
                .send({ deeply: { nested: { junk: true } } });

            expect(res.status).toBe(200);
            expect(res.body.name).toBe("a");
        });

        it("serves the request regardless of an exotic Accept header", async () => {
            const { u, space, client } = await setup();
            const id = await seedList(space.id, u.id);

            const res = await client.get(url(id)).set("Accept", "text/plain, */*");

            expect(res.status).toBe(200);
            expect(res.headers["content-type"]).toMatch(/application\/json/);
        });
    });
});
