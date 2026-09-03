import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import { oneOff } from "../test-utils/app";
import {
    makeLoggedInClient,
    makeUser,
    makeWorkspace,
} from "../test-utils/factories";
import { Config } from "../../src/config";

/**
 * CAN A TOKEN BE FORGED?
 *
 * The plan asks P7 for `exp`/`nbf`/alg-confusion probes. The verification is
 * pinned to HS256 in `authenticate.ts` and the two token kinds use separate
 * secrets — both correct, and neither had a test. That gap is the familiar one:
 * `algorithms: ["HS256"]` is one array literal away from being deleted by
 * somebody tidying up, and nothing would notice until a forged token worked.
 *
 * Every probe here should be refused. A pass means the door is shut; the value
 * is that somebody now tries the handle on every run.
 */

jest.setTimeout(60_000);

const PROTECTED = "/api/v1/tasks/my-work";

const asToken = async (token: string) =>
    (await oneOff()).get(PROTECTED).set("Authorization", `Bearer ${token}`);

const claimsFor = async () => {
    const ws = await makeWorkspace();
    const user = await makeUser({ workspaceId: ws.id, role: "member" });
    return {
        user,
        payload: {
            sub: user.id,
            role: user.role,
            workspaceId: user.workspaceId,
        },
    };
};

describe("forged and malformed access tokens", () => {
    it("a REAL token still works — otherwise this file proves nothing", async () => {
        const { payload } = await claimsFor();
        const good = jwt.sign(payload, Config.ACCESS_TOKEN_SECRET as string, {
            algorithm: "HS256",
            expiresIn: "15m",
        });

        expect((await asToken(good)).status).toBe(200);
    });

    it('refuses alg "none" — the classic unsigned forgery', async () => {
        const { payload } = await claimsFor();
        // `jsonwebtoken` will not sign `none` with a secret, so build it by
        // hand exactly as an attacker would.
        const b64 = (o: unknown) =>
            Buffer.from(JSON.stringify(o))
                .toString("base64")
                .replace(/=/g, "")
                .replace(/\+/g, "-")
                .replace(/\//g, "_");
        const unsigned = `${b64({ alg: "none", typ: "JWT" })}.${b64({
            ...payload,
            exp: Math.floor(Date.now() / 1000) + 900,
        })}.`;

        const res = await asToken(unsigned);
        expect(res.status).toBe(401);
    });

    it("refuses an RS256 token — algorithm confusion", async () => {
        const { payload } = await claimsFor();
        const { privateKey } = crypto.generateKeyPairSync("rsa", {
            modulusLength: 2048,
        });
        const rsaSigned = jwt.sign(payload, privateKey, {
            algorithm: "RS256",
            expiresIn: "15m",
        });

        // Without `algorithms: ["HS256"]` pinned in `authenticate.ts`, a
        // verifier can be tricked into treating a public key as an HMAC secret.
        expect((await asToken(rsaSigned)).status).toBe(401);
    });

    it("refuses a token signed with the wrong secret", async () => {
        const { payload } = await claimsFor();
        const wrong = jwt.sign(payload, "not-the-real-secret", {
            algorithm: "HS256",
            expiresIn: "15m",
        });

        expect((await asToken(wrong)).status).toBe(401);
    });

    it("refuses a REFRESH token presented as an access token", async () => {
        const { payload } = await claimsFor();
        // The two kinds use separate secrets, which is what stops this. If they
        // ever converge, a long-lived refresh token becomes an access token.
        const refresh = jwt.sign(
            { ...payload, id: "ses-whatever" },
            Config.REFRESH_TOKEN_SECRET as string,
            { algorithm: "HS256", expiresIn: "7d" },
        );

        expect((await asToken(refresh)).status).toBe(401);
    });

    it("refuses a token whose payload was edited after signing", async () => {
        const { payload } = await claimsFor();
        const good = jwt.sign(payload, Config.ACCESS_TOKEN_SECRET as string, {
            algorithm: "HS256",
            expiresIn: "15m",
        });

        // Promote the member to owner and re-encode the middle segment,
        // keeping the original signature.
        const [head, body, sig] = good.split(".");
        const decoded = JSON.parse(
            Buffer.from(body, "base64").toString("utf8"),
        ) as Record<string, unknown>;
        decoded.role = "owner";
        const tampered = `${head}.${Buffer.from(JSON.stringify(decoded))
            .toString("base64")
            .replace(/=/g, "")
            .replace(/\+/g, "-")
            .replace(/\//g, "_")}.${sig}`;

        expect((await asToken(tampered)).status).toBe(401);
    });

    it("refuses an EXPIRED token", async () => {
        const { payload } = await claimsFor();
        const expired = jwt.sign(payload, Config.ACCESS_TOKEN_SECRET as string, {
            algorithm: "HS256",
            expiresIn: "-1m",
        });

        const res = await asToken(expired);
        expect(res.status).toBe(401);
        expect(res.body.error.code).toBe("auth.expired_token");
    });

    it("refuses a NOT-YET-VALID token (nbf in the future)", async () => {
        const { payload } = await claimsFor();
        const future = jwt.sign(
            { ...payload, nbf: Math.floor(Date.now() / 1000) + 3600 },
            Config.ACCESS_TOKEN_SECRET as string,
            { algorithm: "HS256", expiresIn: "2h" },
        );

        expect((await asToken(future)).status).toBe(401);
    });

    it.each([
        ["empty", ""],
        ["not a JWT", "hello"],
        ["two segments", "aaa.bbb"],
        ["four segments", "aaa.bbb.ccc.ddd"],
        ["only dots", "..."],
        ["base64 garbage", "eyJ.eyJ.aaa"],
    ])("refuses a malformed token (%s) without a 500", async (_label, token) => {
        const res = await asToken(token);
        expect(res.status).toBe(401);
    });

});

/**
 * ACCESS TOKENS ARE STATELESS — the window that creates, written down.
 *
 * `authenticate.ts` says it plainly: *"Access tokens are never checked against
 * the `sessions` table."* That is a deliberate design (verify the signature,
 * skip a database round-trip on every request) and F10 already tightened its
 * sharpest edge by making an `exp` claim mandatory — before that, an exp-less
 * token was an unrevocable credential.
 *
 * What remains is a WINDOW, not a defect, and the plan asks P7 to establish it
 * rather than guess: deactivating or deleting somebody does not stop the access
 * token already in their browser. It stops the next REFRESH. So the real answer
 * to "we removed their access" is "within 15 minutes", and whoever deactivates
 * a departing colleague should know that is the promise.
 */
describe("what a stateless access token means in practice", () => {
    it("a signature-valid token for a user who does not exist is ACCEPTED", async () => {
        const ghost = jwt.sign(
            {
                sub: "u-does-not-exist",
                role: "member",
                workspaceId: "ws-does-not-exist",
            },
            Config.ACCESS_TOKEN_SECRET as string,
            { algorithm: "HS256", expiresIn: "15m" },
        );

        // Nothing leaks — the workspace has no rows — but the request is
        // served. Authentication stops at the maths, by design.
        const res = await asToken(ghost);
        expect(res.status).toBe(200);
    });

    it("a DEACTIVATED user's existing token keeps working until it expires", async () => {
        const ws = await makeWorkspace();
        const admin = await makeUser({ workspaceId: ws.id, role: "admin" });
        const leaver = await makeUser({ workspaceId: ws.id, role: "member" });
        const adminClient = await makeLoggedInClient(admin);

        const token = jwt.sign(
            {
                sub: leaver.id,
                role: leaver.role,
                workspaceId: leaver.workspaceId,
            },
            Config.ACCESS_TOKEN_SECRET as string,
            { algorithm: "HS256", expiresIn: "15m" },
        );
        expect((await asToken(token)).status).toBe(200);

        const off = await adminClient.post(
            `/api/v1/users/${leaver.id}/deactivate`,
        );
        expect(off.status).toBeLessThan(300);

        // Still 200. This is the window: revocation lands at the next refresh,
        // not on the token already in their browser.
        expect((await asToken(token)).status).toBe(200);
    });

    it("but they cannot get a NEW token — the refresh path is where revocation lands", async () => {
        const ws = await makeWorkspace();
        const admin = await makeUser({ workspaceId: ws.id, role: "admin" });
        const leaver = await makeUser({
            workspaceId: ws.id,
            role: "member",
            email: "leaver@example.test",
        });
        const adminClient = await makeLoggedInClient(admin);
        const leaverClient = await makeLoggedInClient(leaver);

        await adminClient.post(`/api/v1/users/${leaver.id}/deactivate`);

        const refreshed = await leaverClient.post("/api/v1/auth/refresh");
        expect(refreshed.status).toBeGreaterThanOrEqual(400);
    });
});
