"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AttachmentsService = void 0;
const errors_1 = require("../errors");
const constants_1 = require("../constants");
const can_1 = require("../rbac/can");
const scopeGuard_1 = require("../rbac/scopeGuard");
const context_1 = require("../rbac/context");
const utils_1 = require("../utils");
const attachmentSerializer_1 = require("../serializers/attachmentSerializer");
const attachmentPolicy_1 = require("./attachmentPolicy");
class AttachmentsService {
    attachments;
    tasksRepo;
    r2;
    constructor(attachments, tasksRepo, r2) {
        this.attachments = attachments;
        this.tasksRepo = tasksRepo;
        this.r2 = r2;
    }
    /**
     * Issue a signed PUT URL and create the `pending` attachment row.
     *
     * Guards in order: the scope task must resolve in the caller's workspace
     * (`404 task.not_found`); the caller must have write access (guests cannot
     * upload → `403 auth.forbidden`); the declared size must be ≤ 25 MB
     * (`413 attachment.too_large`) and the MIME type allow-listed
     * (`415 attachment.mime_not_allowed`) — all BEFORE any signing, per the spec.
     * Only `scope_type = "task"` is supported in V1.
     */
    async signUpload(input) {
        if (input.scopeType !== "task") {
            throw errors_1.AppError.badRequest("attachment.scope_unsupported", `scope_type "${input.scopeType}" is not supported (only "task")`);
        }
        const task = await this.tasksRepo.findByIdOrCustomIdInWorkspace(input.scopeId, input.workspaceId);
        if (!task) {
            throw errors_1.AppError.notFound("task.not_found", `Task ${input.scopeId} does not exist`);
        }
        if ((await (0, scopeGuard_1.liveLegacyRole)(input.role)) === constants_1.Roles.GUEST) {
            throw errors_1.AppError.forbidden("auth.forbidden", "Guests cannot upload attachments");
        }
        if (input.sizeBytes > attachmentPolicy_1.MAX_ATTACHMENT_BYTES) {
            throw new errors_1.AppError(413, "attachment.too_large", `File exceeds the ${Math.floor(attachmentPolicy_1.MAX_ATTACHMENT_BYTES / (1024 * 1024))} MB limit`);
        }
        if (!(0, attachmentPolicy_1.isMimeAllowed)(input.mimeType)) {
            throw new errors_1.AppError(415, "attachment.mime_not_allowed", `File type "${input.mimeType}" is not permitted`);
        }
        const id = (0, utils_1.fakeId)("att");
        const storageKey = this.r2.buildKey(input.workspaceId, id, (0, attachmentPolicy_1.extForMime)(input.mimeType));
        await this.attachments.createPending({
            id,
            taskId: task.id,
            name: input.filename,
            storageKey,
            mimeType: input.mimeType,
            sizeBytes: BigInt(input.sizeBytes),
            uploadedBy: input.uploaderId,
        });
        const signed = await this.r2.presignPut(storageKey, {
            contentType: input.mimeType,
            expiresIn: attachmentPolicy_1.SIGN_PUT_TTL_SECONDS,
        });
        return {
            attachmentId: id,
            uploadUrl: signed.url,
            fields: signed.fields,
            expiresIn: signed.expiresIn,
        };
    }
    /**
     * PROXIED upload: the server receives the file bytes and PUTs them to R2
     * itself, then creates a COMPLETE attachment row in one go. This avoids the
     * browser PUT-ing cross-origin to R2 (which needs bucket CORS that internal
     * buckets often lack — the actual cause of "uploads don't work" in dev/prod).
     * Same guards as `signUpload`, but the size check uses the REAL byte length.
     */
    async uploadDirect(input) {
        const task = await this.tasksRepo.findByIdOrCustomIdInWorkspace(input.taskId, input.workspaceId);
        if (!task) {
            throw errors_1.AppError.notFound("task.not_found", `Task ${input.taskId} does not exist`);
        }
        if ((await (0, scopeGuard_1.liveLegacyRole)(input.role)) === constants_1.Roles.GUEST) {
            throw errors_1.AppError.forbidden("auth.forbidden", "Guests cannot upload attachments");
        }
        if (input.body.length > attachmentPolicy_1.MAX_ATTACHMENT_BYTES) {
            throw new errors_1.AppError(413, "attachment.too_large", `File exceeds the ${Math.floor(attachmentPolicy_1.MAX_ATTACHMENT_BYTES / (1024 * 1024))} MB limit`);
        }
        if (!(0, attachmentPolicy_1.isMimeAllowed)(input.mimeType)) {
            throw new errors_1.AppError(415, "attachment.mime_not_allowed", `File type "${input.mimeType}" is not permitted`);
        }
        const id = (0, utils_1.fakeId)("att");
        const storageKey = this.r2.buildKey(input.workspaceId, id, (0, attachmentPolicy_1.extForMime)(input.mimeType));
        const size = BigInt(input.body.length);
        await this.attachments.createPending({
            id,
            taskId: task.id,
            name: input.filename,
            storageKey,
            mimeType: input.mimeType,
            sizeBytes: size,
            uploadedBy: input.uploaderId,
        });
        await this.r2.putObject(storageKey, input.body, input.mimeType);
        await this.attachments.markComplete(id, {
            thumbnailKey: null,
            sizeBytes: size,
        });
        const updated = await this.attachments.findByIdInWorkspace(id, input.workspaceId);
        if (!updated) {
            throw errors_1.AppError.internal("Attachment not found after upload");
        }
        return this.hydrate(updated);
    }
    /**
     * Mark an upload complete after R2 confirms the object landed.
     *
     * Resolves the attachment in the caller's workspace (`404 attachment.not_found`
     * — also for a soft-deleted row). Verifies the object exists via an R2 HEAD;
     * a missing object means the client never finished the PUT →
     * `410 attachment.upload_expired`. An optional `storage_key` in the body must
     * match the row's key. Idempotent: re-finalising a complete row re-verifies
     * and returns. Per the spec this endpoint is `🔐` (any member).
     */
    async finalize(input) {
        const att = await this.resolveLive(input.id, input.workspaceId);
        if (input.storageKey && input.storageKey !== att.storageKey) {
            throw errors_1.AppError.validationFailed([
                {
                    field: "storage_key",
                    issue: "storage_key does not match the signed upload",
                },
            ]);
        }
        // The thumbnail key is client-supplied, so confine it to the caller's own
        // workspace namespace — otherwise a caller could point it at another
        // tenant's object and exfiltrate it through the signed `thumbnail_url`.
        const workspacePrefix = `workspaces/${input.workspaceId}/`;
        if (input.thumbnailKey && !input.thumbnailKey.startsWith(workspacePrefix)) {
            throw errors_1.AppError.validationFailed([
                {
                    field: "thumbnail_key",
                    issue: "thumbnail_key must be within this workspace",
                },
            ]);
        }
        const head = await this.r2.headObject(att.storageKey);
        if (!head.exists) {
            throw new errors_1.AppError(410, "attachment.upload_expired", "The uploaded object was not found in storage; the upload did not complete");
        }
        // Enforce the size cap against the ACTUAL object — the sign-time check
        // trusted a client-declared size, so a small declaration could smuggle a
        // huge upload past it. When R2 reports the real size, it is authoritative.
        if (head.sizeBytes != null && head.sizeBytes > attachmentPolicy_1.MAX_ATTACHMENT_BYTES) {
            throw new errors_1.AppError(413, "attachment.too_large", `File exceeds the ${Math.floor(attachmentPolicy_1.MAX_ATTACHMENT_BYTES / (1024 * 1024))} MB limit`);
        }
        const thumbnailKey = input.thumbnailKey ?? null;
        const realSize = head.sizeBytes != null ? BigInt(head.sizeBytes) : undefined;
        await this.attachments.markComplete(att.id, {
            thumbnailKey,
            sizeBytes: realSize,
        });
        // Re-read so the response reflects the persisted state (status + thumb +
        // reconciled size).
        const updated = await this.attachments.findByIdInWorkspace(att.id, input.workspaceId);
        return this.hydrate(updated ?? {
            ...att,
            thumbnailKey,
            ...(realSize != null ? { sizeBytes: realSize } : {}),
        });
    }
    /**
     * List a task's finalised attachments (bare `Attachment[]`, newest first).
     * The task is resolved in the caller's workspace first (`404 task.not_found`);
     * pending and soft-deleted rows are excluded by the repo.
     */
    async listByTask(input) {
        const task = await this.tasksRepo.findByIdOrCustomIdInWorkspace(input.idOrKey, input.workspaceId);
        if (!task) {
            throw errors_1.AppError.notFound("task.not_found", `Task ${input.idOrKey} does not exist`);
        }
        const rows = await this.attachments.listByTask(task.id);
        return Promise.all(rows.map((row) => this.hydrate(row)));
    }
    /**
     * Soft-delete an attachment (sets `deleted_at`; the R2 object is left for the
     * daily janitor). Authorized for the uploader (own) OR an owner/admin (👑) —
     * anyone else gets `403 auth.forbidden`. A missing / cross-workspace / already
     * soft-deleted id is `404 attachment.not_found`. Idempotent at the row level:
     * a concurrent double-delete resolves to a single decrement.
     */
    async softDelete(input) {
        const att = await this.resolveLive(input.id, input.workspaceId);
        const isOwner = att.uploadedBy === input.actorId;
        // F7 / D3.1 compose: the uploader branch stays free; the admin branch
        // now also requires the `attachment.delete_any` grant, making the
        // roles-grid toggle real. Compose cannot widen access.
        // F10 (ISS-021): live role, not the token claim.
        const role = await (0, scopeGuard_1.liveLegacyRole)(input.role);
        const isAdmin = (role === constants_1.Roles.OWNER || role === constants_1.Roles.ADMIN) &&
            (0, can_1.holds)(await (0, context_1.currentActor)(), "attachment.delete_any");
        if (!isOwner && !isAdmin) {
            throw errors_1.AppError.forbidden("auth.forbidden", "Only the uploader or an admin can delete this attachment");
        }
        const affected = await this.attachments.softDelete(att.id);
        if (affected === 0) {
            // A concurrent delete removed it between the gate and the write.
            throw errors_1.AppError.notFound("attachment.not_found", `Attachment ${input.id} does not exist`);
        }
    }
    /**
     * Resolve a fresh signed GET URL for an attachment so the caller can be
     * 302-redirected to it. Read access = any member of the task's workspace
     * (the workspace-scoped resolution proves co-tenancy); a missing /
     * cross-workspace / soft-deleted id is `404 attachment.not_found`.
     */
    async downloadUrl(input) {
        const att = await this.resolveLive(input.id, input.workspaceId);
        // A pending (signed but never finalised) row has no object in R2 yet —
        // redirecting to it would 404 at the bucket. Treat it as not-found so only
        // real, finalised files are downloadable.
        if (att.uploadStatus !== "complete") {
            throw errors_1.AppError.notFound("attachment.not_found", `Attachment ${input.id} does not exist`);
        }
        return this.r2.presignGet(att.storageKey, {
            expiresIn: attachmentPolicy_1.READ_GET_TTL_SECONDS,
        });
    }
    /**
     * Resolve a non-deleted attachment in the workspace, or throw
     * `404 attachment.not_found`. Collapses missing + cross-tenant + soft-deleted
     * into one 404 so the endpoint is never an existence oracle.
     */
    async resolveLive(id, workspaceId) {
        const att = await this.attachments.findByIdInWorkspace(id, workspaceId);
        if (!att || att.deletedAt !== null) {
            throw errors_1.AppError.notFound("attachment.not_found", `Attachment ${id} does not exist`);
        }
        return att;
    }
    /** Build the wire `Attachment`, minting fresh signed URLs for the file + thumb. */
    async hydrate(att) {
        const url = await this.r2.presignGet(att.storageKey, {
            expiresIn: attachmentPolicy_1.READ_GET_TTL_SECONDS,
        });
        const thumbnailUrl = att.thumbnailKey
            ? await this.r2.presignGet(att.thumbnailKey, {
                expiresIn: attachmentPolicy_1.READ_GET_TTL_SECONDS,
            })
            : null;
        return (0, attachmentSerializer_1.toWireAttachment)(att, { url, thumbnailUrl });
    }
}
exports.AttachmentsService = AttachmentsService;
