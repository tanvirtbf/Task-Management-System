import type { AuthRequest } from "./index";

/**
 * Endpoint-specific request shapes for §16 Attachments. Per project convention
 * these live alongside the feature, not in `types/index.ts`.
 */

/**
 * `POST /api/v1/uploads/sign` body. `scope_type` is `"task"` in V1; `scope_id`
 * is an internal task id or `custom_id`. `size_bytes` is the client-declared
 * size (validated ≤ 25 MB before signing). Server-owned fields (id, storage key,
 * uploaded_by) are never read off the body.
 */
export interface SignUploadBody {
    scope_type: string;
    scope_id: string;
    filename: string;
    mime_type: string;
    size_bytes: number;
}

export interface SignUploadRequest extends AuthRequest {
    body: SignUploadBody;
}

/**
 * `POST /api/v1/attachments/:id/finalize` body. `storage_key` (if present) must
 * match the signed key; `thumbnail_key` is the optional thumbnail object key the
 * client produced.
 */
export interface FinalizeBody {
    storage_key?: string;
    thumbnail_key?: string;
}

export interface FinalizeRequest extends AuthRequest {
    body: FinalizeBody;
}

/** `GET /api/v1/tasks/:id/attachments` — `:id` is a task id/custom_id; no body. */
export type ListAttachmentsRequest = AuthRequest;

/** `DELETE /api/v1/attachments/:id` — `:id` path param; no body. */
export type DeleteAttachmentRequest = AuthRequest;

/** `GET /api/v1/attachments/:id/download` — `:id` path param; no body. */
export type DownloadAttachmentRequest = AuthRequest;
