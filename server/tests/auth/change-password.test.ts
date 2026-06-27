import bcrypt from "bcrypt";
import { eq } from "drizzle-orm";
import { oneOff } from "../test-utils/app";
import { makeUser, makeLoggedInClient } from "../test-utils/factories";
import { getDb } from "../../src/db/client";
import { users } from "../../src/db/schema";

/**
 * Tests for `POST /api/v1/auth/change-password` (API_DESIGN.md §2).
 *
 * The caller re-proves the CURRENT password before it can be rotated, so a
 * stolen ≤15-min access token alone cannot change the credential. On success
 * the password hash is replaced (204) and the calling session is intentionally
 * left valid (V1 — no forced global sign-out).
 *
 * Patterns mirror the sibling auth suites: real DB writes via factories, an
 * authenticated `makeLoggedInClient`, and a stateless `oneOff()` for the
 * unauthenticated case + the re-login assertions (all limiters are no-ops under
 * NODE_ENV=test, so repeated logins are safe). `setup-each-auth.ts` truncates
 * users/sessions/etc. before each test.
 */

jest.setTimeout(30_000);

const PATH = "/api/v1/auth/change-password";
const LOGIN = "/api/v1/auth/login";

const readHash = async (id: string): Promise<string | undefined> => {
    const db = getDb();
    const [row] = await db
        .select({ passwordHash: users.passwordHash })
        .from(users)
        .where(eq(users.id, id))
        .limit(1);
    return row?.passwordHash;
};

const login = async (email: string, password: string) =>
    (await oneOff()).post(LOGIN).send({ email, password });

describe("POST /api/v1/auth/change-password", () => {
    // ─── Happy path ───────────────────────────────────────────────────────────
    it("rotates the password (204); the new one logs in and the old is rejected", async () => {
        const u = await makeUser({ password: "OldPass#1" });
        const client = await makeLoggedInClient(u);

        const res = await client
            .post(PATH)
            .send({ current_password: "OldPass#1", new_password: "NewPass#2" });

        expect(res.status).toBe(204);
        expect((await login(u.email, "OldPass#1")).status).toBe(401);
        expect((await login(u.email, "NewPass#2")).status).toBe(200);
    });

    it("persists a fresh bcrypt hash (different from the old, verifies the new)", async () => {
        const u = await makeUser({ password: "OldPass#1" });
        const before = await readHash(u.id);
        const client = await makeLoggedInClient(u);

        await client
            .post(PATH)
            .send({ current_password: "OldPass#1", new_password: "NewPass#2" });

        const after = await readHash(u.id);
        expect(after).toBeDefined();
        expect(after).not.toBe(before);
        expect(await bcrypt.compare("NewPass#2", after as string)).toBe(true);
    });

    // ─── Wrong current password ───────────────────────────────────────────────
    it("rejects a wrong current password (422 auth.incorrect_password) and changes nothing", async () => {
        const u = await makeUser({ password: "OldPass#1" });
        const before = await readHash(u.id);
        const client = await makeLoggedInClient(u);

        const res = await client
            .post(PATH)
            .send({ current_password: "WrongPass#9", new_password: "NewPass#2" });

        expect(res.status).toBe(422);
        expect(res.body.error.code).toBe("auth.incorrect_password");
        // Nothing mutated: the hash is unchanged and the old password still logs in.
        expect(await readHash(u.id)).toBe(before);
        expect((await login(u.email, "OldPass#1")).status).toBe(200);
    });

    // ─── New equals current ───────────────────────────────────────────────────
    it("rejects when the new password equals the current (422 auth.password_unchanged)", async () => {
        const u = await makeUser({ password: "SamePass#1" });
        const client = await makeLoggedInClient(u);

        const res = await client
            .post(PATH)
            .send({ current_password: "SamePass#1", new_password: "SamePass#1" });

        expect(res.status).toBe(422);
        expect(res.body.error.code).toBe("auth.password_unchanged");
    });

    // ─── Validation (422 validation.failed) ───────────────────────────────────
    it("rejects a too-short (<8) new password with 422 validation.failed", async () => {
        const u = await makeUser({ password: "OldPass#1" });
        const client = await makeLoggedInClient(u);

        const res = await client
            .post(PATH)
            .send({ current_password: "OldPass#1", new_password: "short7!" });

        expect(res.status).toBe(422);
        expect(res.body.error.code).toBe("validation.failed");
    });

    it("rejects a too-long (>200) new password with 422 validation.failed", async () => {
        const u = await makeUser({ password: "OldPass#1" });
        const client = await makeLoggedInClient(u);

        const res = await client.post(PATH).send({
            current_password: "OldPass#1",
            new_password: "a".repeat(201),
        });

        expect(res.status).toBe(422);
        expect(res.body.error.code).toBe("validation.failed");
    });

    it("rejects a missing current_password with 422 validation.failed", async () => {
        const u = await makeUser({ password: "OldPass#1" });
        const client = await makeLoggedInClient(u);

        const res = await client.post(PATH).send({ new_password: "NewPass#2" });

        expect(res.status).toBe(422);
        expect(res.body.error.code).toBe("validation.failed");
    });

    it("rejects a missing new_password with 422 validation.failed", async () => {
        const u = await makeUser({ password: "OldPass#1" });
        const client = await makeLoggedInClient(u);

        const res = await client
            .post(PATH)
            .send({ current_password: "OldPass#1" });

        expect(res.status).toBe(422);
        expect(res.body.error.code).toBe("validation.failed");
    });

    // ─── Auth required ────────────────────────────────────────────────────────
    it("requires authentication — 401 without a token", async () => {
        const res = await (await oneOff())
            .post(PATH)
            .send({ current_password: "OldPass#1", new_password: "NewPass#2" });

        expect(res.status).toBe(401);
    });

    // ─── V1: the calling session survives ─────────────────────────────────────
    it("leaves the calling session valid after the change (no forced sign-out)", async () => {
        const u = await makeUser({ password: "OldPass#1" });
        const client = await makeLoggedInClient(u);

        await client
            .post(PATH)
            .send({ current_password: "OldPass#1", new_password: "NewPass#2" });

        const me = await client.get("/api/v1/auth/me");
        expect(me.status).toBe(200);
    });
});
