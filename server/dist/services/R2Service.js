"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.R2Service = void 0;
const client_s3_1 = require("@aws-sdk/client-s3");
const s3_request_presigner_1 = require("@aws-sdk/s3-request-presigner");
const config_1 = require("../config");
/** True when an S3/R2 error means the object is absent (404 / NotFound). */
const isNotFound = (err) => {
    if (typeof err !== "object" || err === null)
        return false;
    const e = err;
    return e.name === "NotFound" || e.$metadata?.httpStatusCode === 404;
};
class R2Service {
    logger;
    /** `null` ⇒ no-network test/dev transport (see class doc). */
    client;
    bucket;
    constructor(logger) {
        this.logger = logger;
        const accountId = config_1.Config.CLOUDFLARE_ACCOUNT_ID;
        const accessKeyId = config_1.Config.CLOUDFLARE_R2_ACCESS_KEY;
        const secretAccessKey = config_1.Config.CLOUDFLARE_R2_SECRET_KEY;
        this.bucket = config_1.Config.CLOUDFLARE_R2_BUCKET ?? "";
        const configured = Boolean(accountId && accessKeyId && secretAccessKey && this.bucket);
        if (config_1.Config.NODE_ENV === "test" || !configured) {
            this.client = null;
            // Gap-scan M6: in PRODUCTION a missing R2 config must be LOUD —
            // the stub returns https://r2.fake/... URLs that "succeed" while
            // every real upload is silently lost. Dev/test stubbing stays
            // intentional (the QA recipe blanks the creds on purpose).
            if (config_1.Config.IS_PROD && config_1.Config.NODE_ENV !== "test") {
                this.logger.error("r2.transport.stub_in_prod", {
                    reason: "CLOUDFLARE_R2_* env incomplete — uploads will return fake URLs and store NOTHING",
                });
            }
            else {
                this.logger.debug("r2.transport.stub", {
                    reason: config_1.Config.NODE_ENV === "test" ? "test" : "unconfigured",
                });
            }
        }
        else {
            // `configured` guarantees these are set; assert for the compiler.
            this.client = new client_s3_1.S3Client({
                region: "auto",
                endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
                credentials: {
                    accessKeyId: accessKeyId,
                    secretAccessKey: secretAccessKey,
                },
                forcePathStyle: true,
            });
        }
    }
    get isStub() {
        return this.client === null;
    }
    /**
     * Build the canonical, workspace-scoped storage key for a new attachment.
     * Keyed by workspace so the janitor can sweep a tenant's objects, and never
     * derived from the client filename (only the safe extension is taken from the
     * validated mime type by the caller).
     */
    buildKey(workspaceId, attachmentId, ext) {
        const suffix = ext ? `.${ext}` : "";
        return `workspaces/${workspaceId}/attachments/${attachmentId}${suffix}`;
    }
    /** A short-lived signed PUT URL the client uploads the bytes to directly. */
    async presignPut(key, opts) {
        if (this.isStub) {
            return {
                url: `https://r2.fake/put/${encodeURIComponent(key)}?sig=test`,
                fields: { "Content-Type": opts.contentType, key },
                expiresIn: opts.expiresIn,
            };
        }
        const command = new client_s3_1.PutObjectCommand({
            Bucket: this.bucket,
            Key: key,
            ContentType: opts.contentType,
        });
        const url = await (0, s3_request_presigner_1.getSignedUrl)(this.client, command, {
            expiresIn: opts.expiresIn,
        });
        return {
            url,
            fields: { "Content-Type": opts.contentType, key },
            expiresIn: opts.expiresIn,
        };
    }
    /**
     * Upload bytes to R2 directly (server-side) — backs the PROXIED upload so the
     * browser never has to PUT cross-origin to R2 (which needs a bucket CORS
     * policy the dev/internal bucket usually lacks). No-op under the stub.
     */
    async putObject(key, body, contentType) {
        if (this.isStub)
            return;
        await this.client.send(new client_s3_1.PutObjectCommand({
            Bucket: this.bucket,
            Key: key,
            Body: body,
            ContentType: contentType,
        }));
    }
    /** A short-lived signed GET URL — backs `Attachment.url` + the download 302. */
    async presignGet(key, opts) {
        if (this.isStub) {
            return `https://r2.fake/get/${encodeURIComponent(key)}?sig=test`;
        }
        const command = new client_s3_1.GetObjectCommand({ Bucket: this.bucket, Key: key });
        return (0, s3_request_presigner_1.getSignedUrl)(this.client, command, {
            expiresIn: opts.expiresIn,
        });
    }
    /** Whether the object exists (and its size/type), via a HEAD — for finalize. */
    async headObject(key) {
        if (this.isStub) {
            // Default test transport assumes the upload landed; the "missing"
            // branch is exercised by spying this method.
            return { exists: true };
        }
        try {
            const out = await this.client.send(new client_s3_1.HeadObjectCommand({ Bucket: this.bucket, Key: key }));
            return {
                exists: true,
                sizeBytes: out.ContentLength != null
                    ? Number(out.ContentLength)
                    : undefined,
                contentType: out.ContentType,
            };
        }
        catch (err) {
            if (isNotFound(err))
                return { exists: false };
            throw err;
        }
    }
    /** Hard-delete an object — used by the §30 r2-purge janitor, not the API. */
    async deleteObject(key) {
        if (this.isStub)
            return;
        await this.client.send(new client_s3_1.DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
    }
}
exports.R2Service = R2Service;
