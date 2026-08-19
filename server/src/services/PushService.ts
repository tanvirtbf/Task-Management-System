import webpush from "web-push";
import type { Logger } from "winston";
import { Config } from "../config";
import logger from "../config/logger";
import { getDb } from "../db/client";
import { PushSubscriptionsRepo } from "../repositories/PushSubscriptionsRepo";
import { UsersRepo } from "../repositories/UsersRepo";

/**
 * Web Push delivery (§29c) — the third notification channel, after the in-app
 * row and the email. This is the one that reaches a user's DEVICES: desktop
 * and phone, even with the app tab closed.
 *
 * Null-safe by construction (the `openaiClient` posture): with no VAPID
 * keypair the service is DISABLED — `publicKey()` returns null so the routes
 * answer `503 push.not_configured`, every dispatch is an immediate no-op, and
 * nothing at import time can throw.
 *
 * The class itself decides only on the keys it is handed; the ENVIRONMENT
 * policy lives in the `pushSvc()` factory below, which withholds the keys
 * under `NODE_ENV=test`. That matters: `config/index.ts` layers `.env.test`
 * ON TOP of the base `.env`, so real VAPID keys leak into the test process the
 * same way SMTP credentials do — and without this guard a suite that happened
 * to create a subscription row would fire a real HTTPS request at a live push
 * service. `MailService` refuses under test for exactly the same reason.
 *
 * Dispatch contract mirrors `TaskEmailService`: producers call it
 * fire-and-forget AFTER their transaction commits, and NOTHING here throws —
 * a failed push must never fail the API request that triggered it. A 404/410
 * from the push service means the browser revoked or expired that
 * subscription, so the row is pruned inline and dead devices never pile up.
 */

export interface PushPayload {
    title: string;
    body: string;
    /** SPA path the service worker opens on click (e.g. `/t/<taskId>`). */
    url: string;
    /**
     * Collapse key. The in-tab (SSE) notification for the SAME event uses the
     * SAME tag, so if both paths fire the OS shows one bubble, not two.
     */
    tag: string;
}

/** Push messages are transient nudges — never queue them for days. */
const PUSH_TTL_SECONDS = 3600;

export class PushService {
    private readonly vapidPublicKey: string | null;

    constructor(
        keys: {
            publicKey?: string | null;
            privateKey?: string | null;
            subject?: string | null;
        },
        private subscriptions: PushSubscriptionsRepo,
        private users: UsersRepo,
        private log: Logger,
    ) {
        if (keys.publicKey && keys.privateKey) {
            webpush.setVapidDetails(
                keys.subject || "mailto:no-reply@localhost",
                keys.publicKey,
                keys.privateKey,
            );
            this.vapidPublicKey = keys.publicKey;
        } else {
            this.vapidPublicKey = null;
            this.log.debug("push.disabled", {
                reason: "VAPID keys not configured (set VAPID_* in .env)",
            });
        }
    }

    /** The `applicationServerKey` browsers subscribe with; null = disabled. */
    publicKey(): string | null {
        return this.vapidPublicKey;
    }

    /**
     * "<name> assigned you a task" → every device of every recipient. The
     * argument shape deliberately matches `TaskEmailService.taskAssigned` so
     * the two dispatch calls sit side by side at each producer.
     */
    async taskAssigned(input: {
        workspaceId: string;
        taskId: string;
        taskName: string;
        /** Already minus the actor — the set the in-app fanout notified. */
        recipientIds: string[];
        actorId: string;
    }): Promise<void> {
        if (!this.vapidPublicKey || input.recipientIds.length === 0) return;
        let assignerName = "A teammate";
        try {
            const [actor] = await this.users.findManyByIdsInWorkspace(
                [input.actorId],
                input.workspaceId,
            );
            if (actor) {
                const name = `${actor.firstName} ${actor.lastName}`.trim();
                if (name) assignerName = name;
            }
        } catch {
            /* the name is cosmetic — never block the push on it */
        }
        await this.fanout(input.recipientIds, {
            title: `${assignerName} assigned you a task`,
            body: input.taskName,
            url: `/t/${input.taskId}`,
            tag: `bb-assigned-${input.taskId}`,
        });
    }

    /**
     * @mention in a comment (2026-08-19) — same recipients as the in-app
     * `mentioned` notification (already visibility-filtered and minus the
     * author). Tagged per comment so a re-notified device coalesces.
     */
    async commentMention(input: {
        workspaceId: string;
        commentId: string;
        taskId: string;
        taskName: string;
        recipientIds: string[];
        actorId: string;
    }): Promise<void> {
        if (!this.vapidPublicKey || input.recipientIds.length === 0) return;
        let actorName = "A teammate";
        try {
            const [actor] = await this.users.findManyByIdsInWorkspace(
                [input.actorId],
                input.workspaceId,
            );
            if (actor) {
                const name = `${actor.firstName} ${actor.lastName}`.trim();
                if (name) actorName = name;
            }
        } catch {
            /* the name is cosmetic — never block the push on it */
        }
        await this.fanout(input.recipientIds, {
            title: `${actorName} mentioned you in a comment`,
            body: input.taskName,
            url: `/t/${input.taskId}`,
            tag: `bb-mention-${input.commentId}`,
        });
    }

    /**
     * Team-access P9: one of the five assignment-approval moments — same
     * recipients as the in-app bell, kind-aware copy AND link (receiver-facing
     * kinds land on the inbox Requests tab; the task itself is still 404 for
     * them until they accept).
     */
    async assignmentRequest(input: {
        workspaceId: string;
        requestId: string;
        taskId: string;
        taskName: string;
        kind: "received" | "accepted" | "declined" | "query" | "answer";
        recipientIds: string[];
        actorId: string;
        note?: string | null;
    }): Promise<void> {
        if (!this.vapidPublicKey || input.recipientIds.length === 0) return;
        let actorName = "A teammate";
        try {
            const [actor] = await this.users.findManyByIdsInWorkspace(
                [input.actorId],
                input.workspaceId,
            );
            if (actor) {
                const name = `${actor.firstName} ${actor.lastName}`.trim();
                if (name) actorName = name;
            }
        } catch {
            /* the name is cosmetic — never block the push on it */
        }
        const TITLES: Record<typeof input.kind, string> = {
            received: `${actorName} needs your approval`,
            accepted: `${actorName} accepted your assignment`,
            declined: `${actorName} declined your assignment`,
            query: `${actorName} has a question on your request`,
            answer: `${actorName} answered your query`,
        };
        const note = input.note ? ` — "${input.note.slice(0, 120)}"` : "";
        await this.fanout(input.recipientIds, {
            title: TITLES[input.kind],
            body: `${input.taskName}${note}`,
            url:
                input.kind === "received" || input.kind === "answer"
                    ? "/inbox"
                    : `/t/${input.taskId}`,
            tag: `bb-areq-${input.requestId}-${input.kind}`,
        });
    }

    /** "Your task is overdue" → every device of every assignee. */
    async taskOverdue(input: {
        taskId: string;
        taskName: string;
        dueYmd: string;
        recipientIds: string[];
    }): Promise<void> {
        await this.fanout(input.recipientIds, {
            title: "Task overdue — please finish it",
            body: `"${input.taskName}" (due ${input.dueYmd})`,
            url: `/t/${input.taskId}`,
            tag: `bb-overdue-${input.taskId}`,
        });
    }

    /**
     * Deliver `payload` to every subscribed device of `userIds`. Never throws;
     * per-device isolation; dead subscriptions (404/410) pruned inline.
     */
    private async fanout(
        userIds: string[],
        payload: PushPayload,
    ): Promise<void> {
        try {
            if (!this.vapidPublicKey || userIds.length === 0) return;
            const devices = await this.subscriptions.findByUserIds(userIds);
            if (devices.length === 0) return;

            const body = JSON.stringify(payload);
            let sent = 0;
            let pruned = 0;
            let failed = 0;
            for (const device of devices) {
                try {
                    await webpush.sendNotification(
                        {
                            endpoint: device.endpoint,
                            keys: { p256dh: device.p256dh, auth: device.auth },
                        },
                        body,
                        { TTL: PUSH_TTL_SECONDS },
                    );
                    sent += 1;
                } catch (err) {
                    const status = (err as { statusCode?: number }).statusCode;
                    if (status === 404 || status === 410) {
                        await this.subscriptions
                            .deleteById(device.id)
                            .catch(() => undefined);
                        pruned += 1;
                    } else {
                        failed += 1;
                    }
                }
            }
            this.log.info("push.fanout", {
                tag: payload.tag,
                devices: devices.length,
                sent,
                pruned,
                failed,
            });
        } catch (err) {
            this.log.warn("push.fanout.fail", {
                tag: payload.tag,
                error: err instanceof Error ? err.message : String(err),
            });
        }
    }
}

let instance: PushService | null = null;

/**
 * The process-wide PushService, built on first use (after `initDb()`).
 *
 * A lazy module singleton — the same pattern `rbac/policy.ts` and
 * `TaskEmailService` use — so the three `TaskWriteService` wiring sites do not
 * each grow another constructor argument.
 */
export const pushSvc = (): PushService => {
    if (!instance) {
        const db = getDb();
        // Under test the keys are withheld on purpose — see the class doc:
        // the base `.env` leaks real VAPID keys into the jest process, and a
        // live push service must never be reachable from a test run.
        const underTest = Config.NODE_ENV === "test";
        instance = new PushService(
            {
                publicKey: underTest ? null : Config.VAPID_PUBLIC_KEY,
                privateKey: underTest ? null : Config.VAPID_PRIVATE_KEY,
                subject: Config.VAPID_SUBJECT,
            },
            new PushSubscriptionsRepo(db),
            new UsersRepo(db),
            logger,
        );
    }
    return instance;
};

/** Test seam: drop the singleton so the next call re-reads Config. */
export const resetPushService = (): void => {
    instance = null;
};
