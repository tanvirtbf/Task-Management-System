"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const TaskDependenciesController_1 = require("../controllers/TaskDependenciesController");
const TaskDependenciesService_1 = require("../services/TaskDependenciesService");
const TaskDependenciesRepo_1 = require("../repositories/TaskDependenciesRepo");
const TasksRepo_1 = require("../repositories/TasksRepo");
const TaskActivityRepo_1 = require("../repositories/TaskActivityRepo");
const client_1 = require("../db/client");
const logger_1 = __importDefault(require("../config/logger"));
const authenticate_1 = __importDefault(require("../middlewares/authenticate"));
const requirePermission_1 = require("../middlewares/requirePermission");
const validate_1 = require("../middlewares/validate");
const taskDependencies_1 = require("../validators/taskDependencies");
const router = express_1.default.Router();
// ─── DI wiring ───────────────────────────────────────────────────────────────
// `getDb()` works because `server.ts` calls `initDb()` before this module is
// imported transitively through `app.ts`.
const db = (0, client_1.getDb)();
const depsRepo = new TaskDependenciesRepo_1.TaskDependenciesRepo(db);
const tasksRepo = new TasksRepo_1.TasksRepo(db);
const activityRepo = new TaskActivityRepo_1.TaskActivityRepo(db);
const service = new TaskDependenciesService_1.TaskDependenciesService(db, depsRepo, tasksRepo, activityRepo, logger_1.default);
const controller = new TaskDependenciesController_1.TaskDependenciesController(service, logger_1.default);
// ─── GET /api/v1/tasks/:id/dependencies ───────────────────────────────────────
// 🔐 any authenticated member. Returns both directions ({ blocks, blocked_by }),
// each edge carrying the hydrated other-end Task. The task is resolved within
// `req.auth.workspaceId` (404 `task.not_found`). This router declares full paths
// and mounts at the v1 root because §12's routes span the `/tasks` and
// `/task-dependencies` prefixes (mirrors routes/lists.ts and routes/statuses.ts).
router.get("/tasks/:id/dependencies", authenticate_1.default, taskDependencies_1.dependencyIdParamValidator, validate_1.validate, (req, res, next) => controller.getForTask(req, res, next));
// ─── POST /api/v1/task-dependencies ───────────────────────────────────────────
// 🔐 any authenticated member. Adds a `blocks` edge `task_id → related_task_id`.
// Chain: `authenticate` (401) → validation (422) → handler. Guards: 422
// `dep.self` (self-loop), 404 `task.not_found` (either endpoint), 422 `dep.cycle`
// (would close a cycle), 409 `dep.duplicate` (edge exists). Workspace scope + the
// actor come from `req.auth`, never the body. Returns 201 with the created edge.
router.post("/task-dependencies", authenticate_1.default, (0, requirePermission_1.requirePermission)("dependency.manage"), taskDependencies_1.createDependencyValidator, validate_1.validate, (req, res, next) => controller.create(req, res, next));
// ─── DELETE /api/v1/task-dependencies/:id ─────────────────────────────────────
// 🔐 any authenticated member. Removes one edge resolved within the caller's
// workspace (404 `dep.not_found` otherwise). Returns 204.
router.delete("/task-dependencies/:id", authenticate_1.default, (0, requirePermission_1.requirePermission)("dependency.manage"), taskDependencies_1.dependencyIdParamValidator, validate_1.validate, (req, res, next) => controller.delete(req, res, next));
exports.default = router;
