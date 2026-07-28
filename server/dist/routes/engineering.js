"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const EngineeringController_1 = require("../controllers/EngineeringController");
const EngineeringService_1 = require("../services/EngineeringService");
const EngineeringRepo_1 = require("../repositories/EngineeringRepo");
const TaskWriteService_1 = require("../services/TaskWriteService");
const TasksService_1 = require("../services/TasksService");
const UsersRepo_1 = require("../repositories/UsersRepo");
const TasksRepo_1 = require("../repositories/TasksRepo");
const ListsRepo_1 = require("../repositories/ListsRepo");
const StatusesRepo_1 = require("../repositories/StatusesRepo");
const TaskTypesRepo_1 = require("../repositories/TaskTypesRepo");
const TaskMembershipRepo_1 = require("../repositories/TaskMembershipRepo");
const TaskActivityRepo_1 = require("../repositories/TaskActivityRepo");
const NotificationsRepo_1 = require("../repositories/NotificationsRepo");
const TagsRepo_1 = require("../repositories/TagsRepo");
const client_1 = require("../db/client");
const logger_1 = __importDefault(require("../config/logger"));
const authenticate_1 = __importDefault(require("../middlewares/authenticate"));
const validate_1 = require("../middlewares/validate");
const engineering_1 = require("../validators/engineering");
const router = express_1.default.Router();
// ─── DI wiring ───────────────────────────────────────────────────────────────
// §22 composes the §10 task-create pipeline, so it builds a `TaskWriteService`
// exactly as routes/tasks.ts does. `getDb()` works because server.ts runs
// `initDb()` before app.ts imports routers transitively.
const db = (0, client_1.getDb)();
const usersRepo = new UsersRepo_1.UsersRepo(db);
const tasksRepo = new TasksRepo_1.TasksRepo(db);
const listsRepo = new ListsRepo_1.ListsRepo(db);
const statusesRepo = new StatusesRepo_1.StatusesRepo(db);
const taskTypesRepo = new TaskTypesRepo_1.TaskTypesRepo(db);
const membershipRepo = new TaskMembershipRepo_1.TaskMembershipRepo(db);
const activityRepo = new TaskActivityRepo_1.TaskActivityRepo(db);
const notificationsRepo = new NotificationsRepo_1.NotificationsRepo(db);
const tagsRepo = new TagsRepo_1.TagsRepo(db);
const tasksService = new TasksService_1.TasksService(listsRepo, tasksRepo);
const taskWriteService = new TaskWriteService_1.TaskWriteService(db, listsRepo, statusesRepo, taskTypesRepo, tasksRepo, membershipRepo, usersRepo, tagsRepo, activityRepo, notificationsRepo, tasksService, logger_1.default);
const engRepo = new EngineeringRepo_1.EngineeringRepo(db);
const service = new EngineeringService_1.EngineeringService(engRepo, taskWriteService, tasksRepo, usersRepo, logger_1.default);
const controller = new EngineeringController_1.EngineeringController(service, logger_1.default);
// ─── POST /api/v1/eng/report-bug ──────────────────────────────────────────────
// 🔐 any authenticated member (every team can report a bug). The router declares
// full `/eng/*` paths and mounts at the v1 root (no `/eng` prefix collides with
// the existing routers). Chain: authenticate (401) → validate (422) → handler.
router.post("/eng/report-bug", authenticate_1.default, engineering_1.reportBugValidator, validate_1.validate, (req, res, next) => controller.reportBug(req, res, next));
// ─── GET /api/v1/eng/home ─────────────────────────────────────────────────────
// 🔐 any authenticated member. Per-caller dashboard rollup (open bugs/incidents,
// my sprint tasks, PRs awaiting me, stale tickets, current on-call, active
// sprint) in one round-trip. No body/params to validate.
router.get("/eng/home", authenticate_1.default, (req, res, next) => controller.getHome(req, res, next));
// ─── GET /api/v1/eng/incidents/:id/postmortem ─────────────────────────────────
// 🔐 any authenticated member (gap-scan H5). Read the saved checklist so the
// UI can rehydrate; empty items (200) when nothing is saved yet.
router.get("/eng/incidents/:id/postmortem", authenticate_1.default, engineering_1.getPostmortemValidator, validate_1.validate, (req, res, next) => controller.getPostmortem(req, res, next));
// ─── POST /api/v1/eng/incidents/:id/postmortem ────────────────────────────────
// 🔐 any authenticated member. Save (upsert) the postmortem checklist on a
// resolved Incident task. Chain: authenticate (401) → validate (422) → handler;
// the service enforces the type/status preconditions (409).
router.post("/eng/incidents/:id/postmortem", authenticate_1.default, engineering_1.createPostmortemValidator, validate_1.validate, (req, res, next) => controller.createPostmortem(req, res, next));
exports.default = router;
