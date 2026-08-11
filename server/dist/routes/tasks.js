"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const TaskMembershipController_1 = require("../controllers/TaskMembershipController");
const TaskMembershipService_1 = require("../services/TaskMembershipService");
const TasksController_1 = require("../controllers/TasksController");
const TasksService_1 = require("../services/TasksService");
const TaskActivityController_1 = require("../controllers/TaskActivityController");
const TaskActivityService_1 = require("../services/TaskActivityService");
const UsersRepo_1 = require("../repositories/UsersRepo");
const TasksRepo_1 = require("../repositories/TasksRepo");
const AttachmentsRepo_1 = require("../repositories/AttachmentsRepo");
const ListsRepo_1 = require("../repositories/ListsRepo");
const TaskMembershipRepo_1 = require("../repositories/TaskMembershipRepo");
const TaskActivityRepo_1 = require("../repositories/TaskActivityRepo");
const WorkspaceActivityRepo_1 = require("../repositories/WorkspaceActivityRepo");
const NotificationsRepo_1 = require("../repositories/NotificationsRepo");
const StatusesRepo_1 = require("../repositories/StatusesRepo");
const TaskTypesRepo_1 = require("../repositories/TaskTypesRepo");
const TagsRepo_1 = require("../repositories/TagsRepo");
const TaskWriteService_1 = require("../services/TaskWriteService");
const WorkspaceRepo_1 = require("../repositories/WorkspaceRepo");
const TaskWriteController_1 = require("../controllers/TaskWriteController");
const SpacesRepo_1 = require("../repositories/SpacesRepo");
const ReviewsRepo_1 = require("../repositories/ReviewsRepo");
const ReviewsService_1 = require("../services/ReviewsService");
const ReviewsController_1 = require("../controllers/ReviewsController");
const reviews_1 = require("../validators/reviews");
const client_1 = require("../db/client");
const logger_1 = __importDefault(require("../config/logger"));
const validate_1 = require("../middlewares/validate");
const tasks_1 = require("../validators/tasks");
const authenticate_1 = __importDefault(require("../middlewares/authenticate"));
const requirePermission_1 = require("../middlewares/requirePermission");
const router = express_1.default.Router();
// ─── DI wiring ───────────────────────────────────────────────────────────────
// `getDb()` works because `server.ts` calls `initDb()` before this module is
// imported transitively through `app.ts`.
const db = (0, client_1.getDb)();
const usersRepo = new UsersRepo_1.UsersRepo(db);
const tasksRepo = new TasksRepo_1.TasksRepo(db);
const listsRepo = new ListsRepo_1.ListsRepo(db);
const membershipRepo = new TaskMembershipRepo_1.TaskMembershipRepo(db);
const activityRepo = new TaskActivityRepo_1.TaskActivityRepo(db);
const notificationsRepo = new NotificationsRepo_1.NotificationsRepo(db);
const tagsRepo = new TagsRepo_1.TagsRepo(db);
// Dept Review V1 (A-4) — review write path.
const spacesRepo = new SpacesRepo_1.SpacesRepo(db);
const reviewsRepo = new ReviewsRepo_1.ReviewsRepo(db);
const reviewsService = new ReviewsService_1.ReviewsService(db, spacesRepo, tasksRepo, reviewsRepo, activityRepo, notificationsRepo, usersRepo, logger_1.default);
const reviewsController = new ReviewsController_1.ReviewsController(reviewsService, logger_1.default);
const membershipService = new TaskMembershipService_1.TaskMembershipService(db, tasksRepo, membershipRepo, usersRepo, activityRepo, notificationsRepo, tagsRepo);
const membershipController = new TaskMembershipController_1.TaskMembershipController(membershipService, logger_1.default);
const statusesRepo = new StatusesRepo_1.StatusesRepo(db);
const taskTypesRepo = new TaskTypesRepo_1.TaskTypesRepo(db);
const tasksService = new TasksService_1.TasksService(listsRepo, tasksRepo);
const tasksController = new TasksController_1.TasksController(tasksService, logger_1.default);
const taskActivityService = new TaskActivityService_1.TaskActivityService(tasksRepo, activityRepo, usersRepo);
const taskActivityController = new TaskActivityController_1.TaskActivityController(taskActivityService, logger_1.default);
const taskWriteService = new TaskWriteService_1.TaskWriteService(db, listsRepo, statusesRepo, taskTypesRepo, tasksRepo, membershipRepo, usersRepo, tagsRepo, activityRepo, notificationsRepo, new AttachmentsRepo_1.AttachmentsRepo(db), new WorkspaceRepo_1.WorkspaceRepo(db), new WorkspaceActivityRepo_1.WorkspaceActivityRepo(db), tasksService, logger_1.default);
const taskWriteController = new TaskWriteController_1.TaskWriteController(taskWriteService, logger_1.default);
// ─── POST /api/v1/tasks ────────────────────────────────────────────────────
// 🔐 Any workspace member. Creates a task in the caller's workspace: validates
// the list / status / task-type / parent / assignees / tags, computes
// task_number + sla_due_at + completed_at, and writes the task + initial
// membership + first activity row + assignee notifications in one transaction.
// Returns 201 with the fully-hydrated Task and an ETag header. A literal path,
// so its declaration order vs the `/:id` routes is irrelevant.
router.post("/", authenticate_1.default, (0, requirePermission_1.requirePermission)("task.create"), tasks_1.createTaskValidator, validate_1.validate, (req, res, next) => taskWriteController.create(req, res, next));
// ─── POST /api/v1/tasks/bulk ───────────────────────────────────────────────
// 🔐 Any member. Bulk-edit ≤200 tasks, fail-atomic, in one transaction. A
// LITERAL path declared before the catch-all `/:id` routes. 200 { updated,
// tasks }.
router.post("/bulk", authenticate_1.default, (0, requirePermission_1.requirePermission)("task.edit"), tasks_1.bulkTasksValidator, validate_1.validate, (req, res, next) => taskWriteController.bulk(req, res, next));
// ─── POST /api/v1/tasks/:id/assignees ─────────────────────────────────────────
// 🔐 Any workspace member. Adds one or more assignees (idempotent), auto-watches
// them, writes a `task_activity` row, and fires an `assigned` notification.
// Returns 204.
router.post("/:id/assignees", authenticate_1.default, (0, requirePermission_1.requirePermission)("task.assign"), tasks_1.addAssigneesValidator, validate_1.validate, (req, res, next) => membershipController.addAssignees(req, res, next));
// ─── DELETE /api/v1/tasks/:id/assignees/:userId ───────────────────────────────
// 🔐 Any workspace member. Removes one assignee (idempotent — a no-op for a user
// who is not assigned), writes an `assignee_removed` task_activity row, and bumps
// the task ETag. No notification (there is no `unassigned` type); the auto-added
// watcher is left intact. Returns 204.
router.delete("/:id/assignees/:userId", authenticate_1.default, (0, requirePermission_1.requirePermission)("task.assign"), tasks_1.deleteAssigneeValidator, validate_1.validate, (req, res, next) => membershipController.removeAssignee(req, res, next));
// ─── POST /api/v1/tasks/:id/watchers/self ─────────────────────────────────────
// 🔐 Any workspace member. The caller subscribes themselves as a watcher
// (idempotent). A personal subscription — no `task_activity` row, no
// notification, and no task-ETag bump. Returns 204.
router.post("/:id/watchers/self", authenticate_1.default, tasks_1.watchSelfValidator, validate_1.validate, (req, res, next) => membershipController.watchSelf(req, res, next));
// ─── DELETE /api/v1/tasks/:id/watchers/self ───────────────────────────────────
// 🔐 Any workspace member. The caller stops watching (idempotent — a no-op when
// not watching). Mirror of the POST: a personal subscription, so no
// `task_activity`, no notification, and no task-ETag bump. Returns 204.
router.delete("/:id/watchers/self", authenticate_1.default, tasks_1.watchSelfValidator, validate_1.validate, (req, res, next) => membershipController.unwatchSelf(req, res, next));
// ─── POST /api/v1/tasks/:id/tags ──────────────────────────────────────────────
// 🔐 `task.edit`. Applies one or more tags (idempotent), validating each
// belongs to the caller's workspace. Writes a `tag_added` task_activity row
// and bumps the task ETag. No notification. Returns 204.
//
// F34 (ISS-095): these two routes carried NO permission gate at all — tagging
// never had its own catalog key, so F7's sweep had nothing to attach, and
// after D12.1 a guest could still re-tag every task in the workspace (found
// because the guest-revocation fallout mapped onto every revoked key EXCEPT
// these two routes). A tag is task metadata, so the gate is `task.edit` —
// exactly the issue's prescription: every internal role already holds it, the
// guest does not, zero grant changes. (The neighbouring `/watchers/self`
// routes stay ungated ON PURPOSE: a personal subscribe is correct for a
// read persona.)
router.post("/:id/tags", authenticate_1.default, (0, requirePermission_1.requirePermission)("task.edit"), tasks_1.addTagsValidator, validate_1.validate, (req, res, next) => membershipController.addTags(req, res, next));
// ─── DELETE /api/v1/tasks/:id/tags/:tagId ─────────────────────────────────────
// 🔐 `task.edit` (F34 / ISS-095 — see the POST above). Removes one tag
// (idempotent — a no-op for a tag not applied/absent), writes a `tag_removed`
// task_activity row, and bumps the task ETag. No notification. Returns 204.
router.delete("/:id/tags/:tagId", authenticate_1.default, (0, requirePermission_1.requirePermission)("task.edit"), tasks_1.removeTagValidator, validate_1.validate, (req, res, next) => membershipController.removeTag(req, res, next));
// ─── GET /api/v1/tasks/my-work ─────────────────────────────────────────────
// 🔐 Any member. The caller's task dashboard: today / overdue / next / unscheduled
// / done buckets (or one via `?bucket=`). A LITERAL path — MUST be declared
// before the catch-all `GET /:id` so it isn't captured as id="my-work".
// ─── POST /api/v1/tasks/:id/review ───────────────────────────────────────────
// Dept Review V1 (A-4). Authenticated; head-of-the-task's-space or owner/admin
// (enforced service-level → 403 review.not_head). `:id` accepts id or
// custom_id. 409 review.not_completed unless the task sits in a done-group
// status (re-checked under the task row lock); 409 task.archived /
// space.archived per the guard chain.
router.post("/:id/review", authenticate_1.default, reviews_1.createReviewValidator, validate_1.validate, (req, res, next) => reviewsController.create(req, res, next));
router.get("/my-work", authenticate_1.default, tasks_1.myWorkValidator, validate_1.validate, (req, res, next) => taskWriteController.myWork(req, res, next));
// ─── GET /api/v1/tasks/:id/subtasks ───────────────────────────────────────────
// 🔐 Any workspace member. Returns the parent's direct children as a bare
// `Task[]` (the §10 "array of Task" shape), each fully hydrated. Archived
// children are excluded unless `?include_archived=true`. 404 `task.not_found`
// if the parent is absent or in another workspace; an empty child set is `[]`.
// Declared before the catch-all `/:id` (more-specific-first).
router.get("/:id/subtasks", authenticate_1.default, tasks_1.subtasksValidator, validate_1.validate, (req, res, next) => tasksController.getSubtasks(req, res, next));
// ─── GET /api/v1/tasks/:id/activity ───────────────────────────────────────────
// 🔐 `task.view` (team-access P2 / scan G11: this route carried NO permission
// gate, so a role stripped of task.view could still read any task's whole
// history). The gate answers only the VERB question; the OBJECT reach is the
// service's task resolution, which runs through the scope-filtered TasksRepo
// WITH the own-escape — the feed is readable exactly where the task itself is
// (a cross-team assignee keeps their own task's history; an out-of-scope id
// stays a 404, never an existence oracle). Newest-first, cursor-paginated,
// each row's `actor` hydrated to the full User (null for system events).
// `?action=` filters by exact action code; `?cursor=`/`?limit=` paginate by
// `internal_id`. 404 `task.not_found` if the task is absent or in another
// workspace. Declared before the catch-all `/:id` (more-specific-first).
router.get("/:id/activity", authenticate_1.default, (0, requirePermission_1.requirePermission)("task.view"), tasks_1.taskActivityValidator, validate_1.validate, (req, res, next) => taskActivityController.listByTask(req, res, next));
// ─── GET /api/v1/tasks/:id ─────────────────────────────────────────────────────
// 🔐 Any workspace member. Reads one fully-hydrated task by internal id or
// custom_id, scoped to the caller's workspace. Returns 200 with the bare Task
// object (404 `task.not_found` if absent or in another workspace). Registered
// after the literal-segment routes above; future literals (`/my-work`, `/bulk`)
// MUST be declared before this catch-all `:id`.
// ─── GET /api/v1/tasks/:id/reviews ───────────────────────────────────────────
// Dept Review V1 (A-5). Review history, newest-first, reviewers hydrated.
// Readable by owner/admin, the space's head, and the task's assignees
// (service-enforced → 403 review.forbidden). `:id` accepts id or custom_id.
router.get("/:id/reviews", authenticate_1.default, reviews_1.listReviewsValidator, validate_1.validate, (req, res, next) => reviewsController.listForTask(req, res, next));
router.get("/:id", authenticate_1.default, tasks_1.getTaskValidator, validate_1.validate, (req, res, next) => tasksController.getById(req, res, next));
// ─── PATCH /api/v1/tasks/:id ───────────────────────────────────────────────
// 🔐 Any workspace member. Partial scalar update with optional If-Match ETag
// (409 task.conflict on mismatch). The status/SLA/completed_at side effects and
// reference validation live in the service. Returns 200 + a fresh ETag.
router.patch("/:id", authenticate_1.default, (0, requirePermission_1.requirePermission)("task.edit"), tasks_1.updateTaskValidator, validate_1.validate, (req, res, next) => taskWriteController.update(req, res, next));
// ─── POST /api/v1/tasks/:id/archive ────────────────────────────────────────
// 🔐 Any member. Sets archived_at + cascades to subtasks. Idempotent. 204.
router.post("/:id/archive", authenticate_1.default, (0, requirePermission_1.requirePermission)("task.archive"), tasks_1.getTaskValidator, validate_1.validate, (req, res, next) => taskWriteController.archive(req, res, next));
// ─── POST /api/v1/tasks/:id/unarchive ──────────────────────────────────────
// 🔐 Any member. Clears archived_at on the subtree. Idempotent. 204.
router.post("/:id/unarchive", authenticate_1.default, (0, requirePermission_1.requirePermission)("task.archive"), tasks_1.getTaskValidator, validate_1.validate, (req, res, next) => taskWriteController.unarchive(req, res, next));
// ─── DELETE /api/v1/tasks/:id ──────────────────────────────────────────────
// Soft by default (🔐, = archive). `?hard=true` is a 👑 admin/owner permanent
// delete — the role gate is in the service (the route serves both paths). 204.
router.delete("/:id", authenticate_1.default, (0, requirePermission_1.requirePermission)("task.delete"), tasks_1.getTaskValidator, validate_1.validate, (req, res, next) => taskWriteController.del(req, res, next));
exports.default = router;
