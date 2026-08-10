import express, {
    type NextFunction,
    type Request,
    type Response,
} from "express";
import { getDb } from "../db/client";
import { AppError } from "../errors";
import authenticate from "../middlewares/authenticate";
import { validate } from "../middlewares/validate";
import { PushSubscriptionsRepo } from "../repositories/PushSubscriptionsRepo";
import { pushSvc } from "../services/PushService";
import { subscribeValidator, unsubscribeValidator } from "../validators/push";

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

const router = express.Router();

// `getDb()` works because `server.ts` calls `initDb()` before `app.ts` (and
// therefore this module) is imported.
const repo = new PushSubscriptionsRepo(getDb());

interface AuthedRequest extends Request {
    auth: { sub: string };
}

/** GET /api/v1/push/public-key — the applicationServerKey. 🔐 any member. */
router.get(
    "/public-key",
    authenticate,
    (_req: Request, res: Response, next: NextFunction) => {
        const key = pushSvc().publicKey();
        if (!key) {
            return next(
                new AppError(
                    503,
                    "push.not_configured",
                    "Web Push is not configured on this server",
                ),
            );
        }
        res.status(200).json({ public_key: key });
    },
);

/**
 * POST /api/v1/push/subscriptions — register/refresh THIS browser. 🔐 any
 * member. Idempotent: the same endpoint upserts (and re-binds the device to
 * the current user on a shared computer). 204 on success.
 */
router.post(
    "/subscriptions",
    authenticate,
    subscribeValidator,
    validate,
    async (req: Request, res: Response, next: NextFunction) => {
        try {
            const { sub } = (req as AuthedRequest).auth;
            const { endpoint, keys } = req.body as {
                endpoint: string;
                keys: { p256dh: string; auth: string };
            };
            const ua = req.headers["user-agent"];
            await repo.upsert({
                userId: sub,
                endpoint,
                p256dh: keys.p256dh,
                auth: keys.auth,
                userAgent: typeof ua === "string" ? ua.slice(0, 255) : null,
            });
            res.status(204).send();
        } catch (err) {
            next(err);
        }
    },
);

/**
 * DELETE /api/v1/push/subscriptions — drop THIS browser's subscription
 * (sign-out / opt-out). 🔐 any member. Idempotent: an unknown endpoint is a
 * silent no-op, never an existence oracle. 204 either way.
 */
router.delete(
    "/subscriptions",
    authenticate,
    unsubscribeValidator,
    validate,
    async (req: Request, res: Response, next: NextFunction) => {
        try {
            const { sub } = (req as AuthedRequest).auth;
            const { endpoint } = req.body as { endpoint: string };
            await repo.deleteByEndpointForUser(sub, endpoint);
            res.status(204).send();
        } catch (err) {
            next(err);
        }
    },
);

export default router;
