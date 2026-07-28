import express, {
    type NextFunction,
    type Request,
    type Response,
} from "express";
import { TaskTypeController } from "../controllers/TaskTypeController";
import { TaskTypeService } from "../services/TaskTypeService";
import { TaskTypesRepo } from "../repositories/TaskTypesRepo";
import { WorkspaceActivityRepo } from "../repositories/WorkspaceActivityRepo";
import { getDb } from "../db/client";
import logger from "../config/logger";
import authenticate from "../middlewares/authenticate";
import { requirePermission } from "../middlewares/requirePermission";
import { validate } from "../middlewares/validate";
import {
    createTaskTypeValidator,
    deleteTaskTypeValidator,
    updateTaskTypeValidator,
} from "../validators/taskTypes";
import type { AuthRequest } from "../types";
import type {
    CreateTaskTypeRequest,
    UpdateTaskTypeRequest,
} from "../types/taskTypes";

const router = express.Router();

// ─── DI wiring ───────────────────────────────────────────────────────────────
// `getDb()` works because `server.ts` calls `initDb()` before this module is
// imported transitively through `app.ts`.
const db = getDb();
const taskTypesRepo = new TaskTypesRepo(db);
const workspaceActivityRepo = new WorkspaceActivityRepo(db);
const taskTypeService = new TaskTypeService(
    db,
    taskTypesRepo,
    workspaceActivityRepo,
);
const taskTypeController = new TaskTypeController(taskTypeService, logger);

// ─── GET /api/v1/task-types ──────────────────────────────────────────────────
// Authenticated — any role may list the workspace's task types (only create /
// update / delete are owner/admin per Appendix B). Workspace scoping comes from
// `req.auth.workspaceId`, never from client input.
router.get(
    "/",
    authenticate,
    (req: Request, res: Response, next: NextFunction) =>
        taskTypeController.list(req as AuthRequest, res, next),
);

// ─── POST /api/v1/task-types ─────────────────────────────────────────────────
// 👑 Owner/admin only. `requirePermission` runs before validation so a member is
// rejected (403) without their body being inspected. The new type is created
// in the caller's workspace (`req.auth.workspaceId`).
router.post(
    "/",
    authenticate,
    requirePermission("catalog.task_types"),
    createTaskTypeValidator,
    validate,
    (req: Request, res: Response, next: NextFunction) =>
        taskTypeController.create(req as CreateTaskTypeRequest, res, next),
);

// ─── PATCH /api/v1/task-types/:id ────────────────────────────────────────────
// 👑 Owner/admin only. `requirePermission` runs before validation so a member is
// rejected (403) without their body being inspected. Editing the seeded
// `is_system` types is restricted to icon/color/description (enforced in the
// service); workspace scoping comes from `req.auth.workspaceId`.
router.patch(
    "/:id",
    authenticate,
    requirePermission("catalog.task_types"),
    updateTaskTypeValidator,
    validate,
    (req: Request, res: Response, next: NextFunction) =>
        taskTypeController.update(req as UpdateTaskTypeRequest, res, next),
);

// ─── DELETE /api/v1/task-types/:id ───────────────────────────────────────────
// 👑 Owner/admin only. `requirePermission` runs before validation so a member is
// rejected (403) without their target being inspected. Refuses with 403
// `task_type.system` for a seeded system type and 409 `task_type.in_use` when a
// task or list still references it; otherwise deletes the row + writes a
// `workspace_activity` "deleted" row in one transaction and returns 204.
router.delete(
    "/:id",
    authenticate,
    requirePermission("catalog.task_types"),
    deleteTaskTypeValidator,
    validate,
    (req: Request, res: Response, next: NextFunction) =>
        taskTypeController.remove(req as AuthRequest, res, next),
);

export default router;
