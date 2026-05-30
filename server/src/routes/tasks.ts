import express, {
    type NextFunction,
    type Request,
    type Response,
} from "express";
import { TaskMembershipController } from "../controllers/TaskMembershipController";
import { TaskMembershipService } from "../services/TaskMembershipService";
import { TasksController } from "../controllers/TasksController";
import { TasksService } from "../services/TasksService";
import { UsersRepo } from "../repositories/UsersRepo";
import { TasksRepo } from "../repositories/TasksRepo";
import { ListsRepo } from "../repositories/ListsRepo";
import { TaskMembershipRepo } from "../repositories/TaskMembershipRepo";
import { TaskActivityRepo } from "../repositories/TaskActivityRepo";
import { NotificationsRepo } from "../repositories/NotificationsRepo";
import { getDb } from "../db/client";
import logger from "../config/logger";
import { validate } from "../middlewares/validate";
import {
    addAssigneesValidator,
    deleteAssigneeValidator,
    getTaskValidator,
    subtasksValidator,
    watchSelfValidator,
} from "../validators/tasks";
import authenticate from "../middlewares/authenticate";
import type {
    AddAssigneesRequest,
    GetTaskRequest,
    RemoveAssigneeRequest,
    SubtasksRequest,
    WatchSelfRequest,
} from "../types/tasks";

const router = express.Router();

// ─── DI wiring ───────────────────────────────────────────────────────────────
// `getDb()` works because `server.ts` calls `initDb()` before this module is
// imported transitively through `app.ts`.
const db = getDb();
const usersRepo = new UsersRepo(db);
const tasksRepo = new TasksRepo(db);
const listsRepo = new ListsRepo(db);
const membershipRepo = new TaskMembershipRepo(db);
const activityRepo = new TaskActivityRepo(db);
const notificationsRepo = new NotificationsRepo(db);
const membershipService = new TaskMembershipService(
    db,
    tasksRepo,
    membershipRepo,
    usersRepo,
    activityRepo,
    notificationsRepo,
);
const membershipController = new TaskMembershipController(
    membershipService,
    logger,
);
const tasksService = new TasksService(listsRepo, tasksRepo);
const tasksController = new TasksController(tasksService, logger);

// ─── POST /api/v1/tasks/:id/assignees ─────────────────────────────────────────
// 🔐 Any workspace member. Adds one or more assignees (idempotent), auto-watches
// them, writes a `task_activity` row, and fires an `assigned` notification.
// Returns 204.
router.post(
    "/:id/assignees",
    authenticate,
    addAssigneesValidator,
    validate,
    (req: Request, res: Response, next: NextFunction) =>
        membershipController.addAssignees(
            req as AddAssigneesRequest,
            res,
            next,
        ),
);

// ─── DELETE /api/v1/tasks/:id/assignees/:userId ───────────────────────────────
// 🔐 Any workspace member. Removes one assignee (idempotent — a no-op for a user
// who is not assigned), writes an `assignee_removed` task_activity row, and bumps
// the task ETag. No notification (there is no `unassigned` type); the auto-added
// watcher is left intact. Returns 204.
router.delete(
    "/:id/assignees/:userId",
    authenticate,
    deleteAssigneeValidator,
    validate,
    (req: Request, res: Response, next: NextFunction) =>
        membershipController.removeAssignee(
            req as RemoveAssigneeRequest,
            res,
            next,
        ),
);

// ─── POST /api/v1/tasks/:id/watchers/self ─────────────────────────────────────
// 🔐 Any workspace member. The caller subscribes themselves as a watcher
// (idempotent). A personal subscription — no `task_activity` row, no
// notification, and no task-ETag bump. Returns 204.
router.post(
    "/:id/watchers/self",
    authenticate,
    watchSelfValidator,
    validate,
    (req: Request, res: Response, next: NextFunction) =>
        membershipController.watchSelf(req as WatchSelfRequest, res, next),
);

// ─── GET /api/v1/tasks/:id/subtasks ───────────────────────────────────────────
// 🔐 Any workspace member. Returns the parent's direct children as a bare
// `Task[]` (the §10 "array of Task" shape), each fully hydrated. Archived
// children are excluded unless `?include_archived=true`. 404 `task.not_found`
// if the parent is absent or in another workspace; an empty child set is `[]`.
// Declared before the catch-all `/:id` (more-specific-first).
router.get(
    "/:id/subtasks",
    authenticate,
    subtasksValidator,
    validate,
    (req: Request, res: Response, next: NextFunction) =>
        tasksController.getSubtasks(req as SubtasksRequest, res, next),
);

// ─── GET /api/v1/tasks/:id ─────────────────────────────────────────────────────
// 🔐 Any workspace member. Reads one fully-hydrated task by internal id or
// custom_id, scoped to the caller's workspace. Returns 200 with the bare Task
// object (404 `task.not_found` if absent or in another workspace). Registered
// after the literal-segment routes above; future literals (`/my-work`, `/bulk`)
// MUST be declared before this catch-all `:id`.
router.get(
    "/:id",
    authenticate,
    getTaskValidator,
    validate,
    (req: Request, res: Response, next: NextFunction) =>
        tasksController.getById(req as GetTaskRequest, res, next),
);

export default router;
