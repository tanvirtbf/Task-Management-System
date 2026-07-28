import express, {
    type NextFunction,
    type Request,
    type Response,
} from "express";
import { OnCallController } from "../controllers/OnCallController";
import { OnCallService } from "../services/OnCallService";
import { OnCallRepo } from "../repositories/OnCallRepo";
import { UsersRepo } from "../repositories/UsersRepo";
import { getDb } from "../db/client";
import logger from "../config/logger";
import authenticate from "../middlewares/authenticate";
import { requirePermission } from "../middlewares/requirePermission";
import { validate } from "../middlewares/validate";
import {
    scheduleQueryValidator,
    setOnCallValidator,
    weekStartParamValidator,
} from "../validators/onCall";
import type { AuthRequest } from "../types";
import type { SetOnCallRequest } from "../types/onCall";

const router = express.Router();

// ─── DI wiring ───────────────────────────────────────────────────────────────
// `getDb()` works because `server.ts` calls `initDb()` before this module is
// imported transitively through `app.ts`.
const db = getDb();
const onCallRepo = new OnCallRepo(db);
const usersRepo = new UsersRepo(db);
const service = new OnCallService(db, onCallRepo, usersRepo, logger);
const controller = new OnCallController(service, logger);

// ─── GET /api/v1/on-call/current ──────────────────────────────────────────────
// 🔐 any authenticated member. The shift covering today, scoped to
// `req.auth.workspaceId` (never client input). Returns a bare object, or null.
router.get(
    "/current",
    authenticate,
    (req: Request, res: Response, next: NextFunction) =>
        controller.current(req as AuthRequest, res, next),
);

// ─── GET /api/v1/on-call/schedule ─────────────────────────────────────────────
// 🔐 any authenticated member. Every shift in the workspace, chronological,
// optionally windowed by `?from=&to=` (YYYY-MM-DD). Returns { data, pagination }.
// Registered before any `/:weekStart` route so the literal path wins.
router.get(
    "/schedule",
    authenticate,
    scheduleQueryValidator,
    validate,
    (req: Request, res: Response, next: NextFunction) =>
        controller.schedule(req as AuthRequest, res, next),
);

// ─── PUT /api/v1/on-call/:weekStart ───────────────────────────────────────────
// 👑 admin/owner only. Upsert the on-call engineer for a Monday-keyed week.
// Chain order encodes the status precedence: authenticate (401) → requirePermission
// (403) → validation (422). Registered AFTER the literal /current + /schedule
// routes so those win over this `:weekStart` param.
router.put(
    "/:weekStart",
    authenticate,
    requirePermission("oncall.manage"),
    setOnCallValidator,
    validate,
    (req: Request, res: Response, next: NextFunction) =>
        controller.set(req as SetOnCallRequest, res, next),
);

// ─── DELETE /api/v1/on-call/:weekStart ────────────────────────────────────────
// 👑 admin/owner only. Clear a week's on-call assignment. Same chain/precedence
// as PUT: authenticate (401) → requirePermission (403) → validation (422). 404 if no
// shift exists for the week; 204 on success.
router.delete(
    "/:weekStart",
    authenticate,
    requirePermission("oncall.manage"),
    weekStartParamValidator,
    validate,
    (req: Request, res: Response, next: NextFunction) =>
        controller.delete(req as AuthRequest, res, next),
);

export default router;
