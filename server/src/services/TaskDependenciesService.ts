import { MySql2Database } from "drizzle-orm/mysql2";
import type { Logger } from "winston";
import * as schema from "../db/schema";
import { AppError } from "../errors";
import { assertTaskScoped } from "../rbac/scopeGuard";
import {
    TaskDependenciesRepo,
    type DependencyEdge,
} from "../repositories/TaskDependenciesRepo";
import { TasksRepo } from "../repositories/TasksRepo";
import { TaskActivityRepo } from "../repositories/TaskActivityRepo";
import { toWireTask, type WireTask } from "../serializers/taskSerializer";
import type { DbExecutor } from "../repositories/types";

/**
 * §12 Task dependencies domain logic. Owns the directed "blocks" graph: the
 * two-direction read (with the other-end `Task` hydrated like §10's list does),
 * the create flow (workspace + self + cycle + duplicate guards, paired with a
 * `task_activity` row on BOTH endpoints in one transaction), and delete.
 *
 * Hydration reuses `TasksRepo`'s batched map helpers + the shared `toWireTask`
 * serializer, so §12 never edits the heavily-shared tasks files.
 */

/** Wire `TaskDependency` (API_DESIGN.md Appendix A): the OTHER end, hydrated. */
export interface WireDependency {
    id: string;
    task: WireTask;
    type: "blocks" | "blocked_by";
    created_at: string;
}

export interface DependenciesView {
    blocks: WireDependency[];
    blocked_by: WireDependency[];
}

export interface GetDependenciesInput {
    taskId: string;
    workspaceId: string;
    role: string;
}

export interface CreateDependencyInput {
    taskId: string;
    relatedTaskId: string;
    actorId: string;
    workspaceId: string;
    role: string;
}

export interface DeleteDependencyInput {
    depId: string;
    workspaceId: string;
    actorId: string;
}

/** mysql2 surfaces a unique-violation as `ER_DUP_ENTRY` / errno 1062. */
const isDuplicateKeyError = (err: unknown): boolean => {
    const e = err as { code?: string; errno?: number } | null;
    return e?.code === "ER_DUP_ENTRY" || e?.errno === 1062;
};

/**
 * mysql2 surfaces a missing FK parent (the referenced task was deleted) as
 * `ER_NO_REFERENCED_ROW_2` / errno 1452 — the race-safe backstop behind the
 * pre-insert existence checks when an endpoint task is hard-deleted concurrently.
 */
const isMissingReferencedRowError = (err: unknown): boolean => {
    const e = err as { code?: string; errno?: number } | null;
    return e?.code === "ER_NO_REFERENCED_ROW_2" || e?.errno === 1452;
};

export class TaskDependenciesService {
    constructor(
        private db: MySql2Database<typeof schema>,
        private deps: TaskDependenciesRepo,
        private tasks: TasksRepo,
        private activity: TaskActivityRepo,
        private logger: Logger,
    ) {}

    /**
     * Both directions of a task's dependency graph, each with the OTHER end fully
     * hydrated. `blocks` = edges where this task is the blocker (other end =
     * `related_task_id`); `blocked_by` = the computed reverse (edges where this
     * task is blocked, other end = `task_id`). The `:id` task is resolved in the
     * caller's workspace first (`404 task.not_found`, no cross-tenant oracle).
     */
    async getForTask(input: GetDependenciesInput): Promise<DependenciesView> {
        const task = await this.tasks.findByIdInWorkspace(
            input.taskId,
            input.workspaceId,
        );
        if (!task) {
            throw AppError.notFound(
                "task.not_found",
                `Task ${input.taskId} does not exist`,
            );
        }

        const [blocksEdges, blockedByEdges] = await Promise.all([
            this.deps.findBlocks(input.taskId),
            this.deps.findBlockedBy(input.taskId),
        ]);

        // Other-end ids: blocks → related_task_id; blocked_by → task_id.
        const otherIds = [
            ...new Set([
                ...blocksEdges.map((e) => e.relatedTaskId),
                ...blockedByEdges.map((e) => e.taskId),
            ]),
        ];
        const taskMap = await this.hydrateTaskMap(
            otherIds,
            input.workspaceId,
            input.role === "guest",
        );

        return {
            blocks: this.toViews(blocksEdges, (e) => e.relatedTaskId, "blocks", taskMap),
            blocked_by: this.toViews(
                blockedByEdges,
                (e) => e.taskId,
                "blocked_by",
                taskMap,
            ),
        };
    }

    /**
     * Add a "blocks" edge `task_id → related_task_id`. Guards, in order:
     *   - `422 dep.self` — a task cannot depend on itself (the DB trigger
     *     `trg_task_dependencies_no_self_*` is the backstop).
     *   - `404 task.not_found` — either endpoint is missing or in another
     *     workspace (no cross-tenant oracle).
     *   - `422 dep.cycle` — adding the edge would close a directed cycle, i.e.
     *     `related_task_id` can already reach `task_id` by following stored
     *     "blocks" edges. Detected by a BFS read INSIDE the create transaction
     *     (consistent snapshot).
     *   - `409 dep.duplicate` — the exact edge already exists
     *     (`uq_task_dependencies`); the insert is the race-safe arbiter.
     *
     * The insert + a `task_activity` row on BOTH endpoints (the blocker sees
     * `blocks`, the blocked sees `blocked_by`) are one transaction. Returns the
     * created edge as a wire `TaskDependency` (other end = `related_task_id`,
     * `type: "blocks"`).
     *
     * Concurrency note: the existence checks run before the tx and the cycle BFS
     * reads a tx snapshot — two edges added at the exact same instant could each
     * miss the other and theoretically close a cycle. The graph is small and this
     * race is vanishingly rare; full prevention would need a workspace-wide lock.
     */
    async create(input: CreateDependencyInput): Promise<WireDependency> {
        const { taskId, relatedTaskId, actorId, workspaceId, role } = input;

        if (taskId === relatedTaskId) {
            throw AppError.unprocessable(
                "dep.self",
                "A task cannot depend on itself",
            );
        }

        const [blocker, blocked] = await Promise.all([
            this.tasks.findByIdInWorkspace(taskId, workspaceId),
            this.tasks.findByIdInWorkspace(relatedTaskId, workspaceId),
        ]);
        if (!blocker) {
            throw AppError.notFound(
                "task.not_found",
                `Task ${taskId} does not exist`,
            );
        }
        if (!blocked) {
            throw AppError.notFound(
                "task.not_found",
                `Task ${relatedTaskId} does not exist`,
            );
        }

        // F22 (ISS-051, P18 update): an ARCHIVED endpoint refuses new edges —
        // the same guard every other task write already has.
        for (const t of [blocker, blocked]) {
            if (t.archivedAt) {
                throw AppError.conflict(
                    "task.archived",
                    `Task ${t.id} is archived — unarchive it to link dependencies`,
                );
            }
        }

        // Team-access P7: linking dependencies edits the PRIMARY task's
        // content — `task.edit` reach on it (assignee / creator / head). The
        // other endpoint only needs to be visible, which its scoped resolve
        // above already proved.
        await assertTaskScoped("task.edit", blocker, this.tasks);

        const edge = await this.db.transaction(async (tx) => {
            await this.assertNoCycle(taskId, relatedTaskId, tx);

            let created: DependencyEdge;
            try {
                created = await this.deps.insert(
                    { taskId, relatedTaskId, createdBy: actorId },
                    tx,
                );
            } catch (err) {
                if (isDuplicateKeyError(err)) {
                    throw AppError.conflict(
                        "dep.duplicate",
                        "This dependency already exists",
                    );
                }
                if (isMissingReferencedRowError(err)) {
                    // An endpoint task was hard-deleted between the pre-insert
                    // existence check and this insert — surface the FK race as
                    // 404, not a raw 500 (the race-safe backstop behind the check).
                    throw AppError.notFound(
                        "task.not_found",
                        "A referenced task no longer exists",
                    );
                }
                throw err;
            }

            await this.activity.recordMany(
                [
                    {
                        taskId,
                        actorId,
                        action: "dependency_added",
                        context: { dependency_id: created.id, blocks: relatedTaskId },
                    },
                    {
                        taskId: relatedTaskId,
                        actorId,
                        action: "dependency_added",
                        context: { dependency_id: created.id, blocked_by: taskId },
                    },
                ],
                tx,
            );
            return created;
        });

        const taskMap = await this.hydrateTaskMap(
            [relatedTaskId],
            workspaceId,
            role === "guest",
        );
        const view = this.toView(edge, relatedTaskId, "blocks", taskMap);
        if (!view) {
            // Unreachable: the related task was just validated in-workspace.
            throw AppError.internal();
        }
        return view;
    }

    /**
     * Remove a dependency edge. Resolved within the caller's workspace via its
     * `task_id` task (`404 dep.not_found` for missing / cross-tenant). The delete
     * + a `task_activity` row on BOTH endpoints run in one transaction. A
     * concurrent delete that already removed the row is a `204` no-op (the
     * `affectedRows === 0` path writes no activity).
     */
    async delete(input: DeleteDependencyInput): Promise<void> {
        const { depId, workspaceId, actorId } = input;

        const edge = await this.deps.findByIdInWorkspace(depId, workspaceId);
        if (!edge) {
            throw AppError.notFound(
                "dep.not_found",
                `Dependency ${depId} does not exist`,
            );
        }

        // F9 (ISS-053): unlinking is a statement about BOTH endpoints. The
        // create path already refuses an invisible endpoint (404); the delete
        // path did not, so a space-scoped user could sever an edge into a
        // space they cannot see. Resolve both ends through the same
        // visibility-filtered read the hydration uses — fewer than two rows
        // means one end is invisible, and the edge "does not exist" for this
        // caller (D-9: deny reads by 404, no existence oracle).
        const visibleEnds = await this.deps.findTaskRowsByIds(
            [edge.taskId, edge.relatedTaskId],
            workspaceId,
        );
        if (visibleEnds.length < 2) {
            throw AppError.notFound(
                "dep.not_found",
                `Dependency ${depId} does not exist`,
            );
        }

        // Team-access P7: unlinking edits the PRIMARY task's content —
        // `task.edit` reach on it (assignee / creator / head).
        const primary = visibleEnds.find((t) => t.id === edge.taskId);
        if (primary) {
            await assertTaskScoped("task.edit", primary, this.tasks);
        }

        await this.db.transaction(async (tx) => {
            const removed = await this.deps.deleteById(depId, tx);
            if (removed === 0) return; // concurrent delete won — no double audit
            await this.activity.recordMany(
                [
                    {
                        taskId: edge.taskId,
                        actorId,
                        action: "dependency_removed",
                        context: {
                            dependency_id: edge.id,
                            blocks: edge.relatedTaskId,
                        },
                    },
                    {
                        taskId: edge.relatedTaskId,
                        actorId,
                        action: "dependency_removed",
                        context: {
                            dependency_id: edge.id,
                            blocked_by: edge.taskId,
                        },
                    },
                ],
                tx,
            );
        });
    }

    /**
     * Throw `422 dep.cycle` if adding `fromTaskId → toTaskId` would close a
     * directed cycle — i.e. `toTaskId` can already reach `fromTaskId` by following
     * stored "blocks" edges. Level-order BFS from `toTaskId`, one batched
     * `outNeighbors` query per level, a `visited` set to terminate on any
     * pre-existing structure. Reads via `exec` (the create tx) for a consistent
     * snapshot.
     */
    private async assertNoCycle(
        fromTaskId: string,
        toTaskId: string,
        exec: DbExecutor,
    ): Promise<void> {
        const visited = new Set<string>([toTaskId]);
        let frontier = [toTaskId];
        while (frontier.length > 0) {
            const neighbors = await this.deps.outNeighbors(frontier, exec);
            const next: string[] = [];
            for (const outs of neighbors.values()) {
                for (const n of outs) {
                    if (n === fromTaskId) {
                        throw AppError.unprocessable(
                            "dep.cycle",
                            "This dependency would create a cycle",
                        );
                    }
                    if (!visited.has(n)) {
                        visited.add(n);
                        next.push(n);
                    }
                }
            }
            frontier = next;
        }
    }

    /**
     * Fetch + batch-hydrate the given task ids (scoped to the workspace) into
     * wire `Task`s, reusing `TasksRepo`'s map helpers (no N+1). `redactGuest`
     * omits guest-hidden custom fields, matching §10's list/get behaviour.
     */
    private async hydrateTaskMap(
        ids: string[],
        workspaceId: string,
        redactGuest: boolean,
    ): Promise<Map<string, WireTask>> {
        const map = new Map<string, WireTask>();
        if (ids.length === 0) return map;

        const rows = await this.deps.findTaskRowsByIds(ids, workspaceId);
        const presentIds = rows.map((r) => r.id);
        const [assignees, watchers, tags, cfv] = await Promise.all([
            this.tasks.assigneesByTask(presentIds),
            this.tasks.watchersByTask(presentIds),
            this.tasks.tagsByTask(presentIds),
            this.tasks.customFieldValuesByTask(presentIds, redactGuest),
        ]);

        for (const row of rows) {
            map.set(
                row.id,
                toWireTask(row, {
                    assignees: assignees.get(row.id) ?? [],
                    watchers: watchers.get(row.id) ?? [],
                    tags: tags.get(row.id) ?? [],
                    customFieldValues: cfv.get(row.id) ?? {},
                }),
            );
        }
        return map;
    }

    private toViews(
        edges: DependencyEdge[],
        otherId: (e: DependencyEdge) => string,
        type: "blocks" | "blocked_by",
        taskMap: Map<string, WireTask>,
    ): WireDependency[] {
        const views: WireDependency[] = [];
        for (const e of edges) {
            const view = this.toView(e, otherId(e), type, taskMap);
            if (view) views.push(view);
        }
        return views;
    }

    private toView(
        edge: DependencyEdge,
        otherId: string,
        type: "blocks" | "blocked_by",
        taskMap: Map<string, WireTask>,
    ): WireDependency | null {
        const task = taskMap.get(otherId);
        // Defensive: a cross-workspace other end (impossible by construction —
        // both ends are validated in-workspace at create time) is dropped rather
        // than emitted with a missing `task`.
        if (!task) return null;
        return {
            id: edge.id,
            task,
            type,
            created_at: edge.createdAt.toISOString(),
        };
    }
}
