import jwt from "jsonwebtoken";
import { eq } from "drizzle-orm";
import { oneOff } from "../test-utils/app";
import {
    makeLoggedInClient,
    makeUser,
    makeSession,
} from "../test-utils/factories";
import { getDb } from "../../src/db/client";
import { users, workspaceActivity, sessions } from "../../src/db/schema";
import { Config } from "../../src/config";
import type { Role } from "../../src/constants";

/**
 * Tests for `POST /api/v1/users/:id/deactivate` (§4 #6) — disable a member.
 *
 * 👑 admin/owner only (coarse gate = `canAccess` → 403 `auth.forbidden`). The
 * service flips `status` to `deactivated` AND revokes every refresh session in
 * one transaction, then writes an audit row. Row rules: the owner can never be
 * deactivated; you cannot deactivate yourself. Returns 204.
 *
 * N/A categories (documented): pagination (no list); validation body (none —
 * the only input is the `:id` param); ETag/Idempotency-Key (a re-deactivate is
 * a safe 204 no-op).
 */

jest.setTimeout(30_000);

const PATH = (id: string) => `/api/v1/users/${id}/deactivate`;

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

const sessionsFor = async (userId: string) => {
    const db = getDb();
    return db.select().from(sessions).where(eq(sessions.userId, userId));
};

const adminClient = async (role: Role = "admin") => {
    const admin = await makeUser({ role });
    const client = await makeLoggedInClient(admin);
    return { admin, client };
};

// ════════════════════════════════════════════════════════════════════════════
describe("POST /api/v1/users/:id/deactivate", () => {
    // ─── a. Happy path ──────────────────────────────────────────────────────
    describe("Happy path", () => {
        it("lets an admin deactivate a member (204, no body)", async () => {
            const { admin, client } = await adminClient();
            const member = await makeUser({
                workspaceId: admin.workspaceId,
                role: "member",
            });

            const res = await client.post(PATH(member.id));

            expect(res.status).toBe(204);
            expect(Object.keys(res.body)).toHaveLength(0);
            expect((await userById(member.id)).status).toBe("deactivated");
        });

        it("lets an owner deactivate a member (204)", async () => {
            const { admin: owner, client } = await adminClient("owner");
            const member = await makeUser({
                workspaceId: owner.workspaceId,
                role: "member",
            });

            const res = await client.post(PATH(member.id));

            expect(res.status).toBe(204);
            expect((await userById(member.id)).status).toBe("deactivated");
        });

        it("revokes every active refresh session for the target", async () => {
            const { admin, client } = await adminClient();
            const member = await makeUser({
                workspaceId: admin.workspaceId,
                role: "member",
            });
            await makeSession({ userId: member.id });
            await makeSession({ userId: member.id });

            await client.post(PATH(member.id));

            const rows = await sessionsFor(member.id);
            expect(rows).toHaveLength(2);
            expect(rows.every((s) => s.revokedAt !== null)).toBe(true);
        });

        it("keeps the user row (deactivation is not a delete)", async () => {
            const { admin, client } = await adminClient();
            const member = await makeUser({
                workspaceId: admin.workspaceId,
                role: "member",
            });

            await client.post(PATH(member.id));

            expect(await userById(member.id)).toBeDefined();
        });
    });

    // ─── b. Validation (422) ────────────────────────────────────────────────
    describe("Validation", () => {
        it("returns 422 for an over-length id (65 chars)", async () => {
            const { client } = await adminClient();

            const res = await client.post(PATH("a".repeat(65)));

            expect(res.status).toBe(422);
            expect(res.body.error.code).toBe("validation.failed");
        });
    });

    // ─── c. Authentication (401) ──────────────────────────────────────────────
    describe("Authentication", () => {
        it("returns 401 auth.missing_token when no token is supplied", async () => {
            const http = await oneOff();

            const res = await http.post(PATH("u-anything"));

            expect(res.status).toBe(401);
            expect(res.body.error.code).toBe("auth.missing_token");
        });

        it("returns 401 auth.invalid_token for a malformed bearer token", async () => {
            const http = await oneOff();

            const res = await http
                .post(PATH("u-anything"))
                .set("Authorization", "Bearer not.a.jwt");

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
                .post(PATH(u.id))
                .set("Authorization", `Bearer ${token}`);

            expect(res.status).toBe(401);
            expect(res.body.error.code).toBe("auth.expired_token");
        });
    });

    // ─── d. Authorization (👑 admin/owner via canAccess) ─────────────────────
    describe("Authorization", () => {
        const forbidden: Role[] = ["member", "guest"];
        for (const role of forbidden) {
            it(`forbids a ${role} from deactivating (403 auth.forbidden)`, async () => {
                const caller = await makeUser({ role });
                const target = await makeUser({
                    workspaceId: caller.workspaceId,
                    role: "member",
                });
                const client = await makeLoggedInClient(caller);

                const res = await client.post(PATH(target.id));

                expect(res.status).toBe(403);
                expect(res.body.error.code).toBe("auth.forbidden");
                expect((await userById(target.id)).status).toBe("active");
            });
        }
    });

    // ─── Row-level rules ──────────────────────────────────────────────────────
    describe("Row-level rules", () => {
        it("403 user.cannot_deactivate_owner when targeting the owner", async () => {
            const { admin, client } = await adminClient();
            const owner = await makeUser({
                workspaceId: admin.workspaceId,
                role: "owner",
            });

            const res = await client.post(PATH(owner.id));

            expect(res.status).toBe(403);
            expect(res.body.error.code).toBe("user.cannot_deactivate_owner");
            expect((await userById(owner.id)).status).toBe("active");
        });

        it("403 user.cannot_self_deactivate when an admin targets themselves", async () => {
            const { admin, client } = await adminClient();

            const res = await client.post(PATH(admin.id));

            expect(res.status).toBe(403);
            expect(res.body.error.code).toBe("user.cannot_self_deactivate");
            expect((await userById(admin.id)).status).toBe("active");
        });

        it("blocks an owner from deactivating themselves (owner rule wins)", async () => {
            const { admin: owner, client } = await adminClient("owner");

            const res = await client.post(PATH(owner.id));

            expect(res.status).toBe(403);
            expect(res.body.error.code).toBe("user.cannot_deactivate_owner");
        });

        it("returns 404 user.not_found for an id that exists nowhere", async () => {
            const { client } = await adminClient();

            const res = await client.post(PATH("u-nope"));

            expect(res.status).toBe(404);
            expect(res.body.error.code).toBe("user.not_found");
        });
    });

    // ─── Idempotency ──────────────────────────────────────────────────────────
    describe("Idempotency", () => {
        it("re-deactivating an already-deactivated user is a 204 no-op", async () => {
            const { admin, client } = await adminClient();
            const member = await makeUser({
                workspaceId: admin.workspaceId,
                role: "member",
                status: "deactivated",
            });

            const res = await client.post(PATH(member.id));

            expect(res.status).toBe(204);
            expect((await userById(member.id)).status).toBe("deactivated");
            // No fresh audit row for a no-op.
            expect(await activityFor(member.id)).toHaveLength(0);
        });
    });

    // ─── e. Resource lifecycle ────────────────────────────────────────────────
    describe("Resource lifecycle", () => {
        it("can deactivate an invited (not-yet-accepted) member (204)", async () => {
            const { admin, client } = await adminClient();
            const invited = await makeUser({
                workspaceId: admin.workspaceId,
                role: "member",
                status: "invited",
            });

            const res = await client.post(PATH(invited.id));

            expect(res.status).toBe(204);
            expect((await userById(invited.id)).status).toBe("deactivated");
        });
    });

    // ─── g. Tenant / workspace isolation ──────────────────────────────────────
    describe("Workspace isolation", () => {
        it("returns 404 when an admin targets a user in another workspace", async () => {
            const { client } = await adminClient(); // workspace 1
            const ws2User = await makeUser({ role: "member" }); // workspace 2

            const res = await client.post(PATH(ws2User.id));

            expect(res.status).toBe(404);
            expect(res.body.error.code).toBe("user.not_found");
            expect((await userById(ws2User.id)).status).toBe("active");
        });
    });

    // ─── i. Concurrency ───────────────────────────────────────────────────────
    describe("Concurrency", () => {
        it("two parallel deactivations both succeed and leave the user deactivated", async () => {
            const { admin, client } = await adminClient();
            const member = await makeUser({
                workspaceId: admin.workspaceId,
                role: "member",
            });

            const [a, b] = await Promise.all([
                client.post(PATH(member.id)),
                client.post(PATH(member.id)),
            ]);

            expect(a.status).toBe(204);
            expect(b.status).toBe(204);
            expect((await userById(member.id)).status).toBe("deactivated");
        });

        it("two parallel deactivations write exactly one audit row (no-op under lock)", async () => {
            // Regression: the no-op guard is re-checked under a FOR UPDATE lock.
            const { admin, client } = await adminClient();
            const member = await makeUser({
                workspaceId: admin.workspaceId,
                role: "member",
            });

            const [a, b] = await Promise.all([
                client.post(PATH(member.id)),
                client.post(PATH(member.id)),
            ]);

            expect(a.status).toBe(204);
            expect(b.status).toBe(204);
            const acts = (await activityFor(member.id)).filter(
                (r) => r.action === "deactivated",
            );
            expect(acts).toHaveLength(1);
        });
    });

    // ─── l. Side effects ──────────────────────────────────────────────────────
    describe("Side effects", () => {
        it("writes a 'deactivated' activity row with the prior status", async () => {
            const { admin, client } = await adminClient();
            const member = await makeUser({
                workspaceId: admin.workspaceId,
                role: "member",
            });

            await client.post(PATH(member.id));

            const acts = await activityFor(member.id);
            expect(acts).toHaveLength(1);
            expect(acts[0].action).toBe("deactivated");
            expect(acts[0].entityType).toBe("user");
            expect(acts[0].actorId).toBe(admin.id);
            expect(acts[0].context).toMatchObject({ from: "active" });
        });
    });

    // ─── m. Cleanup / rollback ────────────────────────────────────────────────
    describe("Cleanup / rollback", () => {
        it("writes no activity row when deactivation is forbidden (owner target)", async () => {
            const { admin, client } = await adminClient();
            const owner = await makeUser({
                workspaceId: admin.workspaceId,
                role: "owner",
            });

            await client.post(PATH(owner.id));

            expect(await activityFor(owner.id)).toHaveLength(0);
        });
    });

    // ─── n. Cross-cutting ─────────────────────────────────────────────────────
    describe("Cross-cutting", () => {
        it("returns an X-Request-Id header even on the 204", async () => {
            const { admin, client } = await adminClient();
            const member = await makeUser({
                workspaceId: admin.workspaceId,
                role: "member",
            });

            const res = await client.post(PATH(member.id));

            expect(res.status).toBe(204);
            expect(res.headers["x-request-id"]).toMatch(/^req_/);
        });
    });
});
