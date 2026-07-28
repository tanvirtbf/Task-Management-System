"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const OnCallController_1 = require("../controllers/OnCallController");
const OnCallService_1 = require("../services/OnCallService");
const OnCallRepo_1 = require("../repositories/OnCallRepo");
const UsersRepo_1 = require("../repositories/UsersRepo");
const client_1 = require("../db/client");
const logger_1 = __importDefault(require("../config/logger"));
const authenticate_1 = __importDefault(require("../middlewares/authenticate"));
const requirePermission_1 = require("../middlewares/requirePermission");
const validate_1 = require("../middlewares/validate");
const onCall_1 = require("../validators/onCall");
const router = express_1.default.Router();
// ─── DI wiring ───────────────────────────────────────────────────────────────
// `getDb()` works because `server.ts` calls `initDb()` before this module is
// imported transitively through `app.ts`.
const db = (0, client_1.getDb)();
const onCallRepo = new OnCallRepo_1.OnCallRepo(db);
const usersRepo = new UsersRepo_1.UsersRepo(db);
const service = new OnCallService_1.OnCallService(db, onCallRepo, usersRepo, logger_1.default);
const controller = new OnCallController_1.OnCallController(service, logger_1.default);
// ─── GET /api/v1/on-call/current ──────────────────────────────────────────────
// 🔐 any authenticated member. The shift covering today, scoped to
// `req.auth.workspaceId` (never client input). Returns a bare object, or null.
router.get("/current", authenticate_1.default, (req, res, next) => controller.current(req, res, next));
// ─── GET /api/v1/on-call/schedule ─────────────────────────────────────────────
// 🔐 any authenticated member. Every shift in the workspace, chronological,
// optionally windowed by `?from=&to=` (YYYY-MM-DD). Returns { data, pagination }.
// Registered before any `/:weekStart` route so the literal path wins.
router.get("/schedule", authenticate_1.default, onCall_1.scheduleQueryValidator, validate_1.validate, (req, res, next) => controller.schedule(req, res, next));
// ─── PUT /api/v1/on-call/:weekStart ───────────────────────────────────────────
// 👑 admin/owner only. Upsert the on-call engineer for a Monday-keyed week.
// Chain order encodes the status precedence: authenticate (401) → requirePermission
// (403) → validation (422). Registered AFTER the literal /current + /schedule
// routes so those win over this `:weekStart` param.
router.put("/:weekStart", authenticate_1.default, (0, requirePermission_1.requirePermission)("oncall.manage"), onCall_1.setOnCallValidator, validate_1.validate, (req, res, next) => controller.set(req, res, next));
// ─── DELETE /api/v1/on-call/:weekStart ────────────────────────────────────────
// 👑 admin/owner only. Clear a week's on-call assignment. Same chain/precedence
// as PUT: authenticate (401) → requirePermission (403) → validation (422). 404 if no
// shift exists for the week; 204 on success.
router.delete("/:weekStart", authenticate_1.default, (0, requirePermission_1.requirePermission)("oncall.manage"), onCall_1.weekStartParamValidator, validate_1.validate, (req, res, next) => controller.delete(req, res, next));
exports.default = router;
