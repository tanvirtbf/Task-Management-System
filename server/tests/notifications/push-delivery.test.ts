import webpush from "web-push";
import logger from "../../src/config/logger";
import { getDb } from "../../src/db/client";
import { PushService, pushSvc } from "../../src/services/PushService";
import { PushSubscriptionsRepo } from "../../src/repositories/PushSubscriptionsRepo";
import { UsersRepo } from "../../src/repositories/UsersRepo";
import { makeUser, makeWorkspace } from "../test-utils/factories";
import { fakeId } from "../../src/utils";

/**
 * §29c Web Push — DELIVERY, which the route suite deliberately does not touch.
 *
 * `push.test.ts` proves the subscription rows; this proves what happens to them
 * when something is actually sent: the fan-out, the dead-device prune, and the
 * promise that a push failure can never fail the API request that triggered it.
 *
 * SAFETY. Two guards, both load-bearing, because a mistake here mails a real
 * push service:
 *   1. `webpush.sendNotification` is mocked for EVERY test in this file, in a
 *      top-level beforeEach, so no test can reach the network even by accident.
 *   2. The VAPID keys are generated locally per run (`generateVAPIDKeys` is
 *      pure crypto, no network). The process-wide `pushSvc()` singleton stays
 *      DISABLED under `NODE_ENV=test` — that rule is asserted at the bottom
 *      rather than worked around, because it is the thing standing between a
 *      test run and a live push endpoint.
 */
jest.setTimeout(60_000);

const VAPID = webpush.generateVAPIDKeys();

/** A subscription row for `userId`, with a deliberately unroutable endpoint. */
const subscribe = async (userId: string, suffix: string) => {
    const repo = new PushSubscriptionsRepo(getDb());
    const endpoint = `https://push.invalid/never-reached/${suffix}`;
    await repo.upsert({
        userId,
        endpoint,
        p256dh: "BJ7kAqyE0Vd3T3nQ4uP1yTQ9Yb-2FmXwWn6vZq8LcRk",
        auth: "k8Jz_9Qw2sVtLmNpQrSu0A",
        userAgent: "jest",
    });
    const [row] = (await repo.findByUserId(userId)).filter(
        (r) => r.endpoint === endpoint,
    );
    return row;
};

const svcWithKeys = (): PushService =>
    new PushService(
        {
            publicKey: VAPID.publicKey,
            privateKey: VAPID.privateKey,
            subject: "mailto:tests@example.invalid",
        },
        new PushSubscriptionsRepo(getDb()),
        new UsersRepo(getDb()),
        logger,
    );

const devicesOf = async (userId: string) =>
    new PushSubscriptionsRepo(getDb()).findByUserId(userId);

/** An error shaped the way `web-push` reports a rejected endpoint. */
const pushError = (statusCode: number): Error =>
    Object.assign(new Error(`push rejected ${statusCode}`), { statusCode });

describe("§29c Web Push delivery", () => {
    // jest 29: `SpyInstance`, not `SpiedFunction` (that is the jest 30 name).
    let send: jest.SpyInstance;

    beforeEach(() => {
        send = jest
            .spyOn(webpush, "sendNotification")
            .mockResolvedValue({ statusCode: 201, body: "", headers: {} });
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    const seedUser = async () => {
        const ws = await makeWorkspace();
        return makeUser({ workspaceId: ws.id, role: "member" });
    };

    describe("fan-out", () => {
        it("sends to every device of every recipient, once each", async () => {
            const a = await seedUser();
            const b = await seedUser();
            await subscribe(a.id, fakeId("d"));
            await subscribe(a.id, fakeId("d")); // two browsers, one person
            await subscribe(b.id, fakeId("d"));

            await svcWithKeys().taskOverdue({
                taskId: "t-1",
                taskName: "Ship the September catalogue",
                dueLabel: "2026-09-01",
                recipientIds: [a.id, b.id],
            });

            expect(send).toHaveBeenCalledTimes(3);
        });

        it("carries the {title, body, url, tag} payload contract the service worker reads", async () => {
            const u = await seedUser();
            await subscribe(u.id, fakeId("d"));

            await svcWithKeys().taskOverdue({
                taskId: "t-42",
                taskName: "Restock serums",
                dueLabel: "2026-08-30",
                recipientIds: [u.id],
            });

            expect(send).toHaveBeenCalledTimes(1);
            const [subscription, body, opts] = send.mock.calls[0];
            expect(subscription).toMatchObject({
                endpoint: expect.stringContaining("https://push.invalid/"),
                keys: { p256dh: expect.any(String), auth: expect.any(String) },
            });
            expect(JSON.parse(body as string)).toEqual({
                title: "Task overdue — please finish it",
                body: '"Restock serums" (due 2026-08-30)',
                url: "/t/t-42",
                tag: "bb-overdue-t-42",
            });
            // Transient nudge — never queued for days.
            expect(opts).toMatchObject({ TTL: 3600 });
        });

        it("makes no call at all when the person has no devices", async () => {
            const u = await seedUser();
            await svcWithKeys().taskOverdue({
                taskId: "t-2",
                taskName: "Nothing to deliver to",
                dueLabel: "2026-09-01",
                recipientIds: [u.id],
            });
            expect(send).not.toHaveBeenCalled();
        });

        it("makes no call when the recipient list is empty", async () => {
            await svcWithKeys().taskOverdue({
                taskId: "t-3",
                taskName: "Nobody",
                dueLabel: "2026-09-01",
                recipientIds: [],
            });
            expect(send).not.toHaveBeenCalled();
        });
    });

    describe("dead devices are pruned inline", () => {
        it("410 Gone — the browser revoked it — removes the row", async () => {
            const u = await seedUser();
            await subscribe(u.id, fakeId("d"));
            send.mockRejectedValueOnce(pushError(410));

            await svcWithKeys().taskOverdue({
                taskId: "t-4",
                taskName: "Gone",
                dueLabel: "2026-09-01",
                recipientIds: [u.id],
            });

            expect(await devicesOf(u.id)).toEqual([]);
        });

        it("404 Not Found does the same", async () => {
            const u = await seedUser();
            await subscribe(u.id, fakeId("d"));
            send.mockRejectedValueOnce(pushError(404));

            await svcWithKeys().taskOverdue({
                taskId: "t-5",
                taskName: "Missing",
                dueLabel: "2026-09-01",
                recipientIds: [u.id],
            });

            expect(await devicesOf(u.id)).toEqual([]);
        });

        it("a 500 from the push service KEEPS the row — a transient failure is not a revocation", async () => {
            const u = await seedUser();
            await subscribe(u.id, fakeId("d"));
            send.mockRejectedValueOnce(pushError(500));

            await svcWithKeys().taskOverdue({
                taskId: "t-6",
                taskName: "Try again later",
                dueLabel: "2026-09-01",
                recipientIds: [u.id],
            });

            expect(await devicesOf(u.id)).toHaveLength(1);
        });

        it("one dead device does not stop the live one next to it", async () => {
            const u = await seedUser();
            const dead = await subscribe(u.id, fakeId("d"));
            const live = await subscribe(u.id, fakeId("d"));
            send.mockImplementation(async (sub) => {
                if ((sub as { endpoint: string }).endpoint === dead.endpoint) {
                    throw pushError(410);
                }
                return { statusCode: 201, body: "", headers: {} };
            });

            await svcWithKeys().taskOverdue({
                taskId: "t-7",
                taskName: "Mixed fleet",
                dueLabel: "2026-09-01",
                recipientIds: [u.id],
            });

            expect(send).toHaveBeenCalledTimes(2);
            const left = await devicesOf(u.id);
            expect(left.map((r) => r.id)).toEqual([live.id]);
        });
    });

    describe("a push failure never becomes an API failure", () => {
        it("swallows a rejection with no statusCode at all", async () => {
            const u = await seedUser();
            await subscribe(u.id, fakeId("d"));
            send.mockRejectedValueOnce(new Error("socket hang up"));

            await expect(
                svcWithKeys().taskOverdue({
                    taskId: "t-8",
                    taskName: "Network died",
                    dueLabel: "2026-09-01",
                    recipientIds: [u.id],
                }),
            ).resolves.toBeUndefined();
            expect(await devicesOf(u.id)).toHaveLength(1);
        });

        it("swallows a failure of the device LOOKUP itself", async () => {
            const repo = new PushSubscriptionsRepo(getDb());
            jest.spyOn(repo, "findByUserIds").mockRejectedValue(
                new Error("db is on fire"),
            );
            const svc = new PushService(
                {
                    publicKey: VAPID.publicKey,
                    privateKey: VAPID.privateKey,
                    subject: "mailto:tests@example.invalid",
                },
                repo,
                new UsersRepo(getDb()),
                logger,
            );

            await expect(
                svc.taskOverdue({
                    taskId: "t-9",
                    taskName: "Repo exploded",
                    dueLabel: "2026-09-01",
                    recipientIds: ["u-whatever"],
                }),
            ).resolves.toBeUndefined();
            expect(send).not.toHaveBeenCalled();
        });
    });

    describe("disabled by default", () => {
        it("with no VAPID keypair, publicKey() is null and nothing is ever sent", async () => {
            const u = await seedUser();
            await subscribe(u.id, fakeId("d"));
            const off = new PushService(
                { publicKey: null, privateKey: null, subject: null },
                new PushSubscriptionsRepo(getDb()),
                new UsersRepo(getDb()),
                logger,
            );

            expect(off.publicKey()).toBeNull();
            await off.taskOverdue({
                taskId: "t-10",
                taskName: "Disabled",
                dueLabel: "2026-09-01",
                recipientIds: [u.id],
            });
            expect(send).not.toHaveBeenCalled();
            expect(await devicesOf(u.id)).toHaveLength(1);
        });

        it("the process-wide pushSvc() WITHHOLDS the keys under NODE_ENV=test", () => {
            // The rule that keeps a jest run from reaching a live push service:
            // `config/index.ts` layers `.env.test` on top of the base `.env`, so
            // real VAPID keys are present in `Config` here. `pushSvc()` refuses
            // to hand them to the service anyway. If this ever goes green-to-red,
            // the suite has gained the ability to push to real phones.
            expect(process.env.NODE_ENV).toBe("test");
            expect(pushSvc().publicKey()).toBeNull();
        });
    });
});
