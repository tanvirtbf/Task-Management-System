import express, {
    type NextFunction,
    type Request,
    type Response,
} from "express";
import { ReportsController } from "../controllers/ReportsController";
import { ReportsService } from "../services/ReportsService";
import { DepartmentReportsRepo } from "../repositories/DepartmentReportsRepo";
import { SpacesRepo } from "../repositories/SpacesRepo";
import { UsersRepo } from "../repositories/UsersRepo";
import { ReviewsRepo } from "../repositories/ReviewsRepo";
import { TasksRepo } from "../repositories/TasksRepo";
import { NotificationsRepo } from "../repositories/NotificationsRepo";
import { ReportStatsService } from "../services/ReportStatsService";
import { getDb } from "../db/client";
import logger from "../config/logger";
import authenticate from "../middlewares/authenticate";
import { requirePermission } from "../middlewares/requirePermission";
import { reportGenerateLimiter } from "../middlewares/rateLimit";
import { validate } from "../middlewares/validate";
import {
    ackReportValidator,
    generateReportValidator,
    getReportValidator,
    headNoteValidator,
    listReportsValidator,
} from "../validators/reports";
import type {
    AckReportRequest,
    GenerateReportRequest,
    GetReportRequest,
    HeadNoteRequest,
    ListReportsRequest,
} from "../types/reports";

/**
 * Dept Review V1 — /api/v1/reports (A-6/A-7; P21 adds POST /generate + the
 * note/ack writers — the `/generate` LITERAL must be registered BEFORE the
 * `/:id` catch-all when it lands).
 */
const router = express.Router();

// ─── DI wiring ───────────────────────────────────────────────────────────────
const db = getDb();
const departmentReportsRepo = new DepartmentReportsRepo(db);
const spacesRepo = new SpacesRepo(db);
const usersRepo = new UsersRepo(db);
const reportStatsService = new ReportStatsService(
    new ReviewsRepo(db),
    new TasksRepo(db),
    usersRepo,
    logger,
);
const reportsService = new ReportsService(
    db,
    departmentReportsRepo,
    spacesRepo,
    usersRepo,
    reportStatsService,
    new NotificationsRepo(db),
    logger,
);
const reportsController = new ReportsController(reportsService, logger);

// ─── GET /api/v1/reports ─────────────────────────────────────────────────────
// Authenticated. Owner/admin see every department's reports; anyone else sees
// exactly their current-headship spaces' rows plus rows where they are the
// SNAPSHOT head (service-enforced). Cursor-paginated, newest week first.
router.get(
    "/",
    authenticate,
    listReportsValidator,
    validate,
    (req: Request, res: Response, next: NextFunction) =>
        reportsController.list(req as ListReportsRequest, res, next),
);

// ─── POST /api/v1/reports/generate ───────────────────────────────────────────
// Dept Review V1 (A-8). LITERAL — declared BEFORE the `/:id` routes (the
// /tasks/my-work ordering lesson). Owner/admin or the space's CURRENT head
// (service-enforced); `week_start` must be a past Dhaka Monday (422
// report.invalid_week). 10/min/user post-auth limiter (report computation
// fans out several aggregate queries). Shares the job's generation path —
// the notified_at claim keeps the fanout exactly-once per (space, week).
router.post(
    "/generate",
    authenticate,
    reportGenerateLimiter,
    generateReportValidator,
    validate,
    (req: Request, res: Response, next: NextFunction) =>
        reportsController.generate(req as GenerateReportRequest, res, next),
);

// ─── GET /api/v1/reports/:id ─────────────────────────────────────────────────
// Authenticated; same visibility gate → 403 report.forbidden / 404
// report.not_found. Returns the full payload snapshot.
router.get(
    "/:id",
    authenticate,
    getReportValidator,
    validate,
    (req: Request, res: Response, next: NextFunction) =>
        reportsController.getById(req as GetReportRequest, res, next),
);

// ─── PATCH /api/v1/reports/:id ───────────────────────────────────────────────
// Dept Review V1 (A-9). The SNAPSHOT head's note (≤1000; null clears) —
// service-enforced strict gate (even admins may not write it). Survives
// regeneration by the upsert invariant.
router.patch(
    "/:id",
    authenticate,
    headNoteValidator,
    validate,
    (req: Request, res: Response, next: NextFunction) =>
        reportsController.setNote(req as HeadNoteRequest, res, next),
);

// ─── POST /api/v1/reports/:id/ack ────────────────────────────────────────────
// Dept Review V1 (A-10). 👑 owner/admin — HR "Mark seen". Idempotent 200:
// first ack's actor/timestamp stick, repeats return them unchanged.
router.post(
    "/:id/ack",
    authenticate,
    requirePermission("report.ack"),
    ackReportValidator,
    validate,
    (req: Request, res: Response, next: NextFunction) =>
        reportsController.ack(req as AckReportRequest, res, next),
);

export default router;
