"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const SlaController_1 = require("../controllers/SlaController");
const SlaService_1 = require("../services/SlaService");
const SlaRepo_1 = require("../repositories/SlaRepo");
const TasksService_1 = require("../services/TasksService");
const TasksRepo_1 = require("../repositories/TasksRepo");
const ListsRepo_1 = require("../repositories/ListsRepo");
const UsersRepo_1 = require("../repositories/UsersRepo");
const TaskActivityRepo_1 = require("../repositories/TaskActivityRepo");
const client_1 = require("../db/client");
const logger_1 = __importDefault(require("../config/logger"));
const authenticate_1 = __importDefault(require("../middlewares/authenticate"));
const requirePermission_1 = require("../middlewares/requirePermission");
const validate_1 = require("../middlewares/validate");
const sla_1 = require("../validators/sla");
const router = express_1.default.Router();
// ─── DI wiring ───────────────────────────────────────────────────────────────
const db = (0, client_1.getDb)();
const tasksRepo = new TasksRepo_1.TasksRepo(db);
const listsRepo = new ListsRepo_1.ListsRepo(db);
const usersRepo = new UsersRepo_1.UsersRepo(db);
const activityRepo = new TaskActivityRepo_1.TaskActivityRepo(db);
const slaRepo = new SlaRepo_1.SlaRepo(db);
const tasksService = new TasksService_1.TasksService(listsRepo, tasksRepo); // reads, for hydration
const service = new SlaService_1.SlaService(db, slaRepo, tasksRepo, usersRepo, activityRepo, tasksService, logger_1.default);
const controller = new SlaController_1.SlaController(service, logger_1.default);
// ─── GET /api/v1/sla/breached ─────────────────────────────────────────────────
// 🔐 any authenticated member (dashboard read). Workspace-scoped breached-SLA
// list. The router declares full paths spanning `/sla/breached` and
// `/tasks/:id/sla`, so it mounts at the v1 root.
router.get("/sla/breached", authenticate_1.default, sla_1.breachedSlaValidator, validate_1.validate, (req, res, next) => controller.listBreached(req, res, next));
// ─── PATCH /api/v1/tasks/:id/sla ──────────────────────────────────────────────
// 👑 owner/admin override of sla_due_at. MUST be registered before the `/tasks`
// router so its 3-segment path resolves cleanly. requirePermission gives a route-level
// 403; the future-timestamp rule (422 sla.invalid_due_at) is enforced in-service.
router.patch("/tasks/:id/sla", authenticate_1.default, (0, requirePermission_1.requirePermission)("task.sla_override"), sla_1.overrideSlaValidator, validate_1.validate, (req, res, next) => controller.override(req, res, next));
exports.default = router;
