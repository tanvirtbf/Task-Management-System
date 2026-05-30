import jwt from "jsonwebtoken";
import { eq } from "drizzle-orm";
import { oneOff } from "../test-utils/app";
import { makeLoggedInClient, makeUser } from "../test-utils/factories";
import { getDb } from "../../src/db/client";
import {
    users,
    workspaceActivity,
    passwordResetTokens,
} from "../../src/db/schema";
import { Config } from "../../src/config";
import { MailService } from "../../src/services/MailService";
import { sha256 } from "../../src/utils";
import type { Role } from "../../src/constants";

/**
 * Tests for `POST /api/v1/users/:id/reset-password` (§4 #8) — admin-initiated
 * reset, "same flow as forgot-password".
 *
 * 👑 admin/owner only (coarse gate = `canAccess` → 403 `auth.forbidden`). The
 * service mints a single-use reset token (invalidating prior links) and emails
 * the standard `/reset-password/<token>` link; only ACTIVE users are eligible
 * (else 409 `user.not_active`). Returns 202. `MailService.sendPasswordResetEmail`
 * is spied — tests assert it was handed the recipient + a reset URL, never that
 * a real email left the process.
 *
 * N/A categories (documented): pagination; validation body (only the `:id`
 * param); ETag/Idempotency-Key (a repeat just mints a fresh token + 202).
 */

jest.setTimeout(30_000);

const PATH = (id: string) => `/api/v1/users/${id}/reset-password`;

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

const activityFor = async (entityId: string) => {
    const db = getDb();
    return db
        .select()
        .from(workspaceActivity)
        .where(eq(workspaceActivity.entityId, entityId));
};

const resetTokensFor = async (userId: string) => {
    const db = getDb();
    return db
        .select()
        .from(passwordResetTokens)
        .where(eq(passwordResetTokens.userId, userId));
};

const adminClient = async (role: Role = "admin") => {
    const admin = await makeUser({ role });
    const client = await makeLoggedInClient(admin);
    return { admin, client };
};

let mailSpy: jest.SpyInstance;

beforeEach(() => {
    mailSpy = jest
        .spyOn(MailService.prototype, "sendPasswordResetEmail")
        .mockResolvedValue(undefined);
});

afterEach(() => {
    mailSpy.mockRestore();
});

// ════════════════════════════════════════════════════════════════════════════
describe("POST /api/v1/users/:id/reset-password", () => {
    // ─── a. Happy path ──────────────────────────────────────────────────────
    describe("Happy path", () => {
        it("returns 202 with an empty body for an active member", async () => {
            const { admin, client } = await adminClient();
            const member = await makeUser({
                workspaceId: admin.workspaceId,
                role: "member",
                status: "active",
            });

            const res = await client.post(PATH(member.id));

            expect(res.status).toBe(202);
            expect(res.body).toEqual({});
        });

        it("lets an owner trigger a reset (202)", async () => {
            const { admin: owner, client } = await adminClient("owner");
            const member = await makeUser({
                workspaceId: owner.workspaceId,
                role: "member",
            });

            const res = await client.post(PATH(member.id));

            expect(res.status).toBe(202);
        });

        it("persists a single-use reset token holding only the hash", async () => {
            const { admin, client } = await adminClient();
            const member = await makeUser({
                workspaceId: admin.workspaceId,
                role: "member",
            });

            await client.post(PATH(member.id));

            const [row] = await resetTokensFor(member.id);
            expect(row).toBeDefined();
            expect(row.userId).toBe(member.id);
            expect(row.tokenHash).toMatch(/^[a-f0-9]{64}$/);
            expect(row.consumedAt).toBeNull();
            expect(row.expiresAt.getTime()).toBeGreaterThan(Date.now());
            // ≤ 30 min TTL (allow a little slack for runtime).
            expect(row.expiresAt.getTime()).toBeLessThanOrEqual(
                Date.now() + 31 * 60 * 1000,
            );
        });

        it("emails a /reset-password/<token> link whose hash matches the row", async () => {
            const { admin, client } = await adminClient();
            const member = await makeUser({
                workspaceId: admin.workspaceId,
                role: "member",
            });

            await client.post(PATH(member.id));

            expect(mailSpy).toHaveBeenCalledTimes(1);
            const [to, url] = mailSpy.mock.calls[0] as [string, string];
            expect(to).toBe(member.email);
            expect(url).toContain("/reset-password/");
            const token = url.split("/reset-password/")[1];
            expect(token.length).toBeGreaterThan(0);
            const [row] = await resetTokensFor(member.id);
            expect(row.tokenHash).toBe(sha256(token));
        });

        it("invalidates any prior outstanding link (keeps one active token)", async () => {
            const { admin, client } = await adminClient();
            const member = await makeUser({
                workspaceId: admin.workspaceId,
                role: "member",
            });

            await client.post(PATH(member.id));
            await client.post(PATH(member.id));

            const rows = await resetTokensFor(member.id);
            expect(rows).toHaveLength(1); // prior unconsumed token deleted
        });

        it("allows an admin to reset their OWN password (no self-block)", async () => {
            const { admin, client } = await adminClient();

            const res = await client.post(PATH(admin.id));

            expect(res.status).toBe(202);
            expect(await resetTokensFor(admin.id)).toHaveLength(1);
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
            it(`forbids a ${role} from triggering a reset (403 auth.forbidden)`, async () => {
                const caller = await makeUser({ role });
                const target = await makeUser({
                    workspaceId: caller.workspaceId,
                    role: "member",
                });
                const client = await makeLoggedInClient(caller);

                const res = await client.post(PATH(target.id));

                expect(res.status).toBe(403);
                expect(res.body.error.code).toBe("auth.forbidden");
                expect(await resetTokensFor(target.id)).toHaveLength(0);
                expect(mailSpy).not.toHaveBeenCalled();
            });
        }
    });

    // ─── e. Resource lifecycle / status guard ─────────────────────────────────
    describe("Status guard", () => {
        it("returns 404 user.not_found for an id that exists nowhere", async () => {
            const { client } = await adminClient();

            const res = await client.post(PATH("u-nope"));

            expect(res.status).toBe(404);
            expect(res.body.error.code).toBe("user.not_found");
            expect(mailSpy).not.toHaveBeenCalled();
        });

        it("409 user.not_active for an invited (no-password-yet) user", async () => {
            const { admin, client } = await adminClient();
            const invited = await makeUser({
                workspaceId: admin.workspaceId,
                role: "member",
                status: "invited",
            });

            const res = await client.post(PATH(invited.id));

            expect(res.status).toBe(409);
            expect(res.body.error.code).toBe("user.not_active");
            expect(await resetTokensFor(invited.id)).toHaveLength(0);
            expect(mailSpy).not.toHaveBeenCalled();
        });

        it("409 user.not_active for a deactivated user", async () => {
            const { admin, client } = await adminClient();
            const off = await makeUser({
                workspaceId: admin.workspaceId,
                role: "member",
                status: "deactivated",
            });

            const res = await client.post(PATH(off.id));

            expect(res.status).toBe(409);
            expect(res.body.error.code).toBe("user.not_active");
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
            expect(await resetTokensFor(ws2User.id)).toHaveLength(0);
        });
    });

    // ─── i. Concurrency ───────────────────────────────────────────────────────
    describe("Concurrency", () => {
        it("two parallel resets both succeed and leave the user with a usable token", async () => {
            const { admin, client } = await adminClient();
            const member = await makeUser({
                workspaceId: admin.workspaceId,
                role: "member",
            });

            const [a, b] = await Promise.all([
                client.post(PATH(member.id)),
                client.post(PATH(member.id)),
            ]);

            expect(a.status).toBe(202);
            expect(b.status).toBe(202);
            expect(
                (await resetTokensFor(member.id)).length,
            ).toBeGreaterThanOrEqual(1);
        });
    });

    // ─── l. Side effects ──────────────────────────────────────────────────────
    describe("Side effects", () => {
        it("writes a 'password_reset_requested' activity row", async () => {
            const { admin, client } = await adminClient();
            const member = await makeUser({
                workspaceId: admin.workspaceId,
                role: "member",
            });

            await client.post(PATH(member.id));

            const acts = await activityFor(member.id);
            expect(acts).toHaveLength(1);
            expect(acts[0].action).toBe("password_reset_requested");
            expect(acts[0].entityType).toBe("user");
            expect(acts[0].actorId).toBe(admin.id);
        });

        it("does not change the user's password_hash (reset only mints a token)", async () => {
            const { admin, client } = await adminClient();
            const member = await makeUser({
                workspaceId: admin.workspaceId,
                role: "member",
            });
            const db = getDb();
            const [before] = await db
                .select()
                .from(users)
                .where(eq(users.id, member.id));

            await client.post(PATH(member.id));

            const [after] = await db
                .select()
                .from(users)
                .where(eq(users.id, member.id));
            expect(after.passwordHash).toBe(before.passwordHash);
        });
    });

    // ─── Email dispatch resilience ────────────────────────────────────────────
    describe("Email dispatch", () => {
        it("still returns 202 (and keeps the token) when the mailer throws", async () => {
            mailSpy.mockRejectedValueOnce(new Error("smtp down"));
            const { admin, client } = await adminClient();
            const member = await makeUser({
                workspaceId: admin.workspaceId,
                role: "member",
            });

            const res = await client.post(PATH(member.id));

            expect(res.status).toBe(202);
            expect(await resetTokensFor(member.id)).toHaveLength(1);
        });
    });

    // ─── m. Cleanup / rollback ────────────────────────────────────────────────
    describe("Cleanup / rollback", () => {
        it("mints no token and writes no activity row when rejected (invited)", async () => {
            const { admin, client } = await adminClient();
            const invited = await makeUser({
                workspaceId: admin.workspaceId,
                role: "member",
                status: "invited",
            });

            await client.post(PATH(invited.id));

            expect(await resetTokensFor(invited.id)).toHaveLength(0);
            expect(await activityFor(invited.id)).toHaveLength(0);
        });
    });

    // ─── n. Cross-cutting ─────────────────────────────────────────────────────
    describe("Cross-cutting", () => {
        it("responds as application/json with an X-Request-Id header", async () => {
            const { admin, client } = await adminClient();
            const member = await makeUser({
                workspaceId: admin.workspaceId,
                role: "member",
            });

            const res = await client.post(PATH(member.id));

            expect(res.status).toBe(202);
            expect(res.headers["content-type"]).toMatch(/application\/json/);
            expect(res.headers["x-request-id"]).toMatch(/^req_/);
        });
    });
});
