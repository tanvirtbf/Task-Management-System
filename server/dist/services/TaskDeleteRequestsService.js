"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TaskDeleteRequestsService = void 0;
const constants_1 = require("../constants");
const errors_1 = require("../errors");
const utils_1 = require("../utils");
const can_1 = require("../rbac/can");
const context_1 = require("../rbac/context");
const scopeGuard_1 = require("../rbac/scopeGuard");
class TaskDeleteRequestsService {
    db;
    repo;
    tasks;
    taskWrite;
    users;
    notifications;
    activity;
    logger;
    constructor(db, repo, tasks, taskWrite, users, notifications, activity, logger) {
        this.db = db;
        this.repo = repo;
        this.tasks = tasks;
        this.taskWrite = taskWrite;
        this.users = users;
        this.notifications = notifications;
        this.activity = activity;
        this.logger = logger;
    }
    /**
     * May this caller approve a permanent delete? EXACTLY the gate the direct
     * hard delete already enforces (`TaskWriteService.del`): the live
     * owner/admin role AND the `task.delete_hard` grant. Composed, never
     * widened — granting the key to a member role still changes nothing.
     */
    async canApprove(role) {
        const live = await (0, scopeGuard_1.liveLegacyRole)(role);
        if (live !== constants_1.Roles.OWNER && live !== constants_1.Roles.ADMIN)
            return false;
        return (0, can_1.holds)(await (0, context_1.currentActor)(), "task.delete_hard");
    }
    // ─── raising a request ───────────────────────────────────────────────────
    /**
     * Ask for a task to be permanently deleted.
     *
     * An approver gets the delete immediately (decision 2). Everyone else must
     * hold `task.delete` reaching THIS task — the same check that guards the
     * archive — and gets a pending row.
     */
    async request(input) {
        const task = await this.tasks.findByIdOrCustomIdInWorkspace(input.taskId, input.workspaceId);
        if (!task) {
            throw errors_1.AppError.notFound("task.not_found", `Task ${input.taskId} does not exist`);
        }
        // The reach check comes first for everyone: an admin whose grant does
        // not cover this task must not slip through on the role alone.
        await (0, scopeGuard_1.assertTaskScoped)("task.delete", task, this.tasks);
        if (await this.canApprove(input.role)) {
            await this.taskWrite.del({
                workspaceId: input.workspaceId,
                actorId: input.actorId,
                role: input.role,
                taskId: task.id,
                hard: true,
            });
            this.logger.info("task_delete_requests.instant", {
                workspaceId: input.workspaceId,
                actorId: input.actorId,
                taskId: task.id,
            });
            return { deleted: true, request: null };
        }
        const spaceInfo = (await this.tasks.spaceInfoByTask([task.id])).get(task.id);
        if (!spaceInfo?.spaceId) {
            // Unreachable for a real task (list → space is NOT NULL), but a
            // request row with a broken FK would be worse than a clear error.
            throw errors_1.AppError.conflict("task.no_space", "This task's owning team could not be resolved");
        }
        const id = (0, utils_1.fakeId)("tdr");
        await this.db.transaction(async (tx) => {
            // Lock the task row, then PRE-SELECT the duplicate. `ON DUPLICATE
            // KEY` is not usable to detect it: under mysql2's
            // CLIENT_FOUND_ROWS, affectedRows is ambiguous — the exact trap the
            // assignment-request build shipped and had to fix.
            await this.tasks.lockById(task.id, tx);
            const existing = await this.repo.findPendingByTask(task.id, tx);
            if (existing) {
                throw errors_1.AppError.conflict("delete_request.already_pending", "Someone has already asked for this task to be deleted");
            }
            await this.repo.insert({
                id,
                workspaceId: input.workspaceId,
                spaceId: spaceInfo.spaceId,
                taskId: task.id,
                taskName: task.name,
                requestedBy: input.actorId,
                reason: input.reason?.trim() ? input.reason.trim() : null,
            }, tx);
            // Tell the people who can actually act on it. The task still
            // exists, so this notification may point at it.
            const admins = (await this.users.findActiveAdminIds(input.workspaceId)).filter((uid) => uid !== input.actorId);
            if (admins.length > 0) {
                await this.notifications.createMany(admins.map((userId) => ({
                    userId,
                    type: "delete_request",
                    entityType: "task",
                    entityId: task.id,
                    actorId: input.actorId,
                    title: `Permanent delete requested: ${task.name}`.slice(0, 300),
                    body: input.reason?.trim()?.slice(0, 1000) ?? null,
                })), tx);
            }
        });
        this.logger.info("task_delete_requests.created", {
            workspaceId: input.workspaceId,
            actorId: input.actorId,
            taskId: task.id,
            requestId: id,
        });
        return {
            deleted: false,
            request: await this.repo.findByIdInWorkspace(id, input.workspaceId),
        };
    }
    // ─── deciding ────────────────────────────────────────────────────────────
    /**
     * Approve or reject. The claim is atomic, so two admins pressing Approve
     * at the same moment cannot both proceed — the loser is told it was
     * already decided rather than trying to delete a task that is already gone.
     */
    async decide(input) {
        if (!(await this.canApprove(input.role))) {
            throw errors_1.AppError.forbidden("auth.forbidden", "Approving a permanent delete requires the admin or owner role");
        }
        const req = await this.repo.findByIdInWorkspace(input.requestId, input.workspaceId);
        if (!req) {
            throw errors_1.AppError.notFound("delete_request.not_found", "That delete request does not exist");
        }
        if (req.status !== "pending") {
            throw errors_1.AppError.conflict("delete_request.already_decided", `This request was already ${req.status}`);
        }
        const note = input.note?.trim() ? input.note.trim().slice(0, 500) : null;
        const claimed = await this.repo.claim({
            id: req.id,
            status: input.approve ? "approved" : "rejected",
            decidedBy: input.actorId,
            note,
        });
        if (!claimed) {
            throw errors_1.AppError.conflict("delete_request.already_decided", "Someone else decided this request first");
        }
        // Tell the requester BEFORE the task can vanish. The entity is the
        // REQUEST, not the task: on approval the task is about to be destroyed
        // and a notification pointing at it would navigate to a 404 (ISS-073).
        if (req.requestedBy !== input.actorId) {
            await this.notifications.createMany([
                {
                    userId: req.requestedBy,
                    type: "delete_request_decided",
                    entityType: "delete_request",
                    entityId: req.id,
                    actorId: input.actorId,
                    title: input.approve
                        ? `Deleted permanently: ${req.taskName}`.slice(0, 300)
                        : `Delete request rejected: ${req.taskName}`.slice(0, 300),
                    body: note,
                },
            ]);
        }
        if (!input.approve) {
            this.logger.info("task_delete_requests.rejected", {
                workspaceId: input.workspaceId,
                actorId: input.actorId,
                requestId: req.id,
            });
            return;
        }
        // The evidence has to outlive the task AND (via the FK cascade) this
        // request row. The hard delete already writes exactly such a row
        // inside its own transaction, so the request's facts are merged INTO
        // it rather than written as a second one — one row that explains
        // itself beats two that each tell half the story (and the activity
        // feed was showing the same deletion twice).
        await this.taskWrite.del({
            workspaceId: input.workspaceId,
            actorId: input.actorId,
            role: input.role,
            taskId: req.taskId,
            hard: true,
            auditContext: {
                via: "delete_request",
                requested_by: req.requestedBy,
                reason: req.reason,
                decision_note: note,
            },
        });
        this.logger.info("task_delete_requests.approved", {
            workspaceId: input.workspaceId,
            actorId: input.actorId,
            requestId: req.id,
            taskId: req.taskId,
        });
    }
    /** The requester changes their mind. Same atomic claim, no admin needed. */
    async cancel(input) {
        const req = await this.repo.findByIdInWorkspace(input.requestId, input.workspaceId);
        if (!req) {
            throw errors_1.AppError.notFound("delete_request.not_found", "That delete request does not exist");
        }
        if (req.requestedBy !== input.actorId) {
            throw errors_1.AppError.forbidden("delete_request.not_requester", "Only the person who asked can withdraw this request");
        }
        const claimed = await this.repo.claim({
            id: req.id,
            status: "cancelled",
            decidedBy: input.actorId,
            note: null,
        });
        if (!claimed) {
            throw errors_1.AppError.conflict("delete_request.already_decided", `This request was already ${req.status}`);
        }
    }
    // ─── reading ─────────────────────────────────────────────────────────────
    /**
     * `box=pending` is the approver queue (Owner/Admin only — a member has no
     * business reading what other teams want removed); `box=mine` is the
     * caller's own history and is open to everyone.
     */
    async list(input) {
        if (input.box === "mine") {
            return this.repo.listByRequester(input.actorId, input.workspaceId);
        }
        if (!(await this.canApprove(input.role))) {
            throw errors_1.AppError.forbidden("auth.forbidden", "Only an admin or owner can see the delete-request queue");
        }
        return this.repo.listPending(input.workspaceId);
    }
    /** The pending request on one task, for the drawer banner. */
    async forTask(input) {
        const task = await this.tasks.findByIdOrCustomIdInWorkspace(input.taskId, input.workspaceId);
        // Scope-filtered read: an invisible task is a 404, never an oracle.
        if (!task) {
            throw errors_1.AppError.notFound("task.not_found", `Task ${input.taskId} does not exist`);
        }
        return this.repo.findPendingByTask(task.id);
    }
}
exports.TaskDeleteRequestsService = TaskDeleteRequestsService;
