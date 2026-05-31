import { eq } from "drizzle-orm";
import { oneOff } from "../test-utils/app";
import { makeUser } from "../test-utils/factories";
import { getDb } from "../../src/db/client";
import { notifications } from "../../src/db/schema";
import { fakeId } from "../../src/utils";
import { Config } from "../../src/config";

/**
 * Tests for `POST /api/v1/jobs/snooze-wake` (§28 #6).
 *
 * Private DB `tms_jobs_test`, per-test DELETE reset. 🤖 internal-token auth.
 * Flips snoozed notifications back to unread once `snoozed_until <= NOW()`;
 * idempotent (a re-run wakes 0 — no double-delivery); `?dry_run=true` counts.
 */

const URL = "/api/v1/jobs/snooze-wake";
const token = (): string => Config.INTERNAL_JOB_TOKEN ?? "";
const minutesAgo = (n: number): Date => new Date(Date.now() - n * 60 * 1000);
const minutesAhead = (n: number): Date => new Date(Date.now() + n * 60 * 1000);

const post = async (qs = "") =>
    (await oneOff())
        .post(`${URL}${qs}`)
        .set("X-Internal-Token", token())
        .send({});

/** Insert a raw notification (createMany cannot set snoozedUntil / isRead / deletedAt). */
const seedNotification = async (
    userId: string,
    opts: { snoozedUntil: Date | null; isRead: boolean; deletedAt?: Date | null },
): Promise<string> => {
    const id = fakeId("ntf");
    await getDb()
        .insert(notifications)
        .values({
            id,
            userId,
            type: "assigned",
            entityType: "task",
            entityId: "t-ref",
            actorId: null,
            title: "Heads up",
            isRead: opts.isRead,
            snoozedUntil: opts.snoozedUntil,
            deletedAt: opts.deletedAt ?? null,
        });
    return id;
};

const rowById = async (id: string) => {
    const [r] = await getDb()
        .select()
        .from(notifications)
        .where(eq(notifications.id, id))
        .limit(1);
    return r;
};

describe("POST /api/v1/jobs/snooze-wake", () => {
    // ─── a. Happy path ──────────────────────────────────────────────────────
    describe("Happy path", () => {
        it("wakes due snoozed notifications, leaves future / non-snoozed / deleted ones", async () => {
            const u = await makeUser();
            const due = await seedNotification(u.id, {
                snoozedUntil: minutesAgo(1),
                isRead: true,
            });
            const future = await seedNotification(u.id, {
                snoozedUntil: minutesAhead(60),
                isRead: true,
            });
            const plainUnread = await seedNotification(u.id, {
                snoozedUntil: null,
                isRead: false,
            });
            const deletedDue = await seedNotification(u.id, {
                snoozedUntil: minutesAgo(1),
                isRead: true,
                deletedAt: minutesAgo(1),
            });

            const res = await post();

            expect(res.status).toBe(200);
            expect(res.body.ok).toBe(true);
            expect(res.body.woken).toBe(1);
            expect(res.body.processed).toBe(1);

            const dueRow = await rowById(due);
            expect(dueRow.isRead).toBe(false);
            expect(dueRow.snoozedUntil).toBeNull();

            const futureRow = await rowById(future);
            expect(futureRow.snoozedUntil).not.toBeNull();
            expect(futureRow.isRead).toBe(true);

            expect((await rowById(plainUnread)).isRead).toBe(false); // untouched
            const deletedRow = await rowById(deletedDue);
            expect(deletedRow.snoozedUntil).not.toBeNull(); // not woken (deleted)
        });

        it("returns 0 when nothing is due", async () => {
            const u = await makeUser();
            await seedNotification(u.id, {
                snoozedUntil: minutesAhead(30),
                isRead: true,
            });
            const res = await post();
            expect(res.body.woken).toBe(0);
        });
    });

    // ─── dry_run ──────────────────────────────────────────────────────────────
    describe("dry_run", () => {
        it("counts but flips nothing", async () => {
            const u = await makeUser();
            const due = await seedNotification(u.id, {
                snoozedUntil: minutesAgo(1),
                isRead: true,
            });

            const res = await post("?dry_run=true");

            expect(res.body.dry_run).toBe(true);
            expect(res.body.wouldWake).toBe(1);
            const row = await rowById(due);
            expect(row.isRead).toBe(true); // still snoozed/read
            expect(row.snoozedUntil).not.toBeNull();
        });
    });

    // ─── Idempotency ──────────────────────────────────────────────────────────
    describe("Idempotency", () => {
        it("a second run in the same window wakes nothing (no double-delivery)", async () => {
            const u = await makeUser();
            await seedNotification(u.id, {
                snoozedUntil: minutesAgo(1),
                isRead: true,
            });
            const first = await post();
            const second = await post();
            expect(first.body.woken).toBe(1);
            expect(second.body.woken).toBe(0);
        });
    });

    // ─── Auth ──────────────────────────────────────────────────────────────
    describe("Auth", () => {
        it("401 auth.unauthorized without the internal token", async () => {
            const res = await (await oneOff()).post(URL).send({});
            expect(res.status).toBe(401);
            expect(res.body.error.code).toBe("auth.unauthorized");
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
