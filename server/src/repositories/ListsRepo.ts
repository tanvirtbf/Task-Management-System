import { and, asc, eq, isNull, type SQL } from "drizzle-orm";
import { MySql2Database } from "drizzle-orm/mysql2";
import * as schema from "../db/schema";
import { lists, spaces } from "../db/schema";

/**
 * Data access for the `lists` table. Returns exactly the columns the wire
 * `List` shape (API_DESIGN.md Appendix A) needs — notably it omits
 * `updated_at`, which the contract does not expose.
 */

export interface ListRecord {
    id: string;
    spaceId: string;
    name: string;
    description: string | null;
    icon: string;
    color: string;
    position: number;
    defaultTaskTypeId: string | null;
    isPrivate: boolean;
    archivedAt: Date | null;
    createdBy: string;
    createdAt: Date;
}

export class ListsRepo {
    constructor(private db: MySql2Database<typeof schema>) {}

    /**
     * All lists in a space, ordered by `position` then `id` so the sequence is
     * deterministic even when two lists share a position. By default archived
     * lists are excluded (`archived_at IS NULL`); pass `includeArchived` to
     * surface them.
     *
     * The filter + primary sort are covered by `idx_lists_space_archived`
     * `(space_id, archived_at, position)`.
     */
    async findBySpace(
        spaceId: string,
        includeArchived: boolean,
    ): Promise<ListRecord[]> {
        const where = includeArchived
            ? eq(lists.spaceId, spaceId)
            : and(eq(lists.spaceId, spaceId), isNull(lists.archivedAt));

        return this.db
            .select({
                id: lists.id,
                spaceId: lists.spaceId,
                name: lists.name,
                description: lists.description,
                icon: lists.icon,
                color: lists.color,
                position: lists.position,
                defaultTaskTypeId: lists.defaultTaskTypeId,
                isPrivate: lists.isPrivate,
                archivedAt: lists.archivedAt,
                createdBy: lists.createdBy,
                createdAt: lists.createdAt,
            })
            .from(lists)
            .where(where)
            .orderBy(asc(lists.position), asc(lists.id));
    }

    /**
     * Every list in a workspace, across all its spaces. A `lists` row has no
     * `workspace_id` column — it reaches a workspace only through its parent
     * `spaces` row — so this joins `lists → spaces` and filters on
     * `spaces.workspace_id`. That join IS the tenant-isolation guard: a list
     * from another workspace can never surface, and a cross-workspace
     * `spaceId` filter simply matches nothing.
     *
     * `spaceId` (optional) narrows to a single space; archived lists
     * (`archived_at IS NOT NULL`) are excluded unless `includeArchived`. Rows are
     * grouped by space then ordered by `position`, with a stable `id` tie-break,
     * so the sequence is deterministic across calls. The per-space filter + sort
     * is covered by `idx_lists_space_archived (space_id, archived_at, position)`;
     * the workspace fan-out is driven by `idx_spaces_workspace_archived`.
     */
    async listByWorkspace(
        workspaceId: string,
        opts: { spaceId?: string; includeArchived: boolean },
    ): Promise<ListRecord[]> {
        const conditions: SQL[] = [eq(spaces.workspaceId, workspaceId)];
        if (opts.spaceId !== undefined) {
            conditions.push(eq(lists.spaceId, opts.spaceId));
        }
        if (!opts.includeArchived) {
            conditions.push(isNull(lists.archivedAt));
        }

        return this.db
            .select({
                id: lists.id,
                spaceId: lists.spaceId,
                name: lists.name,
                description: lists.description,
                icon: lists.icon,
                color: lists.color,
                position: lists.position,
                defaultTaskTypeId: lists.defaultTaskTypeId,
                isPrivate: lists.isPrivate,
                archivedAt: lists.archivedAt,
                createdBy: lists.createdBy,
                createdAt: lists.createdAt,
            })
            .from(lists)
            .innerJoin(spaces, eq(lists.spaceId, spaces.id))
            .where(and(...conditions))
            .orderBy(asc(lists.spaceId), asc(lists.position), asc(lists.id));
    }

    /**
     * Resolve a list id *within a workspace*. A `lists` row reaches a workspace
     * only through its parent `spaces` row (there is no `workspace_id` column on
     * `lists`), so this joins `lists → spaces` and filters on
     * `spaces.workspace_id`. Returns the bare id when the list exists in that
     * workspace, else `null`.
     *
     * This is the workspace-isolation guard for list-scoped sub-resources such
     * as statuses: callers translate a `null` into `404 list.not_found`, so a
     * cross-workspace id is indistinguishable from a non-existent one — no
     * existence oracle across workspaces.
     */
    async findByIdInWorkspace(
        listId: string,
        workspaceId: string,
    ): Promise<{ id: string } | null> {
        const [row] = await this.db
            .select({ id: lists.id })
            .from(lists)
            .innerJoin(spaces, eq(lists.spaceId, spaces.id))
            .where(
                and(eq(lists.id, listId), eq(spaces.workspaceId, workspaceId)),
            )
            .limit(1);
        return row ?? null;
    }

    /**
     * Fetch one list's full wire record within a workspace. The full-record
     * sibling of `findByIdInWorkspace` (which returns only `{ id }` as a
     * lightweight isolation guard for sub-resources): same `lists → spaces` join
     * and `spaces.workspace_id` filter, but selecting every column the wire
     * `List` needs. Returns `null` when the id does not exist OR belongs to
     * another workspace, so the caller maps both to `404 list.not_found` (no
     * cross-workspace existence oracle).
     *
     * `archived_at` is intentionally NOT filtered — an archived list still
     * exists, and the detail / unarchive flows need to read it, so it resolves
     * here rather than 404 (mirrors `SpacesRepo.findByIdInWorkspace` and
     * `TasksService.getById`).
     */
    async findRecordByIdInWorkspace(
        listId: string,
        workspaceId: string,
    ): Promise<ListRecord | null> {
        const [row] = await this.db
            .select({
                id: lists.id,
                spaceId: lists.spaceId,
                name: lists.name,
                description: lists.description,
                icon: lists.icon,
                color: lists.color,
                position: lists.position,
                defaultTaskTypeId: lists.defaultTaskTypeId,
                isPrivate: lists.isPrivate,
                archivedAt: lists.archivedAt,
                createdBy: lists.createdBy,
                createdAt: lists.createdAt,
            })
            .from(lists)
            .innerJoin(spaces, eq(lists.spaceId, spaces.id))
            .where(
                and(eq(lists.id, listId), eq(spaces.workspaceId, workspaceId)),
            )
            .limit(1);
        return row ?? null;
    }
}
