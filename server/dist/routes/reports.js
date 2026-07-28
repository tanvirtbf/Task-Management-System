"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const ReportsController_1 = require("../controllers/ReportsController");
const ReportsService_1 = require("../services/ReportsService");
const DepartmentReportsRepo_1 = require("../repositories/DepartmentReportsRepo");
const SpacesRepo_1 = require("../repositories/SpacesRepo");
const UsersRepo_1 = require("../repositories/UsersRepo");
const ReviewsRepo_1 = require("../repositories/ReviewsRepo");
const TasksRepo_1 = require("../repositories/TasksRepo");
const NotificationsRepo_1 = require("../repositories/NotificationsRepo");
const ReportStatsService_1 = require("../services/ReportStatsService");
const client_1 = require("../db/client");
const logger_1 = __importDefault(require("../config/logger"));
const authenticate_1 = __importDefault(require("../middlewares/authenticate"));
const requirePermission_1 = require("../middlewares/requirePermission");
const rateLimit_1 = require("../middlewares/rateLimit");
const validate_1 = require("../middlewares/validate");
const reports_1 = require("../validators/reports");
/**
 * Dept Review V1 — /api/v1/reports (A-6/A-7; P21 adds POST /generate + the
 * note/ack writers — the `/generate` LITERAL must be registered BEFORE the
 * `/:id` catch-all when it lands).
 */
const router = express_1.default.Router();
// ─── DI wiring ───────────────────────────────────────────────────────────────
const db = (0, client_1.getDb)();
const departmentReportsRepo = new DepartmentReportsRepo_1.DepartmentReportsRepo(db);
const spacesRepo = new SpacesRepo_1.SpacesRepo(db);
const usersRepo = new UsersRepo_1.UsersRepo(db);
const reportStatsService = new ReportStatsService_1.ReportStatsService(new ReviewsRepo_1.ReviewsRepo(db), new TasksRepo_1.TasksRepo(db), usersRepo, logger_1.default);
const reportsService = new ReportsService_1.ReportsService(db, departmentReportsRepo, spacesRepo, usersRepo, reportStatsService, new NotificationsRepo_1.NotificationsRepo(db), logger_1.default);
const reportsController = new ReportsController_1.ReportsController(reportsService, logger_1.default);
// ─── GET /api/v1/reports ─────────────────────────────────────────────────────
// Authenticated. Owner/admin see every department's reports; anyone else sees
// exactly their current-headship spaces' rows plus rows where they are the
// SNAPSHOT head (service-enforced). Cursor-paginated, newest week first.
router.get("/", authenticate_1.default, reports_1.listReportsValidator, validate_1.validate, (req, res, next) => reportsController.list(req, res, next));
// ─── POST /api/v1/reports/generate ───────────────────────────────────────────
// Dept Review V1 (A-8). LITERAL — declared BEFORE the `/:id` routes (the
// /tasks/my-work ordering lesson). Owner/admin or the space's CURRENT head
// (service-enforced); `week_start` must be a past Dhaka Monday (422
// report.invalid_week). 10/min/user post-auth limiter (report computation
// fans out several aggregate queries). Shares the job's generation path —
// the notified_at claim keeps the fanout exactly-once per (space, week).
router.post("/generate", authenticate_1.default, rateLimit_1.reportGenerateLimiter, reports_1.generateReportValidator, validate_1.validate, (req, res, next) => reportsController.generate(req, res, next));
// ─── GET /api/v1/reports/:id ─────────────────────────────────────────────────
// Authenticated; same visibility gate → 403 report.forbidden / 404
// report.not_found. Returns the full payload snapshot.
router.get("/:id", authenticate_1.default, reports_1.getReportValidator, validate_1.validate, (req, res, next) => reportsController.getById(req, res, next));
// ─── PATCH /api/v1/reports/:id ───────────────────────────────────────────────
// Dept Review V1 (A-9). The SNAPSHOT head's note (≤1000; null clears) —
// service-enforced strict gate (even admins may not write it). Survives
// regeneration by the upsert invariant.
router.patch("/:id", authenticate_1.default, reports_1.headNoteValidator, validate_1.validate, (req, res, next) => reportsController.setNote(req, res, next));
// ─── POST /api/v1/reports/:id/ack ────────────────────────────────────────────
// Dept Review V1 (A-10). 👑 owner/admin — HR "Mark seen". Idempotent 200:
// first ack's actor/timestamp stick, repeats return them unchanged.
router.post("/:id/ack", authenticate_1.default, (0, requirePermission_1.requirePermission)("report.ack"), reports_1.ackReportValidator, validate_1.validate, (req, res, next) => reportsController.ack(req, res, next));
exports.default = router;
