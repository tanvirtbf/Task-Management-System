import { and, asc, eq, inArray } from "drizzle-orm";
import { MySql2Database } from "../db/client";
import * as schema from "../db/schema";
import { taskDependencies, tasks } from "../db/schema";
import type { Task as TaskRow } from "../db/schema";
import { fakeId } from "../utils";
import type { DbExecutor } from "./types";

/**
 * Data access for §12 `task_dependencies` (the directed "blocks" edge graph).
 * An edge `(task_id = X, related_task_id = Y)` means **X blocks Y**; the reverse
 * relation "Y is blocked_by X" is the computed inverse — V1 stores only
 * `dep_type = 'blocks'` (the enum has no other value). The hydration of the
 * "other end" `Task` reuses `TasksRepo`'s batched map helpers; this repo owns
 * only the edge queries plus a workspace-scoped task-row fetch for that hydration
 * (so §12 never edits the heavily-shared `TasksRepo`).
 */

/** One edge row, projected to the columns §12 needs (never `created_by`). */
export interface DependencyEdge {
    id: string;
    taskId: string;
    relatedTaskId: string;
    createdAt: Date;
}

const EDGE_COLUMNS = {
    id: taskDependencies.id,
    taskId: taskDependencies.taskId,
    relatedTaskId: taskDependencies.relatedTaskId,
    createdAt: taskDependencies.createdAt,
} as const;

export class TaskDependenciesRepo {
    constructor(private db: MySql2Database<typeof schema>) {}

    /**
     * Outgoing edges — rows where this task is the blocker (`task_id = taskId`),
     * so the other end (`related_task_id`) is a task THIS task blocks. Ordered by
     * `created_at` then `id` for a stable, deterministic sequence. Backed by the
     * PK / `uq_task_dependencies (task_id, …)` prefix.
     */
    async findBlocks(taskId: string): Promise<DependencyEdge[]> {
        return this.db
            .select(EDGE_COLUMNS)
            .from(taskDependencies)
            .where(eq(taskDependencies.taskId, taskId))
            .orderBy(asc(taskDependencies.createdAt), asc(taskDependencies.id));
    }

    /**
     * Incoming edges — rows where this task is blocked (`related_task_id =
     * taskId`), so the other end (`task_id`) is a task that blocks THIS one
     * (surfaced as `type: "blocked_by"`). Backed by `idx_task_dependencies_related
     * (related_task_id)`.
     */
    async findBlockedBy(taskId: string): Promise<DependencyEdge[]> {
        return this.db
            .select(EDGE_COLUMNS)
            .from(taskDependencies)
            .where(eq(taskDependencies.relatedTaskId, taskId))
            .orderBy(asc(taskDependencies.createdAt), asc(taskDependencies.id));
    }

    /**
     * Full task rows for a set of ids, scoped to the caller's workspace — the
     * "other end" rows the GET response hydrates into wire `Task`s. Lives here
     * (rather than on `TasksRepo`) so §12 needs no edit to that shared file;
     * returns `select()` (all columns) so the rows feed `toWireTask` directly.
     * A cross-workspace id simply does not match (defense-in-depth — created
     * edges are intra-workspace).
     */
    async findTaskRowsByIds(
        ids: string[],
        workspaceId: string,
    ): Promise<TaskRow[]> {
        if (ids.length === 0) return [];
        return this.db
            .select()
            .from(tasks)
            .where(
                and(inArray(tasks.id, ids), eq(tasks.workspaceId, workspaceId)),
            );
    }

    /**
     * Out-neighbours of a frontier for cycle detection: the `related_task_id`s of
     * every "blocks" edge whose `task_id` is in `taskIds`, grouped by source.
     * One batched query per BFS level (no per-node round-trips). Backed by the
     * `uq_task_dependencies (task_id, …)` prefix.
     */
    async outNeighbors(
        taskIds: string[],
        exec: DbExecutor = this.db,
    ): Promise<Map<string, string[]>> {
        const map = new Map<string, string[]>();
        if (taskIds.length === 0) return map;
        const rows = await exec
            .select({
                taskId: taskDependencies.taskId,
                relatedTaskId: taskDependencies.relatedTaskId,
            })
            .from(taskDependencies)
            .where(inArray(taskDependencies.taskId, taskIds));
        for (const r of rows) {
            const bag = map.get(r.taskId) ?? [];
            bag.push(r.relatedTaskId);
            map.set(r.taskId, bag);
        }
        return map;
    }

    /**
     * Insert a "blocks" edge and return it in the projected shape (re-read for the
     * authoritative DB `created_at`). A duplicate `(task_id, related_task_id,
     * 'blocks')` trips `uq_task_dependencies` → mysql2 `ER_DUP_ENTRY`, which the
     * service maps to `409 dep.duplicate`; a self-loop (`task_id =
     * related_task_id`) trips `trg_task_dependencies_no_self_insert` (SQLSTATE
     * 45000) — but the service rejects that earlier with `422 dep.self`, so the
     * trigger is only a backstop. Pass `exec` to run inside the create tx.
     */
    async insert(
        input: { taskId: string; relatedTaskId: string; createdBy: string },
        exec: DbExecutor = this.db,
    ): Promise<DependencyEdge> {
        const id = fakeId("dep");
        await exec.insert(taskDependencies).values({
            id,
            taskId: input.taskId,
            relatedTaskId: input.relatedTaskId,
            depType: "blocks",
            createdBy: input.createdBy,
        });
        const [row] = await exec
            .select(EDGE_COLUMNS)
            .from(taskDependencies)
            .where(eq(taskDependencies.id, id))
            .limit(1);
        if (!row) {
            // Unreachable: the row was just inserted under this id.
            throw new Error(`task_dependency ${id} missing after insert`);
        }
        return row;
    }

    /**
     * Resolve an edge by id *within a workspace* — the isolation gate for DELETE.
     * An edge reaches a workspace through its `task_id` task (both endpoints are
     * intra-workspace by construction), so this joins `task_dependencies → tasks`
     * on `task_id` and filters `tasks.workspace_id`. Returns `null` when the id is
     * missing OR belongs to another workspace, so the caller renders both as `404
     * dep.not_found` (no cross-workspace existence oracle).
     */
    async findByIdInWorkspace(
        depId: string,
        workspaceId: string,
        exec: DbExecutor = this.db,
    ): Promise<DependencyEdge | null> {
        const [row] = await exec
            .select(EDGE_COLUMNS)
            .from(taskDependencies)
            .innerJoin(tasks, eq(taskDependencies.taskId, tasks.id))
            .where(
                and(
                    eq(taskDependencies.id, depId),
                    eq(tasks.workspaceId, workspaceId),
                ),
            )
            .limit(1);
        return row ?? null;
    }

    /** Delete an edge by primary key; returns the affected-row count. */
    async deleteById(
        depId: string,
        exec: DbExecutor = this.db,
    ): Promise<number> {
        const res = await exec
            .delete(taskDependencies)
            .where(eq(taskDependencies.id, depId));
        return res.rowsAffected;
    }
}
