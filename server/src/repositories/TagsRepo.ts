import { and, asc, count, eq, inArray } from "drizzle-orm";
import { MySql2Database } from "drizzle-orm/mysql2";
import * as schema from "../db/schema";
import { tags, taskTags } from "../db/schema";
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
    /**
     * Return the subset of `tagIds` that exist in `workspaceId`, as a Set — the
     * bulk validator for task tag writes (#4 initial tags, #5/#10 tag_add). The
     * caller compares the returned set against the requested ids and rejects the
     * difference, so a cross-tenant tag id is indistinguishable from a missing
     * one (no existence oracle). Mirrors `UsersRepo.findActiveIdsInWorkspace`.
     */
    async findIdsInWorkspace(
        tagIds: string[],
        workspaceId: string,
    ): Promise<Set<string>> {
        if (tagIds.length === 0) return new Set();
        const rows = await this.db
            .select({ id: tags.id })
            .from(tags)
            .where(
                and(
                    eq(tags.workspaceId, workspaceId),
                    inArray(tags.id, tagIds),
                ),
            );
        return new Set(rows.map((r) => r.id));
    }

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

    /**
     * Hard-delete a tag, scoped to the caller's workspace. The workspace-scoped
     * `WHERE` is defense-in-depth (the caller already proved ownership via
     * `lockByIdInWorkspace` inside the same tx). Deleting a tag automatically
     * removes its rows from `task_tags` via `fk_task_tags_tag ON DELETE CASCADE`,
     * so there is NO manual junction cleanup — the FK is the single, race-free
     * guarantee. `tags` has no `archived_at`, so this is a true row delete, not a
     * soft-delete. Pass `exec` to run inside the delete tx (so the paired
     * `workspace_activity` write is atomic with this delete).
     */
    /** F22 (ISS-011): how many tasks still carry this tag. */
    async countTaskLinks(
        tagId: string,
        exec: DbExecutor = this.db,
    ): Promise<number> {
        const [row] = await exec
            .select({ n: count() })
            .from(taskTags)
            .where(eq(taskTags.tagId, tagId));
        return row?.n ?? 0;
    }

    async delete(
        id: string,
        workspaceId: string,
        exec: DbExecutor = this.db,
    ): Promise<void> {
        await exec
            .delete(tags)
            .where(and(eq(tags.id, id), eq(tags.workspaceId, workspaceId)));
    }
}
