"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const HomeController_1 = require("../controllers/HomeController");
const HomeService_1 = require("../services/HomeService");
const HomeRepo_1 = require("../repositories/HomeRepo");
const TasksRepo_1 = require("../repositories/TasksRepo");
const WorkspaceRepo_1 = require("../repositories/WorkspaceRepo");
const client_1 = require("../db/client");
const logger_1 = __importDefault(require("../config/logger"));
const authenticate_1 = __importDefault(require("../middlewares/authenticate"));
const validate_1 = require("../middlewares/validate");
const home_1 = require("../validators/home");
const router = express_1.default.Router();
// ─── DI wiring ───────────────────────────────────────────────────────────────
// HomeRepo owns the KPI/agenda aggregate queries; TasksRepo is reused (read-only)
// for the agenda's batched task hydration — neither is mutated.
const db = (0, client_1.getDb)();
const homeRepo = new HomeRepo_1.HomeRepo(db);
const tasksRepo = new TasksRepo_1.TasksRepo(db);
const homeService = new HomeService_1.HomeService(homeRepo, tasksRepo, new WorkspaceRepo_1.WorkspaceRepo(db));
const homeController = new HomeController_1.HomeController(homeService, logger_1.default);
// ─── GET /api/v1/home/kpis ───────────────────────────────────────────────────
// 🔐 any authenticated member. The 6 home KPI tiles, scoped to the caller's
// workspace (and user, where the metric is "my").
router.get("/kpis", authenticate_1.default, (req, res, next) => homeController.kpis(req, res, next));
// ─── GET /api/v1/home/agenda ─────────────────────────────────────────────────
// 🔐 any authenticated member. The caller's open tasks due on `?date=` (today
// by default).
router.get("/agenda", authenticate_1.default, home_1.agendaValidator, validate_1.validate, (req, res, next) => homeController.agenda(req, res, next));
exports.default = router;
