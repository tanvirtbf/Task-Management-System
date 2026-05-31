import {
    and,
    asc,
    desc,
    eq,
    inArray,
    isNull,
    ne,
    notInArray,
} from "drizzle-orm";
import { MySql2Database } from "drizzle-orm/mysql2";
import * as schema from "../db/schema";
import { sprints, statuses, tasks, workspaces } from "../db/schema";
import type { Sprint } from "../db/schema";
import { sprintStatuses } from "../db/schema/_shared";
import { fakeId } from "../utils";
import type { DbExecutor } from "./types";

/**
 * Data access for §20 `sprints` plus the sprint-side reads/writes on `tasks`
 * (the `tasks.sprint_id` link). Kept here — operating on the `tasks` table
 * directly — so §20 never edits the heavily-shared `TasksRepo` (same
 * self-containment precedent as §12 `TaskDependenciesRepo`).
 *
 * "Completed points" is NOT a stored column: it is summed at read time from the
 * story points of the sprint's tasks whose status sits in the done/closed
 * `status_group`. The rollover + completed-points queries also exclude
 * soft-deleted tasks (`archived_at IS NULL`), fully mirroring the `v_open_tasks`
 * classification — an archived task neither rolls over nor counts on close.
 */

export type SprintStatus = (typeof sprintStatuses)[number];

/** Status groups that count a task as finished (for completed-points + rollover). */
const DONE_GROUPS = ["done", "closed"] as const;

export interface InsertSprintInput {
    workspaceId: string;
    name: string;
    goal: string | null;
    startDate: Date;
    endDate: Date;
    committedPoints: number;
    status?: SprintStatus;
}

export interface SprintUpdateFields {
    name?: string;
    goal?: string | null;
    startDate?: Date;
    endDate?: Date;
    committedPoints?: number;
}

/** Minimal task projection §20 needs for add/remove/rollover. */
export interface SprintTaskRef {
    id: string;
    sprintId: string | null;
}

export class SprintsRepo {
    constructor(private db: MySql2Database<typeof schema>) {}

    // ─── sprints ──────────────────────────────────────────────────────────────

    /**
     * All sprints in a workspace, newest first (`start_date` DESC, `id` DESC for a
     * stable tie-break). The optional `status` filter is served by
     * `idx_sprints_workspace_status (workspace_id, status, start_date)`.
     */
    async listByWorkspace(
        workspaceId: string,
        status?: SprintStatus,
        exec: DbExecutor = this.db,
    ): Promise<Sprint[]> {
        return exec
            .select()
            .from(sprints)
            .where(
                and(
                    eq(sprints.workspaceId, workspaceId),
                    status ? eq(sprints.status, status) : undefined,
                ),
            )
            .orderBy(desc(sprints.startDate), desc(sprints.id));
    }

    /** Resolve one sprint within a workspace (the isolation gate). */
    async findByIdInWorkspace(
        id: string,
        workspaceId: string,
        exec: DbExecutor = this.db,
    ): Promise<Sprint | null> {
        const [row] = await exec
            .select()
            .from(sprints)
            .where(and(eq(sprints.id, id), eq(sprints.workspaceId, workspaceId)))
            .limit(1);
        return row ?? null;
    }

    /** The single active sprint of a workspace, if any (mirrors `v_active_sprint`). */
    async findActive(
        workspaceId: string,
        exec: DbExecutor = this.db,
    ): Promise<Sprint | null> {
        const [row] = await exec
            .select()
            .from(sprints)
            .where(
                and(
                    eq(sprints.workspaceId, workspaceId),
                    eq(sprints.status, "active"),
                ),
            )
            .limit(1);
        return row ?? null;
    }

    /** Any OTHER active sprint in the workspace — the single-active guard for start. */
    async findOtherActive(
        workspaceId: string,
        exceptId: string,
        exec: DbExecutor = this.db,
    ): Promise<Sprint | null> {
        const [row] = await exec
            .select()
            .from(sprints)
            .where(
                and(
                    eq(sprints.workspaceId, workspaceId),
                    eq(sprints.status, "active"),
                    ne(sprints.id, exceptId),
                ),
            )
            .limit(1);
        return row ?? null;
    }

    /**
     * The next planned sprint to roll unfinished tasks into on close — the earliest
     * by `start_date` (then `id`), excluding the sprint being closed.
     */
    async findNextPlanned(
        workspaceId: string,
        exceptId: string,
        exec: DbExecutor = this.db,
    ): Promise<Sprint | null> {
        const [row] = await exec
            .select()
            .from(sprints)
            .where(
                and(
                    eq(sprints.workspaceId, workspaceId),
                    eq(sprints.status, "planned"),
                    ne(sprints.id, exceptId),
                ),
            )
            .orderBy(asc(sprints.startDate), asc(sprints.id))
            .limit(1);
        return row ?? null;
    }

    /** Lock a sprint row `FOR UPDATE` (in the caller's workspace) — null if absent. */
    async lockByIdInWorkspace(
        id: string,
        workspaceId: string,
        exec: DbExecutor,
    ): Promise<Sprint | null> {
        const [row] = await exec
            .select()
            .from(sprints)
            .where(and(eq(sprints.id, id), eq(sprints.workspaceId, workspaceId)))
            .limit(1)
            .for("update");
        return row ?? null;
    }

    /**
     * Lock the workspace row `FOR UPDATE` to serialise sprint state transitions
     * (start / close) per workspace, making the "exactly one active sprint"
     * invariant race-free without a dedicated unique constraint.
     */
    async lockWorkspace(workspaceId: string, exec: DbExecutor): Promise<void> {
        await exec
            .select({ id: workspaces.id })
            .from(workspaces)
            .where(eq(workspaces.id, workspaceId))
            .limit(1)
            .for("update");
    }

    /** Insert a sprint and re-read it for the authoritative DB row. */
    async insert(
        input: InsertSprintInput,
        exec: DbExecutor = this.db,
    ): Promise<Sprint> {
        const id = fakeId("spr");
        await exec.insert(sprints).values({
            id,
            workspaceId: input.workspaceId,
            name: input.name,
            goal: input.goal,
            startDate: input.startDate,
            endDate: input.endDate,
            status: input.status ?? "planned",
            committedPoints: input.committedPoints,
        });
        const [row] = await exec
            .select()
            .from(sprints)
            .where(eq(sprints.id, id))
            .limit(1);
        if (!row) {
            // Unreachable: the row was just inserted under this id.
            throw new Error(`sprint ${id} missing after insert`);
        }
        return row;
    }

    /** Apply a partial field update (workspace-scoped); returns affected rows. */
    async updateFields(
        id: string,
        workspaceId: string,
        fields: SprintUpdateFields,
        exec: DbExecutor = this.db,
    ): Promise<number> {
        const [res] = await exec
            .update(sprints)
            .set(fields)
            .where(and(eq(sprints.id, id), eq(sprints.workspaceId, workspaceId)));
        return res.affectedRows;
    }

    /** Transition a sprint's status (workspace-scoped). */
    async setStatus(
        id: string,
        workspaceId: string,
        status: SprintStatus,
        exec: DbExecutor = this.db,
    ): Promise<void> {
        await exec
            .update(sprints)
            .set({ status })
            .where(and(eq(sprints.id, id), eq(sprints.workspaceId, workspaceId)));
    }

    // ─── tasks (sprint link) ────────────────────────────────────────────────────

    /**
     * Resolve a set of LIVE task ids within the workspace (id + current sprint
     * link). Soft-deleted tasks (`archived_at` set) are excluded, so an archived
     * task cannot be attached to a sprint (addTasks treats it as not found).
     */
    async findTasksByIdsInWorkspace(
        ids: string[],
        workspaceId: string,
        exec: DbExecutor = this.db,
    ): Promise<SprintTaskRef[]> {
        if (ids.length === 0) return [];
        return exec
            .select({ id: tasks.id, sprintId: tasks.sprintId })
            .from(tasks)
            .where(
                and(
                    inArray(tasks.id, ids),
                    eq(tasks.workspaceId, workspaceId),
                    isNull(tasks.archivedAt),
                ),
            );
    }

    /**
     * Resolve one task within the workspace (id + current sprint link). Includes
     * archived tasks on purpose: removeTask must be able to detach a task that was
     * soft-deleted AFTER it was added to the sprint (cleanup).
     */
    async findTaskByIdInWorkspace(
        taskId: string,
        workspaceId: string,
        exec: DbExecutor = this.db,
    ): Promise<SprintTaskRef | null> {
        const [row] = await exec
            .select({ id: tasks.id, sprintId: tasks.sprintId })
            .from(tasks)
            .where(and(eq(tasks.id, taskId), eq(tasks.workspaceId, workspaceId)))
            .limit(1);
        return row ?? null;
    }

    /** Point a set of tasks at a sprint (or detach with `null`); returns affected rows. */
    async setSprintForTasks(
        taskIds: string[],
        sprintId: string | null,
        workspaceId: string,
        exec: DbExecutor = this.db,
    ): Promise<number> {
        if (taskIds.length === 0) return 0;
        const [res] = await exec
            .update(tasks)
            .set({ sprintId })
            .where(
                and(
                    inArray(tasks.id, taskIds),
                    eq(tasks.workspaceId, workspaceId),
                ),
            );
        return res.affectedRows;
    }

    /**
     * Ids of a sprint's UNFINISHED tasks — those whose status's `status_group` is
     * NOT in (`done`, `closed`). These are the candidates rolled into the next
     * planned sprint on close.
     */
    async findUnfinishedTaskIdsInSprint(
        sprintId: string,
        workspaceId: string,
        exec: DbExecutor = this.db,
    ): Promise<string[]> {
        const rows = await exec
            .select({ id: tasks.id })
            .from(tasks)
            .innerJoin(statuses, eq(tasks.statusId, statuses.id))
            .where(
                and(
                    eq(tasks.sprintId, sprintId),
                    eq(tasks.workspaceId, workspaceId),
                    isNull(tasks.archivedAt),
                    notInArray(statuses.statusGroup, [...DONE_GROUPS]),
                ),
            );
        return rows.map((r) => r.id);
    }

    /**
     * Sum of story points of a sprint's COMPLETED tasks (status_group in done /
     * closed) — the snapshot recorded into the audit feed on close. Summed in JS
     * (the per-sprint task set is small) so a NULL `story_points` counts as 0.
     */
    async sumCompletedPoints(
        sprintId: string,
        workspaceId: string,
        exec: DbExecutor = this.db,
    ): Promise<number> {
        const rows = await exec
            .select({ storyPoints: tasks.storyPoints })
            .from(tasks)
            .innerJoin(statuses, eq(tasks.statusId, statuses.id))
            .where(
                and(
                    eq(tasks.sprintId, sprintId),
                    eq(tasks.workspaceId, workspaceId),
                    isNull(tasks.archivedAt),
                    inArray(statuses.statusGroup, [...DONE_GROUPS]),
                ),
            );
        return rows.reduce((sum, r) => sum + (r.storyPoints ?? 0), 0);
    }
}
