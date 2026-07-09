import express, {
    type NextFunction,
    type Request,
    type Response,
} from "express";
import { TaskMembershipController } from "../controllers/TaskMembershipController";
import { TaskMembershipService } from "../services/TaskMembershipService";
import { TasksController } from "../controllers/TasksController";
import { TasksService } from "../services/TasksService";
import { TaskActivityController } from "../controllers/TaskActivityController";
import { TaskActivityService } from "../services/TaskActivityService";
import { UsersRepo } from "../repositories/UsersRepo";
import { TasksRepo } from "../repositories/TasksRepo";
import { ListsRepo } from "../repositories/ListsRepo";
import { TaskMembershipRepo } from "../repositories/TaskMembershipRepo";
import { TaskActivityRepo } from "../repositories/TaskActivityRepo";
import { NotificationsRepo } from "../repositories/NotificationsRepo";
import { StatusesRepo } from "../repositories/StatusesRepo";
import { TaskTypesRepo } from "../repositories/TaskTypesRepo";
import { TagsRepo } from "../repositories/TagsRepo";
import { TaskWriteService } from "../services/TaskWriteService";
import { TaskWriteController } from "../controllers/TaskWriteController";
import { getDb } from "../db/client";
import logger from "../config/logger";
import { validate } from "../middlewares/validate";
import {
    addAssigneesValidator,
    addTagsValidator,
    bulkTasksValidator,
    createTaskValidator,
    deleteAssigneeValidator,
    getTaskValidator,
    removeTagValidator,
    myWorkValidator,
    subtasksValidator,
    taskActivityValidator,
    updateTaskValidator,
    watchSelfValidator,
} from "../validators/tasks";
import authenticate from "../middlewares/authenticate";
import type { AuthRequest } from "../types";
import type {
    AddAssigneesRequest,
    AddTagsRequest,
    CreateTaskRequest,
    GetTaskRequest,
    RemoveAssigneeRequest,
    RemoveTagRequest,
    SubtasksRequest,
    TaskActivityRequest,
    UpdateTaskRequest,
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
const tagsRepo = new TagsRepo(db);
const membershipService = new TaskMembershipService(
    db,
    tasksRepo,
    membershipRepo,
    usersRepo,
    activityRepo,
    notificationsRepo,
    tagsRepo,
);
const membershipController = new TaskMembershipController(
    membershipService,
    logger,
);
const statusesRepo = new StatusesRepo(db);
const taskTypesRepo = new TaskTypesRepo(db);
const tasksService = new TasksService(listsRepo, tasksRepo);
const tasksController = new TasksController(tasksService, logger);
const taskActivityService = new TaskActivityService(
    tasksRepo,
    activityRepo,
    usersRepo,
);
const taskActivityController = new TaskActivityController(
    taskActivityService,
    logger,
);
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
    tasksService,
    logger,
);
const taskWriteController = new TaskWriteController(taskWriteService, logger);

// ─── POST /api/v1/tasks ────────────────────────────────────────────────────
// 🔐 Any workspace member. Creates a task in the caller's workspace: validates
// the list / status / task-type / parent / assignees / tags, computes
// task_number + sla_due_at + completed_at, and writes the task + initial
// membership + first activity row + assignee notifications in one transaction.
// Returns 201 with the fully-hydrated Task and an ETag header. A literal path,
// so its declaration order vs the `/:id` routes is irrelevant.
router.post(
    "/",
    authenticate,
    createTaskValidator,
    validate,
    (req: Request, res: Response, next: NextFunction) =>
        taskWriteController.create(req as CreateTaskRequest, res, next),
);

// ─── POST /api/v1/tasks/bulk ───────────────────────────────────────────────
// 🔐 Any member. Bulk-edit ≤200 tasks, fail-atomic, in one transaction. A
// LITERAL path declared before the catch-all `/:id` routes. 200 { updated,
// tasks }.
router.post(
    "/bulk",
    authenticate,
    bulkTasksValidator,
    validate,
    (req: Request, res: Response, next: NextFunction) =>
        taskWriteController.bulk(req as AuthRequest, res, next),
);

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

// ─── DELETE /api/v1/tasks/:id/watchers/self ───────────────────────────────────
// 🔐 Any workspace member. The caller stops watching (idempotent — a no-op when
// not watching). Mirror of the POST: a personal subscription, so no
// `task_activity`, no notification, and no task-ETag bump. Returns 204.
router.delete(
    "/:id/watchers/self",
    authenticate,
    watchSelfValidator,
    validate,
    (req: Request, res: Response, next: NextFunction) =>
        membershipController.unwatchSelf(req as WatchSelfRequest, res, next),
);

// ─── POST /api/v1/tasks/:id/tags ──────────────────────────────────────────────
// 🔐 Any workspace member. Applies one or more tags (idempotent), validating
// each belongs to the caller's workspace. Writes a `tag_added` task_activity row
// and bumps the task ETag. No notification. Returns 204.
router.post(
    "/:id/tags",
    authenticate,
    addTagsValidator,
    validate,
    (req: Request, res: Response, next: NextFunction) =>
        membershipController.addTags(req as AddTagsRequest, res, next),
);

// ─── DELETE /api/v1/tasks/:id/tags/:tagId ─────────────────────────────────────
// 🔐 Any workspace member. Removes one tag (idempotent — a no-op for a tag not
// applied/absent), writes a `tag_removed` task_activity row, and bumps the task
// ETag. No notification. Returns 204.
router.delete(
    "/:id/tags/:tagId",
    authenticate,
    removeTagValidator,
    validate,
    (req: Request, res: Response, next: NextFunction) =>
        membershipController.removeTag(req as RemoveTagRequest, res, next),
);

// ─── GET /api/v1/tasks/my-work ─────────────────────────────────────────────
// 🔐 Any member. The caller's task dashboard: today / overdue / next / unscheduled
// / done buckets (or one via `?bucket=`). A LITERAL path — MUST be declared
// before the catch-all `GET /:id` so it isn't captured as id="my-work".
router.get(
    "/my-work",
    authenticate,
    myWorkValidator,
    validate,
    (req: Request, res: Response, next: NextFunction) =>
        taskWriteController.myWork(req as AuthRequest, res, next),
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

// ─── GET /api/v1/tasks/:id/activity ───────────────────────────────────────────
// 🔐 Any workspace member. Newest-first, cursor-paginated activity feed for a
// task, each row's `actor` hydrated to the full User (null for system events).
// `?action=` filters by exact action code; `?cursor=`/`?limit=` paginate by
// `internal_id`. 404 `task.not_found` if the task is absent or in another
// workspace. Declared before the catch-all `/:id` (more-specific-first).
router.get(
    "/:id/activity",
    authenticate,
    taskActivityValidator,
    validate,
    (req: Request, res: Response, next: NextFunction) =>
        taskActivityController.listByTask(
            req as TaskActivityRequest,
            res,
            next,
        ),
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

// ─── PATCH /api/v1/tasks/:id ───────────────────────────────────────────────
// 🔐 Any workspace member. Partial scalar update with optional If-Match ETag
// (409 task.conflict on mismatch). The status/SLA/completed_at side effects and
// reference validation live in the service. Returns 200 + a fresh ETag.
router.patch(
    "/:id",
    authenticate,
    updateTaskValidator,
    validate,
    (req: Request, res: Response, next: NextFunction) =>
        taskWriteController.update(req as UpdateTaskRequest, res, next),
);

// ─── POST /api/v1/tasks/:id/archive ────────────────────────────────────────
// 🔐 Any member. Sets archived_at + cascades to subtasks. Idempotent. 204.
router.post(
    "/:id/archive",
    authenticate,
    getTaskValidator,
    validate,
    (req: Request, res: Response, next: NextFunction) =>
        taskWriteController.archive(req as AuthRequest, res, next),
);

// ─── POST /api/v1/tasks/:id/unarchive ──────────────────────────────────────
// 🔐 Any member. Clears archived_at on the subtree. Idempotent. 204.
router.post(
    "/:id/unarchive",
    authenticate,
    getTaskValidator,
    validate,
    (req: Request, res: Response, next: NextFunction) =>
        taskWriteController.unarchive(req as AuthRequest, res, next),
);

// ─── DELETE /api/v1/tasks/:id ──────────────────────────────────────────────
// Soft by default (🔐, = archive). `?hard=true` is a 👑 admin/owner permanent
// delete — the role gate is in the service (the route serves both paths). 204.
router.delete(
    "/:id",
    authenticate,
    getTaskValidator,
    validate,
    (req: Request, res: Response, next: NextFunction) =>
        taskWriteController.del(req as AuthRequest, res, next),
);

export default router;
