import express, {
    type NextFunction,
    type Request,
    type Response,
} from "express";
import { TemplatesController } from "../controllers/TemplatesController";
import { TemplatesService } from "../services/TemplatesService";
import { TemplateApplyService } from "../services/TemplateApplyService";
import { TemplatesRepo } from "../repositories/TemplatesRepo";
import { TaskTypesRepo } from "../repositories/TaskTypesRepo";
import { TagsRepo } from "../repositories/TagsRepo";
import { ListsRepo } from "../repositories/ListsRepo";
import { StatusesRepo } from "../repositories/StatusesRepo";
import { TasksRepo } from "../repositories/TasksRepo";
import { TaskMembershipRepo } from "../repositories/TaskMembershipRepo";
import { TaskActivityRepo } from "../repositories/TaskActivityRepo";
import { getDb } from "../db/client";
import logger from "../config/logger";
import authenticate from "../middlewares/authenticate";
import { requirePermission } from "../middlewares/requirePermission";
import { validate } from "../middlewares/validate";
import {
    applyTemplateValidator,
    createTemplateValidator,
    listTemplatesValidator,
    templateIdParamValidator,
    updateTemplateValidator,
} from "../validators/templates";
import type { AuthRequest } from "../types";
import type {
    ApplyTemplateRequest,
    CreateTemplateRequest,
    UpdateTemplateRequest,
} from "../types/templates";

const router = express.Router();

// ─── DI wiring ───────────────────────────────────────────────────────────────
// `getDb()` works because `server.ts` calls `initDb()` before this module is
// imported transitively through `app.ts`.
const db = getDb();
const templatesRepo = new TemplatesRepo(db);
const taskTypesRepo = new TaskTypesRepo(db);
const tagsRepo = new TagsRepo(db);
const templatesService = new TemplatesService(
    db,
    templatesRepo,
    taskTypesRepo,
    tagsRepo,
);
const listsRepo = new ListsRepo(db);
const statusesRepo = new StatusesRepo(db);
const tasksRepo = new TasksRepo(db);
const taskMembershipRepo = new TaskMembershipRepo(db);
const taskActivityRepo = new TaskActivityRepo(db);
const templateApplyService = new TemplateApplyService(
    db,
    templatesRepo,
    taskTypesRepo,
    tagsRepo,
    listsRepo,
    statusesRepo,
    tasksRepo,
    taskMembershipRepo,
    taskActivityRepo,
);
const templatesController = new TemplatesController(
    templatesService,
    templateApplyService,
    logger,
);

// ─── GET /api/v1/templates ───────────────────────────────────────────────────
// Authenticated — any role may list the workspace's templates. Optional
// `?type=` and `?q=` filters. Workspace scoping comes from `req.auth`.
router.get(
    "/",
    authenticate,
    listTemplatesValidator,
    validate,
    (req: Request, res: Response, next: NextFunction) =>
        templatesController.list(req as AuthRequest, res, next),
);

// ─── GET /api/v1/templates/:id ───────────────────────────────────────────────
// Authenticated — any role may read a single template in their workspace.
router.get(
    "/:id",
    authenticate,
    templateIdParamValidator,
    validate,
    (req: Request, res: Response, next: NextFunction) =>
        templatesController.get(req as AuthRequest, res, next),
);

// ─── POST /api/v1/templates ──────────────────────────────────────────────────
// 👑 Owner/admin only. `requirePermission` runs before validation so a member is
// rejected (403) without their body being inspected.
router.post(
    "/",
    authenticate,
    requirePermission("catalog.templates"),
    createTemplateValidator,
    validate,
    (req: Request, res: Response, next: NextFunction) =>
        templatesController.create(req as CreateTemplateRequest, res, next),
);

// ─── PATCH /api/v1/templates/:id ─────────────────────────────────────────────
// 👑 Owner/admin only. `type` is immutable and `usage_count` read-only (the
// controller never reads them off the body).
router.patch(
    "/:id",
    authenticate,
    requirePermission("catalog.templates"),
    updateTemplateValidator,
    validate,
    (req: Request, res: Response, next: NextFunction) =>
        templatesController.update(req as UpdateTemplateRequest, res, next),
);

// ─── DELETE /api/v1/templates/:id ────────────────────────────────────────────
// 👑 Owner/admin only. Hard delete; spawned tasks are unaffected. Returns 204.
router.delete(
    "/:id",
    authenticate,
    requirePermission("catalog.templates"),
    templateIdParamValidator,
    validate,
    (req: Request, res: Response, next: NextFunction) =>
        templatesController.remove(req as AuthRequest, res, next),
);

// ─── POST /api/v1/templates/:id/apply ────────────────────────────────────────
// 🔐 Any authenticated member may apply a template — it spawns a task +
// checklist in their workspace. Workspace scoping comes from `req.auth`.
router.post(
    "/:id/apply",
    authenticate,
    requirePermission("template.apply"),
    applyTemplateValidator,
    validate,
    (req: Request, res: Response, next: NextFunction) =>
        templatesController.apply(req as ApplyTemplateRequest, res, next),
);

export default router;
