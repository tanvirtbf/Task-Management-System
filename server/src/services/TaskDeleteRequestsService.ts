import type { Logger } from "winston";
import { MySql2Database } from "drizzle-orm/mysql2";
import * as schema from "../db/schema";
import type { TaskDeleteRequest } from "../db/schema";
import { Roles, type Role } from "../constants";
import { AppError } from "../errors";
import { fakeId } from "../utils";
import { holds } from "../rbac/can";
import { currentActor } from "../rbac/context";
import { assertTaskScoped, liveLegacyRole } from "../rbac/scopeGuard";
import type { NotificationsRepo } from "../repositories/NotificationsRepo";
import type { TaskDeleteRequestsRepo } from "../repositories/TaskDeleteRequestsRepo";
import type { TasksRepo } from "../repositories/TasksRepo";
import type { UsersRepo } from "../repositories/UsersRepo";
import type { WorkspaceActivityRepo } from "../repositories/WorkspaceActivityRepo";
import type { TaskWriteService } from "./TaskWriteService";

/**
 * PERMANENT-DELETE APPROVAL (upgrades/023, 2026-08-16).
 *
 * ── THE GAP THIS FILLS ───────────────────────────────────────────────────────
 * Deleting a task for good was admin-only and instant. Everyone else could
 * only ARCHIVE — reversible, and the task stays fully readable to anyone with
 * the id — so "please actually remove this" had no path at all, and no record
 * of who wanted it gone or why.
 *
 * Now: whoever may delete a task may REQUEST its removal; an Owner/Admin
 * approves or rejects; approval runs the EXISTING hard delete
 * (`TaskWriteService.del({hard:true})`), which already handles the subtree, the
 * recipients' notifications and the R2 purge queue. This service adds the
 * decision, not a second way to destroy things.
 *
 * ── THE THREE DECISIONS, LOCKED WITH THE OPERATOR (2026-08-16) ───────────────
 *  1. While a request is pending the task is COMPLETELY UNCHANGED — it stays in
 *     its list, editable, assignable. A request must never become a way to make
 *     a colleague's work disappear from their board.
 *  2. An Owner/Admin who deletes directly still deletes INSTANTLY. They are the
 *     approver; routing them through their own approval would be theatre.
 *  3. Only Owner/Admin approve. A department Head may REQUEST, not approve.
 *
 * ── WHY THE AUDIT ROW IS WRITTEN BEFORE THE DELETE ───────────────────────────
 * The request row's task FK cascades, so approving destroys the request along
 * with the task. The `workspace_activity` entry (whose `entity_id` has no FK)
 * is therefore written FIRST, carrying the task's name, the requester and the
 * approver — the same rule the permanent MEMBER delete follows: the evidence
 * has to outlive the thing it describes.
 */

/** What a caller gets back — either it is already gone, or it is queued. */
export interface DeleteRequestOutcome {
    /** true = the caller could approve it themselves; the task is gone. */
    deleted: boolean;
    request: TaskDeleteRequest | null;
}

export class TaskDeleteRequestsService {
    constructor(
        private db: MySql2Database<typeof schema>,
        private repo: TaskDeleteRequestsRepo,
        private tasks: TasksRepo,
        private taskWrite: TaskWriteService,
        private users: UsersRepo,
        private notifications: NotificationsRepo,
        private activity: WorkspaceActivityRepo,
        private logger: Logger,
    ) {}

    /**
     * May this caller approve a permanent delete? EXACTLY the gate the direct
     * hard delete already enforces (`TaskWriteService.del`): the live
     * owner/admin role AND the `task.delete_hard` grant. Composed, never
     * widened — granting the key to a member role still changes nothing.
     */
    private async canApprove(role: Role): Promise<boolean> {
        const live = await liveLegacyRole(role);
        if (live !== Roles.OWNER && live !== Roles.ADMIN) return false;
        return holds(await currentActor(), "task.delete_hard");
    }

    // ─── raising a request ───────────────────────────────────────────────────

    /**
     * Ask for a task to be permanently deleted.
     *
     * An approver gets the delete immediately (decision 2). Everyone else must
     * hold `task.delete` reaching THIS task — the same check that guards the
     * archive — and gets a pending row.
     */
    async request(input: {
        workspaceId: string;
        actorId: string;
        role: Role;
        taskId: string;
        reason?: string | null;
    }): Promise<DeleteRequestOutcome> {
        const task = await this.tasks.findByIdOrCustomIdInWorkspace(
            input.taskId,
            input.workspaceId,
        );
        if (!task) {
            throw AppError.notFound(
                "task.not_found",
                `Task ${input.taskId} does not exist`,
            );
        }
        // The reach check comes first for everyone: an admin whose grant does
        // not cover this task must not slip through on the role alone.
        await assertTaskScoped("task.delete", task, this.tasks);

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

        const spaceInfo = (await this.tasks.spaceInfoByTask([task.id])).get(
            task.id,
        );
        if (!spaceInfo?.spaceId) {
            // Unreachable for a real task (list → space is NOT NULL), but a
            // request row with a broken FK would be worse than a clear error.
            throw AppError.conflict(
                "task.no_space",
                "This task's owning team could not be resolved",
            );
        }

        const id = fakeId("tdr");
        await this.db.transaction(async (tx) => {
            // Lock the task row, then PRE-SELECT the duplicate. `ON DUPLICATE
            // KEY` is not usable to detect it: under mysql2's
            // CLIENT_FOUND_ROWS, affectedRows is ambiguous — the exact trap the
            // assignment-request build shipped and had to fix.
            await this.tasks.lockById(task.id, tx);
            const existing = await this.repo.findPendingByTask(task.id, tx);
            if (existing) {
                throw AppError.conflict(
                    "delete_request.already_pending",
                    "Someone has already asked for this task to be deleted",
                );
            }
            await this.repo.insert(
                {
                    id,
                    workspaceId: input.workspaceId,
                    spaceId: spaceInfo.spaceId,
                    taskId: task.id,
                    taskName: task.name,
                    requestedBy: input.actorId,
                    reason: input.reason?.trim() ? input.reason.trim() : null,
                },
                tx,
            );

            // Tell the people who can actually act on it. The task still
            // exists, so this notification may point at it.
            const admins = (
                await this.users.findActiveAdminIds(input.workspaceId)
            ).filter((uid) => uid !== input.actorId);
            if (admins.length > 0) {
                await this.notifications.createMany(
                    admins.map((userId) => ({
                        userId,
                        type: "delete_request" as const,
                        entityType: "task" as const,
                        entityId: task.id,
                        actorId: input.actorId,
                        title: `Permanent delete requested: ${task.name}`.slice(
                            0,
                            300,
                        ),
                        body: input.reason?.trim()?.slice(0, 1000) ?? null,
                    })),
                    tx,
                );
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
            request: await this.repo.findByIdInWorkspace(
                id,
                input.workspaceId,
            ),
        };
    }

    // ─── deciding ────────────────────────────────────────────────────────────

    /**
     * Approve or reject. The claim is atomic, so two admins pressing Approve
     * at the same moment cannot both proceed — the loser is told it was
     * already decided rather than trying to delete a task that is already gone.
     */
    async decide(input: {
        workspaceId: string;
        actorId: string;
        role: Role;
        requestId: string;
        approve: boolean;
        note?: string | null;
    }): Promise<void> {
        if (!(await this.canApprove(input.role))) {
            throw AppError.forbidden(
                "auth.forbidden",
                "Approving a permanent delete requires the admin or owner role",
            );
        }
        const req = await this.repo.findByIdInWorkspace(
            input.requestId,
            input.workspaceId,
        );
        if (!req) {
            throw AppError.notFound(
                "delete_request.not_found",
                "That delete request does not exist",
            );
        }
        if (req.status !== "pending") {
            throw AppError.conflict(
                "delete_request.already_decided",
                `This request was already ${req.status}`,
            );
        }

        const note = input.note?.trim() ? input.note.trim().slice(0, 500) : null;
        const claimed = await this.repo.claim({
            id: req.id,
            status: input.approve ? "approved" : "rejected",
            decidedBy: input.actorId,
            note,
        });
        if (!claimed) {
            throw AppError.conflict(
                "delete_request.already_decided",
                "Someone else decided this request first",
            );
        }

        // Tell the requester BEFORE the task can vanish. The entity is the
        // REQUEST, not the task: on approval the task is about to be destroyed
        // and a notification pointing at it would navigate to a 404 (ISS-073).
        if (req.requestedBy !== input.actorId) {
            await this.notifications.createMany([
                {
                    userId: req.requestedBy,
                    type: "delete_request_decided" as const,
                    entityType: "delete_request" as const,
                    entityId: req.id,
                    actorId: input.actorId,
                    title: input.approve
                        ? `Deleted permanently: ${req.taskName}`.slice(0, 300)
                        : `Delete request rejected: ${req.taskName}`.slice(
                              0,
                              300,
                          ),
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
    async cancel(input: {
        workspaceId: string;
        actorId: string;
        requestId: string;
    }): Promise<void> {
        const req = await this.repo.findByIdInWorkspace(
            input.requestId,
            input.workspaceId,
        );
        if (!req) {
            throw AppError.notFound(
                "delete_request.not_found",
                "That delete request does not exist",
            );
        }
        if (req.requestedBy !== input.actorId) {
            throw AppError.forbidden(
                "delete_request.not_requester",
                "Only the person who asked can withdraw this request",
            );
        }
        const claimed = await this.repo.claim({
            id: req.id,
            status: "cancelled",
            decidedBy: input.actorId,
            note: null,
        });
        if (!claimed) {
            throw AppError.conflict(
                "delete_request.already_decided",
                `This request was already ${req.status}`,
            );
        }
    }

    // ─── reading ─────────────────────────────────────────────────────────────

    /**
     * `box=pending` is the approver queue (Owner/Admin only — a member has no
     * business reading what other teams want removed); `box=mine` is the
     * caller's own history and is open to everyone.
     */
    async list(input: {
        workspaceId: string;
        actorId: string;
        role: Role;
        box: "pending" | "mine";
    }): Promise<TaskDeleteRequest[]> {
        if (input.box === "mine") {
            return this.repo.listByRequester(input.actorId, input.workspaceId);
        }
        if (!(await this.canApprove(input.role))) {
            throw AppError.forbidden(
                "auth.forbidden",
                "Only an admin or owner can see the delete-request queue",
            );
        }
        return this.repo.listPending(input.workspaceId);
    }

    /** The pending request on one task, for the drawer banner. */
    async forTask(input: {
        workspaceId: string;
        taskId: string;
    }): Promise<TaskDeleteRequest | null> {
        const task = await this.tasks.findByIdOrCustomIdInWorkspace(
            input.taskId,
            input.workspaceId,
        );
        // Scope-filtered read: an invisible task is a 404, never an oracle.
        if (!task) {
            throw AppError.notFound(
                "task.not_found",
                `Task ${input.taskId} does not exist`,
            );
        }
        return this.repo.findPendingByTask(task.id);
    }
}
