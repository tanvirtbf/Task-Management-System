import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
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
     * Soft-delete: set `deleted_at = NOW()` only if not already deleted. Returns
     * the affected-row count — `0` means a concurrent delete already won, which
     * the caller renders as `404`. The NULL→non-NULL transition fires the
     * after_update trigger, decrementing `tasks.attachments_count` for a complete
     * row (a pending row was never counted, so nothing to decrement).
     */
    async softDelete(
        id: string,
        exec: DbExecutor = this.db,
    ): Promise<number> {
        const [result] = await exec
            .update(attachments)
            .set({ deletedAt: sql`NOW()` })
            .where(and(eq(attachments.id, id), isNull(attachments.deletedAt)));
        return result.affectedRows;
    }
}
