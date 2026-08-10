"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const client_1 = require("../db/client");
const errors_1 = require("../errors");
const authenticate_1 = __importDefault(require("../middlewares/authenticate"));
const validate_1 = require("../middlewares/validate");
const PushSubscriptionsRepo_1 = require("../repositories/PushSubscriptionsRepo");
const PushService_1 = require("../services/PushService");
const push_1 = require("../validators/push");
/**
 * §29c Web Push — the device-subscription lifecycle. Mounted at
 * `/api/v1/push`.
 *
 * User-scoped self-service, exactly like §19 notifications: `authenticate`
 * only, no `requirePermission`. A caller manages their OWN devices and nothing
 * else (the repo scopes every write to `req.auth.sub`), so there is no
 * permission to invent — and inventing one would mean editing the 56-key RBAC
 * catalog for a capability every role must have.
 *
 * Delivery itself lives server-side in `PushService`; these routes only
 * maintain rows. When VAPID keys are absent the feature is OFF and
 * `GET /public-key` says so with `503 push.not_configured`; subscribe /
 * unsubscribe keep working (the rows are harmless) so a key rollout never
 * races clients that are already running.
 */
const router = express_1.default.Router();
// `getDb()` works because `server.ts` calls `initDb()` before `app.ts` (and
// therefore this module) is imported.
const repo = new PushSubscriptionsRepo_1.PushSubscriptionsRepo((0, client_1.getDb)());
/** GET /api/v1/push/public-key — the applicationServerKey. 🔐 any member. */
router.get("/public-key", authenticate_1.default, (_req, res, next) => {
    const key = (0, PushService_1.pushSvc)().publicKey();
    if (!key) {
        return next(new errors_1.AppError(503, "push.not_configured", "Web Push is not configured on this server"));
    }
    res.status(200).json({ public_key: key });
});
/**
 * POST /api/v1/push/subscriptions — register/refresh THIS browser. 🔐 any
 * member. Idempotent: the same endpoint upserts (and re-binds the device to
 * the current user on a shared computer). 204 on success.
 */
router.post("/subscriptions", authenticate_1.default, push_1.subscribeValidator, validate_1.validate, async (req, res, next) => {
    try {
        const { sub } = req.auth;
        const { endpoint, keys } = req.body;
        const ua = req.headers["user-agent"];
        await repo.upsert({
            userId: sub,
            endpoint,
            p256dh: keys.p256dh,
            auth: keys.auth,
            userAgent: typeof ua === "string" ? ua.slice(0, 255) : null,
        });
        res.status(204).send();
    }
    catch (err) {
        next(err);
    }
});
/**
 * DELETE /api/v1/push/subscriptions — drop THIS browser's subscription
 * (sign-out / opt-out). 🔐 any member. Idempotent: an unknown endpoint is a
 * silent no-op, never an existence oracle. 204 either way.
 */
router.delete("/subscriptions", authenticate_1.default, push_1.unsubscribeValidator, validate_1.validate, async (req, res, next) => {
    try {
        const { sub } = req.auth;
        const { endpoint } = req.body;
        await repo.deleteByEndpointForUser(sub, endpoint);
        res.status(204).send();
    }
    catch (err) {
        next(err);
    }
});
exports.default = router;
