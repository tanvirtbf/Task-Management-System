import { and, asc, eq, isNull, type SQL } from "drizzle-orm";
import { MySql2Database } from "drizzle-orm/mysql2";
import * as schema from "../db/schema";
import { spaces } from "../db/schema";
import { fakeId } from "../utils";
import type { DbExecutor } from "./types";

/**
 * Data access for the `spaces` table. Owns the Drizzle queries; the service
 * composes the workspace-scoping rules over the rows this repo returns.
 *
 * Like `UsersRepo`, the select is intentionally tight: it returns only the
 * columns the wire `Space` (API_DESIGN.md Appendix A) needs — never
 * `workspace_id` or `updated_at`, which must not leak into a response shape.
 */
export interface SpaceRecord {
    id: string;
    name: string;
    description: string | null;
    icon: string;
    color: string;
    isPrivate: boolean;
    position: number;
    archivedAt: Date | null;
    createdBy: string;
    createdAt: Date;
}

export class SpacesRepo {
    constructor(private db: MySql2Database<typeof schema>) {}

    /**
     * List the spaces in a workspace, ordered by `position` with a stable
     * tie-break on `id`. Archived rows (`archived_at IS NOT NULL`) are excluded
     * unless `includeArchived` is set.
     *
     * Backed by `idx_spaces_workspace_archived (workspace_id, archived_at,
     * position)`.
     */
    async listByWorkspace(
        workspaceId: string,
        opts: { includeArchived: boolean },
    ): Promise<SpaceRecord[]> {
        const where: SQL | undefined = opts.includeArchived
            ? eq(spaces.workspaceId, workspaceId)
            : and(
                  eq(spaces.workspaceId, workspaceId),
                  isNull(spaces.archivedAt),
              );

        const rows = await this.db
            .select({
                id: spaces.id,
                name: spaces.name,
                description: spaces.description,
                icon: spaces.icon,
                color: spaces.color,
                isPrivate: spaces.isPrivate,
                position: spaces.position,
                archivedAt: spaces.archivedAt,
                createdBy: spaces.createdBy,
                createdAt: spaces.createdAt,
            })
            .from(spaces)
            .where(where)
            .orderBy(asc(spaces.position), asc(spaces.id));

        return rows;
    }

    /**
     * Resolve one space by id within a workspace. Returns `null` when the id
     * does not exist OR belongs to another workspace, so callers can translate
     * both to `404 space.not_found` (no cross-workspace existence oracle).
     *
     * `archived_at` is intentionally NOT filtered — an archived space still
     * exists (its lists are cascade-archived), so it resolves here rather than
     * 404.
     *
     * Pass `exec` to read inside a caller's transaction — `create` uses this to
     * fetch the just-inserted row (authoritative DB `created_at`) before commit.
     */
    async findByIdInWorkspace(
        spaceId: string,
        workspaceId: string,
        exec: DbExecutor = this.db,
    ): Promise<SpaceRecord | null> {
        const [row] = await exec
            .select({
                id: spaces.id,
                name: spaces.name,
                description: spaces.description,
                icon: spaces.icon,
                color: spaces.color,
                isPrivate: spaces.isPrivate,
                position: spaces.position,
                archivedAt: spaces.archivedAt,
                createdBy: spaces.createdBy,
                createdAt: spaces.createdAt,
            })
            .from(spaces)
            .where(
                and(
                    eq(spaces.id, spaceId),
                    eq(spaces.workspaceId, workspaceId),
                ),
            )
            .limit(1);
        return row ?? null;
    }

    /**
     * Insert a space and return its generated id. `created_at` / `updated_at`
     * are left to their DB defaults (and `archived_at` to NULL) so the row's
     * timestamps are authoritative; the service re-reads via
     * `findByIdInWorkspace` to return the canonical wire shape.
     *
     * Pass `exec` to run inside the caller's transaction so the paired
     * `workspace_activity` write is atomic with this insert.
     */
    async insert(
        input: {
            workspaceId: string;
            name: string;
            description: string | null;
            icon: string;
            color: string;
            isPrivate: boolean;
            position: number;
            createdBy: string;
        },
        exec: DbExecutor = this.db,
    ): Promise<string> {
        const id = fakeId("sp");
        await exec.insert(spaces).values({
            id,
            workspaceId: input.workspaceId,
            name: input.name,
            description: input.description,
            icon: input.icon,
            color: input.color,
            isPrivate: input.isPrivate,
            position: input.position,
            createdBy: input.createdBy,
        });
        return id;
    }
}
