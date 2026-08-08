"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AttachmentsRepo = void 0;
const drizzle_orm_1 = require("drizzle-orm");
const schema_1 = require("../db/schema");
const utils_1 = require("../utils");
const ATTACHMENT_COLUMNS = {
    id: schema_1.attachments.id,
    taskId: schema_1.attachments.taskId,
    name: schema_1.attachments.name,
    storageKey: schema_1.attachments.storageKey,
    mimeType: schema_1.attachments.mimeType,
    sizeBytes: schema_1.attachments.sizeBytes,
    thumbnailKey: schema_1.attachments.thumbnailKey,
    uploadedBy: schema_1.attachments.uploadedBy,
    uploadedAt: schema_1.attachments.uploadedAt,
    deletedAt: schema_1.attachments.deletedAt,
    uploadStatus: schema_1.attachments.uploadStatus,
};
class AttachmentsRepo {
    db;
    constructor(db) {
        this.db = db;
    }
    /**
     * Insert a `pending` attachment row at sign time. Every NOT NULL column is
     * supplied; `upload_status` defaults to `pending`, `thumbnail_key`/`deleted_at`
     * default null, `uploaded_at` defaults to now(). The insert trigger does NOT
     * bump `tasks.attachments_count` while the row is pending.
     */
    async createPending(row, exec = this.db) {
        await exec.insert(schema_1.attachments).values({
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
    async findByIdInWorkspace(id, workspaceId) {
        const [row] = await this.db
            .select(ATTACHMENT_COLUMNS)
            .from(schema_1.attachments)
            .innerJoin(schema_1.tasks, (0, drizzle_orm_1.eq)(schema_1.attachments.taskId, schema_1.tasks.id))
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.attachments.id, id), (0, drizzle_orm_1.eq)(schema_1.tasks.workspaceId, workspaceId)))
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
    async listByTask(taskId) {
        return this.db
            .select(ATTACHMENT_COLUMNS)
            .from(schema_1.attachments)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.attachments.taskId, taskId), (0, drizzle_orm_1.eq)(schema_1.attachments.uploadStatus, "complete"), (0, drizzle_orm_1.isNull)(schema_1.attachments.deletedAt)))
            .orderBy((0, drizzle_orm_1.desc)(schema_1.attachments.uploadedAt), (0, drizzle_orm_1.asc)(schema_1.attachments.id));
    }
    /**
     * Flip a pending attachment to `complete` (optionally setting `thumbnail_key`).
     * Idempotent: re-finalising an already-complete row just re-asserts the same
     * values. The pending→complete transition fires the after_update trigger,
     * which bumps `tasks.attachments_count` exactly once.
     */
    async markComplete(id, opts, exec = this.db) {
        const patch = {
            uploadStatus: "complete",
        };
        if (opts.thumbnailKey != null)
            patch.thumbnailKey = opts.thumbnailKey;
        // Reconcile the stored size with the object that actually landed in R2.
        if (opts.sizeBytes != null)
            patch.sizeBytes = opts.sizeBytes;
        await exec.update(schema_1.attachments).set(patch).where((0, drizzle_orm_1.eq)(schema_1.attachments.id, id));
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
    async softDelete(id, exec = this.db) {
        const [result] = await exec
            .update(schema_1.attachments)
            .set({ deletedAt: (0, drizzle_orm_1.sql) `UTC_TIMESTAMP()` })
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.attachments.id, id), (0, drizzle_orm_1.isNull)(schema_1.attachments.deletedAt)));
        return result.affectedRows;
    }
    /**
     * Every still-`pending` attachment whose signed upload was never finalised
     * before `olderThan` (sign-time `uploaded_at` < cutoff) — the §28
     * attachment-janitor's candidate set. GLOBAL (no workspace scope): the job
     * sweeps every tenant. A `complete` row is never returned.
     */
    async findStalePending(olderThan) {
        return this.db
            .select(ATTACHMENT_COLUMNS)
            .from(schema_1.attachments)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.attachments.uploadStatus, "pending"), (0, drizzle_orm_1.lt)(schema_1.attachments.uploadedAt, olderThan)));
    }
    /**
     * Hard-delete a still-`pending` attachment row (§28 attachment-janitor). The
     * `upload_status='pending'` guard leaves a row that finalised between the
     * scan and this delete intact (affectedRows=0). A pending row was never
     * counted in `tasks.attachments_count`, so no counter adjustment is needed.
     * Returns affectedRows (0 = already gone / finalised — naturally idempotent).
     */
    async hardDeletePending(id, exec = this.db) {
        const [result] = await exec
            .delete(schema_1.attachments)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.attachments.id, id), (0, drizzle_orm_1.eq)(schema_1.attachments.uploadStatus, "pending")));
        return result.affectedRows;
    }
    /**
     * Every soft-deleted attachment whose `deleted_at` is older than
     * `deletedBefore` — the §28 r2-purge candidate set (eligible for permanent
     * R2 object + row removal). GLOBAL (no workspace scope). Returns
     * `storageKey` + `thumbnailKey` so the job can delete both R2 objects.
     */
    async findPurgeable(deletedBefore) {
        return this.db
            .select(ATTACHMENT_COLUMNS)
            .from(schema_1.attachments)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.isNotNull)(schema_1.attachments.deletedAt), (0, drizzle_orm_1.lt)(schema_1.attachments.deletedAt, deletedBefore)));
    }
    /**
     * Hard-delete a soft-deleted attachment row (§28 r2-purge), guarded on
     * `deleted_at IS NOT NULL`. The row was already decremented from
     * `tasks.attachments_count` at soft-delete time and there is no after-delete
     * trigger, so the counter stays correct. Returns affectedRows (0 = already
     * purged — naturally idempotent).
     */
    async hardDeletePurged(id, exec = this.db) {
        const [result] = await exec
            .delete(schema_1.attachments)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.attachments.id, id), (0, drizzle_orm_1.isNotNull)(schema_1.attachments.deletedAt)));
        return result.affectedRows;
    }
    // ─── F16 (ISS-022): the hard-delete → R2 purge queue ─────────────────────
    /**
     * The R2 keys of EVERY attachment on the given tasks — soft-deleted rows
     * included, because a task hard delete cascades those away too, before the
     * ordinary purge flow would have reached them.
     */
    async storageKeysByTasks(taskIds, exec = this.db) {
        if (taskIds.length === 0)
            return [];
        return exec
            .select({
            storageKey: schema_1.attachments.storageKey,
            thumbnailKey: schema_1.attachments.thumbnailKey,
        })
            .from(schema_1.attachments)
            .where((0, drizzle_orm_1.inArray)(schema_1.attachments.taskId, taskIds));
    }
    /**
     * Queue R2 keys for deletion. Runs INSIDE the hard-delete transaction, so
     * either the task goes and its keys are queued, or neither happens — the
     * window in which bytes could orphan does not exist.
     */
    async enqueueR2Purge(rows, exec = this.db) {
        if (rows.length === 0)
            return;
        await exec.insert(schema_1.r2PurgeQueue).values(rows.map((r) => ({
            id: (0, utils_1.fakeId)("r2q"),
            storageKey: r.storageKey,
            thumbnailKey: r.thumbnailKey,
        })));
    }
    /** The queued keys, oldest first — the r2-purge job drains these. */
    async findQueuedPurge() {
        return this.db
            .select({
            id: schema_1.r2PurgeQueue.id,
            storageKey: schema_1.r2PurgeQueue.storageKey,
            thumbnailKey: schema_1.r2PurgeQueue.thumbnailKey,
        })
            .from(schema_1.r2PurgeQueue)
            .orderBy((0, drizzle_orm_1.asc)(schema_1.r2PurgeQueue.queuedAt));
    }
    /** Remove a drained queue row (its R2 objects are confirmed gone). */
    async deleteQueuedPurge(id, exec = this.db) {
        const [result] = await exec
            .delete(schema_1.r2PurgeQueue)
            .where((0, drizzle_orm_1.eq)(schema_1.r2PurgeQueue.id, id));
        return result.affectedRows;
    }
}
exports.AttachmentsRepo = AttachmentsRepo;
