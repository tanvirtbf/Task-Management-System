"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AttachmentsController = void 0;
const errors_1 = require("../errors");
/**
 * §16 Attachments HTTP layer. Translates the validated request into a service
 * call and the result into the wire shape; never owns business logic.
 */
class AttachmentsController {
    service;
    logger;
    constructor(service, logger) {
        this.service = service;
        this.logger = logger;
    }
    /**
     * POST /api/v1/uploads/sign — issue a signed PUT URL + create the pending
     * attachment row. 🔐 + rate-limited (`uploadSignLimiter`).
     */
    async sign(req, res, next) {
        try {
            const body = req.body;
            const result = await this.service.signUpload({
                workspaceId: req.auth.workspaceId,
                uploaderId: req.auth.sub,
                role: req.auth.role,
                scopeType: body.scope_type,
                scopeId: body.scope_id,
                filename: body.filename,
                mimeType: body.mime_type,
                sizeBytes: body.size_bytes,
            });
            this.logger.info("attachments.sign.ok", {
                requestId: req.requestId,
                workspaceId: req.auth.workspaceId,
                attachmentId: result.attachmentId,
            });
            res.status(201).json({
                attachment_id: result.attachmentId,
                upload_url: result.uploadUrl,
                fields: result.fields,
                expires_in: result.expiresIn,
            });
        }
        catch (err) {
            next(err);
        }
    }
    /**
     * POST /api/v1/tasks/:id/attachments — PROXIED upload. The raw file bytes are
     * the request body (parsed by `express.raw`); the filename comes from the
     * `X-Filename` header and the MIME from `Content-Type`. The server uploads to
     * R2 itself. 🔐 any member. Returns 201 with the full `Attachment`.
     */
    async upload(req, res, next) {
        try {
            const body = req.body;
            if (!Buffer.isBuffer(body) || body.length === 0) {
                throw errors_1.AppError.badRequest("attachment.empty", "No file data was received");
            }
            const contentType = req.headers["content-type"];
            const mimeType = (typeof contentType === "string"
                ? contentType.split(";")[0]?.trim()
                : "") || "application/octet-stream";
            // Gap-scan M5: a malformed `%` in X-Filename throws URIError →
            // used to 500. Fall back to the raw header, then to "file".
            const rawName = req.headers["x-filename"];
            let filename = "file";
            if (typeof rawName === "string" && rawName) {
                try {
                    filename = decodeURIComponent(rawName);
                }
                catch {
                    filename = rawName;
                }
            }
            // F18 (ISS-071): the SAME 255 rule the presign path has always
            // enforced (`attachments.name` is varchar(255)). Without it, a
            // long X-Filename reached MySQL and "Data too long for column
            // 'name'" surfaced as a raw 500 — on the path the shipped client
            // actually uses. Counted AFTER decoding, which is what is stored.
            if (filename.length > 255) {
                throw errors_1.AppError.validationFailed([
                    {
                        field: "X-Filename",
                        issue: "filename is too long (max 255 chars)",
                    },
                ]);
            }
            const attachment = await this.service.uploadDirect({
                workspaceId: req.auth.workspaceId,
                uploaderId: req.auth.sub,
                role: req.auth.role,
                taskId: req.params.id,
                filename,
                mimeType,
                body,
            });
            this.logger.info("attachments.upload.ok", {
                requestId: req.requestId,
                workspaceId: req.auth.workspaceId,
                attachmentId: attachment.id,
            });
            res.status(201).json(attachment);
        }
        catch (err) {
            next(err);
        }
    }
    /**
     * POST /api/v1/attachments/:id/finalize — HEAD-verify the R2 object and flip
     * the row to complete. Returns 200 with the full `Attachment`.
     */
    async finalize(req, res, next) {
        try {
            const attachment = await this.service.finalize({
                id: req.params.id,
                workspaceId: req.auth.workspaceId,
                actorId: req.auth.sub,
                storageKey: req.body.storage_key,
                thumbnailKey: req.body.thumbnail_key,
            });
            this.logger.info("attachments.finalize.ok", {
                requestId: req.requestId,
                workspaceId: req.auth.workspaceId,
                attachmentId: req.params.id,
            });
            res.status(200).json(attachment);
        }
        catch (err) {
            next(err);
        }
    }
    /**
     * GET /api/v1/tasks/:id/attachments — a task's finalised attachments as a
     * bare `Attachment[]` (the §16 array shape, newest first).
     */
    async listByTask(req, res, next) {
        try {
            const rows = await this.service.listByTask({
                idOrKey: req.params.id,
                workspaceId: req.auth.workspaceId,
            });
            res.status(200).json(rows);
        }
        catch (err) {
            next(err);
        }
    }
    /**
     * DELETE /api/v1/attachments/:id — soft-delete (uploader or admin). 204.
     */
    async remove(req, res, next) {
        try {
            await this.service.softDelete({
                id: req.params.id,
                workspaceId: req.auth.workspaceId,
                actorId: req.auth.sub,
                role: req.auth.role,
            });
            this.logger.info("attachments.delete.ok", {
                requestId: req.requestId,
                workspaceId: req.auth.workspaceId,
                attachmentId: req.params.id,
            });
            res.status(204).send();
        }
        catch (err) {
            next(err);
        }
    }
    /**
     * GET /api/v1/attachments/:id/download — 302 redirect to a fresh signed GET
     * URL (5-min validity), after verifying read access to the parent task.
     */
    async download(req, res, next) {
        try {
            const url = await this.service.downloadUrl({
                id: req.params.id,
                workspaceId: req.auth.workspaceId,
            });
            // Gap-scan M11: XHR callers can't usefully follow a cross-origin
            // 302 (no Location access, no Bearer on the hop) — `?json=1`
            // hands them the fresh signed URL as a body instead. Plain
            // browser navigations keep the 302.
            if (req.query.json === "1") {
                res.status(200).json({ url });
                return;
            }
            res.redirect(302, url);
        }
        catch (err) {
            next(err);
        }
    }
}
exports.AttachmentsController = AttachmentsController;
