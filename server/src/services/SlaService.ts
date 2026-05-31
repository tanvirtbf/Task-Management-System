import type { Logger } from "winston";
import type { MySql2Database } from "drizzle-orm/mysql2";
import * as schema from "../db/schema";
import type { NewTask } from "../db/schema";
import { AppError } from "../errors";
import type { Role } from "../constants";
import type { SlaRepo, BreachFilters } from "../repositories/SlaRepo";
import type { TasksRepo } from "../repositories/TasksRepo";
import type { UsersRepo } from "../repositories/UsersRepo";
import type { TaskActivityRepo } from "../repositories/TaskActivityRepo";
import type { TasksService } from "./TasksService";
import { toWireUser, type WireUser } from "../serializers/userSerializer";
import type { WireTask } from "../serializers/taskSerializer";

/** Wire `SLABreach` per API_DESIGN.md §29 — note `assignees` is hydrated User[]. */
export interface SlaBreach {
    task_id: string;
    custom_id: string | null;
    name: string;
    task_type_id: string;
    sla_due_at: string;
    minutes_breached: number;
    assignees: WireUser[];
}

export interface ListBreachedInput {
    workspaceId: string;
    filters: BreachFilters;
}

export interface OverrideSlaInput {
    workspaceId: string;
    actorId: string;
    role: Role;
    taskId: string;
    /** ISO-8601 string to set, or null to clear. */
    slaDueAt: string | null;
}

/**
 * §29 SLA management — domain logic.
 */
export class SlaService {
    constructor(
        private db: MySql2Database<typeof schema>,
        private sla: SlaRepo,
        private tasks: TasksRepo,
        private users: UsersRepo,
        private activity: TaskActivityRepo,
        private reads: TasksService,
        private logger: Logger,
    ) {}

    /**
     * §29 #1 `GET /api/v1/sla/breached` (🔐 any member). Workspace-scoped list of
     * tasks past their SLA window that aren't done, newest-deadline-breached
     * first, with each task's assignees hydrated to full `User` objects (the
     * `SLABreach` shape). A bare array (no pagination envelope, per the spec).
     */
    async listBreached(input: ListBreachedInput): Promise<SlaBreach[]> {
        const rows = await this.sla.listBreached(
            input.workspaceId,
            input.filters,
        );
        if (rows.length === 0) return [];

        const taskIds = rows.map((r) => r.taskId);
        const assigneesByTask = await this.tasks.assigneesByTask(taskIds);
        const userIds = [...new Set([...assigneesByTask.values()].flat())];
        const userRows =
            userIds.length > 0
                ? await this.users.findManyByIdsInWorkspace(
                      userIds,
                      input.workspaceId,
                  )
                : [];
        const userMap = new Map(userRows.map((u) => [u.id, toWireUser(u)]));

        return rows.map((r) => ({
            task_id: r.taskId,
            custom_id: r.customId,
            name: r.name,
            task_type_id: r.taskTypeId,
            sla_due_at: r.slaDueAt.toISOString(),
            minutes_breached: r.minutesBreached,
            assignees: (assigneesByTask.get(r.taskId) ?? [])
                .map((uid) => userMap.get(uid))
                .filter((u): u is WireUser => u !== undefined),
        }));
    }

    /**
     * §29 #2 `PATCH /api/v1/tasks/:id/sla` (👑 owner/admin). Manually set or clear
     * `sla_due_at` on a task (override). A set value must be in the future (422
     * `sla.invalid_due_at`). The update + a `sla_overridden` activity row commit
     * in one transaction; the fully-hydrated Task is returned (200), GET-identical.
     *
     * NOTE (V1 decision): there is NO `sla_override` tracking column — a later
     * `bug_severity` PATCH (§10) will recompute and overwrite this manual value.
     * The spec marks override-tracking as TBD; revisit if that becomes required.
     */
    async override(input: OverrideSlaInput): Promise<WireTask> {
        const current = await this.tasks.findByIdOrCustomIdInWorkspace(
            input.taskId,
            input.workspaceId,
        );
        if (!current) {
            throw AppError.notFound(
                "task.not_found",
                `Task ${input.taskId} does not exist`,
            );
        }
        if (current.archivedAt) {
            throw AppError.conflict(
                "task.archived",
                "Cannot update an archived task; unarchive it first",
            );
        }

        let newDueAt: Date | null = null;
        if (input.slaDueAt !== null) {
            newDueAt = new Date(input.slaDueAt);
            if (newDueAt.getTime() <= Date.now()) {
                throw AppError.unprocessable(
                    "sla.invalid_due_at",
                    "SLA due date must be in the future",
                );
            }
        }

        await this.db.transaction(async (tx) => {
            const patch: Partial<NewTask> = { slaDueAt: newDueAt };
            await this.tasks.update(current.id, patch, tx);
            await this.activity.recordMany(
                [
                    {
                        taskId: current.id,
                        actorId: input.actorId,
                        action: "sla_overridden",
                        context: {
                            from: current.slaDueAt
                                ? current.slaDueAt.toISOString()
                                : null,
                            to: input.slaDueAt,
                        },
                    },
                ],
                tx,
            );
        });

        this.logger.debug("sla.override.saved", {
            workspaceId: input.workspaceId,
            taskId: current.id,
            cleared: input.slaDueAt === null,
        });

        return this.reads.getById({
            idOrKey: current.id,
            workspaceId: input.workspaceId,
            role: input.role,
        });
    }
}
