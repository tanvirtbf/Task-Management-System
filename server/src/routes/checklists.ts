import express, {
    type NextFunction,
    type Request,
    type Response,
} from "express";
import { ChecklistsController } from "../controllers/ChecklistsController";
import { ChecklistsService } from "../services/ChecklistsService";
import { ChecklistsRepo } from "../repositories/ChecklistsRepo";
import { TasksRepo } from "../repositories/TasksRepo";
import { UsersRepo } from "../repositories/UsersRepo";
import { TaskActivityRepo } from "../repositories/TaskActivityRepo";
import { getDb } from "../db/client";
import logger from "../config/logger";
import authenticate from "../middlewares/authenticate";
import { requirePermission } from "../middlewares/requirePermission";
import { validate } from "../middlewares/validate";
import {
    addItemValidator,
    bulkAddItemsValidator,
    checklistIdParamValidator,
    createChecklistValidator,
    itemIdParamValidator,
    listChecklistsValidator,
    updateChecklistValidator,
    updateItemValidator, updateItemBodyGuard,
} from "../validators/checklists";
import type { AuthRequest } from "../types";
import type {
    AddItemRequest,
    BulkAddItemsRequest,
    CreateChecklistRequest,
    UpdateChecklistRequest,
    UpdateItemRequest,
} from "../types/checklists";

/**
 * §15 Checklists router. Declares FULL paths (spanning `/tasks/:id/checklists`,
 * `/checklists/:id*`, and `/checklist-items/:id*`), so it mounts at the v1 ROOT
 * — and BEFORE the `/tasks` mount, so the 3-segment `/tasks/:id/checklists`
 * resolves ahead of the tasks router's `/:id` catch-alls (same pattern as §14
 * comments / §17 custom-fields).
 */
const router = express.Router();

// ─── DI wiring ───────────────────────────────────────────────────────────────
const db = getDb();
const checklistsRepo = new ChecklistsRepo(db);
const tasksRepo = new TasksRepo(db);
const usersRepo = new UsersRepo(db);
const activityRepo = new TaskActivityRepo(db);
const service = new ChecklistsService(
    db,
    checklistsRepo,
    tasksRepo,
    usersRepo,
    activityRepo,
);
const controller = new ChecklistsController(service, logger);

// ─── GET /api/v1/tasks/:id/checklists ─────────────────────────────────────────
// 🔐 any member. All checklists for a task, each with its items nested.
router.get(
    "/tasks/:id/checklists",
    authenticate,
    listChecklistsValidator,
    validate,
    (req: Request, res: Response, next: NextFunction) =>
        controller.listForTask(req as AuthRequest, res, next),
);

// ─── POST /api/v1/tasks/:id/checklists ────────────────────────────────────────
// 🔐 any member. Create an empty checklist on the task. 201.
router.post(
    "/tasks/:id/checklists",
    authenticate,
    requirePermission("checklist.manage"),
    createChecklistValidator,
    validate,
    (req: Request, res: Response, next: NextFunction) =>
        controller.createChecklist(req as CreateChecklistRequest, res, next),
);

// ─── PATCH /api/v1/checklists/:id ─────────────────────────────────────────────
// 🔐 any member. Rename / reposition a checklist. 200.
router.patch(
    "/checklists/:id",
    authenticate,
    requirePermission("checklist.manage"),
    updateChecklistValidator,
    validate,
    (req: Request, res: Response, next: NextFunction) =>
        controller.updateChecklist(req as UpdateChecklistRequest, res, next),
);

// ─── DELETE /api/v1/checklists/:id ────────────────────────────────────────────
// 🔐 any member. Delete a checklist (cascades to items). 204.
router.delete(
    "/checklists/:id",
    authenticate,
    requirePermission("checklist.manage"),
    checklistIdParamValidator,
    validate,
    (req: Request, res: Response, next: NextFunction) =>
        controller.removeChecklist(req as AuthRequest, res, next),
);

// ─── POST /api/v1/checklists/:id/items ────────────────────────────────────────
// 🔐 any member. Add a single item. 201.
router.post(
    "/checklists/:id/items",
    authenticate,
    requirePermission("checklist.manage"),
    addItemValidator,
    validate,
    (req: Request, res: Response, next: NextFunction) =>
        controller.addItem(req as AddItemRequest, res, next),
);

// ─── POST /api/v1/checklists/:id/items/bulk ───────────────────────────────────
// 🔐 any member. Add many items in one transaction (template apply). 201.
router.post(
    "/checklists/:id/items/bulk",
    authenticate,
    requirePermission("checklist.manage"),
    bulkAddItemsValidator,
    validate,
    (req: Request, res: Response, next: NextFunction) =>
        controller.bulkAddItems(req as BulkAddItemsRequest, res, next),
);

// ─── PATCH /api/v1/checklist-items/:id ────────────────────────────────────────
// 🔐 any member. Edit item text / assignee / position. Logs task_activity. 200.
router.patch(
    "/checklist-items/:id",
    authenticate,
    requirePermission("checklist.manage"),
    updateItemValidator,
    updateItemBodyGuard,
    validate,
    (req: Request, res: Response, next: NextFunction) =>
        controller.updateItem(req as UpdateItemRequest, res, next),
);

// ─── POST /api/v1/checklist-items/:id/toggle ──────────────────────────────────
// 🔐 any member. Tick / untick the checkbox. Logs task_activity. 200.
router.post(
    "/checklist-items/:id/toggle",
    authenticate,
    requirePermission("checklist.manage"),
    itemIdParamValidator,
    validate,
    (req: Request, res: Response, next: NextFunction) =>
        controller.toggleItem(req as AuthRequest, res, next),
);

// ─── DELETE /api/v1/checklist-items/:id ───────────────────────────────────────
// 🔐 any member. Remove an item. 204.
router.delete(
    "/checklist-items/:id",
    authenticate,
    requirePermission("checklist.manage"),
    itemIdParamValidator,
    validate,
    (req: Request, res: Response, next: NextFunction) =>
        controller.removeItem(req as AuthRequest, res, next),
);

export default router;
