import { eq } from "drizzle-orm";
import { oneOff } from "../test-utils/app";
import { makeSession, makeUser } from "../test-utils/factories";
import { getDb } from "../../src/db/client";
import { sessions } from "../../src/db/schema";
import { Config } from "../../src/config";

/**
 * Tests for `POST /api/v1/jobs/session-cleanup` (§28 #5).
 *
 * Private DB `tms_jobs_test`, per-test DELETE reset (jobs are global + count-
 * asserting). 🤖 internal-token auth. Hard-deletes sessions expired > 30 days
 * ago; idempotent; `?dry_run=true` counts without deleting.
 */

const URL = "/api/v1/jobs/session-cleanup";
const token = (): string => Config.INTERNAL_JOB_TOKEN ?? "";
const daysAgo = (n: number): Date => new Date(Date.now() - n * 24 * 3600 * 1000);
const daysAhead = (n: number): Date =>
    new Date(Date.now() + n * 24 * 3600 * 1000);

const sessionRows = async (userId: string) =>
    getDb().select().from(sessions).where(eq(sessions.userId, userId));

/** POST the job with the valid internal token (optionally with a query string). */
const post = async (qs = "") =>
    (await oneOff())
        .post(`${URL}${qs}`)
        .set("X-Internal-Token", token())
        .send({});

describe("POST /api/v1/jobs/session-cleanup", () => {
    // ─── a. Happy path ──────────────────────────────────────────────────────
    describe("Happy path", () => {
        it("hard-deletes sessions expired > 30 days ago, keeps the rest", async () => {
            const u = await makeUser();
            const stale = await makeSession({
                userId: u.id,
                expiresAt: daysAgo(31),
            });
            const recentlyExpired = await makeSession({
                userId: u.id,
                expiresAt: daysAgo(10), // expired, but < 30d past — kept
            });
            const active = await makeSession({
                userId: u.id,
                expiresAt: daysAhead(30),
            });

            const res = await post();

            expect(res.status).toBe(200);
            expect(res.body.ok).toBe(true);
            expect(res.body.dry_run).toBe(false);
            expect(res.body.deleted).toBe(1);
            expect(res.body.processed).toBe(1);

            const ids = (await sessionRows(u.id)).map((r) => r.id);
            expect(ids).not.toContain(stale.id);
            expect(ids).toContain(recentlyExpired.id);
            expect(ids).toContain(active.id);
        });

        it("prunes a session revoked > 7 days ago even before expiry + 30d (F10/ISS-017)", async () => {
            const u = await makeUser();
            // Revoked 20 days ago — a revoked session can never authenticate
            // again, so after the 7-day forensic window it is dead weight.
            // (Pre-F10 this row survived until expires_at + 30d ≈ 60 days.)
            const revokedOld = await makeSession({
                userId: u.id,
                expiresAt: daysAgo(5),
                revokedAt: daysAgo(20),
            });
            const res = await post();
            expect(res.body.deleted).toBe(1);
            expect(res.body.deleted_revoked).toBe(1);
            expect((await sessionRows(u.id)).map((r) => r.id)).not.toContain(
                revokedOld.id,
            );
        });

        it("keeps a freshly revoked session (inside the 7-day forensic window)", async () => {
            const u = await makeUser();
            const revokedFresh = await makeSession({
                userId: u.id,
                expiresAt: daysAhead(20),
                revokedAt: daysAgo(2),
            });
            const res = await post();
            expect(res.body.deleted).toBe(0);
            expect((await sessionRows(u.id)).map((r) => r.id)).toContain(
                revokedFresh.id,
            );
        });

        it("returns 0 when nothing is old enough to purge", async () => {
            const u = await makeUser();
            await makeSession({ userId: u.id, expiresAt: daysAgo(10) });
            const res = await post();
            expect(res.status).toBe(200);
            expect(res.body.deleted).toBe(0);
            expect(res.body.processed).toBe(0);
        });
    });

    // ─── dry_run ──────────────────────────────────────────────────────────────
    describe("dry_run", () => {
        it("reports the count but deletes nothing", async () => {
            const u = await makeUser();
            const stale = await makeSession({
                userId: u.id,
                expiresAt: daysAgo(31),
            });

            const res = await post("?dry_run=true");

            expect(res.status).toBe(200);
            expect(res.body.ok).toBe(true);
            expect(res.body.dry_run).toBe(true);
            expect(res.body.wouldDelete).toBe(1);
            expect(res.body.processed).toBe(1);
            expect(res.body.deleted).toBeUndefined();

            const ids = (await sessionRows(u.id)).map((r) => r.id);
            expect(ids).toContain(stale.id); // untouched
        });
    });

    // ─── Idempotency ──────────────────────────────────────────────────────────
    describe("Idempotency", () => {
        it("a second run in the same window deletes nothing more", async () => {
            const u = await makeUser();
            await makeSession({ userId: u.id, expiresAt: daysAgo(31) });

            const first = await post();
            const second = await post();

            expect(first.body.deleted).toBe(1);
            expect(second.body.deleted).toBe(0);
        });
    });

    // ─── Auth (internalAuth) ───────────────────────────────────────────────────
    describe("Auth", () => {
        it("401 auth.unauthorized when the X-Internal-Token header is missing", async () => {
            const res = await (await oneOff()).post(URL).send({});
            expect(res.status).toBe(401);
            expect(res.body.error.code).toBe("auth.unauthorized");
        });

        it("401 auth.unauthorized for a wrong token", async () => {
            const res = await (await oneOff())
                .post(URL)
                .set("X-Internal-Token", "definitely-not-the-token")
                .send({});
            expect(res.status).toBe(401);
            expect(res.body.error.code).toBe("auth.unauthorized");
        });

        it("does not run the job when auth fails (no deletion)", async () => {
            const u = await makeUser();
            const stale = await makeSession({
                userId: u.id,
                expiresAt: daysAgo(31),
            });
            await (await oneOff()).post(URL).send({}); // unauthorised
            expect((await sessionRows(u.id)).map((r) => r.id)).toContain(
                stale.id,
            );
        });
    });

    // ─── Cross-cutting ──────────────────────────────────────────────────────
    describe("Cross-cutting", () => {
        it("responds as application/json with an X-Request-Id header", async () => {
            const res = await post();
            expect(res.headers["content-type"]).toMatch(/application\/json/);
            expect(res.get("X-Request-Id")).toMatch(/^req_/);
        });
    });
});
