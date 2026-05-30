import jwt from "jsonwebtoken";
import { eq } from "drizzle-orm";
import { oneOff } from "../test-utils/app";
import {
    makeLoggedInClient,
    makeUser,
    makeWorkspace,
} from "../test-utils/factories";
import { getDb } from "../../src/db/client";
import { users, invitations, workspaceActivity } from "../../src/db/schema";
import { Config } from "../../src/config";
import { MailService } from "../../src/services/MailService";
import { sha256 } from "../../src/utils";
import type { Role } from "../../src/constants";

/**
 * Tests for `POST /api/v1/users/invite` (§4 #3) — the first 👑 write in §4.
 *
 * Patterns mirror `tests/users/list.test.ts` + `tests/tags` (the sibling 👑
 * create): real DB writes via factories, `makeLoggedInClient` for authed calls,
 * `oneOff()` for negative-auth, `beforeEach` truncates every table.
 *
 * `MailService.sendInvitation` is spied (the V1 log transport would otherwise
 * just emit a debug line); tests assert it was handed the recipient + an
 * `/invitation/<token>` URL, never that a real email left the process.
 *
 * N/A categories (documented): pagination (single resource); ETag/If-Match
 * (create, no optimistic lock); Idempotency-Key (no idempotency layer yet —
 * a retried invite of the same email is a safe 409, not a duplicate).
 */

jest.setTimeout(30_000);

const PATH = "/api/v1/users/invite";

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

interface InviteBody {
    first_name?: unknown;
    last_name?: unknown;
    email?: unknown;
    role?: unknown;
}

const validBody = (overrides: InviteBody = {}): InviteBody => ({
    first_name: "Rahim",
    last_name: "Uddin",
    email: "newhire@seed.test",
    role: "member",
    ...overrides,
});

/** Mint a raw access token for the negative-auth cases. */
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

const usersWithEmail = async (email: string) => {
    const db = getDb();
    return db.select().from(users).where(eq(users.email, email));
};

const invitationsWithEmail = async (email: string) => {
    const db = getDb();
    return db.select().from(invitations).where(eq(invitations.email, email));
};

const countWorkspaceActivity = async (): Promise<number> => {
    const db = getDb();
    return (
        await db.select({ id: workspaceActivity.id }).from(workspaceActivity)
    ).length;
};

let mailSpy: jest.SpyInstance;

beforeEach(() => {
    mailSpy = jest
        .spyOn(MailService.prototype, "sendInvitation")
        .mockResolvedValue(undefined);
});

afterEach(() => {
    mailSpy.mockRestore();
});

/** Build an admin caller + an authed client in a fresh workspace. */
const adminClient = async () => {
    const admin = await makeUser({ role: "admin" });
    const client = await makeLoggedInClient(admin);
    return { admin, client };
};

// ════════════════════════════════════════════════════════════════════════════
describe("POST /api/v1/users/invite", () => {
    // ─── a. Happy path ──────────────────────────────────────────────────────
    describe("Happy path", () => {
        it("returns 201 with a bare invited User (10 wire fields)", async () => {
            const { client } = await adminClient();

            const res = await client.post(PATH).send(validBody());

            expect(res.status).toBe(201);
            expect(Object.keys(res.body).sort()).toEqual(EXPECTED_KEYS);
            expect(res.body).toMatchObject({
                first_name: "Rahim",
                last_name: "Uddin",
                email: "newhire@seed.test",
                role: "member",
                status: "invited",
                avatar_url: null,
                last_login_at: null,
            });
            expect(res.body.created_at).toMatch(
                /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/,
            );
            expect(res.body).not.toHaveProperty("data");
        });

        it("allows an owner to invite (201)", async () => {
            const owner = await makeUser({ role: "owner" });
            const client = await makeLoggedInClient(owner);

            const res = await client.post(PATH).send(validBody());

            expect(res.status).toBe(201);
        });

        it("persists a pending users row in the caller's workspace", async () => {
            const { admin, client } = await adminClient();

            const res = await client.post(PATH).send(validBody());

            const [row] = await usersWithEmail("newhire@seed.test");
            expect(row.id).toBe(res.body.id);
            expect(row.workspaceId).toBe(admin.workspaceId);
            expect(row.status).toBe("invited");
            expect(row.role).toBe("member");
            // No password until the invitee accepts (§2 #10).
            expect(row.passwordHash).toBe("");
        });

        it("persists an invitation row holding only the token hash", async () => {
            const { admin, client } = await adminClient();

            await client.post(PATH).send(validBody({ role: "admin" }));

            const [inv] = await invitationsWithEmail("newhire@seed.test");
            expect(inv.workspaceId).toBe(admin.workspaceId);
            expect(inv.role).toBe("admin");
            expect(inv.invitedBy).toBe(admin.id);
            expect(inv.acceptedAt).toBeNull();
            expect(inv.tokenHash).toMatch(/^[a-f0-9]{64}$/);
            expect(inv.expiresAt.getTime()).toBeGreaterThan(Date.now());
        });

        it("records a workspace_activity 'invited' row for the new user", async () => {
            const { admin, client } = await adminClient();

            const res = await client.post(PATH).send(validBody());

            const db = getDb();
            const [act] = await db
                .select()
                .from(workspaceActivity)
                .where(eq(workspaceActivity.entityId, res.body.id));
            expect(act.entityType).toBe("user");
            expect(act.action).toBe("invited");
            expect(act.actorId).toBe(admin.id);
            expect(act.workspaceId).toBe(admin.workspaceId);
        });

        it("emails an /invitation/<token> accept link to the invitee", async () => {
            const { client } = await adminClient();

            await client.post(PATH).send(validBody());

            expect(mailSpy).toHaveBeenCalledTimes(1);
            const [to, acceptUrl] = mailSpy.mock.calls[0];
            expect(to).toBe("newhire@seed.test");
            expect(acceptUrl).toContain("/invitation/");
            // The raw token (not its hash) is the URL's last segment, and the
            // persisted hash is sha256 of it.
            const token = String(acceptUrl).split("/invitation/")[1];
            expect(token.length).toBeGreaterThan(0);
            const [inv] = await invitationsWithEmail("newhire@seed.test");
            expect(inv.tokenHash).toBe(sha256(token));
        });

        it("lowercases the email before storing and returning it", async () => {
            const { client } = await adminClient();

            const res = await client
                .post(PATH)
                .send(validBody({ email: "MixedCase@Seed.TEST" }));

            expect(res.status).toBe(201);
            expect(res.body.email).toBe("mixedcase@seed.test");
            expect(await usersWithEmail("mixedcase@seed.test")).toHaveLength(1);
        });

        const roles: Array<"admin" | "member" | "guest"> = [
            "admin",
            "member",
            "guest",
        ];
        for (const role of roles) {
            it(`accepts the invitable role "${role}" (201)`, async () => {
                const { client } = await adminClient();

                const res = await client
                    .post(PATH)
                    .send(validBody({ email: `${role}@seed.test`, role }));

                expect(res.status).toBe(201);
                expect(res.body.role).toBe(role);
            });
        }
    });

    // ─── b. Leak guards ──────────────────────────────────────────────────────
    describe("Leak guards", () => {
        it("never leaks password_hash, workspace_id, updated_at, or a token", async () => {
            const { client } = await adminClient();

            const res = await client.post(PATH).send(validBody());

            for (const k of [
                "password_hash",
                "passwordHash",
                "workspace_id",
                "workspaceId",
                "updated_at",
                "token",
                "token_hash",
            ]) {
                expect(res.body).not.toHaveProperty(k);
            }
        });
    });

    // ─── c. Validation (422 validation.failed) ───────────────────────────────
    describe("Validation", () => {
        const cases: Array<{ name: string; body: InviteBody; field: string }> =
            [
                { name: "missing first_name", body: { first_name: undefined }, field: "first_name" },
                { name: "empty first_name", body: { first_name: "" }, field: "first_name" },
                { name: "whitespace first_name", body: { first_name: "   " }, field: "first_name" },
                { name: "over-long first_name", body: { first_name: "a".repeat(81) }, field: "first_name" },
                { name: "missing last_name", body: { last_name: undefined }, field: "last_name" },
                { name: "over-long last_name", body: { last_name: "b".repeat(81) }, field: "last_name" },
                { name: "missing email", body: { email: undefined }, field: "email" },
                { name: "malformed email", body: { email: "not-an-email" }, field: "email" },
                { name: "over-long email", body: { email: `${"x".repeat(300)}@seed.test` }, field: "email" },
                { name: "missing role", body: { role: undefined }, field: "role" },
                { name: "unknown role", body: { role: "superuser" }, field: "role" },
                { name: "owner role rejected", body: { role: "owner" }, field: "role" },
                { name: "wrong-case role", body: { role: "ADMIN" }, field: "role" },
            ];
        for (const c of cases) {
            it(`returns 422 for ${c.name}`, async () => {
                const { client } = await adminClient();

                const res = await client
                    .post(PATH)
                    .send(validBody(c.body));

                expect(res.status).toBe(422);
                expect(res.body.error.code).toBe("validation.failed");
                expect(
                    res.body.error.details.some(
                        (d: { field?: string }) => d.field === c.field,
                    ),
                ).toBe(true);
            });
        }

        it("accepts names at exactly the 80-char boundary (201)", async () => {
            const { client } = await adminClient();

            const res = await client.post(PATH).send(
                validBody({
                    first_name: "a".repeat(80),
                    last_name: "b".repeat(80),
                }),
            );

            expect(res.status).toBe(201);
        });

        it("does not email when validation fails", async () => {
            const { client } = await adminClient();

            await client.post(PATH).send(validBody({ role: "owner" }));

            expect(mailSpy).not.toHaveBeenCalled();
        });
    });

    // ─── d. Authentication (401) ─────────────────────────────────────────────
    describe("Authentication", () => {
        it("returns 401 auth.missing_token when no token is supplied", async () => {
            const http = await oneOff();

            const res = await http.post(PATH).send(validBody());

            expect(res.status).toBe(401);
            expect(res.body.error.code).toBe("auth.missing_token");
        });

        it("returns 401 auth.expired_token for an expired token", async () => {
            const admin = await makeUser({ role: "admin" });
            const token = signAccess(admin, Config.ACCESS_TOKEN_SECRET!, {
                expiresIn: -10,
            });
            const http = await oneOff();

            const res = await http
                .post(PATH)
                .set("Authorization", `Bearer ${token}`)
                .send(validBody());

            expect(res.status).toBe(401);
            expect(res.body.error.code).toBe("auth.expired_token");
        });
    });

    // ─── e. Authorization (👑 admin/owner only) ──────────────────────────────
    describe("Authorization", () => {
        const forbidden: Role[] = ["member", "guest"];
        for (const role of forbidden) {
            it(`forbids a ${role} from inviting (403 auth.forbidden)`, async () => {
                const caller = await makeUser({ role });
                const client = await makeLoggedInClient(caller);

                const res = await client.post(PATH).send(validBody());

                expect(res.status).toBe(403);
                expect(res.body.error.code).toBe("auth.forbidden");
            });
        }

        it("creates no rows and sends no email when forbidden", async () => {
            const caller = await makeUser({ role: "member" });
            const client = await makeLoggedInClient(caller);
            const before = await countWorkspaceActivity();

            await client.post(PATH).send(validBody());

            expect(await usersWithEmail("newhire@seed.test")).toHaveLength(0);
            expect(
                await invitationsWithEmail("newhire@seed.test"),
            ).toHaveLength(0);
            expect(await countWorkspaceActivity()).toBe(before);
            expect(mailSpy).not.toHaveBeenCalled();
        });

        it("checks the role before the body (403, not 422, on a bad body)", async () => {
            const caller = await makeUser({ role: "member" });
            const client = await makeLoggedInClient(caller);

            const res = await client
                .post(PATH)
                .send(validBody({ role: "owner", email: "bad" }));

            expect(res.status).toBe(403);
        });
    });

    // ─── f. Conflict (409 user.email_already_exists) ─────────────────────────
    describe("Conflict", () => {
        it("409 when the email belongs to an active user", async () => {
            const { admin, client } = await adminClient();
            await makeUser({
                workspaceId: admin.workspaceId,
                email: "taken@seed.test",
                status: "active",
            });

            const res = await client
                .post(PATH)
                .send(validBody({ email: "taken@seed.test" }));

            expect(res.status).toBe(409);
            expect(res.body.error.code).toBe("user.email_already_exists");
        });

        it("409 when the email is already invited (re-invite)", async () => {
            const { admin, client } = await adminClient();
            await makeUser({
                workspaceId: admin.workspaceId,
                email: "pending@seed.test",
                status: "invited",
            });

            const res = await client
                .post(PATH)
                .send(validBody({ email: "pending@seed.test" }));

            expect(res.status).toBe(409);
            expect(res.body.error.code).toBe("user.email_already_exists");
        });

        it("409 is case-insensitive on the email", async () => {
            const { admin, client } = await adminClient();
            await makeUser({
                workspaceId: admin.workspaceId,
                email: "case@seed.test",
                status: "active",
            });

            const res = await client
                .post(PATH)
                .send(validBody({ email: "CASE@seed.test" }));

            expect(res.status).toBe(409);
        });

        it("creates no invitation row and sends no email on conflict", async () => {
            const { admin, client } = await adminClient();
            await makeUser({
                workspaceId: admin.workspaceId,
                email: "taken@seed.test",
                status: "active",
            });

            await client.post(PATH).send(validBody({ email: "taken@seed.test" }));

            expect(
                await invitationsWithEmail("taken@seed.test"),
            ).toHaveLength(0);
            expect(mailSpy).not.toHaveBeenCalled();
        });
    });

    // ─── g. Tenant isolation ─────────────────────────────────────────────────
    describe("Workspace isolation", () => {
        it("lands the invite in the caller's workspace, ignoring a body workspace_id", async () => {
            const { admin, client } = await adminClient();
            const other = await makeWorkspace();

            const res = await client
                .post(PATH)
                .send({ ...validBody(), workspace_id: other.id });

            const [row] = await usersWithEmail("newhire@seed.test");
            expect(row.workspaceId).toBe(admin.workspaceId);
            expect(res.body.id).toBe(row.id);
        });

        it("409 when the email exists in another workspace (global uniqueness)", async () => {
            const { client } = await adminClient();
            const otherWs = await makeWorkspace();
            await makeUser({
                workspaceId: otherWs.id,
                email: "elsewhere@seed.test",
                status: "active",
            });

            const res = await client
                .post(PATH)
                .send(validBody({ email: "elsewhere@seed.test" }));

            expect(res.status).toBe(409);
            expect(res.body.error.code).toBe("user.email_already_exists");
        });
    });

    // ─── h. Security ─────────────────────────────────────────────────────────
    describe("Security", () => {
        it("ignores injected privileged fields (status/id/workspace_id/password_hash)", async () => {
            const { admin, client } = await adminClient();

            const res = await client.post(PATH).send({
                ...validBody(),
                status: "active",
                id: "u-hacked",
                workspace_id: "ws-hacked",
                password_hash: "pre-seeded",
            });

            expect(res.status).toBe(201);
            expect(res.body.id).not.toBe("u-hacked");
            expect(res.body.status).toBe("invited");
            const [row] = await usersWithEmail("newhire@seed.test");
            expect(row.workspaceId).toBe(admin.workspaceId);
            expect(row.passwordHash).toBe("");
        });

        it("treats a SQL-injection-shaped name as a literal (201, stored verbatim)", async () => {
            const { client } = await adminClient();
            const evil = "Robert'); DROP TABLE users;--";

            const res = await client
                .post(PATH)
                .send(validBody({ first_name: evil }));

            expect(res.status).toBe(201);
            expect(res.body.first_name).toBe(evil);
            // The table is intact and the row is present.
            expect(await usersWithEmail("newhire@seed.test")).toHaveLength(1);
        });

        it("round-trips a Unicode name intact", async () => {
            const { client } = await adminClient();

            const res = await client
                .post(PATH)
                .send(validBody({ first_name: "রহিম 🙂" }));

            expect(res.status).toBe(201);
            expect(res.body.first_name).toBe("রহিম 🙂");
        });
    });

    // ─── i. Concurrency ──────────────────────────────────────────────────────
    describe("Concurrency", () => {
        it("two parallel invites of the same email yield one 201 and one 409", async () => {
            const { client } = await adminClient();

            const [a, b] = await Promise.all([
                client.post(PATH).send(validBody({ email: "race@seed.test" })),
                client.post(PATH).send(validBody({ email: "race@seed.test" })),
            ]);

            expect([a.status, b.status].sort()).toEqual([201, 409]);
            expect(await usersWithEmail("race@seed.test")).toHaveLength(1);
        });
    });

    // ─── j. Email best-effort ────────────────────────────────────────────────
    describe("Email dispatch", () => {
        it("still returns 201 (and keeps the invitation) when the mailer throws", async () => {
            const { client } = await adminClient();
            mailSpy.mockRejectedValueOnce(new Error("smtp down"));

            const res = await client.post(PATH).send(validBody());

            expect(res.status).toBe(201);
            expect(await usersWithEmail("newhire@seed.test")).toHaveLength(1);
            expect(
                await invitationsWithEmail("newhire@seed.test"),
            ).toHaveLength(1);
        });
    });
});
