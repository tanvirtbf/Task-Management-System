import express, {
    type NextFunction,
    type Request,
    type Response,
} from "express";
import { SlaController } from "../controllers/SlaController";
import { SlaService } from "../services/SlaService";
import { SlaRepo } from "../repositories/SlaRepo";
import { TasksService } from "../services/TasksService";
import { TasksRepo } from "../repositories/TasksRepo";
import { ListsRepo } from "../repositories/ListsRepo";
import { UsersRepo } from "../repositories/UsersRepo";
import { TaskActivityRepo } from "../repositories/TaskActivityRepo";
import { getDb } from "../db/client";
import logger from "../config/logger";
import authenticate from "../middlewares/authenticate";
import { canAccess } from "../middlewares/canAccess";
import { Roles } from "../constants";
import { validate } from "../middlewares/validate";
import { breachedSlaValidator, overrideSlaValidator } from "../validators/sla";
import type { ListBreachedRequest, OverrideSlaRequest } from "../types/sla";

const router = express.Router();

// ─── DI wiring ───────────────────────────────────────────────────────────────
const db = getDb();
const tasksRepo = new TasksRepo(db);
const listsRepo = new ListsRepo(db);
const usersRepo = new UsersRepo(db);
const activityRepo = new TaskActivityRepo(db);
const slaRepo = new SlaRepo(db);
const tasksService = new TasksService(listsRepo, tasksRepo); // reads, for hydration
const service = new SlaService(
    db,
    slaRepo,
    tasksRepo,
    usersRepo,
    activityRepo,
    tasksService,
    logger,
);
const controller = new SlaController(service, logger);

// ─── GET /api/v1/sla/breached ─────────────────────────────────────────────────
// 🔐 any authenticated member (dashboard read). Workspace-scoped breached-SLA
// list. The router declares full paths spanning `/sla/breached` and
// `/tasks/:id/sla`, so it mounts at the v1 root.
router.get(
    "/sla/breached",
    authenticate,
    breachedSlaValidator,
    validate,
    (req: Request, res: Response, next: NextFunction) =>
        controller.listBreached(req as ListBreachedRequest, res, next),
);

// ─── PATCH /api/v1/tasks/:id/sla ──────────────────────────────────────────────
// 👑 owner/admin override of sla_due_at. MUST be registered before the `/tasks`
// router so its 3-segment path resolves cleanly. canAccess gives a route-level
// 403; the future-timestamp rule (422 sla.invalid_due_at) is enforced in-service.
router.patch(
    "/tasks/:id/sla",
    authenticate,
    canAccess([Roles.OWNER, Roles.ADMIN]),
    overrideSlaValidator,
    validate,
    (req: Request, res: Response, next: NextFunction) =>
        controller.override(req as OverrideSlaRequest, res, next),
);

export default router;
