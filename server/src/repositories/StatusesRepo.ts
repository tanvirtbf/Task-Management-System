import { and, asc, eq, max } from "drizzle-orm";
import { MySql2Database } from "drizzle-orm/mysql2";
import * as schema from "../db/schema";
import { lists, spaces, statuses, type Status } from "../db/schema";
import type { DbExecutor } from "./types";

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
    async listByList(listId: string): Promise<StatusRecord[]> {
        return this.db
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
}
