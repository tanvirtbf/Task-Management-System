import jwt from "jsonwebtoken";
import { eq } from "drizzle-orm";
import { oneOff } from "../test-utils/app";
import {
    makeUser,
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
 * Tests for `GET /api/v1/spaces/:id`.
 *
 * Patterns mirror `tests/spaces/list.test.ts`:
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

const spacePath = (id: string) => `/api/v1/spaces/${id}`;

// The exact wire-`Space` keys per API_DESIGN.md Appendix A.
const SPACE_KEYS = [
    "id",
    "name",
    "description",
    "icon",
    "color",
    "is_private",
    "position",
    "archived_at",
    "created_by",
    "created_at",
].sort();

// ─── helpers ─────────────────────────────────────────────────────────────────

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
describe("GET /api/v1/spaces/:id", () => {
    // ─── a. Happy path ────────────────────────────────────────────────────────
    describe("Happy path", () => {
        it("returns 200 with the bare wire Space (no list envelope)", async () => {
            const u = await makeUser();
            const s = await makeSpace({
                workspaceId: u.workspaceId,
                createdBy: u.id,
            });
            const client = await makeLoggedInClient(u);

            const res = await client.get(spacePath(s.id));

            expect(res.status).toBe(200);
            expect(res.body.id).toBe(s.id);
            expect(res.body).not.toHaveProperty("data");
            expect(res.body).not.toHaveProperty("pagination");
        });

        it("returns the space in the exact wire shape (snake_case, no workspace_id/updated_at)", async () => {
            const u = await makeUser();
            const s = await makeSpace({
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

            const res = await client.get(spacePath(s.id));

            expect(Object.keys(res.body).sort()).toEqual(SPACE_KEYS);
            expect(res.body).toMatchObject({
                id: s.id,
                name: "Operations",
                description: "Ops team",
                icon: "Boxes",
                color: "#112233",
                is_private: false,
                position: 3,
                archived_at: null,
                created_by: u.id,
            });
            expect(res.body).not.toHaveProperty("workspace_id");
            expect(res.body).not.toHaveProperty("updated_at");
        });

        it("emits is_private as a real boolean and position as a number", async () => {
            const u = await makeUser();
            const s = await makeSpace({
                workspaceId: u.workspaceId,
                createdBy: u.id,
                isPrivate: true,
                position: 7,
            });
            const client = await makeLoggedInClient(u);

            const res = await client.get(spacePath(s.id));

            expect(res.body.is_private).toBe(true);
            expect(typeof res.body.position).toBe("number");
            expect(res.body.position).toBe(7);
        });

        it("emits created_at as an ISO-8601 string", async () => {
            const u = await makeUser();
            const s = await makeSpace({
                workspaceId: u.workspaceId,
                createdBy: u.id,
            });
            const client = await makeLoggedInClient(u);

            const res = await client.get(spacePath(s.id));

            expect(typeof res.body.created_at).toBe("string");
            expect(res.body.created_at).toMatch(
                /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/,
            );
        });

        it("applies the schema icon/color defaults when not set", async () => {
            const u = await makeUser();
            const s = await makeSpace({
                workspaceId: u.workspaceId,
                createdBy: u.id,
            }); // omit icon/color
            const client = await makeLoggedInClient(u);

            const res = await client.get(spacePath(s.id));

            expect(res.body.icon).toBe("Folder");
            expect(res.body.color).toBe("#4F46E5");
        });

        it("responds as JSON and carries an X-Request-Id header", async () => {
            const u = await makeUser();
            const s = await makeSpace({
                workspaceId: u.workspaceId,
                createdBy: u.id,
            });
            const client = await makeLoggedInClient(u);

            const res = await client.get(spacePath(s.id));

            expect(res.get("content-type")).toMatch(/application\/json/);
            expect(res.get("X-Request-Id")).toMatch(/^req_/);
        });
    });

    // ─── b. Validation ────────────────────────────────────────────────────────
    describe("Validation (:id)", () => {
        it("returns 422 for an id longer than 64 chars", async () => {
            const u = await makeUser();
            const client = await makeLoggedInClient(u);

            const res = await client.get(spacePath("x".repeat(65)));

            expect(res.status).toBe(422);
            expect(res.body.error.code).toBe("validation.failed");
            const fields = (
                res.body.error.details as Array<{ field: string }>
            ).map((d) => d.field);
            expect(fields).toContain("id");
        });

        it("accepts a 64-char (max-length) id and resolves it (404 when absent)", async () => {
            const u = await makeUser();
            const client = await makeLoggedInClient(u);

            const res = await client.get(spacePath("x".repeat(64)));

            expect(res.status).toBe(404);
            expect(res.body.error.code).toBe("space.not_found");
        });
    });

    // ─── c. Authentication ────────────────────────────────────────────────────
    describe("Authentication", () => {
        it("returns 401 auth.missing_token without a token", async () => {
            const u = await makeUser();
            const s = await makeSpace({
                workspaceId: u.workspaceId,
                createdBy: u.id,
            });
            const http = await oneOff();

            const res = await http.get(spacePath(s.id));

            expect(res.status).toBe(401);
            expect(res.body.error.code).toBe("auth.missing_token");
        });

        it("returns 401 auth.invalid_token for a non-JWT Bearer", async () => {
            const http = await oneOff();
            const res = await http
                .get(spacePath("sp-anything"))
                .set("Authorization", "Bearer not-a-jwt");

            expect(res.status).toBe(401);
            expect(res.body.error.code).toBe("auth.invalid_token");
        });

        it("returns 401 auth.invalid_token for a wrong-secret JWT", async () => {
            const u = await makeUser();
            const forged = signAccess(u, "wrong-secret");
            const http = await oneOff();

            const res = await http
                .get(spacePath("sp-anything"))
                .set("Authorization", `Bearer ${forged}`);

            expect(res.status).toBe(401);
            expect(res.body.error.code).toBe("auth.invalid_token");
        });

        it("returns 401 for a JWT signed with REFRESH_TOKEN_SECRET", async () => {
            const u = await makeUser();
            const forged = signAccess(u, Config.REFRESH_TOKEN_SECRET!);
            const http = await oneOff();

            const res = await http
                .get(spacePath("sp-anything"))
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
                .get(spacePath("sp-anything"))
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
                .get(spacePath("sp-anything"))
                .set("Authorization", `Bearer ${expired}`);

            expect(res.status).toBe(401);
            expect(res.body.error.code).toBe("auth.expired_token");
        });

        it("returns 401 for a non-Bearer Authorization scheme", async () => {
            const u = await makeUser();
            const token = signAccess(u, Config.ACCESS_TOKEN_SECRET!);
            const http = await oneOff();

            const res = await http
                .get(spacePath("sp-anything"))
                .set("Authorization", `Basic ${token}`);

            expect(res.status).toBe(401);
            expect(["auth.missing_token", "auth.invalid_token"]).toContain(
                res.body.error.code,
            );
        });

        it("still returns 200 for a user deactivated after the token was issued", async () => {
            // Reads do not re-check user status: a valid 15-min access token is
            // honoured until natural expiry (the stateless-JWT model the whole
            // codebase uses — cf. the list endpoint's deactivated-after-login
            // behaviour).
            const u = await makeUser();
            const s = await makeSpace({
                workspaceId: u.workspaceId,
                createdBy: u.id,
            });
            const client = await makeLoggedInClient(u);

            const db = getDb();
            await db
                .update(users)
                .set({ status: "deactivated" })
                .where(eq(users.id, u.id));

            const res = await client.get(spacePath(s.id));
            expect(res.status).toBe(200);
            expect(res.body.id).toBe(s.id);
        });
    });

    // ─── d. Authorization ─────────────────────────────────────────────────────
    describe("Authorization (read is ungated for every role)", () => {
        for (const role of ["owner", "admin", "member", "guest"] as const) {
            it(`allows a ${role} to read a space (200)`, async () => {
                const u = await makeUser({ role });
                const s = await makeSpace({
                    workspaceId: u.workspaceId,
                    createdBy: u.id,
                });
                const client = await makeLoggedInClient(u);

                const res = await client.get(spacePath(s.id));

                expect(res.status).toBe(200);
                expect(res.body.id).toBe(s.id);
            });
        }
    });

    // ─── e. Not-found / archived ──────────────────────────────────────────────
    describe("Not-found and archived", () => {
        it("returns 404 space.not_found for a well-formed but absent id", async () => {
            const u = await makeUser();
            const client = await makeLoggedInClient(u);

            const res = await client.get(spacePath(fakeId("sp")));

            expect(res.status).toBe(404);
            expect(res.body.error.code).toBe("space.not_found");
        });

        it("returns 200 for an archived space with archived_at set (archived != deleted)", async () => {
            const u = await makeUser();
            const s = await makeSpace({
                workspaceId: u.workspaceId,
                createdBy: u.id,
                archivedAt: new Date("2026-01-02T03:04:05.000Z"),
            });
            const client = await makeLoggedInClient(u);

            const res = await client.get(spacePath(s.id));

            expect(res.status).toBe(200);
            expect(res.body.id).toBe(s.id);
            expect(res.body.archived_at).toMatch(/^2026-01-02T03:04:05/);
        });
    });

    // ─── f. Tenant isolation ──────────────────────────────────────────────────
    describe("Tenant isolation", () => {
        it("returns 404 (not 403) when reading another workspace's space", async () => {
            const ua = await makeUser();
            const ub = await makeUser();
            const aSpace = await makeSpace({
                workspaceId: ua.workspaceId,
                createdBy: ua.id,
                name: "A-Space",
            });

            const clientB = await makeLoggedInClient(ub);
            const res = await clientB.get(spacePath(aSpace.id));

            expect(res.status).toBe(404);
            expect(res.body.error.code).toBe("space.not_found");
        });

        it("each workspace's user can read only their own same-named space", async () => {
            const ua = await makeUser();
            const ub = await makeUser();
            const aSpace = await makeSpace({
                workspaceId: ua.workspaceId,
                createdBy: ua.id,
                name: "Shared",
                position: 0,
            });
            const bSpace = await makeSpace({
                workspaceId: ub.workspaceId,
                createdBy: ub.id,
                name: "Shared",
                position: 0,
            });

            const clientA = await makeLoggedInClient(ua);
            const resOwn = await clientA.get(spacePath(aSpace.id));
            const resOther = await clientA.get(spacePath(bSpace.id));

            expect(resOwn.status).toBe(200);
            expect(resOwn.body.created_by).toBe(ua.id);
            expect(resOther.status).toBe(404);
        });
    });

    // ─── g. Idempotency / concurrency ─────────────────────────────────────────
    describe("Idempotent read", () => {
        it("returns identical bodies for two identical requests", async () => {
            const u = await makeUser();
            const s = await makeSpace({
                workspaceId: u.workspaceId,
                createdBy: u.id,
            });
            const client = await makeLoggedInClient(u);

            const r1 = await client.get(spacePath(s.id));
            const r2 = await client.get(spacePath(s.id));

            expect(r1.body).toEqual(r2.body);
        });
    });

    describe("Concurrency", () => {
        it("handles 50 parallel reads with a consistent payload", async () => {
            const u = await makeUser();
            const s = await makeSpace({
                workspaceId: u.workspaceId,
                createdBy: u.id,
            });
            const client = await makeLoggedInClient(u);

            const results = await Promise.all(
                Array.from({ length: 50 }, () => client.get(spacePath(s.id))),
            );

            for (const r of results) {
                expect(r.status).toBe(200);
                expect(r.body.id).toBe(s.id);
            }
        });
    });

    // ─── h. Boundary values ───────────────────────────────────────────────────
    describe("Boundary values", () => {
        it("preserves a unicode name (Bangla + emoji) byte-for-byte", async () => {
            const u = await makeUser();
            const name = "অর্ডার 📦 ক্ষ";
            const s = await makeSpace({
                workspaceId: u.workspaceId,
                createdBy: u.id,
                name,
            });
            const client = await makeLoggedInClient(u);

            const res = await client.get(spacePath(s.id));
            expect(res.body.name).toBe(name);
        });

        it("preserves a 120-character (max-length) name", async () => {
            const u = await makeUser();
            const name = "x".repeat(120);
            const s = await makeSpace({
                workspaceId: u.workspaceId,
                createdBy: u.id,
                name,
            });
            const client = await makeLoggedInClient(u);

            const res = await client.get(spacePath(s.id));
            expect(res.body.name).toBe(name);
        });

        it("emits a null description as null", async () => {
            const u = await makeUser();
            const s = await makeSpace({
                workspaceId: u.workspaceId,
                createdBy: u.id,
                description: null,
            });
            const client = await makeLoggedInClient(u);

            const res = await client.get(spacePath(s.id));
            expect(res.body.description).toBeNull();
        });

        it("preserves a 500-character description", async () => {
            const u = await makeUser();
            const long = "d".repeat(500);
            const s = await makeSpace({
                workspaceId: u.workspaceId,
                createdBy: u.id,
                description: long,
            });
            const client = await makeLoggedInClient(u);

            const res = await client.get(spacePath(s.id));
            expect(res.body.description).toBe(long);
        });

        it("returns 404 (never 500) for an id with SQL-ish characters", async () => {
            const u = await makeUser();
            const client = await makeLoggedInClient(u);

            const res = await client.get(
                spacePath(encodeURIComponent("sp-';DROP TABLE spaces;--")),
            );

            expect(res.status).toBe(404);
            expect(res.body.error.code).toBe("space.not_found");
        });
    });

    // ─── i. Side effects (read-only) ──────────────────────────────────────────
    describe("Side effects (read-only)", () => {
        it("writes no workspace_activity or task_activity rows and leaves the row intact", async () => {
            const u = await makeUser();
            const s = await makeSpace({
                workspaceId: u.workspaceId,
                createdBy: u.id,
            });
            const client = await makeLoggedInClient(u);

            const wsBefore = await countWorkspaceActivity();
            const taBefore = await countTaskActivity();

            await client.get(spacePath(s.id));

            expect(await countWorkspaceActivity()).toBe(wsBefore);
            expect(await countTaskActivity()).toBe(taBefore);

            const db = getDb();
            const [row] = await db
                .select({ id: spaces.id })
                .from(spaces)
                .where(eq(spaces.id, s.id));
            expect(row?.id).toBe(s.id);
        });
    });

    // ─── Cross-cutting: error envelope ────────────────────────────────────────
    describe("Error envelope", () => {
        it("renders {error:{code,message,request_id}} on the 404 path", async () => {
            const u = await makeUser();
            const client = await makeLoggedInClient(u);

            const res = await client.get(spacePath(fakeId("sp")));

            expect(res.status).toBe(404);
            expect(res.body).toEqual({
                error: {
                    code: "space.not_found",
                    message: expect.any(String),
                    request_id: expect.any(String),
                },
            });
            expect(res.body.error.request_id).toMatch(/^req_/);
        });
    });
});
