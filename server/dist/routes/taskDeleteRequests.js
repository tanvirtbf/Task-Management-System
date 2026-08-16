"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const logger_1 = __importDefault(require("../config/logger"));
const TaskDeleteRequestsController_1 = require("../controllers/TaskDeleteRequestsController");
const client_1 = require("../db/client");
const authenticate_1 = __importDefault(require("../middlewares/authenticate"));
const requirePermission_1 = require("../middlewares/requirePermission");
const validate_1 = require("../middlewares/validate");
const AttachmentsRepo_1 = require("../repositories/AttachmentsRepo");
const ListsRepo_1 = require("../repositories/ListsRepo");
const NotificationsRepo_1 = require("../repositories/NotificationsRepo");
const StatusesRepo_1 = require("../repositories/StatusesRepo");
const TagsRepo_1 = require("../repositories/TagsRepo");
const TaskActivityRepo_1 = require("../repositories/TaskActivityRepo");
const TaskDeleteRequestsRepo_1 = require("../repositories/TaskDeleteRequestsRepo");
const TaskMembershipRepo_1 = require("../repositories/TaskMembershipRepo");
const TasksRepo_1 = require("../repositories/TasksRepo");
const TaskTypesRepo_1 = require("../repositories/TaskTypesRepo");
const UsersRepo_1 = require("../repositories/UsersRepo");
const WorkspaceActivityRepo_1 = require("../repositories/WorkspaceActivityRepo");
const WorkspaceRepo_1 = require("../repositories/WorkspaceRepo");
const TaskDeleteRequestsService_1 = require("../services/TaskDeleteRequestsService");
const TasksService_1 = require("../services/TasksService");
const TaskWriteService_1 = require("../services/TaskWriteService");
const taskDeleteRequests_1 = require("../validators/taskDeleteRequests");
/**
 * PERMANENT-DELETE APPROVAL (upgrades/023).
 *
 * Declares full paths spanning `/delete-requests/*` and
 * `/tasks/:id/delete-request`, so it mounts at the v1 root BEFORE `/tasks` —
 * the assignment-requests / attachments precedent.
 */
const router = express_1.default.Router();
// ─── DI wiring ───────────────────────────────────────────────────────────────
const db = (0, client_1.getDb)();
const tasksRepo = new TasksRepo_1.TasksRepo(db);
const listsRepo = new ListsRepo_1.ListsRepo(db);
const usersRepo = new UsersRepo_1.UsersRepo(db);
const activityRepo = new TaskActivityRepo_1.TaskActivityRepo(db);
const notificationsRepo = new NotificationsRepo_1.NotificationsRepo(db);
const workspaceActivityRepo = new WorkspaceActivityRepo_1.WorkspaceActivityRepo(db);
// The full task-write stack (the fifth wiring site) — approval runs the REAL
// hard delete, so the subtree, the recipients' notifications and the R2 purge
// queue are handled by the one code path that already gets them right.
const taskWriteService = new TaskWriteService_1.TaskWriteService(db, listsRepo, new StatusesRepo_1.StatusesRepo(db), new TaskTypesRepo_1.TaskTypesRepo(db), tasksRepo, new TaskMembershipRepo_1.TaskMembershipRepo(db), usersRepo, new TagsRepo_1.TagsRepo(db), activityRepo, notificationsRepo, new AttachmentsRepo_1.AttachmentsRepo(db), new WorkspaceRepo_1.WorkspaceRepo(db), workspaceActivityRepo, new TasksService_1.TasksService(listsRepo, tasksRepo), logger_1.default);
const service = new TaskDeleteRequestsService_1.TaskDeleteRequestsService(db, new TaskDeleteRequestsRepo_1.TaskDeleteRequestsRepo(db), tasksRepo, taskWriteService, usersRepo, notificationsRepo, workspaceActivityRepo, logger_1.default);
const controller = new TaskDeleteRequestsController_1.TaskDeleteRequestsController(service, logger_1.default);
// ─── POST /api/v1/tasks/:id/delete-request ───────────────────────────────────
// 🔐 `task.delete` — the same verb that guards Archive, because asking for a
// permanent delete is the same authority applied harder. The OBJECT reach is
// re-checked in the service. An Owner/Admin who can approve gets 204 (already
// deleted); everyone else gets 201 with a pending request.
router.post("/tasks/:id/delete-request", authenticate_1.default, (0, requirePermission_1.requirePermission)("task.delete"), taskDeleteRequests_1.createDeleteRequestValidator, validate_1.validate, (req, res, next) => controller.create(req, res, next));
// ─── GET /api/v1/tasks/:id/delete-request ────────────────────────────────────
// 🔐 `task.view` — the drawer banner. Resolution goes through the scope-filtered
// TasksRepo, so an invisible task stays a 404 rather than an existence oracle.
router.get("/tasks/:id/delete-request", authenticate_1.default, (0, requirePermission_1.requirePermission)("task.view"), taskDeleteRequests_1.taskIdParamValidator, validate_1.validate, (req, res, next) => controller.forTask(req, res, next));
// ─── GET /api/v1/delete-requests?box=pending|mine ────────────────────────────
// 🔐 authenticated. `box=mine` is everyone's own history; `box=pending` is the
// approver queue and the service refuses it to non-admins (a member has no
// business reading what other teams want removed).
router.get("/delete-requests", authenticate_1.default, (req, res, next) => controller.list(req, res, next));
// ─── POST /api/v1/delete-requests/:id/approve | /reject ──────────────────────
// 👑 Owner/Admin + `task.delete_hard`, enforced in the service (the same gate
// the direct hard delete uses). Atomic claim: two admins cannot both decide.
router.post("/delete-requests/:id/approve", authenticate_1.default, taskDeleteRequests_1.decideDeleteRequestValidator, validate_1.validate, (req, res, next) => controller.decide(true)(req, res, next));
router.post("/delete-requests/:id/reject", authenticate_1.default, taskDeleteRequests_1.decideDeleteRequestValidator, validate_1.validate, (req, res, next) => controller.decide(false)(req, res, next));
// ─── POST /api/v1/delete-requests/:id/cancel ─────────────────────────────────
// 🔐 the requester only — withdrawing your own ask needs no admin.
router.post("/delete-requests/:id/cancel", authenticate_1.default, taskDeleteRequests_1.deleteRequestParamValidator, validate_1.validate, (req, res, next) => controller.cancel(req, res, next));
exports.default = router;
