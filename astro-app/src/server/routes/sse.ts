import express, {
    type NextFunction,
    type Request,
    type Response,
} from "express";
import { SseController } from "../controllers/SseController";
import { NotificationStreamRepo } from "../repositories/NotificationStreamRepo";
import { getDb } from "../db/client";
import logger from "../config/logger";
import authenticate from "../middlewares/authenticate";
import type { StreamInboxRequest } from "../types/sse";

/**
 * §27 Server-Sent Events. Clean `/stream` prefix (no shared path segments with
 * any other router), so it mounts at `v1.use("/stream", streamRouter)` and mount
 * order is irrelevant. Cookie auth via the shared `authenticate` middleware —
 * an `EventSource` can only authenticate by cookie.
 */
const router = express.Router();

// ─── DI wiring ───────────────────────────────────────────────────────────────
// `getDb()` works because `server.ts` calls `initDb()` before this module is
// imported transitively through `app.ts`.
const db = getDb();
const streamRepo = new NotificationStreamRepo(db);
const controller = new SseController(streamRepo, logger);

// ─── GET /api/v1/stream/inbox ─────────────────────────────────────────────────
// 🔐 cookie auth. Long-lived SSE stream of the caller's notifications. Auth runs
// BEFORE any header flush, so a 401 still renders the JSON error envelope.
router.get(
    "/inbox",
    authenticate,
    (req: Request, res: Response, next: NextFunction) =>
        controller.streamInbox(req as StreamInboxRequest, res, next),
);

export default router;
