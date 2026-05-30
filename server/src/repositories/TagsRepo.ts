import { and, asc, eq } from "drizzle-orm";
import { MySql2Database } from "drizzle-orm/mysql2";
import * as schema from "../db/schema";
import { tags } from "../db/schema";
import { fakeId } from "../utils";
import type { DbExecutor } from "./types";

/**
 * Data access for the `tags` table. Owns the Drizzle queries; the service
 * composes business logic over the rows this repo returns.
 *
 * Each method selects only the columns its caller needs — never `workspace_id`
 * or the timestamps, which are not part of the wire `Tag` shape.
 */

export interface TagRecord {
    id: string;
    name: string;
    color: string;
}

export class TagsRepo {
    constructor(private db: MySql2Database<typeof schema>) {}

    /**
     * List every tag in a workspace, ordered by `name` with a stable `id`
     * tie-break. `name` is UNIQUE per workspace (`uq_tags_workspace_name`) so
     * the order is already deterministic; the `id` tie-break keeps the idiom
     * identical to the other hierarchy lists. That same unique index backs both
     * the `workspace_id` filter and the `name` sort.
     *
     * `tags` has no `archived_at` column — tags are hard-deleted (the delete
     * cascades to `task_tags`), so there is deliberately no soft-delete filter.
     */
    async listByWorkspace(workspaceId: string): Promise<TagRecord[]> {
        const rows = await this.db
            .select({
                id: tags.id,
                name: tags.name,
                color: tags.color,
            })
            .from(tags)
            .where(eq(tags.workspaceId, workspaceId))
            .orderBy(asc(tags.name), asc(tags.id));
        return rows;
    }

    /**
     * Insert a tag and return it in wire shape. A duplicate `(workspace_id,
     * name)` raises the DB unique-violation (`uq_tags_workspace_name`); the
     * service catches it and maps it to `409 tag.duplicate` — there is no
     * pre-check `SELECT`, so the unique index is the single, race-free guard.
     *
     * Pass `exec` to run inside the caller's transaction (so the paired
     * `workspace_activity` write is atomic with this insert).
     */
    async create(
        input: { workspaceId: string; name: string; color: string },
        exec: DbExecutor = this.db,
    ): Promise<TagRecord> {
        const id = fakeId("tag");
        await exec.insert(tags).values({
            id,
            workspaceId: input.workspaceId,
            name: input.name,
            color: input.color,
        });
        return { id, name: input.name, color: input.color };
    }

    /**
     * Lock a tag row (`SELECT … FOR UPDATE`) scoped to the caller's workspace
     * and return its current wire shape, or `null` when no such tag exists in
     * that workspace — a missing id and a cross-tenant id are indistinguishable,
     * and the caller renders both as `tag.not_found`. Must run inside a
     * transaction (`exec` is the tx handle): the lock serializes concurrent
     * updates to the SAME tag so the service's read-modify-write is race-free.
     */
    async lockByIdInWorkspace(
        id: string,
        workspaceId: string,
        exec: DbExecutor,
    ): Promise<TagRecord | null> {
        const [row] = await exec
            .select({
                id: tags.id,
                name: tags.name,
                color: tags.color,
            })
            .from(tags)
            .where(and(eq(tags.id, id), eq(tags.workspaceId, workspaceId)))
            .for("update");
        return row ?? null;
    }

    /**
     * Apply a partial update, setting only the supplied columns. The `WHERE` is
     * workspace-scoped as defense-in-depth (the caller already proved ownership
     * via `lockByIdInWorkspace`). A rename that collides with another tag raises
     * the `uq_tags_workspace_name` unique-violation, which the service maps to
     * `409 tag.duplicate`.
     */
    async update(
        id: string,
        workspaceId: string,
        patch: { name?: string; color?: string },
        exec: DbExecutor = this.db,
    ): Promise<void> {
        await exec
            .update(tags)
            .set(patch)
            .where(and(eq(tags.id, id), eq(tags.workspaceId, workspaceId)));
    }
}
