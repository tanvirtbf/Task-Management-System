import { and, asc, count, eq, isNull, type SQL } from "drizzle-orm";
import { MySql2Database } from "drizzle-orm/mysql2";
import * as schema from "../db/schema";
import { departmentReports, spaces } from "../db/schema";
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
    /** Dept Review V1 — department head user id (null = no head assigned). */
    headUserId: string | null;
    position: number;
    archivedAt: Date | null;
    createdBy: string;
    createdAt: Date;
}

/**
 * Partial mutable fields for `PATCH /api/v1/spaces/:id`. Every key is optional;
 * the service builds this from only the body fields actually supplied, so an
 * absent key leaves that column untouched. `workspace_id` / `created_by` /
 * timestamps are never updatable here.
 */
export interface SpaceUpdateFields {
    name?: string;
    description?: string | null;
    icon?: string;
    color?: string;
    isPrivate?: boolean;
    position?: number;
    /** Dept Review V1 — `null` clears the head (service validates non-null ids). */
    headUserId?: string | null;
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
                headUserId: spaces.headUserId,
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
                headUserId: spaces.headUserId,
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

    /**
     * Acquire a row lock on the space (`SELECT … FOR UPDATE`) inside a
     * transaction so concurrent writes to the SAME space (update / archive /
     * unarchive / delete) serialize. Every writer takes this lock first, in the
     * same order, which removes the InnoDB deadlock between the row mutation and
     * its paired `workspace_activity` append, and lets the caller re-read the
     * authoritative row state race-free. Mirrors `TasksRepo.lockById`.
     */
    async lockById(spaceId: string, exec: DbExecutor = this.db): Promise<void> {
        await exec
            .select({ id: spaces.id })
            .from(spaces)
            .where(eq(spaces.id, spaceId))
            .for("update");
    }

    /**
     * Apply a partial update to a space. Only the keys present in `fields` are
     * written (Drizzle's `.set()` emits a column only when its key exists), so
     * an omitted field is left untouched; `updated_at` bumps automatically via
     * its `ON UPDATE CURRENT_TIMESTAMP`. The caller must pass at least one field
     * — an empty `.set()` is invalid SQL — and scopes the workspace check before
     * calling. Pass `exec` to run inside the caller's transaction.
     */
    async updateFields(
        spaceId: string,
        fields: SpaceUpdateFields,
        exec: DbExecutor = this.db,
    ): Promise<void> {
        await exec.update(spaces).set(fields).where(eq(spaces.id, spaceId));
    }

    /**
     * Set (archive) or clear (unarchive) a space's `archived_at`. A `Date`
     * soft-deletes the space; `null` restores it. `updated_at` bumps via its
     * `ON UPDATE CURRENT_TIMESTAMP`. Pass `exec` to run inside the caller's
     * transaction so the flip and its `workspace_activity` row (and any list
     * cascade) commit atomically.
     */
    async setArchivedAt(
        spaceId: string,
        value: Date | null,
        exec: DbExecutor = this.db,
    ): Promise<void> {
        await exec
            .update(spaces)
            .set({ archivedAt: value })
            .where(eq(spaces.id, spaceId));
    }

    /**
     * Permanently delete a space by id, returning the number of rows removed
     * (0 when a concurrent delete already won). The caller MUST enforce the
     * preconditions first (resolved within the workspace, archived, and holding
     * NO lists). With no lists the space has no children to cascade — list-scoped
     * statuses/tasks/forms live under lists, and V1 creates no space-scoped
     * statuses/custom_fields — so a plain row delete is clean and orphan-free.
     * Pass `exec` to run inside the delete transaction.
     */
    async deleteById(
        spaceId: string,
        exec: DbExecutor = this.db,
    ): Promise<number> {
        const [result] = await exec
            .delete(spaces)
            .where(eq(spaces.id, spaceId));
        return result.affectedRows;
    }

    /**
     * Count `department_reports` rows for a space (Dept Review V1). Reports are
     * retained HR history — `fk_dept_reports_space` is ON DELETE RESTRICT — so
     * the delete flow checks this first and surfaces `409 space.has_reports`
     * instead of letting the FK bounce the DELETE into a 500. Pass `exec` to
     * re-check inside the delete transaction.
     */
    async countReportsBySpace(
        spaceId: string,
        exec: DbExecutor = this.db,
    ): Promise<number> {
        const [row] = await exec
            .select({ n: count() })
            .from(departmentReports)
            .where(eq(departmentReports.spaceId, spaceId));
        return row?.n ?? 0;
    }

    /**
     * Null out every headship a user holds (Dept Review V1). Runs inside the
     * deactivation transaction: users are soft-deactivated (never deleted), so
     * the FK's ON DELETE SET NULL can never fire — this app-side write is the
     * only mechanism that removes a deactivated head. Reactivation does NOT
     * restore headships (one-way by design).
     */
    async clearHeadships(
        userId: string,
        workspaceId: string,
        exec: DbExecutor = this.db,
    ): Promise<void> {
        await exec
            .update(spaces)
            .set({ headUserId: null })
            .where(
                and(
                    eq(spaces.headUserId, userId),
                    eq(spaces.workspaceId, workspaceId),
                ),
            );
    }

    /**
     * Every non-archived space across ALL workspaces — the weekly
     * department-report job's iteration set (Dept Review V1 P20;
     * single-tenant today, multi-tenant-ready like the rest of the schema).
     */
    async listAllActive(): Promise<
        Array<{
            id: string;
            workspaceId: string;
            name: string;
            headUserId: string | null;
        }>
    > {
        return this.db
            .select({
                id: spaces.id,
                workspaceId: spaces.workspaceId,
                name: spaces.name,
                headUserId: spaces.headUserId,
            })
            .from(spaces)
            .where(isNull(spaces.archivedAt))
            .orderBy(asc(spaces.id));
    }
}
