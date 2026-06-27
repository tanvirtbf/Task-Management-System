import bcrypt from "bcrypt";
import { eq } from "drizzle-orm";
import { oneOff } from "../test-utils/app";
import { makeUser, makeWorkspace } from "../test-utils/factories";
import { getDb } from "../../src/db/client";
import { invitations, users } from "../../src/db/schema";
import { fakeId, randomToken, sha256 } from "../../src/utils";

/**
 * Tests for the invitation-accept flow (§2):
 *   - GET  /api/v1/auth/invitation/:token   — public summary for the landing page
 *   - POST /api/v1/auth/accept-invitation    — public; the token is the credential
 *
 * Background: `POST /users/invite` (§4) already created the invited `users` row
 * (status `invited`, no real password) and the matching `invitations` token row.
 * Accept sets that user's first password (bcrypt), flips them `invited → active`,
 * single-use-consumes the invitation (`accepted_at`/`accepted_by`), and
 * auto-logs-them-in (a fresh session + `bb_refresh` cookie + access token, like
 * /login). Errors are clear: 404 not_found / 409 already_accepted / 410 expired.
 *
 * Patterns mirror the sibling auth suites: real DB writes via factories,
 * stateless `oneOff()` (the endpoint is public — no prior cookies), and
 * `setup-each-auth.ts` truncates users/sessions/invitations/etc. per test. All
 * limiters are no-ops under NODE_ENV=test.
 */

jest.setTimeout(30_000);

const ACCEPT = "/api/v1/auth/accept-invitation";
const details = (token: string) => `/api/v1/auth/invitation/${token}`;
const LOGIN = "/api/v1/auth/login";
const ME = "/api/v1/auth/me";
const PASSWORD = "Acc3pted#Pass";

const post = async (body: Record<string, unknown>) =>
    (await oneOff()).post(ACCEPT).send(body);
const login = async (email: string, password: string) =>
    (await oneOff()).post(LOGIN).send({ email, password });

/**
 * Reproduce the post-invite state: a workspace, an active inviter, an INVITED
 * user row, and a matching invitation. Returns the RAW token (what the email
 * link carries) plus the ids the assertions need.
 */
const makeInvitation = async (
    opts: {
        role?: "admin" | "member" | "guest";
        email?: string;
        expiresAt?: Date;
        acceptedAt?: Date | null;
        userStatus?: "invited" | "active" | "deactivated";
    } = {},
) => {
    const ws = await makeWorkspace();
    const inviter = await makeUser({ workspaceId: ws.id, role: "owner" });
    const email = opts.email ?? `invitee-${fakeId("z").slice(2, 9)}@example.test`;
    const role = opts.role ?? "member";
    const invited = await makeUser({
        workspaceId: ws.id,
        email,
        role,
        status: opts.userStatus ?? "invited",
    });
    const rawToken = randomToken();
    const invitationId = fakeId("inv");
    await getDb()
        .insert(invitations)
        .values({
            id: invitationId,
            workspaceId: ws.id,
            email,
            role,
            tokenHash: sha256(rawToken),
            invitedBy: inviter.id,
            expiresAt: opts.expiresAt ?? new Date(Date.now() + 7 * 24 * 3600 * 1000),
            acceptedAt: opts.acceptedAt ?? null,
        });
    return {
        rawToken,
        invitationId,
        workspaceId: ws.id,
        invitedUserId: invited.id,
        email,
        role,
    };
};

const readUser = async (id: string) => {
    const [row] = await getDb()
        .select({ status: users.status, passwordHash: users.passwordHash })
        .from(users)
        .where(eq(users.id, id))
        .limit(1);
    return row;
};

const readInvitation = async (id: string) => {
    const [row] = await getDb()
        .select({
            acceptedAt: invitations.acceptedAt,
            acceptedBy: invitations.acceptedBy,
        })
        .from(invitations)
        .where(eq(invitations.id, id))
        .limit(1);
    return row;
};

const bbRefreshLine = (res: { headers: Record<string, unknown> }): string | null => {
    const sc = res.headers["set-cookie"];
    const list = Array.isArray(sc) ? sc : typeof sc === "string" ? [sc] : [];
    return list.find((c: string) => c.startsWith("bb_refresh=")) ?? null;
};

describe("POST /api/v1/auth/accept-invitation", () => {
    // ─── Happy path ───────────────────────────────────────────────────────────
    it("accepts a valid invitation (200) and auto-logs-in with a usable token", async () => {
        const inv = await makeInvitation();

        const res = await post({ token: inv.rawToken, password: PASSWORD });

        expect(res.status).toBe(200);
        expect(typeof res.body.access_token).toBe("string");
        expect(res.body.expires_in).toBe(900);
        expect(res.body.user.email).toBe(inv.email);
        expect(res.body.user.status).toBe("active");
        // Sets the bb_refresh cookie (httpOnly, scoped to /api/v1/auth) like /login.
        const cookie = bbRefreshLine(res);
        expect(cookie).toContain("bb_refresh=");
        expect(cookie).toMatch(/HttpOnly/i);
        expect(cookie).toMatch(/Path=\/api\/v1\/auth/i);

        // The returned access token works immediately on a protected route.
        const me = await (await oneOff())
            .get(ME)
            .set("Authorization", `Bearer ${res.body.access_token}`);
        expect(me.status).toBe(200);
        expect(me.body.id).toBe(inv.invitedUserId);
    });

    it("flips the user to active, sets a bcrypt password, and consumes the invite", async () => {
        const inv = await makeInvitation();

        await post({ token: inv.rawToken, password: PASSWORD });

        const user = await readUser(inv.invitedUserId);
        expect(user.status).toBe("active");
        expect(await bcrypt.compare(PASSWORD, user.passwordHash)).toBe(true);

        const invitation = await readInvitation(inv.invitationId);
        expect(invitation.acceptedAt).not.toBeNull();
        expect(invitation.acceptedBy).toBe(inv.invitedUserId);
    });

    it("lets the user log in with the new password afterwards (and not before)", async () => {
        const inv = await makeInvitation();

        // Before accept: status is `invited`, so login is refused.
        expect((await login(inv.email, PASSWORD)).status).toBe(401);

        await post({ token: inv.rawToken, password: PASSWORD });

        // After accept: the freshly-set password logs in.
        expect((await login(inv.email, PASSWORD)).status).toBe(200);
    });

    it("preserves the invited role on the activated account (admin invite → admin)", async () => {
        const inv = await makeInvitation({ role: "admin" });

        const res = await post({ token: inv.rawToken, password: PASSWORD });

        expect(res.status).toBe(200);
        expect(res.body.user.role).toBe("admin");
    });

    // ─── Errors ───────────────────────────────────────────────────────────────
    it("returns 404 invitation.not_found for an unknown token", async () => {
        const res = await post({ token: randomToken(), password: PASSWORD });
        expect(res.status).toBe(404);
        expect(res.body.error.code).toBe("invitation.not_found");
    });

    it("returns 410 invitation.expired for an expired token", async () => {
        const inv = await makeInvitation({
            expiresAt: new Date(Date.now() - 60_000),
        });
        const res = await post({ token: inv.rawToken, password: PASSWORD });
        expect(res.status).toBe(410);
        expect(res.body.error.code).toBe("invitation.expired");
    });

    it("returns 409 invitation.already_accepted for a consumed invitation", async () => {
        const inv = await makeInvitation({ acceptedAt: new Date() });
        const res = await post({ token: inv.rawToken, password: PASSWORD });
        expect(res.status).toBe(409);
        expect(res.body.error.code).toBe("invitation.already_accepted");
    });

    it("returns 409 when the underlying user is already active", async () => {
        const inv = await makeInvitation({ userStatus: "active" });
        const res = await post({ token: inv.rawToken, password: PASSWORD });
        expect(res.status).toBe(409);
        expect(res.body.error.code).toBe("invitation.already_accepted");
    });

    it("is single-use — the second accept of the same token is 409", async () => {
        const inv = await makeInvitation();

        const first = await post({ token: inv.rawToken, password: PASSWORD });
        const second = await post({ token: inv.rawToken, password: "An0ther#Pass" });

        expect(first.status).toBe(200);
        expect(second.status).toBe(409);
        expect(second.body.error.code).toBe("invitation.already_accepted");
    });

    // ─── Validation ───────────────────────────────────────────────────────────
    it("returns 422 when the token is missing", async () => {
        const res = await post({ password: PASSWORD });
        expect(res.status).toBe(422);
        expect(res.body.error.code).toBe("validation.failed");
    });

    it("returns 422 when the password is missing", async () => {
        const inv = await makeInvitation();
        const res = await post({ token: inv.rawToken });
        expect(res.status).toBe(422);
        expect(res.body.error.code).toBe("validation.failed");
    });

    it("returns 422 for a too-short (<8) password", async () => {
        const inv = await makeInvitation();
        const res = await post({ token: inv.rawToken, password: "short7!" });
        expect(res.status).toBe(422);
        expect(res.body.error.code).toBe("validation.failed");
    });
});

describe("GET /api/v1/auth/invitation/:token", () => {
    it("returns the invitation summary for a valid pending token", async () => {
        const inv = await makeInvitation({ role: "guest" });

        const res = await (await oneOff()).get(details(inv.rawToken));

        expect(res.status).toBe(200);
        expect(res.body.email).toBe(inv.email);
        expect(res.body.role).toBe("guest");
        expect(typeof res.body.workspace_name).toBe("string");
        // Never leaks any token/hash.
        expect(JSON.stringify(res.body)).not.toContain(inv.rawToken);
    });

    it("returns 404 invitation.not_found for an unknown token", async () => {
        const res = await (await oneOff()).get(details(randomToken()));
        expect(res.status).toBe(404);
        expect(res.body.error.code).toBe("invitation.not_found");
    });

    it("returns 410 invitation.expired for an expired token", async () => {
        const inv = await makeInvitation({
            expiresAt: new Date(Date.now() - 60_000),
        });
        const res = await (await oneOff()).get(details(inv.rawToken));
        expect(res.status).toBe(410);
        expect(res.body.error.code).toBe("invitation.expired");
    });

    it("returns 409 invitation.already_accepted for a consumed token", async () => {
        const inv = await makeInvitation({ acceptedAt: new Date() });
        const res = await (await oneOff()).get(details(inv.rawToken));
        expect(res.status).toBe(409);
        expect(res.body.error.code).toBe("invitation.already_accepted");
    });
});
