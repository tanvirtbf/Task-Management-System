"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const logger_1 = __importDefault(require("../config/logger"));
const AssignmentRequestsController_1 = require("../controllers/AssignmentRequestsController");
const client_1 = require("../db/client");
const authenticate_1 = __importDefault(require("../middlewares/authenticate"));
const requirePermission_1 = require("../middlewares/requirePermission");
const validate_1 = require("../middlewares/validate");
const principals_1 = require("../rbac/principals");
const context_1 = require("../rbac/context");
const AssignmentRequestsRepo_1 = require("../repositories/AssignmentRequestsRepo");
const AttachmentsRepo_1 = require("../repositories/AttachmentsRepo");
const ListsRepo_1 = require("../repositories/ListsRepo");
const NotificationsRepo_1 = require("../repositories/NotificationsRepo");
const StatusesRepo_1 = require("../repositories/StatusesRepo");
const TagsRepo_1 = require("../repositories/TagsRepo");
const TaskActivityRepo_1 = require("../repositories/TaskActivityRepo");
const TaskMembershipRepo_1 = require("../repositories/TaskMembershipRepo");
const TasksRepo_1 = require("../repositories/TasksRepo");
const TaskTypesRepo_1 = require("../repositories/TaskTypesRepo");
const UserRolesRepo_1 = require("../repositories/UserRolesRepo");
const UsersRepo_1 = require("../repositories/UsersRepo");
const WorkspaceActivityRepo_1 = require("../repositories/WorkspaceActivityRepo");
const WorkspaceRepo_1 = require("../repositories/WorkspaceRepo");
const policy_1 = require("../rbac/policy");
const AssignmentRequestsService_1 = require("../services/AssignmentRequestsService");
const TasksService_1 = require("../services/TasksService");
const TaskWriteService_1 = require("../services/TaskWriteService");
const assignmentRequests_1 = require("../validators/assignmentRequests");
const router = express_1.default.Router();
// ─── DI wiring ───────────────────────────────────────────────────────────────
// Declares full paths spanning `/assignment-requests/*` and
// `GET /tasks/:id/assignment-requests`, so it mounts at the v1 root BEFORE
// `/tasks` (its 2-segment task route must resolve ahead of the tasks router's
// `/:id` catch-alls) — the attachments-router pattern.
const db = (0, client_1.getDb)();
const requestsRepo = new AssignmentRequestsRepo_1.AssignmentRequestsRepo(db);
const tasksRepo = new TasksRepo_1.TasksRepo(db);
const listsRepo = new ListsRepo_1.ListsRepo(db);
const membershipRepo = new TaskMembershipRepo_1.TaskMembershipRepo(db);
const activityRepo = new TaskActivityRepo_1.TaskActivityRepo(db);
const notificationsRepo = new NotificationsRepo_1.NotificationsRepo(db);
const usersRepo = new UsersRepo_1.UsersRepo(db);
// The full task-write stack, wired locally (the forms/engineering precedent —
// this is the fourth wiring site), so `answer()` can route a due-date change
// through the REAL update path: validation, the `task_updated` audit diff, the
// ETag bump and the overdue-alert re-arm all fire exactly as a normal edit.
const taskWriteService = new TaskWriteService_1.TaskWriteService(db, listsRepo, new StatusesRepo_1.StatusesRepo(db), new TaskTypesRepo_1.TaskTypesRepo(db), tasksRepo, membershipRepo, usersRepo, new TagsRepo_1.TagsRepo(db), activityRepo, notificationsRepo, new AttachmentsRepo_1.AttachmentsRepo(db), new WorkspaceRepo_1.WorkspaceRepo(db), new WorkspaceActivityRepo_1.WorkspaceActivityRepo(db), new TasksService_1.TasksService(listsRepo, tasksRepo), logger_1.default);
/**
 * Fix B2: the requester of a pending request holds no `task.edit` after
 * upgrade 020, so the date change runs under the NARROW negotiation principal
 * (rbac/principals.ts §2c) — `task.edit` inside the task's own space, scope =
 * that one list, attribution = the requester. The service authorised the
 * caller as "the requester of this pending request" before this runs.
 */
const dueDateChanger = {
    apply: async (input) => {
        await (0, context_1.runWithPrincipal)((0, principals_1.negotiationAnswerPrincipal)({
            workspaceId: input.workspaceId,
            spaceId: input.spaceId,
            listId: input.listId,
            requesterId: input.actorId,
        }), () => taskWriteService.update({
            workspaceId: input.workspaceId,
            actorId: input.actorId,
            role: input.actorRole,
            taskId: input.taskId,
            fields: ["due_date"],
            patch: { dueDate: input.dueYmd },
        }));
    },
};
const service = new AssignmentRequestsService_1.AssignmentRequestsService(db, requestsRepo, tasksRepo, membershipRepo, activityRepo, notificationsRepo, usersRepo, new UserRolesRepo_1.UserRolesRepo(db), (0, policy_1.getPolicy)(), logger_1.default, dueDateChanger);
const controller = new AssignmentRequestsController_1.AssignmentRequestsController(service, logger_1.default);
// ─── GET /api/v1/assignment-requests ─────────────────────────────────────────
// 🔐 Any member — the list is RELATIONSHIP-scoped in the service: `box=received`
// (default) = requests addressed to me, `box=sent` = requests I raised,
// `box=team` = requests targeting members of teams I head (Q2).
// `status=pending` (default) | `all`. 200 `{ data: [...] }`, newest first.
router.get("/assignment-requests", authenticate_1.default, assignmentRequests_1.listAssignmentRequestsValidator, validate_1.validate, (req, res, next) => controller.list(req, res, next));
// ─── GET /api/v1/tasks/:id/assignment-requests ───────────────────────────────
// 🔐 `task.view` — the drawer panel feed. The verb gate + the service's task
// resolution through the scope-filtered TasksRepo (with the own-escape) make
// the feed readable exactly where the task itself is; an out-of-scope id stays
// a 404, never an existence oracle.
router.get("/tasks/:id/assignment-requests", authenticate_1.default, (0, requirePermission_1.requirePermission)("task.view"), (req, res, next) => controller.listForTask(req, res, next));
// ─── POST /api/v1/assignment-requests/:id/accept ─────────────────────────────
// 🔐 Decider only (the target, their team Head, or an admin — never the
// requester). Atomic claim, then the REAL assignment (assignee row, watcher,
// audit row, `assigned` notification + email/push) in one transaction.
// 200 `{ data }` · 403 `request.not_decider` · 409 `request.already_decided` /
// `request.expired` / `request.task_archived` / `request.user_inactive`.
router.post("/assignment-requests/:id/accept", authenticate_1.default, assignmentRequests_1.decideAssignmentRequestValidator, validate_1.validate, (req, res, next) => controller.accept(req, res, next));
// ─── POST /api/v1/assignment-requests/:id/decline ────────────────────────────
// 🔐 Decider only. The claim + ledger + "declined" to the requester; the task
// is untouched. Same status codes as accept.
router.post("/assignment-requests/:id/decline", authenticate_1.default, assignmentRequests_1.decideAssignmentRequestValidator, validate_1.validate, (req, res, next) => controller.decline(req, res, next));
// ─── POST /api/v1/assignment-requests/:id/query ──────────────────────────────
// 🔐 Decider only — "I need 2 more days": records the note + optional proposed
// date on the still-pending request and notifies the requester (R1.5).
router.post("/assignment-requests/:id/query", authenticate_1.default, assignmentRequests_1.queryAssignmentRequestValidator, validate_1.validate, (req, res, next) => controller.query(req, res, next));
// ─── POST /api/v1/assignment-requests/:id/answer ─────────────────────────────
// 🔐 The REQUESTER only (fix B2) — replies to a query with a note and/or a real
// due-date change (routed through the normal task-update path, so the
// overdue-alert re-arms). The request stays pending; the receiver still
// decides. 403 `request.not_requester` for anyone else.
router.post("/assignment-requests/:id/answer", authenticate_1.default, assignmentRequests_1.answerAssignmentRequestValidator, validate_1.validate, (req, res, next) => controller.answer(req, res, next));
// ─── POST /api/v1/assignment-requests/:id/cancel ─────────────────────────────
// 🔐 The requester (or an admin) withdraws a pending request; the target is
// told. 403 `request.not_requester` otherwise.
router.post("/assignment-requests/:id/cancel", authenticate_1.default, (req, res, next) => controller.cancel(req, res, next));
exports.default = router;
