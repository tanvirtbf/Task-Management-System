import express, {
    type NextFunction,
    type Request,
    type Response,
} from "express";
import logger from "../config/logger";
import type { Role } from "../constants";
import { AssignmentRequestsController } from "../controllers/AssignmentRequestsController";
import { getDb } from "../db/client";
import authenticate from "../middlewares/authenticate";
import { requirePermission } from "../middlewares/requirePermission";
import { validate } from "../middlewares/validate";
import { negotiationAnswerPrincipal } from "../rbac/principals";
import { runWithPrincipal } from "../rbac/context";
import { AssignmentRequestsRepo } from "../repositories/AssignmentRequestsRepo";
import { AttachmentsRepo } from "../repositories/AttachmentsRepo";
import { ListsRepo } from "../repositories/ListsRepo";
import { NotificationsRepo } from "../repositories/NotificationsRepo";
import { StatusesRepo } from "../repositories/StatusesRepo";
import { TagsRepo } from "../repositories/TagsRepo";
import { TaskActivityRepo } from "../repositories/TaskActivityRepo";
import { TaskMembershipRepo } from "../repositories/TaskMembershipRepo";
import { TasksRepo } from "../repositories/TasksRepo";
import { TaskTypesRepo } from "../repositories/TaskTypesRepo";
import { UserRolesRepo } from "../repositories/UserRolesRepo";
import { UsersRepo } from "../repositories/UsersRepo";
import { WorkspaceActivityRepo } from "../repositories/WorkspaceActivityRepo";
import { WorkspaceRepo } from "../repositories/WorkspaceRepo";
import { getPolicy } from "../rbac/policy";
import {
    AssignmentRequestsService,
    type AnswerDateChange,
} from "../services/AssignmentRequestsService";
import { TasksService } from "../services/TasksService";
import { TaskWriteService } from "../services/TaskWriteService";
import type { AuthRequest } from "../types";
import {
    answerAssignmentRequestValidator,
    decideAssignmentRequestValidator,
    listAssignmentRequestsValidator,
    queryAssignmentRequestValidator,
} from "../validators/assignmentRequests";

const router = express.Router();

// ─── DI wiring ───────────────────────────────────────────────────────────────
// Declares full paths spanning `/assignment-requests/*` and
// `GET /tasks/:id/assignment-requests`, so it mounts at the v1 root BEFORE
// `/tasks` (its 2-segment task route must resolve ahead of the tasks router's
// `/:id` catch-alls) — the attachments-router pattern.
const db = getDb();
const requestsRepo = new AssignmentRequestsRepo(db);
const tasksRepo = new TasksRepo(db);
const listsRepo = new ListsRepo(db);
const membershipRepo = new TaskMembershipRepo(db);
const activityRepo = new TaskActivityRepo(db);
const notificationsRepo = new NotificationsRepo(db);
const usersRepo = new UsersRepo(db);

// The full task-write stack, wired locally (the forms/engineering precedent —
// this is the fourth wiring site), so `answer()` can route a due-date change
// through the REAL update path: validation, the `task_updated` audit diff, the
// ETag bump and the overdue-alert re-arm all fire exactly as a normal edit.
const taskWriteService = new TaskWriteService(
    db,
    listsRepo,
    new StatusesRepo(db),
    new TaskTypesRepo(db),
    tasksRepo,
    membershipRepo,
    usersRepo,
    new TagsRepo(db),
    activityRepo,
    notificationsRepo,
    new AttachmentsRepo(db),
    new WorkspaceRepo(db),
    new WorkspaceActivityRepo(db),
    new TasksService(listsRepo, tasksRepo),
    logger,
);

/**
 * Fix B2: the requester of a pending request holds no `task.edit` after
 * upgrade 020, so the date change runs under the NARROW negotiation principal
 * (rbac/principals.ts §2c) — `task.edit` inside the task's own space, scope =
 * that one list, attribution = the requester. The service authorised the
 * caller as "the requester of this pending request" before this runs.
 */
const dueDateChanger = {
    apply: async (input: AnswerDateChange): Promise<void> => {
        await runWithPrincipal(
            negotiationAnswerPrincipal({
                workspaceId: input.workspaceId,
                spaceId: input.spaceId,
                listId: input.listId,
                requesterId: input.actorId,
            }),
            () =>
                taskWriteService.update({
                    workspaceId: input.workspaceId,
                    actorId: input.actorId,
                    role: input.actorRole as Role,
                    taskId: input.taskId,
                    fields: ["due_date"],
                    patch: { dueDate: input.dueYmd },
                }),
        );
    },
};

const service = new AssignmentRequestsService(
    db,
    requestsRepo,
    tasksRepo,
    membershipRepo,
    activityRepo,
    notificationsRepo,
    usersRepo,
    new UserRolesRepo(db),
    getPolicy(),
    logger,
    dueDateChanger,
);
const controller = new AssignmentRequestsController(service, logger);

// ─── GET /api/v1/assignment-requests ─────────────────────────────────────────
// 🔐 Any member — the list is RELATIONSHIP-scoped in the service: `box=received`
// (default) = requests addressed to me, `box=sent` = requests I raised,
// `box=team` = requests targeting members of teams I head (Q2).
// `status=pending` (default) | `all`. 200 `{ data: [...] }`, newest first.
router.get(
    "/assignment-requests",
    authenticate,
    listAssignmentRequestsValidator,
    validate,
    (req: Request, res: Response, next: NextFunction) =>
        controller.list(req as AuthRequest, res, next),
);

// ─── GET /api/v1/tasks/:id/assignment-requests ───────────────────────────────
// 🔐 `task.view` — the drawer panel feed. The verb gate + the service's task
// resolution through the scope-filtered TasksRepo (with the own-escape) make
// the feed readable exactly where the task itself is; an out-of-scope id stays
// a 404, never an existence oracle.
router.get(
    "/tasks/:id/assignment-requests",
    authenticate,
    requirePermission("task.view"),
    (req: Request, res: Response, next: NextFunction) =>
        controller.listForTask(
            req as AuthRequest & { params: { id: string } },
            res,
            next,
        ),
);

// ─── POST /api/v1/assignment-requests/:id/accept ─────────────────────────────
// 🔐 Decider only (the target, their team Head, or an admin — never the
// requester). Atomic claim, then the REAL assignment (assignee row, watcher,
// audit row, `assigned` notification + email/push) in one transaction.
// 200 `{ data }` · 403 `request.not_decider` · 409 `request.already_decided` /
// `request.expired` / `request.task_archived` / `request.user_inactive`.
router.post(
    "/assignment-requests/:id/accept",
    authenticate,
    decideAssignmentRequestValidator,
    validate,
    (req: Request, res: Response, next: NextFunction) =>
        controller.accept(
            req as AuthRequest & { params: { id: string } },
            res,
            next,
        ),
);

// ─── POST /api/v1/assignment-requests/:id/decline ────────────────────────────
// 🔐 Decider only. The claim + ledger + "declined" to the requester; the task
// is untouched. Same status codes as accept.
router.post(
    "/assignment-requests/:id/decline",
    authenticate,
    decideAssignmentRequestValidator,
    validate,
    (req: Request, res: Response, next: NextFunction) =>
        controller.decline(
            req as AuthRequest & { params: { id: string } },
            res,
            next,
        ),
);

// ─── POST /api/v1/assignment-requests/:id/query ──────────────────────────────
// 🔐 Decider only — "I need 2 more days": records the note + optional proposed
// date on the still-pending request and notifies the requester (R1.5).
router.post(
    "/assignment-requests/:id/query",
    authenticate,
    queryAssignmentRequestValidator,
    validate,
    (req: Request, res: Response, next: NextFunction) =>
        controller.query(
            req as AuthRequest & { params: { id: string } },
            res,
            next,
        ),
);

// ─── POST /api/v1/assignment-requests/:id/answer ─────────────────────────────
// 🔐 The REQUESTER only (fix B2) — replies to a query with a note and/or a real
// due-date change (routed through the normal task-update path, so the
// overdue-alert re-arms). The request stays pending; the receiver still
// decides. 403 `request.not_requester` for anyone else.
router.post(
    "/assignment-requests/:id/answer",
    authenticate,
    answerAssignmentRequestValidator,
    validate,
    (req: Request, res: Response, next: NextFunction) =>
        controller.answer(
            req as AuthRequest & { params: { id: string } },
            res,
            next,
        ),
);

// ─── POST /api/v1/assignment-requests/:id/cancel ─────────────────────────────
// 🔐 The requester (or an admin) withdraws a pending request; the target is
// told. 403 `request.not_requester` otherwise.
router.post(
    "/assignment-requests/:id/cancel",
    authenticate,
    (req: Request, res: Response, next: NextFunction) =>
        controller.cancel(
            req as AuthRequest & { params: { id: string } },
            res,
            next,
        ),
);

export default router;
