import express, {
    type NextFunction,
    type Request,
    type Response,
} from "express";
import { SprintsController } from "../controllers/SprintsController";
import { SprintsService } from "../services/SprintsService";
import { SprintsRepo } from "../repositories/SprintsRepo";
import { WorkspaceActivityRepo } from "../repositories/WorkspaceActivityRepo";
import { TaskActivityRepo } from "../repositories/TaskActivityRepo";
import { ListsRepo } from "../repositories/ListsRepo";
import { TasksRepo } from "../repositories/TasksRepo";
import { TasksService } from "../services/TasksService";
import type { AuthRequest } from "../types";
import { getDb } from "../db/client";
import logger from "../config/logger";
import authenticate from "../middlewares/authenticate";
import { canAccess } from "../middlewares/canAccess";
import { validate } from "../middlewares/validate";
import { Roles } from "../constants";
import {
    addSprintTasksValidator,
    createSprintValidator,
    listSprintsValidator,
    removeSprintTaskValidator,
    sprintIdParamValidator,
    updateSprintValidator,
} from "../validators/sprints";
import type {
    AddSprintTasksRequest,
    CloseSprintRequest,
    CreateSprintRequest,
    GetActiveSprintRequest,
    GetSprintRequest,
    ListSprintsRequest,
    RemoveSprintTaskRequest,
    StartSprintRequest,
    UpdateSprintRequest,
} from "../types/sprints";

/**
 * §20 Sprints (Engineering-only). This router declares FULL paths and mounts at
 * the v1 root (like §12 task-dependencies / §17 custom-fields) because its routes
 * span `/sprints`, `/sprints/active`, `/sprints/:id`, `/sprints/:id/start|close`,
 * and `/sprints/:id/tasks[/:taskId]`.
 *
 * Role legend: 🔐 = any member (reads + task membership), 👑 = Owner/Admin
 * (`canAccess([OWNER, ADMIN])`) for the sprint lifecycle writes. Chain order
 * encodes precedence: `authenticate` (401) → `canAccess` (403) → validation (422).
 */
const router = express.Router();

// ─── DI wiring ───────────────────────────────────────────────────────────────
// `getDb()` works because `server.ts` calls `initDb()` before this module is
// imported transitively through `app.ts`.
const db = getDb();
const sprintsRepo = new SprintsRepo(db);
const wsActivityRepo = new WorkspaceActivityRepo(db);
const taskActivityRepo = new TaskActivityRepo(db);
const service = new SprintsService(
    db,
    sprintsRepo,
    wsActivityRepo,
    taskActivityRepo,
    logger,
);
const controller = new SprintsController(service, logger);
// Read-side service for the cross-list sprint task board (GET /sprints/:id/tasks).
const tasksReadService = new TasksService(new ListsRepo(db), new TasksRepo(db));

// #1 — GET /api/v1/sprints (🔐) — all sprints, optional ?status= filter.
router.get(
    "/sprints",
    authenticate,
    listSprintsValidator,
    validate,
    (req: Request, res: Response, next: NextFunction) =>
        controller.list(req as ListSprintsRequest, res, next),
);

// #2 — GET /api/v1/sprints/active (🔐). Declared BEFORE `/sprints/:id` so the
// static segment isn't captured as an `:id`.
router.get(
    "/sprints/active",
    authenticate,
    (req: Request, res: Response, next: NextFunction) =>
        controller.getActive(req as GetActiveSprintRequest, res, next),
);

// #3 — GET /api/v1/sprints/:id (🔐).
router.get(
    "/sprints/:id",
    authenticate,
    sprintIdParamValidator,
    validate,
    (req: Request, res: Response, next: NextFunction) =>
        controller.getById(req as GetSprintRequest, res, next),
);

// GET /api/v1/sprints/:id/tasks (🔐) — the sprint's tasks across ALL lists
// (a sprint spans lists). Bare hydrated WireTask[]; empty array if none.
router.get(
    "/sprints/:id/tasks",
    authenticate,
    sprintIdParamValidator,
    validate,
    async (req: Request, res: Response, next: NextFunction) => {
        try {
            const r = req as AuthRequest;
            const data = await tasksReadService.listBySprint({
                sprintId: r.params.id,
                workspaceId: r.auth.workspaceId,
                role: r.auth.role,
            });
            res.status(200).json(data);
        } catch (err) {
            next(err);
        }
    },
);

// #4 — POST /api/v1/sprints (👑) — create a planned sprint.
router.post(
    "/sprints",
    authenticate,
    canAccess([Roles.OWNER, Roles.ADMIN]),
    createSprintValidator,
    validate,
    (req: Request, res: Response, next: NextFunction) =>
        controller.create(req as CreateSprintRequest, res, next),
);

// #5 — PATCH /api/v1/sprints/:id (👑) — partial update.
router.patch(
    "/sprints/:id",
    authenticate,
    canAccess([Roles.OWNER, Roles.ADMIN]),
    updateSprintValidator,
    validate,
    (req: Request, res: Response, next: NextFunction) =>
        controller.update(req as UpdateSprintRequest, res, next),
);

// #6 — POST /api/v1/sprints/:id/start (👑) — planned → active.
router.post(
    "/sprints/:id/start",
    authenticate,
    canAccess([Roles.OWNER, Roles.ADMIN]),
    sprintIdParamValidator,
    validate,
    (req: Request, res: Response, next: NextFunction) =>
        controller.start(req as StartSprintRequest, res, next),
);

// #7 — POST /api/v1/sprints/:id/close (👑) — active → closed.
router.post(
    "/sprints/:id/close",
    authenticate,
    canAccess([Roles.OWNER, Roles.ADMIN]),
    sprintIdParamValidator,
    validate,
    (req: Request, res: Response, next: NextFunction) =>
        controller.close(req as CloseSprintRequest, res, next),
);

// #8 — POST /api/v1/sprints/:id/tasks (🔐) — bulk attach tasks.
router.post(
    "/sprints/:id/tasks",
    authenticate,
    addSprintTasksValidator,
    validate,
    (req: Request, res: Response, next: NextFunction) =>
        controller.addTasks(req as AddSprintTasksRequest, res, next),
);

// #9 — DELETE /api/v1/sprints/:id/tasks/:taskId (🔐) — detach one task.
router.delete(
    "/sprints/:id/tasks/:taskId",
    authenticate,
    removeSprintTaskValidator,
    validate,
    (req: Request, res: Response, next: NextFunction) =>
        controller.removeTask(req as RemoveSprintTaskRequest, res, next),
);

export default router;
