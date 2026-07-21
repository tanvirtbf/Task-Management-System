import { and, asc, desc, eq, isNotNull, isNull, lt, sql } from "drizzle-orm";
import { MySql2Database } from "drizzle-orm/mysql2";
import * as schema from "../db/schema";
import { attachments, tasks } from "../db/schema";
import type { DbExecutor } from "./types";

/**
 * Data access for the `attachments` table (§16). The table has no `workspace_id`
 * column — an attachment reaches a workspace only through its task
 * (`attachments.task_id → tasks.workspace_id`), so the isolation reads join that
 * chain.
 */

export interface AttachmentRecord {
    id: string;
    taskId: string;
    name: string;
    storageKey: string;
    mimeType: string;
    sizeBytes: bigint;
    thumbnailKey: string | null;
    uploadedBy: string;
    uploadedAt: Date;
    deletedAt: Date | null;
    uploadStatus: "pending" | "complete";
}

export interface NewAttachmentRow {
    id: string;
    taskId: string;
    name: string;
    storageKey: string;
    mimeType: string;
    sizeBytes: bigint;
    uploadedBy: string;
}

const ATTACHMENT_COLUMNS = {
    id: attachments.id,
    taskId: attachments.taskId,
    name: attachments.name,
    storageKey: attachments.storageKey,
    mimeType: attachments.mimeType,
    sizeBytes: attachments.sizeBytes,
    thumbnailKey: attachments.thumbnailKey,
    uploadedBy: attachments.uploadedBy,
    uploadedAt: attachments.uploadedAt,
    deletedAt: attachments.deletedAt,
    uploadStatus: attachments.uploadStatus,
} as const;

export class AttachmentsRepo {
    constructor(private db: MySql2Database<typeof schema>) {}

    /**
     * Insert a `pending` attachment row at sign time. Every NOT NULL column is
     * supplied; `upload_status` defaults to `pending`, `thumbnail_key`/`deleted_at`
     * default null, `uploaded_at` defaults to now(). The insert trigger does NOT
     * bump `tasks.attachments_count` while the row is pending.
     */
    async createPending(
        row: NewAttachmentRow,
        exec: DbExecutor = this.db,
    ): Promise<void> {
        await exec.insert(attachments).values({
            id: row.id,
            taskId: row.taskId,
            name: row.name,
            storageKey: row.storageKey,
            mimeType: row.mimeType,
            sizeBytes: row.sizeBytes,
            uploadedBy: row.uploadedBy,
            uploadStatus: "pending",
        });
    }

    /**
     * Resolve an attachment by id *within a workspace*, via its task. Returns the
     * full record (incl. `deleted_at` / `upload_status` so the caller can apply
     * lifecycle rules) or `null` when the id does not exist OR its task belongs to
     * another workspace — so callers render both as `404 attachment.not_found`
     * (no cross-workspace existence oracle).
     */
    async findByIdInWorkspace(
        id: string,
        workspaceId: string,
    ): Promise<AttachmentRecord | null> {
        const [row] = await this.db
            .select(ATTACHMENT_COLUMNS)
            .from(attachments)
            .innerJoin(tasks, eq(attachments.taskId, tasks.id))
            .where(
                and(
                    eq(attachments.id, id),
                    eq(tasks.workspaceId, workspaceId),
                ),
            )
            .limit(1);
        return row ?? null;
    }

    /**
     * Every *finalised, non-deleted* attachment on a task, newest first
     * (`uploaded_at` DESC with a stable `id` tie-break). Pending (signed but never
     * finalised) and soft-deleted rows are excluded — they are not real files on
     * the task yet / any more. Served by `idx_attachments_task (task_id,
     * uploaded_at)`.
     */
    async listByTask(taskId: string): Promise<AttachmentRecord[]> {
        return this.db
            .select(ATTACHMENT_COLUMNS)
            .from(attachments)
            .where(
                and(
                    eq(attachments.taskId, taskId),
                    eq(attachments.uploadStatus, "complete"),
                    isNull(attachments.deletedAt),
                ),
            )
            .orderBy(desc(attachments.uploadedAt), asc(attachments.id));
    }

    /**
     * Flip a pending attachment to `complete` (optionally setting `thumbnail_key`).
     * Idempotent: re-finalising an already-complete row just re-asserts the same
     * values. The pending→complete transition fires the after_update trigger,
     * which bumps `tasks.attachments_count` exactly once.
     */
    async markComplete(
        id: string,
        opts: { thumbnailKey?: string | null; sizeBytes?: bigint },
        exec: DbExecutor = this.db,
    ): Promise<void> {
        const patch: Partial<typeof attachments.$inferInsert> = {
            uploadStatus: "complete",
        };
        if (opts.thumbnailKey != null) patch.thumbnailKey = opts.thumbnailKey;
        // Reconcile the stored size with the object that actually landed in R2.
        if (opts.sizeBytes != null) patch.sizeBytes = opts.sizeBytes;
        await exec.update(attachments).set(patch).where(eq(attachments.id, id));
    }

    /**
     * Soft-delete: set `deleted_at = UTC_TIMESTAMP()` only if not already
     * deleted. Returns the affected-row count — `0` means a concurrent delete
     * already won, which the caller renders as `404`. The NULL→non-NULL
     * transition fires the after_update trigger, decrementing
     * `tasks.attachments_count` for a complete row (a pending row was never
     * counted, so nothing to decrement).
     *
     * KI-2 fix (2026-07-14): use `UTC_TIMESTAMP()` not `NOW()` — every other
     * timestamp is stored UTC, and the r2-purge cutoff is a UTC JS Date, so a
     * local (Dhaka, +6h) `deleted_at` would skew the 7-day purge window.
     */
    async softDelete(
        id: string,
        exec: DbExecutor = this.db,
    ): Promise<number> {
        const [result] = await exec
            .update(attachments)
            .set({ deletedAt: sql`UTC_TIMESTAMP()` })
            .where(and(eq(attachments.id, id), isNull(attachments.deletedAt)));
        return result.affectedRows;
    }

    /**
     * Every still-`pending` attachment whose signed upload was never finalised
     * before `olderThan` (sign-time `uploaded_at` < cutoff) — the §28
     * attachment-janitor's candidate set. GLOBAL (no workspace scope): the job
     * sweeps every tenant. A `complete` row is never returned.
     */
    async findStalePending(olderThan: Date): Promise<AttachmentRecord[]> {
        return this.db
            .select(ATTACHMENT_COLUMNS)
            .from(attachments)
            .where(
                and(
                    eq(attachments.uploadStatus, "pending"),
                    lt(attachments.uploadedAt, olderThan),
                ),
            );
    }

    /**
     * Hard-delete a still-`pending` attachment row (§28 attachment-janitor). The
     * `upload_status='pending'` guard leaves a row that finalised between the
     * scan and this delete intact (affectedRows=0). A pending row was never
     * counted in `tasks.attachments_count`, so no counter adjustment is needed.
     * Returns affectedRows (0 = already gone / finalised — naturally idempotent).
     */
    async hardDeletePending(
        id: string,
        exec: DbExecutor = this.db,
    ): Promise<number> {
        const [result] = await exec
            .delete(attachments)
            .where(
                and(
                    eq(attachments.id, id),
                    eq(attachments.uploadStatus, "pending"),
                ),
            );
        return result.affectedRows;
    }

    /**
     * Every soft-deleted attachment whose `deleted_at` is older than
     * `deletedBefore` — the §28 r2-purge candidate set (eligible for permanent
     * R2 object + row removal). GLOBAL (no workspace scope). Returns
     * `storageKey` + `thumbnailKey` so the job can delete both R2 objects.
     */
    async findPurgeable(deletedBefore: Date): Promise<AttachmentRecord[]> {
        return this.db
            .select(ATTACHMENT_COLUMNS)
            .from(attachments)
            .where(
                and(
                    isNotNull(attachments.deletedAt),
                    lt(attachments.deletedAt, deletedBefore),
                ),
            );
    }

    /**
     * Hard-delete a soft-deleted attachment row (§28 r2-purge), guarded on
     * `deleted_at IS NOT NULL`. The row was already decremented from
     * `tasks.attachments_count` at soft-delete time and there is no after-delete
     * trigger, so the counter stays correct. Returns affectedRows (0 = already
     * purged — naturally idempotent).
     */
    async hardDeletePurged(
        id: string,
        exec: DbExecutor = this.db,
    ): Promise<number> {
        const [result] = await exec
            .delete(attachments)
            .where(
                and(
                    eq(attachments.id, id),
                    isNotNull(attachments.deletedAt),
                ),
            );
        return result.affectedRows;
    }
}
