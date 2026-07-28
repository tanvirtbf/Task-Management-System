"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const SseController_1 = require("../controllers/SseController");
const NotificationStreamRepo_1 = require("../repositories/NotificationStreamRepo");
const client_1 = require("../db/client");
const logger_1 = __importDefault(require("../config/logger"));
const authenticate_1 = __importDefault(require("../middlewares/authenticate"));
/**
 * §27 Server-Sent Events. Clean `/stream` prefix (no shared path segments with
 * any other router), so it mounts at `v1.use("/stream", streamRouter)` and mount
 * order is irrelevant. Cookie auth via the shared `authenticate` middleware —
 * an `EventSource` can only authenticate by cookie.
 */
const router = express_1.default.Router();
// ─── DI wiring ───────────────────────────────────────────────────────────────
// `getDb()` works because `server.ts` calls `initDb()` before this module is
// imported transitively through `app.ts`.
const db = (0, client_1.getDb)();
const streamRepo = new NotificationStreamRepo_1.NotificationStreamRepo(db);
const controller = new SseController_1.SseController(streamRepo, logger_1.default);
// ─── GET /api/v1/stream/inbox ─────────────────────────────────────────────────
// 🔐 cookie auth. Long-lived SSE stream of the caller's notifications. Auth runs
// BEFORE any header flush, so a 401 still renders the JSON error envelope.
router.get("/inbox", authenticate_1.default, (req, res, next) => controller.streamInbox(req, res, next));
exports.default = router;
