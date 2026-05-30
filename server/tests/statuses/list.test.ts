import jwt from "jsonwebtoken";
import { oneOff } from "../test-utils/app";
import {
    makeUser,
    makeWorkspace,
    makeLoggedInClient,
} from "../test-utils/factories";
import { getDb } from "../../src/db/client";
import {
    spaces,
    lists,
    statuses,
    taskActivity,
    workspaceActivity,
} from "../../src/db/schema";
import { fakeId } from "../../src/utils";
import { Config } from "../../src/config";
import type { Role } from "../../src/constants";

/**
 * Tests for `GET /api/v1/lists/:listId/statuses` (§7 Statuses).
 *
 * Patterns mirror `tests/auth/*` and `tests/tags/list.test.ts`:
 *   - Real DB writes (no mocks); `beforeEach` (setup-each.ts) truncates.
 *   - `makeLoggedInClient` mints a real access cookie without /auth/login.
 *   - Stateless negative requests via `oneOff()`.
 *
 * Space/List/Status seed helpers are local (not in the shared factory file) to
 * avoid colliding with concurrently-added `makeSpace`/`makeList` factories.
 */

const PATH = (listId: string) => `/api/v1/lists/${listId}/statuses`;

type StatusGroup = "not_started" | "active" | "done" | "closed";

// ─── local seed helpers (real DB inserts) ────────────────────────────────────

const insertSpace = async (
    workspaceId: string,
    createdBy: string,
    overrides: Partial<{ id: string; archivedAt: Date | null }> = {},
): Promise<string> => {
    const db = getDb();
    const id = overrides.id ?? fakeId("sp");
    await db.insert(spaces).values({
        id,
        workspaceId,
        name: "Test Space",
        createdBy,
        archivedAt: overrides.archivedAt ?? null,
    });
    return id;
};

const insertList = async (
    spaceId: string,
    createdBy: string,
    overrides: Partial<{ id: string; archivedAt: Date | null }> = {},
): Promise<string> => {
    const db = getDb();
    const id = overrides.id ?? fakeId("l");
    await db.insert(lists).values({
        id,
        spaceId,
        name: "Test List",
        createdBy,
        archivedAt: overrides.archivedAt ?? null,
    });
    return id;
};

interface StatusSeed {
    id?: string;
    name?: string;
    color?: string;
    statusGroup?: StatusGroup;
    position?: number;
    scopeType?: "list" | "space";
}

let _statusSeq = 0;

const insertStatus = async (
    listId: string,
    seed: StatusSeed = {},
): Promise<{ id: string; name: string }> => {
    const db = getDb();
    const id = seed.id ?? fakeId("s");
    const name = seed.name ?? `Status ${++_statusSeq}`;
    await db.insert(statuses).values({
        id,
        scopeType: seed.scopeType ?? "list",
        scopeId: listId,
        name,
        color: seed.color ?? "#94A3B8",
        statusGroup: seed.statusGroup ?? "active",
        position: seed.position ?? 0,
    });
    return { id, name };
};

/** A workspace + member user + logged-in client + one empty list. */
const setup = async (opts: { role?: Role } = {}) => {
    const ws = await makeWorkspace();
    const user = await makeUser({ workspaceId: ws.id, role: opts.role ?? "member" });
    const client = await makeLoggedInClient(user);
    const spaceId = await insertSpace(ws.id, user.id);
    const listId = await insertList(spaceId, user.id);
    return { ws, user, client, spaceId, listId };
};

// ─── count helpers (side-effect assertions) ──────────────────────────────────

const countStatuses = async () =>
    (await getDb().select({ id: statuses.id }).from(statuses)).length;
const countTaskActivity = async () =>
    (await getDb().select({ id: taskActivity.id }).from(taskActivity)).length;
const countWorkspaceActivity = async () =>
    (await getDb().select({ id: workspaceActivity.id }).from(workspaceActivity))
        .length;

const STATUS_KEYS = [
    "color",
    "id",
    "name",
    "position",
    "scope_id",
    "scope_type",
    "status_group",
];

// ════════════════════════════════════════════════════════════════════════════
describe("GET /api/v1/lists/:listId/statuses", () => {
    // ─── a. Happy path ────────────────────────────────────────────────────────
    describe("Happy path", () => {
        it("returns 200 and a bare JSON array (not a {data,pagination} envelope)", async () => {
            const { client, listId } = await setup();
            await insertStatus(listId, { position: 0 });

            const res = await client.get(PATH(listId));

            expect(res.status).toBe(200);
            expect(Array.isArray(res.body)).toBe(true);
            expect(res.body).not.toHaveProperty("data");
            expect(res.body).not.toHaveProperty("pagination");
        });

        it("returns every status for the list", async () => {
            const { client, listId } = await setup();
            await insertStatus(listId, { position: 0 });
            await insertStatus(listId, { position: 1 });
            await insertStatus(listId, { position: 2 });

            const res = await client.get(PATH(listId));
            expect(res.status).toBe(200);
            expect(res.body).toHaveLength(3);
        });

        it("orders statuses by ascending position", async () => {
            const { client, listId } = await setup();
            // Insert out of order on purpose.
            await insertStatus(listId, { name: "C", position: 2 });
            await insertStatus(listId, { name: "A", position: 0 });
            await insertStatus(listId, { name: "B", position: 1 });

            const res = await client.get(PATH(listId));
            expect(res.body.map((s: { position: number }) => s.position)).toEqual([
                0, 1, 2,
            ]);
            expect(res.body.map((s: { name: string }) => s.name)).toEqual([
                "A",
                "B",
                "C",
            ]);
        });

        it("exposes exactly the Appendix-A wire fields (no created_at/updated_at/workspace leak)", async () => {
            const { client, listId } = await setup();
            await insertStatus(listId);

            const res = await client.get(PATH(listId));
            expect(Object.keys(res.body[0]).sort()).toEqual(STATUS_KEYS);
        });

        it("each element carries scope_type='list' and scope_id=listId", async () => {
            const { client, listId } = await setup();
            await insertStatus(listId);
            await insertStatus(listId, { position: 1 });

            const res = await client.get(PATH(listId));
            for (const s of res.body) {
                expect(s.scope_type).toBe("list");
                expect(s.scope_id).toBe(listId);
            }
        });

        it("returns the stored field values verbatim", async () => {
            const { client, listId } = await setup();
            await insertStatus(listId, {
                id: "s-fixed-1",
                name: "In Review",
                color: "#F59E0B",
                statusGroup: "active",
                position: 3,
            });

            const res = await client.get(PATH(listId));
            expect(res.body[0]).toEqual({
                id: "s-fixed-1",
                scope_type: "list",
                scope_id: listId,
                name: "In Review",
                color: "#F59E0B",
                status_group: "active",
                position: 3,
            });
        });
    });

    // ─── Empty set & list scoping ─────────────────────────────────────────────
    describe("Empty set & scoping", () => {
        it("returns 200 [] for a list with no statuses (NOT 404)", async () => {
            const { client, listId } = await setup();

            const res = await client.get(PATH(listId));
            expect(res.status).toBe(200);
            expect(res.body).toEqual([]);
        });

        it("returns only the requested list's statuses, not a sibling list's", async () => {
            const { client, user, spaceId, listId } = await setup();
            const otherList = await insertList(spaceId, user.id);
            await insertStatus(listId, { name: "mine", position: 0 });
            await insertStatus(otherList, { name: "theirs", position: 0 });

            const res = await client.get(PATH(listId));
            expect(res.body).toHaveLength(1);
            expect(res.body[0].name).toBe("mine");
        });

        it("ignores space-scoped status rows that happen to share the id", async () => {
            // V1 statuses are list-scoped; a stray space-scoped row must not leak.
            const { client, listId } = await setup();
            await insertStatus(listId, { name: "list-scoped", position: 0 });
            await insertStatus(listId, {
                name: "space-scoped",
                position: 1,
                scopeType: "space",
            });

            const res = await client.get(PATH(listId));
            expect(res.body).toHaveLength(1);
            expect(res.body[0].name).toBe("list-scoped");
        });
    });

    // ─── Ordering determinism ─────────────────────────────────────────────────
    describe("Ordering", () => {
        it("breaks position ties deterministically by id (ascending)", async () => {
            const { client, listId } = await setup();
            await insertStatus(listId, { id: "s-pos5-b", name: "B", position: 5 });
            await insertStatus(listId, { id: "s-pos5-a", name: "A", position: 5 });

            const res = await client.get(PATH(listId));
            expect(res.body.map((s: { id: string }) => s.id)).toEqual([
                "s-pos5-a",
                "s-pos5-b",
            ]);
        });

        it("returns a large status set fully and in order", async () => {
            const { client, listId } = await setup();
            for (let i = 0; i < 50; i++) {
                await insertStatus(listId, { name: `S${i}`, position: i });
            }

            const res = await client.get(PATH(listId));
            expect(res.body).toHaveLength(50);
            const positions = res.body.map((s: { position: number }) => s.position);
            const sorted = [...positions].sort((a, b) => a - b);
            expect(positions).toEqual(sorted);
        });
    });

    // ─── b. Validation ────────────────────────────────────────────────────────
    describe("Validation", () => {
        it("returns 422 validation.failed when listId exceeds 64 chars", async () => {
            const { client } = await setup();
            const tooLong = "a".repeat(65);

            const res = await client.get(PATH(tooLong));
            expect(res.status).toBe(422);
            expect(res.body.error.code).toBe("validation.failed");
            expect(res.body.error.details[0].field).toBe("listId");
        });

        it("accepts a 64-char listId as valid (404, not 422)", async () => {
            const { client } = await setup();
            const maxLen = "a".repeat(64);

            const res = await client.get(PATH(maxLen));
            expect(res.status).toBe(404);
            expect(res.body.error.code).toBe("list.not_found");
        });

        it("returns 422 when listId is whitespace-only (trim → empty)", async () => {
            const { client } = await setup();

            const res = await client.get(PATH("%20%20"));
            expect(res.status).toBe(422);
            expect(res.body.error.code).toBe("validation.failed");
            expect(res.body.error.details[0].field).toBe("listId");
        });

        it("runs authentication before validation (unauth + bad param → 401)", async () => {
            const http = await oneOff();
            const res = await http.get(PATH("a".repeat(65)));
            expect(res.status).toBe(401);
        });
    });

    // ─── c. Authentication ────────────────────────────────────────────────────
    describe("Authentication", () => {
        it("returns 401 auth.missing_token with no credentials", async () => {
            const { listId } = await setup();
            const http = await oneOff();

            const res = await http.get(PATH(listId));
            expect(res.status).toBe(401);
            expect(res.body.error.code).toBe("auth.missing_token");
        });

        it("returns 401 auth.invalid_token for a garbage Bearer token", async () => {
            const { listId } = await setup();
            const http = await oneOff();

            const res = await http
                .get(PATH(listId))
                .set("Authorization", "Bearer not-a-jwt");
            expect(res.status).toBe(401);
            expect(res.body.error.code).toBe("auth.invalid_token");
        });

        it("returns 401 auth.invalid_token for a token signed with the wrong secret", async () => {
            const u = await makeUser();
            const { listId } = await setup();
            const forged = jwt.sign(
                { sub: u.id, role: u.role, workspaceId: u.workspaceId },
                "totally-wrong-secret",
                { algorithm: "HS256", expiresIn: "15m" },
            );
            const http = await oneOff();

            const res = await http
                .get(PATH(listId))
                .set("Authorization", `Bearer ${forged}`);
            expect(res.status).toBe(401);
            expect(res.body.error.code).toBe("auth.invalid_token");
        });

        it("returns 401 auth.expired_token for an expired access token", async () => {
            const u = await makeUser();
            const { listId } = await setup();
            const expired = jwt.sign(
                { sub: u.id, role: u.role, workspaceId: u.workspaceId },
                Config.ACCESS_TOKEN_SECRET!,
                { algorithm: "HS256", expiresIn: -10 },
            );
            const http = await oneOff();

            const res = await http
                .get(PATH(listId))
                .set("Authorization", `Bearer ${expired}`);
            expect(res.status).toBe(401);
            expect(res.body.error.code).toBe("auth.expired_token");
        });

        it("serves a deactivated user holding a still-valid access token (status enforced at refresh, not here)", async () => {
            // Access tokens are bearer credentials valid for their 15-min TTL;
            // deactivation is enforced when the refresh token rotates. Within the
            // window a valid access token still reads. This pins that contract.
            const ws = await makeWorkspace();
            const user = await makeUser({
                workspaceId: ws.id,
                status: "deactivated",
            });
            const client = await makeLoggedInClient(user);
            const spaceId = await insertSpace(ws.id, user.id);
            const listId = await insertList(spaceId, user.id);
            await insertStatus(listId);

            const res = await client.get(PATH(listId));
            expect(res.status).toBe(200);
            expect(res.body).toHaveLength(1);
        });
    });

    // ─── d. Authorization (role tiers) ────────────────────────────────────────
    describe("Authorization", () => {
        const roles: Role[] = ["owner", "admin", "member", "guest"];
        it.each(roles)("allows a %s to read the list's statuses (200)", async (role) => {
            const { client, listId } = await setup({ role });
            await insertStatus(listId);

            const res = await client.get(PATH(listId));
            expect(res.status).toBe(200);
            expect(res.body).toHaveLength(1);
        });
    });

    // ─── e/g. Lifecycle & tenant isolation ────────────────────────────────────
    describe("Lifecycle & tenant isolation", () => {
        it("returns 404 list.not_found for a non-existent listId", async () => {
            const { client } = await setup();

            const res = await client.get(PATH(fakeId("l")));
            expect(res.status).toBe(404);
            expect(res.body.error.code).toBe("list.not_found");
        });

        it("returns the statuses of an archived list (archive hides from lists, not direct reads)", async () => {
            const ws = await makeWorkspace();
            const user = await makeUser({ workspaceId: ws.id });
            const client = await makeLoggedInClient(user);
            const spaceId = await insertSpace(ws.id, user.id);
            const archivedList = await insertList(spaceId, user.id, {
                archivedAt: new Date(),
            });
            await insertStatus(archivedList, { name: "still here" });

            const res = await client.get(PATH(archivedList));
            expect(res.status).toBe(200);
            expect(res.body).toHaveLength(1);
            expect(res.body[0].name).toBe("still here");
        });

        it("returns 404 (not 200, not data) when the list belongs to another workspace", async () => {
            // Workspace A's user tries to read workspace B's list statuses.
            const a = await setup();
            const wsB = await makeWorkspace();
            const userB = await makeUser({ workspaceId: wsB.id });
            const spaceB = await insertSpace(wsB.id, userB.id);
            const listB = await insertList(spaceB, userB.id);
            await insertStatus(listB, { name: "secret-b" });

            const res = await a.client.get(PATH(listB));
            expect(res.status).toBe(404);
            expect(res.body.error.code).toBe("list.not_found");
        });

        it("a cross-workspace request never leaks the other workspace's status data", async () => {
            const a = await setup();
            const wsB = await makeWorkspace();
            const userB = await makeUser({ workspaceId: wsB.id });
            const spaceB = await insertSpace(wsB.id, userB.id);
            const listB = await insertList(spaceB, userB.id);
            await insertStatus(listB, { name: "secret-b" });

            const res = await a.client.get(PATH(listB));
            expect(JSON.stringify(res.body)).not.toContain("secret-b");
        });
    });

    // ─── k. Boundary values ───────────────────────────────────────────────────
    describe("Boundary values", () => {
        it("round-trips a unicode status name (emoji + Bangla + RTL) byte-for-byte", async () => {
            const { client, listId } = await setup();
            const name = "নতুন অর্ডার 🎉 مرحبا";
            await insertStatus(listId, { name });

            const res = await client.get(PATH(listId));
            expect(res.body[0].name).toBe(name);
        });

        it("returns a max-length (80-char) status name intact", async () => {
            const { client, listId } = await setup();
            const name = "x".repeat(80);
            await insertStatus(listId, { name });

            const res = await client.get(PATH(listId));
            expect(res.body[0].name).toBe(name);
            expect(res.body[0].name).toHaveLength(80);
        });

        it("returns a large position value as a number", async () => {
            const { client, listId } = await setup();
            await insertStatus(listId, { position: 2_000_000_000 });

            const res = await client.get(PATH(listId));
            expect(typeof res.body[0].position).toBe("number");
            expect(res.body[0].position).toBe(2_000_000_000);
        });
    });

    // ─── l. Side effects ──────────────────────────────────────────────────────
    describe("Side effects", () => {
        it("does not write task_activity rows", async () => {
            const { client, listId } = await setup();
            await insertStatus(listId);
            const before = await countTaskActivity();

            await client.get(PATH(listId));
            expect(await countTaskActivity()).toBe(before);
        });

        it("does not write workspace_activity rows", async () => {
            const { client, listId } = await setup();
            await insertStatus(listId);
            const before = await countWorkspaceActivity();

            await client.get(PATH(listId));
            expect(await countWorkspaceActivity()).toBe(before);
        });

        it("does not mutate the statuses table (read-only)", async () => {
            const { client, listId } = await setup();
            await insertStatus(listId);
            await insertStatus(listId, { position: 1 });
            const before = await countStatuses();

            await client.get(PATH(listId));
            expect(await countStatuses()).toBe(before);
        });
    });

    // ─── h/i. Idempotency (read) & concurrency ────────────────────────────────
    describe("Read consistency & concurrency", () => {
        it("two identical GETs return identical bodies", async () => {
            const { client, listId } = await setup();
            await insertStatus(listId, { position: 0 });
            await insertStatus(listId, { position: 1 });

            const a = await client.get(PATH(listId));
            const b = await client.get(PATH(listId));
            expect(a.body).toEqual(b.body);
        });

        it("survives 50 parallel reads of the same list with consistent results", async () => {
            const { client, listId } = await setup();
            for (let i = 0; i < 5; i++) {
                await insertStatus(listId, { name: `S${i}`, position: i });
            }

            const results = await Promise.all(
                Array.from({ length: 50 }, () => client.get(PATH(listId))),
            );

            for (const r of results) {
                expect(r.status).toBe(200);
                expect(r.body).toHaveLength(5);
            }
        });
    });

    // ─── Cross-cutting ────────────────────────────────────────────────────────
    describe("Cross-cutting", () => {
        it("echoes a client X-Request-Id on success", async () => {
            const { client, listId } = await setup();
            const rid = "rid-statuses-success-123";

            const res = await client.get(PATH(listId)).set("X-Request-Id", rid);
            expect(res.get("x-request-id")).toBe(rid);
        });

        it("echoes a client X-Request-Id on a 404", async () => {
            const { client } = await setup();
            const rid = "rid-statuses-404-456";

            const res = await client
                .get(PATH(fakeId("l")))
                .set("X-Request-Id", rid);
            expect(res.status).toBe(404);
            expect(res.get("x-request-id")).toBe(rid);
        });

        it("renders the spec error envelope on a 404", async () => {
            const { client } = await setup();
            const res = await client.get(PATH(fakeId("l")));
            expect(res.body).toEqual({
                error: {
                    code: "list.not_found",
                    message: expect.any(String),
                    request_id: expect.any(String),
                },
            });
        });

        it("renders the spec error envelope on a 401", async () => {
            const { listId } = await setup();
            const http = await oneOff();
            const res = await http.get(PATH(listId));
            expect(res.body.error).toMatchObject({
                code: "auth.missing_token",
                message: expect.any(String),
                request_id: expect.any(String),
            });
        });

        it("returns 404 route.not_found for PUT on the collection path", async () => {
            const { client, listId } = await setup();
            const res = await client.put(PATH(listId));
            expect(res.status).toBe(404);
            expect(res.body.error.code).toBe("route.not_found");
        });

        it("returns 404 route.not_found for DELETE on the collection path", async () => {
            const { client, listId } = await setup();
            const res = await client.delete(PATH(listId));
            expect(res.status).toBe(404);
            expect(res.body.error.code).toBe("route.not_found");
        });
    });

    // ─── Exploratory ──────────────────────────────────────────────────────────
    describe("Exploratory", () => {
        it("ignores arbitrary extra query params", async () => {
            const { client, listId } = await setup();
            await insertStatus(listId);

            const res = await client.get(`${PATH(listId)}?foo=bar&include_archived=true`);
            expect(res.status).toBe(200);
            expect(res.body).toHaveLength(1);
        });

        it("ignores duplicated query params (?x=1&x=2)", async () => {
            const { client, listId } = await setup();
            await insertStatus(listId);

            const res = await client.get(`${PATH(listId)}?x=1&x=2`);
            expect(res.status).toBe(200);
        });

        it("serves the request regardless of an exotic Accept header", async () => {
            const { client, listId } = await setup();
            await insertStatus(listId);

            const res = await client
                .get(PATH(listId))
                .set("Accept", "application/xml, text/plain");
            expect(res.status).toBe(200);
            expect(Array.isArray(res.body)).toBe(true);
        });

        it("matches the route with a trailing slash", async () => {
            const { client, listId } = await setup();
            await insertStatus(listId);

            const res = await client.get(`${PATH(listId)}/`);
            // Express default (non-strict) routing treats the trailing slash as
            // the same route — a 200, not a 404.
            expect(res.status).toBe(200);
        });
    });

    // ─── Security & enum integrity (exploratory hardening) ────────────────────
    describe("Security & enum integrity", () => {
        it("treats a SQL-injection-style listId as a literal id (404, never a 500 or leak)", async () => {
            const { client } = await setup();
            const malicious = encodeURIComponent("' OR '1'='1");

            const res = await client.get(PATH(malicious));
            expect(res.status).toBe(404);
            expect(res.body.error.code).toBe("list.not_found");
        });

        it("round-trips all four status_group values in position order", async () => {
            const { client, listId } = await setup();
            await insertStatus(listId, {
                name: "g0",
                statusGroup: "not_started",
                position: 0,
            });
            await insertStatus(listId, {
                name: "g1",
                statusGroup: "active",
                position: 1,
            });
            await insertStatus(listId, {
                name: "g2",
                statusGroup: "done",
                position: 2,
            });
            await insertStatus(listId, {
                name: "g3",
                statusGroup: "closed",
                position: 3,
            });

            const res = await client.get(PATH(listId));
            expect(
                res.body.map((s: { status_group: string }) => s.status_group),
            ).toEqual(["not_started", "active", "done", "closed"]);
        });
    });
});
