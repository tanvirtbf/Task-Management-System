import jwt from "jsonwebtoken";
import { eq } from "drizzle-orm";
import { oneOff } from "../test-utils/app";
import { makeLoggedInClient, makeUser } from "../test-utils/factories";
import { getDb } from "../../src/db/client";
import { users, workspaceActivity } from "../../src/db/schema";
import { Config } from "../../src/config";
import type { Role } from "../../src/constants";

/**
 * Tests for `POST /api/v1/users/:id/reactivate` (§4 #7) — the inverse of #6.
 *
 * 👑 admin/owner only (coarse gate = `canAccess` → 403 `auth.forbidden`). Only
 * the `deactivated → active` transition writes. Row rules: you cannot reactivate
 * yourself; a still-`invited` user is not reactivatable (409). Returns 204.
 *
 * N/A categories (documented): pagination; validation body (only the `:id`
 * param); ETag/Idempotency-Key (an already-active reactivate is a 204 no-op).
 */

jest.setTimeout(30_000);

const PATH = (id: string) => `/api/v1/users/${id}/reactivate`;
const DEACTIVATE = (id: string) => `/api/v1/users/${id}/deactivate`;

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

const adminClient = async (role: Role = "admin") => {
    const admin = await makeUser({ role });
    const client = await makeLoggedInClient(admin);
    return { admin, client };
};

// ════════════════════════════════════════════════════════════════════════════
describe("POST /api/v1/users/:id/reactivate", () => {
    // ─── a. Happy path ──────────────────────────────────────────────────────
    describe("Happy path", () => {
        it("lets an admin reactivate a deactivated member (204)", async () => {
            const { admin, client } = await adminClient();
            const member = await makeUser({
                workspaceId: admin.workspaceId,
                role: "member",
                status: "deactivated",
            });

            const res = await client.post(PATH(member.id));

            expect(res.status).toBe(204);
            expect(Object.keys(res.body)).toHaveLength(0);
            expect((await userById(member.id)).status).toBe("active");
        });

        it("lets an owner reactivate a deactivated member (204)", async () => {
            const { admin: owner, client } = await adminClient("owner");
            const member = await makeUser({
                workspaceId: owner.workspaceId,
                role: "member",
                status: "deactivated",
            });

            const res = await client.post(PATH(member.id));

            expect(res.status).toBe(204);
            expect((await userById(member.id)).status).toBe("active");
        });

        it("round-trips a deactivate → reactivate back to active", async () => {
            const { admin, client } = await adminClient();
            const member = await makeUser({
                workspaceId: admin.workspaceId,
                role: "member",
            });

            const off = await client.post(DEACTIVATE(member.id));
            expect(off.status).toBe(204);
            expect((await userById(member.id)).status).toBe("deactivated");

            const on = await client.post(PATH(member.id));
            expect(on.status).toBe(204);
            expect((await userById(member.id)).status).toBe("active");
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
            it(`forbids a ${role} from reactivating (403 auth.forbidden)`, async () => {
                const caller = await makeUser({ role });
                const target = await makeUser({
                    workspaceId: caller.workspaceId,
                    role: "member",
                    status: "deactivated",
                });
                const client = await makeLoggedInClient(caller);

                const res = await client.post(PATH(target.id));

                expect(res.status).toBe(403);
                expect(res.body.error.code).toBe("auth.forbidden");
                expect((await userById(target.id)).status).toBe("deactivated");
            });
        }
    });

    // ─── Row-level rules ──────────────────────────────────────────────────────
    describe("Row-level rules", () => {
        it("403 user.cannot_self_reactivate when an admin targets themselves", async () => {
            const { admin, client } = await adminClient();

            const res = await client.post(PATH(admin.id));

            expect(res.status).toBe(403);
            expect(res.body.error.code).toBe("user.cannot_self_reactivate");
        });

        it("blocks a deactivated admin (live token) from reviving themselves", async () => {
            // The self-guard closes the ≤15-min access-token window.
            const admin = await makeUser({
                role: "admin",
                status: "deactivated",
            });
            const client = await makeLoggedInClient(admin);

            const res = await client.post(PATH(admin.id));

            expect(res.status).toBe(403);
            expect(res.body.error.code).toBe("user.cannot_self_reactivate");
            expect((await userById(admin.id)).status).toBe("deactivated");
        });

        it("returns 404 user.not_found for an id that exists nowhere", async () => {
            const { client } = await adminClient();

            const res = await client.post(PATH("u-nope"));

            expect(res.status).toBe(404);
            expect(res.body.error.code).toBe("user.not_found");
        });
    });

    // ─── Status handling ──────────────────────────────────────────────────────
    describe("Status handling", () => {
        it("is a 204 no-op (no audit row) when the user is already active", async () => {
            const { admin, client } = await adminClient();
            const member = await makeUser({
                workspaceId: admin.workspaceId,
                role: "member",
                status: "active",
            });

            const res = await client.post(PATH(member.id));

            expect(res.status).toBe(204);
            expect((await userById(member.id)).status).toBe("active");
            expect(await activityFor(member.id)).toHaveLength(0);
        });

        it("409 user.not_deactivated when the user is still invited", async () => {
            const { admin, client } = await adminClient();
            const invited = await makeUser({
                workspaceId: admin.workspaceId,
                role: "member",
                status: "invited",
            });

            const res = await client.post(PATH(invited.id));

            expect(res.status).toBe(409);
            expect(res.body.error.code).toBe("user.not_deactivated");
            expect((await userById(invited.id)).status).toBe("invited");
            expect(await activityFor(invited.id)).toHaveLength(0);
        });
    });

    // ─── g. Tenant / workspace isolation ──────────────────────────────────────
    describe("Workspace isolation", () => {
        it("returns 404 when an admin targets a user in another workspace", async () => {
            const { client } = await adminClient(); // workspace 1
            const ws2User = await makeUser({
                role: "member",
                status: "deactivated",
            }); // workspace 2

            const res = await client.post(PATH(ws2User.id));

            expect(res.status).toBe(404);
            expect(res.body.error.code).toBe("user.not_found");
            expect((await userById(ws2User.id)).status).toBe("deactivated");
        });
    });

    // ─── i. Concurrency ───────────────────────────────────────────────────────
    describe("Concurrency", () => {
        it("two parallel reactivations both succeed and leave the user active", async () => {
            const { admin, client } = await adminClient();
            const member = await makeUser({
                workspaceId: admin.workspaceId,
                role: "member",
                status: "deactivated",
            });

            const [a, b] = await Promise.all([
                client.post(PATH(member.id)),
                client.post(PATH(member.id)),
            ]);

            expect(a.status).toBe(204);
            expect(b.status).toBe(204);
            expect((await userById(member.id)).status).toBe("active");
        });

        it("two parallel reactivations write exactly one audit row (no-op under lock)", async () => {
            // Regression: the no-op guard is re-checked under a FOR UPDATE lock.
            const { admin, client } = await adminClient();
            const member = await makeUser({
                workspaceId: admin.workspaceId,
                role: "member",
                status: "deactivated",
            });

            const [a, b] = await Promise.all([
                client.post(PATH(member.id)),
                client.post(PATH(member.id)),
            ]);

            expect(a.status).toBe(204);
            expect(b.status).toBe(204);
            const acts = (await activityFor(member.id)).filter(
                (r) => r.action === "reactivated",
            );
            expect(acts).toHaveLength(1);
        });
    });

    // ─── l. Side effects ──────────────────────────────────────────────────────
    describe("Side effects", () => {
        it("writes a 'reactivated' activity row with the prior status", async () => {
            const { admin, client } = await adminClient();
            const member = await makeUser({
                workspaceId: admin.workspaceId,
                role: "member",
                status: "deactivated",
            });

            await client.post(PATH(member.id));

            const acts = await activityFor(member.id);
            expect(acts).toHaveLength(1);
            expect(acts[0].action).toBe("reactivated");
            expect(acts[0].entityType).toBe("user");
            expect(acts[0].actorId).toBe(admin.id);
            expect(acts[0].context).toMatchObject({ from: "deactivated" });
        });
    });

    // ─── m. Cleanup / rollback ────────────────────────────────────────────────
    describe("Cleanup / rollback", () => {
        it("writes no activity row when reactivation is rejected (invited)", async () => {
            const { admin, client } = await adminClient();
            const invited = await makeUser({
                workspaceId: admin.workspaceId,
                role: "member",
                status: "invited",
            });

            await client.post(PATH(invited.id));

            expect(await activityFor(invited.id)).toHaveLength(0);
        });
    });

    // ─── n. Cross-cutting ─────────────────────────────────────────────────────
    describe("Cross-cutting", () => {
        it("returns an X-Request-Id header even on the 204", async () => {
            const { admin, client } = await adminClient();
            const member = await makeUser({
                workspaceId: admin.workspaceId,
                role: "member",
                status: "deactivated",
            });

            const res = await client.post(PATH(member.id));

            expect(res.status).toBe(204);
            expect(res.headers["x-request-id"]).toMatch(/^req_/);
        });
    });
});
