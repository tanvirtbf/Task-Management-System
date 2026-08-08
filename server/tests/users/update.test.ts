import jwt from "jsonwebtoken";
import { eq } from "drizzle-orm";
import { oneOff } from "../test-utils/app";
import { makeLoggedInClient, makeUser } from "../test-utils/factories";
import { getDb } from "../../src/db/client";
import { users, workspaceActivity } from "../../src/db/schema";
import { Config } from "../../src/config";
import type { Role } from "../../src/constants";

/**
 * Tests for `PATCH /api/v1/users/:id` (§4 #4) — profile self-edit / admin-edit.
 *
 * Patterns mirror `tests/users/invite.test.ts`: real DB writes via factories,
 * `makeLoggedInClient` for authed calls, `oneOff()` for negative-auth. The
 * authorization rule is "self OR owner/admin" (a member may edit only their own
 * profile), so — unlike the 👑 `invite` — this route has no `canAccess`; the
 * rule is enforced row-by-row in the service.
 *
 * N/A categories (documented): pagination (single resource); ETag/If-Match (no
 * optimistic-lock layer); Idempotency-Key (no idempotency layer yet — PATCH is
 * naturally idempotent, a retried identical patch is a safe 200).
 */

jest.setTimeout(30_000);

const PATH = (id: string) => `/api/v1/users/${id}`;

/** The exact Appendix-A `User` keys this endpoint returns. */
const EXPECTED_KEYS = [
    "avatar_url",
    "created_at",
    "email",
    "first_name",
    "id",
    "last_login_at",
    "last_name",
    "role",
    "status",
    "timezone",
].sort();

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

const userById = async (id: string) => {
    const db = getDb();
    const [row] = await db.select().from(users).where(eq(users.id, id));
    return row;
};

const activityFor = async (entityId: string) => {
    const db = getDb();
    return db
        .select()
        .from(workspaceActivity)
        .where(eq(workspaceActivity.entityId, entityId));
};

/** An owner/admin caller + an authed client in a fresh workspace. */
const adminClient = async (role: Role = "admin") => {
    const admin = await makeUser({ role });
    const client = await makeLoggedInClient(admin);
    return { admin, client };
};

// ════════════════════════════════════════════════════════════════════════════
describe("PATCH /api/v1/users/:id", () => {
    // ─── a. Happy path ──────────────────────────────────────────────────────
    describe("Happy path", () => {
        it("lets a member edit their own first_name (200, reflected)", async () => {
            const member = await makeUser({ role: "member" });
            const client = await makeLoggedInClient(member);

            const res = await client
                .patch(PATH(member.id))
                .send({ first_name: "Karim" });

            expect(res.status).toBe(200);
            expect(res.body.first_name).toBe("Karim");
            expect(res.body.id).toBe(member.id);
            expect(res.body).not.toHaveProperty("data");
        });

        it("returns exactly the 10 wire fields, no leak of internal columns", async () => {
            const member = await makeUser({ role: "member" });
            const client = await makeLoggedInClient(member);

            const res = await client
                .patch(PATH(member.id))
                .send({ last_name: "Uddin" });

            expect(res.status).toBe(200);
            expect(Object.keys(res.body).sort()).toEqual(EXPECTED_KEYS);
            expect(res.body).not.toHaveProperty("password_hash");
            expect(res.body).not.toHaveProperty("workspace_id");
            expect(res.body).not.toHaveProperty("updated_at");
        });

        it("lets an admin edit another member in the workspace (200)", async () => {
            const { admin, client } = await adminClient();
            const target = await makeUser({
                workspaceId: admin.workspaceId,
                role: "member",
            });

            const res = await client
                .patch(PATH(target.id))
                .send({ first_name: "Nadia", timezone: "Asia/Tokyo" });

            expect(res.status).toBe(200);
            expect(res.body.first_name).toBe("Nadia");
            expect(res.body.timezone).toBe("Asia/Tokyo");
        });

        it("lets an owner edit another member (200)", async () => {
            const { admin: owner, client } = await adminClient("owner");
            const target = await makeUser({
                workspaceId: owner.workspaceId,
                role: "member",
            });

            const res = await client
                .patch(PATH(target.id))
                .send({ last_name: "Rahman" });

            expect(res.status).toBe(200);
            expect(res.body.last_name).toBe("Rahman");
        });

        it("lowercases a changed email before storing and returning it", async () => {
            // F12 (ISS-030): changing a LOGIN EMAIL is admin-only now, so the
            // lowercasing rule is exercised through an admin. A member editing
            // their own address is the vulnerability itself and is asserted
            // just below.
            const { admin, client } = await adminClient("admin");
            const target = await makeUser({
                workspaceId: admin.workspaceId,
                role: "member",
            });

            const res = await client
                .patch(PATH(target.id))
                .send({ email: "New.Address@Seed.TEST" });

            expect(res.status).toBe(200);
            expect(res.body.email).toBe("new.address@seed.test");
            expect((await userById(target.id)).email).toBe(
                "new.address@seed.test",
            );
        });

        it("refuses a member changing their OWN login email (ISS-030)", async () => {
            // A member could move their own account to any address, with no
            // verification and no notice: it frees the corporate address (a
            // later invite then creates a SECOND account at it) and, with
            // forgot-password, is a persistence primitive.
            const member = await makeUser({ role: "member" });
            const client = await makeLoggedInClient(member);

            const res = await client
                .patch(PATH(member.id))
                .send({ email: "attacker@evil.test" });

            expect(res.status).toBe(403);
            expect(res.body.error.code).toBe("user.email_change_forbidden");
            expect((await userById(member.id)).email).toBe(member.email);
        });

        it("still lets a member echo their own unchanged email", async () => {
            // A plain profile PATCH that happens to include the current address
            // must not start failing.
            const member = await makeUser({ role: "member" });
            const client = await makeLoggedInClient(member);

            const res = await client
                .patch(PATH(member.id))
                .send({ first_name: "Nadia", email: member.email });

            expect(res.status).toBe(200);
            expect(res.body.first_name).toBe("Nadia");
        });

        it("sets and then clears avatar_url (null) (200)", async () => {
            const member = await makeUser({ role: "member" });
            const client = await makeLoggedInClient(member);

            const set = await client
                .patch(PATH(member.id))
                .send({ avatar_url: "https://cdn.seed.test/a.png" });
            expect(set.status).toBe(200);
            expect(set.body.avatar_url).toBe("https://cdn.seed.test/a.png");

            const cleared = await client
                .patch(PATH(member.id))
                .send({ avatar_url: null });
            expect(cleared.status).toBe(200);
            expect(cleared.body.avatar_url).toBeNull();
            expect((await userById(member.id)).avatarUrl).toBeNull();
        });

        it("changes only the provided fields, leaving others intact", async () => {
            const member = await makeUser({
                role: "member",
                firstName: "Orig",
                lastName: "Name",
            });
            const client = await makeLoggedInClient(member);

            await client.patch(PATH(member.id)).send({ first_name: "Changed" });

            const row = await userById(member.id);
            expect(row.firstName).toBe("Changed");
            expect(row.lastName).toBe("Name"); // untouched
        });
    });

    // ─── b. Validation (422) ────────────────────────────────────────────────
    describe("Validation", () => {
        const cases: Array<[string, Record<string, unknown>]> = [
            ["empty body (no updatable field)", {}],
            ["body with only an unknown field (role)", { role: "admin" }],
            ["empty first_name", { first_name: "" }],
            ["whitespace-only first_name", { first_name: "   " }],
            ["over-long first_name (81)", { first_name: "a".repeat(81) }],
            ["over-long last_name (81)", { last_name: "a".repeat(81) }],
            ["malformed email", { email: "not-an-email" }],
            ["empty timezone", { timezone: "" }],
            ["over-long timezone (65)", { timezone: "a".repeat(65) }],
            ["avatar_url that is not a URL", { avatar_url: "just-text" }],
            ["avatar_url wrong type (number)", { avatar_url: 42 }],
            [
                "over-long avatar_url (501)",
                { avatar_url: "https://e.test/" + "a".repeat(487) },
            ],
        ];

        for (const [label, body] of cases) {
            it(`returns 422 validation.failed for ${label}`, async () => {
                const member = await makeUser({ role: "member" });
                const client = await makeLoggedInClient(member);

                const res = await client.patch(PATH(member.id)).send(body);

                expect(res.status).toBe(422);
                expect(res.body.error.code).toBe("validation.failed");
            });
        }

        it("returns 422 for an over-length id (65 chars)", async () => {
            const member = await makeUser({ role: "member" });
            const client = await makeLoggedInClient(member);

            const res = await client
                .patch(PATH("a".repeat(65)))
                .send({ first_name: "X" });

            expect(res.status).toBe(422);
            expect(res.body.error.code).toBe("validation.failed");
        });

        it("accepts a first_name at exactly the 80-char boundary (200)", async () => {
            const member = await makeUser({ role: "member" });
            const client = await makeLoggedInClient(member);

            const res = await client
                .patch(PATH(member.id))
                .send({ first_name: "a".repeat(80) });

            expect(res.status).toBe(200);
            expect(res.body.first_name).toBe("a".repeat(80));
        });

        it("accepts an avatar_url at exactly the 500-char boundary (200)", async () => {
            const member = await makeUser({ role: "member" });
            const client = await makeLoggedInClient(member);
            const url = "https://e.test/" + "a".repeat(485); // 15 + 485 = 500

            const res = await client
                .patch(PATH(member.id))
                .send({ avatar_url: url });

            expect(res.status).toBe(200);
            expect(res.body.avatar_url).toBe(url);
        });
    });

    // ─── c. Authentication (401) ──────────────────────────────────────────────
    describe("Authentication", () => {
        it("returns 401 auth.missing_token when no token is supplied", async () => {
            const http = await oneOff();

            const res = await http
                .patch(PATH("u-anything"))
                .send({ first_name: "X" });

            expect(res.status).toBe(401);
            expect(res.body.error.code).toBe("auth.missing_token");
        });

        it("returns 401 auth.invalid_token for a malformed bearer token", async () => {
            const http = await oneOff();

            const res = await http
                .patch(PATH("u-anything"))
                .set("Authorization", "Bearer not.a.jwt")
                .send({ first_name: "X" });

            expect(res.status).toBe(401);
            expect(res.body.error.code).toBe("auth.invalid_token");
        });

        it("returns 401 auth.expired_token for an expired token", async () => {
            const u = await makeUser({ role: "admin" });
            const token = signAccess(u, Config.ACCESS_TOKEN_SECRET!, {
                expiresIn: -10,
            });
            const http = await oneOff();

            const res = await http
                .patch(PATH(u.id))
                .set("Authorization", `Bearer ${token}`)
                .send({ first_name: "X" });

            expect(res.status).toBe(401);
            expect(res.body.error.code).toBe("auth.expired_token");
        });
    });

    // ─── d. Authorization (self OR owner/admin) ──────────────────────────────
    describe("Authorization", () => {
        it("allows a guest to edit their own profile (200)", async () => {
            const guest = await makeUser({ role: "guest" });
            const client = await makeLoggedInClient(guest);

            const res = await client
                .patch(PATH(guest.id))
                .send({ first_name: "Self" });

            expect(res.status).toBe(200);
        });

        it("forbids a member from editing another member (403 user.forbidden_edit)", async () => {
            const member = await makeUser({ role: "member" });
            const other = await makeUser({
                workspaceId: member.workspaceId,
                role: "member",
            });
            const client = await makeLoggedInClient(member);

            const res = await client
                .patch(PATH(other.id))
                .send({ first_name: "Hax" });

            expect(res.status).toBe(403);
            expect(res.body.error.code).toBe("user.forbidden_edit");
        });

        it("forbids a guest from editing another member (403)", async () => {
            const guest = await makeUser({ role: "guest" });
            const other = await makeUser({
                workspaceId: guest.workspaceId,
                role: "member",
            });
            const client = await makeLoggedInClient(guest);

            const res = await client
                .patch(PATH(other.id))
                .send({ first_name: "Hax" });

            expect(res.status).toBe(403);
            expect(res.body.error.code).toBe("user.forbidden_edit");
        });

        it("does not change the target when a member is forbidden", async () => {
            const member = await makeUser({ role: "member" });
            const other = await makeUser({
                workspaceId: member.workspaceId,
                role: "member",
                firstName: "Safe",
            });
            const client = await makeLoggedInClient(member);

            await client.patch(PATH(other.id)).send({ first_name: "Hax" });

            expect((await userById(other.id)).firstName).toBe("Safe");
            expect(await activityFor(other.id)).toHaveLength(0);
        });
    });

    // ─── e. Resource lifecycle / not-found ────────────────────────────────────
    describe("Resource lifecycle", () => {
        it("returns 404 user.not_found for an id that exists nowhere", async () => {
            const { client } = await adminClient();

            const res = await client
                .patch(PATH("u-does-not-exist"))
                .send({ first_name: "X" });

            expect(res.status).toBe(404);
            expect(res.body.error.code).toBe("user.not_found");
        });

        it("can update an invited member's profile (200)", async () => {
            const { admin, client } = await adminClient();
            const invited = await makeUser({
                workspaceId: admin.workspaceId,
                role: "member",
                status: "invited",
            });

            const res = await client
                .patch(PATH(invited.id))
                .send({ first_name: "Pending" });

            expect(res.status).toBe(200);
            expect(res.body.status).toBe("invited"); // status unchanged
        });

        it("can update a deactivated member's profile (200)", async () => {
            const { admin, client } = await adminClient();
            const off = await makeUser({
                workspaceId: admin.workspaceId,
                role: "member",
                status: "deactivated",
            });

            const res = await client
                .patch(PATH(off.id))
                .send({ last_name: "Still-Editable" });

            expect(res.status).toBe(200);
            expect(res.body.status).toBe("deactivated");
        });
    });

    // ─── f. Conflict (409 user.email_already_exists) ─────────────────────────
    describe("Conflict", () => {
        it("409 when changing email to one taken in the same workspace", async () => {
            const { admin, client } = await adminClient();
            await makeUser({
                workspaceId: admin.workspaceId,
                email: "taken@seed.test",
            });
            const target = await makeUser({
                workspaceId: admin.workspaceId,
                email: "target@seed.test",
            });

            const res = await client
                .patch(PATH(target.id))
                .send({ email: "taken@seed.test" });

            expect(res.status).toBe(409);
            expect(res.body.error.code).toBe("user.email_already_exists");
        });

        it("409 when the email is taken in ANOTHER workspace (global uniqueness)", async () => {
            const { admin, client } = await adminClient();
            const target = await makeUser({ workspaceId: admin.workspaceId });
            await makeUser({ email: "elsewhere@seed.test" }); // separate workspace

            const res = await client
                .patch(PATH(target.id))
                .send({ email: "elsewhere@seed.test" });

            expect(res.status).toBe(409);
            expect(res.body.error.code).toBe("user.email_already_exists");
        });

        it("allows changing email to your OWN current value (no-op, 200)", async () => {
            const member = await makeUser({
                role: "member",
                email: "me@seed.test",
            });
            const client = await makeLoggedInClient(member);

            const res = await client
                .patch(PATH(member.id))
                .send({ email: "me@seed.test" });

            expect(res.status).toBe(200);
            expect(res.body.email).toBe("me@seed.test");
        });

        it("allows a case-only change of your own email (200)", async () => {
            const member = await makeUser({
                role: "member",
                email: "me@seed.test",
            });
            const client = await makeLoggedInClient(member);

            const res = await client
                .patch(PATH(member.id))
                .send({ email: "ME@SEED.TEST" });

            expect(res.status).toBe(200);
            expect(res.body.email).toBe("me@seed.test");
        });
    });

    // ─── g. Tenant / workspace isolation ──────────────────────────────────────
    describe("Workspace isolation", () => {
        it("returns 404 (not 200/403) when an admin targets another workspace's user", async () => {
            const { client } = await adminClient(); // workspace 1
            const ws2User = await makeUser(); // workspace 2

            const res = await client
                .patch(PATH(ws2User.id))
                .send({ first_name: "X" });

            expect(res.status).toBe(404);
            expect(res.body.error.code).toBe("user.not_found");
        });

        it("does not leak the cross-tenant user's data in the 404 body", async () => {
            const { client } = await adminClient();
            const ws2User = await makeUser({ firstName: "Secret" });

            const res = await client
                .patch(PATH(ws2User.id))
                .send({ first_name: "X" });

            expect(JSON.stringify(res.body)).not.toContain("Secret");
        });
    });

    // ─── h. Idempotency ───────────────────────────────────────────────────────
    describe("Idempotency", () => {
        it("applies the same patch twice with the same result (200, 200)", async () => {
            const member = await makeUser({ role: "member" });
            const client = await makeLoggedInClient(member);

            const a = await client
                .patch(PATH(member.id))
                .send({ first_name: "Same" });
            const b = await client
                .patch(PATH(member.id))
                .send({ first_name: "Same" });

            expect(a.status).toBe(200);
            expect(b.status).toBe(200);
            expect(b.body.first_name).toBe("Same");
        });
    });

    // ─── i. Concurrency ───────────────────────────────────────────────────────
    describe("Concurrency", () => {
        it("two parallel patches of different fields both apply", async () => {
            const member = await makeUser({ role: "member" });
            const client = await makeLoggedInClient(member);

            const [a, b] = await Promise.all([
                client.patch(PATH(member.id)).send({ first_name: "Aaa" }),
                client.patch(PATH(member.id)).send({ last_name: "Bbb" }),
            ]);

            expect(a.status).toBe(200);
            expect(b.status).toBe(200);
            const row = await userById(member.id);
            expect(row.firstName).toBe("Aaa");
            expect(row.lastName).toBe("Bbb");
        });

        it("survives 50 parallel self-patches with a consistent final row", async () => {
            const member = await makeUser({ role: "member" });
            const client = await makeLoggedInClient(member);

            const results = await Promise.all(
                Array.from({ length: 50 }, (_, i) =>
                    client
                        .patch(PATH(member.id))
                        .send({ first_name: `Name${i}` }),
                ),
            );

            expect(results.every((r) => r.status === 200)).toBe(true);
            const row = await userById(member.id);
            expect(row.firstName).toMatch(/^Name\d+$/);
        });
    });

    // ─── k. Boundary values ───────────────────────────────────────────────────
    describe("Boundary values", () => {
        it("round-trips a unicode name intact", async () => {
            const member = await makeUser({ role: "member" });
            const client = await makeLoggedInClient(member);

            const res = await client
                .patch(PATH(member.id))
                .send({ first_name: "রহিম 🌟 José" });

            expect(res.status).toBe(200);
            expect(res.body.first_name).toBe("রহিম 🌟 José");
        });

        it("refuses a 64-char timezone that is not a real IANA zone (ISS-031)", async () => {
            // This test used to assert that `"a".repeat(64)` was ACCEPTED —
            // the column is VARCHAR(64), so the only rule was length. That is
            // exactly ISS-031: the workspace validator has always checked the
            // value against the IANA list, the user profile did not, and
            // `users.timezone` is on the wire in GET /users and /auth/me, so a
            // client doing `Intl.DateTimeFormat(…, {timeZone})` threw a
            // RangeError on that row. The IANA rule is strictly narrower than
            // the length rule (the longest real zone is ~32 chars), so the
            // 64-char boundary is now unreachable BY DESIGN.
            const member = await makeUser({ role: "member" });
            const client = await makeLoggedInClient(member);

            const res = await client
                .patch(PATH(member.id))
                .send({ timezone: "a".repeat(64) });

            expect(res.status).toBe(422);
            expect(res.body.error.code).toBe("validation.failed");
        });

        it("accepts a long REAL IANA zone", async () => {
            const member = await makeUser({ role: "member" });
            const client = await makeLoggedInClient(member);

            const res = await client
                .patch(PATH(member.id))
                .send({ timezone: "America/Argentina/ComodRivadavia" });

            expect(res.status).toBe(200);
            expect(res.body.timezone).toBe("America/Argentina/ComodRivadavia");
        });

        it("trims surrounding whitespace in a name before storing", async () => {
            const member = await makeUser({ role: "member" });
            const client = await makeLoggedInClient(member);

            const res = await client
                .patch(PATH(member.id))
                .send({ first_name: "  Trimmed  " });

            expect(res.status).toBe(200);
            expect(res.body.first_name).toBe("Trimmed");
        });
    });

    // ─── l. Side effects ──────────────────────────────────────────────────────
    describe("Side effects", () => {
        it("writes exactly one 'profile_updated' workspace_activity row", async () => {
            const member = await makeUser({ role: "member" });
            const client = await makeLoggedInClient(member);

            await client
                .patch(PATH(member.id))
                .send({ first_name: "Karim", timezone: "Asia/Tokyo" });

            const acts = await activityFor(member.id);
            expect(acts).toHaveLength(1);
            expect(acts[0].action).toBe("profile_updated");
            expect(acts[0].entityType).toBe("user");
            expect(acts[0].actorId).toBe(member.id);
            expect(acts[0].workspaceId).toBe(member.workspaceId);
            expect(acts[0].context).toMatchObject({
                fields: expect.arrayContaining(["firstName", "timezone"]),
            });
        });

        it("never changes role, status, or password_hash via a profile edit", async () => {
            const member = await makeUser({ role: "member" });
            const client = await makeLoggedInClient(member);
            const before = await userById(member.id);

            await client.patch(PATH(member.id)).send({ first_name: "X" });

            const after = await userById(member.id);
            expect(after.role).toBe("member");
            expect(after.status).toBe("active");
            expect(after.passwordHash).toBe(before.passwordHash);
        });
    });

    // ─── m. Cleanup / rollback ────────────────────────────────────────────────
    describe("Cleanup / rollback", () => {
        it("persists no partial state and no activity row when the email conflicts", async () => {
            const { admin, client } = await adminClient();
            await makeUser({
                workspaceId: admin.workspaceId,
                email: "taken@seed.test",
            });
            const target = await makeUser({
                workspaceId: admin.workspaceId,
                email: "target@seed.test",
                firstName: "Orig",
            });

            const res = await client
                .patch(PATH(target.id))
                .send({ first_name: "New", email: "taken@seed.test" });

            expect(res.status).toBe(409);
            const row = await userById(target.id);
            expect(row.firstName).toBe("Orig"); // pre-check threw before any write
            expect(row.email).toBe("target@seed.test");
            expect(await activityFor(target.id)).toHaveLength(0);
        });
    });

    // ─── n. Cross-cutting + security ──────────────────────────────────────────
    describe("Cross-cutting", () => {
        it("responds as application/json with an X-Request-Id header", async () => {
            const member = await makeUser({ role: "member" });
            const client = await makeLoggedInClient(member);

            const res = await client
                .patch(PATH(member.id))
                .send({ first_name: "X" });

            expect(res.headers["content-type"]).toMatch(/application\/json/);
            expect(res.headers["x-request-id"]).toMatch(/^req_/);
        });

        it("ignores injected privileged fields (role/status/id/workspace_id)", async () => {
            const member = await makeUser({ role: "member" });
            const client = await makeLoggedInClient(member);

            const res = await client.patch(PATH(member.id)).send({
                first_name: "X",
                role: "owner",
                status: "deactivated",
                id: "u-hax",
                workspace_id: "ws-hax",
                password_hash: "pwned",
            });

            expect(res.status).toBe(200);
            expect(res.body.role).toBe("member");
            expect(res.body.status).toBe("active");
            const row = await userById(member.id);
            expect(row.role).toBe("member");
            expect(row.status).toBe("active");
            expect(row.id).toBe(member.id);
            expect(row.workspaceId).toBe(member.workspaceId);
        });

        it("treats a SQL-injection-shaped name as a literal (200, stored verbatim)", async () => {
            const member = await makeUser({ role: "member" });
            const client = await makeLoggedInClient(member);
            const evil = "Robert'); DROP TABLE users;--";

            const res = await client
                .patch(PATH(member.id))
                .send({ first_name: evil });

            expect(res.status).toBe(200);
            expect(res.body.first_name).toBe(evil);
            expect((await userById(member.id)).firstName).toBe(evil);
        });
    });
});
