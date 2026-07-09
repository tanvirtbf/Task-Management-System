import express, {
    type NextFunction,
    type Request,
    type Response,
} from "express";
import { TaskDependenciesController } from "../controllers/TaskDependenciesController";
import { TaskDependenciesService } from "../services/TaskDependenciesService";
import { TaskDependenciesRepo } from "../repositories/TaskDependenciesRepo";
import { TasksRepo } from "../repositories/TasksRepo";
import { TaskActivityRepo } from "../repositories/TaskActivityRepo";
import { getDb } from "../db/client";
import logger from "../config/logger";
import authenticate from "../middlewares/authenticate";
import { validate } from "../middlewares/validate";
import {
    createDependencyValidator,
    dependencyIdParamValidator,
} from "../validators/taskDependencies";
import type {
    CreateDependencyRequest,
    DeleteDependencyRequest,
    GetDependenciesRequest,
} from "../types/taskDependencies";

const router = express.Router();

// ─── DI wiring ───────────────────────────────────────────────────────────────
// `getDb()` works because `server.ts` calls `initDb()` before this module is
// imported transitively through `app.ts`.
const db = getDb();
const depsRepo = new TaskDependenciesRepo(db);
const tasksRepo = new TasksRepo(db);
const activityRepo = new TaskActivityRepo(db);
const service = new TaskDependenciesService(
    db,
    depsRepo,
    tasksRepo,
    activityRepo,
    logger,
);
const controller = new TaskDependenciesController(service, logger);

// ─── GET /api/v1/tasks/:id/dependencies ───────────────────────────────────────
// 🔐 any authenticated member. Returns both directions ({ blocks, blocked_by }),
// each edge carrying the hydrated other-end Task. The task is resolved within
// `req.auth.workspaceId` (404 `task.not_found`). This router declares full paths
// and mounts at the v1 root because §12's routes span the `/tasks` and
// `/task-dependencies` prefixes (mirrors routes/lists.ts and routes/statuses.ts).
router.get(
    "/tasks/:id/dependencies",
    authenticate,
    dependencyIdParamValidator,
    validate,
    (req: Request, res: Response, next: NextFunction) =>
        controller.getForTask(req as GetDependenciesRequest, res, next),
);

// ─── POST /api/v1/task-dependencies ───────────────────────────────────────────
// 🔐 any authenticated member. Adds a `blocks` edge `task_id → related_task_id`.
// Chain: `authenticate` (401) → validation (422) → handler. Guards: 422
// `dep.self` (self-loop), 404 `task.not_found` (either endpoint), 422 `dep.cycle`
// (would close a cycle), 409 `dep.duplicate` (edge exists). Workspace scope + the
// actor come from `req.auth`, never the body. Returns 201 with the created edge.
router.post(
    "/task-dependencies",
    authenticate,
    createDependencyValidator,
    validate,
    (req: Request, res: Response, next: NextFunction) =>
        controller.create(req as CreateDependencyRequest, res, next),
);

// ─── DELETE /api/v1/task-dependencies/:id ─────────────────────────────────────
// 🔐 any authenticated member. Removes one edge resolved within the caller's
// workspace (404 `dep.not_found` otherwise). Returns 204.
router.delete(
    "/task-dependencies/:id",
    authenticate,
    dependencyIdParamValidator,
    validate,
    (req: Request, res: Response, next: NextFunction) =>
        controller.delete(req as DeleteDependencyRequest, res, next),
);

export default router;
