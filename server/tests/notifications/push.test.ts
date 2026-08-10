import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { getDb } from "../../src/db/client";
import { pushSubscriptions, users } from "../../src/db/schema";
import { oneOff } from "../test-utils/app";
import { makeLoggedInClient, makeUser, makeWorkspace } from "../test-utils/factories";
import { seed } from "./_helpers";

/**
 * Tests for the §29c Web Push endpoints (2026-08-08):
 *   GET    /api/v1/push/public-key
 *   POST   /api/v1/push/subscriptions
 *   DELETE /api/v1/push/subscriptions
 *
 * Private DB `tms_notifications_test`. These routes are authenticated and
 * user-scoped only (no RBAC permission — a caller manages their OWN devices),
 * so the interesting cases are ownership, the endpoint-hash upsert, and the
 * shared-computer reassignment.
 *
 * `pushSvc()` withholds the VAPID keys under `NODE_ENV=test` (the base `.env`
 * leaks real ones into the jest process — see PushService's class doc), so the
 * service is DISABLED for the whole suite: `/public-key` must answer 503, and
 * nothing here can reach a real push service. Subscribe/unsubscribe stay
 * functional by design (the rows are harmless), so a key rollout never races
 * clients already in the field.
 *
 * NOTE: this suite deliberately does NOT truncate between tests (see
 * `setup-each-notifications.ts` — a truncate-all stalls on metadata locks under
 * concurrent suites), so every assertion is scoped to its own user or its own
 * endpoint, never to a global row count. The longer timeout overrides that
 * file's 30 s: the first test pays for the app boot + workspace/RBAC seed.
 */
jest.setTimeout(60_000);

const BASE = "/api/v1/push";

/** A realistic FCM-shaped subscription payload. */
const subPayload = (suffix: string) => ({
    endpoint: `https://fcm.googleapis.com/fcm/send/${suffix}`,
    keys: {
        p256dh: "BJ7kAqyE0Vd3T3nQ4uP1yTQ9Yb-2FmXwWn6vZq8LcRk",
        auth: "k8Jz_9Qw2sVtLmNpQrSu0A",
    },
});

const rowsFor = async (userId: string) =>
    getDb()
        .select()
        .from(pushSubscriptions)
        .where(eq(pushSubscriptions.userId, userId));

/** Rows for ONE endpoint — the suite shares a DB across tests, so global
 *  counts are meaningless; uniqueness is per endpoint hash. */
const rowsForEndpoint = async (endpoint: string) =>
    getDb()
        .select()
        .from(pushSubscriptions)
        .where(
            eq(
                pushSubscriptions.endpointHash,
                createHash("sha256").update(endpoint, "utf8").digest("hex"),
            ),
        );

describe("§29c Web Push subscriptions", () => {
    // ─── GET /push/public-key ───────────────────────────────────────────────
    describe("GET /push/public-key", () => {
        it("503 push.not_configured when the server has no VAPID keys", async () => {
            const { client } = await seed();
            const res = await client.get(`${BASE}/public-key`);
            expect(res.status).toBe(503);
            expect(res.body.error.code).toBe("push.not_configured");
        });

        it("401 without a token", async () => {
            const res = await (await oneOff()).get(`${BASE}/public-key`);
            expect(res.status).toBe(401);
        });
    });

    // ─── POST /push/subscriptions ───────────────────────────────────────────
    describe("POST /push/subscriptions", () => {
        it("registers the device and stores the keys + user agent", async () => {
            const { user, client } = await seed();
            const body = subPayload("device-a");

            const res = await client
                .post(`${BASE}/subscriptions`)
                .set("User-Agent", "Mozilla/5.0 (Test Browser)")
                .send(body);

            expect(res.status).toBe(204);
            const rows = await rowsFor(user.id);
            expect(rows).toHaveLength(1);
            expect(rows[0].endpoint).toBe(body.endpoint);
            expect(rows[0].p256dh).toBe(body.keys.p256dh);
            expect(rows[0].auth).toBe(body.keys.auth);
            expect(rows[0].userAgent).toBe("Mozilla/5.0 (Test Browser)");
            // Uniqueness rides on the hash, not the (too long) endpoint.
            expect(rows[0].endpointHash).toMatch(/^[0-9a-f]{64}$/);
        });

        it("is idempotent — re-subscribing the same endpoint updates in place", async () => {
            const { user, client } = await seed();
            const first = subPayload("device-b");
            await client.post(`${BASE}/subscriptions`).send(first);

            const rotated = {
                endpoint: first.endpoint,
                keys: { p256dh: "BRotatedKey_9xyz", auth: "rotatedAuth_1" },
            };
            const res = await client
                .post(`${BASE}/subscriptions`)
                .send(rotated);

            expect(res.status).toBe(204);
            const rows = await rowsFor(user.id);
            expect(rows).toHaveLength(1); // NOT two rows
            expect(rows[0].p256dh).toBe("BRotatedKey_9xyz");
        });

        it("REASSIGNS a shared device to whoever signs in next", async () => {
            const ws = await makeWorkspace();
            const first = await makeUser({ workspaceId: ws.id });
            const second = await makeUser({ workspaceId: ws.id });
            const shared = subPayload("shared-computer");

            const c1 = await makeLoggedInClient(first);
            await c1.post(`${BASE}/subscriptions`).send(shared);
            expect(await rowsFor(first.id)).toHaveLength(1);

            // Same browser, next person signs in.
            const c2 = await makeLoggedInClient(second);
            await c2.post(`${BASE}/subscriptions`).send(shared);

            expect(await rowsFor(first.id)).toHaveLength(0);
            expect(await rowsFor(second.id)).toHaveLength(1);
            // Reassigned, not cloned: one row exists for that endpoint.
            const forEndpoint = await rowsForEndpoint(shared.endpoint);
            expect(forEndpoint).toHaveLength(1);
            expect(forEndpoint[0].userId).toBe(second.id);
        });

        it("keeps a user's separate devices as separate rows", async () => {
            const { user, client } = await seed();
            await client.post(`${BASE}/subscriptions`).send(subPayload("laptop"));
            await client.post(`${BASE}/subscriptions`).send(subPayload("phone"));
            expect(await rowsFor(user.id)).toHaveLength(2);
        });

        it.each([
            ["a non-https endpoint", { endpoint: "http://evil.test/x" }],
            ["a non-URL endpoint", { endpoint: "not-a-url" }],
            ["an internal http endpoint (stored SSRF)", { endpoint: "http://127.0.0.1:5501/x" }],
            ["an empty endpoint", { endpoint: "" }],
        ])("422 for %s", async (_label, override) => {
            const { user, client } = await seed();
            const res = await client
                .post(`${BASE}/subscriptions`)
                .send({ ...subPayload("bad"), ...override });
            expect(res.status).toBe(422);
            expect(res.body.error.code).toBe("validation.failed");
            expect(await rowsFor(user.id)).toHaveLength(0);
        });

        it("422 when an encryption key is missing or not base64url", async () => {
            const { client } = await seed();
            const missing = await client
                .post(`${BASE}/subscriptions`)
                .send({ endpoint: subPayload("x").endpoint, keys: {} });
            expect(missing.status).toBe(422);

            const bad = await client.post(`${BASE}/subscriptions`).send({
                endpoint: subPayload("y").endpoint,
                keys: { p256dh: "has spaces!", auth: "ok_auth" },
            });
            expect(bad.status).toBe(422);
        });

        it("401 without a token", async () => {
            const res = await (await oneOff())
                .post(`${BASE}/subscriptions`)
                .send(subPayload("anon"));
            expect(res.status).toBe(401);
        });
    });

    // ─── DELETE /push/subscriptions ─────────────────────────────────────────
    describe("DELETE /push/subscriptions", () => {
        it("removes the caller's device row", async () => {
            const { user, client } = await seed();
            const body = subPayload("to-remove");
            await client.post(`${BASE}/subscriptions`).send(body);

            const res = await client
                .delete(`${BASE}/subscriptions`)
                .send({ endpoint: body.endpoint });

            expect(res.status).toBe(204);
            expect(await rowsFor(user.id)).toHaveLength(0);
        });

        it("is an idempotent no-op for an unknown endpoint", async () => {
            const { client } = await seed();
            const res = await client
                .delete(`${BASE}/subscriptions`)
                .send({ endpoint: subPayload("never-registered").endpoint });
            expect(res.status).toBe(204);
        });

        it("cannot delete ANOTHER user's device (no cross-user reach)", async () => {
            const ws = await makeWorkspace();
            const owner = await makeUser({ workspaceId: ws.id });
            const other = await makeUser({ workspaceId: ws.id });
            const body = subPayload("owned-by-first");

            const c1 = await makeLoggedInClient(owner);
            await c1.post(`${BASE}/subscriptions`).send(body);

            const c2 = await makeLoggedInClient(other);
            const res = await c2
                .delete(`${BASE}/subscriptions`)
                .send({ endpoint: body.endpoint });

            // 204 either way — never an existence oracle — but the row stands.
            expect(res.status).toBe(204);
            expect(await rowsFor(owner.id)).toHaveLength(1);
        });

        it("422 for a malformed endpoint", async () => {
            const { client } = await seed();
            const res = await client
                .delete(`${BASE}/subscriptions`)
                .send({ endpoint: "ftp://nope" });
            expect(res.status).toBe(422);
        });
    });

    // ─── Lifecycle ──────────────────────────────────────────────────────────
    describe("Lifecycle", () => {
        it("deleting the user cascades their device rows away", async () => {
            const { user, client } = await seed();
            await client
                .post(`${BASE}/subscriptions`)
                .send(subPayload("cascade"));
            expect(await rowsFor(user.id)).toHaveLength(1);

            await getDb().delete(users).where(eq(users.id, user.id));

            expect(await rowsFor(user.id)).toHaveLength(0);
        });
    });
});
