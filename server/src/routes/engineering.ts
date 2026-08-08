import express, {
    type NextFunction,
    type Request,
    type Response,
} from "express";
import { EngineeringController } from "../controllers/EngineeringController";
import { EngineeringService } from "../services/EngineeringService";
import { EngineeringRepo } from "../repositories/EngineeringRepo";
import { TaskWriteService } from "../services/TaskWriteService";
import { WorkspaceRepo } from "../repositories/WorkspaceRepo";
import { TasksService } from "../services/TasksService";
import { UsersRepo } from "../repositories/UsersRepo";
import { TasksRepo } from "../repositories/TasksRepo";
import { AttachmentsRepo } from "../repositories/AttachmentsRepo";
import { ListsRepo } from "../repositories/ListsRepo";
import { StatusesRepo } from "../repositories/StatusesRepo";
import { TaskTypesRepo } from "../repositories/TaskTypesRepo";
import { TaskMembershipRepo } from "../repositories/TaskMembershipRepo";
import { TaskActivityRepo } from "../repositories/TaskActivityRepo";
import { NotificationsRepo } from "../repositories/NotificationsRepo";
import { TagsRepo } from "../repositories/TagsRepo";
import { getDb } from "../db/client";
import logger from "../config/logger";
import authenticate from "../middlewares/authenticate";
import { requirePermission } from "../middlewares/requirePermission";
import { validate } from "../middlewares/validate";
import {
    reportBugValidator,
    createPostmortemValidator,
    getPostmortemValidator,
} from "../validators/engineering";
import type {
    ReportBugRequest,
    GetEngHomeRequest,
    CreatePostmortemRequest,
} from "../types/engineering";

const router = express.Router();

// ─── DI wiring ───────────────────────────────────────────────────────────────
// §22 composes the §10 task-create pipeline, so it builds a `TaskWriteService`
// exactly as routes/tasks.ts does. `getDb()` works because server.ts runs
// `initDb()` before app.ts imports routers transitively.
const db = getDb();
const usersRepo = new UsersRepo(db);
const tasksRepo = new TasksRepo(db);
const listsRepo = new ListsRepo(db);
const statusesRepo = new StatusesRepo(db);
const taskTypesRepo = new TaskTypesRepo(db);
const membershipRepo = new TaskMembershipRepo(db);
const activityRepo = new TaskActivityRepo(db);
const notificationsRepo = new NotificationsRepo(db);
const tagsRepo = new TagsRepo(db);
const tasksService = new TasksService(listsRepo, tasksRepo);
const taskWriteService = new TaskWriteService(
    db,
    listsRepo,
    statusesRepo,
    taskTypesRepo,
    tasksRepo,
    membershipRepo,
    usersRepo,
    tagsRepo,
    activityRepo,
    notificationsRepo,
    new AttachmentsRepo(db),
    new WorkspaceRepo(db),
    tasksService,
    logger,
);
const engRepo = new EngineeringRepo(db);
const service = new EngineeringService(
    engRepo,
    taskWriteService,
    tasksRepo,
    usersRepo,
    logger,
);
const controller = new EngineeringController(service, logger);

// ─── POST /api/v1/eng/report-bug ──────────────────────────────────────────────
// 🔐 any authenticated member (every team can report a bug). The router declares
// full `/eng/*` paths and mounts at the v1 root (no `/eng` prefix collides with
// the existing routers). Chain: authenticate (401) → validate (422) → handler.
router.post(
    "/eng/report-bug",
    authenticate,
    requirePermission("bug.report"),
    reportBugValidator,
    validate,
    (req: Request, res: Response, next: NextFunction) =>
        controller.reportBug(req as ReportBugRequest, res, next),
);

// ─── GET /api/v1/eng/home ─────────────────────────────────────────────────────
// 🔐 any authenticated member. Per-caller dashboard rollup (open bugs/incidents,
// my sprint tasks, PRs awaiting me, stale tickets, current on-call, active
// sprint) in one round-trip. No body/params to validate.
router.get(
    "/eng/home",
    authenticate,
    (req: Request, res: Response, next: NextFunction) =>
        controller.getHome(req as GetEngHomeRequest, res, next),
);

// ─── GET /api/v1/eng/incidents/:id/postmortem ─────────────────────────────────
// 🔐 any authenticated member (gap-scan H5). Read the saved checklist so the
// UI can rehydrate; empty items (200) when nothing is saved yet.
router.get(
    "/eng/incidents/:id/postmortem",
    authenticate,
    getPostmortemValidator,
    validate,
    (req: Request, res: Response, next: NextFunction) =>
        controller.getPostmortem(req as CreatePostmortemRequest, res, next),
);

// ─── POST /api/v1/eng/incidents/:id/postmortem ────────────────────────────────
// 🔐 any authenticated member. Save (upsert) the postmortem checklist on a
// resolved Incident task. Chain: authenticate (401) → validate (422) → handler;
// the service enforces the type/status preconditions (409).
router.post(
    "/eng/incidents/:id/postmortem",
    authenticate,
    requirePermission("postmortem.manage"),
    createPostmortemValidator,
    validate,
    (req: Request, res: Response, next: NextFunction) =>
        controller.createPostmortem(req as CreatePostmortemRequest, res, next),
);

export default router;
