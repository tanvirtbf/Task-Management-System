"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.resetPushService = exports.pushSvc = exports.PushService = void 0;
const web_push_1 = __importDefault(require("web-push"));
const config_1 = require("../config");
const logger_1 = __importDefault(require("../config/logger"));
const client_1 = require("../db/client");
const PushSubscriptionsRepo_1 = require("../repositories/PushSubscriptionsRepo");
const UsersRepo_1 = require("../repositories/UsersRepo");
/** Push messages are transient nudges — never queue them for days. */
const PUSH_TTL_SECONDS = 3600;
class PushService {
    subscriptions;
    users;
    log;
    vapidPublicKey;
    constructor(keys, subscriptions, users, log) {
        this.subscriptions = subscriptions;
        this.users = users;
        this.log = log;
        if (keys.publicKey && keys.privateKey) {
            web_push_1.default.setVapidDetails(keys.subject || "mailto:no-reply@localhost", keys.publicKey, keys.privateKey);
            this.vapidPublicKey = keys.publicKey;
        }
        else {
            this.vapidPublicKey = null;
            this.log.debug("push.disabled", {
                reason: "VAPID keys not configured (set VAPID_* in .env)",
            });
        }
    }
    /** The `applicationServerKey` browsers subscribe with; null = disabled. */
    publicKey() {
        return this.vapidPublicKey;
    }
    /**
     * "<name> assigned you a task" → every device of every recipient. The
     * argument shape deliberately matches `TaskEmailService.taskAssigned` so
     * the two dispatch calls sit side by side at each producer.
     */
    async taskAssigned(input) {
        if (!this.vapidPublicKey || input.recipientIds.length === 0)
            return;
        let assignerName = "A teammate";
        try {
            const [actor] = await this.users.findManyByIdsInWorkspace([input.actorId], input.workspaceId);
            if (actor) {
                const name = `${actor.firstName} ${actor.lastName}`.trim();
                if (name)
                    assignerName = name;
            }
        }
        catch {
            /* the name is cosmetic — never block the push on it */
        }
        await this.fanout(input.recipientIds, {
            title: `${assignerName} assigned you a task`,
            body: input.taskName,
            url: `/t/${input.taskId}`,
            tag: `bb-assigned-${input.taskId}`,
        });
    }
    /** "Your task is overdue" → every device of every assignee. */
    async taskOverdue(input) {
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
    async fanout(userIds, payload) {
        try {
            if (!this.vapidPublicKey || userIds.length === 0)
                return;
            const devices = await this.subscriptions.findByUserIds(userIds);
            if (devices.length === 0)
                return;
            const body = JSON.stringify(payload);
            let sent = 0;
            let pruned = 0;
            let failed = 0;
            for (const device of devices) {
                try {
                    await web_push_1.default.sendNotification({
                        endpoint: device.endpoint,
                        keys: { p256dh: device.p256dh, auth: device.auth },
                    }, body, { TTL: PUSH_TTL_SECONDS });
                    sent += 1;
                }
                catch (err) {
                    const status = err.statusCode;
                    if (status === 404 || status === 410) {
                        await this.subscriptions
                            .deleteById(device.id)
                            .catch(() => undefined);
                        pruned += 1;
                    }
                    else {
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
        }
        catch (err) {
            this.log.warn("push.fanout.fail", {
                tag: payload.tag,
                error: err instanceof Error ? err.message : String(err),
            });
        }
    }
}
exports.PushService = PushService;
let instance = null;
/**
 * The process-wide PushService, built on first use (after `initDb()`).
 *
 * A lazy module singleton — the same pattern `rbac/policy.ts` and
 * `TaskEmailService` use — so the three `TaskWriteService` wiring sites do not
 * each grow another constructor argument.
 */
const pushSvc = () => {
    if (!instance) {
        const db = (0, client_1.getDb)();
        // Under test the keys are withheld on purpose — see the class doc:
        // the base `.env` leaks real VAPID keys into the jest process, and a
        // live push service must never be reachable from a test run.
        const underTest = config_1.Config.NODE_ENV === "test";
        instance = new PushService({
            publicKey: underTest ? null : config_1.Config.VAPID_PUBLIC_KEY,
            privateKey: underTest ? null : config_1.Config.VAPID_PRIVATE_KEY,
            subject: config_1.Config.VAPID_SUBJECT,
        }, new PushSubscriptionsRepo_1.PushSubscriptionsRepo(db), new UsersRepo_1.UsersRepo(db), logger_1.default);
    }
    return instance;
};
exports.pushSvc = pushSvc;
/** Test seam: drop the singleton so the next call re-reads Config. */
const resetPushService = () => {
    instance = null;
};
exports.resetPushService = resetPushService;
