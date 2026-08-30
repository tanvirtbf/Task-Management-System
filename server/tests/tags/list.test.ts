import jwt from "jsonwebtoken";
import { eq } from "drizzle-orm";
import { oneOff } from "../test-utils/app";
import {
    makeLoggedInClient,
    makeUser,
    makeWorkspace,
} from "../test-utils/factories";
import { getDb } from "../../src/db/client";
import { tags, workspaceActivity } from "../../src/db/schema";
import { fakeId } from "../../src/utils";
import { Config } from "../../src/config";
import type { Role } from "../../src/constants";

/**
 * Tests for `GET /api/v1/tags` (§9).
 *
 * Patterns mirror `tests/auth/login.test.ts`:
 *   - Real DB writes via `tests/test-utils/factories` (no mocks).
 *   - Stateless supertest via `oneOff()`; authed calls via `makeLoggedInClient`.
 *   - `beforeEach` (setup-each.ts) truncates every table, so tests are
 *     independent and order-free.
 *
 * The endpoint is a bounded, workspace-wide collection: it returns EVERY tag in
 * the caller's workspace as a single complete page (`next_cursor: null`,
 * `has_more: false`), ordered by name. It has no body and consumes no query
 * params. `tags` has no `archived_at` (no soft delete) and no `internal_id`
 * (no cursor) — hence the N/A notes per block.
 */

const TAGS = "/api/v1/tags";

interface WireTag {
    id: string;
    name: string;
    color: string;
}

const dataOf = (body: unknown): WireTag[] =>
    (body as { data: WireTag[] }).data;

const namesOf = (body: unknown): string[] => dataOf(body).map((t) => t.name);

const countWorkspaceActivity = async (): Promise<number> => {
    const db = getDb();
    return (
        await db.select({ id: workspaceActivity.id }).from(workspaceActivity)
    ).length;
};

const countTags = async (workspaceId: string): Promise<number> => {
    const db = getDb();
    return (
        await db
            .select({ id: tags.id })
            .from(tags)
            .where(eq(tags.workspaceId, workspaceId))
    ).length;
};

/** Seed several tags in a workspace in one round-trip (faster than N inserts). */
const seedTags = async (
    workspaceId: string,
    rows: Array<{ name: string; color?: string }>,
) => {
    const db = getDb();
    await db.insert(tags).values(
        rows.map((r) => ({
            id: fakeId("tag"),
            workspaceId,
            name: r.name,
            color: r.color ?? "#94A3B8",
        })),
    );
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

// ════════════════════════════════════════════════════════════════════════════
describe("GET /api/v1/tags", () => {
    // ─── a. Happy path ──────────────────────────────────────────────────────
    describe("Happy path", () => {
        it("returns 200 with the spec list envelope for a workspace's tags", async () => {
            const u = await makeUser();
            await seedTags(u.workspaceId, [{ name: "Alpha" }]);
            const client = await makeLoggedInClient(u);

            const res = await client.get(TAGS);

            expect(res.status).toBe(200);
            expect(Array.isArray(res.body.data)).toBe(true);
            expect(res.body.data).toHaveLength(1);
        });

        it("shapes each row as exactly { id, name, color } — no leaked columns", async () => {
            const u = await makeUser();
            await seedTags(u.workspaceId, [{ name: "VIP", color: "#E11D48" }]);
            const client = await makeLoggedInClient(u);

            const res = await client.get(TAGS);
            const [tag] = dataOf(res.body);

            expect(Object.keys(tag).sort()).toEqual(["color", "id", "name"]);
            expect(tag.name).toBe("VIP");
            expect(tag.color).toBe("#E11D48");
            expect(tag.id).toMatch(/^tag-/);
        });

        it("never leaks workspace_id, timestamps, space_id or internal_id", async () => {
            const u = await makeUser();
            await seedTags(u.workspaceId, [{ name: "Urgent" }]);
            const client = await makeLoggedInClient(u);

            const [tag] = dataOf((await client.get(TAGS)).body);

            expect(tag).not.toHaveProperty("workspace_id");
            expect(tag).not.toHaveProperty("workspaceId");
            expect(tag).not.toHaveProperty("created_at");
            expect(tag).not.toHaveProperty("updated_at");
            expect(tag).not.toHaveProperty("space_id");
            expect(tag).not.toHaveProperty("internal_id");
        });

        it("orders tags by name ascending", async () => {
            const u = await makeUser();
            await seedTags(u.workspaceId, [
                { name: "Zeta" },
                { name: "Alpha" },
                { name: "Mango" },
            ]);
            const client = await makeLoggedInClient(u);

            const res = await client.get(TAGS);

            expect(namesOf(res.body)).toEqual(["Alpha", "Mango", "Zeta"]);
        });

        it("returns the full-page pagination block (no cursor, exact count)", async () => {
            const u = await makeUser();
            await seedTags(u.workspaceId, [
                { name: "a" },
                { name: "b" },
                { name: "c" },
            ]);
            const client = await makeLoggedInClient(u);

            const res = await client.get(TAGS);

            expect(res.body.pagination).toEqual({
                next_cursor: null,
                has_more: false,
                total_estimate: 3,
            });
        });

        it("returns an empty list (not 404) when the workspace has no tags", async () => {
            const u = await makeUser();
            const client = await makeLoggedInClient(u);

            const res = await client.get(TAGS);

            expect(res.status).toBe(200);
            expect(res.body.data).toEqual([]);
            expect(res.body.pagination.total_estimate).toBe(0);
            expect(res.body.pagination.has_more).toBe(false);
            expect(res.body.pagination.next_cursor).toBeNull();
        });
    });

    // ─── b. Input robustness (no body/params consumed → params are ignored) ──
    describe("Query-param robustness", () => {
        it("honours ?limit (F23/ISS-007 — it was silently ignored)", async () => {
            const u = await makeUser();
            await seedTags(u.workspaceId, [
                { name: "a" },
                { name: "b" },
                { name: "c" },
            ]);
            const client = await makeLoggedInClient(u);

            const res = await client.get(`${TAGS}?limit=1`);

            expect(res.status).toBe(200);
            expect(res.body.data).toHaveLength(1);
            expect(res.body.pagination.has_more).toBe(true);
            expect(res.body.pagination.next_cursor).not.toBeNull();
        });

        it("refuses a cursor the server did not issue (F23/ISS-008)", async () => {
            const u = await makeUser();
            await seedTags(u.workspaceId, [{ name: "a" }, { name: "b" }]);
            const client = await makeLoggedInClient(u);

            const res = await client.get(`${TAGS}?cursor=ignored-blob`);

            expect(res.status).toBe(400);
            expect(res.body.error.code).toBe("pagination.invalid_cursor");
        });

        it("refuses unknown query params, naming them (F23/ISS-014)", async () => {
            const u = await makeUser();
            await seedTags(u.workspaceId, [{ name: "a" }]);
            const client = await makeLoggedInClient(u);

            const res = await client.get(`${TAGS}?foo=bar&q=zzz&page=9`);

            expect(res.status).toBe(422);
            expect(JSON.stringify(res.body)).toContain("foo");
        });
    });

    // ─── c. Authentication ──────────────────────────────────────────────────
    describe("Authentication", () => {
        it("returns 401 auth.missing_token when no token is supplied", async () => {
            const http = await oneOff();
            const res = await http.get(TAGS);

            expect(res.status).toBe(401);
            expect(res.body.error.code).toBe("auth.missing_token");
        });

        it("returns 401 auth.invalid_token for a malformed bearer token", async () => {
            const http = await oneOff();
            const res = await http
                .get(TAGS)
                .set("Authorization", "Bearer not.a.real.jwt");

            expect(res.status).toBe(401);
            expect(res.body.error.code).toBe("auth.invalid_token");
        });

        it("returns 401 auth.invalid_token for a token signed with the wrong secret", async () => {
            const u = await makeUser();
            const token = signAccess(u, "wrong-secret-not-the-real-one", {
                expiresIn: "15m",
            });
            const http = await oneOff();
            const res = await http
                .get(TAGS)
                .set("Authorization", `Bearer ${token}`);

            expect(res.status).toBe(401);
            expect(res.body.error.code).toBe("auth.invalid_token");
        });

        it("returns 401 auth.expired_token for an expired token", async () => {
            const u = await makeUser();
            const token = signAccess(u, Config.ACCESS_TOKEN_SECRET!, {
                expiresIn: -10,
            });
            const http = await oneOff();
            const res = await http
                .get(TAGS)
                .set("Authorization", `Bearer ${token}`);

            expect(res.status).toBe(401);
            expect(res.body.error.code).toBe("auth.expired_token");
        });

        it("still serves a deactivated user holding a valid access token (stateless JWT; matches siblings)", async () => {
            // express-jwt does not re-check DB status; an access token stays
            // valid until its ≤15-min expiry. Deactivation revokes the refresh
            // token, so this window is bounded. Documented, intentional.
            const u = await makeUser({ status: "deactivated" });
            await seedTags(u.workspaceId, [{ name: "Still-Visible" }]);
            const client = await makeLoggedInClient(u);

            const res = await client.get(TAGS);

            expect(res.status).toBe(200);
            expect(namesOf(res.body)).toEqual(["Still-Visible"]);
        });
    });

    // ─── d. Authorization (🔐 any role; no forbidden tier) ───────────────────
    describe("Authorization", () => {
        const roles: Role[] = ["owner", "admin", "member", "guest"];
        for (const role of roles) {
            it(`allows a ${role} to list tags (200)`, async () => {
                const u = await makeUser({ role });
                await seedTags(u.workspaceId, [{ name: "Shared" }]);
                const client = await makeLoggedInClient(u);

                const res = await client.get(TAGS);

                expect(res.status).toBe(200);
                expect(namesOf(res.body)).toEqual(["Shared"]);
            });
        }
    });

    // ─── g. Tenant / workspace isolation ─────────────────────────────────────
    describe("Workspace isolation", () => {
        it("returns only the caller's workspace tags, never another workspace's", async () => {
            const wsA = await makeWorkspace();
            const wsB = await makeWorkspace();
            const userA = await makeUser({ workspaceId: wsA.id });
            await seedTags(wsA.id, [{ name: "A-one" }, { name: "A-two" }]);
            await seedTags(wsB.id, [{ name: "B-one" }]);
            const client = await makeLoggedInClient(userA);

            const res = await client.get(TAGS);

            expect(namesOf(res.body)).toEqual(["A-one", "A-two"]);
        });

        it("scopes a second workspace's user to their own tags", async () => {
            const wsA = await makeWorkspace();
            const wsB = await makeWorkspace();
            const userB = await makeUser({ workspaceId: wsB.id });
            await seedTags(wsA.id, [{ name: "A-one" }, { name: "A-two" }]);
            await seedTags(wsB.id, [{ name: "B-one" }]);
            const client = await makeLoggedInClient(userB);

            const res = await client.get(TAGS);

            expect(namesOf(res.body)).toEqual(["B-one"]);
        });

        it("counts total_estimate per the caller's workspace only", async () => {
            const wsA = await makeWorkspace();
            const wsB = await makeWorkspace();
            const userA = await makeUser({ workspaceId: wsA.id });
            await seedTags(wsA.id, [{ name: "A-one" }, { name: "A-two" }]);
            await seedTags(wsB.id, [{ name: "B-one" }, { name: "B-two" }, { name: "B-three" }]);
            const client = await makeLoggedInClient(userA);

            const res = await client.get(TAGS);

            expect(res.body.pagination.total_estimate).toBe(2);
        });

        it("refuses a ?workspace_id query param (F23/ISS-014 — stronger than ignoring)", async () => {
            const wsA = await makeWorkspace();
            const wsB = await makeWorkspace();
            const userA = await makeUser({ workspaceId: wsA.id });
            await seedTags(wsA.id, [{ name: "A-one" }]);
            await seedTags(wsB.id, [{ name: "B-one" }]);
            const client = await makeLoggedInClient(userA);

            const res = await client.get(`${TAGS}?workspace_id=${wsB.id}`);

            // The request never executes, so it cannot cross tenants at all.
            expect(res.status).toBe(422);
            expect(JSON.stringify(res.body)).toContain("workspace_id");
        });
    });

    // ─── i. Concurrency (reads only — endpoint is read-only) ─────────────────
    describe("Concurrency", () => {
        it("serves 50 parallel reads with identical, consistent results", async () => {
            const u = await makeUser();
            await seedTags(u.workspaceId, [
                { name: "a" },
                { name: "b" },
                { name: "c" },
            ]);
            const client = await makeLoggedInClient(u);

            const results = await Promise.all(
                Array.from({ length: 50 }, () => client.get(TAGS)),
            );

            for (const r of results) {
                expect(r.status).toBe(200);
                expect(namesOf(r.body)).toEqual(["a", "b", "c"]);
            }
        });
    });

    // ─── j. Pagination (collection mode — single complete page) ──────────────
    describe("Collection pagination", () => {
        it("pages a large tag set at the §1 default limit (F23/ISS-007)", async () => {
            const u = await makeUser();
            const rows = Array.from({ length: 250 }, (_, i) => ({
                name: `tag-${String(i).padStart(3, "0")}`,
            }));
            await seedTags(u.workspaceId, rows);
            const client = await makeLoggedInClient(u);

            const res = await client.get(TAGS);

            expect(res.body.data).toHaveLength(100);
            expect(res.body.pagination.has_more).toBe(true);
            expect(res.body.pagination.total_estimate).toBe(250);
            const page2 = await client
                .get(TAGS)
                .query({ cursor: res.body.pagination.next_cursor, limit: 200 });
            expect(page2.body.data).toHaveLength(150);
            expect(page2.body.pagination.has_more).toBe(false);
            // zero-padded names => insertion order already equals sort order
            expect(dataOf(res.body)[0].name).toBe("tag-000");
            expect(dataOf(page2.body)[149].name).toBe("tag-249");
        });

        it("returns the identical full set on a repeated request (stability)", async () => {
            const u = await makeUser();
            await seedTags(u.workspaceId, [
                { name: "a" },
                { name: "b" },
                { name: "c" },
            ]);
            const client = await makeLoggedInClient(u);

            const first = namesOf((await client.get(TAGS)).body);
            const second = namesOf((await client.get(TAGS)).body);

            expect(second).toEqual(first);
        });
    });

    // ─── k. Boundary values ──────────────────────────────────────────────────
    describe("Boundary values", () => {
        it("returns unicode tag names intact (Bangla, emoji, RTL Arabic)", async () => {
            const u = await makeUser();
            await seedTags(u.workspaceId, [
                { name: "ঈদ উৎসব" },
                { name: "🔥 Sale" },
                { name: "عرض خاص" },
            ]);
            const client = await makeLoggedInClient(u);

            const got = namesOf((await client.get(TAGS)).body);

            expect(got).toContain("ঈদ উৎসব");
            expect(got).toContain("🔥 Sale");
            expect(got).toContain("عرض خاص");
        });

        it("returns a max-length (60-char) name untruncated", async () => {
            const u = await makeUser();
            const longName = "x".repeat(60);
            await seedTags(u.workspaceId, [{ name: longName }]);
            const client = await makeLoggedInClient(u);

            const [tag] = dataOf((await client.get(TAGS)).body);

            expect(tag.name).toBe(longName);
            expect(tag.name).toHaveLength(60);
        });

        it("passes an explicit color through verbatim", async () => {
            const u = await makeUser();
            await seedTags(u.workspaceId, [{ name: "Red", color: "#FF0000" }]);
            const client = await makeLoggedInClient(u);

            const [tag] = dataOf((await client.get(TAGS)).body);

            expect(tag.color).toBe("#FF0000");
        });

        it("returns the schema default color (#94A3B8) when none was set", async () => {
            const u = await makeUser();
            const db = getDb();
            // Insert WITHOUT a color so MySQL applies the column DEFAULT.
            await db
                .insert(tags)
                .values({ id: fakeId("tag"), workspaceId: u.workspaceId, name: "Default" });
            const client = await makeLoggedInClient(u);

            const [tag] = dataOf((await client.get(TAGS)).body);

            expect(tag.color).toBe("#94A3B8");
        });

        it("handles a single tag (N=1)", async () => {
            const u = await makeUser();
            await seedTags(u.workspaceId, [{ name: "Solo" }]);
            const client = await makeLoggedInClient(u);

            const res = await client.get(TAGS);

            expect(res.body.data).toHaveLength(1);
            expect(res.body.pagination.total_estimate).toBe(1);
        });
    });

    // ─── l. Side effects (a read must mutate nothing) ─────────────────────────
    describe("Side effects", () => {
        it("writes no workspace_activity rows", async () => {
            const u = await makeUser();
            await seedTags(u.workspaceId, [{ name: "a" }]);
            const client = await makeLoggedInClient(u);

            await client.get(TAGS);

            expect(await countWorkspaceActivity()).toBe(0);
        });

        it("does not change the tag row count", async () => {
            const u = await makeUser();
            await seedTags(u.workspaceId, [{ name: "a" }, { name: "b" }]);
            const client = await makeLoggedInClient(u);

            const before = await countTags(u.workspaceId);
            await client.get(TAGS);

            expect(await countTags(u.workspaceId)).toBe(before);
        });
    });

    // ─── Cross-cutting ────────────────────────────────────────────────────────
    describe("Cross-cutting", () => {
        it("responds as application/json with an X-Request-Id header", async () => {
            const u = await makeUser();
            const client = await makeLoggedInClient(u);

            const res = await client.get(TAGS);

            expect(res.headers["content-type"]).toMatch(/application\/json/);
            expect(res.get("X-Request-Id")).toMatch(/^req_/);
        });

        it("renders the spec error envelope (with matching request_id) on 401", async () => {
            const http = await oneOff();
            const res = await http.get(TAGS);

            expect(res.body.error).toBeDefined();
            expect(typeof res.body.error.code).toBe("string");
            expect(typeof res.body.error.message).toBe("string");
            expect(res.body.error.request_id).toBe(res.get("X-Request-Id"));
        });

        it("returns 404 route.not_found for a bogus deep path under /tags", async () => {
            const http = await oneOff();
            const res = await http.get(`${TAGS}/deep/bogus/path`);

            expect(res.status).toBe(404);
            expect(res.body.error.code).toBe("route.not_found");
        });
    });

    // ─── Exploratory probes (Step 7) ──────────────────────────────────────────
    describe("Exploratory", () => {
        it("refuses duplicated query params (?limit=1&limit=2 is not an integer)", async () => {
            const u = await makeUser();
            await seedTags(u.workspaceId, [{ name: "a" }, { name: "b" }]);
            const client = await makeLoggedInClient(u);

            const res = await client.get(`${TAGS}?limit=1&limit=2`);

            expect(res.status).toBe(422);
        });

        it("refuses an absurdly long ?cursor cleanly (400, never 500)", async () => {
            const u = await makeUser();
            await seedTags(u.workspaceId, [{ name: "a" }]);
            const client = await makeLoggedInClient(u);

            const res = await client.get(`${TAGS}?cursor=${"A".repeat(10000)}`);

            expect(res.status).toBe(400);
            expect(res.body.error.code).toBe("pagination.invalid_cursor");
        });

        it("serves the request regardless of an exotic Accept header", async () => {
            const u = await makeUser();
            await seedTags(u.workspaceId, [{ name: "a" }]);
            const client = await makeLoggedInClient(u);

            const res = await client.get(TAGS).set("Accept", "text/plain, */*");

            expect(res.status).toBe(200);
            expect(res.headers["content-type"]).toMatch(/application\/json/);
        });

        it("treats a SQL-control-character workspace claim as data, not SQL (no leak, no error)", async () => {
            // Seed real tags in a legitimate workspace, then hit the endpoint
            // with a validly-signed token whose workspaceId is a classic SQL
            // injection. Drizzle binds it as a parameter, so it matches nothing
            // — never a 500, never another workspace's rows.
            const victim = await makeWorkspace();
            await seedTags(victim.id, [{ name: "Victim-Secret" }]);
            const token = signAccess(
                {
                    id: fakeId("u"),
                    workspaceId: "ws' OR '1'='1",
                    role: "member",
                },
                Config.ACCESS_TOKEN_SECRET!,
                { expiresIn: "15m" },
            );
            const http = await oneOff();

            const res = await http
                .get(TAGS)
                .set("Authorization", `Bearer ${token}`);

            expect(res.status).toBe(200);
            expect(res.body.data).toEqual([]);
        });
    });
});
