import type { AttachmentRecord } from "../repositories/AttachmentsRepo";

/**
 * Wire-format `Attachment` per API_DESIGN.md Appendix A. `url` / `thumbnail_url`
 * are FRESH signed GET URLs (5-min validity) regenerated on every read — never
 * stored — so they are supplied by the service (which calls R2Service) rather
 * than read off the row. `storage_key`, `thumbnail_key`, `deleted_at`, and
 * `upload_status` are internal and never cross the wire.
 */
export interface WireAttachment {
    id: string;
    task_id: string;
    name: string;
    url: string;
    mime_type: string;
    size_bytes: number;
    thumbnail_url: string | null;
    uploaded_by: string;
    uploaded_at: string;
}

export const toWireAttachment = (
    a: AttachmentRecord,
    urls: { url: string; thumbnailUrl: string | null },
): WireAttachment => ({
    id: a.id,
    task_id: a.taskId,
    name: a.name,
    url: urls.url,
    mime_type: a.mimeType,
    // `size_bytes` is a BIGINT in the DB; wire shape is a number. Safe for files
    // ≤ 25 MB, far below Number.MAX_SAFE_INTEGER.
    size_bytes: Number(a.sizeBytes),
    thumbnail_url: urls.thumbnailUrl,
    uploaded_by: a.uploadedBy,
    uploaded_at: a.uploadedAt.toISOString(),
});
