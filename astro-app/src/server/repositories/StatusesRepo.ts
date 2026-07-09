import { and, asc, count, eq, max } from "drizzle-orm";
import { MySql2Database } from "../db/client";
import * as schema from "../db/schema";
import { lists, spaces, statuses, tasks, type Status } from "../db/schema";
import { fakeId } from "../utils";
import type { DbExecutor } from "./types";

/**
 * The default status workflow seeded into every new list by `POST /api/v1/lists`
 * (API_DESIGN.md §6: "Server seeds 5 default statuses"). The five names are
 * fixed by the spec; the `status_group` mapping and colours are chosen here so a
 * fresh list opens with a sensible Kanban flow:
 *   To Do → not_started, In Progress / In Review → active, Done → done,
 *   Closed → closed.
 * `position` is the array index, so the workflow renders left-to-right in this
 * order. Exported so tests assert against the single source of truth.
 */
export const DEFAULT_LIST_STATUSES: ReadonlyArray<{
    name: string;
    statusGroup: Status["statusGroup"];
    color: string;
}> = [
    { name: "To Do", statusGroup: "not_started", color: "#94A3B8" },
    { name: "In Progress", statusGroup: "active", color: "#3B82F6" },
    { name: "In Review", statusGroup: "active", color: "#A855F7" },
    { name: "Done", statusGroup: "done", color: "#22C55E" },
    { name: "Closed", statusGroup: "closed", color: "#64748B" },
];

/**
 * Data access for the `statuses` table. Returns exactly the columns the wire
 * `Status` shape (API_DESIGN.md Appendix A) needs — it omits `created_at` /
 * `updated_at`, which the contract does not expose.
 */

export interface StatusRecord {
    id: string;
    scopeType: Status["scopeType"];
    scopeId: string;
    name: string;
    color: string;
    statusGroup: Status["statusGroup"];
    position: number;
}

export class StatusesRepo {
    constructor(private db: MySql2Database<typeof schema>) {}

    /**
     * All statuses configured for a list, ordered by `position` with a stable
     * tie-break on `id` so the sequence is deterministic when two statuses
     * share a position. V1 statuses are always list-scoped, so the query is
     * pinned to `scope_type = 'list'`.
     *
     * The filter + sort are covered by `idx_statuses_scope (scope_type,
     * scope_id, position)`.
     */
    async listByList(
        listId: string,
        executor: DbExecutor = this.db,
    ): Promise<StatusRecord[]> {
        return executor
            .select({
                id: statuses.id,
                scopeType: statuses.scopeType,
                scopeId: statuses.scopeId,
                name: statuses.name,
                color: statuses.color,
                statusGroup: statuses.statusGroup,
                position: statuses.position,
            })
            .from(statuses)
            .where(
                and(
                    eq(statuses.scopeType, "list"),
                    eq(statuses.scopeId, listId),
                ),
            )
            .orderBy(asc(statuses.position), asc(statuses.id));
    }

    /**
     * The next free `position` for a list's statuses: one past the current
     * maximum, or `0` when the list has none yet. New statuses append to the end
     * of the workflow. The aggregate is served by `idx_statuses_scope
     * (scope_type, scope_id, position)`.
     */
    async nextPosition(
        listId: string,
        executor: DbExecutor = this.db,
    ): Promise<number> {
        const [row] = await executor
            .select({ max: max(statuses.position) })
            .from(statuses)
            .where(
                and(
                    eq(statuses.scopeType, "list"),
                    eq(statuses.scopeId, listId),
                ),
            );
        return row?.max == null ? 0 : row.max + 1;
    }

    /**
     * Insert a list-scoped status and return it in the wire projection. The
     * caller supplies a generated `id` and a resolved `position`; `scope_type`
     * is pinned to `'list'`, and `color` falls back to the column default
     * (`#94A3B8`) when omitted — so the row is re-selected to reflect exactly
     * what was persisted.
     *
     * A duplicate `name` within the list violates `uq_statuses_scope_name` and
     * surfaces as a mysql2 `ER_DUP_ENTRY` for the service to translate into a
     * `409 status.duplicate`.
     */
    async create(
        values: {
            id: string;
            scopeId: string;
            name: string;
            statusGroup: Status["statusGroup"];
            position: number;
            color?: string;
        },
        executor: DbExecutor = this.db,
    ): Promise<StatusRecord> {
        const insertValues: typeof statuses.$inferInsert = {
            id: values.id,
            scopeType: "list",
            scopeId: values.scopeId,
            name: values.name,
            statusGroup: values.statusGroup,
            position: values.position,
        };
        if (values.color !== undefined) insertValues.color = values.color;

        await executor.insert(statuses).values(insertValues);

        const [row] = await executor
            .select({
                id: statuses.id,
                scopeType: statuses.scopeType,
                scopeId: statuses.scopeId,
                name: statuses.name,
                color: statuses.color,
                statusGroup: statuses.statusGroup,
                position: statuses.position,
            })
            .from(statuses)
            .where(eq(statuses.id, values.id))
            .limit(1);

        if (!row) {
            // Unreachable: the row was just inserted under this id.
            throw new Error(
                `StatusesRepo.create: status ${values.id} not found after insert`,
            );
        }
        return row;
    }

    /**
     * Seed a brand-new list's default status workflow (`DEFAULT_LIST_STATUSES`)
     * in one multi-row insert. Always called inside the `POST /lists` create
     * transaction (pass `exec`) so the list and its statuses are atomic — a
     * failure rolls back both. The list is freshly created in the same tx, so
     * there is no pre-existing status to collide with `uq_statuses_scope_name`.
     */
    async seedDefaultsForList(
        listId: string,
        exec: DbExecutor = this.db,
    ): Promise<void> {
        await exec.insert(statuses).values(
            DEFAULT_LIST_STATUSES.map((s, i) => ({
                id: fakeId("st"),
                scopeType: "list" as const,
                scopeId: listId,
                name: s.name,
                color: s.color,
                statusGroup: s.statusGroup,
                position: i,
            })),
        );
    }

    /**
     * Resolve a status by id *within a workspace*. A status reaches a workspace
     * only through its list's space (`statuses.scope_id → lists.id →
     * lists.space_id → spaces.workspace_id`), so this joins that chain and
     * filters on `spaces.workspace_id`. V1 statuses are list-scoped, so the
     * query is pinned to `scope_type = 'list'`; a space-scoped row (never created
     * in V1) therefore resolves to `null`.
     *
     * Returns `null` when the id does not exist OR belongs to another workspace,
     * so callers render both as `404 status.not_found` — no cross-workspace
     * existence oracle. This is the isolation gate for the bare-id mutations
     * (`PATCH` / `DELETE /statuses/:id`), whose write is keyed on the PK alone.
     */
    async findByIdInWorkspace(
        statusId: string,
        workspaceId: string,
    ): Promise<StatusRecord | null> {
        const [row] = await this.db
            .select({
                id: statuses.id,
                scopeType: statuses.scopeType,
                scopeId: statuses.scopeId,
                name: statuses.name,
                color: statuses.color,
                statusGroup: statuses.statusGroup,
                position: statuses.position,
            })
            .from(statuses)
            .innerJoin(lists, eq(statuses.scopeId, lists.id))
            .innerJoin(spaces, eq(lists.spaceId, spaces.id))
            .where(
                and(
                    eq(statuses.id, statusId),
                    eq(statuses.scopeType, "list"),
                    eq(spaces.workspaceId, workspaceId),
                ),
            )
            .limit(1);
        return row ?? null;
    }

    /**
     * Apply a partial update (`name` / `color` / `status_group`) to a status and
     * return it in the wire projection. Only the supplied fields are written;
     * `updated_at` auto-bumps via the column's `ON UPDATE`. The row is
     * re-selected so the response reflects exactly what is persisted.
     *
     * Returns `null` when the row no longer exists — e.g. a concurrent delete
     * between the caller's isolation gate and this write — so the caller renders
     * `404 status.not_found` rather than a 500. A `name` collision with another
     * status in the same list violates `uq_statuses_scope_name` and surfaces as a
     * mysql2 `ER_DUP_ENTRY` for the service to translate into
     * `409 status.duplicate`.
     */
    async update(
        statusId: string,
        patch: {
            name?: string;
            color?: string;
            statusGroup?: Status["statusGroup"];
        },
        executor: DbExecutor = this.db,
    ): Promise<StatusRecord | null> {
        const setValues: Partial<typeof statuses.$inferInsert> = {};
        if (patch.name !== undefined) setValues.name = patch.name;
        if (patch.color !== undefined) setValues.color = patch.color;
        if (patch.statusGroup !== undefined)
            setValues.statusGroup = patch.statusGroup;

        await executor
            .update(statuses)
            .set(setValues)
            .where(eq(statuses.id, statusId));

        const [row] = await executor
            .select({
                id: statuses.id,
                scopeType: statuses.scopeType,
                scopeId: statuses.scopeId,
                name: statuses.name,
                color: statuses.color,
                statusGroup: statuses.statusGroup,
                position: statuses.position,
            })
            .from(statuses)
            .where(eq(statuses.id, statusId))
            .limit(1);
        return row ?? null;
    }

    /**
     * How many tasks currently point at this status (`tasks.status_id`). Used by
     * `DELETE /statuses/:id` to refuse with `409 status.in_use` before attempting
     * the delete. Served by `idx_tasks_status_updated (status_id, updated_at)`, so
     * it never scans the `tasks` heap. A status reaches a workspace only through
     * its list, and `tasks.status_id` is FK-bound to that same status, so an
     * in-workspace `statusId` cannot match a foreign workspace's tasks.
     */
    async countTasksUsingStatus(
        statusId: string,
        executor: DbExecutor = this.db,
    ): Promise<number> {
        const [row] = await executor
            .select({ value: count() })
            .from(tasks)
            .where(eq(tasks.statusId, statusId));
        return row?.value ?? 0;
    }

    /**
     * Lock and return the ids of every list-scoped status sharing one
     * `status_group` within a list, taking a `FOR UPDATE` row lock on each.
     *
     * `DELETE /statuses/:id` calls this inside its transaction so concurrent
     * deletes of statuses in the SAME group serialize: the second deleter blocks
     * until the first commits, then re-counts under the lock. That makes the
     * "is this the last status of its group?" guard (`422 status.last_in_group`)
     * race-safe — two parallel deletes can never both pass it and empty the group.
     * The returned ids let the caller confirm the target row still exists under
     * the lock. Pinned to `scope_type = 'list'` (V1 statuses are list-scoped).
     */
    async lockGroupStatusIds(
        scopeId: string,
        statusGroup: Status["statusGroup"],
        executor: DbExecutor = this.db,
    ): Promise<string[]> {
        // conv: FOR UPDATE removed — SQLite serializes writes, so concurrent
        // delete transactions cannot interleave with this read-then-delete.
        const rows = await executor
            .select({ id: statuses.id })
            .from(statuses)
            .where(
                and(
                    eq(statuses.scopeType, "list"),
                    eq(statuses.scopeId, scopeId),
                    eq(statuses.statusGroup, statusGroup),
                ),
            );
        return rows.map((r) => r.id);
    }

    /**
     * Delete a status by its primary key, returning the affected-row count. Zero
     * means the row was already gone (e.g. a concurrent delete won the race) — the
     * caller renders that as `404 status.not_found`. The write is keyed on the PK
     * alone, so callers MUST have resolved the id within the workspace first.
     *
     * If a task still references the status, the `fk_tasks_status` `ON DELETE
     * RESTRICT` constraint rejects the delete with a mysql2 `ER_ROW_IS_REFERENCED_2`
     * — the race-safe backstop for the caller's `countTasksUsingStatus` pre-check,
     * translated by the service into `409 status.in_use`.
     */
    async deleteById(
        statusId: string,
        executor: DbExecutor = this.db,
    ): Promise<number> {
        const result = await executor
            .delete(statuses)
            .where(eq(statuses.id, statusId));
        return result.rowsAffected;
    }

    /**
     * Lock and return the ids of every list-scoped status in a list, taking a
     * `FOR UPDATE` row lock on each. `PATCH /lists/:listId/statuses/reorder` calls
     * this inside its transaction so concurrent reorders of the SAME list
     * serialize, and so the membership check ("does every body id belong to this
     * list?") is race-safe against a concurrent delete. Pinned to
     * `scope_type = 'list'`; covered by `idx_statuses_scope`.
     */
    async lockListStatusIds(
        listId: string,
        executor: DbExecutor = this.db,
    ): Promise<string[]> {
        // conv: FOR UPDATE removed — SQLite serializes writes, so concurrent
        // reorder transactions cannot interleave with this read-then-write.
        const rows = await executor
            .select({ id: statuses.id })
            .from(statuses)
            .where(
                and(
                    eq(statuses.scopeType, "list"),
                    eq(statuses.scopeId, listId),
                ),
            );
        return rows.map((r) => r.id);
    }

    /**
     * Set a single status's `position`. Used by the reorder endpoint, once per
     * supplied `{ id, position }` pair, inside the same transaction. `updated_at`
     * auto-bumps via the column's `ON UPDATE`. The caller MUST have confirmed the
     * id belongs to the target list under the reorder lock first — the write is
     * keyed on the PK alone.
     */
    async updatePosition(
        statusId: string,
        position: number,
        executor: DbExecutor = this.db,
    ): Promise<void> {
        await executor
            .update(statuses)
            .set({ position })
            .where(eq(statuses.id, statusId));
    }
}
