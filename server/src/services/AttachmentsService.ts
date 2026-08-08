import { AppError } from "../errors";
import { Roles, type Role } from "../constants";
import { holds } from "../rbac/can";
import { liveLegacyRole } from "../rbac/scopeGuard";
import { currentActor } from "../rbac/context";
import { fakeId } from "../utils";
import { TasksRepo } from "../repositories/TasksRepo";
import {
    AttachmentsRepo,
    type AttachmentRecord,
} from "../repositories/AttachmentsRepo";
import { R2Service } from "./R2Service";
import {
    toWireAttachment,
    type WireAttachment,
} from "../serializers/attachmentSerializer";
import {
    MAX_ATTACHMENT_BYTES,
    READ_GET_TTL_SECONDS,
    SIGN_PUT_TTL_SECONDS,
    extForMime,
    isMimeAllowed,
} from "./attachmentPolicy";

/**
 * §16 Attachments domain logic. Owns the workspace-isolation guards (every
 * attachment is reached through its task), the upload policy (size / MIME),
 * R2 presigning, and the soft-delete lifecycle. No transactions are needed —
 * each endpoint is a single write (or read) plus a presign, and the
 * trigger-maintained `attachments_count` is consistent on its own.
 */

export interface SignUploadInput {
    workspaceId: string;
    uploaderId: string;
    role: Role;
    scopeType: string;
    scopeId: string;
    filename: string;
    mimeType: string;
    sizeBytes: number;
}

export interface SignUploadResult {
    attachmentId: string;
    uploadUrl: string;
    fields: Record<string, string>;
    expiresIn: number;
}

export interface FinalizeInput {
    id: string;
    workspaceId: string;
    storageKey?: string;
    thumbnailKey?: string;
}

export interface ListAttachmentsInput {
    idOrKey: string;
    workspaceId: string;
}

export interface DeleteAttachmentInput {
    id: string;
    workspaceId: string;
    actorId: string;
    role: Role;
}

export interface DownloadInput {
    id: string;
    workspaceId: string;
}

export class AttachmentsService {
    constructor(
        private attachments: AttachmentsRepo,
        private tasksRepo: TasksRepo,
        private r2: R2Service,
    ) {}

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
    async signUpload(input: SignUploadInput): Promise<SignUploadResult> {
        if (input.scopeType !== "task") {
            throw AppError.badRequest(
                "attachment.scope_unsupported",
                `scope_type "${input.scopeType}" is not supported (only "task")`,
            );
        }

        const task = await this.tasksRepo.findByIdOrCustomIdInWorkspace(
            input.scopeId,
            input.workspaceId,
        );
        if (!task) {
            throw AppError.notFound(
                "task.not_found",
                `Task ${input.scopeId} does not exist`,
            );
        }

        if ((await liveLegacyRole(input.role)) === Roles.GUEST) {
            throw AppError.forbidden(
                "auth.forbidden",
                "Guests cannot upload attachments",
            );
        }

        if (input.sizeBytes > MAX_ATTACHMENT_BYTES) {
            throw new AppError(
                413,
                "attachment.too_large",
                `File exceeds the ${Math.floor(MAX_ATTACHMENT_BYTES / (1024 * 1024))} MB limit`,
            );
        }
        if (!isMimeAllowed(input.mimeType)) {
            throw new AppError(
                415,
                "attachment.mime_not_allowed",
                `File type "${input.mimeType}" is not permitted`,
            );
        }

        const id = fakeId("att");
        const storageKey = this.r2.buildKey(
            input.workspaceId,
            id,
            extForMime(input.mimeType),
        );

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
            expiresIn: SIGN_PUT_TTL_SECONDS,
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
    async uploadDirect(input: {
        workspaceId: string;
        uploaderId: string;
        role: Role;
        taskId: string;
        filename: string;
        mimeType: string;
        body: Buffer;
    }): Promise<WireAttachment> {
        const task = await this.tasksRepo.findByIdOrCustomIdInWorkspace(
            input.taskId,
            input.workspaceId,
        );
        if (!task) {
            throw AppError.notFound(
                "task.not_found",
                `Task ${input.taskId} does not exist`,
            );
        }
        if ((await liveLegacyRole(input.role)) === Roles.GUEST) {
            throw AppError.forbidden(
                "auth.forbidden",
                "Guests cannot upload attachments",
            );
        }
        if (input.body.length > MAX_ATTACHMENT_BYTES) {
            throw new AppError(
                413,
                "attachment.too_large",
                `File exceeds the ${Math.floor(MAX_ATTACHMENT_BYTES / (1024 * 1024))} MB limit`,
            );
        }
        if (!isMimeAllowed(input.mimeType)) {
            throw new AppError(
                415,
                "attachment.mime_not_allowed",
                `File type "${input.mimeType}" is not permitted`,
            );
        }

        const id = fakeId("att");
        const storageKey = this.r2.buildKey(
            input.workspaceId,
            id,
            extForMime(input.mimeType),
        );
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

        const updated = await this.attachments.findByIdInWorkspace(
            id,
            input.workspaceId,
        );
        if (!updated) {
            throw AppError.internal("Attachment not found after upload");
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
    async finalize(input: FinalizeInput): Promise<WireAttachment> {
        const att = await this.resolveLive(input.id, input.workspaceId);

        if (input.storageKey && input.storageKey !== att.storageKey) {
            throw AppError.validationFailed([
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
            throw AppError.validationFailed([
                {
                    field: "thumbnail_key",
                    issue: "thumbnail_key must be within this workspace",
                },
            ]);
        }

        const head = await this.r2.headObject(att.storageKey);
        if (!head.exists) {
            throw new AppError(
                410,
                "attachment.upload_expired",
                "The uploaded object was not found in storage; the upload did not complete",
            );
        }
        // Enforce the size cap against the ACTUAL object — the sign-time check
        // trusted a client-declared size, so a small declaration could smuggle a
        // huge upload past it. When R2 reports the real size, it is authoritative.
        if (head.sizeBytes != null && head.sizeBytes > MAX_ATTACHMENT_BYTES) {
            throw new AppError(
                413,
                "attachment.too_large",
                `File exceeds the ${Math.floor(MAX_ATTACHMENT_BYTES / (1024 * 1024))} MB limit`,
            );
        }

        const thumbnailKey = input.thumbnailKey ?? null;
        const realSize =
            head.sizeBytes != null ? BigInt(head.sizeBytes) : undefined;
        await this.attachments.markComplete(att.id, {
            thumbnailKey,
            sizeBytes: realSize,
        });

        // Re-read so the response reflects the persisted state (status + thumb +
        // reconciled size).
        const updated = await this.attachments.findByIdInWorkspace(
            att.id,
            input.workspaceId,
        );
        return this.hydrate(
            updated ?? {
                ...att,
                thumbnailKey,
                ...(realSize != null ? { sizeBytes: realSize } : {}),
            },
        );
    }

    /**
     * List a task's finalised attachments (bare `Attachment[]`, newest first).
     * The task is resolved in the caller's workspace first (`404 task.not_found`);
     * pending and soft-deleted rows are excluded by the repo.
     */
    async listByTask(input: ListAttachmentsInput): Promise<WireAttachment[]> {
        const task = await this.tasksRepo.findByIdOrCustomIdInWorkspace(
            input.idOrKey,
            input.workspaceId,
        );
        if (!task) {
            throw AppError.notFound(
                "task.not_found",
                `Task ${input.idOrKey} does not exist`,
            );
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
    async softDelete(input: DeleteAttachmentInput): Promise<void> {
        const att = await this.resolveLive(input.id, input.workspaceId);

        const isOwner = att.uploadedBy === input.actorId;
        // F7 / D3.1 compose: the uploader branch stays free; the admin branch
        // now also requires the `attachment.delete_any` grant, making the
        // roles-grid toggle real. Compose cannot widen access.
        // F10 (ISS-021): live role, not the token claim.
        const role = await liveLegacyRole(input.role);
        const isAdmin =
            (role === Roles.OWNER || role === Roles.ADMIN) &&
            holds(await currentActor(), "attachment.delete_any");
        if (!isOwner && !isAdmin) {
            throw AppError.forbidden(
                "auth.forbidden",
                "Only the uploader or an admin can delete this attachment",
            );
        }

        const affected = await this.attachments.softDelete(att.id);
        if (affected === 0) {
            // A concurrent delete removed it between the gate and the write.
            throw AppError.notFound(
                "attachment.not_found",
                `Attachment ${input.id} does not exist`,
            );
        }
    }

    /**
     * Resolve a fresh signed GET URL for an attachment so the caller can be
     * 302-redirected to it. Read access = any member of the task's workspace
     * (the workspace-scoped resolution proves co-tenancy); a missing /
     * cross-workspace / soft-deleted id is `404 attachment.not_found`.
     */
    async downloadUrl(input: DownloadInput): Promise<string> {
        const att = await this.resolveLive(input.id, input.workspaceId);
        // A pending (signed but never finalised) row has no object in R2 yet —
        // redirecting to it would 404 at the bucket. Treat it as not-found so only
        // real, finalised files are downloadable.
        if (att.uploadStatus !== "complete") {
            throw AppError.notFound(
                "attachment.not_found",
                `Attachment ${input.id} does not exist`,
            );
        }
        return this.r2.presignGet(att.storageKey, {
            expiresIn: READ_GET_TTL_SECONDS,
        });
    }

    /**
     * Resolve a non-deleted attachment in the workspace, or throw
     * `404 attachment.not_found`. Collapses missing + cross-tenant + soft-deleted
     * into one 404 so the endpoint is never an existence oracle.
     */
    private async resolveLive(
        id: string,
        workspaceId: string,
    ): Promise<AttachmentRecord> {
        const att = await this.attachments.findByIdInWorkspace(id, workspaceId);
        if (!att || att.deletedAt !== null) {
            throw AppError.notFound(
                "attachment.not_found",
                `Attachment ${id} does not exist`,
            );
        }
        return att;
    }

    /** Build the wire `Attachment`, minting fresh signed URLs for the file + thumb. */
    private async hydrate(att: AttachmentRecord): Promise<WireAttachment> {
        const url = await this.r2.presignGet(att.storageKey, {
            expiresIn: READ_GET_TTL_SECONDS,
        });
        const thumbnailUrl = att.thumbnailKey
            ? await this.r2.presignGet(att.thumbnailKey, {
                  expiresIn: READ_GET_TTL_SECONDS,
              })
            : null;
        return toWireAttachment(att, { url, thumbnailUrl });
    }
}
