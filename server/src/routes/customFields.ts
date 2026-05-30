import express, {
    type NextFunction,
    type Request,
    type Response,
} from "express";
import { CustomFieldsController } from "../controllers/CustomFieldsController";
import { CustomFieldsService } from "../services/CustomFieldsService";
import { CustomFieldsRepo } from "../repositories/CustomFieldsRepo";
import { SpacesRepo } from "../repositories/SpacesRepo";
import { ListsRepo } from "../repositories/ListsRepo";
import { TasksRepo } from "../repositories/TasksRepo";
import { WorkspaceActivityRepo } from "../repositories/WorkspaceActivityRepo";
import { TaskActivityRepo } from "../repositories/TaskActivityRepo";
import { TasksService } from "../services/TasksService";
import { getDb } from "../db/client";
import logger from "../config/logger";
import authenticate from "../middlewares/authenticate";
import { canAccess } from "../middlewares/canAccess";
import { validate } from "../middlewares/validate";
import { Roles } from "../constants";
import {
    createCustomFieldValidator,
    customFieldIdParamValidator,
    listCustomFieldsValidator,
    listForListValidator,
    taskFieldParamsValidator,
    updateCustomFieldValidator,
} from "../validators/customFields";
import type {
    ClearFieldValueRequest,
    CreateCustomFieldRequest,
    CustomFieldIdRequest,
    ListCustomFieldsRequest,
    ListForListCustomFieldsRequest,
    SetFieldValueRequest,
    UpdateCustomFieldRequest,
} from "../types/customFields";

/**
 * §17 Custom Fields router. Declares FULL paths and is mounted at the `/api/v1`
 * ROOT (BEFORE the `/lists` and `/tasks` mounts) so its multi-segment routes
 * (`/lists/:listId/custom-fields`, `/tasks/:id/custom-fields/:fieldId`) resolve
 * ahead of those routers' catch-alls — the same pattern as `listsRouter` /
 * `taskDependenciesRouter`.
 */
const router = express.Router();

// ─── DI wiring ───────────────────────────────────────────────────────────────
const db = getDb();
const customFieldsRepo = new CustomFieldsRepo(db);
const spacesRepo = new SpacesRepo(db);
const listsRepo = new ListsRepo(db);
const tasksRepo = new TasksRepo(db);
const workspaceActivityRepo = new WorkspaceActivityRepo(db);
const taskActivityRepo = new TaskActivityRepo(db);
const tasksService = new TasksService(listsRepo, tasksRepo);
const customFieldsService = new CustomFieldsService(
    db,
    customFieldsRepo,
    spacesRepo,
    listsRepo,
    tasksRepo,
    workspaceActivityRepo,
    taskActivityRepo,
    tasksService,
);
const customFieldsController = new CustomFieldsController(
    customFieldsService,
    logger,
);

// ─── GET /api/v1/custom-fields ────────────────────────────────────────────────
// 🔐 Any member. All custom fields in the workspace (optional ?scope_type /
// ?scope_id filter). Bare CustomField[] (options inline for dropdown).
router.get(
    "/custom-fields",
    authenticate,
    listCustomFieldsValidator,
    validate,
    (req: Request, res: Response, next: NextFunction) =>
        customFieldsController.listAll(
            req as ListCustomFieldsRequest,
            res,
            next,
        ),
);

// ─── GET /api/v1/lists/:listId/custom-fields ──────────────────────────────────
// 🔐 Any member. Fields applicable to a list = workspace + the list's space +
// list-scoped fields. Bare CustomField[].
router.get(
    "/lists/:listId/custom-fields",
    authenticate,
    listForListValidator,
    validate,
    (req: Request, res: Response, next: NextFunction) =>
        customFieldsController.listForList(
            req as ListForListCustomFieldsRequest,
            res,
            next,
        ),
);

// ─── POST /api/v1/custom-fields ───────────────────────────────────────────────
// 👑 admin/owner. Create a field definition (+ dropdown options). Validates the
// type against the 6 supported values (422 custom_field.unsupported_type) and
// the scope_id against a real space/list in the workspace. 201 + CustomField.
router.post(
    "/custom-fields",
    authenticate,
    canAccess([Roles.OWNER, Roles.ADMIN]),
    createCustomFieldValidator,
    validate,
    (req: Request, res: Response, next: NextFunction) =>
        customFieldsController.create(
            req as CreateCustomFieldRequest,
            res,
            next,
        ),
);

// ─── PATCH /api/v1/custom-fields/:id ──────────────────────────────────────────
// 👑 admin/owner. Update name/config/is_required/position. type + scope are
// immutable (422 if supplied). 200 + CustomField.
router.patch(
    "/custom-fields/:id",
    authenticate,
    canAccess([Roles.OWNER, Roles.ADMIN]),
    updateCustomFieldValidator,
    validate,
    (req: Request, res: Response, next: NextFunction) =>
        customFieldsController.update(
            req as UpdateCustomFieldRequest,
            res,
            next,
        ),
);

// ─── DELETE /api/v1/custom-fields/:id ─────────────────────────────────────────
// 👑 admin/owner. Hard-delete; DB cascades all options + all stored task values.
// 204.
router.delete(
    "/custom-fields/:id",
    authenticate,
    canAccess([Roles.OWNER, Roles.ADMIN]),
    customFieldIdParamValidator,
    validate,
    (req: Request, res: Response, next: NextFunction) =>
        customFieldsController.remove(req as CustomFieldIdRequest, res, next),
);

// ─── PUT /api/v1/tasks/:id/custom-fields/:fieldId ─────────────────────────────
// 🔐 Any member. Set/replace a task's value for a field. Validates the value
// envelope against the field type. Writes a task_activity row + bumps the task
// ETag. 200 + the full updated Task.
router.put(
    "/tasks/:id/custom-fields/:fieldId",
    authenticate,
    taskFieldParamsValidator,
    validate,
    (req: Request, res: Response, next: NextFunction) =>
        customFieldsController.setValue(req as SetFieldValueRequest, res, next),
);

// ─── DELETE /api/v1/tasks/:id/custom-fields/:fieldId ──────────────────────────
// 🔐 Any member. Clear a task's value for a field (idempotent — 204 even when no
// value was set). Writes a task_activity row when a value was actually removed.
router.delete(
    "/tasks/:id/custom-fields/:fieldId",
    authenticate,
    taskFieldParamsValidator,
    validate,
    (req: Request, res: Response, next: NextFunction) =>
        customFieldsController.clearValue(
            req as ClearFieldValueRequest,
            res,
            next,
        ),
);

export default router;
