import { eq } from "drizzle-orm";
import { oneOff } from "../test-utils/app";
import { makeUser } from "../test-utils/factories";
import { getDb } from "../../src/db/client";
import { userNotificationPrefs } from "../../src/db/schema";
import { notificationTypes } from "../../src/db/schema/_shared";
import { BASE, seed } from "./_helpers";

/**
 * Tests for `GET /api/v1/notifications/preferences` (§19 #8) and
 * `PUT .../preferences` (§19 #9). Preferences are a per-(user, type) in-app
 * flag; a missing row defaults to on. GET always returns the full type set;
 * PUT upserts only the supplied types.
 *
 * ⚠️ Rewritten at F28's sweep. This suite still carried the pre-Block-E
 * contract — `email_enabled` on every wire shape and in both fixture INSERTs,
 * plus the dropped `overdue` type — and the schema change (D8 removed the
 * email column) turned the fixtures into a TS compile error, so the whole file
 * had been "Test suite failed to run" (zero tests executed) since F19 without
 * anyone noticing: the module's other suites kept passing and no gate re-ran
 * notifications until F28's. The shapes below are the current contract:
 * `type → { in_app_enabled }`, seven types, and a PUT that names the email
 * channel is 422'd with a message saying it was removed.
 */

const PATH = `${BASE}/preferences`;
const ALL_TYPES = [...notificationTypes].sort();

const prefRows = async (userId: string) =>
    getDb()
        .select()
        .from(userNotificationPrefs)
        .where(eq(userNotificationPrefs.userId, userId));

describe("GET /api/v1/notifications/preferences", () => {
    it("returns every notification type defaulted to in-app on (200)", async () => {
        const { client } = await seed();
        const res = await client.get(PATH);
        expect(res.status).toBe(200);
        expect(Object.keys(res.body).sort()).toEqual(ALL_TYPES);
        for (const type of notificationTypes) {
            expect(res.body[type]).toEqual({ in_app_enabled: true });
        }
    });

    it("reflects a stored override while keeping untouched types at default", async () => {
        const { user, client } = await seed();
        await getDb().insert(userNotificationPrefs).values({
            userId: user.id,
            type: "mentioned",
            inAppEnabled: false,
        });

        const res = await client.get(PATH);
        expect(res.body.mentioned).toEqual({ in_app_enabled: false });
        expect(res.body.assigned).toEqual({ in_app_enabled: true });
    });

    it("returns only the caller's preferences (isolation)", async () => {
        const { ws, client } = await seed();
        const other = await makeUser({ workspaceId: ws.id });
        await getDb().insert(userNotificationPrefs).values({
            userId: other.id,
            type: "assigned",
            inAppEnabled: false,
        });

        const res = await client.get(PATH);
        // The caller never set anything → all defaults, unaffected by `other`.
        expect(res.body.assigned).toEqual({ in_app_enabled: true });
    });

    it("401 auth.missing_token with no credentials", async () => {
        const http = await oneOff();
        const res = await http.get(PATH);
        expect(res.status).toBe(401);
        expect(res.body.error.code).toBe("auth.missing_token");
    });
});

describe("PUT /api/v1/notifications/preferences", () => {
    it("upserts the supplied types and returns the full map (200)", async () => {
        const { user, client } = await seed();
        const res = await client.put(PATH).send({
            assigned: { in_app_enabled: false },
            mentioned: { in_app_enabled: false },
        });

        expect(res.status).toBe(200);
        expect(res.body.assigned).toEqual({ in_app_enabled: false });
        expect(res.body.mentioned).toEqual({ in_app_enabled: false });
        // Untouched type still default.
        expect(res.body.comment).toEqual({ in_app_enabled: true });

        const rows = await prefRows(user.id);
        expect(rows).toHaveLength(2);
    });

    it("overwrites an existing preference on a repeated PUT", async () => {
        const { user, client } = await seed();
        await client.put(PATH).send({ assigned: { in_app_enabled: false } });
        const res = await client
            .put(PATH)
            .send({ assigned: { in_app_enabled: true } });

        expect(res.body.assigned).toEqual({ in_app_enabled: true });
        const rows = await prefRows(user.id);
        expect(rows).toHaveLength(1); // upsert, not a second row
    });

    describe("Validation", () => {
        const bad: Array<[string, object]> = [
            ["empty body", {}],
            ["array body", []],
            ["unknown type", { not_a_type: { in_app_enabled: true } }],
            // `overdue` was dropped by D6 as producerless, then legitimately
            // RE-ADDED by upgrades/014 (2026-08-08): the overdue-alert job is its
            // producer now, so it is a live, settable type — no 422 case here.
            ["non-boolean channel", { assigned: { in_app_enabled: "yes" } }],
            ["missing in_app_enabled", { assigned: {} }],
            // The D8 regression guard: the email channel is GONE, and naming it
            // is an error (the validator's message says why), never a silent drop.
            [
                "the removed email channel",
                { assigned: { in_app_enabled: true, email_enabled: true } },
            ],
            ["unknown extra key", { assigned: { in_app_enabled: true, foo: 1 } }],
            ["non-object value", { assigned: true }],
        ];
        for (const [label, payload] of bad) {
            it(`422 when ${label}`, async () => {
                const { client } = await seed();
                const res = await client.put(PATH).send(payload);
                expect(res.status).toBe(422);
                expect(res.body.error.code).toBe("validation.failed");
            });
        }

        it("writes nothing on a validation failure", async () => {
            const { user, client } = await seed();
            await client
                .put(PATH)
                .send({ not_a_type: { in_app_enabled: true } });
            expect(await prefRows(user.id)).toHaveLength(0);
        });
    });

    it("updates only the caller's preferences (isolation)", async () => {
        const { ws, user, client } = await seed();
        const other = await makeUser({ workspaceId: ws.id });
        await client.put(PATH).send({ assigned: { in_app_enabled: false } });
        expect(await prefRows(other.id)).toHaveLength(0);
        expect(await prefRows(user.id)).toHaveLength(1);
    });

    it("401 auth.missing_token with no credentials", async () => {
        const http = await oneOff();
        const res = await http
            .put(PATH)
            .send({ assigned: { in_app_enabled: true } });
        expect(res.status).toBe(401);
        expect(res.body.error.code).toBe("auth.missing_token");
    });
});
