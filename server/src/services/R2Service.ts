import {
    S3Client,
    PutObjectCommand,
    GetObjectCommand,
    HeadObjectCommand,
    DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { Logger } from "winston";
import { Config } from "../config";

/**
 * Cloudflare R2 object storage (S3-compatible) — the single client shared by the
 * §16 attachment endpoints and the §30 janitor jobs.
 *
 * Like `MailService`, it ships with a no-network fallback: under `NODE_ENV=test`
 * or when the `CLOUDFLARE_R2_*` credentials are absent (dev before R2 is wired),
 * every method returns a DETERMINISTIC fake and makes ZERO network calls — so the
 * integration suite runs without a bucket. Tests that need a specific branch
 * (e.g. a missing object) `jest.spyOn(R2Service.prototype, "headObject")` — which
 * is why every method is a real prototype method, never an arrow field.
 */

export interface PresignedUpload {
    url: string;
    /** Informational form fields echoed to the client (Content-Type pinned). */
    fields: Record<string, string>;
    expiresIn: number;
}

export interface HeadResult {
    exists: boolean;
    sizeBytes?: number;
    contentType?: string;
}

/** True when an S3/R2 error means the object is absent (404 / NotFound). */
const isNotFound = (err: unknown): boolean => {
    if (typeof err !== "object" || err === null) return false;
    const e = err as {
        name?: string;
        $metadata?: { httpStatusCode?: number };
    };
    return e.name === "NotFound" || e.$metadata?.httpStatusCode === 404;
};

export class R2Service {
    /** `null` ⇒ no-network test/dev transport (see class doc). */
    private readonly client: S3Client | null;
    private readonly bucket: string;

    constructor(private logger: Logger) {
        const accountId = Config.CLOUDFLARE_ACCOUNT_ID;
        const accessKeyId = Config.CLOUDFLARE_R2_ACCESS_KEY;
        const secretAccessKey = Config.CLOUDFLARE_R2_SECRET_KEY;
        this.bucket = Config.CLOUDFLARE_R2_BUCKET ?? "";

        const configured = Boolean(
            accountId && accessKeyId && secretAccessKey && this.bucket,
        );
        if (Config.NODE_ENV === "test" || !configured) {
            this.client = null;
            this.logger.debug("r2.transport.stub", {
                reason: Config.NODE_ENV === "test" ? "test" : "unconfigured",
            });
        } else {
            // `configured` guarantees these are set; assert for the compiler.
            this.client = new S3Client({
                region: "auto",
                endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
                credentials: {
                    accessKeyId: accessKeyId as string,
                    secretAccessKey: secretAccessKey as string,
                },
                forcePathStyle: true,
            });
        }
    }

    private get isStub(): boolean {
        return this.client === null;
    }

    /**
     * Build the canonical, workspace-scoped storage key for a new attachment.
     * Keyed by workspace so the janitor can sweep a tenant's objects, and never
     * derived from the client filename (only the safe extension is taken from the
     * validated mime type by the caller).
     */
    buildKey(workspaceId: string, attachmentId: string, ext: string): string {
        const suffix = ext ? `.${ext}` : "";
        return `workspaces/${workspaceId}/attachments/${attachmentId}${suffix}`;
    }

    /** A short-lived signed PUT URL the client uploads the bytes to directly. */
    async presignPut(
        key: string,
        opts: { contentType: string; expiresIn: number },
    ): Promise<PresignedUpload> {
        if (this.isStub) {
            return {
                url: `https://r2.fake/put/${encodeURIComponent(key)}?sig=test`,
                fields: { "Content-Type": opts.contentType, key },
                expiresIn: opts.expiresIn,
            };
        }
        const command = new PutObjectCommand({
            Bucket: this.bucket,
            Key: key,
            ContentType: opts.contentType,
        });
        const url = await getSignedUrl(this.client!, command, {
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
    async putObject(
        key: string,
        body: Buffer,
        contentType: string,
    ): Promise<void> {
        if (this.isStub) return;
        await this.client!.send(
            new PutObjectCommand({
                Bucket: this.bucket,
                Key: key,
                Body: body,
                ContentType: contentType,
            }),
        );
    }

    /** A short-lived signed GET URL — backs `Attachment.url` + the download 302. */
    async presignGet(
        key: string,
        opts: { expiresIn: number },
    ): Promise<string> {
        if (this.isStub) {
            return `https://r2.fake/get/${encodeURIComponent(key)}?sig=test`;
        }
        const command = new GetObjectCommand({ Bucket: this.bucket, Key: key });
        return getSignedUrl(this.client!, command, {
            expiresIn: opts.expiresIn,
        });
    }

    /** Whether the object exists (and its size/type), via a HEAD — for finalize. */
    async headObject(key: string): Promise<HeadResult> {
        if (this.isStub) {
            // Default test transport assumes the upload landed; the "missing"
            // branch is exercised by spying this method.
            return { exists: true };
        }
        try {
            const out = await this.client!.send(
                new HeadObjectCommand({ Bucket: this.bucket, Key: key }),
            );
            return {
                exists: true,
                sizeBytes:
                    out.ContentLength != null
                        ? Number(out.ContentLength)
                        : undefined,
                contentType: out.ContentType,
            };
        } catch (err) {
            if (isNotFound(err)) return { exists: false };
            throw err;
        }
    }

    /** Hard-delete an object — used by the §30 r2-purge janitor, not the API. */
    async deleteObject(key: string): Promise<void> {
        if (this.isStub) return;
        await this.client!.send(
            new DeleteObjectCommand({ Bucket: this.bucket, Key: key }),
        );
    }
}
