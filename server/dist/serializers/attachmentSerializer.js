"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.toWireAttachment = void 0;
const toWireAttachment = (a, urls) => ({
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
exports.toWireAttachment = toWireAttachment;
