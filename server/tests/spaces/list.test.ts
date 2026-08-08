import jwt from "jsonwebtoken";
import { eq } from "drizzle-orm";
import { oneOff } from "../test-utils/app";
import {
    makeUser,
    makeWorkspace,
    makeSpace,
    makeLoggedInClient,
} from "../test-utils/factories";
import { getDb } from "../../src/db/client";
import {
    spaces,
    taskActivity,
    workspaceActivity,
    users,
} from "../../src/db/schema";
import { Config } from "../../src/config";
import { fakeId } from "../../src/utils";

/**
 * Tests for `GET /api/v1/spaces`.
 *
 * Patterns mirror `tests/auth/*.test.ts`:
 *   - Real DB writes via `tests/test-utils/factories`.
 *   - `makeLoggedInClient(user)` mints real access+refresh cookies (used for
 *     the authenticated happy paths); `oneOff()` + a hand-forged Bearer drives
 *     the negative auth cases.
 *   - `beforeEach` in `tests/test-utils/setup-each.ts` truncates every table.
 *
 * The first iteration pays bcrypt's cold-cache cost (factories hash passwords),
 * so raise jest's default 5s timeout.
 */
jest.setTimeout(30000);

const LIST_SPACES = "/api/v1/spaces";

// The exact wire-`Space` keys per API_DESIGN.md Appendix A.
const SPACE_KEYS = [
    "id",
    "name",
    "description",
    "icon",
    "color",
    "is_private",
    "head_user_id",
    "head",
    "position",
    "archived_at",
    "created_by",
    "created_at",
].sort();

// ─── helpers ─────────────────────────────────────────────────────────────────

const countSpaces = async (workspaceId: string) => {
    const db = getDb();
    const rows = await db
        .select({ id: spaces.id })
        .from(spaces)
        .where(eq(spaces.workspaceId, workspaceId));
    return rows.length;
};

const countTaskActivity = async () => {
    const db = getDb();
    return (await db.select({ id: taskActivity.id }).from(taskActivity)).length;
};

const countWorkspaceActivity = async () => {
    const db = getDb();
    return (
        await db.select({ id: workspaceActivity.id }).from(workspaceActivity)
    ).length;
};

/** Forge an access token for a user with an arbitrary signing secret / opts. */
const signAccess = (
    user: { id: string; workspaceId: string; role: string },
    secret: string,
    opts: jwt.SignOptions = { algorithm: "HS256", expiresIn: "15m" },
) =>
    jwt.sign(
        {
            sub: user.id,
            role: user.role,
            workspaceId: user.workspaceId,
            id: fakeId("ses"),
        },
        secret,
        opts,
    );

// ════════════════════════════════════════════════════════════════════════════
describe("GET /api/v1/spaces", () => {
    // ─── a. Happy path ────────────────────────────────────────────────────────
    describe("Happy path", () => {
        it("returns 200 with a { data, pagination } envelope", async () => {
            const u = await makeUser();
            await makeSpace({ workspaceId: u.workspaceId, createdBy: u.id });
            const client = await makeLoggedInClient(u);

            const res = await client.get(LIST_SPACES);

            expect(res.status).toBe(200);
            expect(Array.isArray(res.body.data)).toBe(true);
            expect(res.body.pagination).toEqual({
                next_cursor: null,
                has_more: false,
                total_estimate: 1,
            });
        });

        it("responds as JSON and carries an X-Request-Id header", async () => {
            const u = await makeUser();
            await makeSpace({ workspaceId: u.workspaceId, createdBy: u.id });
            const client = await makeLoggedInClient(u);

            const res = await client.get(LIST_SPACES);

            expect(res.get("content-type")).toMatch(/application\/json/);
            expect(res.get("X-Request-Id")).toMatch(/^req_/);
        });

        it("returns each space in the exact wire shape (snake_case, no workspace_id/updated_at)", async () => {
            const u = await makeUser();
            await makeSpace({
                workspaceId: u.workspaceId,
                createdBy: u.id,
                name: "Operations",
                description: "Ops team",
                icon: "Boxes",
                color: "#112233",
                isPrivate: false,
                position: 3,
            });
            const client = await makeLoggedInClient(u);

            const res = await client.get(LIST_SPACES);

            const space = res.body.data[0];
            expect(Object.keys(space).sort()).toEqual(SPACE_KEYS);
            expect(space).toMatchObject({
                name: "Operations",
                description: "Ops team",
                icon: "Boxes",
                color: "#112233",
                is_private: false,
                position: 3,
                archived_at: null,
                created_by: u.id,
            });
            expect(space).not.toHaveProperty("workspace_id");
            expect(space).not.toHaveProperty("updated_at");
        });

        it("emits is_private as a real boolean for both true and false", async () => {
            const u = await makeUser();
            await makeSpace({
                workspaceId: u.workspaceId,
                createdBy: u.id,
                name: "Private",
                isPrivate: true,
                position: 0,
            });
            await makeSpace({
                workspaceId: u.workspaceId,
                createdBy: u.id,
                name: "Public",
                isPrivate: false,
                position: 1,
            });
            const client = await makeLoggedInClient(u);

            const res = await client.get(LIST_SPACES);

            const byName = Object.fromEntries(
                res.body.data.map(
                    (s: { name: string; is_private: unknown }) => [
                        s.name,
                        s.is_private,
                    ],
                ),
            );
            expect(byName.Private).toBe(true);
            expect(byName.Public).toBe(false);
        });

        it("emits created_at as an ISO-8601 string and position as a number", async () => {
            const u = await makeUser();
            await makeSpace({
                workspaceId: u.workspaceId,
                createdBy: u.id,
                position: 7,
            });
            const client = await makeLoggedInClient(u);

            const res = await client.get(LIST_SPACES);

            const space = res.body.data[0];
            expect(typeof space.created_at).toBe("string");
            expect(space.created_at).toMatch(
                /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/,
            );
            expect(typeof space.position).toBe("number");
            expect(space.position).toBe(7);
        });

        it("returns an empty page for a workspace with no spaces", async () => {
            const u = await makeUser();
            const client = await makeLoggedInClient(u);

            const res = await client.get(LIST_SPACES);

            expect(res.status).toBe(200);
            expect(res.body.data).toEqual([]);
            expect(res.body.pagination.total_estimate).toBe(0);
            expect(res.body.pagination.has_more).toBe(false);
        });

        it("orders spaces by position ascending", async () => {
            const u = await makeUser();
            await makeSpace({
                workspaceId: u.workspaceId,
                createdBy: u.id,
                name: "third",
                position: 2,
            });
            await makeSpace({
                workspaceId: u.workspaceId,
                createdBy: u.id,
                name: "first",
                position: 0,
            });
            await makeSpace({
                workspaceId: u.workspaceId,
                createdBy: u.id,
                name: "second",
                position: 1,
            });
            const client = await makeLoggedInClient(u);

            const res = await client.get(LIST_SPACES);

            expect(res.body.data.map((s: { name: string }) => s.name)).toEqual([
                "first",
                "second",
                "third",
            ]);
        });

        it("breaks position ties deterministically and stably across calls", async () => {
            const u = await makeUser();
            const a = await makeSpace({
                workspaceId: u.workspaceId,
                createdBy: u.id,
                position: 5,
            });
            const b = await makeSpace({
                workspaceId: u.workspaceId,
                createdBy: u.id,
                position: 5,
            });
            const client = await makeLoggedInClient(u);

            const res1 = await client.get(LIST_SPACES);
            const res2 = await client.get(LIST_SPACES);

            const ids1 = res1.body.data.map((s: { id: string }) => s.id);
            const ids2 = res2.body.data.map((s: { id: string }) => s.id);
            // Both tied spaces are present, and the tie-break is deterministic
            // — identical across calls. The exact direction is `ORDER BY id`
            // under the column's MySQL collation (utf8mb4_unicode_ci), which is
            // NOT the same as a JS UTF-16 `.sort()` when two ids differ in case;
            // the tie-break direction is not part of the wire contract, only its
            // stability is.
            expect(new Set(ids1)).toEqual(new Set([a.id, b.id]));
            expect(ids1).toEqual(ids2);
        });

        it("sets total_estimate to the number of returned spaces", async () => {
            const u = await makeUser();
            for (let i = 0; i < 4; i++) {
                await makeSpace({
                    workspaceId: u.workspaceId,
                    createdBy: u.id,
                    position: i,
                });
            }
            const client = await makeLoggedInClient(u);

            const res = await client.get(LIST_SPACES);

            expect(res.body.data).toHaveLength(4);
            expect(res.body.pagination.total_estimate).toBe(4);
        });
    });

    // ─── b. Validation ────────────────────────────────────────────────────────
    describe("Validation (include_archived)", () => {
        it("includes archived spaces with ?include_archived=true", async () => {
            const u = await makeUser();
            await makeSpace({
                workspaceId: u.workspaceId,
                createdBy: u.id,
                name: "active",
                position: 0,
            });
            await makeSpace({
                workspaceId: u.workspaceId,
                createdBy: u.id,
                name: "archived",
                position: 1,
                archivedAt: new Date(),
            });
            const client = await makeLoggedInClient(u);

            const res = await client
                .get(LIST_SPACES)
                .query({ include_archived: "true" });

            expect(res.status).toBe(200);
            expect(res.body.data.map((s: { name: string }) => s.name)).toEqual([
                "active",
                "archived",
            ]);
        });

        it("excludes archived spaces with ?include_archived=false", async () => {
            const u = await makeUser();
            await makeSpace({
                workspaceId: u.workspaceId,
                createdBy: u.id,
                name: "active",
            });
            await makeSpace({
                workspaceId: u.workspaceId,
                createdBy: u.id,
                name: "archived",
                archivedAt: new Date(),
            });
            const client = await makeLoggedInClient(u);

            const res = await client
                .get(LIST_SPACES)
                .query({ include_archived: "false" });

            expect(res.status).toBe(200);
            expect(res.body.data).toHaveLength(1);
            expect(res.body.data[0].name).toBe("active");
        });

        it("excludes archived spaces by default (param absent)", async () => {
            const u = await makeUser();
            await makeSpace({
                workspaceId: u.workspaceId,
                createdBy: u.id,
                name: "active",
            });
            await makeSpace({
                workspaceId: u.workspaceId,
                createdBy: u.id,
                name: "archived",
                archivedAt: new Date(),
            });
            const client = await makeLoggedInClient(u);

            const res = await client.get(LIST_SPACES);

            expect(res.body.data).toHaveLength(1);
            expect(res.body.data[0].name).toBe("active");
        });

        it("returns 422 for a non-boolean include_archived", async () => {
            const u = await makeUser();
            const client = await makeLoggedInClient(u);

            const res = await client
                .get(LIST_SPACES)
                .query({ include_archived: "notabool" });

            expect(res.status).toBe(422);
            expect(res.body.error.code).toBe("validation.failed");
            const fields = (
                res.body.error.details as Array<{ field: string }>
            ).map((d) => d.field);
            expect(fields).toContain("include_archived");
        });

        it("returns 422 for an empty include_archived value", async () => {
            const u = await makeUser();
            const client = await makeLoggedInClient(u);

            const res = await client
                .get(LIST_SPACES)
                .query("include_archived=");

            expect(res.status).toBe(422);
            expect(res.body.error.code).toBe("validation.failed");
        });

        it("returns 422 for include_archived=1 (only true/false accepted)", async () => {
            const u = await makeUser();
            const client = await makeLoggedInClient(u);

            const res = await client
                .get(LIST_SPACES)
                .query({ include_archived: "1" });

            expect(res.status).toBe(422);
            expect(res.body.error.code).toBe("validation.failed");
        });

        it("treats a repeated include_archived param as the safe default (excludes archived)", async () => {
            // A repeated query param arrives as an array. express-validator
            // validates each value independently — "true" and "false" are both
            // individually valid, so there is no 422 — and the controller's
            // strict `=== "true"` check treats the array as "not true", i.e. the
            // safe default of excluding archived spaces. This shares the §6 lists
            // `include_archived` idiom.
            const u = await makeUser();
            await makeSpace({
                workspaceId: u.workspaceId,
                createdBy: u.id,
                name: "active",
            });
            await makeSpace({
                workspaceId: u.workspaceId,
                createdBy: u.id,
                name: "archived",
                archivedAt: new Date(),
            });
            const client = await makeLoggedInClient(u);

            const res = await client
                .get(LIST_SPACES)
                .query("include_archived=true&include_archived=false");

            expect(res.status).toBe(200);
            expect(res.body.data).toHaveLength(1);
            expect(res.body.data[0].name).toBe("active");
        });

        it("accepts ?include_archived=TRUE (case-insensitive) and includes archived", async () => {
            const u = await makeUser();
            await makeSpace({
                workspaceId: u.workspaceId,
                createdBy: u.id,
                name: "active",
            });
            await makeSpace({
                workspaceId: u.workspaceId,
                createdBy: u.id,
                name: "archived",
                archivedAt: new Date(),
            });
            const client = await makeLoggedInClient(u);

            const res = await client
                .get(LIST_SPACES)
                .query({ include_archived: "TRUE" });

            expect(res.status).toBe(200);
            expect(res.body.data).toHaveLength(2);
        });
    });

    // ─── c. Authentication ────────────────────────────────────────────────────
    describe("Authentication", () => {
        it("returns 401 auth.missing_token without a token", async () => {
            const http = await oneOff();
            const res = await http.get(LIST_SPACES);

            expect(res.status).toBe(401);
            expect(res.body.error.code).toBe("auth.missing_token");
        });

        it("returns 401 auth.invalid_token for a non-JWT Bearer", async () => {
            const http = await oneOff();
            const res = await http
                .get(LIST_SPACES)
                .set("Authorization", "Bearer not-a-jwt");

            expect(res.status).toBe(401);
            expect(res.body.error.code).toBe("auth.invalid_token");
        });

        it("returns 401 auth.invalid_token for a wrong-secret JWT", async () => {
            const u = await makeUser();
            const forged = signAccess(u, "wrong-secret");
            const http = await oneOff();

            const res = await http
                .get(LIST_SPACES)
                .set("Authorization", `Bearer ${forged}`);

            expect(res.status).toBe(401);
            expect(res.body.error.code).toBe("auth.invalid_token");
        });

        it("returns 401 for a JWT signed with REFRESH_TOKEN_SECRET", async () => {
            const u = await makeUser();
            const forged = signAccess(u, Config.REFRESH_TOKEN_SECRET!);
            const http = await oneOff();

            const res = await http
                .get(LIST_SPACES)
                .set("Authorization", `Bearer ${forged}`);

            expect(res.status).toBe(401);
            expect(res.body.error.code).toBe("auth.invalid_token");
        });

        it("returns 401 for a JWT using alg:none", async () => {
            const u = await makeUser();
            const header = Buffer.from(
                JSON.stringify({ alg: "none", typ: "JWT" }),
            ).toString("base64url");
            const payload = Buffer.from(
                JSON.stringify({
                    sub: u.id,
                    role: u.role,
                    workspaceId: u.workspaceId,
                    id: fakeId("ses"),
                    exp: Math.floor(Date.now() / 1000) + 900,
                }),
            ).toString("base64url");
            const noneToken = `${header}.${payload}.`;
            const http = await oneOff();

            const res = await http
                .get(LIST_SPACES)
                .set("Authorization", `Bearer ${noneToken}`);

            expect(res.status).toBe(401);
            expect(res.body.error.code).toBe("auth.invalid_token");
        });

        it("returns 401 auth.expired_token for an expired access token", async () => {
            const u = await makeUser();
            const expired = signAccess(u, Config.ACCESS_TOKEN_SECRET!, {
                algorithm: "HS256",
                expiresIn: -10,
            });
            const http = await oneOff();

            const res = await http
                .get(LIST_SPACES)
                .set("Authorization", `Bearer ${expired}`);

            expect(res.status).toBe(401);
            expect(res.body.error.code).toBe("auth.expired_token");
        });

        it("still returns 200 for a user deactivated after the token was issued", async () => {
            // Reads do not re-check user status: a valid 15-min access token is
            // honoured until natural expiry (the stateless-JWT model the whole
            // codebase uses — cf. logout's deactivated-after-login behaviour).
            const u = await makeUser();
            await makeSpace({ workspaceId: u.workspaceId, createdBy: u.id });
            const client = await makeLoggedInClient(u);

            const db = getDb();
            await db
                .update(users)
                .set({ status: "deactivated" })
                .where(eq(users.id, u.id));

            const res = await client.get(LIST_SPACES);
            expect(res.status).toBe(200);
            expect(res.body.data).toHaveLength(1);
        });
    });

    // ─── d. Authorization ─────────────────────────────────────────────────────
    describe("Authorization (read is ungated for every role)", () => {
        for (const role of ["owner", "admin", "member", "guest"] as const) {
            it(`allows a ${role} to list spaces (200)`, async () => {
                const u = await makeUser({ role });
                await makeSpace({
                    workspaceId: u.workspaceId,
                    createdBy: u.id,
                });
                const client = await makeLoggedInClient(u);

                const res = await client.get(LIST_SPACES);

                expect(res.status).toBe(200);
                expect(res.body.data).toHaveLength(1);
            });
        }
    });

    // ─── e. Resource lifecycle (archive) ──────────────────────────────────────
    describe("Archive lifecycle", () => {
        it("hides an archived space from the default listing", async () => {
            const u = await makeUser();
            await makeSpace({
                workspaceId: u.workspaceId,
                createdBy: u.id,
                archivedAt: new Date(),
            });
            const client = await makeLoggedInClient(u);

            const res = await client.get(LIST_SPACES);
            expect(res.body.data).toEqual([]);
        });

        it("surfaces archived_at as an ISO string when included", async () => {
            const u = await makeUser();
            await makeSpace({
                workspaceId: u.workspaceId,
                createdBy: u.id,
                archivedAt: new Date("2026-01-02T03:04:05.000Z"),
            });
            const client = await makeLoggedInClient(u);

            const res = await client
                .get(LIST_SPACES)
                .query({ include_archived: "true" });
            expect(res.body.data[0].archived_at).toMatch(
                /^2026-01-02T03:04:05/,
            );
        });

        it("orders by position regardless of archived state when included", async () => {
            const u = await makeUser();
            await makeSpace({
                workspaceId: u.workspaceId,
                createdBy: u.id,
                name: "p0-archived",
                position: 0,
                archivedAt: new Date(),
            });
            await makeSpace({
                workspaceId: u.workspaceId,
                createdBy: u.id,
                name: "p1-active",
                position: 1,
            });
            await makeSpace({
                workspaceId: u.workspaceId,
                createdBy: u.id,
                name: "p2-archived",
                position: 2,
                archivedAt: new Date(),
            });
            const client = await makeLoggedInClient(u);

            const res = await client
                .get(LIST_SPACES)
                .query({ include_archived: "true" });
            expect(res.body.data.map((s: { name: string }) => s.name)).toEqual([
                "p0-archived",
                "p1-active",
                "p2-archived",
            ]);
        });
    });

    // ─── g. Tenant isolation ──────────────────────────────────────────────────
    describe("Tenant isolation", () => {
        it("returns only the caller's workspace spaces, never another workspace's", async () => {
            const ua = await makeUser();
            const ub = await makeUser();
            await makeSpace({
                workspaceId: ua.workspaceId,
                createdBy: ua.id,
                name: "A-Space",
            });
            await makeSpace({
                workspaceId: ub.workspaceId,
                createdBy: ub.id,
                name: "B-Space",
            });

            const clientB = await makeLoggedInClient(ub);
            const res = await clientB.get(LIST_SPACES);

            expect(res.body.data).toHaveLength(1);
            expect(res.body.data[0].name).toBe("B-Space");
        });

        it("is symmetric — workspace A's user sees only A's spaces", async () => {
            const ua = await makeUser();
            const ub = await makeUser();
            await makeSpace({
                workspaceId: ua.workspaceId,
                createdBy: ua.id,
                name: "A-Space",
            });
            await makeSpace({
                workspaceId: ub.workspaceId,
                createdBy: ub.id,
                name: "B-Space",
            });

            const clientA = await makeLoggedInClient(ua);
            const res = await clientA.get(LIST_SPACES);

            expect(res.body.data).toHaveLength(1);
            expect(res.body.data[0].name).toBe("A-Space");
        });

        it("does not leak a same-name/same-position space from another workspace", async () => {
            const ua = await makeUser();
            const ub = await makeUser();
            await makeSpace({
                workspaceId: ua.workspaceId,
                createdBy: ua.id,
                name: "Shared",
                position: 0,
            });
            await makeSpace({
                workspaceId: ub.workspaceId,
                createdBy: ub.id,
                name: "Shared",
                position: 0,
            });

            const clientB = await makeLoggedInClient(ub);
            const res = await clientB.get(LIST_SPACES);

            expect(res.body.data).toHaveLength(1);
            expect(res.body.data[0].created_by).toBe(ub.id);
        });

        it("returns an empty page when the caller's workspace is empty but another is populated", async () => {
            const populated = await makeUser();
            await makeSpace({
                workspaceId: populated.workspaceId,
                createdBy: populated.id,
            });
            await makeSpace({
                workspaceId: populated.workspaceId,
                createdBy: populated.id,
            });

            const empty = await makeUser();
            const client = await makeLoggedInClient(empty);
            const res = await client.get(LIST_SPACES);

            expect(res.body.data).toEqual([]);
            expect(res.body.pagination.total_estimate).toBe(0);
        });
    });

    // ─── h. Idempotency (read is naturally idempotent) ────────────────────────
    describe("Idempotent read", () => {
        it("returns identical bodies for two identical requests", async () => {
            const u = await makeUser();
            await makeSpace({
                workspaceId: u.workspaceId,
                createdBy: u.id,
                position: 0,
            });
            await makeSpace({
                workspaceId: u.workspaceId,
                createdBy: u.id,
                position: 1,
            });
            const client = await makeLoggedInClient(u);

            const r1 = await client.get(LIST_SPACES);
            const r2 = await client.get(LIST_SPACES);

            expect(r1.body).toEqual(r2.body);
        });
    });

    // ─── i. Concurrency ───────────────────────────────────────────────────────
    describe("Concurrency", () => {
        it("handles 50 parallel reads with a consistent payload", async () => {
            const u = await makeUser();
            for (let i = 0; i < 5; i++) {
                await makeSpace({
                    workspaceId: u.workspaceId,
                    createdBy: u.id,
                    position: i,
                });
            }
            const client = await makeLoggedInClient(u);

            const results = await Promise.all(
                Array.from({ length: 50 }, () => client.get(LIST_SPACES)),
            );

            for (const r of results) {
                expect(r.status).toBe(200);
                expect(r.body.data).toHaveLength(5);
            }
        });

        it("reflects a newly-inserted space on the next read (no staleness)", async () => {
            const u = await makeUser();
            const client = await makeLoggedInClient(u);

            const before = await client.get(LIST_SPACES);
            expect(before.body.data).toHaveLength(0);

            await makeSpace({ workspaceId: u.workspaceId, createdBy: u.id });

            const after = await client.get(LIST_SPACES);
            expect(after.body.data).toHaveLength(1);
        });
    });

    // ─── j. Pagination (bounded single page) ──────────────────────────────────
    describe("Pagination", () => {
        it("pages a large set at the §1 default limit (F23/ISS-007)", async () => {
            const u = await makeUser();
            // Reuse one creator to avoid 150 bcrypt-bearing user inserts.
            for (let i = 0; i < 150; i++) {
                await makeSpace({
                    workspaceId: u.workspaceId,
                    createdBy: u.id,
                    position: i,
                });
            }
            const client = await makeLoggedInClient(u);

            const res = await client.get(LIST_SPACES);

            // Pre-F23 this asserted all 150 rows in one page with
            // has_more:false — the very lie ISS-007 records. The §1 default
            // limit is 100, the envelope is truthful, and the cursor works.
            expect(res.body.data).toHaveLength(100);
            expect(res.body.pagination.has_more).toBe(true);
            const page2 = await client
                .get(LIST_SPACES)
                .query({ cursor: res.body.pagination.next_cursor });
            expect(page2.status).toBe(200);
            expect(page2.body.data).toHaveLength(50);
            expect(page2.body.pagination.has_more).toBe(false);
            expect(page2.body.pagination.next_cursor).toBeNull();
            expect(res.body.pagination.total_estimate).toBe(150);
        });

        it("refuses a cursor the server did not issue (F23/ISS-008)", async () => {
            const u = await makeUser();
            await makeSpace({ workspaceId: u.workspaceId, createdBy: u.id });
            const client = await makeLoggedInClient(u);

            const res = await client
                .get(LIST_SPACES)
                .query({ cursor: "eyJpZCI6OTk5fQ" });

            expect(res.status).toBe(400);
            expect(res.body.error.code).toBe("pagination.invalid_cursor");
        });
    });

    // ─── k. Boundary values ───────────────────────────────────────────────────
    describe("Boundary values", () => {
        it("preserves a unicode name (Bangla + emoji) byte-for-byte", async () => {
            const u = await makeUser();
            const name = "অর্ডার 📦 ক্ষ";
            await makeSpace({
                workspaceId: u.workspaceId,
                createdBy: u.id,
                name,
            });
            const client = await makeLoggedInClient(u);

            const res = await client.get(LIST_SPACES);
            expect(res.body.data[0].name).toBe(name);
        });

        it("preserves a 120-character (max-length) name", async () => {
            const u = await makeUser();
            const name = "x".repeat(120);
            await makeSpace({
                workspaceId: u.workspaceId,
                createdBy: u.id,
                name,
            });
            const client = await makeLoggedInClient(u);

            const res = await client.get(LIST_SPACES);
            expect(res.body.data[0].name).toBe(name);
        });

        it("emits a null description as null and preserves a 500-char description", async () => {
            const u = await makeUser();
            await makeSpace({
                workspaceId: u.workspaceId,
                createdBy: u.id,
                name: "nulldesc",
                description: null,
                position: 0,
            });
            const long = "d".repeat(500);
            await makeSpace({
                workspaceId: u.workspaceId,
                createdBy: u.id,
                name: "longdesc",
                description: long,
                position: 1,
            });
            const client = await makeLoggedInClient(u);

            const res = await client.get(LIST_SPACES);
            const byName = Object.fromEntries(
                res.body.data.map(
                    (s: { name: string; description: string | null }) => [
                        s.name,
                        s.description,
                    ],
                ),
            );
            expect(byName.nulldesc).toBeNull();
            expect(byName.longdesc).toBe(long);
        });

        it("handles position 0 and a large position with correct ordering", async () => {
            const u = await makeUser();
            await makeSpace({
                workspaceId: u.workspaceId,
                createdBy: u.id,
                name: "big",
                position: 2147483647,
            });
            await makeSpace({
                workspaceId: u.workspaceId,
                createdBy: u.id,
                name: "zero",
                position: 0,
            });
            const client = await makeLoggedInClient(u);

            const res = await client.get(LIST_SPACES);
            expect(res.body.data.map((s: { name: string }) => s.name)).toEqual([
                "zero",
                "big",
            ]);
            expect(res.body.data[1].position).toBe(2147483647);
        });

        it("applies the schema icon/color defaults when not set", async () => {
            const u = await makeUser();
            await makeSpace({ workspaceId: u.workspaceId, createdBy: u.id }); // omit icon/color
            const client = await makeLoggedInClient(u);

            const res = await client.get(LIST_SPACES);
            expect(res.body.data[0].icon).toBe("Folder");
            expect(res.body.data[0].color).toBe("#4F46E5");
        });
    });

    // ─── l. Side effects ──────────────────────────────────────────────────────
    describe("Side effects (read-only)", () => {
        it("writes no workspace_activity rows", async () => {
            const u = await makeUser();
            await makeSpace({ workspaceId: u.workspaceId, createdBy: u.id });
            const client = await makeLoggedInClient(u);

            const before = await countWorkspaceActivity();
            await client.get(LIST_SPACES);
            expect(await countWorkspaceActivity()).toBe(before);
        });

        it("writes no task_activity rows", async () => {
            const u = await makeUser();
            await makeSpace({ workspaceId: u.workspaceId, createdBy: u.id });
            const client = await makeLoggedInClient(u);

            const before = await countTaskActivity();
            await client.get(LIST_SPACES);
            expect(await countTaskActivity()).toBe(before);
        });

        it("does not change the spaces row count", async () => {
            const u = await makeUser();
            await makeSpace({ workspaceId: u.workspaceId, createdBy: u.id });
            const client = await makeLoggedInClient(u);

            const before = await countSpaces(u.workspaceId);
            await client.get(LIST_SPACES);
            expect(await countSpaces(u.workspaceId)).toBe(before);
        });
    });

    // ─── Cross-cutting: Request-Id + error envelope ───────────────────────────
    describe("Request-Id", () => {
        it("generates a fresh X-Request-Id when none is supplied", async () => {
            const u = await makeUser();
            const client = await makeLoggedInClient(u);
            const res = await client.get(LIST_SPACES);
            expect(res.get("X-Request-Id")).toMatch(/^req_/);
        });

        it("echoes a client-supplied X-Request-Id verbatim", async () => {
            const u = await makeUser();
            const client = await makeLoggedInClient(u);
            const supplied = "trace-spaces-list-001";
            const res = await client
                .get(LIST_SPACES)
                .set("X-Request-Id", supplied);
            expect(res.get("X-Request-Id")).toBe(supplied);
        });
    });

    describe("Error envelope", () => {
        it("renders {error:{code,message,request_id}} on the 401 path", async () => {
            const http = await oneOff();
            const res = await http.get(LIST_SPACES);
            expect(res.body).toEqual({
                error: {
                    code: "auth.missing_token",
                    message: expect.any(String),
                    request_id: expect.any(String),
                },
            });
        });

        it("renders details[] on the 422 path", async () => {
            const u = await makeUser();
            const client = await makeLoggedInClient(u);
            const res = await client
                .get(LIST_SPACES)
                .query({ include_archived: "nope" });
            expect(res.status).toBe(422);
            expect(res.body.error.code).toBe("validation.failed");
            expect(Array.isArray(res.body.error.details)).toBe(true);
            expect(res.body.error.request_id).toMatch(/^req_/);
        });
    });

    // ─── Exploratory: surprising inputs / surface-area probes ─────────────────
    describe("Exploratory", () => {
        it("returns 422 for include_archived with a trailing space (no trim)", async () => {
            const u = await makeUser();
            const client = await makeLoggedInClient(u);
            // Pre-encode the trailing space as %20 so it survives query
            // serialization and reaches the server intact; the validator does
            // not trim, so "true " is neither "true" nor "false" → 422 (this
            // matches the §6 lists `include_archived` idiom).
            const res = await client
                .get(LIST_SPACES)
                .query("include_archived=true%20");
            expect(res.status).toBe(422);
        });

        it("accepts mixed-case include_archived=True", async () => {
            const u = await makeUser();
            await makeSpace({
                workspaceId: u.workspaceId,
                createdBy: u.id,
                archivedAt: new Date(),
            });
            const client = await makeLoggedInClient(u);
            const res = await client
                .get(LIST_SPACES)
                .query({ include_archived: "True" });
            expect(res.status).toBe(200);
            expect(res.body.data).toHaveLength(1);
        });

        it("refuses unknown query params, naming them (F23/ISS-014)", async () => {
            const u = await makeUser();
            await makeSpace({ workspaceId: u.workspaceId, createdBy: u.id });
            const client = await makeLoggedInClient(u);
            const res = await client
                .get(LIST_SPACES)
                .query({ foo: "bar", limit: "5", page: "9" });
            // A mistyped filter used to silently return the full set.
            expect(res.status).toBe(422);
            expect(JSON.stringify(res.body)).toContain("foo");
            expect(JSON.stringify(res.body)).toContain("page");
        });

        it("ignores a JSON body on the GET", async () => {
            const u = await makeUser();
            await makeSpace({ workspaceId: u.workspaceId, createdBy: u.id });
            const client = await makeLoggedInClient(u);
            const res = await client
                .get(LIST_SPACES)
                .send({ workspace_id: "ws-attacker", malicious: true });
            expect(res.status).toBe(200);
            expect(res.body.data).toHaveLength(1);
        });

        it("returns 401 (never 500) for an absurdly long garbage Bearer", async () => {
            const http = await oneOff();
            const huge = "x".repeat(8000);
            const res = await http
                .get(LIST_SPACES)
                .set("Authorization", `Bearer ${huge}`);
            expect(res.status).toBe(401);
            expect(res.body.error.code).toBe("auth.invalid_token");
        });

        it("returns 401 for a non-Bearer Authorization scheme", async () => {
            const u = await makeUser();
            const token = signAccess(u, Config.ACCESS_TOKEN_SECRET!);
            const http = await oneOff();
            const res = await http
                .get(LIST_SPACES)
                .set("Authorization", `Basic ${token}`);
            expect(res.status).toBe(401);
            expect(["auth.missing_token", "auth.invalid_token"]).toContain(
                res.body.error.code,
            );
        });
    });
});
