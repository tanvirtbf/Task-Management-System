import express, {
    type NextFunction,
    type Request,
    type Response,
} from "express";
import logger from "../config/logger";
import { TaskDeleteRequestsController } from "../controllers/TaskDeleteRequestsController";
import { getDb } from "../db/client";
import authenticate from "../middlewares/authenticate";
import { requirePermission } from "../middlewares/requirePermission";
import { validate } from "../middlewares/validate";
import { AttachmentsRepo } from "../repositories/AttachmentsRepo";
import { ListsRepo } from "../repositories/ListsRepo";
import { NotificationsRepo } from "../repositories/NotificationsRepo";
import { StatusesRepo } from "../repositories/StatusesRepo";
import { TagsRepo } from "../repositories/TagsRepo";
import { TaskActivityRepo } from "../repositories/TaskActivityRepo";
import { TaskDeleteRequestsRepo } from "../repositories/TaskDeleteRequestsRepo";
import { TaskMembershipRepo } from "../repositories/TaskMembershipRepo";
import { TasksRepo } from "../repositories/TasksRepo";
import { TaskTypesRepo } from "../repositories/TaskTypesRepo";
import { UsersRepo } from "../repositories/UsersRepo";
import { WorkspaceActivityRepo } from "../repositories/WorkspaceActivityRepo";
import { WorkspaceRepo } from "../repositories/WorkspaceRepo";
import { TaskDeleteRequestsService } from "../services/TaskDeleteRequestsService";
import { TasksService } from "../services/TasksService";
import { TaskWriteService } from "../services/TaskWriteService";
import type { AuthRequest } from "../types";
import {
    createDeleteRequestValidator,
    decideDeleteRequestValidator,
    deleteRequestParamValidator,
    taskIdParamValidator,
} from "../validators/taskDeleteRequests";

/**
 * PERMANENT-DELETE APPROVAL (upgrades/023).
 *
 * Declares full paths spanning `/delete-requests/*` and
 * `/tasks/:id/delete-request`, so it mounts at the v1 root BEFORE `/tasks` —
 * the assignment-requests / attachments precedent.
 */
const router = express.Router();

// ─── DI wiring ───────────────────────────────────────────────────────────────
const db = getDb();
const tasksRepo = new TasksRepo(db);
const listsRepo = new ListsRepo(db);
const usersRepo = new UsersRepo(db);
const activityRepo = new TaskActivityRepo(db);
const notificationsRepo = new NotificationsRepo(db);
const workspaceActivityRepo = new WorkspaceActivityRepo(db);

// The full task-write stack (the fifth wiring site) — approval runs the REAL
// hard delete, so the subtree, the recipients' notifications and the R2 purge
// queue are handled by the one code path that already gets them right.
const taskWriteService = new TaskWriteService(
    db,
    listsRepo,
    new StatusesRepo(db),
    new TaskTypesRepo(db),
    tasksRepo,
    new TaskMembershipRepo(db),
    usersRepo,
    new TagsRepo(db),
    activityRepo,
    notificationsRepo,
    new AttachmentsRepo(db),
    new WorkspaceRepo(db),
    workspaceActivityRepo,
    new TasksService(listsRepo, tasksRepo),
    logger,
);

const service = new TaskDeleteRequestsService(
    db,
    new TaskDeleteRequestsRepo(db),
    tasksRepo,
    taskWriteService,
    usersRepo,
    notificationsRepo,
    workspaceActivityRepo,
    logger,
);
const controller = new TaskDeleteRequestsController(service, logger);

// ─── POST /api/v1/tasks/:id/delete-request ───────────────────────────────────
// 🔐 `task.delete` — the same verb that guards Archive, because asking for a
// permanent delete is the same authority applied harder. The OBJECT reach is
// re-checked in the service. An Owner/Admin who can approve gets 204 (already
// deleted); everyone else gets 201 with a pending request.
router.post(
    "/tasks/:id/delete-request",
    authenticate,
    requirePermission("task.delete"),
    createDeleteRequestValidator,
    validate,
    (req: Request, res: Response, next: NextFunction) =>
        controller.create(req as AuthRequest, res, next),
);

// ─── GET /api/v1/tasks/:id/delete-request ────────────────────────────────────
// 🔐 `task.view` — the drawer banner. Resolution goes through the scope-filtered
// TasksRepo, so an invisible task stays a 404 rather than an existence oracle.
router.get(
    "/tasks/:id/delete-request",
    authenticate,
    requirePermission("task.view"),
    taskIdParamValidator,
    validate,
    (req: Request, res: Response, next: NextFunction) =>
        controller.forTask(req as AuthRequest, res, next),
);

// ─── GET /api/v1/delete-requests?box=pending|mine ────────────────────────────
// 🔐 authenticated. `box=mine` is everyone's own history; `box=pending` is the
// approver queue and the service refuses it to non-admins (a member has no
// business reading what other teams want removed).
router.get(
    "/delete-requests",
    authenticate,
    (req: Request, res: Response, next: NextFunction) =>
        controller.list(req as AuthRequest, res, next),
);

// ─── POST /api/v1/delete-requests/:id/approve | /reject ──────────────────────
// 👑 Owner/Admin + `task.delete_hard`, enforced in the service (the same gate
// the direct hard delete uses). Atomic claim: two admins cannot both decide.
router.post(
    "/delete-requests/:id/approve",
    authenticate,
    decideDeleteRequestValidator,
    validate,
    (req: Request, res: Response, next: NextFunction) =>
        controller.decide(true)(req as AuthRequest, res, next),
);
router.post(
    "/delete-requests/:id/reject",
    authenticate,
    decideDeleteRequestValidator,
    validate,
    (req: Request, res: Response, next: NextFunction) =>
        controller.decide(false)(req as AuthRequest, res, next),
);

// ─── POST /api/v1/delete-requests/:id/cancel ─────────────────────────────────
// 🔐 the requester only — withdrawing your own ask needs no admin.
router.post(
    "/delete-requests/:id/cancel",
    authenticate,
    deleteRequestParamValidator,
    validate,
    (req: Request, res: Response, next: NextFunction) =>
        controller.cancel(req as AuthRequest, res, next),
);

export default router;
