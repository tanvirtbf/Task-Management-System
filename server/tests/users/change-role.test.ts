import jwt from "jsonwebtoken";
import { eq } from "drizzle-orm";
import { oneOff } from "../test-utils/app";
import { makeLoggedInClient, makeUser } from "../test-utils/factories";
import { getDb } from "../../src/db/client";
import { users, workspaceActivity } from "../../src/db/schema";
import { Config } from "../../src/config";
import type { Role } from "../../src/constants";

/**
 * Tests for `PATCH /api/v1/users/:id/role` (§4 #5) — promote / demote.
 *
 * 👑 admin/owner only (the coarse gate is `canAccess` in the route → 403
 * `auth.forbidden`). Two row-level rules live in the service: the workspace
 * owner's role is immutable here, and a caller cannot change their own role.
 * `owner` is never an assignable value (validator → 422).
 *
 * N/A categories (documented): pagination (single resource); ETag/If-Match (no
 * optimistic-lock layer); Idempotency-Key (no idempotency layer — a repeat of
 * the same role is a safe 200 no-op).
 */

jest.setTimeout(30_000);

const PATH = (id: string) => `/api/v1/users/${id}/role`;

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
describe("PATCH /api/v1/users/:id/role", () => {
    // ─── a. Happy path ──────────────────────────────────────────────────────
    describe("Happy path", () => {
        it("lets an admin promote a member to admin (200)", async () => {
            const { admin, client } = await adminClient();
            const member = await makeUser({
                workspaceId: admin.workspaceId,
                role: "member",
            });

            const res = await client
                .patch(PATH(member.id))
                .send({ role: "admin" });

            expect(res.status).toBe(200);
            expect(res.body.role).toBe("admin");
            expect((await userById(member.id)).role).toBe("admin");
            expect(res.body).not.toHaveProperty("data");
        });

        it("lets an owner demote an admin to member (200)", async () => {
            const { admin: owner, client } = await adminClient("owner");
            const target = await makeUser({
                workspaceId: owner.workspaceId,
                role: "admin",
            });

            const res = await client
                .patch(PATH(target.id))
                .send({ role: "member" });

            expect(res.status).toBe(200);
            expect(res.body.role).toBe("member");
        });

        it("lets an admin set a member to guest (200)", async () => {
            const { admin, client } = await adminClient();
            const member = await makeUser({
                workspaceId: admin.workspaceId,
                role: "member",
            });

            const res = await client
                .patch(PATH(member.id))
                .send({ role: "guest" });

            expect(res.status).toBe(200);
            expect(res.body.role).toBe("guest");
        });

        it("returns exactly the 10 wire fields", async () => {
            const { admin, client } = await adminClient();
            const member = await makeUser({
                workspaceId: admin.workspaceId,
                role: "member",
            });

            const res = await client
                .patch(PATH(member.id))
                .send({ role: "admin" });

            expect(Object.keys(res.body).sort()).toEqual(EXPECTED_KEYS);
            expect(res.body).not.toHaveProperty("password_hash");
            expect(res.body).not.toHaveProperty("workspace_id");
        });
    });

    // ─── b. Validation (422) ────────────────────────────────────────────────
    describe("Validation", () => {
        const cases: Array<[string, Record<string, unknown>]> = [
            ["missing role", {}],
            ["owner role (not assignable)", { role: "owner" }],
            ["unknown role", { role: "superadmin" }],
            ["wrong-case role", { role: "Admin" }],
            ["role wrong type (number)", { role: 1 }],
        ];

        for (const [label, body] of cases) {
            it(`returns 422 validation.failed for ${label}`, async () => {
                const { admin, client } = await adminClient();
                const member = await makeUser({
                    workspaceId: admin.workspaceId,
                    role: "member",
                });

                const res = await client.patch(PATH(member.id)).send(body);

                expect(res.status).toBe(422);
                expect(res.body.error.code).toBe("validation.failed");
            });
        }

        it("returns 422 for an over-length id (65 chars)", async () => {
            const { client } = await adminClient();

            const res = await client
                .patch(PATH("a".repeat(65)))
                .send({ role: "admin" });

            expect(res.status).toBe(422);
            expect(res.body.error.code).toBe("validation.failed");
        });
    });

    // ─── c. Authentication (401) ──────────────────────────────────────────────
    describe("Authentication", () => {
        it("returns 401 auth.missing_token when no token is supplied", async () => {
            const http = await oneOff();

            const res = await http
                .patch(PATH("u-anything"))
                .send({ role: "admin" });

            expect(res.status).toBe(401);
            expect(res.body.error.code).toBe("auth.missing_token");
        });

        it("returns 401 auth.invalid_token for a malformed bearer token", async () => {
            const http = await oneOff();

            const res = await http
                .patch(PATH("u-anything"))
                .set("Authorization", "Bearer not.a.jwt")
                .send({ role: "admin" });

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
                .send({ role: "member" });

            expect(res.status).toBe(401);
            expect(res.body.error.code).toBe("auth.expired_token");
        });
    });

    // ─── d. Authorization (👑 admin/owner via canAccess) ─────────────────────
    describe("Authorization", () => {
        const forbidden: Role[] = ["member", "guest"];
        for (const role of forbidden) {
            it(`forbids a ${role} from changing roles (403 auth.forbidden)`, async () => {
                const caller = await makeUser({ role });
                const target = await makeUser({
                    workspaceId: caller.workspaceId,
                    role: "member",
                });
                const client = await makeLoggedInClient(caller);

                const res = await client
                    .patch(PATH(target.id))
                    .send({ role: "admin" });

                expect(res.status).toBe(403);
                expect(res.body.error.code).toBe("auth.forbidden");
            });
        }

        it("checks the role before the body (403, not 422, on a bad body)", async () => {
            const caller = await makeUser({ role: "member" });
            const target = await makeUser({
                workspaceId: caller.workspaceId,
                role: "member",
            });
            const client = await makeLoggedInClient(caller);

            const res = await client
                .patch(PATH(target.id))
                .send({ role: "owner" }); // would be 422 if it reached validation

            expect(res.status).toBe(403);
            expect(res.body.error.code).toBe("auth.forbidden");
        });
    });

    // ─── Row-level rules (owner immutable / no self-change) ───────────────────
    describe("Row-level rules", () => {
        it("403 user.cannot_change_owner_role when an admin targets the owner", async () => {
            const { admin, client } = await adminClient();
            const owner = await makeUser({
                workspaceId: admin.workspaceId,
                role: "owner",
            });

            const res = await client
                .patch(PATH(owner.id))
                .send({ role: "member" });

            expect(res.status).toBe(403);
            expect(res.body.error.code).toBe("user.cannot_change_owner_role");
            expect((await userById(owner.id)).role).toBe("owner");
        });

        it("403 user.cannot_change_owner_role when the owner targets themselves", async () => {
            const { admin: owner, client } = await adminClient("owner");

            const res = await client
                .patch(PATH(owner.id))
                .send({ role: "admin" });

            expect(res.status).toBe(403);
            expect(res.body.error.code).toBe("user.cannot_change_owner_role");
        });

        it("403 user.cannot_change_own_role when an admin targets themselves", async () => {
            const { admin, client } = await adminClient();

            const res = await client
                .patch(PATH(admin.id))
                .send({ role: "member" });

            expect(res.status).toBe(403);
            expect(res.body.error.code).toBe("user.cannot_change_own_role");
            expect((await userById(admin.id)).role).toBe("admin");
        });

        it("returns 404 user.not_found for an id that exists nowhere", async () => {
            const { client } = await adminClient();

            const res = await client
                .patch(PATH("u-nope"))
                .send({ role: "admin" });

            expect(res.status).toBe(404);
            expect(res.body.error.code).toBe("user.not_found");
        });
    });

    // ─── Idempotency / no-op ──────────────────────────────────────────────────
    describe("No-op", () => {
        it("returns 200 and writes no activity row when the role is unchanged", async () => {
            const { admin, client } = await adminClient();
            const member = await makeUser({
                workspaceId: admin.workspaceId,
                role: "member",
            });

            const res = await client
                .patch(PATH(member.id))
                .send({ role: "member" });

            expect(res.status).toBe(200);
            expect(res.body.role).toBe("member");
            expect(await activityFor(member.id)).toHaveLength(0);
        });
    });

    // ─── e. Resource lifecycle ────────────────────────────────────────────────
    describe("Resource lifecycle", () => {
        it("can change an invited member's role (200, status unchanged)", async () => {
            const { admin, client } = await adminClient();
            const invited = await makeUser({
                workspaceId: admin.workspaceId,
                role: "member",
                status: "invited",
            });

            const res = await client
                .patch(PATH(invited.id))
                .send({ role: "admin" });

            expect(res.status).toBe(200);
            expect(res.body.role).toBe("admin");
            expect(res.body.status).toBe("invited");
        });

        it("can change a deactivated member's role (200)", async () => {
            const { admin, client } = await adminClient();
            const off = await makeUser({
                workspaceId: admin.workspaceId,
                role: "member",
                status: "deactivated",
            });

            const res = await client
                .patch(PATH(off.id))
                .send({ role: "guest" });

            expect(res.status).toBe(200);
            expect(res.body.role).toBe("guest");
            expect(res.body.status).toBe("deactivated");
        });
    });

    // ─── g. Tenant / workspace isolation ──────────────────────────────────────
    describe("Workspace isolation", () => {
        it("returns 404 when an admin targets a user in another workspace", async () => {
            const { client } = await adminClient(); // workspace 1
            const ws2User = await makeUser({ role: "member" }); // workspace 2

            const res = await client
                .patch(PATH(ws2User.id))
                .send({ role: "admin" });

            expect(res.status).toBe(404);
            expect(res.body.error.code).toBe("user.not_found");
            // The cross-tenant user is untouched.
            expect((await userById(ws2User.id)).role).toBe("member");
        });
    });

    // ─── i. Concurrency ───────────────────────────────────────────────────────
    describe("Concurrency", () => {
        it("two parallel role changes both succeed with a consistent final role", async () => {
            const { admin, client } = await adminClient();
            const member = await makeUser({
                workspaceId: admin.workspaceId,
                role: "member",
            });

            const [a, b] = await Promise.all([
                client.patch(PATH(member.id)).send({ role: "admin" }),
                client.patch(PATH(member.id)).send({ role: "guest" }),
            ]);

            expect(a.status).toBe(200);
            expect(b.status).toBe(200);
            expect(["admin", "guest"]).toContain(
                (await userById(member.id)).role,
            );
        });

        it("two parallel IDENTICAL role changes write exactly one audit row", async () => {
            // Regression: the no-op guard is re-checked under a FOR UPDATE lock,
            // so a duplicate logical transition collapses to a single audit row.
            const { admin, client } = await adminClient();
            const member = await makeUser({
                workspaceId: admin.workspaceId,
                role: "member",
            });

            const [a, b] = await Promise.all([
                client.patch(PATH(member.id)).send({ role: "admin" }),
                client.patch(PATH(member.id)).send({ role: "admin" }),
            ]);

            expect(a.status).toBe(200);
            expect(b.status).toBe(200);
            expect((await userById(member.id)).role).toBe("admin");
            const roleChanges = (await activityFor(member.id)).filter(
                (r) => r.action === "role_changed",
            );
            expect(roleChanges).toHaveLength(1);
        });
    });

    // ─── l. Side effects ──────────────────────────────────────────────────────
    describe("Side effects", () => {
        it("writes a 'role_changed' activity row with from/to context", async () => {
            const { admin, client } = await adminClient();
            const member = await makeUser({
                workspaceId: admin.workspaceId,
                role: "member",
            });

            await client.patch(PATH(member.id)).send({ role: "admin" });

            const acts = await activityFor(member.id);
            expect(acts).toHaveLength(1);
            expect(acts[0].action).toBe("role_changed");
            expect(acts[0].entityType).toBe("user");
            expect(acts[0].actorId).toBe(admin.id);
            expect(acts[0].context).toMatchObject({
                from: "member",
                to: "admin",
            });
        });

        it("changes only the role, never the status or email", async () => {
            const { admin, client } = await adminClient();
            const member = await makeUser({
                workspaceId: admin.workspaceId,
                role: "member",
            });
            const before = await userById(member.id);

            await client.patch(PATH(member.id)).send({ role: "admin" });

            const after = await userById(member.id);
            expect(after.status).toBe(before.status);
            expect(after.email).toBe(before.email);
        });
    });

    // ─── m. Cleanup / rollback ────────────────────────────────────────────────
    describe("Cleanup / rollback", () => {
        it("writes no activity row when the change is forbidden (owner target)", async () => {
            const { admin, client } = await adminClient();
            const owner = await makeUser({
                workspaceId: admin.workspaceId,
                role: "owner",
            });

            const res = await client
                .patch(PATH(owner.id))
                .send({ role: "member" });

            expect(res.status).toBe(403);
            expect(await activityFor(owner.id)).toHaveLength(0);
        });
    });

    // ─── n. Cross-cutting + security ──────────────────────────────────────────
    describe("Cross-cutting", () => {
        it("responds as application/json with an X-Request-Id header", async () => {
            const { admin, client } = await adminClient();
            const member = await makeUser({
                workspaceId: admin.workspaceId,
                role: "member",
            });

            const res = await client
                .patch(PATH(member.id))
                .send({ role: "admin" });

            expect(res.headers["content-type"]).toMatch(/application\/json/);
            expect(res.headers["x-request-id"]).toMatch(/^req_/);
        });

        it("ignores a smuggled status field (only role changes)", async () => {
            const { admin, client } = await adminClient();
            const member = await makeUser({
                workspaceId: admin.workspaceId,
                role: "member",
                status: "active",
            });

            const res = await client
                .patch(PATH(member.id))
                .send({ role: "admin", status: "deactivated" });

            expect(res.status).toBe(200);
            expect(res.body.role).toBe("admin");
            expect(res.body.status).toBe("active"); // status untouched
            expect((await userById(member.id)).status).toBe("active");
        });
    });
});
