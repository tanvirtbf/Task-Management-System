"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const SprintsController_1 = require("../controllers/SprintsController");
const SprintsService_1 = require("../services/SprintsService");
const SprintsRepo_1 = require("../repositories/SprintsRepo");
const WorkspaceActivityRepo_1 = require("../repositories/WorkspaceActivityRepo");
const TaskActivityRepo_1 = require("../repositories/TaskActivityRepo");
const ListsRepo_1 = require("../repositories/ListsRepo");
const TasksRepo_1 = require("../repositories/TasksRepo");
const TasksService_1 = require("../services/TasksService");
const client_1 = require("../db/client");
const logger_1 = __importDefault(require("../config/logger"));
const authenticate_1 = __importDefault(require("../middlewares/authenticate"));
const requirePermission_1 = require("../middlewares/requirePermission");
const validate_1 = require("../middlewares/validate");
const sprints_1 = require("../validators/sprints");
/**
 * §20 Sprints (Engineering-only). This router declares FULL paths and mounts at
 * the v1 root (like §12 task-dependencies / §17 custom-fields) because its routes
 * span `/sprints`, `/sprints/active`, `/sprints/:id`, `/sprints/:id/start|close`,
 * and `/sprints/:id/tasks[/:taskId]`.
 *
 * Role legend: 🔐 = any member (reads + task membership), 👑 = Owner/Admin
 * (`requirePermission(...)`) for the sprint lifecycle writes. Chain order
 * encodes precedence: `authenticate` (401) → `requirePermission` (403) → validation (422).
 */
const router = express_1.default.Router();
// ─── DI wiring ───────────────────────────────────────────────────────────────
// `getDb()` works because `server.ts` calls `initDb()` before this module is
// imported transitively through `app.ts`.
const db = (0, client_1.getDb)();
const sprintsRepo = new SprintsRepo_1.SprintsRepo(db);
const wsActivityRepo = new WorkspaceActivityRepo_1.WorkspaceActivityRepo(db);
const taskActivityRepo = new TaskActivityRepo_1.TaskActivityRepo(db);
const service = new SprintsService_1.SprintsService(db, sprintsRepo, wsActivityRepo, taskActivityRepo, logger_1.default);
const controller = new SprintsController_1.SprintsController(service, logger_1.default);
// Read-side service for the cross-list sprint task board (GET /sprints/:id/tasks).
const tasksReadService = new TasksService_1.TasksService(new ListsRepo_1.ListsRepo(db), new TasksRepo_1.TasksRepo(db));
// #1 — GET /api/v1/sprints (🔐) — all sprints, optional ?status= filter.
router.get("/sprints", authenticate_1.default, sprints_1.listSprintsValidator, validate_1.validate, (req, res, next) => controller.list(req, res, next));
// #2 — GET /api/v1/sprints/active (🔐). Declared BEFORE `/sprints/:id` so the
// static segment isn't captured as an `:id`.
router.get("/sprints/active", authenticate_1.default, (req, res, next) => controller.getActive(req, res, next));
// #3 — GET /api/v1/sprints/:id (🔐).
router.get("/sprints/:id", authenticate_1.default, sprints_1.sprintIdParamValidator, validate_1.validate, (req, res, next) => controller.getById(req, res, next));
// GET /api/v1/sprints/:id/tasks (🔐) — the sprint's tasks across ALL lists
// (a sprint spans lists). Bare hydrated WireTask[]; empty array if none.
//
// P6: this used to go straight to the task query, which is workspace-scoped —
// so no data ever crossed a tenant, but a sprint id from ANOTHER workspace (or
// one that never existed, or one just deleted) answered `200 []` while its
// sibling `GET /sprints/:id` answered 404. "This sprint has no tasks" and "there
// is no such sprint" are different sentences, and a board rendering the first
// for the second is the same class of quiet lie as returning success for a
// write that did not happen. Resolving the sprint first makes the two routes
// agree, and reuses `getById`'s own 404 rather than inventing a second one.
router.get("/sprints/:id/tasks", authenticate_1.default, sprints_1.sprintIdParamValidator, validate_1.validate, async (req, res, next) => {
    try {
        const r = req;
        await service.getById({
            id: r.params.id,
            workspaceId: r.auth.workspaceId,
        });
        const data = await tasksReadService.listBySprint({
            sprintId: r.params.id,
            workspaceId: r.auth.workspaceId,
            role: r.auth.role,
        });
        res.status(200).json(data);
    }
    catch (err) {
        next(err);
    }
});
// #4 — POST /api/v1/sprints (👑) — create a planned sprint.
router.post("/sprints", authenticate_1.default, (0, requirePermission_1.requirePermission)("sprint.manage"), sprints_1.createSprintValidator, validate_1.validate, (req, res, next) => controller.create(req, res, next));
// #5 — PATCH /api/v1/sprints/:id (👑) — partial update.
router.patch("/sprints/:id", authenticate_1.default, (0, requirePermission_1.requirePermission)("sprint.manage"), sprints_1.updateSprintValidator, validate_1.validate, (req, res, next) => controller.update(req, res, next));
// #6 — POST /api/v1/sprints/:id/start (👑) — planned → active.
router.post("/sprints/:id/start", authenticate_1.default, (0, requirePermission_1.requirePermission)("sprint.manage"), sprints_1.sprintIdParamValidator, validate_1.validate, (req, res, next) => controller.start(req, res, next));
// #7 — POST /api/v1/sprints/:id/close (👑) — active → closed.
router.post("/sprints/:id/close", authenticate_1.default, (0, requirePermission_1.requirePermission)("sprint.manage"), sprints_1.sprintIdParamValidator, validate_1.validate, (req, res, next) => controller.close(req, res, next));
// #10 — DELETE /api/v1/sprints/:id (👑) — remove a sprint entirely.
//
// F28 (ISS-013, decision D12.6). There was no way to delete a sprint at all: one
// created with wrong dates or a typo'd name was permanent and had to be removed
// with direct SQL. `sprint.manage` is the same grant that creates and updates
// one, so no new permission is introduced. An ACTIVE sprint is refused in-service
// (409 `sprint.active_immutable`); the tasks detach via the schema's existing
// `tasks.sprint_id ON DELETE SET NULL` and are never deleted.
//
// Registered BEFORE the `/sprints/:id/tasks/:taskId` route below only for
// readability — Express matches on segment count, so the two cannot collide.
router.delete("/sprints/:id", authenticate_1.default, (0, requirePermission_1.requirePermission)("sprint.manage"), sprints_1.sprintIdParamValidator, validate_1.validate, (req, res, next) => controller.remove(req, res, next));
// #8 — POST /api/v1/sprints/:id/tasks (🔐) — bulk attach tasks.
router.post("/sprints/:id/tasks", authenticate_1.default, (0, requirePermission_1.requirePermission)("sprint.assign_tasks"), sprints_1.addSprintTasksValidator, validate_1.validate, (req, res, next) => controller.addTasks(req, res, next));
// #9 — DELETE /api/v1/sprints/:id/tasks/:taskId (🔐) — detach one task.
router.delete("/sprints/:id/tasks/:taskId", authenticate_1.default, (0, requirePermission_1.requirePermission)("sprint.assign_tasks"), sprints_1.removeSprintTaskValidator, validate_1.validate, (req, res, next) => controller.removeTask(req, res, next));
exports.default = router;
