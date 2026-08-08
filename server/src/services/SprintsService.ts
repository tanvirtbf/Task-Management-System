import { MySql2Database } from "drizzle-orm/mysql2";
import type { Logger } from "winston";
import * as schema from "../db/schema";
import type { Sprint } from "../db/schema";
import { AppError } from "../errors";
import {
    SprintsRepo,
    type SprintStatus,
    type SprintUpdateFields,
} from "../repositories/SprintsRepo";
import { WorkspaceActivityRepo } from "../repositories/WorkspaceActivityRepo";
import { TaskActivityRepo } from "../repositories/TaskActivityRepo";
import {
    formatWireDate,
    toWireSprint,
    type WireSprint,
} from "../serializers/sprintSerializer";

/** mysql2 surfaces a unique-violation (`uq_sprints_workspace_name`) as
 *  `ER_DUP_ENTRY` / errno 1062. */
const isDuplicateKeyError = (err: unknown): boolean => {
    const e = err as { code?: string; errno?: number } | null;
    return e?.code === "ER_DUP_ENTRY" || e?.errno === 1062;
};

/**
 * Parse a `YYYY-MM-DD` wire date into a LOCAL-midnight `Date` for the MySQL DATE
 * column (Drizzle `date()` mode "date"). Local midnight round-trips cleanly
 * through the serializer's **UTC**-component formatting, so the calendar day is
 * exact under any process TZ. Mirrors §10's `toDateOnly`.
 *
 * F3: this built LOCAL midnight and the comment argued that avoided a
 * "UTC-boundary shift". That was true only while the driver ran on the process
 * TZ; with the session pinned to UTC it is exactly backwards — local midnight in
 * Dhaka is 18:00 UTC the previous day, which a DATE column truncates to the wrong
 * day. UTC midnight is what Drizzle reads back, so both ends now agree.
 */
const toDateOnly = (value: string): Date => {
    const [y, m, d] = value.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, d));
};

export interface ListSprintsInput {
    workspaceId: string;
    status?: SprintStatus;
}
export interface GetActiveSprintInput {
    workspaceId: string;
}
export interface GetSprintInput {
    id: string;
    workspaceId: string;
}
export interface CreateSprintInput {
    workspaceId: string;
    actorId: string;
    name: string;
    goal: string | null;
    startDate: string;
    endDate: string;
    committedPoints: number;
}
export interface UpdateSprintInput {
    id: string;
    workspaceId: string;
    actorId: string;
    fields: {
        name?: string;
        goal?: string | null;
        startDate?: string;
        endDate?: string;
        committedPoints?: number;
    };
}
export interface SprintActionInput {
    id: string;
    workspaceId: string;
    actorId: string;
}
export interface AddSprintTasksInput {
    id: string;
    workspaceId: string;
    actorId: string;
    taskIds: string[];
}
export interface RemoveSprintTaskInput {
    id: string;
    workspaceId: string;
    actorId: string;
    taskId: string;
}

/**
 * §20 Sprints domain logic. Owns the sprint lifecycle (planned → active →
 * closed, with the single-active-per-workspace invariant enforced in a
 * workspace-serialised transaction since the DB does not constrain it) and the
 * `tasks.sprint_id` membership writes. Every mutation appends a
 * `workspace_activity` row (entity_type `sprint`); task moves also append
 * `task_activity` per affected task — all in the same transaction as the change.
 *
 * Reuses only `SprintsRepo` (self-contained — no edits to the shared tasks
 * files); "completed points" is derived, never stored: it is summed at read
 * time and snapshotted into the close audit row.
 */
export class SprintsService {
    constructor(
        private db: MySql2Database<typeof schema>,
        private sprints: SprintsRepo,
        private wsActivity: WorkspaceActivityRepo,
        private taskActivity: TaskActivityRepo,
        private logger: Logger,
    ) {}

    /** #1 — all sprints in the workspace, optional `status` filter. */
    async list(input: ListSprintsInput): Promise<WireSprint[]> {
        const rows = await this.sprints.listByWorkspace(
            input.workspaceId,
            input.status,
        );
        return rows.map(toWireSprint);
    }

    /** #2 — the single active sprint (404 `sprint.not_found` if none). */
    async getActive(input: GetActiveSprintInput): Promise<WireSprint> {
        const row = await this.sprints.findActive(input.workspaceId);
        if (!row) {
            throw AppError.notFound(
                "sprint.not_found",
                "No sprint is currently active",
            );
        }
        return toWireSprint(row);
    }

    /** #3 — one sprint by id, resolved in the caller's workspace. */
    async getById(input: GetSprintInput): Promise<WireSprint> {
        const row = await this.sprints.findByIdInWorkspace(
            input.id,
            input.workspaceId,
        );
        if (!row) {
            throw AppError.notFound(
                "sprint.not_found",
                `Sprint ${input.id} does not exist`,
            );
        }
        return toWireSprint(row);
    }

    /**
     * #4 — create a `planned` sprint. The insert + a `workspace_activity`
     * `created` row are one transaction. A clashing name trips
     * `uq_sprints_workspace_name` → `409 sprint.duplicate`; an out-of-order date
     * pair is rejected up front with `422 validation.failed` (the DB
     * `ck_sprints_dates` is the backstop).
     */
    async create(input: CreateSprintInput): Promise<WireSprint> {
        this.assertDateOrder(input.startDate, input.endDate);

        // F22 (ISS-011): §32 promises `sprint.overlap` — one team, one sprint
        // at a time. Two overlapping sprints made "which sprint is this week?"
        // ambiguous for the engineering pages.
        const clash = await this.sprints.findOverlapping(
            input.workspaceId,
            toDateOnly(input.startDate),
            toDateOnly(input.endDate),
        );
        if (clash) {
            throw AppError.conflict(
                "sprint.overlap",
                `Dates overlap sprint "${clash.name}" (${clash.id})`,
            );
        }

        const row = await this.db.transaction(async (tx) => {
            let created: Sprint;
            try {
                created = await this.sprints.insert(
                    {
                        workspaceId: input.workspaceId,
                        name: input.name,
                        goal: input.goal,
                        startDate: toDateOnly(input.startDate),
                        endDate: toDateOnly(input.endDate),
                        committedPoints: input.committedPoints,
                    },
                    tx,
                );
            } catch (err) {
                if (isDuplicateKeyError(err)) {
                    throw AppError.conflict(
                        "sprint.duplicate",
                        `A sprint named "${input.name}" already exists`,
                    );
                }
                throw err;
            }

            await this.wsActivity.record(
                {
                    workspaceId: input.workspaceId,
                    actorId: input.actorId,
                    entityType: "sprint",
                    entityId: created.id,
                    action: "created",
                    context: { name: created.name, status: created.status },
                },
                tx,
            );
            return created;
        });

        return toWireSprint(row);
    }

    /**
     * #5 — partial update of name / goal / dates / committed_points. Locks the
     * row, diffs against the stored values (a genuine no-op writes nothing and
     * returns 200), re-checks the merged date order, and records `updated` with
     * the changed field list. A name clash → `409 sprint.duplicate`.
     */
    async update(input: UpdateSprintInput): Promise<WireSprint> {
        const { id, workspaceId, actorId, fields } = input;

        const row = await this.db.transaction(async (tx) => {
            const current = await this.sprints.lockByIdInWorkspace(
                id,
                workspaceId,
                tx,
            );
            if (!current) {
                throw AppError.notFound(
                    "sprint.not_found",
                    `Sprint ${id} does not exist`,
                );
            }

            const patch: SprintUpdateFields = {};
            const changed: string[] = [];

            if (fields.name !== undefined && fields.name !== current.name) {
                patch.name = fields.name;
                changed.push("name");
            }
            if (fields.goal !== undefined && fields.goal !== current.goal) {
                patch.goal = fields.goal;
                changed.push("goal");
            }
            if (
                fields.committedPoints !== undefined &&
                fields.committedPoints !== current.committedPoints
            ) {
                patch.committedPoints = fields.committedPoints;
                changed.push("committed_points");
            }

            // Re-check date order against the merged (request ∪ stored) pair, since
            // a PATCH may send only one of the two dates.
            const curStart = formatWireDate(current.startDate);
            const curEnd = formatWireDate(current.endDate);
            const effStart = fields.startDate ?? curStart;
            const effEnd = fields.endDate ?? curEnd;
            this.assertDateOrder(effStart, effEnd);

            // F22 (ISS-011): the same overlap rule on a date change, ignoring
            // the sprint itself.
            if (
                fields.startDate !== undefined ||
                fields.endDate !== undefined
            ) {
                const clash = await this.sprints.findOverlapping(
                    input.workspaceId,
                    toDateOnly(effStart),
                    toDateOnly(effEnd),
                    current.id,
                    tx,
                );
                if (clash) {
                    throw AppError.conflict(
                        "sprint.overlap",
                        `Dates overlap sprint "${clash.name}" (${clash.id})`,
                    );
                }
            }

            if (fields.startDate !== undefined && fields.startDate !== curStart) {
                patch.startDate = toDateOnly(fields.startDate);
                changed.push("start_date");
            }
            if (fields.endDate !== undefined && fields.endDate !== curEnd) {
                patch.endDate = toDateOnly(fields.endDate);
                changed.push("end_date");
            }

            if (changed.length === 0) return current; // no-op, no activity

            try {
                await this.sprints.updateFields(id, workspaceId, patch, tx);
            } catch (err) {
                if (isDuplicateKeyError(err)) {
                    throw AppError.conflict(
                        "sprint.duplicate",
                        `A sprint named "${fields.name}" already exists`,
                    );
                }
                throw err;
            }

            await this.wsActivity.record(
                {
                    workspaceId,
                    actorId,
                    entityType: "sprint",
                    entityId: id,
                    action: "updated",
                    context: { fields: changed },
                },
                tx,
            );

            const updated = await this.sprints.findByIdInWorkspace(
                id,
                workspaceId,
                tx,
            );
            if (!updated) throw AppError.internal();
            return updated;
        });

        return toWireSprint(row);
    }

    /**
     * #6 — start a sprint (planned → active). The workspace row is locked first
     * so concurrent starts serialise: at most one sprint per workspace can be
     * active. Already-active is an idempotent 200; a closed sprint cannot start
     * (`409 sprint.invalid_status`); another active sprint blocks it
     * (`422 sprint.another_active`).
     */
    async start(input: SprintActionInput): Promise<WireSprint> {
        const { id, workspaceId, actorId } = input;

        const row = await this.db.transaction(async (tx) => {
            await this.sprints.lockWorkspace(workspaceId, tx);
            const current = await this.sprints.lockByIdInWorkspace(
                id,
                workspaceId,
                tx,
            );
            if (!current) {
                throw AppError.notFound(
                    "sprint.not_found",
                    `Sprint ${id} does not exist`,
                );
            }
            if (current.status === "active") return current; // idempotent
            if (current.status === "closed") {
                throw AppError.conflict(
                    "sprint.invalid_status",
                    "A closed sprint cannot be started",
                );
            }

            const other = await this.sprints.findOtherActive(
                workspaceId,
                id,
                tx,
            );
            if (other) {
                throw AppError.unprocessable(
                    "sprint.another_active",
                    `Sprint "${other.name}" is already active`,
                );
            }

            await this.sprints.setStatus(id, workspaceId, "active", tx);
            await this.wsActivity.record(
                {
                    workspaceId,
                    actorId,
                    entityType: "sprint",
                    entityId: id,
                    action: "started",
                    context: { name: current.name },
                },
                tx,
            );

            const updated = await this.sprints.findByIdInWorkspace(
                id,
                workspaceId,
                tx,
            );
            if (!updated) throw AppError.internal();
            return updated;
        });

        return toWireSprint(row);
    }

    /**
     * #7 — close a sprint (active → closed). Snapshots the completed-points figure
     * (sum of story points of done/closed tasks) into the audit row, rolls the
     * sprint's UNFINISHED tasks over to the next planned sprint (if one exists),
     * and returns `{ rolled_over: N }`. Already-closed is an idempotent
     * `{ rolled_over: 0 }`; a planned sprint cannot be closed
     * (`409 sprint.invalid_status`). Workspace-serialised like start.
     */
    async close(input: SprintActionInput): Promise<{ rolled_over: number }> {
        const { id, workspaceId, actorId } = input;

        return this.db.transaction(async (tx) => {
            await this.sprints.lockWorkspace(workspaceId, tx);
            const current = await this.sprints.lockByIdInWorkspace(
                id,
                workspaceId,
                tx,
            );
            if (!current) {
                throw AppError.notFound(
                    "sprint.not_found",
                    `Sprint ${id} does not exist`,
                );
            }
            if (current.status === "closed") return { rolled_over: 0 }; // idempotent
            if (current.status === "planned") {
                throw AppError.conflict(
                    "sprint.invalid_status",
                    "Only an active sprint can be closed",
                );
            }

            const completedPoints = await this.sprints.sumCompletedPoints(
                id,
                workspaceId,
                tx,
            );
            const unfinished = await this.sprints.findUnfinishedTaskIdsInSprint(
                id,
                workspaceId,
                tx,
            );
            const next = await this.sprints.findNextPlanned(workspaceId, id, tx);

            let rolledOver = 0;
            if (next && unfinished.length > 0) {
                await this.sprints.setSprintForTasks(
                    unfinished,
                    next.id,
                    workspaceId,
                    tx,
                );
                rolledOver = unfinished.length;
                await this.taskActivity.recordMany(
                    unfinished.map((taskId) => ({
                        taskId,
                        actorId,
                        action: "sprint_rolled_over",
                        context: { from_sprint_id: id, to_sprint_id: next.id },
                    })),
                    tx,
                );
            }

            await this.sprints.setStatus(id, workspaceId, "closed", tx);
            await this.wsActivity.record(
                {
                    workspaceId,
                    actorId,
                    entityType: "sprint",
                    entityId: id,
                    action: "closed",
                    context: {
                        name: current.name,
                        completed_points: completedPoints,
                        rolled_over: rolledOver,
                        rolled_to: next?.id ?? null,
                    },
                },
                tx,
            );

            return { rolled_over: rolledOver };
        });
    }

    /**
     * #10 — delete a sprint (F28 / ISS-013, decision D12.6).
     *
     * There was no way to remove a sprint at all: one created with wrong dates
     * or a typo'd name was permanent, and cleaning it up meant direct SQL.
     *
     * **An ACTIVE sprint is refused** (`409 sprint.active_immutable`). Close it
     * or move it back to planned first. The cleanup story the issue is about —
     * a mistake noticed shortly after creation — is a planned sprint, so it is
     * unaffected; what the guard prevents is one click silently un-sprinting
     * every task in a sprint the team is currently working. Same spirit as the
     * `space.archived` / `task.archived` guards F22 made real.
     *
     * Tasks are **detached, never deleted** — `tasks.sprint_id` is
     * `ON DELETE SET NULL` in the schema. The count of tasks that will come
     * loose is returned so the caller can say so.
     *
     * Serialised on the workspace lock like start/close, so a delete cannot
     * interleave with a status transition and remove a sprint that just became
     * active.
     */
    async remove(input: SprintActionInput): Promise<{ detached: number }> {
        const { id, workspaceId, actorId } = input;

        return this.db.transaction(async (tx) => {
            await this.sprints.lockWorkspace(workspaceId, tx);
            const current = await this.sprints.lockByIdInWorkspace(
                id,
                workspaceId,
                tx,
            );
            if (!current) {
                throw AppError.notFound(
                    "sprint.not_found",
                    `Sprint ${id} does not exist`,
                );
            }
            if (current.status === "active") {
                throw AppError.conflict(
                    "sprint.active_immutable",
                    "An active sprint cannot be deleted — close it first",
                );
            }

            const detached = await this.sprints.countTasksInSprint(
                id,
                workspaceId,
                tx,
            );
            await this.sprints.deleteById(id, workspaceId, tx);

            // Recorded on the WORKSPACE feed, not the task feed: the sprint row
            // is gone, so a per-task activity row would point at nothing.
            await this.wsActivity.record(
                {
                    workspaceId,
                    actorId,
                    entityType: "sprint",
                    entityId: id,
                    action: "deleted",
                    context: {
                        name: current.name,
                        status: current.status,
                        detached_tasks: detached,
                    },
                },
                tx,
            );

            return { detached };
        });
    }

    /**
     * #8 — bulk-attach LIVE tasks to a sprint (sets `tasks.sprint_id`). All ids
     * must be real, non-archived tasks in the workspace, else the whole batch is
     * rejected with `404 task.not_found`. Tasks cannot be added to a CLOSED sprint
     * (`409 sprint.invalid_status`). Only tasks not already in THIS sprint actually
     * change (the audit reflects real moves); an all-no-op call is idempotent 204.
     *
     * The sprint row is locked `FOR UPDATE` and ALL validation runs inside the
     * transaction, so the add serialises against `close()` (which holds the same
     * row lock): a concurrent close either snapshots these tasks for rollover, or
     * this add observes the closed sprint and is rejected — the unfinished task can
     * never be orphaned in a just-closed sprint.
     */
    async addTasks(input: AddSprintTasksInput): Promise<void> {
        const { id, workspaceId, actorId } = input;
        const taskIds = [...new Set(input.taskIds)];

        await this.db.transaction(async (tx) => {
            const sprint = await this.sprints.lockByIdInWorkspace(
                id,
                workspaceId,
                tx,
            );
            if (!sprint) {
                throw AppError.notFound(
                    "sprint.not_found",
                    `Sprint ${id} does not exist`,
                );
            }
            if (sprint.status === "closed") {
                throw AppError.conflict(
                    "sprint.invalid_status",
                    "Tasks cannot be added to a closed sprint",
                );
            }

            const found = await this.sprints.findTasksByIdsInWorkspace(
                taskIds,
                workspaceId,
                tx,
            );
            if (found.length !== taskIds.length) {
                const foundIds = new Set(found.map((t) => t.id));
                const missing = taskIds.filter((tid) => !foundIds.has(tid));
                throw AppError.notFound(
                    "task.not_found",
                    `Task(s) not found in this workspace: ${missing.join(", ")}`,
                );
            }

            const changing = found.filter((t) => t.sprintId !== id);
            if (changing.length === 0) return; // already all in this sprint — no-op

            await this.sprints.setSprintForTasks(
                changing.map((t) => t.id),
                id,
                workspaceId,
                tx,
            );
            await this.taskActivity.recordMany(
                changing.map((t) => ({
                    taskId: t.id,
                    actorId,
                    action: "sprint_added",
                    context: { sprint_id: id, from_sprint_id: t.sprintId },
                })),
                tx,
            );
            await this.wsActivity.record(
                {
                    workspaceId,
                    actorId,
                    entityType: "sprint",
                    entityId: id,
                    action: "tasks_added",
                    context: {
                        task_ids: changing.map((t) => t.id),
                        count: changing.length,
                    },
                },
                tx,
            );
        });
    }

    /**
     * #9 — detach one task from a sprint (clears `tasks.sprint_id`). 404 if the
     * sprint or task is missing/cross-tenant, or if the task is not in THIS
     * sprint (`sprint.task_not_in_sprint`). Detaching is allowed regardless of the
     * sprint's status (so a task archived after being added can still be cleaned
     * up). The sprint row is locked and validation runs inside the transaction so
     * the detach is atomic and serialises with `close()`.
     */
    async removeTask(input: RemoveSprintTaskInput): Promise<void> {
        const { id, workspaceId, actorId, taskId } = input;

        await this.db.transaction(async (tx) => {
            const sprint = await this.sprints.lockByIdInWorkspace(
                id,
                workspaceId,
                tx,
            );
            if (!sprint) {
                throw AppError.notFound(
                    "sprint.not_found",
                    `Sprint ${id} does not exist`,
                );
            }
            const task = await this.sprints.findTaskByIdInWorkspace(
                taskId,
                workspaceId,
                tx,
            );
            if (!task) {
                throw AppError.notFound(
                    "task.not_found",
                    `Task ${taskId} does not exist`,
                );
            }
            if (task.sprintId !== id) {
                throw AppError.notFound(
                    "sprint.task_not_in_sprint",
                    `Task ${taskId} is not in sprint ${id}`,
                );
            }

            const affected = await this.sprints.setSprintForTasks(
                [taskId],
                null,
                workspaceId,
                tx,
            );
            if (affected === 0) return; // concurrent removal won — no double audit
            await this.taskActivity.recordMany(
                [
                    {
                        taskId,
                        actorId,
                        action: "sprint_removed",
                        context: { sprint_id: id },
                    },
                ],
                tx,
            );
            await this.wsActivity.record(
                {
                    workspaceId,
                    actorId,
                    entityType: "sprint",
                    entityId: id,
                    action: "task_removed",
                    context: { task_id: taskId },
                },
                tx,
            );
        });
    }

    /**
     * Reject an out-of-order date pair with `422 validation.failed`. Wire dates
     * are `YYYY-MM-DD`, so a lexicographic compare is a correct chronological
     * compare. The DB `ck_sprints_dates` CHECK is the race-safe backstop.
     */
    private assertDateOrder(start: string, end: string): void {
        if (start > end) {
            throw AppError.validationFailed([
                {
                    field: "end_date",
                    issue: "end_date must be on or after start_date",
                },
            ]);
        }
    }
}
